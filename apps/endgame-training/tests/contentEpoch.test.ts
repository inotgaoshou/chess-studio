import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ContentEpochTracker,belongsToContentScope,contentEpochKey} from '../src/contentEpoch.ts';
const scope={serverUrl:'https://api-test.qixiapp.cn',ownerId:'student'};
function tracker(){const data=new Map<string,string>();return new ContentEpochTracker({getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}});}
test('legacy caches are purged once; same epoch and absent legacy server field preserve new caches',async()=>{
 const t=tracker();let purges=0;const purge=async()=>{purges++;};
 assert.equal(await t.observe(scope,undefined,purge,()=>true),false);
 assert.equal(await t.observe(scope,'first',purge,()=>true),true);
 assert.equal(await t.observe(scope,'first',purge,()=>true),false);
 assert.equal(await t.observe(scope,undefined,purge,()=>true),false);
 assert.equal(purges,1);
 assert.equal(await t.observe(scope,'second',purge,()=>true),true);
 assert.equal(t.current(scope),'second');assert.equal(purges,2);
});
test('concurrent identical probes do not clear fresh downloads twice',async()=>{
 const t=tracker();let purges=0;let release:()=>void=()=>{};const pending=new Promise<void>(r=>{release=r;});
 const a=t.observe(scope,'new',async()=>{purges++;await pending;},()=>true);
 const b=t.observe(scope,'new',async()=>{purges++;},()=>true);
 release();assert.deepEqual(await Promise.all([a,b]),[true,false]);assert.equal(purges,1);
});
test('changed account or server never purges another account, personal storage is outside this scope',async()=>{
 const t=tracker();assert.equal(await t.observe(scope,'new',async()=>assert.fail(),()=>false),false);
 assert.equal(belongsToContentScope({...scope,ownerId:'other'},scope),false);
 assert.equal(belongsToContentScope({...scope,serverUrl:'https://api.qixiapp.cn'},scope),false);
 assert.equal(belongsToContentScope({...scope,orgId:'other-org'},scope),true);
 assert.notEqual(contentEpochKey(scope),contentEpochKey({...scope,ownerId:'other'}));
});
