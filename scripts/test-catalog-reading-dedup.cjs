// Replays the published duplicate rows reported on 2026-10-21 in the real UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {rows,base,chapter,auth,responseFor} = require('./catalog-reading-fixtures.cjs');
const url = process.env.CATALOG_URL || 'http://127.0.0.1:1452';
const evidence = process.env.CATALOG_EVIDENCE || '/tmp/qixi-reading-dedup';
fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  for(const role of ['student','vip','coach']) for(const width of [375,390,430,800]) {
   auth.user.role=role==='vip'?'student':role;auth.user.vipActive=role!=='student';
   const page=await browser.newPage({viewport:{width,height:900}});
   page.setDefaultTimeout(10000);
   await page.addInitScript(()=>localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done'));
   await page.route('**/api/v1/**',async route=>{
    await route.fulfill({contentType:'application/json',body:JSON.stringify(responseFor(new URL(route.request().url())))});
   });
   await page.goto(url+'/library');
   await page.evaluate(async auth=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const rootModule=await import('/node_modules/.vite/deps/react-dom_client.js');
    const {TeachingCatalog}=await import('/src/TeachingCatalog.tsx');
    const {teachingClient}=await import('/src/teaching.ts');
    await teachingClient.login('fixture','fixture');
    const host=document.createElement('div');host.id='reading-dedup';host.style='position:fixed;inset:0;overflow:auto;background:white;z-index:9999';document.body.append(host);
    window.openedReading=[];
    (rootModule.createRoot||rootModule.default.createRoot)(host).render(React.createElement(TeachingCatalog,{auth,teacher:auth.user.role==='coach',scene:'browse',compact:true,onReadSolution:ids=>window.openedReading.push(ids)}));
   },auth);
   const catalog=page.locator('#reading-dedup .teaching-catalog');
   await catalog.getByRole('button',{name:/基础杀法.*可练题/}).click();
   await catalog.getByRole('button',{name:'棋谱学习',exact:true}).click();
   await catalog.locator('.catalog-reading > button').filter({hasText:'第7局重炮攻杀法'}).waitFor();
   let solutions=catalog.locator('.catalog-reading > button').filter({hasText:/题解 ·/});
   assert.equal(await solutions.count(),3,'same content under different IDs appears only once on the first page');
   assert.equal(await solutions.filter({hasText:'0001-1步杀'}).count(),2,'same title with different positions is retained');
   await catalog.getByRole('button',{name:'更多题解',exact:true}).click();
   await catalog.getByRole('button',{name:'更多题解',exact:true}).waitFor({state:'detached'});
   assert.equal(await solutions.count(),4,'cross-page duplicate content is merged');
   assert.equal(await solutions.filter({hasText:'第7局重炮攻杀法'}).count(),1);
   assert.equal(await solutions.filter({hasText:'0001-1步杀'}).count(),3);
   assert.equal(await solutions.locator('.catalog-board').count(),4,'positions can be distinguished without opening each same-named question');
   await solutions.first().click();
   assert.deepEqual(await page.evaluate(()=>window.openedReading),[[rows[0].id]],'keep the first published problem identity');
   await catalog.getByRole('button',{name:'做题训练',exact:true}).click();
   await catalog.getByRole('button',{name:/两步杀基础精选.*可练题/}).click();
   await catalog.locator('.catalog-problem-card').first().waitFor();
   assert.equal(await catalog.locator('.catalog-problem-card').count(),4,'assignment and training source identities remain available');
   await catalog.getByRole('button',{name:'返回上级目录',exact:true}).click();
   await catalog.getByRole('button',{name:'棋谱学习',exact:true}).click();
   await catalog.locator('.catalog-reading > button').filter({hasText:'第7局重炮攻杀法'}).waitFor();
   assert.equal(await solutions.count(),4,'restored cached pages stay deduplicated');
   await page.waitForFunction(()=>document.querySelector('#reading-dedup .teaching-catalog')?.getAttribute('aria-busy')==='false');
   await catalog.getByText('正在读取教材…',{exact:true}).waitFor({state:'detached'});
   await page.screenshot({path:path.join(evidence,role+'-'+width+'-reading.png')});
   for(const button of await solutions.all()){const box=await button.boundingBox();assert(box.height>=44&&box.width<=width,'touch target and no overflow');}
   assert.equal(await catalog.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
   await page.close();console.log('PASS reading dedup '+role+' '+width+': first page, across pages, same titles, cache, stable open identity, training untouched');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
