import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TeachingCatalog } from "../src/TeachingCatalog";
import { teachingClient, type TeachingAuth } from "../src/teaching";

it("lets a public student enter capture exercises without treating them as mate steps",async()=>{
 const capture={id:"capture-public",name:"吃子",kind:"category",teachingEntry:"capture",displayOrder:4,active:true,confirmed:true,itemCount:10};
 const vip={...capture,id:"vip-only",name:"实战残局",teachingEntry:"practical_endgames"};
 vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>({currentNode:params.nodeId?capture:null,breadcrumbs:params.nodeId?[capture]:[],children:params.nodeId?[]:[capture,vip],learningMaterials:[],statisticsReady:true,mateStepCounts:[]}));
 vi.spyOn(teachingClient,"catalogProblems").mockResolvedValue({items:[],nextCursor:null});
 const auth={user:{id:"capture-student",role:"student",vipActive:false,displayName:"学生"}} as TeachingAuth;
 render(<TeachingCatalog auth={auth} compact scene="browse" onPractice={()=>{}}/>);
 fireEvent.click(await screen.findByRole("button",{name:/吃子/}));
 expect(screen.queryByRole("button",{name:/实战残局/})).toBeNull();
 expect(screen.queryByRole("button",{name:"两步杀",exact:true})).toBeNull();
});
