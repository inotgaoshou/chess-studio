import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, GitFork, GripVertical, Minus, Pencil, Settings2, X } from "lucide-react";
import { branchOverlayBounds, placeBranchOverlay, type OverlayPoint } from "./branchOverlay";
import "./branchStrip.css";

export type BranchStripChoice = { id:string; move:string; notation:string; selected?:boolean; isMainline?:boolean; color?:string };
export type BranchStripAnchor = { board:Element|null; toolbar?:Element|null; dock?:Element|null; dockInside?:boolean };
type BranchStripProps = {
  choices:BranchStripChoice[]; onSelect(id:string):void; onManage?():void; onRequestDelete?(id:string):void; revealKey?:number;
  contextKey?:string; floating?:boolean; hidden?:boolean; light?:boolean;
  layoutKey?:string|number; compact?:boolean;
  getAnchor?():BranchStripAnchor; expanded?:boolean; onExpandedChange?(expanded:boolean):void;
};

/** Direct children of the displayed position; floating content never enters the board grid. */
export function BranchStrip(props:BranchStripProps) {
  const {choices,onSelect,onManage,revealKey,floating=false,hidden=false,light=false,contextKey,compact=false}=props;
  const unique=choices.filter((choice,index)=>choices.findIndex(item=>item.move===choice.move)===index);
  const [internalOpen,setInternalOpen]=useState(true);
  const [editing,setEditing]=useState(false);
  const open=props.expanded ?? internalOpen;
  const latest=useRef(props); latest.current=props;
  const card=useRef<HTMLElement>(null),layer=useRef<HTMLDivElement>(null);
  const preferred=useRef<OverlayPoint|undefined>(undefined);
  const fit=useRef<()=>void>(()=>undefined);
  const drag=useRef<{id:number;x:number;y:number;left:number;top:number}|undefined>(undefined);
  const identity=contextKey ?? unique.map(item=>item.id).join(",");
  const hasFork=unique.length>1,visible=!hidden && unique.length>0;
  function setOpen(value:boolean) { setInternalOpen(value); latest.current.onExpandedChange?.(value); }
  useLayoutEffect(()=>{setOpen(true);setEditing(false);},[identity,revealKey,hasFork,unique.length>0]);
  useEffect(()=>{
    if (!visible) return;
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!event.isComposing)setOpen(false);};
    window.addEventListener("keydown",escape);
    return ()=>window.removeEventListener("keydown",escape);
  },[visible]);

  useLayoutEffect(()=>{
    if (!floating || !visible) return;
    const node=card.current!,host=layer.current!;
    const constrain=()=>{
      const viewport=window.visualViewport,padding=getComputedStyle(host);
      const left=viewport?.offsetLeft ?? 0,top=viewport?.offsetTop ?? 0;
      const {board,toolbar,dock,dockInside}=latest.current.getAnchor?.() ?? {board:null};
      const boardRect=board?.getBoundingClientRect();
      const toolbarRect=toolbar?.getBoundingClientRect(),dockRect=dock?.getBoundingClientRect();
      const fitsGap=Boolean(dockInside&&boardRect&&toolbarRect&&toolbarRect.top-boardRect.bottom>=52);
      const useSlot=dockInside&&!fitsGap;
      const placementDock=dockInside&&!useSlot?undefined:dockRect;
      const bounds=branchOverlayBounds({
        left:left+(parseFloat(padding.paddingLeft)||8),top:top+(parseFloat(padding.paddingTop)||8),
        right:left+(viewport?.width ?? innerWidth)-(parseFloat(padding.paddingRight)||8),
        bottom:top+(viewport?.height ?? innerHeight)-(parseFloat(padding.paddingBottom)||8),
      },boardRect,placementDock,preferred.current);
      if(fitsGap&&!preferred.current&&toolbarRect)bounds.bottom=Math.min(bounds.bottom,toolbarRect.top-4);
      node.dataset.dockInside=String(Boolean(useSlot));
      node.style.maxWidth=`${Math.max(1,Math.min(bounds.right-bounds.left,useSlot&&dockRect?dockRect.width:Infinity))}px`;
      const maxHeight=Math.max(1,Math.min(bounds.bottom-bounds.top,(viewport?.height ?? innerHeight)*.4,160,useSlot&&dockRect?dockRect.height-4:Infinity));
      node.dataset.compactChoices=String(maxHeight<80);
      node.style.maxHeight=`${maxHeight}px`;node.style.setProperty("--branch-choice-height",`${Math.max(1,maxHeight-(useSlot?4:8))}px`);
      const rect=node.getBoundingClientRect();
      const position=placeBranchOverlay(bounds,rect,boardRect,preferred.current ?? (useSlot&&dockRect?{x:dockRect.left,y:dockRect.top+2}:undefined),placementDock);
      node.style.left=`${position.x}px`;node.style.top=`${position.y}px`;node.style.visibility="visible";
    };
    fit.current=constrain;constrain();
    let resizeFrame:number|undefined;
    const scheduleResize=()=>{if(resizeFrame===undefined)resizeFrame=requestAnimationFrame(()=>{resizeFrame=undefined;constrain();});};
    // Fit after observer delivery, so setting card bounds cannot cause a WebKit
    // resize-observer loop in the same frame (especially after rotation).
    const observer=typeof ResizeObserver==="undefined"?undefined:new ResizeObserver(scheduleResize);
    observer?.observe(node);
    const anchor=latest.current.getAnchor?.();
    if(anchor?.board)observer?.observe(anchor.board);
    if(anchor?.toolbar)observer?.observe(anchor.toolbar);
    if(anchor?.dock)observer?.observe(anchor.dock);
    window.addEventListener("resize",constrain);window.addEventListener("scroll",constrain,true);
    window.visualViewport?.addEventListener("resize",constrain);window.visualViewport?.addEventListener("scroll",constrain);
    return ()=>{observer?.disconnect();if(resizeFrame!==undefined)cancelAnimationFrame(resizeFrame);window.removeEventListener("resize",constrain);window.removeEventListener("scroll",constrain,true);window.visualViewport?.removeEventListener("resize",constrain);window.visualViewport?.removeEventListener("scroll",constrain);fit.current=()=>undefined;drag.current=undefined;};
  },[floating,visible,open,identity,unique.length,props.layoutKey]);

  function startDrag(event:PointerEvent<HTMLElement>) {
    if (!floating || event.button!==0 || (event.target as HTMLElement).closest("button:not(.branch-drag-handle)")) return;
    const rect=card.current!.getBoundingClientRect();
    drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
    event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault();
  }
  function moveDrag(event:PointerEvent<HTMLElement>) {
    const start=drag.current;
    if(!start || start.id!==event.pointerId)return;
    if(Math.hypot(event.clientX-start.x,event.clientY-start.y)<4)return;
    preferred.current={x:start.left+event.clientX-start.x,y:start.top+event.clientY-start.y};fit.current();
  }
  const dragEvents={onPointerDown:startDrag,onPointerMove:moveDrag,onPointerUp:()=>{drag.current=undefined;},onPointerCancel:()=>{drag.current=undefined;}};
  const handle=floating?<button type="button" className="branch-drag-handle" aria-label="拖动分支选择" onKeyDown={event=>{
    const directions:Record<string,OverlayPoint>={ArrowLeft:{x:-16,y:0},ArrowRight:{x:16,y:0},ArrowUp:{x:0,y:-16},ArrowDown:{x:0,y:16}};
    const delta=directions[event.key];if(!delta)return;
    event.preventDefault();const rect=card.current!.getBoundingClientRect();preferred.current={x:rect.left+delta.x,y:rect.top+delta.y};fit.current();
  }}><GripVertical size={16}/></button>:null;
  const select=(id:string)=>{setOpen(false);onSelect(id);};
  const floatingChoice=(choice:BranchStripChoice,index:number)=><span className="branch-choice-item" key={choice.id}>
    <button style={choice.color?{"--branch-color":choice.color} as CSSProperties:undefined} type="button" data-move={choice.move} aria-label={unique.length===1?`棋谱下一着：${choice.notation}`:`分支 ${index+1} · ${choice.notation}`} aria-current={choice.selected?"true":undefined} title={`分支 ${index+1} · ${choice.notation}`} onClick={()=>select(choice.id)}><b>{index+1}</b><strong>{choice.notation}</strong></button>
    {editing&&props.onRequestDelete&&<button type="button" className="branch-inline-delete" aria-label={`删除分支 ${index+1} · ${choice.notation}`} onClick={()=>props.onRequestDelete?.(choice.id)}><Minus size={12}/></button>}
  </span>;
  if(!visible)return null;
  const content=<nav ref={card} className={`manual-branch-strip ${floating?"is-floating":""} ${light?"is-light":""} ${unique.length===1?"is-single":""} ${unique.length>2?"has-many-choices":""} ${!open?"is-collapsed":""} ${props.onRequestDelete?"has-inline-edit":""} ${editing?"is-editing":""} ${compact?"is-compact":""}`} aria-label="当前局面分支" style={floating?{visibility:"hidden"}:undefined}>
    {floating ? <div className="branch-inline-controls"><span className={compact&&open?"branch-source-handle":undefined} {...dragEvents}>{handle}{compact&&open&&<small>分支</small>}</span>
      {!open ? <button type="button" aria-label="展开棋谱后续" onClick={()=>setOpen(true)}><GitFork size={14}/>{unique.length === 1 ? "棋谱后续" : `分支 ${unique.length}`}</button>
      : <div className="manual-branch-choices">{unique.map(floatingChoice)}</div>}
      <span className="branch-small-actions">{props.onRequestDelete&&open&&!(compact&&onManage)&&<button type="button" aria-label={editing?"完成分支编辑":"编辑分支"} aria-pressed={editing} onClick={()=>setEditing(value=>!value)}>{editing?<Check size={15}/>:<Pencil size={15}/>}<small>{editing?"完成":"编辑"}</small></button>}{onManage&&open&&unique.length>0&&<button type="button" className="branch-manage-button" aria-label="管理变招" title={`编辑、删除或排序 ${unique.length} 条分支着法`} onClick={onManage}>{compact?<><Pencil size={15}/><small>编辑</small></>:<><Settings2 size={14}/><span className="branch-choice-count" aria-hidden="true">共{unique.length}</span></>}</button>}{open&&<button type="button" aria-label="收起变招选择" onClick={()=>setOpen(false)}>{compact?<Minus size={15}/>:<X size={14}/>}</button>}</span>
    </div> : unique.length===1 || !open ? <div className="branch-compact">{unique.length===1
      ? <button type="button" aria-label={`棋谱下一着：${unique[0].notation}`} onClick={()=>select(unique[0].id)}>下一着：{unique[0].notation}</button>
      : <button type="button" onClick={()=>setOpen(true)}><GitFork size={16}/>选择变招 · {unique.length} 条</button>}</div>
    : <><header><strong><GitFork size={15}/>选择变招 · {unique.length} 条</strong><span>{onManage&&<button type="button" aria-label="管理变招" onClick={onManage}><Settings2 size={14}/></button>}<button type="button" aria-label="收起变招选择" onClick={()=>setOpen(false)}><X size={14}/></button></span></header>
    <div className="manual-branch-choices">{unique.map((choice,index)=><button key={choice.id} style={choice.color?{"--branch-color":choice.color} as CSSProperties:undefined} type="button" aria-label={`分支 ${index+1} · ${choice.notation}`} aria-current={choice.selected?"true":undefined} onClick={()=>select(choice.id)}><b>{index+1}</b><span><strong>{choice.notation}</strong><small>{choice.isMainline?"主线":"分支"} {index+1}</small></span></button>)}</div></>}
  </nav>;
  return floating?createPortal(<div ref={layer} className="branch-floating-layer">{content}</div>,document.body):content;
}
