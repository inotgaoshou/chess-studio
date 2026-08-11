import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogs, engineDifficultyFromPreferences, engineDifficultyToDepth } from "./DesktopDialogs";
import { BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH, type DesktopPreferencesDto, type SyncAccountDto } from "./platform";

const preferences: DesktopPreferencesDto = {
  enginePath: "/opt/pikafish",
  threads: 2,
  hashMb: 256,
  multipv: 2,
  candidateLineMoves: 16,
  searchMode: "depth",
  searchValue: 24,
  moveTimeMs: 1000,
  ponder: false,
  autoAnalyze: false,
  libraryCollapsed: false,
  candidateRailCollapsed: false,
  analysisPanelCollapsed: false,
  evaluationCollapsed: true,
  branchArrowColor: "#2f80ed",
  analysisEngineMode: "single",
  parallelEngineIds: [],
  workspacePanel: "moves",
  layoutMode: "studio",
  manualViewMode: "track",
  colorTheme: "dark",
  boardSkin: "default",
  pieceSkin: "default",
  reportDepth: 24,
  builtinOpeningBookEnabled: true,
  activeBuiltinOpeningBookId: "learning-top3",
  ruleMode: "domestic2020",
  serverUrl: "http://127.0.0.1:8080",
};
const account: SyncAccountDto = { serverUrl: preferences.serverUrl, status: "unbound" };

afterEach(cleanup);

function renderDialog(dialog: "engine" | "syncSettings" | "register" | "login" | "subscription" | "training" | "unbind", overrides: Partial<Parameters<typeof DesktopDialogs>[0]> = {}) {
  const props: Parameters<typeof DesktopDialogs>[0] = {
    dialog,
    preferences,
    account,
    trainingTasks: [],
    studySessions: [],
    busy: false,
    onClose: vi.fn(),
    onChooseEngine: vi.fn(async () => undefined),
    onSaveEngine: vi.fn(async () => undefined),
    onSaveSync: vi.fn(async () => undefined),
    onUnbindSync: vi.fn(async () => undefined),
    onAuthenticate: vi.fn(async () => undefined),
    onRedeemSubscription: vi.fn(async () => undefined),
    onGenerateTraining: vi.fn(async () => undefined),
    onSaveStudy: vi.fn(async () => undefined),
    onAnalyzeStudy: vi.fn(async () => undefined),
    onCompleteTraining: vi.fn(async () => undefined),
    ...overrides,
  };
  const view = render(<DesktopDialogs {...props}/>);
  return { props, user: userEvent.setup(), ...view };
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
      preferences: { ...preferences, enginePath: BUILTIN_ENGINE_PATH, activeEngineId: "old-external-profile" },
    });

    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe("内置 Pikafish（随应用安装，推荐）");
    expect(screen.getByText(/不依赖本机绝对路径/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /内置 Pikafish当前默认|内置 Pikafish随 App 安装/ }));
    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({ enginePath: BUILTIN_ENGINE_PATH, activeEngineId: undefined }), "内置 Pikafish");
  });

  it("does not offer bundled Fairy-Stockfish as a built-in comparison engine", () => {
    renderDialog("engine", {
      preferences: { ...preferences, enginePath: BUILTIN_ENGINE_PATH, analysisEngineMode: "parallel" },
    });

    expect(screen.queryByText("内置 Fairy-Stockfish")).toBeNull();
    expect(screen.queryByTitle("将 内置 Fairy-Stockfish 作为对比引擎，不改变主引擎")).toBeNull();
    expect(screen.getByText(/Fairy-Stockfish 可作为外部引擎手动导入/)).toBeTruthy();
  });

  it("migrates legacy bundled Fairy preferences back to bundled Pikafish", async () => {
    const { props, user } = renderDialog("engine", {
      preferences: { ...preferences, enginePath: BUILTIN_FAIRY_ENGINE_PATH, parallelEnginePaths: [BUILTIN_FAIRY_ENGINE_PATH] },
    });

    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe("内置 Pikafish（随应用安装，推荐）");
    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({
      enginePath: BUILTIN_ENGINE_PATH,
      parallelEnginePaths: [],
    }));
  });

  it("counts only effective comparison engines in the parallel summary", () => {
    renderDialog("engine", {
      preferences: {
        ...preferences,
        enginePath: "/engines/main",
        activeEngineId: "engine-2",
        analysisEngineMode: "parallel",
        parallelEngineIds: ["deleted-profile", "engine-2"],
        parallelEnginePaths: [BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH],
      },
      engineProfiles: [
        { id: "engine-2", name: "当前主引擎", executablePath: "/engines/main", protocol: "ucci", active: true },
      ],
    });

    expect(screen.getByText("当前共 2 个引擎：1 个主引擎 + 1 个对比引擎；勾选“作为对比”后保存生效")).toBeTruthy();
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
    await user.clear(screen.getByLabelText("候选走法（默认2，不限上限）"));
    await user.type(screen.getByLabelText("候选走法（默认2，不限上限）"), "4");
    await user.clear(screen.getByLabelText("每种后续（5-8回合）"));
    await user.type(screen.getByLabelText("每种后续（5-8回合）"), "6");
    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({ enginePath: "/opt/pikafish", multipv: 4, candidateLineMoves: 12 }));
  });

  it("maps the quick difficulty level to fixed depth settings", async () => {
    expect(engineDifficultyFromPreferences({ searchMode: "depth", searchValue: 24 })).toBe(20);
    expect(engineDifficultyToDepth(20)).toBe(24);
    expect(engineDifficultyToDepth(1)).toBe(8);

    const { props, user } = renderDialog("engine", {
      preferences: { ...preferences, searchMode: "depth", searchValue: 23, reportDepth: 23 },
    });

    await user.click(screen.getByRole("button", { name: "提高难度等级" }));
    expect((screen.getByLabelText("搜索限制") as HTMLInputElement).value).toBe("24");
    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({
      searchMode: "depth",
      searchValue: 24,
      reportDepth: 24,
    }));
  });

  it("saves quick thread hash and ponder controls through the existing engine preferences", async () => {
    const { props, user } = renderDialog("engine", {
      preferences: { ...preferences, threads: 2, hashMb: 256, ponder: false },
    });

    await user.click(screen.getByRole("button", { name: "增加线程数" }));
    await user.click(screen.getByRole("button", { name: "减少哈希值" }));
    await user.click(screen.getByRole("switch", { name: /后台思考/ }));
    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({
      threads: 3,
      hashMb: 240,
      ponder: true,
    }));
  });

  it("normalizes engine setting ranges before saving", async () => {
    const { props, user } = renderDialog("engine");
    await user.clear(screen.getByLabelText("候选走法（默认2，不限上限）"));
    await user.type(screen.getByLabelText("候选走法（默认2，不限上限）"), "16");

    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    expect(props.onSaveEngine).toHaveBeenCalledWith(expect.objectContaining({ multipv: 16 }));
    expect((screen.getByLabelText("候选走法（默认2，不限上限）") as HTMLInputElement).value).toBe("16");
  });

  it("migrates legacy engine defaults when the settings dialog opens", () => {
    renderDialog("engine", {
      preferences: {
        ...preferences,
        candidateLineMoves: 6,
        searchMode: "infinite",
        searchValue: 1500,
        reportDepth: 26,
      },
    });

    expect((screen.getByLabelText("搜索模式") as HTMLSelectElement).value).toBe("depth");
    expect((screen.getByLabelText("搜索限制") as HTMLInputElement).value).toBe("24");
    expect((screen.getByLabelText("整局复盘深度") as HTMLInputElement).value).toBe("24");
    expect((screen.getByLabelText("每种后续（5-8回合）") as HTMLInputElement).value).toBe("8");
  });

  it("migrates the old fixed depth 30 defaults to depth 24 without changing custom depth", () => {
    const { unmount } = renderDialog("engine", {
      preferences: { ...preferences, searchMode: "depth", searchValue: 30, reportDepth: 30 },
    });

    expect((screen.getByLabelText("搜索限制") as HTMLInputElement).value).toBe("24");
    expect((screen.getByLabelText("整局复盘深度") as HTMLInputElement).value).toBe("24");
    unmount();

    renderDialog("engine", {
      preferences: { ...preferences, searchMode: "depth", searchValue: 22, reportDepth: 22 },
    });

    expect((screen.getByLabelText("搜索限制") as HTMLInputElement).value).toBe("22");
    expect((screen.getByLabelText("整局复盘深度") as HTMLInputElement).value).toBe("22");
  });

  it("saves the selected rule mode from the engine dialog", async () => {
    const saveEngine = vi.fn(async () => undefined);
    const { user } = renderDialog("engine", { onSaveEngine: saveEngine });

    await user.selectOptions(screen.getByLabelText("棋规模式"), "asianAxf");
    expect(screen.getAllByText(/亚洲象棋规则（AXF导向）/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    const calls = saveEngine.mock.calls as unknown as Array<[DesktopPreferencesDto]>;
    expect(calls[0]?.[0]).toEqual(expect.objectContaining({ ruleMode: "asianAxf" }));
  });

  it("shows bundled opening books and saves the selected built-in book", async () => {
    const saveEngine = vi.fn(async () => undefined);
    const { user } = renderDialog("engine", {
      onSaveEngine: saveEngine,
      builtinOpeningBookManifest: {
        version: "test",
        defaultBookId: "learning-top3",
        internalUseOnly: true,
        vkeyVerification: { status: "unverified", note: "test" },
        books: [
          { id: "learning-top3", name: "学习精选 Top3", shortName: "学习精选", kind: "learning", fileName: "02_learning_top3.pfBook", description: "", rowCount: 2148653, positionCount: 2120232, maxCandidatesPerPosition: 3, sha256: "sha", default: true },
          { id: "complete-compatible", name: "完整兼容库", shortName: "完整库", kind: "complete", fileName: "01_complete_compatible.pfBook", description: "", rowCount: 2149843, positionCount: 2120232, maxCandidatesPerPosition: 32, sha256: "sha", default: false },
          { id: "obk-observation", name: "obk 独有观察库", shortName: "观察库", kind: "observation", fileName: "04_obk_unique_observation.pfBook", description: "", rowCount: 68036, positionCount: 67269, maxCandidatesPerPosition: 19, sha256: "sha", default: false },
        ],
      },
    });

    expect(screen.getByText("内嵌学习开局库")).toBeTruthy();
    expect(screen.getByText("vkey 未验证，仅可选择库，暂不显示推荐。")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("当前库"), "complete-compatible");
    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    const calls = saveEngine.mock.calls as unknown as Array<[DesktopPreferencesDto]>;
    expect(calls[0]?.[0]).toEqual(expect.objectContaining({
      builtinOpeningBookEnabled: true,
      activeBuiltinOpeningBookId: "complete-compatible",
    }));
  });

  it("adds Fairy and Cyclone style engines through named presets", async () => {
    const enginePath = "/Applications/Fairy-Stockfish/fairy-stockfish";
    const saveEngine = vi.fn(async () => undefined);
    const { user } = renderDialog("engine", {
      preferences: { ...preferences, enginePath: "" },
      onChooseEngine: vi.fn(async () => enginePath),
      onSaveEngine: saveEngine,
    });

    await user.click(screen.getByRole("button", { name: "导入 Fairy-Stockfish" }));
    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe(enginePath);
    expect((screen.getByLabelText("引擎档案名称") as HTMLInputElement).value).toBe("Fairy-Stockfish");

    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect(saveEngine).toHaveBeenCalledWith(expect.objectContaining({ enginePath }), "Fairy-Stockfish");
  });

  it("switches and deletes saved engine profiles from the engine dialog", async () => {
    const selectEngine = vi.fn(async () => ({ ...preferences, enginePath: "/engines/cyclone", activeEngineId: "engine-2" }));
    const deleteEngine = vi.fn(async () => ({ ...preferences, enginePath: BUILTIN_ENGINE_PATH, activeEngineId: undefined }));
    const { user } = renderDialog("engine", {
      preferences: { ...preferences, activeEngineId: "engine-1" },
      engineProfiles: [
        { id: "engine-1", name: "Fairy-Stockfish", executablePath: "/engines/fairy", protocol: "uci", active: true },
        { id: "engine-2", name: "象棋旋风", executablePath: "/engines/cyclone", protocol: "ucci", active: false },
      ],
      onSelectEngineProfile: selectEngine,
      onDeleteEngineProfile: deleteEngine,
    });

    await user.click(screen.getAllByRole("button", { name: /象棋旋风/ })[1]);
    expect(selectEngine).toHaveBeenCalledWith("engine-2");
    expect((screen.getByLabelText("引擎可执行文件") as HTMLInputElement).value).toBe("/engines/cyclone");

    await user.click(screen.getByRole("button", { name: "删除 象棋旋风 档案" }));
    expect(deleteEngine).toHaveBeenCalledWith("engine-2");
  });

  it("keeps an engine save failure beside the save controls", async () => {
    const { user } = renderDialog("engine", {
      onSaveEngine: vi.fn(async () => { throw new Error("引擎握手失败"); }),
    });

    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    const alert = await screen.findByRole("alert");
    const footer = screen.getByRole("button", { name: "检测并保存" }).closest("footer");
    expect(alert.textContent).toContain("保存失败：引擎握手失败");
    expect(alert.nextElementSibling).toBe(footer);
  });

  it("does not clear an engine save failure when preference props are reconciled", async () => {
    const saveEngine = vi.fn(async () => { throw new Error("登录同步账号后才能使用登录专享皮肤"); });
    const { props, rerender, user } = renderDialog("engine", { onSaveEngine: saveEngine });

    await user.click(screen.getByRole("button", { name: "检测并保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("登录同步账号后才能使用登录专享皮肤");

    rerender(<DesktopDialogs {...props} preferences={{ ...preferences, candidateLineMoves: 12 }}/>);
    expect(screen.getByRole("alert").textContent).toContain("登录同步账号后才能使用登录专享皮肤");
  });

  it("shows an explicit confirmation after engine detection and save succeeds", async () => {
    const { user } = renderDialog("engine");

    await user.click(screen.getByRole("button", { name: "检测并保存" }));

    expect((await screen.findByRole("status")).textContent).toBe("引擎检测成功，设置已保存");
  });

  it("keeps appearance controls out of the engine dialog", () => {
    renderDialog("engine", {
      preferences: { ...preferences, boardSkin: "jingdian", pieceSkin: "jingdian" },
      account: { ...account, status: "signedOut" },
    });

    expect(screen.queryByLabelText("棋盘皮肤")).toBeNull();
    expect(screen.queryByLabelText("棋子皮肤")).toBeNull();
    expect(screen.queryByText("每步自动分析")).toBeNull();
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

  it("allows an eight-character password", async () => {
    const { user } = renderDialog("register");
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "password");

    expect((screen.getByRole("button", { name: "注册并登录" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows an authentication failure in the dialog instead of failing silently", async () => {
    const authenticate = vi.fn(async () => { throw new Error("同步服务不可用"); });
    const { user } = renderDialog("register", { onAuthenticate: authenticate });
    await user.type(screen.getByLabelText("邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("密码"), "password-123");
    await user.click(screen.getByRole("button", { name: "注册并登录" }));

    expect((await screen.findByRole("alert")).textContent).toContain("同步服务不可用");
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
  });

  it("tells the user to log in when the email is already registered", async () => {
    const authenticate = vi.fn(async () => { throw new Error("email already registered"); });
    const { user } = renderDialog("register", { onAuthenticate: authenticate });
    await user.type(screen.getByLabelText("邮箱"), "existing@example.com");
    await user.type(screen.getByLabelText("密码"), "password-123");
    await user.click(screen.getByRole("button", { name: "注册并登录" }));

    expect((await screen.findByRole("alert")).textContent).toBe("该邮箱已经注册，请直接登录");
  });

  it("keeps a bound server address disabled", () => {
    renderDialog("syncSettings", { account: { serverUrl: preferences.serverUrl, status: "signedOut", userId: "id", email: "user@example.com" } });
    expect((screen.getByLabelText("同步服务地址") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/服务地址已锁定/)).toBeTruthy();
  });

  it("requires explicit confirmation before clearing a bound library", async () => {
    const unbind = vi.fn(async () => undefined);
    const { user } = renderDialog("unbind", { onUnbindSync: unbind });
    const confirm = screen.getByRole("button", { name: "解除并清空本机数据" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.type(screen.getByLabelText("确认文本"), "解除绑定");
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(unbind).toHaveBeenCalledOnce();
    expect(await screen.findByText("本机棋谱库已解除绑定并清空")).toBeTruthy();
  });

  it("shows an unbind failure in the confirmation dialog", async () => {
    const { user } = renderDialog("unbind", {
      onUnbindSync: vi.fn(async () => { throw new Error("本机棋谱库清除失败"); }),
    });
    await user.type(screen.getByLabelText("确认文本"), "解除绑定");
    await user.click(screen.getByRole("button", { name: "解除并清空本机数据" }));

    expect((await screen.findByRole("alert")).textContent).toContain("本机棋谱库清除失败");
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
      trainingTasks: [{ id: "task-1", gameId: "game-1", nodeId: "node-1", title: "复盘第 12 手", detail: "比较候选着法", taskType: "critical", createdAt: "2026-01-01T00:00:00Z" }],
      onCompleteTraining: complete,
    });
    await user.click(screen.getByRole("checkbox"));
    expect(complete).toHaveBeenCalledWith("task-1", true);
  });
});
