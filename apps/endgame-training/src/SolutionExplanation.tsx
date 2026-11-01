import { useLayoutEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { speakCommentary, stopCommentarySpeech } from "./commentarySpeech";
import { cancelTrainingFeedback } from "./moveFeedback";
import "./solutionExplanation.css";

// Imported book notes contain BBCode. Render only text and known emphasis,
// never HTML; the same cleaned paragraphs are used for offline speech.
export function explanationParagraphs(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").replace(/\[br\s*\/?\]/gi, "\n")
    .replace(/\[\/?p\]/gi, "\n\n").replace(/\[b\]/gi, "\n[b]").replace(/\[\/b\]/gi, "[/b]\n")
    .replace(/\[\/?(?:i|u|size|color|font)(?:=[^\]]*)?\]/gi, "")
    .split(/\n+/).map(line => line.trim()).filter(Boolean);
}
const plain = (value: string) => value.replace(/\[\/?b\]/gi, "");
function Paragraphs({ text }: { text: string }) {
  return <>{explanationParagraphs(text).map((line, index) => <p key={index}>{line.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, i) => /^\[b\]/i.test(part) ? <strong key={i}>{plain(part)}</strong> : plain(part))}</p>)}</>;
}

export function SolutionExplanation({ context, comment = "", note = "", onRead }: { context: string; comment?: string; note?: string; onRead?(): void }) {
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const [rate, setRate] = useState(1);
  const epoch = useRef(0);
  const content = [comment && `当前着法。${explanationParagraphs(comment).map(plain).join("\n")}`, note && `题目说明。${explanationParagraphs(note).map(plain).join("\n")}`].filter(Boolean).join("\n");
  const stop = () => { epoch.current++; setSpeaking(false); void stopCommentarySpeech(); };
  useLayoutEffect(() => {
    setSpeaking(false); setError("");
    const background = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { epoch.current++; void stopCommentarySpeech(); document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [context, content]);
  async function read() {
    stop(); onRead?.(); cancelTrainingFeedback();
    const owner = epoch.current;
    setSpeaking(true); setError("");
    try { await speakCommentary(content, rate); }
    catch (reason) { if (owner === epoch.current) setError(reason instanceof Error ? reason.message : "朗读暂不可用，请重试。"); }
    finally { if (owner === epoch.current) setSpeaking(false); }
  }
  if (!content) return null;
  return <section className="solution-explanation" aria-label="题解说明">
    <header><strong>题解说明</strong><button type="button" onClick={() => speaking ? stop() : void read()}>{speaking ? <Square aria-hidden="true"/> : <Volume2 aria-hidden="true"/>}{speaking ? "停止朗读" : "朗读说明"}</button><label>语速<select aria-label="说明朗读语速" value={rate} onChange={e => { stop(); setRate(Number(e.target.value)); }}><option value={.8}>慢速</option><option value={1}>正常</option><option value={1.2}>快速</option></select></label></header>
    {comment && <section className="solution-explanation-current"><h3>当前着法</h3><Paragraphs text={comment}/></section>}
    {note && <section><h3>题目说明</h3><Paragraphs text={note}/></section>}
    {error && <p role="status" className="solution-explanation-error">{error}</p>}
  </section>;
}
