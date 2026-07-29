import init, * as core from "/wasm/xiangqi_web_core.js";

try {
  await init();
  window.__xiangqiWebCore = core;
  window.dispatchEvent(new Event("xiangqi-web-core-ready"));
} catch (error) {
  window.__xiangqiWebCoreError = error instanceof Error ? error.message : String(error);
  window.dispatchEvent(new Event("xiangqi-web-core-error"));
}
