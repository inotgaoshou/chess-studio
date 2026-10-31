// Shared green badges keep board numbers and branch controls visually consistent.
export const branchChoiceColor = (_index:number) => "#438a52";
type Point = {x:number;y:number};

/** Prefer the shaft; move beside it only to clear pieces, other badges or the head. */
export function branchBadgePoint(from:Point,to:Point,pieces:Point[],labels:Point[],width:number,height:number):Point {
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.max(1,Math.hypot(dx,dy));
  // Reserve the head and the badge radius. Capture arrows stop before the target.
  // Use the larger AI padding so both arrow layers share safe label positions.
  const capture=pieces.some(p=>Math.hypot(p.x-to.x,p.y-to.y)<1);
  const shaftLimit=length-50-(capture?Math.min(50,length*.42):0)-28;
  let best={x:from.x,y:from.y},bestScore=-Infinity;
  for(const t of [.6,.4,.76,.5,.3,.2])for(const offset of [0,36,-36,48,-48,64,-64,80,-80]) {
    const point={x:Math.max(38,Math.min(width-38,from.x+dx*t-dy/length*offset)),y:Math.max(38,Math.min(height-38,from.y+dy*t+dx/length*offset))};
    const along=((point.x-from.x)*dx+(point.y-from.y)*dy)/length;
    const lateral=Math.abs(((point.x-from.x)*dy-(point.y-from.y)*dx)/length);
    const clearance=Math.min(76,...pieces.map(p=>Math.hypot(point.x-p.x,point.y-p.y)),...labels.map(p=>Math.hypot(point.x-p.x,point.y-p.y)-15));
    const clearsHead=along<=shaftLimit||lateral>=53;
    const onClearShaft=lateral<1&&along<=shaftLimit&&clearance>=76;
    const score=(onClearShaft?1000:0)+(clearsHead?100:0)+clearance-Math.abs(t-.6)*28-Math.abs(offset)*.15;
    if(score>bestScore){best=point;bestScore=score;}
  }
  return best;
}
