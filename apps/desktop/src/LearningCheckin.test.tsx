import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckinStudentWorkspace, CheckinTeacherWorkspace } from "../../endgame-training/src/LearningCheckin";
import { CheckinStudentClient } from "../../endgame-training/src/checkinOffline";
import type { CheckinPersistence } from "../../endgame-training/src/checkinOffline";
import { addDays, beijingDate } from "../../endgame-training/src/checkinDomain";
import type { CheckinApi, CheckinDetail, CheckinPlan } from "../../endgame-training/src/checkinDomain";
afterEach(cleanup);
class Memory implements CheckinPersistence {
  records = new Map<string,unknown>();
  async get<T>(key:string){return this.records.get(key) as T|undefined;}
  async put(key:string,value:unknown){this.records.set(key,value);}
  async remove(key:string){this.records.delete(key);}
  async all<T>(){return [...this.records.values()] as T[];}
}
const today=beijingDate();
function plan(id:string,student:string): CheckinPlan {return{id,title:`${student}阶段计划`,status:"published",phase:"active",startsAt:`${addDays(today,-7)}T00:00:00+08:00`,endsAt:`${addDays(today,7)}T23:59:00+08:00`,supplementUntil:`${addDays(today,14)}T23:59:00+08:00`};}
function detail(p:CheckinPlan,student:string):CheckinDetail{return{plan:p,recipients:[{studentId:student,displayName:student}],tasks:[{id:`${p.id}-task`,templateId:"template",localDate:today,subject:"语文",instruction:"阅读课文20分钟",required:true,photoRequired:false}],submissions:[],reviews:[],badges:[],serverNow:new Date().toISOString()};}
function api():CheckinApi {
  const a=plan("a","哥哥"),b=plan("b","妹妹");
  return{list:vi.fn(async()=>[a,b]),detail:vi.fn(async id=>id==="a"?detail(a,"哥哥"):detail(b,"妹妹")),create:vi.fn(async()=>a),save:vi.fn(async()=>a),publish:vi.fn(async()=>a),edit:vi.fn(async()=>a),remove:vi.fn(async()=>({deleted:true})),submit:vi.fn(async()=>({duplicate:false})),review:vi.fn(async()=>null),upload:vi.fn(async(_t,id)=>({id})),photo:vi.fn(async()=>new Blob()),classes:vi.fn(async()=>[{id:"class",name:"家庭学习班"}]),students:vi.fn(async()=>[{id:"哥哥",displayName:"哥哥"},{id:"妹妹",displayName:"妹妹"}])};
}
describe("LearningCheckin",()=>{
  it("resets selected child when a teacher opens another published plan",async()=>{const port=api();render(<CheckinTeacherWorkspace api={port}/>);await screen.findByText("哥哥阶段计划");await userEvent.click(screen.getAllByRole("button",{name:"完成情况"})[0]);await waitFor(()=>expect((screen.getByLabelText("查看学生") as HTMLSelectElement).value).toBe("哥哥"));await userEvent.click(screen.getAllByRole("button",{name:"完成情况"})[1]);await waitFor(()=>expect((screen.getByLabelText("查看学生") as HTMLSelectElement).value).toBe("妹妹"));expect(screen.getByRole("heading",{name:"妹妹阶段计划 · 完成情况"})).toBeTruthy();});
  it("can target one child and preview all seven repeating days before publishing",async()=>{const port=api();render(<CheckinTeacherWorkspace api={port}/>);await screen.findByText("哥哥阶段计划");await userEvent.click(screen.getByRole("button",{name:"新建阶段计划"}));await userEvent.type(screen.getByLabelText("计划名称"),"哥哥语文计划");await userEvent.click(screen.getByLabelText("哥哥"));await userEvent.type(screen.getByLabelText("具体要求"),"阅读20分钟");await userEvent.click(screen.getByRole("button",{name:"预览发布"}));expect(screen.getByRole("heading",{name:"发布预览"})).toBeTruthy();await userEvent.click(screen.getByRole("button",{name:"确认发布阶段计划"}));await waitFor(()=>expect(port.create).toHaveBeenCalled());const body=vi.mocked(port.create).mock.calls[0][0];expect(body.studentIds).toEqual(["哥哥"]);expect(body.classIds).toEqual([]);expect(body.templates[0].weekdays).toEqual([1,2,3,4,5,6,7]);});
  it("preserves an open student editor and its note across background refresh",async()=>{const port=api(),store=new Memory();const client=new CheckinStudentClient(port,"哥哥",store,()=>true);render(<CheckinStudentWorkspace client={client} studentId="哥哥" onBack={vi.fn()}/>);await userEvent.click(await screen.findByRole("button",{name:"去打卡"}));await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole("region",{name:"任务详情"})));const field=await screen.findByLabelText("一句心得（选填）");await waitFor(()=>expect((field as HTMLTextAreaElement).disabled).toBe(false));await userEvent.type(field,"今天读完了课文");fireEvent(window,new Event("qixi-checkin-synced"));await waitFor(()=>expect(vi.mocked(port.detail).mock.calls.length).toBeGreaterThan(1));expect((screen.getByLabelText("一句心得（选填）") as HTMLTextAreaElement).value).toBe("今天读完了课文");await waitFor(async()=>expect((await client.draft("a-task"))?.note).toBe("今天读完了课文"));});
});
