/* ── Il menu della community «Oltre il Velo» dentro il Cammino ─────────────
   La community apre il Cammino da /app/community: il server rimanda qui con
   ?community=1. Questa scheda del browser se lo ricorda (sessionStorage) e sotto
   al Cammino compare la stessa barra della community, per tornare di là in un tocco.
   Chi apre /app/ normale (o l'app installata) non vede nessun menu.
   ?community=0 lo toglie.
   - SOLO ANNUALI E MENSILI: la barra compare solo se il server risponde menu:true a
     /api/community/menu (cookie di sessione + foglio CRM). Prova gratuita, accesso non
     fatto, errore o rete assente = niente barra (Andrea: dalla prova non si entra in community).
     Si ricontrolla a ogni cambio di vista (accesso, uscita) della shell.
   - La classe sta su <html>: la shell riscrive body.className quando cambia vista.
   - Le sezioni (iframe #dayframe) finiscono sopra la barra: niente resta coperto.
   - Con la guida, la chat o il consiglio della luce aperti la barra si fa da parte. */
(function () {
  var CHIAVE = 'ovl-via-community';
  var attivo = false;
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.has('community')) {
      if (qs.get('community') === '0') sessionStorage.removeItem(CHIAVE);
      else sessionStorage.setItem(CHIAVE, '1');
      qs.delete('community');
      var resto = qs.toString();
      history.replaceState(history.state, '', location.pathname + (resto ? '?' + resto : '') + location.hash);
    }
    attivo = sessionStorage.getItem(CHIAVE) === '1';
  } catch (e) {
    attivo = /[?&]community=1(&|$)/.test(location.search);   /* sessionStorage bloccato: vale almeno questa apertura */
  }
  if (!attivo) return;

  var root = document.documentElement;

  var css =
    'html.ovl-community{--ovl-cn-h:74px;--ovl-cn-tot:calc(var(--ovl-cn-h) + 1px + env(safe-area-inset-bottom, 0px))}' +   /* 1px = il filo sopra la barra */
    '@media (max-width:600px){html.ovl-community{--ovl-cn-h:64px}}' +
    /* spazio in fondo: il sentiero e il piè di pagina restano sopra la barra */
    'html.ovl-community body::after{content:"";display:block;flex:none;height:var(--ovl-cn-tot)}' +
    /* la barra: identica a quella della community */
    '#ovl-cnav{position:fixed;left:0;right:0;bottom:0;z-index:250;display:flex;justify-content:center;align-items:stretch;' +
      'box-sizing:border-box;margin:0;padding:0 clamp(6px,3vw,40px) env(safe-area-inset-bottom, 0px);' +
      'background:linear-gradient(180deg,rgba(18,12,24,.84) 0%,rgba(9,6,13,.97) 100%);' +
      '-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2);' +
      'border-top:1px solid rgba(214,176,106,.2);box-shadow:0 -18px 44px rgba(0,0,0,.35);' +
      "font-family:'Cinzel',Georgia,serif;-webkit-tap-highlight-color:transparent;transition:transform .35s ease}" +
    '#ovl-cnav::before{content:"";position:absolute;top:-1px;left:10%;right:10%;height:1px;' +
      'background:linear-gradient(90deg,transparent,rgba(232,200,138,.85),transparent)}' +
    '#ovl-cnav .ovl-cn-link{position:relative;flex:1 1 0;max-width:200px;min-width:0;box-sizing:border-box;margin:0;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;' +
      'height:74px;padding:10px 4px 12px;text-decoration:none;border:0;background:none;' +
      'color:rgba(214,196,170,.62);font-family:inherit;font-size:10.5px;font-weight:600;letter-spacing:.16em;' +
      'text-transform:uppercase;line-height:1;transition:color .25s ease}' +
    '#ovl-cnav svg{display:block;width:23px;height:23px;flex:none;fill:none;stroke:currentColor;' +
      'transition:transform .3s cubic-bezier(.22,1,.36,1),filter .3s ease}' +
    '#ovl-cnav .ovl-cn-lab{display:block;white-space:nowrap}' +
    '#ovl-cnav .ovl-cn-link:hover{color:#f2e6d2;text-decoration:none}' +
    '#ovl-cnav .ovl-cn-link:hover svg{transform:translateY(-2px)}' +
    '#ovl-cnav .ovl-cn-qui{color:#f6e7c8;text-shadow:0 0 12px rgba(214,176,106,.35)}' +
    '#ovl-cnav .ovl-cn-qui svg{transform:translateY(-2px);filter:drop-shadow(0 0 7px rgba(214,176,106,.8))}' +
    '#ovl-cnav .ovl-cn-qui::after{content:"";position:absolute;bottom:7px;left:50%;transform:translateX(-50%);' +
      'width:28px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#e3c489,transparent);' +
      'box-shadow:0 0 10px rgba(214,176,106,.8)}' +
    '@media (max-width:600px){' +
      '#ovl-cnav{padding-left:2px;padding-right:2px}' +
      '#ovl-cnav .ovl-cn-link{height:64px;gap:5px;padding:8px 2px 10px;font-size:8px;letter-spacing:.06em}' +
      '#ovl-cnav svg{width:21px;height:21px}' +
      '#ovl-cnav .ovl-cn-qui::after{bottom:5px;width:22px}}' +
    '@media (max-width:460px){' +
      '#ovl-cnav .ovl-cn-lab{font-size:0}' +
      '#ovl-cnav .ovl-cn-lab::after{content:attr(data-corto);font-size:8px;letter-spacing:.05em}}' +
    '@media (max-width:380px){#ovl-cnav .ovl-cn-lab::after{letter-spacing:0}}' +   /* 360 px: sei voci senza toccarsi */
    /* guida, chat e consiglio della luce aperti: la barra scende e lascia tutto lo spazio */
    'html.ovl-cn-via #ovl-cnav{transform:translateY(160%);pointer-events:none}' +
    /* le sezioni si aprono sopra la barra, gli avvisi in basso salgono sopra di lei */
    'html.ovl-community #dayframe{height:calc(100% - var(--ovl-cn-tot)) !important}' +
    'html.ovl-community #saved{bottom:calc(18px + var(--ovl-cn-tot))}' +
    'html.ovl-community .ann-fab{bottom:calc(22px + var(--ovl-cn-tot))}' +
    '@media (max-width:760px){html.ovl-community .ann-fab{bottom:calc(20px + var(--ovl-cn-tot))}}' +
    'html.ovl-community #ci-notif-ask{bottom:var(--ovl-cn-tot);padding-bottom:12px;transform:translateY(calc(140% + var(--ovl-cn-tot)))}' +
    'html.ovl-community #ci-notif-ask.show{transform:translateY(0)}' +
    'html.ovl-community #pwa-notif-sheet{bottom:var(--ovl-cn-tot) !important;padding-bottom:12px !important}';

  var st = null;
  function stile() {
    if (st) return;
    st = document.createElement('style');
    st.id = 'ovl-community-css';
    st.textContent = css;
    (document.head || root).appendChild(st);
  }

  var C = 'https://community.elisasoulmedium.com/';
  var ATTR = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var VOCI = [
    { href: C, lab: 'Home', corto: 'Home',
      svg: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>' },
    { href: C + '?apri=registrazioni', lab: 'Registrazioni', corto: 'Serate',
      svg: '<rect x="2.5" y="6" width="14" height="12" rx="2.5"/><path d="m16.5 10 5-3v10l-5-3"/>' },
    { href: C + '?apri=meditazioni', lab: 'Meditazioni', corto: 'Meditazioni',
      svg: '<path d="M12 20c-2.2-2.4-3.3-6.2-2.2-10.4 1 1.4 1.7 3 2.2 4.6.5-1.6 1.2-3.2 2.2-4.6 1.1 4.2 0 8-2.2 10.4Z"/><path d="M12 20c-1.6-3.8-4.6-7-8.2-8 .8 3.6 3.2 6.8 6.4 8.2M12 20c1.6-3.8 4.6-7 8.2-8-.8 3.6-3.2 6.8-6.4 8.2"/><path d="M12 20c-3.4 0-6.6-1.4-8.6-3.6 3-.6 6 .2 8.6 2M12 20c3.4 0 6.6-1.4 8.6-3.6-3-.6-6 .2-8.6 2"/>' },
    { href: C + '?apri=biblioteca', lab: 'Biblioteca', corto: 'Biblioteca',
      svg: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
    { href: C + '?apri=personale', lab: 'Personale', corto: 'Personale',   /* 16/9/26: playlist e appunti di ognuno */
      svg: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.2-6.5 4.2v-16a1 1 0 0 1 1-1z"/><path d="M9.5 9.5h5"/>' },
    { href: '/app/', lab: 'Cammino', corto: 'Cammino', qui: true,
      svg: '<circle cx="12" cy="6.5" r="3.5"/><path d="M5 21c0-5 3.1-8.5 7-8.5s7 3.5 7 8.5"/>' }
  ];

  function tornaAlCammino(e) {
    e.preventDefault();
    var f = document.getElementById('dayframe');
    if (f && f.style.display === 'block' && typeof window.closeDay === 'function') { window.closeDay(); return; }   /* dentro una sezione: si torna al sentiero */
    var login = document.getElementById('login');
    if (login && login.classList.contains('on')) return;
    var dash = document.getElementById('dash');
    if (dash && !dash.classList.contains('on') && typeof window.showView === 'function') { window.showView('dash'); window.scrollTo(0, 0); return; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function osserva(ids, fn) {
    if (!('MutationObserver' in window)) return;
    var mo = new MutationObserver(fn);
    ids.forEach(function (id) { var el = document.getElementById(id); if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  }
  var FINESTRE = ['veil', 'gpan', 'chatpan', 'lkpop'];
  function finestre() {
    var aperta = FINESTRE.some(function (id) { var el = document.getElementById(id); return el && el.classList.contains('on'); });
    root.classList.toggle('ovl-cn-via', aperta);
  }

  var nav = null;
  function monta() {
    if (nav) return;
    stile();
    nav = document.createElement('nav');
    nav.id = 'ovl-cnav';
    nav.setAttribute('aria-label', 'Menu della community');
    nav.innerHTML = VOCI.map(function (v) {
      return '<a class="ovl-cn-link' + (v.qui ? ' ovl-cn-qui' : '') + '" href="' + v.href + '"' +
        (v.qui ? ' aria-current="page" data-ovl-cammino' : '') + '>' +
        '<svg ' + ATTR + '>' + v.svg + '</svg>' +
        '<span class="ovl-cn-lab" data-corto="' + v.corto + '">' + v.lab + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
    nav.querySelector('[data-ovl-cammino]').addEventListener('click', tornaAlCammino);
    root.classList.add('ovl-community');
    finestre();
  }
  function smonta() {
    root.classList.remove('ovl-community');
    if (!nav) return;
    if (nav.parentNode) nav.parentNode.removeChild(nav);
    nav = null;
  }

  /* il permesso lo da' il server, mai il telefono: si chiede a ogni cambio di vista */
  function inAccesso() { var l = document.getElementById('login'); return !!(l && l.classList.contains('on')); }
  var giro = 0, attesa = null;
  function verifica() {
    clearTimeout(attesa);
    attesa = setTimeout(function () {
      if (inAccesso()) { giro++; smonta(); return; }   /* schermata di accesso (o uscita): niente barra */
      var n = ++giro;
      fetch('/api/community/menu', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (n !== giro) return; if (d && d.menu === true && !inAccesso()) monta(); else smonta(); })
        .catch(function () { if (n === giro) smonta(); });
    }, 60);
  }

  function avvia() {
    osserva(FINESTRE, finestre);
    osserva(['login', 'dash'], verifica);
    verifica();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
