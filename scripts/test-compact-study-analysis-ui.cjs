const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.MOBILE_URL||'http://127.0.0.1:1422';
const out=process.env.OUTPUT_DIR||'/tmp/qixi-compact-analysis';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await(process.env.WEBKIT?webkit.launch({headless:true}):chromium.launch({channel:'chrome',headless:true}));
 try{
  for(const viewport of [{width:320,height:740},{width:390,height:844},{width:430,height:932},{width:844,height:390},{width:1024,height:768}]){
   const page=await browser.newPage({viewport,isMobile:true,hasTouch:true});page.setDefaultTimeout(12000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done'));
   await page.route('**/api/v1/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));
   await page.route('**/src/App.tsx',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text())+'\nexport { AnalysisPanel };'});});
   await page.goto(base);
   await page.evaluate(async()=>{
    const {AnalysisPanel}=await import('/src/App.tsx');
    const {BranchStrip}=await import('/@fs/Users/chenyubin/Documents/chess/chess-studio/apps/desktop/src/BranchStrip.tsx');
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    document.getElementById('root').style.display='none';const host=document.createElement('div');document.body.append(host);
    const h=React.createElement,noop=()=>{};
    window.analysisActions={preview:0,explain:0};
    const lines=[125,90,-35].map((scoreCp,i)=>({multipv:i+1,depth:22,nodes:123456,nps:60000,scoreCp,pv:['a0a1','a9a8','a1a2'],notation:['车九进一','车１进１','车九进一']}));
    function Fixture(){
     const [count,setCount]=React.useState(1),[arrows,setArrows]=React.useState(true),[active,setActive]=React.useState(0);
     window.setAnalysisBranches=setCount;
     return h('div',{className:'training-app'},h('div',{className:'study-workspace'},
      h('main',{className:'study-stage evaluation-hidden'},h('header',{className:'study-toolbar'},'拆棋'),h('div',{className:'board-shell'})),
      h('aside',{className:'study-sidebar'},h('div',{className:'study-branch-navigation'},h('nav',{className:'study-move-nav'},h('button',null,'上一步'))),h('nav',{className:'study-panel-tabs'},'棋谱 / 云库 / 引擎'),
       h('div',{className:'study-research-stack'},h('div',{className:'commentary-research-content'},h(AnalysisPanel,{lines,pending:false,enabled:true,disabled:false,activeIndex:active,multiPv:3,moveTimeSec:1,scoreSide:'red',arrowsVisible:arrows,onToggle:noop,onToggleArrows:()=>setArrows(v=>!v),onSelect:setActive,onMultiPvChange:noop,onMoveTimeChange:noop,onPreview:()=>window.analysisActions.preview++,onExplain:()=>window.analysisActions.explain++})),h('span',{className:'study-branch-dock','aria-hidden':true})),
       h(BranchStrip,{floating:true,light:true,contextKey:'fixture:'+count,choices:Array.from({length:count},(_,i)=>({id:String(i),move:['a0a1','c3c4','e3e4'][i],notation:['车九进一','兵五进一','炮二平五'][i]})),getAnchor:()=>({board:host.querySelector('.board-shell'),toolbar:host.querySelector('.study-sidebar'),dock:host.querySelector('.study-branch-dock'),dockInside:true}),onSelect:noop}))));
    }
    createRoot(host).render(h(Fixture));
   });
   const cards=page.locator('.analysis-candidate-commentary');await cards.first().waitFor();
   const scroller=page.locator('.commentary-research-content'),strip=page.getByRole('navigation',{name:'当前局面分支'});
   const rect=selector=>page.locator(selector).boundingBox();
   const before=await rect('.study-stage > .board-shell');
   const sizes=await cards.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),a=n.querySelector('.analysis-candidate-actions'),buttons=[...a.querySelectorAll('button')].map(b=>b.getBoundingClientRect());return {height:r.height,actionGap:Math.abs(buttons[0].y-buttons[1].y),overflow:a.scrollWidth>a.clientWidth+1};}));
   for(const s of sizes)assert(s.height<=100&&s.actionGap<=1&&!s.overflow,'candidate actions must share a compact row: '+JSON.stringify(s));
   const sr=await scroller.boundingBox(),br=await strip.boundingBox();assert(br.y>=sr.y+sr.height-1||br.x>=sr.x+sr.width-1,'default branch footer must not cover candidate content');
   await cards.last().getByRole('button',{name:'小棋盘',exact:true}).click();
   await cards.last().getByRole('button',{name:'为什么推荐',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>window.analysisActions),{preview:1,explain:1});
   await page.getByRole('button',{name:'隐藏棋盘候选箭头',exact:true}).click();await page.getByRole('button',{name:'显示棋盘候选箭头',exact:true}).waitFor();
   for(const count of [0,1,3]){
    await page.evaluate(n=>window.setAnalysisBranches(n),count);
    if(count){await strip.waitFor();assert.equal(await strip.locator('.manual-branch-choices button').count(),count,'all distinct branch choices must remain visible');}else await strip.waitFor({state:'detached'});
    const after=await rect('.study-stage > .board-shell');for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<=1,'branch changes must not resize board');
   }
   await strip.getByRole('button',{name:'收起变招选择',exact:true}).click();await strip.getByRole('button',{name:'展开棋谱后续',exact:true}).click();
   await scroller.evaluate(n=>n.scrollTop=0);
   await page.screenshot({path:out+`/engine-${viewport.width}x${viewport.height}.png`});
   assert.deepEqual(errors,[]);console.log('PASS compact candidates / paired actions / branch footer / stable board '+viewport.width+'x'+viewport.height);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
