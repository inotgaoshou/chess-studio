import {expect,it} from "vitest";
import {localTrainingProgress,saveLocalTrainingProgress,saveLocalTrainingOutcome,localTrialNavigationStatus} from "../src/localTrainingProgress";
import type {TrainingProblem} from "../src/types";
const p={id:"teacher-trial:a",serverProblemId:"source-a",title:"试做",trialOwner:"teacher-a",source:"local",startingFen:"fen",solution:[]} as unknown as TrainingProblem;
it("retains trial outcomes when navigating, restarting and saving another draft, without crossing owners",()=>{
 localStorage.clear();
 saveLocalTrainingOutcome(p,"revealed");
 expect(localTrialNavigationStatus("teacher-a","source-a")).toBe("revealed");
 expect(localTrialNavigationStatus("teacher-b","source-a")).toBe("pending");
 saveLocalTrainingProgress(p);
 saveLocalTrainingProgress(p,{moves:[],hints:0,mistakes:0,elapsedMs:100});
 expect(localTrialNavigationStatus("teacher-a","source-a")).toBe("revealed");
 saveLocalTrainingOutcome(p,"completed");
 saveLocalTrainingOutcome(p,"revealed");
 expect(localTrialNavigationStatus("teacher-a","source-a")).toBe("completed");
 expect(localTrainingProgress(p)?.moves).toEqual([]);
});
it("changed problem content resets trial markers and never restores the old draft",()=>{
 localStorage.clear();saveLocalTrainingOutcome(p,"completed");
 const changed={...p,id:"teacher-trial:new-content",startingFen:"changed"};
 expect(localTrainingProgress(changed)).toBeUndefined();
 saveLocalTrainingProgress(changed,{moves:[],hints:0,mistakes:0,elapsedMs:0});
 expect(localTrialNavigationStatus("teacher-a","source-a")).toBe("pending");
});

it("refreshing an existing outcome never clears a resumed draft",()=>{
 localStorage.clear();
 const draft={moves:["a0a1"],hints:2,mistakes:1,elapsedMs:1200};
 saveLocalTrainingProgress(p,draft);saveLocalTrainingOutcome(p,"completed");
 expect(localTrainingProgress(p)).toMatchObject(draft);
});
