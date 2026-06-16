/* Oltre il Velo — server: pagine statiche + archivio progressi per account */
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');

const app = express();
app.use(compression());
const DATA = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA, { recursive: true });

app.use(express.json({ limit: '2mb' }));

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function fileFor(email, ns){
  const h = crypto.createHash('sha1').update(email).digest('hex');
  /* ns opzionale: un archivio separato per ogni tipo di dato (cap2, foglio del
     Bambino, riflessioni…), così non si mescolano col Giornaliero. Ripulito a
     [a-z0-9], max 24 char → resta sempre dentro DATA, niente path traversal. */
  const tag = ns ? '.' + String(ns).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,24) : '';
  return path.join(DATA, h + tag + '.json');
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
  if (!storeAuthOk(req, email)) return res.status(401).json({ error:'auth' });
  res.json(readStore(fileFor(email, req.query.ns)));
});

/* unione chiave per chiave: vince il timestamp più recente,
   così PC e telefono non si sovrascrivono mai a vicenda */
const saveStore = (req,res)=>{
  const b = req.body || {};
  const email = String(b.email||'').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ error:'email' });
  if (!storeAuthOk(req, email)) return res.status(401).json({ error:'auth' });
  const data = b.data, meta = b.meta;
  if (typeof data!=='object' || !data || typeof meta!=='object' || !meta)
    return res.status(400).json({ error:'body' });
  try{
    const f = fileFor(email, b.ns);
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

/* ── AUTH: verifica email su Google Sheet + sessione singola ── */

const SHEETS_ID  = process.env.SHEETS_ID  || '';
const SHEETS_TAB = process.env.SHEETS_TAB || 'annuali';
const SHEETS_TAB2 = process.env.SHEETS_TAB2 || 'Cammino Interiore Speciali';
/* schede del CRM da controllare per le email autorizzate (annuale + speciali);
   override con SHEETS_TABS="Tab A,Tab B" se servisse */
const SHEETS_TABS = (process.env.SHEETS_TABS ? process.env.SHEETS_TABS.split(',') : [SHEETS_TAB, SHEETS_TAB2])
  .map(s => s.trim()).filter(Boolean);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; /* 30 giorni */
const EMAIL_CACHE_TTL = 5 * 60 * 1000;  /* 5 min */

let saKey = null;
try { saKey = JSON.parse(process.env.GOOGLE_SA_KEY || ''); } catch(e) {}

/* token OAuth2 per il service account (cache in memoria) */
let gsToken = null, gsTokenExp = 0;
function getGToken(cb) {
  if (gsToken && Date.now() < gsTokenExp - 60000) return cb(null, gsToken);
  if (!saKey) return cb('GOOGLE_SA_KEY non configurata');
  const now = Math.floor(Date.now() / 1000);
  const hdr = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
  const pld = Buffer.from(JSON.stringify({
    iss: saKey.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(hdr + '.' + pld);
  const jwt = hdr + '.' + pld + '.' + sign.sign(saKey.private_key, 'base64url');
  const body = querystring.stringify({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  });
  const opts = {
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}
  };
  const req = https.request(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(d);
        if (j.access_token) { gsToken = j.access_token; gsTokenExp = Date.now() + (j.expires_in||3600)*1000; cb(null, gsToken); }
        else cb('token error: ' + d);
      } catch(e) { cb(e); }
    });
  });
  req.on('error', cb); req.write(body); req.end();
}

/* dalle righe di una scheda: prende la colonna con intestazione "email"
   (fallback: qualsiasi cella che contiene "@") */
function emailsFromRows(rows) {
  if (!rows || !rows.length) return [];
  const header = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const col = header.findIndex(h => /mail/.test(h));   /* "Email", "Mail", "E-mail"… */
  const out = [];
  if (col >= 0) {
    for (let i = 1; i < rows.length; i++) {
      const v = rows[i][col];
      if (v && String(v).includes('@')) out.push(String(v).trim().toLowerCase());
    }
  } else {
    rows.forEach(r => (r || []).forEach(c => {
      if (c && String(c).includes('@')) out.push(String(c).trim().toLowerCase());
    }));
  }
  return out;
}

/* legge una scheda; in caso di errore (es. scheda inesistente) ritorna []
   così una scheda con nome sbagliato non blocca le altre (niente lockout) */
function fetchTabRows(token, tab, cb) {
  const opts = {
    hostname: 'sheets.googleapis.com',
    path: '/v4/spreadsheets/' + SHEETS_ID + '/values/' + encodeURIComponent(tab) + '?majorDimension=ROWS',
    headers: {'Authorization': 'Bearer ' + token}
  };
  https.get(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try { const j = JSON.parse(d); cb(j.error ? [] : emailsFromRows(j.values)); }
      catch(e) { cb([]); }
    });
  }).on('error', () => cb([]));
}

/* titoli reali delle schede del foglio (per risolvere i nomi configurati senza badare a maiuscole/spazi) */
function fetchSheetTitles(token, cb) {
  const opts = {
    hostname: 'sheets.googleapis.com',
    path: '/v4/spreadsheets/' + SHEETS_ID + '?fields=' + encodeURIComponent('sheets.properties.title'),
    headers: {'Authorization': 'Bearer ' + token}
  };
  https.get(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try { const j = JSON.parse(d); cb((j.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean)); }
      catch(e) { cb([]); }
    });
  }).on('error', () => cb([]));
}

/* cache lista email autorizzate: unione di tutte le schede in SHEETS_TABS.
   I nomi configurati vengono risolti ai titoli REALI del foglio in modo
   case-insensitive (maiuscole/spazi diversi non rompono più l'allowlist). */
let emailCache = null, emailCacheAt = 0;
function getAllowedEmails(cb) {
  if (emailCache && Date.now() - emailCacheAt < EMAIL_CACHE_TTL) return cb(null, emailCache);
  getGToken((err, token) => {
    if (err) return cb(err);
    fetchSheetTitles(token, titles => {
      const norm = s => String(s).trim().toLowerCase();
      const tabs = [...new Set(SHEETS_TABS.map(want => {
        const hit = titles.find(t => norm(t) === norm(want));
        return hit || want;   /* fallback al nome letterale se i titoli non sono disponibili */
      }))];
      let pending = tabs.length, all = [];
      if (!pending) { emailCache = new Set(); emailCacheAt = Date.now(); return cb(null, emailCache); }
      tabs.forEach(tab => fetchTabRows(token, tab, emails => {
        all = all.concat(emails);
        if (--pending === 0) { emailCache = new Set(all); emailCacheAt = Date.now(); cb(null, emailCache); }
      }));
    });
  });
}

/* file di sessione per email */
function sessFile(email) {
  const h = crypto.createHash('sha1').update('sess:' + email).digest('hex');
  return path.join(DATA, h + '.session.json');
}
function readSess(f) {
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) {}
  return null;
}

/* ── cookie di sessione (HttpOnly): serve al gating delle pagine riservate ── */
const COOKIE = 'ovl_sess';
function setSessionCookie(res, email, token) {
  const val = Buffer.from(email).toString('base64url') + '.' + token;
  res.append('Set-Cookie', COOKIE + '=' + val +
    '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL / 1000));
}
function clearSessionCookie(res) {
  res.append('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}
function parseCookies(req) {
  const out = {}; const h = req.headers.cookie;
  if (!h) return out;
  h.split(';').forEach(p => {
    const i = p.indexOf('='); if (i < 0) return;
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}
/* sessione valida? (email,token) combaciano col file di sessione e non è scaduta */
function sessionOk(email, token) {
  if (!emailRe.test(email) || !token) return false;
  const sess = readSess(sessFile(email));
  return !!(sess && sess.token === token && (Date.now() - sess.at) < SESSION_TTL);
}
/* sessione corrente letta dal cookie HttpOnly */
function sessionFromReq(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  let email;
  try { email = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8'); } catch(e) { return null; }
  const token = raw.slice(dot + 1);
  return sessionOk(email, token) ? { email, token } : null;
}
/* /api/store: ok se il cookie combacia con l'email, oppure se arriva un token valido (query/body) */
function storeAuthOk(req, email) {
  const s = sessionFromReq(req);
  if (s && s.email === email) return true;
  const token = String((req.query && req.query.token) || (req.body && req.body.token) || '');
  return sessionOk(email, token);
}

/* GET /api/auth/check?email=X — email autorizzata nel foglio? */
app.get('/api/auth/check', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ok: false, reason: 'email'});
  if (!SHEETS_ID) return res.status(500).json({ok: false, reason: 'config'});
  getAllowedEmails((err, emails) => {
    if (err) { console.error('sheets:', err); return res.status(500).json({ok: false, reason: 'sheets'}); }
    res.json({ok: emails.has(email)});
  });
});

/* POST /api/auth/session — crea sessione (login) o rinnova se stesso dispositivo.
   L'email DEVE essere nell'allowlist: niente più sessioni per email non autorizzate. */
app.post('/api/auth/session', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const existingToken = String(b.token || '');
  const force = !!b.force;
  if (!emailRe.test(email)) return res.status(400).json({ok: false, reason: 'email'});
  if (!SHEETS_ID) return res.status(500).json({ok: false, reason: 'config'});
  getAllowedEmails((err, emails) => {
    if (err) { console.error('sheets:', err); return res.status(500).json({ok: false, reason: 'sheets'}); }
    if (!emails.has(email)) return res.status(403).json({ok: false, reason: 'unauthorized'});
    const f = sessFile(email);
    const sess = readSess(f);
    if (sess && sess.token && (Date.now() - sess.at) < SESSION_TTL) {
      if (existingToken && existingToken === sess.token) {
        /* stesso dispositivo: rinnova timestamp */
        fs.writeFileSync(f, JSON.stringify({token: sess.token, at: Date.now()}));
        setSessionCookie(res, email, sess.token);
        return res.json({ok: true, token: sess.token});
      }
      if (!force) return res.json({ok: false, reason: 'active'});
      /* force=true: scaccia l'altra sessione, ma resta comunque vincolato all'allowlist */
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, JSON.stringify({token, at: Date.now()}));
    setSessionCookie(res, email, token);
    res.json({ok: true, token});
  });
});

/* POST /api/auth/verify — verifica che la sessione sia ancora valida (keep-alive) */
app.post('/api/auth/verify', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const token = String(b.token || '');
  if (!emailRe.test(email) || !token) return res.status(400).json({ok: false});
  const sess = readSess(sessFile(email));
  if (sess && sess.token === token && (Date.now() - sess.at) < SESSION_TTL) {
    fs.writeFileSync(sessFile(email), JSON.stringify({token, at: Date.now()}));
    setSessionCookie(res, email, token);   /* installa/aggiorna il cookie: upgrade trasparente */
    res.json({ok: true});
  } else {
    res.json({ok: false, reason: sess ? 'expired' : 'not_found'});
  }
});

/* POST /api/auth/logout */
app.post('/api/auth/logout', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const token = String(b.token || '');
  if (!emailRe.test(email)) return res.status(400).json({ok: false});
  const f = sessFile(email);
  const sess = readSess(f);
  if (sess && sess.token === token) { try { fs.unlinkSync(f); } catch(e) {} }
  clearSessionCookie(res);
  res.json({ok: true});
});

/* ── GATING: TUTTO ciò che sta in una sotto-cartella di /app è riservato ──
   Video, esercizi, audio, musica e qualunque contenuto futuro: servito SOLO con
   sessione valida. Così ogni nuova area creata sotto /app è protetta in automatico.
   Restano pubblici: la shell /app/ e i suoi asset di root (servono al login) e
   la pagina di installazione PWA /app/install/. */
function isReserved(p) {
  if (p.indexOf('/app/') !== 0) return false;
  if (p.indexOf('/app/install') === 0) return false;   /* installazione PWA: pubblica */
  return p.slice('/app/'.length).indexOf('/') >= 0;    /* /app/<cartella>/... = riservato */
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!isReserved(req.path)) return next();
  if (sessionFromReq(req)) return next();
  res.set('Cache-Control', 'no-store');
  const isDoc = req.path.charAt(req.path.length - 1) === '/' || /\.html?$/.test(req.path);
  if (isDoc) return res.redirect(302, '/app/');         /* pagina → al login */
  return res.status(403).end();                          /* media/asset riservato → negato */
});

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
