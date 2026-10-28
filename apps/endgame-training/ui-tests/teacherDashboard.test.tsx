import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TeacherMobileWorkspace } from "../src/TeacherMobileWorkspace";
import { teachingClient, type TeachingAuth, type TeachingAssignment } from "../src/teaching";
const auth={token:"fixture",user:{id:"teacher",orgId:"org",orgName:"测试机构",displayName:"老师",loginName:"teacher",role:"coach",organizations:[]}} as unknown as TeachingAuth;
const assignments=[{id:"published",title:"已发布练习",status:"published",itemCount:3,completedCount:1,targetCount:2},{id:"draft",title:"草稿练习",status:"draft",itemCount:2,completedCount:0,targetCount:1},{id:"closed",title:"已关闭练习",status:"closed",itemCount:1,completedCount:0,targetCount:1}] as TeachingAssignment[];
beforeEach(()=>{vi.restoreAllMocks();vi.spyOn(teachingClient,"teacherClasses").mockResolvedValue([]);vi.spyOn(teachingClient,"teacherAssignments").mockResolvedValue(assignments);});
function mount(path="/teacher") {
  const navigate=vi.fn();
  const result=render(<TeacherMobileWorkspace auth={auth} path={path} onNavigate={navigate} onLogout={()=>{}} onExit={()=>{}} onRelogin={()=>{}} onAuthChange={()=>{}}/>);
  return {...result,navigate};
}
it("shows neutral actions in the requested order and opens all three overview lists",async()=>{
  const f=mount();
  await waitFor(()=>expect(teachingClient.teacherAssignments).toHaveBeenCalled());
  const actions=[...document.querySelectorAll('.teacher-mobile-actions > button')];
  expect(actions.map(button=>button.querySelector('b')?.textContent)).toEqual(["机构题库 · 摆棋出题","布置作业","学习打卡","班级与学生","申请加入机构"]);
  expect(actions.every(button=>!button.classList.contains('primary'))).toBe(true);
  const stats=within(screen.getByLabelText("教学统计"));
  fireEvent.click(stats.getByRole("button",{name:/负责班级/}));
  expect(f.navigate).toHaveBeenLastCalledWith("/teacher/classes");
  fireEvent.click(stats.getByRole("button",{name:/已发布作业/}));
  expect(f.navigate).toHaveBeenLastCalledWith("/teacher/assignments/published");
  fireEvent.click(stats.getByRole("button",{name:/待发布草稿/}));
  expect(f.navigate).toHaveBeenLastCalledWith("/teacher/assignments/drafts");
});
it("filters published and draft assignment lists without mixing closed work",async()=>{
  const f=mount("/teacher/assignments/published");
  await screen.findByText("已发布练习");
  expect(screen.queryByText("草稿练习")).toBeNull();
  expect(screen.queryByText("已关闭练习")).toBeNull();
  f.unmount();
  mount("/teacher/assignments/drafts");
  await screen.findByText("草稿练习");
  expect(screen.queryByText("已发布练习")).toBeNull();
});
it("shows an empty draft list and a return action",async()=>{
  vi.mocked(teachingClient.teacherAssignments).mockResolvedValue([]);
  const f=mount("/teacher/assignments/drafts");
  await screen.findByText("还没有待发布草稿。");
  fireEvent.click(screen.getByRole("button",{name:"返回教师工作台"}));
  expect(f.navigate).toHaveBeenCalledWith("/teacher");
});
