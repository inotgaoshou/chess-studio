import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.stubGlobal("matchMedia", () => ({matches:false,addEventListener(){},removeEventListener(){}}));
vi.stubGlobal("ResizeObserver", class { observe(){} unobserve(){} disconnect(){} });
// Node's optional Web Storage globals must not shadow the jsdom origin.
function storage(): Storage {
 const values=new Map<string,string>();
 return {get length(){return values.size;},key:index=>[...values.keys()][index]??null,
  getItem:key=>values.get(String(key))??null,setItem:(key,value)=>{values.set(String(key),String(value));},
  removeItem:key=>{values.delete(String(key));},clear:()=>values.clear()};
}
vi.stubGlobal("localStorage", storage());
vi.stubGlobal("sessionStorage", storage());
window.scrollTo=()=>{};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
