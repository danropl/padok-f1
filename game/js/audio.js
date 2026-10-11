// Monza Grand Prix — dźwięk silnika i efekty (Web Audio, bez plików).
(function (PG) {
  'use strict';
  var A = PG.Audio = { ctx: null, on: true, vol: 0.5, lastCrunch: -9, lastDrs: -9 };

  function fin(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }

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
  };

  A.setOn = function (on) { A.on = on; if (A.master) A.master.gain.value = on ? A.vol : 0; };
  A.setVol = function (v) { A.vol = v; if (A.master && A.on) A.master.gain.value = v; };

  A.engine = function (car, active, others) {
    if (!A.ctx) return;
    var t = A.ctx.currentTime;
    if (!active || !car) {
      A.eng.gain.setTargetAtTime(0, t, 0.08); A.skidG.gain.setTargetAtTime(0, t, 0.05); A.crowdG.gain.setTargetAtTime(0, t, 0.2);
      if (A.sqG) { A.sqG.gain.setTargetAtTime(0, t, 0.05); A.sqOG.gain.setTargetAtTime(0, t, 0.05); }
      return;
    }
    var rpm = fin(car.rpm, 4000), thr = fin(car.throttle, 0), av = Math.abs(fin(car.v, 0));
    var fr = rpm / 60 * 1.6;
    A.o1.frequency.setTargetAtTime(fr, t, 0.02);
    A.o2.frequency.setTargetAtTime(fr * 2.005, t, 0.02);
    A.filt.frequency.setTargetAtTime(500 + thr * 1800 + rpm * 0.08, t, 0.05);
    A.eng.gain.setTargetAtTime(0.05 + thr * 0.11, t, 0.05);
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
