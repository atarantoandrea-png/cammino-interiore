from PIL import Image, ImageFilter
import numpy as np
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')

def build(name, photo_circle=None):
    im = Image.open(name).convert('RGB')
    w,h = im.size
    rgb = np.asarray(im).astype(np.float32)/255.0

    # ---------- NORMAL: Sobel sulla luminanza sfocata ----------
    lum = Image.fromarray((0.299*rgb[:,:,0]+0.587*rgb[:,:,1]+0.114*rgb[:,:,2])*255).convert('L')
    lum = lum.filter(ImageFilter.GaussianBlur(1.2))
    Lm = np.asarray(lum).astype(np.float32)/255.0
    gy, gx = np.gradient(Lm)
    strength = 5.0
    nx = -gx*strength; ny = gy*strength; nz = np.ones_like(Lm)
    inv = 1.0/np.sqrt(nx*nx+ny*ny+nz*nz)
    nmap = np.stack([(nx*inv*0.5+0.5),(ny*inv*0.5+0.5),(nz*inv*0.5+0.5)],axis=-1)
    Image.fromarray((nmap*255).astype(np.uint8)).save(name.replace('.jpg','_n.jpg'),'JPEG',quality=85)

    # ---------- MASCHERE colore (HSV) ----------
    hsv = np.asarray(im.convert('HSV')).astype(np.float32)
    Hh, Ss, Vv = hsv[:,:,0], hsv[:,:,1]/255.0, hsv[:,:,2]/255.0
    # oro: hue 18..48 (su 0-255), saturo e luminoso
    gold = ((Hh>14)&(Hh<46)&(Ss>0.35)&(Vv>0.42)).astype(np.float32)
    # gemme viola: hue 170..210
    gem  = ((Hh>165)&(Hh<215)&(Ss>0.3)&(Vv>0.25)).astype(np.float32)
    # escludi il cerchio della foto
    if photo_circle:
        cx,cy,r = photo_circle
        Y,X = np.ogrid[:h,:w]
        inside = ((X-cx)**2+(Y-cy)**2) < r*r
        gold[inside]=0; gem[inside]=0
    # ammorbidisci
    gold = np.asarray(Image.fromarray((gold*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)),dtype=np.float32)/255.0
    gem  = np.asarray(Image.fromarray((gem*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)),dtype=np.float32)/255.0

    # ---------- METALNESS ----------
    metal = np.clip(gold*1.15,0,1)
    Image.fromarray((metal*255).astype(np.uint8)).save(name.replace('.jpg','_m.jpg'),'JPEG',quality=80)

    # ---------- ROUGHNESS ----------
    rough = 0.86 - 0.52*gold - 0.55*gem - (Lm-0.35)*0.10
    if photo_circle:
        rough[inside] = 0.55
    rough = np.clip(rough,0.18,1)
    Image.fromarray((rough*255).astype(np.uint8)).save(name.replace('.jpg','_r.jpg'),'JPEG',quality=80)
    print(name,'-> n/m/r ok | gold px:',int(gold.sum()),'gem px:',int(gem.sum()))

# cerchio foto nel front (710x840): centro ~(355,245) r~180
build('face_front.jpg', photo_circle=(355,250,205))
build('face_spine.jpg')
build('face_back.jpg')

tot=0
for f in os.listdir('.'):
    if f.startswith('face_'): tot+=os.path.getsize(f)
print('totale texture:', tot//1024, 'KB')
