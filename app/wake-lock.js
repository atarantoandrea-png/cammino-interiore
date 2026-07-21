/* Tiene ACCESO lo schermo mentre un video è in riproduzione — come YouTube.
   Usa la Screen Wake Lock API (Android Chrome; iPhone: Safari/iOS 16.4+). Si aggancia
   a QUALSIASI video Vimeo della pagina (quelli presenti ORA e quelli aggiunti in futuro)
   tramite l'SDK Vimeo: quando un video parte → schermo sveglio; a pausa/fine → rilascio.
   Se il browser non ha l'API (iOS più vecchi) non fa nulla: nessun errore, comportamento
   invariato. Riguarda SOLO i video: la musica (audio) resta libera di suonare a schermo spento. */
(function(){
  if(!('wakeLock' in navigator)) return;   /* niente API → niente da fare (fallback silenzioso) */

  var lock=null, want=false;
  var playing=(window.Set)?new Set():null, count=0;   /* insieme dei video attualmente in play */

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
  function release(){
    want=false;
    if(lock){ try{ lock.release(); }catch(e){} lock=null; }
  }
  function markPlay(key){ if(playing){ playing.add(key); } else { count++; } acquire(); }
  function markStop(key){
    if(playing){ playing['delete'](key); if(playing.size===0) release(); }
    else { count=Math.max(0,count-1); if(count===0) release(); }
  }

  /* il wake lock si perde quando la pagina va in background: se un video sta ancora
     suonando, lo riprendo appena la pagina torna visibile */
  document.addEventListener('visibilitychange', function(){
    var attivi = playing ? playing.size : count;
    if(document.visibilityState==='visible' && want && attivi>0) acquire();
  });

  function attach(ifr){
    if(ifr.__wl || !(window.Vimeo && Vimeo.Player)) return;
    ifr.__wl=true;
    try{
      var p=new Vimeo.Player(ifr);
      p.on('play',  function(){ markPlay(ifr); });
      p.on('pause', function(){ markStop(ifr); });
      p.on('ended', function(){ markStop(ifr); });
    }catch(e){ ifr.__wl=false; }
  }
  function scan(){
    var ifrs=document.querySelectorAll('iframe[src*="vimeo"]');
    for(var i=0;i<ifrs.length;i++) attach(ifrs[i]);
  }
  function start(){
    scan();
    try{
      var mo=new MutationObserver(function(){ scan(); });
      mo.observe(document.documentElement, {childList:true, subtree:true});
    }catch(e){}
  }

  /* assicura l'SDK Vimeo (se una pagina non l'ha già caricato), poi parte */
  if(window.Vimeo && Vimeo.Player){ start(); }
  else{
    var s=document.createElement('script');
    s.src='https://player.vimeo.com/api/player.js';
    s.onload=start;
    s.onerror=function(){};
    document.head.appendChild(s);
  }
})();
