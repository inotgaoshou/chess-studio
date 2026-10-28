import {expect,it,vi} from "vitest";
import {act,render,screen} from "@testing-library/react";
import {useCatalogBrowse,type BrowsePage,type BrowseNode} from "../src/useCatalogBrowse";

it("shows the first material page while later restored pages are still pending",async()=>{
 let release!:(value:BrowsePage<BrowseNode>)=>void;
 const later=new Promise<BrowsePage<BrowseNode>>(resolve=>{release=resolve;});
 const empty={breadcrumbs:[],children:[],learningMaterials:[],statisticsReady:true};
 const request=vi.fn(async(query:Record<string,string>)=>query.view==="materials"?query.materialCursor?later:{...empty,learningMaterials:[{id:"first",title:"首批教材",reviewStatus:"published"}],materialNextCursor:"next"}:empty);
 function View(){const browse=useCatalogBrowse(request,{nodeId:"book"},true,0,2);return <>{browse.page.learningMaterials.map(item=><span key={item.id}>{item.title}</span>)}</>;}
 render(<View/>);
 await screen.findByText("首批教材",{},{timeout:500});
 await act(async()=>release({...empty,learningMaterials:[{id:"second",title:"后续教材",reviewStatus:"published"}]}));
 expect(await screen.findByText("后续教材")).toBeTruthy();
});
