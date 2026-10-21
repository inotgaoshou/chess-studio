// Canonical source; mirrored to the admin web app by tools/sync-checkin-ui.mjs.
export type CheckinTemplate = { id: string; subject: string; instruction: string; weekdays: number[]; required: boolean; photoRequired: boolean };
export type CheckinDraft = { clientId: string; title: string; startsAt: string; endsAt: string; classIds: string[]; studentIds: string[]; templates: CheckinTemplate[] };
export type CheckinPhase = "draft" | "upcoming" | "active" | "supplement" | "archived";
export type CheckinPlan = { id: string; title: string; status: "draft" | "published"; revision?: number; phase: CheckinPhase; startsAt: string; endsAt: string; supplementUntil: string; draft?: CheckinDraft };
export type CheckinEdit = { expectedRevision?: number; effectiveDate?: string; reason?: string };
export type CheckinTask = { id: string; templateId: string; localDate: string; subject: string; instruction: string; required: boolean; photoRequired: boolean };
export type CheckinSubmission = { taskId: string; studentId: string; status: "pending" | "submitted" | "returned"; revision: number; note: string; photoIds: string[]; submittedAt?: string; isLate: boolean };
export type CheckinBadge = { studentId: string; weekStart: string; plannedDays: number; earnedAt: string; needsSupplement: boolean };
export type CheckinDetail = { plan: CheckinPlan; recipients: { studentId: string; displayName: string }[]; tasks: CheckinTask[]; submissions: CheckinSubmission[]; reviews: { taskId: string; studentId: string; action: "comment" | "return"; note: string; createdAt: string }[]; badges: CheckinBadge[]; serverNow: string; cachedAt?: string };
export type CheckinClass = { id: string; name: string };
export type CheckinStudent = { id: string; displayName: string };
export type CheckinSubmit = { clientId: string; expectedRevision: number; note: string; photoIds: string[] };
export interface CheckinApi {
  list(): Promise<CheckinPlan[]>;
  detail(id: string): Promise<CheckinDetail>;
  create(draft: CheckinDraft): Promise<CheckinPlan>;
  save(id: string, draft: CheckinDraft, edit?: CheckinEdit): Promise<CheckinPlan>;
  remove(id: string, expectedRevision: number, reason: string): Promise<unknown>;
  publish(id: string): Promise<CheckinPlan>;
  submit(taskId: string, body: CheckinSubmit): Promise<{ duplicate: boolean }>;
  review(taskId: string, studentId: string, body: { action: "comment" | "return"; note: string; expectedRevision: number }): Promise<unknown>;
  upload(taskId: string, id: string, blob: Blob): Promise<{ id: string }>;
  photo(id: string): Promise<Blob>;
  classes(): Promise<CheckinClass[]>;
  students(classId: string): Promise<CheckinStudent[]>;
}
export const phaseLabels: Record<CheckinPhase, string> = { draft: "草稿", upcoming: "即将开始", active: "进行中", supplement: "补交期", archived: "已封存" };
export const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DAY = 86_400_000;
export function beijingDate(now: Date | string = new Date()): string { return new Date(new Date(now).getTime() + 8 * 3_600_000).toISOString().slice(0, 10); }
export function beijingInput(value: string): string { return new Date(new Date(value).getTime() + 8 * 3_600_000).toISOString().slice(0, 16); }
export function beijingInstant(input: string): string { return new Date(`${input}:00+08:00`).toISOString(); }
export function checkinTime(value: string): string { return beijingInput(value).replace("T", " "); }
export function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
export function weekday(date: string): number { return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 + 1; }
export function weekStart(date: string): string { return addDays(date, 1 - weekday(date)); }
export function datesInStage(start: string, end: string): string[] {
  const first = beijingDate(start), last = beijingDate(end);
  const count = Math.round((Date.parse(last) - Date.parse(first)) / DAY) + 1;
  if (count < 1 || count > 366 || new Date(end) < new Date(start)) return [];
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}
export function stagePreview(draft: CheckinDraft) {
  const dates = datesInStage(draft.startsAt, draft.endsAt);
  const weeks = new Map<string, number>(); let taskCount = 0; const missing: string[] = [];
  for (const date of dates) {
    weeks.set(weekStart(date), (weeks.get(weekStart(date)) ?? 0) + 1);
    const tasks = draft.templates.filter(t => t.weekdays.includes(weekday(date)));
    taskCount += tasks.length;
    if (!tasks.some(t => t.required)) missing.push(date);
  }
  return { dates, weeks: [...weeks].map(([start, days]) => ({ start, days })), taskCount, missing };
}
export function weekProgress(detail: CheckinDetail, studentId: string, start: string) {
  const tasks = detail.tasks.filter(t => weekStart(t.localDate) === start);
  const submissions = new Map(detail.submissions.filter(s => s.studentId === studentId).map(s => [s.taskId, s]));
  const dates = [...new Set(tasks.map(t => t.localDate))].sort();
  const completedDates = dates.filter(date => {
    const required = tasks.filter(t => t.localDate === date && t.required);
    return required.length > 0 && required.every(t => submissions.get(t.id)?.status === "submitted");
  });
  return { tasks, dates, completedDates, planned: dates.length, completed: completedDates.length };
}
export function canSubmitTask(detail: CheckinDetail, task: CheckinTask, now: string): boolean {
  return detail.plan.status === "published" && new Date(now) >= new Date(detail.plan.startsAt)
    && new Date(now) <= new Date(detail.plan.supplementUntil) && task.localDate <= beijingDate(now);
}
export function newCheckinDraft(): CheckinDraft {
  const today = beijingDate();
  return { clientId: crypto.randomUUID(), title: "", startsAt: `${today}T00:00:00+08:00`, endsAt: `${addDays(today, 27)}T23:59:00+08:00`, classIds: [], studentIds: [], templates: [{ id: crypto.randomUUID(), subject: "语文", instruction: "", weekdays: [1,2,3,4,5,6,7], required: true, photoRequired: false }] };
}

export function copyCheckinDraft(plan: CheckinPlan, plans: CheckinPlan[], today = beijingDate(), classMembers: Record<string, string[]> = {}): CheckinDraft {
  if (!plan.draft) throw new Error("计划模板不可用，请刷新后重试");
  const source = plan.draft;
  const recipients = (draft: CheckinDraft) => new Set([...draft.studentIds, ...draft.classIds.flatMap(id => classMembers[id] ?? [])]);
  const selected = recipients(source);
  const sharesTarget = (other: CheckinPlan) => other.id === plan.id || !!other.draft && (
    [...recipients(other.draft)].some(id => selected.has(id))
    || other.draft.classIds.some(id => source.classIds.includes(id))
  );
  const last = plans.filter(p => p.status === "published" && sharesTarget(p))
    .map(p => beijingDate(p.endsAt)).concat(beijingDate(plan.endsAt)).sort().at(-1)!;
  const first = [today, addDays(last, 1)].sort().at(-1)!;
  const days = datesInStage(plan.startsAt, plan.endsAt).length || 28;
  return { ...source, clientId: crypto.randomUUID(), title: `${plan.title}（新阶段）`.slice(0, 120),
    startsAt: `${first}T00:00:00+08:00`, endsAt: `${addDays(first, days - 1)}T23:59:00+08:00`,
    classIds: [...source.classIds], studentIds: [...source.studentIds],
    templates: source.templates.map(t => ({ ...t, id: crypto.randomUUID(), weekdays: [...t.weekdays] })) };
}

export function checkinPhase(plan: CheckinPlan, now: string = new Date().toISOString()): CheckinPhase {
  if (plan.status === "draft") return "draft";
  if (Date.parse(now) < Date.parse(plan.startsAt)) return "upcoming";
  if (Date.parse(now) <= Date.parse(plan.endsAt)) return "active";
  return Date.parse(now) <= Date.parse(plan.supplementUntil) ? "supplement" : "archived";
}
