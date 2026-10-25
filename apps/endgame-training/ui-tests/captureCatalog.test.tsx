import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TeachingCatalog } from "../src/TeachingCatalog";
import { teachingClient, type TeachingAuth } from "../src/teaching";

it("lets a public student enter capture exercises without treating them as mate steps",async()=>{
 const capture={id:"capture-public",name:"吃子",kind:"category",teachingEntry:"capture",displayOrder:4,active:true,confirmed:true,itemCount:10};
 const book={...capture,id:"capture-book",parentId:capture.id,name:"吃子教材",kind:"series"};
 const vip={...capture,id:"vip-only",name:"实战残局",teachingEntry:"practical_endgames"};
 vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>({currentNode:params.nodeId?capture:null,breadcrumbs:params.nodeId?[capture]:[],children:params.nodeId?[book]:[capture,vip],learningMaterials:[],statisticsReady:true,mateStepCounts:[]}));
 const problems=vi.spyOn(teachingClient,"catalogProblems").mockResolvedValue({items:[{id:"capture-one",title:"净得子练习 0001",sourceIndex:0,startingFen:"4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1",sideToMove:"w",solutionLength:2,trainingGoal:{kind:"gain_material"}}],nextCursor:null} as never);
 const auth={user:{id:"capture-student",role:"student",vipActive:false,displayName:"学生"}} as TeachingAuth;
 render(<TeachingCatalog auth={auth} compact scene="browse" onPractice={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:/吃子/}));
 await screen.findByRole("button",{name:/第 1 题.*净得子/});
 expect(problems).toHaveBeenCalledWith(capture.id,expect.objectContaining({goal:"gain_material"}),false,auth,expect.anything());
 expect(screen.queryByRole("button",{name:/实战残局/})).toBeNull();
 expect(screen.queryByRole("button",{name:"两步杀",exact:true})).toBeNull();
});
