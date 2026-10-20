const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1440';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true,
        userAgent: viewport.width < 900 ? 'Mozilla/5.0 (Linux; Android 15; Mobile) AppleWebKit/537.36 Chrome/133.0 Mobile Safari/537.36' : undefined });
      const errors = [], submissions = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      const now = new Date();
      const date = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
      const monday = new Date(date + 'T00:00:00Z');
      monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
      const user = { id: 'student', orgId: 'family', orgName: '验收家庭', loginName: 'fixture-student', displayName: '验收学生', role: 'student', organizations: [] };
      const plan = { id: 'plan', title: '安装打卡验收', status: 'published', phase: 'active', startsAt: date + 'T00:00:00+08:00', endsAt: date + 'T23:59:59+08:00', supplementUntil: date + 'T23:59:59+08:00' };
      const tasks = ['阅读', '数学'].map((subject, i) => ({ id: 'task-' + i, templateId: 'template-' + i, localDate: date, subject, instruction: '完成今日' + subject, required: true, photoRequired: false }));
      const badges = () => submissions.length === 2 ? [{ studentId: user.id, weekStart: monday.toISOString().slice(0, 10), plannedDays: 1, earnedAt: now.toISOString(), needsSupplement: false }] : [];
      await page.route('**/api/v1/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        let body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'fixture-token', expiresAt: '2099-01-01T00:00:00Z', user };
        else if (path.endsWith('/auth/me')) body = user;
        else if (path === '/api/v1/checkin/plans') body = [plan];
        else if (path === '/api/v1/checkin/plans/plan') body = { plan, recipients: [{ studentId: user.id, displayName: user.displayName }], tasks, submissions, reviews: [], badges: badges(), serverNow: new Date().toISOString() };
        else if (path.endsWith('/submit')) {
          const taskId = path.split('/').at(-2);
          assert(!submissions.some(s => s.taskId === taskId), 'completed task must not be submitted twice');
          submissions.push({ taskId, studentId: user.id, status: 'submitted', revision: 1, note: request.postDataJSON().note, photoIds: [], submittedAt: new Date().toISOString(), isLate: false });
          body = { duplicate: false };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(url + '/checkin');
      await page.getByRole('heading', { name: '今日任务', exact: true }).waitFor();
      const scrollable = await page.locator('.checkin-tasks').evaluate(node => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return true;
        }
        return false;
      });
      const tasksFit = await page.locator('.checkin-tasks').evaluate(node => node.getBoundingClientRect().bottom <= innerHeight);
      assert(tasksFit || scrollable, 'tasks must fit or have a scrollable container at ' + viewport.width);
      for (let i = 0; i < tasks.length; i++) {
        await page.locator('.checkin-task').nth(i).getByRole('button', { name: '去打卡', exact: true }).click();
        const submit = page.getByRole('button', { name: '我完成了，盖个章', exact: true });
        await submit.scrollIntoViewIfNeeded();
        assert(await submit.evaluate(node => {
          const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.top >= 0 && r.bottom <= innerHeight && (hit === node || node.contains(hit));
        }), 'submit button must be reachable and unobscured');
        await submit.click();
        await page.locator('.checkin-task').nth(i).locator('.checkin-stamp').waitFor();
        assert.equal(submissions.length, i + 1);
      }
      await page.getByRole('heading', { name: '小马到达本周终点啦！' }).waitFor();
      assert.equal(await page.locator('.checkin-route').getAttribute('aria-label'), '本周完成1/1天');
      await page.getByRole('button', { name: '收好徽章', exact: true }).click();
      await page.getByRole('button', { name: '刷新与同步', exact: true }).click();
      await page.getByRole('heading', { name: '今日任务', exact: true }).waitFor();
      assert.equal(await page.locator('.checkin-celebration').count(), 0, 'refresh must not repeat celebration');
      assert.equal(submissions.length, 2);
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS check-in scrolling, submission and rewards ' + viewport.width + 'x' + viewport.height);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
