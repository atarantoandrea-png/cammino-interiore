// Push notifications (Cammino Interiore — via PWA Manager)
importScripts('https://pwa.elisasoulmedium.com/cammino-interiore/sw-core.js');

// ─── Aggiornamento automatico: strategia "network-first" ────────────────────
// Quando sei ONLINE l'app carica SEMPRE l'ultima versione dalla rete.
// Quando sei OFFLINE usa l'ultima versione salvata in cache.
const CACHE = 'cammino-v4';

self.addEventListener('fetch', function(event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Solo risorse del nostro sito; il resto (font, init.js, push) lo gestisce il browser
  if (url.origin !== self.location.origin) return;

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

// Pulisci le cache vecchie quando cambia la versione
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
});
