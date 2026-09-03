import { useEffect, useState } from "react";
import { ChevronDown, Edit3, MessageSquareText, Save, X } from "lucide-react";
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
  const [collapsed, setCollapsed] = useState(false);
  const displayLocalText = localText;
  useEffect(() => {
    setDraft(localText);
    setEditing(false);
    setCollapsed(false);
  }, [value, localText]);
  if (!sourceText && !displayLocalText) return null;
  const lines = sourceText.split("\n").map((line) => line.trim()).filter(Boolean);
  const isByline = (line: string) => /\s·\s(?:\d{1,4}[-\/]\d{1,2}(?:[-\/]\d{1,2})?(?:\s+\d{1,2}:\d{2})?|\d{1,2}:\d{2})$/.test(line);
  const itemBegin = "【天天象棋注解条目】";
  const itemEnd = "【天天象棋注解条目结束】";
  const parseLegacyEntries = (items: string[]) => {
    const entries: Array<{ heading: string; body: string }> = [];
    let heading = "当前局面原文";
    let body: string[] = [];
    for (const line of items) {
      if (isByline(line) && body.length > 0) {
        entries.push({ heading, body: body.join("\n") });
        heading = line;
        body = [];
      } else if (isByline(line) && body.length === 0) {
        heading = line;
      } else {
        body.push(line);
      }
    }
    if (body.length > 0) entries.push({ heading, body: body.join("\n") });
    return entries;
  };
  const entries: Array<{ heading: string; body: string }> = [];
  let item: string[] | null = null;
  for (const line of lines) {
    if (line === itemBegin) {
      item = [];
    } else if (line === itemEnd && item) {
      const heading = item[0] && isByline(item[0]) ? item[0] : "当前局面原文";
      const body = (item[0] && isByline(item[0]) ? item.slice(1) : item).join("\n");
      if (body) entries.push({ heading, body });
      item = null;
    } else if (item) {
      item.push(line);
    }
  }
  // Existing imports predate explicit item delimiters. Keep their display
  // compatible while using delimiters for new data so正文 never gets split
  // merely because it resembles an author/time byline.
  if (entries.length === 0) entries.push(...parseLegacyEntries(lines.filter((line) => line !== itemBegin && line !== itemEnd)));
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
  const label = sourceText ? "天天象棋注解" : "本地备注";
  return <section className={`ttxq-annotation-card ${compact ? "compact" : ""} ${collapsed ? "collapsed" : ""}`} aria-label={label}>
    <header><MessageSquareText size={14}/><div><strong>{label}</strong><small>{sourceText ? `${entries.length} 条` : "仅保存在本机"}</small></div><button type="button" className="ttxq-annotation-collapse" title={collapsed ? `展开${label}` : `收起${label}`} aria-label={collapsed ? `展开${label}` : `收起${label}`} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}><ChevronDown size={13}/></button>{editable && onSaveLocal && <button type="button" className="ttxq-annotation-edit" title={editing ? "取消编辑本地备注" : "编辑本地备注"} aria-label={editing ? "取消编辑本地备注" : "编辑本地备注"} onClick={() => editing ? cancel() : setEditing(true)}>{editing ? <X size={13}/> : <Edit3 size={13}/>}</button>}</header>
    {!collapsed && entries.length > 0 && <div className="ttxq-annotation-entries" title={sourceText}>{entries.map((entry, index) => <article className="ttxq-annotation-entry" key={`${entry.heading}-${index}`}><small>{entry.heading}</small><p className="ttxq-annotation-source">{entry.body}</p></article>)}</div>}
    {!collapsed && editable && onSaveLocal && (editing || displayLocalText) && <div className="ttxq-annotation-local">
      <label><span>本地备注</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="补充当前局面的本地备注" disabled={!editing || saving}/></label>
      {editing && <button type="button" onClick={() => void save()} disabled={saving}><Save size={13}/>{saving ? "保存中…" : "保存备注"}</button>}
    </div>}
  </section>;
}
