import { useEffect, useState } from "react";
import { Activity, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, EyeOff, Save, Swords, X } from "lucide-react";
import { TemporaryCalculationBoard } from "./TemporaryCalculationBoard";
import { chessPlatform, type AnalysisLine, type BookTopicDetail, type FlyknifePlan, type PreviewLineStep } from "./platform";
import type { BookLessonNode } from "./platform/types";

const STARTING_FEN = "rnbakabnr/9/1c5c1/p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

type Props = { onClose(): void; onOpenMasterGame(gameId: string): Promise<void>; onPlanSaved(plan: FlyknifePlan): void; enginePath: string; threads: number; hashMb: number; onOpenEngineSettings(): void };
type TrainingBase = { fen: string; pieces: PreviewLineStep["pieces"]; side: "红方" | "黑方"; expectedFirstMove?: string };

function pieceAsset(piece: { color: string; kind: string }) {
  const code: Record<string, string> = { king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p" };
  return `/skins/default/${piece.color === "red" ? "r" : "b"}${code[piece.kind] ?? "p"}.png`;
}

function score(line: AnalysisLine) { return line.mate != null ? `杀 ${line.mate}` : line.scoreCp == null ? "无分值" : `${line.scoreCp > 0 ? "+" : ""}${(line.scoreCp / 100).toFixed(2)} 分`; }
function tabLabel(lesson: BookLessonNode) { return lesson.lessonKind === "flyknife" ? "飞刀" : lesson.lessonKind === "trap" ? "陷阱" : "拆棋"; }
function focusSummary(lesson: BookLessonNode, detail: BookTopicDetail) {
  if (lesson.lessonKind === "flyknife") return { goal: detail.teaching.knife, lure: "不兑车立中，迫使黑方同时顾及中路和右翼。", risk: "过早兑车会消解红方保留的战术张力。" };
  if (lesson.lessonKind === "trap") return { goal: "识别黑方贪攻后的反击点，算清多子变化。", lure: "马7进6看似先手进攻，实际暴露后方协调。", risk: "只看黑方表面威胁，容易错过红车横移与中兵推进。" };
  return { goal: "在卒7进1后继续扩张空间，把压力变成连续先手。", lure: detail.teaching.lure, risk: "若只守住眼前线路，黑方会完成子力协调。" };
}

export function Game53StudyDialog({ onClose, onOpenMasterGame, onPlanSaved, enginePath, threads, hashMb, onOpenEngineSettings }: Props) {
  const [detail, setDetail] = useState<BookTopicDetail>(); const [steps, setSteps] = useState<PreviewLineStep[]>([]); const [lessonIndex, setLessonIndex] = useState(0);
  const [userMoves, setUserMoves] = useState<string[]>([]); const [userSteps, setUserSteps] = useState<PreviewLineStep[]>([]); const [revealed, setRevealed] = useState(false);
  const [engineLines, setEngineLines] = useState<AnalysisLine[]>([]); const [bookEngineLine, setBookEngineLine] = useState<AnalysisLine>(); const [variation, setVariation] = useState<{ steps: PreviewLineStep[]; notes: string[] }>(); const [variationStep, setVariationStep] = useState(0);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("正在载入洪智对黄仕清的完整实战…");
  const [trainingBase, setTrainingBase] = useState<TrainingBase>();

  useEffect(() => {
    let disposed = false;
    void chessPlatform.getBookTopicDetail("book-game-53-hong-zhi-huang-shiqing").then(async (value) => {
      if (!value) throw new Error("第53局专题资源不存在"); const line = await chessPlatform.previewLine(STARTING_FEN, value.mainline);
      if (!disposed) { setDetail(value); setSteps(line); setNotice(`已载入公开大师库原局：${line.length} 半回合。`); }
    }).catch((error) => !disposed && setNotice(error instanceof Error ? error.message : String(error)));
    return () => { disposed = true; };
  }, []);

  const lessons = detail?.lessonNodes ?? []; const lesson = lessons[lessonIndex]; const lessonStep = steps[lesson?.ply ? lesson.ply - 1 : -1];
  const sourceFen = lessonStep?.fen ?? STARTING_FEN;
  const baseFen = trainingBase?.fen ?? sourceFen; const basePieces = trainingBase?.pieces ?? lessonStep?.pieces ?? []; const baseSide = trainingBase?.side ?? (baseFen.split(/\s+/)[1] === "b" ? "黑方" : "红方");
  const summary = lesson && detail ? focusSummary(lesson, detail) : undefined; const answerCorrect = revealed && userMoves[0] === (trainingBase?.expectedFirstMove ?? lesson?.targetVariation ?? lesson?.practiceLine)?.[0];

  useEffect(() => {
    let disposed = false;
    if (!lesson || !lessonStep) return () => { disposed = true; };
    void (async () => {
      let position = lessonStep;
      let expectedFirstMove = lesson.targetVariation?.[0] ?? lesson.practiceLine?.[0];
      if (lesson.preludeNotation?.length) {
        const prelude = await chessPlatform.parseChineseLine(lessonStep.fen, lesson.preludeNotation);
        position = prelude.steps.at(-1) ?? lessonStep;
        if (lesson.bookFirstMove) expectedFirstMove = (await chessPlatform.parseChineseLine(position.fen, [lesson.bookFirstMove])).moves[0];
      }
      if (!disposed) setTrainingBase({ fen: position.fen, pieces: position.pieces, side: position.fen.split(/\s+/)[1] === "b" ? "黑方" : "红方", expectedFirstMove });
    })().catch((error) => !disposed && setNotice(error instanceof Error ? `训练局面无法载入：${error.message}` : String(error)));
    return () => { disposed = true; };
  }, [lesson, lessonStep]);

  function selectLesson(index: number) { setLessonIndex(index); setTrainingBase(undefined); setUserMoves([]); setUserSteps([]); setRevealed(false); setEngineLines([]); setBookEngineLine(undefined); setVariation(undefined); setVariationStep(0); setNotice("先检查威胁和强制手段，再在棋盘落子推演 2 至 8 个半回合。"); }
  function submit() { if (userMoves.length < 2) { setNotice("请先在棋盘连续推演至少 2 个半回合，再提交核对。"); return; } setRevealed(true); setNotice("已揭示书载答案。可查看完整变化，或按需用 Pikafish 比较最佳防守。"); }

  async function loadBookVariation() {
    if (!lesson) return; setBusy(true); setNotice("正在校验并载入书中完整变化…");
    try {
      const parsed = lesson.variationNotation?.length ? await chessPlatform.parseChineseLine(sourceFen, lesson.variationNotation) : { steps: await chessPlatform.previewLine(sourceFen, lesson.practiceLine ?? []) };
      if (parsed.steps.length === 0) throw new Error("该学习节点暂无可回放的书中变化"); setVariation({ steps: parsed.steps, notes: lesson.variationNotes ?? [] }); setVariationStep(1); setNotice("书中变化已加载。逐步阅读每着的目的与风险。");
    } catch (error) { setNotice(error instanceof Error ? `书中变例无法回放：${error.message}` : String(error)); } finally { setBusy(false); }
  }
  async function verifyEngine() {
    if (!revealed) { setNotice("请先提交你的推演，再查看 Pikafish 最佳防守。"); return; }
    if (!enginePath || !lesson) { setNotice("请先在引擎设置中确认 Pikafish 路径，再复核此节点。"); return; } setBusy(true); setNotice("Pikafish 正在比较书载应对与最佳防守…");
    try {
      const options = { enginePath, fen: baseFen, searchMode: "depth" as const, searchValue: 20, threads, hashMb, serverUrl: "", token: "" };
      const [best, book] = await Promise.all([
        chessPlatform.analyze({ ...options, multipv: 3 }),
        trainingBase?.expectedFirstMove ? chessPlatform.analyze({ ...options, multipv: 1, searchMoves: [trainingBase.expectedFirstMove] }) : Promise.resolve([]),
      ]);
      setEngineLines(best); setBookEngineLine(book[0]); setNotice("优化对比完成。引擎结论与书载结论分别显示。");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function savePractice() {
    if (!lesson) return;
    try {
      const plan = await chessPlatform.saveFlyknifePlan({ title: `第53局 · ${tabLabel(lesson)}训练`, side: "red", startingFen: baseFen, templateName: "洪智 vs 黄仕清，第53局", lureMove: userMoves[0] ?? "", knifeMove: lesson.practiceLine?.[0] ?? "", mainline: userMoves, bestDefense: [], risk: summary?.risk ?? "原书飞刀与陷阱学习节点。", note: `${lesson.prompt}\n我的推演：${userSteps.map((step) => step.notation).join(" ")}\n书载答案：${lesson.answer}\n${lesson.explanation}` }); onPlanSaved(plan); setNotice("已保存到本地飞刀练习库。");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  return <div className="modal-backdrop" role="presentation"><section className="game53-study-dialog" role="dialog" aria-modal="true" aria-label="第53局飞刀陷阱拆棋训练台">
    <header><span><Swords size={18}/><strong>第53局训练台</strong><small>洪智 vs 黄仕清 · 1998 全国个人赛</small></span><button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button></header>
    {!detail || !lesson ? <p className="game53-notice">{notice}</p> : <div className="game53-study-layout">
      <section className="game53-board-column"><header><strong>{tabLabel(lesson)}临时训练棋盘</strong><small>{revealed ? "答案已揭示" : <><b>答案已隐藏</b> · {baseSide}走</>}</small></header>
        <TemporaryCalculationBoard key={lesson.id} baseFen={baseFen} basePieces={basePieces} baseSideToMove={baseSide} onPreview={(moves) => chessPlatform.previewLine(baseFen, moves)} pieceAsset={pieceAsset} boardAsset="/skins/default/board.png" boardAriaLabel="第53局临时训练棋盘" disabled={!trainingBase || revealed || busy} referenceStep={variation?.steps[variationStep - 1]} onLineChange={(moves, nextSteps) => { setUserMoves(moves); setUserSteps(nextSteps); setRevealed(false); }}/>
      </section>
      <section className="game53-learning-column"><nav className="game53-lessons" aria-label="飞刀陷阱拆棋训练标签">{lessons.map((item, index) => <button key={item.id} className={index === lessonIndex ? "active" : ""} onClick={() => selectLesson(index)}>{tabLabel(item)}</button>)}</nav>
        <article className={`game53-focus ${lesson.lessonKind ?? "practicalDefense"}`}><small>{tabLabel(lesson)} · 思考入口</small><strong>{lesson.prompt}</strong><ol>{(lesson.thinkingHints ?? ["先检查对方下一步的直接威胁。", "扫描将军、吃子、捉双与强制兑子。", "列出候选着，选定主变化后在棋盘落子。"]).map((hint) => <li key={hint}>{hint}</li>)}</ol><p><b>训练目标：</b>{summary?.goal}</p><div className="game53-focus-actions"><button className="primary" disabled={busy || revealed} onClick={submit}><CheckCircle2 size={14}/>提交核对</button>{revealed && <button disabled={busy} onClick={() => void verifyEngine()}><Activity size={14}/>查看优化</button>}</div></article>
        <div className="game53-learning-scroll">{!revealed ? <article className="game53-card game53-answer-hidden"><EyeOff size={15}/><div><small>先思考后揭示</small><strong>在左侧棋盘连续推演 2 至 8 个半回合。</strong><p>提交前不显示书载首着、完整变化或引擎候选线。</p></div></article> : <>
          <article className={answerCorrect ? "game53-card game53-result correct" : "game53-card game53-result"}><small>我的作答</small><strong>{answerCorrect ? "首着命中书载答案" : "首着与书载答案不同"}</strong><p><b>你的首着：</b>{userSteps[0]?.notation ?? "未记录"}</p><p><b>你的推演：</b>{userSteps.map((step) => step.notation).join(" ") || "未记录"}</p></article>
          <article className="game53-card"><small>书载答案与拆解</small><strong>{lesson.answer}</strong><p>{lesson.explanation}</p><p><b>诱导条件：</b>{summary?.lure}</p><p><b>关键风险：</b>{summary?.risk}</p><button className="primary" disabled={busy} onClick={() => void loadBookVariation()}><Swords size={14}/>查看完整书载变化</button></article>
          {variation && <article className="game53-card game53-variation"><small>书中逐步变化 · {variationStep}/{variation.steps.length}</small><strong>{variation.steps[variationStep - 1]?.movedBy}{variation.steps[variationStep - 1]?.notation}</strong><p>{variation.notes[variationStep - 1] ?? "观察这一步如何延续前一阶段的压力。"}</p><div><button disabled={variationStep <= 1} onClick={() => setVariationStep((value) => value - 1)}><ChevronLeft size={14}/>上一步</button><button disabled={variationStep >= variation.steps.length} onClick={() => setVariationStep((value) => value + 1)}>下一步<ChevronRight size={14}/></button></div></article>}</>}
          {revealed && <article className="game53-card"><small>优化：Pikafish 最佳防守</small><p><b>书载应对：</b>{lesson.answer}{bookEngineLine && ` · ${score(bookEngineLine)}`}</p>{!enginePath && <p className="answer">尚未配置本地 Pikafish。<button onClick={onOpenEngineSettings}>打开引擎设置</button></p>}{enginePath && <button disabled={busy} onClick={() => void verifyEngine()}><Activity size={14}/>{busy ? "复核中…" : "比较书载与最佳防守"}</button>}{engineLines.length > 0 && <><p><b>局面分变化：</b>{bookEngineLine?.scoreCp != null && engineLines[0]?.scoreCp != null ? `${((engineLines[0].scoreCp - bookEngineLine.scoreCp) / 100).toFixed(2)} 分` : "引擎未返回可比较分值"}</p><div className="game53-engine-lines">{engineLines.map((line) => <p key={line.multipv}><b>{line.multipv}. {line.notation?.[0] ?? line.pv[0]}</b><span>{score(line)}</span><small>{line.notation?.join(" ")}</small></p>)}</div></>}</article>}
          <details className="game53-book-source"><summary>查看原书图、文字与完整实战核验</summary><p>{detail.rawTranscript}</p>{detail.images[0] && <img className="game53-book-image" src={detail.images[0]} alt="布局飞刀集图53原书页"/>}</details>
        </div><footer><button disabled={userMoves.length === 0} onClick={() => void savePractice()}><Save size={14}/>保存练习</button><button onClick={() => void onOpenMasterGame(detail.masterGameId ?? "dpxq-m-6008")}><BookOpen size={14}/>完整实战回看</button></footer><p className="game53-notice" aria-live="polite">{notice}</p>
      </section>
    </div>}
  </section></div>;
}
