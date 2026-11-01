// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BranchStrip } from "./BranchStrip";
afterEach(cleanup);
it("keeps direct-child order and merges common-prefix routes without navigating on render", () => {
  const choices = [
    { id:"main", move:"h2e2", notation:"炮二平五", selected:true },
    { id:"variation", move:"b0c2", notation:"马八进七" },
    { id:"same-prefix", move:"b0c2", notation:"马八进七" },
  ];
  const select = vi.fn(); render(<BranchStrip choices={choices} onSelect={select}/>);
  expect(select).not.toHaveBeenCalled();
  expect(screen.getAllByRole("button", {name:/^分支 \d/})).toHaveLength(2);
  expect(screen.getByRole("button", {name:"分支 1 · 炮二平五"}).getAttribute("aria-current")).toBe("true");
  fireEvent.click(screen.getByRole("button", {name:"分支 2 · 马八进七"}));
  expect(select).toHaveBeenCalledWith("variation"); expect(choices).toHaveLength(3);
});
it("shows a sole saved continuation without requiring a fork", () => {
  render(<BranchStrip choices={[{id:"a", move:"h2e2", notation:"炮二平五"}]} onSelect={vi.fn()}/>);
  expect(screen.getByRole("button",{name:"棋谱下一着：炮二平五"})).toBeTruthy();
});

it("collapses and reopens choices without selecting a route", () => {
 const select=vi.fn();render(<BranchStrip choices={[{id:"a",move:"a0a1",notation:"车九进一",isMainline:true},{id:"b",move:"b0c2",notation:"马八进七"}]} onSelect={select}/>);
 expect(screen.getByText("主线 1")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"收起变招选择"}));
 expect(screen.queryByRole("button",{name:/分支 2/})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:/选择变招/}));
 expect(screen.getByRole("button",{name:/分支 2/})).toBeTruthy();expect(select).not.toHaveBeenCalled();
});

it("reopens a collapsed fork when next requests an explicit choice",()=>{
 const choices=[{id:'a',move:'a0a1',notation:'车九进一'},{id:'b',move:'b0c2',notation:'马八进七'}],select=vi.fn();
 const view=render(<BranchStrip choices={choices} onSelect={select} revealKey={0}/>);
 fireEvent.click(screen.getByRole('button',{name:'收起变招选择'}));
 view.rerender(<BranchStrip choices={choices} onSelect={select} revealKey={1}/>);
 expect(screen.getByRole('button',{name:'分支 2 · 马八进七'})).toBeTruthy();expect(select).not.toHaveBeenCalled();
});
it("omits navigation at an actual leaf",()=>{
 render(<BranchStrip choices={[]} onSelect={vi.fn()}/>);expect(screen.queryByRole('navigation')).toBeNull();
});

it("floats outside the board layout and suppresses the card while another tool is open",()=>{
 const choices=[{id:'same',move:'a0a1',notation:'车九进一'},{id:'other',move:'b0c2',notation:'马八进七'}];
 const view=render(<main data-testid="board-layout"><BranchStrip floating contextKey="game:root" light choices={choices} onSelect={vi.fn()}/></main>);
 expect(screen.getByTestId('board-layout').children).toHaveLength(0);
 expect(screen.getByRole('navigation',{name:'当前局面分支'}).classList.contains('is-floating')).toBe(true);
 view.rerender(<main data-testid="board-layout"><BranchStrip floating hidden contextKey="game:root" choices={choices} onSelect={vi.fn()}/></main>);
 expect(screen.queryByRole('navigation',{name:'当前局面分支'})).toBeNull();
});
it("reopens a new position with identical branch IDs but does not reopen on ordinary result refresh",()=>{
 const choices=[{id:'same',move:'a0a1',notation:'车九进一'},{id:'other',move:'b0c2',notation:'马八进七'}],select=vi.fn();
 const view=render(<BranchStrip floating contextKey="game:root" choices={choices} onSelect={select}/>);
 fireEvent.click(screen.getByRole('button',{name:'收起变招选择'}));
 view.rerender(<BranchStrip floating contextKey="game:root" choices={[...choices]} onSelect={select}/>);
 expect(screen.queryByRole('button',{name:'分支 2 · 马八进七'})).toBeNull();
 view.rerender(<BranchStrip floating contextKey="game:child" choices={choices} onSelect={select}/>);
 expect(screen.getByRole('button',{name:'分支 2 · 马八进七'})).toBeTruthy();
 expect(select).not.toHaveBeenCalled();
});

it("collapses a single saved continuation without playing an AI move",()=>{
 const select=vi.fn(); render(<BranchStrip floating choices={[{id:"saved",move:"a0a1",notation:"车九进一"}]} onSelect={select}/>);
 expect(screen.getByRole("button",{name:"棋谱下一着：车九进一"})).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"收起变招选择"}));
 expect(select).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"展开棋谱后续"}));
 fireEvent.click(screen.getByRole("button",{name:"棋谱下一着：车九进一"}));
 expect(select).toHaveBeenCalledWith("saved");
});
it("reveals a new saved tail at the same anchor after an empty position",()=>{
 const change=vi.fn();
 const view=render(<BranchStrip floating contextKey="same" choices={[]} expanded={false} onExpandedChange={change} onSelect={vi.fn()}/>);
 change.mockClear();
 view.rerender(<BranchStrip floating contextKey="same" choices={[{id:"saved",move:"a0a1",notation:"车九进一"}]} expanded={false} onExpandedChange={change} onSelect={vi.fn()}/>);
 expect(change).toHaveBeenCalledWith(true);
});
it("uses the status slot when the gap cannot fit a complete move button",()=>{
 const board=document.createElement('div'),toolbar=document.createElement('div'),dock=document.createElement('div');
 let gap=48;
 board.getBoundingClientRect=()=>new DOMRect(8,0,300,600);
 toolbar.getBoundingClientRect=()=>new DOMRect(0,600+gap,320,100);
 dock.getBoundingClientRect=()=>new DOMRect(8,602+gap,200,44);
 render(<BranchStrip floating choices={[{id:'a',move:'a0a1',notation:'车九进一'}]} onSelect={vi.fn()} getAnchor={()=>({board,toolbar,dock,dockInside:true})}/>);
 const nav=screen.getByRole('navigation',{name:'当前局面分支'});
 expect(nav.dataset.dockInside).toBe('true');
 gap=52;fireEvent(window,new Event('resize'));
 expect(nav.dataset.dockInside).toBe('false');
 expect(parseFloat(nav.style.maxHeight)).toBeGreaterThanOrEqual(42);
});

it("edits numbered choices inline without selecting or deleting until requested",()=>{
 const onSelect=vi.fn(),onRequestDelete=vi.fn();
 render(<BranchStrip floating light choices={[{id:'a',move:'a0a1',notation:'车九进一'},{id:'b',move:'b0c2',notation:'马八进七'}]} onSelect={onSelect} onRequestDelete={onRequestDelete}/>);
 fireEvent.click(screen.getByRole('button',{name:'编辑分支'}));
 fireEvent.click(screen.getByRole('button',{name:'删除分支 2 · 马八进七'}));
 expect(onRequestDelete).toHaveBeenCalledExactlyOnceWith('b');expect(onSelect).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'完成分支编辑'}));
 expect(screen.queryByRole('button',{name:/删除分支/})).toBeNull();
 expect(screen.getByRole('button',{name:'分支 2 · 马八进七'})).toBeTruthy();
});

it("keeps mobile branch management in one entry and still allows collapse",()=>{
 const onManage=vi.fn(),onSelect=vi.fn();
 render(<BranchStrip floating compact light choices={[{id:'a',move:'a0a1',notation:'车九进一'}]} onSelect={onSelect} onManage={onManage} onRequestDelete={vi.fn()}/>);
 expect(screen.getByText('分支',{exact:true})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'编辑分支'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'管理变招'}));expect(onManage).toHaveBeenCalledOnce();expect(onSelect).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'收起变招选择'}));
 fireEvent.click(screen.getByRole('button',{name:'展开棋谱后续'}));
 expect(screen.getByRole('button',{name:'棋谱下一着：车九进一'})).toBeTruthy();
});
