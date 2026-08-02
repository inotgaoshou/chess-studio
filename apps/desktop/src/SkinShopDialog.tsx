import { LockKeyhole, Palette, ShoppingBag, X } from "lucide-react";
import { useState } from "react";
import type { DesktopPreferencesDto } from "./platform";
import { normalizeSkinId, skinAssetFolder, skinCatalogFor } from "./skinAccess";

type Skin = DesktopPreferencesDto["boardSkin"];
type SkinTab = "board" | "piece";
type SkinPatch = Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">;

export function SkinShopDialog({ preferences, signedIn, onClose, onPreview, onEquip }: { preferences: DesktopPreferencesDto; signedIn: boolean; onClose(): void; onPreview(patch?: SkinPatch): void; onEquip(patch: SkinPatch): void }) {
  const [tab, setTab] = useState<SkinTab>("board");
  const [memberSkin, setMemberSkin] = useState(false);
  const isBoard = tab === "board";
  const sectionTitle = memberSkin ? isBoard ? "登录皮肤" : "登录棋子" : "基础皮肤";
  const currentBoardSkin = normalizeSkinId(preferences.boardSkin);
  const currentPieceSkin = normalizeSkinId(preferences.pieceSkin);
  const items = skinCatalogFor(isBoard ? "board" : "piece").filter((skin) => memberSkin ? skin.memberOnly : !skin.memberOnly);
  const patchFor = (skin: Skin): SkinPatch => isBoard
    ? skin === "default"
      ? { boardSkin: "default", pieceSkin: "default" }
      : { boardSkin: skin, pieceSkin: currentPieceSkin }
    : { boardSkin: currentBoardSkin, pieceSkin: skin };
  const cards = items.map(({ folder, title, detail }) => {
    const active = isBoard ? currentBoardSkin === folder : currentPieceSkin === folder;
    const skin = folder as Skin;
    const patch = patchFor(skin);
    const previewPieceSkin = isBoard ? patch.pieceSkin : skin;
    return <article className="skin-shop-card" key={skin} onPointerEnter={() => onPreview(patch)} onPointerLeave={() => onPreview()}><div className={`skin-preview board-skin-${isBoard ? skin : currentBoardSkin} piece-skin-${previewPieceSkin}`}><div/>{isBoard ? <span>楚河</span> : <img src={`/skins/${skinAssetFolder(previewPieceSkin)}/rk.png`} alt="棋子预览"/>}</div><strong>{title}</strong><small>{detail}</small><button className={active ? "active" : ""} disabled={active} onClick={() => onEquip(patch)}>{active ? "使用中" : "使用"}</button></article>;
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
