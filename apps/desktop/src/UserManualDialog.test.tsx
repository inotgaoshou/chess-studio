import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserManualDialog } from "./UserManualDialog";
import bundledManual from "../../../docs/USER_MANUAL.zh-CN.md?raw";

const manual = `# 棋研使用手册

## 首次准备

检查 Pikafish 与开局库。

## U10 引导拆棋

提交前隐藏答案，孩子先独立计算。

## 开局训练

分别建立红方和黑方布局画像。
`;

afterEach(cleanup);

describe("UserManualDialog", () => {
  it("renders a searchable table of contents and jumps to a matching chapter", async () => {
    const user = userEvent.setup();
    render(<UserManualDialog appVersion="1.2.0" markdown={manual} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "棋研使用手册" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "首次准备" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "适用版本 v1.2.0" })).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "搜索使用手册" }), "拆棋");
    expect(screen.getByRole("button", { name: "U10 引导拆棋" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "开局训练" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "U10 引导拆棋" }));
    expect(screen.getByRole("heading", { name: "U10 引导拆棋" })).toBeTruthy();
  });

  it("closes from the close button and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<UserManualDialog appVersion="1.2.0" markdown={manual} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭使用手册" }));
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    rerender(<UserManualDialog appVersion="1.2.0" markdown={manual} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders the bundled task chapters and their data-free screenshots", () => {
    render(<UserManualDialog appVersion="1.2.0" markdown={bundledManual} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "整局复盘" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "U10 引导拆棋" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "棋理学习" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开局训练" })).toBeTruthy();
    expect(screen.getByAltText("整局复盘工作台").getAttribute("src")).toBe("/manual/02-review-workspace.png");
    expect(screen.getByAltText("今日 40 分钟与家长周报").getAttribute("src")).toBe("/manual/07-daily-weekly.png");
    expect(screen.getByRole("heading", { name: "如何备份和恢复本机数据" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "自动镜像没有创建、更新失败或文件被删除" })).toBeTruthy();
    expect(screen.getByText("~/Documents/棋研棋谱/")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "云库、同步和窗口连线不可用" })).toBeTruthy();
  });
});
