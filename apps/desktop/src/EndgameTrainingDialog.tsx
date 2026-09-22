import { ArrowDown, ArrowUp, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Folder, FolderInput, FolderPlus, History, Lightbulb, ListRestart, MoreVertical, Pause, Play, RotateCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { LinkMiniBoard } from "./LinkMiniBoard";
import { boardIntersectionStyle } from "./boardGeometry";
import { chessPlatform, type Piece } from "./platform";
import { playMoveFeedbackSound } from "./MainBoardMoveFeedback";
import type { DesktopPreferencesDto, EndgameAttemptDto, EndgameFolderDto, EndgameLibraryDto, EndgameProblemDto } from "./platform/types";

type SolutionMove = { iccs: string; comment: string; children: SolutionMove[] };
type Square = { row: number; col: number };
// This lives in Vite's public directory so the desktop WebView can resolve it
// both in development and from Tauri's packaged asset origin.
const boardAsset = "/skins/qingxin-zhuyun/board.png";
const boardAssetWithoutRiverText = "/skins/qingxin-zhuyun/board-river-blank.png";
const labels: Record<string, string> = { K: "帅", A: "仕", B: "相", N: "马", R: "车", C: "炮", P: "兵", k: "将", a: "士", b: "象", n: "马", r: "车", c: "炮", p: "卒" };
const kind: Record<string, string> = { K: "k", A: "a", B: "b", N: "n", R: "r", C: "c", P: "p", k: "k", a: "a", b: "b", n: "n", r: "r", c: "c", p: "p" };
const fmt = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const sq = (value: Square) => `${String.fromCharCode(97 + value.col)}${9 - value.row}`;
const attemptModeLabel: Record<string, string> = { cloud: "云库对练", solver: "只走解题方", replay: "双方复现", free: "自由实战" };
const attemptOutcomeLabel: Record<string, string> = { completed: "解出", revealed: "已看答案", abandoned: "已放弃", free_finished: "自由对局结束" };
const terminalResultLabel = (checkmate: boolean) => checkmate ? "绝杀（将死）" : "困毙";
const progressFilters = ["全部", "未做", "做过未对", "做对"] as const;
type ProgressFilter = typeof progressFilters[number];
const AUTO_REPLY_DELAY_MS = 650;
const MIN_LIBRARY_RAIL_WIDTH = 168;
const MAX_LIBRARY_RAIL_WIDTH = 320;
const normalizedFolderId = (folderId?: string | null) => folderId ?? undefined;
const friendlyCblImportError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return /no such file or directory|os error 2/i.test(message)
    ? "找不到所选 CBL 文件。文件可能已移动或被删除，请重新选择。"
    : message;
};
const sideToMove = (startingFen: string, moves: string[]) => {
  const startsWithBlack = startingFen.trim().split(/\s+/)[1] === "b";
  return (moves.length % 2 === 0) === startsWithBlack ? "black" : "red";
};

function readFen(fen: string): Piece[] {
  const result: Piece[] = [];
  fen.split(" ")[0].split("/").forEach((rank, row) => {
    let col = 0;
    for (const value of rank) {
      if (/\d/.test(value)) col += Number(value);
      else { result.push({ row, col, color: value === value.toUpperCase() ? "red" : "black", kind: kind[value], label: labels[value] }); col++; }
    }
  });
  return result;
}

function apply(pieces: Piece[], iccs: string) {
  const from = { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) };
  const to = { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) };
  const mover = pieces.find((piece) => piece.row === from.row && piece.col === from.col);
  return mover ? [...pieces.filter((piece) => !(piece.row === from.row && piece.col === from.col) && !(piece.row === to.row && piece.col === to.col)), { ...mover, ...to }] : pieces;
}

function mainline(moves: SolutionMove[]) {
  const result: string[] = [];
  let current = moves[0];
  while (current) { result.push(current.iccs); current = current.children[0]; }
  return result;
}

function moveSquares(iccs: string) {
  return {
    from: { col: iccs.charCodeAt(0) - 97, row: 9 - Number(iccs[1]) },
    to: { col: iccs.charCodeAt(2) - 97, row: 9 - Number(iccs[3]) },
  };
}

function answerRounds(startingFen: string, notation: string[]) {
  const startsWithRed = startingFen.split(/\s+/)[1] !== "b";
  return Array.from({ length: Math.ceil(notation.length / 2) }, (_, index) => {
    const firstSide = (startsWithRed ? "红" : "黑") + "方";
    const secondSide = (startsWithRed ? "黑" : "红") + "方";
    return {
      round: index + 1,
      first: `${firstSide} ${notation[index * 2]}`,
      second: notation[index * 2 + 1] ? `${secondSide} ${notation[index * 2 + 1]}` : undefined,
    };
  });
}

function renderCblText(value: string) {
  return value.split(/(\[b\][\s\S]*?\[\/b\])/gi).map((part, index) => {
    const match = part.match(/^\[b\]([\s\S]*?)\[\/b\]$/i);
    return match ? <strong key={index}>{match[1]}</strong> : part;
  });
}

export function EndgameTrainingDialog({ onClose, preferences: preferenceInput, riverText, riverTextColor, riverTextSize }: { onClose(): void; preferences?: Pick<DesktopPreferencesDto, "moveAnimationEnabled" | "moveSoundEnabled" | "moveSoundVolume">; riverText?: string; riverTextColor?: string; riverTextSize?: number }) {
  const preferences = preferenceInput ?? { moveAnimationEnabled: true, moveSoundEnabled: true, moveSoundVolume: 70 };
  const [libraries, setLibraries] = useState<EndgameLibraryDto[]>([]);
  const [folders, setFolders] = useState<EndgameFolderDto[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>();
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [rootExpanded, setRootExpanded] = useState(true);
  const [libraryRailWidth, setLibraryRailWidth] = useState(184);
  const [directoryTreeRatio, setDirectoryTreeRatio] = useState(40);
  const [library, setLibrary] = useState<EndgameLibraryDto>();
  const [expandedLibraryId, setExpandedLibraryId] = useState<string>();
  const [problems, setProblems] = useState<EndgameProblemDto[]>([]);
  const [problem, setProblem] = useState<EndgameProblemDto>();
  const [category, setCategory] = useState("全部");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("全部");
  const [query, setQuery] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalResults, setGlobalResults] = useState<Array<{ library: EndgameLibraryDto; problem: EndgameProblemDto }>>([]);
  const [mode, setMode] = useState<"cloud" | "solver" | "replay" | "free">("cloud");
  const [line, setLine] = useState<SolutionMove[]>([]);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [selected, setSelected] = useState<Square>();
  const [last, setLast] = useState<{ from: Square; to: Square }>();
  const [startedAt, setStartedAt] = useState<number>();
  const [elapsedBeforePause, setElapsedBeforePause] = useState(0);
  const [, setClock] = useState(0);
  const [hints, setHints] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [hasAdvanced, setHasAdvanced] = useState(false);
  const [notice, setNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [importSummary, setImportSummary] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [answerNotation, setAnswerNotation] = useState<string[]>([]);
  const [answerStep, setAnswerStep] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [freeMoves, setFreeMoves] = useState<string[]>([]);
  const [freeMovePending, setFreeMovePending] = useState(false);
  const [autoReplyPending, setAutoReplyPending] = useState(false);
  const [attemptFinished, setAttemptFinished] = useState(false);
  const [terminalFeedback, setTerminalFeedback] = useState<"checkmate" | "stalemate">();
  const [playedMoves, setPlayedMoves] = useState<string[]>([]);
  const [attempts, setAttempts] = useState<EndgameAttemptDto[]>([]);
  const [showAttempts, setShowAttempts] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "library" | "problem" | "folder";
    id: string;
    libraryId?: string;
    title: string;
    libraryCount?: number;
  }>();
  const [directoryAction, setDirectoryAction] = useState<{ kind: "create"; parentId?: string } | { kind: "move-folder"; folder: EndgameFolderDto } | { kind: "move-library"; library: EndgameLibraryDto }>();
  const [directoryName, setDirectoryName] = useState("");
  const [directoryTargetId, setDirectoryTargetId] = useState("");
  const [directoryTargetExpandedIds, setDirectoryTargetExpandedIds] = useState<Set<string>>(() => new Set());
  const [openTreeMenu, setOpenTreeMenu] = useState<string>();
  const trainingSession = useRef(0);
  const finishingAttempt = useRef(false);
  const elapsed = elapsedBeforePause + (startedAt ? Date.now() - startedAt : 0);
  const categories = useMemo(() => ["全部", ...Array.from(new Set(problems.map((item) => item.category))).sort()], [problems]);
  const problemProgress = (item: EndgameProblemDto) => item.completedAttempts > 0 ? "done" : item.attemptCount > 0 ? "tried" : "new";
  const visibleProblems = useMemo(() => problems.filter((item) => {
    const status = problemProgress(item);
    return (category === "全部" || item.category === category)
      && (progressFilter === "全部" || (progressFilter === "未做" && status === "new") || (progressFilter === "做过未对" && status === "tried") || (progressFilter === "做对" && status === "done"))
      && (!query.trim() || `${item.title} ${item.category}`.includes(query.trim()));
  }), [category, problems, progressFilter, query]);
  const index = problem ? visibleProblems.findIndex((item) => item.id === problem.id) : -1;
  const hintSquare = hints >= 2 && line[0] ? moveSquares(line[0].iccs).from : undefined;
  const answerMoves = useMemo(() => problem ? mainline(JSON.parse(problem.solutionJson)) : [], [problem]);
  const answerLines = answerNotation.length ? answerNotation : answerMoves;
  const rounds = useMemo(() => problem ? answerRounds(problem.startingFen, answerLines) : [], [answerLines, problem]);
  const demoComplete = answerMoves.length > 0 && answerStep >= answerMoves.length;
  const demoSummary = useMemo(() => {
    if (!problem || !demoComplete) return "";
    if (problem.note.trim()) return problem.note.trim();
    const firstRound = rounds[0];
    return `题解共 ${rounds.length} 回合，先从 ${firstRound?.first ?? "首着"} 开始，再按双方应手完成。`;
  }, [demoComplete, problem, rounds]);
  const refresh = async (openFirst = false) => {
    const [nextLibraries, nextFolders] = await Promise.all([chessPlatform.listEndgameLibraries(), chessPlatform.listEndgameFolders()]);
    setLibraries(nextLibraries);
    setFolders(nextFolders);
    if (openFirst && nextLibraries.length) await selectLibrary(nextLibraries[0], nextFolders);
  };
  const loadAttempts = async (problemId: string) => setAttempts(await chessPlatform.listEndgameAttempts(problemId));

  useEffect(() => {
    void (async () => {
      let refreshWarning = "";
      try {
        const refreshed = await chessPlatform.refreshEndgameLibraries();
        refreshWarning = refreshed.warnings.join("；");
      } catch (error) {
        refreshWarning = `题库刷新失败：${error instanceof Error ? error.message : String(error)}`;
      }
      const [existing, existingFolders] = await Promise.all([chessPlatform.listEndgameLibraries(), chessPlatform.listEndgameFolders()]);
      setLibraries(existing); setFolders(existingFolders);
      if (existing.length) {
        await selectLibrary(existing[0], existingFolders);
        if (refreshWarning) setNotice(refreshWarning);
        return;
      }
    })();
  }, []);

  useEffect(() => {
    if (!terminalFeedback) return;
    const timer = window.setTimeout(() => setTerminalFeedback(undefined), 3400);
    return () => window.clearTimeout(timer);
  }, [terminalFeedback]);
  useEffect(() => {
    const keyword = globalQuery.trim();
    if (!keyword) {
      setGlobalResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all(libraries.map(async (source) => ({
        library: source,
        problems: await chessPlatform.listEndgameProblems(source.id),
      }))).then((sources) => {
        if (cancelled) return;
        const normalized = keyword.toLocaleLowerCase();
        setGlobalResults(sources.flatMap(({ library: source, problems: sourceProblems }) => sourceProblems
          .filter((item) => `${item.title} ${item.category} ${item.note}`.toLocaleLowerCase().includes(normalized))
          .map((item) => ({ library: source, problem: item }))));
      }).catch(() => {
        if (!cancelled) setGlobalResults([]);
      });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [globalQuery, libraries]);
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setClock((value) => value + 1), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  useEffect(() => {
    if (!demoPlaying || !problem || !revealed) return;
    const id = window.setInterval(() => {
      setAnswerStep((current) => {
        const next = current + 1;
        if (next >= answerMoves.length) setDemoPlaying(false);
        const displayedMoves = answerMoves.slice(0, Math.min(next, answerMoves.length));
        setPieces(displayedMoves.reduce((position, move) => apply(position, move), readFen(problem.startingFen)));
        const lastMove = displayedMoves.at(-1);
        setLast(lastMove ? moveSquares(lastMove) : undefined);
        return Math.min(next, answerMoves.length);
      });
    }, 750);
    return () => clearInterval(id);
  }, [answerMoves, demoPlaying, problem, revealed]);

  async function selectLibrary(item: EndgameLibraryDto, availableFolders = folders) {
    if (item.id !== library?.id) await saveUnfinishedAttempt();
    setLibrary(item);
    setRootExpanded(true);
    setSelectedFolderId(normalizedFolderId(item.folderId));
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      const visited = new Set<string>();
      let folderId = normalizedFolderId(item.folderId);
      while (folderId && !visited.has(folderId)) {
        visited.add(folderId);
        next.add(folderId);
        folderId = normalizedFolderId(availableFolders.find((folder) => folder.id === folderId)?.parentId);
      }
      return next;
    });
    setExpandedLibraryId(item.id);
    setProblems(await chessPlatform.listEndgameProblems(item.id));
    setProblem(undefined);
    setAttempts([]);
    setShowAttempts(false);
    setCategory("全部");
    setProgressFilter("全部");
    setQuery("");
  }

  function toggleLibrary(item: EndgameLibraryDto) {
    if (expandedLibraryId === item.id) {
      setExpandedLibraryId(undefined);
      return;
    }
    void selectLibrary(item);
  }

  function hasAttemptProgress() {
    return Boolean(problem && !attemptFinished && (hasAdvanced || startedAt || elapsedBeforePause > 0 || hints > 0 || mistakes > 0 || revealed || freeMoves.length > 0 || playedMoves.length > 0));
  }

  async function saveUnfinishedAttempt() {
    if (!hasAttemptProgress()) return;
    await finish("abandoned");
  }

  function startFresh(item: EndgameProblemDto) {
    trainingSession.current += 1;
    finishingAttempt.current = false;
    setProblem(item); setLine(JSON.parse(item.solutionJson)); setPieces(readFen(item.startingFen)); setSelected(undefined); setLast(undefined); setMode("cloud");
    setStartedAt(undefined); setElapsedBeforePause(0); setClock(0); setHints(0); setMistakes(0); setHasAdvanced(false); setNotice("选中棋子后再点目标点。第一步开始计时。"); setRevealed(false); setAttemptFinished(false); setAutoReplyPending(false); setTerminalFeedback(undefined); setPlayedMoves([]); setAnswerNotation([]); setAnswerStep(0); setDemoPlaying(false); setFreeMoves([]); setFreeMovePending(false); setShowAttempts(false); void loadAttempts(item.id);
  }

  async function start(item: EndgameProblemDto) {
    if (!hasAttemptProgress()) {
      startFresh(item);
      return;
    }
    await saveUnfinishedAttempt();
    startFresh(item);
  }

  function stopClock() {
    const duration = elapsed;
    setElapsedBeforePause(duration);
    setStartedAt(undefined);
    return duration;
  }

  async function finish(outcome: "completed" | "revealed" | "abandoned" | "free_finished", duration = elapsed) {
    if (!problem || attemptFinished || finishingAttempt.current) return;
    finishingAttempt.current = true;
    setAutoReplyPending(false);
    setElapsedBeforePause(duration);
    setStartedAt(undefined);
    try {
      await chessPlatform.saveEndgameAttempt({ problemId: problem.id, mode, elapsedMs: duration, hintsUsed: hints, mistakes, outcome });
      setAttemptFinished(true);
      setRevealed(outcome === "revealed");
      void loadAttempts(problem.id);
      const [updatedLibraries, updatedProblems] = await Promise.all([chessPlatform.listEndgameLibraries(), chessPlatform.listEndgameProblems(problem.libraryId)]);
      setLibraries(updatedLibraries);
      setProblems(updatedProblems);
      setLibrary((current) => updatedLibraries.find((item) => item.id === (current?.id ?? problem.libraryId)) ?? current);
      setProblem((current) => updatedProblems.find((item) => item.id === (current?.id ?? problem.id)) ?? current);
    } catch (error) {
      finishingAttempt.current = false;
      setNotice(`保存答题记录失败：${error instanceof Error ? error.message : String(error)}。请稍后重试。`);
    }
  }

  async function importCbl() {
    setImportError("");
    setImportSummary("");
    try {
      const result = await chessPlatform.importEndgameCblBatch(selectedFolderId);
      if (!result) return;
      await refresh();
      const succeeded = result.items.filter((item) => item.library);
      const failed = result.items.filter((item) => item.error);
      const warnings = succeeded.reduce((count, item) => count + item.warnings.length, 0);
      if (succeeded[0]?.library) await selectLibrary(succeeded[0].library);
      const summary = `导入完成：${succeeded.length} 本成功${warnings ? `，跳过 ${warnings} 条无效记录` : ""}${failed.length ? `；${failed.length} 本失败：${failed.map((item) => `${item.path.split(/[\\/]/).at(-1)}（${friendlyCblImportError(item.error)}）`).join("、")}` : ""}。`;
      setImportSummary(summary);
      setNotice(summary);
    } catch (error) {
      setImportError(friendlyCblImportError(error));
    }
  }

  function toggleFolder(folderId: string) {
    setSelectedFolderId(folderId);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }

  function showDirectoryTarget() {
    setSelectedFolderId(directoryTargetId || undefined);
    setRootExpanded(true);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      let targetId = directoryTargetId || undefined;
      const visited = new Set<string>();
      while (targetId && !visited.has(targetId)) {
        visited.add(targetId);
        next.add(targetId);
        targetId = normalizedFolderId(folders.find((folder) => folder.id === targetId)?.parentId);
      }
      return next;
    });
  }

  async function confirmDirectoryAction() {
    const action = directoryAction;
    if (!action) return;
    try {
      if (action.kind === "create") {
        const existing = folders.find((folder) => normalizedFolderId(folder.parentId) === action.parentId && folder.name.localeCompare(directoryName.trim(), undefined, { sensitivity: "accent" }) === 0);
        if (existing) {
          setExpandedFolderIds((current) => new Set(current).add(existing.id));
          setSelectedFolderId(existing.id);
          setDirectoryAction(undefined);
          setDirectoryName("");
          setNotice(`目录“${existing.name}”已存在，已打开。`);
          return;
        }
        const folder = await chessPlatform.createEndgameFolder(action.parentId, directoryName);
        setExpandedFolderIds((current) => new Set(current).add(folder.parentId ?? folder.id));
        setSelectedFolderId(folder.id);
        setRootExpanded(true);
        setNotice(`已创建目录：${folder.name}`);
      } else if (action.kind === "move-folder") {
        await chessPlatform.moveEndgameFolder(action.folder.id, directoryTargetId || undefined);
        showDirectoryTarget();
        setNotice(`已移动目录：${action.folder.name}`);
      } else {
        await chessPlatform.moveEndgameLibraries([action.library.id], directoryTargetId || undefined);
        showDirectoryTarget();
        setNotice(`已移动题库：${action.library.title}`);
      }
      setDirectoryAction(undefined); setDirectoryName(""); setDirectoryTargetId("");
      await refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeLibrary(libraryId: string) {
    await chessPlatform.deleteEndgameLibrary(libraryId);
    const remaining = await chessPlatform.listEndgameLibraries();
    setLibraries(remaining);
    if (remaining.length) await selectLibrary(remaining[0]);
    else { setLibrary(undefined); setProblems([]); setProblem(undefined); }
  }

  async function removeProblem(problemId: string, libraryId: string) {
    await chessPlatform.deleteEndgameProblem(problemId);
    const updatedLibraries = await chessPlatform.listEndgameLibraries();
    setLibraries(updatedLibraries);
    const updated = updatedLibraries.find((item) => item.id === libraryId);
    if (updated) await selectLibrary(updated);
  }

  async function removeFolder(folderId: string) {
    await chessPlatform.deleteEndgameFolder(folderId);
    const [updatedLibraries, updatedFolders] = await Promise.all([chessPlatform.listEndgameLibraries(), chessPlatform.listEndgameFolders()]);
    setLibraries(updatedLibraries);
    setFolders(updatedFolders);
    setSelectedFolderId(undefined);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    if (library) setLibrary(updatedLibraries.find((item) => item.id === library.id));
  }

  async function reorderFolder(folder: EndgameFolderDto, moveUp: boolean) {
    try {
      if (await chessPlatform.reorderEndgameFolder(folder.id, moveUp)) {
        await refresh();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function reorderLibrary(item: EndgameLibraryDto, moveUp: boolean) {
    try {
      if (await chessPlatform.reorderEndgameLibrary(item.id, moveUp)) {
        await refresh();
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(undefined);
    try {
      if (target.kind === "library") {
        await removeLibrary(target.id);
        setNotice(`已删除题库《${target.title}》。`);
      } else if (target.kind === "folder") {
        await removeFolder(target.id);
        setNotice(`已删除目录“${target.title}”，其中题库已移至上级目录。`);
      } else if (target.libraryId) {
        await removeProblem(target.id, target.libraryId);
        setNotice(`已从训练目录移除《${target.title}》，历史记录已保留。`);
      }
    } catch (error) {
      setNotice(`删除失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function revealAnswer() {
    if (!problem || attemptFinished) return;
    const moves = answerMoves;
    await finish("revealed");
    setPieces(readFen(problem.startingFen));
    setLast(undefined);
    setSelected(undefined);
    setAnswerStep(0);
    setDemoPlaying(false);
    try {
      setAnswerNotation(await chessPlatform.endgameChineseMainline(problem.startingFen, moves));
    } catch {
      // A damaged legacy record can still show its stored coordinate notation.
      setAnswerNotation(moves);
    }
  }

  function restartAnswerDemo() {
    if (!problem) return;
    setPieces(readFen(problem.startingFen));
    setLast(undefined);
    setSelected(undefined);
    setAnswerStep(0);
    setDemoPlaying(false);
  }

  async function playFreeMove(iccs: string, from: Square, to: Square, duration: number) {
    if (!problem || freeMovePending || attemptFinished) return;
    setFreeMovePending(true);
    try {
      const result = await chessPlatform.endgameFreePracticeMove(problem.startingFen, freeMoves, iccs);
      playMoveFeedbackSound(result.terminal ? (result.checkmate ? "checkmate" : "stalemate") : result.check ? "check" : result.captured ? "capture" : "move", preferences.moveSoundEnabled, preferences.moveSoundVolume);
      setPieces(readFen(result.fen));
      setFreeMoves((moves) => [...moves, iccs]);
      setLast({ from, to });
      setHasAdvanced(true);
      if (!startedAt) setStartedAt(Date.now());
      setNotice(`自由实战：${result.notation}${result.terminal ? `。${terminalResultLabel(result.checkmate)}，对局结束，已保存本次自由练习。` : "。"}`);
      if (result.terminal) { setTerminalFeedback(result.checkmate ? "checkmate" : "stalemate"); void finish("free_finished", duration); }
    } catch {
      setMistakes((value) => value + 1);
      setNotice("这步不符合中国象棋规则，局面没有改变。");
    } finally {
      setFreeMovePending(false);
    }
  }

  async function playCloudMove(iccs: string, from: Square, to: Square, duration: number, moveStartedAt: number) {
    if (!problem || freeMovePending || attemptFinished) return;
    const continueOffline = (reason: string) => {
      setMode("free");
      setAutoReplyPending(false);
      setNotice(`${reason}，已切换至离线双人接手，请由当前行棋方继续走棋。`);
    };
    setFreeMovePending(true);
    try {
      const player = await chessPlatform.endgameFreePracticeMove(problem.startingFen, freeMoves, iccs);
      setPieces(readFen(player.fen)); setFreeMoves((moves) => [...moves, iccs]); setLast({ from, to }); setHasAdvanced(true);
      if (!startedAt) setStartedAt(Date.now());
      playMoveFeedbackSound(player.terminal ? (player.checkmate ? "checkmate" : "stalemate") : player.check ? "check" : player.captured ? "capture" : "move", preferences.moveSoundEnabled, preferences.moveSoundVolume);
      if (player.terminal) { setTerminalFeedback(player.checkmate ? "checkmate" : "stalemate"); setNotice(`云库对练：${player.notation}。${terminalResultLabel(player.checkmate)}，获胜，已保存为做对。`); await finish("completed", duration); return; }
      setAutoReplyPending(true); setNotice("正在查询云库应手…");
      const reply = (await chessPlatform.queryCloudOpeningBook(player.fen))[0];
      if (!reply) { continueOffline("云库当前局面没有可用应手"); return; }
      const currentSession = trainingSession.current;
      window.setTimeout(() => {
        if (currentSession !== trainingSession.current || finishingAttempt.current) return;
        void (async () => {
          try {
            const answer = await chessPlatform.endgameFreePracticeMove(problem.startingFen, [...freeMoves, iccs], reply.iccs);
            if (currentSession !== trainingSession.current || finishingAttempt.current) return;
            setPieces(readFen(answer.fen)); setFreeMoves((moves) => [...moves, reply.iccs]); setLast(moveSquares(reply.iccs));
            playMoveFeedbackSound(answer.terminal ? (answer.checkmate ? "checkmate" : "stalemate") : answer.check ? "check" : answer.captured ? "capture" : "move", preferences.moveSoundEnabled, preferences.moveSoundVolume);
            if (answer.terminal) {
              setTerminalFeedback(answer.checkmate ? "checkmate" : "stalemate");
              setNotice(`云库应手：${reply.notation}。${terminalResultLabel(answer.checkmate)}，对局结束。`);
              await finish("free_finished", duration + Date.now() - moveStartedAt);
              return;
            }
            setNotice(`云库应手：${reply.notation}。请继续走棋。`);
          } catch { continueOffline("云库应手无法回放"); }
          finally { setAutoReplyPending(false); }
        })();
      }, AUTO_REPLY_DELAY_MS);
    } catch (error) {
      continueOffline(`云库对练不可用：${error instanceof Error ? error.message : "网络不可用"}`);
    } finally { setFreeMovePending(false); }
  }

  function playTrainingFeedback(previousMoves: string[], iccs: string, onTerminal?: (checkmate: boolean) => void) {
    if (!problem) return;
    void chessPlatform.endgameMoveFeedback(problem.startingFen, previousMoves, iccs)
      .then((feedback) => {
        playMoveFeedbackSound(feedback.terminal ? (feedback.checkmate ? "checkmate" : "stalemate") : feedback.check ? "check" : feedback.captured ? "capture" : "move", preferences.moveSoundEnabled, preferences.moveSoundVolume);
        if (feedback.terminal) { setTerminalFeedback(feedback.checkmate ? "checkmate" : "stalemate"); onTerminal?.(feedback.checkmate); }
      })
      .catch(() => undefined);
  }

  function click(square: Square) {
    if (!problem || revealed || freeMovePending || autoReplyPending || attemptFinished || (!startedAt && elapsedBeforePause > 0)) return;
    const pieceAtSquare = pieces.find((piece) => piece.row === square.row && piece.col === square.col);
    const expectedSource = mode === "free" || mode === "cloud" || !line[0]
      ? undefined
      : moveSquares(line[0].iccs).from;
    const currentMoves = mode === "free" || mode === "cloud" ? freeMoves : playedMoves;
    const movingSide = sideToMove(problem.startingFen, currentMoves);
    const canSelectAsSource = Boolean(pieceAtSquare) && (
      (mode === "free" || mode === "cloud") && pieceAtSquare?.color === movingSide
      || (expectedSource && expectedSource.row === square.row && expectedSource.col === square.col)
    );
    if (!selected) {
      if (canSelectAsSource) setSelected(square);
      else if (pieceAtSquare) setNotice(`当前轮到${movingSide === "red" ? "红" : "黑"}方走棋，请先选择己方棋子。`);
      return;
    }
    // An occupied square is only a new source when it belongs to the side
    // expected to move. An opponent on the destination remains a legal
    // capture target and must fall through to ICCS validation below.
    if (pieceAtSquare && canSelectAsSource) { setSelected(square); return; }
    const moveStartedAt = Date.now();
    const iccs = `${sq(selected)}${sq(square)}`;
    if (mode === "free") {
      setSelected(undefined);
      const durationAfterMove = elapsedBeforePause + (startedAt ? moveStartedAt - startedAt : 0);
      void playFreeMove(iccs, selected, square, durationAfterMove);
      return;
    }
    if (mode === "cloud") {
      setSelected(undefined);
      const durationAfterMove = elapsedBeforePause + (startedAt ? moveStartedAt - startedAt : 0);
      void playCloudMove(iccs, selected, square, durationAfterMove, moveStartedAt);
      return;
    }
    const answer = line.find((move) => move.iccs === iccs);
    setSelected(undefined);
    if (!answer) { setMistakes((value) => value + 1); setNotice("这步不在题解分支中，局面没有改变，可以继续尝试。"); return; }
    if (!startedAt) setStartedAt(moveStartedAt);
    const durationAfterMove = elapsedBeforePause + (startedAt ? moveStartedAt - startedAt : 0);
    setHasAdvanced(true);
    const nextPieces = apply(pieces, iccs);
    let nextLine = answer.children;
    setLast({ from: selected, to: square });
    const nextPlayedMoves = [...playedMoves, iccs];
    playTrainingFeedback(playedMoves, iccs, (checkmate) => {
      setNotice(`正确，${checkmate ? "将死" : "困毙"}，本题结束。`);
      void finish("completed", durationAfterMove);
    });
    setPieces(nextPieces); setPlayedMoves(nextPlayedMoves);
    if (mode !== "solver" || !nextLine.length) {
      setLine(nextLine);
      setNotice("正确，继续完成题解。");
      if (!nextLine.length) void finish("completed", durationAfterMove);
      return;
    }
    const reply = nextLine[0];
    const currentSession = trainingSession.current;
    setLine(nextLine);
    setAutoReplyPending(true);
    setNotice("正确，正在显示对方应手…");
    window.setTimeout(() => {
      if (currentSession !== trainingSession.current || finishingAttempt.current) return;
      void (async () => {
        const replyMoves = [...nextPlayedMoves, reply.iccs];
        const notation = await chessPlatform.endgameChineseMainline(problem.startingFen, replyMoves).then((items) => items.at(-1)).catch(() => reply.iccs);
        if (currentSession !== trainingSession.current || finishingAttempt.current) return;
        setPieces(apply(nextPieces, reply.iccs));
        setLast(moveSquares(reply.iccs));
        playTrainingFeedback(nextPlayedMoves, reply.iccs, (checkmate) => {
          setNotice(`正确，对方${checkmate ? "被将死" : "被困毙"}，本题结束。`);
          void finish("completed", durationAfterMove + Date.now() - moveStartedAt);
        });
        setLine(reply.children);
        setPlayedMoves(replyMoves);
        setAutoReplyPending(false);
        setNotice(`正确，对方应手已自动走出：${notation}。`);
        if (!reply.children.length) await finish("completed", durationAfterMove + Date.now() - moveStartedAt);
      })();
    }, AUTO_REPLY_DELAY_MS);
  }

  function togglePause() {
    if (attemptFinished || autoReplyPending) return;
    if (startedAt) { stopClock(); setNotice("已暂停，暂停时间不会计入本题用时。"); }
    else if (elapsedBeforePause > 0 && !revealed) { setStartedAt(Date.now()); setNotice("继续作答。"); }
  }
  async function restart() { if (!problem) return; await saveUnfinishedAttempt(); startFresh(problem); }
  const next = (offset: number) => { const item = visibleProblems[index + offset]; if (item) void start(item); };
  const descendantFolderIds = (folderId: string): Set<string> => {
    const ids = new Set<string>();
    const collect = (parentId: string) => folders.filter((folder) => normalizedFolderId(folder.parentId) === parentId).forEach((folder) => { ids.add(folder.id); collect(folder.id); });
    collect(folderId);
    return ids;
  };
  const setClampedLibraryRailWidth = (width: number) => setLibraryRailWidth(Math.min(MAX_LIBRARY_RAIL_WIDTH, Math.max(MIN_LIBRARY_RAIL_WIDTH, Math.round(width))));
  const beginLibraryResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = libraryRailWidth;
    const move = (moveEvent: PointerEvent) => setClampedLibraryRailWidth(startWidth + moveEvent.clientX - startX);
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };
  const beginDirectorySplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rail = event.currentTarget.closest(".endgame-library-rail");
    if (!(rail instanceof HTMLElement)) return;
    const bounds = rail.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const next = Math.round(((moveEvent.clientY - bounds.top) / Math.max(1, bounds.height)) * 100);
      setDirectoryTreeRatio(Math.min(68, Math.max(28, next)));
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };
  const folderMoveOptions = (moving?: EndgameFolderDto) => {
    const blocked = moving ? new Set([moving.id, ...descendantFolderIds(moving.id)]) : new Set<string>();
    return folders.filter((folder) => !blocked.has(folder.id));
  };
  const folderPath = (folder: EndgameFolderDto) => {
    const names = [folder.name];
    const visited = new Set([folder.id]);
    let parentId = normalizedFolderId(folder.parentId);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = folders.find((item) => item.id === parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = normalizedFolderId(parent.parentId);
    }
    return names.join(" / ");
  };
  const folderNameById = (folderId?: string) => folderId ? folderPath(folders.find((folder) => folder.id === folderId) ?? { id: folderId, name: "未知目录", createdAt: "" }) : "根目录";
  const openMoveDialog = (action: { kind: "move-folder"; folder: EndgameFolderDto } | { kind: "move-library"; library: EndgameLibraryDto }, currentFolderId?: string | null) => {
    const targetId = currentFolderId ?? "";
    setDirectoryTargetId(targetId);
    setDirectoryTargetExpandedIds(new Set(targetId ? [targetId] : []));
    setDirectoryAction(action);
    setOpenTreeMenu(undefined);
  };
  const problemProgressMeta = (item: EndgameProblemDto) => {
    const status = problemProgress(item);
    if (status === "done") return { className: "done", label: "做对", detail: `累计 ${fmt(item.totalElapsedMs)}` };
    if (status === "tried") return { className: "tried", label: "做过", detail: `${item.attemptCount} 次尝试` };
    return { className: "new", label: "未做", detail: "未练" };
  };
  const renderProblemButton = (problemItem: EndgameProblemDto, source?: EndgameLibraryDto) => {
    const progress = problemProgressMeta(problemItem);
    return <button className={`${problemItem.id === problem?.id ? "active" : ""} ${progress.className}`} key={problemItem.id} onClick={() => void (async () => {
      if (source && source.id !== library?.id) await selectLibrary(source);
      await start(problemItem);
      if (source) setGlobalQuery("");
    })()}><b>{problemItem.sourceIndex + 1}</b><span><strong>{problemItem.title}</strong><small>{source ? `${source.title} · ${problemItem.category}` : `${problemItem.category} · ${progress.detail}`}</small></span><em>{progress.label}</em></button>;
  };
  const renderLibrary = (item: EndgameLibraryDto, depth: number) => {
    const expanded = item.id === expandedLibraryId;
    const siblings = libraries.filter((candidate) => normalizedFolderId(candidate.folderId) === normalizedFolderId(item.folderId));
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === item.id);
    return <section className={`endgame-library-group ${expanded ? "expanded" : ""}`} key={item.id} style={{ marginLeft: `${depth * 16}px` }}>
      <div className="endgame-tree-row"><button className={`endgame-library-parent ${expanded ? "active" : ""}`} aria-expanded={expanded} onClick={() => toggleLibrary(item)}><BookOpen size={15}/><span><strong>{item.title}</strong><small>做过 {item.attemptedCount}/{item.problemCount} · 做对 {item.completedCount}</small></span>{expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button><button className="endgame-tree-move" title={`移动题库 ${item.title}`} onClick={() => openMoveDialog({ kind: "move-library", library: item }, item.folderId)}><FolderInput size={13}/>移动</button><div className="endgame-tree-more"><button className="endgame-tree-action" title={`更多：${item.title}`} aria-label="更多操作" onClick={() => setOpenTreeMenu(openTreeMenu === `library:${item.id}` ? undefined : `library:${item.id}`)}><MoreVertical size={14}/></button>{openTreeMenu === `library:${item.id}` && <div className="endgame-tree-menu"><button disabled={siblingIndex <= 0} onClick={() => { setOpenTreeMenu(undefined); void reorderLibrary(item, true); }}><ArrowUp size={13}/>上移</button><button disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={() => { setOpenTreeMenu(undefined); void reorderLibrary(item, false); }}><ArrowDown size={13}/>下移</button></div>}</div></div>
    </section>;
  };
  const renderFolderChildren = (parentId: string | undefined, depth: number): ReactNode => <>{folders.filter((folder) => normalizedFolderId(folder.parentId) === parentId).map((folder) => {
    const expanded = expandedFolderIds.has(folder.id);
    const libraryCount = libraries.filter((item) => normalizedFolderId(item.folderId) === folder.id).length;
    const siblings = folders.filter((candidate) => normalizedFolderId(candidate.parentId) === parentId);
    const siblingIndex = siblings.findIndex((candidate) => candidate.id === folder.id);
    const selected = selectedFolderId === folder.id;
    return <section className={`endgame-folder-group ${expanded ? "expanded" : ""}`} key={folder.id} style={{ marginLeft: `${depth * 16}px` }}><div className="endgame-tree-row"><button className={`endgame-folder-parent ${selected ? "active" : ""}`} aria-expanded={expanded} onClick={() => toggleFolder(folder.id)}><Folder size={15}/><span>{folder.name}</span>{expanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button><button className="endgame-tree-move" title={`移动目录 ${folder.name}`} onClick={() => openMoveDialog({ kind: "move-folder", folder }, folder.parentId)}><FolderInput size={13}/>移动</button><div className="endgame-tree-more"><button className="endgame-tree-action" title={`更多：${folder.name}`} aria-label="更多操作" onClick={() => setOpenTreeMenu(openTreeMenu === `folder:${folder.id}` ? undefined : `folder:${folder.id}`)}><MoreVertical size={14}/></button>{openTreeMenu === `folder:${folder.id}` && <div className="endgame-tree-menu"><button disabled={siblingIndex <= 0} onClick={() => { setOpenTreeMenu(undefined); void reorderFolder(folder, true); }}><ArrowUp size={13}/>上移</button><button disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1} onClick={() => { setOpenTreeMenu(undefined); void reorderFolder(folder, false); }}><ArrowDown size={13}/>下移</button><button className="danger" onClick={() => { setOpenTreeMenu(undefined); setDeleteTarget({ kind: "folder", id: folder.id, title: folder.name, libraryCount }); }}><Trash2 size={13}/>删除</button></div>}</div></div>{expanded && <div className="endgame-folder-children">{renderFolderChildren(folder.id, depth + 1)}</div>}</section>;
  })}{libraries.filter((item) => normalizedFolderId(item.folderId) === parentId).map((item) => renderLibrary(item, depth))}</>;
  const renderDirectoryTargetTree = (parentId: string | undefined, moving?: EndgameFolderDto, depth = 0): ReactNode => {
    const blocked = moving ? new Set([moving.id, ...descendantFolderIds(moving.id)]) : new Set<string>();
    return <>{folders.filter((folder) => normalizedFolderId(folder.parentId) === parentId && !blocked.has(folder.id)).map((folder) => {
      const expanded = directoryTargetExpandedIds.has(folder.id);
      const selected = directoryTargetId === folder.id;
      const hasChildren = folders.some((child) => normalizedFolderId(child.parentId) === folder.id && !blocked.has(child.id));
      return <section className="endgame-target-node" key={folder.id} style={{ marginLeft: `${depth * 14}px` }}><div><button type="button" className="endgame-target-toggle" disabled={!hasChildren} onClick={() => setDirectoryTargetExpandedIds((current) => { const next = new Set(current); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}>{hasChildren ? expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/> : <span/>}</button><button type="button" className={selected ? "active" : ""} onClick={() => setDirectoryTargetId(folder.id)}><Folder size={13}/>{folder.name}</button></div>{expanded && renderDirectoryTargetTree(folder.id, moving, depth + 1)}</section>;
    })}</>;
  };
  const closeTraining = () => { void saveUnfinishedAttempt().finally(onClose); };

  return <div className="modal-backdrop endgame-backdrop"><section className="endgame-training-dialog" role="dialog" aria-modal="true" aria-label="残局训练工作台">
    <header className="endgame-topbar"><span><Sparkles size={18}/><strong>残局训练</strong><small>{library?.title ?? "本地题库"}</small></span><div className="endgame-topbar-actions">{library && <button title="删除当前题库" onClick={() => setDeleteTarget({ kind: "library", id: library.id, title: library.title })}><Trash2 size={16}/></button>}<button title="关闭" onClick={closeTraining}><X size={19}/></button></div></header>
    {libraries.length === 0 && folders.length === 0 ? <div className="endgame-empty endgame-library-empty"><BookOpen size={32}/><strong>导入本地残局题库</strong><span>选择 CBL 文件后即可按题号练习。</span><div className="endgame-empty-actions"><button className="primary" onClick={() => void importCbl()}>导入 CBL</button><button className="endgame-directory-create" onClick={() => { setDirectoryName(""); setDirectoryAction({ kind: "create" }); }}><FolderPlus size={15}/>新建目录</button></div>{importSummary && <p className="endgame-import-summary">{importSummary}</p>}{importError && <p className="endgame-import-error">导入失败：{importError}</p>}{libraries.map((item) => <button key={item.id} onClick={() => void selectLibrary(item)}>{item.title} · {item.completedCount}/{item.problemCount}</button>)}</div> : <div className="endgame-training-layout" style={{ "--endgame-library-width": `${libraryRailWidth}px` } as CSSProperties}>
      <aside className="endgame-library-rail" style={{ "--endgame-directory-ratio": `${directoryTreeRatio}fr`, "--endgame-problem-ratio": `${100 - directoryTreeRatio}fr` } as CSSProperties}><header><strong>题库目录</strong><small>共 {libraries.length} 本本地题库</small></header><label className="endgame-global-search"><Search size={13}/><input aria-label="搜索全部残局" value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} placeholder="搜索全部残局"/></label><div className="endgame-directory-actions"><button className="endgame-import" onClick={() => void importCbl()}>批量导入 CBL</button><button className="endgame-directory-create" title="在根目录新建目录" onClick={() => { setDirectoryName(""); setDirectoryAction({ kind: "create" }); }}><FolderPlus size={15}/>新建目录</button></div>{globalQuery.trim() ? <div className="endgame-global-results" aria-label="全局残局搜索结果">{globalResults.map(({ library: source, problem: item }) => renderProblemButton(item, source))}{globalResults.length === 0 && <p>未找到匹配残局</p>}</div> : <><div className="endgame-library-tree"><div className="endgame-root-row"><button className={!selectedFolderId ? "active" : ""} aria-expanded={rootExpanded} onClick={() => { setSelectedFolderId(undefined); setRootExpanded((expanded) => !expanded); }}><Folder size={15}/><span>残局题库</span>{rootExpanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>{rootExpanded && <div className="endgame-root-children">{renderFolderChildren(undefined, 0)}</div>}</div><div className="endgame-library-splitter" role="separator" aria-orientation="horizontal" tabIndex={0} onPointerDown={beginDirectorySplitResize} onKeyDown={(event) => { if (event.key === "ArrowUp") { event.preventDefault(); setDirectoryTreeRatio((value) => Math.max(28, value - 5)); } if (event.key === "ArrowDown") { event.preventDefault(); setDirectoryTreeRatio((value) => Math.min(68, value + 5)); } }}/><section className="endgame-selected-problems"><header><strong>{library?.title ?? "未选择题库"}</strong><small>{library ? `做过 ${library.attemptedCount}/${library.problemCount} · 做对 ${library.completedCount}` : "从上方目录选择题库"}</small></header><div className="endgame-filters"><label><Search size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题名"/></label><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((categoryItem) => <option key={categoryItem}>{categoryItem}</option>)}</select><select value={progressFilter} onChange={(event) => setProgressFilter(event.target.value as ProgressFilter)}>{progressFilters.map((item) => <option key={item}>{item}</option>)}</select></div><div className="endgame-problem-list">{library ? visibleProblems.map((problemItem) => renderProblemButton(problemItem)) : <p className="endgame-no-problems">还没有选择题库</p>}{library && visibleProblems.length === 0 && <p className="endgame-no-problems">没有匹配题目</p>}</div></section></>}{importSummary && <p className="endgame-import-summary">{importSummary}</p>}{importError && <p className="endgame-import-error">操作失败：{importError}</p>}</aside>
      <div className="endgame-library-resize-handle" role="separator" aria-label="调整题库目录宽度" aria-orientation="vertical" aria-valuemin={MIN_LIBRARY_RAIL_WIDTH} aria-valuemax={MAX_LIBRARY_RAIL_WIDTH} aria-valuenow={libraryRailWidth} tabIndex={0} onPointerDown={beginLibraryResize} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setClampedLibraryRailWidth(libraryRailWidth - 12); } if (event.key === "ArrowRight") { event.preventDefault(); setClampedLibraryRailWidth(libraryRailWidth + 12); } }}/>
      <main className="endgame-board-stage">{!problem ? <div className="endgame-empty"><BookOpen size={28}/><strong>选择一道残局</strong><span>从左侧题号开始，完成进度会自动保存。</span></div> : <><header className="endgame-problem-heading"><span>第 {problem.sourceIndex + 1}/{problems.length} 题</span><strong>{problem.title}</strong><small>{problem.category}</small><button className="endgame-problem-delete" title="从训练目录移除当前残局" onClick={() => setDeleteTarget({ kind: "problem", id: problem.id, libraryId: problem.libraryId, title: problem.title })}><Trash2 size={15}/></button></header><div className="endgame-board-wrap"><LinkMiniBoard presentation="preview" markerStyle="corner" animateMoves={preferences.moveAnimationEnabled} boardAriaLabel="残局训练棋盘" pieces={pieces} arrows={[]} selectedSquare={selected ?? hintSquare} lastMove={last ? { ...last, movedBy: "红方" } : undefined} pieceAsset={(piece) => `/skins/qingxin-zhuyun/${piece.color === "red" ? "r" : "b"}${piece.kind}.png`} boardAsset={riverText ? boardAssetWithoutRiverText : boardAsset} riverText={riverText} riverTextColor={riverTextColor} riverTextSize={riverTextSize}/><div className="endgame-hit-grid">{Array.from({ length: 90 }, (_, squareIndex) => { const square = { row: Math.floor(squareIndex / 9), col: squareIndex % 9 }; return <button key={squareIndex} aria-label={sq(square)} style={boardIntersectionStyle(square, false, "qingxin-zhuyun")} onClick={() => click(square)}/>; })}</div>{terminalFeedback && <div className={`endgame-terminal-feedback ${terminalFeedback}`} aria-hidden="true"><span>{terminalFeedback === "checkmate" ? "绝杀" : "困毙"}</span></div>}</div><p className="endgame-board-tip">{mode === "cloud" ? "云库对练：走出任意合法着法后，云库自动应手。" : mode === "free" ? "自由实战：双方轮流走任意合法着法。" : "选棋子，再点目标点。错误走法不会改变局面。"}</p></>}</main>
      <aside className="endgame-control-rail">{problem ? <><section className="endgame-clock"><span>本题用时</span><strong>{fmt(elapsed)}</strong><small>累计用时 {fmt(problem.totalElapsedMs)}</small><button className="endgame-attempts-trigger" onClick={() => { setShowAttempts((value) => !value); void loadAttempts(problem.id); }}><History size={13}/>记录</button></section><section className="endgame-mode"><label title="双方按中国象棋规则走子，云库自动走首选应手"><input type="radio" checked={mode === "cloud"} disabled={hasAdvanced || revealed || attemptFinished} onChange={() => setMode("cloud")}/>云库对练</label><label title="只输入解题方着法，系统自动走题解中的对方应手"><input type="radio" checked={mode === "solver"} disabled={hasAdvanced || revealed || attemptFinished} onChange={() => setMode("solver")}/>只走解题方</label><label title="红黑双方都必须按题解逐手复现"><input type="radio" checked={mode === "replay"} disabled={hasAdvanced || revealed || attemptFinished} onChange={() => setMode("replay")}/>双方复现（按题解）</label><label title="双方轮流走任意合法着法，不校验是否进入题解分支"><input type="radio" checked={mode === "free"} disabled={hasAdvanced || revealed || attemptFinished} onChange={() => setMode("free")}/>自由实战</label></section><section className="endgame-actions"><button className="endgame-hint" disabled={attemptFinished || autoReplyPending} onClick={() => { void (async () => { const value = Math.min(3, hints + 1); const lead = line[0]?.iccs; setHints(value); if (value === 1) setNotice(problem.note || "先寻找将军、吃子和强制着。"); else if (!lead) setNotice("题解已完成。"); else if (value === 2) setNotice("提示：棋盘上已标出当前应走棋子。"); else { const notation = await chessPlatform.endgameChineseMainline(problem.startingFen, [...playedMoves, lead]).then((items) => items.at(-1)).catch(() => lead); setNotice(`首着：${notation}`); } })(); }}><Lightbulb size={16}/>提示 {hints}/3</button><button disabled={attemptFinished || autoReplyPending || (!startedAt && elapsedBeforePause === 0)} onClick={togglePause}>{startedAt ? <Pause size={16}/> : <Play size={16}/>}{startedAt ? "暂停" : "继续"}</button><button onClick={() => void restart()}><RotateCcw size={16}/>重来</button>{mode === "cloud" || mode === "free" ? <button disabled={attemptFinished} onClick={() => void finish("free_finished")}>{mode === "cloud" ? "结束对练" : "结束实战"}</button> : <button disabled={attemptFinished} onClick={() => void revealAnswer()}><ListRestart size={16}/>看答案</button>}</section><section className="endgame-status"><span>错误 {mistakes} 次</span>{notice && <p>{renderCblText(notice)}</p>}</section>{showAttempts ? <section className="endgame-attempt-history"><header><strong>答题记录</strong><small>最近 {attempts.length} 次</small></header><div>{attempts.length ? attempts.map((attempt) => <p key={attempt.id}><b>{attemptOutcomeLabel[attempt.outcome] ?? attempt.outcome}</b><span>{attemptModeLabel[attempt.mode] ?? attempt.mode} · {fmt(attempt.elapsedMs)} · 错 {attempt.mistakes} · 提示 {attempt.hintsUsed}</span><small>{attempt.createdAt.replace("T", " ").slice(0, 16)}</small></p>) : <p className="endgame-no-attempts">还没有答题记录</p>}</div></section> : revealed && <section className="endgame-answer"><header><strong>题解回合</strong><small>{answerStep}/{answerMoves.length} 手</small></header><div className="endgame-answer-rounds">{rounds.map((round) => <p key={round.round}><b>第 {round.round} 回合</b><span>{round.first}{round.second ? ` · ${round.second}` : ""}</span></p>)}</div><footer className="endgame-answer-demo"><button onClick={() => setDemoPlaying((value) => !value)} disabled={answerStep >= answerMoves.length}>{demoPlaying ? <Pause size={14}/> : <Play size={14}/>} {demoPlaying ? "暂停演示" : answerStep ? "继续演示" : "演示答案"}</button><button onClick={restartAnswerDemo} disabled={answerStep === 0}><RotateCcw size={14}/>从头</button></footer>{demoSummary && <section className="endgame-demo-summary"><strong>演示总结</strong><p>{renderCblText(demoSummary)}</p></section>}</section>}<footer className="endgame-navigation"><button disabled={index <= 0} title="上一题" onClick={() => next(-1)}><ChevronLeft size={17}/></button><button disabled={index >= visibleProblems.length - 1} title="下一题" onClick={() => next(1)}><ChevronRight size={17}/></button></footer></> : <p>从左侧选择题目。</p>}</aside>
    </div>}{deleteTarget && <div className="endgame-delete-backdrop" role="alertdialog" aria-modal="true" aria-label="确认删除" onMouseDown={() => setDeleteTarget(undefined)}><section className="endgame-delete-confirm" onMouseDown={(event) => event.stopPropagation()}><strong>确认删除</strong><p>{deleteTarget.kind === "library" ? `删除题库《${deleteTarget.title}》及全部本地答题记录？此操作不可恢复。` : deleteTarget.kind === "folder" ? `删除目录“${deleteTarget.title}”？${deleteTarget.libraryCount ? `其中 ${deleteTarget.libraryCount} 本题库会移至上级目录，` : ""}题目与答题记录不会删除。若存在子目录，请先移动或删除子目录。` : `从训练目录移除《${deleteTarget.title}》？已有答题记录会保留在本机。`}</p><footer><button onClick={() => setDeleteTarget(undefined)}>取消</button><button className="danger" onClick={() => void confirmDelete()}>删除</button></footer></section></div>}{directoryAction && <div className="endgame-delete-backdrop" role="dialog" aria-modal="true" aria-label={directoryAction.kind === "create" ? "新建残局目录" : directoryAction.kind === "move-folder" ? "移动残局目录" : "移动残局题库"} onMouseDown={() => setDirectoryAction(undefined)}><section className="endgame-delete-confirm endgame-directory-dialog" onMouseDown={(event) => event.stopPropagation()}><strong>{directoryAction.kind === "create" ? "新建目录" : directoryAction.kind === "move-folder" ? `移动目录：${directoryAction.folder.name}` : `移动题库：${directoryAction.library.title}`}</strong>{directoryAction.kind === "create" ? <label>目录名<input autoFocus value={directoryName} onChange={(event) => setDirectoryName(event.target.value)} placeholder="例如：马类残局"/></label> : <div className="endgame-target-picker"><p>当前位置：{directoryAction.kind === "move-folder" ? folderNameById(directoryAction.folder.parentId ?? undefined) : folderNameById(directoryAction.library.folderId ?? undefined)}</p><p>移动到：{folderNameById(directoryTargetId || undefined)}</p><div className="endgame-target-tree"><button type="button" className={!directoryTargetId ? "active" : ""} onClick={() => setDirectoryTargetId("")}><Folder size={13}/>根目录</button>{renderDirectoryTargetTree(undefined, directoryAction.kind === "move-folder" ? directoryAction.folder : undefined)}</div></div>}<footer><button onClick={() => setDirectoryAction(undefined)}>取消</button><button className="primary" disabled={directoryAction.kind === "create" ? !directoryName.trim() : directoryAction.kind === "move-folder" && directoryTargetId === (directoryAction.folder.parentId ?? "")} onClick={() => void confirmDirectoryAction()}>{directoryAction.kind === "create" ? "创建" : "确认移动"}</button></footer></section></div>}
  </section></div>;
}
