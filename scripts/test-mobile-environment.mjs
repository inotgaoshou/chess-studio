import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const appRoot = new URL("../apps/endgame-training/", import.meta.url);
const require = createRequire(new URL("package.json", appRoot));
const ts = require("typescript");
const TEST_URL = "https://api-test.qixiapp.cn";
const LIVE_URL = "https://api.qixiapp.cn";
const auth = { token: "access", refreshToken: "refresh", expiresAt: "2099-01-01", user: { id: "u1", role: "user" } };

test("practice scoring separates completion, stars and first-try correctness", () => {
  const { practiceScore, firstTryCorrect } = harness().load("practiceScoring");
  for (const [mistakes, expected] of [[0, 3], [1, 2], [2, 1], [3, 0], [4, 0]]) {
    assert.equal(practiceScore("completed", mistakes), expected);
    assert.equal(firstTryCorrect("completed", mistakes, 0), mistakes === 0);
  }
  assert.equal(firstTryCorrect("completed", 0, 1), false);
  assert.equal(practiceScore("revealed", 0), 0);
  assert.equal(practiceScore("abandoned", 0), 0);
});

function harness({ packageEnv = "test", native = true, dev = false, configured = "", entries = [], stored, fetchImpl, queued = {} } = {}) {
  const values = new Map(entries);
  const calls = [];
  let session = stored;
  const stores = Object.fromEntries(["assignments", "assignmentCaches", "attempts", "practiceAttempts", "assignmentViews", "assignmentDrafts", "assignmentAnswers"].map((name) => [name, new Map((queued[name] || []).map((item) => [name === "assignmentAnswers" ? item.cacheKey : item.clientAttemptId || item.cacheKey, structuredClone(item)]))]));
  const indexedDB = { open() {
    const opening = { result: { objectStoreNames: { contains: () => true }, close() {}, transaction(name) {
      const transaction = { objectStore: () => ({
        put(value) { stores[name].set(name === "assignmentAnswers" ? value.cacheKey : value.clientAttemptId || value.cacheKey, structuredClone(value)); queueMicrotask(() => transaction.oncomplete?.()); },
        delete(key) { stores[name].delete(key); queueMicrotask(() => transaction.oncomplete?.()); },
        getAll() { const request = { result: [...stores[name].values()].map((value) => structuredClone(value)) }; queueMicrotask(() => request.onsuccess?.()); return request; },
      }) };
      return transaction;
    } } };
    queueMicrotask(() => opening.onsuccess?.());
    return opening;
  } };
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const context = vm.createContext({
    localStorage, indexedDB, Headers, __APP_ENV__: packageEnv,
    runtimeEnv: { DEV: dev, VITE_TEACHING_API_BASE: configured },
    fetch: async (...args) => {
      calls.push(args);
      return fetchImpl ? fetchImpl(...args) : { ok: true, json: async () => structuredClone(auth) };
    },
  });
  function load(name, dependencies = {}) {
    const source = readFileSync(new URL(`src/${name}.ts`, appRoot), "utf8").replaceAll("import.meta.env", "runtimeEnv");
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports = {};
    context.exports = exports;
    context.require = (id) => {
      if (!(id in dependencies)) throw new Error(`Unexpected runtime dependency ${id}`);
      return dependencies[id];
    };
    vm.runInContext(`(function(exports, require) { ${outputText}\n})(exports, require)`, context);
    return exports;
  }
  const environment = load("appEnvironment");
  const { teachingClient } = load("teaching", {
    "./appEnvironment": environment,
    "./practiceScoring": load("practiceScoring"),
    "./secureSession": {
      isNativeSessionStore: () => native,
      secureSession: {
        load: async () => session,
        save: async (next) => { session = next; },
        clear: async () => { session = undefined; },
        deviceId: () => "device",
      },
    },
  });
  return { environment, client: teachingClient, calls, values, stores, session: () => session, load };
}

test("test package defaults to test, persists a switch, and can switch back", async () => {
  const h = harness();
  assert.equal(h.client.serverUrl(), TEST_URL);
  await h.client.setEnvironment("production");
  assert.equal(h.client.serverUrl(), LIVE_URL);
  const restarted = harness({ entries: [...h.values] });
  assert.equal(restarted.client.serverUrl(), LIVE_URL);
  await restarted.client.setEnvironment("test");
  assert.equal(restarted.client.serverUrl(), TEST_URL);
  assert.equal(h.environment.packageEnvironmentLabel, "测试版");
});

test("production ignores saved environments, custom URLs, and build URL overrides", async () => {
  const h = harness({ packageEnv: "production", configured: TEST_URL, entries: [
    ["xiangqi-teaching-environment", "test"], ["xiangqi-teaching-server-url", TEST_URL],
  ] });
  assert.equal(h.client.serverUrl(), LIVE_URL);
  assert.equal(h.environment.packageEnvironmentLabel, "正式版");
  await assert.rejects(h.client.setEnvironment("test"), /正式版/);
  assert.equal(h.client.serverUrl(), LIVE_URL);
});

test("local development keeps its gateway configuration", () => {
  assert.equal(harness({ dev: true }).client.serverUrl(), "http://127.0.0.1:8090");
  assert.equal(harness({ dev: true, configured: "http://localhost:9000/" }).client.serverUrl(), "http://localhost:9000");
});

for (const server of [undefined, LIVE_URL]) {
  test(`native restore rejects ${server ? "another server's" : "legacy"} credentials before any request`, async () => {
    const h = harness({ stored: { ...auth, auth, serverUrl: server } });
    assert.equal(await h.client.restore(), undefined);
    assert.equal(h.calls.length, 0);
    assert.equal(h.session(), undefined);
  });
}

test("login saves server ownership; switching requires logout and preserves unrelated data", async () => {
  const h = harness({ entries: [["local-manual", "keep"], ["cached-assignment", "keep"]] });
  await h.client.login("user", "password");
  assert.equal(h.session().serverUrl, TEST_URL);
  await assert.rejects(h.client.setEnvironment("production"), /退出登录/);
  await h.client.logout();
  await h.client.setEnvironment("production");
  assert.equal(h.session(), undefined);
  assert.equal(h.client.auth(), undefined);
  assert.equal(h.values.get("local-manual"), "keep");
  assert.equal(h.values.get("cached-assignment"), "keep");
  await h.client.login("user", "password");
  assert.equal(h.session().serverUrl, LIVE_URL);
  assert.equal(h.calls.at(-1)[0], `${LIVE_URL}/api/v1/auth/login`);
});

test("matching native session can refresh", async () => {
  const h = harness({ stored: { ...auth, auth, serverUrl: TEST_URL } });
  assert.equal((await h.client.restore()).token, "access");
  assert.equal(h.calls[0][0], `${TEST_URL}/api/v1/auth/refresh`);
});

test("refresh arriving after an environment switch cannot restore old authentication", async () => {
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const h = harness({ stored: { ...auth, auth, serverUrl: TEST_URL }, fetchImpl: () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  } });
  const refresh = h.client.refreshSession();
  await ready;
  await h.client.setEnvironment("production");
  finish({ ok: true, json: async () => auth });
  assert.equal(await refresh, undefined);
  assert.equal(h.client.auth(), undefined);
  assert.equal(h.session(), undefined);
});

test("browser restore requires matching server ownership even with cookies", async () => {
  const h = harness({ native: false });
  assert.equal(await h.client.restore(), undefined);
  assert.equal(h.calls.length, 0);
  await h.client.login("user", "password");
  assert.equal(h.values.get("xiangqi-teaching-session-server"), TEST_URL);
  assert.equal((await h.client.refreshSession()).token, "access");
  assert.equal(h.calls.at(-1)[0], `${TEST_URL}/api/v1/auth/refresh`);
  await h.client.logout();
  await h.client.setEnvironment("production");
  const before = h.calls.length;
  assert.equal(await h.client.restore(), undefined);
  assert.equal(h.calls.length, before);
});

test("native clear waits for a pending save so old credentials cannot reappear", async () => {
  let finishSave;
  let saved;
  const events = [];
  const { load } = harness();
  const { secureSession } = load("secureSession", {
    "@capacitor/core": {
      Capacitor: { isNativePlatform: () => true },
      registerPlugin: () => ({
        save: async ({ session }) => {
          events.push("save");
          await new Promise((resolve) => { finishSave = resolve; });
          saved = session;
        },
        clear: async () => { events.push("clear"); saved = undefined; },
        load: async () => ({ session: saved }),
      }),
    },
  });
  const saving = secureSession.save({ ...auth, serverUrl: TEST_URL });
  await Promise.resolve();
  const clearing = secureSession.clear();
  assert.deepEqual(events, ["save"]);
  finishSave();
  await Promise.all([saving, clearing]);
  assert.deepEqual(events, ["save", "clear"]);
  assert.equal(await secureSession.load(), undefined);
});

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
for (const method of ["switchOrganization", "leaveOrganization"]) {
  const endpoint = method === "switchOrganization" ? "switch-organization" : "leave-organization";
  test(`${method} keeps the rotated refresh token after a 401 retry`, async () => {
    let changes = 0;
    const rotated = { ...auth, token: "rotated-access", refreshToken: "rotated-refresh" };
    const h = harness({ fetchImpl: (url, options) => {
      if (url.endsWith("/auth/refresh")) return response(rotated);
      if (url.endsWith(`/auth/${endpoint}`)) {
        if (++changes === 1) return response({}, 401);
        assert.equal(options.headers.get("authorization"), "Bearer rotated-access");
        return response({ ...rotated, token: "org-access", refreshToken: undefined, user: { ...auth.user, orgId: "org-next" } });
      }
      return response(auth);
    } });
    await h.client.login("user", "password");
    const changed = await h.client[method]("org-next");
    assert.equal(changed.refreshToken, "rotated-refresh");
    assert.equal(h.session().refreshToken, "rotated-refresh");
    assert.equal(h.client.auth().user.orgId, "org-next");
  });

  for (const loginAgain of [false, true]) {
    test(`${method} ignores a late result after ${loginAgain ? "account replacement" : "logout"}`, async () => {
      let finish;
      let started;
      const ready = new Promise((resolve) => { started = resolve; });
      const other = { ...auth, token: "other-access", refreshToken: "other-refresh", user: { id: "u2", role: "user" } };
      const h = harness({ fetchImpl: (url, options) => {
        if (url.endsWith(`/auth/${endpoint}`)) { started(); return new Promise((resolve) => { finish = resolve; }); }
        if (url.endsWith("/auth/login")) return response(JSON.parse(options.body).account === "other" ? other : auth);
        return response({});
      } });
      await h.client.login("user", "password");
      const pending = h.client[method]("org-next");
      const rejected = assert.rejects(pending, /账号或机构已变化/);
      await ready;
      await h.client.logout();
      if (loginAgain) await h.client.login("other", "password");
      finish(response({ ...auth, user: { ...auth.user, orgId: "org-next" } }));
      await rejected;
      assert.equal(h.client.auth()?.user.id, loginAgain ? "u2" : undefined);
      assert.equal(h.session()?.token, loginAgain ? "other-access" : undefined);
    });
  }
}

test("an old authenticated request cannot refresh or retry as another account", async () => {
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const other = { ...auth, token: "other-access", refreshToken: "other-refresh", user: { id: "u2", role: "user" } };
  const h = harness({ fetchImpl: (url, options) => {
    if (url.endsWith("/personal-manual-sync/status")) { started(); return new Promise((resolve) => { finish = resolve; }); }
    if (url.endsWith("/auth/login")) return response(JSON.parse(options.body).account === "other" ? other : auth);
    return response({});
  } });
  await h.client.login("user", "password");
  const pending = h.client.personalManualSyncStatus();
  const rejected = assert.rejects(pending, /账号或机构已变化/);
  await ready;
  await h.client.logout();
  await h.client.login("other", "password");
  finish(response({}, 401));
  await rejected;
  assert.equal(h.calls.filter(([url]) => url.endsWith("/auth/refresh")).length, 0);
  assert.equal(h.calls.filter(([url]) => url.endsWith("/personal-manual-sync/status")).length, 1);
  assert.equal(h.client.auth().user.id, "u2");
});

const assignmentAttempt = { clientAttemptId: "attempt-1", assignmentId: "assignment", problemId: "problem", moves: ["a0a1"], elapsedMs: 1000, hintsUsed: 0, mistakes: 0, outcome: "completed", completedAt: "2026-10-01T00:00:00Z" };
const practiceAttempt = { clientAttemptId: "practice-1", itemId: "item", moves: ["a0a1"], elapsedMs: 1000, hintsUsed: 0, mistakes: 0, outcome: "completed" };

test("completed homework remains local until reviewed IDs are explicitly submitted", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const h = harness({ fetchImpl: (url) => response(url.endsWith("/auth/login") ? student : {}) });
  await h.client.login("student", "password");
  await h.client.saveAssignmentAnswer(assignmentAttempt);
  await h.client.flushPending();
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  assert.equal(h.stores.assignmentAnswers.size, 1);
  const answers = await h.client.assignmentAnswers("assignment");
  assert.equal(answers[0].submissionRequested, false);
  assert.equal(answers[0].ownerId, "student");
  await assert.rejects(h.client.submitAssignmentAnswers("assignment", ["stale-review"]), /已变化/);
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  const result = await h.client.submitAssignmentAnswers("assignment", [assignmentAttempt.clientAttemptId]);
  assert.equal(result.submitted, 1); assert.equal(result.pending, 0);
  assert.equal(h.stores.assignmentAnswers.size, 0);
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 1);
});

test("manual submission and reconnect share one in-flight homework request", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  let release;
  let started;
  const sent = new Promise((resolve) => { started = resolve; });
  const h = harness({ fetchImpl: (url) => {
    if (url.endsWith("/auth/login")) return response(student);
    if (url.endsWith("/attempts")) { started(); return new Promise((resolve) => { release = () => resolve(response({})); }); }
    return response({});
  } });
  await h.client.login("student", "password");
  await h.client.saveAssignmentAnswer(assignmentAttempt);
  const manual = h.client.submitAssignmentAnswers("assignment", [assignmentAttempt.clientAttemptId]);
  await sent;
  const reconnect = h.client.flushPending();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 1);
  release();
  await Promise.all([manual, reconnect]);
  assert.equal(h.stores.attempts.size, 0);
  assert.equal(h.stores.assignmentAnswers.size, 0);
});

test("confirmed offline homework retries the same ID while unconfirmed answers remain private", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  let offline = true;
  const sent = [];
  const h = harness({ fetchImpl: (url, options) => {
    if (url.endsWith("/auth/login")) return response(student);
    if (url.endsWith("/attempts")) { sent.push(JSON.parse(options.body).clientAttemptId); if (offline) throw new Error("offline"); }
    return response({});
  } });
  await h.client.login("student", "password");
  await h.client.saveAssignmentAnswer(assignmentAttempt);
  await h.client.saveAssignmentAnswer({ ...assignmentAttempt, clientAttemptId: "private-answer", problemId: "other-problem" });
  const result = await h.client.submitAssignmentAnswers("assignment", [assignmentAttempt.clientAttemptId]);
  assert.equal(result.pending, 1);
  await assert.rejects(h.client.clearAssignmentAnswer("assignment", "problem"), /已确认提交/);
  offline = false;
  await h.client.flushPending();
  assert.deepEqual(sent, ["attempt-1", "attempt-1"]);
  assert.equal(h.stores.assignmentAnswers.size, 1);
  assert.equal((await h.client.assignmentAnswers("assignment"))[0].clientAttemptId, "private-answer");
});

test("unreviewed legacy automatic queues do not submit during refresh", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const legacy = { ...assignmentAttempt, ownerId: "student", orgId: "org", serverUrl: TEST_URL };
  const h = harness({ queued: { attempts: [legacy] }, fetchImpl: () => response(student) });
  await h.client.login("student", "password");
  await h.client.flushPending();
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  assert.equal((await h.client.assignmentAnswers("assignment"))[0].clientAttemptId, "attempt-1");
});

test("local homework answers survive account changes without becoming another student's answers", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const other = { ...student, token: "other-token", user: { ...student.user, id: "other" } };
  const h = harness({ fetchImpl: (url, options) => response(url.endsWith("/auth/login") && JSON.parse(options.body).account === "other" ? other : student) });
  const original = await h.client.login("student", "password");
  await h.client.logout(); await h.client.login("other", "password");
  await h.client.saveAssignmentAnswer(assignmentAttempt, original);
  assert.equal((await h.client.assignmentAnswers("assignment")).length, 0);
  await assert.rejects(h.client.submitAssignmentAnswers("assignment", ["attempt-1"]), /已变化/);
  await h.client.flushPending();
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  assert.equal([...h.stores.assignmentAnswers.values()][0].ownerId, "student");
});

for (const practice of [false, true]) {
  const storeName = practice ? "practiceAttempts" : "attempts";
  const attempt = practice ? practiceAttempt : assignmentAttempt;
  test(`${storeName} is persisted before sending and survives an offline failure`, async () => {
    const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
    let offline = true;
    const h = harness({ fetchImpl: (url) => {
      if (url.endsWith("/attempts")) {
        assert.equal(h.stores[storeName].get(attempt.clientAttemptId).ownerId, "student");
        if (offline) throw new Error("offline");
        return response({ id: "accepted" });
      }
      return response(student);
    } });
    await h.client.login("student", "password");
    if (practice) await assert.rejects(h.client.submitPracticeAttempt("session", attempt), /offline/);
    else assert.equal(await h.client.submit(attempt), false);
    assert.equal(h.stores[storeName].size, 1);
    offline = false;
    await h.client.flushPending();
    assert.equal(h.stores[storeName].size, 0);
    assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 2);
  });

  test(`${storeName} keeps original account/environment ownership after logout and environment change`, async () => {
    const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
    const other = { ...auth, token: "other-token", user: { id: "other", orgId: "org", role: "student" } };
    const h = harness({ fetchImpl: (url, options) => url.endsWith("/auth/login") ? response(JSON.parse(options.body).account === "other" ? other : student) : response({}) });
    const original = await h.client.login("student", "password");
    await h.client.logout();
    await h.client.setEnvironment("production");
    await h.client.login("other", "password");
    if (practice) await assert.rejects(h.client.submitPracticeAttempt("session", attempt, original), /原账号/);
    else assert.equal(await h.client.submit(attempt, original), false);
    assert.equal(h.stores[storeName].get(attempt.clientAttemptId).ownerId, "student");
    assert.equal(h.stores[storeName].get(attempt.clientAttemptId).serverUrl, TEST_URL);
    await h.client.flushPending();
    assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
    assert.equal(h.stores[storeName].size, 1);
  });
}

test("unowned legacy attempts are retained without being submitted by another account", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const h = harness({ queued: { attempts: [assignmentAttempt], practiceAttempts: [{ ...practiceAttempt, sessionId: "session" }] }, fetchImpl: () => response(student) });
  await h.client.login("student", "password");
  await h.client.flushPending();
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  assert.equal(h.stores.attempts.size, 1);
  assert.equal(h.stores.practiceAttempts.size, 1);
  assert.equal(await h.client.pendingAttemptCount(), 0);
});

test("pending submission stops after an account change without retrying a stale 401", async () => {
  let finish;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const other = { ...auth, token: "other-access", user: { id: "other", orgId: "org", role: "student" } };
  const ownership = { ownerId: "student", orgId: "org", serverUrl: TEST_URL, submissionRequested: true };
  const h = harness({ queued: { attempts: [{ ...assignmentAttempt, ...ownership }, { ...assignmentAttempt, ...ownership, clientAttemptId: "attempt-2" }], practiceAttempts: [{ ...practiceAttempt, sessionId: "session", ...ownership }] }, fetchImpl: (url, options) => {
    if (url.endsWith("/auth/login")) return response(JSON.parse(options.body).account === "other" ? other : student);
    if (url.endsWith("/attempts")) { started(); return new Promise((resolve) => { finish = resolve; }); }
    return response({});
  } });
  await h.client.login("student", "password");
  const flushing = h.client.flushPending();
  await ready;
  await h.client.logout();
  await h.client.login("other", "password");
  finish(response({}, 401));
  await flushing;
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 1);
  assert.equal(h.calls.filter(([url]) => url.endsWith("/auth/refresh")).length, 0);
  assert.equal(h.stores.attempts.size, 2);
  assert.equal(h.stores.practiceAttempts.size, 1);
});

test("pending counts and submission exclude another organization of the same account", async () => {
  const student = { ...auth, user: { id: "student", orgId: "org", role: "student" } };
  const h = harness({ queued: { attempts: [{ ...assignmentAttempt, ownerId: "student", orgId: "other-org", serverUrl: TEST_URL }] }, fetchImpl: () => response(student) });
  await h.client.login("student", "password");
  assert.equal(await h.client.pendingAttemptCount(), 0);
  await h.client.flushPending();
  assert.equal(h.calls.filter(([url]) => url.endsWith("/attempts")).length, 0);
  assert.equal(h.stores.attempts.size, 1);
});
