import urllib.request, io, os
from PIL import Image
os.chdir(r'C:\Users\Andrea\Documents\cammino-interiore-3d')
MODS = [
    ('mod1.jpg','https://d1yei2z3i6k35z.cloudfront.net/7767646/69e79f084d90d1.68959561_IntroduzioneCamminointeriore.png'),
    ('mod2.jpg','https://d1yei2z3i6k35z.cloudfront.net/7767646/69e79f1ce6df15.46439956_ElisaSoulMediumCapitolo1Lafrequenzanascosta.png'),
    ('mod3.jpg','https://d1yei2z3i6k35z.cloudfront.net/7767646/69e79e920afed8.25038803_SpazioEmotivoElisaSoulMEdium.png'),
    ('mod4.jpg','https://d1yei2z3i6k35z.cloudfront.net/7767646/69e79e9213b696.10490588_OsservatoriointerioreElisaSoulMedium.png'),
]
for name,url in MODS:
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
    data = urllib.request.urlopen(req, timeout=30).read()
    img = Image.open(io.BytesIO(data)).convert('RGB')
    img.thumbnail((760,760), Image.LANCZOS)
    img.save(name,'JPEG',quality=84)
    print(name, img.size, os.path.getsize(name)//1024,'KB')
