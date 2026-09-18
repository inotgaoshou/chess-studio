import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameSummary, LibraryFolder } from "./platform";
import { ReviewGameLibrary } from "./ReviewGameLibrary";

const platformMock = vi.hoisted(() => {
  const fallback = vi.fn(async () => undefined);
  return new Proxy({ kind: "desktop" as const }, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      return fallback;
    },
  });
});

vi.mock("./platform", async () => {
  const actual = await vi.importActual<typeof import("./platform")>("./platform");
  return { ...actual, chessPlatform: platformMock };
});

const games: GameSummary[] = [{
  id: "ttxq-1",
  title: "先胜 廖德华,30回合",
  fen: "fen",
  updatedAt: "2026-09-14T00:00:00Z",
  current: false,
  favorite: false,
  tags: [],
  libraryFolder: "天天象棋备份",
  sourceFormat: "ttxq-h5",
}];

const folders: LibraryFolder[] = [
  { name: "天天象棋备份", system: false, gameCount: 18 },
  { name: "开局研究", system: false, gameCount: 0 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewGameLibrary", () => {
  it("keeps the create-folder confirmation visible and creates under the current parent", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn(async () => undefined);
    const target = platformMock as Record<string, ReturnType<typeof vi.fn> | string>;
    target.createLibraryFolder = vi.fn(async () => undefined);

    render(<ReviewGameLibrary
      games={games}
      folders={folders}
      onOpen={vi.fn()}
      onChanged={onChanged}
      onClose={vi.fn()}
    />);

    await user.click(screen.getByRole("button", { name: "新建子目录" }));
    const form = screen.getByRole("form", { name: "新建目录表单" });
    expect(within(form).getByText("当前父目录：天天象棋")).toBeTruthy();
    expect(within(form).getByRole("button", { name: "取消" })).toBeTruthy();

    await user.type(within(form).getByLabelText("目录名"), "我的棋谱");
    await user.click(within(form).getByRole("button", { name: "创建" }));

    expect(target.createLibraryFolder).toHaveBeenCalledWith("天天象棋备份/我的棋谱");
    expect(onChanged).toHaveBeenCalledOnce();
    expect(await screen.findByText("已创建目录：天天象棋/我的棋谱")).toBeTruthy();
  });
});
