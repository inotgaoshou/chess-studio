const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1440';
async function visibleInput(page, field) {
  await page.waitForTimeout(120);
  const result = await field.evaluate(input => {
    const box = input.getBoundingClientRect(), style = getComputedStyle(input);
    const top = Number.parseFloat(document.documentElement.style.getPropertyValue('--input-viewport-top'));
    const height = Number.parseFloat(document.documentElement.style.getPropertyValue('--input-viewport-height'));
    const left = box.left + Math.max(8, Number.parseFloat(style.paddingLeft) + 2);
    const right = box.right - Math.max(8, Number.parseFloat(style.paddingRight) + 2);
    const points = [left, (left + right) / 2, right].flatMap(x => [box.top + 8, box.top + box.height / 2, box.bottom - 8].map(y => ({ x, y, hit: document.elementFromPoint(x, y) === input })));
    return { box: { top: box.top, bottom: box.bottom, height: box.height }, top, height, font: Number.parseFloat(style.fontSize), points };
  });
  assert(result.box.top >= result.top && result.box.bottom <= result.top + result.height, JSON.stringify(result));
  assert(result.font >= 16, 'touch text input must not trigger iOS zoom');
  assert(result.points.every(point => point.hit), `input's text region is covered or clipped: ${JSON.stringify(result)}`);
}
async function keyboard(page, scenario, open) {
  await page.evaluate(({ scenario, open }) => {
    const height = open ? scenario.height : scenario.viewport.height;
    const top = open ? scenario.top : 0;
    window.mockViewport(height, top, open && scenario.mode === 'android' ? height : scenario.viewport.height);
    if (scenario.mode !== 'browser') {
      if (open) {
        const info = { keyboardHeight: scenario.viewport.height - scenario.height };
        window.keyboardEvents.keyboardWillShow(info); window.keyboardEvents.keyboardDidShow(info);
      } else window.keyboardEvents.keyboardDidHide();
    }
  }, { scenario, open });
  await page.waitForTimeout(150);
}
async function unobscuredWizard(page) {
  const body = page.locator('.teacher-mobile-wizard-body');
  const footer = page.locator('.teacher-mobile-wizard-footer');
  const before = await footer.boundingBox();
  const choices = page.locator('.teacher-mobile-batch label');
  await choices.filter({ hasText: '自定义题数' }).click();
  const targets = [page.locator('.teacher-mobile-batch > b'), ...await choices.all(),
    page.getByRole('spinbutton', { name: '每批题数', exact: true }),
    page.locator('.teacher-mobile-batch > small').first(), page.locator('.teacher-mobile-selection-summary')];
  for (const target of targets) {
    await target.scrollIntoViewIfNeeded();
    const result = await target.evaluate(node => {
      const r = node.getBoundingClientRect(), body = document.querySelector('.teacher-mobile-wizard-body').getBoundingClientRect();
      const footer = document.querySelector('.teacher-mobile-wizard-footer').getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { top: r.top, bottom: r.bottom, bodyTop: body.top, bodyBottom: body.bottom, footerTop: footer.top, hit: node === hit || node.contains(hit) };
    });
    assert(result.top >= result.bodyTop - 1 && result.bottom <= result.bodyBottom + 1 && result.bodyBottom <= result.footerTop + 1 && result.hit, JSON.stringify(result));
  }
  assert.deepEqual(await footer.boundingBox(), before, 'scrolling the body cannot move the footer');
  for (const button of await footer.getByRole('button').all()) assert(await button.evaluate(node => {
    const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === node || node.contains(hit);
  }), 'wizard action remains unobscured');
  assert.equal(await body.evaluate(node => getComputedStyle(node).overflowY), 'auto');
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const scenarios = [
      { mode: 'browser', viewport: { width: 390, height: 844 }, height: 360, top: 150 },
      { mode: 'ios', viewport: { width: 390, height: 844 }, height: 360, top: 150 },
      { mode: 'android', viewport: { width: 390, height: 844 }, height: 360, top: 0 },
      { mode: 'ios', viewport: { width: 844, height: 390 }, height: 220, top: 0 },
      { mode: 'android', viewport: { width: 960, height: 432 }, height: 250, top: 0 },
      { mode: 'android', viewport: { width: 844, height: 390 }, height: 118, top: 0 },
      { mode: 'ios', viewport: { width: 800, height: 1280 }, height: 560, top: 0 },
      { mode: 'android', viewport: { width: 1280, height: 800 }, height: 350, top: 0 },
    ];
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: scenario.viewport, isMobile: true, hasTouch: true,
        userAgent: scenario.viewport.width < 600 || scenario.viewport.height < 500 ? (scenario.mode === 'android' ? 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/133.0 Mobile Safari/537.36' : 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1') : undefined });
      const errors = [];
      let assignmentWrites = 0;
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(viewport => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'http://127.0.0.1:8090');
        const visible = new EventTarget();
        Object.assign(visible, { ...viewport, offsetTop: 0, offsetLeft: 0, scale: 1 });
        Object.defineProperty(window, 'visualViewport', { value: visible, configurable: true });
        let layoutHeight = viewport.height;
        Object.defineProperty(window, 'innerHeight', { get: () => layoutHeight, configurable: true });
        window.keyboardEvents = {};
        window.accessoryRequests = [];
        window.mockViewport = (height, offsetTop, layout) => {
          layoutHeight = layout; Object.assign(visible, { height, offsetTop });
          window.dispatchEvent(new Event('resize')); visible.dispatchEvent(new Event('resize')); visible.dispatchEvent(new Event('scroll'));
        };
      }, scenario.viewport);
      if (scenario.mode !== 'browser') await page.route('**/src/inputViewport.ts*', async route => {
        const response = await route.fetch();
        const source = (await response.text())
          .replace(/import \{ Capacitor \} from [^;]+;/, `const Capacitor = { isNativePlatform: () => true, getPlatform: () => '${scenario.mode}' };`)
          .replace(/import \{ Keyboard \} from [^;]+;/, 'const Keyboard = { setAccessoryBarVisible: async options => { window.accessoryRequests.push(options); }, addListener: async (event, fn) => { window.keyboardEvents[event] = fn; return { remove: async () => {} }; } };');
        await route.fulfill({ response, body: source });
      });
      await page.route('**/src/App.tsx*', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) + '\nexport { TeachingAccountDialog, ImportCblPanel, MobileSettingsPanel, MobilePracticeSearchPanel };' });
      });
      await page.route('**/api/v1/**', route => {
        const path = new URL(route.request().url()).pathname; let body = [];
        if (path.endsWith('/admin/assignments') && route.request().method() === 'POST') assignmentWrites++;
        if (path.endsWith('/auth/refresh')) body = { token: 'coach', expiresAt: '2099-01-01', user: { id: 'coach', orgId: 'org', orgName: '测试棋社', role: 'coach', loginName: 'coach', displayName: '老师' } };
        else if (path.endsWith('/classes')) body = [{ id: 'class', name: '测试班级', studentCount: 1, coachCount: 1 }];
        else if (path.endsWith('/students')) body = [{ id: 'student', displayName: '学生', loginName: 'student' }];
        else if (path.endsWith('/problem-libraries')) body = [{ id: 'lib', title: '测试题库', publishedCount: 2, problemCount: 2, reviewStatus: 'published', sourceKind: 'organization' }];
        else if (path.endsWith('/problems')) body = { items: [{ id: 'p', libraryId: 'lib', sourceIndex: 0, title: '练习题', reviewStatus: 'published' }], nextCursor: null, total: 1 };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(url + '/teacher/assignments/new');
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('button', { name: '选择整个题库', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.accessoryRequests), scenario.mode === 'ios' ? [{ isVisible: true }] : []);
      await unobscuredWizard(page);
      const title = page.getByRole('textbox', { name: '作业标题', exact: true });
      await title.focus(); await keyboard(page, scenario, true);
      await title.fill('输入文字始终可见'); await visibleInput(page, title);
      assert.equal(await page.locator('.teacher-mobile-wizard-footer').evaluate(node => getComputedStyle(node).position), 'static');
      const description = page.getByRole('textbox', { name: '作业说明（可选）', exact: true });
      await description.focus(); await description.fill('中文说明\n'.repeat(20)); await visibleInput(page, description);
      await description.evaluate(node => { window.originalDescription = node; });
      // System Done ends editing; it must not submit or replace the textarea.
      await description.blur(); await keyboard(page, scenario, false);
      assert.equal(await description.inputValue(), '中文说明\n'.repeat(20));
      assert(await description.evaluate(node => node === window.originalDescription));
      await page.getByRole('heading', { name: '选择作业题目', exact: true }).waitFor();
      await page.getByText('已选择 2 题', { exact: true }).waitFor();
      assert.equal(assignmentWrites, 0, 'Done must not save or publish the assignment');
      await unobscuredWizard(page);
      const search = page.getByRole('textbox', { name: '搜索当前题库', exact: true });
      await search.focus(); await keyboard(page, scenario, true); await search.fill('车'); await visibleInput(page, search);
      // IME candidate rows change height while focus stays in the same field.
      const smaller = { ...scenario, height: scenario.height - 20 };
      await keyboard(page, smaller, true); await visibleInput(page, search);
      await page.screenshot({ path: `tmp/mobile-input-analysis/input-wizard-${scenario.mode}-${scenario.viewport.width}.png` });
      await keyboard(page, scenario, false);
      assert.equal(await page.locator('html').evaluate(node => node.classList.contains('keyboard-open')), false);
      assert.equal(await title.inputValue(), '输入文字始终可见');
      assert.equal(await page.locator('.teacher-mobile-wizard-footer').evaluate(node => getComputedStyle(node).position), 'static');
      await unobscuredWizard(page);
      await page.goto(url + '/teacher/classes/class');
      const password = page.locator('.teacher-mobile-form input[type=password]');
      await password.focus(); await keyboard(page, scenario, true); await password.fill('typed-password'); await visibleInput(page, password);
      assert.equal(await page.locator('.teacher-mobile-bottom-nav').isVisible(), false);
      await keyboard(page, scenario, false);
      // Mount the real save dialog, including its non-scrolling footer.
      await page.evaluate(async () => {
        const { ManualSaveDialog } = await import('/src/ManualSaveDialog.tsx');
        const React = (await import('/node_modules/.vite/deps/react.js')).default;
        const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        const host = document.createElement('div'); document.getElementById('root').append(host);
        window.formFixture = createRoot(host);
        window.formFixture.render(React.createElement(ManualSaveDialog, { game: { title: '输入测试棋谱', note: '', createdAt: '2026-10-01T00:00:00Z', startingFen: 'w' }, folders: [], onSave: async () => {}, onCreateFolder: async () => {}, onClose: () => {} }));
      });
      const note = page.getByRole('textbox', { name: '备注', exact: true });
      await note.focus(); await keyboard(page, scenario, true); await note.fill('多行输入\n'.repeat(30)); await visibleInput(page, note);
      const save = page.getByRole('button', { name: '保存棋谱', exact: true });
      if (scenario.height < 200) {
        // Very short landscape viewports scroll the whole dialog so both the
        // field and actions remain reachable without clipping a flex body.
        await note.blur();
        await save.scrollIntoViewIfNeeded();
      }
      assert(await save.evaluate(button => {
        const rect = button.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button;
      }), 'save remains clickable and does not overlay the text area');
      await keyboard(page, scenario, false);
      await page.evaluate(async () => {
        document.querySelector('#root > .training-app').style.display = 'none';
        const components = await import('/src/App.tsx');
        const React = (await import('/node_modules/.vite/deps/react.js')).default;
        const { skinById } = await import('/src/skinCatalog.ts');
        const noop = () => {};
        window.showInputFixture = kind => {
          let child;
          if (kind === 'login') child = React.createElement(components.TeachingAccountDialog, { syncing: false, onClose: noop, onLogin: noop, onAuthChange: noop, onLogout: noop, onSync: noop, onMessage: noop });
          if (kind === 'import') child = React.createElement(components.ImportCblPanel, { canSetAccessTier: false, accessTier: 'public', onAccessTierChange: noop, onBack: noop, onPick: noop, onImportUrl: async () => {} });
          if (kind === 'search') child = React.createElement(components.MobilePracticeSearchPanel, { busy: false, message: '', onBack: noop, onOpenProblem: noop });
          if (kind === 'settings') child = React.createElement(components.MobileSettingsPanel, { boardSkin: 'qingxin-zhuyun', pieceSkin: 'qingxin-zhuyun', boardSkinInfo: skinById('qingxin-zhuyun'), riverText: '', riverTextColor: '#315844', riverTextSize: 22, tabletNavigationPosition: 'bottom', tabletNavigationAvailable: true, onBack: noop, onBoardSkinChange: noop, onPieceSkinChange: noop, onUseSkinSet: noop, onRiverTextChange: noop, onRiverTextColorChange: noop, onRiverTextSizeChange: noop, onTabletNavigationPositionChange: noop });
          window.formFixture.render(React.createElement('div', { className: 'training-app tablet-navigation-bottom' }, child));
        };
        window.showInputFixture('login');
      });
      const loginPassword = page.locator('.teaching-account-dialog input[type=password]');
      await loginPassword.focus(); await keyboard(page, scenario, true); await loginPassword.fill('very-long-password-text-at-the-end'); await visibleInput(page, loginPassword);
      const padding = await loginPassword.evaluate(input => {
        const text = getComputedStyle(input), button = input.nextElementSibling.getBoundingClientRect();
        return { reserve: Number.parseFloat(text.paddingRight), overlap: input.getBoundingClientRect().right - button.left };
      });
      assert(padding.reserve >= padding.overlap, 'password toggle reserves space instead of covering typed text');
      await keyboard(page, scenario, false);
      await page.evaluate(() => window.showInputFixture('import'));
      const importUrl = page.getByPlaceholder('https://example.com/library.cbl');
      await importUrl.focus(); await keyboard(page, scenario, true); await importUrl.fill('https://example.com/input-test.cbl'); await visibleInput(page, importUrl);
      await keyboard(page, scenario, false);
      await page.evaluate(() => window.showInputFixture('search'));
      const practiceSearch = page.getByRole('textbox', { name: '搜索练习题', exact: true });
      await practiceSearch.focus(); await keyboard(page, scenario, true); await practiceSearch.fill('搜索关键字'); await visibleInput(page, practiceSearch);
      await keyboard(page, scenario, false);
      await page.evaluate(() => window.showInputFixture('settings'));
      await page.getByText('高级：楚河汉界文字', { exact: true }).click();
      const river = page.getByPlaceholder('默认：楚河汉界');
      await river.focus(); await keyboard(page, scenario, true); await visibleInput(page, river);
      assert.deepEqual(errors, []);
      console.log(`PASS actual input hit testing, wizard actions, IME height change, dialog footer, native resize and restore: ${scenario.mode} ${scenario.viewport.width}x${scenario.viewport.height}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
