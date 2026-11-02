from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT=Path(__file__).resolve().parent
FONT='/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc'
def font(size,bold=False): return ImageFont.truetype(FONT,size,index=7 if bold else 3)
INK='#153F34'; MUTED='#527468'; ACCENT='#327D5E'
items=[('practice','每一着，看得更清楚','大棋盘练习 · 提示与解析按需打开'),('learning','循序练习，学会方法','杀法与残局学习路线 · 阶段练习与自查'),('analysis','看局势，也看变化','AI 候选分析 · 中文着法 · 临时推演'),('library','分组练习，进度清楚','每组 25 题 · 每页 50 题 · 数字导航')]
def base(w,h):
 im=Image.new('RGB',(w,h)); d=ImageDraw.Draw(im)
 for y in range(h):
  t=y/h; d.line((0,y,w,y),fill=tuple(round(a*(1-t)+b*t) for a,b in zip((241,248,241),(218,235,223))))
 d.ellipse((w*.55,-w*.35,w*1.3,w*.4),outline='#D4E6DA',width=max(2,w//400))
 return im

def asset(device,idx,key,title,sub,w,h):
 im=base(w,h); d=ImageDraw.Draw(im); k=w/1206
 x=int(80*k)
 d.text((x,int(62*k)),'棋析  /  象棋学习与分析',font=font(int(29*k),True),fill=ACCENT)
 d.text((x,int(130*k)),title,font=font(int(68*k),True),fill=INK)
 d.text((x,int(228*k)),sub,font=font(int(30*k)),fill=MUTED)
 shot=Image.open(ROOT/'raw'/f'{device}-{key}.png').convert('RGB')
 if device=='ipad' and key=='practice': shot=shot.crop((0,0,shot.width,800))
 margin=int(68*k); top=int(340*k); maxw=w-margin*2; maxh=h-top-int(100*k)
 scale=min(maxw/shot.width,maxh/shot.height)
 shot=shot.resize((round(shot.width*scale),round(shot.height*scale)),Image.Resampling.LANCZOS)
 sx=(w-shot.width)//2; sy=top
 shadow=Image.new('RGBA',(w,h)); sd=ImageDraw.Draw(shadow)
 sd.rounded_rectangle((sx-10,sy+15,sx+shot.width+10,sy+shot.height+28),radius=int(30*k),fill=(26,67,47,45))
 shadow=shadow.filter(ImageFilter.GaussianBlur(int(20*k))); im=Image.alpha_composite(im.convert('RGBA'),shadow)
 mask=Image.new('L',shot.size); ImageDraw.Draw(mask).rounded_rectangle((0,0,shot.width-1,shot.height-1),radius=int(22*k),fill=255)
 im.paste(shot,(sx,sy),mask)
 d=ImageDraw.Draw(im); d.rounded_rectangle((sx-2,sy-2,sx+shot.width+2,sy+shot.height+2),radius=int(24*k),outline='#B6CEBF',width=max(2,round(k*2)))
 if device=='ipad' and key=='practice':
  by=sy+shot.height+int(90*k)
  d.text((x,by),'先观察，再落子；复盘时理解每一步。',font=font(int(36*k),True),fill=INK)
 d.text((x,h-int(60*k)),'棋析  ·  v1.1.0',font=font(int(23*k)),fill=MUTED)
 out=ROOT/device;out.mkdir(exist_ok=True);p=out/f'{idx:02d}-{key}.png'; im.convert('RGB').save(p,optimize=True)
 return p
paths=[]
for dev,w,h in [('iphone',1206,2622),('ipad',2064,2752)]:
 for idx,(key,title,sub) in enumerate(items,1):paths.append(asset(dev,idx,key,title,sub,w,h))
# Contact sheet keeps complete assets visible for QA.
thumbs=[]
for p in paths:
 im=Image.open(p);im.thumbnail((310,560));thumbs.append((p,im.copy()))
contact=Image.new('RGB',(1280,1200),'#E4EBE5');cd=ImageDraw.Draw(contact)
for n,(p,im) in enumerate(thumbs):
 x=(n%4)*320+(320-im.width)//2;y=(n//4)*600+32
 contact.paste(im,(x,y));cd.text(((n%4)*320+12,(n//4)*600+6),f'{p.parent.name} {p.stem}',font=font(16),fill=INK)
contact.save(ROOT/'contact-sheet.jpg',quality=92)
# General-purpose marketing banner, composed from actual app screens.
b=base(1920,1080);d=ImageDraw.Draw(b)
d.text((100,118),'棋析',font=font(102,True),fill=INK)
d.text((105,280),'看清每一着，练好每一步',font=font(52,True),fill=INK)
for i,t in enumerate(['杀法与残局学习路线','25 题分组 · 清晰进度','AI 分析 · 中文棋谱']):d.text((110,410+i*90),t,font=font(35),fill=MUTED)
d.text((110,880),'v1.1.0  ·  iPhone 与 iPad',font=font(28,True),fill=ACCENT)
shot=Image.open(ROOT/'raw'/'iphone-analysis.png').convert('RGB');shot.thumbnail((510,940));b.paste(shot,(1270,70))
b.save(ROOT/'marketing-1920x1080.png',optimize=True)
print('Generated',len(paths),'screenshots and marketing banner')

large=ROOT/'iphone-large';large.mkdir(exist_ok=True)
for p in (ROOT/'iphone').glob('*.png'):
 Image.open(p).resize((1320,2868),Image.Resampling.LANCZOS).save(large/p.name,optimize=True)
