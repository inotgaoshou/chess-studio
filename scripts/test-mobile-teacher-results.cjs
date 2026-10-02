const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.TEACHER_URL || 'http://127.0.0.1:1441';
const fen = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [], requests = [];
      let newer = false;
      let unavailable = true;
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => { localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done'); localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn'); });
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        requests.push(path);
        if (unavailable && path.endsWith('/results/summary')) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
          return;
        }
        let body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'teacher', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'teacher', orgId: 'org', orgName: '审核机构', role: 'coach', loginName: 'teacher', displayName: '审核老师', organizations: [{ id: 'org', name: '审核机构', role: 'coach' }] } };
        else if (path.endsWith('/admin/assignments')) body = [{ id: 'assignment', title: '结果作业', status: 'published', targetCount: 1, itemCount: 3, completedCount: 0 }];
        else if (path.endsWith('/results/summary')) body = { recipientCount: 1, partialSubmissionCount: 1, fullSubmissionCount: 0, fullySolvedCount: 0, completedProblemCount: 2, assignedProblemCount: 3, completionRate: 66.666, averageTotalScore: null };
        else if (path.endsWith('/students/student/results')) body = { items: [
          { problemId: 'one', title: '首次题', order: 0, completed: true, outcome: 'completed', score: 3, stars: 3, mistakes: 0, hintsUsed: 0, elapsedMs: 1000, firstTryCorrect: true, submittedAt: '2026-10-02T00:00:00Z' },
          { problemId: 'two', title: '零分完成题', order: 1, completed: true, outcome: 'completed', score: 0, stars: 0, mistakes: 3, hintsUsed: 0, elapsedMs: 2000, firstTryCorrect: false, submittedAt: '2026-10-02T00:00:00Z' },
          { problemId: 'three', title: '未交题', order: 2, completed: false, firstTryCorrect: false },
        ], nextCursor: null };
        else if (path.endsWith('/problems/one')) body = { title: '首次题', startingFen: fen, moves: [newer ? 'e1e3' : 'e1e2'] };
        else if (path.endsWith('/problems/three')) body = { title: '未交题', startingFen: fen, moves: null };
        else if (path.endsWith('/assignment/results')) body = [{ studentId: 'student', loginName: 'review.student', displayName: '审核学生', totalCount: 3, completedCount: 2, submittedCount: 2, totalScore: 3, firstTryCorrectCount: 1, totalElapsedMs: 3000, lastSubmittedAt: '2026-10-02T00:00:00Z' }];
        if (newer && path.endsWith('/students/student/results')) body.items[0] = { ...body.items[0], score: 2, stars: 2, mistakes: 1 };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(base + '/teacher');
      await page.getByText('结果作业', { exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByText('暂无接收学生', { exact: true }).count(), 0, 'failed loading must not imply no recipients');
      assert.equal(await page.getByText('正在加载', { exact: true }).count(), 0, 'failed loading must leave loading state');
      const retry = page.getByRole('button', { name: '重试加载', exact: true });
      const box = await retry.boundingBox(); assert.ok(box.height >= 44);
      await page.screenshot({ path: `/tmp/qixi-teacher-results-error-${viewport.width}.png` });
      unavailable = false;
      await retry.click();
      await page.getByLabel('作业统计').waitFor();
      assert.equal(await page.getByRole('alert').count(), 0);
      assert.equal(await page.getByText('暂无成绩', { exact: true }).count(), 1);
      assert(!requests.some(path => path.includes('/students/student/')), 'details must load only on demand');
      await page.getByRole('button', { name: /审核学生.*review.student/ }).click();
      await page.getByLabel('学生成绩').waitFor();
      await page.getByText('33.3%', { exact: true }).waitFor();
      await page.getByText('0 分 · 0 星', { exact: true }).waitFor();
      assert.equal(await page.locator('.teacher-mobile-page').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      await page.getByRole('button', { name: /首次题.*已做对/ }).click();
      await page.getByRole('img', { name: '首次题 · 第 0 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('img', { name: '首次题 · 第 1 手', exact: true }).waitFor();
      assert.equal(await page.locator('.teacher-submitted-moves').innerText(), '1. 车五进一');
      newer = true;
      await page.getByRole('button', { name: '刷新结果', exact: true }).click();
      await page.getByRole('img', { name: '首次题 · 第 0 手', exact: true }).waitFor();
      await page.getByText('已做对 · 2 分 · 2 星', { exact: true }).waitFor();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('img', { name: '首次题 · 第 1 手', exact: true }).waitFor();
      assert.equal(await page.locator('.teacher-submitted-moves').innerText(), '1. 车五进二');
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByText('33.3%', { exact: true }).waitFor();
      await page.getByRole('button', { name: /未交题.*未收到提交/ }).click();
      await page.getByText('尚无已提交的着法记录', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '播放已提交着法', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByLabel('作业统计').waitFor();
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/qixi-teacher-results-${viewport.width}.png` });
      await page.close();
      console.log(`PASS teacher grades, zero-score completion, on-demand replay and return ${viewport.width}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
