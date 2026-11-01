import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { clearCatalogBrowseCache } from "../src/useCatalogBrowse";
import { LearningRouteSheet } from "../src/LearningRoutes";
import { TeachingCatalog, type TeachingCatalogNode } from "../src/TeachingCatalog";
import { teachingClient, type TeachingAuth } from "../src/teaching";

const node=(entry:string,count:number|null=20):TeachingCatalogNode=>({id:`route-${entry}`,name:entry,teachingEntry:entry,kind:"category",active:true,confirmed:true,displayOrder:0,itemCount:count});
const topics=[node("basic_mates"),node("checking_mates"),node("quiet_mates"),node("practical_endgames"),node("practical_mates"),node("endgame_mates")];
const page=(children:TeachingCatalogNode[])=>({currentNode:null,breadcrumbs:[],children,learningMaterials:[],statisticsReady:true});
const props={initialRoute:"mate" as const,restricted:false,scope:"routes",onSelect:vi.fn(),onClose:vi.fn()};
beforeEach(()=>{clearCatalogBrowseCache();window.dispatchEvent(new Event("teaching-content-reset"));vi.clearAllMocks();});

it("uses authorized topic identity rather than title matching and does not auto-start practice",async()=>{
  const request=vi.fn().mockResolvedValue(page([node("basic_mates"),{...node("unknown"),name:"实用残局"}]));
  render(<LearningRouteSheet {...props} request={request}/>);
  const action=await screen.findByRole("button",{name:"练一步杀"});
  await waitFor(()=>expect(action.disabled).toBe(false));
  expect(props.onSelect).not.toHaveBeenCalled();
  fireEvent.click(action);
  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining(node("basic_mates")),expect.objectContaining({step:"1"}),expect.objectContaining({route:"mate",stage:"one"}),expect.any(AbortSignal));
  fireEvent.click(screen.getByRole("tab",{name:"残局学习路线"}));
  expect(screen.getByRole("button",{name:"含车残局"}).disabled).toBe(true);
});
it("keeps generic methods readable while blocking private, inactive, unconfirmed and empty topics",async()=>{
  render(<LearningRouteSheet {...props} restricted request={vi.fn().mockResolvedValue(page([node("basic_mates",0),node("practical_endgames"),{...node("checking_mates"),active:false},{...node("quiet_mates"),confirmed:false}]))}/>);
  await screen.findAllByText("暂无可练题目");
  for(const name of ["练一步杀","练连将杀","练非连将杀"])expect(screen.getByRole("button",{name}).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab",{name:"残局学习路线"}));
  expect(screen.getByText(/先读题目目标/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"练残局胜法"}).disabled).toBe(true);
  expect(screen.getAllByText("当前账号暂无此专题权限").length).toBeGreaterThan(0);
});
it("supports failed root reads and root pagination without guessing missing topics",async()=>{
  const request=vi.fn().mockRejectedValueOnce(new Error("离线")).mockImplementation(async params=>params.cursor?page([node("practical_endgames")]):({...page([node("basic_mates")]),nextCursor:"next"}));
  render(<LearningRouteSheet {...props} initialRoute="endgame" request={request}/>);
  fireEvent.click(await screen.findByRole("button",{name:"重试题库"}));
  fireEvent.click(await screen.findByRole("button",{name:"载入更多学习目录"}));
  const action=screen.getByRole("button",{name:"练求和防守"});
  await waitFor(()=>expect(action.disabled).toBe(false));
  fireEvent.click(action);
  expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining(node("practical_endgames")),expect.objectContaining({goal:"draw"}),expect.anything(),expect.any(AbortSignal));
});
it("opening the route is read-only and Escape requests closure",async()=>{
  const request=vi.fn().mockResolvedValue(page(topics));
  const close=vi.fn();render(<LearningRouteSheet {...props} request={request} onClose={close}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"练一步杀"}).disabled).toBe(false));
  fireEvent.keyDown(document,{key:"Escape"});expect(close).toHaveBeenCalledOnce();expect(props.onSelect).not.toHaveBeenCalled();
});

function catalogFixture(id:string) {
  const auth={token:id,expiresAt:"2099-01-01",user:{id,role:"student",vipActive:true}} as TeachingAuth;
  vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>{
    const current=topics.find(n=>n.id===params.nodeId);
    return {...page(current?[]:topics),currentNode:current??null,breadcrumbs:current?[current]:[],mateStepCounts:current?.teachingEntry==="basic_mates"?[{mateMoves:1,itemCount:5},{mateMoves:3,itemCount:5}]:undefined};
  });
  const problems=vi.spyOn(teachingClient,"catalogProblems").mockImplementation(async(_id,query)=>({items:[{id:"route-question",libraryId:"book",sourceIndex:0,title:"局面训练",category:"练习",startingFen:"rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w",sideToMove:"red",solutionLength:1,verifiedMateMoves:query?.mateMoves,trainingGoal:query?.goal?{kind:query.goal,solverSide:"w",reviewMethod:"reviewed_solution"}:null}],nextCursor:null}));
  const onPractice=vi.fn();
  return {problems,props:{auth,compact:true,scene:"browse" as const,onPractice},onPractice};
}
it("opens three-step practice with the real filter, keeps stage context on return and does not auto-answer",async()=>{
  const f=catalogFixture("route-mate"),ui=render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^杀法学习路线/}));
  const action=await screen.findByRole("button",{name:"练三步杀"});
  await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await waitFor(()=>expect(f.problems.mock.calls.at(-1)?.slice(0,2)).toMatchObject(["route-basic_mates",{mateMoves:3}]));
  expect(f.onPractice).not.toHaveBeenCalled();
  await waitFor(()=>expect(screen.queryByRole("dialog",{name:"学习路线"})).toBeNull());
  expect(within(screen.getByRole("complementary",{name:"当前学习阶段"})).getByText("三四步 · 连贯计算")).toBeTruthy();
  ui.unmount();render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(await screen.findByRole("button",{name:"查看学习路线"}));
  expect((await within(screen.getByRole("dialog",{name:"学习路线"})).findByText("三四步 · 连贯计算")).closest("li")?.getAttribute("aria-current")).toBe("step");
});
it("switching learning routes clears old filters and applies endgame goal or material",async()=>{
  const f=catalogFixture("route-endgame");render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  let action=await screen.findByRole("button",{name:"练求和防守"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await waitFor(()=>expect(f.problems.mock.calls.at(-1)?.slice(0,2)).toMatchObject(["route-practical_endgames",{goal:"draw",material:""}]));
  fireEvent.click(screen.getByRole("button",{name:"查看学习路线"}));
  action=await screen.findByRole("button",{name:"含马残局"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await waitFor(()=>expect(f.problems.mock.calls.at(-1)?.slice(0,2)).toMatchObject(["route-practical_endgames",{goal:"",material:"n"}]));
  fireEvent.click(screen.getByRole("button",{name:"查看学习路线"}));fireEvent.click(screen.getByRole("tab",{name:"杀法学习路线"}));
  action=await screen.findByRole("button",{name:"练两步杀"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await waitFor(()=>expect(f.problems.mock.calls.at(-1)?.slice(0,2)).toMatchObject(["route-basic_mates",{goal:"",material:"",mateMoves:2}]));
});
it("keeps assignment selection unchanged and removes a private route on account change",async()=>{
  const f=catalogFixture("route-role");const ui=render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));await screen.findByRole("dialog",{name:"学习路线"});
  ui.rerender(<TeachingCatalog {...f.props} auth={{...f.props.auth,user:{...f.props.auth.user,vipActive:false}}}/>);
  expect(screen.queryByRole("dialog",{name:"学习路线"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  await screen.findAllByText("当前账号暂无此专题权限");
  expect(screen.getByRole("button",{name:"练残局胜法"}).disabled).toBe(true);
  ui.rerender(<TeachingCatalog {...f.props} teacher scene="select"/>);
  expect(screen.queryByRole("navigation",{name:"推荐学习路线"})).toBeNull();
});

it("stays on the route when the exact goal has no questions, rather than opening an empty broad topic",async()=>{
  const f=catalogFixture("route-empty-goal");f.problems.mockResolvedValue({items:[],nextCursor:null});
  render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"练求和防守"});
  await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await waitFor(()=>expect(f.problems).toHaveBeenCalled());
  expect(screen.getByRole("dialog",{name:"学习路线"})).toBeTruthy();
  expect(await screen.findByText(/该范围暂无可练题目/)).toBeTruthy();
  expect(screen.queryByRole("complementary",{name:"当前学习阶段"})).toBeNull();
});
it("names the exact selected action and filters in the destination, not only its shared phase",async()=>{
  const f=catalogFixture("route-exact-range");render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"练求和防守"});
  await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await screen.findByRole("complementary",{name:"当前学习阶段"});
  const context=screen.getByRole("complementary",{name:"当前学习阶段"});
  expect(within(context).getByText("实用残局 › 求和防守")).toBeTruthy();
});
it("hides learning route entries and their sheet when signed out",async()=>{
  const f=catalogFixture("route-signout"),ui=render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  await screen.findByRole("dialog",{name:"学习路线"});
  ui.rerender(<TeachingCatalog {...f.props} auth={undefined}/>);
  expect(screen.queryByRole("dialog",{name:"学习路线"})).toBeNull();
  expect(screen.queryByRole("navigation",{name:"推荐学习路线"})).toBeNull();
});
it("rejects unrelated goals from a server ignoring filters and supports retry without changing the route",async()=>{
  const f=catalogFixture("route-ignored-goal");
  f.problems.mockResolvedValueOnce({items:[{id:"wrong-win",startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",trainingGoal:{kind:"endgame_win"}}],nextCursor:null});
  render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  let action=await screen.findByRole("button",{name:"练求和防守"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  expect(await screen.findByText(/返回题目与所选范围不一致/)).toBeTruthy();
  expect(screen.queryByRole("complementary",{name:"当前学习阶段"})).toBeNull();
  action=screen.getByRole("button",{name:"练求和防守"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  const context=await screen.findByRole("complementary",{name:"当前学习阶段"});
  expect(within(context).getByText("实用残局 › 求和防守")).toBeTruthy();
  expect(f.problems).toHaveBeenCalledTimes(2); // verified page is reused after navigation
});
it("blocks duplicate taps and discards a late range check after switching route tabs",async()=>{
  const f=catalogFixture("route-cancel");let resolve!:(value:unknown)=>void;
  f.problems.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"练求和防守"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);fireEvent.click(action);
  expect(f.problems).toHaveBeenCalledTimes(1);
  const signal=f.problems.mock.calls[0][4] as AbortSignal;
  fireEvent.click(screen.getByRole("tab",{name:"杀法学习路线"}));expect(signal.aborted).toBe(true);
  resolve({items:[{id:"late",startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",trainingGoal:{kind:"draw"}}]});
  await waitFor(()=>expect(screen.getByRole("button",{name:"练一步杀"}).disabled).toBe(false));
  expect(screen.getByRole("dialog",{name:"学习路线"})).toBeTruthy();
  expect(screen.queryByRole("complementary",{name:"当前学习阶段"})).toBeNull();
});
it("stops a pending check on logout and never resurrects its private destination",async()=>{
  const f=catalogFixture("route-logout-pending");let resolve!:(value:unknown)=>void;
  f.problems.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const ui=render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"含兵卒残局"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  const signal=f.problems.mock.calls[0][4] as AbortSignal;
  ui.rerender(<TeachingCatalog {...f.props} auth={undefined}/>);expect(signal.aborted).toBe(true);
  resolve({items:[{id:"late",startingFen:"4k4/9/9/9/9/9/9/9/P8/4K4 w"}]});
  await waitFor(()=>expect(screen.queryByRole("navigation",{name:"推荐学习路线"})).toBeNull());
  expect(screen.queryByRole("complementary",{name:"当前学习阶段"})).toBeNull();
});
it("does not mark the old learning range as active after changing the actual catalog filters",async()=>{
  const f=catalogFixture("route-manual-filters");render(<TeachingCatalog {...f.props}/>);
  fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"练求和防守"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  await screen.findByRole("complementary",{name:"当前学习阶段"});
  fireEvent.click(screen.getByRole("button",{name:/^筛选/}));
  fireEvent.change(screen.getByRole("combobox",{name:"题目目标"}),{target:{value:"endgame_win"}});
  expect(screen.getByText("筛选已调整，当前不属于所选阶段")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"查看学习路线"}));
  expect(screen.getByRole("button",{name:"练求和防守"}).getAttribute("aria-pressed")).toBe("false");
});
it("validates the actual piece placement for material stages rather than trusting titles",async()=>{
  const f=catalogFixture("route-piece-identity");
  f.problems.mockResolvedValue({items:[{id:"no-horse",title:"含马残局",startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w"}],nextCursor:null});
  render(<TeachingCatalog {...f.props}/>);fireEvent.click(screen.getByRole("button",{name:/^残局学习路线/}));
  const action=await screen.findByRole("button",{name:"含马残局"});await waitFor(()=>expect(action.disabled).toBe(false));fireEvent.click(action);
  expect(await screen.findByText(/返回题目与所选范围不一致/)).toBeTruthy();
  expect(screen.getByRole("dialog",{name:"学习路线"})).toBeTruthy();
});
