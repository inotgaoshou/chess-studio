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
        else if (path.endsWith('/problems/two')) body = { title: '零分完成题', startingFen: fen, moves: ['e1e2'] };
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
      await page.getByRole('button', { name: '全部提交 0 人，查看学生名单', exact: true }).click();
      await page.getByText('暂无全部提交学生', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部学生', exact: true }).click();
      await page.getByText('接收学生 · 1 人', { exact: true }).waitFor();
      await page.getByRole('button', { name: '部分提交 1 人，查看学生名单', exact: true }).click();
      await page.getByText('部分提交学生 · 1 人', { exact: true }).waitFor();
      await page.getByRole('button', { name: /审核学生.*review.student/ }).click();
      await page.getByLabel('学生成绩').waitFor();
      const identity = page.getByLabel('学生身份', { exact: true });
      await identity.getByText('学生姓名：审核学生', { exact: true }).waitFor();
      await identity.getByText('登录账号：review.student', { exact: true }).waitFor();
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
      await page.getByRole('button', { name: '展开题号', exact: true }).click();
      assert.equal(await page.getByLabel('题号列表').getByRole('button').count(), 3);
      assert.equal(await page.getByRole('button', { name: '上一题', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      await page.getByRole('img', { name: '零分完成题 · 第 0 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '第 3 题：未交题', exact: true }).click();
      await page.getByRole('img', { name: '未交题 · 第 0 手', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '下一题', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: '上一题', exact: true }).click();
      await page.getByRole('img', { name: '零分完成题 · 第 0 手', exact: true }).waitFor();
      await page.screenshot({ path: `/tmp/qixi-teacher-problem-nav-${viewport.width}.png` });
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByText('33.3%', { exact: true }).waitFor();
      await page.getByRole('button', { name: /未交题.*未收到提交/ }).click();
      await page.getByText('尚无已提交的着法记录', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '播放已提交着法', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByLabel('作业统计').waitFor();
      assert.equal(await page.getByRole('button', { name: '部分提交 1 人，查看学生名单', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByText('部分提交学生 · 1 人', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/qixi-teacher-results-${viewport.width}.png` });
      await page.close();
      console.log(`PASS teacher grades, zero-score completion, on-demand replay and return ${viewport.width}`);
    }
    for (const viewport of [{ width: 360, height: 740 }, { width: 1024, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      let refreshed = false;
      const rows = [
        { studentId: 'unsubmitted', displayName: '   ', loginName: 'student.waiting', submittedCount: 0, completedCount: 0, totalScore: 0 },
        { studentId: 'partial', displayName: '同名学生', loginName: 'student.partial', submittedCount: 1, completedCount: 1, totalScore: 3 },
        { studentId: 'full', displayName: '同名学生', loginName: 'student.full', submittedCount: 3, completedCount: 2, totalScore: 4 },
        ...Array.from({ length: 20 }, (_, index) => ({ studentId: `solved-${index}`, displayName: `零分完成学生${index + 1}`, loginName: `student.solved.${index + 1}`, submittedCount: 3, completedCount: 3, totalScore: 0 })),
      ].map(row => ({ ...row, totalCount: 3, firstTryCorrectCount: 0 }));
      await page.addInitScript(() => { localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done'); localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn'); });
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'teacher', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'teacher', orgId: 'org', orgName: '审核机构', role: 'coach', loginName: 'teacher', displayName: '审核老师', organizations: [{ id: 'org', name: '审核机构', role: 'coach' }] } };
        else if (path.endsWith('/admin/assignments')) body = [{ id: 'filters', title: '名单筛选作业', status: 'published', targetCount: 23, itemCount: 3, completedCount: 20 }];
        else if (path.endsWith('/results/summary')) body = { recipientCount: 23, partialSubmissionCount: 1, fullSubmissionCount: refreshed ? 22 : 21, fullySolvedCount: 20, completedProblemCount: 63, assignedProblemCount: 69, completionRate: 91.3, averageTotalScore: 0.2 };
        else if (path.endsWith('/filters/results')) body = rows.map(row => refreshed && row.studentId === 'partial' ? { ...row, submittedCount: 3 } : row);
        else if (/\/students\/[^/]+\/results$/.test(path)) body = { items: [{ problemId: 'one', title: '名单题目', order: 0, completed: true, outcome: 'completed', score: 0, stars: 0, mistakes: 3, hintsUsed: 0, firstTryCorrect: false, submittedAt: '2026-10-02T00:00:00Z' }], nextCursor: null };
        else if (path.endsWith('/problems/one')) body = { title: '名单题目', startingFen: fen, moves: ['e1e2'] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(base + '/teacher');
      await page.getByText('名单筛选作业', { exact: true }).click();
      const list = page.getByLabel('学生名单', { exact: true });
      await page.getByText('接收学生 · 23 人', { exact: true }).waitFor();
      assert.equal(await list.locator('.teacher-result-row').count(), 23);
      assert.equal(await list.getByText('学生姓名：同名学生', { exact: true }).count(), 2);
      await list.getByText('登录账号：student.partial', { exact: true }).waitFor(); await list.getByText('登录账号：student.full', { exact: true }).waitFor();
      await page.getByRole('button', { name: /姓名未填写.*student.waiting/ }).click();
      await page.getByLabel('学生身份').getByText('学生姓名：姓名未填写', { exact: true }).waitFor();
      await page.getByLabel('学生身份').getByText('登录账号：student.waiting', { exact: true }).waitFor();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByRole('button', { name: '部分提交 1 人，查看学生名单', exact: true }).click();
      await page.getByText('部分提交学生 · 1 人', { exact: true }).waitFor();
      assert.equal(await list.locator('.teacher-result-row').count(), 1);
      await list.getByText('登录账号：student.partial', { exact: true }).waitFor();
      await page.getByRole('button', { name: /同名学生.*student.partial/ }).click();
      await page.getByLabel('学生身份').getByText('学生姓名：同名学生', { exact: true }).waitFor();
      await page.getByLabel('学生身份').getByText('登录账号：student.partial', { exact: true }).waitFor();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByRole('button', { name: '全部提交 21 人，查看学生名单', exact: true }).click();
      await page.getByText('全部提交学生 · 21 人', { exact: true }).waitFor();
      assert.equal(await list.locator('.teacher-result-row').count(), 21);
      assert.equal(await list.getByText('登录账号：student.partial', { exact: true }).count(), 0);
      await page.getByRole('button', { name: /同名学生.*student.full/ }).click();
      await page.getByLabel('学生身份').getByText('学生姓名：同名学生', { exact: true }).waitFor();
      await page.getByLabel('学生身份').getByText('登录账号：student.full', { exact: true }).waitFor();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByRole('button', { name: '全部做对 20 人，查看学生名单', exact: true }).click();
      await page.getByText('全部做对学生 · 20 人', { exact: true }).waitFor();
      assert.equal(await list.locator('.teacher-result-row').count(), 20);
      assert.equal(await list.getByText('登录账号：student.full', { exact: true }).count(), 0);
      await list.getByText('登录账号：student.solved.20', { exact: true }).scrollIntoViewIfNeeded();
      const position = await page.locator('.teacher-mobile-page').evaluate(node => node.scrollTop);
      assert.ok(position > 0);
      await page.getByRole('button', { name: /零分完成学生20.*student.solved.20/ }).click();
      await page.getByRole('button', { name: /名单题目.*已做对/ }).click();
      await page.getByRole('img', { name: '名单题目 · 第 0 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('img', { name: '名单题目 · 第 1 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByRole('button', { name: '返回学生列表', exact: true }).click();
      await page.getByText('全部做对学生 · 20 人', { exact: true }).waitFor();
      await page.waitForFunction(position => Math.abs(document.querySelector('.teacher-mobile-page').scrollTop - position) < 2, position);
      await page.getByRole('button', { name: '刷新结果', exact: true }).click();
      await page.getByRole('button', { name: '全部提交 21 人，查看学生名单', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '全部做对 20 人，查看学生名单', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByRole('button', { name: '部分提交 1 人，查看学生名单', exact: true }).click();
      refreshed = true;
      await page.getByRole('button', { name: '刷新结果', exact: true }).click();
      await page.getByText('暂无部分提交学生', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部学生', exact: true }).click();
      await page.getByText('接收学生 · 23 人', { exact: true }).waitFor();
      assert.equal(await list.locator('.teacher-result-row').count(), 23);
      assert.equal(await page.locator('.teacher-mobile-page').evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
      await page.screenshot({ path: `/tmp/qixi-teacher-filter-${viewport.width}.png` });
      await page.close();
      console.log(`PASS student filter counts, duplicate names, zero-score solved, refresh and scroll return ${viewport.width}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
