/* Tracciamento uso del Cammino Interiore (per la dashboard di Andrea).
   Manda al server: un'apertura + il tempo realmente passato sulla pagina (solo quando
   è visibile e attiva). Nessun dato nuovo sensibile: solo l'email già autorizzata,
   l'area e i secondi. Funziona da solo su ogni pagina che lo include. */
(function(){
  var email = '', token = '';
  try { email = (localStorage.getItem('ovl-user') || '').trim().toLowerCase(); token = localStorage.getItem('ovl-session') || ''; } catch(e) {}
  if (!email || !token) return;   /* non loggato: niente tracciamento */

  var p = location.pathname, area = 'home';
  if (/\/day\//.test(p)) area = 'giornaliero';
  else if (/\/capitolo2\//.test(p)) area = 'mondo';
  else if (/\/bambino\//.test(p)) area = 'bambino';
  else if (/\/install\//.test(p)) area = 'install';

  function localDate(){ var d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }

  function send(ev, sec, beacon){
    var body = JSON.stringify({ email:email, token:token, area:area, ev:ev, sec:sec||0, lday:localDate(), lhour:new Date().getHours() });
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon('/api/track', new Blob([body], {type:'application/json'})); }
      else { fetch('/api/track', { method:'POST', headers:{'Content-Type':'application/json'}, body:body, keepalive:true })['catch'](function(){}); }
    } catch(e) {}
  }

  var STEP = 45;                         /* ogni 45s mando il tempo accumulato */
  var visStart = (document.visibilityState === 'visible') ? Date.now() : 0;
  var pending = 0;

  function flush(beacon){
    if (visStart) { pending += (Date.now() - visStart) / 1000; visStart = Date.now(); }
    var sec = Math.round(pending);
    if (sec >= 5) { send('beat', sec, beacon); pending -= sec; }   /* visite lampo < 5s ignorate */
  }

  send('open', 0);                       /* registra l'apertura */
  setInterval(function(){ if (document.visibilityState === 'visible') flush(false); }, STEP * 1000);

  document.addEventListener('visibilitychange', function(){
    if (document.visibilityState === 'visible') { visStart = Date.now(); }
    else { flush(false); visStart = 0; }
  });
  addEventListener('pagehide', function(){ flush(true); });
})();
