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
  { folder: "default", title: "默认", boardDetail: "默认棋盘文件夹", pieceDetail: "默认棋子文件夹" },
  { folder: "hongmu", title: "红木鎏金", boardDetail: "深色红木与金色棋线", pieceDetail: "金色立体红黑棋子" },
  { folder: "qingxin-zhuyun", title: "清新竹韵", boardDetail: "竹纹浅色棋盘与清爽绿意", pieceDetail: "清新竹韵红黑棋子" },
  { folder: "jingdian", title: "经典雅致", boardDetail: "传统棋盘与经典棋子", pieceDetail: "传统棋盘与经典棋子", memberOnly: true },
  { folder: "xinghe", title: "霓虹星河", boardDetail: "赛博星空与蓝紫棋线", pieceDetail: "赛博蓝光与红蓝棋子", memberOnly: true },
];

export const SKIN_FOLDERS = SKIN_CATALOG.map((skin) => skin.folder);
export const ACCOUNT_SKINS: SkinFolder[] = SKIN_CATALOG.filter((skin) => skin.memberOnly).map((skin) => skin.folder);
export const ASSET_SKINS: SkinFolder[] = SKIN_FOLDERS;

export function normalizeSkinId(skin: SkinId): SkinFolder {
  return SKIN_FOLDERS.includes(skin as SkinFolder) ? skin as SkinFolder : "default";
}

export function skinAssetFolder(skin: SkinId) {
  return normalizeSkinId(skin);
}

export function skinCatalogFor(scope: SkinScope) {
  return SKIN_CATALOG.map((skin) => ({
    folder: skin.folder,
    title: skin.folder === "default" ? scope === "board" ? "默认棋盘" : "默认棋子" : skin.title,
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
