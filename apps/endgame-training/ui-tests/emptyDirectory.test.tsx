import {act, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {TeacherAuthoring} from "../src/TeacherAuthoring";
import {AUTHORING_BASE as B, type AuthoringApi} from "../src/authoringDomain";

const empty={id:"empty",title:"空目录",revision:4,sortOrder:0,canEdit:true,itemCount:0,publishedCount:0,draftCount:0,items:[]};
function show(request:AuthoringApi["request"],personal=false){
  render(<TeacherAuthoring api={{request,classes:async()=>[],students:async()=>[]} as AuthoringApi} personal={personal} scopeKey="delete" orgName="验收机构" onBack={()=>{}} onAssigned={()=>{}}/>);
}
afterEach(()=>vi.restoreAllMocks());

it("offers deletion only for an editable, genuinely empty directory",async()=>{
  show(vi.fn(async()=>({items:[empty,{...empty,id:"hidden",title:"含下架题目",itemCount:1},{...empty,id:"other",title:"他人目录",canEdit:false},{...empty,id:"legacy",title:"旧版摘要",itemCount:undefined}]})) as AuthoringApi["request"]);
  await screen.findByRole("button",{name:"删除空目录空目录"});
  expect(screen.getAllByRole("button",{name:/^删除空目录/})).toHaveLength(1);
});

it("keeps the directory and makes no delete request when confirmation is cancelled",async()=>{
  vi.spyOn(window,"confirm").mockReturnValue(false);
  const request=vi.fn(async()=>({items:[empty]}));show(request as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"删除空目录空目录"}));
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button",{name:"删除空目录空目录"})).toBeTruthy();
});

it("deletes a personal empty directory once and finishes before background refresh",async()=>{
  vi.spyOn(window,"confirm").mockReturnValue(true);
  let finish!:(value:unknown)=>void,reads=0;
  const deletion=new Promise(resolve=>{finish=resolve;});
  const request=vi.fn(async(path:string,init?:RequestInit)=>{
    if(init?.method==="DELETE")return deletion;
    if(path===B+"/directories")return ++reads===1?{items:[empty]}:new Promise(()=>{});
    throw new Error(path);
  });show(request as AuthoringApi["request"],true);
  const button=await screen.findByRole("button",{name:"删除空目录空目录"});
  fireEvent.click(button);fireEvent.click(button);
  expect(request.mock.calls.filter(([,init])=>init?.method==="DELETE")).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(B+"/directories/empty",expect.objectContaining({method:"DELETE",body:JSON.stringify({expectedRevision:4})}));
  await act(async()=>finish({ok:true}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"删除空目录空目录"})).toBeNull());
  expect(screen.getByRole("button",{name:"＋ 新增目录"}).hasAttribute("disabled")).toBe(false);
});

it("retains a directory when the server detects a concurrent addition",async()=>{
  vi.spyOn(window,"confirm").mockReturnValue(true);
  show(vi.fn(async(_path:string,init?:RequestInit)=>{
    if(init?.method==="DELETE")throw new Error("目录已变化，请刷新后重试");
    return {items:[empty]};
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"删除空目录空目录"}));
  await screen.findByText("目录已变化，请刷新后重试");
  expect(screen.getByRole("button",{name:"删除空目录空目录"})).toBeTruthy();
});

it("reports refresh failure separately after deletion has succeeded",async()=>{
  vi.spyOn(window,"confirm").mockReturnValue(true);let reads=0;
  show(vi.fn(async(_path:string,init?:RequestInit)=>{
    if(init?.method==="DELETE")return {ok:true};
    if(++reads===1)return {items:[empty]};
    throw new Error("网络超时");
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"删除空目录空目录"}));
  await screen.findByText(/已删除，刷新失败/);
  expect(screen.queryByRole("button",{name:"删除空目录空目录"})).toBeNull();
});
