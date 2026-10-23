// Actual React/WASM opening flow with isolated API data; no production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium, _android } = require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const native = process.env.PRACTICE_NATIVE === '1';
const base = native ? 'https://localhost' : process.env.PRACTICE_URL || 'http://127.0.0.1:1462';
const output = process.env.EVIDENCE_DIR || '/tmp/qixi-practice-navigation';
fs.mkdirSync(output, {recursive:true});
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problems = Array.from({length:3},(_,i)=>({id:`p${i+1}`,libraryId:'lib',title:['马炮配合','中局答疑','车兵配合'][i],sourceIndex:i,category:'中局',startingFen:fen,sideToMove:'red',solutionLength:1,note:'',solution:[{iccs:'a0a1',children:[]}],trainingGoal:{kind:'mate',solverSide:'w',mateMoves:2},verifiedMateMoves:2}));
let diagnostic;
// Android CDP contexts do not expose touch support; check handlers in the native
// runtime. Browser runs above separately exercise pointer hit targets/layout.
async function activate(locator) { if(native)await locator.evaluate(element=>element.click());else await locator.click(); }
const chapter={id:'chapter',name:'中局战术',kind:'chapter',displayOrder:0,active:true,confirmed:true,itemCount:3,teachingEntry:'middlegame'};
async function fixture(browser, role, width) {
  const page=await browser.newPage({viewport:{width,height:width===375?812:width===390?844:width===430?932:950},hasTouch:true,isMobile:true});
  page.setDefaultTimeout(native?30000:10000);
  const errors=[],requests=[];let creates=0, session,hold=false,held=[];
  diagnostic={page,requests};
  const onError=e=>errors.push(e.message);
  page.on('pageerror',onError);
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  await page.route('**/api/v1/**',async route=>{
    const r=route.request(),u=new URL(r.url()),path=u.pathname;
    requests.push({path,method:r.method(),query:Object.fromEntries(u.searchParams)});
    let body=[];
    const user={id:role,orgId:'school',role,displayName:'模拟验收',vipActive:true};
    if(path.endsWith('/auth/refresh'))body={token:'fixture',refreshToken:'fixture-refresh',expiresAt:'2099-01-01T00:00:00Z',user};
    else if(path.endsWith('/auth/me'))body=user;
    else if(path.endsWith('/capabilities'))body={};
    else if(path.endsWith('/teaching-catalog/browse'))body={currentNode:u.searchParams.has('nodeId')?chapter:null,breadcrumbs:u.searchParams.has('nodeId')?[chapter]:[],children:u.searchParams.has('nodeId')?[]:[chapter],learningMaterials:[],statisticsReady:true};
    else if(path.endsWith('/chapter/problems')){
      const q=u.searchParams.get('motif')||'';
      body={items:problems.filter(p=>!q||`${p.title}${p.category}`.includes(q))};
    } else if(path.endsWith('/problem-library-categories'))body=[{code:'B',libraryCount:1},{code:'other',libraryCount:2}];
    else if(path.endsWith('/problem-libraries/page'))body={items:[]};
    else if(/\/problems\/p[123]$/.test(path))body=problems.find(p=>path.endsWith('/'+p.id));
    else if(path.endsWith('/practice/sessions')&&r.method()==='POST'){
      creates++;if(hold){held.push(route);return;}
      const data=r.postDataJSON();
      session={id:`session${creates}`,mode:'solver',sourceKind:'random',status:'active',items:problems.filter(p=>data.problemIds.includes(p.id)).map((problem,i)=>({id:`i${problem.id}`,ordinal:i,status:'pending',problem}))};
      session.currentItemId=session.items[0]?.id;
      body=session;
    } else if(path.includes('/practice/sessions/'))body=session;
    else if(path.endsWith('/practice/dashboard'))body={topics:[],studyTopics:[],history:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
  });
  if(native)await page.evaluate(async role=>{
    const auth={token:'fixture',refreshToken:'fixture-refresh',expiresAt:'2099-01-01T00:00:00Z',user:{id:role,orgId:'school',role,displayName:'模拟验收',vipActive:true}};
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    await Capacitor.registerPlugin('SecureSession').save({session:JSON.stringify({...auth,auth,serverUrl:'https://api.qixiapp.cn',deviceId:'navigation-isolated-emulator'})});
  },role);
  await page.goto(base+'/library');
  await activate(page.getByRole('button',{name:/中局战术.*可练题/}));
  await page.getByRole('button',{name:/第 2 题 · 中局答疑/}).waitFor();
  return {page,requests,errors,get creates(){return creates;},setHold(value){hold=value;},async close(){assert.deepEqual(errors,[]);page.off('pageerror',onError);if(native)await page.unrouteAll({behavior:'ignoreErrors'});else await page.close();}};
}
(async()=>{
 let browser;
 if(native){
  const serial=process.env.PRACTICE_ANDROID_SERIAL||'emulator-5554';
  const pkg=process.env.PRACTICE_ANDROID_PACKAGE||'cn.xiangqi.endgame.training.answerpresentation';
  assert(serial.startsWith('emulator-'),'Use only a disposable emulator');
  assert.notEqual(pkg,'cn.xiangqi.endgame.training','Use only an isolated simulator package');
  const device=(await _android.devices()).find(d=>d.serial()===serial);assert(device,'Isolated emulator required');
  try{
   let view;for(let n=0;n<50&&!view;n++){view=(await device.webViews()).find(v=>v.pkg()===pkg);if(!view)await new Promise(resolve=>setTimeout(resolve,100));}
   assert(view,'Open isolated debug APK first');
   const page=await view.page();
   browser={newPage:async()=>page,close:()=>device.close()};
  }catch(error){await device.close();throw error;}
 }else browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const width of native?[390]:[375,390,430,820])for(const role of ['student','coach']){
   const f=await fixture(browser,role,width),{page}=f;
   await activate(page.getByRole('button',{name:'筛选',exact:true}));
   assert.equal(await page.getByLabel('题目难度',{exact:true}).count(),0);
   assert.equal(await page.getByLabel('局面子力',{exact:true}).count(),0);
   await page.getByLabel('题名关键词',{exact:true}).fill('答疑');
   await page.getByRole('button',{name:/第 1 题 · 马炮配合/}).waitFor({state:'hidden'});
   await page.getByRole('button',{name:/第 2 题 · 中局答疑/}).waitFor();
   assert.equal(await page.locator('.catalog-problem-card').count(),1);
   await activate(page.getByRole('button',{name:'清空',exact:true}));
   await page.getByRole('button',{name:/第 1 题 · 马炮配合/}).waitFor();
   await activate(page.getByRole('button',{name:'收起',exact:true}));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await activate(page.getByRole('button',{name:/第 2 题 · 中局答疑/}));
   await page.locator('.mobile-solver-page').waitFor();
   await page.getByText('本组进度 2/3',{exact:true}).waitFor();
   assert.equal(await page.locator('.mobile-problem-navigator').count(),0);
   const nav=page.locator('.mobile-solver-nav');
   await page.evaluate(()=>{
    window.questionOpeningFlashes=0;
    window.questionOpeningObserver=new MutationObserver(records=>{
     for(const record of records)for(const node of record.addedNodes){
      if(node instanceof Element&&(node.matches('.practice-opening-status')||node.querySelector('.practice-opening-status')))window.questionOpeningFlashes++;
     }
    });
    window.questionOpeningObserver.observe(document.body,{childList:true,subtree:true});
   });
   if(!native){
    await page.waitForFunction(()=>document.querySelector('.mobile-solver-page')?.style.getPropertyValue('--solver-board-fit-width'));
    const layout=await page.evaluate(()=>{
      const page=document.querySelector('.mobile-solver-page'),nav=page.querySelector('.mobile-solver-nav').getBoundingClientRect(),board=page.querySelector('.mobile-solver-board').getBoundingClientRect();
      return {scrollHeight:page.scrollHeight,height:page.clientHeight,navBottom:nav.bottom,boardTop:board.top};
    });
    assert(layout.navBottom<=layout.boardTop,JSON.stringify(layout));
    assert(layout.scrollHeight<=layout.height+2,JSON.stringify(layout));
    await page.screenshot({path:`${output}/${role}-${width}-top-navigation.png`});
   }
   await activate(nav.getByRole('button',{name:'上一题',exact:true}));
   await page.getByText('本组进度 1/3',{exact:true}).waitFor();
   assert.equal(await nav.getByRole('button',{name:'上一题',exact:true}).count(),0);
   await activate(nav.getByRole('button',{name:'下一题',exact:true}));
   await page.getByText('本组进度 2/3',{exact:true}).waitFor();
   await activate(nav.getByRole('button',{name:'2/3',exact:true}));
   await page.locator('.mobile-problem-navigator.open').waitFor();
   assert.equal(await page.locator('.mobile-problem-navigator > header > button').isVisible(),true);
   if(!native)await page.screenshot({path:`${output}/${role}-${width}-picker.png`});
   await activate(page.getByLabel('第 3 题：'+(role==='student'?'车兵配合':'第 3 题')+'，待完成',{exact:true}));
   await page.getByText('本组进度 3/3',{exact:true}).waitFor();
   assert.equal(await nav.getByRole('button',{name:'下一题',exact:true}).count(),0);
   assert.equal(await page.locator('.mobile-problem-navigator').count(),0);
   assert.equal(await page.evaluate(()=>window.questionOpeningFlashes),0,'Fast question navigation must not flash the opening overlay');
   await page.evaluate(()=>window.questionOpeningObserver.disconnect());
   assert.equal(f.creates,role==='student'?1:0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   if(!native)await page.screenshot({path:`${output}/${role}-${width}-navigation.png`});
   await f.close();
   console.log(`PASS ${native?'Android native ':''}${role} ${native?await page.evaluate(()=>innerWidth):width}px: keyword/clear, selected question, previous/next/number, ${role==='student'?'one session':'no student session'}`);
  }
  const f=await fixture(browser,'student',390),{page}=f;
  f.setHold(true);await page.clock.install();
  const pending=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/practice/sessions'));
  await activate(page.getByRole('button',{name:/第 2 题 · 中局答疑/}));await pending;
  await activate(page.getByRole('button',{name:/第 2 题 · 中局答疑/}));assert.equal(f.creates,1);
  await page.clock.runFor(15100);
  await page.getByRole('alert').filter({hasText:/超时/}).waitFor();
  f.setHold(false);await activate(page.getByRole('button',{name:'重试',exact:true}));
  await page.getByText('本组进度 2/3',{exact:true}).waitFor();assert.equal(f.creates,2);
  await f.close();console.log('PASS stalled middle-game opening: bounded wait, duplicate lock, explicit retry, selected question retained');
 }catch(error){
  if(native&&diagnostic){
   fs.writeFileSync(output+'/failure.json',JSON.stringify({requests:diagnostic.requests,text:await diagnostic.page.locator('body').innerText().catch(()=>'<unavailable>')},null,2));
   await diagnostic.page.screenshot({path:output+'/failure.png',timeout:3000}).catch(()=>{});
  }
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
