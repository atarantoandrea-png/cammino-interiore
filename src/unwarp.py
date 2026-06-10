from PIL import Image
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
src = Image.open(r'C:\Users\Andrea\Downloads\Copertina cammino interiore.png').convert('RGB')

# quad nel sorgente: NW, SW, SE, NE (pixel)
FACES = {
    'face_front.jpg': ((784,62),(784,987),(1444,938),(1448,95),(1024,1434)),
    'face_spine.jpg': ((592,80),(612,975),(782,995),(782,60),(256,1434)),
    'face_back.jpg':  ((122,108),(137,945),(588,958),(570,84),(1024,1434)),
}
for name,(nw,sw,se,ne,size) in FACES.items():
    quad = (*nw,*sw,*se,*ne)
    out = src.transform(size, Image.QUAD, quad, resample=Image.BICUBIC)
    out.save(name,'JPEG',quality=88)
    print(name, out.size, os.path.getsize(name)//1024, 'KB')
