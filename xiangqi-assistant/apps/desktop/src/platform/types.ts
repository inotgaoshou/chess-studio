export type Piece = { row: number; col: number; color: "red" | "black"; kind: string; label: string };
export type MoveSquare = { row: number; col: number };
export type MoveItem = {
  id: string;
  iccs: string;
  notation: string;
  movedBy: "红方" | "黑方";
  from: MoveSquare;
  to: MoveSquare;
  scoreCp?: number;
  mate?: number;
  comment: string;
  isMainline: boolean;
};
export type BoardState = {
  fen: string;
  sideToMove: string;
  status: string;
  pieces: Piece[];
  history: MoveItem[];
  branches: MoveItem[];
  currentNode?: string;
};
export type AnalysisLine = {
  depth?: number;
  scoreCp?: number;
  mate?: number;
  nps?: number;
  timeMs?: number;
  multipv: number;
  notation?: string[];
  pv: string[];
};
export type AnalysisOptions = {
  enginePath: string;
  fen: string;
  searchMode: "time" | "depth" | "infinite";
  searchValue: number;
  threads: number;
  hashMb: number;
  multipv: number;
  serverUrl: string;
  token: string;
};
export type SyncResult = { uploaded: number; downloaded: number; cursor: number };
export type GameSummary = { id: string; title: string; fen: string; updatedAt: string; current: boolean };

export interface ChessPlatform {
  readonly kind: "desktop" | "web";
  initialize(): Promise<Partial<BoardState>>;
  listGames(): Promise<GameSummary[]>;
  openGame(gameId: string): Promise<Partial<BoardState>>;
  detectEngine(): Promise<string | null>;
  playMove(iccs: string): Promise<Partial<BoardState>>;
  newGame(fen: string): Promise<Partial<BoardState>>;
  navigateTo(nodeId?: string): Promise<Partial<BoardState>>;
  updateComment(nodeId: string, comment: string): Promise<Partial<BoardState>>;
  setMainline(nodeId: string): Promise<Partial<BoardState>>;
  deleteNode(nodeId: string): Promise<Partial<BoardState>>;
  analyze(options: AnalysisOptions): Promise<AnalysisLine[]>;
  stopAnalysis(): Promise<boolean>;
  loadSavedAnalysis(fen: string): Promise<AnalysisLine[]>;
  synchronize(serverUrl: string, token: string): Promise<SyncResult>;
}
