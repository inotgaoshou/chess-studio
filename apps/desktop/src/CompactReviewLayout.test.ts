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
  it("gives review, research, training, and opening the same full-height board work area", () => {
    const workspaceModes = ["review", "research", "training", "opening"];

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
    const stageInner = styles.match(/workspace-mode-training \.board-stage-inner[\s\S]*?\{([^}]*)\}/)?.[1] ?? "";

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

  it("centers the compact playback position-search icon inside its button cell", () => {
    const base = declarationsFor(".playback-controls .position-search-control");
    const compact = declarationsFor(".app-shell.layout-compact .compact-manual-panel .playback-controls .position-search-control");
    const icon = declarationsFor(".playback-controls .position-search-control svg");

    expect(base).toContain("justify-self: center");
    expect(base).toContain("display: grid");
    expect(base).toContain("place-items: center");
    expect(compact).toContain("justify-self: center");
    expect(compact).toContain("place-items: center");
    expect(icon).toContain("display: block");
  });

  it("keeps reference preview actions from covering the selected game title", () => {
    const previewHeader = declarationsFor(".reference-game-preview > header");
    const previewActions = declarationsFor(".reference-game-preview-actions");
    const openingPill = declarationsFor(".reference-game-search-list em");
    const collapsedBody = declarationsFor(".reference-game-search-body.filters-collapsed");

    expect(previewHeader).toContain("display: grid");
    expect(previewHeader).toContain("grid-template-columns: minmax(0,1fr)");
    expect(previewActions).toContain("justify-content: flex-start");
    expect(openingPill).toContain("text-overflow: ellipsis");
    expect(openingPill).toContain("white-space: nowrap");
    expect(collapsedBody).toContain("grid-template-columns: 68px");
  });

  it("keeps master opening board geometry aligned with review and uses the side-note slot for situation analysis", () => {
    expect(styles).toContain("grid-template-columns: minmax(900px, 1fr) minmax(280px, 320px)");
    expect(styles).toContain("grid-template-columns:minmax(0, 1fr) 54px");
    expect(styles).toContain("grid-template-columns:max-content minmax(500px, 620px)");
    expect(styles).toContain("column-gap:8px");
    expect(styles).toContain("padding-left:4px");
    expect(styles).toContain(".workspace.layout-compact.workspace-mode-opening .board-stage-inner.eval-rail-hidden");
    expect(styles).toContain("grid-template-columns:minmax(0, 1fr)");
    expect(styles).toContain("justify-content:start");
    expect(styles).toContain("justify-self:start");
    expect(styles).toContain("workspace-mode-opening > .board-section");
    expect(styles).toContain("display:block");
    expect(styles).toContain(".board-position-brief");
    expect(styles).toContain(".board-position-brief-trend");
    expect(styles).toContain(".board-position-brief-tabs");
    expect(styles).toContain(".board-position-brief-tabs button.active");
    expect(styles).toContain(".board-position-brief-page.report");
    expect(styles).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(styles).toContain(".opening-brief-scoreline");
    expect(styles).toContain(".opening-brief-phase-table");
    expect(styles).toContain(".opening-brief-issue-switch");
    expect(styles).toContain(".opening-brief-issue-list");
    expect(styles).toContain(".board-position-brief-rail-toggle");
    expect(styles).toContain("margin-right: 18px");
    expect(styles).toContain(".board-position-brief-trend .trend-axis-label");
    expect(styles).toContain("font-size: 10px");
    expect(styles).toContain("letter-spacing: .04em");
    expect(styles).toContain(".board-position-brief-trend circle.muted");
    expect(styles).toContain("grid-template-columns: auto auto auto");
    expect(styles).toContain("letter-spacing: -.08em");
    expect(styles).toContain("grid-template-columns: minmax(0, 1fr) 24px 30px");
    expect(styles).toContain("grid-template-columns: minmax(38px,auto) 30px minmax(42px,1fr)");
    expect(styles).toContain("font-size: 14px");
    expect(styles).toContain("height: 20px");
  });
});
