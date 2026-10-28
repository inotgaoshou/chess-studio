const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.AUTHORING_URL||'http://127.0.0.1:1457';
const output=process.env.AUTHORING_SCREENSHOTS||'/tmp/qixi-authoring-browser';fs.mkdirSync(output,{recursive:true});
const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try {
for(const width of (process.env.AUTHORING_ADMIN ? [1280] : [390,768])) {
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
 let items=[{id:'published',revision:1,publishedProblemId:'problem',canEdit:true,archived:false,status:'published',body:{title:'一步杀',startingFen:fen,note:'',solution:[]}}];
 const directory=()=>({id:'directory',title:'杀棋训练',revision:1,sortOrder:0,canEdit:true,publishedCount:1,draftCount:items.length-1,items});
 const user={createdAt:'2026-01-01T00:00:00Z',id:'teacher',orgId:'school',orgName:'测试机构',role:'coach',displayName:'验收老师',loginName:'teacher',organizations:[{id:'school',name:'测试机构',role:'coach'}]};
 await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');});
 await page.route('**/api/v1/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname;let body=[];
 if(path.endsWith('/auth/refresh'))body={token:'school',expiresAt:'2099-01-01T00:00:00Z',user};
 else if(path.endsWith('/auth/me'))body=user;
 else if(path.endsWith('/authoring/directories'))body={items:[directory()]};
 else if(path.endsWith('/authoring/directories/directory'))body=directory();
 else if(path.includes('/authoring/questions/')&&req.method()==='PUT'){body={id:path.split('/').at(-1),revision:1,canEdit:true,archived:false,status:'draft',body:req.postDataJSON().body};items.push(body);}
 else if(path.endsWith('/authoring/recognize')){assert(req.headers()['content-type'].includes('image/jpeg'));assert.equal(req.postDataBuffer()[0],255);body={pieces:[{row:0,col:4,code:'k',confidence:.7},{row:9,col:4,code:'K',confidence:.7}],uncertain:[{row:0,col:4}],warnings:['测试待核对']};}
 else if(path.endsWith('/admin/classes'))body=[{id:'class',name:'测试班',studentCount:1}];
 else if(path.endsWith('/students'))body=[{id:'student',displayName:'小明',loginName:'ming'}];
 await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(base+(process.env.AUTHORING_ADMIN ? '/' : '/teacher'));await page.getByRole('button',{name:/机构题库/}).click();
 await page.getByRole('button',{name:/杀棋训练.*道已发布/}).click();
 await page.getByRole('button',{name:/添加题目/}).waitFor();
 await page.screenshot({path:`${output}/${width}-directory.png`,fullPage:true});
 await page.getByRole('button',{name:/添加题目/}).click();await page.getByRole('button',{name:'手动摆棋'}).click();
 await page.getByRole('heading',{name:'摆棋录题'}).waitFor();
 assert.equal(await page.locator('.teacher-authoring').evaluate(n=>n.scrollWidth>n.clientWidth+2),false,'authoring overflow');
 await page.screenshot({path:`${output}/${width}-board.png`,fullPage:true});
 await page.getByRole('button',{name:'清空',exact:true}).click();await page.getByRole('button',{name:'红先',exact:true}).click();await page.getByRole('button',{name:'翻转',exact:true}).click();
 await page.getByRole('button',{name:'黑先',exact:true}).waitFor();await page.getByRole('button',{name:'完成摆棋',exact:true}).click();await page.getByText('2. 训练题',{exact:true}).waitFor();
 assert(items[1].body.startingFen.includes(' b '));
 await page.getByRole('button',{name:/添加题目/}).click();await page.getByRole('button',{name:'拍照／相册识别'}).click();
 await page.getByLabel('从相册选择').setInputFiles('docs/acceptance/assets/teacher-authoring-20261028/390-board.png');
 await page.getByRole('button',{name:/旋转/}).click();await page.getByRole('button',{name:'识别并核对棋子'}).click();
 await page.getByRole('button',{name:'我已逐格核对并修正'}).waitFor();
 await page.getByRole('button',{name:'完成摆棋'}).click();await page.getByRole('alert').filter({hasText:'请先逐格核对'}).waitFor();assert.equal(items.length,2);
 await page.getByRole('button',{name:'我已逐格核对并修正'}).click();await page.getByRole('button',{name:'完成摆棋'}).click();await page.getByText('3. 训练题',{exact:true}).waitFor();
 await page.getByRole('button',{name:'选择／编辑'}).click();await page.getByRole('checkbox',{name:'选择一步杀',exact:true}).check();await page.getByRole('button',{name:'布置作业（1题）'}).click();
 await page.getByRole('checkbox',{name:'测试班（1人）'}).check();await page.getByRole('button',{name:'核对并发布'}).click();await page.getByRole('heading',{name:'确认发布'}).waitFor();
 await page.screenshot({path:`${output}/${width}-assignment.png`,fullPage:true});assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}: directory > board > black-to-move draft > photo/rotate/JPEG/confirm > selected assignment`);
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
