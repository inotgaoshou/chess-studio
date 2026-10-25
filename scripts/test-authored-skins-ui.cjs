// Render the real shared Android/iOS Board, including touch targets and flipping.
const {chromium, webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const designs=require('./skin-designs/palettes.json');
const defaultGeometry=require('../apps/endgame-training/src/authoredSkinGeometry.json');
const referenceGeometry=require('../apps/endgame-training/src/referenceSkinGeometry.json');
const catalog=require('../apps/endgame-training/src/authoredSkinCatalog.json');
const scale=Number(process.env.SKIN_SCREENSHOT_SCALE||1);
const scaleTag=scale>1?`@${scale}x`:'';
const widths=process.env.SKIN_TEST_WIDTH?[Number(process.env.SKIN_TEST_WIDTH)]:[375,390,430,820];
const out=path.resolve(__dirname,'../artifacts/skins-20261025');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const engine=process.env.SKIN_TEST_BROWSER||'chromium';
 const browser=engine==='webkit'?await webkit.launch():await chromium.launch({channel:'chrome'});
 const results=[];
 try {
 for(const width of widths)for(const d of designs){
  const geometry=referenceGeometry[d.id]||defaultGeometry;
  const capability=catalog.find(s=>s.id===d.id).supportsCustomRiverText;
  const minInset=referenceGeometry[d.id]?7:19;
  const page=await browser.newPage({viewport:{width,height:width===820?1180:900},deviceScaleFactor:scale});
  await page.route('**/skin-harness',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/skin-harness');
  await page.evaluate(async({id,name,capability})=>{
   const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   await import('/src/styles.css');
   const React=(await import('/node_modules/.vite/deps/react.js')).default;
   const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
   const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
   const {Board}=await import('/src/App.tsx');
   const pieces=[];const kinds=['rook','horse','elephant','advisor','king','advisor','elephant','horse','rook'];
   for(const color of ['red','black']){
    const red=color==='red';const labels=red?'车马相仕帅仕相马车':'车马象士将士象马车';
    kinds.forEach((kind,col)=>pieces.push({row:red?9:0,col,color,kind,label:labels[col]}));
    for(const col of [1,7])pieces.push({row:red?7:2,col,color,kind:'cannon',label:'炮'});
    for(const col of [0,2,4,6,8])pieces.push({row:red?6:3,col,color,kind:'pawn',label:red?'兵':'卒'});
   }
   const root=createRoot(document.getElementById('root'));window.taps=[];
   window.renderSkin=(flipped=false,riverText='',selected)=>flushSync(()=>root.render(React.createElement('main',{style:{maxWidth:650,margin:'0 auto',padding:12}},React.createElement('h2',{style:{margin:'8px 0 16px',fontSize:22}},name),React.createElement(Board,{pieces,flipped,selected,boardSkin:id,pieceSkin:id,riverText,riverTextColor:'#713a2e',riverTextSize:20,supportsCustomRiverText:capability,onSquare:s=>window.taps.push(s)}))));
   window.renderSkin();
  },{...d,capability});
  await page.locator('.piece').first().waitFor();
  await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  assert.equal(await page.locator('.piece').count(),32);
  for(const flipped of [false,true]){
   await page.evaluate(async f=>{
    window.renderSkin(f);
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));
   },flipped);
   const boardRect=await page.locator('.xiangqi-board').boundingBox();
   await page.locator('.xiangqi-board').click({position:{x:geometry.columns[flipped?8:0]/1120*boardRect.width,y:geometry.rows[flipped?0:9]/1240*boardRect.height}});
   assert.deepEqual(await page.evaluate(()=>window.taps.at(-1)),{row:9,col:0});
   const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,board:document.querySelector('.xiangqi-board').getBoundingClientRect().toJSON()}));
   assert(bounds.scroll<=bounds.width,'Horizontal overflow');
   assert(bounds.board.width>200,'Board must remain visible');
   assert(Math.abs(bounds.board.width/bounds.board.height-1120/1240)<.005,'Board aspect ratio must be preserved');
   // Include the complete transparent sprite, so the visible disc/shadow has more clearance.
   const insets=await page.evaluate(()=>{
    const board=document.querySelector('.xiangqi-board').getBoundingClientRect();
    return [...document.querySelectorAll('.board-square .piece')].map(el=>{
     const p=el.getBoundingClientRect();
     return Math.min(p.left-board.left,board.right-p.right,p.top-board.top,board.bottom-p.bottom)/board.width*1120;
    });
   });
   assert(Math.min(...insets)>=minInset,`Edge clearance ${Math.min(...insets)} at ${width}/${d.id}/flipped=${flipped}`);
   const liftedFits=await page.evaluate(async flipped=>{
    window.renderSkin(flipped,'',{row:flipped?9:0,col:flipped?8:0});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})));
    const board=document.querySelector('.xiangqi-board').getBoundingClientRect();
    const piece=document.querySelector('.board-square.selected .piece').getBoundingClientRect();
    return piece.top>=board.top-.5&&piece.left>=board.left-.5&&piece.right<=board.right+.5;
   },flipped);
   assert(liftedFits,'Selected edge piece must remain inside the board');
  }
  await page.evaluate(()=>window.renderSkin());
  await page.locator('main').screenshot({path:path.join(out,`${engine}-${width}-${d.id}${scaleTag}.png`),animations:'disabled'});
  await page.evaluate(()=>window.renderSkin(false,'自在弈棋'));
  assert.match(await page.locator('.xiangqi-board').getAttribute('style'),capability?/board-river-blank/:/board\.png/);
  results.push({engine,width,skin:d.id,pieces:32,flippedTouch:'passed',overflow:'none',edgeClearance:`at least ${minInset} source px`,customRiver:capability?'passed':'original lettering preserved',selectedEdge:'passed'});
  await page.close();
 }
 }finally{await browser.close();}
 fs.writeFileSync(path.join(out,`${engine}${scaleTag}-results.json`),JSON.stringify(results,null,2));
 console.log(`${engine}: ${results.length} board layouts passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
