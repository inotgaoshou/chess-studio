export type SolutionMove = { iccs: string; comment: string; children: SolutionMove[] };

export type CblProblem = {
  sourceIndex: number;
  title: string;
  category: string;
  startingFen: string;
  note: string;
  solution: SolutionMove[];
};

export type CblLibrary = {
  title: string;
  declaredCount: number;
  problems: CblProblem[];
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
  mode: "solver" | "replay" | "free";
  elapsedMs: number;
  hintsUsed: number;
  mistakes: number;
  outcome: "completed" | "revealed" | "abandoned" | "free_finished";
  createdAt: string;
};

export type BoardPiece = { row: number; col: number; color: "red" | "black"; kind: string; label: string };
export type BoardState = { pieces: BoardPiece[]; sideToMove: string };
