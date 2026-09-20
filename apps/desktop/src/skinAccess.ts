import type { DesktopPreferencesDto, SkinFolder, SkinId } from "./platform";

export type SkinScope = "board" | "piece";
export type SkinCatalogItem = {
  folder: SkinFolder;
  title: string;
  boardDetail: string;
  pieceDetail: string;
  memberOnly?: boolean;
};

export const SKIN_CATALOG: SkinCatalogItem[] = [
  { folder: "default", title: "经典", boardDetail: "经典木纹棋盘", pieceDetail: "经典红黑棋子" },
  { folder: "hongmu", title: "红木鎏金", boardDetail: "深色红木与金色棋线", pieceDetail: "金色立体红黑棋子" },
  { folder: "qingxin-zhuyun", title: "清新竹韵", boardDetail: "竹纹浅色棋盘与清爽绿意", pieceDetail: "清新竹韵红黑棋子" },
  { folder: "skin-bb439484", title: "1 枫木", boardDetail: "2D 枫木棋盘", pieceDetail: "2D 枫木棋子" },
  { folder: "skin-8b6b4eeb", title: "2 黑金", boardDetail: "2D 黑金棋盘", pieceDetail: "2D 黑金棋子" },
  { folder: "skin-8871865b", title: "3 金丝楠", boardDetail: "2D 金丝楠棋盘", pieceDetail: "2D 金丝楠棋子" },
  { folder: "skin-efb016e6", title: "4 竞技 3D", boardDetail: "3D 竞技棋盘", pieceDetail: "3D 竞技棋子" },
  { folder: "skin-f71dbfdb", title: "5 青瓷 3D", boardDetail: "3D 青瓷棋盘", pieceDetail: "3D 青瓷棋子" },
  { folder: "skin-a84084f7", title: "6 青铜", boardDetail: "2D 青铜棋盘", pieceDetail: "2D 青铜棋子" },
  { folder: "skin-a48d1624", title: "7 赛博 3D", boardDetail: "3D 赛博棋盘", pieceDetail: "3D 赛博棋子" },
  { folder: "skin-ca04de9d", title: "8 碳纤 3D", boardDetail: "3D 碳纤棋盘", pieceDetail: "3D 碳纤棋子" },
  { folder: "skin-da64d5ba", title: "9 曜石 3D", boardDetail: "3D 曜石棋盘", pieceDetail: "3D 曜石棋子" },
  { folder: "skin-bad031d6", title: "10 紫金", boardDetail: "2D 紫金棋盘", pieceDetail: "2D 紫金棋子" },
  { folder: "jingdian", title: "经典雅致", boardDetail: "传统棋盘与经典棋子", pieceDetail: "传统棋盘与经典棋子", memberOnly: true },
  { folder: "xinghe", title: "霓虹星河", boardDetail: "赛博星空与蓝紫棋线", pieceDetail: "赛博蓝光与红蓝棋子", memberOnly: true },
];

export const DEFAULT_SKIN: SkinFolder = "qingxin-zhuyun";
export const SKIN_FOLDERS = SKIN_CATALOG.map((skin) => skin.folder);
export const ACCOUNT_SKINS: SkinFolder[] = SKIN_CATALOG.filter((skin) => skin.memberOnly).map((skin) => skin.folder);
export const ASSET_SKINS: SkinFolder[] = SKIN_FOLDERS;

export function normalizeSkinId(skin: SkinId): SkinFolder {
  return SKIN_FOLDERS.includes(skin as SkinFolder) ? skin as SkinFolder : DEFAULT_SKIN;
}

export function skinAssetFolder(skin: SkinId) {
  return normalizeSkinId(skin);
}

export function skinCatalogFor(scope: SkinScope) {
  return SKIN_CATALOG.map((skin) => ({
    folder: skin.folder,
    title: skin.folder === DEFAULT_SKIN ? scope === "board" ? "默认棋盘" : "默认棋子" : skin.title,
    detail: scope === "board" ? skin.boardDetail : skin.pieceDetail,
    memberOnly: Boolean(skin.memberOnly),
  }));
}

export function requiresSignInForSkinPatch(
  current: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">,
  patch: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">,
) {
  const currentBoardSkin = normalizeSkinId(current.boardSkin);
  const currentPieceSkin = normalizeSkinId(current.pieceSkin);
  const patchBoardSkin = normalizeSkinId(patch.boardSkin);
  const patchPieceSkin = normalizeSkinId(patch.pieceSkin);
  const selectsLockedBoard = ACCOUNT_SKINS.includes(patchBoardSkin) && patchBoardSkin !== currentBoardSkin;
  const selectsLockedPiece = ACCOUNT_SKINS.includes(patchPieceSkin) && patchPieceSkin !== currentPieceSkin;
  return selectsLockedBoard || selectsLockedPiece;
}
