export type VerificationCriteria = { horizonPlies: number; maxCpLoss: number; minMaterialGain?: number | null; minScoreCp?: number | null };
export type VerificationGoal = { kind: "mate" | "gain_material" | "draw" | "endgame_win"; description: string; solverSide: "w" | "b"; reviewMethod: "forced_mate" | "reviewed_solution"; verification?: VerificationCriteria | null };
export type VerificationNode = { iccs: string; comment: string; children: VerificationNode[] };
export type VerificationRequest = { startingFen: string; path: string[]; candidate: string; solution: VerificationNode[]; goal?: VerificationGoal | null; targetMateMoves?: number | null };
export type VerificationLine = { depth: number; scoreCp?: number | null; mate?: number | null; bound?: string | null; pv: string[] };
export type VerificationEvidence = { engineFingerprint: string; lines: Record<string, VerificationLine> };
export type VerificationSearch = { key: string; fen: string; searchMoves: string[]; depth: number; moveTimeMs: number };
export type VerificationResult = { outcome: "correct" | "completed" | "wrong" | "illegal" | "pending_review"; message: string; path: string[]; autoMoves: string[]; completed: boolean; hintMove?: string | null; reviewKind?: "alternative_solution" | "suspect_answer" | "missing_conditions" | null; evidenceId?: string | null; verifierVersion: string; localOnly?: boolean };
