import { measureActiveOpening } from "./PracticeOpeningStatus";
import { canBrowsePlatformSources, hasActiveCatalogVip } from "./catalogAccess";
import { teachingRead } from "./teachingDeadline";
import { mergePracticeAttempts, mergePracticeDrafts, type PracticeDraft } from "./practiceProgress";
import { withRequestDeadline } from "./requestDeadline";
import type { VerificationResult } from "../../../packages/training-verification/types";
import { makeCheckinApi } from "./checkinApi";
import { ContentEpochTracker, belongsToContentScope } from "./contentEpoch";
import type { CatalogProblem, TeachingCatalogNode, TrainingGoal } from "./TeachingCatalog";
import type { LocalManualAnalysisSummary, LocalManualFolder, LocalManualGame, SolutionMove, TrainingLibrary, TrainingProblem } from "./types";
import { isNativeSessionStore, secureSession } from "./secureSession";
import { environmentServerUrl, packageEnvironment, selectEnvironment, selectedEnvironment, type AppEnvironment } from "./appEnvironment";
import { practiceScore } from "./practiceScoring";
import { buildPersonalManualSyncRecords, type PersonalManualSyncKind } from "./providerMirrors";

const AUTH_KEY = "xiangqi-teaching-auth";
const SERVER_KEY = "xiangqi-teaching-server-url";
const SESSION_SERVER_KEY = "xiangqi-teaching-session-server";
const LAST_LOGIN_ACCOUNT_PREFIX = "xiangqi-teaching-last-login-account";

function rememberLoginAccount(account: string, targetServer: string) {
  try { localStorage.setItem(`${LAST_LOGIN_ACCOUNT_PREFIX}:${targetServer}`, account.trim()); }
  catch { /* Account autofill is optional when storage is unavailable. */ }
}
const DB_NAME = "xiangqi-teaching-cache";
const DB_VERSION = 7;
const SYNC_META_PREFIX = "xiangqi-teaching-sync";
const JOIN_STATUS_PREFIX = "xiangqi-organization-join-status";
const VIP_ACCESS_MESSAGE = "作业权益已过期或未开通，请联系老师或管理员续期。";
let lastSubmitError = "";
const contentEpochs = new ContentEpochTracker({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
const epochProbes = new Map<string, Promise<boolean>>();
async function ensureContentEpoch(context: AuthContext): Promise<boolean> {
  const key = `${context.serverUrl}:${context.ownerId}:${context.epoch}`;
  const existing = epochProbes.get(key);
  if (existing) return existing;
  const pending = teachingRead(async signal => {
    const response = await fetch(`${context.serverUrl}/api/v1/capabilities`, { signal, headers: { "x-xiangqi-app-id": appId() }, credentials: "include" });
    if (response.status === 404) return false; // Older servers have no reset marker.
    if (!response.ok) throw new Error(userFacingError(undefined, response.status));
    const body = await response.json() as { contentEpoch?: string };
    if (signal.aborted) throw new DOMException("读取已取消", "AbortError");
    const epoch = typeof body.contentEpoch === "string" && /^[0-9a-f-]{36}$/i.test(body.contentEpoch) ? body.contentEpoch : undefined;
    return contentEpochs.observe(context, epoch, () => purgeTeachingContent(context), () => isCurrentAuthContext(context));
  });
  epochProbes.set(key, pending);
  try { return await pending; }
  finally { if (epochProbes.get(key) === pending) epochProbes.delete(key); }
}
async function purgeTeachingContent(context: AuthContext) {
  window.dispatchEvent(new Event("teaching-content-reset"));
  const db = await openDb();
  const names = ["assignments", "assignmentCaches", "attempts", "practiceAttempts", "assignmentViews", "assignmentDrafts", "assignmentAnswers", "practiceSessions", "practiceDrafts"];
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(names, "readwrite");
      for (const name of names) {
        const cursor = transaction.objectStore(name).openCursor();
        cursor.onsuccess = () => { const item = cursor.result; if (!item) return; if (belongsToContentScope(item.value, context)) item.delete(); item.continue(); };
      }
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("题库缓存清理失败"));
      transaction.onerror = () => reject(transaction.error);
    });
    const prefix = `${SYNC_META_PREFIX}:${encodeURIComponent(context.serverUrl)}:${context.ownerId}:`;
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } finally { db.close(); }
}
let activeAuth: TeachingAuth | undefined;
type RefreshFlight = {controller: AbortController; consumers: number; promise: Promise<TeachingAuth | undefined>};
let refreshInFlight: RefreshFlight | undefined;
let sessionEpoch = 0;
// Only concurrent reads are shared; results are never cached as eligibility evidence.
const platformReads = new Map<string, Promise<unknown>>();
function sharePlatformRead<T>(name:string,auth:TeachingAuth,load:()=>Promise<T>):Promise<T> {
  const key=JSON.stringify([serverUrl(),sessionEpoch,auth.user.id,auth.user.orgId,hasActiveCatalogVip(auth),name]);
  const current=platformReads.get(key);if(current)return current as Promise<T>;
  const pending=load().finally(()=>{if(platformReads.get(key)===pending)platformReads.delete(key);});
  platformReads.set(key,pending);return pending;
}
const topicDisplays = new Map<string, {at:number; detail:PracticeTopicDetail}>();
const assignmentSubmissionLocks = new Set<string>();
const assignmentAttemptRequests = new Map<string, Promise<boolean>>();
type AuthContext = { ownerId: string; orgId: string; serverUrl: string; epoch: number };
const authContexts = new WeakMap<TeachingAuth, AuthContext>();
const tokenContexts = new Map<string, AuthContext>();

function rememberAuth(auth: TeachingAuth, epoch = sessionEpoch, targetServer = serverUrl()) {
  const context = { ownerId: auth.user.id, orgId: auth.user.orgId || "default", serverUrl: targetServer, epoch };
  authContexts.set(auth, context);
  tokenContexts.set(auth.token, context);
}

function isCurrentAuthContext(context: AuthContext) {
  return context.epoch === sessionEpoch && context.serverUrl === serverUrl()
    && context.ownerId === activeAuth?.user.id && context.orgId === (activeAuth?.user.orgId || "default");
}

async function clearLocalSession() {
  sessionEpoch += 1;
  platformReads.clear();
  window.dispatchEvent(new Event("teaching-content-reset"));
  activeAuth = undefined;
  refreshInFlight?.controller.abort();
  refreshInFlight = undefined;
  tokenContexts.clear();
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(SESSION_SERVER_KEY);
  await secureSession.clear();
}

export type TeachingOrganization = {
  id: string;
  name: string;
  role: "admin" | "coach" | "student" | "user";
  isDefault: boolean;
};
export type TeachingUser = {
  id: string;
  orgId?: string;
  orgName?: string;
  loginName: string;
  email?: string | null;
  displayName: string;
  role: "admin" | "coach" | "student" | "user";
  isPlatformAdmin?: boolean;
  vipEnabled?: boolean;
  vipExpiresAt?: string | null;
  vipActive?: boolean;
  organizations?: TeachingOrganization[];
};

export type TeachingAuth = { token: string; expiresAt: string; user: TeachingUser; refreshToken?: string };
export type PracticeProblem = {
  trainingGoal?: TrainingGoal | null;
  targetMateMoves?: number;
  id: string;
  libraryId: string;
  sourceIndex: number;
  title: string;
  category: string;
  accessTier: "public" | "vip" | "vip_or_assignment";
  startingFen: string;
  difficulty?: number | null;
  sideToMove: string;
  solutionLength: number;
  note: string;
  solution: SolutionMove[];
  active: boolean;
};
export type PracticeGrade = { score: number; stars: number; attemptNumber: number; firstTryCorrect: boolean; mistakes: number; hintsUsed: number };
export type PracticeSessionItem = {
  localDraftRevision?: string;
  verificationState?: "pending_server"; id: string; ordinal: number; status: "pending" | "completed" | "revealed" | "abandoned"; problem: PracticeProblem; grade?: PracticeGrade; draft?: { verification?: VerificationResult; verificationContent?: string; moves?: string[]; hints?: number; mistakes?: number; elapsedMs?: number } };
export type PracticeSession = {
  id: string;
  sourceKind: string;
  originTopicId?: string | null;
  originDailyPlanId?: string | null;
  originAssignmentId?: string | null;
  mode: "solver" | "learning";
  status: "active" | "completed";
  currentItemId?: string | null;
  startedAt: string;
  updatedAt: string;
  items: PracticeSessionItem[];
};
export type PracticeTopic = { id: string; name: string; description: string; contentKind: "problem" | "game"; coverFen?: string | null; itemCount: number; sources: Array<{ libraryId: string; category?: string | null }> };
export type LockedPracticeTopic = { id: string; name: string; contentKind: "problem" | "game"; itemCount: number };
export type PracticeDailyPlan = { id: string; topic: PracticeTopic; itemCount: 5 | 10 | 20; mode: "solver" | "learning"; startedSessionId?: string | null };
export type PracticeHistory = { localDate: string; completedCount: number; correctCount: number; sessionId: string };
export type PracticeDashboardSummary = {
  streakDays: number;
  todayProgress?: { plannedCount: number; completedCount: number; correctCount: number } | null;
};
export type PracticeTopicChapter = {
  libraryId: string;
  title: string;
  category?: string | null;
  itemCount: number;
  completedCount: number;
  coverFen?: string | null;
};
export type PracticeTopicDetail = { topic: PracticeTopic; chapters: PracticeTopicChapter[] };
export type PracticeSearchResult = { items: PracticeProblem[]; nextCursor?: number | null };
export type PracticeSearchQuery = {
  q?: string;
  category?: string;
  difficulty?: number;
  sideToMove?: "red" | "black";
  libraryId?: string;
  cursor?: number;
  limit?: number;
};
export type PracticeHome = {
  studentLocalImportEnabled?: boolean;
  resumeSession?: PracticeSession | null;
  pendingAssignmentCount: number;
  wrongCount: number;
  favoriteCount: number;
  topics: PracticeTopic[];
  studyTopics: PracticeTopic[];
  lockedTopics?: LockedPracticeTopic[];
  dailyPlan?: PracticeDailyPlan | null;
  history: PracticeHistory[];
  summary?: PracticeDashboardSummary;
};
export type PracticeReviewProblem = { problem: PracticeProblem; reviewState: "pending" | "mastered"; totalAttempts: number; errorAttempts: number; lastHintsUsed: number };
export type CreatePracticeSession = {
  sourceKind?: "topic" | "daily" | "mistakes" | "favorites" | "random";
  scope?: "all" | "unpracticed" | "mistakes" | "favorites" | "random";
  mode?: "solver" | "learning";
  libraryIds?: string[];
  problemIds?: string[];
  topicId?: string;
  category?: string;
  difficulty?: number;
  count?: number;
};
export type PracticeAttempt = { itemId: string; elapsedMs: number; hintsUsed: number; mistakes: number; outcome: "completed" | "revealed" | "abandoned"; clientAttemptId: string; moves: string[] };
type PendingPracticeAttempt = PracticeAttempt & {
  queuedRevision?: string;
  sessionId: string;
  ownerId?: string;
  contentEpoch?: string;
  orgId?: string;
  serverUrl?: string;
};
export type TeachingOrganizationJoinRequest = {
  id: string;
  orgId: string;
  orgName: string;
  applicantId?: string;
  applicantRole?: "admin" | "coach" | "student" | "user";
  applicantLoginName?: string;
  applicantDisplayName?: string;
  teacherDisplayName?: string;
  status: "pending" | "approved" | "rejected";
  note?: string | null;
  reviewNote?: string | null;
  createdAt: string;
};
export type TeachingOrganizationJoinStatus = {
  requestId: string;
  orgName: string;
  status: "pending" | "approved" | "rejected";
  reviewedAt?: string | null;
  requiresRelogin: boolean;
};
export type TeachingAssignment = {
  id: string;
  title: string;
  status: "draft" | "published" | "closed";
  dueAt?: string | null;
  itemCount: number;
  targetCount: number;
  completedCount: number;
  createdAt: string;
  isUnread?: boolean;
};
type MateCollection = { id: string; title: string; counts: { published: number }; batchLibraryIds: string[]; groups: { key: string; label: string; counts: { published: number }; completedCount?: number; practicedCount?: number; moveCounts?: Record<string, number> }[] };
export type LegacyMateMoveResult = { outcome: "correct" | "completed" | "wrong" | "pending_review"; message: string; path: string[]; autoMoves: string[]; completed: boolean };
export type PlatformProblemLibrary = {
  practicedCount?: number;
  completedCount?: number;
  id: string;
  title: string;
  publishedCount: number;
  folderPath: string;
  createdAt: string;
};
export type PlatformGameLibrary = {
  id: string;
  title: string;
  gameCount: number;
  folderPath: string;
  createdAt: string;
};
export type PlatformGame = {
  id: string;
  libraryId: string;
  sourceIndex: number;
  title: string;
  redPlayer: string;
  blackPlayer: string;
  result: string;
  eventName: string;
  roundName: string;
  gameDate: string;
  openingName?: string | null;
  moveCount: number;
};

type AssignmentProblem = {
  trainingGoal?: TrainingGoal | null;
  sourceIndex?: number;
  targetMateMoves?: number;
  assignmentId: string;
  problemId: string;
  title: string;
  category: string;
  startingFen: string;
  note: string;
  accessTier?: "public" | "vip" | "vip_or_assignment";
  solution: SolutionMove[];
  completed: boolean;
  attemptCount: number;
  grade?: { score: number; stars: number; mistakes: number; hintsUsed: number; outcome: string };
};
type PlatformProblem = Omit<TrainingProblem, "id" | "libraryId" | "completedAttempts" | "totalElapsedMs" | "source"> & {
  id: string;
  libraryId: string;
  accessTier?: "public" | "vip" | "vip_or_assignment";
};
type Page<T> = { items: T[]; nextCursor?: string | null };

function joinStatusKey(auth: TeachingAuth, requestId: string) {
  return `${JOIN_STATUS_PREFIX}:${encodeURIComponent(serverUrl())}:${auth.user.id}:${requestId}`;
}

type CachedAssignment = {
  cacheKey: string;
  assignment: TeachingAssignment;
  problems: AssignmentProblem[];
  cachedAt: string;
  ownerId: string;
  contentEpoch?: string;
  orgId: string;
  serverUrl: string;
};
export type TeachingStudent = { id: string; loginName: string; email: string; displayName: string };
export type TeachingClass = { id: string; name: string; studentCount: number; students: TeachingStudent[] };
export type TeacherAssignmentProblem = {
  title: string;
  category: string;
  startingFen: string;
  note: string;
  solution: SolutionMove[];
  accessTier?: "public" | "vip";
};
export type CreateTeachingAssignment = {
  title: string;
  dueAt?: string | null;
  problems: TeacherAssignmentProblem[];
  targetStudentIds: string[];
};
export type TeachingAssignmentResultProblem = { id: string; title: string; category: string; order: number };
export type TeachingAssignmentResult = {
  studentId: string;
  problemId: string;
  attemptCount: number;
  completed: boolean;
  elapsedMs?: number | null;
  hintsUsed?: number | null;
  mistakes?: number | null;
  outcome?: "completed" | "revealed" | "abandoned" | null;
  submittedAt?: string | null;
};
export type TeachingAssignmentResults = {
  assignment: TeachingAssignment;
  students: TeachingStudent[];
  problems: TeachingAssignmentResultProblem[];
  results: TeachingAssignmentResult[];
};
export type TeacherClassDto = {
  id: string;
  name: string;
  studentCount: number;
  coachCount: number;
  createdAt: string;
};
export type TeacherClassMember = {
  id: string;
  loginName: string;
  displayName: string;
  email?: string | null;
  createdAt?: string;
};
export type TeacherFolder = { id: string; parentId?: string | null; name: string; depth: number; path: string };
export type TeacherProblemLibrary = {
  id: string; assetId: string; folderId?: string | null; title: string; reviewStatus: string;
  problemCount: number; publishedCount: number; folderPath: string;
  contentHash?: string | null; fingerprint?: string | null; contentFingerprint?: string | null; content_fingerprint?: string | null;
  fileSha256?: string | null; file_sha256?: string | null; hash?: string | null;
  parserVersion?: number | null; parser_version?: number | null;
  orgId?: string | null; org_id?: string | null; orgName?: string | null; org_name?: string | null;
  sourceScope?: string | null; source_scope?: string | null; visibilityScope?: string | null; visibility_scope?: string | null; scope?: string | null; sourceLabel?: string | null; source_label?: string | null;
  accessTier?: "public" | "vip";
  mergedSourceLabel?: string; mergedDuplicateCount?: number;
};
export type TeacherProblem = {
  trainingGoal?: TrainingGoal | null; contentFingerprint?: string; teachingChapter?: string;
  id: string; libraryId: string; sourceIndex: number; title: string; category: string;
  accessTier: "public" | "vip"; startingFen: string; sideToMove: string;
  solutionLength: number; reviewStatus: string; validationStatus: string;
};
export type TeacherProblemPage = { items: TeacherProblem[]; nextCursor?: string | null; totalCount?: number | null };
export type TeacherAssignmentResult = {
  studentId: string; loginName: string; displayName: string; totalCount: number;
  completedCount: number; completedAt?: string | null;
  submittedCount?: number; totalScore?: number; firstTryCorrectCount?: number;
  totalElapsedMs?: number; lastSubmittedAt?: string | null;
};
export type TeacherAssignmentSummary = {
  recipientCount: number; partialSubmissionCount: number; fullSubmissionCount: number;
  fullySolvedCount: number; completedProblemCount: number; assignedProblemCount: number;
  completionRate: number; averageTotalScore?: number | null;
};
export type TeacherProblemResult = {
  problemId: string; title: string; order: number; completed: boolean;
  outcome?: string | null; score?: number | null; stars?: number | null;
  mistakes?: number | null; hintsUsed?: number | null; elapsedMs?: number | null;
  firstTryCorrect: boolean; submittedAt?: string | null;
};
export type TeacherSubmittedProblem = { title: string; startingFen: string; moves?: string[] | null };
export type AccountDeletionStatus = { requestId: string; status: "pending" | "cancelled"; requestedAt: string; expectedBy: string };
export type PendingTeachingAttempt = {
  clientAttemptId: string;
  assignmentId: string;
  problemId: string;
  elapsedMs: number;
  hintsUsed: number;
  mistakes: number;
  moves: string[];
  outcome: "completed" | "revealed" | "abandoned";
  completedAt: string;
  ownerId?: string;
  contentEpoch?: string;
  orgId?: string;
  serverUrl?: string;
  submissionRequested?: boolean;
};
export type AssignmentAnswer = PendingTeachingAttempt & { cacheKey: string };
export type AssignmentDraft = {
  verification?: VerificationResult;
  verificationContent?: string;
  assignmentId: string;
  problemId: string;
  moves: string[];
  hints: number;
  mistakes: number;
  elapsedMs: number;
};
type CachedAssignmentDraft = AssignmentDraft & {
  cacheKey: string;
  ownerId: string;
  contentEpoch?: string;
  orgId: string;
  serverUrl: string;
  updatedAt: string;
};
type PendingAssignmentView = {
  cacheKey: string;
  assignmentId: string;
  ownerId: string;
  contentEpoch?: string;
  orgId: string;
  serverUrl: string;
};
export type { PersonalManualSyncKind } from "./providerMirrors";
export type PersonalManualSyncRecord = {
  kind: PersonalManualSyncKind;
  id: string;
  revision: number;
  deleted: boolean;
  payload: LocalManualGame | LocalManualFolder | LocalManualAnalysisSummary;
  updatedAt: string;
};
type PersonalManualSyncState = { revisions: Record<string, number> };
export type PersonalManualSyncStatus = {
  lastSyncedAt?: string | null;
  gameCount: number;
  folderCount: number;
  analysisCount: number;
  conflictCount: number;
};
type PersonalManualSyncResponse = { records: PersonalManualSyncRecord[]; conflictCount: number; status: PersonalManualSyncStatus };
export type ProviderManualMirrorRecord = {
  provider: "ttxq";
  externalId: string;
  payloadHash: string;
  revision: number;
  snapshot: LocalManualGame;
  updatedAt: string;
};
type ProviderManualMirrorsResponse = { records: ProviderManualMirrorRecord[] };
export type ServerAnalysisLine = {
  depth?: number;
  scoreCp?: number;
  mate?: number;
  nps?: number;
  timeMs?: number;
  multipv: number;
  notation: string[];
  pv: string[];
};
export type ServerAnalysisResponse = { engine: string; elapsedMs: number; lines: ServerAnalysisLine[] };

function serverUrl() {
  localStorage.removeItem(SERVER_KEY);
  return environmentServerUrl();
}

function isVipAccessError(error?: string) {
  return /作业权益|VIP|未开通有效|已过期|续期/.test(error ?? "");
}

function userFacingError(error?: string, status?: number) {
  if (isVipAccessError(error)) return VIP_ACCESS_MESSAGE;
  if (status === 401 || /unauthorized/i.test(error ?? "")) return "登录状态已过期或当前账号没有权限，请重新登录后再试。";
  if (status === 403 || /forbidden/i.test(error ?? "")) return "当前账号没有执行此操作的权限。";
  return error || `请求失败 (${status})`;
}

function appId() { return isNativeSessionStore() ? "student-mobile" : "student-web"; }

async function persistAuth(auth: TeachingAuth, epoch = sessionEpoch, targetServer = serverUrl(), signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (isNativeSessionStore()) {
    const stored = await secureSession.load();
    signal?.throwIfAborted();
    if (epoch !== sessionEpoch || targetServer !== serverUrl()) return;
    const refreshToken = auth.refreshToken ?? (stored?.serverUrl === serverUrl() ? stored.refreshToken : undefined);
    if (!refreshToken) throw new Error("登录会话已失效，请重新登录。");
    await secureSession.save({ serverUrl: serverUrl(), token: auth.token, expiresAt: auth.expiresAt, refreshToken, deviceId: stored?.deviceId ?? secureSession.deviceId(), auth: { ...auth, refreshToken: undefined } });
    signal?.throwIfAborted();
    localStorage.removeItem(AUTH_KEY);
  }
  signal?.throwIfAborted();
  if (epoch !== sessionEpoch || targetServer !== serverUrl()) return;
  rememberAuth(auth, epoch, targetServer);
  activeAuth = auth;
  localStorage.setItem(SESSION_SERVER_KEY, serverUrl());
}

async function refreshAuth(source?: AbortSignal): Promise<TeachingAuth | undefined> {
  source?.throwIfAborted();
  if (!refreshInFlight) {
  const flight: RefreshFlight = {controller: new AbortController(), consumers: 0, promise: Promise.resolve(undefined)};
  const epoch = sessionEpoch;
  const targetServer = serverUrl();
  const refresh = withRequestDeadline(async signal => {
    const stored = isNativeSessionStore() ? await secureSession.load() : undefined;
    signal.throwIfAborted();
    if (epoch !== sessionEpoch) return undefined;
    if ((isNativeSessionStore() ? stored?.serverUrl : localStorage.getItem(SESSION_SERVER_KEY)) !== targetServer) {
      await clearLocalSession();
      return undefined;
    }
    const storedAuth = stored?.auth as TeachingAuth | undefined;
    const sameStoredAccount = !activeAuth || (storedAuth?.user.id === activeAuth.user.id && storedAuth?.user.orgId === activeAuth.user.orgId);
    // Native writes are serialized. A timed-out save may have completed after
    // the caller left; use that persisted successor instead of replaying the
    // replaced token still held by the UI.
    const refreshToken = isNativeSessionStore()
      ? (sameStoredAccount ? stored?.refreshToken : undefined)
      : activeAuth?.refreshToken;
    if (isNativeSessionStore() && !refreshToken) return undefined;
    const headers = new Headers({ "content-type": "application/json", "x-xiangqi-app-id": appId() });
    headers.set("x-xiangqi-device-id", stored?.deviceId ?? secureSession.deviceId());
    headers.set("x-xiangqi-device-name", isNativeSessionStore() ? "Qixi Mobile" : "Qixi Web");
    const response = await fetch(`${targetServer}/api/v1/auth/refresh`, { method: "POST", signal, headers, credentials: "include", body: JSON.stringify({ refreshToken }) });
    const body = await response.json().catch(() => ({}));
    signal.throwIfAborted();
    if (!response.ok || epoch !== sessionEpoch || targetServer !== serverUrl()) return undefined;
    const auth = body as TeachingAuth;
    if (!auth.token || !auth.user) return undefined;
    auth.refreshToken = auth.refreshToken ?? refreshToken;
    await persistAuth(auth, epoch, targetServer, signal);
    return epoch === sessionEpoch ? auth : undefined;
  }, flight.controller.signal).catch(() => undefined).finally(() => { if (refreshInFlight === flight) refreshInFlight = undefined; });
  flight.promise = refresh;
  refreshInFlight = flight;
  }
  const flight = refreshInFlight;
  flight.consumers++;
  try {
    return await withRequestDeadline(async signal => {const auth = await flight.promise; signal.throwIfAborted(); return auth;}, source);
  } catch { return undefined; }
  finally {
    flight.consumers--;
    // One cancelled request must not cancel a refresh needed by another caller.
    if (!flight.consumers && refreshInFlight === flight) flight.controller.abort();
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, retry = true, context?: TeachingAuth): Promise<T> {
  const timeoutMs = /\/(verify-move|mate-move)$/.test(path) ? 25_000 : init.body instanceof FormData ? 60_000 : 15_000;
  // A single deadline covers capability probes, refresh, transport and body reading.
  return withRequestDeadline(signal => requestOnce<T>(path, { ...init, signal }, token, retry, context), init.signal, undefined, timeoutMs);
}

async function requestOnce<T>(path: string, init: RequestInit = {}, token?: string, retry = true, context?: TeachingAuth): Promise<T> {
  init.signal?.throwIfAborted();
  if (context) requireTeacherAuth(context);
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
  headers.set("x-xiangqi-app-id", appId());
  const accessToken = token ?? activeAuth?.token;
  const targetServer = serverUrl();
  const authContext = accessToken ? tokenContexts.get(accessToken) : undefined;
  if (accessToken && (!authContext || !isCurrentAuthContext(authContext))) throw new Error("登录账号或机构已变化，请重新操作。");
  const teachingContentRequest = /^\/api\/v1\/(student|teacher)\//.test(path);
  if (authContext && teachingContentRequest) {
    const changed = await measureActiveOpening("capabilities", () => ensureContentEpoch(authContext), init.signal);
    if (!isCurrentAuthContext(authContext)) throw new Error("登录账号或环境已变化，请重新操作。");
    if (changed && init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) throw new Error("题库已重建，旧练习缓存已清理，请刷新后重新操作。");
  }
  if (init.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
  const contentEpoch = authContext ? contentEpochs.current(authContext) : undefined;
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const accessScope=activeAuth?JSON.stringify([activeAuth.user.role,hasActiveCatalogVip(activeAuth)]):"";
  const response = await measureActiveOpening("transport", () => fetch(`${targetServer}${path}`, { ...init, headers, credentials: "include" }), init.signal);
  const body = await measureActiveOpening("response-body", () => response.json().catch(() => ({})), init.signal);
  if(authContext&&/^\/api\/v1\/(student|admin)\//.test(path)&&accessScope!==(activeAuth?JSON.stringify([activeAuth.user.role,hasActiveCatalogVip(activeAuth)]):""))throw new Error("账号权益已变化，请重新打开内容。");
  init.signal?.throwIfAborted();
  if (authContext && !isCurrentAuthContext(authContext)) throw new Error("登录账号或机构已变化，请重新操作。");
  if (authContext && teachingContentRequest && contentEpoch !== contentEpochs.current(authContext)) throw new Error("题库已重建，请刷新后重新操作。");
  if (!response.ok) {
    if (response.status === 401 && retry && path !== "/api/v1/auth/refresh" && accessToken) {
      const refreshed = await measureActiveOpening("auth-refresh", () => refreshAuth(init.signal ?? undefined), init.signal);
      init.signal?.throwIfAborted();
      if (refreshed) {
        if (authContext && !isCurrentAuthContext(authContext)) throw new Error("登录账号或机构已变化，请重新操作。");
        if (context) requireTeacherAuth(context);
        if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
          throw Object.assign(new Error("登录已续期，请确认操作结果后重试。"), {status:401});
        }
        return requestOnce<T>(path, init, refreshed.token, false, context);
      }
    }
    const error = (body as { error?: string }).error;
    throw Object.assign(new Error(userFacingError(error, response.status)), { status: response.status });
  }
  return body as T;
}

async function requestPages<T>(path: string, token: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page = await request<Page<T>>(`${path}?${query}`, {}, token);
    items.push(...page.items);
    cursor = page.nextCursor || undefined;
  } while (cursor);
  return items;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      for (const name of ["practiceSessions", "practiceDrafts"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains("assignments")) db.createObjectStore("assignments", { keyPath: "assignment.id" });
      if (!db.objectStoreNames.contains("assignmentCaches")) db.createObjectStore("assignmentCaches", { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains("attempts")) db.createObjectStore("attempts", { keyPath: "clientAttemptId" });
      if (!db.objectStoreNames.contains("practiceAttempts")) db.createObjectStore("practiceAttempts", { keyPath: "clientAttemptId" });
      if (!db.objectStoreNames.contains("assignmentViews")) db.createObjectStore("assignmentViews", { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains("assignmentDrafts")) db.createObjectStore("assignmentDrafts", { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains("assignmentAnswers")) db.createObjectStore("assignmentAnswers", { keyPath: "cacheKey" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function storePut(storeName: string, value: unknown) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function storeDelete(storeName: string, key: IDBValidKey) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function storeAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const values = await new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}

async function replaceAssignmentCaches(context: ReturnType<typeof contextOf>, next: CachedAssignment[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("assignmentCaches", "readwrite");
    const store = transaction.objectStore("assignmentCaches");
    const existingRequest = store.getAll();
    existingRequest.onsuccess = () => {
      const keep = new Set(next.map((item) => item.cacheKey));
      for (const item of existingRequest.result as CachedAssignment[]) {
        if (item.ownerId === context.ownerId && item.orgId === context.orgId && item.serverUrl === context.serverUrl && item.contentEpoch === context.contentEpoch && !keep.has(item.cacheKey)) {
          store.delete(item.cacheKey);
        }
      }
      for (const item of next) store.put(item);
    };
    existingRequest.onerror = () => reject(existingRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function deleteAssignmentCaches(predicate: (item: CachedAssignment) => boolean) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("assignmentCaches", "readwrite");
    const store = transaction.objectStore("assignmentCaches");
    const existingRequest = store.getAll();
    existingRequest.onsuccess = () => {
      for (const item of existingRequest.result as CachedAssignment[]) {
        if (predicate(item)) store.delete(item.cacheKey);
      }
    };
    existingRequest.onerror = () => reject(existingRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function toLibrary(cache: CachedAssignment, answers: AssignmentAnswer[]): TrainingLibrary {
  const localCompleted = new Set(answers.filter((answer) => answer.outcome === "completed").map((answer) => answer.problemId));
  return {
    id: `teaching:${cache.assignment.id}`,
    title: cache.assignment.title,
    fingerprint: cache.assignment.id,
    parserVersion: 0,
    problemCount: cache.problems.length,
    completedCount: cache.problems.filter((problem) => problem.completed || localCompleted.has(problem.problemId)).length,
    importedAt: cache.cachedAt,
    accessTier: cache.problems.some((problem) => problem.accessTier === "vip") ? "vip" : "public",
    source: "teaching",
    assignmentId: cache.assignment.id,
    dueAt: cache.assignment.dueAt,
    isUnread: cache.assignment.isUnread === true,
  };
}

function toProblem(problem: AssignmentProblem): TrainingProblem {
  return {
    id: `teaching:${problem.assignmentId}:${problem.problemId}`,
    libraryId: `teaching:${problem.assignmentId}`,
    sourceIndex: problem.sourceIndex ?? 0,
    trainingGoal: problem.trainingGoal,
    targetMateMoves: problem.targetMateMoves,
    title: problem.title,
    category: problem.category,
    startingFen: problem.startingFen,
    note: problem.note,
    solution: problem.solution,
    completedAttempts: problem.completed ? Math.max(1, problem.attemptCount) : 0,
    totalElapsedMs: 0,
    source: "teaching",
    assignmentId: problem.assignmentId,
    serverProblemId: problem.problemId,
    assignmentGrade: problem.grade,
    accessTier: problem.accessTier ?? "public",
  };
}

function contextOf(auth: TeachingAuth) {
  const scope = { ownerId: auth.user.id, serverUrl: authContexts.get(auth)?.serverUrl ?? serverUrl() };
  return {
    contentEpoch: contentEpochs.current(scope),
    ownerId: auth.user.id,
    orgId: auth.user.orgId || "default",
    serverUrl: authContexts.get(auth)?.serverUrl ?? serverUrl(),
  };
}

function assignmentCacheKey(auth: TeachingAuth, assignmentId: string) {
  const context = contextOf(auth);
  return `${context.serverUrl}::${context.ownerId}::${context.orgId}::${context.contentEpoch ?? "legacy"}::${assignmentId}`;
}

type CachedPracticeSession = ReturnType<typeof contextOf> & { cacheKey: string; session: PracticeSession; navigationRevision?: string };
const practiceWrites = new Map<string, Promise<unknown>>();
let draftSequence = 0;
function nextPracticeRevision() { return `${String(Date.now()).padStart(16,"0")}:${String(++draftSequence).padStart(8,"0")}`; }
async function practiceDrafts(auth: TeachingAuth, sessionId: string) {
  const key = assignmentCacheKey(auth, sessionId);
  return (await storeAll<PracticeDraft>("practiceDrafts")).filter(d => d.sessionKey === key);
}
async function cachePracticeSession(auth: TeachingAuth, session: PracticeSession, acknowledgedRevision = "", signal?: AbortSignal) {
  const prior = (await storeAll<CachedPracticeSession>("practiceSessions")).find(s => s.cacheKey === assignmentCacheKey(auth, session.id));
  const navigationRevision = [prior?.navigationRevision ?? "", acknowledgedRevision].sort().at(-1)!;
  const merged = mergePracticeAttempts(mergePracticeDrafts(session, await practiceDrafts(auth, session.id), navigationRevision), (await storeAll<PendingPracticeAttempt>("practiceAttempts")).filter(a => a.sessionId === session.id && samePracticeAttemptContext(a, auth)));
  signal?.throwIfAborted();
  await storePut("practiceSessions", { ...contextOf(auth), cacheKey: assignmentCacheKey(auth, session.id), session: merged, navigationRevision } satisfies CachedPracticeSession);
  return merged;
}
async function sendPracticeDraft(auth: TeachingAuth, saved: PracticeDraft) {
  const previous = practiceWrites.get(saved.sessionKey) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    const context = authContexts.get(auth);
    if (!context || !isCurrentAuthContext(context)) throw new Error("登录账号或机构已变化");
    const latest = (await practiceDrafts(auth, saved.sessionId)).find(d => d.cacheKey === saved.cacheKey);
    if (latest?.revision !== saved.revision) return;
    const result = await teachingRead(signal => request<PracticeSession>(`/api/v1/student/practice/sessions/${encodeURIComponent(saved.sessionId)}`, { method: "PATCH", signal, body: JSON.stringify({ currentItemId: saved.currentItemId, draft: saved.draft }) }, auth.token));
    // Compare and delete in one transaction: a slower reply cannot erase a newer draft.
    const db = await openDb();
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("practiceDrafts", "readwrite"), store = tx.objectStore("practiceDrafts");
      const get = store.get(saved.cacheKey);
      get.onsuccess = () => { if (get.result?.revision === saved.revision) store.delete(saved.cacheKey); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); } finally { db.close(); }
    return cachePracticeSession(auth, result, saved.revision);
  });
  practiceWrites.set(saved.sessionKey, pending);
  try { return await pending; }
  finally { if (practiceWrites.get(saved.sessionKey) === pending) practiceWrites.delete(saved.sessionKey); }
}

const practiceSubmissions = new Map<string, Promise<PracticeSession | undefined>>();
async function syncPracticeAttempts(auth: TeachingAuth, sessionId: string): Promise<PracticeSession | undefined> {
  const key = assignmentCacheKey(auth, sessionId);
  const previous = practiceSubmissions.get(key) ?? Promise.resolve(undefined);
  const pending = previous.catch(() => undefined).then(async () => {
    let updated: PracticeSession | undefined;
    const context = authContexts.get(auth);
    for (const attempt of (await storeAll<PendingPracticeAttempt>("practiceAttempts")).filter(a => a.sessionId === sessionId && samePracticeAttemptContext(a, auth)).sort((a,b) => (a.queuedRevision ?? "").localeCompare(b.queuedRevision ?? ""))) {
      if (!context || !isCurrentAuthContext(context)) throw new Error("登录账号或机构已变化");
      const { sessionId: _sessionId, ownerId: _ownerId, orgId: _orgId, serverUrl: _serverUrl, queuedRevision: _revision, contentEpoch: _epoch, ...payload } = attempt;
      const result = await teachingRead(signal => request<PracticeSession>(`/api/v1/student/practice/sessions/${encodeURIComponent(sessionId)}/attempts`, { method: "POST", signal, body: JSON.stringify(payload) }, auth.token));
      // Remove only progress covered by this attempt; retain a newer retry.
      const db = await openDb();
      try { await new Promise<void>((resolve,reject) => {
        const tx = db.transaction(["practiceDrafts","practiceAttempts"],"readwrite"), store = tx.objectStore("practiceDrafts");
        tx.objectStore("practiceAttempts").delete(attempt.clientAttemptId);
        const cursor = store.openCursor();
        cursor.onsuccess = () => { const row = cursor.result; if (!row) return; const draft = row.value as PracticeDraft;
          if (draft.sessionKey === key && draft.currentItemId === attempt.itemId && draft.draft && draft.revision <= (attempt.queuedRevision ?? "")) row.delete();
          row.continue(); };
        tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
      }); } finally { db.close(); }
      updated = await cachePracticeSession(auth, result);
      if (isCurrentAuthContext(context)) window.dispatchEvent(new CustomEvent("qixi-practice-session-confirmed", { detail: { session: updated, context: key } }));
    }
    return updated;
  });
  practiceSubmissions.set(key, pending);
  try { return await pending; }
  finally { if (practiceSubmissions.get(key) === pending) practiceSubmissions.delete(key); }
}

function assignmentDraftKey(auth: TeachingAuth, assignmentId: string, problemId: string) {
  return `${assignmentCacheKey(auth, assignmentId)}::${problemId}`;
}

function syncMetaKey(auth: TeachingAuth) {
  const context = contextOf(auth);
  return `${SYNC_META_PREFIX}:${encodeURIComponent(context.serverUrl)}:${context.ownerId}:${context.orgId}`;
}

function personalManualSyncKey(auth: TeachingAuth) {
  const context = contextOf(auth);
  return `xiangqi-personal-manual-sync:${encodeURIComponent(context.serverUrl)}:${context.ownerId}`;
}

function personalManualSyncState(auth: TeachingAuth): PersonalManualSyncState {
  try {
    const parsed = JSON.parse(localStorage.getItem(personalManualSyncKey(auth)) || "{}") as Partial<PersonalManualSyncState>;
    return { revisions: parsed.revisions && typeof parsed.revisions === "object" ? parsed.revisions : {} };
  }
  catch { return { revisions: {} }; }
}

function personalManualRecordKey(kind: PersonalManualSyncKind, id: string) { return `${kind}:${id}`; }

function sameAttemptContext(attempt: PendingTeachingAttempt, auth: TeachingAuth) {
  const context = contextOf(auth);
  return attempt.ownerId === context.ownerId && attempt.orgId === context.orgId && attempt.serverUrl === context.serverUrl && attempt.contentEpoch === context.contentEpoch;
}

function samePracticeAttemptContext(attempt: PendingPracticeAttempt, auth: TeachingAuth) {
  const context = contextOf(auth);
  return attempt.ownerId === context.ownerId && attempt.orgId === context.orgId && attempt.serverUrl === context.serverUrl && attempt.contentEpoch === context.contentEpoch;
}

function sameAssignmentViewContext(view: PendingAssignmentView, auth: TeachingAuth) {
  const context = contextOf(auth);
  return view.ownerId === context.ownerId && view.orgId === context.orgId && view.serverUrl === context.serverUrl && view.contentEpoch === context.contentEpoch;
}

async function markCachedAssignmentViewed(auth: TeachingAuth, assignmentId: string) {
  const cacheKey = assignmentCacheKey(auth, assignmentId);
  const cache = (await storeAll<CachedAssignment>("assignmentCaches")).find((item) => item.cacheKey === cacheKey);
  if (cache && cache.assignment.isUnread) {
    await storePut("assignmentCaches", { ...cache, assignment: { ...cache.assignment, isUnread: false } });
  }
}

async function applyPendingAssignmentViews(auth: TeachingAuth) {
  for (const view of await storeAll<PendingAssignmentView>("assignmentViews")) {
    if (sameAssignmentViewContext(view, auth)) await markCachedAssignmentViewed(auth, view.assignmentId);
  }
}

async function markCachedAttempt(auth: TeachingAuth, attempt: PendingTeachingAttempt, receivedGrade?: AssignmentProblem["grade"]) {
  const cacheKey = assignmentCacheKey(auth, attempt.assignmentId);
  const cache = (await storeAll<CachedAssignment>("assignmentCaches")).find((item) => item.cacheKey === cacheKey);
  if (!cache) return;
  const problems = cache.problems.map((problem) => problem.problemId === attempt.problemId
    ? { ...problem, completed: problem.completed || attempt.outcome === "completed", attemptCount: problem.attemptCount + 1, grade: receivedGrade?.score !== undefined ? receivedGrade : { score: practiceScore(attempt.outcome, attempt.mistakes), stars: practiceScore(attempt.outcome, attempt.mistakes), mistakes: attempt.mistakes, hintsUsed: attempt.hintsUsed, outcome: attempt.outcome } }
    : problem);
  await storePut("assignmentCaches", { ...cache, problems });
}

export const teachingClient = {
  auth(): TeachingAuth | undefined {
    return activeAuth;
  },
  async restore() {
    return withRequestDeadline(async signal => {
      if (isNativeSessionStore()) {
        const epoch = sessionEpoch;
        const stored = await secureSession.load();
        signal.throwIfAborted();
        if (epoch !== sessionEpoch) return undefined;
        if (stored?.serverUrl !== serverUrl()) {
          await clearLocalSession();
          return undefined;
        }
        if (!stored?.auth || !stored.refreshToken) return undefined;
        try {
          activeAuth = { ...(stored.auth as TeachingAuth), token: stored.token, expiresAt: stored.expiresAt, refreshToken: stored.refreshToken };
          rememberAuth(activeAuth, epoch, stored.serverUrl);
          const refreshed = await refreshAuth(signal);
          signal.throwIfAborted();
          return epoch === sessionEpoch ? refreshed ?? activeAuth : undefined;
        } catch { return undefined; }
      }
      return refreshAuth(signal);
    });
  },
  async refreshSession() { return refreshAuth(); },
  serverUrl,
  presentationScope(auth = activeAuth) { return JSON.stringify([serverUrl(),sessionEpoch,auth?.user.id,auth?.user.orgId,auth?.user.role,hasActiveCatalogVip(auth)]); },
  cachedPracticeTopic(topicId?: string) {
    const saved = topicDisplays.get(`${this.presentationScope()}:${topicId}`);
    return saved && Date.now() - saved.at < 60_000 ? saved.detail : undefined;
  },
  environment: selectedEnvironment,
  async setEnvironment(environment: AppEnvironment) {
    if (packageEnvironment !== "test") throw new Error("正式版不支持切换环境。");
    if (environment !== "test" && environment !== "production") throw new Error("无效的连接环境。");
    if (activeAuth) throw new Error("请先退出登录再切换环境。");
    if (environment === selectedEnvironment()) return;
    await clearLocalSession();
    selectEnvironment(environment);
  },
  lastSubmitError() { return lastSubmitError; },
  lastLoginAccount() {
    try { return localStorage.getItem(`${LAST_LOGIN_ACCOUNT_PREFIX}:${serverUrl()}`) ?? ""; }
    catch { return ""; }
  },
  async login(account: string, password: string) {
    return withRequestDeadline(async signal => {
      const epoch = sessionEpoch;
      const targetServer = serverUrl();
      let auth: TeachingAuth;
      try {
        auth = await request<TeachingAuth>("/api/v1/auth/login", { method: "POST", signal, body: JSON.stringify({ account, password }) });
      } catch (error) {
        if (error instanceof Error && error.message.includes("登录状态已过期")) {
          throw new Error("登录名或账号编号、密码错误，请检查后重试。");
        }
        throw error;
      }
      if (!["student", "coach", "admin", "user"].includes(auth.user.role)) throw new Error("账号角色无效");
      if (!auth.refreshToken && isNativeSessionStore()) throw new Error("服务端未返回安全登录会话，请更新管理后台服务后重试。");
      if (epoch !== sessionEpoch || targetServer !== serverUrl()) throw new Error("连接环境已变化，请重新登录。");
      await persistAuth(auth, epoch, targetServer, signal);
      if (epoch !== sessionEpoch || targetServer !== serverUrl()) throw new Error("连接环境已变化，请重新登录。");
      rememberLoginAccount(auth.user.loginName || account, targetServer);
      return auth;
    });
  },
  async switchOrganization(orgId: string) {
    return withRequestDeadline(async signal => {
      const auth = this.auth();
      if (!auth) throw new Error("请先登录教学账号");
      const epoch = sessionEpoch;
      const targetServer = serverUrl();
      const next = await request<TeachingAuth>("/api/v1/auth/switch-organization", { method: "POST", signal, body: JSON.stringify({ orgId }) }, auth.token);
      if (epoch !== sessionEpoch || targetServer !== serverUrl() || activeAuth?.user.id !== auth.user.id || activeAuth?.user.orgId !== auth.user.orgId) throw new Error("登录账号或机构已变化，请重新操作。");
      next.refreshToken = activeAuth.refreshToken;
      await persistAuth(next, epoch, targetServer, signal);
      if (epoch !== sessionEpoch || targetServer !== serverUrl()) throw new Error("登录账号或机构已变化，请重新操作。");
      return next;
    });
  },
  async leaveOrganization(orgId: string) {
    return withRequestDeadline(async signal => {
      const auth = this.auth();
      if (!auth) throw new Error("请先登录教学账号");
      const epoch = sessionEpoch;
      const targetServer = serverUrl();
      const next = await request<TeachingAuth>("/api/v1/auth/leave-organization", { method: "POST", signal, body: JSON.stringify({ orgId }) }, auth.token);
      if (epoch !== sessionEpoch || targetServer !== serverUrl() || activeAuth?.user.id !== auth.user.id || activeAuth?.user.orgId !== auth.user.orgId) throw new Error("登录账号或机构已变化，请重新操作。");
      next.refreshToken = activeAuth.refreshToken;
      await persistAuth(next, epoch, targetServer, signal);
      if (epoch !== sessionEpoch || targetServer !== serverUrl()) throw new Error("登录账号或机构已变化，请重新操作。");
      return next;
    });
  },
  async organizations(query = "") {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    return request<TeachingOrganization[]>(`/api/v1/admin/organizations${params}`, {}, auth.token);
  },
  async organizationJoinRequests() {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    return request<TeachingOrganizationJoinRequest[]>("/api/v1/admin/organization-join-requests", {}, auth.token);
  },
  async createOrganizationJoinRequest(orgId: string, note?: string) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    return request<TeachingOrganizationJoinRequest>("/api/v1/admin/organization-join-requests", { method: "POST", body: JSON.stringify({ orgId, note }) }, auth.token);
  },
  async ensureOrganizationJoinStatusToken(requestId: string) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    const key = joinStatusKey(auth, requestId);
    const cached = localStorage.getItem(key);
    if (cached) return cached;
    const response = await request<{ token: string }>(`/api/v1/admin/organization-join-requests/${encodeURIComponent(requestId)}/status-token`, { method: "POST", body: "{}" }, auth.token);
    localStorage.setItem(key, response.token);
    return response.token;
  },
  async organizationJoinRequestStatus(requestId: string) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    const token = localStorage.getItem(joinStatusKey(auth, requestId));
    if (!token) throw new Error("请刷新申请状态");
    return request<TeachingOrganizationJoinStatus>("/api/v1/organization-join-request-status", { method: "POST", body: JSON.stringify({ requestId, token }) });
  },
  async reviewOrganizationJoinRequest(id: string, status: "approved" | "rejected", reviewNote?: string) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录教学账号");
    return request<TeachingOrganizationJoinRequest>(
      `/api/v1/admin/organization-join-requests/${encodeURIComponent(id)}/review`,
      { method: "POST", body: JSON.stringify({ status, reviewNote }) },
      auth.token,
    );
  },
  async logout() {
    window.dispatchEvent(new Event("teaching-content-reset"));
    const auth = activeAuth;
    if (auth?.user.loginName) rememberLoginAccount(auth.user.loginName, authContexts.get(auth)?.serverUrl ?? serverUrl());
    const pendingLogout = auth ? request("/api/v1/auth/logout", { method: "POST", body: "{}" }, auth.token, false).catch(() => undefined) : undefined;
    await clearLocalSession();
    await pendingLogout;
  },
  async logoutAllDevices() {
    const auth = this.auth();
    if (!auth) return;
    await request("/api/v1/auth/logout-all", { method: "POST", body: "{}" }, auth.token, false);
    await clearLocalSession();
  },
  async syncAssignments(): Promise<TrainingLibrary[]> {
    const auth = this.auth();
    if (!auth) return this.cachedLibraries();
    if (auth.user.role !== "student") return [];
    await this.flushPending();
    const assignments = await requestPages<TeachingAssignment>("/api/v1/student/assignments", auth.token);
    const context = contextOf(auth);
    const downloaded: CachedAssignment[] = [];
    for (const assignment of assignments) {
      const problems = await requestPages<AssignmentProblem>(`/api/v1/student/assignments/${assignment.id}/problems`, auth.token);
      downloaded.push({ cacheKey: assignmentCacheKey(auth, assignment.id), assignment, problems, cachedAt: new Date().toISOString(), ...context } satisfies CachedAssignment);
    }
    await replaceAssignmentCaches(context, downloaded);
    await applyPendingAssignmentViews(auth);
    localStorage.setItem(syncMetaKey(auth), new Date().toISOString());
    return this.cachedLibraries();
  },
  async platformLibraries() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    if(!canBrowsePlatformSources(auth))return [];
    return sharePlatformRead("libraries",auth,async()=>{
    const [libraries, collections] = await Promise.all([
      request<PlatformProblemLibrary[]>("/api/v1/student/platform-libraries", {}, auth.token),
      request<MateCollection[]>("/api/v1/student/mate-collections", {}, auth.token),
    ]);
    const batches = new Set(collections.flatMap(c => c.batchLibraryIds));
    const mates: TrainingLibrary[] = collections.flatMap(c => c.groups.filter(g => g.counts.published > 0).map(g => ({
      id: `platform:mate:${c.id}:${g.key}`, title: g.label, fingerprint: `mate:${c.id}:${g.key}`, parserVersion: 0,
      problemCount: g.counts.published, completedCount: g.completedCount ?? 0, practicedCount: g.practicedCount ?? 0, importedAt: "", source: "platform", accessTier: "public",
      folderPath: `S杀法/比赛杀法/${c.title}`, mateCollection: { assetId: c.id, title: c.title, group: g.key, moveCounts: g.moveCounts },
    })));
    return [...mates, ...libraries.filter(l => !batches.has(l.id)).map((library): TrainingLibrary => ({
      id: `platform:${library.id}`,
      title: library.title,
      fingerprint: library.id,
      parserVersion: 0,
      problemCount: library.publishedCount,
      completedCount: library.completedCount ?? 0,
      practicedCount: library.practicedCount ?? 0,
      importedAt: library.createdAt,
      source: "platform",
      accessTier: "public",
      folderPath: library.folderPath,
    }))];
    });
  },
  async platformLibraryProblems(libraryId: string) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    let items: PlatformProblem[];
    if (libraryId.startsWith("mate:")) {
      const [, asset, group, exact] = libraryId.split(":");
      items = []; let page = 1;
      do { const params = new URLSearchParams({ group, page: String(page), pageSize: "100" }); if (exact) params.set("mateMoves", exact);
        const result = await request<{ items: PlatformProblem[]; totalPages: number }>(`/api/v1/student/mate-collections/${encodeURIComponent(asset)}/records?${params}`, {}, auth.token);
        items.push(...result.items); if (page >= result.totalPages) break; page++;
      } while (true);
    } else items = await requestPages<PlatformProblem>(`/api/v1/student/platform-libraries/${encodeURIComponent(libraryId)}/problems`, auth.token);
    return items.map((problem): TrainingProblem => ({
      ...problem,
      id: `platform:${problem.id}`,
      libraryId: `platform:${libraryId}`,
      completedAttempts: 0,
      totalElapsedMs: 0,
      source: "platform",
      serverProblemId: problem.id,
      accessTier: problem.accessTier ?? "public",
    }));
  },
  async verifyTrainingMove(problem: TrainingProblem, path: string[], candidate: string, sessionId?: string, isCurrent?: () => boolean) {
    const auth = this.auth(); if (!auth || !problem.serverProblemId) throw new Error("请登录后验证其他解法");
    const authContext = authContexts.get(auth);
    const problemId = problem.serverProblemId;
    return teachingRead(signal => request<VerificationResult>(`/api/v1/${auth.user.role === "student" ? "student" : "admin"}/problems/${encodeURIComponent(problemId)}/verify-move`, {
      method: "POST", body: JSON.stringify({ path, candidate, assignmentId: problem.assignmentId, sessionId }), signal,
    }, auth.token), undefined, () => Boolean(authContext && isCurrentAuthContext(authContext)) && (!isCurrent || isCurrent()), 25_000);
  },
  async platformGameLibraries() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    if(!canBrowsePlatformSources(auth))return [];
    return sharePlatformRead("games",auth,()=>request<PlatformGameLibrary[]>("/api/v1/student/platform-game-libraries", {}, auth.token));
  },
  async platformGameLibraryGames(libraryId: string) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    return requestPages<PlatformGame>(`/api/v1/student/platform-game-libraries/${encodeURIComponent(libraryId)}/games`, auth.token);
  },
  async rehearsalRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const auth=this.auth();if(!auth)throw new Error("请先登录");
    return request<T>(path,init??{},auth.token);
  },
  async catalogRehearsals(id:string,cursor?:string,teacher=false,context?:TeachingAuth,signal?:AbortSignal){
    const path=`/api/v1/${teacher?"admin":"student"}/teaching-catalog/${encodeURIComponent(id)}/rehearsals${cursor?`?cursor=${encodeURIComponent(cursor)}`:""}`;
    if(teacher)return teacherRequest<{items:{id:string;title:string;completed:boolean}[];nextCursor?:string|null}>(path,{signal},context);
    const auth=context??this.auth();if(!auth)throw new Error("请先登录");
    return request<{items:{id:string;title:string;completed:boolean}[];nextCursor?:string|null}>(path,{signal},auth.token);
  },
  async platformGameDetail(gameId: string) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录");
    if (["coach", "admin"].includes(auth.user.role)) return teacherRequest<unknown>(`/api/v1/admin/games/${encodeURIComponent(gameId)}`, {}, auth);
    if (auth.user.role !== "student") throw new Error("当前账号没有读取权限");
    return request<unknown>(`/api/v1/student/platform-games/${encodeURIComponent(gameId)}`, {}, auth.token);
  },
  async practiceHome() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return undefined;
    // Submission retries run independently in the online/visibility lifecycle.
    // A pending offline write must never block opening the practice homepage.
    const scope = this.presentationScope();
    return teachingRead(signal => request<PracticeHome>("/api/v1/student/practice/dashboard", { signal }, auth.token), undefined, () => scope === this.presentationScope());
  },
  async practiceTopic(topicId: string, signal?: AbortSignal) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    const context = `${this.presentationScope()}:${topicId}`;
    const result = await teachingRead(signal => request<PracticeTopic & { chapters: PracticeTopicChapter[] }>(`/api/v1/student/practice/topics/${encodeURIComponent(topicId)}`, {signal}, auth.token), signal);
    const {chapters, ...topic} = result;
    const detail = {topic, chapters} satisfies PracticeTopicDetail;
    if (context === `${this.presentationScope()}:${topicId}`) {
      topicDisplays.set(context, {at:Date.now(),detail});
      if (topicDisplays.size > 24) topicDisplays.delete(topicDisplays.keys().next().value!);
    }
    return detail;
  },
  async practiceSearch(query: PracticeSearchQuery = {}) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return { items: [] } as PracticeSearchResult;
    const params = new URLSearchParams();
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.category?.trim()) params.set("category", query.category.trim());
    if (query.difficulty) params.set("difficulty", String(query.difficulty));
    if (query.sideToMove) params.set("sideToMove", query.sideToMove);
    if (query.libraryId) params.set("libraryId", query.libraryId);
    if (typeof query.cursor === "number") params.set("cursor", String(query.cursor));
    if (typeof query.limit === "number") params.set("limit", String(query.limit));
    const suffix = params.size ? `?${params.toString()}` : "";
    return request<PracticeSearchResult>(`/api/v1/student/practice/search${suffix}`, {}, auth.token);
  },
  async createPracticeSession(payload: CreatePracticeSession, signal?: AbortSignal) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    // Return the server identity before fallible local initialization, so retry reuses it.
    return request<PracticeSession>("/api/v1/student/practice/sessions", { method: "POST", signal, body: JSON.stringify(payload) }, auth.token);
  },
  async localPracticeSession(session: PracticeSession, signal?: AbortSignal) {
    const auth = this.auth(); if (!auth) return session;
    const cached = (await storeAll<CachedPracticeSession>("practiceSessions")).find(s => s.cacheKey === assignmentCacheKey(auth, session.id));
    return cachePracticeSession(auth, cached?.session ?? session, "", signal);
  },
  practiceSessionContext(sessionId: string) { const auth = this.auth(); return auth ? assignmentCacheKey(auth, sessionId) : ""; },
  async practiceSession(sessionId: string, signal?: AbortSignal) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    try { return await cachePracticeSession(auth, await request<PracticeSession>(`/api/v1/student/practice/sessions/${encodeURIComponent(sessionId)}`, { signal }, auth.token), "", signal); }
    catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError) && navigator.onLine !== false) throw error;
      const cached = (await storeAll<CachedPracticeSession>("practiceSessions")).find(s => s.cacheKey === assignmentCacheKey(auth, sessionId));
      if (!cached) throw error;
      return cachePracticeSession(auth, cached.session, "", signal);
    }
  },
  async updatePracticeSession(sessionId: string, currentItemId: string, draft?: PracticeSessionItem["draft"]) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    const sessionKey = assignmentCacheKey(auth, sessionId);
    const saved: PracticeDraft & ReturnType<typeof contextOf> = { ...contextOf(auth), cacheKey: `${sessionKey}::${currentItemId}${draft ? "" : "::navigation"}`, sessionKey, sessionId, currentItemId, draft, revision: nextPracticeRevision() };
    await storePut("practiceDrafts", saved);
    return sendPracticeDraft(auth, saved);
  },
  async startDailyPractice(planId: string, signal?: AbortSignal) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    return request<PracticeSession>(`/api/v1/student/practice/daily/${encodeURIComponent(planId)}/session`, { method: "POST", signal, body: "{}" }, auth.token);
  },
  async practiceHistory(days = 7) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    return request<PracticeHistory[]>(`/api/v1/student/practice/history?days=${Math.max(1, Math.min(days, 90))}`, {}, auth.token);
  },
  async submitPracticeAttempt(sessionId: string, attempt: PracticeAttempt, expectedAuth?: TeachingAuth) {
    const auth = expectedAuth ?? this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    const queued: PendingPracticeAttempt = { ...attempt, sessionId, ...contextOf(auth), queuedRevision: nextPracticeRevision() };
    await storePut("practiceAttempts", queued);
    const cached = (await storeAll<CachedPracticeSession>("practiceSessions")).find(s => s.cacheKey === assignmentCacheKey(auth, sessionId));
    if (cached) await cachePracticeSession(auth, cached.session);
    const authContext = authContexts.get(auth);
    if (!authContext || !isCurrentAuthContext(authContext)) throw new Error("登录账号或机构已变化，答题记录已保留，请登录原账号后补交。");
    const result = await syncPracticeAttempts(auth, sessionId);
    return result ?? this.practiceSession(sessionId);
  },
  async practiceMistakes(state: "pending" | "mastered" = "pending") {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    return request<PracticeReviewProblem[]>(`/api/v1/student/practice/mistakes?state=${state}`, {}, auth.token);
  },
  async practiceFavorites() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    return request<PracticeReviewProblem[]>("/api/v1/student/practice/favorites", {}, auth.token);
  },
  async setPracticeFavorite(problemId: string, favorite: boolean) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    return request<void>(`/api/v1/student/practice/problems/${encodeURIComponent(problemId)}/favorite`, { method: favorite ? "POST" : "DELETE", body: favorite ? "{}" : undefined }, auth.token);
  },
  async saveStudyBookmark(payload: { gameId: string; fen: string; branchPath: string[]; note?: string }) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请先登录学生账号");
    return request<void>("/api/v1/student/study/bookmarks", { method: "POST", body: JSON.stringify(payload) }, auth.token);
  },
  async studyBookmarks() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    return request<Array<{ id: string; gameId: string; fen: string; branchPath: string[]; note: string; updatedAt: string }>>("/api/v1/student/study/bookmarks", {}, auth.token);
  },
  lastSyncAt() {
    const auth = this.auth();
    return auth ? localStorage.getItem(syncMetaKey(auth)) : null;
  },
  async pendingAttemptCount() {
    const auth = this.auth();
    if (!auth) return 0;
    return (await storeAll<PendingTeachingAttempt>("attempts"))
      .filter((attempt) => sameAttemptContext(attempt, auth) && attempt.submissionRequested === true).length;
  },
  async unreadAssignmentCount() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return 0;
    const context = contextOf(auth);
    return (await storeAll<CachedAssignment>("assignmentCaches"))
      .filter((cache) => cache.ownerId === context.ownerId && cache.orgId === context.orgId && cache.serverUrl === context.serverUrl && cache.contentEpoch === context.contentEpoch && cache.assignment.isUnread)
      .length;
  },
  async markAssignmentViewed(assignmentId: string) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return;
    const context = contextOf(auth);
    const pending: PendingAssignmentView = { cacheKey: assignmentCacheKey(auth, assignmentId), assignmentId, ...context };
    await markCachedAssignmentViewed(auth, assignmentId);
    await storePut("assignmentViews", pending);
    try {
      await request(`/api/v1/student/assignments/${encodeURIComponent(assignmentId)}/view`, { method: "POST", body: "{}" }, auth.token);
      await storeDelete("assignmentViews", pending.cacheKey);
    } catch {
      // The local badge is already cleared. A future sync retries this idempotent request.
    }
  },
  async assignmentDraft(assignmentId: string, problemId: string) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return undefined;
    const key = assignmentDraftKey(auth, assignmentId, problemId);
    return (await storeAll<CachedAssignmentDraft>("assignmentDrafts")).find((draft) => draft.cacheKey === key);
  },
  async saveAssignmentDraft(draft: AssignmentDraft) {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return;
    await storePut("assignmentDrafts", {
      ...draft,
      cacheKey: assignmentDraftKey(auth, draft.assignmentId, draft.problemId),
      ...contextOf(auth),
      updatedAt: new Date().toISOString(),
    } satisfies CachedAssignmentDraft);
  },
  async clearAssignmentDraft(assignmentId: string, problemId: string) {
    const auth = this.auth();
    if (!auth) return;
    await storeDelete("assignmentDrafts", assignmentDraftKey(auth, assignmentId, problemId));
  },
  async assignmentAnswers(assignmentId?: string): Promise<AssignmentAnswer[]> {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return [];
    const current = (await storeAll<AssignmentAnswer>("assignmentAnswers")).filter((answer) => sameAttemptContext(answer, auth) && (!assignmentId || answer.assignmentId === assignmentId));
    // Previously queued automatic submissions now require the student's review.
    const legacy = (await storeAll<PendingTeachingAttempt>("attempts")).filter((answer) => sameAttemptContext(answer, auth) && (!assignmentId || answer.assignmentId === assignmentId));
    const latest = new Map<string, AssignmentAnswer>();
    for (const answer of [...legacy, ...current].sort((a, b) => a.completedAt.localeCompare(b.completedAt))) {
      const key = assignmentDraftKey(auth, answer.assignmentId, answer.problemId);
      latest.set(key, { ...answer, cacheKey: key });
    }
    return [...latest.values()];
  },
  async saveAssignmentAnswer(attempt: PendingTeachingAttempt, expectedAuth?: TeachingAuth) {
    const auth = expectedAuth ?? this.auth();
    if (!auth || auth.user.role !== "student") throw new Error("请登录学生账号后保存作业");
    const key = assignmentDraftKey(auth, attempt.assignmentId, attempt.problemId);
    if (assignmentSubmissionLocks.has(assignmentCacheKey(auth, attempt.assignmentId))) throw new Error("作业正在提交，暂时不能修改");
    const existing = (await storeAll<AssignmentAnswer>("assignmentAnswers")).find((answer) => answer.cacheKey === key);
    if (existing?.submissionRequested) throw new Error("本题已确认提交，等待提交完成后再修改");
    await storePut("assignmentAnswers", { ...attempt, ...contextOf(auth), cacheKey: key, submissionRequested: false } satisfies AssignmentAnswer);
  },
  async clearAssignmentAnswer(assignmentId: string, problemId: string) {
    const auth = this.auth();
    if (!auth) return;
    const answer = (await this.assignmentAnswers(assignmentId)).find((item) => item.problemId === problemId);
    if (assignmentSubmissionLocks.has(assignmentCacheKey(auth, assignmentId))) throw new Error("作业正在提交，暂时不能修改");
    if (answer?.submissionRequested) throw new Error("本题已确认提交，等待提交完成后再修改");
    await storeDelete("assignmentAnswers", assignmentDraftKey(auth, assignmentId, problemId));
    const legacy = (await storeAll<PendingTeachingAttempt>("attempts")).filter((item) => sameAttemptContext(item, auth) && item.assignmentId === assignmentId && item.problemId === problemId);
    await Promise.all(legacy.map((item) => storeDelete("attempts", item.clientAttemptId)));
    await this.clearAssignmentDraft(assignmentId, problemId);
  },
  async submitAssignmentAnswers(assignmentId: string, reviewedAttemptIds: string[]) {
    const auth = this.auth();
    const authContext = auth && authContexts.get(auth);
    if (!auth || !authContext || !isCurrentAuthContext(authContext)) throw new Error("请重新登录后提交作业");
    const key = assignmentCacheKey(auth, assignmentId);
    if (assignmentSubmissionLocks.has(key)) throw new Error("作业正在提交，请稍候");
    assignmentSubmissionLocks.add(key);
    try {
      const answers = await this.assignmentAnswers(assignmentId);
      const selected = answers.filter((answer) => reviewedAttemptIds.includes(answer.clientAttemptId));
      if (!selected.length || selected.length !== reviewedAttemptIds.length) throw new Error("答题记录已变化，请重新检查后提交");
      let submitted = 0;
      for (const answer of selected) {
        if (!isCurrentAuthContext(authContext)) throw new Error("账号或机构已变化，请重新检查作业");
        await storePut("assignmentAnswers", { ...answer, submissionRequested: true });
        if (await this.submit(answer, auth)) submitted++;
      }
      return { submitted, pending: selected.length - submitted };
    } finally { assignmentSubmissionLocks.delete(key); }
  },
  async syncPersonalManuals(games: LocalManualGame[], folders: LocalManualFolder[], analyses: LocalManualAnalysisSummary[]) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录后再同步个人棋谱");
    const state = personalManualSyncState(auth);
    const records = buildPersonalManualSyncRecords(games, folders, analyses, state.revisions);
    const response = await request<PersonalManualSyncResponse>("/api/v1/personal-manual-sync", { method: "POST", body: JSON.stringify({ records }) }, auth.token);
    return response;
  },
  async providerManualMirrors() {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录后同步天天象棋云镜像");
    return request<ProviderManualMirrorsResponse>("/api/v1/personal-manual-sync/provider-imports", {}, auth.token);
  },
  providerManualMirrorOwnerKey() {
    const auth = this.auth();
    if (!auth) return undefined;
    const context = authContexts.get(auth);
    return `${context?.serverUrl ?? serverUrl()}::${auth.user.id}`;
  },
  async analyzePosition(fen: string, moveTimeMs: number, multiPv: number) {
    const auth = this.auth();
    if (!auth) throw new Error("Web 端请先登录账号后使用服务端 AI 分析");
    return request<ServerAnalysisResponse>("/api/v1/analysis", {
      method: "POST",
      body: JSON.stringify({ fen, mode: "time", value: Math.max(100, Math.min(5_000, moveTimeMs)), multiPv: Math.max(1, Math.min(5, multiPv)) }),
    }, auth.token);
  },
  async personalManualSyncStatus() {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录后查看个人棋谱同步状态");
    return request<PersonalManualSyncStatus>("/api/v1/personal-manual-sync/status", {}, auth.token);
  },
  completePersonalManualSync(response: PersonalManualSyncResponse) {
    const auth = this.auth();
    if (!auth) throw new Error("请先登录后再同步个人棋谱");
    const revisions: Record<string, number> = {};
    for (const record of response.records) revisions[personalManualRecordKey(record.kind, record.id)] = record.revision;
    localStorage.setItem(personalManualSyncKey(auth), JSON.stringify({ revisions } satisfies PersonalManualSyncState));
  },
  async clearAssignmentCaches() {
    const auth = this.auth();
    if (!auth) return;
    const context = contextOf(auth);
    await deleteAssignmentCaches((item) => item.ownerId === context.ownerId && item.serverUrl === context.serverUrl);
    const drafts = await storeAll<CachedAssignmentDraft>("assignmentDrafts");
    await Promise.all(drafts.filter((draft) => draft.ownerId === context.ownerId && draft.serverUrl === context.serverUrl).map((draft) => storeDelete("assignmentDrafts", draft.cacheKey)));
    const organizationIds = new Set(["default", ...(auth.user.organizations ?? []).map((item) => item.id)]);
    for (const orgId of organizationIds) {
      localStorage.removeItem(`${SYNC_META_PREFIX}:${encodeURIComponent(context.serverUrl)}:${context.ownerId}:${orgId}`);
    }
  },
  async cachedLibraries() {
    const auth = this.auth();
    if (!auth) return [];
    const current = authContexts.get(auth);
    if (current) { try { await ensureContentEpoch(current); } catch (error) { if (!(error instanceof TypeError)) throw error; } }
    const context = contextOf(auth);
    const answers = await this.assignmentAnswers();
    return (await storeAll<CachedAssignment>("assignmentCaches"))
      .filter((cache) => cache.ownerId === context.ownerId && cache.orgId === context.orgId && cache.serverUrl === context.serverUrl && cache.contentEpoch === context.contentEpoch)
      .map((cache) => {
        const assignmentAnswers = answers.filter((answer) => answer.assignmentId === cache.assignment.id && cache.problems.some((problem) => problem.problemId === answer.problemId));
        return { ...toLibrary(cache, assignmentAnswers), pendingSubmissionCount: assignmentAnswers.length };
      })
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  },
  async problems(assignmentId: string) {
    const auth = this.auth();
    if (!auth) return [];
    const caches = await storeAll<CachedAssignment>("assignmentCaches");
    const answers = await this.assignmentAnswers(assignmentId);
    return caches
      .find((item) => item.cacheKey === assignmentCacheKey(auth, assignmentId))
      ?.problems.map((problem, sourceIndex) => {
        const answer = answers.find((item) => item.problemId === problem.problemId);
        return { ...toProblem(problem), sourceIndex: problem.sourceIndex ?? sourceIndex, assignmentGrade: answer ? { score: practiceScore(answer.outcome, answer.mistakes), stars: practiceScore(answer.outcome, answer.mistakes), mistakes: answer.mistakes, hintsUsed: answer.hintsUsed, outcome: answer.outcome } : problem.grade, submissionState: answer ? answer.submissionRequested ? "queued" : "draft" : problem.attemptCount ? "submitted" : undefined } satisfies TrainingProblem;
      }) ?? [];
  },
  async submit(attempt: PendingTeachingAttempt, expectedAuth?: TeachingAuth) {
    const auth = expectedAuth ?? this.auth();
    const key = `${auth ? assignmentCacheKey(auth, attempt.assignmentId) : serverUrl()}:${attempt.clientAttemptId}`;
    const existing = assignmentAttemptRequests.get(key);
    if (existing) return existing;
    const pending = this.sendAssignmentAttempt(attempt, auth);
    assignmentAttemptRequests.set(key, pending);
    try { return await pending; }
    finally { assignmentAttemptRequests.delete(key); }
  },
  async sendAssignmentAttempt(attempt: PendingTeachingAttempt, auth?: TeachingAuth) {
    const enriched = auth ? { ...attempt, ...contextOf(auth), submissionRequested: true } : { ...attempt, submissionRequested: true };
    lastSubmitError = "";
    await storePut("attempts", enriched);
    const authContext = auth && authContexts.get(auth);
    if (!auth || !authContext || !isCurrentAuthContext(authContext)) { lastSubmitError = "请登录原教学账号后补交，答题记录已保留。"; return false; }
    try {
      const grade = await request<AssignmentProblem["grade"]>("/api/v1/student/attempts", { method: "POST", body: JSON.stringify(enriched) }, auth.token);
      await storeDelete("attempts", enriched.clientAttemptId);
      await markCachedAttempt(auth, enriched, grade);
      await storeDelete("assignmentDrafts", assignmentDraftKey(auth, enriched.assignmentId, enriched.problemId));
      await storeDelete("assignmentAnswers", assignmentDraftKey(auth, enriched.assignmentId, enriched.problemId));
      lastSubmitError = "";
      return true;
    } catch (error) {
      lastSubmitError = error instanceof Error ? error.message : String(error);
      return false;
    }
  },
  async flushPending() {
    const auth = this.auth();
    if (!auth || auth.user.role !== "student") return;
    const authContext = authContexts.get(auth);
    if (!authContext || !isCurrentAuthContext(authContext)) return;
    try { await ensureContentEpoch(authContext); } catch (error) { if (error instanceof TypeError) return; throw error; }
    for (const view of await storeAll<PendingAssignmentView>("assignmentViews")) {
      if (!isCurrentAuthContext(authContext)) return;
      if (!sameAssignmentViewContext(view, auth)) continue;
      try {
        await request(`/api/v1/student/assignments/${encodeURIComponent(view.assignmentId)}/view`, { method: "POST", body: "{}" }, auth.token);
        await storeDelete("assignmentViews", view.cacheKey);
      } catch {
        break;
      }
    }
    for (const attempt of await storeAll<PendingTeachingAttempt>("attempts")) {
      if (!isCurrentAuthContext(authContext)) return;
      if (!sameAttemptContext(attempt, auth) || attempt.submissionRequested !== true) continue;
      if (!await this.submit(attempt, auth)) break;
    }
    for (const draft of (await storeAll<PracticeDraft>("practiceDrafts")).sort((a,b) => a.revision.localeCompare(b.revision))) {
      if (!isCurrentAuthContext(authContext)) return;
      if (draft.sessionKey !== assignmentCacheKey(auth, draft.sessionId)) continue;
      try { await sendPracticeDraft(auth, draft); } catch { break; }
    }
    const sessionIds = new Set((await storeAll<PendingPracticeAttempt>("practiceAttempts")).filter(a => samePracticeAttemptContext(a, auth)).map(a => a.sessionId));
    for (const sessionId of sessionIds) {
      if (!isCurrentAuthContext(authContext)) return;
      try { await syncPracticeAttempts(auth, sessionId); } catch { break; }
    }
  },
  async students() {
    const auth = requireTeacherAuth();
    return requestPages<TeachingStudent>("/api/v1/teacher/students", auth.token);
  },
  async classes() {
    const auth = requireTeacherAuth();
    return request<TeachingClass[]>("/api/v1/teacher/classes", {}, auth.token);
  },
  async legacyTeacherAssignments() {
    const auth = requireTeacherAuth();
    return requestPages<TeachingAssignment>("/api/v1/teacher/assignments", auth.token);
  },
  async createAssignment(payload: CreateTeachingAssignment) {
    const auth = requireTeacherAuth();
    return request<TeachingAssignment>("/api/v1/teacher/assignments", { method: "POST", body: JSON.stringify(payload) }, auth.token);
  },
  async assignmentResults(assignmentId: string) {
    const auth = requireTeacherAuth();
    return request<TeachingAssignmentResults>(`/api/v1/teacher/assignments/${assignmentId}/results`, {}, auth.token);
  },
  async closeAssignment(assignmentId: string) {
    const auth = requireTeacherAuth();
    return request<TeachingAssignment>(`/api/v1/teacher/assignments/${assignmentId}/close`, { method: "POST", body: "{}" }, auth.token);
  },
  async teacherClasses(context?: TeachingAuth) {
    return teacherRequest<TeacherClassDto[]>("/api/v1/admin/classes", {}, context);
  },
  async teacherClassStudents(classId: string, context?: TeachingAuth) {
    return teacherRequest<TeacherClassMember[]>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/students`, {}, context);
  },
  async createTeacherClass(name: string) {
    const auth = requireTeacherAuth();
    return request<TeacherClassDto>("/api/v1/admin/classes", { method: "POST", body: JSON.stringify({ name }) }, auth.token);
  },
  async updateTeacherClass(classId: string, name: string) {
    const auth = requireTeacherAuth();
    return request<TeacherClassDto>(`/api/v1/admin/classes/${encodeURIComponent(classId)}`, { method: "PATCH", body: JSON.stringify({ name }) }, auth.token);
  },
  async archiveTeacherClass(classId: string) {
    const auth = requireTeacherAuth();
    return request<{ ok: boolean }>(`/api/v1/admin/classes/${encodeURIComponent(classId)}`, { method: "DELETE" }, auth.token);
  },
  async eligibleTeacherClassStudents(classId: string, query = "") {
    const auth = requireTeacherAuth();
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    return request<TeacherClassMember[]>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/eligible-students${suffix}`, {}, auth.token);
  },
  async addTeacherClassStudent(classId: string, userId: string) {
    const auth = requireTeacherAuth();
    return request<TeacherClassMember[]>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/students`, { method: "POST", body: JSON.stringify({ userId }) }, auth.token);
  },
  async removeTeacherClassStudent(classId: string, studentId: string) {
    const auth = requireTeacherAuth();
    return request<TeacherClassMember[]>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/students/${encodeURIComponent(studentId)}`, { method: "DELETE" }, auth.token);
  },
  async createTeacherClassStudent(classId: string, body: { displayName: string; loginName?: string; password: string }) {
    const auth = requireTeacherAuth();
    return request<TeacherClassMember>(`/api/v1/admin/classes/${encodeURIComponent(classId)}/students/create`, { method: "POST", body: JSON.stringify(body) }, auth.token);
  },
  async teachingCatalog(teacher = false, context?: TeachingAuth) {
    const path = teacher ? "/api/v1/admin/teaching-catalog" : "/api/v1/student/teaching-catalog";
    if (teacher) return teacherRequest<TeachingCatalogNode[]>(path, {}, context);
    const auth = this.auth(); if (!auth) throw new Error("请先登录学生账号");
    return request<TeachingCatalogNode[]>(path, {}, auth.token);
  },
  async catalogBrowse(query:{nodeId?:string;cursor?:string;q?:string;materialCursor?:string;limit?:number|string;view?:string;availability?:string}={},teacher=false,context?:TeachingAuth,signal?:AbortSignal) {
    const params=new URLSearchParams({limit:String(query.limit??50)});
    for(const [key,value] of Object.entries(query))if(value!==undefined&&value!=="")params.set(key,String(value));
    const path=`/api/v1/${teacher?"admin":"student"}/teaching-catalog/browse?${params}`;
    if(teacher)return teachingRead(signal => teacherRequest<import("./TeachingCatalog").CatalogBrowsePage>(path,{signal},context), signal);
    const auth=context??this.auth();if(!auth)throw new Error("请先登录学生账号");
    return teachingRead(signal => request<import("./TeachingCatalog").CatalogBrowsePage>(path,{signal},auth.token), signal);
  },
  async catalogProblems(id: string, query: { libraryId?: string; q?: string; goal?: string; material?:string; motif?:string; difficulty?: number; mateGroup?: string; mateMoves?: number; cursor?: string; limit?: number } = {}, teacher = false, context?: TeachingAuth, signal?:AbortSignal) {
    const params = new URLSearchParams({ limit: String(query.limit ?? 50), pageOnly: "true" });
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const path = `/api/v1/${teacher ? "admin" : "student"}/teaching-catalog/${encodeURIComponent(id)}/problems?${params}`;
    if (teacher) return teachingRead(signal => teacherRequest<{ items: CatalogProblem[]; nextCursor?: string | null }>(path, {signal}, context), signal);
    const auth = context ?? this.auth(); if (!auth) throw new Error("请先登录学生账号");
    return teachingRead(signal => request<{ items: CatalogProblem[]; nextCursor?: string | null }>(path, {signal}, auth.token), signal);
  },
  async teacherFolderTree(context?: TeachingAuth) {
    return teacherRequest<TeacherFolder[]>("/api/v1/admin/content/folder-tree?scope=teaching", {}, context);
  },
  async teacherLibraryCategories(context?: TeachingAuth, signal?: AbortSignal) {
    return teacherRequest<{code:string;libraryCount:number}[]>("/api/v1/admin/problem-library-categories?scope=teaching", {signal}, context);
  },
  async teacherProblemLibrariesPage(query: { q?: string; folderId?: string; cursor?: string; category?: string; publishedOnly?: boolean } = {}, context?: TeachingAuth, signal?: AbortSignal) {
    const params = new URLSearchParams({scope:"teaching",limit:"50"});
    for (const [key,value] of Object.entries(query)) if(value) params.set(key,String(value));
    return teacherRequest<{items:TeacherProblemLibrary[];nextCursor?:string|null}>(`/api/v1/admin/problem-libraries/page?${params}`, {signal}, context);
  },
  async teacherProblemLibraries(query = "", context?: TeachingAuth) {
    const suffix = query.trim() ? `?scope=teaching&q=${encodeURIComponent(query.trim())}` : "?scope=teaching";
    return teacherRequest<TeacherProblemLibrary[]>(`/api/v1/admin/problem-libraries${suffix}`, {}, context);
  },
  async teacherProblemDetail(id: string, signal?: AbortSignal) {
    return teacherRequest<PracticeProblem>(`/api/v1/admin/problems/${encodeURIComponent(id)}`, { signal });
  },
  async readableProblem(id: string, signal?: AbortSignal): Promise<PracticeProblem> {
    const auth = this.auth(); if (!auth) throw new Error("请先登录");
    return auth.user.role === "student"
      ? request<PracticeProblem>(`/api/v1/student/problems/${encodeURIComponent(id)}`, { signal }, auth.token)
      : this.teacherProblemDetail(id, signal);
  },
  async teacherProblems(libraryId: string, query: { q?: string; cursor?: string; limit?: number } = {}, context?: TeachingAuth) {
    const params = new URLSearchParams({ limit: String(query.limit ?? 50), reviewStatus: "published", sort: "source_asc", assignmentEligible: "true", includeTotal: "true" });
    if (query.q?.trim()) params.set("q", query.q.trim());
    if (query.cursor) params.set("cursor", query.cursor);
    return teacherRequest<TeacherProblemPage>(`/api/v1/admin/problem-libraries/${encodeURIComponent(libraryId)}/problems?${params}`, {}, context);
  },
  async teacherAssignments(context?: TeachingAuth) {
    return teacherRequest<TeachingAssignment[]>("/api/v1/admin/assignments", {}, context);
  },
  async accountDeletionStatus() {
    const auth = this.auth(); if (!auth) throw new Error("请先登录");
    return request<AccountDeletionStatus | null>("/api/v1/auth/account-deletion", {}, auth.token);
  },
  async requestAccountDeletion(currentPassword: string, cancel = false) {
    const auth = this.auth(); if (!auth) throw new Error("请先登录");
    return request<AccountDeletionStatus>("/api/v1/auth/account-deletion", { method: "POST", body: JSON.stringify({ currentPassword, cancel }) }, auth.token);
  },
  async createTeacherAdminAssignment(body: Record<string, unknown>, context?: TeachingAuth) {
    return teacherRequest<TeachingAssignment>("/api/v1/admin/assignments", { method: "POST", body: JSON.stringify(body) }, context);
  },
  async publishTeacherAssignment(id: string, allowDuplicate = false, context?: TeachingAuth) {
    return teacherRequest<TeachingAssignment>(`/api/v1/admin/assignments/${encodeURIComponent(id)}/publish${allowDuplicate ? "?allowDuplicate=true" : ""}`, { method: "POST" }, context);
  },
  async teacherAssignmentResults(id: string) {
    return teacherRequest<TeacherAssignmentResult[]>(`/api/v1/admin/assignments/${encodeURIComponent(id)}/results`, {});
  },
  async teacherAssignmentSummary(id: string) {
    return teacherRequest<TeacherAssignmentSummary>(`/api/v1/admin/assignments/${encodeURIComponent(id)}/results/summary`, {});
  },
  async teacherStudentResults(id: string, studentId: string, cursor?: string) {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    return teacherRequest<Page<TeacherProblemResult>>(`/api/v1/admin/assignments/${encodeURIComponent(id)}/students/${encodeURIComponent(studentId)}/results?${params}`, {});
  },
  async teacherSubmittedProblem(id: string, studentId: string, problemId: string) {
    return teacherRequest<TeacherSubmittedProblem>(`/api/v1/admin/assignments/${encodeURIComponent(id)}/students/${encodeURIComponent(studentId)}/problems/${encodeURIComponent(problemId)}`, {});
  },
};

async function teacherRequest<T>(path: string, init: RequestInit, context?: TeachingAuth): Promise<T> {
  const auth = requireTeacherAuth(context);
  const result = await request<T>(path, init, auth.token, true, context);
  requireTeacherAuth(context);
  return result;
}

function requireTeacherAuth(context?: TeachingAuth) {
  const auth = teachingClient.auth();
  if (!auth || !["coach", "admin"].includes(auth.user.role)) throw new Error("请先登录老师账号");
  if (context && (auth.user.id !== context.user.id || auth.user.orgId !== context.user.orgId)) throw new Error("工作机构或账号已改变，请重新确认作业范围。");
  return auth;
}

// Captures the account/environment at creation, so in-flight check-ins cannot
// cross an account or institution switch. No credentials enter IndexedDB.
export function checkinSession(auth: TeachingAuth) {
  const captured = authContexts.get(auth);
  if (!captured || !isCurrentAuthContext(captured)) throw new Error("登录会话已变化，请重新打开打卡");
  const isCurrent = () => isCurrentAuthContext(captured);
  const check = () => { if (!isCurrent()) throw Object.assign(new Error("账号或机构已切换"), { status: 409 }); };
  const send = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    check(); const value = await request<T>(path, init, activeAuth?.token); check(); return value;
  };
  const readPhoto = (path:string):Promise<Blob> => withRequestDeadline(signal => readPhotoOnce(path,signal));
  const readPhotoOnce = async (path: string, signal:AbortSignal, retry = true): Promise<Blob> => {
    check(); const headers = new Headers({ "x-xiangqi-app-id": appId(), authorization: `Bearer ${activeAuth?.token}` });
    const response = await fetch(`${captured.serverUrl}${path}`, { signal, headers, credentials: "include" }); check();
    if (response.status === 401 && retry && await refreshAuth(signal)) { check(); signal.throwIfAborted(); return readPhotoOnce(path, signal, false); }
    if (!response.ok) throw Object.assign(new Error(userFacingError(undefined, response.status)), { status: response.status });
    const blob = await response.blob(); signal.throwIfAborted(); check(); return blob;
  };
  return { api: makeCheckinApi(send, readPhoto, () => teachingClient.teacherClasses(auth), id => teachingClient.teacherClassStudents(id)),
    scope: JSON.stringify([captured.serverUrl, auth.user.id, auth.user.orgId]), isCurrent };
}
