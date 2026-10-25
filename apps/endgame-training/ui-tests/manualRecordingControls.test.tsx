import {expect,it,vi} from "vitest";
import {fireEvent,render,screen} from "@testing-library/react";
import {ManualRecordingControls} from "../src/ManualRecordingControls";
import {rehearsalChoices} from "../src/LocalManualRehearsal";
import type {LocalManualGame} from "../src/types";
it("navigation and menu actions reach real handlers, with unavailable steps disabled",()=>{
 const onAction=vi.fn(),onMenu=vi.fn();render(<ManualRecordingControls cursor={0} moveCount={3} previousVariation={false} nextVariation={true} playing={false} engineEnabled={false} flipped={false} favorite={false} readOnly={false} menuOpen={true} onMenu={onMenu} onAction={onAction}/>);
 expect((screen.getByRole("button",{name:"上一步",exact:true}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"播放棋谱"}));expect(onAction).toHaveBeenLastCalledWith("play");
 fireEvent.click(screen.getByRole("button",{name:"收藏棋谱"}));expect(onAction).toHaveBeenLastCalledWith("favorite");
 fireEvent.click(screen.getByRole("button",{name:"导入棋谱"}));expect(onAction).toHaveBeenLastCalledWith("import");
 fireEvent.click(screen.getByRole("button",{name:"背谱练习"}));expect(onAction).toHaveBeenLastCalledWith("rehearse");
 expect(screen.queryByRole("button",{name:/分享|视频识谱/})).toBeNull();
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
