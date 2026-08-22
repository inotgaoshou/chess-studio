import { describe, expect, it } from "vitest";
import { cloudAnalysisHeaders } from "./index";

describe("cloud analysis request headers", () => {
  it("omits authorization only when no token is available", () => {
    expect(cloudAnalysisHeaders("", true)).toEqual({
      "content-type": "application/json",
    });
  });

  it("sends bearer authentication for a guest mobile token", () => {
    expect(cloudAnalysisHeaders("guest-token", true)).toEqual({
      "content-type": "application/json",
      authorization: "Bearer guest-token",
    });
  });

  it("keeps bearer authentication for non-guest analysis", () => {
    expect(cloudAnalysisHeaders("active-token")).toEqual({
      "content-type": "application/json",
      authorization: "Bearer active-token",
    });
  });
});
