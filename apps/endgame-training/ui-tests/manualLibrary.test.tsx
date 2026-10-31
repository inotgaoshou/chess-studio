import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ManualLibraryList } from "../src/ManualLibraryList";
import { FittedBoardArea } from "../src/FittedBoardArea";
import type { LocalManualGame } from "../src/types";

const game: LocalManualGame = { id:"one",title:"保存的棋谱",note:"原注释",startingFen:"",moves:["b0c2"],cursor:1,branches:[],comments:{},createdAt:"2026-10-24",updatedAt:"2026-10-24" };

it("edits the chosen row without opening it or editing the current document", () => {
  const onOpen=vi.fn(),onEdit=vi.fn();
  render(<ManualLibraryList games={[game,{...game,id:"two",title:"另一份棋谱"}]} selectedId="two" onOpen={onOpen} onEdit={onEdit} onMove={()=>{}} onDelete={()=>{}} onCopy={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"编辑信息：保存的棋谱"}));
  expect(onEdit).toHaveBeenCalledWith(game);
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"继续录谱：保存的棋谱"}));
  expect(onOpen).toHaveBeenCalledWith(game);
});

it("keeps cloud mirrors read only with a separate copy action", () => {
  render(<ManualLibraryList games={[{...game,readOnly:true}]} onOpen={()=>{}} onEdit={()=>{}} onMove={()=>{}} onDelete={()=>{}} onCopy={()=>{}}/>);
  expect(screen.queryByRole("button",{name:/编辑信息/})).toBeNull();
  expect(screen.getByRole("button",{name:"复制"})).toBeTruthy();
});

it("fits an old iOS viewport from both available dimensions and cleans up observation", () => {
  let resize=()=>{};const disconnect=vi.fn();
  vi.spyOn(globalThis,"ResizeObserver").mockImplementation(function(callback) {resize=()=>callback([],this);return {observe(){},unobserve(){},disconnect};} as unknown as typeof ResizeObserver);
  let width=1024,height=600;
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(()=>({width,height,x:0,y:0,top:0,left:0,right:width,bottom:height,toJSON(){}}));
  const ui=render(<FittedBoardArea className="manual-play-board-area"><div/></FittedBoardArea>);
  const area=ui.container.firstElementChild as HTMLElement;
  expect(parseFloat(area.style.getPropertyValue("--fitted-board-width"))).toBeCloseTo((600-28)*1120/1240);
  width=768;height=900;resize();
  expect(parseFloat(area.style.getPropertyValue("--fitted-board-width"))).toBe(768-16);
  ui.unmount();expect(disconnect).toHaveBeenCalled();
});
