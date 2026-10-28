import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type NumberItem = { id: string; number?: number; title?: string; status?: string };
/** Browsing stays paged; floating controls never change the problem selection. */
export function ProblemNumberNavigation({ items, activeId, onSelect, onPreviousGroup, onNextGroup }: {
  items: NumberItem[]; activeId?: string; onSelect(index: number): void;
  onPreviousGroup?(): void; onNextGroup?(): void;
}) {
  const [group, setGroup] = useState(0);
  const [saved] = useState(()=>{try{return JSON.parse(localStorage.getItem("qixi.problem-number-view")||"{}") ?? {};}catch{return {};}});
  const [collapsed, setCollapsed] = useState(Boolean(saved.collapsed));
  const [floating, setFloating] = useState(Boolean(saved.floating));
  useEffect(()=>{try{localStorage.setItem("qixi.problem-number-view",JSON.stringify({collapsed,floating}));}catch{}},[collapsed,floating]);
  const [position, setPosition] = useState<{x:number;y:number}>();
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{x:number;y:number;left:number;top:number}|undefined>(undefined);
  const activeIndex = items.findIndex(item => item.id === activeId);
  const pageCount = Math.ceil(items.length / 20);
  const safeGroup = Math.min(group, Math.max(0, pageCount - 1));
  useEffect(() => { if (activeIndex >= 0) setGroup(Math.floor(activeIndex / 20)); }, [activeId, activeIndex]);
  useEffect(() => { setGroup(activeIndex >= 0 ? Math.floor(activeIndex / 20) : 0); }, [items[0]?.id]);
  function constrain(x:number,y:number) {
    const r=panel.current?.getBoundingClientRect(),v=window.visualViewport;
    const left=(v?.offsetLeft??0)+8, top=(v?.offsetTop??0)+8;
    return {x:Math.max(left,Math.min(x,left+(v?.width??innerWidth)-(r?.width??300)-16)),y:Math.max(top,Math.min(y,top+(v?.height??innerHeight)-(r?.height??180)-100))};
  }
  useEffect(()=>{
    if(!floating)return;
    const fit=()=>setPosition(p=>{if(!p)return p;const next=constrain(p.x,p.y);return next.x===p.x&&next.y===p.y?p:next;});
    window.addEventListener("resize",fit);window.visualViewport?.addEventListener("resize",fit);
    const observer=new ResizeObserver(fit);if(panel.current)observer.observe(panel.current);
    return()=>{window.removeEventListener("resize",fit);window.visualViewport?.removeEventListener("resize",fit);observer.disconnect();};
  },[floating]);
  if (!items.length) return null;
  const content=<nav ref={panel} className={`problem-number-navigation${floating?" is-floating":""}${collapsed?" is-collapsed":""}`} aria-label="数字导航" style={floating&&position?{left:position.x,top:position.y,right:"auto",bottom:"auto"}:undefined}>
    <header>
      {floating?<button type="button" className="problem-number-drag" aria-label="拖动题号导航（方向键可移动）"
        onPointerDown={e=>{if(e.button!==0)return;const r=panel.current!.getBoundingClientRect();drag.current={x:e.clientX,y:e.clientY,left:r.left,top:r.top};e.currentTarget.setPointerCapture(e.pointerId);}}
        onPointerMove={e=>{const d=drag.current;if(d)setPosition(constrain(d.left+e.clientX-d.x,d.top+e.clientY-d.y));}}
        onPointerUp={()=>{drag.current=undefined;}} onPointerCancel={()=>{drag.current=undefined;}}
        onKeyDown={e=>{const delta=({ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]} as Record<string,number[]>)[e.key];if(delta){e.preventDefault();const r=panel.current!.getBoundingClientRect();setPosition(constrain(r.left+delta[0],r.top+delta[1]));}}}>⠿ 题号</button>:<strong>题号导航</strong>}
      {collapsed&&activeIndex>=0&&<span>第 {items[activeIndex].number??activeIndex+1} 题</span>}
      <button type="button" aria-label={floating?"取消悬浮题号导航":"悬浮题号导航"} aria-pressed={floating} onClick={()=>{setFloating(v=>!v);setPosition(undefined);}}>{floating?"固定":"悬浮"}</button>
      <button type="button" aria-label={collapsed?"展开题号导航":"收起题号导航"} aria-expanded={!collapsed} onClick={()=>setCollapsed(v=>!v)}>{collapsed?"展开":"收起"}</button>
    </header>
    {!collapsed&&<>
      <div className="problem-number-pages">{pageCount > 1 && <select aria-label="题号范围" value={safeGroup} onChange={event => setGroup(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, i) => <option key={i} value={i}>{items[i * 20].number ?? i * 20 + 1}–{items[Math.min((i + 1) * 20, items.length) - 1].number ?? Math.min((i + 1) * 20, items.length)}</option>)}</select>}
        {(safeGroup > 0 || onPreviousGroup) && <button type="button" onClick={() => safeGroup > 0 ? setGroup(safeGroup - 1) : onPreviousGroup?.()}>上一组</button>}
        {(safeGroup + 1 < pageCount || onNextGroup) && <button type="button" onClick={() => safeGroup + 1 < pageCount ? setGroup(safeGroup + 1) : onNextGroup?.()}>下一组</button>}
      </div>
      <div className="problem-number-grid">{items.slice(safeGroup * 20, (safeGroup + 1) * 20).map((item, offset) => <button type="button" key={item.id} className={item.status} aria-current={activeId === item.id ? "step" : undefined} aria-label={`跳到第 ${item.number ?? safeGroup * 20 + offset + 1} 题${item.title ? `：${item.title}` : ""}`} onClick={() => onSelect(safeGroup * 20 + offset)}>{item.number ?? safeGroup * 20 + offset + 1}</button>)}</div>
    </>}
  </nav>;
  return floating?createPortal(content,document.body):content;
}
