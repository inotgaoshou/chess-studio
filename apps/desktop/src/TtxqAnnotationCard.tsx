import { useEffect, useState } from "react";
import { Edit3, MessageSquareText, Save, X } from "lucide-react";
import { splitTtxqComment } from "./ttxqAnnotations";

export function TtxqAnnotationCard({ value, compact = false, editable = false, onSaveLocal }: {
  value: string;
  compact?: boolean;
  editable?: boolean;
  onSaveLocal?(value: string): Promise<boolean> | boolean;
}) {
  const { sourceText, localText } = splitTtxqComment(value);
  const [draft, setDraft] = useState(localText);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(localText);
    setEditing(false);
  }, [value, localText]);
  if (!sourceText && !editable) return null;
  const lines = sourceText.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasByline = lines.length > 1 && (lines[0].includes(" · ") || /\d{2,4}[-\/]\d{1,2}[-\/]?\d{0,2}/.test(lines[0]));
  const heading = hasByline ? lines[0] : "当前局面原文";
  const body = hasByline ? lines.slice(1).join("\n") : lines.join("\n");
  const save = async () => {
    if (!onSaveLocal) return;
    setSaving(true);
    try {
      if (await onSaveLocal(draft)) setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    setDraft(localText);
    setEditing(false);
  };
  return <section className={`ttxq-annotation-card ${compact ? "compact" : ""}`} aria-label={sourceText ? "天天象棋注解" : "本地备注"}>
    <header><MessageSquareText size={14}/><div><strong>{sourceText ? "天天象棋注解" : "本地备注"}</strong><small>{sourceText ? heading : "仅保存在本机"}</small></div>{editable && onSaveLocal && <button type="button" className="ttxq-annotation-edit" title={editing ? "取消编辑本地备注" : "编辑本地备注"} aria-label={editing ? "取消编辑本地备注" : "编辑本地备注"} onClick={() => editing ? cancel() : setEditing(true)}>{editing ? <X size={13}/> : <Edit3 size={13}/>}</button>}</header>
    {body && <p className="ttxq-annotation-source" title={sourceText}>{body}</p>}
    {editable && onSaveLocal && (editing || localText) && <div className="ttxq-annotation-local">
      <label><span>本地备注</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="补充当前局面的本地备注" disabled={!editing || saving}/></label>
      {editing && <button type="button" onClick={() => void save()} disabled={saving}><Save size={13}/>{saving ? "保存中…" : "保存备注"}</button>}
    </div>}
  </section>;
}
