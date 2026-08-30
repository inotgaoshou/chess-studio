import { CheckSquare, ChevronDown, ChevronRight, Database, FilePenLine, FolderOpen, FolderPlus, MoreHorizontal, Search, Share2, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { chessPlatform, type GameMetadata, type GameSummary, type LibraryFolder } from "./platform";

const TTXQ_FOLDER = "天天象棋备份";
const TTXQ_LABEL = "天天象棋";
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
type Filter = "all" | "ttxq" | `folder:${string}`;
type FolderCreateMode = { parent: string };
type FolderManageMode =
  | { action: "rename"; folder: string; name: string }
  | { action: "move"; folder: string; parent: string }
  | { action: "delete"; folder: string };
type FolderTreeNode = { path: string; segment: string; folder?: LibraryFolder; children: FolderTreeNode[]; order: number };

function isTtxqGame(game: GameSummary) {
  return game.sourceFormat === "ttxq-h5" || game.libraryFolder === TTXQ_FOLDER || game.libraryFolder?.startsWith(`${TTXQ_FOLDER}/`);
}

function folderDisplayPath(path: string) {
  if (path === TTXQ_FOLDER) return TTXQ_LABEL;
  if (path.startsWith(`${TTXQ_FOLDER}/`)) return `${TTXQ_LABEL}/${path.slice(TTXQ_FOLDER.length + 1)}`;
  return path;
}

function folderAncestors(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function buildFolderTree(folders: LibraryFolder[]) {
  const nodes = new Map<string, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];
  const ensureNode = (path: string, order: number): FolderTreeNode => {
    const normalized = path.split("/").filter(Boolean).join("/");
    const existing = nodes.get(normalized);
    if (existing) {
      existing.order = Math.min(existing.order, order);
      return existing;
    }
    const segments = normalized.split("/");
    const parentPath = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
    const node: FolderTreeNode = { path: normalized, segment: segments.at(-1) || normalized, children: [], order };
    nodes.set(normalized, node);
    if (parentPath) ensureNode(parentPath, order).children.push(node);
    else roots.push(node);
    return node;
  };
  folders.forEach((folder, index) => {
    const node = ensureNode(folder.name, index);
    node.folder = folder;
  });
  const sortNodes = (items: FolderTreeNode[]) => {
    items.sort((left, right) => left.order - right.order || folderDisplayPath(left.path).localeCompare(folderDisplayPath(right.path), "zh-Hans-CN"));
    items.forEach((item) => sortNodes(item.children));
  };
  sortNodes(roots);
  return roots;
}

function gameTitle(game: GameSummary) {
  const internalTitle = /(?:^Panel_|^preLink|<PrefabLink>|QipuChessBoardControl|ChessBoard(?:Mark|Control|Container))/i.test(game.title);
  if (!internalTitle && game.title.trim()) return game.title;
  const players = [game.red, game.black].filter(Boolean).join(" vs ");
  return players ? `${players} · ${game.result || "对局"}` : "天天象棋对局";
}

function gameDetail(game: GameSummary) {
  const players = [game.red, game.black].filter(Boolean).join(" vs ");
  const source = isTtxqGame(game) ? TTXQ_LABEL : game.libraryFolder ? folderDisplayPath(game.libraryFolder) : "未分类";
  const turns = game.round || (game.moveCount ? `${Math.ceil(game.moveCount / 2)} 回合 · ${game.moveCount} 半回合` : "");
  const result = game.result && game.result !== "*" ? game.result : "";
  return [game.event, players, result, turns, game.playedAt || game.date, game.duration, game.timeControl, source].filter(Boolean).join(" · ");
}

function resultLabel(game: GameSummary) {
  if (!game.result || game.result === "*") return undefined;
  return game.result === "1-0" ? "红胜" : game.result === "0-1" ? "黑胜" : game.result === "1/2-1/2" ? "和棋" : game.result;
}

export function ReviewGameLibrary({ games, folders, onOpen, onShare, onDelete, onChanged, onClose }: {
  games: GameSummary[];
  folders: LibraryFolder[];
  onOpen(gameId: string): void;
  onShare?(gameId: string): Promise<void>;
  onDelete?(gameIds: string[]): Promise<void>;
  onChanged?(): Promise<void>;
  onClose(): void;
}) {
  const ttxqCount = games.filter(isTtxqGame).length;
  const [filter, setFilter] = useState<Filter>(ttxqCount > 0 ? "ttxq" : "all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: GameMetadata }>();
  const [saving, setSaving] = useState(false);
  const [sharingId, setSharingId] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionSuccess, setActionSuccess] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<string[]>();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderCreate, setFolderCreate] = useState<FolderCreateMode | null>(null);
  const [folderManage, setFolderManage] = useState<FolderManageMode | null>(null);
  const [activeFolderActions, setActiveFolderActions] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set([TTXQ_FOLDER]));
  const [sidebarWidth, setSidebarWidth] = useState(236);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(20);
  const [page, setPage] = useState(1);
  const folderMatches = (game: GameSummary, folder: string) => game.libraryFolder === folder || game.libraryFolder?.startsWith(`${folder}/`);
  const folderCount = (folder: string) => games.filter((game) => folderMatches(game, folder)).length;
  const folderOptions = useMemo(() => {
    const names = new Set<string>(folders.map((folder) => folder.name));
    names.add(TTXQ_FOLDER);
    return [...names].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  }, [folders]);
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const ttxqTree = folderTree.find((node) => node.path === TTXQ_FOLDER);
  const nonTtxqFolderTree = folderTree.filter((node) => node.path !== TTXQ_FOLDER);
  const movableFolderOptions = useMemo(() => {
    if (!folderManage || folderManage.action !== "move") return folderOptions;
    return folderOptions.filter((folder) => folder !== folderManage.folder && !folder.startsWith(`${folderManage.folder}/`));
  }, [folderManage, folderOptions]);
  const visibleGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = games.filter((game) => {
      const inFilter = filter === "all"
        || (filter === "ttxq" ? isTtxqGame(game) : folderMatches(game, filter.slice("folder:".length)));
      return inFilter && (!normalizedQuery || `${gameTitle(game)} ${gameDetail(game)} ${game.tags.join(" ")} ${game.event || ""} ${game.round || ""}`.toLocaleLowerCase().includes(normalizedQuery));
    });
    if (filter !== "ttxq") return filtered;
    return filtered
      .map((game, index) => ({ game, index }))
      .sort((left, right) => {
        const leftOrder = left.game.sourceOrder;
        const rightOrder = right.game.sourceOrder;
        if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder;
        if (leftOrder != null) return -1;
        if (rightOrder != null) return 1;
        return left.index - right.index;
      })
      .map(({ game }) => game);
  }, [filter, games, query]);
  const pageCount = Math.max(1, Math.ceil(visibleGames.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pagedGames = visibleGames.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageStart = visibleGames.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(visibleGames.length, safePage * pageSize);
  const deletable = [...selected];
  const visibleDeletable = visibleGames.map((game) => game.id);
  const allVisibleSelected = visibleDeletable.length > 0 && visibleDeletable.every((id) => selected.has(id));

  useEffect(() => {
    setPage(1);
  }, [filter, query, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  function parentForFilter(value: Filter) {
    if (value === "ttxq") return TTXQ_FOLDER;
    if (value.startsWith("folder:")) return value.slice("folder:".length);
    return "";
  }
  function setLibraryFilter(next: Filter) {
    setFilter(next);
    setActiveFolderActions(null);
    const parent = parentForFilter(next);
    if (parent) {
      setExpandedFolders((current) => {
        const nextExpanded = new Set(current);
        folderAncestors(parent).forEach((folder) => nextExpanded.add(folder));
        if (parent === TTXQ_FOLDER || parent.startsWith(`${TTXQ_FOLDER}/`)) nextExpanded.add(TTXQ_FOLDER);
        return nextExpanded;
      });
    }
    setFolderCreate((current) => current ? { ...current, parent: parentForFilter(next) } : current);
  }
  function toggleFolderExpanded(folder: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      next.has(folder) ? next.delete(folder) : next.add(folder);
      return next;
    });
  }
  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const clamp = (width: number) => Math.max(178, Math.min(340, Math.round(width)));
    const onMove = (moveEvent: PointerEvent) => setSidebarWidth(clamp(startWidth + moveEvent.clientX - startX));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("review-library-resizing");
    };
    document.body.classList.add("review-library-resizing");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  }

  function toggle(gameId: string) {
    setSelected((ids) => { const next = new Set(ids); next.has(gameId) ? next.delete(gameId) : next.add(gameId); return next; });
  }
  function toggleVisibleSelection() {
    setSelected((ids) => {
      const next = new Set(ids);
      if (allVisibleSelected) visibleDeletable.forEach((id) => next.delete(id));
      else visibleDeletable.forEach((id) => next.add(id));
      return next;
    });
  }
  function requestDelete(gameIds: string[]) {
    if (onDelete && gameIds.length > 0) {
      setActionError(undefined);
      setActionSuccess(undefined);
      setPendingDelete(gameIds);
    }
  }
  function normalizeFolderPath(path: string) {
    return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  }
  function folderBasename(path: string) {
    return folderDisplayPath(path).split("/").filter(Boolean).pop() || folderDisplayPath(path);
  }
  function folderParent(path: string) {
    const segments = path.split("/").filter(Boolean);
    return segments.length > 1 ? segments.slice(0, -1).join("/") : "";
  }
  function validateFolderPath(path: string) {
    const segments = path.split("/").filter(Boolean);
    if (!path || segments.length === 0) return "请输入目录名称。";
    if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("%"))) return "目录名不能包含 .、.. 或 %。";
    if (segments.length > 6) return "目录层级最多支持 6 层。";
    if (segments.some((segment) => segment.length > 48)) return "单级目录名最多 48 个字符。";
    return undefined;
  }
  function currentFolderParent() {
    return parentForFilter(filter);
  }
  function startCreateFolder() {
    const parent = currentFolderParent();
    setActionError(undefined);
    setActionSuccess(undefined);
    setFolderCreate({ parent });
    setFolderManage(null);
  }
  async function submitCreateFolder(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!folderCreate) return;
    const form = event?.currentTarget;
    const formData = form ? new FormData(form) : undefined;
    const parent = normalizeFolderPath(folderCreate.parent);
    const child = normalizeFolderPath(String(formData?.get("folderName") ?? ""));
    const path = normalizeFolderPath(parent ? `${parent}/${child}` : child);
    const validation = validateFolderPath(path);
    if (validation) {
      setActionError(validation);
      return;
    }
    setCreatingFolder(true);
    try {
      await chessPlatform.createLibraryFolder(path);
      await onChanged?.();
      setLibraryFilter(`folder:${path}`);
      setFolderCreate(null);
      setActionError(undefined);
      setActionSuccess(`已创建目录：${folderDisplayPath(path)}`);
    } catch (error) {
      setActionError(`创建目录失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreatingFolder(false);
    }
  }
  function startFolderRename(folder: string) {
    setActionError(undefined);
    setActionSuccess(undefined);
    setFolderCreate(null);
    setFolderManage({ action: "rename", folder, name: folderBasename(folder) });
  }
  function startFolderMove(folder: string) {
    setActionError(undefined);
    setActionSuccess(undefined);
    setFolderCreate(null);
    setFolderManage({ action: "move", folder, parent: folderParent(folder) });
  }
  function startFolderDelete(folder: string) {
    setActionError(undefined);
    setActionSuccess(undefined);
    setFolderCreate(null);
    setFolderManage({ action: "delete", folder });
  }
  async function submitFolderManage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!folderManage) return;
    setCreatingFolder(true);
    try {
      if (folderManage.action === "delete") {
        await chessPlatform.deleteLibraryFolder(folderManage.folder);
        if (filter === `folder:${folderManage.folder}` || filter.startsWith(`folder:${folderManage.folder}/`)) setLibraryFilter("all");
        setActionSuccess(`已删除目录：${folderDisplayPath(folderManage.folder)}，其中棋谱已移到未分类。`);
      } else {
        const form = event?.currentTarget;
        const formData = form ? new FormData(form) : undefined;
        const basename = folderManage.action === "rename"
          ? normalizeFolderPath(String(formData?.get("folderName") ?? folderManage.name))
          : folderBasename(folderManage.folder);
        const parent = normalizeFolderPath(folderManage.action === "move" ? String(formData?.get("parent") ?? folderManage.parent) : folderParent(folderManage.folder));
        const next = normalizeFolderPath(parent ? `${parent}/${basename}` : basename);
        const validation = validateFolderPath(next);
        if (validation) {
          setActionError(validation);
          return;
        }
        if (next === folderManage.folder) {
          setFolderManage(null);
          setActionSuccess(folderManage.action === "move"
            ? `目录已在“${parent ? folderDisplayPath(parent) : "根目录"}”下，无需移动。`
            : "目录未变化。");
          return;
        }
        if (parent === folderManage.folder || parent.startsWith(`${folderManage.folder}/`)) {
          setActionError("不能把目录移动到它自己的子目录下。");
          return;
        }
        await chessPlatform.renameLibraryFolder(folderManage.folder, next);
        setLibraryFilter(`folder:${next}`);
        setActionSuccess(folderManage.action === "rename" ? `已重命名目录：${folderDisplayPath(next)}` : `已移动目录：${folderDisplayPath(next)}`);
      }
      await onChanged?.();
      setFolderManage(null);
      setActionError(undefined);
    } catch (error) {
      setActionError(`目录操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreatingFolder(false);
    }
  }
  async function confirmDelete() {
    const gameIds = pendingDelete;
    if (!onDelete || !gameIds?.length) return;
    setActionError(undefined);
    setDeleting(true);
    try {
      await onDelete(gameIds);
      setSelected((ids) => { const next = new Set(ids); gameIds.forEach((id) => next.delete(id)); return next; });
      setPendingDelete(undefined);
      setActionError(undefined);
      setActionSuccess(`已从本机删除 ${gameIds.length} 盘棋谱，不会同步到云端。`);
    }
    catch (error) { setActionError(`删除失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setDeleting(false); }
  }
  async function startEdit(gameId: string) {
    try {
      setActionError(undefined);
      setEditing({ id: gameId, value: await chessPlatform.getGameMetadata(gameId) });
    } catch (error) {
      setActionError(`无法读取棋谱信息：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      await chessPlatform.updateGameMetadataForGame(editing.id, editing.value);
      await onChanged?.();
      setActionError(undefined);
      setEditing(undefined);
    } catch (error) {
      setActionError(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
    finally { setSaving(false); }
  }
  async function share(gameId: string) {
    if (!onShare) return;
    setSharingId(gameId);
    try {
      setActionError(undefined);
      await onShare(gameId);
      onClose();
    } catch (error) {
      setActionError(`无法打开分享：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSharingId(undefined);
    }
  }
  const setField = (field: keyof GameMetadata, value: string) => setEditing((current) => current && { ...current, value: { ...current.value, [field]: value } });
  const renderFolderNode = (node: FolderTreeNode, depth = 0) => {
    const active = filter === `folder:${node.path}`;
    const expanded = expandedFolders.has(node.path);
    const hasChildren = node.children.length > 0;
    const displayPath = folderDisplayPath(node.path);
    const system = node.folder?.system ?? false;
    return <div key={node.path} className="review-library-folder-node">
      <div className={`review-library-folder-row ${active ? "active" : ""}`} style={{ "--folder-depth": depth } as CSSProperties}>
        {hasChildren ? <button type="button" className="review-library-folder-toggle" aria-label={`${expanded ? "折叠" : "展开"}目录 ${displayPath}`} onClick={(event) => { event.stopPropagation(); toggleFolderExpanded(node.path); }}>{expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button> : <span className="review-library-folder-toggle placeholder"/>}
        <button type="button" className={active ? "active" : ""} aria-label={`${folderBasename(node.path)} ${folderCount(node.path)}`} onClick={() => setLibraryFilter(`folder:${node.path}`)}><FolderOpen size={14}/><span title={displayPath}>{folderBasename(node.path)}</span><small>{folderCount(node.path)}</small></button>
        {active && !system && <button type="button" className="review-library-folder-more" title="目录操作" aria-label={`目录操作 ${displayPath}`} disabled={creatingFolder} onClick={(event) => { event.stopPropagation(); setActiveFolderActions((current) => current === node.path ? null : node.path); }}><MoreHorizontal size={15}/></button>}
        {activeFolderActions === node.path && !system && <div className="review-library-folder-row-actions" role="menu" aria-label={`${displayPath} 目录操作`}>
          <button type="button" role="menuitem" aria-label={`重命名目录 ${displayPath}`} disabled={creatingFolder} onClick={() => startFolderRename(node.path)}><FilePenLine size={12}/><span>重命名</span></button>
          <button type="button" role="menuitem" aria-label={`移动目录 ${displayPath}`} disabled={creatingFolder} onClick={() => startFolderMove(node.path)}><FolderOpen size={12}/><span>移动</span></button>
          <button type="button" role="menuitem" className="danger" aria-label={`删除目录 ${displayPath}`} disabled={creatingFolder} onClick={() => startFolderDelete(node.path)}><Trash2 size={12}/><span>删除</span></button>
        </div>}
      </div>
      {expanded && node.children.map((child) => renderFolderNode(child, depth + 1))}
    </div>;
  };

  return <>
    <div className="review-library-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="review-game-library" role="dialog" aria-modal="true" aria-label="本地棋谱库">
      <header><div><Database size={18}/><span><strong>本地棋谱库</strong><small>选择一盘棋，直接在当前工作台打开</small></span></div><button type="button" aria-label="关闭棋谱库" title="关闭" onClick={onClose}><X size={17}/></button></header>
      <div className="review-game-library-body" style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}>
        <aside aria-label="棋谱库筛选">
          <div className="review-library-folder-node">
            <div className={`review-library-folder-row ${filter === "ttxq" ? "active" : ""}`} style={{ "--folder-depth": 0 } as CSSProperties}>
              {ttxqTree?.children.length ? <button type="button" className="review-library-folder-toggle" aria-label={`${expandedFolders.has(TTXQ_FOLDER) ? "折叠" : "展开"}目录 ${TTXQ_LABEL}`} onClick={(event) => { event.stopPropagation(); toggleFolderExpanded(TTXQ_FOLDER); }}>{expandedFolders.has(TTXQ_FOLDER) ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button> : <span className="review-library-folder-toggle placeholder"/>}
              <button type="button" className={filter === "ttxq" ? "active" : ""} aria-label={`${TTXQ_LABEL} ${ttxqCount}`} onClick={() => setLibraryFilter("ttxq")}><Database size={14}/><span>{TTXQ_LABEL}</span><small>{ttxqCount}</small></button>
            </div>
            {expandedFolders.has(TTXQ_FOLDER) && ttxqTree?.children.map((child) => renderFolderNode(child, 1))}
          </div>
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setLibraryFilter("all")}><FolderOpen size={14}/>全部本地 <small>{games.length}</small></button>
          {nonTtxqFolderTree.map((node) => renderFolderNode(node))}
          <div className="review-library-folder-actions">
            <button type="button" disabled={creatingFolder} onClick={startCreateFolder}><FolderPlus size={14}/>{currentFolderParent() ? "新建子目录" : "新建目录"}</button>
          </div>
          {folderCreate && <form className="review-library-create-panel" onSubmit={(event) => void submitCreateFolder(event)} aria-label="新建目录表单">
            <strong>{folderCreate.parent ? "新建子目录" : "新建目录"}</strong>
            <small className="review-library-create-target">当前父目录：{folderCreate.parent ? folderDisplayPath(folderCreate.parent) : "根目录"}</small>
            <label>父目录
              <select value={folderCreate.parent} onChange={(event) => setFolderCreate((current) => current && { ...current, parent: event.target.value })}>
                <option value="">根目录</option>
                {folderOptions.map((folder) => <option key={folder} value={folder}>{folderDisplayPath(folder)}</option>)}
              </select>
            </label>
            <label>目录名
              <input autoFocus name="folderName" placeholder={folderCreate.parent ? "如：第1轮" : "如：比赛复盘"}/>
            </label>
            <small>目录名可用 / 一次创建多级；创建后会自动切换到该目录。</small>
            <div>
              <button type="button" disabled={creatingFolder} onClick={() => setFolderCreate(null)}>取消</button>
              <button type="submit" className="primary" disabled={creatingFolder}>{creatingFolder ? "创建中…" : "创建"}</button>
            </div>
          </form>}
          {folderManage && <form className="review-library-create-panel review-library-manage-form" onSubmit={(event) => void submitFolderManage(event)} aria-label="编辑目录表单">
            <strong>{folderManage.action === "rename" ? "重命名目录" : folderManage.action === "move" ? "移动目录" : "删除目录"}</strong>
            <small title={folderDisplayPath(folderManage.folder)}>当前：{folderDisplayPath(folderManage.folder)}</small>
            {folderManage.action === "rename" && <label>目录名
              <input autoFocus name="folderName" defaultValue={folderManage.name}/>
            </label>}
            {folderManage.action === "move" && <label>移动到
              <select name="parent" value={folderManage.parent} onChange={(event) => setFolderManage((current) => current?.action === "move" ? { ...current, parent: event.target.value } : current)}>
                <option value="">根目录</option>
                {movableFolderOptions.map((folder) => <option key={folder} value={folder}>{folderDisplayPath(folder)}</option>)}
              </select>
            </label>}
            {folderManage.action === "delete" && <p>删除后，该目录及子目录会移除；里面的棋谱不会删除，会移动到“未分类”。</p>}
            <div>
              <button type="button" disabled={creatingFolder} onClick={() => setFolderManage(null)}>取消</button>
              <button type="submit" className={folderManage.action === "delete" ? "danger" : "primary"} disabled={creatingFolder}>{creatingFolder ? "处理中…" : folderManage.action === "delete" ? "确认删除" : "保存"}</button>
            </div>
          </form>}
        </aside>
        <div className="review-library-resize-handle" role="separator" aria-orientation="vertical" aria-label="调整目录栏宽度" title="拖动调整目录栏宽度" onPointerDown={startSidebarResize}/>
        <main>
          <div className="review-game-library-toolbar"><label><Search size={15}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、棋手、赛果、回合或赛事" /></label>{onDelete && <><button type="button" className="review-library-select-all" disabled={visibleDeletable.length === 0 || deleting} onClick={toggleVisibleSelection}>{allVisibleSelected ? "取消全选" : "全选当前"}</button><button type="button" className="review-library-delete" title={deletable.length ? `删除 ${deletable.length} 盘` : "勾选要删除的棋谱"} disabled={deleting || deletable.length === 0} onClick={() => requestDelete(deletable)}><Trash2 size={15}/>{deleting ? "删除中" : `删除${deletable.length ? ` ${deletable.length}` : ""}`}</button></>}</div>
          <div className="review-library-action-feedback" aria-live="polite">
            {actionError && !pendingDelete && <p className="review-library-action-error" role="alert">{actionError}</p>}
            {actionSuccess && <p className="review-library-action-success" role="status">{actionSuccess}</p>}
          </div>
          <div className="review-game-library-list" aria-label="棋谱列表">
            {visibleGames.length === 0 ? <p>没有匹配的本地棋谱。</p> : pagedGames.map((game) => (
              <article key={game.id} className={`review-library-game ${game.current ? "current" : ""}`}>
                <button type="button" className="review-library-select" aria-label="勾选删除" title={`勾选删除：${gameTitle(game)}`} onClick={() => toggle(game.id)}>
                  {selected.has(game.id) ? <CheckSquare size={17}/> : <Square size={17}/>}</button>
                <button type="button" className="review-library-open" aria-label={gameTitle(game)} onClick={() => { onOpen(game.id); onClose(); }}>
                  <span><strong>{gameTitle(game)}</strong><small>{gameDetail(game) || "本地棋谱"}</small></span>
                  {resultLabel(game) && <em className={`result ${game.result === "1-0" ? "red" : game.result === "0-1" ? "black" : "draw"}`}>{resultLabel(game)}</em>}
                  {game.current && <em>当前</em>}
                </button>
                <div className="review-library-actions">
                  <button type="button" title="编辑棋谱信息" aria-label={`编辑 ${gameTitle(game)}`} onClick={() => void startEdit(game.id)}><FilePenLine size={15}/><span>编辑</span></button>
                  {onShare && <button type="button" title="打开分享与导出" aria-label={`分享 ${gameTitle(game)}`} disabled={sharingId === game.id} onClick={() => void share(game.id)}><Share2 size={15}/><span>{sharingId === game.id ? "打开中" : "分享"}</span></button>}
                  {onDelete && <button type="button" className="danger" title="删除棋谱" aria-label={`删除 ${gameTitle(game)}`} disabled={deleting} onClick={() => requestDelete([game.id])}><Trash2 size={15}/><span>删除</span></button>}
                </div>
              </article>
            ))}
          </div>
          <nav className="review-library-pagination" aria-label="棋谱分页">
            <span>{visibleGames.length === 0 ? "0 盘" : `${pageStart}-${pageEnd} / ${visibleGames.length} 盘`}</span>
            <label>每页
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}>
                {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <div>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage(1)}>首页</button>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
              <strong>{safePage} / {pageCount}</strong>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一页</button>
              <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}>末页</button>
            </div>
          </nav>
        </main>
      </div>
      {editing && <section className="review-library-editor" role="dialog" aria-label="编辑棋谱信息"><header><strong>编辑棋谱信息</strong><button type="button" aria-label="关闭编辑" onClick={() => setEditing(undefined)}><X size={16}/></button></header><div className="review-library-editor-fields"><label>标题<input value={editing.value.title} onChange={(event) => setField("title", event.target.value)}/></label><label>赛事<input value={editing.value.event} onChange={(event) => setField("event", event.target.value)}/></label><label>地点<input value={editing.value.site} onChange={(event) => setField("site", event.target.value)}/></label><label>日期时间<input value={editing.value.date} onChange={(event) => setField("date", event.target.value)}/></label><label>红方<input value={editing.value.red} onChange={(event) => setField("red", event.target.value)}/></label><label>黑方<input value={editing.value.black} onChange={(event) => setField("black", event.target.value)}/></label><label>赛果<input value={editing.value.result} placeholder="1-0、0-1、1/2-1/2 或 *" onChange={(event) => setField("result", event.target.value)}/></label><label className="wide">备注<textarea value={editing.value.note} onChange={(event) => setField("note", event.target.value)}/></label></div><footer><button type="button" onClick={() => setEditing(undefined)}>取消</button><button type="button" className="primary" disabled={saving || !editing.value.title.trim()} onClick={() => void saveEdit()}>{saving ? "保存中" : "保存"}</button></footer></section>}
    </section>
    </div>
    {pendingDelete && createPortal(<div className="review-library-delete-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setPendingDelete(undefined); }}>
      <section className="review-library-delete-confirm" role="alertdialog" aria-modal="true" aria-label="确认删除棋谱" onMouseDown={(event) => event.stopPropagation()}>
        <strong>从本机删除 {pendingDelete.length} 盘棋谱？</strong><span>仅移除当前设备的棋谱，不会删除云端或其他设备的数据。</span>
        {actionError && <p className="review-library-delete-error" role="alert">{actionError}</p>}
        <div><button type="button" onClick={(event) => { event.stopPropagation(); setPendingDelete(undefined); }} disabled={deleting}>取消</button><button type="button" className="danger" onClick={(event) => { event.stopPropagation(); void confirmDelete(); }} disabled={deleting}>{deleting ? "删除中…" : "确认删除"}</button></div>
      </section>
    </div>, document.body)}
  </>;
}
