import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeachingCatalog, type TeachingCatalogNode } from "../src/TeachingCatalog";
import { teachingClient, type TeachingAuth } from "../src/teaching";

it("practical endgames filters on the server, keeps the filter on return and navigates loaded numbers", async () => {
  window.dispatchEvent(new Event("teaching-content-reset"));
  const auth = {token:"fixture",expiresAt:"2099-01-01",user:{id:"practical-student",role:"student",vipActive:true}} as TeachingAuth;
  const topic: TeachingCatalogNode = {id:"practical",name:"实用残局",kind:"category",teachingEntry:"practical_endgames",displayOrder:0,active:true,confirmed:true,itemCount:8632};
  vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params => ({currentNode:params.nodeId?topic:null,breadcrumbs:params.nodeId?[topic]:[],children:params.nodeId?[]:[topic],learningMaterials:[],statisticsReady:true,statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1"}));
  const problems = vi.spyOn(teachingClient,"catalogProblems").mockImplementation(async (_id, params) => {
    const start = params?.cursor ? 50 : 0;
    return {items:Array.from({length:start?30:50},(_,i)=>({id:`${params?.material||"all"}-${i+start}`,libraryId:"book",sourceIndex:i+start+10,title:"车兵巧胜单士",category:"实用残局",startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",sideToMove:"red",solutionLength:1})),nextCursor:start?null:"page2"};
  });
  const onPractice = vi.fn();
  const props = {auth,compact:true,scene:"browse" as const,sourceLibraries:[{id:"platform:book",title:"实用残局精选"}],onPractice};
  const ui = render(<TeachingCatalog {...props}/>);
  fireEvent.click(await screen.findByRole("button",{name:/实用残局/}));
  expect(await screen.findByText("来源：《实用残局精选》 · 原题第 11 题")).toBeTruthy();

  const jump=screen.getByRole("button",{name:/跳到第 25 题/});
  const scroll=vi.fn(); const card=ui.container.querySelectorAll<HTMLElement>(".catalog-problem-card")[24];card.scrollIntoView=scroll;
  fireEvent.click(jump);expect(scroll).toHaveBeenCalled();
  fireEvent.click(card.querySelector("button")!);
  expect(onPractice.mock.calls[0][0]).toHaveLength(25);
  expect(onPractice.mock.calls[0][2]).toBe("all-24");expect(onPractice.mock.calls[0][3]["all-24"]).toBe(25);
  fireEvent.click(screen.getByRole("button",{name:"下一页题目"}));
  await screen.findByRole("button",{name:/跳到第 51 题/});
  expect(ui.container.querySelectorAll(".catalog-problem-card")).toHaveLength(30);
  expect(ui.container.querySelector(".catalog-problem-card strong")?.textContent).toContain("第 51 题");
  fireEvent.click(screen.getByRole("button",{name:"上一页题目"}));
  await screen.findByRole("button",{name:/跳到第 1 题/});
  expect(ui.container.querySelectorAll(".catalog-problem-card")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button",{name:/筛选/}));
  fireEvent.change(screen.getByRole("combobox",{name:"兵种"}),{target:{value:"r"}});
  await waitFor(()=>expect(problems.mock.calls.at(-1)?.[1]).toMatchObject({material:"r"}));
  await waitFor(()=>expect(ui.container.querySelectorAll(".catalog-problem-card")).toHaveLength(50));
  expect((screen.getByRole("combobox",{name:"题目页码（已读取页面）"}) as HTMLSelectElement).value).toBe("0");
  ui.unmount();render(<TeachingCatalog {...props}/>);
  fireEvent.click(await screen.findByRole("button",{name:/筛选/}));
  expect((screen.getByRole("combobox",{name:"兵种"}) as HTMLSelectElement).value).toBe("r");
  fireEvent.click(screen.getByRole("button",{name:"清空"}));
  await waitFor(()=>expect(problems.mock.calls.at(-1)?.[1].material).toBe(""));
});

it.each([
  {entry:"practical_endgames",name:"实用残局",book:"实用残局精选",chapter:"第一章 车兵残局",question:"车兵残局"},
  {entry:"middlegame",name:"中局战术",book:"中局战术精选",chapter:"第一章 弃子战术",question:"弃子争先"},
])("browses $name books and chapters, restores the visit and switches back to all questions", async ({entry,name,book:bookName,chapter:chapterName,question:questionTitle}) => {
  window.dispatchEvent(new Event("teaching-content-reset"));
  const auth={token:"books",expiresAt:"2099-01-01",user:{id:`books-${entry}`,role:"student",vipActive:true}} as TeachingAuth;
  const topic:TeachingCatalogNode={id:`${entry}-books`,name,kind:"category",teachingEntry:entry,displayOrder:0,active:true,confirmed:true,itemCount:30};
  const book:TeachingCatalogNode={...topic,id:"book-a",parentId:topic.id,name:bookName,kind:"book",teachingEntry:undefined};
  const chapter:TeachingCatalogNode={...book,id:"chapter-a",parentId:book.id,name:chapterName,kind:"chapter"};
  vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>{
    const path=params.nodeId===chapter.id?[topic,book,chapter]:params.nodeId===book.id?[topic,book]:params.nodeId?[topic]:[];
    return {currentNode:path.at(-1)??null,breadcrumbs:path,children:!params.nodeId?[topic]:params.nodeId===topic.id?[book]:params.nodeId===book.id?[chapter]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:"1"};
  });
  const problems=vi.spyOn(teachingClient,"catalogProblems").mockResolvedValue({items:[{id:"book-question",libraryId:"book-a",sourceIndex:0,title:questionTitle,category:name,startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",sideToMove:"red",solutionLength:1}],nextCursor:null});
  const props={auth,compact:true,scene:"browse" as const,onPractice:vi.fn()};
  let view=render(<TeachingCatalog {...props}/>);
  fireEvent.click(await screen.findByRole("button",{name:new RegExp(name)}));
  fireEvent.click(await screen.findByRole("button",{name:"按书本学习"}));
  fireEvent.click(await screen.findByRole("button",{name:new RegExp(bookName)}));
  fireEvent.click(await screen.findByRole("button",{name:new RegExp(chapterName)}));
  await screen.findByText(entry==="practical_endgames"?`第 1 题 · ${questionTitle}`:"第 1 题");
  await waitFor(()=>expect(problems.mock.calls.at(-1)?.[0]).toBe(chapter.id));
  expect(screen.getByRole("navigation",{name:entry==="middlegame"?"中局书本目录":"残局书本目录"})).toBeTruthy();
  if(entry==="practical_endgames") {
    fireEvent.click(screen.getByRole("button",{name:/筛选/}));
    fireEvent.change(screen.getByRole("combobox",{name:"残局难度"}),{target:{value:"3"}});
    await waitFor(()=>expect(problems.mock.calls.at(-1)?.[1]).toMatchObject({difficulty:3}));
  }
  fireEvent.click(view.container.querySelector('.catalog-problem-card button')!);
  view.unmount();view=render(<TeachingCatalog {...props}/>);
  await screen.findByText(entry==="practical_endgames"?`第 1 题 · ${questionTitle}`:"第 1 题");
  expect(screen.getByRole("button",{name:"按书本学习"}).getAttribute("aria-pressed")).toBe("true");
  if(entry==="practical_endgames") {
    fireEvent.click(screen.getByRole("button",{name:/筛选/}));
    expect((screen.getByRole("combobox",{name:"残局难度"}) as HTMLSelectElement).value).toBe("3");
  }
  fireEvent.click(screen.getByRole("button",{name:"返回上级目录"}));
  expect(await screen.findByRole("button",{name:new RegExp(chapterName)})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"全部题目"}));
  await waitFor(()=>expect(problems.mock.calls.at(-1)?.[0]).toBe(topic.id));
  expect(screen.getByRole("button",{name:"全部题目"}).getAttribute("aria-pressed")).toBe("true");
});

it.each([
 {entry:"basic_mates",name:"基础杀法"},
 {entry:"practical_endgames",name:"实用残局"},
])("shows collapsible numeric navigation outside $name questions and locates a card without starting practice",async({entry,name})=>{
 window.dispatchEvent(new Event("teaching-content-reset"));localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");
 const auth={token:"outer-numbers",expiresAt:"2099-01-01",user:{id:`outer-${entry}`,role:"student",vipActive:true}} as TeachingAuth;
 const topic={id:entry,name,kind:"category",teachingEntry:entry,displayOrder:0,active:true,confirmed:true,itemCount:50};
 vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>({currentNode:params.nodeId?topic:null,breadcrumbs:params.nodeId?[topic]:[],children:params.nodeId?[]:[topic],learningMaterials:[],statisticsReady:true,mateStepCounts:[{mateMoves:2,itemCount:50}]}));
 const questions=Array.from({length:50},(_,i)=>({id:`outer-${i}`,libraryId:"book",sourceIndex:i,title:"第 1 题",category:name,startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",sideToMove:"red",solutionLength:1,verifiedMateMoves:2}));
 vi.spyOn(teachingClient,"catalogProblems").mockResolvedValue({items:questions,nextCursor:null});
 const onPractice=vi.fn();const ui=render(<TeachingCatalog auth={auth} compact scene="browse" onPractice={onPractice} practiceStatuses={{"outer-24":"revealed"}}/>);
 fireEvent.click(await screen.findByRole("button",{name:new RegExp(name)}));
 await screen.findByRole("navigation",{name:"题库数字导航"});
 expect(screen.getByRole("button",{name:"收起数字导航"}).getAttribute("aria-expanded")).toBe("true");

 const scroll=vi.fn(),card=ui.container.querySelectorAll<HTMLElement>(".catalog-problem-card")[24];card.scrollIntoView=scroll;
 fireEvent.click(screen.getByRole("button",{name:"跳到第 25 题，已查看解析"}));
 expect(scroll).toHaveBeenCalledOnce();expect(onPractice).not.toHaveBeenCalled();
 expect(document.activeElement).toBe(card.querySelector("button"));
 expect(ui.container.querySelectorAll(".practice-question-numbers")).toHaveLength(1);
 expect(ui.container.querySelector(".practice-question-numbers")?.compareDocumentPosition(card)! & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"收起数字导航"}));
 expect(screen.queryByRole("button",{name:/跳到第/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"展开数字导航"}));
 fireEvent.click(card.querySelector("button")!);expect(onPractice.mock.calls[0][2]).toBe("outer-24");
 ui.unmount();
});
