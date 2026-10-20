// Run from repository root. Real WASM rules + local Pikafish; no production requests.
// Fixture store records writes in memory; one explicit wrong verdict is simulated.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
const require=createRequire(process.cwd()+'/apps/endgame-training/package.json');
const {build}=createRequire(require.resolve('vite'))('esbuild');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/chenyubin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.cwd(),src=root+'/apps/endgame-training/src',engineDir=root+'/apps/desktop/src-tauri/resources/pikafish';
const out=process.env.TRIAL_UI_OUTPUT || '/tmp/qixi-trial-ui';await mkdir(out,{recursive:true});
const fen='3a5/2P1n1N2/3k1a3/9/9/9/9/3A5/9/4K4 w - - 0 1';
const engineRecords=[];
async function bestMove(fen){
 return new Promise((resolve,reject)=>{
  const child=spawn(engineDir+'/pikafish',[],{cwd:engineDir});let buffer='',done=false;
  const timer=setTimeout(()=>{child.kill();reject(Error('engine timeout'));},10000);
  child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(!done)reject(Error('engine exited '+code));});
  child.stdout.on('data',part=>{buffer+=part;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines){
   if(line.trim()==='uciok')child.stdin.write('setoption name Threads value 1\nsetoption name Hash value 32\nisready\n');
   if(line.trim()==='readyok')child.stdin.write('position fen '+fen+'\ngo movetime 150\n');
   if(line.startsWith('bestmove ')){done=true;clearTimeout(timer);const move=line.split(' ')[1];engineRecords.push({fen,move});child.stdin.write('quit\n');resolve(move);}
  }});child.stdin.write('uci\n');
 });
}
const wasmStub=`let core;export async function trainingCore(){if(!core){core=await import('/wasm/xiangqi_web_core.js');await core.default();}return new Proxy(core,{get:(target,key)=>key==='verifyTrainingMove'&&window.fixtureVerdict?()=>JSON.stringify({outcome:window.fixtureVerdict,message:'fixture verdict',path:[],autoMoves:[],completed:false,verifierVersion:'fixture'}):target[key]});}
export async function boardAt(fen,moves=[],rule='domestic2020'){const c=await trainingCore(),g=new c.WebGame(fen,rule);for(const m of moves)g.playMove(m);const s=JSON.parse(g.stateJson());return {...s,sideToMove:s.sideToMove??s.side_to_move};}
export async function acceptsMove(fen,moves,m){try{await boardAt(fen,[...moves,m]);return true;}catch{return false;}}
export async function chineseLine(fen,moves){return JSON.parse((await trainingCore()).chineseLine(fen,moves));}
export const hasLocalPikafish=()=>true,cancelPikafishSearch=async()=>{},localVerificationIdentity=async()=> 'fixture';
export async function queryPikafishAnalysis(fen){window.searches.push(fen);if(window.engineFail)throw Error('offline');const r=await fetch('/engine',{method:'POST',body:fen});const move=await r.text();return {bestMove:move,lines:[{multipv:1,depth:10,pv:[move]}]};}
export async function queryPikafishReply(fen){return {iccs:(await queryPikafishAnalysis(fen)).bestMove};}
export const queryVerificationSearch=async()=>({lines:[{multipv:1,depth:26,pv:['g8f6','e8f6'],scoreCp:-999}]}),queryCloudBook=async()=>[],parseCbl=async()=>({problems:[]}),parseCblGames=async()=>({games:[]});`;
const storeStub=`export const trainingStore=new Proxy({}, {get:(_,key)=>async(...args)=>{if(key==='saveAttempt')window.attemptWrites.push(args);if(key==='manualFolders')return [];return [];}});`;
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {App} from './App';import {boardAt} from './wasm';window.searches=[];window.attemptWrites=[];window.fixtureProblem={id:'trial-fixture',libraryId:'fixture',source:'local',sourceIndex:0,title:'图2 · 试走验收',category:'验收',startingFen:${JSON.stringify(fen)},solution:[{iccs:'g8e9',comment:'',children:[]}],note:'',completedAttempts:0,totalElapsedMs:0};if(location.search.includes('continuation')){window.fixtureProblem={...window.fixtureProblem,id:'continuation-fixture',startingFen:'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',solution:[{iccs:'a3a4',comment:'',children:[{iccs:'a6a5',comment:'',children:[{iccs:'c3c4',comment:'',children:[]}]}]}]};}window.fixtureBoard=(await boardAt(window.fixtureProblem.startingFen)).pieces;createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:src,loader:'tsx'},plugins:[{name:'trial-fixture',setup(b){
 b.onLoad({filter:/\/App\.tsx$/},async args=>({contents:(await readFile(args.path,'utf8')).replace('useState<TrainingProblem>();','useState<TrainingProblem>(window.fixtureProblem);').replace('useState<BoardPiece[]>([]);','useState<BoardPiece[]>(window.fixtureBoard);').replace('useState<Mode>("cloud")','useState<Mode>("solver")'),loader:'tsx'}));
 b.onLoad({filter:/\/wasm\.ts$/},()=>({contents:wasmStub,loader:'ts'}));
 b.onLoad({filter:/\/store\.ts$/},()=>({contents:storeStub,loader:'ts'}));
}}],bundle:true,write:false,external:['/wasm/*'],outfile:'fixture.js',format:'esm',platform:'browser',jsx:'automatic',define:{__APP_VERSION__:'"1.0.6"',__APP_BUILD_TIME__:'"2026-10-20T10:00:00Z"',__APP_BUILD__:'"trial-fixture"',__APP_ENV__:'"test"','import.meta.env':'{}','process.env.NODE_ENV':'"production"'}});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=await readFile(src+'/styles.css','utf8')+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const server=createServer(async(req,res)=>{try{
 if(req.url==='/engine'){let raw='';for await(const part of req)raw+=part;res.end(await bestMove(raw));return;}
 if(req.url.startsWith('/wasm/')){const data=await readFile(root+'/apps/endgame-training/public'+req.url);res.setHeader('Content-Type',req.url.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(data);return;}
 if(req.url.startsWith('/skins/')||req.url.startsWith('/audio/')){res.end(await readFile(root+'/apps/endgame-training/public'+req.url));return;}
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return;}
 if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 res.setHeader('Content-Type','text/html');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script>localStorage.setItem("xiangqi-mobile-onboarding-v1","done")</script><script type="module" src="/fixture.js"></script>');
}catch(e){res.statusCode=500;res.end(e.message);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:'chrome'});const report=[];
try{for(const width of [390,800,1280]){
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message);});
 await page.goto(origin+'/practice');await page.locator('.board-square[aria-label^="g8 "]').waitFor({timeout:5000}).catch(async e=>{console.error('BODY',await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png'});throw e;});
 const play=async(from,to)=>{await page.locator('.board-square[aria-label^="'+from+' "]').click();await page.locator('.board-square[aria-label="'+to+'"]').click();};
 await play('g8','g6');assert.equal(await page.locator('.board-square[aria-label^="g8 "]').count(),1);assert.equal(await page.evaluate(()=>searches.length),0);
 await play('g8','f6');
 await page.waitForFunction(()=>window.searches.length===1);await page.getByText('试走中，未计为答对；可继续走棋或退回重试。',{exact:true}).waitFor();
 assert.equal(await page.getByText('本题待复核，暂不计分',{exact:true}).count(),0);
 assert.equal(await page.locator('.training-move-verdict').count(),0);
 assert.equal(await page.evaluate(()=>attemptWrites.length),0);
 await play('c8','c9');await page.waitForFunction(()=>window.searches.length===2);
 await page.getByText('试走中，未计为答对；可继续走棋或退回重试。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>attemptWrites.length),0);
 const returned=page.getByRole('button',{name:/^退回重试/});await returned.click();
 await page.locator('.board-square[aria-label^="g8 "]').waitFor();assert.equal(await page.locator('.board-square[aria-label="f6"]').count(),1);
 await page.evaluate(()=>{window.engineFail=true;});await play('g8','f6');await page.getByRole('button',{name:'重试 AI 应手',exact:true}).waitFor();
 assert.equal(await page.locator('.board-square[aria-label^="f6 红"]').count(),1);
 await page.evaluate(()=>{window.engineFail=false;});await page.getByRole('button',{name:'重试 AI 应手',exact:true}).click();
 await page.getByText('试走中，未计为答对；可继续走棋或退回重试。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>attemptWrites.length),0);
 await page.screenshot({path:out+'/trial-'+width+'.png',fullPage:true});
 // A definite wrong verdict uses simulated structured verification; replies still use real Pikafish.
 await returned.click();await page.evaluate(()=>{localStorage.removeItem('qixi-answer-verification-v1');window.fixtureVerdict='wrong';});
 await play('g8','f6');await page.getByText('这步不理想 · 已错 2 次，可继续试走。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>attemptWrites.length),0);
 await play('c8','c9');await page.getByText('试走中，未计为答对；可继续走棋或退回重试。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>attemptWrites.length),0);
 await returned.click();await page.evaluate(()=>{localStorage.removeItem('qixi-answer-verification-v1');window.fixtureVerdict=undefined;});
 // The real WASM verifier still accepts the original reviewed answer after leaving a trial.
 await play('g8','e9');await page.waitForFunction(()=>window.attemptWrites.length===1);
 assert.equal(await page.evaluate(()=>attemptWrites[0][0].outcome),'completed');
 assert.equal(await page.evaluate(()=>attemptWrites[0][0].mistakes),2);

 const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,searches:window.searches,attemptWrites:window.attemptWrites.length,completion:window.attemptWrites[0]?.[0]}));assert.equal(metrics.scrollWidth,width);assert.deepEqual(errors,[]);
 report.push({...metrics,status:'passed'});await context.close();
}
 {
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
 await page.goto(origin+'/practice?continuation=1');
 const play=async(from,to)=>{await page.locator('.board-square[aria-label^="'+from+' "]').click();await page.locator('.board-square[aria-label="'+to+'"]').click();};
 await page.locator('.board-square[aria-label^="a3 "]').waitFor();await play('a3','a4');
 await page.locator('.board-square[aria-label^="a5 黑"]').waitFor();
 assert.equal(await page.getByRole('button',{name:/^退回重试/}).count(),0,'accepted move must release trial controls');
 await play('c3','c4');await page.waitForFunction(()=>window.attemptWrites.length===1);
 assert.equal(await page.evaluate(()=>attemptWrites[0][0].outcome),'completed');
 report.push({scenario:'accepted multi-move continuation',status:'passed'});await context.close();
 }
}finally{await browser.close();server.close();}
await writeFile(out+'/report.json',JSON.stringify({report,engineRecords},null,2));console.log(JSON.stringify({report,engineRecords},null,2));
