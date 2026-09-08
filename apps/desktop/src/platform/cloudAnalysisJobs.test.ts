import { describe, expect, it, vi } from "vitest";

import { runCloudAnalysisJob } from "./cloudAnalysisJobs";

describe("cloud analysis jobs", () => {
  it("creates, polls, and labels a completed cloud result", async () => {
    const responses = [
      { jobId: "job-1", status: "queued", source: "cloud", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", cacheHit: false },
      { jobId: "job-1", status: "running", source: "cloud", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", cacheHit: false, progress: { depth: 6, candidateCount: 1 } },
      { jobId: "job-1", status: "completed", source: "cloud", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", cacheHit: false, result: { engine: "Pikafish", elapsedMs: 30, lines: [{ depth: 8, scoreCp: 12, multipv: 1, pv: ["h2e2"] }] } },
    ];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, _init) => new Response(JSON.stringify(responses.shift()), {
      status: responses.length === 2 ? 202 : 200,
      headers: { "content-type": "application/json" },
    }));

    const completed = await runCloudAnalysisJob({
      baseUrl: "https://analysis.example.com",
      headers: { authorization: "Bearer token" },
      request: { fen: "fen", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", budget: { mode: "depth", value: 8 }, multiPv: 1 },
      fetchImpl,
      pollDelayMs: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://analysis.example.com/api/v1/analysis/jobs");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://analysis.example.com/api/v1/analysis/jobs/job-1");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      engineVersion: "Pikafish-test",
      nnueVersion: "nnue-test",
    });
    expect(completed.lines[0]).toMatchObject({
      scoreCp: 12,
      source: "cloud",
      engineVersion: "Pikafish-test",
      nnueVersion: "nnue-test",
      cached: false,
    });
  });

  it("cancels the server job when the caller aborts", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const payload = url.endsWith("/cancel")
        ? { jobId: "job-2", status: "cancelled" }
        : { jobId: "job-2", status: "queued", source: "cloud", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", cacheHit: false };
      return new Response(JSON.stringify(payload), { status: url.endsWith("/cancel") ? 200 : 202 });
    });
    const controller = new AbortController();
    const pending = runCloudAnalysisJob({
      baseUrl: "https://analysis.example.com",
      headers: { authorization: "Bearer token" },
      request: { fen: "fen", engineVersion: "Pikafish-test", nnueVersion: "nnue-test", budget: { mode: "depth", value: 8 }, multiPv: 1 },
      signal: controller.signal,
      fetchImpl,
      pollDelayMs: 10_000,
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith("/job-2/cancel"))).toBe(true));
  });
});
