const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-study-board-space';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(evaluation=>{Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5});localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-training-study-evaluation',String(evaluation));},process.env.STUDY_EVALUATION==='1');
 await page.route('**/api/v1/**',route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));
 await page.route('**/chessdb.php**',route=>route.fulfill({body:'status:unknown'}));
 await page.goto(base+'/tools/study',{waitUntil:'domcontentloaded'});
 const board=page.locator('.study-play-board-area > .board-shell');await board.waitFor();
 for(const [width,height] of [[320,740],[390,844],[430,932],[390,1100],[844,390],[820,1180],[1180,820]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);
  const before=await board.boundingBox(),sidebar=await page.locator('.study-sidebar').boundingBox();
  const area=await page.locator('.study-play-board-area').boundingBox();assert(Math.abs(before.y-area.y)<=1,'Study board must align to the top instead of centering in empty space');
  assert(before.width>=Math.min(width-42,250)&&before.height>210,JSON.stringify({width,height,before}));
  if(width<600)assert(before.width>=width-42,'Portrait study board uses the phone width');
  assert(before.y>=0&&before.y+before.height<=height&&before.x>=0&&before.x+before.width<=width,'Board fits the viewport');
  assert(before.y+before.height<=sidebar.y+1||before.x+before.width<=sidebar.x+1,'Panel must not cover the board');
  if(width<height)assert(sidebar.y-(before.y+before.height)<=16,'Replay controls must follow the board without unused vertical space: '+JSON.stringify({before,sidebar}));
  for(const tab of ['引擎','云库','棋谱']){
   await page.getByRole('tab',{name:tab,exact:true}).click();await page.waitForTimeout(80);const after=await board.boundingBox();
   for(const key of ['x','y','width','height'])assert(Math.abs(before[key]-after[key])<=1,'Tab must not resize the study board');
  }
  await page.screenshot({path:`${out}/study-${width}x${height}.png`});console.log('PASS study board and panel',width,height,before);
 }
 assert.deepEqual(errors,[]);await page.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
