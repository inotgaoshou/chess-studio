const assert=require('node:assert/strict'),fs=require('node:fs');
const {_android}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {auth,responseFor}=require('./catalog-mate-fixtures.cjs');
(async()=>{const device=(await _android.devices()).find(d=>d.serial()==='emulator-5582');assert(device);try{
 const view=(await device.webViews()).find(v=>v.pkg()==='cn.xiangqi.endgame.training.librarystudy');assert(view);const page=await view.page();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(responseFor(new URL(r.request().url())))}));
 await page.evaluate(async auth=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');await Capacitor.registerPlugin('SecureSession').save({session:JSON.stringify({auth,serverUrl:'https://api.qixiapp.cn',token:auth.token,refreshToken:auth.refreshToken,expiresAt:auth.expiresAt,deviceId:'mate-emulator'})});},auth);await page.goto('https://localhost/library');
 const cat=page.getByRole('region',{name:'教学题库目录',exact:true});
 await cat.getByRole('button',{name:/^非连将杀.*可练题/}).click();await cat.getByText('第 1 题 · 2步验证题',{exact:true}).waitFor();assert.equal(await page.locator('.mobile-library-page > div[hidden]').count(),1);
 await cat.getByRole('tab',{name:'四步杀',exact:true}).click();await cat.getByText('第 1 题 · 4步验证题',{exact:true}).waitFor();await cat.getByRole('tab',{name:'一步杀',exact:true}).click();await cat.getByText('暂无匹配题目',{exact:true}).waitFor();
 await cat.getByLabel('更多步数',{exact:true}).selectOption('12');await cat.getByText('第 1 题 · 12步验证题',{exact:true}).waitFor();
 await cat.locator('.catalog-textbooks > summary').click();await cat.getByRole('button',{name:'法题精选-缓杀一',exact:true}).click();await cat.getByText('第 1 题 · 2步验证题',{exact:true}).waitFor();assert.equal(await cat.locator('.catalog-textbooks').getAttribute('open'),null);
 await cat.getByRole('button',{name:'按原书题序浏览',exact:true}).click();await cat.getByText('第 1 题 · 原书缓杀题',{exact:true}).waitFor();await cat.getByText('步数待确认',{exact:true}).waitFor();
 fs.mkdirSync('/tmp/qixi-mate-steps',{recursive:true});await page.screenshot({path:'/tmp/qixi-mate-steps/android-native.png'});
 await cat.getByRole('button',{name:'返回上级目录',exact:true}).click();await cat.getByText('第 1 题 · 12步验证题',{exact:true}).waitFor();await cat.getByRole('button',{name:'返回上级目录',exact:true}).click();await cat.getByRole('button',{name:/^基础杀法.*可练题/}).waitFor();assert.equal(await page.locator('.mobile-library-page > div[hidden]').count(),0);assert.deepEqual(errors,[]);await page.unrouteAll({behavior:'ignoreErrors'});console.log('PASS Android isolated native: exact/empty/long tabs, quiet book direct, unknown fallback, unrelated lists hidden/restored, back selection');
}finally{await device.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
