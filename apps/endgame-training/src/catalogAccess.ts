export const BASIC_TEACHING_ENTRIES = ["basic_mates", "mate_series", "checking_mates", "quiet_mates"] as const;

type Account = { user: { role: string; vipActive?: boolean; vipExpiresAt?: string | null } };

export function hasActiveCatalogVip(auth?: Account): boolean {
  return Boolean(auth?.user.vipActive && (!auth.user.vipExpiresAt || Date.parse(auth.user.vipExpiresAt) > Date.now()));
}

export function canBrowsePlatformSources(auth?: Account): boolean {
  return Boolean(auth && (["coach", "admin"].includes(auth.user.role) || (auth.user.role === "student" && hasActiveCatalogVip(auth))));
}

export function basicEntryOrder(entry?: string): number {
  return BASIC_TEACHING_ENTRIES.findIndex(value => value === entry);
}
