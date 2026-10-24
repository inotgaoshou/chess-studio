import type { TrainingProblem } from "./types";
import { VERIFIER_VERSION } from "./verificationPolicy";

export type TrialDraft = { accepted: string[]; path: string[]; hints: number; mistakes: number; elapsedMs: number };
const KEY="qixi-trial-progress-v2";
type Entry = TrialDraft & { content:string };
function read():Record<string,Entry>{try{return JSON.parse(localStorage.getItem(KEY)||"{}");}catch{return {};}}
function content(problem:TrainingProblem){return JSON.stringify([VERIFIER_VERSION,problem.startingFen,problem.solution,problem.trainingGoal,problem.targetMateMoves]);}
function key(context:string,problem:TrainingProblem){return JSON.stringify([context,problem.id]);}
export function loadTrialDraft(context:string,problem:TrainingProblem,accepted:string[]):TrialDraft|undefined{
  const saved=read()[key(context,problem)];
  if(!saved||saved.content!==content(problem)||JSON.stringify(saved.accepted)!==JSON.stringify(accepted)
    ||!Array.isArray(saved.path)||saved.path.length>512||!accepted.every((m,i)=>saved.path[i]===m))return;
  return saved;
}
export function saveTrialDraft(context:string,problem:TrainingProblem,draft?:TrialDraft){
  try{
    const entries=read(),id=key(context,problem);delete entries[id];
    if(draft)entries[id]={...draft,content:content(problem)};
    localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(Object.entries(entries).slice(-80))));
  }catch{/* A storage failure must not alter the accepted route or score. */}
}
