import { useState } from "react";
import type { VerificationGoal } from "../../../packages/training-verification/types";
import type { TrainingProblem } from "./types";

export function LocalGoalEditor({problem, answersAllowed = true, onSave}: {problem: TrainingProblem; answersAllowed?: boolean; onSave(goal?: VerificationGoal, target?: number): Promise<void>}) {
  const initial: VerificationGoal | undefined = problem.trainingGoal ?? undefined;
  const [kind, setKind] = useState(initial?.kind ?? (problem.targetMateMoves ? "mate" : ""));
  const [horizon, setHorizon] = useState(initial?.verification?.horizonPlies ?? 12);
  const [threshold, setThreshold] = useState(String(initial?.kind === "gain_material" ? initial.verification?.minMaterialGain ?? "" : initial?.verification?.minScoreCp ?? ""));
  const [target, setTarget] = useState(String(problem.targetMateMoves ?? ""));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <details><summary>本题验证目标</summary><form onSubmit={event => {
    event.preventDefault(); setBusy(true); setError("");
    const goal: VerificationGoal | undefined = kind ? {kind: kind as VerificationGoal["kind"], description: initial?.description || "本机人工确认目标", solverSide: problem.startingFen.split(/\s+/)[1] === "b" ? "b" : "w", reviewMethod: kind === "mate" ? "forced_mate" : "reviewed_solution", verification: kind === "mate" ? undefined : {horizonPlies:horizon,maxCpLoss:50,[kind === "gain_material" ? "minMaterialGain" : "minScoreCp"]:Number(threshold)}} : undefined;
    void onSave(goal, kind === "mate" ? Number(target) : undefined).catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
  }}>
    <label>目标<select value={kind} onChange={event => {setKind(event.target.value);setThreshold("");}}><option value="">{answersAllowed ? "保留原题解" : "保留当前设置"}</option><option value="mate">规定步数杀棋</option><option value="gain_material">得子</option><option value="draw">谋和</option><option value="endgame_win">取胜</option></select></label>
    {kind === "mate" ? <label>最多步数<input required type="number" min={1} max={255} value={target} onChange={event => setTarget(event.target.value)}/></label> : kind && <>
      <label>验证半回合数<input required type="number" min={2} max={40} step={2} value={horizon} onChange={event => setHorizon(Number(event.target.value))}/></label>
      <label>{kind === "gain_material" ? "最低净子力收益" : "最低解题方评估分"}<input required type="number" min={kind === "gain_material" ? 1 : -30000} max={kind === "gain_material" ? 10000 : 30000} value={threshold} onChange={event => setThreshold(event.target.value)}/></label>
      <p>最大损失 50 cp。车 1000、马炮 500、士象 200、兵卒 100。</p>
    </>}
    <p>请人工确认目标条件。仅保存在本机。</p>{error && <p role="alert">{error}</p>}<button disabled={busy}>确认并保存目标</button>
  </form></details>;
}
