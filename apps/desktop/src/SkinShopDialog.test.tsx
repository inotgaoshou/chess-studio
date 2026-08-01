import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkinShopDialog } from "./SkinShopDialog";
import type { DesktopPreferencesDto } from "./platform";

afterEach(cleanup);

const preferences: DesktopPreferencesDto = {
  enginePath: "", threads: 2, hashMb: 256, multipv: 3, candidateLineMoves: 6, searchMode: "time", searchValue: 1500,
  moveTimeMs: 5000, ponder: false, autoAnalyze: true, boardSkin: "original", pieceSkin: "original",
  colorTheme: "dark", activeEngineId: undefined, libraryCollapsed: true, candidateRailCollapsed: false,
  analysisPanelCollapsed: false, workspacePanel: "moves", layoutMode: "studio", reportDepth: 18, serverUrl: "http://127.0.0.1:8080",
};

function renderShop(signedIn = false) {
  const onPreview = vi.fn();
  const onEquip = vi.fn();
  render(<SkinShopDialog preferences={preferences} signedIn={signedIn} onClose={vi.fn()} onPreview={onPreview} onEquip={onEquip}/>);
  return { onPreview, onEquip };
}

describe("SkinShopDialog", () => {
  it("labels the compatible original skin slot as the default skin", () => {
    renderShop();
    const defaultBoard = screen.getByText("默认棋盘").closest("article")!;
    expect(defaultBoard.querySelector("button")?.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "将棋子" }));
    const defaultPiece = screen.getByText("默认棋子").closest("article")!;
    expect(defaultPiece.querySelector("button")?.disabled).toBe(true);
  });

  it("keeps board and piece categories above the source tabs", () => {
    renderShop();
    const tabs = screen.getByRole("navigation", { name: "皮肤类别" }).querySelectorAll("button");
    expect([...tabs].map((tab) => tab.textContent)).toEqual(["棋盘", "将棋子"]);
    expect(screen.getByRole("tab", { name: "登录皮肤" })).toBeTruthy();
  });

  it("keeps member tabs visible but locked before sign-in", () => {
    renderShop();
    fireEvent.click(screen.getByRole("tab", { name: "登录皮肤" }));
    expect(screen.getByText("登录皮肤", { selector: ".skin-shop-section-heading strong" })).toBeTruthy();
    expect(screen.getByText("登录后可使用专享皮肤")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用" })).toBeNull();
  });

  it("shows and equips signed-in member skins", () => {
    const { onEquip } = renderShop(true);
    fireEvent.click(screen.getByRole("button", { name: "将棋子" }));
    fireEvent.click(screen.getByRole("tab", { name: "登录棋子" }));
    expect(screen.getByText("登录棋子", { selector: ".skin-shop-section-heading strong" })).toBeTruthy();
    expect(screen.getByText("经典雅致")).toBeTruthy();
    expect(screen.getByText("霓虹星河")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "使用" })[0]);
    expect(onEquip).toHaveBeenCalledWith({ boardSkin: "original", pieceSkin: "jingdian" });
  });

  it("previews and clears a base board skin on hover", () => {
    const { onPreview } = renderShop();
    const card = screen.getByText("暖木立体").closest("article")!;
    fireEvent.pointerEnter(card);
    fireEvent.pointerLeave(card);
    expect(onPreview).toHaveBeenNthCalledWith(1, { boardSkin: "classic", pieceSkin: "original" });
    expect(onPreview).toHaveBeenLastCalledWith();
  });

});
