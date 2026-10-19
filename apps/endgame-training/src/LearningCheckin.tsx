// Canonical shared interface; see tools/sync-checkin-ui.mjs.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CheckinApi, CheckinBadge, CheckinClass, CheckinDetail, CheckinDraft, CheckinPlan, CheckinStudent, CheckinTask, CheckinTemplate } from "./checkinDomain";
import { addDays, beijingDate, beijingInput, beijingInstant, canSubmitTask, checkinPhase, checkinTime, newCheckinDraft, phaseLabels, stagePreview, weekdayLabels, weekProgress, weekStart } from "./checkinDomain";
import { CheckinStudentClient, compressCheckinPhoto, type CheckinLocalDraft, type PendingCheckin } from "./checkinOffline";
import "./learningCheckin.css";
import { canLeaveCheckin, captureCheckinPosition, focusCheckin, useCheckinLeaveGuard, type CheckinPosition } from "./checkinNavigation";
const message = (error: unknown) => error instanceof Error ? error.message : "读取失败，请重试";
const EMPTY_PHOTOS: CheckinLocalDraft = { note: "", photos: [] };

function Photo({ api, id, blob }: { api: CheckinApi; id: string; blob?: Blob }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState(""); const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; let objectUrl = ""; setUrl(""); setError("");
    void (blob ? Promise.resolve(blob) : api.photo(id)).then(value => { if (active) { objectUrl = URL.createObjectURL(value); setUrl(objectUrl); } }).catch(error => { if (active) setError(message(error)); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, id, blob, retry]);
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label="查看作业照片"><img src={url} alt="提交的作业照片" /></a> : error ? <button type="button" onClick={() => setRetry(v => v + 1)}>照片读取失败，重试</button> : <span role="status">照片加载中…</span>;
}
function Badge({ badge }: { badge: CheckinBadge }) {
  return <span className={`checkin-badge ${badge.needsSupplement ? "needs-supplement" : ""}`}><span aria-hidden="true">🏅</span><strong>{badge.plannedDays === 7 ? "七日坚持" : "阶段周完成"}</strong><small>{badge.weekStart} · {badge.plannedDays}天{badge.needsSupplement ? " · 需补充" : " · 已获得"}</small></span>;
}
function HorseRoute({ detail, studentId, week, animate }: { detail: CheckinDetail; studentId: string; week: string; animate: boolean }) {
  const progress = weekProgress(detail, studentId, week);
  return <section className="checkin-route" aria-label={`本周完成${progress.completed}/${progress.planned}天`}>
    <div className="checkin-route-heading"><strong>小马的学习之旅</strong><span>本周完成 {progress.completed} / {progress.planned} 天</span></div>
    <div className="checkin-route-track"><div className="checkin-route-line" />
      <span className={`checkin-horse ${animate ? "advancing" : ""}`} style={{ left: `${progress.planned ? progress.completed / progress.planned * 100 : 0}%` }} aria-hidden="true">🐴</span>
      <span className="checkin-route-origin">出发</span>
      {progress.dates.map((date, i) => <span key={date} className={`checkin-stop ${progress.completedDates.includes(date) ? "complete" : ""}`} style={{ left: `${(i + 1) / progress.planned * 100}%` }}><b>{progress.completedDates.includes(date) ? "✓" : i + 1}</b><small>{weekdayLabels[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}</small></span>)}
    </div>
    <small>每天必做任务全部完成，小马前进一步；只计算本阶段安排的日期。</small>
  </section>;
}
function WeekTable({ detail, studentId, week, onTask }: { detail: CheckinDetail; studentId: string; week: string; onTask(task: CheckinTask, source: HTMLButtonElement): void }) {
  const progress = weekProgress(detail, studentId, week);
  const templates = [...new Map(progress.tasks.map(t => [t.templateId, t])).values()];
  const submissions = new Map(detail.submissions.filter(s => s.studentId === studentId).map(s => [s.taskId, s]));
  return <div className="checkin-table-scroll"><table className="checkin-week-table"><caption>本周打卡表 · 点击格子查看任务</caption><thead><tr><th scope="col">任务</th>{weekdayLabels.map((label, i) => <th scope="col" key={label}>{label}<small>{addDays(week, i).slice(5)}</small></th>)}</tr></thead><tbody>{templates.map(template => <tr key={template.templateId}><th scope="row"><b>{template.subject}</b><span>{template.instruction}</span></th>{weekdayLabels.map((_, i) => { const task = progress.tasks.find(t => t.templateId === template.templateId && t.localDate === addDays(week, i)); const sub = task ? submissions.get(task.id) : undefined; return <td key={i}>{task ? <button type="button" data-checkin-task={task.id} onClick={event => onTask(task, event.currentTarget)} aria-label={`${task.localDate} ${task.subject} ${sub?.status === "submitted" ? "已完成" : sub?.status === "returned" ? "需补充" : "待完成"}`}>{sub?.status === "submitted" ? <span className="checkin-stamp">成</span> : sub?.status === "returned" ? "需补充" : "待完成"}</button> : <small>未安排</small>}</td>; })}</tr>)}</tbody></table></div>;
}
function TaskRecord({ detail, task, studentId, api }: { detail: CheckinDetail; task: CheckinTask; studentId: string; api: CheckinApi }) {
  const submission = detail.submissions.find(s => s.taskId === task.id && s.studentId === studentId);
  const reviews = detail.reviews.filter(r => r.taskId === task.id && r.studentId === studentId);
  return <div className="checkin-record">
    {submission?.submittedAt && <p>提交于 {checkinTime(submission.submittedAt)}{submission.isLate ? " · 补交" : ""}{submission.status === "returned" ? " · 需要补充" : ""}</p>}
    {submission?.note && <p>心得：{submission.note}</p>}
    <div className="checkin-photos">{submission?.photoIds.map(id => <Photo key={id} api={api} id={id} />)}</div>
    {reviews.map((r, i) => <p key={i} className="checkin-teacher-note"><strong>{r.action === "return" ? "补充一下就好" : "老师留言"}：</strong>{r.note}<small>{checkinTime(r.createdAt)}</small></p>)}
  </div>;
}

export function CheckinStudentWorkspace({ client, studentId, onBack }: { client: CheckinStudentClient; studentId: string; onBack(): void }) {
  const [plans, setPlans] = useState<CheckinPlan[]>([]); const [planId, setPlanId] = useState("");
  const [detail, setDetail] = useState<CheckinDetail>(); const [pending, setPending] = useState<PendingCheckin[]>([]);
  const [week, setWeek] = useState(""); const [date, setDate] = useState(beijingDate()); const [task, setTask] = useState<CheckinTask>();
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [celebrating, setCelebrating] = useState<CheckinBadge>(); const [horseMoved, setHorseMoved] = useState(false); const [stamped, setStamped] = useState("");
  const [motion, setMotion] = useState(() => { try { return localStorage.getItem("qixi-checkin-motion") !== "off"; } catch { return true; } });
  const [tick, setTick] = useState(0); const [clockOffset, setClockOffset] = useState(0); const [, setClockTick] = useState(0);
  const submissionsInFlight = useRef(new Set<string>());
  const taskSection = useRef<HTMLElement>(null);
  const taskSource = useRef<HTMLElement | null>(null);
  const taskPosition = useRef<CheckinPosition | undefined>(undefined);
  const [taskReveal, setTaskReveal] = useState(0);
  useEffect(() => { if (task) focusCheckin(taskSection.current); }, [task?.id, taskReveal]);
  function openTask(value: CheckinTask, source: HTMLButtonElement) {
    if (task?.id !== value.id) { taskSource.current = source; taskPosition.current = captureCheckinPosition(source); }
    setTask(value); setTaskReveal(v => v + 1);
  }
  function closeTask() { setTask(undefined); focusCheckin(taskSource.current, taskPosition.current); }
  const api = client.api;
  useEffect(() => { let active = true; setLoading(true); void client.plans().then(value => { if (active) { setPlans(value); setPlanId(current => value.some(p => p.id === current) ? current : (value.find(p => checkinPhase(p) === "active" || checkinPhase(p) === "supplement") ?? value[0])?.id ?? ""); } }).catch(error => { if (active) setError(message(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [client, tick]);
  useEffect(() => { if (!planId) return; let active = true; setError(""); setLoading(true);
    void Promise.all([client.detail(planId), client.pending()]).then(([value, queued]) => { if (active) {
      setDetail(value); setClockOffset(Date.parse(value.serverNow) - Date.parse(value.cachedAt ?? new Date().toISOString())); setPending(queued); const weeks = [...new Set(value.tasks.map(t => weekStart(t.localDate)))].sort();
      setWeek(current => weeks.includes(current) ? current : weeks.includes(weekStart(beijingDate())) ? weekStart(beijingDate()) : weeks[0] ?? "");
    } }).catch(error => { if (active) setError(message(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; };
  }, [client, planId, tick]);
  useEffect(() => { const sync = () => setTick(v => v + 1); window.addEventListener("qixi-checkin-synced", sync); const timer = window.setInterval(() => setClockTick(v => v + 1), 30_000); return () => { window.removeEventListener("qixi-checkin-synced", sync); window.clearInterval(timer); }; }, []);
  useEffect(() => { if (!horseMoved && !stamped) return; const timer = window.setTimeout(() => { setHorseMoved(false); setStamped(""); }, 1100); return () => clearTimeout(timer); }, [horseMoved, stamped]);
  const progress = detail ? weekProgress(detail, studentId, week) : undefined;
  const weeks = detail ? [...new Set(detail.tasks.map(t => weekStart(t.localDate)))].sort() : [];
  const selectedDate = progress?.dates.includes(date) ? date : progress?.dates[0] ?? "";
  const todayTasks = progress?.tasks.filter(t => t.localDate === selectedDate) ?? [];
  const now = new Date(Date.now() + clockOffset).toISOString();
  async function refresh() { setError(""); setLoading(true); try { await client.flush(); setTick(v => v + 1); } catch (error) { setError(message(error)); } finally { setLoading(false); } }
  async function submitted(task: CheckinTask, draft: CheckinLocalDraft) {
    if (!detail || submissionsInFlight.current.has(task.id)) return;
    submissionsInFlight.current.add(task.id);
    try {
    const before = weekProgress(detail, studentId, weekStart(task.localDate));
    const revision = detail.submissions.find(s => s.taskId === task.id && s.studentId === studentId)?.revision ?? 0;
    await client.queue(detail.plan.id, task.id, revision, draft); closeTask(); setNotice("本机已记录，待同步");
    await client.flush(); const queued = await client.pending(); setPending(queued);
    const updated = await client.detail(detail.plan.id); setDetail(updated);
    if (!queued.some(q => q.taskId === task.id)) {
      const after = weekProgress(updated, studentId, weekStart(task.localDate));
      setNotice(`${task.subject}完成啦！${after.completed > before.completed ? "当天必做任务全部完成！" : "继续按自己的节奏完成下一项。"}`);
      if (motion) { setStamped(task.id); setHorseMoved(after.completed > before.completed); }
      const badge = updated.badges.find(b => b.studentId === studentId && b.weekStart === weekStart(task.localDate) && !b.needsSupplement);
      const oldBadge = detail.badges.find(b => b.studentId === studentId && b.weekStart === badge?.weekStart);
      if (badge && (!oldBadge || oldBadge.needsSupplement)) setCelebrating(badge);
    } else { const item = queued.find(q => q.taskId === task.id); setNotice(item?.error ?? "本机已记录，待同步"); }
    } finally { submissionsInFlight.current.delete(task.id); }
  }
  return <main className={`checkin-workspace checkin-student-workspace ${motion ? "" : "checkin-no-motion"}`}>
    <header className="checkin-heading"><button type="button" onClick={onBack}>‹ 返回</button><div><h1>我的学习打卡</h1></div><button type="button" disabled={loading} onClick={() => void refresh()}>刷新与同步</button></header>
    {error && <p role="alert" className="checkin-error">{error}</p>}{notice && <p role="status" className="checkin-notice">{notice}</p>}
    {loading && <p role="status">正在读取打卡计划…</p>}
    {!loading && !plans.length && !error && <p>老师还没有发布打卡计划。发布后，你的每日任务会显示在这里。</p>}
    <div className="checkin-student-filters">{plans.length > 0 && <label className="checkin-field">阶段计划<select value={planId} onChange={e => { setPlanId(e.target.value); setDetail(undefined); setTask(undefined); setWeek(""); setNotice(""); }}>{plans.map(p => <option key={p.id} value={p.id}>{p.title} · {phaseLabels[checkinPhase(p)]}</option>)}</select></label>}
    {detail && <label className="checkin-field">查看周次<select value={week} onChange={e => { setWeek(e.target.value); setTask(undefined); }}>{weeks.map((w, i) => <option key={w} value={w}>第{i + 1}周 · {w} 至 {addDays(w, 6)}</option>)}</select></label>}</div>
    {detail && <>
      <details className="checkin-plan-info"><summary>计划时间与说明 · {phaseLabels[checkinPhase(detail.plan, now)]}</summary><p>{checkinTime(detail.plan.startsAt)} — {checkinTime(detail.plan.endsAt)}</p><small>补交截止 {checkinTime(detail.plan.supplementUntil)} · 打卡表示已提交，不代表作业全部正确</small></details>
      <div className="checkin-date-tabs" role="group" aria-label="查看每天任务">{progress?.dates.map(d => <button type="button" key={d} aria-pressed={selectedDate === d} onClick={() => { setDate(d); setTask(undefined); }}>{d === beijingDate() ? "今天" : d.slice(5)}{progress.completedDates.includes(d) ? " ✓" : ""}</button>)}</div>
      <section className="checkin-tasks"><header className="checkin-tasks-heading"><h2>{selectedDate === beijingDate() ? "今日任务" : `${selectedDate}任务`}</h2><small>共{todayTasks.length}项 · 已完成{todayTasks.filter(t => detail.submissions.some(s => s.taskId === t.id && s.studentId === studentId && s.status === "submitted")).length}项</small></header>{todayTasks.map(t => {
        const sub = detail.submissions.find(s => s.taskId === t.id && s.studentId === studentId); const local = pending.find(p => p.taskId === t.id);
        return <div key={t.id} className="checkin-task-item"><article className="checkin-task"><div><div className="checkin-task-meta"><span className="checkin-subject">{t.subject}</span><small>{t.required ? "必做" : "选做"}{t.photoRequired ? " · 需照片" : ""}</small></div><strong>{t.instruction}</strong>{local && <p className={local.blocked ? "checkin-error" : ""}>{local.blocked ? "未提交成功，本机记录保留" : "本机已记录，待同步"}{local.error ? `：${local.error}` : ""}</p>}</div>
          <button type="button" aria-expanded={task?.id === t.id} aria-controls={task?.id === t.id ? "checkin-student-task-detail" : undefined} onClick={event => openTask(t, event.currentTarget)}>{sub?.status === "submitted" ? <span className={`checkin-stamp ${stamped === t.id ? "stamping" : ""}`}>成</span> : sub?.status === "returned" ? "需补充" : local ? "查看本机记录" : canSubmitTask(detail, t, now) ? "去打卡" : "查看任务"}</button>
        </article>
          {task?.id === t.id && <StudentTaskEditor key={task.id} sectionRef={taskSection} task={task} detail={detail} studentId={studentId} client={client} pending={local} now={now} onSubmit={draft => submitted(task, draft)} onClose={closeTask} />}
        </div>;
      })}{!todayTasks.length && <p>当天没有安排任务，可切换日期查看。</p>}</section>
      <details className="checkin-progress-details"><summary>本周进度与徽章 · {progress?.completed ?? 0}/{progress?.planned ?? 0}天达标</summary>
      <HorseRoute detail={detail} studentId={studentId} week={week} animate={horseMoved} />
      <WeekTable detail={detail} studentId={studentId} week={week} onTask={(t, source) => { setDate(t.localDate); openTask(t, source); }} />
      <section className="checkin-badges"><h2>我的徽章</h2>{detail.badges.filter(b => b.studentId === studentId).map(b => <Badge key={b.weekStart} badge={b} />)}{!detail.badges.length && <p>完成本周安排的学习日，就能获得周徽章。</p>}</section>
    <label className="checkin-motion"><input type="checkbox" checked={motion} onChange={e => { setMotion(e.target.checked); try { localStorage.setItem("qixi-checkin-motion", e.target.checked ? "on" : "off"); } catch { /* Session preference remains usable. */ } }} />完成动效</label>
      </details>
    </>}
    {celebrating && <section className="checkin-celebration" role="status"><div className="checkin-confetti" aria-hidden="true">✦ · ✧ · ✦</div><h2>小马到达本周终点啦！</h2><Badge badge={celebrating} /><p>这一周的努力，都留下了印记。</p><button type="button" onClick={() => setCelebrating(undefined)}>收好徽章</button></section>}
  </main>;
}
function StudentTaskEditor({ sectionRef, task, detail, studentId, client, pending, now, onSubmit, onClose }: { sectionRef: React.RefObject<HTMLElement | null>; now: string; task: CheckinTask; detail: CheckinDetail; studentId: string; client: CheckinStudentClient; pending?: PendingCheckin; onSubmit(draft: CheckinLocalDraft): Promise<void>; onClose(): void }) {
  const [draft, setDraft] = useState<CheckinLocalDraft>(EMPTY_PHOTOS); const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; void client.draft(task.id).then(saved => { if (active) { setDraft(saved ?? pending ?? EMPTY_PHOTOS); setReady(true); } }).catch(error => { if (active) setError(message(error)); }); return () => { active = false; }; }, [client, task.id]);
  const sub = detail.submissions.find(s => s.taskId === task.id && s.studentId === studentId);
  const writable = canSubmitTask(detail, task, now) && sub?.status !== "submitted" && (!pending || pending.blocked);
  async function update(value: CheckinLocalDraft) { setDraft(value); try { await client.saveDraft(task.id, value); } catch (error) { setError(`草稿保存失败：${message(error)}`); } }
  async function addPhoto(file?: File) { if (!file) return; setBusy(true); setError(""); try { const blob = await compressCheckinPhoto(file); await update({ ...draft, photos: [...draft.photos, { id: crypto.randomUUID(), blob }] }); } catch (error) { setError(message(error)); } finally { setBusy(false); } }
  const submitting = useRef(false);
  async function submit() { if (submitting.current) return; submitting.current = true; setBusy(true); setError(""); try { await onSubmit(draft); } catch (error) { setError(message(error)); } finally { submitting.current = false; setBusy(false); } }
  return <section ref={sectionRef} tabIndex={-1} id="checkin-student-task-detail" className="checkin-task-editor" aria-label="任务详情"><header><h2>{task.subject} · {task.localDate}</h2><button type="button" onClick={onClose}>收起</button></header><p>{task.instruction}</p><TaskRecord detail={detail} task={task} studentId={studentId} api={client.api} />
    {!writable && !pending && sub?.status !== "submitted" && <p>任务尚未开放或补交期已经结束。</p>}
    {(writable || pending) && <><label className="checkin-field">一句心得（选填）<textarea disabled={!writable || busy || !ready} value={draft.note} maxLength={1000} onChange={e => void update({ ...draft, note: e.target.value })} placeholder="今天我完成了什么？" /></label>
      <div className="checkin-photos">{draft.photos.map(photo => <div key={photo.id}><Photo api={client.api} id={photo.id} blob={photo.blob} />{writable && <button type="button" disabled={busy} onClick={() => void update({ ...draft, photos: draft.photos.filter(p => p.id !== photo.id) })}>移除</button>}</div>)}</div>
      {writable && <><label className="checkin-file">{task.photoRequired ? "上传作业照片（必交）" : "添加照片（选填）"}<input aria-label="从相册选择作业照片" type="file" accept="image/*" disabled={busy || !ready || draft.photos.length >= 3} onChange={e => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label><label className="checkin-file">拍照<input aria-label="拍摄作业照片" type="file" accept="image/*" capture="environment" disabled={busy || !ready || draft.photos.length >= 3} onChange={e => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label><small>每项最多3张，照片会压缩后上传；草稿自动保存在本机。</small><button className="checkin-primary" type="button" disabled={busy || !ready || (task.photoRequired && !draft.photos.length)} onClick={() => void submit()}>{busy ? "正在记录…" : sub?.status === "returned" ? "补充并重新提交" : "我完成了，盖个章"}</button></>}
      {pending && <p>{pending.error ?? "本机已记录，等待联网同步"}</p>}
    </>}{error && <p className="checkin-error" role="alert">{error}</p>}
  </section>;
}

export function CheckinTeacherWorkspace({ api, onBack }: { api: CheckinApi; onBack?: () => void }) {
  const [plans, setPlans] = useState<CheckinPlan[]>([]); const [classes, setClasses] = useState<CheckinClass[]>([]); const [students, setStudents] = useState<CheckinStudent[]>([]);
  const [draft, setDraft] = useState<CheckinDraft>(); const [editing, setEditing] = useState<string>(); const [detail, setDetail] = useState<CheckinDetail>();
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [busy, setBusy] = useState(false); const [filter, setFilter] = useState(""); const [classFilter, setClassFilter] = useState("");
  const [preview, setPreview] = useState(false); const [retry, setRetry] = useState(0); const [ready, setReady] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false); const [detailShown, setDetailShown] = useState(true); const [reveal, setReveal] = useState(0);
  const [savedDraft, setSavedDraft] = useState("");
  const sourcePosition = useRef<CheckinPosition | undefined>(undefined); const editorPosition = useRef<CheckinPosition | undefined>(undefined);
  const workspace = useRef<HTMLElement>(null); const sourceButton = useRef<HTMLElement | null>(null);
  useCheckinLeaveGuard(Boolean(draft && JSON.stringify(draft) !== savedDraft), busy);
  useEffect(() => { if (draft && !editorCollapsed) focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-plan-editor"), editorPosition.current); }, [draft?.clientId, editorCollapsed]);
  useEffect(() => { if (detail && detailShown) focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-results")); }, [detail?.plan.id, detailShown, reveal]);
  function returnToPlans() { setDetailShown(false); focusCheckin(sourceButton.current ?? workspace.current?.querySelector<HTMLElement>(".checkin-plan-list"), sourcePosition.current); }
  function showEditor(value: CheckinDraft, id?: string) { editorPosition.current = undefined; setDraft(value); setSavedDraft(id ? JSON.stringify(value) : ""); setEditing(id); setEditorCollapsed(false); setDetailShown(false); setPreview(false); focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-plan-editor")); }

  async function reload() {
    const [p, c] = await Promise.all([api.list(), api.classes()]);
    const members = await Promise.all(c.map(c => api.students(c.id)));
    setPlans(p); setClasses(c); setStudents([...new Map(members.flat().map(s => [s.id, s])).values()]); setReady(true);
  }
  useEffect(() => { let active = true; setReady(false); setError(""); void Promise.all([api.list(), api.classes()]).then(async ([p,c]) => { const members = await Promise.all(c.map(c => api.students(c.id))); if (active) { setPlans(p); setClasses(c); setStudents([...new Map(members.flat().map(s => [s.id,s])).values()]); setReady(true); } }).catch(error => { if (active) setError(message(error)); }); return () => { active = false; }; }, [api, retry]);
  async function save(publish: boolean) {
    if (!draft) return; setBusy(true); setError("");
    try { const plan = editing ? await api.save(editing, draft) : await api.create(draft); setEditing(plan.id); setSavedDraft(JSON.stringify(draft));
      if (publish) { await api.publish(plan.id); setDraft(undefined); setEditing(undefined); setNotice("阶段计划已发布，每周任务将自动重复"); } else { setNotice("草稿已保存"); }
      await reload(); setPreview(false);
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  function copy(plan: CheckinPlan) {
    if (!plan.draft || !canLeaveCheckin()) return;
    const fresh = newCheckinDraft();
    showEditor({ ...plan.draft, clientId: fresh.clientId, startsAt: fresh.startsAt, endsAt: fresh.endsAt, title: `${plan.title}（新阶段）`.slice(0,120), templates: plan.draft.templates.map(t => ({ ...t, id: crypto.randomUUID(), weekdays: [...t.weekdays] })) });
    setDetail(undefined);
  }
  async function open(plan: CheckinPlan, source: HTMLElement) {
    sourceButton.current = source; sourcePosition.current = captureCheckinPosition(source);
    if (detail?.plan.id === plan.id && plan.status !== "draft") { setDetailShown(true); setReveal(v => v + 1); focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-results")); return; }
    if (editing === plan.id && draft) { setEditorCollapsed(false); focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-plan-editor")); return; }
    if (!canLeaveCheckin()) return;
    setError(""); setBusy(true);
    try {
      if (plan.status === "draft" && plan.draft) { showEditor(plan.draft, plan.id); setDetail(undefined); }
      else { setDetail(await api.detail(plan.id)); setDetailShown(true); setDraft(undefined); setReveal(v => v + 1); focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-results")); }
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  }
  const visible = plans.filter(p => (!filter || checkinPhase(p) === filter) && (!classFilter || p.draft?.classIds.includes(classFilter)));
  return <main ref={workspace} className="checkin-workspace checkin-teacher"><header className="checkin-heading">{onBack && <button type="button" onClick={() => { if (canLeaveCheckin()) onBack(); }}>‹ 返回</button>}<div><h1>学习打卡</h1><p>一次布置，在阶段内每周循环；可以为两个孩子分别制定计划。</p></div><button type="button" disabled={busy || !ready} className="checkin-primary" onClick={() => { if (!canLeaveCheckin()) return; showEditor(newCheckinDraft()); setDetail(undefined); setNotice(""); }}>新建阶段计划</button></header>
    {error && <p className="checkin-error" role="alert">{error}<button type="button" onClick={() => setRetry(v => v + 1)}>重试读取</button></p>}{notice && <p role="status" className="checkin-notice">{notice}</p>}{!ready && !error && <p role="status">正在读取班级与打卡计划…</p>}
    {draft && <CheckinPlanEditor key={draft.clientId} draft={draft} classes={classes} students={students} onChange={value => { setDraft(value); setPreview(false); }} busy={busy} collapsed={editorCollapsed} onToggle={() => { if (!editorCollapsed) editorPosition.current = captureCheckinPosition(workspace.current); setEditorCollapsed(v => !v); if (!editorCollapsed) focusCheckin(workspace.current?.querySelector<HTMLElement>(".checkin-plan-editor")); }} onDiscard={() => { if (canLeaveCheckin()) { setDraft(undefined); setEditing(undefined); } }} preview={preview} onPreview={() => setPreview(true)} onSave={() => void save(false)} onPublish={() => void save(true)} onClose={() => { if (!editorCollapsed) editorPosition.current = captureCheckinPosition(workspace.current); setEditorCollapsed(true); focusCheckin(sourceButton.current ?? workspace.current?.querySelector<HTMLElement>(".checkin-plan-list"), sourcePosition.current); }} />}
    {detail && <div hidden={!detailShown}><TeacherPlanDetail key={detail.plan.id} api={api} detail={detail} onChange={setDetail} onClose={returnToPlans} reveal={reveal} /></div>}
    <section className="checkin-plan-list" tabIndex={-1}><h2>阶段计划</h2><div className="checkin-filters"><label>状态<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部状态</option>{Object.entries(phaseLabels).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>班级<select value={classFilter} onChange={e => setClassFilter(e.target.value)}><option value="">全部班级／指定学生</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
    {visible.map(p => <article className="checkin-plan" key={p.id}><div><strong>{p.title}</strong><span>{phaseLabels[checkinPhase(p)]} · 每周重复</span><small>{checkinTime(p.startsAt)} — {checkinTime(p.endsAt)}</small><small>{p.draft?.classIds.length ? p.draft.classIds.map(id => classes.find(c => c.id === id)?.name ?? "原班级").join("、") : p.draft?.studentIds.map(id => students.find(s => s.id === id)?.displayName ?? "指定学生").join("、")}</small></div><div><button disabled={busy} type="button" onClick={event => void open(p, event.currentTarget)}>{p.status === "draft" ? "编辑草稿" : "完成情况"}</button><button disabled={busy} type="button" onClick={() => copy(p)}>复制新阶段</button></div></article>)}
    {ready && !visible.length && <p>暂无计划。新建后可为整班或某个孩子安排七天任务。</p>}</section>
  </main>;
}
function CheckinPlanEditor({ draft, classes, students, onChange, busy, preview, onPreview, onSave, onPublish, onClose, collapsed, onToggle, onDiscard }: { collapsed: boolean; onToggle(): void; onDiscard(): void; draft: CheckinDraft; classes: CheckinClass[]; students: CheckinStudent[]; onChange(draft: CheckinDraft): void; busy: boolean; preview: boolean; onPreview(): void; onSave(): void; onPublish(): void; onClose(): void }) {
  const [target, setTarget] = useState<"class" | "student">(draft.classIds.length ? "class" : "student");
  const info = useMemo(() => stagePreview(draft), [draft]);
  const valid = draft.title.trim() && info.dates.length && !info.missing.length && (draft.classIds.length || draft.studentIds.length) && draft.templates.every(t => t.subject.trim() && t.instruction.trim() && t.weekdays.length);
  function toggle(key: "classIds" | "studentIds", id: string) { onChange({ ...draft, [key]: draft[key].includes(id) ? draft[key].filter(v => v !== id) : [...draft[key], id] }); }
  function taskChange(id: string, value: Partial<CheckinTemplate>) { onChange({ ...draft, templates: draft.templates.map(t => t.id === id ? { ...t, ...value } : t) }); }
  return <section className="checkin-plan-editor" tabIndex={-1}><header className="checkin-sticky-actions"><h2>{collapsed ? draft.title || "未命名计划" : "布置阶段计划"}</h2><div><button type="button" disabled={busy} onClick={onClose}>返回计划列表</button><button type="button" disabled={busy} aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? "展开编辑" : "收起"}</button><button type="button" disabled={busy} onClick={onDiscard}>放弃编辑</button></div></header><fieldset disabled={busy} hidden={collapsed}>
    <label className="checkin-field">计划名称<input value={draft.title} maxLength={120} onChange={e => onChange({ ...draft, title: e.target.value })} placeholder="例如：哥哥的期中学习计划" /></label>
    <div className="checkin-form-grid"><label className="checkin-field">开始时间（北京时间）<input type="datetime-local" value={beijingInput(draft.startsAt)} onChange={e => { if (e.target.value) onChange({ ...draft, startsAt: beijingInstant(e.target.value) }); }} /></label><label className="checkin-field">结束时间（北京时间）<input type="datetime-local" value={beijingInput(draft.endsAt)} onChange={e => { if (e.target.value) onChange({ ...draft, endsAt: beijingInstant(e.target.value) }); }} /></label></div>
    <p>重复方式：每周重复 · 结束后仍可补交七天 · 最长366天</p>
    <label className="checkin-field">布置范围<select value={target} onChange={e => { const mode = e.target.value as "class" | "student"; setTarget(mode); onChange({ ...draft, classIds: [], studentIds: [] }); }}><option value="student">指定学生（两个孩子可分别布置）</option><option value="class">整班布置</option></select></label>
    <div className="checkin-targets">{target === "class" ? classes.map(c => <label key={c.id}><input type="checkbox" checked={draft.classIds.includes(c.id)} onChange={() => toggle("classIds",c.id)} />{c.name}</label>) : students.map(s => <label key={s.id}><input type="checkbox" checked={draft.studentIds.includes(s.id)} onChange={() => toggle("studentIds",s.id)} />{s.displayName}</label>)}{!classes.length && <p>请先在班级管理中创建班级，并添加两个孩子或学生。</p>}</div>
    <h3>一周任务模板</h3>{draft.templates.map((t, i) => <section className="checkin-template" key={t.id}><header><strong>任务{i + 1}</strong><button type="button" disabled={draft.templates.length <= 1} onClick={() => onChange({ ...draft, templates: draft.templates.filter(v => v.id !== t.id) })}>移除</button></header>
      <label className="checkin-field">科目<input list="checkin-subjects" value={t.subject} maxLength={40} onChange={e => taskChange(t.id,{subject:e.target.value})} /></label>
      <label className="checkin-field">具体要求<textarea value={t.instruction} maxLength={1000} placeholder="例如：完成数学练习册第35页" onChange={e => taskChange(t.id,{instruction:e.target.value})} /></label>
      <div className="checkin-weekdays" role="group" aria-label={`任务${i + 1}执行星期`}>{weekdayLabels.map((d,j) => <label key={d}><input type="checkbox" checked={t.weekdays.includes(j + 1)} onChange={() => taskChange(t.id,{weekdays:t.weekdays.includes(j + 1) ? t.weekdays.filter(v => v !== j + 1) : [...t.weekdays,j + 1].sort()})} />{d}</label>)}<button type="button" onClick={() => taskChange(t.id,{weekdays:[1,2,3,4,5,6,7]})}>应用到七天</button></div>
      <div className="checkin-options"><label><input type="checkbox" checked={t.required} onChange={e => taskChange(t.id,{required:e.target.checked})} />必做任务</label><label><input type="checkbox" checked={t.photoRequired} onChange={e => taskChange(t.id,{photoRequired:e.target.checked})} />照片必交</label></div>
    </section>)}<datalist id="checkin-subjects">{["语文","数学","英语","象棋","阅读","运动"].map(s => <option key={s} value={s} />)}</datalist>
    <button type="button" disabled={draft.templates.length >= 30} onClick={() => onChange({ ...draft, templates: [...draft.templates,{id:crypto.randomUUID(),subject:"数学",instruction:"",weekdays:[1,2,3,4,5,6,7],required:true,photoRequired:false}] })}>＋ 添加任务</button>
    {!info.dates.length && <p className="checkin-error">请设置有效起止时间，最多366天。</p>}{info.missing.length > 0 && <p className="checkin-error">以下日期缺少必做任务：{info.missing.slice(0,7).join("、")}{info.missing.length > 7 ? "…" : ""}</p>}
    <footer><button type="button" disabled={!valid} onClick={onSave}>保存草稿</button><button type="button" disabled={!valid} onClick={onPreview}>预览发布</button></footer>
    {preview && <section className="checkin-preview"><h3>发布预览</h3><p>{info.dates[0]} — {info.dates.at(-1)} · 共{info.dates.length}天、{info.taskCount}项任务／学生</p><p>补交截止 {checkinTime(new Date(Date.parse(draft.endsAt) + 7*86_400_000).toISOString())}</p><p>{info.weeks.map((w,i) => `第${i + 1}周${w.days}天${w.days < 7 ? "（阶段短周）" : ""}`).join(" · ")}</p><strong>学生页面中的一周任务</strong><ul>{draft.templates.map(t => <li key={t.id}>{t.subject} · {t.instruction} · {t.weekdays.map(d => weekdayLabels[d - 1]).join("、")} · {t.required ? "必做" : "选做"}{t.photoRequired ? " · 需照片" : ""}</li>)}</ul><p>发布后任务及接收名单锁定；本阶段内每周自动重复。</p><button className="checkin-primary" type="button" disabled={!valid} onClick={onPublish}>确认发布阶段计划</button></section>}
    <footer><button type="button" disabled={busy} onClick={onClose}>返回计划列表</button><button type="button" disabled={busy} onClick={onToggle}>收起</button></footer>
  </fieldset></section>;
}
export function CheckinPlanResults({ api, detail, onClose, studentId, week, reveal }: { reveal?: number; api: CheckinApi; detail: CheckinDetail; onClose(): void; studentId?: string; week?: string }) {
  return <div className="checkin-workspace"><TeacherPlanDetail key={`${detail.plan.id}:${studentId}:${week}`} api={api} detail={detail} onChange={() => {}} onClose={onClose} initialStudent={studentId} initialWeek={week} reveal={reveal} readOnly /></div>;
}
function TeacherPlanDetail({ api, detail, onChange, onClose, initialStudent, initialWeek, reveal, readOnly = false }: { reveal?: number; api: CheckinApi; detail: CheckinDetail; onChange(detail: CheckinDetail): void; onClose(): void; initialStudent?: string; initialWeek?: string; readOnly?: boolean }) {
  const weeks = [...new Set(detail.tasks.map(t => weekStart(t.localDate)))].sort();
  const [week,setWeek] = useState(initialWeek && weeks.includes(initialWeek) ? initialWeek : weeks.includes(weekStart(beijingDate())) ? weekStart(beijingDate()) : weeks[0] ?? "");
  const [student,setStudent] = useState(initialStudent && detail.recipients.some(r => r.studentId === initialStudent) ? initialStudent : detail.recipients[0]?.studentId ?? ""); const [task,setTask] = useState<CheckinTask>(); const [note,setNote] = useState(""); const [error,setError] = useState(""); const [busy,setBusy] = useState(false); const [onlyIncomplete,setOnlyIncomplete] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const collapsedPosition = useRef<CheckinPosition | undefined>(undefined); const taskPosition = useRef<CheckinPosition | undefined>(undefined);
  const section = useRef<HTMLElement>(null); const taskSection = useRef<HTMLElement>(null); const taskSource = useRef<HTMLElement | null>(null);
  useCheckinLeaveGuard(Boolean(note.trim()), busy);
  useEffect(() => { setCollapsed(false); }, [reveal]);
  useEffect(() => { if (task) focusCheckin(taskSection.current); }, [task?.id]);
  function closeTask() {
    if (!canLeaveCheckin()) return;
    setTask(undefined); setNote(""); setError(""); focusCheckin(taskSource.current, taskPosition.current);
  }
  function back() { if (task) closeTask(); else if (canLeaveCheckin()) onClose(); }
  function toggle() { if (!collapsed) collapsedPosition.current = captureCheckinPosition(section.current); setCollapsed(v => !v); focusCheckin(section.current, collapsed ? collapsedPosition.current : undefined); }
  function changeStudent(value: string) { if (!canLeaveCheckin()) return; setStudent(value); setTask(undefined); setNote(""); setError(""); }
  const submission = task ? detail.submissions.find(s => s.taskId === task.id && s.studentId === student) : undefined;
  async function review(action: "comment" | "return") { if (!task || !submission) return; setBusy(true); setError(""); try { await api.review(task.id,student,{action,note,expectedRevision:submission.revision}); onChange(await api.detail(detail.plan.id)); setNote(""); } catch(error) { setError(message(error)); } finally { setBusy(false); } }
  return <section className="checkin-results" ref={section} tabIndex={-1}><header className="checkin-sticky-actions"><div><h2>{detail.plan.title} · 完成情况</h2><small>{detail.recipients.find(r => r.studentId === student)?.displayName} · {week}</small></div><div><button type="button" disabled={busy} onClick={back}>{task ? "返回打卡表" : "返回列表"}</button><button type="button" disabled={busy} aria-expanded={!collapsed} onClick={toggle}>{collapsed ? "展开详情" : "收起"}</button></div></header><div hidden={collapsed}><label className="checkin-field">周次<select value={week} onChange={e => { if (!canLeaveCheckin()) return; setWeek(e.target.value); setTask(undefined); setNote(""); setError(""); }}>{weeks.map((w,i) => <option key={w} value={w}>第{i + 1}周 · {w}</option>)}</select></label><label className="checkin-motion"><input type="checkbox" checked={onlyIncomplete} onChange={e => setOnlyIncomplete(e.target.checked)} />只看未完成或需补充</label>
    <div className="checkin-table-scroll"><table className="checkin-summary-table"><caption>班级／指定学生本周完成情况</caption><thead><tr><th>学生</th>{weekdayLabels.map((d,i) => <th key={d}>{d}<small>{addDays(week,i).slice(5)}</small></th>)}<th>完成日</th></tr></thead><tbody>{detail.recipients.filter(r => { const p = weekProgress(detail,r.studentId,week); return !onlyIncomplete || p.completed < p.planned; }).map(r => { const p = weekProgress(detail,r.studentId,week); return <tr key={r.studentId}><th><button type="button" aria-pressed={student === r.studentId} onClick={() => {changeStudent(r.studentId);}}>{r.displayName}</button></th>{weekdayLabels.map((_,i) => { const date = addDays(week,i); return <td key={i}>{p.dates.includes(date) ? p.completedDates.includes(date) ? "✓ 完成" : "待完成" : "未安排"}</td>; })}<td>{p.completed}/{p.planned}</td></tr>; })}</tbody></table></div>
    <label className="checkin-field">查看学生<select value={student} onChange={e => {changeStudent(e.target.value);}}>{detail.recipients.map(r => <option key={r.studentId} value={r.studentId}>{r.displayName}</option>)}</select></label>
    <WeekTable detail={detail} studentId={student} week={week} onTask={(t, source) => { if (busy) return; if (task?.id !== t.id && !canLeaveCheckin()) return; taskSource.current = source; taskPosition.current = captureCheckinPosition(source); setTask(t); if (task?.id !== t.id) setNote(""); setError(""); }} />
    <div className="checkin-badges">{detail.badges.filter(b => b.studentId === student).map(b => <Badge key={b.weekStart} badge={b} />)}</div>
    {task && <section className="checkin-task-editor" ref={taskSection} tabIndex={-1}><header><h3>{task.localDate} · {task.subject}</h3><button type="button" disabled={busy} onClick={closeTask}>关闭任务详情</button></header><p>{task.instruction}</p><TaskRecord api={api} detail={detail} task={task} studentId={student} />{submission && !readOnly ? <><label className="checkin-field">留言／退回原因<textarea disabled={busy} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="例如：这周坚持得很好！或：请补一张清楚的照片。" /></label><footer><button type="button" disabled={busy || !note.trim()} onClick={() => void review("comment")}>发送留言</button><button type="button" disabled={busy || !note.trim() || submission.status !== "submitted" || Date.now() > Date.parse(detail.plan.supplementUntil)} onClick={() => void review("return")}>退回补充</button></footer></> : !submission ? <p>学生尚未提交。</p> : null}{error && <p role="alert" className="checkin-error">{error}</p>}</section>}
    <footer className="checkin-bottom-actions"><button type="button" disabled={busy} onClick={back}>{task ? "返回打卡表" : "返回列表"}</button><button type="button" disabled={busy} onClick={toggle}>收起</button></footer></div>
  </section>;
}
