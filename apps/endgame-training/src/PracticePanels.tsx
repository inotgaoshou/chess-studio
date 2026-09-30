import { useEffect, useRef, useState } from "react";
import { ChevronLeft, CircleCheckBig, LogIn, RefreshCw } from "lucide-react";
import { teachingClient, type PracticeReviewProblem } from "./teaching";

export function PracticeAccessPanel({ signedIn, onLogin }: { signedIn: boolean; onLogin(): void }) {
  return <section className="practice-status"><strong>{signedIn ? "平台练习仅学生账号可用" : "登录学生账号开始平台练习"}</strong><button type="button" onClick={onLogin}><LogIn/>{signedIn ? "切换学生账号" : "登录账号"}</button></section>;
}

export function PracticeStatus({ loading, error, onRetry }: { loading?: boolean; error?: string; onRetry(): void }) {
  return loading ? <p role="status" className="practice-status">正在读取练习数据…</p> : error ? <section role="alert" className="practice-status"><p>{error}</p><button type="button" onClick={onRetry}><RefreshCw/>重试</button></section> : null;
}

export function MobilePracticeReviewPanel({ kind, busy, message, onBack, onStart }: {
  kind: "mistakes" | "favorites"; busy: boolean; message: string; onBack(): void;
  onStart(ids: string[], state: "pending" | "mastered"): void;
}) {
  const [state, setState] = useState<"pending" | "mastered">("pending");
  const [items, setItems] = useState<PracticeReviewProblem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState("全部");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const removalLock = useRef(new Set<string>());
  const [removing, setRemoving] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setItems([]); setSelected([]); setCategory("全部");
    const request = kind === "mistakes" ? teachingClient.practiceMistakes(state) : teachingClient.practiceFavorites();
    void request.then((next) => { if (active) setItems(next); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, state, retry]);
  const categories = ["全部", ...new Set(items.map((item) => item.problem.category).filter(Boolean))];
  const visible = items.filter((item) => category === "全部" || item.problem.category === category);
  const ids = selected.length ? selected : visible.slice(0, 20).map((item) => item.problem.id);
  async function removeFavorite(id: string) {
    if (busy || removalLock.current.has(id)) return;
    removalLock.current.add(id); setRemoving((current) => [...current, id]);
    try {
      await teachingClient.setPracticeFavorite(id, false);
      setItems((current) => current.filter((row) => row.problem.id !== id));
      setSelected((current) => current.filter((value) => value !== id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "取消收藏失败"); }
    finally { removalLock.current.delete(id); setRemoving((current) => current.filter((value) => value !== id)); }
  }
  return <main className="mobile-practice-page mobile-practice-review-page">
    <header className="mobile-page-heading"><button type="button" className="mobile-back-button" aria-label="返回练习" onClick={onBack}><ChevronLeft/></button><span><strong>{kind === "mistakes" ? "错题复习" : "收藏练习"}</strong><small>完成且零错误、零提示才标为已掌握</small></span></header>
    {kind === "mistakes" && <div className="mobile-segmented review-tabs">{(["pending", "mastered"] as const).map((value) => <button type="button" key={value} className={state === value ? "active" : ""} onClick={() => { setState(value); setSelected([]); setCategory("全部"); }}>{value === "pending" ? "待复习" : "已掌握"}</button>)}</div>}
    <div className="mobile-category-strip">{categories.map((value) => <button type="button" key={value} className={category === value ? "active" : ""} onClick={() => { setCategory(value); setSelected([]); }}>{value}</button>)}</div>
    <PracticeStatus loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)}/>
    {!loading && !error && <><div className="practice-selection"><span>已选 {selected.length}/20 题</span><button type="button" disabled={!visible.length} onClick={() => setSelected(visible.slice(0, 20).map((item) => item.problem.id))}>全选{visible.length > 20 ? "前 20 题" : ""}</button><button type="button" disabled={!selected.length} onClick={() => setSelected([])}>清空</button></div>
      <section className="mobile-review-list">{visible.length ? visible.map((item) => <label key={item.problem.id} className={`practice-review-row ${selected.includes(item.problem.id) ? "selected" : ""}`}><input type="checkbox" aria-label={`选择 ${item.problem.title}`} checked={selected.includes(item.problem.id)} disabled={!selected.includes(item.problem.id) && selected.length >= 20} onChange={() => setSelected((current) => current.includes(item.problem.id) ? current.filter((id) => id !== item.problem.id) : [...current, item.problem.id])}/><span><strong>{item.problem.title}</strong><small>{item.problem.category || "未分类"} · 未独立完成次数 {item.errorAttempts}</small></span>{kind === "favorites" && <button type="button" aria-label={`取消收藏 ${item.problem.title}`} disabled={busy || removing.includes(item.problem.id)} onClick={() => void removeFavorite(item.problem.id)}>{removing.includes(item.problem.id) ? "处理中…" : "取消收藏"}</button>}</label>) : <p className="mobile-library-empty">{category !== "全部" ? "此分类暂无题目" : kind === "favorites" ? "还没有收藏题目" : state === "mastered" ? "暂无已掌握题目" : "暂无待复习题目，可查看已掌握题目"}</p>}</section></>}
    {message && <p role="alert" className="practice-status">{message}</p>}
    <button type="button" className="mobile-practice-start" disabled={loading || !!error || !ids.length || busy} onClick={() => onStart(ids, state)}>{busy ? "正在创建练习…" : `${state === "mastered" && kind === "mistakes" ? "巩固重练" : "开始练习"}（${ids.length} 题${selected.length ? "" : " · 当前筛选前 20 题以内"}）`}</button>
  </main>;
}

export function PracticeFavoriteButton({ problemId, onSaved }: { problemId: string; onSaved(): void }) {
  const [favorite, setFavorite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError("");
    void teachingClient.practiceFavorites().then((items) => { if (active) setFavorite(items.some((item) => item.problem.id === problemId)); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "读取收藏失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [problemId, retry]);
  async function toggle() {
    if (lock.current || loading) return;
    if (error) { setRetry((value) => value + 1); return; }
    lock.current = true; setLoading(true);
    try { await teachingClient.setPracticeFavorite(problemId, !favorite); setFavorite(!favorite); onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存收藏失败"); }
    finally { lock.current = false; setLoading(false); }
  }
  return <span className="practice-favorite"><button type="button" disabled={loading} aria-pressed={favorite} onClick={() => void toggle()}><CircleCheckBig/>{loading ? "处理中…" : error ? "重试收藏" : favorite ? "取消收藏" : "收藏题目"}</button>{error && <small role="alert">{error}</small>}</span>;
}
