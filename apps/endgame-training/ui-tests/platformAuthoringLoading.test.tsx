import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {TeacherAuthoring} from "../src/TeacherAuthoring";
import {AUTHORING_BASE as B,START_FEN,type AuthoringApi} from "../src/authoringDomain";
const basic={id:"basic",name:"基础杀法",kind:"topic",teachingEntry:"basic_mates",itemCount:150};
const child={id:"chapter",name:"第一章",kind:"chapter",itemCount:30};
const problem={id:"p",title:"正常题目",startingFen:START_FEN,reviewStatus:"published",validationStatus:"ready"};
function show(request:AuthoringApi["request"]){render(<TeacherAuthoring api={{request,classes:async()=>[],students:async()=>[]} as AuthoringApi} scopeKey="catalog-loading" orgName="验收机构" onBack={()=>{}} onAssigned={()=>{}}/>);fireEvent.click(screen.getByRole("button",{name:"平台作业库"}));}
afterEach(()=>vi.useRealTimers());
it("shows child directories while questions are pending instead of waiting for both",async()=>{
  show(vi.fn(async(path:string)=>{
    if(path===B+"/directories")return {items:[]};
    if(path.includes("/browse?")){const id=new URL(path,"https://test.invalid").searchParams.get("nodeId");return {currentNode:id?basic:undefined,breadcrumbs:id?[basic]:[],children:id?[child]:[basic]};}
    if(path.includes("/problems?"))return new Promise(()=>{});
    throw new Error(path);
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:/基础杀法.*150 题/}));
  expect(await screen.findByRole("button",{name:/第一章/})).toBeTruthy();
  expect(screen.getByRole("button",{name:"两步杀"}).hasAttribute("disabled")).toBe(false);
});
it("loads 50 questions without a full count and isolates late results after returning",async()=>{
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  const request=vi.fn(async(path:string)=>{
    if(path===B+"/directories")return {items:[]};
    if(path.includes("/browse?")){const id=new URL(path,"https://test.invalid").searchParams.get("nodeId");return {currentNode:id?basic:undefined,breadcrumbs:id?[basic]:[],children:id?[]:[basic]};}
    if(path.includes("/problems?"))return pending;
    throw new Error(path);
  });show(request as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:/基础杀法.*150 题/}));
  await waitFor(()=>expect(request.mock.calls.some(([path])=>path.includes("pageOnly=true")&&path.includes("limit=50"))).toBe(true));
  fireEvent.click(screen.getByRole("button",{name:"‹ 返回上级"}));
  await screen.findByRole("button",{name:/基础杀法.*150 题/});
  await act(async()=>finish({items:[problem],nextCursor:null}));
  expect(screen.queryByText("正常题目")).toBeNull();
});
it("times out a stuck directory read and exposes retry without locking filters",async()=>{
  vi.useFakeTimers();
  show(vi.fn(async(path:string)=>path===B+"/directories"?{items:[]}:new Promise(()=>{})) as AuthoringApi["request"]);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10_001);});
  expect(screen.getByText(/读取超时/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"重试读取"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"一步杀"}).hasAttribute("disabled")).toBe(false);
});
it("retries a failed read and keeps structure visible when counts fail",async()=>{
  let fail=true;
  show(vi.fn(async(path:string)=>{
    if(path===B+"/directories")return {items:[]};
    const params=new URL(path,"https://test.invalid").searchParams;
    if(params.get("view")==="counts")throw new Error("统计失败");
    if(fail){fail=false;throw new Error("连接失败");}
    return {children:[{...basic,itemCount:null}],breadcrumbs:[]};
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"重试读取"}));
  expect(await screen.findByRole("button",{name:/基础杀法.*题数统计中/})).toBeTruthy();
  await screen.findByText(/题数统计暂不可用/);
});
