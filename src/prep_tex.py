from PIL import Image
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
src = r'tex\Leather030'
Image.open(src + r'\Leather030_1K-JPG_Color.jpg').save('leather_c.jpg','JPEG',quality=82)
Image.open(src + r'\Leather030_1K-JPG_NormalGL.jpg').save('leather_n.jpg','JPEG',quality=85)
Image.open(src + r'\Leather030_1K-JPG_Roughness.jpg').resize((512,512),Image.LANCZOS).save('leather_r.jpg','JPEG',quality=80)
for f in ['leather_c.jpg','leather_n.jpg','leather_r.jpg']:
    print(f, os.path.getsize(f)//1024, 'KB')
