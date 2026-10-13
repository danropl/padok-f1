// Monza Grand Prix — dane otoczenia toru dla widoku 3D (trybuny, boksy, padok, drzewa), linia jazdy i minimapa.
(function (PG) {
  'use strict';

  function hash(x, y) { var h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  PG.hash = hash;
  function smoothNoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function wrapI(i, n) { return ((i % n) + n) % n; }
  function c01(x) { return x > 0 ? (x < 1 ? x : 1) : 0; }
  function numOr(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function sst(a, b, x) { var t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  // ---------- linia wyścigowa: wspólna reguła kolorów dla widoku 2D i 3D ----------
  // u = pilność hamowania w danym punkcie przy obecnej prędkości gracza:
  // ≤0,2 zielony (gaz / utrzymaj), 0,45 żółty, 0,68 pomarańczowy (odpuść, szykuj hamowanie), ≥0,86 czerwony (hamuj)
  var LINE_STOPS = [[0.2, 0.18, 0.82, 0.42], [0.45, 1.0, 0.84, 0.2], [0.68, 1.0, 0.52, 0.1], [0.86, 0.95, 0.15, 0.15]];
  PG.LINE_STOPS = LINE_STOPS;
  // Kolor sRGB (0..1) dla pilności u; out = [r, g, b]
  PG.lineRGB = function (u, out) {
    var S = LINE_STOPS, k, a, b, t;
    out = out || [0, 0, 0];
    if (!(u > S[0][0])) { a = S[0]; out[0] = a[1]; out[1] = a[2]; out[2] = a[3]; return out; }
    for (k = 1; k < S.length; k++) {
      if (u < S[k][0]) {
        a = S[k - 1]; b = S[k]; t = (u - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t);
        out[0] = a[1] + (b[1] - a[1]) * t; out[1] = a[2] + (b[2] - a[2]) * t; out[2] = a[3] + (b[3] - a[3]) * t;
        return out;
      }
    }
    a = S[S.length - 1]; out[0] = a[1]; out[1] = a[2]; out[2] = a[3];
    return out;
  };
  // Tryb linii z opcji widoku: 'full' | 'brake' | 'off' (stare brakeHint działa jak 'brake')
  PG.lineMode = function (o) {
    var m = o && o.line;
    if (m === 'full' || m === 'brake' || m === 'off') return m;
    if (m === true) return 'full';
    return (o && o.brakeHint) ? 'brake' : 'off';
  };

  // Model linii przed bolidem: próbki okna, odległości i wygładzona w czasie pilność (bez alokacji co klatkę)
  PG.RacingLine = function (T) {
    var N = T.N, L = T.line, i;
    this.T = T; this.cap = 320; this.n = 0;
    this.idx = new Int32Array(this.cap); this.d = new Float32Array(this.cap);
    this.u = new Float32Array(this.cap); this.raw = new Float32Array(this.cap);
    this.su = new Float32Array(N); this.stamp = new Int32Array(N); this.frame = 4;
    // kierunek linii (szerokość wstęgi) i odległość wzdłuż linii
    this.tx = new Float32Array(N); this.ty = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var a = wrapI(i - 1, N), b = wrapI(i + 1, N), dx = L.x[b] - L.x[a], dy = L.y[b] - L.y[a], l = Math.hypot(dx, dy) || 1;
      this.tx[i] = dx / l; this.ty[i] = dy / l;
    }
    this.s = new Float64Array(N + 1);
    for (i = 0; i < N; i++) this.s[i + 1] = this.s[i] + L.ds[i];
    this.total = this.s[N];
  };
  PG.RacingLine.prototype.reset = function () { this.frame += 3; this.n = 0; };
  // Liczy okno linii od `back` próbek za bolidem do `len` metrów przed nim; zwraca liczbę punktów
  PG.RacingLine.prototype.update = function (car, env, dt, len, back) {
    var T = this.T, N = T.N, L = T.line, prof = car && car.profile;
    this.n = 0;
    if (!prof || !prof.v || !(car.idx >= 0) || !isFinite(car.x) || !isFinite(car.y)) return 0;
    back = back || 2; dt = dt > 0 ? dt : 0;
    var v = numOr(car.v, 0); if (v < 0) v = 0;
    var v2 = v * v, sk = (car.ai && car.ai.skill > 0.3) ? car.ai.skill : 1;
    // prędkość graniczna: profil rośnie ~√przyczepności (bez marginesu kierowcy), zużycie opon jak u AI
    var kv = 1 / Math.sqrt(sk);
    if (car.ai && car.ai.refGrip > 0 && PG.tyreGrip) {
      var gr = PG.tyreGrip(car, env) / car.ai.refGrip;
      if (gr > 0 && isFinite(gr)) kv *= Math.sqrt(gr);
    }
    var dec = 0;
    if (PG.brakeDecel) { try { dec = +PG.brakeDecel(car, v, env); } catch (e) { dec = 0; } }
    if (!(dec > 1) || !isFinite(dec)) dec = 12 + 0.0045 * v2;
    var i0 = (car.idx | 0) % N;
    var proj = (car.x - L.x[i0]) * T.tx[i0] + (car.y - L.y[i0]) * T.ty[i0];
    if (!isFinite(proj)) proj = 0;
    var d = -proj, k, i = i0;
    for (k = 0; k < back; k++) { i = i === 0 ? N - 1 : i - 1; d -= L.ds[i]; }
    var n = 0, cap = this.cap, raw = this.raw, idx = this.idx, dd = this.d, pv = prof.v;
    while (n < cap) {
      var vt = pv[i] * kv, nx = i + 1 === N ? 0 : i + 1, u = 0;
      // na przyspieszaniu (profil rośnie) limit to moc, nie przyczepność: zostaw zapas
      if (pv[nx] > pv[i] + 0.02) vt = vt * 1.06 + 2;
      if (v > vt + 0.3) u = (v2 - vt * vt) / (2 * (d > 4 ? d : 4) * dec);
      idx[n] = i; dd[n] = d; raw[n] = u > 1.5 ? 1.5 : u;
      n++;
      if (d > len) break;
      d += L.ds[i]; i = nx;
    }
    // strefa hamowania: każdy punkt dostaje największą pilność do końca swojej strefy
    var m = 0;
    for (k = n - 1; k >= 0; k--) { var r = raw[k]; if (r > 0) { if (r > m) m = r; raw[k] = m; } else m = 0; }
    // wygładzenie w czasie (bez migotania)
    var fr = this.frame, su = this.su, stp = this.stamp, kUp = 1 - Math.exp(-9 * dt), kDn = 1 - Math.exp(-3.5 * dt);
    for (k = 0; k < n; k++) {
      var j = idx[k], tg = raw[k];
      if (stp[j] !== fr - 1) su[j] = tg;
      else su[j] += (tg - su[j]) * (tg > su[j] ? kUp : kDn);
      stp[j] = fr; this.u[k] = su[j];
    }
    this.frame = fr + 1;
    this.n = n;
    return n;
  };

  // Dane otoczenia toru dla widoku 3D: trybuny, boksy, padok, podium, most, tablice hamowania, rozmieszczenie drzew.
  PG.Renderer = function (T) {
    this.T = T;
    this.makeScenery();
    this.makeTrees();
  };
  var R = PG.Renderer.prototype;

  R.makeScenery = function () {
    var T = this.T, N = T.N, hw = T.hw, sc = this.scenery = [];
    var self = this;
    function P(i, lat, along) { i = wrapI(i, N); return [T.x[i] + T.nx[i] * lat + T.tx[i] * (along || 0), T.y[i] + T.ny[i] * lat + T.ty[i] * (along || 0)]; }
    function band(i0, i1, a, b, kind, extra) {
      var pts = [], i;
      for (i = i0; i !== wrapI(i1 + 1, N); i = wrapI(i + 1, N)) pts.push(P(i, a));
      for (i = i1; i !== wrapI(i0 - 1, N); i = wrapI(i - 1, N)) pts.push(P(i, b));
      var o = { kind: kind, pts: pts }; if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      bbox(o); sc.push(o); return o;
    }
    function rect(i, lat0, lat1, a0, a1, kind, extra) {
      var o = { kind: kind, pts: [P(i, lat0, a0), P(i, lat1, a0), P(i, lat1, a1), P(i, lat0, a1)] };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      bbox(o); sc.push(o); return o;
    }
    function bbox(o) { var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; o.pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); o.bb = [x0, y0, x1, y1]; }
    var ds = T.ds, m = function (v) { return Math.round(v / ds); };
    var ret = PG.findMark(T, 'Variante del Rettifilo'), par = PG.findMark(T, 'Curva Alboreto (Parabolica)');
    var asc = PG.findMark(T, 'Variante Ascari'), rog = PG.findMark(T, 'Variante della Roggia'), les1 = PG.findMark(T, 'Curva di Lesmo 1');
    // aleja serwisowa po prawej stronie prostej startowej
    var p0 = T.pit ? T.pit.from : wrapI(T.mainFrom + m(40), N), p1 = T.pit ? T.pit.to : wrapI(ret - m(180), N);
    band(p0, p1, hw + 4.2, hw + 13, 'pitlane');
    band(p0, p1, hw + 3, hw + 4.2, 'wall');
    // budynek boksów z garażami
    var gStart = wrapI(-m(260), N);
    band(gStart, wrapI(gStart + m(330), N), hw + 13, hw + 30, 'roof');
    this.garages = [];
    var teams = PG.garageTeams || [];
    for (var k = 0; k < teams.length; k++) this.garages.push({ i: wrapI(gStart + m(10 + k * 30), N), team: teams[k] });
    // padok i motorhome'y
    band(gStart, wrapI(gStart + m(330), N), hw + 30, hw + 75, 'paddock');
    for (var k2 = 0; k2 < teams.length; k2++) rect(wrapI(gStart + m(14 + k2 * 30), N), hw + 40, hw + 58, 0, 18, 'motorhome', { team: teams[k2] });
    // trybuna główna i trybuny przy zakrętach
    band(wrapI(-m(330), N), wrapI(m(260), N), -hw - 10, -hw - 34, 'stand');
    band(wrapI(-m(330), N), wrapI(m(260), N), -hw - 34, -hw - 40, 'standroof');
    band(wrapI(ret - m(160), N), wrapI(ret + m(10), N), T.barL[ret] + 6, T.barL[ret] + 26, 'stand');
    band(wrapI(par + m(120), N), wrapI(par + m(420), N), -T.barL[wrapI(par + m(250), N)] - 6, -T.barL[wrapI(par + m(250), N)] - 26, 'stand');
    band(wrapI(asc - m(60), N), wrapI(asc + m(90), N), T.barR[asc] + 6, T.barR[asc] + 22, 'stand');
    band(wrapI(rog - m(120), N), wrapI(rog + m(20), N), -T.barL[rog] - 6, -T.barL[rog] - 22, 'stand');
    band(wrapI(les1 - m(40), N), wrapI(les1 + m(80), N), -T.barL[les1] - 8, -T.barL[les1] - 24, 'stand');
    // podium nad aleją serwisową, tuż za metą (jak na Monzy)
    this.podium = rect(m(70), -hw + 1, hw + 30, 0, 14, 'podium');
    sc.pop();
    // stary owal: most nad prostą Serraglio
    var ser = PG.findMark(T, 'Rettifilo Serraglio');
    this.bridgeI = wrapI(ser + m(330), N);
    var bi = this.bridgeI, ang = Math.atan2(T.ty[bi], T.tx[bi]) + 1.15;
    var bank = [];
    for (var s = -520; s <= 520; s += 10) {
      var bend = s * s * 0.00055 * (s > 0 ? 1 : -1);
      bank.push([T.x[bi] + Math.cos(ang) * s - Math.sin(ang) * bend, T.y[bi] + Math.sin(ang) * s + Math.cos(ang) * bend]);
    }
    this.banking = bank;
    this.bridge = { x: T.x[bi], y: T.y[bi], ang: ang };
    // tablice odliczające przed hamowaniem
    this.boards = [];
    var self2 = this;
    [ret, par, rog, asc].forEach(function (ci) {
      [200, 150, 100, 50].forEach(function (d) { self2.boards.push({ p: P(wrapI(ci - m(d), N), -hw - 2.4), h: Math.atan2(T.ty[ci], T.tx[ci]), n: d }); });
    });
    // spatial culling
    sc.forEach(function (o) { o.cx = (o.bb[0] + o.bb[2]) / 2; o.cy = (o.bb[1] + o.bb[3]) / 2; o.r = Math.hypot(o.bb[2] - o.bb[0], o.bb[3] - o.bb[1]) / 2; });
  };

  R.makeTrees = function () {
    var T = this.T, seed = 7, out = [];
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var bb = T.bbox, M = 260;
    var x0 = bb.minx - M, y0 = bb.miny - M, w = bb.maxx - bb.minx + 2 * M, h = bb.maxy - bb.miny + 2 * M;
    var count = Math.round(w * h / 38);
    var sc = this.scenery;
    for (var k = 0; k < count; k++) {
      var x = x0 + rnd() * w, y = y0 + rnd() * h;
      var n = smoothNoise(x / 150, y / 150) * 0.7 + smoothNoise(x / 40, y / 40) * 0.3;
      if (n < 0.4 || rnd() > (n - 0.36) * 2.4) continue;
      var gi = PG.nearestGlobal(T, x, y, 4);
      if (gi >= 0) {
        var dx = x - T.x[gi], dy = y - T.y[gi], d = Math.hypot(dx, dy);
        var side = dx * T.nx[gi] + dy * T.ny[gi] > 0;
        var lim = (side ? T.barR[gi] : T.barL[gi]) + 9;
        if (PG.inRun(gi, T.mainFrom, T.mainTo) || gi < 140 || gi > T.N - 200) lim = side ? T.hw + 90 : T.hw + 50;
        if (d < lim) continue;
      }
      var blocked = false;
      for (var s = 0; s < sc.length && !blocked; s++) { var o = sc[s]; if (x > o.bb[0] - 6 && x < o.bb[2] + 6 && y > o.bb[1] - 6 && y < o.bb[3] + 6) blocked = true; }
      if (blocked) continue;
      var bd = Infinity; for (var b = 0; b < this.banking.length; b++) bd = Math.min(bd, Math.hypot(this.banking[b][0] - x, this.banking[b][1] - y));
      if (bd < 16) continue;
      out.push({ x: x, y: y, r: 3 + rnd() * 4.5, v: (rnd() * 6) | 0 });
    }
    // siatka do szybkiego wybierania widocznych
    var cell = 60, grid = new Map();
    out.forEach(function (t) { var key = Math.floor(t.x / cell) + ',' + Math.floor(t.y / cell); var a = grid.get(key); if (!a) grid.set(key, a = []); a.push(t); });
    this.treeGrid = grid; this.treeCell = cell; this.treeCount = out.length;
  };

  PG.inRun = function (i, a, b) { return a <= b ? (i >= a && i <= b) : (i >= a || i <= b); };

  // Minimapa
  R.minimap = function (w, h, dpr) {
    var T = this.T, bb = T.bbox, m = 8;
    dpr = dpr || 1;
    var sc = Math.min((w - 2 * m) / (bb.maxx - bb.minx), (h - 2 * m) / (bb.maxy - bb.miny));
    var c = document.createElement('canvas'); c.width = w * dpr; c.height = h * dpr;
    var g = c.getContext('2d'); g.scale(dpr, dpr);
    var offx = (w - (bb.maxx - bb.minx) * sc) / 2, offy = (h - (bb.maxy - bb.miny) * sc) / 2;
    var map = function (x, y) { return [offx + (x - bb.minx) * sc, offy + (y - bb.miny) * sc]; };
    g.lineJoin = 'round';
    g.beginPath();
    for (var i = 0; i <= T.N; i += 2) { var p = map(T.x[i % T.N], T.y[i % T.N]); if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); }
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = '#e8e4d8'; g.lineWidth = 3; g.stroke();
    g.strokeStyle = '#2fd07a'; g.lineWidth = 3;
    T.drs.forEach(function (z) { g.beginPath(); var i2 = z.from, first = true, guard = 0; while (i2 !== z.to && guard++ < T.N) { var p2 = map(T.x[i2], T.y[i2]); if (first) { g.moveTo(p2[0], p2[1]); first = false; } else g.lineTo(p2[0], p2[1]); i2 = (i2 + 1) % T.N; } g.stroke(); });
    var s0 = map(T.x[0], T.y[0]); g.fillStyle = '#ffffff'; g.fillRect(s0[0] - 6, s0[1] - 1.5, 12, 3);
    return { c: c, map: map, w: w, h: h };
  };
})(PG);
