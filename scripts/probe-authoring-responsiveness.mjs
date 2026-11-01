// Dedicated review account only. Never outputs credentials or tokens.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const [fixturePath,reportPath,...flags]=process.argv.slice(2);
assert(fixturePath&&reportPath,'Usage: node scripts/probe-authoring-responsiveness.mjs <fixture.json> <report.json> [--write-directory]');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
const base='/api/v1/admin/authoring',samples=[];let token,complete=false;
async function read(label,path,{body,budget=1500}={}){
 const start=performance.now();let sample;
 try{
  const response=await fetch(new URL(path,fixture.api),{method:body?'POST':'GET',headers:{'content-type':'application/json','x-xiangqi-app-id':'student-mobile','x-authoring-scope':'organization',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
  const value=await response.json();sample={label,status:response.status,ms:Math.round(performance.now()-start),items:value.items?.length,total:value.totalCount,budget};
  samples.push(sample);console.log(JSON.stringify(sample));assert.equal(response.status,200,label);assert(sample.ms<=budget,`${label} exceeded ${budget}ms`);return value;
 }catch(error){if(!sample)samples.push({label,ms:Math.round(performance.now()-start),failed:true,error:error.name});else sample.failed=true;throw error;}
}
try{
 const auth=await read('teacher.login','/api/v1/auth/login',{body:{account:fixture.teacher.loginName,password:fixture.teacher.password},budget:2500});assert.equal(auth.user.orgId,fixture.orgId);assert(['coach','admin'].includes(auth.user.role));token=auth.token;
 const dirs=await read('directories.first',base+'/directories');await read('directories.warm',base+'/directories',{budget:500});
 if(dirs.items[0])await read('directory.detail',base+'/directories/'+encodeURIComponent(dirs.items[0].id));
 for(const step of ['1','2','3','long']){
  const query=new URLSearchParams({kind:'problems',limit:'30',...(step==='long'?{mateGroup:'long'}:{mateMoves:step})});
  const page=await read('libraries.'+step+'.first',base+'/source-libraries?'+query+'&view=page');
  assert(Array.isArray(page.items)&&page.totalCount==null);await read('libraries.'+step+'.warm',base+'/source-libraries?'+query+'&view=page',{budget:500});
  const count=await read('libraries.'+step+'.counts',base+'/source-libraries?'+query+'&view=counts',{budget:8000});assert.equal(count.snapshotKey,page.snapshotKey);
  if(step==='3'&&page.items.find(book=>book.id!=='authored')){
   const book=page.items.find(book=>book.id!=='authored');const params=new URLSearchParams({kind:'problems',mateMoves:'3',libraryId:book.id,limit:'50'});
   let result;const deadline=Date.now()+30000;const start=performance.now();
   do{
    const response=await fetch(new URL(base+'/sources?'+params,fixture.api),{headers:{authorization:`Bearer ${token}`,'x-xiangqi-app-id':'student-mobile','x-authoring-scope':'organization'},signal:AbortSignal.timeout(10000)});
    result=await response.json();if(response.ok)break;assert.equal(response.status,503);assert(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,400));
   }while(true);
   samples.push({label:'sources.3.preparation',ms:Math.round(performance.now()-start),items:result.items.length});assert(result.items.length<=50);
   await read('sources.3.warm',base+'/sources?'+params,{budget:500});
   if(result.nextCursor){params.set('cursor',result.nextCursor);const next=await read('sources.3.next',base+'/sources?'+params);const ids=new Set(result.items.map(item=>item.duplicateKey));assert(next.items.every(item=>!ids.has(item.duplicateKey)));}
  }
 }
 const legacy=await read('libraries.legacy',base+'/source-libraries?kind=problems&limit=30',{budget:2500});assert(Number.isSafeInteger(legacy.totalCount));
 if(flags.includes('--write-directory')){
  const id=randomUUID();const body={id,title:'响应验收 10137（专用账号）',sortOrder:999};
  const created=await read('directory.create',base+'/directories',{body});assert.equal(created.id,id);assert.equal(created.directory.title,body.title);
  const replay=await read('directory.create.retry',base+'/directories',{body});assert.equal(replay.id,id);assert.equal(replay.directory.revision,created.directory.revision);
  const current=await read('directories.after-create',base+'/directories');assert.equal(current.items.filter(item=>item.id===id).length,1);
 }
 complete=true;
}finally{await fs.writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),complete,samples},null,2)+'\n');}
