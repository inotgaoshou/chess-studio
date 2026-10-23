// Browser acceptance for the mobile student check-in layout. Uses synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1443';
const output = process.env.CHECKIN_EVIDENCE_DIR;
if (output) fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const viewport of [{width:320,height:740}, {width:390,height:844}, {width:800,height:1280}, {width:1280,height:800}, {width:844,height:390}]) {
      const page = await browser.newPage({ viewport, isMobile:true, hasTouch:true });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(baseline => {
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
        localStorage.setItem('xiangqi-teaching-session-server',baseline?'https://api.qixiapp.cn':'http://127.0.0.1:8090');
      },!!process.env.CHECKIN_BASELINE);
      const date = new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
      const user = { id:'compact-student', orgId:'fixture', displayName:'验收学生', role:'student', organizations:[] };
      const plan = {id:'compact',title:'每日学习计划',status:'published',startsAt:date+'T00:00:00+08:00',endsAt:date+'T23:59:59+08:00',supplementUntil:'2099-01-01T00:00:00Z'};
      const tasks = Array.from({length:12},(_,i)=>({id:'task-'+i,templateId:'tpl-'+i,localDate:date,subject:['阅读','数学','象棋'][i%3],instruction:i===6?'完成第7项学习任务，认真阅读题目要求，按顺序完成练习，完成后记录今天的学习收获。'.repeat(4):`完成第${i+1}项学习任务`,required:i===0,photoRequired:false}));
      let empty = !process.env.CHECKIN_BASELINE;
      let planReads = 0;
      let pausePlans = false;
      let releasePlans;
      await page.route('**/api/v1/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/v1/checkin/plans') {
          planReads++;
          if (pausePlans) await new Promise(resolve => { releasePlans = resolve; });
        }
        const body = path.endsWith('/auth/refresh') ? {token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user}
          : path.endsWith('/auth/me') ? user : path==='/api/v1/checkin/plans' ? (empty ? [] : [plan])
          : path.endsWith('/practice/dashboard') ? {topics:[],lockedTopics:[],history:[]}
          : path==='/api/v1/checkin/plans/compact' ? {plan,tasks,recipients:[{studentId:user.id,displayName:user.displayName}],submissions:[],reviews:[],badges:[],serverNow:new Date().toISOString()} : [];
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      if (!process.env.CHECKIN_BASELINE) {
        await page.goto(url+'/home');
        const entry = page.getByRole('button', {name:/今日打卡.*去打卡/});
        await entry.waitFor();
        const homeLayout = await entry.evaluate(node => ({
          card: node.getBoundingClientRect().toJSON(), icon: node.querySelector('svg').getBoundingClientRect().toJSON(),
          page: node.parentElement.getBoundingClientRect().toJSON()
        }));
        assert(homeLayout.card.width > homeLayout.page.width - (viewport.width < 600 ? 40 : 150), 'check-in spans the home grid');
        assert(homeLayout.icon.width >= 28, 'child-friendly icon is visible');
        assert(homeLayout.card.height >= 64, 'whole card is a large touch target');
        if(output) await page.screenshot({path:`${output}/home-${viewport.width}x${viewport.height}.png`});
        // Touch the illustration, rather than the text, to verify the whole card opens check-in.
        await entry.click({position:{x:30,y:30}});
        await page.locator('.checkin-empty-state').waitFor();
        const refresh = page.getByRole('button', {name:'刷新与同步',exact:true});
        await page.waitForFunction(() => !document.querySelector('button[title="刷新与同步"]').disabled);
        const readsBefore = planReads;
        pausePlans = true;
        await refresh.click();
        await page.waitForFunction(() => document.querySelector('button[title="刷新与同步"]').disabled);
        for(let i=0;!releasePlans && i<100;i++) await page.waitForTimeout(20);
        assert(releasePlans, 'refresh requests the plan list');
        pausePlans = false; releasePlans();
        await page.waitForFunction(() => !document.querySelector('button[title="刷新与同步"]').disabled);
        assert(planReads > readsBefore, 'refresh still works with its icon button');
        if(output) await page.screenshot({path:`${output}/empty-${viewport.width}x${viewport.height}.png`});
        await page.getByRole('button', {name:'返回',exact:true}).click();
        await entry.waitFor();
        empty = false;
      }
      await page.goto(url+'/checkin');
      await page.locator('.checkin-task').nth(11).waitFor();
      const heading = await page.locator('.checkin-heading').evaluate(node => ({
        box:node.getBoundingClientRect().toJSON(), title:node.querySelector('h1').getBoundingClientRect().toJSON(),
        buttons:[...node.querySelectorAll('button')].map(b=>b.getBoundingClientRect().toJSON())
      }));
      const metrics = await page.locator('.checkin-tasks').evaluate(node => ({
        firstTaskTop:Math.round(node.querySelector('.checkin-task').getBoundingClientRect().top),
        taskListHeight:Math.round(node.getBoundingClientRect().height),
        rowHeights:[...node.querySelectorAll('.checkin-task')].map(n=>Math.round(n.getBoundingClientRect().height)),
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth
      }));
      results.push({viewport,heading,...metrics});
      if (!process.env.CHECKIN_BASELINE) {
        assert(metrics.firstTaskTop < (viewport.width<=480?520:350), `tasks should appear before the route diagram: ${JSON.stringify({viewport,metrics})}`);
        assert(heading.buttons.every(b=>b.width>=44 && b.height>=44), 'header icons retain 44px touch targets');
        assert(Math.abs((heading.title.x+heading.title.width/2)-(heading.box.x+heading.box.width/2))<1,'title is centered between the actions');
        assert(heading.buttons[0].x+heading.buttons[0].width <= heading.title.x && heading.title.x+heading.title.width <= heading.buttons[1].x,'title never overlaps actions');
        assert(Math.max(...metrics.rowHeights)<=90,'long task instructions must keep compact rows');
        assert(!metrics.horizontalOverflow,'page must not overflow horizontally');
        assert.equal(await page.locator('.checkin-progress-details').getAttribute('open'),null);
        for (const i of [0,6,11]) {
          const entry=page.locator('.checkin-task').nth(i).getByRole('button');
          await entry.scrollIntoViewIfNeeded();
          const before=await entry.boundingBox();
          await entry.click();
          const editor=page.locator('.checkin-task-editor');await editor.waitFor();
          assert.equal(await editor.evaluate(n=>n.previousElementSibling?.className),'checkin-task');
          const textarea=editor.locator('textarea');await textarea.fill('compact draft '+i);
          await entry.click();assert.equal(await textarea.inputValue(),'compact draft '+i);
          await editor.getByRole('button',{name:'收起',exact:true}).click();
          await editor.waitFor({state:'detached'});
          await page.waitForFunction(()=>document.activeElement?.matches('.checkin-task button'));
          const after=await entry.boundingBox();assert(Math.abs(before.y-after.y)<4,'collapse should restore entry viewport');
          await entry.click();await editor.waitFor();
          await page.waitForFunction(value=>document.querySelector('.checkin-task-editor textarea')?.value===value,'compact draft '+i);
          await editor.getByRole('button',{name:'收起',exact:true}).click();await editor.waitFor({state:'detached'});
        }
        await page.locator('.checkin-progress-details > summary').click();
        await page.locator('.checkin-week-table').getByRole('button').first().click();
        await page.locator('.checkin-task-editor').waitFor();
        assert.equal(await page.locator('.checkin-task-item').first().locator('.checkin-task-editor').count(),1);
        await page.locator('.checkin-task-editor').getByRole('button',{name:'收起',exact:true}).click();
        await page.locator('.checkin-progress-details > summary').click();
      }
      await page.getByRole('heading',{name:'我的学习打卡',exact:true}).scrollIntoViewIfNeeded();
      if(output) await page.screenshot({path:`${output}/${viewport.width}x${viewport.height}.png`});
      assert.deepEqual(errors,[]);await page.close();
    }
    if(output) fs.writeFileSync(output+'/layout.json',JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify(results,null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
