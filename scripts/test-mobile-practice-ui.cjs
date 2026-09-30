const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.PRACTICE_URL || 'http://127.0.0.1:1440';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problems = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, libraryId: 'lib', title: `长标题专项练习题目${i}及关键杀法判断`, sourceIndex: i, category: i < 22 ? '杀法' : '残局', startingFen: fen, sideToMove: 'red', solutionLength: 1, solution: [{ iccs: 'a0a1', comment: '', children: [] }], note: '', active: true }));
const topic = { id: 'topic', name: '长标题练习专题与专项训练', description: '杀法练习', contentKind: 'problem', itemCount: 25, sources: [{ libraryId: 'lib' }] };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let dashboardFail = true, listFail = true, sessionFail = true, attemptFail = false;
      let favorites = [problems[0]], created, payloads = [], attempts = [];
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      await page.route('https://api*.qixiapp.cn/**', async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        let status = 200, body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'mock-token', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'student', orgId: 'org', role: 'student', loginName: 'mock', displayName: '验证学生' } };
        else if (path.endsWith('/practice/dashboard')) {
          if (dashboardFail) { dashboardFail = false; status = 503; body = { error: '练习网络失败' }; }
          else body = { pendingAssignmentCount: 0, wrongCount: 0, favoriteCount: favorites.length, topics: [topic], studyTopics: [], history: [] };
        } else if (path.endsWith('/practice/mistakes')) {
          if (listFail) { listFail = false; status = 503; body = { error: '错题网络失败' }; }
          else body = new URL(req.url()).searchParams.get('state') === 'mastered' ? problems.map((problem) => ({ problem, reviewState: 'mastered', errorAttempts: 2, totalAttempts: 3, lastHintsUsed: 0 })) : [];
        } else if (path.endsWith('/practice/favorites')) body = favorites.map((problem) => ({ problem, reviewState: 'pending', errorAttempts: 1 }));
        else if (path.endsWith('/favorite')) { favorites = req.method() === 'DELETE' ? [] : [problems[0]]; body = {}; }
        else if (path.endsWith('/practice/search')) body = { items: [problems[0]] };
        else if (path.endsWith('/practice/sessions') && req.method() === 'POST') {
          const payload = req.postDataJSON(); payloads.push(payload);
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (sessionFail) { sessionFail = false; status = 400; body = { error: '创建失败，请重试' }; }
          else {
            created = { id: `s${payloads.length}`, sourceKind: payload.sourceKind, mode: payload.mode || 'solver', status: 'active', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: (payload.problemIds || ['p0']).map((id, ordinal) => ({ id: `i${ordinal}`, ordinal, status: 'pending', problem: problems.find((p) => p.id === id) })) };
            body = created;
          }
        } else if (path.endsWith('/attempts')) {
          const attempt = req.postDataJSON(); attempts.push(attempt);
          if (attemptFail) { attemptFail = false; status = 503; body = { error: '提交离线' }; }
          else { created.items[0].status = attempt.outcome; body = created; }
        }
        else if (/practice\/sessions\//.test(path)) body = created;
        else if (path.endsWith('/personal-manuals/sync')) body = { records: [], conflictCount: 0, status: {} };
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${url}/practice`);
      await page.getByText('练习网络失败', { exact: true }).waitFor();
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.getByRole('button', { name: /自选专项/ }).waitFor();
      const cardBounds = await page.locator('.mobile-practice-grid > button').evaluateAll((cards) => cards.map((card) => {
        const text = card.querySelector('span').getBoundingClientRect(), arrow = card.lastElementChild.getBoundingClientRect(), box = card.getBoundingClientRect();
        return { valid: arrow.x >= text.right && arrow.right <= box.right && text.right <= box.right };
      }));
      assert(cardBounds.every((card) => card.valid), 'arrows must remain right of text');
      await page.screenshot({ path: `/tmp/practice-home-${viewport.width}.png` });
      await page.getByRole('button', { name: /错题复习.*暂时没有/ }).click();
      await page.getByText('错题网络失败', { exact: true }).waitFor();
      await page.getByRole('button', { name: '重试', exact: true }).click();
      await page.getByText('暂无待复习题目，可查看已掌握题目').waitFor();
      await page.getByRole('button', { name: '已掌握', exact: true }).click();
      await page.getByRole('checkbox').first().waitFor();
      await page.screenshot({ path: `/tmp/practice-before-selection-${viewport.width}.png` });
      await page.getByRole('button', { name: '全选前 20 题' }).click();
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 20);
      await page.getByRole('button', { name: '残局', exact: true }).click();
      assert.equal(await page.locator('input[type=checkbox]:checked').count(), 0);
      const start = page.getByRole('button', { name: /巩固重练/ });
      await page.screenshot({ path: `/tmp/practice-review-${viewport.width}.png` });
      await start.dblclick();
      await page.getByText('创建失败，请重试', { exact: true }).waitFor();
      assert.equal(payloads.length, 1, 'duplicate clicks must issue one request');
      assert.equal(payloads[0].count, 3); assert.equal(payloads[0].scope, 'all');
      assert.deepEqual(payloads[0].problemIds, ['p22', 'p23', 'p24']);
      await start.click();
      await page.locator('.mobile-solver-page').waitFor();
      const abandonmentResponse = page.waitForResponse((response) => response.url().endsWith('/attempts'));
      await page.getByRole('button', { name: '放弃本题', exact: true }).click();
      await abandonmentResponse;
      await page.waitForFunction(() => document.querySelector('.mobile-solver-result'));
      assert.equal(attempts.at(-1).outcome, 'abandoned');
      await page.getByRole('button', { name: '返回练习', exact: true }).click();
      await page.getByRole('button', { name: /收藏练习/ }).click();
      await page.getByRole('button', { name: /^取消收藏/ }).click();
      await page.getByText('还没有收藏题目').waitFor();
      await page.getByRole('button', { name: '返回练习', exact: true }).click();
      await page.getByRole('button', { name: '搜索题目', exact: true }).click();
      await page.getByRole('textbox', { name: '搜索练习题' }).fill('杀法');
      await page.getByRole('button', { name: '开始搜索' }).click();
      await page.getByRole('button', { name: /长标题专项练习题目0/ }).click();
      await page.locator('.mobile-solver-page').waitFor();
      assert.equal(payloads.at(-1).count, 1); assert.deepEqual(payloads.at(-1).problemIds, ['p0']);
      await page.screenshot({ path: `/tmp/practice-solver-${viewport.width}.png` });
      const layout = await page.locator('.mobile-solver-page').evaluate((node) => {
        const workspace = node.querySelector('.mobile-solver-workspace').getBoundingClientRect();
        const footer = node.querySelector('.mobile-solver-nav').getBoundingClientRect();
        return { workspaceBottom: workspace.bottom, footerTop: footer.top };
      });
      assert(layout.footerTop >= layout.workspaceBottom, 'solver footer must not overlap the workspace');
      const solve = async () => {
        const completionResponse = page.waitForResponse((response) => response.url().endsWith('/attempts'));
        await page.locator('.mobile-solver-board .board-square').nth(81).click();
        await page.locator('.mobile-solver-board .board-square').nth(72).click();
        await completionResponse;
        await page.locator('.mobile-solver-result').waitFor();
        await page.waitForFunction(() => document.querySelector('.mobile-solver-result strong')?.textContent !== '');
      };
      const searchAgain = async () => {
        await page.getByRole('button', { name: '返回练习', exact: true }).click();
        await page.getByRole('button', { name: '搜索题目', exact: true }).click();
        await page.getByRole('button', { name: '开始搜索' }).click();
        await page.getByRole('button', { name: /长标题专项练习题目0/ }).click();
        await page.locator('.mobile-solver-page').waitFor();
      };
      await solve();
      await page.getByRole('button', { name: '查看结果', exact: true }).click();
      await page.getByText('已完成', { exact: true }).waitFor();
      assert.equal(await page.getByText('已掌握本次题目', { exact: true }).count(), 0);
      assert.equal(attempts.at(-1).hintsUsed, 0); assert.equal(attempts.at(-1).mistakes, 0); assert.equal(attempts.at(-1).outcome, 'completed');
      await searchAgain();
      await page.getByRole('button', { name: '提示 0/3', exact: true }).click();
      await page.getByRole('button', { name: '提示 1/3', exact: true }).waitFor();
      await solve();
      assert.equal(attempts.at(-1).hintsUsed, 1); assert.equal(attempts.at(-1).outcome, 'completed');
      await searchAgain();
      attemptFail = true;
      await page.getByRole('button', { name: '查看解析', exact: true }).click();
      await page.getByText(/本次练习已保存在本机/).waitFor();
      const queuedId = attempts.at(-1).clientAttemptId;
      assert.equal(attempts.at(-1).outcome, 'revealed');
      const retried = page.waitForResponse((response) => response.url().endsWith('/attempts') && response.request().postDataJSON()?.clientAttemptId === queuedId && response.status() === 200);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await retried;
      assert.equal(await page.locator('.mobile-solver-page').count(), 1, 'reconnecting must submit without leaving the question');
      assert.equal(attempts.filter((attempt) => attempt.clientAttemptId === queuedId).length, 2, 'offline retry preserves idempotency ID');
      assert.deepEqual(errors, []);
      console.log(`${viewport.width}: retries, mastered review, max20, filters, scope/count, duplicate guard, favorites, search, clean/hinted completion, reveal, abandonment and offline resubmission passed`);
      await page.close();
    }
    const draftSolution = [
      { iccs: 'a0a1', children: [{ iccs: 'a9a8', children: [{ iccs: 'a1a2', children: [] }] }] },
      { iccs: 'a0a2', children: [{ iccs: 'a9a8', children: [{ iccs: 'a2a1', children: [] }] }] },
    ];
    for (const { savedMoves, startingFen = fen, solution = draftSolution, terminal = false } of [
      { savedMoves: ['a0a2', 'a9a8'] }, { savedMoves: ['a0a2'] }, { savedMoves: ['a0a2', 'a9a8', 'a2a1'] },
      { savedMoves: ['e7e8'], startingFen: '4k4/3R1R3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
        solution: [{ iccs: 'e7e8', children: [{ iccs: 'e9d9', children: [] }] }], terminal: true },
    ]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [], submitted = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const assignment = { id: 'draft-assignment', title: '草稿恢复作业', status: 'published', itemCount: 1, targetCount: 1, completedCount: 0, createdAt: new Date().toISOString() };
      const assignmentProblem = { assignmentId: assignment.id, problemId: 'draft-problem', title: '多步分支草稿', category: '残局', startingFen, solution, note: '', accessTier: 'public', completed: false, attemptCount: 0 };
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      await page.route('https://api*.qixiapp.cn/**', async (route) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        let body = [];
        if (path.endsWith('/auth/refresh')) body = { token: 'draft-token', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'draft-student', orgId: 'org', role: 'student', loginName: 'draft', displayName: '草稿学生' } };
        else if (path.endsWith('/practice/dashboard')) body = { pendingAssignmentCount: 1, wrongCount: 0, favoriteCount: 0, topics: [], studyTopics: [], history: [] };
        else if (path.endsWith('/student/assignments')) body = { items: [assignment] };
        else if (path.endsWith('/problems')) body = { items: [assignmentProblem] };
        else if (path.endsWith('/view')) body = {};
        else if (path.endsWith('/attempts')) {
          submitted.push(req.postDataJSON());
          assignmentProblem.completed = true;
          assignmentProblem.attemptCount = 1;
          body = { id: 'draft-attempt' };
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${url}/assignments`);
      await page.getByRole('button', { name: /草稿恢复作业/ }).waitFor();
      await page.evaluate(async ({ savedMoves, assignmentId, problemId }) => {
        const db = await new Promise((resolve, reject) => {
          const opening = indexedDB.open('xiangqi-teaching-cache');
          opening.onsuccess = () => resolve(opening.result);
          opening.onerror = () => reject(opening.error);
        });
        const cache = await new Promise((resolve, reject) => {
          const request = db.transaction('assignmentCaches').objectStore('assignmentCaches').getAll();
          request.onsuccess = () => resolve(request.result.find((row) => row.assignment.id === assignmentId));
          request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
          const transaction = db.transaction('assignmentDrafts', 'readwrite');
          transaction.objectStore('assignmentDrafts').put({
            cacheKey: `${cache.cacheKey}::${problemId}`, assignmentId, problemId, moves: savedMoves,
            hints: 1, mistakes: 2, elapsedMs: 12000, ownerId: cache.ownerId, orgId: cache.orgId,
            serverUrl: cache.serverUrl, updatedAt: new Date().toISOString(),
          });
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        db.close();
      }, { savedMoves, assignmentId: assignment.id, problemId: assignmentProblem.problemId });
      const openQuestion = async () => {
        await page.getByRole('button', { name: /草稿恢复作业/ }).click();
        await page.getByRole('button', { name: /第 1 题：多步分支草稿/ }).click();
        await page.getByText(terminal || savedMoves.length === 3 ? '已恢复完成的题解。' : '已恢复上次进度，可继续完成题解。', { exact: true }).waitFor();
      };
      const completionResponse = page.waitForResponse((response) => response.url().endsWith('/attempts')).catch((error) => error);
      await openQuestion();
      assert.match(await page.locator('.mobile-solver-meta b').textContent(), /^00:1[2-9]$/);
      if (!terminal && savedMoves.length < 3) {
        assert.match(await page.locator('.mobile-solver-board .board-square.last-to').getAttribute('aria-label'), /^a8 黑/);
        assert.equal(await page.getByRole('button', { name: '提示 1/3', exact: true }).count(), 1);
        assert.equal(await page.locator('.mobile-solver-board .board-square[aria-label^="a2 红"] img').count(), 1);
        assert.equal(await page.locator('.mobile-solver-board .board-square[aria-label="a0"] img').count(), 0);
        await page.getByRole('button', { name: '返回练习', exact: true }).click();
        await openQuestion();
        await page.locator('.mobile-solver-board .board-square[aria-label^="a2 红"]').click();
        await page.locator('.mobile-solver-board .board-square[aria-label="a1"]').click();
      }
      await page.locator('.mobile-solver-result').waitFor();
      assert(!(await completionResponse instanceof Error), 'recovered completion must reach the server');
      assert.equal(submitted.length, 1, 'a completed recovered path submits exactly one attempt');
      assert.deepEqual(submitted[0].moves, terminal ? ['e7e8'] : ['a0a2', 'a9a8', 'a2a1']);
      assert.equal(submitted[0].hintsUsed, 1);
      assert.equal(submitted[0].mistakes, 2);
      assert(submitted[0].elapsedMs >= 12000, 'saved elapsed time survives recovery');
      assert.equal(submitted[0].outcome, 'completed');
      assert.deepEqual(errors, []);
      console.log(`${savedMoves.length} saved half-moves: branch, board, last move, timer, delayed reply and completed-path submission passed`);
      await page.close();
    }
    for (const role of [null, 'user']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      let listRequests = 0;
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      await page.route('https://api*.qixiapp.cn/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes('/practice/mistakes')) listRequests++;
        const body = path.endsWith('/auth/refresh') && role ? { token: 'mock-token', expiresAt: '2099-01-01T00:00:00Z', user: { id: 'personal', role, displayName: '个人账号' } } : [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${url}/practice`);
      await page.getByText(role ? '平台练习仅学生账号可用' : '登录学生账号开始平台练习').waitFor();
      assert(await page.getByRole('button', { name: /错题复习.*暂时没有/ }).isDisabled());
      await page.evaluate(() => { history.pushState({}, '', '/practice/mistakes'); dispatchEvent(new PopStateEvent('popstate')); });
      await page.getByText(role ? '平台练习仅学生账号可用' : '登录学生账号开始平台练习').waitFor();
      assert.equal(listRequests, 0);
      await page.getByRole('button', { name: role ? '切换学生账号' : '登录账号', exact: true }).click();
      await page.locator('.teaching-account-dialog').waitFor();
      console.log(`${role || 'logged out'}: practice access guard, direct route guard and login/switch entry passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
