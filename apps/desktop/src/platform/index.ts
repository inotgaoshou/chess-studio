import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { webDatabase, type SyncOperation, type WebGameRecord } from "./indexedDb";
import { BUILTIN_ENGINE_PATH } from "./types";
import type { AnalysisLine, AnalysisOptions, BoardState, ChessPlatform, CloudBookCandidate, DesktopPreferencesDto, EngineMoveResult, EnginePlayOptions, EngineProbeDto, EngineProfileDto, EngineRuntimeEvent, ExportFormat, GameReportDatasetDto, GameReportOptionsDto, GameReportPresentationDto, GameReportProgressDto, GameSummary, PreviewLineStep, ReplayExportScope, SubscriptionDto, SyncAccountDto, SyncResult, TrainingTaskDto } from "./types";

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
  initialize() { return invoke<Partial<BoardState>>("get_state"); }
  async listGames(): Promise<GameSummary[]> {
    return invoke<GameSummary[]>("list_games");
  }
  openGame(gameId: string) { return invoke<Partial<BoardState>>("open_game", { gameId }); }
  detectEngine() { return invoke<string | null>("detect_pikafish"); }
  getDesktopPreferences() { return invoke<DesktopPreferencesDto>("get_desktop_preferences"); }
  saveDesktopPreferences(preferences: DesktopPreferencesDto) { return invoke<DesktopPreferencesDto>("save_desktop_preferences", { preferences }); }
  async chooseEngineExecutable(currentPath?: string) {
    const path = await open({
      multiple: false,
      directory: false,
      defaultPath: currentPath && currentPath !== BUILTIN_ENGINE_PATH ? currentPath : undefined,
      title: "选择 Pikafish 可执行文件",
    });
    return typeof path === "string" ? path : undefined;
  }
  probeEngine(path: string) { return invoke<EngineProbeDto>("probe_engine", { path }); }
  listEngineProfiles() { return invoke<EngineProfileDto[]>("list_engine_profiles"); }
  registerEngineProfile(name: string, path: string) { return invoke<EngineProfileDto>("register_engine_profile", { name, path }); }
  setActiveEngineProfile(id: string) { return invoke<DesktopPreferencesDto>("set_active_engine_profile", { id }); }
  deleteEngineProfile(id: string) { return invoke<DesktopPreferencesDto>("delete_engine_profile", { id }); }
  queryCloudOpeningBook(fen: string) { return invoke<CloudBookCandidate[]>("query_cloud_opening_book", { fen }); }
  listCoachReports() { return invoke<GameReportDatasetDto[]>("list_coach_reports"); }
  listTrainingTasks() { return invoke<TrainingTaskDto[]>("list_training_tasks"); }
  generateTrainingTasks() { return invoke<TrainingTaskDto[]>("generate_training_tasks"); }
  completeTrainingTask(taskId: string, completed: boolean) { return invoke<void>("complete_training_task", { taskId, completed }); }
  playMove(iccs: string) { return invoke<Partial<BoardState>>("play_move", { iccs }); }
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
  async exportReplayGif(title: string, scope: ReplayExportScope) {
    const safeTitle = title.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim().slice(0, 80) || "未命名棋谱";
    const suffix = scope === "currentSelection" ? "当前分支回放" : "完整主线回放";
    const path = await save({ defaultPath: `${safeTitle}-${suffix}.gif`, filters: [{ name: "GIF 动态棋谱", extensions: ["gif"] }] });
    if (!path) return undefined;
    return invoke<string>("export_replay_gif", { path, scope });
  }
  async pasteDocument() { return invoke<Partial<BoardState>>("import_text", { text: await readText() }); }
  updateGameMetadata(title: string, note: string) { return invoke<Partial<BoardState>>("update_game_metadata", { title, note }); }
  reorderBranches(nodeIds: string[]) { return invoke<Partial<BoardState>>("reorder_branches", { nodeIds }); }
  navigateTo(nodeId?: string) { return invoke<Partial<BoardState>>("navigate_to", { nodeId: nodeId ?? null }); }
  updateComment(nodeId: string, comment: string) { return invoke<Partial<BoardState>>("update_comment", { nodeId, comment }); }
  setMainline(nodeId: string) { return invoke<Partial<BoardState>>("set_mainline", { nodeId }); }
  deleteNode(nodeId: string) { return invoke<Partial<BoardState>>("delete_node", { nodeId }); }
  previewLine(fen: string, pv: string[]) { return invoke<PreviewLineStep[]>("preview_line", { fen, pv }); }
  analyze(options: AnalysisOptions) {
    return invoke<AnalysisLine[]>("analyze_position", {
      enginePath: options.enginePath,
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
  loadSavedAnalysis() { return invoke<AnalysisLine[]>("get_saved_analysis"); }
  getSyncAccount() { return invoke<SyncAccountDto>("get_sync_account"); }
  getSubscription() { return invoke<SubscriptionDto>("get_subscription"); }
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

  async listGames(): Promise<GameSummary[]> {
    const currentId = await webDatabase.meta("currentGameId");
    return (await webDatabase.games()).map((game) => ({
      id: game.id,
      title: game.title,
      fen: game.fen,
      updatedAt: game.updatedAt,
      current: game.id === currentId,
    }));
  }

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
  async chooseEngineExecutable(): Promise<string | undefined> { throw new Error("Web 端不支持选择本地引擎"); }
  async probeEngine(): Promise<EngineProbeDto> { throw new Error("Web 端不运行本地引擎"); }
  async listEngineProfiles(): Promise<EngineProfileDto[]> { throw new Error("Web 端不管理本地引擎"); }
  async registerEngineProfile(): Promise<EngineProfileDto> { throw new Error("Web 端不管理本地引擎"); }
  async setActiveEngineProfile(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不管理本地引擎"); }
  async deleteEngineProfile(): Promise<DesktopPreferencesDto> { throw new Error("Web 端不管理本地引擎"); }
  async queryCloudOpeningBook(): Promise<CloudBookCandidate[]> { return []; }
  async listCoachReports(): Promise<GameReportDatasetDto[]> { return []; }
  async getSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async getSubscription(): Promise<SubscriptionDto> { throw new Error("Web 端订阅权益不在本阶段开放"); }
  async redeemSubscriptionCode(): Promise<SubscriptionDto> { throw new Error("Web 端订阅权益不在本阶段开放"); }
  async registerSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async loginSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async logoutSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async unbindSyncAccount(): Promise<SyncAccountDto> { throw new Error("Web 端账号菜单不在本阶段开放"); }
  async openDocument(): Promise<Partial<BoardState> | undefined> { throw new Error("Web 端暂不支持原生文件对话框"); }
  async importXqbOpeningBook(): Promise<Partial<BoardState> | undefined> { throw new Error("Web 端暂不支持本地 XQB 开局库"); }
  async saveDocument(): Promise<string | undefined> { throw new Error("Web 端暂不支持原生文件保存"); }
  copyPosition(fen: string) { return navigator.clipboard.writeText(fen); }
  async copyGame() { throw new Error("Web 端棋谱文本导出将在后续版本开放"); }
  async copyExport() { throw new Error("Web 端暂不支持桌面棋谱导出"); }
  async exportManualFile(_format: ExportFormat, _title: string): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面棋谱文件导出"); }
  async exportReplayGif(_title: string, _scope: ReplayExportScope): Promise<string | undefined> { throw new Error("Web 端暂不支持桌面动态图导出"); }
  async pasteDocument(): Promise<Partial<BoardState>> { throw new Error("Web 端棋谱粘贴将在后续版本开放"); }
  async updateGameMetadata(): Promise<Partial<BoardState>> { throw new Error("Web 端棋局元数据编辑将在后续版本开放"); }
  async reorderBranches(): Promise<Partial<BoardState>> { throw new Error("Web 端变招排序将在后续版本开放"); }
  async playEngineMove(): Promise<EngineMoveResult> { throw new Error("Web 端不运行本地引擎对弈"); }
  async moveNow() { return false; }
  async stopEnginePlay() { return false; }
  async subscribeEngineEvents() { return () => undefined; }
  async generateGameReport(): Promise<GameReportDatasetDto> { throw new Error("Web 端不支持本地整局分析报告"); }
  async listTrainingTasks(): Promise<TrainingTaskDto[]> { throw new Error("Web 端暂不支持训练任务"); }
  async generateTrainingTasks(): Promise<TrainingTaskDto[]> { throw new Error("Web 端暂不支持训练任务"); }
  async completeTrainingTask(): Promise<void> { throw new Error("Web 端暂不支持训练任务"); }
  async cancelGameReport() { return false; }
  async getGameReport(): Promise<GameReportDatasetDto | undefined> { throw new Error("Web 端不支持本地整局分析报告"); }
  async exportGameReportPdf(): Promise<string | undefined> { throw new Error("Web 端不支持桌面 PDF 报告导出"); }
  async subscribeGameReportProgress() { return () => undefined; }

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

  async previewLine(): Promise<PreviewLineStep[]> {
    throw new Error("Web 端暂不支持本地候选线路动画预览");
  }

  async analyze(options: AnalysisOptions): Promise<AnalysisLine[]> {
    if (!navigator.onLine) throw new Error("当前离线，可查看缓存分析，联网后才能启动 Pikafish");
    if (!options.token.trim()) throw new Error("服务端分析需要先填写登录令牌");
    if (options.searchMode === "infinite") throw new Error("Web 端不支持持续分析，请选择时间或深度");
    const analyzedGameId = this.gameId;
    const analyzedNode = this.state().currentNode;
    this.abort = new AbortController();
    const response = await fetch(`${options.serverUrl.replace(/\/$/, "")}/api/v1/analysis`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}` },
      body: JSON.stringify({ fen: options.fen, mode: options.searchMode, value: options.searchValue, multiPv: options.multipv }),
      signal: this.abort.signal,
    });
    const payload = await response.json().catch(() => ({})) as { lines?: AnalysisLine[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? `分析服务返回 ${response.status}`);
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
export { BUILTIN_ENGINE_PATH } from "./types";
export type { AnalysisLine, AnalysisOptions, BoardState, BranchCoachInsightDto, ChessPlatform, CloudBookCandidate, DesktopPreferencesDto, EngineProbeDto, EngineProfileDto, EngineRuntimeEvent, EngineRuntimeState, ExportFormat, GameReportDatasetDto, GameReportOptionsDto, GameReportPositionDto, GameReportPresentationDto, GameReportProgressDto, GameSummary, MoveCoachInsightDto, MoveItem, OpeningBookHitDto, Piece, PreviewLineStep, QualityGrade, ReplayExportScope, ReportPhase, ReportSidePresentationDto, Side, SubscriptionDto, SyncAccountDto, SyncResult, TrainingTaskDto } from "./types";
