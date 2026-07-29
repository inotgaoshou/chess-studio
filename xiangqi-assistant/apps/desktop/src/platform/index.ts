import { invoke } from "@tauri-apps/api/core";
import { webDatabase, type SyncOperation, type WebGameRecord } from "./indexedDb";
import type { AnalysisLine, AnalysisOptions, BoardState, ChessPlatform, GameSummary, SyncResult } from "./types";

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
type WireSyncOperation = SyncOperation & {
  op_id?: string;
  device_id?: string;
  entity_id?: string;
  game_id?: string;
  created_at?: string;
};

function normalizeSyncOperation(value: WireSyncOperation): SyncOperation {
  const opId = value.opId ?? value.op_id;
  const deviceId = value.deviceId ?? value.device_id;
  const entityId = value.entityId ?? value.entity_id;
  const gameId = value.gameId ?? value.game_id;
  const createdAt = value.createdAt ?? value.created_at;
  if (!opId || !deviceId || !entityId || !gameId || !createdAt) {
    throw new Error("同步操作缺少必要标识");
  }
  return { ...value, opId, deviceId, entityId, gameId, createdAt };
}

class DesktopPlatform implements ChessPlatform {
  readonly kind = "desktop" as const;
  initialize() { return invoke<Partial<BoardState>>("get_state"); }
  async listGames(): Promise<GameSummary[]> {
    const state = await this.initialize();
    return [{ id: "desktop-current", title: "当前研习棋谱", fen: state.fen ?? "", updatedAt: "", current: true }];
  }
  openGame() { return this.initialize(); }
  detectEngine() { return invoke<string | null>("detect_pikafish"); }
  playMove(iccs: string) { return invoke<Partial<BoardState>>("play_move", { iccs }); }
  newGame(fen: string) { return invoke<Partial<BoardState>>("new_game", { fen }); }
  navigateTo(nodeId?: string) { return invoke<Partial<BoardState>>("navigate_to", { nodeId: nodeId ?? null }); }
  updateComment(nodeId: string, comment: string) { return invoke<Partial<BoardState>>("update_comment", { nodeId, comment }); }
  setMainline(nodeId: string) { return invoke<Partial<BoardState>>("set_mainline", { nodeId }); }
  deleteNode(nodeId: string) { return invoke<Partial<BoardState>>("delete_node", { nodeId }); }
  analyze(options: AnalysisOptions) {
    return invoke<AnalysisLine[]>("analyze_position", {
      enginePath: options.enginePath,
      fen: options.fen,
      searchMode: options.searchMode,
      searchValue: options.searchValue,
      threads: options.threads,
      hashMb: options.hashMb,
      multipv: options.multipv,
    });
  }
  stopAnalysis(discardResult = false) { return invoke<boolean>("stop_analysis", { discardResult }); }
  loadSavedAnalysis() { return invoke<AnalysisLine[]>("get_saved_analysis"); }
  synchronize(serverUrl: string, token: string) { return invoke<SyncResult>("sync_now", { serverUrl, token }); }
}

class WebPlatform implements ChessPlatform {
  readonly kind = "web" as const;
  private game?: WebGameInstance;
  private gameId = "";
  private deviceId = "";
  private lamport = 0;
  private abort?: AbortController;
  private module?: WebCoreModule;

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

  async newGame(fen: string): Promise<Partial<BoardState>> {
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
    if (!this.module) {
      const moduleUrl = "/wasm/xiangqi_web_core.js";
      const module = await import(/* @vite-ignore */ moduleUrl) as WebCoreModule;
      await module.default();
      this.module = module;
    }
    return this.module;
  }

  private state(): BoardState { return this.parseState(this.requireGame().stateJson()); }
  private parseState(value: string): BoardState { return JSON.parse(value) as BoardState; }

  private async scoredState(state = this.state()): Promise<BoardState> {
    const nodeIds = [...state.history, ...state.branches].map((move) => move.id);
    const scores = await webDatabase.nodeAnalyses(this.gameId, nodeIds);
    const withScore = (move: BoardState["history"][number]) => ({ ...move, ...scores.get(move.id) });
    return {
      ...state,
      history: state.history.map(withScore),
      branches: state.branches.map(withScore),
    };
  }

  private async persist(state: BoardState): Promise<void> {
    await webDatabase.saveGame({
      id: this.gameId,
      title: "Web study",
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
export type { AnalysisLine, AnalysisOptions, BoardState, ChessPlatform, GameSummary, MoveItem, Piece, Side, SyncResult } from "./types";
