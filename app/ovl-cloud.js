/* ================================================================
   OVL_CLOUD — salva nella nuvola (legata alla mail) i dati che prima
   vivevano SOLO nel browser: video visti del Mondo Interiore, foglio
   del Bambino, progressi, riflessioni della meditazione.

   Perché: se una persona si disiscrive e poi si re-iscrive — magari
   mesi dopo, con un telefono nuovo — i suoi progressi tornano tutti,
   perché sono sul server, legati alla sua email (i file /data non
   vengono mai cancellati: la disiscrizione toglie solo l'email
   dall'elenco autorizzato). Vedi [[progressi-backup-email]].

   Come: ogni "secchiello" è un oggetto JSON in localStorage <-> un
   archivio separato nella nuvola (/api/store?ns=...). La fusione è
   per-chiave sul timestamp più recente — identica al Giornaliero —
   così PC e telefono non si sovrascrivono mai a vicenda.
   A differenza di lume.js (sola lettura), qui si legge E si scrive.
   ================================================================ */
window.OVL_CLOUD=(function(){
  function readLS(k){ try{ return JSON.parse(localStorage.getItem(k)||'{}')||{}; }catch(e){ return {}; } }
  function writeLS(k,o){ try{ localStorage.setItem(k, JSON.stringify(o)); }catch(e){} }
  function eq(a,b){ try{ return JSON.stringify(a)===JSON.stringify(b); }catch(e){ return a===b; } }

  /* un secchiello = una chiave localStorage  <->  un namespace nella nuvola */
  function bucket(opt){
    var email=(opt.email||'').trim().toLowerCase();
    var token=opt.token||'';
    var LK=opt.localKey;          /* es. 'ovl-cap2:mario@x.it' */
    var ns=opt.ns;                /* es. 'cap2' */
    var MK=LK+':cmeta';           /* timestamp per-chiave, in locale */
    var meta=readLS(MK);
    var shadow=readLS(LK);        /* ultimo stato conosciuto: per capire COSA è cambiato */
    var timer=null;

    function url(){
      return '/api/store?email='+encodeURIComponent(email)+
             '&token='+encodeURIComponent(token)+
             '&ns='+encodeURIComponent(ns);
    }
    function bodyStr(){
      return JSON.stringify({ email:email, token:token, ns:ns, data:readLS(LK), meta:meta });
    }
    /* marca col timestamp di ADESSO le chiavi cambiate rispetto allo shadow */
    function stamp(){
      var cur=readLS(LK), t=Date.now(), changed=false;
      for(var k in cur){ if(!eq(cur[k], shadow[k])){ meta[k]=t; changed=true; } }
      if(changed){ shadow=cur; writeLS(MK, meta); }
      return changed;
    }
    function send(){
      if(!email) return;
      try{
        fetch('/api/store',{ method:'PUT', headers:{'Content-Type':'application/json'}, body:bodyStr() })
          .catch(function(){});
      }catch(e){}
    }

    return {
      /* da chiamare DOPO ogni salvataggio locale: marca i cambiamenti e invia (debounce) */
      push:function(){
        if(!email) return;
        if(!stamp()) return;          /* niente di nuovo: non disturbare la rete */
        clearTimeout(timer); timer=setTimeout(send, 600);
      },
      /* scarica la nuvola e fonde nel locale; cb(changed) per ridisegnare la pagina */
      pull:function(cb){
        if(!email){ if(cb)cb(false); return; }
        fetch(url())
          .then(function(r){ if(!r.ok) throw 0; return r.json(); })
          .then(function(rem){
            if(!rem || typeof rem.data!=='object' || !rem.data){ if(cb)cb(false); return; }
            var cur=readLS(LK), rmeta=rem.meta||{}, changed=false;
            for(var k in rem.data){
              var tR=+rmeta[k]||0, tL=+meta[k]||0;
              if(tR>tL){ cur[k]=rem.data[k]; meta[k]=tR; changed=true; }
            }
            if(changed){ writeLS(LK, cur); writeLS(MK, meta); shadow=cur; }
            if(cb)cb(changed);
          })
          .catch(function(){ if(cb)cb(false); });
      },
      /* all'uscita dalla pagina: invio affidabile anche se la tab si chiude */
      beacon:function(){
        if(!email) return;
        stamp();
        try{ navigator.sendBeacon('/api/store', new Blob([bodyStr()],{type:'application/json'})); }catch(e){}
      }
    };
  }

  return { bucket:bucket };
})();
