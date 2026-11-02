// Emulator-only recovery acceptance. Requires one registered sample course.
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {_android} = require(process.env.PLAYWRIGHT_MODULE_PATH || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const serial = process.env.VIDEO_TEST_SERIAL || 'emulator-5554';
const pkg = 'cn.xiangqi.endgame.training.family';
const adb = process.env.ADB_BIN || `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const shell = (command, input) => execFileSync(adb, ['-s',serial,'shell','-T',`run-as ${pkg} sh -c ${quote(command)}`], {input});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async()=>{
  assert(serial.startsWith('emulator-'), 'Only run on a disposable emulator');
  const device = (await _android.devices()).find(d=>d.serial()===serial);assert(device,'emulator unavailable');
  try {
    const page = await (await device.webViews()).find(v=>v.pkg()===pkg).page();
    await page.goto('https://localhost/video-learning');
    const invoke = (method,args) => page.evaluate(({method,args})=>Capacitor.registerPlugin('VideoLibrary')[method](args),{method,args});
    const snapshot = () => invoke('snapshot');
    let state=await snapshot();assert(state.videos.length,'Provision a sample first');
    assert(!state.tasks.some(t=>['running','scanning'].includes(t.state)),'Wait for existing imports');
    const sample=state.videos[0], baseline=state.progress.find(v=>v.id===sample.id);
    const prefix='视频恢复验收-'+Date.now();
    const entry=(chapter,hash=sample.hash)=>({chapter,title:'1-1',hash,size:sample.size});
    const manifest={version:1,series:[
      {title:prefix+'-排队前',categoryId:'category-other',videos:Array.from({length:40},(_,i)=>entry('章'+i))},
      {title:prefix+'-取消后重试',categoryId:'category-other',videos:[entry('成功章节'),entry('失败章节','0'.repeat(64))]}
    ]};
    shell('cat > files/VideoLibrary/staging/manifest.json',JSON.stringify(manifest));
    await invoke('receiveProvisioned');
    state=await snapshot();const queued=state.tasks.find(t=>t.total===2&&t.state==='running');assert(queued,'queued task visible');
    await invoke('cancel',{taskId:queued.id});
    for(let i=0;i<600;i++){state=await snapshot();if(!state.tasks.some(t=>['running','scanning'].includes(t.state)))break;await sleep(100)}
    assert.equal(state.tasks.find(t=>t.id===queued.id).state,'cancelled');
    const target=state.series.find(s=>s.title===prefix+'-取消后重试');assert(target);
    assert.equal(state.chapters.filter(c=>c.seriesId===target.id).length,0,'cancelled queue never registered content');
    await invoke('retry',{taskId:queued.id});
    for(let i=0;i<600;i++){state=await snapshot();if(!state.tasks.some(t=>['running','scanning'].includes(t.state)))break;await sleep(100)}
    assert.equal(state.tasks.find(t=>t.id===queued.id).failed,1);
    const chapters=state.chapters.filter(c=>c.seriesId===target.id).map(c=>c.id);
    const imported=state.videos.find(v=>chapters.includes(v.chapterId));assert(imported);
    await invoke('deleteContent',{kind:'video',id:imported.id});
    state=await snapshot();const remaining=state.tasks.find(t=>t.id===queued.id);
    assert(remaining,'unrelated failed source keeps retry task');assert.equal(remaining.total,1);assert.equal(remaining.failed,1);assert.equal(remaining.completed,0);
    await invoke('retry',{taskId:queued.id});
    for(let i=0;i<600;i++){state=await snapshot();if(!state.tasks.some(t=>['running','scanning'].includes(t.state)))break;await sleep(100)}
    assert(!state.videos.some(v=>v.id===imported.id),'retry does not resurrect deleted video');
    for(const s of state.series.filter(s=>s.title.startsWith(prefix)))await invoke('deleteSeries',{id:s.id});
    state=await snapshot();assert(state.videos.some(v=>v.id===sample.id));assert.deepEqual(state.progress.find(v=>v.id===sample.id),baseline);
    assert(!state.tasks.some(t=>t.id===queued.id),'deleting series retires retry');
    assert((await invoke('playback',{id:sample.id})).path,'shared original media preserved');
    console.log('PASS: queued cancellation, partial-failure retry, targeted deletion, no resurrection, shared media/progress preserved.');
  } finally {await device.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
