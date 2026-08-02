import { afterEach, describe, expect, it } from "vitest";
import "./styles.css";

afterEach(() => {
  document.body.replaceChildren();
});

describe("default skin styles", () => {
  it("renders the authored board colors without the legacy inversion filter", () => {
    const boardArt = document.createElement("div");
    boardArt.className = "board-art";
    document.body.append(boardArt);

    expect(getComputedStyle(boardArt).filter).toBe("none");
    expect(getComputedStyle(boardArt).opacity).toBe("1");
  });

  it("renders the default quick preview without the legacy inversion filter", () => {
    const preview = document.createElement("i");
    preview.className = "skin-choice-preview board default";
    document.body.append(preview);

    expect(getComputedStyle(preview).filter).toBe("none");
  });

  it("keeps the equipped default board on its authored asset and colors", () => {
    const shell = document.createElement("div");
    shell.className = "app-shell board-skin-default";
    const board = document.createElement("div");
    board.className = "board";
    const boardArt = document.createElement("div");
    boardArt.className = "board-art";
    board.append(boardArt);
    shell.append(board);
    document.body.append(shell);

    expect(getComputedStyle(boardArt).filter).toBe("none");
    expect(getComputedStyle(boardArt).mixBlendMode).toBe("normal");
    expect(getComputedStyle(boardArt).opacity).toBe("1");
  });
});
