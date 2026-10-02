import { BookOpen, ChevronLeft, ChevronRight, ClipboardList, FileArchive, GraduationCap, Home, LogIn, Plus, RefreshCw, Search, Send, Trash2, UserRound, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TeacherResults, type ResultBoardRenderer } from "./TeacherResults";
import {
  teachingClient,
  type TeacherAssignmentResult,
  type TeacherAssignmentSummary,
  type TeacherClassDto,
  type TeacherClassMember,
  type TeacherFolder,
  type TeacherProblem,
  type TeacherProblemLibrary,
  type TeachingAssignment,
  type TeachingAuth,
  type TeachingOrganization,
  type TeachingOrganizationJoinRequest,
} from "./teaching";

type AssignmentFilter = { libraryId: string; q: string; count: number; label: string };
type AssignmentSelection = { libraryIds: string[]; problems: TeacherProblem[]; filters: AssignmentFilter[] };
type AssignmentBatchMode = "none" | "preset" | "size" | "count";
type AssignmentDraft = {
  title: string; description: string; classIds: string[]; studentIds: string[]; dueAt: string;
  timeLimitMinutes: string; maxAttempts: string; allowAnswer: boolean; randomizeItems: boolean; batchSize: number; batchCount: number; batchMode: AssignmentBatchMode;
};

const EMPTY_DRAFT: AssignmentDraft = { title: "", description: "", classIds: [], studentIds: [], dueAt: "", timeLimitMinutes: "", maxAttempts: "0", allowAnswer: false, randomizeItems: false, batchSize: 20, batchCount: 7, batchMode: "none" };
const EMPTY_SELECTION: AssignmentSelection = { libraryIds: [], problems: [], filters: [] };

export function allowTeacherNavigation(nextPath: string) {
  return window.dispatchEvent(new CustomEvent("qixi-teacher-before-navigation", { cancelable: true, detail: { nextPath } }));
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
function dateTime(value?: string | null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未设置"; }
function assignmentStatusLabel(status?: TeachingAssignment["status"]) {
  return status === "draft" ? "未发布" : status === "closed" ? "已关闭" : "已发布";
}
function assignmentProgressLabel(assignment: TeachingAssignment) {
  return assignment.status === "draft"
    ? "草稿不会同步给学生"
    : assignment.status === "published"
      ? `${assignment.completedCount}/${assignment.targetCount} 人完成`
      : `${assignment.completedCount}/${assignment.targetCount} 人完成`;
}
function studentProgressLabel(completedCount: number, totalCount: number) {
  if (totalCount > 0 && completedCount >= totalCount) return "已完成";
  if (completedCount > 0) return "进行中";
  return "未开始";
}
function routeKind(path: string) {
  if (path === "/teacher/join-organization") return "join" as const;
  if (path === "/teacher/classes") return "classes" as const;
  if (path.startsWith("/teacher/classes/")) return "class" as const;
  if (path === "/teacher/assignments/new") return "new" as const;
  if (path.startsWith("/teacher/assignments/")) return "assignment" as const;
  return "home" as const;
}
function routeId(path: string, prefix: string) { return decodeURIComponent(path.slice(prefix.length)); }
function selectionCount(selection: AssignmentSelection, libraries: TeacherProblemLibrary[]) {
  return selection.libraryIds.reduce((sum, id) => sum + (libraries.find((library) => library.id === id)?.publishedCount ?? 0), 0)
    + selection.problems.length + selection.filters.reduce((sum, item) => sum + item.count, 0);
}
function uniqueProblems(problems: TeacherProblem[]) {
  return [...new Map(problems.map((problem) => [problem.id, problem])).values()]
    .sort((left, right) => left.libraryId.localeCompare(right.libraryId) || left.sourceIndex - right.sourceIndex || left.id.localeCompare(right.id));
}
function rangeLabel(problems: TeacherProblem[]) {
  const first = problems[0]; const last = problems.at(-1);
  return first && last && first.libraryId === last.libraryId && last.sourceIndex - first.sourceIndex + 1 === problems.length
    ? `${first.sourceIndex + 1}-${last.sourceIndex + 1}题` : `共${problems.length}题`;
}
function batchTitle(base: string, suffix: string) {
  const safeBase = (base.trim() || "未命名作业").slice(0, 180);
  return `${safeBase} - ${suffix}`.slice(0, 255);
}

function StudentIdentity({ displayName, loginName }: { displayName: string; loginName: string }) {
  return <span className="teacher-mobile-student-identity"><b><em>姓名</em>{displayName}</b><small><em>登录名/ID</em>{loginName}</small></span>;
}

function libraryContentKey(library: TeacherProblemLibrary) {
  const fingerprint = [library.fingerprint, library.contentFingerprint, library.content_fingerprint, library.fileSha256, library.file_sha256, library.hash]
    .map((value) => value?.trim())
    .find(Boolean);
  const parserVersion = library.parserVersion ?? library.parser_version ?? "";
  return fingerprint ? `fingerprint:${fingerprint.toLowerCase()}:${parserVersion}` : `library:${library.id}`;
}

function librarySourceKind(library: TeacherProblemLibrary, currentOrgId?: string | null) {
  const scope = [
    library.sourceScope, library.source_scope, library.visibilityScope, library.visibility_scope,
    library.scope, library.sourceLabel, library.source_label, library.orgName, library.org_name,
  ].filter(Boolean).join(" ").toLowerCase();
  if (scope.includes("platform") || scope.includes("public") || scope.includes("common") || scope.includes("平台") || scope.includes("公共") || scope.includes("象棋工作室")) return "platform";
  if (scope.includes("org") || scope.includes("school") || scope.includes("private") || scope.includes("institution") || scope.includes("机构") || scope.includes("学校")) return "organization";
  const orgId = library.orgId ?? library.org_id;
  if (orgId && currentOrgId && orgId === currentOrgId) return "organization";
  return "unknown";
}

function librarySourceLabel(library: TeacherProblemLibrary, currentOrgId?: string | null) {
  if (library.mergedSourceLabel) return library.mergedSourceLabel;
  const sourceLabel = library.sourceLabel ?? library.source_label;
  if (sourceLabel) return sourceLabel;
  const kind = librarySourceKind(library, currentOrgId);
  return kind === "platform" ? "平台公共" : kind === "organization" ? "机构题库" : "题库";
}

function dedupeTeacherLibraries(libraries: TeacherProblemLibrary[], currentOrgId?: string | null) {
  const byKey = new Map<string, { library: TeacherProblemLibrary; sources: Set<string>; count: number }>();
  const sourceScore = (library: TeacherProblemLibrary) => librarySourceKind(library, currentOrgId) === "organization" ? 2 : librarySourceKind(library, currentOrgId) === "platform" ? 0 : 1;
  for (const library of libraries) {
    const key = libraryContentKey(library);
    const source = librarySourceKind(library, currentOrgId);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { library, sources: new Set([source]), count: 1 });
      continue;
    }
    current.sources.add(source);
    current.count += 1;
    if (sourceScore(library) > sourceScore(current.library)) current.library = library;
  }
  let mergedDuplicateCount = 0;
  const items = [...byKey.values()].map(({ library, sources, count }) => {
    if (count > 1) mergedDuplicateCount += count - 1;
    const hasPlatform = sources.has("platform");
    const hasOrganization = sources.has("organization");
    const mergedSourceLabel = hasPlatform && hasOrganization
      ? "平台+机构"
      : hasOrganization
        ? "机构题库"
        : hasPlatform
          ? "平台公共"
          : librarySourceLabel(library, currentOrgId);
    return { ...library, mergedSourceLabel, mergedDuplicateCount: count - 1 };
  });
  return { items, mergedDuplicateCount };
}

async function allProblems(libraryId: string, query: string, context: TeachingAuth) {
  const items: TeacherProblem[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  do {
    const page = await teachingClient.teacherProblems(libraryId, { q: query, cursor, limit: 100 }, context);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) throw new Error("题目分页异常，请刷新后重试。");
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}

async function buildBatchPlans(selection: AssignmentSelection, libraries: TeacherProblemLibrary[], draft: AssignmentDraft, context: TeachingAuth) {
  const plans: Array<{ title: string; problemIds: string[] }> = [];
  const value = draft.batchMode === "count" ? draft.batchCount : draft.batchSize;
  if (draft.batchMode !== "none" && (!Number.isInteger(value) || value < 1 || value > 10000)) throw new Error("每批题数或批次数必须为 1–10000 的整数");
  const libraryById = new Map(libraries.map((library) => [library.id, library]));
  const groups: Array<{ label: string; problems: TeacherProblem[] }> = [];
  for (const libraryId of selection.libraryIds) groups.push({ label: libraryById.get(libraryId)?.title || "题库", problems: await allProblems(libraryId, "", context) });
  for (const filter of selection.filters) groups.push({ label: filter.label, problems: await allProblems(filter.libraryId, filter.q, context) });
  const custom = new Map<string, TeacherProblem[]>();
  for (const problem of selection.problems) custom.set(problem.libraryId, [...(custom.get(problem.libraryId) ?? []), problem]);
  for (const [libraryId, problems] of custom) {
    const ids = new Set(problems.map((item) => item.id));
    const available = await allProblems(libraryId, "", context);
    groups.push({ label: `${libraryById.get(libraryId)?.title || "题库"} 自选题`, problems: available.filter((item) => ids.has(item.id)) });
  }
  const emitted = new Set<string>();
  const groupCounts: Array<{ label: string; count: number; batches: number }> = [];
  for (const group of groups) {
    const sorted = uniqueProblems(group.problems).filter((problem) => !emitted.has(problem.id) && Boolean(emitted.add(problem.id)));
    const count = draft.batchMode === "none" ? 0 : draft.batchMode === "count" ? Math.min(sorted.length, draft.batchCount) : Math.ceil(sorted.length / draft.batchSize);
    groupCounts.push({ label: group.label, count: sorted.length, batches: count });
    for (let index = 0; index < count; index++) {
      const chunk = draft.batchMode === "count"
        ? sorted.slice(Math.floor(index * sorted.length / count), Math.floor((index + 1) * sorted.length / count))
        : sorted.slice(index * draft.batchSize, (index + 1) * draft.batchSize);
      if (chunk.length) plans.push({ title: batchTitle(draft.title, `${group.label} 第${String(index + 1).padStart(2, "0")}批（${rangeLabel(chunk)}）`), problemIds: chunk.map((problem) => problem.id) });
    }
  }
  if (draft.batchMode === "none" && emitted.size) plans.push({ title: draft.title.trim(), problemIds: [...emitted] });
  return { plans, groups: groupCounts, count: emitted.size };
}

export function TeacherMobileWorkspace({ auth, path, onNavigate, onLogout, onExit, onRelogin, onAuthChange, renderResultBoard }: {
  auth: TeachingAuth; path: string; onNavigate(path: string): void; onLogout(): void; onExit(): void; onRelogin(): void; onAuthChange(auth: TeachingAuth): void;
  renderResultBoard?: ResultBoardRenderer;
}) {
  const kind = routeKind(path);
  if (!auth.user.orgId && !auth.user.isPlatformAdmin) return <TeacherJoinOrganization auth={auth} onLogout={onLogout} onExit={onExit} onRelogin={onRelogin} onApproved={async () => { const next = await teachingClient.refreshSession(); if (!next) throw new Error("登录会话已失效，请重新登录。"); onAuthChange(next); onNavigate("/teacher"); }}/>;
  if (kind === "join") return <TeacherMobileShell active="join" onNavigate={onNavigate}><TeacherJoinOrganization auth={auth} onLogout={onLogout} onExit={() => onNavigate("/teacher")} onRelogin={onRelogin} onApproved={async () => { const next = await teachingClient.refreshSession(); if (!next) throw new Error("登录会话已失效，请重新登录。"); onAuthChange(next); onNavigate("/teacher"); }}/></TeacherMobileShell>;
  const scopeKey = `${auth.user.id}:${auth.user.orgId}`;
  if (kind === "classes") return <TeacherMobileShell active="classes" onNavigate={onNavigate}><TeacherClasses key={scopeKey} onNavigate={onNavigate}/></TeacherMobileShell>;
  if (kind === "class") return <TeacherMobileShell active="classes" onNavigate={onNavigate}><TeacherClassDetail key={`${scopeKey}:${path}`} classId={routeId(path, "/teacher/classes/")} onNavigate={onNavigate}/></TeacherMobileShell>;
  if (kind === "new") return <TeacherAssignmentWizard key={auth.user.id} auth={auth} onNavigate={onNavigate} onAuthChange={onAuthChange}/>;
  if (kind === "assignment") return <TeacherMobileShell active="assignments" onNavigate={onNavigate}><TeacherAssignmentDetail key={`${scopeKey}:${path}`} assignmentId={routeId(path, "/teacher/assignments/")} onNavigate={onNavigate} renderResultBoard={renderResultBoard}/></TeacherMobileShell>;
  return <TeacherMobileShell active="home" onNavigate={onNavigate}><TeacherHome key={scopeKey} auth={auth} onNavigate={onNavigate} onAuthChange={onAuthChange} onExit={onExit}/></TeacherMobileShell>;
}

function TeacherMobileShell({ active, children, onNavigate }: { active: "home" | "assignments" | "classes" | "join"; children: ReactNode; onNavigate(path: string): void }) {
  const items = [
    { id: "home", label: "工作台", icon: Home, path: "/teacher" },
    { id: "assignments", label: "布置", icon: Send, path: "/teacher/assignments/new" },
    { id: "classes", label: "班级", icon: GraduationCap, path: "/teacher/classes" },
    { id: "join", label: "申请", icon: UserRound, path: "/teacher/join-organization" },
  ] as const;
  return <div className="teacher-mobile-shell">
    {children}
    <nav className="teacher-mobile-bottom-nav" aria-label="教师底部导航">
      {items.map((item) => <button type="button" key={item.id} className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => onNavigate(item.path)}><item.icon/><span>{item.label}</span></button>)}
    </nav>
  </div>;
}

export function OrganizationSearchSelect({ organizations, query, selectedId, busy = false, onQueryChange, onSelect }: {
  organizations: TeachingOrganization[];
  query: string;
  selectedId: string;
  busy?: boolean;
  onQueryChange(value: string): void;
  onSelect(organization?: TeachingOrganization): void;
}) {
  const [open, setOpen] = useState(!selectedId);
  const selected = organizations.find((item) => item.id === selectedId);
  const visible = organizations.filter((item) => item.name.includes(query.trim()));
  const beginSearch = (value: string) => {
    if (selectedId) onSelect(undefined);
    onQueryChange(value);
    setOpen(true);
  };
  const choose = (organization: TeachingOrganization) => {
    onSelect(organization);
    onQueryChange(organization.name);
    setOpen(false);
  };
  return <section className="organization-search-select">
    <label className="teacher-mobile-search"><Search/><input value={query} onFocus={() => setOpen(true)} onChange={(event) => beginSearch(event.target.value)} placeholder="搜索学校或机构" aria-label="搜索学校或机构"/><button type="button" aria-label="清除搜索" hidden={!query} onClick={() => beginSearch("")}><X/></button></label>
    {selected && !open ? <div className="organization-search-selected"><UserRound/><span><b>{selected.name}</b><small>已选择该机构</small></span><button type="button" onClick={() => setOpen(true)}>更换</button><button type="button" aria-label="清除已选机构" onClick={() => { onSelect(undefined); onQueryChange(""); setOpen(true); }}><X/></button></div> : <div className="organization-search-results" aria-live="polite">{busy ? <p>正在查找机构...</p> : visible.map((item) => <button type="button" key={item.id} onClick={() => choose(item)}><UserRound/><span><b>{item.name}</b><small>点击选择</small></span><ChevronRight/></button>)}{!busy && !visible.length && <p>没有找到匹配的机构。</p>}</div>}
  </section>;
}

function TeacherHeader({ title, subtitle, onBack, backLabel = "返回教师工作台" }: { title: string; subtitle?: string; onBack?: () => void; backLabel?: string }) {
  return <header className="teacher-mobile-header">
    {onBack ? <button type="button" className="teacher-mobile-icon-button" aria-label={backLabel} title={backLabel} onClick={onBack}><ChevronLeft/>{backLabel === "返回首页" && <span>返回首页</span>}</button> : <span className="teacher-mobile-header-icon"><GraduationCap/></span>}
    <div><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</div>
  </header>;
}

function teachingOrganizations(auth: TeachingAuth) {
  const memberships = (auth.user.organizations ?? []).filter((item) => ["coach", "admin"].includes(item.role));
  if (auth.user.orgId && !memberships.some((item) => item.id === auth.user.orgId)) {
    memberships.push({ id: auth.user.orgId, name: auth.user.orgName || "当前机构", role: auth.user.role, isDefault: true });
  }
  return memberships;
}

function TeacherOrganizationSelect({ auth, disabled, onChange }: { auth: TeachingAuth; disabled?: boolean; onChange(id: string): void }) {
  return <label className="teacher-mobile-org-select"><span>当前机构</span><select aria-label="当前机构" value={auth.user.orgId || ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{!auth.user.orgId && <option value="">请选择机构</option>}{teachingOrganizations(auth).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>;
}

function TeacherHome({ auth, onNavigate, onAuthChange, onExit }: { auth: TeachingAuth; onNavigate(path: string): void; onAuthChange(auth: TeachingAuth): void; onExit(): void }) {
  const [classes, setClasses] = useState<TeacherClassDto[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const requestGeneration = useRef(0);
  const refresh = async () => { const generation = ++requestGeneration.current; setBusy(true); try { const [nextClasses, nextAssignments] = await Promise.all([teachingClient.teacherClasses(auth), teachingClient.teacherAssignments(auth)]); if (generation !== requestGeneration.current) return; setClasses(nextClasses); setAssignments(nextAssignments); setError(""); } catch (reason) { if (generation === requestGeneration.current) setError(messageOf(reason)); } finally { if (generation === requestGeneration.current) setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  const drafts = assignments.filter((item) => item.status === "draft").length;
  const published = assignments.filter((item) => item.status === "published").length;
  const [orgBusy, setOrgBusy] = useState("");
  const orgLock = useRef(false);
  const [manageOrganizations, setManageOrganizations] = useState(false);
  const organizations = teachingOrganizations(auth);
  const changeOrganization = async (id: string) => { if (orgLock.current || busy || id === auth.user.orgId) return; orgLock.current = true; setOrgBusy(id); setError(""); try { onAuthChange(await teachingClient.switchOrganization(id)); } catch (reason) { setError(messageOf(reason)); } finally { orgLock.current = false; setOrgBusy(""); } };
  const leaveOrganization = async (id: string, name: string) => { if (!window.confirm(`确认退出“${name}”吗？\n\n退出后将无法管理该机构的班级和作业。`)) return; setOrgBusy(id); setError(""); try { const next = await teachingClient.leaveOrganization(id); onAuthChange(next); onNavigate(next.user.orgId ? "/teacher" : "/teacher/join-organization"); } catch (reason) { setError(messageOf(reason)); } finally { setOrgBusy(""); } };
  return <main className="teacher-mobile-page">
    <TeacherHeader title="教师工作台" subtitle={auth.user.orgName || "当前机构"} onBack={onExit} backLabel="返回首页"/>
    <TeacherOrganizationSelect auth={auth} disabled={busy || Boolean(orgBusy)} onChange={(id) => void changeOrganization(id)}/>
    <section className="teacher-mobile-identity"><UserRound/><div><strong>{auth.user.displayName}</strong><small>{auth.user.loginName} · 可管理本人负责的班级</small></div></section>
    <section className="teacher-mobile-overview"><span><b>{classes.length}</b><small>负责班级</small></span><span><b>{published}</b><small>已发布作业</small></span><span><b>{drafts}</b><small>待发布草稿</small></span></section>
    {error && <p className="teacher-mobile-error">{error}</p>}
    <section className="teacher-mobile-actions"><button type="button" className="primary" onClick={() => onNavigate("/teacher/assignments/new")}><Send/><span><b>布置作业</b><small>按题目、班级和规则分步发布</small></span><ChevronRight/></button><button type="button" onClick={() => onNavigate("/teacher/classes")}><GraduationCap/><span><b>班级与学生</b><small>创建班级、加入或创建学生</small></span><ChevronRight/></button><button type="button" onClick={() => onNavigate("/teacher/join-organization")}><UserRound/><span><b>申请加入机构</b><small>查看已提交的机构申请</small></span><ChevronRight/></button></section>
    {organizations.length > 0 && <section className="teacher-mobile-section teacher-mobile-organizations"><header><div><strong>我的任教机构</strong><small>{organizations.length} 个机构</small></div><button type="button" aria-label="管理任教机构" aria-expanded={manageOrganizations} onClick={() => setManageOrganizations(!manageOrganizations)}><UserRound/></button></header>{organizations.map((organization) => <div className="teacher-mobile-organization" key={organization.id}><span><b>{organization.name}</b><small>{organization.id === auth.user.orgId ? "当前工作机构" : "教师"}</small></span><div>{organization.id !== auth.user.orgId && <button type="button" disabled={busy || Boolean(orgBusy)} onClick={() => void changeOrganization(organization.id)}>{orgBusy === organization.id ? "切换中" : "切换"}</button>}{manageOrganizations && <button type="button" className="danger" disabled={busy || Boolean(orgBusy)} onClick={() => void leaveOrganization(organization.id, organization.name)}>{orgBusy === organization.id ? "处理中" : "退出"}</button>}</div></div>)}</section>}
    <section className="teacher-mobile-section"><header><div><strong>最近作业</strong><small>{busy ? "正在加载" : `${assignments.length} 份作业`}</small></div><button type="button" aria-label="刷新" onClick={() => void refresh()} disabled={busy}><RefreshCw className={busy ? "spinning" : undefined}/></button></header>{assignments.slice(0, 8).map((item) => <button type="button" className="teacher-mobile-row" key={item.id} onClick={() => onNavigate(`/teacher/assignments/${encodeURIComponent(item.id)}`)}><ClipboardList/><span><b>{item.title}</b><small>作业状态：{assignmentStatusLabel(item.status)} · {assignmentProgressLabel(item)} · {item.dueAt ? `截止 ${dateTime(item.dueAt)}` : "无截止"}</small></span><ChevronRight/></button>)}{!busy && !assignments.length && <p className="teacher-mobile-empty">还没有作业，先为班级创建第一份练习。</p>}</section>
  </main>;
}

function TeacherJoinOrganization({ auth, onLogout, onExit, onRelogin, onApproved }: { auth: TeachingAuth; onLogout(): void; onExit(): void; onRelogin(): void; onApproved(): Promise<void> }) {
  const [organizations, setOrganizations] = useState<TeachingOrganization[]>([]);
  const [requests, setRequests] = useState<TeachingOrganizationJoinRequest[]>([]);
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [sessionExpired, setSessionExpired] = useState(false); const [approved, setApproved] = useState<TeachingOrganizationJoinRequest>();
  const isExpired = (reason: unknown) => /登录状态已过期|没有权限|unauthorized|forbidden/i.test(messageOf(reason));
  const refresh = async (q = "") => { try { const [orgs, ownRequests] = await Promise.all([teachingClient.organizations(q), teachingClient.organizationJoinRequests()]); setOrganizations(orgs); setRequests(ownRequests); setSessionExpired(false); await Promise.all(ownRequests.filter((item) => item.status === "pending").map((item) => teachingClient.ensureOrganizationJoinStatusToken(item.id))); } catch (reason) { if (isExpired(reason)) setSessionExpired(true); throw reason; } };
  const refreshStatuses = async () => { const pending = requests.filter((item) => item.status === "pending"); if (!pending.length) return; const statuses = await Promise.all(pending.map(async (item) => [item.id, await teachingClient.organizationJoinRequestStatus(item.id)] as const)); const byId = new Map(statuses); setRequests((current) => current.map((item) => { const status = byId.get(item.id); return status ? { ...item, status: status.status } : item; })); const success = pending.find((item) => byId.get(item.id)?.status === "approved"); if (success) { setApproved({ ...success, status: "approved" }); await onApproved(); } };
  useEffect(() => { void refresh().catch((reason) => !isExpired(reason) && setError(messageOf(reason))); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(query).catch((reason) => !isExpired(reason) && setError(messageOf(reason))), 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { const timer = window.setInterval(() => void refreshStatuses().catch(() => undefined), 20_000); return () => window.clearInterval(timer); }, [requests]);
  const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!selected) return; setBusy(true); setError(""); try { await teachingClient.createOrganizationJoinRequest(selected, note.trim() || undefined); setNote(""); await refresh(query); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  return <main className={`teacher-mobile-page ${!auth.user.orgId ? "teacher-mobile-unbound-join" : ""}`}>
    <TeacherHeader title="申请加入机构" subtitle={sessionExpired ? "请重新登录后查看最新审批结果" : approved ? "申请已通过" : auth.user.orgId ? "可提交新的机构申请" : "审批通过后重新登录即可进入教师工作台"} onBack={onExit} backLabel={auth.user.orgId ? "返回教师工作台" : "返回首页"}/>
    {approved ? <section className="teacher-mobile-approved"><GraduationCap/><div><strong>{approved.orgName} 已通过</strong><small>正在更新机构权限并进入教师工作台。</small></div><button type="button" className="primary" onClick={() => void onApproved().catch((reason) => setError(messageOf(reason)))}>进入教师工作台</button></section> : sessionExpired ? <section className="teacher-mobile-expired"><LogIn/><div><strong>登录状态已更新</strong><small>正在尝试恢复安全登录会话。</small></div><button type="button" className="primary" onClick={onRelogin}>重新登录</button></section> : <><OrganizationSearchSelect organizations={organizations} query={query} selectedId={selected} busy={busy} onQueryChange={setQuery} onSelect={(organization) => setSelected(organization?.id ?? "")}/><form className="teacher-mobile-form" onSubmit={submit}><label><span>申请说明</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选，例如任教科目和班级情况"/></label><button className="primary" disabled={busy || !selected}>{busy ? "提交中..." : "提交加入申请"}</button></form></>}
    {error && !sessionExpired && <p className="teacher-mobile-error">{error}</p>}
    <section className="teacher-mobile-section"><header><div><strong>我的申请</strong></div><button type="button" aria-label="刷新审批状态" onClick={() => void (sessionExpired ? onRelogin() : refreshStatuses().catch((reason) => setError(messageOf(reason))))}><RefreshCw/></button></header>{requests.map((item) => <div className="teacher-mobile-status-row" key={item.id}><span><b>{item.orgName}</b><small>{dateTime(item.createdAt)}</small></span><strong className={item.status}>{item.status === "approved" ? "已通过，请重新登录" : item.status === "rejected" ? "已驳回" : "待审批"}</strong></div>)}{!requests.length && <p className="teacher-mobile-empty">还没有提交申请。</p>}</section>
    {!auth.user.orgId && !approved && !sessionExpired && <button type="button" className="teacher-mobile-logout" onClick={onLogout}>退出当前账号</button>}
  </main>;
}

function TeacherClasses({ onNavigate }: { onNavigate(path: string): void }) {
  const [classes, setClasses] = useState<TeacherClassDto[]>([]); const [name, setName] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState("");
  const refresh = async () => { setBusy(true); try { setClasses(await teachingClient.teacherClasses()); setError(""); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, []);
  const create = async (event: React.FormEvent) => { event.preventDefault(); if (!name.trim()) return; try { const next = await teachingClient.createTeacherClass(name.trim()); setName(""); onNavigate(`/teacher/classes/${encodeURIComponent(next.id)}`); } catch (reason) { setError(messageOf(reason)); } };
  return <main className="teacher-mobile-page"><TeacherHeader title="班级与学生" subtitle="只显示由你负责的班级" onBack={() => onNavigate("/teacher")}/>{error && <p className="teacher-mobile-error">{error}</p>}<form className="teacher-mobile-inline-form" onSubmit={create}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入新班级名称"/><button className="primary" disabled={!name.trim()}><Plus/>创建</button></form><section className="teacher-mobile-section"><header><div><strong>我的班级</strong><small>{busy ? "正在加载" : `${classes.length} 个班级`}</small></div><button type="button" aria-label="刷新" onClick={() => void refresh()}><RefreshCw/></button></header>{classes.map((item) => <button type="button" className="teacher-mobile-row" key={item.id} onClick={() => onNavigate(`/teacher/classes/${encodeURIComponent(item.id)}`)}><GraduationCap/><span><b>{item.name}</b><small>{item.studentCount} 名学生 · {item.coachCount} 位老师</small></span><ChevronRight/></button>)}{!busy && !classes.length && <p className="teacher-mobile-empty">还没有班级，创建后即可加入学生并布置作业。</p>}</section></main>;
}

function TeacherClassDetail({ classId, onNavigate }: { classId: string; onNavigate(path: string): void }) {
  const [classes, setClasses] = useState<TeacherClassDto[]>([]); const [students, setStudents] = useState<TeacherClassMember[]>([]); const [candidates, setCandidates] = useState<TeacherClassMember[]>([]);
  const [name, setName] = useState(""); const [query, setQuery] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(""); const [loginName, setLoginName] = useState(""); const [password, setPassword] = useState(""); const [created, setCreated] = useState<{ loginName: string; password: string; displayName: string }>();
  const current = classes.find((item) => item.id === classId);
  const refresh = async () => { setBusy(true); try { const [nextClasses, nextStudents] = await Promise.all([teachingClient.teacherClasses(), teachingClient.teacherClassStudents(classId)]); setClasses(nextClasses); setStudents(nextStudents); setName(nextClasses.find((item) => item.id === classId)?.name ?? ""); setError(""); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  useEffect(() => { void refresh(); }, [classId]);
  useEffect(() => { const timer = window.setTimeout(() => void teachingClient.eligibleTeacherClassStudents(classId, query).then(setCandidates).catch((reason) => setError(messageOf(reason))), 250); return () => window.clearTimeout(timer); }, [classId, query]);
  const rename = async (event: React.FormEvent) => { event.preventDefault(); try { await teachingClient.updateTeacherClass(classId, name); await refresh(); } catch (reason) { setError(messageOf(reason)); } };
  const create = async (event: React.FormEvent) => { event.preventDefault(); if (!newName.trim() || !password) return; setBusy(true); try { const user = await teachingClient.createTeacherClassStudent(classId, { displayName: newName.trim(), loginName: loginName.trim() || undefined, password }); setCreated({ loginName: user.loginName, password, displayName: user.displayName }); setNewName(""); setLoginName(""); setPassword(""); await refresh(); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } };
  const archive = async () => { if (!window.confirm("归档后班级不会再用于布置新作业，确定继续吗？")) return; try { await teachingClient.archiveTeacherClass(classId); onNavigate("/teacher/classes"); } catch (reason) { setError(messageOf(reason)); } };
  return <main className="teacher-mobile-page"><TeacherHeader title={current?.name || "班级详情"} subtitle={current ? `${current.studentCount} 名学生` : "正在加载"} onBack={() => onNavigate("/teacher/classes")}/>{error && <p className="teacher-mobile-error">{error}</p>}<form className="teacher-mobile-inline-form" onSubmit={rename}><input value={name} onChange={(event) => setName(event.target.value)} aria-label="班级名称"/><button disabled={!name.trim()}>改名</button></form><section className="teacher-mobile-section"><header><strong>班级学生</strong></header>{students.map((student) => <div className="teacher-mobile-member" key={student.id}><StudentIdentity displayName={student.displayName} loginName={student.loginName}/><button type="button" aria-label={`移除 ${student.displayName}`} onClick={() => void teachingClient.removeTeacherClassStudent(classId, student.id).then(refresh).catch((reason) => setError(messageOf(reason)))}><Trash2/></button></div>)}{!busy && !students.length && <p className="teacher-mobile-empty">班级还没有学生。</p>}</section><section className="teacher-mobile-section"><header><strong>加入已有学生</strong></header><label className="teacher-mobile-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或登录名"/></label>{candidates.map((student) => <button type="button" className="teacher-mobile-row" key={student.id} onClick={() => void teachingClient.addTeacherClassStudent(classId, student.id).then(refresh).catch((reason) => setError(messageOf(reason)))}><UserRound/><StudentIdentity displayName={student.displayName} loginName={student.loginName}/><Plus/></button>)}</section><section className="teacher-mobile-section"><header><strong>创建并加入学生</strong><small>初始密码只在当前确认页显示</small></header><form className="teacher-mobile-form" onSubmit={create}><label><span>学生姓名</span><input value={newName} onChange={(event) => setNewName(event.target.value)} required/></label><label><span>登录名（可选）</span><input value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="留空自动生成 7 位账号"/></label><label><span>初始密码</span><input type="password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required/></label><button className="primary" disabled={busy}>创建学生并加入班级</button></form>{created && <div className="teacher-mobile-credential"><strong>{created.displayName} 已加入班级</strong><span>登录名/ID：{created.loginName}</span><span>初始密码：{created.password}</span><button type="button" onClick={() => setCreated(undefined)}>我已记录</button></div>}</section><button type="button" className="teacher-mobile-archive" onClick={() => void archive()}>归档这个班级</button></main>;
}

function TeacherAssignmentWizard({ auth, onNavigate, onAuthChange }: { auth: TeachingAuth; onNavigate(path: string): void; onAuthChange(auth: TeachingAuth): void }) {
  const [step, setStep] = useState(1); const [folders, setFolders] = useState<TeacherFolder[]>([]); const [libraries, setLibraries] = useState<TeacherProblemLibrary[]>([]); const [classes, setClasses] = useState<TeacherClassDto[]>([]); const [students, setStudents] = useState<TeacherClassMember[]>([]);
  const [draft, setDraft] = useState<AssignmentDraft>(EMPTY_DRAFT); const [selection, setSelection] = useState<AssignmentSelection>(EMPTY_SELECTION); const [activeLibraryId, setActiveLibraryId] = useState(""); const [folderId, setFolderId] = useState(""); const [query, setQuery] = useState(""); const [problems, setProblems] = useState<TeacherProblem[]>([]);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(""); const [error, setError] = useState(""); const [mergedDuplicateCount, setMergedDuplicateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [problemCount, setProblemCount] = useState(0);
  const [problemsLoading, setProblemsLoading] = useState(false);
  const [problemError, setProblemError] = useState("");
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof buildBatchPlans>>>();
  const operationLock = useRef(false);
  const scope = `${auth.user.id}:${auth.user.orgId}`;
  const previousScope = useRef(scope);
  const navigationComplete = useRef(false);
  const selectionGeneration = useRef(0);
  type Submission = { context: TeachingAuth; publishNow: boolean; uncertain: boolean; jobs: Array<{ body: Record<string, unknown>; id?: string; done: boolean }> };
  const submission = useRef<Submission | undefined>(undefined);
  const [submissionProgress, setSubmissionProgress] = useState<{ completed: number; total: number; ids: string[]; uncertain: boolean; publishNow: boolean }>();
  const selectedCount = selectionCount(selection, libraries); const hasTargets = draft.classIds.length > 0 || draft.studentIds.length > 0;
  useEffect(() => {
    let cancelled = false;
    selectionGeneration.current++;
    if (previousScope.current !== scope) {
      previousScope.current = scope;
      setDraft((current) => ({ ...current, classIds: [], studentIds: [] }));
      setSelection(EMPTY_SELECTION); setFolderId(""); setQuery(""); setStep(1);
      submission.current = undefined; setSubmissionProgress(undefined);
    }
    setPrepared(undefined); setFolders([]); setLibraries([]); setClasses([]); setStudents([]);
    setActiveLibraryId(""); setProblems([]); setProblemCount(0); setMergedDuplicateCount(0);
    setLoading(true); setLoadFailed(false); setError("");
    void (async () => {
      try {
        const [nextFolders, nextLibraries, nextClasses] = await Promise.all([
          teachingClient.teacherFolderTree(auth), teachingClient.teacherProblemLibraries("", auth), teachingClient.teacherClasses(auth),
        ]);
        const memberLists = await Promise.all(nextClasses.map((item) => teachingClient.teacherClassStudents(item.id, auth)));
        if (cancelled) return;
        const deduped = dedupeTeacherLibraries(nextLibraries.filter((item) => item.reviewStatus === "published"), auth.user.orgId);
        setFolders(nextFolders); setLibraries(deduped.items); setMergedDuplicateCount(deduped.mergedDuplicateCount);
        setClasses(nextClasses); setStudents([...new Map(memberLists.flat().map((item) => [item.id, item])).values()]);
        setActiveLibraryId(deduped.items[0]?.id || "");
      } catch (reason) { if (!cancelled) { setError(messageOf(reason)); setLoadFailed(true); } }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; selectionGeneration.current++; };
  }, [scope, reload]);
  useEffect(() => {
    let cancelled = false;
    setProblems([]); setProblemCount(0); setProblemError("");
    if (!activeLibraryId) { setProblemsLoading(false); return; }
    setProblemsLoading(true);
    void teachingClient.teacherProblems(activeLibraryId, { q: query, limit: 50 }, auth).then((page) => {
      if (!cancelled) { setProblems(page.items); setProblemCount(page.totalCount ?? page.items.length); }
    }).catch((reason) => { if (!cancelled) setProblemError(messageOf(reason)); })
      .finally(() => { if (!cancelled) setProblemsLoading(false); });
    return () => { cancelled = true; };
  }, [scope, activeLibraryId, query, reload]);
  useEffect(() => { setPrepared(undefined); }, [selection, draft.title, draft.batchMode, draft.batchSize, draft.batchCount]);
  const dirty = Boolean(draft.title || draft.description || selectedCount || hasTargets || draft.dueAt || draft.timeLimitMinutes || draft.maxAttempts !== "0" || draft.allowAnswer || draft.randomizeItems || draft.batchMode !== "none");
  const leave = () => onNavigate("/teacher");
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!navigationComplete.current && (dirty || submission.current)) { event.preventDefault(); event.returnValue = ""; } };
    const beforeNavigation = (event: Event) => {
      if (navigationComplete.current || (event as CustomEvent<{ nextPath: string }>).detail.nextPath === "/teacher/assignments/new") return;
      if (operationLock.current || ((dirty || submission.current) && !window.confirm(submission.current ? "离开后不再保留当前批次续跑状态。已创建的作业仍在工作台，确定返回？" : "作业尚未保存，确定返回教师工作台？"))) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("qixi-teacher-before-navigation", beforeNavigation);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("qixi-teacher-before-navigation", beforeNavigation); };
  }, [dirty]);
  const changeOrganization = async (id: string) => {
    if (operationLock.current || loading || id === auth.user.orgId || submission.current) return;
    if (dirty && !window.confirm("切换机构后将清除已选题目、班级和学生，保留标题、说明及作业规则。确定切换？")) return;
    operationLock.current = true; setSwitching(true); setError("");
    try { onAuthChange(await teachingClient.switchOrganization(id)); }
    catch (reason) { setError(messageOf(reason)); }
    finally { operationLock.current = false; setSwitching(false); }
  };
  const next = async () => {
    if (operationLock.current || loading || loadFailed) return;
    setError("");
    if (step === 1 && !auth.user.orgId) return setError("请先选择学校或机构");
    if (step === 2) {
      if (!draft.title.trim() || !selectedCount) return setError(!draft.title.trim() ? "请输入作业标题" : "请至少选择一道题目");
      operationLock.current = true; setBusy(true); setProgress("正在核对完整题目与分批结果");
      try {
        const result = await buildBatchPlans(selection, libraries, draft, auth);
        if (!result.plans.length) throw new Error("没有可布置的已发布有效题目");
        setPrepared(result); setStep(3);
      } catch (reason) { setError(messageOf(reason)); }
      finally { operationLock.current = false; setBusy(false); setProgress(""); }
      return;
    }
    if (step === 3 && !hasTargets) return setError("请至少选择一个班级或学生");
    setStep((value) => Math.min(4, value + 1));
  };
  const toggleLibrary = (libraryId: string) => setSelection((current) => ({ libraryIds: current.libraryIds.includes(libraryId) ? current.libraryIds.filter((id) => id !== libraryId) : [...current.libraryIds, libraryId], problems: current.problems.filter((problem) => problem.libraryId !== libraryId), filters: current.filters.filter((filter) => filter.libraryId !== libraryId) }));
  const toggleProblem = (problem: TeacherProblem) => setSelection((current) => current.libraryIds.includes(problem.libraryId) || current.filters.some((filter) => filter.libraryId === problem.libraryId) ? current : { ...current, problems: current.problems.some((item) => item.id === problem.id) ? current.problems.filter((item) => item.id !== problem.id) : [...current.problems, problem] });
  const selectSearch = async () => {
    if (!activeLibraryId || operationLock.current || problemsLoading || problemError) return;
    if (!query.trim()) { toggleLibrary(activeLibraryId); return; }
    operationLock.current = true; setBusy(true); setError("");
    const generation = selectionGeneration.current;
    try {
      const count = uniqueProblems(await allProblems(activeLibraryId, query.trim(), auth)).length;
      if (generation !== selectionGeneration.current) return;
      setSelection((current) => ({ libraryIds: current.libraryIds.filter((id) => id !== activeLibraryId), problems: current.problems.filter((problem) => problem.libraryId !== activeLibraryId), filters: [...current.filters.filter((filter) => filter.libraryId !== activeLibraryId), { libraryId: activeLibraryId, q: query.trim(), count, label: `${libraries.find((item) => item.id === activeLibraryId)?.title || "题库"} 搜索“${query.trim()}”` }] }));
    } catch (reason) { setError(messageOf(reason)); }
    finally { operationLock.current = false; setBusy(false); }
  };
  const save = async (publishNow: boolean) => {
    if (operationLock.current || loading || loadFailed || !draft.title.trim() || !selectedCount || !hasTargets) return;
    if (draft.classIds.some((id) => !classes.some((item) => item.id === id)) || draft.studentIds.some((id) => !students.some((item) => item.id === id))) return setError("班级或学生不属于当前任教范围，请重新选择。");
    if (submission.current?.uncertain) return setError("上一批创建结果未确认，请返回工作台核实，不能自动重建。");
    if (submission.current && submission.current.publishNow !== publishNow) return;
    operationLock.current = true;
    setBusy(true); setError("");
    const updateSubmission = () => {
      const job = submission.current;
      if (job) setSubmissionProgress({ completed: job.jobs.filter((item) => item.done).length, total: job.jobs.length, ids: job.jobs.flatMap((item) => item.id ? [item.id] : []), uncertain: job.uncertain, publishNow: job.publishNow });
    };
    try {
      if (!submission.current) {
        if (!prepared?.plans.length) throw new Error("请返回题目步骤重新核对分批结果。");
        const common = { description: draft.description, classIds: draft.classIds, studentIds: draft.studentIds, dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null, timeLimitSeconds: draft.timeLimitMinutes ? Number(draft.timeLimitMinutes) * 60 : null, maxAttempts: Number(draft.maxAttempts) || 0, allowAnswer: draft.allowAnswer, randomizeItems: draft.randomizeItems, publishNow: false, allowDuplicate: false };
        submission.current = { context: auth, publishNow, uncertain: false, jobs: prepared.plans.map((plan) => ({ body: { ...common, title: plan.title, libraryIds: [], problemIds: plan.problemIds, problemSelections: [] }, done: false })) };
      }
      const run = submission.current;
      updateSubmission();
      for (const [index, job] of run.jobs.entries()) {
        if (job.done) continue;
        setProgress(`正在处理第 ${index + 1}/${run.jobs.length} 批`);
        if (!job.id) {
          try {
            const created = await teachingClient.createTeacherAdminAssignment(job.body, run.context);
            job.id = created.id;
            if (!job.id) throw new Error("服务器未返回作业编号");
          } catch (reason) { run.uncertain = true; throw reason; }
          updateSubmission();
        }
        if (run.publishNow) {
          try { await teachingClient.publishTeacherAssignment(job.id, false, run.context); }
          catch (reason) {
            const text = messageOf(reason);
            if (!text.includes("发现重复题目") || !window.confirm(`${String(job.body.title)}\n${text}\n\n仍要继续发布吗？`)) throw reason;
            await teachingClient.publishTeacherAssignment(job.id, true, run.context);
          }
        }
        job.done = true; updateSubmission();
      }
      submission.current = undefined;
      navigationComplete.current = true;
      onNavigate("/teacher");
    } catch (reason) {
      updateSubmission();
      const run = submission.current;
      setError(`${run ? `已完成 ${run.jobs.filter((item) => item.done).length}/${run.jobs.length} 批；` : ""}${messageOf(reason)}${run?.uncertain ? "。创建结果未确认，请返回工作台核实，勿重复布置。" : "。可继续处理，已创建草稿不会重复生成。"}`);
    } finally {
      operationLock.current = false; setBusy(false); setProgress("");
    }
  };
  const visibleLibraries = libraries.filter((item) => !folderId || item.folderId === folderId);
  const locked = busy || switching || loading || loadFailed || Boolean(submissionProgress);
  const selectedGroups = [...selection.libraryIds.map((id) => ({ label: libraries.find((item) => item.id === id)?.title || "题库", count: libraries.find((item) => item.id === id)?.publishedCount || 0 })), ...selection.filters.map((item) => ({ label: item.label, count: item.count })), ...[...new Set(selection.problems.map((item) => item.libraryId))].map((id) => ({ label: `${libraries.find((item) => item.id === id)?.title || "题库"} 自选题`, count: selection.problems.filter((item) => item.libraryId === id).length }))];
  const batchValue = draft.batchMode === "count" ? draft.batchCount : draft.batchSize;
  const validBatch = draft.batchMode === "none" || Number.isInteger(batchValue) && batchValue >= 1 && batchValue <= 10000;
  const estimatedBatches = draft.batchMode === "none" ? selectedCount ? 1 : 0 : validBatch ? selectedGroups.reduce((sum, item) => sum + (draft.batchMode === "count" ? Math.min(item.count, draft.batchCount) : Math.ceil(item.count / draft.batchSize)), 0) : 0;
  return <main className="teacher-mobile-page teacher-mobile-wizard">
    <TeacherHeader title="布置作业" subtitle={`第 ${step}/4 步 · ${auth.user.orgName || "未选择机构"}`} onBack={leave}/>
    <TeacherOrganizationSelect auth={auth} disabled={locked} onChange={(id) => void changeOrganization(id)}/>
    {loading && <p className="teacher-mobile-progress" role="status">正在加载当前机构</p>}
    {error && <p className="teacher-mobile-error" role="alert">{error}</p>}
    {loadFailed && <button type="button" onClick={() => setReload((value) => value + 1)}>重试加载机构</button>}
    {progress && <p className="teacher-mobile-progress" role="status">{progress}</p>}
    {submissionProgress && <section className="teacher-mobile-submission" aria-live="polite">
      <strong>已完成 {submissionProgress.completed}/{submissionProgress.total} 批</strong>
      <small>已创建 {submissionProgress.ids.length} 份作业，编号：{submissionProgress.ids.join("、") || "无"}</small>
      {submissionProgress.uncertain && <small>创建结果未确认，请返回工作台核实。</small>}
    </section>}
    <fieldset className="teacher-mobile-wizard-fields" disabled={locked}>
      <nav className="teacher-mobile-stepper" aria-label="作业步骤">
        {["机构", "题目", "学生", "发布"].map((label, index) => <button type="button" key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} disabled={index + 1 > step} onClick={() => setStep(index + 1)}><b>{index + 1}</b><span>{label}</span></button>)}
      </nav>
      {step === 1 && <section className="teacher-mobile-step">
        <h2>确认布置机构</h2>
        <div className="teacher-mobile-scope"><GraduationCap/><span><b>{auth.user.orgName || "尚未绑定机构"}</b><small>仅限本人负责的班级及学生</small></span></div>
      </section>}
      {step === 2 && <section className="teacher-mobile-step">
        <h2>选择作业题目</h2>
        <label><span>作业标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：中局杀法训练"/></label>
        <label><span>作业说明（可选）</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/></label>
        <label><span>目录</span><select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">全部目录</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.path || folder.name}</option>)}</select></label>
        <div className="teacher-mobile-library-picker">{visibleLibraries.map((library) => <button type="button" key={library.id} className={activeLibraryId === library.id ? "active" : ""} onClick={() => { setActiveLibraryId(library.id); setQuery(""); }}><BookOpen/><span><b>{library.title}</b><small>{library.publishedCount} 题 · {librarySourceLabel(library, auth.user.orgId)}{library.accessTier === "vip" ? " · VIP" : ""}</small></span>{selection.libraryIds.includes(library.id) && <i>整库</i>}</button>)}</div>
        {mergedDuplicateCount > 0 && <p className="teacher-mobile-merge-note">已合并 {mergedDuplicateCount} 个公共库重复项。</p>}
        {activeLibraryId && <>
          <label className="teacher-mobile-search"><Search/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前题库" aria-label="搜索当前题库"/></label>
          {problemsLoading && <p role="status">正在加载题目</p>}
          {problemError && <p className="teacher-mobile-error" role="alert">{problemError}</p>}
          <button type="button" className="teacher-mobile-select-all" disabled={problemsLoading || Boolean(problemError)} onClick={() => void selectSearch()}>{query ? `选择当前搜索结果（${problemCount} 题）` : selection.libraryIds.includes(activeLibraryId) ? "取消整库选择" : "选择整个题库"}</button>
          <div className="teacher-mobile-problem-picker">{problems.map((problem) => <label key={problem.id}><input type="checkbox" disabled={selection.libraryIds.includes(problem.libraryId) || selection.filters.some((filter) => filter.libraryId === problem.libraryId)} checked={selection.problems.some((item) => item.id === problem.id)} onChange={() => toggleProblem(problem)}/><span><b>第 {problem.sourceIndex + 1} 题 · {problem.title}</b><small>{problem.category || "未分类"}{problem.accessTier === "vip" ? " · VIP" : ""}</small></span></label>)}</div>
        </>}
        <div className="teacher-mobile-batch">
          <b>分批布置</b>
          <div>
            <label><input type="radio" name="batchMode" checked={draft.batchMode === "none"} onChange={() => setDraft({ ...draft, batchMode: "none" })}/>不分批</label>
            {[50, 100].map((size) => <label key={size}><input type="radio" name="batchMode" checked={draft.batchMode === "preset" && draft.batchSize === size} onChange={() => setDraft({ ...draft, batchMode: "preset", batchSize: size })}/>每{size}题</label>)}
            <label><input type="radio" name="batchMode" checked={draft.batchMode === "size"} onChange={() => setDraft({ ...draft, batchMode: "size", batchSize: 20 })}/>自定义题数</label>
            <label><input type="radio" name="batchMode" checked={draft.batchMode === "count"} onChange={() => setDraft({ ...draft, batchMode: "count" })}/>按批次数</label>
          </div>
          {draft.batchMode === "size" && <label className="teacher-mobile-batch-number"><span>每批题数</span><input aria-label="每批题数" type="number" inputMode="numeric" min="1" max="10000" step="1" value={draft.batchSize || ""} onChange={(event) => setDraft({ ...draft, batchSize: Number(event.target.value) })}/><span>题</span></label>}
          {draft.batchMode === "count" && <label className="teacher-mobile-batch-number"><span>每组批次数</span><input aria-label="批次数" type="number" inputMode="numeric" min="1" max="10000" step="1" value={draft.batchCount || ""} onChange={(event) => setDraft({ ...draft, batchCount: Number(event.target.value) })}/><span>批</span></label>}
          {!validBatch ? <small className="teacher-mobile-error">请输入 1–10000 的整数</small> : <small>{draft.batchMode === "none" ? "合并去重，生成一份作业" : `按题库独立分批，预计最多生成 ${estimatedBatches} 份作业`}</small>}
          {selectedGroups.map((item, index) => <small key={index}>{item.label}：{item.count} 题</small>)}
        </div>
        <p className="teacher-mobile-selection-summary">已选择 {selectedCount} 题</p>
      </section>}
      {step === 3 && <section className="teacher-mobile-step">
        <h2>选择班级和学生</h2>
        <div className="teacher-mobile-choice-list"><b>班级（可多选）</b>{classes.map((item) => <label key={item.id}><input type="checkbox" checked={draft.classIds.includes(item.id)} onChange={(event) => setDraft({ ...draft, classIds: event.target.checked ? [...draft.classIds, item.id] : draft.classIds.filter((id) => id !== item.id) })}/><span>{item.name}<small>{item.studentCount} 名学生</small></span></label>)}{!classes.length && <p className="teacher-mobile-empty">当前机构没有由你负责的班级</p>}</div>
        <div className="teacher-mobile-choice-list"><b>个别学生（可选）</b>{students.map((item) => <label key={item.id}><input type="checkbox" checked={draft.studentIds.includes(item.id)} onChange={(event) => setDraft({ ...draft, studentIds: event.target.checked ? [...draft.studentIds, item.id] : draft.studentIds.filter((id) => id !== item.id) })}/><span>{item.displayName}<small>{item.loginName}</small></span></label>)}</div>
        <p className="teacher-mobile-selection-summary">已选择 {draft.classIds.length} 个班级、{draft.studentIds.length} 名学生</p>
      </section>}
      {step === 4 && <section className="teacher-mobile-step">
        <h2>发布设置</h2>
        <label><span>截止时间</span><input type="datetime-local" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}/></label>
        <div className="teacher-mobile-number-grid">
          <label><span>限时（分钟）</span><input type="number" min="0" value={draft.timeLimitMinutes} onChange={(event) => setDraft({ ...draft, timeLimitMinutes: event.target.value })}/></label>
          <label><span>尝试次数（0 不限）</span><input type="number" min="0" value={draft.maxAttempts} onChange={(event) => setDraft({ ...draft, maxAttempts: event.target.value })}/></label>
        </div>
        <label className="teacher-mobile-toggle"><input type="checkbox" checked={draft.allowAnswer} onChange={(event) => setDraft({ ...draft, allowAnswer: event.target.checked })}/>允许查看答案</label>
        <label className="teacher-mobile-toggle"><input type="checkbox" checked={draft.randomizeItems} onChange={(event) => setDraft({ ...draft, randomizeItems: event.target.checked })}/>随机题目顺序</label>
        <div className="teacher-mobile-preview">
          <b>{draft.title || "未填写标题"}</b>
          <strong>所属机构：{auth.user.orgName}</strong>
          <small>{prepared?.count ?? selectedCount} 题 · {draft.classIds.length} 个班级 · {draft.studentIds.length} 名学生</small>
          <small>核对后生成 {prepared?.plans.length ?? 0} 份作业</small>
          {prepared?.groups.map((item, index) => <small key={index}>{item.label}：{item.count} 题{draft.batchMode !== "none" && ` · ${item.batches} 批`}</small>)}
        </div>
      </section>}
    </fieldset>
    <footer className="teacher-mobile-wizard-footer">
      {step > 1 ? <button type="button" disabled={locked} onClick={() => setStep(step - 1)}>上一步</button> : <span/>}
      {step < 4 ? <button type="button" className="primary" disabled={locked || (step === 2 && !validBatch)} onClick={() => void next()}>下一步<ChevronRight/></button> : <div>
        <button type="button" disabled={busy || loading || switching || loadFailed || Boolean(submissionProgress?.publishNow) || Boolean(submissionProgress?.uncertain)} onClick={() => void save(false)}><FileArchive/>{submissionProgress ? "继续保存" : "保存草稿"}</button>
        <button type="button" className="primary" disabled={busy || loading || switching || loadFailed || (submissionProgress && !submissionProgress.publishNow) || Boolean(submissionProgress?.uncertain)} onClick={() => void save(true)}><Send/>{submissionProgress ? "继续发布" : "立即发布"}</button>
      </div>}
    </footer>
  </main>;
}

function TeacherAssignmentDetail({ assignmentId, onNavigate, renderResultBoard }: { assignmentId: string; onNavigate(path: string): void; renderResultBoard?: ResultBoardRenderer }) {
  const [assignment, setAssignment] = useState<TeachingAssignment>(); const [results, setResults] = useState<TeacherAssignmentResult[]>([]); const [error, setError] = useState(""); const [busy, setBusy] = useState(true);
  const [summary, setSummary] = useState<TeacherAssignmentSummary>();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = async () => {
    const request = ++generation.current; setBusy(true); setError("");
    try {
      const [items, nextResults, nextSummary] = await Promise.all([teachingClient.teacherAssignments(), teachingClient.teacherAssignmentResults(assignmentId), teachingClient.teacherAssignmentSummary(assignmentId)]);
      if (request !== generation.current) return;
      const nextAssignment = items.find((item) => item.id === assignmentId);
      if (!nextAssignment) throw new Error("这份作业已移除，或不属于当前机构，请返回作业列表。");
      setAssignment(nextAssignment); setResults(nextResults); setSummary(nextSummary); setRevision((value) => value + 1);
    } catch (reason) { if (request === generation.current) setError(messageOf(reason)); }
    finally { if (request === generation.current) setBusy(false); }
  };
  useEffect(() => { setAssignment(undefined); setResults([]); setSummary(undefined); void refresh(); return () => { ++generation.current; }; }, [assignmentId]);
  const publish = async () => { if (!assignment || !window.confirm(`发布“${assignment.title}”并固定当前学生名单？`)) return; try { await teachingClient.publishTeacherAssignment(assignment.id); await refresh(); } catch (reason) { const text = messageOf(reason); if (text.includes("发现重复题目") && window.confirm(`${text}\n\n仍要继续发布吗？`)) { try { await teachingClient.publishTeacherAssignment(assignment.id, true); await refresh(); } catch (retry) { setError(messageOf(retry)); } } else setError(text); } };
  return <main className="teacher-mobile-page teacher-assignment-detail" aria-busy={busy}>
    <div className="teacher-detail-toolbar"><TeacherHeader title={assignment?.title || "作业详情"} subtitle={assignment ? `${assignment.itemCount} 题 · ${assignmentStatusLabel(assignment.status)}` : busy ? "正在读取作业与成绩" : "成绩未加载"} onBack={() => onNavigate("/teacher")}/>
      <button type="button" className="teacher-detail-refresh" disabled={busy} onClick={() => void refresh()}><RefreshCw className={busy ? "is-loading" : ""}/>{busy ? "加载中" : error ? "重试加载" : "刷新结果"}</button>
    </div>
    {error && <section role="alert" className="teacher-result-error"><strong>暂时无法读取作业结果</strong><p>{error.includes("404") ? "结果接口暂未就绪，或这份作业已不可访问。请重试，或返回作业列表。" : error}</p>{summary && <small>以下是上次加载的结果，本次刷新未成功。</small>}</section>}
    {busy && !summary && <p role="status" className="teacher-result-loading">正在加载学生名单和成绩…</p>}
    {assignment?.status === "draft" && <><p className="teacher-mobile-draft-note">这份作业还未发布，学生端不会同步。</p><button type="button" className="teacher-mobile-publish" disabled={busy} onClick={() => void publish()}><Send/>发布作业</button></>}
    {summary && <TeacherResults revision={revision} assignmentId={assignmentId} students={results} summary={summary} renderBoard={renderResultBoard}/>}
  </main>;
}
