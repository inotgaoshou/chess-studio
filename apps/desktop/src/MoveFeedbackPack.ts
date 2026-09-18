export type MoveFeedbackVoiceKind = "check" | "checkmate";

export type MoveFeedbackPack = {
  id: string;
  visualClass: string;
  labels: Record<MoveFeedbackVoiceKind, string>;
  voice: Record<MoveFeedbackVoiceKind | "move" | "capture", string>;
};

// Art direction and media live here so future packs do not affect move rules.
export const DEFAULT_MOVE_FEEDBACK_PACK: MoveFeedbackPack = {
  id: "ink-strike",
  visualClass: "ink-strike",
  labels: { check: "将", checkmate: "绝杀" },
  voice: { move: "/audio/move-crisp.wav", capture: "/audio/capture.wav", check: "/audio/check.wav", checkmate: "/audio/checkmate.wav" },
};
