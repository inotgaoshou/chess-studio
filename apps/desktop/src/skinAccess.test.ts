import { describe, expect, it } from "vitest";
import { DEFAULT_SKIN, normalizeSkinId } from "./skinAccess";

describe("normalizeSkinId", () => {
  it("keeps a previously saved classic skin selection", () => {
    expect(normalizeSkinId("default")).toBe("default");
  });

  it("uses the bamboo skin for missing or invalid values", () => {
    expect(normalizeSkinId("missing-skin" as never)).toBe(DEFAULT_SKIN);
  });
});
