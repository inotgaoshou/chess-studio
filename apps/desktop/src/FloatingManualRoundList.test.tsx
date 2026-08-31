import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingManualRoundList } from "./FloatingManualRoundList";
import type { ManualTreeNode, MoveItem } from "./platform/types";

afterEach(cleanup);

const moves: MoveItem[] = [{
  id: "move-1",
  iccs: "h2e2",
  notation: "炮二平五",
  movedBy: "红方",
  from: { row: 7, col: 1 },
  to: { row: 7, col: 4 },
  comment: "",
  isMainline: true,
}];

describe("FloatingManualRoundList", () => {
  it("keeps the move record and thought actions available in the system window", async () => {
    const onNavigate = vi.fn();
    render(<FloatingManualRoundList currentNode="move-1" moves={moves} formatScore={() => ""} onNavigate={onNavigate}/>);

    expect(screen.getByText("记录")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开第 1 着思路" }));
    expect(screen.getByLabelText("炮二平五 的着法思路")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "红方 炮二平五" }));
    expect(onNavigate).toHaveBeenCalledWith("move-1");
  });

  it("locates the current move and exposes variation markers and numbered routes", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const mainReply: MoveItem = { ...moves[0], id: "main-reply", notation: "马8进7", movedBy: "黑方", isMainline: true };
    const sideReply: MoveItem = { ...moves[0], id: "side-reply", notation: "马2进3", movedBy: "黑方", isMainline: false };
    const tree: ManualTreeNode[] = [{ move: moves[0], children: [{ move: mainReply, children: [] }, { move: sideReply, children: [] }] }];
    const onNavigate = vi.fn();

    render(<FloatingManualRoundList
      branches={[mainReply, sideReply]}
      currentNode="move-1"
      manualTree={tree}
      moves={moves}
      formatScore={() => ""}
      onNavigate={onNavigate}
    />);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    expect(screen.getByText("变招 2")).toBeTruthy();
    expect(screen.getByRole("group", { name: "当前局面变招" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "路线 2 马2进3" }));
    expect(onNavigate).toHaveBeenCalledWith("side-reply");
  });
});
