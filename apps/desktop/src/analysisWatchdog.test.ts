import { describe, expect, it } from "vitest";
import { analysisFirstCandidateTimeoutMs, normalizeMobileCloudAnalysisPreferences } from "./App";

describe("analysis first-candidate watchdog", () => {
  it("allows the non-streaming web engine response to complete", () => {
    expect(analysisFirstCandidateTimeoutMs("web")).toBe(15_000);
    expect(analysisFirstCandidateTimeoutMs("desktop")).toBe(3_000);
  });

  it("migrates the previous mobile default depth once", () => {
    const legacy = {
      serverUrl: "http://127.0.0.1:8080",
      token: "",
      multipv: 2,
      searchMode: "depth" as const,
      searchValue: 30,
      autoAnalyze: false,
    };
    const migrated = normalizeMobileCloudAnalysisPreferences(legacy, true);

    expect(migrated).toMatchObject({ searchValue: 20, mobileDefaultDepthVersion: 1 });
    expect(normalizeMobileCloudAnalysisPreferences({ ...migrated, searchValue: 30 }, true).searchValue).toBe(30);
  });
});
