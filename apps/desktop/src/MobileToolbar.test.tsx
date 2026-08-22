import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileToolbar } from "./MobileToolbar";

afterEach(cleanup);

describe("MobileToolbar", () => {
  it("exposes the portrait phone commands with accessible names", () => {
    const onCommand = vi.fn();
    render(<MobileToolbar analysisBusy={false} analysisDisabled={false} colorTheme="light" onCommand={onCommand}/>);

    fireEvent.click(screen.getByRole("button", { name: "打开功能菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑局面" }));
    expect(onCommand).toHaveBeenNthCalledWith(1, "menu");
    expect(onCommand).toHaveBeenNthCalledWith(2, "edit");
    expect(screen.getByRole("button", { name: "立即出招：采用当前首选着" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "翻转红黑方视角" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "强变招：切换到下一候选 PV" })).toBeTruthy();
    expect((document.querySelector(".force-variation-icon") as HTMLImageElement | null)?.src).toContain("/icons/force-variation.png");
    expect(screen.queryByRole("button", { name: "导入棋谱" })).toBeNull();
    expect(screen.queryByRole("button", { name: "保存棋谱" })).toBeNull();
    expect(screen.queryByRole("button", { name: "复制与导出" })).toBeNull();
    expect(screen.getByRole("button", { name: "分析当前局面" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开设置" })).toBeNull();
  });

  it("changes the analysis command label while analysis is running", () => {
    render(<MobileToolbar analysisBusy analysisDisabled colorTheme="dark" onCommand={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "停止分析" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止分析" }).hasAttribute("disabled")).toBe(false);
  });

  it("disables starting analysis when the current workspace cannot analyze", () => {
    render(<MobileToolbar analysisBusy={false} analysisDisabled colorTheme="dark" onCommand={vi.fn()}/>);
    expect(screen.getByRole("button", { name: "分析当前局面" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a visible explanation when a toolbar button receives focus", () => {
    render(<MobileToolbar analysisBusy={false} analysisDisabled={false} colorTheme="light" onCommand={vi.fn()}/>);
    fireEvent.focus(screen.getByRole("button", { name: "翻转红黑方视角" }));
    expect(screen.getByRole("status").textContent).toContain("翻转红黑方视角");
  });
});
