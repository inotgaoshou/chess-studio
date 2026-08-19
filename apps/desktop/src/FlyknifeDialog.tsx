import { useEffect, useState } from "react";
import { BookOpen, CircleHelp, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, Play, Save, Swords, Trash2, X } from "lucide-react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { chessPlatform, type BoardState, type CloudBookCandidate, type FlyknifeCandidate, type FlyknifePlan, type FlyknifeSide, type FlyknifeStepAnnotation, type FlyknifeTemplate, type FlyknifeTopic, type Piece, type PreviewLineStep, type Side, type XqbCandidate } from "./platform";

function sideFromBoardSide(side: Side): FlyknifeSide {
  return side === "黑方" ? "black" : "red";
}

function sideFromFen(fen: string): FlyknifeSide | undefined {
  const token = fen.trim().split(/\s+/)[1];
  if (token === "b") return "black";
  if (token === "w") return "red";
  return undefined;
}

function sideLabel(side?: FlyknifeSide) {
  if (!side) return "未知方";
  return side === "black" ? "黑方" : "红方";
}

function oppositeSide(side?: FlyknifeSide): FlyknifeSide | undefined {
  if (!side) return undefined;
  return side === "black" ? "red" : "black";
}

const PIECE_KIND: Record<string, string> = { K: "king", A: "advisor", B: "elephant", E: "elephant", N: "horse", H: "horse", R: "rook", C: "cannon", P: "pawn", k: "king", a: "advisor", b: "elephant", e: "elephant", n: "horse", h: "horse", r: "rook", c: "cannon", p: "pawn" };
const PIECE_CODE: Record<string, string> = { king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p" };

function fenPieces(fen: string): Piece[] {
  const rows = fen.trim().split(/\s+/)[0]?.split("/") ?? [];
  const pieces: Piece[] = [];
  rows.forEach((rank, row) => {
    let col = 0;
    for (const token of rank ?? "") {
      if (/\d/.test(token)) col += Number(token);
      else {
        const kind = PIECE_KIND[token];
        if (kind && row < 10 && col < 9) pieces.push({ row, col, kind, color: token === token.toUpperCase() ? "red" : "black", label: "" });
        col += 1;
      }
    }
  });
  return pieces;
}

type FlyknifePreview = { candidate: FlyknifeCandidate; index: number; steps: PreviewLineStep[]; step: number };

function pgnTag(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function pgnComment(value: string) {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function moveSequence(...moves: Array<string | undefined>) {
  return moves.filter((move): move is string => Boolean(move));
}

function pgnMoveText(startingFen: string, moves: string[]) {
  const fields = startingFen.trim().split(/\s+/);
  const fullmove = Number.parseInt(fields[5] ?? "1", 10) || 1;
  const startsWithBlack = fields[1] === "b";
  const startingPly = Math.max(0, fullmove - 1) * 2 + (startsWithBlack ? 1 : 0);
  return moves.map((move, index) => {
    const ply = startingPly + index;
    const moveNo = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) return `${moveNo}. ${move}`;
    if (index === 0) return `${moveNo}... ${move}`;
    return move;
  }).join(" ");
}

function flyknifeCandidatePgn(params: {
  candidate: FlyknifeCandidate;
  index: number;
  side: FlyknifeSide;
  sourceName: string;
  startingFen: string;
  directAnalysis: boolean;
}) {
  const { candidate, index, side, sourceName, startingFen, directAnalysis } = params;
  const fullLine = moveSequence(candidate.setupMove, candidate.lureMove, ...candidate.mainline);
  const title = `${sourceName} · ${directAnalysis ? "直接拆局" : "飞刀反击"} ${index + 1}`;
  const firstMove = candidate.notation[0] ?? candidate.knifeMove;
  const score = candidate.mate != null
    ? `${sideLabel(side)}${candidate.mate > 0 ? "杀" : "被杀"}${Math.abs(candidate.mate)}`
    : candidate.scoreCp == null
      ? "无分值"
      : `${sideLabel(side)}优势 ${candidate.scoreCp > 0 ? "+" : ""}${candidate.scoreCp} cp`;
  const note = [
    `来源：${sourceName}`,
    `模式：${directAnalysis ? "直接拆当前局面" : "假设对手走子后设计飞刀"}`,
    `推荐第一手：${firstMove}`,
    `评估：${score}`,
    candidate.notation.length ? `中文主线：${candidate.notation.join(" ")}` : "",
    candidate.bestDefenseNotation.length ? `对手较强防守：${candidate.bestDefenseNotation.join(" ")}` : "",
    candidate.risk ? `备注：${candidate.risk}` : "",
  ].filter(Boolean).join("；");
  return [
    `[Event "Xiangqi Studio 飞刀实验室"]`,
    `[Site "Xiangqi Studio"]`,
    `[Title "${pgnTag(title)}"]`,
    `[Red "${side === "red" ? "飞刀方" : "防守方"}"]`,
    `[Black "${side === "black" ? "飞刀方" : "防守方"}"]`,
    `[Result "*"]`,
    `[FEN "${pgnTag(startingFen)}"]`,
    `[Format "ICCS"]`,
    "",
    `{${pgnComment(note)}} ${pgnMoveText(startingFen, fullLine)} *`,
    "",
  ].join("\n");
}

function flyknifeTriggerText(candidate: FlyknifeCandidate, side: FlyknifeSide) {
  const defender = oppositeSide(side);
  const knife = candidate.notation[0] ?? candidate.knifeMove;
  if (!candidate.lureMove) return `强招提示：现在轮到${sideLabel(side)}，建议走「${knife}」争取主动。`;
  if (candidate.setupMove) return `设局飞刀：我方先走「${candidate.setupNotation ?? candidate.setupMove}」，对方${sideLabel(defender)}若应「${candidate.lureNotation ?? candidate.lureMove}」，再以「${knife}」出刀。`;
  return `飞刀触发：对方${sideLabel(defender)}走「${candidate.lureNotation ?? candidate.lureMove}」后，我方${sideLabel(side)}以「${knife}」反击。`;
}

function candidateKind(candidate: FlyknifeCandidate) {
  if (!candidate.lureMove) return "局面强招";
  return (candidate.mate != null && candidate.mate > 0) || (candidate.scoreCp ?? Number.NEGATIVE_INFINITY) >= 100
    ? "已验证飞刀"
    : "反击候选";
}

function candidateMoveLabel(candidate: FlyknifeCandidate) {
  const kind = candidateKind(candidate);
  return kind === "已验证飞刀" ? "飞刀着法" : kind === "反击候选" ? "候选反击" : "推荐强招";
}

function candidateConditionLabel(candidate: FlyknifeCandidate) {
  return candidateKind(candidate) === "已验证飞刀" ? "中刀条件" : "假设应手";
}

function compactScoreText(candidate: FlyknifeCandidate) {
  if (candidate.mate != null) return candidate.mate > 0 ? `${Math.abs(candidate.mate)} 步杀` : "有被杀风险";
  if (candidate.scoreCp == null) return "待确认";
  return `${candidate.scoreCp >= 0 ? "+" : ""}${(candidate.scoreCp / 100).toFixed(2)} 分`;
}

function scorePoints(scoreCp?: number) {
  if (scoreCp == null) return "待确认";
  return `${scoreCp >= 0 ? "+" : ""}${(scoreCp / 100).toFixed(2)} 分`;
}

function flyknifeEngineChangeText(candidate: FlyknifeCandidate) {
  if (candidate.baselineScoreCp == null || candidate.scoreCp == null) return "本线未建立对方应手前的引擎基准。";
  const swing = candidate.swingCp ?? candidate.scoreCp - candidate.baselineScoreCp;
  return `对方应手前 ${scorePoints(candidate.baselineScoreCp)} → 出刀后 ${scorePoints(candidate.scoreCp)}，我方变化 ${swing >= 0 ? "+" : ""}${(swing / 100).toFixed(2)} 分。`;
}

function flyknifeCloudContext(candidate: FlyknifeCandidate, cloudCandidates: CloudBookCandidate[]) {
  if (!candidate.lureMove) return "云库：本方案没有指定对方应手，因此不比较云库。";
  const selected = cloudCandidates.find((item) => item.iccs === candidate.lureMove);
  if (!selected) return "云库：该应手不在当前已查询结果中；可在云库面板确认其频率。";
  const preferred = cloudCandidates[0];
  const gap = preferred ? Math.max(0, preferred.score - selected.score) : 0;
  const winRate = selected.winRate == null ? "" : `，胜率 ${selected.winRate.toFixed(1)}%`;
  const rank = selected.rank == null ? "" : `，排序 ${selected.rank}`;
  const againstBest = gap > 0 ? `，较云库首选少 ${gap} 库分` : "，为云库首选";
  return `云库：${selected.notation}，库分 ${selected.score}${rank}${winRate}${againstBest}。库分反映实战库排序，不等同引擎局面分。`;
}

function flyknifeIntentText(candidate: FlyknifeCandidate) {
  if (!candidate.lureMove) return "这是当前局面的推荐强招，不含对手误应的预埋条件，因此不是飞刀。";
  if (candidateKind(candidate) !== "已验证飞刀") return "这条反击线尚未达到明显优势或杀势门槛；它可作研究候选，但不能当作实战飞刀。";
  const defense = candidate.notation[1] ?? candidate.bestDefenseNotation[0];
  const continuation = candidate.notation.slice(2, 4).join(" → ");
  return defense
    ? `用意验证：出刀后，引擎主变中的优先防守是「${defense}」${continuation ? `；我方后续为「${continuation}」` : ""}。这说明对方原计划需要被迫应对，但仍应结合最佳防守复核。`
    : "引擎确认该出刀后形成明显优势；当前深度尚未给出可读的对手应对主变，请提高深度复核。";
}

function flyknifeScoreText(candidate: FlyknifeCandidate, side: FlyknifeSide) {
  if (candidate.mate != null) {
    return candidate.mate > 0
      ? `${sideLabel(side)}杀 ${Math.abs(candidate.mate)} 步`
      : `${sideLabel(side)}有被杀风险`;
  }
  if (candidate.scoreCp == null) return "分值待引擎确认";
  const points = candidate.scoreCp / 100;
  const sign = points > 0 ? "+" : "";
  return `${sideLabel(side)}优势 ${sign}${points.toFixed(2)} 分`;
}

function flyknifeOutcomeText(candidate: FlyknifeCandidate, side: FlyknifeSide) {
  if (candidate.mate != null) return candidate.mate > 0 ? `结果：${sideLabel(side)}形成杀势，${Math.abs(candidate.mate)} 步内可杀。` : `结果：${sideLabel(side)}存在被杀风险，需优先核对最佳防守。`;
  if (candidate.scoreCp != null) return `结果：${flyknifeScoreText(candidate, side)}（引擎原始评估 ${candidate.scoreCp > 0 ? "+" : ""}${candidate.scoreCp} cp）。`;
  return "结果：引擎未给出稳定分值，请结合最佳防守复核。";
}

const flyknifeRoleLabel: Record<FlyknifeStepAnnotation["role"], string> = {
  setup: "设局",
  lure: "中刀条件",
  knife: "飞刀",
  bestDefense: "最佳防守",
};

function candidateAnnotations(candidate: FlyknifeCandidate): FlyknifeStepAnnotation[] {
  if (candidate.annotations?.length) return candidate.annotations;
  const annotations: FlyknifeStepAnnotation[] = [];
  if (candidate.setupMove) annotations.push({ role: "setup", iccs: candidate.setupMove, notation: candidate.setupNotation ?? candidate.setupMove, side: "红方", intent: "先完成设局，等待对方出现预定应手。" });
  if (candidate.lureMove) annotations.push({ role: "lure", iccs: candidate.lureMove, notation: candidate.lureNotation ?? candidate.lureMove, side: "黑方", intent: "这是中刀条件；对方走出这步后才进入反击局面。" });
  annotations.push({ role: "knife", iccs: candidate.knifeMove, notation: candidate.notation[0] ?? candidate.knifeMove, side: "红方", scoreCp: candidate.scoreCp, swingCp: candidate.swingCp, intent: flyknifeIntentText(candidate) });
  if (candidate.bestDefense.length) annotations.push({ role: "bestDefense", iccs: candidate.bestDefense[0], notation: candidate.bestDefenseNotation[0] ?? candidate.bestDefense[0], side: "黑方", intent: "这是对方较强防守，用来验证该方案并非只针对单一误应。" });
  return annotations;
}

type Props = {
  currentFen: string;
  currentSideToMove: Side;
  cloudCandidates: CloudBookCandidate[];
  xqbCandidates: XqbCandidate[];
  enginePath: string;
  threads: number;
  hashMb: number;
  searchMode: "time" | "depth" | "nodes";
  searchValue: number;
  onClose(): void;
  onPlanSaved(plan: FlyknifePlan): void;
  onPractice(plan: FlyknifePlan): void;
  onTopicOpened(next: Partial<BoardState>, topic: FlyknifeTopic): void;
};

export function FlyknifeDialog({ currentFen, currentSideToMove, cloudCandidates, xqbCandidates, enginePath, threads, hashMb, searchMode, searchValue, onClose, onPlanSaved, onPractice, onTopicOpened }: Props) {
  const [templates, setTemplates] = useState<FlyknifeTemplate[]>([]);
  const [topics, setTopics] = useState<FlyknifeTopic[]>([]);
  const [plans, setPlans] = useState<FlyknifePlan[]>([]);
  const [tab, setTab] = useState<"topics" | "lab" | "saved">("topics");
  const [template, setTemplate] = useState<FlyknifeTemplate>();
  const [source, setSource] = useState<"current" | "template" | "custom">("current");
  const [customName, setCustomName] = useState("");
  const [customFen, setCustomFen] = useState("");
  const [side, setSide] = useState<FlyknifeSide>(() => sideFromBoardSide(currentSideToMove));
  const [designMode, setDesignMode] = useState<"direct" | "response">("direct");
  const [setupMove, setSetupMove] = useState("");
  const [lureMove, setLureMove] = useState("");
  const [candidates, setCandidates] = useState<FlyknifeCandidate[]>([]);
  const [annotationEdits, setAnnotationEdits] = useState<Record<string, string>>({});
  const [annotationEditors, setAnnotationEditors] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<FlyknifePreview>();
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [notice, setNotice] = useState("用法：不填第 ③ 步就是直接拆当前局面；填一步就是先假设对手这么走，再找反击飞刀。");

  const startingFen = source === "template" ? template?.fen ?? currentFen : source === "custom" ? customFen.trim() : currentFen;
  const sourceName = source === "template" ? template?.name ?? "布局模板" : source === "custom" ? customName.trim() || "自定义布局" : "当前棋谱节点";
  const startingSide = sideFromFen(startingFen) ?? (source === "current" ? sideFromBoardSide(currentSideToMove) : undefined);
  const directAnalysis = designMode === "direct";
  const needsSetup = !directAnalysis && side === startingSide;
  const lureSide = needsSetup ? oppositeSide(side) ?? startingSide : startingSide;
  const canGenerate = !busy && Boolean(startingFen.trim()) && (directAnalysis || (Boolean(lureMove.trim()) && (!needsSetup || Boolean(setupMove.trim()))));
  const actionLabel = directAnalysis ? `直接拆当前局面：找${sideLabel(side)}强招` : `按假设生成${sideLabel(side)}飞刀`;
  const previewStep = preview && preview.step > 0 ? preview.steps[preview.step - 1] : undefined;
  const previewFen = previewStep?.fen ?? startingFen;
  const knifePreviewStep = preview ? (preview.candidate.setupMove ? 3 : preview.candidate.lureMove ? 2 : 1) : 0;
  const knifeNotation = preview?.candidate.notation[0] ?? preview?.candidate.knifeMove;
  const previewMoveBadge = preview ? candidateMoveLabel(preview.candidate) : "";
  const previewAnnotation = preview && previewStep
    ? candidateAnnotations(preview.candidate).find((item) => item.iccs === moveSequence(preview.candidate.setupMove, preview.candidate.lureMove, ...preview.candidate.mainline)[preview.step - 1])
    : undefined;

  useEffect(() => {
    void chessPlatform.listFlyknifeTemplates().then(setTemplates);
    void chessPlatform.listFlyknifeTopics().then(setTopics);
    void chessPlatform.listFlyknifePlans().then(setPlans);
  }, []);

  async function generate() {
    if (!canGenerate) return;
    const requestLureMove = directAnalysis ? "" : lureMove.trim();
    const requestSetupMove = directAnalysis ? "" : setupMove.trim();
    setBusy(true);
    setNotice(directAnalysis ? "Pikafish 正在直接拆当前局面…" : "Pikafish 正在验证假设后的反击…");
    try {
      const rows = await chessPlatform.generateFlyknifeCandidates({ startingFen, side, setupMove: requestSetupMove, lureMove: requestLureMove, enginePath, threads, hashMb, searchMode, searchValue });
      setCandidates(rows);
      setAnnotationEdits({});
      setAnnotationEditors({});
      setNotice(rows.length ? "已生成候选。第一手就是建议出刀着法；可保存为练习方案，也可回到棋盘继续深拆。" : "未找到候选，请换一个诱导着或提高分析深度。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openTrapLab() {
    const defender = oppositeSide(startingSide);
    setTab("lab");
    setDesignMode("response");
    if (defender) setSide(defender);
    setSetupMove("");
    setLureMove("");
    setCandidates([]);
    setPreview(undefined);
    setNotice("请填写对方下一步可能会走的棋。生成后会明确显示中刀条件、飞刀着法、分值和最佳防守。");
  }

  function chooseSide(nextSide: FlyknifeSide) {
    if (directAnalysis && nextSide !== startingSide) setDesignMode("response");
    setSide(nextSide);
    setSetupMove("");
    setLureMove("");
    setCandidates([]);
    setPreview(undefined);
  }

  function annotationKey(index: number, role: FlyknifeStepAnnotation["role"]) {
    return `${index}:${role}`;
  }

  function editedAnnotations(candidate: FlyknifeCandidate, index: number) {
    return candidateAnnotations(candidate).map((annotation) => ({
      ...annotation,
      note: annotationEdits[annotationKey(index, annotation.role)]?.trim() || annotation.note,
    }));
  }

  async function save(candidate: FlyknifeCandidate, index: number) {
    const plan: FlyknifePlan = {
      title: `${sourceName} · ${side === "red" ? "红方" : "黑方"}${candidateKind(candidate) === "已验证飞刀" ? "飞刀" : "研究候选"}`,
      side,
      startingFen,
      templateId: source === "template" ? template?.id : undefined,
      templateName: sourceName,
      lureMove: candidate.lureMove,
      knifeMove: candidate.knifeMove,
      mainline: moveSequence(candidate.setupMove, candidate.lureMove, ...candidate.mainline),
      bestDefense: candidate.bestDefense,
      scoreCp: candidate.scoreCp,
      mate: candidate.mate,
      risk: candidate.risk,
      note: "由飞刀实验室生成；保存前请复核最佳防守。",
      annotations: editedAnnotations(candidate, index),
    };
    try {
      const saved = await chessPlatform.saveFlyknifePlan(plan);
      setPlans((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      onPlanSaved(saved);
      setNotice("已保存到飞刀库；若起始局面就是当前棋谱节点，主线已作为变例附加到该节点。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveStartingPosition() {
    const plan: FlyknifePlan = {
      title: `${sourceName} · ${sideLabel(side)}飞刀起步局面`, side, startingFen,
      templateId: source === "template" ? template?.id : undefined, templateName: sourceName,
      lureMove: "", knifeMove: "", mainline: [], bestDefense: [],
      risk: "起步局面：尚未生成飞刀主线。",
      note: "保存为飞刀起步局面，可从此处继续设计、练习或分析。",
      annotations: [],
    };
    try {
      const saved = await chessPlatform.saveFlyknifePlan(plan);
      setPlans((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      onPlanSaved(saved);
      setNotice("已保存起步局面。它不会改动当前棋谱，可在“已保存”中从此局面继续练习。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function openPreview(candidate: FlyknifeCandidate, index: number) {
    const moves = moveSequence(candidate.setupMove, candidate.lureMove, ...candidate.mainline);
    if (!moves.length) return;
    setNotice("正在生成飞刀线路预览…");
    try {
      const steps = await chessPlatform.previewLine(startingFen, moves);
      setPreview({ candidate, index, steps, step: 0 });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function exportCandidate(candidate: FlyknifeCandidate, index: number) {
    const firstMove = candidate.notation[0] ?? candidate.knifeMove;
    const title = `${sourceName}-${directAnalysis ? "直接拆局" : "飞刀反击"}-${index + 1}-${firstMove}`;
    const contents = flyknifeCandidatePgn({
      candidate,
      index,
      side,
      sourceName,
      startingFen,
      directAnalysis,
    });
    try {
      const path = await chessPlatform.exportTextFile(title, contents, "pgn", "PGN 棋谱");
      setNotice(path ? `已导出棋谱：${path.split(/[\\/]/).at(-1)}` : "已取消导出棋谱");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function openTopic(topic: FlyknifeTopic) {
    setBusy(true);
    setNotice(`正在打开专题：${topic.title}`);
    try {
      const next = await chessPlatform.openFlyknifeTopic(topic.id);
      onTopicOpened(next, topic);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openTopicSource(topic: FlyknifeTopic) {
    setNotice(`正在用系统浏览器打开来源：${topic.title}`);
    try {
      await chessPlatform.openExternalUrl(topic.source);
      setNotice("已交给系统浏览器打开来源页面。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="flyknife-dialog" role="dialog" aria-modal="true" aria-labelledby="flyknife-title">
      <header>
        <span><Swords size={18}/><strong id="flyknife-title">飞刀库 / 专题库</strong></span>
        <div className="flyknife-header-actions">
          <button className="tool-button flyknife-definition-toggle" aria-expanded={definitionOpen} title="查看飞刀定义" onClick={() => setDefinitionOpen((open) => !open)}><CircleHelp size={16}/><span>飞刀定义</span></button>
          <button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button>
        </div>
      </header>
      <div className="flyknife-body">
        {definitionOpen && <section className="flyknife-definition" aria-label="飞刀定义说明">
          <header><strong>飞刀不是单纯的好棋</strong><small>它是预先设计、针对对方常见误应的反击方案。</small></header>
          <ol>
            <li><b>起点</b><span>从明确局面开始；红方先设局时，会先走一手“预埋第一手”。</span></li>
            <li><b>条件</b><span>指定对方可能但不精确的一步。这是“中刀条件”，不是强迫对方一定会走。</span></li>
            <li><b>出刀</b><span>我方在该条件成立后走出的关键反击。软件会展示这步与后续主变。</span></li>
            <li><b>验证</b><span>引擎须给出至少 +1.00 分的明显优势或杀势，并同时列出对方最佳防守与风险。</span></li>
          </ol>
          <div className="flyknife-definition-result"><span><b>已验证飞刀</b>：满足条件与优势门槛。</span><span><b>反击候选</b>：有条件但优势不足，供继续研究。</span><span><b>局面强招</b>：没有对方误应条件，只是推荐走法。</span></div>
        </section>}
        <nav className="flyknife-tabs" aria-label="飞刀库分页">
          <button className={tab === "topics" ? "active" : ""} onClick={() => setTab("topics")}><BookOpen size={14}/>专题库</button>
          <button className={tab === "lab" ? "active" : ""} onClick={() => setTab("lab")}><Swords size={14}/>实验室</button>
          <button className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}><Save size={14}/>已保存</button>
        </nav>

        {tab === "topics" && <section className="flyknife-topics" aria-label="内置飞刀专题库">
          <div className="flyknife-intro">
            <strong>内置参考专题</strong>
            <small>这里收录的是布局陷阱参考主线，不等同于“已验证飞刀”。真正的飞刀点、对方误应、关键反击、局面分与最佳防守，必须在打开棋谱后由 Pikafish 验证。</small>
            <button type="button" className="primary" onClick={openTrapLab}><Swords size={14}/>立即设计飞刀</button>
          </div>
          {topics.map((topic) => <article key={topic.id}>
            <div>
              <strong>{topic.title}</strong>
              <small>{topic.opening} · {topic.category} · {topic.moveCount} 回合</small>
              <p className="flyknife-topic-explainer"><b>参考主线，待验证</b><span>打开后选择对方可能应手，再由实验室标出我方出刀着法、分值变化和最佳防守。</span></p>
            </div>
            <div className="flyknife-topic-actions">
              <button type="button" onClick={() => void openTopicSource(topic)}><ExternalLink size={13}/>来源</button>
              <button disabled={busy} onClick={() => void openTopic(topic)}><Play size={14}/>打开并验证</button>
            </div>
          </article>)}
          <p className="flyknife-notice" aria-live="polite">{notice}</p>
          {topics.length === 0 && <p className="flyknife-notice">暂无内置专题；可先用实验室从当前局面生成飞刀方案。</p>}
        </section>}

        {tab === "lab" && <>
          <div className="flyknife-config">
            <label>① 从哪里开始
              <select value={source === "template" ? template?.id ?? "current" : source} onChange={(event) => {
                const value = event.target.value;
                if (value === "current" || value === "custom") {
                  setSource(value);
                  if (value === "current") setSide(sideFromBoardSide(currentSideToMove));
                } else {
                  const nextTemplate = templates.find((item) => item.id === value);
                  setTemplate(nextTemplate);
                  setSide(sideFromFen(nextTemplate?.fen ?? "") ?? side);
                  setSource("template");
                }
                setDesignMode("direct");
                setSetupMove("");
                setLureMove("");
                setCandidates([]);
              }}>
                <option value="current">当前棋谱节点</option>
                {templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                <option value="custom">自定义布局（必须填写 FEN）</option>
              </select>
            </label>
            <fieldset className="flyknife-side-picker"><legend>② 帮哪方找强招</legend><div role="group" aria-label="飞刀执方">
              <button type="button" className={side === "red" ? "active red" : "red"} aria-pressed={side === "red"} onClick={() => chooseSide("red")}>红方</button>
              <button type="button" className={side === "black" ? "active black" : "black"} aria-pressed={side === "black"} onClick={() => chooseSide("black")}>黑方</button>
            </div></fieldset>
          </div>
          <div className="flyknife-lab-mode" role="group" aria-label="飞刀实验室模式">
            <button className={directAnalysis ? "active" : ""} onClick={() => { setDesignMode("direct"); setSetupMove(""); setLureMove(""); setCandidates([]); setPreview(undefined); if (startingSide) setSide(startingSide); }}>
              <strong>只拆当前局面</strong>
              <small>不管下面输入框残留什么，都直接找当前轮走方强招</small>
            </button>
            <button className={!directAnalysis ? "active" : ""} onClick={() => { setDesignMode("response"); setSetupMove(""); setLureMove(""); setCandidates([]); setPreview(undefined); const nextSide = oppositeSide(startingSide); if (nextSide) setSide(nextSide); }}>
              <strong>设计飞刀/反击</strong>
              <small>先假设当前轮走方走一步，再找另一方反击</small>
            </button>
          </div>
          <div className={`flyknife-flow ${directAnalysis ? "direct" : "lure"}`}>
            <strong>已套用：{sourceName} · 现在轮到{sideLabel(startingSide)}</strong>
            <span>{directAnalysis
              ? `当前是“只拆”模式：点按钮会直接找${sideLabel(startingSide)}当前最强走法，不会使用任何假设走法。`
              : needsSetup
                ? `当前是“红黑设局”模式：先填${sideLabel(side)}的预埋第一手，再填${sideLabel(lureSide)}的常见应手，软件寻找${sideLabel(side)}的出刀反击。`
                : `当前是“设计飞刀”模式：请填一手${sideLabel(lureSide)}可能会走的棋，软件会先走这步，再找${sideLabel(side)}反击。`}</span>
          </div>
          {source === "custom" && <div className="flyknife-custom">
            <label>布局名称<input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="例如：自拟中炮变例" /></label>
            <label>起始 FEN<input value={customFen} onChange={(event) => setCustomFen(event.target.value)} placeholder="必须填写完整合法 FEN" /></label>
          </div>}
          {!directAnalysis && <>
            {needsSetup && <label>③ 必填：{sideLabel(side)}预埋第一手<input value={setupMove} onChange={(event) => setSetupMove(event.target.value)} placeholder={`先走一手设局，例如：炮二平五；坐标着法也支持`} /></label>}
            <label>{needsSetup ? "④" : "③"} 必填：假设{sideLabel(lureSide)}下一步<input value={lureMove} onChange={(event) => setLureMove(event.target.value)} placeholder="直接填中文，例如：兵三进一、马8进7；坐标着法也支持" /></label>
            {!needsSetup && cloudCandidates.length > 0 && <div className="flyknife-cloud"><small>可直接点一个常见应手填入</small>{cloudCandidates.slice(0, 5).map((item) => <button key={item.iccs} onClick={() => setLureMove(item.notation || item.iccs)}>{item.notation} <small>{item.score > 0 ? `库分 +${item.score}` : `库分 ${item.score}`}</small></button>)}</div>}
            {!needsSetup && xqbCandidates.length > 0 && <div className="flyknife-cloud"><small>本地 XQB 候选</small>{xqbCandidates.slice(0, 5).map((item) => <button key={`xqb-${item.iccs}`} onClick={() => setLureMove(item.iccs)}>{item.notation} <small>胜率 {Math.round((item.winRate ?? 0) * 100)}%</small></button>)}</div>}
          </>}
          <button className="primary flyknife-generate" disabled={!canGenerate} onClick={() => void generate()}><Swords size={15}/>{busy ? "Pikafish 计算中…" : actionLabel}</button>
          <div className="flyknife-start-actions"><span>还没有具体变例？</span><button disabled={busy || !startingFen.trim()} onClick={() => void saveStartingPosition()}><Save size={14}/>保存起步局面</button></div>
          <p className="flyknife-notice">{notice}</p>
          {!preview && <section className="flyknife-candidates">
            <h3>生成结果 <small>第一步就是推荐着法</small></h3>
            {candidates.length === 0 && <p className="flyknife-empty">{directAnalysis ? "还没有结果。点上面的“直接拆当前局面”即可，不需要填写任何假设走法。" : "还没有结果。先填第 ③ 步的假设走法，再生成反击飞刀。"}</p>}
            {candidates.map((candidate, index) => <article key={`${candidate.knifeMove}-${index}`}>
              <header>
                <strong>{candidateKind(candidate)} · 方案 {index + 1}</strong>
                <span>{flyknifeScoreText(candidate, side)}</span>
              </header>
              <div className={`flyknife-steps ${candidate.lureMove ? "" : "direct"}`}>
                {candidate.setupMove && <div className="setup"><small>1. 我方预埋</small><strong>先走「{candidate.setupNotation ?? candidate.setupMove}」</strong></div>}
                {candidate.lureMove && <div className="lure"><small>{candidate.setupMove ? "2" : "1"}. 对方{candidateConditionLabel(candidate)}</small><strong>对方走「{candidate.lureNotation ?? candidate.lureMove}」</strong></div>}
                <div className="knife"><small>{candidate.lureMove ? `${candidate.setupMove ? "3" : "2"}. 我方${candidateMoveLabel(candidate)}` : "我方推荐强招"}</small><strong>{candidate.notation[0] ?? candidate.knifeMove}</strong></div>
                <div className="outcome"><small>{candidate.setupMove ? "4" : candidate.lureMove ? "3" : "2"}. 预期效果</small><strong>{candidate.mate != null ? flyknifeScoreText(candidate, side) : `优势 ${candidate.scoreCp == null ? "待确认" : `${candidate.scoreCp >= 0 ? "+" : ""}${(candidate.scoreCp / 100).toFixed(2)} 分`}`}</strong></div>
              </div>
              <div className="flyknife-trigger"><strong>{flyknifeTriggerText(candidate, side)}</strong><small>{flyknifeOutcomeText(candidate, side)}</small></div>
              <div className="flyknife-evidence"><small>引擎验证</small><p>{flyknifeEngineChangeText(candidate)}</p><small>云库实战信息</small><p>{flyknifeCloudContext(candidate, cloudCandidates)}</p></div>
              <div className="flyknife-intent"><small>这步的用意</small><p>{flyknifeIntentText(candidate)}</p></div>
              <details className="flyknife-step-annotations" open={Boolean(annotationEditors[index])} onToggle={(event) => { const open = event.currentTarget.open; setAnnotationEditors((items) => ({ ...items, [index]: open })); }}>
                <summary>查看并编辑关键步骤说明</summary>
                {annotationEditors[index] && candidateAnnotations(candidate).map((annotation) => {
                  const key = annotationKey(index, annotation.role);
                  return <label key={key} className={`flyknife-step-note ${annotation.role}`}>
                    <span><b>{flyknifeRoleLabel[annotation.role]}</b><strong>{annotation.notation}</strong>{annotation.scoreCp != null && <em>{annotation.scoreCp >= 0 ? "+" : ""}{(annotation.scoreCp / 100).toFixed(2)} 分</em>}</span>
                    <textarea value={annotationEdits[key] ?? annotation.note ?? annotation.intent} onChange={(event) => setAnnotationEdits((items) => ({ ...items, [key]: event.target.value }))} aria-label={`${flyknifeRoleLabel[annotation.role]}说明`} rows={2}/>
                  </label>;
                })}
              </details>
              <details className="flyknife-reference-line"><summary>查看预埋变化与最佳防守</summary><p>{candidate.notation.length ? candidate.notation.join(" ") : candidate.mainline.join(" ")}</p><small>对手较强防守：{candidate.bestDefenseNotation.join(" ") || "引擎未给出后续"} · 风险：{candidate.risk}</small></details>
              <div className="flyknife-candidate-actions">
                <button onClick={() => void openPreview(candidate, index)}><Eye size={14}/>预览</button>
                <button onClick={() => void exportCandidate(candidate, index)}><Download size={14}/>导出棋谱</button>
                <button onClick={() => void save(candidate, index)}><Save size={14}/>{candidateKind(candidate) === "已验证飞刀" ? "保存飞刀" : "保存研究"}</button>
              </div>
            </article>)}
          </section>}
        </>}

        {tab === "saved" && <section className="flyknife-library"><h3>已保存飞刀库</h3>{plans.map((plan) => <article key={plan.id}><strong>{plan.title}</strong><small>{plan.side === "red" ? "红方" : "黑方"} · {plan.mainline.length === 0 ? "起步局面" : plan.risk}</small><div><button onClick={() => onPractice(plan)}><Play size={14}/>{plan.mainline.length === 0 ? "从此局面开始" : "练习"}</button><button onClick={() => plan.id && void chessPlatform.deleteFlyknifePlan(plan.id).then(() => setPlans((items) => items.filter((item) => item.id !== plan.id)))}><Trash2 size={14}/>删除</button></div></article>)}{plans.length === 0 && <p className="flyknife-notice">暂无保存方案。可以在“实验室”用云库诱导着 + Pikafish 生成后保存。</p>}</section>}
      </div>
      {preview && <section className="flyknife-preview" aria-label="飞刀预览">
        <header><span><Eye size={15}/><strong>{candidateKind(preview.candidate)}预演 · 方案 {preview.index + 1}</strong><em>{candidateMoveLabel(preview.candidate)}：{knifeNotation}</em></span><button className="tool-button" title="返回推荐方案" onClick={() => setPreview(undefined)}><X size={15}/></button></header>
        <div className="flyknife-preview-content">
          <div className="flyknife-preview-board"><LinkMiniBoard presentation="preview" pieces={fenPieces(previewFen)} arrows={[]} lastMove={previewStep ? { from: previewStep.from, to: previewStep.to, notation: previewStep.notation, movedBy: previewStep.movedBy } : undefined} sideToMove={previewFen.split(/\s+/)[1] === "b" ? "黑方" : "红方"} pieceAsset={(piece) => `/skins/default/${piece.color === "red" ? "r" : "b"}${PIECE_CODE[piece.kind] ?? "p"}.png`}/></div>
          <div className="flyknife-preview-line">
            <strong>{preview.step === 0 ? "线路起点" : `${previewStep?.movedBy}第 ${preview.step} 步：${previewStep?.notation}`}</strong>
            <div className="flyknife-preview-explainer">
              {preview.candidate.setupMove && <span><small>预埋第一手</small><strong>{preview.candidate.setupNotation ?? preview.candidate.setupMove}</strong></span>}
              {preview.candidate.lureMove && <span><small>{candidateConditionLabel(preview.candidate)}</small><strong>对方走「{preview.candidate.lureNotation ?? preview.candidate.lureMove}」</strong></span>}
              <span className="knife"><small>{candidateMoveLabel(preview.candidate)}</small><strong>{knifeNotation}</strong></span>
              <span><small>引擎分值</small><strong>{compactScoreText(preview.candidate)}</strong></span>
            </div>
            <small>{preview.step === knifePreviewStep ? `当前正在查看${previewMoveBadge}「${knifeNotation}」，棋盘已用箭头标出。` : `${previewMoveBadge}是第 ${knifePreviewStep} 步「${knifeNotation}」，可点下方高亮步骤直接查看。`}</small>
            <p className="flyknife-preview-intent"><b>{previewAnnotation ? `${flyknifeRoleLabel[previewAnnotation.role]}的意图：` : "这步的用意："}</b>{previewAnnotation?.note || previewAnnotation?.intent || flyknifeIntentText(preview.candidate)}</p>
            <div className="flyknife-preview-timeline" role="group" aria-label="飞刀变化步骤"><button className={preview.step === 0 ? "active" : ""} onClick={() => setPreview((item) => item && { ...item, step: 0 })}>起始</button>{preview.steps.map((step, index) => <button key={`${step.notation}-${index}`} className={`${preview.step === index + 1 ? "active" : ""} ${knifePreviewStep === index + 1 ? "knife" : ""}`} onClick={() => setPreview((item) => item && { ...item, step: index + 1 })}>{index + 1}. {step.notation}{knifePreviewStep === index + 1 ? ` · ${previewMoveBadge}` : ""}</button>)}</div>
            <div><button disabled={preview.step === 0} onClick={() => setPreview((item) => item && { ...item, step: item.step - 1 })}><ChevronLeft size={15}/>上一步</button><button disabled={preview.step >= preview.steps.length} onClick={() => setPreview((item) => item && { ...item, step: item.step + 1 })}>下一步<ChevronRight size={15}/></button></div>
          </div>
        </div>
      </section>}
    </section>
  </div>;
}
