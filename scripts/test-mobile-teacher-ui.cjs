const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.TEACHER_URL || 'http://127.0.0.1:1441';

async function fixture(browser, viewport, options = {}) {
  const page = await browser.newPage({ viewport });
  let org = 'dongpu';
  let publishFailed = false;
  let expired = false;
  const created = [], published = [], requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1', 'done');
    localStorage.setItem('xiangqi-teaching-session-server', 'https://api-test.qixiapp.cn');
  });
  const user = () => ({ id: options.cai ? 'cai' : 'bai', orgId: options.unbound ? undefined : org, orgName: options.unbound ? undefined : org === 'dongpu' ? '东圃棋社' : '御圣俱乐部', role: 'coach', loginName: options.cai ? 'cai.teacher' : 'bai.teacher', displayName: options.cai ? '蔡老师' : '白老师', organizations: options.unbound ? [] : options.cai ? [{ id: 'yusheng', name: '御圣俱乐部', role: 'coach' }] : [{ id: 'dongpu', name: '东圃棋社', role: 'coach' }, { id: 'yusheng', name: '御圣俱乐部', role: 'coach' }] });
  if (options.cai) org = 'yusheng';
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), parsed = new URL(request.url()), path = parsed.pathname;
    const requestOrg = request.headers().authorization?.replace('Bearer ', '') || org;
    requests.push({ path, org: requestOrg, method: request.method() });
    let body = [], status = 200;
    if (path.endsWith('/auth/refresh')) {
      if (expired && options.refreshChangesOrg) org = 'yusheng';
      body = { token: org, expiresAt: '2099-01-01T00:00:00Z', user: user() };
    }
    else if (path.endsWith('/auth/switch-organization')) {
      if (options.switchFail) { status = 503; body = { error: '切换失败' }; }
      else {
        org = request.postDataJSON().orgId;
        body = { token: org, expiresAt: '2099-01-01T00:00:00Z', user: user() };
      }
    } else if (path.endsWith('/admin/classes')) body = [{ id: requestOrg + '-class', name: requestOrg + '班级', studentCount: 1, coachCount: 1 }];
    else if (path.endsWith('/students')) body = [{ id: requestOrg + '-student', displayName: requestOrg + '学生', loginName: requestOrg + '.student' }];
    else if (path.endsWith('/folder-tree')) body = [{ id: 'folder', name: '公共目录', path: '公共目录' }];
    else if (path.endsWith('/problem-libraries')) body = [{ id: 'library', title: '七百题库', publishedCount: options.problemSize ?? 700, reviewStatus: 'published', folderId: 'folder' }, ...(options.multiLibrary ? [{ id: 'library2', title: '第二题库', publishedCount: 9, reviewStatus: 'published' }] : [])];
    else if (path.endsWith('/problems')) {
      const library = path.split('/').at(-2), total = library === 'library2' ? 9 : parsed.searchParams.get('q') ? 120 : (options.problemSize ?? 700);
      const offset = Number(parsed.searchParams.get('cursor') || 0), limit = Number(parsed.searchParams.get('limit') || 50);
      body = { items: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: (options.duplicateProblems && library === 'library2' && i + offset < 3 ? 'library' : library) + '-' + (i + offset), libraryId: library, title: (parsed.searchParams.get('q') || '题目') + (i + offset), sourceIndex: i + offset, category: '杀法' })), totalCount: options.noTotal ? undefined : total, nextCursor: offset + limit < total ? String(offset + limit) : null };
      if (options.slowSearch && parsed.searchParams.get('q') === '慢') await new Promise(resolve => setTimeout(resolve, 500));
    } else if (path.endsWith('/admin/assignments') && request.method() === 'POST') {
      if (options.expireAtCreate && !expired) { expired = true; status = 401; body = { error: 'expired' }; }
      else {
        body = { id: 'created-' + created.length, status: 'draft', ...request.postDataJSON() };
        created.push({ ...body, org: requestOrg });
        if (options.loseCreateResponse) { await route.abort('failed'); return; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } else if (path.endsWith('/publish')) {
      const id = path.split('/').at(-2);
      if (options.failPublish && created.length === 2 && !publishFailed) { publishFailed = true; status = 503; body = { error: '发布临时失败' }; }
      else { published.push(id); body = { id, status: 'published' }; }
    } else if (path.endsWith('/admin/assignments')) {
      body = Array.from({ length: 16 }, (_, i) => ({ id: requestOrg + i, title: requestOrg + '作业' + i, status: 'published', targetCount: 1, completedCount: 0 }));
      if (options.slowAssignments && requestOrg === 'dongpu') await new Promise(resolve => setTimeout(resolve, 400));
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(url + '/teacher');
  await (options.unbound ? page.getByText('申请加入机构', { exact: true }) : page.getByText(options.cai ? '蔡老师' : '白老师', { exact: true })).waitFor();
  return { page, errors, created, published, requests };
}

async function openWizard(page) {
  await page.getByRole('button', { name: /^布置作业/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('textbox', { name: '作业标题', exact: true }).fill('移动端验收');
  await page.getByRole('button', { name: '选择整个题库', exact: true }).click();
}

async function reviewAndPublish(page) {
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('checkbox', { name: /dongpu班级/ }).check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '立即发布', exact: true }).dblclick();
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1024, height: 768 }]) {
      const { page, errors } = await fixture(browser, viewport);
      const layout = await page.locator('.teacher-mobile-page').evaluate(node => ({
        clipped: [...node.querySelectorAll('.teacher-mobile-actions,.teacher-mobile-section')].filter(section => section.scrollHeight > section.clientHeight + 2).length,
        overflow: node.scrollWidth > node.clientWidth + 2,
      }));
      assert.equal(layout.clipped, 0, 'teacher sections must not clip content at ' + viewport.width);
      assert.equal(layout.overflow, false, 'teacher page must not scroll horizontally');
      await page.getByLabel('当前机构', { exact: true }).selectOption('yusheng');
      await page.getByText('yusheng作业0', { exact: true }).waitFor();
      assert.equal(await page.getByText('dongpu作业0', { exact: true }).count(), 0, 'organization switch must refresh assignments');
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await page.getByRole('button', { name: '进入', exact: true }).click();
      await page.getByText('白老师', { exact: true }).waitFor();
      if (process.env.TEACHER_SCREENSHOTS) await page.screenshot({ path: process.env.TEACHER_SCREENSHOTS + '/teacher-' + viewport.width + '.png' });
      await openWizard(page);
      await page.locator('.teacher-mobile-page').evaluate(node => { node.scrollTop = node.scrollHeight; });
      const footer = await page.locator('.teacher-mobile-wizard-footer').boundingBox();
      assert(footer.y >= 0 && footer.y + footer.height <= viewport.height + 1, 'wizard footer must be reachable at ' + viewport.width);
      assert.equal(await page.locator('.teacher-mobile-page').evaluate(node => node.scrollWidth > node.clientWidth + 2), false);
      if (process.env.TEACHER_SCREENSHOTS) await page.screenshot({ path: process.env.TEACHER_SCREENSHOTS + '/teacher-wizard-' + viewport.width + '.png' });
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 390, height: 460 });
        await page.getByRole('textbox', { name: '作业标题', exact: true }).fill('键盘验收');
        await page.locator('.teacher-mobile-page').evaluate(node => { node.scrollTop = node.scrollHeight; });
        const keyboardFooter = await page.locator('.teacher-mobile-wizard-footer').boundingBox();
        assert(keyboardFooter.y + keyboardFooter.height <= 461, 'wizard must adapt to reduced keyboard viewport');
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS teacher layout and authenticated home navigation');
    if (process.env.TEACHER_LAYOUT_ONLY) return;
    {
      const { page } = await fixture(browser, { width: 390, height: 844 }, { slowSearch: true });
      await openWizard(page);
      await page.getByLabel('搜索当前题库').fill('慢');
      await page.waitForTimeout(80);
      await page.getByLabel('搜索当前题库').fill('快');
      await page.getByText('第 1 题 · 快0', { exact: true }).waitFor();
      await page.waitForTimeout(550);
      assert.equal(await page.getByText('第 1 题 · 慢0', { exact: true }).count(), 0);
      await page.close();
      console.log('PASS stale search response discarded');
    }
    {
      const { page, created } = await fixture(browser, { width: 390, height: 844 }, { multiLibrary: true, duplicateProblems: true });
      await openWizard(page);
      await page.getByRole('button', { name: /^第二题库/ }).click();
      await page.getByRole('button', { name: '选择整个题库', exact: true }).click();
      await page.getByRole('radio', { name: '按批次数', exact: true }).check();
      await reviewAndPublish(page);
      await page.getByText('教师工作台', { exact: true }).waitFor();
      assert.equal(created.length, 13);
      const ids = created.flatMap(item => item.problemIds);
      assert.equal(ids.length, 706);
      assert.equal(new Set(ids).size, 706);
      assert.equal(created.filter(item => item.title.includes('七百题库')).length, 7);
      assert.equal(created.filter(item => item.title.includes('第二题库')).length, 6);
      assert(created.every(item => item.problemIds.every(id => id.startsWith(item.title.includes('第二题库') ? 'library2-' : 'library-'))));
      await page.close();
      console.log('PASS independent multi-library batches and global deduplication');
    }
    {
      const { page, created } = await fixture(browser, { width: 390, height: 844 }, { problemSize: 0 });
      await openWizard(page);
      await page.getByRole('button', { name: '下一步' }).click();
      await page.getByRole('alert').filter({ hasText: '请至少选择一道题目' }).waitFor();
      assert.equal(created.length, 0);
      await page.close();
      console.log('PASS empty selection');
    }
    for (const scenario of ['response-lost', 'refresh-changed-org']) {
      const { page, created, requests } = await fixture(browser, { width: 390, height: 844 }, { loseCreateResponse: scenario === 'response-lost', expireAtCreate: scenario === 'refresh-changed-org', refreshChangesOrg: scenario === 'refresh-changed-org' });
      await openWizard(page);
      await page.getByRole('radio', { name: '按批次数', exact: true }).check();
      for (const value of ['0', '-1', '1.5', '10001']) {
        await page.getByLabel('批次数', { exact: true }).fill(value);
        assert.equal(await page.getByRole('button', { name: '下一步' }).isEnabled(), false, 'invalid count ' + value);
      }
      await page.getByLabel('批次数', { exact: true }).fill('7');
      await reviewAndPublish(page);
      await page.getByRole('alert').filter({ hasText: '创建结果未确认' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '继续发布', exact: true }).isEnabled(), false);
      assert.equal(created.length, scenario === 'response-lost' ? 1 : 0);
      assert.equal(requests.filter(item => item.path.endsWith('/admin/assignments') && item.method === 'POST' && item.org === 'yusheng').length, 0);
      await page.close();
      console.log('PASS ' + scenario + ' blocks unsafe retries');
    }
    {
      const { page } = await fixture(browser, { width: 390, height: 844 }, { unbound: true });
      const bounds = await page.locator('.teacher-mobile-unbound-join').evaluate(node => ({ bottom: node.getBoundingClientRect().bottom, viewport: innerHeight }));
      assert(bounds.bottom <= bounds.viewport - 58, 'unbound teacher page must reserve primary navigation');
      await page.close();
      console.log('PASS unbound teacher safe navigation');
    }
    for (const fail of [false, true]) {
      const { page, errors } = await fixture(browser, { width: 390, height: 844 }, { switchFail: fail, slowAssignments: true });
      await openWizard(page);
      page.once('dialog', dialog => dialog.accept());
      await page.getByLabel('当前机构', { exact: true }).selectOption('yusheng');
      if (fail) {
        await page.getByRole('alert').filter({ hasText: '切换失败' }).waitFor();
        assert.equal(await page.getByRole('textbox', { name: '作业标题', exact: true }).inputValue(), '移动端验收');
        assert.equal(await page.getByLabel('当前机构', { exact: true }).inputValue(), 'dongpu');
        await page.getByText('已选择 700 题', { exact: true }).waitFor();
      } else {
        await page.getByText('确认布置机构', { exact: true }).waitFor();
        await page.getByRole('button', { name: '下一步' }).click();
        assert.equal(await page.getByRole('textbox', { name: '作业标题', exact: true }).inputValue(), '移动端验收');
        await page.getByText('已选择 0 题', { exact: true }).waitFor();
      }
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: '返回教师工作台', exact: true }).click();
      await page.getByText('选择作业题目', { exact: true }).waitFor();
      page.once('dialog', dialog => dialog.dismiss());
      await page.evaluate(() => history.back());
      await page.waitForTimeout(100);
      assert.equal(new URL(page.url()).pathname, '/teacher/assignments/new');
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: '返回教师工作台', exact: true }).click();
      await page.getByText('教师工作台', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS switch ' + (fail ? 'failure preserves draft' : 'clears scoped selection') + ' and leave confirmation');
    }
    {
      const { page } = await fixture(browser, { width: 390, height: 844 }, { cai: true });
      assert.equal(await page.getByLabel('当前机构', { exact: true }).locator('option').count(), 1);
      assert.equal(await page.getByLabel('当前机构', { exact: true }).inputValue(), 'yusheng');
      await page.close();
      console.log('PASS single institution teacher');
    }
    for (const mode of ['size', 'count', 'remainder', 'overcount', 'retry', 'search', 'expired']) {
      const { page, created, published, errors } = await fixture(browser, { width: 390, height: 844 }, { failPublish: mode === 'retry', expireAtCreate: mode === 'expired', problemSize: mode === 'remainder' ? 10 : mode === 'overcount' ? 3 : 700, noTotal: mode === 'search' });
      await openWizard(page);
      if (mode === 'size') {
        await page.getByRole('radio', { name: '自定义题数', exact: true }).check();
        assert.equal(await page.getByRole('spinbutton', { name: '每批题数', exact: true }).inputValue(), '20');
      } else if (mode === 'search') {
        await page.getByLabel('搜索当前题库').fill('命中');
        await page.getByRole('button', { name: /选择当前搜索结果/ }).click();
        await page.getByText('已选择 120 题', { exact: true }).waitFor();
      } else {
        await page.getByRole('radio', { name: '按批次数', exact: true }).check();
        if (mode === 'remainder') await page.getByLabel('批次数', { exact: true }).fill('3');
      }
      await reviewAndPublish(page);
      if (mode === 'retry') {
        await page.getByRole('alert').filter({ hasText: '发布临时失败' }).waitFor();
        assert.equal(created.length, 2);
        assert.equal(published.length, 1);
        await page.getByRole('button', { name: '继续发布', exact: true }).dblclick();
      }
      await page.getByText('教师工作台', { exact: true }).waitFor();
      const expectedCount = mode === 'size' ? 35 : mode === 'remainder' || mode === 'overcount' ? 3 : mode === 'search' ? 1 : 7;
      assert.equal(created.length, expectedCount, mode + ': correct number of assignments');
      assert.equal(new Set(published).size, expectedCount, mode + ': no repeated publication');
      const ids = created.flatMap(item => item.problemIds);
      assert.equal(new Set(ids).size, mode === 'remainder' ? 10 : mode === 'overcount' ? 3 : mode === 'search' ? 120 : 700);
      assert.equal(ids.length, new Set(ids).size, 'selected problems must not repeat');
      if (mode === 'size') assert(created.every(item => item.problemIds.length === 20));
      if (mode === 'count' || mode === 'retry') assert(created.every(item => item.problemIds.length === 100));
      if (mode === 'remainder') assert.deepEqual(created.map(item => item.problemIds.length), [3, 3, 4]);
      assert(created.every(item => item.org === 'dongpu' && item.classIds.join() === 'dongpu-class'));
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS batch scenario ' + mode);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
