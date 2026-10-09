const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1440';
const fs = require('node:fs');
fs.mkdirSync('tmp/mobile-input-analysis', { recursive: true });
async function keyboard(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1' });
  await page.addInitScript(() => {
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
    localStorage.setItem('xiangqi-teaching-session-server', 'http://127.0.0.1:8090');
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    window.testKeyboardViewport = (height, offsetTop) => { Object.assign(viewport, { height, offsetTop }); viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')); };
  });
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    let body = [];
    if (path.endsWith('/auth/refresh')) body = { token: 'fixture', expiresAt: '2099-01-01', user: { id: 'coach', orgId: 'org', orgName: '测试棋社', role: 'coach', displayName: '测试老师', loginName: 'coach' } };
    if (path.endsWith('/classes')) body = [{ id: 'class', name: '测试班级', studentCount: 1, coachCount: 1 }];
    if (path.endsWith('/students')) body = [{ id: 'student', displayName: '测试学生', loginName: 'student' }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  page.on('pageerror', error => console.error(error.message));
  await page.goto(`${url}/teacher`);
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^班级与学生/ }).click();
  await page.getByRole('button', { name: /^测试班级/ }).click();
  const field = page.getByRole('textbox', { name: '班级名称', exact: true });
  await field.waitFor();
  await field.focus();
  // WKWebView pans its layout viewport as well as reducing the visible height.
  await page.evaluate(() => window.testKeyboardViewport(360, 150));
  await page.waitForTimeout(150);
  let bounds = await field.boundingBox();
  await page.screenshot({ path: 'tmp/mobile-input-analysis/iphone-keyboard.png' });
  assert(bounds.y >= 150 && bounds.y + bounds.height <= 510, `rename field outside visual viewport: ${JSON.stringify(bounds)}`);
  const password = page.locator('.teacher-mobile-form input[type=password]');
  await password.focus();
  await page.evaluate(() => window.testKeyboardViewport(360, 220));
  await page.waitForTimeout(150);
  bounds = await password.boundingBox();
  assert(bounds.y >= 220 && bounds.y + bounds.height <= 580, `password outside visual viewport: ${JSON.stringify(bounds)}`);
  await password.fill('visible-password');
  assert.equal(await password.inputValue(), 'visible-password');
  await page.evaluate(() => { document.activeElement.blur(); window.testKeyboardViewport(844, 0); });
  await page.waitForTimeout(150);
  assert.equal(await page.locator('html').evaluate(el => el.classList.contains('keyboard-open')), false);
  await page.evaluate(async () => {
    const { ManualSaveDialog } = await import('/src/ManualSaveDialog.tsx');
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const host = document.createElement('div'); document.getElementById('root').append(host);
    createRoot(host).render(React.createElement(ManualSaveDialog, { game: { title: '键盘测试棋谱', note: '', createdAt: '2026-10-01T00:00:00Z', startingFen: 'w' }, folders: [], onSave: async () => {}, onCreateFolder: async () => {}, onClose: () => {} }));
  });
  const title = page.getByRole('textbox', { name: '棋谱名称', exact: true });
  await title.waitFor();
  await page.evaluate(() => window.testKeyboardViewport(360, 180));
  await page.waitForTimeout(150);
  bounds = await title.boundingBox();
  assert(bounds.y >= 180 && bounds.y + bounds.height <= 540, 'save-dialog title remains visible without applying the iOS pan twice');
  const note = page.getByRole('textbox', { name: '备注', exact: true });
  await note.focus();
  await page.waitForTimeout(150);
  bounds = await note.boundingBox();
  assert(bounds.y >= 180 && bounds.y + bounds.height <= 540, 'save-dialog lower textarea remains visible');
  await page.screenshot({ path: 'tmp/mobile-input-analysis/iphone-save-keyboard.png' });
  await page.close();
  console.log('PASS iPhone keyboard pan, resize, lower form field, typing and dismissal');
}
async function analysis(browser) {
  for (const viewport of [{ width: 800, height: 1280 }, { width: 1024, height: 1366 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true });
    await page.addInitScript(() => localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done'));
    await page.route('**/api/v1/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.route('**/src/App.tsx', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + '\nexport { AnalysisPanel };' });
    });
    await page.goto(url);
    await page.evaluate(async () => {
      const { AnalysisPanel } = await import('/src/App.tsx');
      const React = (await import('/node_modules/.vite/deps/react.js')).default;
      const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
      document.getElementById('root').style.display = 'none';
      const host = document.createElement('div'); document.body.append(host);
      const noop = () => {};
      const lines = [125, 0, -75, 310].map((scoreCp, index) => ({ multipv: index + 1, depth: 22, scoreCp, nodes: 123456, nps: 60000, pv: ['a0a1', 'a9a8'], notation: ['车九进一', '车１进１'] }));
      createRoot(host).render(React.createElement('div', { className: 'training-app' }, React.createElement('div', { className: 'study-workspace' }, React.createElement('main', { className: 'study-stage evaluation-hidden' }, React.createElement('header', { className: 'study-toolbar' }, '拆棋'), React.createElement('div', { className: 'board-shell' })), React.createElement('aside', { className: 'study-sidebar' }, React.createElement('nav', { className: 'study-move-nav' }, '上一步'), React.createElement('nav', { className: 'study-panel-tabs' }, '棋谱 / 云库 / 引擎'), React.createElement(AnalysisPanel, { lines, pending: false, enabled: true, activeIndex: 0, disabled: false, multiPv: 4, moveTimeSec: 2, scoreSide: 'red', arrowsVisible: true, onToggle: noop, onToggleArrows: noop, onSelect: noop, onMultiPvChange: noop, onMoveTimeChange: noop })) )));
    });
    await page.locator('.analysis-candidates em').first().waitFor();
    const measurements = await page.locator('.analysis-panel').evaluate(panel => {
      const pr = panel.getBoundingClientRect();
      const rows = [...panel.querySelectorAll('.analysis-candidates button')];
      const first = rows[0].getBoundingClientRect();
      return { panel: { top: pr.top, bottom: pr.bottom, height: pr.height }, first: { top: first.top, bottom: first.bottom }, listHeight: panel.querySelector('.analysis-candidates').clientHeight, rows: rows.length };
    });
    await page.screenshot({ path: `tmp/mobile-input-analysis/analysis-${viewport.width}x${viewport.height}.png` });
    assert(measurements.first.bottom <= Math.min(measurements.panel.bottom, viewport.height) && measurements.first.top >= measurements.panel.top && measurements.listHeight >= 40, `candidate scores clipped at ${viewport.width}x${viewport.height}: ${JSON.stringify(measurements)}`);
    assert.equal(measurements.rows, 4);
    await page.locator('.analysis-candidates button').last().scrollIntoViewIfNeeded();
    const last = await page.locator('.analysis-candidates em').last().boundingBox();
    assert(last.y >= 0 && last.y + last.height <= viewport.height, 'last score reachable by scrolling');
    console.log(`PASS visible candidate scores and scroll: ${viewport.width}x${viewport.height}`);
    await page.close();
  }
}
(async () => { const browser = await chromium.launch({ channel: 'chrome', headless: true }); try { if (process.argv[2] !== 'analysis') await keyboard(browser); if (process.argv[2] !== 'keyboard') await analysis(browser); } finally { await browser.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
