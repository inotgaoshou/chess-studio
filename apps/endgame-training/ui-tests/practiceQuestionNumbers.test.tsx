import {fireEvent,render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {PracticeQuestionNumbers} from "../src/PracticeQuestionNumbers";
const items=[{id:"a",title:"第 1 题",number:21,status:"completed" as const},{id:"b",title:"",number:22,status:"revealed" as const},{id:"c",title:"",number:23,status:"verifying" as const},{id:"d",title:"",number:24,status:"pending" as const}];
it("shows numbered questions by default with independent current and result markers",()=>{
 localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");const onSelect=vi.fn();
 render(<PracticeQuestionNumbers items={items} index={0} onSelect={onSelect}/>);
 expect(screen.getByRole("button",{name:"收起数字导航"}).getAttribute("aria-expanded")).toBe("true");
 const completed=screen.getByRole("button",{name:"跳到第 21 题，当前题，已完成"});
 expect(completed.getAttribute("aria-current")).toBe("location");expect(completed.querySelector("small")?.textContent).toBe("✓");
 expect(screen.getByRole("button",{name:"跳到第 22 题，已查看解析"}).querySelector("small")?.textContent).toBe("阅");
 fireEvent.click(screen.getByRole("button",{name:"跳到第 24 题，待完成"}));expect(onSelect).toHaveBeenCalledWith(3);
});
it("collapses, remembers the preference across remounts and can expand again",()=>{
 localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");const props={items,index:0,onSelect:vi.fn()};
 const ui=render(<PracticeQuestionNumbers {...props}/>);fireEvent.click(screen.getByRole("button",{name:"收起数字导航"}));
 expect(screen.queryByRole("button",{name:/跳到第/})).toBeNull();ui.unmount();
 render(<PracticeQuestionNumbers {...props}/>);fireEvent.click(screen.getByRole("button",{name:"展开数字导航"}));
 expect(screen.getByRole("button",{name:"跳到第 21 题，当前题，已完成"})).toBeTruthy();
 localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");
});

it("pages only loaded numbers and returns the global list index without opening a question",()=>{
 localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");const onSelect=vi.fn();
 render(<PracticeQuestionNumbers items={Array.from({length:50},(_,i)=>({id:String(i),title:"",number:i+1}))} total={501} hasMore onSelect={onSelect}/>);
 expect(screen.getByText("已显示 50 / 共 501 题")).toBeTruthy();
 fireEvent.change(screen.getByRole("combobox",{name:"题号范围"}),{target:{value:"2"}});
 expect(screen.queryByRole("button",{name:"跳到第 40 题",exact:true})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"跳到第 50 题",exact:true}));expect(onSelect).toHaveBeenCalledWith(49);
 expect(screen.getByRole("button",{name:"下一组"}).hasAttribute("disabled")).toBe(true);
 expect(screen.getByText(/列表底部读取下一页/)).toBeTruthy();
});
