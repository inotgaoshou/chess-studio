import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FolderOpen, LogIn, Save, Settings2, Trash2, UserPlus, X } from "lucide-react";
import { BUILTIN_ENGINE_PATH, BUILTIN_FAIRY_ENGINE_PATH, type DesktopPreferencesDto, type EngineProfileDto, type SubscriptionDto, type SyncAccountDto, type TrainingTaskDto } from "./platform";
import { MAX_CANDIDATE_LINE_MOVES, MIN_CANDIDATE_LINE_MOVES } from "./candidatePreview";

export type DesktopDialog = "engine" | "syncSettings" | "register" | "login" | "subscription" | "training" | "unbind" | null;

type Props = {
  dialog: DesktopDialog;
  preferences: DesktopPreferencesDto;
  account: SyncAccountDto;
  subscription?: SubscriptionDto;
  trainingTasks: TrainingTaskDto[];
  engineProfiles?: EngineProfileDto[];
  busy: boolean;
  onClose(): void;
  onChooseEngine(currentPath: string): Promise<string | undefined>;
  onSaveEngine(preferences: DesktopPreferencesDto, profileName?: string): Promise<void>;
  onSelectEngineProfile?(id: string): Promise<DesktopPreferencesDto>;
  onDeleteEngineProfile?(id: string): Promise<DesktopPreferencesDto>;
  onSaveSync(serverUrl: string): Promise<void>;
  onUnbindSync(): Promise<void>;
  onAuthenticate(mode: "register" | "login", email: string, password: string): Promise<void>;
  onRedeemSubscription(code: string): Promise<void>;
  onGenerateTraining(): Promise<void>;
  onCompleteTraining(taskId: string, completed: boolean): Promise<void>;
};

const enginePresetNames = ["Pikafish", "Fairy-Stockfish", "象棋旋风", "象眼 EleEye"] as const;
const branchArrowColors = [
  ["#2f80ed", "天蓝（推荐）"],
  ["#f2c94c", "金黄"],
  ["#27ae60", "绿色"],
  ["#9b51e0", "紫色"],
  ["#eb5757", "红色"],
] as const;

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeEnginePreferences(preferences: DesktopPreferencesDto): DesktopPreferencesDto {
  return {
    ...preferences,
    threads: clampInteger(preferences.threads, 1, 64),
    hashMb: clampInteger(preferences.hashMb, 16, 4096),
    multipv: clampInteger(preferences.multipv, 1, 10),
    candidateLineMoves: clampInteger(preferences.candidateLineMoves, MIN_CANDIDATE_LINE_MOVES, MAX_CANDIDATE_LINE_MOVES),
    searchValue: preferences.searchMode === "infinite"
      ? preferences.searchValue
      : clampInteger(
        preferences.searchValue,
        preferences.searchMode === "depth" ? 1 : preferences.searchMode === "nodes" ? 1000 : 100,
        preferences.searchMode === "depth" ? 100 : preferences.searchMode === "nodes" ? 100000000 : 30000,
    ),
    reportDepth: clampInteger(preferences.reportDepth, 8, 40),
    moveTimeMs: clampInteger(preferences.moveTimeMs, 100, 30000),
    branchArrowColor: branchArrowColors.some(([value]) => value === preferences.branchArrowColor) ? preferences.branchArrowColor : "#2f80ed",
  };
}

function engineInputValue(path: string) {
  if (path === BUILTIN_ENGINE_PATH) return "内置 Pikafish（随应用安装，推荐）";
  if (path === BUILTIN_FAIRY_ENGINE_PATH) return "内置 Fairy-Stockfish（象棋模式，对比参考）";
  return path;
}

function protocolLabel(protocol: EngineProfileDto["protocol"]) {
  return protocol === "ucci" ? "UCCI" : "UCI";
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function branchArrowColorLabel(value: string) {
  return branchArrowColors.find(([color]) => color === value)?.[1] ?? "天蓝（推荐）";
}

function authenticationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /email already registered|邮箱.*已.*注册|\b409\b/i.test(message)
    ? "该邮箱已经注册，请直接登录"
    : message;
}

export function DesktopDialogs({ dialog, preferences, account, subscription, trainingTasks, engineProfiles = [], busy, onClose, onChooseEngine, onSaveEngine, onSelectEngineProfile, onDeleteEngineProfile, onSaveSync, onUnbindSync, onAuthenticate, onRedeemSubscription, onGenerateTraining, onCompleteTraining }: Props) {
  const [draft, setDraft] = useState(preferences);
  const [email, setEmail] = useState(account.email ?? "");
  const [password, setPassword] = useState("");
  const [redemptionCode, setRedemptionCode] = useState("");
  const [unbindConfirmation, setUnbindConfirmation] = useState("");
  const [unbindCompleted, setUnbindCompleted] = useState(false);
  const [enginePickerBusy, setEnginePickerBusy] = useState(false);
  const [enginePickerError, setEnginePickerError] = useState("");
  const [engineSaveError, setEngineSaveError] = useState("");
  const [engineSaveSuccess, setEngineSaveSuccess] = useState("");
  const [engineProfileName, setEngineProfileName] = useState("");
  const initializedDialog = useRef<DesktopDialog>(null);
  const branchArrowColor = branchArrowColors.some(([value]) => value === draft.branchArrowColor) ? draft.branchArrowColor : "#2f80ed";
  const builtInEngines = [
    { path: BUILTIN_ENGINE_PATH, name: "内置 Pikafish", detail: "随 App 安装，推荐日常拆棋" },
    { path: BUILTIN_FAIRY_ENGINE_PATH, name: "内置 Fairy-Stockfish", detail: "独立资源目录，强制 Xiangqi 变体，适合对比参考" },
  ];
  const comparisonEngineCount = new Set([
    ...engineProfiles
      .filter((profile) => profile.id !== draft.activeEngineId && profile.executablePath !== draft.enginePath && draft.parallelEngineIds.includes(profile.id))
      .map((profile) => `profile:${profile.id}`),
    ...(draft.parallelEnginePaths ?? [])
      .filter((path) => path !== draft.enginePath)
      .map((path) => `path:${path}`),
  ]).size;

  useEffect(() => {
    if (!dialog) {
      initializedDialog.current = null;
      setPassword("");
      setRedemptionCode("");
      return;
    }
    if (initializedDialog.current === dialog) return;
    initializedDialog.current = dialog;
    setDraft(preferences);
    setEmail(account.email ?? "");
    setPassword("");
    setRedemptionCode("");
    setUnbindConfirmation("");
    setUnbindCompleted(false);
    setEnginePickerBusy(false);
    setEnginePickerError("");
    setEngineSaveError("");
    setEngineSaveSuccess("");
    setEngineProfileName("");
  }, [account.email, dialog, preferences]);

  if (!dialog) return null;

  function close() {
    setPassword("");
    onClose();
  }

  async function authenticate(mode: "register" | "login") {
    setEnginePickerError("");
    try {
      await onAuthenticate(mode, email, password);
    } catch (error) {
      setEnginePickerError(authenticationErrorMessage(error));
    } finally {
      setPassword("");
    }
  }

  async function chooseEngine(profileName?: string) {
    setEnginePickerBusy(true);
    setEnginePickerError("");
    setEngineSaveError("");
    setEngineSaveSuccess("");
    try {
      const path = await onChooseEngine(draft.enginePath.trim());
      if (path) {
        setDraft((current) => ({ ...current, enginePath: path, activeEngineId: undefined }));
        setEngineProfileName(profileName ?? fileNameFromPath(path));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnginePickerError(`选择引擎文件失败：${message}`);
    } finally {
      setEnginePickerBusy(false);
    }
  }

  async function selectEngineProfile(profile: EngineProfileDto) {
    setEnginePickerBusy(true);
    setEnginePickerError("");
    setEngineSaveError("");
    setEngineSaveSuccess("");
    try {
      if (onSelectEngineProfile) {
        const saved = await onSelectEngineProfile(profile.id);
        setDraft((current) => ({
          ...current,
          enginePath: saved.enginePath,
          activeEngineId: saved.activeEngineId,
          parallelEngineIds: current.parallelEngineIds.filter((id) => id !== profile.id),
          parallelEnginePaths: (current.parallelEnginePaths ?? []).filter((path) => path !== saved.enginePath),
        }));
      } else {
        setDraft((current) => ({
          ...current,
          enginePath: profile.executablePath,
          activeEngineId: profile.id,
          parallelEngineIds: current.parallelEngineIds.filter((id) => id !== profile.id),
          parallelEnginePaths: (current.parallelEnginePaths ?? []).filter((path) => path !== profile.executablePath),
        }));
      }
      setEngineProfileName(profile.name);
      setEngineSaveSuccess(`${profile.name} 已设为主引擎；箭头、总评、人机和报告会使用它`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnginePickerError(`切换引擎失败：${message}`);
    } finally {
      setEnginePickerBusy(false);
    }
  }

  async function deleteEngineProfile(profile: EngineProfileDto) {
    if (!onDeleteEngineProfile) return;
    setEnginePickerBusy(true);
    setEnginePickerError("");
    setEngineSaveError("");
    setEngineSaveSuccess("");
    try {
      const saved = await onDeleteEngineProfile(profile.id);
      setDraft((current) => ({
        ...current,
        enginePath: saved.enginePath,
        activeEngineId: saved.activeEngineId,
      }));
      setEngineSaveSuccess(`已删除 ${profile.name} 档案；不会删除本机引擎文件`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnginePickerError(`删除引擎档案失败：${message}`);
    } finally {
      setEnginePickerBusy(false);
    }
  }

  async function saveEngine() {
    setEngineSaveError("");
    setEngineSaveSuccess("");
    try {
      const sanitized = sanitizeEnginePreferences(draft);
      setDraft(sanitized);
      if (engineProfileName.trim()) await onSaveEngine(sanitized, engineProfileName.trim());
      else await onSaveEngine(sanitized);
      setEngineSaveSuccess("引擎检测成功，设置已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEngineSaveError(`保存失败：${message}`);
    }
  }

  async function redeemSubscription() {
    try {
      await onRedeemSubscription(redemptionCode);
      setRedemptionCode("");
    } catch (error) {
      setEnginePickerError(error instanceof Error ? error.message : String(error));
    }
  }

  async function unbindSync() {
    if (unbindConfirmation !== "解除绑定") {
      setEnginePickerError("请输入“解除绑定”确认此操作");
      return;
    }
    setEnginePickerError("");
    try {
      await onUnbindSync();
      setUnbindCompleted(true);
    } catch (error) {
      setEnginePickerError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className={`settings-dialog ${dialog === "engine" ? "engine-settings-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={dialog === "engine" ? "引擎设置" : dialog === "syncSettings" ? "同步设置" : dialog === "subscription" ? "Pro 权益" : dialog === "training" ? "训练任务" : dialog === "unbind" ? "解除账号绑定" : dialog === "register" ? "注册同步账号" : "登录同步账号"}>
        <header>
          <div>{dialog === "register" ? <UserPlus size={17}/> : dialog === "login" ? <LogIn size={17}/> : <Settings2 size={17}/>}<strong>{dialog === "engine" ? "引擎设置" : dialog === "syncSettings" ? "同步设置" : dialog === "subscription" ? "Pro 权益" : dialog === "training" ? "训练任务" : dialog === "unbind" ? "解除账号绑定" : dialog === "register" ? "注册同步账号" : "登录同步账号"}</strong></div>
          <button className="tool-button" title="关闭" disabled={busy} onClick={close}><X size={16}/></button>
        </header>

        {dialog === "engine" && <div className="dialog-form engine-settings-form">
          <label className="full"><span>引擎可执行文件</span><div className="dialog-input-action"><input value={engineInputValue(draft.enginePath)} readOnly={draft.enginePath === BUILTIN_ENGINE_PATH || draft.enginePath === BUILTIN_FAIRY_ENGINE_PATH} placeholder="选择 Pikafish / Fairy / 象眼 / 旋风等 UCI 或 UCCI 引擎" onChange={(event) => { setEnginePickerError(""); setEngineSaveError(""); setEngineSaveSuccess(""); setEngineProfileName(fileNameFromPath(event.target.value)); setDraft({ ...draft, enginePath: event.target.value, activeEngineId: undefined }); }}/><button type="button" title="使用安装包内置 Pikafish" disabled={busy || enginePickerBusy} onClick={() => { setEnginePickerError(""); setEngineSaveError(""); setEngineSaveSuccess(""); setEngineProfileName("内置 Pikafish"); setDraft({ ...draft, enginePath: BUILTIN_ENGINE_PATH, activeEngineId: draft.enginePath === BUILTIN_ENGINE_PATH ? draft.activeEngineId : undefined }); }}>内置</button><button type="button" title="选择外部引擎文件" disabled={busy || enginePickerBusy} onClick={() => void chooseEngine()}><FolderOpen size={15}/></button></div></label>
          <label className="full"><span>引擎档案名称</span><input value={engineProfileName} placeholder="例如 Fairy-Stockfish、象棋旋风、象眼 EleEye" onChange={(event) => setEngineProfileName(event.target.value)}/></label>
          {(draft.enginePath === BUILTIN_ENGINE_PATH || draft.enginePath === BUILTIN_FAIRY_ENGINE_PATH) && <p className="dialog-hint full">当前使用安装包内置引擎。正式安装后会从 App 资源目录自动定位，不依赖本机绝对路径；Fairy-Stockfish 会自动设置为中国象棋 Xiangqi 模式。</p>}
          <div className="engine-profile-manager full" aria-label="多引擎档案">
            <header>
              <div><strong>分析引擎角色</strong><small>先确定 1 个主引擎，再选择需要同时计算的对比引擎</small></div>
              <button type="button" disabled={busy || enginePickerBusy} onClick={() => void chooseEngine()}><FolderOpen size={13}/>新增外部引擎</button>
            </header>
            <div className="engine-analysis-mode" role="group" aria-label="分析引擎模式">
              <button type="button" className={draft.analysisEngineMode === "single" ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, analysisEngineMode: "single" }))}>仅主引擎</button>
              <button type="button" className={draft.analysisEngineMode === "parallel" ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, analysisEngineMode: "parallel" }))}>主引擎 + 对比</button>
              <small>{draft.analysisEngineMode === "parallel" ? `当前共 ${comparisonEngineCount + 1} 个引擎：1 个主引擎 + ${comparisonEngineCount} 个对比引擎；勾选“作为对比”后保存生效` : "仅使用标有“主引擎”的一项进行分析"}</small>
            </div>
            <div className="engine-preset-grid" aria-label="常用引擎预设">
              {enginePresetNames.map((name) => <button type="button" key={name} disabled={busy || enginePickerBusy} onClick={() => void chooseEngine(name)} title={`选择 ${name} 的外部可执行文件`}>导入 {name}</button>)}
            </div>
            <div className="engine-profile-list">
              <div className="engine-profile-list-title"><strong>主引擎候选</strong><small>点击任意一项设为主引擎；内置引擎随应用提供，不是可删除档案</small></div>
              {builtInEngines.map(({ path, name, detail }) => {
                const active = draft.enginePath === path;
                const selectedForComparison = (draft.parallelEnginePaths ?? []).includes(path);
                return <div className={`engine-profile-row saved builtin ${draft.analysisEngineMode === "parallel" && !active ? "has-compare" : ""} ${active ? "active" : ""}`} key={path}>
                  {draft.analysisEngineMode === "parallel" && !active && <label className="engine-profile-compare" title={`将 ${name} 作为对比引擎，不改变主引擎`}><input type="checkbox" checked={selectedForComparison} onChange={(event) => setDraft((current) => ({ ...current, parallelEnginePaths: event.target.checked ? [...new Set([...(current.parallelEnginePaths ?? []), path])] : (current.parallelEnginePaths ?? []).filter((value) => value !== path) }))}/><span>作为对比</span></label>}
                  <button type="button" title={`设 ${name} 为主引擎`} disabled={busy || enginePickerBusy} onClick={() => { setEnginePickerError(""); setEngineSaveError(""); setEngineSaveSuccess(`${name} 已设为主引擎；内置引擎不可删除`); setEngineProfileName(name); setDraft((current) => ({ ...current, enginePath: path, activeEngineId: undefined, parallelEnginePaths: (current.parallelEnginePaths ?? []).filter((value) => value !== path) })); }}>
                    <span><strong>{name}</strong><small>{active ? "当前默认：箭头、总评、人机和报告均使用它" : `${detail} · 点击设为主引擎`}</small></span>
                    <em>{active ? "主引擎" : "内置 · 不可删除"}</em>
                  </button>
                </div>;
              })}
              {engineProfiles.length > 0 && <div className="engine-profile-list-title external"><strong>外部引擎档案</strong><small>可设为主引擎，也可加入并行对比；删除只移除档案，不删除本机文件</small></div>}
              {engineProfiles.map((profile) => {
                const active = draft.activeEngineId === profile.id || draft.enginePath === profile.executablePath;
                return <div className={`engine-profile-row saved ${draft.analysisEngineMode === "parallel" && !active ? "has-compare" : ""} ${active ? "active" : ""}`} key={profile.id}>
                  {draft.analysisEngineMode === "parallel" && !active && <label className="engine-profile-compare" title={`将 ${profile.name} 作为对比引擎，不改变主引擎`}><input type="checkbox" checked={draft.parallelEngineIds.includes(profile.id)} onChange={(event) => setDraft((current) => ({ ...current, parallelEngineIds: event.target.checked ? [...new Set([...current.parallelEngineIds, profile.id])] : current.parallelEngineIds.filter((id) => id !== profile.id) }))}/><span>作为对比</span></label>}
                  <button type="button" title={`设 ${profile.name} 为主引擎`} disabled={busy || enginePickerBusy} onClick={() => void selectEngineProfile(profile)}>
                    <span><strong>{profile.name}</strong><small>{active ? "当前默认：箭头、总评、人机和报告均使用它" : `${profile.executablePath} · 点击设为主引擎`}</small></span>
                    <em>{active ? "主引擎" : protocolLabel(profile.protocol)}</em>
                  </button>
                  <button type="button" className="danger" title={`删除 ${profile.name} 档案`} aria-label={`删除 ${profile.name} 档案`} disabled={busy || enginePickerBusy} onClick={() => void deleteEngineProfile(profile)}><Trash2 size={12}/></button>
                </div>;
              })}
              {engineProfiles.length === 0 && <p>还没有外部引擎档案。选择外部引擎后点“检测并保存”，会自动加入这里。</p>}
            </div>
          </div>
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <label><span>线程</span><input type="number" min={1} max={64} value={draft.threads} onChange={(event) => setDraft({ ...draft, threads: Number(event.target.value) })}/></label>
          <label><span>Hash (MB)</span><input type="number" min={16} max={4096} step={16} value={draft.hashMb} onChange={(event) => setDraft({ ...draft, hashMb: Number(event.target.value) })}/></label>
          <label><span>MultiPV</span><input type="number" min={1} max={10} value={draft.multipv} onChange={(event) => setDraft({ ...draft, multipv: Number(event.target.value) })}/></label>
          <label><span>后续走法（半回合）</span><input type="number" min={MIN_CANDIDATE_LINE_MOVES} max={MAX_CANDIDATE_LINE_MOVES} value={draft.candidateLineMoves} onChange={(event) => setDraft({ ...draft, candidateLineMoves: Number(event.target.value) })}/></label>
          <label><span>搜索模式</span><select value={draft.searchMode} onChange={(event) => setDraft({ ...draft, searchMode: event.target.value as DesktopPreferencesDto["searchMode"] })}><option value="time">固定时间</option><option value="depth">固定深度</option><option value="nodes">固定节点</option><option value="infinite">持续分析</option></select></label>
          <label><span>搜索限制</span><input type="number" disabled={draft.searchMode === "infinite"} min={draft.searchMode === "depth" ? 1 : draft.searchMode === "nodes" ? 1000 : 100} max={draft.searchMode === "depth" ? 100 : draft.searchMode === "nodes" ? 100000000 : 30000} value={draft.searchValue} onChange={(event) => setDraft({ ...draft, searchValue: Number(event.target.value) })}/></label>
          <label><span>整局复盘深度</span><input type="number" min={8} max={40} value={draft.reportDepth} onChange={(event) => setDraft({ ...draft, reportDepth: Number(event.target.value) })}/></label>
          <label className="branch-arrow-color-field"><span>分支箭头颜色</span><div className="branch-arrow-color-control">
            <select value={branchArrowColor} onChange={(event) => setDraft({ ...draft, branchArrowColor: event.target.value })}>{branchArrowColors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <div className="branch-arrow-preview" style={{ "--branch-arrow-preview-color": branchArrowColor } as CSSProperties} aria-label={`当前分支箭头颜色预览：${branchArrowColorLabel(branchArrowColor)}`}>
              <svg viewBox="0 0 126 38" aria-hidden="true">
                <defs><marker id="branch-arrow-preview-head" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M 0 0 L 12 6 L 0 12 z"/></marker></defs>
                <line x1="14" y1="24" x2="86" y2="13" markerEnd="url(#branch-arrow-preview-head)"/>
                <circle cx="45" cy="19" r="12"/><text x="45" y="19">1</text>
              </svg>
              <small>悬停显示：1 马8进7</small>
            </div>
          </div></label>
          <label><span>每步时间 (ms)</span><input type="number" min={100} max={30000} step={100} value={draft.moveTimeMs} onChange={(event) => setDraft({ ...draft, moveTimeMs: Number(event.target.value) })}/></label>
          <label className="check-row"><input type="checkbox" checked={draft.cloudBookEnabled ?? false} onChange={(event) => setDraft({ ...draft, cloudBookEnabled: event.target.checked })}/><span>启用 ChessDB 云开局库</span></label>
          <label className="full"><span>云库地址</span><input value={draft.cloudBookUrl ?? "https://www.chessdb.cn/chessdb.php"} onChange={(event) => setDraft({ ...draft, cloudBookUrl: event.target.value })}/></label>
          <p className="dialog-hint full">开启后会向该地址发送当前 FEN，仅用于查询候选着法；网络不可用不会影响本地棋谱和引擎。</p>
          {!!draft.xqbBookPaths?.length && <div className="full dialog-book-list"><span>本地大师开局库</span>{draft.xqbBookPaths.map((path) => <label className="check-row" key={path}><input type="checkbox" checked={!draft.disabledXqbBookPaths?.includes(path)} onChange={(event) => setDraft({ ...draft, disabledXqbBookPaths: event.target.checked ? (draft.disabledXqbBookPaths ?? []).filter((value) => value !== path) : [...(draft.disabledXqbBookPaths ?? []), path] })}/><span>{path.split(/[\\/]/).at(-1)}</span></label>)}</div>}
          {engineSaveError && <p className="dialog-warning full engine-save-error" role="alert">{engineSaveError}</p>}
          {engineSaveSuccess && <p className="dialog-success full engine-save-success" role="status">{engineSaveSuccess}</p>}
          <footer><button onClick={close} disabled={busy || enginePickerBusy}>{engineSaveSuccess ? "关闭" : "取消"}</button><button className="primary" disabled={busy || enginePickerBusy || !draft.enginePath.trim()} onClick={() => void saveEngine()}><Save size={14}/>{busy ? "检测中…" : enginePickerBusy ? "选择中…" : "检测并保存"}</button></footer>
        </div>}

        {dialog === "syncSettings" && <div className="dialog-form">
          <p className="dialog-hint">本机地址可以使用 HTTP，其他地址必须使用 HTTPS。棋谱库绑定账号后不能更换服务器。</p>
          <label className="full"><span>同步服务地址</span><input disabled={!!account.userId} value={draft.serverUrl} onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })}/></label>
          {account.userId && <p className="dialog-warning">已绑定 {account.email}，服务地址已锁定。</p>}
          <footer><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !!account.userId} onClick={() => void onSaveSync(draft.serverUrl)}><Save size={14}/>保存</button></footer>
        </div>}

        {dialog === "subscription" && <div className="dialog-form account-form">
          {subscription?.plan === "pro" && subscription.status === "active"
            ? <p className="dialog-hint">Pro 已开通，至 {new Date(subscription.expiresAt).toLocaleDateString()}。本周期云分析 {subscription.cloudAnalysisUsed} / {subscription.cloudAnalysisQuota} 次。</p>
            : <p className="dialog-hint">当前为免费版。本地棋谱、本地引擎和离线复盘始终可用；兑换 Pro 后可使用云端深度分析和训练服务。</p>}
          <label className="full"><span>Pro 兑换码</span><input value={redemptionCode} placeholder="输入运营发放的兑换码" onChange={(event) => { setEnginePickerError(""); setRedemptionCode(event.target.value); }}/></label>
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <footer><button onClick={close} disabled={busy}>关闭</button><button className="primary" disabled={busy || !redemptionCode.trim() || account.status !== "signedIn"} onClick={() => void redeemSubscription()}>{busy ? "兑换中…" : "兑换 Pro"}</button></footer>
        </div>}

        {dialog === "training" && <div className="dialog-form account-form">
          <p className="dialog-hint">从当前整局报告的明显失误生成任务。任务只保存在本机，不会上传棋谱正文。</p>
          {trainingTasks.length === 0 ? <p className="dialog-hint">还没有训练任务。先生成整局报告，再创建任务。</p> : <div className="full dialog-book-list">{trainingTasks.map((task) => <label className="check-row" key={task.id}><input type="checkbox" checked={!!task.completedAt} disabled={busy} onChange={(event) => void onCompleteTraining(task.id, event.target.checked)}/><span><strong>{task.title}</strong><small>{task.detail}</small></span></label>)}</div>}
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <footer><button onClick={close} disabled={busy}>关闭</button><button className="primary" disabled={busy} onClick={() => void onGenerateTraining()}>{busy ? "生成中…" : "从报告生成任务"}</button></footer>
        </div>}

        {dialog === "unbind" && !unbindCompleted && <div className="dialog-form account-form">
          <p className="dialog-warning">此操作会清除本机的棋谱、着法、待同步记录、分析缓存、复盘和训练任务，且无法恢复。</p>
          <p className="dialog-hint">云端账号和已同步棋谱不会删除；引擎设置、皮肤与应用偏好会保留。</p>
          <label className="full"><span>确认文本</span><input autoComplete="off" placeholder="请输入 解除绑定" value={unbindConfirmation} onChange={(event) => { setEnginePickerError(""); setUnbindConfirmation(event.target.value); }}/></label>
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <footer><button onClick={close} disabled={busy}>取消</button><button className="danger" disabled={busy || unbindConfirmation !== "解除绑定"} onClick={() => void unbindSync()}>{busy ? "清除中…" : "解除并清空本机数据"}</button></footer>
        </div>}

        {dialog === "unbind" && unbindCompleted && <div className="dialog-form account-form">
          <p className="dialog-success" role="status">本机棋谱库已解除绑定并清空</p>
          <p className="dialog-hint">现在可以注册或登录另一个同步账号。云端账号与已同步的棋谱未被删除。</p>
          <footer><button className="primary" onClick={close}>完成</button></footer>
        </div>}

        {(dialog === "register" || dialog === "login") && <div className="dialog-form account-form">
          <p className="dialog-hint">{dialog === "register" ? "注册后当前本地棋谱库将永久绑定该账号。" : account.email ? `当前棋谱库绑定：${account.email}` : "登录后会绑定当前本地棋谱库。"}</p>
          <label className="full"><span>邮箱</span><input type="email" autoComplete="username" placeholder="name@example.com" disabled={!!account.email} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
          <label className="full"><span>密码</span><input type="password" minLength={8} autoComplete={dialog === "register" ? "new-password" : "current-password"} placeholder="至少 8 个字符" value={password} onChange={(event) => setPassword(event.target.value)}/></label>
          <p className="dialog-hint">邮箱和至少 8 个字符的密码填写完成后，注册按钮即可使用。</p>
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <footer><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !email.trim() || password.length < 8} onClick={() => void authenticate(dialog)}>{dialog === "register" ? <UserPlus size={14}/> : <LogIn size={14}/>} {busy ? "请稍候…" : dialog === "register" ? "注册并登录" : "登录"}</button></footer>
        </div>}
      </section>
    </div>
  );
}
