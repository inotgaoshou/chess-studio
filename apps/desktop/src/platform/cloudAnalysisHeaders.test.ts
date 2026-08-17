import { describe, expect, it } from "vitest";
import { cloudAnalysisHeaders } from "./index";

describe("cloud analysis request headers", () => {
  it("sends a guest mobile request without an authorization header", () => {
    expect(cloudAnalysisHeaders("", true)).toEqual({
      "content-type": "application/json",
    });
  });

  it("does not reuse a stale local token for a guest mobile request", () => {
    expect(cloudAnalysisHeaders("expired-token", true)).toEqual({
      "content-type": "application/json",
    });
  });

  it("keeps bearer authentication for non-guest analysis", () => {
    expect(cloudAnalysisHeaders("active-token")).toEqual({
      "content-type": "application/json",
      authorization: "Bearer active-token",
    });
  });
});
