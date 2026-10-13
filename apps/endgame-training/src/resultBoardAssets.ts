export const RESULT_BOARD_SKIN = "qingxin-zhuyun";

const images = new Map<string, Promise<void>>();
// The result skin has at most 15 assets. Keep decoded pixels alive on iOS,
// including piece types not present in the currently displayed position.
const decodedImages = new Map<string, HTMLImageElement>();
function prepareImage(file: string) {
  const src = `/skins/${RESULT_BOARD_SKIN}/${file}`;
  let ready = images.get(src);
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onerror = () => reject(new Error("棋盘图片加载失败，请重试。"));
      image.onload = () => { void image.decode().then(() => { decodedImages.set(src, image); resolve(); }, reject); };
      image.src = src;
    }).catch((error: unknown) => { images.delete(src); throw error; });
    images.set(src, ready);
  }
  return ready;
}

/** Decode all images before replacing an already visible result board. */
export async function prepareResultBoardAssets(fen: string) {
  const files = new Set(["board.png"]);
  for (const piece of fen.split(" ")[0]) {
    if (/[rnbakcp]/i.test(piece)) files.add(`${piece === piece.toUpperCase() ? "r" : "b"}${piece.toLowerCase()}.png`);
  }
  await Promise.all([...files].map(prepareImage));
}
