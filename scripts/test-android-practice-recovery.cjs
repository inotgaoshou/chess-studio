// Run against an isolated emulator with the current debug APK installed.
// All API traffic is intercepted; native SQLite, WASM, and Pikafish.cancel stay real.
const assert = require('node:assert/strict');
const { _android } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serial = process.env.PRACTICE_ANDROID_SERIAL || 'emulator-5582';
const layout = process.env.PRACTICE_ANDROID_LAYOUT || 'portrait';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const topic = { id: 'native-topic', name: '基础杀法', description: '练习将军、叫杀和连续计算。', contentKind: 'problem', itemCount: 757, sources: [{ libraryId: 'native-lib' }] };
const session = { id: 'native-session', sourceKind: 'daily', mode: 'solver', status: 'active', items: [{ id: 'native-item', ordinal: 0, status: 'pending', problem: { id: 'native-problem', libraryId: 'native-lib', title: '安卓原生练习验收', sourceIndex: 0, category: '杀法', startingFen: fen, sideToMove: 'red', solution: [{ iccs: 'a0a1', children: [] }], note: '' } }] };

(async () => {
  assert(serial.startsWith('emulator-'), 'Use a disposable emulator, not a personal device');
  const device = (await _android.devices()).find(candidate => candidate.serial() === serial);
  assert(device, `Emulator ${serial} is not connected`);
  try {
    const view = (await device.webViews()).find(candidate => candidate.pkg() === (process.env.PRACTICE_ANDROID_PACKAGE || 'cn.xiangqi.endgame.training'));
    assert(view, 'Open the installed debug APK first');
    const page = await view.page(); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let hang = false, writes = 0;
    const auth = { token: 'native-fixture', refreshToken: 'native-refresh-fixture', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'native-student', orgId: 'native-org', role: 'student', displayName: '原生验收学生' } };
    await page.route(/^https?:\/\/(?!localhost(?:[:/]|$))/, async route => {
      const path = new URL(route.request().url()).pathname;
      let body = [];
      if (path.endsWith('/auth/refresh')) body = auth;
      else if (path.endsWith('/auth/me')) body = auth.user;
      else if (path.endsWith('/capabilities')) body = {};
      else if (path.endsWith('/practice/dashboard')) body = { topics: [topic], studyTopics: [], history: [], dailyPlan: { id: 'native-daily', topic, itemCount: 10, mode: 'solver' } };
      else if (path.endsWith('/student/assignments')) body = { items: [] };
      else if (path.endsWith('/practice/topics/native-topic')) body = { ...topic, chapters: [] };
      else if (path.endsWith('/daily/native-daily/session') || (path.endsWith('/practice/sessions') && route.request().method() === 'POST')) {
        writes++; if (hang) return; body = session;
      } else if (path.includes('/practice/sessions/')) body = session;
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.evaluate(async auth => {
      localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
      localStorage.setItem('xiangqi-training-tablet-navigation', 'bottom');
      await Capacitor.registerPlugin('SecureSession').save({ session: JSON.stringify({ ...auth, auth, serverUrl: 'https://api-test.qixiapp.cn', deviceId: 'native-fixture-device' }) });
    }, auth);
    await page.goto('https://localhost/practice');
    await page.getByText('开始今日练习', { exact: true }).waitFor();
    console.log('native environment', await page.evaluate(() => ({ platform: Capacitor.getPlatform(), width: innerWidth, height: innerHeight, tablet: document.documentElement.classList.contains('tablet-webview') })));
    const daily = () => page.locator('.mobile-practice-daily-card');
    const solver = () => page.locator('.mobile-solver-page');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('tablet-webview')), true, 'Use tablet dimensions before starting the app');
    const card = await daily().evaluate(button => ({ width: button.getBoundingClientRect().width, parent: button.parentElement.getBoundingClientRect().width, radius: getComputedStyle(button).borderRadius }));
    assert(Math.abs(card.width - card.parent) < 2); assert.equal(card.radius, '8px');
    await page.screenshot({ path: `/tmp/practice-native-${layout}.png` });
    await page.locator('.mobile-practice-feature > button').click(); await solver().waitFor();
    assert.equal(await page.locator('.mobile-solver-board img.piece').count() || await page.locator('.mobile-solver-board .piece').count(), 32);
    await page.getByRole('button', { name: '返回练习', exact: true }).click();
    await daily().click(); await solver().waitFor();
    await page.getByRole('button', { name: '返回练习', exact: true }).click();
    await page.locator('.mobile-practice-grid').getByRole('button', { name: /基础杀法/ }).click();
    await page.getByRole('button', { name: /开始训练/ }).click(); await solver().waitFor();
    await page.screenshot({ path: `/tmp/practice-native-solver-${layout}.png` });
    await page.getByRole('button', { name: '返回练习', exact: true }).click();
    console.log('native: top start, daily card, topic detail and real board passed');
    await page.clock.install(); hang = true;
    const sent = page.waitForRequest(request => request.url().endsWith('/daily/native-daily/session'));
    await daily().click(); await sent; await page.clock.runFor(15_100);
    await page.getByRole('alert').filter({ hasText: /超时/ }).waitFor();
    assert.equal(await daily().isEnabled(), true);
    hang = false; await page.getByRole('button', { name: '重试', exact: true }).click(); await solver().waitFor();
    await page.getByRole('button', { name: '返回练习', exact: true }).click();
    console.log('native: network deadline releases lock and retry opens board');
    await page.evaluate(() => {
      const original = Capacitor.nativePromise;
      Capacitor.nativePromise = function(plugin, method, ...args) {
        if (plugin === 'Pikafish' && method === 'cancel' && window.hangNativeCancel) {
          window.nativeCancelHeld = true; return new Promise(() => {});
        }
        return original.call(this, plugin, method, ...args);
      };
      window.hangNativeCancel = true;
    });
    const previousWrites = writes;
    await daily().click(); await page.waitForFunction(() => window.nativeCancelHeld);
    await page.clock.runFor(15_100);
    await page.getByRole('alert').filter({ hasText: /超时/ }).waitFor();
    assert.equal(writes, previousWrites + 1);
    await page.evaluate(() => { window.hangNativeCancel = false; });
    await page.getByRole('button', { name: '重试', exact: true }).click(); await solver().waitFor();
    assert.equal(writes, previousWrites + 1, 'native initialization retry reuses the session');
    console.log('native: stalled Pikafish.cancel is bounded and cached session retry passed');
    assert.deepEqual(errors, []);
  } finally { await device.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
