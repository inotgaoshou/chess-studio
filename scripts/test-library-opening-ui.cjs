const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.PRACTICE_URL || 'http://127.0.0.1:1448';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const topic = { id: 'topic', name: '基础杀法', description: '练习将军、叫杀和连续计算。', contentKind: 'problem', itemCount: 757, sources: [{ libraryId: 'lib' }] };
const problem = { id: 'p1', libraryId: 'lib', title: '练习恢复测试题', sourceIndex: 0, category: '杀法', startingFen: fen, sideToMove: 'red', solution: [{ iccs: 'a0a1', children: [] }], note: '' };
const makeSession = () => ({ id: 's1', sourceKind: 'daily', mode: 'solver', status: 'active', items: [{ id: 'i1', ordinal: 0, status: 'pending', problem }] });

async function fixture(browser, width = 800) {
  const page = await browser.newPage({ viewport: { width, height: width === 1280 ? 800 : 1280 }, screen: { width, height: width === 1280 ? 800 : 1280 }, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = { mode: 'ok', ownerId: 'student', writes: 0, topicReads: 0, refreshes: 0, capabilities: 0, held: [], session: makeSession() };
  await page.addInitScript(() => {
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
    localStorage.setItem('xiangqi-teaching-session-server', 'http://127.0.0.1:8090');
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      // A response whose headers arrive but whose JSON body never settles.
      if (window.hangPracticeBody && response.url.endsWith('/daily/daily/session')) {
        response.json = () => new Promise(() => {});
      }
      return response;
    };
  });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [], status = 200;
    if (path.endsWith('/auth/refresh')) {
      state.refreshes++;
      if (state.mode === 'refresh-hang') { state.held.push(route); return; }
      body = { token: `mock-${state.refreshes}`, expiresAt: '2099-01-01T00:00:00Z', user: { id: state.ownerId, orgId: 'org', role: 'student', displayName: '回归学生' } };
    } else if (path.endsWith('/auth/me')) { body = { id: state.ownerId, orgId: 'org', role: 'student', displayName: '回归学生' }; } else if (path.endsWith('/capabilities')) {
      state.capabilities++;
      if (state.mode === 'capabilities-hang') { state.held.push(route); return; }
      body = {};
    } else if (path.endsWith('/practice/dashboard')) body = { topics: [topic], studyTopics: [], history: [], dailyPlan: { id: 'daily', topic, itemCount: 10, mode: 'solver' } };
    else if (path.endsWith('/student/assignments')) body = { items: [] };
    else if (path.endsWith('/practice/topics/topic')) {
      state.topicReads++;
      if (state.mode === 'topic-hang') { state.held.push(route); return; }
      body = { ...topic, chapters: [] };
    } else if (path.endsWith('/daily/daily/session') || (path.endsWith('/practice/sessions') && route.request().method() === 'POST')) {
      state.writes++;
      if (state.mode === 'create-hang') { state.held.push(route); return; }
      if (state.mode === 'refresh-hang') { status = 401; body = { error: 'expired' }; }
      else if (state.mode === 'create-fail') { status = 503; body = { error: '创建失败，请重试' }; }
      else body = state.session;
    } else if (path.includes('/practice/sessions/')) body = state.session;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${url}/practice`);
  await page.getByText('开始今日练习', { exact: true }).waitFor();
  await page.clock.install();
  const start = () => page.locator('.mobile-practice-feature > button').click();
  const daily = () => page.locator('.mobile-practice-section').filter({ has: page.getByText('今日计划', { exact: true }) }).getByRole('button');
  const openTopic = () => page.locator('.mobile-practice-grid').getByRole('button', { name: /基础杀法/ }).click();
  const finish = async () => { assert.deepEqual(errors, []); await page.close(); };
  return { page, state, start, daily, openTopic, finish };
}

(async () => {
  const browser = await chromium.launch({channel: 'chrome', headless: true});
  try {
    const f = await fixture(browser);
    f.state.mode = 'create-hang';
    await f.page.evaluate(async () => {
      const {trainingStore} = await import('/src/store.ts');
      trainingStore.attempts = () => { window.cacheHeld = true; return new Promise(() => {}); };
    });
    const sent=f.page.waitForRequest(r=>r.url().endsWith('/daily/daily/session'));
    await f.start(); await sent;
    await f.page.clock.runFor(10_000);
    await f.state.held[0].fulfill({contentType:'application/json',body:JSON.stringify(f.state.session)});
    await f.page.waitForFunction(()=>window.cacheHeld);
    await f.page.clock.runFor(5_100);
    await f.page.getByRole('alert').filter({hasText:/超时/}).waitFor();
    assert.equal(f.state.writes,1);
    await f.finish();
    console.log('one overall deadline covers creation and local initialization');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
