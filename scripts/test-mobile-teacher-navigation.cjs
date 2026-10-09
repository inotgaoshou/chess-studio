const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.TEACHER_URL || 'http://127.0.0.1:1441';
const fen = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1';
(async () => {
 const browser = await chromium.launch({ channel: 'chrome', headless: true });
 try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
   const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
   const errors = [], offsets = [], details = [];
   page.on('pageerror', e => errors.push(e.message));
   await page.addInitScript(() => { localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done'); localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn'); });
   await page.route('**/api/v1/**', async route => {
    const parsed = new URL(route.request().url()), path = parsed.pathname; let body = [];
    if (path.endsWith('/auth/refresh')) body = { token: 'teacher', expiresAt: '2099-01-01', user: { id: 'teacher', orgId: 'org', orgName: '测试棋社', role: 'coach', loginName: 'teacher', displayName: '测试老师' } };
    else if (path.endsWith('/admin/assignments')) body = [{ id: 'assignment', title: '109题导航作业', status: 'published', targetCount: 1, itemCount: 109, completedCount: 0 }];
    else if (path.endsWith('/results/summary')) body = { recipientCount: 1, partialSubmissionCount: 0, fullSubmissionCount: 0, fullySolvedCount: 0, completedProblemCount: 0, assignedProblemCount: 109, completionRate: 0, averageTotalScore: null };
    else if (path.endsWith('/assignment/results')) body = [{ studentId: 'student', displayName: '测试学生', loginName: 'student', totalCount: 109, submittedCount: 0, completedCount: 0, totalScore: 0, firstTryCorrectCount: 0 }];
    else if (path.endsWith('/students/student/results')) {
     const offset = Number(parsed.searchParams.get('cursor') || 0); offsets.push(offset);
     await new Promise(r => setTimeout(r, 50));
     body = { items: Array.from({ length: Math.min(50, 109 - offset) }, (_, i) => ({ problemId: `p${i + offset}`, order: i + offset, title: `导航题目${i + offset + 1}`, completed: false, firstTryCorrect: false })), nextCursor: offset + 50 < 109 ? String(offset + 50) : null };
    } else if (path.includes('/problems/p')) { details.push(path); body = { title: '导航题目', startingFen: fen, moves: null }; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
   });
   await page.goto(url);
   await page.waitForSelector('.mobile-primary-nav');
   assert(await page.locator('.training-app').evaluate(el => el.classList.contains('tablet-navigation-bottom')), 'new installations default to bottom navigation');
   const nav = await page.locator('.mobile-primary-nav').boundingBox();
   assert(nav.y > viewport.height - 100 && nav.width > viewport.width - 5, 'default bottom navigation spans tablet width');
   await page.goto(url + '/teacher');
   await page.getByText('109题导航作业', { exact: true }).click();
   await page.getByRole('button', { name: /学生姓名：测试学生/ }).click();
   const grid = page.getByRole('navigation', { name: '题号列表' });
   await page.getByRole('button', { name: '展开题号', exact: true }).waitFor();
   assert.equal(await grid.isVisible(), false, 'question grid defaults to collapsed');
   await page.getByRole('button', { name: '展开题号', exact: true }).click();
   await page.getByRole('button', { name: '第 1 题：导航题目1', exact: true }).waitFor();
   assert.equal(await grid.getByRole('button').count(), 109, 'all 109 question numbers are present');
   assert.equal(details.length, 0, 'list does not fetch every board');
   await grid.getByRole('button', { name: '第 109 题', exact: true }).click();
   await page.getByRole('img', { name: '导航题目109 · 第 0 手', exact: true }).waitFor();
   assert.deepEqual(offsets, [0, 50, 100]);
   assert.equal(details.length, 1);
   assert.equal(await page.getByRole('button', { name: '下一题', exact: true }).isEnabled(), false);
   await page.getByRole('button', { name: '上一题', exact: true }).click();
   await page.getByRole('img', { name: '导航题目108 · 第 0 手', exact: true }).waitFor();
   await grid.getByRole('button', { name: '第 1 题：导航题目1', exact: true }).click();
   await page.getByRole('img', { name: '导航题目1 · 第 0 手', exact: true }).waitFor();
   await page.getByRole('button', { name: '下一题', exact: true }).click();
   await page.getByRole('img', { name: '导航题目2 · 第 0 手', exact: true }).waitFor();
   assert.equal(await grid.locator('[aria-current=step]').textContent(), '2');
   await page.screenshot({ path: `tmp/mobile-input-analysis/teacher-navigation-${viewport.width}.png` });
   await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
   assert.equal(await grid.getByRole('button').count(), 109);
   await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
   await page.getByLabel('学生名单', { exact: true }).waitFor();
   assert.deepEqual(errors, []);
   await page.close();
   console.log(`PASS 109-question pagination, numbered preview, next/previous, return and bottom navigation: ${viewport.width}x${viewport.height}`);
  }
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
