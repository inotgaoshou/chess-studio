import type { LocalManualGame } from "./types";
type Node={id:string;parent_id:string;mv:{from:{row:number;col:number};to:{row:number;col:number}};comment:string;is_mainline:boolean;deleted:boolean;order_key:number};
export type ImportedDocument={metadata:{title:string;event:string;site:string;date:string;red:string;black:string;result:string};startingFen:string;note:string;tree:{root_id:string;nodes:Record<string,Node>};warnings:string[]};
const move=(node:Node)=>[node.mv.from,node.mv.to].map(s=>`${String.fromCharCode(97+s.col)}${9-s.row}`).join("");
export function importedManual(doc:ImportedDocument,id:string,now:string,folderPath?:string):LocalManualGame {
 const children=new Map<string,Node[]>();const nodes=Object.values(doc.tree.nodes).filter(n=>!n.deleted);
 if(nodes.length>10000)throw new Error("棋谱超过 10000 手，请分成多个文件导入。");
 for(const node of nodes){const list=children.get(node.parent_id)??[];list.push(node);children.set(node.parent_id,list);}
 for(const list of children.values())list.sort((a,b)=>Number(b.is_mainline)-Number(a.is_mainline)||a.order_key-b.order_key);
 const chain=(first?:Node)=>{const moves:string[]=[];const seen=new Set<string>();for(let node=first;node;node=children.get(node.id)?.[0]){if(seen.has(node.id))throw new Error("棋谱分支存在循环。");seen.add(node.id);moves.push(move(node));}return moves;};
 const comments:Record<string,string>={},branches:LocalManualGame["branches"]=[];
 const stack:Array<{id:string;path:string[]}>= [{id:doc.tree.root_id,path:[]}];const visited=new Set<string>();
 while(stack.length){const parent=stack.pop()!;for(const [index,node] of (children.get(parent.id)??[]).entries()){
  if(visited.has(node.id))throw new Error("棋谱树包含重复节点。");visited.add(node.id);
  const path=[...parent.path,move(node)];if(node.comment)comments[path.join(",")]=node.comment;
  if(index>0)branches.push({id:node.id,parentCursor:parent.path.length,parentPath:[...parent.path],moves:chain(node),notation:[],createdAt:Date.parse(now),branchOrder:node.order_key});
  stack.push({id:node.id,path});
 }}
 if(visited.size!==nodes.length)throw new Error("棋谱存在无法连接的分支，未保存。");
 const firstRed=doc.startingFen.split(/\s+/)[1]!=="b",result=doc.metadata.result;
 const played=new Date(doc.metadata.date.replace(/\./g,"-"));
 return {id,title:doc.metadata.title||"导入棋谱",note:[doc.note,doc.metadata.site?`地点：${doc.metadata.site}`:""].filter(Boolean).join("\n"),folderPath,
 startingFen:doc.startingFen,currentFen:doc.startingFen,currentNodeId:"main:0",moves:chain(children.get(doc.tree.root_id)?.[0]),cursor:0,branches,comments,createdAt:now,updatedAt:now,
 metadata:{event:doc.metadata.event,redPlayer:doc.metadata.red,blackPlayer:doc.metadata.black,playedAt:Number.isNaN(played.getTime())?now:played.toISOString(),gameType:doc.startingFen.startsWith("rnbakabnr/")?"full":"middle",result:result==="1/2-1/2"?"draw":result==="1-0"?(firstRed?"first-win":"first-loss"):result==="0-1"?(firstRed?"first-loss":"first-win"):"unknown"}};
}
