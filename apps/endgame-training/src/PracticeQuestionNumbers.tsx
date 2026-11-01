import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PRACTICE_GROUP_SIZE, numberedProblemLabel, navigationStatusLabel, navigationStatusMark, type ProblemNavigationStatus } from "./practiceNavigation";
import "./practiceQuestionNumbers.css";

type Item = { id: string; title: string; number?: number; status?: ProblemNavigationStatus };
const PREFERENCE = "qixi-catalog-numbers-collapsed-v1";
/** Browse only the loaded catalog; selecting a number locates its card. */
export const CATALOG_PAGE_SIZE=50;
export function PracticeQuestionNumbers({items,index=-1,total,hasMore=false,page=0,busy=false,onPageChange,onSelect}: {items:Item[];index?:number;total?:number|null;hasMore?:boolean;page?:number;busy?:boolean;onPageChange?(page:number):void;onSelect(index:number):void}) {
  const panelRef=useRef<HTMLElement>(null);
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(PREFERENCE)==="true";}catch{return false;}});
  useLayoutEffect(()=>{
    const panel=panelRef.current,parent=panel?.parentElement;
    if(!panel||!parent)return;
    let port=parent;
    while(port.parentElement&&!/auto|scroll/.test(getComputedStyle(port).overflowY))port=port.parentElement;
    // Card jumps and keyboard focus must clear the entire frozen navigator,
    // including after folding, paging, or rotating the device.
    const measure=()=>{
      parent.style.setProperty("--catalog-number-height",`${panel.getBoundingClientRect().height}px`);
      // Sticky positioning includes the scrollport's normal page padding.
      // Cancel it so scrolling cards cannot peek above the frozen panel.
      parent.style.setProperty("--catalog-number-top",`${-parseFloat(getComputedStyle(port).paddingTop||"0")}px`);
    };
    measure();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(measure):undefined;
    observer?.observe(panel);
    observer?.observe(port);
    window.addEventListener("resize",measure);
    return()=>{observer?.disconnect();window.removeEventListener("resize",measure);parent.style.removeProperty("--catalog-number-height");parent.style.removeProperty("--catalog-number-top");};
  },[items.length>0,collapsed]);
  if (!items.length) return null;
  const loadedPages=Math.ceil(items.length/CATALOG_PAGE_SIZE),safePage=Math.min(page,loadedPages-1),start=safePage*CATALOG_PAGE_SIZE,end=Math.min(start+CATALOG_PAGE_SIZE,items.length);
  const count=total??(hasMore?undefined:items.length),pageCount=count==null?undefined:Math.ceil(count/CATALOG_PAGE_SIZE);
  const selectedGroup=index>=start&&index<end?Math.floor((index-start)/PRACTICE_GROUP_SIZE):0;
  const groupStart=start+selectedGroup*PRACTICE_GROUP_SIZE,groupEnd=Math.min(groupStart+PRACTICE_GROUP_SIZE,end),groupIndex=Math.floor(groupStart/PRACTICE_GROUP_SIZE);
  const range=(from:number,to:number)=>`${items[from].number??from+1}–${items[to-1].number??to}`;
  return <nav ref={panelRef} className="practice-question-numbers" aria-label="题库数字导航">
    <header><strong>题号 <small>{range(groupStart,groupEnd)}</small><small className="practice-question-total">第 {safePage+1} 页 / {pageCount!=null?`共 ${pageCount} 页`:"总页数待统计"} · 每页 50 题</small><small className="practice-question-total">{count!=null?`共 ${count} 题 · 共 ${Math.ceil(count/PRACTICE_GROUP_SIZE)} 组`:"总题数、总组数待统计"} · 每组 25 题</small></strong><button type="button" aria-label={collapsed?"展开数字导航":"收起数字导航"} aria-expanded={!collapsed} onClick={()=>{
      const next=!collapsed;setCollapsed(next);try{localStorage.setItem(PREFERENCE,String(next));}catch{/* Keep browsing when storage is unavailable. */}
    }}>{collapsed?"展开":"收起"}{collapsed?<ChevronDown/>:<ChevronUp/>}</button></header>
    {!collapsed&&<>
      <div className="practice-question-number-pages"><button type="button" disabled={busy||safePage===0||!onPageChange} onClick={()=>onPageChange?.(safePage-1)}>上一页</button><select aria-label="题目页码（已读取页面）" value={safePage} disabled={busy||!onPageChange} onChange={e=>onPageChange?.(Number(e.target.value))}>{Array.from({length:loadedPages},(_,i)=><option key={i} value={i}>第 {i+1} 页 · {range(i*CATALOG_PAGE_SIZE,Math.min((i+1)*CATALOG_PAGE_SIZE,items.length))}</option>)}</select><button type="button" disabled={busy||!onPageChange||(safePage===loadedPages-1&&!hasMore)} onClick={()=>onPageChange?.(safePage+1)}>{busy?"读取中…":"下一页"}</button></div>
      <div className="practice-question-number-groups" aria-label="本页练习组">{Array.from({length:Math.ceil((end-start)/PRACTICE_GROUP_SIZE)},(_,offset)=>{
        const first=start+offset*PRACTICE_GROUP_SIZE,last=Math.min(first+PRACTICE_GROUP_SIZE,end);
        return <button type="button" key={first} aria-pressed={selectedGroup===offset} disabled={busy} onClick={()=>onSelect(first)}>第 {Math.floor(first/PRACTICE_GROUP_SIZE)+1} 组 · {last-first} 题</button>;
      })}</div>
      <p className="practice-question-number-help">练习第 {groupIndex+1} 组：{groupStart+1}–{groupEnd}，{groupEnd-groupStart} 题{count==null&&hasMore?"（后续按需读取）":""}</p>
      <div className="practice-question-number-grid">{items.slice(groupStart,groupEnd).map((item,offset)=>{const i=groupStart+offset;return <button type="button" key={item.id} className={`${item.status??"unrecorded"}${i===index?" active":""}`} aria-current={i===index?"location":undefined} aria-label={`跳到${numberedProblemLabel(item.number??i+1,item.title)}${i===index?"，当前题":""}${item.status?`，${navigationStatusLabel[item.status]}`:""}`} onClick={()=>onSelect(i)}><span>{item.number??i+1}</span>{item.status&&navigationStatusMark[item.status]&&<small aria-hidden="true">{navigationStatusMark[item.status]}</small>}</button>;})}</div>
      {items.some(item=>item.status&&item.status!=="pending")&&<p className="practice-question-number-legend">✓ 已完成　阅 已看解析　… 待复核</p>}
      <p className="practice-question-number-help">点题号定位题目，点题目开始练习；翻页每次显示 50 题，练习按 25 题分组。</p>
    </>}
  </nav>;
}
