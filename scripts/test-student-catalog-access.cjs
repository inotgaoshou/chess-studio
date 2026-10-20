const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.LIBRARY_URL||'http://127.0.0.1:1446';
const entries=[['basic_mates','基础杀法'],['mate_series','杀法练习系列'],['checking_mates','连将杀'],['quiet_mates','非连将杀'],['practical_mates','实战杀法'],['middlegame','中局战术']];
const nodes=entries.map(([teachingEntry,name],i)=>({id:teachingEntry,teachingEntry,name,kind:'category',active:true,confirmed:true,displayOrder:i,itemCount:100+i,completedCount:7,rehearsalCount:30,rehearsalCompletedCount:2,materialCount:12}));
const books=[['c','C 残局'],['b','B 中局'],['unknown','无分类']].map(([id,folderPath])=>({id,assetId:id,title:'来源'+id,folderPath,publishedCount:1,reviewStatus:'published',problemCount:1,parserVersion:1,createdAt:''}));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const mode of ['student','vip','expired','coach','admin']){
  const page=await browser.newPage({viewport:{width:320,height:740}}),requests=[],errors=[];
  let activeVip=['vip','expired'].includes(mode);
  const role=['coach','admin'].includes(mode)?mode:'student';const full=['vip','coach','admin'].includes(mode);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  await page.route('**/api/v1/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;requests.push(path+u.search);let body=[];
   if(path.endsWith('/auth/refresh'))body={token:mode,expiresAt:'2099-01-01T00:00:00Z',user:{id:mode,orgId:'school',orgName:'验收学校',role,displayName:'验收',vipActive:activeVip,vipExpiresAt:mode==='expired'?'2000-01-01T00:00:00Z':null,organizations:[]}};
   else if(path.endsWith('/teaching-catalog/browse')){await new Promise(r=>setTimeout(r,100));const current=nodes.find(n=>n.id===u.searchParams.get('nodeId'));body={statisticsReady:true,statisticsRevision:'1',availabilitySnapshotRevision:'1',statisticsSnapshotRevision:'1',currentNode:current||null,breadcrumbs:current?[current]:[],children:current?[]:[...nodes].reverse(),learningMaterials:[]};}
   else if(path.endsWith('/admin/problem-library-categories'))body=[{code:'B',libraryCount:1},{code:'C',libraryCount:1},{code:'other',libraryCount:1}];
   else if(path.endsWith('/admin/problem-libraries/page'))body={items:books,nextCursor:null};
   else if(path.endsWith('/platform-libraries')||path.endsWith('/admin/problem-libraries'))body=books;
   else if(path.endsWith('/student/assignments'))body={items:[],nextCursor:null};
   else if(path.endsWith('/practice/dashboard'))body={topics:[],studyTopics:[],history:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(url+'/library');const catalog=page.getByRole('region',{name:'教学题库目录',exact:true});await catalog.getByRole('button',{name:/基础杀法/}).waitFor();
  const names=await catalog.locator('.catalog-node-copy strong').allTextContents();assert.deepEqual(names,entries.slice(0,full?6:4).map(e=>e[1]),mode+' visible root order');
  assert(!/复现线路|已完成|篇教材/.test(await catalog.innerText()),'root cards must be compact');
  if(role==='student'){assert.equal(await catalog.getByRole('heading',{name:'教学题库',exact:true}).count(),0);assert.equal(await catalog.getByRole('textbox',{name:'搜索教学目录'}).count(),0);}
  if(full){const tabs=page.getByRole('tablist',{name:'平台题库分类'});await tabs.waitFor({timeout:5000}).catch(async e=>{console.error(mode,await page.locator("body").innerText(),requests);throw e;});assert.equal(await tabs.getByRole('tab',{name:'全部',exact:true}).count(),0);assert.equal(await tabs.getByRole('tab',{name:/B 中局/}).getAttribute('aria-selected'),'true');await tabs.getByRole('tab',{name:/C 残局/}).click();await tabs.getByRole('tab',{name:/C 残局/}).click();assert.equal(await tabs.getByRole('tab',{name:/C 残局/}).getAttribute('aria-selected'),'true');await page.getByRole('button',{name:'更多分类',exact:true}).click();await tabs.getByRole('tab',{name:/其他/}).click();assert.equal(await tabs.getByRole('tab',{name:/其他/}).getAttribute('aria-selected'),'true');}
  else {assert.equal(await page.getByText('平台训练题库',{exact:true}).count(),0);assert(!requests.some(p=>/\/(platform-libraries|platform-game-libraries|mate-collections)/.test(p)),'ordinary students must not prefetch source libraries');}
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:process.env.SCREENSHOT_DIR+'/'+mode+'-library-10035.png',fullPage:true});
  await catalog.getByRole('button',{name:/基础杀法/}).click();await catalog.getByRole('button',{name:'返回上级目录',exact:true}).waitFor();assert.equal(await catalog.getByRole('textbox',{name:'搜索教学目录'}).count(),0);
  if(role==='student'){await page.getByRole('button',{name:'首页',exact:true}).click();const button=page.getByRole('button',{name:/今日打卡.*去打卡/});await button.waitFor();const size=await button.boundingBox();assert(size.height>=44);assert.equal(await button.locator('.checkin-home-cta').evaluate(e=>getComputedStyle(e).whiteSpace),'nowrap');}
  if(mode==='vip'){activeVip=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByRole('button',{name:'题库',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.catalog-nodes > button').length===4);assert.equal(await page.getByText('平台训练题库',{exact:true}).count(),0,'VIP revocation must discard source UI');}
  assert.deepEqual(errors,[]);console.log('PASS catalog audience '+mode);await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
