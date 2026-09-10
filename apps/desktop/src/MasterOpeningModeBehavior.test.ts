import { describe, expect, it } from "vitest";

type NodeProcess = {
  cwd(): string;
  getBuiltinModule(name: "fs"): {
    readFileSync(path: string, encoding: "utf8"): string;
  };
};

const nodeProcess = (globalThis as typeof globalThis & { process: NodeProcess }).process;
const { readFileSync } = nodeProcess.getBuiltinModule("fs");
const app = readFileSync(`${nodeProcess.cwd()}/src/App.tsx`, "utf8");

describe("master opening workspace behavior", () => {
  it("hides selected piece thought cards while the master opening mode is active", () => {
    expect(app).toContain('if (workspaceMode === "opening")');
    expect(app).toContain('setSelectedPieceInspection(undefined);');
    expect(app).toContain('workspaceMode !== "opening" && showMoveThoughts && selectedPieceThought');
    expect(app).toContain('workspaceMode !== "opening" && showMoveThoughts && selectedPieceThought?.square.row');
  });
});
