import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { LocalManualGame } from "../src/types";
import { useVariationBranchLabels } from "../src/useVariationBranchLabels";
import { chineseLine } from "../src/wasm";

vi.mock("../src/wasm", () => ({ chineseLine: vi.fn() }));
const game: LocalManualGame = { id:"game", title:"棋谱", note:"", startingFen:"start w", currentFen:"start w", currentNodeId:"main:0", cursor:0, moves:[], comments:{}, createdAt:"", updatedAt:"", branches:[{id:"legacy",parentPath:["b0c2"],parentCursor:1,moves:["b9c7"],notation:["b9c7"],createdAt:0}] };

it("translates legacy branch coordinates using the full parent path without changing data", async () => {
  vi.mocked(chineseLine).mockReset().mockResolvedValue(["马八进七", "马2进3"]);
  const original=JSON.stringify(game);
  const {result}=renderHook(() => useVariationBranchLabels(game,"owner"));
  expect(result.current?.[0].label).not.toContain("b9c7");
  await waitFor(() => expect(result.current?.[0].label).toBe("2. 马2进3 · 1 步"));
  expect(chineseLine).toHaveBeenCalledWith("start w",["b0c2","b9c7"]);
  expect(JSON.stringify(game)).toBe(original);
});

it("never exposes coordinates after notation fails", async () => {
  vi.mocked(chineseLine).mockReset().mockRejectedValue(new Error("invalid legacy path"));
  const {result}=renderHook(() => useVariationBranchLabels(game,"owner"));
  await act(async()=>{});
  expect(result.current?.[0].label).toBe("2. 着法待核对 · 1 步");
});

it("ignores a delayed result from the previous account and game", async () => {
  let finish!: (labels:string[])=>void;
  vi.mocked(chineseLine).mockReset().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(["炮二平五"]);
  const {result,rerender}=renderHook(({value,scope})=>useVariationBranchLabels(value,scope),{initialProps:{value:game,scope:"first"}});
  rerender({value:{...game,id:"other",branches:[{...game.branches[0],parentCursor:0,parentPath:[],moves:["h2e2"]}]},scope:"second"});
  await waitFor(()=>expect(result.current?.[0].label).toBe("1. 炮二平五 · 1 步"));
  await act(async()=>finish(["马八进七","马2进3"]));
  expect(result.current?.[0].label).toBe("1. 炮二平五 · 1 步");
});
