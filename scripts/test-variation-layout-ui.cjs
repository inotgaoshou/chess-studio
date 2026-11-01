// Isolated API fixtures, real App/WASM/store/CSS. Never contacts production.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = process.env.EVIDENCE_DIR || '/tmp/qixi-variation-layout';
fs.mkdirSync(output, { recursive: true });
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game = {id:'variation-fixture',title:'推演验收',note:'原备注',startingFen:fen,currentFen:fen,currentNodeId:'main:0',moves:['b0c2','b9c7'],cursor:0,branches:[{id:'legacy-coordinate',parentCursor:0,parentPath:[],moves:['c3c4'],notation:['c3c4'],createdAt:0}],comments:{'b0c2':'保留注释'},createdAt:'2026-10-20T10:00:00Z',updatedAt:'2026-10-25T10:00:00Z'};
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
  if (!await panel.evaluate(el=>el.classList.contains('is-collapsed'))) {
    await panel.page().waitForFunction(()=>{
      const panel=document.querySelector('aside[aria-label="小棋盘推演"]');
      const area=panel.querySelector('.variation-board-content').getBoundingClientRect(),board=panel.querySelector('.variation-board-canvas').getBoundingClientRect();
      return board.width>0&&board.left>=area.left-1&&board.right<=area.right+1&&board.top>=area.top-1&&board.bottom<=area.bottom+1;
    });
  }
}
(async()=>{
const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
let page; let engineFailure=false;
try {
  page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(8000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');localStorage.setItem('xiangqi-ttxq-mirror-owner','http://127.0.0.1:8090::variation-coach');});
  await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname;let body=[];const user={id:'variation-coach',orgId:'school',role:'coach',displayName:'回归账号',organizations:[]};if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};else if(path.endsWith('/analysis')){const {fen}=route.request().postDataJSON();await new Promise(resolve=>setTimeout(resolve,500));if(engineFailure){await route.fulfill({status:503,body:'暂时无法计算，请稍后重试。'.repeat(8)});return;}body={elapsedMs:1500,lines:[{multipv:1,depth:22,scoreCp:200,nodes:12345678912345,nps:8000,pv:[fen.split(' ')[1]==='b'?'h9g7':'a3a4']}]};}await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1422')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
  await page.evaluate(async()=>{const source=await(await fetch('/src/App.tsx')).text();window.fixtureStoreUrl=source.match(/from \"(\/src\/store\.ts[^\"]*)\"/)[1];});
  await page.evaluate(async game=>{const {trainingStore}=await import(window.fixtureStoreUrl||'/src/store.ts');await trainingStore.saveManualGame(game);await trainingStore.saveManualGame({...game,id:'readonly-fixture',title:'只读推演验收',readOnly:true});},game);
  await page.getByRole('button',{name:/我的棋谱 录谱/}).click();
  await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:'打开棋谱：推演验收',exact:true}).click();
  const board=page.locator('.manual-workspace .xiangqi-board');await board.waitFor();
  await page.getByRole('button',{name:'自由推演',exact:true}).click();
  const panel=panelOf(page);await panel.waitFor();
  const small=panel.locator('.xiangqi-board');


  const geometry=()=>panel.evaluate(el=>Object.fromEntries(['.variation-board-canvas','.variation-playback','.variation-evaluation'].map(selector=>{const r=el.querySelector(selector).getBoundingClientRect();return [selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})));
  const stable=async(before,label)=>{const after=await geometry();for(const selector of Object.keys(before))for(const key of ['x','y','width','height'])assert(Math.abs(before[selector][key]-after[selector][key])<=1,`${label} ${selector} ${key} moved ${after[selector][key]-before[selector][key]}px`);};
  await page.waitForTimeout(120);const pending=await geometry();
  await panel.getByRole('button',{name:/走正招/}).waitFor();await page.waitForTimeout(120);await stable(pending,'idle result');
  for(const viewport of [{width:320,height:844},{width:390,height:844},{width:430,height:844},{width:844,height:390},{width:820,height:1180},{width:1180,height:820},{width:390,height:844}]){
    await page.setViewportSize(viewport);await bounds(panel);await page.waitForTimeout(120);
    const ready=await geometry();
    const bottomGap=await panel.evaluate(el=>el.getBoundingClientRect().bottom-el.querySelector('.variation-playback').getBoundingClientRect().bottom);
    assert(bottomGap<=10,`unnecessary bottom gap: ${bottomGap}px`);
    await panel.getByRole('button',{name:'AI 提示开',exact:true}).click();await page.waitForTimeout(80);await stable(ready,'hints hidden');
    assert.equal(await panel.getByRole('button',{name:/走正招/}).count(),0);
    assert.equal(await panel.locator('.analysis-arrow-layer').count(),0);
    await panel.getByRole('button',{name:'AI 提示关',exact:true}).click();await page.waitForTimeout(80);await stable(ready,'hints visible');
    await page.screenshot({path:output+`/stable-${viewport.width}x${viewport.height}.png`});
  }
  const beforeInstant=await geometry();
  await panel.getByRole('button',{name:'AI 提示开',exact:true}).click();
  await panel.getByRole('button',{name:'极速出招',exact:true}).click();
  await panel.getByText(/第 1 步 \/ 共 1 步/).waitFor();await page.waitForTimeout(80);await stable(beforeInstant,'instant move');
  await panel.getByRole('button',{name:'推演起点',exact:true}).click();
  await panel.getByRole('button',{name:'AI 提示关',exact:true}).click();
  const beforeMove=await geometry();engineFailure=true;
  await step(small,'h0 红马','g2');await panel.getByText(/第 1 步 \/ 共 1 步/).waitFor();await page.waitForTimeout(80);await stable(beforeMove,'move validation');
  await panel.getByRole('button',{name:'重试计算'}).waitFor();await page.waitForTimeout(80);await stable(beforeMove,'engine error');
  engineFailure=false;await panel.getByRole('button',{name:'重试计算'}).click();await panel.getByRole('button',{name:/走正招/}).waitFor();await page.waitForTimeout(80);await stable(beforeMove,'engine retry');
  await panel.getByRole('button',{name:'保存分支',exact:true}).click();await panel.getByText(/已保存一支/).waitFor();await page.waitForTimeout(80);await stable(beforeMove,'save receipt');
  await panel.getByRole('button',{name:'关闭推演提示',exact:true}).click();await stable(beforeMove,'receipt dismissed');
  await panel.getByRole('button',{name:'更多推演操作',exact:true}).click();
  const branches=panel.getByRole('region',{name:'已保存变招',exact:true});
  await branches.getByText('1. 兵七进一 · 1 步',{exact:true}).waitFor();
  assert(!/[a-i][0-9][a-i][0-9]/i.test(await branches.innerText()),'saved move labels must use Chinese notation');
  for(const row of await branches.locator('li').all()){
    const text=await row.locator('span').boundingBox(),remove=await row.getByRole('button').boundingBox();
    assert(text.x+text.width<=remove.x+1,'branch text must not overlap its delete control');
  }
  await page.screenshot({path:output+'/saved-branches.png'});
  await panel.getByRole('button',{name:'关闭小棋盘',exact:true}).click();
  assert.equal(await panel.getByRole('region',{name:'推演更多操作'}).count(),0);
  const confirm=panel.getByRole('alertdialog',{name:'保留未保存推演'});await confirm.waitFor();
  await confirm.getByRole('button',{name:'放弃并关闭',exact:true}).click({trial:true});
  await page.screenshot({path:output+'/close-confirm.png'});
  await confirm.getByRole('button',{name:'继续研究',exact:true}).click();await stable(beforeMove,'continue after close confirmation');
  await panel.getByRole('button',{name:'收起小棋盘',exact:true}).click();
  await panel.getByRole('button',{name:'关闭小棋盘',exact:true}).click();
  await confirm.getByRole('button',{name:'放弃并关闭',exact:true}).click();await panel.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'自由推演',exact:true}).click();await panel.waitFor();
  await panel.getByRole('button',{name:'关闭小棋盘',exact:true}).click();await panel.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS geometry and closing: no bottom gap, idle result, hint toggle, move/error/retry/save, Chinese legacy labels, more/close/collapse/discard; 320/390/430, landscape and iPad');
}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
