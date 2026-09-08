import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferencePositionPanel } from "./ReferencePositionPanel";

const move = { iccs: "h2e2", notation: "炮二平五", samples: 10, redWins: 5, draws: 3, blackWins: 2 };
afterEach(cleanup);

describe("ReferencePositionPanel", () => {
  it("previews a candidate without adding it to the manual", async () => {
    const onPreview = vi.fn();
    const onAdd = vi.fn();
    render(<ReferencePositionPanel fen="start" enabled query={async () => [move]} onPreview={onPreview} onAdd={onAdd} onOpenExplorer={() => undefined}/>);

    fireEvent.click(await screen.findByText("炮二平五"));

    expect(onPreview).toHaveBeenCalledWith("h2e2", "炮二平五");
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("加入棋谱 炮二平五"));
    expect(onAdd).toHaveBeenCalledWith("h2e2");
  });

  it("ignores a slow response after the position changes", async () => {
    let resolveOld: ((value: typeof move[]) => void) | undefined;
    const query = vi.fn((fen: string) => fen === "old"
      ? new Promise<typeof move[]>((resolve) => { resolveOld = resolve; })
      : Promise.resolve([{ ...move, iccs: "b0c2", notation: "马二进三" }]));
    const view = render(<ReferencePositionPanel fen="old" enabled query={query} onPreview={() => undefined} onAdd={() => undefined} onOpenExplorer={() => undefined}/>);
    view.rerender(<ReferencePositionPanel fen="new" enabled query={query} onPreview={() => undefined} onAdd={() => undefined} onOpenExplorer={() => undefined}/>);
    expect(await screen.findByText("马二进三")).toBeTruthy();
    resolveOld?.([move]);
    await Promise.resolve();
    expect(screen.queryByText("炮二平五")).toBeNull();
  });
});
