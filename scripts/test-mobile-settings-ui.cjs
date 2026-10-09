const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.SETTINGS_URL || 'http://127.0.0.1:1440';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 960, height: 432 }, { width: 740, height: 300 }]) {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        window.orientationCalls = [];
        screen.orientation.lock = async (value) => {
          window.orientationCalls.push(value);
          if (window.rejectOrientation) throw new Error('系统方向请求被拒绝');
          await new Promise((resolve) => setTimeout(resolve, 180));
        };
        screen.orientation.unlock = () => window.orientationCalls.push('auto');
      });
      await page.route('https://api*.qixiapp.cn/**', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"测试未登录"}' }));
      await page.goto(url);
      const entry = page.getByRole('button', { name: '关于棋析', exact: true });
      await entry.waitFor();
      const box = await entry.boundingBox();
      assert(box.width >= 44 && box.height >= 44, 'settings entry has a 44px touch target');
      assert(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
      await entry.tap();
      const dialog = page.getByRole('dialog', { name: '棋析', exact: true });
      const landscape = dialog.getByRole('button', { name: '锁横屏', exact: true });
      await landscape.tap();
      await landscape.tap({ force: true });
      await page.waitForFunction(() => localStorage.getItem('xiangqi-training-orientation') === 'landscape');
      assert.equal(await page.evaluate(() => window.orientationCalls.filter((x) => x === 'landscape').length), 1, 'rapid direction taps submit only once');
      await page.evaluate(() => { window.rejectOrientation = true; });
      await dialog.getByRole('button', { name: '锁竖屏', exact: true }).tap();
      await dialog.getByRole('alert').filter({ hasText: '系统方向请求被拒绝' }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('xiangqi-training-orientation')), 'landscape');
      await page.evaluate(() => { window.rejectOrientation = false; });
      await dialog.getByRole('button', { name: '锁竖屏', exact: true }).tap();
      await page.waitForFunction(() => localStorage.getItem('xiangqi-training-orientation') === 'portrait');
      assert(await page.locator('.about-dialog').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && (innerHeight > 400 || element.scrollHeight > element.clientHeight);
      }), 'short landscape dialog stays in viewport and scrolls');
      assert(await page.evaluate(() => {
        const nav = document.querySelector('.mobile-primary-nav');
        if (!nav) return true;
        const rect = nav.getBoundingClientRect();
        return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.about-backdrop');
      }), 'settings covers navigation in hit testing');
      await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
      await dialog.waitFor({ state: 'hidden' });
      // Consecutive open/close taps previously lost the second click globally.
      for (let i = 0; i < 20; i++) {
        await entry.tap();
        await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
        await dialog.waitFor({ state: 'hidden' });
      }
      await page.reload();
      await entry.tap();
      await page.waitForFunction(() => window.orientationCalls.includes('portrait'));
      assert.equal(await dialog.getByRole('button', { name: '锁竖屏', exact: true }).getAttribute('aria-pressed'), 'true');
      await dialog.getByRole('button', { name: '自动', exact: true }).tap();
      await page.waitForFunction(() => localStorage.getItem('xiangqi-training-orientation') === 'auto');
      await page.screenshot({ path: `/tmp/qixi-settings-${viewport.width}x${viewport.height}.png` });
      assert.deepEqual(errors, []);
      console.log(`PASS settings touch, rapid taps, failure/retry, layering, scroll, restore: ${viewport.width}x${viewport.height}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
