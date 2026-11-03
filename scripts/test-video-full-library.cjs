// Emulator acceptance against a locally generated manifest; media stays on this computer/emulator.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const {_android}=require(process.env.PLAYWRIGHT_MODULE_PATH||'/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serial=process.env.VIDEO_TEST_SERIAL||'emulator-5554',pkg='cn.xiangqi.endgame.training.family';
const adb=process.env.ADB_BIN||`${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 assert(serial.startsWith('emulator-'),'emulator only');const manifest=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),bundled=process.argv.includes('--bundled');
 const d=(await _android.devices()).find(d=>d.serial()===serial);assert(d);
 try{
  let view;for(let i=0;i<100&&!view;i++){view=(await d.webViews()).find(v=>v.pkg()===pkg);if(!view)await sleep(200)}assert(view,'launch the family app first');
  const p=await view.page();
  // Keep the player unmounted so its periodic saves do not update the timestamps under test.
  await p.goto('https://localhost/');
  const invoke=(method,args)=>p.evaluate(({method,args})=>Capacitor.registerPlugin('VideoLibrary')[method](args),{method,args});
  const wait=async()=>{for(let i=0;i<1800;i++){const s=await invoke('snapshot');if(!s.tasks.some(t=>['running','scanning'].includes(t.state)))return s;await sleep(100)}throw Error('import timed out')};
  const before=await invoke('snapshot');
  await invoke('receiveProvisioned');let s=await wait();
  assert(!s.tasks.some(t=>t.failed>0),'no failed imports');
  if(bundled){assert.deepEqual(s.progress,before.progress,'bundled upgrade retains positions');assert.deepEqual(s.bookmarks,before.bookmarks,'bundled upgrade retains bookmarks');}
  const check=s=>{
   for(const set of manifest.series){
    const series=s.series.find(v=>v.title===set.title);assert(series,'missing '+set.title);
    const chapters=s.chapters.filter(c=>c.seriesId===series.id);
    const videos=s.videos.filter(v=>chapters.some(c=>c.id===v.chapterId));assert.equal(videos.length,set.videos.length,set.title);
    for(const entry of set.videos){const c=chapters.find(c=>c.path===entry.chapter);assert(c,'missing chapter');const v=videos.find(v=>v.chapterId===c.id&&v.hash===entry.hash);assert(v,'missing '+entry.title);assert.equal(v.size,entry.size)}
   }
  };check(s);const progress=s.progress,bookmarks=s.bookmarks,ids=s.videos.map(v=>v.id).sort();
  // Same manifest again: native checks existing media instead of copying; records remain stable.
  const tasks=s.tasks.length;
  if(!bundled)execFileSync(adb,['-s',serial,'shell','-T',`run-as ${pkg} sh -c 'cat > files/VideoLibrary/staging/manifest.json'`],{input:JSON.stringify(manifest)});
  await invoke('receiveProvisioned');s=await wait();check(s);
  if(bundled)assert.equal(s.tasks.length,tasks,'same bundle is not reimported');
  assert.deepEqual(s.progress,progress);assert.deepEqual(s.bookmarks,bookmarks);assert.deepEqual(s.videos.map(v=>v.id).sort(),ids);
  const decoded=[];
  for(const set of manifest.series){
   const series=s.series.find(v=>v.title===set.title),chapters=s.chapters.filter(c=>c.seriesId===series.id);
   for(const chapter of chapters){
    const videos=s.videos.filter(v=>v.chapterId===chapter.id).sort((a,b)=>a.order-b.order);
    for(const v of [videos[0],videos.at(-1)]){
     const {path}=await invoke('playback',{id:v.id});
     const metadata=await p.evaluate(async path=>{const video=document.createElement('video');video.preload='metadata';video.src=Capacitor.convertFileSrc(path)+'?vl=1';try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('metadata timeout')),15000);video.onloadedmetadata=()=>{clearTimeout(timer);resolve()};video.onerror=()=>{clearTimeout(timer);reject(Error('decode error'))}});return {duration:video.duration,width:video.videoWidth}}finally{video.removeAttribute('src');video.load()}},path);
     assert(metadata.duration>0&&metadata.width>0);decoded.push({series:set.title,chapter:chapter.path,title:v.title,...metadata});
    }
   }
  }
  console.log(JSON.stringify({series:manifest.series.map(set=>{const series=s.series.find(v=>v.title===set.title);return {title:set.title,count:set.videos.length,chapters:s.chapters.filter(c=>c.seriesId===series.id).map(c=>({path:c.path,count:s.videos.filter(v=>v.chapterId===c.id).length}))}}),sampleMetadata:decoded},null,2));
  console.log('PASS: full manifest matches; duplicate provisioning preserves IDs, progress and bookmarks; first/last MP4 metadata loads in every chapter.');
 }finally{await d.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
