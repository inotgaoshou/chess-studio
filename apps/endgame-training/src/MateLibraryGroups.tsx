import { useState } from "react";
import type { TrainingLibrary } from "./types";
import "./mateLibraries.css";
export function MateLibraryGroups({ libraries, onOpen }: { libraries: TrainingLibrary[]; onOpen(library: TrainingLibrary): void }) {
  const [exact, setExact] = useState<Record<string, string>>({});
  const groups = new Map<string, TrainingLibrary[]>();
  for (const library of libraries) if (library.mateCollection) { const rows=groups.get(library.mateCollection.assetId)??[];rows.push(library);groups.set(library.mateCollection.assetId,rows); }
  return <div className="student-mate-groups">{[...groups].map(([id, rows]) => <details key={id} open><summary><strong>{rows[0].mateCollection!.title}</strong><small>{rows.reduce((n,r)=>n+r.problemCount,0)} 道已发布题</small></summary>{rows.map(r=><div className="student-mate-category" key={r.id}><button onClick={()=>onOpen(r)}><strong>{r.title}</strong><small>{r.problemCount} 题</small></button>{r.mateCollection?.group==="long"&&<><select aria-label={`${r.mateCollection.title}具体步数`} value={exact[id]??""} onChange={e=>setExact(v=>({...v,[id]:e.target.value}))}><option value="">选择具体步数</option>{Object.entries(r.mateCollection.moveCounts??{}).map(([n,count])=><option key={n} value={n}>{n}步杀 · {count}题</option>)}</select><button disabled={!exact[id]} onClick={()=>{const n=Number(exact[id]);onOpen({...r,id:`${r.id}:${n}`,fingerprint:`${r.fingerprint}:${n}`,title:`${n}步杀`,problemCount:r.mateCollection!.moveCounts?.[String(n)]??0});}}>练习</button></>}</div>)}</details>)}</div>;
}
