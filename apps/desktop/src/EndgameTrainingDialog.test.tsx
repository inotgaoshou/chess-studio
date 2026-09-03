import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndgameTrainingDialog } from "./EndgameTrainingDialog";

const firstBook = {
  id: "book-chen", title: "中国象棋实用残局增订本-陈松顺", sourcePath: "/tmp/chen.cbl",
  fingerprint: "chen", parserVersion: 2, problemCount: 1, completedCount: 0, importedAt: "2026-09-03T00:00:00Z",
};
const secondBook = {
  id: "book-next", title: "第二本残局集", sourcePath: "/tmp/next.cbl",
  fingerprint: "next", parserVersion: 2, problemCount: 1, completedCount: 0, importedAt: "2026-09-02T00:00:00Z",
};
const problems = {
  "book-chen": [{
    id: "horse", libraryId: "book-chen", sourceIndex: 48, title: "（一）马取单士--着法1，红先胜", category: "马类",
    startingFen: "9/3kaN3/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "单马必胜单士", solutionJson: "[{\"iccs\":\"f8e6\",\"comment\":\"\",\"children\":[]}]", completedAttempts: 0, totalElapsedMs: 0,
  }],
  "book-next": [{
    id: "next", libraryId: "book-next", sourceIndex: 0, title: "车兵残局", category: "车类",
    startingFen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1", note: "", solutionJson: "[]", completedAttempts: 0, totalElapsedMs: 0,
  }],
};

const platform = vi.hoisted(() => ({
  refreshEndgameLibraries: vi.fn(),
  listEndgameLibraries: vi.fn(),
  listEndgameProblems: vi.fn(),
  importEndgameCbl: vi.fn(),
  importEndgameCblFromPath: vi.fn(),
  saveEndgameAttempt: vi.fn(),
  endgameChineseMainline: vi.fn(),
  deleteEndgameLibrary: vi.fn(),
  deleteEndgameProblem: vi.fn(),
  listEndgameAttempts: vi.fn(),
}));

vi.mock("./platform", () => ({ chessPlatform: platform }));

afterEach(cleanup);

beforeEach(() => {
  platform.refreshEndgameLibraries.mockResolvedValue({ warnings: [] });
  platform.listEndgameLibraries.mockResolvedValue([firstBook, secondBook]);
  platform.listEndgameProblems.mockImplementation(async (id: keyof typeof problems) => problems[id]);
  platform.importEndgameCbl.mockResolvedValue(undefined);
  platform.saveEndgameAttempt.mockResolvedValue(undefined);
  platform.endgameChineseMainline.mockResolvedValue(["马六进四"]);
  platform.deleteEndgameLibrary.mockResolvedValue(undefined);
  platform.deleteEndgameProblem.mockResolvedValue(undefined);
  platform.listEndgameAttempts.mockResolvedValue([]);
});

describe("EndgameTrainingDialog", () => {
  it("uses an expandable book parent before showing its problems", async () => {
    const view = render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    const firstParent = await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    const secondParent = screen.getByRole("button", { name: /第二本残局集/ });
    expect(firstParent.getAttribute("aria-expanded")).toBe("true");
    expect(secondParent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("（一）马取单士--着法1，红先胜")).toBeTruthy();

    fireEvent.click(firstParent);
    expect(firstParent.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("（一）马取单士--着法1，红先胜")).toBeNull();

    fireEvent.click(secondParent);
    expect(secondParent.getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByText("车兵残局")).toBeTruthy();
    expect(view.container.querySelector(".endgame-library-tree")).not.toBeNull();
  });

  it("shows the answer as rounds and offers board demonstration", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByRole("button", { name: /马取单士--着法1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "看答案" }));

    expect(await screen.findByText("题解回合")).toBeTruthy();
    expect(screen.getByText("红方 马六进四")).toBeTruthy();
    expect(screen.getByRole("button", { name: "演示答案" })).toBeTruthy();
  });

  it("confirms deletion inside the training desk before changing local data", async () => {
    render(<EndgameTrainingDialog onClose={vi.fn()}/>);

    await screen.findByRole("button", { name: /中国象棋实用残局增订本-陈松顺/ });
    fireEvent.click(screen.getByTitle("删除当前题库"));
    expect(screen.getByRole("alertdialog", { name: "确认删除" })).toBeTruthy();
    expect(screen.getByText(/删除题库《/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(platform.deleteEndgameLibrary).not.toHaveBeenCalled();
  });
});
