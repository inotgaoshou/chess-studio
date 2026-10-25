import type {LocalManualGame,LocalManualMoveBranch} from "./types";
const samePath=(a:string[],b:string[])=>a.length===b.length&&a.every((move,index)=>move===b[index]);
export function removeManualBranch(game:Pick<LocalManualGame,"moves"|"branches"|"comments">,id:string){
 const target=game.branches.find(branch=>branch.id===id);if(!target)return {branches:game.branches,comments:game.comments};
 const reachable=new Set([""]);
 const addLine=(line:string[])=>{for(let length=1;length<=line.length;length++)reachable.add(line.slice(0,length).join(","));};
 addLine(game.moves);
 const retained=new Set<string>();
 // A nested variation is removed only when its parent position has actually
 // disappeared. An adopted branch may still be the active mainline.
 for(const branch of game.branches.filter(item=>item.id!==id).sort((a,b)=>a.parentPath.length-b.parentPath.length)){
  if(!reachable.has(branch.parentPath.join(",")))continue;
  retained.add(branch.id);addLine([...branch.parentPath,...branch.moves]);
 }
 const branches=game.branches.filter(branch=>retained.has(branch.id));
 return {branches,comments:Object.fromEntries(Object.entries(game.comments).filter(([path])=>reachable.has(path)))};
}
export function reorderManualBranch(branches:LocalManualMoveBranch[],id:string,direction:-1|1){
 const branch=branches.find(item=>item.id===id);if(!branch)return branches;
 const siblings=branches.filter(item=>samePath(item.parentPath,branch.parentPath)).sort((a,b)=>(a.branchOrder??0)-(b.branchOrder??0));
 const index=siblings.findIndex(item=>item.id===id),target=index+direction;if(index<0||target<0||target>=siblings.length)return branches;
 [siblings[index],siblings[target]]=[siblings[target],siblings[index]];
 const order=new Map(siblings.map((item,index)=>[item.id,index]));
 return branches.map(item=>order.has(item.id)?{...item,branchOrder:order.get(item.id)}:item);
}
