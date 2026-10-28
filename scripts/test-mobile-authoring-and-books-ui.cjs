const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1479';
const output = process.env.OUTPUT_DIR || '.local/authoring-and-middlegame-10076';

(async () => {
  const browser = await (process.env.WEBKIT ? webkit.launch({ headless: true }) : chromium.launch({ channel: 'chrome', headless: true }));
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [390, 1024]) {
      for (const role of ['coach', 'admin', 'student']) {
        const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
        page.setDefaultTimeout(10000);
        const errors = [], requests = [];
        const user = { id: 'entry-' + role, orgId: 'entry-org', orgName: '入口验收机构', role, displayName: '入口验收', loginName: 'entry-check', vipActive: true, organizations: [] };
        const topic = { id: 'middle', name: '中局战术', kind: 'category', teachingEntry: 'middlegame', active: true, confirmed: true, displayOrder: 0, itemCount: 30 };
        const book = { ...topic, id: 'book', name: '李中健 · 中局全书', kind: 'series', teachingEntry: undefined, parentId: topic.id };
        const chapter = { ...book, id: 'chapter', name: '第一章 弃子战术', kind: 'chapter', parentId: book.id };
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
          localStorage.setItem('xiangqi-teaching-environment', 'production');
          localStorage.setItem('xiangqi-teaching-session-server', 'https://api.qixiapp.cn');
        });
        await page.route('**/api/v1/**', async route => {
          const request = route.request(), path = new URL(request.url()).pathname;
          let body = [];
          if (path.endsWith('/auth/refresh')) body = { token: 'fixture-only', expiresAt: '2099-01-01T00:00:00Z', user };
          else if (path.endsWith('/auth/me')) body = user;
          else if (path.endsWith('/authoring/directories')) body = { items: [] };
          else if (path.endsWith('/capabilities')) body = {};
          else if (path.endsWith('/teaching-catalog/browse')) {
            const id = new URL(request.url()).searchParams.get('nodeId');
            const breadcrumbs = id === chapter.id ? [topic, book, chapter] : id === book.id ? [topic, book] : id ? [topic] : [];
            body = { currentNode: breadcrumbs.at(-1) || null, breadcrumbs, children: !id ? [topic] : id === topic.id ? [book] : id === book.id ? [chapter] : [], learningMaterials: [], statisticsReady: true, statisticsRevision: '1', statisticsSnapshotRevision: '1', availabilitySnapshotRevision: '1' };
          } else if (/\/teaching-catalog\/[^/]+\/problems$/.test(path)) {
            requests.push(path);
            body = { items: [{ id: 'question', libraryId: 'book', sourceIndex: path.endsWith('/middle/problems') ? 7 : 0, title: '弃子争先', category: '中局战术', startingFen: '4k4/9/9/9/9/9/9/9/4R4/4K4 w', sideToMove: 'red', solutionLength: 1 }], nextCursor: null };
          }
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });
        if (role !== 'student') {
          await page.goto(url + '/teacher');
          const entry = page.getByRole('button', { name: /机构题库 · 摆棋出题/ });
          await entry.waitFor({ state: 'visible' }).catch(async error => { await page.screenshot({path: output + '/entry-failure.png'}); console.log((await page.locator('body').innerText()).slice(0,1000)); throw error; });
          assert(await entry.evaluate(node => node.closest('.teacher-mobile-actions') !== null));
          const rect = await entry.boundingBox();
          assert(rect && rect.y >= 0 && rect.y + rect.height <= 844, 'authoring entry must appear in first viewport');
          await page.screenshot({ path: `${output}/workspace-${role}-${width}.png` });
          await entry.click();
          await page.getByRole('heading', { name: '机构题库', exact: true }).waitFor();
          await page.getByRole('button', { name: /新增目录/ }).waitFor();
        } else {
          await page.goto(url + '/library');
          await page.getByRole('button', { name: /中局战术/ }).click();
          await page.getByRole('button', { name: '按书本学习', exact: true }).click();
          await page.getByRole('button', { name: /李中健 · 中局全书/ }).click();
          await page.getByRole('button', { name: /第一章 弃子战术/ }).click();
          await page.locator('.catalog-problem-card').waitFor();
          assert(requests.at(-1).endsWith('/chapter/problems'), 'chapter must request its own questions');
          await page.getByRole('navigation', { name: '中局书本目录' }).waitFor();
          await page.screenshot({ path: `${output}/middlegame-chapter-${width}.png` });
          await page.getByRole('button', { name: '返回上级目录', exact: true }).click();
          await page.getByRole('button', { name: /第一章 弃子战术/ }).waitFor();
          await page.getByRole('button', { name: '全部题目', exact: true }).click();
          await page.locator('.catalog-problem-card').waitFor();
          await page.waitForFunction(() => document.querySelector('[aria-label="中局学习方式"] button[aria-pressed="true"]')?.textContent === '全部题目');
          await page.locator('.catalog-problem-copy strong').filter({ hasText: '第 8 题' }).waitFor();
          assert(requests.some(path => path.endsWith('/middle/problems')), 'all questions must use topic scope');
        }
        assert.deepEqual(errors, []);
        console.log(`PASS ${role} authoring/books ${width}`);
        await page.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
