// Dedicated review account only; no assignments are created or published.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const [fixturePath,reportPath]=process.argv.slice(2);
assert(fixturePath&&reportPath,'Usage: probe-authoring-catalog.mjs <fixture.json> <report.json>');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
const samples=[],base='/api/v1/admin/authoring',topic='e0c0221d-1b02-5f2c-9122-a7b0821f2603';
let token,complete=false,createdId,revision;
async function call(label,path,{method='GET',body,status=200,budget=5000}={}){
 const start=performance.now();
 const response=await fetch(new URL(path,fixture.api),{method,signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json','x-xiangqi-app-id':'student-mobile','x-authoring-scope':'organization',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();
 const sample={label,status:response.status,ms:Math.round(performance.now()-start),items:value.items?.length??value.children?.length};samples.push(sample);console.log(JSON.stringify(sample));
 assert.equal(response.status,status,label);assert(sample.ms<=budget,label+' response budget');return value;
}
try{
 const auth=await call('login','/api/v1/auth/login',{method:'POST',body:{account:fixture.teacher.loginName,password:fixture.teacher.password}});
 assert.equal(auth.user.orgId,fixture.orgId);assert(['coach','admin'].includes(auth.user.role));token=auth.token;
 for(const view of ['structure','counts']){
  const tree=await call('catalog.'+view,'/api/v1/admin/teaching-catalog/browse?view='+view+'&availability=available&allowStaleCounts=true&limit=50');assert(Array.isArray(tree.children));assert(tree.children.length>0);
 }
 let selected;
 for(const step of ['', '1','2','3','4']){
  const path=`/api/v1/admin/teaching-catalog/${topic}/problems?limit=50&pageOnly=true${step?'&mateMoves='+step:''}`;
  const page=await call('catalog.problems.'+(step||'all'),path);
  assert(page.items.length>0&&page.items.length<=50);assert.equal(page.totalCount,null);
  if(!step)selected=page.items[0];
  if(page.nextCursor){const next=await call('catalog.next.'+(step||'all'),path+'&cursor='+encodeURIComponent(page.nextCursor));const ids=new Set(page.items.map(item=>item.id));assert(next.items.every(item=>!ids.has(item.id)));}
 }
 const problemPath='/api/v1/admin/problems/'+selected.id;
 const original=await call('source.before',problemPath);
 const assignments=await call('assignments.before','/api/v1/admin/assignments');
 const rows=Array.isArray(assignments)?assignments:assignments.items||[];
 let history,path;
 if(rows[0]){path='/api/v1/admin/assignments/'+rows[0].id+'/problems';history=await call('snapshot.before',path);}
 createdId=randomUUID();const title='目录删除验收 10139（专用账号）';
 const created=await call('directory.create',base+'/directories',{method:'POST',body:{id:createdId,title,sortOrder:999}});revision=created.directory.revision;
 const added=await call('directory.add-reference',base+'/directories/'+createdId,{method:'PATCH',body:{title,expectedRevision:revision,items:[{subjectId:selected.id,kind:'source'}]}});revision=added.directory.revision;
 assert.equal(added.directory.itemCount,1);
 await call('legacy.nonempty-denied',base+'/directories/'+createdId,{method:'DELETE',body:{expectedRevision:revision},status:409});
 await call('stale.nonempty-denied',base+'/directories/'+createdId,{method:'DELETE',body:{expectedRevision:revision-1,removeItems:true},status:409});
 const remove={method:'DELETE',body:{expectedRevision:revision,removeItems:true}};
 await call('directory.delete-populated',base+'/directories/'+createdId,remove);
 await call('directory.delete-retry',base+'/directories/'+createdId,remove);
 const dirs=await call('directories.after',base+'/directories');assert(!dirs.items.some(item=>item.id===createdId));createdId=undefined;
 assert.deepEqual(await call('source.after',problemPath),original);
 assert.deepEqual(await call('assignments.after','/api/v1/admin/assignments'),assignments);
 if(path)assert.deepEqual(await call('snapshot.after',path),history);
 await call('legacy.libraries',base+'/source-libraries?kind=problems&limit=30');
 complete=true;
}finally{
 // Only the directory explicitly created by this run is eligible for cleanup.
 if(createdId&&revision)try{await call('fixture.cleanup',base+'/directories/'+createdId,{method:'DELETE',body:{expectedRevision:revision,removeItems:true}});}catch(error){console.error('Fixture cleanup failed: '+error.message);}
 await fs.writeFile(reportPath,JSON.stringify({at:new Date().toISOString(),complete,samples},null,2)+'\n');
}
