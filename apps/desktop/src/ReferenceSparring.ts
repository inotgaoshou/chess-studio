import type { PositionMoveStatDto } from "./platform/types";

export type ReferenceSparringLevel = "ye4" | "ye5" | "ye6" | "ye7" | "ye8" | "ye9" | "pro1";
export type ReferenceSparringStatus = "idle" | "user_turn" | "reference_thinking" | "paused" | "finished";
export type ReferenceSparringSide = "red" | "black";
export type ReferenceSparringMoveSource = "reference" | "cloud" | "engine";
export type ReferenceSparringPhase = "local" | "cloud" | "engine";

export type ReferenceSparringLevelProfile = {
  level: ReferenceSparringLevel;
  label: string;
  description: string;
  samplePower: number;
  resultPower: number;
  coldMoveFloor: number;
  randomJitter: number;
  maxCandidates: number;
  engineBlend: number;
};

export type ReferenceSparringEngineHint = {
  iccs: string;
  rank: number;
};

export type ReferenceSparringChoice = {
  move: PositionMoveStatDto;
  level: ReferenceSparringLevel;
  source: ReferenceSparringMoveSource;
  sourceLabel: string;
  warningMessage?: string;
  fallbackReason?: string;
  intelligenceNote?: string;
  candidateCount: number;
  totalWeight: number;
  chosenWeight: number;
  winRate: number;
};

export type ReferenceSparringState = {
  status: ReferenceSparringStatus;
  userSide: ReferenceSparringSide;
  level: ReferenceSparringLevel;
  delayMs: number;
  autoReport: boolean;
  phase?: ReferenceSparringPhase;
  pauseReason?: string;
  lastChoice?: ReferenceSparringChoice;
  message?: string;
};

export type ReferenceSparringOptions = Pick<ReferenceSparringState, "userSide" | "level" | "delayMs" | "autoReport">;

export const referenceSparringLevels: ReferenceSparringLevel[] = ["ye4", "ye5", "ye6", "ye7", "ye8", "ye9", "pro1"];

const levelProfiles: Record<ReferenceSparringLevel, ReferenceSparringLevelProfile> = {
  ye4: {
    level: "ye4",
    label: "业4",
    description: "样本随机权重大，允许较多冷门招；明显亏分招仍可能出现。",
    samplePower: .42,
    resultPower: .18,
    coldMoveFloor: .5,
    randomJitter: .6,
    maxCandidates: 12,
    engineBlend: 0,
  },
  ye5: {
    level: "ye5",
    label: "业5",
    description: "减少极冷门招，优先常见实战招。",
    samplePower: .55,
    resultPower: .28,
    coldMoveFloor: .35,
    randomJitter: .42,
    maxCandidates: 12,
    engineBlend: .02,
  },
  ye6: {
    level: "ye6",
    label: "业6",
    description: "常见招为主，偶尔变化。",
    samplePower: .7,
    resultPower: .42,
    coldMoveFloor: .24,
    randomJitter: .28,
    maxCandidates: 10,
    engineBlend: .06,
  },
  ye7: {
    level: "ye7",
    label: "业7",
    description: "偏向高样本和较好胜率招。",
    samplePower: .88,
    resultPower: .6,
    coldMoveFloor: .16,
    randomJitter: .18,
    maxCandidates: 10,
    engineBlend: .14,
  },
  ye8: {
    level: "ye8",
    label: "业8",
    description: "明显避开低样本/低胜率招。",
    samplePower: 1.08,
    resultPower: .78,
    coldMoveFloor: .1,
    randomJitter: .12,
    maxCandidates: 8,
    engineBlend: .25,
  },
  ye9: {
    level: "ye9",
    label: "业9",
    description: "优先强实战主流招，低概率出变化。",
    samplePower: 1.24,
    resultPower: .94,
    coldMoveFloor: .06,
    randomJitter: .08,
    maxCandidates: 7,
    engineBlend: .36,
  },
  pro1: {
    level: "pro1",
    label: "专1",
    description: "优先高样本、高胜率、低亏分候选；接近强实战训练对手。",
    samplePower: 1.45,
    resultPower: 1.12,
    coldMoveFloor: .03,
    randomJitter: .04,
    maxCandidates: 6,
    engineBlend: .5,
  },
};

export function referenceSparringLevelProfile(level: ReferenceSparringLevel) {
  return levelProfiles[level];
}

export function referenceSparringLevelLabel(level: ReferenceSparringLevel) {
  return referenceSparringLevelProfile(level).label;
}

export function referenceSparringSourceLabel(source: ReferenceSparringMoveSource) {
  if (source === "cloud") return "云库";
  if (source === "engine") return "Pikafish";
  return "参考库实战";
}

export function referenceSparringFallbackWarning(source: ReferenceSparringMoveSource) {
  if (source === "cloud") return "注意：本地参考实战库无候选，本步使用云库推荐，不代表本地实战统计。";
  if (source === "engine") return "注意：参考库和云库均无候选，本步使用 Pikafish 引擎招，不是实战随机样本。";
  return undefined;
}

function sideWinRate(candidate: PositionMoveStatDto, sideToMove: "红方" | "黑方") {
  const decided = candidate.redWins + candidate.draws + candidate.blackWins;
  if (decided <= 0) return .5;
  const wins = sideToMove === "红方" ? candidate.redWins : candidate.blackWins;
  return (wins + candidate.draws * .45) / decided;
}

export function referenceSparringCandidateWeight(candidate: PositionMoveStatDto, sideToMove: "红方" | "黑方", level: ReferenceSparringLevel) {
  const profile = referenceSparringLevelProfile(level);
  const samples = Math.max(1, candidate.samples);
  const sampleWeight = Math.pow(samples, profile.samplePower);
  const winRate = sideWinRate(candidate, sideToMove);
  const resultWeight = Math.pow(Math.max(.05, winRate), profile.resultPower);
  return Math.max(profile.coldMoveFloor, sampleWeight * resultWeight);
}

function referenceSparringEngineFactor(candidate: PositionMoveStatDto, hints: ReferenceSparringEngineHint[], level: ReferenceSparringLevel) {
  const profile = referenceSparringLevelProfile(level);
  if (profile.engineBlend <= 0 || hints.length === 0) return 1;
  const rank = hints.find((hint) => hint.iccs === candidate.iccs.trim())?.rank;
  if (rank === 1) return 1 + profile.engineBlend * 2.2;
  if (rank === 2) return 1 + profile.engineBlend * 1.25;
  if (rank === 3) return 1 + profile.engineBlend * .7;
  return Math.max(.35, 1 - profile.engineBlend * .45);
}

export function referenceSparringIntelligenceNote(level: ReferenceSparringLevel, hints: ReferenceSparringEngineHint[]) {
  const profile = referenceSparringLevelProfile(level);
  if (profile.engineBlend <= 0 || hints.length === 0) return undefined;
  return "智能校正：已参考当前 Pikafish 候选，不等待引擎、不覆盖实战随机。";
}

export function chooseReferenceSparringMove(
  candidates: PositionMoveStatDto[],
  sideToMove: "红方" | "黑方",
  level: ReferenceSparringLevel,
  random = Math.random,
  options: { engineHints?: ReferenceSparringEngineHint[] } = {},
): ReferenceSparringChoice | undefined {
  const profile = referenceSparringLevelProfile(level);
  const engineHints = options.engineHints?.filter((hint) => hint.iccs.trim()).slice(0, 3) ?? [];
  const intelligenceNote = referenceSparringIntelligenceNote(level, engineHints);
  const usable = candidates
    .filter((candidate) => candidate.iccs.trim())
    .slice(0, profile.maxCandidates);
  if (usable.length === 0) return undefined;
  const weighted = usable.map((move) => {
    const base = referenceSparringCandidateWeight(move, sideToMove, level);
    const engineFactor = referenceSparringEngineFactor(move, engineHints, level);
    const jitter = 1 + (random() * 2 - 1) * profile.randomJitter;
    return { move, weight: Math.max(profile.coldMoveFloor, base * engineFactor * Math.max(.1, jitter)) };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * totalWeight;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) {
      return {
        move: item.move,
        level,
        source: "reference",
        sourceLabel: referenceSparringSourceLabel("reference"),
        intelligenceNote,
        candidateCount: usable.length,
        totalWeight,
        chosenWeight: item.weight,
        winRate: sideWinRate(item.move, sideToMove),
      };
    }
  }
  const fallback = weighted.at(-1)!;
  return {
    move: fallback.move,
    level,
    source: "reference",
    sourceLabel: referenceSparringSourceLabel("reference"),
    intelligenceNote,
    candidateCount: usable.length,
    totalWeight,
    chosenWeight: fallback.weight,
    winRate: sideWinRate(fallback.move, sideToMove),
  };
}

export function fallbackReferenceSparringChoice(
  move: Pick<PositionMoveStatDto, "iccs"> & Partial<PositionMoveStatDto>,
  level: ReferenceSparringLevel,
  source: Exclude<ReferenceSparringMoveSource, "reference">,
  options: { candidateCount?: number; winRate?: number; fallbackReason?: string } = {},
): ReferenceSparringChoice | undefined {
  const iccs = move.iccs.trim();
  if (!iccs) return undefined;
  const winRate = options.winRate ?? .5;
  return {
    move: {
      iccs,
      notation: move.notation ?? iccs,
      samples: move.samples ?? 0,
      redWins: move.redWins ?? 0,
      draws: move.draws ?? 0,
      blackWins: move.blackWins ?? 0,
      firstYear: move.firstYear,
      lastYear: move.lastYear,
      openingCode: move.openingCode,
      openingName: move.openingName,
      openingConfidence: move.openingConfidence,
      representativeGameId: move.representativeGameId,
      representativeGameTitle: move.representativeGameTitle,
    },
    level,
    source,
    sourceLabel: referenceSparringSourceLabel(source),
    warningMessage: referenceSparringFallbackWarning(source),
    fallbackReason: options.fallbackReason,
    candidateCount: Math.max(1, options.candidateCount ?? 1),
    totalWeight: 1,
    chosenWeight: 1,
    winRate,
  };
}
