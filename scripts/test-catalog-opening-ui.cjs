// Synthetic API + actual browser/WASM. Real test-server/native acceptance is recorded separately.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.PRACTICE_URL||'http://127.0.0.1:1451';
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problem={id:'p1',libraryId:'lib',title:'内线炮攻 跃马夺子',sourceIndex:0,category:'中局',startingFen:fen,sideToMove:'red',solutionLength:3,note:'只读解析说明',trainingGoal:{kind:'gain_material',solverSide:'w',reviewMethod:'reviewed_solution'},solution:[{iccs:'a0a1',comment:'先运车',children:[{iccs:'a9a8',comment:'应手',children:[{iccs:'a1a2',comment:'完成',children:[]}]}]}]};
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
  else if(path.endsWith('/student/platform-libraries'))body=vip?[{id:'lib',title:'中局弃子 20（训练题）',folderPath:'B中局',publishedCount:1,problemCount:1,practicedCount:0,completedCount:0}]:[];
  else if(path.endsWith('/platform-libraries/lib/problems'))body={items:[problem]};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(url+'/library');await page.getByRole('button',{name:/基础杀法.*可练题/}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('teaching-content-reset')));await page.getByRole('button',{name:/基础杀法.*可练题/}).click().catch(async e=>{console.log('FIXTURE',errors,(await page.locator('body').innerText()).slice(0,2500),state.requests);throw e;});
 const card=page.locator('.catalog-problem-card').first();await card.waitFor();
 return {page,state,errors,session,card,async close(){assert.deepEqual(errors,[]);await page.close();}};
}
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 {const f=await fixture(browser,'student',390,false,true);assert.equal(await f.card.count(),1);assert.equal(await f.page.getByRole('textbox',{name:'搜索题名',exact:true}).count(),1);await f.close();console.log('PASS leaf category displays direct questions');}
 for(const width of [390,800,1280])for(const [role,vip] of [['student',false],['student',true],['coach',false]]){
  const f=await fixture(browser,role,width,vip),{page,state,card}=f;
  assert.equal(await page.locator('.catalog-filters:visible').count(),0);
  assert.equal(await page.locator('.teaching-catalog input:visible').count(),1);
  await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('combobox',{name:'题目目标'}).selectOption('gain_material');
  await page.getByRole('button',{name:/筛选.*1/}).click();
  await page.getByRole('textbox',{name:'搜索题名',exact:true}).fill('内线');
  await card.getByRole('button',{name:'看题解',exact:true}).click();
  const viewer=page.getByRole('dialog',{name:'只读题解'});await viewer.waitFor();assert.equal(state.creates,0);assert.equal(state.grades,0);
  await viewer.getByRole('button',{name:'下一步',exact:true}).click();await viewer.getByText('先运车',{exact:true}).waitFor();
  await viewer.getByRole('button',{name:'关闭题解'}).click();
  assert.equal(await page.getByRole('textbox',{name:'搜索题名',exact:true}).inputValue(),'内线');
  const touch=await card.getByRole('button',{name:'看题解',exact:true}).boundingBox();assert(touch.height>=44);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/tmp/catalog-opening-${role}-${vip}-${width}.png`});
  await card.locator('button').first().click();await page.locator('.mobile-solver-page').waitFor();
  const board=page.locator('.mobile-solver-page .xiangqi-board');
  await board.getByRole('button',{name:'a0 红车',exact:true}).click();await board.getByRole('button',{name:'a1',exact:true}).click();
  await board.getByRole('button',{name:'a8 黑车',exact:true}).waitFor();
  await board.getByRole('button',{name:'a1 红车',exact:true}).click();await board.getByRole('button',{name:'a2',exact:true}).click();
  for(let i=0;i<50&&state.verify<2;i++)await page.waitForTimeout(100);
  if(role==='student')for(let i=0;i<50&&state.grades<1;i++)await page.waitForTimeout(100);
  assert.equal(state.verify,2);assert.equal(state.creates,role==='student'?1:0);
  if(role==='coach') {assert.equal(state.grades,0);assert(!state.requests.some(r=>r.method==='POST'&&r.path.includes('/student/')));}
  await f.close();console.log(`PASS ${width} ${role} VIP=${vip}: view without session, filters, open, verify and continue`);
 }
 {
  const f=await fixture(browser,'student',390,true),{page,state}=f;
  await page.getByRole('button',{name:/中局弃子 20/}).click();
  const row=page.locator('.source-problem-card').first();await row.waitFor();
  await row.getByRole('button',{name:'看题解',exact:true}).click();await page.getByRole('dialog',{name:'只读题解'}).waitFor();
  assert.equal(state.creates,0);await page.getByRole('button',{name:'关闭题解'}).click();
  state.hold=true;await page.clock.install();const sent=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/practice/sessions'));await row.locator('button').first().click();await sent;await page.getByRole('status').filter({hasText:/正在打开《内线/}).waitFor();
  await page.clock.runFor(15100);await page.getByRole('alert').filter({hasText:/超时/}).waitFor();
  state.hold=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.mobile-solver-page').waitFor();
  assert.equal(state.creates,2);await f.close();console.log('PASS source library: independent read, opening title, timeout and retry');
 }
 {
  const f=await fixture(browser,'coach'),{page,state,card}=f;
  await card.locator('button').first().click();await page.locator('.mobile-solver-page').waitFor();
  const board=page.locator('.mobile-solver-page .xiangqi-board');
  await board.getByRole('button',{name:'a0 红车',exact:true}).click();await board.getByRole('button',{name:'a1',exact:true}).click();
  await board.getByRole('button',{name:'a8 黑车',exact:true}).waitFor();
  await page.getByRole('button',{name:'返回题库',exact:true}).click();await card.waitFor();
  await card.locator('button').first().click();await board.getByRole('button',{name:'a1 红车',exact:true}).waitFor();
  assert.equal(state.creates,0);assert.equal(state.grades,0);
  await page.getByRole('button',{name:'返回题库',exact:true}).click();
  await page.evaluate(async()=>{
   const React=(await import('/node_modules/.vite/deps/react.js')).default;
   const roots=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=roots.createRoot||roots.default.createRoot;
   const {TeachingCatalog}=await import('/src/TeachingCatalog.tsx');
   const {teachingClient}=await import('/src/teaching.ts');
   const host=document.createElement('div');host.id='assignment-mode-test';host.style='position:fixed;inset:0;overflow:auto;background:white;z-index:9999';document.body.append(host);
   function Select(){const [ids,setIds]=React.useState([]);return React.createElement(TeachingCatalog,{teacher:true,scene:'select',auth:teachingClient.auth(),selectedIds:ids,onAdd:items=>setIds(old=>[...new Set([...old,...items.map(p=>p.id)])]),onRemove:id=>setIds(old=>old.filter(p=>p!==id))});}
   createRoot(host).render(React.createElement(Select));
  });
  const select=page.locator('#assignment-mode-test');await select.getByRole('button',{name:/基础杀法.*可布置/}).click();
  assert.equal(await select.getByRole('textbox',{name:'搜索章节题目'}).count(),1);
  await select.getByRole('button',{name:'选择当前章节/筛选的全部题目'}).click();
  await select.getByText('已选 1 题',{exact:true}).waitFor();
  await select.locator('.catalog-problem-card > button').first().click();await select.getByText('已选 0 题',{exact:true}).waitFor();
  assert.equal(state.creates,0);assert.equal(state.grades,0);await f.close();console.log('PASS teacher local restoration and separate assignment bulk selection/removal');
 }
 {
  const f=await fixture(browser,'student');f.state.hold=true;await f.page.clock.install();
  const sent=f.page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/practice/sessions'));await f.card.locator('button').first().click();await sent;await f.page.getByRole('status').filter({hasText:/正在打开《内线/}).waitFor();
  await f.card.locator('button').first().click();assert.equal(f.state.creates,1);
  await f.page.clock.runFor(15100);await f.page.getByRole('alert').filter({hasText:/超时/}).waitFor();
  f.state.hold=false;await f.page.getByRole('button',{name:'重试',exact:true}).click();await f.page.locator('.mobile-solver-page').waitFor();assert.equal(f.state.creates,2);
  await f.close();console.log('PASS directory opening timeout, duplicate lock and explicit retry');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
