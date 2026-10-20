// Simulated native callbacks; this does not replace physical-device acceptance.
const assert = require('node:assert/strict');
const path = require('node:path');
const {createRequire} = require('node:module');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const viteRequire = createRequire(require.resolve('vite', {paths:[path.join(__dirname,'../apps/endgame-training')]}));
const {build} = viteRequire('esbuild');

(async () => {
  const bundle = await build({
    stdin:{contents:'import {teachingClient} from "./teaching"; window.testClient=teachingClient;',resolveDir:path.join(__dirname,'../apps/endgame-training/src'),loader:'ts'},
    bundle:true,write:false,format:'iife',platform:'browser',define:{__APP_ENV__:'"test"','import.meta.env':'{}'},
    plugins:[{name:'native-fixture',setup(build){
      build.onResolve({filter:/^\.\/secureSession$/},()=>({path:'native-fixture',namespace:'fixture'}));
      build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const isNativeSessionStore=()=>true; export const secureSession={deviceId:()=>"test-device",load:()=>window.nativeLoad(),save:s=>window.nativeSave(s),clear:async()=>{}};',loader:'ts'}));
    }}],
  });
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    for(const mode of ['restore-load','login-load','login-save','refresh-save']) {
      const page=await browser.newPage();
      await page.route('https://api-test.qixiapp.cn/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
      await page.goto('https://api-test.qixiapp.cn/session-fixture');
      await page.clock.install();
      await page.evaluate(mode=>{
        const auth={token:'fixture-token',refreshToken:'fixture-refresh',expiresAt:'2099-01-01T00:00:00Z',user:{id:'fixture-user',orgId:'fixture-org',role:'student'}};
        window.fixtureAuth=auth;
        window.nativeLoad=()=>mode.endsWith('load')?new Promise(resolve=>window.releaseNative=()=>resolve(undefined)):Promise.resolve({serverUrl:'https://api-test.qixiapp.cn',...auth,auth,deviceId:'test-device'});
        window.nativeSave=()=>new Promise(resolve=>window.releaseNative=resolve);
        window.fetch=async()=>({ok:true,status:200,json:async()=>auth});
      },mode);
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(mode=>{
        const promise=mode==='restore-load'?window.testClient.restore():mode==='refresh-save'?window.testClient.refreshSession():window.testClient.login('fixture','fixture-password');
        promise.then(value=>window.result={ok:true,hasValue:!!value},error=>window.result={ok:false,error:error.message});
      },mode);
      await page.waitForFunction(()=>typeof window.releaseNative==='function');
      await page.clock.runFor(15100);
      await page.waitForFunction(()=>window.result);
      const result=await page.evaluate(()=>window.result);
      assert(mode==='refresh-save'?result.ok&&!result.hasValue:!result.ok&&/超时/.test(result.error),mode);
      await page.evaluate(()=>window.releaseNative());
      await page.waitForTimeout(20);
      assert.equal(await page.evaluate(()=>window.testClient.auth()),undefined,mode+': late callback cannot authenticate');
      console.log('PASS native session deadline and late callback: '+mode);
      await page.close();
    }
    {
      const page=await browser.newPage();
      await page.route('https://api-test.qixiapp.cn/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
      await page.goto('https://api-test.qixiapp.cn/session-fixture');
      await page.clock.install();
      await page.evaluate(()=>{
        window.sentTokens=[];
        window.nativeLoad=async()=>window.persistedSession;
        window.nativeSave=session=>window.holdSave?new Promise(resolve=>{window.releaseNative=()=>{window.persistedSession=session;resolve();};}):Promise.resolve(window.persistedSession=session);
        window.fetch=async(url,init)=>{
          const refresh=url.endsWith('/auth/refresh');
          if(refresh)window.sentTokens.push(JSON.parse(init.body).refreshToken);
          const token=refresh?(window.sentTokens.length===1?'B':'C'):'A';
          return {ok:true,status:200,json:async()=>({token,refreshToken:token,expiresAt:'2099-01-01T00:00:00Z',user:{id:'fixture-user',orgId:'fixture-org',role:'student'}})};
        };
      });
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>window.testClient.login('fixture','fixture-password'));
      await page.evaluate(()=>{window.holdSave=true;window.testClient.refreshSession().then(value=>window.firstRefresh={hasValue:!!value});});
      await page.waitForFunction(()=>typeof window.releaseNative==='function');
      await page.clock.runFor(15100);
      await page.waitForFunction(()=>window.firstRefresh);
      assert.equal(await page.evaluate(()=>window.firstRefresh.hasValue),false);
      await page.evaluate(()=>{window.releaseNative();window.holdSave=false;});
      await page.waitForFunction(()=>window.persistedSession.refreshToken==='B');
      await page.evaluate(()=>window.testClient.refreshSession());
      assert.deepEqual(await page.evaluate(()=>window.sentTokens),['A','B'],'late persisted successor must be used for rotation');
      assert.equal(await page.evaluate(()=>window.testClient.auth()?.refreshToken),'C');
      console.log('PASS native refresh rotation after timed-out save: A -> B -> C');
      await page.close();
    }
    {
      const page=await browser.newPage();
      await page.route('https://api-test.qixiapp.cn/**',route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));
      await page.goto('https://api-test.qixiapp.cn/session-fixture');
      await page.clock.install();
      await page.evaluate(()=>{
        const auth={token:'A',refreshToken:'A',expiresAt:'2099-01-01T00:00:00Z',user:{id:'fixture-user',orgId:'fixture-org',role:'student'}};
        const stored={serverUrl:'https://api-test.qixiapp.cn',...auth,auth,deviceId:'test-device'};
        let loads=0;
        window.nativeLoad=()=>++loads===1?new Promise(resolve=>window.releaseLoad=()=>resolve(stored)):Promise.resolve(stored);
        window.nativeSave=()=>new Promise(resolve=>window.releaseSave=resolve);
        window.fetch=async()=>({ok:true,status:200,json:async()=>({...auth,token:'B',refreshToken:'B'})});
      });
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await page.evaluate(()=>{window.testClient.restore().then(value=>window.restored={hasValue:!!value},()=>window.restored={hasValue:false});});
      await page.waitForFunction(()=>typeof window.releaseLoad==='function');
      await page.clock.runFor(10000);
      await page.evaluate(()=>window.releaseLoad());
      await page.waitForFunction(()=>typeof window.releaseSave==='function');
      await page.clock.runFor(5100);
      await page.waitForFunction(()=>window.restored);
      assert.equal(await page.evaluate(()=>window.restored.hasValue),false);
      await page.evaluate(()=>window.releaseSave());
      await page.waitForTimeout(20);
      assert.equal(await page.evaluate(()=>window.testClient.auth()?.token),'A','expired restore must not commit the late refreshed UI identity');
      console.log('PASS native restore shares total 15-second budget across load and refresh');
      await page.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
