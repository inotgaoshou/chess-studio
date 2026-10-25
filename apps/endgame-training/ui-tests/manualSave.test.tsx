import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ManualSaveDialog } from "../src/ManualSaveDialog";
import type { LocalManualGame } from "../src/types";
const game:LocalManualGame={id:"save-time",title:"时间测试",note:"备注",startingFen:"9 w",moves:["b0c2"],cursor:1,branches:[],comments:{b0c2:"原注释"},createdAt:"2026-10-25T11:55:23Z",updatedAt:"2026-10-25T11:55:23Z",metadata:{event:"赛事",redPlayer:"甲",blackPlayer:"乙",playedAt:"2026-10-25T11:55:23Z",gameType:"full",result:"unknown"}};
const mount=()=>{const onSave=vi.fn(async(_value:unknown)=>{});render(<ManualSaveDialog game={game} folders={[]} onSave={onSave} onCreateFolder={async()=>{}} onClose={()=>{}}/>);return onSave;};
it("opens without focusing an input and preserves the exact original instant on metadata-only save",async()=>{
 const onSave=mount();expect(document.activeElement?.tagName).not.toBe("INPUT");fireEvent.change(screen.getByLabelText("归属赛事"),{target:{value:"新赛事"}});fireEvent.click(screen.getByRole("button",{name:"保存棋谱",exact:true}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledOnce());const value=onSave.mock.calls[0][0] as Record<string,unknown>;
 expect(value.metadata).toMatchObject({playedAt:game.metadata?.playedAt,event:"新赛事"});expect(value).not.toHaveProperty("playedDate");expect(value).not.toHaveProperty("moves");
});
it("saves the selected local date and time without changing the source game",async()=>{
 const before=JSON.stringify(game),onSave=mount();fireEvent.change(screen.getByLabelText("对局日期"),{target:{value:"2026-10-24"}});fireEvent.change(screen.getByLabelText("对局时刻"),{target:{value:"08:30"}});expect(screen.getByText("2026-10-24 08:30")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"保存棋谱",exact:true}));
 await waitFor(()=>expect(onSave).toHaveBeenCalledOnce());const value=onSave.mock.calls[0][0] as {metadata:{playedAt:string}};const date=new Date(value.metadata.playedAt);expect([date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes()]).toEqual([2026,9,24,8,30]);expect(JSON.stringify(game)).toBe(before);
});
it("keeps a partial date/time in the form and requires both parts before saving",()=>{
 const onSave=mount();fireEvent.change(screen.getByLabelText("对局时刻"),{target:{value:""}});fireEvent.click(screen.getByRole("button",{name:"保存棋谱",exact:true}));expect(onSave).not.toHaveBeenCalled();expect(screen.getByRole("alert").textContent).toContain("同时填写");expect((screen.getByLabelText("对局日期") as HTMLInputElement).value).not.toBe("");
});
it("allows both date/time fields to be explicitly cleared",async()=>{
 const onSave=mount();fireEvent.change(screen.getByLabelText("对局日期"),{target:{value:""}});fireEvent.change(screen.getByLabelText("对局时刻"),{target:{value:""}});fireEvent.click(screen.getByRole("button",{name:"保存棋谱",exact:true}));await waitFor(()=>expect(onSave).toHaveBeenCalledOnce());expect((onSave.mock.calls[0][0] as {metadata:{playedAt:string}}).metadata.playedAt).toBe("");
});
