// Real mobile App + WASM; synthetic account/data, no production requests.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const { responseFor } = require('./mobile-library-fixtures.cjs');
const origin = process.env.OPENING_URL || 'http://127.0.0.1:1456';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const historyDelay of [0, 1200]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      page.setDefaultTimeout(10000);
      const errors = [];
      const requests = [];
      let responseAt;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/**', async route => {
        const request = route.request(), url = new URL(request.url());
        requests.push({ path: url.pathname, method: request.method() });
        if (url.pathname.endsWith('/practice/sessions') && request.method() === 'POST') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          responseAt = Date.now();
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responseFor(url, request.method())) });
      });
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'http://127.0.0.1:8090');
        new MutationObserver((_, observer) => {
          if (document.documentElement) { document.documentElement.classList.add('phone-webview'); observer.disconnect(); }
        }).observe(document, { childList: true });
      });
      await page.goto(`${origin}/library`);
      await page.getByRole('button', { name: /基础杀法.*可练题/ }).click();
      const question = page.locator('.catalog-problem-card').first().locator('button').first();
      await question.waitFor();
      await page.evaluate(async delay => {
        const { trainingStore } = await import('/src/store.ts');
        const original = trainingStore.attempts;
        trainingStore.attempts = async (...args) => {
          window.openingProbe.historyReads = (window.openingProbe.historyReads || 0) + 1;
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          return original(...args);
        };
        window.openingProbe = { startedAt: performance.now() };
        const probe = new MutationObserver(() => {
          const status = document.querySelector('.practice-opening-status [role="status"]');
          const board = document.querySelector('.mobile-solver-page .board-square');
          if (status && window.openingProbe.feedbackMs == null) window.openingProbe.feedbackMs = Math.round(performance.now() - window.openingProbe.startedAt);
          if (board) { window.openingProbe.boardAt = Date.now(); probe.disconnect(); }
        });
        probe.observe(document.body, { subtree: true, childList: true });
      }, historyDelay);
      await question.click();
      await page.getByRole('status').filter({ hasText: '正在打开' }).waitFor();
      await page.locator('.mobile-solver-page .board-square').first().waitFor();
      const { feedbackMs, boardAt, historyReads } = await page.evaluate(() => window.openingProbe);
      assert.equal(historyReads, 1, 'probe must exercise the actual attempt-history read');
      const boardAfterResponseMs = boardAt - responseAt;
      console.log(JSON.stringify({ historyDelay, feedbackMs, boardAfterResponseMs, historyReads, requests: requests.filter(r => /sessions|problems/.test(r.path)) }));
      assert.deepEqual(errors, []);
      if (process.env.OPENING_BASELINE !== '1') {
        assert(feedbackMs < 250, 'opening an exercise gives feedback within 250ms');
        assert(boardAfterResponseMs < 600, 'history reads must not delay the usable board');
      }
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
