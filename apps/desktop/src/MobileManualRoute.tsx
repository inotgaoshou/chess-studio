import { ArrowDown, ArrowUp, ChevronDown, GitFork, Trash2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ManualTreeNode, MoveItem } from "./platform";
import { buildMobileManualRoute, type MobileManualRouteCell } from "./mobileManualRouteModel";

type OpenBranchMenu = { nodeId: string; left: number; top: number; maxHeight: number };

type Props = {
  nodes: ManualTreeNode[];
  history: MoveItem[];
  continuation?: MoveItem[];
  currentNode?: string;
  disabled?: boolean;
  onNavigate(nodeId: string): void;
  onSaveComment(nodeId: string, comment: string): Promise<boolean | void> | boolean | void;
  onDelete(nodeId: string): Promise<boolean> | boolean;
};

export function MobileManualRoute({ nodes, history, continuation = [], currentNode, disabled = false, onNavigate, onSaveComment, onDelete }: Props) {
  const [openMenu, setOpenMenu] = useState<OpenBranchMenu>();
  const [variationSelectorOpen, setVariationSelectorOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSaveState, setCommentSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle");
  const [actionBusy, setActionBusy] = useState(false);
  const routeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const variationSelectorRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const commentSaveTimerRef = useRef<number | undefined>(undefined);
  const pendingCommentSaveRef = useRef<{ nodeId: string; comment: string } | undefined>(undefined);
  const saveCommentRef = useRef(onSaveComment);
  const activeNodeIdRef = useRef<string | undefined>(undefined);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const rows = buildMobileManualRoute(nodes, history, currentNode, continuation);
  const activeCell = rows.flatMap((row) => [row.red, row.black]).find((cell) => cell?.move.id === currentNode);
  const activeChoiceIndex = activeCell?.branchChoices.findIndex((choice) => choice.id === activeCell.move.id) ?? -1;
  const hasVariations = !!activeCell && activeCell.branchChoices.length > 1;
  activeNodeIdRef.current = activeCell?.move.id;
  saveCommentRef.current = onSaveComment;

  const closeMenu = (restoreFocus = false) => {
    if (restoreFocus && openMenu) triggerRefs.current.get(openMenu.nodeId)?.focus();
    setOpenMenu(undefined);
  };

  const closeVariationSelector = () => setVariationSelectorOpen(false);

  useEffect(() => {
    if (!openMenu && !variationSelectorOpen && !deleteConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeleteConfirmOpen(false);
        closeVariationSelector();
        closeMenu(true);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!routeRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
      if (!variationSelectorRef.current?.contains(target)) closeVariationSelector();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [deleteConfirmOpen, openMenu, variationSelectorOpen]);

  useEffect(() => {
    setOpenMenu(undefined);
    setVariationSelectorOpen(false);
    setDeleteConfirmOpen(false);
  }, [currentNode]);
  useEffect(() => {
    if (deleteConfirmOpen) deleteCancelRef.current?.focus();
  }, [deleteConfirmOpen]);
  useEffect(() => {
    setCommentDraft(activeCell?.move.comment ?? "");
    setCommentSaveState("idle");
  }, [activeCell?.move.id, activeCell?.move.comment]);
  useEffect(() => () => {
    window.clearTimeout(commentSaveTimerRef.current);
    const pending = pendingCommentSaveRef.current;
    if (pending) void saveCommentRef.current(pending.nodeId, pending.comment);
  }, []);

  function openBranchMenu(cell: MobileManualRouteCell, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    const routeRect = routeRef.current?.getBoundingClientRect();
    const estimatedHeight = cell.branchChoices.length * 40 + 12;
    const width = Math.min(228, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const safeTop = routeRect ? routeRect.top + 4 : 8;
    const safeBottom = routeRect ? routeRect.bottom - 4 : window.innerHeight - 58;
    const maxHeight = Math.max(48, safeBottom - safeTop);
    const menuHeight = Math.min(estimatedHeight, maxHeight);
    const top = Math.max(safeTop, Math.min(rect.bottom + 6, safeBottom - menuHeight));
    setOpenMenu({ nodeId: cell.move.id, left, top, maxHeight: Math.floor(maxHeight) });
  }

  function renderCell(cell: MobileManualRouteCell | undefined, side: "red" | "black") {
    if (!cell) return <span className="mobile-manual-route-empty" aria-hidden="true">--</span>;
    const active = cell.move.id === currentNode;
    return <span className={`mobile-manual-route-cell ${side} ${active ? "active" : ""} ${cell.continuation ? "continuation" : ""}`}>
      <button type="button" className="mobile-manual-route-move" onClick={() => onNavigate(cell.move.id)} title={`跳转到 ${cell.move.notation}`}>
        <i aria-hidden="true" />
        <strong>{cell.move.notation}</strong>
        {cell.move.comment.trim() && <small className="mobile-manual-route-comment" title={cell.move.comment}>{cell.move.comment}</small>}
      </button>
      {cell.branchLabel && <button
        ref={(element) => { if (element) triggerRefs.current.set(cell.move.id, element); else triggerRefs.current.delete(cell.move.id); }}
        type="button"
        className="mobile-manual-branch-tag"
        aria-label={`${cell.branchLabel} 变招`}
        aria-expanded={openMenu?.nodeId === cell.move.id}
        aria-haspopup="dialog"
        onClick={(event) => openBranchMenu(cell, event.currentTarget)}
      ><GitFork size={12}/>{cell.branchLabel}</button>}
    </span>;
  }

  function scheduleActiveCommentSave(nextComment: string) {
    if (!activeCell || disabled) return;
    setCommentDraft(nextComment);
    setCommentSaveState("pending");
    window.clearTimeout(commentSaveTimerRef.current);
    const nodeId = activeCell.move.id;
    pendingCommentSaveRef.current = { nodeId, comment: nextComment };
    commentSaveTimerRef.current = window.setTimeout(() => {
      pendingCommentSaveRef.current = undefined;
      setCommentSaveState("saving");
      void Promise.resolve(onSaveComment(nodeId, nextComment)).then((saved) => {
        if (nodeId === activeNodeIdRef.current) setCommentSaveState(saved === false ? "error" : "saved");
      }).catch(() => {
        if (nodeId === activeNodeIdRef.current) setCommentSaveState("error");
      });
    }, 380);
  }

  function navigateAdjacentBranch(delta: -1 | 1) {
    if (!activeCell || activeChoiceIndex < 0 || actionBusy) return;
    const nextChoice = activeCell.branchChoices[activeChoiceIndex + delta];
    if (nextChoice) onNavigate(nextChoice.id);
  }

  async function deleteActiveBranch() {
    if (!activeCell || actionBusy) return;
    setActionBusy(true);
    try {
      const deleted = await onDelete(activeCell.move.id);
      if (deleted) {
        setOpenMenu(undefined);
        setCommentDraft("");
      }
    } finally {
      setActionBusy(false);
    }
  }

  function requestDeleteActiveBranch() {
    if (!activeCell || actionBusy) return;
    setDeleteConfirmOpen(true);
  }

  const openCell = rows.flatMap((row) => [row.red, row.black]).find((cell) => cell?.move.id === openMenu?.nodeId);
  return <div ref={routeRef} className="mobile-manual-route" aria-label="手机棋谱当前路线">
    <div className="mobile-manual-route-list">
      <header className="mobile-manual-opening">==开局==</header>
      {rows.length === 0 && <div className="mobile-manual-route-empty-state">当前仍在开始局面</div>}
      {rows.map((row) => <div key={row.turn} className={`mobile-manual-route-row ${row.active ? "active" : ""} ${row.black ? "has-black" : ""}`}>
        <span className="mobile-manual-route-turn">{row.turn}.</span>
        {renderCell(row.red, "red")}
        {renderCell(row.black, "black")}
      </div>)}
    </div>
    <section className="mobile-manual-variation-editor" aria-label="当前变招编辑">
      <div className="mobile-manual-variation-heading">
        <strong>变招：</strong>
        <div className="mobile-manual-variation-actions" role="group" aria-label="变招操作">
          <button type="button" title="删除当前分支" aria-label="删除当前分支" disabled={disabled || actionBusy || !activeCell} onClick={requestDeleteActiveBranch}><Trash2 size={14}/></button>
          <button type="button" title="切换上一个变招" aria-label="上移变招" disabled={disabled || actionBusy || !hasVariations || activeChoiceIndex <= 0} onClick={() => navigateAdjacentBranch(-1)}><ArrowUp size={14}/></button>
          <button type="button" title="切换下一个变招" aria-label="下移变招" disabled={disabled || actionBusy || !hasVariations || activeChoiceIndex >= (activeCell?.branchChoices.length ?? 1) - 1} onClick={() => navigateAdjacentBranch(1)}><ArrowDown size={14}/></button>
        </div>
        <div ref={variationSelectorRef} className="mobile-manual-variation-selector">
          <button
            type="button"
            className="mobile-manual-variation-trigger"
            aria-label="当前变招"
            aria-expanded={variationSelectorOpen}
            aria-haspopup="listbox"
            disabled={disabled || actionBusy || !hasVariations}
            onClick={() => setVariationSelectorOpen((open) => !open)}
          ><span>{activeCell ? `${activeCell.branchChoices[activeChoiceIndex]?.letter ?? "A"}. ${activeCell.move.notation}` : "--"}</span><ChevronDown size={15}/></button>
          {variationSelectorOpen && activeCell && <div className="mobile-manual-variation-options" role="listbox" aria-label="当前变招选择">
            {activeCell.branchChoices.map((choice) => <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={choice.id === activeCell.move.id}
              className={choice.id === activeCell.move.id ? "active" : ""}
              onClick={() => { closeVariationSelector(); onNavigate(choice.id); }}
            ><b>{choice.letter}.</b><span>{choice.notation}</span></button>)}
          </div>}
        </div>
      </div>
      <div className="mobile-manual-comment-editor">
        <div className="mobile-manual-comment-label"><span>注释</span><small>{commentSaveState === "pending" ? "即将自动保存" : commentSaveState === "saving" ? "正在保存…" : commentSaveState === "saved" ? "已自动保存" : commentSaveState === "error" ? "保存失败，请继续编辑重试" : "自动保存"}</small></div>
        <textarea value={commentDraft} disabled={disabled || actionBusy || !activeCell} onChange={(event) => scheduleActiveCommentSave(event.target.value)} placeholder="此处编辑注释..." aria-label="当前变招注释" rows={4}/>
      </div>
    </section>
    {openMenu && openCell && createPortal(<div
      ref={menuRef}
      className="mobile-manual-branch-menu"
      role="dialog"
      aria-label="变招选择"
      style={{ "--branch-menu-left": `${openMenu.left}px`, "--branch-menu-top": `${openMenu.top}px`, "--branch-menu-max-height": `${openMenu.maxHeight}px` } as CSSProperties}
    >
      {openCell.branchChoices.map((choice) => <button
        key={choice.id}
        type="button"
        className={choice.id === openCell.move.id ? "active" : ""}
        onClick={() => { closeMenu(); onNavigate(choice.id); }}
      ><b>{choice.letter}.</b><span>{choice.notation}</span></button>)}
    </div>, document.body)}
    {deleteConfirmOpen && activeCell && createPortal(<div className="mobile-branch-delete-backdrop" role="presentation" onMouseDown={() => setDeleteConfirmOpen(false)}>
      <section className="mobile-branch-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="mobile-delete-branch-title" aria-describedby="mobile-delete-branch-description" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="mobile-delete-branch-title">删除该分支及后续着法？</h2>
        <p id="mobile-delete-branch-description">将删除“{activeCell.move.notation}”及其后续所有着法。</p>
        <footer>
          <button type="button" className="danger" aria-label="确认删除分支" disabled={actionBusy} onClick={() => { setDeleteConfirmOpen(false); void deleteActiveBranch(); }}>是</button>
          <button ref={deleteCancelRef} type="button" aria-label="取消删除分支" onClick={() => setDeleteConfirmOpen(false)}>否</button>
        </footer>
      </section>
    </div>, document.body)}
  </div>;
}
