// Monza Grand Prix — kontrolery: pad (Gamepad API, układ Standard z nazwami DualSense),
// wibracje (dual-rumble) oraz opcjonalnie DualSense przez WebHID (adaptacyjne spusty, pasek świetlny).
(function (PG) {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function noop() { /* nic */ }
  function soft(a, b) { return a + b - a * b; } // miękkie łączenie warstw wibracji (nigdy > 1)

  // Przyciski układu Standard Gamepad (nazwy jak na DualSense)
  var B = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15, ps: 16, touch: 17 };
  var NB = 18;
  // Akcje gry → przyciski
  var ACT = {
    drs: [B.r1, B.cross], camera: [B.triangle], look: [B.square], reset: [B.circle], pause: [B.options],
    confirm: [B.cross], back: [B.circle], dleft: [B.left], dright: [B.right]
  };

  function isDualSense(id) {
    var l = String(id || '').toLowerCase();
    return l.indexOf('dualsense') >= 0 || (l.indexOf('054c') >= 0 && (l.indexOf('0ce6') >= 0 || l.indexOf('0df2') >= 0));
  }
  // Czytelna nazwa pada
  function padName(id) {
    var s = String(id || ''), l = s.toLowerCase();
    if (l.indexOf('dualsense edge') >= 0 || (l.indexOf('054c') >= 0 && l.indexOf('0df2') >= 0)) return 'DualSense Edge (PS5)';
    if (isDualSense(s)) return 'DualSense (PS5)';
    if (l.indexOf('054c') >= 0 && (l.indexOf('05c4') >= 0 || l.indexOf('09cc') >= 0)) return 'DualShock 4 (PS4)';
    if (l.indexOf('xbox') >= 0 || l.indexOf('045e') >= 0 || l.indexOf('xinput') >= 0) return 'Pad Xbox';
    var t = s.replace(/\s*\(.*$/, '').replace(/^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/i, '').trim();
    if (!t) t = 'Kontroler';
    return t.length > 40 ? t.slice(0, 39) + '…' : t;
  }

  // =====================================================================
  // PAD
  // =====================================================================
  var Pad = PG.Pad = {
    connected: false, index: -1, id: '', name: '', isDualSense: false, standard: true,
    steer: 0, throttle: 0, brake: 0,     // osie po martwej strefie i krzywej
    deadzone: 0.08, curve: 0.5, trigDz: 0.04,
    down: new Uint8Array(NB), prev: new Uint8Array(NB),
    nav: '', navDir: '', navNext: 0,      // nawigacja w menu (krzyżak / gałka, z powtarzaniem)
    activity: false,                      // jakikolwiek ruch w tej klatce
    gp: null,                             // ostatni odczyt (Gamepad)
    onChange: null                        // function (connected, name)
  };

  function anyPressed(g) {
    var bs = g.buttons || [];
    for (var i = 0; i < bs.length && i < NB; i++) if (bs[i] && bs[i].pressed) return true;
    return false;
  }
  function shapeSteer(x) {
    var a = x < 0 ? -x : x, dz = Pad.deadzone;
    if (!(a > dz)) return 0;
    var s = (a - dz) / (0.96 - dz);
    if (s > 1) s = 1;
    s = s * (1 - Pad.curve) + s * s * Pad.curve; // precyzja przy środku, pełny skręt na końcu
    return x < 0 ? -s : s;
  }
  function trig(v) {
    var t = (num(v, 0) - Pad.trigDz) / (0.97 - Pad.trigDz);
    return t > 0 ? (t < 1 ? t : 1) : 0;
  }
  function clearPad() {
    Pad.steer = 0; Pad.throttle = 0; Pad.brake = 0; Pad.gp = null;
    Pad.down.fill(0); Pad.prev.fill(0); Pad.nav = ''; Pad.navDir = ''; Pad.activity = false;
  }
  function notify(on, name) {
    if (typeof Pad.onChange === 'function') { try { Pad.onChange(on, name); } catch (e) { /* nic */ } }
  }

  // Odczyt pada — raz na klatkę (zbocza przycisków liczone między odczytami)
  Pad.poll = function () {
    var list = null, gi = -1, i, g;
    if (navigator.getGamepads) { try { list = navigator.getGamepads(); } catch (e) { list = null; } }
    if (list) {
      // zostań przy obecnym padzie; inny pad przejmuje sterowanie, gdy ktoś na nim wciśnie przycisk
      if (Pad.index >= 0 && Pad.index < list.length && list[Pad.index] && list[Pad.index].connected) gi = Pad.index;
      for (i = 0; i < list.length; i++) {
        g = list[i];
        if (!g || !g.connected || i === gi) continue;
        if (gi < 0 || anyPressed(g)) { gi = i; if (Pad.index >= 0) break; }
      }
    }
    var gp = gi >= 0 ? list[gi] : null;
    if (!gp) {
      if (Pad.connected) { var nm = Pad.name; Pad.connected = false; Pad.index = -1; clearPad(); notify(false, nm); }
      return;
    }
    var fresh = !Pad.connected || gi !== Pad.index || gp.id !== Pad.id;
    Pad.gp = gp; Pad.index = gi; Pad.connected = true;
    if (gp.id !== Pad.id) { Pad.id = gp.id; Pad.name = padName(gp.id); Pad.isDualSense = isDualSense(gp.id); }
    Pad.standard = gp.mapping === 'standard';
    var bs = gp.buttons || [], ax = gp.axes || [];
    Pad.prev.set(Pad.down);
    var act = false;
    for (i = 0; i < NB; i++) {
      var b = bs[i], d = (b && (b.pressed || num(b.value, 0) > 0.5)) ? 1 : 0;
      Pad.down[i] = d; if (d) act = true;
    }
    if (fresh) Pad.prev.set(Pad.down); // naciśnięcie, które „obudziło" pad, nie jest akcją
    // osie: lewa gałka X skręt, R2 gaz, L2 hamulec
    var x = num(ax[0], 0), y = num(ax[1], 0);
    Pad.steer = shapeSteer(x);
    var r2 = bs[7] ? num(bs[7].value, 0) : 0, l2 = bs[6] ? num(bs[6].value, 0) : 0;
    // prawa gałka jako zapasowy gaz/hamulec (tylko układ standardowy, gdzie oś 3 to gałka)
    if (Pad.standard && ax.length > 3) {
      var ry = num(ax[3], 0);
      if (ry < -0.3) r2 = Math.max(r2, (-ry - 0.3) / 0.65); else if (ry > 0.3) l2 = Math.max(l2, (ry - 0.3) / 0.65);
    }
    Pad.throttle = trig(r2); Pad.brake = trig(l2);
    if (Pad.throttle > 0.05 || Pad.brake > 0.05 || (x > 0.3 || x < -0.3) || (y > 0.3 || y < -0.3)) act = true;
    Pad.activity = act;
    if (fresh) notify(true, Pad.name);
    // nawigacja w menu: zbocze, potem powtarzanie przy przytrzymaniu
    var dir = (Pad.down[B.up] || y < -0.6) ? 'up' : (Pad.down[B.down] || y > 0.6) ? 'down' :
      (Pad.down[B.left] || x < -0.6) ? 'left' : (Pad.down[B.right] || x > 0.6) ? 'right' : '';
    var t = now();
    Pad.nav = '';
    if (dir !== Pad.navDir) { Pad.navDir = dir; if (dir && !fresh) { Pad.nav = dir; Pad.navNext = t + 380; } }
    else if (dir && t >= Pad.navNext) { Pad.nav = dir; Pad.navNext = t + 120; }
  };

  // Akcja wciśnięta (trzymana)
  Pad.held = function (a) {
    var l = ACT[a];
    if (!l || !Pad.connected) return false;
    for (var i = 0; i < l.length; i++) if (Pad.down[l[i]]) return true;
    return false;
  };
  // Akcja wciśnięta w tej klatce (zbocze)
  Pad.hit = function (a) {
    var l = ACT[a];
    if (!l || !Pad.connected) return false;
    for (var i = 0; i < l.length; i++) if (Pad.down[l[i]] && !Pad.prev[l[i]]) return true;
    return false;
  };
  Pad.BUTTONS = B;

  // Zdarzenia przeglądarki (część przeglądarek udostępnia pady dopiero po ich nasłuchu)
  try {
    window.addEventListener('gamepadconnected', noop);
    window.addEventListener('gamepaddisconnected', noop);
  } catch (e) { /* nic */ }

  // =====================================================================
  // WIBRACJE (dual-rumble przez Gamepad API)
  // =====================================================================
  var NIMP = 6;
  var H = PG.Haptics = {
    gain: 0.8, ok: true, fails: 0,
    lastT: -1e9, idle: true, kick: false,
    phase: 0, gear: 0, gearT: -1e9,
    imp: [],
    fx: { startDelay: 0, duration: 110, weakMagnitude: 0, strongMagnitude: 0 }
  };
  for (var ii = 0; ii < NIMP; ii++) H.imp.push({ s: 0, w: 0, t0: 0, dur: 0 });

  // Aktuator bieżącego pada (albo null)
  function actuator() {
    var gp = Pad.gp;
    if (!gp || !H.ok) return null;
    var va = gp.vibrationActuator;
    if (va && typeof va.playEffect === 'function') {
      var ef = va.effects;
      if (ef && ef.length !== undefined && Array.prototype.indexOf.call(ef, 'dual-rumble') < 0) return null;
      return va;
    }
    return null;
  }
  // Zapasowo: starsze API (Firefox z flagą)
  function pulseFallback(s, w, dur) {
    var gp = Pad.gp, ha = gp && gp.hapticActuators;
    if (ha && ha[0] && typeof ha[0].pulse === 'function') {
      try { var p = ha[0].pulse(Math.max(s, w), dur); if (p && p.then) p.then(noop, noop); return true; } catch (e) { return false; }
    }
    return false;
  }

  H.supported = function () {
    if (!Pad.connected || !Pad.gp) return false;
    if (actuator()) return true;
    var ha = Pad.gp.hapticActuators;
    return !!(ha && ha[0] && typeof ha[0].pulse === 'function');
  };
  H.setGain = function (g) { H.gain = clamp(num(g, 0.8), 0, 1); };

  // Jeden efekt dual-rumble (s — silnik mocny/niski, w — słaby/wysoki), czas w ms
  H.play = function (s, w, dur) {
    s = clamp(num(s, 0), 0, 1); w = clamp(num(w, 0), 0, 1);
    var va = actuator();
    if (!va) return pulseFallback(s, w, dur);
    var fx = H.fx;
    fx.duration = Math.round(clamp(num(dur, 100), 16, 5000));
    fx.strongMagnitude = s; fx.weakMagnitude = w;
    try {
      var p = va.playEffect('dual-rumble', fx);
      if (p && p.then) p.then(noop, noop);
      H.fails = 0;
      return true;
    } catch (e) {
      if (++H.fails > 5) { H.ok = false; console.warn('Wibracje pada wyłączone:', e); }
      return false;
    }
  };

  // Impuls (zdarzenie): zanika liniowo w czasie dur (ms), opcjonalnie z opóźnieniem
  H.impulse = function (s, w, dur, delay) {
    var t = now() + (delay || 0), best = 0, bestLeft = Infinity;
    for (var i = 0; i < NIMP; i++) {
      var im = H.imp[i], left = im.dur > 0 ? im.t0 + im.dur - now() : -1;
      if (left <= 0) { best = i; bestLeft = -1; break; }
      if (left < bestLeft) { bestLeft = left; best = i; }
    }
    var o = H.imp[best];
    o.s = clamp(num(s, 0), 0, 1); o.w = clamp(num(w, 0), 0, 1); o.t0 = t; o.dur = Math.max(30, num(dur, 100));
    H.kick = true;
  };

  // Zdarzenia sesji dla bolidu gracza p
  H.event = function (e, p) {
    if (!e || !p) return;
    var f, k;
    switch (e.type) {
      case 'wall':
        if (e.car !== p) return;
        f = num(e.force, 0); if (f < 4) return;
        k = clamp((f - 3) / 16, 0.2, 1);
        H.impulse(k, 0.75 * k, 120 + 260 * k);
        break;
      case 'hit':
        if (!(e.player || e.a === p || e.b === p)) return;
        f = num(e.force, 0); if (f < 2.5) return;
        k = clamp(f / 14, 0.15, 1) * 0.9;
        H.impulse(k, 0.8 * k, 100 + 200 * k);
        break;
      case 'damage':
        if (e.car !== p) return;
        k = clamp(0.35 + 1.2 * Math.max(0, num(e.level, 0) - num(e.prev, 0)), 0.35, 1);
        H.impulse(k, 0.85 * k, 200 + 200 * k);
        if (PG.DualSenseHID) PG.DualSenseHID.flash();
        break;
      case 'detach':
        if (e.car !== p) return;
        H.impulse(1, 0.6, 380);
        if (PG.DualSenseHID) PG.DualSenseHID.flash();
        break;
      case 'lockup':
        if (e.car !== p) return;
        H.impulse(0.4, 0.55, 130);
        break;
      case 'drs': // otwarcie: podwójne lekkie stuknięcie
        if (e.car && e.car !== p) return;
        H.impulse(0.06, 0.5, 70); H.impulse(0.06, 0.45, 70, 120);
        break;
      case 'drsclose': // zamknięcie: jedno głuche stuknięcie
        if (e.car && e.car !== p) return;
        H.impulse(0.38, 0.2, 110);
        break;
      case 'light': H.impulse(0, 0.22, 60); break;
      case 'go': H.impulse(0.65, 0.7, 320); break;
      case 'jump': H.impulse(0.3, 0.35, 220); break;
    }
  };

  // Ciągłe tekstury z bieżącego stanu bolidu gracza; wołane co klatkę
  H.update = function (car, dt) {
    if (!car || !Pad.connected || !H.ok) return;
    var t = now(), v = Math.abs(num(car.v, 0)), sf = clamp(v / 25, 0, 1), s = 0, w = 0, i;
    dt = clamp(num(dt, 0.016), 0, 0.1);
    // silnik: delikatne brzęczenie zależne od obrotów i gazu
    var rpm = clamp((num(car.rpm, 4000) - 4000) / 9000, 0, 1), thr = clamp(num(car.throttle, 0), 0, 1);
    w = soft(w, 0.025 + 0.075 * rpm * (0.3 + 0.7 * thr));
    // nawierzchnia
    var surf = car.surface;
    if (surf === 'kerb') {
      H.phase = (H.phase + v * dt / 1.6) % 1; // pasy krawężnika co ok. 1,6 m
      var chop = H.phase < 0.5 ? 1 : 0.4;
      w = soft(w, (0.3 + 0.35 * sf) * chop); s = soft(s, (0.12 + 0.18 * sf) * chop);
    } else if (surf === 'gravel') {
      s = soft(s, (0.35 + 0.3 * Math.random()) * sf); w = soft(w, (0.3 + 0.25 * Math.random()) * sf);
    } else if (surf === 'grass') {
      s = soft(s, (0.2 + 0.2 * Math.random()) * sf); w = soft(w, 0.14 * sf);
    } else if (surf === 'runoff') {
      w = soft(w, 0.07 * sf);
    }
    // blokada przednich kół: drżenie wysokiej częstotliwości
    var lk = clamp(num(car.lock, 0), 0, 1);
    if (lk > 0.05 && v > 2) { w = soft(w, 0.25 + 0.65 * lk); s = soft(s, 0.3 * lk); }
    // buksowanie tylnych kół: niski pomruk
    var ws = clamp(num(car.wspin, 0), 0, 1);
    if (ws > 0.05 && v > 0.5) { s = soft(s, 0.45 * ws); w = soft(w, 0.18 * ws); }
    // płaskie miejsca na oponach: stałe bicie rosnące z prędkością
    var fl = clamp(num(car.flat, 0), 0, 1);
    if (fl > 0.03 && v > 3) { w = soft(w, fl * (0.2 + 0.25 * sf)); s = soft(s, fl * 0.12 * sf); }
    // poślizg nadwozia i pisk opon
    var bs = Math.abs(num(car.beta, 0));
    if (bs > 0.04 && v > 6) { var bb = clamp((bs - 0.04) / 0.25, 0, 1); s = soft(s, 0.4 * bb); w = soft(w, 0.15 * bb); }
    var sk = clamp(num(car.skid, 0), 0, 1);
    if (sk > 0.15 && v > 6) w = soft(w, 0.16 * sk);
    // zmiana biegu: krótkie szarpnięcie (w górę przy gazie, w dół przy hamowaniu; najwyżej co 0,4 s)
    var g = num(car.gear, 0) | 0, brk = clamp(num(car.brake, 0), 0, 1);
    if (H.gear && g !== H.gear && v > 3 && t - H.gearT > 400) {
      if (g > H.gear && thr > 0.5) { H.gearT = t; H.impulse(0.22, 0.4, 70); }
      else if (g < H.gear && brk > 0.2) { H.gearT = t; H.impulse(0.35, 0.25, 90); }
    }
    H.gear = g;
    // impulsy
    for (i = 0; i < NIMP; i++) {
      var im = H.imp[i];
      if (im.dur <= 0) continue;
      var age = t - im.t0;
      if (age < 0) continue; // opóźniony
      if (age >= im.dur) { im.dur = 0; continue; }
      var k = 1 - age / im.dur;
      s = soft(s, im.s * k); w = soft(w, im.w * k);
    }
    // wzmocnienie z ustawień (0,8 = nominalnie)
    var gn = H.gain * 1.25;
    s = clamp(s * gn, 0, 1); w = clamp(w * gn, 0, 1);
    if (s < 0.02 && w < 0.02) {
      if (!H.idle) { H.idle = true; H.reset(); }
      return;
    }
    if (!(t - H.lastT >= 50 || (H.kick && t - H.lastT >= 16))) return;
    H.kick = false; H.idle = false; H.lastT = t;
    H.play(s, w, 110);
  };

  // Natychmiastowe wyciszenie silników pada
  H.reset = function () {
    var gp = Pad.gp, va = gp && gp.vibrationActuator;
    if (va && typeof va.reset === 'function') {
      try { var p = va.reset(); if (p && p.then) p.then(noop, noop); } catch (e) { /* nic */ }
    } else if (va && typeof va.playEffect === 'function') {
      try { var p2 = va.playEffect('dual-rumble', { startDelay: 0, duration: 16, weakMagnitude: 0, strongMagnitude: 0 }); if (p2 && p2.then) p2.then(noop, noop); } catch (e2) { /* nic */ }
    }
  };

  // Wyciszenie samych wibracji (spusty zostają)
  H.silence = function () {
    for (var i = 0; i < NIMP; i++) H.imp[i].dur = 0;
    H.kick = false; H.gear = 0;
    if (!H.idle) { H.idle = true; H.reset(); }
  };
  // Stop: pauza, koniec sesji, utrata fokusu
  H.stop = function () {
    H.silence();
    if (PG.DualSenseHID) { try { PG.DualSenseHID.off(); } catch (e) { /* nic */ } }
  };

  // Test z ustawień
  H.test = function (gain) {
    if (!Pad.connected) return false;
    var g = clamp(num(gain, H.gain), 0, 1) * 1.25;
    var ok = H.play(Math.min(1, 0.7 * g), Math.min(1, 0.6 * g), 350);
    H.idle = false; H.lastT = now();
    return ok;
  };

  // =====================================================================
  // DUALSENSE PRZEZ WEBHID: adaptacyjne spusty i pasek świetlny (opcjonalnie)
  // =====================================================================
  var DS_FILTERS = [{ vendorId: 0x054c, productId: 0x0ce6 }, { vendorId: 0x054c, productId: 0x0df2 }];
  var DS = PG.DualSenseHID = {
    dev: null, bt: false, ok: true, fails: 0, seq: 0, busy: false, pend: false, setupDone: false,
    usbLen: 47, btLen: 77,
    cm: new Uint8Array(47),          // wspólna część raportu wyjściowego
    trR: new Uint8Array(11), trL: new Uint8Array(11),
    rgb: [0, 60, 255], rgbKey: '', lightDirty: true,
    flashT: -1e9, lastT: -1e9, inited: false, gear: 0, kickT: 0, testUntil: 0,
    onChange: null
  };
  DS.trR[0] = 0x05; DS.trL[0] = 0x05;

  // Czy przeglądarka pozwala (WebHID + polityka uprawnień „hid", często zablokowana w osadzonych stronach)
  DS.available = function () {
    try {
      if (!navigator.hid || typeof navigator.hid.requestDevice !== 'function') return false;
      if (window.isSecureContext === false) return false;
      var pp = document.permissionsPolicy || document.featurePolicy;
      if (pp && typeof pp.allowsFeature === 'function') return !!pp.allowsFeature('hid');
      return true;
    } catch (e) { return false; }
  };
  DS.connected = function () { return !!(DS.dev && DS.dev.opened && DS.ok); };

  function isDsDevice(d) {
    if (!d) return false;
    for (var i = 0; i < DS_FILTERS.length; i++) if (d.vendorId === DS_FILTERS[i].vendorId && d.productId === DS_FILTERS[i].productId) return true;
    return false;
  }
  // Długość raportu wyjściowego z deskryptora (bez bajtu ID); def, gdy brak
  function reportLen(dev, id, def) {
    try {
      var cs = dev.collections || [];
      for (var i = 0; i < cs.length; i++) {
        var rs = cs[i].outputReports || [];
        for (var j = 0; j < rs.length; j++) {
          if (rs[j].reportId !== id) continue;
          var bits = 0, it = rs[j].items || [];
          for (var k = 0; k < it.length; k++) bits += (it[k].reportSize || 0) * (it[k].reportCount || 0);
          var n = Math.ceil(bits / 8);
          if (n >= def && n <= 256) return n;
        }
      }
    } catch (e) { /* nic */ }
    return def;
  }
  // Czy deskryptor ma raport o danym ID (kind: 'inputReports' | 'outputReports')
  function hasReport(dev, kind, id) {
    try {
      var cs = dev.collections || [];
      for (var i = 0; i < cs.length; i++) {
        var rs = cs[i][kind] || [];
        for (var j = 0; j < rs.length; j++) if (rs[j].reportId === id) return true;
      }
    } catch (e) { /* nic */ }
    return false;
  }

  // CRC32 raportów Bluetooth (ziarno 0xA2 nagłówka HIDP + ID raportu 0x31)
  var CRCT = null;
  function crcByte(c, b) { return CRCT[(c ^ b) & 255] ^ (c >>> 8); }
  function crc32bt(data, len) {
    if (!CRCT) {
      CRCT = new Int32Array(256);
      for (var n = 0; n < 256; n++) { var c0 = n; for (var k = 0; k < 8; k++) c0 = (c0 & 1) ? (0xEDB88320 ^ (c0 >>> 1)) : (c0 >>> 1); CRCT[n] = c0; }
    }
    var c = -1;
    c = crcByte(c, 0xA2); c = crcByte(c, 0x31);
    for (var i = 0; i < len; i++) c = crcByte(c, data[i]);
    return (c ^ -1) >>> 0;
  }

  // Efekty spustów (format 11 bajtów: tryb + 10 parametrów)
  function trigOff(a) { a.fill(0); a[0] = 0x05; }
  function trigZones(a, mode, pos, level, freq) {
    var v = (level - 1) & 7, zones = 0, act = 0;
    for (var i = pos; i < 10; i++) { zones |= v << (3 * i); act |= 1 << i; }
    a.fill(0);
    a[0] = mode;
    a[1] = act & 255; a[2] = (act >> 8) & 255;
    a[3] = zones & 255; a[4] = (zones >>> 8) & 255; a[5] = (zones >>> 16) & 255; a[6] = (zones >>> 24) & 255;
    if (mode === 0x26) a[9] = freq & 255;
  }
  // Opór w strefach skoku 0–9 (tryb 0x21): F[i] = siła 0–8 w strefie i (0 = brak oporu); rosnące F daje twardniejący spust
  function trigResist(a, F) {
    var act = 0, zones = 0, any = false;
    for (var i = 0; i < 10; i++) {
      var f = clamp(Math.round(F[i]), 0, 8);
      if (f > 0) { act |= 1 << i; zones += (f - 1) * Math.pow(8, i); any = true; }
    }
    if (!any) { trigOff(a); return; }
    a.fill(0);
    a[0] = 0x21;
    a[1] = act & 255; a[2] = (act >> 8) & 255;
    a[3] = zones & 255; a[4] = (zones >>> 8) & 255; a[5] = (zones >>> 16) & 255; a[6] = (zones >>> 24) & 255;
  }
  // Wibracja od strefy pos, amplituda 1–8, częstotliwość w Hz
  function trigVibration(a, pos, amp, freq) { if (amp < 1 || freq < 1) trigOff(a); else trigZones(a, 0x26, clamp(pos, 0, 9), clamp(Math.round(amp), 1, 8), clamp(Math.round(freq), 1, 255)); }
  function same(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

  // Krzywe oporu w strefach skoku: twardniejący pedał hamulca i lekka sprężyna gazu
  var BRAKE_CURVE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  var THROTTLE_CURVE = [0, 0, 1, 1, 1.5, 2, 2, 2.5, 3, 3];
  var TL = new Uint8Array(11), TR = new Uint8Array(11), FZ = new Float32Array(10);

  function buildCommon(setup) {
    var c = DS.cm;
    c.fill(0);
    if (setup) {
      // jednorazowo: wygaszenie startowej animacji paska, by przyjmował kolory
      c[38] = 0x02; c[41] = 0x02;
      return;
    }
    c[0] = 0x04 | 0x08;          // efekty prawego (R2) i lewego (L2) spustu
    c[1] = 0x04 | 0x10;          // pasek świetlny + diody gracza
    c.set(DS.trR, 10);
    c.set(DS.trL, 21);
    c[43] = 0x04;                // środkowa dioda gracza
    var fl = now() < DS.flashT;
    c[44] = fl ? 255 : DS.rgb[0]; c[45] = fl ? 40 : DS.rgb[1]; c[46] = fl ? 0 : DS.rgb[2];
  }
  function dsFail(e) {
    if (++DS.fails >= 3 && DS.ok) { DS.ok = false; console.warn('DualSense WebHID wyłączony:', e); if (DS.onChange) { try { DS.onChange(false); } catch (e2) { /* nic */ } } }
  }

  function sendNow() {
    var d = DS.dev;
    if (!d || !d.opened || !DS.ok) return;
    if (DS.busy) { DS.pend = true; return; }
    var setup = !DS.setupDone;
    var p;
    try {
      buildCommon(setup);
      if (DS.bt) {
        var b = DS.btBuf;
        if (!b || b.length !== DS.btLen) b = DS.btBuf = new Uint8Array(DS.btLen);
        b.fill(0);
        b[0] = (DS.seq << 4) & 0xF0; DS.seq = (DS.seq + 1) & 15; // numer sekwencji
        b[1] = 0x10;                                             // znacznik wymagany przez pad
        b.set(DS.cm, 2);
        var L = DS.btLen - 4, crc = crc32bt(b, L);
        b[L] = crc & 255; b[L + 1] = (crc >>> 8) & 255; b[L + 2] = (crc >>> 16) & 255; b[L + 3] = (crc >>> 24) & 255;
        p = d.sendReport(0x31, b);
      } else {
        var u = DS.usbBuf;
        if (!u || u.length !== DS.usbLen) u = DS.usbBuf = new Uint8Array(DS.usbLen);
        u.fill(0);
        u.set(DS.cm, 0);
        p = d.sendReport(0x02, u);
      }
    } catch (e) { dsFail(e); return; }
    DS.busy = true;
    if (setup) DS.setupDone = true;
    var done = function () {
      DS.busy = false; DS.fails = 0;
      if (DS.pend || setup) { DS.pend = false; sendNow(); }
    };
    if (p && p.then) p.then(done, function (e) { DS.busy = false; dsFail(e); });
    else done();
  }

  // Otwarcie urządzenia (po wyborze użytkownika albo z wcześniej udzielonej zgody)
  DS.open = function (dev) {
    if (!dev) return Promise.resolve(false);
    var op;
    try { op = dev.opened ? Promise.resolve() : dev.open(); } catch (e) { return Promise.resolve(false); }
    return op.then(function () {
      DS.dev = dev; DS.ok = true; DS.fails = 0; DS.busy = false; DS.pend = false; DS.setupDone = false; DS.seq = 0;
      // Bluetooth: pełny raport wejściowy 0x31 (USB ma tylko 0x01)
      DS.bt = hasReport(dev, 'inputReports', 0x31) || (hasReport(dev, 'outputReports', 0x31) && !hasReport(dev, 'outputReports', 0x02));
      DS.usbLen = reportLen(dev, 0x02, 47);
      DS.btLen = reportLen(dev, 0x31, 77);
      if (DS.bt) {
        // odczyt kalibracji przełącza pad BT w pełny tryb raportów
        try { var fr = dev.receiveFeatureReport(0x05); if (fr && fr.then) fr.then(noop, noop); } catch (e) { /* nic */ }
      }
      trigOff(DS.trR); trigOff(DS.trL); DS.gear = 0;
      sendNow();
      if (DS.onChange) { try { DS.onChange(true); } catch (e2) { /* nic */ } }
      return true;
    }, function (e) { console.warn('DualSense WebHID: nie udało się otworzyć', e); return false; });
  };

  // Połączenie z gestu użytkownika (przycisk w ustawieniach). Zawsze zwraca obietnicę bool.
  DS.connect = function () {
    if (!DS.available()) return Promise.resolve(false);
    var p;
    try { p = navigator.hid.requestDevice({ filters: DS_FILTERS }); } catch (e) { return Promise.resolve(false); }
    return Promise.resolve(p).then(function (list) {
      return (list && list.length) ? DS.open(list[0]) : false;
    }, function () { return false; });
  };

  DS.disconnect = function () {
    var d = DS.dev;
    if (!d) return Promise.resolve(true);
    // najpierw zwolnij spusty, po chwili zamknij
    try { DS.off(); } catch (e) { /* nic */ }
    return new Promise(function (res) { setTimeout(res, 150); }).then(function () {
      if (DS.dev === d) { DS.dev = null; DS.busy = false; DS.pend = false; }
      var c;
      try { c = d.close(); } catch (e) { c = null; }
      if (DS.onChange) { try { DS.onChange(false); } catch (e2) { /* nic */ } }
      return Promise.resolve(c).then(function () { return true; }, function () { return true; });
    });
  };

  // Kolor paska świetlnego (np. kolor zespołu)
  DS.setLight = function (hex) {
    var s = String(hex || '').replace('#', ''), r, g, b;
    if (s.length === 3) { r = parseInt(s[0] + s[0], 16); g = parseInt(s[1] + s[1], 16); b = parseInt(s[2] + s[2], 16); }
    else { r = parseInt(s.slice(0, 2), 16); g = parseInt(s.slice(2, 4), 16); b = parseInt(s.slice(4, 6), 16); }
    if (!(isFinite(r) && isFinite(g) && isFinite(b))) return;
    // bardzo ciemne kolory słabo świecą — lekkie rozjaśnienie
    var mx = Math.max(r, g, b);
    if (mx < 90) { var k = mx > 0 ? 90 / mx : 0; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); if (!mx) { r = g = b = 60; } }
    DS.rgb[0] = r; DS.rgb[1] = g; DS.rgb[2] = b;
    if (DS.dev) sendNow();
  };
  // Krótki czerwony błysk paska (uszkodzenie)
  DS.flash = function () {
    if (!DS.dev) return;
    DS.flashT = now() + 320;
    DS.lightDirty = true;
  };

  // Spusty co klatkę (najwyżej 25 raportów/s, tylko przy zmianie). on = false zwalnia oba spusty.
  // L2 (hamulec): twardniejący pedał (mocniej przy prędkości), drgania ABS, odbicie przy blokowaniu kół.
  // R2 (gaz): lekka sprężyna, szarpnięcie przy zmianie biegu w górę, ogranicznik obrotów, buksowanie,
  // praca kontroli trakcji, żwir, trawa i krawężniki.
  DS.update = function (car, on, gain) {
    if (!DS.dev || !DS.ok) return;
    var t = now();
    if (t < DS.testUntil || t - DS.lastT < 40) return;
    gain = clamp(num(gain, 0.8), 0, 1);
    trigOff(TL); trigOff(TR);
    if (on && car && gain > 0.01) {
      var g = Math.min(1, gain * 1.25), v = Math.abs(num(car.v, 0)), i;
      var lk = clamp(num(car.lock, 0), 0, 1), abs = clamp(num(car.absAct, 0), 0, 1), ws = clamp(num(car.wspin, 0), 0, 1), tc = clamp(num(car.tcAct, 0), 0, 1);
      var thr = clamp(num(car.throttle, 0), 0, 1), rpm = num(car.rpm, 8000), surf = car.surface, sf = clamp(v / 25, 0, 1);
      // L2
      if (lk > 0.25 && v > 3) trigVibration(TL, 1, Math.max(1, (3 + 5 * lk) * g), 22 + 14 * lk);
      else if (abs > 0.12 && v > 3) trigVibration(TL, 2, Math.max(1, (2 + 3 * abs) * g), 15 + 5 * abs);
      else {
        var kb = g * (0.7 + 0.3 * clamp(v / 70, 0, 1));
        for (i = 0; i < 10; i++) FZ[i] = BRAKE_CURVE[i] * kb;
        trigResist(TL, FZ);
      }
      // R2
      var gear = num(car.gear, 0) | 0;
      if (DS.gear && gear > DS.gear && thr > 0.5 && v > 3) DS.kickT = t + 90;
      DS.gear = gear;
      if (t < DS.kickT) trigVibration(TR, 2, Math.max(1, 6 * g), 34);
      else if (rpm >= 12600 && thr > 0.8) trigVibration(TR, 6, Math.max(1, 3 * g), 140);
      else if (ws > 0.15 && v > 0.5) trigVibration(TR, 2, Math.max(1, (2 + 5 * ws) * g), 35 + 30 * clamp((rpm - 6000) / 7000, 0, 1));
      else if (tc > 0.2 && thr > 0.3) trigVibration(TR, 4, Math.max(1, (1 + 2 * tc) * g), 55);
      else if ((surf === 'gravel' || surf === 'grass') && v > 4) trigVibration(TR, 1, Math.max(1, (surf === 'gravel' ? 4 : 3) * sf * g), surf === 'gravel' ? 24 : 16);
      else if (surf === 'kerb' && v > 8) trigVibration(TR, 1, Math.max(1, 3 * sf * g), 30);
      else {
        var ka = g * (car.dmg && num(car.dmg.engine, 0) > 0.3 ? 0.5 : 1); // uszkodzony silnik: miękki gaz
        for (i = 0; i < 10; i++) FZ[i] = THROTTLE_CURVE[i] * ka;
        trigResist(TR, FZ);
      }
    } else DS.gear = 0;
    var fl = t < DS.flashT, lk2 = fl ? 'f' : 'n';
    if (same(TL, DS.trL) && same(TR, DS.trR) && lk2 === DS.rgbKey && !DS.lightDirty) return;
    DS.lastT = t;
    DS.trL.set(TL); DS.trR.set(TR);
    DS.rgbKey = lk2; DS.lightDirty = false;
    sendNow();
  };

  // Zwolnienie spustów (pauza, koniec, utrata fokusu)
  DS.off = function () {
    if (!DS.dev || !DS.ok) return;
    DS.gear = 0; DS.kickT = 0;
    trigOff(TL); trigOff(TR);
    if (same(TL, DS.trL) && same(TR, DS.trR)) return;
    DS.trL.set(TL); DS.trR.set(TR);
    DS.lastT = now();
    sendNow();
  };

  // Test z ustawień: pełne krzywe oporu na 3 s
  DS.test = function (gain) {
    if (!DS.dev || !DS.ok) return false;
    var g = Math.min(1, clamp(num(gain, 0.8), 0, 1) * 1.25), i;
    for (i = 0; i < 10; i++) FZ[i] = BRAKE_CURVE[i] * g;
    trigResist(DS.trL, FZ);
    for (i = 0; i < 10; i++) FZ[i] = THROTTLE_CURVE[i] * g * 1.6;
    trigResist(DS.trR, FZ);
    DS.testUntil = now() + 3000;
    sendNow();
    setTimeout(function () { DS.testUntil = 0; DS.off(); }, 3000);
    return true;
  };

  // Ponowne połączenie z padem, na który użytkownik już wcześniej się zgodził
  DS.init = function () {
    if (DS.inited) return;
    DS.inited = true;
    if (!DS.available()) return;
    try {
      var hid = navigator.hid;
      if (typeof hid.getDevices === 'function') {
        hid.getDevices().then(function (list) {
          for (var i = 0; list && i < list.length; i++) if (isDsDevice(list[i])) { DS.open(list[i]); break; }
        }, noop);
      }
      hid.addEventListener('connect', function (e) { if (!DS.dev && e && isDsDevice(e.device)) DS.open(e.device); });
      hid.addEventListener('disconnect', function (e) {
        if (e && e.device === DS.dev) {
          DS.dev = null; DS.busy = false;
          if (DS.onChange) { try { DS.onChange(false); } catch (e2) { /* nic */ } }
        }
      });
      // przy zamykaniu strony zwolnij spusty
      window.addEventListener('pagehide', function () { try { DS.off(); } catch (e3) { /* nic */ } });
    } catch (e) { /* WebHID niedostępny — zostają zwykłe wibracje */ }
  };
})(PG);
