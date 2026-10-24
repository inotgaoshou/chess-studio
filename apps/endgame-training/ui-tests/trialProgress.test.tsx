import { expect,it } from "vitest";
import { loadTrialDraft, saveTrialDraft } from "../src/trialProgress";
import { loadListNumbers, saveListNumbers } from "../src/practiceNavigation";
import type { TrainingProblem } from "../src/types";
it("restores trials separately from verified moves and isolates accounts/content/paths",()=>{
  const p={id:"p",startingFen:"fen",solution:[],targetMateMoves:2} as unknown as TrainingProblem;
  const d={accepted:["a3a4"],path:["a3a4","a6a5","c3c4"],hints:1,mistakes:2,elapsedMs:5000};
  saveTrialDraft("student-a",p,d);
  expect(loadTrialDraft("student-a",p,d.accepted)?.path).toEqual(d.path);
  expect(loadTrialDraft("student-b",p,d.accepted)).toBeUndefined();
  expect(loadTrialDraft("student-a",{...p,targetMateMoves:3},d.accepted)).toBeUndefined();
  expect(loadTrialDraft("student-a",p,[])).toBeUndefined();
  saveTrialDraft("student-a",p);expect(loadTrialDraft("student-a",p,d.accepted)).toBeUndefined();
});
it("keeps session display numbers account-scoped across resume",()=>{
  saveListNumbers("student-a","s1",{p:51,q:52});
  expect(loadListNumbers("student-a","s1")).toEqual({p:51,q:52});
  expect(loadListNumbers("student-b","s1")).toEqual({});
});
