// Touch/rotation demonstrations of the real Board component, not native-device certification.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'artifacts/skins-20261025/videos');
const skins=require('../apps/endgame-training/src/authoredSkinCatalog.json').slice(0,3);
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1478';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.mkdirSync(out,{recursive:true});const results=[];
 for(const engine of ['chromium','webkit'].filter(e=>!process.env.SKIN_VIDEO_ENGINE||e===process.env.SKIN_VIDEO_ENGINE)){
  const browser=await(engine==='webkit'?webkit.launch():chromium.launch({channel:'chrome'}));
  try{for(const tablet of [false,true]){
   const name=`${engine}-${tablet?'tablet':'phone'}`;
   const size=tablet?{width:820,height:1180}:{width:390,height:844};
   const context=await browser.newContext({viewport:size,hasTouch:true,deviceScaleFactor:1,recordVideo:{dir:out,size}});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/skin-video',r=>r.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}));
   await page.goto(base+'/skin-video');
   await page.evaluate(async({skins,engine,tablet})=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    await import('/src/styles.css');
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {Board}=await import('/src/App.tsx');
    const css=document.createElement('style');css.textContent=`html,body,#root{height:100%;margin:0}.skin-demo{height:100dvh;width:100%;min-width:0;box-sizing:border-box;padding:12px;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto;gap:12px;color:#254638;background:#edf4ed}.demo-header h1{font-size:22px;margin:4px 0 8px}.demo-header small{font-size:12px;color:#5c7065}.demo-tabs{display:flex;gap:6px;margin:12px 0 0}.demo-tabs button,.demo-footer button{min-height:44px;border:1px solid #b5c9ba;border-radius:8px;background:white;color:#315d45;padding:8px 12px;font-size:14px}.demo-tabs button[aria-pressed=true]{background:#315d45;color:white}.demo-stage{min-width:0;min-height:0;display:grid;place-items:center}.demo-stage>.board-shell{max-width:100%;height:auto;width:min(100%,calc((100dvh - 200px)*1120/1240),650px)}.demo-footer{display:flex;gap:8px;align-items:center;justify-content:center}.demo-footer span{font-size:13px;color:#597460}@media(orientation:landscape){.skin-demo{grid-template-columns:minmax(0,1fr) minmax(190px,28%);grid-template-rows:1fr auto}.demo-header{grid-column:2}.demo-stage{grid-column:1;grid-row:1/3}.demo-stage>.board-shell{width:min(100%,calc((100dvh - 30px)*1120/1240),650px)}.demo-footer{grid-column:2;flex-wrap:wrap}.demo-tabs{flex-direction:column}}`;
    document.head.append(css);const h=React.createElement;
    function initial(){const pieces=[],kinds=['rook','horse','elephant','advisor','king','advisor','elephant','horse','rook'];for(const color of ['red','black']){const red=color==='red',labels=red?'车马相仕帅仕相马车':'车马象士将士象马车';kinds.forEach((kind,col)=>pieces.push({row:red?9:0,col,color,kind,label:labels[col]}));for(const col of [1,7])pieces.push({row:red?7:2,col,color,kind:'cannon',label:'炮'});for(const col of [0,2,4,6,8])pieces.push({row:red?6:3,col,color,kind:'pawn',label:red?'兵':'卒'});}return pieces;}
    const equal=(a,b)=>a&&b&&a.row===b.row&&a.col===b.col;
    const iccs=s=>'abcdefghi'[s.col]+(9-s.row);
    let eventId=0;
    function Demo(){
     const stage=React.useRef();
     React.useLayoutEffect(()=>{
      const el=stage.current;
      const fit=()=>{const b=el.getBoundingClientRect();const board=el.querySelector('.board-shell');if(board){const w=Math.floor(Math.min(b.width,b.height*1120/1240,650));board.style.width=w+'px';board.style.height=(w*1240/1120)+'px';}};
      const observer=new ResizeObserver(fit);observer.observe(el);fit();return()=>observer.disconnect();
     },[]);

     const [skin,setSkin]=React.useState(skins[0]),[pieces,setPieces]=React.useState(initial),[selected,setSelected]=React.useState(),[flipped,setFlipped]=React.useState(false),[event,setEvent]=React.useState();
     const reset=()=>{setPieces(initial());setSelected();setFlipped(false);setEvent();};
     const move=(from,to)=>{const piece=pieces.find(p=>equal(p,from));if(!piece||pieces.some(p=>equal(p,to)))return;const route=iccs(from)+iccs(to);if(!['b0c2','b9c7'].includes(route))return;setPieces(pieces.map(p=>equal(p,from)?{...p,...to}:p));setSelected();setEvent({id:++eventId,iccs:route,kind:'move',piece});};
     const tap=s=>{if(selected&&!equal(s,selected)&&!pieces.some(p=>equal(p,s)))move(selected,s);else setSelected(pieces.some(p=>equal(p,s))?s:undefined);};
     return h('main',{className:'skin-demo'},h('header',{className:'demo-header'},h('small',{},`1.0.7 · ${engine==='webkit'?'WebKit':'Chromium'} ${tablet?'平板':'手机'}触控预览（非原生）`),h('h1',{},skin.name),h('div',{className:'demo-tabs'},skins.map(s=>h('button',{key:s.id,'aria-pressed':s.id===skin.id,onClick:()=>{reset();setSkin(s);}},s.name)))),h('section',{className:'demo-stage',ref:stage},h(Board,{pieces,selected,flipped,lastMove:event?.iccs,feedback:event?.kind,feedbackEvent:event,boardSkin:skin.id,pieceSkin:skin.id,riverText:'',riverTextColor:'#946b3e',riverTextSize:20,supportsCustomRiverText:skin.supportsCustomRiverText,onSquare:tap,onMove:move})),h('footer',{className:'demo-footer'},h('button',{onClick:()=>{setSelected();setEvent();setFlipped(v=>!v);}},'翻转棋盘'),h('button',{onClick:reset},'恢复初始'),h('span',{},'点选 · 走子 · 翻转')));
    }
    createRoot(document.getElementById('root')).render(h(Demo));
   },{skins,engine,tablet});
   await page.locator('.piece').first().waitFor();
   await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
   const portraitFits=await page.evaluate(()=>{
    const b=document.querySelector('.xiangqi-board').getBoundingClientRect();
    return {ok:document.documentElement.scrollWidth<=innerWidth&&b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&Math.abs(b.width/b.height-1120/1240)<.005,board:b.toJSON(),viewport:[innerWidth,innerHeight],scroll:document.documentElement.scrollWidth};
   });
   assert(portraitFits.ok,`${name}: portrait board must fit without cropping ${JSON.stringify(portraitFits)}`);
   for(const skin of skins){
    await page.getByRole('button',{name:skin.name,exact:true}).tap();await pause(1100);
    await page.locator('[aria-label="b0 红马"]').tap();await pause(450);
    await page.locator('[aria-label="c2"]').tap();await page.locator('[aria-label="c2 红马"]').waitFor();await pause(800);
    await page.locator('[aria-label="b9 黑马"]').tap();await pause(450);
    await page.locator('[aria-label="c7"]').tap();await page.locator('[aria-label="c7 黑马"]').waitFor();await pause(800);
    await page.getByRole('button',{name:'翻转棋盘'}).tap();await pause(1100);
    await page.getByRole('button',{name:'恢复初始'}).tap();await pause(650);
   }
   await page.screenshot({path:path.join(out,`${name}-portrait.png`)});
   await page.setViewportSize({width:size.height,height:size.width});await pause(800);
   await page.locator('[aria-label="b0 红马"]').tap();await pause(300);
   await page.locator('[aria-label="c2"]').tap();await page.locator('[aria-label="c2 红马"]').waitFor();
   const fits=await page.evaluate(()=>{
    const board=document.querySelector('.xiangqi-board').getBoundingClientRect();
    return document.documentElement.scrollWidth<=innerWidth&&board.top>=0&&board.bottom<=innerHeight&&Math.abs(board.width/board.height-1120/1240)<.005&&[...document.querySelectorAll('.demo-tabs button,.demo-footer button')].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
   });
   assert(fits,`${name}: landscape board and controls must remain in view`);
   await page.screenshot({path:path.join(out,`${name}-landscape.png`)});await pause(1000);
   const video=page.video();await context.close();
   const webm=await video.path();const mp4=path.join(out,`${name}.mp4`);
   execFileSync('ffmpeg',['-y','-loglevel','error','-i',webm,'-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);fs.unlinkSync(webm);
   assert.deepEqual(errors,[]);results.push({engine,tablet,viewport:size,video:path.basename(mp4),moves:['b0c2','b9c7'],skins:skins.map(s=>s.id),native:false,landscape:'passed'});
   console.log(`${name}: three skins, touch moves and flip recorded`);
  }}finally{await browser.close();}
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
