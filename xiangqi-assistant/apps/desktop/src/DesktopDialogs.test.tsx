import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogs } from "./DesktopDialogs";
import type { DesktopPreferencesDto, SyncAccountDto } from "./platform";

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
  serverUrl: "http://127.0.0.1:8080",
};
const account: SyncAccountDto = { serverUrl: preferences.serverUrl, status: "unbound" };

afterEach(cleanup);

function renderDialog(dialog: "engine" | "syncSettings" | "register" | "login", overrides: Partial<Parameters<typeof DesktopDialogs>[0]> = {}) {
  const props: Parameters<typeof DesktopDialogs>[0] = {
    dialog,
    preferences,
    account,
    busy: false,
    onClose: vi.fn(),
    onChooseEngine: vi.fn(async () => undefined),
    onSaveEngine: vi.fn(async () => undefined),
    onSaveSync: vi.fn(async () => undefined),
    onAuthenticate: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<DesktopDialogs {...props}/>);
  return { props, user: userEvent.setup() };
}

describe("DesktopDialogs", () => {
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
});
