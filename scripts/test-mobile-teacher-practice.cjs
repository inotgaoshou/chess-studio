const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = process.env.TEACHER_URL || 'http://127.0.0.1:1441';
const nativeMode = process.env.TRIAL_NATIVE === '1';
const replyNotice = nativeMode ? /AI（Pikafish）应招：/ : /云库应招：/;
const fen = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
async function verifyBoardAppearance(board) {
  const squareAppearance = await board.locator('.board-square').first().evaluate(square => {
    const style = getComputedStyle(square);
    const image = square.querySelector('.piece');
    return { background: style.backgroundColor, border: style.borderTopWidth, padding: style.paddingTop,
      pieceRatio: image.getBoundingClientRect().width / square.getBoundingClientRect().width };
  });
  assert.equal(squareAppearance.background, 'rgba(0, 0, 0, 0)', 'board intersections must remain transparent, not white form buttons');
  assert.equal(squareAppearance.border, '0px', 'form button borders must not cover board lines');
  assert.equal(squareAppearance.padding, '0px', 'form button padding must not shrink pieces');
  assert(squareAppearance.pieceRatio >= 0.8, 'pieces must fill their board hit targets');
}
async function startBoardStability(page) {
  await page.evaluate(() => {
    window.boardFrames = [];
    window.recordBoardFrames = true;
    function record() {
      const board = document.querySelector('.teacher-assignment-practice .teacher-trial-board');
      if (board) {
        const { x, y, width, height } = board.getBoundingClientRect();
        window.boardFrames.push({ x, y, width, height });
      }
      if (window.recordBoardFrames) requestAnimationFrame(record);
    }
    record();
  });
}
async function verifyBoardStability(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const frames = await page.evaluate(() => { window.recordBoardFrames = false; return window.boardFrames; });
  assert(frames.length > 2, 'sample the board throughout the opponent reply');
  for (const dimension of ['x', 'y', 'width', 'height']) {
    const values = frames.map(frame => frame[dimension]);
    assert(Math.max(...values) - Math.min(...values) <= 1, `board ${dimension} must remain stable throughout moves/status/replies: ${Math.min(...values)} to ${Math.max(...values)}`);
  }
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [{width:390,height:844},{width:800,height:1280},{width:1280,height:800}]) {
      const page = await browser.newPage({viewport,isMobile:true,hasTouch:true});
      const errors=[], posts=[];
      let total=53, fail=false;
      let cloudFailure=false;
      let cloudRequests=0;
      page.on('pageerror',e=>errors.push(e.message));
      if(nativeMode) await page.route('**/src/wasm.ts*',async route=>{
        const response=await route.fetch();
        const body=(await response.text()).replace(/import \{ Capacitor, registerPlugin \} from [^;]+;/,`const Capacitor={isNativePlatform:()=>true,getPlatform:()=>"ios"}; const registerPlugin=name=>name==="Pikafish"?{bestMove:async ({fen,moveTimeMs})=>{(window.engineRequests??=[]).push({fen,moveTimeMs});await new Promise(r=>setTimeout(r,100));if(window.engineUnavailable)throw new Error("offline");return {iccs:fen.split(/\\s+/)[1]==="b"?"h9g7":"h0g2"};},cancel:async()=>{}}:{query:async()=>{throw new Error("offline")}};`);
        await route.fulfill({response,body});
      });
      await page.route('https://www.chessdb.cn/**', async route => {
        cloudRequests++;
        await new Promise(r => setTimeout(r, 160));
        if(cloudFailure) { await route.abort(); return; }
        const move=new URL(route.request().url()).searchParams.get('board').split(/\s+/)[1]==='b'?'h9g7':'h0g2';
        await route.fulfill({contentType:'text/plain',body:`move:${move},score:20,winrate:52`});
      });
      await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','https://api-test.qixiapp.cn');});
      await page.route('**/api/v1/**',async route=>{
        const req=route.request(), url=new URL(req.url()), path=url.pathname;
        if(req.method()==='POST' && !path.endsWith('/auth/refresh')) posts.push({path,body:req.postDataJSON()});
        let body=[];
        if(path.endsWith('/auth/refresh')) body={token:'teacher',expiresAt:'2099-01-01',user:{id:'teacher',orgId:'org',role:'coach',displayName:'老师'}};
        else if(path.endsWith('/admin/assignments')) body=[{id:'a',title:'教师核实作业',status:'published',itemCount:total}];
        else if(path.endsWith('/results/summary')) body={recipientCount:0,partialSubmissionCount:0,fullSubmissionCount:0,fullySolvedCount:0,completedProblemCount:0,assignedProblemCount:total,completionRate:0,averageTotalScore:null};
        else if(path.endsWith('/a/results')) body=[{studentId:'student',loginName:'fixture',displayName:'核实学生',totalCount:total,submittedCount:0,completedCount:0,firstTryCorrectCount:0}];
        else if(path.endsWith('/students/student/results')) body={items:Array.from({length:Math.min(50,total)},(_,order)=>({problemId:'p'+order,order,title:'学生回放题'+(order+1),completed:false,firstTryCorrect:false})),nextCursor:total>50?'50':null};
        else if(path.includes('/students/student/problems/')) body={startingFen:fen,moves:null};
        else if(path.endsWith('/a/problems')) {
          await new Promise(r=>setTimeout(r,100));
          if(fail){fail=false;await route.fulfill({status:500,contentType:'application/json',body:'{"error":"题目读取暂时失败"}'});return;}
          const offset=Number(url.searchParams.get('cursor')||0);
          const fixtures={48:fen.replace(' w ',' b '),49:'4k4/3R1R3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',50:'4k4/3R5/5R3/9/9/9/9/9/9/3K5 w - - 0 1'};
          body={items:url.searchParams.get('withdrawn')==='true'?[]:Array.from({length:Math.min(50,total-offset)},(_,i)=>({problemId:'p'+(offset+i),slotId:'p'+(offset+i),originalProblemId:'p'+(offset+i),order:offset+i,title:'试做题'+(offset+i+1),startingFen:fixtures[offset+i]||fen,note:'用于核实题目',solution:[{iccs:'h2e2',comment:'平炮',children:[{iccs:'h9g7',comment:'上马',children:[]}]},{iccs:'h2g2',comment:'另一平炮变招',children:[{iccs:'h9g7',comment:'应招上马',children:[]}]}],withdrawn:false})),nextCursor:offset+50<total?String(offset+50):null};
        } else if(path.includes('/problem-slots/')) {body={problemId:'revised'};if(req.postDataJSON().action==='withdraw')total--;}
        await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      });
      page.on('dialog',dialog=>dialog.accept());
      await page.goto(base+'/teacher');await page.getByText('教师核实作业',{exact:true}).click();
      await page.getByRole('button',{name:'教师试做／检查与修改题目',exact:true}).click({timeout:5000}).catch(async e=>{console.log(errors,(await page.locator('body').innerText()).slice(0,1000));throw e;});
      await page.getByRole('heading',{name:'试做题1',exact:true}).waitFor();
      assert.equal(await page.getByRole('navigation',{name:'教师底部导航'}).isVisible(),false);
      assert.equal(await page.getByRole('button',{name:'查看已撤回题目',exact:true}).isVisible(),false);
      const boardTop=await page.locator('.teacher-trial-board').evaluate(e=>e.getBoundingClientRect().top);
      const pageTop=await page.locator('.teacher-assignment-detail').evaluate(e=>e.getBoundingClientRect().top);
      assert(boardTop-pageTop<200,'compact header gives the board priority');
      const board=page.locator('.teacher-trial-board');
      await board.locator('.piece').first().waitFor();
      await verifyBoardAppearance(board);
      await board.screenshot({path:`tmp/teacher-board-fixed-${viewport.width}.png`});
      // Use board square hit targets; teacher trial is legal free play and auto-answers matching defenses.
      await page.evaluate(()=>window.retainedTrialBoard=document.querySelector('.teacher-trial-board .xiangqi-board'));
      const before=await board.locator('.piece').count();
      await board.locator('.board-square').nth(7 * 9 + 7).click();
      await startBoardStability(page);
      await board.locator('.board-square').nth(7 * 9 + 4).click();
      await page.getByText(replyNotice).waitFor();
      await verifyBoardStability(page);
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('qixi-teacher-trial-v1:')&&JSON.parse(localStorage[k]||'null')?.moves?.join(',')==='h2e2,h9g7')));
      await page.getByRole('button',{name:'重新试做',exact:true}).click();
      // A legal move outside the saved answer still receives an opponent response.
      await board.locator('.board-square').nth(7*9+7).click();await board.locator('.board-square').nth(7*9+5).click();
      await page.getByText(replyNotice).waitFor();
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('qixi-teacher-trial-v1:')&&JSON.parse(localStorage[k]||'null')?.moves?.join(',')==='h2f2,h9g7')));
      await page.getByRole('button',{name:'上一步',exact:true}).click();
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('qixi-teacher-trial-v1:')&&JSON.parse(localStorage[k]||'null')?.moves?.length===0)));
      cloudFailure=true;
      if(nativeMode) await page.evaluate(()=>window.engineUnavailable=true);
      await board.locator('.board-square').nth(7*9+7).click();await startBoardStability(page);await board.locator('.board-square').nth(7*9+5).click();
      await page.getByRole('button',{name:'重试应招',exact:true}).waitFor();
      await verifyBoardStability(page);
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('qixi-teacher-trial-v1:')&&JSON.parse(localStorage[k]||'null')?.moves?.join(',')==='h2f2')));
      cloudFailure=false;if(nativeMode)await page.evaluate(()=>window.engineUnavailable=false);
      await page.getByRole('button',{name:'重试应招',exact:true}).click();await page.getByText(replyNotice).waitFor();
      // Viewing and jumping through the saved answer must not erase actual trial moves.
      const practiceBeforeAnswer = await page.evaluate(()=>localStorage[Object.keys(localStorage).find(k=>k.endsWith(':p0'))]);
      await page.getByRole('button',{name:'看答案',exact:true}).click();
      const answerPanel = page.getByRole('region',{name:'保存题解'});
      await answerPanel.getByText('平炮',{exact:true}).waitFor();
      assert.equal(await answerPanel.locator('.teacher-trial-answer-row').count(),2);
      await answerPanel.getByLabel('第 1 手变招',{exact:true}).selectOption('h2g2');
      await answerPanel.getByText('另一平炮变招',{exact:true}).waitFor();
      assert.equal(await answerPanel.locator('[aria-current=step]').count(),1);
      await answerPanel.locator('.teacher-trial-answer-row button').nth(1).click();
      assert.equal(await page.evaluate(()=>localStorage[Object.keys(localStorage).find(k=>k.endsWith(':p0'))]),practiceBeforeAnswer);
      await page.getByRole('button',{name:'继续试做',exact:true}).click();
      assert.equal(await page.evaluate(()=>localStorage[Object.keys(localStorage).find(k=>k.endsWith(':p0'))]),practiceBeforeAnswer);
      await page.getByRole('button',{name:'重新试做',exact:true}).click();
      // Controls also exercise WASM and draft persistence without sending any student submissions.
      await page.getByRole('button',{name:'提示',exact:true}).click();await page.getByText(/题解提示：/).waitFor();
      await page.getByRole('button',{name:'看答案',exact:true}).click();await page.getByRole('button',{name:'下一步',exact:true}).click();
      await page.getByRole('button',{name:'上一步',exact:true}).waitFor();
      assert.equal(await board.locator('.piece').count(),before);
      assert.equal(posts.filter(r=>r.path.includes('/student/')).length,0);
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.endsWith(':p0')&&JSON.parse(localStorage[k]||'null')?.moves?.length===0)),'answer replay remains separate from persisted trial progress');
      await page.getByRole('button',{name:'展开题号',exact:true}).click();
      await page.getByRole('button',{name:'试做第 49 题',exact:true}).click();await page.getByRole('heading',{name:'试做题49',exact:true}).waitFor();
      await board.locator('.board-square').nth(0*9+7).click();await board.locator('.board-square').nth(2*9+6).click();await page.getByText(replyNotice).waitFor();
      assert(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.endsWith(':p48')&&JSON.parse(localStorage[k]||'null')?.moves?.join(',')==='h9g7,h0g2')),'black-start teacher receives a red reply');
      await page.getByRole('button',{name:'试做第 50 题',exact:true}).click();await page.getByRole('heading',{name:'试做题50',exact:true}).waitFor();
      const beforeMate=cloudRequests;
      await board.locator('.board-square').nth(2*9+4).click();await startBoardStability(page);await board.locator('.board-square').nth(1*9+4).click();
      await page.locator('.teacher-trial-outcome').filter({hasText:'绝杀（将死） · 红方获胜'}).waitFor();assert.equal(cloudRequests,beforeMate,'no opponent search after checkmate');
      await verifyBoardStability(page);
      await page.getByRole('button',{name:'上一步',exact:true}).click();assert.equal(await page.locator('.teacher-trial-outcome').count(),0,'rewinding clears terminal result');
      await page.getByRole('button',{name:'试做第 51 题',exact:true}).click();await page.getByRole('heading',{name:'试做题51',exact:true}).waitFor();
      await board.locator('.board-square').nth(2*9+5).click();await board.locator('.board-square').nth(1*9+5).click();
      await page.locator('.teacher-trial-outcome').filter({hasText:'困毙 · 红方获胜'}).waitFor();assert.equal(cloudRequests,beforeMate,'no opponent search after stalemate');
      await page.getByRole('button',{name:'试做第 53 题',exact:true}).click();await page.getByRole('heading',{name:'试做题53',exact:true}).waitFor();
      assert(await page.evaluate(()=>window.retainedTrialBoard===document.querySelector('.teacher-trial-board .xiangqi-board')));
      fail=true; // return has been cached, so trigger a refresh fetch failure.
      await page.getByRole('button',{name:'更多题目管理',exact:true}).click();
      await page.getByRole('button',{name:'刷新题目',exact:true}).click();await page.getByRole('alert').waitFor();
      await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByRole('heading',{name:'试做题53',exact:true}).waitFor();
      await page.getByRole('button',{name:'修改／替换／撤回本题',exact:true}).click();
      await verifyBoardAppearance(page.locator('.teacher-trial-board'));
      await page.getByLabel('题目名称',{exact:true}).fill('教师修订题名');await page.getByLabel('题目说明',{exact:true}).fill('长说明\n保留换行和草稿');
      await page.getByRole('button',{name:'返回试做（保留草稿）',exact:true}).click();
      await page.getByRole('button',{name:'修改／替换／撤回本题',exact:true}).click();assert.equal(await page.getByLabel('题目名称',{exact:true}).inputValue(),'教师修订题名');
      await page.getByRole('button',{name:'保存修订并重发本题',exact:true}).click();await page.getByRole('heading',{name:'试做题53',exact:true}).waitFor();
      assert.equal(posts.at(-1).body.action,'edit');assert.equal(posts.at(-1).body.solution[0].children[0].iccs,'h9g7','branches survive editing');
      await page.getByRole('button',{name:'修改／替换／撤回本题',exact:true}).click();await page.getByRole('button',{name:'撤回本题',exact:true}).click();await page.getByRole('heading',{name:'试做题52',exact:true}).waitFor();
      assert.equal(posts.at(-1).body.action,'withdraw');assert.equal(posts.filter(r=>r.path.includes('/student/')).length,0);
      await page.getByRole('button',{name:'返回作业结果',exact:true}).click();
      await page.getByRole('button',{name:/学生姓名：核实学生/}).click();
      await page.getByRole('button',{name:/^2\. 学生回放题2(?:\s|$)/}).click();
      await page.getByRole('button',{name:'试做本题（无需提交）',exact:true}).click();
      await page.getByRole('heading',{name:'试做题2',exact:true}).waitFor();
      assert.equal(await page.locator('.teacher-assignment-practice .teacher-problem-navigation strong').innerText(),'第 2/52 题','trial opens exactly the current replay problem, not the saved last problem');
      await page.locator('.teacher-assignment-practice .board-square').nth(7*9+7).click();await page.locator('.teacher-assignment-practice .board-square').nth(7*9+4).click();
      await page.getByText(replyNotice).waitFor();
      await page.getByRole('button',{name:'返回作业结果',exact:true}).click();await page.getByRole('button',{name:'试做本题（无需提交）',exact:true}).waitFor();
      assert.equal(posts.filter(r=>r.path.includes('/student/')).length,0);
      if(nativeMode){assert.equal(cloudRequests,0,'native engine handles replies without browser cloud requests');assert((await page.evaluate(()=>window.engineRequests)).every(r=>r.moveTimeMs===800));}
      assert.deepEqual(errors,[]);console.log(`teacher practice/edit (${nativeMode?'native bridge':'cloud'}): ${viewport.width}x${viewport.height} passed`);await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
