// Start the mobile Vite app first. This uses synthetic local data and intercepts
// API requests; it neither signs in nor sends a user's manual to a server.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const origin = process.env.COMMENTARY_URL || 'http://127.0.0.1:1456';
const output = process.env.COMMENTARY_EVIDENCE || '/tmp/qixi-move-commentary';
fs.mkdirSync(output, { recursive: true });

async function assertRecordingFeedback(manual) {
  const entry = manual.locator('.manual-bottom-tools').getByRole('button', { name: '讲解这步', exact: true });
  await entry.scrollIntoViewIfNeeded();
  const layout = await entry.evaluate(button => {
    const row = button.closest('.recording-feedback-row') || button.parentElement;
    const bounds = button.getBoundingClientRect(), parent = row.getBoundingClientRect();
    const inside = bounds.top >= parent.top && bounds.bottom <= parent.bottom && bounds.left >= parent.left && bounds.right <= parent.right;
    const clear = [...row.parentElement.querySelectorAll('.recording-quick-actions,.recording-navigation')].every(element => {
      const rect = element.getBoundingClientRect();
      return bounds.bottom <= rect.top || bounds.top >= rect.bottom || bounds.right <= rect.left || bounds.left >= rect.right;
    });
    const points = [[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]];
    const clickable = points.every(([x,y]) => button.contains(document.elementFromPoint(bounds.left + bounds.width*x, bounds.top + bounds.height*y)));
    return { height: parent.height, buttonHeight: bounds.height, inside, clear, clickable };
  });
  assert(layout.height >= 44 && layout.buttonHeight >= 44 && layout.inside && layout.clear && layout.clickable,
    `recording feedback must fit and accept taps without toolbar overlap: ${JSON.stringify(layout)}`);
  return entry;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.COMMENTARY_BROWSER_CHANNEL || 'chrome' });
  try {
    for (const [label, viewport] of [
      ['phone', { width: 390, height: 844 }],
      ['small-phone', { width: 375, height: 812 }],
      ['landscape', { width: 844, height: 390 }],
      ['tablet', { width: 1024, height: 768 }],
    ]) {
      const page = await browser.newPage({ viewport, hasTouch: true });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
      await page.addInitScript(({ phone, landscape }) => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-training-study-state', JSON.stringify({
          enabled: true, tab: 'manual', startingFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
          moves: ['h2e2', 'h9g7'], cursor: 1, branches: [], comments: {}, showMoveText: true,
        }));
        const observer = new MutationObserver(() => {
          if (document.documentElement) {
            document.documentElement.classList.add(phone ? 'phone-webview' : 'tablet-webview');
            if (phone) {
              document.documentElement.style.setProperty('--phone-safe-top', landscape ? '0px' : '47px');
              document.documentElement.style.setProperty('--phone-safe-bottom', landscape ? '21px' : '34px');
            }
            observer.disconnect();
          }
        });
        observer.observe(document, { childList: true });
      }, { phone: label !== 'tablet', landscape: viewport.width > viewport.height });
      await page.goto(`${origin}/tools/study`);
      const workspace = page.locator('.study-workspace').filter({ has: page.locator('.study-sidebar') });
      await workspace.waitFor();
      const before = await page.evaluate(() => localStorage.getItem('xiangqi-training-study-state'));
      await workspace.getByRole('button', { name: '讲解这步', exact: true }).click();
      await workspace.getByRole('heading', { name: '红方 · 炮二平五' }).waitFor();
      assert.equal(await page.locator('.move-commentary').count(), 1, 'one commentary controller');
      assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-training-study-state')), before, 'commentary cannot change saved manual');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal overflow');
      const bounds = await workspace.locator('.move-commentary').boundingBox();
      assert(bounds.width <= viewport.width, 'panel fits viewport');
      if (label === 'landscape') {
        const board = await workspace.locator('.study-play-board-area > .board-shell').boundingBox();
        assert(board.height > viewport.height * .7, 'landscape board uses available height');
      }
      await page.screenshot({ path: `${output}/${label}.png` });
      await workspace.getByRole('button', { name: '朗读讲解', exact: true }).click();
      await workspace.getByText('当前浏览器仅提供文字讲解；离线朗读请使用 iOS 或 Android App。').waitFor();
      await workspace.getByRole('button', { name: /讲解这步.*马/ }).click();
      await workspace.getByRole('heading', { name: /^黑方 · / }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-training-study-state')), before, 'historical explanation cannot navigate the manual');
      await workspace.getByRole('button', { name: '上一步', exact: true }).click();
      assert.equal(await workspace.locator('.move-commentary h3').count(), 0, 'navigation clears commentary');
      await workspace.getByRole('button', { name: '下一步', exact: true }).click();
      assert.equal(await workspace.locator('.move-commentary h3').count(), 0, 'returning does not replay consumed target');
      await workspace.getByRole('button', { name: '切换到录谱', exact: true }).click();
      const manual = page.locator('.manual-workspace');
      await manual.waitFor();
      // Switching tools intentionally opens its own manual, not the temporary
      // study tree. Play one actual move before asking to explain that move.
      await manual.getByRole('button', { name: 'e3 红兵', exact: true }).click();
      await manual.getByRole('button', { name: 'e4', exact: true }).click();
      const entry = await assertRecordingFeedback(manual);
      await page.screenshot({ path: `${output}/${label}-manual-collapsed.png` });
      const feedback = manual.locator('.recording-feedback');
      const originalNotice = await feedback.innerText();
      await feedback.evaluate(element => { element.textContent = '已记录：炮二平五。较长的局面提示应省略显示，不能挤压讲解按钮或覆盖下方工具栏。'.repeat(3); });
      await assertRecordingFeedback(manual);
      assert(await feedback.evaluate(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === 'ellipsis'), 'long notice uses ellipsis within its own column');
      await feedback.evaluate((element, text) => { element.textContent = text; }, originalNotice);
      await entry.click();
      await manual.getByRole('heading', { name: '红方 · 兵五进一' }).waitFor();
      assert.equal(await page.locator('.move-commentary').count(), 1, 'manual dock has one controller');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'manual dock fits viewport');
      await assertRecordingFeedback(manual);
      const scroller = manual.locator('.manual-commentary-content');
      const scrollBounds = await scroller.boundingBox();
      assert(scrollBounds.height >= 140, 'manual explanation has usable scrolling height');
      for (const control of [manual.getByRole('button', { name: '朗读讲解', exact: true }), manual.getByRole('heading', { name: '局面问题', exact: true })]) {
        await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        const visible = await control.evaluate(element => {
          const body = element.closest('.manual-commentary-content').getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          return { visible: rect.top >= body.top && rect.bottom <= body.bottom && rect.top >= 0 && rect.bottom <= innerHeight,
            text: element.textContent, rect: rect.toJSON(), body: body.toJSON() };
        });
        if (!visible.visible) await page.screenshot({ path: `${output}/${label}-clipped.png` });
        assert(visible.visible, `speech and explanation text are reachable inside the manual dock: ${JSON.stringify(visible)}`);
      }
      await scroller.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `${output}/${label}-manual.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS ${label}: real WASM, historical black move, read-only commentary, fallback, navigation cleanup, manual dock and layout`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
