/* ================================================================
   OVL_ELISA — la chat "Scrivi a Elisa" della dashboard.
   Risposte CURATE di Elisa (FAQ profonda) servite in locale, senza
   chiave e senza costi: porting fedele della logica del software
   Elisa-Know (stemmer italiano + gate su parole forti + soglia).
   Fonte delle voci: Elisa app/Elisa-know/_software/qa_bank.json.

   QUANDO IL SERVER "ELISA KNOW" SU COOLIFY SARÀ PRONTO:
   impostare REMOTE all'endpoint di chat (es. 'https://know.../api/chat').
   Le voci locali restano come riserva se la rete manca.
   ================================================================ */
window.OVL_ELISA=(function(){

  var REMOTE='';            /* endpoint del server conoscenza (vuoto = solo locale) */
  var REMOTE_TIMEOUT=6000;

  /* ---------- sicurezza: il guardrail viene SEMPRE prima di tutto ---------- */
  var CRISIS=/suicid|uccider|ammazzar|farla finita|togliermi la vita|non voglio (pi[uù] )?vivere|voglio morire|non ce la faccio pi[uù]|eutanasia|autoles|farmi del male/i;
  var CRISIS_MSG="Mi fermo un momento 💛 Da quello che scrivi potresti stare attraversando un dolore molto grande, e la cosa più importante adesso sei tu. Questo strumento non può sostituire l'aiuto di cui avresti bisogno in un momento così. Per favore parlane subito con qualcuno: in Italia puoi chiamare il 112 (emergenze), Telefono Amico Italia 02 2327 2327, o cercare il Servizio per la prevenzione del suicidio della tua zona. Non sei solo/a, e chiedere aiuto è un atto di coraggio.";

  /* ---------- la voce: saluto solo al primo messaggio ---------- */
  var GREET=["Ciao 💓","Allora, ti dico come la vedo.","Ti rispondo volentieri."];
  var GREET_GRIEF=["Ciao, ti mando intanto un abbraccio forte 💓.","Ti mando prima di tutto un abbraccio forte 💓."];
  var GRIEF_WORDS=["colpa","lutto","perso","perdut","mancat","dolore","piang","soffr","addio","mi sento sol","non ero present","non c'ero","disperat","ansia","paura","depress","vuoto"];
  function pick(pool,seed){ return pool[seed%pool.length]; }
  function withOpening(body,question,history){
    var i; for(i=0;i<(history||[]).length;i++){ if(history[i].role==='bot')return body; }
    var ql=(question||'').toLowerCase(), seed=0, c;
    for(c=0;c<ql.length;c++)seed+=ql.charCodeAt(c);
    var grief=false; for(i=0;i<GRIEF_WORDS.length;i++){ if(ql.indexOf(GRIEF_WORDS[i])>=0){grief=true;break;} }
    return (grief?pick(GREET_GRIEF,seed):pick(GREET,seed))+"\n\n"+body;
  }

  /* ---------- aggancio domanda → voce curata (stemming italiano) ---------- */
  var STOP={};
  ("come cosa dopo prima secondo della dello delle degli dell per con che chi quando dove cui sono essere stato elisa piu meno una uno due gli del dei nel nella alla allo agli sul sui sulla quale quali questo questa questi queste loro miei mia mio noi voi cose tutto tutti molto anche quindi perche poi gia ecco fare farsi "+
   "presente andare faccio riesco avanti vorrei voglio posso deve dovrei ancora sempre adesso niente qualcosa qualcuno proprio davvero magari invece senza dentro stesso stessa cioe allora insomma").split(" ").forEach(function(w){ STOP[w]=1; });
  var SYN={"lutto":["dolore","perdita","perdere","caro","morte","mancanza"],"colpa":["perdono","perdonare","rimorso","colpe","colpevole"],
    "morte":["morire","morto","trapasso","aldila","aldilà","defunto"],"morire":["morte","trapasso"],"segni":["segno","sogni","sogno","farfalle","profumo"],
    "sogni":["sogno","segni","onirico"],"reincarnazione":["reincarnarsi","vite","karma","rinascita"],"karma":["reincarnazione","debito","vite"],
    "paura":["ansia","timore","paure"],"medium":["medianita","medianità","sensitiva","tramite"],"medianita":["medium","sensitiva","tramite"],
    "consulto":["consulti","seduta","canalizzazione"],"energia":["frequenza","vibrazione","energetico"],"malattia":["malattie","malato","salute"],
    "spirito":["spiriti","anima","anime"],"perdono":["colpa","perdonare"],"depressione":["tristezza","sofferenza","buio"]};
  var SUF=["issimo","issima","amento","azione","zione","mente","eranno","iranno","arono","erono","irono","ando","endo","iamo","iate","arsi","ersi","irsi","are","ere","ire","ato","ata","ati","ate","ito","ita","iti","ite","uto","uta","uti","ute","ono","ano","amo","ete","ità","ore","ori","oso","osa","osi","ose","ico","ica","ici","che","i","e","a","o","ò","à"];
  function stem(w){
    w=(w||'').toLowerCase();
    w=w.replace(/(a|e|i)r(mi|ti|ci|vi|si|lo|la|li|le|ne|gli)$/, '$1re');   /* parlarle -> parlare */
    for(var k=0;k<SUF.length;k++){
      var s=SUF[k];
      if(w.length>s.length+2 && w.slice(-s.length)===s)return w.slice(0,-s.length);
    }
    return w;
  }
  function stems(words){
    var out={};
    (words||[]).forEach(function(w){ if(w&&w.length>2)out[stem(w)]=1; });
    return out;
  }
  function contentWords(text){
    var m=(text||'').toLowerCase().match(/[a-zàèéìòù]+/g)||[];
    return m.filter(function(w){ return w.length>2 && !STOP[w]; });
  }
  function kw(query){
    var m=(query||'').toLowerCase().match(/[a-zàèéìòù]+/g)||[];
    var out=[];
    m.forEach(function(t){ if(t.length>3&&!STOP[t]&&out.indexOf(t)<0)out.push(t); });
    return out.slice(0,8);
  }
  function expand(terms){
    var out=terms.slice();
    terms.forEach(function(t){ (SYN[t]||[]).forEach(function(s){ if(out.indexOf(s)<0)out.push(s); }); });
    return out.slice(0,16);
  }
  function merge(a,b){ var o={},k; for(k in a)o[k]=1; for(k in b)o[k]=1; return o; }
  function overlap(a,b){ var n=0,k; for(k in a){ if(b[k])n++; } return n; }

  var QA_THRESHOLD=2;
  function prepara(){
    BANK.forEach(function(e){
      e._terms=merge(stems(contentWords(e.domande.join(" "))), stems(e.keys));
      e._gate=stems(e.keys);
    });
  }
  function qaMatch(question){
    var us=merge(stems(contentWords(question)), stems(expand(kw(question))));
    var any=false,k; for(k in us){any=true;break;}
    if(!any)return null;
    var best=null,bestsc=0;
    BANK.forEach(function(e){
      if(!overlap(us,e._gate))return;          /* nessuna parola-chiave forte -> salta */
      var sc=overlap(us,e._terms);
      if(sc>bestsc){bestsc=sc;best=e;}
    });
    return (best&&bestsc>=QA_THRESHOLD)?best:null;
  }

  /* ---------- risposta ---------- */
  var FALLBACK="Su questo non ho ancora una risposta pronta qui 🙏🏻 Questo spazio sta crescendo piano piano, domanda dopo domanda. Prova a chiedermelo con parole diverse, oppure parti da una delle domande che vedi all'inizio — e torna a trovarmi: col tempo arrivano risposte nuove.";
  function localAnswer(question,history){
    question=(question||'').trim();
    if(!question)return {answer:"Scrivimi pure quello che hai nel cuore 💓",mode:"empty"};
    if(CRISIS.test(question))return {answer:CRISIS_MSG,mode:"safety"};
    /* se la domanda è cortissima, agganciala insieme al messaggio precedente */
    var lastUser=''; (history||[]).forEach(function(m){ if(m.role==='user'&&m.text!==question)lastUser=m.text||''; });
    var rq=(question.split(/\s+/).length>4||!lastUser)?question:(lastUser+" "+question);
    var hit=qaMatch(rq);
    if(hit)return {answer:withOpening(hit.risposta,question,history),mode:"faq",tema:hit.tema};
    return {answer:FALLBACK,mode:"empty"};
  }
  function rispondi(question,history,cb){
    /* la sicurezza non dipende mai dalla rete */
    if(CRISIS.test(question||'')){ cb({answer:CRISIS_MSG,mode:"safety"}); return; }
    if(!REMOTE){ cb(localAnswer(question,history)); return; }
    var done=false;
    var t=setTimeout(function(){ if(!done){done=true;cb(localAnswer(question,history));} },REMOTE_TIMEOUT);
    fetch(REMOTE,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question:question,history:history||[]})})
      .then(function(r){ if(!r.ok)throw 0; return r.json(); })
      .then(function(j){ if(!done){done=true;clearTimeout(t);cb(j&&j.answer?j:localAnswer(question,history));} })
      ['catch'](function(){ if(!done){done=true;clearTimeout(t);cb(localAnswer(question,history));} });
  }

  /* ---------- suggerimenti mostrati come domande pronte ---------- */
  var CHIPS=[
    {id:"colpa_lutto",     label:"Mi sento in colpa per chi ho perso",  q:"Mi sento in colpa per come è andata con il mio caro che non c'è più"},
    {id:"dopo_morte",      label:"Cosa c'è dopo la morte?",             q:"Cosa succede dopo la morte? Dove vanno i nostri cari?"},
    {id:"rivedro_contatto",label:"Rivedrò il mio caro? Posso parlargli?",q:"Rivedrò il mio caro che non c'è più? Posso ancora comunicare con lui?"},
    {id:"segni_sogni",     label:"Segni e sogni: sono davvero loro?",   q:"Come riconosco i segni dei miei cari? E i sogni in cui li vedo sono reali?"},
    {id:"sensibilita",     label:"Anch'io sento delle cose…",           q:"Anch'io sento delle cose, credo di essere sensibile: come capisco se è reale?"},
    {id:"consulto",        label:"Come funziona un consulto?",          q:"È giusto fare un consulto medianico? Come funziona e quando ha senso?"}
  ];

  /* ---------- LE VOCI CURATE (specchio di qa_bank.json — 6 canoniche) ---------- */
  var BANK=[
    {id:"colpa_lutto",tema:"Lutto & sensi di colpa",
     domande:["Mi sento in colpa per come è andata, per non essere stato presente quando il mio caro è morto. Ce l'ha con me?","Non ero presente quando è morto, non me lo perdono","La mattina che è morto avevamo litigato, è arrabbiato con me?","Mi sento in colpa per la morte di una persona cara","Come faccio a perdonarmi per quello che è successo"],
     keys:["colpa","perdono","perdonarmi","lutto","rimorso","litigato","presente"],
     risposta:"Il senso di colpa, nel lutto, è quasi sempre il primo a presentarsi: «non c'ero», «potevo fare di più», «l'ultima volta abbiamo litigato». Voglio dirti una cosa che ho visto tante volte: i nostri cari, da dove sono ora, non ci incolpano. Mai. Quel rimprovero che senti è tuo, nasce dall'amore e dal dispiacere — non da loro.\n\nSe ti aiuta, prova un piccolo esercizio: immagina di essere tu, dall'altra parte. Guarderesti la persona che ami con rancore per un momento in cui non eri nella stanza, o per una frase detta male in un giorno difficile? O la guarderesti con tenerezza, sapendo quanto bene le hai voluto? Ecco: è così che ti guarda lui.\n\nIl dolore di non aver «fatto in tempo» non te lo posso togliere, e non sarebbe nemmeno giusto dirti di non sentirlo. Ma può trasformarsi. Andare avanti non vuol dire dimenticare: l'amore che c'era non sparisce, gli dai solo una forma nuova. E puoi parlargli, sai? Anche adesso, ad alta voce o nel silenzio: a loro arriva tutto. Digli quello che non hai fatto in tempo a dire.\n\nUn'ultima cosa, col cuore: se questo peso ti toglie il sonno, ti chiude lo stomaco, ti accompagna ogni giorno, non tenerlo solo per te. A volte una mano professionale — qualcuno che ti aiuti a portarlo — fa davvero la differenza. Non sei in gara: datti il tempo che serve."},
    {id:"dopo_morte",tema:"Aldilà: cos'è",
     domande:["Cosa succede dopo la morte? Dove vanno i nostri cari quando muoiono?","Cosa c'è dopo la morte","Dove va l'anima dopo la morte","Cosa accade quando si muore","Dove si va e dove finiamo quando si muore","Esiste l'aldilà, com'è fatto"],
     keys:["morte","morire","muore","muoiono","aldilà","defunti","anima","trapasso"],
     risposta:"È la domanda delle domande, e ti rispondo con sincerità: non con una mappa precisa, perché sarebbe disonesto promettertela. Quello che sento, e che vivo nel mio lavoro, è che con la morte l'amore non finisce. Il corpo si spegne, ma ciò che siamo davvero continua.\n\nA me piace dire che l'aldilà è uno specchio: non un tribunale, non un luogo di condanna eterna. È piuttosto un riflesso di ciò che siamo stati e di come abbiamo amato. E non è qualcosa di fermo — è in continuo cambiamento, in evoluzione. I nostri cari, quando se ne vanno, non «spariscono» in un posto lontano: cambiano forma, e i legami autentici restano.\n\nNon tutti vivono questo passaggio allo stesso modo: dipende dal cammino di ciascuno, da ciò che ci si porta dietro, dai «cerchi» rimasti aperti. Ma la direzione, per chi ha amato, è verso la luce.\n\nCapisco che dietro questa domanda spesso ce n'è un'altra, più personale: «la persona che ho perso, sta bene?». Se è così, dimmelo pure, e ne parliamo. E se vuoi andare davvero a fondo, è proprio il cuore di quello che ho cercato di mettere nel mio libro, La Vita Oltre il Velo."},
    {id:"rivedro_contatto",tema:"Aldilà & relazioni",
     domande:["Rivedrò il mio caro che non c'è più? Posso ancora comunicare con lui?","Rivedrò i miei cari dopo la morte","Posso comunicare con chi non c'è più","Come faccio a parlare con una persona morta","Riuscirò a riabbracciare i miei cari","Ci ricongiungeremo ai nostri cari"],
     keys:["rivedrò","rivedere","riabbracciare","abbracciare","comunicare","contatto","ricongiungere","comunicazione"],
     risposta:"Sì. Rivedere i nostri cari, ricongiungerci a loro, per me è una certezza — quello è un sì. La vera domanda, semmai, non è «se» li rivedremo, ma se potremo davvero stare con loro: e quello dipende dal cammino di ciascuno, da come abbiamo vissuto e amato.\n\nQuanto al comunicare, qui voglio essere onesta con te. Io faccio la medium, ma non voglio illuderti: il contatto vero non passa soltanto da una persona come me. Passa da te. Loro ci sono, e a loro arriva tutto quello che provi: puoi parlargli, raccontargli la tua giornata, dirgli ciò che ti è rimasto in gola. Non serve una formula.\n\nSpesso mi chiedono dei segni — una farfalla, un profumo, una canzone che torna. Non posso dirti con certezza «era lui»: non sarebbe onesto. Ma posso dirti che ciò che conta è quello che senti dentro. Se un segno ti fa stare un po' meglio, accoglilo: è un dono.\n\nE ricordati una cosa importante: a loro, dall'altra parte, sta a cuore soprattutto che noi stiamo bene, che non ci consumiamo nel dolore per la loro mancanza. Onorarli non vuol dire restare fermi nella sofferenza: vuol dire trasformare quell'amore e portarlo avanti nella vita."},
    {id:"consulto",tema:"Operativo & consulti",
     domande:["È giusto fare un consulto medianico? Come funziona e quando ha senso farlo?","Vorrei prenotare un consulto con te, come si fa?","Come funziona un consulto","Quando ha senso fare un consulto","È giusto cercare risposte da chi non c'è più"],
     keys:["consulto","consulti","medianico","prenotare","seduta","canalizzazione"],
     risposta:"Ti rispondo con franchezza, perché ci tengo. «Giusto o sbagliato» non è il metro con cui la guardo. Un consulto va sentito, non è un obbligo — e se una persona può farne a meno, a volte è perfino meglio così. Lo ripeto da sempre: ha senso solo se c'è davvero un «cerchio rimasto aperto», qualcosa da chiudere. Mai per curiosità.\n\nPerché un consulto non è una magia che cancella il dolore. È un ponte: un momento di ascolto, di rispetto e di verità, che può aprire una porta — ma poi il cammino resta tuo, e quello nessuno può percorrerlo al posto tuo.\n\nCome funziona, in concreto? È una connessione: mi metto in ascolto e lascio che siano loro, i tuoi cari, a portare ciò che hanno bisogno di dirti. Non è uno spettacolo, e non prometto «prove» a comando: ti dico sempre con onestà che non posso dimostrare scientificamente quello che faccio, e sarei disonesta a sostenere il contrario.\n\nUn'ultima cosa, col cuore: in questo periodo i consulti sono di fatto fermi, con una lista d'attesa lunghissima. Per questo ho messo tanto nei contenuti e nel libro — spesso spero siano loro, più che altro, ad accompagnarti. E ricorda che gran parte del «contatto» non ha bisogno di me: parlare ai tuoi cari puoi farlo tu, ogni giorno."},
    {id:"segni_sogni",tema:"Segni & sogni",
     domande:["Come riconosco i segni dei miei cari defunti? E i sogni in cui li vedo sono reali contatti?","Come capisco se un segno viene da chi non c'è più","Ho sognato il mio caro defunto, era davvero lui?","I sogni con i defunti sono reali","Ho sognato un mio caro defunto, è un messaggio reale?","Le farfalle e i profumi sono segni dei defunti"],
     keys:["segni","segno","sogni","sogno","sognato","sognare","messaggio","farfalla","farfalle","profumo"],
     risposta:"I segni e i sogni sono tra le cose che mi chiedete più spesso, e li capisco bene: nascono dal bisogno di sentire che chi amiamo è ancora lì.\n\nComincio dall'onestà: io non posso dirti con certezza «quella farfalla era lui», «quel profumo era lei». Non sarebbe corretto. Quello che posso dirti è che il segno più vero non è fuori, ma dentro: è ciò che senti tu quando accade. Se un dettaglio — una canzone che torna, un numero, un animale che si ferma vicino — ti scalda il cuore e ti fa sentire vicino chi hai perso, accoglilo come un dono, senza bisogno di «prove».\n\nI sogni sono un discorso a parte. Ci sono i sogni che sono solo elaborazione nostra, del nostro dolore; e poi ci sono i sogni reali, i veri contatti. Di solito questi ultimi si riconoscono perché sono nitidi, restano impressi a lungo, lasciano una sensazione di pace più che di angoscia, e spesso portano un messaggio semplice. Distinguere gli uni dagli altri l'ho spiegato per bene nel libro e nelle mail di approfondimento, perché in poche righe rischierei di banalizzarlo.\n\nIl mio consiglio, intanto, è questo: non andare a caccia di segni con ansia. Vivi, parla ai tuoi cari, e lascia che siano loro a trovare il modo. Spesso arrivano proprio quando smettiamo di pretenderli."},
    {id:"sensibilita",tema:"Sensibilità & percorso",
     domande:["Anch'io sento delle cose, credo di essere sensibile: come capisco se è reale e come la sviluppo?","Come capisco se sono sensitivo o medium","Come si sviluppa la sensibilità","Anche io percepisco delle presenze, è normale?","Ho un dono come il tuo, come faccio a coltivarlo"],
     keys:["sensibile","sensibilità","sensitivo","sensitiva","percepisco","percepire","presenze","sviluppare","dono"],
     risposta:"Mi fa piacere che me lo chiedi, e parto da una cosa che ripeto spesso: il «sentire» non è un dono per pochi. È un'intuizione che appartiene a ogni persona — quella voce interiore che riconosce ciò che è autentico, ciò che è in sintonia con noi. La differenza è che crescendo, tra razionalità e abitudini sociali, tendiamo a chiudere quei canali. La domanda vera, allora, non è «sono speciale?», ma «perché, come esseri umani, abbiamo smesso di sentire?».\n\nCome capire se ciò che provi è reale? Qui ti invito alla prudenza, non all'eccitazione. Il primo passo non è cercare fenomeni o conferme, ma imparare a conoscerti davvero — la tua parte luminosa e anche la tua ombra. La medianità, prima ancora che «sentire i defunti», è un lavoro su di sé: sulle proprie emozioni, sui legami, sulle ferite. È un cammino lungo, di tutta una vita, non un interruttore che si accende.\n\nDiffida di chi ti promette poteri facili o scorciatoie. La sensibilità autentica si coltiva con calma — con il silenzio, la meditazione, l'ascolto — e va trattata con rispetto e responsabilità, mai con sensazionalismo.\n\nSe è qualcosa che senti tuo, coltivalo senza fretta e senza paura. E se ti capita di percepire cose che ti spaventano o ti pesano, non isolarti: parlane con qualcuno di fidato. Non sei in gara, e non sei solo in questo."}
  ];

  prepara();
  return { rispondi:rispondi, CHIPS:CHIPS, count:BANK.length };
})();
