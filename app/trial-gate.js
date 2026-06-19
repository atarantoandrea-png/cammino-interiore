/* Vetrina della PROVA dentro le sezioni (Giornaliero, Mondo Interiore, Bambino).
   La prova ENTRA, NAVIGA e VEDE tutto liberamente (freccia indietro, menu in alto,
   sfogliare, scorrere). Il pop-up "Entra in Oltre il Velo" compare SOLO quando prova a
   USARE un contenuto premium: riprodurre un video o aprire/scrivere un esercizio.
   Sostituisce anche l'eventuale pop-up "passa all'annuale" del trailer con quello community.
   ⚠️ Si attiva SOLO per il livello "trial": per i paganti/mensili NON fa assolutamente nulla
   (così l'app ufficiale non viene toccata). Protezione contenuti già fatta lato server. */
(function(){
  var email=''; try{ email=(localStorage.getItem('ovl-user')||'').trim().toLowerCase(); }catch(e){}
  var plan='';  try{ plan=localStorage.getItem('ovl-plan:'+email)||''; }catch(e){}
  if(plan!=='trial') return;   /* SOLO la prova — l'app ufficiale resta intatta */

  var s=document.createElement('style');
  s.textContent='#tgComm{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:22px;'+
    'background:rgba(6,4,12,.78);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);font-family:Georgia,serif}'+
    '#tgComm.on{display:flex}'+
    '#tgComm .tgc{position:relative;max-width:380px;width:100%;background:linear-gradient(165deg,#241b37,#140f22);'+
    'border:1px solid rgba(205,178,242,.3);border-radius:22px;padding:28px 22px 22px;text-align:center;color:#e9e4f0;box-shadow:0 24px 70px rgba(0,0,0,.6)}'+
    '#tgComm .tgi{font-size:32px}'+
    '#tgComm h3{font-family:Georgia,serif;color:#dccdf6;font-size:21px;margin:8px 0 8px}'+
    '#tgComm p{color:#bcb3c9;font-size:16.5px;line-height:1.5;margin-bottom:16px}'+
    '#tgComm .tgcta{display:block;text-decoration:none;border-radius:14px;padding:15px;color:#1c1428;font-weight:700;'+
    'font-family:Georgia,serif;background:linear-gradient(135deg,#e8d9ae,#c9a84c);box-shadow:0 8px 24px rgba(201,168,76,.35)}'+
    '#tgComm .tgcont{display:block;width:100%;margin-top:10px;background:none;border:1px solid rgba(185,163,227,.4);'+
    'color:#dccdf6;border-radius:12px;padding:11px;cursor:pointer;font-size:15px;font-family:Georgia,serif}'+
    '#tgComm .tgx{position:absolute;top:10px;right:13px;background:none;border:none;color:#bcb3c9;font-size:20px;cursor:pointer}';
  document.head.appendChild(s);

  var v=document.createElement('div'); v.id='tgComm';
  v.innerHTML='<div class="tgc">'+
    '<button class="tgx" type="button" aria-label="Chiudi">✕</button>'+
    '<div class="tgi">💓</div>'+
    '<h3>Questo è dentro Oltre il Velo</h3>'+
    '<p>Nella prova puoi <b>vedere tutto</b>. Per <b>viverlo</b> — guardare i video, fare gli esercizi — entra nella community <b>Oltre il Velo</b> e scegli l\'annuale: ti aspetto dentro, camminiamo insieme.</p>'+
    '<a class="tgcta" href="https://www.elisasoulmedium.com/oltreilvelo" target="_blank" rel="noopener">Entra in Oltre il Velo →</a>'+
    '<button class="tgcont" type="button">Continua a guardare</button>'+
    '</div>';
  document.body.appendChild(v);
  function show(){ v.classList.add('on'); }
  function hide(){ v.classList.remove('on'); }
  v.querySelector('.tgx').addEventListener('click', function(e){ e.stopPropagation(); hide(); });
  v.querySelector('.tgcont').addEventListener('click', function(e){ e.stopPropagation(); hide(); });

  /* zone di NAVIGAZIONE sempre libere (freccia indietro, menu in alto, settimane del diario, luce, musica, guida) */
  var FREE='#back-fab,#back-btn,nav.tabs,.tabs,.wnav-btn,#lume,.mu-mini,.mu-mini *,.gp-orb,#gpan,#gpan *';
  /* contenuti PREMIUM: al clic → pop-up (video, esercizi, copertine bloccate, pulsanti azione) */
  var BLOCK='.panel,.dvideo,.dvframe,.vframe,.excover,.segna,.llock,.llock-play,.lcover,.vcard,.vcover,input,textarea,select,[contenteditable="true"]';

  function within(t, sel){ return t && t.closest && t.closest(sel); }

  /* SCRIVERE in un campo → pop-up (e niente scrittura) */
  document.addEventListener('focusin', function(e){ if(v.contains(e.target)) return;
    var t=e.target; if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)){ try{t.blur();}catch(x){} show(); } }, true);

  /* CLIC: navigazione libera, contenuto premium → pop-up */
  document.addEventListener('click', function(e){
    if(v.contains(e.target)) return;
    if(within(e.target, FREE)) return;                 /* menu/indietro/settimane: liberi */
    if(within(e.target, BLOCK)){ e.preventDefault(); e.stopPropagation(); show(); }
  }, true);

  /* RIPRODUZIONE video: se viene inserito un player Vimeo, lo tolgo e mostro l'invito */
  function killVimeo(node){
    var ifr = (node.tagName==='IFRAME' && /vimeo/.test(node.src||'')) ? node
            : (node.querySelector ? node.querySelector('iframe[src*="vimeo"]') : null);
    if(ifr){ try{ ifr.remove(); }catch(x){} show(); return true; }
    return false;
  }
  /* SOSTITUZIONE upsell annuale → community: se il trailer apre il suo pop-up "passa all'annuale"
     (#upsell .on), lo chiudo e mostro il pop-up community al suo posto */
  function killUpsell(){ var u=document.getElementById('upsell'); if(u && u.classList.contains('on')){ u.classList.remove('on'); show(); return true; } return false; }
  try{
    [].forEach.call(document.querySelectorAll('iframe[src*="vimeo"]'), function(f){ try{ f.remove(); }catch(x){} });
    var mo=new MutationObserver(function(muts){
      muts.forEach(function(m){
        if(m.type==='attributes'){ killUpsell(); return; }
        for(var i=0;i<m.addedNodes.length;i++){ var n=m.addedNodes[i]; if(n.nodeType===1) killVimeo(n); }
      });
    });
    mo.observe(document.documentElement, {childList:true, subtree:true});
    var ups=document.getElementById('upsell'); if(ups) mo.observe(ups, {attributes:true, attributeFilter:['class']});
  }catch(e){}
})();
