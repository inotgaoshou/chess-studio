import type { VerificationRequest, VerificationEvidence, VerificationResult, VerificationSearch } from "../../../packages/training-verification/types";
import type { TrainingProblem } from "./types";
import { cancelPikafishSearch, hasLocalPikafish, localVerificationIdentity, queryVerificationSearch, trainingCore } from "./wasm";

const STORE = "qixi-answer-verification-v1";
type Saved = { key: string; request: VerificationRequest; evidence: VerificationEvidence; result: VerificationResult };
function records(): Saved[] { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } }
export function verificationRequest(problem: TrainingProblem, path: string[], candidate: string): VerificationRequest {
  const label = problem.title.match(/(\d+)步杀/);
  return { startingFen: problem.startingFen, path, candidate, solution: problem.solution, goal: problem.trainingGoal,
    targetMateMoves: problem.targetMateMoves ?? (!problem.trainingGoal && label ? Number(label[1]) : undefined) };
}
function pending(path: string[], message: string): VerificationResult {
  return { outcome: "pending_review", message, path, autoMoves: [], completed: false, verifierVersion: "training-multisolution-v1", localOnly: true };
}
export async function verifyLocally(problem: TrainingProblem, path: string[], candidate: string, context: string, isCurrent: () => boolean): Promise<VerificationResult> {
  let expired = false;
  const startedAt = Date.now();
  const active = () => !expired && isCurrent();
  const request = verificationRequest(problem, path, candidate);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = async () => {
      const core = await trainingCore();
      if (!active()) return pending(path, "验证已取消");
      const specs: VerificationSearch[] = JSON.parse(core.trainingVerificationSearches(JSON.stringify(request)));
      const identity = specs.length && hasLocalPikafish() ? await localVerificationIdentity() : "";
      const evidence: VerificationEvidence = { engineFingerprint: identity, lines: {} };
      const source = JSON.stringify({ context, request, identity, version: "training-multisolution-v1", depth: 26, threads: 2, hash: 128, specs });
      const key = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))).map(v => v.toString(16).padStart(2, "0")).join("");
      const cached = records().find(r => r.key === key);
      if (cached) return cached.result;
      if (identity) for (const spec of specs) {
        if (!active()) return pending(path, "验证已取消");
        const result = await queryVerificationSearch(spec);
        if (!active()) return pending(path, "验证已取消");
        const line = result.lines.find(l => l.multipv === 1);
        if (line) evidence.lines[spec.key] = line;
      }
      if (Date.now() - startedAt > 13000) return pending(path, "待复核：皮卡鱼验证超时，错误次数未增加");
      const result: VerificationResult = JSON.parse(core.verifyTrainingMove(JSON.stringify(request), JSON.stringify(evidence)));
      if (Date.now() - startedAt >= 15000) return pending(path, "待复核：皮卡鱼验证超时，错误次数未增加");
      result.localOnly = true; result.evidenceId = key;
      if (active() && (result.outcome !== "pending_review" || result.reviewKind)) {
        try { localStorage.setItem(STORE, JSON.stringify([...records().filter(r => r.key !== key), { key, request, evidence, result }].slice(-100))); } catch { /* Evidence storage cannot turn a verified move into an error. */ }
      }
      return result;
    };
    return await Promise.race([work(), new Promise<VerificationResult>(resolve => {
      timer = setTimeout(() => { expired = true; void cancelPikafishSearch(); resolve(pending(path, "待复核：皮卡鱼验证超时，错误次数未增加")); }, 15000);
    })]);
  } catch {
    return pending(path, "待复核：皮卡鱼暂时不可用，错误次数未增加");
  } finally { if (timer) clearTimeout(timer); }
}
