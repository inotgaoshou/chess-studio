// Synthetic API + actual browser/WASM. Real test-server/native acceptance is recorded separately.
const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.PRACTICE_URL||'http://127.0.0.1:1462';
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problem={id:'p1',libraryId:'lib',title:'内线炮攻 跃马夺子',sourceIndex:0,category:'中局',startingFen:fen,sideToMove:'red',solutionLength:3,note:'（一）马取单士。先观察将位和退路。\n取士要诀：[b]回马将军进捉士，复退河头上公顶。[/b]\n① 公，指将、帅。先算对方最强的应手。',trainingGoal:{kind:'gain_material',solverSide:'w',reviewMethod:'reviewed_solution'},solution:[{iccs:'a0a1',comment:'先运车',children:[{iccs:'a9a8',comment:'应手',children:[{iccs:'a1a2',comment:'完成',children:[]}]},{iccs:'c9e7',comment:'长注释。'.repeat(80),children:[]},{iccs:'b9c7',comment:'应手三',children:[]}]}]};
const node={id:'chapter',name:'基础杀法',kind:'chapter',parentId:null,displayOrder:0,active:true,confirmed:true,itemCount:1,teachingEntry:'basic_mates',description:'章节说明'};
async function fixture(browser,role,width=390,vip=false,leaf=false){
 const page=await browser.newPage({viewport:{width,height:width===1280?800:1000},hasTouch:true,isMobile:true});page.setDefaultTimeout(7000);
 const state={creates:0,grades:0,verify:0,reads:0,hold:false,held:[],owner:role,requests:[]},errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{new MutationObserver((_,observer)=>{if(document.documentElement){document.documentElement.classList.add('tablet-webview');observer.disconnect();}}).observe(document,{childList:true});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 const session={id:'s1',mode:'solver',sourceKind:'random',status:'active',items:[{id:'i1',ordinal:0,status:'pending',problem}]};
 await page.route('**/api/v1/**',async route=>{const r=route.request(),u=new URL(r.url()),path=u.pathname;state.requests.push({path,method:r.method()});let body=[];
  const user={id:state.owner,orgId:'school',role,displayName:'回归账号',vipActive:vip};
  if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};
  else if(path.endsWith('/auth/me'))body=user;
  else if(path.endsWith('/capabilities'))body={};
  else if(path.endsWith('/teaching-catalog/browse'))body={currentNode:u.searchParams.has('nodeId')?{...node,kind:leaf?'category':node.kind}:null,breadcrumbs:u.searchParams.has('nodeId')?[node]:[],children:u.searchParams.has('nodeId')?[]:[node],learningMaterials:[],statisticsReady:true};
  else if(path.endsWith('/chapter/problems'))body={items:[problem]};
  else if(path.endsWith('/problems/p1')){state.reads++;body=problem;}
  else if(path.endsWith('/practice/sessions')&&r.method()==='POST'){state.creates++;if(state.hold){state.held.push(route);return;}body=session;}
  else if(path.endsWith('/verify-move')){state.verify++;const b=r.postDataJSON();body={outcome:b.path.length?'completed':'correct',completed:!!b.path.length,path:b.path.length?[...b.path,b.candidate]:['a0a1','a9a8'],autoMoves:b.path.length?[]:['a9a8'],message:b.path.length?'正确，已完成':'正确，继续作答'};}
  else if(path.endsWith('/attempts')){state.grades++;body={...session,status:'completed',items:[{...session.items[0],status:'completed'}]};}
  else if(path.includes('/practice/sessions/'))body=session;
  else if(path.endsWith('/practice/dashboard'))body={topics:[],studyTopics:[],history:[]};
  else if(path.endsWith('/student/platform-libraries'))body=vip?[{id:'lib',title:'中局弃子 20（训练题）',folderPath:'B中局',publishedCount:10,problemCount:10,practicedCount:0,completedCount:0}]:[];
  else if(path.endsWith('/platform-libraries/lib/problems'))body={items:[problem]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.route('**/src/moveFeedback.ts*',async route=>{const response=await route.fetch();const source=await response.text(),token='export function playTrainingFeedback(event) {';assert(source.includes(token));await route.fulfill({response,body:source.replace(token,token+' (window.solutionAudioRequests??=[]).push(typeof event==="string"?event:event.kind);')});});
 await page.goto(url+'/library');await page.getByRole('button',{name:/基础杀法.*可练题/}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('teaching-content-reset')));await page.getByRole('button',{name:/基础杀法.*可练题/}).click().catch(async e=>{console.log('FIXTURE',errors,(await page.locator('body').innerText()).slice(0,2500),state.requests);throw e;});
 const card=page.locator('.catalog-problem-card').first();await card.waitFor();
 return {page,state,errors,session,card,async close(){assert.deepEqual(errors,[]);await page.close();}};
}

(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome',headless:true}));try{
 for(const [width,height] of [[320,568],[390,844],[430,932],[844,390],[820,1180]]){
  const f=await fixture(browser,'coach',width),{page,card,state}=f;await page.setViewportSize({width,height});
  await card.getByRole('button',{name:'看题解',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'只读题解'});await viewer.waitFor();
  const measure=()=>viewer.evaluate(root=>Object.fromEntries(['.solution-read-panel','.solution-read-board','.xiangqi-board','nav'].map(s=>{const r=root.querySelector(s).getBoundingClientRect();return [s,{x:r.x,y:r.y,width:r.width,height:r.height}]})));
  const before=await measure();
  const soundsBefore=await page.evaluate(()=>window.solutionAudioRequests?.length||0);
  await viewer.evaluate(root=>{window.solutionMotionCount=0;new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes)if(node instanceof Element&&(node.matches('.board-moving-piece')||node.querySelector('.board-moving-piece')))window.solutionMotionCount++;}).observe(root,{subtree:true,childList:true});});
  const stable=async(label)=>{const after=await measure();for(const [sel,box] of Object.entries(before))for(const key of ['x','y','width','height'])assert(Math.abs(box[key]-after[sel][key])<=1,`${width} ${label}: ${sel} ${key} changed ${box[key]} -> ${after[sel][key]}`);};
  await viewer.getByRole('button',{name:'下一步',exact:true}).click();await viewer.getByText('先运车',{exact:true}).waitFor();
  assert((await page.evaluate(()=>window.solutionMotionCount))>0,'Solution single-step must animate the piece, not teleport it');
  assert.equal(await page.evaluate(()=>window.solutionAudioRequests?.length||0),soundsBefore+1,'Single-step must request one move cue');
  await viewer.locator('.solution-branches button').nth(2).waitFor();await stable('branch appears');await viewer.getByText('黑方行棋',{exact:true}).waitFor();
  require('fs').mkdirSync('/tmp/qixi-solution-layout',{recursive:true});await page.screenshot({path:`/tmp/qixi-solution-layout/${process.env.TEST_WEBKIT?'webkit':'chromium'}-${width}-branches.png`});
  await viewer.locator('.solution-branches button').nth(1).click();await viewer.getByText('长注释。'.repeat(80),{exact:true}).waitFor();await stable('long comment');
  await viewer.locator('.solution-read-details').evaluate(e=>e.scrollTop=e.scrollHeight);await stable('details scroll');
  assert((await viewer.locator('.solution-read-details').evaluate(e=>e.scrollTop))>0,'Only explanation scrolls while the board stays visible');
  await viewer.getByRole('button',{name:'上一步',exact:true}).click();await viewer.locator('.solution-branches button').nth(2).waitFor();await stable('back');
  assert.equal(await page.evaluate(()=>window.solutionAudioRequests?.length||0),soundsBefore+2,'Backward navigation must not replay a cue');
  await viewer.getByRole('button',{name:'从头',exact:true}).click();await viewer.getByRole('button',{name:'上一步',exact:true}).waitFor();await page.waitForTimeout(100);await stable('restart');
  await viewer.evaluate(root=>{window.solutionLayoutWatch={active:true,max:0};const selectors=['.solution-read-panel','.solution-read-board','.xiangqi-board','nav'];const boxes=selectors.map(s=>root.querySelector(s).getBoundingClientRect());const tick=()=>{const watch=window.solutionLayoutWatch;if(!watch.active)return;selectors.forEach((s,i)=>{const r=root.querySelector(s).getBoundingClientRect();for(const k of ['x','y','width','height'])watch.max=Math.max(watch.max,Math.abs(r[k]-boxes[i][k]));});requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await viewer.getByRole('button',{name:'播放',exact:true}).click();await page.waitForTimeout(3400);await stable('playback');
  const playbackDelta=await page.evaluate(()=>{window.solutionLayoutWatch.active=false;return window.solutionLayoutWatch.max;});assert(playbackDelta<=1,'No transient layout movement during playback');
  const nav=await viewer.locator('nav').boundingBox();assert(nav.y>=0&&nav.y+nav.height<=height,'playback controls fit');
  assert.equal(await viewer.evaluate(e=>e.scrollWidth>e.clientWidth),false);
  assert.equal(state.creates,0);assert.equal(state.grades,0);
  require('fs').mkdirSync('/tmp/qixi-solution-layout',{recursive:true});await page.screenshot({path:`/tmp/qixi-solution-layout/${process.env.TEST_WEBKIT?'webkit':'chromium'}-${width}.png`});
  await f.close();console.log(`PASS ${width}x${height}: stable board/modal/nav, branching, comments, replay, no grades`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
