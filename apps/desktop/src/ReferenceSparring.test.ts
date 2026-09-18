import { describe, expect, it } from "vitest";
import {
  chooseReferenceSparringMove,
  fallbackReferenceSparringChoice,
  referenceSparringFallbackWarning,
  referenceSparringCandidateWeight,
  referenceSparringLevelLabel,
  referenceSparringLevelProfile,
  referenceSparringSourceLabel,
} from "./ReferenceSparring";
import type { PositionMoveStatDto } from "./platform/types";

function candidate(partial: Partial<PositionMoveStatDto>): PositionMoveStatDto {
  return {
    iccs: "h2e2",
    notation: "炮二平五",
    samples: 10,
    redWins: 5,
    draws: 2,
    blackWins: 3,
    ...partial,
  };
}

describe("ReferenceSparring", () => {
  it("defines stable labels and increasingly selective profiles", () => {
    expect(referenceSparringLevelLabel("ye4")).toBe("业4");
    expect(referenceSparringLevelLabel("pro1")).toBe("专1");
    expect(referenceSparringLevelProfile("ye4").randomJitter).toBeGreaterThan(referenceSparringLevelProfile("pro1").randomJitter);
    expect(referenceSparringLevelProfile("pro1").maxCandidates).toBeLessThan(referenceSparringLevelProfile("ye4").maxCandidates);
    expect(referenceSparringLevelProfile("pro1").engineBlend).toBeGreaterThan(referenceSparringLevelProfile("ye6").engineBlend);
  });

  it("gives lower levels more room for cold moves", () => {
    const cold = candidate({ iccs: "a0a1", samples: 1, redWins: 0, draws: 0, blackWins: 1 });
    const main = candidate({ iccs: "h2e2", samples: 1000, redWins: 700, draws: 150, blackWins: 150 });
    const ye4Ratio = referenceSparringCandidateWeight(cold, "红方", "ye4") / referenceSparringCandidateWeight(main, "红方", "ye4");
    const proRatio = referenceSparringCandidateWeight(cold, "红方", "pro1") / referenceSparringCandidateWeight(main, "红方", "pro1");

    expect(ye4Ratio).toBeGreaterThan(proRatio);
  });

  it("lets pro1 strongly prefer a high-sample winning practical move", () => {
    const weak = candidate({ iccs: "a0a1", samples: 20, redWins: 2, draws: 2, blackWins: 16 });
    const strong = candidate({ iccs: "h2e2", samples: 1200, redWins: 760, draws: 220, blackWins: 220 });

    expect(referenceSparringCandidateWeight(strong, "红方", "pro1")).toBeGreaterThan(referenceSparringCandidateWeight(weak, "红方", "pro1") * 100);
  });

  it("returns undefined when no usable candidate exists", () => {
    expect(chooseReferenceSparringMove([], "红方", "ye6")).toBeUndefined();
    expect(chooseReferenceSparringMove([candidate({ iccs: " " })], "红方", "ye6")).toBeUndefined();
  });

  it("selects deterministically with injected random values", () => {
    const first = candidate({ iccs: "h2e2", notation: "炮二平五", samples: 100 });
    const second = candidate({ iccs: "b2e2", notation: "炮八平五", samples: 100 });
    const choice = chooseReferenceSparringMove([first, second], "红方", "ye6", () => 0);

    expect(choice?.move.iccs).toBe("h2e2");
    expect(choice?.candidateCount).toBe(2);
    expect(choice?.source).toBe("reference");
    expect(choice?.sourceLabel).toBe("参考库实战");
  });

  it("uses current engine hints as a light smart correction for high levels", () => {
    const popular = candidate({ iccs: "h2e2", notation: "炮二平五", samples: 100, redWins: 55, draws: 20, blackWins: 25 });
    const engine = candidate({ iccs: "b2e2", notation: "炮八平五", samples: 100, redWins: 55, draws: 20, blackWins: 25 });
    const choice = chooseReferenceSparringMove([popular, engine], "红方", "pro1", () => 0.99, {
      engineHints: [{ iccs: "b2e2", rank: 1 }],
    });

    expect(choice?.move.iccs).toBe("b2e2");
    expect(choice?.intelligenceNote).toContain("智能校正");
  });

  it("wraps cloud and engine fallback moves with explicit source warnings", () => {
    const cloud = fallbackReferenceSparringChoice({ iccs: "h2e2", notation: "炮二平五" }, "ye6", "cloud", { candidateCount: 3, winRate: .57, fallbackReason: "本地无候选" });
    const engine = fallbackReferenceSparringChoice({ iccs: "b0c2", notation: "马二进三" }, "pro1", "engine");

    expect(referenceSparringSourceLabel("reference")).toBe("参考库实战");
    expect(cloud?.source).toBe("cloud");
    expect(cloud?.sourceLabel).toBe("云库");
    expect(cloud?.warningMessage).toBe(referenceSparringFallbackWarning("cloud"));
    expect(cloud?.candidateCount).toBe(3);
    expect(cloud?.winRate).toBe(.57);
    expect(engine?.source).toBe("engine");
    expect(engine?.sourceLabel).toBe("Pikafish");
    expect(engine?.warningMessage).toBe(referenceSparringFallbackWarning("engine"));
  });
});
