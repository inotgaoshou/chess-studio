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
};

function pieceAsset(piece: { color: string; kind: string }) {
  const code: Record<string, string> = { king: "k", advisor: "a", elephant: "b", horse: "n", rook: "r", cannon: "c", pawn: "p" };
  return `/skins/default/${piece.color === "red" ? "r" : "b"}${code[piece.kind] ?? "p"}.png`;
}

function score(line: AnalysisLine) {
  if (line.mate != null) return `杀 ${line.mate}`;
  return line.scoreCp == null ? "无分值" : `${line.scoreCp > 0 ? "+" : ""}${line.scoreCp}`;
}

export function Game53StudyDialog({ onClose, onOpenMasterGame, onPlanSaved, enginePath, threads, hashMb }: Props) {
  const [detail, setDetail] = useState<BookTopicDetail>();
  const [steps, setSteps] = useState<PreviewLineStep[]>([]);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [engineLines, setEngineLines] = useState<AnalysisLine[]>([]);
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
  const currentStep = lesson ? steps[lesson.ply - 1] : undefined;
  const currentFen = currentStep?.fen ?? STARTING_FEN;
  const currentPieces = currentStep?.pieces ?? [];
  const nextMove = steps[lesson?.ply ?? 0];
  const correct = revealed && answer.trim().replace(/[！!]/g, "") === lesson?.expectedMove.replace(/[！!]/g, "");
  const nearbyMoves = useMemo(() => {
    if (!lesson) return [];
    return steps.slice(Math.max(0, lesson.ply - 4), Math.min(steps.length, lesson.ply + 4));
  }, [lesson, steps]);

  function selectLesson(index: number) {
    setLessonIndex(index);
    setAnswer("");
    setRevealed(false);
    setEngineLines([]);
    setNotice("已定位学习节点。先作答，再查看书载答案或引擎复核。");
  }

  async function verifyEngine() {
    if (!enginePath || !lesson) {
      setNotice("请先在引擎设置中确认 Pikafish 路径，再复核此节点。");
      return;
    }
    setBusy(true);
    setNotice("Pikafish 正在复核该学习节点的最佳防守…");
    try {
      const lines = await chessPlatform.analyze({ enginePath, fen: currentFen, searchMode: "depth", searchValue: 20, threads, hashMb, multipv: 3, serverUrl: "", token: "" });
      setEngineLines(lines);
      setNotice("引擎复核完成。书载结论与引擎结果分别显示。 ");
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
          <header><strong>完整实战</strong><small>第 {lesson.ply} 半回合前 · {lesson.title}</small></header>
          <div className="game53-board"><LinkMiniBoard presentation="preview" boardAriaLabel="第53局主棋盘" pieces={currentPieces} arrows={[]} lastMove={currentStep ? { from: currentStep.from, to: currentStep.to, notation: currentStep.notation, movedBy: currentStep.movedBy } : undefined} sideToMove={nextMove?.movedBy ?? "红方"} pieceAsset={pieceAsset} boardAsset="/skins/default/board.png"/></div>
          <nav className="game53-mainline" aria-label="第53局关键主线">{nearbyMoves.map((step, index) => <button key={`${step.notation}-${index}`} className={step === currentStep ? "active" : ""} onClick={() => setNotice(`实战第 ${steps.indexOf(step) + 1} 半回合：${step.movedBy}${step.notation}`)}>{steps.indexOf(step) + 1}. {step.notation}</button>)}</nav>
        </section>
        <section className="game53-learning-column">
          <nav className="game53-lessons" aria-label="三段学习">{lessons.map((item, index) => <button key={item.id} className={index === lessonIndex ? "active" : ""} onClick={() => selectLesson(index)}>{index + 1}. {item.title}</button>)}</nav>
          <article className="game53-card"><small>学习问题</small><strong>{lesson.prompt}</strong><label>你的着法<input value={answer} placeholder="例如：车八平五" onChange={(event) => { setAnswer(event.target.value); setRevealed(false); }}/></label><div><button className="primary" onClick={() => setRevealed(true)}>提交作答</button><button onClick={() => setRevealed(true)}>查看书载答案</button></div>{revealed && <p className={correct ? "correct" : "answer"}><b>{correct ? "答对了。" : "书载答案："}</b>{lesson.answer}。{lesson.explanation}</p>}</article>
          <article className="game53-card game53-reference"><small>书页核验 / 陷阱参考</small><div className="game53-reference-grid"><div className="game53-reference-board"><LinkMiniBoard presentation="preview" boardAriaLabel="书页专题参考棋盘" pieces={currentPieces} arrows={[]} lastMove={currentStep ? { from: currentStep.from, to: currentStep.to, notation: currentStep.notation, movedBy: currentStep.movedBy } : undefined} sideToMove={nextMove?.movedBy ?? "红方"} pieceAsset={pieceAsset} boardAsset="/skins/default/board.png"/></div><div><p>{detail.teaching.knife}</p>{lesson.bookVariation && <><strong>中刀变化</strong><p>{lesson.bookVariation}</p></>}</div></div>{lessonIndex === 0 && detail.images[0] && <img className="game53-book-image" src={detail.images[0]} alt="布局飞刀集图53原书页"/>}</article>
          <article className="game53-card"><small>本地 Pikafish</small><button disabled={busy} onClick={() => void verifyEngine()}><Activity size={14}/>{busy ? "复核中…" : "复核最佳防守"}</button>{engineLines.length > 0 && <div className="game53-engine-lines">{engineLines.map((line) => <p key={line.multipv}><b>{line.multipv}. {line.notation?.[0] ?? line.pv[0]}</b><span>{score(line)}</span><small>{line.notation?.join(" ")}</small></p>)}</div>}</article>
          <footer><button onClick={() => void savePractice()}><Save size={14}/>保存练习</button><button onClick={() => void onOpenMasterGame(detail.masterGameId ?? "dpxq-m-6008")}><BookOpen size={14}/>打开完整棋谱</button></footer>
          <p className="game53-notice" aria-live="polite">{notice}</p>
        </section>
      </div>}
    </section>
  </div>;
}
