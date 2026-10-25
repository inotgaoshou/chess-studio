// Real Board/CSS regression: origin, destination, size, and pre-paint animation setup.
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = process.env.BOARD_TEST_BROWSER === 'webkit'
  ? await webkit.launch({headless:true})
  : await chromium.launch({channel:'chrome', headless:true});
 try {
  for (const width of [390,820]) for (const flipped of [false,true]) for (const enlarged of [false,true]) {
  const page = await browser.newPage({viewport:{width,height:width===390?844:1180}});
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
   flushSync(()=>root.render(React.createElement(Board,{...base,pieces:[{...piece,row:7,col:2}],lastMove:'b0c2',feedback:'move',feedbackEvent:{id:1,iccs:'b0c2',kind:'move',piece}})));
   const readyBeforePaint=Boolean(document.querySelector('.board-moving-piece'));
   await new Promise((resolve,reject)=>{if(document.querySelector('.board-moving-piece'))return resolve();const observer=new MutationObserver(()=>{if(document.querySelector('.board-moving-piece')){observer.disconnect();resolve();}});observer.observe(document.getElementById('root'),{childList:true,subtree:true});setTimeout(()=>{observer.disconnect();reject(Error('No movement overlay'));},500);});
   const moving=document.querySelector('.board-moving-piece');
   const animation=moving.getAnimations()[0];animation.pause();animation.currentTime=0;
   const from=moving.getBoundingClientRect().toJSON();
   animation.currentTime=180;
   const to=moving.getBoundingClientRect().toJSON();
   const destination=document.querySelector('[aria-label="c2 红马"] .piece').getBoundingClientRect().toJSON();
   return {before,from,to,destination,readyBeforePaint,style:moving.getAttribute('style')};
  },{flipped,enlarged});
  console.log(JSON.stringify({width,flipped,enlarged,...result}));
  assert(result.readyBeforePaint,'Animation must be ready before the first paint to avoid flashing the final position');
  const center=r=>[r.x+r.width/2,r.y+r.height/2];
  assert(Math.hypot(...center(result.from).map((v,i)=>v-center(result.before)[i]))<1,'Moving piece must start at the origin, without jumping');
  assert(Math.hypot(...center(result.to).map((v,i)=>v-center(result.destination)[i]))<1,'Moving piece must finish at the destination, without snapping');
  assert(Math.abs(result.to.width-result.destination.width)<1,'Moving piece must retain its size');
  await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
