// Read-only production acceptance with a dedicated teacher; no question/assignment writes.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const [fixturePath,reportPath]=process.argv.slice(2);assert(fixturePath&&reportPath);
const f=JSON.parse(await fs.readFile(fixturePath,'utf8'));let token,complete=false;
const samples=[];
async function read(label,path,body,budget){
 const t=performance.now();
 const response=await fetch(f.api+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json','x-xiangqi-app-id':'student-mobile','x-authoring-scope':'organization',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const v=await response.json();const sample={label,status:response.status,ms:Math.round(performance.now()-t),items:v.items?.length,total:v.totalCount};samples.push(sample);console.log(JSON.stringify(sample));
 assert.equal(response.status,200,label);if(budget)assert(sample.ms<=budget,`${label} exceeded ${budget}ms: ${sample.ms}ms`);return v;
}
try{
 const auth=await read('login','/api/v1/auth/login',{account:f.teacher.loginName,password:f.teacher.password});assert.equal(auth.user.orgId,f.orgId);token=auth.token;
 const dirs=await read('directories','/api/v1/admin/authoring/directories');const directory=dirs.items.find(d=>d.canEdit);
 for(const [name,query] of [['all',''],['one','mateMoves=1'],['two','mateMoves=2'],['three','mateMoves=3'],['long','mateGroup=long']]){
  const params=new URLSearchParams({kind:'problems',limit:'50'});if(directory)params.set('directoryId',directory.id);for(const [k,v] of new URLSearchParams(query))params.set(k,v);
  const path='/api/v1/admin/authoring/sources?'+params;
  const page=await read(name+'.first',path,undefined,1500);assert.equal(page.mateFilterVersion,1);assert(page.items.length>0&&page.items.length<=50);assert(Number.isSafeInteger(page.totalCount));
  const keys=new Set(page.items.map(i=>i.duplicateKey));assert.equal(keys.size,page.items.length);
  const warm=await read(name+'.warm',path,undefined,500);assert.deepEqual(warm,page);
  if(page.nextCursor){params.set('cursor',page.nextCursor);const next=await read(name+'.next','/api/v1/admin/authoring/sources?'+params,undefined,500);assert(next.items.length<=50);assert(next.items.every(i=>!keys.has(i.duplicateKey)));assert.equal(next.totalCount,page.totalCount);}
 }
 complete=true;
}finally{await fs.writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),complete,samples},null,2)+'\n');}
