// Full App navigation with isolated API responses. No real students or grades.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fixtures=require('./catalog-mate-fixtures.cjs');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462';
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problem={id:'p-2',title:'图347 红先胜',libraryId:'lib',sourceIndex:0,startingFen:fen,sideToMove:'red',category:'杀法',solutionLength:1,note:'',verifiedMateMoves:2,trainingGoal:{kind:'gain_material',solverSide:'w',reviewMethod:'reviewed_solution'},solution:[{iccs:'b0c2',comment:'',children:[]}]};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));try{
 for(const role of ['coach','student'])for(const width of [390,820]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1100},hasTouch:true});page.setDefaultTimeout(8000);const errors=[],requests=[];let details=0,creates=0,hang=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  await page.route('**/api/v1/**',async r=>{const u=new URL(r.request().url());requests.push(u.pathname+u.search);let body=fixtures.responseFor(u);
   const auth={...fixtures.auth,user:{...fixtures.auth.user,role}};
   if(u.pathname.endsWith('/teaching-catalog/browse')&&u.searchParams.get('nodeId')==='topic-0')body={...body,children:[{...fixtures.book,parentId:'topic-0'}]};
   if(/\/auth\/(login|refresh)$/.test(u.pathname))body=auth;else if(u.pathname.endsWith('/auth/me'))body=auth.user;
   else if(u.pathname.includes('/teaching-catalog/')&&u.pathname.endsWith('/problems'))body={items:[problem],nextCursor:null};
   else if(u.pathname.endsWith('/admin/problems/p-2')){details++;if(hang)return;if(details===1){await r.fulfill({status:503,contentType:'application/json',body:'{"error":"busy"}'});return;}body=problem;}
   else if(u.pathname.endsWith('/practice/sessions')&&r.request().method()==='POST'){creates++;body={id:'short-session',mode:'solver',sourceKind:'random',status:'active',items:[{id:'i1',ordinal:0,status:'pending',problem}]};}
   else if(u.pathname.includes('/practice/sessions/'))body={id:'short-session',mode:'solver',sourceKind:'random',status:'active',items:[{id:'i1',ordinal:0,status:'pending',problem}]};
   await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(base+'/home');const quick=page.locator('.mobile-quick-mates');await quick.getByRole('button',{name:'两步杀',exact:true}).click();await page.getByText('第 1 题 · 图347 红先胜',{exact:true}).waitFor();
  assert(requests.some(u=>u.includes('/topic-0/problems')&&u.includes('mateMoves=2')),'Home shortcut must reach the selected step directly');
  await page.locator('.catalog-problem-card > button').first().click();await page.locator('.mobile-solver-page').waitFor();assert.equal(creates,role==='student'?1:0);if(role==='coach')assert.equal(details,2,'Transient GET should retry once');
  await page.getByRole('button',{name:'返回题库',exact:true}).click();await page.getByText('第 1 题 · 图347 红先胜',{exact:true}).waitFor();
  if(role==='coach'&&width===820){
   await page.locator('details.catalog-textbooks > summary').click();await page.locator('details.catalog-textbooks').getByRole('button',{name:'教材学习',exact:true}).click();await page.locator('.mobile-primary-nav').getByRole('button',{name:'首页',exact:true}).click();await page.locator('.mobile-quick-mates').getByRole('button',{name:'两步杀',exact:true}).click();await page.getByText('第 1 题 · 图347 红先胜',{exact:true}).waitFor();assert.equal(await page.locator('.catalog-reading:visible').count(),0,'Explicit step must discard old reading mode');
  }
  if(role==='coach'&&width===390){
   hang=true;await page.clock.install();await page.locator('.catalog-problem-card > button').first().click();await page.clock.runFor(15100);await page.getByRole('alert').filter({hasText:/超时/}).waitFor();hang=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.mobile-solver-page').waitFor();
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();console.log('PASS',role,width,'home to step, direct open, retry, return preserves list');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
