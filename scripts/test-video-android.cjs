// Requires the personal app and a small provisioned course on an emulator.
// Reads library metadata and exercises the real WebView/local-file/SQLite pipeline.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {_android}=require(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const serial=process.env.VIDEO_TEST_SERIAL||'emulator-5554';assert(serial.startsWith('emulator-'),'emulator only');
 const d=(await _android.devices()).find(d=>d.serial()===serial);assert(d,'emulator unavailable');
 try{
  let view;for(let i=0;i<50&&!view;i++){view=(await d.webViews()).find(v=>v.pkg()==='cn.xiangqi.endgame.training.family');if(!view)await new Promise(resolve=>setTimeout(resolve,200));}assert(view,'launch the family app first');
  const p=await view.page();p.setDefaultTimeout(15000);await p.goto('https://localhost/video-learning');
  let data=await p.evaluate(()=>Capacitor.registerPlugin('VideoLibrary').snapshot());assert(data.videos.length,'provision at least one small MP4');
  const video=data.videos[0];await p.evaluate(id=>{localStorage.setItem('qixi.video.selected',id)},video.id);await p.reload();
  await p.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
  const ranges=await p.locator('video').evaluate(async v=>{const result=[];for(const range of ['bytes=0-99','bytes=100-199','bytes=-100','bytes=999999999-']){const r=await fetch(v.currentSrc,{headers:{Range:range},cache:'no-store'});result.push({status:r.status,length:(await r.arrayBuffer()).byteLength})}return result});
  assert.deepEqual(ranges,[{status:206,length:100},{status:206,length:100},{status:206,length:100},{status:416,length:0}]);
  const target=await p.locator('video').evaluate(v=>Math.min(125,Math.max(1,v.duration/2)));
  await p.locator('video').evaluate(async(v,target)=>{v.currentTime=target;await new Promise(resolve=>v.addEventListener('seeked',resolve,{once:true}));await v.play()},target);
  await p.waitForFunction(t=>document.querySelector('video').currentTime>t+0.5,target);await p.locator('video').evaluate(v=>v.pause());
  await p.locator('summary[aria-label="更多播放操作"]').click();
  await p.getByRole('button',{name:'加书签',exact:true}).click();
  await p.getByRole('button',{name:'去练棋',exact:true}).click();await p.getByRole('button',{name:'‹ 返回视频学习',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('video')?.readyState>=1);
  const restored=await p.locator('video').evaluate(v=>({time:v.currentTime,paused:v.paused,width:v.videoWidth,error:v.error?.code}));
  assert(restored.time>=target,'position restored');assert(restored.paused,'no autoplay');assert(restored.width>0&&!restored.error,'decoded video');
  const out=path.resolve('artifacts/video-learning');fs.mkdirSync(out,{recursive:true});await p.screenshot({path:path.join(out,'android-player.png')});
  console.log(JSON.stringify({ranges,restored},null,2));console.log('PASS Android: registered local video, exact byte ranges, decoding/seek, bookmark, practice roundtrip and paused resume.');
 }finally{await d.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
