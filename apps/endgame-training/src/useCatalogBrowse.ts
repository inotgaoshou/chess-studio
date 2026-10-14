import {useEffect,useRef,useState} from "react";

export type BrowseNode = {id:string;parentId?:string|null;name:string;kind?:string;itemCount?:number|null;completedCount?:number|null};
export type BrowsePage<N extends BrowseNode> = {currentNode?:N|null;breadcrumbs:N[];children:N[];nextCursor?:string|null;learningMaterials:{id:string;title:string;reviewStatus:string}[];materialNextCursor?:string|null};
export function useDebounced<T>(value:T,delay=300) {
 const [settled,setSettled]=useState(value);
 useEffect(()=>{const timer=setTimeout(()=>setSettled(value),delay);return()=>clearTimeout(timer);},[value,delay]);
 return settled;
}
const message=(e:unknown)=>e instanceof Error?e.message:String(e);
const empty=<N extends BrowseNode>():BrowsePage<N>=>({breadcrumbs:[],children:[],learningMaterials:[]});

/** Per-mounted-account navigation cache; counts never authorize content access. */
export function useCatalogBrowse<N extends BrowseNode>(request:(params:Record<string,string>,signal:AbortSignal)=>Promise<BrowsePage<N>>,params:Record<string,string>,reading:boolean,restoreCount=0,restoreMaterials=0) {
 const key=JSON.stringify(params);
 const cache=useRef(new Map<string,BrowsePage<N>>());
 useEffect(()=>()=>cache.current.clear(),[request]);
 const [state,setState]=useState({key,page:empty<N>()});
 const [loading,setLoading]=useState(true),[countBusy,setCountBusy]=useState(false),[materialBusy,setMaterialBusy]=useState(false);
 const [error,setError]=useState(""),[countError,setCountError]=useState(""),[materialError,setMaterialError]=useState("");
 const [retry,setRetry]=useState(0),[countRetry,setCountRetry]=useState(0),[materialRetry,setMaterialRetry]=useState(0);
 const controller=useRef<AbortController|null>(null),pageRef=useRef(empty<N>());
 const loadedPages=useRef<Record<string,string>[]>([]);
 const materialController=useRef<AbortController|null>(null);
 const publish=(page:BrowsePage<N>)=>{pageRef.current=page;cache.current.set(key,page);setState({key,page});};
 const countPending=useRef(0);
 async function counts(query:Record<string,string>,signal:AbortSignal) {
  countPending.current++;setCountBusy(true);
  try {
   const result=await request({...query,view:"counts"},signal);
   if(signal.aborted)return;
   const all=new Map([...result.children,...(result.currentNode?[result.currentNode]:[])].map(n=>[n.id,n]));
   const update=(n:N)=>all.has(n.id)?{...n,itemCount:all.get(n.id)!.itemCount,completedCount:all.get(n.id)!.completedCount}:n;
   publish({...pageRef.current,children:pageRef.current.children.map(update),currentNode:pageRef.current.currentNode?update(pageRef.current.currentNode):null});
  } catch(e){if(!signal.aborted)setCountError(message(e));}
  finally {if(!signal.aborted){countPending.current--;setCountBusy(countPending.current>0);}}
 }
 useEffect(()=>{
  const abort=new AbortController();controller.current=abort;countPending.current=0;
  const saved=cache.current.get(key);pageRef.current=saved??empty<N>();setState({key,page:pageRef.current});
  setLoading(true);setError("");setCountError("");setCountBusy(false);loadedPages.current=[];
  void (async()=>{
   let cursor:string|undefined;let combined=empty<N>();const seen=new Set<string>();
   do {
    const query={...JSON.parse(key),view:"structure",...(cursor?{cursor}:{})};
    const part=await request(query,abort.signal);if(abort.signal.aborted)return;
    loadedPages.current.push(query);
    const prior=new Map(pageRef.current.children.map(n=>[n.id,n]));
    combined={...part,learningMaterials:pageRef.current.learningMaterials,materialNextCursor:pageRef.current.materialNextCursor,children:[...combined.children.map(n=>prior.get(n.id)??n),...part.children.map(n=>({...n,itemCount:prior.get(n.id)?.itemCount??n.itemCount,completedCount:prior.get(n.id)?.completedCount??n.completedCount}))]};
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
  try{const part=await request(query,signal);if(signal.aborted)return;loadedPages.current.push(query);publish({...part,learningMaterials:pageRef.current.learningMaterials,materialNextCursor:pageRef.current.materialNextCursor,children:[...new Map([...pageRef.current.children,...part.children].map(n=>[n.id,n])).values()]});void counts(query,signal);}
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
 return {page:state.key===key?state.page:cache.current.get(key)??empty<N>(),loading,countBusy,materialBusy,error,countError,materialError,more,moreMaterials,retry:()=>setRetry(n=>n+1),retryCounts:()=>setCountRetry(n=>n+1),retryMaterials:()=>setMaterialRetry(n=>n+1)};
}
