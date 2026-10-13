// Monza Grand Prix — pit stopy: przejazd aleją serwisową (prowadzony automatycznie, ogranicznik 80 km/h przy
// garażach), postój z wymianą opon i naprawą skrzydeł, strategia AI, zasada dwóch mieszanek na suchym torze.
// Dane alei: T.pit = { entry, from, limFrom, limTo, to, exit, lane, box, limit, garage0 } (track.js).
(function (PG) {
  'use strict';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  var wrapI = function (i, n) { return ((i % n) + n) % n; };
  var COMP_ORDER = ['S', 'M', 'H'];

  var Pit = PG.Pit = {};

  // Stanowisko w alei przed garażem zespołu (drugi kierowca zespołu — drugie stanowisko)
  function boxOf(c, S) {
    var T = S.T, P = T.pit, teams = PG.garageTeams || [], k = -1, i;
    for (i = 0; i < teams.length; i++) if (teams[i] && c.team && teams[i].id === c.team.id) { k = i; break; }
    if (k < 0) k = Math.max(0, Math.min(9, teams.length - 1)); // własny zespół: ostatni garaż
    var slot = 0;
    for (i = 0; i < S.cars.length; i++) { var o = S.cars[i]; if (o.team && c.team && o.team.id === c.team.id) { if (o !== c) slot = 1; break; } }
    return wrapI(P.garage0 + Math.round((10 + k * 30 + (slot ? 18 : 8)) / T.ds), T.N);
  }

  // Zasada dwóch mieszanek: na suchym torze od 10 okrążeń trzeba użyć dwóch różnych slicków
  Pit.ruleActive = function (S) { return S.mode === 'race' && !S.env.wet && S.laps >= 10; };
  Pit.ruleOk = function (c) {
    var u = c.compounds || {}, n = 0;
    COMP_ORDER.forEach(function (k) { if (u[k]) n++; });
    return n >= 2;
  };

  // Domyślna mieszanka przy zjeździe: inna niż obecna, gdy zasada nie jest jeszcze spełniona
  Pit.suggest = function (c, S) {
    if (S.env.wet) return 'W';
    var R = Math.max(0, S.laps - c.lap - 1), rate = Pit.wearRate(c, S), pick = 'H';
    for (var i = 0; i < COMP_ORDER.length; i++) {
      var k = COMP_ORDER[i];
      if (rate.per(k) * R <= 0.82) { pick = k; break; }
    }
    if (Pit.ruleActive(S) && !Pit.ruleOk(c) && pick === c.compound) pick = c.compound === 'H' ? 'M' : c.compound === 'M' ? 'H' : 'M';
    return pick;
  };

  // Szacowane zużycie na okrążenie dla mieszanki k (z pomiaru ostatniego okrążenia albo z modelu)
  Pit.wearRate = function (c, S) {
    var cur = PG.TYRES[c.compound] || PG.TYRES.M;
    var measured = c.wearLap > 0.0005 ? c.wearLap : 0.024 * cur.wear * (c.params ? c.params.wearMul : 1) * (S.env.wearMul || 1);
    return { per: function (k) { var t = PG.TYRES[k] || PG.TYRES.M; return measured / cur.wear * t.wear; } };
  };

  // Prośba o zjazd (gracz: klawisz P / L1). comp — wybrana mieszanka albo null (domyślna)
  Pit.request = function (c, S, on, comp) {
    if (!S.T.pit || S.mode !== 'race') return false;
    c.pitReq = !!on;
    if (on) c.pitComp = comp || c.pitComp || Pit.suggest(c, S);
    return true;
  };

  // Wjazd: bolid przekroczył początek zjazdu z prośbą o pit stop
  Pit.check = function (c, S, prevIdx) {
    var T = S.T, P = T.pit;
    if (!P || !c.pitReq || c.pit || c.finished || c.retired || S.mode !== 'race' || S.state === 'lights') return;
    var N = T.N, a = wrapI(prevIdx - P.entry, N), b = wrapI(c.idx - P.entry, N);
    if (!(a > N / 2 && b < N / 8)) return;
    var dmg = c.dmg || {};
    c.pit = {
      ph: 'in', s: b, lat0: c.lat || 0, box: boxOf(c, S), t: 0, comp: c.pitComp || Pit.suggest(c, S),
      fixFW: Math.max(dmg.fwL || 0, dmg.fwR || 0) > 0.2, fixRW: (dmg.rw || 0) > 0.35, stopT: 0
    };
    c.pitReq = false; c.inPit = true; c.drsOpen = false; c.drsAllowed = false;
    S.events.push({ type: 'pitin', car: c });
  };

  // Położenie na alei: indeks (ułamkowy) i odsunięcie od osi toru
  function at(T, fi, lat, out) {
    var N = T.N, i0 = Math.floor(fi), f = fi - i0, a = wrapI(i0, N), b = wrapI(i0 + 1, N);
    var x = T.x[a] + (T.x[b] - T.x[a]) * f, y = T.y[a] + (T.y[b] - T.y[a]) * f;
    var nx = T.nx[a] + (T.nx[b] - T.nx[a]) * f, ny = T.ny[a] + (T.ny[b] - T.ny[a]) * f;
    out[0] = x + nx * lat; out[1] = y + ny * lat;
    return out;
  }
  var _p = [0, 0], _q = [0, 0];

  // Odsunięcie od osi w punkcie s (próbki od wjazdu) dla danej fazy
  function latAt(c, S, s) {
    var T = S.T, P = T.pit, N = T.N, pt = c.pit, ds = T.ds;
    var sFrom = wrapI(P.from - P.entry, N), sBox = wrapI(pt.box - P.entry, N), sTo = wrapI(P.to - P.entry, N), sExit = wrapI(P.exit - P.entry, N);
    var appr = 26 / ds, join = Math.min(T.hw - 2.4, Math.max(0, (T.line && T.line.o) ? T.line.o[P.exit] : 0));
    if (s < sFrom) return pt.lat0 + (P.lane - pt.lat0) * sstep(s / sFrom);
    if (pt.ph === 'in' && s > sBox - appr) return P.lane + (P.box - P.lane) * sstep((s - (sBox - appr)) / appr);
    if (pt.ph !== 'in' && s < sBox + appr) return P.box + (P.lane - P.box) * sstep((s - sBox) / appr);
    if (s <= sTo) return P.lane;
    return P.lane + (join - P.lane) * sstep((s - sTo) / (sExit - sTo));
  }

  // Krok bolidu w alei (zamiast fizyki); dt w sekundach
  Pit.step = function (c, dt, S) {
    var T = S.T, P = T.pit, N = T.N, pt = c.pit, ds = T.ds;
    if (!pt || !P) { c.pit = null; c.inPit = false; return; }
    var sBox = wrapI(pt.box - P.entry, N), sLimA = wrapI(P.limFrom - P.entry, N), sLimB = wrapI(P.limTo - P.entry, N), sExit = wrapI(P.exit - P.entry, N);
    var d = pt.s * ds, lim = P.limit, vt;
    if (pt.ph === 'stop') {
      pt.t -= dt; c.v = 0; c.throttle = 0; c.brake = 1;
      if (pt.t <= 0) { service(c, S); pt.ph = 'out'; }
    } else {
      if (pt.ph === 'in') {
        // dohamowanie do ogranicznika przed strefą garaży, potem do zatrzymania na stanowisku
        var toLim = (sLimA * ds) - d, toBox = (sBox * ds) - d;
        vt = toLim > 0 ? Math.min(58, Math.sqrt(lim * lim + 2 * 13 * toLim)) : lim;
        vt = Math.min(vt, Math.sqrt(Math.max(0, 2 * 7 * (toBox - 0.2))));
        if (toBox < 0.35 && c.v < 1.2) { pt.ph = 'stop'; pt.t = stopTime(pt); pt.stopT = pt.t; c.v = 0; S.events.push({ type: 'pitstop', car: c, t: pt.t, comp: pt.comp }); }
      } else vt = pt.s < sLimB ? lim : 76;
      if (pt.ph !== 'stop') {
        var v = c.v;
        if (v < vt) { c.v = Math.min(vt, v + Math.max(3, 9 - v * 0.05) * dt); c.throttle = 0.8; c.brake = 0; }
        else { c.v = Math.max(vt, v - 16 * dt); c.throttle = 0; c.brake = v - vt > 0.5 ? 0.7 : 0; }
      }
    }
    // ruch wzdłuż alei
    var s0 = pt.s, s1 = pt.s + c.v * dt / ds;
    if (pt.ph === 'in' && s1 > sBox) s1 = sBox;
    pt.s = s1;
    var lat = latAt(c, S, s1), fi = P.entry + s1;
    at(T, fi, lat, _p);
    at(T, fi + 0.5, latAt(c, S, s1 + 0.5), _q);
    var px = c.x, py = c.y;
    c.x = _p[0]; c.y = _p[1];
    var hx = _q[0] - _p[0], hy = _q[1] - _p[1];
    if (hx * hx + hy * hy > 1e-6) c.h = Math.atan2(hy, hx);
    var ni = wrapI(Math.floor(fi), N), dI = ni - c.idx;
    if (dI < -N / 2) dI += N; else if (dI > N / 2) dI -= N;
    c.idx = ni; c.dist += (s1 - s0) * ds; c.lat = lat;
    c.steer = 0; c.beta = 0; c.skid = 0; c.lock = 0; c.wspin = 0; c.surface = 'asphalt'; c.wall = 0; c.drsOpen = false;
    c.slip = 1; c.dirty = 0; c.latAcc = 0;
    var kmh = c.v * 3.6, g = 1, GT = PG.GEAR_TOP;
    while (g < 8 && kmh > GT[g] * 0.97) g++;
    c.gear = g;
    c.rpm = Math.min(12900, 4200 + 8300 * clamp((kmh - GT[g - 1] * 0.82) / (GT[g] - GT[g - 1] * 0.82), 0, 1));
    if (!(isFinite(c.x) && isFinite(c.y))) { c.x = px; c.y = py; }
    // koniec alei: z powrotem na torze
    if (pt.ph === 'out' && s1 >= sExit) {
      c.pit = null; c.inPit = false; c.offset = 0; c.offsetTarget = 0; c.steerIn = 0;
      c.pitCount = (c.pitCount || 0) + 1;
      S.events.push({ type: 'pitout', car: c });
    }
  };

  function stopTime(pt) {
    var t = 2.2 + Math.random() * 0.7;
    if (Math.random() < 0.06) t += 2 + Math.random() * 3; // wolny postój (problem z kołem)
    if (pt.fixFW) t += 6.5;
    if (pt.fixRW) t += 11;
    return t;
  }

  // Obsługa na stanowisku: opony, skrzydła
  function service(c, S) {
    var pt = c.pit;
    c.compound = pt.comp; c.wear = 0; c.flat = 0; c.wearAtLap = 0; c.wearLap = 0;
    c.compounds = c.compounds || {}; c.compounds[pt.comp] = true;
    if (pt.fixFW) { c.dmg.fwL = 0; c.dmg.fwR = 0; }
    if (pt.fixRW) c.dmg.rw = 0;
    if ((pt.fixFW || pt.fixRW) && PG.dmgTotal) { c.dmgTotal = PG.dmgTotal(c.dmg); c.profDirty = true; }
    S.events.push({ type: 'pitdone', car: c, t: pt.stopT, comp: pt.comp, fixed: pt.fixFW || pt.fixRW });
  }

  // Strategia AI (po każdym okrążeniu, po uszkodzeniu, przy wyjeździe samochodu bezpieczeństwa)
  Pit.aiPlan = function (c, S, cheap) {
    if (S.mode !== 'race' || !S.T.pit || c.pit || c.pitReq || c.finished || c.retired) return;
    var R = S.laps - c.lap - 1; // pełne okrążenia po tym
    if (R < 1) return;
    var d = c.dmg || {}, k = c.aiPit || (c.aiPit = { thr: 0.66 + Math.random() * 0.1 });
    var why = '';
    if (Math.max(d.fwL || 0, d.fwR || 0) > 0.38 || (d.rw || 0) > 0.5) why = 'dmg';
    var rate = Pit.wearRate(c, S).per(c.compound), endWear = c.wear + rate * (R + 1);
    var thr = k.thr + (c.compound === 'H' ? 0.06 : c.compound === 'S' ? -0.04 : 0);
    if (!why && c.wear >= thr && endWear > 0.9) why = 'wear';
    if (!why && Pit.ruleActive(S) && !Pit.ruleOk(c) && R <= Math.max(2, Math.round(S.laps * 0.35))) why = 'rule';
    // tani postój pod samochodem bezpieczeństwa
    if (!why && cheap && R > 4 && (c.wear > 0.32 || (Pit.ruleActive(S) && !Pit.ruleOk(c)))) why = 'sc';
    if (why) Pit.request(c, S, true, Pit.suggest(c, S));
  };

  // Pomiar zużycia na okrążenie (wołane przy przejeździe przez linię)
  Pit.onLap = function (c) {
    if (c.wearAtLap !== undefined && c.wear >= c.wearAtLap) c.wearLap = c.wear - c.wearAtLap;
    c.wearAtLap = c.wear;
  };

  // Kara na mecie za niespełnioną zasadę dwóch mieszanek
  Pit.finishCheck = function (c, S) {
    if (Pit.ruleActive(S) && !Pit.ruleOk(c) && !c.ruleFined) { c.ruleFined = true; c.penalty += 30; S.events.push({ type: 'rulepen', car: c }); }
  };
})(PG);
