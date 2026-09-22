export type SolutionMove = { iccs: string; comment: string; children: SolutionMove[] };

export type CblProblem = {
  sourceIndex: number;
  title: string;
  category: string;
  startingFen: string;
  note: string;
  solution: SolutionMove[];
  logic?: TrainingProblemLogic;
};

export type TrainingProblemLogic = {
  themes?: string[];
  goal?: string;
  firstMoveIdea?: string;
  keyDefense?: string;
  failureReason?: string;
  review?: string;
  hints?: string[];
  mistakes?: Record<string, string>;
};

export type CblLibrary = {
  title: string;
  declaredCount: number;
  problems: CblProblem[];
  warnings: string[];
};

export type CblManualGame = {
  sourceIndex: number;
  recordHash: string;
  title: string;
  note: string;
  startingFen: string;
  moves: string[];
  branches: LocalManualMoveBranch[];
  comments: Record<string, string>;
  metadata: LocalManualMetadata;
};

export type CblManualLibrary = {
  title: string;
  declaredCount: number;
  games: CblManualGame[];
  warnings: string[];
};

export type TrainingLibrary = {
  id: string;
  title: string;
  fingerprint: string;
  parserVersion: number;
  problemCount: number;
  completedCount: number;
  importedAt: string;
};

export type TrainingProblem = CblProblem & {
  id: string;
  libraryId: string;
  completedAttempts: number;
  totalElapsedMs: number;
};

export type Attempt = {
  id: string;
  problemId: string;
  mode: "cloud" | "ai" | "solver" | "replay" | "free";
  elapsedMs: number;
  hintsUsed: number;
  mistakes: number;
  outcome: "completed" | "revealed" | "abandoned" | "free_finished";
  createdAt: string;
};

export type BoardPiece = { row: number; col: number; color: "red" | "black"; kind: string; label: string };
export type RuleMode = "domestic2020" | "asianAxf";
export type BoardState = { fen: string; pieces: BoardPiece[]; sideToMove: string; status: string; ruleMode?: RuleMode; ruleStatus?: string; ruleReason?: string };

export type MobileWorkspaceMode = "training" | "study" | "manual";

export type LocalManualFolder = {
  path: string;
  createdAt: string;
};

export type LocalManualMoveBranch = {
  id: string;
  parentCursor: number;
  parentPath: string[];
  moves: string[];
  notation: string[];
  createdAt: number;
  branchOrder?: number;
};

export type LocalManualMetadata = {
  event: string;
  redPlayer: string;
  blackPlayer: string;
  playedAt: string;
  gameType: "full" | "middle" | "endgame";
  result: "unknown" | "first-win" | "first-loss" | "draw" | "multiple";
};

export type LocalManualGame = {
  metadata?: LocalManualMetadata;
  id: string;
  title: string;
  note: string;
  folderPath?: string;
  startingFen: string;
  currentNodeId: string;
  currentFen: string;
  moves: string[];
  cursor: number;
  branches: LocalManualMoveBranch[];
  comments: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type LocalManualAnalysisSummary = {
  gameId: string;
  nodeId: string;
  fen: string;
  scoreCp?: number;
  mate?: number;
  depth: number;
  bestMove: string;
  pv: string[];
  updatedAt: string;
};
