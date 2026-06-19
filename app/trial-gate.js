/* Vetrina della PROVA dentro le sezioni (Giornaliero, Mondo Interiore, Bambino).
   Chi è in prova può ENTRARE e VEDERE tutto, ma appena prova a USARE qualcosa
   (riprodurre un video, scrivere un esercizio, premere un pulsante) compare il
   pop-up per entrare in Oltre il Velo. Si attiva SOLO per il livello "trial":
   per i paganti/mensili questo script non fa nulla. La protezione dei contenuti
   (niente ID video) è già fatta lato server (versione stripata). */
(function(){
  var email=''; try{ email=(localStorage.getItem('ovl-user')||'').trim().toLowerCase(); }catch(e){}
  var plan='';  try{ plan=localStorage.getItem('ovl-plan:'+email)||''; }catch(e){}
  if(plan!=='trial') return;   /* solo la prova */

  var s=document.createElement('style');
  s.textContent='#tgComm{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:22px;'+
    'background:rgba(6,4,12,.76);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);font-family:Georgia,serif}'+
    '#tgComm.on{display:flex}'+
    '#tgComm .tgc{position:relative;max-width:380px;width:100%;background:linear-gradient(165deg,#241b37,#140f22);'+
    'border:1px solid rgba(205,178,242,.3);border-radius:22px;padding:28px 22px 22px;text-align:center;color:#e9e4f0;box-shadow:0 24px 70px rgba(0,0,0,.6)}'+
    '#tgComm .tgi{font-size:32px}'+
    '#tgComm h3{font-family:Georgia,serif;color:#dccdf6;font-size:21px;margin:8px 0 8px}'+
    '#tgComm p{color:#bcb3c9;font-size:16.5px;line-height:1.5;margin-bottom:16px}'+
    '#tgComm .tgcta{display:block;text-decoration:none;border-radius:14px;padding:15px;color:#1c1428;font-weight:700;'+
    'font-family:Georgia,serif;background:linear-gradient(135deg,#e8d9ae,#c9a84c);box-shadow:0 8px 24px rgba(201,168,76,.35)}'+
    '#tgComm .tgback{display:block;width:100%;margin-top:10px;background:none;border:1px solid rgba(185,163,227,.4);'+
    'color:#dccdf6;border-radius:12px;padding:11px;cursor:pointer;font-size:15px;font-family:Georgia,serif}'+
    '#tgComm .tgx{position:absolute;top:10px;right:13px;background:none;border:none;color:#bcb3c9;font-size:20px;cursor:pointer}';
  document.head.appendChild(s);

  var v=document.createElement('div'); v.id='tgComm';
  v.innerHTML='<div class="tgc">'+
    '<button class="tgx" type="button" aria-label="Chiudi">✕</button>'+
    '<div class="tgi">💓</div>'+
    '<h3>Questo è dentro Oltre il Velo</h3>'+
    '<p>Nella prova puoi <b>vedere tutto</b>, ma per <b>viverlo</b> — guardare i video, fare gli esercizi — ti aspetto dentro la community, dove camminiamo insieme.</p>'+
    '<a class="tgcta" href="https://www.elisasoulmedium.com/oltreilvelo" target="_blank" rel="noopener">Entra in Oltre il Velo →</a>'+
    '<button class="tgback" type="button">← Torna al Cammino</button>'+
    '</div>';
  document.body.appendChild(v);

  function show(){ v.classList.add('on'); }
  function hide(){ v.classList.remove('on'); }
  v.querySelector('.tgx').addEventListener('click', function(e){ e.stopPropagation(); hide(); });
  v.querySelector('.tgback').addEventListener('click', function(e){ e.stopPropagation(); try{ parent.postMessage({t:'day:back'}, location.origin); }catch(err){} hide(); });

  /* ogni clic (tranne dentro al pop-up) apre il pop-up: vedono tutto, ma non possono "usare" */
  document.addEventListener('click', function(e){ if(v.contains(e.target)) return; e.preventDefault(); e.stopPropagation(); show(); }, true);
  /* niente scrittura negli esercizi */
  document.addEventListener('focusin', function(e){ if(v.contains(e.target)) return; var t=e.target; if(t && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable)){ try{t.blur();}catch(x){} show(); } }, true);
})();
