import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Board } from "../src/App";
import { DEFAULT_SKIN_ID, SKIN_CATALOG, normalizeSkinId } from "../src/skinCatalog";
import authoredSkins from "../src/authoredSkinCatalog.json";
import defaultGeometry from "../src/authoredSkinGeometry.json";
import referenceGeometry from "../src/referenceSkinGeometry.json";

afterEach(cleanup);
it("preserves stored skin IDs and falls back safely for removed or invalid settings", () => {
  expect(DEFAULT_SKIN_ID).toBe("qingxin-zhuyun");
  expect(new Set(SKIN_CATALOG.map(s => s.id)).size).toBe(SKIN_CATALOG.length);
  for (const skin of SKIN_CATALOG) expect(normalizeSkinId(skin.id)).toBe(skin.id);
  for (const value of [undefined, null, "", "missing-skin"]) expect(normalizeSkinId(value)).toBe(DEFAULT_SKIN_ID);
});

it("ships all board, blank river and red/black piece assets at the renderer's dimensions", () => {
  for (const skin of authoredSkins) {
    for (const file of ["board", "board-river-blank", ...["r", "b"].flatMap(side => ["k","a","b","n","r","c","p"].map(p => side+p))]) {
      const png=readFileSync(`public/skins/${skin.id}/${file}.png`);
      expect(png.subarray(1,4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual(file.startsWith("board")?[1120,1240]:[120,120]);
    }
  }
});

it("keeps all 90 targets aligned across the compact sets and mixed piece skins", () => {
  const props={pieces:[],boardSkin:DEFAULT_SKIN_ID,pieceSkin:DEFAULT_SKIN_ID,riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:true,onSquare:vi.fn()};
  const ui=render(<Board {...props}/>);
  for (const flipped of [false,true]) {
    ui.rerender(<Board {...props} boardSkin={authoredSkins[0].id} flipped={flipped}/>);
    const positions=()=>[...ui.container.querySelectorAll(".board-square")].map(e=>[e.getAttribute("aria-label"),e.getAttribute("style")]);
    const baseline=positions();
    expect(baseline).toHaveLength(90);
    for (const skin of authoredSkins) {
      ui.rerender(<Board {...props} flipped={flipped} boardSkin={skin.id}/>);
      const geometry=skin.id==="xuan-paper"?referenceGeometry["xuan-paper"]:defaultGeometry;
      [...ui.container.querySelectorAll<HTMLElement>(".board-square")].forEach((square,index) => {
        const row=Math.floor(index/9), col=index%9;
        expect(parseFloat(square.style.getPropertyValue("--piece-left"))).toBeCloseTo(geometry.columns[flipped?8-col:col]/1120*100);
        expect(parseFloat(square.style.getPropertyValue("--piece-top"))).toBeCloseTo(geometry.rows[flipped?9-row:row]/1240*100);
      });
      ui.rerender(<Board {...props} flipped={flipped} boardSkin={skin.id} pieceSkin={skin.id} riverText="自在弈棋" supportsCustomRiverText={skin.supportsCustomRiverText}/>);
      expect((ui.container.querySelector(".xiangqi-board") as HTMLElement).style.backgroundImage).toContain(`${skin.id}/${skin.supportsCustomRiverText?"board-river-blank":"board"}.png`);
    }
  }
});

it("applies default depth independently to the board and pieces without moving hit targets", () => {
  const props={pieces:[],boardSkin:DEFAULT_SKIN_ID,pieceSkin:DEFAULT_SKIN_ID,riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare:vi.fn()};
  const ui=render(<Board {...props}/>);
  const shell=()=>ui.container.querySelector(".board-shell")!;
  const positions=()=>[...ui.container.querySelectorAll<HTMLElement>(".board-square")].map(square=>square.getAttribute("style"));
  const baseline=positions();
  expect(shell().classList.contains("default-board-depth")).toBe(true);
  expect(shell().classList.contains("default-piece-depth")).toBe(true);
  ui.rerender(<Board {...props} boardSkin={authoredSkins[0].id}/>);
  expect(shell().classList.contains("default-board-depth")).toBe(false);
  expect(shell().classList.contains("default-piece-depth")).toBe(true);
  ui.rerender(<Board {...props} pieceSkin={authoredSkins[0].id}/>);
  expect(shell().classList.contains("default-board-depth")).toBe(true);
  expect(shell().classList.contains("default-piece-depth")).toBe(false);
  expect(positions()).toEqual(baseline);
});

it("uses the sharper default pieces on large displays and keeps other skins unchanged", () => {
  for (const side of ["r", "b"]) for (const kind of ["k", "a", "b", "n", "r", "c", "p"]) {
    const png=readFileSync(`public/skins/${DEFAULT_SKIN_ID}/retina/${side}${kind}.png`);
    expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([240,240]);
  }
  const piece={row:9,col:4,color:"red" as const,kind:"king",label:"帅"};
  const props={pieces:[piece],boardSkin:DEFAULT_SKIN_ID,pieceSkin:DEFAULT_SKIN_ID,riverText:"",riverTextColor:"#000",riverTextSize:20,supportsCustomRiverText:false,onSquare:vi.fn()};
  const ui=render(<Board {...props}/>);
  expect(ui.container.querySelector(".board-square .piece")?.getAttribute("src")).toContain("/qingxin-zhuyun/retina/rk.png");
  ui.rerender(<Board {...props} pieceSkin={authoredSkins[0].id}/>);
  expect(ui.container.querySelector(".board-square .piece")?.getAttribute("src")).toContain(`/skins/${authoredSkins[0].id}/rk.png`);
});
