import { useEffect, useRef, useState } from "react";
import { teachingClient, type TeacherPracticeProblem, type TeacherProblemLibrary, type TeacherProblem, type TeachingAuth } from "./teaching";
import type { BoardPiece, BoardState, SolutionMove } from "./types";
import type { TeacherPracticeBoardRenderer } from "./TeacherAssignmentPractice";
import { boardAt } from "./wasm";

const codes: Record<string, string> = { king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p" };
const palette = ["king", "advisor", "elephant", "horse", "rook", "cannon", "pawn"];
const labels = { red: ["帅", "仕", "相", "马", "车", "炮", "兵"], black: ["将", "士", "象", "马", "车", "炮", "卒"] };
function fenFor(pieces: BoardPiece[], side: string) {
  return Array.from({ length: 10 }, (_, row) => {
    let output = "", empty = 0;
    for (let col = 0; col < 9; col++) {
      const piece = pieces.find(p => p.row === row && p.col === col);
      if (!piece) { empty++; continue; }
      if (empty) { output += empty; empty = 0; }
      const code = codes[piece.kind]; output += piece.color === "red" ? code.toUpperCase() : code;
    }
    return output + (empty || "");
  }).join("/") + ` ${side} - - 0 1`;
}
export function TeacherProblemEditor({ assignmentId, problem, auth, renderBoard, trialMoves, onChanged, onClose }: {
  assignmentId: string; problem: TeacherPracticeProblem; auth: TeachingAuth; renderBoard: TeacherPracticeBoardRenderer;
  trialMoves: string[]; onChanged(): Promise<void>; onClose(): void;
}) {
  const draftKey = `qixi-teacher-edit-v1:${teachingClient.serverUrl()}:${auth.user.id}:${auth.user.orgId}:${assignmentId}:${problem.problemId}`;
  const [draft, setDraft] = useState(() => {
    const initial = { title: problem.title, note: problem.note, fen: problem.startingFen, answer: JSON.stringify(problem.solution, null, 2) };
    try { const saved = JSON.parse(localStorage.getItem(draftKey) || "null"); return saved && Object.keys(initial).every(k => typeof saved[k] === "string") ? saved as typeof initial : initial; } catch { return initial; }
  });
  const [board, setBoard] = useState<BoardState>();
  const [tool, setTool] = useState<Pick<BoardPiece,"color"|"kind"|"label"> | "erase">("erase");
  const [error, setError] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const [libraries, setLibraries] = useState<TeacherProblemLibrary[]>([]); const [library, setLibrary] = useState("");
  const [q, setQ] = useState(""); const [choices, setChoices] = useState<TeacherProblem[]>([]); const [cursor, setCursor] = useState<string | null>();
  const [replacement, setReplacement] = useState(""); const [reason, setReason] = useState("");
  const alive = useRef(true); const previewRequest = useRef(0); const searchRequest = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; ++previewRequest.current; ++searchRequest.current; }; }, []);
  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { setStatus("编辑草稿未能保存到本机，请保持此页面打开。"); }
    const request = ++previewRequest.current;
    void boardAt(draft.fen, []).then(next => { if (previewRequest.current === request && alive.current) setBoard(next); }).catch(() => { /* Keep the board while a FEN is being edited. Server validates before saving. */ });
  }, [draft, draftKey]);
  const field = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));
  async function act(action: string, extra: Record<string,unknown> = {}) {
    if (busy) return;
    setBusy(true); setError(""); setStatus("");
    try {
      await teachingClient.changeTeacherProblem(assignmentId, problem, { action, ...extra }, auth);
      if (!alive.current) return;
      if (action === "report") { setStatus("公共原题纠错已提交，管理员可在操作审计中查看。"); return; }
      localStorage.removeItem(draftKey);
      await onChanged();
    } catch (e) { if (alive.current) setError(`${e instanceof Error ? e.message : "操作失败"}；若请求中断，请返回刷新确认题目状态。`); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save() {
    let solution: SolutionMove[];
    try { solution = JSON.parse(draft.answer); if (!Array.isArray(solution)) throw new Error(); }
    catch { setError("答案格式无效，请保留数组格式，或使用试走路线生成答案。"); return; }
    if (!window.confirm(problem.withdrawn ? "仅保存本次作业的修订，题目仍保持撤回。确认？" : "修改只影响本次作业，此题将以新版本重发，需要学生重新作答；旧答题记录保留。确认？")) return;
    await act("edit", { title: draft.title, note: draft.note, startingFen: draft.fen, solution });
  }
  async function search(more = false) {
    const request = ++searchRequest.current; setError("");
    try {
      let nextLibrary = library;
      if (!nextLibrary) { const rows = await teachingClient.teacherProblemLibraries("", auth); if (!alive.current || searchRequest.current !== request) return; setLibraries(rows); nextLibrary = rows[0]?.id || ""; setLibrary(nextLibrary); }
      if (!nextLibrary) { setError("没有可替换的题库。"); return; }
      const page = await teachingClient.teacherProblems(nextLibrary, { q, cursor: more ? cursor ?? undefined : undefined }, auth);
      if (!alive.current || searchRequest.current !== request) return;
      setChoices(previous => more ? [...previous, ...page.items] : page.items); setCursor(page.nextCursor);
    } catch (e) { if (alive.current && searchRequest.current === request) setError(e instanceof Error ? e.message : "读取失败"); }
  }
  return <section className="teacher-problem-editor" aria-label="修改本次作业题目">
    <header><h3>{problem.withdrawn ? "编辑已撤回题目" : "修改本次作业题目"}</h3><button type="button" disabled={busy} onClick={onClose}>返回试做（保留草稿）</button></header>
    <p>只修改本次作业，公共原题和学生旧记录保留。保存后由学生刷新作业读取新版。</p>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <label>题目名称<input value={draft.title} maxLength={255} disabled={busy} onChange={e => field("title", e.target.value)}/></label>
    <label>题目说明<textarea aria-label="题目说明" value={draft.note} disabled={busy} onChange={e => field("note",e.target.value)}/></label>
    <fieldset disabled={busy}><legend>初始棋盘</legend>
      <p>选择棋子后点击棋盘摆放；选择“移除棋子”后点击要移除的位置。</p>
      <div className="teacher-edit-palette">{(["red","black"] as const).map(color => palette.map((kind,i) => <button type="button" key={color+kind} aria-pressed={tool !== "erase" && tool.color === color && tool.kind === kind} onClick={() => setTool({ color, kind, label: labels[color][i] })}>{color === "red" ? "红" : "黑"}{labels[color][i]}</button>))}<button type="button" aria-pressed={tool === "erase"} onClick={() => setTool("erase")}>移除棋子</button></div>
      {board && renderBoard(board,undefined,undefined,undefined,square => {
        const pieces = board.pieces.filter(p => p.row !== square.row || p.col !== square.col);
        if (tool !== "erase") pieces.push({ ...tool, ...square });
        const fen = fenFor(pieces, board.fen.split(/\s+/)[1] || "w");
        setBoard({ ...board, pieces, fen }); field("fen",fen);
      }, () => {}, true)}
      <label>先行方<select value={draft.fen.split(/\s+/)[1] || "w"} onChange={e => field("fen", board ? fenFor(board.pieces,e.target.value) : draft.fen)}><option value="w">红方</option><option value="b">黑方</option></select></label>
      <details><summary>编辑 FEN</summary><label>初始局面 FEN<textarea aria-label="初始局面 FEN" value={draft.fen} onChange={e => field("fen",e.target.value)}/></label></details>
    </fieldset>
    <fieldset disabled={busy}><legend>答案与分支</legend>
      <p>可使用试走路线生成主线；已有分支会保留在下方答案中。保存时检查全部走法是否合法。</p>
      <button type="button" disabled={!trialMoves.length} onClick={() => {
        if (!window.confirm("使用当前试走路线替换全部答案和分支？")) return;
        let tree: SolutionMove[] = []; for (const iccs of [...trialMoves].reverse()) tree = [{ iccs, comment: "", children: tree }]; field("answer",JSON.stringify(tree,null,2));
      }}>使用试走路线作为答案</button>
      <label>答案 JSON（iccs 为走法，comment 为说明，children 为后续分支）<textarea aria-label="答案 JSON" className="teacher-answer-json" value={draft.answer} onChange={e => field("answer",e.target.value)}/></label>
    </fieldset>
    <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : problem.withdrawn ? "保存修订（保持撤回）" : "保存修订并重发本题"}</button>
    <details><summary>替换指定题</summary>
      <button type="button" disabled={busy} onClick={() => void search()}>读取可替换题库</button>
      <label>题库<select value={library} onChange={e => { ++searchRequest.current; setLibrary(e.target.value); setChoices([]); setReplacement(""); setCursor(null); }}>{libraries.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>搜索替换题<input value={q} onChange={e => { ++searchRequest.current; setQ(e.target.value); setReplacement(""); }}/></label><button type="button" disabled={busy} onClick={() => void search()}>搜索题目</button>
      <div className="teacher-replacement-list">{choices.map(item => <label key={item.id}><input type="radio" name="replacement" checked={replacement === item.id} onChange={() => setReplacement(item.id)}/>{item.title}</label>)}</div>
      {cursor && <button type="button" disabled={busy} onClick={() => void search(true)}>加载更多题目</button>}
      <button type="button" disabled={busy || !replacement} onClick={() => { if (window.confirm("用所选题替换本题？学生需重新作答，旧记录保留。")) void act("replace", { replacementProblemId: replacement }); }}>替换本题</button>
    </details>
    <button type="button" disabled={busy} onClick={() => { if (window.confirm(problem.withdrawn ? "重发本题供学生重新作答？旧记录保留。" : "只撤回这道题？学生将不能再提交本题，旧记录保留。")) void act(problem.withdrawn ? "restore" : "withdraw"); }}>{problem.withdrawn ? "重发本题" : "撤回本题"}</button>
    <details><summary>公共原题提交纠错</summary><label>纠错说明<textarea aria-label="纠错说明" value={reason} onChange={e => setReason(e.target.value)}/></label><button type="button" disabled={busy || !reason.trim()} onClick={() => void act("report", { reason })}>提交公共原题纠错</button></details>
  </section>;
}
