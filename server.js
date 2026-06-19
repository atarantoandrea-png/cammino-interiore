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
const ANALYTICS = path.join(DATA, 'analytics');
fs.mkdirSync(ANALYTICS, { recursive: true });
function readJsonFile(f){ try{ if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){} return null; }

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

/* ── TRACCIAMENTO uso (per la dashboard): aperture + tempo di permanenza per area ──
   Le pagine dell'app mandano un "battito" mentre sono aperte e attive. Aggrego per
   giorno/email/area in file giornalieri sotto /data/analytics. Richiede sessione valida
   (niente dati di estranei). I secondi di ogni battito sono limitati per evitare gonfiaggi. */
function isoOf(ts){ const d = new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
app.post('/api/track', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ ok:false });
  if (!storeAuthOk(req, email)) return res.status(401).json({ ok:false });
  const area = (String(b.area || 'app').toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,24)) || 'app';
  const ev = String(b.ev || 'beat');
  const sec = Math.max(0, Math.min(120, parseInt(b.sec, 10) || 0));   /* cap a 120s per battito */
  const now = Date.now();
  /* data/ora locali del client (Italia) se valide, altrimenti ora server */
  const lday = /^\d{4}-\d{2}-\d{2}$/.test(String(b.lday || '')) ? b.lday : isoOf(now);
  let lhour = parseInt(b.lhour, 10); if (!(lhour >= 0 && lhour <= 23)) lhour = new Date(now).getHours();
  try {
    const f = path.join(ANALYTICS, lday + '.json');
    const cur = readJsonFile(f) || { users:{} };
    if (!cur.users) cur.users = {};
    const u = cur.users[email] || (cur.users[email] = { sec:0, opens:0, areas:{}, hours:{}, first:now, last:now });
    if (ev === 'open') u.opens = (u.opens || 0) + 1;
    if (sec) {
      u.sec = (u.sec || 0) + sec;
      u.areas[area] = (u.areas[area] || 0) + sec;
      u.hours[String(lhour)] = (u.hours[String(lhour)] || 0) + sec;
    }
    u.last = now; if (!u.first) u.first = now;
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cur));
    fs.renameSync(tmp, f);
    res.json({ ok:true });
  } catch(e) { console.error('track:', e); res.status(500).json({ ok:false }); }
});

/* ── AUTH: verifica email su Google Sheet + sessione singola ── */

const SHEETS_ID  = process.env.SHEETS_ID  || '';
const SHEETS_TAB = process.env.SHEETS_TAB || 'annuali';
const SHEETS_TAB2 = process.env.SHEETS_TAB2 || 'Cammino Interiore Speciali';
const SHEETS_TAB3 = process.env.SHEETS_TAB3 || 'Mensili';
/* schede ad accesso PIENO (annuale + speciali) e schede MENSILI (accesso "trailer":
   solo prima parte + anteprima del resto). Override: SHEETS_TABS="A,B" per i pieni,
   SHEETS_TABS_MONTHLY="C" per i mensili. L'allowlist resta l'unione di tutte. */
const FULL_TABS = (process.env.SHEETS_TABS ? process.env.SHEETS_TABS.split(',') : [SHEETS_TAB, SHEETS_TAB2])
  .map(s => s.trim()).filter(Boolean);
const MONTHLY_TABS = (process.env.SHEETS_TABS_MONTHLY ? process.env.SHEETS_TABS_MONTHLY.split(',') : [SHEETS_TAB3])
  .map(s => s.trim()).filter(Boolean);
/* GERARCHIA ACCESSI: rank più alto = più accesso. Sui doppioni (stessa mail in più
   schede) vince SEMPRE il rank più alto, indipendentemente dall'ordine di lettura.
   Per un livello FUTURO (es. il "trailer" dell'app) basta aggiungere qui una riga con
   un rank più basso e le sue schede — la regola del "vince il più alto" vale da sola. */
const TIER_GROUPS = [
  { tier: 'full',    rank: 30, tabs: FULL_TABS },     /* annuali + Cammino Interiore Speciali: accesso completo */
  { tier: 'monthly', rank: 20, tabs: MONTHLY_TABS },  /* Mensili: anteprima/trailer fino al Giornaliero */
];
const TIER_RANK = TIER_GROUPS.reduce((m, g) => { m[g.tier] = g.rank; return m; }, {});
const SHEETS_TABS = TIER_GROUPS.reduce((a, g) => a.concat(g.tabs), []);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; /* 30 giorni */
const EMAIL_CACHE_TTL = 5 * 60 * 1000;  /* 5 min */

/* ── PANNELLO ADMIN: solo per Andrea. La password (ADMIN_KEY) NON sta nel codice
   (il repo è pubblico): si imposta come variabile d'ambiente su Coolify. L'email admin
   non è segreta, quindi ha un default. Accesso = email admin + password. ── */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'ataranto.andrea@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
/* password admin: dalla env ADMIN_KEY, oppure (fallback) dal file /data/admin.key
   nel volume persistente — così non sta MAI nel repo pubblico. Letta dinamicamente
   (cache 60s) per non richiedere riavvii quando la si imposta/cambia. */
const ADMIN_KEY_FILE = path.join(DATA, 'admin.key');
let _akCache = null, _akAt = 0;
function adminKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  if (_akCache !== null && Date.now() - _akAt < 60000) return _akCache;
  try { _akCache = fs.readFileSync(ADMIN_KEY_FILE, 'utf8').trim(); } catch(e) { _akCache = ''; }
  _akAt = Date.now();
  return _akCache;
}

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

/* cache: mappa email -> livello (es. 'full' | 'monthly'). Sui DOPPIONI (stessa mail in
   più schede/livelli) vince SEMPRE il livello con più accesso (rank più alto), qualunque
   sia l'ordine di lettura dei fogli — regola valida anche per i livelli futuri.
   L'allowlist è l'insieme delle chiavi. I nomi dei fogli sono risolti ai titoli reali. */
let tierCache = null, tierCacheAt = 0;
function getTierMap(cb) {
  if (tierCache && Date.now() - tierCacheAt < EMAIL_CACHE_TTL) return cb(null, tierCache);
  getGToken((err, token) => {
    if (err) return cb(err);
    fetchSheetTitles(token, titles => {
      const norm = s => String(s).trim().toLowerCase();
      const resolve = want => { const hit = titles.find(t => norm(t) === norm(want)); return hit || want; };
      const jobs = [];
      TIER_GROUPS.forEach(g => [...new Set(g.tabs.map(resolve))].forEach(tab => jobs.push({tab, tier: g.tier})));
      let pending = jobs.length; const map = new Map();
      if (!pending) { tierCache = map; tierCacheAt = Date.now(); return cb(null, map); }
      jobs.forEach(job => fetchTabRows(token, job.tab, emails => {
        const r = TIER_RANK[job.tier] || 0;
        emails.forEach(e => { const cur = map.get(e); if (!cur || r > (TIER_RANK[cur] || 0)) map.set(e, job.tier); });
        if (--pending === 0) { tierCache = map; tierCacheAt = Date.now(); cb(null, map); }
      }));
    });
  });
}
/* allowlist (compat): l'insieme delle email autorizzate, di qualunque livello */
function getAllowedEmails(cb) {
  getTierMap((err, map) => err ? cb(err) : cb(null, new Set(map.keys())));
}
/* livello dell'utente della richiesta (dal cookie di sessione): 'full' | 'monthly' | null */
function tierForReq(req, cb) {
  const s = sessionFromReq(req);
  if (!s) return cb(null, null);
  getTierMap((err, map) => cb(err, err ? null : (map.get(s.email) || 'full')));
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

/* ── sessione ADMIN (pannello): cookie firmato HMAC con ADMIN_KEY → non falsificabile ── */
const ADMIN_COOKIE = 'ovl_admin';
function safeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function adminToken(email) {
  return crypto.createHmac('sha256', adminKey()).update('admin:' + email).digest('hex');
}
function adminFromReq(req) {
  if (!adminKey()) return null;
  const raw = parseCookies(req)[ADMIN_COOKIE];
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  let email;
  try { email = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8'); } catch(e) { return null; }
  if (ADMIN_EMAILS.indexOf(email) < 0) return null;
  return safeEq(raw.slice(dot + 1), adminToken(email)) ? { email } : null;
}

/* GET /api/auth/check?email=X — email autorizzata nel foglio? */
app.get('/api/auth/check', (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ok: false, reason: 'email'});
  if (!SHEETS_ID) return res.status(500).json({ok: false, reason: 'config'});
  getTierMap((err, map) => {
    if (err) { console.error('sheets:', err); return res.status(500).json({ok: false, reason: 'sheets'}); }
    res.json({ok: map.has(email), tier: map.get(email) || null});
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
  getTierMap((err, map) => {
    if (err) { console.error('sheets:', err); return res.status(500).json({ok: false, reason: 'sheets'}); }
    if (!map.has(email)) return res.status(403).json({ok: false, reason: 'unauthorized'});
    const tier = map.get(email) || 'full';
    const f = sessFile(email);
    const sess = readSess(f);
    if (sess && sess.token && (Date.now() - sess.at) < SESSION_TTL) {
      if (existingToken && existingToken === sess.token) {
        /* stesso dispositivo: rinnova timestamp */
        fs.writeFileSync(f, JSON.stringify({token: sess.token, at: Date.now()}));
        setSessionCookie(res, email, sess.token);
        return res.json({ok: true, token: sess.token, tier});
      }
      if (!force) return res.json({ok: false, reason: 'active'});
      /* force=true: scaccia l'altra sessione, ma resta comunque vincolato all'allowlist */
    }
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, JSON.stringify({token, at: Date.now()}));
    setSessionCookie(res, email, token);
    res.json({ok: true, token, tier});
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
    /* restituisco anche il livello aggiornato (best-effort: se i fogli non rispondono, ometto) */
    getTierMap((err, map) => {
      res.json(err ? {ok: true} : {ok: true, tier: map.get(email) || 'full'});
    });
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

/* ── COPERTINE per l'anteprima dei Mensili ──
   Il server conosce gli ID video, il client "mensile" no. Questo endpoint recupera la
   miniatura da Vimeo (con il Referer del dominio, perché i video sono privati) e
   reindirizza all'immagine: così l'anteprima si vede SENZA esporre l'ID del video. */
const COVER_IDS = {
  capitolo2: {mondo:'1200559554',bambino:'1200559555',adulto:'1200563875',ombra:'1200561278',padremadre:'1200563735',mf:'1200561010',adolescente:'1200559557',osservatore:'1200559556'},
  bambino:   {teoria:'1200559555',foglio:'1201477236',medit:'1201478348'}
};
const coverCache = {};
app.get('/api/cover', (req, res) => {
  if (!sessionFromReq(req)) return res.status(403).end();
  const id = (COVER_IDS[String(req.query.s || '')] || {})[String(req.query.k || '')];
  if (!id) return res.status(404).end();
  const c = coverCache[id];
  if (c && Date.now() - c.at < 6 * 3600 * 1000) { res.set('Cache-Control', 'private, max-age=21600'); return res.redirect(302, c.url); }
  const opts = { hostname: 'vimeo.com', path: '/api/oembed.json?width=800&url=' + encodeURIComponent('https://vimeo.com/' + id),
    headers: { 'Referer': 'https://oltreilvelo.elisasoulmedium.com', 'User-Agent': 'OltreIlVelo/1.0' } };
  https.get(opts, r => {
    let d = ''; r.on('data', x => d += x);
    r.on('end', () => {
      try { const j = JSON.parse(d); if (j && j.thumbnail_url) { coverCache[id] = {url: j.thumbnail_url, at: Date.now()}; res.set('Cache-Control', 'private, max-age=21600'); return res.redirect(302, j.thumbnail_url); } } catch(e) {}
      res.status(404).end();
    });
  }).on('error', () => res.status(404).end());
});

/* ════════════════ PANNELLO ADMIN ════════════════ */

/* login: email admin + password (ADMIN_KEY). Setta un cookie firmato. */
app.post('/api/admin/login', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const key = String(b.key || '');
  const AK = adminKey();
  if (!AK) return res.status(500).json({ ok:false, reason:'config' });   /* password non ancora impostata */
  if (ADMIN_EMAILS.indexOf(email) < 0 || !safeEq(key, AK))
    return res.status(403).json({ ok:false, reason:'denied' });
  const val = Buffer.from(email).toString('base64url') + '.' + adminToken(email);
  res.append('Set-Cookie', ADMIN_COOKIE + '=' + val + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (30*24*3600));
  res.json({ ok:true });
});
app.post('/api/admin/logout', (req, res) => {
  res.append('Set-Cookie', ADMIN_COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.json({ ok:true });
});
app.get('/api/admin/me', (req, res) => {
  const a = adminFromReq(req);
  res.json({ ok: !!a, email: a ? a.email : null, configured: !!adminKey() });
});

/* aggregazione completa per la dashboard (cache 60s, è pesante: legge i file di tutti) */
let ovCache = null, ovCacheAt = 0;
function isoNDaysAgo(n){ return isoOf(Date.now() - n*86400000); }
function maxIso(set){ let m = ''; set.forEach(d => { if (d > m) m = d; }); return m || null; }
function computeOverview(cb){
  if (ovCache && Date.now() - ovCacheAt < 60000) return cb(null, ovCache);
  getTierMap((err, map) => {
    if (err) return cb(err);
    const subs = [...map.entries()].map(([email, tier]) => ({ email, tier }));
    const today = isoOf(Date.now()), d7 = isoNDaysAgo(7), d30 = isoNDaysAgo(30);

    /* 1) leggo i file giornalieri di analytics */
    let files = [];
    try { files = fs.readdirSync(ANALYTICS).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)); } catch(e) {}
    files.sort();
    const byUser = {};          /* email -> {dates:Set, sec30, secAll, opens30} */
    const dateSec = {}, dateOpens = {}, hours = {}, areasGlobal = {};
    files.forEach(f => {
      const date = f.slice(0, 10);
      const j = readJsonFile(path.join(ANALYTICS, f));
      if (!j || !j.users) return;
      for (const email in j.users) {
        const u = j.users[email];
        const au = byUser[email] || (byUser[email] = { dates:new Set(), sec30:0, secAll:0, opens30:0 });
        au.dates.add(date); au.secAll += u.sec || 0;
        if (date >= d30) {
          au.sec30 += u.sec || 0; au.opens30 += u.opens || 0;
          dateSec[date] = (dateSec[date] || 0) + (u.sec || 0);
          dateOpens[date] = (dateOpens[date] || 0) + (u.opens || 0);
          for (const h in (u.hours || {})) hours[h] = (hours[h] || 0) + u.hours[h];
          for (const a in (u.areas || {})) areasGlobal[a] = (areasGlobal[a] || 0) + u.areas[a];
        }
      }
    });

    /* 2) un giro su ogni iscritto: progressi (storico) + sessione + analytics */
    const users = [];
    let activated = 0, totalMin30 = 0, totalMinAll = 0, totalOpens30 = 0;
    const seriesUsers = {};   /* date -> Set(email) */
    subs.forEach(s => {
      const email = s.email, tier = s.tier;
      const g = readStore(fileFor(email));
      const gdays = new Set();
      for (const k in g.data) { const m = /^s[12]:(\d{4}-\d{2}-\d{2})\b/.exec(k); if (m) gdays.add(m[1]); }
      const c2 = readStore(fileFor(email, 'cap2'));
      const cap2n = Object.keys(c2.data).filter(k => c2.data[k]).length;
      const bp = readStore(fileFor(email, 'bprog'));
      const bambino = Object.keys(bp.data).length > 0;
      const sess = readSess(sessFile(email));
      const lastLogin = (sess && sess.at) || 0;
      const au = byUser[email];

      /* insieme dei giorni attivi: pratica (storico) ∪ analytics ∪ giorno dell'ultimo login */
      const active = new Set(gdays);
      if (au) au.dates.forEach(d => active.add(d));
      if (lastLogin) active.add(isoOf(lastLogin));

      let lastActive = lastLogin;
      active.forEach(d => { const t = Date.parse(d + 'T12:00:00'); if (t > lastActive) lastActive = t; });

      const min30 = Math.round(((au && au.sec30) || 0) / 60);
      const minAll = Math.round(((au && au.secAll) || 0) / 60);
      const opens30 = (au && au.opens30) || 0;
      totalMin30 += min30; totalMinAll += minAll; totalOpens30 += opens30;

      let days30 = 0, dau = false, wau = false, mau = false;
      active.forEach(d => {
        if (d === today) dau = true;
        if (d >= d7) wau = true;
        if (d >= d30) { mau = true; days30++; (seriesUsers[d] || (seriesUsers[d] = new Set())).add(email); }
      });

      const hasAny = active.size > 0 || cap2n > 0 || bambino;
      if (hasAny) activated++;

      users.push({
        email, tier,
        lastActive: lastActive || null,
        giorniPratica: gdays.size,
        ultimaPratica: maxIso(gdays),
        days30, min30, minAll, opens30,
        cap2: cap2n, bambino,
        dau, wau, mau, attivato: hasAny
      });
    });

    /* 3) serie giornaliera ultimi 30 giorni */
    const dailySeries = [];
    for (let i = 29; i >= 0; i--) {
      const date = isoOf(Date.now() - i*86400000);
      dailySeries.push({
        date,
        users: (seriesUsers[date] ? seriesUsers[date].size : 0),
        min: Math.round((dateSec[date] || 0) / 60),
        opens: dateOpens[date] || 0
      });
    }

    /* 4) frequenza (sui 30 giorni): fedeli ≥12 gg, costanti 4-11, occasionali 1-3 */
    let fedeli = 0, costanti = 0, occasionali = 0;
    users.forEach(u => { if (u.days30 >= 12) fedeli++; else if (u.days30 >= 4) costanti++; else if (u.days30 >= 1) occasionali++; });

    /* 5) dormienti: attivati che non entrano da >14 giorni */
    const limite = Date.now() - 14*86400000;
    const dormienti = users.filter(u => u.attivato && u.lastActive && u.lastActive < limite)
      .sort((a, b) => a.lastActive - b.lastActive)
      .slice(0, 60)
      .map(u => ({ email:u.email, tier:u.tier, lastActive:u.lastActive, giorniPratica:u.giorniPratica }));

    /* 6) confronto livelli */
    const tierAgg = { full:{ tot:0, attivi30:0, min30:0 }, monthly:{ tot:0, attivi30:0, min30:0 } };
    users.forEach(u => { const t = tierAgg[u.tier] || tierAgg.full; t.tot++; if (u.mau) t.attivi30++; t.min30 += u.min30; });

    const topAreas = Object.keys(areasGlobal)
      .map(a => ({ area:a, min: Math.round(areasGlobal[a] / 60) }))
      .sort((a, b) => b.min - a.min);

    const out = {
      generatedAt: Date.now(),
      subscribers: {
        total: subs.length,
        full: subs.filter(s => s.tier === 'full').length,
        monthly: subs.filter(s => s.tier === 'monthly').length
      },
      activated,
      active: {
        today: users.filter(u => u.dau).length,
        d7: users.filter(u => u.wau).length,
        d30: users.filter(u => u.mau).length
      },
      time: {
        avgSessionMin: totalOpens30 ? Math.round((totalMin30 / totalOpens30) * 10) / 10 : 0,
        totalMin30, totalMinAll, opens30: totalOpens30
      },
      frequency: { fedeli, costanti, occasionali },
      hours, topAreas, dailySeries, dormienti,
      byTier: tierAgg,
      users: users.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))
    };
    ovCache = out; ovCacheAt = Date.now();
    cb(null, out);
  });
}
app.get('/api/admin/overview', (req, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok:false });
  if (String(req.query.fresh || '') === '1') { ovCache = null; }
  computeOverview((err, data) => {
    if (err) { console.error('overview:', err); return res.status(500).json({ ok:false, reason:'sheets' }); }
    res.json({ ok:true, data });
  });
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

/* ── ACCESSO MENSILE ("trailer"): per le sezioni oltre il Giornaliero (Mondo Interiore,
   Bambino) il server serve una versione DEPURATA dell'HTML: rimuove i blocchi
   <!--FULL-->…<!--/FULL--> (ID video, testi degli esercizi) e ATTIVA i blocchi
   <!--MONTHLY …MONTHLY--> (copertine bloccate + invito a passare all'annuale).
   Così i contenuti pieni non vengono proprio inviati a chi è "mensile". */
const monthlyHtmlCache = {};
function monthlyHtml(file) {
  let st; try { st = fs.statSync(file); } catch(e) { return null; }
  const key = file + ':' + st.mtimeMs;
  if (monthlyHtmlCache[key]) return monthlyHtmlCache[key];
  let html; try { html = fs.readFileSync(file, 'utf8'); } catch(e) { return null; }
  html = html.replace(/<!--FULL-->[\s\S]*?<!--\/FULL-->/g, '')
             .replace(/<!--MONTHLY\b/g, '').replace(/MONTHLY-->/g, '');
  monthlyHtmlCache[key] = html;
  return html;
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = req.path.match(/^\/app\/(capitolo2|bambino)\/(?:index\.html)?$/);
  if (!m) return next();
  tierForReq(req, (err, tier) => {
    if (err || tier !== 'monthly') return next();   /* pieni (o fogli giù) → versione completa */
    const html = monthlyHtml(path.join(__dirname, 'app', m[1], 'index.html'));
    if (html == null) return next();
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  });
});

/* le pagine del sito: html mai in cache (i deploy si vedono subito),
   immagini e texture in cache 30 giorni (visite successive istantanee) */
app.use(express.static(__dirname, {
  maxAge: '30d',
  setHeaders(res, p){
    /* html e service worker sempre rivalidati: i deploy si vedono subito */
    if (p.endsWith('.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control','no-cache');
  }
}));

const port = process.env.PORT || 3000;
app.listen(port, ()=>console.log('Oltre il Velo in ascolto su ' + port));
