import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlyknifeDialog } from "./FlyknifeDialog";
import type { BoardState, FlyknifeTopic } from "./platform";

const platformMock = vi.hoisted(() => ({
  listFlyknifeTemplates: vi.fn(),
  listFlyknifeTopics: vi.fn(),
  listFlyknifePlans: vi.fn(),
  openFlyknifeTopic: vi.fn(),
  generateFlyknifeCandidates: vi.fn(),
  saveFlyknifePlan: vi.fn(),
  deleteFlyknifePlan: vi.fn(),
  exportTextFile: vi.fn(),
  openExternalUrl: vi.fn(),
  previewLine: vi.fn(),
}));

vi.mock("./platform", async () => {
  const actual = await vi.importActual<typeof import("./platform")>("./platform");
  return {
    ...actual,
    chessPlatform: {
      kind: "desktop",
      ...platformMock,
    },
  };
});

const topic: FlyknifeTopic = {
  id: "xianren-zudipao-1",
  title: "34仙人指路对卒底炮（一）",
  opening: "仙人指路",
  category: "布局陷阱",
  source: "https://source.xiangqiqipu.com/Category/View-6519.html",
  moveCount: 19,
};

function renderDialog(overrides: Partial<Parameters<typeof FlyknifeDialog>[0]> = {}) {
  const props: Parameters<typeof FlyknifeDialog>[0] = {
    currentFen: "startpos",
    currentSideToMove: "红方",
    cloudCandidates: [],
    xqbCandidates: [],
    enginePath: "/engines/pikafish",
    threads: 2,
    hashMb: 256,
    searchMode: "depth",
    searchValue: 26,
    onClose: vi.fn(),
    onPlanSaved: vi.fn(),
    onPractice: vi.fn(),
    onTopicOpened: vi.fn(),
    ...overrides,
  };
  return { props, user: userEvent.setup(), ...render(<FlyknifeDialog {...props}/>) };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FlyknifeDialog", () => {
  it("shows the flyknife topic library as the default entry", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([topic]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);

    renderDialog();

    expect(screen.getByRole("dialog", { name: "飞刀库 / 专题库" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /专题库/ }).classList.contains("active")).toBe(true);
    expect(await screen.findByText(topic.title)).toBeTruthy();
    expect(screen.getByText(/仙人指路 · 布局陷阱 · 19 回合/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /实验室/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /已保存/ })).toBeTruthy();
  });

  it("opens the guided trap designer from the topic library", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
    });
    await user.click(screen.getByRole("button", { name: "立即设计飞刀" }));

    expect(screen.getByRole("button", { name: /实验室/ }).classList.contains("active")).toBe(true);
    expect(screen.getByText(/请填一手黑方可能会走的棋/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "红方" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens the definition without leaving the current flyknife tab", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([topic]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);

    const { user } = renderDialog();
    await user.click(screen.getByRole("button", { name: /飞刀定义/ }));

    expect(screen.getByLabelText("飞刀定义说明")).toBeTruthy();
    expect(screen.getByText("飞刀不是单纯的好棋")).toBeTruthy();
    expect(within(screen.getByLabelText("飞刀定义说明")).getByText("已验证飞刀")).toBeTruthy();
    expect(screen.getByRole("button", { name: /专题库/ }).classList.contains("active")).toBe(true);
  });

  it("opens a bundled topic into the current board", async () => {
    const nextBoard: Partial<BoardState> = { fen: "topic-fen", history: [] };
    const onTopicOpened = vi.fn();
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([topic]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.openFlyknifeTopic.mockResolvedValue(nextBoard);

    const { user } = renderDialog({ onTopicOpened });
    const card = await screen.findByText(topic.title);
    await user.click(within(card.closest("article")!).getByRole("button", { name: /打开/ }));

    await waitFor(() => expect(platformMock.openFlyknifeTopic).toHaveBeenCalledWith(topic.id));
    expect(onTopicOpened).toHaveBeenCalledWith(nextBoard, topic);
  });

  it("opens a topic source through the desktop browser command", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([topic]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.openExternalUrl.mockResolvedValue(undefined);

    const { user } = renderDialog();
    const card = await screen.findByText(topic.title);
    await user.click(within(card.closest("article")!).getByRole("button", { name: "来源" }));

    expect(platformMock.openExternalUrl).toHaveBeenCalledWith(topic.source);
    expect(screen.getByText("已交给系统浏览器打开来源页面。")).toBeTruthy();
  });

  it("keeps the generator and saved-plan tabs reachable", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);

    const { user } = renderDialog();

    await user.click(screen.getByRole("button", { name: /实验室/ }));
    expect(screen.getByRole("button", { name: /只拆当前局面/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /设计飞刀/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /已保存/ }));
    expect(screen.getByText(/暂无保存方案/)).toBeTruthy();
  });

  it("can analyze the current board directly when it is the knife side to move", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
    });

    await user.click(screen.getByRole("button", { name: /实验室/ }));

    expect(screen.getByText(/已套用：当前棋谱节点 · 现在轮到黑方/)).toBeTruthy();
    expect(screen.getByText(/直接找黑方当前最强走法/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /直接拆当前局面：找黑方强招/ }));

    await waitFor(() => expect(platformMock.generateFlyknifeCandidates).toHaveBeenCalledWith(expect.objectContaining({
      side: "black",
      lureMove: "",
    })));
  });

  it("requires a lure move when the selected knife side is not to move", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
    });

    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /设计飞刀/ }));

    expect(screen.getByText(/请填一手黑方可能会走的棋/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "按假设生成红方飞刀" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps red selectable when red is the side to move", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 w - - 0 18",
      currentSideToMove: "红方",
    });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    const redSide = screen.getByRole("button", { name: "红方" });
    expect(redSide.getAttribute("aria-pressed")).toBe("true");
    await user.click(redSide);
    await user.click(screen.getByRole("button", { name: /直接拆当前局面：找红方强招/ }));

    await waitFor(() => expect(platformMock.generateFlyknifeCandidates).toHaveBeenCalledWith(expect.objectContaining({
      side: "red", lureMove: "",
    })));
  });

  it("sends red to the generator after a black lure move", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
    });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: "红方" }));
    expect(screen.getByRole("button", { name: "红方" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/请填一手黑方可能会走的棋/)).toBeTruthy();
    await user.type(screen.getByLabelText(/假设黑方下一步/), "马8进7");
    await user.click(screen.getByRole("button", { name: "按假设生成红方飞刀" }));

    await waitFor(() => expect(platformMock.generateFlyknifeCandidates).toHaveBeenCalledWith(expect.objectContaining({
      side: "red", lureMove: "马8进7",
    })));
  });

  it("only calls a lure line a verified flyknife after the advantage threshold is met", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([{
      lureMove: "h9g7", lureNotation: "马8进7", knifeMove: "b2c4", mainline: ["b2c4"], notation: ["炮二平五"],
      bestDefense: [], bestDefenseNotation: [], scoreCp: 124, baselineScoreCp: 18, swingCp: 106, risk: "实战可用",
    }]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
      cloudCandidates: [
        { iccs: "b9c7", notation: "马8进7", score: 120, rank: 1, winRate: 51.2, source: "云库", cached: false },
        { iccs: "h9g7", notation: "马2进3", score: 92, rank: 3, winRate: 48.6, source: "云库", cached: false },
      ],
    });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: "红方" }));
    await user.type(screen.getByLabelText(/假设黑方下一步/), "马8进7");
    await user.click(screen.getByRole("button", { name: "按假设生成红方飞刀" }));

    expect(await screen.findByText(/已验证飞刀 · 方案 1/)).toBeTruthy();
    expect(screen.getByText(/对方走「马8进7」/)).toBeTruthy();
    expect(screen.getByText("这步的用意")).toBeTruthy();
    expect(screen.getByText(/对方应手前 \+0\.18 分 → 出刀后 \+1\.24 分，我方变化 \+1\.06 分/)).toBeTruthy();
    expect(screen.getByText(/云库：马2进3，库分 92，排序 3，胜率 48\.6%，较云库首选少 28 库分/)).toBeTruthy();
    expect(screen.getByText(/当前深度尚未给出可读的对手应对主变/)).toBeTruthy();
  });

  it("supports a red setup move followed by a black lure and red counterattack", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 w - - 0 18",
      currentSideToMove: "红方",
    });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /设计飞刀/ }));
    await user.click(screen.getByRole("button", { name: "红方" }));
    await user.type(screen.getByLabelText(/红方预埋第一手/), "炮二平五");
    await user.type(screen.getByLabelText(/假设黑方下一步/), "马8进7");
    await user.click(screen.getByRole("button", { name: "按假设生成红方飞刀" }));

    await waitFor(() => expect(platformMock.generateFlyknifeCandidates).toHaveBeenCalledWith(expect.objectContaining({
      side: "red", setupMove: "炮二平五", lureMove: "马8进7",
    })));
  });

  it("saves a starting position without adding a variation", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.saveFlyknifePlan.mockImplementation(async (plan) => ({ ...plan, id: "start-position" }));

    const { user } = renderDialog({ currentFen: "9/9/9/9/9/9/9/9/9/9 w - - 0 1" });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /保存起步局面/ }));

    await waitFor(() => expect(platformMock.saveFlyknifePlan).toHaveBeenCalledWith(expect.objectContaining({
      lureMove: "", knifeMove: "", mainline: [],
    })));
  });

  it("previews a generated flyknife line without saving it", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([{
      lureMove: "", knifeMove: "h2e2", mainline: ["h2e2"], notation: ["炮二平五"],
      bestDefense: [], bestDefenseNotation: [], scoreCp: 120, risk: "实战可用",
    }]);
    platformMock.previewLine.mockResolvedValue([{
      fen: "9/9/9/9/9/9/9/9/9/9 b - - 0 1", notation: "炮二平五", movedBy: "红方",
      from: { row: 7, col: 1 }, to: { row: 7, col: 4 }, pieces: [], status: "进行中",
    }]);

    const { user } = renderDialog({ currentFen: "9/9/9/9/9/9/9/9/9/9 w - - 0 1" });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /直接拆当前局面：找红方强招/ }));
    expect(await screen.findByText("红方优势 +1.20 分")).toBeTruthy();
    expect(screen.getByText("我方推荐强招")).toBeTruthy();
    expect(screen.getByText(/预期效果/)).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: /预览/ }));

    expect(await screen.findByLabelText("飞刀预览")).toBeTruthy();
    expect(screen.getByText(/推荐强招：炮二平五/)).toBeTruthy();
    expect(screen.getByText("引擎分值")).toBeTruthy();
    expect(screen.getByText("+1.20 分")).toBeTruthy();
    expect(screen.getByRole("button", { name: /1\. 炮二平五 · 推荐强招/ })).toBeTruthy();
    expect(screen.queryByText(/推荐 炮二平五/)).toBeNull();
    expect(platformMock.previewLine).toHaveBeenCalledWith("9/9/9/9/9/9/9/9/9/9 w - - 0 1", ["h2e2"]);
    expect(platformMock.saveFlyknifePlan).not.toHaveBeenCalled();
  });

  it("stores an edited key-step intention with the saved flyknife plan", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([{
      lureMove: "h9g7", lureNotation: "马8进7", knifeMove: "b2c4", mainline: ["b2c4"], notation: ["炮二平五"],
      bestDefense: [], bestDefenseNotation: [], scoreCp: 120, swingCp: 105, risk: "实战可用",
      annotations: [
        { role: "lure", iccs: "h9g7", notation: "马8进7", side: "黑方", intent: "中刀条件。" },
        { role: "knife", iccs: "b2c4", notation: "炮二平五", side: "红方", scoreCp: 120, swingCp: 105, intent: "先抢中路。" },
      ],
    }]);
    platformMock.saveFlyknifePlan.mockImplementation(async (plan) => ({ ...plan, id: "saved-knife" }));

    const { user } = renderDialog({ currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 1", currentSideToMove: "黑方" });
    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: "红方" }));
    await user.type(screen.getByLabelText(/假设黑方下一步/), "马8进7");
    await user.click(screen.getByRole("button", { name: "按假设生成红方飞刀" }));
    await user.click(await screen.findByText("查看并编辑关键步骤说明"));
    const knifeIntent = screen.getByLabelText("飞刀说明");
    await user.clear(knifeIntent);
    await user.type(knifeIntent, "先抢中路，再用车马跟进。");
    await user.click(screen.getByRole("button", { name: "保存飞刀" }));

    await waitFor(() => expect(platformMock.saveFlyknifePlan).toHaveBeenCalledWith(expect.objectContaining({
      annotations: expect.arrayContaining([expect.objectContaining({ role: "knife", note: "先抢中路，再用车马跟进。" })]),
    })));
  });

  it("direct mode ignores stale lure text after returning from trap mode", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([]);

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 18",
      currentSideToMove: "黑方",
    });

    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /设计飞刀/ }));
    await user.type(screen.getByLabelText(/假设黑方下一步/), "马8进9");
    await user.click(screen.getByRole("button", { name: /只拆当前局面/ }));
    await user.click(screen.getByRole("button", { name: /直接拆当前局面：找黑方强招/ }));

    await waitFor(() => expect(platformMock.generateFlyknifeCandidates).toHaveBeenCalledWith(expect.objectContaining({
      side: "black",
      lureMove: "",
    })));
  });

  it("exports a generated candidate as a PGN manual", async () => {
    platformMock.listFlyknifeTemplates.mockResolvedValue([]);
    platformMock.listFlyknifeTopics.mockResolvedValue([]);
    platformMock.listFlyknifePlans.mockResolvedValue([]);
    platformMock.generateFlyknifeCandidates.mockResolvedValue([{
      lureMove: "",
      knifeMove: "b9c7",
      mainline: ["b9c7", "b0c2"],
      notation: ["马2进3", "马八进七"],
      bestDefense: ["b0c2"],
      bestDefenseNotation: ["马八进七"],
      scoreCp: -27,
      risk: "风险变例：引擎未确认明显优势。",
    }]);
    platformMock.exportTextFile.mockResolvedValue("/tmp/飞刀.pgn");

    const { user } = renderDialog({
      currentFen: "9/9/9/9/9/9/9/9/9/9 b - - 0 7",
      currentSideToMove: "黑方",
    });

    await user.click(screen.getByRole("button", { name: /实验室/ }));
    await user.click(screen.getByRole("button", { name: /直接拆当前局面：找黑方强招/ }));
    await user.click(await screen.findByRole("button", { name: /导出棋谱/ }));

    expect(platformMock.exportTextFile).toHaveBeenCalledWith(
      expect.stringContaining("直接拆局-1-马2进3"),
      expect.stringContaining('[FEN "9/9/9/9/9/9/9/9/9/9 b - - 0 7"]'),
      "pgn",
      "PGN 棋谱",
    );
    expect(platformMock.exportTextFile.mock.calls[0][1]).toContain("7... b9c7 8. b0c2 *");
  });
});
