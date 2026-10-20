// Browser fault/ordering tests; real MySQL and native-device gates run separately.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.PRACTICE_URL || 'http://127.0.0.1:1448';
(async () => {
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  const page = await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(8000);
  const errors=[], reads=[], held=[];let fail=false, downloadMode='hang';
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
   localStorage.setItem('xiangqi-teaching-session-server','https://api-test.qixiapp.cn');
   const original=window.fetch;window.fetch=async (...args)=>{
    const response=await original(...args);
    if(window.hangDownloadBody && String(args[0]).includes('downloads.test')) response.arrayBuffer=()=>new Promise(()=>{});
    if(window.hangCloudBody && String(args[0]).includes('chessdb.cn')) response.text=()=>new Promise(()=>{});
    return response;
   };
  });
  await page.route('**/api/v1/**',async route=>{
   const u=new URL(route.request().url()),p=u.pathname;let body=[];
   if(p.endsWith('/auth/refresh')) body={token:'teacher',expiresAt:'2099-01-01T00:00:00Z',user:{id:'teacher',orgId:'school',role:'coach',displayName:'验收老师'}};
   else if(p.endsWith('/capabilities'))body={};
   else if(p.endsWith('/browse')) body={children:[],breadcrumbs:[],learningMaterials:[],statisticsReady:true,statisticsRevision:1,availabilitySnapshotRevision:1};
   else if(p.endsWith('/problem-library-categories')) body=[{code:'B',libraryCount:51},{code:'C',libraryCount:1},{code:'J',libraryCount:1},{code:'other',libraryCount:1}];
   else if(p.endsWith('/problem-libraries')) throw new Error('Visible teacher library must not fetch the full list');
   else if(p.endsWith('/problem-libraries/page')) {
    reads.push(u.search);const q=u.searchParams.get('q'),cat=u.searchParams.get('category');
    assert.equal(u.searchParams.get('publishedOnly'),'true');
    if(q==='慢'){held.push(route);return;}
    if(fail){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'临时题库故障'})});return;}
    const item=(id,title)=>({id,title,publishedCount:3,reviewStatus:'published',folderPath:cat+' 分类/章节'});
    body={items:q?[item('search','尾页独有搜索结果')]:cat==='B'?(u.searchParams.has('cursor')?[item('b0','中局0'),item('b50','中局50')]:Array.from({length:50},(_,i)=>item('b'+i,'中局'+i))):[item(cat,cat==='C'?'后页独有残局':cat==='J'?'飞刀书':'未知来源')],nextCursor:!q&&cat==='B'&&!u.searchParams.has('cursor')?'page2':null};
   }
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.route('https://downloads.test/**',async route=>{
   if(downloadMode==='hang'){held.push(route);return;}
   await route.fulfill({contentType:'application/octet-stream',body:Buffer.from([0,1,2,3])});
  });
  await page.route('https://www.chessdb.cn/**',route=>route.fulfill({contentType:'text/plain',body:'unknown'}));
  await page.goto(base+'/library');const source=page.locator('.teacher-source-libraries');
  await source.getByText('中局0',{exact:true}).waitFor();assert.equal(await source.locator('.mobile-library-list > button').count(),50);
  await source.getByRole('button',{name:'加载更多题库',exact:true}).click();await source.getByText('中局50',{exact:true}).waitFor();
  assert.equal(await source.locator('.mobile-library-list > button').count(),51,'deduplicate page overlap without losing page 2');
  await source.getByRole('tab',{name:'C 残局',exact:true}).click();await source.getByText('后页独有残局',{exact:true}).waitFor();
  const count=reads.length;await source.getByRole('tab',{name:'C 残局',exact:true}).click();await page.waitForTimeout(100);assert.equal(reads.length,count);
  await page.clock.install();const search=page.getByRole('textbox',{name:'搜索题库',exact:true});
  const slow=page.waitForRequest(r=>new URL(r.url()).searchParams.get('q')==='慢');await search.fill('慢');await page.clock.runFor(250);await slow;
  await search.fill('尾页');await page.clock.runFor(250);await source.getByText('尾页独有搜索结果',{exact:true}).waitFor();
  await held.shift().fulfill({contentType:'application/json',body:JSON.stringify({items:[{id:'late',title:'迟到的错误结果'}]})}).catch(()=>{});
  assert.equal(await source.getByText('迟到的错误结果').count(),0);
  await search.fill('');await page.clock.runFor(250);await source.getByText('后页独有残局',{exact:true}).waitFor();
  await source.getByRole('button',{name:'更多分类',exact:true}).click();await source.getByRole('tab',{name:'other 其他',exact:true}).click();await source.getByText('未知来源',{exact:true}).waitFor();
  fail=true;await source.getByRole('tab',{name:'J 飞刀',exact:true}).click();await source.getByRole('alert').filter({hasText:'临时题库故障'}).waitFor();
  fail=false;await source.getByRole('button',{name:'重试题库加载',exact:true}).click();await source.getByText('飞刀书',{exact:true}).waitFor();
  console.log('teacher library: real App wiring, global facets/search, 51 sources, deduplication, ordering, unknown category, explicit retry passed');
  await page.locator('.mobile-heading-icon[aria-label="导入 CBL 题库"]').click();
  const panel=page.getByRole('dialog',{name:'导入 CBL'});await panel.locator('input[inputmode=url]').fill('https://downloads.test/book.cbl');
  const download=page.waitForRequest('https://downloads.test/book.cbl');await panel.getByRole('button',{name:'下载导入',exact:true}).click();await download;
  await page.clock.runFor(15100);await panel.getByText(/CBL 下载超时/).waitFor();assert(await panel.getByRole('button',{name:'下载导入',exact:true}).isEnabled());
  await held.shift().fulfill({contentType:'application/octet-stream',body:Buffer.from([0,1,2,3])}).catch(()=>{});
  assert.equal(await panel.count(),1,'late download must not import or navigate');
  downloadMode='body';await page.evaluate(()=>window.hangDownloadBody=true);
  const retry=page.waitForResponse('https://downloads.test/book.cbl');await panel.getByRole('button',{name:'下载导入',exact:true}).click();await retry;await page.waitForTimeout(50);
  await page.clock.runFor(15100);await panel.getByText(/CBL 下载超时/).waitFor();
  await panel.getByRole('button',{name:'返回棋析',exact:true}).click();
  const cloudResponse=page.waitForResponse(r=>r.url().includes('chessdb.cn'));
  await page.evaluate(async()=>{
   window.hangCloudBody=true;window.cloudResult='pending';
   const wasm=await import('/src/wasm.ts');wasm.queryCloudBook('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1').then(()=>window.cloudResult='unexpected').catch(e=>window.cloudResult=e.message);
  });
  await cloudResponse;await page.waitForTimeout(50);await page.clock.runFor(15100);
  assert.match(await page.evaluate(()=>window.cloudResult),/云库请求超时/);
  assert.deepEqual(errors,[]);console.log('CBL URL and cloud book: stalled headers/body release loading; late downloads ignored');
  await page.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
