const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.TEACHER_URL || 'http://127.0.0.1:1441';
const firstFen = '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1';
const nextFen = '4k4/9/9/9/9/9/9/4R4/9/4K4 w - - 0 1';
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 800, height: 1280 }, { width: 1280, height: 800 }]) {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
      let failNext = true, delay = 400, refreshMove = false;
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'teacher', expiresAt: '2099-01-01', user: { id: 'teacher', orgId: 'org', role: 'coach', loginName: 'teacher', displayName: '老师' } };
        else if (path.endsWith('/admin/assignments')) body = [{ id: 'assignment', title: '无闪烁作业', status: 'published', itemCount: 3 }];
        else if (path.endsWith('/results/summary')) body = { recipientCount: 1, partialSubmissionCount: 1, fullSubmissionCount: 0, fullySolvedCount: 0, completedProblemCount: 1, assignedProblemCount: 3, completionRate: 33, averageTotalScore: null };
        else if (path.endsWith('/assignment/results')) body = [{ studentId: 'student', loginName: 'student', displayName: '学生', totalCount: 3, submittedCount: 1, completedCount: 1, firstTryCorrectCount: 1 }];
        else if (path.endsWith('/students/student/results')) body = { items: [0, 1, 2].map(order => ({ problemId: `p${order}`, order, title: `题目${order + 1}`, completed: false, firstTryCorrect: false })), nextCursor: null };
        else if (path.includes('/problems/p')) {
          const id = Number(path.at(-1));
          await new Promise(r => setTimeout(r, delay));
          if (id === 1 && failNext) { failNext = false; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"临时加载失败"}' }); return; }
          body = { startingFen: id === 1 ? nextFen : firstFen, moves: id === 0 ? [refreshMove ? 'e1e3' : 'e1e2'] : null };
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(base + '/teacher');
      await page.getByText('无闪烁作业', { exact: true }).click();
      await page.getByRole('button', { name: /学生姓名：学生/ }).click();
      await page.getByRole('button', { name: '展开题号', exact: true }).waitFor();
      assert.equal(await page.getByLabel('题号列表').isVisible(), false);
      await page.getByRole('button', { name: /1\. 题目1/ }).click();
      await page.getByRole('img', { name: '题目1 · 第 0 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '播放已提交着法', exact: true }).click();
      await page.evaluate(() => {
        const board = document.querySelector('.teacher-submitted-replay .fen-mini-board');
        window.retainedBoard = board;
        window.retainedKing = board.querySelector('img[src$="/bk.png"]');
        window.switchFrames = [];
        window.monitorSwitch = true;
        const sample = () => {
          if (!window.monitorSwitch) return;
          window.switchFrames.push({ retained: window.retainedBoard.isConnected, height: window.retainedBoard.getBoundingClientRect().height });
          requestAnimationFrame(sample);
        };
        sample();
      });
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      await page.getByText('正在切换到第 2 题…', { exact: true }).waitFor();
      assert.equal(await page.getByRole('img', { name: /^题目1/ }).count(), 1, 'old title and board remain during loading');
      assert.equal(await page.locator('.teacher-problem-navigation strong').innerText(), '第 1/3 题');
      await page.getByRole('alert').waitFor();
      assert(await page.evaluate(() => window.retainedBoard === document.querySelector('.teacher-submitted-replay .fen-mini-board')));
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.getByRole('img', { name: '题目2 · 第 0 手', exact: true }).waitFor();
      assert.equal(await page.locator('.teacher-problem-navigation strong').innerText(), '第 2/3 题');
      assert(await page.evaluate(() => window.retainedKing === document.querySelector('.teacher-submitted-replay img[src$="/bk.png"]')), 'unchanged piece image is reused');
      assert.equal(await page.getByLabel('题号列表').isVisible(), false, 'switching preserves collapsed state');
      assert(await page.evaluate(() => window.switchFrames.every(frame => frame.retained && frame.height > 100)), 'no detached board or blank-height frame');
      await page.getByRole('button', { name: '展开题号', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: '第 2 题：题目2', exact: true }).getAttribute('aria-current'), 'step');
      await page.getByRole('button', { name: '上一题', exact: true }).click();
      await page.getByRole('img', { name: '题目1 · 第 0 手', exact: true }).waitFor();
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('img', { name: '题目1 · 第 1 手', exact: true }).waitFor();
      refreshMove = true;
      await page.getByRole('button', { name: '刷新结果', exact: true }).click();
      await page.getByRole('img', { name: '题目1 · 第 0 手', exact: true }).waitFor();
      assert(await page.evaluate(() => window.retainedBoard === document.querySelector('.teacher-submitted-replay .fen-mini-board')), 'refresh retains the board');
      // Only scroll the content. A switch must not force the whole page to the top.
      await page.locator('.teacher-mobile-page').evaluate(node => { node.scrollTop = Math.min(100, node.scrollHeight - node.clientHeight); });
      const scroll = await page.locator('.teacher-mobile-page').evaluate(node => node.scrollTop);
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      await page.getByRole('img', { name: '题目2 · 第 0 手', exact: true }).waitFor();
      assert.equal(await page.locator('.teacher-mobile-page').evaluate(node => node.scrollTop), scroll);
      await page.evaluate(() => { window.monitorSwitch = false; });
      // Returning while a delayed request is in flight must not reopen its detail.
      delay = 700;
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      await page.getByRole('button', { name: '返回逐题结果', exact: true }).click();
      await page.getByLabel('逐题结果', { exact: true }).waitFor();
      await page.waitForTimeout(850);
      assert.equal(await page.locator('.teacher-submitted-replay').count(), 0);
      assert.equal(await page.getByLabel('题号列表').isVisible(), true, 'return preserves expanded preference');
      await page.reload();
      await page.getByRole('button', { name: /学生姓名：学生/ }).click();
      await page.getByLabel('题号列表').waitFor();
      await page.getByRole('button', { name: '收起题号', exact: true }).click();
      await page.reload();
      await page.getByRole('button', { name: /学生姓名：学生/ }).click();
      await page.getByRole('button', { name: '展开题号', exact: true }).waitFor();
      assert.equal(await page.getByLabel('题号列表').isVisible(), false, 'collapsed preference survives reload');
      assert.deepEqual(errors, []);
      console.log(`PASS retained board and pieces, failed switch/retry, replay reset, refresh, stale response and grid preference: ${viewport.width}x${viewport.height}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
