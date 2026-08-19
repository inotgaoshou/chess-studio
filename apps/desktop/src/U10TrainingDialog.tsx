import { BarChart3, BookOpenCheck, Brain, CalendarDays, CheckCircle2, ChevronDown, Clock3, EyeOff, FlipVertical, Lightbulb, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardCanonicalSquare, boardIntersectionStyle, boardSkinFromAssetPath } from "./boardGeometry";
import { bundledTheoryKnowledge } from "./theoryKnowledge.generated";
import type { DailyTrainingPlan, GuidedAnalysisStart, GuidedAnalysisSubmission, GuidedAnalysisSubmissionResult, LearningProfile, OpeningRepertoire, Piece, PreviewLineStep, WeeklyLearningReport } from "./platform";
import { TRAINING_METHOD_LABEL } from "./trainingSystem";

type Props = {
  start: GuidedAnalysisStart;
  profile: LearningProfile;
  dailyPlan?: DailyTrainingPlan;
  weeklyReport?: WeeklyLearningReport;
  repertoire?: OpeningRepertoire;
  busy: boolean;
  error?: string;
  onClose(): void;
  onCancel(sessionId: string): void;
  onPreview(moves: string[]): Promise<PreviewLineStep[]>;
  onParseChineseLine(notation: string[]): Promise<{ moves: string[]; steps: PreviewLineStep[] }>;
  initialReversed?: boolean;
  pieceAsset(piece: Piece): string;
  boardAsset: string;
  onSubmit(submission: GuidedAnalysisSubmission): Promise<GuidedAnalysisSubmissionResult>;
  onSaveProfile(profile: LearningProfile): Promise<void> | void;
  onSaveVariation?(moves: string[]): Promise<void> | void;
};

const emptyAnswers = {
  threats: "",
  forcingMoves: "",
  worstPiece: "",
  candidates: ["", ""],
  chosenMove: "",
  predictedLine: "",
  confidence: 60,
};

const thinkingGuides = [
  {
    key: "threats",
    prompt: "先假设对方再走一步。",
    title: "威胁检查",
    items: ["对方能不能将军？", "有没有无保护的子会被吃？", "会不会先手捉子、打开线路或形成杀势？", "回答时说清：威胁什么，下一步会怎样。"],
  },
  {
    key: "forcingMoves",
    prompt: "按“将军 → 吃子 → 捉双 → 强制兑子”逐项扫描。",
    title: "强制着扫描",
    items: ["红黑双方都要分别数一遍。", "每个候选先看对方最强的一步应对。", "“能走”不等于“好走”，要继续看结果。"],
  },
  {
    key: "worstPiece",
    prompt: "先给每枚子说一个任务。",
    title: "最差子检查",
    items: ["找活动范围最小、被堵住或没有任务的子。", "也看它是否容易受攻、离战场太远。", "说清改善它以后能控制什么点或承担什么任务。"],
  },
] as const;

function squareToIccs(row: number, col: number) {
  return `${String.fromCharCode(97 + col)}${9 - row}`;
}

function squareLabel(row: number, col: number) {
  return `棋盘第 ${row + 1} 行第 ${col + 1} 列`;
}

function phaseName(phase: string) {
  return phase === "opening" ? "开局" : phase === "endgame" ? "残局" : "中局";
}

function resultTone(kind: string) {
  return kind === "correct" ? "correct" : kind === "direction" ? "direction" : kind === "missedCounterplay" ? "warning" : "principle";
}

function qualitativeScore(scoreCp?: number, mate?: number) {
  if (mate != null) return mate > 0 ? "有杀势" : "需防杀";
  if (scoreCp == null) return "待核对";
  const cp = Math.abs(scoreCp);
  if (cp < 50) return "均势";
  if (cp < 120) return "稍优";
  if (cp < 300) return "明显优势";
  return "胜势";
}

function ThinkingGuide({ guide, open, onToggle }: { guide: typeof thinkingGuides[number]; open: boolean; onToggle(): void }) {
  return <section className="u10-thinking-guide">
    <button type="button" aria-expanded={open} onClick={onToggle}><Lightbulb size={12}/>想一想<ChevronDown size={12}/></button>
    {open && <div role="note" aria-label={guide.title}><strong>{guide.title}</strong><ul>{guide.items.map((item) => <li key={item}>{item}</li>)}</ul></div>}
  </section>;
}

export function U10TrainingDialog({ start, profile, dailyPlan, weeklyReport, repertoire, busy, error, onClose, onCancel, onPreview, onParseChineseLine, initialReversed = false, pieceAsset, boardAsset, onSubmit, onSaveProfile, onSaveVariation }: Props) {
  const boardSkin = useMemo(() => boardSkinFromAssetPath(boardAsset), [boardAsset]);
  const [tab, setTab] = useState<"analysis" | "plan" | "profile" | "report">("analysis");
  const [answers, setAnswers] = useState(emptyAnswers);
  const [selectedSquare, setSelectedSquare] = useState<{ row: number; col: number }>();
  const [reversed, setReversed] = useState(initialReversed);
  const [previewSteps, setPreviewSteps] = useState<PreviewLineStep[]>([]);
  const [predictedMoves, setPredictedMoves] = useState<string[]>([]);
  const [viewedStepIndex, setViewedStepIndex] = useState<number>();
  const [manualLineOpen, setManualLineOpen] = useState(false);
  const [manualLine, setManualLine] = useState("");
  const [lineError, setLineError] = useState("");
  const [predictionPending, setPredictionPending] = useState(false);
  const [result, setResult] = useState<GuidedAnalysisSubmissionResult>();
  const [openThinkingGuide, setOpenThinkingGuide] = useState<string>();
  const [usedThinkingGuides, setUsedThinkingGuides] = useState<Set<string>>(() => new Set());
  const [draftProfile, setDraftProfile] = useState(profile);
  const previewRequestId = useRef(0);
  const interactionLocked = useRef(false);
  const currentPreview = viewedStepIndex == null ? previewSteps.at(-1) : previewSteps[viewedStepIndex];
  const previewPieces = currentPreview?.pieces ?? start.board.pieces;
  // While choosing the next temporary move, keep the board focused on the
  // selected source. Showing the prior move as well would leave three corner
  // markers on screen and make the intended action ambiguous.
  const displayedMove = selectedSquare || predictionPending || !currentPreview ? undefined : {
    from: currentPreview.from,
    to: currentPreview.to,
    notation: currentPreview.notation,
    movedBy: currentPreview.movedBy,
  };
  const sideToMove = currentPreview
    ? (currentPreview.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方")
    : start.board.sideToMove;
  const candidates = [answers.chosenMove, ...answers.candidates]
    .map((move) => move.trim())
    .filter((move, index, all) => move && all.indexOf(move) === index);
  const ready = answers.threats.trim() && answers.forcingMoves.trim() && answers.worstPiece.trim()
    && answers.chosenMove.trim() && predictedMoves.length >= 2 && predictedMoves.length <= 8;
  const candidateShortage = candidates.length < 3;
  const relevantCards = bundledTheoryKnowledge.cards.filter((card) => card.phase === start.session.phase).slice(0, 4);
  const matchedCards = result
    ? bundledTheoryKnowledge.cards.filter((card) => card.tags.some((tag) => result.result.theorySignals.includes(tag))).slice(0, 3)
    : [];

  async function setPrediction(moves: string[]) {
    const limited = moves.slice(0, 8);
    const requestId = ++previewRequestId.current;
    if (moves.length === 0) {
      interactionLocked.current = false;
      setPredictedMoves([]);
      setPreviewSteps([]);
      setViewedStepIndex(undefined);
      setSelectedSquare(undefined);
      setLineError("");
      return;
    }
    try {
      interactionLocked.current = true;
      setPredictionPending(true);
      const steps = await onPreview(limited);
      if (requestId !== previewRequestId.current) return;
      setPredictedMoves(limited);
      setPreviewSteps(steps);
      setViewedStepIndex(undefined);
      setAnswers((current) => ({ ...current, chosenMove: current.chosenMove || limited[0] || "" }));
      setLineError("");
    } catch (error) {
      if (requestId === previewRequestId.current) {
        setLineError(error instanceof Error ? error.message : "这一步不符合棋规，请重新走子");
      }
    } finally {
      if (requestId === previewRequestId.current) {
        interactionLocked.current = false;
        setPredictionPending(false);
      }
    }
  }

  async function clickSquare(row: number, col: number) {
    if (result || busy || predictionPending || interactionLocked.current) return;
    if (viewedStepIndex != null && viewedStepIndex < predictedMoves.length - 1) {
      setLineError("正在回看前面的局面，请先点击“从该步继续推演”后再走子");
      return;
    }
    const square = boardCanonicalSquare({ row, col }, reversed);
    const pieceAtSquare = previewPieces.find((piece) => piece.row === square.row && piece.col === square.col);
    const movingColor = sideToMove === "红方" ? "red" : "black";
    if (!selectedSquare) {
      // U10 teaches a deliberate two-click sequence: pick one of the side to
      // move's pieces, then choose its destination. Empty and opposing
      // squares must never look like a valid first click.
      if (pieceAtSquare?.color !== movingColor) {
        setLineError(`请先选择轮到${sideToMove}走的棋子`);
        return;
      }
      setSelectedSquare(square);
      setLineError("");
      return;
    }
    if (pieceAtSquare?.color === movingColor) {
      setSelectedSquare(square);
      setLineError("");
      return;
    }
    if (predictedMoves.length >= 8) {
      setSelectedSquare(undefined);
      setLineError("最多推演 8 个半回合，请撤回后再尝试");
      return;
    }
    const move = `${squareToIccs(selectedSquare.row, selectedSquare.col)}${squareToIccs(square.row, square.col)}`;
    setSelectedSquare(undefined);
    await setPrediction([...predictedMoves, move]);
  }

  async function applyManualLine() {
    if (predictionPending || interactionLocked.current) return;
    const notation = manualLine.split(/[\s，,；;]+/).map((value) => value.trim()).filter(Boolean).slice(0, 8);
    if (notation.length === 0) return;
    const requestId = ++previewRequestId.current;
    try {
      interactionLocked.current = true;
      setPredictionPending(true);
      const parsed = await onParseChineseLine(notation);
      if (requestId !== previewRequestId.current) return;
      setPredictedMoves(parsed.moves);
      setPreviewSteps(parsed.steps);
      setViewedStepIndex(undefined);
      setSelectedSquare(undefined);
      setAnswers((current) => ({ ...current, chosenMove: current.chosenMove || parsed.moves[0] || "" }));
      setLineError("");
    } catch (error) {
      if (requestId === previewRequestId.current) {
        setLineError(error instanceof Error ? error.message : "中文线路无法解析");
      }
    } finally {
      if (requestId === previewRequestId.current) {
        interactionLocked.current = false;
        setPredictionPending(false);
      }
    }
  }

  async function submit() {
    if (!ready || busy) return;
    try {
      const resolvedCandidates = [...new Set(await Promise.all(candidates.map(async (candidate) => {
        if (candidate === answers.chosenMove) return candidate;
        const parsed = await onParseChineseLine([candidate]);
        return parsed.moves[0];
      })))];
      const submission: GuidedAnalysisSubmission = {
        threats: answers.threats.trim(),
        forcingMoves: answers.forcingMoves.trim(),
        worstPiece: answers.worstPiece.trim(),
        candidates: resolvedCandidates,
        chosenMove: answers.chosenMove.trim(),
        predictedLine: predictedMoves,
        confidence: answers.confidence,
        elapsedSeconds: Math.max(1, Math.round((Date.now() - new Date(start.session.startedAt).getTime()) / 1000)),
        hintsUsed: usedThinkingGuides.size,
      };
      setResult(await onSubmit(submission));
    } catch (error) {
      setLineError(error instanceof Error ? error.message : "候选着无法解析，请使用中文记谱补充");
    }
  }

  function close() {
    previewRequestId.current += 1;
    interactionLocked.current = false;
    if (!result) onCancel(start.session.id);
    onClose();
  }

  return <div className="modal-backdrop u10-backdrop" role="presentation">
    <section className="u10-dialog" role="dialog" aria-modal="true" aria-labelledby="u10-title">
      <header className="u10-header">
        <div><span className="u10-badge">U10</span><div><strong id="u10-title">全国少年赛训练</strong><small>第 {profile.currentWeek} 周 · {profile.coachMode} · 每次 {profile.sessionMinutes} 分钟</small></div></div>
        <button type="button" aria-label="关闭 U10 训练" title="关闭" onClick={close}><X size={17}/></button>
      </header>
      <nav className="u10-tabs" aria-label="U10 学习分页">
        <button className={tab === "analysis" ? "active" : ""} onClick={() => setTab("analysis")}><Brain size={14}/>引导拆棋</button>
        <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><CalendarDays size={14}/>今日 40 分钟</button>
        <button className={tab === "report" ? "active" : ""} onClick={() => setTab("report")}><BarChart3 size={14}/>家长周报</button>
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><BookOpenCheck size={14}/>学习档案</button>
      </nav>
      {error && <p className="u10-error">{error}</p>}
      {tab === "analysis" && <div className="u10-analysis-layout">
        <section className="u10-board-panel">
          <header><strong>{phaseName(start.session.phase)}问题局面</strong><div className="u10-board-header-actions"><span>{result ? "答案已揭示" : <><b>答案已隐藏</b> · {sideToMove}走</>}</span><div className="u10-board-orientation" role="group" aria-label="棋盘视角"><button type="button" className={!reversed ? "active" : ""} aria-pressed={!reversed} onClick={() => { setReversed(false); setSelectedSquare(undefined); }}>红方在下</button><button type="button" className={reversed ? "active" : ""} aria-pressed={reversed} onClick={() => { setReversed(true); setSelectedSquare(undefined); }}>黑方在下</button></div><button type="button" aria-label="翻转棋盘" title="翻转棋盘" onClick={() => { setReversed((value) => !value); setSelectedSquare(undefined); }}><FlipVertical size={13}/></button></div></header>
          <div className="u10-board-viewport">
            <div className={`u10-board-click-layer ${selectedSquare ? "selecting" : ""}`}>
              <LinkMiniBoard presentation="preview" markerStyle="corner" animateMoves={false} boardAriaLabel="U10 临时推演棋盘" pieces={previewPieces} arrows={[]} lastMove={displayedMove} selectedSquare={selectedSquare} sideToMove={sideToMove} reversed={reversed} pieceAsset={pieceAsset} boardAsset={boardAsset}/>
              {!result && <div className="u10-board-hit-grid" aria-label="U10 临时推演走子区域">{Array.from({ length: 90 }, (_, index) => {
                const row = Math.floor(index / 9); const col = index % 9;
                const square = boardCanonicalSquare({ row, col }, reversed);
                return <button key={`${row}-${col}`} type="button" disabled={predictionPending || busy} aria-label={`推演${squareLabel(row, col)}`} data-square={`${square.row}-${square.col}`} className="u10-board-hit-target" style={boardIntersectionStyle(square, reversed, boardSkin)} onClick={() => void clickSquare(row, col)}/>;
              })}</div>}
            </div>
          </div>
          {!result && <small className="u10-board-help">先点棋子，再点目标点。这里的走子只用于本次拆棋，不会修改真实棋谱。</small>}
          <section className="u10-prediction-strip" aria-label="我的推演">
            <header><strong>我的推演</strong><small>{predictedMoves.length < 2 ? `还需 ${2 - predictedMoves.length} 手才可提交` : `已推演 ${predictedMoves.length}/8 手，可提交`}</small></header>
            <div className="u10-prediction-steps">{previewSteps.length === 0 ? <span>请直接在棋盘上走出你的想法</span> : previewSteps.map((step, index) => <button type="button" key={`${step.notation}-${index}`} className={viewedStepIndex === index ? "active" : ""} title={`回看第 ${index + 1} 步局面`} onClick={() => !result && setViewedStepIndex(index)}><b>{index + 1}</b><span>{step.movedBy} · {step.notation}</span></button>)}</div>
            {!result && <footer>{viewedStepIndex != null && viewedStepIndex < predictedMoves.length - 1 && <button type="button" className="u10-continue-from-step" disabled={predictionPending || busy} onClick={() => void setPrediction(predictedMoves.slice(0, viewedStepIndex + 1))}>从第 {viewedStepIndex + 1} 步继续推演</button>}<span className="u10-prediction-actions"><button type="button" disabled={predictionPending || busy || predictedMoves.length === 0} onClick={() => void setPrediction(predictedMoves.slice(0, -1))}><RotateCcw size={12}/>撤回一步</button><button type="button" disabled={predictionPending || busy || (predictedMoves.length === 0 && !selectedSquare)} onClick={() => void setPrediction([])}><Trash2 size={12}/>清空</button></span></footer>}
          </section>
          {!result && <section className="u10-manual-line"><button type="button" aria-expanded={manualLineOpen} disabled={predictionPending || busy} onClick={() => setManualLineOpen((open) => !open)}>手动补充中文线路 <ChevronDown size={13}/></button>{manualLineOpen && <div><input aria-label="手动补充中文线路" disabled={predictionPending || busy} value={manualLine} placeholder="例如：马2进3 炮8进4" onChange={(event) => setManualLine(event.target.value)}/><button type="button" disabled={predictionPending || busy || !manualLine.trim()} onClick={() => void applyManualLine()}>应用到棋盘</button></div>}</section>}
          {lineError && <p className="u10-line-error" role="alert">{lineError}</p>}
        </section>
        {!result ? <section className="u10-answer-panel">
          <header><EyeOff size={16}/><div><strong>先独立思考，再看引擎</strong><small>提交前不会显示箭头、候选线或局面分。</small></div></header>
          <label>1. 对方有什么直接威胁？<small className="u10-thinking-prompt">{thinkingGuides[0].prompt}</small><textarea aria-label="对方直接威胁" value={answers.threats} onChange={(event) => setAnswers({ ...answers, threats: event.target.value })}/><ThinkingGuide guide={thinkingGuides[0]} open={openThinkingGuide === thinkingGuides[0].key} onToggle={() => { const opening = openThinkingGuide !== thinkingGuides[0].key; setOpenThinkingGuide(opening ? thinkingGuides[0].key : undefined); if (opening) setUsedThinkingGuides((used) => new Set(used).add(thinkingGuides[0].key)); }}/></label>
          <label>2. 有哪些将军、吃子、捉双等强制手段？<small className="u10-thinking-prompt">{thinkingGuides[1].prompt}</small><textarea aria-label="强制手段" value={answers.forcingMoves} onChange={(event) => setAnswers({ ...answers, forcingMoves: event.target.value })}/><ThinkingGuide guide={thinkingGuides[1]} open={openThinkingGuide === thinkingGuides[1].key} onToggle={() => { const opening = openThinkingGuide !== thinkingGuides[1].key; setOpenThinkingGuide(opening ? thinkingGuides[1].key : undefined); if (opening) setUsedThinkingGuides((used) => new Set(used).add(thinkingGuides[1].key)); }}/></label>
          <label>3. 己方最差的子是哪一个？<small className="u10-thinking-prompt">{thinkingGuides[2].prompt}</small><input aria-label="最差子" value={answers.worstPiece} onChange={(event) => setAnswers({ ...answers, worstPiece: event.target.value })}/><ThinkingGuide guide={thinkingGuides[2]} open={openThinkingGuide === thinkingGuides[2].key} onToggle={() => { const opening = openThinkingGuide !== thinkingGuides[2].key; setOpenThinkingGuide(opening ? thinkingGuides[2].key : undefined); if (opening) setUsedThinkingGuides((used) => new Set(used).add(thinkingGuides[2].key)); }}/></label>
          <fieldset><legend>4. 走一思三：补充候选着</legend><small>棋盘第一步是首选；建议再写 2 个备选。少于 3 个仍可提交，会标记“候选不足”。</small>{answers.candidates.slice(0, 2).map((move, index) => <input key={index} aria-label={`候选着 ${index + 1}`} placeholder={`候选 ${index + 1}，例如：炮二平五`} value={move} onChange={(event) => setAnswers({ ...answers, candidates: answers.candidates.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })}/>)}</fieldset>
          <div className="u10-chosen-summary"><strong>我的首选</strong><span>{previewSteps[0]?.notation ?? "请先在棋盘走出第一步"}</span></div>
          {candidateShortage && <p className="u10-candidate-warning">当前只有 {candidates.length} 个候选，提交后会进入“候选不足 / 候选着计算”复练。</p>}
          <label className="u10-confidence">信心 {answers.confidence}%<input type="range" min="20" max="100" step="10" value={answers.confidence} onChange={(event) => setAnswers({ ...answers, confidence: Number(event.target.value) })}/></label>
          <aside className="u10-parent-prompt"><strong>家长提问</strong><p>{relevantCards[0]?.parentPrompt ?? "让孩子先说出对方最强反击，不评价答案对错。"}</p><small>只提问，不提前透露正确着法。</small></aside>
          <button type="button" className="u10-submit" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Pikafish 核对中…" : "提交并揭示答案"}</button>
        </section> : <section className={`u10-result-panel ${resultTone(result.result.resultKind)}`}>
          <header><CheckCircle2 size={20}/><div><strong>{result.result.resultLabel} · {result.result.score} 分</strong><small>{result.result.chosenRank ? `实战首选位列 MultiPV 第 ${result.result.chosenRank}` : "首选未进入前三候选"}</small></div></header>
          <div className="u10-result-summary"><strong>{qualitativeScore(result.result.scoreCp, result.result.mate)}</strong><span>{result.result.trainingAdvice}</span>{result.result.theorySignals.length > 0 && <div className="u10-tags">{result.result.theorySignals.map((tag) => <span key={tag}>{tag}</span>)}</div>}{usedThinkingGuides.size > 0 && <small>本题使用了 {usedThinkingGuides.size} 次思路提示，不影响得分。</small>}</div>
          <section className="u10-engine-lines" aria-label="引擎候选"><header><strong>引擎候选</strong><small>核对详情：100 cp = 1.00 局面分</small></header>{result.result.lines.slice(0, 3).map((line) => <article key={line.multipv}><b>{line.multipv}</b><div><strong>{line.notation?.join(" ") || line.pv.join(" ")}</strong><small>{qualitativeScore(line.scoreCp, line.mate)}{line.scoreCp != null ? ` · ${(line.scoreCp / 100).toFixed(2)} 分（${line.scoreCp} cp）` : ""}</small></div></article>)}</section>
          <section className="u10-theory-matches"><strong>棋理解释</strong>{matchedCards.length === 0 ? <p>当前只显示参考原则，尚无足够局面证据形成确定结论。</p> : matchedCards.map((card) => <article key={card.id}><b>{card.title}</b><p>{card.summary}</p><small>证据：{card.tags.filter((tag) => result.result.theorySignals.includes(tag)).join(" / ")} · 反例：{card.counterexample}</small></article>)}</section>
          <p className="u10-flyknife-gate">本题先按普通拆棋保存。只有后续验证出明确诱导条件且达到飞刀门槛，复盘工作台才会提供“设计飞刀”。</p>
          <div className="u10-result-actions">{onSaveVariation && <button type="button" disabled={busy} onClick={() => void onSaveVariation(predictedMoves)}>保存为普通变例</button>}<button type="button" onClick={() => setTab("plan")}>进入今日训练</button><button type="button" onClick={onClose}>完成本题</button></div>
        </section>}
      </div>}
      {tab === "plan" && <section className="u10-plan-view"><header><div><strong>今日 40 分钟</strong><small>{TRAINING_METHOD_LABEL} · 每周复盘闭环</small></div><span>第 {dailyPlan?.week ?? profile.currentWeek} 周 · {dailyPlan?.phaseTitle ?? "等待生成计划"}</span></header><div className="u10-plan-timeline">{dailyPlan?.segments.map((segment, index) => <article key={segment.key}><i>{index + 1}</i><div><strong>{segment.title}<em>{segment.minutes} 分钟</em></strong><div className="u10-tags">{segment.targetTags.map((tag) => <span key={tag}>{tag}</span>)}</div>{segment.items.length === 0 ? <small>{segment.completionHint}</small> : segment.items.map((item) => <p key={`${item.taskId ?? item.title}-${item.title}`}><span>{item.source}</span>{item.title}{item.due && <b>今天到期</b>}</p>)}<small>{segment.completionHint}</small></div></article>) ?? <p>正在准备今日训练计划…</p>}</div></section>}
      {tab === "report" && <section className="u10-report-view"><header><strong>家长周报</strong><small>{weeklyReport ? `${weeklyReport.weekStart} 至 ${weeklyReport.weekEnd}` : "完成拆棋后生成趋势"}</small></header>{weeklyReport ? <><div className="u10-report-metrics"><article><b>{weeklyReport.attempts}</b><span>本周作答</span></article><article><b>{weeklyReport.averageScore ?? "--"}</b><span>平均分</span></article><article><b>{weeklyReport.hintFreeRate ?? "--"}%</b><span>无提示完成</span></article><article><b>{weeklyReport.masteredTasks}</b><span>已掌握</span></article></div><p>{weeklyReport.parentSummary}</p><aside><strong>下周重点</strong>{weeklyReport.nextFocus}</aside>{weeklyReport.weakTags.length > 0 && <div className="u10-tags">{weeklyReport.weakTags.map((tag) => <span key={tag}>{tag}</span>)}</div>}</> : <p>还没有可统计的训练作答。</p>}</section>}
      {tab === "profile" && <section className="u10-profile-view"><header><strong>U10 学习档案</strong><small>高级少年赛训练，不包含识子和基本规则启蒙。</small></header><label>孩子姓名<input value={draftProfile.childName} onChange={(event) => setDraftProfile({ ...draftProfile, childName: event.target.value })}/></label><label>当前周期<select value={draftProfile.currentWeek} onChange={(event) => setDraftProfile({ ...draftProfile, currentWeek: Number(event.target.value) })}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>第 {index + 1} 周</option>)}</select></label><div className="u10-profile-fixed"><span>水平：{profile.level}</span><span>陪练：{profile.coachMode}</span><span>训练：40 分钟</span><span>来源：60% / 40%</span></div><section className="u10-repertoire"><strong>专属武器库</strong><p>{repertoire?.note ?? "正在用学习开局库和大师棋谱归纳最近 20 盘已归档比赛棋谱。"}</p><div><article><b>先手 2-3 套</b>{(repertoire?.red.length ? repertoire.red.slice(0, 3) : [{ name: "中炮 / 仙人指路 / 飞相", games: 0 }]).map((item) => <span key={item.name}>{item.name}{item.games ? ` · ${item.games} 盘` : " · 待样本确认"}</span>)}</article><article><b>后手 2-3 套</b>{(repertoire?.black.length ? repertoire.black.slice(0, 3) : [{ name: "屏风马 / 反宫马 / 卒底炮", games: 0 }]).map((item) => <span key={item.name}>{item.name}{item.games ? ` · ${item.games} 盘` : " · 待样本确认"}</span>)}</article></div><small>同类布局参考优先取吕钦、许银川、郑惟桐等大师棋谱；v1 只做推荐和统计，不强制固定完整 repertoire。</small></section><button type="button" onClick={() => void onSaveProfile(draftProfile)}><Save size={13}/>保存学习档案</button></section>}
      <footer className="u10-footer"><Clock3 size={13}/>临时拆棋线路不会修改真实棋谱；保存变例和飞刀仍由复盘工作台单独确认。</footer>
    </section>
  </div>;
}
