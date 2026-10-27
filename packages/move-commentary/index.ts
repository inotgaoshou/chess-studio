export type Color = "Red" | "Black";
export type PieceKind = "King" | "Advisor" | "Elephant" | "Horse" | "Rook" | "Cannon" | "Pawn";
export type Piece = { color: Color; kind: PieceKind };
export type CaptureOpportunity = { iccs: string; attacker: Piece; target: Piece };
export type MaterialCount = Piece & { count: number };
export type MoveFacts = {
  beforeFen: string; afterFen: string; iccs: string; notation: string; mover: Piece;
  from: { row: number; col: number }; to: { row: number; col: number };
  captured: Piece | null; wasInCheck: boolean; resolvesCheck: boolean; givesCheck: boolean;
  status: "Ongoing" | "Check" | "Checkmate" | "Stalemate";
  attacksBefore: CaptureOpportunity[]; attacksAfter: CaptureOpportunity[];
  opponentCapturesAfter: CaptureOpportunity[];
  materialBefore: MaterialCount[]; materialAfter: MaterialCount[];
};
export type ReferenceLine = { depth: number; pv: string[]; bound?: string; scoreCp?: number; mate?: number };
export type CommentaryRequest = {
  beforeFen: string; move: string; ruleMode: string; engineIdentity: string;
  moveTimeMs: number; multiPv: number; accessScope: string;
  authoredNote?: string;
  reference?: { fen: string; line: ReferenceLine };
};
export type CommentarySection = { title: string; text: string };
export type MoveCommentary = {
  version: number; beforeFen: string; afterFen: string; move: string; notation: string;
  side: Color; sections: CommentarySection[]; facts: MoveFacts[]; depth?: number;
  reference: string[]; referenceStart: "before"; source: "local";
};
/** Providers are read-only and cancellable; future online providers use this seam. */
export interface CommentaryProvider {
  explain(request: CommentaryRequest, signal: AbortSignal): Promise<MoveCommentary>;
  clear(): void;
}
export type CommentaryDependencies = {
  facts(fen: string, moves: string[]): Promise<MoveFacts[]>;
  analyze(fen: string, request: CommentaryRequest, signal: AbortSignal): Promise<ReferenceLine | undefined>;
};
const VERSION = 2;
const names: Record<PieceKind, [string, string]> = {
  King: ["帅", "将"], Advisor: ["仕", "士"], Elephant: ["相", "象"],
  Horse: ["马", "马"], Rook: ["车", "车"], Cannon: ["炮", "炮"], Pawn: ["兵", "卒"],
};
export const sideName = (color: Color) => color === "Red" ? "红方" : "黑方";
const pieceName = (piece: Piece) => `${piece.color === "Red" ? "红" : "黑"}${names[piece.kind][piece.color === "Red" ? 0 : 1]}`;

export function composeCommentary(target: MoveFacts, facts: MoveFacts[], depth?: number, warning?: string, authoredNote?: string): MoveCommentary {
  const line = facts.length ? facts : [target];
  const beforeCaptures = target.attacksBefore.map(c => `${c.target.color}:${c.target.kind}:${c.iccs.slice(2)}`);
  const newTargets = target.attacksAfter.filter(c => !beforeCaptures.includes(`${c.target.color}:${c.target.kind}:${c.iccs.slice(2)}`));
  const targets = [...new Set(newTargets.map(c => pieceName(c.target)))].slice(0, 3);
  const effects: string[] = [];
  if (target.captured) effects.push(`吃掉${pieceName(target.captured)}。`);
  if (target.resolvesCheck) effects.push("解除己方将军。");
  if (target.givesCheck) effects.push("形成将军，迫使对手应将。");
  if (targets.length) effects.push(`新增攻击：${targets.join("、")}；对手仍可化解，不代表赢子。`);
  if (!effects.length) effects.push(`${pieceName(target.mover)}调位，暂未验证后续战术作用。`);
  if (authoredNote?.trim()) {
    const notation = new Map(line.map(fact => [fact.iccs, fact.notation]));
    const note = authoredNote.trim().slice(0, 180).replace(/\b[a-i][0-9][a-i][0-9]\b/gi, move => notation.get(move.toLowerCase()) ?? "（着法待核对）");
    effects.push(`原注（未核验）：${note}`);
  }
  const response = line[1];
  const events = line.slice(2).flatMap(fact => {
    const text = fact.status === "Checkmate" ? "形成将死" : fact.status === "Stalemate" ? "形成困毙" : fact.captured ? `吃掉${pieceName(fact.captured)}` : fact.givesCheck ? "将军" : undefined;
    return text ? [`${sideName(fact.mover.color)}「${fact.notation}」${text}`] : [];
  }).slice(0, 2);
  const canCaptureMover = target.opponentCapturesAfter.filter(c => c.iccs.slice(2) === target.iccs.slice(2));
  const cautions: string[] = [];
  if (canCaptureMover.length) cautions.push(`${pieceName(target.mover)}可被对手吃到，需核对回吃与交换。`);
  if (warning) cautions.push(warning);
  if (!cautions.length) cautions.push("参考变化不代表对手必然照走，得失仍需核对其他应手。");
  const availableTargets = [...new Set(target.attacksBefore.map(c => pieceName(c.target)))].slice(0, 3);
  return {
    version: VERSION, beforeFen: target.beforeFen, afterFen: target.afterFen, move: target.iccs,
    notation: target.notation, side: target.mover.color, source: "local", facts: line, depth,
    reference: line.length > 1 ? line.map(f => `${sideName(f.mover.color)} ${f.notation}`) : [], referenceStart: "before",
    sections: [
      { title: "局面问题", text: target.wasInCheck ? "己方正被将军，必须先应将。" : availableTargets.length ? `己方可吃${availableTargets.join("、")}，需算清对方回吃。` : "己方未被将军，暂无直接吃子机会。" },
      { title: "这步作用", text: effects.join("") },
      { title: "对手应对", text: target.status === "Checkmate" ? "已将死，对手无法解将。" : target.status === "Stalemate" ? "已困毙，对手无合法走法。" : response ? `参考应手：${sideName(response.mover.color)}「${response.notation}」。${response.captured ? `吃掉${pieceName(response.captured)}。` : ""}${response.givesCheck ? "同时将军。" : ""}` : "暂无可靠参考应手。" },
      { title: "后续计划", text: events.length ? `参考变化：${events.join("；")}。是否强制成立，仍需比较其他防守。` : "尚无足够依据确认后续计划。" },
      { title: "注意事项", text: cautions.join("") },
    ],
  };
}

export function createLocalCommentaryProvider(deps: CommentaryDependencies): CommentaryProvider {
  const cache = new Map<string, MoveCommentary>();
  return {
    clear: () => cache.clear(),
    async explain(request, signal) {
      signal.throwIfAborted();
      const key = JSON.stringify([VERSION, request]);
      const cached = cache.get(key);
      if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
      const [target] = await deps.facts(request.beforeFen, [request.move]);
      signal.throwIfAborted();
      if (!target || target.iccs !== request.move) throw new Error("着法事实不匹配，请重新选择着法。");
      let facts = [target];
      let depth: number | undefined;
      let warning: string | undefined;
      try {
        const matching = request.reference?.fen === request.beforeFen && request.reference.line.pv[0] === request.move;
        const reference = matching ? request.reference!.line : await deps.analyze(target.afterFen, request, signal);
        signal.throwIfAborted();
        if (reference?.pv.length) {
          // Never substitute the best move for the actual played move.
          const pv = matching ? reference.pv : [request.move, ...reference.pv];
          facts = await deps.facts(request.beforeFen, pv.slice(0, 12));
          depth = reference.depth;
          if (reference.bound) warning = "引擎分值仅为上下界，得失尚未确定。";
        } else warning = "暂无引擎变化，本次仅说明局面事实。";
      } catch (error) {
        signal.throwIfAborted();
        warning = error instanceof Error && error.name === "EngineBusyError" ? "引擎忙碌，本次仅说明局面事实。" : "参考变化暂不可用或未通过校验，本次仅说明局面事实。";
        facts = [target]; depth = undefined;
      }
      signal.throwIfAborted();
      const result = composeCommentary(target, facts, depth, warning, request.authoredNote);
      // Transient failures must be retryable, not cached as complete analysis.
      if (facts.length > 1) {
        cache.set(key, result);
        if (cache.size > 100) cache.delete(cache.keys().next().value!);
      }
      return result;
    },
  };
}
