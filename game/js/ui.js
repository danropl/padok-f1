// WORLD GP — ekrany: menu, szybki wyścig, weekend, wyniki, kariera, kreator, ustawienia.
(function (PG) {
  'use strict';
  var UI = PG.UI = {};
  var G = PG.Game, Store = PG.Store, C = PG.Career;
  var root;

  // ---------- pomocnicze ----------
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  UI.h = h;
  // Sprzątanie zasobów ekranu (np. podglądów 3D z własnym WebGL) przy zmianie ekranu
  var cleanups = [];
  UI.onLeave = function (fn) { cleanups.push(fn); };
  function runCleanups() { var c = cleanups; cleanups = []; c.forEach(function (fn) { try { fn(); } catch (e) { /* nic */ } }); }
  function screen(id, cls) { runCleanups(); root.innerHTML = ''; var s = h('div', { class: 'screen ' + (cls || 'solid'), id: id }); root.appendChild(s); return s; }
  function money(v) { return Math.round(v).toLocaleString('pl-PL') + ' tys. €'; }
  function flag(code, scale) { var c = h('canvas', { class: 'flag', style: 'vertical-align:middle' }); PG.drawFlag(c, code, scale || 2); return c; }
  function helmet(hm, scale) { var c = h('canvas', { class: 'helm' }); PG.drawHelmet(c, hm, scale || 3); return c; }
  // Bolid: duże podglądy jako zdjęcie modelu 3D (jeśli jest WebGL), małe ikony z góry wektorowo
  var snapCache = new Map();
  function carImg(lv, hm, scale) {
    if ((scale || 3) >= 5 && G.use3D && PG.Car3D && PG.Car3D.snapshot) {
      var W3 = Math.round(30 * scale), H3 = Math.round(W3 * 0.5), dpr3 = Math.min(2, window.devicePixelRatio || 1);
      var key = JSON.stringify(lv) + '|' + JSON.stringify(hm || {}) + '|' + W3;
      var src = snapCache.get(key);
      if (!src) {
        try { src = PG.Car3D.snapshot(lv, hm, { w: Math.round(W3 * dpr3), h: Math.round(H3 * dpr3), compound: '#f2f2f2' }); } catch (e) { src = null; }
        if (src) { if (snapCache.size > 40) snapCache.clear(); snapCache.set(key, src); }
      }
      if (src) {
        var c3 = h('canvas', { class: 'carimg car3d', role: 'img', 'aria-label': 'Bolid' });
        c3.width = src.width; c3.height = src.height; c3.style.width = W3 + 'px'; c3.style.height = H3 + 'px';
        c3.getContext('2d').drawImage(src, 0, 0);
        return c3;
      }
    }
    return carImg2d(lv, hm, scale);
  }
  UI.clearSnapshots = function () { snapCache.clear(); };
  // Interaktywny podgląd 3D (obracany), a bez WebGL obrazek
  function carView(lv, hm) {
    if (!(G.use3D && PG.Car3D && PG.Car3D.Showroom)) return carImg(lv, hm, 6);
    var box = h('div', { class: 'showroom', role: 'img', 'aria-label': 'Bolid 3D, przeciągnij, aby obrócić' });
    requestAnimationFrame(function () {
      if (!box.isConnected) return;
      try {
        var sr = new PG.Car3D.Showroom(box, {});
        sr.setCar(lv, hm, { compound: '#f2f2f2' });
        UI.onLeave(function () { sr.dispose(); });
      } catch (e) { box.replaceWith(carImg2d(lv, hm, 6)); }
    });
    return box;
  }
  // Bolid z góry, wektorowo; scale ~ szerokość w CSS px = 30 * scale
  function carImg2d(lv, hm, scale) {
    var c = h('canvas', { class: 'carimg' }), dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.round(30 * (scale || 3)), H = Math.round(W * 2.3 / 6);
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
    var g = c.getContext('2d'), k = W * dpr / 6.1;
    g.translate(c.width / 2, c.height / 2); g.scale(k, k);
    PG.drawCarShape(g, lv, hm, { compound: '#e8e8e8' });
    return c;
  }
  function seg(options, value, onPick) {
    var wrap = h('div', { class: 'seg', role: 'group' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', class: o[0] === value ? 'on' : '', text: o[1], onclick: function () {
        Array.prototype.forEach.call(wrap.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); onPick(o[0]);
      } });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function bar(v, max, col) { return h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(0, Math.min(100, v / (max || 100) * 100)) + '%;' + (col ? 'background:' + col : '') })); }
  function statRow(label, v, extra) {
    var row = h('div', { class: 'statrow' + (extra ? ' btns' : '') }, h('span', { text: label }), bar(v - 60, 40), h('span', { class: 'num', style: 'font-size:20px;text-align:right', text: (Math.round(v * 10) / 10).toString() }));
    if (extra) row.appendChild(extra);
    return row;
  }
  UI.toast = function (t) {
    var el = h('div', { class: 'toast', text: t }); document.getElementById('app').appendChild(el);
    setTimeout(function () { el.remove(); }, Math.max(1800, String(t).length * 55)); // dłuższe komunikaty dłużej na ekranie
  };
  function confirmInline(btn, label, onYes) {
    var parent = btn.parentNode, box = h('span', { class: 'row' }, h('span', { class: 'muted', text: label }),
      h('button', { type: 'button', class: 'small danger', text: 'Tak', onclick: onYes }),
      h('button', { type: 'button', class: 'small', text: 'Nie', onclick: function () { box.replaceWith(btn); } }));
    parent.replaceChild(box, btn);
  }
  function teamStripe(t) { return h('div', { class: 'stripe', style: 'background:linear-gradient(90deg,' + t.livery.primary + ' 0 60%,' + t.livery.secondary + ' 60% 85%,' + t.livery.accent + ' 85%)' }); }

  // ---------- start ----------
  UI.boot = function () {
    root = document.getElementById('ui');
    Store.load();
    PG.Audio.on = Store.data.settings.sound; PG.Audio.vol = Store.data.settings.vol;
    var s = screen('loading', 'solid');
    var bar1 = h('div', { class: 'loadbar' }, h('i'));
    s.appendChild(h('div', { style: 'min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px' },
      h('div', { class: 'logo', style: 'align-items:center' }, h('span', { class: 'k', text: 'WORLD' }), h('span', { class: 'k2', text: 'GP' })),
      bar1, h('p', { class: 'muted', text: 'Wczytywanie toru i bolidów…' })));
    G.init(function (p) { bar1.firstChild.style.width = Math.round(p * 100) + '%'; }, function () { if (G.noWebGL) UI.noWebGL(); else UI.menu(); });
    document.addEventListener('pointerdown', function () { PG.Audio.init(); }, { once: true });
  };

  // Gra działa tylko w 3D: bez WebGL zamiast menu jest wyjaśnienie
  UI.noWebGL = function () {
    var s = screen('nowebgl', 'solid');
    s.appendChild(h('div', { style: 'min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center' },
      h('div', { class: 'logo', style: 'align-items:center' }, h('span', { class: 'k', text: 'WORLD' }), h('span', { class: 'k2', text: 'GP' })),
      h('h2', { text: 'Gra wymaga grafiki 3D (WebGL)' }),
      h('p', { class: 'muted', style: 'max-width:560px', text: 'Ta przeglądarka nie udostępnia WebGL albo jest on wyłączony. Otwórz grę w aktualnym Chrome, Edge, Firefox lub Safari i sprawdź, czy przyspieszenie sprzętowe jest włączone (Chrome: Ustawienia → System → „Używaj akceleracji grafiki”).' }),
      h('button', { type: 'button', class: 'primary', text: 'Spróbuj ponownie', onclick: function () { location.reload(); } })));
  };

  // ---------- MENU ----------
  UI.menu = function () {
    if (G.noWebGL || !G.V) { UI.noWebGL(); return; }
    if (G.mode !== 'attract') G.startAttract();
    if (UI.multiAuto && UI.multiAuto()) return; // link z kodem lobby
    var s = screen('menu', 'dim');
    var car = Store.data.career;
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('div', { class: 'logo' }, h('span', { class: 'k', text: 'WORLD' }), h('span', { class: 'k2', text: 'GP' })));
    var btns = h('div', { class: 'menu-btns' });
    if (car) btns.appendChild(h('button', { type: 'button', class: 'primary', onclick: UI.hub }, 'Kontynuuj karierę', h('small', { text: 'Sezon ' + car.season + ' · runda ' + Math.min(car.round + 1, PG.CALENDAR.length) + '/' + PG.CALENDAR.length })));
    btns.appendChild(h('button', { type: 'button', class: car ? '' : 'primary', onclick: function () { car ? UI.careerNewConfirm() : UI.careerNew(); } }, 'Nowa kariera', h('small', { text: 'Kierowca albo własny zespół' })));
    btns.appendChild(h('button', { type: 'button', onclick: function () { UI.trackPick(UI.quick, UI.menu); } }, 'Szybki wyścig', h('small', { text: 'Tor, zespół, pogoda, dystans' })));
    if (UI.multi) btns.appendChild(h('button', { type: 'button', onclick: function () { UI.multi(); } }, 'Multiplayer', h('small', { text: 'Lobby, gra z innymi przez internet' })));
    btns.appendChild(h('button', { type: 'button', onclick: function () { UI.creator('drivers'); } }, 'Kreator', h('small', { text: 'Kierowcy, zespoły, malowania' })));
    btns.appendChild(h('button', { type: 'button', onclick: UI.settings }, 'Ustawienia', h('small', { text: 'Grafika, asysty, kontroler, sterowanie' })));
    w.appendChild(btns);
    w.appendChild(h('p', { class: 'muted', style: 'font-size:13px', text: 'Zespoły i kierowcy są fikcyjni, inspirowani stawką F1. Wersja ' + PG.VERSION + '.' }));
    s.appendChild(w);
  };

  UI.careerNewConfirm = function () {
    var s = screen('confirm', 'dim');
    s.appendChild(h('div', { class: 'wrap', style: 'max-width:520px;margin:0;padding-block:12vh' }, h('div', { class: 'panel col' },
      h('h2', { text: 'Nowa kariera?' }), h('p', { text: 'Obecna kariera zostanie zastąpiona. Twoi kierowcy, zespoły i malowania z kreatora zostają.' }),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', text: 'Zacznij od nowa', onclick: UI.careerNew }), h('button', { type: 'button', text: 'Wróć', onclick: UI.menu })))));
  };

  // ---------- USTAWIENIA ----------
  var LINE_OPTS = [['full', 'Pełna, kolor według prędkości'], ['brake', 'Tylko hamowanie'], ['off', 'Wyłączona']];
  var LINE_TXT = {
    full: 'Linia pokazuje, co zrobić w każdym punkcie przy Twojej obecnej prędkości: zielona — gaz albo utrzymaj tempo, żółta i pomarańczowa — odpuść gaz i przygotuj się do hamowania, czerwona — hamuj. Kolor zmienia się na bieżąco, gdy przyspieszasz albo zwalniasz.',
    brake: 'Widać tylko odcinki, na których przy obecnej prędkości trzeba zwolnić: od żółtego (odpuść gaz) do czerwonego (hamuj teraz).',
    off: 'Bez podpowiedzi na torze.'
  };
  var DMG_OPTS = [['off', 'Wyłączone'], ['visual', 'Tylko wizualne'], ['full', 'Pełne']];
  var DMG_TXT = {
    full: 'Uszkodzone skrzydła, podłoga i zawieszenie odbierają docisk i ściągają bolid, uszkodzony silnik traci moc. Mocne uderzenie może urwać skrzydło.',
    visual: 'Części pękają i odpadają, ale bolid jedzie tak samo szybko.',
    off: 'Bolid zostaje nietknięty.'
  };
  function note(t) { return h('p', { class: 'muted', style: 'font-size:14px', text: t }); }
  function onOff(v, fn, labels) { labels = labels || ['Włączony', 'Wyłączony']; return seg([[true, labels[0]], [false, labels[1]]], !!v, fn); }
  // Przełącznik asysty (zmienia też trwającą sesję)
  function assistSeg(key) {
    var st = Store.data.settings;
    return onOff(st[key], function (v) { st[key] = v; Store.save(); if (G.syncAssists) G.syncAssists(); }, key === 'abs' ? ['Włączony', 'Wyłączony'] : key === 'tc' ? ['Włączona', 'Wyłączona'] : ['Włączony', 'Wyłączony']);
  }
  // Skrzynia biegów: automatyczna albo ręczna (zmienia też trwającą sesję)
  var GEAR_TXT = 'Ręczna skrzynia: biegi zmieniasz sam (klawiatura X w górę, Z w dół; pad R1 / L1, wtedy DRS jest na ✕, a zjazd do boksu na Create albo L3). Za wysoki bieg osłabia silnik, na końcu biegu działa ogranicznik obrotów, a redukcja przy zbyt dużej prędkości jest blokowana. AI zawsze jeździ z automatem.';
  function gearSeg() {
    var st = Store.data.settings;
    return seg([['auto', 'Automatyczna'], ['manual', 'Ręczna']], st.gearbox === 'manual' ? 'manual' : 'auto', function (v) {
      st.gearbox = v; Store.save();
      if (G.syncAssists) G.syncAssists();
      if (G.applyGearbox) G.applyGearbox();
    });
  }
  function lineSeg(onPick) {
    var st = Store.data.settings;
    return seg(LINE_OPTS, G.lineMode ? G.lineMode() : (st.racingLine || 'full'), function (v) { st.racingLine = v; st.brakeHint = v !== 'off'; Store.save(); if (onPick) onPick(v); });
  }
  // Sterowanie padem (krótka ściąga)
  function padControls() {
    var kb = function (t) { return h('kbd', { text: t }); };
    return h('div', { class: 'keys', style: 'font-size:14px;line-height:1.95' },
      h('div', {}, kb('L-gałka'), ' skręt   ', kb('R2'), ' gaz   ', kb('L2'), ' hamulec   ', kb('R1'), ' / ', kb('✕'), ' DRS'),
      h('div', {}, kb('△'), ' kamera   ', kb('□'), ' patrz do tyłu   ', kb('○'), ' powrót na tor   ', kb('Options'), ' pauza'),
      h('div', {}, 'Ręczna skrzynia: ', kb('R1'), ' / ', kb('L1'), ' bieg w górę / w dół   ', kb('✕'), ' DRS   ', kb('Create'), ' boks'),
      h('div', {}, 'W menu: ', kb('krzyżak'), ' wybór   ', kb('✕'), ' zatwierdź   ', kb('○'), ' wstecz'));
  }
  function padStatus() {
    var P = PG.Pad, H = PG.Haptics;
    if (!P || !P.connected) return 'Nie wykryto kontrolera. Podłącz pad (USB lub Bluetooth) i naciśnij na nim dowolny przycisk.';
    var t = 'Wykryto: ' + P.name;
    if (H && H.supported && !H.supported()) t += ' · ta przeglądarka nie obsługuje wibracji tego pada';
    return t;
  }
  var padRefresh = null;
  UI.onPadChange = function () { if (padRefresh) { try { padRefresh(); } catch (e) { /* nic */ } } };

  UI.settings = function () {
    if (G.mergeSettings) G.mergeSettings();
    var s = screen('settings', 'dim'), st = Store.data.settings;
    var w = h('div', { class: 'wrap', style: 'max-width:1060px;margin:0' });
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { text: 'Ustawienia' }),
      h('button', { type: 'button', class: 'primary', text: 'Gotowe', 'data-back': true, onclick: UI.menu })));
    var g2 = h('div', { class: 'grid2' });

    // grafika
    var gp = h('div', { class: 'panel col' }, h('h3', { text: 'Grafika' }));
    gp.appendChild(h('div', { class: 'field' }, 'Jakość 3D', seg([['auto', 'Automatyczna'], ['high', 'Wysoka'], ['medium', 'Średnia'], ['low', 'Niska']], st.quality || 'auto', function (v) {
      st.quality = v; Store.save(); if (G.use3D) G.reconfigureGraphics();
    })));
    gp.appendChild(h('div', { class: 'field' }, 'Efekty obrazu', onOff(st.post !== false, function (v) {
      st.post = v; Store.save(); if (G.setPost) G.setPost(v); else if (G.use3D) G.reconfigureGraphics();
    }, ['Włączone', 'Wyłączone'])));
    gp.appendChild(note('Poświata jasnych świateł, wygładzanie krawędzi, korekcja barw i lekka winieta. Przy jakości „Niska” są wyłączone. Na słabszym komputerze wyłącz je, by zyskać płynność.'));
    var camSel = h('select', { id: 'camDefault', onchange: function () { st.camera = camSel.value; Store.save(); if (G.V && G.mode !== 'attract') G.V.setMode(st.camera); } });
    (PG.CAMERAS || []).forEach(function (c) { camSel.appendChild(h('option', { value: c.id, text: c.name, selected: (st.camera || 'chase') === c.id })); });
    gp.appendChild(h('label', { class: 'field' }, 'Kamera w wyścigu (zmiana w trakcie: C lub △)', camSel));
    g2.appendChild(gp);

    // jazda: linia, asysty, uszkodzenia
    var jp = h('div', { class: 'panel col' }, h('h3', { text: 'Jazda' }));
    var lineNote = note(LINE_TXT[G.lineMode ? G.lineMode() : 'full'] || '');
    jp.appendChild(h('div', { class: 'field' }, 'Linia jazdy', lineSeg(function (v) { lineNote.textContent = LINE_TXT[v] || ''; })));
    jp.appendChild(lineNote);
    jp.appendChild(h('h3', { text: 'Asysty', style: 'margin-top:6px' }));
    jp.appendChild(h('div', { class: 'field' }, 'Automatyczny DRS', assistSeg('autoDrs')));
    jp.appendChild(h('div', { class: 'field' }, 'ABS', assistSeg('abs')));
    jp.appendChild(h('div', { class: 'field' }, 'Kontrola trakcji', assistSeg('tc')));
    jp.appendChild(h('div', { class: 'field' }, 'Skrzynia biegów', gearSeg()));
    jp.appendChild(note(GEAR_TXT));
    jp.appendChild(note('Automatyczny DRS otwiera klapę sam, gdy DRS jest dozwolony w strefie, i zamyka ją przy hamowaniu. Bez ABS zbyt mocne hamowanie blokuje koła: bolid dymi, gorzej skręca i robi płaskie miejsca na oponach. Kontrola trakcji ogranicza buksowanie przy wyjściu z zakrętów. Asysty można zmieniać także w pauzie.'));
    jp.appendChild(h('h3', { text: 'Uszkodzenia', style: 'margin-top:6px' }));
    var dmgNote = note(DMG_TXT[st.damage] || '');
    jp.appendChild(h('div', { class: 'field' }, 'Model uszkodzeń', seg(DMG_OPTS, st.damage || 'full', function (v) {
      st.damage = v; Store.save(); dmgNote.textContent = DMG_TXT[v] || '';
    })));
    jp.appendChild(dmgNote);
    jp.appendChild(note('Zmiana uszkodzeń obowiązuje od następnej sesji.'));
    g2.appendChild(jp);

    // kontroler
    var kp = h('div', { class: 'panel col' }, h('h3', { text: 'Kontroler' }));
    var padInfo = h('p', { style: 'font-size:15px', text: padStatus() });
    kp.appendChild(padInfo);
    kp.appendChild(h('div', { class: 'field' }, 'Wibracje', onOff(st.haptics !== false, function (v) {
      st.haptics = v; Store.save(); if (!v && PG.Haptics) PG.Haptics.stop();
    }, ['Włączone', 'Wyłączone'])));
    var gain = h('input', { type: 'range', id: 'hapGain', min: 0, max: 100, value: Math.round((st.hapticsGain === undefined ? 0.8 : st.hapticsGain) * 100), oninput: function () {
      st.hapticsGain = gain.value / 100; Store.save();
    } });
    var testBtn = h('button', { type: 'button', class: 'small', text: 'Test wibracji', onclick: function () {
      var ok = PG.Haptics && PG.Pad && PG.Pad.connected && st.haptics !== false && PG.Haptics.test(st.hapticsGain);
      if (!ok) UI.toast(!(PG.Pad && PG.Pad.connected) ? 'Najpierw podłącz pad i naciśnij na nim przycisk' : st.haptics === false ? 'Wibracje są wyłączone' : 'Ten pad lub przeglądarka nie obsługuje wibracji');
    } });
    kp.appendChild(h('label', { class: 'field' }, 'Siła wibracji', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, gain, testBtn)));
    kp.appendChild(note('Wibracje oddają krawężniki, trawę i żwir, blokowanie i buksowanie kół, płaskie miejsca na oponach, poślizgi, zmianę biegów, DRS, zgaśnięcie świateł oraz uderzenia i uszkodzenia. Najlepiej działają z DualSense w Chrome lub Edge.'));
    var D = PG.DualSenseHID, hidBox = null;
    var renderHid = function () {
      if (!hidBox) return;
      hidBox.innerHTML = '';
      if (D.connected()) {
        hidBox.appendChild(h('div', { class: 'row' }, h('span', { class: 'pill green', text: 'DualSense połączony · ' + (D.bt ? 'Bluetooth' : 'USB') }),
          h('button', { type: 'button', class: 'small', text: 'Rozłącz', onclick: function () { D.disconnect().then(renderHid, renderHid); } })));
        hidBox.appendChild(h('div', { class: 'field' }, 'Adaptacyjne spusty', onOff(st.trig !== false, function (v) {
          st.trig = v; Store.save(); if (!v) D.off();
        }, ['Włączone', 'Wyłączone'])));
        var tg = h('input', { type: 'range', min: 0, max: 100, value: Math.round((st.trigGain === undefined ? 0.8 : st.trigGain) * 100), oninput: function () {
          st.trigGain = tg.value / 100; Store.save();
        } });
        var tb = h('button', { type: 'button', class: 'small', text: 'Test spustów', onclick: function () {
          if (D.test(st.trigGain === undefined ? 0.8 : st.trigGain)) UI.toast('Naciśnij L2 i R2 — opór przez 3 sekundy');
          else UI.toast('Nie udało się wysłać efektu do pada');
        } });
        hidBox.appendChild(h('label', { class: 'field' }, 'Opór spustów', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, tg, tb)));
      } else {
        hidBox.appendChild(h('button', { type: 'button', text: 'Połącz DualSense: adaptacyjne spusty', onclick: function () {
          D.connect().then(function (ok) {
            UI.toast(ok ? 'DualSense połączony — spusty aktywne' : 'Nie połączono z DualSense');
            renderHid();
          }, function () { renderHid(); });
        } }));
      }
      hidBox.appendChild(note('L2 działa jak pedał hamulca: twardnieje w miarę wciskania (mocniej przy dużej prędkości), drży przy pracy ABS i odbija, gdy koła się blokują. R2 ma lekką sprężynę, szarpie przy zmianie biegu w górę i drży na ograniczniku obrotów, przy buksowaniu, pracy kontroli trakcji, na żwirze, trawie i krawężnikach. Pasek świetlny świeci w kolorze zespołu. Przeglądarka poprosi o zgodę na dostęp do pada.'));
    };
    if (D && D.available && D.available()) {
      hidBox = h('div', { class: 'col', style: 'gap:6px' });
      kp.appendChild(hidBox);
      renderHid();
    } else if (D) {
      kp.appendChild(note('Adaptacyjne spusty DualSense wymagają Chrome albo Edge (WebHID) i gry otwartej z adresu localhost albo https. W tej przeglądarce działają tylko zwykłe wibracje.'));
    }
    kp.appendChild(padControls());
    g2.appendChild(kp);
    // odświeżanie nazwy pada i stanu WebHID
    var lastHid = D && D.connected ? D.connected() : false;
    padRefresh = function () {
      if (!padInfo.isConnected) return;
      padInfo.textContent = padStatus();
      var hc = D && D.connected ? D.connected() : false;
      if (hc !== lastHid) { lastHid = hc; renderHid(); }
    };
    var iv = setInterval(padRefresh, 700);
    UI.onLeave(function () { clearInterval(iv); padRefresh = null; });

    // dźwięk i zapis
    var dp = h('div', { class: 'panel col' }, h('h3', { text: 'Dźwięk' }));
    dp.appendChild(h('div', { class: 'field' }, 'Dźwięk', seg([[true, 'Włączony'], [false, 'Wyłączony']], st.sound, function (v) { st.sound = v; PG.Audio.setOn(v); Store.save(); })));
    var vol = h('input', { type: 'range', id: 'vol', min: 0, max: 100, value: Math.round(st.vol * 100), oninput: function () { st.vol = vol.value / 100; PG.Audio.setVol(st.vol); Store.save(); } });
    dp.appendChild(h('label', { class: 'field' }, 'Głośność', vol));
    dp.appendChild(h('h3', { text: 'Zapis gry', style: 'margin-top:6px' }));
    var del = h('button', { type: 'button', class: 'danger', text: 'Usuń zapis gry' });
    del.onclick = function () { confirmInline(del, 'Usunąć karierę i kreacje?', function () {
      var oq = G.quality(), op = !!Store.data.settings.post;
      Store.reset(); if (G.mergeSettings) G.mergeSettings(); Store.save();
      var ns = Store.data.settings; PG.Audio.setVol(ns.vol); PG.Audio.setOn(ns.sound);
      if (G.use3D && (G.quality() !== oq || !!ns.post !== op)) G.reconfigureGraphics();
      quick.teamId = null; quick.driverIdx = 0;
      UI.toast('Zapis usunięty'); UI.settings();
    }); };
    dp.appendChild(h('div', { class: 'row' }, del));
    g2.appendChild(dp);

    // sterowanie
    var kb = function (t) { return h('kbd', { text: t }); };
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Sterowanie' }), h('div', { class: 'keys' },
      h('div', {}, kb('↑'), ' / ', kb('W'), ' gaz   ', kb('↓'), ' / ', kb('S'), ' hamulec   ', kb('←'), kb('→'), ' skręt'),
      h('div', {}, kb('E'), ' DRS   ', kb('R'), ' powrót na tor   ', kb('Esc'), ' pauza   ', kb('M'), ' dźwięk'),
      h('div', {}, kb('C'), ' kamera   ', kb('V'), ' patrz do tyłu   ', kb('B'), ' zjazd do boksu   ', kb('1'), '–', kb('4'), ' opony'),
      h('div', {}, kb('X'), ' / ', kb('Z'), ' bieg w górę / w dół (ręczna skrzynia)'),
      h('div', {}, 'Pad (DualSense i inne): ', kb('L-gałka'), ' skręt   ', kb('R2'), ' gaz   ', kb('L2'), ' hamulec   ', kb('R1'), ' / ', kb('✕'), ' DRS'),
      h('div', {}, kb('△'), ' kamera   ', kb('□'), ' patrz do tyłu   ', kb('○'), ' powrót na tor   ', kb('L1'), ' boks   ', kb('Options'), ' pauza'),
      h('div', {}, 'Ręczna skrzynia na padzie: ', kb('R1'), ' / ', kb('L1'), ' biegi   ', kb('✕'), ' DRS   ', kb('Create'), ' / ', kb('L3'), ' boks'),
      h('div', {}, 'Na telefonie działa sterowanie dotykowe.'))));

    w.appendChild(g2);
    w.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', text: 'Gotowe', onclick: UI.menu })));
    s.appendChild(w);
  };

  // ---------- SZYBKI WYŚCIG ----------
  var quick = { teamId: null, driverIdx: 0, laps: 5, weather: 'sun', compound: 'M', track: 'monza' };

  // ---------- WYBÓR TORU ----------
  function trackDef(id) { return (PG.TRACKS || []).find(function (t) { return t.id === id; }) || PG.MONZA; }
  PG.trackDef = trackDef;
  // Zarys toru z punktów definicji (miniatura na karcie)
  function trackOutline(def, W, H) {
    var c = h('canvas', { class: 'trackmini' }), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px';
    var g = c.getContext('2d'), P = def.points, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    P.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    var sc = Math.min((W - 16) / (x1 - x0), (H - 16) / (y1 - y0)), ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    g.scale(dpr, dpr); g.lineJoin = 'round'; g.lineCap = 'round';
    function path() { g.beginPath(); P.forEach(function (p, i) { var x = ox + (p[0] - x0) * sc, y = oy + (p[1] - y0) * sc; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); }
    path(); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 7; g.stroke();
    path(); g.strokeStyle = '#f2f2f2'; g.lineWidth = 3; g.stroke();
    var s0 = P[0]; g.fillStyle = '#e10600'; g.beginPath(); g.arc(ox + (s0[0] - x0) * sc, oy + (s0[1] - y0) * sc, 5, 0, Math.PI * 2); g.fill();
    return c;
  }
  // Ekran wyboru toru: onPick(id) po wyborze, onBack — powrót
  UI.trackPick = function (onPick, onBack) {
    var s = screen('trackpick', 'dim'), w = h('div', { class: 'wrap' });
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { text: 'Wybierz tor' }), h('button', { type: 'button', text: '← Wróć', onclick: onBack || UI.menu })));
    var grid = h('div', { class: 'grid3' });
    (PG.TRACKS || [PG.MONZA]).forEach(function (t) {
      grid.appendChild(h('button', { type: 'button', class: 'card' + (quick.track === t.id ? ' on' : ''), onclick: function () { quick.track = t.id; onPick(t.id); } },
        trackOutline(t, 260, 150), h('b', { text: t.name }),
        h('span', { class: 'muted', style: 'font-size:13px', text: (PG.NATIONS[t.country] ? PG.NATIONS[t.country].name + ' · ' : '') + t.info })));
    });
    w.appendChild(grid); s.appendChild(w);
  };

  // dystans, zużycie opon (auto: krótszy wyścig — szybsze zużycie, by strategia miała znaczenie)
  var LAP_OPTS = [[1, '1'], [3, '3'], [5, '5'], [10, '10'], [15, '15'], [27, '27 · ½'], [53, '53 · pełny']];
  function wearAuto(laps) { return laps >= 27 ? 1 : laps >= 15 ? 1.5 : laps >= 10 ? 2 : 3; }
  UI.wearAuto = wearAuto;
  function raceLen(laps) { var min = Math.round(laps * 85 / 60); return laps + ' okr. · ' + (laps * 5.793).toFixed(1).replace('.', ',') + ' km · ok. ' + (min >= 60 ? Math.floor(min / 60) + ' h ' + (min % 60) + ' min' : min + ' min'); }
  UI.quick = function () {
    var s = screen('quick', 'dim'), teams = PG.allTeams(), st = Store.data.settings;
    if (!quick.teamId || !teams.find(function (t) { return t.id === quick.teamId; })) quick.teamId = teams[0].id;
    if (typeof quick.driverIdx === 'string' && !Store.data.drivers[+quick.driverIdx.slice(1)]) quick.driverIdx = 0;
    quick.laps = st.laps; quick.diff = st.difficulty;
    quick.qf = st.qualiFormat || 'q3'; quick.wear = st.wear || 'auto'; quick.inc = st.incidents || 'rare';
    var w = h('div', { class: 'wrap' });
    var td = trackDef(quick.track);
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'col', style: 'gap:2px' }, h('h2', { text: 'Szybki wyścig' }), h('span', { class: 'muted', text: 'Tor: ' + td.name })),
      h('div', { class: 'row' }, h('button', { type: 'button', text: 'Zmień tor', onclick: function () { UI.trackPick(UI.quick, UI.quick); } }), h('button', { type: 'button', text: '← Menu', onclick: UI.menu }))));
    var g2 = h('div', { class: 'grid2' });
    var left = h('div', { class: 'panel col' }, h('h3', { text: 'Zespół' }));
    var grid = h('div', { class: 'grid3' });
    var right = h('div', { class: 'panel col' });
    function renderRight() {
      right.innerHTML = '';
      var t = teams.find(function (x) { return x.id === quick.teamId; });
      right.appendChild(h('h3', { text: 'Wyścig' }));
      right.appendChild(h('div', { class: 'row' }, carImg(t.livery, t.drivers[quick.driverIdx] && t.drivers[quick.driverIdx].helmet, 5), h('div', { class: 'col', style: 'gap:2px' }, h('b', { text: t.name }), h('span', { class: 'muted', text: 'Silnik ' + t.engine + (t.inspiredBy ? ' · inspiracja: ' + t.inspiredBy : '') }))));
      var opts = t.drivers.map(function (d, i) { return [i, '#' + d.num + ' ' + PG.driverName(d)]; });
      Store.data.drivers.forEach(function (d, i) { opts.push(['c' + i, '★ ' + PG.driverName(d)]); });
      var sel = h('select', { id: 'qDriver', onchange: function () { quick.driverIdx = isNaN(+sel.value) ? sel.value : +sel.value; renderRight(); } });
      opts.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1], selected: String(o[0]) === String(quick.driverIdx) })); });
      right.appendChild(h('label', { class: 'field' }, 'Kierowca', sel));
      var lenNote = h('span', { class: 'muted', style: 'font-size:13px', text: raceLen(quick.laps) });
      right.appendChild(h('label', { class: 'field' }, 'Dystans wyścigu', seg(LAP_OPTS, quick.laps, function (v) { quick.laps = v; st.laps = v; Store.save(); lenNote.textContent = raceLen(v); }), lenNote));
      right.appendChild(h('label', { class: 'field' }, 'Kwalifikacje', seg([['q3', 'Q1 · Q2 · Q3'], ['one', 'Jedno okrążenie']], quick.qf, function (v) { quick.qf = v; st.qualiFormat = v; Store.save(); })));
      right.appendChild(h('label', { class: 'field' }, 'Zużycie opon', seg([['auto', 'Auto'], [1, 'Realne'], [2, '×2'], [4, '×4']], quick.wear, function (v) { quick.wear = v; st.wear = v; Store.save(); })));
      right.appendChild(h('label', { class: 'field' }, 'Samochód bezpieczeństwa i awarie', seg(PG.RC ? PG.RC.LEVELS : [['rare', 'Rzadko']], quick.inc, function (v) { quick.inc = v; st.incidents = v; Store.save(); })));
      right.appendChild(h('label', { class: 'field' }, 'Pogoda', seg([['sun', 'Słońce'], ['cloud', 'Chmury'], ['rain', 'Deszcz']], quick.weather, function (v) { quick.weather = v; })));
      right.appendChild(h('label', { class: 'field' }, 'Poziom rywali', seg([['easy', 'Łatwy'], ['normal', 'Normalny'], ['hard', 'Trudny']], quick.diff, function (v) { quick.diff = v; st.difficulty = v; Store.save(); })));
      right.appendChild(h('button', { type: 'button', class: 'primary', text: 'Na tor →', onclick: startQuick }));
    }
    teams.forEach(function (t) {
      var card = h('button', { type: 'button', class: 'card' + (t.id === quick.teamId ? ' on' : ''), onclick: function () {
        quick.teamId = t.id; quick.driverIdx = 0;
        Array.prototype.forEach.call(grid.children, function (x) { x.classList.remove('on'); }); card.classList.add('on'); renderRight();
      } }, teamStripe(t), h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { text: t.name }), carImg(t.livery, t.drivers[0].helmet, 2)),
        h('span', { class: 'muted', style: 'font-size:13px', text: 'Osiągi ' + Math.round(PG.teamRating(t)) + (t.custom ? ' · własny' : '') }));
      grid.appendChild(card);
    });
    left.appendChild(grid);
    g2.appendChild(left); g2.appendChild(right); w.appendChild(g2); s.appendChild(w);
    renderRight();

    function startQuick() {
      var all = PG.allTeams().filter(function (t) { return !t.custom || t.id === quick.teamId; });
      // max 11 zespołów: domyślne + wybrany własny
      var entries = [];
      all.forEach(function (t) {
        t.drivers.forEach(function (d, i) {
          var e = { driver: d, team: t, isPlayer: false };
          if (t.id === quick.teamId) {
            if (typeof quick.driverIdx === 'string') {
              if (i === 0) { var cd = PG.clone(Store.data.drivers[+quick.driverIdx.slice(1)]); cd.uid = 'player'; e.driver = cd; e.isPlayer = true; }
            } else if (i === quick.driverIdx) e.isPlayer = true;
          }
          entries.push(e);
        });
      });
      UI.weekend({ entries: entries, track: quick.track, laps: quick.laps, weather: quick.weather, difficulty: quick.diff, title: 'Szybki wyścig', onExit: UI.quick,
        qualiFormat: quick.qf, wearMul: quick.wear === 'auto' ? wearAuto(quick.laps) : +quick.wear, incidents: quick.inc });
    }
  };

  // ---------- WEEKEND: kwalifikacje (Q1 · Q2 · Q3 albo jedno okrążenie) → pola startowe → wyścig ----------
  // ctx: {entries, laps, weather, difficulty, title, career, onExit, onResult, qualiFormat, wearMul, incidents}
  function qEnv(ctx) { return { wet: ctx.weather === 'rain', weatherGrip: PG.WEATHER[ctx.weather].grip }; }
  var Q_TXT = {
    one: 'Jedno szybkie okrążenie ustala pole startowe. Startujesz rozpędzony przed ostatnim zakrętem.',
    2: 'Q3: dziesiątka walczy o pole position.'
  };
  UI.weekend = function (ctx) {
    if (G.setTrack) G.setTrack(ctx.track || 'monza');
    ctx.qualiFormat = ctx.qualiFormat || Store.data.settings.qualiFormat || 'q3';
    if (!ctx.wearMul) ctx.wearMul = wearAuto(ctx.laps);
    ctx.q = PG.Quali.create(ctx.entries, ctx.qualiFormat);
    UI.qualiSeg(ctx);
  };

  UI.qualiSeg = function (ctx) {
    var s = screen('weekend', 'dim'), Q = PG.Quali, st = ctx.q, env = qEnv(ctx), seg = st.seg;
    var meIdx = ctx.entries.findIndex(function (e) { return e.isPlayer; }), me = ctx.entries[meIdx];
    var alive = st.alive.indexOf(meIdx) >= 0, W = PG.WEATHER[ctx.weather], keep = Q.keepNow(st);
    var p = h('div', { class: 'panel col' });
    p.appendChild(h('h3', { text: ctx.title }));
    p.appendChild(h('h2', { text: st.format === 'one' ? 'Kwalifikacje' : 'Kwalifikacje · ' + Q.segName(st) }));
    p.appendChild(h('div', { class: 'kv' }, h('span', { text: 'Tor' }), h('span', { text: G.T.name }), h('span', { text: 'Pogoda' }), h('span', { text: W.name }),
      h('span', { text: 'Wyścig' }), h('span', { text: raceLen(ctx.laps) }), h('span', { text: 'Rywale' }), h('span', { text: PG.DIFF_NAMES[ctx.difficulty] }),
      h('span', { text: 'W segmencie' }), h('span', { text: st.alive.length + ' bolidów' + (keep ? ' · awansuje ' + keep : '') })));
    p.appendChild(h('p', { text: st.format === 'one' ? Q_TXT.one : seg === 0 ? 'Q1: cała stawka. Odpada ' + (st.alive.length - keep) + ' najwolniejszych i startuje z końca.' :
      seg === 1 ? 'Q2: ' + st.alive.length + ' najszybszych z Q1. Kolejnych ' + (st.alive.length - keep) + ' odpada.' : Q_TXT[seg] }));
    function isHuman(e) { return !!e.isPlayer; }
    function finish(times) { var res = Q.complete(st, times); UI.qualiRes(ctx, res); }
    function simMe(times) { times[meIdx] = Q.simTime(G.T, me, env, 'normal', st.seg); return times; }
    var row = h('div', { class: 'row' });
    if (alive) {
      row.appendChild(h('button', { type: 'button', class: 'primary', text: 'Jedź okrążenie', onclick: function () {
        var ai = Q.simulate(st, ctx.entries, G.T, env, ctx.difficulty, isHuman), tgt = Q.target(st, ai);
        root.innerHTML = '';
        G.startSession({ mode: 'quali', entries: [{ driver: me.driver, team: me.team, isPlayer: true, compound: ctx.weather === 'rain' ? 'W' : 'S' }], laps: 1, weather: ctx.weather, difficulty: ctx.difficulty,
          target: tgt, targetLabel: keep ? 'AWANS' : 'POLE', qualiName: Q.segName(st) }, function (out) {
          var t = out.aborted || !out.time ? 0 : out.time;
          if (t) ai[meIdx] = t; else simMe(ai);
          finish(ai);
        });
      } }));
      row.appendChild(h('button', { type: 'button', text: 'Symuluj ' + (st.format === 'one' ? 'kwalifikacje' : Q.segName(st)), onclick: function () {
        finish(simMe(Q.simulate(st, ctx.entries, G.T, env, ctx.difficulty, isHuman)));
      } }));
    }
    if (st.format !== 'one') row.appendChild(h('button', { type: 'button', class: alive ? '' : 'primary', text: alive ? 'Symuluj całe kwalifikacje' : 'Symuluj resztę', onclick: function () {
      while (!Q.done(st)) {
        var t = Q.simulate(st, ctx.entries, G.T, env, ctx.difficulty, isHuman);
        if (st.alive.indexOf(meIdx) >= 0) simMe(t);
        Q.complete(st, t);
      }
      UI.grid(ctx, null, st.final);
    } }));
    row.appendChild(h('button', { type: 'button', text: 'Wróć', onclick: ctx.onExit }));
    p.appendChild(row);
    s.appendChild(h('div', { class: 'wrap', style: 'max-width:600px;margin:0;padding-block:6vh' }, p));
  };

  // Tabela segmentu z linią eliminacji
  function qualiTable(ctx, rows, keep, meIdx) {
    var best = rows.length && rows[0].t ? rows[0].t : 0;
    var tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Kierowca' }), h('th', { text: 'Zespół' }), h('th', { class: 'num', text: 'Czas' }), h('th', { class: 'num', text: 'Strata' })));
    rows.forEach(function (r, k) {
      var e = ctx.entries[r.i], out = keep && k >= keep;
      var tr = h('tr', { class: r.i === meIdx ? 'me' : '', style: (out ? 'opacity:0.62;' : '') + (keep && k === keep ? 'border-top:2px solid var(--red)' : '') },
        h('td', { class: 'num', text: String(k + 1) }),
        h('td', {}, h('span', { class: 'teamchip', style: 'background:' + e.team.livery.primary }), PG.driverName(e.driver), out ? h('span', { class: 'pill red', style: 'margin-left:6px', text: 'odpada' }) : null),
        h('td', { class: 'muted', text: e.team.short || e.team.name }),
        h('td', { class: 'num', text: r.t ? PG.fmtTime(r.t) : 'bez czasu' }),
        h('td', { class: 'num', text: k && r.t && best ? PG.fmtGap(r.t - best) : '' }));
      tbl.appendChild(tr);
    });
    return tbl;
  }
  UI.qualiTable = qualiTable;
  // pomocniki ekranów dla modułu multiplayer
  UI._ = { screen: function (id, cls) { return screen(id, cls); }, seg: seg, teamStripe: teamStripe, carImg: carImg, note: note, raceLen: raceLen, onOff: onOff, root: function () { return root; } };

  UI.qualiRes = function (ctx, res) {
    var s = screen('qres', 'dim'), Q = PG.Quali, st = ctx.q;
    var meIdx = ctx.entries.findIndex(function (e) { return e.isPlayer; });
    var myPos = res.rows.findIndex(function (r) { return r.i === meIdx; }) + 1;
    var w = h('div', { class: 'wrap', style: 'max-width:980px' }), g2 = h('div', { class: 'grid2' });
    var name = st.format === 'one' ? 'Kwalifikacje' : Q.NAMES[res.seg];
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Wyniki · ' + name }), h('div', { class: 'tblwrap' }, qualiTable(ctx, res.rows, res.keep, meIdx))));
    var side = h('div', { class: 'panel col' }), verdict = '';
    if (myPos) {
      if (res.keep) verdict = myPos <= res.keep ? 'Awans do ' + Q.NAMES[res.seg + 1] + '!' : 'Odpadasz w ' + name;
      else verdict = myPos === 1 ? 'Pole position!' : 'Startujesz z P' + myPos;
      side.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + myPos }), h('div', { class: 'col', style: 'gap:2px' }, h('b', { text: verdict }), h('span', { class: 'muted', text: name }))));
    }
    if (!Q.done(st)) side.appendChild(h('button', { type: 'button', class: 'primary', text: 'Dalej: ' + Q.NAMES[st.seg] + ' →', onclick: function () { UI.qualiSeg(ctx); } }));
    else side.appendChild(h('button', { type: 'button', class: 'primary', text: 'Pola startowe →', onclick: function () { UI.grid(ctx, null, st.final); } }));
    g2.appendChild(side); w.appendChild(g2); s.appendChild(w);
  };

  // preset: gotowa kolejność z kwalifikacji [{i, t, seg}]
  UI.grid = function (ctx, playerTime, preset) {
    G.startAttract();
    var env = qEnv(ctx), times;
    if (preset) times = preset.map(function (r) { return { e: ctx.entries[r.i], t: r.t, seg: r.seg }; });
    else {
      times = ctx.entries.map(function (e) {
        var t = e.isPlayer && playerTime ? playerTime : PG.simQualiTime(G.T, e.team, e.driver, env, e.isPlayer ? 'normal' : ctx.difficulty);
        return { e: e, t: t, driven: e.isPlayer && !!playerTime };
      });
      times.sort(function (a, b) { return a.t - b.t; });
    }
    var myPos = times.findIndex(function (x) { return x.e.isPlayer; }) + 1;
    var s = screen('grid', 'dim');
    var w = h('div', { class: 'wrap', style: 'max-width:980px' });
    var g2 = h('div', { class: 'grid2' });
    var tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Kierowca' }), h('th', { text: 'Zespół' }), h('th', { class: 'num', text: 'Czas' })));
    times.forEach(function (x, i) {
      tbl.appendChild(h('tr', { class: x.e.isPlayer ? 'me' : '' }, h('td', { class: 'num', text: String(i + 1) }),
        h('td', {}, h('span', { class: 'teamchip', style: 'background:' + x.e.team.livery.primary }), PG.driverName(x.e.driver)),
        h('td', { class: 'muted', text: x.e.team.short || x.e.team.name }),
        h('td', { class: 'num', text: (x.t ? PG.fmtTime(x.t) : 'bez czasu') + (x.seg !== undefined && ctx.q && ctx.q.format !== 'one' ? ' · ' + PG.Quali.NAMES[x.seg] : '') })));
    });
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Pola startowe' }), h('div', { class: 'tblwrap' }, tbl)));
    var side = h('div', { class: 'panel col' });
    side.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + myPos }), h('div', { class: 'col', style: 'gap:2px' }, h('b', { text: 'Twoje pole startowe' }), h('span', { class: 'muted', text: playerTime ? 'Twoje okrążenie: ' + PG.fmtTime(playerTime) : raceLen(ctx.laps) }))));
    var comp = ctx.weather === 'rain' ? 'W' : 'M';
    side.appendChild(h('h3', { text: 'Opony na start' }));
    var tyreOpts = ctx.weather === 'rain' ? [['W', 'Deszczowe'], ['M', 'Pośrednie (slick)']] : [['S', 'Miękkie'], ['M', 'Pośrednie'], ['H', 'Twarde'], ['W', 'Deszczowe']];
    side.appendChild(seg(tyreOpts, comp, function (v) { comp = v; }));
    var rule = ctx.weather !== 'rain' && ctx.laps >= 10;
    side.appendChild(h('p', { class: 'muted', style: 'font-size:14px', text: 'Miękkie trzymają najlepiej, ale szybko się zużywają. Twarde wytrzymają długo. W deszczu slicki tracą przyczepność.' +
      (rule ? ' Na suchym torze trzeba w wyścigu użyć dwóch różnych mieszanek (inaczej kara +30 s).' : '') + ' Zjazd do boksu: B (pad: L1, przy ręcznej skrzyni Create), opony 1–4 (pad: krzyżak ▲▼).' }));
    function go(spectate) {
      root.innerHTML = '';
      var entries = times.map(function (x) {
        var c = x.e.isPlayer ? comp : (ctx.weather === 'rain' ? 'W' : (Math.random() < 0.3 ? 'S' : Math.random() < 0.75 ? 'M' : 'H'));
        return { driver: x.e.driver, team: x.e.team, isPlayer: x.e.isPlayer, compound: c };
      });
      G.startSession({ mode: 'race', entries: entries, laps: ctx.laps, weather: ctx.weather, difficulty: ctx.difficulty, spectate: spectate, careerRace: !!ctx.career,
        wearMul: ctx.wearMul || wearAuto(ctx.laps), incidents: ctx.incidents || Store.data.settings.incidents || 'rare' }, function (out) {
        UI.results(ctx, out, myPos);
      });
    }
    side.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', text: 'Start wyścigu', onclick: function () { go(false); } }),
      h('button', { type: 'button', text: 'Symuluj wyścig', onclick: function () { go(true); } })));
    g2.appendChild(side);
    w.appendChild(g2); s.appendChild(w);
  };

  UI.results = function (ctx, out, grid) {
    G.startAttract();
    var res = out.res, mine = res.find(function (r) { return r.car.isPlayer; });
    var report = null;
    if (ctx.career) report = C.applyResult(C.get(), res, { grid: grid, weather: ctx.weather });
    var s = screen('results', 'dim');
    var w = h('div', { class: 'wrap', style: 'max-width:1000px' });
    var g2 = h('div', { class: 'grid2' });
    var fl = null; res.forEach(function (r) { if (!r.dnf && r.best && (!fl || r.best < fl.best)) fl = r; });
    var tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Kierowca' }), h('th', { class: 'num', text: 'Czas' }), h('th', { class: 'num', text: 'Najl.' }), h('th', { class: 'num', text: 'Pkt' })));
    res.forEach(function (r) {
      var pts = r.dnf ? 0 : (PG.POINTS[r.pos - 1] || 0) + (fl === r && r.pos <= 10 ? 1 : 0);
      tbl.appendChild(h('tr', { class: r.car.isPlayer ? 'me' : '' }, h('td', { class: 'num', text: String(r.pos) }),
        h('td', {}, h('span', { class: 'teamchip', style: 'background:' + r.car.team.livery.primary }), PG.driverName(r.car.driver), r.penalty ? h('span', { class: 'pill red', style: 'margin-left:6px', text: '+' + r.penalty + ' s' }) : null),
        h('td', { class: 'num', text: r.dnf ? 'DNF' : r.pos === 1 ? PG.fmtTime(r.time) : PG.fmtGap(r.gap) }),
        h('td', { class: 'num', style: fl === r ? 'color:var(--purple)' : '', text: PG.fmtTime(r.best) }),
        h('td', { class: 'num', text: pts ? String(pts) : '' })));
    });
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Klasyfikacja wyścigu' }), h('div', { class: 'tblwrap' }, tbl)));
    var side = h('div', { class: 'panel col' });
    if (mine) { // widz online: bez własnego wyniku
      var verdict = mine.pos === 1 ? 'Zwycięstwo na Monzy!' : mine.pos <= 3 ? 'Podium!' : mine.pos <= 10 ? 'Punkty!' : 'Bez punktów';
      side.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + mine.pos }), h('div', { class: 'col', style: 'gap:2px' }, h('b', { text: verdict }), h('span', { class: 'muted', text: 'Start z P' + grid + ' · najlepsze okr. ' + PG.fmtTime(mine.best) }))));
    }
    if (ctx.mp) {
      side.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', text: 'Wróć do lobby', onclick: function () { if (PG.Multi) PG.Multi.backToLobby(); else UI.menu(); } }),
        h('button', { type: 'button', text: 'Wyjdź', onclick: function () { if (PG.Multi) PG.Multi.leave(); UI.multi ? UI.multi() : UI.menu(); } })));
    } else if (report) {
      side.appendChild(h('div', { class: 'kv' },
        h('span', { text: 'Punkty' }), h('span', { class: 'num', style: 'font-size:20px', text: '+' + report.pts }),
        h('span', { text: 'Pieniądze' }), h('span', { class: 'num', style: 'font-size:20px', text: '+' + money(report.money) }),
        h('span', { text: 'Reputacja' }), h('span', { class: 'num', style: 'font-size:20px;color:' + (report.rep >= 0 ? 'var(--green)' : '#ff8a8a'), text: (report.rep >= 0 ? '+' : '') + report.rep + ' (oczekiwano ok. P' + report.expected + ')' }),
        h('span', { text: 'Doświadczenie' }), h('span', { class: 'num', style: 'font-size:20px', text: '+' + report.xp + ' PD' })));
      if (report.dev.length) side.appendChild(h('p', { class: 'muted', text: 'Rozwój bolidu: ' + report.dev.map(function (d) { return ({ power: 'silnik', aero: 'aerodynamika', tyre: 'opony' })[d.k] + ' +' + d.d; }).join(', ') }));
      side.appendChild(h('button', { type: 'button', class: 'primary', text: 'Dalej →', onclick: UI.hub }));
    } else {
      side.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', text: 'Jeszcze raz', onclick: function () { UI.weekend(ctx); } }), h('button', { type: 'button', text: 'Menu', onclick: UI.menu })));
    }
    g2.appendChild(side);
    w.appendChild(g2); s.appendChild(w);
  };

  // ---------- PAUZA ----------
  UI.showPause = function () {
    var s = h('div', { class: 'screen solid', id: 'pause', style: 'background:rgba(14,26,31,0.82)' });
    var S = G.S, st = Store.data.settings;
    if (G.net && S.mode === 'race') { // wyścig online: czas płynie dalej
      var back = h('button', { type: 'button', class: 'primary', text: 'Wróć do wyścigu', 'data-back': true, onclick: function () { G.togglePause(); } });
      s.appendChild(h('div', { class: 'panel col', style: 'max-width:440px;margin:8vh auto 4vh' }, h('h2', { text: 'Menu' }),
        h('p', { class: 'muted', text: 'Wyścig online trwa dalej — Twój bolid jedzie bez sterowania.' }), back,
        h('button', { type: 'button', text: 'Zmień kamerę (C)', onclick: function () { G.togglePause(); G.cycleCamera(1); } }),
        h('button', { type: 'button', text: 'Powrót na tor (R)', onclick: function () { G.togglePause(); G.resetPlayer(); } }),
        h('button', { type: 'button', class: 'danger', text: 'Opuść wyścig', onclick: function () { UI.hidePause(); if (PG.Multi) PG.Multi.leaveRace(); } })));
      root.appendChild(s);
      if (PG.Pad && PG.Pad.connected) UI.padFocus(back);
      return;
    }
    var resume = h('button', { type: 'button', class: 'primary', text: 'Wznów', 'data-back': true, onclick: function () { G.togglePause(); } });
    var p = h('div', { class: 'panel col', style: 'max-width:440px;margin:8vh auto 4vh' }, h('h2', { text: 'Pauza' }),
      h('p', { class: 'muted', text: S.mode === 'race' ? 'Okrążenie ' + Math.min(S.laps, S.player.lap + 1) + ' z ' + S.laps + ' · P' + S.player.pos : 'Kwalifikacje' }),
      resume,
      h('button', { type: 'button', text: 'Zmień kamerę (C)', onclick: function () { G.togglePause(); G.cycleCamera(1); } }),
      h('button', { type: 'button', text: S.mode === 'race' ? 'Dokończ symulacją' : 'Pomiń (czas symulowany)', onclick: function () { UI.hidePause(); G.simulateRest(); } }),
      h('button', { type: 'button', text: 'Powrót na tor (R)', onclick: function () { G.togglePause(); G.resetPlayer(); } }));
    if (!(G.cfg && G.cfg.careerRace)) p.appendChild(h('button', { type: 'button', class: 'danger', text: 'Wyjdź do menu', onclick: function () { UI.hidePause(); G.paused = false; G.onDone = null; if (PG.Multi && PG.Multi.room) PG.Multi.leave(); G.startAttract(); UI.menu(); } }));
    // asysty i podpowiedzi zmieniane w trakcie sesji
    var opt = h('div', { class: 'col', style: 'gap:8px;margin-top:8px' }, h('h3', { text: 'Asysty i podpowiedzi' }),
      h('div', { class: 'field' }, 'Automatyczny DRS', assistSeg('autoDrs')),
      h('div', { class: 'field' }, 'ABS', assistSeg('abs')),
      h('div', { class: 'field' }, 'Kontrola trakcji', assistSeg('tc')),
      h('div', { class: 'field' }, 'Skrzynia biegów', gearSeg()),
      h('div', { class: 'field' }, 'Linia jazdy', lineSeg()));
    if (PG.Pad && PG.Pad.connected) {
      opt.appendChild(h('div', { class: 'field' }, 'Wibracje pada', onOff(st.haptics !== false, function (v) { st.haptics = v; Store.save(); }, ['Włączone', 'Wyłączone'])));
    }
    p.appendChild(opt);
    s.appendChild(p);
    root.appendChild(s);
    if (PG.Pad && PG.Pad.connected) UI.padFocus(resume);
  };
  UI.hidePause = function () { var p = document.getElementById('pause'); if (p) p.remove(); };

  // ---------- KREATOR ----------
  var cre = { tab: 'drivers', driverId: null, teamId: null, liveryTeam: null, tool: 'brush', color: '#ffffff', mirror: true };
  var SWATCH = ['#d40f1a', '#e2262f', '#ff7a00', '#ffb627', '#f6e200', '#c8e000', '#52e252', '#00a651', '#005c4b', '#00c2b2', '#3fa9f5', '#0b62c9', '#1c2a6b', '#0a2353', '#7a2fd6', '#ff82bd', '#ffffff', '#c0c4c8', '#6b7078', '#1b1b1b', '#8b5a2b', '#d9c08c'];

  UI.creator = function (tab) {
    if (tab) cre.tab = tab;
    var s = screen('creator', 'dim');
    var w = h('div', { class: 'wrap' });
    var tabs = h('div', { class: 'tabs' });
    [['drivers', 'Kierowcy'], ['teams', 'Zespoły'], ['livery', 'Malowanie']].forEach(function (t) {
      tabs.appendChild(h('button', { type: 'button', class: cre.tab === t[0] ? 'on' : '', text: t[1], onclick: function () { UI.creator(t[0]); } }));
    });
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { text: 'Kreator' }), h('div', { class: 'row' }, tabs, h('button', { type: 'button', text: '← Menu', onclick: UI.menu }))));
    if (cre.tab === 'drivers') w.appendChild(creatorDrivers());
    else if (cre.tab === 'teams') w.appendChild(creatorTeams());
    else w.appendChild(creatorLivery());
    s.appendChild(w);
  };

  UI.driverEditor = function (d, onChange) {
    var box = h('div', { class: 'col' });
    function save() { Store.save(); if (onChange) onChange(); }
    var prev = h('div', { class: 'row' });
    function drawPrev() {
      prev.innerHTML = '';
      prev.appendChild(helmet(d.helmet, 5));
      prev.appendChild(h('div', { class: 'col', style: 'gap:2px' }, h('b', { style: 'font-size:22px', text: PG.driverName(d) }), h('span', { class: 'row', style: 'gap:6px' }, flag(d.nat, 2), h('span', { class: 'muted', text: (PG.NATIONS[d.nat] || {}).name + ' · #' + d.num + ' · ' + PG.driverCode(d) }))));
    }
    drawPrev();
    box.appendChild(prev);
    var f1 = h('input', { type: 'text', id: 'dFirst', maxlength: 16, value: d.first, oninput: function () { d.first = f1.value.trim() || 'Jan'; drawPrev(); save(); } });
    var f2 = h('input', { type: 'text', id: 'dLast', maxlength: 18, value: d.last, oninput: function () { d.last = f2.value.trim() || 'Nowak'; drawPrev(); save(); } });
    var nat = h('select', { id: 'dNat', onchange: function () { d.nat = nat.value; drawPrev(); save(); } });
    Object.keys(PG.NATIONS).forEach(function (k) { nat.appendChild(h('option', { value: k, text: PG.NATIONS[k].name, selected: k === d.nat })); });
    var num = h('input', { type: 'number', id: 'dNum', min: 1, max: 99, value: d.num, oninput: function () { d.num = Math.max(1, Math.min(99, parseInt(num.value, 10) || 1)); drawPrev(); save(); } });
    box.appendChild(h('div', { class: 'grid2', style: 'grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px' },
      h('label', { class: 'field' }, 'Imię', f1), h('label', { class: 'field' }, 'Nazwisko', f2), h('label', { class: 'field' }, 'Narodowość', nat), h('label', { class: 'field' }, 'Numer', num)));
    var c1 = h('input', { type: 'color', id: 'dC1', value: d.helmet.c1, oninput: function () { d.helmet.c1 = c1.value; drawPrev(); save(); } });
    var c2 = h('input', { type: 'color', id: 'dC2', value: d.helmet.c2, oninput: function () { d.helmet.c2 = c2.value; drawPrev(); save(); } });
    box.appendChild(h('div', { class: 'row' }, h('label', { class: 'field' }, 'Kask', h('div', { class: 'row' }, c1, c2)),
      h('label', { class: 'field' }, 'Wzór kasku', seg(PG.HELMET_PATTERNS.map(function (p) { return [p.id, p.name]; }), d.helmet.pattern, function (v) { d.helmet.pattern = v; drawPrev(); save(); }))));
    // cechy
    var statsBox = h('div', { class: 'col', style: 'gap:6px' });
    function drawStats() {
      statsBox.innerHTML = '';
      var left = PG.DRIVER_POINTS - PG.driverPointsUsed(d);
      statsBox.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { text: 'Umiejętności' }), h('span', { class: 'pill ' + (left > 0 ? 'amber' : ''), text: 'Punkty do rozdania: ' + left })));
      [['pace', 'Tempo'], ['start', 'Start'], ['tyre', 'Opony'], ['wet', 'Deszcz']].forEach(function (k) {
        var minus = h('button', { type: 'button', class: 'small', text: '−', 'aria-label': 'Mniej: ' + k[1], disabled: d[k[0]] <= 70, onclick: function () { d[k[0]]--; save(); drawStats(); } });
        var plus = h('button', { type: 'button', class: 'small', text: '+', 'aria-label': 'Więcej: ' + k[1], disabled: left <= 0 || d[k[0]] >= 95, onclick: function () { d[k[0]]++; save(); drawStats(); } });
        statsBox.appendChild(statRow(k[1], d[k[0]], h('span', { class: 'row', style: 'gap:4px;flex-wrap:nowrap' }, minus, plus)));
      });
      statsBox.appendChild(h('p', { class: 'muted', style: 'font-size:13px', text: 'Tempo dodaje przyczepności, Start poprawia ruszanie ze świateł, Opony zmniejszają zużycie, Deszcz pomaga na mokrym.' }));
    }
    drawStats();
    box.appendChild(statsBox);
    return box;
  };

  function creatorDrivers() {
    var list = Store.data.drivers;
    if (!cre.driverId && list.length) cre.driverId = list[0].id;
    var g2 = h('div', { class: 'grid2', style: 'grid-template-columns:minmax(220px,320px) minmax(0,1fr)' });
    var left = h('div', { class: 'panel col' }, h('h3', { text: 'Twoi kierowcy' }));
    list.forEach(function (d) {
      left.appendChild(h('button', { type: 'button', class: 'card' + (d.id === cre.driverId ? ' on' : ''), onclick: function () { cre.driverId = d.id; UI.creator(); } },
        h('div', { class: 'row', style: 'flex-wrap:nowrap' }, helmet(d.helmet, 2), h('div', { class: 'col', style: 'gap:0' }, h('b', { text: PG.driverName(d) }), h('span', { class: 'muted', style: 'font-size:13px', text: '#' + d.num + ' · ' + (PG.NATIONS[d.nat] || {}).name })))));
    });
    left.appendChild(h('button', { type: 'button', class: 'primary', text: '+ Nowy kierowca', onclick: function () { var d = PG.newDriver(); list.push(d); cre.driverId = d.id; Store.save(); UI.creator(); } }));
    var right = h('div', { class: 'panel col' });
    var d = list.find(function (x) { return x.id === cre.driverId; });
    if (!d) right.appendChild(h('p', { class: 'muted', text: 'Stwórz pierwszego kierowcę: imię, narodowość, numer, kask i umiejętności. Możesz nim pojechać w szybkim wyścigu i w karierze.' }));
    else {
      right.appendChild(UI.driverEditor(d, function () { }));
      var del = h('button', { type: 'button', class: 'danger', text: 'Usuń kierowcę' });
      del.onclick = function () { confirmInline(del, 'Usunąć ' + PG.driverName(d) + '?', function () { Store.data.drivers = list.filter(function (x) { return x !== d; }); cre.driverId = null; Store.save(); UI.creator(); }); };
      right.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', text: 'Gotowe', onclick: function () { UI.toast('Zapisano kierowcę'); UI.creator(); } }), del));
    }
    g2.appendChild(left); g2.appendChild(right);
    return g2;
  }

  function creatorTeams() {
    var list = Store.data.teams;
    if (!cre.teamId && list.length) cre.teamId = list[0].id;
    var g2 = h('div', { class: 'grid2', style: 'grid-template-columns:minmax(220px,320px) minmax(0,1fr)' });
    var left = h('div', { class: 'panel col' }, h('h3', { text: 'Twoje zespoły' }));
    list.forEach(function (t) {
      left.appendChild(h('button', { type: 'button', class: 'card' + (t.id === cre.teamId ? ' on' : ''), onclick: function () { cre.teamId = t.id; UI.creator(); } },
        teamStripe(t), h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { text: t.name }), carImg(t.livery, null, 2))));
    });
    left.appendChild(h('button', { type: 'button', class: 'primary', text: '+ Nowy zespół', onclick: function () { var t = PG.newTeam(); list.push(t); cre.teamId = t.id; Store.save(); UI.creator(); } }));
    var right = h('div', { class: 'panel col' });
    var t = list.find(function (x) { return x.id === cre.teamId; });
    if (!t) right.appendChild(h('p', { class: 'muted', text: 'Załóż własny zespół: nazwa, kraj, dostawca silnika, kierowcy i malowanie bolidu. Możesz nim startować w szybkim wyścigu i jako właściciel w karierze.' }));
    else {
      var save = function () { Store.save(); };
      var prev = h('div', { class: 'row' });
      var drawPrev = function () { prev.innerHTML = ''; prev.appendChild(carImg(t.livery, null, 6)); prev.appendChild(h('div', { class: 'col', style: 'gap:2px' }, h('b', { style: 'font-size:22px', text: t.name }), h('span', { class: 'row', style: 'gap:6px' }, flag(t.country, 2), h('span', { class: 'muted', text: t.short + ' · silnik ' + t.engine })))); };
      drawPrev();
      right.appendChild(prev);
      var nm = h('input', { type: 'text', id: 'tName', maxlength: 24, value: t.name, oninput: function () { t.name = nm.value.trim() || 'Mój Zespół'; drawPrev(); save(); } });
      var sh = h('input', { type: 'text', id: 'tShort', maxlength: 3, value: t.short, oninput: function () { t.short = (sh.value.trim() || 'MOJ').toUpperCase(); drawPrev(); save(); } });
      var ct = h('select', { id: 'tCountry', onchange: function () { t.country = ct.value; drawPrev(); save(); } });
      Object.keys(PG.NATIONS).forEach(function (k) { ct.appendChild(h('option', { value: k, text: PG.NATIONS[k].name, selected: k === t.country })); });
      right.appendChild(h('div', { class: 'grid2', style: 'grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px' }, h('label', { class: 'field' }, 'Nazwa', nm), h('label', { class: 'field' }, 'Skrót (3 litery)', sh), h('label', { class: 'field' }, 'Kraj', ct)));
      right.appendChild(h('label', { class: 'field' }, 'Dostawca silnika', seg(Object.keys(PG.ENGINES).map(function (k) { return [k, k + (PG.ENGINES[k].power > 0 ? ' (+' + PG.ENGINES[k].power + ')' : PG.ENGINES[k].power < 0 ? ' (' + PG.ENGINES[k].power + ')' : '')]; }), t.engine, function (v) { t.engine = v; drawPrev(); save(); })));
      t.driverIds = t.driverIds || [];
      [0, 1].forEach(function (i) {
        var sel = h('select', { id: 'tDrv' + i, onchange: function () { t.driverIds[i] = sel.value || null; save(); } });
        sel.appendChild(h('option', { value: '', text: 'Debiutant z akademii (automatycznie)' }));
        Store.data.drivers.forEach(function (d) { sel.appendChild(h('option', { value: d.id, text: PG.driverName(d), selected: t.driverIds[i] === d.id })); });
        right.appendChild(h('label', { class: 'field' }, 'Kierowca ' + (i + 1), sel));
      });
      right.appendChild(h('p', { class: 'muted', style: 'font-size:13px', text: 'Nowy zespół zaczyna z bolidem środka stawki. W karierze właściciela rozwijasz go za zarobione pieniądze.' }));
      var del = h('button', { type: 'button', class: 'danger', text: 'Usuń zespół' });
      del.onclick = function () { confirmInline(del, 'Usunąć ' + t.name + '?', function () { Store.data.teams = list.filter(function (x) { return x !== t; }); cre.teamId = null; Store.save(); UI.creator(); }); };
      right.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', text: 'Malowanie bolidu →', onclick: function () { cre.liveryTeam = t.id; UI.creator('livery'); } }), del));
    }
    g2.appendChild(left); g2.appendChild(right);
    return g2;
  }

  function creatorLivery() {
    var teams = PG.allTeams();
    if (!cre.liveryTeam || !teams.find(function (t) { return t.id === cre.liveryTeam; })) cre.liveryTeam = teams[0].id;
    var team = teams.find(function (t) { return t.id === cre.liveryTeam; });
    var custom = Store.data.teams.find(function (t) { return t.id === team.id; });
    // edytowany obiekt malowania (własny zespół lub nadpisanie domyślnego)
    var lv;
    if (custom) lv = custom.livery;
    else { if (!Store.data.liveryOverrides[team.id]) Store.data.liveryOverrides[team.id] = PG.clone(team.livery); lv = Store.data.liveryOverrides[team.id]; }
    lv.paint2 = lv.paint2 || {};
    var save = function () { Store.save(); G.clearLiveryCache(); UI.clearSnapshots(); if (showroom) showroom.setCar(lv, { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' }, { compound: '#f2f2f2' }); };
    var showroom = null;
    var g2 = h('div', { class: 'grid2', style: 'grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr)' });
    var left = h('div', { class: 'panel col' });
    var sel = h('select', { id: 'lvTeam', onchange: function () { cre.liveryTeam = sel.value; UI.creator(); } });
    teams.forEach(function (t) { sel.appendChild(h('option', { value: t.id, text: t.name + (t.custom ? ' (własny)' : ''), selected: t.id === team.id })); });
    left.appendChild(h('label', { class: 'field' }, 'Zespół', sel));
    // duży bolid z siatką do malowania
    var PW = PG.PAINT_W, PH = PG.PAINT_H, B = PG.CAR_BOX, mask = PG.paintMask();
    var grid = h('canvas', { class: 'paintcv', role: 'img', 'aria-label': 'Bolid z góry z siatką do malowania ' + PW + ' na ' + PH + ' pól' });
    var gctx = grid.getContext('2d');
    var hover = null;
    function paintCells() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var cssW = grid.clientWidth || 600, cssH = Math.round(cssW * (B.y1 - B.y0 + 0.3) / (B.x1 - B.x0 + 0.3));
      grid.style.height = cssH + 'px';
      if (grid.width !== Math.round(cssW * dpr)) { grid.width = Math.round(cssW * dpr); grid.height = Math.round(cssH * dpr); }
      var g = gctx, k = grid.width / (B.x1 - B.x0 + 0.3);
      g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#2c3036'; g.fillRect(0, 0, grid.width, grid.height);
      g.translate(grid.width / 2, grid.height / 2); g.scale(k, k);
      PG.drawCarShape(g, lv, { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' }, { compound: '#e8e8e8' });
      var cw = (B.x1 - B.x0) / PW, ch = (B.y1 - B.y0) / PH;
      g.lineWidth = 1 / k;
      for (var y = 0; y < PH; y++) for (var x = 0; x < PW; x++) {
        if (!mask[y * PW + x]) continue;
        g.strokeStyle = 'rgba(255,255,255,0.13)'; g.strokeRect(B.x0 + x * cw, B.y0 + y * ch, cw, ch);
      }
      if (hover) hover.forEach(function (p) { g.lineWidth = 2.5 / k; g.strokeStyle = '#ffc93c'; g.strokeRect(B.x0 + p[0] * cw, B.y0 + p[1] * ch, cw, ch); });
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    function cellsAt(e) {
      var r = grid.getBoundingClientRect(), k = r.width / (B.x1 - B.x0 + 0.3);
      var mx = (e.clientX - r.left - r.width / 2) / k, my = (e.clientY - r.top - r.height / 2) / k;
      var x = Math.floor((mx - B.x0) / (B.x1 - B.x0) * PW), y = Math.floor((my - B.y0) / (B.y1 - B.y0) * PH);
      if (x < 0 || y < 0 || x >= PW || y >= PH) return [];
      var t = [[x, y]]; if (cre.mirror && y !== PH - 1 - y) t.push([x, PH - 1 - y]);
      return t.filter(function (p) { return mask[p[1] * PW + p[0]]; });
    }
    var preview = h('canvas', { class: 'preview-strip' });
    function drawPreview() {
      var dpr = Math.min(2, window.devicePixelRatio || 1), Wc = 380, Hc = 120;
      preview.width = Wc * dpr; preview.height = Hc * dpr; preview.style.width = '100%'; preview.style.maxWidth = Wc + 'px';
      var g = preview.getContext('2d'); g.scale(dpr, dpr);
      g.fillStyle = '#3d4249'; g.fillRect(0, 0, Wc, Hc);
      g.fillStyle = '#e6e6dd'; g.fillRect(0, 10, Wc, 2); g.fillRect(0, Hc - 12, Wc, 2);
      for (var k = 0; k < Wc; k += 18) { g.fillStyle = (k / 18) % 2 ? '#cf2a2a' : '#ececec'; g.fillRect(k, 0, 18, 9); g.fillRect(k, Hc - 9, 18, 9); }
      var tex = PG.carTexture(lv, { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' }, { compound: '#e8e8e8' });
      [[80, 60, 0], [200, 60, -0.35], [310, 60, Math.PI]].forEach(function (c) {
        g.save(); g.translate(c[0], c[1]); g.rotate(c[2]);
        var w = 100, hh = w * tex.height / tex.width; g.drawImage(tex, -w / 2, -hh / 2, w, hh); g.restore();
      });
    }
    var painting = false;
    function paintAt(e) {
      cellsAt(e).forEach(function (p) {
        var key = p[0] + ',' + p[1];
        if (cre.tool === 'erase') delete lv.paint2[key]; else lv.paint2[key] = cre.color;
      });
      hover = cellsAt(e); paintCells();
    }
    grid.addEventListener('pointerdown', function (e) { painting = true; grid.setPointerCapture(e.pointerId); paintAt(e); });
    grid.addEventListener('pointermove', function (e) { if (painting) paintAt(e); else { hover = cellsAt(e); paintCells(); } });
    grid.addEventListener('pointerleave', function () { hover = null; paintCells(); });
    var end = function () { if (painting) { painting = false; save(); drawPreview(); } };
    grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', end);
    left.appendChild(h('h3', { text: 'Malowanie ręczne' }));
    left.appendChild(grid);
    requestAnimationFrame(paintCells);
    // narzędzia
    var colIn = h('input', { type: 'color', id: 'lvBrush', value: cre.color, oninput: function () { cre.color = colIn.value; markSw(); } });
    var sw = h('div', { class: 'swatches' });
    function markSw() { Array.prototype.forEach.call(sw.children, function (b) { b.classList.toggle('on', b.dataset.c === cre.color); }); }
    SWATCH.forEach(function (c) { var b = h('button', { type: 'button', style: 'background:' + c, 'aria-label': 'Kolor ' + c, onclick: function () { cre.color = c; colIn.value = c; cre.tool = 'brush'; markSw(); toolSeg.querySelector('button').click(); } }); b.dataset.c = c; sw.appendChild(b); });
    markSw();
    var toolSeg = seg([['brush', 'Pędzel'], ['erase', 'Gumka']], cre.tool, function (v) { cre.tool = v; });
    left.appendChild(h('div', { class: 'row' }, toolSeg, seg([[true, 'Lustro: wł.'], [false, 'Lustro: wył.']], cre.mirror, function (v) { cre.mirror = v; }), h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'muted', text: 'Kolor' }), colIn)));
    left.appendChild(sw);
    left.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', class: 'small', text: 'Wyczyść ręczne malowanie', onclick: function () { lv.paint2 = {}; save(); paintCells(); drawPreview(); } }),
      !custom ? h('button', { type: 'button', class: 'small', text: 'Przywróć oryginał', onclick: function () { delete Store.data.liveryOverrides[team.id]; save(); UI.creator(); } }) : null));
    var right = h('div', { class: 'panel col' });
    right.appendChild(h('h3', { text: 'Kolory i wzór' }));
    [['primary', 'Główny'], ['secondary', 'Drugi'], ['accent', 'Akcent']].forEach(function (k) {
      var inp = h('input', { type: 'color', id: 'lv_' + k[0], value: lv[k[0]], oninput: function () { lv[k[0]] = inp.value; paintCells(); } , onchange: function () { save(); drawPreview(); } });
      right.appendChild(h('label', { class: 'row', style: 'gap:10px' }, inp, h('span', { text: k[1] })));
    });
    right.appendChild(h('label', { class: 'field' }, 'Wzór', seg(PG.PATTERNS.map(function (p) { return [p.id, p.name]; }), lv.pattern, function (v) { lv.pattern = v; save(); paintCells(); drawPreview(); })));
    if (G.use3D && PG.Car3D && PG.Car3D.Showroom) {
      right.appendChild(h('h3', { text: 'Podgląd 3D (przeciągnij, by obrócić)' }));
      var box3 = h('div', { class: 'showroom' });
      right.appendChild(box3);
      requestAnimationFrame(function () {
        try {
          showroom = new PG.Car3D.Showroom(box3, {});
          showroom.setCar(lv, { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' }, { compound: '#f2f2f2' });
          UI.onLeave(function () { showroom.dispose(); showroom = null; });
        } catch (e) { box3.replaceWith(preview); }
      });
      right.appendChild(h('h3', { text: 'Podgląd z góry' }));
    } else right.appendChild(h('h3', { text: 'Podgląd na torze' }));
    right.appendChild(preview);
    right.appendChild(h('p', { class: 'muted', style: 'font-size:13px', text: 'Malowanie ręczne leży nad wzorem. Opony, podłoga, halo i kask zostają bez zmian.' }));
    g2.appendChild(left); g2.appendChild(right);
    paintCells(); drawPreview();
    return g2;
  }

  // ---------- KARIERA: nowa ----------
  var wiz = {};
  UI.careerNew = function () {
    wiz = { step: 1, mode: 'driver', teamId: null, ownTeamId: null, driverId: null, difficulty: Store.data.settings.difficulty, laps: 5 };
    if (!Store.data.drivers.length) { var d = PG.newDriver(); Store.data.drivers.push(d); Store.save(); }
    wiz.driverId = Store.data.drivers[0].id;
    UI.careerStep();
  };
  UI.careerStep = function () {
    var s = screen('careerNew', 'dim');
    var w = h('div', { class: 'wrap', style: 'max-width:980px' });
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { text: 'Nowa kariera · krok ' + wiz.step + ' z 3' }), h('button', { type: 'button', text: '← Menu', onclick: UI.menu })));
    if (wiz.step === 1) {
      var g2 = h('div', { class: 'grid2', style: 'grid-template-columns:minmax(220px,300px) minmax(0,1fr)' });
      var left = h('div', { class: 'panel col' }, h('h3', { text: 'Wybierz kierowcę' }));
      Store.data.drivers.forEach(function (d) {
        left.appendChild(h('button', { type: 'button', class: 'card' + (d.id === wiz.driverId ? ' on' : ''), onclick: function () { wiz.driverId = d.id; UI.careerStep(); } },
          h('div', { class: 'row', style: 'flex-wrap:nowrap' }, helmet(d.helmet, 2), h('b', { text: PG.driverName(d) }))));
      });
      left.appendChild(h('button', { type: 'button', text: '+ Nowy kierowca', onclick: function () { var d = PG.newDriver(); Store.data.drivers.push(d); wiz.driverId = d.id; Store.save(); UI.careerStep(); } }));
      var d0 = Store.data.drivers.find(function (x) { return x.id === wiz.driverId; });
      var right = h('div', { class: 'panel col' }, UI.driverEditor(d0));
      right.appendChild(h('button', { type: 'button', class: 'primary', text: 'Dalej →', onclick: function () { wiz.step = 2; UI.careerStep(); } }));
      g2.appendChild(left); g2.appendChild(right); w.appendChild(g2);
    } else if (wiz.step === 2) {
      var p = h('div', { class: 'panel col' });
      p.appendChild(h('h3', { text: 'Twoja droga' }));
      p.appendChild(seg([['driver', 'Kierowca wyścigowy'], ['owner', 'Właściciel zespołu']], wiz.mode, function (v) { wiz.mode = v; UI.careerStep(); }));
      if (wiz.mode === 'driver') {
        p.appendChild(h('p', { class: 'muted', text: 'Trzy zespoły z końca stawki chcą Cię zatrudnić. Dobre wyniki podnoszą reputację, a po sezonie przychodzą oferty z lepszych ekip.' }));
        var teams = PG.allTeams().filter(function (t) { return !t.custom; }).sort(function (a, b) { return PG.teamRating(a) - PG.teamRating(b); }).slice(0, 3);
        if (!wiz.teamId || !teams.find(function (t) { return t.id === wiz.teamId; })) wiz.teamId = teams[0].id;
        var gg = h('div', { class: 'grid3' });
        teams.forEach(function (t) {
          gg.appendChild(h('button', { type: 'button', class: 'card' + (t.id === wiz.teamId ? ' on' : ''), onclick: function () { wiz.teamId = t.id; UI.careerStep(); } },
            teamStripe(t), h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { text: t.name }), carImg(t.livery, null, 2)),
            statRow('Silnik', t.car.power), statRow('Aero', t.car.aero), statRow('Opony', t.car.tyre),
            h('span', { class: 'muted', style: 'font-size:13px', text: 'Pensja ' + money(({ 1: 420, 2: 260, 3: 150 })[t.tier] || 150) + ' za rundę' })));
        });
        p.appendChild(gg);
      } else {
        p.appendChild(h('p', { class: 'muted', text: 'Startujesz własnym zespołem jako 11. ekipa w stawce. Masz 1 500 tys. € na start i sam kupujesz ulepszenia bolidu.' }));
        var own = Store.data.teams;
        if (!own.length) { own.push(PG.newTeam()); Store.save(); }
        if (!wiz.ownTeamId || !own.find(function (t) { return t.id === wiz.ownTeamId; })) wiz.ownTeamId = own[0].id;
        var gg2 = h('div', { class: 'grid3' });
        own.forEach(function (t) {
          gg2.appendChild(h('button', { type: 'button', class: 'card' + (t.id === wiz.ownTeamId ? ' on' : ''), onclick: function () { wiz.ownTeamId = t.id; UI.careerStep(); } },
            teamStripe(t), h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { text: t.name }), carImg(t.livery, null, 2)), h('span', { class: 'muted', style: 'font-size:13px', text: 'Silnik ' + t.engine })));
        });
        p.appendChild(gg2);
        p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', text: 'Edytuj zespół i malowanie w kreatorze', onclick: function () { cre.teamId = wiz.ownTeamId; UI.creator('teams'); } })));
      }
      p.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', text: '← Wstecz', onclick: function () { wiz.step = 1; UI.careerStep(); } }), h('button', { type: 'button', class: 'primary', text: 'Dalej →', onclick: function () { wiz.step = 3; UI.careerStep(); } })));
      w.appendChild(p);
    } else {
      var p3 = h('div', { class: 'panel col', style: 'max-width:560px' });
      p3.appendChild(h('h3', { text: 'Sezon' }));
      p3.appendChild(h('p', { text: PG.CALENDAR.length + ' rund na Monzy, każda z kwalifikacjami i wyścigiem. Pogoda zmienia się między rundami.' }));
      p3.appendChild(h('label', { class: 'field' }, 'Poziom rywali', seg([['easy', 'Łatwy'], ['normal', 'Normalny'], ['hard', 'Trudny']], wiz.difficulty, function (v) { wiz.difficulty = v; })));
      p3.appendChild(h('label', { class: 'field' }, 'Długość wyścigu', seg([[3, '3 okr.'], [5, '5 okr.'], [10, '10 okr.']], wiz.laps, function (v) { wiz.laps = v; })));
      p3.appendChild(h('div', { class: 'row' }, h('button', { type: 'button', text: '← Wstecz', onclick: function () { wiz.step = 2; UI.careerStep(); } }),
        h('button', { type: 'button', class: 'primary', text: 'Rozpocznij karierę', onclick: function () {
          var drv = Store.data.drivers.find(function (x) { return x.id === wiz.driverId; });
          var ownT = Store.data.teams.find(function (x) { return x.id === wiz.ownTeamId; });
          C.start({ driver: drv, mode: wiz.mode, teamId: wiz.teamId, ownTeam: ownT, difficulty: wiz.difficulty, laps: wiz.laps });
          hubTab = 'weekend';
          UI.hub();
        } })));
      w.appendChild(p3);
    }
    s.appendChild(w);
  };

  // ---------- KARIERA: centrum ----------
  var hubTab = 'weekend';
  UI.hub = function () {
    var car = C.get(); if (!car) { UI.menu(); return; }
    if (G.mode !== 'attract') G.startAttract();
    var s = screen('hub', 'dim');
    var team = C.team(car), me = C.player(car);
    var w = h('div', { class: 'wrap' });
    // nagłówek
    var head = h('div', { class: 'panel', style: 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;border-left:8px solid ' + team.livery.primary });
    head.appendChild(helmet(me.helmet, 3));
    head.appendChild(h('div', { class: 'col', style: 'gap:2px;min-width:0' }, h('b', { style: 'font-size:22px', text: PG.driverName(me) }), h('span', { class: 'row', style: 'gap:6px' }, flag(me.nat, 2), h('span', { class: 'muted', text: team.name + (car.mode === 'owner' ? ' · właściciel' : '') }))));
    head.appendChild(carImg(team.livery, me.helmet, 6));
    head.appendChild(h('div', { class: 'kv', style: 'margin-left:auto' },
      h('span', { text: 'Sezon' }), h('span', { class: 'num', style: 'font-size:20px', text: car.season + ' · runda ' + Math.min(car.round + 1, PG.CALENDAR.length) + '/' + PG.CALENDAR.length }),
      h('span', { text: 'Pieniądze' }), h('span', { class: 'num', style: 'font-size:20px', text: money(car.money) }),
      h('span', { text: 'Reputacja' }), h('span', { style: 'display:flex;align-items:center;gap:8px' }, h('span', { style: 'width:90px' }, bar(car.rep, 100)), h('span', { class: 'num', style: 'font-size:20px', text: String(Math.round(car.rep)) })),
      h('span', { text: 'Doświadczenie' }), h('span', { class: 'num', style: 'font-size:20px', text: car.xp + ' PD' })));
    w.appendChild(head);
    var tabs = h('div', { class: 'tabs' });
    [['weekend', 'Weekend'], ['stand', 'Klasyfikacja'], ['car', 'Bolid'], ['driver', 'Kierowca'], ['hist', 'Historia']].forEach(function (t) {
      tabs.appendChild(h('button', { type: 'button', class: hubTab === t[0] ? 'on' : '', text: t[1], onclick: function () { hubTab = t[0]; UI.hub(); } }));
    });
    w.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, tabs, h('button', { type: 'button', text: '← Menu', onclick: UI.menu })));
    var body = h('div', { class: 'grid2' });
    if (hubTab === 'weekend') hubWeekend(car, body);
    else if (hubTab === 'stand') hubStandings(car, body);
    else if (hubTab === 'car') hubCar(car, body);
    else if (hubTab === 'driver') hubDriver(car, body);
    else hubHistory(car, body);
    w.appendChild(body);
    s.appendChild(w);
  };

  function hubWeekend(car, body) {
    if (car.seasonOver) {
      var ss = car.seasons[car.seasons.length - 1];
      var p = h('div', { class: 'panel col' }, h('h3', { text: 'Koniec sezonu ' + ss.season }),
        h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + ss.myPos }), h('div', { class: 'col', style: 'gap:2px' }, h('b', { text: ss.myPos === 1 ? 'Jesteś mistrzem świata!' : 'Twoje miejsce w mistrzostwach' }), h('span', { class: 'muted', text: ss.myPts + ' pkt · zespół P' + ss.teamPos }))),
        h('div', { class: 'kv' }, h('span', { text: 'Mistrz kierowców' }), h('span', { text: ss.champion + ' (' + ss.championTeam + ')' }), h('span', { text: 'Mistrz konstruktorów' }), h('span', { text: ss.cTeam })));
      body.appendChild(p);
      var o = h('div', { class: 'panel col' });
      if (car.mode === 'driver') {
        o.appendChild(h('h3', { text: 'Oferty na kolejny sezon' }));
        if (!car.offers.length) o.appendChild(h('p', { class: 'muted', text: 'Brak ofert. Reputacja jest za niska, żeby lepsze zespoły się odezwały.' }));
        car.offers.forEach(function (of) {
          var t = C.team(car, of.teamId);
          o.appendChild(h('div', { class: 'card', style: 'cursor:default' }, teamStripe(t), h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { text: t.name }), carImg(t.livery, null, 2)),
            h('span', { class: 'muted', style: 'font-size:13px', text: 'Osiągi bolidu ' + Math.round(PG.teamRating(t)) + ' · pensja ' + money(of.salary) + ' za rundę' }),
            h('button', { type: 'button', class: 'primary small', text: 'Podpisz kontrakt', onclick: function () { C.nextSeason(car, of.teamId, of.salary); UI.toast('Witamy w ' + t.name + '!'); UI.hub(); } })));
        });
        o.appendChild(h('button', { type: 'button', text: 'Zostań w ' + C.team(car).name, onclick: function () { C.nextSeason(car, null); UI.hub(); } }));
      } else {
        o.appendChild(h('h3', { text: 'Następny sezon' }));
        o.appendChild(h('p', { text: 'Premia za miejsce w konstruktorach trafiła do budżetu. Bolidy rywali częściowo wracają do średniej po zmianie przepisów.' }));
        o.appendChild(h('button', { type: 'button', class: 'primary', text: 'Rozpocznij sezon ' + (car.season + 1), onclick: function () { C.nextSeason(car, null); UI.hub(); } }));
      }
      body.appendChild(o);
      return;
    }
    var rd = PG.CALENDAR[car.round], W = PG.WEATHER[rd.weather];
    var p2 = h('div', { class: 'panel col' }, h('h3', { text: 'Runda ' + (car.round + 1) + ' z ' + PG.CALENDAR.length }), h('h2', { text: rd.name }),
      h('div', { class: 'kv' }, h('span', { text: 'Tor' }), h('span', { text: G.T.name }), h('span', { text: 'Prognoza' }), h('span', { text: W.name }), h('span', { text: 'Dystans' }), h('span', { text: car.laps + ' okrążeń' }), h('span', { text: 'Rywale' }), h('span', { text: PG.DIFF_NAMES[car.difficulty] })),
      h('button', { type: 'button', class: 'primary', text: 'Rozpocznij weekend →', onclick: function () {
        UI.weekend({ entries: C.entries(car), laps: car.laps, weather: rd.weather, difficulty: car.difficulty, title: 'Sezon ' + car.season + ' · ' + rd.name, career: true, onExit: UI.hub });
      } }));
    body.appendChild(p2);
    var rep = car.lastReport;
    var p3 = h('div', { class: 'panel col' });
    if (rep) {
      p3.appendChild(h('h3', { text: 'Ostatni wyścig: ' + rep.name }));
      p3.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + rep.pos }), h('div', { class: 'kv' }, h('span', { text: 'Punkty' }), h('span', { text: '+' + rep.pts }), h('span', { text: 'Pieniądze' }), h('span', { text: '+' + money(rep.money) }), h('span', { text: 'Reputacja' }), h('span', { text: (rep.rep >= 0 ? '+' : '') + rep.rep }))));
    } else {
      p3.appendChild(h('h3', { text: 'Cel na sezon' }));
      p3.appendChild(h('p', { text: 'Twój bolid jest oceniany na okolice P' + Math.round(C.expectedPos(car)) + '. Każdy wynik lepszy od oczekiwań podnosi reputację.' }));
    }
    var top = C.sortedDrivers(car).slice(0, 5);
    var t = h('table', { class: 'tbl' });
    top.forEach(function (x, i) { t.appendChild(h('tr', { class: x.d.isPlayer ? 'me' : '' }, h('td', { class: 'num', text: String(i + 1) }), h('td', {}, h('span', { class: 'teamchip', style: 'background:' + x.t.livery.primary }), PG.driverName(x.d)), h('td', { class: 'num', text: String(x.pts) }))); });
    p3.appendChild(h('h3', { text: 'Czołówka mistrzostw' }));
    p3.appendChild(t);
    body.appendChild(p3);
  }

  function hubStandings(car, body) {
    var t1 = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Kierowca' }), h('th', { text: 'Zespół' }), h('th', { class: 'num', text: 'Pkt' })));
    C.sortedDrivers(car).forEach(function (x, i) {
      t1.appendChild(h('tr', { class: x.d.isPlayer ? 'me' : '' }, h('td', { class: 'num', text: String(i + 1) }), h('td', {}, h('span', { class: 'teamchip', style: 'background:' + x.t.livery.primary }), PG.driverName(x.d)), h('td', { class: 'muted', text: x.t.short }), h('td', { class: 'num', text: String(x.pts) })));
    });
    var t2 = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Zespół' }), h('th', { class: 'num', text: 'Pkt' })));
    C.sortedTeams(car).forEach(function (x, i) {
      t2.appendChild(h('tr', { class: x.t.id === car.teamId ? 'me' : '' }, h('td', { class: 'num', text: String(i + 1) }), h('td', {}, h('span', { class: 'teamchip', style: 'background:' + x.t.livery.primary }), x.t.name), h('td', { class: 'num', text: String(x.pts) })));
    });
    body.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Kierowcy' }), h('div', { class: 'tblwrap' }, t1)));
    body.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Konstruktorzy' }), h('div', { class: 'tblwrap' }, t2)));
  }

  function hubCar(car, body) {
    var t = C.team(car);
    var best = { power: 0, aero: 0, tyre: 0 };
    car.teams.forEach(function (x) { ['power', 'aero', 'tyre'].forEach(function (k) { best[k] = Math.max(best[k], x.car[k]); }); });
    var p = h('div', { class: 'panel col' }, h('h3', { text: 'Bolid ' + t.name }), carView(t.livery, C.player(car).helmet));
    [['power', 'Silnik'], ['aero', 'Aerodynamika'], ['tyre', 'Opony']].forEach(function (k) {
      var extra = null;
      if (car.mode === 'owner') {
        var cost = C.upgradeCost(t.car[k[0]]);
        extra = h('button', { type: 'button', class: 'small', disabled: car.money < cost || t.car[k[0]] >= 99, text: '+1 · ' + cost + ' tys.', onclick: function () { if (C.upgrade(car, k[0])) { UI.toast(k[1] + ' ulepszony'); UI.hub(); } } });
      }
      p.appendChild(statRow(k[1], t.car[k[0]], extra));
      p.appendChild(h('span', { class: 'muted', style: 'font-size:12px;margin-top:-6px', text: 'Najlepszy w stawce: ' + best[k[0]] }));
    });
    body.appendChild(p);
    var f = h('div', { class: 'panel col' }, h('h3', { text: 'Kierunek rozwoju' }),
      h('p', { text: 'Po każdej rundzie inżynierowie przynoszą nowe części. Wybrany obszar rozwija się szybciej.' }),
      seg([['power', 'Silnik'], ['aero', 'Aerodynamika'], ['tyre', 'Opony']], car.focus, function (v) { car.focus = v; Store.save(); UI.toast('Inżynierowie skupią się na tym obszarze'); }),
      h('p', { class: 'muted', style: 'font-size:14px', text: 'Silnik daje prędkość na prostych Monzy, aerodynamika szybsze zakręty i hamowanie, opony mniejsze zużycie i więcej przyczepności.' }));
    if (car.mode === 'owner') f.appendChild(h('p', { class: 'muted', style: 'font-size:14px', text: 'Jako właściciel możesz też kupić ulepszenie od razu. Koszt rośnie z poziomem części.' }));
    body.appendChild(f);
  }

  function hubDriver(car, body) {
    var me = C.player(car);
    var p = h('div', { class: 'panel col' }, h('div', { class: 'row' }, helmet(me.helmet, 4), h('div', { class: 'col', style: 'gap:2px' }, h('b', { style: 'font-size:22px', text: PG.driverName(me) }), h('span', { class: 'muted', text: '#' + me.num + ' · ' + (PG.NATIONS[me.nat] || {}).name }))));
    [['pace', 'Tempo'], ['start', 'Start'], ['tyre', 'Opony'], ['wet', 'Deszcz']].forEach(function (k) {
      var cost = C.trainCost(me[k[0]]);
      p.appendChild(statRow(k[1], me[k[0]], h('button', { type: 'button', class: 'small', disabled: car.xp < cost || me[k[0]] >= 99, text: '+1 · ' + cost + ' PD', onclick: function () { if (C.train(car, k[0])) UI.hub(); } })));
    });
    body.appendChild(p);
    body.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Trening' }), h('p', { text: 'Punkty doświadczenia zdobywasz w każdym wyścigu, więcej za dobre miejsca. Wydawaj je na trening umiejętności.' }),
      h('p', { class: 'muted', style: 'font-size:14px', text: 'Tempo: trochę więcej przyczepności. Start: lepsze ruszanie ze świateł. Opony: wolniejsze zużycie. Deszcz: pewniej na mokrym torze.' })));
  }

  function hubHistory(car, body) {
    var t = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Sezon' }), h('th', { text: 'Wyścig' }), h('th', { class: 'num', text: 'Start' }), h('th', { class: 'num', text: 'Meta' }), h('th', { class: 'num', text: 'Pkt' })));
    car.history.slice().reverse().forEach(function (r) { t.appendChild(h('tr', {}, h('td', { class: 'num', text: String(r.season) }), h('td', { text: r.name }), h('td', { class: 'num', text: 'P' + r.grid }), h('td', { class: 'num', text: 'P' + r.pos }), h('td', { class: 'num', text: String(r.pts) }))); });
    body.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Wyścigi' }), car.history.length ? h('div', { class: 'tblwrap' }, t) : h('p', { class: 'muted', text: 'Jeszcze żadnego wyścigu. Pierwsza runda czeka w zakładce Weekend.' })));
    var p = h('div', { class: 'panel col' }, h('h3', { text: 'Sezony' }));
    if (!car.seasons.length) p.appendChild(h('p', { class: 'muted', text: 'Podsumowania sezonów pojawią się tutaj.' }));
    car.seasons.forEach(function (s) { p.appendChild(h('div', { class: 'kv' }, h('span', { text: 'Sezon ' + s.season }), h('span', { text: 'P' + s.myPos + ' · ' + s.myPts + ' pkt · mistrz: ' + s.champion }))); });
    var del = h('button', { type: 'button', class: 'danger', text: 'Zakończ karierę' });
    del.onclick = function () { confirmInline(del, 'Usunąć tę karierę?', function () { Store.data.career = null; Store.save(); UI.menu(); }); };
    p.appendChild(del);
    body.appendChild(p);
  }

  // ---------- PAD W MENU: krzyżak/gałka wybiera, ✕ zatwierdza, ○ wraca ----------
  var padFocusEl = null;
  function topScreen() {
    if (!root) return null;
    for (var el = root.lastElementChild; el; el = el.previousElementSibling) if (el.classList && el.classList.contains('screen')) return el;
    return null;
  }
  function focusables(scr) {
    var all = scr.querySelectorAll('button, select, input, textarea, [tabindex]'), out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.disabled || el.type === 'hidden' || el.getAttribute('tabindex') === '-1') continue;
      if (!el.getClientRects().length) continue; // niewidoczny
      out.push(el);
    }
    return out;
  }
  UI.padFocus = function (el) {
    if (padFocusEl && padFocusEl !== el) padFocusEl.classList.remove('padfocus');
    padFocusEl = el || null;
    if (!el) return;
    el.classList.add('padfocus');
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* nic */ } }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e3) { /* nic */ }
  };
  function backButton(scr, list) {
    var b = scr.querySelector('[data-back]');
    if (b && !b.disabled) return b;
    for (var i = 0; i < list.length; i++) {
      var t = (list[i].textContent || '').trim();
      if (t.charAt(0) === '←' || t === 'Wróć' || t === 'Menu') return list[i];
    }
    return null;
  }
  // Lista rozwijana i suwak: zmiana wartości w lewo/prawo
  function padAdjust(el, d, wrap) {
    if (el.tagName === 'SELECT') {
      var n = el.options.length;
      if (!n) return;
      var k = el.selectedIndex + d;
      if (wrap) k = (k + n) % n; else k = Math.max(0, Math.min(n - 1, k));
      if (k === el.selectedIndex) return;
      el.selectedIndex = k;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.type === 'range') {
      var mn = el.min === '' ? 0 : +el.min, mx = el.max === '' ? 100 : +el.max, step = (mx - mn) / 20;
      el.value = String(Math.max(mn, Math.min(mx, (+el.value || 0) + d * step)));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  UI.padNav = function (P) {
    if (!P || !P.connected || !root) return;
    var dir = P.nav, ok = P.hit('confirm'), back = P.hit('back');
    if (!dir && !ok && !back) return;
    var scr = topScreen();
    if (!scr) return;
    var list = focusables(scr);
    if (!list.length) return;
    if (back) { var b = backButton(scr, list); if (b) b.click(); return; }
    var cur = document.activeElement, i = list.indexOf(cur);
    if (i < 0) { // brak fokusu: zacznij od głównego przycisku ekranu
      var first = scr.querySelector('button.primary:not([disabled])');
      UI.padFocus(first && list.indexOf(first) >= 0 ? first : list[0]);
      return;
    }
    if (ok) {
      if (cur.tagName === 'SELECT') padAdjust(cur, 1, true);
      else if (cur.type === 'range') { /* suwak: lewo/prawo */ }
      else if (cur.tagName === 'TEXTAREA' || (cur.tagName === 'INPUT' && (cur.type === 'text' || cur.type === 'number'))) cur.focus();
      else cur.click();
      return;
    }
    if ((dir === 'left' || dir === 'right') && (cur.tagName === 'SELECT' || cur.type === 'range')) { padAdjust(cur, dir === 'right' ? 1 : -1, false); return; }
    var j = (dir === 'up' || dir === 'left') ? i - 1 : i + 1;
    if (j < 0) j = list.length - 1; else if (j >= list.length) j = 0;
    UI.padFocus(list[j]);
  };
  // mysz lub dotyk zdejmuje podświetlenie wyboru padem
  document.addEventListener('pointerdown', function () { if (padFocusEl) { padFocusEl.classList.remove('padfocus'); padFocusEl = null; } }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', UI.boot); else UI.boot();
})(PG);
