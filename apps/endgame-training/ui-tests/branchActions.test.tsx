import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { expect,it,vi } from "vitest";
import { BranchActionsDialog } from "../src/BranchActionsDialog";
import { removeManualContinuation } from "../src/manualEditing";
import { manualContinuations } from "../src/manualContinuation";

const a="h2e2",b="b9c7",c="e2e6",d="e2e3",e="h9g7",f="e2a2";
const branch=(id:string,parentPath:string[],moves:string[])=>({id,parentPath,parentCursor:parentPath.length,moves,notation:moves,createdAt:1});
const tree={moves:[a,b,c,e],branches:[branch("other",[a,b],[d,e]),branch("nested-deleted",[a,b,c],[f]),branch("nested-kept",[a,b,d],[f])],comments:{"":"起点",[a]:"保留",[[a,b,c].join(",")]:"删除",[[a,b,d].join(",")]:"另一支"}};
it("deletes a mainline child without promoting or losing sibling/nested variations",()=>{
 const next=removeManualContinuation(tree,[a,b,c]);
 expect(next.moves).toEqual([a,b]);
 expect(next.branches.map(b=>b.id)).toEqual(["other","nested-kept"]);
 expect(next.comments).toEqual({"":"起点",[a]:"保留",[[a,b,d].join(",")]:"另一支"});
 const restored=JSON.parse(JSON.stringify(next));
 expect(manualContinuations(restored.moves,[],restored.branches,[a,b]).map(c=>c.move)).toEqual([d]);
 expect(tree.moves).toEqual([a,b,c,e]);
});
it("deletes a variation subtree, preserving mainline and shared prefixes",()=>{
 const next=removeManualContinuation(tree,[a,b,d]);
 expect(next.moves).toEqual(tree.moves);
 expect(next.branches.map(b=>b.id)).toEqual(["nested-deleted"]);
 const shortened=removeManualContinuation(tree,[a,b,d,e]);
 expect(shortened.branches.find(b=>b.id==="other")?.moves).toEqual([d]);
 expect(shortened.branches.find(b=>b.id==="nested-kept")).toEqual(tree.branches[2]);
 expect(()=>removeManualContinuation(tree,[])).toThrow();
 expect(()=>removeManualContinuation(tree,["a0a1"])).toThrow();
});
it("targets the numbered choice and requires confirmation; failures retain retry",async()=>{
 const choices=manualContinuations(tree.moves,tree.moves,tree.branches,[a,b]);
 const remove=vi.fn().mockRejectedValueOnce(new Error("保存失败")).mockResolvedValueOnce(undefined),edit=vi.fn().mockResolvedValue(undefined);
 render(<BranchActionsDialog choices={choices} readOnly={false} onClose={vi.fn()} onEdit={edit} onDelete={remove}/>);
 fireEvent.click(screen.getByRole("button",{name:"编辑分支 1"}));
 await waitFor(()=>expect(edit).toHaveBeenCalledWith(choices[0]));
 await waitFor(()=>expect((screen.getByRole("button",{name:"删除分支 2"}) as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button",{name:"删除分支 2"}));
 expect(remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"取消"}));
 expect(remove).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"删除分支 2"}));
 fireEvent.click(screen.getByRole("button",{name:"确认删除"}));
 await screen.findByText("保存失败");
 expect(remove).toHaveBeenCalledWith(choices[1]);
 fireEvent.click(screen.getByRole("button",{name:"确认删除"}));
 await waitFor(()=>expect(remove).toHaveBeenCalledTimes(2));
});
it("blocks editing/deleting read-only sources",()=>{
 render(<BranchActionsDialog choices={manualContinuations(tree.moves,[],tree.branches,[a,b])} readOnly onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}/>);
 expect((screen.getByRole("button",{name:"编辑分支 1"}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole("button",{name:"删除分支 2"}) as HTMLButtonElement).disabled).toBe(true);
});
