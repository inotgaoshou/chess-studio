// Reference-timing regression. Screenshots isolate the actual shared Board.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await (process.env.BOARD_TEST_BROWSER==='webkit'?webkit:chromium).launch({headless:true,...(process.env.BOARD_TEST_BROWSER==='webkit'?{}:{channel:'chrome'})});
 try {
  const output=process.env.FEEDBACK_SCREENSHOTS;
  if(output)fs.mkdirSync(output,{recursive:true});
  for(const width of [320,390,430,820]) {
   const page=await browser.newPage({viewport:{width,height:width===820?1180:844}});
   await page.clock.install();
   await page.clock.pauseAt(new Date());
   await page.route('**/feedback-harness',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
   await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/feedback-harness');
   await page.evaluate(async()=>{
    const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    await import('/src/styles.css');
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default;
    const {Board}=await import('/src/App.tsx');
    const {trainingFeedbackEvent}=await import('/src/moveFeedback.ts');
    const root=createRoot(document.getElementById('root'));
    window.renderSeal=(kind)=>{
      const mover={row:7,col:2,color:'black',kind:'cannon',label:'炮'};
      const captured={row:7,col:4,color:'red',kind:kind==='advisor'?'advisor':kind==='elephant'?'elephant':'pawn',label:kind==='advisor'?'仕':kind==='elephant'?'相':'兵'};
      const after={pieces:[{...mover,col:4}],fen:'',sideToMove:'red',status:kind==='check'?'将军':kind==='checkmate'?'将死':kind==='stalemate'?'困毙':'正常'};
      const event=trainingFeedbackEvent([mover,captured],after,'c2e2');
      flushSync(()=>root.render(React.createElement(Board,{pieces:after.pieces,lastMove:'c2e2',feedback:event.kind,feedbackEvent:event,boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,onSquare(){window.touches=(window.touches||0)+1;}})));
    };
    window.renderSeal('ordinary');
   });
   await page.evaluate(()=>document.fonts.ready);
   for(const kind of ['ordinary','advisor','elephant','check','checkmate','stalemate']) {
    await page.evaluate(kind=>window.renderSeal(kind),kind);
    const board=page.locator('.xiangqi-board');
    const before=await board.boundingBox();
    for(const time of [250,500,950]) {
     const result=await page.evaluate(time=>{
       const seal=document.querySelector('.board-event-seal');
       for(const a of document.querySelector('.xiangqi-board').getAnimations({subtree:true})){a.pause();a.currentTime=time;}
       const glyph=seal.querySelector('.feedback-lettering');
       const r=glyph.getBoundingClientRect(),board=seal.closest('.xiangqi-board').getBoundingClientRect(),badge=seal.getBoundingClientRect();
       return {label:seal.getAttribute('aria-label'),pointer:getComputedStyle(seal).pointerEvents,centered:Math.abs(badge.x+badge.width/2-board.x-board.width/2)<1&&Math.abs(badge.y+badge.height/2-board.y-board.height/2)<1,inside:r.left>=board.left-1&&r.right<=board.right+1&&r.top>=board.top-1&&r.bottom<=board.bottom+1};
     },time);
     assert.equal(result.pointer,'none');assert(result.inside,`${width}/${kind}/${time} lettering clipped`);
     assert(result.centered,`${width}/${kind}/${time} notice must stay at the river, not follow the captured piece`);
     assert.deepEqual(await board.boundingBox(),before);
     if(output&&width===390)await board.screenshot({path:`${output}/${kind}-${time}.png`,animations:'allow'});
    }
    await page.locator('[aria-label="a9"]').click();
    assert(await page.evaluate(()=>window.touches>0),'Seal must not block board input');
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.evaluate(()=>window.renderSeal('ordinary'));
   const reduced=await page.evaluate(()=>({
     hidden:[...document.querySelectorAll('.feedback-embers,.feedback-rim,.feedback-flare')].every(e=>getComputedStyle(e).display==='none'),
     label:document.querySelector('.board-event-seal').textContent,
   }));
   assert(reduced.hidden,'Reduced motion must suppress light trails');assert.equal(reduced.label,'吃');
   console.log(`PASS ${width}px: six event types, three phases, stable layout and touch-through`);
   await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
