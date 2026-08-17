import { describe, expect, it } from "vitest";
import { analysisFirstCandidateTimeoutMs } from "./App";

describe("analysis first-candidate watchdog", () => {
  it("allows the non-streaming web engine response to complete", () => {
    expect(analysisFirstCandidateTimeoutMs("web")).toBe(15_000);
    expect(analysisFirstCandidateTimeoutMs("desktop")).toBe(3_000);
  });
});
