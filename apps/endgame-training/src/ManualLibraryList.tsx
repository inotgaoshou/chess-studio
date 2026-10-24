import type { LocalManualGame } from "./types";

export function ManualLibraryList({ games, selectedId, onOpen, onEdit, onMove, onDelete, onCopy }: {
  games: LocalManualGame[]; selectedId?: string;
  onOpen(game: LocalManualGame): void; onEdit(game: LocalManualGame): void;
  onMove(game: LocalManualGame): void; onDelete(game: LocalManualGame): void; onCopy(game: LocalManualGame): void;
}) {
  return <div className="manual-game-list">{games.length ? games.map((game) => {
    const mirror = game.readOnly || game.origin?.kind === "providerMirror";
    return <div key={game.id} className={`manual-game-card ${selectedId === game.id ? "active" : ""} ${mirror ? "provider-mirror" : ""}`}>
      <button type="button" className="manual-game-open" aria-label={`${mirror ? "查看" : "继续录谱"}：${game.title}`} onClick={() => onOpen(game)}>
        <b>{game.title}{mirror && <em>只读</em>}</b>
        <small>{game.folderPath || "未分类"} · {game.moves.length} 手 · {new Date(game.updatedAt).toLocaleDateString("zh-CN")}</small>
      </button>
      <div className="manual-game-actions">{mirror ? <button type="button" onClick={() => onCopy(game)}>复制</button> : <>
        <button type="button" aria-label={`编辑信息：${game.title}`} onClick={() => onEdit(game)}>编辑</button>
        <button type="button" aria-label={`移动：${game.title}`} onClick={() => onMove(game)}>移动</button>
        <button type="button" aria-label={`删除：${game.title}`} onClick={() => onDelete(game)}>删除</button>
      </>}</div>
    </div>;
  }) : <p>暂无本地棋谱。</p>}</div>;
}
