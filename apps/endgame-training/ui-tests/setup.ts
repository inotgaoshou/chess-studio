import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.stubGlobal("matchMedia", () => ({matches:false,addEventListener(){},removeEventListener(){}}));
vi.stubGlobal("ResizeObserver", class { observe(){} unobserve(){} disconnect(){} });
window.scrollTo=()=>{};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
