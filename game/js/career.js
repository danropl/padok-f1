// Monza Grand Prix — zapis gry, zespoły własne, tryb kariery.
(function (PG) {
  'use strict';
  var KEY = 'pixelgp-save-v1';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  PG.clone = clone;
  function uid(p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9); }
  PG.uid = uid;

  var Store = PG.Store = {
    data: null,
    defaults: function () {
      return {
        version: 1,
        settings: { sound: true, vol: 0.5, brakeHint: true, laps: 5, difficulty: 'normal' },
        drivers: [], teams: [], liveryOverrides: {}, career: null
      };
    },
    load: function () {
      var d = null;
      try { var raw = localStorage.getItem(KEY); if (raw) d = JSON.parse(raw); } catch (e) { d = null; }
      var def = Store.defaults();
      if (!d || d.version !== 1) d = def;
      Object.keys(def).forEach(function (k) { if (d[k] === undefined) d[k] = def[k]; });
      Object.keys(def.settings).forEach(function (k) { if (d.settings[k] === undefined) d.settings[k] = def.settings[k]; });
      Store.data = d;
      return d;
    },
    save: function () {
      try { localStorage.setItem(KEY, JSON.stringify(Store.data)); return true; } catch (e) { return false; }
    },
    reset: function () { Store.data = Store.defaults(); Store.save(); }
  };

  // Wszystkie zespoły do wyboru (domyślne z nadpisanymi malowaniami + własne)
  PG.allTeams = function () {
    var d = Store.data, out = [];
    PG.DEFAULT_TEAMS.forEach(function (t) {
      var c = clone(t);
      if (d.liveryOverrides[t.id]) c.livery = clone(d.liveryOverrides[t.id]);
      c.drivers.forEach(function (dr, i) { dr.uid = t.id + '_' + i; });
      out.push(c);
    });
    d.teams.forEach(function (t) { out.push(PG.resolveCustomTeam(t)); });
    return out;
  };

  PG.resolveCustomTeam = function (t) {
    var c = clone(t);
    c.custom = true;
    c.drivers = (t.driverIds || []).map(function (id, i) {
      var dr = Store.data.drivers.find(function (x) { return x.id === id; });
      if (dr) { var o = clone(dr); o.uid = dr.id; return o; }
      return PG.rookie(i, t);
    });
    while (c.drivers.length < 2) c.drivers.push(PG.rookie(c.drivers.length, t));
    return c;
  };

  PG.rookie = function (i, t) {
    var seed = 0; (t.name || 'x').split('').forEach(function (ch) { seed += ch.charCodeAt(0); });
    var f = PG.FIRST_NAMES[(seed + i * 7) % PG.FIRST_NAMES.length], l = PG.LAST_NAMES[(seed * 3 + i * 5) % PG.LAST_NAMES.length];
    return { uid: (t.id || 'rk') + '_r' + i, first: f, last: l, nat: t.country || 'PL', num: 30 + ((seed + i * 11) % 60), pace: 80, start: 80, tyre: 80, wet: 80,
      helmet: { c1: t.livery.secondary, c2: t.livery.accent, pattern: ['band', 'top', 'halves'][i % 3] } };
  };

  PG.newDriver = function () {
    return { id: uid('drv'), first: 'Jan', last: 'Nowak', nat: 'PL', num: 7, pace: 80, start: 80, tyre: 80, wet: 80,
      helmet: { c1: '#ffffff', c2: '#dc143c', pattern: 'halves' } };
  };
  PG.newTeam = function () {
    return { id: uid('team'), name: 'Mój Zespół', short: 'MOJ', country: 'PL', engine: 'Honta', tier: 3,
      livery: { primary: '#f2f2f2', secondary: '#dc143c', accent: '#1a1a1a', pattern: 'split', paint: {} },
      car: { power: 82, aero: 79, tyre: 80 }, budget: 70, driverIds: [] };
  };
  PG.DRIVER_POINTS = 26; // punkty do rozdania ponad bazę 75
  PG.driverPointsUsed = function (d) { return ['pace', 'start', 'tyre', 'wet'].reduce(function (s, k) { return s + (d[k] - 75); }, 0); };

  PG.teamRating = function (t) { return (t.car.power * 1.0 + t.car.aero * 1.1 + t.car.tyre * 0.6) / 2.7; };
  PG.driverName = function (d) { return d.first + ' ' + d.last; };
  PG.driverCode = function (d) { return (d.last || 'XXX').replace(/^(de |van |von )/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-zŁłØø]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ø/g, 'o').replace(/Ø/g, 'O').slice(0, 3).toUpperCase(); };

  // ---------- KARIERA ----------
  var C = PG.Career = {};

  C.start = function (opts) {
    // opts: { driver (custom driver obj), mode: 'driver'|'owner', teamId, ownTeam (custom team obj), difficulty, laps }
    var teams = PG.allTeams().filter(function (t) { return !t.custom; });
    var me = clone(opts.driver); me.uid = 'player'; me.isPlayer = true;
    var teamId;
    if (opts.mode === 'owner') {
      var own = PG.resolveCustomTeam(opts.ownTeam);
      own.car = { power: 82, aero: 79, tyre: 80 }; own.budget = 68; own.tier = 3;
      own.drivers = [me, own.drivers.find(function (d) { return d.uid !== opts.driver.id; }) || PG.rookie(1, own)];
      own.drivers[1] = clone(own.drivers[1]); own.drivers[1].uid = own.id + '_mate';
      teams.push(own); teamId = own.id;
    } else {
      teamId = opts.teamId;
      var t = teams.find(function (x) { return x.id === teamId; });
      // gracz zastępuje słabszego kierowcę
      var wi = t.drivers[0].pace < t.drivers[1].pace ? 0 : 1;
      t.drivers[wi] = me;
    }
    var car = {
      season: 1, round: 0, difficulty: opts.difficulty || 'normal', laps: opts.laps || 5,
      mode: opts.mode, teamId: teamId, teams: teams,
      money: opts.mode === 'owner' ? 1500 : 200, rep: opts.mode === 'owner' ? 25 : 20, xp: 20,
      focus: 'aero', standings: { d: {}, t: {} }, history: [], seasons: [], offers: null, lastReport: null
    };
    Store.data.career = car; Store.save();
    return car;
  };

  C.get = function () { return Store.data.career; };
  C.team = function (car, id) { return car.teams.find(function (t) { return t.id === (id || car.teamId); }); };
  C.player = function (car) { var t = C.team(car); return t.drivers.find(function (d) { return d.isPlayer; }); };
  C.salary = function (car) { var t = C.team(car); return car.mode === 'owner' ? 120 + Math.round(car.rep * 3) : ({ 1: 420, 2: 260, 3: 150 }[t.tier] || 150); };

  C.entries = function (car) {
    var out = [];
    car.teams.forEach(function (t) { t.drivers.forEach(function (d) { out.push({ driver: d, team: t, isPlayer: !!d.isPlayer }); }); });
    return out;
  };

  // Oczekiwana pozycja wg siły bolidu (do reputacji)
  C.expectedPos = function (car) {
    var arr = car.teams.slice().sort(function (a, b) { return PG.teamRating(b) - PG.teamRating(a); });
    var idx = arr.findIndex(function (t) { return t.id === car.teamId; });
    return idx * 2 + 1.5;
  };

  C.applyResult = function (car, res, extra) {
    // res: klasyfikacja [{car:{driver,team,isPlayer}, pos, best}]
    var fastest = null;
    res.forEach(function (r) { if (r.best && (!fastest || r.best < fastest.best)) fastest = r; });
    var report = { round: car.round, name: PG.CALENDAR[car.round].name, season: car.season, rows: [], grid: extra.grid, weather: extra.weather };
    res.forEach(function (r) {
      var pts = PG.POINTS[r.pos - 1] || 0;
      if (fastest === r && r.pos <= 10) pts += 1;
      var du = r.car.driver.uid, tu = r.car.team.id;
      car.standings.d[du] = (car.standings.d[du] || 0) + pts;
      car.standings.t[tu] = (car.standings.t[tu] || 0) + pts;
      report.rows.push({ pos: r.pos, uid: du, team: tu, pts: pts, time: r.time, gap: r.gap, best: r.best, fl: fastest === r, player: !!r.car.isPlayer, name: PG.driverName(r.car.driver) });
      if (r.car.isPlayer) { report.pos = r.pos; report.pts = pts; }
    });
    var exp = C.expectedPos(car), pos = report.pos;
    var prize = Math.max(0, 21 - pos) * 12 + (pos === 1 ? 150 : pos <= 3 ? 60 : 0);
    var sal = C.salary(car);
    var dRep = Math.round(((exp - pos) * 0.9 + (pos === 1 ? 4 : pos <= 3 ? 2 : 0)) * 10) / 10;
    var dXp = 12 + Math.max(0, 12 - pos) * 2 + (report.pts > 0 ? 5 : 0);
    car.money += prize + sal; car.rep = Math.max(0, Math.min(100, car.rep + dRep)); car.xp += dXp;
    report.money = prize + sal; report.rep = dRep; report.xp = dXp; report.expected = Math.round(exp);
    // rozwój bolidów
    var devLog = [];
    car.teams.forEach(function (t) {
      ['power', 'aero', 'tyre'].forEach(function (k) {
        var g = Math.random() * (t.budget / 100) * 1.1;
        if (t.id === car.teamId && car.focus === k) g += 1.1;
        var before = t.car[k];
        t.car[k] = Math.min(99, Math.round((t.car[k] + g) * 10) / 10);
        if (t.id === car.teamId && t.car[k] - before >= 0.05) devLog.push({ k: k, d: Math.round((t.car[k] - before) * 10) / 10 });
      });
    });
    report.dev = devLog;
    car.history.push({ season: car.season, round: car.round, name: report.name, pos: pos, grid: extra.grid, pts: report.pts });
    car.round++;
    car.lastReport = report;
    if (car.round >= PG.CALENDAR.length) C.endSeason(car);
    Store.save();
    return report;
  };

  C.sortedDrivers = function (car) {
    var list = [];
    car.teams.forEach(function (t) { t.drivers.forEach(function (d) { list.push({ d: d, t: t, pts: car.standings.d[d.uid] || 0 }); }); });
    list.sort(function (a, b) { return b.pts - a.pts || (b.d.pace - a.d.pace); });
    return list;
  };
  C.sortedTeams = function (car) {
    return car.teams.map(function (t) { return { t: t, pts: car.standings.t[t.id] || 0 }; }).sort(function (a, b) { return b.pts - a.pts; });
  };

  C.endSeason = function (car) {
    var ds = C.sortedDrivers(car), ts = C.sortedTeams(car);
    var myPos = ds.findIndex(function (x) { return x.d.isPlayer; }) + 1;
    var teamPos = ts.findIndex(function (x) { return x.t.id === car.teamId; }) + 1;
    car.seasons.push({ season: car.season, champion: PG.driverName(ds[0].d), championTeam: ds[0].t.name, cTeam: ts[0].t.name, myPos: myPos, myPts: ds[myPos - 1].pts, teamPos: teamPos });
    // oferty
    var offers = [];
    if (car.mode === 'driver') {
      var req = { 1: 62, 2: 38, 3: 0 };
      var cand = car.teams.filter(function (t) { return t.id !== car.teamId && car.rep >= (req[t.tier] || 0) - (myPos <= 3 ? 10 : 0); });
      cand.sort(function () { return Math.random() - 0.5; });
      cand.sort(function (a, b) { return a.tier - b.tier; });
      offers = cand.slice(0, 3).map(function (t) { return { teamId: t.id, salary: ({ 1: 420, 2: 260, 3: 150 }[t.tier] || 150) + Math.round(car.rep * 2) }; });
    }
    car.offers = offers;
    car.seasonOver = true;
    if (car.mode === 'owner') car.money += Math.max(0, 11 - teamPos) * 80;
  };

  C.nextSeason = function (car, acceptTeamId) {
    if (acceptTeamId && acceptTeamId !== car.teamId) {
      var oldT = C.team(car), newT = C.team(car, acceptTeamId);
      var me = C.player(car);
      var wi = newT.drivers[0].pace < newT.drivers[1].pace ? 0 : 1;
      var leaving = newT.drivers[wi];
      newT.drivers[wi] = me;
      var mi = oldT.drivers.indexOf(me);
      oldT.drivers[mi] = leaving; // zamiana miejsc
      car.teamId = acceptTeamId;
    }
    car.teams.forEach(function (t) { ['power', 'aero', 'tyre'].forEach(function (k) { t.car[k] = Math.round((t.car[k] - (t.car[k] - 85) * 0.35) * 10) / 10; }); });
    car.season++; car.round = 0; car.standings = { d: {}, t: {} }; car.offers = null; car.seasonOver = false; car.lastReport = null;
    Store.save();
  };

  C.trainCost = function (v) { return Math.round(8 + Math.max(0, v - 70) * 1.6); };
  C.train = function (car, k) {
    var me = C.player(car), cost = C.trainCost(me[k]);
    if (car.xp < cost || me[k] >= 99) return false;
    car.xp -= cost; me[k] += 1; Store.save(); return true;
  };
  C.upgradeCost = function (v) { return Math.round(120 + Math.max(0, v - 75) * 18); };
  C.upgrade = function (car, k) {
    var t = C.team(car), cost = C.upgradeCost(t.car[k]);
    if (car.mode !== 'owner' || car.money < cost || t.car[k] >= 99) return false;
    car.money -= cost; t.car[k] = Math.min(99, Math.round((t.car[k] + 1) * 10) / 10); Store.save(); return true;
  };
})(PG);
