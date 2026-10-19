const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.LIBRARY_URL || 'http://127.0.0.1:1446';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const chapter = {id:'chapter',teachingEntry:'basic_mates', name:'实用残局验收',kind:'chapter',active:true,confirmed:true,itemCount:1,displayOrder:0};
const problem = {id:'problem',libraryId:'book',title:'验收题',sourceIndex:0,startingFen:fen,sideToMove:'red',solutionLength:1,contentFingerprint:'version1'};
(async()=>{
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const role of ['student','coach','admin']) {
   const page = await browser.newPage({viewport:{width:390,height:844}}), requests=[], errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');});
   await page.route('**/api/v1/**',async route=>{
    const req=route.request(), u=new URL(req.url()), path=u.pathname;requests.push({path,method:req.method()});let body=[];
    if(path.endsWith('/auth/refresh'))body={token:role,expiresAt:'2099-01-01T00:00:00Z',user:{id:role,orgId:'school',orgName:'验收学校',role,displayName:'验收账号',organizations:[]}};
    else if(path.endsWith('/teaching-catalog/browse')){const inside=u.searchParams.has('nodeId');body={availabilityReady:true,availabilitySnapshotRevision:'1',statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',currentNode:inside?chapter:null,breadcrumbs:inside?[chapter]:[],children:inside?[]:[chapter],learningMaterials:[]};}
    else if(path.includes('/teaching-catalog/')&&path.endsWith('/problems'))body={items:[problem],nextCursor:null};
    else if(path.endsWith('/practice/dashboard'))body={pendingAssignmentCount:0,wrongCount:0,favoriteCount:0,topics:[],studyTopics:[],history:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto(url+'/library');
   await page.getByRole('region',{name:'教学题库目录',exact:true}).waitFor({timeout:10000}).catch(async e=>{console.error(role,await page.locator('body').innerText(),requests,errors);throw e;});
   const prefix=role==='student'?'student':'admin';
   await page.getByRole('button',{name:/实用残局验收/}).click();
   await page.getByRole('button',{name:/第 1 题 · 验收题/}).waitFor();
   assert(requests.some(r=>r.path===`/api/v1/${prefix}/teaching-catalog/browse`));
   assert(!requests.some(r=>r.path===`/api/v1/${prefix==='student'?'admin':'student'}/teaching-catalog/browse`));
   if(role!=='student'){
    await page.getByRole('button',{name:/第 1 题 · 验收题/}).click();
    await page.getByRole('button',{name:/用已选 1 题布置作业/}).click();
    await page.getByRole('button',{name:'下一步',exact:true}).click();
    await page.getByText('验收题',{exact:false}).first().waitFor();
    assert(!requests.some(r=>r.path.includes('/student/')&&r.method==='POST'),'teacher must not create student activity');
   }
   assert.deepEqual(errors,[]);await page.close();console.log('PASS mobile library '+role);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
