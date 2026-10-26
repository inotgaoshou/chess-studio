import { it,expect,vi } from "vitest";
import { render,screen,fireEvent } from "@testing-library/react";
import { PracticeCalendar } from "../src/PracticeCalendar";
import { teachingClient } from "../src/teaching";
it("keeps book metadata out of restored practice history details",async()=>{
 const date=new Date();const day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
 const book="象棋杀法练习4000题 周晓朴 等编著 2013年8月第1版";
 const problem={id:"p13",title:"图13",sourceIndex:12,category:book,sideToMove:"red",solutionLength:1,note:"1．仕五进四",startingFen:"2bcck3/3na4/4b4/9/9/9/3p5/4K4/4A4/5C3 w - - 0 1"};
 vi.spyOn(teachingClient,"practiceSession").mockResolvedValue({id:"s",items:[{id:"i",problem,status:"completed"}]} as never);
 const history=[{sessionId:"s",localDate:day,completedCount:1,correctCount:1}];
 render(<PracticeCalendar history={history as never} remote renderProblem={()=> <div>棋盘</div>}/>);
 fireEvent.click(screen.getByRole("button",{name:/查看详情/}));
 fireEvent.click(await screen.findByRole("button",{name:"查看题目 图13"}));
 expect(screen.getByText("图13")).toBeTruthy();
 expect(screen.queryByText(/周晓朴|2013年|编著|4000题/)).toBeNull();
 expect(screen.getByText(/红方走/)).toBeTruthy();
});

it("uses safe public titles without changing original bibliographic data",async()=>{
 const {mobileExerciseTitle}=await import("../src/mobileExercisePresentation");
 const original={title:"适情雅趣 作者 第三版",sourceIndex:12};
 expect(mobileExerciseTitle(original)).toBe("第 13 题");
 expect(original.title).toBe("适情雅趣 作者 第三版");
 expect(mobileExerciseTitle({title:"图13",sourceIndex:19})).toBe("图13");
 expect(mobileExerciseTitle({title:"净得子练习 0001"})).toBe("净得子练习 0001");
});

it("requires an objective when restoring platform completion but preserves local rehearsal",async()=>{
 const {missingPlatformGoal}=await import("../src/verificationPolicy");
 const p={source:"platform" as const,serverProblemId:"p13",trainingGoal:undefined,targetMateMoves:undefined};
 expect(missingPlatformGoal(p)).toBe(true);
 expect(missingPlatformGoal({...p,source:"local",serverProblemId:undefined})).toBe(false);
 expect(missingPlatformGoal({...p,targetMateMoves:1})).toBe(false);
});
