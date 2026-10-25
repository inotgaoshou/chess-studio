// Original vector artwork, rasterized once at build time. No runtime filters.
// PLAYWRIGHT_MODULE_PATH points to an installed Playwright; no app dependency.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const root=path.resolve(__dirname,'..');
const reference=require('./skin-designs/reference-assets.json');
const {createHash}=require('node:crypto');
const designs=JSON.parse(fs.readFileSync(path.join(__dirname,'skin-designs/palettes.json'),'utf8'));
const output=path.join(root,'apps/endgame-training/public/skins');
// Share calibration with the renderer: artwork, touch, animation and exports agree.
const {columns:cols,rows}=require("../apps/endgame-training/src/authoredSkinGeometry.json");
const labels={r:['帥','仕','相','馬','車','炮','兵'],b:['將','士','象','馬','車','炮','卒']},codes=['k','a','b','n','r','c','p'];
const line=(x,y,x2,y2,stroke,width=2.6)=>`<path d="M${x} ${y}L${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
const svg=(w,h,body)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
function board(d,blank=false){
 // A thin 6px sidewall; rounded silhouette and grid calibration stay independent.
 let b=`<defs>
  <linearGradient id="board-surface" x1="0" y1="0" x2=".12" y2="1"><stop stop-color="${d.field}"/><stop offset=".48" stop-color="${d.fieldMiddle||d.field}"/><stop offset="1" stop-color="${d.fieldBottom||d.field}"/></linearGradient>
  <linearGradient id="board-side" x1="0" y1="0" x2=".2" y2="1"><stop stop-color="${tone(d.edge,-.1)}"/><stop offset=".8" stop-color="${tone(d.edge,-.15)}"/><stop offset="1" stop-color="${tone(d.edge,-.24)}"/></linearGradient>
  <linearGradient id="board-bevel" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="${tone(d.field,.45)}"/><stop offset=".4" stop-color="${tone(d.field,.12)}"/><stop offset=".8" stop-color="${d.edge}"/><stop offset="1" stop-color="${tone(d.edge,-.1)}"/></linearGradient>
  <radialGradient id="board-light" cx=".12" cy=".05" r="1.15"><stop stop-color="#fff9e8" stop-opacity="${d.motif === 'clean' ? .02 : .08}"/><stop offset=".55" stop-color="#fff9e8" stop-opacity="0"/><stop offset="1" stop-color="#45301b" stop-opacity="${d.motif === 'clean' ? 0 : .04}"/></radialGradient>
  <clipPath id="board-face"><rect x="5" y="5" width="1110" height="1224" rx="12"/></clipPath>
 </defs>
 <rect x="1" y="5" width="1118" height="1234" rx="16" fill="url(#board-side)"/>
 <rect x="1" y="1" width="1118" height="1232" rx="16" fill="url(#board-bevel)"/>
 <g clip-path="url(#board-face)"><rect width="1120" height="1240" fill="url(#board-surface)"/>`;
 // Fine grain belongs to the surface only; it never runs across the bevel or sidewall.
 if(d.motif==='wood'){
  b+=`<defs><linearGradient id="timber"><stop stop-color="#fff5d4" stop-opacity=".2"/><stop offset=".45" stop-color="#b67b37" stop-opacity=".04"/><stop offset="1" stop-color="#fff3c9" stop-opacity=".15"/></linearGradient></defs><rect width="1120" height="1240" rx="8" fill="url(#timber)"/>`;
  // Rasterize organic grain once; the client receives a normal PNG, not a live filter.
  b+=`<defs><filter id="natural-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".052 .0032" numOctaves="3" seed="23" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect x="5" y="5" width="1110" height="1224" filter="url(#natural-grain)" opacity=".12" style="mix-blend-mode:soft-light"/>`;
  const noise=i=>{const v=Math.sin(i*127.1+31.7)*43758.5453;return v-Math.floor(v);};
  for(let i=0;i<90;i++){
   const x=i*13-20+noise(i)*10, bend=(noise(i+113)-.5)*50;
   const warm=i%3!==0;
   b+=`<path d="M${x} -20 C${x+bend} 250 ${x-bend*.4} 430 ${x+Math.sin(i)*12} 640 S${x+bend*.7} 970 ${x+noise(i+33)*18} 1260" fill="none" stroke="${warm?d.line:'#fff2cb'}" stroke-opacity="${warm ? .035+noise(i+44)*.05 : .13}" stroke-width="${.6+noise(i+72)*2}"/>`;
  }
 }
 b+=`<rect width="1120" height="1240" fill="url(#board-light)"/></g><path d="M3 28V18Q3 3 18 3H1100" fill="none" stroke="${tone(d.field,.65)}" stroke-opacity=".65" stroke-width="1.5"/><path d="M19 1235H1100" fill="none" stroke="${tone(d.edge,.2)}" stroke-opacity=".6" stroke-width="1"/>`;
 // Draw each boundary once. A slightly stronger perimeter frames the fine grid.
 b+=`<rect x="${cols[0]}" y="${rows[0]}" width="${cols[8]-cols[0]}" height="${rows[9]-rows[0]}" fill="none" stroke="${d.line}" stroke-width="3.6" stroke-linejoin="round"/>`;
 let grid='';
 rows.slice(1,-1).forEach((y,index)=>{if(index!==3&&index!==4)grid+=`M${cols[0]} ${y}H${cols[8]}`;});
 cols.slice(1,-1).forEach(x=>{grid+=`M${x} ${rows[0]}V${rows[4]}M${x} ${rows[5]}V${rows[9]}`;});
 b+=`<path d="${grid}" fill="none" stroke="${d.line}" stroke-width="2.8"/>`;
 for(const y of [rows[4],rows[5]])b+=line(cols[0],y,cols[8],y,d.line,3);
 for(const r of [0,7]){b+=line(cols[3],rows[r],cols[5],rows[r+2],d.line);b+=line(cols[5],rows[r],cols[3],rows[r+2],d.line);}
 for(const [r,cs] of [[2,[1,7]],[3,[0,2,4,6,8]],[6,[0,2,4,6,8]],[7,[1,7]]])for(const c of cs)for(const dx of [-1,1]){
  if(c===0&&dx===-1||c===8&&dx===1)continue;
  for(const dy of [-1,1]) b+=`<path d="M${cols[c]+dx*23} ${rows[r]+dy*9}h${-dx*14}v${dy*14}" fill="none" stroke="${d.line}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
 }
 if(!blank)b+=`<g fill="${d.accent}" font-family="SkinKai" font-size="80" font-weight="400" text-anchor="middle" stroke="${d.accent}" stroke-width=".3"><text x="312" y="645" letter-spacing="16">楚河</text><text x="808" y="645" letter-spacing="16">汉界</text></g>`;
 return svg(1120,1240,b);
}
// Lighting is baked into the 120px transparent sprite; the board hitbox is unchanged.
function tone(hex,amount){
 const channels=hex.replace('#','').match(/../g).map(v=>parseInt(v,16));
 return '#'+channels.map(v=>Math.round(amount>0?v+(255-v)*amount:v*(1+amount)).toString(16).padStart(2,'0')).join('');
}
function piece(d,side,label){
 const red=side==='r', ink=red?d.red:d.black;
 const bamboo=d.style==='bamboo',competitive=d.style==='competitive';
 const dark=!red&&d.style==='porcelain';
 const face=competitive?ink:dark?'#172024':d.face;
 const edge=bamboo?'#7b8735':competitive?ink:dark?'#263239':d.base;
 const text=competitive||dark?'#fffdf0':ink;
 const faceBottom=competitive?tone(face,-.16):dark?'#080d10':tone(face,-.075);
 let rim='';
 if(bamboo)for(let i=0;i<36;i++)rim+=`<path d="M60 3l3.5 4-3.5 3" transform="rotate(${i*10} 60 55)" fill="none" stroke="${i%2?'#c8c477':'#4c611e'}" stroke-opacity=".85" stroke-width="1.4"/>`;
 const airyGlyph=bamboo||d.style==='porcelain';
 const family=competitive?'SkinText':'SkinKai',fontSize=competitive?72:airyGlyph?84:90,baseline=competitive?79:airyGlyph?82:85;
 const glyph=(y,color,opacity=1)=>`<text x="60" y="${y}" text-anchor="middle" font-family="${family}" font-size="${fontSize}" font-weight="${competitive?500:400}" fill="${color}" opacity="${opacity}" stroke="${color}" stroke-width="${competitive?0:.8}" paint-order="stroke">${label}</text>`;
 return svg(120,120,`
  <defs>
   <radialGradient id="shadow"><stop offset=".55" stop-color="#22190b" stop-opacity=".36"/><stop offset="1" stop-color="#22190b" stop-opacity="0"/></radialGradient>
   <linearGradient id="body" x1="0" y1="0" x2=".25" y2="1"><stop stop-color="${tone(edge,-.25)}"/><stop offset=".65" stop-color="${tone(edge,-.12)}"/><stop offset=".89" stop-color="${tone(edge,-.38)}"/><stop offset="1" stop-color="${tone(edge,-.18)}"/></linearGradient>
   <linearGradient id="bevel" x1=".2" y1="0" x2=".75" y2="1"><stop stop-color="${tone(edge,.62)}"/><stop offset=".22" stop-color="${tone(edge,.28)}"/><stop offset=".52" stop-color="${edge}"/><stop offset=".84" stop-color="${tone(edge,-.28)}"/><stop offset="1" stop-color="${tone(edge,-.43)}"/></linearGradient>
   <radialGradient id="face" cx=".3" cy=".18" r=".9"><stop stop-color="${tone(face,(competitive || dark) ? .18 : .06)}"/><stop offset=".48" stop-color="${face}"/><stop offset="1" stop-color="${faceBottom}"/></radialGradient>
  </defs>
  <ellipse cx="62" cy="67" rx="57" ry="52" fill="url(#shadow)"/>
  <circle cx="60" cy="63" r="53" fill="url(#body)"/>
  <path d="M13 82 A52 52 0 0 0 105 87" fill="none" stroke="${tone(edge,.22)}" stroke-opacity=".5" stroke-width="1.2"/>
  <circle cx="60" cy="55" r="53" fill="url(#bevel)" stroke="${tone(edge,-.3)}" stroke-width=".8"/>
  ${rim}
  <circle cx="60" cy="54" r="48" fill="url(#face)" stroke="${tone(edge,-.15)}" stroke-width=".8"/>
  <path d="M14 35 A50 50 0 0 1 91 16" fill="none" stroke="${tone(edge,.85)}" stroke-opacity=".75" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="60" cy="54" r="45.5" fill="none" stroke="${bamboo?'#a99b51':text}" stroke-opacity="${competitive ? .6 : .75}" stroke-width="1.1"/>
  ${glyph(baseline+.85,competitive||dark?'#000':'#fff9dd',.42)}
  ${glyph(baseline,text)}
 `);
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1120,height:1240},deviceScaleFactor:1});
 const kaiSource=process.env.SKIN_CALLIGRAPHY_FONT
  ? `url(data:font/ttf;base64,${fs.readFileSync(process.env.SKIN_CALLIGRAPHY_FONT).toString('base64')})`
  : 'local("Kaiti SC"),local("STKaiti"),local("Kai")';
 const font=fs.readFileSync(path.join(root,'apps/desktop/src-tauri/resources/fonts/NotoSansSC-VF.ttf')).toString('base64');
 await page.setContent(`<style>@font-face{font-family:SkinText;src:url(data:font/ttf;base64,${font});font-weight:100 900}@font-face{font-family:SkinKai;src:${kaiSource}}html,body{margin:0;background:transparent}svg{display:block}</style><main></main>`);
 await page.evaluate(()=>document.fonts.load('650 70px SkinText','帥仕相馬車炮兵將士象卒楚河漢界一二三四五六七八九'));
 await page.evaluate(()=>document.fonts.load('400 80px SkinKai','帥仕相馬車炮兵將士象卒楚河漢界'));
 for(const d of designs){
  if(d.id===reference.id){
   for(const [file,hash] of Object.entries(reference.files)){
    const bytes=fs.readFileSync(path.join(output,d.id,file));
    if(createHash("sha256").update(bytes).digest("hex")!==hash)throw new Error(`Reference asset changed: ${file}`);
   }
   console.log(`${d.id}: original source assets preserved`);continue;
  }
  const dir=path.join(output,d.id);fs.mkdirSync(dir,{recursive:true});
  const assets={'board.png':board(d),'board-river-blank.png':board(d,true)};
  if(!process.argv.includes('--boards-only'))for(const side of ['r','b'])codes.forEach((code,i)=>assets[side+code+'.png']=piece(d,side,labels[side][i]));
  for(const [name,source] of Object.entries(assets)){
   await page.locator('main').evaluate((el,source)=>el.innerHTML=source,source);
   await page.locator('svg').screenshot({path:path.join(dir,name),omitBackground:true});
  }
  console.log(`${d.id}: ${Object.keys(assets).length} PNG assets`);
 }
 const catalog=designs.map(({id,name,description})=>({id,name,description,source:'folder',supportsCustomRiverText:id!==reference.id,group:'2d'}));
 fs.writeFileSync(path.join(root,'apps/endgame-training/src/authoredSkinCatalog.json'),JSON.stringify(catalog,null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
