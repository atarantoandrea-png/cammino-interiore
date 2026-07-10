// Push notifications (Cammino Interiore — via PWA Manager)
importScripts('https://pwa.elisasoulmedium.com/cammino-interiore/sw-core.js');

// ─── Aggiornamento automatico: strategia "network-first" ────────────────────
// Quando sei ONLINE l'app carica SEMPRE l'ultima versione dalla rete.
// Quando sei OFFLINE usa l'ultima versione salvata in cache.
const CACHE = 'cammino-v8';

// la nuova versione si attiva SUBITO, senza aspettare la chiusura di tutte le schede
self.addEventListener('install', function(){ self.skipWaiting(); });

// Contenuti riservati (tutto ciò che sta in una sotto-cartella di /app: pagine,
// audio, musica…): mai in cache, solo rete — niente accesso offline senza sessione
// e verifica sempre fatta dal server.
function isReserved(u) {
  if (u.pathname.indexOf('/app/') !== 0) return false;
  if (u.pathname.indexOf('/app/install') === 0) return false;
  return u.pathname.slice('/app/'.length).indexOf('/') >= 0;
}

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo risorse del nostro sito; il resto (font, init.js, push) lo gestisce il browser
  if (url.origin !== self.location.origin) return;

  // Le pagine riservate non vanno in cache (niente contenuti offline senza sessione)
  if (isReserved(url)) { event.respondWith(fetch(req)); return; }

  event.respondWith(
    fetch(req)
      .then(function(res) {
        // Salva una copia aggiornata in cache (per l'uso offline)
        const copy = res.clone();
        caches.open(CACHE).then(function(c) { c.put(req, copy); });
        return res;
      })
      .catch(function() {
        // Rete non disponibile: usa la copia salvata
        return caches.match(req);
      })
  );
});

// Pulisci le cache vecchie quando cambia la versione + prendi il controllo
// delle pagine già aperte, così l'aggiornamento si vede senza riaprire l'app
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});
