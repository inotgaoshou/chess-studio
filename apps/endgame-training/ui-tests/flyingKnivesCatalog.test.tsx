import {expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {TeachingCatalog,type TeachingCatalogNode} from "../src/TeachingCatalog";
import {teachingClient,type TeachingAuth} from "../src/teaching";

for(const delayedCounts of [false,true])it(`mobile flying knives opens books and retains materials on return (delayed counts: ${delayedCounts})`,async()=>{
 window.dispatchEvent(new Event("teaching-content-reset"));
 const auth={token:"fixture",expiresAt:"2099-01-01",user:{id:"flying-student",role:"student",vipActive:true}} as TeachingAuth;
 const topic:TeachingCatalogNode={id:"flying",name:"飞刀与陷阱",kind:"category",teachingEntry:"flying_knives",displayOrder:0,active:true,confirmed:true,itemCount:0,materialCount:42,rehearsalCount:42};
 const books=["杨典 · 布局飞刀陷阱","尚威 · 布局飞刀","杨官璘 · 刀局十局"].map((name,i)=>({...topic,id:`book-${i}`,name,kind:"book",parentId:topic.id,teachingEntry:undefined,materialCount:[24,8,10][i],rehearsalCount:[24,8,10][i]}));
 const requests=vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>{
  if(delayedCounts&&params.view==="counts")await new Promise(resolve=>setTimeout(resolve,30));
  const metadata=(n:TeachingCatalogNode)=>delayedCounts&&params.view==="structure"?{...n,itemCount:null,materialCount:null,rehearsalCount:null}:n;
  const book=books.find(b=>b.id===params.nodeId),current=params.nodeId===topic.id?topic:book;
  return {currentNode:current&&metadata(current),breadcrumbs:(book?[topic,book]:current?[topic]:[]).map(metadata),children:(book?[]:current?books:[topic]).map(metadata),learningMaterials:params.view==="materials"&&book?[{id:`game-${book.id}`,title:`${book.name} · 第1局`,reviewStatus:"published"}]:[],statisticsReady:true,statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1"};
 });
 const problems=vi.spyOn(teachingClient,"catalogProblems").mockResolvedValue({items:[]});
 const onReadGame=vi.fn();
 const props={auth,scene:"browse" as const,compact:true,onReadGame};
 const ui=render(<TeachingCatalog {...props}/>);
 fireEvent.click(await screen.findByRole("button",{name:/飞刀与陷阱/}));
 for(const book of books)expect(await screen.findByRole("button",{name:new RegExp(book.name)})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:/杨典 · 布局飞刀陷阱/}));
 fireEvent.click(await screen.findByRole("button",{name:"杨典 · 布局飞刀陷阱 · 第1局"}));
 expect(onReadGame).toHaveBeenCalledWith("game-book-0");
 expect(problems).not.toHaveBeenCalled();
 expect(requests.mock.calls.some(([p])=>p.nodeId==="book-0"&&p.view==="materials")).toBe(true);
 ui.unmount();render(<TeachingCatalog {...props}/>);
 expect(await screen.findByRole("button",{name:"杨典 · 布局飞刀陷阱 · 第1局"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"返回上级目录"}));
 await screen.findByRole("button",{name:/尚威 · 布局飞刀/});
 await waitFor(()=>expect(screen.queryByRole("button",{name:"杨典 · 布局飞刀陷阱 · 第1局"})).toBeNull());
 fireEvent.click(screen.getByRole("button",{name:"返回上级目录"}));
 expect(await screen.findByRole("button",{name:/飞刀与陷阱/})).toBeTruthy();
});
