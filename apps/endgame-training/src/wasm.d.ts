declare module "/wasm/xiangqi_web_core.js" {
  const core: unknown;
  export default core;
  export const WebGame: unknown;
  export function parseCblLibrary(bytes: Uint8Array): string;
  export function chineseLine(fen: string, moves: string[]): string;
}
