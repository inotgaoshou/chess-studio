import { describe, expect, it } from "vitest";

type NodeProcess = {
  cwd(): string;
  getBuiltinModule(name: "fs"): {
    readFileSync(path: string, encoding: "utf8"): string;
  };
};

const nodeProcess = (globalThis as typeof globalThis & { process: NodeProcess }).process;
const { readFileSync } = nodeProcess.getBuiltinModule("fs");
const styles = readFileSync(`${nodeProcess.cwd()}/src/styles.css`, "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("compact review board layout", () => {
  it("fits the board into the remaining stack height without an inner scrollbar", () => {
    const stack = declarationsFor(".workspace.layout-compact.review-mode-active .board-main-stack");
    const stage = declarationsFor(".workspace.layout-compact.review-mode-active .board-stage");

    expect(stack).toMatch(/overflow:\s*hidden/);
    expect(stage).toMatch(/flex:\s*1\s+1\s+0/);
    expect(stage).toMatch(/height:\s*auto/);
    expect(stage).toMatch(/overflow:\s*hidden/);
  });
});
