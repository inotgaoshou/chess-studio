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
  expect(screen.getByRole("button",{name:"继续：炮二平五"})).toBeTruthy();
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
