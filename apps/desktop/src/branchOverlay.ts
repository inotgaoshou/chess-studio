export type OverlayRect = { left:number; top:number; right:number; bottom:number };
export type OverlayPoint = { x:number; y:number };

/** Use space outside the board, even when a branch is dragged or the screen rotates. */
export function branchOverlayBounds(view:OverlayRect, board?:OverlayRect, dock?:OverlayRect, preferred?:OverlayPoint):OverlayRect {
  if (!board) return view;
  const regions = [
    {...view, top:Math.max(view.top,board.bottom+6)},
    {...view, left:Math.max(view.left,board.right+6)},
    {...view, right:Math.min(view.right,board.left-6)},
    {...view, bottom:Math.min(view.bottom,board.top-6)},
  ].filter(r=>r.right-r.left>=100 && r.bottom-r.top>=36);
  const target = preferred ?? (dock ? {x:dock.left,y:dock.bottom+6} : {x:board.left,y:board.bottom+6});
  const distance=(r:OverlayRect)=>Math.hypot(Math.max(r.left-target.x,0,target.x-r.right),Math.max(r.top-target.y,0,target.y-r.bottom));
  regions.sort((a,b)=>distance(a)-distance(b));
  return regions[0] ?? view;
}

export function placeBranchOverlay(bounds:OverlayRect, size:{width:number;height:number}, board?:OverlayRect, preferred?:OverlayPoint, dock?:OverlayRect):OverlayPoint {
  return {
    x:Math.max(bounds.left,Math.min(bounds.right-size.width,preferred?.x ?? dock?.left ?? board?.left ?? bounds.left)),
    y:Math.max(bounds.top,Math.min(bounds.bottom-size.height,preferred?.y ?? (dock ? dock.bottom+6 : board ? board.bottom+6 : bounds.bottom-size.height))),
  };
}
