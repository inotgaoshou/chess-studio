import { describe, expect, it } from "vitest";
import { analysisFirstCandidateTimeoutMs, mobileCandidateArrowLines, normalizeMobileCloudAnalysisPreferences, shouldQueueWebAnalysisReplacement } from "./App";

describe("analysis first-candidate watchdog", () => {
  it("allows the non-streaming web engine response to complete", () => {
    expect(analysisFirstCandidateTimeoutMs("web")).toBe(15_000);
    expect(analysisFirstCandidateTimeoutMs("desktop")).toBe(3_000);
  });

  it("queues a replacement mobile analysis instead of aborting the in-flight server search", () => {
    expect(shouldQueueWebAnalysisReplacement("web", true)).toBe(true);
    expect(shouldQueueWebAnalysisReplacement("web", false)).toBe(false);
    expect(shouldQueueWebAnalysisReplacement("desktop", true)).toBe(false);
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

  it("uses one root move per candidate and respects the configured MultiPV count", () => {
    const lines = [
      { multipv: 3, pv: ["b9c7", "h0g2"] },
      { multipv: 1, pv: ["h9g7", "b0c2"] },
      { multipv: 2, pv: ["b9a7", "h0g2"] },
    ];
    expect(mobileCandidateArrowLines(lines, 2).map((line) => line.pv[0])).toEqual(["h9g7", "b9a7"]);
    expect(mobileCandidateArrowLines(lines, 1).map((line) => line.pv[0])).toEqual(["h9g7"]);
  });
});
