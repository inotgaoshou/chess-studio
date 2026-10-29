// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VariationBoard, type VariationBoardProps } from "./VariationBoard";
import { branchAfter, movesToSave, clampPanel } from "../../../packages/variation-session";

afterEach(cleanup);
const base = { fen: "base w - - 0 1", pieces: [{ row: 9, col: 0, color: "red" }, { row: 0, col: 0, color: "black" }], notation: "" };
function setup(moves = ["a0a1", "a9a8"], overrides: Partial<VariationBoardProps<typeof base>> = {}) {
  const onSave = vi.fn(async () => ({ message: "保存成功" }));
  const validate = vi.fn(async (line: string[]) => line.map((move, index) => ({ ...base, fen: index % 2 ? "step w" : "step b", notation: move })));
  render(<VariationBoard title="候选 1" base={base} initialMoves={moves} validate={validate} onSave={onSave} onClose={vi.fn()} renderBoard={(frame, controls) => <div data-testid="mini-board" data-fen={frame.fen}><button onClick={() => controls.onMove({ row: 9, col: 0 }, { row: 8, col: 0 })}>试走 a0a1</button><button onClick={() => controls.onMove({ row: 9, col: 1 }, { row: 7, col: 2 })}>试走 b0c2</button></div>} {...overrides}/>);
  return { onSave, validate };
}
const ready = () => waitFor(() => expect(screen.queryByText("正在校验推演线路…")).toBeNull());

describe("small calculation board", () => {
  it("keeps full candidates longer than eight rounds and saves all moves while paused at the root", async () => {
    const moves = Array.from({ length: 33 }, (_, index) => `move-${index}`);
    const { onSave } = setup(moves); await ready();
    fireEvent.click(screen.getByRole("button", { name: "推演下一步" }));
    expect(screen.getByText(/第 1 步 \/ 共 33 步/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存分支" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(moves));
    expect(screen.getByTestId("mini-board").getAttribute("data-fen")).toBe("step b");
  });
  it("saves only the viewed prefix through the secondary action", async () => {
    const { onSave } = setup(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "更多推演操作" }));
    expect((screen.getByRole("button", { name: "保存至当前步 · 0 步" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "推演下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "保存至当前步 · 1 步" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["a0a1"]));
  });
  it("forks at a manual deviation without attaching the old future and keeps the original selectable", async () => {
    const { onSave } = setup(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "试走 b0c2" })); await ready();
    fireEvent.click(screen.getByRole("button", { name: "保存分支" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["b0c2"]));
    fireEvent.click(screen.getByRole("button", { name: "更多推演操作" }));
    fireEvent.change(screen.getByLabelText("切换临时线路"), { target: { value: "0" } });
    expect(screen.getByText(/第 0 步 \/ 共 2 步/)).toBeTruthy();
  });
  it("extends a manual line without producing one temporary branch per move", async () => {
    setup([]); await ready();
    fireEvent.click(screen.getByRole("button", { name: "试走 b0c2" })); await ready();
    fireEvent.click(screen.getByRole("button", { name: "试走 a0a1" })); await ready();
    expect(screen.queryByLabelText("切换临时线路")).toBeNull();
    expect(screen.getByText(/第 2 步 \/ 共 2 步/)).toBeTruthy();
  });
  it("retains the line when saving fails and allows retry", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("磁盘写入失败")).mockResolvedValue({ message: "重试成功" });
    setup(undefined, { onSave: save }); await ready();
    fireEvent.click(screen.getByRole("button", { name: "保存分支" }));
    await screen.findByText("磁盘写入失败");
    fireEvent.click(screen.getByRole("button", { name: "保存分支" }));
    await screen.findByText("重试成功"); expect(save).toHaveBeenCalledTimes(2);
  });
  it("retries the frozen prefix even after the playback cursor changes", async () => {
    const onSave=vi.fn().mockRejectedValueOnce(new Error("写入失败")).mockResolvedValue({message:"重试成功"});
    setup(undefined,{onSave}); await ready();
    fireEvent.click(screen.getByRole("button",{name:"推演下一步"}));
    fireEvent.click(screen.getByRole("button",{name:"更多推演操作"}));
    fireEvent.click(screen.getByRole("button",{name:"保存至当前步 · 1 步"}));
    await screen.findByText("写入失败");
    fireEvent.click(screen.getByRole("button",{name:"推演终点"}));
    fireEvent.click(screen.getByRole("button",{name:"重试保存"}));
    await screen.findByText("重试成功");
    expect(onSave.mock.calls).toEqual([[["a0a1"]],[["a0a1"]]]);
  });
  it("retries a failed copy without writing into the source", async () => {
    const onSave=vi.fn(),onSaveCopy=vi.fn().mockRejectedValueOnce(new Error("副本保存失败")).mockResolvedValue({message:"副本已保存"});
    setup(undefined,{onSave,onSaveCopy}); await ready();
    fireEvent.click(screen.getByRole("button",{name:"更多推演操作"}));
    fireEvent.click(screen.getByRole("button",{name:"另存到我的棋谱"})); await screen.findByText("副本保存失败");
    fireEvent.click(screen.getByRole("button",{name:"重试保存"})); await screen.findByText("副本已保存");
    expect(onSaveCopy).toHaveBeenCalledTimes(2);expect(onSave).not.toHaveBeenCalled();
  });
  it("expands before opening more actions from a collapsed panel", async () => {
    setup(); await ready();fireEvent.click(screen.getByRole("button",{name:"收起小棋盘"}));
    fireEvent.click(screen.getByRole("button",{name:"更多推演操作"}));
    expect(screen.getByTestId("mini-board")).toBeTruthy();expect(screen.getByRole("region",{name:"推演更多操作"})).toBeTruthy();
  });
  it("guards duplicate clicks while the persistent save is pending", async () => {
    let finish!: (value: { message: string }) => void;
    const save = vi.fn(() => new Promise<{ message: string }>(resolve => { finish = resolve; }));
    setup(undefined, { onSave: save }); await ready();
    const button = screen.getByRole("button", { name: "保存分支" });
    fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledTimes(1);
    finish({ message: "保存成功" }); await screen.findByText("保存成功");
  });
  it("confirms unsaved close and keeps state when continuing research", async () => {
    const onClose = vi.fn(); setup(undefined, { onClose }); await ready();
    fireEvent.click(screen.getByRole("button", { name: "关闭小棋盘" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "继续研究" }));
    fireEvent.click(screen.getByRole("button", { name: "收起小棋盘" }));
    expect(screen.queryByTestId("mini-board")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开小棋盘" }));
    expect(screen.getByText(/第 0 步 \/ 共 2 步/)).toBeTruthy();
  });
  it("saves before closing and keeps other unsaved lines available", async () => {
    const onClose = vi.fn(); setup(undefined, { onClose }); await ready();
    fireEvent.click(screen.getByRole("button", { name: "试走 b0c2" })); await ready();
    fireEvent.click(screen.getByRole("button", { name: "关闭小棋盘" }));
    fireEvent.click(screen.getByRole("button", { name: "保存当前线路" }));
    await screen.findByText(/其他临时线路尚未保存/); expect(onClose).not.toHaveBeenCalled();
  });
  it("does not replace a frozen candidate when parent props update", async () => {
    const props = { title: "原候选", base, initialMoves: ["a0a1"], validate: async (moves: string[]) => moves.map(notation => ({ ...base, notation })), onSave: vi.fn(), onClose: vi.fn(), renderBoard: () => null };
    const view = render(<VariationBoard {...props}/>); await ready();
    view.rerender(<VariationBoard {...props} initialMoves={["b0c2", "b9c7"]}/>);
    expect(screen.getByRole("button", { name: "保存分支" })).toBeTruthy();
  });
});

it("session rules keep playback independent from save content and constrain the header", () => {
  expect(branchAfter(["a0a1", "a9a8"], 0, "b0c2")).toEqual(["b0c2"]);
  expect(branchAfter(["a0a1", "a9a8"], 0, "a0a1")).toEqual(["a0a1", "a9a8"]);
  expect(movesToSave(["a0a1", "a9a8"])).toHaveLength(2);
  expect(movesToSave(["a0a1", "a9a8"], 1)).toEqual(["a0a1"]);
  expect(clampPanel(999, -100, 350, 500, 375, 667)).toEqual({ x: 17, y: 8 });
});

it("hides hints and arrows while retaining evaluation and calculation data", async () => {
  const analyze = vi.fn(async () => ({ lines: [{ pv:["b0c2"], notation:["马八进七"], scoreCp:200, depth:22, nodes:12345, timeMs:1500 }] }));
  setup([], { analyze, renderBoard: (_frame, controls) => <div data-testid="hints">{controls.hintMoves.join(",")}</div> }); await ready();
  await screen.findByRole("button", {name:"走正招 · 马八进七"});
  expect(screen.getByTestId("hints").textContent).toBe("b0c2");
  fireEvent.click(screen.getByRole("button", {name:"AI 提示开"}));
  expect(screen.queryByRole("button", {name:/走正招/})).toBeNull();
  expect(screen.getByTestId("hints").textContent).toBe("");
  expect(screen.getAllByText("红方明显占优 · 红分 +200").length).toBeGreaterThan(0);
  expect(screen.getByText(/深度 22 · 节点 12,345 · 耗时 1500 ms/)).toBeTruthy();
  expect(analyze).toHaveBeenCalledTimes(1);
});

it("applies a suggested move only to the temporary line and validates it", async () => {
  const analyze = vi.fn(async () => ({ lines:[{pv:["b0c2"],scoreCp:10}] }));
  const {onSave,validate} = setup([], {analyze}); await ready();
  fireEvent.click(await screen.findByRole("button",{name:"走正招 · b0c2"})); await ready();
  expect(validate).toHaveBeenLastCalledWith(["b0c2"]);
  expect(screen.getByText(/第 1 步 \/ 共 1 步/)).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();
});

it("aborts obsolete positions and never displays or applies their late engine result", async () => {
  let finish!: (value: {lines:{pv:string[];scoreCp:number}[]}) => void;
  const signals:AbortSignal[]=[];
  const analyze=vi.fn((_fen:string,signal:AbortSignal)=>{ signals.push(signal); return new Promise<{lines:{pv:string[];scoreCp:number}[]}>(resolve=>{finish=resolve;}); });
  setup(undefined,{analyze}); await ready(); await waitFor(()=>expect(analyze).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button",{name:"推演下一步"}));
  expect(signals[0].aborted).toBe(true);
  finish({lines:[{pv:["b0c2"],scoreCp:999}]});
  await waitFor(()=>expect(screen.queryByRole("button",{name:/走正招/})).toBeNull());
  fireEvent.click(screen.getByRole("button",{name:"收起小棋盘"}));
  expect(screen.queryByRole("region",{name:"推演引擎"})).toBeNull();
});

it("deletes a temporary deviation while preserving the original and saved branches", async () => {
  const onDeleteSaved=vi.fn(); const {onSave}=setup(undefined,{savedBranches:[{id:"saved",label:"马二进三"}],onDeleteSaved}); await ready();
  fireEvent.click(screen.getByRole("button",{name:"试走 b0c2"})); await ready();
  fireEvent.click(screen.getByRole("button",{name:"更多推演操作"}));
  fireEvent.click(screen.getByRole("button",{name:"删除临时线路"}));
  fireEvent.click(screen.getByRole("button",{name:"确认删除临时线路"}));
  expect(screen.getByText(/第 0 步 \/ 共 2 步/)).toBeTruthy();
  expect(onSave).not.toHaveBeenCalled();expect(onDeleteSaved).not.toHaveBeenCalled();
});

it("confirms persisted branch deletion and retains its entry on failure for retry", async () => {
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
  const onDeleteSaved=vi.fn().mockRejectedValueOnce(new Error("删除写入失败")).mockResolvedValue(undefined);
  setup(undefined,{savedBranches:[{id:"branch",label:"马二进三"}],onDeleteSaved}); await ready();
  fireEvent.click(screen.getByRole("button",{name:"更多推演操作"}));
  fireEvent.click(screen.getByRole("button",{name:"删除已保存变招 · 马二进三"}));
  await screen.findByText("删除写入失败");
  fireEvent.click(screen.getByRole("button",{name:"删除已保存变招 · 马二进三"}));
  await waitFor(()=>expect(onDeleteSaved).toHaveBeenCalledTimes(2));expect(confirm).toHaveBeenCalled();confirm.mockRestore();
});
