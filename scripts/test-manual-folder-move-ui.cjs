// Actual mobile App/store/WASM; exercises folder ownership after moving and autosaving.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
if(process.env.EVIDENCE_DIR)fs.mkdirSync(process.env.EVIDENCE_DIR,{recursive:true});
const base = process.env.PRACTICE_URL || 'http://127.0.0.1:1462';
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game = { id:'move-fixture',title:'移动验证棋谱',note:'保留备注',folderPath:'比赛/决赛',startingFen:fen,currentFen:fen,currentNodeId:'main:0',moves:[],cursor:0,branches:[{id:'alternative',parentCursor:0,parentPath:[],moves:['h0g2'],notation:['马二进三'],createdAt:1}],comments:{'main:0':'保留注释'},createdAt:'2026-10-20T10:00:00Z',updatedAt:'2026-10-25T10:00:00Z' };
(async()=>{
 const browser = await (process.env.TEST_WEBKIT ? webkit.launch({headless:true}) : chromium.launch({channel:'chrome',headless:true}));
 try { for (const width of [390,1024]) {
  const page = await browser.newPage({viewport:{width,height:width===390?844:768},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  await page.route('**/api/v1/**',async r=>{const path=new URL(r.request().url()).pathname;const user={id:'fixture',orgId:'school',role:'coach',displayName:'回归账号',organizations:[]};let body=[];if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto(base+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
  await page.evaluate(async game=>{const {trainingStore:s}=await import('/src/store.ts');await s.saveManualGame(game);await s.createManualFolder('比赛/决赛/精选');await s.createManualFolder('训练');},game);
  await page.getByRole('button',{name:/我的棋谱 录谱/}).click();const library=page.getByRole('dialog',{name:'我的棋谱',exact:true});await library.waitFor();
  async function folder(path){if(width<600 && await library.locator('.directory-toggle').getAttribute('aria-expanded')!=='true')await library.locator('.directory-toggle').click();await library.getByRole('button',{name:`目录：${path}`,exact:true}).click();}
  async function stored(){return page.evaluate(async()=>{const {trainingStore:s}=await import('/src/store.ts');return s.openManualGame('move-fixture');});}
  async function moveTo(path){await library.getByRole('button',{name:'移动：移动验证棋谱'}).click();const dialog=page.getByRole('alertdialog',{name:'移动棋谱'});await dialog.getByLabel('目标目录').selectOption(path);await dialog.getByRole('button',{name:'确认移动'}).click();await dialog.waitFor({state:'hidden'});assert.equal((await stored()).folderPath,path||undefined);}
  await folder('比赛/决赛');await moveTo('比赛/决赛/精选');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(process.env.EVIDENCE_DIR)await page.screenshot({path:`${process.env.EVIDENCE_DIR}/moved-child-${width}.png`});
  await folder('比赛/决赛');
  assert.equal(await library.getByRole('button',{name:'打开棋谱：移动验证棋谱'}).count(),0,'A moved game must disappear from its previous directory, including when moved into a child');
  await folder('比赛/决赛/精选');await library.getByRole('button',{name:'打开棋谱：移动验证棋谱'}).click();await library.waitFor({state:'hidden'});
  // A directory change while this document is open must survive its next autosave.
  await page.evaluate(async()=>{const {trainingStore:s}=await import('/src/store.ts');await s.moveManualGame('move-fixture','训练');});
  const board=page.locator('.manual-workspace .xiangqi-board');await board.getByRole('button',{name:'a3 红兵',exact:true}).click();await board.getByRole('button',{name:'a4',exact:true}).click();
  await page.waitForFunction(async()=>{const {trainingStore:s}=await import('/src/store.ts');return (await s.openManualGame('move-fixture')).moves.includes('a3a4');});
  assert.equal((await stored()).folderPath,'训练','Autosaving an open document must not undo a folder move');
  await page.getByRole('button',{name:'返回我的棋谱',exact:true}).click();await library.waitFor();await folder('训练');await moveTo('');
  if(process.env.EVIDENCE_DIR)await page.screenshot({path:`${process.env.EVIDENCE_DIR}/moved-unclassified-${width}.png`});
  await folder('训练');assert.equal(await library.getByRole('button',{name:'打开棋谱：移动验证棋谱'}).count(),0);
  if(width<600)await library.locator('.directory-toggle').click();await library.getByRole('button',{name:'未分类',exact:true}).click();
  await library.getByRole('button',{name:'打开棋谱：移动验证棋谱'}).click();await library.waitFor({state:'hidden'});
  await board.getByRole('button',{name:'a6 黑卒',exact:true}).click();await board.getByRole('button',{name:'a5',exact:true}).click();
  await page.waitForFunction(async()=>{const {trainingStore:s}=await import('/src/store.ts');return (await s.openManualGame('move-fixture')).moves.includes('a6a5');});
  const saved=await stored();assert.equal(saved.folderPath,undefined);assert.deepEqual(saved.branches,game.branches);assert.deepEqual(saved.comments,game.comments);assert.equal((await page.evaluate(async()=>{const {trainingStore:s}=await import('/src/store.ts');return (await s.manualGames()).filter(g=>g.id==='move-fixture').length;})),1);await page.getByRole('button',{name:'菜单',exact:true}).click();await page.getByRole('button',{name:'棋谱信息',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑棋谱信息'});await editor.waitFor();
  await page.evaluate(async()=>{const {trainingStore:s}=await import('/src/store.ts');await s.moveManualGame('move-fixture','训练');});
  await editor.getByRole('button',{name:'保存修改',exact:true}).click();await editor.waitFor({state:'hidden'});assert.equal((await stored()).folderPath,'训练','An untouched folder field must not reverse a concurrent move');assert.deepEqual(errors,[]);
  await page.close();console.log('PASS',width,'move into child, source removal, autosave ownership, unclassified, branches/comments, single identity');
 }} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
