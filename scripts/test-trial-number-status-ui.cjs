// Teacher trials use synthetic authorized fixtures; this never writes production data.
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {responseFor}=require('./mobile-library-fixtures.cjs');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462';
(async()=>{
 const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);
  let changedContent=false;
  const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const topic={id:'trial-status',name:'基础杀法',kind:'category',teachingEntry:'basic_mates',active:true,confirmed:true,displayOrder:0,itemCount:3};
  const problems=Array.from({length:3},(_,i)=>({...responseFor(new URL(`http://fixture/api/v1/student/problems/p${i}`)),title:'第 1 题',verifiedMateMoves:1,trainingGoal:{kind:'mate',solverSide:'w',mateMoves:1}}));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  await page.route('**/api/v1/**',route=>{
   const req=route.request(),u=new URL(req.url()),p=u.pathname;
   if(req.method()!=='GET'&&!p.endsWith('/auth/refresh'))writes.push(p);
   let data=responseFor(u,req.method(),{role:'coach'});
   if(p.endsWith('/teaching-catalog/browse'))data={currentNode:u.searchParams.has('nodeId')?topic:null,breadcrumbs:u.searchParams.has('nodeId')?[topic]:[],children:u.searchParams.has('nodeId')?[]:[topic],learningMaterials:[],statisticsReady:true,mateStepCounts:[{mateMoves:1,itemCount:3}]};
   if(p.includes('/teaching-catalog/')&&p.endsWith('/problems'))data={items:problems,nextCursor:null};
   if(/\/admin\/problems\/p\d+$/.test(p)){data=problems.find(q=>q.id===p.split('/').at(-1));if(changedContent)data={...data,solution:[{iccs:'b0c2',children:[]}]};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const open=async()=>{
   await page.goto(base+'/library');
   await page.getByRole('button',{name:/^基础杀法.*可练题/}).click();
   await page.locator('.catalog-problem-card').first().waitFor();
   fs.mkdirSync('artifacts/practice-navigation-10133',{recursive:true});
   await page.screenshot({path:`artifacts/practice-navigation-10133/catalog-${process.env.TEST_WEBKIT?'webkit':'chromium'}-390.png`});
   await page.locator('.catalog-problem-card').first().locator('button').first().click();
   await page.locator('.mobile-solver-page').waitFor();
   assert.equal(await page.locator('.mobile-solver-heading strong').textContent(),'第 1 题');
  };
  await open();
  await page.getByRole('button',{name:'查看解析',exact:true}).click();
  await page.getByRole('button',{name:'播放题解',exact:true}).waitFor();
  await page.locator('.mobile-problem-navigator-trigger').click();
  await page.getByRole('listitem',{name:'第 1 题，当前题，已查看解析',exact:true}).waitFor();
  await page.getByRole('listitem',{name:'第 2 题，待完成',exact:true}).click();
  await page.locator('.mobile-solver-heading strong').filter({hasText:'第 2 题'}).waitFor();
  await page.locator('.mobile-problem-navigator-trigger').click();
  await page.getByRole('listitem',{name:'第 1 题，已查看解析',exact:true}).waitFor();
  await page.getByRole('listitem',{name:'第 1 题，已查看解析',exact:true}).click();
  await page.locator('.mobile-solver-heading strong').filter({hasText:'第 1 题'}).waitFor();
  // Reload and recreate the local trial. The owner/content-scoped marker remains.
  await open();await page.locator('.mobile-problem-navigator-trigger').click();
  const current=page.getByRole('listitem',{name:'第 1 题，当前题，已查看解析',exact:true});await current.waitFor();
  assert.equal(await current.locator('.problem-number-status').textContent(),'阅');
  changedContent=true;await open();await page.locator('.mobile-problem-navigator-trigger').click();
  await page.getByRole('listitem',{name:'第 1 题，当前题，待完成',exact:true}).waitFor();
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  fs.mkdirSync('artifacts/practice-latency-20261025',{recursive:true});
  await page.screenshot({path:`artifacts/practice-latency-20261025/trial-status-${process.env.TEST_WEBKIT?'webkit':'chromium'}-390.png`});
  console.log('PASS teacher trial source/list numbering and revealed markers survive question changes and reload and reset on changed content without student writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
