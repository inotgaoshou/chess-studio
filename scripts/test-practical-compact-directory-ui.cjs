// Actual mobile App and authorized catalog reader, with synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {responseFor}=require('./mobile-library-fixtures.cjs');
const topic={id:'practical',name:'实用残局',kind:'category',teachingEntry:'practical_endgames',displayOrder:0,active:true,confirmed:true,itemCount:80};
const book={...topic,id:'book',parentId:topic.id,name:'陈松顺 · 实用残局增订本',kind:'book',teachingEntry:undefined};
const chapters=['按原书题序','原本部分','马类','炮类','车类','增订部分'].map((name,i)=>({...book,id:'chapter-'+i,parentId:book.id,name,kind:'chapter',itemCount:80}));
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-practical-directory';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**',route=>{const url=new URL(route.request().url());let data=responseFor(url,route.request().method(),{role:'coach'});
   if(url.pathname.endsWith('/teaching-catalog/browse')){const id=url.searchParams.get('nodeId'),chapter=chapters.find(c=>c.id===id),path=chapter?[topic,book,chapter]:id===book.id?[topic,book]:id?[topic]:[];data={currentNode:path.at(-1)||null,breadcrumbs:path,children:!id?[topic]:id===topic.id?[book]:id===book.id?chapters:[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};}
   if(/\/teaching-catalog\/[^/]+\/problems$/.test(url.pathname)){const start=url.searchParams.get('cursor')?50:0;data={items:Array.from({length:start?30:50},(_,i)=>({...responseFor(new URL('http://fixture/api/v1/student/problems/p'+(i+start))),title:'天天残局图'+String(i+start+1).padStart(3,'0')+'_红先胜',verifiedMateMoves:1})),nextCursor:start?null:'50'};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');new MutationObserver((_,o)=>{if(document.documentElement){document.documentElement.classList.add(innerWidth<768?'phone-webview':'tablet-webview');o.disconnect();}}).observe(document,{childList:true});});
  await page.goto(base+'/library');await page.getByRole('button',{name:/实用残局.*可练题/}).click();const catalog=page.locator('.catalog-practical-compact');await catalog.locator('.catalog-problem-card').first().waitFor();
  const first=await catalog.locator('.catalog-problem-card').first().boundingBox();if(width<600)assert(first.y<365,'compact first card should appear without scrolling '+JSON.stringify(first));
  assert.equal(await page.getByRole('navigation',{name:'数字导航',exact:true}).count(),0,'number navigation starts collapsed');
  await page.screenshot({path:`${out}/list-${width}x${height}.png`});
  await catalog.getByRole('button',{name:'按书本学习',exact:true}).click();await catalog.getByRole('button',{name:/陈松顺.*可练题/}).click();await catalog.getByRole('button',{name:/原本部分.*可练题/}).waitFor();
  await page.screenshot({path:`${out}/chapters-${width}x${height}.png`});
  await catalog.getByRole('button',{name:/原本部分.*可练题/}).click();await catalog.locator('.catalog-problem-card').first().waitFor();
  await catalog.getByRole('button',{name:'目录',exact:true}).click();const sheet=page.getByRole('dialog',{name:'残局目录'});await sheet.getByRole('button',{name:/马类.*可练题/}).waitFor();
  assert.equal(await sheet.getByRole('button',{name:/原本部分.*当前目录/}).count(),1);await page.screenshot({path:`${out}/directory-${width}x${height}.png`});
  const bounds=await sheet.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=height+1);
  await sheet.getByRole('button',{name:/马类.*可练题/}).click();await sheet.waitFor({state:'hidden'});await catalog.getByRole('heading',{name:'马类',exact:true}).waitFor();
  await catalog.locator('.catalog-compact-number-trigger').click();await page.getByRole('combobox',{name:'题号范围'}).selectOption('1');await page.getByRole('button',{name:/跳到第 25 题/}).click();await page.waitForFunction(()=>{const r=document.querySelectorAll('.catalog-problem-card')[24]?.getBoundingClientRect();return r&&r.top>=0&&r.top<innerHeight;});
  await catalog.getByRole('button',{name:'下一页题目',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.catalog-problem-card').length===80);assert((await catalog.locator('.catalog-compact-number-trigger').textContent()).includes('80 / 共 80'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS compact list/directory/sibling selection/number jump/paging '+width+'x'+height+' firstCardY='+first.y);await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
