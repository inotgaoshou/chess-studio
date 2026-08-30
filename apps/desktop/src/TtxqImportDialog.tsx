import { useEffect, useState } from "react";
import { CheckCircle2, Database, Download, ExternalLink, FileWarning, FolderPlus, LogOut, RefreshCw, Trash2, X } from "lucide-react";
import type { LibraryFolder, TtxqDiagnosticSample, TtxqGamePreview, TtxqSyncProgress } from "./platform";

type Props = {
  progress: TtxqSyncProgress;
  preview: TtxqGamePreview[];
  diagnostics: TtxqDiagnosticSample[];
  folders: LibraryFolder[];
  targetFolder: string;
  busy: boolean;
  onClose(): void;
  onTargetFolderChange(folder: string): void;
  onCreateFolder(folder: string): void;
  onAuthorize(): void;
  onCollect(): void;
  onImport(): void;
  onDisconnect(): void;
  onShowDiagnostics(): void;
  onClearDiagnostics(): void;
};

const TTXQ_FOLDER = "天天象棋备份";
const TTXQ_LABEL = "天天象棋";

function stateLabel(state: TtxqSyncProgress["state"]) {
  if (state === "ready") return "可导入";
  if (state === "importing") return "导入中";
  if (state === "complete") return "已完成";
  if (state === "partial") return "部分完成";
  if (state === "reading") return "读取中";
  if (state === "error") return "读取失败";
  if (state === "authorizing") return "等待登录";
  return "未连接";
}

function normalizeFolderPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

function folderDisplayPath(path: string) {
  if (path === TTXQ_FOLDER) return TTXQ_LABEL;
  if (path.startsWith(`${TTXQ_FOLDER}/`)) return `${TTXQ_LABEL}/${path.slice(TTXQ_FOLDER.length + 1)}`;
  return path;
}

function folderOptionLabel(path: string) {
  const display = folderDisplayPath(path);
  const parts = display.split("/").filter(Boolean);
  if (parts.length <= 1) return display;
  return `${"　".repeat(parts.length - 1)}${parts.at(-1)}`;
}

function resultLabel(result: string) {
  if (result === "1-0") return "红胜";
  if (result === "0-1") return "黑胜";
  if (result === "1/2-1/2") return "和棋";
  return result;
}

function roundLabel(round: string) {
  const value = round.trim();
  if (!value) return "";
  if (/回合$/.test(value)) return value;
  if (/^\d+$/.test(value)) return `${value} 回合`;
  if (/^第.+轮$/.test(value)) return value;
  return value;
}

export function TtxqImportDialog({ progress, preview, diagnostics, folders, targetFolder, busy, onClose, onTargetFolderChange, onCreateFolder, onAuthorize, onCollect, onImport, onDisconnect, onShowDiagnostics, onClearDiagnostics }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  const connected = progress.state !== "disconnected";
  const validPreviewCount = preview.filter((game) => game.valid).length;
  const canImport = !busy && progress.state === "ready" && validPreviewCount > 0;
  const hasResult = progress.completed > 0;
  const isReading = progress.state === "reading";
  const isDiscovering = isReading && progress.readPhase === "discovering";
  const isLoadingGame = isReading && progress.readPhase === "loading";
  const importSucceeded = progress.state === "complete" && progress.failed === 0;
  const showDiagnostics = diagnostics.length > 0 && !importSucceeded;
  const readPercent = progress.readTotal > 0 ? Math.round((progress.readCompleted / progress.readTotal) * 100) : 0;
  const [readElapsedSeconds, setReadElapsedSeconds] = useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const normalizedTargetFolder = normalizeFolderPath(targetFolder) || TTXQ_FOLDER;
  const folderOptions = Array.from(new Set([TTXQ_FOLDER, ...folders.map((folder) => folder.name), normalizedTargetFolder].map(normalizeFolderPath).filter(Boolean)))
    .sort((left, right) => folderDisplayPath(left).localeCompare(folderDisplayPath(right), "zh-Hans-CN"));
  const newFolderPath = normalizeFolderPath(`${normalizedTargetFolder}/${newFolderName}`);

  useEffect(() => {
    if (!isReading) {
      setReadElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setReadElapsedSeconds(0);
    const timer = window.setInterval(() => setReadElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [isReading]);

  return <div className="report-dialog-backdrop ttxq-import-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className="ttxq-import-dialog" role="dialog" aria-modal="true" aria-label="天天象棋棋谱导入">
      <header>
        <div>
          <Database size={19}/>
          <span>
            <strong>天天象棋棋谱导入</strong>
            <small>自动读取当前授权账号可访问的最近对局</small>
          </span>
        </div>
        <button type="button" className="tool-button" title="关闭天天象棋棋谱导入" aria-label="关闭天天象棋棋谱导入" disabled={busy} onClick={onClose}><X size={16}/></button>
      </header>

      <div className="ttxq-import-content">
        <section className="ttxq-import-status" aria-live="polite">
          <div><span>同步状态</span><strong className={progress.state}>{stateLabel(progress.state)}</strong></div>
          <p>{progress.message}</p>
          {isReading && <section className="ttxq-import-reading-progress" aria-label="读取进度">
            <header><strong>{isDiscovering ? "扫描已加载列表" : isLoadingGame ? "等待棋谱加载" : "读取棋谱走法"}</strong><span>{isDiscovering ? `已发现 ${progress.readTotal} 盘` : isLoadingGame ? `第 ${progress.readCurrent ?? 0} / ${progress.readTotal} 盘` : `${readPercent}%`}</span></header>
            {isDiscovering
              ? <i aria-label="正在扫描已加载棋谱"/>
              : progress.readTotal > 0
              ? <progress value={progress.readCompleted} max={progress.readTotal} aria-label="读取进度"/>
              : <i aria-label="正在发现已加载棋谱"/>}
            <p>{isDiscovering
              ? <>正在检查已加载的最近对局 · 已处理 <b>{progress.readScanned ?? 0}</b> 个数据项 · 已等待 <b>{readElapsedSeconds}</b> 秒{readElapsedSeconds >= 12 && <>。若长时间不变，请在授权窗口打开“最近对局”，等列表显示后重新读取。</>}</>
              : isLoadingGame
              ? <>正在确认第 <b>{progress.readCurrent ?? 0}</b> 盘走法已加载 · 已等待 <b>{readElapsedSeconds}</b> 秒。首盘最多等待 12 秒，其余每盘最多约 3 秒；超时只跳过该盘并保留诊断样本。</>
              : progress.readTotal > 0
              ? <>发现 <b>{progress.readTotal}</b> 盘 · 已读取 <b>{progress.readCompleted}</b> / {progress.readTotal} · 失败 <b>{progress.readFailed}</b></>
              : "正在检查天天象棋网页中已加载的最近对局…"}</p>
          </section>}
          {progress.loaded > 0 && <p className="ttxq-import-count">已加载 <b>{progress.loaded}</b> 盘{hasResult && <> · 导入 <b>{progress.imported}</b> · 跳过 <b>{progress.skipped}</b> · 失败 <b>{progress.failed}</b></>}</p>}
          {importSucceeded && <p className="ttxq-import-success" role="status"><CheckCircle2 size={16}/>已成功导入 {progress.imported} 盘棋谱，已保存到本地棋谱库。</p>}
        </section>

        <section className="ttxq-import-folder" aria-label="导入目标目录">
          <label><span>导入到</span>
            <select value={normalizedTargetFolder} onChange={(event) => onTargetFolderChange(event.target.value)} disabled={busy}>
              {folderOptions.map((folder) => <option key={folder} value={folder}>{folderOptionLabel(folder)}</option>)}
            </select>
          </label>
          <label><span>新建子目录</span><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={`在 ${folderDisplayPath(normalizedTargetFolder)} 下创建`} disabled={busy}/></label>
          <button type="button" disabled={busy || !newFolderPath} onClick={() => { onCreateFolder(newFolderPath); setNewFolderName(""); }}><FolderPlus size={14}/>创建</button>
          <small>当前导入目录：{folderDisplayPath(normalizedTargetFolder)}</small>
        </section>

        {preview.length > 0 && <section className="ttxq-import-preview" aria-label="导入预览">
          <header><strong>导入预览 · {preview.length} 盘</strong><span>{validPreviewCount} 盘可导入</span></header>
          <ol>
            {preview.map((game) => <li key={game.qipuId} className={game.valid ? "valid" : "invalid"}>
              <div><strong>{game.title.trim() || `天天象棋 ${game.qipuId}`}</strong><span>{game.valid ? `${game.moveCount} 半回合${game.routeCount > 1 ? ` · 路线 ${game.decodedRouteCount}/${game.routeCount}` : ""}${game.variationNodeCount ? ` · ${game.variationNodeCount} 个变招节点` : ""}` : `${game.routeCount > 1 ? `路线 ${game.decodedRouteCount}/${game.routeCount} · ` : ""}格式待处理`}</span></div>
              <p>{[game.red, game.black].filter(Boolean).join(" vs ") || game.event || "自建/收藏棋谱"}{game.result ? ` · ${resultLabel(game.result)}` : ""}</p>
              {(game.event || game.date || game.round || game.playedAt || game.duration) && <small>{[game.event, game.date, roundLabel(game.round), game.playedAt, game.duration && `用时 ${game.duration}`].filter(Boolean).join(" · ")}</small>}
              {game.valid && game.diagnostic && <small>{game.diagnostic}</small>}
              {!game.valid && <em>{game.error || "走法格式不兼容"}</em>}
              {!game.valid && game.diagnostic && <small>{game.diagnostic}</small>}
            </li>)}
          </ol>
        </section>}

        {showDiagnostics && <section className="ttxq-import-diagnostics" aria-label="兼容性诊断">
          <header>
            <span><FileWarning size={14}/><strong>兼容性诊断 · {diagnostics.length}</strong></span>
            <div>
              <button type="button" onClick={() => { onShowDiagnostics(); setDiagnosticsOpen((open) => !open); }}>{diagnosticsOpen ? "收起" : "查看原因"}</button>
              <button type="button" className="danger" onClick={onClearDiagnostics}><Trash2 size={13}/>清除</button>
            </div>
          </header>
          {diagnosticsOpen && <ol>
            {diagnostics.map((sample) => <li key={sample.id}>
              <strong>{sample.qipuId}</strong>
              <small>{sample.fieldPath || "未发现走法字段"} · {sample.valueType || "未知"} · {sample.valueLength} 字符</small>
              <em>{sample.error}</em>
            </li>)}
          </ol>}
        </section>}

        <ol className="ttxq-import-steps">
          <li>打开授权窗口后，在天天象棋网页中自行登录。</li>
          <li>进入“最近对局”页面，保持授权窗口打开。</li>
          <li>回到这里开始读取；应用会自动加载可访问的历史棋谱。</li>
        </ol>

        <div className="ttxq-import-actions">
          <button type="button" className="primary" disabled={busy} onClick={onAuthorize}><ExternalLink size={15}/>{connected ? "打开授权窗口" : "登录天天象棋"}</button>
          <button type="button" disabled={busy || !connected || progress.state === "reading"} onClick={onCollect}><RefreshCw className={progress.state === "reading" ? "spin" : undefined} size={15}/>{progress.state === "reading" ? "读取中…" : "读取已加载棋谱"}</button>
          <button type="button" className="primary" disabled={!canImport} onClick={onImport}><Download size={15}/>{busy ? "导入中…" : "导入全部"}</button>
        </div>
      </div>

      <footer>
        <small>重复快照会自动跳过；线上棋谱变化会保留为新的本地修订。</small>
        {connected && <button type="button" className="danger" disabled={busy} onClick={onDisconnect}><LogOut size={14}/>断开天天象棋</button>}
      </footer>
    </section>
  </div>;
}
