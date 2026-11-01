import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useState } from "react";
import { PracticeLearningPanel, practiceLearningSteps } from "../src/PracticeLearningPanel";
import type { TrainingProblem } from "../src/types";

const problem = {id:"one",title:"不要凭标题推断铁门栓",category:"杀法",startingFen:"",note:"隐藏注释",solution:[],logic:{themes:["作者主题"],firstMoveIdea:"作者首着",keyDefense:"作者防守",failureReason:"作者错因",review:"作者总结"}} as unknown as TrainingProblem;
const props = {problem,practical:false,answersAllowed:true,completed:false,ended:false,revealed:false,hints:0,hintDisabled:false,notice:"请独立尝试",onHint:vi.fn(),onReveal:vi.fn(),onRestart:vi.fn(),onClose:vi.fn()};
const open = () => { fireEvent.click(screen.getByRole("button",{name:/学习思路/}));return within(screen.getByRole("dialog",{name:"学习思路"})); };

it("offers only general observation before solving, with no title-based technique or private answer",()=>{
 render(<PracticeLearningPanel {...props} commentary={<p>私有参考</p>}/>);
 expect(screen.queryByRole("dialog")).toBeNull();const dialog=open();
 expect(dialog.getByText("先观察，再计算")).toBeTruthy();
 for(const text of ["作者主题","作者首着","作者防守","作者错因","作者总结","私有参考","隐藏注释"])expect(dialog.queryByText(text)).toBeNull();
 expect(dialog.queryByRole("button",{name:"查看题解与回放"})).toBeNull();
 expect(dialog.getByText(/先看将帅的位置/)).toBeTruthy();
 expect(practiceLearningSteps(problem,false).join("")).not.toContain("铁门栓");
});

it("uses the same hint counter, stops at three, and displays the existing hint result",()=>{
 const hint=vi.fn();
 function Harness(){const [hints,setHints]=useState(0);return <PracticeLearningPanel {...props} hints={hints} notice={hints?`现有第 ${hints} 级提示`:"尚未提示"} onHint={()=>{hint();setHints(v=>v+1);}}/>;}
 render(<Harness/>);const dialog=open();
 for(let i=1;i<=3;i++){fireEvent.click(dialog.getByRole("button",{name:`获取第 ${i} 级提示`}));expect(dialog.getByRole("status").textContent).toContain(`第 ${i} 级提示`);}
 const exhausted=dialog.getByRole("button",{name:"三级提示已用完"});expect((exhausted as HTMLButtonElement).disabled).toBe(true);fireEvent.click(exhausted);expect(hint).toHaveBeenCalledTimes(3);
});

it("shows authored review only after completion, and preserves explicit reveal and restart actions",()=>{
 const onReveal=vi.fn(),onRestart=vi.fn();render(<PracticeLearningPanel {...props} completed ended onReveal={onReveal} onRestart={onRestart} commentary={<p>局面事实与引擎参考</p>}/>);
 let dialog=open();for(const text of ["作者主题","作者首着","作者防守","作者错因","作者总结"])expect(dialog.getByText(text)).toBeTruthy();
 expect(dialog.getByText("局面事实与引擎参考")).toBeTruthy();expect(onReveal).not.toHaveBeenCalled();
 fireEvent.click(dialog.getByRole("button",{name:"查看题解与回放"}));expect(onReveal).toHaveBeenCalledOnce();expect(screen.queryByRole("dialog")).toBeNull();
 dialog=open();fireEvent.click(dialog.getByRole("button",{name:"遮住解析，重新做一遍"}));expect(onRestart).toHaveBeenCalledOnce();expect(screen.queryByRole("dialog")).toBeNull();
});

it("permission loss immediately removes detailed review and commentary even for completed work",()=>{
 const ui=render(<PracticeLearningPanel {...props} completed ended revealed commentary={<p>仅教师可见</p>}/>);open();expect(screen.getByText("仅教师可见")).toBeTruthy();
 ui.rerender(<PracticeLearningPanel {...props} completed ended revealed answersAllowed={false} commentary={<p>仅教师可见</p>}/>);
 expect(screen.queryByText("仅教师可见")).toBeNull();expect(screen.queryByText("作者首着")).toBeNull();expect(screen.queryByRole("button",{name:/查看题解/})).toBeNull();
 expect(screen.getByText(/具体题解与着法讲解遵循当前账号/)).toBeTruthy();
});

it("falls back to an honest review checklist and distinguishes reference from authored teaching",()=>{
 render(<PracticeLearningPanel {...props} problem={{...problem,logic:undefined}} practical completed ended/>);const dialog=open();
 expect(dialog.getByText("复盘清单")).toBeTruthy();expect(dialog.getByText(/暂无专属讲解/)).toBeTruthy();expect(dialog.getByText(/比较双方子力/)).toBeTruthy();
});

it("Escape closes without hinting or revealing and an external explanation request opens the sheet",()=>{
 const onHint=vi.fn(),onReveal=vi.fn(),onClose=vi.fn();const ui=render(<PracticeLearningPanel {...props} completed ended onHint={onHint} onReveal={onReveal} onClose={onClose}/>);open();
 fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("dialog")).toBeNull();expect(onClose).toHaveBeenCalledOnce();expect(onHint).not.toHaveBeenCalled();expect(onReveal).not.toHaveBeenCalled();
 ui.rerender(<PracticeLearningPanel {...props} completed ended openRequest={1}/>);expect(screen.getByRole("dialog",{name:"学习思路"})).toBeTruthy();
});
