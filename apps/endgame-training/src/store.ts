import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Attempt, CblLibrary, LocalManualAnalysisSummary, LocalManualFolder, LocalManualGame, TrainingLibrary, TrainingProblem } from "./types";

type NativeStore = {
  replaceLibrary(options: { library: string; problems: string }): Promise<void>;
  libraries(): Promise<{ items: string }>;
  problems(options: { libraryId: string }): Promise<{ items: string }>;
  attempts(options: { problemId: string }): Promise<{ items: string }>;
  saveAttempt(options: { attempt: string }): Promise<void>;
  deleteLibrary(options: { libraryId: string }): Promise<void>;
  hideProblem(options: { problemId: string }): Promise<void>;
  manualFolders(): Promise<{ items: string }>;
  createManualFolder(options: { path: string }): Promise<void>;
  renameManualFolder(options: { previous: string; next: string }): Promise<void>;
  deleteManualFolder(options: { path: string }): Promise<void>;
  manualGames(options: { folder?: string; query?: string }): Promise<{ items: string }>;
  saveManualGame(options: { game: string }): Promise<void>;
  openManualGame(options: { id: string }): Promise<{ item: string }>;
  deleteManualGame(options: { id: string }): Promise<void>;
  moveManualGame(options: { id: string; folder?: string }): Promise<void>;
  saveManualAnalysis(options: { summary: string }): Promise<void>;
};

const nativeStore = registerPlugin<NativeStore>("TrainingStore");
const memory = {
  libraries: [] as TrainingLibrary[],
  problems: [] as TrainingProblem[],
  attempts: [] as Attempt[],
  manualFolders: [] as LocalManualFolder[],
  manualGames: [] as LocalManualGame[],
  manualAnalysis: [] as LocalManualAnalysisSummary[],
};

function isNative() { return Capacitor.isNativePlatform(); }
function problemId(libraryId: string, sourceIndex: number) { return `${libraryId}:${sourceIndex}`; }
function nowIso() { return new Date().toISOString(); }

function normalizeManualFolderPath(path?: string) {
  return (path ?? "").split("/").map((part) => part.trim()).filter(Boolean).join("/");
}

function folderPrefixes(path: string) {
  const parts = normalizeManualFolderPath(path).split("/").filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function ensureMemoryFolder(path?: string) {
  for (const prefix of folderPrefixes(path ?? "")) {
    if (!memory.manualFolders.some((item) => item.path === prefix)) memory.manualFolders.push({ path: prefix, createdAt: nowIso() });
  }
}

async function fingerprint(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export const trainingStore = {
  async importLibrary(bytes: Uint8Array, parsed: CblLibrary) {
    const hash = await fingerprint(bytes);
    const id = `cbl:${hash}`;
    const library: TrainingLibrary = {
      id, title: parsed.title || "未命名残局题库", fingerprint: hash, parserVersion: 3,
      problemCount: parsed.problems.length, completedCount: 0, importedAt: new Date().toISOString(),
    };
    const problems: TrainingProblem[] = parsed.problems.map((problem) => ({
      ...problem, id: problemId(id, problem.sourceIndex), libraryId: id, completedAttempts: 0, totalElapsedMs: 0,
    }));
    if (isNative()) await nativeStore.replaceLibrary({ library: JSON.stringify(library), problems: JSON.stringify(problems) });
    else {
      memory.libraries = [...memory.libraries.filter((item) => item.id !== id), library];
      memory.problems = [...memory.problems.filter((item) => item.libraryId !== id), ...problems];
    }
    return library;
  },
  async libraries(): Promise<TrainingLibrary[]> {
    if (isNative()) return JSON.parse((await nativeStore.libraries()).items) as TrainingLibrary[];
    return memory.libraries.map((library) => {
      const ids = new Set(memory.problems.filter((item) => item.libraryId === library.id).map((item) => item.id));
      return { ...library, problemCount: ids.size, completedCount: new Set(memory.attempts.filter((item) => item.outcome === "completed" && ids.has(item.problemId)).map((item) => item.problemId)).size };
    });
  },
  async problems(libraryId: string): Promise<TrainingProblem[]> {
    if (isNative()) return JSON.parse((await nativeStore.problems({ libraryId })).items) as TrainingProblem[];
    return memory.problems.filter((item) => item.libraryId === libraryId).map((problem) => ({ ...problem, completedAttempts: memory.attempts.filter((item) => item.problemId === problem.id && item.outcome === "completed").length, totalElapsedMs: memory.attempts.filter((item) => item.problemId === problem.id).reduce((total, item) => total + item.elapsedMs, 0) }));
  },
  async attempts(problemId: string): Promise<Attempt[]> {
    if (isNative()) return JSON.parse((await nativeStore.attempts({ problemId })).items) as Attempt[];
    return memory.attempts.filter((item) => item.problemId === problemId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },
  async saveAttempt(attempt: Omit<Attempt, "id" | "createdAt">) {
    const record: Attempt = { ...attempt, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    if (isNative()) await nativeStore.saveAttempt({ attempt: JSON.stringify(record) });
    else memory.attempts.unshift(record);
  },
  async deleteLibrary(libraryId: string) {
    if (isNative()) await nativeStore.deleteLibrary({ libraryId });
    else { memory.libraries = memory.libraries.filter((item) => item.id !== libraryId); memory.problems = memory.problems.filter((item) => item.libraryId !== libraryId); }
  },
  async hideProblem(problemId: string) {
    if (isNative()) await nativeStore.hideProblem({ problemId });
    else memory.problems = memory.problems.filter((item) => item.id !== problemId);
  },
  async manualFolders(): Promise<LocalManualFolder[]> {
    if (isNative()) return JSON.parse((await nativeStore.manualFolders()).items) as LocalManualFolder[];
    return [...memory.manualFolders].sort((left, right) => left.path.localeCompare(right.path, "zh-Hans-CN"));
  },
  async createManualFolder(path: string) {
    const normalized = normalizeManualFolderPath(path);
    if (!normalized) throw new Error("目录名称不能为空。");
    if (isNative()) await nativeStore.createManualFolder({ path: normalized });
    else ensureMemoryFolder(normalized);
  },
  async renameManualFolder(previous: string, next: string) {
    const from = normalizeManualFolderPath(previous);
    const to = normalizeManualFolderPath(next);
    if (!from || !to) throw new Error("目录路径不能为空。");
    if (isNative()) await nativeStore.renameManualFolder({ previous: from, next: to });
    else {
      ensureMemoryFolder(to);
      memory.manualFolders = memory.manualFolders.map((folder) => folder.path === from || folder.path.startsWith(`${from}/`) ? { ...folder, path: `${to}${folder.path.slice(from.length)}` } : folder);
      memory.manualGames = memory.manualGames.map((game) => {
        const folder = normalizeManualFolderPath(game.folderPath);
        return folder === from || folder.startsWith(`${from}/`) ? { ...game, folderPath: `${to}${folder.slice(from.length)}`, updatedAt: nowIso() } : game;
      });
    }
  },
  async deleteManualFolder(path: string) {
    const normalized = normalizeManualFolderPath(path);
    if (!normalized) throw new Error("目录路径不能为空。");
    if (isNative()) await nativeStore.deleteManualFolder({ path: normalized });
    else {
      const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
      memory.manualFolders = memory.manualFolders.filter((folder) => folder.path !== normalized && !folder.path.startsWith(`${normalized}/`));
      memory.manualGames = memory.manualGames.map((game) => {
        const folder = normalizeManualFolderPath(game.folderPath);
        return folder === normalized || folder.startsWith(`${normalized}/`) ? { ...game, folderPath: parent || undefined, updatedAt: nowIso() } : game;
      });
    }
  },
  async manualGames(folder?: string, query?: string): Promise<LocalManualGame[]> {
    const normalized = normalizeManualFolderPath(folder);
    if (isNative()) return JSON.parse((await nativeStore.manualGames({ folder: normalized || undefined, query: query?.trim() || undefined })).items) as LocalManualGame[];
    const needle = query?.trim();
    return memory.manualGames
      .filter((game) => !normalized || normalizeManualFolderPath(game.folderPath) === normalized)
      .filter((game) => !needle || `${game.title}${game.note}${game.folderPath ?? ""}`.includes(needle))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  },
  async saveManualGame(game: LocalManualGame): Promise<LocalManualGame> {
    const record: LocalManualGame = { ...game, folderPath: normalizeManualFolderPath(game.folderPath) || undefined, updatedAt: nowIso() };
    if (record.folderPath) ensureMemoryFolder(record.folderPath);
    if (isNative()) await nativeStore.saveManualGame({ game: JSON.stringify(record) });
    else memory.manualGames = [record, ...memory.manualGames.filter((item) => item.id !== record.id)];
    return record;
  },
  async openManualGame(id: string): Promise<LocalManualGame | undefined> {
    if (isNative()) {
      const item = (await nativeStore.openManualGame({ id })).item;
      return item ? JSON.parse(item) as LocalManualGame : undefined;
    }
    return memory.manualGames.find((item) => item.id === id);
  },
  async deleteManualGame(id: string) {
    if (isNative()) await nativeStore.deleteManualGame({ id });
    else {
      memory.manualGames = memory.manualGames.filter((item) => item.id !== id);
      memory.manualAnalysis = memory.manualAnalysis.filter((item) => item.gameId !== id);
    }
  },
  async moveManualGame(id: string, folder?: string) {
    const normalized = normalizeManualFolderPath(folder);
    if (normalized) ensureMemoryFolder(normalized);
    if (isNative()) await nativeStore.moveManualGame({ id, folder: normalized || undefined });
    else memory.manualGames = memory.manualGames.map((game) => game.id === id ? { ...game, folderPath: normalized || undefined, updatedAt: nowIso() } : game);
  },
  async saveManualAnalysis(summary: LocalManualAnalysisSummary) {
    if (isNative()) await nativeStore.saveManualAnalysis({ summary: JSON.stringify(summary) });
    else memory.manualAnalysis = [summary, ...memory.manualAnalysis.filter((item) => item.gameId !== summary.gameId || item.nodeId !== summary.nodeId)];
  },
};
