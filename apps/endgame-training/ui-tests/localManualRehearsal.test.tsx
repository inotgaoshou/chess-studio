// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalManualRehearsal } from "../src/LocalManualRehearsal";
import type { LocalManualGame } from "../src/types";

vi.mock("../src/wasm", () => ({
  boardAt: vi.fn(async (_fen: string, moves: string[]) => ({
    fen: `4k4/9/9/9/9/9/9/9/9/4K4 ${moves.length % 2 ? "b" : "w"} - - 0 1`,
    pieces: [{ row: 9, col: 0, color: "red" }, { row: 0, col: 0, color: "black" }],
    status: "进行中",
  })),
  chineseLine: vi.fn(async () => ["车九进一"]),
}));

afterEach(() => { cleanup(); localStorage.clear(); });
const game: LocalManualGame = {
  id: "rehearsal-test", title: "测试棋谱", note: "", startingFen: "start w - - 0 1",
  currentNodeId: "root", currentFen: "start w - - 0 1",
  moves: ["a0a1", "a9a8", "a1a2"], cursor: 0, branches: [], comments: {},
  createdAt: "", updatedAt: "",
};

it("lets the chosen side move, auto-plays the opponent and preserves the board on a wrong move", async () => {
  render(<LocalManualRehearsal game={game} onClose={vi.fn()} renderBoard={(_board, _selected, _hint, flipped, _square, move) =>
    <div data-testid="rehearsal-board" data-flipped={flipped}>
      <button onClick={() => move({ row: 9, col: 0 }, { row: 8, col: 0 })}>走正着</button>
      <button onClick={() => move({ row: 9, col: 0 }, { row: 7, col: 0 })}>走错着</button>
    </div>
  }/>);
  await screen.findByTestId("rehearsal-board");
  expect(screen.getByTestId("rehearsal-board").getAttribute("data-flipped")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "走错着" }));
  expect(screen.getByText(/偏差 1 次/)).toBeTruthy();
  expect(screen.getByText(/已走 0 步/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "走正着" }));
  await waitFor(() => expect(screen.getByText(/已走 2 步/)).toBeTruthy(), { timeout: 2500 });
  expect(screen.getByText(/偏差 1 次/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "我执黑" }));
  await waitFor(() => expect(screen.getByText(/已走 1 步/)).toBeTruthy(), { timeout: 2500 });
  expect(screen.getByTestId("rehearsal-board").getAttribute("data-flipped")).toBe("true");
  expect(screen.getByText(/偏差 0 次/)).toBeTruthy();
});
