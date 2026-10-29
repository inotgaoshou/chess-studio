// Isolated API fixtures and real App/CSS/WASM. No production requests.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const output=process.env.EVIDENCE_DIR||'/tmp/qixi-10088-overlay';fs.mkdirSync(output,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const firstMoves=['b0c2','h0g2','a3a4','c3c4','e3e4','g3g4','i3i4','b2e2','h2e2','a0a1'];
const rects=async page=>page.evaluate(()=>Object.fromEntries(['.manual-play-board-area > .board-shell','.manual-bottom-tools','.recording-quick-actions','.recording-navigation'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})));
async function stable(page,before,label){await page.waitForTimeout(100);const after=await rects(page);for(const s of Object.keys(before))for(const k of ['x','y','width','height'])assert(Math.abs(after[s][k]-before[s][k])<=1,`${label}: ${s} ${k} changed ${after[s][k]-before[s][k]}px`);}
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));let page;
try{
 page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async r=>{const path=new URL(r.request().url()).pathname,user={id:'overlay',orgId:'school',role:'coach',displayName:'布局验收',organizations:[]};let body=[];if(path.endsWith('/auth/refresh'))body={token:'fixture',expiresAt:'2099-01-01T00:00:00Z',user};else if(path.endsWith('/auth/me'))body=user;else if(path.endsWith('/capabilities'))body={};await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1422')+'/account');await page.getByRole('button',{name:/我的棋谱 录谱/}).waitFor();
 await page.evaluate(async({fen,moves})=>{const source=await(await fetch('/src/App.tsx')).text();const {trainingStore}=await import(source.match(/from \"(\/src\/store\.ts[^\"]*)\"/)[1]);
 for(const count of [0,1,2,10])await trainingStore.saveManualGame({id:`overlay-${count}`,title:`布局验收${count}`,note:'',startingFen:fen,currentFen:fen,currentNodeId:'main:0',cursor:0,moves:count?[moves[0]]:[],branches:moves.slice(1,count).map((move,i)=>({id:`branch-${i}`,parentCursor:0,parentPath:[],moves:[move],notation:[`候选${i+2}`],createdAt:i+1})),comments:{},createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z'});
 },{fen,moves:firstMoves});
 async function open(count,first=false){if(first)await page.getByRole('button',{name:/我的棋谱 录谱/}).click();else{await page.getByRole('button',{name:'菜单',exact:true}).click();assert.equal(await page.getByRole('navigation',{name:'当前局面分支'}).count(),0,'menu hides overlay');await page.getByRole('button',{name:'我的棋谱',exact:true}).click();}
 await page.getByRole('dialog',{name:'我的棋谱',exact:true}).getByRole('button',{name:`打开棋谱：布局验收${count}`,exact:true}).click();await page.locator('.recording-title').getByText(`录谱 0/${count?1:0}`,{exact:true}).waitFor();await page.waitForTimeout(100);}
 const strip=page.getByRole('navigation',{name:'当前局面分支'});
 await open(0,true);
 for(const viewport of [{width:320,height:844},{width:390,height:844},{width:430,height:844},{width:844,height:390}]){
 await page.setViewportSize(viewport);await open(0);const base=await rects(page);
 const buttons=await page.locator('.recording-quick-actions button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,height:r.height,scroll:n.scrollWidth,width:n.clientWidth};}));assert.equal(buttons.length,6);
 if(viewport.width<600){assert(Math.max(...buttons.map(b=>b.top))-Math.min(...buttons.map(b=>b.top))<=1,'six quick buttons must share a portrait row');assert(buttons.every(b=>b.scroll<=b.width+1),'quick labels must not overflow');}else assert.equal(new Set(buttons.map(b=>b.top)).size,2,'landscape side tools retain two rows');
 await open(1);await strip.getByRole('button',{name:/^继续：/}).waitFor();await stable(page,base,'single continuation');
 await open(2);await strip.getByRole('button',{name:/^分支 2/}).waitFor();await stable(page,base,'fork appears');
 const original=await strip.boundingBox();const toolbar=await page.locator('.manual-bottom-tools').boundingBox();assert(original.y+original.height<=toolbar.y+1 || original.x+original.width<=toolbar.x+1,'overlay must avoid toolbar');
 assert.equal(await strip.evaluate(el=>!!el.closest('.manual-bottom-tools')),false,'card must be portaled outside normal layout');
 await strip.getByRole('button',{name:'收起变招选择'}).click();await stable(page,base,'collapse');await page.getByRole('button',{name:'下一步',exact:true}).click();await strip.getByRole('button',{name:/^分支 2/}).waitFor();await stable(page,base,'next reveals');
 const grip=await strip.getByRole('button',{name:'拖动分支选择'}).boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(18,90,{steps:5});await page.mouse.up();await stable(page,base,'drag');
 const dragged=await strip.boundingBox();assert(dragged.y>=0&&dragged.x>=0&&dragged.x+dragged.width<=viewport.width+1&&dragged.y+dragged.height<=viewport.height+1,'drag remains in viewport');
 await strip.getByRole('button',{name:/^分支 2/}).click();await page.locator('.recording-title b').getByText('录谱 1/1',{exact:true}).waitFor();await stable(page,base,'choose fork');assert.equal(await strip.count(),0,'leaf hides card');
 await page.getByRole('button',{name:'上一步',exact:true}).click();await strip.getByRole('button',{name:/^分支 2/}).waitFor();await stable(page,base,'return reopens fork');
 const afterNavigation=await strip.boundingBox();assert(Math.abs(afterNavigation.x-dragged.x)<=1&&Math.abs(afterNavigation.y-dragged.y)<=1,'navigation retains dragged position');
 await open(10);await strip.getByRole('button',{name:/^分支 10/}).waitFor();await stable(page,base,'ten branches');
 assert(await strip.locator('.manual-branch-choices').evaluate(el=>el.scrollHeight>el.clientHeight),'long choice list scrolls internally');
 await strip.getByRole('button',{name:/^分支 10/}).scrollIntoViewIfNeeded();await strip.getByRole('button',{name:/^分支 10/}).click();await page.locator('.recording-title b').getByText('录谱 1/1',{exact:true}).waitFor();await stable(page,base,'last branch remains clickable');
 await page.screenshot({path:output+`/mobile-${viewport.width}x${viewport.height}.png`});
 }
 assert.deepEqual(errors,[]);console.log('PASS mobile overlay: 0/1/2/10 choices; six portrait buttons and landscape 3x2; main board/tool geometry <=1px; auto open/collapse/reveal/drag/preserve-position; safe bounds and internal scroll');
 await page.close();page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/chessdb.php**',r=>r.fulfill({body:'status:unknown'}));await page.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
 await page.goto(process.env.DESKTOP_URL||'http://127.0.0.1:1421');await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});
 const desktopStrip=page.getByRole('navigation',{name:'当前局面分支'});
 const deskRect=()=>page.evaluate(()=>Object.fromEntries(['.board-main-stack .board','.board-main-stack','.board-stage'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return[selector,{x:r.x,y:r.y,width:r.width,height:r.height}];})));
 for(const theme of ['compact','studio']){
 await page.evaluate(theme=>{localStorage.setItem('xiangqi:workspace-layout',theme);localStorage.setItem('xiangqi:color-theme',theme==='compact'?'light':'dark');},theme);
 let base;
 for(const count of [0,1,2,10]){
 await page.evaluate(async({fen,moves,count})=>{const source=await(await fetch('/src/App.tsx')).text();const {chessPlatform:p}=await import(source.match(/from \"(\/src\/platform\/index\.ts[^\"]*)\"/)[1]);await p.newGame(fen,'悬浮布局验收');for(const move of moves.slice(0,count)){await p.playMove(move);await p.navigateTo();}}, {fen,moves:firstMoves,count});
 await page.reload();await page.getByText('离线棋谱已就绪',{exact:true}).waitFor({state:'attached'});await page.waitForTimeout(150);
 const current=await deskRect();if(!base)base=current;else for(const selector of Object.keys(base))for(const key of ['x','y','width','height'])assert(Math.abs(current[selector][key]-base[selector][key])<=1,`desktop ${theme}/${count}: ${selector} ${key} changed`);
 if(count===0){assert.equal(await desktopStrip.count(),0);continue;}
 if(count===1){await desktopStrip.getByRole('button',{name:/^继续：/}).waitFor();continue;}
 await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();assert.equal(await page.locator('[data-testid=branch-picker]').count(),0,'only one picker exists');
 await desktopStrip.getByRole('button',{name:'收起变招选择'}).click();await page.getByRole('button',{name:'下一着（选择变招）',exact:true}).first().click();await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();
 await desktopStrip.getByRole('button',{name:'管理变招'}).click();await page.getByRole('dialog',{name:'当前分支选择',exact:true}).waitFor();assert.equal(await desktopStrip.count(),0,'editor replaces selection');await page.getByRole('button',{name:'关闭变招选择',exact:true}).click();
 await page.getByRole('button',{name:'下一着（选择变招）',exact:true}).first().click();await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();
 await page.getByRole('button',{name:'自由推演',exact:true}).click();await page.getByRole('complementary',{name:'小棋盘推演',exact:true}).waitFor();assert.equal(await desktopStrip.count(),0,'expanded small board hides choices');await page.getByRole('button',{name:'关闭小棋盘',exact:true}).click();await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();
 const beforeResize=await deskRect();const grip=await desktopStrip.getByRole('button',{name:'拖动分支选择'}).boundingBox();await page.mouse.move(grip.x+8,grip.y+8);await page.mouse.down();await page.mouse.move(100,100,{steps:5});await page.mouse.up();
 assert.deepEqual(await deskRect(),beforeResize);await page.screenshot({path:output+`/desktop-${theme}-${count}.png`});
 }
 }
 const desktopUrl=process.env.DESKTOP_URL||'http://127.0.0.1:1421';
 await page.goto(desktopUrl+'/?floatingPanel=manual');
 await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();
 await desktopStrip.getByRole('button',{name:'收起变招选择'}).click();
 await page.getByRole('button',{name:'下一着（选择变招）',exact:true}).click();
 await desktopStrip.getByRole('button',{name:/^分支 2/}).waitFor();
 await page.goto(desktopUrl+'/?floatingPanel=engine');
 await page.locator('.floating-engine-body').waitFor();await page.waitForTimeout(200);
 assert.equal(await desktopStrip.count(),0,'engine-only window must not acquire manual branch selection');
 assert.deepEqual(errors,[]);console.log('PASS desktop overlay: compact/professional 0/1/2/10 branches, geometry <=1px, next uses one picker, managed editor and mini-board suppression, draggable card');
}catch(error){if(page){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});fs.writeFileSync(output+'/failure.txt',await page.locator('body').innerText());}throw error;}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
