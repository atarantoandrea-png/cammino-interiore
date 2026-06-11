/* Oltre il Velo — server: pagine statiche + archivio progressi per account */
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(compression());
const DATA = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA, { recursive: true });

app.use(express.json({ limit: '2mb' }));

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function fileFor(email){
  const h = crypto.createHash('sha1').update(email).digest('hex');
  return path.join(DATA, h + '.json');
}
function readStore(f){
  try{
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  }catch(e){}
  return { data:{}, meta:{} };
}

app.get('/api/ping', (req,res)=>res.json({ ok:true }));

app.get('/api/store', (req,res)=>{
  const email = String(req.query.email||'').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ error:'email' });
  res.json(readStore(fileFor(email)));
});

/* unione chiave per chiave: vince il timestamp più recente,
   così PC e telefono non si sovrascrivono mai a vicenda */
const saveStore = (req,res)=>{
  const b = req.body || {};
  const email = String(b.email||'').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ error:'email' });
  const data = b.data, meta = b.meta;
  if (typeof data!=='object' || !data || typeof meta!=='object' || !meta)
    return res.status(400).json({ error:'body' });
  try{
    const f = fileFor(email);
    const cur = readStore(f);
    const out = { data:{}, meta:{} };
    const keys = new Set(Object.keys(data).concat(Object.keys(cur.data)));
    keys.forEach(k=>{
      const tNew = +meta[k] || 0, tOld = +cur.meta[k] || 0;
      if (k in data && tNew >= tOld){ out.data[k]=data[k]; out.meta[k]=tNew; }
      else { out.data[k]=cur.data[k]; out.meta[k]=tOld; }
    });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, f);
    res.json(out);
  }catch(e){
    console.error(e);
    res.status(500).json({ error:'write' });
  }
};
app.put('/api/store', saveStore);
app.post('/api/store', saveStore);   /* per sendBeacon all'uscita dalla pagina */

/* le pagine del sito: html mai in cache (i deploy si vedono subito),
   immagini e texture in cache 30 giorni (visite successive istantanee) */
app.use(express.static(__dirname, {
  maxAge: '30d',
  setHeaders(res, p){
    if (p.endsWith('.html')) res.setHeader('Cache-Control','no-cache');
  }
}));

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log('Oltre il Velo in ascolto su ' + port));
