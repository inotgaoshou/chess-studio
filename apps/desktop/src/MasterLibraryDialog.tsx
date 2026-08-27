import { useEffect, useMemo, useState } from "react";
import { BookOpen, Database, RefreshCw, Search, Swords, X, Zap } from "lucide-react";
import type { MasterGameSummaryDto, MasterLibraryFilters, MasterLibraryStatsDto, MasterOpeningProfileDto, MasterPlayerDto, SyncAccountDto } from "./platform";

type Props = {
  account: SyncAccountDto;
  onClose(): void;
  onOpenGame(gameId: string, options?: { analyze: boolean }): Promise<void>;
  onStudyGame?(gameId: string): void;
  listPlayers(query?: string, options?: { limit?: number; offset?: number }): Promise<MasterPlayerDto[]>;
  getStats(query?: string): Promise<MasterLibraryStatsDto>;
  getOpeningProfile?(playerId: string): Promise<MasterOpeningProfileDto>;
  listGames(playerId: string, query?: string, options?: { limit?: number; offset?: number }, filters?: MasterLibraryFilters): Promise<MasterGameSummaryDto[]>;
};

const playerPageSize = 8;
const gamePageSize = 20;

function sideLabel(value?: string) {
  return value === "red" ? "执红" : value === "black" ? "执黑" : "参战";
}

function gameDateLabel(value?: string) {
  return value?.trim() || "日期未知";
}

function gameTitle(game: MasterGameSummaryDto) {
  return game.title?.trim() || `${game.redPlayer} vs ${game.blackPlayer}`;
}

export function MasterLibraryDialog({ account, onClose, onOpenGame, onStudyGame, listPlayers, getStats, getOpeningProfile, listGames }: Props) {
  const [playerQuery, setPlayerQuery] = useState("");
  const [gameQuery, setGameQuery] = useState("");
  const [playerPage, setPlayerPage] = useState(0);
  const [gamePage, setGamePage] = useState(0);
  const [side, setSide] = useState<MasterLibraryFilters["side"]>();
  const [opening, setOpening] = useState<MasterLibraryFilters["opening"]>();
  const [year, setYear] = useState("");
  const [players, setPlayers] = useState<MasterPlayerDto[]>([]);
  const [stats, setStats] = useState<MasterLibraryStatsDto>();
  const [openingProfile, setOpeningProfile] = useState<MasterOpeningProfileDto>();
  const [games, setGames] = useState<MasterGameSummaryDto[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [openingGameId, setOpeningGameId] = useState<string>();
  const [openingAction, setOpeningAction] = useState<"open" | "analyze">("open");
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [playerSearchSubmitVersion, setPlayerSearchSubmitVersion] = useState(0);
  const [gameSearchSubmitVersion, setGameSearchSubmitVersion] = useState(0);
  const selectedPlayer = useMemo(
    () => players.find((player) => player.id === selectedPlayerId),
    [players, selectedPlayerId],
  );
  const playerHasPrevious = playerPage > 0;
  const matchedPlayers = stats?.matchedPlayers;
  const playerPageCount = matchedPlayers == null ? undefined : Math.max(1, Math.ceil(matchedPlayers / playerPageSize));
  const playerHasNext = playerPageCount == null
    ? players.length === playerPageSize
    : playerPage + 1 < playerPageCount;
  const gameHasPrevious = gamePage > 0;
  const gameLastPage = selectedPlayer && !gameQuery.trim()
    ? Math.max(0, Math.ceil(selectedPlayer.gameCount / gamePageSize) - 1)
    : 0;
  const gameHasNext = selectedPlayer
    ? gameQuery.trim()
      ? games.length === gamePageSize
      : gamePage * gamePageSize + games.length < selectedPlayer.gameCount
    : false;
  const gameCanJumpToLast = !!selectedPlayer && !gameQuery.trim() && gamePage < gameLastPage;
  const gamePageLabel = selectedPlayer && !gameQuery.trim()
    ? `第 ${gamePage + 1} / ${Math.max(1, Math.ceil(selectedPlayer.gameCount / gamePageSize))} 页`
    : `第 ${gamePage + 1} 页`;
  const filters = useMemo<MasterLibraryFilters | undefined>(() => {
    const parsedYear = Number(year);
    const value = { side, opening, year: Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100 ? parsedYear : undefined };
    return value.side || value.opening || value.year ? value : undefined;
  }, [opening, side, year]);
  const serviceUnavailableHint = error.includes("大师棋谱服务不可用")
    ? "本机大师谱服务未启动。请先启动 MySQL，再在项目目录运行 scripts/dev-server.sh start。"
    : undefined;

  useEffect(() => {
    let disposed = false;
    setBusy(true);
    setError("");
    const timer = window.setTimeout(() => {
      void listPlayers(playerQuery, { limit: playerPageSize, offset: playerPage * playerPageSize })
        .then((items) => {
          if (disposed) return;
          setPlayers(items);
          setSelectedPlayerId((current) => current && items.some((item) => item.id === current) ? current : items[0]?.id);
        })
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!disposed) setBusy(false);
        });
    }, 220);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [listPlayers, playerPage, playerQuery, playerSearchSubmitVersion, refreshVersion]);

  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(() => {
      void getStats(playerQuery)
        .then((value) => { if (!disposed) setStats(value); })
        .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    }, 220);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [getStats, playerQuery, playerSearchSubmitVersion, refreshVersion]);

  useEffect(() => {
    let disposed = false;
    if (selectedPlayer?.name !== "赵鑫鑫" || !getOpeningProfile) { setOpeningProfile(undefined); return () => { disposed = true; }; }
    void getOpeningProfile(selectedPlayer.id)
      .then((value) => { if (!disposed) setOpeningProfile(value); })
      .catch(() => { if (!disposed) setOpeningProfile(undefined); });
    return () => { disposed = true; };
  }, [getOpeningProfile, selectedPlayer]);

  useEffect(() => {
    if (!selectedPlayerId) {
      setGames([]);
      return;
    }
    let disposed = false;
    setBusy(true);
    setError("");
    const timer = window.setTimeout(() => {
      const pageOptions = { limit: gamePageSize, offset: gamePage * gamePageSize };
      const request = filters
        ? listGames(selectedPlayerId, gameQuery, pageOptions, filters)
        : listGames(selectedPlayerId, gameQuery, pageOptions);
      void request
        .then((items) => {
          if (!disposed) setGames(items);
        })
        .catch((cause) => {
          if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!disposed) setBusy(false);
        });
    }, 220);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [filters, gamePage, gameQuery, gameSearchSubmitVersion, listGames, refreshVersion, selectedPlayerId]);

  function refreshLibrary() {
    setError("");
    setSelectedPlayerId(undefined);
    setGames([]);
    setRefreshVersion((version) => version + 1);
  }

  function submitPlayerSearch() {
    setPlayerPage(0);
    setPlayerSearchSubmitVersion((version) => version + 1);
  }

  function submitGameSearch() {
    setGamePage(0);
    setGameSearchSubmitVersion((version) => version + 1);
  }

  async function openGame(game: MasterGameSummaryDto, analyze: boolean) {
    setOpeningGameId(game.id);
    setOpeningAction(analyze ? "analyze" : "open");
    setError("");
    try {
      await onOpenGame(game.id, { analyze });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpeningGameId(undefined);
    }
  }

  return (
    <div className="report-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !openingGameId) onClose(); }}>
      <section className="master-library-dialog" role="dialog" aria-modal="true" aria-label="大师棋谱">
        <header>
          <div>
            <Database size={18}/>
            <span>
              <strong>大师棋谱</strong>
              <small>{account.email ? `服务端账号：${account.email}` : "公开大师棋谱库"}</small>
            </span>
          </div>
          <div>
            <button className="tool-button" title="重新连接大师棋谱服务" disabled={busy || !!openingGameId} onClick={refreshLibrary}><RefreshCw size={16}/></button>
            <button className="tool-button" title="关闭" disabled={!!openingGameId} onClick={onClose}><X size={16}/></button>
          </div>
        </header>

        <div className="master-library-body">
            <aside className="master-player-panel">
              <form className="master-search" role="search" aria-label="搜索大师" onSubmit={(event) => { event.preventDefault(); submitPlayerSearch(); }}>
                <Search size={14}/>
                <input value={playerQuery} placeholder="搜索大师，如 赵鑫鑫 / 王天一" onChange={(event) => { setPlayerQuery(event.target.value); setPlayerPage(0); }}/>
                <button type="submit" disabled={busy || !!openingGameId}>搜索大师</button>
              </form>
              <p className="master-player-summary" aria-live="polite">
                {stats ? playerQuery.trim()
                  ? `匹配 ${stats.matchedPlayers.toLocaleString("zh-CN")} 位棋手 · 全库 ${stats.totalPlayers.toLocaleString("zh-CN")} 位`
                  : `已收录 ${stats.totalPlayers.toLocaleString("zh-CN")} 位棋手 · ${stats.totalGames.toLocaleString("zh-CN")} 盘棋谱`
                  : "正在统计棋手数量…"}
              </p>
              <div className="master-player-list" aria-label="大师列表">
                {players.map((player) => (
                  <button key={player.id} className={player.id === selectedPlayerId ? "active" : ""} onClick={() => { setSelectedPlayerId(player.id); setGameQuery(""); setGamePage(0); }}>
                    <span><strong>{player.name}</strong><small>公开大师库 · {player.gameCount} 盘</small></span>
                    <em>{player.gameCount} 局</em>
                  </button>
                ))}
                {!players.length && !busy && <p>没有匹配的大师。</p>}
              </div>
              <nav className="master-pagination" aria-label="大师分页">
                <button type="button" disabled={!playerHasPrevious || busy} onClick={() => setPlayerPage(0)}>首页</button>
                <button type="button" disabled={!playerHasPrevious || busy} onClick={() => setPlayerPage((page) => Math.max(0, page - 1))}>上一页</button>
                <span>{playerPageCount ? `第 ${playerPage + 1} / ${playerPageCount} 页` : `第 ${playerPage + 1} 页`}</span>
                <button type="button" disabled={!playerHasNext || busy} onClick={() => setPlayerPage((page) => page + 1)}>下一页</button>
              </nav>
            </aside>

            <main className={`master-game-panel ${selectedPlayer?.name === "赵鑫鑫" ? "has-study-card" : ""}`}>
              <div className="master-game-toolbar">
                <div>
                  <strong>{selectedPlayer?.name ?? "请选择大师"}</strong>
                  <small>{selectedPlayer ? `${selectedPlayer.gameCount} 盘已入库 · 可打开查看，也可直接分析打分` : "从左侧选择大师"}</small>
                </div>
                <form className="master-search" role="search" aria-label="搜索棋谱" onSubmit={(event) => { event.preventDefault(); submitGameSearch(); }}>
                  <Search size={14}/>
                  <input value={gameQuery} disabled={!selectedPlayerId} placeholder="搜赛事 / 对手 / 标题" onChange={(event) => { setGameQuery(event.target.value); setGamePage(0); }}/>
                  <button type="submit" disabled={!selectedPlayerId || busy || !!openingGameId}>搜索棋谱</button>
                </form>
              </div>
              <div className="master-game-filters" aria-label="棋谱筛选">
                <select aria-label="执棋方筛选" value={side ?? ""} disabled={!selectedPlayerId} onChange={(event) => { setSide((event.target.value || undefined) as MasterLibraryFilters["side"]); setGamePage(0); }}>
                  <option value="">红黑不限</option><option value="red">仅执红</option><option value="black">仅执黑</option>
                </select>
                <select aria-label="布局体系筛选" value={opening ?? ""} disabled={!selectedPlayerId} onChange={(event) => { setOpening((event.target.value || undefined) as MasterLibraryFilters["opening"]); setGamePage(0); }}>
                  <option value="">布局不限</option><option value="middle-cannon">中炮</option><option value="third-pawn">挺三兵</option><option value="middle-cannon-third-pawn">中炮三兵</option>
                </select>
                <input aria-label="年份筛选" value={year} disabled={!selectedPlayerId} inputMode="numeric" placeholder="年份" maxLength={4} onChange={(event) => { setYear(event.target.value.replace(/\D/g, "")); setGamePage(0); }}/>
                {!!filters && <button type="button" onClick={() => { setSide(undefined); setOpening(undefined); setYear(""); setGamePage(0); }}>清除筛选</button>}
              </div>
              {selectedPlayer?.name === "赵鑫鑫" && <aside className="master-zhao-study-card" aria-label="赵鑫鑫布局专题">
                <div><strong>赵鑫鑫布局专题</strong><small>先看布局目标和兵线，再用实战验证候选着。</small></div>
                {openingProfile && <p>已入库 {openingProfile.gameCount} 局：红 {openingProfile.redGames} / 黑 {openingProfile.blackGames}，胜 {openingProfile.wins} / 和 {openingProfile.draws} / 负 {openingProfile.losses}。</p>}
                <p>中炮三兵：先完成中路出子与三兵空间扩张，重点比较黑方的反击条件、兑车时机和横车转移。</p>
                <footer><button type="button" onClick={() => { setOpening("middle-cannon-third-pawn"); setGamePage(0); }}>筛选中炮三兵实战</button><button type="button" onClick={() => onStudyGame?.("book-game-53-hong-zhi-huang-shiqing")}>进入三兵飞刀课</button></footer>
              </aside>}

              <div className="master-library-status" aria-live="polite">
                {error ? <p className="master-library-error" role="alert">{serviceUnavailableHint ?? error}</p>
                  : busy ? <p className="master-library-loading"><RefreshCw className="spin" size={15}/>正在查询服务端大师库…</p>
                    : <span/>}
              </div>

              <div className="master-game-list" aria-label="大师棋谱列表">
                {games.map((game) => (
                  <article className="master-game-card" key={game.id}>
                    <div className="master-game-heading">
                      <strong>{gameTitle(game)}</strong>
                      <small>{gameDateLabel(game.gameDate)} · {game.eventName ?? "赛事未知"} · {game.moveCount} 手</small>
                    </div>
                    <p><span className={game.masterSide === "red" ? "master-side" : ""}>红：{game.redPlayer}</span><span className={game.masterSide === "black" ? "master-side" : ""}>黑：{game.blackPlayer}</span><em>{game.result}</em></p>
                    {!!game.openingTags?.length && <small className="master-opening-tags">{game.openingTags.map((tag) => tag === "middle-cannon-third-pawn" ? "中炮三兵" : tag === "middle-cannon" ? "中炮" : "挺三兵").join(" · ")}</small>}
                    <footer>
                      <small>{sideLabel(game.masterSide)}</small>
                      <div className="master-game-actions">
                        {game.id === "dpxq-m-6008" && <button type="button" disabled={!!openingGameId} onClick={() => onStudyGame?.(game.id)}><Swords size={14}/>拆解学习</button>}
                        <button type="button" disabled={!!openingGameId} onClick={() => void openGame(game, false)}>
                          {openingGameId === game.id && openingAction === "open" ? <RefreshCw className="spin" size={14}/> : <BookOpen size={14}/>}
                          {openingGameId === game.id && openingAction === "open" ? "打开中…" : "打开棋谱"}
                        </button>
                        <button type="button" className="primary" disabled={!!openingGameId} onClick={() => void openGame(game, true)}>
                          {openingGameId === game.id && openingAction === "analyze" ? <RefreshCw className="spin" size={14}/> : <Zap size={14}/>}
                          {openingGameId === game.id && openingAction === "analyze" ? "分析中…" : "分析打分"}
                        </button>
                      </div>
                    </footer>
                  </article>
                ))}
                {!games.length && !busy && selectedPlayer && <p className="master-library-empty-inline">没有匹配棋谱，换个关键词试试。</p>}
              </div>
              <nav className="master-pagination master-game-pagination" aria-label="棋谱分页">
                <button type="button" disabled={!gameHasPrevious || busy || !selectedPlayerId} onClick={() => setGamePage(0)}>首页</button>
                <button type="button" disabled={!gameHasPrevious || busy || !selectedPlayerId} onClick={() => setGamePage((page) => Math.max(0, page - 1))}>上一页</button>
                <span>{selectedPlayer ? `${gamePageLabel} · 本页 ${games.length} 盘` : "请选择大师"}</span>
                <button type="button" disabled={!gameHasNext || busy || !selectedPlayerId} onClick={() => setGamePage((page) => page + 1)}>下一页</button>
                <button type="button" disabled={!gameCanJumpToLast || busy || !selectedPlayerId} onClick={() => setGamePage(gameLastPage)}>末页</button>
              </nav>
            </main>
        </div>
      </section>
    </div>
  );
}
