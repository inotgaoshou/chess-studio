// Real App + WASM + isolated in-memory store. No production requests or user data.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const prefix=['h2e2','h7e7','e2e6','d9e8','c0e2','h9g7'];
const game={id:'branch-actions',title:'分支操作验收',note:'保留备注',startingFen:fen,currentFen:fen,currentNodeId:'main:6',cursor:6,moves:[...prefix,'e6e8'],branches:[{id:'retreat',parentCursor:6,parentPath:prefix,moves:['e6e4'],notation:['炮五退二'],createdAt:1},{id:'left-capture',parentCursor:6,parentPath:prefix,moves:['e6a6'],notation:['炮五平九'],createdAt:2}],comments:{[prefix.join(',')]:'分叉注释',[[...prefix,'e6e8'].join(',')]:'主线后续注释'},createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T00:00:00Z'};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.feedbackPlays=0;const oldPlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.feedbackPlays++;return oldPlay.call(this);};if(window.AudioContext){const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const node=create.call(this),start=node.start.bind(node);node.start=(...args)=>{window.feedbackPlays++;return start(...args);};return node;};}Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',r=>{const path=new URL(r.request().url()).pathname,user={id:'branch-coach',orgId:'school',role:'coach',displayName:'测试'};return r.fulfill({contentType:'application/json',body:JSON.stringify(path.endsWith('/auth/refresh')?{token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user}:path.endsWith('/auth/me')?user:[])});});
 await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async game=>{const source=await(await fetch('/src/App.tsx')).text();window.storeUrl=source.match(/from "(\/src\/store\.ts[^"]*)"/)[1];await(await import(window.storeUrl)).trainingStore.saveManualGame(game);},game);
 const read=()=>page.evaluate(async()=> (await import(window.storeUrl)).trainingStore.openManualGame('branch-actions'));
 await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await page.getByRole('button',{name:'打开棋谱：分支操作验收',exact:true}).click();
 const board=page.locator('.manual-workspace .xiangqi-board'),strip=page.getByRole('navigation',{name:'当前局面分支'});
 await board.getByRole('button',{name:'e6 红炮',exact:true}).waitFor();
 const out=process.env.EVIDENCE_DIR||'/tmp/qixi-rehearsal-feedback';fs.mkdirSync(out,{recursive:true});

 for(const [width,height] of [[320,844],[390,844],[430,844],[820,1180],[844,390]]){
  await page.setViewportSize({width,height});
  const sizes=await page.locator('.manual-command-toolbar').evaluate(node=>{
   const header=node.getBoundingClientRect(),buttons=[...node.querySelectorAll(':scope > button')];
   return buttons.map(b=>{const r=b.getBoundingClientRect(),icon=b.querySelector('svg').getBoundingClientRect();return {h:r.height,icon:icon.width,inside:r.top>=header.top&&r.bottom<=header.bottom+1,center:Math.abs((r.top+r.bottom-icon.top-icon.bottom)/2)};});
  });
  assert(sizes.every(s=>s.h>=40&&s.icon>=17&&s.icon<=19&&s.inside&&s.center<1),'Header buttons must fit their compact row and be centered: '+JSON.stringify({width,sizes}));
  await page.screenshot({path:out+'/header-'+width+'.png'});
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'更多功能',exact:true}).click();
 await page.getByRole('button',{name:'背谱练习',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'背谱练习'});
 await dialog.getByRole('button',{name:'h2 红炮',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'h2 红炮',exact:true}).click();
 await dialog.getByRole('button',{name:'e2',exact:true}).click();
 await dialog.locator('.board-moving-piece').waitFor();
 await dialog.getByText('背谱练习 · 已走 2 步',{exact:true}).waitFor();
 assert((await page.evaluate(()=>window.feedbackPlays))>=2,'Own move and automatic reply must both play sound');
 await page.screenshot({path:out+'/rehearsal-390.png'});
 const count=await page.evaluate(()=>window.feedbackPlays);
 await dialog.getByRole('button',{name:'重新开始',exact:true}).click();
 await dialog.getByText('背谱练习 · 已走 0 步',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.feedbackPlays),count,'Restart must not play old move audio');
 assert.equal(await dialog.locator('.board-moving-piece').count(),0);
 assert.deepEqual((await read()).moves,game.moves);
 assert.deepEqual(errors,[]);
 console.log('PASS rehearsal actual board animation, own/reply audio, quiet restart, original manual unchanged; compact toolbar at 320/390/430/820');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
