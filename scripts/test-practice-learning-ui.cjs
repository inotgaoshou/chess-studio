// Real solver, skins, WASM and CSS; isolated presentation state, no service writes.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.PRACTICE_URL||'http://127.0.0.1:1462',out=process.env.EVIDENCE_DIR||'/tmp/qixi-practice-learning';fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await(process.env.TEST_WEBKIT?webkit.launch():chromium.launch({channel:'chrome'}));try{
 for(const [width,height] of [[320,568],[320,740],[390,844],[430,932],[844,390],[820,1180],[1180,820]]){
  const page=await browser.newPage({viewport:{width,height},hasTouch:true});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/learning-harness',r=>r.fulfill({contentType:'text/html',body:'<html><head></head><body><div id="root"></div></body></html>'}));await page.goto(base+'/learning-harness');
  await page.evaluate(async()=>{
   const refresh=await import('/@react-refresh');refresh.default.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
   await import('/src/styles.css');const React=(await import('/node_modules/.vite/deps/react.js')).default,{createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,{MobilePracticeSolverPanel}=await import('/src/App.tsx'),{boardAt}=await import('/src/wasm.ts');
   document.documentElement.classList.add(innerWidth<768?'phone-webview':'tablet-webview');
   const fen='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',board=await boardAt(fen,[]);
   const problem={id:'mate-one',libraryId:'local',sourceIndex:0,title:'图1',category:'杀法',startingFen:fen,note:'不要提前展示的答案',solution:[],trainingGoal:{kind:'mate',solverSide:'w',reviewMethod:'reviewed_solution',description:'已有目标的详细内容'},logic:{themes:['作者技术'],firstMoveIdea:'作者首着思路',keyDefense:'作者关键防守',failureReason:'作者易错原因',review:'作者复习要点'}};
   window.fixture=problem;window.stats={hint:0,reveal:0,restart:0,nextGroup:0,select:0,explain:0,play:0};
   const items=Array.from({length:20},(_,i)=>({id:'q'+i,number:i+1,title:'第'+(i+1)+'题',status:i===1?'completed':i===2?'revealed':'pending'}));
   function Harness(){
    const [state,setState]=React.useState({problem,origin:{section:'题库',label:'基础杀法'},accessScope:'coach-one',hints:0,mistakes:1,elapsed:'00:12',ended:false,revealed:false,notice:'个人试做：进度保存在本机。',answersAllowed:true,answerStep:0,demoPlaying:false});window.draw=extra=>setState(p=>({...p,...extra}));
    const callbacks={onSquare(){},onMove(){},onBack(){},onNext(){},onPrevious(){},onFinish(){},onFavorite(){},onRetryWrongMove(){},onHint(){window.stats.hint++;setState(p=>({...p,hints:Math.min(3,p.hints+1),notice:'已有第 '+Math.min(3,state.hints+1)+' 级提示'}));},onReveal(){window.stats.reveal++;setState(p=>({...p,ended:true,revealed:true,resultOutcome:p.ended?p.resultOutcome:'revealed'}));},onRestart(){window.stats.restart++;setState(p=>({...p,ended:false,revealed:false,answerStep:0,demoPlaying:false}));},onPreviewStep(step){setState(p=>({...p,answerStep:step,lastMove:step?'b0c2':undefined}));},onTogglePreview(){window.stats.play++;setState(p=>({...p,demoPlaying:!p.demoPlaying}));},onStopPreview(){setState(p=>({...p,demoPlaying:false}));},onExplainAnswer(){window.stats.explain++;}};
    return React.createElement('div',{className:'training-app mobile-layout tablet-navigation-bottom'},React.createElement(MobilePracticeSolverPanel,{...state,...callbacks,pieces:board.pieces,legalTargets:[],boardSkin:'default',pieceSkin:'default',riverText:'',riverTextColor:'#000',riverTextSize:20,supportsCustomRiverText:false,favoriteEnabled:false,backLabel:'返回题库',answer:['马八进七','马８进７'],commentary:React.createElement('p',{},'此处为受权限保护的着法讲解'),sourceLibraries:[{id:'platform:local',title:'实用残局精选'}],navigator:{index:0,items,onSelect(index){window.stats.select=index;setState(p=>({...p,problem:{...p.problem,id:'q'+index}}));},onNextGroup(){window.stats.nextGroup++;setState(p=>({...p,problem:{...p.problem,id:'next-group'}}));}}}));
   }
   createRoot(document.getElementById('root')).render(React.createElement(Harness));
  });
  await page.waitForFunction(()=>document.querySelector('.mobile-solver-page')?.style.getPropertyValue('--solver-board-fit-width'));
  const geometry=async()=>{await page.evaluate(()=>document.querySelector('.mobile-solver-page').scrollTop=0);await page.waitForTimeout(70);return page.evaluate(()=>Object.fromEntries(['.mobile-solver-heading','.mobile-solver-nav','.mobile-solver-board > .board-shell','.mobile-solver-board .board-square'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [s,[r.x,r.y,r.width,r.height]];})));};
  const stable=(a,b)=>{for(const key in a)a[key].forEach((v,i)=>assert(Math.abs(v-b[key][i])<=1,key+' moved '+JSON.stringify({width,height,a,b})));};
  const initial=await geometry();if(width<600&&height>=740)assert(initial['.mobile-solver-board > .board-shell'][2]>=width-40);
  assert.equal(await page.getByRole('navigation',{name:'数字导航'}).count(),0);
  await page.screenshot({path:`${out}/mate-${width}x${height}.png`});
  await page.locator('.practice-learning-entry').click();let sheet=page.getByRole('dialog',{name:'学习思路'});await sheet.waitFor();stable(initial,await geometry());
  assert.equal(await sheet.getByText('作者首着思路',{exact:true}).count(),0);assert.equal(await sheet.getByText('此处为受权限保护的着法讲解',{exact:true}).count(),0);
  await sheet.getByRole('button',{name:'获取第 1 级提示'}).click();await sheet.getByRole('status').filter({hasText:'已有第 1 级提示'}).waitFor();assert.equal(await page.evaluate(()=>window.stats.hint),1);await sheet.getByRole('button',{name:'关闭学习思路'}).click();
  assert((await page.locator('.mobile-solver-actions').textContent()).includes('提示 1/3'));stable(initial,await geometry());
  await page.evaluate(()=>window.draw({problem:{...window.fixture,id:'endgame-one',title:'实用残局的很长标题'.repeat(12),trainingGoal:{kind:'endgame_win',solverSide:'w',reviewMethod:'reviewed_solution',description:'详细目标'.repeat(100)}},origin:{section:'题库',label:'实用残局'}}));stable(initial,await geometry());
  await page.screenshot({path:`${out}/endgame-${width}x${height}.png`});
  await page.locator('.practice-learning-entry').click();sheet=page.getByRole('dialog',{name:'学习思路'});await sheet.getByText(/比较双方子力/).waitFor();assert.equal(await sheet.getByText('作者首着思路',{exact:true}).count(),0);await page.screenshot({path:`${out}/guide-${width}x${height}.png`});await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});
  await page.locator('.mobile-solver-actions').getByRole('button',{name:'查看解析',exact:true}).click();await page.getByRole('button',{name:'题解下一步',exact:true}).waitFor();stable(initial,await geometry());
  await page.evaluate(()=>window.draw({problem:{...window.fixture,id:'endgame-one',note:'段落说明。\n'.repeat(100)}}));stable(initial,await geometry());
  const scrollArea=page.getByRole('region',{name:'练习操作与题解'});
  await scrollArea.evaluate(e=>e.scrollTop=e.scrollHeight);
  assert((await scrollArea.evaluate(e=>e.scrollTop))>0,'Lower practice content must scroll independently');stable(initial,await geometry());
  assert.equal(await page.locator('.mobile-solver-page').evaluate(e=>e.scrollTop),0,'The page and board must not scroll');
  await scrollArea.evaluate(e=>e.scrollTop=0);
  await page.getByRole('button',{name:'题解下一步',exact:true}).click();await page.getByRole('button',{name:'播放题解',exact:true}).click();
  for(const step of [2,0,1]){await page.evaluate(step=>window.draw({answerStep:step,notice:'状态文字变长'.repeat(30)}),step);stable(initial,await geometry());}
  await page.locator('.practice-learning-entry').click();sheet=page.getByRole('dialog',{name:'学习思路'});await sheet.getByText('作者首着思路',{exact:true}).waitFor();await sheet.getByText('此处为受权限保护的着法讲解',{exact:true}).waitFor();await page.getByRole('button',{name:'暂停预演',exact:true}).waitFor({state:'hidden'});
  await sheet.getByRole('button',{name:'关闭学习思路'}).click();assert.equal(await page.getByRole('button',{name:'暂停预演',exact:true}).count(),0,'Closing teaching pauses replay');
  await page.getByRole('button',{name:'讲解这步',exact:true}).first().click();await sheet.waitFor();assert.equal(await page.evaluate(()=>window.stats.explain),1);
  await page.evaluate(()=>window.draw({accessScope:'student',answersAllowed:false}));await sheet.waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'题解下一步',exact:true}).count(),0);await page.locator('.practice-learning-entry').click();await sheet.getByText(/具体题解与着法讲解遵循当前账号/).waitFor();assert.equal(await sheet.getByText('作者首着思路',{exact:true}).count(),0);assert.equal(await sheet.getByText('此处为受权限保护的着法讲解',{exact:true}).count(),0);
  await page.evaluate(()=>window.draw({accessScope:'coach-two',answersAllowed:true,ended:true,revealed:false,resultOutcome:'completed'}));await sheet.waitFor({state:'hidden'});await page.locator('.practice-learning-entry').click();await sheet.getByRole('button',{name:'查看题解与回放',exact:true}).click();assert.equal(await page.evaluate(()=>window.stats.reveal),2);await sheet.waitFor({state:'hidden'});
  await page.locator('.practice-learning-entry').click();await sheet.getByRole('button',{name:'遮住解析，重新做一遍',exact:true}).click();await sheet.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.stats.restart),1);assert((await page.locator('.mobile-solver-actions').textContent()).includes('提示 1/3'));stable(initial,await geometry());
  await page.locator('.mobile-problem-navigator-trigger').click();await page.getByRole('listitem',{name:/第 2 题.*已完成/}).waitFor();await page.getByRole('listitem',{name:/第 3 题.*已查看解析/}).waitFor();await page.getByRole('button',{name:'下一组',exact:true}).click();assert.equal(await page.evaluate(()=>window.stats.nextGroup),1);stable(initial,await geometry());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log('PASS learning '+width+'x'+height+' '+JSON.stringify(initial['.mobile-solver-board > .board-shell']));await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
