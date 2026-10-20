// Actual app/catalog UI with deterministic API fixtures. No production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium, _android} = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.CATALOG_URL || 'http://127.0.0.1:1452';
const evidence=process.env.CATALOG_EVIDENCE || '/tmp/qixi-compact-catalog';
fs.mkdirSync(evidence,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const node=(id,name,parentId=null,kind='category')=>({id,name,parentId,kind,displayOrder:0,active:true,confirmed:true,itemCount:3,materialCount:1,rehearsalCount:1,description:'应当隐藏的章节说明',teachingEntry:'basic_mates'});
const base=node('base','基础杀法');const book=node('book','1～4步杀专项','base','book');
const chapters=Array.from({length:24},(_,i)=>node('chapter-'+i,i===0?'一步杀':i===23?'二十四章：长标题测试应保持导航单行并完整返回原章节':'章节'+(i+1),'book','chapter'));
const problem=i=>({id:'p'+i,libraryId:'lib',sourceIndex:i,title:'紧凑题库验收 '+(i+1),startingFen:fen,solutionLength:1,sideToMove:i===1?'black':'red',trainingGoal:{kind:'gain_material',solverSide:'w',reviewMethod:'reviewed_solution'},solution:[{iccs:'a0a1',children:[]}]});
const authFor=(role,vip)=>({token:'compact-fixture',refreshToken:'compact-refresh',expiresAt:'2099-01-01T00:00:00Z',user:{id:role+(vip?'vip':''),orgId:'compact-school',role,displayName:'紧凑验收',vipActive:vip,organizations:[]}});
async function setup(page,role,vip,native=false){
 const auth=authFor(role,vip),state={requests:[],hold:false,held:[],fail:false,errors:[]};
 page.setDefaultTimeout(12000);page.on('pageerror',e=>state.errors.push(e.message));
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname;state.requests.push({path,query:u.search,method:req.method()});let body=[];
  if(path.endsWith('/auth/refresh'))body=auth;
  else if(path.endsWith('/auth/me'))body=auth.user;
  else if(path.endsWith('/teaching-catalog/browse')){
   const id=u.searchParams.get('nodeId'),view=u.searchParams.get('view'),offset=Number(u.searchParams.get('cursor')||0);
   if(id==='chapter-0'&&view==='structure'&&state.hold){state.held.push(route);return;}
   if(id==='chapter-0'&&view==='structure'&&state.fail){await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'目录暂时不可用'})});return;}
   const current=[base,book,...chapters].find(n=>n.id===id);
   const all=!id?[base]:id==='base'?[book]:id==='book'?chapters:[];
   const children=all.slice(offset,offset+12);
   body={currentNode:current||null,breadcrumbs:!current?[]:current.id==='base'?[base]:current.id==='book'?[base,book]:[base,book,current],children,nextCursor:offset+12<all.length?String(offset+12):null,learningMaterials:view==='materials'?[{id:'material',title:'原谱讲解',reviewStatus:'approved'}]:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};
  }else if(/\/teaching-catalog\/[^/]+\/problems$/.test(path)){
   const offset=Number(u.searchParams.get('cursor')||0),all=[problem(0),problem(1),problem(2)];body={items:all.slice(offset,offset+2),nextCursor:offset===0?'2':null};
  }else if(path.endsWith('/rehearsals'))body={items:[{id:'line',title:'原谱线路',completed:false}]};
  else if(/\/problems\/p[0-9]+$/.test(path))body=problem(Number(path.at(-1)));
  else if(path.endsWith('/practice/sessions')&&req.method()==='POST')body={id:'compact-session',status:'active',mode:'solver',sourceKind:'random',items:[{id:'compact-item',ordinal:0,status:'pending',problem:problem(0)}]};
  else if(path.endsWith('/practice/dashboard'))body={topics:[],studyTopics:[],history:[]};
  else if(path.endsWith('/student/assignments'))body={items:[]};
  else if(path.endsWith('/admin/problem-libraries/page'))body={items:[],nextCursor:null};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 if(native){
  await page.evaluate(async auth=>{
   localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
   await Capacitor.registerPlugin('SecureSession').save({session:JSON.stringify({...auth,auth,serverUrl:'https://api-test.qixiapp.cn',deviceId:'compact-emulator'})});
  },auth);
 }else await page.addInitScript(()=>{
  localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
  localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');
  // Keep the same app navigation on wide emulator/tablet viewports.
  new MutationObserver((_,o)=>{if(document.documentElement){document.documentElement.classList.add('tablet-webview');o.disconnect();}}).observe(document,{childList:true});
 });
 return state;
}
const catalog=page=>page.getByRole('region',{name:'教学题库目录',exact:true});
const back=page=>catalog(page).getByRole('button',{name:'返回上级目录',exact:true});
const title=page=>catalog(page).locator('.catalog-back-heading h3');
async function openChapter(page){
 await catalog(page).getByRole('button',{name:/基础杀法.*可练题/}).click();
 await catalog(page).getByRole('button',{name:/1～4步杀专项.*可练题/}).click();
 await catalog(page).getByRole('button',{name:/一步杀.*可练题/}).click();
 await catalog(page).locator('.catalog-problem-card').first().waitFor();
}
async function flow(page,role,vip,label,native=false){
 const state=await setup(page,role,vip,native);
 await page.goto(native?'https://localhost/library':url+'/library');
 await catalog(page).getByRole('button',{name:/基础杀法.*可练题/}).waitFor();
 await page.evaluate(()=>window.dispatchEvent(new Event('teaching-content-reset')));
 await catalog(page).getByRole('button',{name:/基础杀法.*可练题/}).waitFor();
 assert.equal(await back(page).count(),0,'root has no back button');
 assert.equal(await catalog(page).getByRole('textbox').count(),0);
 await page.screenshot({path:evidence+'/'+label+'-root.png'});
 await openChapter(page);
 assert.equal(await title(page).innerText(),'一步杀');
 assert.equal(await catalog(page).locator('.catalog-breadcrumb,.catalog-section-heading,.catalog-description').count(),0);
 assert.equal(await catalog(page).getByRole('textbox').count(),0);
 assert.equal(await catalog(page).getByRole('button',{name:/线路复现/}).count(),0);
 assert.equal(await catalog(page).getByRole('button',{name:'做题训练',exact:true}).getAttribute('aria-pressed'),'true');
 const tabs=await catalog(page).locator('.catalog-tabs').boundingBox();assert(tabs.height===44,'44px tabs');
 for(const b of await catalog(page).locator('button:visible').all()){const box=await b.boundingBox();assert(box.height>=44,'44px click targets');}
 await catalog(page).getByRole('button',{name:'筛选',exact:true}).click();
 await catalog(page).getByRole('combobox',{name:'题目目标'}).selectOption('gain_material');
 await catalog(page).getByRole('button',{name:/筛选.*1/}).click();
 await catalog(page).getByRole('button',{name:'加载更多题目',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.catalog-problem-card').length===3);
 await catalog(page).getByRole('button',{name:'棋谱学习',exact:true}).click();
 await catalog(page).getByRole('button',{name:'原谱讲解',exact:true}).waitFor();
 await catalog(page).getByRole('button',{name:'做题训练',exact:true}).click();
 await catalog(page).locator('.catalog-problem-card').first().getByRole('button',{name:'看题解',exact:true}).click();
 const viewer=page.getByRole('dialog',{name:'只读题解'});await viewer.waitFor();
 await viewer.getByRole('button',{name:'下一步',exact:true}).click();
 await viewer.getByRole('button',{name:'关闭题解'}).click();
 await catalog(page).locator('.catalog-problem-card').first().waitFor();
 assert.equal(await title(page).innerText(),'一步杀');
 await page.screenshot({path:evidence+'/'+label+'-chapter.png'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await catalog(page).locator('.catalog-problem-card > button:first-child').first().click();
 await page.locator('.mobile-solver-page').waitFor();
 await page.getByRole('button',{name:'返回题库',exact:true}).click();
 await catalog(page).locator('.catalog-problem-card').first().waitFor();
 await back(page).click();assert.equal(await title(page).innerText(),'1～4步杀专项');
 await catalog(page).getByRole('button',{name:'更多系列 / 章节',exact:true}).click();
 await catalog(page).getByRole('button',{name:/二十四章/}).waitFor();
 const target=catalog(page).getByRole('button',{name:/章节12.*可练题/});await target.scrollIntoViewIfNeeded();
 const getScroll=()=>catalog(page).evaluate(n=>{for(let p=n.parentElement;p;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY))return p.scrollTop;return scrollY;});
 const saved=await getScroll();await target.click();
 await catalog(page).locator('.catalog-problem-card').first().waitFor();
 // Reading opens a modal without losing the parent location cache.
 await catalog(page).locator('.catalog-problem-card').first().getByRole('button',{name:'看题解'}).click();
 await page.getByRole('dialog',{name:'只读题解'}).getByRole('button',{name:'关闭题解'}).click();
 await back(page).click();await catalog(page).getByRole('button',{name:/二十四章/}).waitFor();
 await page.waitForTimeout(150);assert(Math.abs((await getScroll())-saved)<3,'parent pagination and scroll restored');
 await catalog(page).getByRole('button',{name:/二十四章/}).click();
 await catalog(page).locator('.catalog-problem-card').first().waitFor();
 const bounds=await title(page).boundingBox();assert(bounds.height<30,'long heading stays on one line');
 await back(page).click();await back(page).click();await back(page).click();
 await catalog(page).getByRole('button',{name:/基础杀法.*可练题/}).waitFor();assert.equal(await back(page).count(),0);
 assert(!state.requests.some(r=>r.path.endsWith('/rehearsals')),'no hidden rehearsal request');
 assert(!state.requests.some(r=>/teaching-catalog/.test(r.path)&&new URLSearchParams(r.query).get('q')),'no hidden search query');
 assert.deepEqual(state.errors,[]);
 console.log('PASS compact '+label+': roles, navigation, reading, practice, filters, paging, scroll, touch targets');
 return state;
}
async function failures(page){
 const state=await setup(page,'student',false);await page.goto(url+'/library');
 await catalog(page).getByRole('button',{name:/基础杀法.*可练题/}).click();await catalog(page).getByRole('button',{name:/1～4步杀专项/}).click();
 state.fail=true;await catalog(page).getByRole('button',{name:/一步杀.*可练题/}).click();
 await catalog(page).getByText(/目录读取失败/).waitFor();assert.equal(await back(page).isEnabled(),true);
 state.fail=false;await catalog(page).getByRole('button',{name:'重试目录',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.catalog-state-error'));
 await back(page).click();await page.clock.install();state.hold=true;
 const sent=page.waitForRequest(r=>r.url().includes('view=structure')&&r.url().includes('nodeId=chapter-0'));
 await catalog(page).getByRole('button',{name:/一步杀.*可练题/}).click();await sent;
 await page.clock.runFor(15100);await catalog(page).getByText(/目录读取失败/).waitFor();
 await back(page).click();await title(page).filter({hasText:'1～4步杀专项'}).waitFor();state.hold=false;
 for(const route of state.held)await route.fulfill({contentType:'application/json',body:JSON.stringify({currentNode:chapters[0],breadcrumbs:[base,book,chapters[0]],children:[],learningMaterials:[]})}).catch(()=>{});
 await page.clock.runFor(200);assert.equal(await title(page).innerText(),'1～4步杀专项','late response must not replace parent');
 await catalog(page).getByRole('button',{name:/一步杀.*可练题/}).click();await back(page).click();await back(page).click();await back(page).click();
 assert.equal(await back(page).count(),0);assert.deepEqual(state.errors,[]);console.log('PASS compact failure: server errors, retry, deadline, back during load, late responses, consecutive back');
}
async function legacy(page){
 await setup(page,'coach',false);await page.goto(url+'/library');await catalog(page).getByRole('button',{name:/基础杀法/}).waitFor();
 await page.evaluate(async()=>{
  const React=(await import('/node_modules/.vite/deps/react.js')).default;
  const roots=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=roots.createRoot||roots.default.createRoot;
  const {TeachingCatalog}=await import('/src/TeachingCatalog.tsx');
  const host=document.createElement('div');host.id='legacy-catalog';host.style='position:fixed;inset:0;overflow:auto;background:white;z-index:9999';document.body.append(host);
  const {teachingClient}=await import('/src/teaching.ts');const auth=teachingClient.auth();
  window.mountLegacy=(compact)=>{window.legacyRoot=createRoot(host);window.legacyRoot.render(React.createElement(TeachingCatalog,{teacher:true,scene:'browse',sourceLibraryId:'legacy-fixture',compact,auth,onReadGame:()=>{window.legacySaved=true;}}));};window.mountLegacy(false);
 });
 const host=page.locator('#legacy-catalog');await host.getByRole('button',{name:/基础杀法/}).waitFor().catch(async e=>{console.log('legacy diagnostic',await host.innerText(),await page.evaluate(()=>document.querySelector('#legacy-catalog')?.outerHTML));throw e;});await host.getByRole('button',{name:/基础杀法/}).click();await host.getByRole('button',{name:/1～4步杀专项/}).click();await host.getByRole('button',{name:/一步杀/}).click();
 await host.getByRole('textbox',{name:'搜索教学目录',exact:true}).fill('旧目录词');
 await host.getByRole('textbox',{name:'搜索章节题目',exact:true}).fill('旧题名词');
 await host.getByRole('button',{name:/线路复现/}).click();await host.getByRole('button',{name:'原谱线路',exact:true}).waitFor();
 // Remount the upgraded compact view with the exact previous account and source scope.
 await page.evaluate(()=>{window.legacyRoot.unmount();window.mountLegacy(true);});
 await host.locator('.catalog-problem-card').first().waitFor();
 assert.equal(await host.getByRole('button',{name:'做题训练',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await host.getByRole('textbox').count(),0);assert.equal(await host.getByRole('button',{name:/线路复现/}).count(),0);
 await host.getByRole('button',{name:'返回上级目录'}).click();await host.getByRole('button',{name:/一步杀/}).click();await host.locator('.catalog-problem-card').first().waitFor();
 console.log('PASS legacy hidden search/rehearsal cache normalizes on upgrade and return');
}
(async()=>{
 if(process.env.CATALOG_ANDROID==='1'){
  const serial=process.env.PRACTICE_ANDROID_SERIAL||'emulator-5582';assert(serial.startsWith('emulator-'));
  const device=(await _android.devices()).find(d=>d.serial()===serial);assert(device);
  try{let view;for(let attempt=0;attempt<20&&!view;attempt++){await new Promise(r=>setTimeout(r,200));view=(await device.webViews()).find(v=>v.pkg()===(process.env.PRACTICE_ANDROID_PACKAGE||'cn.xiangqi.endgame.training.practiceentry'));}assert(view,'Emulator WebView did not initialize');const page=await view.page();await flow(page,'student',false,'android',true);await page.unrouteAll({behavior:'ignoreErrors'});}finally{await device.close();}
 }else{
  const browser=await chromium.launch({channel:'chrome',headless:true});try{
   for(const width of process.env.CATALOG_LEGACY_ONLY?[]:[375,390,430,800,1280])for(const [role,vip]of[['student',false],['student',true],['coach',false]]){
    const page=await browser.newPage({viewport:{width,height:width===800?1100:width===1280?800:844},hasTouch:true,isMobile:true});try{await flow(page,role,vip,`${width}-${role}-${vip}`);}finally{await page.close();}
   }
   let page=await browser.newPage({viewport:{width:390,height:844}});try{if(!process.env.CATALOG_LEGACY_ONLY)await failures(page);}finally{await page.close();}
   page=await browser.newPage({viewport:{width:390,height:844}});try{await legacy(page);}finally{await page.close();}
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
