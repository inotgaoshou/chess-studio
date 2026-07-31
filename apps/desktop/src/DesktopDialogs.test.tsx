import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogs } from "./DesktopDialogs";
import { BUILTIN_ENGINE_PATH, type DesktopPreferencesDto, type SyncAccountDto } from "./platform";

const preferences: DesktopPreferencesDto = {
  enginePath: "/opt/pikafish",
  threads: 2,
  hashMb: 256,
  multipv: 3,
  searchMode: "time",
  searchValue: 1500,
  moveTimeMs: 5000,
  ponder: false,
  autoAnalyze: true,
  libraryCollapsed: false,
  colorTheme: "dark",
  boardSkin: "original",
  pieceSkin: "original",
  reportDepth: 20,
  serverUrl: "http://127.0.0.1:8080",
};
const account: SyncAccountDto = { serverUrl: preferences.serverUrl, status: "unbound" };

afterEach(cleanup);

function renderDialog(dialog: "engine" | "syncSettings" | "register" | "login" | "subscription" | "training", overrides: Partial<Parameters<typeof DesktopDialogs>[0]> = {}) {
  const props: Parameters<typeof DesktopDialogs>[0] = {
    dialog,
    preferences,
    account,
    trainingTasks: [],
    busy: false,
    onClose: vi.fn(),
    onChooseEngine: vi.fn(async () => undefined),
    onSaveEngine: vi.fn(async () => undefined),
    onSaveSync: vi.fn(async () => undefined),
    onAuthenticate: vi.fn(async () => undefined),
    onRedeemSubscription: vi.fn(async () => undefined),
    onGenerateTraining: vi.fn(async () => undefined),
    onCompleteTraining: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<DesktopDialogs {...props}/>);
  return { props, user: userEvent.setup() };
}

describe("DesktopDialogs", () => {
  it("writes the selected engine executable into the path field", async () => {
    const enginePath = "/Applications/Pikafish/pikafish-apple-silicon";
    const chooseEngine = vi.fn(async () => enginePath);
    const { user } = renderDialog("engine", {
      preferences: { ...preferences, enginePath: "" },
      onChooseEngine: chooseEngine,
    });

    await user.click(screen.getByRole("button", { name: "选择外部引擎文件" }));

    expect(chooseEngine).toHaveBeenCalledWith("");
    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe(enginePath);
    expect((screen.getByRole("button", { name: "检测并保存" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses a stable built-in engine marker instead of showing an install-specific path", async () => {
    const { props, user } = renderDialog("engine", {
      preferences: { ...preferences, enginePath: BUILTIN_ENGINE_PATH },
    });

    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe("内置 Pikafish（随应用安装，推荐）");
    expect(screen.getByText(/不依赖本机绝对路径/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({ enginePath: BUILTIN_ENGINE_PATH }));
  });

  it("shows a file picker error instead of failing silently", async () => {
    const { user } = renderDialog("engine", {
      preferences: { ...preferences, enginePath: "" },
      onChooseEngine: vi.fn(async () => { throw new Error("dialog.open not allowed"); }),
    });

    await user.click(screen.getByRole("button", { name: "选择外部引擎文件" }));

    expect((await screen.findByRole("alert")).textContent).toContain("选择引擎文件失败：dialog.open not allowed");
  });

  it("submits engine settings through the persistent settings callback", async () => {
    const { props, user } = renderDialog("engine");
    await user.clear(screen.getByLabelText("MultiPV"));
    await user.type(screen.getByLabelText("MultiPV"), "4");
    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({ enginePath: "/opt/pikafish", multipv: 4 }));
  });

  it("clears the password immediately after an authentication attempt", async () => {
    const authenticate = vi.fn(async () => undefined);
    const { user } = renderDialog("login", { onAuthenticate: authenticate });
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "password-123");
    await user.click(screen.getByRole("button", { name: "登录" }));
    expect(authenticate).toHaveBeenCalledWith("login", "user@example.com", "password-123");
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
  });

  it("keeps a bound server address disabled", () => {
    renderDialog("syncSettings", { account: { serverUrl: preferences.serverUrl, status: "signedOut", userId: "id", email: "user@example.com" } });
    expect((screen.getByLabelText("同步服务地址") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/服务地址已锁定/)).toBeTruthy();
  });

  it("submits a redemption code through the subscription callback", async () => {
    const redeem = vi.fn(async () => undefined);
    const { user } = renderDialog("subscription", {
      account: { ...account, status: "signedIn", userId: "user" },
      onRedeemSubscription: redeem,
    });
    await user.type(screen.getByLabelText("Pro 兑换码"), "PRO-2026");
    await user.click(screen.getByRole("button", { name: "兑换 Pro" }));
    expect(redeem).toHaveBeenCalledWith("PRO-2026");
  });

  it("marks a locally persisted training task complete", async () => {
    const complete = vi.fn(async () => undefined);
    const { user } = renderDialog("training", {
      trainingTasks: [{ id: "task-1", gameId: "game-1", nodeId: "node-1", title: "复盘第 12 手", detail: "比较候选着法", createdAt: "2026-01-01T00:00:00Z" }],
      onCompleteTraining: complete,
    });
    await user.click(screen.getByRole("checkbox"));
    expect(complete).toHaveBeenCalledWith("task-1", true);
  });
});
