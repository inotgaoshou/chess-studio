import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CloudUpload, Copy, FilePenLine, Folder, FolderInput, FolderPlus, Plus, Search, Trash2, X } from "lucide-react";
import type { LocalManualFolder, LocalManualGame } from "./types";
import { isProviderMirrorGame, TTXQ_MIRROR_FOLDER } from "./providerMirrors";
import { manualDate, manualInFolder, manualMatchesQuery, manualResult } from "./manualLibrary";

const readonlyFolder = (path: string) => path === TTXQ_MIRROR_FOLDER || path.startsWith(`${TTXQ_MIRROR_FOLDER}/`);
export function ManualLibraryDialog({ games, folders, folder, query, selectedId, syncing, syncMessage, onFolder, onQuery, onClose, onNew, onOpen, onEdit, onCopy, onSync, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveGames, onDeleteGames }: {
  games: LocalManualGame[]; folders: LocalManualFolder[]; folder: string; query: string; selectedId?: string;
  syncing: boolean; syncMessage: string;
  onFolder(path: string): void; onQuery(query: string): void; onClose(): void;
  onNew(): Promise<void>; onOpen(game: LocalManualGame): Promise<void>; onEdit(game: LocalManualGame): Promise<void>;
  onCopy(game: LocalManualGame): Promise<void>; onSync(): Promise<void>;
  onCreateFolder(): void; onRenameFolder(): void; onDeleteFolder(): void;
  onMoveGames(games: LocalManualGame[], folder: string): Promise<void>; onDeleteGames(games: LocalManualGame[]): Promise<void>;
}) {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [unfiledOnly, setUnfiledOnly] = useState(false);
  const [pending, setPending] = useState<{kind: "move" | "delete"; games: LocalManualGame[]}>();
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const lock = useRef(false);
  const paths = useMemo(() => {
    const all = new Set<string>();
    for (const path of [...folders.map(item => item.path), ...games.map(item => item.folderPath || "")]) {
      const parts = path.split("/").filter(Boolean);
      parts.forEach((_, index) => all.add(parts.slice(0, index + 1).join("/")));
    }
    return [...all].sort((a,b) => a.localeCompare(b,"zh-Hans-CN"));
  }, [folders,games]);
  const visible = useMemo(() => games.filter(game => (!favoritesOnly || game.favorite) && (!unfiledOnly || !game.folderPath) && manualInFolder(game,folder,includeDescendants) && manualMatchesQuery(game,query)),[games,folder,query,favoritesOnly,unfiledOnly,includeDescendants]);
  const pages = Math.max(1,Math.ceil(visible.length/30));
  const currentPage = Math.min(page,pages);
  const pageGames = visible.slice((currentPage-1)*30,currentPage*30);
  const editable = pageGames.filter(game=>!isProviderMirrorGame(game));
  const chosen = visible.filter(game=>selected.has(game.id)&&!isProviderMirrorGame(game));
  useEffect(()=>{setPage(1);setSelected(new Set());},[folder,query,favoritesOnly,unfiledOnly,includeDescendants]);
  useEffect(()=>{if(folder)setUnfiledOnly(false);},[folder]);
  useEffect(()=>{
    const close=(event:KeyboardEvent)=>{if(event.key!=="Escape"||event.isComposing||lock.current)return;event.stopPropagation();if(pending)setPending(undefined);else onClose();};
    window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);
  },[pending,onClose]);
  async function run(action:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError("");
    try {await action();} catch(reason){setError(reason instanceof Error?reason.message:"操作失败，请重试。");}
    finally {lock.current=false;setBusy(false);}
  }
  const request=(kind:"move"|"delete",items:LocalManualGame[])=>{setError("");setDestination(items[0]?.folderPath||"");setPending({kind,games:items});};
  const toggle=(id:string)=>setSelected(old=>{const next=new Set(old);if(next.has(id))next.delete(id);else next.add(id);return next;});
  const chooseFolder=(path:string,unfiled=false)=>{setUnfiledOnly(unfiled);onFolder(path);setDirectoryOpen(false);};
  const folderLabel = unfiledOnly ? "未分类" : folder || "全部本地";
  return <section className="personal-manual-library" role="dialog" aria-modal="true" aria-label="我的棋谱">
    <header className="personal-library-header"><button type="button" aria-label="返回" disabled={busy} onClick={onClose}><ChevronLeft/></button><div><strong>我的棋谱</strong><small>本地棋谱库 · {games.length} 盘</small></div><button type="button" className="primary" disabled={busy} onClick={()=>void run(async()=>{setCreating(true);try{await onNew();}finally{setCreating(false);}})}><Plus/>{creating?"正在新建…":"新建棋谱"}</button></header>
    <div className="personal-library-body">
      <aside className={directoryOpen?"directories expanded":"directories"} aria-label="棋谱目录">
        <button type="button" className="directory-toggle" aria-expanded={directoryOpen} onClick={()=>setDirectoryOpen(!directoryOpen)}><Folder/><span>{folderLabel}</span><ChevronDown/></button>
        <nav><button type="button" className={!folder&&!unfiledOnly?"active":""} onClick={()=>chooseFolder("")}><Folder/><span>全部本地</span><small>{games.length}</small></button>
          <button type="button" aria-label="未分类" className={unfiledOnly?"active":""} onClick={()=>chooseFolder("",true)}><Folder/><span>未分类</span><small>{games.filter(game=>!game.folderPath).length}</small></button>
          {paths.filter(path=>!path.split("/").some((_,index,parts)=>index<parts.length-1&&collapsed.has(parts.slice(0,index+1).join("/")))).map(path=>{
            const children=paths.some(item=>item.startsWith(`${path}/`));
            return <div key={path} className="personal-directory-row" style={{paddingLeft:`${(path.split("/").length-1)*12}px`}}>
              {children?<button type="button" aria-label={`${collapsed.has(path)?"展开":"折叠"}目录：${path}`} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(path))next.delete(path);else next.add(path);return next;})}>{collapsed.has(path)?<ChevronRight/>:<ChevronDown/>}</button>:<span className="directory-indent"/>}
              <button type="button" className={folder===path?"active":""} aria-label={`目录：${path}`} onClick={()=>chooseFolder(path)}><Folder/><span>{path.split("/").at(-1)}</span><small>{games.filter(game=>manualInFolder(game,path,includeDescendants)).length}</small></button>
            </div>;
          })}
          <button type="button" disabled={readonlyFolder(folder)||busy} onClick={onCreateFolder}><FolderPlus/>{folder?"新建子目录":"新建目录"}</button>
          {folder&&!readonlyFolder(folder)&&<div className="directory-maintenance"><button type="button" disabled={busy} onClick={onRenameFolder}>重命名</button><button type="button" disabled={busy} onClick={onDeleteFolder}>删除目录</button></div>}
        </nav>
      </aside>
      <main className="personal-library-main">
        <div className="personal-library-search"><Search/><input aria-label="搜索我的棋谱" placeholder="搜索标题、棋手、赛果、回合或赛事" value={query} onChange={e=>onQuery(e.target.value)}/>{query&&<button type="button" aria-label="清空搜索" onClick={()=>onQuery("")}><X/></button>}</div>
        <div className="personal-library-toolbar"><span>{folderLabel} · {visible.length} 盘</span><button type="button" aria-pressed={favoritesOnly} onClick={()=>setFavoritesOnly(!favoritesOnly)}>{favoritesOnly?"全部棋谱":"收藏"}</button><button type="button" disabled={busy||syncing} onClick={()=>void run(onSync)}><CloudUpload/>{syncing?"同步中":"云同步"}</button></div>
        {folder&&<label className="personal-library-descendants"><input type="checkbox" checked={includeDescendants} onChange={e=>setIncludeDescendants(e.target.checked)}/>包含子目录</label>}
        <div className="personal-library-selection"><button type="button" disabled={!editable.length||busy} onClick={()=>setSelected(old=>{const next=new Set(old),all=editable.every(g=>next.has(g.id));editable.forEach(g=>all?next.delete(g.id):next.add(g.id));return next;})}>{editable.length>0&&editable.every(g=>selected.has(g.id))?"取消全选":"全选当前"}</button><span>已选 {chosen.length} 盘</span><button type="button" disabled={!chosen.length||busy} onClick={()=>request("move",chosen)}><FolderInput/>移动</button><button type="button" className="danger" disabled={!chosen.length||busy} onClick={()=>request("delete",chosen)}><Trash2/>删除</button></div>
        {error&&!pending&&<p role="alert" className="personal-library-error">{error}</p>}
        {syncMessage&&<p className="personal-library-status" role="status">{syncMessage}</p>}
        <div className="personal-library-list" aria-label="棋谱列表">{pageGames.length?pageGames.map(game=>{
          const mirror=isProviderMirrorGame(game),result=manualResult(game);
          return <article key={game.id} className={game.id===selectedId?"current":""}>
            <input type="checkbox" aria-label={`选择：${game.title}`} disabled={mirror||busy} checked={selected.has(game.id)} onChange={()=>toggle(game.id)}/>
            <button type="button" className="personal-library-open" aria-label={`${mirror?"查看":"打开"}棋谱：${game.title}`} disabled={busy} onClick={()=>void run(()=>onOpen(game))}>
              <strong>{game.favorite ? "★ " : ""}{game.title}</strong><small>{game.metadata?.redPlayer||"红方未填写"} · {game.metadata?.blackPlayer||"黑方未填写"}</small>
              <small>{result.score} · {Math.ceil(game.moves.length/2)} 回合 · {manualDate(game)}{game.metadata?.event?` · ${game.metadata.event}`:""}</small>
              <small>所在目录：{game.folderPath||"未分类"}</small>
            </button><em className={`manual-result ${result.tone}`}>{result.label}</em>
            <div className="personal-library-actions">{mirror?<><span>云镜像 · 只读</span><button type="button" disabled={busy} onClick={()=>void run(()=>onCopy(game))}><Copy/>复制到我的棋谱</button></>:<>
              <button type="button" aria-label={`编辑信息：${game.title}`} disabled={busy} onClick={()=>void run(()=>onEdit(game))}><FilePenLine/>编辑信息</button>
              <button type="button" aria-label={`移动：${game.title}`} disabled={busy} onClick={()=>request("move",[game])}><FolderInput/>移动</button>
              <button type="button" className="danger" aria-label={`删除：${game.title}`} disabled={busy} onClick={()=>request("delete",[game])}><Trash2/>删除</button>
            </>}</div>
          </article>;
        }):<div className="personal-library-empty"><Folder/><strong>{query?"没有匹配的棋谱":"这里还没有棋谱"}</strong><p>{query?"试试棋手、赛事或标题，也可以清空搜索。":"点击右上角“新建棋谱”开始录入，或通过云同步下载个人棋谱。"}</p></div>}</div>
        {pages>1&&<nav className="personal-library-pagination" aria-label="棋谱分页"><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
      </main>
    </div>
    {pending&&<div className="personal-library-confirm"><section role="alertdialog" aria-modal="true" aria-label={pending.kind==="move"?"移动棋谱":"删除棋谱"}><h3>{pending.kind==="move"?"移动":"删除"} {pending.games.length} 盘棋谱</h3><p>{pending.games.slice(0,3).map(game=>game.title).join("、")}{pending.games.length>3?"…":""}</p>
      {pending.kind==="move"?<label>目标目录<select value={destination} onChange={e=>setDestination(e.target.value)} disabled={busy}><option value="">未分类</option>{paths.filter(path=>!readonlyFolder(path)).map(path=><option key={path} value={path}>{path}</option>)}</select></label>:<p>删除后无法在本机恢复，请确认已保留需要的棋谱。</p>}
      {error&&<p role="alert" className="personal-library-error">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={()=>{setPending(undefined);setError("");}}>取消</button><button type="button" className={pending.kind==="delete"?"danger":"primary"} disabled={busy} onClick={()=>void run(async()=>{if(pending.kind==="move"){await onMoveGames(pending.games,destination);setUnfiledOnly(!destination);setIncludeDescendants(false);}else await onDeleteGames(pending.games);setSelected(new Set());setPending(undefined);})}>{busy?"处理中…":pending.kind==="move"?"确认移动":"确认删除"}</button></footer>
    </section></div>}
  </section>;
}
