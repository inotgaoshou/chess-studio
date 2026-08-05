import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkinShopDialog } from "./SkinShopDialog";
import type { DesktopPreferencesDto } from "./platform";
import { requiresSignInForSkinPatch } from "./skinAccess";

afterEach(cleanup);

const preferences: DesktopPreferencesDto = {
  enginePath: "",
  threads: 2,
  hashMb: 256,
  multipv: 2,
  candidateLineMoves: 16,
  searchMode: "depth",
  searchValue: 30,
  moveTimeMs: 1000,
  ponder: false,
  autoAnalyze: true,
  boardSkin: "default",
  pieceSkin: "default",
  colorTheme: "dark",
  libraryCollapsed: true,
  candidateRailCollapsed: false,
  analysisPanelCollapsed: false,
  evaluationCollapsed: true,
  branchArrowColor: "#2f80ed",
  analysisEngineMode: "single",
  parallelEngineIds: [],
  workspacePanel: "moves",
  layoutMode: "studio",
  manualViewMode: "track",
  reportDepth: 30,
  ruleMode: "domestic2020",
  serverUrl: "http://127.0.0.1:8080",
};

describe("hongmu free skin", () => {
  it("is available and equippable without signing in", () => {
    const onEquip = vi.fn();
    render(<SkinShopDialog
      preferences={preferences}
      signedIn={false}
      onClose={vi.fn()}
      onPreview={vi.fn()}
      onEquip={onEquip}
    />);

    const card = screen.getByText("红木鎏金").closest("article")!;
    fireEvent.click(card.querySelector("button")!);

    expect(onEquip).toHaveBeenCalledWith({ boardSkin: "hongmu", pieceSkin: "default" });

    fireEvent.click(screen.getByRole("button", { name: "将棋子" }));
    fireEvent.click(screen.getByText("红木鎏金").closest("article")!.querySelector("button")!);
    expect(onEquip).toHaveBeenLastCalledWith({ boardSkin: "default", pieceSkin: "hongmu" });
  });

  it("allows selecting hongmu while retaining an existing account skin", () => {
    expect(requiresSignInForSkinPatch(
      { boardSkin: "jingdian", pieceSkin: "xinghe" },
      { boardSkin: "hongmu", pieceSkin: "xinghe" },
    )).toBe(false);
    expect(requiresSignInForSkinPatch(
      { boardSkin: "default", pieceSkin: "default" },
      { boardSkin: "hongmu", pieceSkin: "jingdian" },
    )).toBe(true);
  });
});
