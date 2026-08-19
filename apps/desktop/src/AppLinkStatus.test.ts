import { describe, expect, it } from "vitest";
import { analysisPassPlan, canRequestEngineMoveNow, clampAnalysisPanelReopenTop, compactBoardEvaluationRailText, compactEngineDefaultPosition, effectiveBoardReversedForLink, engineBranchActionPresentation, evaluateBestMovePractice, linkAnalysisStatusText, linkMiniBoardHintText, linkMoveDisplayText, linkPhaseLabel, linkSessionStateLabel, linkStatusRenderKey, mainBoardLastMoveOverlayPoints, nextStableLinkMiniPieceState, selectAnalysisArrowLines, selectLinkDisplayedLastMove, shouldAutoGenerateMasterGameReport, shouldRefreshAnalysisAfterEngineSettingsSave, shouldRefreshAnalysisAfterMove, shouldRestartAnalysisWhenNoCandidates, shouldShowLinkMiniBoard, stableLinkMiniPiecesForMove } from "./App";
import type { LinkSessionStatus, Piece } from "./platform";

function status(overrides: Partial<LinkSessionStatus> = {}): LinkSessionStatus {
  return {
    source: "windowLink",
    mode: "autoPlay",
    state: "tracking",
    phase: "tracking",
    frameRate: 3,
    stableFrames: 2,
    requiredStableFrames: 2,
    captureRunning: true,
    ...overrides,
  };
}

describe("link floating status helpers", () => {
  it("keeps the collapsed analysis reopen control inside the viewport", () => {
    expect(clampAnalysisPanelReopenTop(-40, 640)).toBe(7);
    expect(clampAnalysisPanelReopenTop(260, 640)).toBe(260);
    expect(clampAnalysisPanelReopenTop(900, 640)).toBe(500);
    expect(clampAnalysisPanelReopenTop(Number.NaN, 640)).toBe(7);
  });

  it("starts the compact engine dialog lower than the top toolbar", () => {
    expect(compactEngineDefaultPosition()).toEqual({ x: 0, y: 150 });
  });

  it("classifies best-move practice as best, top-n, or missed", () => {
    const practice = {
      fen: "fen",
      ply: 8,
      bestMove: "b0c2",
      bestMoveText: "马二进三",
      topMoves: [
        { iccs: "b0c2", text: "马二进三", rank: 1 },
        { iccs: "h2e2", text: "炮二平五", rank: 2 },
      ],
    };

    expect(evaluateBestMovePractice(practice, "b0c2", "马二进三")?.kind).toBe("best");
    expect(evaluateBestMovePractice(practice, "h2e2", "炮二平五")?.message).toContain("可接受");
    expect(evaluateBestMovePractice(practice, "a0a1", "车一进一")?.message).toContain("未命中");
  });

  it("prefers Chinese notation for pending confirmed moves", () => {
    expect(linkMoveDisplayText("g3g4", "兵三进一")).toBe("兵三进一（g3g4）");
    expect(linkSessionStateLabel("tracking", "confirmPlay", "g3g4", "兵三进一（g3g4）")).toBe("等待网页走子 兵三进一（g3g4）");
    expect(linkAnalysisStatusText(status({ mode: "confirmPlay", pendingExternalMove: "g3g4" }), false, false, 1, "红方", "兵三进一", "兵三进一（g3g4）")).toContain("兵三进一（g3g4）");
  });

  it("mirrors the engine busy state for auto play sessions", () => {
    expect(linkAnalysisStatusText(status({ autoSide: "red" }), true, false, 0, "红方")).toContain("引擎正在分析");
    expect(linkAnalysisStatusText(status({ autoSide: "red" }), true, false, 0, "红方")).toContain("自动方：红方");
  });

  it("hides stale candidates until the current board has fresh analysis", () => {
    expect(linkAnalysisStatusText(status({ autoSide: "black" }), false, true, 3, "黑方", "h2e2")).toBe("局面已同步，候选已过期，等待引擎刷新后再自动走子");
  });

  it("shows a clear phase when a web manual position jump is synchronized", () => {
    expect(linkPhaseLabel(status({ phase: "position_jump_synced" }))).toBe("跳转已同步");
  });

  it("shows a clear phase when a live move is synchronized", () => {
    expect(linkPhaseLabel(status({ phase: "move_synced" }))).toBe("走子已同步");
  });

  it("does not repaint the link floating panel for heartbeat-only status updates", () => {
    expect(linkStatusRenderKey(status({ lastHeartbeatAt: "1000" }))).toBe(linkStatusRenderKey(status({ lastHeartbeatAt: "2000" })));
    expect(linkStatusRenderKey(status({ frameRate: 2.6 }))).not.toBe(linkStatusRenderKey(status({ frameRate: 3.1 })));
  });

  it("uses compact mate text for the narrow board evaluation rail", () => {
    expect(compactBoardEvaluationRailText({
      sideText: "红方绝杀",
      scoreText: "剩余 1 步杀",
      mateSide: "红方",
      mateIn: 1,
    })).toEqual({ side: "红杀", score: "1步杀" });
  });

  it("names the side to move and previous move in the link mini board hint", () => {
    expect(linkMiniBoardHintText({
      observed: true,
      sideToMove: "黑方",
      arrowCount: 3,
      analysisBusy: false,
      analysisIsStale: false,
      firstMove: "马8进7",
      lastMove: { movedBy: "红方", notation: "兵七进一" },
      fallback: "等待识别",
    })).toBe("黑方行棋 · 黑方首选：马8进7 · 上一着红方：兵七进一");
  });

  it("uses the linked board orientation for the synced main board display", () => {
    expect(effectiveBoardReversedForLink(status({ boardOrientation: "blackAtBottom", latestFen: "fen-a" }), "fen-a", false)).toBe(true);
    expect(effectiveBoardReversedForLink(status({ boardOrientation: "redAtBottom", latestFen: "fen-a" }), "fen-a", true)).toBe(false);
  });

  it("keeps the flowing research-board move markers on canonical points when flipped", () => {
    const move = { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } };

    expect(mainBoardLastMoveOverlayPoints(move, false)).toEqual({
      from: { x: 200, y: 1160 },
      to: { x: 320, y: 920 },
    });
    expect(mainBoardLastMoveOverlayPoints(move, true)).toEqual({
      from: { x: 920, y: 80 },
      to: { x: 800, y: 320 },
    });
    expect(mainBoardLastMoveOverlayPoints(move, false, "qingxin-zhuyun")).toEqual({
      from: { x: 205, y: 1145 },
      to: { x: 326, y: 910 },
    });
    expect(mainBoardLastMoveOverlayPoints(undefined, false)).toBeUndefined();
  });

  it("keeps the manual board orientation before the linked position is synced", () => {
    expect(effectiveBoardReversedForLink(status({ boardOrientation: "blackAtBottom", latestFen: "fen-a" }), "fen-b", false)).toBe(false);
    expect(effectiveBoardReversedForLink(status({ state: "waitingStableFrames", boardOrientation: "blackAtBottom", latestFen: "fen-a" }), "fen-a", false)).toBe(false);
  });

  it("keeps the linked orientation while a synced board is waiting for the next stable frame", () => {
    expect(effectiveBoardReversedForLink(status({ state: "waitingStableFrames", boardOrientation: "blackAtBottom", latestFen: "fen-a", initialPositionSeen: true }), "fen-a", false)).toBe(true);
  });

  it("keeps showing the mini board after link has synced once to avoid preview flicker", () => {
    expect(shouldShowLinkMiniBoard(status({ latestFen: "fen-a", initialPositionSeen: false }), "fen-a")).toBe(true);
    expect(shouldShowLinkMiniBoard(status({ latestFen: "old-fen", initialPositionSeen: true }), "new-fen")).toBe(true);
    expect(shouldShowLinkMiniBoard(status({ state: "waitingStableFrames", latestFen: "old-fen", initialPositionSeen: true }), "new-fen")).toBe(true);
    expect(shouldShowLinkMiniBoard(status({ state: "waitingStableFrames", latestFen: "old-fen", initialPositionSeen: false }), "new-fen")).toBe(false);
  });

  it("stabilizes link mini board pieces by applying only the confirmed move", () => {
    const previous: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 9, col: 0, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
    ];
    const jitteredCurrent: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 8, col: 0, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 2, color: "red", kind: "cannon", label: "炮" },
    ];

    expect(stableLinkMiniPiecesForMove(previous, jitteredCurrent, {
      from: { row: 9, col: 8 },
      to: { row: 8, col: 8 },
    }).map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "red-cannon-7-1",
      "red-king-9-4",
      "red-rook-8-8",
      "red-rook-9-0",
    ]);
  });

  it("recovers a safely re-detected static piece without accepting unrelated jitter", () => {
    const previousMissingElephant: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 1, color: "red", kind: "cannon", label: "炮" },
    ];
    const currentWithRecoveredElephantAndJitter: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 7, col: 2, color: "red", kind: "cannon", label: "炮" },
      { row: 9, col: 2, color: "red", kind: "elephant", label: "相" },
    ];

    expect(stableLinkMiniPiecesForMove(previousMissingElephant, currentWithRecoveredElephantAndJitter, {
      from: { row: 9, col: 8 },
      to: { row: 8, col: 8 },
    }).map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "red-cannon-7-1",
      "red-elephant-9-2",
      "red-king-9-4",
      "red-rook-8-8",
    ]);
  });

  it("does not recover a color-flipped static piece as a new link mini piece", () => {
    const previous: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 6, col: 0, color: "black", kind: "pawn", label: "卒" },
    ];
    const colorFlickerCurrent: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
      { row: 6, col: 1, color: "red", kind: "pawn", label: "兵" },
    ];

    expect(stableLinkMiniPiecesForMove(previous, colorFlickerCurrent, {
      from: { row: 9, col: 8 },
      to: { row: 8, col: 8 },
    }).map((piece) => `${piece.color}-${piece.kind}-${piece.row}-${piece.col}`).sort()).toEqual([
      "black-king-0-4",
      "black-pawn-6-0",
      "red-king-9-4",
      "red-rook-8-8",
    ]);
  });

  it("holds the link mini board while a new recognition frame has no confirmed last move yet", () => {
    const previous: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
      { row: 9, col: 8, color: "red", kind: "rook", label: "车" },
    ];
    const unstableRecognitionFrame: Piece[] = [
      { row: 9, col: 4, color: "black", kind: "king", label: "将" },
      { row: 0, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 8, col: 8, color: "red", kind: "rook", label: "车" },
    ];

    expect(nextStableLinkMiniPieceState(
      { active: true, fen: "old-fen", moveKey: "old-move", pieces: previous },
      {
        boardFen: "new-fen",
        boardPieces: unstableRecognitionFrame,
        linkShouldShowMiniBoard: true,
      },
    ).pieces).toBe(previous);
  });

  it("allows a full link mini board refresh for verified position jumps", () => {
    const previous: Piece[] = [
      { row: 9, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 0, col: 4, color: "black", kind: "king", label: "将" },
    ];
    const jumpedPosition: Piece[] = [
      { row: 8, col: 4, color: "red", kind: "king", label: "帅" },
      { row: 1, col: 4, color: "black", kind: "king", label: "将" },
    ];

    expect(nextStableLinkMiniPieceState(
      { active: true, fen: "old-fen", moveKey: "old-move", pieces: previous },
      {
        boardFen: "jump-fen",
        boardPieces: jumpedPosition,
        linkShouldShowMiniBoard: true,
        allowFullRefreshWithoutMove: true,
      },
    ).pieces).toBe(jumpedPosition);
  });

  it("does not let stale link status last move override the current board move", () => {
    const staleStatusMove = {
      from: { row: 9, col: 0 },
      to: { row: 8, col: 0 },
      notation: "车一进一",
      movedBy: "红方" as const,
    };
    const boardLastMove = {
      from: { row: 9, col: 8 },
      to: { row: 8, col: 8 },
      notation: "车九进一",
      movedBy: "红方" as const,
    };

    expect(selectLinkDisplayedLastMove({
      linkShouldShowMiniBoard: true,
      statusLatestFen: "old-fen",
      boardFen: "new-fen",
      statusLastMove: staleStatusMove,
      boardLastMove,
    })).toBe(boardLastMove);
  });

  it("uses link status last move when it belongs to the current board fen", () => {
    const statusLastMove = {
      from: { row: 9, col: 0 },
      to: { row: 8, col: 0 },
      notation: "车一进一",
      movedBy: "红方" as const,
    };
    const boardLastMove = {
      from: { row: 9, col: 8 },
      to: { row: 8, col: 8 },
      notation: "车九进一",
      movedBy: "红方" as const,
    };

    expect(selectLinkDisplayedLastMove({
      linkShouldShowMiniBoard: true,
      statusLatestFen: "same-fen",
      boardFen: "same-fen",
      statusLastMove,
      boardLastMove,
    })).toBe(statusLastMove);
  });

  it("turns the engine branch button into a cancel action while virtual branches are shown", () => {
    expect(engineBranchActionPresentation(false, false, false)).toMatchObject({
      label: "分支",
      ariaLabel: "显示引擎分支",
    });
    expect(engineBranchActionPresentation(true, false, false)).toMatchObject({
      label: "取消",
      ariaLabel: "取消引擎分支预览",
    });
  });

  it("keeps analysis hints refreshing after an adopted engine move when analysis mode is active", () => {
    expect(shouldRefreshAnalysisAfterMove({
      playable: true,
      isPlaying: false,
      reportBusy: false,
      engineSide: "none",
      engineThinking: false,
      autoAnalyze: false,
      analysisHintsEnabled: true,
      platformKind: "desktop",
      enginePath: "/bin/pikafish",
      online: false,
      token: "",
    })).toBe(true);

    expect(shouldRefreshAnalysisAfterMove({
      playable: true,
      isPlaying: false,
      reportBusy: false,
      engineSide: "red",
      engineThinking: false,
      autoAnalyze: true,
      analysisHintsEnabled: true,
      platformKind: "desktop",
      enginePath: "/bin/pikafish",
      online: false,
      token: "",
    })).toBe(false);
  });

  it("refreshes current candidates after saving a MultiPV change even when auto analysis is disabled", () => {
    expect(shouldRefreshAnalysisAfterEngineSettingsSave({
      analysisConfigChanged: true,
      multipvChanged: true,
      hadCurrentAnalysis: false,
      playable: true,
      isPlaying: false,
      reportBusy: false,
      engineSide: "none",
      engineThinking: false,
      autoAnalyzeBefore: false,
      autoAnalyzeAfter: false,
      analysisHintsEnabled: false,
      platformKind: "desktop",
      enginePath: "/bin/pikafish",
      online: false,
      token: "",
    })).toBe(true);
  });

  it("does not refresh settings changes when the current board cannot start analysis", () => {
    expect(shouldRefreshAnalysisAfterEngineSettingsSave({
      analysisConfigChanged: true,
      multipvChanged: true,
      hadCurrentAnalysis: true,
      playable: true,
      isPlaying: false,
      reportBusy: false,
      engineSide: "red",
      engineThinking: false,
      autoAnalyzeBefore: true,
      autoAnalyzeAfter: true,
      analysisHintsEnabled: true,
      platformKind: "desktop",
      enginePath: "/bin/pikafish",
      online: false,
      token: "",
    })).toBe(false);
  });

  it("restarts a busy analysis when the current position has no returned candidate", () => {
    expect(shouldRestartAnalysisWhenNoCandidates({
      analysisBusy: true,
      boardFen: "current-fen",
      engineAnalyses: {
        primary: { fen: "current-fen", lines: [] },
      },
    })).toBe(true);

    expect(shouldRestartAnalysisWhenNoCandidates({
      analysisBusy: true,
      boardFen: "current-fen",
      engineAnalyses: {
        primary: { fen: "current-fen", lines: [{ multipv: 1, pv: ["h2e2"] }] },
      },
    })).toBe(false);

    expect(shouldRestartAnalysisWhenNoCandidates({
      analysisBusy: false,
      boardFen: "current-fen",
      engineAnalyses: {},
    })).toBe(false);
  });

  it("keeps all fresh arrow candidates when multipv is configured above five", () => {
    const lines = Array.from({ length: 6 }, (_, index) => ({
      multipv: index + 1,
      pv: [`a${index}b${index}`],
    }));

    expect(selectAnalysisArrowLines({
      lines,
      analysisFen: "current-fen",
      analysisArrowFen: "current-fen",
      boardFen: "current-fen",
      analysisIsStale: false,
    }).map((line) => line.multipv)).toEqual([1, 2, 3, 4, 5, 6]);

    expect(selectAnalysisArrowLines({
      lines,
      analysisFen: "old-fen",
      analysisArrowFen: "old-fen",
      boardFen: "current-fen",
      analysisIsStale: true,
    })).toEqual([]);
  });

  it("hides arrows when the arrow state is cleared during a coach study", () => {
    expect(selectAnalysisArrowLines({
      lines: [{ multipv: 1, pv: ["h2e2"] }],
      analysisFen: "current-fen",
      analysisArrowFen: undefined,
      boardFen: "current-fen",
      analysisIsStale: false,
    })).toHaveLength(0);
  });

  it("allows immediate engine move when it is the selected engine side turn", () => {
    expect(canRequestEngineMoveNow({
      platformKind: "desktop",
      playable: true,
      reportBusy: false,
      engineSide: "red",
      engineStarting: false,
      sideToMove: "红方",
    })).toBe(true);

    expect(canRequestEngineMoveNow({
      platformKind: "desktop",
      playable: true,
      reportBusy: false,
      engineSide: "black",
      engineStarting: false,
      sideToMove: "红方",
    })).toBe(false);
  });

  it("uses quick candidates before manual deep analysis", () => {
    expect(analysisPassPlan({
      automatic: false,
      platformKind: "desktop",
      searchMode: "depth",
      searchValue: 24,
    })).toMatchObject({
      quick: { searchMode: "time", searchValue: 1200 },
      deep: { searchMode: "depth", searchValue: 24 },
    });
  });

  it("keeps automatic analysis responsive while continuing the configured deep search", () => {
    expect(analysisPassPlan({
      automatic: true,
      platformKind: "desktop",
      searchMode: "depth",
      searchValue: 24,
    })).toMatchObject({
      quick: { searchMode: "time", searchValue: 1200 },
      deep: { searchMode: "depth", searchValue: 24 },
    });

    expect(analysisPassPlan({
      automatic: false,
      platformKind: "desktop",
      searchMode: "time",
      searchValue: 1000,
    })).toMatchObject({
      quick: undefined,
      deep: { searchMode: "time", searchValue: 1000 },
    });
  });

  it("starts master game report automatically only for desktop with a configured engine", () => {
    expect(shouldAutoGenerateMasterGameReport({
      platformKind: "desktop",
      enginePath: "/engines/pikafish",
    })).toBe(true);
    expect(shouldAutoGenerateMasterGameReport({
      platformKind: "desktop",
      enginePath: "  ",
    })).toBe(false);
    expect(shouldAutoGenerateMasterGameReport({
      platformKind: "web",
      enginePath: "/engines/pikafish",
    })).toBe(false);
  });
});
