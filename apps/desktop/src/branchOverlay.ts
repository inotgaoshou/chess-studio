export type OverlayRect = { left:number; top:number; right:number; bottom:number };
export type OverlayPoint = { x:number; y:number };

/** Keep the card above a bottom toolbar, or to the left of a landscape side toolbar. */
export function branchOverlayBounds(view:OverlayRect, board?:OverlayRect, toolbar?:OverlayRect):OverlayRect {
  const bounds={...view};
  if (!board || !toolbar) return bounds;
  if (toolbar.left >= board.right-8 && toolbar.top < board.bottom && toolbar.bottom > board.top) bounds.right=Math.min(bounds.right,toolbar.left-8);
  else if (toolbar.top >= (board.top+board.bottom)/2 && toolbar.left < board.right && toolbar.right > board.left) bounds.bottom=Math.min(bounds.bottom,toolbar.top-8);
  return {...bounds,right:Math.max(bounds.left+1,bounds.right),bottom:Math.max(bounds.top+1,bounds.bottom)};
}

export function placeBranchOverlay(bounds:OverlayRect, size:{width:number;height:number}, board?:OverlayRect, preferred?:OverlayPoint):OverlayPoint {
  const right=bounds.right-size.width, bottom=bounds.bottom-size.height;
  return {
    x:Math.max(bounds.left,Math.min(right,preferred?.x ?? (board?.right ?? bounds.right)-size.width)),
    y:Math.max(bounds.top,Math.min(bottom,preferred?.y ?? (board?.bottom ?? bounds.bottom)-size.height-8)),
  };
}
