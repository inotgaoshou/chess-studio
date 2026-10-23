// Synthetic verification responses + real browser/WASM: rejected moves never advance training.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.PRACTICE_URL || 'http://127.0.0.1:1443';
const fen = '3a5/2P1n1N2/3k1a3/9/9/9/9/3A5/9/4K4 w - - 0 1';
async function fixture(browser, outcome = 'wrong', width = 390) {
  const page = await browser.newPage({ viewport: { width, height: width === 1280 ? 800 : 1000 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const state = { outcome, verifications: 0, analyses: 0, writes: [] };
  const user = { id: 'verdict-student', orgId: 'fixture', displayName: '判题验收', role: 'student' };
  const problem = { id: 'p1', libraryId: 'lib', title: '图2', sourceIndex: 0, category: '杀法', startingFen: fen, sideToMove: 'red', solution: [], note: '' };
  const topic = { id: 'topic', name: '基础杀法', itemCount: 1, contentKind: 'problem', sources: [{ libraryId: 'lib' }] };
  const session = { id: 's1', sourceKind: 'daily', mode: 'solver', status: 'active', items: [{ id: 'i1', ordinal: 0, status: 'pending', problem }] };
  await page.addInitScript(() => {
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
    localStorage.setItem('xiangqi-teaching-session-server', 'http://127.0.0.1:8090');
  });
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let body = [], status = 200;
    if (path.endsWith('/auth/refresh')) body = { token: 'fixture', expiresAt: '2099-01-01T00:00:00Z', user };
    else if (path.endsWith('/auth/me')) body = user;
    else if (path.endsWith('/capabilities')) body = {};
    else if (path.endsWith('/practice/dashboard')) body = { topics: [topic], studyTopics: [], history: [], dailyPlan: { id: 'daily', topic, itemCount: 1, mode: 'solver' } };
    else if (path.endsWith('/daily/daily/session')) body = session;
    else if (path.endsWith('/verify-move')) {
      state.verifications++;
      body = { outcome: state.outcome, message: state.outcome === 'wrong' ? '这步未达到题目目标，请再试试。' : state.outcome === 'correct' ? '正确，继续完成题目。' : '待复核：题目缺少可计算的目标条件，错误次数未增加', path: state.outcome === 'correct' ? ['g8f6', 'e8f6'] : [], autoMoves: state.outcome === 'correct' ? ['e8f6'] : [], completed: false, reviewKind: state.outcome === 'pending_review' ? 'missing_conditions' : undefined, verifierVersion: 'training-multisolution-v1' };
    } else if (path.endsWith('/analysis')) {
      state.analyses++;
      body = { engine: 'fixture', elapsedMs: 1, lines: [{ multipv: 1, pv: ['e8f6'] }] };
    } else if (path.includes('/practice/sessions/')) {
      if (request.method() !== 'GET') state.writes.push(request.postDataJSON());
      body = session;
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(url + '/practice');
  await page.locator('.mobile-practice-feature > button').click();
  const board = page.locator('.mobile-solver-page .xiangqi-board'); await board.waitFor();
  const square = name => board.getByRole('button', { name, exact: true });
  async function move() { await square('g8 红马').click(); await square('f6').click(); }
  async function finish() {
    assert.deepEqual(errors, []);
    await page.close();
  }
  return { page, state, board, square, move, finish };
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 800, 1280]) {
      for (const outcome of ['wrong', 'pending_review']) {
        const f = await fixture(browser, outcome, width);
        await f.move();
        const verdict = f.page.locator('.training-move-verdict');
        await verdict.waitFor();
        assert.equal(await verdict.getAttribute('role'), outcome === 'wrong' ? 'alert' : 'status');
        assert((await verdict.innerText()).includes(outcome === 'wrong' ? '已错 1 次' : '暂不计分'));
        assert.equal(await f.square('g8 红马').count(), 1); assert.equal(await f.square('e8 黑马').count(), 1);
        assert.equal(await f.board.locator('.selected, .legal-target, .last-to').count(), 0);
        assert.equal(f.state.analyses, 0, 'rejected candidate never triggers AI retaliation');
        assert(f.state.writes.every(body => !body.draft?.moves?.length && body.outcome !== 'completed'));
        assert.equal(await f.page.locator('.mobile-solver-result').count(), 0);
        const box = await verdict.boundingBox(); assert(box.width > 200 && box.x >= 0 && box.x + box.width <= width);
        if (process.env.TRAINING_VERDICT_SCREENSHOTS) {
          require('node:fs').mkdirSync(process.env.TRAINING_VERDICT_SCREENSHOTS, { recursive: true });
          await f.page.screenshot({ path: require('node:path').join(process.env.TRAINING_VERDICT_SCREENSHOTS, `${width}-${outcome}.png`), fullPage: true });
        }
        await f.move(); await verdict.waitFor();
        if (outcome === 'wrong') await verdict.getByText(/已错 2 次/).waitFor();
        else assert(!(await verdict.innerText()).includes('已错'));
        assert.equal(f.state.verifications, 2, 'retry is unlocked after rejection');
        // A later accepted move must clear stale warnings and preserve ordinary AI reply/progress behavior.
        const saved = f.page.waitForRequest(request => request.method() === 'PATCH' && request.postDataJSON()?.draft?.moves?.join(',') === 'g8f6,e8f6');
        f.state.outcome = 'correct'; await f.move(); await f.square('f6 黑马').waitFor(); await saved;
        assert.equal(await verdict.count(), 0);
        assert(f.state.writes.some(body => body.draft?.moves?.join(',') === 'g8f6,e8f6'));
        assert(f.state.writes.every(body => body.outcome !== 'completed'));
        await f.finish(); console.log(`PASS ${width}px ${outcome}: no move/AI/progress, clear selection, retry, accepted continuation`);
      }
    }
    {
      const f = await fixture(browser); await f.square('g8 红马').click(); await f.square('f7 黑士').click();
      await f.page.getByRole('alert').getByText(/这步不合法/).waitFor();
      assert.equal(f.state.verifications, 0); assert.equal(f.state.analyses, 0);
      assert.equal(await f.square('g8 红马').count(), 1); await f.finish();
      console.log('PASS illegal horse move is rejected before verification or AI');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
