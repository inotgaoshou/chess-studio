import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ManualLibraryDialog } from "../src/ManualLibraryDialog";
import { ManualSaveDialog } from "../src/ManualSaveDialog";
import { manualMatchesQuery, manualResult } from "../src/manualLibrary";
import type { LocalManualGame } from "../src/types";
const game:LocalManualGame={id:"one",title:"省赛决赛",note:"备注",folderPath:"比赛/决赛",startingFen:"9 w",currentFen:"",currentNodeId:"main:1",moves:["b0c2","b9c7"],cursor:1,branches:[],comments:{"main:1":"保留注释"},createdAt:"2026-10-20",updatedAt:"2026-10-25",metadata:{event:"秋季赛",redPlayer:"张三",blackPlayer:"李四",playedAt:"2026-10-20",gameType:"full",result:"first-win"}};
const props=()=>({games:[game,{...game,id:"mirror",title:"云端棋谱",readOnly:true}],folders:[{path:"比赛",createdAt:""},{path:"比赛/决赛",createdAt:""}],folder:"",query:"",syncing:false,syncMessage:"",onFolder:vi.fn(),onQuery:vi.fn(),onClose:vi.fn(),onNew:vi.fn(async()=>{}),onOpen:vi.fn(async()=>{}),onEdit:vi.fn(async()=>{}),onShare:vi.fn(async()=>{}),onCopy:vi.fn(async()=>{}),onSync:vi.fn(async()=>{}),onCreateFolder:vi.fn(),onRenameFolder:vi.fn(),onDeleteFolder:vi.fn(),onMoveGames:vi.fn(async(..._args:unknown[])=>{}),onDeleteGames:vi.fn(async()=>{})});
it("shows metadata and edits the chosen row without opening it",async()=>{
 const p=props();render(<ManualLibraryDialog {...p}/>);
 expect(screen.getAllByText("张三 · 李四")).toHaveLength(2);
 fireEvent.click(screen.getByRole("button",{name:"编辑信息：省赛决赛"}));
 await waitFor(()=>expect(p.onEdit).toHaveBeenCalledWith(game));expect(p.onOpen).not.toHaveBeenCalled();
});
it("searches players, results, rounds and events inside descendant folders",()=>{
 expect(manualMatchesQuery(game,"张三 秋季赛 1回合 红胜")).toBe(true);
 expect(manualMatchesQuery(game,"李四 黑胜")).toBe(false);
 expect(manualResult({...game,startingFen:"9 b"}).label).toBe("黑胜");
 render(<ManualLibraryDialog {...props()} folder="比赛" query="张三 秋季赛"/>);
 expect(screen.getByRole("button",{name:"打开棋谱：省赛决赛"})).toBeTruthy();
});
it("excludes readonly mirrors from batch selection and confirms before deleting",async()=>{
 const p=props();render(<ManualLibraryDialog {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"全选当前"}));expect(screen.getByText("已选 1 盘")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"删除",exact:true}));expect(p.onDeleteGames).not.toHaveBeenCalled();
 fireEvent.click(within(screen.getByRole("alertdialog",{name:"删除棋谱"})).getByRole("button",{name:"确认删除"}));
 await waitFor(()=>expect(p.onDeleteGames).toHaveBeenCalledWith([game]));
 expect(screen.queryByRole("button",{name:"编辑信息：云端棋谱"})).toBeNull();
});
it("retains a failed move dialog and permits retry",async()=>{
 const p=props();p.onMoveGames.mockRejectedValueOnce(new Error("磁盘暂时不可写入"));render(<ManualLibraryDialog {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"移动：省赛决赛"}));fireEvent.change(screen.getByLabelText("目标目录"),{target:{value:"比赛"}});
 fireEvent.click(screen.getByRole("button",{name:"确认移动"}));expect((await screen.findByRole("alert")).textContent).toContain("磁盘暂时不可写入");
 fireEvent.click(screen.getByRole("button",{name:"确认移动"}));await waitFor(()=>expect(p.onMoveGames).toHaveBeenCalledTimes(2));expect(p.onMoveGames).toHaveBeenLastCalledWith([game],"比赛");
});
it("editing metadata never sends replacement moves or comments",async()=>{
 const onSave=vi.fn(async(_value:unknown)=>{}),before=JSON.stringify(game);
 render(<ManualSaveDialog game={game} mode="edit" folders={[]} onSave={onSave} onClose={()=>{}} onCreateFolder={async()=>{}}/>);
 expect(screen.getByRole("dialog",{name:"编辑棋谱信息"})).toBeTruthy();fireEvent.change(screen.getByLabelText("红方棋手"),{target:{value:"王五"}});fireEvent.click(screen.getByRole("button",{name:"保存修改"}));
 await waitFor(()=>expect(onSave).toHaveBeenCalled());expect(onSave.mock.calls[0][0]).not.toHaveProperty("moves");expect(onSave.mock.calls[0][0]).not.toHaveProperty("comments");expect(JSON.stringify(game)).toBe(before);
});
it("shows creation progress and prevents duplicate documents while persistence is pending",async()=>{
 const p=props();let finish=()=>{};p.onNew.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
 render(<ManualLibraryDialog {...p}/>);
 fireEvent.click(screen.getByRole("button",{name:"新建棋谱",exact:true}));
 const creating=screen.getByRole("button",{name:"正在新建…",exact:true});expect((creating as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(creating);expect(p.onNew).toHaveBeenCalledOnce();finish();
 await waitFor(()=>expect((screen.getByRole("button",{name:"新建棋谱",exact:true}) as HTMLButtonElement).disabled).toBe(false));
});
