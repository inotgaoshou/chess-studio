// Presentation regression using the real solver component and CSS; no service writes.
const {chromium}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462';
const output=process.env.EVIDENCE_DIR||'/tmp/qixi-solver-layout';fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
for(const width of [375,390,430,820])for(const side of ['black','red']){
const page=await browser.newPage({viewport:{width,height:width===375?812:width===390?844:width===430?932:950}});
await page.route('**/layout-harness',r=>r.fulfill({contentType:'text/html',body:'<html><head></head><body><div id="root"></div></body></html>'}));await page.goto(base+'/layout-harness');
await page.evaluate(async(side)=>{
const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import('/src/styles.css');const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;const {MobilePracticeSolverPanel}=await import('/src/App.tsx');
document.documentElement.classList.add(innerWidth<768?'phone-webview':'tablet-webview');
const props={answersAllowed:false,problem:{id:side+'-mate',title:(side==='black'?'黑':'红')+'方绝杀',startingFen:'4k4/9/9/9/9/9/9/9/4r4/4K4 b',source:'local',note:'',solution:[],trainingGoal:{kind:'mate',mateMoves:1,solverSide:side==='black'?'b':'w'}},pieces:[{row:0,col:4,color:'black',kind:'king',label:'将'},{row:8,col:3,color:'black',kind:'rook',label:'车'},{row:9,col:4,color:'red',kind:'king',label:'帅'}],legalTargets:[],hints:0,mistakes:0,elapsed:'00:12',ended:false,revealed:false,notice:'可尝试其他解法，皮卡鱼复核后判题；提示和错误会记录到练习档案。',boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,favoriteEnabled:false,backLabel:'返回题库',answer:[],answerStep:0,demoPlaying:false,navigator:{index:0,items:[{id:'one',title:'一题',status:'pending'},{id:'two',title:'二题',status:'pending'}],onSelect(){}}};
for(const key of ['onSquare','onMove','onBack','onHint','onRestart','onReveal','onNext','onPrevious','onFinish','onFavorite','onPreviewStep','onTogglePreview','onRetryWrongMove'])props[key]=()=>{};
const root=createRoot(document.getElementById('root'));window.draw=(extra={})=>root.render(React.createElement('div',{className:'training-app mobile-layout tablet-navigation-bottom'},React.createElement(MobilePracticeSolverPanel,{...props,...extra})));window.draw();
},side);
await page.waitForFunction(()=>document.querySelector('.mobile-solver-page')?.style.getPropertyValue('--solver-board-fit-width'));
await page.waitForTimeout(150);const rect=()=>page.locator('.mobile-solver-board .board-shell').boundingBox();const before=await rect();
await page.screenshot({path:`${output}/${side}-${width}-before.png`});
await page.evaluate(()=>window.draw({ended:true,resultOutcome:'completed',feedback:'checkmate'}));
for(const delay of [50,150,500]){
 await page.waitForTimeout(delay);const after=await rect();
 assert(Math.abs(before.width-after.width)<1&&Math.abs(before.y-after.y)<1&&Math.abs(before.x-after.x)<1,'Checkmate must not move or resize board: '+JSON.stringify({width,side,before,after}));
}
await page.screenshot({path:`${output}/${side}-${width}-completed.png`});
await page.evaluate(()=>window.draw({ended:true,resultOutcome:'completed'}));
await page.waitForTimeout(50);const after=await rect();
assert(Math.abs(before.width-after.width)<1&&Math.abs(before.y-after.y)<1,'Removing feedback must not move the board');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
console.log(JSON.stringify({width,side,before,after}));await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
