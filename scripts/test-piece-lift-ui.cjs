// Real skin images and pointer gestures: the raised visual never moves the hit target.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-piece-lift';fs.mkdirSync(out,{recursive:true});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const skin=process.env.TEST_SKIN||'default';
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 for(const [width,height] of [[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]])for(const flipped of [false,true]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true,deviceScaleFactor:Number(process.env.EVIDENCE_SCALE||1)});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/lift-harness',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto(base+'/lift-harness');
  await page.evaluate(async({flipped,width,height,skin})=>{
   const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   await import('/src/styles.css');const React=(await import('/node_modules/.vite/deps/react.js')).default,{createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,{flushSync}=(await import('/node_modules/.vite/deps/react-dom.js')).default,{Board}=await import('/src/App.tsx');
   document.body.style.margin='0';const host=document.getElementById('root');host.className='mobile-study-pieces';host.style.cssText=`width:${Math.min(width-24,(height-50)*1120/1240,700)}px;margin:20px auto;`;
   const root=createRoot(host),pieces=[{row:6,col:0,color:'red',kind:'pawn',label:'兵'},{row:6,col:2,color:'red',kind:'pawn',label:'兵'},{row:9,col:0,color:'red',kind:'rook',label:'车'},{row:0,col:8,color:'black',kind:'rook',label:'车'}];
   const defaults={flipped,pieces,boardSkin:skin,pieceSkin:skin,riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false};
   let selection;window.moves=[];document.addEventListener('pointerdown',event=>{window.lastPointerId=event.pointerId;},true);window.drawBoard=(change={})=>{Object.assign(defaults,change);flushSync(()=>root.render(React.createElement(Board,{...defaults,selected:selection,onSquare:square=>{selection=selection?.row===square.row&&selection?.col===square.col?undefined:square;window.drawBoard();},onMove:(from,to)=>{window.moves.push({from,to});}})));};window.drawBoard();
   window.measurePiece=label=>{const square=document.querySelector(`[aria-label="${label}"]`),image=square.querySelector('.piece'),shadow=square.querySelector('.piece-ground-shadow'),edge=square.querySelector('.piece-edge');const rect=element=>{const r=element.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{hit:rect(square),piece:rect(image),shadow:rect(shadow),edgeOpacity:getComputedStyle(edge).opacity,transform:getComputedStyle(square.querySelector('.piece-lift')).transform,transition:getComputedStyle(square.querySelector('.piece-lift')).transitionDuration};};
   window.changeSelection=square=>{selection=square;window.drawBoard();};
   await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
  },{flipped,width,height,skin});
  const piece=page.getByRole('button',{name:'a3 红兵',exact:true}),before=await page.evaluate(()=>window.measurePiece('a3 红兵'));
  await piece.click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.board-square.selected .piece-edge')).opacity==='1');const selected=await page.evaluate(()=>window.measurePiece('a3 红兵'));
  for(const key of ['x','y','width','height'])assert(Math.abs(before.hit[key]-selected.hit[key])<=1,'Selection changed the logical square');
  const center=r=>({x:r.x+r.width/2,y:r.y+r.height/2}),raised=center(selected.piece),rest=center(before.piece),shadow=center(selected.shadow);
  assert(raised.y<rest.y-before.piece.height*.25,'The face must rise at least a quarter of its diameter');assert(shadow.x-raised.x>before.piece.width*.18&&shadow.y-raised.y>before.piece.height*.5,'The cast shadow must visibly separate towards screen bottom-right');
  assert.equal(selected.edgeOpacity,'1');assert(selected.transform.startsWith('matrix3d'),'The lifted piece has perspective');assert(distance(center(before.hit),center(selected.hit))<=1);
  if(!flipped)await page.screenshot({path:`${out}/lift-${width}x${height}.png`});
  await page.getByRole('button',{name:'c3 红兵',exact:true}).click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('[aria-label="a3 红兵"] .piece-edge')).opacity==='0');const released=await page.evaluate(()=>window.measurePiece('a3 红兵'));assert.equal(released.edgeOpacity,'0');assert(distance(center(before.piece),center(released.piece))<=1,'Old piece should fully settle');assert(distance(center(before.shadow),center(released.shadow))<=1,'Old shadow should settle');
  const from=await piece.boundingBox(),to=await page.getByRole('button',{name:'a4',exact:true}).boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:5});
  assert.equal(await page.locator('.board-drag-ghost').count(),1);assert.equal(await page.locator('.board-drag-shadow').count(),1);assert.equal(await page.locator('.board-drag-ghost .piece-edge').evaluate(node=>getComputedStyle(node).opacity),'1');assert.equal(await piece.locator('.piece-ground-shadow').evaluate(node=>getComputedStyle(node).opacity),'0');
  await page.mouse.up();assert.equal(await page.locator('.board-drag-shadow').count(),0);assert.deepEqual(await page.evaluate(()=>window.moves.at(-1)),{from:{row:6,col:0},to:{row:5,col:0}});
  // Pointer cancellation clears both overlays; no delayed animation survives navigation.
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+15,from.y+from.height/2+15);const pointerId=await page.evaluate(()=>window.lastPointerId);await page.locator('.xiangqi-board').dispatchEvent('pointercancel',{pointerId});await page.mouse.up();assert.equal(await page.locator('.board-drag-ghost').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.changeSelection({row:9,col:0}));const reduced=await page.evaluate(()=>window.measurePiece('a0 红车'));assert.equal(reduced.transition,'0s');
  await page.evaluate(()=>window.drawBoard({pieces:[{row:6,col:2,color:'red',kind:'pawn',label:'兵'}]}));assert.equal(await piece.locator('.piece-ground-shadow').count(),0,'No shadow remains on an empty origin');
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: 6 phone/tablet viewports × both orientations, perspective lift, separated shadow, stable hit targets, selection switching, drag/drop/cancel, reduced motion and empty origin');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
