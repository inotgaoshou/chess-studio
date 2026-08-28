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
export type ManualTreeNode = {
  move: MoveItem;
  children: ManualTreeNode[];
};
export type BoardState = {
  fen: string;
  rootSideToMove: Side;
  rootScoreCp?: number;
  rootMate?: number;
  sideToMove: Side;
  status: string;
  ruleName?: string;
  ruleVerdict?: string;
  ruleReason?: string;
  pieces: Piece[];
  history: MoveItem[];
  continuation: MoveItem[];
  branches: MoveItem[];
  siblingBranches?: MoveItem[];
  manualTree?: ManualTreeNode[];
  currentNode?: string;
  title: string;
  note: string;
  sourcePath?: string;
  sourceFormat?: string;
  playable: boolean;
  xqbCandidates?: XqbCandidate[];
};
export type XqbCandidate = {
  iccs: string;
  notation: string;
  score: number;
  win: number;
  draw: number;
  loss: number;
  winRate?: number;
  memo?: string;
  source: string;
};
export type CloudBookCandidate = {
  iccs: string;
  notation: string;
  score: number;
  rank?: number;
  winRate?: number;
  memo?: string;
  source: string;
  cached: boolean;
};
export type FlyknifeSide = "red" | "black";
export type FlyknifeStepRole = "setup" | "lure" | "knife" | "bestDefense";
export type FlyknifeStepAnnotation = {
  role: FlyknifeStepRole;
  iccs: string;
  notation: string;
  side: Side;
  fen?: string;
  scoreCp?: number;
  swingCp?: number;
  intent: string;
  note?: string;
};
export type AppInfoDto = { version: string; buildTimestamp: number; platform: string };
export type FlyknifeTemplate = { id: string; name: string; moves: string[]; fen: string };
export type FlyknifeTopic = { id: string; title: string; opening: string; category: string; source: string; moveCount: number };
export type DiagramCheckpoint = { label: string; ply: number; imagePath?: string; note: string };
export type BookLessonNode = {
  id: string;
  title: string;
  ply: number;
  prompt: string;
  expectedMove: string;
  answer: string;
  explanation: string;
  bookVariation?: string;
  practiceLine?: string[];
  lessonKind?: "flyknife" | "practicalDefense" | "trap";
  /** Training-desk prompts shown before the book answer is revealed. */
  thinkingHints?: string[];
  /** The canonical first move in the book line, retained separately from display text. */
  bookFirstMove?: string;
  /** Forced book moves applied before the learner begins a response exercise. */
  preludeNotation?: string[];
  /** Validated ICCS target line for temporary-board comparison. */
  targetVariation?: string[];
  variationNotation?: string[];
  variationNotes?: string[];
};
export type BookSourceMetadata = { bookTitle: string; page: string; gameNo: string; authorization: string; sourceKind: "book" | "userImport" };
export type BookTopicDetail = {
  topicId: string;
  source: BookSourceMetadata;
  redPlayer: string;
  blackPlayer: string;
  eventName: string;
  result: string;
  rawTranscript: string;
  teaching: { situation: string; lure: string; knife: string; defense: string; practice: string };
  flyknifeStatus: "bookClaimPendingEngine" | "engineVerified";
  images: string[];
  diagramCheckpoints: DiagramCheckpoint[];
  mainline: string[];
  checkpointFens?: string[];
  masterGameId?: string;
  sourceUrl?: string;
  lessonNodes?: BookLessonNode[];
};
export type BookImportDraft = {
  imagePath: string;
  rawText: string;
  confidence: number;
  title: string;
  redPlayer: string;
  blackPlayer: string;
  eventName: string;
  movesText: string;
  warnings: string[];
};
export type SaveBookImportRequest = {
  imagePath: string;
  rawText: string;
  title: string;
  redPlayer: string;
  blackPlayer: string;
  eventName: string;
  movesText: string;
};
export type FlyknifePlan = { id?: string; title: string; side: FlyknifeSide; startingFen: string; templateId?: string; templateName: string; lureMove: string; knifeMove: string; mainline: string[]; bestDefense: string[]; scoreCp?: number; mate?: number; baselineScoreCp?: number; swingCp?: number; verification?: "资料案例" | "待验证候选" | "已验证飞刀"; verificationDepth?: number; risk: string; sourceGameId?: string; sourceNodeId?: string; note: string; annotations?: FlyknifeStepAnnotation[] };
export type FlyknifeCandidate = { setupMove?: string; setupNotation?: string; lureMove: string; lureNotation?: string; knifeMove: string; mainline: string[]; notation: string[]; bestDefense: string[]; bestDefenseNotation: string[]; scoreCp?: number; baselineScoreCp?: number; swingCp?: number; mate?: number; verification?: "资料案例" | "待验证候选" | "已验证飞刀"; verificationDepth?: number; risk: string; annotations?: FlyknifeStepAnnotation[] };
export type GenerateFlyknifeRequest = { startingFen: string; side: FlyknifeSide; setupMove?: string; lureMove: string; enginePath: string; threads: number; hashMb: number; searchMode: "time" | "depth" | "nodes"; searchValue: number };
export type AnalysisLine = {
  depth?: number;
  scoreCp?: number;
  mate?: number;
  nps?: number;
  timeMs?: number;
  hashfull?: number;
  multipv: number;
  notation?: string[];
  pv: string[];
};
export type PreviewLineStep = {
  fen: string;
  notation: string;
  movedBy: Side;
  from: MoveSquare;
  to: MoveSquare;
  pieces: Piece[];
  status: string;
};
export type RecognizedLastMovePreview = PreviewLineStep & { beforeFen: string; afterFen: string; sideToMove: Side; captured: boolean; markerKind?: "lastMove" | "selectedMove"; recognitionSource?: string; recognitionConfidence?: number };
export type ScreenshotMoveResolution = {
  status: "unique" | "ambiguous" | "noExactMatch";
  candidates: RecognizedLastMovePreview[];
  orientation: BoardOrientation;
  currentPieces: Piece[];
  currentSideToMove: Side;
  reason?: string;
};
export type AnalysisOptions = {
  enginePath: string;
  engineId?: string;
  engineName?: string;
  analysisSessionId?: number;
  fen: string;
  searchMode: "time" | "depth" | "nodes" | "infinite";
  searchValue: number;
  threads: number;
  hashMb: number;
  multipv: number;
  serverUrl: string;
  token: string;
  /** Mobile web workbench may use an explicitly enabled guest analysis service. */
  guest?: boolean;
  searchMoves?: string[];
  excludeMove?: string;
};
export type ReportPhase = "opening" | "middle" | "endgame";
export type QualityGrade = "优" | "良" | "中" | "差" | "错";
export type GameReportMoveDto = { nodeId: string; iccs?: string; notation: string; movedBy: Side };
export type OpeningBookHitDto = { code: string; name: string; ply: number; source: string };
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
  cached?: boolean;
  bestIccs?: string;
  bestNotation?: string;
  pvNotation?: string[];
  opening?: OpeningBookHitDto;
  masterStyleHints?: MasterStyleHintDto[];
  move?: GameReportMoveDto;
};
export type MasterStyleTheoryCardRefDto = {
  id: number;
  title: string;
  summary: string;
  sourceBook?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
};
export type MasterStyleHintDto = {
  sampleId: string;
  profileId: string;
  playerName: string;
  confidence: "exact" | "similar" | string;
  reason: string;
  sourceTitle: string;
  eventName?: string;
  gameDate?: string;
  ply: number;
  phase: ReportPhase | string;
  beforeFen: string;
  playedMove: string;
  playedMoveRank?: number;
  playedMoveInTopn: boolean;
  bestMove?: string;
  bestScoreCp?: number;
  theoryCards: MasterStyleTheoryCardRefDto[];
};
export type GameReportDatasetDto = {
  gameId: string;
  lineSignature: string;
  engineFingerprint: string;
  configHash: string;
  generatedAt: string;
  stale: boolean;
  analysisDepth?: number;
  cachedPositions?: number;
  positions: GameReportPositionDto[];
};
export type GameReportOptionsDto = {
  enginePath: string;
  reportDepth: number;
  xqbBookPaths?: string[];
  threads: number;
  hashMb: number;
};
export type GameReportProgressDto = {
  completed: number;
  total: number;
  nodeId?: string;
  elapsedMs: number;
  targetDepth?: number;
  currentDepth?: number;
  cached?: number;
  estimatedRemainingMs?: number;
  state: "running" | "cancelled" | "complete";
};
export type ReportQualityCountsDto = {
  excellent: number;
  good: number;
  average: number;
  poor: number;
  error: number;
  missedMate: number;
};
export type ReportSidePresentationDto = {
  side: Side;
  overall?: number;
  grade?: QualityGrade;
  phases: Record<ReportPhase, number | undefined>;
  phaseGrades: Record<ReportPhase, QualityGrade | undefined>;
  counts: ReportQualityCountsDto;
  coachQuality: QualityGrade | "样本不足";
  coachSummary: string;
  dimensions: Record<"opening" | "middle" | "endgame" | "accuracy" | "stability", number | undefined>;
};
export type MoveCoachInsightDto = {
  intent: string;
  weakness: string;
  solution: string;
  branchPlan: string;
};
export type BranchCoachInsightDto = {
  branchName: string;
  branchPurpose: string;
  namingTips: string[];
  weaknessFixes: string[];
  studyPlan: string[];
};
export type ReportIssuePresentationDto = {
  nodeId: string;
  notation: string;
  movedBy: Side;
  lossCp: number;
  score: number;
  grade: QualityGrade;
  missedMate: boolean;
  redScoreCp: number;
  deltaCp: number;
  opening?: OpeningBookHitDto;
  bestIccs?: string;
  bestNotation?: string;
  pvNotation?: string[];
  masterStyleHints?: MasterStyleHintDto[];
  trainingTags?: string[];
  reviewPrompt?: string;
  coach: MoveCoachInsightDto;
};
export type GameReportPresentationDto = {
  title: string;
  generatedAt: string;
  stale: boolean;
  analysisDepth?: number;
  engineLabel: string;
  totalElapsedMs: number;
  cachedPositions: number;
  openingSummary?: { code: string; name: string; officialMoves: number; source: string };
  red: ReportSidePresentationDto;
  black: ReportSidePresentationDto;
  coachInsights: BranchCoachInsightDto;
  trend: Array<{ label: string; scoreCp: number; nodeId?: string; deltaCp?: number }>;
  issues: ReportIssuePresentationDto[];
  standards: Array<{ grade: QualityGrade; qualityRange: string; description: string }>;
  scoreGuide: Array<{ scoreCp: number; label: string }>;
  disclaimer: string;
};
export type SyncResult = { uploaded: number; downloaded: number; cursor: number };
export type MasterStyleProfileDto = {
  id: string;
  playerName: string;
  normalizedName: string;
  version: string;
  sampleCount: number;
  generatedAt: string;
  profileJson: string;
  importedAt: string;
};
export type MasterStyleImportResultDto = { profiles: MasterStyleProfileDto[]; importedSamples: number };
export const BUILTIN_ENGINE_PATH = "builtin:pikafish";
export const DEFAULT_BUILTIN_OPENING_BOOK_ID = "learning-top3";
export type WorkspaceLayoutMode = "studio" | "compact";
export type ManualViewMode = "track" | "tree";
export type RuleMode = "domestic2020" | "asianAxf";
export type SkinFolder = "default" | "hongmu" | "jingdian" | "xinghe" | "qingxin-zhuyun";
export type LegacySkinId = "original" | "classic" | "neon" | "jade" | "imperial";
export type SkinId = SkinFolder | LegacySkinId;
export type BuiltinOpeningBookVerificationDto = {
  status: "verified" | "unverified" | string;
  note: string;
  expectedStartingVkey?: number;
  calculatedStartingVkey?: number;
};
export type BuiltinOpeningBookDto = {
  id: string;
  name: string;
  shortName: string;
  kind: "learning" | "complete" | "observation" | string;
  fileName: string;
  description: string;
  rowCount: number;
  positionCount: number;
  maxCandidatesPerPosition: number;
  sha256: string;
  default: boolean;
};
export type BuiltinOpeningBookManifestDto = {
  version: string;
  defaultBookId: string;
  internalUseOnly: boolean;
  vkeyVerification: BuiltinOpeningBookVerificationDto;
  books: BuiltinOpeningBookDto[];
};
export const FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST: BuiltinOpeningBookManifestDto = {
  version: "2026-08-11-study-v1",
  defaultBookId: DEFAULT_BUILTIN_OPENING_BOOK_ID,
  internalUseOnly: true,
  vkeyVerification: {
    status: "unverified",
    note: "FEN to pfBook vkey is not verified yet; realtime pfBook candidates are hidden.",
    expectedStartingVkey: 7101337512282506414,
  },
  books: [
    {
      id: "learning-top3",
      name: "学习精选 Top3",
      shortName: "学习精选",
      kind: "learning",
      fileName: "02_learning_top3.pfBook",
      description: "每个局面最多保留 3 个候选，默认用于孩子复盘和背布局。",
      rowCount: 2148653,
      positionCount: 2120232,
      maxCandidatesPerPosition: 3,
      sha256: "9aa012a23970cc7347d9e38a8ccea68161d61c0715de177090680483bd0efe20",
      default: true,
    },
    {
      id: "complete-compatible",
      name: "完整兼容库",
      shortName: "完整库",
      kind: "complete",
      fileName: "01_complete_compatible.pfBook",
      description: "覆盖优先，适合给软件或引擎加载，候选分支较多。",
      rowCount: 2149843,
      positionCount: 2120232,
      maxCandidatesPerPosition: 32,
      sha256: "8337fff4f7f815e56c509df58bd28458dcf3f8c8a5f4f4428013e6a1c2dca361",
      default: false,
    },
    {
      id: "obk-observation",
      name: "obk 独有观察库",
      shortName: "观察库",
      kind: "observation",
      fileName: "04_obk_unique_observation.pfBook",
      description: "只含徐风依旧 obk 的独有安全补充，用于研究，不默认混入学习主线。",
      rowCount: 68036,
      positionCount: 67269,
      maxCandidatesPerPosition: 19,
      sha256: "2fc8e1108ea60773ccb504d213d2d43c4c3368ab6a515ffca845c9e76c43d06a",
      default: false,
    },
  ],
};
export type DesktopPreferencesDto = {
  enginePath: string;
  threads: number;
  hashMb: number;
  multipv: number;
  candidateLineMoves: number;
  searchMode: "time" | "depth" | "nodes" | "infinite";
  searchValue: number;
  moveTimeMs: number;
  ponder: boolean;
  autoAnalyze: boolean;
  libraryCollapsed: boolean;
  candidateRailCollapsed: boolean;
  analysisPanelCollapsed: boolean;
  evaluationCollapsed: boolean;
  branchArrowColor: string;
  workspacePanel: "moves" | "analysis" | "trend" | "summary" | "report" | "theory";
  layoutMode: WorkspaceLayoutMode;
  manualViewMode: ManualViewMode;
  colorTheme: "light" | "dark";
  boardSkin: SkinId;
  pieceSkin: SkinId;
  reportDepth: number;
  xqbBookPaths?: string[];
  disabledXqbBookPaths?: string[];
  eleeyeBookPaths?: string[];
  disabledEleeyeBookPaths?: string[];
  builtinOpeningBookEnabled: boolean;
  activeBuiltinOpeningBookId: string;
  activeEngineId?: string;
  analysisEngineMode: "single" | "parallel";
  parallelEngineIds: string[];
  parallelEnginePaths?: string[];
  cloudBookEnabled?: boolean;
  cloudBookUrl?: string;
  ruleMode: RuleMode;
  linkCaptureSource?: CaptureSource;
  linkRecognitionMode?: RecognitionMode;
  linkMode?: LinkMode;
  linkStableFrames?: number;
  linkConfidenceThreshold?: number;
  linkAnimationConfirmation?: boolean;
  gameMirrorEnabled?: boolean;
  gameMirrorRoot?: string;
  serverUrl: string;
};
export type GameMirrorStatus = { gameId: string; path?: string; state: "pending" | "synced" | "failed" | "disabled"; updatedAt?: string; error?: string };
export type SyncAccountDto = {
  serverUrl: string;
  userId?: string;
  email?: string;
  status: "unbound" | "signedOut" | "signedIn" | "expired";
  lastSyncResult?: string;
};
export type MasterPlayerDto = {
  id: string;
  name: string;
  sourceSite: string;
  sourcePlayerId: string;
  profileUrl: string;
  gameCount: number;
};
export type MasterLibraryStatsDto = {
  totalPlayers: number;
  totalGames: number;
  matchedPlayers: number;
};
export type MasterOpeningProfileDto = {
  playerId: string;
  playerName: string;
  gameCount: number;
  redGames: number;
  blackGames: number;
  wins: number;
  draws: number;
  losses: number;
};
export type MasterGameSummaryDto = {
  id: string;
  title: string;
  redPlayer: string;
  blackPlayer: string;
  masterSide?: "red" | "black" | string;
  eventName?: string;
  gameDate?: string;
  result: string;
  moveCount: number;
  sourceUrl: string;
  openingTags?: string[];
};
export type RelatedMasterGame = MasterGameSummaryDto & {
  matchKind: "exact" | "position" | "opening";
  matchedPly: number;
  matchedFen: string;
  divergenceMove?: string;
  matchLabel: string;
};
export type MasterGameDetailDto = MasterGameSummaryDto & {
  moves: string[];
  pgn: string;
};
export type MasterLibraryPageOptions = {
  limit?: number;
  offset?: number;
};
export type MasterLibraryFilters = {
  side?: "red" | "black";
  opening?: "middle-cannon" | "third-pawn" | "middle-cannon-third-pawn";
  year?: number;
};
export type SubscriptionDto = {
  plan: "free" | "pro";
  status: "inactive" | "active";
  source: string;
  startsAt: string;
  expiresAt: string;
  cloudAnalysisQuota: number;
  cloudAnalysisUsed: number;
};
export type CloudAuthDto = { userId: string; token: string };
export type CloudGuestAuthDto = {
  token: string;
  tokenType: "guest";
  expiresAt: string;
  guestQuotaLimit: number;
  guestQuotaRemaining: number;
  guestQuotaResetsAt: string;
};
export type CloudAnalysisPreferences = {
  serverUrl: string;
  token: string;
  guestToken?: string;
  guestTokenExpiresAt?: string;
  guestQuotaLimit?: number;
  guestQuotaRemaining?: number;
  guestQuotaResetsAt?: string;
  multipv: number;
  searchMode: "time" | "depth";
  searchValue: number;
  autoAnalyze: boolean;
  mobileDefaultDepthVersion?: number;
};
export type TrainingTaskDto = {
  id: string;
  gameId: string;
  nodeId: string;
  title: string;
  detail: string;
  phase?: ReportPhase | "复盘";
  tags?: string[];
  sourceCardId?: number;
  taskType: "critical" | "reinforcement";
  sourceType?: "report" | "opening-route" | "flyknife" | string;
  trainingMode?: "guided-analysis" | "standard-route" | "opening-deviation" | "flyknife-defense" | string;
  openingName?: string;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  mastered?: boolean;
  completedAt?: string;
  createdAt: string;
};
export type TrainingGenerationResultDto = {
  tasks: TrainingTaskDto[];
  criticalCount: number;
  reinforcementCount: number;
};
export type LearningProfile = {
  id: string;
  childName: string;
  level: string;
  ageGroup: "U10" | string;
  sessionMinutes: number;
  coachMode: string;
  cycleWeeks: number;
  personalRatio: number;
  thematicRatio: number;
  currentWeek: number;
  createdAt: string;
  updatedAt: string;
};
export type GuidedAnalysisSubmission = {
  threats: string;
  forcingMoves: string;
  worstPiece: string;
  candidates: string[];
  chosenMove: string;
  predictedLine: string[];
  confidence: number;
  elapsedSeconds: number;
  hintsUsed: number;
};
export type GuidedAnalysisSession = {
  id: string;
  gameId: string;
  problemNodeId?: string;
  startNodeId?: string;
  reportSignature: string;
  fen: string;
  phase: ReportPhase | string;
  status: "thinking" | "submitted" | "cancelled" | string;
  answerHidden: boolean;
  submission?: GuidedAnalysisSubmission;
  resultKind?: string;
  score?: number;
  resultJson?: string;
  startedAt: string;
  submittedAt?: string;
};
export type GuidedEngineLine = Pick<AnalysisLine, "depth" | "scoreCp" | "mate" | "multipv" | "notation" | "pv">;
export type GuidedAnalysisResult = {
  sessionId: string;
  resultKind: "correct" | "direction" | "missedCounterplay" | "principle" | string;
  resultLabel: "计算正确" | "方向正确" | "漏算反击" | "原则问题" | string;
  score: number;
  chosenRank?: number;
  missedCounterplay: boolean;
  scoreCp?: number;
  mate?: number;
  lines: GuidedEngineLine[];
  theorySignals: string[];
  trainingAdvice: string;
};
export type TrainingAttempt = {
  id: string;
  taskId: string;
  sessionId?: string;
  submission: GuidedAnalysisSubmission;
  score: number;
  resultKind: string;
  parentNote: string;
  reviewRound: number;
  nextReviewAt?: string;
  mastered: boolean;
  createdAt: string;
};
export type GuidedAnalysisStart = { session: GuidedAnalysisSession; board: BoardState };
export type GuidedAnalysisSubmissionResult = { session: GuidedAnalysisSession; result: GuidedAnalysisResult; attempt?: TrainingAttempt };
export type ChineseLineParseResult = { moves: string[]; steps: PreviewLineStep[] };
export type DailyTrainingPlan = {
  date: string;
  week: number;
  phaseTitle: string;
  totalMinutes: number;
  personalRatio: number;
  thematicRatio: number;
  segments: Array<{
    key: string;
    title: string;
    minutes: number;
    targetTags: string[];
    completionHint: string;
    items: Array<{ taskId?: string; source: string; title: string; minutes: number; due: boolean }>;
  }>;
};
export type WeeklyLearningReport = {
  weekStart: string;
  weekEnd: string;
  attempts: number;
  averageScore?: number;
  hintFreeRate?: number;
  averageSeconds?: number;
  masteredTasks: number;
  resultCounts: Record<string, number>;
  weakTags: string[];
  parentSummary: string;
  nextFocus: string;
};
export type OpeningRepertoire = {
  sampledGames: number;
  red: OpeningSystem[];
  black: OpeningSystem[];
  enoughData: boolean;
  note: string;
};
export type OpeningSystem = {
  name: string;
  games: number;
  wins?: number;
  draws?: number;
  losses?: number;
  averageQuality?: number;
  recentTrend?: "improving" | "stable" | "declining";
  typicalDeviation?: string;
  trainingMode?: "standard-route" | "opening-deviation";
};
export type StudySessionDto = {
  id: string;
  gameId: string;
  nodeId?: string;
  reflection: string;
  tags: string[];
  createdAt: string;
};
export type TheoryPhase = "opening" | "middle" | "endgame";
export type TheoryLessonDto = {
  id: number;
  phase: TheoryPhase;
  courseName: string;
  title: string;
  sourcePath: string;
  fingerprint: string;
  transcriptionStatus: "queued" | "processing" | "complete" | "failed";
  durationMs?: number;
  scannedAt: string;
};
export type TheoryCardDto = {
  id: number;
  externalId?: string;
  lessonId: number;
  phase: TheoryPhase;
  title: string;
  summary: string;
  appliesWhen: string;
  risk: string;
  timecode?: string;
  reviewStatus: "pending" | "approved" | "rejected";
  courseName: string;
  lessonTitle: string;
  sourceBook?: string;
  sourcePageStart?: number;
  sourcePageEnd?: number;
  tags: string[];
  engineCorrelations: string[];
  origin: "bundled" | "user" | "imported" | string;
  version: number;
  userModified: boolean;
  matchPenalty: number;
  needsRecheck: boolean;
};
export type TheoryLibraryDto = { lessons: TheoryLessonDto[]; cards: TheoryCardDto[]; downloadingFiles: number };
export type TheoryCardFeedbackDto = {
  id: string;
  matchId?: string;
  cardId: number;
  cardVersion: number;
  verdict: "correct" | "incorrect" | "needs_revision";
  note: string;
  createdAt: string;
};
export type WeaknessStatDto = {
  phase: ReportPhase | "复盘" | string;
  tag: string;
  occurrences: number;
  completedTasks: number;
  openTasks: number;
  reviewCards: TheoryCardDto[];
};
export type TrainingSummaryDto = { weakSpots: WeaknessStatDto[] };
export type EngineProbeDto = {
  path: string;
  protocol: "uci" | "ucci";
  engineVersion?: string;
  engineSha256?: string;
  nnueFile?: string;
  nnueVersion?: string;
  nnueSha256?: string;
  fingerprint?: string;
};
export type EngineProfileDto = { id: string; name: string; executablePath: string; protocol: "uci" | "ucci"; active: boolean };
export type EngineArenaPlayerDto = { name: string; enginePath: string };
export type EngineArenaOptionsDto = {
  playerA: EngineArenaPlayerDto;
  playerB: EngineArenaPlayerDto;
  games: number;
  moveTimeMs: number;
  threads: number;
  hashMb: number;
  maxPlies: number;
};
export type EngineArenaGameDto = {
  index: number;
  red: string;
  black: string;
  result: string;
  winner?: string;
  reason: string;
  plies: number;
  moves: string[];
};
export type EngineArenaScoreDto = { name: string; wins: number; draws: number; losses: number; points: number };
export type EngineArenaResultDto = {
  playerA: EngineArenaScoreDto;
  playerB: EngineArenaScoreDto;
  games: EngineArenaGameDto[];
  moveTimeMs: number;
  maxPlies: number;
  ruleName: string;
  summary: string;
};
export type GameSummary = { id: string; title: string; fen: string; updatedAt: string; current: boolean; libraryFolder?: string; favorite: boolean; tags: string[]; sourceFormat?: string; sourceOrder?: number; red?: string; black?: string; date?: string; result?: string; event?: string; round?: string; playedAt?: string; duration?: string; timeControl?: string; moveCount?: number; mirror?: GameMirrorStatus };
export type GameMetadata = { title: string; event: string; site: string; date: string; red: string; black: string; result: string; note: string };
export type LibraryFolder = { name: string; system: boolean; gameCount: number };
export type EnginePlayOptions = { enginePath: string; moveTimeMs: number; threads: number; hashMb: number; ponder: boolean };
export type EngineMoveResult = { board: BoardState; ponder?: string };
export type EngineRuntimeState = "idle" | "analyzing" | "thinking" | "pondering" | "stopping" | "faulted";
export type CaptureSource = "windowLink" | "desktopDetect" | "imageImport" | "cameraBoard";
export type RecognitionMode = "yoloBoard" | "perspectiveGrid";
export type LinkMode = "spectate" | "confirmPlay" | "autoPlay";
export type LinkSessionState = "stopped" | "detectingCorners" | "rectifyingBoard" | "classifyingSquares" | "calibrating" | "needsManualCorrection" | "waitingStableFrames" | "tracking" | "paused";
export type LinkAutoSide = "red" | "black";
export type LinkTargetWindow = { id: string; title: string; processName: string; clientWidth: number; clientHeight: number; dpi: number; available: boolean; unavailableReason?: string };
export type StartLinkSessionRequest = { source: CaptureSource; recognitionMode: RecognitionMode; mode: LinkMode; stableFrames: number; autoSide?: LinkAutoSide; targetWindowId?: string };
export type LinkObservation = { state: LinkSessionState; accepted: boolean; moveIccs?: string; reason?: string; board?: BoardState; orientation?: BoardOrientation; capturePreviewAvailable?: boolean };
export type BoardOrientation = "redAtBottom" | "blackAtBottom";
export type LinkMoveDetail = { iccs: string; notation: string; movedBy: Side; from: MoveSquare; to: MoveSquare };
export type LinkSessionStatus = { source: CaptureSource; mode: LinkMode; state: LinkSessionState; reason?: string; phase?: string; lastError?: string; startedAt?: string; lastHeartbeatAt?: string; recognitionAttempts?: number; lastDetectionSummary?: string; turnIndicator?: string; manualTurnOverride?: LinkAutoSide; pendingExternalMove?: string; capturePreviewKind?: string; frameRate: number; confidence?: number; confidenceThreshold?: number; stableFrames: number; requiredStableFrames: number; latestFen?: string; lastMove?: string; lastMoveDetail?: LinkMoveDetail; initialPositionSeen?: boolean; autoSide?: LinkAutoSide; boardOrientation?: BoardOrientation; captureRunning: boolean; targetWindow?: LinkTargetWindow; captureBackend?: string; captureDpi?: number; clickAvailable?: boolean };
export type TtxqSyncProgress = { state: "disconnected" | "authorizing" | "reading" | "ready" | "importing" | "complete" | "partial" | "error" | string; readPhase?: "discovering" | "loading" | "reading" | string; readScanned?: number; readCurrent?: number; readTotal: number; readCompleted: number; readFailed: number; loaded: number; completed: number; imported: number; skipped: number; failed: number; message: string };
export type TtxqGamePreview = { qipuId: string; title: string; red: string; black: string; event: string; date: string; result: string; round: string; playedAt: string; duration: string; moveCount: number; variationCount: number; branchComplete: boolean; valid: boolean; error?: string; diagnostic?: string };
export type TtxqDiagnosticSample = { id: number; qipuId: string; fieldPath: string; valueType: string; valueLength: number; rawSample: string; error: string; capturedAt: string };
export type ExportFormat = "pgn" | "chinese" | "dhtmlxq";
export type ReplayExportScope = "currentSelection" | "mainline";
export type EngineRuntimeEvent =
  | { type: "state"; state: EngineRuntimeState }
  | { type: "info"; fen: string; line: AnalysisLine }
  | { type: "analysisInfo"; engineId?: string; engineName?: string; analysisSessionId?: number; fen: string; line: AnalysisLine }
  | { type: "bestmove"; fen: string; best: string; ponder?: string }
  | { type: "error"; message: string };

export interface ChessPlatform {
  readonly kind: "desktop" | "web";
  initialize(): Promise<Partial<BoardState>>;
  getAppInfo(): Promise<AppInfoDto>;
  listGames(): Promise<GameSummary[]>;
  deleteGames(gameIds: string[]): Promise<void>;
  getGameMetadata(gameId: string): Promise<GameMetadata>;
  updateGameMetadataForGame(gameId: string, metadata: GameMetadata): Promise<Partial<BoardState>>;
  listLibraryFolders(): Promise<LibraryFolder[]>;
  createLibraryFolder(name: string): Promise<void>;
  renameLibraryFolder(previous: string, next: string): Promise<void>;
  deleteLibraryFolder(name: string): Promise<void>;
  updateGameLibrary(folder: string | undefined, favorite: boolean, tags: string[]): Promise<Partial<BoardState>>;
  getGameMirrorStatus(gameId?: string): Promise<GameMirrorStatus | undefined>;
  updateGameMirror(): Promise<GameMirrorStatus>;
  rebuildGameMirrors(): Promise<GameMirrorStatus[]>;
  chooseGameMirrorRoot(): Promise<string | undefined>;
  revealGameMirror(): Promise<void>;
  openGame(gameId: string): Promise<Partial<BoardState>>;
  detectEngine(): Promise<string | null>;
  getDesktopPreferences(): Promise<DesktopPreferencesDto>;
  saveDesktopPreferences(preferences: DesktopPreferencesDto): Promise<DesktopPreferencesDto>;
  listBuiltinOpeningBooks(): Promise<BuiltinOpeningBookManifestDto>;
  chooseEngineExecutable(currentPath?: string): Promise<string | undefined>;
  probeEngine(path: string): Promise<EngineProbeDto>;
  listEngineProfiles(): Promise<EngineProfileDto[]>;
  registerEngineProfile(name: string, path: string): Promise<EngineProfileDto>;
  setActiveEngineProfile(id: string): Promise<DesktopPreferencesDto>;
  deleteEngineProfile(id: string): Promise<DesktopPreferencesDto>;
  queryCloudOpeningBook(fen: string): Promise<CloudBookCandidate[]>;
  listFlyknifeTemplates(): Promise<FlyknifeTemplate[]>;
  listFlyknifeTopics(): Promise<FlyknifeTopic[]>;
  getBookTopicDetail(topicId: string): Promise<BookTopicDetail | undefined>;
  recognizeBookPage(imagePath: string): Promise<BookImportDraft>;
  saveBookImport(request: SaveBookImportRequest): Promise<Partial<BoardState>>;
  openExternalUrl(url: string): Promise<void>;
  openFlyknifeTopic(id: string): Promise<Partial<BoardState>>;
  generateFlyknifeCandidates(request: GenerateFlyknifeRequest): Promise<FlyknifeCandidate[]>;
  listFlyknifePlans(): Promise<FlyknifePlan[]>;
  saveFlyknifePlan(plan: FlyknifePlan): Promise<FlyknifePlan>;
  deleteFlyknifePlan(id: string): Promise<void>;
  openFlyknifePractice(id: string): Promise<Partial<BoardState>>;
  listCoachReports(): Promise<GameReportDatasetDto[]>;
  listMasterPlayers(query?: string, options?: MasterLibraryPageOptions): Promise<MasterPlayerDto[]>;
  getMasterLibraryStats(query?: string): Promise<MasterLibraryStatsDto>;
  getMasterOpeningProfile(playerId: string): Promise<MasterOpeningProfileDto>;
  listMasterGames(playerId: string, query?: string, options?: MasterLibraryPageOptions, filters?: MasterLibraryFilters): Promise<MasterGameSummaryDto[]>;
  openMasterGame(gameId: string): Promise<Partial<BoardState>>;
  findRelatedMasterGames(topicId: string, fens: string[]): Promise<RelatedMasterGame[]>;
  listTrainingTasks(): Promise<TrainingTaskDto[]>;
  generateTrainingTasks(): Promise<TrainingGenerationResultDto>;
  getLearningProfile(): Promise<LearningProfile>;
  saveLearningProfile(profile: LearningProfile): Promise<LearningProfile>;
  startGuidedAnalysis(nodeId?: string): Promise<GuidedAnalysisStart>;
  parseChineseLine(fen: string, notation: string[]): Promise<ChineseLineParseResult>;
  submitGuidedAnalysis(request: { sessionId: string; submission: GuidedAnalysisSubmission; lines: GuidedEngineLine[]; taskId?: string; parentNote?: string }): Promise<GuidedAnalysisSubmissionResult>;
  cancelGuidedAnalysis(sessionId: string): Promise<void>;
  generateDailyTrainingPlan(): Promise<DailyTrainingPlan>;
  getWeeklyLearningReport(): Promise<WeeklyLearningReport>;
  inferOpeningRepertoire(): Promise<OpeningRepertoire>;
  getTrainingSummary(): Promise<TrainingSummaryDto>;
  listStudySessions(): Promise<StudySessionDto[]>;
  saveStudySession(reflection: string, tags: string[]): Promise<StudySessionDto>;
  scanTheoryLibrary(): Promise<TheoryLibraryDto>;
  getTheoryLibrary(): Promise<TheoryLibraryDto>;
  reviewTheoryCard(card: TheoryCardDto): Promise<TheoryCardDto>;
  createTheoryCard(card: Pick<TheoryCardDto, "lessonId" | "title" | "summary" | "appliesWhen" | "risk" | "timecode">): Promise<TheoryCardDto>;
  saveTheoryFeedback(feedback: Pick<TheoryCardFeedbackDto, "matchId" | "cardId" | "cardVersion" | "verdict" | "note">): Promise<TheoryCardFeedbackDto>;
  completeTrainingTask(taskId: string, completed: boolean): Promise<void>;
  playMove(iccs: string): Promise<Partial<BoardState>>;
  prepareLinkSelectionWindow(): Promise<void>;
  listLinkTargetWindows(): Promise<LinkTargetWindow[]>;
  startLinkSession(request: StartLinkSessionRequest): Promise<LinkObservation>;
  stopLinkSession(): Promise<LinkObservation>;
  getLinkSessionStatus(): Promise<LinkSessionStatus>;
  pauseLinkSession(): Promise<LinkSessionStatus>;
  recalibrateLinkSession(): Promise<LinkSessionStatus>;
  getLinkCapturePreview(): Promise<string | undefined>;
  recognizeLinkImageFile(source: CaptureSource): Promise<LinkObservation | undefined>;
  submitLinkPosition(fen: string): Promise<LinkObservation>;
  confirmRecognizedMove(iccs: string): Promise<Partial<BoardState>>;
  setLinkSideToMove(side: LinkAutoSide): Promise<Partial<BoardState>>;
  confirmLinkEngineMove(iccs: string): Promise<boolean>;
  importRecognizedPosition(fen: string, title?: string): Promise<Partial<BoardState>>;
  getTtxqSyncProgress(): Promise<TtxqSyncProgress>;
  previewTtxqHistory(): Promise<TtxqGamePreview[]>;
  listTtxqDiagnosticSamples(): Promise<TtxqDiagnosticSample[]>;
  clearTtxqDiagnosticSamples(): Promise<void>;
  startTtxqAuthorization(): Promise<void>;
  collectTtxqHistory(): Promise<void>;
  importTtxqHistory(): Promise<TtxqSyncProgress>;
  disconnectTtxq(): Promise<void>;
  newGame(fen: string, title?: string, note?: string): Promise<Partial<BoardState>>;
  openDocument(): Promise<Partial<BoardState> | undefined>;
  importXqbOpeningBook(): Promise<Partial<BoardState> | undefined>;
  importEleeyeOpeningBook(): Promise<Partial<BoardState> | undefined>;
  saveDocument(saveAs?: boolean): Promise<string | undefined>;
  copyPosition(fen: string): Promise<void>;
  copyGame(mainlineOnly?: boolean): Promise<void>;
  copyExport(format: ExportFormat): Promise<void>;
  exportManualFile(format: ExportFormat, title: string): Promise<string | undefined>;
  exportManualPdf(title: string): Promise<string | undefined>;
  exportReplayGif(title: string, scope: ReplayExportScope): Promise<string | undefined>;
  exportMindMapSvg(title: string, svg: string): Promise<string | undefined>;
  exportTextFile(title: string, contents: string, extension?: "txt" | "pgn", label?: string): Promise<string | undefined>;
  pasteDocument(): Promise<Partial<BoardState>>;
  updateGameMetadata(title: string, note: string): Promise<Partial<BoardState>>;
  reorderBranches(nodeIds: string[]): Promise<Partial<BoardState>>;
  navigateTo(nodeId?: string): Promise<Partial<BoardState>>;
  updateComment(nodeId: string, comment: string): Promise<Partial<BoardState>>;
  setMainline(nodeId: string): Promise<Partial<BoardState>>;
  deleteNode(nodeId: string): Promise<Partial<BoardState>>;
  previewLine(fen: string, pv: string[]): Promise<PreviewLineStep[]>;
  previewRecognizedMoveFromCurrent(iccs: string): Promise<RecognizedLastMovePreview>;
  resolveScreenshotMove(): Promise<ScreenshotMoveResolution>;
  analyze(options: AnalysisOptions): Promise<AnalysisLine[]>;
  runEngineArena(options: EngineArenaOptionsDto): Promise<EngineArenaResultDto>;
  playEngineMove(options: EnginePlayOptions): Promise<EngineMoveResult>;
  moveNow(): Promise<boolean>;
  stopEnginePlay(): Promise<boolean>;
  stopAnalysis(discardResult?: boolean): Promise<boolean>;
  subscribeEngineEvents(listener: (event: EngineRuntimeEvent) => void): Promise<() => void>;
  generateGameReport(options: GameReportOptionsDto): Promise<GameReportDatasetDto>;
  cancelGameReport(): Promise<boolean>;
  getGameReport(): Promise<GameReportDatasetDto | undefined>;
  exportGameReportPdf(report: GameReportPresentationDto): Promise<string | undefined>;
  subscribeGameReportProgress(listener: (progress: GameReportProgressDto) => void): Promise<() => void>;
  importMasterStyleProfile(paths?: { profilePath?: string; samplesPath?: string; analysisPath?: string }): Promise<MasterStyleImportResultDto>;
  listMasterStyleProfiles(): Promise<MasterStyleProfileDto[]>;
  matchMasterStyleHints(fen: string, phase: string, bestIccs?: string, limit?: number): Promise<MasterStyleHintDto[]>;
  loadSavedAnalysis(fen: string): Promise<AnalysisLine[]>;
  openCompactFloatingPanel(panel: "engine" | "manual" | "cloud" | "link"): Promise<boolean>;
  returnCompactFloatingPanel(panel: "engine" | "manual" | "cloud" | "link"): Promise<boolean>;
  getSyncAccount(): Promise<SyncAccountDto>;
  getSubscription(): Promise<SubscriptionDto>;
  getCloudAnalysisPreferences(): Promise<CloudAnalysisPreferences | undefined>;
  saveCloudAnalysisPreferences(preferences: CloudAnalysisPreferences): Promise<void>;
  checkCloudHealth(serverUrl: string): Promise<void>;
  authenticateCloud(mode: "register" | "login", serverUrl: string, email: string, password: string): Promise<CloudAuthDto>;
  authenticateCloudGuest(serverUrl: string): Promise<CloudGuestAuthDto>;
  getCloudSubscription(serverUrl: string, token: string): Promise<SubscriptionDto>;
  redeemSubscriptionCode(code: string): Promise<SubscriptionDto>;
  registerSyncAccount(email: string, password: string): Promise<SyncAccountDto>;
  loginSyncAccount(email: string, password: string): Promise<SyncAccountDto>;
  logoutSyncAccount(): Promise<SyncAccountDto>;
  unbindSyncAccount(): Promise<SyncAccountDto>;
  synchronize(serverUrl?: string, token?: string): Promise<SyncResult>;
}
