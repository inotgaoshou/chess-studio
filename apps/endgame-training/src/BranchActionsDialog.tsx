import { useRef, useState } from "react";
import type { ManualContinuation } from "./manualContinuation";
import { branchChoiceColor } from "./branchPresentation";

export function BranchActionsDialog({choices,readOnly,onClose,onEdit,onDelete}:{choices:ManualContinuation[];readOnly:boolean;onClose():void;onEdit(choice:ManualContinuation):Promise<void>;onDelete(choice:ManualContinuation):Promise<void>}) {
 const [pending,setPending]=useState<ManualContinuation>();
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const lock=useRef(false);
 async function run(action:()=>Promise<void>) {
  if(lock.current)return;lock.current=true;setBusy(true);setError("");
  try{await action();setPending(undefined);}catch(e){setError(e instanceof Error?e.message:"操作失败，请重试");}
  finally{lock.current=false;setBusy(false);}
 }
 const index=pending?choices.findIndex(choice=>choice.move===pending.move):-1;
 return <div className="confirm-backdrop branch-actions-backdrop"><section className="branch-actions-dialog" role="dialog" aria-modal="true" aria-label="管理当前分支">
  <header><h3>管理当前分支</h3><button type="button" disabled={busy} onClick={onClose}>关闭</button></header>
  <p>编辑进入所选线路，可继续走棋、改走或修改注释。</p>
  {readOnly&&<p>这是只读棋谱，请先复制到我的棋谱再编辑。</p>}
  {pending?<div role="alertdialog" aria-label="确认删除分支"><strong>删除分支 {index+1} · {pending.notation}？</strong><p>删除这一步及其后续变招，其他分支保留。{pending.isMainline?"这条走法属于主线，删除后主线将截止到当前局面。":""}</p><footer><button type="button" disabled={busy} onClick={()=>setPending(undefined)}>取消</button><button type="button" className="danger" disabled={busy} onClick={()=>void run(()=>onDelete(pending))}>{busy?"删除中…":"确认删除"}</button></footer></div>
   :<div className="branch-actions-list">{choices.map((choice,index)=><div key={choice.move}><span><b style={{background:branchChoiceColor(index)}}>{index+1}</b><strong>{choice.notation}</strong>{choice.isMainline&&<small>主线</small>}</span><button type="button" disabled={busy||readOnly} aria-label={`编辑分支 ${index+1}`} onClick={()=>void run(()=>onEdit(choice))}>编辑</button><button type="button" disabled={busy||readOnly} aria-label={`删除分支 ${index+1}`} onClick={()=>{setError("");setPending(choice);}}>删除</button></div>)}</div>}
  {error&&<p role="alert">{error}</p>}
 </section></div>;
}
