import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualMoveRows } from "./ManualMoveRows";
import type { MoveItem } from "./platform";

afterEach(cleanup);

function move(id: string, notation: string, movedBy: MoveItem["movedBy"]): MoveItem {
  return { id, notation, movedBy, iccs: "a0a1", from: { row: 9, col: 0 }, to: { row: 8, col: 0 }, comment: "", isMainline: true };
}

describe("ManualMoveRows", () => {
  it("shows retained future moves after the selected history and only navigates when clicked", () => {
    const onNavigate = vi.fn();
    render(<div role="table"><ManualMoveRows
      history={[move("one", "炮二平五", "红方")]}
      continuation={[move("two", "马8进7", "黑方"), move("three", "马二进三", "红方")]}
      currentNode="one"
      qualityByMoveId={new Map()}
      formatScore={() => ""}
      onNavigate={onNavigate}
    /></div>);

    expect(screen.getAllByText("后续保留")).toHaveLength(2);
    fireEvent.click(screen.getByText("马8进7"));
    expect(onNavigate).toHaveBeenCalledWith("two");
  });
});
