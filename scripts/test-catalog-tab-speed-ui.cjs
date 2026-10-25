// Real catalog component with a delayed read: revisiting a loaded tab must not blank it.
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fixture=require('./catalog-mate-fixtures.cjs');
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(6000);let hold=false;const held=[];
 await page.route('**/api/v1/**',async route=>{const u=new URL(route.request().url());const body=fixture.responseFor(u);
 if(u.pathname.includes('/teaching-catalog/')&&u.pathname.endsWith('/problems')&&u.searchParams.get('mateMoves')==='2'){if(u.searchParams.has('cursor')){body.items=[{...body.items[0],id:'page-two',title:'第二页题'}];body.nextCursor=null;}else body.nextCursor='second';}
 if(u.pathname.includes('/teaching-catalog/')&&u.pathname.endsWith('/problems')&&hold&&u.searchParams.get('mateMoves')==='2'){held.push(()=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)}).catch(()=>{}));return;}
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1478')+'/library');
 await page.evaluate(async auth=>{const React=(await import('/node_modules/.vite/deps/react.js')).default,dom=await import('/node_modules/.vite/deps/react-dom_client.js'),{TeachingCatalog}=await import('/src/TeachingCatalog.tsx'),{teachingClient}=await import('/src/teaching.ts');await teachingClient.login('fixture','fixture');const host=document.createElement('div');host.id='speed-harness';host.style='position:fixed;inset:0;overflow:auto;background:white;z-index:9999';document.body.append(host);(dom.createRoot||dom.default.createRoot)(host).render(React.createElement(TeachingCatalog,{auth,scene:'browse',compact:true}));},fixture.auth);
 const cat=page.locator('#speed-harness');
 await cat.getByRole('button',{name:/^基础杀法.*可练题/}).click();await cat.getByText('第 1 题 · 2步验证题',{exact:true}).waitFor();
 await cat.getByRole('button',{name:'加载更多题目',exact:true}).click();await cat.getByText('第 2 题 · 第二页题',{exact:true}).waitFor();
 await cat.getByRole('tab',{name:'一步杀',exact:true}).click();await cat.getByText('暂无匹配题目',{exact:true}).waitFor();
 hold=true;const start=Date.now();await cat.getByRole('tab',{name:'两步杀',exact:true}).click();
 await cat.getByText('第 1 题 · 2步验证题',{exact:true}).waitFor({timeout:400});
 const elapsed=Date.now()-start;assert(elapsed<500,'Revisited tab must render without waiting for its refresh');
 assert.equal(await cat.locator('.catalog-problem-card').count(),1,'Tab return resets to its cached first page');
 await cat.getByRole('tab',{name:'四步杀',exact:true}).click();await cat.getByText('第 1 题 · 4步验证题',{exact:true}).waitFor();
 for(const release of held)await release();await page.waitForTimeout(50);assert.equal(await cat.getByText('第 1 题 · 2步验证题',{exact:true}).count(),0,'Late refresh cannot replace another tab');console.log('PASS cached tab visible while fresh read is pending',elapsed+'ms');
 await page.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
