// Runs only on a disposable Android simulator package; never targets a phone.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {_android}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {auth,responseFor}=require('./catalog-reading-fixtures.cjs');
(async()=>{
 const device=(await _android.devices()).find(d=>d.serial()==='emulator-5582');assert(device,'isolated emulator required');
 try {
  let view;for(let i=0;i<50&&!view;i++){view=(await device.webViews()).find(v=>v.pkg()==='cn.xiangqi.endgame.training.librarystudy');if(!view)await new Promise(r=>setTimeout(r,100));}assert(view,'isolated acceptance package required');
  const page=await view.page();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(responseFor(new URL(r.request().url())))}));
  await page.evaluate(async auth=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');await Capacitor.registerPlugin('SecureSession').save({session:JSON.stringify({auth,serverUrl:'https://api.qixiapp.cn',token:auth.token,refreshToken:auth.refreshToken,expiresAt:auth.expiresAt,deviceId:'reading-emulator'})});},auth);
  await page.goto('https://localhost/library');
  await page.getByRole('button',{name:/基础杀法.*可练题/}).click();
  const cat=page.getByRole('region',{name:'教学题库目录',exact:true});
  await cat.getByRole('button',{name:'棋谱学习',exact:true}).click();
  const rows=cat.locator('.catalog-reading-solution');
  await rows.filter({hasText:'第7局'}).waitFor();assert.equal(await rows.count(),3);
  assert.equal(await rows.filter({hasText:'0001-1步杀'}).count(),2);
  await cat.getByRole('button',{name:'更多题解',exact:true}).click();
  await cat.getByRole('button',{name:'更多题解',exact:true}).waitFor({state:'detached'});
  assert.equal(await rows.count(),4);assert.equal(await rows.filter({hasText:'0001-1步杀'}).count(),3);assert.equal(await rows.locator('.catalog-board').count(),4);
  await cat.getByRole('button',{name:'做题训练',exact:true}).click();await cat.getByRole('button',{name:/两步杀基础精选/}).click();
  await cat.locator('.catalog-problem-card').first().waitFor();assert.equal(await cat.locator('.catalog-problem-card').count(),4);
  await cat.getByRole('button',{name:'返回上级目录',exact:true}).click();await cat.getByRole('button',{name:'棋谱学习',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.catalog-reading-solution').length===4);
  await page.getByText('正在读取教材…',{exact:true}).waitFor({state:'detached'});
  const out=process.env.CATALOG_EVIDENCE||'/tmp/qixi-reading-dedup';fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/android-reading.png'});
  assert.deepEqual(errors,[]);console.log('PASS Android native: first/cross-page dedup, distinct positions, training, cache and thumbnails');
  await page.unrouteAll({behavior:'ignoreErrors'});
 }finally{await device.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
