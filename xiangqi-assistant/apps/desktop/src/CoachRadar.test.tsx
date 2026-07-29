import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoachRadar, radarPolygon } from "./CoachRadar";
import type { CoachProfile } from "./analysisView";

afterEach(cleanup);

const profile = (accuracy: number): CoachProfile => ({
  quality: "优",
  dimensions: { opening: 90, middle: 80, endgame: undefined, accuracy, stability: 75 },
  summary: "测试总结",
});

describe("CoachRadar", () => {
  it("renders accessible five-dimension details without inventing missing phases", () => {
    render(<CoachRadar red={profile(85)} black={profile(78)}/>);
    expect(screen.getByRole("img", { name: /五维对比/ })).toBeTruthy();
    expect(screen.getByRole("table", { name: "五维评分明细" }).textContent).toContain("残局--");
  });

  it("uses accuracy only as the visual fallback for a missing phase", () => {
    const points = radarPolygon(profile(85).dimensions).split(" ");
    expect(points).toHaveLength(5);
    expect(points[2]).not.toContain("NaN");
  });
});
