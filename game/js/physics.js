// WORLD GP — model jazdy, uszkodzenia i sztuczna inteligencja kierowców.
(function (PG) {
  'use strict';

  PG.PHYS = {
    latA0: 23, latB: 0.0042,   // przyczepność boczna: a = (A0 + B·v²)·grip
    brkA0: 10, brkB: 0.0045,   // hamowanie
    tracA0: 12, tracB: 0.002,  // trakcja
    cd: 0.00104,               // opór powietrza na kg
    power: 940,                // moc na kg (W/kg)
    carLen: 1.45, carR: 1.05,  // dwa koła kolizyjne ±carLen, promień carR
    comb: 1.2,                 // koło tarcia: √(boczne² + wzdłużne²) ≤ comb, każde z osobna ≤ 1
    lockLoss: 0.18,            // zablokowane koła hamują ok. 82% maksimum
    dirty: 0.22                // maks. utrata docisku za innym bolidem (brudne powietrze)
  };

  var GEAR_TOP = [0, 82, 118, 154, 190, 228, 266, 306, 360]; // km/h

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // Ułamek przyczepności dostępny w jednym kierunku, gdy drugi zużywa ułamek u
  function combGrip(u) {
    var c = PG.PHYS.comb, r = c * c - u * u;
    return r >= 1 ? 1 : r <= 0 ? 0 : Math.sqrt(r);
  }
  PG.combGrip = combGrip;

  // Parametry fizyczne z cech zespołu i kierowcy
  PG.carParams = function (team, driver) {
    var c = team.car, eng = PG.ENGINES[team.engine] || { power: 0 };
    var p = {
      power: PG.PHYS.power * (1 + (c.power - 88) * 0.0042 + eng.power * 0.003),
      aeroMul: 1 + (c.aero - 88) * 0.006,
      gripMul: 1 + (c.aero - 88) * 0.0018 + (c.tyre - 85) * 0.0012,
      cd: PG.PHYS.cd * (1 + (c.aero - 88) * 0.0015),
      brakeMul: 1,
      wearMul: Math.max(0.55, 1 - (c.tyre - 85) * 0.014 - ((driver && driver.tyre) ? (driver.tyre - 85) * 0.01 : 0))
    };
    return p;
  };

  function zeroDmg() { return { fwL: 0, fwR: 0, rw: 0, floor: 0, suspFL: 0, suspFR: 0, suspRL: 0, suspRR: 0, engine: 0 }; }
  PG.zeroDmg = zeroDmg;

  PG.makeCar = function (o) {
    return {
      id: o.id, driver: o.driver, team: o.team, isPlayer: !!o.isPlayer,
      x: 0, y: 0, h: 0, v: 0, steer: 0, steerIn: 0, throttle: 0, brake: 0,
      idx: 0, lat: 0, lap: 0, dist: 0, lastIdx: 0, finished: false, finishTime: 0,
      lapStart: 0, lastLap: 0, bestLap: 0, sectorTimes: [0, 0, 0], curSector: 0, sectorStart: 0, lastSectors: [0, 0, 0],
      compound: o.compound || 'M', wear: 0, drsOpen: false, drsAllowed: false, slip: 1,
      params: o.params, gear: 1, rpm: 4000, skid: 0, surface: 'asphalt', wall: 0,
      manual: false, mgear: 1, shiftT: 0, limiter: false, // ręczna skrzynia (tylko gracz)
      penalty: 0, jump: false, retired: false, launched: false, react: 0.25,
      ai: o.ai || null, profile: null, offset: 0, offsetTarget: 0, pos: 0,
      latAcc: 0, hold: false, ghost: 0, stuck: 0, launchBoost: 1,
      // dynamika: kąt znoszenia, blokada i buksowanie kół, płaskie miejsca na oponach
      beta: 0, lock: 0, lockSide: 0, wspin: 0, flat: 0,
      // uszkodzenia (0 sprawne … 1 zniszczone)
      dmg: zeroDmg(), dmgTotal: 0,
      dmgEv: { on: false, x: 0, y: 0, f: 0, prev: zeroDmg() },
      // stan wewnętrzny fizyki i sesji
      axS: 0, dirty: 0, maxCurv: 0, wallNx: 0, wallNy: 0,
      human: false, absOn: true, tcOn: true, analogIn: false,
      thrIn: 0, brkIn: 0, wantRev: false, revT: 0, padSteer: false,
      drsWas: false, lockEv: false, aiBrk: false, aiLockT: 0, aiLockA: 0, aiLockS: 0,
      profKey: 3, profDirty: false, profAt: -9
    };
  };

  PG.placeOnGrid = function (car, T, slot) {
    car.x = slot.x; car.y = slot.y; car.h = slot.h; car.v = 0; car.idx = slot.i; car.lastIdx = slot.i;
    car.lap = 0; car.dist = -(T.N - slot.i) * T.ds; // ujemny dystans przed linią startu
    car.beta = 0; car.axS = 0; car.mgear = 1; car.shiftT = 0;
  };

  function tyreGrip(car, env) {
    var t = PG.TYRES[car.compound] || PG.TYRES.M;
    var wet = !!(env && env.wet);
    var g;
    if (wet) g = car.compound === 'W' ? 0.86 : 0.66;
    else g = car.compound === 'W' ? 0.86 : t.grip;
    g *= 1 - 0.2 * Math.pow(clamp(car.wear || 0, 0, 1), 1.6);
    return g * ((env && env.weatherGrip) || 1);
  }
  PG.tyreGrip = tyreGrip;

  // Wpływ uszkodzeń na osiągi (wspólny obiekt — skopiuj, jeśli potrzebny na dłużej)
  var DP = { aF: 1, aR: 1, gD: 1, pw: 1, drag: 1, pull: 0, susp: 0 };
  function dmgPerf(car, full) {
    var d = car && car.dmg;
    DP.aF = 1; DP.aR = 1; DP.gD = 1; DP.pw = 1; DP.drag = 1; DP.pull = 0; DP.susp = 0;
    if (!full || !d) return DP;
    var fw = ((d.fwL || 0) + (d.fwR || 0)) * 0.5, fl = d.floor || 0, rw = d.rw || 0;
    var sL = (d.suspFL || 0) + (d.suspRL || 0), sR = (d.suspFR || 0) + (d.suspRR || 0);
    DP.susp = (sL + sR) * 0.25;
    DP.aF = 1 - 0.5 * fw - 0.2 * fl;         // przednie skrzydło: mniej docisku z przodu (podsterowność)
    DP.aR = 1 - 0.5 * rw - 0.2 * fl;         // tylne skrzydło: mniej docisku z tyłu (nadsterowność)
    DP.gD = 1 - 0.12 * DP.susp - 0.03 * fl;  // zawieszenie: mniej przyczepności mechanicznej
    DP.pw = 1 - 0.3 * (d.engine || 0);       // silnik: spadek mocy
    DP.drag = 1 - 0.1 * rw;                  // bez tylnego skrzydła mniejszy opór
    DP.pull = clamp(0.5 * ((d.fwR || 0) - (d.fwL || 0)) + 0.45 * (sR - sL), -1, 1); // ściąganie w stronę uszkodzenia
    return DP;
  }
  PG.dmgPerf = dmgPerf;

  // Maksymalne opóźnienie hamowania (m/s², dodatnie) na asfalcie przy prędkości v
  PG.brakeDecel = function (car, v, env) {
    var P = PG.PHYS, p = car && car.params;
    if (!p) return 30;
    var av = Math.abs(v) || 0;
    var dp = dmgPerf(car, !!(env && env.dmgFull));
    var g = p.gripMul * tyreGrip(car, env) * dp.gD;
    var dec = (P.brkA0 + P.brkB * p.aeroMul * av * av * 0.5 * (dp.aF + dp.aR)) * g * (p.brakeMul || 1) + p.cd * dp.drag * av * av;
    return (isFinite(dec) && dec > 1) ? dec : 1;
  };

  // Ręczna skrzynia: ułamek mocy silnika na wybranym biegu.
  // Pełna moc od 8000 obr./min; niżej silnik słabnie (za wysoki bieg). Ogranicznik obrotów odcina napęd
  // na końcu biegu, a krótka przerwa przy zmianie w górę też. Jedynka: sprzęgło pozwala ruszyć pełną mocą.
  function gearPower(car, av) {
    var g = car.mgear || 1, kmh = av * 3.6, top = GEAR_TOP[g];
    if (car.shiftT > 0) return 0;
    if (kmh >= top * 0.995) return 0;
    if (g === 1) return 1;
    var rpm = 12500 * kmh / top;
    return rpm >= 8000 ? 1 : clamp(0.25 + 0.75 * (rpm - 3000) / 5000, 0.25, 1);
  }

  // Zmiana biegu (ręczna skrzynia). dir: +1 w górę, −1 w dół.
  // Zwraca 'up' / 'down', 'deny' (redukcja zakręciłaby silnik ponad ogranicznik) albo null (brak biegu).
  PG.shiftGear = function (car, dir) {
    if (!car || !car.manual) return null;
    var g = car.mgear || 1, kmh = Math.abs(car.v) * 3.6;
    if (dir > 0) {
      if (g >= GEAR_TOP.length - 1) return null;
      car.mgear = g + 1; car.shiftT = 0.015;
      return 'up';
    }
    if (g <= 1) return null;
    if (kmh > GEAR_TOP[g - 1]) return 'deny';
    car.mgear = g - 1;
    return 'down';
  };
  // Bieg, który wybrałaby skrzynia automatyczna przy prędkości v (m/s)
  PG.autoGear = function (v) {
    var kmh = Math.abs(v) * 3.6, g = 1;
    while (g < 8 && kmh > GEAR_TOP[g] * 0.97) g++;
    return g;
  };

  // Krok fizyki dla jednego bolidu
  PG.stepCar = function (car, dt, T, env) {
    var P = PG.PHYS, p = car.params;
    env = env || {};
    if (!(dt > 0)) return;
    // zabezpieczenie przed wartościami nieskończonymi
    if (!(isFinite(car.x) && isFinite(car.y) && isFinite(car.h))) {
      var i0 = (car.idx >= 0 && car.idx < T.N) ? car.idx : 0;
      car.x = T.line.x[i0]; car.y = T.line.y[i0]; car.h = Math.atan2(T.ty[i0], T.tx[i0]); car.v = 0; car.idx = i0;
    }
    if (!isFinite(car.v)) car.v = 0;
    if (!isFinite(car.beta)) car.beta = 0;
    if (!isFinite(car.axS)) car.axS = 0;
    if (!(car.lock >= 0 && car.lock <= 1)) car.lock = 0;
    if (!(car.wspin >= 0 && car.wspin <= 1)) car.wspin = 0;
    if (!(car.flat >= 0)) car.flat = 0;
    if (!car.dmg) car.dmg = zeroDmg();

    var idx = PG.nearestLocal(T, car.x, car.y, car.idx);
    var dIdx = idx - car.idx;
    if (dIdx < -T.N / 2) dIdx += T.N; else if (dIdx > T.N / 2) dIdx -= T.N;
    car.idx = idx;
    car.dist += dIdx * T.ds;
    var lat = (car.x - T.x[idx]) * T.nx[idx] + (car.y - T.y[idx]) * T.ny[idx];
    car.lat = lat;
    var alat = Math.abs(lat), hw = T.hw, right = lat > 0;
    var bar = right ? T.barR[idx] : T.barL[idx];
    var surfGrip = 1, surfDrag = 0, surface = 'asphalt';
    if (alat <= hw) { surface = 'asphalt'; }
    else if (alat <= hw + 1.6 && (right ? T.kerbR[idx] : T.kerbL[idx])) { surface = 'kerb'; surfGrip = 0.94; }
    else {
      var st = right ? T.surfR[idx] : T.surfL[idx];
      if (st === 1) { surface = 'gravel'; surfGrip = 0.38; surfDrag = (5 + 0.03 * car.v * car.v) * Math.min(1, Math.abs(car.v) / 8); }
      else if (st === 2) { surface = 'runoff'; surfGrip = 0.88; surfDrag = 0.4; }
      else { surface = 'grass'; surfGrip = 0.5; surfDrag = (2 + 0.012 * car.v * car.v) * Math.min(1, Math.abs(car.v) / 8); }
    }
    car.surface = surface;
    var kerb = surface === 'kerb', offRoad = surface === 'grass' || surface === 'gravel';
    var human = !!car.human;

    // docisk: uszkodzenia i brudne powietrze
    var dp = dmgPerf(car, !!env.dmgFull);
    var dk = 1 - P.dirty * clamp(car.dirty || 0, 0, 1);
    var aF = dp.aF * dk, aR = dp.aR * dk;
    var flat = car.flat;
    var grip = p.gripMul * surfGrip * tyreGrip(car, env) * dp.gD * (1 - 0.03 * flat);
    var v0 = car.v, v = v0, av = Math.abs(v), v2 = v * v;
    var aero = P.latB * p.aeroMul * v2;
    var latN = (P.latA0 + aero * 0.5 * (dp.aF + dp.aR)) * grip; // nominalna przyczepność boczna (skala kierownicy)
    // przeniesienie obciążenia: hamowanie dociąża przód, gaz dociąża tył
    var dF = clamp(-car.axS * 0.003, -0.06, 0.1);
    var kF = 1 + dF, kR = 1 - dF;
    if (!human) { if (kF < 1) kF = 1; if (kR < 1) kR = 1; } // AI: pomoc stabilności
    var latF = (P.latA0 + aero * aF) * grip * kF;
    var latR = (P.latA0 + aero * aR) * grip * kR;
    var vs = av > 3 ? av : 3, vs2 = vs * vs;
    var maxCurv = Math.min(1 / 6.5, latN / vs2 * 1.14);
    car.maxCurv = maxCurv;
    var want = clamp(car.steer || 0, -1, 1) * maxCurv;
    if (dp.pull !== 0 && av > 3) want += dp.pull * 0.07 * maxCurv;
    // kontra w poślizgu (skręt w stronę znoszenia): koła wzdłuż ruchu nie wyrzucają toru na zewnątrz
    if (human && want * car.beta > 0) {
      var cs = Math.min(Math.abs(want), Math.abs(car.beta) * 2.5 * maxCurv);
      want -= want > 0 ? cs : -cs;
    }
    var sgnW = want > 0 ? 1 : want < 0 ? -1 : 0;
    // żądane wykorzystanie przyczepności bocznej na osiach
    var aReq = Math.abs(want) * v2;
    if (aReq > latF) aReq = latF;
    var ulF = latF > 0.01 ? aReq / latF : 0;
    var ulR = latR > 0.01 ? Math.min(1, aReq / latR) : 0;
    var ulMax = ulF > ulR ? ulF : ulR;

    // siły wzdłużne
    var cd = p.cd * dp.drag * (car.drsOpen ? 0.86 : 1) * (car.slip || 1);
    var acc = 0, uxF = 0, uxR = 0, lockT = 0, spinT = 0, reversing = false;
    var thr = clamp(car.throttle || 0, 0, 1), brk = clamp(car.brake || 0, 0, 1);
    car.absAct = 0; car.tcAct = 0; // praca ABS i kontroli trakcji (0..1) — dla adaptacyjnych spustów pada
    if (thr > 0) {
      var tracCap = (P.tracA0 + P.tracB * p.aeroMul * v2 * aR) * grip * (car.launchBoost || 1);
      var tracAv = tracCap * combGrip(ulR); // trakcja pozostała przy obecnym skręcie
      var eng = p.power * dp.pw / Math.max(av, 4);
      if (car.manual && human) eng *= gearPower(car, av);
      var drive;
      if (car.tcOn) {
        // kontrola trakcji: gaz to ułamek dostępnej trakcji
        drive = (eng < tracAv ? eng : tracAv) * thr;
        if (eng * thr > tracAv * 1.25 && av < 30) spinT = 0.12;
        if (eng * thr > tracAv) car.tcAct = clamp((eng * thr / Math.max(tracAv, 0.01) - 1) / 0.6, 0, 1);
      } else {
        var dem = eng * thr;
        spinT = tracAv > 0.01 ? clamp((dem / tracAv - 1) / 1.5, 0, 1) : (dem > 0.01 ? 1 : 0);
        drive = (dem < tracAv ? dem : tracAv) * (1 - 0.18 * car.wspin);
      }
      acc += drive;
      if (tracCap > 0.01) uxR = Math.min(1, drive / tracCap);
    }
    if (brk > 0) {
      if (v > 0.5) {
        // hamowanie bez brudnego powietrza (jak w profilu prędkości AI i PG.brakeDecel)
        var brkCap = (P.brkA0 + P.brkB * p.aeroMul * v2 * 0.5 * (dp.aF + dp.aR)) * grip * (p.brakeMul || 1);
        // przy małej prędkości docisk znika, a ciśnienie w układzie zostaje → łatwiej o blokadę
        var req = brk * (1 + 0.08 * clamp((30 - av) / 20, 0, 1) + (env.wet ? 0.04 : 0));
        var ux;
        if (car.absOn) {
          var ulB = ulF;
          if (!human) {
            // AI: jak w profilu prędkości — liczy się krzywizna linii, nie wcześniejsze wejście w zakręt
            var kl = Math.abs(T.line.k[idx]) || 0;
            var ulL = latF > 0.01 ? Math.min(1, kl * v2 / latF) : 0;
            ulB = ulMax < ulL ? ulMax : ulL;
          }
          var gB = combGrip(ulB);
          ux = Math.min(req, gB);
          if (av > 4 && req > gB) car.absAct = clamp((req - gB) / 0.25, 0, 1);
        } else {
          var lx = combGrip(ulF) * (kerb ? 0.9 : 1) * (1 - 0.08 * flat);
          if (av > 4 && req > lx) lockT = clamp((req - lx) / 0.3, 0, 1);
          // hamulec z klawiatury/dotyku (bez dozowania): blokada widoczna, ale łagodniejsza
          if (human && !car.analogIn && lockT > 0.45) lockT = 0.45;
          ux = Math.min(req, 1) * (1 - P.lockLoss * car.lock);
        }
        acc -= brkCap * ux;
        uxF = ux;
        var uxB = ux * 0.85; // balans hamulców do przodu: tył mniej obciążony hamowaniem
        if (uxB > uxR) uxR = uxB;
      } else if (car.isPlayer && car.wantRev && car.revT > 0.4 && thr === 0 && !car.hold) { acc -= 5 * brk; reversing = true; } // bieg wsteczny
      else if (v > 0) acc -= 20 * brk;
    }
    acc -= cd * v * av + (v > 0 ? 0.2 : v < 0 ? -0.2 : 0);
    // ręczna skrzynia: hamowanie silnikiem rośnie z obrotami (niski bieg = mocniej)
    if (car.manual && human && thr === 0 && v > 5) acc -= 1.6 * clamp((12500 * av * 3.6 / GEAR_TOP[car.mgear || 1] - 4000) / 8500, 0, 1);
    if (car.shiftT > 0) car.shiftT -= dt;
    acc -= surfDrag * (v > 0 ? 1 : v < 0 ? -1 : 0);

    // siły boczne: przód wyznacza tor jazdy (podsterowność), tył może się uślizgnąć (nadsterowność)
    var lockP = car.absOn ? 0 : car.lock;   // u AI i z ABS blokada nie wpływa na jazdę
    var spinP = car.tcOn ? 0 : car.wspin;
    var cFn = combGrip(uxF > 1 ? 1 : uxF) * latF / vs2;
    var cF = cFn * (1 - 0.85 * lockP);      // zablokowane przednie koła prawie nie skręcają
    var curvF = want > cF ? cF : want < -cF ? -cF : want;
    var over = cFn > 1e-6 ? Math.abs(want) / cFn - 1 : 0;
    var skid = 0;
    if (over > 0 && av > 8) { var o2 = over < 0.6 ? over : 0.6; acc -= o2 * 14 * (v > 0 ? 1 : -1); skid = Math.min(1, o2 * 4); }
    var aLat = Math.abs(curvF) * v2;
    var b0 = car.beta, bAbs = b0 < 0 ? -b0 : b0;
    var rearCap = combGrip(uxR > 1 ? 1 : uxR) * latR * (1 - 0.35 * spinP) * (1 - 0.05 * Math.min(1, bAbs / 0.2));
    var exR = aLat - rearCap, curvPath = curvF;
    if (exR > 0 && aLat > 0.01) curvPath = curvF * (0.5 + 0.5 * rearCap / aLat);
    var sgnC = curvF > 0 ? 1 : curvF < 0 ? -1 : 0;
    var betaT = 0;
    if (exR > 0 && v > 4) betaT = -sgnC * Math.min(human ? 0.42 : 0.06, (human ? 1.0 : 0.3) * exR / (latN > 1 ? latN : 1));
    if (v < 12) betaT *= (v > 0 ? v : 0) / 12;
    // kąt znoszenia dąży do celu z tłumieniem; kontra przyspiesza wyjście z poślizgu
    var bTA = betaT < 0 ? -betaT : betaT;
    var grow = bTA > bAbs;
    var rate = grow ? 5.5 : 3.0;
    if (!grow && (car.steer || 0) * b0 > 0) rate *= 1.8; // kierownica, bo kontra mogła wyzerować want
    if (av < 3) rate = 12;
    var b1 = b0 + (betaT - b0) * Math.min(1, rate * dt);
    if (av > 10) {
      if (kerb) b1 += (Math.random() - 0.5) * (human ? 0.012 : 0.003) * Math.min(1, av / 40); // krawężnik niepokoi bolid
      if (dp.susp > 0.05) b1 += (Math.random() - 0.5) * 0.006 * dp.susp;                 // drgania krzywego zawieszenia
    }
    if (v <= 0) b1 = 0;
    b1 = clamp(b1, -0.6, 0.6);
    var dB = b1 - b0;
    car.beta = b1;

    v += acc * dt;
    if (v < 0 && v0 >= 0 && !reversing) v = 0;
    if (v > 0 && v0 < 0 && thr === 0) v = 0;
    if (car.hold && v < 0) v = 0; // na polu startowym nigdy do tyłu
    if (v < -7) v = -7;
    car.v = v;
    // kurs nadwozia = kierunek ruchu − kąt znoszenia
    car.h += curvPath * v * dt - dB;
    car.latAcc = curvPath * v * v;
    if (offRoad) car.h += (Math.random() - 0.5) * 0.02 * Math.min(1, Math.abs(v) / 30);
    var psi = car.h + car.beta;
    car.x += Math.cos(psi) * v * dt;
    car.y += Math.sin(psi) * v * dt;

    // blokada (u AI tylko kosmetyczna, czasem przy mocnym hamowaniu)
    if (!human) {
      if (brk > 0.75 && av > 20) {
        if (!car.aiBrk) {
          car.aiBrk = true;
          if (Math.random() < 0.07) { car.aiLockT = 0.2 + Math.random() * 0.4; car.aiLockA = 0.38 + Math.random() * 0.25; car.aiLockS = (Math.random() - 0.5) * 1.2; }
        }
      } else if (brk < 0.2) car.aiBrk = false;
      if (car.aiLockT > 0) {
        car.aiLockT -= dt;
        if (av < 8 || brk < 0.3) car.aiLockT = 0; else lockT = car.aiLockA;
      }
    }
    car.lock = clamp(car.lock + (lockT - car.lock) * Math.min(1, (lockT > car.lock ? 14 : 8) * dt), 0, 1);
    car.wspin = clamp(car.wspin + (spinT - car.wspin) * Math.min(1, (spinT > car.wspin ? 10 : 6) * dt), 0, 1);
    if (car.lock < 0.01) car.lockSide = 0;
    else if (human) car.lockSide = clamp(sgnW * ulF * 1.3, -1, 1); // wewnętrzne koło blokuje pierwsze
    else car.lockSide = clamp(car.aiLockS || 0, -1, 1);
    if (human && car.lock > 0.2 && av > 4) car.flat = Math.min(1, flat + car.lock * dt * 0.05 * clamp(av / 40, 0.3, 1.5)); // AI: blokada tylko kosmetyczna
    var axr = (v - v0) / dt;
    if (isFinite(axr)) car.axS += (clamp(axr, -60, 30) - car.axS) * Math.min(1, dt * 10);

    // poślizg ogólny (dźwięk, ślady, dym)
    var bs = car.beta < 0 ? -car.beta : car.beta;
    if (av > 8 && bs > 0.03) skid = Math.max(skid, Math.min(1, bs * 3.5));
    skid = Math.max(skid, car.lock * 0.9, av > 1 ? car.wspin * 0.75 : 0);
    if (offRoad) skid = Math.max(skid, Math.min(1, av / 40));
    car.skid = skid;

    // bariery
    car.wall = 0;
    lat = (car.x - T.x[idx]) * T.nx[idx] + (car.y - T.y[idx]) * T.ny[idx];
    if (Math.abs(lat) > bar - 1.2) {
      var sgn = lat > 0 ? 1 : -1, pen = Math.abs(lat) - (bar - 1.2);
      car.x -= T.nx[idx] * sgn * pen; car.y -= T.ny[idx] * sgn * pen;
      var th = Math.atan2(T.ty[idx], T.tx[idx]);
      // kierunek ruchu (przy cofaniu odwrotny do nosa)
      var rel = car.h + car.beta + (car.v < 0 ? Math.PI : 0) - th;
      while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
      var into = Math.sin(rel) * sgn; // >0 gdy jedzie w barierę
      if (into > 0) {
        var impact = Math.abs(car.v) * into;
        car.v *= Math.max(0.15, 1 - into * 1.6);
        var relH = car.h - th; while (relH > Math.PI) relH -= 2 * Math.PI; while (relH < -Math.PI) relH += 2 * Math.PI;
        if (Math.abs(relH) < Math.PI / 2) car.h = th + relH * 0.3;
        else { var back = relH - (relH > 0 ? 1 : -1) * Math.PI; car.h = th + Math.PI + back * 0.3; }
        car.beta = 0;
        car.wall = impact;
        car.wallNx = T.nx[idx] * sgn; car.wallNy = T.ny[idx] * sgn; // kierunek do ściany (do oceny uszkodzeń)
      }
    }
    // biegi i obroty (dźwięk, HUD)
    var kmh = Math.abs(car.v) * 3.6, g = 1;
    if (car.manual && human) {
      // ręczna skrzynia: obroty wprost z prędkości na wybranym biegu (12 500 obr./min na końcu biegu)
      var gm = car.mgear || 1, topM = GEAR_TOP[gm], rpmM = 12500 * kmh / topM;
      if (gm === 1 && kmh < topM * 0.6) rpmM = Math.max(rpmM, 4200 + 6000 * thr); // sprzęgło przy ruszaniu
      car.gear = car.v < -0.5 ? 0 : gm;
      car.limiter = kmh >= topM * 0.995;
      car.rpm = car.limiter ? 12650 + Math.random() * 250 : Math.min(12900, Math.max(4000, rpmM) + car.wspin * 2000);
    } else {
      while (g < 8 && kmh > GEAR_TOP[g] * 0.97) g++;
      car.gear = car.v < -0.5 ? 0 : g;
      var lo = GEAR_TOP[g - 1] * 0.82, hi = GEAR_TOP[g];
      car.rpm = Math.min(12900, 4200 + 8300 * Math.max(0, Math.min(1, (kmh - lo) / (hi - lo))) + car.wspin * 2000);
      car.limiter = false;
    }
    // zużycie opon
    var usage = Math.min(1.5, Math.abs(car.latAcc || 0) / 35 + (brk > 0 ? 0.3 : 0) + car.skid * 1.5);
    var tw = PG.TYRES[car.compound] || PG.TYRES.M;
    car.wear = Math.min(1, car.wear + dt * 0.00026 * (env.wearMul || 1) * tw.wear * p.wearMul * (0.5 + usage) * (env.wet && car.compound !== 'W' ? 0.7 : 1) * (!env.wet && car.compound === 'W' ? 3 : 1));
  };

  // Kontroler AI
  PG.aiControl = function (car, T, cars, env, dt) {
    var P = PG.PHYS, L = T.line, N = T.N, v = Math.max(car.v, 0);
    var look = Math.round((9 + v * 0.32) / T.ds);
    var ai = car.ai;
    // unikanie i wyprzedzanie
    var wantOff = 0, cap = Infinity;
    for (var i = 0; i < cars.length; i++) {
      var o = cars[i]; if (o === car || o.retired) continue;
      var dd = o.dist - car.dist;
      if (dd > 0 && dd < 34) {
        var ld = Math.abs(o.lat - car.lat);
        if (ld < 4.4) {
          var myPot = car.profile.v[car.idx] * ai.pace;
          if (car.v > o.v + 0.3 || myPot > o.v + 1.5) {
            var roomR = T.hw - o.lat, roomL = o.lat + T.hw;
            var side = ai.side || (roomR > roomL ? 1 : -1);
            ai.side = side;
            wantOff = (o.lat + side * 5.0) - (L.o[car.idx] || 0);
          }
        }
        if (dd < 11 && ld < 3.4) cap = Math.min(cap, o.v * (dd < 7 ? 0.9 : 0.985));
      }
    }
    if (wantOff === 0) ai.side = 0;
    car.offsetTarget = wantOff;
    car.offset += (car.offsetTarget - car.offset) * Math.min(1, dt * 1.6);
    var ti = (car.idx + look) % N;
    var off = Math.max(-T.hw + 2.2 - L.o[ti], Math.min(T.hw - 2.2 - L.o[ti], car.offset));
    var tx = L.x[ti] + T.nx[ti] * off, ty = L.y[ti] + T.ny[ti] * off;
    var dx = tx - car.x, dy = ty - car.y, dist = Math.hypot(dx, dy);
    // celujemy kierunkiem ruchu (kurs + kąt znoszenia)
    var ang = Math.atan2(dy, dx) - (car.h + (car.beta || 0));
    while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
    var curv = 2 * Math.sin(ang) / Math.max(dist, 4);
    var maxCurv = car.maxCurv;
    if (!(maxCurv > 0)) {
      var vs = Math.max(v, 3);
      var gm0 = car.params.gripMul * PG.tyreGrip(car, env);
      maxCurv = Math.min(1 / 6.5, (P.latA0 + P.latB * car.params.aeroMul * v * v) * gm0 / (vs * vs) * 1.14);
    }
    car.steer = Math.max(-1, Math.min(1, curv / maxCurv));
    // prędkość docelowa z profilu
    var pi = (car.idx + Math.round((4 + v * 0.12) / T.ds)) % N;
    var target = car.profile.v[pi] * ai.pace;
    // korekta za zużycie opon i warunki
    target *= Math.sqrt(PG.tyreGrip(car, env) / ai.refGrip);
    // brudne powietrze za rywalem: wolniej tylko w zakrętach
    var dirty = car.dirty || 0;
    if (dirty > 0.02) {
      var gmT = car.params.gripMul * PG.tyreGrip(car, env);
      var aerT = P.latB * car.params.aeroMul * target * target, capT = (P.latA0 + aerT) * gmT;
      var use = capT > 0 ? Math.min(1, Math.abs(L.k[pi]) * target * target / capT) : 0;
      if (use > 0.3) {
        var lossF = Math.sqrt(Math.max(0.5, 1 - aerT * gmT * P.dirty * dirty / capT));
        target *= 1 - (1 - lossF) * (use - 0.3) / 0.7;
      }
    }
    if (Math.abs(car.lat) > T.hw + 0.5) target = Math.min(target, 30);
    if (cap < target) target = cap;
    if (car.rcCap < target) target = car.rcCap; // samochód bezpieczeństwa / VSC
    if (v < target - 0.3) { car.throttle = Math.min(1, (target - v) / 2.5 + 0.4); car.brake = 0; }
    else if (v > target + 0.6) { car.throttle = 0; car.brake = Math.min(1, (v - target) / 4); }
    else { car.throttle = 0.35; car.brake = 0; }
    // DRS
    car.drsOpen = !!(car.drsAllowed && PG.inDRS(T, car.idx) && car.steer < 0.3 && car.steer > -0.3 && !(car.brake > 0.05));
  };

  // Powrót na tor (AI po utknięciu lub gracz klawiszem R). Nie naprawia uszkodzeń.
  PG.resetCar = function (car, T) {
    var i = PG.wrapI(car.idx - Math.round(10 / T.ds), T.N);
    var d = i - car.idx; if (d > T.N / 2) d -= T.N; if (d < -T.N / 2) d += T.N;
    car.dist += d * T.ds; car.idx = i;
    car.x = T.line.x[i]; car.y = T.line.y[i]; car.h = Math.atan2(T.ty[i], T.tx[i]); car.v = 8; car.steer = 0; car.steerIn = 0;
    car.offset = 0; car.stuck = 0; car.ghost = 2.5;
    car.beta = 0; car.lock = 0; car.wspin = 0; car.axS = 0; car.revT = 0; car.aiLockT = 0;
    car.mgear = 1; car.shiftT = 0;
  };

  PG.inDRS = function (T, idx) {
    for (var i = 0; i < T.drs.length; i++) {
      var z = T.drs[i];
      if (z.from < z.to ? (idx >= z.from && idx <= z.to) : (idx >= z.from || idx <= z.to)) return z;
    }
    return null;
  };

  // Kolizje między bolidami (dwa okręgi na bolid). Zwraca najwyżej jeden kontakt na parę;
  // tablica i obiekty są używane ponownie przy kolejnym wywołaniu.
  var HITS = [], HPOOL = [];
  PG.collide = function (cars) {
    var Lc = PG.PHYS.carLen, R = PG.PHYS.carR, n = 0;
    HITS.length = 0;
    for (var i = 0; i < cars.length; i++) {
      var a = cars[i]; if (a.retired || a.ghost > 0 || a.inPit) continue;
      for (var j = i + 1; j < cars.length; j++) {
        var b = cars[j]; if (b.retired || b.ghost > 0 || b.inPit || (a.remote && b.remote)) continue;
        var dx0 = b.x - a.x, dy0 = b.y - a.y;
        if (dx0 * dx0 + dy0 * dy0 > 100) continue;
        // prędkości przed kontaktem (siła uderzenia do uszkodzeń)
        var pa = a.h + (a.beta || 0), pb = b.h + (b.beta || 0);
        var rvx = Math.cos(pa) * a.v - Math.cos(pb) * b.v, rvy = Math.sin(pa) * a.v - Math.sin(pb) * b.v;
        var hf = 0, hx = 0, hy = 0, hnx = 0, hny = 0, hia = 0, hib = 0;
        for (var ia = -1; ia <= 1; ia += 2) for (var ib = -1; ib <= 1; ib += 2) {
          var ax = a.x + Math.cos(a.h) * Lc * ia, ay = a.y + Math.sin(a.h) * Lc * ia;
          var bx = b.x + Math.cos(b.h) * Lc * ib, by = b.y + Math.sin(b.h) * Lc * ib;
          var dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
          if (d < 2 * R && d > 0.001) {
            var pen = (2 * R - d) / 2, nx = dx / d, ny = dy / d;
            // bolid innego gracza (stan z sieci) jest nieruchomą przeszkodą: odsuwa się tylko nasz
            var ka = b.remote ? 2 : a.remote ? 0 : 1, kb = 2 - ka;
            a.x -= nx * pen * ka; a.y -= ny * pen * ka; b.x += nx * pen * kb; b.y += ny * pen * kb;
            // wymiana prędkości wzdłużnej
            var ahead = (b.dist > a.dist) ? b : a, behind = ahead === b ? a : b;
            if (behind.v > ahead.v) {
              var dv = behind.v - ahead.v;
              if (!behind.remote) behind.v -= dv * (ahead.remote ? 0.6 : 0.45);
              if (!ahead.remote) ahead.v += dv * (behind.remote ? 0.35 : 0.25);
            }
            var side = (nx * Math.sin(a.h) - ny * Math.cos(a.h));
            if (!a.remote) a.h += side * 0.01; if (!b.remote) b.h -= side * 0.01;
            var f = Math.abs(a.v - b.v) + pen * 4;
            if (f > hf) { hf = f; hx = (ax + bx) / 2; hy = (ay + by) / 2; hnx = nx; hny = ny; hia = ia; hib = ib; }
          }
        }
        if (hf > 0) {
          var vn = rvx * hnx + rvy * hny;           // >0: bolidy zbliżały się
          var vt = Math.abs(-rvx * hny + rvy * hnx); // ślizg boczny po sobie
          var o = HPOOL[n]; if (!o) { o = {}; HPOOL[n] = o; }
          o.a = a; o.b = b; o.x = hx; o.y = hy; o.force = hf;
          o.nx = hnx; o.ny = hny; o.ia = hia; o.ib = hib;
          o.vn = (vn > 0 && isFinite(vn)) ? vn : 0; o.vt = isFinite(vt) ? vt : 0;
          HITS[n++] = o;
        }
      }
    }
    return HITS;
  };

  PG.GEAR_TOP = GEAR_TOP;
})(PG);
