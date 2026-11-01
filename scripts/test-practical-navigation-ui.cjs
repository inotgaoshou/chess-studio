const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {responseFor}=require('./mobile-library-fixtures.cjs');
const topic={id:'practical',name:'实用残局',kind:'category',teachingEntry:'practical_endgames',displayOrder:0,active:true,confirmed:true,itemCount:80};
const book={...topic,id:'practical-book',name:'实用残局精选',kind:'book',parentId:topic.id,teachingEntry:undefined};
const chapter={...book,id:'practical-chapter',name:'车兵残局',kind:'chapter',parentId:book.id};
const makeProblem=i=>({...responseFor(new URL('http://fixture/api/v1/student/problems/p'+i)),title:'车兵巧胜单士 '+(i+1)});
(async()=>{
 const browser=await(process.env.WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
 const output=process.env.OUTPUT_DIR||'artifacts/practice-navigation-10135/practical';fs.mkdirSync(output,{recursive:true});
 try{for(const viewport of [{width:320,height:740},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:820,height:1180},{width:1180,height:820}]){
  const page=await browser.newPage({viewport,hasTouch:true,isMobile:true});page.setDefaultTimeout(10000);const requests=[],errors=[];let session;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),url=new URL(request.url());let body=responseFor(url,request.method());
   if(url.pathname.endsWith('/teaching-catalog/browse')){const id=url.searchParams.get('nodeId');const path=id===chapter.id?[topic,book,chapter]:id===book.id?[topic,book]:id?[topic]:[];body={currentNode:path.at(-1)||null,breadcrumbs:path,children:!id?[topic]:id===topic.id?[book]:id===book.id?[chapter]:[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};}
   if(/\/teaching-catalog\/[^/]+\/problems$/.test(url.pathname)){requests.push(url.searchParams.get('material')||'');const start=url.searchParams.get('cursor')?50:0;body={items:Array.from({length:start?30:50},(_,i)=>makeProblem(i+start)),nextCursor:start?null:'next'};}
   if(url.pathname.endsWith('/practice/sessions')&&request.method()==='POST'){
    const ids=request.postDataJSON().problemIds;session={id:'s1',mode:'solver',sourceKind:'random',status:'active',startedAt:'',updatedAt:'',items:ids.map((id,i)=>({id:'item-'+id,ordinal:i,status:'pending',problem:makeProblem(Number(id.slice(1)))}))};body=session;
   }
   if(url.pathname.endsWith('/practice/sessions/s1')&&session)body=session;
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');document.documentElement?.classList.add('tablet-webview');});
  await page.goto((process.env.MOBILE_URL||'http://127.0.0.1:1462')+'/library');
  await page.getByRole('button',{name:/实用残局/}).click();
  const catalog=page.getByRole('region',{name:'教学题库目录',exact:true});
  await catalog.getByText('来源：《训练教材》 · 原题第 1 题',{exact:true}).waitFor();
  await require('./catalog-sticky-numbers.cjs').checkStickyNumbers(page);
  await page.getByRole('button',{name:/跳到第 25 题/}).click();
  const card=catalog.locator('.catalog-problem-card').nth(24);
  await page.waitForFunction(()=>{const r=document.querySelectorAll('.catalog-problem-card')[24]?.getBoundingClientRect();return r&&r.top>=0&&r.top<innerHeight;});
  await require('./catalog-sticky-numbers.cjs').checkUncoveredCard(page,24);
  assert(await card.evaluate(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.top<innerHeight;}),'numeric jump must scroll to the card');
  await catalog.getByRole('button',{name:'下一页题目'}).click();
  await page.getByRole('button',{name:'第 4 组 · 5 题',exact:true}).waitFor();
  assert.equal(await catalog.locator('.catalog-problem-card').count(),30);
  assert.match(await catalog.locator('.catalog-problem-card').first().locator('strong').textContent(),/^第 51 题/);
  await catalog.getByRole('button',{name:'上一页题目',exact:true}).click();
  await page.getByRole('button',{name:/跳到第 1 题/}).click();
  await catalog.getByRole('button',{name:/筛选/}).click();
  await catalog.getByRole('combobox',{name:'兵种'}).selectOption('r');
  await page.waitForFunction(()=>document.querySelectorAll('.catalog-problem-card').length===50);
  assert(requests.includes('r'),'piece filter must reach API');
  await catalog.getByRole('button',{name:'收起',exact:true}).click();
  await page.screenshot({path:`${output}/catalog-${process.env.WEBKIT?'webkit':'chrome'}-${viewport.width}.png`});
  await page.getByRole('button',{name:'按书本学习',exact:true}).click();
  await catalog.getByRole('button',{name:/实用残局精选/}).click();
  await catalog.getByRole('button',{name:/车兵残局.*可练题/}).click();
  await catalog.locator('.catalog-problem-card').first().waitFor();
  await page.screenshot({path:`${output}/book-chapter-${viewport.width}.png`});
  const numbers=page.getByRole('navigation',{name:'题库数字导航',exact:true});
  await numbers.getByRole('button',{name:'收起数字导航',exact:true}).click();
  assert.equal(await numbers.getByRole('button',{name:/跳到第/}).count(),0);
  await numbers.getByRole('button',{name:'展开数字导航',exact:true}).click();
  await numbers.getByRole('button',{name:'第 2 组 · 25 题',exact:true}).click();
  await numbers.getByRole('button',{name:/跳到第 26 题/}).waitFor();
  await numbers.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/outer-numbers-${process.env.WEBKIT?'webkit':'chrome'}-${viewport.width}.png`});
  await catalog.locator('.catalog-problem-card').first().locator('button').first().click();
  await page.locator('.mobile-solver-page').waitFor();
  assert.equal(await page.getByRole('navigation',{name:'题库数字导航',exact:true}).count(),0);
  await page.locator('.mobile-problem-navigator-trigger').click();
  await page.getByRole('listitem',{name:/^第 5 题/}).click();
  await page.getByText('第 5 题 · 车兵巧胜单士 5',{exact:true}).waitFor();
  await page.screenshot({path:`${output}/solver-${process.env.WEBKIT?'webkit':'chrome'}-${viewport.width}.png`});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  assert.deepEqual(errors,[]);await page.close();console.log('PASS practical list paging/numbers/source/filter/solver '+viewport.width);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
