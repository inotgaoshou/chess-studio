import {useEffect,useRef,useState} from "react";

export type BrowseNode = {id:string;parentId?:string|null;name:string;kind?:string;itemCount?:number|null;completedCount?:number|null;materialCount?:number|null;rehearsalCount?:number|null;rehearsalCompletedCount?:number|null};
export type BrowsePage<N extends BrowseNode> = {availabilityReady?:boolean;availabilityRevision?:string;availabilitySnapshotRevision?:string|null;statisticsReady?:boolean;statisticsRevision?:string;statisticsSnapshotRevision?:string|null;statisticsUpdatedAt?:string|null;currentNode?:N|null;breadcrumbs:N[];children:N[];nextCursor?:string|null;learningMaterials:{id:string;title:string;reviewStatus:string}[];materialNextCursor?:string|null};
export function useDebounced<T>(value:T,delay=300,scope?:string|null) {
 const [settled,setSettled]=useState({value,scope});
 useEffect(()=>{const timer=setTimeout(()=>setSettled({value,scope}),delay);return()=>clearTimeout(timer);},[value,delay,scope]);
 return settled.scope===scope?settled.value:value;
}
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
// Older servers expose only the current revision; new servers identify the
// historical generation actually used for availability filtering.
const availabilityVersion=(page:BrowsePage<BrowseNode>)=>page.availabilitySnapshotRevision!==undefined?page.availabilitySnapshotRevision:page.availabilityRevision;
const canReuseCounts=(part:BrowsePage<BrowseNode>,prior:BrowsePage<BrowseNode>)=>part.availabilitySnapshotRevision===undefined||(typeof part.availabilitySnapshotRevision==="string"&&part.availabilitySnapshotRevision===prior.statisticsSnapshotRevision);
const responseVersion=(page:BrowsePage<BrowseNode>)=>page.availabilitySnapshotRevision!==undefined?page.availabilitySnapshotRevision:page.statisticsRevision;
const empty=<N extends BrowseNode>():BrowsePage<N>=>({breadcrumbs:[],children:[],learningMaterials:[]});

const navigationCaches = new Map<string, Map<string, BrowsePage<BrowseNode>>>();
export function clearCatalogBrowseCache() { navigationCaches.clear(); }
function accountCache<N extends BrowseNode>(scope?: string): Map<string, BrowsePage<N>> {
 if (!scope) return new Map();
 let cache = navigationCaches.get(scope);
 if (!cache) { cache = new Map(); navigationCaches.set(scope, cache); }
 if (navigationCaches.size > 8) navigationCaches.delete(navigationCaches.keys().next().value!);
 return cache as Map<string, BrowsePage<N>>;
}
/** Display-only cache, scoped by session/account/role/entitlement; every read revalidates. */
export function useCatalogBrowse<N extends BrowseNode>(request:(params:Record<string,string>,signal:AbortSignal)=>Promise<BrowsePage<N>>,params:Record<string,string>,reading:boolean,restoreCount=0,restoreMaterials=0,scope?:string) {
 const key=JSON.stringify(params);
 const cache=useRef(accountCache<N>(scope));
 useEffect(()=>()=>{if(!scope)cache.current.clear();},[request,scope]);
 const [state,setState]=useState({key,request,page:cache.current.get(key)??empty<N>()});
 const [loading,setLoading]=useState(true),[countBusy,setCountBusy]=useState(false),[materialBusy,setMaterialBusy]=useState(false);
 const [error,setError]=useState(""),[countError,setCountError]=useState(""),[materialError,setMaterialError]=useState("");
 const [retry,setRetry]=useState(0),[countRetry,setCountRetry]=useState(0),[materialRetry,setMaterialRetry]=useState(0);
 const controller=useRef<AbortController|null>(null),pageRef=useRef(empty<N>());
 const loadedPages=useRef<Record<string,string>[]>([]);
 const materialController=useRef<AbortController|null>(null);
 const publish=(page:BrowsePage<N>)=>{pageRef.current=page;cache.current.set(key,page);if(cache.current.size>80)cache.current.delete(cache.current.keys().next().value!);setState({key,request,page});};
 const countPending=useRef(0);
 const countRevision=useRef<string|undefined>(undefined);
 const requestedReload=useRef<string|undefined>(undefined);
 useEffect(()=>{requestedReload.current=undefined;},[request,key]);
 function reload(signal:AbortSignal,generation:string) {
  if(signal.aborted||requestedReload.current===generation)return;
  requestedReload.current=generation;controller.current?.abort();setRetry(n=>n+1);
 }
 useEffect(()=>{countRevision.current=undefined;},[request]);
 const countRequests=useRef(new Map<string,AbortSignal>());
 async function counts(query:Record<string,string>,signal:AbortSignal) {
  const requestKey=JSON.stringify(query);
  if(countRequests.current.get(requestKey)===signal)return;
  countRequests.current.set(requestKey,signal);
  countPending.current++;setCountBusy(true);
  try {
   let delay=1000;
   while(!signal.aborted) {
    const result=await request({...query,view:"counts"},signal);
    if(signal.aborted)return;
    const revision=result.statisticsRevision;
    if(revision&&countRevision.current&&BigInt(revision)<BigInt(countRevision.current))continue;
    if(query.availability==='available') {
     const next=responseVersion(result),previous=availabilityVersion(pageRef.current);
     const identified=result.availabilitySnapshotRevision!==undefined;
     if((identified&&next!==previous)||(!identified&&result.statisticsReady!==false&&(pageRef.current.availabilityReady===false||(pageRef.current.availabilityRevision!==undefined&&pageRef.current.availabilityRevision!==revision)))) {
      reload(signal,`${identified?'snapshot':'revision'}:${next??revision??'unknown'}`);return;
     }
    }
    const changed=revision!==undefined&&countRevision.current!==undefined&&revision!==countRevision.current;
    if(revision)countRevision.current=revision;
    const retainCounts=query.allowStaleCounts==='true'&&typeof result.statisticsSnapshotRevision==='string';
    if(changed||result.statisticsReady===false) {
     if(!retainCounts) {
      cache.current.clear();
      const clear=(n:N)=>({...n,itemCount:null,completedCount:null,materialCount:null,rehearsalCount:null,rehearsalCompletedCount:null});
      pageRef.current={...pageRef.current,children:pageRef.current.children.map(clear),currentNode:pageRef.current.currentNode?clear(pageRef.current.currentNode):null};
     }
     for(const page of loadedPages.current)if(JSON.stringify(page)!==requestKey)void counts(page,signal);
    }
    const all=new Map([...result.children,...(result.currentNode?[result.currentNode]:[])].map(n=>[n.id,n]));
    const update=(n:N)=>{const next=all.get(n.id);return next?{...n,itemCount:next.itemCount??(retainCounts?n.itemCount:null),completedCount:next.completedCount??(retainCounts?n.completedCount:null),materialCount:next.materialCount??(retainCounts?n.materialCount:null),rehearsalCount:next.rehearsalCount??(retainCounts?n.rehearsalCount:null),rehearsalCompletedCount:next.rehearsalCompletedCount??(retainCounts?n.rehearsalCompletedCount:null)}:n;};
    publish({...pageRef.current,statisticsReady:result.statisticsReady,statisticsRevision:revision,statisticsSnapshotRevision:result.statisticsSnapshotRevision,statisticsUpdatedAt:result.statisticsUpdatedAt,children:pageRef.current.children.map(update),currentNode:pageRef.current.currentNode?update(pageRef.current.currentNode):null});
    if(result.statisticsReady!==false)break;
    await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener("abort",finish);resolve();};const timer=setTimeout(finish,delay);signal.addEventListener("abort",finish,{once:true});if(signal.aborted)finish();});
    delay=Math.min(delay*2,10000);
   }
  } catch(e){if(!signal.aborted)setCountError(message(e));}
  finally {
   if(countRequests.current.get(requestKey)===signal)countRequests.current.delete(requestKey);
   if(!signal.aborted){countPending.current--;setCountBusy(countPending.current>0);}
  }
 }

 useEffect(()=>{
  const abort=new AbortController();controller.current=abort;countPending.current=0;
  const saved=cache.current.get(key);pageRef.current=saved??empty<N>();setState({key,request,page:pageRef.current});
  setLoading(true);setError("");setCountError("");setCountBusy(false);loadedPages.current=[];
  void (async()=>{
   let cursor:string|undefined;let combined=empty<N>();const seen=new Set<string>();
   do {
    const query={...JSON.parse(key),view:"structure",...(cursor?{cursor}:{})};
    const part=await request(query,abort.signal);if(abort.signal.aborted)return;
    if(cursor&&query.availability==='available'&&responseVersion(part)!==availabilityVersion(combined)){reload(abort.signal,`snapshot:${responseVersion(part)??'unknown'}`);return;}
    loadedPages.current.push(query);
    const reusable=canReuseCounts(part,pageRef.current);
    const prior=new Map((reusable?pageRef.current.children:[]).map(n=>[n.id,n]));
    combined={...part,availabilityRevision:part.statisticsRevision,statisticsReady:reusable?pageRef.current.statisticsReady:part.statisticsReady,statisticsSnapshotRevision:reusable?pageRef.current.statisticsSnapshotRevision:part.statisticsSnapshotRevision,statisticsUpdatedAt:reusable?pageRef.current.statisticsUpdatedAt:part.statisticsUpdatedAt,learningMaterials:pageRef.current.learningMaterials,materialNextCursor:pageRef.current.materialNextCursor,currentNode:reusable&&part.currentNode&&pageRef.current.currentNode?.id===part.currentNode.id?{...part.currentNode,itemCount:pageRef.current.currentNode.itemCount,completedCount:pageRef.current.currentNode.completedCount,materialCount:pageRef.current.currentNode.materialCount,rehearsalCount:pageRef.current.currentNode.rehearsalCount,rehearsalCompletedCount:pageRef.current.currentNode.rehearsalCompletedCount}:part.currentNode,children:[...combined.children.map(n=>prior.get(n.id)??n),...part.children.map(n=>({...n,itemCount:prior.get(n.id)?.itemCount??n.itemCount,completedCount:prior.get(n.id)?.completedCount??n.completedCount,materialCount:prior.get(n.id)?.materialCount??n.materialCount,rehearsalCount:prior.get(n.id)?.rehearsalCount??n.rehearsalCount,rehearsalCompletedCount:prior.get(n.id)?.rehearsalCompletedCount??n.rehearsalCompletedCount}))]};
    publish(combined);void counts(query,abort.signal);
    cursor=part.nextCursor??undefined;
    if(cursor&&seen.has(cursor))throw new Error("目录分页异常");if(cursor)seen.add(cursor);
   }while(cursor&&combined.children.length<Math.max(restoreCount,saved?.children.length??0));
  })().catch(e=>{if(!abort.signal.aborted)setError(message(e));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[request,key,retry]);
 useEffect(()=>{if(!countRetry)return;const signal=controller.current?.signal;if(!signal)return;setCountError("");for(const query of loadedPages.current)void counts(query,signal);},[countRetry]);
 async function more() {
  const cursor=pageRef.current.nextCursor,signal=controller.current?.signal;if(!cursor||!signal||loading)return;
  setLoading(true);setError("");const query={...params,cursor,view:"structure"};
  try{const part=await request(query,signal);if(signal.aborted)return;
   if(params.availability==='available'&&responseVersion(part)!==availabilityVersion(pageRef.current)){reload(signal,`snapshot:${responseVersion(part)??'unknown'}`);return;}
   loadedPages.current.push(query);publish({...part,availabilityRevision:part.statisticsRevision,statisticsReady:pageRef.current.statisticsReady,statisticsSnapshotRevision:pageRef.current.statisticsSnapshotRevision,statisticsUpdatedAt:pageRef.current.statisticsUpdatedAt,currentNode:part.currentNode&&pageRef.current.currentNode?.id===part.currentNode.id?{...part.currentNode,itemCount:pageRef.current.currentNode.itemCount,completedCount:pageRef.current.currentNode.completedCount,materialCount:pageRef.current.currentNode.materialCount,rehearsalCount:pageRef.current.currentNode.rehearsalCount,rehearsalCompletedCount:pageRef.current.currentNode.rehearsalCompletedCount}:part.currentNode,learningMaterials:pageRef.current.learningMaterials,materialNextCursor:pageRef.current.materialNextCursor,children:[...new Map([...pageRef.current.children,...part.children].map(n=>[n.id,n])).values()]});void counts(query,signal);}
  catch(e){if(!signal.aborted)setError(message(e));}finally{if(!signal.aborted)setLoading(false);}
 }
 useEffect(()=>{
  const abort=new AbortController();materialController.current=abort;setMaterialError("");setMaterialBusy(false);
  if(!reading||!params.nodeId)return()=>abort.abort();
  setMaterialBusy(true);
  const wanted=Math.max(restoreMaterials,pageRef.current.learningMaterials.length);
  void (async()=>{let after:string|undefined;let materials:BrowsePage<N>["learningMaterials"]=[];const seen=new Set<string>();do{const part=await request({...JSON.parse(key),view:"materials",...(after?{materialCursor:after}:{})},abort.signal);if(abort.signal.aborted)return;materials=[...new Map([...materials,...part.learningMaterials].map(g=>[g.id,g])).values()];after=part.materialNextCursor??undefined;if(after&&seen.has(after))throw new Error("教材分页异常");if(after)seen.add(after);if(!after||materials.length>=wanted)publish({...pageRef.current,learningMaterials:materials,materialNextCursor:part.materialNextCursor});}while(after&&materials.length<wanted);})().catch(e=>{if(!abort.signal.aborted)setMaterialError(message(e));}).finally(()=>{if(!abort.signal.aborted)setMaterialBusy(false);});
  return()=>abort.abort();
 },[request,key,reading,materialRetry]);
 async function moreMaterials(){const cursor=pageRef.current.materialNextCursor,signal=materialController.current?.signal;if(!cursor||!signal||materialBusy)return;setMaterialBusy(true);setMaterialError("");try{const part=await request({...params,view:"materials",materialCursor:cursor},signal);if(!signal.aborted)publish({...pageRef.current,learningMaterials:[...pageRef.current.learningMaterials,...part.learningMaterials],materialNextCursor:part.materialNextCursor});}catch(e){if(!signal.aborted)setMaterialError(message(e));}finally{if(!signal.aborted)setMaterialBusy(false);}}
 const seed=(query:Record<string,string>,page:BrowsePage<N>)=>{const nextKey=JSON.stringify(query);if(!cache.current.has(nextKey))cache.current.set(nextKey,page);};
 return {seed,page:state.key===key&&state.request===request?state.page:cache.current.get(key)??empty<N>(),loading,countBusy,materialBusy,error,countError,materialError,more,moreMaterials,retry:()=>setRetry(n=>n+1),retryCounts:()=>setCountRetry(n=>n+1),retryMaterials:()=>setMaterialRetry(n=>n+1)};
}
