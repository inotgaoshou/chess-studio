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
const app = readFileSync(`${nodeProcess.cwd()}/src/App.tsx`, "utf8");

function declarationsFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("compact board-first workspace layout", () => {
  it("gives review, research, and training the same full-height board work area", () => {
    const workspaceModes = ["review", "research", "training"];

    for (const mode of workspaceModes) {
      const section = `.workspace.layout-compact.workspace-mode-${mode} > .board-section`;
      const stack = `.workspace.layout-compact.workspace-mode-${mode} .board-main-stack`;
      const stage = `.workspace.layout-compact.workspace-mode-${mode} .board-stage`;

      expect(styles).toContain(section);
      expect(styles).toContain(stack);
      expect(styles).toContain(stage);
    }

    expect(styles).toMatch(/workspace-mode-training > \.board-section[\s\S]*?display:block;[\s\S]*?height:100%/);
    expect(styles).toMatch(/workspace-mode-training \.board-main-stack[\s\S]*?overflow:hidden/);
    expect(styles).toMatch(/workspace-mode-training \.board-stage[\s\S]*?flex:1 1 0;[\s\S]*?min-height:0/);
  });

  it("sizes the board from its stage container instead of a viewport height guess", () => {
    const stageInner = declarationsFor(".workspace.layout-compact.workspace-mode-training .board-stage-inner");

    expect(stageInner).toMatch(/100cqw/);
    expect(stageInner).toMatch(/100cqh/);
    expect(stageInner).not.toMatch(/100dvh/);
  });

  it("moves the research manual into the cloud-book reference rail", () => {
    expect(app).toContain('candidateLinesView("board-candidate-rail", workspaceMode !== "research")');
    expect(app).toContain('className="research-reference-stack"');
    expect(app).toContain('compactManualDock("research-manual-panel")');
    expect(styles).toMatch(/workspace-mode-research \.research-reference-stack[\s\S]*?grid-template-rows:minmax\(260px, 1fr\) minmax\(280px, 1fr\)/);
  });
});
