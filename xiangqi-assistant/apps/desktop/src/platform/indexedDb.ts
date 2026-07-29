import type { AnalysisLine } from "./types";

export type WebGameRecord = { id: string; title: string; snapshot: string; fen: string; updatedAt: string };
export type SyncOperation = {
  opId: string;
  deviceId: string;
  entityId: string;
  gameId: string;
  kind: "create_game" | "add_move" | "update_comment" | "set_mainline" | "delete_node";
  payload: Record<string, unknown>;
  lamport: number;
  createdAt: string;
};
type OutboxRecord = { sequence?: number; operation: SyncOperation };
type MetaRecord = { key: string; value: string };
type AnalysisRecord = { fen: string; lines: AnalysisLine[]; updatedAt: string };
type NodeAnalysisRecord = {
  key: string;
  gameId: string;
  nodeId: string;
  scoreCp?: number;
  mate?: number;
  updatedAt: string;
};

const databaseName = "xiangqi-studio-web";
const databaseVersion = 2;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, databaseVersion);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("games")) database.createObjectStore("games", { keyPath: "id" });
    if (!database.objectStoreNames.contains("outbox")) database.createObjectStore("outbox", { keyPath: "sequence", autoIncrement: true });
    if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "key" });
    if (!database.objectStoreNames.contains("analysis")) database.createObjectStore("analysis", { keyPath: "fen" });
    if (!database.objectStoreNames.contains("nodeAnalysis")) database.createObjectStore("nodeAnalysis", { keyPath: "key" });
  };
  return requestResult(request);
}

async function readOne<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readonly");
  const result = await requestResult(transaction.objectStore(storeName).get(key));
  database.close();
  return result as T | undefined;
}

async function writeOne(storeName: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, "readwrite");
  transaction.objectStore(storeName).put(value);
  await transactionDone(transaction);
  database.close();
}

export const webDatabase = {
  async currentGame(): Promise<WebGameRecord | undefined> {
    const current = await readOne<MetaRecord>("meta", "currentGameId");
    return current ? readOne<WebGameRecord>("games", current.value) : undefined;
  },

  async game(id: string): Promise<WebGameRecord | undefined> {
    return readOne<WebGameRecord>("games", id);
  },

  async games(): Promise<WebGameRecord[]> {
    const database = await openDatabase();
    const transaction = database.transaction("games", "readonly");
    const records = await requestResult(transaction.objectStore("games").getAll());
    database.close();
    return (records as WebGameRecord[]).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  },

  async saveGame(game: WebGameRecord, makeCurrent = true): Promise<void> {
    await writeOne("games", game);
    if (makeCurrent) {
      await writeOne("meta", { key: "currentGameId", value: game.id } satisfies MetaRecord);
    }
  },

  async meta(key: string): Promise<string | undefined> {
    return (await readOne<MetaRecord>("meta", key))?.value;
  },

  async setMeta(key: string, value: string): Promise<void> {
    await writeOne("meta", { key, value } satisfies MetaRecord);
  },

  async enqueue(operation: SyncOperation): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction("outbox", "readwrite");
    transaction.objectStore("outbox").add({ operation } satisfies OutboxRecord);
    await transactionDone(transaction);
    database.close();
  },

  async pending(): Promise<OutboxRecord[]> {
    const database = await openDatabase();
    const transaction = database.transaction("outbox", "readonly");
    const records = await requestResult(transaction.objectStore("outbox").getAll());
    database.close();
    return records as OutboxRecord[];
  },

  async removeAccepted(opIds: string[]): Promise<void> {
    const accepted = new Set(opIds);
    const records = await this.pending();
    const database = await openDatabase();
    const transaction = database.transaction("outbox", "readwrite");
    for (const record of records) {
      if (record.sequence != null && accepted.has(record.operation.opId)) {
        transaction.objectStore("outbox").delete(record.sequence);
      }
    }
    await transactionDone(transaction);
    database.close();
  },

  async saveAnalysis(fen: string, lines: AnalysisLine[]): Promise<void> {
    await writeOne("analysis", { fen, lines, updatedAt: new Date().toISOString() } satisfies AnalysisRecord);
  },

  async analysis(fen: string): Promise<AnalysisLine[]> {
    return (await readOne<AnalysisRecord>("analysis", fen))?.lines ?? [];
  },

  async saveNodeAnalysis(gameId: string, nodeId: string, lines: AnalysisLine[]): Promise<void> {
    const primary = lines.slice().sort((left, right) => left.multipv - right.multipv)[0];
    if (!primary) return;
    await writeOne("nodeAnalysis", {
      key: `${gameId}:${nodeId}`,
      gameId,
      nodeId,
      scoreCp: primary.scoreCp,
      mate: primary.mate,
      updatedAt: new Date().toISOString(),
    } satisfies NodeAnalysisRecord);
  },

  async nodeAnalyses(gameId: string, nodeIds: string[]): Promise<Map<string, Pick<NodeAnalysisRecord, "scoreCp" | "mate">>> {
    if (nodeIds.length === 0) return new Map();
    const database = await openDatabase();
    const transaction = database.transaction("nodeAnalysis", "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore("nodeAnalysis");
    const records = await Promise.all(nodeIds.map((nodeId) => requestResult(store.get(`${gameId}:${nodeId}`))));
    await done;
    database.close();
    return new Map(records.flatMap((value) => {
      const record = value as NodeAnalysisRecord | undefined;
      return record ? [[record.nodeId, { scoreCp: record.scoreCp, mate: record.mate }]] : [];
    }));
  },
};
