import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { numberedProblemLabel, navigationStatusLabel, navigationStatusMark, type ProblemNavigationStatus } from "./practiceNavigation";
import "./practiceQuestionNumbers.css";

type Item = { id: string; title: string; number?: number; status?: ProblemNavigationStatus };
const PREFERENCE = "qixi-catalog-numbers-collapsed-v1";
/** Browse only the loaded catalog; selecting a number locates its card. */
export function PracticeQuestionNumbers({items,index=-1,total,hasMore=false,onSelect}: {items:Item[];index?:number;total?:number|null;hasMore?:boolean;onSelect(index:number):void}) {
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(PREFERENCE)==="true";}catch{return false;}});
  const [group,setGroup]=useState(()=>index>=0?Math.floor(index/20):0);
  useEffect(()=>{setGroup(index>=0?Math.floor(index/20):0);},[items[0]?.id,index]);
  if (!items.length) return null;
  const pageCount=Math.ceil(items.length/20),safeGroup=Math.min(group,pageCount-1),start=safeGroup*20,end=Math.min(start+20,items.length);
  const range=(from:number,to:number)=>`${items[from].number??from+1}–${items[to-1].number??to}`;
  return <nav className="practice-question-numbers" aria-label="题库数字导航">
    <header><strong>题号 <small>{range(start,end)}</small><small className="practice-question-total">已显示 {items.length}{total!=null?` / 共 ${total}`:""} 题</small></strong><button type="button" aria-label={collapsed?"展开数字导航":"收起数字导航"} aria-expanded={!collapsed} onClick={()=>{
      const next=!collapsed;setCollapsed(next);try{localStorage.setItem(PREFERENCE,String(next));}catch{/* Keep browsing when storage is unavailable. */}
    }}>{collapsed?"展开":"收起"}{collapsed?<ChevronDown/>:<ChevronUp/>}</button></header>
    {!collapsed&&<>
      {pageCount>1&&<div className="practice-question-number-pages"><button type="button" disabled={safeGroup===0} onClick={()=>setGroup(safeGroup-1)}>上一组</button><select aria-label="题号范围" value={safeGroup} onChange={e=>setGroup(Number(e.target.value))}>{Array.from({length:pageCount},(_,i)=><option key={i} value={i}>{range(i*20,Math.min((i+1)*20,items.length))}</option>)}</select><button type="button" disabled={safeGroup===pageCount-1} onClick={()=>setGroup(safeGroup+1)}>下一组</button></div>}
      <div className="practice-question-number-grid">{items.slice(start,end).map((item,offset)=>{const i=start+offset;return <button type="button" key={item.id} className={`${item.status??"unrecorded"}${i===index?" active":""}`} aria-current={i===index?"location":undefined} aria-label={`跳到${numberedProblemLabel(item.number??i+1,item.title)}${i===index?"，当前题":""}${item.status?`，${navigationStatusLabel[item.status]}`:""}`} onClick={()=>onSelect(i)}><span>{item.number??i+1}</span>{item.status&&navigationStatusMark[item.status]&&<small aria-hidden="true">{navigationStatusMark[item.status]}</small>}</button>;})}</div>
      {items.some(item=>item.status&&item.status!=="pending")&&<p className="practice-question-number-legend">✓ 已完成　阅 已看解析　… 待复核</p>}
      <p className="practice-question-number-help">点题号定位题目，点题目开始练习{hasMore?"；更多题目在列表底部读取下一页":""}。</p>
    </>}
  </nav>;
}
