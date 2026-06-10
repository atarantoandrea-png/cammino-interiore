from PIL import Image
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
img = Image.open(r'C:\Users\Andrea\Downloads\Logo 1.png').convert('RGB')
img.thumbnail((480,480), Image.LANCZOS)
img.save('logo.png','PNG')
print('logo.png (originale)', img.size, os.path.getsize('logo.png')//1024, 'KB')
