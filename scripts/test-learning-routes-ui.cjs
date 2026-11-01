// Real mobile App + deterministic authorized catalog fixtures; no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, webkit} = require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {responseFor} = require('./mobile-library-fixtures.cjs');
const out = process.env.EVIDENCE_DIR || '/tmp/qixi-learning-routes';
const base = process.env.PRACTICE_URL || 'http://127.0.0.1:1462';
fs.mkdirSync(out, {recursive:true});
const topics = ['basic_mates','checking_mates','quiet_mates','practical_endgames','practical_mates','endgame_mates'].map((entry,i)=>({id:'route-'+entry,name:['基础杀法','连将杀','非连将杀','实用残局','实战杀法','残局杀法'][i],teachingEntry:entry,kind:'category',displayOrder:i,active:true,confirmed:true,itemCount:50}));
const book={id:'route-book',parentId:'route-practical_endgames',name:'学习路线示例教材',kind:'book',displayOrder:0,active:true,confirmed:true,itemCount:50};
(async()=>{
 const browser = await (process.env.TEST_WEBKIT ? webkit.launch() : chromium.launch({channel:'chrome'}));
 try {
  for (const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]) {
   const page = await browser.newPage({viewport:{width,height},hasTouch:true});
   page.setDefaultTimeout(10000);
   const requests=[],errors=[],writes=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/api/v1/**',route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='POST'&&!url.pathname.endsWith('/auth/refresh'))writes.push(url.pathname);
    let data=responseFor(url,req.method(),{role:'coach'});
    if(url.pathname.endsWith('/teaching-catalog/browse')) {
     const id=url.searchParams.get('nodeId'),current=topics.find(n=>n.id===id);
     data={currentNode:current||null,breadcrumbs:current?[current]:[],children:!id?topics:id==='route-practical_endgames'?[book]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1',mateStepCounts:[1,2,3,4].map(mateMoves=>({mateMoves,itemCount:10}))};
    }
    if(/\/teaching-catalog\/[^/]+\/problems$/.test(url.pathname)) {
     requests.push({id:decodeURIComponent(url.pathname.split('/').at(-2)),params:Object.fromEntries(url.searchParams)});
     data={items:[{...responseFor(new URL('http://fixture/api/v1/student/problems/p0')),verifiedMateMoves:Number(url.searchParams.get('mateMoves'))||undefined,trainingGoal:url.searchParams.get('goal')?{kind:url.searchParams.get('goal'),solverSide:'w',reviewMethod:'reviewed_solution'}:null}],nextCursor:null};
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.addInitScript(()=>{
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');
    new MutationObserver((_,o)=>{if(document.documentElement){document.documentElement.classList.add(innerWidth<768?'phone-webview':'tablet-webview');o.disconnect();}}).observe(document,{childList:true});
   });
   await page.goto(base+'/library');
   const open=async(name)=>{await page.getByRole('button',{name}).click();return page.getByRole('dialog',{name:'学习路线',exact:true});};
   let sheet=await open(/^杀法学习路线/);
   await sheet.getByRole('button',{name:'练一步杀',exact:true}).waitFor();
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.learning-route-actions button')).find(b=>b.textContent.includes('练一步杀'))?.disabled);
   const bounds=await sheet.boundingBox();
   assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,JSON.stringify(bounds));
   const scroll=await sheet.locator('.learning-route-content').evaluate(el=>({overflow:getComputedStyle(el).overflowY,height:el.clientHeight,content:el.scrollHeight}));
   assert.equal(scroll.overflow,'auto');
   if(height<1000)assert(scroll.content>scroll.height,'stages scroll inside sheet '+width+'x'+height+' '+JSON.stringify(scroll));
   await page.screenshot({path:`${out}/mate-${width}x${height}.png`});
   assert.equal(requests.length,0,'route reading does not fetch questions or begin practice');
   await sheet.getByRole('button',{name:'练三步杀',exact:true}).click();
   await sheet.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelector('.catalog-problem-card'));
   await assertRequest('route-basic_mates',{mateMoves:'3'});
   assert((await page.getByRole('complementary',{name:'当前学习阶段'}).textContent()).includes('三四步'));
   sheet=await open('查看学习路线');
   assert((await sheet.locator('li[aria-current="step"]').textContent()).includes('三四步'));
   await sheet.getByRole('button',{name:'练四步杀',exact:true}).click();
   await assertRequest('route-basic_mates',{mateMoves:'4'});
   sheet=await open('查看学习路线');
   await sheet.getByRole('button',{name:'练一步杀',exact:true}).click();
   await assertRequest('route-basic_mates',{mateMoves:'1'});
   sheet=await open('查看学习路线');
   await sheet.getByRole('tab',{name:'残局学习路线',exact:true}).click();
   await page.screenshot({path:`${out}/endgame-${width}x${height}.png`});
   await sheet.getByRole('button',{name:'练求和防守',exact:true}).click();
   await assertRequest('route-practical_endgames',{goal:'draw',material:null,mateMoves:null});
   sheet=await open('查看学习路线');
   await sheet.getByRole('button',{name:'含马残局',exact:true}).click();
   await assertRequest('route-practical_endgames',{goal:null,material:'n'});
   sheet=await open('查看学习路线');
   await sheet.getByRole('button',{name:'按书本学习',exact:true}).click();
   await page.getByRole('button',{name:/学习路线示例教材.*可练题/}).waitFor();
   await page.screenshot({path:`${out}/books-${width}x${height}.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(writes,[],'reading/selecting a learning stage must not publish, answer or grade');
   assert.deepEqual(errors,[]);
   console.log('PASS learning route filters, tabs, context, books and viewport '+width+'x'+height);
   await page.close();
   async function assertRequest(id,params) {
    await page.waitForTimeout(350);
    const last=requests.at(-1);assert.equal(last?.id,id,JSON.stringify(last));
    for(const [key,value] of Object.entries(params))assert.equal(last.params[key]??null,value,JSON.stringify(last));
   }
  }
  // A cold anonymous launch must offer login instead of exposing route entries.
  const anonymous=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  anonymous.setDefaultTimeout(10000);
  await anonymous.addInitScript(()=>{
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');
  });
  await anonymous.route('**/api/v1/**',route=>{
    const req=route.request(),url=new URL(req.url());
    return route.fulfill({status:/\/auth\/(refresh|me)$/.test(url.pathname)?401:200,contentType:'application/json',body:JSON.stringify(/\/auth\/(refresh|me)$/.test(url.pathname)?{message:'未登录'}:responseFor(url,req.method()))});
  });
  await anonymous.goto(base+'/library');
  await anonymous.getByRole('button',{name:'登录后查看学习路线'}).waitFor();
  assert.equal(await anonymous.getByRole('button',{name:/^杀法学习路线|^残局学习路线/}).count(),0);
  await anonymous.getByRole('button',{name:'登录后查看学习路线'}).click();
  await anonymous.locator('input[type="password"]').waitFor();
  await anonymous.screenshot({path:`${out}/anonymous-login-390.png`});
  console.log('PASS anonymous routes hidden and login entry opens account dialog');
  await anonymous.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
