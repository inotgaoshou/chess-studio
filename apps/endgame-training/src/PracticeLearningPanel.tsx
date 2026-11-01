import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronRight, Lightbulb, RotateCcw, X } from "lucide-react";
import { mobileGoalDescription } from "./mobileExercisePresentation";
import type { TrainingProblem } from "./types";
import "./practiceLearning.css";

export function practiceLearningSteps(problem: TrainingProblem, practical: boolean): string[] {
  if (practical || problem.trainingGoal?.kind === "endgame_win" || problem.trainingGoal?.kind === "draw") return [
    "先辨目标：本题要求取胜还是求和；比较双方子力、将帅位置和兵卒推进空间。",
    "寻找关键限制：控制通路与要点，注意将帅助攻、牵制和子力配合。",
    "替对手找最顽强的防守，算清交换后的子力与局面，避免只看自己想走的棋。",
    "取胜题逐步扩大优势并兑现；求和题先守住关键点，不把短暂优势当作已经完成。",
  ];
  if (problem.trainingGoal?.kind === "gain_material") return [
    "先查将军、直接吃子和威胁，找到双方未受保护或被牵制的棋子。",
    "比较候选着法，算清对方回吃与连续交换后的净子力收益。",
    "验证对方能否以将军、反捉或逃子化解，不把能吃到当作已经赢子。",
  ];
  return [
    "先看将帅的位置、退路与保护子，找到可以封锁的逃路。",
    "找车、马、炮、兵的配合，检查将军、吃子、弃子和封锁等候选手段。",
    "替对手逐一检查应将、吃掉进攻子、垫子和逃将，验证变化是否成立。",
    "算到题目要求的终点；将军不等于绝杀，困毙也必须确实没有合法走法。",
  ];
}

type Props = {
  problem: TrainingProblem; practical: boolean; sourceLabel?: string;
  answersAllowed: boolean; completed: boolean; ended: boolean; revealed: boolean;
  hints: number; hintDisabled: boolean; notice: string;
  commentary?: ReactNode; openRequest?: number;
  onHint(): void; onReveal(): void; onRestart(): void; onClose(): void; onOpen?(): void;
};

/** Mount with the question/account identity as key: closing also cancels commentary. */
export function PracticeLearningPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const latest = useRef(props); latest.current = props;
  const canReview = props.answersAllowed && (props.completed || props.revealed);
  const close = () => { setOpen(false); latest.current.onClose(); };
  useEffect(() => { if (props.openRequest && props.answersAllowed) setOpen(true); }, [props.openRequest, props.answersAllowed]);
  useEffect(() => {
    if (!open) return;
    latest.current.onOpen?.();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const page = previous?.closest<HTMLElement>(".mobile-solver-page");
    const pageOverflow = page?.style.overflow;
    if (page) page.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".practice-learning-close")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); latest.current.onClose(); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary, [tabindex="0"]') ?? []).filter(node => node.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      if (page) page.style.overflow = pageOverflow ?? "";
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  const logic = props.problem.logic;
  const authored = canReview ? [
    ["学习主题", logic?.themes?.join("、")], ["本题目标", logic?.goal],
    ["首着思路", logic?.firstMoveIdea], ["关键防守", logic?.keyDefense],
    ["易错原因", logic?.failureReason], ["复习要点", logic?.review],
  ].filter((row): row is [string, string] => Boolean(row[1]?.trim())) : [];
  return <>
    <button type="button" className="practice-learning-entry" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><BookOpen/><span><strong>学习思路</strong><small>观察方法 · 分层提示 · 复盘巩固</small></span><ChevronRight/></button>
    {open && createPortal(<div className="practice-learning-backdrop" onClick={close}>
      <section ref={dialog} className="practice-learning-sheet" role="dialog" aria-modal="true" aria-label="学习思路" onClick={event => event.stopPropagation()}>
        <header><span><strong>学习思路</strong><small>{props.sourceLabel || (props.practical ? "实用残局" : "题内学习指导")}</small></span><button type="button" className="practice-learning-close" aria-label="关闭学习思路" onClick={close}><X/></button></header>
        <div className="practice-learning-content">
          <section><h3>先观察，再计算</h3><p>{mobileGoalDescription(props.problem.trainingGoal) || "先确认题目目标，再计算双方的变化。"}</p><ol>{practiceLearningSteps(props.problem, props.practical).map(step => <li key={step}>{step}</li>)}</ol><small>通用学习方法；本题具体手段请通过提示或解析逐步核对。</small></section>
          {!props.ended && <section><h3>遇到困难，逐层提示</h3><p>思路 → 关键棋子 → 具体走法。提示会计入本题记录，与棋盘下方的提示共用次数。</p><button type="button" className="practice-learning-hint" disabled={props.hintDisabled || props.hints >= 3} aria-label={props.hints >= 3 ? "三级提示已用完" : `获取第 ${props.hints + 1} 级提示`} onClick={props.onHint}><Lightbulb/>提示 {props.hints}/3</button>{props.hints > 0 && <p className="practice-learning-current-hint" role="status">{props.notice}</p>}</section>}
          {canReview ? <>
            <section><h3>{authored.length ? "题目讲解" : "复盘清单"}</h3>{authored.length ? <dl>{authored.map(([title, text]) => <div key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl> : <ul><li>首着解决了什么问题，为什么不能先走另一着？</li><li>对手最顽强的防守是什么，关键应手能否自己算出？</li><li>哪里改变了将帅退路、子力配合或交换得失？</li></ul>}{props.problem.trainingGoal?.description && <p>{props.problem.trainingGoal.description}</p>}<small>{authored.length ? "以上为题目已有讲解；下方着法讲解可核对局面事实与引擎参考变化。" : "本题暂无专属讲解，以上为通用复盘问题。引擎参考不等同于题目题解。"}</small></section>
            {props.commentary}
            <button type="button" onClick={() => { close(); if (!props.revealed) props.onReveal(); }}>{props.revealed ? "回棋盘查看题解" : "查看题解与回放"}</button>
          </> : <p className="practice-learning-locked">{props.answersAllowed ? "先独立尝试。完成本题或主动查看解析后，再核对关键思路与变化。" : "可使用学习方法和分层提示；具体题解与着法讲解遵循当前账号及作业权限。"}</p>}
        </div>
        <footer>{props.ended ? <><p>重做保留已有错误、提示和用时，不会自动标为掌握。</p><button type="button" onClick={() => { close(); props.onRestart(); }}><RotateCcw/>遮住解析，重新做一遍</button></> : <button type="button" onClick={close}>回棋盘继续尝试</button>}</footer>
      </section>
    </div>, document.body)}
  </>;
}
