// Isolated API fixtures, real App/WASM/store/CSS. Never contacts production.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.EVIDENCE_DIR || '/tmp/qixi-108-variation';
fs.mkdirSync(output, { recursive: true });
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game = {id:'variation-fixture',title:'推演验收',note:'原备注',startingFen:fen,currentFen:fen,currentNodeId:'main:0',moves:['b0c2','b9c7'],cursor:0,branches:[],comments:{'b0c2':'保留注释'},createdAt:'2026-10-20T10:00:00Z',updatedAt:'2026-10-25T10:00:00Z'};
const panelOf = page => page.locator('aside[aria-label="小棋盘推演"]');
async function read(page,id=game.id) { return page.evaluate(async id => (await import(window.fixtureStoreUrl||'/src/store.ts')).trainingStore.openManualGame(id),id); }
async function step(board,from,to) {
  await board.getByRole('button',{name:from,exact:true}).click();
  await board.getByRole('button',{name:to,exact:true}).click();
}
async function bounds(panel) {
  await panel.page().waitForFunction(()=>{const r=document.querySelector('aside[aria-label="小棋盘推演"]').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});
  const rect=await panel.boundingBox();
  const screen=await panel.page().evaluate(()=>({width:innerWidth,height:innerHeight}));
  assert(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=screen.width+1&&rect.y+rect.height<=screen.height+1,`panel outside viewport: ${JSON.stringify(rect)}`);
  assert(await panel.locator('header button').first().evaluate(el=>{const r=el.getBoundingClientRect();return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button');}),'header must receive taps');
}
(async()=>{
const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
let page;
try {
  page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');localStorage.setItem('xiangqi-ttxq-mirror-owner','http://127.0.0.1:8090::variation-coach');});
  await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;let body=[];const user={id:'variation-coach',orgId:'school',role:'coach',displayName:'回归账号',organizations:[]};if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1422')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
  await page.evaluate(async()=>{const source=await(await fetch('/src/App.tsx')).text();window.fixtureStoreUrl=source.match(/from \"(\/src\/store\.ts[^\"]*)\"/)[1];});
  await page.evaluate(async game=>{const {trainingStore}=await import(window.fixtureStoreUrl||'/src/store.ts');await trainingStore.saveManualGame(game);await trainingStore.saveManualGame({...game,id:'readonly-fixture',title:'只读推演验收',readOnly:true});},game);
  await page.getByRole('button',{name:/我的棋谱 录谱/}).click();
  await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:'打开棋谱：推演验收',exact:true}).click();
  const board=page.locator('.manual-workspace .xiangqi-board');await board.waitFor();
  await page.getByRole('button',{name:'自由推演',exact:true}).click();
  const panel=panelOf(page);await panel.waitFor();
  const small=panel.locator('.xiangqi-board');
  await step(small,'h0 红马','g2');await panel.getByText('第 1 步／共 1 步',{exact:false}).waitFor();
  await step(small,'h9 黑马','g7');await panel.getByText('第 2 步／共 2 步',{exact:false}).waitFor();
  assert.deepEqual((await read(page)).moves,game.moves);assert.deepEqual((await read(page)).branches,[],'preview must never write');
  await panel.getByRole('button',{name:'推演起点',exact:true}).click();
  await panel.getByRole('button',{name:'保存整条线路 · 共 2 步',exact:true}).click();
  await panel.getByText(/已保存到/).waitFor();
  let saved=await read(page);assert.deepEqual(saved.moves,game.moves);assert.equal(saved.cursor,0);assert.deepEqual(saved.comments,game.comments);assert.equal(saved.branches.length,1);assert.deepEqual(saved.branches[0].moves,['h0g2','h9g7']);
  await panel.getByRole('button',{name:'保存整条线路 · 共 2 步',exact:true}).click();await panel.getByText(/该线路已在棋谱中/).waitFor();assert.equal((await read(page)).branches.length,1);
  await bounds(panel);await page.screenshot({path:output+'/phone-portrait.png'});
  // Drag without allowing the fixed header to leave the viewport.
  const title=await panel.locator('header strong').boundingBox();await page.mouse.move(title.x+10,title.y+10);await page.mouse.down();await page.mouse.move(-400,-400);await page.mouse.up();await bounds(panel);
  await panel.getByRole('button',{name:'收起小棋盘'}).click();assert.equal(await small.count(),0);await panel.getByRole('button',{name:'展开小棋盘'}).click();
  await page.setViewportSize({width:844,height:390});await bounds(panel);await page.screenshot({path:output+'/phone-landscape.png'});
  await panel.getByRole('button',{name:'更多推演操作'}).click();await panel.getByRole('button',{name:'展开查看',exact:true}).click();await bounds(panel);
  await page.setViewportSize({width:820,height:1100});await bounds(panel);await page.screenshot({path:output+'/tablet-expanded.png'});
  await panel.getByRole('button',{name:'关闭小棋盘'}).click();await panel.waitFor({state:'hidden'});
  // A main-board edit queued after the explicit write must retain the new variation.
  await step(board,'a3 红兵','a4');await board.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
  await page.waitForFunction(async()=>{const g=await(await import(window.fixtureStoreUrl||'/src/store.ts')).trainingStore.openManualGame('variation-fixture');return g.moves[0]==='a3a4'&&g.branches.some(b=>b.moves[0]==='h0g2');});
  assert.deepEqual((await read(page)).comments,game.comments);
  console.log('PASS phone: isolated preview, full save from start, dedup, non-destructive mainline/comments/cursor, subsequent autosave, touch/rotation/drag/expand');
  // A read-only record remains byte-for-byte intact; only the new personal copy is writable.
  await page.getByRole('button',{name:'返回我的棋谱',exact:true}).click();
  await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:'查看棋谱：只读推演验收',exact:true}).click();
  const readOnlyBefore=await read(page,'readonly-fixture');
  await page.getByRole('button',{name:'自由推演',exact:true}).click();const readOnlyPanel=panelOf(page);
  await step(readOnlyPanel.locator('.xiangqi-board'),'h0 红马','g2');await readOnlyPanel.getByText(/第 1 步／共 1 步/).waitFor();
  await readOnlyPanel.getByRole('button',{name:'复制到我的棋谱后保存 · 共 1 步',exact:true}).click();
  const copyDialog=page.getByRole('dialog',{name:'保存棋谱',exact:true});await copyDialog.waitFor();await copyDialog.getByRole('button',{name:'保存棋谱',exact:true}).click();await copyDialog.waitFor({state:'hidden'});await readOnlyPanel.getByText(/已保存到/).waitFor();
  assert.deepEqual(await read(page,'readonly-fixture'),readOnlyBefore);
  const readOnlyCopy=await page.evaluate(async()=>{const items=await(await import(window.fixtureStoreUrl||'/src/store.ts')).trainingStore.manualGames();return items.find(g=>g.title==='只读推演验收 · 推演副本');});assert(readOnlyCopy&&!readOnlyCopy.readOnly);assert.deepEqual(readOnlyCopy.moves,game.moves);assert.deepEqual(readOnlyCopy.comments,game.comments);assert(readOnlyCopy.branches.some(b=>b.moves[0]==='h0g2'));
  await readOnlyPanel.getByRole('button',{name:'关闭小棋盘'}).click();await readOnlyPanel.waitFor({state:'hidden'});
  console.log('PASS phone read-only: personal copy, original untouched, comments/mainline preserved');
  // Real study edits made while the panel is minimized must survive the first save dialog.
  await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'棋盘与引擎设置',exact:true}).click();
  await page.getByRole('button',{name:'切换到拆棋',exact:true}).click();
  const studyBoard=page.locator('.study-stage > .board-shell .xiangqi-board');await studyBoard.waitFor();
  await step(studyBoard,'b0 红马','c2');await studyBoard.getByRole('button',{name:'c2 红马',exact:true}).waitFor();
  await page.getByRole('button',{name:'回到开始',exact:true}).click();await page.getByRole('button',{name:'自由推演',exact:true}).click();
  const studyPanel=panelOf(page);await step(studyPanel.locator('.xiangqi-board'),'h0 红马','g2');await studyPanel.getByText(/第 1 步／共 1 步/).waitFor();
  await studyPanel.getByRole('button',{name:'收起小棋盘'}).click();
  await step(studyBoard,'a3 红兵','a4');await studyBoard.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
  await studyPanel.getByRole('button',{name:'展开小棋盘'}).click();await studyPanel.getByRole('button',{name:'保存整条线路 · 共 1 步',exact:true}).click();
  const metadata=page.getByRole('dialog',{name:'保存棋谱',exact:true});await metadata.waitFor();
  assert(await metadata.getByLabel('棋谱名称',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),'metadata dialog must be above the small board');
  await metadata.getByLabel('棋谱名称',{exact:true}).fill('自由拆棋三线保留');await metadata.getByRole('button',{name:'保存棋谱',exact:true}).click();await metadata.waitFor({state:'hidden'});await studyPanel.getByText(/已保存到/).waitFor();
  const studySaved=await page.evaluate(async()=>{const games=await(await import(window.fixtureStoreUrl||'/src/store.ts')).trainingStore.manualGames();return games.find(g=>g.title==='自由拆棋三线保留');});
  assert.equal(studySaved.moves[0],'a3a4');assert(studySaved.branches.some(b=>b.moves[0]==='b0c2'),'original study line must survive');assert(studySaved.branches.some(b=>b.moves[0]==='h0g2'),'small board line must save');
  assert.equal(studySaved.cursor,1);await studyBoard.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
  await studyPanel.getByRole('button',{name:'收起小棋盘'}).click();await page.getByRole('button',{name:'新建标准棋局',exact:true}).click();await studyBoard.getByRole('button',{name:'a3 红兵',exact:true}).waitFor();await studyPanel.getByRole('button',{name:'展开小棋盘'}).click();
  await studyPanel.getByRole('button',{name:'保存整条线路 · 共 1 步',exact:true}).click();await studyPanel.getByRole('alert').filter({hasText:'来源棋谱已变化'}).waitFor();
  assert.deepEqual(await read(page,studySaved.id),studySaved,'reset of same FEN must invalidate old source even after first save');
  await studyPanel.getByRole('button',{name:'更多推演操作'}).click();await studyPanel.getByRole('button',{name:'另存到我的棋谱',exact:true}).click();await metadata.waitFor();await metadata.getByRole('button',{name:'保存棋谱',exact:true}).click();await metadata.waitFor({state:'hidden'});await studyPanel.getByText(/已保存到/).waitFor();
  console.log('PASS phone study: latest original/main-board/mini branches preserved, metadata above panel, same-FEN source reset rejected, explicit copy retained');
  assert.deepEqual(errors,[]);
  await page.close();
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(8000);
  const desktopErrors=[];page.on('pageerror',e=>desktopErrors.push(e.message));
  await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));
  await page.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await page.goto(process.env.DESKTOP_URL||'http://127.0.0.1:1421');await page.getByRole('button',{name:'自由推演',exact:true}).waitFor();
  await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});
  await page.evaluate(async()=>{const source=await(await fetch('/src/App.tsx')).text();window.fixturePlatformUrl=source.match(/from \"(\/src\/platform\/index\.ts[^\"]*)\"/)[1];});
  await page.evaluate(async()=>{const {chessPlatform:p}=await import(window.fixturePlatformUrl||'/src/platform/index.ts');const a=await p.playMove('b0c2');await p.updateComment(a.currentNode,'原主线注释');await p.playMove('b9c7');await p.navigateTo();});
  await page.reload();await page.getByRole('button',{name:'自由推演',exact:true}).click();
  const deskPanel=panelOf(page);await deskPanel.waitFor();
  const ds=(row,col)=>deskPanel.getByRole('button',{name:`推演棋盘 ${row+1} 行 ${col+1} 列`,exact:true});
  await ds(9,7).click();await ds(7,6).click();await deskPanel.getByText(/第 1 步／共 1 步/).waitFor();
  await ds(0,7).click();await ds(2,6).click();await deskPanel.getByText(/第 2 步／共 2 步/).waitFor();
  const db=()=>page.evaluate(async()=>{const {webDatabase:d}=await import('/src/platform/indexedDb.ts');return d.currentGame();});
  const before=await db();
  await deskPanel.getByRole('button',{name:'推演起点',exact:true}).click();
  await deskPanel.getByRole('button',{name:'保存整条线路 · 共 2 步',exact:true}).click();await deskPanel.getByText(/已保存分支 · 新增 2 步/).waitFor();
  const after=await db();assert.equal(after.id,before.id);assert.equal(after.fen,before.fen);assert(after.snapshot.includes('原主线注释'));
  await deskPanel.getByRole('button',{name:'保存整条线路 · 共 2 步',exact:true}).click();await deskPanel.getByText(/该线路已在棋谱中/).waitFor();assert.deepEqual(JSON.parse((await db()).snapshot),JSON.parse(after.snapshot));
  await bounds(deskPanel);await page.screenshot({path:output+'/desktop-docked.png'});
  await deskPanel.getByRole('button',{name:'更多推演操作'}).click();await deskPanel.getByRole('button',{name:'悬浮显示',exact:true}).click();await bounds(deskPanel);
  await page.setViewportSize({width:900,height:600});await bounds(deskPanel);await page.screenshot({path:output+'/desktop-floating.png'});
  await deskPanel.getByRole('button',{name:'更多推演操作'}).click();await deskPanel.getByRole('button',{name:'另存到我的棋谱',exact:true}).click();await deskPanel.getByText(/已另存到本地棋谱库/).waitFor();assert.equal((await db()).id,before.id,'copy must not activate a different document');
  await deskPanel.getByRole('button',{name:'关闭小棋盘'}).click();await deskPanel.waitFor({state:'hidden'});
  await page.reload();await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});assert.equal((await db()).id,before.id);assert.deepEqual(JSON.parse((await db()).snapshot),JSON.parse(after.snapshot),'restart must restore complete original tree and saved branch');
  const failures=await page.evaluate(async()=>{
    const source=await(await fetch('/src/App.tsx')).text();const {chessPlatform:p}=await import(source.match(/from \"(\/src\/platform\/index\.ts[^\"]*)\"/)[1]);const {webDatabase:d}=await import('/src/platform/indexedDb.ts');
    const initial=await d.currentGame(),tree=JSON.parse(initial.snapshot);let invalid=false,deleted=false;
    const count=(await d.pending()).length;
    try{await p.appendVariation({gameId:initial.id,startingFen:tree.startingFen,expectedFen:initial.fen,moves:['a3a4','a9a0']});}catch{invalid=true;}
    const unchanged=JSON.stringify(JSON.parse((await d.currentGame()).snapshot))===JSON.stringify(tree)&&(await d.pending()).length===count;
    const node=Object.values(tree.tree.nodes).find(n=>n.comment==='原主线注释');const anchor=await p.navigateTo(node.id);await p.navigateTo();await p.deleteNode(node.id);
    const deletedCount=(await d.pending()).length;
    try{await p.appendVariation({gameId:initial.id,anchorNodeId:node.id,startingFen:tree.startingFen,expectedFen:anchor.fen,moves:['b9c7']});}catch{deleted=true;}
    return {invalid,unchanged,deleted,deletedUnchanged:(await d.pending()).length===deletedCount};
  });assert.deepEqual(failures,{invalid:true,unchanged:true,deleted:true,deletedUnchanged:true});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{localStorage.setItem('xiangqi:workspace-layout','studio');localStorage.setItem('xiangqi:color-theme','dark');});await page.reload();await page.getByRole('button',{name:'自由推演',exact:true}).click();await page.locator('.workspace.layout-studio').waitFor();assert.equal(await panelOf(page).evaluate(el=>el.classList.contains('is-light')),false);await bounds(panelOf(page));await page.screenshot({path:output+'/desktop-professional.png'});
  assert.deepEqual(desktopErrors,[]);
  console.log('PASS desktop: actual WASM/IndexedDB, manual preview/full save/dedup, original comments/mainline/cursor, detached copy, reload, dock/float/resize');
} catch(error) {
  if(page){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});fs.writeFileSync(output+'/failure.txt',await page.locator('body').innerText());}
  throw error;
} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
