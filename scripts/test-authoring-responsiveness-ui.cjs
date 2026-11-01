// Real application/browser regression with intercepted fixture APIs; no production writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=process.env.OUTPUT_DIR||'/tmp/qixi-authoring-responsive-browser';
const base='/api/v1/admin/authoring';
const fen='4k4/3R5/R3P4/9/9/9/9/9/9/4K4 w - - 0 1';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 fs.mkdirSync(output,{recursive:true});const results=[];
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,...(name==="chromium"?{channel:"chrome"}:{})});
  try{
   for(const viewport of [{width:320,height:740},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:820,height:1180},{width:1180,height:820},{width:1440,height:900}]){
    const admin=viewport.width===1440;
    const page=await browser.newPage({viewport,isMobile:!admin,hasTouch:!admin});page.setDefaultTimeout(12000);
    const errors=[],calls=[];page.on('pageerror',error=>errors.push(error.message));
    const user={id:'responsive-teacher',orgId:'responsive-org',orgName:'响应验收机构',role:'coach',displayName:'验收老师',loginName:'fixture',organizations:[],classes:[],isPlatformAdmin:false,vipEnabled:true,vipActive:true,createdAt:'2026-10-01T00:00:00Z'};
    const directory={id:'d',title:'响应验收目录',revision:1,sortOrder:0,canEdit:true,itemCount:0,publishedCount:0,draftCount:0,items:[]};
    const dirs=[directory];let createdAt=0,deletedAt=0,deleteRefresh=false,listReads=0,countsStarted=false;
    await page.addInitScript(()=>{
     localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
     localStorage.setItem('xiangqi-teaching-environment','production');
     localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');
     sessionStorage.setItem('xiangqi-admin-workspace',JSON.stringify({activeView:'authoring',tabs:[{view:'home',label:'首页'},{view:'authoring',label:'机构题库'}]}));
    });
    const source=i=>({id:'p'+i,title:'验收题目 '+i,fen,category:'杀棋',duplicateKey:'key'+i,alreadyAdded:i===0});
    await page.route('**/api/v1/**',async route=>{
     const req=route.request(),url=new URL(req.url()),path=url.pathname;calls.push({path,query:url.search,method:req.method()});
     let body=[],status=200;
     if(path.endsWith('/auth/refresh'))body={token:'fixture-only',expiresAt:'2099-01-01T00:00:00Z',user};
     else if(path.endsWith('/auth/me'))body=user;
     else if(path.endsWith('/capabilities'))body={};
     else if(path===base+'/directories'){
      if(req.method()==='POST'){
       const payload=req.postDataJSON();const summary={...directory,id:payload.id,title:payload.title,sortOrder:1,itemCount:12};dirs.push(summary);createdAt=Date.now();body={id:summary.id,directory:summary};
      }else{
       listReads++;
       if(listReads===2){await pause(1400);status=503;body={error:'验收刷新延迟'};}
       else if(deletedAt&&!deleteRefresh){deleteRefresh=true;await pause(1400);status=503;body={error:'删除后刷新延迟'};}
       else body={items:dirs};
      }
     }else if(path.startsWith(base+'/directories/')&&req.method()==='DELETE'){
      const index=dirs.findIndex(dir=>dir.id===path.split('/').at(-1));assert(index>=0);assert.equal(req.postDataJSON().removeItems,true);
      assert.equal(req.postDataJSON().expectedRevision,dirs[index].revision);
      dirs.splice(index,1);await pause(80);deletedAt=Date.now();body={ok:true};
     }else if(path===base+'/directories/d'){
      if(req.method()==='PATCH'){
       directory.revision++;directory.items=req.postDataJSON().items.map(item=>({id:item.subjectId,subjectId:item.subjectId,kind:item.kind,status:'source',canEdit:false,body:{title:'验收题目 '+item.subjectId.slice(1),startingFen:fen,note:'',solution:[]}}));body={ok:true};
      }else body=directory;
     }else if(path===base+'/source-libraries'){
      if(url.searchParams.get('view')==='counts'){countsStarted=true;await pause(1600);body={totalCount:1,publicationRevision:7,snapshotKey:'fixture-seven'};}
      else {await pause(60);body={items:[{id:'book',title:'快速响应书本',sourceScope:'平台'}],nextCursor:null,publicationRevision:7,snapshotKey:'fixture-seven',mateFilterVersion:1};}
     }else if(path===base+'/sources'){
      assert.equal(url.searchParams.get('libraryId'),'book');assert.equal(url.searchParams.get('limit'),'50');
      const after=url.searchParams.has('cursor');body={items:Array.from({length:after?13:50},(_,i)=>source(i+(after?50:0))),totalCount:63,categories:['杀棋'],nextCursor:after?null:'page-two',mateFilterVersion:1};
     }else if(path==='/api/v1/admin/teaching-catalog/browse'){
      assert.equal(url.searchParams.get('allowStaleCounts'),'true');assert.equal(url.searchParams.get('limit'),'50');
      const id=url.searchParams.get('nodeId'),counts=url.searchParams.get('view')==='counts';
      const basic={id:'basic',name:'基础杀法验收',kind:'topic',teachingEntry:'basic_mates',itemCount:counts?150:null};
      if(counts)await pause(900);
      body={currentNode:id?basic:undefined,breadcrumbs:id?[basic]:[],children:id?[{id:'chapter',name:'第一章验收',kind:'chapter',itemCount:counts?30:null}]:[basic]};
     }else if(path==='/api/v1/admin/teaching-catalog/basic/problems'){
      assert.equal(url.searchParams.get('pageOnly'),'true');assert.equal(url.searchParams.get('limit'),'50');
      const late=url.searchParams.get('mateMoves')==='4';await pause(late?1800:550);
      body={items:[{id:late?'late':'catalog-p',title:late?'过期题目不得显示':'平台题目验收',startingFen:fen,reviewStatus:'published',validationStatus:'ready'}],nextCursor:null,totalCount:null};
     }else if(path.endsWith('/classes'))body=admin?{items:[],totalCount:0}:[];
     await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)}).catch(error=>{if(!/closed|canceled|cancelled/i.test(error.message))throw error;});
    });
    const ready=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/refresh'));
    await page.goto(admin?process.env.ADMIN_URL||'http://127.0.0.1:1464':process.env.MOBILE_URL||'http://127.0.0.1:1463');
    await ready;await pause(100);
    if(!admin)await page.evaluate(()=>{history.pushState(null,'','/teacher/authoring');dispatchEvent(new PopStateEvent('popstate'));});
    await page.getByRole('button',{name:'＋ 新增目录',exact:true}).click().catch(async error=>{console.log(JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),calls}));await page.screenshot({path:output+'/failure.png'});throw error;});
    await page.getByRole('textbox',{name:'目录名称',exact:true}).fill('保存无需等刷新');
    await page.getByRole('button',{name:'保存名称',exact:true}).click();
    await page.getByRole('dialog',{name:'新增目录',exact:true}).waitFor({state:'hidden',timeout:700});
    const finishMs=Date.now()-createdAt;assert(finishMs<300,'committed save must not await 1400ms refresh: '+finishMs);
    assert(await page.getByRole('button',{name:'＋ 新增目录',exact:true}).isEnabled());
    await page.getByText(/已保存，刷新失败/).waitFor();
    await page.getByRole('button',{name:'重试刷新',exact:true}).click();
    await page.getByText(/已保存，刷新失败/).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'调整目录',exact:true}).click();
    const management=page.locator('.authoring-directories');
    assert((await management.boundingBox()).width<=viewport.width,'directory controls fit the viewport');
    await page.screenshot({path:`${output}/${name}-${viewport.width}-directories.png`});
    page.once('dialog',dialog=>dialog.accept());
    const remove=page.getByRole('button',{name:'删除目录保存无需等刷新',exact:true});
    await remove.click();await remove.waitFor({state:'hidden',timeout:700});
    const deleteFinishMs=Date.now()-deletedAt;assert(deleteFinishMs<300,'deletion must not wait for background refresh');
    await page.getByText(/已删除，刷新失败/).waitFor();
    await page.getByRole('button',{name:'重试刷新',exact:true}).click();
    await page.getByText(/已删除，刷新失败/).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'完成调整',exact:true}).click();
    const readsBefore=listReads;
    await page.getByRole('button',{name:/响应验收目录.*道已发布/}).click();
    await page.getByRole('button',{name:/添加题目/}).waitFor().catch(async error=>{console.log(JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),errors,calls}));throw error;});assert.equal(listReads,readsBefore,'opening detail must not reread all directories');
    await page.getByRole('button',{name:/添加题目/}).click();
    await page.getByRole('button',{name:'从平台／机构题库选题',exact:true}).click();
    const books=page.getByRole('dialog',{name:'选择题库／书本',exact:true});
    const book=books.getByRole('button',{name:/快速响应书本/});await book.waitFor();assert(await book.isEnabled());
    await page.waitForFunction(()=>Boolean(document.querySelector('.authoring-library-list button')));
    await pause(50);assert(countsStarted,'counts request must run separately');
    await page.screenshot({path:`${output}/${name}-${viewport.width}-books.png`});
    await book.click();
    const picker=page.getByRole('dialog',{name:'选择平台／机构题目',exact:true});
    await picker.getByText('验收题目 49',{exact:true}).waitFor();
    assert.equal(await picker.locator('.authoring-source-tile').count(),50);
    const header=await picker.locator('.authoring-picker-header').boundingBox();
    await picker.locator('.authoring-source-list').evaluate(node=>node.scrollTop=node.scrollHeight);
    const moved=await picker.locator('.authoring-picker-header').boundingBox();assert(Math.abs(header.y-moved.y)<=1);
    await picker.getByRole('button',{name:'下一页',exact:true}).click();
    await picker.getByText('验收题目 62',{exact:true}).waitFor();assert.equal(await picker.locator('.authoring-source-tile').count(),13);
    await picker.getByRole('button',{name:'全选',exact:true}).click();
    await picker.getByRole('button',{name:'确认添加（62）',exact:true}).waitFor();
    await page.screenshot({path:`${output}/${name}-${viewport.width}-selection.png`});
    await picker.getByRole('button',{name:'‹ 返回',exact:true}).click();
    await page.getByRole('dialog',{name:'选择题库／书本',exact:true}).getByRole('button',{name:'‹ 返回',exact:true}).click();
    assert.equal(calls.filter(call=>call.method==='PATCH').length,0,'returning without confirmation must not add questions');
    assert.equal(calls.filter(call=>call.method==='POST'&&call.path.includes('assignments')).length,0,'selecting must never publish an assignment');
    await page.locator('.authoring-header > button').click();
    await page.getByRole('button',{name:'平台作业库',exact:true}).click();
    await page.getByRole('button',{name:/基础杀法验收/}).click();
    await page.getByRole('button',{name:/第一章验收/}).waitFor();
    assert(await page.getByRole('button',{name:'两步杀',exact:true}).isEnabled(),'filters must stay usable during reads');
    await page.getByText('平台题目验收',{exact:true}).waitFor();
    await page.screenshot({path:`${output}/${name}-${viewport.width}-platform.png`});
    await page.getByRole('button',{name:'四步杀',exact:true}).click();
    await page.getByRole('button',{name:'‹ 返回上级',exact:true}).click();
    await page.getByRole('button',{name:/基础杀法验收/}).waitFor();
    await pause(1900);
    assert.equal(await page.getByText('过期题目不得显示',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    results.push({browser:name,viewport,host:admin?'admin':'mobile',saveFinishMs:finishMs,deleteFinishMs,pass:true});console.log(JSON.stringify(results.at(-1)));await page.close();
   }
  }finally{await browser.close();}
 }
 fs.writeFileSync(output+'/results.json',JSON.stringify(results,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});
