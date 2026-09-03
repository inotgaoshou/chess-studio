import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Attempt, CblLibrary, TrainingLibrary, TrainingProblem } from "./types";

type NativeStore = {
  replaceLibrary(options: { library: string; problems: string }): Promise<void>;
  libraries(): Promise<{ items: string }>;
  problems(options: { libraryId: string }): Promise<{ items: string }>;
  attempts(options: { problemId: string }): Promise<{ items: string }>;
  saveAttempt(options: { attempt: string }): Promise<void>;
  deleteLibrary(options: { libraryId: string }): Promise<void>;
  hideProblem(options: { problemId: string }): Promise<void>;
};

const nativeStore = registerPlugin<NativeStore>("TrainingStore");
const memory = { libraries: [] as TrainingLibrary[], problems: [] as TrainingProblem[], attempts: [] as Attempt[] };

function isNative() { return Capacitor.isNativePlatform(); }
function problemId(libraryId: string, sourceIndex: number) { return `${libraryId}:${sourceIndex}`; }

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
};
