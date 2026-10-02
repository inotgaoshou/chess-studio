import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Send, X } from "lucide-react";
import { teachingClient, type AssignmentAnswer, type TeachingAuth } from "./teaching";
import type { TrainingProblem } from "./types";
import { chineseLine } from "./wasm";
import { practiceScore } from "./practiceScoring";

export function AssignmentSubmissionPanel({ assignmentId, auth, problems, onSubmitted, onReviewProblem }: {
  assignmentId: string;
  auth: TeachingAuth;
  problems: TrainingProblem[];
  onSubmitted(): void;
  onReviewProblem(problem: TrainingProblem): void;
}) {
  const [answers, setAnswers] = useState<AssignmentAnswer[]>([]);
  const [notations, setNotations] = useState<Record<string, string[]>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  async function reload() {
    const version = ++generation.current;
    setLoading(true);
    try {
      const next = (await teachingClient.assignmentAnswers(assignmentId)).sort((a, b) => problems.findIndex((problem) => problem.serverProblemId === a.problemId) - problems.findIndex((problem) => problem.serverProblemId === b.problemId));
      if (version !== generation.current) return;
      setAnswers(next);
      const lines = await Promise.all(next.map(async (answer) => {
        const problem = problems.find((item) => item.serverProblemId === answer.problemId);
        return [answer.clientAttemptId, problem ? await chineseLine(problem.startingFen, answer.moves).catch(() => answer.moves) : answer.moves] as const;
      }));
      if (version === generation.current) setNotations(Object.fromEntries(lines));
    } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : "读取答题记录失败"); }
    finally { if (version === generation.current) setLoading(false); }
  }
  useEffect(() => {
    setReviewOpen(false); setAnswers([]); setMessage("");
    void reload();
    return () => { ++generation.current; };
  }, [assignmentId, auth.user.id, auth.user.orgId, problems]);
  useEffect(() => {
    if (!reviewOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !lock.current) setReviewOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reviewOpen]);
  async function submit() {
    if (lock.current || !answers.length) return;
    lock.current = true; setBusy(true); setMessage("");
    const version = generation.current;
    try {
      const result = await teachingClient.submitAssignmentAnswers(assignmentId, answers.map((answer) => answer.clientAttemptId));
      if (version !== generation.current) return;
      setMessage(result.pending ? `${result.submitted} 题提交成功，${result.pending} 题已确认提交，待联网补交` : `${result.submitted} 题已提交给老师`);
      setReviewOpen(false);
      await reload();
      onSubmitted();
    } catch (error) { if (version === generation.current) setMessage(error instanceof Error ? error.message : "提交失败，答题记录已保留"); }
    finally { lock.current = false; setBusy(false); }
  }
  const submittedCount = problems.filter((problem) => problem.submissionState === "submitted").length;
  const allSubmitted = submittedCount === problems.length && problems.length > 0 && !answers.length;
  const graded = problems.filter((problem) => problem.assignmentGrade);
  const totalScore = graded.reduce((sum, problem) => sum + problem.assignmentGrade!.score, 0);
  return <section className="assignment-submission" aria-label="作业提交">
    <div><strong>{answers.length ? `${answers.length} 题待提交` : loading ? "正在读取答题记录…" : allSubmitted ? "作业已提交" : "尚无待提交答案"}</strong><small>{submittedCount}/{problems.length} 题已交给老师</small>{graded.length > 0 && <small>当前总分 {totalScore}/{problems.length * 3} 分{graded.length < problems.length ? ` · ${graded.length} 题有成绩` : ""}{answers.length ? " · 含本机待交成绩" : ""}</small>}</div>
    <button type="button" disabled={loading || busy || !answers.length} onClick={() => setReviewOpen(true)}><ClipboardCheck/>{allSubmitted ? "已提交给老师" : "检查并提交"}</button>
    {message && <p role="status">{message}</p>}
    {reviewOpen && <div className="assignment-review-backdrop">
      <section className="assignment-review-dialog" role="dialog" aria-modal="true" aria-label="检查作业">
        <header><span><strong>检查作业</strong><small>{answers.length} 题待提交 · {submittedCount}/{problems.length} 题已提交</small></span><button type="button" aria-label="关闭作业检查" title="关闭作业检查" disabled={busy} onClick={() => setReviewOpen(false)}><X/></button></header>
        <div className="assignment-review-answers">{answers.map((answer) => {
          const problem = problems.find((item) => item.serverProblemId === answer.problemId);
          return <article key={answer.clientAttemptId}>
            <header><strong>{problem?.title ?? "作业题目"}</strong><span>{answer.submissionRequested ? "待补交" : answer.outcome === "completed" ? "已完成 · 未提交" : answer.outcome === "revealed" ? "已看解析 · 未提交" : "未完成 · 未提交"}</span></header>
            <p>用时 {Math.round(answer.elapsedMs / 1000)} 秒 · 提示 {answer.hintsUsed} 次 · 错误 {answer.mistakes} 次</p>
            <p>{practiceScore(answer.outcome, answer.mistakes)} 分 · {practiceScore(answer.outcome, answer.mistakes)} 星{answer.outcome === "completed" ? ` · 第 ${answer.mistakes + 1} 次尝试完成` : ""}</p>
            <p className="assignment-review-moves">{notations[answer.clientAttemptId]?.join(" · ") || "尚无着法"}</p>
            {problem && !answer.submissionRequested && <button type="button" disabled={busy} onClick={() => { setReviewOpen(false); onReviewProblem(problem); }}>查看并修改</button>}
          </article>;
        })}</div>
        {submittedCount + answers.length < problems.length && <p className="assignment-review-warning">还有 {problems.length - submittedCount - answers.length} 题未作答，本次只提交已有记录。</p>}
        {message && <p role="alert">{message}</p>}
        <footer><button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>继续检查</button><button type="button" className="primary" disabled={busy} onClick={() => void submit()}><Send/>{busy ? "正在提交…" : `确认提交（${answers.length} 题）`}</button></footer>
      </section>
    </div>}
  </section>;
}
