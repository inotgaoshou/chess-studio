import { BookOpen, Check, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { TheoryCardDto, TheoryLibraryDto } from "./platform";

type Props = {
  library?: TheoryLibraryDto;
  busy: boolean;
  error?: string;
  onScan(): void;
  onCreateCard(card: { lessonId: number; title: string; summary: string; appliesWhen: string; risk: string; timecode?: string }): void;
  onReviewCard(card: TheoryCardDto): void;
  onFeedbackCard?(card: TheoryCardDto, verdict: "correct" | "incorrect" | "needs_revision"): void;
};

const phaseLabel = { opening: "开局", middle: "中局", endgame: "残局" } as const;

export function TheoryLibraryView({ library, busy, error, onScan, onCreateCard, onReviewCard, onFeedbackCard }: Props) {
  const [phase, setPhase] = useState<keyof typeof phaseLabel | "all">("all");
  const lessons = useMemo(() => library?.lessons.filter((lesson) => phase === "all" || lesson.phase === phase) ?? [], [library?.lessons, phase]);
  const approved = library?.cards.filter((card) => card.reviewStatus === "approved").length ?? 0;
  const pending = library?.cards.filter((card) => card.reviewStatus === "pending").length ?? 0;
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [appliesWhen, setAppliesWhen] = useState("");
  const [risk, setRisk] = useState("");
  const [timecode, setTimecode] = useState("");
  const [lessonId, setLessonId] = useState<number>();
  function submit() {
    const target = lessonId ?? lessons[0]?.id;
    if (!target || !title.trim() || !summary.trim() || !appliesWhen.trim() || !risk.trim()) return;
    onCreateCard({ lessonId: target, title, summary, appliesWhen, risk, timecode: timecode.trim() || undefined });
    setTitle(""); setSummary(""); setAppliesWhen(""); setRisk(""); setTimecode(""); setCreating(false);
  }
  return <div className="theory-library-view" aria-label="本地棋理库">
    <header className="theory-library-header">
      <div><BookOpen size={16}/><strong>本地棋理库</strong><small>仅已确认原则卡会参与棋谱思路</small></div>
      <button type="button" onClick={onScan} disabled={busy}><RefreshCw size={13}/>{busy ? "扫描中" : "扫描课程"}</button>
    </header>
    {error && <p className="theory-library-error">{error}</p>}
    <div className="theory-library-stats">
      <span><b>{library?.lessons.length ?? 0}</b> 可用视频</span><span><b>{library?.downloadingFiles ?? 0}</b> 下载中</span><span><b>{lessons.filter((lesson) => lesson.transcriptionStatus === "queued").length}</b> 待转写</span><span><b>{approved}</b> 已确认</span>{pending > 0 && <span><b>{pending}</b> 待审核</span>}
    </div>
    {library && <><button type="button" className="theory-card-create" onClick={() => setCreating((value) => !value)}><Plus size={12}/>手动补充候选卡</button>{creating && <section className="theory-card-form" aria-label="新增待审核原则卡"><select value={lessonId ?? lessons[0]?.id ?? ""} onChange={(event) => setLessonId(Number(event.target.value))}>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select><input placeholder="原则标题" value={title} onChange={(event) => setTitle(event.target.value)}/><textarea placeholder="原创短摘要" value={summary} onChange={(event) => setSummary(event.target.value)}/><input placeholder="适用条件" value={appliesWhen} onChange={(event) => setAppliesWhen(event.target.value)}/><input placeholder="风险或反例" value={risk} onChange={(event) => setRisk(event.target.value)}/><input placeholder="时间点，例如 08:14（可选）" value={timecode} onChange={(event) => setTimecode(event.target.value)}/><button type="button" onClick={submit}>加入待审核</button></section>}</>}
    {(library?.cards.length ?? 0) > 0 && <section className="theory-card-list" aria-label="原则卡审核">{library!.cards.filter((card) => card.reviewStatus !== "rejected").slice(0, 12).map((card) => <article key={card.id}><strong>{card.title}</strong><small>{phaseLabel[card.phase]} · {card.sourceBook ?? card.lessonTitle}{card.sourcePageStart ? ` · p.${card.sourcePageStart}${card.sourcePageEnd && card.sourcePageEnd !== card.sourcePageStart ? `-${card.sourcePageEnd}` : ""}` : card.timecode ? ` · ${card.timecode}` : ""} · v{card.version}{card.needsRecheck ? " · 需复核" : ""}</small><p>{card.summary}</p>{card.tags.length > 0 && <em>标签：{card.tags.join(" / ")}</em>}<footer>{card.reviewStatus === "pending" ? <><button type="button" onClick={() => onReviewCard({ ...card, reviewStatus: "approved" })}>确认采用</button><button type="button" onClick={() => onReviewCard({ ...card, reviewStatus: "rejected" })}>拒绝</button></> : <><span><Check size={12}/>已确认{card.matchPenalty > 0 ? ` · 误匹配惩罚 ${card.matchPenalty}` : ""}</span>{onFeedbackCard && <><button type="button" onClick={() => onFeedbackCard(card, "correct")}>准确</button><button type="button" onClick={() => onFeedbackCard(card, "incorrect")}>不准</button><button type="button" onClick={() => onFeedbackCard(card, "needs_revision")}>需修改</button></>}</>}</footer></article>)}</section>}
    <nav className="theory-library-filters" aria-label="课程阶段">
      <button type="button" className={phase === "all" ? "active" : ""} onClick={() => setPhase("all")}>全部</button>
      {(Object.entries(phaseLabel) as Array<[keyof typeof phaseLabel, string]>).map(([key, label]) => <button key={key} type="button" className={phase === key ? "active" : ""} onClick={() => setPhase(key)}>{label}</button>)}
    </nav>
    {!library ? <p className="theory-library-empty">点击“扫描课程”建立本地视频索引。</p>
      : <div className="theory-lesson-list">{lessons.slice(0, 80).map((lesson) => <article key={lesson.id}><span className={`theory-phase ${lesson.phase}`}>{phaseLabel[lesson.phase]}</span><div><strong>{lesson.title}</strong><small>{lesson.courseName} · {lesson.transcriptionStatus === "queued" ? "等待离线转写" : lesson.transcriptionStatus}</small></div><em>{lesson.transcriptionStatus === "complete" ? <Check size={13}/> : "待"}</em></article>)}{lessons.length > 80 && <p>仅显示前 80 节，转写队列会按阶段分批执行。</p>}</div>}
    <footer>Whisper large-v3 将下载到应用数据目录；视频、音轨和完整逐字稿不会写入棋理数据库。</footer>
  </div>;
}
