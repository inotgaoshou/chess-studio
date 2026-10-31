import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TeacherAuthoring } from "../src/TeacherAuthoring";
import {
  AUTHORING_BASE as B,
  START_FEN,
  EMPTY_FEN,
  addAnswer,
  choicesAt,
  goalFor,
  shiftQuestions,
  type AuthoringApi,
  type AuthoringDirectory,
  type AuthoredQuestion,
} from "../src/authoringDomain";

beforeEach(() => localStorage.clear());

it("shows a load error without claiming the library is empty or repeating it on published assignments", async () => {
  const api = {
    request: vi.fn(async () => { throw new Error("Load failed"); }),
    classes: async () => [],
    students: async () => [],
  } as unknown as AuthoringApi;
  render(<TeacherAuthoring api={api} scopeKey="failure" orgName="测试机构" onBack={() => {}} onAssigned={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Load failed"));
  expect(screen.queryByText("还没有题目目录，先新建一个。")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "已发布作业" }));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  expect(screen.queryByText("暂无已发布作业")).toBeNull();
});

it("keeps platform assignment pagination available after an empty first page and filters mate steps", async () => {
  const api = {
    request: vi.fn(async (path: string) => {
      if (path === B + "/directories") return { items: [] };
      if (path === "/api/v1/admin/assignments") return [];
      if (path.startsWith("/api/v1/admin/teaching-catalog/browse?")) {
        const id = new URL(path, "https://test.invalid").searchParams.get("nodeId");
        return id
          ? { currentNode: { id, name: "基础杀法", kind: "topic" }, breadcrumbs: [{ id, name: "基础杀法", kind: "topic" }], children: [], nextCursor: null }
          : { breadcrumbs: [], children: [{ id: "basic", name: "基础杀法", kind: "topic", teachingEntry: "basic_mates", itemCount: 150 }], nextCursor: null };
      }
      if (path.startsWith("/api/v1/admin/teaching-catalog/basic/problems?")) {
        const params = new URL(path, "https://test.invalid").searchParams;
        if (params.get("mateMoves") === "2") return { items: [{ id: "mate-2", title: "两步杀题", startingFen: START_FEN, reviewStatus: "published", validationStatus: "ready" }], nextCursor: null, totalCount: 1 };
        return params.has("cursor")
          ? { items: [{ id: "later", title: "后页题目", startingFen: START_FEN, reviewStatus: "published", validationStatus: "ready" }], nextCursor: null, totalCount: 1 }
          : { items: [], nextCursor: "next", totalCount: 1 };
      }
      throw new Error(`Unexpected ${path}`);
    }),
    classes: async () => [], students: async () => [],
  } as unknown as AuthoringApi;
  render(<TeacherAuthoring api={api} scopeKey="platform-pagination" orgName="测试机构" onBack={() => {}} onAssigned={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "平台作业库" }));
  fireEvent.click(await screen.findByRole("button", { name: /基础杀法.*150 题/ }));
  fireEvent.click(await screen.findByRole("button", { name: "下一页题目" }));
  expect(await screen.findByText("后页题目")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "两步杀" }));
  expect(await screen.findByText("两步杀题")).toBeTruthy();
  expect(api.request).toHaveBeenCalledWith(expect.stringMatching(/\/basic\/problems\?.*mateMoves=2/));
});

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
      if (path.startsWith(B + "/source-libraries?")) return {items:[{id:"book",title:"测试题库",sourceScope:"平台"}],nextCursor:null};
      if (path === B + "/directories/d" && init?.method === "PATCH") {
        directory.items = body.items.map((item: {subjectId:string;kind:string}) => ({
          ...question(), id:item.subjectId, subjectId:item.subjectId, kind:item.kind,
        }));
        directory.revision++;
        return {ok:true};
      }
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
  fireEvent.click(screen.getByRole("button", { name: "下一步 · 设置并核对" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "确认发布给学生" }),
  );
}

it("keeps a personal library private and copies only after choosing an organization directory", async () => {
  const item = { ...question(), status: "draft" as const, publishedProblemId: undefined };
  const directory: AuthoringDirectory = { id:"personal", title:"我的练习", revision:0, sortOrder:0, canEdit:true, draftCount:1, items:[item] };
  const personalRequest = vi.fn(async (path:string) => {
    if (path === B + "/directories") return {items:[directory]};
    if (path === B + "/directories/personal") return directory;
    throw new Error(path);
  });
  const copy = vi.fn(async () => ({id:"copied"}));
  const organizationRequest = vi.fn(async (path:string, init?:RequestInit) => {
    if (path === B + "/directories") return {items:[{id:"target",title:"机构作业",canEdit:true}]};
    if (path === B + "/directories/target") return {id:"target",title:"机构作业",revision:3,canEdit:true,items:[]};
    if (path === B + "/personal/copy") return copy(JSON.parse(String(init?.body)));
    throw new Error(path);
  });
  const api = {request:personalRequest,classes:async()=>[],students:async()=>[]} as unknown as AuthoringApi;
  const organizationApi = {request:organizationRequest,classes:async()=>[],students:async()=>[]} as unknown as AuthoringApi;
  render(<TeacherAuthoring api={api} organizationApi={organizationApi} personal scopeKey="personal" orgName="测试机构" onBack={()=>{}} onAssigned={()=>{}}/>);
  expect(await screen.findByText("我的题库")).toBeTruthy();
  expect(screen.queryByText("布置作业")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:/我的练习.*个人题目/}));
  fireEvent.click(await screen.findByRole("button",{name:"复制到机构作业库"}));
  expect(copy).not.toHaveBeenCalled();
  expect(await screen.findByRole("dialog",{name:"复制到机构作业库"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"确认复制"}));
  await waitFor(()=>expect(copy).toHaveBeenCalledWith({sourceId:"q",kind:"authored",targetId:"target",expectedRevision:3}));
});

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
  fireEvent.click(screen.getByRole("button", {name:"继续录题"}));
  fireEvent.click(await screen.findByRole("button", {name:"手动摆棋"}));
  fireEvent.click(await screen.findByRole("button", {name:"完成摆棋"}));
  await screen.findByText("2. 训练题");
  expect(f.directory.items).toHaveLength(2);
  expect(f.directory.items[0].body.startingFen).toBe(EMPTY_FEN.replace(" w ", " b "));
  expect(f.directory.items[1].body.solution).toEqual([]);
});

it("keeps generals on the board and removes both general palette options", async () => {
  const f=fixture();await newPosition();
  expect(screen.queryByRole("button",{name:"选择黑将",exact:true})).toBeNull();
  expect(screen.queryByRole("button",{name:"选择红帅",exact:true})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"清空",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"删除",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"1行5列将",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"10行5列帅",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列将",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"10行5列帅",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"选择红车",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"1行5列将",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列将",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"完成摆棋",exact:true}));
  await screen.findByText("1. 训练题");
  expect(f.directory.items[0].body.startingFen).toBe(EMPTY_FEN);
});

it("moves generals only within their own palace, protects them from moved pieces, and supports undo after flipping",async()=>{
  fixture();await newPosition();fireEvent.click(screen.getByRole("button",{name:"清空",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"选择红车",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"2行1列空位",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"移动",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"2行1列车",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"1行5列将",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列将",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"2行1列车",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"移动",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"1行5列将",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"4行5列空位",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列将",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"2行5列空位",exact:true}));
  expect(screen.getByRole("button",{name:"2行5列将",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"翻转",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"10行5列帅",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"7行5列空位",exact:true}));
  expect(screen.getByRole("button",{name:"10行5列帅",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"8行6列空位",exact:true}));
  expect(screen.getByRole("button",{name:"8行6列帅",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"撤销",exact:true}));
  expect(screen.getByRole("button",{name:"10行5列帅",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"2行5列将",exact:true})).toBeTruthy();
});

it("repairs a missing general without overwriting imported pieces or changing the side to move",async()=>{
  localStorage.setItem("qixi.authoring:scope:offline",JSON.stringify({revision:0,directoryId:"d",body:{title:"缺将草稿",startingFen:"4r4/9/9/9/9/9/9/9/9/R3K4 b - - 0 1",note:"",solution:[]}}));
  const f=fixture();fireEvent.click(await screen.findByRole("button",{name:"继续编辑：缺将草稿"}));
  fireEvent.click(await screen.findByRole("button",{name:"完成摆棋",exact:true}));
  await screen.findByText("将帅须保留在棋盘上，请先补齐将帅");
  expect(f.request.mock.calls.some(([,init])=>init?.method==="PUT")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"补齐将帅",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列车",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"1行4列将",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"10行1列车",exact:true})).toBeTruthy();
  expect(screen.getByRole("button",{name:"黑先",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"完成摆棋",exact:true}));
  await screen.findByText("1. 缺将草稿");
  expect(f.directory.items[0].body.startingFen).toBe("3kr4/9/9/9/9/9/9/9/9/R3K4 b - - 0 1");
});

it("allows correcting an extra recognized general but protects the final one",async()=>{
  localStorage.setItem("qixi.authoring:scope:offline",JSON.stringify({revision:0,directoryId:"d",body:{title:"重复将草稿",startingFen:"3kk4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",note:"",solution:[]}}));
  fixture();fireEvent.click(await screen.findByRole("button",{name:"继续编辑：重复将草稿"}));
  fireEvent.click(await screen.findByRole("button",{name:"删除",exact:true}));
  fireEvent.click(screen.getByRole("button",{name:"1行4列将",exact:true}));
  expect(screen.getByRole("button",{name:"1行4列空位",exact:true})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"1行5列将",exact:true}));
  expect(screen.getByRole("button",{name:"1行5列将",exact:true})).toBeTruthy();
});

it("opens the directory assignment sheet directly without repeating organization or question selection", async () => {
  fixture([question()]);
  fireEvent.click(await screen.findByRole("button", {name:"布置杀棋训练"}));
  await screen.findByLabelText("一班（1人）");
  expect(screen.queryByLabelText("作业标题")).toBeNull();
  fireEvent.click(screen.getByLabelText("一班（1人）"));
  fireEvent.click(screen.getByRole("button", {name:"下一步 · 设置并核对"}));
  expect(screen.getByLabelText("作业标题")).toHaveProperty("value", "杀棋训练");
  expect(screen.getByText(/1 名学生/)).toBeTruthy();
});

it("blocks an empty directory before opening assignment", async () => {
  const f = fixture();
  fireEvent.click(await screen.findByRole("button", {name:"布置杀棋训练"}));
  await screen.findByText("目录里还没有题目，请先添加题目");
  expect(screen.queryByLabelText("作业标题")).toBeNull();
  expect(f.assignment).not.toHaveBeenCalled();
});

it("moves directories to explicit ends even when sort orders are tied", async () => {
  const dirs = ["a", "b", "c"].map(id => ({id,title:id,revision:1,sortOrder:0,canEdit:true,items:[]}));
  const request = vi.fn(async (path:string, init?:RequestInit):Promise<any> => {
    if (path === B + "/directories") return {items:[...dirs].sort((a,b)=>a.sortOrder-b.sortOrder || a.id.localeCompare(b.id))};
    const target = dirs.find(d=>path===B+"/directories/"+d.id)!;
    const body=JSON.parse(String(init?.body));
    expect(body.expectedRevision).toBe(target.revision);
    Object.assign(target,{sortOrder:body.sortOrder,revision:target.revision+1});
    return target;
  });
  render(<TeacherAuthoring api={{request,classes:async()=>[],students:async()=>[]}} scopeKey="order" orgName="机构" onBack={()=>{}} onAssigned={()=>{}}/>);
  fireEvent.click(await screen.findByRole("button",{name:"调整目录"}));
  fireEvent.click(screen.getByRole("button",{name:"a置底"}));
  await waitFor(()=>expect(dirs[0].sortOrder).toBe(1));
  await waitFor(()=>expect((screen.getByRole("button",{name:"a置底"}) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(screen.getByRole("button",{name:"c置顶"}));
  await waitFor(()=>expect(dirs[2].sortOrder).toBe(-1));
  await waitFor(()=>expect((screen.getByRole("button",{name:"c置顶"}) as HTMLButtonElement).disabled).toBe(true));
  expect(dirs).toHaveLength(3);
});

it("renames through an explicit form and keeps a selection after moving its ordered block", async () => {
  const questions = ["a","b","c","d"].map(id => ({...question(),id,body:{...question().body,title:id}}));
  const f = fixture(questions), fallback=f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path,init) => {
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    if(path===B+"/directories/d" && init?.method==="PATCH") {
      const byId=new Map(f.directory.items.map(q=>[q.id,q]));
      f.directory.items=body.items.map((item:{subjectId:string})=>byId.get(item.subjectId)!);
      f.directory.revision++;
      return f.directory;
    }
    if(path===B+"/questions/c" && init?.method==="PUT") {
      const index=f.directory.items.findIndex(q=>q.id==="c");
      f.directory.items[index]={...f.directory.items[index],body:body.body,revision:2,status:"revising"};
      return f.directory.items[index];
    }
    return fallback(path,init);
  });
  await enter();
  fireEvent.click(screen.getByRole("button",{name:"选择／编辑"}));
  fireEvent.click(screen.getByRole("checkbox",{name:"选择b"}));
  fireEvent.click(screen.getByRole("checkbox",{name:"选择c"}));
  fireEvent.click(screen.getByRole("button",{name:"前移",exact:true}));
  await waitFor(()=>expect(f.directory.items.map(q=>q.id)).toEqual(["b","c","a","d"]));
  await waitFor(()=>expect((screen.getByRole("checkbox",{name:"选择c"}) as HTMLInputElement).checked).toBe(true));
  fireEvent.click(screen.getByRole("checkbox",{name:"选择b"}));
  fireEvent.click(screen.getByRole("button",{name:"改名",exact:true}));
  fireEvent.change(await screen.findByLabelText("题目新名称"),{target:{value:"新的题名"}});
  fireEvent.click(screen.getByRole("button",{name:"保存名称"}));
  await screen.findByText("2. 新的题名");
  const saved=f.request.mock.calls.find(([path,init])=>path===B+"/questions/c"&&init?.method==="PUT");
  expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({expectedRevision:1,body:{title:"新的题名"}});
});

it("moves selected questions stably and preserves every unselected and selected question", () => {
  const items=["a","b","c","d","e"].map(id=>({id}));
  expect(shiftQuestions(items,["b","c"],-1).map(q=>q.id)).toEqual(["b","c","a","d","e"]);
  expect(shiftQuestions(items,["b","c"],1).map(q=>q.id)).toEqual(["a","d","b","c","e"]);
  expect(shiftQuestions(items,["a","c","e"],-1).map(q=>q.id)).toEqual(["a","c","b","e","d"]);
  expect(shiftQuestions(items,items.map(q=>q.id),1)).toEqual(items);
  expect(items.map(q=>q.id)).toEqual(["a","b","c","d","e"]);
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

it("shows Chinese answer moves at each position and sends only ICCS data for navigation",async()=>{
  const q=question();q.body.solution=[{iccs:"h2e2",comment:"",children:[{iccs:"b9c7",comment:"",children:[]}]},{iccs:"b0c2",comment:"",children:[]}];
  const f=fixture([q]),fallback=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(path,init)=>{
    if(path===B+"/board"){
      const moves=JSON.parse(String(init?.body)).moves;
      return {fen:START_FEN,moveNotations:moves.length ? {b9c7:"马2进3"} : {h2e2:"炮二平五",b0c2:"马八进七"}};
    }
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:/1. 一步杀/}));
  fireEvent.click(await screen.findByRole("button",{name:"炮二平五",exact:true}));
  await screen.findByRole("button",{name:"马2进3",exact:true});
  expect(f.request.mock.calls.some(([path,init])=>path===B+"/board"&&JSON.parse(String(init?.body)).moves.join(" ")==="h2e2")).toBe(true);
  expect(screen.queryByRole("button",{name:/h2e2|b9c7|b0c2/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"起点",exact:true}));
  await screen.findByRole("button",{name:"炮二平五",exact:true});
  expect(screen.getByRole("button",{name:"马八进七",exact:true})).toBeTruthy();
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

async function openSourcePicker() {
  await enter();
  fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));
  fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  await screen.findByRole("dialog",{name:"选择题库／书本"});
  fireEvent.click(await screen.findByRole("button",{name:/测试题库.*进入选题/}));
  return screen.findByRole("dialog",{name:"选择平台／机构题目"});
}
function openRecordFilters() {
  fireEvent.click(screen.getByRole("button",{name:"筛选",exact:true}));
}
it("filters paged sources, merges duplicate identities, blocks existing items, and returns without changing the directory", async () => {
  const f=fixture([question()]), fallback=f.request.getMockImplementation()!;
  const base={fen:START_FEN,sourceScope:"平台",sourceTitle:"测试题库"};
  f.request.mockImplementation(async (path,init)=>{
    if(!path.startsWith(B+"/sources?"))return fallback(path,init);
    const params=new URL(path,"https://test.invalid").searchParams;
    expect(params.get("directoryId")).toBe("d");
    expect(params.get("libraryId")).toBe("book");
    expect(params.get("limit")).toBe("50");
    if(params.get("category")==="中局")return {items:[{...base,id:"different",title:"同局面不同答案",duplicateKey:"other"}],totalCount:1,categories:["杀棋","中局","未分类"],nextCursor:null};
    return {items:params.has("cursor") ? [{...base,id:"duplicate",title:"重复来源",duplicateKey:"same"},{...base,id:"next",title:"后页题目",duplicateKey:"next"}] : [{...base,id:"source",title:"原题",duplicateKey:"same"},{...base,id:"q",title:"已在目录",authored:true,alreadyAdded:true},...Array.from({length:48},(_,i)=>({...base,id:`filler-${i}`,title:`题目 ${i}`,duplicateKey:`filler-${i}`}))],totalCount:51,categories:["杀棋","中局","未分类"],nextCursor:params.has("cursor") ? null : "page2"};
  });
  await openSourcePicker();
  await screen.findByText("原题");
  expect(screen.getByText(/共 51 题 · 每页 50 题/).textContent).toContain("第 1 / 2 页");
  expect(screen.queryByLabelText("题型分类")).toBeNull();
  expect(screen.getAllByRole("img",{name:"题目棋盘"})[0].parentElement?.classList.contains("authoring-source-board")).toBe(true);
  expect((screen.getByText("已在目录").closest("button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByRole("img",{name:"题目棋盘"})).toHaveLength(50);
  fireEvent.click(screen.getByText("原题").closest("button")!);
  fireEvent.click(screen.getByRole("button",{name:"下一页",exact:true}));
  await screen.findByText("后页题目");
  expect(screen.getByText(/共 51 题 · 每页 50 题/).textContent).toContain("第 2 / 2 页");
  expect(screen.queryByText("重复来源")).toBeNull();
  expect(screen.queryByText("原题")).toBeNull();
  expect(screen.getAllByRole("img",{name:"题目棋盘"})).toHaveLength(1);
  expect((screen.getByRole("button",{name:"下一页",exact:true}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"上一页",exact:true}));
  expect(screen.getByText("原题").closest("button")?.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getAllByRole("img",{name:"题目棋盘"})).toHaveLength(50);
  openRecordFilters();
  fireEvent.change(screen.getByLabelText("题型分类"),{target:{value:"中局"}});
  await screen.findByText("同局面不同答案");
  expect(screen.getByText(/共 1 题 · 每页 50 题/).textContent).toContain("第 1 / 1 页");
  expect((screen.getByRole("button",{name:"上一页",exact:true}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("原题")).toBeNull();
  fireEvent.click(within(screen.getByRole("dialog",{name:"选择平台／机构题目"})).getByRole("button",{name:"‹ 返回",exact:true}));
  await screen.findByRole("dialog",{name:"选择题库／书本"});
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"‹ 返回",exact:true}));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(f.directory.items.map(q=>q.id)).toEqual(["q"]);
  expect(f.request.mock.calls.some(([,init])=>init?.method==="PATCH")).toBe(false);
});
it("selects every filtered page and adds once only after confirmation", async () => {
  const f=fixture(), fallback=f.request.getMockImplementation()!;
  const firstPage=Array.from({length:50},(_,i)=>({id:`first-${i}`,title:`第一批题目 ${i}`,fen:START_FEN}));
  f.request.mockImplementation(async(path,init)=>{
    if(!path.startsWith(B+"/sources?"))return fallback(path,init);
    const more=new URL(path,"https://test.invalid").searchParams.has("cursor");
    return {items:more?[{id:"second",title:"第二页题目",fen:START_FEN}]:firstPage,nextCursor:more?null:"page2",categories:[]};
  });
  await openSourcePicker();
  await screen.findByText("第一批题目 0");
  fireEvent.click(screen.getByRole("button",{name:"全选",exact:true}));
  await screen.findByRole("button",{name:"确认添加（51）"});
  expect(screen.getAllByRole("img",{name:"题目棋盘"})).toHaveLength(50);
  expect(screen.queryByText("第二页题目")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"下一页",exact:true}));
  await screen.findByText("第二页题目");
  expect(screen.getAllByRole("img",{name:"题目棋盘"})).toHaveLength(1);
  expect(f.request.mock.calls.filter(([,init])=>init?.method==="PATCH")).toHaveLength(0);
  expect(f.assignment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"确认添加（51）"}));
  await waitFor(()=>expect(f.directory.items.map(item=>item.id)).toEqual([...firstPage.map(item=>item.id),"second"]));
  expect(f.request.mock.calls.filter(([,init])=>init?.method==="PATCH")).toHaveLength(1);
  expect(f.assignment).not.toHaveBeenCalled();
});
it("offers a filter reset when a book has no matching mate-step problems", async () => {
  const f=fixture(), fallback=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(path,init)=>{
    if(!path.startsWith(B+"/sources?"))return fallback(path,init);
    const filtered=new URL(path,"https://test.invalid").searchParams.has("mateMoves");
    return {mateFilterVersion:1,items:filtered?[]:[{id:"available",title:"本书题目",fen:START_FEN}],categories:[],nextCursor:null};
  });
  await openSourcePicker();
  await screen.findByText("本书题目");
  openRecordFilters();
  fireEvent.click(within(screen.getByRole("group",{name:"杀法步数"})).getByRole("button",{name:"两步杀"}));
  await screen.findByText("没有匹配内容");
  fireEvent.click(screen.getByRole("button",{name:"清除筛选"}));
  await screen.findByText("本书题目");
});
it("ignores a source result after the search changes", async () => {
  const f=fixture(),fallback=f.request.getMockImplementation()!;
  let resolveOld!:(value:unknown)=>void;
  f.request.mockImplementation(async(path,init)=>{
    if(!path.startsWith(B+"/sources?"))return fallback(path,init);
    const q=new URL(path,"https://test.invalid").searchParams.get("q");
    if(!q)return new Promise(resolve=>{resolveOld=resolve;});
    return {items:[{id:"new",title:"新结果",fen:START_FEN}],categories:[],totalCount:99};
  });
  await openSourcePicker();
  await waitFor(()=>expect(resolveOld).toBeTypeOf("function"));
  openRecordFilters();
  fireEvent.change(screen.getByLabelText("搜索题目或棋谱"),{target:{value:"新"}});
  await screen.findByText("新结果");
  resolveOld({items:[{id:"old",title:"旧结果",fen:START_FEN}],categories:[],totalCount:999});
  await waitFor(()=>expect(screen.queryByText("旧结果")).toBeNull());
  expect(screen.getByText(/共 99 题 · 每页 50 题/)).toBeTruthy();
  expect(screen.queryByText(/共 999 题/)).toBeNull();
});

it("waits for cold source preparation and cancels polling when returning",async()=>{
  const f=fixture(),fallback=f.request.getMockImplementation()!;
  let count=0;
  f.request.mockImplementation(async(path,init)=>{
    if(!path.startsWith(B+"/sources?"))return fallback(path,init);
    count++;
    if(count===1)throw new Error("题库正在准备，请稍候");
    return {items:[{id:"ready",title:"准备完成",fen:START_FEN}],categories:["杀棋"]};
  });
  await openSourcePicker();
  await screen.findByText("正在准备题库，请稍候…");
  expect(screen.queryByRole("alert")).toBeNull();
  await screen.findByText("准备完成",{}, {timeout:4000});
  openRecordFilters();
  fireEvent.change(screen.getByLabelText("搜索题目或棋谱"),{target:{value:"取消"}});
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"‹ 返回",exact:true}));
  const before=count;
  await new Promise(resolve=>setTimeout(resolve,300));
  expect(count).toBe(before);
});

it("opens books first and never loads all-platform records before choosing a book",async()=>{
  const f=fixture();
  await enter();
  fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));
  fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  await screen.findByRole("button",{name:/测试题库.*进入选题/});
  expect(f.request.mock.calls.some(([path])=>path.startsWith(B+"/sources?"))).toBe(false);
  expect(screen.queryByLabelText("题型分类")).toBeNull();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"‹ 返回",exact:true}));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("filters all book pages by mate steps and carries the filter into the selected book",async()=>{
  const f=fixture(),fallback=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(path,init)=>{
    const params=new URL(path,"https://test.invalid").searchParams;
    if(path.startsWith(B+"/source-libraries?"))return {mateFilterVersion:1,items:[{id:"book",title:params.get("mateMoves")==="2"?"两步杀书本":"测试题库",sourceScope:"平台"}],nextCursor:params.has("cursor")?null:"more"};
    if(path.startsWith(B+"/sources?"))return {mateFilterVersion:1,items:[{id:"matched",title:"匹配的两步杀",fen:START_FEN}],categories:[],nextCursor:null};
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  await screen.findByRole("button",{name:/测试题库.*进入选题/});
  fireEvent.click(within(screen.getByRole("group",{name:"杀法步数"})).getByRole("button",{name:"两步杀"}));
  fireEvent.click(await screen.findByRole("button",{name:/两步杀书本.*进入选题/}));
  await screen.findByText("匹配的两步杀");
  openRecordFilters();
  expect(within(screen.getByRole("group",{name:"杀法步数"})).getByRole("button",{name:"两步杀"}).getAttribute("aria-pressed")).toBe("true");
  const calls=f.request.mock.calls.map(([path])=>new URL(path,"https://test.invalid"));
  expect(calls.some(url=>url.pathname.endsWith("/sources")&&url.searchParams.get("mateMoves")==="2")).toBe(true);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"‹ 返回",exact:true}));
  fireEvent.click(await screen.findByRole("button",{name:"下一页题库"}));
  await waitFor(()=>expect(f.request.mock.calls.some(([path])=>path.includes("mateMoves=2")&&path.includes("cursor=more"))).toBe(true));
  expect(f.request.mock.calls.some(([,init])=>init?.method==="POST"||init?.method==="PATCH")).toBe(false);
});

it("does not silently show unfiltered books on an older server",async()=>{
  fixture();await enter();fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  await screen.findByRole("button",{name:/测试题库.*进入选题/});
  fireEvent.click(within(screen.getByRole("group",{name:"杀法步数"})).getByRole("button",{name:"四步及以上"}));
  await screen.findByText(/服务器尚未支持杀法步数筛选/);
  expect(screen.queryByRole("button",{name:/测试题库.*进入选题/})).toBeNull();
});

it("replaces the single selected step, carries it into books and clears it with all",async()=>{
  const f=fixture(),fallback=f.request.getMockImplementation()!;
  f.request.mockImplementation(async(path,init)=>{
    const params=new URL(path,"https://test.invalid").searchParams;
    const step=params.get("mateMoves")??"all";
    if(path.startsWith(B+"/source-libraries?"))return {mateFilterVersion:1,items:[{id:"book",title:"步数 "+step,sourceScope:"平台"}],nextCursor:null};
    if(path.startsWith(B+"/sources?"))return {mateFilterVersion:1,items:[{id:"matched",title:"题目 "+step,fen:START_FEN}],categories:[],nextCursor:null};
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  await screen.findByRole("button",{name:/步数 all.*进入选题/});
  const tab=(name:string)=>within(screen.getByRole("group",{name:"杀法步数"})).getByRole("button",{name,exact:true});
  fireEvent.click(tab("两步杀"));fireEvent.click(tab("一步杀"));
  fireEvent.click(await screen.findByRole("button",{name:/步数 1.*进入选题/}));
  await screen.findByText("题目 1");
  openRecordFilters();
  expect(tab("一步杀").getAttribute("aria-pressed")).toBe("true");expect(tab("两步杀").getAttribute("aria-pressed")).toBe("false");
  const bookRequests=f.request.mock.calls.filter(([path])=>path.startsWith(B+"/source-libraries?")).length;
  fireEvent.click(tab("三步杀"));await screen.findByText("题目 3");
  expect(f.request.mock.calls.filter(([path])=>path.startsWith(B+"/source-libraries?")).length).toBe(bookRequests);
  expect(tab("一步杀").getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(tab("三步杀"));expect(tab("三步杀").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"‹ 返回",exact:true}));
  await screen.findByRole("button",{name:/步数 3.*进入选题/});
  fireEvent.click(tab("全部"));await screen.findByRole("button",{name:/步数 all.*进入选题/});
  expect(tab("全部").getAttribute("aria-pressed")).toBe("true");expect(tab("三步杀").getAttribute("aria-pressed")).toBe("false");
  expect(f.request.mock.calls.some(([path])=>path.includes("mateSteps"))).toBe(false);
});

it("retains disabled previous rows while replacing filters and ignores late responses",async()=>{
  const f=fixture(),fallback=f.request.getMockImplementation()!;
  let resolveOld!:(value:unknown)=>void, rejectNew!:(reason:Error)=>void;
  f.request.mockImplementation(async(path,init)=>{
    if(path.startsWith(B+"/source-libraries?")){
      const step=new URL(path,"https://test.invalid").searchParams.get("mateMoves");
      if(step==="1")return new Promise(resolve=>{resolveOld=resolve;});
      if(step==="2")return new Promise((_,reject)=>{rejectNew=reject;});
    }
    return fallback(path,init);
  });
  await enter();fireEvent.click(screen.getByRole("button",{name:"＋添加题目"}));fireEvent.click(screen.getByRole("button",{name:"从平台／机构题库选题"}));
  const book=await screen.findByRole("button",{name:/测试题库.*进入选题/});
  const tabs=within(screen.getByRole("group",{name:"杀法步数"}));
  fireEvent.click(tabs.getByRole("button",{name:"一步杀"}));
  await waitFor(()=>expect(resolveOld).toBeTypeOf("function"));expect(book.hasAttribute("disabled")).toBe(true);
  fireEvent.click(tabs.getByRole("button",{name:"两步杀"}));
  await waitFor(()=>expect(rejectNew).toBeTypeOf("function"));
  resolveOld({mateFilterVersion:1,items:[{id:"old",title:"过期结果",sourceScope:"平台"}]});
  rejectNew(new Error("筛选读取失败"));
  await screen.findByText("筛选读取失败");
  expect(screen.queryByText("过期结果")).toBeNull();expect(screen.queryByRole("button",{name:/测试题库.*进入选题/})).toBeNull();
  fireEvent.click(tabs.getByRole("button",{name:"全部"}));
  expect((await screen.findByRole("button",{name:/测试题库.*进入选题/})).hasAttribute("disabled")).toBe(false);
});
