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
  /* la PROVA non salva progressi: vede tutto ma non scrive */
  const _s = sessionFromReq(req);
  if (_s) { const _x = readSess(sessFile(_s.email)); if (_x && _x.tier === 'trial') return res.status(403).json({ error:'trial' }); }
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

/* ── SUGGERIMENTI (anonimi) ──
   Le persone, dall'app, ci lasciano un pensiero scegliendo un tema. Richiede una
   sessione valida (solo iscritti, niente spam pubblico) MA non salva l'email: i
   suggerimenti restano anonimi anche per l'admin. Archivio: /data/suggestions.json */
const SUGG_FILE = path.join(DATA, 'suggestions.json');
const SUGG_THEMES = ['tecnico', 'esercizi', 'video', 'musica', 'idee', 'generale'];
function readSuggest(){ const j = readJsonFile(SUGG_FILE); return (j && Array.isArray(j.items)) ? j : { items:[] }; }
function writeSuggest(obj){ const tmp = SUGG_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, SUGG_FILE); }

app.post('/api/suggest', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!emailRe.test(email)) return res.status(400).json({ ok:false });
  if (!storeAuthOk(req, email)) return res.status(401).json({ ok:false });   /* deve essere iscritto… */
  const theme = SUGG_THEMES.indexOf(String(b.theme || '')) >= 0 ? String(b.theme) : null;
  const text = String(b.text || '').trim().slice(0, 4000);
  if (!theme) return res.status(400).json({ ok:false, reason:'theme' });
  if (text.length < 2) return res.status(400).json({ ok:false, reason:'empty' });
  try {
    const store = readSuggest();
    /* …ma NON salviamo chi è: solo tema, testo, data → resta anonimo */
    store.items.push({ id: crypto.randomBytes(6).toString('hex'), theme, text, ts: Date.now() });
    if (store.items.length > 5000) store.items = store.items.slice(-5000);
    writeSuggest(store);
    res.json({ ok:true });
  } catch(e) { console.error('suggest:', e); res.status(500).json({ ok:false }); }
});

/* admin: elenco suggerimenti (anonimi) + conteggi per tema */
app.get('/api/admin/suggestions', (req, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok:false });
  const store = readSuggest();
  const counts = {}; SUGG_THEMES.forEach(t => counts[t] = 0);
  store.items.forEach(it => { if (counts[it.theme] != null) counts[it.theme]++; });
  const items = store.items.slice().sort((a, b) => b.ts - a.ts);
  res.json({ ok:true, items, counts, total: items.length });
});
/* admin: elimina un suggerimento (gestione spam) */
app.post('/api/admin/suggestions/delete', (req, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok:false });
  const id = String((req.body || {}).id || '');
  try {
    const store = readSuggest();
    const before = store.items.length;
    store.items = store.items.filter(it => it.id !== id);
    if (store.items.length !== before) writeSuggest(store);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ ok:false }); }
});

/* ── CHAT CON LA LUCE (log domande/risposte) ──
   Ogni risposta della chat "Scrivi a Elisa" viene registrata: il client manda solo
   {q,a,mode,vid,label,tema}; l'email e il LIVELLO li ricava il SERVER dalla sessione
   (non falsificabili). Serve al pannello per la lista e per la classifica degli interessi
   distinta per livello. Archivio: /data/chatlog.json (fuori dal repo pubblico). */
const CHATLOG_FILE = path.join(DATA, 'chatlog.json');
function readChatLog(){ const j = readJsonFile(CHATLOG_FILE); return (j && Array.isArray(j.items)) ? j : { items:[] }; }
function writeChatLog(obj){ const tmp = CHATLOG_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, CHATLOG_FILE); }

app.post('/api/chat-log', (req, res) => {
  const b = req.body || {};
  const q = String(b.q || '').trim().slice(0, 600);
  const s = sessionFromReq(req);
  if (!q || !s) return res.json({ ok:true });   /* solo sessioni valide, niente log pubblico */
  const a = String(b.a || '').trim().slice(0, 2000);
  const mode = String(b.mode || '').slice(0, 20);
  const vid = String(b.vid || '').slice(0, 60);
  const label = String(b.label || '').slice(0, 140);
  const tema = String(b.tema || '').slice(0, 140);
  tierForReq(req, (err, tier) => {
    try {
      const store = readChatLog();
      store.items.push({ id: crypto.randomBytes(6).toString('hex'), ts: Date.now(),
        email: s.email, tier: tier || '', q, a, mode, vid, label, tema });
      if (store.items.length > 20000) store.items = store.items.slice(-20000);
      writeChatLog(store);
    } catch(e) { console.error('chat-log:', e); }
    res.json({ ok:true });
  });
});

/* admin: chat con la Luce — lista recente + classifica dei temi per livello (finestra 7/30/tutto) */
app.get('/api/admin/chats', (req, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok:false });
  const win = String((req.query && req.query.win) || '30');
  const now = Date.now();
  const from = win === 'all' ? 0 : (win === '7' ? now - 7*864e5 : now - 30*864e5);
  const store = readChatLog();
  const all = store.items || [];
  const rank = {};
  const totals = { full:0, monthly:0, trial:0, tot:0 };
  all.forEach(it => {
    if (it.ts < from) return;
    const key = it.label || it.tema || 'Domande a mano libera';
    const r = rank[key] || (rank[key] = { label:key, full:0, monthly:0, trial:0, tot:0 });
    const t = (it.tier === 'full' || it.tier === 'monthly' || it.tier === 'trial') ? it.tier : null;
    if (t) { r[t]++; totals[t]++; }
    r.tot++; totals.tot++;
  });
  const rankArr = Object.keys(rank).map(k => rank[k]).sort((a, b) => b.tot - a.tot).slice(0, 14);
  const items = all.slice().sort((a, b) => b.ts - a.ts).slice(0, 400);
  /* domande SENZA risposta = la chat non ha trovato una voce ('empty' = nessuna risposta,
     'suggest' = ha solo proposto temi affini). Sono il backlog per arricchire la conoscenza. */
  const isUnanswered = it => it.mode === 'empty' || it.mode === 'suggest';
  const unansweredAll = all.filter(isUnanswered);
  const unanswered = unansweredAll.slice().sort((a, b) => b.ts - a.ts).slice(0, 300);
  res.json({ ok:true, items, rank: rankArr, totals, total: all.length,
    unanswered, unansweredCount: unansweredAll.length, win });
});

/* ════════════════ PROVA / TRIAL (lead-gen, area separata e blindata) ════════════════
   La pagina /prova (sul NOSTRO dominio) raccoglie nome/email/telefono e crea il contatto
   su systeme.io con il tag "App - Prova". La sessione trial usa un cookie SEPARATO
   (ovl_trial), firmato, che NON ha alcun potere su /app: l'app pagante resta blindata. */
const SYSTEME_KEY_FILE = path.join(DATA, 'systeme.key');
let _skCache = null, _skAt = 0;
function systemeKey(){
  if (process.env.SYSTEME_KEY) return process.env.SYSTEME_KEY;
  if (_skCache !== null && Date.now() - _skAt < 60000) return _skCache;
  try { _skCache = fs.readFileSync(SYSTEME_KEY_FILE, 'utf8').trim(); } catch(e) { _skCache = ''; }
  _skAt = Date.now();
  return _skCache;
}
const SYSTEME_TRIAL_TAG_ID = parseInt(process.env.SYSTEME_TRIAL_TAG_ID || '2060361', 10);

/* chiamata all'API systeme.io (https, header X-API-Key) */
function systemeApi(method, apiPath, body, cb){
  const key = systemeKey();
  if (!key) return cb('no-key');
  const data = body ? JSON.stringify(body) : null;
  const opts = { hostname:'api.systeme.io', path:apiPath, method:method,
    headers:{ 'X-API-Key':key, 'Accept':'application/json' } };
  if (data){ opts.headers['Content-Type']='application/json'; opts.headers['Content-Length']=Buffer.byteLength(data); }
  const r = https.request(opts, resp => {
    let d=''; resp.on('data', c=>d+=c);
    resp.on('end', ()=>{ let j=null; try{ j = d ? JSON.parse(d) : null; }catch(e){} cb(null, { status:resp.statusCode, json:j }); });
  });
  r.on('error', e=>cb(e));
  if (data) r.write(data);
  r.end();
}

/* cookie sessione trial (HMAC con un segreto persistente in /data) — niente potere su /app */
const TRIAL_COOKIE = 'ovl_trial';
const TRIAL_SECRET_FILE = path.join(DATA, 'trial.secret');
let _trialSecret = null;
function trialSecret(){
  if (_trialSecret) return _trialSecret;
  try { _trialSecret = fs.readFileSync(TRIAL_SECRET_FILE,'utf8').trim(); } catch(e) {}
  if (!_trialSecret){ _trialSecret = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(TRIAL_SECRET_FILE, _trialSecret); } catch(e){} }
  return _trialSecret;
}
function trialToken(id){ return crypto.createHmac('sha256', trialSecret()).update('trial:'+id).digest('hex'); }
function setTrialCookie(res, id){
  const val = Buffer.from(id).toString('base64url') + '.' + trialToken(id);
  res.append('Set-Cookie', TRIAL_COOKIE + '=' + val + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (180*24*3600));
}
function trialFromReq(req){
  const raw = parseCookies(req)[TRIAL_COOKIE];
  if (!raw) return null;
  const dot = raw.indexOf('.'); if (dot < 0) return null;
  let id; try { id = Buffer.from(raw.slice(0,dot),'base64url').toString('utf8'); } catch(e){ return null; }
  if (!id) return null;
  return safeEq(raw.slice(dot+1), trialToken(id)) ? { id } : null;
}

const TRIAL_LEADS = path.join(DATA, 'trial-leads.json');
function readLeads(){ const j = readJsonFile(TRIAL_LEADS); return (j && Array.isArray(j.items)) ? j : { items:[] }; }
function writeLeads(obj){ const tmp = TRIAL_LEADS+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, TRIAL_LEADS); }
function markLeadCrm(id){ try { const s = readLeads(); const it = s.items.find(x=>x.id===id); if (it && !it.crm){ it.crm = true; writeLeads(s); } } catch(e){} }
/* email già iscritta alla prova? (per farla RIENTRARE dal login dell'app, anche da un altro device) */
function isTrialLead(email){ try { return readLeads().items.some(x => x.email === email); } catch(e){ return false; } }

/* POST /api/trial/register — iscrizione alla prova (nome/email/telefono) → CRM + tag */
app.post('/api/trial/register', (req, res) => {
  const b = req.body || {};
  const name = String(b.name||'').trim().replace(/\s+/g,' ').slice(0,80);
  const email = String(b.email||'').trim().toLowerCase();
  const phone = String(b.phone||'').trim().slice(0,30);
  if (!name || !emailRe.test(email) || phone.replace(/\D/g,'').length < 6) return res.status(400).json({ ok:false, reason:'fields' });
  if (!b.consent) return res.status(400).json({ ok:false, reason:'consent' });

  const id = crypto.randomBytes(9).toString('hex');
  /* salvo subito il lead in locale: non si perde anche se il CRM è lento o giù */
  try { const s = readLeads(); s.items.push({ id, name, email, phone, ts:Date.now(), crm:false }); if (s.items.length>20000) s.items=s.items.slice(-20000); writeLeads(s); } catch(e){}

  /* sessione APP con livello "prova": l'utente entra nell'app VERA, ma fail-closed (vede solo
     Introduzione, metà Frequenza, musiche e Luce; tutto il resto è bloccato lato server).
     Se l'email è GIÀ di un pagante (nel foglio), NON la declasso: mantiene il suo livello reale. */
  getTierMap((err, map) => {
    const sheetTier = (!err && map && map.get(email)) || null;   /* full | monthly | null */
    const token = crypto.randomBytes(32).toString('hex');
    const sess = { token, at: Date.now() };
    const tier = sheetTier || 'trial';
    if (!sheetTier) sess.tier = 'trial';                         /* marcatore di sessione-prova */
    else sess.lastTier = sheetTier;                               /* livello confermato dal foglio */
    try { writeSess(email, sess); } catch(e){}
    setSessionCookie(res, email, token);   /* cookie ovl_sess: entra nell'app */
    setTrialCookie(res, id);               /* cookie ovl_trial: per la chat 3/giorno */
    res.json({ ok:true, email, token, tier });   /* il front di /prova li salva in localStorage per entrare in /app */
  });

  /* CRM in background: crea il contatto (o lo trova se già esiste) e assegna il tag */
  const parts = name.split(' '); const first = parts.shift() || name; const surname = parts.join(' ');
  const fields = [{ slug:'first_name', value:first }];
  if (surname) fields.push({ slug:'surname', value:surname });
  if (phone) fields.push({ slug:'phone_number', value:phone });
  function assignTag(contactId, tryN){ if (!contactId) return;
    systemeApi('POST', '/api/contacts/'+contactId+'/tags', { tagId:SYSTEME_TRIAL_TAG_ID }, (err, r) => {
      if (!err && r && r.status >= 200 && r.status < 300) { markLeadCrm(id); }   /* crm=true SOLO se il tag è andato */
      else if ((tryN||0) < 1) { setTimeout(()=>assignTag(contactId, (tryN||0)+1), 800); }   /* un retry su errore transitorio */
      else console.error('trial CRM: TAG non assegnato a', contactId, 'status', r && r.status, JSON.stringify(r && r.json));
    });
  }
  systemeApi('POST', '/api/contacts', { email, locale:'it', fields }, (err, r) => {
    if (!err && r && (r.status===201||r.status===200) && r.json && r.json.id) return assignTag(r.json.id);
    if (r && r.status === 422) console.error('trial CRM: email RIFIUTATA da systeme (non valida/non recapitabile):', email, r.json && r.json.detail);
    /* esiste già o create non riuscito: lo cerco per email e gli metto comunque il tag */
    systemeApi('GET', '/api/contacts?email='+encodeURIComponent(email), null, (e2, r2) => {
      const body = r2 && r2.json; const arr = body && (body.items || (Array.isArray(body) ? body : null));
      const c = arr && arr[0];
      if (c && c.id) assignTag(c.id);
      else console.error('trial CRM: contatto non creato/trovato per', email, 'create status', r && r.status);
    });
  });
});

/* sessione trial valida? (per saltare il form a chi è già iscritto) */
app.get('/api/trial/me', (req, res) => { res.json({ ok: !!trialFromReq(req) }); });

/* gate della chat con la Luce: max 3 domande al giorno per ogni iscritto alla prova.
   Conteggio LATO SERVER per id-trial + giorno → non aggirabile svuotando il browser. */
const TRIAL_CHAT_MAX = parseInt(process.env.TRIAL_CHAT_MAX || '3', 10);
const TRIAL_CHAT_DIR = path.join(DATA, 'trial-chat');
try { fs.mkdirSync(TRIAL_CHAT_DIR, { recursive: true }); } catch(e) {}
app.post('/api/trial/chat-allow', (req, res) => {
  /* identifica l'utente prova: sessione app con tier 'trial' (entrato da /app o /prova)
     oppure cookie ovl_trial (registrazione). Conteggio per identificatore + giorno. */
  let key = null;
  const s = sessionFromReq(req);
  if (s) { const x = readSess(sessFile(s.email)); if (x && x.tier === 'trial') key = 'e:' + crypto.createHash('sha1').update('chat:' + s.email).digest('hex'); }
  if (!key) { const t = trialFromReq(req); if (t) key = 't:' + t.id; }
  if (!key) return res.status(401).json({ ok:false });
  const lday = /^\d{4}-\d{2}-\d{2}$/.test(String((req.body||{}).lday||'')) ? req.body.lday : isoOf(Date.now());
  try {
    const f = path.join(TRIAL_CHAT_DIR, lday + '.json');
    const cur = readJsonFile(f) || { ids:{} };
    if (!cur.ids) cur.ids = {};
    const used = cur.ids[key] || 0;
    if (used >= TRIAL_CHAT_MAX) return res.json({ ok:true, allowed:false, used, max:TRIAL_CHAT_MAX });
    cur.ids[key] = used + 1;
    const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(cur)); fs.renameSync(tmp, f);
    res.json({ ok:true, allowed:true, used: used + 1, max: TRIAL_CHAT_MAX });
  } catch(e) { res.status(500).json({ ok:false }); }
});

/* admin: riepilogo iscritti alla prova (per il pannello) */
app.get('/api/admin/trial', (req, res) => {
  if (!adminFromReq(req)) return res.status(403).json({ ok:false });
  const s = readLeads();
  const items = s.items.slice().sort((a,b)=>b.ts-a.ts);
  res.json({ ok:true, total: items.length, withCrm: items.filter(x=>x.crm).length, items: items.slice(0,200) });
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
/* LA PROVA DI 15 GIORNI DELLA COMMUNITY (Andrea, 28/9/26). Chi fa un consulto entra nella
   community per quindici giorni: in quei giorni il Cammino gli si apre come a un MENSILE
   (prima parte + anteprima del resto). Quando la riga sparisce dal foglio — o quando sono
   passati i quindici giorni — torna fuori da solo. Se poi si abbonerà davvero, avrà il
   livello del suo abbonamento. */
const SCHEDA_PROVA = 'Community Temporanea';
const GIORNI_PROVA = 15;
const comeScheda = s => String(s == null ? '' : s).trim().toLowerCase();
if (!MONTHLY_TABS.some(t => comeScheda(t) === comeScheda(SCHEDA_PROVA))) MONTHLY_TABS.push(SCHEDA_PROVA);
/* la data della riga: se non si legge, la riga vale (decide Zapier togliendola dal foglio) */
function quandoDi(valore) {
  const s = String(valore == null ? '' : valore).trim();
  if (!s) return NaN;
  let t = Date.parse(s.replace(' ', 'T'));
  if (isNaN(t)) {
    const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);   /* 25/09/2026 */
    if (m) t = Date.parse(m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2));
  }
  return t;
}
function provaScaduta(valore) {
  const t = quandoDi(valore);
  return isNaN(t) ? false : Date.now() - t > GIORNI_PROVA * 24 * 60 * 60 * 1000;
}

const TIER_GROUPS = [
  { tier: 'full',    rank: 30, tabs: FULL_TABS },     /* annuali + Cammino Interiore Speciali: accesso completo */
  { tier: 'monthly', rank: 20, tabs: MONTHLY_TABS },  /* Mensili: anteprima/trailer fino al Giornaliero */
];
const TIER_RANK = TIER_GROUPS.reduce((m, g) => { m[g.tier] = g.rank; return m; }, {});
const SHEETS_TABS = TIER_GROUPS.reduce((a, g) => a.concat(g.tabs), []);
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; /* 30 giorni */
const EMAIL_CACHE_TTL = 5 * 60 * 1000;  /* 5 min */
const GOOGLE_TIMEOUT = 10 * 1000;       /* una chiamata a Google appesa non deve bloccare l'app */

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
  let fatto = false; const una = (e, t) => { if (fatto) return; fatto = true; cb(e, t); };
  const req = https.request(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(d);
        if (j.access_token) { gsToken = j.access_token; gsTokenExp = Date.now() + (j.expires_in||3600)*1000; una(null, gsToken); }
        else una('token error: ' + d);
      } catch(e) { una(e); }
    });
  });
  req.setTimeout(GOOGLE_TIMEOUT, () => req.destroy(new Error('timeout token Google')));
  req.on('error', e => una(e)); req.write(body); req.end();
}

/* dalle righe di una scheda: prende la colonna con intestazione "email"
   (fallback: qualsiasi cella che contiene "@") */
function emailsFromRows(rows, conScadenza) {
  if (!rows || !rows.length) return [];
  const header = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const col = header.findIndex(h => /mail/.test(h));   /* "Email", "Mail", "E-mail"… */
  const colData = header.findIndex(h => /data/.test(h));   /* «Data Iscrizione», per la prova */
  const out = [];
  if (col >= 0) {
    for (let i = 1; i < rows.length; i++) {
      if (conScadenza && colData >= 0 && provaScaduta(rows[i][colData])) continue;   /* prova finita */
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

/* legge una scheda: cb(err, emails). Un errore NON diventa «scheda vuota»: vuol dire
   «non lo so» (Google giù, quota, rete) e chi chiama decide (vedi LIVELLI: si tiene
   l'ultima lettura buona). Scheda inesistente = errore INVALID_ARGUMENT. */
function fetchTabRows(token, tab, cb) {
  let fatto = false; const una = (e, v) => { if (fatto) return; fatto = true; cb(e, v); };
  const opts = {
    hostname: 'sheets.googleapis.com',
    path: '/v4/spreadsheets/' + SHEETS_ID + '/values/' + encodeURIComponent(tab) + '?majorDimension=ROWS',
    headers: {'Authorization': 'Bearer ' + token}
  };
  const req = https.get(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try { const j = JSON.parse(d); if (j.error) una(j.error); else una(null, emailsFromRows(j.values, comeScheda(tab) === comeScheda(SCHEDA_PROVA))); }
      catch(e) { una(e); }
    });
  });
  req.setTimeout(GOOGLE_TIMEOUT, () => req.destroy(new Error('timeout scheda ' + tab)));
  req.on('error', e => una(e));
}

/* titoli reali delle schede del foglio (per risolvere i nomi configurati senza badare a maiuscole/spazi).
   [] se non si riescono a leggere: allora non si può dire che una scheda manca. */
function fetchSheetTitles(token, cb) {
  let fatto = false; const una = v => { if (fatto) return; fatto = true; cb(v); };
  const opts = {
    hostname: 'sheets.googleapis.com',
    path: '/v4/spreadsheets/' + SHEETS_ID + '?fields=' + encodeURIComponent('sheets.properties.title'),
    headers: {'Authorization': 'Bearer ' + token}
  };
  const req = https.get(opts, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => {
      try { const j = JSON.parse(d); una((j.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean)); }
      catch(e) { una([]); }
    });
  });
  req.setTimeout(GOOGLE_TIMEOUT, () => req.destroy(new Error('timeout titoli')));
  req.on('error', () => una([]));
}

/* ── LIVELLI DAL FOGLIO CRM, A PROVA DI GUASTO ─────────────────────────────────
   Mappa email -> livello ('full' | 'monthly'). Sui DOPPIONI (stessa mail in più schede)
   vince SEMPRE il rank più alto, qualunque sia l'ordine di lettura.
   Dal 15/9/26 il foglio si RICONTROLLA a ogni riapertura dell'app (verify), sulle pagine
   riservate e sulle lezioni piene: chi viene tolto dal CRM (disdetta) perde l'accesso.
   Perché un guasto non butti MAI fuori chi paga:
   - una sola lettura alla volta (chi arriva aspetta quella) e timeout sulle chiamate;
   - scheda che dà ERRORE = «non lo so»: si usa l'ultima lettura buona di quella scheda;
     se non c'è, la mappa è «non sicura» e nessuno viene tolto;
   - scheda che all'improvviso risulta VUOTA, SPARITA (rinominata, cancellata) o con più del
     30% di righe in meno: per 72 ore è un incidente e si tengono le righe di prima;
   - l'ultima mappa buona si salva su disco (DATA/tier-cache.json) e vale anche dopo un riavvio;
   - le verifiche d'accesso non aspettano Google: usano la mappa che c'è e la rinfrescano
     dietro. Il login invece aspetta la lettura fresca, così un nuovo iscritto entra subito. */
const TIER_CACHE_FILE = path.join(DATA, 'tier-cache.json');
const SCHEDA_GRAZIA = 72 * 60 * 60 * 1000;
const SCHEDA_CALO = 0.3;
const LIVELLI_RIPROVA = 60 * 1000;   /* dopo un guasto totale non si ritenta prima di un minuto */
const normScheda = t => String(t).trim().toLowerCase();
let schedeBuone = {};      /* scheda -> { emails, at }: ultima lettura buona NON vuota */
let statoLivelli = null;   /* { map: Map, at, sicura } */
let letturaInCorso = null, ultimoGuasto = 0;
try {
  const c = JSON.parse(fs.readFileSync(TIER_CACHE_FILE, 'utf8'));
  if (c && c.schede) schedeBuone = c.schede;
  if (c && c.map) statoLivelli = { map: new Map(Object.entries(c.map)), at: 0, sicura: !!c.sicura };   /* at 0: si rinfresca appena possibile */
} catch(e) { /* primo avvio: nessuna copia salvata */ }
function salvaLivelli() {
  try {
    const tmp = TIER_CACHE_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ salvato: Date.now(), sicura: statoLivelli.sicura, map: Object.fromEntries(statoLivelli.map), schede: schedeBuone }));
    fs.renameSync(tmp, TIER_CACHE_FILE);
  } catch(e) { console.error('livelli: copia su disco non salvata:', e.message); }
}
function leggiLivelli(fine) {
  if (letturaInCorso) { letturaInCorso.push(fine); return; }
  letturaInCorso = [fine];
  const chiudi = () => {
    const attesa = letturaInCorso; letturaInCorso = null;
    attesa.forEach(f => { try { f(); } catch(e) { console.error('livelli:', e); } });
  };
  getGToken((err, token) => {
    if (err) {
      ultimoGuasto = Date.now();
      console.error('livelli: Google non risponde (' + String(err.message || err).slice(0, 120) + '): uso l\'ultima mappa buona');
      if (!statoLivelli) statoLivelli = { map: new Map(), at: 0, sicura: false };
      return chiudi();
    }
    fetchSheetTitles(token, titles => {
      const titoli = titles.map(normScheda);
      const resolve = want => { const hit = titles.find(t => normScheda(t) === normScheda(want)); return hit || want; };
      const jobs = [];
      TIER_GROUPS.forEach(g => [...new Set(g.tabs.map(resolve))].forEach(tab => jobs.push({ tab, tier: g.tier })));
      const ora = Date.now(); const map = new Map();
      let sicura = true, pending = jobs.length;
      const finito = () => { statoLivelli = { map, at: ora, sicura }; salvaLivelli(); chiudi(); };
      if (!pending) return finito();
      jobs.forEach(job => {
        const chiave = normScheda(job.tab);
        const prima = schedeBuone[chiave];
        const usa = emails => {
          const r = TIER_RANK[job.tier] || 0;
          emails.forEach(e => { const cur = map.get(e); if (!cur || r > (TIER_RANK[cur] || 0)) map.set(e, job.tier); });
          if (--pending === 0) finito();
        };
        const eProva = chiave === comeScheda(SCHEDA_PROVA);
        const incidente = quante => !eProva && !!(prima && prima.emails.length && (ora - prima.at) < SCHEDA_GRAZIA &&
          (quante === 0 || (prima.emails.length >= 10 && quante < prima.emails.length * (1 - SCHEDA_CALO))));
        const letta = emails => {   /* il foglio ha risposto davvero */
          if (incidente(emails.length)) {
            console.error('livelli: scheda «' + job.tab + '» da ' + prima.emails.length + ' a ' + emails.length + ' righe: incidente, tengo l\'ultima lettura buona');
            return usa(prima.emails);
          }
          if (emails.length || eProva) schedeBuone[chiave] = { emails, at: ora };   /* la prova vale anche vuota */
          usa(emails);
        };
        if (titoli.length && titoli.indexOf(chiave) < 0) return letta([]);   /* la scheda non esiste (più) */
        fetchTabRows(token, job.tab, (errTab, emails) => {
          if (!errTab) return letta(emails);
          const manca = errTab.status === 'INVALID_ARGUMENT' || /parse range/i.test(String(errTab.message || ''));
          if (manca) return letta([]);
          if (prima) { console.error('livelli: scheda «' + job.tab + '» non letta: uso l\'ultima lettura buona'); return usa(prima.emails); }
          sicura = false;   /* nessuna copia buona: finché non si legge, nessuno viene tolto */
          usa([]);
        });
      });
    });
  });
}
/* la mappa dei livelli: cb(stato). aspetta=true (login): se è scaduta aspetta la lettura fresca.
   Senza aspetta (verifiche d'accesso): risponde subito con quella che c'è e la rinfresca dietro. */
function livelli(cb, aspetta) {
  const ora = Date.now();
  const fresca = statoLivelli && ora - statoLivelli.at < EMAIL_CACHE_TTL;
  if (fresca || (statoLivelli && ora - ultimoGuasto < LIVELLI_RIPROVA)) return cb(statoLivelli);
  if (statoLivelli && !aspetta) { leggiLivelli(() => {}); return cb(statoLivelli); }
  leggiLivelli(() => cb(statoLivelli));
}
/* compatibilità (login, pannello, prova): la mappa aggiornata; errore solo se non c'è nessun dato affidabile */
function getTierMap(cb) {
  livelli(stato => {
    if (!stato || (!stato.sicura && !stato.map.size)) return cb('livelli non disponibili');
    cb(null, stato.map);
  }, true);
}
/* livello di una sessione valida, RICONTROLLATO sul foglio: cb(tier, sicuro)
   'full' | 'monthly' | 'trial' | null (non è più nel foglio: fuori).
   Foglio non sicuro: nessuno viene tolto; vale il livello confermato l'ultima volta
   (sess.lastTier), altrimenti il mensile (dentro, ma senza le lezioni piene). */
function livelloDiSessione(email, sess, cb) {
  livelli(stato => {
    const dalFoglio = stato && stato.map.get(email);
    if (dalFoglio) return cb(dalFoglio, true);
    if (sess && sess.tier === 'trial') return cb('trial', true);
    if (stato && stato.sicura) return cb(null, true);
    return cb((sess && sess.lastTier) || 'monthly', false);
  });
}
/* livello dell'utente della richiesta (dal cookie di sessione): cb(null, tier, sicuro).
   FAIL-CLOSED: chi non è nel foglio NON diventa 'full'. */
function tierForReq(req, cb) {
  const s = sessionFromReq(req);
  if (!s) return cb(null, null, true);
  livelloDiSessione(s.email, readSess(sessFile(s.email)), (tier, sicuro) => cb(null, tier, sicuro));
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
/* scrittura ATOMICA del file di sessione (temp + rename): la shell e le sezioni chiamano
   /api/auth/verify quasi insieme all'apertura; senza atomicità una lettura concorrente
   poteva leggere un file mezzo-scritto → JSON.parse fallisce → verify 'ok:false' → la
   pagina rimbalzava a /app/. Il rename è atomico: chi legge vede sempre un file completo. */
function writeSess(email, obj) {
  const f = sessFile(email);
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, f);
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
/* ── LETTURA DAL PANNELLO DELLA COMMUNITY (17/9/26) ──
   Andrea vuole questi dati anche nel Pannello di controllo della community «così ho tutto insieme».
   Il server della community chiede SOLO queste tre GET con un gettone (Authorization: Bearer …)
   salvato in /data/community-stats.token (fuori dal repo pubblico, almeno 32 caratteri).
   Nessuna scrittura: le POST (es. eliminare un suggerimento) restano a chi entra con la password. */
const STATS_TOKEN_FILE = path.join(DATA, 'community-stats.token');
const STATS_PATHS = ['/api/admin/overview', '/api/admin/chats', '/api/admin/suggestions'];
let _stCache = null, _stAt = 0;
function statsToken() {
  if (_stCache !== null && Date.now() - _stAt < 60000) return _stCache;
  try { _stCache = fs.readFileSync(STATS_TOKEN_FILE, 'utf8').trim(); } catch(e) { _stCache = ''; }
  _stAt = Date.now();
  return _stCache;
}
function statsFromReq(req) {
  if (req.method !== 'GET' || STATS_PATHS.indexOf(req.path) < 0) return false;
  const h = String(req.headers.authorization || '');
  if (h.slice(0, 7) !== 'Bearer ') return false;
  const t = statsToken();
  return t.length >= 32 && safeEq(h.slice(7).trim(), t);
}
function adminFromReq(req) {
  if (statsFromReq(req)) return { email: 'pannello-community', solaLettura: true };
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
    if (map.has(email)) return res.json({ok: true, tier: map.get(email)});
    if (isTrialLead(email)) return res.json({ok: true, tier: 'trial'});   /* rientro prova */
    res.json({ok: false, tier: null});
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
    const isTrial = !map.has(email);
    if (isTrial && !isTrialLead(email)) return res.status(403).json({ok: false, reason: 'unauthorized'});
    const tier = isTrial ? 'trial' : (map.get(email) || 'full');
    /* record di sessione: i "prova" portano il marcatore tier:'trial' (gating fail-closed) */
    const rec = (tok) => isTrial ? {token: tok, at: Date.now(), tier: 'trial'} : {token: tok, at: Date.now(), lastTier: tier};
    const f = sessFile(email);
    const sess = readSess(f);
    if (sess && sess.token && (Date.now() - sess.at) < SESSION_TTL) {
      if (existingToken && existingToken === sess.token) {
        /* stesso dispositivo: rinnova timestamp */
        writeSess(email, rec(sess.token));
        setSessionCookie(res, email, sess.token);
        return res.json({ok: true, token: sess.token, tier});
      }
      if (!force) return res.json({ok: false, reason: 'active'});
      /* force=true: scaccia l'altra sessione */
    }
    const token = crypto.randomBytes(32).toString('hex');
    writeSess(email, rec(token));
    setSessionCookie(res, email, token);
    res.json({ok: true, token, tier});
  });
});

/* POST /api/auth/verify — verifica che la sessione sia ancora valida (keep-alive).
   Dal 15/9/26 RICONTROLLA IL CRM a ogni riapertura dell'app: chi è stato tolto dal foglio
   (disdetta) perde la sessione e torna al login, dove il controllo incrociato lo lascia fuori.
   Se il foglio non è affidabile nessuno viene tolto (vedi LIVELLI). */
app.post('/api/auth/verify', (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const token = String(b.token || '');
  if (!emailRe.test(email) || !token) return res.status(400).json({ok: false});
  const sess = readSess(sessFile(email));
  if (!(sess && sess.token === token && (Date.now() - sess.at) < SESSION_TTL)) {
    return res.json({ok: false, reason: sess ? 'expired' : 'not_found'});
  }
  livelloDiSessione(email, sess, (tier, sicuro) => {
    const attuale = readSess(sessFile(email));   /* riletta: nel frattempo può essere cambiata (uscita, altro dispositivo) */
    if (!(attuale && attuale.token === token)) return res.json({ok: false, reason: attuale ? 'expired' : 'not_found'});
    if (!tier) {
      try { fs.unlinkSync(sessFile(email)); } catch(e) {}
      clearSessionCookie(res);
      console.log('accesso chiuso alla riapertura: email non più nel foglio CRM');
      return res.json({ok: false, reason: 'unauthorized'});
    }
    attuale.at = Date.now();
    if (sicuro && tier !== 'trial') attuale.lastTier = tier;   /* livello confermato: serve se un giorno Google non risponde */
    writeSess(email, attuale);   /* atomico · PRESERVA 'tier' (es. la prova) */
    setSessionCookie(res, email, token);   /* installa/aggiorna il cookie: upgrade trasparente */
    res.json(sicuro || attuale.lastTier ? {ok: true, tier} : {ok: true});
  });
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
  bambino:   {teoria:'1200559555',foglio:'1201477236',medit:'1201478348'},
  adulto:    {video:'1201481001'},   /* la visualizzazione dell'Adulto Interiore: copertina bloccata per i mensili */
  ombra:     {v0:'1200561278',v1:'1201483669',v2:'1231633320',v3:'1231633316',v4:'1231633317',v5:'1231633318'},   /* la spiegazione + i cinque passi dell'Ombra */
  day:       {s1:'1184907857',s2:'1184907860'}   /* Spazio Emotivo / Osservatore: copertina per la prova */
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
    const dormAll = users.filter(u => u.attivato && u.lastActive && u.lastActive < limite)
      .sort((a, b) => a.lastActive - b.lastActive);
    const dormienti = dormAll.slice(0, 60)
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
      hours, topAreas, dailySeries, dormienti, dormientiTot: dormAll.length,
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

/* ── ENTRATA DALLA COMMUNITY: /app/community ──
   È la stessa identica app di /app/, ma con sotto il menu della community «Oltre il Velo».
   Rimando alla shell con ?community=1: app/community-menu.js se lo ricorda per quella
   scheda e chiede a /api/community/menu se la barra si può mostrare. Chi apre /app/
   normale non vede nessun menu.
   Sta PRIMA del gating: /app/community/ (con la barra) finirebbe tra le cartelle riservate.

   IL PONTE (Andrea, 16/9/26: sulla schermata di accesso «ci deve essere! ma solo se accedo
   da community.elisasoulmedium.com»). La community manda qui con ?pass=<codice usa-e-getta>
   (2 minuti, niente mail nell'indirizzo); il server chiede alla community se il codice è vero
   (GET COMMUNITY_URL/api/ponte/cammino/:codice). Se lo è e la persona è annuale o mensile, un
   cookie firmato «arriva dalla community» (12 ore) fa vedere la barra anche prima dell'accesso.
   Niente segreti condivisi: la chiave della firma sta solo qui, in /data. */
const COMMUNITY_URL = (process.env.COMMUNITY_URL || 'https://community.elisasoulmedium.com').replace(/\/+$/, '');
const VIA_COMM = 'ovl_via_comm';
const VIA_COMM_ORE = 12;
const chiavePonte = (() => {
  const f = path.join(DATA, 'ponte-community.key');
  try { const k = fs.readFileSync(f); if (k.length >= 32) return k; } catch (e) { /* la creo */ }
  const k = crypto.randomBytes(32);
  try { fs.writeFileSync(f, k, { mode: 0o600 }); } catch (e) { /* senza volume vale fino al riavvio */ }
  return k;
})();
const firmaPonte = s => crypto.createHmac('sha256', chiavePonte).update('via-community:' + s).digest('base64url');
function viaCommunityOk(req) {
  const v = parseCookies(req)[VIA_COMM];
  if (!v) return false;
  const i = v.indexOf('.');
  if (i < 0) return false;
  const scade = v.slice(0, i), firma = Buffer.from(v.slice(i + 1)), attesa = Buffer.from(firmaPonte(scade));
  if (firma.length !== attesa.length || !crypto.timingSafeEqual(firma, attesa)) return false;
  return Number(scade) > Date.now();
}
function verificaPonte(codice, cb) {
  let fatto = false;
  const fine = t => { if (!fatto) { fatto = true; cb(t); } };
  let url;
  try { url = new URL(COMMUNITY_URL + '/api/ponte/cammino/' + encodeURIComponent(codice)); } catch (e) { return fine(null); }
  const mod = url.protocol === 'http:' ? require('http') : https;
  const r = mod.get(url, { timeout: 4000, headers: { accept: 'application/json' } }, risp => {
    let corpo = '';
    risp.setEncoding('utf8');
    risp.on('data', d => { if (corpo.length < 2000) corpo += d; });
    risp.on('end', () => {
      if (risp.statusCode !== 200) return fine(null);
      try { const j = JSON.parse(corpo); fine(j && j.ok === true ? String(j.tier || '') : null); } catch (e) { fine(null); }
    });
  });
  r.on('timeout', () => { r.destroy(); fine(null); });
  r.on('error', () => fine(null));
}
app.get(['/app/community', '/app/community/'], (req, res) => {
  res.set('Cache-Control', 'no-store');
  const pass = String(req.query.pass || '');
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(pass)) return res.redirect(302, '/app/?community=1');
  verificaPonte(pass, tier => {
    if (tier === 'full' || tier === 'monthly') {
      const scade = String(Date.now() + VIA_COMM_ORE * 3600 * 1000);
      res.append('Set-Cookie', VIA_COMM + '=' + scade + '.' + firmaPonte(scade) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + VIA_COMM_ORE * 3600);
    }
    res.redirect(302, '/app/?community=1');
  });
});
/* la barra della community SOLO per annuali e mensili: MAI alla prova gratuita (Andrea, 15/9/26:
   dalla prova non si deve poter entrare nella community). Decide il server:
   - con una sessione: cookie di sessione + foglio CRM (tierForReq, fail-closed: senza una
     conferma sicura dal foglio niente barra; la prova e gli ex iscritti mai);
   - SENZA sessione (schermata di accesso): solo col cookie firmato del ponte, cioè a chi è
     appena arrivato dalla community con un codice verificato (16/9/26). */
app.get('/api/community/menu', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const conSessione = !!sessionFromReq(req);
  tierForReq(req, (err, tier, sicuro) => {
    const socio = !err && sicuro === true && (tier === 'full' || tier === 'monthly');
    const daCommunity = !conSessione && viaCommunityOk(req);
    /* chi entra con la prova non si porta dietro il permesso del ponte */
    if (conSessione && tier === 'trial' && parseCookies(req)[VIA_COMM]) res.append('Set-Cookie', VIA_COMM + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    res.json({ ok: true, menu: socio || daCommunity });
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
/* il livello "prova" può ENTRARE in tutte le sezioni (vetrina/showroom), ma:
   - capitolo2/bambino sono serviti STRIPATI (niente ID video reali — vedi sotto);
   - il Giornaliero non ha video premium e i salvataggi sono bloccati per la prova;
   - dentro le sezioni le azioni (play/scrittura) aprono il pop-up community (lato pagina). */
function trialAllowedPath(p){
  return p.indexOf('/app/percorso') === 0 || p.indexOf('/app/music/') === 0
      || p.indexOf('/app/capitolo2') === 0 || p.indexOf('/app/bambino') === 0
      || p.indexOf('/app/adulto') === 0 || p.indexOf('/app/ombra') === 0 || p.indexOf('/app/day') === 0;
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!isReserved(req.path)) return next();
  const nega = () => {
    res.set('Cache-Control', 'no-store');
    const isDoc = req.path.charAt(req.path.length - 1) === '/' || /\.html?$/.test(req.path);
    if (isDoc) return res.redirect(302, '/app/');         /* pagina riservata non concessa → home (sentiero coi lucchetti) */
    return res.status(403).end();                          /* media/asset riservato → negato */
  };
  const s = sessionFromReq(req);
  if (!s) return nega();
  /* sessione valida: il livello si RICONTROLLA sul foglio (chi è stato tolto dal CRM non passa più).
     La mappa sta in memoria: audio e video non rallentano. */
  livelloDiSessione(s.email, readSess(sessFile(s.email)), tier => {
    if (tier === 'trial') return trialAllowedPath(req.path) ? next() : nega();   /* prova: solo la vetrina */
    if (tier === 'full' || tier === 'monthly') return next();                   /* paganti */
    return nega();                                                               /* non più nel foglio */
  });
});

/* ── LE COPERTINE DELL'OMBRA ──
   Sono le immagini disegnate da Andrea. Stanno nel VOLUME (/data/copertine/ombra), NON nel
   repo, che è pubblico. Le serviamo noi come file veri: prima passavano da /api/cover, che
   risponde con un rimando (302) alla miniatura di Vimeo, e dentro l'app installata il service
   worker inciampava su quel rimando — sulle schede restava il numero del passo.
   Stanno sotto /app, quindi le protegge il cancello qui sopra: senza accesso, niente immagini. */
app.get('/app/:sez/cover/:file', (req, res) => {
  const sez = String(req.params.sez || ''), f = String(req.params.file || '');
  if (!/^(ombra|bambino|adulto)$/.test(sez)) return res.status(404).end();
  if (!/^[a-z0-9]{1,12}\.jpg$/.test(f)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=604800');
  res.sendFile(path.join(DATA, 'copertine', sez, f), err => { if (err && !res.headersSent) res.status(404).end(); });
});

/* ── ACCESSO MENSILE ("trailer"): per le sezioni oltre il Giornaliero (Mondo Interiore,
   Bambino) il server serve una versione DEPURATA dell'HTML: rimuove i blocchi
   <!--FULL-->…<!--/FULL--> (ID video, testi degli esercizi) e ATTIVA i blocchi
   <!--MONTHLY …MONTHLY--> (copertine bloccate + invito a passare all'annuale).
   Così i contenuti pieni non vengono proprio inviati a chi è "mensile".
   Dal 15/9/26 è al contrario, FAIL-CLOSED: le pagine piene vanno SOLO a chi risulta annuale;
   mensili, prova e qualunque dubbio (per esempio chi non è più nel foglio) ricevono il trailer. */
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
  const m = req.path.match(/^\/app\/(capitolo2|bambino|adulto|ombra)\/(?:index\.html)?$/);
  if (!m) return next();
  tierForReq(req, (err, tier) => {
    if (!err && tier === 'full') return next();   /* annuali → versione completa */
    const html = monthlyHtml(path.join(__dirname, 'app', m[1], 'index.html'));   /* tutti gli altri → trailer stripato */
    if (html == null) return res.status(404).end();
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
