import { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import { AuthoringBoard } from "./AuthoringBoard";
import {
  AUTHORING_BASE as BASE,
  START_FEN,
  EMPTY_FEN,
  LABELS,
  fenCells,
  cellsFen,
  positionWarnings,
  choicesAt,
  addAnswer,
  removeAnswer,
  goalFor,
  assignable,
  itemRef,
  shiftQuestions,
  mergeSources,
  sourceIdentity,
  type AuthoringSource,
  type AuthoringSourcePage,
  toIccs,
  splitAssignments,
  type AuthoringApi,
  type AuthoringDirectory,
  type AuthoredQuestion,
  type QuestionBody,
  type AnswerNode,
  type AuthoringGoal,
} from "./authoringDomain";
import "./authoring.css";
const names = {
  draft: "待补答案",
  revising: "有待发布修订",
  published: "机构已发布",
  archived: "已下架",
  source: "已发布来源题",
};
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  body: JSON.stringify(body),
});
function newQuestion(): AuthoredQuestion {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    canEdit: true,
    archived: false,
    status: "draft",
    body: {
      title: "训练题",
      startingFen: START_FEN,
      note: "",
      solution: [],
      trainingGoal: null,
    },
  };
}
export function TeacherAuthoring({
  api,
  scopeKey,
  orgName,
  onBack,
  onAssigned,
  onAdvanced,
  personal = false,
  organizationApi,
}: {
  api: AuthoringApi;
  scopeKey: string;
  orgName: string;
  onBack(): void;
  onAssigned(id: string): void;
  onAdvanced?(): void;
  personal?: boolean;
  organizationApi?: AuthoringApi;
}) {
  const [tab,setTab]=useState<"published"|"platform"|"mine">("mine");
  const [publishedRows,setPublishedRows]=useState<Array<{id:string;title:string;status:string;itemCount:number;targetCount:number;completedCount:number}>>([]);
  const [publishedError,setPublishedError]=useState("");
  const [externalDirectory,setExternalDirectory]=useState<AuthoringDirectory>();
  const [copying,setCopying]=useState<AuthoredQuestion>();
  const [copyTargets,setCopyTargets]=useState<AuthoringDirectory[]>([]);
  const [copyTargetId,setCopyTargetId]=useState("");
  const [copyNotice,setCopyNotice]=useState("");
  const [dirs, setDirs] = useState<AuthoringDirectory[]>([]),
    [dir, setDir] = useState<AuthoringDirectory>(),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [question, setQuestion] = useState<AuthoredQuestion>(),
    [mode, setMode] = useState<"position" | "answer" | "preview">("position"),
    [adding, setAdding] = useState(false),
    [picker, setPicker] = useState<"problems" | "games">(),
    [publish, setPublish] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [directoryEditing, setDirectoryEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false), [refreshError,setRefreshError] = useState("");
  const [titleBusy,setTitleBusy] = useState(false), [openingQuestion,setOpeningQuestion] = useState<string>();
  const refreshRequest=useRef(0), navigationRequest=useRef(0), questionRequest=useRef(0), titleLock=useRef(false);
  const questionController=useRef<AbortController|undefined>(undefined);
  const [savedQuestion, setSavedQuestion] = useState<string>();
  const [titleDialog, setTitleDialog] = useState<
    { kind: "new"; title: string; id: string } |
    { kind: "directory"; title: string; directory: AuthoringDirectory } |
    { kind: "question"; title: string; question: AuthoredQuestion }
  >();
  const [recoveries, setRecoveries] = useState<
    { id: string; directoryId?: string; body: QuestionBody }[]
  >([]);
  function refreshRecoveries() {
    const prefix = `qixi.authoring:${scopeKey}:`;
    const result: typeof recoveries = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const cached = JSON.parse(localStorage.getItem(key) || "null");
        if (cached?.revision === 0 && cached.body)
          result.push({
            id: key.slice(prefix.length),
            directoryId: cached.directoryId,
            body: cached.body,
          });
      }
    } catch {}
    setRecoveries(result);
  }
  async function writableDirectory() {
    const existing = dirs.find((d) => d.canEdit);
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    await api.request(BASE + "/directories", json({ id, title: "我的出题" }));
    return id;
  }
  const generation = useRef(0),
    lock = useRef(false);
  async function run(task: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const epoch = generation.current;
    try {
      await task();
    } catch (e) {
      if (epoch === generation.current) setError(message(e));
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  async function refreshDirectories(saved: boolean | "deleted" = false) {
    const epoch=generation.current, request=++refreshRequest.current;
    setRefreshing(true);setRefreshError("");
    try {
      const value=await api.request<{items:AuthoringDirectory[]}>(BASE+"/directories");
      if(epoch!==generation.current || request!==refreshRequest.current)return;
      setDirs(value.items);refreshRecoveries();
    } catch(reason) {
      if(epoch===generation.current && request===refreshRequest.current)
        setRefreshError(`${saved === "deleted" ? "已删除，刷新失败" : saved ? "已保存，刷新失败" : "目录刷新失败"}：${message(reason)}`);
    } finally {
      if(epoch===generation.current && request===refreshRequest.current)setRefreshing(false);
    }
  }
  async function load(id?: string) {
    const epoch = generation.current, request=++navigationRequest.current;
    questionRequest.current++;questionController.current?.abort();setOpeningQuestion(undefined);
    // Opening one directory must not wait for an unrelated list refresh.
    if(id) {
      const detail=await api.request<AuthoringDirectory>(BASE+"/directories/"+id);
      if(epoch!==generation.current || request!==navigationRequest.current)return;
      setDir(detail);
      if(id!==dir?.id)setSavedQuestion(undefined);
      setSelected([]);refreshRecoveries();
      return detail;
    }
    const value=await api.request<{items:AuthoringDirectory[]}>(BASE+"/directories");
    if(epoch!==generation.current || request!==navigationRequest.current)return;
    setDirs(value.items);setDir(undefined);setSelected([]);setSavedQuestion(undefined);refreshRecoveries();
  }
  useEffect(() => {
    const epoch = generation.current;
    setBusy(true);
    void load()
      .catch((e) => {
        if (epoch === generation.current) setError(message(e));
      })
      .finally(() => {
        if (epoch === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;questionController.current?.abort();
    };
  }, [scopeKey]);
  useEffect(()=>{
    if(tab!=="published")return;
    let active=true;
    setPublishedError("");
    void api.request<typeof publishedRows>("/api/v1/admin/assignments")
      .then(rows=>{if(active)setPublishedRows(rows.filter(row=>row.status==="published"||row.status==="closed"));})
      .catch(reason=>{if(active)setPublishedError(message(reason));});
    return ()=>{active=false;};
  },[api,scopeKey,tab]);
  async function changeDir(items: AuthoredQuestion[], target = dir) {
    if (!target) return;
    await api.request(
      BASE + "/directories/" + target.id,
      json(
        {
          title: target.title,
          expectedRevision: target.revision,
          items: items.map(itemRef),
        },
        "PATCH",
      ),
    );
    await load(dir?.id);
    setSelected(selected.filter(id => items.some(q => q.id === id)));
  }
  function select(q: AuthoredQuestion) {
    setSelected((old) =>
      old.includes(q.id) ? old.filter((id) => id !== q.id) : [...old, q.id],
    );
  }
  async function open(q: AuthoredQuestion, nextMode: typeof mode) {
    const epoch=generation.current, request=++questionRequest.current;
    questionController.current?.abort();
    const controller=new AbortController();questionController.current=controller;
    setOpeningQuestion(q.id);setError("");
    try {
      const value=q.kind === "source"
        ? {...q,body:await api.request<QuestionBody>(BASE+"/import",{...json({problemId:q.id}),signal:controller.signal})}
        : await api.request<AuthoredQuestion>(BASE+"/questions/"+q.id,{signal:controller.signal});
      if(epoch!==generation.current || request!==questionRequest.current || controller.signal.aborted)return;
      setMode(nextMode);setQuestion(value);
    } catch(reason) {
      if(epoch===generation.current && request===questionRequest.current && !controller.signal.aborted)setError(message(reason));
    } finally {
      if(epoch===generation.current && request===questionRequest.current)setOpeningQuestion(undefined);
    }
  }
  useEffect(()=>{
    questionRequest.current++;questionController.current?.abort();setOpeningQuestion(undefined);
  },[adding,picker,publish,tab]);
  const selectedItems = dir?.items.filter((q) => selected.includes(q.id)) ?? [];
  const shifted = (direction: -1 | 1) => shiftQuestions(dir?.items ?? [], selected, direction);
  const canShift = (direction: -1 | 1) => shifted(direction).some((q, index) => q.id !== dir?.items[index].id);
  async function moveDirectory(target: AuthoringDirectory, direction: -1 | 1) {
    const orders = dirs.map(d => d.sortOrder);
    const sortOrder = direction === -1 ? Math.min(...orders) - 1 : Math.max(...orders) + 1;
    await api.request(BASE + "/directories/" + target.id, json({title:target.title,expectedRevision:target.revision,sortOrder}, "PATCH"));
    await load();
  }
  async function deleteDirectory(target: AuthoringDirectory) {
    const epoch=generation.current;
    refreshRequest.current++;
    await api.request(BASE+"/directories/"+target.id,json({expectedRevision:target.revision},"DELETE"));
    if(epoch!==generation.current)return;
    setDirs(old=>old.filter(item=>item.id!==target.id));
    void refreshDirectories("deleted");
  }
  async function saveTitle(title: string) {
    if (!titleDialog || titleLock.current) return;
    const dialog=titleDialog, epoch=generation.current;
    titleLock.current=true;setTitleBusy(true);setError("");
    // A refresh started before this write may not replace its committed result.
    refreshRequest.current++;
    try {
      let summary:AuthoringDirectory|undefined;
      if(dialog.kind === "new") {
        const result=await api.request<{id:string;directory?:AuthoringDirectory}>(BASE+"/directories",json({id:dialog.id,title,sortOrder:Math.max(-1,...dirs.map(d=>d.sortOrder))+1}));
        summary=result.directory;
        // Older servers acknowledge only id. Show that committed empty directory
        // immediately; the independent refresh reconciles its canonical revision.
        if(!summary)summary={id:result.id,title,revision:1,sortOrder:Math.max(-1,...dirs.map(d=>d.sortOrder))+1,canEdit:true,publishedCount:0,draftCount:0,items:[]};
      } else if(dialog.kind === "directory") {
        const target=dialog.directory;
        const result=await api.request<{directory?:AuthoringDirectory}>(BASE+"/directories/"+target.id,json({title,expectedRevision:target.revision},"PATCH"));
        summary=result.directory??{...target,title,revision:target.revision+1};
      } else {
        const target=dialog.question;
        const updated=await api.request<AuthoredQuestion>(BASE+"/questions/"+target.id,json({expectedRevision:target.revision,body:{...target.body,title}},"PUT"));
        if(epoch!==generation.current)return;
        setDir(old=>old?{...old,items:old.items.map(item=>item.id===target.id?updated:item)}:old);
      }
      if(epoch!==generation.current)return;
      if(summary) {
        const updated=summary;
        setDirs(old=>[...old.filter(item=>item.id!==updated.id),updated].sort((a,b)=>a.sortOrder-b.sortOrder));
        setDir(old=>old?.id===updated.id?{...old,...updated,items:old.items}:old);
      }
      setTitleDialog(undefined);
      void refreshDirectories(true);
    } catch(reason) {
      if(epoch===generation.current)setError(message(reason));
    } finally {
      if(epoch===generation.current){titleLock.current=false;setTitleBusy(false);}
    }
  }
  async function openCopy(q: AuthoredQuestion) {
    if (!organizationApi) return;
    const result = await organizationApi.request<{items:AuthoringDirectory[]}>(BASE + "/directories");
    const targets = result.items.filter(item => item.canEdit);
    if (!targets.length) throw new Error("机构作业库暂无可编辑目录，请先在机构题库新增目录");
    setCopyTargets(targets);
    setCopyTargetId(targets[0].id);
    setCopying(q);
  }
  async function copyToOrganization() {
    if (!copying || !organizationApi || !copyTargetId) return;
    const target = await organizationApi.request<AuthoringDirectory>(BASE + "/directories/" + copyTargetId);
    const result = await organizationApi.request<{alreadyAdded?:boolean}>(BASE + "/personal/copy", json({
      sourceId: copying.id,
      kind: copying.kind === "source" ? "source" : "authored",
      targetId: target.id,
      expectedRevision: target.revision,
    }));
    setCopyNotice(result.alreadyAdded ? "这道题已在机构目录中" : "已复制到机构作业库，机构草稿需补答案并发布后才能布置");
    setCopying(undefined);
  }
  useEffect(() => {
    if (!savedQuestion || question || !dir) return;
    const frame = requestAnimationFrame(() => document.getElementById(`authoring-item-${savedQuestion}`)?.scrollIntoView?.({block:"nearest"}));
    return () => cancelAnimationFrame(frame);
  }, [savedQuestion, question, dir]);
  if (question)
    return (
      <QuestionEditor
        key={question.id}
        question={question}
        mode={mode}
        api={api}
        scopeKey={scopeKey}
        directoryId={dir?.id}
        onClose={() => {
          setQuestion(undefined);
          void run(() => load(dir?.id));
        }}
        onCopy={(body) =>
          void run(async () => {
            const target = await writableDirectory();
            await load(target);
            setMode("answer");
            setQuestion({ ...newQuestion(), body });
          })
        }
        personal={personal}
        onSave={async (q) => {
          await load(dir?.id);
          setSavedQuestion(q.id);
          setQuestion(undefined);
        }}
      />
    );
  return (
    <main className="teacher-authoring" aria-busy={busy}>
      <header className="authoring-header">
        <button
          onClick={() =>
            dir
              ? void run(() => {
                  setEditing(false);
                  return load();
                })
              : onBack()
          }
        >
          ‹ 返回
        </button>
        <div>
          <h2>{dir?.title || (personal ? "我的题库" : tab==="published" ? "已发布作业" : tab==="platform" ? "平台作业库" : "我的作业库")}</h2>
          <small>{personal ? "仅自己可见" : `${orgName} · 发布后仅本机构老师可用`}</small>
        </div>
      </header>
      {error && (personal || tab === "mine" || dir) && (
        <p role="alert" className="authoring-error">
          {error}
          <button onClick={() => void run(() => load(dir?.id))}>刷新</button>
        </p>
      )}
      {refreshError && <p role="alert" className="authoring-error">{refreshError}<button disabled={refreshing} onClick={()=>void refreshDirectories()}>重试刷新</button></p>}
      {openingQuestion && <p role="status" className="authoring-saved">正在打开题目…</p>}
      {copyNotice && <p role="status" className="authoring-saved">{copyNotice}</p>}
      {recoveries.length > 0 && (
        <section className="authoring-recovery">
          <strong>本机待保存草稿</strong>
          {recoveries.map((c) => (
            <div key={c.id}>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const target = c.directoryId || (await writableDirectory());
                    await load(target);
                    setMode("position");
                    setQuestion({ ...newQuestion(), id: c.id, body: c.body });
                  })
                }
              >
                继续编辑：{c.body.title}
              </button>
              <button
                onClick={() => {
                  if (confirm(`删除这份尚未保存到${personal ? "个人" : "机构"}题库的本机草稿？`)) {
                    localStorage.removeItem(
                      `qixi.authoring:${scopeKey}:${c.id}`,
                    );
                    refreshRecoveries();
                  }
                }}
              >
                删除本机草稿
              </button>
            </div>
          ))}
        </section>
      )}
      {!dir ? (
        <>
          {!personal && <nav className="authoring-home-tabs" aria-label="布置作业分类">
            <button type="button" aria-current={tab==="published"?"page":undefined} onClick={()=>setTab("published")}>已发布作业</button>
            <button type="button" aria-current={tab==="platform"?"page":undefined} onClick={()=>setTab("platform")}>平台作业库</button>
            <button type="button" aria-current={tab==="mine"?"page":undefined} onClick={()=>setTab("mine")}>我的作业库</button>
          </nav>}
          {!personal && tab==="published" && <div className="authoring-published-list">
            {publishedError && <p role="alert" className="authoring-error">{publishedError}</p>}
            {publishedRows.map(row=><button type="button" key={row.id} onClick={()=>onAssigned(row.id)}><strong>{row.title}</strong><small>{row.itemCount} 题 · {row.completedCount}/{row.targetCount} 人完成</small></button>)}
            {!publishedRows.length && !publishedError && <p>暂无已发布作业</p>}
          </div>}
          {!personal && tab==="platform" && <PlatformAssignmentCatalog api={api} onAssign={(title,nodeId,items)=>{
            setExternalDirectory({id:nodeId,title,revision:0,sortOrder:0,canEdit:false,items});
            setPublish(true);
          }}/>}
          {(personal || tab==="mine") && <>
          <div className="authoring-actions">
            <button
              disabled={busy}
              onClick={() => setTitleDialog({kind:"new",title:"",id:crypto.randomUUID()})}
            >
              ＋ 新增目录
            </button>
            <button disabled={busy} aria-pressed={directoryEditing} onClick={() => setDirectoryEditing(!directoryEditing)}>{directoryEditing ? "完成调整" : "调整目录"}</button>
          </div>
          <div className="authoring-directories">
            {dirs.map((d, i) => (
              <article key={d.id} className={directoryEditing ? "editing" : undefined}>
                <button
                  className="directory-title"
                  onClick={() => void run(() => load(d.id))}
                >
                  <strong>{d.title}</strong>
                  <small>
                    {personal ? `${d.draftCount ?? 0} 道个人题目` : `${d.publishedCount ?? 0} 道已发布${d.draftCount ? ` · ${d.draftCount} 道待完善` : ""}`}
                  </small>
                </button>
                {!personal && !directoryEditing && d.itemCount!==0 && <button disabled={busy} aria-label={`布置${d.title}`} onClick={() => void run(async () => {const detail = await load(d.id);if (!detail?.items.length) throw new Error("目录里还没有题目，请先添加题目");setPublish(true);})}>布置作业</button>}
                {directoryEditing && d.canEdit && (
                  <>
                    <button aria-label={`${d.title}置顶`} disabled={busy || i === 0} onClick={() => void run(() => moveDirectory(d, -1))}>置顶</button>
                    <button aria-label={`${d.title}置底`} disabled={busy || i === dirs.length - 1} onClick={() => void run(() => moveDirectory(d, 1))}>置底</button>
                    <button
                      disabled={busy}
                      onClick={() => setTitleDialog({kind:"directory",title:d.title,directory:d})}
                    >
                      改名
                    </button>
                  </>
                )}
                {d.canEdit && d.itemCount===0 && <button type="button" className="authoring-directory-delete" disabled={busy} aria-label={`删除空目录${d.title}`} onClick={()=>{
                  if(confirm(`删除空目录“${d.title}”？`))void run(()=>deleteDirectory(d));
                }}>删除</button>}
              </article>
            ))}
          </div>
          {!busy && !error && !dirs.length && <p>还没有题目目录，先新建一个。</p>}
          {!personal && onAdvanced && <button type="button" onClick={onAdvanced}>自由组合布置</button>}
          </>}
        </>
      ) : (
        <>
          <div className="authoring-actions sticky">
            {!personal && <button
              className="primary"
              disabled={busy || !dir.items.length}
              onClick={() => setPublish(true)}
            >
              布置作业{selected.length ? `（${selected.length}题）` : ""}
            </button>}
            <button
              onClick={() => {
                setEditing(!editing);
                setSelected([]);
              }}
            >
              {editing ? "完成编辑" : "选择／编辑"}
            </button>
            <small>{dir.items.length} 题{editing ? ` · 已选 ${selected.length} 题` : " · 按目录题序布置"}</small>
          </div>
          {savedQuestion && !editing && <section className="authoring-saved" role="status"><span>已保存到当前目录。</span><button disabled={busy || !dir.canEdit} onClick={() => {setSavedQuestion(undefined);setAdding(true);}}>继续录题</button></section>}
          <div className="authoring-grid">
            {dir.canEdit && (
              <button className="authoring-add" onClick={() => setAdding(true)}>
                <span>＋</span>添加题目
              </button>
            )}
            {dir.items.map((q, i) => (
              <article
                key={q.id}
                id={`authoring-item-${q.id}`}
                className={selected.includes(q.id) ? "selected" : ""}
              >
                <button
                  className="authoring-card"
                  onClick={() =>
                    editing ? select(q) : void open(q, "preview")
                  }
                >
                  <AuthoringBoard
                    fen={q.body.startingFen}
                    label={q.body.title}
                  />
                  <strong>
                    {i + 1}. {q.body.title}
                  </strong>
                  <small>{names[q.status]}</small>
                </button>
                {editing ? (
                  <div className="card-controls">
                    <input
                      type="checkbox"
                      aria-label={`选择${q.body.title}`}
                      checked={selected.includes(q.id)}
                      onChange={() => select(q)}
                    />
                    {dir.canEdit && (
                      <>
                        <button
                          aria-label={`第${i + 1}题前移`}
                          disabled={busy || !i}
                          onClick={() =>
                            void run(() => {
                              const items = [...dir.items];
                              [items[i - 1], items[i]] = [
                                items[i],
                                items[i - 1],
                              ];
                              return changeDir(items);
                            })
                          }
                        >
                          ←
                        </button>
                        <button
                          aria-label={`第${i + 1}题后移`}
                          disabled={busy || i === dir.items.length - 1}
                          onClick={() =>
                            void run(() => {
                              const items = [...dir.items];
                              [items[i + 1], items[i]] = [
                                items[i],
                                items[i + 1],
                              ];
                              return changeDir(items);
                            })
                          }
                        >
                          →
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  q.canEdit && (
                    <button
                      className="authoring-complete"
                      onClick={() => void open(q, "answer")}
                    >
                      {q.status === "draft" ? "补答案" : "编辑题目"}
                    </button>
                  )
                )}
                {personal && organizationApi && !editing && <button className="authoring-complete" disabled={busy} onClick={() => void run(() => openCopy(q))}>复制到机构作业库</button>}
              </article>
            ))}
          </div>
          {editing && (
            <div className="authoring-actions sticky bottom">
              <button
                onClick={() =>
                  setSelected(
                    selected.length === dir.items.length
                      ? []
                      : dir.items.map((q) => q.id),
                  )
                }
              >
                全选
              </button>
              <span>已选 {selected.length} 题</span>
              {dir.canEdit && (
                <>
                  <button disabled={busy || selectedItems.length !== 1 || !selectedItems[0]?.canEdit} onClick={() => setTitleDialog({kind:"question",title:selectedItems[0].body.title,question:selectedItems[0]})}>改名</button>
                  <button disabled={busy || !canShift(-1)} onClick={() => void run(() => changeDir(shifted(-1)))}>前移</button>
                  <button disabled={busy || !canShift(1)} onClick={() => void run(() => changeDir(shifted(1)))}>后移</button>
                  <button
                    disabled={busy || !selected.length}
                    onClick={() => {
                      if (
                        confirm(
                          "从此目录移出所选题目？原题及已布置作业会保留。",
                        )
                      )
                        void run(() =>
                          changeDir(
                            dir.items.filter((q) => !selected.includes(q.id)),
                          ),
                        );
                    }}
                  >
                    移出目录
                  </button>
                  <select
                    aria-label="移动到目录"
                    value=""
                    disabled={busy || !selected.length}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id)
                        void run(async () => {
                          const target = await api.request<AuthoringDirectory>(
                            BASE + "/directories/" + id,
                          );
                          await api.request(
                            BASE + "/directories/" + dir.id + "/transfer",
                            json({
                              targetId: id,
                              expectedRevision: dir.revision,
                              targetRevision: target.revision,
                              items: selectedItems.map(itemRef),
                            }),
                          );
                          await load(dir.id);
                        });
                    }}
                  >
                    <option value="">移动目录…</option>
                    {dirs
                      .filter((d) => d.id !== dir.id && d.canEdit)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title}
                        </option>
                      ))}
                  </select>
                </>
              )}
            </div>
          )}
        </>
      )}
      {titleDialog && <TitleSheet key={`${titleDialog.kind}:${titleDialog.title}`} title={titleDialog.kind === "new" ? "新增目录" : titleDialog.kind === "directory" ? "目录改名" : "题目改名"} value={titleDialog.title} busy={titleBusy} error={error} onClose={() => {setTitleDialog(undefined);setError("");}} onSubmit={title => void saveTitle(title)}/>}
      {copying && <div className="authoring-overlay"><section className="authoring-sheet" role="dialog" aria-modal="true" aria-label="复制到机构作业库"><h3>复制到机构作业库</h3><p>{copying.body.title}</p>{error && <p role="alert" className="authoring-error">{error}</p>}<label>目标目录<select value={copyTargetId} onChange={event=>setCopyTargetId(event.target.value)}>{copyTargets.map(target=><option key={target.id} value={target.id}>{target.title}</option>)}</select></label><div className="authoring-actions"><button type="button" onClick={()=>setCopying(undefined)}>取消</button><button type="button" className="primary" disabled={busy||!copyTargetId} onClick={()=>void run(copyToOrganization)}>确认复制</button></div></section></div>}
      {adding && (
        <div className="authoring-overlay">
          <section className="authoring-sheet">
            <h3>添加题目</h3>
            {["手动摆棋", "拍照／相册识别", "导入 FEN／PGN"].map((label, i) => (
              <button
                key={label}
                onClick={() => {
                  const q = newQuestion();
                  q.body.source = { entry: i };
                  setQuestion(q);
                  setMode("position");
                  setAdding(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => {
                setPicker("games");
                setAdding(false);
              }}
            >
              从已有棋谱选局面
            </button>
            <button
              onClick={() => {
                setPicker("problems");
                setAdding(false);
              }}
            >
              从平台／机构题库选题
            </button>
            <button onClick={() => setAdding(false)}>取消</button>
          </section>
        </div>
      )}
      {picker && (
        <SourcePicker
          api={api}
          kind={picker}
          directoryId={dir?.id}
          existing={dir?.items ?? []}
          onClose={() => setPicker(undefined)}
          onChoose={async (source) => {
            if (picker === "games") {
              const body = await api.request<QuestionBody>(
                BASE + "/import",
                json({ gameId: source.id }),
              );
              setQuestion({
                ...newQuestion(),
                body: { ...newQuestion().body, ...body },
              });
              setMode("answer");
              setPicker(undefined);
            }
          }}
          onChooseMany={async (sources) => {
            if (!dir || picker !== "problems") return;
            const existing = new Set(dir.items.map(item => `${itemRef(item).kind}:${itemRef(item).subjectId}`));
            const added = sources.filter(source => !existing.has(`${source.authored ? "authored" : "source"}:${source.id}`));
            if (dir.items.length + added.length > 1000) throw new Error("单目录最多1000题，请缩小筛选范围");
            await changeDir([...dir.items, ...added.map(source => ({
              id: source.id,
              subjectId: source.id,
              kind: source.authored ? "authored" : "source",
            } as AuthoredQuestion))]);
            setPicker(undefined);
          }}
        />
      )}
      {publish && (dir || externalDirectory) && (
        <AssignmentSheet
          api={api}
          scopeKey={scopeKey}
          orgName={orgName}
          directory={(dir || externalDirectory)!}
          items={dir ? selected.length ? selectedItems : dir.items : externalDirectory!.items}
          onClose={() => {setPublish(false);setExternalDirectory(undefined);}}
          onAssigned={onAssigned}
        />
      )}
    </main>
  );
}

type CatalogNode = {id:string;name:string;kind:string;itemCount?:number|null;teachingEntry?:string};
type CatalogItem = {id:string;title:string;startingFen:string;contentFingerprint?:string;reviewStatus:string;validationStatus:string};
const BASIC_TOPIC_ID = "e0c0221d-1b02-5f2c-9122-a7b0821f2603";
function PlatformAssignmentCatalog({api,onAssign}:{api:AuthoringApi;onAssign(title:string,nodeId:string,items:AuthoredQuestion[]):void}) {
  const [nodeId,setNodeId]=useState<string>();
  const [title,setTitle]=useState("平台作业库");
  const [parentId,setParentId]=useState<string>();
  const [nodes,setNodes]=useState<CatalogNode[]>([]);
  const [nodeCursor,setNodeCursor]=useState<string|null>(null);
  const [items,setItems]=useState<CatalogItem[]>([]);
  const [itemCursor,setItemCursor]=useState<string|null>(null);
  const [itemTotal,setItemTotal]=useState<number|null>(null);
  const [mateStep,setMateStep]=useState("");
  const [selected,setSelected]=useState<CatalogItem[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const generation=useRef(0);
  const previousNode=useRef<string|undefined>(undefined);
  async function browse(id:string|undefined,cursor?:string) {
    const params=new URLSearchParams({availability:"available",limit:"100"});
    if(id)params.set("nodeId",id);
    if(cursor)params.set("cursor",cursor);
    return api.request<{currentNode?:CatalogNode;breadcrumbs:CatalogNode[];children:CatalogNode[];nextCursor?:string|null}>(`/api/v1/admin/teaching-catalog/browse?${params}`);
  }
  async function problems(id:string,cursor?:string) {
    const params=new URLSearchParams({limit:"100"});
    if(cursor)params.set("cursor",cursor);
    if(mateStep)params.set("mateMoves",mateStep);
    return api.request<{items:CatalogItem[];nextCursor?:string|null;totalCount?:number|null}>(`/api/v1/admin/teaching-catalog/${encodeURIComponent(id)}/problems?${params}`);
  }
  useEffect(()=>{
    const epoch=++generation.current;
    const nodeChanged=previousNode.current!==nodeId;
    previousNode.current=nodeId;
    setBusy(true);setError("");setItems([]);setItemCursor(null);setItemTotal(null);
    if(nodeChanged){setNodes([]);setSelected([]);setNodeCursor(null);}
    void Promise.all([browse(nodeId),nodeId?problems(nodeId):Promise.resolve({items:[] as CatalogItem[],nextCursor:null,totalCount:null})])
      .then(([tree,page])=>{
        if(epoch!==generation.current)return;
        setTitle(tree.currentNode?.name||"平台作业库");
        setParentId(tree.breadcrumbs.at(-2)?.id);
        setNodes(tree.children);setNodeCursor(tree.nextCursor??null);
        setItems(page.items.filter(item=>item.reviewStatus==="published"&&item.validationStatus==="ready"));
        setItemCursor(page.nextCursor??null);
        setItemTotal(page.totalCount??null);
      }).catch(reason=>{if(epoch===generation.current)setError(message(reason));})
      .finally(()=>{if(epoch===generation.current)setBusy(false);});
    return ()=>{generation.current++;};
  },[api,nodeId,mateStep]);
  async function moreNodes() {
    if(!nodeCursor||busy)return;
    const epoch=generation.current;setBusy(true);
    try {const page=await browse(nodeId,nodeCursor);if(epoch===generation.current){setNodes(old=>[...new Map([...old,...page.children].map(item=>[item.id,item])).values()]);setNodeCursor(page.nextCursor??null);}}
    catch(reason){if(epoch===generation.current)setError(message(reason));}
    finally{if(epoch===generation.current)setBusy(false);}
  }
  async function moreItems() {
    if(!nodeId||!itemCursor||busy)return;
    const epoch=generation.current;setBusy(true);
    try {const page=await problems(nodeId,itemCursor);if(epoch===generation.current){setItems(old=>[...new Map([...old,...page.items.filter(item=>item.reviewStatus==="published"&&item.validationStatus==="ready")].map(item=>[item.id,item])).values()]);setItemCursor(page.nextCursor??null);setItemTotal(page.totalCount??null);}}
    catch(reason){if(epoch===generation.current)setError(message(reason));}
    finally{if(epoch===generation.current)setBusy(false);}
  }
  async function selectAll() {
    if(!nodeId||busy)return;
    const epoch=generation.current;setBusy(true);setError("");
    try {
      let all=[...items],cursor=itemCursor;
      const seen=new Set<string>();
      while(cursor) {
        if(seen.has(cursor))throw new Error("题目分页异常，请重试");
        seen.add(cursor);
        const page=await problems(nodeId,cursor);
        if(epoch!==generation.current)return;
        all=[...new Map([...all,...page.items.filter(item=>item.reviewStatus==="published"&&item.validationStatus==="ready")].map(item=>[item.id,item])).values()];
        cursor=page.nextCursor??null;
        if(all.length>10000)throw new Error("一次最多布置10000题，请缩小范围");
      }
      setItems(all);setItemCursor(null);setSelected(all);
    } catch(reason){if(epoch===generation.current)setError(message(reason));}
    finally{if(epoch===generation.current)setBusy(false);}
  }
  const selectedIds=new Set(selected.map(item=>item.id));
  const chooseMateStep=(step:string)=>{
    if(!nodeId && step)setNodeId(nodes.find(node=>node.teachingEntry==="basic_mates")?.id||BASIC_TOPIC_ID);
    setMateStep(step);
  };
  return <section className="authoring-platform-catalog" aria-busy={busy}>
    {nodeId && <button type="button" onClick={()=>{setMateStep("");setNodeId(parentId);}}>‹ 返回上级</button>}
    <div className="authoring-catalog-heading"><strong>{title}</strong><span>已选 {selected.length} 题</span></div>
    <div className="authoring-platform-mate-tabs" role="group" aria-label="杀法步数筛选">{[["","全部"],["1","一步杀"],["2","两步杀"],["3","三步杀"],["4","四步杀"]].map(([step,label])=><button type="button" key={step} aria-pressed={mateStep===step} disabled={busy} onClick={()=>chooseMateStep(step)}>{label}</button>)}</div>
    {error && <p role="alert" className="authoring-error">{error}</p>}
    <div className="authoring-platform-nodes">{nodes.map(node=><button type="button" key={node.id} onClick={()=>{setMateStep("");setNodeId(node.id);}}><strong>{node.name}</strong><small>{node.itemCount??0} 题 ›</small></button>)}</div>
    {nodeCursor && <button type="button" disabled={busy} onClick={()=>void moreNodes()}>下一页目录</button>}
    {nodeId && <p className="authoring-platform-page-status" role="status">已显示 {items.length}{itemTotal!==null?` / ${itemTotal}`:""} 题{itemCursor?" · 还有下一页":""}</p>}
    {!!items.length && <>
      <div className="authoring-picker-actions"><button type="button" disabled={busy} onClick={()=>void selectAll()}>全选本目录</button><span>已选 {selected.length} 题</span><button type="button" disabled={busy||!selected.length} onClick={()=>setSelected([])}>清空</button></div>
      <div className="authoring-platform-items">{items.map(item=><button type="button" key={item.id} aria-pressed={selectedIds.has(item.id)} onClick={()=>setSelected(old=>selectedIds.has(item.id)?old.filter(value=>value.id!==item.id):[...old,item])}><AuthoringBoard fen={item.startingFen}/><strong>{item.title}</strong>{selectedIds.has(item.id)&&<span aria-hidden="true">✓</span>}</button>)}</div>
      <button type="button" className="primary" disabled={busy||!selected.length} onClick={()=>onAssign(title,nodeId!,selected.map(item=>({id:item.id,subjectId:item.id,kind:"source",revision:0,status:"source",canEdit:false,archived:false,publishedProblemId:item.id,contentFingerprint:item.contentFingerprint,body:{title:item.title,startingFen:item.startingFen,note:"",solution:[]}})))}>布置已选题目（{selected.length}）</button>
    </>}
    {itemCursor && <button type="button" disabled={busy} onClick={()=>void moreItems()}>下一页题目</button>}
    {busy && <p role="status">正在读取目录和题目…</p>}
    {!busy&&!nodes.length&&!items.length&&!itemCursor&&!error&&<p>此目录暂无可布置题目</p>}
  </section>;
}

function TitleSheet({title,value,busy,error,onClose,onSubmit}:{title:string;value:string;busy:boolean;error:string;onClose():void;onSubmit(value:string):void}) {
  const [text,setText] = useState(value);
  return <div className="authoring-overlay"><form className="authoring-sheet" role="dialog" aria-modal="true" aria-label={title} onSubmit={event => {event.preventDefault();if(text.trim()&&!busy)onSubmit(text.trim());}} onKeyDown={event => {if(event.key === "Escape"&&!busy)onClose();}}>
    <h3>{title}</h3><label>名称<input autoFocus aria-label={title === "题目改名" ? "题目新名称" : "目录名称"} value={text} maxLength={255} disabled={busy} onChange={event => setText(event.target.value)}/></label>
    {error && <p role="alert" className="authoring-error">{error}</p>}
    <button className="primary" type="submit" disabled={busy || !text.trim()}>{busy ? "保存中…" : "保存名称"}</button><button type="button" disabled={busy} onClick={onClose}>取消</button>
  </form></div>;
}

type SourceLibrary = { id: string; title: string; sourceScope: string };
type SourceLibraryPage = {items:SourceLibrary[];nextCursor?:string|null;totalCount?:number;publicationRevision?:number;snapshotKey?:string} & MateFilterSupport;
// Session-scoped display cache. Every open still revalidates before selection is enabled.
const sourcePages=new WeakMap<AuthoringApi,Map<string,{at:number;value:unknown}>>();
function cachedSourcePage<T>(api:AuthoringApi,path:string):T|undefined {
  const hit=sourcePages.get(api)?.get(path);
  return hit && Date.now()-hit.at<30_000 ? hit.value as T : undefined;
}
async function sourcePage<T>(api:AuthoringApi,path:string,signal?:AbortSignal):Promise<T> {
  const value=await api.request<T>(path,{signal});
  if(!signal?.aborted) {
    let pages=sourcePages.get(api);if(!pages){pages=new Map();sourcePages.set(api,pages);}
    if(pages.size>=32)pages.delete(pages.keys().next().value!);
    pages.set(path,{at:Date.now(),value});
  }
  return value;
}

type SourcePickerProps = {
  api: AuthoringApi;
  kind: "problems" | "games";
  directoryId?: string;
  existing: AuthoredQuestion[];
  onClose(): void;
  onChoose(item: AuthoringSource): Promise<void>;
  onChooseMany(items: AuthoringSource[]): Promise<void>;
};
function MateStepFilter({value,onChange,disabled=false}:{value:string;onChange(value:string):void;disabled?:boolean}) {
  const options=[['1','一步杀'],['2','两步杀'],['3','三步杀'],['long','四步及以上']] as const;
  return <div className="authoring-mate-filter"><span>杀法步数</span><div className="authoring-mate-tabs" role="group" aria-label="杀法步数">
    <button type="button" aria-pressed={!value} disabled={disabled} onClick={()=>onChange('')}>全部</button>
    {options.map(([key,label])=><button key={key} type="button" aria-pressed={value===key} disabled={disabled} onClick={()=>onChange(key)}>{label}</button>)}
  </div></div>;
}
function mateStepParams(params:URLSearchParams,filter:string) {
  if(filter.includes(','))params.set("mateSteps",filter);
  else if(filter === "long")params.set("mateGroup","long");
  else if(filter)params.set("mateMoves",filter);
}
type MateFilterSupport={mateFilterVersion?:number;mateMultiFilterVersion?:number};
function requireMateFilter(page:MateFilterSupport,filter:string) {
  if(filter && page.mateFilterVersion !== 1)throw new Error("服务器尚未支持杀法步数筛选，请更新服务端后重试");
  if(filter.includes(',') && page.mateMultiFilterVersion !== 1)throw new Error("服务器尚未支持多选步数筛选，请更新服务端后重试");
}
function SourcePicker(props: SourcePickerProps) {
  const {api,kind,onClose} = props;
  const [library,setLibrary] = useState<SourceLibrary>();
  const [mateFilter,setMateFilter] = useState("");
  const [q,setQ] = useState(""), [reload,setReload] = useState(0);
  const [items,setItems] = useState<SourceLibrary[]>([]);
  const [totalCount,setTotalCount]=useState<number>(), [countError,setCountError]=useState("");
  const [countQuery,setCountQuery]=useState<{path:string;revision?:number;snapshotKey?:string}>(), [countRetry,setCountRetry]=useState(0);
  const [nextCursor,setNextCursor] = useState<string|null>();
  const [busy,setBusy] = useState(true), [error,setError] = useState("");
  const generation = useRef(0), paginationLock = useRef(false), lastSearch = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  function pagePath(after?:string,view="page") {
    const params=new URLSearchParams({kind,q:q.trim(),limit:"30",view});
    if(after)params.set("cursor",after);
    if(kind==="problems")mateStepParams(params,mateFilter);
    return BASE+"/source-libraries?"+params;
  }
  async function read(after?:string,signal?:AbortSignal) {
    const page=await sourcePage<SourceLibraryPage>(api,pagePath(after),signal);
    requireMateFilter(page,mateFilter);
    return page;
  }
  useEffect(()=>{
    if(!countQuery || library)return;
    const controller=new AbortController();let active=true;
    setCountError("");
    void api.request<{totalCount?:number;publicationRevision?:number;snapshotKey?:string}>(countQuery.path,{signal:controller.signal})
      .then(page=>{
        if(!active)return;
        if((countQuery.revision!=null && page.publicationRevision!==countQuery.revision) || (countQuery.snapshotKey && page.snapshotKey!==countQuery.snapshotKey)){setReload(value=>value+1);return;}
        if(Number.isSafeInteger(page.totalCount)&&page.totalCount!>=0)setTotalCount(page.totalCount);
      }).catch(reason=>{if(active && !controller.signal.aborted)setCountError(message(reason));});
    return ()=>{active=false;controller.abort();};
  },[api,countQuery,countRetry,library?.id]);
  useEffect(()=>{
    if(library)return;
    const epoch=++generation.current, controller=new AbortController();
    setNextCursor(undefined);setError("");setBusy(true);paginationLock.current=false;
    setTotalCount(undefined);setCountQuery(undefined);setCountError("");
    const cached=cachedSourcePage<SourceLibraryPage>(api,pagePath());
    if(cached){setItems(cached.items);setNextCursor(cached.nextCursor??null);}
    list.current?.scrollTo?.({top:0});
    const searchChanged=lastSearch.current!==undefined && lastSearch.current!==q;lastSearch.current=q;
    const deadline=Date.now()+30_000;
    let timer:ReturnType<typeof setTimeout>;
    async function load() {
      let retrying=false;
      try {
        const page=await read(undefined,controller.signal);
        if(epoch===generation.current){
          setItems(page.items);setNextCursor(page.nextCursor??null);setTotalCount(page.totalCount);
          if(page.totalCount==null)setCountQuery({path:pagePath(undefined,"counts"),revision:page.publicationRevision,snapshotKey:page.snapshotKey});
        }
      } catch(reason) {
        if(epoch!==generation.current)return;
        if(/^题库正在(准备|更新)/.test(message(reason)) && Date.now()<deadline) {
          retrying=true;timer=setTimeout(()=>void load(),500);
        } else {setItems([]);setError(message(reason));}
      } finally {if(epoch===generation.current && !retrying)setBusy(false);}
    }
    timer=setTimeout(()=>void load(),searchChanged?200:0);
    return ()=>{clearTimeout(timer);controller.abort();generation.current++;};
  },[api,kind,q,mateFilter,reload,library?.id]);
  async function loadMore() {
    if(!nextCursor || busy || paginationLock.current)return;
    const epoch=generation.current,after=nextCursor;
    paginationLock.current=true;setBusy(true);setError("");
    try {
      const page=await read(after);
      if(epoch!==generation.current)return;
      if(page.nextCursor===after)throw new Error("分页读取异常，请重新搜索后重试");
      setItems(old=>{const seen=new Set(old.map(item=>item.id));return [...old,...page.items.filter(item=>!seen.has(item.id))];});
      setNextCursor(page.nextCursor??null);
    } catch(reason){if(epoch===generation.current)setError(message(reason));}
    finally{if(epoch===generation.current){paginationLock.current=false;setBusy(false);}}
  }
  if(library)return <SourceRecordPicker {...props} library={library} mateFilter={mateFilter} onMateFilterChange={setMateFilter} onClose={()=>setLibrary(undefined)}/>;
  const title=kind==="games" ? "选择棋谱库／书本" : "选择题库／书本";
  return <div className="authoring-overlay"><section className="authoring-sheet authoring-picker" role="dialog" aria-modal="true" aria-label={title}>
    <header className="authoring-picker-header"><button type="button" onClick={onClose}>‹ 返回</button><h3>{title}</h3></header>
    {kind === "problems" && <MateStepFilter value={mateFilter} onChange={setMateFilter}/>}
    <input aria-label="搜索题库或书本" placeholder="输入题库或书本名称" value={q} onChange={event=>setQ(event.target.value)}/>
    {error && <p role="alert" className="authoring-error">{error}<button type="button" disabled={busy} onClick={()=>setReload(value=>value+1)}>重试</button></p>}
    <div className="authoring-source-list authoring-library-list" ref={list} aria-busy={busy}>
      {busy && items.length>0 && <p className="authoring-picker-loading" role="status">正在更新题库…</p>}
      {items.map(item=><button type="button" key={item.id} className={busy ? "authoring-retained" : undefined} disabled={busy} onClick={()=>setLibrary(item)}>
        <span className="authoring-library-icon" aria-hidden="true">▤</span>
        <span className="authoring-source-copy"><strong>{item.title}</strong><small>{item.sourceScope} · {kind==="games" ? "查看棋谱" : "进入选题"}</small></span>
        <span className="authoring-library-arrow" aria-hidden="true">›</span>
      </button>)}
      {!items.length && <p role="status">{busy ? "正在读取题库…" : error ? "请重试" : "没有匹配的题库或书本"}</p>}
      <p className="authoring-picker-page-status">已显示 {items.length} 本题库{totalCount!=null ? ` · 共 ${totalCount} 本` : countError ? " · 总数暂不可用" : " · 总数统计中"}{nextCursor ? " · 还有下一页" : ""}</p>
      {countError && <p className="authoring-error">题库已加载，总数暂不可用<button type="button" onClick={()=>setCountRetry(value=>value+1)}>重试统计</button></p>}
      {nextCursor && <button type="button" disabled={busy} onClick={()=>void loadMore()}>{busy ? "正在读取…" : "下一页题库"}</button>}
    </div>
  </section></div>;
}

const SOURCE_RECORD_PAGE_SIZE = 50;
function sourceTotal(page: AuthoringSourcePage, loaded: AuthoringSource[]): number | undefined {
  if (Number.isSafeInteger(page.totalCount) && page.totalCount! >= 0) return page.totalCount;
  return page.nextCursor ? undefined : loaded.length;
}
function SourceRecordPicker({api,kind,directoryId,existing,onClose,onChoose,onChooseMany,library,mateFilter,onMateFilterChange}:SourcePickerProps & {library:SourceLibrary;mateFilter:string;onMateFilterChange(value:string):void}) {
  const [q,setQ] = useState(""), [category,setCategory] = useState(""), [reload,setReload] = useState(0);
  const [filtersOpen,setFiltersOpen] = useState(false);
  const [items,setItems] = useState<AuthoringSource[]>([]), [categories,setCategories] = useState<string[]>([]);
  const [preparing,setPreparing] = useState(false);
  const [nextCursor,setNextCursor] = useState<string|null>(), [error,setError] = useState(""), [busy,setBusy] = useState(true), [choosing,setChoosing] = useState(false);
  const [selected,setSelected] = useState<AuthoringSource[]>([]);
  const [pageIndex,setPageIndex] = useState(0);
  const [totalCount,setTotalCount] = useState<number>();
  const [preview,setPreview] = useState<AuthoringSource>();
  const request = useRef(0), selectionLock = useRef(false), paginationLock = useRef(false), lastSearch = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const existingIds = new Set(existing.map(item => `${itemRef(item).kind}:${itemRef(item).subjectId}`));
  function recordPath(after?:string) {
    const params = new URLSearchParams({kind,q:q.trim(),limit:String(SOURCE_RECORD_PAGE_SIZE),libraryId:library.id});
    if (category) params.set("category",category);
    if (directoryId) params.set("directoryId",directoryId);
    if (after) params.set("cursor",after);
    if(kind === "problems")mateStepParams(params,mateFilter);
    return BASE+"/sources?"+params;
  }
  async function readPage(after?:string, signal?:AbortSignal) {
    const page = await sourcePage<AuthoringSourcePage & MateFilterSupport>(api,recordPath(after),signal);
    requireMateFilter(page,mateFilter);
    return page;
  }
  useEffect(() => {
    const epoch=++request.current;
    setNextCursor(undefined);setTotalCount(undefined);setPageIndex(0);setError("");setBusy(true);paginationLock.current=false;
    list.current?.scrollTo?.({top:0});
    const cached=cachedSourcePage<AuthoringSourcePage>(api,recordPath());
    if(cached){setItems(mergeSources([],cached.items));setCategories(cached.categories??[]);setNextCursor(cached.nextCursor??null);setTotalCount(cached.totalCount);}
    const controller=new AbortController(), deadline=Date.now()+180_000;
    let timer:ReturnType<typeof setTimeout>;
    setPreparing(false);
    async function load() {
      let retrying=false;
      try {
        const page=await readPage(undefined,controller.signal);
        if(epoch!==request.current)return;
        const loaded=mergeSources([],page.items);setTotalCount(sourceTotal(page,loaded));
        setItems(loaded);setCategories(page.categories ?? []);setNextCursor(page.nextCursor ?? null);setPreparing(false);
      } catch(reason) {
        if(epoch!==request.current)return;
        const text=message(reason);
        if(/^题库正在(准备|更新)/.test(text) && Date.now()<deadline) {
          retrying=true;setPreparing(true);timer=setTimeout(()=>void load(),2000);
        } else {setItems([]);setPreparing(false);setError(/^题库正在(准备|更新)/.test(text) ? "题库准备较慢，请稍后重试" : text);}
      } finally {if(epoch===request.current && !retrying)setBusy(false);}
    }
    const searchChanged=lastSearch.current!==undefined && lastSearch.current!==q;lastSearch.current=q;
    timer=setTimeout(()=>void load(),searchChanged?200:0);
    return ()=>{clearTimeout(timer);controller.abort();request.current++;};
  },[q,category,mateFilter,kind,directoryId,library.id,api,reload]);
  async function loadMore() {
    if (busy || choosing || paginationLock.current) return;
    const targetPage=pageIndex+1;
    if(!nextCursor && items.length<=targetPage*SOURCE_RECORD_PAGE_SIZE)return;
    const epoch=request.current;
    paginationLock.current=true;setBusy(true);setError("");
    try {
      let loaded=items,cursor=nextCursor,total=totalCount;
      const seen=new Set<string>();
      while(cursor && loaded.length<(targetPage+1)*SOURCE_RECORD_PAGE_SIZE) {
        if(seen.has(cursor))throw new Error("分页读取异常，请重新搜索后重试");
        seen.add(cursor);
        const page=await readPage(cursor);
        if(epoch!==request.current)return;
        if(page.nextCursor===cursor)throw new Error("分页读取异常，请重新搜索后重试");
        loaded=mergeSources(loaded,page.items);cursor=page.nextCursor??null;total=sourceTotal(page,loaded)??total;
      }
      setItems(loaded);setNextCursor(cursor);setTotalCount(total);
      setPageIndex(Math.min(targetPage,Math.max(0,Math.ceil(loaded.length/SOURCE_RECORD_PAGE_SIZE)-1)));
      list.current?.scrollTo?.({top:0});
    } catch(reason) {if(epoch===request.current){if(/^题库正在(准备|更新)/.test(message(reason)))setReload(value=>value+1);else setError(message(reason));}}
    finally {if(epoch===request.current){setBusy(false);paginationLock.current=false;}}
  }
  async function choose(item:AuthoringSource) {
    if(selectionLock.current)return;
    const epoch=request.current;
    selectionLock.current=true;setChoosing(true);setError("");
    try {await onChoose(item);}
    catch(reason){if(epoch===request.current)setError(message(reason));}
    finally {selectionLock.current=false;if(epoch===request.current)setChoosing(false);}
  }
  const selectedKeys=new Set(selected.map(sourceIdentity));
  function toggle(item:AuthoringSource) {
    const identity=sourceIdentity(item);
    setSelected(old=>old.some(value=>sourceIdentity(value)===identity)
      ? old.filter(value=>sourceIdentity(value)!==identity) : [...old,item]);
  }
  async function selectAll() {
    if(kind!=="problems" || busy || choosing || selectionLock.current)return;
    const epoch=request.current;
    selectionLock.current=true;setChoosing(true);setError("");
    try {
      let all=mergeSources([],items), cursor=nextCursor;
      const seen=new Set<string>();
      while(cursor) {
        if(seen.has(cursor))throw new Error("分页读取异常，请重新搜索后重试");
        seen.add(cursor);
        const page=await readPage(cursor);
        if(epoch!==request.current)return;
        all=mergeSources(all,page.items);cursor=page.nextCursor??null;
        if(all.length+existing.length>1000)throw new Error("单目录最多1000题，请缩小筛选范围");
      }
      const available=all.filter(item=>!item.alreadyAdded&&!existingIds.has(`${item.authored ? "authored" : "source"}:${item.id}`));
      if(available.length+existing.length>1000)throw new Error("单目录最多1000题，请缩小筛选范围");
      setItems(all);setNextCursor(null);setTotalCount(all.length);
      setSelected(old=>mergeSources(old,available));
    } catch(reason) {if(epoch===request.current)setError(message(reason));}
    finally {selectionLock.current=false;if(epoch===request.current)setChoosing(false);}
  }
  async function confirmSelection() {
    if(selectionLock.current || !selected.length)return;
    selectionLock.current=true;setChoosing(true);setError("");
    try {await onChooseMany(selected);}
    catch(reason){setError(message(reason));}
    finally {selectionLock.current=false;setChoosing(false);}
  }
  const mateFilterLabel = ({"1":"一步杀","2":"两步杀","3":"三步杀",long:"四步及以上"} as Record<string,string>)[mateFilter] || "";
  const filterSummary = [category, mateFilterLabel, q.trim()].filter(Boolean).join(" · ") || "全部题目";
  const visibleItems=items.slice(pageIndex*SOURCE_RECORD_PAGE_SIZE,(pageIndex+1)*SOURCE_RECORD_PAGE_SIZE);
  const hasNextPage=Boolean(nextCursor)||items.length>(pageIndex+1)*SOURCE_RECORD_PAGE_SIZE;
  return <div className="authoring-overlay"><section className="authoring-sheet authoring-picker" role="dialog" aria-modal="true" aria-label={kind === "games" ? "选择已有棋谱" : "选择平台／机构题目"}>
    <header className="authoring-picker-header"><button type="button" disabled={choosing} onClick={onClose}>‹ 返回</button><h3>{kind === "games" ? "选择已有棋谱" : "选择平台／机构题目"}</h3></header>
    <p className="authoring-picker-book">{library.title}</p>
    {kind === "problems" ? <>
      <div className="authoring-picker-toolbar">
        <button type="button" aria-expanded={filtersOpen} aria-controls="authoring-record-filters" onClick={()=>setFiltersOpen(value=>!value)}><Filter size={16} aria-hidden="true"/>筛选</button>
        <button type="button" disabled={busy||choosing||!items.length} onClick={()=>void selectAll()}>全选</button>
        <button type="button" className="primary" disabled={choosing||busy||!selected.length} onClick={()=>void confirmSelection()}>{choosing ? "添加中…" : `确认添加（${selected.length}）`}</button>
      </div>
      <div className="authoring-picker-summary"><span title={filterSummary}>{filterSummary} · 已选 {selected.length} 题</span>{selected.length>0 && <button type="button" aria-label="清空选择" title="清空选择" disabled={choosing} onClick={()=>setSelected([])}><X size={16} aria-hidden="true"/></button>}</div>
      {filtersOpen && <div className="authoring-picker-filters" id="authoring-record-filters">
        <label className="authoring-picker-category">题型分类<select aria-label="题型分类" value={category} disabled={choosing} onChange={event=>setCategory(event.target.value)}><option value="">全部</option>{categories.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
        <MateStepFilter value={mateFilter} onChange={onMateFilterChange} disabled={choosing}/>
        <input aria-label="搜索题目或棋谱" placeholder="输入名称搜索" value={q} disabled={choosing} onChange={event=>setQ(event.target.value)}/>
      </div>}
    </> : <input aria-label="搜索题目或棋谱" placeholder="输入名称搜索" value={q} disabled={choosing} onChange={event=>setQ(event.target.value)}/>}
    {error && <p role="alert" className="authoring-error">{error}<button type="button" disabled={busy || choosing} onClick={()=>setReload(value=>value+1)}>重试</button></p>}
    <div className={kind === "problems" ? "authoring-source-list authoring-source-grid" : "authoring-source-list"} ref={list} aria-busy={busy || choosing}>
      {busy && items.length>0 && <p className="authoring-picker-loading" role="status">正在更新题目…</p>}
      {visibleItems.map(item=>{
        const added=kind === "problems" && (item.alreadyAdded || existingIds.has(`${item.authored ? "authored" : "source"}:${item.id}`));
        return <div className="authoring-source-tile" key={sourceIdentity(item)}>
          <button type="button" className={`${busy && !added ? "authoring-retained" : ""} ${selectedKeys.has(sourceIdentity(item)) ? "selected" : ""}`} disabled={busy || choosing || Boolean(added)} aria-pressed={kind==="problems" ? selectedKeys.has(sourceIdentity(item)) : undefined} onClick={()=>kind==="problems" ? toggle(item) : void choose(item)}>
            <span className="authoring-source-board"><AuthoringBoard fen={item.fen}/></span><span className="authoring-source-copy"><strong>{item.title}</strong><small>{item.category || "未分类"}</small>{added && <small>已添加</small>}</span>
            {kind==="problems" && selectedKeys.has(sourceIdentity(item)) && <span className="authoring-source-check" aria-hidden="true">✓</span>}
          </button>
          {kind==="problems" && <button className="authoring-source-preview" type="button" onClick={()=>setPreview(item)}>详情</button>}
        </div>;
      })}
      {!items.length && <div className="authoring-source-empty" role="status">{busy ? preparing ? "正在准备题库，请稍候…" : "正在读取…" : error ? "请修改搜索条件后重试" : "没有匹配内容"}{!busy && !error && kind === "problems" && (category || mateFilter || q) && <button type="button" onClick={()=>{setCategory("");onMateFilterChange("");setQ("");}}>清除筛选</button>}</div>}
    </div>
    <nav className="authoring-picker-pagination" aria-label="题目分页">
      <button type="button" disabled={busy||choosing||pageIndex===0} onClick={()=>{setPageIndex(value=>value-1);list.current?.scrollTo?.({top:0});}}>上一页</button>
      <p className="authoring-picker-page-status" aria-live="polite">第 {pageIndex+1}{totalCount!=null?` / ${Math.max(1,Math.ceil(totalCount/SOURCE_RECORD_PAGE_SIZE))}`:""} 页 · 本页 {visibleItems.length} 题<br/>{totalCount!=null?`共 ${totalCount} 题 · 每页 50 题`:"总数统计中 · 每页 50 题"}</p>
      <button type="button" disabled={busy||choosing||!hasNextPage} onClick={()=>void loadMore()}>下一页</button>
    </nav>
    {preview && <div className="authoring-preview-overlay"><section role="dialog" aria-modal="true" aria-label="题目详情" className="authoring-preview-detail"><h4>{preview.title}</h4><AuthoringBoard fen={preview.fen}/><p>{[preview.category || "未分类",preview.sourceScope,preview.sourceTitle].filter(Boolean).join(" · ")}</p>{(preview.sourceCount??0)>1 && <p>已合并 {preview.sourceCount} 个重复来源</p>}<button type="button" onClick={()=>setPreview(undefined)}>返回选题</button></section></div>}
  </section></div>;
}

function QuestionEditor({
  question,
  mode: initialMode,
  api,
  scopeKey,
  directoryId,
  onClose,
  onSave,
  onCopy,
  personal = false,
}: {
  question: AuthoredQuestion;
  mode: "position" | "answer" | "preview";
  api: AuthoringApi;
  scopeKey: string;
  directoryId?: string;
  onClose(): void;
  onSave(q: AuthoredQuestion): Promise<void>;
  onCopy(body: QuestionBody): void;
  personal?: boolean;
}) {
  const [validating, setValidating] = useState(false);
  const pauseValidation = useRef(false);
  const contentVersion = useRef(0);
  const initialKey = `qixi.authoring:${scopeKey}:${question.id}`;
  const [cached] = useState(() => {
    try {
      return question.canEdit
        ? JSON.parse(localStorage.getItem(initialKey) || "null")
        : null;
    } catch {
      return null;
    }
  });
  const [conflict, setConflict] = useState(
    Boolean(cached && cached.revision !== question.revision),
  );
  const [q, setQ] = useState(question),
    [body, setBody] = useState<QuestionBody>(cached?.body || question.body),
    [mode, setMode] = useState(initialMode),
    [flipped, setFlipped] = useState(false),
    [piece, setPiece] = useState("R"),
    [selected, setSelected] = useState<number>(),
    [history, setHistory] = useState<string[]>([]),
    [path, setPath] = useState<string[]>([]),
    [fen, setFen] = useState(question.body.startingFen),
    [moveNotations, setMoveNotations] = useState<{key:string;labels:Record<string,string>}>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [text, setText] = useState(""),
    [photo, setPhoto] = useState<File>(),
    [recognition, setRecognition] = useState<{
      pending: boolean;
      uncertain: number[];
    }>(() => {
      try {
        return (
          JSON.parse(localStorage.getItem(initialKey) || "null")
            ?.recognition || { pending: false, uncertain: [] }
        );
      } catch {
        return { pending: false, uncertain: [] };
      }
    }),
    [importOpen, setImportOpen] = useState(
      question.revision === 0 &&
        (question.body.source as { entry?: number })?.entry === 2,
    ),
    [photoOpen, setPhotoOpen] = useState(
      question.revision === 0 &&
        (question.body.source as { entry?: number })?.entry === 1,
    );
  const key = `qixi.authoring:${scopeKey}:${q.id}`;
  const lock = useRef(false),
    alive = useRef(true),
    epoch = useRef(0),
    bodyRef = useRef(body);
  bodyRef.current = body;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (q.canEdit && !conflict) {
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            revision: q.revision,
            body,
            directoryId,
            recognition,
          }),
        );
      } catch {
        setNotice("本机空间不足，请及时保存到机构草稿");
      }
    }
  }, [body, q.revision, q.id, recognition, conflict]);
  const boardKey = JSON.stringify([body.startingFen,path]);
  useEffect(() => {
    const n = ++epoch.current;
    if (mode === "position") {
      setFen(body.startingFen);
      return;
    }
    void api
      .request<{ fen: string; moveNotations?: Record<string,string> }>(
        BASE + "/board",
        json({ fen: body.startingFen, moves: path }),
      )
      .then((v) => {
        if (alive.current && n === epoch.current) {
          setFen(v.fen);
          setMoveNotations({key:boardKey,labels:v.moveNotations ?? {}});
        }
      })
      .catch((e) => {
        if (alive.current && n === epoch.current) setError(message(e));
      });
  }, [path, body.startingFen, mode]);
  const warnings = positionWarnings(body.startingFen),
    side = body.startingFen.split(/\s+/)[1] || "w";
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      return await task();
    } catch (e) {
      if (alive.current) setError(message(e));
      return undefined;
    } finally {
      if (alive.current) {
        setValidating(false);
        lock.current = false;
        setBusy(false);
      }
    }
  }
  function change(next: QuestionBody) {
    contentVersion.current++;
    setBody(next);
    setConfirmed(false);
    setNotice("");
  }
  function position(next: string) {
    setError("");
    setHistory((old) => [...old, body.startingFen].slice(-100));
    setSelected(undefined);
    setPath([]);
    change({
      ...body,
      startingFen: next,
      trainingGoal: body.trainingGoal
        ? {
            ...body.trainingGoal,
            solverSide: next.split(/\s+/)[1] === "b" ? "b" : "w",
          }
        : null,
    });
  }
  const missingGenerals = (() => {
    try {const cells=fenCells(body.startingFen);return ["k", "K"].some(code=>!cells.includes(code));}
    catch {return false;}
  })();
  function restoreGenerals() {
    const cells = fenCells(body.startingFen);
    for (const code of ["k", "K"]) {
      if (cells.includes(code)) continue;
      const home = code === "k" ? 4 : 85;
      const palace = Array.from({length:9},(_,i)=>(code === "k" ? 0 : 7)*9+Math.floor(i/3)*9+3+i%3);
      const target = [home,...palace].find(index=>!cells[index]);
      if (target == null) {setError("九宫已满，请先移开棋子，再补齐将帅");return;}
      cells[target] = code;
    }
    position(cellsFen(cells, side));
    setNotice("已补齐将帅，请核对并移动到正确位置");
  }
  async function save(): Promise<AuthoredQuestion> {
    if (conflict)
      throw new Error(
        "机构题目已被另一端修订，请先另存本机草稿或采用机构最新版本",
      );
    if (mode === "position" && missingGenerals)
      throw new Error("将帅须保留在棋盘上，请先补齐将帅");
    if (recognition.pending)
      throw new Error("请先逐格核对识别棋盘和先走方，再确认保存");
    const next = await api.request<AuthoredQuestion>(
      BASE + "/questions/" + q.id,
      json(
        {
          expectedRevision: q.revision,
          directoryId: q.revision === 0 ? directoryId : undefined,
          body,
        },
        "PUT",
      ),
    );
    if (!alive.current) throw new Error("编辑页已关闭");
    setQ(next);
    try {
      localStorage.removeItem(key);
    } catch {}
    return next;
  }
  async function square(index: number) {
    if (busy) return;
    const cells = fenCells(mode === "position" ? body.startingFen : fen);
    if (mode === "position") {
      if (piece === "move") {
        if (selected == null) {
          if (cells[index]) setSelected(index);
          return;
        }
        if (selected === index) {
          setSelected(undefined);
          return;
        }
        if (/[kK]/.test(cells[index])) {
          setError("将帅须保留在棋盘上，不能被其他棋子覆盖");
          return;
        }
        const moving = cells[selected];
        if (/[kK]/.test(moving)) {
          const row = Math.floor(index/9), col = index%9;
          if (col < 3 || col > 5 || (moving === "k" ? row > 2 : row < 7)) {
            setError(`${LABELS[moving]}只能在己方九宫内摆放`);
            return;
          }
        }
        cells[index] = cells[selected];
        cells[selected] = "";
        position(cellsFen(cells, side));
        return;
      }
      if (/[kK]/.test(cells[index])) {
        if (piece === "" && cells.filter(code=>code===cells[index]).length>1) {
          // Allow correcting duplicate recognition results while keeping one general.
          cells[index] = "";
          position(cellsFen(cells, side));
        } else if (piece === "") {
          setError("将帅须保留在棋盘上，不能删除；请使用移动调整位置");
        } else {
          setPiece("move");
          setSelected(index);
          setError("");
        }
        return;
      }
      const limits: Record<string, number> = {
        k: 1,
        a: 2,
        b: 2,
        n: 2,
        r: 2,
        c: 2,
        p: 5,
      };
      if (
        piece &&
        cells[index] !== piece &&
        cells.filter((c) => c === piece).length >= limits[piece.toLowerCase()]
      ) {
        setError(`${LABELS[piece]}数量已满，请先移动或删除已有棋子`);
        return;
      }
      cells[index] = piece;
      position(cellsFen(cells, side));
      return;
    }
    if (selected == null) {
      if (cells[index]) setSelected(index);
      return;
    }
    if (selected === index) {
      setSelected(undefined);
      return;
    }
    const move = toIccs(selected) + toIccs(index);
    setSelected(undefined);
    await run(async () => {
      const result = await api.request<{ fen: string }>(
        BASE + "/board",
        json({ fen: body.startingFen, moves: [...path, move] }),
      );
      if (!alive.current) return;
      if (mode === "answer") {
        change({ ...body, solution: addAnswer(body.solution, path, move) });
        setPath((old) => [...old, move]);
        setFen(result.fen);
      } else {
        const saved = q.canEdit && (q.revision === 0 || JSON.stringify(q.body) !== JSON.stringify(body)) ? await save() : q;
        const verdict = await api.request<{outcome:string;message:string;path:string[];completed:boolean}>(
          saved.kind === "source" ? `/api/v1/admin/problems/${saved.id}/verify-move` : BASE + "/questions/" + saved.id + "/preview",
          json({expectedRevision:saved.revision,path,candidate:move}),
        );
        if (!alive.current) return;
        if (verdict.outcome === "correct" || verdict.outcome === "completed") setPath(verdict.path);
        setNotice(verdict.message + "（教师试做，不记录学生成绩）");
      }
    });
  }
  async function importText() {
    await run(async () => {
      const value = await api.request<Partial<QuestionBody>>(
        BASE + "/import",
        json({ text }),
      );
      change({ ...body, ...value });
      setPath([]);
      setImportOpen(false);
      setMode(value.solution?.length ? "answer" : "position");
      setNotice("已导入，可沿答案走到某一步，选择“用当前局面出题”");
    });
  }
  async function operation(action: string) {
    await run(async () => {
      const version = contentVersion.current;
      const saved = await save();
      if (action === "publish" || action === "validate") {
        pauseValidation.current = false;
        setValidating(true);
        let complete = false;
        while (!complete && alive.current && !pauseValidation.current) {
          const progress = await api.request<{checked:number;total:number;complete:boolean}>(
            BASE + "/questions/" + saved.id + "/validate-next",
            json({action:"validate",expectedRevision:saved.revision}),
          );
          if (!alive.current) return;
          complete = progress.complete;
          setNotice(`按学生判题标准校验：${progress.checked} / ${progress.total}；中断后可继续`);
        }
        setValidating(false);
        if (!alive.current) return;
        if (pauseValidation.current) {setNotice("校验已暂停，再次校验或发布会继续未完成的部分");return;}
      }
      if (version !== contentVersion.current) throw new Error("内容已改变，已停止发布，请重新校验当前内容");
      const result = await api.request<AuthoredQuestion>(
        BASE + "/questions/" + saved.id + "/actions",
        json({ action, expectedRevision: saved.revision }),
      );
      if (!alive.current) return;
      setQ(result);
      if (action === "publish" || action === "archive") await onSave(result);
      else setNotice("局面、答案与目标校验通过，请试做确认后发布");
    });
  }
  const children = choicesAt(body.solution, path);
  return (
    <main className={`teacher-authoring authoring-editor ${mode === "position" ? "authoring-position-editor" : ""}`}>
      <header className="authoring-header">
        <button onClick={onClose} disabled={busy}>
          ‹ 返回目录
        </button>
        <div>
          <h2>
            {mode === "position"
              ? "摆棋录题"
              : mode === "answer"
                ? "答案与讲解"
                : "教师试做"}
          </h2>
          <small>
            {mode === "preview" ? "仅预览，不提交学生成绩" : names[q.status]}
          </small>
        </div>
      </header>
      {error && (
        <p role="alert" className="authoring-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="authoring-notice">
          {notice}
        </p>
      )}
      {validating && <button type="button" onClick={() => {pauseValidation.current = true;setNotice("正在暂停，当前一步校验结束后保留进度");}}>暂停校验</button>}
      {conflict && (
        <section className="authoring-notice" role="alert">
          <p>
            机构题目已被另一端修订。当前保留本机离线编辑，尚未覆盖机构版本。
          </p>
          <button
            disabled={recognition.pending}
            onClick={() =>
              onCopy({
                ...body,
                source: { questionId: q.id, revision: cached.revision },
              })
            }
          >
            将本机编辑另存为新草稿
          </button>
          <button
            onClick={() => {
              if (confirm("放弃这份本机编辑并采用机构最新版本？")) {
                setBody(question.body);
                setConflict(false);
                setRecognition({ pending: false, uncertain: [] });
                setPath([]);
              }
            }}
          >
            放弃本机编辑，采用机构最新版本
          </button>
        </section>
      )}
      <div className="authoring-editor-layout">
        <section className="authoring-board-panel">
          <AuthoringBoard
            fen={mode === "position" ? body.startingFen : fen}
            selected={selected}
            uncertain={recognition.uncertain}
            flipped={flipped}
            onSquare={(i) => void square(i)}
          />
          {mode === "position" && (
            <div className="authoring-palette">
              {["rnbacp", "RNBACP"].map((codes) => (
                <div key={codes}>
                  {[...codes].map((code) => (
                    <button
                      key={code}
                      disabled={busy}
                      aria-label={`选择${code === code.toUpperCase() ? "红" : "黑"}${LABELS[code]}`}
                      aria-pressed={piece === code}
                      onClick={() => {
                        setPiece(code);
                        setSelected(undefined);
                      }}
                    >
                      <img
                        alt={LABELS[code]}
                        src={`/skins/qingxin-zhuyun/${code === code.toUpperCase() ? "r" : "b"}${code.toLowerCase()}.png`}
                      />
                    </button>
                  ))}
                </div>
              ))}
              {missingGenerals && <button type="button" disabled={busy} onClick={restoreGenerals}>补齐将帅</button>}
              <div className="authoring-actions">
                <button
                  aria-pressed={piece === "move"}
                  onClick={() => {
                    setPiece("move");
                    setSelected(undefined);
                  }}
                >
                  移动
                </button>
                <button
                  aria-pressed={piece === ""}
                  onClick={() => {
                    setPiece("");
                    setSelected(undefined);
                  }}
                >
                  删除
                </button>
                <button
                  disabled={!history.length || busy}
                  onClick={() => {
                    const old = history.at(-1)!;
                    setHistory((h) => h.slice(0, -1));
                    setSelected(undefined);
                    setError("");
                    change({ ...body, startingFen: old });
                  }}
                >
                  撤销
                </button>
              </div>
            </div>
          )}
          {mode !== "position" && (
            <>
              <div className="authoring-actions">
                <button
                  disabled={!path.length || busy}
                  onClick={() => {
                    setPath([]);
                    setSelected(undefined);
                  }}
                >
                  起点
                </button>
                <button
                  disabled={!path.length || busy}
                  onClick={() => {
                    setPath((p) => p.slice(0, -1));
                    setSelected(undefined);
                  }}
                >
                  上一步
                </button>
                <span>第 {path.length} 半回合</span>
                {children.map((n) => {
                  const label=moveNotations?.key===boardKey ? moveNotations.labels[n.iccs] : undefined;
                  const chinese=label && !/^[a-i][0-9][a-i][0-9]$/i.test(label) ? label : undefined;
                  return <button
                    key={n.iccs}
                    disabled={busy || !chinese}
                    onClick={() => {
                      setPath((p) => [...p, n.iccs]);
                      setSelected(undefined);
                    }}
                  >
                    {chinese ?? "着法待核对"}
                    {n.comment ? " · 注" : ""}
                  </button>;
                })}
              </div>
              {mode === "answer" && (
                <div className="authoring-actions">
                  <button
                    disabled={!path.length || busy}
                    onClick={() => {
                      if (
                        confirm(
                          "将当前预览局面作为新题起点？之前走法会从本题答案中移除，原棋谱不会改变。",
                        )
                      ) {
                        change({
                          ...body,
                          startingFen: fen,
                          solution: structuredClone(children),
                          trainingGoal: body.trainingGoal
                            ? goalFor(body.trainingGoal.kind, fen)
                            : null,
                        });
                        setPath([]);
                      }
                    }}
                  >
                    用当前局面出题
                  </button>
                  <button
                    disabled={!path.length || busy}
                    onClick={() => {
                      if (
                        confirm("删除当前着法及其后续分支？其他变招会保留。")
                      ) {
                        change({
                          ...body,
                          solution: removeAnswer(body.solution, path),
                        });
                        setPath((p) => p.slice(0, -1));
                      }
                    }}
                  >
                    删除当前分支
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <section className="authoring-properties">
          {mode === "position" ? (
            <>
              <details>
                <summary>题名与 FEN／PGN 导入</summary>
                <label>
                  题目名称
                  <input
                    value={body.title}
                    disabled={busy}
                    onChange={(e) => change({ ...body, title: e.target.value })}
                  />
                </label>
                <textarea disabled={busy}
                  aria-label="局面 FEN"
                  value={body.startingFen}
                  readOnly
                />
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(body.startingFen)
                      .catch(() => setError("复制失败，请手动复制 FEN"))
                  }
                >
                  复制 FEN
                </button>
                <button onClick={() => setImportOpen(true)}>
                  粘贴／导入 FEN 或 PGN
                </button>
              </details>
              {warnings.length > 0 && (
                <p role="status">{warnings.join("；")}。发布前须修正。</p>
              )}
            </>
          ) : (
            <>
              <div className="authoring-actions">
                {q.canEdit && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMode("position");
                        setPath([]);
                      }}
                    >
                      修改初始局面
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMode(mode === "preview" ? "answer" : "preview");
                        setPath([]);
                      }}
                    >
                      {mode === "preview" ? "编辑答案" : "试做／回放"}
                    </button>
                  </>
                )}
                <button onClick={() => setFlipped((v) => !v)}>翻转棋盘</button>
              </div>
              {q.canEdit && mode === "answer" ? (
                <>
                  <label>
                    题名
                    <input
                      disabled={busy}
                      value={body.title}
                      onChange={(e) =>
                        change({ ...body, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    题型
                    <select
                      value={body.trainingGoal?.kind || ""}
                      disabled={busy}
                      onChange={(e) =>
                        change({
                          ...body,
                          trainingGoal: goalFor(
                            e.target.value as AuthoringGoal["kind"],
                            body.startingFen,
                          ),
                          targetMateMoves: e.target.value === "mate" ? 3 : null,
                        })
                      }
                    >
                      <option value="" disabled>
                        请选择训练目标
                      </option>
                      <option value="mate">杀棋</option>
                      <option value="gain_material">得子</option>
                      <option value="endgame_win">取胜</option>
                      <option value="draw">守和</option>
                    </select>
                  </label>
                  {body.trainingGoal && (
                    <>
                      <label>
                        题目要求
                        <input
                          disabled={busy}
                          value={body.trainingGoal.description}
                          onChange={(e) =>
                            change({
                              ...body,
                              trainingGoal: {
                                ...body.trainingGoal!,
                                description: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      {body.trainingGoal.kind === "mate" ? (
                        <label>
                          最多几步杀
                          <input
                            type="number"
                            min={1}
                            max={255}
                            value={body.targetMateMoves || ""}
                            disabled={busy}
                            onChange={(e) =>
                              change({
                                ...body,
                                targetMateMoves: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ) : (
                        <details>
                          <summary>目标验证条件</summary>
                          <label>
                            验证半回合数
                            <input disabled={busy}
                              type="number"
                              min={2}
                              max={40}
                              step={2}
                              value={
                                body.trainingGoal.verification?.horizonPlies ??
                                12
                              }
                              onChange={(e) =>
                                change({
                                  ...body,
                                  trainingGoal: {
                                    ...body.trainingGoal!,
                                    verification: {
                                      ...body.trainingGoal!.verification!,
                                      horizonPlies: Number(e.target.value),
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            {body.trainingGoal.kind === "gain_material"
                              ? "最低净子力收益"
                              : "最低解题方局面分"}
                            <input disabled={busy}
                              type="number"
                              value={
                                body.trainingGoal.kind === "gain_material"
                                  ? body.trainingGoal.verification
                                      ?.minMaterialGain
                                  : body.trainingGoal.verification?.minScoreCp
                              }
                              onChange={(e) =>
                                change({
                                  ...body,
                                  trainingGoal: {
                                    ...body.trainingGoal!,
                                    verification: {
                                      ...body.trainingGoal!.verification!,
                                      [body.trainingGoal!.kind ===
                                      "gain_material"
                                        ? "minMaterialGain"
                                        : "minScoreCp"]: Number(e.target.value),
                                    },
                                  },
                                })
                              }
                            />
                          </label>
                        </details>
                      )}
                    </>
                  )}
                  <label>
                    难度
                    <select
                      disabled={busy}
                      value={body.difficulty || ""}
                      onChange={(e) =>
                        change({
                          ...body,
                          difficulty: Number(e.target.value) || null,
                        })
                      }
                    >
                      <option value="">未设置</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}级
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    讲解
                    <textarea
                      disabled={busy}
                      value={body.note}
                      onChange={(e) =>
                        change({ ...body, note: e.target.value })
                      }
                    />
                  </label>
                  {path.length > 0 && (
                    <label>
                      当前着法注释
                      <input disabled={busy}
                        value={
                          choicesAt(body.solution, path.slice(0, -1)).find(
                            (n) => n.iccs === path.at(-1),
                          )?.comment || ""
                        }
                        onChange={(e) => {
                          const tree = structuredClone(body.solution);
                          const node = choicesAt(tree, path.slice(0, -1)).find(
                            (n) => n.iccs === path.at(-1),
                          );
                          if (node) node.comment = e.target.value;
                          change({ ...body, solution: tree });
                        }}
                      />
                    </label>
                  )}
                  <button
                    disabled={busy || !body.trainingGoal}
                    onClick={() =>
                      void run(async () => {
                        const saved = await save();
                        const answer = await api.request<{
                          solution: AnswerNode[];
                        }>(
                          BASE + "/questions/" + saved.id + "/generate",
                          json({
                            action: "generate",
                            expectedRevision: saved.revision,
                          }),
                        );
                        if (!alive.current) return;
                        change({ ...body, solution: answer.solution });
                        setPath([]);
                        setNotice(
                          "已载入引擎建议，请核对各分支和目标，再保存发布",
                        );
                      })
                    }
                  >
                    引擎辅助生成答案
                  </button>
                  <p>
                    在棋盘上走出答案；回到旧节点走另一着会保留原分支。引擎建议需人工确认。
                  </p>
                  <label className="authoring-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    我已核对局面、答案并试做确认
                  </label>
                  <div className="authoring-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await save();
                          setNotice("草稿已保存");
                        })
                      }
                    >
                      保存草稿
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void operation("validate")}
                    >
                      校验题目
                    </button>
                    {!personal && <button
                      className="primary"
                      disabled={busy || !confirmed}
                      onClick={() => void operation("publish")}
                    >
                      发布到机构题库
                    </button>}
                    {!personal && q.publishedProblemId && !q.archived && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "下架后不能再选入新作业，已布置作业不受影响。",
                            )
                          )
                            void operation("archive");
                        }}
                      >
                        下架
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h3>{body.title}</h3>
                  <p>{body.trainingGoal?.description}</p>
                  <p>{body.note}</p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      onCopy({
                        ...body,
                        source: {
                          questionId: q.id,
                          problemId: q.publishedProblemId,
                        },
                      });
                    }}
                  >
                    复制为我的机构草稿
                  </button>
                </>
              )}
            </>
          )}
        </section>
      </div>
      {recognition.pending && (
        <div className="authoring-notice">
          <span>
            请核对全部棋子、方向和先走方，其中 {recognition.uncertain.length}{" "}
            个位置标为待确认（橙色圆圈）。
          </span>
          <button
            disabled={busy}
            onClick={() => setRecognition({ pending: false, uncertain: [] })}
          >
            我已逐格核对并修正
          </button>
        </div>
      )}
      {mode === "position" && (
        <footer className="authoring-actions sticky bottom authoring-position-tools">
          <button disabled={busy} onClick={() => position(EMPTY_FEN)}>
            清空
          </button>
          <button disabled={busy} onClick={() => position(START_FEN)}>
            摆满
          </button>
          <button disabled={busy} onClick={() => setPhotoOpen(true)}>
            拍照识别
          </button>
          <button onClick={() => setFlipped((v) => !v)}>翻转</button>
          <button
            disabled={busy}
            onClick={() =>
              position(
                cellsFen(fenCells(body.startingFen), side === "w" ? "b" : "w"),
              )
            }
          >
            {side === "w" ? "红先" : "黑先"}
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const saved = await save();
                await onSave(saved);
              })
            }
          >
            完成摆棋
          </button>
        </footer>
      )}
      {importOpen && (
        <div className="authoring-overlay">
          <section className="authoring-sheet">
            <h3>导入 FEN／PGN</h3>
            <textarea disabled={busy}
              aria-label="粘贴 FEN 或 PGN"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label>
              选择 PGN 文件
              <input disabled={busy}
                type="file"
                accept=".pgn,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 2_000_000) {
                      setError("棋谱须小于2MB");
                      return;
                    }
                    void f.text().then(setText);
                  }
                }}
              />
            </label>
            <button
              disabled={busy || !text.trim()}
              onClick={() => void importText()}
            >
              导入并核对
            </button>
            <button onClick={() => setImportOpen(false)}>取消</button>
          </section>
        </div>
      )}
      {photoOpen && !photo && (
        <div className="authoring-overlay">
          <section className="authoring-sheet">
            <h3>识别单个棋盘</h3>
            <p>支持截图和书本棋图；图片在自有服务器处理，结果需要核对。</p>
            <label className="authoring-file">
              拍照
              <input disabled={busy}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setPhoto(e.target.files?.[0])}
              />
            </label>
            <label className="authoring-file">
              从相册选择
              <input disabled={busy}
                type="file"
                accept="image/*"
                onChange={(e) => setPhoto(e.target.files?.[0])}
              />
            </label>
            <button onClick={() => setPhotoOpen(false)}>取消</button>
          </section>
        </div>
      )}
      {photo && (
        <PhotoCrop
          file={photo}
          api={api}
          onClose={() => setPhoto(undefined)}
          onRecognized={(result) => {
            const pieces = result.pieces;
            const cells = Array(90).fill("");
            for (const p of pieces)
              if (
                p.row >= 0 &&
                p.row < 10 &&
                p.col >= 0 &&
                p.col < 9 &&
                LABELS[p.code]
              )
                cells[p.row * 9 + p.col] = p.code;
            position(cellsFen(cells, side));
            setPhoto(undefined);
            setPhotoOpen(false);
            setMode("position");
            setRecognition({
              pending: true,
              uncertain: [
                ...new Set([
                  ...pieces
                    .filter((p) => (p.confidence ?? 0) < 0.9)
                    .map((p) => p.row * 9 + p.col),
                  ...(result.uncertain ?? []).map((p) => p.row * 9 + p.col),
                ]),
              ],
            });
            setNotice(
              "识别初稿已载入：橙色标记为待核对棋子。请逐格核对方向与先走方。" +
                (result.warnings ?? []).join("；"),
            );
          }}
        />
      )}
    </main>
  );
}

type RecognitionResult = {
  pieces: RecognizedPiece[];
  uncertain?: { row: number; col: number; reason?: string }[];
  warnings?: string[];
};
type RecognizedPiece = {
  row: number;
  col: number;
  code: string;
  confidence?: number;
};
function PhotoCrop({
  file,
  api,
  onClose,
  onRecognized,
}: {
  file: File;
  api: AuthoringApi;
  onClose(): void;
  onRecognized(result: RecognitionResult): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [image, setImage] = useState<HTMLImageElement>(),
    [turn, setTurn] = useState(0),
    [crop, setCrop] = useState({ left: 0, top: 0, right: 100, bottom: 100 }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const url = URL.createObjectURL(file),
      im = new Image();
    im.onload = () => {
      if (alive.current) setImage(im);
    };
    im.onerror = () => setError("图片无法读取，请选择 JPG 或 PNG");
    im.src = url;
    return () => {
      alive.current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !image) return;
    const ratio = Math.min(1, 1600 / Math.max(image.width, image.height));
    const w = image.width * ratio,
      h = image.height * ratio;
    el.width = turn % 2 ? h : w;
    el.height = turn % 2 ? w : h;
    const ctx = el.getContext("2d")!;
    ctx.translate(el.width / 2, el.height / 2);
    ctx.rotate((turn * Math.PI) / 2);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
  }, [image, turn]);
  async function recognize() {
    if (!canvas.current || busy) return;
    if (crop.right - crop.left < 20 || crop.bottom - crop.top < 20) {
      setError("裁剪区域过小");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const source = canvas.current,
        out = document.createElement("canvas");
      out.width = Math.round((source.width * (crop.right - crop.left)) / 100);
      out.height = Math.round((source.height * (crop.bottom - crop.top)) / 100);
      out
        .getContext("2d")!
        .drawImage(
          source,
          (source.width * crop.left) / 100,
          (source.height * crop.top) / 100,
          out.width,
          out.height,
          0,
          0,
          out.width,
          out.height,
        );
      const blob = await new Promise<Blob>((resolve, reject) =>
        out.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("图片处理失败"))),
          "image/jpeg",
          0.9,
        ),
      );
      const result = await api.request<RecognitionResult>(BASE + "/recognize", {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: blob,
      });
      if (alive.current) onRecognized(result);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="authoring-overlay">
      <section className="authoring-sheet">
        <h3>裁剪到单个棋盘</h3>
        <div className="authoring-photo-preview">
          <canvas ref={canvas} />
          <div
            className="crop-outline"
            style={{
              left: `${crop.left}%`,
              top: `${crop.top}%`,
              right: `${100 - crop.right}%`,
              bottom: `${100 - crop.bottom}%`,
            }}
          />
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setTurn((n) => (n + 1) % 4);
            setCrop({ left: 0, top: 0, right: 100, bottom: 100 });
          }}
        >
          旋转90°
        </button>
        {(["left", "top", "right", "bottom"] as const).map((k, i) => (
          <label key={k}>
            {["左边界", "上边界", "右边界", "下边界"][i]}
            <input
              disabled={busy}
              type="range"
              min={0}
              max={100}
              value={crop[k]}
              onChange={(e) =>
                setCrop((old) => ({ ...old, [k]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          disabled={busy || !image}
          onClick={() => void recognize()}
        >
          {busy ? "正在识别，请稍候…" : "识别并核对棋子"}
        </button>
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
      </section>
    </div>
  );
}

function AssignmentSheet({
  api,
  scopeKey,
  orgName,
  directory,
  items,
  onClose,
  onAssigned,
}: {
  api: AuthoringApi;
  scopeKey: string;
  orgName: string;
  directory: AuthoringDirectory;
  items: AuthoredQuestion[];
  onClose(): void;
  onAssigned(id: string): void;
}) {
  type Recipient = { id: string; displayName: string; loginName: string };
  type Class = { id: string; name: string; students: Recipient[] };
  const [classes, setClasses] = useState<Class[]>([]),
    [classIds, setClassIds] = useState<string[]>([]),
    [studentIds, setStudentIds] = useState<string[]>([]),
    [title, setTitle] = useState(directory.title),
    [start, setStart] = useState(""),
    [due, setDue] = useState(""),
    [minutes, setMinutes] = useState(""),
    [attempts, setAttempts] = useState(0),
    [allowAnswer, setAllowAnswer] = useState(false),
    [randomize, setRandomize] = useState(false),
    [batchMode, setBatchMode] = useState("none"),
    [batchValue, setBatchValue] = useState(20),
    [stage, setStage] = useState<1 | 2>(1),
    [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [completed, setCompleted] = useState(0),
    [rejected, setRejected] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    plans = useRef<
      { key: string; body: Record<string, unknown>; id?: string }[] | undefined
    >(undefined),
    storageKey = `qixi.authoring-publish:${scopeKey}:${directory.id}`;
  useEffect(() => {
    alive.current = true;
    let mounted = true;
    void api
      .classes()
      .then(async (rows) => {
        const result = await Promise.all(
          rows.map(async (row) => ({
            ...row,
            students: await api.students(row.id),
          })),
        );
        if (mounted) setClasses(result);
      })
      .catch((e) => {
        if (mounted) setError(message(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.length) {
        plans.current = saved;
        setCompleted(saved.filter((v: { id?: string }) => v.id).length);
        setConfirming(true);
      }
    } catch {}
    return () => {
      mounted = false;
      alive.current = false;
    };
  }, []);
  const students = [
    ...new Map(
      classes.flatMap((c) => c.students).map((s) => [s.id, s]),
    ).values(),
  ];
  const recipients = new Set([
    ...studentIds,
    ...classes
      .filter((c) => classIds.includes(c.id))
      .flatMap((c) => c.students.map((s) => s.id)),
  ]);
  const invalid = items.filter((q) => !assignable(q));
  function toggle(id: string, values: string[], set: (v: string[]) => void) {
    set(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  }
  function prepare(): boolean {
    if (!items.length) {
      setError("目录里还没有题目，请先添加题目");
      return false;
    }
    setError("");
    if (invalid.length) {
      setError("所选题目包含草稿或已下架题，请返回完善答案或明确取消选择。");
      return false;
    }
    if (!title.trim() || !recipients.size) {
      setError("请填写标题，并明确选择班级或学生");
      return false;
    }
    if (due && new Date(due) <= (start ? new Date(start) : new Date())) {
      setError("截止时间必须晚于开始时间");
      return false;
    }
    if (
      minutes &&
      (!Number.isInteger(Number(minutes)) || Number(minutes) < 1)
    ) {
      setError("作答时长须为正整数分钟");
      return false;
    }
    if (
      batchMode !== "none" &&
      (!Number.isInteger(batchValue) || batchValue < 1)
    ) {
      setError("分批数量须为正整数");
      return false;
    }
    return true;
  }
  async function submit(publishNow = true) {
    if (lock.current) return;
    lock.current = true;
    setConfirming(true);
    setBusy(true);
    setError("");
    setRejected(false);
    try {
      if (!plans.current) {
        const batches =
          batchMode === "none"
            ? [items]
            : batchMode === "size"
              ? splitAssignments(items, batchValue)
              : Array.from(
                  { length: Math.min(batchValue, items.length) },
                  (_, i) =>
                    items.slice(
                      Math.floor(
                        (i * items.length) / Math.min(batchValue, items.length),
                      ),
                      Math.floor(
                        ((i + 1) * items.length) /
                          Math.min(batchValue, items.length),
                      ),
                    ),
                );
        plans.current = batches.map((batch, i) => ({
          key: crypto.randomUUID(),
          body: {
            title:
              title.trim() +
              (batches.length > 1 ? ` 第${i + 1}/${batches.length}批` : ""),
            problemIds: batch.map((q) => q.publishedProblemId),
            expectedProblemVersions: Object.fromEntries(
              batch
                .filter((q) => q.contentFingerprint)
                .map((q) => [q.publishedProblemId, q.contentFingerprint]),
            ),
            classIds,
            studentIds,
            publishAt: start ? new Date(start).toISOString() : null,
            dueAt: due ? new Date(due).toISOString() : null,
            timeLimitSeconds: minutes ? Number(minutes) * 60 : null,
            maxAttempts: attempts,
            allowAnswer,
            randomizeItems: randomize,
            publishNow,
          },
        }));
        localStorage.setItem(storageKey, JSON.stringify(plans.current));
      }
      for (const plan of plans.current) {
        if (plan.id) continue;
        const result = await api.request<{ id: string }>(
          "/api/v1/admin/assignments",
          { ...json(plan.body), headers: { "idempotency-key": plan.key } },
        );
        plan.id = result.id;
        localStorage.setItem(storageKey, JSON.stringify(plans.current));
        if (!alive.current) return;
        setCompleted(plans.current.filter((p) => p.id).length);
      }
      const first = plans.current[0]?.id;
      localStorage.removeItem(storageKey);
      if (alive.current && first) onAssigned(first);
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        const status = (e as { status?: number })?.status;
        setRejected(
          status === 400 ||
            status === 422 ||
            (status === 409 && !message(e).includes("同一发布请求")),
        );
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        lock.current = false;
      }
    }
  }
  function correctRejected() {
    const successful = plans.current?.filter((p) => p.id) || [];
    localStorage.removeItem(storageKey);
    plans.current = undefined;
    setRejected(false);
    if (successful.length) {
      // The failed and later batches never committed. Keep already published work.
      onAssigned(successful[0].id!);
    } else {
      setConfirming(false);
      setError("");
    }
  }
  const frozen = plans.current;
  return (
    <div className="authoring-overlay">
      <section className="authoring-sheet authoring-assignment">
        <h3>布置作业</h3>
        <p>
          {orgName} · {directory.title} · {items.length}题
        </p>
        {error && (
          <p role="alert" className="authoring-error">
            {error}
          </p>
        )}
        {invalid.length > 0 && (
          <p role="alert">
            不可布置：
            {invalid
              .map((q) => `${q.body.title}（${names[q.status]}）`)
              .join("、")}
            。请先补全并发布题目，或返回取消选择。
          </p>
        )}
        {confirming ? (
          <>
            <h4>继续上次提交</h4>
            {frozen ? (
              <p>
                上次发布已完成 {completed}/{frozen.length}{" "}
                批。继续会使用原题目、学生和时间，避免重复布置。
              </p>
            ) : (
              <>
                <p>
                  {title} · {items.length}题 · {recipients.size}名学生
                </p>
                <p>
                  开始：{start || "立即"}
                  <br />
                  截止：{due || "不限制"}
                </p>
                <p>
                  {randomize ? "随机题序" : "按目录顺序"}
                  {batchMode !== "none"
                    ? ` · ${batchMode === "size" ? "每批" : "分为"}${batchValue}${batchMode === "size" ? "题" : "批"}`
                    : ""}
                </p>
              </>
            )}
            <button
              className="primary"
              disabled={busy || loading || (!frozen && !!invalid.length)}
              onClick={() => void submit()}
            >
              {busy
                ? `正在发布（已完成${completed}批）…`
                : frozen
                  ? frozen[0]?.body.publishNow === false ? "继续保存草稿" : "继续发布"
                  : "确认发布给学生"}
            </button>
            {frozen && rejected && (
              <>
                <p>
                  服务器已明确拒绝当前批次，后续批次尚未发送。已发布的作业会保留。
                </p>
                <button disabled={busy} onClick={correctRejected}>
                  {completed ? "取消剩余批次，查看已发布作业" : "返回修改"}
                </button>
              </>
            )}
            {!frozen && (
              <button disabled={busy} onClick={() => setConfirming(false)}>
                返回修改
              </button>
            )}
          </>
        ) : stage === 1 ? (
          <>
            <h4>1 / 2 · 选择学生</h4>
            <fieldset>
              <legend>选择班级</legend>
              {classes.map((c) => (
                <label className="authoring-check" key={c.id}>
                  <input
                    type="checkbox"
                    checked={classIds.includes(c.id)}
                    onChange={() => toggle(c.id, classIds, setClassIds)}
                  />
                  {c.name}（{c.students.length}人）
                </label>
              ))}
            </fieldset>
            <details>
              <summary>单独选择学生 · 已选去重 {recipients.size} 人</summary>
              {students.map((s) => (
                <label className="authoring-check" key={s.id}>
                  <input
                    type="checkbox"
                    checked={studentIds.includes(s.id)}
                    onChange={() => toggle(s.id, studentIds, setStudentIds)}
                  />
                  {s.displayName} · {s.loginName}
                </label>
              ))}
            </details>
            {loading && <p>正在读取班级和学生…</p>}
            <p className="authoring-recipient-count">已选去重 {recipients.size} 人</p>
            <button className="primary" disabled={busy || loading || !recipients.size} onClick={() => {setError("");setStage(2);}}>下一步 · 设置并核对</button>
          </>
        ) : (
          <>
            <h4>2 / 2 · 设置并核对</h4>
            <label>
              作业标题
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={255}
              />
            </label>
            <label>
              开始时间（留空立即）
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              截止时间（可选）
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <details>
              <summary>更多设置</summary>
              <label>
                作答时长（分钟，留空不限）
                <input
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              <label>
                尝试次数（0为不限）
                <input
                  type="number"
                  min={0}
                  value={attempts}
                  onChange={(e) => setAttempts(Number(e.target.value))}
                />
              </label>
              <label className="authoring-check">
                <input
                  type="checkbox"
                  checked={allowAnswer}
                  onChange={(e) => setAllowAnswer(e.target.checked)}
                />
                允许查看答案
              </label>
              <label className="authoring-check">
                <input
                  type="checkbox"
                  checked={randomize}
                  onChange={(e) => setRandomize(e.target.checked)}
                />
                随机题序
              </label>
              <label>
                分批方式
                <select
                  value={batchMode}
                  onChange={(e) => setBatchMode(e.target.value)}
                >
                  <option value="none">不分批</option>
                  <option value="size">按每批题数</option>
                  <option value="count">按批次数</option>
                </select>
              </label>
              {batchMode !== "none" && (
                <input
                  aria-label="分批数量"
                  type="number"
                  min={1}
                  max={1000}
                  value={batchValue}
                  onChange={(e) => setBatchValue(Number(e.target.value))}
                />
              )}
            </details>
            <section className="authoring-assignment-summary" aria-label="发布摘要">
              <strong>{title || "未填写标题"}</strong>
              <span>{orgName} · {items.length} 题 · {recipients.size} 名学生</span>
              <span>开始：{start || "立即"} · 截止：{due || "不限制"}</span>
              <span>{randomize ? "随机题序" : "按目录顺序"}{batchMode !== "none" ? ` · 分批 ${batchValue}` : ""}</span>
            </section>
            <div className="authoring-assignment-actions">
              <button disabled={busy} onClick={() => setStage(1)}>上一步</button>
              <button disabled={busy || loading || !!invalid.length} onClick={() => {if(prepare())void submit(false);}}>保存草稿</button>
              <button className="primary" disabled={busy || loading || !!invalid.length} onClick={() => {if(prepare())void submit(true);}}>确认发布给学生</button>
            </div>
          </>
        )}
        <button disabled={busy} onClick={onClose}>
          {frozen ? "稍后继续" : "返回目录"}
        </button>
      </section>
    </div>
  );
}
