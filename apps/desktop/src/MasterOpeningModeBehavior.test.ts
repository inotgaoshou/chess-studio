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

  it("treats local reference library games as master/reference games on the board", () => {
    expect(app).toContain('board.sourceFormat === "reference-library"');
    expect(app).toContain('opening: noteField(board.note, "布局")');
    expect(app).toContain('const showMasterGameSidePanel = isMasterLibraryGame && desktopPreferences.layoutMode !== "compact"');
    expect(app).toContain('showMasterGameSidePanel ? "has-master-identity" : ""');
  });

  it("keeps master opening navigation light and adds a compact board situation brief", () => {
    expect(app).toContain('const boardEvaluationBlackShare = 100 - boardEvaluationRedShare');
    expect(app).toContain('const openingCompactMode = workspaceMode === "opening" && desktopPreferences.layoutMode === "compact"');
    expect(app).toContain('const showBoardEvaluationRail = !openingCompactMode || openingEvaluationRailVisible');
    expect(app).toContain('setOpeningEvaluationRailVisible(false)');
    expect(app).toContain('aria-label="棋盘红黑局势分析"');
    expect(app).toContain('aria-pressed={openingEvaluationRailVisible}');
    expect(app).toContain('const [openingBriefTab, setOpeningBriefTab] = useState<"trend" | "report" | "issues">("trend")');
    expect(app).toContain('setOpeningBriefTab("report")');
    expect(app).toContain('setOpeningBriefTab("issues")');
    expect(app).toContain('opening-brief-scoreline');
    expect(app).toContain('opening-brief-phase-table');
    expect(app).toContain('opening-brief-issue-switch');
    expect(app).toContain('opening-brief-issue-list');
    expect(app).toContain('"显示柱状"');
    expect(app).toContain('"隐藏柱状"');
    expect(app).toContain('showBoardEvaluationRail && <aside className={`board-eval-rail');
    expect(app).toContain('trend-scale-label trend-axis-label');
    expect(app).toContain("openingTrendChart.left - 46");
    expect(app).toContain('preserveAspectRatio="xMinYMid meet"');
    expect(app).toContain(">均势</text>");
    expect(app).toContain('"muted"');
    expect(app).toContain('reportTrendSamples.length > 1');
    expect(app).toContain(': (evaluation?.samples ?? [])');
    expect(app).toContain('reportProgressTrendSamples.length > 1');
    expect(app).toContain('reportProgressTrendSample(progress, boardRef.current)');
    expect(app).toContain('onClick={() => reportBusy ? void cancelGameReport() : void generateGameReport()}');
    expect(app).toContain('"生成整局走势"');
    expect(app).toContain('chessPlatform.listReferenceGames(undefined, undefined, 10, 0, { positionFen: fen })');
  });
});
