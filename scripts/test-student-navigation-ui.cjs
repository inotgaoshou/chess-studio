const assert = require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.LIBRARY_URL||'http://127.0.0.1:1446';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
 const topic={id:'topic',name:'验收专题',contentKind:'problem',itemCount:1,sources:[],description:'专题说明'};
 const node={id:'chapter',teachingEntry:'basic_mates',name:'验收章节',kind:'chapter',active:true,confirmed:true,itemCount:1,completedCount:0,materialCount:0,rehearsalCount:0,displayOrder:0};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');});
 await page.route('**/api/v1/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;requests.push(u);let body=[];
  if(path.endsWith('/auth/refresh'))body={token:'student',expiresAt:'2099-01-01T00:00:00Z',user:{id:'student',orgId:'school',role:'student',organizations:[]}};
  else if(path.endsWith('/practice/dashboard'))body={topics:[topic],studyTopics:[],history:[]};
  else if(path.endsWith('/practice/topics/topic')){await new Promise(r=>setTimeout(r,500));body={...topic,chapters:[]};}
  else if(path.endsWith('/teaching-catalog/browse')){await new Promise(r=>setTimeout(r,350));const inside=u.searchParams.has('nodeId');body={statisticsReady:false,statisticsRevision:'2',availabilitySnapshotRevision:'1',statisticsSnapshotRevision:'1',currentNode:inside?node:null,breadcrumbs:inside?[node]:[],children:inside?[]:[node],learningMaterials:[]};}
  else if(path.includes('/teaching-catalog/')&&path.endsWith('/problems'))body={items:[],nextCursor:null};
  await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(url+'/library');await page.getByRole('button',{name:/验收章节/}).waitFor();
 await page.getByRole('button',{name:/验收章节/}).click();
 assert(await page.getByRole('heading',{name:'验收章节',exact:true}).isVisible(),'opening a new directory must retain its known title immediately');
 await page.getByRole('button',{name:'返回上级',exact:true}).waitFor();
 await page.getByRole('button',{name:'返回上级',exact:true}).click();
 assert(await page.getByRole('button',{name:/验收章节/}).isVisible(),'returning to a visited directory must render cached content immediately');
 assert(requests.filter(u=>u.pathname.endsWith('/teaching-catalog/browse')).every(u=>u.searchParams.get('allowStaleCounts')==='true'),'student navigation must request compatible historical counts');
 await page.getByRole('button',{name:'练习',exact:true}).click();await page.getByRole('button',{name:/验收专题/}).click();
 await page.getByRole('button',{name:'开始训练',exact:false}).waitFor();
 await page.getByRole('button',{name:'返回练习',exact:true}).click();await page.getByRole('button',{name:/验收专题/}).click();
 assert(await page.getByRole('button',{name:'开始训练',exact:false}).isVisible(),'returning to topic must retain content while refreshing');
 assert.deepEqual(errors,[]);console.log('PASS cached directory/topic return, stale counts opt-in, student navigation');
 await page.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
