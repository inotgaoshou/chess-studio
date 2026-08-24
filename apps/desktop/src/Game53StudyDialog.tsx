import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, ChevronLeft, ChevronRight, Save, Swords, X } from "lucide-react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { chessPlatform, type AnalysisLine, type BookTopicDetail, type FlyknifePlan, type PreviewLineStep } from "./platform";

const STARTING_FEN = "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1";

type Props = {
  onClose(): void;
  onOpenMasterGame(gameId: string): Promise<void>;
  onPlanSaved(plan: FlyknifePlan): void;
  enginePath: string;
  threads: number;
  hashMb: number;
  onOpenEngineSettings(): void;
};

function pieceAsset(piece: { color: string; kind: string }) {
  const code: Record<string, string> = { king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p" };
  return `/skins/default/${piece.color === "red" ? "r" : "b"}${code[piece.kind] ?? "p"}.png`;
}

function score(line: AnalysisLine) {
  if (line.mate != null) return `杀 ${line.mate}`;
  return line.scoreCp == null ? "无分值" : `${line.scoreCp > 0 ? "+" : ""}${line.scoreCp}`;
}

export function Game53StudyDialog({ onClose, onOpenMasterGame, onPlanSaved, enginePath, threads, hashMb, onOpenEngineSettings }: Props) {
  const [detail, setDetail] = useState<BookTopicDetail>();
  const [steps, setSteps] = useState<PreviewLineStep[]>([]);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [viewedPly, setViewedPly] = useState<number>();
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [engineLines, setEngineLines] = useState<AnalysisLine[]>([]);
  const [variation, setVariation] = useState<{ steps: PreviewLineStep[]; notes: string[] }>();
  const [variationStep, setVariationStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("正在载入洪智对黄仕清的完整实战…");

  useEffect(() => {
    let disposed = false;
    void chessPlatform.getBookTopicDetail("book-game-53-hong-zhi-huang-shiqing")
      .then(async (value) => {
        if (!value) throw new Error("第53局专题资源不存在");
        const line = await chessPlatform.previewLine(STARTING_FEN, value.mainline);
        if (!disposed) {
          setDetail(value);
          setSteps(line);
          setNotice(`已载入公开大师库原局：${line.length} 半回合。`);
        }
      })
      .catch((error) => !disposed && setNotice(error instanceof Error ? error.message : String(error)));
    return () => { disposed = true; };
  }, []);

  const lessons = detail?.lessonNodes ?? [];
  const lesson = lessons[lessonIndex];
  const activePly = viewedPly ?? lesson?.ply ?? 0;
  const lessonStep = steps[lesson?.ply ? lesson.ply - 1 : -1];
  const currentStep = steps[activePly - 1];
  const variationPreview = variation?.steps[variationStep - 1];
  const displayedStep = variationPreview ?? currentStep;
  const currentFen = displayedStep?.fen ?? lessonStep?.fen ?? STARTING_FEN;
  const currentPieces = displayedStep?.pieces ?? lessonStep?.pieces ?? [];
  const nextMove = steps[activePly];
  const correct = revealed && answer.trim().replace(/[！!]/g, "") === lesson?.expectedMove.replace(/[！!]/g, "");
  const nearbyMoves = useMemo(() => {
    if (!lesson) return [];
    return steps.slice(Math.max(0, lesson.ply - 4), Math.min(steps.length, lesson.ply + 4));
  }, [lesson, steps]);

  function selectLesson(index: number) {
    setLessonIndex(index);
    setViewedPly(lessons[index]?.ply);
    setAnswer("");
    setRevealed(false);
    setEngineLines([]);
    setVariation(undefined);
    setVariationStep(0);
    setNotice("已定位学习节点。先作答，再查看书载答案或引擎复核。");
  }

  function selectMainlineStep(step: PreviewLineStep) {
    const ply = steps.indexOf(step) + 1;
    setViewedPly(ply);
    setVariation(undefined);
    setVariationStep(0);
    setNotice(`已定位实战第 ${ply} 半回合：${step.movedBy}${step.notation}`);
  }

  async function startVariation() {
    if (!lesson || !lessonStep) return;
    setBusy(true);
    setNotice("正在校验并载入书中推演变化…");
    try {
      const parsed = lesson.variationNotation?.length
        ? await chessPlatform.parseChineseLine(lessonStep.fen, lesson.variationNotation)
        : { steps: await chessPlatform.previewLine(lessonStep.fen, lesson.practiceLine ?? []), moves: lesson.practiceLine ?? [] };
      if (parsed.steps.length === 0) throw new Error("该学习节点暂无可回放的书中变化");
      setViewedPly(lesson.ply);
      setVariation({ steps: parsed.steps, notes: lesson.variationNotes ?? [] });
      setVariationStep(1);
      setNotice("已进入书中推演。可逐步查看每一着的目的与陷阱。 ");
    } catch (error) {
      setNotice(error instanceof Error ? `书中变例无法回放：${error.message}` : String(error));
    } finally {
      setBusy(false);
    }
  }

  function exitVariation() {
    setVariation(undefined);
    setVariationStep(0);
    setViewedPly(lesson?.ply);
    setNotice("已返回学习节点。 ");
  }

  async function verifyEngine() {
    if (!enginePath || !lesson) {
      setNotice("请先在引擎设置中确认 Pikafish 路径，再复核此节点。");
      return;
    }
    setBusy(true);
    setNotice("Pikafish 正在比较书载应对与最佳防守…");
    try {
      const lines = await chessPlatform.analyze({ enginePath, fen: currentFen, searchMode: "depth", searchValue: 20, threads, hashMb, multipv: 3, serverUrl: "", token: "" });
      setEngineLines(lines);
      setNotice("优化对比完成。书载结论与引擎结果分别显示。 ");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function savePractice() {
    if (!lesson) return;
    try {
      const plan = await chessPlatform.saveFlyknifePlan({
        title: `第53局 · ${lesson.title}`,
        side: "red",
        startingFen: currentFen,
        templateName: "洪智 vs 黄仕清，第53局",
        lureMove: lesson.practiceLine && lesson.practiceLine.length > 1 ? lesson.practiceLine[0] : "",
        knifeMove: lesson.practiceLine?.at(-1) ?? "",
        mainline: lesson.practiceLine ?? [],
        bestDefense: [],
        risk: "原书飞刀与陷阱学习节点。",
        note: `${lesson.prompt}\n书载答案：${lesson.answer}\n${lesson.explanation}`,
      });
      onPlanSaved(plan);
      setNotice("已保存到本地飞刀练习库。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  return <div className="modal-backdrop" role="presentation">
    <section className="game53-study-dialog" role="dialog" aria-modal="true" aria-label="第53局拆解学习">
      <header><span><Swords size={18}/><strong>第53局拆解学习</strong><small>洪智 vs 黄仕清 · 1998 全国个人赛</small></span><button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button></header>
      {!detail || !lesson ? <p className="game53-notice">{notice}</p> : <div className="game53-study-layout">
        <section className="game53-board-column">
          <header><strong>{variation ? "书中推演" : "完整实战"}</strong><small>{variation ? `第 ${variationStep}/${variation.steps.length} 步 · ${lesson.title}` : `第 ${activePly} 半回合 · ${lesson.title}`}</small></header>
          <div className="game53-board"><LinkMiniBoard presentation="preview" boardAriaLabel="第53局主棋盘" pieces={currentPieces} arrows={[]} lastMove={displayedStep ? { from: displayedStep.from, to: displayedStep.to, notation: displayedStep.notation, movedBy: displayedStep.movedBy } : undefined} sideToMove={variation ? variation.steps[variationStep]?.movedBy ?? "红方" : nextMove?.movedBy ?? "红方"} pieceAsset={pieceAsset} boardAsset="/skins/default/board.png"/></div>
          <nav className="game53-mainline" aria-label="第53局关键主线">{nearbyMoves.map((step, index) => <button key={`${step.notation}-${index}`} className={step === currentStep ? "active" : ""} onClick={() => selectMainlineStep(step)}>{steps.indexOf(step) + 1}. {step.notation}</button>)}</nav>
        </section>
        <section className="game53-learning-column">
          <nav className="game53-lessons" aria-label="三段学习">{lessons.map((item, index) => <button key={item.id} className={index === lessonIndex ? "active" : ""} onClick={() => selectLesson(index)}>{index + 1}. {item.title}</button>)}</nav>
          <article className={`game53-focus ${lesson.lessonKind ?? "practicalDefense"}`}><small>{lesson.lessonKind === "trap" ? "陷阱拆解" : lesson.lessonKind === "flyknife" ? "飞刀拆解" : "实战应对"}</small><strong>{lesson.lessonKind === "trap" ? "诱导黑方贪攻，转而利用其后方失调。" : lesson.lessonKind === "flyknife" ? detail.teaching.knife : detail.teaching.lure}</strong><p><b>书载结论：</b>{lesson.explanation}</p><p><b>防守对比：</b>{detail.teaching.defense}</p><div className="game53-focus-actions"><button className="primary" disabled={busy} onClick={() => void startVariation()}><Swords size={14}/>开始推演</button><button disabled={busy} onClick={() => void verifyEngine()}><Activity size={14}/>查看优化</button></div></article>
          <div className="game53-learning-scroll">
            {variation && <article className="game53-card game53-variation"><small>书中逐步推演</small><strong>{variation.steps[variationStep - 1]?.movedBy}{variation.steps[variationStep - 1]?.notation}</strong><p>{variation.notes[variationStep - 1] ?? "观察这一步如何延续前一阶段的压力。"}</p><div><button disabled={variationStep <= 1} onClick={() => setVariationStep((value) => value - 1)}><ChevronLeft size={14}/>上一步</button><button disabled={variationStep >= variation.steps.length} onClick={() => setVariationStep((value) => value + 1)}>下一步<ChevronRight size={14}/></button><button onClick={exitVariation}>退出推演</button></div></article>}
            <article className="game53-card"><small>学习问题</small><strong>{lesson.prompt}</strong><label>你的着法<input value={answer} placeholder="例如：车八平五" onChange={(event) => { setAnswer(event.target.value); setRevealed(false); }}/></label><div><button className="primary" onClick={() => setRevealed(true)}>提交作答</button><button onClick={() => setRevealed(true)}>查看书载答案</button></div>{revealed && <p className={correct ? "correct" : "answer"}><b>{correct ? "答对了。" : "书载答案："}</b>{lesson.answer}。{lesson.explanation}</p>}</article>
            <article className="game53-card"><small>优化：Pikafish 最佳防守</small>{!enginePath && <p className="answer">尚未配置本地 Pikafish。<button onClick={onOpenEngineSettings}>打开引擎设置</button></p>}{enginePath && <button disabled={busy} onClick={() => void verifyEngine()}><Activity size={14}/>{busy ? "复核中…" : "比较书载与最佳防守"}</button>}{engineLines.length > 0 && <div className="game53-engine-lines">{engineLines.map((line) => <p key={line.multipv}><b>{line.multipv}. {line.notation?.[0] ?? line.pv[0]}</b><span>{score(line)}</span><small>{line.notation?.join(" ")}</small></p>)}</div>}</article>
            <details className="game53-book-source"><summary>查看原书图与文字核验</summary><p>{detail.rawTranscript}</p>{detail.images[0] && <img className="game53-book-image" src={detail.images[0]} alt="布局飞刀集图53原书页"/>}</details>
          </div>
          <footer><button onClick={() => void savePractice()}><Save size={14}/>保存练习</button><button onClick={() => void onOpenMasterGame(detail.masterGameId ?? "dpxq-m-6008")}><BookOpen size={14}/>打开完整棋谱</button></footer>
          <p className="game53-notice" aria-live="polite">{notice}</p>
        </section>
      </div>}
    </section>
  </div>;
}
