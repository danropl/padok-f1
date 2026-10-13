// WORLD GP — dyrekcja wyścigu: awarie i rozbite bolidy AI, wirtualny samochód bezpieczeństwa (VSC),
// samochód bezpieczeństwa (SC) z kolejką za nim i restartem na linii mety, wyłączony DRS.
// Stan w S.rc; ograniczenia prędkości bolidów w c.rcCap (m/s, Infinity = brak).
// Na hoście (i w grze jednoosobowej) działa RC.update; RC.caps liczy limity dla bolidów prowadzonych lokalnie.
(function (PG) {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  var wrapI = function (i, n) { return ((i % n) + n) % n; };
  // częstość awarii AI na bolid i sekundę jazdy
  var FAIL = { off: 0, rare: 1 / 45000, often: 1 / 15000 };
  var VSC_K = 0.58, SC_K = 0.6, SC_MAX = 50, CATCH_K = 0.82;

  var RC = PG.RC = {};
  RC.LEVELS = [['off', 'Wyłączone'], ['rare', 'Rzadko'], ['often', 'Często']];

  RC.init = function (S, level) {
    S.rc = { level: FAIL[level] !== undefined ? level : 'rare', mode: 'green', t: 0, clearAt: 0, deployLap: 0, sc: null, drsLap: 0, drsOk: true, msg: '', last: -1e9, count: 0 };
  };

  function leaderOf(S) {
    for (var i = 0; i < S.order.length; i++) { var c = S.order[i]; if (!c.retired && !c.inPit && !c.finished) return c; }
    return S.order[0];
  }
  function refProfile(S) {
    if (S.rcProf) return S.rcProf;
    for (var i = 0; i < S.cars.length; i++) if (S.cars[i].profile) return (S.rcProf = S.cars[i].profile);
    return null;
  }
  function vRef(S, idx) { var p = refProfile(S); return p ? p.v[idx] : 60; }
  function emit(S, mode, text, sub) { S.rc.msg = text; S.events.push({ type: 'rc', mode: mode, text: text, sub: sub || '' }); }

  // ---------- incydenty ----------
  // Bolid AI zjeżdża na bok i staje (awaria albo zniszczony bolid). heavy — rozbity na torze
  RC.retire = function (S, c, why) {
    if (c.retired || c.retiring || c.isPlayer && !S.autoPlayer) return;
    var T = S.T, side = (c.lat || 0) >= 0 ? 1 : -1;
    c.retiring = true; c.retireWhy = why; c.retLat = side * (T.hw + 3.2); c.pitReq = false; c.retireT = 0;
    S.events.push({ type: 'retire', car: c, why: why });
    if (!S.rc || S.rc.level === 'off' || S.mode !== 'race' || S.state !== 'run') return;
    // na torze lub tuż przy nim — samochód bezpieczeństwa; daleko na poboczu — VSC
    var onTrack = Math.abs(c.lat || 0) < T.hw + 1.5 || why === 'crash';
    RC.deploy(S, onTrack && Math.random() < 0.75 ? 'sc' : 'vsc', why === 'crash' ? 'Rozbity bolid ' + PG.driverCode(c.driver) : 'Awaria · ' + PG.driverCode(c.driver) + ' stoi na poboczu');
  };

  // Odłamki na torze (urwane skrzydło) — czasem VSC
  RC.debris = function (S) {
    if (!S.rc || S.rc.level === 'off' || S.mode !== 'race' || S.state !== 'run' || S.rc.mode !== 'green') return;
    if (Math.random() < 0.4) RC.deploy(S, 'vsc', 'Odłamki na torze');
  };

  RC.deploy = function (S, kind, reason) {
    var rc = S.rc, L = leaderOf(S);
    if (!rc || !L || S.time < 8) return;
    if (L.lap >= S.laps - 1) kind = 'vsc'; // na ostatnim okrążeniu bez SC
    if (rc.mode === 'sc' || rc.mode === 'scIn') return;
    if (rc.mode === 'vsc' && kind === 'vsc') { rc.clearAt = Math.max(rc.clearAt, S.time + 25); return; }
    rc.count++; rc.t = 0; rc.deployLap = L.lap;
    if (kind === 'sc') {
      var T = S.T, s = wrapI(L.idx + Math.round(170 / T.ds), T.N);
      rc.mode = 'sc'; rc.clearAt = S.time + 55 + Math.random() * 30;
      rc.sc = { s: s, x: T.line.x[s], y: T.line.y[s], h: Math.atan2(T.ty[s], T.tx[s]), v: Math.max(30, L.v * 0.8), idx: s, lights: true, inPit: false };
      emit(S, 'sc', 'SAMOCHÓD BEZPIECZEŃSTWA', reason);
    } else {
      rc.mode = 'vsc'; rc.clearAt = S.time + 28 + Math.random() * 18;
      emit(S, 'vsc', 'WIRTUALNY SAMOCHÓD BEZPIECZEŃSTWA', reason);
    }
    // tani postój dla AI
    if (PG.Pit) S.cars.forEach(function (c) { if (c.ai && (!c.isPlayer || S.autoPlayer)) PG.Pit.aiPlan(c, S, true); });
  };

  // ---------- krok dyrekcji (host / gra jednoosobowa) ----------
  RC.update = function (S, dt) {
    var rc = S.rc;
    if (!rc || S.mode !== 'race') return;
    rc.t += dt;
    var T = S.T, N = T.N, L = leaderOf(S), i, c;
    // awarie AI
    var rate = FAIL[rc.level] || 0;
    if (rate > 0 && S.state === 'run' && S.time > 30 && L && L.lap < S.laps - 2) {
      for (i = 0; i < S.cars.length; i++) {
        c = S.cars[i];
        if (c.isPlayer || c.remote || c.retired || c.retiring || c.inPit || c.finished) continue;
        if (Math.random() < rate * dt) RC.retire(S, c, 'fail');
      }
    }
    if (rc.mode === 'vsc' && S.time > rc.clearAt) { rc.mode = 'vscEnd'; rc.t = 0; emit(S, 'vscEnd', 'VSC KOŃCZY SIĘ', 'Przygotuj się do zielonej flagi'); }
    else if (rc.mode === 'vscEnd' && rc.t > 7) { RC.green(S); }
    if (rc.mode === 'sc' || rc.mode === 'scIn') {
      var sc = rc.sc;
      if (sc && !sc.inPit) {
        var prev = sc.s;
        sc.v += clamp(Math.min(SC_MAX, SC_K * vRef(S, wrapI(Math.floor(sc.s) + 10, N))) - sc.v, -8 * dt, 6 * dt);
        sc.s = sc.s + sc.v * dt / T.ds;
        if (sc.s >= N) sc.s -= N;
        var i0 = Math.floor(sc.s), f = sc.s - i0, a = wrapI(i0, N), b = wrapI(i0 + 1, N);
        sc.x = T.line.x[a] + (T.line.x[b] - T.line.x[a]) * f; sc.y = T.line.y[a] + (T.line.y[b] - T.line.y[a]) * f;
        var ah = wrapI(i0 + 2, N); sc.h = Math.atan2(T.line.y[ah] - sc.y, T.line.x[ah] - sc.x); sc.idx = a;
        // zjazd SC do alei w okrążeniu „SC in"
        if (rc.mode === 'scIn' && T.pit) {
          var pa = wrapI(Math.floor(prev) - T.pit.entry, N), pb = wrapI(a - T.pit.entry, N);
          if (pa > N / 2 && pb < N / 8) { sc.inPit = true; sc.lights = false; }
        }
      }
      if (rc.mode === 'sc' && S.time > rc.clearAt && L && L.lap >= rc.deployLap + 1) {
        rc.mode = 'scIn'; rc.t = 0; if (sc) sc.lights = false;
        emit(S, 'scIn', 'SC ZJEŻDŻA W TYM OKRĄŻENIU', 'Restart na linii mety');
      }
      // restart: lider przecina linię po zjeździe SC
      if (rc.mode === 'scIn' && sc && sc.inPit && L) {
        if (rc.lapAtIn === undefined) rc.lapAtIn = L.lap;
        else if (L.lap > rc.lapAtIn) RC.green(S, true);
      }
    }
    rc.drsOk = rc.mode === 'green' && (!L || L.lap >= rc.drsLap);
  };

  RC.green = function (S, restart) {
    var rc = S.rc, L = leaderOf(S);
    rc.mode = 'green'; rc.t = 0; rc.sc = null; rc.lapAtIn = undefined;
    rc.drsLap = (L ? L.lap : 0) + 2;
    emit(S, 'green', restart ? 'RESTART · ZIELONA FLAGA' : 'ZIELONA FLAGA', restart ? 'Wyprzedzanie dozwolone' : '');
  };

  // ---------- ograniczenia prędkości (dla bolidów prowadzonych lokalnie) ----------
  // Pod SC: kolejka (najbliższy obiekt przed bolidem na torze), pod VSC: część prędkości z profilu.
  RC.caps = function (S) {
    var rc = S.rc, cars = S.cars, i, j, c;
    for (i = 0; i < cars.length; i++) cars[i].rcCap = Infinity;
    if (!rc || S.mode !== 'race' || (S.state !== 'run' && S.state !== 'finish') || rc.mode === 'green') return;
    var T = S.T, N = T.N, ds = T.ds, look = Math.round(5 / ds);
    for (i = 0; i < cars.length; i++) {
      c = cars[i];
      if (c.remote || c.retired || c.retiring || c.inPit || c.finished) continue;
      var vr = (c.profile ? c.profile.v[wrapI(c.idx + look, N)] : vRef(S, wrapI(c.idx + look, N)));
      if (rc.mode === 'vsc' || rc.mode === 'vscEnd') { c.rcCap = Math.max(16, VSC_K * vr); continue; }
      // SC: kto jest przede mną na torze (w metrach po osi)
      var best = 1e9, bv = 0, isSc = false;
      if (rc.sc && !rc.sc.inPit) { var dS = wrapI(Math.floor(rc.sc.s) - c.idx, N) * ds; if (dS > 0 && dS < N * ds / 2) { best = dS; bv = rc.sc.v; isSc = true; } }
      for (j = 0; j < cars.length; j++) {
        var o = cars[j];
        if (o === c || o.retired || o.retiring || o.inPit) continue;
        var d = wrapI(o.idx - c.idx, N) * ds;
        if (d > 0 && d < best) { best = d; bv = o.v; isSc = false; }
      }
      var gap0 = isSc ? 30 : 16, cap = CATCH_K * vr;
      if (best < 400) cap = Math.min(cap, Math.max(0, bv + clamp((best - gap0) * 0.55, -14, 22)));
      if (rc.mode === 'scIn' && rc.sc && rc.sc.inPit && best > 200) cap = Math.min(cap, SC_K * vr); // lider dyktuje tempo do linii
      c.rcCap = Math.max(4, cap);
    }
  };

  // Ogranicznik dla gracza: odcięcie gazu powyżej limitu, łagodne dohamowanie przy dużym przekroczeniu
  RC.limitInput = function (c) {
    if (!(c.rcCap < Infinity)) return;
    if (c.v > c.rcCap) { c.throttle = 0; if (c.v > c.rcCap + 4) c.brake = Math.max(c.brake, clamp((c.v - c.rcCap - 4) / 12, 0, 0.5)); }
    else if (c.v > c.rcCap - 1.5) c.throttle = Math.min(c.throttle, 0.25);
  };

  // Zjazd na pobocze i zatrzymanie (bolid wycofany z wyścigu)
  RC.retireControl = function (c, T, dt) {
    var N = T.N, v = Math.max(0, c.v), look = Math.round((8 + v * 0.3) / T.ds), ti = (c.idx + look) % N;
    var tx = T.x[ti] + T.nx[ti] * c.retLat, ty = T.y[ti] + T.ny[ti] * c.retLat;
    var ang = Math.atan2(ty - c.y, tx - c.x) - (c.h + (c.beta || 0));
    while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
    var mc = c.maxCurv > 0 ? c.maxCurv : 0.05;
    c.steer = clamp(2 * Math.sin(ang) / Math.max(Math.hypot(tx - c.x, ty - c.y), 4) / mc, -1, 1);
    c.throttle = 0; c.brake = v > 12 ? 0.3 : 0.55; c.drsOpen = false;
    c.retireT = (c.retireT || 0) + dt;
    if (v < 0.4 && Math.abs(c.lat || 0) > T.hw || c.retireT > 20) { c.retired = true; c.retiring = false; c.v = 0; }
    else if (v < 0.4) { c.throttle = 0.25; c.brake = 0; } // jeszcze na torze: dotoczyć się na bok
  };
})(PG);
