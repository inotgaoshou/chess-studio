// Real mobile App/WASM with isolated API fixtures. Web trainingStore is memory-only:
// reload rehydrates its saved DTO to exercise native-record restore, not native disk I/O.
// No production requests.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const output=process.env.EVIDENCE_DIR||'/tmp/qixi-10087-continuation';fs.mkdirSync(output,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const moves=['b0c2','b9c7','h0g2','h9g7','a3a4'];
const tail=['a6a5','c3c4','c6c5','g3g4'];
const game={id:'five-step',title:'五步接续验收',note:'原备注',startingFen:fen,currentFen:fen,currentNodeId:'main:5',cursor:5,moves,branches:[],comments:{[moves.join(',')]:'原主线注释'},createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z'};
const panelOf=p=>p.getByRole('complementary',{name:'小棋盘推演',exact:true});
async function step(board,from,to){await board.getByRole('button',{name:from,exact:true}).click();await board.getByRole('button',{name:to,exact:true}).click();}
(async()=>{
 const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));let page;
 try{
 page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');localStorage.setItem('xiangqi-ttxq-mirror-owner','http://127.0.0.1:8090::variation-coach');});
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname,user={id:'variation-coach',orgId:'school',role:'coach',displayName:'回归账号',organizations:[]};let body=[];if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};else if(path.endsWith('/analysis')){const {fen}=route.request().postDataJSON();body={lines:[{multipv:1,depth:22,scoreCp:100,pv:[fen.split(' ')[1]==='b'?'a6a5':'c3c4']}]};}await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1422')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async game=>{const source=await(await fetch('/src/App.tsx')).text();window.fixtureStoreUrl=source.match(/from \"(\/src\/store\.ts[^\"]*)\"/)[1];const {trainingStore}=await import(window.fixtureStoreUrl);await trainingStore.saveManualGame(game);},game);
 const read=()=>page.evaluate(async()=> (await import(window.fixtureStoreUrl)).trainingStore.openManualGame('five-step'));
 async function open(){await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:'打开棋谱：五步接续验收',exact:true}).click();}
 await open();const title=page.locator('.recording-title b');await title.getByText('录谱 5/5',{exact:true}).waitFor();
 const big=page.locator('.manual-workspace .xiangqi-board');await big.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
 await page.getByRole('button',{name:'自由推演',exact:true}).click();const panel=panelOf(page),small=panel.locator('.xiangqi-board');
 // Start with a paused engine; one request must move one black ply without changing preference.
 await panel.getByRole('button',{name:'更多推演操作'}).click();await panel.getByRole('button',{name:'暂停计算',exact:true}).click();await panel.getByRole('button',{name:'更多推演操作'}).click();
 await panel.getByRole('button',{name:'AI 提示开',exact:true}).click();await panel.getByRole('button',{name:'极速出招',exact:true}).click();await panel.getByText(/第 1 步 \/ 共 1 步/).waitFor();await small.getByRole('button',{name:'a5 黑卒',exact:true}).waitFor();
 await step(small,'c3 红兵','c4');await panel.getByText(/第 2 步 \/ 共 2 步/).waitFor();await step(small,'c6 黑卒','c5');await panel.getByText(/第 3 步 \/ 共 3 步/).waitFor();await step(small,'g3 红兵','g4');await panel.getByText(/第 4 步 \/ 共 4 步/).waitFor();
 assert.equal((await read()).branches.length,0,'temporary moves never persist');
 await panel.getByRole('button',{name:'保存分支',exact:true}).click();await panel.getByText(/已保存一支/).waitFor();await title.getByText('录谱 5/9',{exact:true}).waitFor();
 await big.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();await panel.getByText(/第 4 步 \/ 共 4 步/).waitFor();
 let saved=await read();assert.deepEqual(saved.moves,moves);assert.deepEqual(saved.comments,game.comments);assert.equal(saved.cursor,5);assert.deepEqual(saved.branches[0].moves,tail);
 await panel.getByRole('button',{name:'保存分支',exact:true}).click();await panel.getByText(/该线路已保存/).waitFor();assert.deepEqual((await read()).branches,saved.branches);
 await panel.getByRole('button',{name:'收起小棋盘'}).click();const strip=page.getByRole('navigation',{name:'当前局面分支'});await strip.getByRole('button',{name:/^继续：/}).waitFor();
 await page.screenshot({path:output+'/five-of-nine.png'});
 await page.getByRole('button',{name:'下一步',exact:true}).click();await title.getByText('录谱 6/9',{exact:true}).waitFor();await big.getByRole('button',{name:'a5 黑卒',exact:true}).waitFor();
 await page.getByRole('button',{name:'播放棋谱',exact:true}).click();await title.getByText('录谱 9/9',{exact:true}).waitFor();assert.deepEqual((await read()).moves,moves);
 await page.reload();await page.getByRole('button',{name:'菜单',exact:true}).waitFor();
 await page.evaluate(async saved=>{const source=await(await fetch('/src/App.tsx')).text();window.fixtureStoreUrl=source.match(/from \"(\/src\/store\.ts[^\"]*)\"/)[1];await (await import(window.fixtureStoreUrl)).trainingStore.saveManualGame(saved);},saved);
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'我的棋谱',exact:true}).click();await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:'打开棋谱：五步接续验收',exact:true}).click();await title.getByText('录谱 5/9',{exact:true}).waitFor();assert.deepEqual((await read()).branches,saved.branches);
 // Add a second tail sharing its first move. Only the actual fork must ask for a choice.
 await page.getByRole('button',{name:'自由推演',exact:true}).click();await step(small,'a6 黑卒','a5');await panel.getByText(/第 1 步 \/ 共 1 步/).waitFor();await step(small,'e3 红兵','e4');await panel.getByText(/第 2 步 \/ 共 2 步/).waitFor();await panel.getByRole('button',{name:'保存分支',exact:true}).click();await panel.getByText(/已保存一支/).waitFor();await panel.getByRole('button',{name:'收起小棋盘'}).click();
 await page.getByRole('button',{name:'下一步',exact:true}).click();await title.getByText('录谱 6/9',{exact:true}).waitFor();assert.equal(await strip.getByRole('button',{name:/^分支 \d/}).count(),2);
 const before=await read();await strip.getByRole('button',{name:'收起变招选择'}).click();await page.getByRole('button',{name:'下一步',exact:true}).click();await strip.getByRole('button',{name:/^分支 2/}).waitFor();await title.getByText('录谱 6/9',{exact:true}).waitFor();
 await page.getByRole('button',{name:'播放棋谱',exact:true}).click();await page.getByRole('button',{name:'播放棋谱',exact:true}).waitFor();await title.getByText('录谱 6/9',{exact:true}).waitFor();
 assert.deepEqual((await read()).moves,before.moves);assert.deepEqual((await read()).branches,before.branches);
 await strip.getByRole('button',{name:/^分支.*兵五进一/}).click();await big.getByRole('button',{name:'e4 红兵',exact:true}).waitFor();await title.getByText('录谱 7/7',{exact:true}).waitFor();assert.deepEqual((await read()).moves,moves);
 await page.screenshot({path:output+'/nested-choice.png'});assert.deepEqual(errors,[]);
 // Study persistence keeps a projected/manual extension as a branch of its canonical route.
 await panel.getByRole('button',{name:'展开小棋盘'}).click();await panel.getByRole('button',{name:'关闭小棋盘'}).click();
 await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'棋盘与引擎设置',exact:true}).click();await page.getByRole('button',{name:'切换到拆棋',exact:true}).click();
 const study=page.locator('.study-stage > .board-shell .xiangqi-board');await study.waitFor();await step(study,'b0 红马','c2');await study.getByRole('button',{name:'c2 红马',exact:true}).waitFor();
 await page.getByRole('button',{name:'自由推演',exact:true}).click();await step(small,'h9 黑马','g7');await panel.getByText(/第 1 步 \/ 共 1 步/).waitFor();await panel.getByRole('button',{name:'保存分支',exact:true}).click();
 const metadata=page.getByRole('dialog',{name:'保存棋谱',exact:true});await metadata.waitFor();await metadata.getByRole('button',{name:'保存棋谱',exact:true}).click();await panel.getByText(/已保存一支/).waitFor();await panel.getByRole('button',{name:'收起小棋盘'}).click();
 await page.getByRole('button',{name:'下一步',exact:true}).click();await study.getByRole('button',{name:'g7 黑马',exact:true}).waitFor();await step(study,'a3 红兵','a4');await study.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
 await page.waitForFunction(()=>{const state=JSON.parse(localStorage.getItem('xiangqi-training-study-state'));return state.branches.some(b=>[...b.parentPath,...b.moves].join(',')==='b0c2,h9g7,a3a4');});
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('xiangqi-training-study-state')).moves),['b0c2']);
 await page.reload();await study.getByRole('button',{name:'c2 红马',exact:true}).waitFor();await page.getByRole('button',{name:'下一步',exact:true}).click();await study.getByRole('button',{name:'g7 黑马',exact:true}).waitFor();await page.getByRole('button',{name:'下一步',exact:true}).click();await study.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS study localStorage reload: main-board extension of a projected variation survives; original canonical mainline unchanged');
 console.log('PASS mobile: instant black move paused/hints off; 5/5 -> save4 -> 5/9 unchanged position -> next/play -> restart; common prefix, nested fork, next reveals selector, playback waits, canonical/comments unchanged');
 await page.close();page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);
 await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));await page.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.goto(process.env.DESKTOP_URL||'http://127.0.0.1:1421');await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});
 const seed=await page.evaluate(async moves=>{const source=await(await fetch('/src/App.tsx')).text();const {chessPlatform:p}=await import(source.match(/from \"(\/src\/platform\/index\.ts[^\"]*)\"/)[1]);let state;for(const move of moves)state=await p.playMove(move);await p.updateComment(state.currentNode,'五步主线注释');const {webDatabase:d}=await import('/src/platform/indexedDb.ts');return {node:state.currentNode,game:await d.currentGame()};},moves);
 await page.reload();await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});await page.getByRole('button',{name:'自由推演',exact:true}).click();
 const desk=panelOf(page),square=(row,col)=>desk.getByRole('button',{name:`推演棋盘 ${row+1} 行 ${col+1} 列`,exact:true});
 for(const [index,move] of tail.entries()){await square(9-Number(move[1]),move.charCodeAt(0)-97).click();await square(9-Number(move[3]),move.charCodeAt(2)-97).click();await desk.getByText(`第 ${index+1} 步 / 共 ${index+1} 步`,{exact:false}).waitFor();}
 await desk.getByRole('button',{name:'保存分支',exact:true}).click();await desk.getByText(/已保存一支/).waitFor();
 const db=()=>page.evaluate(async()=> (await import('/src/platform/indexedDb.ts')).webDatabase.currentGame());
 const after=await db(),beforeTree=JSON.parse(seed.game.snapshot).tree,afterTree=JSON.parse(after.snapshot).tree;
 assert.equal(after.fen,seed.game.fen);for(const [id,node] of Object.entries(beforeTree.nodes))assert.deepEqual(afterTree.nodes[id],node,'source mainline nodes/comments stay unchanged');
 await desk.getByRole('button',{name:'收起小棋盘'}).click();
 const stripDesk=page.getByRole('navigation',{name:'当前局面分支'});await stripDesk.getByRole('button',{name:/^继续：/}).waitFor();
 await stripDesk.getByRole('button',{name:/^继续：/}).click();assert.notEqual((await db()).fen,seed.game.fen);
 assert.deepEqual(JSON.parse((await db()).snapshot).tree,afterTree,'navigation never promotes canonical nodes');
 await page.reload();await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});assert.deepEqual(JSON.parse((await db()).snapshot).tree,afterTree);
 await page.screenshot({path:output+'/desktop-continuation.png'});
 console.log('PASS desktop: sole saved tail joins true navigation, save leaves board fixed, original mainline/comments unchanged after navigation and IndexedDB restart');
 }catch(error){if(page){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});fs.writeFileSync(output+'/failure.txt',await page.locator('body').innerText());}throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
