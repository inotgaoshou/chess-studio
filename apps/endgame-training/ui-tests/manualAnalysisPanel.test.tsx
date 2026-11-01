import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ManualAnalysisPanel } from "../src/ManualAnalysisPanel";

const line={multipv:1,pv:["b0c2","b9c7"],notation:["马八进七","马２进３"],depth:18,scoreLabel:"红优 +35",metricsLabel:"节点 500K · 速度 250K/s"};
const props={mode:"hints" as const,lines:[line],pending:false,suspended:false,terminal:false,activeIndex:0,multiPv:3,moveTimeSec:2,onSelect:vi.fn(),onPreview:vi.fn(),onMultiPvChange:vi.fn(),onMoveTimeChange:vi.fn(),onRefresh:vi.fn()};

it("selects a candidate without playing it, and opens preview explicitly",()=>{
 render(<ManualAnalysisPanel {...props}/>);
 fireEvent.click(screen.getByRole("button",{name:"候选 1：马八进七"}));expect(props.onSelect).toHaveBeenCalledWith(0);expect(props.onPreview).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"小棋盘"}));expect(props.onPreview).toHaveBeenCalledWith(0);
});

it("hides recommendations during evaluation, disable, suspension, error and recalculation",()=>{
 const view=render(<ManualAnalysisPanel {...props}/>);
 for(const change of [{mode:"evaluation" as const},{mode:"disabled" as const},{suspended:true},{pending:true},{error:"引擎暂不可用"}]){
  view.rerender(<ManualAnalysisPanel {...props} {...change}/>);expect(screen.queryByRole("button",{name:/候选 1/})).toBeNull();expect(screen.queryByRole("button",{name:"小棋盘"})).toBeNull();
 }
 fireEvent.click(screen.getByRole("button",{name:"重试"}));expect(props.onRefresh).toHaveBeenCalled();
 view.rerender(<ManualAnalysisPanel {...props} mode="disabled"/>);expect((screen.getByRole("button",{name:"重新分析当前局面"}) as HTMLButtonElement).disabled).toBe(true);
});
