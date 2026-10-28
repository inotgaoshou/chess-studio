const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, webkit } = require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = '/api/v1/admin/authoring';
const url = process.env.MOBILE_URL || 'http://127.0.0.1:1479';
const output = process.env.OUTPUT_DIR || '.local/authoring-video-10077';

(async () => {
  const browser = await (process.env.WEBKIT ? webkit.launch({headless:true}) : chromium.launch({channel:'chrome',headless:true}));
  fs.mkdirSync(output, {recursive:true});
  try {
    for (const viewport of [{width:360,height:740},{width:390,height:844},{width:1024,height:768}]) {
      const page = await browser.newPage({viewport,isMobile:true,hasTouch:true});
      page.setDefaultTimeout(10000);
      const questions = new Map(), calls = [], errors = [];
      const user = {id:'video-coach',orgId:'video-org',orgName:'视频流程验收机构',role:'coach',displayName:'录题老师',loginName:'video-coach',organizations:[]};
      const dirs = [
        {id:'d',title:'视频训练',revision:1,sortOrder:0,canEdit:true,items:[]},
        {id:'target',title:'移动目标目录',revision:1,sortOrder:1,canEdit:true,items:[]},
      ];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
        localStorage.setItem('xiangqi-teaching-environment','production');
        localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');
      });
      await page.route('**/api/v1/**',async route=>{
        const request=route.request(),path=new URL(request.url()).pathname;
        const data=request.postData()?request.postDataJSON():undefined;
        calls.push({path,method:request.method(),data});let body=[];
        if(path.endsWith('/auth/refresh'))body={token:'fixture-only',expiresAt:'2099-01-01T00:00:00Z',user};
        else if(path.endsWith('/auth/me'))body=user;
        else if(path.endsWith('/capabilities'))body={};
        else if(path===base+'/directories')body={items:dirs.map(d=>({...d,publishedCount:0,draftCount:d.items.length}))};
        else if(path.startsWith(base+'/questions/')){
          const id=path.split('/').at(-1);
          if(request.method()==='PUT'){
            const prior=questions.get(id);assert.equal(data.expectedRevision,prior?.revision||0);
            body={id,kind:'authored',revision:(prior?.revision||0)+1,status:'draft',canEdit:true,archived:false,body:data.body};questions.set(id,body);
            if(!prior)dirs.find(d=>d.id===data.directoryId).items.push(body);
            else for(const d of dirs)d.items=d.items.map(q=>q.id===id?body:q);
          }else body=questions.get(id);
        }else if(path.startsWith(base+'/directories/')){
          const id=path.slice((base+'/directories/').length).split('/')[0],dir=dirs.find(d=>d.id===id);
          if(path.endsWith('/transfer')){
            const target=dirs.find(d=>d.id===data.targetId);assert.equal(dir.revision,data.expectedRevision);assert.equal(target.revision,data.targetRevision);
            const ids=new Set(data.items.map(q=>q.subjectId));target.items.push(...dir.items.filter(q=>ids.has(q.id)));dir.items=dir.items.filter(q=>!ids.has(q.id));dir.revision++;target.revision++;
          }else if(request.method()==='PATCH'){
            assert.equal(data.expectedRevision,dir.revision);
            if(data.items)dir.items=data.items.map(item=>questions.get(item.subjectId));
            if(data.title)dir.title=data.title;dir.revision++;
          }
          body=dir;
        }else if(path.endsWith('/admin/classes'))body=[{id:'class',name:'验收班',studentCount:1,coachCount:1}];
        else if(path.endsWith('/students'))body=[{id:'student',displayName:'验收学生',loginName:'student'}];
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto(url+'/teacher');
      await page.getByRole('button',{name:/机构题库 · 摆棋出题/}).click();
      await page.getByRole('button',{name:/视频训练.*道已发布/}).click();
      await page.getByRole('button',{name:/添加题目/}).click();
      await page.getByRole('button',{name:'手动摆棋',exact:true}).click();
      await page.getByRole('button',{name:'清空',exact:true}).click();
      await page.getByRole('button',{name:'选择红炮',exact:true}).click();
      await page.getByRole('button',{name:'6行5列空位',exact:true}).click();
      await page.getByRole('button',{name:'7行4列空位',exact:true}).click();
      await page.getByRole('button',{name:'红先',exact:true}).click();
      await page.getByRole('button',{name:'翻转',exact:true}).click();
      await page.getByRole('button',{name:'黑先',exact:true}).waitFor();
      const done=page.getByRole('button',{name:'完成摆棋',exact:true});
      if(viewport.width<600){assert(await done.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&(hit===node||node.contains(hit));}),'complete setup must be visible without scrolling');}
      await page.screenshot({path:`${output}/board-${viewport.width}.png`});
      await done.click();
      await page.getByText('1. 训练题',{exact:true}).waitFor();
      const first=dirs[0].items[0];assert(first.body.startingFen.includes(' b '));assert.deepEqual(first.body.solution,[]);
      await page.getByRole('button',{name:'继续录题',exact:true}).click();
      await page.getByRole('button',{name:'手动摆棋',exact:true}).click();
      await page.getByRole('button',{name:'完成摆棋',exact:true}).click();
      await page.getByText('2. 训练题',{exact:true}).waitFor();
      const second=dirs[0].items[1];assert.equal(questions.size,2);
      await page.screenshot({path:`${output}/directory-${viewport.width}.png`});
      await page.getByRole('button',{name:'选择／编辑',exact:true}).click();
      await page.getByRole('checkbox',{name:'选择训练题',exact:true}).nth(1).check();
      await page.getByRole('button',{name:'前移',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.authoring-grid input[type="checkbox"]')[0]?.checked);
      assert.deepEqual(dirs[0].items.map(q=>q.id),[second.id,first.id]);
      await page.getByRole('button',{name:'改名',exact:true}).click();
      await page.getByLabel('题目新名称',{exact:true}).fill('第二题改名');
      await page.getByRole('button',{name:'保存名称',exact:true}).click();
      await page.getByText('1. 第二题改名',{exact:true}).waitFor();
      await page.getByRole('checkbox',{name:'选择训练题',exact:true}).check();
      await page.getByRole('combobox',{name:'移动到目录',exact:true}).selectOption('target');
      await page.getByText('1. 第二题改名',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('.authoring-grid article').length===1);
      assert.equal(dirs[1].items[0].id,first.id);
      await page.getByRole('checkbox',{name:'选择第二题改名',exact:true}).check();
      page.once('dialog',dialog=>dialog.accept());
      await page.getByRole('button',{name:'移出目录',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.authoring-grid article').length===0);
      assert.equal(questions.size,2,'removing directory references must preserve original questions');
      await page.getByRole('button',{name:'‹ 返回',exact:true}).click();
      await page.getByRole('button',{name:'布置移动目标目录',exact:true}).click();
      await page.getByText(/不可布置：训练题/).waitFor();
      assert.equal(await page.getByRole('checkbox',{name:'验收班（1人）',exact:true}).isChecked(),false);
      assert(!calls.some(c=>c.method==='DELETE'||c.path.endsWith('/actions')||c.path.includes('/attempt')));
      assert.deepEqual(errors,[]);
      console.log(`PASS video setup/save/continue/reorder/rename/transfer/remove/assign ${viewport.width}`);
      await page.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
