import type { AnalysisLine, BoardState, BranchCoachInsightDto, GameReportPresentationDto, MoveCoachInsightDto, OpeningBookHitDto, QualityGrade, ReportPhase, Side } from "./platform";
import type { GameReportMove, SideReport } from "./analysisView";
import { CANDIDATE_PREVIEW_HALF_MOVES } from "./candidatePreview";

const phaseLabels: Record<ReportPhase, string> = { opening: "开局", middle: "中局", endgame: "残局" };

function signed(scoreCp: number) {
  const value = Math.round(scoreCp);
  return value > 0 ? `+${value}` : `${value}`;
}

function phaseWeakness(phase: ReportPhase) {
  switch (phase) {
    case "opening":
      return "布局阶段的核心弱点通常是出子速度、子力协调或阵形厚度不足。";
    case "middle":
      return "中局阶段的核心弱点通常是进攻前子力没有形成合力，或防守薄弱点被对方借力。";
    case "endgame":
      return "残局阶段的核心弱点通常是子力位置、兵卒效率和将帅安全的细节计算。";
  }
}

function phaseSolution(phase: ReportPhase) {
  switch (phase) {
    case "opening":
      return "建议对照官着和 AI 推荐线复盘：优先完成马炮车出动，少贪边兵和孤军深入，保持中路与两翼联动。";
    case "middle":
      return "建议先问三件事：己方将帅是否安全、进攻子力是否够数、对方是否有先手反击；再选择强攻、兑子或补防。";
    case "endgame":
      return "建议把候选着法算到交换后的静态局面，重点比较兵卒速度、将帅位置和关键子力能否持续牵制。";
  }
}

function gradePurpose(grade: QualityGrade, missedMate: boolean) {
  if (missedMate) return "走前已有强制杀棋，实战着没有延续杀法，需要回到走前局面优先寻找将军、抽将和连续威胁。";
  switch (grade) {
    case "优":
      return "这步基本保持了局面价值，目的应是延续当前计划并限制对手反击。";
    case "良":
      return "这步方向大体成立，但可能还有更精确的次序或更高效的子力调动。";
    case "中":
      return "这步能下，但没有充分解决当前局面的主要矛盾，适合比较 AI 首选的次序差异。";
    case "差":
      return "这步明显放大了对手机会，通常是漏算反击、兑子后局面变差或攻击准备不足。";
    case "错":
      return "这步造成严重局面损失，复盘时应先找直接战术问题，再看布局方向是否已经偏离。";
  }
}

function recommendationText(move: Pick<GameReportMove, "bestNotation" | "pvNotation">) {
  return move.bestNotation ?? move.pvNotation?.[0];
}

export type CurrentCoachAdvice = {
  title: string;
  status: string;
  suggestions: string[];
  nextAction: string;
};
export type CandidateCoachInsight = {
  rank: number;
  move: string;
  scoreText: string;
  depthText: string;
  intent: string;
  possibility: string;
  risk: string;
  followUp: string[];
  shortLine: boolean;
  usesIccs: boolean;
};

function analysisRecommendation(line: AnalysisLine | undefined) {
  return line?.notation?.[0] ?? line?.pv[0];
}

function lineScoreValue(line: AnalysisLine) {
  if (line.mate != null) return line.mate > 0 ? 100_000 - Math.abs(line.mate) : -100_000 + Math.abs(line.mate);
  return line.scoreCp ?? 0;
}

function scoreLabel(line: AnalysisLine, perspective: number) {
  if (line.mate != null) {
    const winner = (line.mate === 0 ? -1 : Math.sign(line.mate)) * perspective;
    return winner > 0 ? `${Math.abs(line.mate)}步杀` : `${Math.abs(line.mate)}步被杀`;
  }
  return line.scoreCp == null ? "--" : signed(line.scoreCp * perspective);
}

function linePurpose(rank: number, move: string, sideToMove: Side) {
  if (rank === 1) return `主候选「${move}」：优先作为${sideToMove}当前局面的基准方案，先看它如何保持或扩大局面价值。`;
  if (rank === 2) return `备选「${move}」：适合用来比较不同次序，判断是否能更稳地处理对方反击。`;
  return `变招「${move}」：用于探索另一种可能性，重点看最多 10 回合后局面是否仍然站得住。`;
}

function linePossibility(rank: number, gap: number) {
  if (rank === 1) return "主攻线：作为当前局面的第一参考线。";
  if (gap <= 50) return "等价候选：与第一候选差距很小，可以作为实战选择认真比较。";
  if (gap <= 150) return "可选变招：思路可能成立，但需要看后续是否有补偿。";
  return "探索线：与第一候选差距较大，更适合研究或作为反例复盘。";
}

function scoreGapDetail(primaryValue: number, lineValue: number) {
  return `首选 ${signed(primaryValue)}，本线 ${signed(lineValue)}，相差 ${Math.round(Math.abs(primaryValue - lineValue))} 分`;
}

function lineRisk(rank: number, primaryValue: number, lineValue: number, line: AnalysisLine, shortLine: boolean, usesIccs: boolean) {
  const gap = Math.abs(primaryValue - lineValue);
  const detail = scoreGapDetail(primaryValue, lineValue);
  if (usesIccs) return "当前候选仅有 ICCS，已保留原始线路；重新分析或生成整局报告后可补齐中文推演。";
  if (shortLine) {
    const length = Math.max(line.notation?.length ?? 0, line.pv.length);
    const prefix = rank === 1 ? "主候选尚需检查直接反击" : `${gap <= 50 ? "风险较低" : gap <= 150 ? "风险中等" : "风险较高"}：${detail}`;
    return `${prefix}；当前深度仅返回 ${length}/${CANDIDATE_PREVIEW_HALF_MOVES} 个半回合，线路较短，建议提高深度或时间再判断。`;
  }
  if (rank === 1) return "风险参考：仍需检查对方是否有直接将军、吃子或反先手段。";
  if (gap <= 50) return `风险较低：${detail}，可重点比较走法目的。`;
  if (gap <= 150) return `风险中等：${detail}，适合先作为变招推演。`;
  return `风险较高：${detail}，实战采用前需要找到明确补偿。`;
}

export function candidateCoachInsights(lines: AnalysisLine[], board: Pick<BoardState, "sideToMove">): CandidateCoachInsight[] {
  const ordered = lines.slice().sort((left, right) => left.multipv - right.multipv);
  const perspective = board.sideToMove === "红方" ? 1 : -1;
  const primaryValue = ordered[0] ? lineScoreValue(ordered[0]) * perspective : 0;
  return ordered.map((line, index) => {
    const followUpSource = line.notation?.length ? line.notation : line.pv;
    const usesIccs = !line.notation?.length;
    const followUp = followUpSource.slice(0, CANDIDATE_PREVIEW_HALF_MOVES);
    const move = followUp[0] ?? "暂无候选";
    const lineValue = lineScoreValue(line) * perspective;
    const gap = Math.abs(primaryValue - lineValue);
    const shortLine = followUp.length > 0 && followUp.length < CANDIDATE_PREVIEW_HALF_MOVES;
    const rank = line.multipv || index + 1;
    return {
      rank,
      move,
      scoreText: scoreLabel(line, perspective),
      depthText: `深度 ${line.depth ?? "-"}`,
      intent: linePurpose(rank, move, board.sideToMove),
      possibility: linePossibility(rank, gap),
      risk: lineRisk(rank, primaryValue, lineValue, line, shortLine, usesIccs),
      followUp,
      shortLine,
      usesIccs,
    };
  });
}

export function currentCoachAdvice(input: {
  board: Pick<BoardState, "history" | "sideToMove" | "currentNode" | "playable" | "status">;
  primaryAnalysis?: AnalysisLine;
  analysisLines?: AnalysisLine[];
  report?: GameReportPresentationDto;
  analysisBusy?: boolean;
}): CurrentCoachAdvice {
  const { board, primaryAnalysis, report, analysisBusy = false } = input;
  const analysisLines = input.analysisLines ?? (primaryAnalysis ? [primaryAnalysis] : []);
  const recommendation = analysisRecommendation(primaryAnalysis);
  const currentIssue = board.currentNode ? report?.issues.find((issue) => issue.nodeId === board.currentNode) : undefined;
  if (!board.playable) {
    return {
      title: "当前局面暂不可对弈",
      status: board.status,
      suggestions: [
        "先检查局面编辑：将帅位置、双方棋子数量、行棋方是否合理。",
        "修正为合法局面后，再使用 AI 分析和整局报告判断弱点。",
      ],
      nextAction: "打开局面编辑器修正局面。",
    };
  }
  if (currentIssue) {
    return {
      title: `${currentIssue.movedBy} ${currentIssue.notation} 的私教建议`,
      status: `${currentIssue.grade} · ${currentIssue.score}分 · 损失 ${currentIssue.lossCp}cp`,
      suggestions: [
        currentIssue.coach.intent,
        currentIssue.coach.weakness,
        currentIssue.coach.solution,
      ],
      nextAction: currentIssue.coach.branchPlan,
    };
  }
  if (recommendation) {
    const count = analysisLines.length || 1;
    return {
      title: "当前局面 AI 私教建议",
      status: `${board.sideToMove}行棋 · 首选 ${recommendation} · MultiPV ${count}`,
      suggestions: [
        `先把「${recommendation}」当作主候选，观察它是否在抢先、补防、兑子或制造威胁。`,
        primaryAnalysis?.notation?.length
          ? `主线最多 10 回合推演：${primaryAnalysis.notation.slice(0, CANDIDATE_PREVIEW_HALF_MOVES).join(" ")}。`
          : "当前只有 ICCS 候选，建议生成整局报告后可得到中文推荐与后续推演。",
        count > 1 ? `下面已列出 ${count} 条候选的想法、风险和最多 10 回合推演，可逐条比较。` : "如果你想研究别的想法，用“强制变招”排除第一候选，再比较局面分差异。",
      ],
      nextAction: "在下方每条候选线查看“思路 / 可能性 / 风险 / 最多8回合推演”，也可以直接点击第一步试走或保存为变招分支。",
    };
  }
  if (analysisBusy) {
    return {
      title: "AI 正在思考",
      status: `${board.sideToMove}行棋 · 正在比较 MultiPV 候选`,
      suggestions: [
        "先观察当前局面有哪些直接威胁：将军、吃子、捉双、抽将。",
        "再列 2-3 个候选：一个进攻、一个补防、一个调整子力。",
      ],
      nextAction: "等 Pikafish 返回首选后，再比较你的候选和 AI 推荐。",
    };
  }
  if (board.history.length === 0) {
    return {
      title: "开局前的 AI 私教建议",
      status: `${board.sideToMove}先行 · 尚未走棋`,
      suggestions: [
        "第一步不要只看能否吃子，先考虑布局目标：争中路、快出子、保持将帅安全。",
        "如果从标准局面开始，可以用中炮、飞相、仙人指路等思路建立主线，再用变招比较不同体系。",
        "生成整局报告后，官着库会标记经典布局走法，但质量分仍按 Pikafish 计算。",
      ],
      nextAction: "先点击“分析当前局面”，或直接走第一步建立主线。",
    };
  }
  return {
    title: "当前节点暂无 AI 候选",
    status: `${board.sideToMove}行棋 · 已走 ${board.history.length} 着`,
    suggestions: [
      "先回看上一着的目的：它是在进攻、补防、兑子、抢先，还是单纯移动子力。",
      "当前没有候选线时，先用局面问题清单：王安全、子力活跃度、兵卒结构、对方直接威胁。",
      report ? "已有整局报告时，可以切到“摘要/报告”查看历史着法的私教建议。" : "还没有整局报告时，生成报告后会补齐每步目的、弱点和变招方案。",
    ],
    nextAction: "点击“分析”获取当前局面的候选线；若要逐步复盘，点击“生成报告”。",
  };
}

export function moveCoachInsight(move: GameReportMove): MoveCoachInsightDto {
  const recommendation = recommendationText(move);
  const phase = phaseLabels[move.phase];
  const openingText = move.opening ? `这步仍在「${move.opening.name}」官着脉络内，主要价值是保持经典布局的出子效率。` : "";
  const intent = openingText || gradePurpose(move.grade, move.missedMate);
  const weakness = move.lossCp <= 50 && !move.missedMate
    ? `${phase}局面保持较稳，暂未暴露明显弱点；后续重点看能否持续扩大先手。`
    : `${phaseWeakness(move.phase)}本着后红方视角变化 ${signed(move.deltaCp)}，${move.movedBy}实际损失 ${move.lossCp}cp。`;
  const solution = recommendation
    ? `${phaseSolution(move.phase)}本局可优先试走「${recommendation}」，观察后续 ${move.pvNotation?.slice(0, 4).join(" ") || "推荐线"} 如何改善局面。`
    : `${phaseSolution(move.phase)}当前报告缺少中文推荐线，重新生成深度报告后可以补齐具体候选。`;
  const branchPlan = recommendation
    ? `建议新建变招分支：从「${move.notation}」走前局面改走「${recommendation}」，比较 3-6 个半回合后的局面分与进攻方向。`
    : `建议新建变招分支：从「${move.notation}」走前局面重新寻找更稳的候选，并记录为何放弃实战着。`;
  return { intent, weakness, solution, branchPlan };
}

export function moveThoughtHint(input: {
  notation: string;
  movedBy: Side;
  grade?: QualityGrade;
  missedMate?: boolean;
  opening?: OpeningBookHitDto;
  bestNotation?: string;
  deltaCp?: number;
}) {
  if (input.opening) return `思路：延续${input.opening.name}官着，重点保持出子效率和阵形协调。`;
  if (input.missedMate) return "思路：走前已有杀棋机会，应优先检查连续将军和强制威胁。";
  if (input.bestNotation) return `思路：可比较 AI 推荐「${input.bestNotation}」与实战「${input.notation}」的次序差异。`;
  if (!input.grade) return "思路：等待分析后可判断这步的目的和改进方向。";
  const swing = input.deltaCp == null ? "" : `局面变化 ${signed(input.deltaCp)}，`;
  if (input.grade === "优" || input.grade === "良") return `思路：${swing}${input.movedBy}基本保持计划，继续关注对方反击点。`;
  if (input.grade === "中") return `思路：${swing}这步方向尚可，但需要确认是否有更稳的补防或抢先。`;
  return `思路：${swing}这步暴露明显问题，建议回到走前局面建立变招分支复盘。`;
}

function weakestPhase(side: SideReport) {
  return (Object.entries(side.phases) as Array<[ReportPhase, number | undefined]>)
    .filter((entry): entry is [ReportPhase, number] => entry[1] != null)
    .sort((left, right) => left[1] - right[1])[0];
}

function sideFix(side: Side, report: SideReport) {
  const phase = weakestPhase(report);
  if (!phase) return `${side}样本不足，建议先完成整局深度分析后再判断主要弱点。`;
  return `${side}${phaseLabels[phase[0]]}评分最低（${phase[1]}分）：${phaseSolution(phase[0])}`;
}

function branchName(opening: OpeningBookHitDto | undefined, worst: GameReportMove | undefined, lineLength: number) {
  if (worst) {
    const recommendation = recommendationText(worst);
    const prefix = opening?.name ?? "当前线路";
    return recommendation
      ? `${prefix}-第${lineLength}着-${worst.movedBy}修正${worst.notation}`
      : `${prefix}-第${lineLength}着-${worst.movedBy}${worst.grade}着-${worst.notation}复盘`;
  }
  return `${opening?.name ?? "当前线路"}-主线质量复盘`;
}

export function branchCoachInsights(
  red: SideReport,
  black: SideReport,
  moves: GameReportMove[],
  opening: OpeningBookHitDto | undefined,
): BranchCoachInsightDto {
  const worst = moves.reduce<GameReportMove | undefined>((current, move) => !current || move.lossCp > current.lossCp ? move : current, undefined);
  const turning = moves.reduce<GameReportMove | undefined>((current, move) => !current || Math.abs(move.deltaCp) > Math.abs(current.deltaCp) ? move : current, undefined);
  const branchPurpose = worst
    ? `这条线路的复盘重点是${worst.movedBy}在「${worst.notation}」附近的决策质量；先理解实战意图，再用推荐线验证更稳方案。`
    : "这条线路暂未出现明显问题着，适合作为主线基准，用来和其他变招分支比较局面分走势。";
  const namingTips = [
    "主线：用于保存实战或最认可的完整线路。",
    "变招A/B：用于从同一分支点比较不同候选着法。",
    opening ? `开局标签：可命名为「${opening.name}-红方进攻线」或「${opening.name}-黑方防守线」。` : "开局标签：未命中官着时，可按首个关键分支点命名。",
    worst ? `问题标签：例如「${worst.movedBy}${worst.grade}着-${worst.notation}-修正线」。` : "问题标签：没有明显差错时，可按战略目标命名，如“兑子稳优势线”。",
  ];
  return {
    branchName: branchName(opening, worst, moves.length),
    branchPurpose,
    namingTips,
    weaknessFixes: [
      sideFix("红方", red),
      sideFix("黑方", black),
      opening ? `官着识别到「${opening.name}」：脱离官着后不要只背招，重点比较脱谱点前后的局面分变化。` : "未命中官着：建议把前 10 个半回合按出子、争中、王安全三类重新标注。",
    ],
    studyPlan: [
      turning ? `先定位最大转折「${turning.notation}」：红方视角变化 ${signed(turning.deltaCp)}，判断是谁获得先手。` : "先确认局势图是否有明显陡峭段，没有则以阶段评分最低处作为入口。",
      worst ? `再回到「${worst.notation}」走前局面，试走 AI 推荐并保留为独立变招。` : "再选择 1-2 个候选分支，比较每条分支 3-6 个半回合后的稳定性。",
      "最后给每个分支写一句目的：进攻、兑子、补防、抢先或守和，避免只记录着法不记录思路。",
    ],
  };
}
