import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { numberedProblemLabel, navigationStatusLabel, navigationStatusMark, type ProblemNavigationStatus } from "./practiceNavigation";
import "./practiceQuestionNumbers.css";

type Item = { id: string; title: string; number?: number; status: ProblemNavigationStatus };
const PREFERENCE = "qixi-practice-numbers-collapsed-v1";
/** Inline navigation belongs to the scrollable controls, never to board sizing. */
export function PracticeQuestionNumbers({items,index,onSelect}: {items:Item[];index:number;onSelect(index:number):void}) {
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(PREFERENCE)==="true";}catch{return false;}});
  if (!items.length) return null;
  return <nav className="practice-question-numbers" aria-label="练习数字导航">
    <header><strong>题号 <small>{items[0].number??1}–{items.at(-1)?.number??items.length}</small></strong><button type="button" aria-label={collapsed?"展开数字导航":"收起数字导航"} aria-expanded={!collapsed} onClick={()=>{
      const next=!collapsed;setCollapsed(next);try{localStorage.setItem(PREFERENCE,String(next));}catch{/* The current view remains usable without persisted preferences. */}
    }}>{collapsed?"展开":"收起"}{collapsed?<ChevronDown/>:<ChevronUp/>}</button></header>
    {!collapsed&&<><div className="practice-question-number-grid">{items.map((item,i)=><button type="button" key={item.id} className={`${item.status}${i===index?" active":""}`} aria-current={i===index?"step":undefined} aria-label={`跳到${numberedProblemLabel(item.number??i+1,item.title)}${i===index?"，当前题":""}，${navigationStatusLabel[item.status]}`} onClick={()=>onSelect(i)}><span>{item.number??i+1}</span>{navigationStatusMark[item.status]&&<small aria-hidden="true">{navigationStatusMark[item.status]}</small>}</button>)}</div><p className="practice-question-number-legend">✓ 已完成　阅 已看解析　… 待复核</p></>}
  </nav>;
}
