import { LockKeyhole, Palette, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import type { DesktopPreferencesDto } from "./platform";
import { ACCOUNT_SKINS, ASSET_SKINS } from "./skinAccess";

type Skin = DesktopPreferencesDto["boardSkin"];
type SkinTab = "board" | "piece";
const boards: Array<[Skin, string, string]> = [["original", "默认棋盘", "浅色木纹默认棋盘"], ["classic", "暖木立体", "温润木纹与浮雕边框"], ["neon", "赛博棋阵", "蓝光赛博棋线"], ["jade", "翡翠庭院", "青玉庭院棋盘"], ["imperial", "朱墙宫阙", "朱金宫廷棋盘"], ["hongmu", "红木鎏金", "深色红木与金色棋线"], ["jingdian", "经典雅致", "传统棋盘与经典棋子"], ["xinghe", "霓虹星河", "赛博星空与蓝紫棋线"]];
const pieces: Array<[Skin, string, string]> = [["original", "默认棋子", "经典红黑默认棋子"], ["classic", "暖木立体", "木雕浮雕与柔和投影"], ["neon", "赛博光子", "红蓝能量棋子"], ["jade", "翡翠琉璃", "青玉琉璃棋子"], ["imperial", "鎏金宫廷", "金红宫廷棋子"], ["hongmu", "红木鎏金", "金色立体红黑棋子"], ["jingdian", "经典雅致", "传统棋盘与经典棋子"], ["xinghe", "霓虹星河", "赛博蓝光与红蓝棋子"]];

export function SkinShopDialog({ preferences, signedIn, onClose, onPreview, onEquip }: { preferences: DesktopPreferencesDto; signedIn: boolean; onClose(): void; onPreview(patch?: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">): void; onEquip(patch: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">): void }) {
  const [tab, setTab] = useState<SkinTab>("board");
  const [memberSkin, setMemberSkin] = useState(false);
  const isBoard = tab === "board";
  const sectionTitle = memberSkin ? isBoard ? "登录皮肤" : "登录棋子" : "基础皮肤";
  const items = (isBoard ? boards : pieces).filter(([skin]) => memberSkin ? ACCOUNT_SKINS.includes(skin) : !ACCOUNT_SKINS.includes(skin));
  const patchFor = (skin: Skin) => isBoard
    ? { boardSkin: skin, pieceSkin: preferences.pieceSkin }
    : { boardSkin: preferences.boardSkin, pieceSkin: skin };
  const cards = items.map(([skin, title, detail]) => {
    const active = isBoard ? preferences.boardSkin === skin : preferences.pieceSkin === skin;
    const previewPieceSkin = isBoard ? preferences.pieceSkin : skin;
    const patch = patchFor(skin);
    return <article className="skin-shop-card" key={skin} onPointerEnter={() => onPreview(patch)} onPointerLeave={() => onPreview()}><div className={`skin-preview board-skin-${isBoard ? skin : preferences.boardSkin} piece-skin-${previewPieceSkin}`}><div/>{isBoard ? <span>楚河</span> : <img src={ASSET_SKINS.includes(previewPieceSkin) ? `/skins/${previewPieceSkin}/rk.png` : "/skins/default/rk.png"} alt="棋子预览"/>}</div><strong>{title}</strong><small>{detail}</small><button className={active ? "active" : ""} disabled={active} onClick={() => onEquip(patch)}>{active ? "使用中" : "使用"}</button></article>;
  });
  return <div className="skin-shop-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="skin-shop" role="dialog" aria-modal="true" aria-label="装扮坊">
      <header><span><ShoppingBag size={18}/><strong>装扮坊</strong><small>皮肤库</small></span><button className="tool-button" title="关闭" onClick={onClose}><X size={16}/></button></header>
      <nav aria-label="皮肤类别"><button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}><Palette size={15}/>棋盘</button><button className={tab === "piece" ? "active" : ""} onClick={() => setTab("piece")}><span className="shop-piece-icon">将</span>棋子</button></nav>
      <div className={`skin-shop-section ${memberSkin ? "exclusive" : ""}`}>
        <div className="skin-shop-section-heading"><strong>{sectionTitle}</strong><small>{memberSkin ? signedIn ? "已登录可用" : "登录后可用" : "无需登录"}</small><div className="skin-shop-source-tabs" role="tablist" aria-label="皮肤来源"><button role="tab" aria-selected={!memberSkin} className={!memberSkin ? "active" : ""} onClick={() => setMemberSkin(false)}>基础皮肤</button><button role="tab" aria-selected={memberSkin} className={memberSkin ? "active" : ""} onClick={() => setMemberSkin(true)}><LockKeyhole size={13}/>{isBoard ? "登录皮肤" : "登录棋子"}</button></div></div>
        {memberSkin && !signedIn
          ? <div className="skin-shop-locked"><LockKeyhole size={22}/><strong>登录后可使用专享皮肤</strong><small>登录账号后可在这里选择经典雅致和霓虹星河。</small></div>
          : <div className="skin-shop-grid">{cards}</div>}
      </div>
    </section>
  </div>;
}
