// Shared by the saved-branch arrows and their choice buttons. Rank never changes move order.
const BRANCH_COLORS = ["#c45110", "#156db3", "#8b4298", "#16745a", "#a53550", "#756019"];
export const branchChoiceColor = (index:number) => BRANCH_COLORS[index % BRANCH_COLORS.length];
type Point = {x:number;y:number};

/** Place numbered badges beside the route, preferring empty gaps over piece faces. */
export function branchBadgePoint(from:Point,to:Point,pieces:Point[],labels:Point[],width:number,height:number):Point {
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.max(1,Math.hypot(dx,dy));
  let best={x:from.x,y:from.y},bestScore=-Infinity;
  for(const t of [.55,.72,.35])for(const offset of [64,-64,88,-88]) {
    const point={x:Math.max(38,Math.min(width-38,from.x+dx*t-dy/length*offset)),y:Math.max(38,Math.min(height-38,from.y+dy*t+dx/length*offset))};
    const clearance=Math.min(100,...pieces.map(p=>Math.hypot(point.x-p.x,point.y-p.y)),...labels.map(p=>Math.hypot(point.x-p.x,point.y-p.y)-15));
    const score=clearance-Math.abs(t-.55)*12-Math.abs(offset)*.02;
    if(score>bestScore){best=point;bestScore=score;}
  }
  return best;
}
