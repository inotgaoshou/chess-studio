// Isolated API fixture + actual App, store, WASM and CSS. No production writes.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462';
const output=process.env.EVIDENCE_DIR||'/tmp/qixi-personal-library';fs.mkdirSync(output,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game={id:'library-fixture',title:'省赛决赛',note:'原备注',folderPath:'比赛/决赛',startingFen:fen,currentFen:fen,currentNodeId:'main:0',moves:['b0c2','b9c7'],cursor:0,branches:[{id:'branch',parentCursor:0,parentPath:[],moves:['h0g2'],notation:['马二进三'],createdAt:1}],comments:{'b0c2':'保留注释'},createdAt:'2026-10-20T10:00:00Z',updatedAt:'2026-10-25T10:00:00Z',metadata:{event:'秋季赛',redPlayer:'张三',blackPlayer:'李四',playedAt:'2026-10-20T10:00:00Z',gameType:'full',result:'first-win'}};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));try{
 for(const width of [390,820,1024]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1100},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(width=>{new MutationObserver((_,observer)=>{if(document.documentElement){document.documentElement.classList.add(width<600?'phone-webview':'tablet-webview','touch-webview');observer.disconnect();}}).observe(document,{childList:true});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');},width);
  await page.route('**/api/v1/**',async r=>{const path=new URL(r.request().url()).pathname;let body=[];const user={id:'library-coach',orgId:'school',role:'coach',displayName:'回归账号',organizations:[]};if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto(base+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
  await page.evaluate(async game=>{const {trainingStore}=await import('/src/store.ts');await trainingStore.saveManualGame(game);await trainingStore.saveManualGame({...game,id:'other',title:'另一盘棋'});},game);
  await page.getByRole('button',{name:/我的棋谱 录谱/}).click();const library=page.getByRole('dialog',{name:'我的棋谱',exact:true});await library.waitFor();await library.getByRole('button',{name:'编辑信息：省赛决赛'}).waitFor();
  // A new document returns to its source library, rather than the account page.
  if(width<600)await library.locator('.directory-toggle').click();await library.getByRole('button',{name:'目录：比赛',exact:true}).click();
  await library.getByLabel('包含子目录').check();
  await library.getByRole('textbox',{name:'搜索我的棋谱'}).fill('省赛');
  await page.evaluate(async()=>{const {trainingStore}=await import('/src/store.ts');const read=trainingStore.manualGames.bind(trainingStore);window.releaseNewManualRefresh=undefined;trainingStore.manualGames=async(...args)=>{if(!window.releaseNewManualRefresh)await new Promise(resolve=>window.releaseNewManualRefresh=resolve);return read(...args);};});
  await library.getByRole('button',{name:'新建棋谱',exact:true}).click();await library.waitFor({state:'hidden',timeout:2000});

  const newBoard=page.locator('.manual-workspace .xiangqi-board');await newBoard.waitFor({state:'visible'});const boardBox=await newBoard.boundingBox();assert(boardBox.width>200&&boardBox.height>200,'New manual must show a usable recording board');
  await newBoard.getByRole('button',{name:'a3 红兵',exact:true}).click();await newBoard.getByRole('button',{name:'a4',exact:true}).click();await newBoard.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();await page.screenshot({path:`${output}/new-recording-${width}.png`});await page.evaluate(()=>window.releaseNewManualRefresh?.());
  await page.getByRole('button',{name:'返回我的棋谱',exact:true}).click();await library.waitFor();
  assert.equal(await library.getByRole('textbox',{name:'搜索我的棋谱'}).inputValue(),'省赛');assert.match(await library.locator('.personal-library-toolbar > span').innerText(),/^比赛 ·/);
  await library.getByRole('button',{name:'清空搜索'}).click();await library.getByRole('button',{name:'返回',exact:true}).click();await library.waitFor({state:'hidden'});await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await library.waitFor();
  if(width<600)await library.locator('.directory-toggle').click();await library.getByRole('button',{name:'目录：比赛/决赛',exact:true}).click();
  await library.getByRole('button',{name:'编辑信息：省赛决赛'}).click();const edit=page.getByRole('dialog',{name:'编辑棋谱信息'});await edit.waitFor();
  const top=await edit.getByLabel('棋谱名称',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;});assert(top,'Edit input must be on top and receive taps');
  await edit.getByLabel('棋谱名称',{exact:true}).fill('决赛复盘');await edit.getByLabel('红方棋手',{exact:true}).fill('王五');await edit.getByRole('button',{name:'保存修改',exact:true}).click();await edit.waitFor({state:'hidden'});await library.getByRole('button',{name:'编辑信息：决赛复盘'}).waitFor();
  const saved=await page.evaluate(async()=>{const {trainingStore}=await import('/src/store.ts');return trainingStore.openManualGame('library-fixture');});assert.equal(saved.title,'决赛复盘');assert.equal(saved.metadata.redPlayer,'王五');for(const key of ['moves','branches','comments','cursor','currentNodeId'])assert.deepEqual(saved[key],game[key],`metadata must preserve ${key}`);
  await library.getByRole('textbox',{name:'搜索我的棋谱'}).fill('王五 秋季赛');assert.equal(await library.locator('article').count(),1);
  await library.getByRole('button',{name:'清空搜索'}).click();
  await page.screenshot({path:`${output}/library-${width}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width<600)await library.locator('.directory-toggle').click();await library.getByRole('button',{name:'新建子目录',exact:true}).click();
  await page.locator('.manual-sheet-dialog').waitFor();assert(await page.locator('.manual-workspace .xiangqi-board').evaluateAll(nodes=>nodes.every(node=>node.getClientRects().length===0)),'Library folder dialogs must not keep a painted chessboard behind them');await page.keyboard.press('Escape');await page.locator('.manual-sheet-dialog').waitFor({state:'hidden'});assert(await library.isVisible(),'Escape closes only the folder sheet');
  await library.getByRole('button',{name:'新建子目录',exact:true}).click();const directorySheet=page.locator('.manual-sheet-dialog');await directorySheet.getByLabel('子目录名称',{exact:true}).fill('回放检查');
  await page.setViewportSize({width,height:550});assert(await page.locator('.manual-workspace .xiangqi-board').evaluateAll(nodes=>nodes.every(node=>node.getClientRects().length===0)),'Keyboard resize must not reveal the underlying board');
  await directorySheet.getByRole('button',{name:'确定',exact:true}).click();await directorySheet.waitFor({state:'hidden'});await page.setViewportSize({width,height:width===390?844:1100});
  assert(await library.isVisible());assert(await page.locator('.manual-workspace .xiangqi-board').evaluateAll(nodes=>nodes.every(node=>node.getClientRects().length===0)),'Creating a folder must stay in the library');
  await library.getByRole('button',{name:'目录：比赛/决赛',exact:true}).click();

  assert.equal(await library.getByRole('button',{name:/分享/}).count(),0);
  await library.getByRole('button',{name:'移动：决赛复盘'}).click();const move=page.getByRole('alertdialog',{name:'移动棋谱'});await move.getByLabel('目标目录').selectOption('比赛');await move.getByRole('button',{name:'确认移动'}).click();await move.waitFor({state:'hidden'});assert.equal(await page.evaluate(async()=>{const {trainingStore}=await import('/src/store.ts');return(await trainingStore.openManualGame('library-fixture')).folderPath;}),'比赛');
  await library.getByRole('button',{name:'打开棋谱：决赛复盘'}).click();await library.waitFor({state:'hidden'});await page.getByRole('button',{name:'b0 红马',exact:true}).waitFor();if(width===390){
    await page.evaluate(async()=>{const {trainingStore}=await import('/src/store.ts');const save=trainingStore.saveManualGame.bind(trainingStore);trainingStore.saveManualGame=async game=>{if(!window.failedAutosave){window.failedAutosave=true;throw Error('temporary write failure');}return save(game);};});
    await page.getByRole('button',{name:'a3 红兵',exact:true}).click();await page.getByRole('button',{name:'a4',exact:true}).click();await page.waitForFunction(()=>window.failedAutosave);
    await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'棋谱信息',exact:true}).click();const info=page.getByRole('dialog',{name:'编辑棋谱信息'});await info.getByLabel('棋谱名称',{exact:true}).fill('失败后恢复');await info.getByRole('button',{name:'保存修改',exact:true}).click();await info.waitFor({state:'hidden'});
    const recovered=await page.evaluate(async()=>{const {trainingStore}=await import('/src/store.ts');return trainingStore.openManualGame('library-fixture');});assert.equal(recovered.moves[0],'a3a4');assert(recovered.branches.some(b=>b.moves.includes('b0c2')),'failed autosave branch must be preserved');assert.deepEqual(recovered.comments,game.comments);
   }
   if(width!==390){await page.getByRole('button',{name:'返回我的棋谱',exact:true}).click();await library.waitFor();}
   await library.getByRole('button',{name:'返回',exact:true}).click();await library.waitFor({state:'hidden'});await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
   assert.deepEqual(errors,[]);await page.close();console.log('PASS',width,'direct library, visible editor, preserved moves/branches/comments, search, no sharing entry, move, open');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
