import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { boardAt } from "./wasm";
import type { BoardState, LocalManualGame } from "./types";
type Square={row:number;col:number};
export function rehearsalChoices(game:LocalManualGame,path:string[]){
 const choices=new Set<string>();
 for(const line of [game.moves,...game.branches.map(branch=>[...branch.parentPath,...branch.moves])]){
  if(path.length<line.length&&path.every((move,index)=>line[index]===move))choices.add(line[path.length]);
 }
 return [...choices];
}
const key=(game:LocalManualGame)=>`qixi-local-rehearsal:${game.id}`;
export function LocalManualRehearsal({game,onClose,renderBoard}:{game:LocalManualGame;onClose():void;renderBoard(state:BoardState,selected:Square|undefined,hint:string|undefined,onSquare:(square:Square)=>void):ReactNode}){
 const content=useMemo(()=>JSON.stringify([game.startingFen,game.moves,game.branches.map(branch=>[branch.parentPath,branch.moves])]),[game]);
 const [path,setPath]=useState<string[]>([]),[board,setBoard]=useState<BoardState>(),[selected,setSelected]=useState<Square>(),[hints,setHints]=useState(0),[mistakes,setMistakes]=useState(0),[hint,setHint]=useState<string>(),[notice,setNotice]=useState("请按原谱落子。"),[error,setError]=useState(""),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
 const lock=useRef(false),generation=useRef(0);
 useEffect(()=>{const version=++generation.current;let saved:{content?:string;path?:string[];hints?:number;mistakes?:number}={};try{saved=JSON.parse(localStorage.getItem(key(game))||"{}");}catch{/* Start from the beginning when an optional cache is damaged. */}
  const candidate=saved.content===content&&Array.isArray(saved.path)?saved.path:[];const restored:string[]=[];for(const move of candidate){if(!rehearsalChoices(game,restored).includes(move))break;restored.push(move);}
  setReady(false);void boardAt(game.startingFen,restored).then(state=>{if(version!==generation.current)return;setPath(restored);setBoard(state);setHints(saved.content===content?Math.max(0,saved.hints||0):0);setMistakes(saved.content===content?Math.max(0,saved.mistakes||0):0);setReady(true);}).catch(e=>{if(version===generation.current)setError(`无法恢复背谱局面：${String(e)}`);});return()=>{generation.current++;};
 },[game,content]);
 useEffect(()=>{if(!ready)return;try{localStorage.setItem(key(game),JSON.stringify({content,path,hints,mistakes}));}catch{setNotice("本次进度暂未保存，仍可继续背谱。");}},[ready,content,game,path,hints,mistakes]);
 const choices=rehearsalChoices(game,path),completed=ready&&path.length>0&&!choices.length;
 async function jump(next:string[]){if(lock.current)return;lock.current=true;setBusy(true);setError("");const version=generation.current;try{const state=await boardAt(game.startingFen,next);if(version!==generation.current)return;setPath(next);setBoard(state);setReady(true);setSelected(undefined);setHint(undefined);}catch(e){if(version===generation.current)setError(String(e));}finally{lock.current=false;setBusy(false);}}
 function square(to:Square){if(!board||!ready||busy||completed)return;const piece=board.pieces.find(p=>p.row===to.row&&p.col===to.col);if(piece?.color===(board.fen.split(/\s+/)[1]==="b"?"black":"red")){setSelected(to);return;}if(!selected)return;const encode=(s:Square)=>`${String.fromCharCode(97+s.col)}${9-s.row}`;const move=encode(selected)+encode(to);if(!choices.includes(move)){setMistakes(old=>old+1);setNotice("与原谱不符，局面已保留，请再想一想。");setSelected(undefined);return;}setNotice("正确，继续按原谱落子。");void jump([...path,move]);}
 return <section className="local-manual-rehearsal" role="dialog" aria-modal="true" aria-label="背谱练习"><header><button type="button" onClick={onClose}>返回录谱</button><div><strong>{game.title}</strong><small>背谱练习 · 已走 {path.length} 手</small></div><button type="button" disabled={busy} onClick={()=>{setHints(0);setMistakes(0);setNotice("重新开始背谱。");void jump([]);}}>重新开始</button></header><p className="rehearsal-progress">提示 {hints} 次 · 偏差 {mistakes} 次{choices.length>1?` · 此处有 ${choices.length} 种原谱走法`:""}</p>{error&&<p role="alert" className="manual-feature-error">{error}</p>}{board?renderBoard(board,selected,hint,square):<p role="status">正在载入背谱棋盘…</p>}<footer><p role="status">{completed?"背谱完成！已复现这条完整线路。":notice}</p><div><button type="button" disabled={!path.length||busy} onClick={()=>void jump(path.slice(0,-1))}>退回一步</button><button type="button" disabled={!choices.length||busy} onClick={()=>{setHints(old=>old+1);setHint(choices[0]);setNotice(`提示走法：${choices[0]}。`);}}>提示下一着</button></div></footer></section>;
}
