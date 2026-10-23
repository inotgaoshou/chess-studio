import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MobileCatalogFilters, activeCatalogFilterCount, type CatalogFilters } from "../src/MobileCatalogFilters";
import { MobilePracticeSolverPanel, MobileLibraryBrowsePanel, MobilePracticeSearchPanel, MobilePracticeSetupPanel } from "../src/App";
import { TeacherSourceLibraries } from "../src/TeacherSourceLibraries";
import { TeachingCatalog } from "../src/TeachingCatalog";
import { teachingClient, type TeachingAuth } from "../src/teaching";
import { canViewExerciseSolutions } from "../src/exercisePresentation";
import type { TrainingProblem } from "../src/types";

const problem: TrainingProblem={id:"p1",libraryId:"local",sourceIndex:0,title:"一题测试",category:"杀法",startingFen:"4k4/9/9/9/9/9/9/9/4R4/4K4 w",note:"",solution:[],completedAttempts:0,totalElapsedMs:0,serverProblemId:"p1"};
function auth(role: TeachingAuth["user"]["role"], vipActive=false): TeachingAuth {
  return {token:"fixture",expiresAt:"2099-01-01",user:{id:`${role}-${vipActive}`,role,displayName:role,vipActive}} as TeachingAuth;
}
function solver(overrides: Partial<ComponentProps<typeof MobilePracticeSolverPanel>>={}) {
  const props: ComponentProps<typeof MobilePracticeSolverPanel>={answersAllowed:false,problem,pieces:[],legalTargets:[],hints:0,mistakes:0,elapsed:"00:00",ended:false,revealed:false,notice:"继续试走",boardSkin:"default",pieceSkin:"default",riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare:vi.fn(),onMove:vi.fn(),onBack:vi.fn(),onHint:vi.fn(),onRestart:vi.fn(),onReveal:vi.fn(),onNext:vi.fn(),onPrevious:vi.fn(),onFinish:vi.fn(),onFavorite:vi.fn(),favoriteEnabled:false,backLabel:"返回题库",answer:["车五进一"],answerStep:0,demoPlaying:false,onPreviewStep:vi.fn(),onTogglePreview:vi.fn(),onRetryWrongMove:vi.fn(),...overrides};
  return {props,...render(<MobilePracticeSolverPanel {...props}/>)};
}

describe("role-aware exercise UI",()=>{
  for(const [role,vip] of [["student",false],["student",true],["coach",false],["admin",false]] as const) {
    it(`${role} VIP=${vip}: answer buttons and restored panels follow role`,()=>{
      const answersAllowed=canViewExerciseSolutions(auth(role,vip));
      const ui=solver({answersAllowed});
      expect(Boolean(screen.queryByRole("button",{name:"查看解析"}))).toBe(answersAllowed);
      if(answersAllowed){fireEvent.click(screen.getByRole("button",{name:"查看解析"}));expect(ui.props.onReveal).toHaveBeenCalledOnce();}
      ui.rerender(<MobilePracticeSolverPanel {...ui.props} revealed ended resultOutcome="revealed"/>);
      expect(Boolean(screen.queryByRole("button",{name:"播放题解"}))).toBe(answersAllowed);
      expect(Boolean(screen.queryByText("1. 车五进一"))).toBe(answersAllowed);
      expect(screen.getByText("已查看解析")).toBeTruthy();
      fireEvent.click(screen.getByRole("button",{name:"查看结果"}));expect(ui.props.onNext).toHaveBeenCalledOnce();
    });
  }
  it("teacher demo disappears immediately when switching to student",()=>{
    const ui=solver({answersAllowed:true,revealed:true,ended:true,demoPlaying:true});
    expect(screen.getByRole("button",{name:"暂停预演"})).toBeTruthy();
    ui.rerender(<MobilePracticeSolverPanel {...ui.props} answersAllowed={false}/>);
    expect(screen.queryByRole("button",{name:"暂停预演"})).toBeNull();
    expect(screen.queryByText("1. 车五进一")).toBeNull();
  });
  it("local/source list keeps practice and hides only the student's solution action",()=>{
    const onOpenProblem=vi.fn(),onReadSolution=vi.fn();
    const props={scope:"test-local",library:undefined,problems:[problem],message:"",busy:false,onBack:vi.fn(),onOpenProblem,onReadSolution};
    const ui=render(<MobileLibraryBrowsePanel {...props} answersAllowed={false}/>);
    expect(screen.queryByRole("button",{name:/看题解/})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/一题测试/}));expect(onOpenProblem).toHaveBeenCalledWith(problem);
    ui.rerender(<MobileLibraryBrowsePanel {...props} answersAllowed/>);
    fireEvent.click(screen.getByRole("button",{name:/看题解/}));expect(onReadSolution).toHaveBeenCalledWith(problem);
  });
  it("search results can still start practice without exposing answers",async()=>{
    vi.spyOn(teachingClient,"practiceSearch").mockResolvedValue({items:[{...problem,sideToMove:"red",solutionLength:2}]} as never);
    const onOpenProblem=vi.fn();
    render(<MobilePracticeSearchPanel answersAllowed={false} scope="search-role" message="" busy={false} onBack={vi.fn()} onOpenProblem={onOpenProblem} onReadSolution={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"开始搜索"}));
    fireEvent.click(await screen.findByRole("button",{name:/一题测试/}));
    expect(onOpenProblem).toHaveBeenCalledOnce();expect(screen.queryByText(/步题解/)).toBeNull();expect(screen.queryByRole("button",{name:/看题解/})).toBeNull();
  });
  it("student setup cannot start an old selected learning mode after a role change",async()=>{
    vi.spyOn(teachingClient,"platformLibraryProblems").mockResolvedValue([]);
    const onStart=vi.fn(),props={busy:false,message:"",topics:[{id:"t",name:"专题",itemCount:50,sources:[]}],onBack:vi.fn(),onStart};
    const ui=render(<MobilePracticeSetupPanel {...props as ComponentProps<typeof MobilePracticeSetupPanel>} answersAllowed/>);
    fireEvent.click(screen.getByRole("button",{name:/学习模式/}));
    ui.rerender(<MobilePracticeSetupPanel {...props as ComponentProps<typeof MobilePracticeSetupPanel>} answersAllowed={false}/>);
    expect(screen.queryByRole("button",{name:/学习模式/})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:/开始练习/}));expect(onStart.mock.calls[0][0].mode).toBe("solver");
    await waitFor(()=>expect(screen.queryByText("正在读取题目难度…")).toBeNull());
  });
});

describe("single and multiple question navigation",()=>{
  it("single question keeps back/hint/restart/exit and completion result",()=>{
    const ui=solver({navigator:{items:[{id:"p1",title:"一题",status:"pending"}],index:0,onSelect:vi.fn()}});
    expect(ui.container.querySelector(".mobile-solver-nav")).toBeNull();expect(screen.queryByLabelText("题目目录")).toBeNull();
    for(const [name,callback] of [["返回题库",ui.props.onBack],["提示 0/3",ui.props.onHint],["重来",ui.props.onRestart],["结束练习",ui.props.onFinish]] as const){fireEvent.click(screen.getByRole("button",{name}));expect(callback).toHaveBeenCalledOnce();}
    ui.rerender(<MobilePracticeSolverPanel {...ui.props} ended resultOutcome="completed"/>);
    expect(ui.container.querySelector(".mobile-solver-nav")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"查看结果"}));expect(ui.props.onNext).toHaveBeenCalledOnce();
  });
  it("multiple questions retain selection; the last still reaches results",()=>{
    const onSelect=vi.fn();const nav={items:[{id:"p1",title:"一题",status:"pending"},{id:"p2",title:"二题",status:"pending"},{id:"p3",title:"三题",status:"pending"}] as const,index:0,onSelect};
    const ui=solver({navigator:{...nav,items:[...nav.items]}});
    const navigation=screen.getByRole("navigation",{name:"题目导航"});
    expect(navigation.compareDocumentPosition(ui.container.querySelector(".mobile-solver-board")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button",{name:"上一题"})).toBeNull();
    expect(screen.queryByLabelText("题目目录")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"下一题"}));expect(onSelect).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button",{name:"1/3"}));expect(screen.getByLabelText("第 2 题：二题，待完成")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"1/3"}));expect(screen.queryByLabelText("题目目录")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"1/3"}));
    fireEvent.click(screen.getByLabelText("第 2 题：二题，待完成"));expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(screen.queryByLabelText("题目目录")).toBeNull();
    ui.rerender(<MobilePracticeSolverPanel {...ui.props} problem={{...problem,id:"p2"}} navigator={{...nav,items:[...nav.items],index:1}}/>);
    expect(screen.getByRole("button",{name:"上一题"})).toBeTruthy();expect(screen.getByRole("button",{name:"下一题"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"2/3"}));
    ui.rerender(<MobilePracticeSolverPanel {...ui.props} problem={{...problem,id:"p3"}} navigator={{...nav,items:[...nav.items],index:2}}/>);
    expect(screen.queryByLabelText("题目目录")).toBeNull();
    expect(screen.queryByRole("button",{name:"下一题"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"上一题"}));expect(onSelect).toHaveBeenLastCalledWith(1);
    ui.rerender(<MobilePracticeSolverPanel {...ui.props} problem={{...problem,id:"p3"}} navigator={{...nav,items:[...nav.items],index:2}} ended resultOutcome="completed"/>);
    expect(screen.queryByRole("button",{name:"下一题"})).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"查看结果"}));expect(ui.props.onNext).toHaveBeenCalledOnce();
  });
});

describe("compact filter semantics",()=>{
  it("mobile filters omit difficulty and material, keyword semantics are explicit, and clear preserves a mate tab",()=>{
    const initial:CatalogFilters={goal:"mate",difficulty:"2",material:"r",motif:"铁门栓",mateMoves:"3",mateGroup:""};
    function Harness(){const [filters,set]=useState(initial);return <><output aria-label="条件数">{activeCatalogFilterCount(filters,true,true)}</output><output aria-label="步数">{filters.mateMoves}</output><MobileCatalogFilters filters={filters} directMate onChange={set} onClose={vi.fn()}/></>;}
    const ui=render(<Harness/>);
    expect([...ui.container.querySelectorAll(".catalog-mobile-filter-grid label>span")].map(n=>n.textContent)).toEqual(["题目目标","题名关键词"]);
    expect(screen.getByLabelText("条件数").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button",{name:"清空"}));expect(screen.getByLabelText("条件数").textContent).toBe("0");expect(screen.getByLabelText("步数").textContent).toBe("3");
    expect((screen.getByLabelText("题名关键词") as HTMLInputElement).value).toBe("");
  });
  it("non-tab directories retain both mate filters",()=>{
    const onChange=vi.fn(),onClose=vi.fn();render(<MobileCatalogFilters filters={{goal:"",difficulty:"",material:"",motif:"",mateMoves:"4",mateGroup:"long"}} directMate={false} onChange={onChange} onClose={onClose}/>);
    expect(screen.getByLabelText("精确杀法步数")).toBeTruthy();fireEvent.click(screen.getByRole("button",{name:"清空"}));expect(onChange.mock.calls[0][0]).toEqual({goal:"",difficulty:"",material:"",motif:"",mateMoves:"",mateGroup:""});
    fireEvent.click(screen.getByRole("button",{name:"收起"}));expect(onClose).toHaveBeenCalledOnce();
  });
});

let catalogFixtureGeneration=0;
function catalogFixture() {
  const topic={id:"topic-test",name:"基础杀法",kind:"topic",teachingEntry:"basic_mates",displayOrder:0,active:true,confirmed:true,itemCount:100,materialCount:1};
  const fixtureScope=++catalogFixtureGeneration;
  vi.spyOn(teachingClient,"presentationScope").mockImplementation(a=>`${a?.user.id??"guest"}:catalog:${fixtureScope}`);
  vi.spyOn(teachingClient,"catalogBrowse").mockImplementation(async params=>({currentNode:params.nodeId?topic:null,breadcrumbs:params.nodeId?[topic]:[],children:params.nodeId?[]:[topic],learningMaterials:params.view==="materials"?[{id:"book",title:"真实教材棋谱",reviewStatus:"approved"}]:[],mateStepCounts:[{mateMoves:2,itemCount:100}],statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1",statisticsReady:true}));
  const request=vi.spyOn(teachingClient,"catalogProblems").mockImplementation(async (_id,params)=>({items:[{...problem,id:params.cursor?"p2":"p1",sourceIndex:params.cursor?1:0,title:params.cursor?"第二页题目":"一题测试",sideToMove:"red",solutionLength:3,verifiedMateMoves:2}],nextCursor:params.cursor?null:"second"}) as never);
  return {request};
}

describe("catalog role, reading and filter integration",()=>{
  for(const role of ["student","coach","admin"] as const)it(`${role}: original answer badge, reading items, and opening callbacks`,async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();const onReadSolution=vi.fn(),onPractice=vi.fn(),onReadGame=vi.fn();
    render(<TeachingCatalog auth={auth(role)} teacher={role!=="student"} scene="browse" compact onReadSolution={onReadSolution} onPractice={onPractice} onReadGame={onReadGame}/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));
    const question=await screen.findByRole("button",{name:/第 1 题 · 一题测试/});
    expect(Boolean(screen.queryByText("原题解"))).toBe(role!=="student");
    expect(Boolean(screen.queryByRole("button",{name:/看题解/}))).toBe(role!=="student");
    fireEvent.click(question);expect(onPractice).toHaveBeenCalledWith(["p1"],"一题测试");
    fireEvent.click(screen.getByText("按教材查看"));
    if(role==="student"){
      expect(screen.queryByRole("button",{name:"教材学习"})).toBeNull();
      expect(screen.queryByRole("button",{name:"做题训练"})).toBeNull();
      expect(screen.queryByText("暂无已审核教材")).toBeNull();
      expect(onReadGame).not.toHaveBeenCalled();expect(onReadSolution).not.toHaveBeenCalled();
      expect(vi.mocked(teachingClient.catalogBrowse).mock.calls.some(([params])=>params.view==="materials")).toBe(false);
    } else {
      fireEvent.click(screen.getByRole("button",{name:"教材学习"}));
      fireEvent.click(await screen.findByRole("button",{name:"真实教材棋谱"}));expect(onReadGame).toHaveBeenCalledWith("book");
      fireEvent.click(await screen.findByRole("button",{name:/题解 · 一题测试/}));expect(onReadSolution).toHaveBeenCalledWith(["p1"]);
    }
  });
  for(const expired of [false,true])it(`${expired?"expired":"active"} VIP student: textbook chapters remain without the learning switch`,async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();
    const studentAuth=auth("student",!expired);
    if(expired)studentAuth.user.vipExpiresAt="2000-01-01";
    const topic={id:"topic-test",name:"基础杀法",kind:"topic",teachingEntry:"basic_mates",displayOrder:0,active:true,confirmed:true,itemCount:100,materialCount:1};
    const chapter={...topic,id:"source-chapter",parentId:topic.id,name:"原书章节",kind:"chapter"};
    vi.mocked(teachingClient.catalogBrowse).mockImplementation(async params=>({currentNode:params.nodeId===chapter.id?chapter:params.nodeId?topic:null,breadcrumbs:params.nodeId===chapter.id?[topic,chapter]:params.nodeId?[topic]:[],children:params.nodeId===chapter.id?[]:params.nodeId?[chapter]:[topic],learningMaterials:[],mateStepCounts:[{mateMoves:2,itemCount:100}],statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1",statisticsReady:true}));
    const onPractice=vi.fn();render(<TeachingCatalog auth={studentAuth} scene="browse" compact onPractice={onPractice}/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));await screen.findByText("第 1 题 · 一题测试");
    fireEvent.click(screen.getByText("按教材查看"));fireEvent.click(screen.getByRole("button",{name:"原书章节"}));
    fireEvent.click(await screen.findByRole("button",{name:/第 1 题 · 一题测试/}));expect(onPractice).toHaveBeenCalledWith(["p1"],"一题测试");
    expect(screen.queryByRole("button",{name:"教材学习"})).toBeNull();
    expect(vi.mocked(teachingClient.catalogBrowse).mock.calls.some(([params])=>params.view==="materials")).toBe(false);
  });
  it("mobile student resets a reading view and its saved location to training",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();const studentAuth=auth("student");
    const ui=render(<TeachingCatalog auth={studentAuth} scene="browse"/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));
    fireEvent.click(screen.getByRole("button",{name:"棋谱学习"}));await screen.findByRole("button",{name:"真实教材棋谱"});
    ui.rerender(<TeachingCatalog auth={studentAuth} scene="browse" compact/>);
    await screen.findByRole("button",{name:/第 1 题 · 一题测试/});
    expect(screen.queryByRole("button",{name:"真实教材棋谱"})).toBeNull();
    ui.unmount();render(<TeachingCatalog auth={studentAuth} scene="browse" compact/>);
    await screen.findByRole("button",{name:/第 1 题 · 一题测试/});
    expect(screen.queryByText("暂无已审核教材")).toBeNull();
    expect(screen.queryByRole("button",{name:"教材学习"})).toBeNull();
  });
  for(const entry of ["practical_mates","endgame_mates","middlegame","practical_endgames"])it(`mobile student ${entry}: only mate topics hide the learning switch`,async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();
    const chapter={id:"scoped-chapter",kind:"chapter",name:"专题章节",teachingEntry:entry,displayOrder:0,active:true,confirmed:true,itemCount:50,materialCount:1};
    vi.mocked(teachingClient.catalogBrowse).mockImplementation(async params=>({currentNode:params.nodeId?chapter:null,breadcrumbs:params.nodeId?[chapter]:[],children:params.nodeId?[]:[chapter],learningMaterials:params.view==="materials"?[{id:"book",title:"真实教材棋谱",reviewStatus:"approved"}]:[],statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1",statisticsReady:true}));
    render(<TeachingCatalog auth={auth("student",true)} scene="browse" compact/>);
    fireEvent.click(await screen.findByRole("button",{name:/专题章节/}));await screen.findByText("第 1 题 · 一题测试");
    const mate=entry.endsWith("_mates");
    expect(Boolean(screen.queryByRole("button",{name:"做题训练"}))).toBe(!mate);expect(Boolean(screen.queryByRole("button",{name:"棋谱学习"}))).toBe(!mate);
    fireEvent.click(screen.getByRole("button",{name:"筛选"}));expect(screen.getByLabelText("题目目标")).toBeTruthy();
    if(!mate){fireEvent.click(screen.getByRole("button",{name:"棋谱学习"}));await screen.findByRole("button",{name:"真实教材棋谱"});}
  });
  it("collapsed filters preserve conditions, clearing resets cached pagination and keeps the selected mate step",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));const {request}=catalogFixture();
    render(<TeachingCatalog auth={auth("student",true)} scene="browse" compact/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));await screen.findByText("第 1 题 · 一题测试");
    expect(screen.queryByLabelText("题目目标")).toBeNull();
    fireEvent.click(screen.getByRole("button",{name:"加载更多题目"}));await screen.findByText("第 2 题 · 第二页题目");
    fireEvent.click(screen.getByRole("button",{name:"筛选"}));fireEvent.change(screen.getByLabelText("题目目标"),{target:{value:"mate"}});
    fireEvent.click(screen.getByRole("button",{name:"收起"}));expect(screen.queryByLabelText("题目目标")).toBeNull();expect(screen.getByRole("button",{name:"筛选1"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"筛选1"}));expect((screen.getByLabelText("题目目标") as HTMLSelectElement).value).toBe("mate");
    fireEvent.click(screen.getByRole("button",{name:"清空"}));await waitFor(()=>expect(screen.queryByText("第 2 题 · 第二页题目")).toBeNull());
    expect(screen.getByRole("tab",{name:"两步杀"}).getAttribute("aria-selected")).toBe("true");
    expect(request.mock.calls.at(-1)?.[1]).toMatchObject({mateMoves:2,goal:"",cursor:undefined});
  });
  it("typing a keyword waits for debounce instead of resending the old filter",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));const {request}=catalogFixture();
    render(<TeachingCatalog auth={auth("student",true)} scene="browse" compact/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));await screen.findByText("第 1 题 · 一题测试");
    fireEvent.click(screen.getByRole("button",{name:"筛选"}));
    const count=request.mock.calls.length;
    fireEvent.change(screen.getByLabelText("题名关键词"),{target:{value:"答疑"}});
    expect(request.mock.calls.length).toBe(count);
    await waitFor(()=>expect(request.mock.calls.at(-1)?.[1]).toMatchObject({motif:"答疑",cursor:undefined}));
  });
  it("old desktop difficulty and material do not remain as invisible mobile conditions",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));const {request}=catalogFixture();
    vi.mocked(teachingClient.catalogBrowse).mockImplementation(async params=>({currentNode:params.nodeId?{id:"chapter",name:"基础杀法",kind:"chapter",displayOrder:0,active:true,confirmed:true,itemCount:100}:null,breadcrumbs:[],children:params.nodeId?[]:[{id:"chapter",name:"基础杀法",kind:"chapter",displayOrder:0,active:true,confirmed:true,itemCount:100}],learningMaterials:[],statisticsReady:true}));
    const props={auth:auth("coach"),teacher:true,scene:"browse" as const};
    const ui=render(<TeachingCatalog {...props}/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));
    // Desktop keeps the existing controls; mobile removes the unsupported criteria.
    fireEvent.change(await screen.findByLabelText("题目难度"),{target:{value:"2"}});
    fireEvent.change(screen.getByLabelText("局面子力"),{target:{value:"r"}});
    ui.rerender(<TeachingCatalog {...props} compact/>);
    await waitFor(()=>expect(request.mock.calls.at(-1)?.[1]).toMatchObject({difficulty:undefined,material:""}));
    fireEvent.click(screen.getByRole("button",{name:"筛选"}));
    expect(screen.queryByLabelText("题目难度")).toBeNull();expect(screen.queryByLabelText("局面子力")).toBeNull();
  });
  it("opening a catalog question carries the current practice group and selected problem",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();const onPractice=vi.fn();
    render(<TeachingCatalog auth={auth("student",true)} scene="browse" compact onPractice={onPractice}/>);
    fireEvent.click(await screen.findByRole("button",{name:/基础杀法/}));await screen.findByText("第 1 题 · 一题测试");
    fireEvent.click(screen.getByRole("button",{name:"加载更多题目"}));
    fireEvent.click(await screen.findByRole("button",{name:/第 2 题 · 第二页题目/}));
    expect(onPractice).toHaveBeenCalledWith(["p1","p2"],"第二页题目","p2");
  });
  it("teacher assignment selection keeps its original filters and selection action",async()=>{
    window.dispatchEvent(new Event("teaching-content-reset"));catalogFixture();const onAdd=vi.fn();
    // Non-mobile assignment flow does not use direct mate tabs; return a chapter.
    vi.mocked(teachingClient.catalogBrowse).mockImplementation(async params=>({currentNode:params.nodeId?{id:"chapter",kind:"chapter",name:"布置章节",displayOrder:0,active:true,confirmed:true,itemCount:50}:null,breadcrumbs:[],children:params.nodeId?[]:[{id:"chapter",kind:"chapter",name:"布置章节",displayOrder:0,active:true,confirmed:true,itemCount:50}],learningMaterials:[],statisticsRevision:"1",statisticsSnapshotRevision:"1",availabilitySnapshotRevision:"1",statisticsReady:true}));
    render(<TeachingCatalog auth={auth("coach")} teacher scene="select" onAdd={onAdd}/>);
    fireEvent.click(await screen.findByRole("button",{name:/布置章节/}));
    expect(await screen.findByLabelText("搜索章节题目")).toBeTruthy();expect(screen.getByLabelText("精确杀法步数")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button",{name:/第 1 题 · 一题测试/}));expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button",{name:/看题解/})).toBeNull();expect(screen.getByRole("button",{name:"选择当前章节/筛选的全部题目"})).toBeTruthy();
  });
});


describe("legacy source category cleanup",()=>{
  it("teacher/admin platform browser omits other even when it contains two libraries",async()=>{
    vi.spyOn(teachingClient,"teacherLibraryCategories").mockResolvedValue([{code:"other",libraryCount:2},{code:"B",libraryCount:3}]);
    const request=vi.spyOn(teachingClient,"teacherProblemLibrariesPage").mockResolvedValue({items:[]});
    render(<TeacherSourceLibraries auth={auth("admin")} query="" onOpen={vi.fn()}/>);
    await screen.findByRole("tab",{name:"B 中局"});
    fireEvent.click(screen.getByRole("button",{name:"更多分类"}));
    expect(screen.queryByRole("tab",{name:/other|其他/})).toBeNull();
    await waitFor(()=>expect(request).toHaveBeenCalled());
    expect(request.mock.calls.every(([query])=>query.category==="B")).toBe(true);
  });
});
