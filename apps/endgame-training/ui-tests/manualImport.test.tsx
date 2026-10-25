import {expect,it,vi} from "vitest";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {ManualImportDialog} from "../src/ManualImportDialog";
vi.mock("../src/wasm",()=>({trainingCore:async()=>({importLocalManual:()=>JSON.stringify({metadata:{title:"测试",event:"",site:"",date:"",red:"",black:"",result:"*"},startingFen:"9 w",note:"",tree:{root_id:"root",nodes:{}},warnings:[]})})}));
it("retries the same import identity instead of creating duplicate games after a failed write",async()=>{
 const onImport=vi.fn().mockRejectedValueOnce(Error("暂时无法写入")).mockResolvedValue(undefined);
 render(<ManualImportDialog onImport={onImport} onClose={()=>{}}/>);
 fireEvent.change(screen.getByRole("textbox",{name:"粘贴棋谱"}),{target:{value:"1. b0c2"}});fireEvent.click(screen.getByRole("button",{name:"导入并录谱"}));
 expect((await screen.findByRole("alert")).textContent).toContain("暂时无法写入");fireEvent.click(screen.getByRole("button",{name:"导入并录谱"}));await waitFor(()=>expect(onImport).toHaveBeenCalledTimes(2));expect(onImport.mock.calls[0][0].id).toBe(onImport.mock.calls[1][0].id);
});
