// Real Board/CSS regression: origin, destination, size, and pre-paint animation setup.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = process.env.BOARD_TEST_BROWSER === 'webkit'
  ? await webkit.launch({headless:true})
  : await chromium.launch({channel:'chrome', headless:true});
 try {
  const restingFilters=new Map();
  for (const width of [320,390,430,820]) for (const flipped of [false,true]) for (const enlarged of [false,true]) {
  const page = await browser.newPage({viewport:{width,height:width===820?1180:844}});
  await page.route('**/motion-harness', r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto((process.env.PRACTICE_URL || 'http://127.0.0.1:1462') + '/motion-harness');
  const result = await page.evaluate(async({flipped,enlarged})=>{
   const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   await import('/src/styles.css');
   const React=(await import('/node_modules/.vite/deps/react.js')).default;
   const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
   const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
   const {Board}=await import('/src/App.tsx');
   const piece={row:9,col:1,color:'red',kind:'horse',label:'马'};
   document.getElementById('root').className=enlarged?'mobile-study-pieces':'';
   const base={flipped,pieces:[piece],boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,onSquare(){}};
   const root=createRoot(document.getElementById('root'));
   flushSync(()=>root.render(React.createElement(Board,base)));
   await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));
   const before=document.querySelector('[aria-label="b0 红马"] .piece').getBoundingClientRect().toJSON();
   const restingFilter=getComputedStyle(document.querySelector('[aria-label="b0 红马"] .piece-lift')).filter;
   flushSync(()=>root.render(React.createElement(Board,{...base,pieces:[{...piece,row:7,col:2}],lastMove:'b0c2',feedback:'move',feedbackEvent:{id:1,iccs:'b0c2',kind:'move',piece}})));
   const readyBeforePaint=Boolean(document.querySelector('.board-moving-piece'));
   await new Promise((resolve,reject)=>{if(document.querySelector('.board-moving-piece'))return resolve();const observer=new MutationObserver(()=>{if(document.querySelector('.board-moving-piece')){observer.disconnect();resolve();}});observer.observe(document.getElementById('root'),{childList:true,subtree:true});setTimeout(()=>{observer.disconnect();reject(Error('No movement overlay'));},500);});
   const moving=document.querySelector('.board-moving-piece');
   const animation=moving.getAnimations()[0];animation.pause();animation.currentTime=0;
   const from=moving.getBoundingClientRect().toJSON();
   animation.currentTime=180;
   const to=moving.getBoundingClientRect().toJSON();
   const destination=document.querySelector('[aria-label="c2 红马"] .piece').getBoundingClientRect().toJSON();
   flushSync(()=>root.render(React.createElement(Board,{...base,selected:{row:7,col:2},pieces:[{...piece,row:7,col:2}]})));
   await new Promise(resolve=>setTimeout(resolve,200));
   const lift=document.querySelector('.board-square.selected .piece-lift');
   const ringBefore=getComputedStyle(lift,'::before');
   const ringAfter=getComputedStyle(lift,'::after');
   const pieceStyle=getComputedStyle(lift.querySelector('.piece'));
   const liftRect=lift.getBoundingClientRect();
   const pieceRect=lift.querySelector('.piece').getBoundingClientRect();
   const selected={ringBefore:ringBefore.content,ringAfter:ringAfter.content,pieceZ:Number(pieceStyle.zIndex),pieceFilter:getComputedStyle(lift).filter,liftSize:[liftRect.width,liftRect.height],pieceSize:[pieceRect.width,pieceRect.height],intrinsicSize:[lift.querySelector(".piece").offsetWidth,lift.querySelector(".piece").offsetHeight],centerOffset:Math.hypot(liftRect.x+liftRect.width/2-pieceRect.x-pieceRect.width/2,liftRect.y+liftRect.height/2-pieceRect.y-pieceRect.height/2)};
   return {before,from,to,destination,readyBeforePaint,style:moving.getAttribute('style'),selected,restingFilter};
  },{flipped,enlarged});
  console.log(JSON.stringify({width,flipped,enlarged,...result}));
  assert(result.readyBeforePaint,'Animation must be ready before the first paint to avoid flashing the final position');
  const center=r=>[r.x+r.width/2,r.y+r.height/2];
  assert(Math.hypot(...center(result.from).map((v,i)=>v-center(result.before)[i]))<1,'Moving piece must start at the origin, without jumping');
  assert(Math.hypot(...center(result.to).map((v,i)=>v-center(result.destination)[i]))<1,'Moving piece must finish at the destination, without snapping');
  assert(Math.abs(result.to.width-result.destination.width)<1,'Moving piece must retain its size');
  assert(['none','normal'].includes(result.selected.ringBefore),'Selected piece must have no outer ring');
  assert(['none','normal'].includes(result.selected.ringAfter),'Selected piece must have no animated ring');
  assert(Math.abs(result.selected.intrinsicSize[0]-result.selected.intrinsicSize[1])<1,'Piece artwork must retain its intrinsic square geometry');
  assert(result.selected.pieceSize[0]/result.selected.pieceSize[1]<1.3,'Perspective tilt must keep the piece legible');
  assert(result.selected.centerOffset<1,'Selected piece lift must share the piece center');
  if(enlarged) assert(result.selected.pieceFilter.includes('drop-shadow'),'Phone piece must retain depth shadow');
  const filterKey=`${width}-${flipped}`;
  if(enlarged) assert.equal(result.restingFilter,restingFilters.get(filterKey),'Phone and tablet resting pieces must use equal default depth');
  else restingFilters.set(filterKey,result.restingFilter);
  if(width===390 && !flipped && !enlarged) {
   const capture=await page.evaluate(async()=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
    const {Board}=await import('/src/App.tsx');
    const container=document.createElement('div');
    document.body.append(container);
    const root=createRoot(container);
    const mover={row:0,col:2,color:'red',kind:'horse',label:'马'};
    const captured={row:1,col:4,color:'black',kind:'pawn',label:'卒'};
    const base={pieces:[{...mover,row:1,col:4}],lastMove:'c9e8',feedback:'capture',feedbackEvent:{id:300,kind:'capture',iccs:'c9e8',piece:mover,captured},boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,onSquare(){}};
    flushSync(()=>root.render(React.createElement(Board,base)));
    const board=document.querySelectorAll('.xiangqi-board')[1];
    const ghost=board.querySelector('.board-captured-piece');
    const destination=board.querySelector('[aria-label="e8 红马"]');
    const notice=board.querySelector('.capture-feedback');
    for(const animation of notice.getAnimations({subtree:true})) { animation.pause(); animation.currentTime=250; }
    const rect=element=>element.getBoundingClientRect();
    const center=element=>[rect(element).x+rect(element).width/2,rect(element).y+rect(element).height/2];
    const expected=center(destination),actual=center(ghost);
    const noticeStyle=getComputedStyle(notice);
    const noticeCenter=center(notice),boardCenter=center(board);
    return {distance:Math.hypot(actual[0]-expected[0],actual[1]-expected[1]),noticePosition:noticeStyle.position,noticeDistance:Math.hypot(noticeCenter[0]-expected[0],noticeCenter[1]-expected[1]),centerDistance:Math.hypot(boardCenter[0]-expected[0],boardCenter[1]-expected[1]),boardSize:[rect(board).width,rect(board).height]};
   });
   assert(capture.distance<1,'Captured piece must dissolve from the destination');
   assert.equal(capture.noticePosition,'absolute','Capture notice must not consume board layout');
   assert(capture.noticeDistance<capture.centerDistance,'Capture notice must appear near the move, not board center');
   console.log(JSON.stringify({capture}));
   if(process.env.BOARD_FEEDBACK_SCREENSHOT_PATH) await page.locator('.xiangqi-board').nth(1).screenshot({path:process.env.BOARD_FEEDBACK_SCREENSHOT_PATH});
   for(const [index,kind] of ['check','checkmate','stalemate'].entries()) {
    const seal=await page.evaluate(async(kind)=>{
     const React=(await import('/node_modules/.vite/deps/react.js')).default;
     const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
     const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
     const {Board}=await import('/src/App.tsx');
     const container=document.createElement('div');document.body.append(container);
     const mover={row:0,col:2,color:'red',kind:'horse',label:'马'};
     flushSync(()=>createRoot(container).render(React.createElement(Board,{pieces:[{...mover,row:1,col:4}],lastMove:'c9e8',feedback:kind,feedbackEvent:{id:310,kind,iccs:'c9e8',piece:mover},boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,onSquare(){}})));
     const board=container.querySelector('.xiangqi-board'),notice=container.querySelector('.ink-feedback');
     for(const animation of notice.getAnimations({subtree:true})) {animation.pause();animation.currentTime=300;}
     return {text:notice.textContent,position:getComputedStyle(notice).position,size:[board.getBoundingClientRect().width,board.getBoundingClientRect().height]};
    },kind);
    assert.equal(seal.position,'absolute',`${kind} notice must not resize the board`);
    assert.deepEqual(seal.size,capture.boardSize,`${kind} notice must preserve the board geometry`);
    assert(seal.text,`${kind} notice must have a visible label`);
    if(process.env.BOARD_FEEDBACK_SCREENSHOT_PATH) await page.locator('.xiangqi-board').nth(index+2).screenshot({path:process.env.BOARD_FEEDBACK_SCREENSHOT_PATH.replace(/\.png$/,`-${kind}.png`)});
   }
  }
  if(process.env.BOARD_SCREENSHOT_PATH && width===390 && !flipped && enlarged) await page.screenshot({path:process.env.BOARD_SCREENSHOT_PATH});
  await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
