// Teacher assignment wizard regression with current paginated catalog API fixtures.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.CATALOG_URL||'http://127.0.0.1:1452';
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const problem=i=>({id:'p'+i,libraryId:'library',sourceIndex:i,title:'题目'+i,category:'中局',startingFen:fen,solutionLength:1,sideToMove:'w',reviewStatus:'published',validationStatus:'ready',contentFingerprint:'hash'+i,trainingGoal:{kind:['gain_material','draw','endgame_win'][i%3],description:'审核目标'+i,solverSide:'w',reviewMethod:'reviewed_solution'}});
const nodes=[{id:'root',name:'中局',parentId:null,itemCount:30,completedCount:3},{id:'a',name:'运子章节',parentId:'root',itemCount:25,completedCount:2},{id:'b',name:'组合章节',parentId:'root',itemCount:10,completedCount:1}].map(n=>({...n,kind:'chapter',active:true,confirmed:true,displayOrder:0}));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
  const page=await browser.newPage({viewport});const created=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
  const user={id:'teacher',orgId:'school',orgName:'隔离学校',role:'coach',displayName:'验收老师',loginName:'teacher',organizations:[{id:'school',name:'隔离学校',role:'coach'}]};
  await page.route('**/api/v1/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;let body=[];
   if(path.endsWith('/auth/refresh'))body={token:'school',expiresAt:'2099-01-01T00:00:00Z',user};
   else if(path.endsWith('/admin/classes'))body=[{id:'class',name:'测试班',studentCount:1}];
   else if(path.endsWith('/students'))body=[{id:'student',displayName:'测试学生',loginName:'student'}];
   else if(path.endsWith('/folder-tree'))body=[];
   else if(path.endsWith('/problem-libraries'))body=[{id:'library',title:'来源库',publishedCount:30,reviewStatus:'published'}];
   else if(path.endsWith('/teaching-catalog/browse')){const id=u.searchParams.get('nodeId'),current=nodes.find(n=>n.id===id);body={currentNode:current||null,breadcrumbs:current?current.id==='root'?[current]:[nodes[0],current]:[],children:!id?[nodes[0]]:id==='root'?nodes.slice(1):[],learningMaterials:[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};}
   else if(path.endsWith('/teaching-catalog'))body=nodes;
   else if(path.includes('/teaching-catalog/')&&path.endsWith('/problems')){const id=path.split('/').at(-2),offset=Number(u.searchParams.get('cursor')||0),limit=Number(u.searchParams.get('limit')||50);const all=Array.from({length:id==='b'?10:25},(_,i)=>problem(i+(id==='b'?20:0)));body={items:all.slice(offset,offset+limit),nextCursor:offset+limit<all.length?String(offset+limit):null};}
   else if(path.endsWith('/admin/assignments')&&req.method()==='POST'){const input=req.postDataJSON();created.push(input);body={id:'new'+created.length,status:'draft',...input};}
   else if(path.endsWith('/publish'))body={id:path.split('/').at(-2),status:'published'};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(url+'/teacher');await page.getByText('验收老师',{exact:true}).waitFor();
  await page.getByRole('button',{name:/^布置作业/}).click();await page.getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('textbox',{name:'作业标题',exact:true}).fill('目录验收');
  await page.getByRole('button',{name:/中局.*可布置/}).click();await page.getByRole('button',{name:/运子章节.*可布置/}).click();await page.getByRole('button',{name:'选择当前章节/筛选的全部题目'}).click();
  await page.getByRole('button',{name:'› 中局',exact:true}).click();await page.getByRole('button',{name:/组合章节.*可布置/}).click();await page.getByRole('button',{name:'选择当前章节/筛选的全部题目'}).click();
  await page.getByText('已选题目（30 题，重复题只保留一次）',{exact:true}).waitFor();
  await page.getByRole('button',{name:'下移 题目0',exact:true}).click();
  const radio=page.getByRole('radio',{name:'自定义题数',exact:true});await radio.check();await page.getByRole('spinbutton',{name:'每批题数',exact:true}).fill('20');
  await page.getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('checkbox',{name:/测试班/}).check();await page.getByRole('button',{name:'下一步',exact:true}).click();
  assert.equal(await page.locator('.catalog-batch-preview details').count(),2);await page.locator('.catalog-batch-preview summary').first().click();assert.equal(await page.locator('.catalog-batch-preview details').first().locator('li').count(),20);
  assert.equal(await page.locator('.teacher-mobile-page').evaluate(n=>n.scrollWidth>n.clientWidth+2),false,'phone/tablet must not overflow');
  await page.getByRole('button',{name:'立即发布',exact:true}).click();await page.locator('.teacher-mobile-wizard').waitFor({state:'detached'});
  assert.deepEqual(created.map(p=>p.problemIds.length),[20,10]);assert.deepEqual(created[0].problemIds.slice(0,2),['p1','p0']);assert.equal(new Set(created.flatMap(p=>p.problemIds)).size,30);assert.equal(created[0].expectedProblemVersions.p1,'hash1');assert(created.every(p=>p.libraryIds.length===0));assert.deepEqual(errors,[]);
  await page.close();console.log('PASS assignment wizard '+viewport.width+': cross-chapter selection, de-duplication, order, batch sizes, publication payload');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
