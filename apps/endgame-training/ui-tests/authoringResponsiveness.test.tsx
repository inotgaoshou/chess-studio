import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeacherAuthoring } from "../src/TeacherAuthoring";
import { AUTHORING_BASE as B, type AuthoringApi } from "../src/authoringDomain";

function deferred<T>() {
  let resolve!: (value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
const directory={id:"d",title:"练习目录",revision:1,sortOrder:0,canEdit:true,publishedCount:0,draftCount:0,items:[]};
function show(request:AuthoringApi["request"]) {
  const api={request,classes:async()=>[],students:async()=>[]} as AuthoringApi;
  render(<TeacherAuthoring api={api} scopeKey="responsive" orgName="验收机构" onBack={()=>{}} onAssigned={()=>{}}/>);
}

it("closes a successful create before its refresh completes and reports refresh failure separately",async()=>{
  const refresh=deferred<any>();let reads=0;
  const request=vi.fn(async(path:string,init?:RequestInit)=>{
    if(path===B+"/directories" && init?.method==="POST")return {id:"new",directory:{...directory,id:"new",title:"新目录"}};
    if(path===B+"/directories")return ++reads===1?{items:[directory]}:refresh.promise;
    throw new Error(path);
  }) as AuthoringApi["request"];
  show(request);
  fireEvent.click(await screen.findByRole("button",{name:"＋ 新增目录"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"新目录"}});
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"新增目录"})).toBeNull());
  expect(screen.getByRole("button",{name:/新目录.*道已发布/})).toBeTruthy();
  expect(screen.getByRole("button",{name:"＋ 新增目录"}).hasAttribute("disabled")).toBe(false);
  await act(async()=>refresh.resolve(Promise.reject(new Error("刷新网络失败"))));
  expect(await screen.findByText(/已保存，刷新失败/)).toBeTruthy();
  expect(screen.queryByText("保存中…")).toBeNull();
});

it("reuses the same create UUID when a response is lost and the teacher retries",async()=>{
  const ids:string[]=[];
  show(vi.fn(async(path:string,init?:RequestInit)=>{
    if(path===B+"/directories" && init?.method==="POST"){
      const body=JSON.parse(String(init.body));ids.push(body.id);
      if(ids.length===1)throw new Error("请求超时");
      return {id:body.id,directory:{...directory,id:body.id,title:body.title}};
    }
    if(path===B+"/directories")return {items:[directory]};
    throw new Error(path);
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"＋ 新增目录"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"重试目录"}});
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  await within(screen.getByRole("dialog",{name:"新增目录"})).findByText("请求超时");
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  await waitFor(()=>expect(ids).toHaveLength(2));
  expect(ids[1]).toBe(ids[0]);
});

it("opens a directory directly without waiting for another directory-list request",async()=>{
  let reads=0;
  const request=vi.fn(async(path:string)=>{
    if(path===B+"/directories"){reads++;return {items:[directory]};}
    if(path===B+"/directories/d")return directory;
    throw new Error(path);
  });
  show(request as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:/练习目录.*道已发布/}));
  await screen.findByRole("button",{name:"＋添加题目"});
  expect(reads).toBe(1);
});

it("allows entering a book while its exact total is still pending",async()=>{
  const counts=deferred<any>();const paths:string[]=[];
  show(vi.fn(async(path:string)=>{
    paths.push(path);
    if(path===B+"/directories")return {items:[directory]};
    if(path===B+"/directories/d")return directory;
    if(path.startsWith(B+"/source-libraries?")){
      const view=new URL(path,"https://test.invalid").searchParams.get("view");
      if(view==="counts")return counts.promise;
      return {mateFilterVersion:1,items:[{id:"book",title:"独立统计题库",sourceScope:"平台"}],nextCursor:null};
    }
    if(path.startsWith(B+"/sources?"))return {mateFilterVersion:1,items:[],totalCount:0,nextCursor:null};
    throw new Error(path);
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:/练习目录.*道已发布/}));
  fireEvent.click(await screen.findByRole("button",{name:"＋添加题目"}));
  fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  const books=await screen.findByRole("dialog",{name:"选择题库／书本"});
  const book=await within(books).findByRole("button",{name:/独立统计题库/});
  expect(book.hasAttribute("disabled")).toBe(false);
  expect(paths.some(path=>path.includes("view=page"))).toBe(true);
  await waitFor(()=>expect(paths.some(path=>path.includes("view=counts"))).toBe(true));
  fireEvent.click(book);
  await screen.findByRole("dialog",{name:"选择平台／机构题目"});
  await act(async()=>counts.resolve({totalCount:1}));
  expect(screen.queryByRole("dialog",{name:"选择题库／书本"})).toBeNull();
});

it("also finishes a save immediately with an older id-only create response",async()=>{
  let reads=0;
  show(vi.fn(async(path:string,init?:RequestInit)=>{
    if(path===B+"/directories" && init?.method==="POST")return {id:"legacy"};
    if(path===B+"/directories")return ++reads===1?{items:[]}:new Promise(()=>{});
    throw new Error("Unexpected blocking read: "+path);
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:"＋ 新增目录"}));
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"兼容目录"}});
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"新增目录"})).toBeNull());
  expect(screen.getByRole("button",{name:/兼容目录.*道已发布/})).toBeTruthy();
});

it("ignores a question response after returning to the directory list",async()=>{
  const pending=deferred<any>();
  const question={id:"q",kind:"authored",revision:1,canEdit:true,status:"draft",body:{title:"延迟题目",startingFen:"4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",note:"",solution:[]}};
  show(vi.fn(async(path:string)=>{
    if(path===B+"/directories")return {items:[directory]};
    if(path===B+"/directories/d")return {...directory,items:[question]};
    if(path===B+"/questions/q")return pending.promise;
    throw new Error(path);
  }) as AuthoringApi["request"]);
  fireEvent.click(await screen.findByRole("button",{name:/练习目录.*道已发布/}));
  fireEvent.click(await screen.findByRole("button",{name:/1. 延迟题目/}));
  await screen.findByText("正在打开题目…");
  fireEvent.click(screen.getByRole("button",{name:"‹ 返回"}));
  await screen.findByRole("button",{name:"＋ 新增目录"});
  await act(async()=>pending.resolve(question));
  expect(screen.queryByRole("heading",{name:"摆棋录题"})).toBeNull();
  expect(screen.getByRole("button",{name:"＋ 新增目录"})).toBeTruthy();
});
