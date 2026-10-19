// Exercise the real mobile homepage and daily-practice entry with slow HTTPS responses.
const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url = process.env.PRACTICE_URL || 'http://127.0.0.1:1457';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
(async () => {
 const browser = await (process.env.TEST_WEBKIT ? webkit.launch({headless:true}) : chromium.launch({channel:'chrome',headless:true}));
 try {
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
   localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');
  });
  let releaseHome, releaseStart, creates=0, failHome=Boolean(process.env.TEST_HOME_FAILURE);
  const homeGate=new Promise(resolve=>releaseHome=resolve),startGate=new Promise(resolve=>releaseStart=resolve);
  const problem={id:'problem',libraryId:'lib',title:'加载验收题',sourceIndex:0,startingFen:fen,sideToMove:'red',solution:[{iccs:'a0a1',comment:'',children:[]}],solutionLength:1,note:'',active:true};
  const topic={id:'topic',name:'验收专题',contentKind:'problem',itemCount:1,sources:[{libraryId:'lib'}]};
  const home={pendingAssignmentCount:0,wrongCount:0,favoriteCount:0,topics:[topic],studyTopics:[],history:[],dailyPlan:{id:'daily',topic,itemCount:1,mode:'solver'}};
  const session={id:'daily-session',sourceKind:'daily',mode:'solver',status:'active',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),items:[{id:'item',ordinal:0,status:'pending',problem}]};
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body=[];
   if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user:{id:'student',orgId:'org',role:'student',displayName:'验收学生',organizations:[]}};
   else if(path.endsWith('/practice/dashboard')){await homeGate;if(failHome){failHome=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'网络繁忙，请重试'})});return;}body=home;}
   else if(path.endsWith('/daily/daily/session')){creates++;await startGate;body=session;}
   else if(path.endsWith('/student/assignments'))body={items:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(url+'/practice');await page.getByText('正在读取练习数据…',{exact:true}).waitFor();
  const entry=page.locator('.mobile-practice-feature.continue .primary');
  assert(await entry.isDisabled());
  assert.match(await entry.innerText(),/正在加载/,'disabled entry must explain loading instead of showing a dead Start button');
  releaseHome();
  if(process.env.TEST_HOME_FAILURE){await page.getByRole('button',{name:'重试加载',exact:true}).waitFor();await page.getByRole('button',{name:'重试加载',exact:true}).click();}
  await page.getByRole('button',{name:'开始练习',exact:true}).waitFor();
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('button',{name:'正在创建练习…',exact:true}).waitFor();
  assert(await entry.isDisabled());assert.equal(creates,1);
  releaseStart();await page.locator('.mobile-solver-page').waitFor();
  assert.deepEqual(errors,[]);console.log('PASS delayed homepage, visible start feedback, one daily session and playable board');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
