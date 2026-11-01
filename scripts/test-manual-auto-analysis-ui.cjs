const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-manual-auto-analysis';fs.mkdirSync(out,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game={id:'automatic-analysis',title:'自动分析布局验收',note:'保留备注',startingFen:fen,currentFen:fen,currentNodeId:'main:0',cursor:0,moves:['b0c2','b9c7'],branches:[{id:'right-horse',parentCursor:0,parentPath:[],moves:['h0g2'],notation:['马二进三'],createdAt:1}],comments:{b0c2:'原主线注释'},createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T00:00:00Z'};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));let failNext=false,clouds=0,cloudSuggestions=false;
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname,user={id:'auto-analysis-coach',orgId:'school',role:'coach',displayName:'测试'};let body=[];
  if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;
  else if(path.endsWith('/analysis')){const request=route.request().postDataJSON();requests.push(request);if(failNext){failNext=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试引擎暂时不可用'})});}await new Promise(r=>setTimeout(r,180));const black=request.fen.includes(' b '),files=['a','c','e','g'];body={engine:'isolated-fixture',elapsedMs:10,lines:files.slice(0,request.multiPv).map((f,i)=>({multipv:i+1,depth:18+i,scoreCp:35+i,pv:[`${f}${black?6:3}${f}${black?5:4}`],nodes:500000,nps:250000}))};}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
 });
 await page.route('**/chessdb.php**',route=>{clouds++;const black=(new URL(route.request().url()).searchParams.get('board')||'').includes(' b ');return route.fulfill({body:cloudSuggestions?`move:${black?'a6a5':'a3a4'},score:35,winrate:53`:'status:unknown'});});
 await page.goto(base+'/account',{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async game=>{const source=await(await fetch('/src/App.tsx')).text();window.storeUrl=source.match(/from "(\/src\/store\.ts[^"]*)"/)[1];await(await import(window.storeUrl)).trainingStore.saveManualGame(game);},game);
 await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await page.getByRole('button',{name:'打开棋谱：自动分析布局验收',exact:true}).click();
 const board=page.locator('.manual-workspace .xiangqi-board'),dock=page.getByRole('region',{name:'录谱内容'}),toolbar=page.getByRole('navigation',{name:'录谱工具栏'}),playback=page.getByRole('navigation',{name:'棋谱播放与导航'}),panel=page.getByRole('tabpanel');
 await board.waitFor();assert.equal(await toolbar.getByRole('button',{name:'新建棋谱',exact:true}).count(),0);assert.equal(await toolbar.getByRole('button').count(),6);assert.equal(await playback.getByRole('button').count(),8);
 for(const name of ['AI 禁用','自由推演','分析','新增棋谱','摆棋','闪电出招'])await toolbar.getByRole('button',{name,exact:true}).waitFor();
 const topPinned=async()=>{
  const gap=await page.evaluate(()=>{const board=document.querySelector('.manual-play-board-area > .board-shell').getBoundingClientRect(),area=document.querySelector('.manual-play-board-area').getBoundingClientRect(),top=document.querySelector('.manual-top-area').getBoundingClientRect();return {within:board.top-area.top,below:board.top-top.bottom};});
  assert(Math.abs(gap.within)<=1,'The board must align to the top of its available cell');assert(gap.below>=0&&gap.below<=4.1,'The board must sit immediately below the evaluation row: '+JSON.stringify(gap));
 };
 const defaultBoard=await board.boundingBox();assert(defaultBoard.width>=350,'Default recording board should use the phone width');await topPinned();await page.screenshot({path:out+'/reference-restored.png'});
 const recordGeometry=await board.boundingBox();
 const recommendationArrows=board.locator('[data-arrow-source="recommendation"]');
 const assertSavedBranches=async()=>{
  assert.equal(await recommendationArrows.count(),0,'Stored branch choices must not look like engine suggestions');
  assert.deepEqual(await board.locator('.saved-branch-arrow .analysis-arrow-stem').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('stroke'))),['#f87924','#f87924']);
  await page.getByRole('navigation',{name:'当前局面分支'}).getByText('分支',{exact:true}).waitFor();
 };
 await assertSavedBranches();await page.screenshot({path:out+'/disabled-saved-branches.png'});
 for(let round=0;round<2;round++){
  const beforeCount=requests.length;
  await toolbar.getByRole('button',{name:'AI 禁用',exact:true}).click();
  await page.locator('.manual-evaluation-strip[aria-busy=false]').filter({hasText:'深度'}).waitFor();assert.equal(requests.length,beforeCount+1);
  await assertSavedBranches();
  await toolbar.getByRole('button',{name:'AI 局势',exact:true}).click();await toolbar.getByRole('button',{name:'AI 提示',exact:true}).waitFor();
  await toolbar.getByRole('button',{name:'AI 提示',exact:true}).click();await toolbar.getByRole('button',{name:'AI 局势',exact:true}).waitFor();
  await page.waitForTimeout(400);assert.equal(requests.length,beforeCount+1,'Evaluation/hints switches reuse the analysis');
  await toolbar.getByRole('button',{name:'AI 局势',exact:true}).click();await toolbar.getByRole('button',{name:'AI 禁用',exact:true}).waitFor();
  await assertSavedBranches();
  const after=await board.boundingBox();for(const key of ['x','y','width','height'])assert(Math.abs(after[key]-recordGeometry[key])<=1,'Recording board moved across AI modes');
 }
 await toolbar.getByRole('button',{name:'分析',exact:true}).click();await panel.locator('.analysis-candidate-select').first().waitFor();
 assert.equal(await page.locator('.manual-analysis-page').count(),1);await page.getByRole('button',{name:'返回录谱',exact:true}).waitFor();
 const commands=page.getByRole('navigation',{name:'录谱分析工具栏'});
 const menu=()=>commands.getByRole('button',{name:'更多功能',exact:true}).click();
 const geometry=()=>page.evaluate(()=>Object.fromEntries(['.manual-stage','.manual-workspace','.manual-workspace .xiangqi-board','.manual-top-area','.manual-playback-controls','.manual-dock-heading'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height]];})));
 const stable=(a,b)=>{for(const k in a)a[k].forEach((v,i)=>assert(Math.abs(v-b[k][i])<=1,`${k} shifted ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`));};
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(150);const before=await geometry();await topPinned();console.log("viewport",width,height,JSON.stringify(before));
  for(const name of ['引擎','云库','棋谱']){await page.getByRole('tab',{name,exact:true}).click();await page.waitForTimeout(100);stable(before,await geometry());}
  assert.deepEqual(await page.getByRole('tab').allTextContents(),['棋谱','云库','引擎']);
  assert.equal(await commands.getByRole('button').count(),6);
  for(const button of [...await playback.getByRole('button').all(),...await commands.getByRole('button').all()])assert(await button.evaluate(node=>{const r=node.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return target===node||node.contains(target);}), 'A floating panel covers a playback button');
  const bb=await board.boundingBox(),tb=await playback.boundingBox(),db=await dock.boundingBox();assert(bb.width>180&&bb.height>210,JSON.stringify({width,bb}));await page.screenshot({path:`${out}/layout-${width}x${height}.png`});assert(tb.y+tb.height<=height&&db.y+db.height<=height+1,'Controls outside viewport '+JSON.stringify({width,height,tb,db,bb}));assert(bb.x+bb.width<=width+1);assert(bb.y+bb.height<=db.y+1||bb.x+bb.width<=db.x+1,'Dock overlaps board');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(height>width)assert(tb.y-bb.y-bb.height<=17,'Playback must stay close to the board');
  await page.getByRole('tab',{name:'引擎',exact:true}).click();
 await commands.getByRole('button',{name:'AI 提示',exact:true}).click();
 await page.getByRole('button',{name:'返回录谱',exact:true}).click();await toolbar.getByRole('button',{name:'AI 局势',exact:true}).waitFor();
 await toolbar.getByRole('button',{name:'分析',exact:true}).click();await commands.getByRole('button',{name:'AI 局势',exact:true}).click();await commands.getByRole('button',{name:'AI 禁用',exact:true}).waitFor();
 await page.goBack();await toolbar.getByRole('button',{name:'AI 禁用',exact:true}).waitFor();
 await toolbar.getByRole('button',{name:'分析',exact:true}).click();await panel.locator('.analysis-candidate-select').first().waitFor();
 await page.screenshot({path:`${out}/layout-${width}x${height}.png`});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);const initial=await geometry();
 await board.getByRole('button',{name:'a3 红兵',exact:true}).click();await page.waitForTimeout(220);stable(initial,await geometry());await page.screenshot({path:out+'/analysis-selected-390.png'});
 await menu();await page.getByRole('region',{name:'录谱菜单'}).getByRole('button',{name:'返回录谱',exact:true}).click();await toolbar.waitFor();await toolbar.getByRole('button',{name:'分析',exact:true}).click();await panel.locator('.analysis-candidate-select').first().waitFor();stable(initial,await geometry());
 const firstCount=requests.length;assert.equal(await toolbar.count(),0);assert.equal(await playback.getByRole('button').count(),5);await panel.locator('.analysis-candidate-select').first().waitFor();assert.equal(requests.length,firstCount);assert.equal(await page.getByText('自我分析',{exact:true}).count(),0);stable(initial,await geometry());
 await board.getByRole('button',{name:'b0 红马',exact:true}).click();await board.getByRole('button',{name:'c2',exact:true}).click();await board.getByRole('button',{name:'c2 红马',exact:true}).waitFor();
 assert.equal(await board.locator('.analysis-candidate-arrow:not(.saved-branch-arrow)').count(),0,'Old arrows disappear immediately');await panel.locator('.analysis-candidate-select').first().waitFor();assert.equal(requests.length,firstCount+1);assert(requests.at(-1).fen.includes(' b '));stable(initial,await geometry());
 await playback.getByRole('button',{name:'上一步',exact:true}).click();await playback.getByRole('button',{name:'下一步',exact:true}).click();
 const choices=page.getByRole('navigation',{name:'当前局面分支'});if(await choices.isVisible())await choices.getByRole('button',{name:/马八进七/}).click();
 await page.waitForTimeout(700);assert.equal(requests.length,firstCount+2,'Rapid navigation gets one final request');
 const count=requests.length;await commands.getByRole('button',{name:'AI 提示',exact:true}).click();await page.waitForTimeout(400);assert.equal(requests.length,count,'Hiding arrows does not recalculate');
 await playback.getByRole('button',{name:'上一步',exact:true}).click();await page.waitForTimeout(650);assert.equal(requests.length,count+1);assert.equal(await board.locator('.analysis-candidate-arrow:not(.saved-branch-arrow)').count(),0);
 await panel.getByRole('combobox',{name:'候选数量'}).selectOption('3');await page.waitForTimeout(650);assert.equal(requests.at(-1).multiPv,3);
 await panel.getByRole('combobox',{name:'分析用时'}).selectOption('1');await page.waitForTimeout(650);assert.equal(requests.at(-1).value,1000);stable(initial,await geometry());
 await commands.getByRole('button',{name:'AI 局势',exact:true}).click();const disabledCount=requests.length;await page.getByRole('button',{name:'返回录谱',exact:true}).click();await toolbar.waitFor();
 await toolbar.getByRole('button',{name:'分析',exact:true}).click();await panel.locator('.analysis-candidate-select').first().waitFor();assert.equal(requests.length,disabledCount+1);
 failNext=true;await panel.getByRole('button',{name:'重新分析当前局面',exact:true}).click();await panel.getByRole('button',{name:'重试',exact:true}).click();await panel.locator('.analysis-candidate-select').first().waitFor();stable(initial,await geometry());
 // Another engine owner suspends the parent; closing resumes only the current position.
 await panel.getByRole('button',{name:'小棋盘',exact:true}).first().click();const preview=page.locator('.variation-board');await preview.waitFor();const parentCount=()=>requests.filter(r=>r.value!==1500).length;const paused=parentCount();await page.waitForTimeout(700);assert.equal(parentCount(),paused);await preview.getByRole('button',{name:'关闭小棋盘',exact:true}).click();if(await preview.getByRole('button',{name:'放弃并关闭',exact:true}).isVisible())await preview.getByRole('button',{name:'放弃并关闭',exact:true}).click();await preview.waitFor({state:'hidden'});await page.waitForTimeout(650);assert.equal(parentCount(),paused+1);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));const hidden=requests.length;await page.waitForTimeout(700);assert.equal(requests.length,hidden);await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await page.waitForTimeout(650);assert.equal(requests.length,hidden+1);
 await menu();await page.getByRole('button',{name:'背谱练习',exact:true}).click();const rehearsal=page.getByRole('dialog',{name:'背谱练习'});await rehearsal.waitFor();const duringRehearsal=requests.length;await page.waitForTimeout(650);assert.equal(requests.length,duringRehearsal);await rehearsal.getByRole('button',{name:'返回录谱',exact:true}).click();await page.waitForTimeout(650);assert.equal(requests.length,duringRehearsal+1);
 await menu();await page.getByRole('button',{name:'整局报告',exact:true}).click();const report=page.getByRole('dialog',{name:'录谱面板'});await report.getByText('已分析 3/3 个局面',{exact:true}).waitFor();assert((await report.locator('.manual-panel-content').boundingBox()).height>150,'Report must keep a usable content area');await page.screenshot({path:out+'/report.png'});const reportCount=requests.length;await page.waitForTimeout(650);assert.equal(requests.length,reportCount,'No parent analysis runs during report');await report.getByRole('button',{name:'关闭录谱面板',exact:true}).click();await page.waitForTimeout(650);assert.equal(requests.length,reportCount+1);stable(initial,await geometry());
 const saved=await page.evaluate(async()=> (await import(window.storeUrl)).trainingStore.openManualGame('automatic-analysis'));assert.deepEqual(saved.moves,game.moves);assert.deepEqual(saved.comments,game.comments);assert.deepEqual(saved.branches,game.branches);
 await page.getByRole('tab',{name:'云库',exact:true}).click();await panel.getByText('当前局面暂无云库着法。',{exact:true}).waitFor();assert(clouds>0);
 // Cloud recommendations must obey exactly the same modes as engine hints,
 // even when valid cloud results remain cached at the current position.
 cloudSuggestions=true;
 await board.getByRole('button',{name:'b0 红马',exact:true}).click();await board.getByRole('button',{name:'c2',exact:true}).click();
 await panel.locator('.study-cloud-list button').first().waitFor();
 await recommendationArrows.waitFor();assert.equal(await board.locator('.saved-branch-arrow').count(),0);
 const cloudGeometry=await geometry(),cloudRequestCount=clouds;
 await page.screenshot({path:out+'/hints-cloud-arrows.png'});
 await commands.getByRole('button',{name:'AI 提示',exact:true}).click();assert.equal(await recommendationArrows.count(),0);
 await commands.getByRole('button',{name:'AI 局势',exact:true}).click();assert.equal(await recommendationArrows.count(),0);stable(cloudGeometry,await geometry());
 await page.waitForTimeout(450);assert.equal(clouds,cloudRequestCount,'AI display changes reuse cloud data');
 await page.screenshot({path:out+'/disabled-cloud-no-arrows.png'});
 await commands.getByRole('button',{name:'AI 禁用',exact:true}).click();assert.equal(await recommendationArrows.count(),0);
 await commands.getByRole('button',{name:'AI 局势',exact:true}).click();await recommendationArrows.waitFor();stable(cloudGeometry,await geometry());
 await page.getByRole('tab',{name:'引擎',exact:true}).click();await page.screenshot({path:out+'/automatic-analysis-final.png'});assert.deepEqual(errors,[]);const positionLabels=await board.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));await page.getByRole('button',{name:'返回录谱',exact:true}).click();await toolbar.waitFor();assert.deepEqual(await board.getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),positionLabels,'Return keeps the current analysis position in the same manual');await playback.getByRole('button',{name:'更多功能',exact:true}).click();await page.getByRole('button',{name:'查看棋谱与注释',exact:true}).click();await page.getByRole('tab',{name:'棋谱',exact:true}).waitFor();
 console.log('PASS: restored reference actions, stable phone/tablet layouts, auto analysis, debounce, parameters, disable, retry, preview/background ownership, tree preservation; requests='+requests.length);await page.close();
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
