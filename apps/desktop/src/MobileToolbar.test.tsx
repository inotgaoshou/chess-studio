import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileToolbar } from "./MobileToolbar";

afterEach(cleanup);

describe("MobileToolbar", () => {
  it("exposes the portrait phone commands with accessible names", () => {
    const onCommand = vi.fn();
    render(<MobileToolbar analysisBusy={false} analysisDisabled={false} colorTheme="light" onCommand={onCommand}/>);

    fireEvent.click(screen.getByRole("button", { name: "打开功能菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "保存棋谱" }));
    expect(onCommand).toHaveBeenNthCalledWith(1, "menu");
    expect(onCommand).toHaveBeenNthCalledWith(2, "save");
    expect(screen.getByRole("button", { name: "显示候选连线" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制与导出" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "分析当前局面" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开设置" })).toBeTruthy();
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
});
