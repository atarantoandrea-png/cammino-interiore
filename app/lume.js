/* ================================================================
   OVL_LUME — la logica condivisa della Luce e del progresso.
   Regole che NON devono mai divergere tra le pagine dell'app:
   livelli fiore, conteggio dei giorni di pratica, lettura dello
   store per account (locale + nuvola, SOLA LETTURA: qui non si
   scrive mai un dato di pratica — il push resta alle pagine
   esercizio). Usato da /app/; /app/day/ tiene per ora la sua
   copia inline.
   ================================================================ */
window.OVL_LUME=(function(){

  /* ---- il Sentiero della Luce: la luce fiorisce coi giorni di pratica ---- */
  var TIERS=[
    {d:0,  cls:'',    nome:'Margherita',    art:'una ', col:'#e8924a'},
    {d:3,  cls:'lt1', nome:'Bucaneve',      art:'un ',  col:'#a8c8e0'},
    {d:10, cls:'lt2', nome:'Stella Alpina', art:'una ', col:'#f0c840'},
    {d:25, cls:'lt3', nome:'Ortensia',      art:'un\'', col:'#b9ddf6'},
    {d:50, cls:'lt4', nome:'Fiordaliso',    art:'un ',  col:'#a7b6ef'},
    {d:90, cls:'lt5', nome:'Viola',         art:'una ', col:'#ad7ff0'},
    {d:150,cls:'lt6', nome:'Glicine',       art:'un ',  col:'#cdb2f2'}
  ];
  function tierIndex(days){
    var i=0; TIERS.forEach(function(t,k){ if(days>=t.d)i=k; }); return i;
  }
  function applyTier(days){
    var i=tierIndex(days);
    if(document.body.className!==TIERS[i].cls)document.body.className=TIERS[i].cls;
    return i;
  }

  /* ---- date ---- */
  function todayIso(){
    var d=new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function isoAdd(isoDay,delta){
    var p=isoDay.split('-');
    var d=new Date(+p[0],+p[1]-1,+p[2]+delta);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  /* ---- store per account (stesse chiavi del Giornaliero) ---- */
  function keyFor(email){ return 'ovl-strumenti:'+email; }
  function loadLocal(email){
    var store=null, meta=null;
    try{
      store=JSON.parse(localStorage.getItem(keyFor(email))||'null');
      meta=JSON.parse(localStorage.getItem(keyFor(email)+':meta')||'null');
    }catch(e){}
    /* niente migrazione legacy qui: è responsabilità di /app/day/ */
    return { store:store||{}, meta:meta||{} };
  }
  function saveLocal(email,store,meta){
    try{
      localStorage.setItem(keyFor(email), JSON.stringify(store));
      localStorage.setItem(keyFor(email)+':meta', JSON.stringify(meta));
    }catch(e){}
  }
  /* merge per chiave: vince il timestamp più recente (come nel Giornaliero) */
  function mergeIn(store,meta,remote){
    if(!remote||typeof remote.data!=='object'||!remote.data)return false;
    var changed=false;
    var rmeta=remote.meta||{};
    for(var k in remote.data){
      var tR=+rmeta[k]||0, tL=+meta[k]||0;
      if(tR>tL){ store[k]=remote.data[k]; meta[k]=tR; changed=true; }
    }
    return changed;
  }
  /* SOLA LETTURA dalla nuvola: nessun PUT, nessun sendBeacon */
  function pullStore(email,store,meta,then){
    if(!email){ if(then)then(false); return; }
    fetch('/api/store?email='+encodeURIComponent(email))
      .then(function(r){ if(!r.ok)throw 0; return r.json(); })
      .then(function(remote){
        var changed=mergeIn(store,meta,remote);
        if(changed)saveLocal(email,store,meta);
        if(then)then(changed);
      })
      .catch(function(){ if(then)then(false); });
  }

  /* ---- progresso (stesse regole del Resoconto del Giornaliero) ---- */
  function allActiveDays(store){
    var set={};
    for(var k in store){
      var v=store[k]; if(v===''||v===false||v===undefined||v===null)continue;
      var m=k.match(/^s[12]:(\d{4}-\d{2}-\d{2}):/) || k.match(/^cal-(\d{4}-\d{2}-\d{2})-(s1|s2|mood|kw)/);
      if(m)set[m[1]]=true;
    }
    return Object.keys(set);
  }
  function countSessions(store,s){
    var set={};
    for(var k in store){
      var v=store[k]; if(!v||!String(v).trim())continue;
      var m=k.match(new RegExp('^'+s+':(\\d{4}-\\d{2}-\\d{2}):'));
      if(m)set[m[1]]=true;
    }
    for(var k2 in store){
      var m2=k2.match(/^cal-(\d{4}-\d{2}-\d{2})-(s1|s2)$/);
      if(m2&&m2[2]===s&&store[k2])set[m2[1]]=true;
    }
    return Object.keys(set).length;
  }
  function streakFromDays(daysArr){
    var set={}; daysArr.forEach(function(d){ set[d]=true; });
    var n=0, d=todayIso();
    if(!set[d])d=isoAdd(d,-1);      /* oggi non ancora fatto: parti da ieri */
    while(set[d]){ n++; d=isoAdd(d,-1); }
    return n;
  }

  return {
    TIERS:TIERS, tierIndex:tierIndex, applyTier:applyTier,
    todayIso:todayIso, isoAdd:isoAdd,
    loadLocal:loadLocal, saveLocal:saveLocal, mergeIn:mergeIn, pullStore:pullStore,
    allActiveDays:allActiveDays, countSessions:countSessions, streakFromDays:streakFromDays
  };
})();
