const assert=require('node:assert/strict');

// Exercise the actual scrollport: a CSS sticky declaration alone is insufficient
// when an ancestor clips it or a mobile route uses a nested scrolling container.
exports.checkStickyNumbers=async page=>{
  const nav=page.getByRole('navigation',{name:'题库数字导航'});
  await page.waitForFunction(()=>{
    let port=document.querySelector('.practice-question-numbers')?.parentElement;
    while(port&&!/auto|scroll/.test(getComputedStyle(port).overflowY))port=port.parentElement;
    return !!port;
  });
  const scroll=async amount=>{
    await nav.evaluate((node,delta)=>{
      let port=node.parentElement;
      while(port&&!/auto|scroll/.test(getComputedStyle(port).overflowY))port=port.parentElement;
      if(!port)throw new Error('Missing catalog scrollport');
      if(delta===null)port.scrollTop+=node.getBoundingClientRect().top-port.getBoundingClientRect().top+300;
      else port.scrollTop+=delta;
    },amount);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const frozen=async()=>{
    const box=await nav.evaluate(node=>{
      let port=node.parentElement;
      while(port&&!/auto|scroll/.test(getComputedStyle(port).overflowY))port=port.parentElement;
      const r=node.getBoundingClientRect(),p=port.getBoundingClientRect();
      return {top:r.top,portTop:p.top,height:r.height,portHeight:p.height};
    });
    assert(Math.abs(box.top-box.portTop)<=1,`navigator must freeze at scrollport top: ${JSON.stringify(box)}`);
    assert(box.height<box.portHeight*.75,'expanded navigator leaves room for question cards');
    return box;
  };
  await scroll(null);await frozen();
  const before=await page.locator('.catalog-problem-card').nth(10).boundingBox();
  await scroll(180);await frozen();
  const after=await page.locator('.catalog-problem-card').nth(10).boundingBox();
  assert(Math.abs(before.y-after.y-180)<=1,'cards continue scrolling below frozen navigation');
  await nav.getByRole('button',{name:'收起数字导航',exact:true}).click();
  await scroll(120);const collapsed=await frozen();
  await nav.getByRole('button',{name:'展开数字导航',exact:true}).click();
  const expanded=await frozen();assert(expanded.height>collapsed.height);
  const viewport=page.viewportSize();
  await page.setViewportSize({width:viewport.width+16,height:viewport.height});
  await frozen();await page.setViewportSize(viewport);await frozen();
};

exports.checkUncoveredCard=async(page,index)=>{
  await page.waitForFunction(i=>{
    const card=document.querySelectorAll('.catalog-problem-card')[i]?.getBoundingClientRect();
    const nav=document.querySelector('.practice-question-numbers')?.getBoundingClientRect();
    return card&&nav&&card.top>=nav.bottom+8&&card.top<innerHeight-30;
  },index);
};
