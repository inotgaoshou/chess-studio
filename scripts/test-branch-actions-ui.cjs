// Real App + WASM + isolated in-memory store. No production requests or user data.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const prefix=['h2e2','h7e7','e2e6','d9e8','c0e2','h9g7'];
const game={id:'branch-actions',title:'分支操作验收',note:'保留备注',startingFen:fen,currentFen:fen,currentNodeId:'main:6',cursor:6,moves:[...prefix,'e6e8'],branches:[{id:'retreat',parentCursor:6,parentPath:prefix,moves:['e6e4'],notation:['炮五退二'],createdAt:1},{id:'left-capture',parentCursor:6,parentPath:prefix,moves:['e6a6'],notation:['炮五平九'],createdAt:2}],comments:{[prefix.join(',')]:'分叉注释',[[...prefix,'e6e8'].join(',')]:'主线后续注释'},createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T00:00:00Z'};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',r=>{const path=new URL(r.request().url()).pathname,user={id:'branch-coach',orgId:'school',role:'coach',displayName:'测试'};return r.fulfill({contentType:'application/json',body:JSON.stringify(path.endsWith('/auth/refresh')?{token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user}:path.endsWith('/auth/me')?user:[])});});
 await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async game=>{const source=await(await fetch('/src/App.tsx')).text();window.storeUrl=source.match(/from "(\/src\/store\.ts[^"]*)"/)[1];await(await import(window.storeUrl)).trainingStore.saveManualGame(game);},game);
 const read=()=>page.evaluate(async()=> (await import(window.storeUrl)).trainingStore.openManualGame('branch-actions'));
 await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await page.getByRole('button',{name:'打开棋谱：分支操作验收',exact:true}).click();
 const board=page.locator('.manual-workspace .xiangqi-board'),strip=page.getByRole('navigation',{name:'当前局面分支'});
 await board.getByRole('button',{name:'e6 红炮',exact:true}).waitFor();
 const out=process.env.EVIDENCE_DIR||'/tmp/qixi-branch-actions';fs.mkdirSync(out,{recursive:true});
 for(const width of [320,390,430,820]){
  await page.setViewportSize({width,height:width===820?1180:844});await page.waitForTimeout(180);
  const colors=await board.locator('.saved-branch-arrow').evaluateAll(nodes=>nodes.map(n=>n.style.getPropertyValue('--analysis-arrow-color')));assert.deepEqual(colors,['#438a52','#438a52','#438a52']);
  assert.deepEqual(await strip.locator('[data-move]').evaluateAll(nodes=>nodes.map(n=>n.style.getPropertyValue('--branch-color'))),colors);
  const clear=await board.evaluate(node=>{
   const pieces=[...node.querySelectorAll('.board-square img.piece')].map(e=>e.getBoundingClientRect());
   return [...node.querySelectorAll('.analysis-arrow-label')].every(e=>{const r=e.getBoundingClientRect();return pieces.every(p=>Math.hypot(r.x+r.width/2-p.x-p.width/2,r.y+r.height/2-p.y-p.height/2)>(p.width+r.width)*.45);});
  });assert(clear,'Numbers must not cover piece faces');
  const geometry=await board.evaluate(node=>{
   const arrow=node.querySelector('[data-move="e6e4"] .analysis-arrow-stem');
   const target=node.querySelector('.board-square[aria-label="e4"]');
   return {x:Number(arrow.getAttribute('x2')),y:Number(arrow.getAttribute('y2')),tx:parseFloat(target.style.getPropertyValue('--piece-left'))*11.2,ty:parseFloat(target.style.getPropertyValue('--piece-top'))*12.4};
  });assert(Math.hypot(geometry.x-geometry.tx,geometry.y-geometry.ty)<.01,'Empty destination must match board intersection');
  const br=await board.boundingBox(),sr=await strip.boundingBox();assert(sr.y>=br.y+br.height,'Branch choices must stay below board');
  await page.screenshot({path:`${out}/branches-${width}.png`});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(180);
 const flow=board.locator('.saved-branch-arrow .analysis-arrow-flow').first();
 const offset=()=>flow.evaluate(n=>getComputedStyle(n).strokeDashoffset);
 const firstOffset=await offset();await page.waitForTimeout(250);assert.notEqual(await offset(),firstOffset,'Arrow highlights must flow');
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await flow.evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 // Choosing a branch clears the previous arrows and preserves board geometry.
 const rectBefore=await board.boundingBox();
 await strip.getByRole('button',{name:/分支 .*炮五退二/}).click();
 await board.getByRole('button',{name:'e4 红炮',exact:true}).waitFor();
 assert.equal(await board.locator('.saved-branch-arrow').count(),0);
 const rectAfter=await board.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(rectBefore[key]-rectAfter[key])<=1,`${key}: ${JSON.stringify(rectBefore)} -> ${JSON.stringify(rectAfter)}`);
 await page.getByRole('button',{name:'上一步',exact:true}).click();await board.getByRole('button',{name:'e6 红炮',exact:true}).waitFor();
 // Flip uses the same board projection; rotate back without moving an existing card onto the board.
 for(const flipped of [true,false]) {
  await page.getByRole('button',{name:'翻转',exact:true}).click();
  const mismatch=await board.evaluate(node=>{
   const a=node.querySelector('[data-move="e6e4"] .analysis-arrow-stem'),t=node.querySelector('.board-square[aria-label="e4"]');
   return Math.hypot(Number(a.getAttribute('x2'))-parseFloat(t.style.getPropertyValue('--piece-left'))*11.2,Number(a.getAttribute('y2'))-parseFloat(t.style.getPropertyValue('--piece-top'))*12.4);
  });assert(mismatch<.01);await page.screenshot({path:`${out}/flip-${flipped}.png`});
 }
 for(const size of [{width:844,height:390},{width:390,height:844}]){
  await page.setViewportSize(size);await page.waitForTimeout(180);
  const br=await board.boundingBox(),sr=await strip.boundingBox();
  assert(sr.y>=br.y+br.height||sr.x>=br.x+br.width||sr.x+sr.width<=br.x||sr.y+sr.height<=br.y,'Rotated card must not cover board');
  assert(sr.x>=0&&sr.y>=0&&sr.x+sr.width<=size.width+1&&sr.y+sr.height<=size.height+1);
  await page.screenshot({path:`${out}/rotation-${size.width}.png`});
 }
 const beforeEdit=await board.boundingBox();
 await strip.getByRole('button',{name:'编辑分支',exact:true}).click();
 await strip.getByRole('button',{name:/删除分支 .*炮五平九/}).click();const dialog=page.getByRole('dialog',{name:'管理当前分支'});
 await dialog.getByRole('alertdialog',{name:'确认删除分支'}).waitFor();
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const afterEdit=await board.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(beforeEdit[key]-afterEdit[key])<=1);
 await strip.getByRole('button',{name:'管理变招'}).click();
 const mainRow=dialog.locator('.branch-actions-list > div').filter({hasText:'主线'});
 await mainRow.getByRole('button',{name:/删除分支/}).click();await dialog.getByText(/主线将截止/).waitFor();
 await page.evaluate(async()=>{const store=(await import(window.storeUrl)).trainingStore,save=store.saveManualGame.bind(store);store.saveManualGame=async game=>{store.saveManualGame=save;throw new Error('模拟写入失败');};});
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.deepEqual((await read()).moves,game.moves);
 await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await dialog.waitFor({state:'hidden'});
 let saved=await read();assert.deepEqual(saved.moves,prefix);assert.equal(saved.branches[0].moves[0],'e6e4');assert.equal(saved.comments[prefix.join(',')],'分叉注释');assert.equal(Object.keys(saved.comments).length,1);
 await board.getByRole('button',{name:'e6 红炮',exact:true}).waitFor();await strip.getByRole('button',{name:'管理变招'}).click();
 await dialog.getByRole('button',{name:'编辑分支 1'}).click();await dialog.waitFor({state:'hidden'});await board.getByRole('button',{name:'e4 红炮',exact:true}).waitFor();
 await page.getByRole('button',{name:'上一步',exact:true}).click();await board.getByRole('button',{name:'e6 红炮',exact:true}).waitFor();
 await strip.getByRole('button',{name:'管理变招'}).click();await dialog.getByRole('button',{name:'删除分支 1'}).click();await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await dialog.waitFor({state:'hidden'});
 saved=await read();assert.deepEqual(saved.moves,prefix);assert.equal(saved.branches.length,0);assert.equal(saved.comments[prefix.join(',')],'分叉注释');
 // The paper-and-pencil action must create a new identity even with an existing manual open.
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'棋盘与引擎设置',exact:true}).click();await page.getByRole('button',{name:'切换到拆棋',exact:true}).click();
 await page.getByRole('button',{name:'新建棋谱',exact:true}).click();await page.locator('.recording-title b').getByText('录谱 0/0',{exact:true}).waitFor();
 const games=await page.evaluate(async()=> (await import(window.storeUrl)).trainingStore.manualGames());assert(games.some(g=>g.id!==game.id&&g.moves.length===0));assert.deepEqual((await read()).moves,prefix);
 assert.deepEqual(errors,[]);console.log('PASS branch colors/badges 320/390/430/820; mainline deletion, write failure/retry, sibling edit/delete, metadata preserved, paper button creates new game');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
