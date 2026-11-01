import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronRight, Route, X } from "lucide-react";
import type { TeachingCatalogNode } from "./TeachingCatalog";
import { isPublicCatalogEntry } from "./catalogAccess";
import { useCatalogBrowse } from "./useCatalogBrowse";
import "./learningRoutes.css";

import { learningRouteTarget, type LearningRouteKind, type LearningRouteSelection, type LearningRouteAction } from "./learningRouteNavigation";
export type { LearningRouteKind, LearningRouteSelection, LearningRouteAction } from "./learningRouteNavigation";
type Stage = { id: string; title: string; idea: string; check: string; actions: LearningRouteAction[] };
export const LEARNING_ROUTES: Record<LearningRouteKind, {title: string; introduction: string; stages: Stage[]}> = {
  mate: {title:"杀法学习路线", introduction:"从识别一步杀到计算实战变化，先看清退路，再核对对方应手。", stages:[
    {id:"one",title:"一步杀 · 找准将位",idea:"观察将帅位置、可逃格和己方攻击点，找能直接结束战斗的一着。",check:"走之前说清楚：对手为什么不能逃、挡或吃掉将军子？",actions:[{label:"练一步杀",entry:"basic_mates",step:"1"}]},
    {id:"two",title:"两步杀 · 算出防守",idea:"先找候选将军，再逐一核对对手的合法应手，不只记住第一步。",check:"至少说明对方最顽强的一种防守，以及自己的第二着。",actions:[{label:"练两步杀",entry:"basic_mates",step:"2"}]},
    {id:"calculate",title:"三四步 · 连贯计算",idea:"把变化按双方轮流行棋展开，每一步都检查是否漏算吃子、垫子和退将。",check:"尽量先在心中算完整条变化，再上棋盘验证。",actions:[{label:"练三步杀",entry:"basic_mates",step:"3"},{label:"练四步杀",entry:"basic_mates",step:"4"}]},
    {id:"forcing",title:"连将与非连将 · 理解威胁",idea:"连将时核对全部应手；非连将时观察封路、配合和准备着带来的威胁。",check:"比较直接将军和先改善位置，解释两者的区别。",actions:[{label:"练连将杀",entry:"checking_mates",step:"all"},{label:"练非连将杀",entry:"quiet_mates",step:"all"}]},
    {id:"practical",title:"实战运用 · 灵活选择",idea:"在复杂局面中分清杀棋、得子和改善位置，避免看见将军就急于出手。",check:"复盘时找出关键防守和自己最容易遗漏的一着。",actions:[{label:"实战杀法",entry:"practical_mates",step:"all"},{label:"残局杀法",entry:"endgame_mates",step:"all"}]},
  ]},
  endgame: {title:"残局学习路线", introduction:"先分清求胜还是求和，再学习子力配合、限制对方和优势兑现。", stages:[
    {id:"goal",title:"基本胜和 · 明确目标",idea:"先读题目目标，比较双方子力与将帅安全；求和题要主动寻找防守资源。",check:"不要只看引擎分数，要能解释胜法或守和的依据。",actions:[{label:"练残局胜法",entry:"practical_endgames",goal:"endgame_win"},{label:"练求和防守",entry:"practical_endgames",goal:"draw"}]},
    {id:"pawn",title:"兵卒参与 · 位置与时机",idea:"观察兵卒能否推进、将帅能否助攻，以及推进后是否失去保护或放走对方。",check:"比较立即进兵与先改善将帅位置的结果。",actions:[{label:"含兵卒残局",entry:"practical_endgames",material:"p"}]},
    {id:"pieces",title:"车马炮参与 · 子力配合",idea:"逐类练习限制对方、改善位置和制造威胁，比较不同兵种的活动空间。",check:"以下筛选表示任一方含该兵种，不代表纯车、纯马或纯炮残局。",actions:[{label:"含车残局",entry:"practical_endgames",material:"r"},{label:"含马残局",entry:"practical_endgames",material:"n"},{label:"含炮残局",entry:"practical_endgames",material:"c"}]},
    {id:"books",title:"综合学习 · 按章节深入",idea:"在实用残局书本目录中按章节学习，把同类局面的典型思路放在一起比较。",check:"具体技术名称以题目已有讲解为准，不根据题名猜测。",actions:[{label:"按书本学习",entry:"practical_endgames",books:true}]},
    {id:"review",title:"优势兑现 · 复盘巩固",idea:"比较交换、推进兵和转入另一种残局的时机，认真分析对手最顽强的应手。",check:"看题解后遮住答案重做，隔天再练；看过解析不等于独立掌握。",actions:[{label:"综合残局练习",entry:"practical_endgames"}]},
  ]},
};

export function LearningRouteEntries({ onOpen }: { onOpen(route:LearningRouteKind):void }) {
  return <nav className="learning-route-entries" aria-label="推荐学习路线">
    {(["mate","endgame"] as const).map(kind=><button type="button" key={kind} onClick={()=>onOpen(kind)}><Route aria-hidden="true"/><span><strong>{LEARNING_ROUTES[kind].title}</strong><small>{kind==="mate"?"由浅入深，练观察与计算":"先辨胜和，再学子力配合"}</small></span><ChevronRight aria-hidden="true"/></button>)}
  </nav>;
}

export function LearningRouteSheet({ initialRoute, selection, request, restricted, scope, libraryId, onSelect, onClose }: {
  initialRoute:LearningRouteKind; selection?:LearningRouteSelection; restricted:boolean; scope:string; libraryId?:string;
  request(params:Record<string,string>,signal:AbortSignal):ReturnType<typeof import("./teaching").teachingClient.catalogBrowse>;
  onSelect(node:TeachingCatalogNode, action:LearningRouteAction, selection:LearningRouteSelection, signal:AbortSignal):void|Promise<void>; onClose():void;
}) {
  const [kind,setKind]=useState(initialRoute);
  const [pending,setPending]=useState<string>();
  const [actionError,setActionError]=useState<{key:string;message:string}>();
  const actionTask=useRef<AbortController|undefined>(undefined);
  const cancelAction=()=>{actionTask.current?.abort();actionTask.current=undefined;setPending(undefined);setActionError(undefined);};
  useEffect(()=>()=>{actionTask.current?.abort();},[]);
  async function choose(node:TeachingCatalogNode, action:LearningRouteAction, stage:Stage, key:string) {
    if(actionTask.current)return;
    const task=new AbortController();actionTask.current=task;setPending(key);setActionError(undefined);
    try {await onSelect(node,action,{route:kind,stage:stage.id,title:stage.title,entry:action.entry,action},task.signal);}
    catch(reason){if(!task.signal.aborted&&actionTask.current===task)setActionError({key,message:reason instanceof Error?reason.message:"读取失败，请重试。"});}
    finally{if(actionTask.current===task){actionTask.current=undefined;if(!task.signal.aborted)setPending(undefined);}}
  }
  const dialog=useRef<HTMLElement>(null),close=useRef(onClose); close.current=onClose;
  const browse=useCatalogBrowse<TeachingCatalogNode>(request,{availability:"available",allowStaleCounts:"true",limit:"50",...(libraryId?{libraryId}:{})},false,0,0,scope);
  const route=LEARNING_ROUTES[kind];
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:undefined;
    const page=previous?.closest<HTMLElement>(".mobile-library-page");
    const overflow=page?.style.overflow;
    if(page)page.style.overflow="hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".learning-route-close")?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==="Escape"){e.preventDefault();close.current();}
      if(e.key!=="Tab")return;
      const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")??[]).filter(b=>b.getClientRects().length);
      if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus();}
      else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus();}
    };
    document.addEventListener("keydown",key);
    return()=>{document.removeEventListener("keydown",key);if(page)page.style.overflow=overflow??"";if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return createPortal(<div className="learning-route-backdrop" onClick={onClose}>
    <section ref={dialog} className="learning-route-sheet" role="dialog" aria-modal="true" aria-label="学习路线" onClick={e=>e.stopPropagation()}>
      <header><BookOpen aria-hidden="true"/><strong>学习路线</strong><button className="learning-route-close" type="button" aria-label="关闭学习路线" onClick={onClose}><X/></button></header>
      <div className="learning-route-tabs" role="tablist" aria-label="选择学习路线">{(["mate","endgame"] as const).map(value=><button type="button" role="tab" aria-selected={kind===value} key={value} onClick={()=>{cancelAction();setKind(value);}}>{LEARNING_ROUTES[value].title}</button>)}</div>
      <div className="learning-route-content" role="tabpanel" aria-label={route.title} key={kind} tabIndex={0}>
        <p className="learning-route-intro">{route.introduction}</p>
        <p className="learning-route-method">学思路 → 独立做题 → 回放复盘 → 遮住答案重做<br/>每次约 15–20 分钟，同一主题选 5–10 题。</p>
        {browse.loading&&<p role="status">正在核对可用题库…</p>}
        {browse.error&&<p role="alert">题库读取失败，学习方法仍可查看。<button type="button" onClick={browse.retry}>重试题库</button></p>}
        <ol>{route.stages.map((stage,index)=><li key={stage.id} aria-current={selection?.route===kind&&selection.stage===stage.id?"step":undefined}>
          <h3><span>{index+1}</span>{stage.title}</h3><p>{stage.idea}</p><p className="learning-route-check">练后自查：{stage.check}</p>
          <div className="learning-route-actions">{stage.actions.map(action=>{
            const key=`${kind}:${stage.id}:${action.label}`;
            const forbidden=restricted&&!isPublicCatalogEntry(action.entry);
            const node=forbidden?undefined:browse.page.children.find(n=>n.teachingEntry===action.entry&&n.active&&n.confirmed&&(n.itemCount==null||n.itemCount>0));
            const unavailable=forbidden?"当前账号暂无此专题权限":browse.loading?"正在核对题库":browse.error?"请先重试题库":browse.page.nextCursor?"可载入更多目录后再查看":"暂无可练题目";
            return <span key={action.label}><button type="button" aria-pressed={selection?.action?.label===action.label&&selection.route===kind} aria-busy={pending===key} disabled={!node||browse.loading||!!browse.error||!!pending} onClick={()=>{if(node&&!browse.loading&&!browse.error)void choose(node,action,stage,key);}}>{pending===key?"核对题目中…":action.label}<ChevronRight aria-hidden="true"/></button><small className="learning-route-target">{learningRouteTarget(action)}</small>{(!node||browse.error)&&<small>{unavailable}</small>}{actionError?.key===key&&<small className="learning-route-action-error" role="alert">{actionError.message}</small>}</span>;
          })}</div>
        </li>)}</ol>
        {browse.page.nextCursor&&<button type="button" disabled={browse.loading} onClick={()=>void browse.more()}>载入更多学习目录</button>}
        <p className="learning-route-footnote">这是推荐的学习顺序，阶段可自由选择。题目、提示与题解沿用账号及作业权限；具体筛选以目录实际返回的题目为准。</p>
      </div>
    </section>
  </div>,document.body);
}
