const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fixture=require('./catalog-mate-fixtures.cjs');
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{for(const width of [320,390,430,1024]){
 const page=await browser.newPage({viewport:{width,height:width===390?844:768},hasTouch:true});page.setDefaultTimeout(6000);const sessions=new Map();let creates=0,saves=0;
 const problems=Array.from({length:50},(_,i)=>({id:`group-p${i+1}`,libraryId:'lib',sourceIndex:i%20,title:`第 ${i%20+1} 题 · 导航练习`,startingFen:fen,sideToMove:'red',solutionLength:1,solution:[{iccs:'b0c2',children:[]}],trainingGoal:{kind:'mate',solverSide:'w',mateMoves:2},verifiedMateMoves:2}));
 await page.addInitScript(()=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async route=>{const r=route.request(),u=new URL(r.url()),p=u.pathname;let body=fixture.responseFor(u);
 if(width===320&&p.endsWith('/teaching-catalog/browse'))body={...body,mateStepCounts:[{mateMoves:2,itemCount:501}]};
 if(p.includes('/teaching-catalog/')&&p.endsWith('/problems'))body={items:problems,nextCursor:width===320||width===430?"more-page":null};
 else if(p.endsWith('/practice/sessions')&&r.method()==='POST'){const payload=r.postDataJSON();assert(payload.problemIds.length<=20);creates++;body={id:`group-session-${creates}`,mode:'solver',sourceKind:'random',status:'active',items:payload.problemIds.map((id,i)=>({id:`item-${creates}-${id}`,ordinal:i,status:'pending',problem:problems.find(p=>p.id===id)}))};sessions.set(body.id,body);}
 else if(p.includes('/practice/sessions/')){const id=p.split('/practice/sessions/')[1].split('/')[0];body=sessions.get(id);if(r.method()!=='GET')saves++;}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{});
 });
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1478')+'/library');await page.getByRole('button',{name:/^基础杀法.*可练题/}).click();
 const cards=page.locator('.catalog-problem-card');await cards.nth(21).waitFor();await cards.nth(21).locator('button').first().click();
 await page.locator('.mobile-solver-page').waitFor();await page.locator('.mobile-problem-navigator-trigger').click();
 assert.match(await page.locator('.mobile-problem-navigator header small').first().textContent(),new RegExp(`第 2 组 / ${width===430?"已加载":"共"} ${width===320?26:3} 组 · ${width===430?"已加载":"共"} ${width===320?501:50} 题`));
 assert.match(await page.locator('.mobile-problem-navigator header small').nth(1).textContent(),/本组已完成 0\/20/);
 const summary=await page.locator('.mobile-problem-navigator header small').first().boundingBox(),close=await page.locator('.mobile-problem-navigator header button').boundingBox();assert(summary.x+summary.width<=close.x-4);assert(close.width>=43);
 let grid=page.locator('.mobile-problem-navigator-grid');await grid.getByRole('listitem',{name:/第 22 题：/}).waitFor();
 assert.equal(await grid.locator('button').first().textContent(),'21');assert.equal(await grid.locator('button').last().textContent(),'40');
 await grid.getByRole('listitem',{name:/第 21 题：/}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 21 题'}).waitFor();
 await page.locator('.mobile-problem-navigator-trigger').click();await page.getByRole('button',{name:'下一组',exact:true}).click();
 await page.locator('.mobile-solver-heading strong').filter({hasText:'第 41 题'}).waitFor();await page.locator('.mobile-problem-navigator-trigger').click();
 assert.match(await page.locator('.mobile-problem-navigator header small').first().textContent(),new RegExp(`第 3 组 / ${width===430?"已加载":"共"} ${width===320?26:3} 组 · ${width===430?"已加载":"共"} ${width===320?501:50} 题`));
 assert.match(await page.locator('.mobile-problem-navigator header small').nth(1).textContent(),/本组已完成 0\/10/);
 assert.equal(await grid.locator('button').first().textContent(),'41');assert.equal(await grid.locator('button').last().textContent(),'50');assert.equal(await page.getByRole('button',{name:'下一组',exact:true}).count(),0);
 await page.getByRole('button',{name:'上一组',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 21 题'}).waitFor();assert.equal(creates,2,'Return to the same group reuses its session');assert(saves>0,'Switching groups persists current progress');
 await page.getByRole('button',{name:'上一题',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 20 题'}).waitFor();
 await page.getByRole('button',{name:'下一题',exact:true}).click();await page.locator('.mobile-solver-heading strong').filter({hasText:'第 21 题'}).waitFor();assert.equal(creates,3);
 await page.locator('.mobile-problem-navigator-trigger').click();const fs=require('node:fs');fs.mkdirSync('artifacts/practice-latency-20261025',{recursive:true});await page.screenshot({path:`artifacts/practice-latency-20261025/group-${process.env.TEST_WEBKIT?'webkit':'chromium'}-${width}.png`});
 console.log('PASS current/total groups, 21/22 numbering, 41–50 group, previous-group session reuse',width);await page.close();
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
