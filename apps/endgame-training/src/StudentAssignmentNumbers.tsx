import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";
import type { TrainingProblem } from "./types";

const EXPANDED_KEY = "qixi-student-assignment-numbers-expanded-v1";

export function StudentAssignmentNumbers({ problems, statusLabel, onSelect }: {
  problems: TrainingProblem[];
  statusLabel(problem: TrainingProblem): string;
  onSelect(index: number): void;
}) {
  const gridId = useId();
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem(EXPANDED_KEY) === "true"; } catch { return false; }
  });
  return <section className="student-assignment-numbers" aria-label="作业题号导航">
    <header><strong>共 {problems.length} 题 · 点击题号做题</strong><button type="button" aria-expanded={expanded} aria-controls={gridId} onClick={() => {
      const next = !expanded;
      setExpanded(next);
      try { localStorage.setItem(EXPANDED_KEY, String(next)); } catch {}
    }}>{expanded ? "收起题号" : "展开题号"}{expanded ? <ChevronUp/> : <ChevronDown/>}</button></header>
    <nav id={gridId} className="student-assignment-number-grid" aria-label="作业题号列表" hidden={!expanded}>
      {problems.map((problem, index) => <button type="button" key={problem.id}
        className={`${problem.assignmentGrade?.outcome === "completed" || problem.completedAttempts > 0 ? "completed" : ""} ${problem.submissionState === "submitted" ? "submitted" : ""}`}
        aria-label={`第 ${index + 1} 题：${problem.title}，${statusLabel(problem)}`} title={`${problem.title} · ${statusLabel(problem)}`}
        onClick={() => onSelect(index)}>{index + 1}</button>)}
    </nav>
    {expanded && <small>绿色：已完成 · 圆点：已提交 · 其余：待完成</small>}
  </section>;
}
