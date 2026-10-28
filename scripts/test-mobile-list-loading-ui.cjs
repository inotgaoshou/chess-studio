const assert=require('node:assert/strict');
const {chromium}=require('/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {responseFor}=require('./mobile-library-fixtures.cjs');
const origin=process.env.LIST_URL||'http://127.0.0.1:1452';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const held=[];let gameRequests=0;
  await page.route('**/api/v1/**',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/platform-game-libraries')){gameRequests++;held.push(route);return;}
   await route.fulfill({contentType:'application/json',body:JSON.stringify(responseFor(url,route.request().method()))});
  });
  await page.addInitScript(()=>{localStorage.setItem('xiangqi-training-mobile-onboarding-v1','done');localStorage.setItem('xiangqi-teaching-session-server','http://127.0.0.1:8090');document.documentElement?.classList.add('tablet-webview');});
  await page.goto(origin+'/home');
  const home=page.locator('.mobile-home-page');await home.waitFor();
  await page.waitForFunction(()=>document.body.textContent.includes('题库与棋谱'));
  try{
   await home.getByRole('button',{name:/题库与棋谱.*20 题/}).waitFor({timeout:1500});
   assert(gameRequests>0,'slow game-library request must be in flight');
   console.log('PASS: available question count appears while game libraries are still loading');
  }finally{
   for(const route of held)await route.fulfill({contentType:'application/json',body:JSON.stringify(responseFor(new URL(route.request().url())))}).catch(()=>{});
  }
  await page.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
