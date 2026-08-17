import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { webDatabase, type SyncOperation, type WebGameRecord } from "./indexedDb";
import { BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH, FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST } from "./types";
import type { AnalysisLine, AnalysisOptions, AppInfoDto, BoardState, BuiltinOpeningBookManifestDto, CaptureSource, ChessPlatform, CloudAnalysisPreferences, CloudAuthDto, CloudBookCandidate, DesktopPreferencesDto, EngineArenaOptionsDto, EngineArenaResultDto, EngineMoveResult, EnginePlayOptions, EngineProbeDto, EngineProfileDto, EngineRuntimeEvent, ExportFormat, FlyknifeCandidate, FlyknifePlan, FlyknifeTemplate, FlyknifeTopic, GameMirrorStatus, GameReportDatasetDto, GameReportOptionsDto, GameReportPresentationDto, GameReportProgressDto, GameSummary, GenerateFlyknifeRequest, LibraryFolder, LinkAutoSide, LinkObservation, LinkSessionStatus, MasterGameSummaryDto, MasterPlayerDto, MasterStyleHintDto, MasterStyleImportResultDto, MasterStyleProfileDto, PreviewLineStep, ReplayExportScope, ScreenshotMoveResolution, StartLinkSessionRequest, StudySessionDto, SubscriptionDto, SyncAccountDto, SyncResult, TheoryCardDto, TheoryCardFeedbackDto, TheoryLibraryDto, TrainingGenerationResultDto, TrainingSummaryDto, TrainingTaskDto } from "./types";
import type { ChineseLineParseResult, DailyTrainingPlan, GuidedAnalysisStart, GuidedAnalysisSubmission, GuidedAnalysisSubmissionResult, GuidedEngineLine, LearningProfile, OpeningRepertoire, WeeklyLearningReport } from "./types";

type WebGameInstance = {
  stateJson(): string;
  exportJson(): string;
  rootId(): string;
  playMove(iccs: string): string;
  navigateTo(nodeId?: string): string;
  updateComment(nodeId: string, comment: string): string;
  setMainline(nodeId: string): string;
  deleteNode(nodeId: string): string;
  applyOperation(kind: string, payloadJson: string): string;
};
type WebManualFile = {
  format: "xiangqi-assistant";
  version: 1;
  title: string;
  note: string;
  snapshot: string;
};
type WebCoreModule = {
  default(): Promise<unknown>;
  WebGame: {
    new(fen?: string): WebGameInstance;
    importJson(snapshot: string): WebGameInstance;
    fromRemote(fen: string, rootId: string): WebGameInstance;
  };
};
declare global {
  interface Window {
    __xiangqiWebCore?: WebCoreModule;
    __xiangqiWebCoreError?: string;
  }
}
type WireSyncOperation = Omit<SyncOperation, "kind"> & {
  kind: string;
  op_id?: string;
  device_id?: string;
  entity_id?: string;
  game_id?: string;
  created_at?: string;
};

const webManualFileExtension = "xqjson";
const webManualMimeType = "application/vnd.xiangqi-assistant+json";

function cloudApiError(status: number, fallback?: string) {
  if (status === 401) return "登录已失效，请重新登录云端分析";
  if (status === 403) return "当前账号没有云端 Pikafish 权限";
  if (status === 429) return "云端分析服务繁忙，请稍后重试";
  if (status >= 500) return "云端 Pikafish 暂不可用，请稍后重试";
  return fallback ?? `云端服务返回 ${status}`;
}

export function cloudAnalysisHeaders(token: string, guest = false): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(!guest && token.trim() ? { authorization: `Bearer ${token}` } : {}),
  };
}

function downloadWebManual(filename: string, contents: string) {
  const blob = new Blob([contents], { type: webManualMimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function selectWebManualFile(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.${webManualFileExtension},application/json`;
    input.addEventListener("change", () => resolve(input.files?.[0]), { once: true });
    input.addEventListener("cancel", () => resolve(undefined), { once: true });
    input.click();
  });
}

function safeManualFilename(title: string) {
  const normalized = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80);
  return `${normalized || "未命名棋谱"}.${webManualFileExtension}`;
}

function parseWebManualFile(contents: string): WebManualFile {
  const value = JSON.parse(contents) as Partial<WebManualFile>;
  if (value.format !== "xiangqi-assistant" || value.version !== 1 || typeof value.snapshot !== "string") {
    throw new Error("不是可打开的象棋研习棋谱文件");
  }
  return {
    format: "xiangqi-assistant",
    version: 1,
    title: typeof value.title === "string" && value.title.trim() ? value.title : "导入棋谱",
    note: typeof value.note === "string" ? value.note : "",
    snapshot: value.snapshot,
  };
}

function normalizeSyncOperation(value: WireSyncOperation): SyncOperation | undefined {
  const opId = value.opId ?? value.op_id;
  const deviceId = value.deviceId ?? value.device_id;
  const entityId = value.entityId ?? value.entity_id;
  const gameId = value.gameId ?? value.game_id;
  const createdAt = value.createdAt ?? value.created_at;
  if (!opId || !deviceId || !entityId || !gameId || !createdAt) {
    throw new Error("同步操作缺少必要标识");
  }
  const supported = new Set<SyncOperation["kind"]>([
    "create_game", "add_move", "update_comment", "update_game_metadata",
    "reorder_branches", "set_mainline", "delete_node",
  ]);
  if (!supported.has(value.kind as SyncOperation["kind"])) return undefined;
  return { ...value, kind: value.kind as SyncOperation["kind"], opId, deviceId, entityId, gameId, createdAt };
}

class DesktopPlatform implements ChessPlatform {
  readonly kind = "desktop" as const;
  getAppInfo() { return invoke<AppInfoDto>("get_app_info"); }
  initialize() { return invoke<Partial<BoardState>>("get_state"); }
  async listGames(): Promise<GameSummary[]> {
    return invoke<GameSummary[]>("list_games");
  }
  listLibraryFolders() { return invoke<LibraryFolder[]>("list_library_folders"); }
  createLibraryFolder(name: string) { return invoke<void>("create_library_folder", { name }); }
  renameLibraryFolder(previous: string, next: string) { return invoke<void>("rename_library_folder", { previous, next }); }
  deleteLibraryFolder(name: string) { return invoke<void>("delete_library_folder", { name }); }
  updateGameLibrary(folder: string | undefined, favorite: boolean, tags: string[]) { return invoke<Partial<BoardState>>("update_game_library", { folder: folder ?? null, favorite, tags }); }
  getGameMirrorStatus(gameId?: string) { return invoke<GameMirrorStatus | undefined>("get_game_mirror_status", { gameId: gameId ?? null }); }
  updateGameMirror() { return invoke<GameMirrorStatus>("update_game_mirror"); }
  rebuildGameMirrors() { return invoke<GameMirrorStatus[]>("rebuild_game_mirrors"); }
  async chooseGameMirrorRoot() {
    const path = await open({ multiple: false, directory: true, title: "选择棋研棋谱镜像目录" });
    return typeof path === "string" ? path : undefined;
  }
  revealGameMirror() { return invoke<void>("reveal_game_mirror"); }
  openGame(gameId: string) { return invoke<Partial<BoardState>>("open_game", { gameId }); }
  detectEngine() { return invoke<string | null>("detect_pikafish"); }
  getDesktopPreferences() { return invoke<DesktopPreferencesDto>("get_desktop_preferences"); }
  saveDesktopPreferences(preferences: DesktopPreferencesDto) { return invoke<DesktopPreferencesDto>("save_desktop_preferences", { preferences }); }
  listBuiltinOpeningBooks() { return invoke<BuiltinOpeningBookManifestDto>("list_builtin_opening_books"); }
  async chooseEngineExecutable(currentPath?: string) {
    const path = await open({
      multiple: false,
      directory: false,
      defaultPath: currentPath && currentPath !== BUILTIN_ENGINE_PATH && currentPath !== BUILTIN_FAIRY_ENGINE_PATH ? currentPath : undefined,
      title: "选择 UCI/UCCI 象棋引擎可执行文件",
    });
    return typeof path === "string" ? path : undefined;
  }
  probeEngine(path: string) { return invoke<EngineProbeDto>("probe_engine", { path }); }
  listEngineProfiles() { return invoke<EngineProfileDto[]>("list_engine_profiles"); }
  registerEngineProfile(name: string, path: string) { return invoke<EngineProfileDto>("register_engine_profile", { name, path }); }
  setActiveEngineProfile(id: string) { return invoke<DesktopPreferencesDto>("set_active_engine_profile", { id }); }
  deleteEngineProfile(id: string) { return invoke<DesktopPreferencesDto>("delete_engine_profile", { id }); }
  queryCloudOpeningBook(fen: string) { return invoke<CloudBookCandidate[]>("query_cloud_opening_book", { fen }); }
  listFlyknifeTemplates() { return invoke<FlyknifeTemplate[]>("list_flyknife_templates"); }
  listFlyknifeTopics() { return invoke<FlyknifeTopic[]>("list_flyknife_topics"); }
  openExternalUrl(url: string) { return invoke<void>("open_external_url", { url }); }
  openFlyknifeTopic(id: string) { return invoke<Partial<BoardState>>("open_flyknife_topic", { id }); }
  generateFlyknifeCandidates(request: GenerateFlyknifeRequest) { return invoke<FlyknifeCandidate[]>("generate_flyknife_candidates", { request }); }
  listFlyknifePlans() { return invoke<FlyknifePlan[]>("list_flyknife_plans"); }
  saveFlyknifePlan(plan: FlyknifePlan) { return invoke<FlyknifePlan>("save_flyknife_plan", { plan }); }
  deleteFlyknifePlan(id: string) { return invoke<void>("delete_flyknife_plan", { id }); }
  openFlyknifePractice(id: string) { return invoke<Partial<BoardState>>("open_flyknife_practice", { id }); }
  listCoachReports() { return invoke<GameReportDatasetDto[]>("list_coach_reports"); }
  listMasterPlayers(query?: string, options?: { limit?: number; offset?: number }) {
    return invoke<MasterPlayerDto[]>("list_master_players", { query: query ?? null, limit: options?.limit ?? null, offset: options?.offset ?? null });
  }
  listMasterGames(playerId: string, query?: string, options?: { limit?: number; offset?: number }) {
    return invoke<MasterGameSummaryDto[]>("list_master_games", { playerId, query: query ?? null, limit: options?.limit ?? null, offset: options?.offset ?? null });
  }
  openMasterGame(gameId: string) { return invoke<Partial<BoardState>>("open_master_game", { gameId }); }
  listTrainingTasks() { return invoke<TrainingTaskDto[]>("list_training_tasks"); }
  generateTrainingTasks() { return invoke<TrainingGenerationResultDto>("generate_training_tasks"); }
  getLearningProfile() { return invoke<LearningProfile>("get_learning_profile"); }
  saveLearningProfile(profile: LearningProfile) { return invoke<LearningProfile>("save_learning_profile", { profile }); }
  startGuidedAnalysis(nodeId?: string) { return invoke<GuidedAnalysisStart>("start_guided_analysis", { nodeId: nodeId ?? null }); }
  parseChineseLine(fen: string, notation: string[]) { return invoke<ChineseLineParseResult>("parse_chinese_line", { fen, notation }); }
  submitGuidedAnalysis(request: { sessionId: string; submission: GuidedAnalysisSubmission; lines: GuidedEngineLine[]; taskId?: string; parentNote?: string }) { return invoke<GuidedAnalysisSubmissionResult>("submit_guided_analysis", { request }); }
  cancelGuidedAnalysis(sessionId: string) { return invoke<void>("cancel_guided_analysis", { sessionId }); }
  generateDailyTrainingPlan() { return invoke<DailyTrainingPlan>("generate_daily_training_plan"); }
  getWeeklyLearningReport() { return invoke<WeeklyLearningReport>("get_weekly_learning_report"); }
  inferOpeningRepertoire() { return invoke<OpeningRepertoire>("infer_opening_repertoire_command"); }
  getTrainingSummary() { return invoke<TrainingSummaryDto>("get_training_summary"); }
  listStudySessions() { return invoke<StudySessionDto[]>("list_study_sessions"); }
  saveStudySession(reflection: string, tags: string[]) { return invoke<StudySessionDto>("save_study_session", { reflection, tags }); }
  scanTheoryLibrary() { return invoke<TheoryLibraryDto>("scan_theory_library"); }
  getTheoryLibrary() { return invoke<TheoryLibraryDto>("get_theory_library"); }
  reviewTheoryCard(card: TheoryCardDto) { return invoke<TheoryCardDto>("review_theory_card", { card }); }
  createTheoryCard(card: Pick<TheoryCardDto, "lessonId" | "title" | "summary" | "appliesWhen" | "risk" | "timecode">) { return invoke<TheoryCardDto>("create_theory_card", { ...card }); }
  saveTheoryFeedback(feedback: Pick<TheoryCardFeedbackDto, "matchId" | "cardId" | "cardVersion" | "verdict" | "note">) { return invoke<TheoryCardFeedbackDto>("save_theory_feedback", { feedback }); }
  completeTrainingTask(taskId: string, completed: boolean) { return invoke<void>("complete_training_task", { taskId, completed }); }
  playMove(iccs: string) { return invoke<Partial<BoardState>>("play_move", { iccs }); }
  prepareLinkSelectionWindow() { return invoke<void>("prepare_link_selection_window"); }
  startLinkSession(request: StartLinkSessionRequest) { return invoke<LinkObservation>("start_link_session", { request }); }
  stopLinkSession() { return invoke<LinkObservation>("stop_link_session"); }
  getLinkSessionStatus() { return invoke<LinkSessionStatus>("get_link_session_status"); }
  pauseLinkSession() { return invoke<LinkSessionStatus>("pause_link_session"); }
  recalibrateLinkSession() { return invoke<LinkSessionStatus>("recalibrate_link_session"); }
  getLinkCapturePreview() { return invoke<string | undefined>("get_link_capture_preview"); }
  async recognizeLinkImageFile(source: CaptureSource) {
    const path = await open({
      multiple: false,
      directory: false,
      title: source === "cameraBoard" ? "选择实体棋盘拍照图片" : "选择棋盘截图或照片",
      filters: [{ name: "棋盘图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (!path || Array.isArray(path)) return undefined;
    return invoke<LinkObservation>("recognize_link_image_file", { path, source });
  }
  submitLinkPosition(fen: string) { return invoke<LinkObservation>("submit_link_position", { fen }); }
  confirmRecognizedMove(iccs: string) { return invoke<Partial<BoardState>>("confirm_recognized_move", { iccs }); }
  setLinkSideToMove(side: LinkAutoSide) { return invoke<Partial<BoardState>>("set_link_side_to_move", { side }); }
  confirmLinkEngineMove(iccs: string) { return invoke<boolean>("confirm_link_engine_move", { iccs }); }
  importRecognizedPosition(fen: string, title?: string) { return invoke<Partial<BoardState>>("import_recognized_position", { fen, title }); }
  newGame(fen: string, title?: string, note?: string) { return invoke<Partial<BoardState>>("new_game", { fen, title, note }); }
  async openDocument() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "PGN 象棋棋谱", extensions: ["pgn"] }] });
    if (!path || Array.isArray(path)) return undefined;
    return invoke<Partial<BoardState>>("open_document", { path });
  }
  async importXqbOpeningBook() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "XQB 象棋开局库", extensions: ["xqb"] }] });
    if (!path || Array.isArray(path)) return undefined;
    return invoke<Partial<BoardState>>("import_xqb_opening_book", { path });
  }
  async importEleeyeOpeningBook() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: "ElephantEye 开局库", extensions: ["dat"] }] });
    if (!path || Array.isArray(path)) return undefined;
    return invoke<Partial<BoardState>>("import_eleeye_opening_book", { path });
  }
  async saveDocument(saveAs = false) {
    const path = saveAs ? await save({ defaultPath: "未命名.pgn", filters: [{ name: "PGN 棋谱", extensions: ["pgn"] }] }) : null;
    if (saveAs && !path) return undefined;
    return invoke<string>("save_document", { path });
  }
  copyPosition(fen: string) { return writeText(fen); }
  async copyGame(mainlineOnly = false) { await writeText(await invoke<string>("export_text", { mainlineOnly })); }
  async copyExport(format: ExportFormat) { await writeText(await invoke<string>("export_document_text", { format })); }
  async exportManualFile(format: ExportFormat, title: string) {
    const extension = format === "pgn" ? "pgn" : "txt";
    const label = format === "pgn" ? "PGN 棋谱" : format === "chinese" ? "中文文本棋谱" : "东萍棋谱文本";
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const path = await save({ defaultPath: `${safeTitle}.${extension}`, filters: [{ name: label, extensions: [extension] }] });
    if (!path) return undefined;
    return invoke<string>("export_document_file", { path, format });
  }
  async exportManualPdf(title: string) {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const path = await save({ defaultPath: `${safeTitle}-棋谱.pdf`, filters: [{ name: "PDF 棋谱", extensions: ["pdf"] }] });
    if (!path) return undefined;
    return invoke<string>("export_manual_pdf", { path });
  }
  async exportReplayGif(title: string, scope: ReplayExportScope) {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const suffix = scope === "currentSelection" ? "当前分支回放" : "完整主线回放";
    const path = await save({ defaultPath: `${safeTitle}-${suffix}.gif`, filters: [{ name: "GIF 动态棋谱", extensions: ["gif"] }] });
    if (!path) return undefined;
    return invoke<string>("export_replay_gif", { path, scope });
  }
  async exportMindMapSvg(title: string, svg: string) {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const path = await save({ defaultPath: `${safeTitle}-变招图.svg`, filters: [{ name: "SVG 变招图", extensions: ["svg"] }] });
    if (!path) return undefined;
    return invoke<string>("export_mind_map_svg", { path, svg });
  }
  async exportTextFile(title: string, contents: string, extension: "txt" | "pgn" = "txt", label = "文本文件") {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const path = await save({ defaultPath: `${safeTitle}.${extension}`, filters: [{ name: label, extensions: [extension] }] });
    if (!path) return undefined;
    return invoke<string>("export_text_file", { path, contents });
  }
  async pasteDocument() { return invoke<Partial<BoardState>>("import_text", { text: await readText() }); }
  updateGameMetadata(title: string, note: string) { return invoke<Partial<BoardState>>("update_game_metadata", { title, note }); }
  reorderBranches(nodeIds: string[]) { return invoke<Partial<BoardState>>("reorder_branches", { nodeIds }); }
  navigateTo(nodeId?: string) { return invoke<Partial<BoardState>>("navigate_to", { nodeId: nodeId ?? null }); }
  updateComment(nodeId: string, comment: string) { return invoke<Partial<BoardState>>("update_comment", { nodeId, comment }); }
  setMainline(nodeId: string) { return invoke<Partial<BoardState>>("set_mainline", { nodeId }); }
  deleteNode(nodeId: string) { return invoke<Partial<BoardState>>("delete_node", { nodeId }); }
  previewLine(fen: string, pv: string[]) { return invoke<PreviewLineStep[]>("preview_line", { fen, pv }); }
  previewRecognizedMoveFromCurrent(iccs: string) { return invoke<import("./types").RecognizedLastMovePreview>("preview_recognized_move_from_current", { iccs }); }
  resolveScreenshotMove() { return invoke<ScreenshotMoveResolution>("resolve_screenshot_move"); }
  analyze(options: AnalysisOptions) {
    return invoke<AnalysisLine[]>("analyze_position", {
      enginePath: options.enginePath,
      engineId: options.engineId ?? null,
      engineName: options.engineName ?? null,
      analysisSessionId: options.analysisSessionId ?? null,
      fen: options.fen,
      searchMode: options.searchMode,
      searchValue: options.searchValue,
      threads: options.threads,
      hashMb: options.hashMb,
      multipv: options.multipv,
      searchMoves: options.searchMoves ?? [],
      excludeMove: options.excludeMove ?? null,
    });
  }
  stopAnalysis(discardResult = false) { return invoke<boolean>("stop_analysis", { discardResult }); }
  runEngineArena(options: EngineArenaOptionsDto) { return invoke<EngineArenaResultDto>("run_engine_arena", { options }); }
  playEngineMove(options: EnginePlayOptions) { return invoke<EngineMoveResult>("engine_play_move", options); }
  moveNow() { return invoke<boolean>("move_now"); }
  stopEnginePlay() { return invoke<boolean>("stop_engine_play"); }
  subscribeEngineEvents(listener: (event: EngineRuntimeEvent) => void) {
    return listen<EngineRuntimeEvent>("engine-runtime", (event) => listener(event.payload));
  }
  generateGameReport(options: GameReportOptionsDto) {
    return invoke<GameReportDatasetDto>("generate_game_report", {
      enginePath: options.enginePath,
      reportDepth: options.reportDepth,
      threads: options.threads,
      hashMb: options.hashMb,
    });
  }
  cancelGameReport() { return invoke<boolean>("cancel_game_report"); }
  async getGameReport() { return (await invoke<GameReportDatasetDto | null>("get_game_report")) ?? undefined; }
  async exportGameReportPdf(report: GameReportPresentationDto) {
    const date = report.generatedAt.slice(0, 10).replaceAll("-", "") || new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const title = report.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋局";
    const path = await save({ defaultPath: `${title}-复盘报告-${date}.pdf`, filters: [{ name: "PDF 复盘报告", extensions: ["pdf"] }] });
    if (!path) return undefined;
    return invoke<string>("export_game_report_pdf", { path, report });
  }
  subscribeGameReportProgress(listener: (progress: GameReportProgressDto) => void) {
    return listen<GameReportProgressDto>("game-report-progress", (event) => listener(event.payload));
  }
  importMasterStyleProfile(paths?: { profilePath?: string; samplesPath?: string; analysisPath?: string }) {
    return invoke<MasterStyleImportResultDto>("import_master_style_profile", { request: paths ?? null });
  }
  listMasterStyleProfiles() { return invoke<MasterStyleProfileDto[]>("list_master_style_profiles"); }
  matchMasterStyleHints(fen: string, phase: string, bestIccs?: string, limit?: number) {
    return invoke<MasterStyleHintDto[]>("match_master_style_hints", { fen, phase, bestIccs: bestIccs ?? null, limit: limit ?? null });
  }
  loadSavedAnalysis() { return invoke<AnalysisLine[]>("get_saved_analysis"); }
  openCompactFloatingPanel(panel: "engine" | "manual" | "cloud" | "link") { return invoke<boolean>("open_compact_floating_panel", { panel }); }
  returnCompactFloatingPanel(panel: "engine" | "manual" | "cloud" | "link") { return invoke<boolean>("return_compact_floating_panel", { panel }); }
  getSyncAccount() { return invoke<SyncAccountDto>("get_sync_account"); }
  getSubscription() { return invoke<SubscriptionDto>("get_subscription"); }
  async getCloudAnalysisPreferences(): Promise<CloudAnalysisPreferences | undefined> { return undefined; }
  async saveCloudAnalysisPreferences(): Promise<void> { }
  async checkCloudHealth(): Promise<void> { }
  async authenticateCloud(): Promise<CloudAuthDto> { throw new Error("桌面端请使用同步账号设置"); }
  async getCloudSubscription(): Promise<SubscriptionDto> { return this.getSubscription(); }
  redeemSubscriptionCode(code: string) { return invoke<SubscriptionDto>("redeem_subscription_code", { code }); }
  registerSyncAccount(email: string, password: string) { return invoke<SyncAccountDto>("register_sync_account", { email, password }); }
  loginSyncAccount(email: string, password: string) { return invoke<SyncAccountDto>("login_sync_account", { email, password }); }
  logoutSyncAccount() { return invoke<SyncAccountDto>("logout_sync_account"); }
  unbindSyncAccount() { return invoke<SyncAccountDto>("unbind_sync_account"); }
  synchronize() { return invoke<SyncResult>("sync_now"); }
}

class WebPlatform implements ChessPlatform {
  readonly kind = "web" as const;
  private game?: WebGameInstance;
  private gameId = "";
  private deviceId = "";
  private lamport = 0;
  private abort?: AbortController;
  private module?: WebCoreModule;
  private corePromise?: Promise<WebCoreModule>;

  async initialize(): Promise<Partial<BoardState>> {
    const module = await this.core();
    const stored = await webDatabase.currentGame();
    this.game = stored ? module.WebGame.importJson(stored.snapshot) : new module.WebGame();
    this.gameId = stored?.id ?? crypto.randomUUID();
    this.deviceId = await webDatabase.meta("deviceId") ?? crypto.randomUUID();
    this.lamport = Number(await webDatabase.meta("lamport") ?? 0);
    await webDatabase.setMeta("deviceId", this.deviceId);
    if (!stored) {
      const state = this.state();
      await this.persist(state);
      await this.enqueue("create_game", this.gameId, {
        title: "Web study",
        fen: state.fen,
        rootId: this.requireGame().rootId(),
      });
    }
    return this.scoredState();
  }
  async getAppInfo(): Promise<AppInfoDto> { return { version: "Web", buildTimestamp: 0, platform: "浏览器" }; }

  async listGames(): Promise<GameSummary[]> {
    const currentId = await webDatabase.meta("currentGameId");
    return (await webDatabase.games()).map((game) => ({
      id: game.id,
      title: game.title,
      fen: game.fen,
      updatedAt: game.updatedAt,
      current: game.id === currentId,
      favorite: false,
      tags: [],
    }));
  }
  async listLibraryFolders(): Promise<LibraryFolder[]> { return []; }
  async createLibraryFolder(): Promise<void> { throw new Error("Web 端暂不支持棋谱文件夹"); }
  async renameLibraryFolder(): Promise<void> { throw new Error("Web 端暂不支持棋谱文件夹"); }
  async deleteLibraryFolder(): Promise<void> { throw new Error("Web 端暂不支持棋谱文件夹"); }
  async updateGameLibrary(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持棋谱归档"); }
  async getGameMirrorStatus(): Promise<GameMirrorStatus | undefined> { return undefined; }
  async updateGameMirror(): Promise<GameMirrorStatus> { throw new Error("Web 端暂不支持棋谱镜像"); }
  async rebuildGameMirrors(): Promise<GameMirrorStatus[]> { throw new Error("Web 端暂不支持棋谱镜像"); }
  async chooseGameMirrorRoot(): Promise<string | undefined> { return undefined; }
  async revealGameMirror(): Promise<void> { throw new Error("Web 端暂不支持棋谱镜像"); }

  async openGame(gameId: string): Promise<Partial<BoardState>> {
    const record = await webDatabase.game(gameId);
    if (!record) throw new Error("棋谱不存在或尚未同步");
    const module = await this.core();
    this.game = module.WebGame.importJson(record.snapshot);
    this.gameId = record.id;
    await webDatabase.saveGame(record, true);
    return this.scoredState();
  }

  async detectEngine() { return null; }
  async getDesktopPreferences(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不支持桌面偏好设置"); }
  async saveDesktopPreferences(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不支持桌面偏好设置"); }
  async listBuiltinOpeningBooks(): Promise<BuiltinOpeningBookManifestDto> {
    return FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST;
  }
  async chooseEngineExecutable(): Promise<string | undefined> { throw new Error("Web 端不支持选择本地引擎"); }
  async probeEngine(): Promise<EngineProbeDto> { throw new Error("Web 端不运行本地引擎"); }
  async listEngineProfiles(): Promise<EngineProfileDto[]> { throw new Error("Web 端不管理本地引擎"); }
  async registerEngineProfile(): Promise<EngineProfileDto> { throw new Error("Web 端不管理本地引擎"); }
  async setActiveEngineProfile(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不管理本地引擎"); }
  async deleteEngineProfile(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不管理本地引擎"); }
  async queryCloudOpeningBook(): Promise<CloudBookCandidate[]> { return []; }
  async listFlyknifeTemplates(): Promise<FlyknifeTemplate[]> { return []; }
  async listFlyknifeTopics(): Promise<FlyknifeTopic[]> { return []; }
  async openExternalUrl(url: string): Promise<void> { window.open(url, "_blank", "noopener,noreferrer"); }
  async openFlyknifeTopic(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持飞刀专题库"); }
  async generateFlyknifeCandidates(): Promise<FlyknifeCandidate[]> { throw new Error("Web 端暂不支持飞刀生成"); }
  async listFlyknifePlans(): Promise<FlyknifePlan[]> { return []; }
  async saveFlyknifePlan(): Promise<FlyknifePlan> { throw new Error("Web 端暂不支持飞刀库"); }
  async deleteFlyknifePlan(): Promise<void> { throw new Error("Web 端暂不支持飞刀库"); }
  async openFlyknifePractice(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持飞刀库"); }
  async listCoachReports(): Promise<GameReportDatasetDto[]> { return []; }
  async listMasterPlayers(): Promise<MasterPlayerDto[]> { throw new Error("Web 端大师棋谱库暂未开放"); }
  async listMasterGames(): Promise<MasterGameSummaryDto[]> { throw new Error("Web 端大师棋谱库暂未开放"); }
  async openMasterGame(): Promise<Partial<BoardState>> { throw new Error("Web 端大师棋谱库暂未开放"); }
  async getSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async getSubscription(): Promise<SubscriptionDto> { throw new Error("Web 端订阅权益不在本阶段开放"); }
  async getCloudAnalysisPreferences(): Promise<CloudAnalysisPreferences | undefined> {
    const raw = await webDatabase.meta("cloudAnalysisPreferences");
    if (!raw) return undefined;
    try { return JSON.parse(raw) as CloudAnalysisPreferences; } catch { return undefined; }
  }
  async saveCloudAnalysisPreferences(preferences: CloudAnalysisPreferences): Promise<void> {
    await webDatabase.setMeta("cloudAnalysisPreferences", JSON.stringify(preferences));
  }
  async checkCloudHealth(serverUrl: string): Promise<void> {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/health`);
    if (!response.ok) throw new Error(cloudApiError(response.status, `服务端不可用：${response.status}`));
  }
  async authenticateCloud(mode: "register" | "login", serverUrl: string, email: string, password: string): Promise<CloudAuthDto> {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/v1/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => ({})) as Partial<CloudAuthDto> & { error?: string };
    if (!response.ok || !payload.token || !payload.userId) throw new Error(cloudApiError(response.status, payload.error ?? `登录服务返回 ${response.status}`));
    return { userId: payload.userId, token: payload.token };
  }
  async getCloudSubscription(serverUrl: string, token: string): Promise<SubscriptionDto> {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/v1/subscription`, { headers: { authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({})) as SubscriptionDto & { error?: string };
    if (!response.ok) throw new Error(cloudApiError(response.status, payload.error ?? `订阅服务返回 ${response.status}`));
    return payload;
  }
  async redeemSubscriptionCode(): Promise<SubscriptionDto> { throw new Error("Web 端订阅权益不在本阶段开放"); }
  async registerSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async loginSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async logoutSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async unbindSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async openDocument(): Promise<Partial<BoardState> | undefined> {
    const file = await selectWebManualFile();
    if (!file) return undefined;
    const document = parseWebManualFile(await file.text());
    const module = await this.core();
    this.game = module.WebGame.importJson(document.snapshot);
    this.gameId = crypto.randomUUID();
    const state = this.state();
    await webDatabase.saveGame({
      id: this.gameId,
      title: document.title,
      note: document.note,
      snapshot: this.requireGame().exportJson(),
      fen: state.fen,
      updatedAt: new Date().toISOString(),
    }, true);
    await this.enqueue("create_game", this.gameId, {
      title: document.title,
      fen: state.fen,
      rootId: this.requireGame().rootId(),
    });
    return this.scoredState(state);
  }
  async importXqbOpeningBook(): Promise<Partial<BoardState> | undefined> { throw new Error("Web 端暂不支持本地 XQB 开局库"); }
  async importEleeyeOpeningBook(): Promise<Partial<BoardState> | undefined> { throw new Error("Web 端暂不支持本地 ElephantEye 开局库"); }
  async saveDocument(): Promise<string | undefined> {
    const record = await webDatabase.game(this.gameId);
    const title = record?.title ?? "未命名棋谱";
    const filename = safeManualFilename(title);
    const document: WebManualFile = {
      format: "xiangqi-assistant",
      version: 1,
      title,
      note: record?.note ?? "",
      snapshot: this.requireGame().exportJson(),
    };
    downloadWebManual(filename, JSON.stringify(document, null, 2));
    return filename;
  }
  copyPosition(fen: string) { return navigator.clipboard.writeText(fen); }
  async copyGame() { throw new Error("Web 端棋谱文本导出将在后续版本开放"); }
  async copyExport() { throw new Error("Web 端暂不支持桌面棋谱导出"); }
  async exportManualFile(_format: ExportFormat, _title: string): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面棋谱文件导出"); }
  async exportManualPdf(): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面棋谱 PDF 导出"); }
  async exportReplayGif(_title: string, _scope: ReplayExportScope): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面动态图导出"); }
  async exportMindMapSvg(title: string, svg: string): Promise<string | undefined> {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}-变招图.svg`;
    link.click();
    URL.revokeObjectURL(url);
    return link.download;
  }
  async exportTextFile(title: string, contents: string, extension: "txt" | "pgn" = "txt"): Promise<string | undefined> {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    return link.download;
  }
  async pasteDocument(): Promise<Partial<BoardState>> { throw new Error("Web 端棋谱粘贴将在后续版本开放"); }
  async updateGameMetadata(): Promise<Partial<BoardState>> { throw new Error("Web 端棋局元数据编辑将在后续版本开放"); }
  async reorderBranches(): Promise<Partial<BoardState>> { throw new Error("Web 端变招排序将在后续版本开放"); }
  async runEngineArena(): Promise<EngineArenaResultDto> { throw new Error("Web 端不运行本地引擎擂台"); }
  async playEngineMove(): Promise<EngineMoveResult> { throw new Error("Web 端不运行本地引擎对弈"); }
  async moveNow() { return false; }
  async stopEnginePlay() { return false; }
  async subscribeEngineEvents() { return () => undefined; }
  async generateGameReport(): Promise<GameReportDatasetDto> { throw new Error("Web 端不支持本地整局分析报告"); }
  async listTrainingTasks(): Promise<TrainingTaskDto[]> { throw new Error("Web 端暂不支持训练任务"); }
  async generateTrainingTasks(): Promise<TrainingGenerationResultDto> { throw new Error("Web 端暂不支持训练任务"); }
  async getLearningProfile(): Promise<LearningProfile> { throw new Error("Web 端暂不支持 U10 学习档案"); }
  async saveLearningProfile(): Promise<LearningProfile> { throw new Error("Web 端暂不支持 U10 学习档案"); }
  async startGuidedAnalysis(): Promise<GuidedAnalysisStart> { throw new Error("Web 端暂不支持 U10 拆棋"); }
  async parseChineseLine(): Promise<ChineseLineParseResult> { throw new Error("Web 端暂不支持中文线路解析"); }
  async submitGuidedAnalysis(): Promise<GuidedAnalysisSubmissionResult> { throw new Error("Web 端暂不支持 U10 拆棋"); }
  async cancelGuidedAnalysis(): Promise<void> { throw new Error("Web 端暂不支持 U10 拆棋"); }
  async generateDailyTrainingPlan(): Promise<DailyTrainingPlan> { throw new Error("Web 端暂不支持 U10 训练计划"); }
  async getWeeklyLearningReport(): Promise<WeeklyLearningReport> { throw new Error("Web 端暂不支持 U10 周报"); }
  async inferOpeningRepertoire(): Promise<OpeningRepertoire> { throw new Error("Web 端暂不支持 U10 布局画像"); }
  async getTrainingSummary(): Promise<TrainingSummaryDto> { throw new Error("Web 端暂不支持训练总结"); }
  async listStudySessions(): Promise<StudySessionDto[]> { throw new Error("Web 端暂不支持训练总结"); }
  async saveStudySession(): Promise<StudySessionDto> { throw new Error("Web 端暂不支持训练总结"); }
  async scanTheoryLibrary(): Promise<TheoryLibraryDto> { throw new Error("Web 端暂不支持本地棋理库"); }
  async getTheoryLibrary(): Promise<TheoryLibraryDto> { throw new Error("Web 端暂不支持本地棋理库"); }
  async reviewTheoryCard(_card: TheoryCardDto): Promise<TheoryCardDto> { throw new Error("Web 端暂不支持本地棋理库"); }
  async createTheoryCard(_card: Pick<TheoryCardDto, "lessonId" | "title" | "summary" | "appliesWhen" | "risk" | "timecode">): Promise<TheoryCardDto> { throw new Error("Web 端暂不支持本地棋理库"); }
  async saveTheoryFeedback(): Promise<TheoryCardFeedbackDto> { throw new Error("Web 端暂不支持本地棋理库"); }
  async completeTrainingTask(): Promise<void> { throw new Error("Web 端暂不支持训练任务"); }
  async cancelGameReport() { return false; }
  async getGameReport(): Promise<GameReportDatasetDto | undefined> { throw new Error("Web 端不支持本地整局分析报告"); }
  async exportGameReportPdf(): Promise<string | undefined> { throw new Error("Web 端不支持桌面 PDF 报告导出"); }
  async subscribeGameReportProgress() { return () => undefined; }
  async importMasterStyleProfile(): Promise<MasterStyleImportResultDto> { throw new Error("Web 端暂不支持本地大师风格画像"); }
  async listMasterStyleProfiles(): Promise<MasterStyleProfileDto[]> { return []; }
  async matchMasterStyleHints(): Promise<MasterStyleHintDto[]> { return []; }
  async openCompactFloatingPanel(): Promise<boolean> { throw new Error("Web 端不支持系统级浮动窗口"); }
  async returnCompactFloatingPanel(): Promise<boolean> { return false; }

  async playMove(iccs: string): Promise<Partial<BoardState>> {
    const before = this.state();
    const state = this.parseState(this.requireGame().playMove(iccs));
    const node = state.history.at(-1);
    if (!node || !state.currentNode) throw new Error("WASM did not return the created move node");
    await this.persist(state);
    await this.enqueue("add_move", state.currentNode, {
      nodeId: state.currentNode,
      parentId: before.currentNode ?? this.requireGame().rootId(),
      move: iccs,
      orderKey: Date.now(),
      isMainline: node.isMainline,
    });
    return this.scoredState(state);
  }
  async startLinkSession(): Promise<LinkObservation> { throw new Error("Web 端暂不支持桌面连线"); }
  async prepareLinkSelectionWindow(): Promise<void> {}
  async stopLinkSession(): Promise<LinkObservation> { throw new Error("Web 端暂不支持桌面连线"); }
  async getLinkSessionStatus(): Promise<LinkSessionStatus> { throw new Error("Web 端暂不支持桌面连线"); }
  async pauseLinkSession(): Promise<LinkSessionStatus> { throw new Error("Web 端暂不支持桌面连线"); }
  async recalibrateLinkSession(): Promise<LinkSessionStatus> { throw new Error("Web 端暂不支持桌面连线"); }
  async confirmLinkEngineMove(): Promise<boolean> { throw new Error("Web 端暂不支持桌面连线"); }
  async getLinkCapturePreview(): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面连线"); }
  async recognizeLinkImageFile(): Promise<LinkObservation | undefined> { throw new Error("Web 端暂不支持桌面图片识别"); }
  async submitLinkPosition(): Promise<LinkObservation> { throw new Error("Web 端暂不支持桌面连线"); }
  async confirmRecognizedMove(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持截图走子确认"); }
  async setLinkSideToMove(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持桌面连线"); }
  async importRecognizedPosition(): Promise<Partial<BoardState>> { throw new Error("Web 端暂不支持桌面连线"); }

  async newGame(fen: string, title?: string, note?: string): Promise<Partial<BoardState>> {
    if (title !== undefined || note !== undefined) {
      throw new Error("Web 端暂不支持带元数据的局面编辑，请使用桌面版");
    }
    const module = await this.core();
    this.game = new module.WebGame(fen);
    this.gameId = crypto.randomUUID();
    const state = this.state();
    await this.persist(state);
    await this.enqueue("create_game", this.gameId, { title: "Web study", fen, rootId: this.requireGame().rootId() });
    return this.scoredState(state);
  }

  async navigateTo(nodeId?: string): Promise<Partial<BoardState>> {
    const state = this.parseState(this.requireGame().navigateTo(nodeId));
    await this.persist(state);
    return this.scoredState(state);
  }

  async updateComment(nodeId: string, comment: string): Promise<Partial<BoardState>> {
    const state = this.parseState(this.requireGame().updateComment(nodeId, comment));
    await this.persist(state);
    await this.enqueue("update_comment", nodeId, { nodeId, comment });
    return this.scoredState(state);
  }

  async setMainline(nodeId: string): Promise<Partial<BoardState>> {
    const snapshot = JSON.parse(this.requireGame().exportJson()) as { tree: { root_id: string; nodes: Record<string, { parent_id: string }> } };
    const parentId = snapshot.tree.nodes[nodeId]?.parent_id ?? snapshot.tree.root_id;
    const state = this.parseState(this.requireGame().setMainline(nodeId));
    await this.persist(state);
    await this.enqueue("set_mainline", nodeId, { parentId, nodeId });
    return this.scoredState(state);
  }

  async deleteNode(nodeId: string): Promise<Partial<BoardState>> {
    const state = this.parseState(this.requireGame().deleteNode(nodeId));
    await this.persist(state);
    await this.enqueue("delete_node", nodeId, { nodeId });
    return this.scoredState(state);
  }

  async previewLine(fen: string, pv: string[]): Promise<PreviewLineStep[]> {
    const module = await this.core();
    const preview = new module.WebGame(fen);
    const steps: PreviewLineStep[] = [];
    for (const [index, iccs] of pv.entries()) {
      const state = this.parseState(preview.playMove(iccs));
      const move = state.history.at(-1);
      if (!move) throw new Error(`候选线路第 ${index + 1} 步未生成走法`);
      steps.push({
        fen: state.fen,
        notation: move.notation,
        movedBy: move.movedBy,
        from: move.from,
        to: move.to,
        pieces: state.pieces,
        status: state.status,
      });
    }
    return steps;
  }
  async previewRecognizedMoveFromCurrent(): Promise<import("./types").RecognizedLastMovePreview> { throw new Error("Web 端暂不支持截图走子确认"); }
  async resolveScreenshotMove(): Promise<import("./types").ScreenshotMoveResolution> { throw new Error("Web 端暂不支持截图走子确认"); }

  async analyze(options: AnalysisOptions): Promise<AnalysisLine[]> {
    if (!navigator.onLine) throw new Error("当前离线，可查看缓存分析，联网后才能启动 Pikafish");
    if (!options.guest && !options.token.trim()) throw new Error("服务端分析需要先填写登录令牌");
    if (options.searchMode === "infinite") throw new Error("Web 端不支持持续分析，请选择时间或深度");
    const analyzedGameId = this.gameId;
    const analyzedNode = this.state().currentNode;
    this.abort = new AbortController();
    const response = await fetch(`${options.serverUrl.replace(/\/$/, "")}/api/v1/analysis`, {
      method: "POST",
      headers: cloudAnalysisHeaders(options.token, options.guest),
      body: JSON.stringify({ fen: options.fen, mode: options.searchMode, value: options.searchValue, multiPv: options.multipv }),
      signal: this.abort.signal,
    });
    const payload = await response.json().catch(() => ({})) as { lines?: AnalysisLine[]; error?: string };
    if (!response.ok) throw new Error(cloudApiError(response.status, payload.error));
    const lines = payload.lines ?? [];
    await webDatabase.saveAnalysis(options.fen, lines);
    if (analyzedNode) await webDatabase.saveNodeAnalysis(analyzedGameId, analyzedNode, lines);
    return lines;
  }

  async stopAnalysis(): Promise<boolean> {
    this.abort?.abort();
    this.abort = undefined;
    return true;
  }

  loadSavedAnalysis(fen: string) { return webDatabase.analysis(fen); }

  async synchronize(serverUrl: string, token: string): Promise<SyncResult> {
    if (!navigator.onLine) throw new Error("当前离线，改动已保存在同步队列");
    const base = serverUrl.replace(/\/$/, "");
    const pending = await webDatabase.pending();
    const pushResponse = await fetch(`${base}/api/v1/sync/push`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ operations: pending.map((record) => record.operation) }),
    });
    if (!pushResponse.ok) throw new Error(`同步上传失败：${pushResponse.status}`);
    const pushed = await pushResponse.json() as { accepted: string[]; cursor: number };
    await webDatabase.removeAccepted(pushed.accepted);
    const cursor = Number(await webDatabase.meta("remoteCursor") ?? 0);
    const pullResponse = await fetch(`${base}/api/v1/sync/pull?cursor=${cursor}&limit=500`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!pullResponse.ok) throw new Error(`同步下载失败：${pullResponse.status}`);
    const pulled = await pullResponse.json() as { operations: Array<{ sequence: number; operation: WireSyncOperation }>; cursor: number };
    const projected = new Map<string, { game: WebGameInstance; record: WebGameRecord }>();
    for (const item of pulled.operations) {
      const operation = normalizeSyncOperation(item.operation);
      if (!operation) continue;
      let target = projected.get(operation.gameId);
      if (!target) {
        const record = await webDatabase.game(operation.gameId);
        if (record) {
          target = { game: operation.gameId === this.gameId ? this.requireGame() : (await this.core()).WebGame.importJson(record.snapshot), record };
        } else if (operation.kind === "create_game") {
          const payload = operation.payload as { title?: string; fen?: string; rootId?: string };
          if (!payload.fen || !payload.rootId) throw new Error("远端棋谱缺少 FEN 或根节点");
          target = {
            game: (await this.core()).WebGame.fromRemote(payload.fen, payload.rootId),
            record: {
              id: operation.gameId,
              title: payload.title ?? "同步棋谱",
              note: "",
              fen: payload.fen,
              snapshot: "",
              updatedAt: operation.createdAt,
            },
          };
        } else {
          continue;
        }
        projected.set(operation.gameId, target);
      }
      target.game.applyOperation(operation.kind, JSON.stringify(operation.payload));
      if (operation.kind === "update_game_metadata") {
        const payload = operation.payload as { title?: string; note?: string };
        if (payload.title) target.record.title = payload.title;
        if (payload.note != null) target.record.note = payload.note;
      }
      const state = JSON.parse(target.game.stateJson()) as BoardState;
      target.record = {
        ...target.record,
        fen: state.fen,
        snapshot: target.game.exportJson(),
        updatedAt: operation.createdAt,
      };
      projected.set(operation.gameId, target);
    }
    for (const [gameId, target] of projected) {
      if (gameId === this.gameId) this.game = target.game;
      await webDatabase.saveGame(target.record, gameId === this.gameId);
    }
    await webDatabase.setMeta("remoteCursor", String(pulled.cursor));
    return { uploaded: pushed.accepted.length, downloaded: pulled.operations.length, cursor: pulled.cursor };
  }

  private requireGame(): WebGameInstance {
    if (!this.game) throw new Error("Web chess core is not initialized");
    return this.game;
  }

  private async core(): Promise<WebCoreModule> {
    if (this.module) return this.module;
    this.corePromise ??= new Promise<WebCoreModule>((resolve, reject) => {
      const finish = () => {
        cleanup();
        if (window.__xiangqiWebCore) resolve(window.__xiangqiWebCore);
        else reject(new Error(window.__xiangqiWebCoreError || "浏览器棋规模块加载失败，请先运行 pnpm wasm:build"));
      };
      const cleanup = () => {
        window.removeEventListener("xiangqi-web-core-ready", finish);
        window.removeEventListener("xiangqi-web-core-error", finish);
      };
      if (window.__xiangqiWebCore || window.__xiangqiWebCoreError) {
        finish();
        return;
      }
      window.addEventListener("xiangqi-web-core-ready", finish);
      window.addEventListener("xiangqi-web-core-error", finish);
      if (!document.querySelector('script[data-xiangqi-web-core="true"]')) {
        const script = document.createElement("script");
        script.type = "module";
        script.src = "/web-core-loader.js";
        script.dataset.xiangqiWebCore = "true";
        script.addEventListener("error", () => {
          window.__xiangqiWebCoreError = "浏览器棋规加载器不可用";
          finish();
        }, { once: true });
        document.head.append(script);
      }
    }).catch((error) => {
      this.corePromise = undefined;
      throw error;
    });
    this.module = await this.corePromise;
    return this.module;
  }

  private state(): BoardState { return this.parseState(this.requireGame().stateJson()); }
  private parseState(value: string): BoardState { return JSON.parse(value) as BoardState; }

  private async scoredState(state = this.state()): Promise<BoardState> {
    const nodeIds = [...state.history, ...(state.continuation ?? []), ...state.branches].map((move) => move.id);
    const scores = await webDatabase.nodeAnalyses(this.gameId, nodeIds);
    const withScore = (move: BoardState["history"][number]) => ({ ...move, ...scores.get(move.id) });
    const record = await webDatabase.game(this.gameId);
    return {
      ...state,
      title: record?.title ?? "Web study",
      note: record?.note ?? "",
      playable: true,
      history: state.history.map(withScore),
      continuation: (state.continuation ?? []).map(withScore),
      branches: state.branches.map(withScore),
    };
  }

  private async persist(state: BoardState): Promise<void> {
    const existing = await webDatabase.game(this.gameId);
    await webDatabase.saveGame({
      id: this.gameId,
      title: existing?.title ?? "Web study",
      note: existing?.note ?? "",
      snapshot: this.requireGame().exportJson(),
      fen: state.fen,
      updatedAt: new Date().toISOString(),
    } satisfies WebGameRecord);
  }

  private async enqueue(kind: SyncOperation["kind"], entityId: string, payload: Record<string, unknown>): Promise<void> {
    this.lamport += 1;
    await webDatabase.setMeta("lamport", String(this.lamport));
    await webDatabase.enqueue({
      opId: crypto.randomUUID(),
      deviceId: this.deviceId,
      entityId,
      gameId: this.gameId,
      kind,
      payload,
      lamport: this.lamport,
      createdAt: new Date().toISOString(),
    });
  }
}

const tauriAvailable = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const chessPlatform: ChessPlatform = tauriAvailable ? new DesktopPlatform() : new WebPlatform();
export { BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH, DEFAULT_BUILTIN_OPENING_BOOK_ID, FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST } from "./types";
export type { CloudAnalysisPreferences, CloudAuthDto } from "./types";
export type { AnalysisLine, AnalysisOptions, AppInfoDto, BoardState, BranchCoachInsightDto, BuiltinOpeningBookDto, BuiltinOpeningBookManifestDto, BuiltinOpeningBookVerificationDto, CaptureSource, ChessPlatform, ChineseLineParseResult, CloudBookCandidate, DailyTrainingPlan, DesktopPreferencesDto, EngineArenaGameDto, EngineArenaOptionsDto, EngineArenaResultDto, EngineArenaScoreDto, EngineProbeDto, EngineProfileDto, EngineRuntimeEvent, EngineRuntimeState, ExportFormat, FlyknifeCandidate, FlyknifePlan, FlyknifeSide, FlyknifeStepAnnotation, FlyknifeStepRole, FlyknifeTemplate, FlyknifeTopic, GenerateFlyknifeRequest, GameReportDatasetDto, GameReportOptionsDto, GameReportPositionDto, GameReportPresentationDto, GameReportProgressDto, GameSummary, GuidedAnalysisResult, GuidedAnalysisSession, GuidedAnalysisStart, GuidedAnalysisSubmission, GuidedAnalysisSubmissionResult, GuidedEngineLine, LearningProfile, LegacySkinId, LibraryFolder, LinkAutoSide, LinkMode, LinkMoveDetail, LinkObservation, LinkSessionState, LinkSessionStatus, ManualTreeNode, ManualViewMode, MasterGameDetailDto, MasterGameSummaryDto, MasterPlayerDto, MasterStyleHintDto, MasterStyleImportResultDto, MasterStyleProfileDto, MasterStyleTheoryCardRefDto, MoveCoachInsightDto, MoveItem, OpeningBookHitDto, OpeningRepertoire, Piece, PreviewLineStep, QualityGrade, RecognitionMode, RecognizedLastMovePreview, ReplayExportScope, ReportPhase, ReportSidePresentationDto, RuleMode, ScreenshotMoveResolution, Side, SkinFolder, SkinId, StartLinkSessionRequest, StudySessionDto, SubscriptionDto, SyncAccountDto, SyncResult, TheoryCardDto, TheoryCardFeedbackDto, TheoryLessonDto, TheoryLibraryDto, TheoryPhase, TrainingAttempt, TrainingGenerationResultDto, TrainingSummaryDto, TrainingTaskDto, WeaknessStatDto, WeeklyLearningReport, WorkspaceLayoutMode, XqbCandidate } from "./types";
