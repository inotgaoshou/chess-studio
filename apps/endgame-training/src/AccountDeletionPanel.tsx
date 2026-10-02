import { useEffect, useState } from "react";
import { teachingClient } from "./teaching";
import { Trash2, X } from "lucide-react";

export function AccountDeletionPanel() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { let active = true; teachingClient.accountDeletionStatus().then((status) => { if (active && status?.status === "pending") { setPending(true); setMessage(`删除申请已收到，预计 ${new Date(status.expectedBy).toLocaleDateString("zh-CN")} 前处理。`); } }).catch(() => {}); return () => { active = false; }; }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setMessage("");
    try {
      const status = await teachingClient.requestAccountDeletion(password, pending);
      setPending(status.status === "pending"); setPassword(""); setOpen(false);
      setMessage(status.status === "pending" ? `删除申请已收到，预计 ${new Date(status.expectedBy).toLocaleDateString("zh-CN")} 前处理。` : "已取消删除申请。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "申请失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="account-deletion-panel">
    <button type="button" className="danger" disabled={busy} onClick={() => { setOpen(!open); setPassword(""); }}><Trash2/>{pending ? "取消账号删除申请" : "申请删除账号"}</button>
    {open && <form onSubmit={submit}>
      <strong>{pending ? "取消删除申请" : "删除账号及关联个人数据"}</strong>
      {!pending && <p>申请由平台管理员在 7 日内处理。删除后账号、学习记录及云端个人棋谱无法恢复，所有机构中的账号关系也会移除。本机文件和系统备份需单独管理。</p>}
      <label><span>当前密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label>
      <div><button type="button" disabled={busy} onClick={() => { setOpen(false); setPassword(""); }}><X/>返回</button><button type="submit" className="danger" disabled={busy || !password}>{busy ? "正在处理…" : pending ? "确认取消申请" : "确认申请删除"}</button></div>
    </form>}
    {message && <p role="status">{message}</p>}
  </section>;
}
