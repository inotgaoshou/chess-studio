import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TeachingCatalog, type TeachingCatalogNode } from "../src/TeachingCatalog";
import { CatalogDirectorySheet } from "../src/CatalogDirectorySheet";
import { teachingClient, type TeachingAuth } from "../src/teaching";

const topic:TeachingCatalogNode={id:"practical",name:"实用残局",kind:"category",teachingEntry:"practical_endgames",displayOrder:0,active:true,confirmed:true,itemCount:60};
const book={...topic,id:"book",parentId:topic.id,name:"实用残局增订本",kind:"book",teachingEntry:undefined};
const chapter={...book,id:"chapter",parentId:book.id,name:"车类",kind:"chapter"};
const horse={...chapter,id:"horse",name:"马类"};
const auth={token:"fixture",user:{id:"coach",role:"coach",vipActive:true}} as TeachingAuth;
let epoch=0;
function tree(id?:string){const path=id===horse.id?[topic,book,horse]:id===chapter.id?[topic,book,chapter]:id===book.id?[topic,book]:id?[topic]:[];return {currentNode:path.at(-1)??null,breadcrumbs:path,children:!id?[topic]:id===topic.id?[book]:id===book.id?[chapter,horse]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1"};}
function fixture(){window.dispatchEvent(new Event("teaching-content-reset"));const scope=++epoch;vi.spyOn(teachingClient,"presentationScope").mockReturnValue(`directory-${scope}`);vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async p=>tree(p.nodeId));vi.spyOn(teachingClient,"catalogProblems").mockImplementation(async id=>({items:[{id:`p-${id}`,libraryId:"lib",title:"车兵胜法",sourceIndex:0,startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",sideToMove:"red",solutionLength:1}],nextCursor:null}));}

it("opens a paged directory without starting practice and selects a sibling chapter",async()=>{
 fixture();const onPractice=vi.fn();render(<TeachingCatalog compact scene="browse" auth={auth} onPractice={onPractice}/>);
 fireEvent.click(await screen.findByRole("button",{name:/实用残局/}));
 fireEvent.click(screen.getByRole("button",{name:"按书本学习",exact:true}));
 fireEvent.click(await screen.findByRole("button",{name:/实用残局增订本.*可练题/}));
 fireEvent.click(await screen.findByRole("button",{name:/车类.*可练题/}));
 await screen.findByRole("button",{name:/^(?!跳到).*第 1 题 · 车兵胜法/});
 expect(screen.queryByRole("navigation",{name:"数字导航"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"目录",exact:true}));const dialog=within(screen.getByRole("dialog",{name:"残局目录"}));
 fireEvent.click(await dialog.findByRole("button",{name:/马类.*可练题/}));
 await waitFor(()=>expect(screen.getByRole("heading",{name:"马类"})).toBeTruthy());
 expect(screen.queryByRole("dialog")).toBeNull();expect(onPractice).not.toHaveBeenCalled();
 expect(vi.mocked(teachingClient.catalogProblems).mock.calls.some(([id])=>id===horse.id)).toBe(true);
});

it("keeps navigation unchanged when cancelling and allows directory error retry",async()=>{
 const onSelect=vi.fn(),onClose=vi.fn();const request=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue(tree(book.id));
 render(<CatalogDirectorySheet rootId={topic.id} initialId={book.id} activeId={chapter.id} scope={`retry-${++epoch}`} request={request} onSelect={onSelect} onClose={onClose}/>);
 await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"重试",exact:true}));
 await screen.findByRole("button",{name:/马类.*可练题/});fireEvent.keyDown(document,{key:"Escape"});expect(onClose).toHaveBeenCalledOnce();expect(onSelect).not.toHaveBeenCalled();
});

it("loads subsequent directory pages and aborts outstanding reads when closed",async()=>{
 const request=vi.fn().mockImplementation(async p=>({...tree(book.id),children:p.cursor?[horse]:[chapter],nextCursor:p.cursor?null:"more"}));
 const ui=render(<CatalogDirectorySheet rootId={topic.id} initialId={book.id} activeId={chapter.id} scope={`paging-${++epoch}`} request={request} onSelect={vi.fn()} onClose={vi.fn()}/>);
 fireEvent.click(await screen.findByRole("button",{name:"下一页目录"}));
 await screen.findByRole("button",{name:/马类.*可练题/});expect(screen.getByRole("button",{name:/车类.*可练题/})).toBeTruthy();
 const signals=request.mock.calls.map(([,signal])=>signal as AbortSignal);ui.unmount();expect(signals.some(s=>s.aborted)).toBe(true);
});
