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
    localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
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
  await page.route('https://api*.qixiapp.cn/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = [], status = 200;
    if (path.endsWith('/auth/refresh')) {
      state.refreshes++;
      if (state.mode === 'refresh-hang') { state.held.push(route); return; }
      body = { token: `mock-${state.refreshes}`, expiresAt: '2099-01-01T00:00:00Z', user: { id: state.ownerId, orgId: 'org', role: 'student', displayName: '回归学生' } };
    } else if (path.endsWith('/capabilities')) {
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
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const mode of ['create-hang', 'body-hang', 'refresh-hang', 'capabilities-hang']) {
      const f = await fixture(browser);
      f.state.mode = mode;
      if (mode === 'body-hang') await f.page.evaluate(() => { window.hangPracticeBody = true; });
      const boundary = mode === 'capabilities-hang' ? '/capabilities' : '/daily/daily/session';
      const sent = f.page.waitForRequest(r => r.url().endsWith(boundary));
      await f.start(); await sent;
      if (mode === 'refresh-hang') await f.page.waitForRequest(r => r.url().endsWith('/auth/refresh'));
      if (mode === 'body-hang') await f.page.waitForTimeout(50);
      await f.page.clock.runFor(15_100);
      await f.page.getByRole('alert').filter({ hasText: /超时/ }).waitFor();
      assert.equal(await f.page.locator('.mobile-practice-feature > button').isEnabled(), true, `${mode}: creation lock releases`);
      assert.equal(f.state.writes, mode === 'capabilities-hang' ? 0 : 1, 'no automatic POST retries');
      f.state.mode = 'ok';
      await f.page.evaluate(() => { window.hangPracticeBody = false; });
      // Resolve the old response after timeout: it must never open a board.
      for (const held of f.state.held) await held.fulfill({ contentType: 'application/json', body: JSON.stringify(f.state.session) }).catch(() => {});
      await f.page.waitForTimeout(50);
      assert.equal(await f.page.locator('.mobile-solver-page').count(), 0, 'late response cannot navigate');
      await f.page.getByRole('button', { name: '重试', exact: true }).click();
      await f.page.locator('.mobile-solver-page').waitFor();
      await f.finish(); console.log(`${mode}: deadline, unlock, late response and retry passed`);
    }
    {
      const f = await fixture(browser); f.state.mode = 'topic-hang';
      const sent = f.page.waitForRequest(r => r.url().endsWith('/practice/topics/topic'));
      await f.openTopic(); await sent; await f.page.clock.runFor(15_100);
      await f.page.getByRole('alert').filter({ hasText: /超时/ }).waitFor();
      f.state.mode = 'ok'; await f.page.getByRole('button', { name: '重试', exact: true }).click();
      await f.page.getByRole('button', { name: /开始训练/ }).waitFor();
      assert(f.page.url().endsWith('/practice/topics/topic'), 'topic URL retains its identity');
      await f.page.reload();
      await f.page.getByRole('button', { name: /开始训练/ }).click(); await f.page.locator('.mobile-solver-page').waitFor();
      await f.finish(); console.log('topic: timeout, retry, detail and solver passed');
    }
    {
      const f = await fixture(browser); f.state.mode = 'create-hang';
      const sent = f.page.waitForRequest(r => r.url().endsWith('/daily/daily/session'));
      await f.start(); await sent;
      await f.daily().evaluate(button => button.click());
      assert.equal(f.state.writes, 1, 'both daily entries share one lock');
      await f.openTopic(); await f.page.getByRole('button', { name: /开始训练/ }).waitFor();
      const secondSent = f.page.waitForRequest(r => r.url().endsWith('/practice/sessions'));
      await f.page.getByRole('button', { name: /开始训练/ }).click(); await secondSent;
      await f.state.held[0].fulfill({ contentType: 'application/json', body: JSON.stringify(f.state.session) }).catch(() => {});
      await f.page.waitForTimeout(50);
      assert.equal(await f.page.locator('.mobile-solver-page').count(), 0, 'leaving cancels stale creation');
      assert.equal(await f.page.locator('.mobile-detail-primary').isDisabled(), true, 'the old operation cannot release the newer lock');
      await f.state.held[1].fulfill({ contentType: 'application/json', body: JSON.stringify(f.state.session) });
      await f.page.locator('.mobile-solver-page').waitFor();
      await f.finish(); console.log('creation: shared lock, topic navigation, cancellation and newer lock passed');
    }
    {
      const f = await fixture(browser);
      await f.page.evaluate(async () => {
        const core = await import('/wasm/xiangqi_web_core.js'); await core.default();
        window.savedStateJson = core.WebGame.prototype.stateJson;
        core.WebGame.prototype.stateJson = () => { throw new Error('模拟棋盘初始化失败'); };
      });
      await f.daily().click(); await f.page.getByRole('alert').filter({ hasText: /打开题目失败/ }).waitFor();
      assert.equal(await f.page.locator('.mobile-solver-page').count(), 0);
      assert.equal(f.state.writes, 1);
      await f.page.evaluate(async () => { const core = await import('/wasm/xiangqi_web_core.js'); core.WebGame.prototype.stateJson = window.savedStateJson; });
      await f.page.getByRole('button', { name: '重试', exact: true }).click(); await f.page.locator('.mobile-solver-page').waitFor();
      assert.equal(f.state.writes, 1, 'initialization retry reuses the created session');
      await f.finish(); console.log('initialization: failure stays on source page, retry reuses session');
    }
    {
      const f = await fixture(browser);
      await f.page.evaluate(async () => {
        const { trainingStore } = await import('/src/store.ts');
        window.savedAttempts = trainingStore.attempts;
        trainingStore.attempts = () => new Promise(resolve => { window.releaseAttempts = resolve; });
      });
      await f.start();
      await f.page.waitForFunction(() => typeof window.releaseAttempts === 'function');
      await f.page.clock.runFor(15_100);
      await f.page.getByRole('alert').filter({ hasText: /打开题目失败.*超时/ }).waitFor();
      await f.page.evaluate(async () => {
        const { trainingStore } = await import('/src/store.ts'); trainingStore.attempts = window.savedAttempts;
        window.releaseAttempts([]);
      });
      await f.page.getByRole('button', { name: '重试', exact: true }).click(); await f.page.locator('.mobile-solver-page').waitFor();
      assert.equal(f.state.writes, 1, 'stalled local initialization retries the cached session');
      await f.finish(); console.log('initialization: stalled local read is bounded and retry preserves the session');
    }
    for (const exit of ['back', 'account']) {
      const f = await fixture(browser); f.state.mode = 'create-hang';
      if (exit === 'back') {
        await f.openTopic();
        const sent = f.page.waitForRequest(r => r.url().endsWith('/practice/sessions'));
        await f.page.getByRole('button', { name: /开始训练/ }).click(); await sent;
        await f.page.goBack(); await f.page.getByText('开始今日练习', { exact: true }).waitFor();
      } else {
        const sent = f.page.waitForRequest(r => r.url().endsWith('/daily/daily/session'));
        await f.start(); await sent; f.state.ownerId = 'second-student';
        await f.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await f.page.waitForFunction(async () => (await import('/src/teaching.ts')).teachingClient.auth()?.user.id === 'second-student');
      }
      await f.page.waitForFunction(() => !document.querySelector('.mobile-practice-feature > button')?.disabled);
      for (const held of f.state.held) await held.fulfill({ contentType: 'application/json', body: JSON.stringify(f.state.session) }).catch(() => {});
      await f.page.clock.runFor(16_000);
      assert.equal(await f.page.locator('.mobile-solver-page').count(), 0);
      assert.equal(await f.page.getByRole('alert').count(), 0, 'stale operation must not show an error on the new page/account');
      await f.finish(); console.log(`${exit}: pending creation cancelled and stale response ignored`);
    }
    for (const width of [390, 800, 1280]) {
      const f = await fixture(browser, width);
      const layout = await f.daily().evaluate(button => {
        const box = button.getBoundingClientRect(), parent = button.parentElement.getBoundingClientRect();
        const text = button.querySelector('span').getBoundingClientRect(), arrow = button.lastElementChild.getBoundingClientRect();
        return { width: box.width, parent: parent.width, radius: getComputedStyle(button).borderRadius, height: box.height, arrowFits: arrow.left >= text.right && arrow.right <= box.right };
      });
      assert(Math.abs(layout.width - layout.parent) < 2, `${width}: full-width daily card`);
      assert.equal(layout.radius, '8px'); assert(layout.height >= 58); assert(layout.arrowFits);
      assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await f.page.screenshot({ path: `/tmp/practice-recovery-${width}.png` });
      await f.daily().click(); await f.page.locator('.mobile-solver-page').waitFor();
      await f.finish(); console.log(`${width}: unified card and daily entry passed`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
