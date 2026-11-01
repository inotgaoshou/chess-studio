import {expect,it,vi} from "vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import {ManualRecordingControls} from "../src/ManualRecordingControls";
import {rehearsalChoices} from "../src/LocalManualRehearsal";
import type {LocalManualGame} from "../src/types";
import {useState} from "react";
import {nextManualAiPhase,type ManualAiPhase} from "../src/manualAiMode";
it("keeps the reference recording shortcuts visible without opening a menu",()=>{
 const onAction=vi.fn();render(<ManualRecordingControls cursor={1} moveCount={3} previousVariation={true} nextVariation={true} playing={false} enginePhase={0} flipped={false} favorite={false} readOnly={false} menuOpen={false} onMenu={vi.fn()} onAction={onAction}/>);
 for(const [name,action] of [["AI 禁用","engine"],["自由推演","variation"],["分析","analysis"],["新增棋谱","new"],["摆棋","setup"],["闪电出招","instant"],["翻转","flip"],["报告","report"],["上变","previousVariation"],["下变","nextVariation"]]){
  fireEvent.click(screen.getByRole("button",{name,exact:true}));expect(onAction).toHaveBeenLastCalledWith(action);
 }
 expect(screen.getByRole("button",{name:"AI 禁用",exact:true}).querySelector('[data-manual-icon="ai-disabled"]')).toBeTruthy();
 expect(screen.getByRole("button",{name:"分析",exact:true}).querySelector('[data-manual-icon="analysis"]')).toBeTruthy();
});
it("navigation and menu actions reach real handlers, with unavailable steps disabled",()=>{
 const onAction=vi.fn(),onMenu=vi.fn();render(<ManualRecordingControls cursor={0} moveCount={3} previousVariation={false} nextVariation={true} playing={false} enginePhase={0} flipped={false} favorite={false} readOnly={false} menuOpen={true} onMenu={onMenu} onAction={onAction}/>);
 expect((screen.getByRole("button",{name:"上一步",exact:true}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"播放棋谱"}));expect(onAction).toHaveBeenLastCalledWith("play");
 fireEvent.click(screen.getByRole("button",{name:"收藏棋谱"}));expect(onAction).toHaveBeenLastCalledWith("favorite");
 fireEvent.click(screen.getByRole("button",{name:"导入棋谱"}));expect(onAction).toHaveBeenLastCalledWith("import");
 fireEvent.click(screen.getByRole("button",{name:"查看棋谱与注释"}));expect(onAction).toHaveBeenLastCalledWith("moves");
 fireEvent.click(screen.getByRole("button",{name:"背谱练习"}));expect(onAction).toHaveBeenLastCalledWith("rehearse");
 expect(screen.queryByRole("button",{name:/分享|视频识谱/})).toBeNull();
});
it("prevents repeated instant moves while waiting and preserves the six-button row",()=>{
 const onAction=vi.fn();const props={cursor:0,moveCount:0,previousVariation:false,nextVariation:false,playing:false,enginePhase:0 as const,flipped:false,favorite:false,readOnly:false,menuOpen:false,onMenu:vi.fn(),onAction};
 const ui=render(<ManualRecordingControls {...props} instantPending/>);
 expect(screen.getByRole('navigation',{name:'录谱工具栏'}).querySelectorAll('button')).toHaveLength(6);
 const button=screen.getByRole('button',{name:'闪电出招'});fireEvent.click(button);expect(onAction).not.toHaveBeenCalled();expect(button.textContent).toContain('计算中');
 ui.rerender(<ManualRecordingControls {...props}/>);fireEvent.click(button);expect(onAction).toHaveBeenCalledWith('instant');
 ui.rerender(<ManualRecordingControls {...props} readOnly/>);expect((button as HTMLButtonElement).disabled).toBe(true);
});
it("rehearsal accepts original branch choices without changing the source tree",()=>{
 const game={moves:["b0c2","b9c7","a3a4"],branches:[{parentPath:[],moves:["h0g2","h9g7"]},{parentPath:["b0c2"],moves:["h9g7"]}]} as LocalManualGame;const before=JSON.stringify(game);
 expect(rehearsalChoices(game,[])).toEqual(["b0c2","h0g2"]);expect(rehearsalChoices(game,["b0c2"])).toEqual(["b9c7","h9g7"]);expect(rehearsalChoices(game,["h0g2"])).toEqual(["h9g7"]);expect(rehearsalChoices(game,["h0g2","h9g7"])).toEqual([]);expect(JSON.stringify(game)).toBe(before);
});
it("removes dependent branch comments but preserves the mainline, and reorders siblings only",async()=>{
 const {removeManualBranch,reorderManualBranch}=await import("../src/manualEditing");
 const branches=[{id:"a",parentPath:[],parentCursor:0,moves:["h0g2"],notation:[],createdAt:1,branchOrder:0},{id:"b",parentPath:[],parentCursor:0,moves:["a3a4"],notation:[],createdAt:1,branchOrder:1},{id:"child",parentPath:["h0g2"],parentCursor:1,moves:["b9c7"],notation:[],createdAt:1,branchOrder:0}];
 const result=removeManualBranch({moves:["b0c2"],branches,comments:{"b0c2":"主线","h0g2":"变招","h0g2,b9c7":"嵌套","a3a4":"其它"}},"a");
 expect(result.branches.map(b=>b.id)).toEqual(["b"]);expect(result.comments).toEqual({b0c2:"主线",a3a4:"其它"});
 const reordered=reorderManualBranch(branches,"b",-1);expect(reordered.find(b=>b.id==="b")?.branchOrder).toBe(0);expect(reordered.find(b=>b.id==="a")?.branchOrder).toBe(1);expect(reordered.find(b=>b.id==="child")?.branchOrder).toBe(0);
});
it("keeps nested variations when the removed branch is still represented by the mainline",async()=>{
 const {removeManualBranch}=await import("../src/manualEditing");
 const branches=[{id:"adopted",parentPath:[],parentCursor:0,moves:["h0g2"],notation:[],createdAt:1},{id:"child",parentPath:["h0g2"],parentCursor:1,moves:["h9g7"],notation:[],createdAt:1}];
 const result=removeManualBranch({moves:["h0g2","b9c7"],branches,comments:{"h0g2,h9g7":"保留变招"}},"adopted");expect(result.branches.map(branch=>branch.id)).toEqual(["child"]);expect(result.comments["h0g2,h9g7"]).toBe("保留变招");
});

it("enables next for real stored children beyond the old display array and honors an explicit leaf",()=>{
 const props={cursor:5,moveCount:5,previousVariation:false,nextVariation:false,playing:false,enginePhase:0 as const,flipped:false,favorite:false,readOnly:false,menuOpen:false,onMenu:vi.fn(),onAction:vi.fn()};
 const view=render(<ManualRecordingControls {...props} canGoNext={true}/>);
 const next=screen.getByRole('button',{name:'下一步',exact:true}) as HTMLButtonElement;expect(next.disabled).toBe(false);fireEvent.click(next);expect(props.onAction).toHaveBeenCalledWith('next');
 view.rerender(<ManualRecordingControls {...props} cursor={3} canGoNext={false}/>);expect(next.disabled).toBe(true);
 view.rerender(<ManualRecordingControls {...props} cursor={3}/>);expect(next.disabled).toBe(false);
});

it("exposes the four-phase cycle through the same accessible button in either layout",()=>{
 function Harness(){const [phase,setPhase]=useState<ManualAiPhase>(0);return <ManualRecordingControls cursor={1} moveCount={3} previousVariation={true} nextVariation={true} playing={false} enginePhase={phase} flipped={false} favorite={false} readOnly={false} menuOpen={false} onMenu={()=>{}} onAction={action=>{if(action==="engine")setPhase(nextManualAiPhase);}} layout="analysis"/>;}
 render(<Harness/>);
 for(const [current,next] of [["AI 禁用","AI 局势"],["AI 局势","AI 提示"],["AI 提示","AI 局势"],["AI 局势","AI 禁用"],["AI 禁用","AI 局势"],["AI 局势","AI 提示"],["AI 提示","AI 局势"],["AI 局势","AI 禁用"]]){
  fireEvent.click(screen.getByRole("button",{name:current,exact:true}));const button=screen.getByRole("button",{name:next,exact:true});expect(button).toBeTruthy();
  expect(button.querySelector(`[data-manual-icon="ai-${next==="AI 禁用"?"disabled":next==="AI 提示"?"hints":"evaluation"}"]`)).toBeTruthy();
 }
 expect(screen.getByRole("navigation",{name:"棋谱播放与导航"}).querySelectorAll("button")).toHaveLength(5);
 expect(screen.queryByRole("navigation",{name:"录谱工具栏"})).toBeNull();
});

it("separates analysis commands from five replay controls and returns without leaving the document",()=>{
 const props={cursor:1,moveCount:3,previousVariation:true,nextVariation:true,playing:false,enginePhase:2 as const,flipped:false,favorite:false,readOnly:false,menuOpen:true,onMenu:vi.fn(),onAction:vi.fn(),onBack:vi.fn()};
 const view=render(<ManualRecordingControls {...props} layout="analysis" part="toolbar"/>);
 expect(screen.queryByRole('navigation',{name:'棋谱播放与导航'})).toBeNull();
 expect(screen.getByRole('navigation',{name:'录谱分析工具栏'}).querySelectorAll('button')).toHaveLength(6);
 for(const back of screen.getAllByRole('button',{name:'返回录谱',exact:true}))fireEvent.click(back);
 expect(props.onBack).toHaveBeenCalledTimes(2);expect(props.onAction).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'闪电出招',exact:true}));expect(props.onAction).toHaveBeenLastCalledWith('instant');
 view.rerender(<ManualRecordingControls {...props} layout="analysis" part="playback"/>);
 expect(screen.queryByRole('navigation',{name:'录谱分析工具栏'})).toBeNull();expect(screen.queryByRole('region',{name:'录谱菜单'})).toBeNull();
 expect(screen.getByRole('navigation',{name:'棋谱播放与导航'}).querySelectorAll('button')).toHaveLength(5);
 for(const [name,action] of [['起点','start'],['上一步','previous'],['播放棋谱','play'],['下一步','next'],['终点','end']]){fireEvent.click(screen.getByRole('button',{name,exact:true}));expect(props.onAction).toHaveBeenLastCalledWith(action);}
});
