import base64, os
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
html = open('book-preview.html', encoding='utf-8').read()
files = [
    'face_front.jpg','face_front_n.jpg','face_front_r.jpg','face_front_m.jpg',
    'face_spine.jpg','face_spine_n.jpg','face_spine_r.jpg','face_spine_m.jpg',
    'face_back.jpg','face_back_n.jpg','face_back_r.jpg','face_back_m.jpg',
    'leather_c.jpg','leather_n.jpg',
    'mod1.jpg','mod2.jpg','mod3.jpg','mod4.jpg',
    'pagina.jpg','logo.png',
]
for f in files:
    ph = 'src="%s"' % f
    if ph not in html:
        print('SKIP (not found):', ph); continue
    mime = 'image/png' if f.endswith('.png') else 'image/jpeg'
    b64 = base64.b64encode(open(f,'rb').read()).decode()
    html = html.replace(ph, 'src="data:%s;base64,%s"' % (mime, b64))
    print('embedded', f)
open('book-preview.html', 'w', encoding='utf-8').write(html)
print('total size', os.path.getsize('book-preview.html')//1024, 'KB')
