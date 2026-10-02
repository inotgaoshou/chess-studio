const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.PRACTICE_URL || 'http://127.0.0.1:1441';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const { role, enabled = false, allowed } of [
      { role: null, allowed: false }, { role: 'user', allowed: false },
      { role: 'coach', allowed: true }, { role: 'admin', allowed: true },
      { role: 'student', allowed: false }, { role: 'student', enabled: true, allowed: true },
    ]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let currentRole = role;
      await page.addInitScript(() => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
        localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
      });
      await page.route('https://api*.qixiapp.cn/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        let body = [];
        if (path.endsWith('/auth/refresh') && currentRole) body = {
          token: `policy-${currentRole}`, expiresAt: '2099-01-01T00:00:00Z',
          user: { id: 'policy-user', orgId: 'org', role: currentRole, loginName: 'policy', displayName: '权限验收' },
        };
        else if (path.endsWith('/practice/dashboard')) body = { studentLocalImportEnabled: enabled, pendingAssignmentCount: 0, wrongCount: 0, favoriteCount: 0, topics: [], studyTopics: [], history: [] };
        else if (path.endsWith('/student/assignments')) body = { items: [] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(`${url}/library`);
      await page.getByRole('navigation', { name: '主导航' }).waitFor();
      if (role) await page.locator('.mobile-library-overview.platform').waitFor();
      if (role === 'student' && enabled) await page.getByRole('button', { name: '导入 CBL 题库', exact: true }).first().waitFor();
      assert.equal(await page.getByRole('button', { name: '导入 CBL 题库', exact: true }).count() > 0, allowed);
      assert.equal(await page.getByRole('tablist', { name: '题库完成状态筛选' }).count(), 0);
      assert.equal(await page.getByRole('textbox', { name: '搜索题库', exact: true }).count(), 0);
      if (!role || role === 'user') {
        assert.equal(await page.getByText('我的本地题库', { exact: true }).count(), 0);
        assert.equal(await page.getByText('还没有本地题库', { exact: true }).count(), 0);
        await page.screenshot({ path: `/tmp/qixi-import-hidden-${role || 'guest'}.png` });
      }
      const nav = () => page.getByRole('navigation', { name: '主导航' });
      await nav().getByRole('button', { name: '我的', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: /导入题库/ }).count() > 0, allowed);
      await page.getByRole('button', { name: /拆棋分析/ }).click();
      await page.getByRole('button', { name: '更多功能', exact: true }).click();
      await page.locator('.study-menu').waitFor();
      assert.equal(await page.locator('.study-menu').getByRole('button', { name: '导入 CBL', exact: true }).count() > 0, allowed);
      await page.getByRole('button', { name: '关闭拆棋功能菜单', exact: true }).click();
      await page.getByRole('button', { name: '返回我的', exact: true }).click();

      if (role === 'coach') {
        await page.evaluate(async (startingFen) => {
          const { trainingStore } = await import('/src/store.ts');
          await trainingStore.importLibrary(new Uint8Array([1, 2, 3]), {
            title: '已有本地题库', declaredCount: 1, warnings: [],
            problems: [{ sourceIndex: 0, title: '本地旧题', category: '杀法', startingFen, note: '', solution: [{ iccs: 'a0a1', comment: '', children: [] }] }],
          });
        }, fen);
        await page.getByRole('button', { name: /导入题库/ }).click();
        await page.getByRole('button', { name: '选择 CBL 文件', exact: true }).waitFor();
        currentRole = 'user';
        const refresh = page.waitForResponse((response) => response.url().endsWith('/auth/refresh'));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await refresh;
        await page.locator('.import-cbl-panel').waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '账号与权益', exact: true }).click();
        await page.getByRole('button', { name: '退出登录', exact: true }).click();
        await page.locator('.mobile-account-summary').getByText('未登录', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /导入题库/ }).count(), 0);
        await nav().getByRole('button', { name: '题库', exact: true }).click();
        const library = page.getByRole('button', { name: /已有本地题库/ });
        await library.waitFor();
        assert.equal(await page.getByRole('button', { name: '导入 CBL 题库', exact: true }).count(), 0);
        assert.equal(await page.getByRole('tablist', { name: '题库完成状态筛选' }).count(), 1);
        await page.getByRole('textbox', { name: '搜索题库', exact: true }).fill('已有本地');
        await library.waitFor();
        await library.click();
        await page.getByRole('button', { name: /本地旧题/ }).waitFor();
        assert.equal(await page.locator('.import-cbl-panel').count(), 0);
      }
      if (!role) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole('button', { name: '导入 CBL', exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${role || 'logged out'}${role === 'student' ? ` policy=${enabled}` : ''}: import visibility${role === 'coach' ? ', permission change closes panel, logout retains local questions' : ''}`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
