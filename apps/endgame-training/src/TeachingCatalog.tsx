import { practiceGroupIds } from "./practiceNavigation";
import { canViewExerciseSolutions } from "./exercisePresentation";
import { MobileCatalogFilters, activeCatalogFilterCount } from "./MobileCatalogFilters";
import {catalogContentLabels,catalogVisibleChildren,catalogReadingItems} from "./catalogContent";
import { ArrowLeft, BookOpen, SlidersHorizontal, X } from "lucide-react";
import { basicEntryOrder, hasActiveCatalogVip } from "./catalogAccess";
import {clearCatalogBrowseCache,useCatalogBrowse,useDebounced} from "./useCatalogBrowse";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CatalogChevron, CatalogIcon, CatalogSearch, CatalogState } from "./CatalogPresentation";
import { teachingClient, type TeachingAuth, type TeacherProblem } from "./teaching";
import "./teachingCatalog.css";
export type TrainingGoal = import("../../../packages/training-verification/types").VerificationGoal;
export type TeachingCatalogNode = { id: string; parentId?: string | null; name: string; kind: string; displayOrder: number; active: boolean; confirmed: boolean; itemCount?: number|null; completedCount?: number|null; materialCount?:number|null; rehearsalCount?:number|null; rehearsalCompletedCount?:number|null; description?:string; icon?:string; teachingEntry?:string };
export type CatalogProblem = TeacherProblem & { contentFingerprint?: string; verifiedMateMoves?: number | null; trainingGoal?: TrainingGoal | null; difficulty?: number | null; teachingChapter?: string };
export function goalLabel(goal?: TrainingGoal | null) { return goal ? ({ mate: "杀棋", gain_material: "得子", draw: "求和", endgame_win: "残局胜法" }[goal.kind] || "题目目标") : "原题解"; }
export function FenThumbnail({ fen }: { fen: string }) {
  const labels: Record<string, string> = { k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒", K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵" };
  const pieces: Array<{ x: number; y: number; code: string }> = [];
  for (const [row, rank] of (fen.split(" ")[0] || "").split("/").entries()) { let col = 0; for (const code of rank) { if (/\d/.test(code)) col += Number(code); else { if (col < 9 && row < 10 && labels[code]) pieces.push({ x: 12 + col * 18, y: 12 + row * 18, code }); col++; } } }
  return <svg className="catalog-board" viewBox="0 0 168 186" role="img" aria-label="初始棋盘缩略图"><rect width="168" height="186" rx="5" fill="#f4deb3"/>{Array.from({ length: 10 }, (_, i) => <path key={`r${i}`} d={`M12 ${12 + i * 18}h144`} stroke="#a88c60" strokeWidth=".7"/>)}{Array.from({ length: 9 }, (_, i) => <path key={`c${i}`} d={i === 0 || i === 8 ? `M${12 + i * 18} 12v162` : `M${12 + i * 18} 12v72m0 18v72`} stroke="#a88c60" strokeWidth=".7"/>)}<path d="M66 12l36 36m0-36L66 48m0 90l36 36m0-36l-36 36" stroke="#a88c60" strokeWidth=".7"/>{pieces.map(({ x, y, code }, i) => <g key={i}><circle cx={x} cy={y} r="7.8" fill="#fff5df" stroke="#a98d62"/><text x={x} y={y + 3.2} textAnchor="middle" fontSize="10" fontWeight="700" fill={code === code.toUpperCase() ? "#a32c22" : "#282620"}>{labels[code]}</text></g>)}</svg>;
}
export type CatalogBrowsePage = { currentNode?:TeachingCatalogNode|null; breadcrumbs:TeachingCatalogNode[]; children:TeachingCatalogNode[]; nextCursor?:string|null; learningMaterials:Array<{id:string;title:string;reviewStatus:string}>; materialNextCursor?:string|null };
type Props = { auth?: TeachingAuth; teacher?: boolean; scene?: "browse" | "select"; compact?: boolean; onNavigate?():void; onLocationChange?(inside:boolean):void; sourceLibraryId?:string; selectedIds?: string[]; onAdd?(items: CatalogProblem[]): void; onRemove?(id:string):void; onPractice?(ids:string[],title?:string,preferredProblemId?:string):void; onRehearse?(id:string):void; onReadGame?(id:string):void; onReadSolution?(ids:string[]):void };
type ItemPage = {items:CatalogProblem[];cursor?:string|null};
const itemDisplays = new Map<string, Map<string, ItemPage>>();
function itemDisplayCache(scope:string) {
  let cache=itemDisplays.get(scope);
  if(!cache){cache=new Map();itemDisplays.set(scope,cache);}
  if(itemDisplays.size>8)itemDisplays.delete(itemDisplays.keys().next().value!);
  return cache;
}
function saveItemDisplay(cache:Map<string,ItemPage>,key:string,page:ItemPage){cache.set(key,page);if(cache.size>80)cache.delete(cache.keys().next().value!);}
type CatalogLocation = {teachingEntry?:string;mateChoice?:string|null;directoryQuery:string; query:string; goal:string; difficulty:string; mateGroup:string; mateMoves:string; material:string; motif:string; mode:string; nodeCount:number; itemCount:number; materialCount:number; scroll:number};
const navigation = new Map<string,CatalogLocation & {id:string|null}>();
const locationCaches = new Map<string,Map<string,CatalogLocation>>();
function scopedLocations(scope:string) {
  let locations=locationCaches.get(scope);
  if(!locations){locations=new Map();locationCaches.set(scope,locations);}
  if(locationCaches.size>8)locationCaches.delete(locationCaches.keys().next().value!);
  return locations;
}
export function TeachingCatalog(props:Props) { const [epoch,setEpoch]=useState(0);useEffect(()=>{const reset=()=>{navigation.clear();locationCaches.clear();itemDisplays.clear();clearCatalogBrowseCache();setEpoch(v=>v+1);};window.addEventListener("teaching-content-reset",reset);return()=>window.removeEventListener("teaching-content-reset",reset);},[]);const scope=`${teachingClient.presentationScope(props.auth)}:${Boolean(props.teacher)}:${props.scene ?? "select"}:${props.sourceLibraryId??""}`;return <CatalogView key={`${scope}:${canViewExerciseSolutions(props.auth)}:${epoch}`} {...props} scope={scope}/>; }
function scrollContainer(element:HTMLElement|null):HTMLElement|undefined { for(let parent=element?.parentElement;parent;parent=parent.parentElement){if(/auto|scroll/.test(getComputedStyle(parent).overflowY))return parent;} }
const browseParams=(id:string|null,q:string):Record<string,string>=>({availability:"available",allowStaleCounts:"true",limit:"50",...(id?{nodeId:id}:{}),...(q?{q}:{})});
// Production placements verified 2026-10-20. Other editions/placements remain available.
const BASIC_TOPIC_ID = "e0c0221d-1b02-5f2c-9122-a7b0821f2603";
const HIDDEN_BASIC_BOOKS = new Set(["90134f10-dc44-4b4e-b203-992af2d4c73c", "38f0967a-3b69-4fa5-9834-534959af52ed"]);
const MATE_TEACHING_ENTRIES = new Set(["basic_mates", "mate_series", "checking_mates", "quiet_mates", "practical_mates", "endgame_mates"]);
function CatalogView({ auth, teacher = false, scene = "select", compact = false, onNavigate, onLocationChange, sourceLibraryId, selectedIds = [], onAdd, onRemove, onPractice, onRehearse, onReadGame, onReadSolution, scope }: Props & {scope:string}) {
  const selection = teacher && scene === "select";
  const answersAllowed = canViewExerciseSolutions(auth);
  const mobileBrowse = compact && scene === "browse";
  // Old mobile views could persist hidden searches and the removed rehearsal tab.
  const restoreLocation = <T extends CatalogLocation>(saved:T|undefined):T|undefined => saved && mobileBrowse
    ? {...saved,directoryQuery:"",query:"",difficulty:"",material:"",mode:saved.mode==="reading"?"reading":"training",...(saved.directoryQuery||saved.query||saved.difficulty||saved.material?{nodeCount:0,itemCount:0,materialCount:0,scroll:0}:{})}
    : saved;
  const previous=restoreLocation(navigation.get(scope));
  const restored=mobileBrowse && previous && HIDDEN_BASIC_BOOKS.has(previous.id ?? "") ? {...previous,id:BASIC_TOPIC_ID,nodeCount:0,itemCount:0,scroll:0} : previous;
  const [catalogEntry,setCatalogEntry]=useState(restored?.teachingEntry||"");
  // Unknown legacy locations wait for their topic before enabling reading.
  const studentTrainingOnly=mobileBrowse&&auth?.user.role==="student"&&(!catalogEntry||MATE_TEACHING_ENTRIES.has(catalogEntry));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const viewRef=useRef<HTMLElement>(null);
  const readScroll=()=>scrollContainer(viewRef.current)?.scrollTop??window.scrollY;
  const restoreScroll=()=>{const top=directMate&&stepScroll.current.has(stepVisitKey)?stepScroll.current.get(stepVisitKey)!:restoreLocation(locations.current.get(nodeId||"root"))?.scroll??(restored?.id===nodeId?restored.scroll:0)??0;const container=scrollContainer(viewRef.current);if(container)container.scrollTop=top;else window.scrollTo(0,top);};
  const [nodeId, setNodeId] = useState<string | null>(restored?.id||null);
  const [items, setItems] = useState<CatalogProblem[]>([]); const [cursor, setCursor] = useState<string | null>(); const [query, setQuery] = useState(restored?.query||""); const [goal, setGoal] = useState(restored?.goal||""); const [rawDifficulty, setDifficulty] = useState(restored?.difficulty||"");
  const [mateGroup, setMateGroup] = useState(restored?.mateGroup||""); const [rawMateMoves, setMateMoves] = useState(restored?.mateMoves||"");
  const [rawMaterial,setMaterial]=useState(restored?.material||""),[motif,setMotif]=useState(restored?.motif||"");
  const [mateChoice,setMateChoice]=useState<string|null>(restored?.mateChoice??null);
  useEffect(()=>{onLocationChange?.(!!nodeId);},[nodeId,onLocationChange]);
  const [problemLoading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [retry, setRetry] = useState(0); const generation = useRef(0);const browseGeneration=useRef(0);
  const [directoryQuery,setDirectoryQuery]=useState(restored?.directoryQuery||""),[contentMode,setMode]=useState(restored?.mode||"training");
  const mode=studentTrainingOnly?"training":contentMode;
  const directorySearch=useDebounced(directoryQuery,300,nodeId),problemSearch=useDebounced(query,300,nodeId),motifSearch=useDebounced(motif,300,nodeId);
  const params=(id:string|null,q:string)=>({...browseParams(id,q),...(mobileBrowse&&id?{includeMateSteps:"true"}:{}),...(sourceLibraryId?{libraryId:sourceLibraryId}:{})});
  const restricted=!teacher&&!hasActiveCatalogVip(auth);
  const request=useCallback((params:Record<string,string>,signal:AbortSignal)=>teachingClient.catalogBrowse(params,teacher,auth,signal),[teacher,auth]);
  const browse=useCatalogBrowse<TeachingCatalogNode>(request,params(nodeId,directorySearch),mode==="reading",navigation.get(scope)?.nodeCount||0,navigation.get(scope)?.id===nodeId?navigation.get(scope)?.materialCount||0:0,scope);
  const resolvedEntry=browse.page.breadcrumbs.find(n=>n.teachingEntry)?.teachingEntry??browse.page.currentNode?.teachingEntry;
  useEffect(()=>{if(browse.page.currentNode?.id===nodeId&&resolvedEntry)setCatalogEntry(resolvedEntry);},[nodeId,browse.page.currentNode?.id,resolvedEntry]);
  useEffect(()=>{const refresh=()=>browse.retry();window.addEventListener("teaching-rehearsal-updated",refresh);return()=>window.removeEventListener("teaching-rehearsal-updated",refresh);},[browse.retry]);
  const basicBrowse = mobileBrowse && browse.page.breadcrumbs.some(n=>n.id===BASIC_TOPIC_ID && n.teachingEntry==="basic_mates");
  const allowedNodes=(restricted&&!nodeId?browse.page.children.filter(n=>basicEntryOrder(n.teachingEntry)>=0):browse.page.children)
    .filter(n=>!basicBrowse || !HIDDEN_BASIC_BOOKS.has(n.id));
  const nodes=!nodeId?[...allowedNodes].sort((a,b)=>(basicEntryOrder(a.teachingEntry)<0?4:basicEntryOrder(a.teachingEntry))-(basicEntryOrder(b.teachingEntry)<0?4:basicEntryOrder(b.teachingEntry))||a.displayOrder-b.displayOrder):allowedNodes,path=browse.page.breadcrumbs,materials=browse.page.learningMaterials,nodeCursor=browse.page.nextCursor,materialCursor=browse.page.materialNextCursor;
  const directMate = mobileBrowse && path.some(n=>basicEntryOrder(n.teachingEntry)>=0);
  const stepCounts=browse.page.mateStepCounts;
  const firstStep=stepCounts?.filter(n=>n.itemCount>0).map(n=>n.mateMoves).sort((a,b)=>a-b)[0];
  const selectedStep=mateChoice??(firstStep?String(firstStep):"all");
  useEffect(()=>{if(directMate&&mateChoice===null&&stepCounts!=null&&browse.page.currentNode?.id===nodeId)setMateChoice(firstStep?String(firstStep):"all");},[directMate,mateChoice,stepCounts,firstStep,nodeId,browse.page.currentNode?.id]);
  const mateMoves=directMate&&mode==="training"?(selectedStep==="all"?"":selectedStep):rawMateMoves;
  const difficulty=mobileBrowse?"":rawDifficulty,material=mobileBrowse?"":rawMaterial;
  const filters={goal,difficulty,material,motif,mateGroup,mateMoves};
  const filterCount=activeCatalogFilterCount(filters,directMate,mobileBrowse);
  const loading=problemLoading||browse.loading;
  // Some published leaf categories contain questions directly, without chapter children.
  const problemLevel = directMate || browse.page.currentNode?.kind === "chapter" || Boolean(nodeId && browse.page.currentNode?.id === nodeId && !browse.loading && !nodes.length && !nodeCursor && (browse.page.currentNode.itemCount ?? 0) > 0);

  const locations=useRef(scopedLocations(scope));
  function saveNavigation(){if(directMate)stepScroll.current.set(stepVisitKey,readScroll());const location={teachingEntry:catalogEntry,mateChoice,directoryQuery,query,goal,difficulty,mateGroup,mateMoves,material,motif,mode,nodeCount:nodes.length,itemCount:items.length,materialCount:materials.length,scroll:readScroll()};navigation.set(scope,{id:nodeId,...location});locations.current.set(nodeId||"root",location);if(locations.current.size>80)locations.current.delete(locations.current.keys().next().value!);}
  const pendingScroll=useRef(true);
  const stepScroll=useRef(new Map<string,number>());
  const stepVisitKey=`${nodeId}:${selectedStep}`;
  const chooseStep=(value:string)=>{if(selectedStep===value)return;stepScroll.current.set(stepVisitKey,readScroll());saveNavigation();setMateChoice(value);setMateGroup("");setMateMoves("");pendingScroll.current=true;stepScroll.current.set(`${nodeId}:${value}`,0);for(const key of itemCache.current.keys()){const saved=JSON.parse(key);if(saved[0]===nodeId&&saved[2]==="training"&&saved[7]===(value==="all"?"":value))itemCache.current.delete(key);}};
  useLayoutEffect(()=>{const top=restoreLocation(locations.current.get(nodeId||"root"))?.scroll??(restored?.id===nodeId?restored.scroll:0)??0;const container=scrollContainer(viewRef.current);if(container)container.scrollTop=top;else window.scrollTo(0,top);},[nodeId,scope]);
  const autoReading=useRef(false);
  useEffect(()=>{if(autoReading.current&&browse.page.currentNode?.id===nodeId&&browse.page.currentNode.itemCount!=null){autoReading.current=false;if(browse.page.currentNode.itemCount===0&&(browse.page.currentNode.materialCount??0)>0)setMode("reading");}},[nodeId,browse.page.currentNode]);
  function navigate(id:string|null){onNavigate?.();setMateChoice(restoreLocation(locations.current.get(id||"root"))?.mateChoice??null);pendingScroll.current=true;saveNavigation();const old=restoreLocation(locations.current.get(id||"root"));autoReading.current=!mobileBrowse&&!old;setDirectoryQuery(old?.directoryQuery||"");setQuery(old?.query||"");setGoal(old?.goal||"");setDifficulty(old?.difficulty||"");setMateGroup(old?.mateGroup||"");setMateMoves(old?.mateMoves||"");setMaterial(old?.material||"");setMotif(old?.motif||"");const target=nodes.find(n=>n.id===id)??path.find(n=>n.id===id);
    if(target){const ancestor=path.findIndex(n=>n.id===id);browse.seed(params(id,old?.directoryQuery||""),{...browse.page,currentNode:target,breadcrumbs:ancestor>=0?path.slice(0,ancestor+1):[...path,target],children:[],nextCursor:null,learningMaterials:[],materialNextCursor:null,mateStepCounts:null});}
    setCatalogEntry(id?(old?.teachingEntry||path.find(n=>n.teachingEntry)?.teachingEntry||target?.teachingEntry||""):"");setMode(old?.mode||(!mobileBrowse&&target?.itemCount===0&&(target.materialCount??0)>0?"reading":"training"));setNodeId(id);}
  useEffect(()=>{if(basicBrowse && path.some(n=>HIDDEN_BASIC_BOOKS.has(n.id))) navigate(BASIC_TOPIC_ID);},[basicBrowse,nodeId,path]);
  useEffect(()=>{const old=navigation.get(scope);const same=old?.id===nodeId&&old.directoryQuery===directoryQuery&&old.query===query&&old.goal===goal&&old.difficulty===difficulty&&old.mateGroup===mateGroup&&old.mateMoves===mateMoves&&old.material===material&&old.motif===motif;navigation.set(scope,{id:nodeId,teachingEntry:catalogEntry,mateChoice,directoryQuery,query,goal,difficulty,mateGroup,mateMoves,material,motif,mode,nodeCount:same?old.nodeCount:0,itemCount:same?old.itemCount:0,materialCount:same?old.materialCount:0,scroll:old?.id===nodeId?old.scroll:0});},[scope,nodeId,catalogEntry,mateChoice,directoryQuery,query,goal,difficulty,mateGroup,mateMoves,material,motif,mode]);

  const itemKey=JSON.stringify([nodeId,browse.page.statisticsSnapshotRevision??browse.page.availabilitySnapshotRevision??browse.page.statisticsRevision??null,mode,problemSearch,goal,difficulty,mateGroup,mateMoves,material,motifSearch]);
  const itemAbort=useRef<AbortController|null>(null);
  const [itemOwner,setItemOwner]=useState("");const shownItems=itemOwner===itemKey?items:[];
  const itemCache=useRef(itemDisplayCache(scope));
  function changeMobileFilters(next: typeof filters) {
    // A filter change starts at page one, including returning to a cached unfiltered list.
    for(const key of itemCache.current.keys()) {const saved=JSON.parse(key);if(saved[0]===nodeId&&saved[2]==="training")itemCache.current.delete(key);}
    const saved=locations.current.get(nodeId||"root");if(saved)locations.current.set(nodeId||"root",{...saved,itemCount:0});
    const nav=navigation.get(scope);if(nav)navigation.set(scope,{...nav,itemCount:0});
    setGoal(next.goal);setDifficulty(next.difficulty);setMaterial(next.material);setMotif(next.motif);setMateGroup(next.mateGroup);
    if(!directMate)setMateMoves(next.mateMoves);
    pendingScroll.current=false;
    // Keyword edits use the debounced item key; forcing retry here sends the
    // previous keyword once per keystroke and defeats request cancellation.
    if(Object.keys(filters).every(key=>next[key as keyof typeof filters]===filters[key as keyof typeof filters]))setRetry(n=>n+1);
  }
  useLayoutEffect(()=>{
    const version=++generation.current,abort=new AbortController();itemAbort.current=abort;setBusy(false);const cached=itemCache.current.get(itemKey);
    setItems(cached?.items??[]);setCursor(cached?.cursor);setItemOwner(itemKey);setError("");setLoading(false);
    if(!nodeId||mode==="rehearsal"||(!problemLevel&&mode!=="reading"))return;
    if(mode==="reading"&&!answersAllowed)return;
    setLoading(true);
    void(async()=>{
      const filter=mode==="reading"?{}:{q:problemSearch,goal,mateGroup:directMate?"":mateGroup,material,motif:motifSearch,mateMoves:mateMoves?Number(mateMoves):undefined,difficulty:difficulty?Number(difficulty):undefined};
      let after:string|undefined;let all:CatalogProblem[]=[];const seen=new Set<string>();const saved=locations.current.get(nodeId)??(navigation.get(scope)?.id===nodeId?navigation.get(scope):undefined);
      const same=saved?.query===query&&saved.goal===goal&&saved.material===material&&saved.motif===motif&&saved.difficulty===difficulty&&saved.mateMoves===mateMoves&&saved.mateGroup===mateGroup;
      const wanted=Math.max(cached?.items.length??0,same?saved.itemCount:0);
      do {const page=await teachingClient.catalogProblems(nodeId,{...filter,libraryId:sourceLibraryId,cursor:after},teacher,auth,abort.signal);if(abort.signal.aborted)return;all=[...new Map([...all,...page.items].map(p=>[p.id,p])).values()];if(all.length>=wanted||!page.nextCursor){setItems(all);setCursor(page.nextCursor);saveItemDisplay(itemCache.current,itemKey,{items:all,cursor:page.nextCursor});}after=page.nextCursor??undefined;if(after&&seen.has(after))throw new Error("题目分页异常");if(after)seen.add(after);}while(after&&all.length<wanted);
    })().catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(version===generation.current)setLoading(false);});
    return()=>{abort.abort();generation.current++;};
  },[scope,itemKey,problemLevel,retry,answersAllowed]);

  const [lines,setLines]=useState<{id:string;title:string;completed:boolean}[]>([]),[lineCursor,setLineCursor]=useState<string|null>(),[lineError,setLineError]=useState(""),[lineBusy,setLineBusy]=useState(false);
  const lineGeneration=useRef(0);
  useEffect(()=>{const version=++lineGeneration.current,abort=new AbortController();setLines([]);setLineCursor(null);setLineError("");setLineBusy(false);if(mode!=="rehearsal"||!nodeId)return;setLineBusy(true);void teachingClient.catalogRehearsals(nodeId,undefined,teacher,auth,abort.signal).then(page=>{if(version===lineGeneration.current){setLines(page.items);setLineCursor(page.nextCursor);}}).catch(e=>{if(!abort.signal.aborted)setLineError(String(e));}).finally(()=>{if(version===lineGeneration.current)setLineBusy(false);});return()=>{abort.abort();lineGeneration.current++;};},[nodeId,mode,teacher,auth]);
  async function moreLines(){if(!nodeId||!lineCursor||lineBusy)return;const version=lineGeneration.current;setLineBusy(true);try{const page=await teachingClient.catalogRehearsals(nodeId,lineCursor,teacher,auth);if(version===lineGeneration.current){setLines(old=>[...new Map([...old,...page.items].map(n=>[n.id,n])).values()]);setLineCursor(page.nextCursor);}}catch(e){if(version===lineGeneration.current)setLineError(String(e));}finally{if(version===lineGeneration.current)setLineBusy(false);}}
  const current=browse.page.currentNode;const children=nodeId&&!selection?catalogVisibleChildren(nodes,mode,browse.page.currentNode?.teachingEntry):nodes;
  useEffect(()=>{if(!pendingScroll.current||loading||(mode==="reading"&&browse.materialBusy)||(current?.id??null)!==nodeId||((problemLevel||(mode==="reading"&&answersAllowed))&&itemOwner!==itemKey))return;const frame=requestAnimationFrame(()=>{pendingScroll.current=false;restoreScroll();});return()=>cancelAnimationFrame(frame);},[nodeId,loading,browse.materialBusy,mode,itemOwner,itemKey,current?.id,problemLevel]);
  const moreDirectories=()=>browse.more();
  const moreMaterials=()=>browse.moreMaterials();
  async function more() { if (busy || !cursor || !nodeId) return; const version = generation.current; setBusy(true); try { const page = await teachingClient.catalogProblems(nodeId, { libraryId:sourceLibraryId, ...(mode === "reading" ? {} : { q: problemSearch, goal, mateGroup:directMate?"":mateGroup, material, motif:motifSearch, mateMoves: mateMoves ? Number(mateMoves) : undefined, difficulty: difficulty ? Number(difficulty) : undefined }), cursor }, teacher, auth, itemAbort.current?.signal); if (version === generation.current) { setItems(old => {const items=[...new Map([...old, ...page.items].map(p => [p.id, p])).values()];saveItemDisplay(itemCache.current,itemKey,{items,cursor:page.nextCursor});return items;}); setCursor(page.nextCursor); } } catch (reason) { if(version===generation.current)setError(String(reason)); } finally { if(version===generation.current)setBusy(false); } }
  async function selectChapter() { if (busy || !nodeId) return; const version = generation.current; setBusy(true); setError(""); try { const all: CatalogProblem[] = []; let next: string | undefined; const cursors = new Set<string>(); do { const page = await teachingClient.catalogProblems(nodeId, { libraryId:sourceLibraryId, q: query, goal, mateGroup, material, motif, mateMoves: mateMoves ? Number(mateMoves) : undefined, difficulty: difficulty ? Number(difficulty) : undefined, cursor: next, limit: 100 }, teacher, auth); all.push(...page.items); next = page.nextCursor || undefined; if (next && cursors.has(next)) throw new Error("题目分页异常，请重试"); if (next) cursors.add(next); if (all.length > 10000) throw new Error("请按章节拆分，单次最多选择10000题"); } while (next && version === generation.current); if (version === generation.current) onAdd?.(all.map(p => ({ ...p, teachingChapter: current?.name }))); } catch (reason) { if(version===generation.current)setError(String(reason)); } finally { if(version===generation.current)setBusy(false); } }
  return <section ref={viewRef} className={`teaching-catalog ${compact ? "catalog-compact" : ""} ${mobileBrowse ? "catalog-phone-browse" : ""}`} aria-label="教学题库目录" aria-busy={loading||busy}>
    {selection&&<header className="catalog-mobile-heading"><div><h2>教学题库</h2><p>{selection?"按章节选题，组合布置作业":"按章节学习，循序练习"}</p></div>{selection&&<span className="catalog-count">已选 {new Set(selectedIds).size} 题</span>}</header>}
    {mobileBrowse && nodeId && <header className="catalog-back-heading"><button type="button" aria-label="返回上级目录" onClick={()=>navigate(current?.parentId||path.at(-2)?.id||null)}><ArrowLeft aria-hidden="true"/>返回</button><h3>{current?.name||path.at(-1)?.name||"当前章节"}</h3></header>}
    {!mobileBrowse && nodeId&&<nav className="catalog-breadcrumb" aria-label="教学目录路径"><button type="button" onClick={()=>navigate(browse.page.currentNode?.parentId||null)}>返回上级</button>{path.map(n => <button type="button" disabled={busy} key={n.id} aria-current={n.id===nodeId?"page":undefined} onClick={() => navigate(n.id)}>› {n.name}</button>)}</nav>}
    {!mobileBrowse && (teacher || nodeId) && (!compact || !problemLevel || mode !== "training") && <CatalogSearch value={directoryQuery} onChange={setDirectoryQuery}/>}
    {compact && !mobileBrowse && problemLevel && mode === "training" && <div className="catalog-search-tools">{!mobileBrowse && <div className="catalog-search"><input aria-label="搜索题名" placeholder="搜索题名" value={query} onChange={e => setQuery(e.target.value)}/></div>}<button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}><SlidersHorizontal/>筛选{filterCount > 0 && <span>{filterCount}</span>}</button></div>}
    {!mobileBrowse && current&&<div className="catalog-section-heading"><div><h3>{current.name}</h3>{current.description&&(compact ? <details className="catalog-description"><summary>查看说明</summary><p>{current.description}</p></details> : <p>{current.description}</p>)}</div><span className="catalog-count">{catalogContentLabels(current,browse.page.statisticsReady===false?"统计更新中…":"统计中…",selection?"题可布置":"可练题").join(" · ")}</span></div>}
    {directMate && mode==="training" && <div className="catalog-mate-navigation">
      <div className="catalog-mate-tabs" role="tablist" aria-label="杀法步数">{[1,2,3,4].map(n=><button type="button" role="tab" aria-selected={selectedStep===String(n)} key={n} onClick={()=>chooseStep(String(n))}>{["","一步杀","两步杀","三步杀","四步杀"][n]}</button>)}
      <label className="catalog-more-steps"><span>{Number(selectedStep)>=5?`${selectedStep}步杀 ▾`:"更多步数 ▾"}</span><select aria-label="更多步数" value={Number(selectedStep)>=5?selectedStep:""} onChange={e=>{if(e.target.value)chooseStep(e.target.value);}}><option value="" disabled>更多步数</option>{stepCounts?.filter(n=>n.mateMoves>=5&&n.itemCount>0).map(n=><option key={n.mateMoves} value={n.mateMoves}>{n.mateMoves}步杀（{n.itemCount}题）</option>)}</select></label></div>
      {stepCounts==null?<div className="catalog-step-status" role="status">步数统计更新中，可先按原书题序浏览。<button type="button" onClick={browse.retryCounts}>重试统计</button></div>:!firstStep?<p className="catalog-step-status">步数待确认，按原书题序显示。</p>:null}
      <button className="catalog-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal aria-hidden="true"/>筛选{filterCount>0&&<span>{filterCount}</span>}</button>
      {selectedStep!=="all"&&<button className="catalog-original-order" type="button" onClick={()=>chooseStep("all")}>按原书题序浏览</button>}
    </div>}
    {directMate && <details key={nodeId} className="catalog-textbooks"><summary>按教材查看</summary>{!studentTrainingOnly&&<div className="catalog-tabs"><button type="button" aria-pressed={mode==="training"} onClick={()=>setMode("training")}>做题训练</button><button type="button" aria-pressed={mode==="reading"} onClick={()=>setMode("reading")}>教材学习</button></div>}{children.map(n=><button type="button" className="catalog-textbook-row" key={n.id} onClick={()=>navigate(n.id)}><span>{n.name}</span><CatalogChevron/></button>)}{nodeCursor&&<button type="button" onClick={()=>void moreDirectories()}>更多教材</button>}</details>}
    {!directMate && children.length > 0 && <div className={`catalog-nodes ${nodeId?"catalog-chapter-rows":""}`}>{children.map(n => <button type="button" disabled={busy} key={n.id} className={n.name.includes("陈松顺")?"catalog-featured":""} onClick={() => navigate(n.id)}><CatalogIcon entry={n.teachingEntry} name={n.name} chapter={!!nodeId}/><span className="catalog-node-copy"><strong>{n.name}</strong><span className="catalog-node-meta">{catalogContentLabels(n,browse.page.statisticsReady===false?"统计更新中…":"统计中…",selection?"题可布置":"可练题",mobileBrowse).map(label=><span key={label}>{label}</span>)}{!n.confirmed&&<span className="catalog-badge catalog-badge-pending">待确认</span>}{!n.active&&<span className="catalog-badge">停用</span>}{n.name.includes("陈松顺")&&<span className="catalog-badge catalog-badge-featured">陈松顺专题</span>}</span></span><CatalogChevron/></button>)}</div>}
    {!directMate&&nodeCursor&&<button type="button" className="catalog-more" disabled={busy} onClick={()=>void moreDirectories()}>更多系列 / 章节</button>}
    {nodeId && <>{!directMate&&(!studentTrainingOnly||problemLevel)&&<div className="catalog-content-toolbar">{!studentTrainingOnly&&<div className="catalog-tabs" aria-label="目录内容"><button type="button" aria-pressed={mode==="training"} onClick={()=>{onNavigate?.();autoReading.current=false;setMode("training");}}>做题训练</button>{!mobileBrowse && <button type="button" aria-pressed={mode==="rehearsal"} onClick={()=>{onNavigate?.();autoReading.current=false;setMode("rehearsal");}}>线路复现{current?.rehearsalCount!=null?`（${current.rehearsalCount}）`:""}</button>}<button type="button" aria-pressed={mode==="reading"} onClick={()=>{onNavigate?.();autoReading.current=false;setMode("reading");}}>棋谱学习</button></div>}{mobileBrowse && problemLevel && mode==="training" && <button className="catalog-filter-toggle" type="button" aria-expanded={filtersOpen} onClick={()=>setFiltersOpen(v=>!v)}><SlidersHorizontal aria-hidden="true"/>筛选{filterCount>0 && <span>{filterCount}</span>}</button>}</div>}
      {!mobileBrowse && mode==="rehearsal"?<div className="catalog-reading"><p>双方按原谱练习，线路学习与答题成绩分别记录。</p>{lineError&&<p role="alert">{lineError}</p>}{lineBusy&&<p role="status">正在读取线路…</p>}{lines.map(g=><button type="button" key={g.id} onClick={()=>{saveNavigation();onRehearse?.(g.id);}}><span>{g.title}{g.completed&&" · 已完成复现"}</span><CatalogChevron/></button>)}{lineCursor&&<button disabled={lineBusy} onClick={()=>void moreLines()}>更多线路</button>}{!lineBusy&&!lines.length&&!lineError&&<p>暂无已审核完整线路；可到棋谱学习中阅读。</p>}</div>:mode==="reading"?<div className="catalog-reading">{!mobileBrowse && <p className="catalog-description">{answersAllowed?"已审核学习棋谱及已发布题解":"已审核学习棋谱"}</p>}{materials.map(g=><button type="button" key={g.id} onClick={()=>{saveNavigation();onReadGame?.(g.id);}}><span>{g.title}</span><CatalogChevron/></button>)}{materialCursor&&<button type="button" disabled={busy} onClick={()=>void moreMaterials()}>更多学习棋谱</button>}{(answersAllowed?catalogReadingItems(shownItems):[]).map(p=><button type="button" className="catalog-reading-solution" key={p.id} onClick={()=>{saveNavigation();if(answersAllowed)onReadSolution?.([p.id]);}}><FenThumbnail fen={p.startingFen}/><span>题解 · {p.title}<small>{p.sideToMove==="w"||p.sideToMove==="red"?"红方先行":"黑方先行"}</small></span><CatalogChevron/></button>)}{answersAllowed&&cursor&&<button type="button" disabled={busy} onClick={()=>void more()}>更多题解</button>}</div>
      :problemLevel?<>{mobileBrowse ? filtersOpen && <MobileCatalogFilters filters={filters} directMate={directMate} onClose={()=>setFiltersOpen(false)} onChange={changeMobileFilters}/> : (!compact || filtersOpen) && <fieldset className="catalog-filters"><legend>筛选题目</legend>{compact && <button type="button" onClick={() => {setGoal("");setMateGroup("");setMateMoves("");setMaterial("");setMotif("");setDifficulty("");}}><X/>清空</button>}{!compact && <label><span>搜索章节题目</span><input aria-label="搜索章节题目" placeholder="搜索题名或原分类" value={query} onChange={e => setQuery(e.target.value)}/></label>}
          <label><span>题目目标</span><select aria-label="题目目标" value={goal} onChange={e => setGoal(e.target.value)}><option value="">全部目标</option><option value="mate">杀棋</option><option value="gain_material">得子</option><option value="draw">求和</option><option value="endgame_win">残局胜法</option></select></label>
          {!directMate&&<><label><span>杀法步数分组</span><select aria-label="杀法步数分组" value={mateGroup} onChange={e => setMateGroup(e.target.value)}><option value="">全部步数</option>{[["one","一步杀"],["two","两步杀"],["three","三步杀"],["long","四步及以上"],["unknown","步数未验证"]].map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
          <label><span>精确杀法步数</span><input aria-label="精确杀法步数" type="number" min="1" max="255" placeholder="精确步数" value={mateMoves} onChange={e => setMateMoves(e.target.value)}/></label></>}<details className="catalog-extra-filters" open={compact || undefined}><summary>更多筛选</summary><label><span>局面子力</span><select aria-label="局面子力" value={material} onChange={e=>setMaterial(e.target.value)}><option value="">全部子力</option>{[["r","含车"],["n","含马"],["c","含炮"],["p","含兵卒"]].map(([v,l])=><option key={v} value={v}>{l}（任一方）</option>)}</select></label>
          <label><span>杀法名称</span><input aria-label="杀法名称" placeholder="杀法名称（题名/原分类）" value={motif} onChange={e=>setMotif(e.target.value)}/></label>
          <label><span>题目难度</span><select aria-label="题目难度" value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="">全部难度</option>{[1,2,3,4,5].map(n => <option key={n} value={n}>难度 {n}</option>)}</select></label>
          </details></fieldset>}
        {selection && <div className="catalog-selection-toolbar"><button type="button" className="catalog-action" disabled={busy || loading || !!error} onClick={() => void selectChapter()}>选择当前章节/筛选的全部题目</button><small>已选题保留原顺序，跨章节自动去重</small></div>}
        <div className="catalog-problems">{shownItems.map(p => <article className="catalog-problem-card" key={p.id}><button type="button" disabled={busy} aria-pressed={selection ? selectedIds.includes(p.id) : undefined} onClick={() => selection ? selectedIds.includes(p.id) ? onRemove?.(p.id) : onAdd?.([{ ...p, teachingChapter: current?.name }]) : (()=>{saveNavigation();const ids=mobileBrowse?practiceGroupIds(shownItems,p.id):[p.id];if(ids.length>1)onPractice?.(ids,p.title,p.id);else onPractice?.(ids,p.title);})()}><FenThumbnail fen={p.startingFen}/><span className="catalog-problem-copy"><strong>第 {p.sourceIndex + 1} 题 · {p.title}</strong><small>{p.sideToMove==="black"||p.sideToMove==="b"?"黑方先走":"红方先走"}{!mobileBrowse && ` · ${current?.name}`}</small><span className="catalog-problem-tags">{(p.trainingGoal||answersAllowed)&&<span className="catalog-badge catalog-badge-goal">{goalLabel(p.trainingGoal)}</span>}{selection&&<span className={`catalog-badge ${selectedIds.includes(p.id)?"catalog-badge-ready":""}`}>{selectedIds.includes(p.id)?"✓ 已选":"点击选择"}</span>}</span><small>{p.verifiedMateMoves != null ? `已验证${p.verifiedMateMoves}步杀` : directMate ? "步数待确认" : !mobileBrowse ? `题解 ${p.solutionLength} 半回合` : ""}{!mobileBrowse && p.verifiedMateMoves != null && ` · 题解 ${p.solutionLength} 半回合`}</small>{!mobileBrowse && p.trainingGoal?.reviewMethod === "reviewed_solution" && <small>按审核题解</small>}</span></button>{!selection && answersAllowed && <button type="button" className="catalog-read-solution" onClick={() => {saveNavigation();if(answersAllowed)onReadSolution?.([p.id]);}}><BookOpen/>看题解</button>}</article>)}</div>
        {cursor && <button type="button" className="catalog-more" disabled={busy} onClick={() => void more()}>加载更多题目</button>}
        {!teacher && shownItems.length > 0 && <button type="button" className="catalog-action" disabled={busy || loading || !!error} onClick={() => {saveNavigation();onPractice?.(shownItems.slice(0, 20).map(p => p.id));}}>练习当前列表前 {Math.min(20, shownItems.length)} 题</button>}</>:null}</>}
    <div className="catalog-load-status" role="status" aria-live="polite">{busy?"正在核对题目…":loading?(children.length||shownItems.length||materials.length?"正在更新内容…":"正在读取教学题库…"):browse.page.statisticsReady===false?"题数后台更新中，可继续浏览":""}</div>
    {browse.error&&<CatalogState error>目录读取失败：{browse.error}<button onClick={browse.retry}>重试目录</button></CatalogState>}
    {browse.countError&&<CatalogState error>题数统计失败：{browse.countError}<button onClick={browse.retryCounts}>重试统计</button></CatalogState>}
    {mode==="reading"&&browse.materialBusy&&<CatalogState loading>正在读取教材…</CatalogState>}
    {mode==="reading"&&browse.materialError&&<CatalogState error>教材读取失败：{browse.materialError}<button onClick={browse.retryMaterials}>重试教材</button></CatalogState>}
    {error && <CatalogState error><strong>读取失败</strong><p>{error}</p><button type="button" onClick={() => setRetry(n => n + 1)}>重新读取目录</button></CatalogState>}
    {!loading&&!busy&&!error&&!browse.error&&!browse.materialBusy&&!browse.materialError&&(!children.length||directMate)&&!shownItems.length&&(mode!=="reading"||!materials.length)&&<CatalogState><strong>{mode==="reading"?"暂无已审核教材":directoryQuery||query||goal||difficulty||material||motif||mateMoves||mateGroup?"暂无匹配题目":"此目录暂无可用题目"}</strong><p>{mode==="reading"?"已审核教材将在这里显示。":"可以调整筛选条件，或返回上级目录继续浏览。"}</p></CatalogState>}
  </section>;
}
