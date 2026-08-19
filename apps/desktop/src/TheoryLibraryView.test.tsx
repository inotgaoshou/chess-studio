import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TheoryLibraryDto } from "./platform";
import { TheoryLibraryView } from "./TheoryLibraryView";

afterEach(cleanup);

const library: TheoryLibraryDto = {
  downloadingFiles: 0,
  lessons: [
    { id: 1, phase: "middle", courseName: "特级大师训练法", title: "每日40分钟与每周复盘闭环", sourcePath: "https://mp.weixin.qq.com/s/x0jQq9Re8G_aGoTlk9N59w#training-system", fingerprint: "training-system-v1", transcriptionStatus: "complete", scannedAt: "2026-08-14T00:00:00Z" },
    { id: 2, phase: "opening", courseName: "U10 原创棋理", title: "开局协调", sourcePath: "bundled", fingerprint: "u10", transcriptionStatus: "complete", scannedAt: "2026-08-14T00:00:00Z" },
  ],
  cards: [
    { id: 1, externalId: "training-system-candidate-calculation", lessonId: 1, phase: "middle", title: "候选着计算：走一思三", summary: "落子前提出一个首选和两个备选。", appliesWhen: "局面没有唯一应手。", risk: "读秒时先防漏。", reviewStatus: "approved", courseName: "特级大师训练法", lessonTitle: "每日40分钟与每周复盘闭环", sourceBook: "中国象棋特级大师核心训练秘诀 · 方法论参考", tags: ["候选着计算", "候选不足"], engineCorrelations: ["missed_candidate"], origin: "imported", version: 1, userModified: false, matchPenalty: 0, needsRecheck: false },
    { id: 2, externalId: "u10-opening-coordinate", lessonId: 2, phase: "opening", title: "先出动强子", summary: "开局优先协调马炮。", appliesWhen: "开局阶段。", risk: "有战术先算。", reviewStatus: "approved", courseName: "U10 原创棋理", lessonTitle: "开局协调", tags: ["开局"], engineCorrelations: [], origin: "bundled", version: 1, userModified: false, matchPenalty: 0, needsRecheck: false },
  ],
};

describe("TheoryLibraryView", () => {
  it("filters the master training-system cards", async () => {
    render(<TheoryLibraryView library={library} busy={false} onScan={vi.fn()} onCreateCard={vi.fn()} onReviewCard={vi.fn()}/>);

    expect(screen.getByText("先出动强子")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "训练法" }));

    expect(screen.getByText("候选着计算：走一思三")).toBeTruthy();
    expect(screen.queryByText("先出动强子")).toBeNull();
    expect(screen.getByText(/方法论参考/)).toBeTruthy();
  });
});
