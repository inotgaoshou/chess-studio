const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.MOBILE_URL || 'http://127.0.0.1:1479';
const output=process.env.OUTPUT_DIR || '.local/authoring-source-picker-10078';
const base='/api/v1/admin/authoring';
const fen='4k4/3R5/R3P4/9/9/9/9/9/9/4K4 w - - 0 1';
(async()=>{
 const browser=await(process.env.WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
 fs.mkdirSync(output,{recursive:true});
 try {
  for(const viewport of [{width:360,height:740},{width:390,height:844},{width:1024,height:768}]){
   const page=await browser.newPage({viewport,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);
   const errors=[],calls=[];
   page.on('pageerror',error=>errors.push(error.message));
   const user={id:'source-coach',orgId:'source-org',orgName:'选题验收机构',role:'coach',displayName:'老师',loginName:'source-coach',organizations:[]};
   const directory={id:'d',title:'目录保持不变',revision:1,sortOrder:0,canEdit:true,items:[]};
   const source=(index)=>({id:'source-'+index,title:'分类题目 '+index,fen,category:'杀棋',duplicateKey:'key-'+index,sourceScope:'平台',sourceTitle:'验收题库',sourceCount:1});
   await page.addInitScript(()=>{
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    localStorage.setItem('xiangqi-teaching-environment','production');
    localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');
   });
   await page.route('**/api/v1/**',async route=>{
    const req=route.request(),parsed=new URL(req.url()),path=parsed.pathname;calls.push({path,method:req.method(),query:parsed.searchParams.toString()});let body=[];
    if(path.endsWith('/auth/refresh'))body={token:'fixture-only',expiresAt:'2099-01-01T00:00:00Z',user};
    else if(path.endsWith('/auth/me'))body=user;
    else if(path.endsWith('/capabilities'))body={};
    else if(path==='/api/v1/admin/assignments')body=[{id:'pub',title:'发布作业详情入口',status:'published',itemCount:3,targetCount:2,completedCount:1},{id:'draft',title:'草稿详情入口',status:'draft',itemCount:1,targetCount:1,completedCount:0}];
    else if(path===base+'/directories')body={items:[directory]};
    else if(path===base+'/directories/d')body=directory;
    else if(path===base+'/source-libraries')body={mateFilterVersion:1,items:[{id:'book-a',title:'验收题库',sourceScope:'平台'}]};
    else if(path===base+'/sources'){
     assert.equal(parsed.searchParams.get('libraryId'),'book-a');assert.equal(parsed.searchParams.get('mateMoves'),'2');
     const params=parsed.searchParams;
     const items=params.get('category')==='中局'?[{...source(99),title:'同局面不同答案',category:'中局'}]:params.has('cursor')?[source(0),source(30)]:Array.from({length:30},(_,i)=>({...source(i),alreadyAdded:i===1}));
     body={mateFilterVersion:1,items,categories:['杀棋','中局','未分类'],nextCursor:params.has('cursor')||params.get('category')?null:'next-page',sourcePickerVersion:2};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto(url+'/teacher');
   const actions=page.locator('.teacher-mobile-actions > button');
   await actions.first().waitFor();
   assert.deepEqual(await actions.locator('b').allTextContents(),['机构题库 · 摆棋出题','布置作业','学习打卡','班级与学生','申请加入机构']);
   assert.equal(await page.locator('.teacher-mobile-actions > .primary').count(),0);
   await page.getByRole('button',{name:/已发布作业/}).click();
   await page.getByText('发布作业详情入口',{exact:true}).waitFor();
   assert.equal(await page.getByText('草稿详情入口',{exact:true}).count(),0);
   await page.getByRole('button',{name:'返回教师工作台',exact:true}).click();
   await page.getByRole('button',{name:/待发布草稿/}).click();
   await page.getByText('草稿详情入口',{exact:true}).waitFor();
   assert.equal(await page.getByText('发布作业详情入口',{exact:true}).count(),0);
   await page.getByRole('button',{name:'返回教师工作台',exact:true}).click();
   await page.getByRole('button',{name:/机构题库 · 摆棋出题/}).click();
   await page.getByRole('button',{name:/目录保持不变.*道已发布/}).click();
   await page.getByRole('button',{name:/添加题目/}).click().catch(async error=>{console.log(page.url(),await page.locator('body').innerText(),JSON.stringify(calls.slice(-8)));throw error;});
   await page.getByRole('button',{name:'从平台／机构题库选题'}).click();
   const books=page.getByRole('dialog',{name:'选择题库／书本'});
   await books.getByRole('button',{name:/验收题库/}).waitFor();
   await books.getByLabel('杀法步数',{exact:true}).selectOption('2');
   await page.waitForResponse(response=>response.url().includes('/source-libraries?')&&new URL(response.url()).searchParams.get('mateMoves')==='2');
   await page.screenshot({path:output+'/book-filter-'+viewport.width+'.png'});
   await books.getByRole('button',{name:/验收题库/}).click();
   const dialog=page.getByRole('dialog',{name:'选择平台／机构题目'}),list=dialog.locator('.authoring-source-list');
   await dialog.getByText('分类题目 0',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('杀法步数',{exact:true}).inputValue(),'2');
   assert(await dialog.getByRole('button',{name:/分类题目 1 平台|分类题目 1 杀棋/}).isDisabled());
   const cardRects=await list.locator('button:has(svg)').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect(),svg=node.querySelector('svg').getBoundingClientRect();return {top:r.top,bottom:r.bottom,svgTop:svg.top,svgBottom:svg.bottom};}));
   assert(cardRects.length>=30);cardRects.forEach((r,i)=>{assert(r.svgTop>=r.top-1&&r.svgBottom<=r.bottom+1,'thumbnail must fit the card');if(i)assert(r.top>=cardRects[i-1].bottom,'cards must never overlap');});
   const before=await dialog.getByRole('button',{name:'‹ 返回',exact:true}).boundingBox();
   await list.evaluate(node=>{node.scrollTop=node.scrollHeight});
   const after=await dialog.getByRole('button',{name:'‹ 返回',exact:true}).boundingBox();
   assert(before&&after&&Math.abs(before.y-after.y)<1&&after.y>=0&&after.y+after.height<=viewport.height,'return must remain visible while list scrolls');
   await dialog.getByRole('button',{name:'加载更多'}).click();
   await dialog.getByText('分类题目 30',{exact:true}).waitFor();
   assert.equal(await dialog.getByText('分类题目 0',{exact:true}).count(),1);
   await dialog.getByLabel('题型分类').selectOption('中局');
   await dialog.getByText('同局面不同答案',{exact:true}).waitFor();
   assert.equal(await dialog.getByText('分类题目 0',{exact:true}).count(),0);
   await page.screenshot({path:output+'/picker-'+viewport.width+'.png'});
   await dialog.getByRole('button',{name:'‹ 返回',exact:true}).click();
   await books.getByRole('button',{name:'‹ 返回',exact:true}).click();
   await page.getByRole('heading',{name:'目录保持不变',exact:true}).waitFor();
   assert(!calls.some(call=>call.method==='PATCH'||call.method==='POST'&&!call.path.endsWith('/auth/refresh')),'browsing and returning must not mutate directory');
   assert.deepEqual(errors,[]);console.log('PASS neutral actions / overview details / fixed return / category / dedup / pages / no writes '+viewport.width);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
