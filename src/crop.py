from PIL import Image
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
src = Image.open(r'C:\Users\Andrea\Downloads\Copertina cammino interiore 2.png').convert('RGB')
W,H = src.size  # 1774x887
# bordi stimati (su 600x300: back 8..248, spine 258..342, front 352..592, y 8..292)
sx = W/600.0; sy = H/300.0
def box(x0,y0,x1,y1): return (int(x0*sx),int(y0*sy),int(x1*sx),int(y1*sy))
crops = {
    'face_back.jpg':  box(8,8,248,292),
    'face_spine.jpg': box(258,8,342,292),
    'face_front.jpg': box(352,8,592,292),
}
for name,bx in crops.items():
    im = src.crop(bx)
    im.save(name,'JPEG',quality=88)
    print(name, im.size, 'ratio', round(im.size[0]/im.size[1],3))
