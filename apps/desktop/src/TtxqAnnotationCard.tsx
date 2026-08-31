import { MessageSquareText } from "lucide-react";
import { splitTtxqComment } from "./ttxqAnnotations";

export function TtxqAnnotationCard({ value, compact = false }: { value: string; compact?: boolean }) {
  const { sourceText } = splitTtxqComment(value);
  if (!sourceText) return null;
  const lines = sourceText.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] ?? "天天象棋注解";
  const body = lines.slice(1).join("\n");
  return <section className={`ttxq-annotation-card ${compact ? "compact" : ""}`} aria-label="天天象棋注解">
    <header><MessageSquareText size={14}/><div><strong>天天象棋注解</strong><small>{heading}</small></div></header>
    {body && <p>{body}</p>}
  </section>;
}
