// Simulator-only presentation fixture. Not an entry in the production build.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TeachingCatalog } from "../src/TeachingCatalog";
import { MobilePracticeSolverPanel } from "../src/App";
import { canViewExerciseSolutions } from "../src/exercisePresentation";
import { teachingClient, type TeachingAuth } from "../src/teaching";
import type { TrainingProblem } from "../src/types";
import "../src/styles.css";
import "./preview.css";
import { usePracticeClock } from "../src/usePracticeClock";

document.documentElement.classList.add("phone-webview");
const topic={id:"preview-topic",name:"基础杀法",kind:"topic",teachingEntry:"basic_mates",displayOrder:0,active:true,confirmed:true,itemCount:100,materialCount:1};
const chapter={...topic,id:"preview-chapter",name:"两步杀练习",kind:"chapter",parentId:topic.id};
const problem:TrainingProblem={id:"p1",serverProblemId:"p1",libraryId:"local",sourceIndex:0,title:"两步杀 · 寻找关键着法",category:"杀法",startingFen:"4k4/4a4/9/9/9/9/9/4R4/9/4K4 w",solution:[],note:"",completedAttempts:0,totalElapsedMs:0};
teachingClient.presentationScope=a=>`preview:${a?.user.id??"guest"}:${a?.user.role??"guest"}`;
teachingClient.catalogBrowse=async params=>({currentNode:params.nodeId===chapter.id?chapter:params.nodeId?topic:null,breadcrumbs:params.nodeId===chapter.id?[topic,chapter]:params.nodeId?[topic]:[],children:params.nodeId===chapter.id?[]:params.nodeId?[chapter]:[topic],learningMaterials:params.view==="materials"?[{id:"g1",title:"教材棋谱学习",reviewStatus:"approved"}]:[],mateStepCounts:[{mateMoves:2,itemCount:100}],statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1",statisticsReady:true});
teachingClient.catalogProblems=async (_id,params)=>({items:Array.from({length:params.cursor?2:3},(_,i)=>({...problem,id:`p${params.cursor?i+4:i+1}`,sourceIndex:params.cursor?i+3:i,title:i===0?problem.title:`练习 ${i+1} · 不同子力配合`,sideToMove:"red",solutionLength:3,verifiedMateMoves:2,trainingGoal:i===1?{kind:"mate",mateMoves:2}:undefined})),nextCursor:params.cursor?null:"next"}) as never;

function Preview(){
  const [role,setRole]=useState("student"),[page,setPage]=useState("catalog"),[total,setTotal]=useState(1),[index,setIndex]=useState(0),[ended,setEnded]=useState(false),[revealed,setRevealed]=useState(false),[demo,setDemo]=useState(false),[hint,setHint]=useState(0),[message,setMessage]=useState("");
  const {elapsed: elapsedMs, reset: resetClock, running} = usePracticeClock(page === "solver" && !ended);
  const elapsed = `${String(Math.floor(elapsedMs / 60000)).padStart(2,"0")}:${String(Math.floor(elapsedMs / 1000) % 60).padStart(2,"0")}`;
  const auth={user:{id:role,role:role==="vip"||role==="expired"?"student":role,vipActive:role==="vip",vipExpiresAt:role==="expired"?"2000-01-01":undefined,displayName:role}} as TeachingAuth;
  const allowed=canViewExerciseSolutions(auth);
  const reset=()=>{resetClock();setEnded(false);setRevealed(false);setDemo(false);setHint(0);setMessage("");};
  return <div className="app mobile-app presentation-preview">
    <header className="preview-toolbar">
      <div className="preview-toolbar-title"><strong>界面验收</strong><small>隔离数据 · 不产生正式成绩</small></div>
      <div className="preview-toolbar-controls">
        <select aria-label="验收角色" value={role} onChange={e=>{setRole(e.target.value);reset();}}>{[["student","普通学生"],["vip","VIP学生"],["expired","过期VIP"],["coach","老师"],["admin","管理员"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        <nav aria-label="验收页面"><button aria-pressed={page==="catalog"} onClick={()=>{setPage("catalog");reset();}}>题库</button><button aria-pressed={page==="solver"} onClick={()=>{setPage("solver");reset();}}>做题</button></nav>
        {page==="solver"&&<button className="preview-count-toggle" onClick={()=>{setTotal(n=>n===1?3:1);setIndex(0);}}>切换{total===1?"多题":"单题"}</button>}
      </div>
      <small className="preview-status" role="status">{message}</small>
    </header>
    <div className="mobile-content" style={{flex:1,minHeight:0,overflowY:"auto",padding:10}}>{page==="catalog"?<TeachingCatalog auth={auth} teacher={allowed} compact scene="browse" onPractice={(ids,_title,selected)=>{reset();setTotal(ids.length);setIndex(Math.max(0,ids.indexOf(selected??ids[0])));setPage("solver");}} onReadSolution={()=>setMessage("老师题解入口已响应")} onReadGame={()=>setMessage("正常教材学习入口已响应")}/>:<MobilePracticeSolverPanel key={role} answersAllowed={allowed} problem={problem} pieces={[{row:0,col:4,color:"black",kind:"king",label:"将"},{row:1,col:4,color:"black",kind:"advisor",label:"士"},{row:7,col:4,color:"red",kind:"rook",label:"车"},{row:9,col:4,color:"red",kind:"king",label:"帅"}]} legalTargets={[]} hints={hint} mistakes={0} elapsed={elapsed} timerPaused={!running} ended={ended} revealed={revealed&&allowed} resultOutcome={ended?revealed?"revealed":"completed":undefined} notice="可以试走，提示和重来仍可使用。" boardSkin="classic" pieceSkin="classic" riverText="楚河　汉界" riverTextColor="#665331" riverTextSize={26} supportsCustomRiverText={false} onSquare={()=>{}} onMove={()=>{}} onBack={()=>setPage("catalog")} onHint={()=>setHint(n=>Math.min(3,n+1))} onRestart={reset} onReveal={()=>{if(allowed){setRevealed(true);setEnded(true);}}} onNext={()=>setMessage("查看结果已响应")} onPrevious={()=>setIndex(n=>Math.max(0,n-1))} onFinish={()=>{setEnded(true);setMessage("结束练习已响应");}} onFavorite={()=>{}} favoriteEnabled={false} backLabel="返回题库" answer={["车五进一","将5平6","车五平四"]} answerStep={0} demoPlaying={demo} onPreviewStep={()=>{}} onTogglePreview={()=>setDemo(v=>!v)} onRetryWrongMove={()=>{}} navigator={{items:Array.from({length:total},(_,i)=>({id:`p${i}`,title:`练习${i+1}`,status:"pending"})),index,onSelect:setIndex}}/>}</div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
