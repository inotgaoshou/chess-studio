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
    preview.className = "skin-choice-preview board original";
    document.body.append(preview);

    expect(getComputedStyle(preview).filter).toBe("none");
  });
});
