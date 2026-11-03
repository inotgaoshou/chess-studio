// Emulator-only: requires the complete 204-video library and final family APK.
// Exercises real native background events, force-stop and non-destructive overlay installation.
const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {_android}=require(process.env.PLAYWRIGHT_MODULE_PATH || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serial=process.env.VIDEO_TEST_SERIAL||'emulator-5554';assert(serial.startsWith('emulator-'),'emulator only');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const adb=(...args)=>execFileSync(process.env.ADB_BIN||`${process.env.HOME}/Library/Android/sdk/platform-tools/adb`,['-s',serial,...args],{stdio:'pipe'});
(async()=>{let d=(await _android.devices()).find(d=>d.serial()===serial);try{
const view=async()=>{for(let i=0;i<100;i++){const v=(await d.webViews()).find(v=>v.pkg()==='cn.xiangqi.endgame.training.family');if(v)return v.page();await sleep(100)}throw Error('no view')};let p=await view();await p.goto('https://localhost/video-learning');p.setDefaultTimeout(15000);await p.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
await p.locator('video').evaluate(async v=>{v.currentTime=233;await new Promise(r=>v.addEventListener('seeked',r,{once:true}));await v.play()});await p.waitForFunction(()=>document.querySelector('video').currentTime>233.5);
adb('shell','input','keyevent','KEYCODE_HOME');await sleep(1500);
// Android can detach the WebView debugging target while the app is backgrounded.
// Reattach after foregrounding instead of querying a closed CDP page.
await d.close();adb('shell','am','start','-n','cn.xiangqi.endgame.training.family/cn.xiangqi.endgame.training.MainActivity');
d=(await _android.devices()).find(d=>d.serial()===serial);p=await view();await p.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
const paused=await p.locator('video').evaluate(v=>v.paused);assert(paused,'background paused');
const before=await p.evaluate(()=>Capacitor.registerPlugin('VideoLibrary').snapshot());const saved=before.progress.find(v=>v.position>=233.5);assert(saved,'background saved');assert.equal(before.videos.length,204);
adb('shell','am','force-stop','cn.xiangqi.endgame.training.family');await d.close();
adb('install','-r','apps/endgame-training/android/app/build/outputs/apk/family/app-family.apk');
adb('shell','am','start','-n','cn.xiangqi.endgame.training.family/cn.xiangqi.endgame.training.MainActivity');d=(await _android.devices()).find(d=>d.serial()===serial);await sleep(1500);p=await view();await p.goto('https://localhost/video-learning');await p.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
const restored=await p.locator('video').evaluate(v=>({time:v.currentTime,paused:v.paused}));assert(restored.paused);assert(Math.abs(restored.time-saved.position)<1);
const after=await p.evaluate(()=>Capacitor.registerPlugin('VideoLibrary').snapshot());assert.equal(after.videos.length,204);assert.deepEqual(after.bookmarks,before.bookmarks);
console.log(JSON.stringify({restored,videos:after.videos.length}));console.log('PASS background pauses+saves; force-stop and overlay install retain all 204 courses, bookmarks and paused position.');
}finally{await d.close()}})().catch(e=>{console.error(e);process.exitCode=1});
