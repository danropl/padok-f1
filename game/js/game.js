// Monza Grand Prix — pętla gry, widok 3D/2D, kamery, sterowanie (klawiatura, dotyk, pad), wibracje, HUD.
(function (PG) {
  'use strict';
  var G = PG.Game = {
    S: null, mode: 'none', paused: false, timeScale: 1, input: {}, cam: { x: 0, y: 0 }, shake: 0,
    sheets: new Map(), last: 0, hudT: 0, msgT: 0, endT: 0, attractT: 0, attractCar: 0,
    focused: true, hapOn: false, hapErr: false, padErr: false, navErr: false, padUsed: false
  };

  var $ = function (id) { return document.getElementById(id); };
  function fin(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // ---------- USTAWIENIA: domyślne wartości nowych kluczy (career.js zostaje bez zmian) ----------
  var SET_DEF = { autoDrs: true, abs: false, tc: true, damage: 'full', haptics: true, hapticsGain: 0.8, trig: true, trigGain: 0.8, post: true };
  G.mergeSettings = function () {
    var st = PG.Store && PG.Store.data && PG.Store.data.settings;
    if (!st) return;
    // stary przełącznik „wskaźnik hamowania" → tryb linii jazdy
    if (st.racingLine !== 'full' && st.racingLine !== 'brake' && st.racingLine !== 'off') st.racingLine = st.brakeHint === false ? 'off' : 'full';
    Object.keys(SET_DEF).forEach(function (k) { if (st[k] === undefined || st[k] === null) st[k] = SET_DEF[k]; });
    if (st.damage !== 'off' && st.damage !== 'visual' && st.damage !== 'full') st.damage = 'full';
    var g = +st.hapticsGain;
    st.hapticsGain = isFinite(g) ? Math.max(0, Math.min(1, g)) : 0.8;
    st.autoDrs = !!st.autoDrs; st.abs = !!st.abs; st.tc = !!st.tc; st.haptics = !!st.haptics; st.post = !!st.post;
  };
  G.assistOpts = function () {
    var st = PG.Store.data.settings;
    return { abs: !!st.abs, tc: st.tc !== false, autoDrs: st.autoDrs !== false };
  };
  // Zmiana asyst w trakcie sesji (menu pauzy / ustawienia)
  G.syncAssists = function () {
    if (!G.S) return;
    var o = G.assistOpts(), a = G.S.assists;
    if (!a) a = G.S.assists = {};
    a.abs = o.abs; a.tc = o.tc; a.autoDrs = o.autoDrs;
    G.drsState = ''; // przerysuj znacznik AUTO
  };
  G.lineMode = function () {
    var m = PG.Store.data.settings.racingLine;
    return (m === 'full' || m === 'brake' || m === 'off') ? m : 'full';
  };

  G.init = function (onProgress, onReady) {
    G.mergeSettings();
    G.canvas = $('game'); G.ctx = G.canvas.getContext('2d', { alpha: false });
    G.canvas3 = $('game3d');
    G.T = PG.buildTrack(PG.MONZA);
    PG.garageTeams = PG.allTeams().slice(0, 10);
    if (onProgress) onProgress(0.3);
    G.R = new PG.Renderer(G.T);
    if (onProgress) onProgress(0.6);
    G.setup3D();
    G.resize(); window.addEventListener('resize', G.resize);
    G.makeMini();
    G.bindHud();
    G.bindInput();
    G.bindPad();
    G.startAttract();
    requestAnimationFrame(G.frame);
    if (onProgress) onProgress(1);
    onReady();
  };

  // Jakość grafiki 3D: 'auto' wybiera wg urządzenia
  G.quality = function () {
    var q = PG.Store.data.settings.quality || 'auto';
    if (q !== 'auto') return q;
    var small = Math.min(window.screen.width, window.screen.height) < 700;
    return (G.isTouch() && small) ? 'medium' : 'high';
  };

  // Nowe płótno 3D (ten sam element, id i atrybuty): atrybuty kontekstu WebGL, np. wygładzanie krawędzi,
  // ustala się tylko przy pierwszym utworzeniu kontekstu na płótnie
  function freshCanvas3() {
    var old = G.canvas3;
    if (!old || !old.parentNode) return false;
    var nc = old.cloneNode(false);
    old.parentNode.replaceChild(nc, old);
    G.canvas3 = nc;
    return true;
  }

  // Widok 3D (z awaryjnym powrotem do 2D, gdy WebGL zawiedzie)
  G.setup3D = function () {
    var st = PG.Store.data.settings, old = G.V;
    G.V = null;
    if (old) {
      try { old.dispose(); } catch (e) { /* nic */ }
      // wspólne zasoby modeli bolidów siedzą w starym rendererze (purge nic nie robi, gdy działa salon)
      try { if (PG.Car3D && PG.Car3D.purge) PG.Car3D.purge(); } catch (e1) { /* nic */ }
    }
    if (G.used3 && freshCanvas3()) {
      // stary kontekst nie jest już potrzebny (zwalnia pamięć GPU i miejsce na kontekst)
      try { if (old && old.renderer && old.renderer.forceContextLoss) old.renderer.forceContextLoss(); } catch (e2) { /* nic */ }
    }
    G.use3D = false;
    if (st.graphics !== '2d' && PG.has3D && PG.has3D()) {
      G.used3 = true;
      try {
        G.V = new PG.View3D(G.canvas3, G.T, G.R, { quality: G.quality(), post: st.post !== false });
        G.V.setMode(st.camera || 'chase');
        if (G.S) G.V.setSession(G.S);
        G.use3D = true;
      } catch (e) {
        console.error('3D niedostępne, przełączam na 2D', e);
        if (G.V) { try { G.V.dispose(); } catch (e3) { /* nic */ } }
        G.V = null;
      }
    }
    G.canvas3.hidden = !G.use3D;
    G.canvas.hidden = G.use3D;
    G.rs = 1;
  };
  G.reconfigureGraphics = function () { G.setup3D(); G.resize(); };
  // Efekty obrazu: widok od nowa (MSAA płótna jest włączany tylko bez postprocessingu, przy tworzeniu kontekstu)
  G.setPost = function () {
    if (G.use3D) G.reconfigureGraphics();
  };

  G.makeMini = function () {
    var mc = $('minimap'), w = mc.clientWidth || 150, h = mc.clientHeight || 250;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    mc.width = Math.round(w * dpr); mc.height = Math.round(h * dpr);
    G.mini = G.R.minimap(w, h, dpr); G.mini.dpr = dpr;
  };

  G.resize = function () {
    var W = window.innerWidth, H = window.innerHeight;
    if (G.use3D) {
      var q = G.V.quality, cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
      var d3 = Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * (G.rs || 1));
      G.dpr = d3; G.W = Math.round(W * d3); G.H = Math.round(H * d3);
      G.V.resize(W, H, d3);
    } else {
      var dpr = Math.min(window.devicePixelRatio || 1, 2) * (G.rs || 1);
      G.dpr = dpr;
      G.canvas.width = Math.round(W * dpr); G.canvas.height = Math.round(H * dpr);
      G.W = G.canvas.width; G.H = G.canvas.height;
    }
    G.towerRows = W < 700 ? Math.min(8, Math.floor((H - 300) / 24)) : Math.max(6, Math.min(22, Math.floor((H - 200) / 27)));
    if (G.R) G.makeMini();
  };

  // Tekstury bolidów 2D w pamięci podręcznej per malowanie+kask+opona
  G.texFor = function (c) {
    var comp = PG.TYRES[c.compound] ? PG.TYRES[c.compound].color : null;
    var key = JSON.stringify(c.team.livery) + '|' + JSON.stringify(c.driver.helmet || {}) + '|' + comp;
    var s = G.sheets.get(key);
    if (!s) {
      s = { tex: PG.carTexture(c.team.livery, c.driver.helmet, { compound: comp }), texDrs: PG.carTexture(c.team.livery, c.driver.helmet, { compound: comp, drs: true }) };
      G.sheets.set(key, s);
    }
    c.tex = s.tex; c.texDrs = s.texDrs;
  };
  // Po zmianie malowań w kreatorze
  G.clearLiveryCache = function () { G.sheets.clear(); if (PG.Car3D && PG.Car3D.clearCache) PG.Car3D.clearCache(); };

  G.startAttract = function () {
    G.stopHaptics();
    var entries = [];
    PG.allTeams().slice(0, 10).forEach(function (t) { t.drivers.forEach(function (d) { entries.push({ driver: d, team: t }); }); });
    G.S = PG.createSession({ track: G.T, entries: entries, mode: 'attract', laps: 99, weather: 'sun', difficulty: 'hard', damage: PG.Store.data.settings.damage || 'full' });
    G.S.cars.forEach(G.texFor);
    if (G.V) { G.V.setSession(G.S); G.V.setMode('tv'); }
    G.mode = 'attract'; G.timeScale = 1; G.paused = false;
    G.attractCar = 0; G.attractT = 0; G.attractCamT = 0; G.attractCamK = 0;
    var c0 = G.S.cars[0]; G.cam.x = c0.x; G.cam.y = c0.y; G.cam.rot = c0.h + Math.PI / 2;
    $('hud').hidden = true;
  };

  // cfg: {mode:'race'|'quali', entries, laps, weather, difficulty, spectate}
  G.startSession = function (cfg, onDone) {
    PG.Audio.init();
    G.stopHaptics();
    var st = PG.Store.data.settings;
    G.S = PG.createSession({
      track: G.T, entries: cfg.entries, mode: cfg.mode, laps: cfg.laps, weather: cfg.weather, difficulty: cfg.difficulty, autoPlayer: !!cfg.spectate,
      damage: st.damage || 'full', assists: G.assistOpts()
    });
    G.S.cars.forEach(G.texFor);
    if (G.V) { G.V.setSession(G.S); G.V.setMode(cfg.spectate ? 'tv' : (st.camera || 'chase')); }
    G.mode = cfg.mode; G.spectate = !!cfg.spectate; G.timeScale = cfg.spectate ? 8 : 1; G.paused = false;
    G.onDone = onDone; G.endT = 0; G.cfg = cfg;
    G.best = { s: [0, 0, 0], my: [0, 0, 0] }; G.secCols = ['', '', ''];
    G.padUsed = false; G.dmgMsgT = 0;
    var p = G.S.player; G.cam.x = p.x; G.cam.y = p.y; G.cam.rot = p.h + Math.PI / 2; G.cam.z = 1;
    $('hud').hidden = false; G.makeMini();
    $('lights').hidden = cfg.mode !== 'race';
    G.setLights(0);
    $('touch').hidden = !G.isTouch();
    G.resetHud();
    // pasek świetlny DualSense w kolorze zespołu
    if (PG.DualSenseHID && p && p.team && p.team.livery) { try { PG.DualSenseHID.setLight(p.team.livery.primary); } catch (e) { /* nic */ } }
    G.msg(cfg.mode === 'quali' ? 'KWALIFIKACJE' : '', cfg.mode === 'quali' ? 'Pomiar startuje na linii mety' : '', '', 3);
    if (cfg.spectate) G.msg('SYMULACJA', 'Bolid prowadzi inżynier · przyspieszenie ×8', '', 3);
    G.hudT = 0; G.updateHud(true);
  };

  G.isTouch = function () { return ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches); };

  G.stop = function () { G.startAttract(); };

  G.setLights = function (n) {
    var ls = $('lights').children;
    for (var i = 0; i < 5; i++) ls[i].className = i < n ? 'on' : '';
  };

  G.msg = function (title, sub, cls, dur) {
    var m = $('msg');
    if (!title && !sub) { m.innerHTML = ''; return; }
    m.className = cls || '';
    m.innerHTML = '';
    var t = document.createElement('div'); t.textContent = title; m.appendChild(t);
    if (sub) { var s = document.createElement('small'); s.textContent = sub; m.appendChild(s); }
    G.msgT = dur || 2.5;
  };
  // Krótki komunikat: w jeździe na ekranie, w menu i pauzie jako dymek
  G.note = function (t) {
    var running = (G.mode === 'race' || G.mode === 'quali') && !G.paused;
    if (running) G.msg('', t, '', 2.2);
    else if (PG.UI && PG.UI.toast) PG.UI.toast(t);
  };

  // ---------- STEROWANIE (klawiatura i dotyk) ----------
  var KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', KeyE: 'drs', ShiftLeft: 'drs', ShiftRight: 'drs', Space: 'drs', KeyV: 'back' };
  G.bindInput = function () {
    window.addEventListener('keydown', function (e) {
      G.focused = true;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
      var k = KEYS[e.code];
      if (G.mode === 'race' || G.mode === 'quali') {
        if (k) { G.input[k] = true; e.preventDefault(); }
        if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { G.togglePause(); e.preventDefault(); }
        if (e.code === 'KeyR' && !e.repeat) G.resetPlayer();
        if (e.code === 'KeyC' && !e.repeat && !G.paused) G.cycleCamera(e.shiftKey ? -1 : 1);
      }
      if (e.code === 'KeyM' && !e.repeat) { var st = PG.Store.data.settings; st.sound = !st.sound; PG.Audio.setOn(st.sound); PG.Store.save(); }
    });
    window.addEventListener('keyup', function (e) { var k = KEYS[e.code]; if (k) G.input[k] = false; });
    window.addEventListener('blur', function () { G.input = {}; G.focused = false; G.stopHaptics(); });
    window.addEventListener('focus', function () { G.focused = true; });
    window.addEventListener('pointerdown', function () { G.focused = true; }, true);
    var map = { tL: 'left', tR: 'right', tG: 'up', tB: 'down', tD: 'drs' };
    Object.keys(map).forEach(function (id) {
      var el = $(id); if (!el) return;
      var on = function (e) { e.preventDefault(); G.input[map[id]] = true; el.classList.add('on'); PG.Audio.init(); };
      var off = function (e) { e.preventDefault(); G.input[map[id]] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
    var tc = $('tC');
    if (tc) tc.addEventListener('pointerdown', function (e) { e.preventDefault(); if (!G.paused) G.cycleCamera(1); });
    $('pauseBtn').addEventListener('click', function () { G.togglePause(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        G.stopHaptics();
        if ((G.mode === 'race' || G.mode === 'quali') && !G.paused) G.togglePause();
      }
    });
    try { G.focused = document.hasFocus ? document.hasFocus() : true; } catch (e) { G.focused = true; }
  };

  // ---------- PAD ----------
  function padConnected() { return !!(PG.Pad && PG.Pad.connected); }
  G.bindPad = function () {
    var P = PG.Pad;
    if (P) {
      P.onChange = function (on, name) {
        var active = (G.mode === 'race' || G.mode === 'quali');
        if (on) {
          G.note('Podłączono kontroler: ' + name);
          PG.Audio.init();
        } else {
          G.stopHaptics();
          // pad odłączony w trakcie jazdy → pauza
          if (active && !G.paused && G.padUsed && !G.spectate) G.togglePause();
          G.note('Odłączono kontroler' + (name ? ': ' + name : ''));
        }
        if (PG.UI && PG.UI.onPadChange) { try { PG.UI.onPadChange(on, name); } catch (e) { /* nic */ } }
      };
    }
    if (PG.DualSenseHID) {
      PG.DualSenseHID.onChange = function (on) {
        if (on && G.S && G.S.player && G.S.player.team && G.S.player.team.livery) { try { PG.DualSenseHID.setLight(G.S.player.team.livery.primary); } catch (e) { /* nic */ } }
        if (PG.UI && PG.UI.onPadChange) { try { PG.UI.onPadChange(padConnected(), PG.Pad ? PG.Pad.name : ''); } catch (e2) { /* nic */ } }
      };
      try { PG.DualSenseHID.init(); } catch (e) { /* WebHID niedostępny */ }
    }
  };

  // Odczyt pada i jego przyciski: kamera, powrót na tor, pauza; w menu i pauzie nawigacja
  G.padFrame = function (active) {
    var P = PG.Pad;
    if (!P || G.padErr) return;
    try {
      P.poll();
      if (P.activity) G.focused = true;
      if (!P.connected) return;
      if (active) {
        if (P.hit('pause')) { G.togglePause(); return; } // Options: pauza i wznowienie
        if (!G.paused) {
          if (P.hit('camera')) G.cycleCamera(1);
          if (P.hit('reset')) G.resetPlayer();
          return;
        }
      }
    } catch (e) { G.padErr = true; console.warn('Pad wyłączony po błędzie:', e); return; }
    // menu i pauza: krzyżak/gałka wybiera, ✕ zatwierdza, ○ wraca
    if (PG.UI && PG.UI.padNav && !G.navErr) {
      try { PG.UI.padNav(P); } catch (e2) { G.navErr = true; console.warn('Nawigacja padem wyłączona:', e2); }
    }
  };

  // Wejście do fizyki: klawiatura/dotyk + pad (jeden obiekt, bez alokacji co klatkę)
  var NOINPUT = {};
  G.inp = { up: false, down: false, left: false, right: false, drs: false, steerAxis: null, throttleAxis: null, brakeAxis: null, analog: false };
  G.readInput = function () {
    var I = G.input, o = G.inp, P = PG.Pad;
    o.up = !!I.up; o.down = !!I.down; o.left = !!I.left; o.right = !!I.right; o.drs = !!I.drs;
    o.steerAxis = null; o.throttleAxis = null; o.brakeAxis = null; o.analog = false;
    if (P && P.connected && !G.padErr) {
      o.steerAxis = fin(P.steer, 0); o.throttleAxis = fin(P.throttle, 0); o.brakeAxis = fin(P.brake, 0); o.analog = true;
      // ✕ zatwierdza też w menu: po wznowieniu DRS z pada dopiero po puszczeniu przycisku
      if (G.padDrsBlock) { if (!P.held('drs')) G.padDrsBlock = false; }
      else if (P.held('drs')) o.drs = true;
      if (P.held('dleft')) o.left = true;
      if (P.held('dright')) o.right = true;
      if (o.throttleAxis > 0.05 || o.brakeAxis > 0.05 || o.steerAxis > 0.1 || o.steerAxis < -0.1) G.padUsed = true;
    }
    return o;
  };

  G.cycleCamera = function (dir) {
    var st = PG.Store.data.settings;
    if (G.use3D) {
      var list = PG.CAMERAS, i = 0;
      for (var k = 0; k < list.length; k++) if (list[k].id === G.V.cam.mode) i = k;
      i = (i + dir + list.length) % list.length;
      G.V.setMode(list[i].id);
      if (!G.spectate) { st.camera = list[i].id; PG.Store.save(); }
      G.msg('', 'Kamera: ' + list[i].name, '', 1.4);
    } else {
      st.camRotate = st.camRotate === false; PG.Store.save();
      G.msg('', st.camRotate ? 'Kamera obraca się z torem' : 'Kamera stała, północ w górze', '', 1.4);
    }
  };


  G.resetPlayer = function () {
    var p = G.S && G.S.player;
    if (!p || p.finished || G.paused || G.S.state === 'lights') return;
    if (Math.abs(p.v) < 25) { PG.resetCar(p, G.T); G.msg('Powrót na tor', '', '', 1.2); }
  };

  G.togglePause = function () {
    if (G.mode !== 'race' && G.mode !== 'quali') return;
    G.paused = !G.paused;
    G.input = {};
    if (!G.paused) G.padDrsBlock = true; // ✕ użyty do wznowienia nie otwiera DRS
    if (G.paused) { G.stopHaptics(); PG.UI.showPause(); } else PG.UI.hidePause();
  };

  // ---------- WIBRACJE ----------
  G.stopHaptics = function () {
    G.hapOn = false; G.rumOn = false;
    try { if (PG.Haptics) PG.Haptics.stop(); } catch (e) { /* nic */ }
  };
  // Wibracje i spusty tylko dla gracza w aktywnej sesji (bez symulacji, pauzy, po mecie i bez fokusu)
  G.padFxWanted = function () {
    var S = G.S, p = S && S.player;
    return !!(PG.Haptics && !G.hapErr && S && (G.mode === 'race' || G.mode === 'quali') && !G.paused && !G.spectate && !S.autoPlayer &&
      p && !p.finished && G.focused && !document.hidden && padConnected());
  };
  G.hapticsWanted = function () { return G.padFxWanted() && PG.Store.data.settings.haptics !== false; };
  G.hapticsFrame = function (S, dt) {
    if (G.hapErr) return;
    try {
      if (G.padFxWanted()) {
        var st = PG.Store.data.settings;
        if (st.haptics !== false) { PG.Haptics.setGain(st.hapticsGain); PG.Haptics.update(S.player, dt); G.rumOn = true; }
        else if (G.rumOn) { G.rumOn = false; PG.Haptics.silence(); }
        // adaptacyjne spusty mają osobny przełącznik i siłę (wyłączone — zwolnione)
        if (PG.DualSenseHID) PG.DualSenseHID.update(S.player, st.trig !== false, st.trigGain === undefined ? 0.8 : st.trigGain);
        G.hapOn = true;
      } else if (G.hapOn) G.stopHaptics();
    } catch (e) { G.hapErr = true; G.stopHaptics(); console.warn('Wibracje wyłączone po błędzie:', e); }
  };

  // ---------- PĘTLA ----------
  G.frame = function (t) {
    requestAnimationFrame(G.frame);
    var dt = Math.min(0.05, Math.max(0.001, (t - (G.last || t)) / 1000));
    G.last = t;
    // adaptacyjna rozdzielczość: przy słabym sprzęcie zmniejsz bufor
    G.dtAvg = (G.dtAvg || 0.016) * 0.97 + dt * 0.03;
    G.perfT = (G.perfT || 0) + dt;
    if (G.perfT > 2.5 && G.dtAvg > 1 / 38 && (G.rs || 1) > 0.55 && !document.hidden) { G.rs = (G.rs || 1) * 0.85; G.perfT = 0; G.resize(); }
    if (!G.S) return;
    G.padFrame(G.mode === 'race' || G.mode === 'quali');
    var S = G.S; if (!S) return; // pad mógł zmienić sesję (np. wyjście do menu)
    var active = (G.mode === 'race' || G.mode === 'quali');
    var input = active ? G.readInput() : NOINPUT;
    if (!G.paused) {
      for (var k = 0; k < G.timeScale; k++) {
        PG.updateSession(S, dt, input);
        G.handleEvents(S.events, active);
      }
      if (!G.use3D) G.R.carEffects(S, dt * G.timeScale);
      if (active) G.checkEnd(dt);
      if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) G.msg('', ''); }
    }
    G.hapticsFrame(S, dt);
    var line = (active && !G.spectate && S.state !== 'lights') ? G.lineMode() : 'off';
    if (G.use3D) G.draw3D(S, dt, active, line);
    else G.draw2D(S, dt, active, line);
    if (active && G.mode !== 'post') {
      G.hudT -= dt;
      G.updateHud(G.hudT <= 0);
      if (G.hudT <= 0) G.hudT = 0.25;
      PG.Audio.engine(S.player, !G.paused, S.state === 'lights' ? 0 : 0.02);
    } else PG.Audio.engine(null, false);
  };

  G.draw3D = function (S, dt, active, line) {
    var focus = G.camTarget(dt);
    if (G.mode === 'attract') {
      G.attractCamT += dt;
      if (G.attractCamT > 9) {
        G.attractCamT = 0;
        var seq = ['tv', 'chase', 'tv', 'heli', 'tv', 'far'];
        G.attractCamK = (G.attractCamK + 1) % seq.length;
        G.V.setMode(seq[G.attractCamK]);
      }
    }
    var lights = S.state === 'lights' ? (S.lightsOn || 0) : -1;
    var look = active && !G.paused && (!!G.input.back || (padConnected() && PG.Pad.held('look')));
    G.V.render(S, G.paused ? 0 : dt * Math.min(G.timeScale, 1), {
      focus: focus, lookBack: look, line: line, marker: active, lights: lights
    });
  };

  // Widok 2D z góry: obraca się z torem, oddala z prędkością
  G.draw2D = function (S, dt, active, line) {
    var focus = G.camTarget(dt), cam = G.cam, st = PG.Store.data.settings;
    var rotate = st.camRotate !== false;
    if (focus) {
      var f = Math.min(1, dt * 6);
      cam.x += (focus.x - cam.x) * f; cam.y += (focus.y - cam.y) * f;
      if (Math.hypot(focus.x - cam.x, focus.y - cam.y) > 200) { cam.x = focus.x; cam.y = focus.y; cam.rot = focus.h + Math.PI / 2; }
      var T = G.T, ia = PG.wrapI((focus.idx || 0) + Math.round(18 / T.ds), T.N), ib = PG.wrapI((focus.idx || 0) - Math.round(6 / T.ds), T.N);
      var th = Math.atan2(T.y[ia] - T.y[ib], T.x[ia] - T.x[ib]);
      var tr = rotate ? th + Math.PI / 2 : 0;
      var dr = Math.atan2(Math.sin(tr - (cam.rot || 0)), Math.cos(tr - (cam.rot || 0)));
      cam.rot = (cam.rot || 0) + dr * Math.min(1, dt * 3);
      var zt = 1 - Math.min(1, Math.abs(focus.v) / 90) * 0.4;
      cam.z = (cam.z || 1) + (zt - (cam.z || 1)) * Math.min(1, dt * 1.5);
    }
    var W = G.W, H = G.H, small = Math.min(W, H) / G.dpr < 600;
    var ppm = Math.sqrt(W * H) / (small ? 78 : 92) * (cam.z || 1);
    var vcam = { x: cam.x, y: cam.y, rot: cam.rot || 0, ppm: ppm, cx: W / 2, cy: H * (rotate ? 0.64 : 0.5) };
    if (G.shake > 0) { vcam.x += (Math.random() - 0.5) * G.shake; vcam.y += (Math.random() - 0.5) * G.shake; G.shake = Math.max(0, G.shake - dt * 8); }
    G.R.draw(G.ctx, W, H, S, vcam, { marker: active, line: line, dt: dt });
  };

  G.camTarget = function (dt) {
    var S = G.S;
    if (G.mode === 'attract') {
      G.attractT += dt;
      if (G.attractT > 12) {
        G.attractT = 0;
        // kamera na bolid w walce
        var best = 0, bd = Infinity;
        S.order.forEach(function (c, i) { if (i === 0) return; var a = S.order[i - 1]; var d = a.dist - c.dist; if (d < bd && Math.random() < 0.7) { bd = d; best = S.cars.indexOf(c); } });
        G.attractCar = best;
      }
      return S.cars[G.attractCar];
    }
    return S.player;
  };

  // ---------- KOMUNIKATY USZKODZEŃ ----------
  var PART_TXT = {
    fwL: ['przednie skrzydło', 'lewa połowa'], fwR: ['przednie skrzydło', 'prawa połowa'], rw: ['tylne skrzydło', ''],
    floor: ['podłoga', ''], engine: ['silnik', ''],
    suspFL: ['zawieszenie', 'lewe przednie koło'], suspFR: ['zawieszenie', 'prawe przednie koło'],
    suspRL: ['zawieszenie', 'lewe tylne koło'], suspRR: ['zawieszenie', 'prawe tylne koło']
  };
  var PART_FX = { fwL: 'mniej docisku z przodu', fwR: 'mniej docisku z przodu', rw: 'tył traci docisk', floor: 'mniej docisku', engine: 'mniej mocy', suspFL: 'bolid ściąga', suspFR: 'bolid ściąga', suspRL: 'bolid ściąga', suspRR: 'bolid ściąga' };
  function dmgStage(v) { return v >= 0.999 ? 3 : v >= 0.5 ? 2 : v >= 0.15 ? 1 : 0; }
  G.dmgMsg = function (e) {
    var part = e.part, tx = PART_TXT[part];
    if (!tx) return;
    var st = dmgStage(fin(e.level, 0)), ps = dmgStage(fin(e.prev, 0));
    if (st <= ps || st === 0) return;
    var t = now();
    if (st < 3 && t < (G.dmgMsgT || 0)) return; // nie zasypuj ekranu drobiazgami
    G.dmgMsgT = t + 1400;
    var name = tx[0], wing = part === 'fwL' || part === 'fwR' || part === 'rw', fem = part === 'floor', title;
    if (part === 'engine') title = st === 3 ? 'Awaria silnika' : st === 2 ? 'Poważnie uszkodzony silnik' : 'Uszkodzony silnik';
    else if (st === 3) title = wing ? 'Urwane ' + name : (fem ? 'Zniszczona ' : 'Zniszczone ') + name;
    else title = (st === 2 ? 'Mocno uszkodzon' : 'Uszkodzon') + (fem ? 'a ' : 'e ') + name;
    var sub = tx[1];
    if (G.S && G.S.damage === 'full' && PART_FX[part]) sub = sub ? sub + ' · ' + PART_FX[part] : PART_FX[part];
    G.msg(title, sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : '', 'dmg', st === 3 ? 2.8 : 2.2);
  };

  G.handleEvents = function (evs, active) {
    var S = G.S, p = S.player, A = PG.Audio, V = G.V;
    var hap = active && G.hapticsWanted();
    for (var i = 0; i < evs.length; i++) {
      var e = evs[i];
      // efekty 3D dla każdego bolidu (iskry, odłamki, dym) — zawsze, także w tle menu
      if (V && V.event) V.event(e);
      if (hap) { try { PG.Haptics.event(e, p); } catch (err) { G.hapErr = true; G.stopHaptics(); hap = false; } }
      if (!active) continue;
      switch (e.type) {
        case 'light': G.setLights(e.n); A.beep(440, 0.18, 'square', 0.12); break;
        case 'go': G.setLights(0); $('lights').hidden = true; A.beep(880, 0.35, 'square', 0.16); G.msg('START!', '', '', 1.2); break;
        case 'jump': G.msg('FALSTART', 'Kara: +5 s', '', 2.5); break;
        case 'drsready':
          G.msg('', S.assists && S.assists.autoDrs ? 'DRS dostępny · otworzy się automatycznie' : 'DRS dostępny · wciśnij E / Shift' + (padConnected() ? ' / R1' : ''), '', 1.6);
          break;
        case 'drs': if (e.car === p && A.drs) A.drs(true); break;
        case 'drsclose': if (e.car === p && A.drs) A.drs(false); break;
        case 'wall': if (e.car === p) { G.shake = Math.min(6, e.force * 0.3); A.thump(e.force); if (V) V.shake(Math.min(8, e.force * 0.4)); } break;
        case 'hit': if (e.player) { G.shake = Math.min(4, e.force * 0.4); A.thump(e.force * 0.6); if (V) V.shake(Math.min(6, e.force * 0.5)); } break;
        case 'damage':
          if (e.car === p) {
            if (A.crunch) A.crunch(e.force, fin(e.level, 0) - fin(e.prev, 0));
            G.dmgFlash(e.part);
            if (!G.spectate) G.dmgMsg(e);
          }
          break;
        case 'detach': if (e.car === p && A.crunch) A.crunch(20, 1); break;
        case 'sector':
          if (e.car === p) {
            var n = e.n, t = e.t, col = 'y';
            if (!G.best.s[n] || t <= G.best.s[n]) col = 'pu'; else if (!G.best.my[n] || t <= G.best.my[n]) col = 'gr';
            if (!G.best.my[n] || t < G.best.my[n]) G.best.my[n] = t;
            G.secCols[n] = col;
            if (n === 0) G.secCols[1] = G.secCols[2] = '';
          }
          if (!G.best.s[e.n] || e.t < G.best.s[e.n]) G.best.s[e.n] = e.t;
          break;
        case 'lap':
          if (e.car === p && S.mode === 'race' && !p.finished) {
            var left = S.laps - p.lap;
            G.msg(left === 1 ? 'OSTATNIE OKRĄŻENIE' : 'OKRĄŻENIE ' + (p.lap + 1) + '/' + S.laps, PG.fmtTime(e.t), '', 2.2);
          }
          break;
        case 'fastest': if (e.car === p) G.msg('NAJSZYBSZE OKRĄŻENIE', PG.fmtTime(e.t), 'purple', 2.5); break;
        case 'finish': if (e.car === p) { G.stopHaptics(); G.msg('META! P' + p.pos, p.penalty ? 'z karą +' + p.penalty + ' s' : '', '', 4); A.beep(660, 0.2); A.beep(990, 0.4); } break;
        case 'qualidone': G.stopHaptics(); G.msg('CZAS OKRĄŻENIA', PG.fmtTime(e.t), 'purple', 4); break;
      }
    }
  };

  G.checkEnd = function (dt) {
    var S = G.S, p = S.player;
    if (S.mode === 'quali' && S.done) { G.endT += dt; if (G.endT > 2.2) G.finish(); }
    if (S.mode === 'race' && p.finished) {
      G.endT += dt;
      var allDone = S.cars.every(function (c) { return c.finished; });
      if (G.endT > 5 || (allDone && G.endT > 2)) G.finish();
    }
  };

  G.finish = function () {
    G.stopHaptics();
    var S = G.S, cb = G.onDone; G.onDone = null;
    var out = S.mode === 'quali' ? { type: 'quali', time: S.player.finishTime || S.player.lastLap } : { type: 'race', res: PG.classify(S), fastest: S.fastest };
    G.mode = 'post';
    $('hud').hidden = true;
    G.paused = false;
    G.timeScale = 1;
    if (cb) cb(out);
  };

  // Przerwanie: dokończ symulacją
  G.simulateRest = function () {
    var S = G.S;
    G.stopHaptics();
    if (S.mode === 'quali') { G.mode = 'post'; $('hud').hidden = true; var cb = G.onDone; G.onDone = null; if (cb) cb({ type: 'quali', time: 0, aborted: true }); return; }
    S.autoPlayer = true; G.spectate = true; G.timeScale = 10; G.paused = false;
    G.msg('SYMULACJA', 'Inżynier dokończy wyścig', '', 2);
  };

  // ---------- HUD ----------
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function setText(el, s) { if (el && el._t !== s) { el._t = s; el.textContent = s; } }
  function setHTML(el, s) { if (el && el._h !== s) { el._h = s; el.innerHTML = s; } }
  function restartAnim(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.getBoundingClientRect(); // wymuś ponowne uruchomienie animacji
    el.classList.add(cls);
  }
  // Kolor części: zielony → żółty → czerwony
  function dmgCol(v) {
    var a, b, k;
    if (v < 0.5) { a = [47, 208, 122]; b = [255, 201, 60]; k = v / 0.5; }
    else { a = [255, 201, 60]; b = [225, 6, 0]; k = (v - 0.5) / 0.5; }
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' + Math.round(a[1] + (b[1] - a[1]) * k) + ',' + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
  }

  // Stałe elementy deski (aktualizowane bez przebudowy HTML, by animacje działały)
  G.bindHud = function () {
    var rp = $('rpm');
    G.hud = {
      spd: $('dSpd'), gear: $('dGear'), rpm: rp ? Array.prototype.slice.call(rp.children) : [], drs: $('drsb'),
      tyre: $('dTyre'), wear: $('dWear'), pos: $('dPos'), laps: $('laps'), next: $('next'), tower: $('tower')
    };
    var w = $('dmgw');
    G.dmgW = null;
    if (w) {
      var parts = Array.prototype.slice.call(w.querySelectorAll('[data-p]')), map = {};
      parts.forEach(function (el) { el._p = el.getAttribute('data-p'); el._q = -1; map[el._p] = el; });
      G.dmgW = { el: w, parts: parts, map: map, pct: $('dmgPct') };
    }
    G.rpmOn = -1; G.drsState = ''; G.drsSt = '';
  };
  G.resetHud = function () {
    var H = G.hud;
    if (!H) return;
    G.rpmOn = -1; G.drsState = ''; G.drsSt = '';
    if (H.drs) H.drs.className = 'drsb off';
    if (G.dmgW) {
      G.dmgW.el.classList.remove('hit');
      G.dmgW.parts.forEach(function (el) { el._q = -1; el.classList.remove('blink'); el.classList.remove('gone'); });
    }
  };
  G.dmgFlash = function (part) {
    var w = G.dmgW;
    if (!w || w.el.hidden) return;
    restartAnim(w.el, 'hit');
    var el = w.map[part];
    if (el) restartAnim(el, 'blink');
  };
  G.updateDmg = function (S, p) {
    var w = G.dmgW;
    if (!w) return;
    var show = S.damage !== 'off' && !!p.dmg;
    if (w.el.hidden === show) w.el.hidden = !show;
    if (!show) return;
    var d = p.dmg;
    for (var i = 0; i < w.parts.length; i++) {
      var el = w.parts[i], k = el._p, lv = fin(d[k], 0), q = Math.round(lv * 50);
      if (q === el._q) continue;
      el._q = q;
      var gone = lv >= 0.999 && (k === 'fwL' || k === 'fwR' || k === 'rw');
      el.setAttribute('fill', gone ? 'none' : dmgCol(lv));
      if (gone) el.classList.add('gone'); else el.classList.remove('gone');
    }
    var pct = Math.round(fin(p.dmgTotal, 0) * 100);
    setText(w.pct, pct > 0 ? pct + '%' : 'OK');
  };
  // Znacznik DRS: wyłączony / dostępny / otwarty (wjazd z błyskiem), z dopiskiem AUTO
  G.updateDrs = function (S, p) {
    var el = G.hud && G.hud.drs;
    if (!el) return;
    var auto = !!(S.assists && S.assists.autoDrs) && !G.spectate;
    var state = p.drsOpen ? 'open' : p.drsAllowed ? 'ready' : 'off';
    var key = state + (auto ? '+A' : '');
    if (key === G.drsState) return;
    var prev = G.drsSt || '';
    G.drsState = key; G.drsSt = state;
    var cls = 'drsb ' + state + (auto ? ' isauto' : '');
    if (state === 'open' && prev !== 'open') cls += ' flash';
    else if (state !== 'open' && prev === 'open') cls += ' closing';
    el.className = cls;
    el.setAttribute('aria-label', state === 'open' ? 'DRS otwarty' : state === 'ready' ? 'DRS dostępny' : 'DRS niedostępny');
  };

  G.updateHud = function (full) {
    var S = G.S, p = S.player, T = G.T, H = G.hud;
    if (!p || !H) return;
    // prędkościomierz
    var kmh = Math.round(Math.abs(p.v) * 3.6);
    setText(H.spd, String(kmh));
    setText(H.gear, p.gear === 0 ? 'R' : kmh < 2 && p.throttle === 0 ? 'N' : String(p.gear));
    var segs = H.rpm.length, on = Math.round((p.rpm - 4200) / 8300 * segs);
    if (on !== G.rpmOn) {
      G.rpmOn = on;
      for (var i = 0; i < segs; i++) H.rpm[i].className = (i < on ? 'on ' : '') + (i < 8 ? 'g' : i < 12 ? 'r' : 'b');
    }
    G.updateDrs(S, p);
    var tyre = PG.TYRES[p.compound] || PG.TYRES.M;
    if (H.tyre && H.tyre._c !== tyre.color) { H.tyre._c = tyre.color; H.tyre.style.color = tyre.color; }
    setText(H.wear, Math.round((1 - p.wear) * 100) + '%');
    setText(H.pos, S.mode === 'race' ? 'P' + p.pos : '');
    G.updateDmg(S, p);
    // czasy okrążeń
    var cur = p.started ? S.time - p.lapStart : 0;
    setHTML(H.laps, '<span>Okrążenie</span><span class="num">' + PG.fmtTime(cur) + '</span>' +
      '<span>Ostatnie</span><span class="num">' + PG.fmtTime(p.lastLap) + '</span>' +
      '<span>Najlepsze</span><span class="num">' + PG.fmtTime(p.bestLap) + '</span>' +
      '<div class="secs"><i class="' + G.secCols[0] + '"></i><i class="' + G.secCols[1] + '"></i><i class="' + G.secCols[2] + '"></i></div>');
    // następny zakręt
    var nxt = null, nd = Infinity;
    T.corners.forEach(function (c) { var d = c.i - p.idx; if (d < 0) d += T.N; if (d < nd && d > 2) { nd = d; nxt = c; } });
    setHTML(H.next, nxt ? 'Następny: <b>' + esc(nxt.name) + '</b> · ' + Math.round(nd * T.ds / 10) * 10 + ' m' : '');
    // minimapa
    var mc = $('minimap').getContext('2d'), md = G.mini.dpr;
    mc.setTransform(1, 0, 0, 1, 0, 0); mc.clearRect(0, 0, mc.canvas.width, mc.canvas.height); mc.drawImage(G.mini.c, 0, 0);
    mc.setTransform(md, 0, 0, md, 0, 0);
    for (var j = S.cars.length - 1; j >= 0; j--) {
      var c = S.cars[j], q = G.mini.map(c.x, c.y);
      mc.beginPath(); mc.arc(q[0], q[1], c.isPlayer ? 5 : 3.6, 0, 7);
      mc.fillStyle = c.isPlayer ? '#ffc93c' : c.team.livery.primary; mc.fill();
      mc.lineWidth = c.isPlayer ? 2 : 1.2; mc.strokeStyle = c.isPlayer ? '#000' : 'rgba(0,0,0,0.75)'; mc.stroke();
    }
    if (!full) return;
    // wieża czasów
    var html = '';
    if (S.mode === 'race') {
      html += '<div class="hd"><span>OKR</span><span class="num">' + Math.min(S.laps, Math.max(1, (S.order[0].lap || 0) + 1)) + '/' + S.laps + '</span></div>';
      var rows = S.order, n = Math.min(rows.length, G.towerRows);
      var pi = rows.indexOf(p), start = 1;
      if (pi >= n) start = Math.max(1, Math.min(rows.length - (n - 1), pi - Math.floor(n / 2)));
      var leader = rows[0];
      for (var r = 0; r < n; r++) {
        var ri = r === 0 ? 0 : start + r - 1; if (ri >= rows.length) break;
        var c2 = rows[ri];
        var gap;
        if (ri === 0) gap = S.state === 'lights' ? '' : 'Lider';
        else if (c2.finished && leader.finished) gap = PG.fmtGap(c2.finishTime - leader.finishTime);
        else {
          var lapsBehind = Math.floor((leader.dist - c2.dist) / T.length);
          gap = lapsBehind >= 1 ? '+' + lapsBehind + ' OKR' : S.state === 'lights' ? '' : '+' + PG.gapBetween(S, leader, c2).toFixed(1);
        }
        html += '<div class="r' + (c2.isPlayer ? ' me' : '') + '"><span class="p">' + (ri + 1) + '</span><span class="c" style="background:' + c2.team.livery.primary + '"></span><span>' + esc(PG.driverCode(c2.driver)) + '</span><span class="g">' + gap + '</span></div>';
      }
    } else {
      html += '<div class="hd"><span>KWALIFIKACJE</span><span class="num">1 OKR</span></div>';
      html += '<div class="r me"><span class="p">–</span><span class="c" style="background:' + p.team.livery.primary + '"></span><span>' + esc(PG.driverCode(p.driver)) + '</span><span class="g">' + (p.started ? PG.fmtTime(S.time - p.lapStart).slice(0, -2) : 'w drodze') + '</span></div>';
      if (G.cfg && G.cfg.target) html += '<div class="r"><span class="p">P1</span><span class="c" style="background:#a64dff"></span><span>CEL</span><span class="g">' + PG.fmtTime(G.cfg.target) + '</span></div>';
    }
    setHTML(H.tower, html);
  };
})(PG);
