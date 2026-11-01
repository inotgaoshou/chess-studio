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

it("separates 50-question pages and 25-question groups with a partial final group",()=>{
 localStorage.removeItem("qixi-catalog-numbers-collapsed-v1");const onSelect=vi.fn(),onPageChange=vi.fn();
 const items=Array.from({length:100},(_,i)=>({id:String(i),title:"",number:i+1}));
 const ui=render(<PracticeQuestionNumbers items={items} total={1831} hasMore onPageChange={onPageChange} onSelect={onSelect}/>);
 expect(screen.getByText("第 1 页 / 共 37 页 · 每页 50 题")).toBeTruthy();
 expect(screen.getByText("共 1831 题 · 共 74 组 · 每组 25 题")).toBeTruthy();
 expect(screen.getAllByRole("button",{name:/跳到第/})).toHaveLength(25);
 fireEvent.click(screen.getByRole("button",{name:"第 2 组 · 25 题"}));expect(onSelect).toHaveBeenCalledWith(25);
 ui.rerender(<PracticeQuestionNumbers items={items} index={25} total={1831} hasMore onPageChange={onPageChange} onSelect={onSelect}/>);
 fireEvent.click(screen.getByRole("button",{name:"跳到第 50 题",exact:true}));expect(onSelect).toHaveBeenLastCalledWith(49);
 fireEvent.click(screen.getByRole("button",{name:"下一页",exact:true}));expect(onPageChange).toHaveBeenCalledWith(1);
 ui.rerender(<PracticeQuestionNumbers items={items.slice(0,56)} page={1} total={56} onPageChange={onPageChange} onSelect={onSelect}/>);
 expect(screen.getByText("第 2 页 / 共 2 页 · 每页 50 题")).toBeTruthy();
 expect(screen.getByRole("button",{name:"第 3 组 · 6 题"})).toBeTruthy();
 expect(screen.getByRole("button",{name:"下一页",exact:true}).hasAttribute("disabled")).toBe(true);
 fireEvent.click(screen.getByRole("button",{name:"上一页",exact:true}));expect(onPageChange).toHaveBeenLastCalledWith(0);
});
