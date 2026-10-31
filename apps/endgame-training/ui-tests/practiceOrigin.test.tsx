import { beforeEach, expect, it } from "vitest";
import { loadPracticeOrigin, savePracticeOrigin, practiceBreadcrumb } from "../src/practiceOrigin";

beforeEach(()=>localStorage.clear());

it("restores catalog origin across sessions while isolating accounts and groups",()=>{
  const origin={section:"题库" as const,label:"基础杀法",totalProblems:501};
  savePracticeOrigin("account-a","group-1",origin);
  expect(loadPracticeOrigin("account-a","group-1")).toEqual(origin);
  expect(loadPracticeOrigin("account-b","group-1")).toBeUndefined();
  expect(loadPracticeOrigin("account-a","group-2")).toBeUndefined();
  savePracticeOrigin("account-a","group-2",loadPracticeOrigin("account-a","group-1")!);
  expect(loadPracticeOrigin("account-a","group-2")?.totalProblems).toBe(501);
  expect(practiceBreadcrumb({sourceKind:"random",origin:loadPracticeOrigin("account-a","group-2")})).toBe("题库 / 基础杀法 / 做题");
});

it("preserves assignment and mistakes semantics and hides learning for student mode",()=>{
  expect(practiceBreadcrumb({assignment:true,origin:{section:"题库",label:"基础杀法"}})).toBe("作业 / 详情 / 做题");
  expect(practiceBreadcrumb({sourceKind:"mistakes",origin:{section:"练习",label:"错题"}})).toBe("练习 / 错题 / 重练");
  expect(practiceBreadcrumb({origin:{section:"练习",label:"搜索"}})).toBe("练习 / 搜索 / 做题");
  expect(practiceBreadcrumb({origin:{section:"题库",label:"基础杀法"},learning:true})).toBe("题库 / 基础杀法 / 学习");
  expect(practiceBreadcrumb({sourceKind:"unknown"})).toBe("练习 / 做题");
});

it("ignores malformed stored presentation context",()=>{
  for(const value of ["not json","null",JSON.stringify({'["account","session"]':{section:"unknown",label:42}})]) {
    localStorage.setItem("qixi-practice-origins-v1",value);
    expect(loadPracticeOrigin("account","session")).toBeUndefined();
  }
});
