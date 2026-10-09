import { useEffect, useMemo, useRef, useState } from "react";
import { chineseLine } from "./wasm";
import type { SolutionMove } from "./types";

export function TeacherTrialAnswer({ fen, solution, moves, busy, onJump }: {
  fen: string; solution: SolutionMove[]; moves: string[]; busy: boolean; onJump(moves: string[]): void;
}) {
  const rows = useMemo(() => {
    const result: { node: SolutionMove; choices: SolutionMove[]; prefix: string[] }[] = [];
    let choices = solution;
    const prefix: string[] = [];
    while (choices.length) {
      const node = choices.find(item => item.iccs === moves[prefix.length]) ?? choices[0];
      result.push({ node, choices, prefix: [...prefix] });
      prefix.push(node.iccs);
      choices = node.children;
    }
    return result;
  }, [solution, moves]);
  const [labels, setLabels] = useState<{ fen: string; moves: string; values: string[] }>();
  const signature = JSON.stringify(rows.map(row => row.node.iccs));
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    void chineseLine(fen, JSON.parse(signature) as string[]).then(values => {
      if (active) setLabels({ fen, moves: signature, values });
    }).catch(() => { if (active) setLabels(undefined); });
    return () => { active = false; };
  }, [fen, signature]);
  useEffect(() => {
    const container = list.current;
    const current = container?.querySelector('[aria-current="step"]');
    if (!container || !current) return;
    const box = current.getBoundingClientRect(), parent = container.getBoundingClientRect();
    if (box.top < parent.top) container.scrollTop += box.top - parent.top;
    else if (box.bottom > parent.bottom) container.scrollTop += box.bottom - parent.bottom;
  }, [moves.length, signature]);
  return <section className="teacher-trial-answer" aria-label="保存题解">
    <header><strong>保存题解 · 第 {moves.length}/{rows.length} 手</strong><button type="button" disabled={busy} onClick={() => onJump([])}>起始局面</button></header>
    <small>点击走法定位棋盘；有变招时可切换核对。此处展示保存的答案，试做进度保留。</small>
    {!rows.length && <p>本题暂无保存题解，可通过 AI 应招试做，或修改本题补充答案。</p>}
    <div ref={list} className="teacher-trial-answer-list">{rows.map(({ node, choices, prefix }, index) => <div className="teacher-trial-answer-row" key={index}>
      <button type="button" disabled={busy} aria-current={moves.length === index + 1 ? "step" : undefined} onClick={() => onJump([...prefix, node.iccs])}>
        <b>{index + 1}.</b><span>{labels?.fen === fen && labels.moves === signature ? labels.values[index] ?? node.iccs : node.iccs}</span>
      </button>
      {choices.length > 1 && <select aria-label={`第 ${index + 1} 手变招`} value={node.iccs} disabled={busy} onChange={event => onJump([...prefix, event.target.value])}>{choices.map((choice, branch) => <option key={choice.iccs} value={choice.iccs}>变招 {branch + 1} · {choice.iccs}{choice.comment ? ` · ${choice.comment}` : ""}</option>)}</select>}
      {node.comment && <p>{node.comment}</p>}
    </div>)}</div>
  </section>;
}
