import type { DesktopPreferencesDto } from "./platform";

export type SkinId = DesktopPreferencesDto["boardSkin"];

export const ACCOUNT_SKINS: SkinId[] = ["jingdian", "xinghe"];
export const ASSET_SKINS: SkinId[] = ["hongmu", ...ACCOUNT_SKINS];

export function skinAssetFolder(skin: SkinId) {
  return ASSET_SKINS.includes(skin) ? skin : "default";
}

export function requiresSignInForSkinPatch(
  current: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">,
  patch: Pick<DesktopPreferencesDto, "boardSkin" | "pieceSkin">,
) {
  const selectsLockedBoard = ACCOUNT_SKINS.includes(patch.boardSkin) && patch.boardSkin !== current.boardSkin;
  const selectsLockedPiece = ACCOUNT_SKINS.includes(patch.pieceSkin) && patch.pieceSkin !== current.pieceSkin;
  return selectsLockedBoard || selectsLockedPiece;
}
