const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1479';
(async () => {
  const browser = await (process.env.WEBKIT ? webkit.launch({headless:true}) : chromium.launch({channel:'chrome',headless:true}));
  try {
    for (const viewport of [{width:360,height:740},{width:390,height:844},{width:844,height:390},{width:1024,height:768}]) {
      const page = await browser.newPage({viewport,isMobile:true,hasTouch:true});
      page.setDefaultTimeout(8000); const errors=[], writes=[], plans=[]; page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(()=>{document.documentElement?.classList.add('tablet-webview');localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
      const user={id:'teacher',orgId:'fixture',orgName:'验收机构',role:'coach',loginName:'fixture-teacher',displayName:'验收教师',organizations:[]};
      await page.route('**/api/v1/**',async route=>{
        const req=route.request(), path=new URL(req.url()).pathname;let body=[];
        if(path.endsWith('/auth/refresh'))body={token:'fixture-token',expiresAt:'2099-01-01T00:00:00Z',user};
        else if(path.endsWith('/auth/me'))body=user;
        else if(path.endsWith('/admin/classes'))body=[{id:'class',name:'验收班级',studentCount:1,coachCount:1}];
        else if(path.endsWith('/students'))body=[{id:'student',displayName:'验收学生'}];
        else if(path==='/api/v1/admin/checkin/plans' && req.method()==='POST'){
          const draft=req.postDataJSON();writes.push(draft);body={id:'plan',title:draft.title,status:'draft',phase:'draft',startsAt:draft.startsAt,endsAt:draft.endsAt,supplementUntil:draft.endsAt,draft};plans.push(body);
        }else if(path==='/api/v1/admin/checkin/plans/plan/publish'){plans[0].status='published';body=plans[0];}
        else if(path==='/api/v1/checkin/plans')body=plans;
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto(url+'/teacher/checkin');
      await page.getByRole('button',{name:'新建阶段计划',exact:true}).click();
      const editor=page.locator('.checkin-plan-editor');
      assert(await editor.evaluate(node=>{for(let p=node.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+2)return true;return false;}),'teacher form needs a scrollable ancestor');
      await page.getByLabel('计划名称',{exact:true}).fill('移动打卡保存验收');
      await page.getByRole('checkbox',{name:'验收学生',exact:true}).check();
      for(const input of await editor.getByLabel('具体要求',{exact:true}).all())await input.fill('完成今日学习任务');
      const save=editor.getByRole('button',{name:'保存草稿',exact:true}).last();
      await save.scrollIntoViewIfNeeded();
      assert(await save.evaluate(node=>{const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===node||node.contains(hit));}),'save must be visible above navigation');
      assert.equal(await editor.evaluate(node=>node.scrollWidth>node.clientWidth+2),false,'date fields must not overflow');
      if(process.env.SCREENSHOTS){await page.screenshot({path:process.env.SCREENSHOTS+'/teacher-checkin-'+viewport.width+'.png'});}
      await save.click();await page.getByText('草稿已保存',{exact:true}).waitFor();
      assert.equal(writes.length,1);assert.equal(writes[0].title,'移动打卡保存验收');
      await editor.getByRole('button',{name:'预览发布',exact:true}).click();
      await editor.getByRole('button',{name:'确认发布阶段计划',exact:true}).click();
      await page.getByText('阶段计划已发布，每周任务将自动重复',{exact:true}).waitFor();
      assert.equal(writes.length,1,'publishing a saved draft must not create another plan');
      await page.getByRole('button',{name:'新建阶段计划',exact:true}).click();
      await page.setViewportSize({width:viewport.width,height:380});
      await page.getByLabel('计划名称',{exact:true}).fill('键盘遮挡检查');
      const add=page.getByRole('button',{name:'＋ 添加任务',exact:true});await add.scrollIntoViewIfNeeded();await add.click();
      assert.equal(await page.locator('.checkin-template').count(),2);
      assert.deepEqual(errors,[]);await page.close();console.log('PASS teacher check-in scrolling/save/publish/keyboard '+viewport.width+'x'+viewport.height);
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
