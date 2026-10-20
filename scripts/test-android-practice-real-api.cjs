// Real test API acceptance. No request interception; use only a disposable emulator.
// PRACTICE_REAL_ACCOUNTS is a private JSON file: [{label, account, password, role}].
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { _android } = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serial = process.env.PRACTICE_ANDROID_SERIAL || 'emulator-5582';
const packageId = process.env.PRACTICE_ANDROID_PACKAGE || 'cn.xiangqi.endgame.training.practiceentry';
const api = 'https://api-test.qixiapp.cn';
const problemId = process.env.PRACTICE_REAL_PROBLEM || '2a5bec26-d430-57db-bd80-19e94bc222d6';
(async () => {
 assert(serial.startsWith('emulator-'), 'Use a disposable emulator');
 assert(process.env.PRACTICE_REAL_ACCOUNTS, 'Provide the private test account file');
 const accounts = JSON.parse(fs.readFileSync(process.env.PRACTICE_REAL_ACCOUNTS, 'utf8'));
 const device = (await _android.devices()).find(d => d.serial() === serial); assert(device);
 try {
  const view = (await device.webViews()).find(v => v.pkg() === packageId); assert(view, 'Open debug APK first');
  const page = await view.page(); page.setDefaultTimeout(22000);
  await page.unrouteAll({behavior:'ignoreErrors'});
  for (const account of accounts) {
   const actual = await page.evaluate(async ({api,account}) => {
    const response = await fetch(api+'/api/v1/auth/login', {method:'POST',headers:{'content-type':'application/json','x-xiangqi-app-id':'endgame-training'},body:JSON.stringify({account:account.account,password:account.password})});
    if(!response.ok) throw new Error('Test login HTTP '+response.status);
    const auth=await response.json();
    localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');
    await Capacitor.registerPlugin('SecureSession').save({session:JSON.stringify({...auth,auth,serverUrl:api,deviceId:'practice-entry-real-emulator'})});
    return {role:auth.user.role,vip:!!auth.user.vipActive};
   }, {api,account});
   assert.equal(actual.role,account.role);console.log(account.label+': real login passed');
   let creates=0,grades=0; const verdicts=[],failures=[];
   const request=r=>{const u=new URL(r.url());if(u.origin!==api)return;if(r.method()==='POST'&&u.pathname.endsWith('/practice/sessions'))creates++;if(r.method()==='POST'&&u.pathname.endsWith('/attempts'))grades++;};
   const response=async r=>{const u=new URL(r.url());if(u.origin!==api)return;if(r.status()>=400&&/\/(auth|practice|problems|teaching-catalog)(?:\/|$)/.test(u.pathname))failures.push({path:u.pathname,status:r.status()});if(u.pathname.endsWith('/verify-move')&&r.ok()){const result=await r.json();verdicts.push({candidate:r.request().postDataJSON().candidate,outcome:result.outcome,completed:result.completed,path:result.path});}};
   page.on('request',request);page.on('response',response);
   try {
    await page.goto('https://localhost/library');
    await page.getByRole('button',{name:/基础杀法.*可练题/}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new Event('teaching-content-reset')));
    await page.getByRole('button',{name:/基础杀法.*可练题/}).click();
    const card=page.locator('.catalog-problem-card').filter({hasText:process.env.PRACTICE_REAL_TITLE || 'TEST_ONLY 炮目录验收一步杀'}).first();await card.waitFor();
    const detailResponse=page.waitForResponse(r=>r.url()===`${api}/api/v1/${actual.role==='student'?'student':'admin'}/problems/${problemId}`);
    await card.getByRole('button',{name:'看题解',exact:true}).click();
    const rawDetail=await detailResponse;assert.equal(rawDetail.status(),200,'Read-only detail must be deployed');const detail=await rawDetail.json();
    const viewer=page.getByRole('dialog',{name:'只读题解'});await viewer.waitFor();assert.equal(creates,0);assert.equal(grades,0);
    assert(detail.solution.length,'Real fixture requires a solution');
    await viewer.getByRole('button',{name:'下一步',exact:true}).click();
    await viewer.getByRole('button',{name:'上一步',exact:true}).waitFor({state:'visible'});
    await viewer.getByRole('button',{name:'关闭题解'}).click();
    console.log(account.label+': independent read passed');
    await card.locator('button').first().click();await page.locator('.mobile-solver-page').waitFor();
    if(await page.getByRole('button',{name:'再试一次',exact:true}).count())await page.getByRole('button',{name:'再试一次',exact:true}).click();
    const board=page.locator('.mobile-solver-page .xiangqi-board');
    const candidate=detail.solution[0].iccs;
    if(process.env.PRACTICE_REAL_TRIAL==='1'&&account.label==='ordinary') {
     assert.equal(detail.startingFen,'4k4/3R5/R3P4/9/9/9/9/9/9/4K4 w - - 0 1','Use the reviewed test-only trial fixture');
     await board.getByRole('button',{name:'e0 红帅',exact:true}).click();
     await board.getByRole('button',{name:'d0',exact:true}).click();
     for(let n=0;n<300&&!verdicts.some(v=>v.candidate==='e0d0');n++)await page.waitForTimeout(100);
     assert.equal(verdicts.find(v=>v.candidate==='e0d0')?.outcome,'wrong','Real server must reject the missed mate');
     await page.getByText('试走中，未计为答对；可继续走棋或退回重试。',{exact:true}).waitFor({timeout:16000});
     await board.getByRole('button',{name:'d0 红帅',exact:true}).waitFor();
     await board.getByRole('button',{name:'f9 黑将',exact:true}).waitFor();
     assert.equal(await page.locator('.mobile-solver-result').count(),0);assert.equal(grades,0);
     await page.screenshot({path:'/tmp/practice-real-wrong-ai.png'});
     await page.getByRole('button',{name:/^退回重试/}).click();
     await board.getByRole('button',{name:'e0 红帅',exact:true}).waitFor();
     console.log(JSON.stringify({realWrong:true,aiReply:true,noGrade:true,trialBoard:true,returnToAccepted:true}));
     verdicts.length=0;
    }

    await board.getByRole('button',{name:new RegExp('^'+candidate.slice(0,2)+'(?: |$)')}).click();
    await board.getByRole('button',{name:new RegExp('^'+candidate.slice(2)+'(?: |$)')}).click();
    for(let n=0;n<250&&!verdicts.length;n++)await page.waitForTimeout(100);
    assert(verdicts.length,'Must receive a real server verdict, not local fallback');
    assert(['correct','completed'].includes(verdicts[0].outcome), 'Fixture solution must receive a correct verdict');
    await page.locator('.mobile-solver-result').waitFor();
    await page.getByRole('button',{name:'再试一次',exact:true}).click();
    await board.getByRole('button',{name:new RegExp('^'+candidate.slice(0,2)+'(?: |$)')}).waitFor();
    await page.getByRole('button',{name:'返回题库',exact:true}).click();await card.waitFor();
    assert.equal(creates,actual.role==='student'?1:0);if(actual.role!=='student')assert.equal(grades,0);
    assert.deepEqual(failures,[], 'Real API errors');
    await page.screenshot({path:`/tmp/practice-real-${account.label}.png`});
    console.log(JSON.stringify({label:account.label,role:actual.role,vip:actual.vip,creates,grades,verdict:verdicts[0].outcome,readOnly:true,retry:true,returnToList:true}));
   } finally {page.off('request',request);page.off('response',response);}
  }
 } finally {await device.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
