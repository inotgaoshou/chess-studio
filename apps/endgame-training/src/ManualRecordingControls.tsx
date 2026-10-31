import { ArrowLeft, BookOpen, ChartNoAxesCombined, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Cpu, Database, Ellipsis, EyeOff, FilePenLine, FileUp, FlipVertical2, GitBranch, Lightbulb, Pause, Pencil, Play, Plus, Save, Search, Settings2, Star, X } from "lucide-react";
export type ManualControlAction = "variation"|"return"|"settings"|"metadata"|"favorite"|"save"|"import"|"rehearse"|"comments"|"library"|"engine"|"analysis"|"new"|"setup"|"moves"|"report"|"previous"|"next"|"previousVariation"|"nextVariation"|"play"|"flip"|"copy"|"start"|"end"|"explain";
type Props = {
  cursor:number; moveCount:number; canGoNext?:boolean; previousVariation:boolean; nextVariation:boolean; playing:boolean; engineEnabled:boolean; flipped:boolean; favorite:boolean; readOnly:boolean;
  menuOpen:boolean; onMenu(open:boolean):void; onAction(action:ManualControlAction):void; part?:"toolbar"|"playback"|"all";
};
export function ManualRecordingControls({cursor,moveCount,canGoNext,previousVariation,nextVariation,playing,engineEnabled,flipped,favorite,readOnly,menuOpen,onMenu,onAction,part="all"}:Props) {
  const run=(action:ManualControlAction)=>{onMenu(false);onAction(action);};
  return <>
    {part!=="playback" && <>
      <nav className="manual-command-toolbar" aria-label="录谱工具栏">
        <button type="button" aria-label="返回我的棋谱" onClick={()=>run("return")}><ArrowLeft/><span>返回我的</span></button>
        <button type="button" aria-label="更多功能" aria-expanded={menuOpen} onClick={()=>onMenu(!menuOpen)}><Ellipsis/></button>
        <button type="button" disabled={readOnly} aria-label="摆棋" title="摆棋" onClick={()=>run("setup")}><Pencil/></button>
        <button type="button" aria-label="翻转" title="翻转棋盘" aria-pressed={flipped} onClick={()=>run("flip")}><FlipVertical2/></button>
        <button type="button" aria-label="分析" title="自动分析当前局面" aria-pressed={engineEnabled} onClick={()=>run("analysis")}><Search/></button>
        <button type="button" onClick={()=>run("variation")}><GitBranch/><span>自由推演</span></button>
      </nav>
      {menuOpen && <>
        <button type="button" className="recording-menu-dismiss" aria-label="关闭录谱菜单" onClick={()=>onMenu(false)}/>
        <section className="recording-action-menu" aria-label="录谱菜单">
          <header><strong>录谱功能</strong><button type="button" aria-label="关闭菜单" onClick={()=>onMenu(false)}><X/></button></header>
          <button type="button" aria-pressed={engineEnabled} onClick={()=>run("engine")}>{engineEnabled?<Cpu/>:<EyeOff/>}<span>{engineEnabled?"关闭 AI 自动分析":"开启 AI 自动分析"}</span></button>
          <button type="button" onClick={()=>run("new")}><Plus/><span>新建棋谱</span></button>
          <button type="button" onClick={()=>run("library")}><Database/><span>我的棋谱</span></button>
          <button type="button" disabled={readOnly} onClick={()=>run("metadata")}><FilePenLine/><span>棋谱信息</span></button>
          <button type="button" disabled={readOnly} aria-pressed={favorite} onClick={()=>run("favorite")}><Star fill={favorite?"currentColor":"none"}/><span>{favorite?"取消收藏":"收藏棋谱"}</span></button>
          <button type="button" onClick={()=>run(readOnly?"copy":"save")}><Save/><span>{readOnly?"复制到我的棋谱":"保存棋谱"}</span></button>
          <button type="button" onClick={()=>run("import")}><FileUp/><span>导入棋谱</span></button>
          <button type="button" disabled={!moveCount} onClick={()=>run("rehearse")}><BookOpen/><span>背谱练习</span></button>
          <button type="button" disabled={!cursor} onClick={()=>run("explain")}><Lightbulb/><span>讲解这步</span></button>
          <button type="button" onClick={()=>run("report")}><ChartNoAxesCombined/><span>整局报告</span></button>
          <button type="button" onClick={()=>run("comments")}><ClipboardList/><span>注释与变招</span></button>
          <button type="button" disabled={!previousVariation} onClick={()=>run("previousVariation")}><ChevronsLeft/><span>上变</span></button>
          <button type="button" disabled={!nextVariation} onClick={()=>run("nextVariation")}><ChevronsRight/><span>下变</span></button>
          <button type="button" onClick={()=>run("settings")}><Settings2/><span>棋盘与引擎设置</span></button>
        </section>
      </>}
    </>}
    {part!=="toolbar" && <nav className="manual-playback-controls" aria-label="棋谱播放与导航">
      <button type="button" aria-label="起点" title="回到起点" disabled={!cursor} onClick={()=>run("start")}><ChevronsLeft/></button>
      <button type="button" aria-label="上一步" disabled={!cursor} onClick={()=>run("previous")}><ChevronLeft/></button>
      <button type="button" aria-label={playing?"暂停播放":"播放棋谱"} aria-pressed={playing} disabled={!moveCount&&!canGoNext} onClick={()=>run("play")}>{playing?<Pause/>:<Play/>}</button>
      <button type="button" aria-label="下一步" disabled={!(canGoNext??cursor<moveCount)} onClick={()=>run("next")}><ChevronRight/></button>
      <button type="button" aria-label="终点" disabled={cursor>=moveCount} onClick={()=>run("end")}><ChevronsRight/></button>
    </nav>}
  </>;
}
