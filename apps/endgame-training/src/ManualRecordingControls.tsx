import { ArrowLeft, BookOpen, ChartNoAxesCombined, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Database, FilePenLine, FileUp, FlipVertical2, GitBranch, Lightbulb, List, Pause, Pencil, Play, Plus, Save, Settings2, Star, X, Zap } from "lucide-react";
import { manualAiLabel, manualAiMode, type ManualAiPhase } from "./manualAiMode";
import { ManualAiIcon, ManualAnalysisIcon } from "./ManualControlIcons";
export type ManualControlAction = "variation"|"return"|"settings"|"metadata"|"favorite"|"save"|"import"|"rehearse"|"comments"|"library"|"engine"|"analysis"|"new"|"setup"|"moves"|"report"|"previous"|"next"|"previousVariation"|"nextVariation"|"play"|"flip"|"copy"|"start"|"end"|"explain"|"instant";
type Props = {
  cursor:number; moveCount:number; canGoNext?:boolean; previousVariation:boolean; nextVariation:boolean; playing:boolean; enginePhase:ManualAiPhase; flipped:boolean; favorite:boolean; readOnly:boolean;
  menuOpen:boolean; onMenu(open:boolean):void; onAction(action:ManualControlAction):void; part?:"toolbar"|"playback"|"all";
  layout?:"recording"|"analysis"; onBack?():void; instantPending?:boolean; instantDisabled?:boolean;
};
export function ManualRecordingControls({cursor,moveCount,canGoNext,previousVariation,nextVariation,playing,enginePhase,flipped,favorite,readOnly,menuOpen,onMenu,onAction,part="all",layout="recording",onBack,instantPending=false,instantDisabled=false}:Props) {
  const run=(action:ManualControlAction)=>{onMenu(false);onAction(action);};
  const mode=manualAiMode(enginePhase), aiLabel=manualAiLabel(mode);
  const aiIcon=<ManualAiIcon mode={mode}/>;
  const aiButton=<button type="button" aria-label={aiLabel} aria-pressed={mode!=="disabled"} data-ai-mode={mode} onClick={()=>run("engine")}>{aiIcon}<span>{aiLabel}</span></button>;
  const menuButton=<button type="button" aria-label="更多功能" aria-expanded={menuOpen} onClick={()=>onMenu(!menuOpen)}><List/><span>菜单</span></button>;
  return <>
    {part!=="playback" && layout==="analysis" && <nav className="manual-analysis-command-bar" aria-label="录谱分析工具栏">
      <button type="button" aria-label="返回录谱" onClick={()=>{onMenu(false);onBack?.();}}><ArrowLeft/><span>返回录谱</span></button>
      {menuButton}
      <button type="button" className="manual-instant-button" aria-label="闪电出招" title="走引擎最优一步" aria-busy={instantPending} disabled={readOnly||instantDisabled||instantPending} onClick={()=>run("instant")}><Zap/><span>{instantPending?"计算中":"闪电出招"}</span></button>
      <button type="button" onClick={()=>run("new")}><Plus/><span>新增</span></button>
      <button type="button" aria-label="翻转" aria-pressed={flipped} onClick={()=>run("flip")}><FlipVertical2/><span>翻转</span></button>
      {aiButton}
    </nav>}
    {part!=="playback" && layout==="recording" && <>
      <nav className="recording-quick-actions" aria-label="录谱工具栏">
        {aiButton}
        <button type="button" onClick={()=>run("variation")}><GitBranch/><span>自由推演</span></button>
        <button type="button" title="进入独立分析页面" onClick={()=>run("analysis")}><ManualAnalysisIcon/><span>分析</span></button>
        <button type="button" onClick={()=>run("new")}><Plus/><span>新增棋谱</span></button>
        <button type="button" disabled={readOnly} onClick={()=>run("setup")}><Pencil/><span>摆棋</span></button>
        <button type="button" className="manual-instant-button" aria-label="闪电出招" title="走引擎最优一步" aria-busy={instantPending} disabled={readOnly||instantDisabled||instantPending} onClick={()=>run("instant")}><Zap/><span>{instantPending?"计算中":"闪电出招"}</span></button>
      </nav>
    </>}
    {part!=="toolbar" && <>
      <nav className={`recording-navigation manual-playback-controls${layout==="analysis"?" manual-analysis-navigation":""}`} aria-label="棋谱播放与导航">
        {layout==="analysis" ? <>
          <button type="button" aria-label="起点" disabled={!cursor} onClick={()=>run("start")}><ChevronsLeft/></button>
          <button type="button" aria-label="上一步" disabled={!cursor} onClick={()=>run("previous")}><ChevronLeft/></button>
          <button type="button" aria-label={playing?"暂停播放":"播放棋谱"} aria-pressed={playing} disabled={!moveCount&&!canGoNext} onClick={()=>run("play")}>{playing?<Pause/>:<Play/>}</button>
          <button type="button" aria-label="下一步" disabled={!(canGoNext??cursor<moveCount)} onClick={()=>run("next")}><ChevronRight/></button>
          <button type="button" aria-label="终点" disabled={cursor>=moveCount} onClick={()=>run("end")}><ChevronsRight/></button>
        </> : <>
        {menuButton}
        <button type="button" disabled={!previousVariation} onClick={()=>run("previousVariation")}><ChevronsLeft/><span>上变</span></button>
        <button type="button" aria-label="上一步" disabled={!cursor} onClick={()=>run("previous")}><ChevronLeft/><span>上一步</span></button>
        <button type="button" aria-label={playing?"暂停播放":"播放棋谱"} aria-pressed={playing} disabled={!moveCount&&!canGoNext} onClick={()=>run("play")}>{playing?<Pause/>:<Play/>}<span>{playing?"暂停":"播放"}</span></button>
        <button type="button" aria-label="下一步" disabled={!(canGoNext??cursor<moveCount)} onClick={()=>run("next")}><ChevronRight/><span>下一步</span></button>
        <button type="button" disabled={!nextVariation} onClick={()=>run("nextVariation")}><ChevronsRight/><span>下变</span></button>
        <button type="button" aria-label="翻转" aria-pressed={flipped} onClick={()=>run("flip")}><FlipVertical2/><span>翻转</span></button>
        <button type="button" onClick={()=>run("report")}><ChartNoAxesCombined/><span>报告</span></button>
        </>}
      </nav>
    </>}
      {menuOpen && (layout==="analysis" ? part!=="playback" : part!=="toolbar") && <>
        <button type="button" className="recording-menu-dismiss" aria-label="关闭录谱菜单" onClick={()=>onMenu(false)}/>
        <section className="recording-action-menu" aria-label="录谱菜单">
          <header><strong>录谱功能</strong><button type="button" aria-label="关闭菜单" onClick={()=>onMenu(false)}><X/></button></header>
          {layout==="analysis" && <button type="button" onClick={()=>{onMenu(false);onBack?.();}}><ArrowLeft/><span>返回录谱</span></button>}
          <button type="button" onClick={()=>run("return")}><ArrowLeft/><span>返回我的棋谱</span></button>
          <button type="button" disabled={!cursor} onClick={()=>run("start")}><ChevronsLeft/><span>起点</span></button>
          <button type="button" disabled={cursor>=moveCount} onClick={()=>run("end")}><ChevronsRight/><span>终点</span></button>
          <button type="button" aria-label={`切换模式：${aiLabel}`} onClick={()=>run("engine")}>{aiIcon}<span>{aiLabel} · 切换模式</span></button>
          {layout==="analysis" && <>
            <button type="button" disabled={!moveCount&&!canGoNext} onClick={()=>run("play")}>{playing?<Pause/>:<Play/>}<span>{playing?"暂停播放":"播放棋谱"}</span></button>
            <button type="button" disabled={!previousVariation} onClick={()=>run("previousVariation")}><ChevronsLeft/><span>上变</span></button>
            <button type="button" disabled={!nextVariation} onClick={()=>run("nextVariation")}><ChevronsRight/><span>下变</span></button>
            <button type="button" onClick={()=>run("variation")}><GitBranch/><span>自由推演</span></button>
            <button type="button" disabled={readOnly} onClick={()=>run("setup")}><Pencil/><span>摆棋</span></button>
          </>}
          <button type="button" onClick={()=>run("new")}><Plus/><span>新建棋谱</span></button>
          <button type="button" onClick={()=>run("library")}><Database/><span>我的棋谱</span></button>
          <button type="button" disabled={readOnly} onClick={()=>run("metadata")}><FilePenLine/><span>棋谱信息</span></button>
          <button type="button" disabled={readOnly} aria-pressed={favorite} onClick={()=>run("favorite")}><Star fill={favorite?"currentColor":"none"}/><span>{favorite?"取消收藏":"收藏棋谱"}</span></button>
          <button type="button" onClick={()=>run(readOnly?"copy":"save")}><Save/><span>{readOnly?"复制到我的棋谱":"保存棋谱"}</span></button>
          <button type="button" onClick={()=>run("import")}><FileUp/><span>导入棋谱</span></button>
          <button type="button" disabled={!moveCount} onClick={()=>run("rehearse")}><BookOpen/><span>背谱练习</span></button>
          <button type="button" disabled={!cursor} onClick={()=>run("explain")}><Lightbulb/><span>讲解这步</span></button>
          <button type="button" onClick={()=>run("report")}><ChartNoAxesCombined/><span>整局报告</span></button>
          <button type="button" aria-label="查看棋谱与注释" onClick={()=>run("moves")}><ClipboardList/><span>棋谱与注释</span></button>
          <button type="button" onClick={()=>run("comments")}><ClipboardList/><span>注释与变招</span></button>
          <button type="button" onClick={()=>run("settings")}><Settings2/><span>棋盘与引擎设置</span></button>
        </section>
      </>}
  </>;
}
