import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {TeacherAuthoring} from "../src/TeacherAuthoring";
import {AUTHORING_BASE as B,START_FEN,type AuthoringApi} from "../src/authoringDomain";
it("shows filtered question grids directly without book classification",async()=>{
 const directory={id:"d",title:"练习目录",revision:1,sortOrder:0,canEdit:true,itemCount:0,publishedCount:0,draftCount:0,items:[]};
 const request=vi.fn(async(path:string)=>{
  if(path===B+"/directories")return {items:[directory]};
  if(path===B+"/directories/d")return directory;
  if(path.startsWith(B+"/sources?")){
   const params=new URL(path,"https://test.invalid").searchParams;
   expect(params.has("libraryId")).toBe(false);expect(params.get("limit")).toBe("50");
   const step=params.get("mateMoves")||params.get("mateGroup")||"all";
   return {mateFilterVersion:1,items:[{id:step,title:"筛选结果 "+step,fen:START_FEN}],totalCount:1,categories:[],nextCursor:null};
  }
  throw new Error("不应读取书本分类: "+path);
 });
 render(<TeacherAuthoring api={{request,classes:async()=>[],students:async()=>[]} as AuthoringApi} scopeKey="direct" orgName="验收机构" onBack={()=>{}} onAssigned={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:/练习目录.*道已发布/}));
 fireEvent.click(await screen.findByRole("button",{name:"＋添加题目"}));
 fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
 await screen.findByText("筛选结果 all");
 for(const [label,step] of [["两步杀","2"],["四步及以上","long"],["全部","all"]]){
  fireEvent.click(screen.getByRole("button",{name:label,exact:true}));await screen.findByText("筛选结果 "+step);
 }
 expect(screen.queryByRole("dialog",{name:"选择题库／书本"})).toBeNull();
 expect(request.mock.calls.some(([path])=>path.includes("source-libraries"))).toBe(false);
 fireEvent.click(screen.getByText("筛选结果 all").closest("button")!);
 await screen.findByRole("button",{name:"确认添加（1）"});
 fireEvent.click(screen.getByRole("dialog").querySelector("header button")!);
 await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
 expect(request.mock.calls.every(([path])=>!path.includes("assignments"))).toBe(true);
});
