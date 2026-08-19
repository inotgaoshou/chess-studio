import { Camera, Image, Link2, MonitorUp, Pause, Play, ScanLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardCanonicalSquare, boardIntersectionStyle, boardSkinFromAssetPath } from "./boardGeometry";
import type { CaptureSource, LinkAutoSide, LinkMode, LinkObservation, LinkTargetWindow, RecognizedLastMovePreview, RecognitionMode, ScreenshotMoveResolution, StartLinkSessionRequest } from "./platform";

type CloseOptions = { cleanupFileSession?: boolean };

type Props = {
  initialSource?: CaptureSource;
  onClose(options?: CloseOptions): void;
  onStart(request: StartLinkSessionRequest): Promise<LinkObservation>;
  onListTargetWindows?(): Promise<LinkTargetWindow[]>;
  onStop(): Promise<LinkObservation>;
  onSubmit(fen: string): Promise<LinkObservation>;
  onImport(fen: string, title?: string): Promise<void>;
  onStartTraining(fen: string, title?: string, reversed?: boolean): Promise<void>;
  onRecognizeImage(source: CaptureSource, title?: string): Promise<LinkObservation | undefined>;
  onPreviewMarkedMove?(iccs: string): Promise<RecognizedLastMovePreview>;
  onResolveScreenshotMove?(): Promise<ScreenshotMoveResolution>;
  onConfirmMarkedMove?(iccs: string): Promise<void>;
  pieceAsset?(piece: import("./platform").Piece): string;
  boardAsset?: string;
};

const sourceOptions: Array<{ value: CaptureSource; label: string; hint: string; icon: typeof Image; available: boolean }> = [
  { value: "imageImport", label: "截图/照片", hint: "选择图片识别并同步", icon: Image, available: true },
  { value: "windowLink", label: "窗口连线", hint: "框选第三方棋盘后持续同步", icon: Link2, available: true },
  { value: "desktopDetect", label: "桌面自动识别", hint: "自动扫描屏幕最大棋盘", icon: MonitorUp, available: true },
  { value: "cameraBoard", label: "实体棋盘照片", hint: "导入拍摄照片识别；实时摄像头采集后续支持", icon: Camera, available: true },
];

const stateText: Record<LinkObservation["state"], string> = {
  stopped: "已停止",
  detectingCorners: "正在检测棋盘四角",
  rectifyingBoard: "正在校正棋盘透视",
  classifyingSquares: "正在识别棋子与交叉点",
  calibrating: "等待识别结果校正",
  needsManualCorrection: "需要人工校正",
  waitingStableFrames: "等待稳定帧",
  tracking: "正在跟盘",
  paused: "已暂停",
};

function squareToIccs(row: number, col: number) { return `${String.fromCharCode(97 + col)}${9 - row}`; }

export function LinkSessionDialog({ initialSource = "windowLink", onClose, onStart, onListTargetWindows, onStop, onSubmit, onImport, onStartTraining, onRecognizeImage, onPreviewMarkedMove, onResolveScreenshotMove, onConfirmMarkedMove, pieceAsset, boardAsset }: Props) {
  const boardSkin = boardSkinFromAssetPath(boardAsset);
  const [source, setSource] = useState<CaptureSource>(initialSource);
  const [mode, setMode] = useState<LinkMode>("spectate");
  const [autoSide, setAutoSide] = useState<LinkAutoSide>("red");
  const [fen, setFen] = useState("");
  const [title, setTitle] = useState("天天象棋截图拆棋");
  const [observation, setObservation] = useState<LinkObservation>({ state: "stopped", accepted: false });
  const [busy, setBusy] = useState(false);
  const [correctionExpanded, setCorrectionExpanded] = useState(false);
  const [markedFrom, setMarkedFrom] = useState<{ row: number; col: number }>();
  const [markedMove, setMarkedMove] = useState<RecognizedLastMovePreview>();
  const [markedCandidates, setMarkedCandidates] = useState<RecognizedLastMovePreview[]>([]);
  const [manualBoard, setManualBoard] = useState<{ pieces: import("./platform").Piece[]; sideToMove: import("./platform").Side }>();
  const [screenshotResolutionStatus, setScreenshotResolutionStatus] = useState<ScreenshotMoveResolution["status"]>();
  const [markError, setMarkError] = useState("");
  const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  const [targetWindows, setTargetWindows] = useState<LinkTargetWindow[]>([]);
  const [targetWindowId, setTargetWindowId] = useState<string>();
  const [targetWindowError, setTargetWindowError] = useState<string>();
  const [reversed, setReversed] = useState(false);
  const hasFileRecognitionSessionRef = useRef(false);
  const stableFrames = source === "cameraBoard" ? 3 : source === "imageImport" ? 1 : 2;
  const recognitionMode: RecognitionMode = "yoloBoard";
  const active = observation.state !== "stopped" && !(source === "imageImport" || source === "cameraBoard");
  const fileRecognition = source === "imageImport" || source === "cameraBoard";
  const liveRecognition = source === "windowLink" || source === "desktopDetect";

  const loadTargetWindows = async () => {
    if (!isWindows || !onListTargetWindows) return;
    setTargetWindowError(undefined);
    try {
      const targets = await onListTargetWindows();
      setTargetWindows(targets);
      setTargetWindowId((current) => targets.some((target) => target.id === current) ? current : targets.at(0)?.id);
      if (targets.length === 0) setTargetWindowError("未找到可用的 Chrome 或 Edge 窗口。请先打开天天象棋网页版，并保持窗口可见。" );
    } catch (error) {
      setTargetWindows([]);
      setTargetWindowError(error instanceof Error ? error.message : "读取 Windows 浏览器窗口失败");
    }
  };

  useEffect(() => {
    if (source === "windowLink") void loadTargetWindows();
  }, [source]);
  const showCorrection = fileRecognition || correctionExpanded || observation.state === "needsManualCorrection";

  async function run(task: () => Promise<LinkObservation>) {
    // A new file-selection attempt must not leave the previous screenshot's
    // proposed move actionable if the picker is cancelled or recognition fails.
    if (fileRecognition) {
      setScreenshotResolutionStatus(undefined);
      setMarkedMove(undefined);
      setMarkedCandidates([]);
      setManualBoard(undefined);
      setMarkedFrom(undefined);
      setMarkError("");
    }
    setBusy(true);
    try {
      const next = await task();
      setObservation(next);
      if (fileRecognition && next.state !== "stopped") {
        if (next.orientation) setReversed(next.orientation === "blackAtBottom");
        if (next.board) setFen(next.board.fen);
        const resolution = await onResolveScreenshotMove?.();
        if (resolution) {
          setReversed(resolution.orientation === "blackAtBottom");
          setScreenshotResolutionStatus(resolution.status);
          setMarkedCandidates(resolution.status === "ambiguous" ? resolution.candidates : []);
          setMarkedMove(resolution.status === "unique" ? resolution.candidates[0] : undefined);
          setManualBoard(resolution.status === "noExactMatch" ? { pieces: resolution.currentPieces, sideToMove: resolution.currentSideToMove } : undefined);
          setMarkedFrom(undefined);
          setMarkError(resolution.reason ?? "");
        }
      }
    } finally { setBusy(false); }
  }

  function close() {
    onClose({ cleanupFileSession: hasFileRecognitionSessionRef.current });
  }

  async function recognizeImage() {
    const recognized = await onRecognizeImage(source, title);
    if (recognized) {
      hasFileRecognitionSessionRef.current = true;
      return recognized;
    }
    // The native picker does not call the recognition command when cancelled.
    // Explicitly invalidate the earlier image session as well, so the UI and
    // backend cannot disagree about an old confirmation candidate.
    try {
      await onStop();
    } catch {
      // The local UI has already discarded the proposal. Keep a cancelled
      // picker safe even if the best-effort backend invalidation is unavailable.
    }
    return { state: "stopped" as const, accepted: false, reason: "已取消选择图片" };
  }

  // Endpoint selection is a recovery path only. A resolved exact match must
  // stay bound to its YOLO/tree candidate, and an ambiguous match must be
  // chosen from that already validated candidate list.
  const manualMoveEntryEnabled = screenshotResolutionStatus === "noExactMatch" && !!manualBoard;

  async function markSquare(row: number, col: number) {
    // When YOLO cannot produce a playable post-move board, the resolver keeps
    // the current document as `manualBoard`. Manual endpoints must remain
    // available in that recovery state; the backend validates the ICCS move
    // against the current document before it can be confirmed.
    if (!onPreviewMarkedMove || !fileRecognition || !manualMoveEntryEnabled) return;
    const square = boardCanonicalSquare({ row, col }, reversed);
    if (!markedFrom) { setMarkedFrom(square); setMarkedMove(undefined); setMarkedCandidates([]); setMarkError(""); return; }
    const iccs = `${squareToIccs(markedFrom.row, markedFrom.col)}${squareToIccs(square.row, square.col)}`;
    setMarkedFrom(undefined);
    try { setMarkedMove(await onPreviewMarkedMove(iccs)); setMarkedCandidates([]); setMarkError(""); }
    catch (error) { setMarkError(error instanceof Error ? error.message : "这一步不符合棋规，请重新选择"); }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="link-session-dialog" role="dialog" aria-modal="true" aria-labelledby="link-session-title">
      <header><div><ScanLine size={18}/><span><strong id="link-session-title">识别与连线</strong><small>识别结果必须经过棋规与稳定帧校验</small></span></div><button className="tool-button" aria-label="关闭识别与连线" title="关闭" onClick={close}><X size={16}/></button></header>
      <div className="link-session-body">
        <section className="link-source-grid" aria-label="局面来源">
          {sourceOptions.map((option) => { const Icon = option.icon; const hint = isWindows && option.value === "windowLink" ? "选择 Chrome / Edge 网页窗口后持续同步" : option.hint; return <button key={option.value} className={source === option.value ? "active" : ""} onClick={() => { setSource(option.value); setCorrectionExpanded(false); setScreenshotResolutionStatus(undefined); setMarkedMove(undefined); setMarkedCandidates([]); setManualBoard(undefined); setMarkedFrom(undefined); setMarkError(""); setTargetWindowError(undefined); if (option.value === "imageImport" || option.value === "cameraBoard") setMode("spectate"); if (option.value === "windowLink") void loadTargetWindows(); }} disabled={active || !option.available}><Icon size={16}/><strong>{option.label}</strong><small>{hint}</small></button>; })}
        </section>
        {isWindows && source === "windowLink" && <section className="link-target-window" aria-label="Windows 目标浏览器窗口"><header><strong>目标浏览器窗口</strong><button type="button" onClick={() => void loadTargetWindows()} disabled={active || busy}>刷新列表</button></header><select value={targetWindowId ?? ""} onChange={(event) => setTargetWindowId(event.target.value)} disabled={active || busy || targetWindows.length === 0}><option value="" disabled>请选择天天象棋网页窗口</option>{targetWindows.map((target) => <option key={target.id} value={target.id}>{target.processName.replace(".exe", "")} · {target.title} · {target.clientWidth}×{target.clientHeight} · {Math.round(target.dpi / 96 * 100)}%</option>)}</select><small>只采集所选浏览器客户区，不读取或保存其他窗口内容。窗口最小化、关闭或更换管理员权限后会安全暂停；Windows 仅支持观战和确认走子。</small>{targetWindowError && <p role="alert">{targetWindowError}</p>}</section>}
        <div className="link-config-row"><label>模式<select value={mode} onChange={(event) => setMode(event.target.value as LinkMode)} disabled={active}>{!isWindows && <option value="autoPlay">自动对战</option>}<option value="confirmPlay">确认走子</option><option value="spectate">观战跟盘</option></select></label>{mode === "autoPlay" && <label>自动执棋<select value={autoSide} onChange={(event) => setAutoSide(event.target.value as LinkAutoSide)} disabled={active}><option value="red">红方</option><option value="black">黑方</option></select></label>}<label>稳定帧<input readOnly value={`${stableFrames} 帧`} /></label></div>
        <p className="link-mode-hint">{mode === "autoPlay" ? `自动对战：同步局面并启动引擎分析，轮到${autoSide === "red" ? "红方" : "黑方"}时自动点击第一候选着法。` : mode === "confirmPlay" ? "确认走子：同步局面和分析候选，但每步都需要在连线浮窗里确认。" : "观战跟盘：只同步局面和分析，不点击第三方棋盘。"}</p>
        {liveRecognition ? <section className="link-live-card"><strong>实时连线流程</strong><ol>{isWindows && source === "windowLink" ? <><li>选择 Chrome 或 Edge 中打开的天天象棋网页窗口。</li><li>识别通过后同步主棋盘，并触发本地引擎分析/候选箭头。</li><li>确认走子会先核对局面，再向该窗口发送起点和终点点击。</li></> : <><li>启动后打开连线浮窗，并框选第三方棋盘。</li><li>识别通过后同步主棋盘，并触发本地引擎分析/候选箭头。</li><li>识别异常会在浮窗提示缺哪边将帅、置信度和检测数量。</li></>}</ol></section> : <ol className="link-learning-steps"><li>从天天象棋等应用保存当前局面截图，选择图片识别。</li><li>核对识别出的 FEN、标题和红黑行棋方；识别结果不理想时可以修正 FEN。</li><li>点击“导入并开始 U10 拆棋”会新建独立练习局面，不会改动原棋谱或第三方应用。</li></ol>}
        <div className={`link-session-status ${observation.state}`}><span>当前状态</span><strong>{stateText[observation.state]}</strong>{observation.reason && <small>{observation.reason}</small>}{observation.moveIccs && <em>已同步 {observation.moveIccs}</em>}</div>
        {fileRecognition && (observation.board || manualBoard || markedMove) && pieceAsset && <section className="link-move-marker" aria-label="截图走子标记">
          <header><strong>识别到的上一着</strong><small>白色空心圈与棋子底光只用于已通过完整局面匹配的候选排序，不会单独推断走法。所有结果均需确认后才写入变例。</small></header>
          <div className="link-board-orientation" role="group" aria-label="截图棋盘视角"><button type="button" className={!reversed ? "active" : ""} aria-pressed={!reversed} onClick={() => { setReversed(false); setMarkedFrom(undefined); }}>红方在下</button><button type="button" className={reversed ? "active" : ""} aria-pressed={reversed} onClick={() => { setReversed(true); setMarkedFrom(undefined); }}>黑方在下</button></div>
          <div className="link-move-marker-board"><LinkMiniBoard presentation="preview" markerStyle={markedMove ? "tiantian" : "corner"} pieces={markedMove?.pieces ?? manualBoard?.pieces ?? observation.board?.pieces ?? []} arrows={[]} lastMove={markedMove ? { from: markedMove.from, to: markedMove.to, notation: markedMove.notation, movedBy: markedMove.movedBy } : undefined} selectedSquare={markedFrom} sideToMove={markedMove?.sideToMove ?? manualBoard?.sideToMove ?? observation.board?.sideToMove} reversed={reversed} pieceScale={1.12} markerScale={.78} arrowVisualScale={.82} pieceAsset={pieceAsset} boardAsset={boardAsset}/>{manualMoveEntryEnabled && <div className="link-move-marker-grid">{Array.from({ length: 90 }, (_, index) => { const row = Math.floor(index / 9); const col = index % 9; const square = boardCanonicalSquare({ row, col }, reversed); return <button type="button" key={`${row}-${col}`} aria-label={`标记棋盘第 ${row + 1} 行第 ${col + 1} 列`} style={boardIntersectionStyle(square, reversed, boardSkin)} onClick={() => void markSquare(row, col)}/>; })}</div>}</div>
          <div className="link-marker-legend"><span className="source">红框：手动起点</span>{markedMove ? <><span className="tiantian-source">白圈：上一着起点</span><span className="tiantian-target">白边：上一着终点</span></> : <span className="corner-target">红框：走后终点</span>}</div>
          {markedCandidates.length > 1 && <div className="link-marked-candidates" aria-label="上一着候选"><strong>未能唯一确定，请选择上一着</strong>{markedCandidates.map((candidate) => <button type="button" key={`${candidate.from.row}-${candidate.from.col}-${candidate.to.row}-${candidate.to.col}`} onClick={() => { setMarkedMove(candidate); setMarkedCandidates([]); }}><span>{candidate.movedBy} · {candidate.notation}</span><small>现在轮到{candidate.sideToMove}走</small></button>)}</div>}
          {markedMove ? <div className="link-marked-move"><strong>上一着（待确认）：{markedMove.movedBy} · {markedMove.notation}</strong><span>起点 {markedMove.from.row + 1} 行 {markedMove.from.col + 1} 列 → 终点 {markedMove.to.row + 1} 行 {markedMove.to.col + 1} 列 · 现在轮到{markedMove.sideToMove}走</span><small>{markedMove.recognitionSource ?? "截图标记"}{markedMove.recognitionConfidence != null ? ` · 识别证据 ${markedMove.recognitionConfidence}` : ""}</small><button type="button" className="primary" onClick={() => void onConfirmMarkedMove?.(`${squareToIccs(markedMove.from.row, markedMove.from.col)}${squareToIccs(markedMove.to.row, markedMove.to.col)}`)}>确认写入当前棋谱变例</button></div> : <small className="link-marker-hint">{markedFrom ? "已选起点，请点走后棋子所在的终点。" : markedCandidates.length > 1 ? "请选择一个候选；确认前不会写入棋谱。" : manualMoveEntryEnabled ? "完整局面没有合法的一步衔接，请点起点，再点终点；切换红黑视角不会改变已识别走法。" : "正在等待完整局面与当前棋谱的严格匹配结果。"}</small>}
          {markError && <p className="link-marker-error">{markError}</p>}
        </section>}
        {showCorrection ? <section className="link-correction"><header><strong>{fileRecognition ? "局面校正与导入" : "高级：手动校正 FEN"}</strong><small>{fileRecognition ? "截图/照片识别结果会填入此处；可改 FEN 和标题后确认。" : "实时连线通常不需要填写。只有识别异常、或你想手动提交局面时才使用。"}</small></header><textarea value={fen} onChange={(event) => setFen(event.target.value)} placeholder="粘贴识别得到的 FEN，例如 rnbakabnr/... w - - 0 1" spellCheck={false}/>{fileRecognition && <label>新棋谱标题<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>}</section> : <button type="button" className="link-manual-correction-toggle" onClick={() => setCorrectionExpanded(true)}>手动校正 FEN / 导入局面</button>}
        <p className="link-session-notice">随包 YOLO11 模型会在启动时校验 SHA-256 并建立 ONNX 会话；识别只处理当前帧，不保存第三方窗口内容。</p>
      </div>
      <footer>{active ? <><button onClick={() => void run(onStop)} disabled={busy}><Pause size={14}/>停止连线</button>{showCorrection && <button className="primary" onClick={() => void run(() => onSubmit(fen))} disabled={busy || !fen.trim()}>提交识别局面</button>}</> : <>{showCorrection && <button onClick={() => void onImport(fen, title)} disabled={busy || !fen.trim()}><Image size={14}/>仅导入棋局</button>}{fileRecognition && observation.board && <button className="primary" onClick={() => void onStartTraining(fen, title, reversed)} disabled={busy || !fen.trim()}><Play size={14}/>导入并开始 U10 拆棋</button>}{fileRecognition ? <button onClick={() => void run(recognizeImage)} disabled={busy}><Camera size={14}/>{busy ? "识别中…" : observation.board ? "重新选择图片" : "选择图片识别"}</button> : <button className="primary" onClick={() => void run(() => onStart({ source, recognitionMode, mode, stableFrames, autoSide: mode === "autoPlay" ? autoSide : undefined, targetWindowId: source === "windowLink" && isWindows ? targetWindowId : undefined }))} disabled={busy || (isWindows && source === "windowLink" && !targetWindowId)}><Play size={14}/>{busy ? (isWindows ? "正在连接…" : "正在打开框选…") : isWindows && source === "windowLink" ? "连接所选窗口" : "启动连线"}</button>}</>}</footer>
    </section>
  </div>;
}
