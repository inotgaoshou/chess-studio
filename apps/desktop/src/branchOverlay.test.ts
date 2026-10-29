import {expect,it} from 'vitest';
import {branchOverlayBounds,placeBranchOverlay} from './branchOverlay';
it('keeps a floating card above a bottom toolbar and inside the safe viewport',()=>{
 const board={left:8,top:80,right:382,bottom:600},toolbar={left:0,top:606,right:390,bottom:810};
 const bounds=branchOverlayBounds({left:8,top:47,right:382,bottom:802},board,toolbar);
 expect(bounds.bottom).toBe(598);
 expect(placeBranchOverlay(bounds,{width:320,height:140},board)).toEqual({x:62,y:452});
 expect(placeBranchOverlay(bounds,{width:320,height:140},board,{x:999,y:999})).toEqual({x:62,y:458});
});
it('keeps landscape cards to the left of side controls and clamps after rotation',()=>{
 const board={left:40,top:40,right:500,bottom:380},toolbar={left:510,top:40,right:830,bottom:380};
 const bounds=branchOverlayBounds({left:8,top:8,right:836,bottom:382},board,toolbar);
 expect(bounds.right).toBe(502);
 expect(placeBranchOverlay(bounds,{width:320,height:140},board,{x:800,y:-99})).toEqual({x:182,y:8});
});
