// WORLD GP — dźwięk silnika i efekty (Web Audio, bez plików).
// Silniki V10: synteza w js/v10.js (AudioWorklet), tu słuchacz w kamerze, wybór słyszanych bolidów,
// odległość, panorama i efekt Dopplera. Ustawienie „Silniki: Prosty” wraca do dawnego, lżejszego dźwięku.
// „Silniki: Paczka F1 25” — te same głosy grają nagrania silników z paczki wczytanej przez gracza
// (js/enginepack.js), każdy bolid nagranie swojego producenta.
(function (PG) {
  'use strict';
  var A = PG.Audio = { ctx: null, on: true, vol: 0.5, lastCrunch: -9, lastDrs: -9 };

  function fin(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // ---------- silniki V10 ----------
  var V10 = A.v10 = {
    ready: false, node: null, eng: null, sp: null, bus: null, buf: null, slots: [], idle: true, tmp: null,
    banks: null, bankMap: null, bankSent: null, useBank: false,
    lis: { x: 0, y: 0, z: 0, fx: 1, fz: 0, vx: 0, vz: 0, t: 0, ok: false, mode: 'chase' }
  };
  var MAX_DIST = 420; // dalej rywali nie słychać

  function v10Init(c) {
    var lib = window.PG_V10;
    if (!lib) return;
    V10.lib = lib; V10.P = lib.P; V10.NP = lib.NP;
    V10.buf = new Float32Array(lib.NP * lib.MAXV);
    for (var i = 0; i < lib.MAXV; i++) V10.slots.push({ car: null, gear: 0, up: 0, down: 0, reset: 0, free: 99 });
    // szyna silników z kompresorem: kilka bolidów obok siebie nie przesteruje dźwięku
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    V10.bus = c.createGain(); V10.bus.gain.value = 0.8;
    V10.bus.connect(comp); comp.connect(A.master);
    var useSP = function () {
      if (!c.createScriptProcessor) return;
      var eng = V10.eng = new lib.Engine(c.sampleRate);
      var sp = V10.sp = c.createScriptProcessor(2048, 0, 2);
      sp.onaudioprocess = function (ev) { var o = ev.outputBuffer; eng.process(o.getChannelData(0), o.getChannelData(1), o.length); };
      sp.connect(V10.bus); V10.ready = true; v10SendBanks();
    };
    // AudioWorklet działa tylko z localhost albo https; inaczej ten sam kod w wątku głównym
    if (c.audioWorklet && window.AudioWorkletNode && window.isSecureContext !== false) {
      c.audioWorklet.addModule('js/v10.js?v=' + (PG.VERSION || '')).then(function () {
        V10.node = new AudioWorkletNode(c, 'pg-v10', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        V10.node.connect(V10.bus); V10.ready = true; v10SendBanks();
      }).catch(function (e) { console.warn('Dźwięk V10: AudioWorklet niedostępny, liczony w wątku głównym', e); useSP(); });
    } else useSP();
  }

  // Nagrania silników z paczki: przekazanie do wątku dźwięku (tablice przenoszone, bez kopii w pamięci strony)
  function v10SendBanks() {
    if (!V10.ready || V10.bankSent === V10.banks) return;
    var banks = V10.banks;
    if (V10.node) {
      var tr = [];
      (banks || []).forEach(function (b) {
        b.mics.forEach(function (m) {
          [m.on, m.off].forEach(function (L) {
            ['pcm', 'mk', 'per', 'rpm', 'rf', 'wn', 'lv'].forEach(function (k) { var ab = L[k] && L[k].buffer; if (ab && ab.byteLength && tr.indexOf(ab) < 0) tr.push(ab); });
          });
        });
      });
      try { V10.node.port.postMessage({ banks: banks }, tr); }
      catch (e) { console.warn('Paczka dźwięków: nie udało się przekazać nagrań', e); return; }
    } else if (V10.eng) V10.eng.setBanks(banks);
    V10.bankSent = banks;
  }
  A.setBanks = function (banks, map) {
    V10.banks = banks && banks.length ? banks : null;
    V10.bankMap = V10.banks ? map || {} : null;
    v10SendBanks();
  };

  function v10Post() {
    if (V10.node) V10.node.port.postMessage(V10.buf);
    else if (V10.eng) V10.eng.set(V10.buf);
  }

  // Słuchacz w kamerze: pozycja, kierunek patrzenia i prędkość (do efektu Dopplera) w płaszczyźnie toru
  function v10Listener(V, focus) {
    var L = V10.lis, now = (window.performance ? performance.now() : Date.now()) / 1000, cam = V && V.camera;
    var x, y, z, fx, fz;
    if (cam && cam.position && cam.getWorldDirection && window.THREE) {
      x = cam.position.x; y = cam.position.y; z = cam.position.z;
      var d = V10.tmp || (V10.tmp = new THREE.Vector3());
      cam.getWorldDirection(d); fx = d.x; fz = d.z;
    } else { x = focus.x; y = 1.2; z = focus.y; fx = Math.cos(focus.h); fz = Math.sin(focus.h); }
    var fl = Math.sqrt(fx * fx + fz * fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = 1; fz = 0; }
    var dt = now - L.t;
    if (L.ok && dt > 0.001 && dt < 0.25) {
      var vx = (x - L.x) / dt, vz = (z - L.z) / dt;
      if (vx * vx + vz * vz > 150 * 150) { vx = 0; vz = 0; } // przeskok kamery
      L.vx += (vx - L.vx) * 0.3; L.vz += (vz - L.vz) * 0.3;
    } else { L.vx = 0; L.vz = 0; }
    L.x = x; L.y = fin(y, 1.2); L.z = z; L.fx = fx; L.fz = fz; L.t = now; L.ok = true;
    L.mode = V && V.cam && V.cam.mode ? V.cam.mode : 'chase';
    return L;
  }

  // Parametry jednego głosu dla bolidu c
  function v10Voice(k, c, L, S, own, now) {
    var P = V10.P, b = V10.buf, o = k * V10.NP, sl = V10.slots[k];
    if (sl.car !== c) { sl.car = c; sl.reset++; sl.gear = c.gear | 0; sl.free = 0; }
    var g = c.gear | 0;
    if (g > 0 && sl.gear > 0 && Math.abs(fin(c.v, 0)) > 2) { if (g > sl.gear) sl.up++; else if (g < sl.gear) sl.down++; }
    sl.gear = g;
    var rpm = fin(c.rpm, 4500), load = clamp(fin(c.throttle, 0), 0, 1), dmg = c.dmg ? clamp(fin(c.dmg.engine, 0), 0, 1) : 0;
    var lim = !!c.limiter, pitLim = !!c.pitLim;
    // bolid innego gracza: obroty przychodzą co pakiet, prędkość jest wygładzona — obroty z prędkości i biegu
    if (c.remote && g > 0 && PG.engineRpm && PG.GEAR_TOP) {
      var kmh = Math.abs(fin(c.v, 0)) * 3.6;
      rpm = PG.engineRpm(g, kmh, load); lim = kmh >= PG.GEAR_TOP[g] * 0.995;
      pitLim = !!c.inPit && kmh > 50 && kmh < 85;
    }
    // pola startowe: przy zapalonych światłach kierowcy trzymają obroty (tylko dźwięk; gracz sam decyduje)
    if (S && S.state === 'lights' && (S.lightsOn || 0) >= 1 && !(c.isPlayer && !S.autoPlayer)) {
      var ph = now * (1.1 + 0.13 * ((c.id || 0) % 5)) + (c.id || 0) * 1.7;
      rpm = 9800 + 2200 * (0.5 + 0.5 * Math.sin(ph)) + 600 * Math.sin(ph * 2.7); load = 0.3;
    }
    if (c.retiring) { load = 0; dmg = Math.max(dmg, 0.6); }
    var gain, pan = 0, lp = 16000, dop = 1, onb = 0;
    var dx = c.x - L.x, dz = c.y - L.z, dy = L.y - 0.6, d = Math.sqrt(dx * dx + dz * dz + dy * dy);
    var onboard = own && (L.mode === 'cockpit' || L.mode === 'tcam');
    if (onboard) { gain = 0.85; onb = 1; }
    else {
      // głośność 1/r od ok. 8 m, wysokie tony słabną z odległością, za plecami słuchacza trochę ciemniej
      gain = 8 / (8 + d);
      var rx = -L.fz, rz = L.fx;
      pan = d > 0.3 ? clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8 : 0;
      lp = 17000 / (1 + d / 45);
      if (dx * L.fx + dz * L.fz < 0) lp *= 0.7;
      // Doppler: prędkość, z jaką bolid oddala się od słuchacza
      var ps = fin(c.h, 0) + fin(c.beta, 0), cv = fin(c.v, 0);
      var vr = d > 0.5 ? ((Math.cos(ps) * cv - L.vx) * dx + (Math.sin(ps) * cv - L.vz) * dz) / d : 0;
      dop = clamp(343 / (343 + vr), 0.6, 1.7);
      if (own) onb = L.mode === 'chase' ? 0.25 : L.mode === 'far' ? 0.1 : 0;
    }
    b[o + P.ON] = 1; b[o + P.RPM] = rpm; b[o + P.LOAD] = load; b[o + P.GAIN] = gain; b[o + P.PAN] = pan;
    b[o + P.LP] = lp; b[o + P.DOP] = dop; b[o + P.ONB] = onb; b[o + P.LIM] = lim ? 1 : 0;
    b[o + P.UP] = sl.up; b[o + P.DOWN] = sl.down; b[o + P.PIT] = pitLim ? 1 : 0; b[o + P.DMG] = dmg;
    b[o + P.SPD] = Math.abs(fin(c.v, 0)); b[o + P.SEED] = (c.id || 0) + 1; b[o + P.RESET] = sl.reset;
    // nagranie silnika producenta (paczka dźwięków); nieznany producent — pierwszy bank
    var bi = 0;
    if (V10.useBank) { var k = V10.bankMap[c.team && c.team.engine]; bi = (k == null ? 0 : k) + 1; }
    if (P.BANK != null) b[o + P.BANK] = bi;
  }

  function v10Off() {
    if (V10.idle || !V10.buf) return;
    var P = V10.P;
    for (var k = 0; k < V10.slots.length; k++) { V10.buf[k * V10.NP + P.ON] = 0; V10.slots[k].car = null; V10.slots[k].free = 99; }
    v10Post(); V10.idle = true;
  }

  // Klatka: bolid w kamerze (głos 0) i najbliżsi rywale (głosy 1..)
  var near = [];
  function v10Frame(car, S, V) {
    var L = v10Listener(V, car), now = L.t, P = V10.P, nv = V10.slots.length, k, i;
    v10Voice(0, car, L, S, true, now);
    // najbliżsi rywale; przydział do głosów stały, póki bolid jest w zasięgu
    near.length = 0;
    var cars = S && S.cars ? S.cars : [];
    for (i = 0; i < cars.length; i++) {
      var c = cars[i];
      if (c === car || c.retired || !isFinite(c.x)) continue;
      var dx = c.x - L.x, dz = c.y - L.z, d2 = dx * dx + dz * dz;
      if (d2 < MAX_DIST * MAX_DIST) { c._aD = d2; near.push(c); }
    }
    near.sort(function (a, b) { return a._aD - b._aD; });
    if (near.length > nv - 1) near.length = nv - 1;
    for (k = 1; k < nv; k++) {
      var s = V10.slots[k];
      if (s.car && near.indexOf(s.car) < 0) { s.car = null; s.free = 0; }
      if (!s.car) { s.free++; V10.buf[k * V10.NP + P.ON] = 0; }
    }
    for (i = 0; i < near.length; i++) {
      var cc = near[i], at = -1;
      for (k = 1; k < nv; k++) if (V10.slots[k].car === cc) { at = k; break; }
      if (at < 0) {
        // wolny głos: najpierw ten, który już wybrzmiał
        var best = -1;
        for (k = 1; k < nv; k++) if (!V10.slots[k].car && (best < 0 || V10.slots[k].free > V10.slots[best].free)) best = k;
        if (best < 0) continue;
        at = best;
      }
      v10Voice(at, cc, L, S, false, now);
    }
    v10Post(); V10.idle = false;
  }

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var c = A.ctx = new AC();
    A.master = c.createGain(); A.master.gain.value = A.on ? A.vol : 0; A.master.connect(c.destination);
    // silnik: dwa oscylatory + filtr
    A.eng = c.createGain(); A.eng.gain.value = 0;
    var f = A.filt = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200; f.Q.value = 4;
    A.o1 = c.createOscillator(); A.o1.type = 'sawtooth';
    A.o2 = c.createOscillator(); A.o2.type = 'square';
    var g2 = c.createGain(); g2.gain.value = 0.35;
    A.o1.connect(f); A.o2.connect(g2); g2.connect(f); f.connect(A.eng); A.eng.connect(A.master);
    A.o1.start(); A.o2.start();
    // tło stawki: szum
    var len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noiseBuf = buf;
    var n = c.createBufferSource(); n.buffer = buf; n.loop = true;
    var nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
    A.skidG = c.createGain(); A.skidG.gain.value = 0;
    n.connect(nf); nf.connect(A.skidG); A.skidG.connect(A.master); n.start();
    var n2 = c.createBufferSource(); n2.buffer = buf; n2.loop = true;
    var nf2 = c.createBiquadFilter(); nf2.type = 'lowpass'; nf2.frequency.value = 500;
    A.crowdG = c.createGain(); A.crowdG.gain.value = 0;
    n2.connect(nf2); nf2.connect(A.crowdG); A.crowdG.connect(A.master); n2.start();
    // pisk opon: zablokowane koła (wysoki, tonalny) i buksowanie (niższy) — dokładany do szumu poślizgu
    var n3 = c.createBufferSource(); n3.buffer = buf; n3.loop = true;
    A.sqF = c.createBiquadFilter(); A.sqF.type = 'bandpass'; A.sqF.frequency.value = 1800; A.sqF.Q.value = 7;
    A.sqG = c.createGain(); A.sqG.gain.value = 0;
    n3.connect(A.sqF); A.sqF.connect(A.sqG); A.sqG.connect(A.master); n3.start(0, 0.7);
    A.sqO = c.createOscillator(); A.sqO.type = 'triangle'; A.sqO.frequency.value = 1800;
    A.sqOG = c.createGain(); A.sqOG.gain.value = 0;
    A.sqO.connect(A.sqOG); A.sqOG.connect(A.master); A.sqO.start();
    // silniki V10 (AudioWorklet albo zapasowo w wątku głównym)
    try { v10Init(c); } catch (e) { console.warn('Dźwięk V10 niedostępny', e); }
  };

  A.setOn = function (on) { A.on = on; if (A.master) A.master.gain.value = on ? A.vol : 0; };
  A.setVol = function (v) { A.vol = v; if (A.master && A.on) A.master.gain.value = v; };

  // Dźwięk bolidu w kamerze (car) i — z silnikami V10 — rywali w pobliżu (S: sesja, V: widok 3D z kamerą)
  A.engine = function (car, active, others, S, V) {
    if (!A.ctx) return;
    var t = A.ctx.currentTime;
    var st = PG.Store && PG.Store.data && PG.Store.data.settings;
    var useV10 = V10.ready && !(st && st.engineSound === 'simple');
    V10.useBank = !!(st && st.engineSound === 'pack' && V10.banks && V10.bankSent === V10.banks);
    if (!active || !car) {
      A.eng.gain.setTargetAtTime(0, t, 0.08); A.skidG.gain.setTargetAtTime(0, t, 0.05); A.crowdG.gain.setTargetAtTime(0, t, 0.2);
      if (A.sqG) { A.sqG.gain.setTargetAtTime(0, t, 0.05); A.sqOG.gain.setTargetAtTime(0, t, 0.05); }
      v10Off();
      return;
    }
    var rpm = fin(car.rpm, 4500), thr = fin(car.throttle, 0), av = Math.abs(fin(car.v, 0));
    if (useV10 && A.on) {
      A.eng.gain.setTargetAtTime(0, t, 0.05);
      v10Frame(car, S, V);
    } else {
      v10Off();
      // dawny, prosty silnik (obroty V10 przeliczone na jego dawną skalę wysokości dźwięku)
      var fr = rpm * 0.66 / 60 * 1.6;
      A.o1.frequency.setTargetAtTime(fr, t, 0.02);
      A.o2.frequency.setTargetAtTime(fr * 2.005, t, 0.02);
      A.filt.frequency.setTargetAtTime(500 + thr * 1800 + rpm * 0.053, t, 0.05);
      A.eng.gain.setTargetAtTime(0.05 + thr * 0.11, t, 0.05);
    }
    var lk = Math.min(1, Math.max(0, fin(car.lock, 0))), ws = Math.min(1, Math.max(0, fin(car.wspin, 0)));
    // ogólny poślizg (szum); blokadę słychać osobno jako pisk, więc szum jest wtedy trochę cichszy
    var sk = Math.max(0, fin(car.skid, 0) - lk * 0.35);
    A.skidG.gain.setTargetAtTime(Math.min(0.25, sk * 0.3 * Math.min(1, av / 20)), t, 0.04);
    A.crowdG.gain.setTargetAtTime(others || 0, t, 0.3);
    if (A.sqG) {
      var vf = Math.min(1, av / 15);
      var sq = Math.min(0.24, (lk * 0.22 + ws * 0.11) * vf);
      var fq = lk >= ws ? 1650 + 550 * lk + Math.random() * 140 : 1050 + 350 * ws + Math.random() * 80;
      A.sqF.frequency.setTargetAtTime(fq, t, 0.05);
      A.sqG.gain.setTargetAtTime(sq, t, 0.03);
      A.sqO.frequency.setTargetAtTime(fq * 0.985 + Math.sin(t * 41) * 45, t, 0.02);
      A.sqOG.gain.setTargetAtTime(lk > 0.2 ? Math.min(0.04, lk * 0.04 * vf) : 0, t, 0.03);
    }
  };

  A.beep = function (freq, dur, type, vol) {
    if (!A.ctx) return;
    var c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.value = vol || 0.15; g.gain.setTargetAtTime(0, c.currentTime + dur * 0.7, dur * 0.2);
    o.connect(g); g.connect(A.master); o.start(); o.stop(c.currentTime + dur + 0.2);
  };

  A.thump = function (force) {
    if (!A.ctx) return;
    var c = A.ctx, s = c.createBufferSource(); s.buffer = A.noiseBuf;
    var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    var g = c.createGain(); g.gain.value = Math.min(0.6, 0.1 + force * 0.02); g.gain.setTargetAtTime(0, c.currentTime + 0.05, 0.06);
    s.connect(f); f.connect(g); g.connect(A.master); s.start(); s.stop(c.currentTime + 0.4);
  };

  // Zmiana biegu (ręczna skrzynia): krótki metaliczny klik skrzyni, w dół niższy
  A.shift = function (dir) {
    if (!A.ctx || !A.noiseBuf) return;
    var c = A.ctx, t = c.currentTime;
    var s = c.createBufferSource(); s.buffer = A.noiseBuf;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = dir > 0 ? 2200 : 1400; bp.Q.value = 2.5;
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    s.connect(bp); bp.connect(g); g.connect(A.master); s.start(t, Math.random() * 1.5); s.stop(t + 0.06);
  };

  // Siłownik DRS: krótki świst hydrauliki i klapnięcie klapy (open = true przy otwarciu)
  A.drs = function (open) {
    if (!A.ctx || !A.noiseBuf) return;
    var c = A.ctx, t = c.currentTime;
    if (t - A.lastDrs < 0.08) return;
    A.lastDrs = t;
    var o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(open ? 320 : 720, t);
    o.frequency.exponentialRampToValueAtTime(open ? 840 : 260, t + 0.11);
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(bp); bp.connect(g); g.connect(A.master); o.start(t); o.stop(t + 0.17);
    // klapnięcie na końcu ruchu
    var s = c.createBufferSource(); s.buffer = A.noiseBuf;
    var hf = c.createBiquadFilter(); hf.type = open ? 'highpass' : 'lowpass'; hf.frequency.value = open ? 2400 : 650;
    var g2 = c.createGain(), tc = t + 0.1;
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.setValueAtTime(open ? 0.11 : 0.15, tc);
    g2.gain.exponentialRampToValueAtTime(0.0001, tc + 0.05);
    s.connect(hf); hf.connect(g2); g2.connect(A.master); s.start(t, Math.random() * 1.5); s.stop(tc + 0.08);
  };

  // Uszkodzenie: głuche uderzenie i trzask włókna węglowego (force — siła, amt — przyrost uszkodzenia 0..1)
  A.crunch = function (force, amt) {
    if (!A.ctx || !A.noiseBuf) return;
    var c = A.ctx, t = c.currentTime;
    if (t - A.lastCrunch < 0.09) return;
    A.lastCrunch = t;
    var f = Math.max(0, fin(force, 0)), a = Math.min(1, Math.max(0.1, fin(amt, 0.2)));
    var vol = Math.min(0.5, 0.12 + f * 0.012 + a * 0.2);
    // niskie uderzenie
    var s = c.createBufferSource(); s.buffer = A.noiseBuf;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    var g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    s.connect(lp); lp.connect(g); g.connect(A.master); s.start(t, Math.random()); s.stop(t + 0.3);
    // trzaski: kilka krótkich impulsów wysokich tonów
    var s2 = c.createBufferSource(); s2.buffer = A.noiseBuf;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.9;
    var g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    var n = 3 + Math.round(a * 3), ti = t;
    for (var i = 0; i < n; i++) {
      g2.gain.setValueAtTime(vol * (0.9 - i * 0.1), ti);
      g2.gain.exponentialRampToValueAtTime(0.0005, ti + 0.022);
      ti += 0.026 + Math.random() * 0.03;
    }
    s2.connect(bp); bp.connect(g2); g2.connect(A.master); s2.start(t, Math.random()); s2.stop(ti + 0.05);
  };
})(PG);
