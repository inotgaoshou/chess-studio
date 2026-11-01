// Isolated App + WASM + memory store; no production calls or account writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-instant-move';fs.mkdirSync(out,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const game={id:'instant-fixture',title:'闪电出招验收',note:'原备注',startingFen:fen,currentFen:fen,currentNodeId:'main:0',cursor:0,moves:['b0c2','b9c7'],branches:[],comments:{b0c2:'原注释'},createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'};
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);const errors=[],requests=[];let delay=150,failNext=false,invalidNext=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async route=>{const path=new URL(route.request().url()).pathname,user={id:'instant-coach',orgId:'school',role:'coach',displayName:'测试'};let body=[];
  if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;
  else if(path.endsWith('/analysis')){const request=route.request().postDataJSON();requests.push(request);const fail=failNext,invalid=invalidNext;failNext=false;invalidNext=false;await new Promise(r=>setTimeout(r,delay));if(fail)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'模拟引擎失败'})}).catch(()=>{});
   const black=request.fen.includes(' b '),rows=request.fen.split(' ')[0].split('/'),first=rows[black?3:6].startsWith(black?'p':'P')?'a':'c';
   const best=invalid?'a0a9':`${first}${black?6:3}${first}${black?5:4}`;
   body={engine:'fixture',elapsedMs:150,lines:[{multipv:2,depth:18,scoreCp:10,pv:[black?'g6g5':'g3g4']},{multipv:1,depth:20,scoreCp:35,pv:[best]}]};
  }
  return route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
 });
 await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));
 await page.goto(base+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async game=>{const source=await(await fetch('/src/App.tsx')).text();window.storeUrl=source.match(/from "(\/src\/store\.ts[^"]*)"/)[1];await(await import(window.storeUrl)).trainingStore.saveManualGame(game);},game);
 await page.getByRole('button',{name:/我的棋谱 录谱/}).click();await page.getByRole('button',{name:'打开棋谱：闪电出招验收',exact:true}).click();
 const board=page.locator('.manual-play-board-area .xiangqi-board'),quick=page.getByRole('button',{name:'闪电出招',exact:true}),strip=page.getByRole('navigation',{name:'当前局面分支'});
 const read=()=>page.evaluate(async()=> (await import(window.storeUrl)).trainingStore.openManualGame('instant-fixture'));
 await board.waitFor();assert.equal(await strip.count(),0,'One continuation stays hidden');
 const size=await board.boundingBox();
 await quick.evaluate(b=>{b.click();b.click();});await board.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();await page.waitForTimeout(350);assert.equal(requests.length,1);assert.equal(requests[0].multiPv,1);assert(requests[0].value<=1500);
 await page.getByRole('button',{name:'AI 禁用',exact:true}).waitFor();const after=await board.boundingBox();for(const k of ['x','y','width','height'])assert(Math.abs(size[k]-after[k])<=1);
 await page.getByRole('button',{name:'上一步',exact:true}).click();await strip.getByRole('button',{name:/马八进七/}).waitFor();assert.equal(await strip.locator('[data-move]').count(),2);
 await strip.getByRole('button',{name:/马八进七/}).click();assert.equal(await strip.count(),0);await quick.click();await board.getByRole('button',{name:'a5 黑卒',exact:true}).waitFor();assert(requests.at(-1).fen.includes(' b '));
 // Return to the same position after navigation: stale results must still be discarded.
 delay=500;const beforeCancel=requests.length;await quick.click();await page.waitForFunction(n=>document.querySelector('[aria-label="闪电出招"]').getAttribute('aria-busy')==='true');await page.waitForTimeout(70);await page.getByRole('button',{name:'上一步',exact:true}).click();await board.getByRole('button',{name:'a6 黑卒',exact:true}).waitFor();await page.waitForTimeout(650);assert.equal(await board.getByRole('button',{name:'a4 红兵',exact:true}).count(),0);assert(requests.length<=beforeCancel+1);
 delay=100;failNext=true;await quick.click();await page.getByRole('status').filter({hasText:'闪电出招失败'}).waitFor();assert.equal(await quick.isEnabled(),true);await quick.click();await board.getByRole('button',{name:'a5 黑卒',exact:true}).waitFor();
 invalidNext=true;await quick.click();await page.getByRole('status').filter({hasText:'不合法'}).waitFor();assert.equal(await board.getByRole('button',{name:'a0 红车',exact:true}).count(),1);
 // Cached engine first choice is used, regardless of response order and active recommendation.
 await page.getByRole('button',{name:'分析',exact:true}).click();const panel=page.getByRole('tabpanel');await panel.locator('.analysis-candidate-select').first().waitFor();await panel.locator('.analysis-candidate-select').nth(1).click();const cachedCount=requests.length;await quick.click();await board.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();assert.equal(requests.length,cachedCount);delay=400;await page.waitForTimeout(350);const sharedFen=requests.at(-1).fen,sharedCount=requests.filter(r=>r.fen===sharedFen).length;await quick.click();await board.getByRole('button',{name:'c5 黑卒',exact:true}).waitFor();assert.equal(requests.filter(r=>r.fen===sharedFen).length,sharedCount,'An active search is reused, not restarted');delay=100;await page.getByRole('button',{name:'返回录谱',exact:true}).click();
 // Hide suggestions, then disable calculation: neither preference is changed by the action.
 await page.getByRole('button',{name:'AI 提示',exact:true}).click();await page.getByRole('button',{name:'AI 局势',exact:true}).click();await page.getByRole('button',{name:'AI 禁用',exact:true}).waitFor();
 const saved=await read();assert([saved.moves,...saved.branches.map(b=>[...b.parentPath,...b.moves])].some(path=>game.moves.every((move,index)=>path[index]===move)),'The original continuation remains available');assert.deepEqual(saved.comments,game.comments);assert(saved.branches.length>0);
 await page.screenshot({path:out+'/recording-instant.png'});
 // Study has the same action in the existing top row, and no single-choice overlay.
 await page.goto(base+'/tools/study');const study=page.locator('.study-play-board-area .xiangqi-board'),top=page.getByRole('navigation',{name:'拆棋工具栏'});await study.waitFor();
 await top.getByRole('button',{name:'闪电出招',exact:true}).click();await study.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();await top.getByRole('button',{name:'开启引擎分析',exact:true}).waitFor();
 await page.getByRole('button',{name:'上一步',exact:true}).click();assert.equal(await strip.count(),0,'Study single continuation also stays hidden');await page.getByRole('button',{name:'下一步',exact:true}).click();await study.getByRole('button',{name:'a4 红兵',exact:true}).waitFor();
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);const buttons=await top.getByRole('button').all();assert.equal(buttons.length,8);await page.screenshot({path:`${out}/study-${width}x${height}.png`});const rects=await Promise.all(buttons.map(b=>b.boundingBox()));assert(rects.every(r=>Math.abs(r.y-rects[0].y)<1));for(const b of buttons)assert(await b.evaluate(n=>{const r=n.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return n===p||n.contains(p);}), 'Toolbar button must remain touchable '+width+'x'+height+' '+await b.getAttribute('aria-label')+' '+JSON.stringify(await b.boundingBox()));await page.screenshot({path:`${out}/study-${width}x${height}.png`});}
 assert.deepEqual(errors,[]);console.log('PASS instant: red/black, first PV, cache reuse, paused preference, double click, cancellation, failure/retry, legality, preserved mainline, single/multiple continuations, compact toolbar');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
