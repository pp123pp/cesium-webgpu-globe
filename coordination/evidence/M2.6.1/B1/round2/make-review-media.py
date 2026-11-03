from pathlib import Path
import json, hashlib
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent / "comparison"
out = root / "review"
out.mkdir(exist_ok=True)
SIZE = 512
BAR = 30
def load(side, name):
    meta = json.loads((root/side/(name+".json")).read_text(encoding="utf-8"))
    im = Image.open(root/side/(name+".png")).convert("RGB")
    x,y = map(lambda v:int(round(v)), meta["geometry"]["center"])
    crop=im.crop((x-SIZE//2,y-SIZE//2,x+SIZE//2,y+SIZE//2))
    return im,crop,meta
def tile(side,name,label):
    _,crop,meta=load(side,name)
    im=Image.new("RGB",(SIZE,SIZE+BAR),(16,19,24))
    im.paste(crop,(0,BAR))
    ImageDraw.Draw(im).text((8,8),label,fill=(238,240,245))
    return im
for name,label in [("combined-low-1080-e1","Combined / exposure 1 / Bloom .35"),("rays-low-1080-e1","Rays diagnostic / Bloom 0"),("disc-zoom-1080-e0.5","Disc zoom / exposure .5 / Bloom 0")]:
    im=Image.new("RGB",(SIZE*2,SIZE+BAR))
    im.paste(tile("before",name,"PREVIOUS B1 | "+label),(0,0))
    im.paste(tile("after",name,"ROUND 2 | "+label),(SIZE,0))
    im.save(out/(name+"-comparison.png"))
im=Image.new("RGB",(SIZE*3,SIZE+BAR))
for col,(name,label) in enumerate([("combined-low-1080-e1","All effects (primary)"),("diagnostic-corona-off-1080-e1","Diagnostic: Corona = 0"),("diagnostic-rays-off-1080-e1","Diagnostic: Rays = 0")]):
    im.paste(tile("after",name,label+" | Bloom .35"),(col*SIZE,0))
im.save(out/"layer-attribution.png")
im=Image.new("RGB",(SIZE*3,SIZE+BAR))
for col,e in enumerate([0.5,1,2]):
    im.paste(tile("after",f"combined-low-1080-e{e}",f"Exposure {e} | all effects | Bloom .35"),(col*SIZE,0))
im.save(out/"combined-exposures.png")
frames=[]
for first in range(0,160,20):
    sheet=Image.new("RGB",(SIZE*4,(SIZE+BAR)*5),(16,19,24))
    for idx in range(first,first+20):
        name=f"motion-{idx:03d}"
        _,crop,meta=load("after",name)
        e=meta["state"]["controls"]["exposure"]
        w=meta["state"]["viewport"]["width"]
        label=f"{idx:03d}  e={e} {w}px | "+(",".join(meta.get("intentionalDiscontinuities",[])) or "continuous sample")
        frame=Image.new("RGB",(SIZE,SIZE+BAR),(16,19,24))
        frame.paste(crop,(0,BAR))
        ImageDraw.Draw(frame).text((6,8),label,fill=(238,240,245))
        frames.append(frame)
        local=idx-first
        sheet.paste(frame,((local%4)*SIZE,(local//4)*(SIZE+BAR)))
    sheet.save(out/f"motion-contact-{first:03d}-{first+19:03d}.png")
frames[0].save(out/"motion-sun-region.webp",save_all=True,append_images=frames[1:],duration=100,loop=0,lossless=True,method=4)
sources=[]
for file in sorted((root/"after").glob("motion-*.png")):
    sources.append({"path":"../after/"+file.name,"sha256":hashlib.sha256(file.read_bytes()).hexdigest()})
manifest={"sourceRoot":"../","method":"Lossless native-pixel 512x512 crops centered on each recorded Sun projection; no rescale, color/exposure adjustment or synthetic pixels inside the crop. Labels are outside the source crop. Lossless animated WebP playback is 10 fps and is not a render-performance measurement. Original full WebGPU PNGs and JSON sidecars remain authoritative.","animation":"motion-sun-region.webp","frameCount":160,"sources":sources}
(out/"derivatives.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
print(json.dumps({"reviewFiles":len(list(out.iterdir())),"bytes":sum(f.stat().st_size for f in out.iterdir()),"animationBytes":(out/"motion-sun-region.webp").stat().st_size}))
