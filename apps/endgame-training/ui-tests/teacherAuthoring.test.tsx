import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeacherAuthoring } from "../src/TeacherAuthoring";
import {
  AUTHORING_BASE as B,
  START_FEN,
  EMPTY_FEN,
  addAnswer,
  choicesAt,
  goalFor,
  type AuthoringApi,
  type AuthoringDirectory,
  type AuthoredQuestion,
} from "../src/authoringDomain";

beforeEach(() => localStorage.clear());
function question(): AuthoredQuestion {
  return {
    id: "q",
    revision: 1,
    publishedProblemId: "p",
    canEdit: true,
    archived: false,
    status: "published",
    body: { title: "一步杀", startingFen: START_FEN, note: "", solution: [] },
  };
}
function fixture(items: AuthoredQuestion[] = []) {
  const directory: AuthoringDirectory = {
    id: "d",
    title: "杀棋训练",
    revision: 1,
    sortOrder: 0,
    canEdit: true,
    items,
  };
  const assignment = vi.fn(async (_body?: unknown, _init?: RequestInit) => ({
    id: "assignment",
  }));
  const request = vi.fn(
    async (path: string, init?: RequestInit): Promise<any> => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === B + "/directories") return { items: [directory] };
      if (path === B + "/directories/d") return directory;
      if (path === B + "/questions/q" && !init) return items[0];
      if (path.startsWith(B + "/questions/") && init?.method === "PUT") {
        const q = {
          ...question(),
          id: path.split("/").at(-1)!,
          status: "draft" as const,
          publishedProblemId: undefined,
          body: body.body,
        };
        directory.items.push(q);
        return q;
      }
      if (path === "/api/v1/admin/assignments") return assignment(body, init);
      throw new Error("Unexpected " + path);
    },
  );
  const api = {
    request,
    classes: async () => [{ id: "c", name: "一班" }],
    students: async () => [{ id: "s", displayName: "小明", loginName: "ming" }],
  } as AuthoringApi;
  const assigned = vi.fn();
  render(
    <TeacherAuthoring
      api={api}
      scopeKey="scope"
      orgName="测试机构"
      onBack={() => {}}
      onAssigned={assigned}
    />,
  );
  return { request, assignment, assigned, directory };
}
async function enter() {
  fireEvent.click(
    await screen.findByRole("button", { name: /杀棋训练.*道已发布/ }),
  );
  await screen.findByRole("button", { name: "＋添加题目" });
}
async function newPosition() {
  await enter();
  fireEvent.click(screen.getByRole("button", { name: "＋添加题目" }));
  fireEvent.click(screen.getByRole("button", { name: "手动摆棋" }));
  await screen.findByRole("heading", { name: "摆棋录题" });
}
async function assignmentForm() {
  await enter();
  fireEvent.click(screen.getByRole("button", { name: "布置作业" }));
  await screen.findByLabelText("一班（1人）");
}
async function confirmAssignment() {
  fireEvent.click(screen.getByLabelText("一班（1人）"));
  fireEvent.click(screen.getByRole("button", { name: "核对并发布" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布给学生" }),
  );
}

it("records a position, preserves a piece on repeated move selection, flips only the view, and returns to directory", async () => {
  const f = fixture();
  await newPosition();
  fireEvent.click(screen.getByRole("button", { name: "移动" }));
  fireEvent.click(screen.getByRole("button", { name: "10行1列车" }));
  fireEvent.click(screen.getByRole("button", { name: "10行1列车" }));
  expect(screen.getByRole("button", { name: "10行1列车" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  fireEvent.click(screen.getByRole("button", { name: "红先" }));
  fireEvent.click(screen.getByRole("button", { name: "翻转" }));
  expect(screen.getByRole("button", { name: "黑先" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "完成摆棋" }));
  await screen.findByText("1. 训练题");
  expect(f.directory.items[0].body.startingFen).toBe(
    EMPTY_FEN.replace(" w ", " b "),
  );
  expect(f.directory.items[0].body.solution).toEqual([]);
});
it("restores an offline new draft and persists mandatory recognition confirmation across reopening", async () => {
  localStorage.setItem(
    "qixi.authoring:scope:offline",
    JSON.stringify({
      revision: 0,
      directoryId: "d",
      body: { title: "离线题", startingFen: EMPTY_FEN, note: "", solution: [] },
      recognition: { pending: true, uncertain: [4] },
    }),
  );
  const f = fixture();
  fireEvent.click(
    await screen.findByRole("button", { name: "继续编辑：离线题" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "完成摆棋" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "请先逐格核对识别棋盘和先走方，再确认保存",
  );
  expect(
    f.request.mock.calls.filter((c) => c[1]?.method === "PUT"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "我已逐格核对并修正" }));
  fireEvent.click(screen.getByRole("button", { name: "完成摆棋" }));
  await screen.findByText("1. 离线题");
});
it("requires recipients and reuses the same immutable payload and key after a lost response", async () => {
  const f = fixture([question()]);
  f.assignment.mockRejectedValueOnce(new Error("网络断开"));
  await assignmentForm();
  expect(
    (screen.getByLabelText("一班（1人）") as HTMLInputElement).checked,
  ).toBe(false);
  await confirmAssignment();
  await screen.findByText("网络断开");
  expect(screen.queryByRole("button", { name: "返回修改" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续发布" }));
  await waitFor(() => expect(f.assigned).toHaveBeenCalledWith("assignment"));
  const calls = f.request.mock.calls.filter(
    (c) => c[0] === "/api/v1/admin/assignments",
  );
  expect(calls).toHaveLength(2);
  expect(calls[0][1]).toEqual(calls[1][1]);
});
it("lets the teacher correct a definitive rejection and uses a new key", async () => {
  const f = fixture([question()]);
  f.assignment.mockRejectedValueOnce(
    Object.assign(new Error("时间已过期"), { status: 400 }),
  );
  await assignmentForm();
  await confirmAssignment();
  await screen.findByText("时间已过期");
  fireEvent.click(screen.getByRole("button", { name: "返回修改" }));
  fireEvent.change(screen.getByLabelText("作业标题"), {
    target: { value: "重新布置" },
  });
  fireEvent.click(screen.getByRole("button", { name: "核对并发布" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布给学生" }),
  );
  await waitFor(() => expect(f.assigned).toHaveBeenCalled());
  const calls = f.request.mock.calls.filter(
    (c) => c[0] === "/api/v1/admin/assignments",
  );
  expect(calls[0][1]?.headers).not.toEqual(calls[1][1]?.headers);
});
it("blocks drafts from assignment without silently removing them", async () => {
  const q = question();
  q.status = "draft";
  q.publishedProblemId = undefined;
  fixture([q]);
  await assignmentForm();
  expect(screen.getByText(/不可布置：一步杀/)).toBeTruthy();
});
it("answer navigation preserves mainline and sibling variations for every training objective", () => {
  let tree = addAnswer([], [], "a0a1");
  tree = addAnswer(tree, ["a0a1"], "a9a8");
  const before = structuredClone(tree);
  tree = addAnswer(tree, [], "a0a2");
  expect(choicesAt(tree, []).map((n) => n.iccs)).toEqual(["a0a1", "a0a2"]);
  expect(choicesAt(tree, ["a0a1"])).toEqual(before[0].children);
  for (const kind of ["mate", "gain_material", "endgame_win", "draw"] as const)
    expect(goalFor(kind, START_FEN.replace(" w ", " b ")).solverSide).toBe("b");
});

it("preserves a conflicting offline edit and blocks an unpublished revision from assignment", async () => {
  const q = question();
  q.revision = 2;
  q.status = "revising";
  localStorage.setItem(
    "qixi.authoring:scope:q",
    JSON.stringify({ revision: 1, body: { ...q.body, title: "离线修改" } }),
  );
  fixture([q]);
  await enter();
  fireEvent.click(screen.getByRole("button", { name: /1. 一步杀/ }));
  await screen.findByText(
    "机构题目已被另一端修订。当前保留本机离线编辑，尚未覆盖机构版本。",
  );
  expect(
    JSON.parse(localStorage.getItem("qixi.authoring:scope:q")!).body.title,
  ).toBe("离线修改");
  fireEvent.click(screen.getByRole("button", { name: "‹ 返回目录" }));
  fireEvent.click(await screen.findByRole("button", { name: "布置作业" }));
  expect(
    await screen.findByText(/不可布置：一步杀（有待发布修订）/),
  ).toBeTruthy();
});

it("uses the server verdict for teacher trials without creating student attempts", async () => {
  const q=question();q.kind="source";q.canEdit=false;
  const {request}=fixture([q]);const fallback=request.getMockImplementation()!;
  request.mockImplementation(async (path,init)=>{
    if(path===B+"/import")return q.body;
    if(path===B+"/board")return {fen:START_FEN};
    if(path==="/api/v1/admin/problems/q/verify-move")return {outcome:"pending_review",message:"目标尚未确认",path:[],completed:false};
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:/1\. 一步杀/}));
  await screen.findByRole("heading",{name:"教师试做"});
  fireEvent.click(screen.getByRole("button",{name:"10行1列车"}));
  fireEvent.click(screen.getByRole("button",{name:"9行1列空位"}));
  expect(await screen.findByText("目标尚未确认（教师试做，不记录学生成绩）")).toBeTruthy();
  expect(request.mock.calls.some(([path])=>path.includes("/attempt")||path.includes("/practice/sessions"))).toBe(false);
});

it("pauses incremental answer validation and never publishes after a pause", async () => {
  const q=question();const {request}=fixture([q]);const fallback=request.getMockImplementation()!;
  let finish!:(value:unknown)=>void;
  request.mockImplementation(async (path,init)=>{
    if(path.endsWith('/validate-next'))return new Promise(resolve=>{finish=resolve;});
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:/1\. 一步杀/}));
  fireEvent.click(await screen.findByRole("button",{name:"编辑答案"}));
  fireEvent.click(screen.getByRole("button",{name:"校验题目"}));
  fireEvent.click(await screen.findByRole("button",{name:"暂停校验"}));
  finish({checked:1,total:3,complete:false});
  await screen.findByText("校验已暂停，再次校验或发布会继续未完成的部分");
  expect(request.mock.calls.filter(([path])=>path.endsWith('/validate-next'))).toHaveLength(1);
  expect(request.mock.calls.some(([path])=>path.endsWith('/actions'))).toBe(false);
  expect((screen.getByRole("button",{name:"校验题目"}) as HTMLButtonElement).disabled).toBe(false);
});
