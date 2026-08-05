import { reportMovePhase } from "./analysisView";
import type { AnalysisLine, Piece, ReportPhase, Side } from "./platform";

export type TheorySource = {
  label: "赵鑫鑫开局总论" | "赵鑫鑫课程" | "赵鑫鑫棋理三部曲" | "通用棋理";
  course?: string;
  episode?: string;
  timecode?: string;
  book?: string;
  pageStart?: number;
  pageEnd?: number;
  review: "已确认";
};

export type TheoryPrincipleCard = {
  id: string;
  phase: ReportPhase | "all";
  title: string;
  summary: string;
  appliesWhen: string;
  risk: string;
  tags?: string[];
  engineCorrelations?: string[];
  matchPenalty?: number;
  needsRecheck?: boolean;
  source: TheorySource;
};

export type EngineValidationStatus = "theory" | "analyzing" | "supported" | "conflicted" | "insufficient";

export type StrategyInsight = {
  phase: ReportPhase;
  phaseLabel: string;
  facts: string[];
  principles: TheoryPrincipleCard[];
  plan: { goal: string; guard: string; verify: string };
  stageGuides: Record<ReportPhase, { goal: string; guard: string; verify: string; principles: TheoryPrincipleCard[] }>;
  engine: { status: EngineValidationStatus; label: string; text: string; pv: string[]; scoreText?: string; depth?: number };
  compact: { conclusion: string; risk: string; principleTitle: string };
};

export type StrategyInsightInput = {
  sideToMove: Side;
  ply: number;
  pieces: Piece[];
  history: string[];
  phase?: ReportPhase;
  currentBranchCount?: number;
  openingName?: string;
  analysis?: AnalysisLine;
  analysisBusy?: boolean;
  analysisStale?: boolean;
  engineName?: string;
  courseCards?: TheoryPrincipleCard[];
  studyTags?: string[];
};

const labels: Record<ReportPhase, string> = { opening: "开局", middle: "中局", endgame: "残局" };
const values: Record<string, number> = { rook: 9, horse: 4, cannon: 4, elephant: 2, advisor: 2, pawn: 1, king: 0 };

/** Only short, reviewed summaries are shipped. Course media and transcripts stay local. */
export const THEORY_PRINCIPLE_CARDS: TheoryPrincipleCard[] = [
  {
    id: "zhao-learning-endgame-first", phase: "all", title: "先残局后开局", summary: "先掌握基本杀法和实用残局，再回头理解布局目标。它用于安排学习路径，不用来给当前着法打分。", appliesWhen: "复盘发现开局背得出变化，却无法处理交换后的局面时。", risk: "不能把学习顺序误当成当前局面优劣。", source: { label: "赵鑫鑫开局总论", review: "已确认" },
  },
  {
    id: "zhao-understanding-over-memory", phase: "opening", title: "重理解轻记忆", summary: "先说明布局目标、子力协调、兵线与反击条件，再讨论具体定式。", appliesWhen: "开局尚未形成明确的子力联动，或准备进入不熟悉变例时。", risk: "只记招法不看对方反击，容易在变招后失去计划。", source: { label: "赵鑫鑫开局总论", review: "已确认" },
  },
  {
    id: "zhao-adversity", phase: "all", title: "逆境成长", summary: "局面不利时先识别对手主动权，建立防守候选和可行反击目标；不把逆境直接等同于败势。", appliesWhen: "引擎或局面事实提示一方受压、计划受阻时。", risk: "急于反击而忽略直接将军、吃子与兑子威胁。", source: { label: "赵鑫鑫开局总论", review: "已确认" },
  },
  {
    id: "zhao-dao-fa-shu", phase: "all", title: "道 / 法 / 术", summary: "道是战略目标，法是适用原则，术是当前候选着与变招验证。", appliesWhen: "需要把抽象计划落实到一两条可核验候选线时。", risk: "没有具体计算的战略口号不能替代着法验证。", source: { label: "赵鑫鑫开局总论", review: "已确认" },
  },
  {
    id: "generic-middle-force", phase: "middle", title: "谋势与线路控制", summary: "先判断哪条车路、中路或肋道可被控制，再组织局部以多打少。", appliesWhen: "双方主力接触、存在可争夺线路或局部弱点时。", risk: "子力未到位就强攻，会给对手反先。", source: { label: "通用棋理", review: "已确认" },
  },
  {
    id: "generic-endgame-efficiency", phase: "endgame", title: "兵卒效率与将位", summary: "比较兵卒推进、将位灵活、牵制和拦截后的实际胜和负条件。", appliesWhen: "子力简化或需要通过交换判断残局结果时。", risk: "只数子力而忽视兵形与将位，容易误判。", source: { label: "通用棋理", review: "已确认" },
  },
];

function materialOf(pieces: Piece[]) {
  return pieces.reduce((total, piece) => total + (values[piece.kind] ?? 0), 0);
}

function phaseCards(phase: ReportPhase) {
  return THEORY_PRINCIPLE_CARDS.filter((card) => card.phase === "all" || card.phase === phase)
    .filter((card) => card.id !== "zhao-learning-endgame-first");
}

function prioritizeStudyCards(cards: TheoryPrincipleCard[], tags: string[]) {
  const normalizedTags = tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean);
  const score = (card: TheoryPrincipleCard) => {
    const haystack = `${card.title} ${card.summary} ${card.appliesWhen} ${card.risk} ${(card.tags ?? []).join(" ")}`.toLocaleLowerCase();
    const tagHits = normalizedTags.filter((tag) => haystack.includes(tag)).length;
    const penalty = card.matchPenalty ?? 0;
    return tagHits * 10 - penalty * 3 - (card.needsRecheck ? 4 : 0);
  };
  return cards.slice().sort((left, right) => score(right) - score(left));
}

function phasePlan(phase: ReportPhase, side: Side) {
  if (phase === "opening") return {
    goal: `${side}优先完成车、马、炮的协调，并把兵线或中路控制转化为可进入的线路。`,
    guard: "防范对方借中路、底线或活跃车马抢先；兵线推进前先确认后续子力能跟上。",
    verify: "核验：哪一路可先出子并限制对方反击？第一候选是否同时改善协调和将帅安全？",
  };
  if (phase === "middle") return {
    goal: `${side}争取控制关键线路，在局部形成以多打少后再组织进攻或反击。`,
    guard: "防范对方的直接将军、吃子、兑子和抢占先手，避免单子突进。",
    verify: "核验：进攻子力是否足数、对手有无先手反击、交换后优势是否仍可保持？",
  };
  return {
    goal: `${side}以兵卒效率、将位和关键子力位置为核心，争取可计算的胜和条件。`,
    guard: "防范对方兵卒抢先、牵制与拦截；不要只按子力数量判断残局。",
    verify: "核验：交换后兵形、将位和等招关系是否真正支持计划？",
  };
}

function scoreText(line: AnalysisLine | undefined, side: Side) {
  if (!line) return undefined;
  if (line.mate != null) return line.mate > 0 ? `${side}可杀` : `${side}需防杀`;
  if (line.scoreCp == null) return undefined;
  const score = line.scoreCp * (side === "红方" ? 1 : -1);
  return `${score >= 0 ? "+" : ""}${Math.round(score)}（${side}视角）`;
}

function engineValidation(input: StrategyInsightInput): StrategyInsight["engine"] {
  const line = input.analysis;
  const moves = line?.notation?.length ? line.notation : [];
  if (input.analysisBusy) return { status: "analyzing", label: "引擎分析中", text: "棋理推断已生成；引擎分析中，返回后再核验具体候选与变招。", pv: [] };
  if (input.analysisStale || !line) return { status: "theory", label: "棋理推断", text: "尚无当前局面的有效引擎结果；以下结论是棋理推断，需用候选线验证。", pv: [] };
  if (moves.length < 2) return { status: "insufficient", label: "证据不足", text: "引擎已返回但主变过短，暂不据此确认计划；建议提高分析时间或深度。", pv: moves, scoreText: scoreText(line, input.sideToMove), depth: line.depth };
  const engine = input.engineName ?? "主引擎";
  const perspectiveScore = (line.scoreCp ?? 0) * (input.sideToMove === "红方" ? 1 : -1);
  const perspectiveMate = line.mate == null ? undefined : (line.mate === 0 ? -1 : Math.sign(line.mate)) * (input.sideToMove === "红方" ? 1 : -1);
  if (perspectiveMate != null ? perspectiveMate < 0 : perspectiveScore <= -120) return {
    status: "conflicted",
    label: "计划受阻",
    text: `${engine} 的主变为 ${moves.slice(0, 4).join(" ")}，当前行棋方存在明确压力；先核验直接威胁、防守候选与反击条件，再决定是否继续原计划。`,
    pv: moves,
    scoreText: scoreText(line, input.sideToMove),
    depth: line.depth,
  };
  return {
    status: "supported",
    label: "引擎支持",
    text: `${engine} 首选 ${moves[0]}，主变给出 ${moves.slice(0, 4).join(" ")}；它为当前计划提供具体候选证据，不替代对反击条件的检查。`,
    pv: moves,
    scoreText: scoreText(line, input.sideToMove),
    depth: line.depth,
  };
}

export function buildStrategyInsight(input: StrategyInsightInput): StrategyInsight {
  const phase = input.phase ?? reportMovePhase(input.ply, materialOf(input.pieces));
  const plan = phasePlan(phase, input.sideToMove);
  const stageGuides = (Object.keys(labels) as ReportPhase[]).reduce((guides, stage) => ({
    ...guides,
    [stage]: { ...phasePlan(stage, input.sideToMove), principles: phaseCards(stage) },
  }), {} as StrategyInsight["stageGuides"]);
  const facts = [
    `当前 ${input.sideToMove}走，第 ${input.ply} 个半回合，处于${labels[phase]}。`,
    `盘面子力估值 ${materialOf(input.pieces)}；红方 ${input.pieces.filter((piece) => piece.color === "red").length} 子，黑方 ${input.pieces.filter((piece) => piece.color === "black").length} 子。`,
    input.openingName ? `官着信息：${input.openingName}。` : "未命中可用官着信息，按局面事实与通用棋理判断。",
    input.currentBranchCount && input.currentBranchCount > 1 ? `当前节点有 ${input.currentBranchCount} 条后续变化，应比较各分支对反击条件的处理。` : "当前分支没有并列后续，计划仍需用候选线核验。",
  ];
  const engine = engineValidation(input);
  const cards = prioritizeStudyCards(
    [...(input.courseCards ?? []).filter((card) => card.phase === phase || card.phase === "all"), ...phaseCards(phase)],
    input.studyTags ?? [],
  );
  return {
    phase,
    phaseLabel: labels[phase],
    facts,
    principles: cards,
    plan,
    stageGuides,
    engine,
    compact: { conclusion: plan.goal, risk: plan.guard, principleTitle: cards[0]?.title ?? "通用棋理" },
  };
}

export function formatStrategyInsightText(insight: StrategyInsight) {
  return [
    `三阶段思路分析 · 当前${insight.phaseLabel}`,
    "", "局面事实", ...insight.facts.map((fact) => `- ${fact}`),
    "", "棋理依据", ...insight.principles.map((card) => `- ${card.title}［${card.source.label}${card.source.course ? ` · ${card.source.course} · ${card.source.episode ?? ""}${card.source.timecode ? ` · ${card.source.timecode}` : ""}` : card.source.book ? ` · ${card.source.book}${card.source.pageStart ? ` · p.${card.source.pageStart}${card.source.pageEnd && card.source.pageEnd !== card.source.pageStart ? `-${card.source.pageEnd}` : ""}` : ""}` : ` · ${card.source.review}`}］：${card.summary}\n  适用：${card.appliesWhen}\n  风险：${card.risk}`),
    "", "计划结论", `- 目标：${insight.plan.goal}`, `- 防范：${insight.plan.guard}`, `- 验证：${insight.plan.verify}`,
    "", `引擎验证［${insight.engine.label}］`, insight.engine.text,
    insight.engine.depth != null ? `深度：${insight.engine.depth}` : "",
    insight.engine.scoreText ? `分数：${insight.engine.scoreText}` : "",
    insight.engine.pv.length ? `PV：${insight.engine.pv.join(" ")}` : "",
    "", "来源说明：赵鑫鑫开局总论仅使用用户确认的短摘要；具体课程原则须经本地转写与人工确认后才会参与正式判断。",
  ].filter(Boolean).join("\n");
}
