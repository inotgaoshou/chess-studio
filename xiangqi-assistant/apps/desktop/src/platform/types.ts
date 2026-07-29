export type Piece = { row: number; col: number; color: "red" | "black"; kind: string; label: string };
export type MoveSquare = { row: number; col: number };
export type Side = "红方" | "黑方";
export type MoveItem = {
  id: string;
  iccs: string;
  notation: string;
  movedBy: Side;
  from: MoveSquare;
  to: MoveSquare;
  scoreCp?: number;
  mate?: number;
  comment: string;
  isMainline: boolean;
};
export type BoardState = {
  fen: string;
  sideToMove: Side;
  status: string;
  pieces: Piece[];
  history: MoveItem[];
  branches: MoveItem[];
  currentNode?: string;
  title: string;
  note: string;
  sourcePath?: string;
  sourceFormat?: string;
  playable: boolean;
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
  searchMode: "time" | "depth" | "nodes" | "infinite";
  searchValue: number;
  threads: number;
  hashMb: number;
  multipv: number;
  serverUrl: string;
  token: string;
  searchMoves?: string[];
  excludeMove?: string;
};
export type ReportPhase = "opening" | "middle" | "endgame";
export type GameReportMoveDto = { nodeId: string; notation: string; movedBy: Side };
export type GameReportPositionDto = {
  fen: string;
  sideToMove: Side;
  ply: number;
  phase: ReportPhase;
  material?: number;
  scoreCp?: number;
  mate?: number;
  depth?: number;
  elapsedMs?: number;
  move?: GameReportMoveDto;
};
export type GameReportDatasetDto = {
  gameId: string;
  lineSignature: string;
  engineFingerprint: string;
  configHash: string;
  generatedAt: string;
  stale: boolean;
  positions: GameReportPositionDto[];
};
export type GameReportOptionsDto = {
  enginePath: string;
  searchMode: "time" | "depth" | "nodes" | "infinite";
  searchValue: number;
  threads: number;
  hashMb: number;
};
export type GameReportProgressDto = {
  completed: number;
  total: number;
  nodeId?: string;
  elapsedMs: number;
  state: "running" | "cancelled" | "complete";
};
export type SyncResult = { uploaded: number; downloaded: number; cursor: number };
export type DesktopPreferencesDto = {
  enginePath: string;
  threads: number;
  hashMb: number;
  multipv: number;
  searchMode: "time" | "depth" | "nodes" | "infinite";
  searchValue: number;
  moveTimeMs: number;
  ponder: boolean;
  autoAnalyze: boolean;
  libraryCollapsed: boolean;
  colorTheme: "light" | "dark";
  serverUrl: string;
};
export type SyncAccountDto = {
  serverUrl: string;
  userId?: string;
  email?: string;
  status: "unbound" | "signedOut" | "signedIn" | "expired";
  lastSyncResult?: string;
};
export type EngineProbeDto = { path: string; protocol: "uci" | "ucci" };
export type GameSummary = { id: string; title: string; fen: string; updatedAt: string; current: boolean };
export type EnginePlayOptions = { enginePath: string; moveTimeMs: number; threads: number; hashMb: number; ponder: boolean };
export type EngineMoveResult = { board: BoardState; ponder?: string };
export type EngineRuntimeState = "idle" | "analyzing" | "thinking" | "pondering" | "stopping" | "faulted";
export type EngineRuntimeEvent =
  | { type: "state"; state: EngineRuntimeState }
  | { type: "info"; fen: string; line: AnalysisLine }
  | { type: "bestmove"; fen: string; best: string; ponder?: string }
  | { type: "error"; message: string };

export interface ChessPlatform {
  readonly kind: "desktop" | "web";
  initialize(): Promise<Partial<BoardState>>;
  listGames(): Promise<GameSummary[]>;
  openGame(gameId: string): Promise<Partial<BoardState>>;
  detectEngine(): Promise<string | null>;
  getDesktopPreferences(): Promise<DesktopPreferencesDto>;
  saveDesktopPreferences(preferences: DesktopPreferencesDto): Promise<DesktopPreferencesDto>;
  chooseEngineExecutable(currentPath?: string): Promise<string | undefined>;
  probeEngine(path: string): Promise<EngineProbeDto>;
  playMove(iccs: string): Promise<Partial<BoardState>>;
  newGame(fen: string, title?: string, note?: string): Promise<Partial<BoardState>>;
  openDocument(): Promise<Partial<BoardState> | undefined>;
  saveDocument(saveAs?: boolean): Promise<string | undefined>;
  copyPosition(fen: string): Promise<void>;
  copyGame(mainlineOnly?: boolean): Promise<void>;
  pasteDocument(): Promise<Partial<BoardState>>;
  updateGameMetadata(title: string, note: string): Promise<Partial<BoardState>>;
  reorderBranches(nodeIds: string[]): Promise<Partial<BoardState>>;
  navigateTo(nodeId?: string): Promise<Partial<BoardState>>;
  updateComment(nodeId: string, comment: string): Promise<Partial<BoardState>>;
  setMainline(nodeId: string): Promise<Partial<BoardState>>;
  deleteNode(nodeId: string): Promise<Partial<BoardState>>;
  analyze(options: AnalysisOptions): Promise<AnalysisLine[]>;
  playEngineMove(options: EnginePlayOptions): Promise<EngineMoveResult>;
  moveNow(): Promise<boolean>;
  stopEnginePlay(): Promise<boolean>;
  stopAnalysis(discardResult?: boolean): Promise<boolean>;
  subscribeEngineEvents(listener: (event: EngineRuntimeEvent) => void): Promise<() => void>;
  generateGameReport(options: GameReportOptionsDto): Promise<GameReportDatasetDto>;
  cancelGameReport(): Promise<boolean>;
  getGameReport(): Promise<GameReportDatasetDto | undefined>;
  subscribeGameReportProgress(listener: (progress: GameReportProgressDto) => void): Promise<() => void>;
  loadSavedAnalysis(fen: string): Promise<AnalysisLine[]>;
  getSyncAccount(): Promise<SyncAccountDto>;
  registerSyncAccount(email: string, password: string): Promise<SyncAccountDto>;
  loginSyncAccount(email: string, password: string): Promise<SyncAccountDto>;
  logoutSyncAccount(): Promise<SyncAccountDto>;
  synchronize(serverUrl?: string, token?: string): Promise<SyncResult>;
}
