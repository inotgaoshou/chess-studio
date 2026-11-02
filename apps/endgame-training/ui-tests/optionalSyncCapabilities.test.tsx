import { afterEach, expect, it, vi } from "vitest";

import { teachingClient } from "../src/teaching";
let fixtureNumber = 0;
afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

async function client(capabilities: string[]) {
  const userId = `test-user-${++fixtureNumber}`;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url=String(input);
    return new Response(JSON.stringify(
    url.endsWith("/auth/login")
      ? { token: "test-token", expiresAt: "2099-01-01", user: { id: userId, orgId: "test-org", role: "student" } }
      : url.endsWith("/capabilities") ? { capabilities }
      : url.endsWith("/status") ? { gameCount: 2, folderCount: 1, analysisCount: 0, conflictCount: 0 }
      : { records: [], conflictCount: 0 },
  ), { status: 200, headers: { "content-type": "application/json" } });
  });
  await teachingClient.login("test", "test");
  return { teachingClient, fetcher };
}

it("avoids missing optional endpoints while ordinary personal sync stays available", async () => {
  const { teachingClient: c, fetcher } = await client([]);
  await expect(c.personalManualSyncStatus()).rejects.toThrow("暂不提供云端同步统计");
  await expect(c.providerManualMirrors()).rejects.toThrow("尚未开放");
  await expect(c.syncPersonalManuals([], [], [])).resolves.toMatchObject({ records: [] });
  const urls = fetcher.mock.calls.map(args => String(args[0]));
  expect(urls.filter(url => url.endsWith("/capabilities"))).toHaveLength(1);
  expect(urls.some(url => /\/(status|provider-imports)$/.test(url))).toBe(false);
});

it("reads real data when the service advertises the corresponding capability", async () => {
  const { teachingClient: c } = await client(["personal_manual_sync_status", "personal_provider_imports"]);
  await expect(c.personalManualSyncStatus()).resolves.toMatchObject({ gameCount: 2 });
  await expect(c.providerManualMirrors()).resolves.toMatchObject({ records: [] });
});
