import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb, LoaderCircle, Square, Volume2 } from "lucide-react";
import { createLocalCommentaryProvider, sideName, type MoveCommentary, type ReferenceLine } from "../../../packages/move-commentary";
import { boardAt, hasLocalPikafish, localVerificationIdentity, moveLineFacts, queryCommentaryAnalysis } from "./wasm";
import type { RuleMode } from "./types";
import { cancelTrainingFeedback } from "./moveFeedback";
import { speakCommentary, stopCommentarySpeech } from "./commentarySpeech";
import "./moveCommentary.css";

export type CommentaryTarget = { context: string; moves: string[]; reference?: { fen: string; line: ReferenceLine }; id: number };
type Props = {
  context: string; startingFen: string; moves: string[]; ruleMode: RuleMode;
  allowed: boolean; accessScope: string; moveTimeMs: number; multiPv: number;
  target?: CommentaryTarget; replyLabel?: boolean;
  notes?: Record<string, string>;
  onTargetConsumed?(target: CommentaryTarget): void;
  /** Recheck live account state at every async boundary, not only React state. */
  isAllowed(): boolean;
};

export function MoveCommentaryPanel(props: Props) {
  const [content, setContent] = useState<{ context: string; value: MoveCommentary }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(1);
  const task = useRef<AbortController | undefined>(undefined);
  const panel = useRef<HTMLElement | null>(null);
  const handledTarget = useRef<CommentaryTarget | undefined>(undefined);
  const speechEpoch = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const provider = useMemo(() => createLocalCommentaryProvider({
    facts: moveLineFacts,
    analyze: (fen, request, signal) => queryCommentaryAnalysis(fen, request.moveTimeMs, request.multiPv, signal),
  }), []);
  const result = props.allowed && content?.context === props.context ? content.value : undefined;

  function stopVoice() {
    speechEpoch.current += 1;
    setSpeaking(false);
    void stopCommentarySpeech();
  }
  function cancel() {
    task.current?.abort();
    setPending(false);
    stopVoice();
  }
  // Layout cleanup prevents a stale voice/content surviving a position or
  // permission change until the next paint. Render is separately scope-gated.
  useLayoutEffect(() => {
    setContent(undefined); setError(""); setPending(false); setSpeaking(false);
    return () => { task.current?.abort(); speechEpoch.current += 1; void stopCommentarySpeech(); };
  }, [props.context, props.allowed]);
  useEffect(() => { provider.clear(); }, [provider, props.accessScope]);
  useEffect(() => {
    const background = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", background);
    return () => document.removeEventListener("visibilitychange", background);
  }, []);

  async function explain(moves: string[], reference?: CommentaryTarget["reference"]) {
    if (!props.allowed || !props.isAllowed() || !moves.length) return;
    cancel();
    const controller = new AbortController(); task.current = controller;
    const { signal } = controller;
    const owner = props.context;
    const valid = () => !signal.aborted && latest.current.context === owner && latest.current.allowed && latest.current.isAllowed();
    setOpen(true); setContent(undefined); setError(""); setPending(true);
    const scroller = panel.current?.closest(".commentary-research-content, .manual-commentary-content");
    if (scroller) scroller.scrollTop = 0;
    try {
      const before = await boardAt(props.startingFen, moves.slice(0, -1), props.ruleMode);
      if (!valid()) return;
      if (reference && reference.fen !== before.fen) throw new Error("候选对应的局面已变化，请重新分析后再讲解。");
      const identity = hasLocalPikafish() ? await localVerificationIdentity().catch(() => "unavailable") : "no-local-engine";
      if (!valid()) return;
      const value = await provider.explain({ beforeFen: before.fen, move: moves.at(-1)!, ruleMode: props.ruleMode,
        engineIdentity: identity, moveTimeMs: props.moveTimeMs, multiPv: props.multiPv,
        accessScope: props.accessScope, authoredNote: props.notes?.[moves.join(",")], reference }, signal);
      if (valid()) setContent({ context: owner, value });
    } catch (failure) {
      if (valid()) setError(failure instanceof Error ? failure.message : "讲解暂不可用，请重试。");
    } finally { if (valid()) setPending(false); }
  }

  useEffect(() => {
    if (props.target?.context === props.context && props.allowed && handledTarget.current !== props.target) {
      handledTarget.current = props.target;
      props.onTargetConsumed?.(props.target);
      void explain(props.target.moves, props.target.reference);
    }
  }, [props.target, props.context, props.allowed]);

  async function read() {
    if (!result || !props.allowed || !props.isAllowed()) return;
    stopVoice(); cancelTrainingFeedback();
    const epoch = speechEpoch.current;
    const owner = props.context;
    setSpeaking(true); setError("");
    try {
      await speakCommentary(`${sideName(result.side)}，${result.notation}。${result.sections.map(s => `${s.title}。${s.text}`).join(" ")}`, rate);
    } catch (failure) {
      if (epoch === speechEpoch.current && owner === latest.current.context && latest.current.isAllowed()) setError(failure instanceof Error ? failure.message : "朗读不可用，文字讲解仍可查看。");
    } finally { if (epoch === speechEpoch.current) setSpeaking(false); }
  }

  if (!props.allowed) return null;
  return <section ref={panel} className="move-commentary" aria-label="着法思路讲解">
    <header><div className="commentary-heading"><span className="commentary-heading-icon"><Lightbulb aria-hidden="true"/></span><span><strong>着法讲解</strong><small>看懂这步的思路</small></span></div><div className="commentary-header-actions">
      <button type="button" className="commentary-primary" disabled={!props.moves.length || pending} aria-busy={pending} onClick={() => void explain(props.moves)}>{pending ? <LoaderCircle className="commentary-spinner" aria-hidden="true"/> : <Lightbulb aria-hidden="true"/>}{pending ? "讲解中…" : props.replyLabel ? "解释刚才这步" : "讲解这步"}</button>
      {(result || pending || error) && <button type="button" className="commentary-collapse" aria-expanded={open} onClick={() => { if (open) cancel(); setOpen(!open); }}>{open ? <ChevronUp aria-hidden="true"/> : <ChevronDown aria-hidden="true"/>}{open ? "收起讲解" : "展开讲解"}</button>}
    </div></header>
    {open && <div className="move-commentary-body">
      {pending && <p role="status">正在核对局面与本地参考线路… <button type="button" onClick={cancel}>取消讲解</button></p>}
      {!pending && !result && !error && <p>选择已走着法或候选，查看局面依据与后续变化。</p>}
      {result && <>
        <h3>{sideName(result.side)} · {result.notation}</h3>
        <small>本地讲解 · {result.depth == null ? "局面事实" : `参考深度 ${result.depth}`}</small>
        <div className="commentary-speech"><button type="button" className={speaking ? "commentary-speaking" : ""} onClick={() => speaking ? stopVoice() : void read()}>{speaking ? <Square aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}{speaking ? "停止朗读" : "朗读讲解"}</button>
          <label>语速 <select value={rate} onChange={event => { stopVoice(); setRate(Number(event.target.value)); }}><option value={.8}>慢速</option><option value={1}>正常</option><option value={1.2}>快速</option></select></label>
        </div>
        <details><summary>对应局面 FEN</summary><code>{result.beforeFen}</code></details>
        {result.sections.map(section => <section key={section.title}><h4>{section.title}</h4><p>{section.text}</p></section>)}
        {!!result.reference.length && <details><summary>后续变化（双方共 {result.reference.length} 步）</summary><small>包含当前这步；每方落子一次计一步，仅供参考。</small><ol>{result.reference.map((move, i) => <li key={i}>{move}</li>)}</ol></details>}

      </>}
      {error && <p role="status">{error}</p>}
    </div>}
  </section>;
}
