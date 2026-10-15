// WORLD GP — pętla gry, widok 3D/2D, kamery, sterowanie (klawiatura, dotyk, pad), wibracje, HUD.
(function (PG) {
  'use strict';
  var G = PG.Game = {
    S: null, mode: 'none', paused: false, timeScale: 1, input: {},
    last: 0, hudT: 0, msgT: 0, endT: 0, attractT: 0, attractCar: 0,
    focused: true, hapOn: false, hapErr: false, padErr: false, navErr: false, padUsed: false
  };

  var $ = function (id) { return document.getElementById(id); };
  function fin(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // ---------- USTAWIENIA: domyślne wartości nowych kluczy (career.js zostaje bez zmian) ----------
  var SET_DEF = { autoDrs: true, abs: false, tc: true, damage: 'full', haptics: true, hapticsGain: 0.8, trig: true, trigGain: 0.8, post: true, gearbox: 'auto' };
  G.mergeSettings = function () {
    var st = PG.Store && PG.Store.data && PG.Store.data.settings;
    if (!st) return;
    // stary przełącznik „wskaźnik hamowania" → tryb linii jazdy
    if (st.racingLine !== 'full' && st.racingLine !== 'brake' && st.racingLine !== 'off') st.racingLine = st.brakeHint === false ? 'off' : 'full';
    Object.keys(SET_DEF).forEach(function (k) { if (st[k] === undefined || st[k] === null) st[k] = SET_DEF[k]; });
    if (st.damage !== 'off' && st.damage !== 'visual' && st.damage !== 'full') st.damage = 'full';
    var g = +st.hapticsGain;
    st.hapticsGain = isFinite(g) ? Math.max(0, Math.min(1, g)) : 0.8;
    delete st.graphics; delete st.camRotate; // ustawienia usuniętego widoku 2D
    st.autoDrs = !!st.autoDrs; st.abs = !!st.abs; st.tc = !!st.tc; st.haptics = !!st.haptics; st.post = !!st.post;
    if (st.gearbox !== 'manual') st.gearbox = 'auto';
  };
  G.assistOpts = function () {
    var st = PG.Store.data.settings;
    return { abs: !!st.abs, tc: st.tc !== false, autoDrs: st.autoDrs !== false, manual: st.gearbox === 'manual' };
  };
  // Zmiana asyst w trakcie sesji (menu pauzy / ustawienia)
  G.syncAssists = function () {
    if (!G.S) return;
    var o = G.assistOpts(), a = G.S.assists;
    if (!a) a = G.S.assists = {};
    a.abs = o.abs; a.tc = o.tc; a.autoDrs = o.autoDrs; a.manual = o.manual;
    G.drsState = ''; // przerysuj znacznik AUTO
    G.applyGearbox();
  };
  // Ręczna skrzynia: układ przycisków pada, przyciski dotykowe i podpis biegu w HUD
  G.manualGears = function () { return PG.Store.data.settings.gearbox === 'manual'; };
  G.applyGearbox = function () {
    var on = G.manualGears();
    if (PG.Pad && PG.Pad.setManualGears) PG.Pad.setManualGears(on);
    var gu = $('tGu'), gd = $('tGd'), gl = $('dGearL');
    if (gu) gu.hidden = !on;
    if (gd) gd.hidden = !on;
    if (gl) gl.textContent = on ? 'bieg · ręczna' : 'bieg';
  };
  // Zmiana biegu przez gracza (klawisze X / Z, pad R1 / L1, przyciski dotykowe)
  G.shift = function (dir) {
    var S = G.S, p = S && S.player;
    if (!p || G.paused || G.netMenu || G.spectate || !(G.mode === 'race' || G.mode === 'quali') || !p.manual) return;
    var r = PG.shiftGear(p, dir);
    if (r === 'deny') {
      var t = now();
      if (!(t - (G.denyT || 0) < 1500)) { G.denyT = t; G.msg('', 'Za duża prędkość na niższy bieg', '', 0.9); }
    } else if (r && PG.Audio.shift) PG.Audio.shift(dir);
  };
  G.lineMode = function () {
    var m = PG.Store.data.settings.racingLine;
    return (m === 'full' || m === 'brake' || m === 'off') ? m : 'full';
  };

  G.init = function (onProgress, onReady) {
    G.mergeSettings();
    G.canvas3 = $('game3d');
    G.T = PG.buildTrack(PG.MONZA);
    PG.garageTeams = PG.allTeams().slice(0, 10);
    if (onProgress) onProgress(0.3);
    G.R = new PG.Renderer(G.T);
    if (onProgress) onProgress(0.6);
    G.setup3D();
    // gra jest tylko w 3D: bez WebGL zostaje ekran z wyjaśnieniem
    if (!G.use3D) { G.noWebGL = true; if (onProgress) onProgress(1); onReady(); return; }
    G.resize(); window.addEventListener('resize', G.resize);
    G.makeMini();
    G.bindHud();
    G.bindInput();
    G.bindPad();
    G.applyGearbox();
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

  // Widok 3D (gra wymaga WebGL)
  G.setup3D = function () {
    var st = PG.Store.data.settings, old = G.V, prevMode = old && old.cam && old.cam.mode;
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
    if (PG.has3D && PG.has3D()) {
      G.used3 = true;
      try {
        G.V = new PG.View3D(G.canvas3, G.T, G.R, { quality: G.quality(), post: st.post !== false });
        G.V.setMode(prevMode || (G.mode === 'attract' ? 'tv' : (st.camera || 'chase')));
        if (G.S) G.V.setSession(G.S);
        G.use3D = true;
      } catch (e) {
        console.error('3D niedostępne', e);
        if (G.V) { try { G.V.dispose(); } catch (e3) { /* nic */ } }
        G.V = null;
      }
    }
    G.canvas3.hidden = !G.use3D;
    G.rs = 1;
  };
  // Tor sesji (przebudowa toru, otoczenia i widoku 3D tylko przy zmianie)
  G.setTrack = function (id) {
    var def = PG.trackDef ? PG.trackDef(id) : PG.MONZA;
    if (G.T && G.T.def === def) return;
    G.T = PG.buildTrack(def); G.R = new PG.Renderer(G.T);
    G.setup3D(); G.resize();
    if (G.mode === 'attract') G.startAttract();
  };
  G.reconfigureGraphics = function () {
    G.setup3D(); G.resize();
    if (!G.use3D) { G.noWebGL = true; G.paused = true; if (PG.UI && PG.UI.noWebGL) PG.UI.noWebGL(); }
  };
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
    if (!G.V) return;
    var q = G.V.quality, cap = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    var d3 = Math.max(0.5, Math.min(window.devicePixelRatio || 1, cap) * (G.rs || 1));
    G.dpr = d3; G.W = Math.round(W * d3); G.H = Math.round(H * d3);
    G.V.resize(W, H, d3);
    G.towerRows = W < 700 ? Math.min(8, Math.floor((H - 300) / 24)) : Math.max(6, Math.min(22, Math.floor((H - 200) / 27)));
    if (G.R) G.makeMini();
  };

  // Po zmianie malowań w kreatorze
  G.clearLiveryCache = function () { if (PG.Car3D && PG.Car3D.clearCache) PG.Car3D.clearCache(); };

  G.startAttract = function () {
    G.stopHaptics();
    G.net = false; G.netMenu = false;
    var entries = [];
    PG.allTeams().slice(0, 10).forEach(function (t) { t.drivers.forEach(function (d) { entries.push({ driver: d, team: t }); }); });
    G.S = PG.createSession({ track: G.T, entries: entries, mode: 'attract', laps: 99, weather: 'sun', difficulty: 'hard', damage: PG.Store.data.settings.damage || 'full' });
    if (G.V) { G.V.setSession(G.S); G.V.setMode('tv'); }
    G.mode = 'attract'; G.timeScale = 1; G.paused = false;
    G.attractCar = 0; G.attractT = 0; G.attractCamT = 0; G.attractCamK = 0;
    $('hud').hidden = true;
  };

  // cfg: {mode:'race'|'quali', entries, laps, weather, difficulty, spectate}
  G.startSession = function (cfg, onDone) {
    PG.Audio.init();
    G.stopHaptics();
    var st = PG.Store.data.settings;
    G.S = PG.createSession({
      track: G.T, entries: cfg.entries, mode: cfg.mode, laps: cfg.laps, weather: cfg.weather, difficulty: cfg.difficulty, autoPlayer: !!cfg.spectate,
      damage: cfg.damage || st.damage || 'full', assists: G.assistOpts(), wearMul: cfg.wearMul || 1, incidents: cfg.incidents || 'rare',
      netClient: !!cfg.netClient
    });
    if (G.V) { G.V.setSession(G.S); G.V.setMode(cfg.spectate ? 'tv' : (st.camera || 'chase')); }
    G.mode = cfg.mode; G.spectate = !!cfg.spectate; G.timeScale = cfg.spectate ? 8 : 1; G.paused = false;
    G.net = !!cfg.net; G.netMenu = false;
    G.onDone = onDone; G.endT = 0; G.cfg = cfg;
    G.best = { s: [0, 0, 0], my: [0, 0, 0] }; G.secCols = ['', '', ''];
    G.padUsed = false; G.dmgMsgT = 0;
    G.perfT = 0; G.dtAvg = 0.016; // pomiar wydajności od nowa
    var p = G.S.player;
    $('hud').hidden = false; G.makeMini();
    $('lights').hidden = cfg.mode !== 'race';
    G.setLights(0);
    $('touch').hidden = !G.isTouch();
    G.resetHud();
    G.applyGearbox();
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
        if (k && !G.netMenu) { G.input[k] = true; e.preventDefault(); }
        if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) { G.togglePause(); e.preventDefault(); }
        if (e.code === 'KeyR' && !e.repeat) G.resetPlayer();
        if (e.code === 'KeyC' && !e.repeat && !G.paused) G.cycleCamera(e.shiftKey ? -1 : 1);
        if (e.code === 'KeyB' && !e.repeat && !G.paused) G.toggleBox();
        if ((e.code === 'KeyX' || e.code === 'NumpadAdd') && !e.repeat) G.shift(1);
        if ((e.code === 'KeyZ' || e.code === 'NumpadSubtract') && !e.repeat) G.shift(-1);
        var dig = { Digit1: 'S', Digit2: 'M', Digit3: 'H', Digit4: 'W', Numpad1: 'S', Numpad2: 'M', Numpad3: 'H', Numpad4: 'W' }[e.code];
        if (dig && !e.repeat && !G.paused) G.pickComp(dig);
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
    [['tGu', 1], ['tGd', -1]].forEach(function (b) {
      var el = $(b[0]); if (!el) return;
      el.addEventListener('pointerdown', function (e) { e.preventDefault(); el.classList.add('on'); G.shift(b[1]); });
      var off = function (e) { e.preventDefault(); el.classList.remove('on'); };
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
    });
    var tc = $('tC');
    if (tc) tc.addEventListener('pointerdown', function (e) { e.preventDefault(); if (!G.paused) G.cycleCamera(1); });
    $('pauseBtn').addEventListener('click', function () { G.togglePause(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        G.stopHaptics();
        if ((G.mode === 'race' || G.mode === 'quali') && !G.paused && !(G.net && G.mode === 'race')) G.togglePause();
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
          if (active && !G.paused && !G.netMenu && G.padUsed && !G.spectate) G.togglePause();
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
        if (!G.paused && !G.netMenu) {
          if (P.hit('camera')) G.cycleCamera(1);
          if (P.hit('reset')) G.resetPlayer();
          if (P.hit('box')) G.toggleBox();
          if (P.hit('gearUp')) G.shift(1);
          if (P.hit('gearDown')) G.shift(-1);
          if (P.hit('compUp')) G.cycleComp(-1);
          if (P.hit('compDown')) G.cycleComp(1);
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

  // ---------- PIT STOP: prośba o zjazd i wybór opon ----------
  G.compList = function () { return G.S && G.S.env.wet ? ['W', 'M', 'H', 'S'] : ['S', 'M', 'H', 'W']; };
  G.toggleBox = function () {
    var S = G.S, p = S && S.player;
    if (!p || S.mode !== 'race' || G.spectate || !PG.Pit || p.finished) return;
    if (p.inPit) { G.msg('', 'Już jesteś w alei serwisowej', '', 1.4); return; }
    PG.Pit.request(p, S, !p.pitReq);
    var T = PG.TYRES[p.pitComp] || PG.TYRES.M;
    if (p.pitReq) G.msg('BOX, BOX', 'Zjazd na wjeździe za Parabolicą · opony: ' + T.name + ' (1–4' + (padConnected() ? ' / krzyżak ▲▼' : '') + ')', '', 3);
    else G.msg('', 'Odwołano zjazd do boksu', '', 1.6);
  };
  G.pickComp = function (k) {
    var S = G.S, p = S && S.player;
    if (!p || S.mode !== 'race' || !PG.TYRES[k]) return;
    p.pitComp = k;
    G.msg('', 'Opony na pit stop: ' + PG.TYRES[k].name + (p.pitReq ? '' : ' · B' + (padConnected() ? (G.manualGears() ? ' / Create' : ' / L1') : '') + ' zgłasza zjazd'), '', 1.8);
  };
  G.cycleComp = function (dir) {
    var S = G.S, p = S && S.player;
    if (!p || S.mode !== 'race') return;
    var L = G.compList(), i = L.indexOf(p.pitComp || (PG.Pit ? PG.Pit.suggest(p, S) : 'M'));
    G.pickComp(L[(i + dir + L.length) % L.length]);
  };

  G.cycleCamera = function (dir) {
    var st = PG.Store.data.settings;
    if (!G.V) return;
    var list = PG.CAMERAS, i = 0;
    for (var k = 0; k < list.length; k++) if (list[k].id === G.V.cam.mode) i = k;
    i = (i + dir + list.length) % list.length;
    G.V.setMode(list[i].id);
    if (!G.spectate) { st.camera = list[i].id; PG.Store.save(); }
    G.msg('', 'Kamera: ' + list[i].name, '', 1.4);
  };


  G.resetPlayer = function () {
    var p = G.S && G.S.player;
    if (!p || p.finished || p.pit || p.inPit || G.paused || G.S.state === 'lights') return;
    if (Math.abs(p.v) < 25) { PG.resetCar(p, G.T); G.msg('Powrót na tor', '', '', 1.2); }
  };

  G.togglePause = function () {
    if (G.mode !== 'race' && G.mode !== 'quali') return;
    // wyścig online: menu bez zatrzymywania czasu (inni jadą dalej)
    if (G.net && G.mode === 'race') {
      G.netMenu = !G.netMenu; G.input = {};
      if (G.netMenu) PG.UI.showPause(); else { G.padDrsBlock = true; PG.UI.hidePause(); }
      return;
    }
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
    // adaptacyjna rozdzielczość (tylko w jeździe): przy słabym sprzęcie zmniejsz bufor, przy zapasie wróć wyżej
    if (G.mode === 'race' || G.mode === 'quali') {
      G.dtAvg = (G.dtAvg || 0.016) * 0.97 + dt * 0.03;
      G.perfT = (G.perfT || 0) + dt;
      if (G.perfT > 2.5 && G.dtAvg > 1 / 38 && (G.rs || 1) > 0.55 && !document.hidden) { G.rs = (G.rs || 1) * 0.85; G.perfT = 0; G.resize(); }
      else if (G.perfT > 5 && G.dtAvg < 1 / 55 && (G.rs || 1) < 1 && !document.hidden) { G.rs = Math.min(1, (G.rs || 1) / 0.85); G.perfT = 0; G.resize(); }
    }
    if (!G.S) return;
    G.padFrame(G.mode === 'race' || G.mode === 'quali');
    var S = G.S; if (!S) return; // pad mógł zmienić sesję (np. wyjście do menu)
    var active = (G.mode === 'race' || G.mode === 'quali');
    var input = (active && !G.netMenu) ? G.readInput() : NOINPUT; // menu online: bolid bez sterowania
    if (G.net && PG.Multi) { try { PG.Multi.pre(S, dt); } catch (e) { console.warn('Multiplayer (przed krokiem):', e); } }
    if (!G.paused) {
      for (var k = 0; k < G.timeScale; k++) {
        PG.updateSession(S, dt, input);
        G.handleEvents(S.events, active);
      }
      if (active) G.checkEnd(dt);
      if (G.msgT > 0) { G.msgT -= dt; if (G.msgT <= 0) G.msg('', ''); }
    }
    if (G.S !== S) return; // koniec sesji w tej klatce (nowa sesja od następnej)
    if (G.net && PG.Multi) { try { PG.Multi.post(S, dt); } catch (e) { console.warn('Multiplayer (po kroku):', e); } }
    G.hapticsFrame(S, dt);
    var line = (active && !G.spectate && S.state !== 'lights') ? G.lineMode() : 'off';
    if (G.V) G.draw3D(S, dt, active, line);
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
          G.msg('', S.assists && S.assists.autoDrs ? 'DRS dostępny · otworzy się automatycznie' : 'DRS dostępny · wciśnij E / Shift' + (padConnected() ? (G.manualGears() ? ' / ✕' : ' / R1') : ''), '', 1.6);
          break;
        case 'drs': if (e.car === p && A.drs) A.drs(true); break;
        case 'drsclose': if (e.car === p && A.drs) A.drs(false); break;
        case 'wall': if (e.car === p) { A.thump(e.force); if (V) V.shake(Math.min(8, e.force * 0.4)); } break;
        case 'hit': if (e.player) { A.thump(e.force * 0.6); if (V) V.shake(Math.min(6, e.force * 0.5)); } break;
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
            // przypomnienie o obowiązkowej zmianie mieszanki (w tym samym komunikacie)
            var rem = PG.Pit && PG.Pit.ruleActive(S) && !PG.Pit.ruleOk(p) && !p.pitReq && !p.inPit && left > 1 && left <= Math.max(3, Math.round(S.laps * 0.4));
            G.msg(left === 1 ? 'OSTATNIE OKRĄŻENIE' : 'OKRĄŻENIE ' + (p.lap + 1) + '/' + S.laps,
              rem ? PG.fmtTime(e.t) + ' · Obowiązkowy pit stop: użyj drugiej mieszanki (B' + (padConnected() ? (G.manualGears() ? ' / Create' : ' / L1') : '') + ')' : PG.fmtTime(e.t), '', rem ? 3 : 2.2);
          }
          break;
        case 'fastest': if (e.car === p) G.msg('NAJSZYBSZE OKRĄŻENIE', PG.fmtTime(e.t), 'purple', 2.5); break;
        case 'finish': if (e.car === p) { G.stopHaptics(); G.msg('META! P' + p.pos, p.penalty ? 'z karą +' + p.penalty + ' s' : '', '', 4); A.beep(660, 0.2); A.beep(990, 0.4); } break;
        case 'qualidone': G.stopHaptics(); G.msg('CZAS OKRĄŻENIA', PG.fmtTime(e.t), 'purple', 4); break;
        case 'pitin': if (e.car === p) G.msg('ALEJA SERWISOWA', 'Ogranicznik 80 km/h przy garażach', '', 2.2); break;
        case 'pitdone':
          if (e.car === p) G.msg('PIT STOP ' + e.t.toFixed(1).replace('.', ',') + ' s', 'Opony: ' + (PG.TYRES[e.comp] || PG.TYRES.M).name + (e.fixed ? ' · nowe skrzydło' : ''), '', 2.6);
          break;
        case 'pitout': if (e.car === p) G.msg('', 'Wyjazd z alei — wracasz do wyścigu', '', 1.6); break;
        case 'rc': G.msg(e.text, e.sub, e.mode === 'green' ? 'green' : 'rc', e.mode === 'green' ? 2.5 : 3.5); break;
        case 'retire': if (e.car !== p) G.note(PG.driverName(e.car.driver) + ' odpada z wyścigu · ' + (e.why === 'crash' ? 'wypadek' : 'awaria')); break;
        case 'rulepen': if (e.car === p) G.msg('KARA +30 s', 'Nie użyto dwóch różnych mieszanek', 'dmg', 3.5); break;
      }
    }
  };

  G.checkEnd = function (dt) {
    var S = G.S, p = S.player;
    if (G.net && S.mode === 'race' && PG.Multi) { PG.Multi.checkEnd(dt); return; }
    if (S.mode === 'quali' && S.done) { G.endT += dt; if (G.endT > 2.2) G.finish(); }
    if (S.mode === 'race' && p.finished) {
      G.endT += dt;
      var allDone = S.cars.every(function (c) { return c.finished || c.retired || c.retiring; });
      if (G.endT > 5 || (allDone && G.endT > 2)) G.finish();
    }
  };

  G.finish = function (outOv) {
    G.stopHaptics();
    var S = G.S, cb = G.onDone; G.onDone = null;
    var out = outOv || (S.mode === 'quali' ? { type: 'quali', time: S.player.finishTime || S.player.lastLap } : { type: 'race', res: PG.classify(S), fastest: S.fastest });
    G.net = false; G.netMenu = false;
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
      tyre: $('dTyre'), wear: $('dWear'), pos: $('dPos'), laps: $('laps'), next: $('next'), tower: $('tower'),
      pit: $('dPit'), rcb: $('rcb')
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
    setText(H.gear, p.gear === 0 ? 'R' : !p.manual && kmh < 2 && p.throttle === 0 ? 'N' : String(p.gear));
    if (H.gear && H.gear._lim !== !!p.limiter) { H.gear._lim = !!p.limiter; H.gear.classList.toggle('lim', H.gear._lim); }
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
    // pit stop: prośba, przejazd aleją, postój
    if (H.pit) {
      var pt = p.pit, ptxt = '', pcls = 'pitb';
      if (pt && pt.ph === 'stop') { ptxt = 'POSTÓJ ' + Math.max(0, pt.t).toFixed(1).replace('.', ','); pcls += ' stop'; }
      else if (pt) { ptxt = 'ALEJA 80'; pcls += ' lane'; }
      else if (p.pitReq) ptxt = 'BOX · ' + (p.pitComp || 'M');
      if (H.pit._t !== ptxt) { H.pit._t = ptxt; H.pit.textContent = ptxt; H.pit.hidden = !ptxt; }
      if (H.pit.className !== pcls) H.pit.className = pcls;
    }
    // dyrekcja wyścigu: SC / VSC
    if (H.rcb) {
      var rc = S.rc, rtxt = '', rcls = '';
      if (rc && S.mode === 'race') {
        var lim = p.rcCap < Infinity && !p.inPit ? ' · limit ' + Math.round(p.rcCap * 3.6) + ' km/h' : '';
        if (rc.mode === 'sc') { rtxt = 'SAFETY CAR<small>bez wyprzedzania' + lim + '</small>'; rcls = 'flash'; }
        else if (rc.mode === 'scIn') rtxt = 'SC ZJEŻDŻA<small>restart na linii mety</small>';
        else if (rc.mode === 'vsc') { rtxt = 'VSC<small>wirtualny samochód bezpieczeństwa' + lim + '</small>'; rcls = 'flash'; }
        else if (rc.mode === 'vscEnd') rtxt = 'VSC KOŃCZY SIĘ<small>zaraz zielona flaga</small>';
      }
      if (H.rcb._h !== rtxt) { H.rcb._h = rtxt; H.rcb.innerHTML = rtxt; H.rcb.hidden = !rtxt; }
      if (H.rcb.className !== rcls) H.rcb.className = rcls;
    }
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
      var rcm = S.rc && S.rc.mode, rcf = rcm === 'sc' || rcm === 'scIn' ? '<span class="rcf">SC</span>' : rcm === 'vsc' || rcm === 'vscEnd' ? '<span class="rcf">VSC</span>' : '';
      html += '<div class="hd"><span>OKR' + rcf + '</span><span class="num">' + Math.min(S.laps, Math.max(1, (S.order[0].lap || 0) + 1)) + '/' + S.laps + '</span></div>';
      var rows = S.order, n = Math.min(rows.length, G.towerRows);
      var pi = rows.indexOf(p), start = 1;
      if (pi >= n) start = Math.max(1, Math.min(rows.length - (n - 1), pi - Math.floor(n / 2)));
      var leader = rows[0];
      for (var r = 0; r < n; r++) {
        var ri = r === 0 ? 0 : start + r - 1; if (ri >= rows.length) break;
        var c2 = rows[ri];
        var gap, gcls = 'g';
        if (c2.retired || c2.retiring) { gap = 'DNF'; gcls = 'g dnf'; }
        else if (c2.inPit) { gap = 'PIT'; gcls = 'g pit'; }
        else if (ri === 0) gap = S.state === 'lights' ? '' : 'Lider';
        else if (c2.finished && leader.finished) gap = PG.fmtGap(c2.finishTime - leader.finishTime);
        else {
          var lapsBehind = Math.floor((leader.dist - c2.dist) / T.length);
          gap = lapsBehind >= 1 ? '+' + lapsBehind + ' OKR' : S.state === 'lights' ? '' : '+' + PG.gapBetween(S, leader, c2).toFixed(1);
        }
        html += '<div class="r' + (c2.isPlayer ? ' me' : '') + '"><span class="p">' + (ri + 1) + '</span><span class="c" style="background:' + c2.team.livery.primary + '"></span><span>' + esc(PG.driverCode(c2.driver)) + '</span><span class="' + gcls + '">' + gap + '</span></div>';
      }
    } else {
      html += '<div class="hd"><span>' + esc(G.cfg && G.cfg.qualiName && G.cfg.qualiName !== 'Kwalifikacje' ? 'KWALIFIKACJE ' + G.cfg.qualiName : 'KWALIFIKACJE') + '</span><span class="num">1 OKR</span></div>';
      html += '<div class="r me"><span class="p">–</span><span class="c" style="background:' + p.team.livery.primary + '"></span><span>' + esc(PG.driverCode(p.driver)) + '</span><span class="g">' + (p.started ? PG.fmtTime(S.time - p.lapStart).slice(0, -2) : 'w drodze') + '</span></div>';
      if (G.cfg && G.cfg.target) html += '<div class="r"><span class="p">' + (G.cfg.targetLabel === 'AWANS' ? '↑' : 'P1') + '</span><span class="c" style="background:#a64dff"></span><span>' + esc(G.cfg.targetLabel || 'CEL') + '</span><span class="g">' + PG.fmtTime(G.cfg.target) + '</span></div>';
    }
    setHTML(H.tower, html);
  };
})(PG);
