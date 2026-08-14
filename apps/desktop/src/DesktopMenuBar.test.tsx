import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopMenuBar, type MenuBarStatus, type MenuCommand } from "./DesktopMenuBar";
import type { WorkspaceMode } from "./WorkspaceModeSwitch";

const readyStatus: MenuBarStatus = {
  playable: true,
  isPlaying: false,
  analysisBusy: false,
  engineThinking: false,
  engineMoveNowAvailable: false,
  engineConfigured: true,
  engineSide: "none",
  hasContinuation: true,
  syncBusy: false,
  syncStatus: "signedIn",
  syncEmail: "user@example.com",
  linkSupported: true,
};

afterEach(cleanup);

function setup(status: MenuBarStatus = readyStatus, mode: WorkspaceMode = "research") {
  const commands: MenuCommand[] = [];
  render(<DesktopMenuBar appVersion="1.2.0" mode={mode} status={status} execute={(command) => { commands.push(command); }} />);
  return { commands, user: userEvent.setup() };
}

describe("DesktopMenuBar", () => {
  it("keeps only one menu open and toggles the selected menu", async () => {
    const { user } = setup();

    await user.click(screen.getByText("棋局", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "新建棋局" })).toBeTruthy();

    await user.click(screen.getByText("局面", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: "新建棋局" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑局面" })).toBeTruthy();

    await user.click(screen.getByText("局面", { selector: "summary" }));
    expect(screen.queryByRole("button", { name: "编辑局面" })).toBeNull();
  });

  it("closes on outside click and Escape", async () => {
    const { user } = setup();
    await user.click(screen.getByText("棋谱", { selector: "summary" }));
    expect(screen.getByRole("button", { name: "复制完整棋谱" })).toBeTruthy();
    await user.click(document.body);
    expect(screen.queryByRole("button", { name: "复制完整棋谱" })).toBeNull();

    await user.click(screen.getByText("人机对弈", { selector: "summary" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "引擎设置" })).toBeNull();
  });

  it("executes a command once and closes its menu", async () => {
    const { commands, user } = setup();
    await user.click(screen.getByText("人机对弈", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "引擎设置" }));
    expect(commands).toEqual(["engineSettings"]);
    expect(screen.queryByRole("button", { name: "引擎设置" })).toBeNull();
  });

  it("does not execute commands that are unavailable", async () => {
    const { commands, user } = setup({ ...readyStatus, playable: false, engineConfigured: false });
    await user.click(screen.getByText("人机对弈", { selector: "summary" }));
    const engineRed = screen.getByRole("button", { name: "引擎执红" }) as HTMLButtonElement;
    expect(engineRed.disabled).toBe(true);
    await user.click(engineRed);
    expect(commands).toEqual([]);
  });

  it("keeps the active engine side stoppable while preventing a side switch during search", async () => {
    const { commands, user } = setup({ ...readyStatus, engineThinking: true, engineSide: "red" });
    await user.click(screen.getByText("人机对弈", { selector: "summary" }));
    const engineRed = screen.getByRole("button", { name: "引擎执红" }) as HTMLButtonElement;
    const engineBlack = screen.getByRole("button", { name: "引擎执黑" }) as HTMLButtonElement;
    expect(engineRed.disabled).toBe(false);
    expect(engineBlack.disabled).toBe(true);
    await user.click(engineBlack);
    await user.click(engineRed);
    expect(commands).toEqual(["engineRed"]);
  });

  it("lets move now start an engine move when it is already the engine side turn", async () => {
    const { commands, user } = setup({ ...readyStatus, engineSide: "red", engineMoveNowAvailable: true });
    await user.click(screen.getByText("人机对弈", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "立即出招" }));
    expect(commands).toEqual(["moveNow"]);
  });

  it("exposes account commands and the current sync identity", async () => {
    const { commands, user } = setup();
    await user.click(screen.getByText("同步", { selector: "summary" }));
    expect(screen.getByText("user@example.com")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "立即同步" }));
    expect(commands).toEqual(["syncNow"]);
  });

  it("shows the manual and About commands in a visible Help menu", async () => {
    const { commands, user } = setup();

    await user.click(screen.getByText("帮助", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "使用手册" }));

    expect(commands).toEqual(["userManual"]);

    await user.click(screen.getByText("帮助", { selector: "summary" }));
    await user.click(screen.getByRole("button", { name: "关于棋研 · v1.2.0" }));

    expect(commands).toEqual(["userManual", "about"]);
  });

  it("keeps research experiments out of review and training menus", () => {
    setup(readyStatus, "review");
    expect(screen.queryByText("研究实验", { selector: "summary" })).toBeNull();
    expect(screen.getByText("棋谱", { selector: "summary" })).toBeTruthy();
  });

  it("marks continuous link capture unavailable on unsupported platforms", async () => {
    const { user } = setup({ ...readyStatus, linkSupported: false });
    await user.click(screen.getByText("研究实验", { selector: "summary" }));
    const link = screen.getByRole("button", { name: "连线未接入 · 当前平台" }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    expect(link.title).toContain("未接入");
  });

  it("supports keyboard menu switching and item navigation", async () => {
    const { user } = setup();
    const game = screen.getByText("棋局", { selector: "summary" });
    game.focus();
    await user.keyboard("{ArrowRight}");
    const position = screen.getByText("局面", { selector: "summary" });
    expect(document.activeElement).toBe(position);
    expect(screen.getByRole("button", { name: "编辑局面" })).toBeTruthy();

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "编辑局面" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "翻转棋盘" }));
  });
});
