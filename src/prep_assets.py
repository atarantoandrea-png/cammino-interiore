from PIL import Image
import os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
pg = Image.open(r'C:\Users\Andrea\Downloads\Pagina.png').convert('RGB')
pg = pg.resize((1024, int(1024*pg.height/pg.width)), Image.LANCZOS)
pg.save('pagina.jpg','JPEG',quality=85)
print('pagina.jpg', pg.size, os.path.getsize('pagina.jpg')//1024,'KB')
lg = Image.open(r'C:\Users\Andrea\Downloads\Logo 1.png').convert('RGB')
lg.thumbnail((520,520), Image.LANCZOS)
lg.save('logo.jpg','JPEG',quality=86)
print('logo.jpg', lg.size, os.path.getsize('logo.jpg')//1024,'KB')
