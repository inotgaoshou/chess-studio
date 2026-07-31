import { useEffect, useState } from "react";
import { FolderOpen, LogIn, Save, Settings2, UserPlus, X } from "lucide-react";
import { BUILTIN_ENGINE_PATH, type DesktopPreferencesDto, type SubscriptionDto, type SyncAccountDto, type TrainingTaskDto } from "./platform";

export type DesktopDialog = "engine" | "syncSettings" | "register" | "login" | "subscription" | "training" | null;

type Props = {
  dialog: DesktopDialog;
  preferences: DesktopPreferencesDto;
  account: SyncAccountDto;
  subscription?: SubscriptionDto;
  trainingTasks: TrainingTaskDto[];
  busy: boolean;
  onClose(): void;
  onChooseEngine(currentPath: string): Promise<string | undefined>;
  onSaveEngine(preferences: DesktopPreferencesDto): Promise<void>;
  onSaveSync(serverUrl: string): Promise<void>;
  onAuthenticate(mode: "register" | "login", email: string, password: string): Promise<void>;
  onRedeemSubscription(code: string): Promise<void>;
  onGenerateTraining(): Promise<void>;
  onCompleteTraining(taskId: string, completed: boolean): Promise<void>;
};

function engineInputValue(path: string) {
  return path === BUILTIN_ENGINE_PATH ? "内置 Pikafish（随应用安装，推荐）" : path;
}

export function DesktopDialogs({ dialog, preferences, account, subscription, trainingTasks, busy, onClose, onChooseEngine, onSaveEngine, onSaveSync, onAuthenticate, onRedeemSubscription, onGenerateTraining, onCompleteTraining }: Props) {
  const [draft, setDraft] = useState(preferences);
  const [email, setEmail] = useState(account.email ?? "");
  const [password, setPassword] = useState("");
  const [redemptionCode, setRedemptionCode] = useState("");
  const [enginePickerBusy, setEnginePickerBusy] = useState(false);
  const [enginePickerError, setEnginePickerError] = useState("");

  useEffect(() => {
    if (!dialog) {
      setPassword("");
      setRedemptionCode("");
      return;
    }
    setDraft(preferences);
    setEmail(account.email ?? "");
    setPassword("");
    setRedemptionCode("");
    setEnginePickerBusy(false);
    setEnginePickerError("");
  }, [account.email, dialog, preferences]);

  if (!dialog) return null;

  function close() {
    setPassword("");
    onClose();
  }

  async function authenticate(mode: "register" | "login") {
    try {
      await onAuthenticate(mode, email, password);
    } finally {
      setPassword("");
    }
  }

  async function chooseEngine() {
    setEnginePickerBusy(true);
    setEnginePickerError("");
    try {
      const path = await onChooseEngine(draft.enginePath.trim());
      if (path) setDraft((current) => ({ ...current, enginePath: path }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnginePickerError(`选择引擎文件失败：${message}`);
    } finally {
      setEnginePickerBusy(false);
    }
  }

  async function saveEngine() {
    setEnginePickerError("");
    try {
      await onSaveEngine(draft);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnginePickerError(`保存失败：${message}`);
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

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={dialog === "engine" ? "引擎设置" : dialog === "syncSettings" ? "同步设置" : dialog === "subscription" ? "Pro 权益" : dialog === "training" ? "训练任务" : dialog === "register" ? "注册同步账号" : "登录同步账号"}>
        <header>
          <div>{dialog === "register" ? <UserPlus size={17}/> : dialog === "login" ? <LogIn size={17}/> : <Settings2 size={17}/>}<strong>{dialog === "engine" ? "引擎设置" : dialog === "syncSettings" ? "同步设置" : dialog === "subscription" ? "Pro 权益" : dialog === "training" ? "训练任务" : dialog === "register" ? "注册同步账号" : "登录同步账号"}</strong></div>
          <button className="tool-button" title="关闭" disabled={busy} onClick={close}><X size={16}/></button>
        </header>

        {dialog === "engine" && <div className="dialog-form engine-settings-form">
          <label className="full"><span>引擎可执行文件</span><div className="dialog-input-action"><input value={engineInputValue(draft.enginePath)} readOnly={draft.enginePath === BUILTIN_ENGINE_PATH} placeholder="留空后可选择外部 Pikafish" onChange={(event) => { setEnginePickerError(""); setDraft({ ...draft, enginePath: event.target.value }); }}/><button type="button" title="使用安装包内置 Pikafish" disabled={busy || enginePickerBusy} onClick={() => { setEnginePickerError(""); setDraft({ ...draft, enginePath: BUILTIN_ENGINE_PATH }); }}>内置</button><button type="button" title="选择外部引擎文件" disabled={busy || enginePickerBusy} onClick={() => void chooseEngine()}><FolderOpen size={15}/></button></div></label>
          {draft.enginePath === BUILTIN_ENGINE_PATH && <p className="dialog-hint full">当前使用安装包内置 Pikafish。正式安装后会从 App 资源目录自动定位，不依赖本机绝对路径。</p>}
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <label><span>线程</span><input type="number" min={1} max={64} value={draft.threads} onChange={(event) => setDraft({ ...draft, threads: Number(event.target.value) })}/></label>
          <label><span>Hash (MB)</span><input type="number" min={16} max={4096} step={16} value={draft.hashMb} onChange={(event) => setDraft({ ...draft, hashMb: Number(event.target.value) })}/></label>
          <label><span>MultiPV</span><input type="number" min={1} max={10} value={draft.multipv} onChange={(event) => setDraft({ ...draft, multipv: Number(event.target.value) })}/></label>
          <label><span>搜索模式</span><select value={draft.searchMode} onChange={(event) => setDraft({ ...draft, searchMode: event.target.value as DesktopPreferencesDto["searchMode"] })}><option value="time">固定时间</option><option value="depth">固定深度</option><option value="nodes">固定节点</option><option value="infinite">持续分析</option></select></label>
          <label><span>搜索限制</span><input type="number" disabled={draft.searchMode === "infinite"} min={draft.searchMode === "depth" ? 1 : draft.searchMode === "nodes" ? 1000 : 100} max={draft.searchMode === "depth" ? 100 : draft.searchMode === "nodes" ? 100000000 : 30000} value={draft.searchValue} onChange={(event) => setDraft({ ...draft, searchValue: Number(event.target.value) })}/></label>
          <label><span>整局复盘深度</span><input type="number" min={8} max={40} value={draft.reportDepth} onChange={(event) => setDraft({ ...draft, reportDepth: Number(event.target.value) })}/></label>
          <label><span>每步时间 (ms)</span><input type="number" min={100} max={30000} step={100} value={draft.moveTimeMs} onChange={(event) => setDraft({ ...draft, moveTimeMs: Number(event.target.value) })}/></label>
          <label className="check-row"><input type="checkbox" checked={draft.ponder} onChange={(event) => setDraft({ ...draft, ponder: event.target.checked })}/><span>后台思考</span></label>
          <label className="check-row"><input type="checkbox" checked={draft.autoAnalyze} onChange={(event) => setDraft({ ...draft, autoAnalyze: event.target.checked })}/><span>每步自动分析</span></label>
          <label><span>棋盘皮肤</span><select value={draft.boardSkin} onChange={(event) => setDraft({ ...draft, boardSkin: event.target.value as DesktopPreferencesDto["boardSkin"] })}><option value="original">默认棋盘</option><option value="classic">暖木立体</option><option value="neon">霓虹星空</option><option value="jade">翡翠庭院</option><option value="imperial">朱墙宫阙</option></select></label>
          <label><span>棋子皮肤</span><select value={draft.pieceSkin} onChange={(event) => setDraft({ ...draft, pieceSkin: event.target.value as DesktopPreferencesDto["pieceSkin"] })}><option value="original">默认棋子</option><option value="classic">暖木立体</option><option value="neon">霓虹发光</option><option value="jade">翡翠琉璃</option><option value="imperial">鎏金宫廷</option></select></label>
          <label className="check-row"><input type="checkbox" checked={draft.cloudBookEnabled ?? false} onChange={(event) => setDraft({ ...draft, cloudBookEnabled: event.target.checked })}/><span>启用 ChessDB 云开局库</span></label>
          <label className="full"><span>云库地址</span><input value={draft.cloudBookUrl ?? "https://www.chessdb.cn/chessdb.php"} onChange={(event) => setDraft({ ...draft, cloudBookUrl: event.target.value })}/></label>
          <p className="dialog-hint full">开启后会向该地址发送当前 FEN，仅用于查询候选着法；网络不可用不会影响本地棋谱和引擎。</p>
          {!!draft.xqbBookPaths?.length && <div className="full dialog-book-list"><span>本地大师开局库</span>{draft.xqbBookPaths.map((path) => <label className="check-row" key={path}><input type="checkbox" checked={!draft.disabledXqbBookPaths?.includes(path)} onChange={(event) => setDraft({ ...draft, disabledXqbBookPaths: event.target.checked ? (draft.disabledXqbBookPaths ?? []).filter((value) => value !== path) : [...(draft.disabledXqbBookPaths ?? []), path] })}/><span>{path.split(/[\\/]/).at(-1)}</span></label>)}</div>}
          <footer><button onClick={close} disabled={busy || enginePickerBusy}>取消</button><button className="primary" disabled={busy || enginePickerBusy || !draft.enginePath.trim()} onClick={() => void saveEngine()}><Save size={14}/>{busy ? "检测中…" : enginePickerBusy ? "选择中…" : "检测并保存"}</button></footer>
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

        {(dialog === "register" || dialog === "login") && <div className="dialog-form account-form">
          <p className="dialog-hint">{dialog === "register" ? "注册后当前本地棋谱库将永久绑定该账号。" : account.email ? `当前棋谱库绑定：${account.email}` : "登录后会绑定当前本地棋谱库。"}</p>
          <label className="full"><span>邮箱</span><input type="email" autoComplete="username" disabled={!!account.email} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
          <label className="full"><span>密码</span><input type="password" autoComplete={dialog === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)}/></label>
          <footer><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !email.trim() || password.length < 10} onClick={() => void authenticate(dialog)}>{dialog === "register" ? <UserPlus size={14}/> : <LogIn size={14}/>} {busy ? "请稍候…" : dialog === "register" ? "注册并登录" : "登录"}</button></footer>
        </div>}
      </section>
    </div>
  );
}
