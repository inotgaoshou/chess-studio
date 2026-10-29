import {expect,it} from 'vitest';
import {branchOverlayBounds,placeBranchOverlay} from './branchOverlay';
it('places branches below the board near the engine rather than over the pieces',()=>{
 const board={left:8,top:80,right:382,bottom:600},dock={left:8,top:666,right:382,bottom:730};
 const bounds=branchOverlayBounds({left:8,top:47,right:382,bottom:802},board,dock);
 expect(bounds.top).toBe(606);
 expect(placeBranchOverlay(bounds,{width:280,height:40},board,undefined,dock)).toEqual({x:8,y:736});
 expect(placeBranchOverlay(bounds,{width:280,height:40},board,{x:999,y:999})).toEqual({x:102,y:762});
});
it('uses the sidebar in landscape and keeps dragged cards outside the board',()=>{
 const board={left:40,top:40,right:500,bottom:380},dock={left:510,top:80,right:830,bottom:280};
 const bounds=branchOverlayBounds({left:8,top:8,right:836,bottom:382},board,dock);
 expect(bounds.left).toBe(506);
 expect(placeBranchOverlay(bounds,{width:300,height:40},board,{x:10,y:99})).toEqual({x:506,y:99});
});
