// Monza Grand Prix — sesja wyścigowa: start, okrążenia, sektory, DRS, uszkodzenia, klasyfikacja.
(function (PG) {
  'use strict';

  var DIFF = { easy: 0.865, normal: 0.925, hard: 0.972 };
  PG.DIFF_NAMES = { easy: 'Łatwy', normal: 'Normalny', hard: 'Trudny' };
  var MK = 50; // znaczniki czasu co 50 m (do różnic czasowych)
  var DEF_ASSISTS = { abs: false, tc: true, autoDrs: true };
  var PARTS = ['fwL', 'fwR', 'rw', 'floor', 'suspFL', 'suspFR', 'suspRL', 'suspRR', 'engine'];
  PG.DMG_PARTS = PARTS;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function num(x) { return typeof x === 'number' && isFinite(x); }

  // entries: [{driver, team, isPlayer, compound}]
  // o.damage: 'off' | 'visual' | 'full'; o.assists: {abs, tc, autoDrs} (tylko dla gracza)
  PG.createSession = function (o) {
    var T = o.track;
    var env = { wet: o.weather === 'rain', weatherGrip: PG.WEATHER[o.weather || 'sun'].grip, weather: o.weather || 'sun' };
    var S = {
      T: T, env: env, mode: o.mode || 'race', laps: o.laps || 5, difficulty: o.difficulty || 'normal',
      time: 0, clock: 0, state: 'lights', lightsOn: 0, lightsT: 0, lightsOutAt: 0,
      cars: [], player: null, events: [], fastest: { time: 0, car: null }, leaderDone: false,
      finishOrder: [], marks: Math.ceil(T.length / MK), done: false, doneT: 0, autoPlayer: !!o.autoPlayer
    };
    S.damage = (o.damage === 'off' || o.damage === 'visual') ? o.damage : 'full';
    var as = o.assists || DEF_ASSISTS;
    S.assists = { abs: !!as.abs, tc: as.tc !== false, autoDrs: as.autoDrs !== false };
    env.dmgFull = S.damage === 'full';
    var skillBase = DIFF[S.difficulty] || DIFF.normal;
    o.entries.forEach(function (e, k) {
      var params = PG.carParams(e.team, e.driver);
      var car = PG.makeCar({ id: k, driver: e.driver, team: e.team, isPlayer: e.isPlayer, params: params, compound: e.compound || (env.wet ? 'W' : 'M') });
      car.timeAt = new Float32Array(S.marks * ((S.laps || 1) + 3)).fill(-1);
      var skill = Math.min(0.995, skillBase + ((e.driver.pace || 85) - 86) * 0.0032 + (env.wet ? ((e.driver.wet || 80) - 85) * 0.002 : 0));
      setupAI(car, T, env, e.isPlayer ? Math.max(skill, 0.95) : skill);
      car.react = 0.16 + (100 - (e.driver.start || 80)) * 0.006 + Math.random() * 0.12;
      S.cars.push(car);
      if (e.isPlayer) S.player = car;
    });
    if (S.mode === 'race') {
      S.cars.forEach(function (c, k) { PG.placeOnGrid(c, T, T.grid[k]); });
    } else if (S.mode === 'quali') {
      var c0 = S.cars[0];
      var i0 = PG.wrapI(-Math.round(1150 / T.ds), T.N);
      c0.idx = i0; c0.x = T.line.x[i0]; c0.y = T.line.y[i0]; c0.h = Math.atan2(T.ty[i0], T.tx[i0]); c0.v = 70;
      c0.dist = -(T.N - i0) * T.ds; S.state = 'run'; S.lightsOutAt = 0;
    } else { // attract — bolidy rozstawione po torze w ruchu
      S.cars.forEach(function (c, k) {
        var i = PG.wrapI(T.N - k * 22 - 10, T.N);
        c.idx = i; c.x = T.line.x[i]; c.y = T.line.y[i]; c.h = Math.atan2(T.ty[i], T.tx[i]);
        c.v = c.profile ? c.profile.v[i] * 0.9 : 40; c.dist = -(T.N - i) * T.ds;
      });
      S.state = 'run';
    }
    order(S);
    return S;
  };

  function setupAI(car, T, env, skill) {
    var ref = PG.tyreGrip(car, env);
    var p = car.params;
    car.ai = { pace: 1, refGrip: ref, side: 0, attack: false, skill: skill };
    car.profile = PG.speedProfile(T, { power: p.power, cd: p.cd, gripMul: p.gripMul * ref * skill, aeroMul: p.aeroMul, brakeMul: 0.97 });
  }
  PG.setupAI = setupAI;

  // Profil prędkości uszkodzonego bolidu (wolniejszy, by AI nie wypadało z toru)
  function rebuildProfile(c, T) {
    if (!c.ai || !c.params || !PG.dmgPerf) return;
    var d = PG.dmgPerf(c, true), p = c.params;
    var aero = Math.min(d.aF, d.aR), gD = d.gD, pw = d.pw, drag = d.drag;
    c.profKey = aero + gD + pw;
    c.profile = PG.speedProfile(T, { power: p.power * pw, cd: p.cd * drag, gripMul: p.gripMul * c.ai.refGrip * c.ai.skill * gD, aeroMul: p.aeroMul * aero, brakeMul: 0.97 });
  }

  // Czas okrążenia AI w kwalifikacjach (symulacja)
  PG.simQualiTime = function (T, team, driver, env, difficulty) {
    var p = PG.carParams(team, driver);
    var skill = Math.min(0.995, (DIFF[difficulty || 'normal'] || DIFF.normal) + ((driver.pace || 85) - 86) * 0.0032 + (env.wet ? ((driver.wet || 80) - 85) * 0.002 : 0));
    var car = { compound: env.wet ? 'W' : 'S', wear: 0 };
    var ref = PG.tyreGrip(car, env);
    var prof = PG.speedProfile(T, { power: p.power, cd: p.cd, gripMul: p.gripMul * ref * skill, aeroMul: p.aeroMul, brakeMul: 0.97 });
    return prof.lapTime * 1.005 + Math.random() * 0.35;
  };

  PG.updateSession = function (S, dt, input) {
    var T = S.T, cars = S.cars;
    input = input || {};
    S.events.length = 0;
    if (!(dt > 0)) return; // brak upływu czasu (np. pauza)
    if (dt > 0.1) dt = 0.1;
    S.clock += dt;
    var dmode = (S.damage === 'off' || S.damage === 'visual') ? S.damage : 'full';
    var dmgOn = dmode !== 'off', full = dmode === 'full';
    S.env.dmgFull = full;
    var A = S.assists || DEF_ASSISTS;
    if (S.state === 'lights') {
      S.lightsT += dt;
      var on = Math.min(5, Math.floor(S.lightsT / 0.9));
      if (on !== S.lightsOn) { S.lightsOn = on; S.events.push({ type: 'light', n: on }); }
      if (on === 5 && !S.outDelay) S.outDelay = 0.5 + Math.random() * 1.2;
      if (on === 5 && S.lightsT > 4.5 + S.outDelay) {
        S.state = 'run'; S.lightsOn = 0; S.time = 0; S.events.push({ type: 'go' });
      }
    }
    var running = S.state === 'run' || S.state === 'finish';
    if (running) S.time += dt;
    var sub = 4, h = dt / sub;
    for (var st = 0; st < sub; st++) {
      for (var i = 0; i < cars.length; i++) {
        var c = cars[i];
        var aiDrive = !!c.ai && (!c.isPlayer || c.finished || S.autoPlayer);
        // pomoce: AI zawsze z ABS/TC, gracz wg ustawień
        c.human = !aiDrive && !!c.isPlayer;
        c.absOn = !c.human || !!A.abs;
        c.tcOn = !c.human || A.tc !== false;
        if (aiDrive) {
          PG.aiControl(c, T, cars, S.env, h);
          if (c.finished) { c.throttle *= 0.4; if (c.v > 40) c.brake = 0.2; }
          c.wantRev = false;
        } else if (c.isPlayer) {
          applyInput(c, input, h, S, A);
        }
        if (!running) {
          // na polach startowych
          var human = c.isPlayer && !S.autoPlayer;
          if (human && c.throttle > 0.1 && S.state === 'lights' && !c.jump) { c.jump = true; c.penalty += 5; S.events.push({ type: 'jump' }); }
          if (!human || !c.jump) { c.throttle = 0; c.brake = 1; }
          c.hold = !human || !c.jump; // hamulec postojowy na polu startowym (bez cofania)
        } else if (S.time < c.react && (!c.isPlayer || S.autoPlayer) && S.mode === 'race') { c.throttle = 0; c.brake = 1; c.hold = true; }
        else c.hold = false;
        // wsteczny dopiero po chwili trzymania hamulca w miejscu (nigdy na polu startowym)
        if (running && c.wantRev && !c.hold && c.v < 0.6) c.revT += h; else c.revT = 0;
        if (S.mode === 'race' && S.time < 3) c.launchBoost = 0.9 + ((c.driver.start || 80) - 75) * 0.006;
        else c.launchBoost = 1;
        PG.stepCar(c, h, T, S.env);
        if (running && !c.isPlayer && S.time > 6) {
          if (c.v < 3) { c.stuck = (c.stuck || 0) + h; if (c.stuck > 3) PG.resetCar(c, T); } else c.stuck = 0;
        }
        if (c.ghost > 0) c.ghost -= h;
        if (c.wall > 4) S.events.push({ type: 'wall', car: c, force: c.wall });
        if (dmgOn && c.wall > 4.5) wallDamage(c);
        // blokada kół (dźwięk, wibracje)
        if (c.lock > 0.35) { if (!c.lockEv) { c.lockEv = true; S.events.push({ type: 'lockup', car: c, player: !!c.isPlayer }); } }
        else if (c.lock < 0.15) c.lockEv = false;
        // DRS: otwarcie / zamknięcie (zdarzenia tylko dla bolidu gracza)
        if (!!c.drsOpen !== !!c.drsWas) {
          c.drsWas = !!c.drsOpen;
          if (c.isPlayer) S.events.push({ type: c.drsWas ? 'drs' : 'drsclose', car: c });
        }
      }
      var hits = PG.collide(cars);
      for (var hh = 0; hh < hits.length; hh++) {
        var ht = hits[hh];
        if (ht.force > 2) S.events.push({ type: 'hit', x: ht.x, y: ht.y, force: ht.force, player: !!(ht.a.isPlayer || ht.b.isPlayer), a: ht.a, b: ht.b });
        if (dmgOn) hitDamage(ht);
      }
    }
    if (running) timing(S);
    slipstream(S);
    order(S);
    if (dmgOn) flushDamage(S, full);
  };

  function rampTo(cur, tgt, up, down, dt) {
    var d = tgt - cur, r = (d > 0 ? up : down) * dt;
    return d > r ? cur + r : d < -r ? cur - r : tgt;
  }

  function applyInput(c, inp, dt, S, A) {
    var av = Math.abs(c.v), hs = clamp((av - 20) / 55, 0, 1);
    // kierownica: klawiatura z narastaniem zależnym od prędkości, gałka pada bez zmian
    var digi = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    var ax = num(inp.steerAxis) ? clamp(inp.steerAxis, -1, 1) : 0;
    if (digi !== 0) c.padSteer = false;
    else if (Math.abs(ax) > 0.08 || (inp.analog && ax !== 0)) c.padSteer = true;
    if (c.padSteer && digi === 0 && num(inp.steerAxis)) c.steerIn = ax;
    else {
      var target = digi * (1 - 0.14 * hs); // przy dużej prędkości pełny skręt tuż przy granicy przyczepności
      var back = Math.abs(target) < Math.abs(c.steerIn) || target * c.steerIn < 0;
      var rate = back ? 7 - 1.5 * hs : 4.2 - 1.8 * hs;
      c.steerIn = rampTo(c.steerIn || 0, target, rate, rate, dt);
    }
    c.steer = c.steerIn;
    // gaz i hamulec: klawisze narastają płynnie, osie pada wprost
    var tA = num(inp.throttleAxis) ? clamp(inp.throttleAxis, 0, 1) : 0;
    var bA = num(inp.brakeAxis) ? clamp(inp.brakeAxis, 0, 1) : 0;
    if (inp.up) c.thrIn = rampTo(c.thrIn || 0, 1, 5, 12, dt);
    else if (tA > 0.02) c.thrIn = tA;
    else c.thrIn = rampTo(c.thrIn || 0, 0, 5, 12, dt);
    if (inp.down) c.brkIn = rampTo(c.brkIn || 0, 1, 8, 16, dt);
    else if (bA > 0.02) c.brkIn = bA;
    else c.brkIn = rampTo(c.brkIn || 0, 0, 8, 16, dt);
    // hamulec analogowy (spust pada); klawisz hamulca jest cyfrowy także przy podłączonym padzie
    c.analogIn = !!inp.analog && !inp.down;
    c.throttle = c.thrIn;
    c.brake = c.brkIn;
    if (c.brake > 0.1 && c.v > 0.5) c.throttle = 0;
    // chęć cofania: wciśnięty hamulec bez gazu
    c.wantRev = !!((inp.down || bA > 0.3) && !inp.up && tA <= 0.02);
    // DRS: otwarty zostaje do hamowania lub końca strefy; automat otwiera sam
    var canDrs = !!(c.drsAllowed && PG.inDRS(S.T, c.idx) && c.brkIn < 0.05);
    if (!canDrs) c.drsOpen = false;
    else if (A.autoDrs || inp.drs) c.drsOpen = true;
  }

  // ---------- USZKODZENIA ----------
  function addDmg(c, part, amt, x, y, f) {
    if (!(amt > 0.001)) return;
    var d = c.dmg, ev = c.dmgEv;
    if (!d || !ev) return;
    if (!ev.on) {
      ev.on = true; ev.f = -1;
      for (var k = 0; k < PARTS.length; k++) ev.prev[PARTS[k]] = d[PARTS[k]];
    }
    if (f > ev.f) { ev.f = f; ev.x = x; ev.y = y; }
    var nv = d[part] + amt;
    d[part] = nv > 1 ? 1 : nv;
  }

  // Uderzenie w barierę: strona z kierunku do ściany w układzie bolidu
  function wallDamage(c) {
    var vi = c.wall;
    if (!(vi > 4.5)) return; // lekkie otarcie bez skutków
    var ch = Math.cos(c.h), sh = Math.sin(c.h);
    var fwd = c.wallNx * ch + c.wallNy * sh;      // >0: ściana przed nosem
    var sd = -c.wallNx * sh + c.wallNy * ch;      // >0: ściana po prawej (+Z)
    var s = (vi - 4.5) / 17;
    var px = c.x + c.wallNx * 1.1, py = c.y + c.wallNy * 1.1, sp;
    if (fwd > 0.55) { // czołowo: obie połówki przedniego skrzydła
      addDmg(c, 'fwL', s * (0.85 - 0.45 * sd), px, py, vi);
      addDmg(c, 'fwR', s * (0.85 + 0.45 * sd), px, py, vi);
      if (vi > 12) addDmg(c, 'floor', (vi - 12) / 40, px, py, vi);
      if (vi > 15) { sp = (vi - 15) / 22; addDmg(c, 'suspFL', sp * (1 - 0.5 * sd), px, py, vi); addDmg(c, 'suspFR', sp * (1 + 0.5 * sd), px, py, vi); }
    } else if (fwd < -0.55) { // tyłem: tylne skrzydło, przy mocnym uderzeniu silnik
      addDmg(c, 'rw', s * 0.75, px, py, vi);
      if (vi > 10) addDmg(c, 'engine', (vi - 10) / 30, px, py, vi);
      if (vi > 12) addDmg(c, 'floor', (vi - 12) / 45, px, py, vi);
      if (vi > 15) { sp = (vi - 15) / 22; addDmg(c, 'suspRL', sp * (1 - 0.5 * sd), px, py, vi); addDmg(c, 'suspRR', sp * (1 + 0.5 * sd), px, py, vi); }
    } else { // bokiem: krzywe zawieszenie
      var R = sd > 0;
      addDmg(c, R ? 'suspFR' : 'suspFL', s * (fwd >= 0 ? 0.6 : 0.4), px, py, vi);
      addDmg(c, R ? 'suspRR' : 'suspRL', s * (fwd >= 0 ? 0.4 : 0.6), px, py, vi);
      addDmg(c, R ? 'fwR' : 'fwL', s * (fwd > 0.2 ? 0.45 : 0.2), px, py, vi);
      if (vi > 14) addDmg(c, 'floor', (vi - 14) / 50, px, py, vi);
    }
  }

  // Kontakt dwóch bolidów: miejsce z kierunku do rywala w układzie każdego z nich
  function hitDamage(ht) {
    var sev = ht.vn + 0.25 * ht.vt;
    if (!(sev > 3)) return; // lekkie dotknięcie bez skutków
    var s = (sev - 3) / 12;
    if (!ht.a.isPlayer && !ht.b.isPlayer) s *= 0.6; // AI między sobą ostrożniejsze
    partHit(ht.a, ht.nx, ht.ny, ht.ia, s, sev, ht.x, ht.y);
    partHit(ht.b, -ht.nx, -ht.ny, ht.ib, s, sev, ht.x, ht.y);
  }

  function partHit(c, nx, ny, circ, s, f, x, y) {
    var ch = Math.cos(c.h), sh = Math.sin(c.h);
    var nf = nx * ch + ny * sh, ns = -nx * sh + ny * ch;
    if (nf > 0.7) { // przodem
      if (ns > 0.3) { addDmg(c, 'fwR', s * 0.9, x, y, f); addDmg(c, 'fwL', s * 0.25, x, y, f); }
      else if (ns < -0.3) { addDmg(c, 'fwL', s * 0.9, x, y, f); addDmg(c, 'fwR', s * 0.25, x, y, f); }
      else { addDmg(c, 'fwL', s * 0.65, x, y, f); addDmg(c, 'fwR', s * 0.65, x, y, f); }
      if (f > 14) { addDmg(c, 'suspFL', s * 0.15, x, y, f); addDmg(c, 'suspFR', s * 0.15, x, y, f); }
    } else if (nf < -0.7) { // w tył
      addDmg(c, 'rw', s * 0.4, x, y, f);
      addDmg(c, 'floor', s * 0.12, x, y, f);
      if (f > 10) addDmg(c, 'engine', s * 0.25, x, y, f);
    } else { // bokiem
      var R = ns > 0, front = circ > 0;
      addDmg(c, front ? (R ? 'suspFR' : 'suspFL') : (R ? 'suspRR' : 'suspRL'), s * 0.45, x, y, f);
      if (front) addDmg(c, R ? 'fwR' : 'fwL', s * 0.3, x, y, f);
      addDmg(c, 'floor', s * 0.05, x, y, f);
    }
  }

  function dmgTotal(d) {
    var t = 0.12 * d.fwL + 0.12 * d.fwR + 0.18 * d.rw + 0.14 * d.floor + 0.08 * (d.suspFL + d.suspFR + d.suspRL + d.suspRR) + 0.12 * d.engine;
    return t > 1 ? 1 : t < 0 ? 0 : (isFinite(t) ? t : 0);
  }

  function detachEv(c, part) {
    var ch = Math.cos(c.h), sh = Math.sin(c.h), px, py;
    if (part === 'rw') { px = c.x - ch * 2.45; py = c.y - sh * 2.45; }
    else { var sd = part === 'fwR' ? 1 : -1; px = c.x + ch * 2.7 - sh * 0.55 * sd; py = c.y + sh * 2.7 + ch * 0.55 * sd; }
    var ps = c.h + (c.beta || 0);
    return { type: 'detach', car: c, part: part, x: px, y: py, vx: Math.cos(ps) * c.v, vy: Math.sin(ps) * c.v };
  }

  // Zdarzenia uszkodzeń (scalone w obrębie kroku) i przebudowa profili
  function flushDamage(S, full) {
    var cars = S.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i], ev = c.dmgEv;
      if (ev && ev.on) {
        ev.on = false;
        var d = c.dmg;
        for (var k = 0; k < PARTS.length; k++) {
          var part = PARTS[k], lv = d[part], pv = ev.prev[part];
          if (lv - pv >= 0.05) S.events.push({ type: 'damage', car: c, part: part, level: lv, prev: pv, x: ev.x, y: ev.y, force: ev.f });
          if (pv < 1 && lv >= 1 && (part === 'fwL' || part === 'fwR' || part === 'rw')) S.events.push(detachEv(c, part));
        }
        c.dmgTotal = dmgTotal(d);
        if (full && PG.dmgPerf) {
          var dp = PG.dmgPerf(c, true);
          var key = Math.min(dp.aF, dp.aR) + dp.gD + dp.pw;
          if (Math.abs(key - c.profKey) > 0.02) c.profDirty = true;
        }
      }
      // wolniejszy profil dla uszkodzonego bolidu (najwyżej co 0,5 s)
      if (full && c.profDirty && S.clock - c.profAt > 0.5) {
        c.profDirty = false; c.profAt = S.clock;
        try { rebuildProfile(c, S.T); } catch (e) { /* zostaje stary profil */ }
      }
    }
  }

  function timing(S) {
    var T = S.T, Lt = T.length, sb = [S.T.sectors[0] * T.ds, S.T.sectors[1] * T.ds];
    for (var i = 0; i < S.cars.length; i++) {
      var c = S.cars[i];
      // znaczniki czasu
      if (c.dist >= 0) {
        var m = Math.floor(c.dist / MK);
        if (m < c.timeAt.length && c.timeAt[m] < 0) c.timeAt[m] = S.time;
      }
      var lapsDone = c.dist >= 0 ? Math.floor(c.dist / Lt) : -1;
      var inLap = c.dist >= 0 ? c.dist - lapsDone * Lt : 0;
      var sec = inLap < sb[0] ? 0 : inLap < sb[1] ? 1 : 2;
      if (c.dist >= 0 && c.started === undefined) { c.started = true; c.lapStart = S.time; c.sectorStart = S.time; c.curSector = 0; c.lap = 0; }
      if (c.started && sec !== c.curSector && sec === c.curSector + 1) {
        c.sectorTimes[c.curSector] = S.time - c.sectorStart; c.sectorStart = S.time;
        S.events.push({ type: 'sector', car: c, n: c.curSector, t: c.sectorTimes[c.curSector] });
        c.curSector = sec;
      }
      if (c.started && lapsDone > c.lap) {
        c.sectorTimes[2] = S.time - c.sectorStart; c.sectorStart = S.time; c.curSector = 0;
        S.events.push({ type: 'sector', car: c, n: 2, t: c.sectorTimes[2] });
        var lt = S.time - c.lapStart;
        // pierwsze okrążenie w wyścigu liczone od startu z pola
        c.lastLap = lt; c.lapStart = S.time;
        c.lastSectors = c.sectorTimes.slice();
        var isBest = !c.bestLap || lt < c.bestLap;
        if (isBest) { c.bestLap = lt; c.bestSectors = c.sectorTimes.slice(); }
        if (S.mode === 'race' && c.lap >= 1 && (!S.fastest.time || lt < S.fastest.time)) { S.fastest = { time: lt, car: c }; S.events.push({ type: 'fastest', car: c, t: lt }); }
        c.lap = lapsDone;
        S.events.push({ type: 'lap', car: c, t: lt, best: isBest });
        if (S.mode === 'quali' && c.isPlayer) { c.finished = true; c.finishTime = lt; S.done = true; S.events.push({ type: 'qualidone', t: lt }); }
        if (S.mode === 'race' && !c.finished && (c.lap >= S.laps || S.leaderDone)) {
          c.finished = true; c.finishTime = S.time; c.finishLaps = c.lap;
          if (!S.leaderDone) { S.leaderDone = true; S.state = 'finish'; }
          S.finishOrder.push(c);
          S.events.push({ type: 'finish', car: c, pos: S.finishOrder.length });
        }
      }
      // DRS: od drugiego okrążenia, poniżej 1 s straty w punkcie detekcji
      if (S.mode === 'race' && !S.env.wet && c.lap >= 1) {
        for (var z = 0; z < T.drs.length; z++) {
          var zone = T.drs[z];
          var dI = c.idx - zone.detect; if (dI < 0) dI += T.N;
          if (dI >= 0 && dI < 3 && c.lastDetect !== z + '_' + c.lap) {
            c.lastDetect = z + '_' + c.lap;
            var ahead = carAhead(S, c);
            var gap = ahead ? gapBetween(S, ahead, c) : 99;
            c.drsAllowed = gap < 1.0;
            if (c.drsAllowed && c.isPlayer) S.events.push({ type: 'drsready' });
          }
        }
        if (!PG.inDRS(T, c.idx)) {
          // poza strefą: uprawnienie trwa tylko do końca najbliższej strefy
          var nearZone = false;
          for (var z2 = 0; z2 < T.drs.length; z2++) { var zz = T.drs[z2]; var d2 = zz.from - c.idx; if (d2 < 0) d2 += T.N; if (d2 < 120) nearZone = true; }
          if (!nearZone) c.drsAllowed = false;
        }
      } else c.drsAllowed = false;
    }
  }

  function carAhead(S, c) {
    var best = null, bd = Infinity;
    for (var i = 0; i < S.cars.length; i++) { var o = S.cars[i]; if (o === c) continue; var d = o.dist - c.dist; if (d > 0 && d < bd) { bd = d; best = o; } }
    return best;
  }

  // Strata czasu "behind" do "ahead" (s)
  function gapBetween(S, ahead, behind) {
    if (behind.dist < 0) return (ahead.dist - behind.dist) / Math.max(behind.v, 20);
    var m = Math.floor(behind.dist / MK);
    if (m < ahead.timeAt.length && ahead.timeAt[m] >= 0) return Math.max(0, S.time - ahead.timeAt[m]);
    return (ahead.dist - behind.dist) / Math.max(behind.v, 20);
  }
  PG.gapBetween = gapBetween;

  // Tunel aerodynamiczny (mniejszy opór na prostej) i brudne powietrze (mniej docisku w zakrętach)
  function slipstream(S) {
    var cars = S.cars;
    for (var i = 0; i < cars.length; i++) {
      var c = cars[i], dirty = 0; c.slip = 1;
      for (var j = 0; j < cars.length; j++) {
        if (i === j) continue;
        var o = cars[j], d = o.dist - c.dist, dl = Math.abs(o.lat - c.lat);
        if (d > 4 && d < 36 && dl < 3.2) c.slip = Math.min(c.slip, 1 - 0.3 * (1 - d / 36));
        if (d > 3 && d < 35 && dl < 3.5) { var w = (1 - (d - 3) / 32) * (1 - dl / 3.5); if (w > dirty) dirty = w; }
      }
      c.dirty = dirty;
    }
  }

  function order(S) {
    var arr = S.cars.slice();
    arr.sort(function (a, b) {
      if (a.finished && b.finished && S.mode === 'race') return S.finishOrder.indexOf(a) - S.finishOrder.indexOf(b);
      if (a.finished !== b.finished && S.mode === 'race') return a.finished ? -1 : 1;
      return b.dist - a.dist;
    });
    for (var i = 0; i < arr.length; i++) arr[i].pos = i + 1;
    S.order = arr;
  }

  // Klasyfikacja końcowa (dokończa wyścig szacunkowo dla tych, którzy nie dojechali)
  PG.classify = function (S) {
    var Lt = S.T.length, res = [];
    var leader = S.finishOrder[0];
    S.cars.forEach(function (c) {
      var total;
      if (c.finished) total = c.finishTime;
      else {
        var targetLaps = S.laps;
        var remaining = targetLaps * Lt - c.dist;
        var pace = c.bestLap || (S.time / Math.max(0.3, c.dist / Lt));
        total = S.time + Math.max(0, remaining) / Lt * pace * 1.01;
      }
      res.push({ car: c, time: total + c.penalty, laps: S.laps, best: c.bestLap, penalty: c.penalty });
    });
    res.sort(function (a, b) { return a.time - b.time; });
    res.forEach(function (r, i) { r.pos = i + 1; r.gap = i === 0 ? 0 : r.time - res[0].time; });
    return res;
  };

  PG.fmtTime = function (t) {
    if (!t || t <= 0) return '--:--.---';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  };
  PG.fmtGap = function (g) { return '+' + g.toFixed(3); };
  PG.MK = MK;
})(PG);
