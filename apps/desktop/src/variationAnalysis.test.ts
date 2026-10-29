import {describe,it,expect} from "vitest";
import {variationEvaluation,variationRound} from "./variationAnalysis";
describe("variation engine display",()=>{
  it("normalizes black-to-move scores exactly once and keeps unknown distinct from equal",()=>{
    expect(variationEvaluation("board b",{pv:[],scoreCp:220}).label).toBe("黑方明显占优 · 红分 -220");
    expect(variationEvaluation("board w",{pv:[],scoreCp:0}).label).toBe("均势 · 红分 0");
    expect(variationEvaluation("board w").label).toBe("局势待计算");
  });
  it("handles mates, including the already-mated side",()=>{
    expect(variationEvaluation("board b",{pv:[],mate:3}).label).toContain("黑方胜势");
    expect(variationEvaluation("board b",{pv:[],mate:0}).label).toContain("红方胜势");
    expect(variationEvaluation("board w",{pv:[],mate:-2}).redShare).toBe(5);
  });
  it("counts black-first positions using the FEN move number",()=>{
    expect([0,1,2,3].map(cursor=>variationRound("board b - - 0 12",cursor))).toEqual([12,13,13,14]);
    expect([0,1,2].map(cursor=>variationRound("board w - - 0 12",cursor))).toEqual([12,12,13]);
  });
});
