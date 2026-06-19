/* Vetrina della PROVA dentro le sezioni (Giornaliero, Mondo Interiore, Bambino).
   La prova ENTRA, NAVIGA e VEDE tutto liberamente (freccia indietro, menu in alto, card,
   sfogliare, scorrere). Il pop-up "Entra in Oltre il Velo" compare SOLO quando prova a
   USARE un contenuto premium: riprodurre un video o aprire/scrivere un esercizio.
   I video delle pratiche del Giornaliero sono mostrati come COPERTINA bloccata (come nel
   Mondo Interiore). Sostituisce anche l'upsell "annuale" del trailer con quello community.
   ⚠️ Si attiva SOLO per il livello "trial": per i paganti/mensili NON fa nulla (app ufficiale intatta). */
(function(){
  var email=''; try{ email=(localStorage.getItem('ovl-user')||'').trim().toLowerCase(); }catch(e){}
  var plan='';  try{ plan=localStorage.getItem('ovl-plan:'+email)||''; }catch(e){}
  if(plan!=='trial') return;   /* SOLO la prova */

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
    '#tgComm .tgx{position:absolute;top:10px;right:13px;background:none;border:none;color:#bcb3c9;font-size:20px;cursor:pointer}'+
    /* copertina bloccata dei video del Giornaliero */
    '.tgcover{position:absolute;inset:0;background:#0c0913 center/cover no-repeat;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;cursor:pointer}'+
    '.tgcover::before{content:"";position:absolute;inset:0;background:linear-gradient(rgba(12,9,19,.5),rgba(12,9,19,.72))}'+
    '.tgcover>*{position:relative;z-index:1}'+
    '.tgcover .tglk{font-size:22px;filter:drop-shadow(0 0 8px rgba(224,85,102,.5))}'+
    '.tgcover .tgpl{width:58px;height:58px;border-radius:50%;border:1px solid rgba(220,205,246,.6);background:rgba(20,15,30,.55);color:#dccdf6;display:flex;align-items:center;justify-content:center}'+
    '.tgcover .tgpl svg{width:24px;height:24px}'+
    '.tgcover .tgcap{font-family:Georgia,serif;color:#e8d9ae;font-size:14px;letter-spacing:.03em;text-align:center;padding:0 16px}';
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

  /* NAVIGAZIONE sempre libera: menu in alto, card della home, freccia indietro, settimane, luce, musica, guida */
  var FREE='#back-fab,#back-btn,nav.tabs,.tabs,.tab,.pcard,.wnav-btn,#lume,.mu-mini,.mu-mini *,.gp-orb,#gpan,#gpan *';
  /* contenuto PREMIUM: al clic → pop-up (video, copertine, esercizi, pulsanti azione) */
  var BLOCK='.dvideo,.dvframe,.tgcover,.vframe,.excover,.segna,.llock,.llock-play,.lcover,.vcard,.vcover,input,textarea,select,[contenteditable="true"]';
  function within(t, sel){ return t && t.closest && t.closest(sel); }

  document.addEventListener('focusin', function(e){ if(v.contains(e.target)) return;
    var t=e.target; if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)){ try{t.blur();}catch(x){} show(); } }, true);
  document.addEventListener('click', function(e){
    if(v.contains(e.target)) return;
    if(within(e.target, FREE)) return;                 /* navigazione: libera */
    if(within(e.target, BLOCK)){ e.preventDefault(); e.stopPropagation(); show(); }
  }, true);

  /* Giornaliero: mostro la COPERTINA bloccata dei video (Osservatore=s2, Spazio Emotivo=s1) */
  [].forEach.call(document.querySelectorAll('.dvframe'), function(fr){
    var m=(fr.id||'').match(/^(s\d)-vframe$/); if(!m) return;
    fr.innerHTML='<div class="tgcover" style="background-image:url(\'/api/cover?s=day&k='+m[1]+'\')">'+
      '<div class="tglk">🔒</div>'+
      '<button class="tgpl" type="button" aria-label="Anteprima"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>'+
      '<div class="tgcap">Anteprima — entra in Oltre il Velo per guardarlo</div></div>';
  });

  /* RIPRODUZIONE video → pop-up; e sostituzione upsell annuale del trailer con community */
  function killVimeo(node){
    var ifr=(node.tagName==='IFRAME' && /vimeo/.test(node.src||'')) ? node : (node.querySelector?node.querySelector('iframe[src*="vimeo"]'):null);
    if(ifr){ try{ ifr.remove(); }catch(x){} show(); return true; } return false;
  }
  function killUpsell(){ var u=document.getElementById('upsell'); if(u && u.classList.contains('on')){ u.classList.remove('on'); show(); return true; } return false; }
  try{
    [].forEach.call(document.querySelectorAll('iframe[src*="vimeo"]'), function(f){ try{ f.remove(); }catch(x){} });
    var mo=new MutationObserver(function(muts){ muts.forEach(function(m){
      if(m.type==='attributes'){ killUpsell(); return; }
      for(var i=0;i<m.addedNodes.length;i++){ var n=m.addedNodes[i]; if(n.nodeType===1) killVimeo(n); }
    }); });
    mo.observe(document.documentElement, {childList:true, subtree:true});
    var ups=document.getElementById('upsell'); if(ups) mo.observe(ups, {attributes:true, attributeFilter:['class']});
  }catch(e){}
})();
