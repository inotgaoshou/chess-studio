const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {responseFor}=require('./mobile-library-fixtures.cjs');
const topic={id:'flying',name:'飞刀与陷阱',kind:'category',teachingEntry:'flying_knives',displayOrder:0,active:true,confirmed:true,itemCount:0,materialCount:42};
const books=['杨典 · 布局飞刀陷阱','尚威 · 布局飞刀','杨官璘 · 刀局十局'].map((name,i)=>({...topic,id:'book-'+i,parentId:topic.id,name,kind:'book',teachingEntry:undefined,materialCount:[24,8,10][i]}));
const practical={...topic,id:'practical',name:'实用残局',teachingEntry:'practical_endgames',itemCount:1,materialCount:0};
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const output=process.env.OUTPUT_DIR||'.local/flying-knives-browser';fs.mkdirSync(output,{recursive:true});
 try{
  for(const viewport of [{width:390,height:844},{width:1024,height:768}]){
   const page=await browser.newPage({viewport,hasTouch:true,isMobile:true});page.setDefaultTimeout(8000);
   await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());let body=responseFor(url,route.request().method());
    if(url.pathname.endsWith('/teaching-catalog/browse')){
     const id=url.searchParams.get('nodeId'),book=books.find(b=>b.id===id),current=book||(id==='flying'?topic:id==='practical'?practical:null);
     body={currentNode:current,breadcrumbs:book?[topic,book]:current?[current]:[],children:book||id==='practical'?[]:id==='flying'?books:[topic,practical],learningMaterials:book&&url.searchParams.get('view')==='materials'?Array.from({length:book.materialCount},(_,i)=>({id:'g'+i,title:'布局飞刀第 '+(i+1)+' 局',reviewStatus:'published'})):[],statisticsReady:true,statisticsRevision:'1',statisticsSnapshotRevision:'1',availabilitySnapshotRevision:'1'};
    }
    if(/\/teaching-catalog\/[^/]+\/problems$/.test(url.pathname))body={items:url.pathname.includes('/practical/')?[{...responseFor(new URL('http://fixture/api/v1/student/problems/p0')),title:'车兵巧胜单士'}]:[]};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   });
   await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');document.documentElement?.classList.add('tablet-webview');});
   await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1479')+'/library');
   const catalog=page.getByRole('region',{name:'教学题库目录',exact:true});
   await catalog.getByRole('button',{name:/飞刀与陷阱/}).click();
   for(const book of books)await catalog.getByRole('button',{name:new RegExp(book.name)}).waitFor();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
   await page.screenshot({path:`${output}/books-${viewport.width}.png`});
   await catalog.getByRole('button',{name:/杨典 · 布局飞刀陷阱/}).click();
   await catalog.getByRole('button',{name:'布局飞刀第 24 局',exact:true}).waitFor();
   await page.screenshot({path:`${output}/materials-${viewport.width}.png`});
   await catalog.getByRole('button',{name:'布局飞刀第 1 局',exact:true}).click();
   await page.getByRole('button',{name:'返回题库',exact:true}).waitFor();
   await page.getByRole('button',{name:'返回题库',exact:true}).click();
   await catalog.getByRole('button',{name:'布局飞刀第 1 局',exact:true}).waitFor();
   await catalog.getByRole('button',{name:'返回上级目录',exact:true}).click();
   await catalog.getByRole('button',{name:/尚威 · 布局飞刀/}).waitFor();
   await catalog.getByRole('button',{name:'返回上级目录',exact:true}).click();
   await catalog.getByRole('button',{name:/实用残局/}).click();
   await catalog.getByRole('button',{name:/第 1 题 · 车兵巧胜单士/}).waitFor();
   await page.screenshot({path:`${output}/practical-title-${viewport.width}.png`});
   console.log(`PASS ${viewport.width}: books, 24 materials, game opening/return, practical title`);
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
