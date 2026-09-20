export type SkinCatalogItem = {
  id: string;
  name: string;
  source: "folder" | "zip";
  supportsCustomRiverText: boolean;
  group?: "2d" | "3d";
};

export const DEFAULT_SKIN_ID = "qingxin-zhuyun";
export const LEGACY_DEFAULT_SKIN_ID = "skin-bb439484";

export const SKIN_CATALOG = [
  {
    "id": "qingxin-zhuyun",
    "name": "清新竹韵",
    "source": "folder",
    "supportsCustomRiverText": false
  },
  {
    "id": "skin-bb439484",
    "name": "枫木",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "2d"
  },
  {
    "id": "skin-8b6b4eeb",
    "name": "黑金",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "2d"
  },
  {
    "id": "skin-8871865b",
    "name": "金丝楠",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "2d"
  },
  {
    "id": "skin-efb016e6",
    "name": "竞技",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "3d"
  },
  {
    "id": "skin-f71dbfdb",
    "name": "青瓷",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "3d"
  },
  {
    "id": "skin-a84084f7",
    "name": "青铜",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "2d"
  },
  {
    "id": "skin-a48d1624",
    "name": "赛博",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "3d"
  },
  {
    "id": "skin-ca04de9d",
    "name": "碳纤",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "3d"
  },
  {
    "id": "skin-da64d5ba",
    "name": "曜石",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "3d"
  },
  {
    "id": "skin-bad031d6",
    "name": "紫金",
    "source": "zip",
    "supportsCustomRiverText": false,
    "group": "2d"
  }
] as const satisfies readonly SkinCatalogItem[];

export function normalizeSkinId(value: string | null | undefined) {
  return SKIN_CATALOG.some((skin) => skin.id === value) ? value as string : DEFAULT_SKIN_ID;
}

export function skinById(value: string | null | undefined) {
  const id = normalizeSkinId(value);
  return SKIN_CATALOG.find((skin) => skin.id === id) ?? SKIN_CATALOG[0];
}
