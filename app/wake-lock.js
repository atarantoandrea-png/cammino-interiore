/* Tiene ACCESO lo schermo mentre guardi un video — come YouTube.
   Versione LEGGERISSIMA: nessun SDK Vimeo, nessun MutationObserver, nessun player extra
   (quelli caricavano memoria in più e su iPhone contribuivano al crash "schermo bianco").
   Uso solo la Screen Wake Lock API: appena tocchi/apri un'area video tengo sveglio lo
   schermo, e lo rilascio quando lasci la pagina o vai in background. */
(function(){
  if(!('wakeLock' in navigator)) return;   /* iOS < 16.4 o browser senza API: no-op */
  var lock=null, want=false;

  function acquire(){
    want=true;
    if(lock || document.visibilityState!=='visible') return;
    try{
      navigator.wakeLock.request('screen').then(function(s){
        lock=s;
        try{ lock.addEventListener('release', function(){ lock=null; }); }catch(e){}
      })['catch'](function(){});
    }catch(e){}
  }
  function drop(){ if(lock){ try{ lock.release(); }catch(e){} lock=null; } }

  /* Quando tocchi qualcosa legato a un video (copertina, riquadro, card dell'esercizio…)
     tengo acceso lo schermo. È un semplice ascolto dei clic: costo praticamente zero. */
  var VIDSEL='.lframe,.dvframe,.dvideo,.vid,.medvideo,.vframe,.excover,.tgcover,.excard,.exitem,.dvcover,.mu-entry';
  document.addEventListener('click', function(e){
    var t=e.target;
    if(t && t.closest && t.closest(VIDSEL)) acquire();
    else if(document.querySelector('iframe[src*="vimeo"]')) acquire();  /* un video è già a schermo: ogni tocco lo tiene sveglio */
  }, true);

  /* il wake lock si perde in background: lo riprendo al ritorno se un video era attivo,
     e lo rilascio quando esci dalla pagina */
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='visible'){ if(want) acquire(); }
    else drop();
  });
  addEventListener('pagehide', drop);
})();
