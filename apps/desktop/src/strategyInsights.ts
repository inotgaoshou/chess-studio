import { reportMovePhase } from "./analysisView";
import type { AnalysisLine, MasterStyleHintDto, Piece, ReportPhase, Side } from "./platform";

export type TheorySource = {
  label: "赵鑫鑫开局总论" | "赵鑫鑫课程" | "赵鑫鑫棋理三部曲" | "通用棋理" | "方法论参考";
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
export type StrategyCheckStatus = "ok" | "watch" | "risk";
export type StrategyConfidence = "高" | "中" | "低";

export type StrategyCheck = {
  label: string;
  status: StrategyCheckStatus;
  text: string;
  moveRefs: string[];
};

export type StrategyEvidence = {
  pikafish: { confidence: StrategyConfidence; label: string; summary: string; details: string[] };
  theoryCards: Array<{ card: TheoryPrincipleCard; reason: string; confidence: StrategyConfidence }>;
  masterGames: Array<{ playerName: string; playedMove: string; sourceTitle: string; reason: string; confidence: StrategyConfidence }>;
  confidence: StrategyConfidence;
  confidenceReasons: string[];
};

export type StrategyInsight = {
  phase: ReportPhase;
  phaseLabel: string;
  facts: string[];
  principles: TheoryPrincipleCard[];
  plan: { goal: string; guard: string; verify: string };
  overview: { conclusion: string; focus: string[]; risk: string; moveRefs: string[] };
  stageGuides: Record<ReportPhase, { goal: string; guard: string; verify: string; checks: StrategyCheck[]; principles: TheoryPrincipleCard[] }>;
  engine: { status: EngineValidationStatus; label: string; text: string; pv: string[]; scoreText?: string; depth?: number };
  evidence: StrategyEvidence;
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
  masterStyleHints?: MasterStyleHintDto[];
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

function sideColor(side: Side) {
  return side === "红方" ? "red" : "black";
}

function opponentSide(side: Side): Side {
  return side === "红方" ? "黑方" : "红方";
}

function sidePieces(pieces: Piece[], side: Side) {
  return pieces.filter((piece) => piece.color === sideColor(side));
}

function sideMaterial(pieces: Piece[], side: Side) {
  return sidePieces(pieces, side).reduce((total, piece) => total + (values[piece.kind] ?? 0), 0);
}

function advancedPawnCount(pieces: Piece[], side: Side) {
  return sidePieces(pieces, side).filter((piece) => piece.kind === "pawn" && (side === "红方" ? piece.row <= 4 : piece.row >= 5)).length;
}

function undevelopedMajorPieces(pieces: Piece[], side: Side) {
  const color = sideColor(side);
  const home = side === "红方"
    ? { rook: 9, horse: 9, cannon: 7 }
    : { rook: 0, horse: 0, cannon: 2 };
  const labelsByKind: Record<string, string> = { rook: "车", horse: "马", cannon: "炮" };
  return pieces
    .filter((piece) => piece.color === color && ["rook", "horse", "cannon"].includes(piece.kind))
    .filter((piece) => piece.row === home[piece.kind as keyof typeof home])
    .map((piece) => labelsByKind[piece.kind] ?? piece.label);
}

function check(status: StrategyCheckStatus, label: string, text: string, moveRefs: string[] = []): StrategyCheck {
  return { status, label, text, moveRefs };
}

function formatPlyMoveRef(ply: number, history: string[]) {
  if (ply <= 0) return "开始局面";
  const notation = history[Math.max(0, Math.min(history.length, ply) - 1)];
  const turn = Math.ceil(ply / 2);
  const side = ply % 2 === 1 ? "红" : "黑";
  return `第 ${ply} 着（第 ${turn} 回合${side}${notation ? `：${notation}` : ""}）`;
}

function phaseMoveRefs(phase: ReportPhase, input: StrategyInsightInput) {
  const currentPhase = input.phase ?? reportMovePhase(input.ply, materialOf(input.pieces));
  if (phase === currentPhase) return [formatPlyMoveRef(input.ply, input.history)];
  const total = input.history.length;
  if (phase === "opening") {
    const end = total > 0 ? Math.min(total, 20) : 20;
    return [`第 1-${end} 着（开局阶段回看范围）`];
  }
  if (phase === "middle") {
    const end = total >= 21 ? Math.min(total, 60) : 60;
    return total >= 21 ? [`第 21-${end} 着（中局阶段回看范围）`] : ["第 21-60 着（中局阶段，当前棋谱尚未走到）"];
  }
  return total >= 61 ? [`第 61-${total} 着（残局阶段回看范围）`] : ["第 61 着以后（残局阶段，当前棋谱尚未走到）"];
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

function stageChecks(
  phase: ReportPhase,
  input: StrategyInsightInput,
  engine: StrategyInsight["engine"],
): StrategyCheck[] {
  const side = input.sideToMove;
  const opponent = opponentSide(side);
  const ownMaterial = sideMaterial(input.pieces, side);
  const opponentMaterial = sideMaterial(input.pieces, opponent);
  const branchCount = input.currentBranchCount ?? 0;
  const moveRefs = phaseMoveRefs(phase, input);
  if (phase === "opening") {
    const undeveloped = undevelopedMajorPieces(input.pieces, side);
    return [
      check(input.openingName ? "ok" : "watch", "是否命中布局体系", input.openingName ? `已命中「${input.openingName}」，先按体系目标理解，不急着背完整变化。` : "未命中官着/开局库，按子力协调、中心控制和反击条件拆解。", moveRefs),
      check(input.openingName ? "watch" : "risk", "是否脱离定式", input.openingName ? "仍要检查对方是否走出体系外变招，别把官着名称当成安全证明。" : "已经按未知局面处理，应优先找自然出子和防反击的候选。", moveRefs),
      check(undeveloped.length ? "watch" : "ok", "哪个子没出动", undeveloped.length ? `${side}仍有 ${undeveloped.join("、")} 停在原位附近，先看能否带节奏出动。` : `${side}主要子力已基本离开原位，可准备转入线路争夺。`, moveRefs),
      check("watch", "后续转中局目标", "把开局成果落到一条可争夺线路：车路、肋道、中路或兵线突破点。", moveRefs),
    ];
  }
  if (phase === "middle") {
    return [
      check("watch", "关键线路", "优先找车路、中路、肋道和炮线，判断哪条线能形成牵制或以多打少。", moveRefs),
      check(engine.status === "conflicted" ? "risk" : "watch", "攻防先手", engine.status === "conflicted" ? "引擎提示当前计划受阻，先看对方直接将军、吃子或反击。" : "先比较我方进攻速度与对方反击速度，不要只看自己想攻哪里。", moveRefs),
      check(branchCount > 1 ? "ok" : "watch", "候选着漏算", branchCount > 1 ? `当前有 ${branchCount} 条分支，可逐条比较分差和后续主变。` : "当前没有并列分支，建议至少补 2-3 个候选再判断。", moveRefs),
      check(engine.pv.length >= 2 ? "ok" : "watch", "是否有战术反击", engine.pv.length >= 2 ? `主变已给出 ${engine.pv.slice(0, 3).join(" ")}，按这条线检查反击点。` : "缺少足够主变，战术反击仍需用引擎或人工候选线确认。", moveRefs),
    ];
  }
  const ownAdvancedPawns = advancedPawnCount(input.pieces, side);
  const opponentAdvancedPawns = advancedPawnCount(input.pieces, opponent);
  const materialGap = ownMaterial - opponentMaterial;
  return [
    check("watch", "理论胜和", "先判断是否属于可查的理论残局结构，再比较将位、控制线和兵卒效率。", moveRefs),
    check(Math.abs(materialGap) >= 4 ? "watch" : "risk", "兑子是否有利", materialGap > 0 ? `${side}子力略优，兑子前确认是否保留关键控线或过河兵。` : materialGap < 0 ? `${side}子力偏少，兑子可能进入被动胜和边界，需谨慎。` : "子力大致相当，兑子后胜和很可能取决于兵形、将位和等着。", moveRefs),
    check(ownAdvancedPawns >= opponentAdvancedPawns ? "watch" : "risk", "兵卒效率", `${side}过河兵/卒 ${ownAdvancedPawns} 个，${opponent}过河兵/卒 ${opponentAdvancedPawns} 个；下兵前先看能否制造威胁或限制将位。`, moveRefs),
    check("watch", "将位与等着", `优先确认能否限制${opponent.replace("方", "")}将活动，再决定推进、兑子或等着。`, moveRefs),
  ];
}

function overviewFor(phase: ReportPhase, input: StrategyInsightInput, engine: StrategyInsight["engine"]) {
  const side = input.sideToMove;
  const opponent = opponentSide(side);
  if (phase === "opening") return {
    conclusion: input.openingName ? `${side}当前先按「${input.openingName}」的布局目标走：出动大子、保持协调，再寻找转中局线路。` : `${side}当前未命中明确布局体系，先用自然出子和反击条件来筛候选。`,
    focus: ["布局体系", "子力协调", "反击条件", "转中局目标"],
    risk: engine.status === "theory" ? "当前主要是棋理判断，需用云库或 Pikafish 主变确认是否脱离定式。" : "即使命中布局名称，也要核验对方变招后的直接反击。",
    moveRefs: phaseMoveRefs(phase, input),
  };
  if (phase === "middle") return {
    conclusion: `${side}应先确认关键线路和攻防先手，再决定进攻、兑子或转入防守。`,
    focus: ["关键线路", "攻防先手", "候选着", "战术反击"],
    risk: engine.status === "conflicted" ? "Pikafish 提示当前行棋方受压，本手风险是只顾进攻而漏掉防守候选。" : "中局口号不能替代计算，至少比较首选、次选和对方最强反击。",
    moveRefs: phaseMoveRefs(phase, input),
  };
  return {
    conclusion: `${side}该先确认能否限制${opponent.replace("方", "")}将活动，再决定是否下兵、兑子或等着。`,
    focus: ["理论胜和", "兑子后胜和", "兵卒效率", "将位与等着"],
    risk: engine.status === "supported" ? "主变支持当前方向，但残局一步兑子、将位或兵卒次序不同，结论可能完全改变。" : "本手风险是快导入卡或通用棋理只给方向，仍需用 Pikafish 主变确认。",
    moveRefs: phaseMoveRefs(phase, input),
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

function evidenceFor(
  input: StrategyInsightInput,
  engine: StrategyInsight["engine"],
  principles: TheoryPrincipleCard[],
  phase: ReportPhase,
): StrategyEvidence {
  const theoryEvidence = principles.slice(0, 4).map((card) => {
    const sourceBoost = card.source.label === "赵鑫鑫棋理三部曲" || card.source.label === "赵鑫鑫课程";
    const clean = !card.needsRecheck && (card.matchPenalty ?? 0) <= 1;
    return {
      card,
      reason: card.tags?.length ? `命中标签：${card.tags.slice(0, 4).join(" / ")}` : `阶段匹配：${labels[phase]} · ${card.appliesWhen}`,
      confidence: (sourceBoost && clean ? "中" : "低") as StrategyConfidence,
    };
  });
  const masterGames = (input.masterStyleHints ?? []).slice(0, 3).map((hint) => ({
    playerName: hint.playerName,
    playedMove: hint.playedMove,
    sourceTitle: hint.sourceTitle,
    reason: hint.reason || (hint.confidence === "exact" ? "完全相同 FEN" : "同阶段相似候选"),
    confidence: (hint.confidence === "exact" ? "高" : "中") as StrategyConfidence,
  }));
  const pikafishConfidence: StrategyConfidence = engine.status === "supported" || engine.status === "conflicted"
    ? (engine.depth != null && engine.depth >= 20 ? "高" : "中")
    : "低";
  const confidenceScore =
    (pikafishConfidence === "高" ? 2 : pikafishConfidence === "中" ? 1 : 0)
    + (theoryEvidence.some((item) => item.confidence === "中") ? 1 : 0)
    + (masterGames.some((item) => item.confidence === "高") ? 2 : masterGames.length ? 1 : 0);
  const confidence: StrategyConfidence = confidenceScore >= 4 ? "高" : confidenceScore >= 2 ? "中" : "低";
  const confidenceReasons = [
    `Pikafish：${engine.label}${engine.depth != null ? `，深度 ${engine.depth}` : ""}`,
    theoryEvidence.length ? `棋理卡：${theoryEvidence.length} 张已确认短原则` : "棋理卡：暂无阶段匹配卡",
    masterGames.length ? `大师样本：${masterGames.length} 条公开棋谱参考` : "大师样本：当前未命中类似公开棋谱",
  ];
  return {
    pikafish: {
      confidence: pikafishConfidence,
      label: engine.label,
      summary: engine.text,
      details: [
        engine.scoreText ? `分数：${engine.scoreText}` : "分数：暂无",
        engine.depth != null ? `深度：${engine.depth}` : "深度：暂无",
        engine.pv.length ? `PV：${engine.pv.slice(0, 6).join(" ")}` : "PV：暂无足够主变",
      ],
    },
    theoryCards: theoryEvidence,
    masterGames,
    confidence,
    confidenceReasons,
  };
}

export function buildStrategyInsight(input: StrategyInsightInput): StrategyInsight {
  const phase = input.phase ?? reportMovePhase(input.ply, materialOf(input.pieces));
  const plan = phasePlan(phase, input.sideToMove);
  const engine = engineValidation(input);
  const stageGuides = (Object.keys(labels) as ReportPhase[]).reduce((guides, stage) => ({
    ...guides,
    [stage]: { ...phasePlan(stage, input.sideToMove), checks: stageChecks(stage, input, engine), principles: phaseCards(stage) },
  }), {} as StrategyInsight["stageGuides"]);
  const facts = [
    `当前 ${input.sideToMove}走，第 ${input.ply} 个半回合，处于${labels[phase]}。`,
    `盘面子力估值 ${materialOf(input.pieces)}；红方 ${input.pieces.filter((piece) => piece.color === "red").length} 子，黑方 ${input.pieces.filter((piece) => piece.color === "black").length} 子。`,
    input.openingName ? `官着信息：${input.openingName}。` : "未命中可用官着信息，按局面事实与通用棋理判断。",
    input.currentBranchCount && input.currentBranchCount > 1 ? `当前节点有 ${input.currentBranchCount} 条后续变化，应比较各分支对反击条件的处理。` : "当前分支没有并列后续，计划仍需用候选线核验。",
  ];
  const cards = prioritizeStudyCards(
    [...(input.courseCards ?? []).filter((card) => card.phase === phase || card.phase === "all"), ...phaseCards(phase)],
    input.studyTags ?? [],
  );
  const overview = overviewFor(phase, input, engine);
  const evidence = evidenceFor(input, engine, cards, phase);
  return {
    phase,
    phaseLabel: labels[phase],
    facts,
    principles: cards,
    plan,
    overview,
    stageGuides,
    engine,
    evidence,
    compact: { conclusion: plan.goal, risk: plan.guard, principleTitle: cards[0]?.title ?? "通用棋理" },
  };
}

export function formatStrategyInsightText(insight: StrategyInsight) {
  return [
    `三阶段思路分析 · 当前${insight.phaseLabel}`,
    "", "总览", `- 当前结论：${insight.overview.conclusion}`, `- 问题着数：${insight.overview.moveRefs.join(" / ")}`, `- 推荐关注：${insight.overview.focus.join(" / ")}`, `- 本手风险：${insight.overview.risk}`,
    "", "局面事实", ...insight.facts.map((fact) => `- ${fact}`),
    ...(["opening", "middle", "endgame"] as ReportPhase[]).flatMap((phase) => [
      "", labels[phase],
      ...insight.stageGuides[phase].checks.map((item) => `- ${item.label}｜着数：${item.moveRefs.join(" / ")}\n  ${item.text}`),
    ]),
    "", "依据",
    `- Pikafish证据［${insight.evidence.pikafish.confidence}］：${insight.evidence.pikafish.summary}`,
    ...insight.evidence.pikafish.details.map((detail) => `  ${detail}`),
    ...insight.evidence.theoryCards.map(({ card, reason, confidence }) => `- 赵鑫鑫棋理卡［${confidence}］：${card.title}｜${reason}\n  ${card.summary}\n  适用：${card.appliesWhen}\n  风险：${card.risk}`),
    ...insight.evidence.masterGames.map((item) => `- 大师类似棋谱［${item.confidence}］：${item.playerName} 实战 ${item.playedMove}｜${item.sourceTitle}\n  ${item.reason}`),
    `- 综合置信度：${insight.evidence.confidence}`,
    ...insight.evidence.confidenceReasons.map((reason) => `  ${reason}`),
    "", "来源说明：赵鑫鑫开局总论仅使用用户确认的短摘要；具体课程原则须经本地转写与人工确认后才会参与正式判断。",
  ].filter(Boolean).join("\n");
}
