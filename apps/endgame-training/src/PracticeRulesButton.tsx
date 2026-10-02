import { useEffect, useState } from "react";
import { CircleHelp, X } from "lucide-react";

export function PracticeRulesButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLButtonElement>(".practice-rules-dialog .rules-close")?.focus();
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", close); previous?.focus(); };
  }, [open]);
  return <>
    <button type="button" className="practice-rules-trigger" onClick={() => setOpen(true)}><CircleHelp/>做题规则</button>
    {open && <div className="assignment-review-backdrop" onClick={() => setOpen(false)}>
      <section className="practice-rules-dialog" role="dialog" aria-modal="true" aria-label="做题规则" onClick={(event) => event.stopPropagation()}>
        <header><strong>做题规则</strong><button type="button" className="rules-close" aria-label="关闭做题规则" onClick={() => setOpen(false)}><X/></button></header>
        <table><thead><tr><th>完成时机</th><th>得分</th><th>星级</th></tr></thead><tbody>{[3, 2, 1, 0].map((score, index) => <tr key={score}><td>{index === 3 ? "第 4 次及以后" : `第 ${index + 1} 次`}</td><td>{score} 分</td><td>{score} 星</td></tr>)}</tbody></table>
        <p>每走错一次，尝试次数增加一次。合法错着可以落子，退回后再试；重来不会清除本题的错误、提示或用时。</p>
        <p>首次无错误、无提示且未查看解析的完成，才计入首次正确率。提示后完成按尝试次数计星；查看解析、放弃或未完成计 0 分、0 星。</p>
        <p>提示依次提供思路、当前应走棋子、具体着法与目标位置。</p>
        <p>作业结果先保存在本机，返回作业详情检查后手动提交。平台练习结果会同步到当前账号。</p>
      </section>
    </div>}
  </>;
}
