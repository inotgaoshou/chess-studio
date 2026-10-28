export type ProblemSourceLibrary = { id: string; title: string };
export function problemSourceLabel(problem: { libraryId: string; sourceIndex: number }, libraries: ProblemSourceLibrary[]): string | undefined {
  const id = problem.libraryId.replace(/^platform:/, "");
  const title = libraries.find(library => library.id.replace(/^platform:/, "") === id)?.title?.trim();
  return title ? `来源：《${title}》 · 原题第 ${problem.sourceIndex + 1} 题` : undefined;
}
