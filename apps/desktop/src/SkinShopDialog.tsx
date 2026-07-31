import { Palette, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import type { DesktopPreferencesDto } from "./platform";

type Skin = DesktopPreferencesDto["boardSkin"];
const boards: Array<[Skin, string, string]> = [["original", "默认棋盘", "最初的深色棋盘"], ["classic", "暖木立体", "温润木纹与浮雕边框"], ["neon", "霓虹星空", "蓝光星空棋线"], ["jade", "翡翠庭院", "青玉庭院棋盘"], ["imperial", "朱墙宫阙", "朱金宫廷棋盘"]];
const pieces: Array<[Skin, string, string]> = [["original", "默认棋子", "最初的红黑棋子"], ["classic", "暖木立体", "木雕浮雕与柔和投影"], ["neon", "霓虹发光", "红蓝发光棋子"], ["jade", "翡翠琉璃", "青玉琉璃棋子"], ["imperial", "鎏金宫廷", "金红宫廷棋子"]];

export function SkinShopDialog({ preferences, onClose, onEquip }: { preferences: DesktopPreferencesDto; onClose(): void; onEquip(patch: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">): void }) {
  const [tab, setTab] = useState<"board" | "piece">("board");
  const items = tab === "board" ? boards : pieces;
  return <div className="skin-shop-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="skin-shop" role="dialog" aria-modal="true" aria-label="装扮坊">
      <header><span><ShoppingBag size={18}/><strong>装扮坊</strong><small>本地皮肤</small></span><button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button></header>
      <nav><button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}><Palette size={15}/>棋盘</button><button className={tab === "piece" ? "active" : ""} onClick={() => setTab("piece")}><span className="shop-piece-icon">将</span>棋子</button></nav>
      <div className="skin-shop-grid">{items.map(([skin, title, detail]) => {
        const active = tab === "board" ? preferences.boardSkin === skin : preferences.pieceSkin === skin;
        return <article className="skin-shop-card" key={skin}><div className={`skin-preview board-skin-${tab === "board" ? skin : preferences.boardSkin} piece-skin-${tab === "piece" ? skin : preferences.pieceSkin}`}><div/>{tab === "piece" ? <img src="/skins/default/rk.png" alt="棋子预览"/> : <span>楚河</span>}</div><strong>{title}</strong><small>{detail}</small><button className={active ? "active" : ""} disabled={active} onClick={() => onEquip(tab === "board" ? { boardSkin: skin, pieceSkin: preferences.pieceSkin } : { boardSkin: preferences.boardSkin, pieceSkin: skin })}>{active ? "使用中" : "使用"}</button></article>;
      })}</div>
    </section>
  </div>;
}
