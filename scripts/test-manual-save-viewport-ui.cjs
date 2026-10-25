const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');const out=process.env.EVIDENCE_DIR||'/tmp/qixi-manual-save';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 for(const size of [{width:1024,height:768},{width:768,height:1024},{width:390,height:844}]){
  const page=await browser.newPage({viewport:size,screen:size,hasTouch:true,timezoneId:'Asia/Shanghai'});page.setDefaultTimeout(5000);
  await page.addInitScript(()=>Object.defineProperty(navigator,'maxTouchPoints',{get:()=>5}));
  await page.route('**/save-harness',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto((process.env.PRACTICE_URL||'http://127.0.0.1:1462')+'/save-harness');
  await page.evaluate(async()=>{
   const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;
   await import('/src/styles.css');const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;const {ManualSaveDialog}=await import('/src/ManualSaveDialog.tsx');const {installInputViewport}=await import('/src/inputViewport.ts');
   document.documentElement.classList.add(innerWidth<600?'phone-webview':'tablet-webview','touch-webview');installInputViewport();
   const game={id:'viewport',title:'横屏测试棋谱',note:'保留备注',moves:['b0c2'],branches:[],comments:{b0c2:'保留注释'},startingFen:'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',cursor:1,createdAt:'2026-10-25T11:55:23Z',updatedAt:'2026-10-25T11:55:23Z',metadata:{event:'秋季赛',redPlayer:'甲',blackPlayer:'乙',playedAt:'2026-10-25T11:55:23Z',gameType:'full',result:'unknown'}};
   createRoot(document.getElementById('root')).render(React.createElement(ManualSaveDialog,{game,folders:[],onSave:async values=>{window.saved=values;},onCreateFolder:async()=>{},onClose:()=>{window.saveClosed=true;}}));
  });
  const dialog=page.getByRole('dialog',{name:'保存棋谱',exact:true});await dialog.waitFor();await page.screenshot({path:`${out}/full-${size.width}.png`});
  assert.equal(await page.evaluate(()=>document.activeElement instanceof HTMLInputElement),false,'Opening save must not automatically summon the keyboard');
  await dialog.getByText('2026-10-25 19:55',{exact:true}).waitFor();
  const reduced=size.width===1024?380:420;await dialog.getByLabel('归属赛事',{exact:true}).focus();await page.setViewportSize({width:size.width,height:reduced});await page.waitForFunction(()=>document.documentElement.classList.contains('keyboard-open'));
  const body=dialog.locator('.manual-save-body');
  for(const name of ['棋谱名称','归属赛事','红方棋手','黑方棋手','对局日期','对局时刻','备注']){
   const input=dialog.getByLabel(name,{exact:true});await input.focus();await page.waitForTimeout(80);
   const boxes=await input.evaluate(el=>{const a=el.closest('label').getBoundingClientRect(),b=el.closest('.manual-save-body').getBoundingClientRect();return {label:{top:a.top,bottom:a.bottom},body:{top:b.top,bottom:b.bottom}};});
   assert(boxes.label.top>=boxes.body.top-1&&boxes.label.bottom<=boxes.body.bottom+1,`${name} label and input must remain visible: ${JSON.stringify(boxes)}`);
  }
  await body.evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:`${out}/keyboard-${size.width}.png`});
  const footer=await dialog.locator('footer').boundingBox();assert(footer.y>=0&&footer.y+footer.height<=reduced+1,'Save footer must remain above keyboard');assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await dialog.getByRole('button',{name:'收起键盘',exact:true}).click();await page.setViewportSize(size);await page.waitForTimeout(100);await dialog.getByLabel('对局日期',{exact:true}).fill('2026-10-24');await dialog.getByLabel('对局时刻',{exact:true}).fill('08:30');await dialog.getByRole('button',{name:'保存棋谱',exact:true}).click();await page.waitForFunction(()=>window.saveClosed);assert.equal(await page.evaluate(()=>window.saved.metadata.playedAt),'2026-10-24T00:30:00.000Z');await page.close();console.log('PASS save viewport, field labels, date/time and roundtrip',size.width);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
