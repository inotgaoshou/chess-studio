import { useEffect, useRef, useState, type CSSProperties } from "react";
import { FolderOpen, LogIn, Minus, Plus, Save, Settings2, UserPlus, X } from "lucide-react";
import { BUILTIN_ENGINE_PATH, DEFAULT_BUILTIN_OPENING_BOOK_ID, FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST, type BuiltinOpeningBookManifestDto, type DesktopPreferencesDto, type EngineProfileDto, type StudySessionDto, type SubscriptionDto, type SyncAccountDto, type TrainingSummaryDto, type TrainingTaskDto } from "./platform";
import {
  DEFAULT_CANDIDATE_LINE_MOVES,
  DEFAULT_CANDIDATE_LINE_ROUNDS,
  DEFAULT_ENGINE_CANDIDATES,
  MAX_CANDIDATE_LINE_MOVES,
  MAX_CANDIDATE_LINE_ROUNDS,
  MIN_CANDIDATE_LINE_MOVES,
  MIN_CANDIDATE_LINE_ROUNDS,
  MIN_ENGINE_CANDIDATES,
} from "./candidatePreview";

export type DesktopDialog = "engine" | "mirrorSettings" | "syncSettings" | "register" | "login" | "subscription" | "training" | "unbind" | null;

type Props = {
  dialog: DesktopDialog;
  preferences: DesktopPreferencesDto;
  account: SyncAccountDto;
  subscription?: SubscriptionDto;
  trainingTasks: TrainingTaskDto[];
  trainingSummary?: TrainingSummaryDto;
  studySessions: StudySessionDto[];
  engineProfiles?: EngineProfileDto[];
  builtinOpeningBookManifest?: BuiltinOpeningBookManifestDto;
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
  onSaveStudy(reflection: string, tags: string[]): Promise<void>;
  onAnalyzeStudy(): Promise<void>;
  onCompleteTraining(taskId: string, completed: boolean): Promise<void>;
  onChooseMirrorRoot?(): Promise<string | undefined>;
  onSaveMirrorPreferences?(enabled: boolean, root: string): Promise<void>;
  onRebuildMirrors?(): Promise<void>;
};

const branchArrowColors = [
  ["#2f80ed", "天蓝（推荐）"],
  ["#f2c94c", "金黄"],
  ["#27ae60", "绿色"],
  ["#9b51e0", "紫色"],
  ["#eb5757", "红色"],
] as const;
const DEFAULT_ANALYSIS_DEPTH = 24;
const DEFAULT_REPORT_DEPTH = 24;
const MIN_ENGINE_DIFFICULTY = 1;
const MAX_ENGINE_DIFFICULTY = 20;
const difficultyDepthRange = { min: 8, max: DEFAULT_ANALYSIS_DEPTH };
const ruleModeOptions: Array<{ value: DesktopPreferencesDto["ruleMode"]; label: string; detail: string }> = [
  { value: "domestic2020", label: "国内规则", detail: "国内中国象棋规则（2020版导向），复杂长杀/长捉先待判" },
  { value: "asianAxf", label: "亚洲规则", detail: "亚洲象棋规则（AXF导向），重复局面更偏自动判和" },
];

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function lowerBoundInteger(value: number, min: number, fallback = min) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.round(value));
}

export function engineDifficultyToDepth(level: number) {
  const difficulty = clampInteger(level, MIN_ENGINE_DIFFICULTY, MAX_ENGINE_DIFFICULTY);
  const ratio = (difficulty - MIN_ENGINE_DIFFICULTY) / (MAX_ENGINE_DIFFICULTY - MIN_ENGINE_DIFFICULTY);
  return clampInteger(
    difficultyDepthRange.min + ratio * (difficultyDepthRange.max - difficultyDepthRange.min),
    difficultyDepthRange.min,
    difficultyDepthRange.max,
  );
}

export function engineDifficultyFromPreferences(preferences: Pick<DesktopPreferencesDto, "searchMode" | "searchValue">) {
  if (preferences.searchMode !== "depth") return MAX_ENGINE_DIFFICULTY;
  const depth = clampInteger(preferences.searchValue, difficultyDepthRange.min, difficultyDepthRange.max);
  const ratio = (depth - difficultyDepthRange.min) / (difficultyDepthRange.max - difficultyDepthRange.min);
  return clampInteger(
    MIN_ENGINE_DIFFICULTY + ratio * (MAX_ENGINE_DIFFICULTY - MIN_ENGINE_DIFFICULTY),
    MIN_ENGINE_DIFFICULTY,
    MAX_ENGINE_DIFFICULTY,
  );
}

function applyEngineDifficulty(preferences: DesktopPreferencesDto, level: number): DesktopPreferencesDto {
  const searchValue = engineDifficultyToDepth(level);
  return {
    ...preferences,
    searchMode: "depth",
    searchValue,
    reportDepth: Math.min(DEFAULT_REPORT_DEPTH, searchValue),
  };
}

function stepPreference(value: number, step: number, min: number, max: number) {
  return clampInteger(value + step, min, max);
}

function sanitizeEnginePreferences(preferences: DesktopPreferencesDto): DesktopPreferencesDto {
  const legacyAnalysisDefaults = matchesLegacySearchDefaults(preferences)
    || (preferences.searchMode === "depth" && (preferences.searchValue === 30 || preferences.searchValue === 26));
  const migratedSearchDefaults = matchesLegacySearchDefaults(preferences)
    ? { searchMode: "depth" as const, searchValue: DEFAULT_ANALYSIS_DEPTH }
    : preferences.searchMode === "depth" && (preferences.searchValue === 30 || preferences.searchValue === 26)
      ? { searchMode: "depth" as const, searchValue: DEFAULT_ANALYSIS_DEPTH }
      : {};
  const multipv = preferences.multipv < MIN_ENGINE_CANDIDATES
    ? DEFAULT_ENGINE_CANDIDATES
    : preferences.multipv;
  const candidateLineMoves = preferences.candidateLineMoves === 6 || preferences.candidateLineMoves < MIN_CANDIDATE_LINE_MOVES || preferences.candidateLineMoves > MAX_CANDIDATE_LINE_MOVES
    ? DEFAULT_CANDIDATE_LINE_MOVES
    : preferences.candidateLineMoves;
  const migrated = {
    ...preferences,
    ...migratedSearchDefaults,
    autoAnalyze: legacyAnalysisDefaults && preferences.autoAnalyze ? false : preferences.autoAnalyze,
    enginePath: BUILTIN_ENGINE_PATH,
    activeEngineId: undefined,
    analysisEngineMode: "single" as const,
    multipv,
    parallelEngineIds: [],
    parallelEnginePaths: [],
    linkConfidenceThreshold: preferences.linkConfidenceThreshold === 70 ? 55 : preferences.linkConfidenceThreshold,
    candidateLineMoves,
    reportDepth: preferences.reportDepth === 30 || preferences.reportDepth === 26 ? DEFAULT_REPORT_DEPTH : preferences.reportDepth,
    builtinOpeningBookEnabled: preferences.builtinOpeningBookEnabled ?? true,
    activeBuiltinOpeningBookId: preferences.activeBuiltinOpeningBookId || DEFAULT_BUILTIN_OPENING_BOOK_ID,
  };
  return {
    ...migrated,
    threads: clampInteger(migrated.threads, 1, 64),
    hashMb: clampInteger(migrated.hashMb, 16, 4096),
    multipv: lowerBoundInteger(migrated.multipv, MIN_ENGINE_CANDIDATES, DEFAULT_ENGINE_CANDIDATES),
    candidateLineMoves: clampInteger(migrated.candidateLineMoves, MIN_CANDIDATE_LINE_MOVES, MAX_CANDIDATE_LINE_MOVES),
    searchValue: migrated.searchMode === "infinite"
      ? migrated.searchValue
      : clampInteger(
        migrated.searchValue,
        migrated.searchMode === "depth" ? 1 : migrated.searchMode === "nodes" ? 1000 : 100,
        migrated.searchMode === "depth" ? 100 : migrated.searchMode === "nodes" ? 100000000 : 30000,
    ),
    reportDepth: clampInteger(migrated.reportDepth, 8, 40),
    moveTimeMs: clampInteger(migrated.moveTimeMs, 100, 30000),
    branchArrowColor: branchArrowColors.some(([value]) => value === migrated.branchArrowColor) ? migrated.branchArrowColor : "#2f80ed",
    ruleMode: migrated.ruleMode === "asianAxf" ? "asianAxf" : "domestic2020",
  };
}

function matchesLegacySearchDefaults(preferences: DesktopPreferencesDto) {
  return (preferences.searchMode === "time" || preferences.searchMode === "infinite") && preferences.searchValue === 1500;
}

function engineInputValue(path: string) {
  if (path === BUILTIN_ENGINE_PATH) return "内置 Pikafish（随应用安装，推荐）";
  return "内置 Pikafish（随应用安装，推荐）";
}

function branchArrowColorLabel(value: string) {
  return branchArrowColors.find(([color]) => color === value)?.[1] ?? "天蓝（推荐）";
}

function candidateLineRoundsInputValue(halfMoves: number) {
  if (!Number.isFinite(halfMoves) || halfMoves <= 0) return "";
  return Math.round(halfMoves / 2);
}

function authenticationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /email already registered|邮箱.*已.*注册|\b409\b/i.test(message)
    ? "该邮箱已经注册，请直接登录"
    : message;
}

export function DesktopDialogs({ dialog, preferences, account, subscription, trainingTasks, trainingSummary, studySessions, engineProfiles = [], builtinOpeningBookManifest, busy, onClose, onChooseEngine, onSaveEngine, onSelectEngineProfile, onDeleteEngineProfile, onSaveSync, onUnbindSync, onAuthenticate, onRedeemSubscription, onGenerateTraining, onSaveStudy, onAnalyzeStudy, onCompleteTraining, onChooseMirrorRoot, onSaveMirrorPreferences, onRebuildMirrors }: Props) {
  const [draft, setDraft] = useState(() => sanitizeEnginePreferences(preferences));
  const [email, setEmail] = useState(account.email ?? "");
  const [password, setPassword] = useState("");
  const [redemptionCode, setRedemptionCode] = useState("");
  const [studyReflection, setStudyReflection] = useState("");
  const [studyTags, setStudyTags] = useState("");
  const [unbindConfirmation, setUnbindConfirmation] = useState("");
  const [unbindCompleted, setUnbindCompleted] = useState(false);
  const [enginePickerError, setEnginePickerError] = useState("");
  const [engineSaveError, setEngineSaveError] = useState("");
  const [engineSaveSuccess, setEngineSaveSuccess] = useState("");
  const initializedDialog = useRef<DesktopDialog>(null);
  const branchArrowColor = branchArrowColors.some(([value]) => value === draft.branchArrowColor) ? draft.branchArrowColor : "#2f80ed";
  const currentRuleLabel = ruleModeOptions.find((option) => option.value === draft.ruleMode)?.detail ?? ruleModeOptions[0].detail;
  const engineDifficulty = engineDifficultyFromPreferences(draft);
  const engineDifficultyDepth = engineDifficultyToDepth(engineDifficulty);
  const effectiveBuiltinOpeningBookManifest = builtinOpeningBookManifest ?? FALLBACK_BUILTIN_OPENING_BOOK_MANIFEST;
  const builtinOpeningBooks = effectiveBuiltinOpeningBookManifest.books;
  const activeBuiltinOpeningBookId = builtinOpeningBooks.some((book) => book.id === draft.activeBuiltinOpeningBookId)
    ? draft.activeBuiltinOpeningBookId
    : effectiveBuiltinOpeningBookManifest.defaultBookId ?? DEFAULT_BUILTIN_OPENING_BOOK_ID;
  const builtinOpeningBookVerified = effectiveBuiltinOpeningBookManifest.vkeyVerification.status === "verified";

  useEffect(() => {
    if (!dialog) {
      initializedDialog.current = null;
      setPassword("");
      setRedemptionCode("");
      return;
    }
    if (initializedDialog.current === dialog) return;
    initializedDialog.current = dialog;
    setDraft(sanitizeEnginePreferences(preferences));
    setEmail(account.email ?? "");
    setPassword("");
    setRedemptionCode("");
    setUnbindConfirmation("");
    setUnbindCompleted(false);
    setEnginePickerError("");
    setEngineSaveError("");
    setEngineSaveSuccess("");
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

  async function saveEngine() {
    setEngineSaveError("");
    setEngineSaveSuccess("");
    try {
      const sanitized = sanitizeEnginePreferences(draft);
      setDraft(sanitized);
      await onSaveEngine(sanitized);
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
          <label className="full"><span>分析引擎</span><input aria-label="分析引擎" value={engineInputValue(BUILTIN_ENGINE_PATH)} readOnly/></label>
          <p className="dialog-hint full">当前版本只使用随应用安装的内置 Pikafish。箭头、整局报告、U10 拆棋、人机和飞刀核验均使用同一引擎；不再加载外部引擎或并行对比档案。</p>
          <section className="engine-simple-settings full" aria-label="皮卡鱼引擎快捷设置">
            <header>
              <div><strong>皮卡鱼引擎</strong><small>快捷项会写入下方专业参数；棋规仍由应用内规则模块裁决</small></div>
              <em>{draft.searchMode === "depth" ? `固定深度 ${draft.searchValue}` : draft.searchMode === "time" ? `固定时间 ${draft.searchValue}ms` : draft.searchMode === "nodes" ? `固定节点 ${draft.searchValue}` : "持续分析"}</em>
            </header>
            <div className="engine-quick-control">
              <span>难度等级</span>
              <button type="button" aria-label="降低难度等级" disabled={engineDifficulty <= MIN_ENGINE_DIFFICULTY} onClick={() => setDraft((current) => applyEngineDifficulty(current, engineDifficultyFromPreferences(current) - 1))}><Minus size={15}/></button>
              <strong>{engineDifficulty}级</strong>
              <button type="button" aria-label="提高难度等级" disabled={engineDifficulty >= MAX_ENGINE_DIFFICULTY} onClick={() => setDraft((current) => applyEngineDifficulty(current, engineDifficultyFromPreferences(current) + 1))}><Plus size={15}/></button>
              <small>对应固定深度 {engineDifficultyDepth}</small>
            </div>
            <div className="engine-quick-control">
              <span>线程数</span>
              <button type="button" aria-label="减少线程数" disabled={draft.threads <= 1} onClick={() => setDraft((current) => ({ ...current, threads: stepPreference(current.threads, -1, 1, 64) }))}><Minus size={15}/></button>
              <strong>{draft.threads}线程</strong>
              <button type="button" aria-label="增加线程数" disabled={draft.threads >= 64} onClick={() => setDraft((current) => ({ ...current, threads: stepPreference(current.threads, 1, 1, 64) }))}><Plus size={15}/></button>
              <small>连线建议 2-4，深算可更高</small>
            </div>
            <div className="engine-quick-control">
              <span>哈希值</span>
              <button type="button" aria-label="减少哈希值" disabled={draft.hashMb <= 16} onClick={() => setDraft((current) => ({ ...current, hashMb: stepPreference(current.hashMb, -16, 16, 4096) }))}><Minus size={15}/></button>
              <strong>{draft.hashMb} MB</strong>
              <button type="button" aria-label="增加哈希值" disabled={draft.hashMb >= 4096} onClick={() => setDraft((current) => ({ ...current, hashMb: stepPreference(current.hashMb, 16, 16, 4096) }))}><Plus size={15}/></button>
              <small>普通分析默认 256 MB</small>
            </div>
            <label className="engine-ponder-switch">
              <span><strong>后台思考</strong><small>人机对弈预测下一手；局面变化会取消旧思考</small></span>
              <input type="checkbox" role="switch" checked={draft.ponder} onChange={(event) => setDraft({ ...draft, ponder: event.target.checked })}/>
            </label>
            <label className="engine-rule-quick">
              <span>棋规</span>
              <select value={draft.ruleMode ?? "domestic2020"} onChange={(event) => setDraft({ ...draft, ruleMode: event.target.value as DesktopPreferencesDto["ruleMode"] })}>{ruleModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              <small>{currentRuleLabel}</small>
            </label>
          </section>
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <label><span>线程</span><input type="number" min={1} max={64} value={draft.threads} onChange={(event) => setDraft({ ...draft, threads: Number(event.target.value) })}/></label>
          <label><span>Hash (MB)</span><input type="number" min={16} max={4096} step={16} value={draft.hashMb} onChange={(event) => setDraft({ ...draft, hashMb: Number(event.target.value) })}/></label>
          <label><span>候选走法（默认2，不限上限）</span><input type="number" min={MIN_ENGINE_CANDIDATES} value={draft.multipv} onChange={(event) => setDraft({ ...draft, multipv: Number(event.target.value) })}/></label>
          <label><span>每种后续（5-8回合）</span><input type="number" min={MIN_CANDIDATE_LINE_ROUNDS} max={MAX_CANDIDATE_LINE_ROUNDS} value={candidateLineRoundsInputValue(draft.candidateLineMoves)} onChange={(event) => setDraft({ ...draft, candidateLineMoves: event.target.value === "" ? 0 : Number(event.target.value) * 2 })}/></label>
          <label><span>搜索模式</span><select value={draft.searchMode} onChange={(event) => setDraft({ ...draft, searchMode: event.target.value as DesktopPreferencesDto["searchMode"] })}><option value="time">固定时间</option><option value="depth">固定深度</option><option value="nodes">固定节点</option><option value="infinite">持续分析</option></select></label>
          <label><span>搜索限制</span><input type="number" disabled={draft.searchMode === "infinite"} min={draft.searchMode === "depth" ? 1 : draft.searchMode === "nodes" ? 1000 : 100} max={draft.searchMode === "depth" ? 100 : draft.searchMode === "nodes" ? 100000000 : 30000} value={draft.searchValue} onChange={(event) => setDraft({ ...draft, searchValue: Number(event.target.value) })}/></label>
          <label><span>整局复盘深度</span><input type="number" min={8} max={40} value={draft.reportDepth} onChange={(event) => setDraft({ ...draft, reportDepth: Number(event.target.value) })}/></label>
          <label><span>棋规模式</span><select value={draft.ruleMode ?? "domestic2020"} onChange={(event) => setDraft({ ...draft, ruleMode: event.target.value as DesktopPreferencesDto["ruleMode"] })}>{ruleModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <p className="dialog-hint full">当前棋规：{currentRuleLabel}。天天象棋式 6/12/18、5 次重复、400 步阈值暂作为后续独立模式参考。</p>
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
          {!!builtinOpeningBooks.length && <div className="full dialog-book-list builtin-opening-book-list">
            <span>内嵌学习开局库</span>
            <label className="check-row"><input type="checkbox" checked={draft.builtinOpeningBookEnabled ?? true} onChange={(event) => setDraft({ ...draft, builtinOpeningBookEnabled: event.target.checked })}/><span>启用内嵌库候选</span></label>
            <label className="dialog-select-row"><span>当前库</span><select value={activeBuiltinOpeningBookId} onChange={(event) => setDraft({ ...draft, activeBuiltinOpeningBookId: event.target.value })}>{builtinOpeningBooks.map((book) => <option key={book.id} value={book.id}>{book.name} · {book.maxCandidatesPerPosition} 候选</option>)}</select></label>
            <p className={builtinOpeningBookVerified ? "dialog-hint" : "dialog-warning"}>{builtinOpeningBookVerified ? "vkey 已验证，可显示候选。" : "vkey 未验证，仅可选择库，暂不显示推荐。"}</p>
          </div>}
          {!!draft.xqbBookPaths?.length && <div className="full dialog-book-list"><span>本地 XQB 开局库</span>{draft.xqbBookPaths.map((path) => <label className="check-row" key={path}><input type="checkbox" checked={!draft.disabledXqbBookPaths?.includes(path)} onChange={(event) => setDraft({ ...draft, disabledXqbBookPaths: event.target.checked ? (draft.disabledXqbBookPaths ?? []).filter((value) => value !== path) : [...(draft.disabledXqbBookPaths ?? []), path] })}/><span>{path.split(/[\\/]/).at(-1)}</span></label>)}</div>}
          {!!draft.eleeyeBookPaths?.length && <div className="full dialog-book-list"><span>ElephantEye 本地学习开局库</span>{draft.eleeyeBookPaths.map((path) => <label className="check-row" key={path}><input type="checkbox" checked={!draft.disabledEleeyeBookPaths?.includes(path)} onChange={(event) => setDraft({ ...draft, disabledEleeyeBookPaths: event.target.checked ? (draft.disabledEleeyeBookPaths ?? []).filter((value) => value !== path) : [...(draft.disabledEleeyeBookPaths ?? []), path] })}/><span>{path.split(/[\\/]/).at(-1)}</span></label>)}</div>}
          {engineSaveError && <p className="dialog-warning full engine-save-error" role="alert">{engineSaveError}</p>}
          {engineSaveSuccess && <p className="dialog-success full engine-save-success" role="status">{engineSaveSuccess}</p>}
          <footer><button onClick={close} disabled={busy}>{engineSaveSuccess ? "关闭" : "取消"}</button><button className="primary" disabled={busy || !draft.enginePath.trim()} onClick={() => void saveEngine()}><Save size={14}/>{busy ? "检测中…" : "检测并保存"}</button></footer>
        </div>}

        {dialog === "syncSettings" && <div className="dialog-form">
          <p className="dialog-hint">本机地址可以使用 HTTP，其他地址必须使用 HTTPS。棋谱库绑定账号后不能更换服务器。</p>
          <label className="full"><span>同步服务地址</span><input disabled={!!account.userId} value={draft.serverUrl} onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })}/></label>
          {account.userId && <p className="dialog-warning">已绑定 {account.email}，服务地址已锁定。</p>}
          <footer><button onClick={close} disabled={busy}>取消</button><button className="primary" disabled={busy || !!account.userId} onClick={() => void onSaveSync(draft.serverUrl)}><Save size={14}/>保存</button></footer>
        </div>}

        {dialog === "mirrorSettings" && <div className="dialog-form account-form">
          <p className="dialog-hint">SQLite 是唯一可编辑主库。归档后的完整 PGN 会单向镜像到 Finder，外部编辑过的 PGN 请按新棋局导入。</p>
          <label className="check-row full"><input type="checkbox" checked={draft.gameMirrorEnabled ?? true} onChange={(event) => setDraft({ ...draft, gameMirrorEnabled: event.target.checked })}/><span><strong>自动镜像归档棋谱</strong><small>合法走子、评论、变例和飞刀标注会更新同一个 PGN；失败不会影响应用内保存。</small></span></label>
          <label className="full"><span>Finder 根目录</span><input readOnly value={draft.gameMirrorRoot || "~/Documents/棋研棋谱（默认）"}/></label>
          <div className="dialog-inline-actions full">
            <button type="button" disabled={busy} onClick={() => void onChooseMirrorRoot?.().then((path) => { if (path) setDraft((current) => ({ ...current, gameMirrorRoot: path })); })}><FolderOpen size={13}/>选择目录</button>
            <button type="button" disabled={busy} onClick={() => setDraft((current) => ({ ...current, gameMirrorRoot: "" }))}>恢复默认目录</button>
          </div>
          <p className="dialog-hint full">目录结构：年份 / 赛事 / 日期_赛事_对手_执方.pgn。首次归档时自动创建；同名不同棋局会追加短 ID，避免覆盖。</p>
          <footer><button onClick={close} disabled={busy}>取消</button><button disabled={busy} onClick={() => void onRebuildMirrors?.()}>{busy ? "处理中…" : "重新生成全部"}</button><button className="primary" disabled={busy} onClick={() => void onSaveMirrorPreferences?.(draft.gameMirrorEnabled ?? true, draft.gameMirrorRoot ?? "") }><Save size={14}/>保存设置</button></footer>
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
          <p className="dialog-hint">总结会绑定当前棋局和当前节点。保存后用本地 Pikafish 核验该局面；课程建议只使用已确认的原则卡。</p>
          <label className="full"><span>本局训练总结</span><textarea value={studyReflection} placeholder="例如：第18回合只考虑抢攻，漏算了对方平炮后的反击；请核验应补防、兑子还是继续进攻。" onChange={(event) => setStudyReflection(event.target.value)}/></label>
          <label className="full"><span>训练标签（逗号分隔）</span><input value={studyTags} placeholder="候选着, 反击, 防守" onChange={(event) => setStudyTags(event.target.value)}/></label>
          <button className="theory-card-create" type="button" disabled={busy || !studyReflection.trim()} onClick={() => void onSaveStudy(studyReflection, studyTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)).then(() => { setStudyReflection(""); setStudyTags(""); })}>保存总结</button>
          {studySessions.length > 0 && <div className="full dialog-book-list">{studySessions.slice(0, 3).map((session) => <div key={session.id}><strong>{session.nodeId ? "当前节点复盘" : "整局复盘"}</strong><small>{session.reflection}{session.tags.length ? ` · ${session.tags.join(" / ")}` : ""}</small></div>)}</div>}
          {!!trainingSummary?.weakSpots.length && <div className="full dialog-book-list" aria-label="薄弱项追踪">{trainingSummary.weakSpots.slice(0, 6).map((spot) => <div key={`${spot.phase}-${spot.tag}`}><strong>{spot.phase} · {spot.tag}</strong><small>出现 {spot.occurrences} 次，未完成 {spot.openTasks}，已完成 {spot.completedTasks}{spot.reviewCards.length ? ` · 复习：${spot.reviewCards.slice(0, 2).map((card) => card.sourceBook ? `${card.sourceBook}${card.sourcePageStart ? ` p.${card.sourcePageStart}` : ""}` : card.title).join("；")}` : ""}</small></div>)}</div>}
          {trainingTasks.length === 0 ? <p className="dialog-hint">还没有训练任务。先生成整局报告，再创建任务。</p> : <div className="full dialog-book-list">{trainingTasks.map((task) => <label className="check-row" key={task.id}><input type="checkbox" checked={!!task.completedAt} disabled={busy} onChange={(event) => void onCompleteTraining(task.id, event.target.checked)}/><span><strong>{task.title}</strong><small>{task.detail}</small></span></label>)}</div>}
          {enginePickerError && <p className="dialog-warning full" role="alert">{enginePickerError}</p>}
          <footer><button onClick={close} disabled={busy}>关闭</button><button disabled={busy || !studyReflection.trim()} onClick={() => void onSaveStudy(studyReflection, studyTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)).then(() => { setStudyReflection(""); setStudyTags(""); })}>保存总结</button><button className="primary" disabled={busy} onClick={() => void onAnalyzeStudy()}>{busy ? "分析中…" : "引擎核验当前局面"}</button><button className="primary" disabled={busy} onClick={() => void onGenerateTraining()}>从报告生成任务</button></footer>
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
