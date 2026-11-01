const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fixture=require('./catalog-mate-fixtures.cjs');
const {checkStickyNumbers,checkUncoveredCard}=require('./catalog-sticky-numbers.cjs');
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:true});page.setDefaultTimeout(7000);const sessions=new Map();let creates=0,saves=0,reads=0;
 const problems=Array.from({length:131},(_,i)=>({id:`group-p${i+1}`,libraryId:'lib',sourceIndex:i%20,title:i<3?`第 ${i%20+1} 题`:`第 ${i%20+1} 题 · 导航练习`,startingFen:fen,sideToMove:'red',solutionLength:1,solution:[{iccs:'b0c2',children:[]}],trainingGoal:{kind:'mate',solverSide:'w',mateMoves:2},verifiedMateMoves:2}));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname;let body=fixture.responseFor(u);
 if(p.endsWith('/teaching-catalog/browse'))body={...body,mateStepCounts:[{mateMoves:2,itemCount:131}]};
 if(p.includes('/teaching-catalog/')&&p.endsWith('/problems')){reads++;const start=Number(u.searchParams.get('cursor')||0);body={items:problems.slice(start,start+50),nextCursor:start+50<problems.length?String(start+50):null};}
 else if(p.endsWith('/practice/sessions')&&r.method()==='POST'){const payload=r.postDataJSON();assert.equal(payload.problemIds.length,25);assert.equal(payload.count,25);creates++;body={id:`group-session-${creates}`,mode:'solver',sourceKind:'random',status:'active',items:payload.problemIds.map((id,i)=>({id:`item-${creates}-${id}`,ordinal:i,status:id==='group-p27'||id==='group-p29'?'completed':id==='group-p28'?'revealed':'pending',verificationState:id==='group-p29'?'pending_server':undefined,problem:problems.find(p=>p.id===id)}))};sessions.set(body.id,body);}
 else if(p.includes('/practice/sessions/')){const id=p.split('/practice/sessions/')[1].split('/')[0];body=sessions.get(id);if(r.method()!=='GET')saves++;}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
 });
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/library');await page.getByRole('button',{name:/^基础杀法.*可练题/}).click();
 const cards=page.locator('.catalog-problem-card'),outer=page.getByRole('navigation',{name:'题库数字导航'});await page.getByRole('tab',{name:'两步杀',exact:true}).and(page.locator('[aria-selected="true"]')).waitFor();await page.waitForFunction(()=>document.querySelectorAll('.catalog-problem-card').length===50&&document.querySelector('.teaching-catalog')?.getAttribute('aria-busy')==='false');
 assert.equal(await cards.count(),50);await checkStickyNumbers(page);
 assert.equal(await outer.locator('.practice-question-number-grid button').count(),25);
 assert.match(await outer.textContent(),/第 1 页 \/ 共 3 页/);assert.match(await outer.textContent(),/共 131 题 · 共 6 组 · 每组 25 题/);
 await outer.getByRole('button',{name:'第 2 组 · 25 题',exact:true}).click();
 await outer.getByRole('button',{name:'跳到第 30 题',exact:true}).click();await checkUncoveredCard(page,29);assert.equal(creates,0);
 const numbersFit=await outer.locator('.practice-question-number-grid button > span').evaluateAll(spans=>spans.every(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1));assert(numbersFit);
 await outer.getByRole('button',{name:'下一页',exact:true}).click();await outer.getByRole('button',{name:'跳到第 51 题',exact:true}).waitFor();
 assert.equal(await cards.count(),50);assert.match(await cards.first().locator('strong').textContent(),/^第 51 题/);assert.match(await cards.last().locator('strong').textContent(),/^第 100 题/);
 await outer.getByRole('button',{name:'下一页',exact:true}).click();await outer.getByRole('button',{name:'第 6 组 · 6 题',exact:true}).click();
 await outer.getByRole('button',{name:'跳到第 131 题',exact:true}).waitFor();assert.equal(await cards.count(),31);assert(await outer.getByRole('button',{name:'下一页',exact:true}).isDisabled());
 const loadedReads=reads;await outer.getByRole('button',{name:'上一页',exact:true}).click();await outer.getByRole('button',{name:'上一页',exact:true}).click();
 await outer.getByRole('button',{name:'第 2 组 · 25 题',exact:true}).click();assert.equal(reads,loadedReads,'cached previous pages do not reread');
 await outer.getByRole('button',{name:'跳到第 27 题',exact:true}).click();await checkUncoveredCard(page,26);
 const fs=require('node:fs');fs.mkdirSync('artifacts/practice-navigation-10135',{recursive:true});await page.screenshot({path:`artifacts/practice-navigation-10135/catalog-${process.env.TEST_WEBKIT?'webkit':'chromium'}-${width}x${height}.png`});
 await cards.nth(26).locator('button').first().click();await page.locator('.mobile-solver-page').waitFor();
 assert.equal(await outer.count(),0);await page.locator('.mobile-problem-navigator-trigger').click();
 assert.match(await page.locator('.mobile-problem-navigator header small').first().textContent(),/第 2 组 \/ 共 6 组 · 共 131 题/);
 assert.match(await page.locator('.mobile-problem-navigator header small').nth(1).textContent(),/本组已完成 1\/25/);
 const grid=page.locator('.mobile-problem-navigator-grid');assert.equal(await grid.locator('button').count(),25);assert.equal(await grid.locator('button').first().textContent(),'26');assert.equal(await grid.locator('button').last().textContent(),'50');assert.equal(await grid.locator('button.revealed .problem-number-status').textContent(),'阅');assert.equal(await grid.locator('button.verifying .problem-number-status').textContent(),'…');
 await page.getByRole('button',{name:'下一组',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 51 题'}).waitFor();await page.locator('.mobile-problem-navigator-trigger').click();
 assert.match(await page.locator('.mobile-problem-navigator header small').first().textContent(),/第 3 组 \/ 共 6 组/);
 await page.getByRole('button',{name:'上一组',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 26 题'}).waitFor();assert.equal(creates,2);assert(saves>0);
 await page.getByRole('button',{name:'上一题',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 25 题'}).waitFor();
 await page.getByRole('button',{name:'下一题',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 26 题'}).waitFor();assert.equal(creates,3);
 await page.screenshot({path:`artifacts/practice-navigation-10135/solver-${process.env.TEST_WEBKIT?'webkit':'chromium'}-${width}x${height}.png`});
 console.log('PASS frozen navigation, 50/page, 25/group, partial last page/group, cached previous pages, session reuse',width);await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
