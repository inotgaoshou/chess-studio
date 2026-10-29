const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const url=process.env.MOBILE_URL || 'http://127.0.0.1:1479';
const output=process.env.OUTPUT_DIR || '.local/authoring-generals-10092';
const base='/api/v1/admin/authoring';
(async()=>{
 const browser=await(process.env.WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
 fs.mkdirSync(output,{recursive:true});
 try {
  for(const viewport of [{width:320,height:740},{width:360,height:740},{width:390,height:844},{width:430,height:900},{width:1024,height:768},{width:844,height:390}]){
   const page=await browser.newPage({viewport,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);
   const errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   const user={id:'source-coach',orgId:'source-org',orgName:'选题验收机构',role:'coach',displayName:'老师',loginName:'source-coach',organizations:[]};
   const directory={id:'d',title:'目录保持不变',revision:1,sortOrder:0,canEdit:true,items:[]};
   const start='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

   await page.addInitScript(()=>{
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    localStorage.setItem('xiangqi-teaching-environment','production');
    localStorage.setItem('xiangqi-teaching-session-server','https://api.qixiapp.cn');
   });
   await page.route('**/api/v1/**',async route=>{
    const req=route.request(),parsed=new URL(req.url()),path=parsed.pathname;let body=[];
    if(path.endsWith('/auth/refresh'))body={token:'fixture-only',expiresAt:'2099-01-01T00:00:00Z',user};
    else if(path.endsWith('/auth/me'))body=user;
    else if(path.endsWith('/capabilities'))body={};
    else if(path==='/api/v1/admin/assignments')body=[];
    else if(path===base+'/directories')body={items:[directory]};
    else if(path===base+'/directories/d')body=directory;
    else if(path===base+'/questions/chinese')body=directory.items[0];
    else if(path===base+'/board'){const moves=req.postDataJSON().moves;body={fen:moves.length?start.replace('1C5C1','1C2C4').replace(' w ',' b '):start,moveNotations:moves.length?{b9c7:'马2进3'}:{h2e2:'炮二平五',b0c2:'马八进七'}};}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.goto(url+'/teacher');
   await page.getByRole('button',{name:/机构题库 · 摆棋出题/}).click();
   await page.getByRole('button',{name:/目录保持不变.*道已发布/}).click();
   await page.getByRole('button',{name:/添加题目/}).click();
   await page.getByRole('button',{name:'手动摆棋',exact:true}).click();
   await page.getByRole('button',{name:'清空',exact:true}).click();
   assert.equal(await page.locator('.authoring-palette img').count(),12);
   assert.equal(await page.getByRole('button',{name:/选择黑将|选择红帅/}).count(),0);
   await page.getByRole('button',{name:'删除',exact:true}).click();
   await page.getByRole('button',{name:'1行5列将',exact:true}).click();
   await page.getByRole('button',{name:'10行5列帅',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'1行5列将',exact:true}).count(),1);
   assert.equal(await page.getByRole('button',{name:'10行5列帅',exact:true}).count(),1);
   await page.getByRole('button',{name:'选择红车',exact:true}).click();
   await page.getByRole('button',{name:'1行5列将',exact:true}).click();
   await page.getByRole('button',{name:'4行5列空位',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'1行5列将',exact:true}).count(),1);
   await page.getByRole('button',{name:'2行5列空位',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'2行5列将',exact:true}).count(),1);
   await page.getByRole('button',{name:'翻转',exact:true}).click();
   await page.getByRole('button',{name:'10行5列帅',exact:true}).click();
   await page.getByRole('button',{name:'8行6列空位',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'8行6列帅',exact:true}).count(),1);
   await page.getByRole('button',{name:'撤销',exact:true}).click();
   assert.equal(await page.getByRole('button',{name:'10行5列帅',exact:true}).count(),1);
   for(const rect of await page.locator('.authoring-palette img').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};}))) {
    assert(rect.left>=0&&rect.right<=viewport.width&&rect.width>20,'palette pieces must fit');
   }
   await page.screenshot({path:output+'/generals-'+viewport.width+'.png',fullPage:true});
   directory.items.push({id:'chinese',revision:1,canEdit:true,status:'draft',body:{title:'中文着法验收',startingFen:start,note:'',solution:[{iccs:'h2e2',comment:'',children:[{iccs:'b9c7',comment:'',children:[]}]},{iccs:'b0c2',comment:'',children:[]}]}});
   await page.getByRole('button',{name:'‹ 返回目录',exact:true}).click();
   await page.getByRole('button',{name:/1. 中文着法验收/}).click();
   await page.getByRole('button',{name:'炮二平五',exact:true}).click();
   await page.getByRole('button',{name:'马2进3',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:/h2e2|b0c2|b9c7/}).count(),0);
   await page.screenshot({path:output+'/chinese-'+viewport.width+'.png',fullPage:true});
   await page.getByRole('button',{name:'起点',exact:true}).click();
   await page.getByRole('button',{name:'马八进七',exact:true}).waitFor();
   assert.deepEqual(errors,[]);console.log('PASS generals retained / 12 palette pieces / palace / flip / undo / Chinese answer moves '+viewport.width);await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
