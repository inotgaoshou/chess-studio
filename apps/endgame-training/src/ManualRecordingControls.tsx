import { ArrowLeft, BookOpen, ChartNoAxesCombined, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Cpu, Database, EyeOff, FilePenLine, FileUp, FlipVertical2, List, Pause, Pencil, Play, Plus, Save, Settings2, Star, X } from "lucide-react";
export type ManualControlAction = "return"|"settings"|"metadata"|"favorite"|"save"|"import"|"rehearse"|"comments"|"library"|"engine"|"analysis"|"new"|"setup"|"moves"|"report"|"previous"|"next"|"previousVariation"|"nextVariation"|"play"|"flip"|"copy";
export function ManualRecordingControls({cursor,moveCount,previousVariation,nextVariation,playing,engineEnabled,flipped,favorite,readOnly,menuOpen,onMenu,onAction}:{
 cursor:number;moveCount:number;previousVariation:boolean;nextVariation:boolean;playing:boolean;engineEnabled:boolean;flipped:boolean;favorite:boolean;readOnly:boolean;menuOpen:boolean;onMenu(open:boolean):void;onAction(action:ManualControlAction):void;
}) {
 const run=(action:ManualControlAction)=>{onMenu(false);onAction(action);};
 return <>
  <div className="recording-quick-actions" aria-label="录谱快捷工具">
   <button type="button" aria-pressed={engineEnabled} onClick={()=>run("engine")}>{engineEnabled?<Cpu/>:<EyeOff/>}<span>AI {engineEnabled?"开启":"禁用"}</span></button>
   <button type="button" onClick={()=>run("analysis")}><Cpu/><span>分析</span></button>
   <button type="button" disabled={readOnly} onClick={()=>run("new")}><Plus/><span>新增棋谱</span></button>
   <button type="button" disabled={readOnly} onClick={()=>run("setup")}><Pencil/><span>摆棋</span></button>
   <button type="button" aria-label="查看棋谱与注释" onClick={()=>run("moves")}><ClipboardList/><span>信息</span></button>
  </div>
  <nav className="recording-navigation" aria-label="棋谱播放与导航">
   <button type="button" aria-expanded={menuOpen} className={menuOpen?"active":""} onClick={()=>onMenu(!menuOpen)}><List/><span>菜单</span></button>
   <button type="button" disabled={!previousVariation} onClick={()=>run("previousVariation")}><ChevronsLeft/><span>上变</span></button>
   <button type="button" disabled={!cursor} onClick={()=>run("previous")}><ChevronLeft/><span>上一步</span></button>
   <button type="button" disabled={!moveCount} aria-label={playing?"暂停播放":"播放棋谱"} aria-pressed={playing} onClick={()=>run("play")}>{playing?<Pause/>:<Play/>}<span>{playing?"暂停":"播放"}</span></button>
   <button type="button" disabled={cursor>=moveCount} onClick={()=>run("next")}><ChevronRight/><span>下一步</span></button>
   <button type="button" disabled={!nextVariation} onClick={()=>run("nextVariation")}><ChevronsRight/><span>下变</span></button>
   <button type="button" aria-pressed={flipped} onClick={()=>run("flip")}><FlipVertical2/><span>翻转</span></button>
   <button type="button" disabled={!moveCount} onClick={()=>run("report")}><ChartNoAxesCombined/><span>报告</span></button>
  </nav>
  {menuOpen&&<>
   <button type="button" className="recording-menu-dismiss" aria-label="关闭录谱菜单" onClick={()=>onMenu(false)}/>
   <section className="recording-action-menu" aria-label="录谱菜单">
    <header><strong>录谱功能</strong><button type="button" aria-label="关闭菜单" onClick={()=>onMenu(false)}><X/></button></header>
    <button type="button" onClick={()=>run("return")}><ArrowLeft/><span>返回我的棋谱</span></button>
    <button type="button" onClick={()=>run("settings")}><Settings2/><span>棋盘与引擎设置</span></button>
    <button type="button" disabled={readOnly} onClick={()=>run("metadata")}><FilePenLine/><span>棋谱信息</span></button>
    <button type="button" disabled={readOnly} aria-pressed={favorite} onClick={()=>run("favorite")}><Star fill={favorite?"currentColor":"none"}/><span>{favorite?"取消收藏":"收藏棋谱"}</span></button>
    <button type="button" onClick={()=>run(readOnly?"copy":"save")}><Save/><span>{readOnly?"复制到我的棋谱":"保存棋谱"}</span></button>
    <button type="button" onClick={()=>run("import")}><FileUp/><span>导入棋谱</span></button>
    <button type="button" disabled={!moveCount} onClick={()=>run("rehearse")}><BookOpen/><span>背谱练习</span></button>
    <button type="button" onClick={()=>run("comments")}><FilePenLine/><span>注释与变招</span></button>
    <button type="button" onClick={()=>run("library")}><Database/><span>我的棋谱</span></button>
   </section>
  </>}
 </>;
}
