import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Bot, CalendarDays, ChevronDown, Database, Hand, Pause, Play, RefreshCw, ShieldCheck, Square, Trophy, Undo2, Zap } from "lucide-react";
import { ReferencePositionPanel } from "./ReferencePositionPanel";
import type { PositionMoveStatDto, ReferenceGameSummaryDto } from "./platform/types";
import {
  referenceSparringLevelLabel,
  referenceSparringLevelProfile,
  referenceSparringLevels,
  type ReferenceSparringOptions,
  type ReferenceSparringState,
} from "./ReferenceSparring";

const MASTER_OPENING_QUERY_DEBOUNCE_MS = 220;
const MASTER_OPENING_FOCUS_DEBOUNCE_MS = 120;
const MASTER_OPENING_DEFAULT_GAME_LIMIT = 10;
const MASTER_OPENING_FILTERED_GAME_LIMIT = 50;
const MASTER_FILTER_PRESETS = ["特大", "大师"] as const;

type Props = {
  fen: string;
  enabled: boolean;
  panelMode?: "opening" | "sparring";
  queryMoves(fen: string): Promise<PositionMoveStatDto[]>;
  queryGames(fen: string, options?: { query?: string; limit?: number; offset?: number }): Promise<ReferenceGameSummaryDto[]>;
  resolveMoveFen(fen: string, iccs: string): Promise<string | undefined>;
  onPreviewMove(iccs: string, notation: string): void;
  onAddMove(iccs: string): void;
  onOpenExplorer(): void;
  onOpenGame(gameId: string): void;
  sparring?: ReferenceSparringState;
  onUpdateSparring?(options: Partial<ReferenceSparringOptions>): void;
  onStartSparring?(options: ReferenceSparringOptions): void;
  onPauseSparring?(): void;
  onResumeSparring?(): void;
  onStopSparring?(): void;
  onScoreSparring?(): void;
  onRetrySparring?(): void;
  onManualContinueSparring?(): void;
};

function resultWord(result: string) {
  return result === "1-0" ? "胜" : result === "0-1" ? "负" : result === "1/2-1/2" ? "和" : "对";
}

function resultTone(result: string) {
  return result === "1-0" ? "win" : result === "0-1" ? "loss" : result === "1/2-1/2" ? "draw" : "unknown";
}

function gameDateLabel(value: string) {
  return value?.trim() || "日期不详";
}

function openingLabel(game: ReferenceGameSummaryDto) {
  if (!game.openingCode) return "待分类";
  return game.openingName ? `${game.openingCode} · ${game.openingName}` : game.openingCode;
}

function playerMark(name: string, fallback: string) {
  return (name || fallback).trim().slice(0, 1) || fallback.slice(0, 1);
}

function cleanPlayerText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/\^[A-Za-z]/g, "")
    .replace(/[□?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchText(value: string) {
  return cleanPlayerText(value).toLocaleLowerCase().replace(/\s+/g, "");
}

function filterAliases(token: string) {
  if (token === "特大") return ["特大", "特级", "特级大师", "象棋特级大师"];
  if (token === "大师") return ["大师", "象棋大师", "国家大师", "特大", "特级大师"];
  return [token];
}

function filterTokens(keyword: string) {
  return cleanPlayerText(keyword)
    .toLocaleLowerCase()
    .split(/[\s，,、;；|]+/)
    .map((token) => normalizeSearchText(token))
    .filter(Boolean);
}

function databaseQueryForMasterFilter(keyword: string) {
  const first = filterTokens(keyword)[0];
  if (!first) return undefined;
  if (first === "特大") return "特级";
  return first;
}

const ORGANIZATION_PREFIX = /^(?:[\u4e00-\u9fffA-Za-z0-9·（）()]+?(?:大学|学院|学校|中学|棋院|俱乐部|协会|代表队|队|省|市|县|区))+/;

function personName(value: string | undefined, fallback: string) {
  const cleaned = cleanPlayerText(value || "");
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1] || fallback;
  const withoutOrganization = cleaned.replace(ORGANIZATION_PREFIX, "").trim();
  return withoutOrganization || cleaned || fallback;
}

function playerOutcome(game: ReferenceGameSummaryDto) {
  const title = cleanPlayerText(game.title || "");
  const match = title.match(/^(.+?)\s*(胜|负|和)\s*(.+)$/);
  if (match) {
    return {
      red: personName(match[1], "红方未详"),
      black: personName(match[3], "黑方未详"),
      result: match[2],
      tone: match[2] === "胜" ? "win" : match[2] === "负" ? "loss" : "draw",
    };
  }
  return {
    red: personName(game.redPlayer, "红方未详"),
    black: personName(game.blackPlayer, "黑方未详"),
    result: resultWord(game.result),
    tone: resultTone(game.result),
  };
}

function renderPlayerOutcome(game: ReferenceGameSummaryDto, opening?: string) {
  const outcome = playerOutcome(game);
  return <span className="reference-player-pair master-opening-player-outcome" aria-label={`${outcome.red} ${outcome.result} ${outcome.black}`}>
    <i className="reference-player red" title={`红方：${outcome.red}`}><mark aria-hidden="true">红</mark>{outcome.red}</i>
    {" "}<em className={`reference-result ${outcome.tone}`}>{outcome.result}</em>{" "}
    <i className="reference-player black" title={`黑方：${outcome.black}`}><mark aria-hidden="true">黑</mark>{outcome.black}</i>
    {opening && <em className="reference-opening-label" title={opening}>{opening}</em>}
  </span>;
}

function gameSearchText(game: ReferenceGameSummaryDto) {
  const outcome = playerOutcome(game);
  return normalizeSearchText([
    outcome.red,
    outcome.black,
    game.redPlayer,
    game.blackPlayer,
    game.title,
    game.eventName,
    game.roundName,
    game.opening,
    game.openingCode,
    game.openingName,
  ].filter(Boolean).join(" "));
}

function filterGamesByMasterKeyword(games: ReferenceGameSummaryDto[], keyword: string) {
  const tokens = filterTokens(keyword);
  if (tokens.length === 0) return games;
  return games.filter((game) => {
    const haystack = gameSearchText(game);
    return tokens.every((token) => filterAliases(token).some((alias) => haystack.includes(normalizeSearchText(alias))));
  });
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round(value * 100 / total) : 0;
}

function sparringStatusLabel(state: ReferenceSparringState) {
  switch (state.status) {
    case "user_turn": return "轮到你";
    case "reference_thinking":
      if (state.phase === "cloud") return "云库兜底中";
      if (state.phase === "engine") return "Pikafish 兜底中";
      return "参考库思考中";
    case "paused": return "已暂停";
    case "finished": return "已结束";
    default: return "未开始";
  }
}

function sparringSideLabel(side: "red" | "black") {
  return side === "red" ? "红方" : "黑方";
}

function sparringDelayLabel(delayMs: number) {
  if (delayMs <= 300) return "快";
  if (delayMs >= 900) return "慢";
  return "正常";
}

function sparringChoiceDetail(state: ReferenceSparringState) {
  const choice = state.lastChoice;
  if (!choice) return undefined;
  if (choice.source === "reference") {
    return `${choice.move.samples.toLocaleString()} 样本 · 执方胜率 ${Math.round(choice.winRate * 100)}%`;
  }
  if (choice.source === "cloud" && choice.winRate !== .5) {
    return `云库参考胜率 ${Math.round(choice.winRate * 100)}%`;
  }
  return "引擎首选着";
}

export function MasterOpeningPanel({
  fen,
  enabled,
  panelMode = "opening",
  queryMoves,
  queryGames,
  resolveMoveFen,
  onPreviewMove,
  onAddMove,
  onOpenExplorer,
  onOpenGame,
  sparring,
  onUpdateSparring,
  onStartSparring,
  onPauseSparring,
  onResumeSparring,
  onStopSparring,
  onScoreSparring,
  onRetrySparring,
  onManualContinueSparring,
}: Props) {
  const generation = useRef(0);
  const gameCache = useRef(new Map<string, ReferenceGameSummaryDto[]>());
  const focusTimer = useRef<number | undefined>(undefined);
  const levelHelpRef = useRef<HTMLLabelElement>(null);
  const lastRefresh = useRef(0);
  const gameQueryFenRef = useRef(fen);
  const [games, setGames] = useState<ReferenceGameSummaryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState<string>();
  const [selectedMove, setSelectedMove] = useState<PositionMoveStatDto>();
  const [matchScope, setMatchScope] = useState("当前局面");
  const [viewMode, setViewMode] = useState<"compact" | "detail">("compact");
  const [masterFilter, setMasterFilter] = useState("");
  const [hasMoreGames, setHasMoreGames] = useState(false);
  const [levelHelpOpen, setLevelHelpOpen] = useState(false);
  const [sparringSettingsOpen, setSparringSettingsOpen] = useState(true);
  const filteredGames = useMemo(() => filterGamesByMasterKeyword(games, masterFilter), [games, masterFilter]);
  const hasMasterFilter = normalizeSearchText(masterFilter).length > 0;
  const gamePageLimit = hasMasterFilter ? MASTER_OPENING_FILTERED_GAME_LIMIT : MASTER_OPENING_DEFAULT_GAME_LIMIT;
  const gameDatabaseQuery = databaseQueryForMasterFilter(masterFilter);
  const matchCountLabel = hasMasterFilter ? `${filteredGames.length}/${games.length}` : `${games.length}`;

  useEffect(() => {
    if (!enabled || panelMode !== "opening") {
      generation.current += 1;
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      setLoading(false);
      return;
    }
    const request = ++generation.current;
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    const forceRefresh = refresh !== lastRefresh.current;
    lastRefresh.current = refresh;
    const cacheKey = `${fen}|${normalizeSearchText(masterFilter)}|${gamePageLimit}|0`;
    const cached = gameCache.current.get(cacheKey);
    setSelectedMove(undefined);
    setMatchScope("当前局面");
    gameQueryFenRef.current = fen;
    if (cached && !forceRefresh) {
      setGames(cached);
      setSelectedGameId((selected) => selected && cached.some((item) => item.id === selected) ? selected : cached[0]?.id);
      setHasMoreGames(cached.length === gamePageLimit);
      setError("");
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      setHasMoreGames(false);
      void queryGames(fen, { query: gameDatabaseQuery, limit: gamePageLimit, offset: 0 }).then((items) => {
        if (request !== generation.current) return;
        gameCache.current.set(cacheKey, items);
        setGames(items);
        setHasMoreGames(items.length === gamePageLimit);
        setSelectedGameId((selected) => selected && items.some((item) => item.id === selected) ? selected : items[0]?.id);
      }).catch((cause) => {
        if (request !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (request === generation.current) setLoading(false);
      });
    }, MASTER_OPENING_QUERY_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
    };
  }, [enabled, panelMode, fen, refresh, masterFilter, gamePageLimit, gameDatabaseQuery]);

  useEffect(() => {
    if (!levelHelpOpen) return;
    function closeFromOutside(event: PointerEvent) {
      if (!levelHelpRef.current?.contains(event.target as Node)) setLevelHelpOpen(false);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setLevelHelpOpen(false);
    }
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [levelHelpOpen]);

  useEffect(() => {
    if (!sparring) return;
    if (sparring.status === "idle" || sparring.status === "finished") {
      setSparringSettingsOpen(true);
    } else {
      setSparringSettingsOpen(false);
    }
  }, [sparring?.status]);

  async function focusMove(move: PositionMoveStatDto) {
    setSelectedMove(move);
    setMatchScope(`走 ${move.notation} 后`);
    onPreviewMove(move.iccs, move.notation);
    const request = ++generation.current;
    setError("");
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      setLoading(true);
      void (async () => {
        try {
          const nextFen = await resolveMoveFen(fen, move.iccs);
          if (request !== generation.current) return;
          const queryFen = nextFen || fen;
          gameQueryFenRef.current = queryFen;
          const cacheKey = `${queryFen}|${normalizeSearchText(masterFilter)}|${gamePageLimit}|0`;
          const cached = gameCache.current.get(cacheKey);
          if (cached) {
            setGames(cached);
            setHasMoreGames(cached.length === gamePageLimit);
            setSelectedGameId((selected) => selected && cached.some((item) => item.id === selected) ? selected : cached[0]?.id);
            return;
          }
          const items = await queryGames(queryFen, { query: gameDatabaseQuery, limit: gamePageLimit, offset: 0 });
          if (request !== generation.current) return;
          gameCache.current.set(cacheKey, items);
          setGames(items);
          setHasMoreGames(items.length === gamePageLimit);
          setSelectedGameId((selected) => selected && items.some((item) => item.id === selected) ? selected : items[0]?.id);
        } catch (cause) {
          if (request !== generation.current) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          if (request === generation.current) setLoading(false);
        }
      })();
    }, MASTER_OPENING_FOCUS_DEBOUNCE_MS);
  }

  function resetMoveScope() {
    setSelectedMove(undefined);
    setRefresh((value) => value + 1);
  }

  async function loadMoreGames() {
    if (loading || loadingMore) return;
    const request = ++generation.current;
    setLoadingMore(true);
    setError("");
    try {
      const items = await queryGames(gameQueryFenRef.current, { query: gameDatabaseQuery, limit: gamePageLimit, offset: games.length });
      if (request !== generation.current) return;
      setGames((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...items.filter((item) => !known.has(item.id))];
      });
      setHasMoreGames(items.length === gamePageLimit);
    } catch (cause) {
      if (request !== generation.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }

  if (!enabled) return null;
  const decided = selectedMove ? selectedMove.redWins + selectedMove.draws + selectedMove.blackWins : 0;
  const sparringBusy = sparring?.status === "user_turn" || sparring?.status === "reference_thinking";
  const sparringOptions = sparring ? {
    userSide: sparring.userSide,
    level: sparring.level,
    delayMs: sparring.delayMs,
    autoReport: sparring.autoReport,
  } : undefined;
  const sparringProfile = sparring ? referenceSparringLevelProfile(sparring.level) : undefined;
  const sparringChoiceDetailText = sparring ? sparringChoiceDetail(sparring) : undefined;
  const sparringSettingsExpanded = !!sparring && (sparring.status === "idle" || sparring.status === "finished" || sparringSettingsOpen);
  const showSparringPauseActions = !!sparring?.pauseReason && sparring.status === "paused";
  const showOpeningTools = panelMode === "opening";
  const showSparringTools = panelMode === "sparring" && sparring;
  return <aside className="master-opening-side-panel" aria-label="大师开局局面搜索">
    <section className={`master-opening-panel mode-${panelMode}`}>
      <header className="master-opening-header">
        <div>
          <span>{panelMode === "sparring" ? <Bot size={16}/> : <BookOpen size={16}/>}<strong>{panelMode === "sparring" ? "随机对练" : "大师开局"}</strong></span>
          <small>{panelMode === "sparring" ? "参考库按等级随机出招，棋谱可复盘和 AI 打分" : "当前局面自动匹配本地参考实战库"}</small>
        </div>
        <nav>
          {showOpeningTools && <button type="button" title="刷新当前局面" aria-label="刷新当前局面" onClick={() => setRefresh((value) => value + 1)}><RefreshCw size={14}/></button>}
          {showOpeningTools && <button type="button" title="打开完整布局探索" aria-label="打开完整布局探索" onClick={onOpenExplorer}><Database size={14}/></button>}
        </nav>
      </header>

      {showSparringTools && <section className={`master-opening-sparring standalone ${sparring.status}`.trim()} aria-label="参考库随机对练">
        <header>
          <span><Bot size={14}/><strong>随机对练</strong><small>{sparringStatusLabel(sparring)}</small></span>
          <em>{referenceSparringLevelLabel(sparring.level)}</em>
        </header>
        <button
          type="button"
          className="sparring-settings-summary"
          aria-expanded={sparringSettingsExpanded}
          onClick={() => setSparringSettingsOpen((open) => !open)}
        >
          <span>{referenceSparringLevelLabel(sparring.level)}</span>
          <span>我执{sparringSideLabel(sparring.userSide)}</span>
          <span>{sparringDelayLabel(sparring.delayMs)}</span>
          {sparring.autoReport && <span>结束打分</span>}
          <ChevronDown size={13}/>
        </button>
        {sparringSettingsExpanded && <div className="master-opening-sparring-controls">
            <label>我执
              <select
                value={sparring.userSide}
                disabled={sparringBusy}
                onChange={(event) => onUpdateSparring?.({ userSide: event.currentTarget.value as "red" | "black" })}
              >
                <option value="red">红方</option>
                <option value="black">黑方</option>
              </select>
            </label>
            <label className="sparring-level-field" ref={levelHelpRef}><span className="sparring-field-heading">等级
              <button
                type="button"
                className="sparring-level-help-button"
                aria-label="查看随机对练等级说明"
                aria-expanded={levelHelpOpen}
                onClick={(event) => {
                  event.preventDefault();
                  setLevelHelpOpen((open) => !open);
                }}
              >?</button>
            </span>
              <select
                value={sparring.level}
                disabled={sparringBusy}
                title={sparringProfile?.description}
                onChange={(event) => onUpdateSparring?.({ level: event.currentTarget.value as ReferenceSparringState["level"] })}
              >
                {referenceSparringLevels.map((level) => <option key={level} value={level}>{referenceSparringLevelLabel(level)}</option>)}
              </select>
              {levelHelpOpen && <div className="sparring-level-help-popover" role="dialog" aria-label="随机对练等级说明">
                <strong>模拟等级说明</strong>
                <ul>
                  {referenceSparringLevels.map((level) => {
                    const profile = referenceSparringLevelProfile(level);
                    return <li key={level}><b>{profile.label}</b><span>{profile.description}</span></li>;
                  })}
                </ul>
              </div>}
            </label>
            <label>延迟
              <select
                value={sparring.delayMs}
                disabled={sparringBusy}
                onChange={(event) => onUpdateSparring?.({ delayMs: Number(event.currentTarget.value) })}
              >
                <option value={250}>快</option>
                <option value={600}>正常</option>
                <option value={1000}>慢</option>
              </select>
            </label>
            <label className="auto-report">
              <input
                type="checkbox"
                checked={sparring.autoReport}
                disabled={sparringBusy}
                onChange={(event) => onUpdateSparring?.({ autoReport: event.currentTarget.checked })}
              />
              结束打分
            </label>
          </div>}
        <div className="sparring-turn-card" data-phase={sparring.phase ?? "idle"}>
          <strong>{sparringStatusLabel(sparring)}</strong>
          <p>{sparring.message || `${sparringSideLabel(sparring.userSide)}由你走，系统用本地参考库样本随机应招。`}</p>
        </div>
        {sparring.lastChoice && <small
          className={`sparring-choice-summary source-${sparring.lastChoice.source}`}
          title={[
            `来源：${sparring.lastChoice.sourceLabel}`,
            sparring.lastChoice.source === "reference" ? "执方胜率按当前走子方统计，和棋按收益折算；不是样本占比或引擎评分。" : undefined,
            sparring.lastChoice.intelligenceNote,
            sparring.lastChoice.fallbackReason,
          ].filter(Boolean).join(" · ")}
        >
          <span className="sparring-choice-source">来源：{sparring.lastChoice.sourceLabel}</span>
          <span>上步：{sparring.lastChoice.move.notation || sparring.lastChoice.move.iccs}</span>
          {sparringChoiceDetailText && <span>{sparringChoiceDetailText}</span>}
          {sparring.lastChoice.intelligenceNote && <span className="sparring-choice-intelligence">智能校正</span>}
        </small>}
        {sparring.lastChoice?.warningMessage && <p className="sparring-fallback-warning">{sparring.lastChoice.warningMessage}</p>}
        {showSparringPauseActions && <div className="sparring-paused-actions" role="group" aria-label="无候选后的操作">
          <button type="button" onClick={onManualContinueSparring}><Hand size={12}/>手动继续</button>
          <button type="button" onClick={onRetrySparring}><RefreshCw size={12}/>重试</button>
        </div>}
        <footer>
          {sparring.status === "idle" || sparring.status === "finished"
            ? <button type="button" className="primary" onClick={() => sparringOptions && onStartSparring?.(sparringOptions)}><Play size={13}/>开始</button>
            : sparring.status === "paused"
              ? <button type="button" className="primary" onClick={onResumeSparring}><Play size={13}/>继续</button>
              : <button type="button" onClick={onPauseSparring}><Pause size={13}/>暂停</button>}
          <button type="button" disabled={sparring.status === "idle"} onClick={onStopSparring}><Square size={12}/>结束</button>
          <button type="button" disabled={sparring.status === "idle"} onClick={onScoreSparring}><Zap size={13}/>{sparring.status === "finished" ? "AI 打分" : "结束并打分"}</button>
        </footer>
      </section>}

      {showOpeningTools && <ReferencePositionPanel
        fen={fen}
        enabled={enabled}
        query={queryMoves}
        onPreview={() => undefined}
        onAdd={onAddMove}
        onFocusMove={(move) => void focusMove(move)}
        selectedMoveIccs={selectedMove?.iccs}
        onOpenExplorer={onOpenExplorer}
        title="候选着法"
        subtitle="样本胜率"
        maxMoves={8}
        refreshToken={refresh}
        className="master-opening-moves"
      />}

      {showOpeningTools && <section className={`master-opening-matches ${loading ? "is-refreshing" : ""}`.trim()} aria-label="命中棋谱" aria-busy={loading}>
        <header>
          <span><ShieldCheck size={14}/><strong>命中棋谱</strong><small>{loading ? `${matchScope} · 更新中` : `${matchScope} · ${matchCountLabel} 条摘要`}</small></span>
          {selectedMove && <button type="button" title="回到当前局面匹配" aria-label="回到当前局面匹配" onClick={resetMoveScope}><Undo2 size={13}/>当前局面</button>}
        </header>
        {selectedMove && <div className="master-opening-selected-move">
          <span><strong>{selectedMove.notation}</strong><small>{selectedMove.samples.toLocaleString()} 局样本</small></span>
          <i className="reference-result-bar" aria-label={`红胜 ${percent(selectedMove.redWins, decided)}%，和棋 ${percent(selectedMove.draws, decided)}%，黑胜 ${percent(selectedMove.blackWins, decided)}%`}>
            <b className="red" style={{ width: `${percent(selectedMove.redWins, decided)}%` }}/>
            <b className="draw" style={{ width: `${percent(selectedMove.draws, decided)}%` }}/>
            <b className="black" style={{ width: `${percent(selectedMove.blackWins, decided)}%` }}/>
          </i>
          <em>红 {percent(selectedMove.redWins, decided)}% · 和 {percent(selectedMove.draws, decided)}% · 黑 {percent(selectedMove.blackWins, decided)}%</em>
        </div>}
        <div className="master-opening-match-toolbar">
          <span>{selectedMove ? "候选着法关联棋谱" : "当前局面关联棋谱"}</span>
          <nav aria-label="命中棋谱显示方式">
            <button type="button" className={viewMode === "detail" ? "active" : ""} onClick={() => setViewMode("detail")}>详细</button>
            <button type="button" className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")}>简洁</button>
          </nav>
        </div>
        <div className="master-opening-filter-bar" aria-label="大师棋谱筛选">
          <input
            value={masterFilter}
            onChange={(event) => setMasterFilter(event.currentTarget.value)}
            placeholder="筛选大师/棋手名"
            aria-label="按大师或棋手名字筛选命中棋谱"
          />
          <nav aria-label="大师快捷筛选">
            {MASTER_FILTER_PRESETS.map((preset) => <button
              type="button"
              key={preset}
              className={normalizeSearchText(masterFilter) === normalizeSearchText(preset) ? "active" : ""}
              onClick={() => setMasterFilter((value) => normalizeSearchText(value) === normalizeSearchText(preset) ? "" : preset)}
            >{preset}</button>)}
            {hasMasterFilter && <button type="button" className="clear" onClick={() => setMasterFilter("")}>清除</button>}
          </nav>
        </div>
        {loading && games.length === 0 ? <p>正在匹配当前局面的实战棋谱…</p>
          : error && games.length === 0 ? <p className="error">{error}</p>
          : games.length === 0 ? <p>当前局面暂无命中棋谱；可继续走几步后自动缩小范围。</p>
          : filteredGames.length === 0 ? <p>没有匹配“{masterFilter}”的棋谱；可换大师名字，或清除筛选查看全部 {games.length} 条。</p>
          : <div className={`master-opening-game-list ${viewMode}`}>
            {filteredGames.map((game) => <button
              type="button"
              key={game.id}
              className={game.id === selectedGameId ? "active" : ""}
              onClick={() => {
                setSelectedGameId(game.id);
                onOpenGame(game.id);
              }}
              title={`${game.redPlayer || "红方"} - ${game.blackPlayer || "黑方"}`}
            >
              {viewMode === "detail" ? <>
                <i className="master-opening-versus" aria-hidden="true"><b className="red">{playerMark(game.redPlayer, "红")}</b><em>VS</em><b className="black">{playerMark(game.blackPlayer, "黑")}</b></i>
                <strong>{game.title || `${game.redPlayer || "红方"} 对 ${game.blackPlayer || "黑方"}`}</strong>
                {renderPlayerOutcome(game, openingLabel(game))}
                <small><Trophy size={11}/>{game.eventName || "赛事不详"}{game.roundName ? ` · ${game.roundName}` : ""}</small>
                <small><CalendarDays size={11}/>{gameDateLabel(game.gameDate)} · {game.moveCount} 手</small>
              </> : <>
                <i className="master-opening-versus compact" aria-hidden="true"><b className="red">{playerMark(game.redPlayer, "红")}</b><b className="black">{playerMark(game.blackPlayer, "黑")}</b></i>
                {renderPlayerOutcome(game)}
              </>}
              {viewMode === "detail" && <em className="master-opening-preview-label">预览</em>}
            </button>)}
            {hasMoreGames && <button type="button" className="master-opening-load-more" disabled={loadingMore} onClick={() => void loadMoreGames()}>
              {loadingMore ? "正在加载更多…" : hasMasterFilter ? "继续搜索数据库" : "查看更多命中棋谱"}
            </button>}
          </div>}
      </section>}
    </section>
  </aside>;
}
