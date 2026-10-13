// Monza Grand Prix — renderowanie świata w wysokiej rozdzielczości (wektorowo, co klatkę).
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

  // Tekstury (kafelkowe wzory wyrównane do świata)
  function noiseTex(size, base, vars, density, extra) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, size, size);
    var img = g.getImageData(0, 0, size, size), d = img.data;
    for (var i = 0; i < size * size; i++) {
      var x = i % size, y = (i / size) | 0, n = hash(x, y), o = i * 4;
      var v = (n - 0.5) * vars + (smoothNoise(x / 9, y / 9) - 0.5) * vars * 0.8;
      d[o] = Math.max(0, Math.min(255, d[o] + v)); d[o + 1] = Math.max(0, Math.min(255, d[o + 1] + v)); d[o + 2] = Math.max(0, Math.min(255, d[o + 2] + v * 0.8));
    }
    g.putImageData(img, 0, 0);
    if (extra) extra(g, size);
    return c;
  }

  PG.Renderer = function (T) {
    this.T = T;
    this.particles = [];
    this.skids = []; // [x1,y1,x2,y2,alpha]
    this.rain = [];
    this.makeTextures();
    this.makeScenery();
    this.makeTrees();
  };
  var R = PG.Renderer.prototype;

  R.makeTextures = function () {
    var ctx = document.createElement('canvas').getContext('2d');
    var P = this.pat = {};
    var self = this;
    function pattern(c, pxPerM) {
      var p = ctx.createPattern(c, 'repeat');
      if (p.setTransform && window.DOMMatrix) p.setTransform(new DOMMatrix().scaleSelf(1 / pxPerM, 1 / pxPerM));
      return p;
    }
    this.tex = {
      grass: noiseTex(256, '#3b7a33', 26, 0, function (g, s) {
        for (var k = 0; k < 500; k++) { var x = hash(k, 1) * s, y = hash(k, 2) * s; g.fillStyle = hash(k, 3) < 0.5 ? 'rgba(20,60,20,0.35)' : 'rgba(120,170,80,0.25)'; g.fillRect(x, y, 2, 2); }
      }),
      lawn: noiseTex(256, '#4f9440', 16, 0, function (g, s) {
        for (var y = 0; y < s; y += 64) { g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y, s, 32); }
      }),
      asphalt: noiseTex(256, '#4a4e55', 22, 0, function (g, s) {
        for (var k = 0; k < 900; k++) { var x = hash(k, 7) * s, y = hash(k, 8) * s; g.fillStyle = hash(k, 9) < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.12)'; g.fillRect(x, y, 1, 1); }
      }),
      gravel: noiseTex(256, '#cdb98e', 40, 0, function (g, s) {
        for (var k = 0; k < 1400; k++) { var x = hash(k, 11) * s, y = hash(k, 12) * s; g.fillStyle = hash(k, 13) < 0.5 ? 'rgba(90,70,40,0.4)' : 'rgba(255,250,230,0.5)'; g.beginPath(); g.arc(x, y, 0.8 + hash(k, 14) * 1.4, 0, 7); g.fill(); }
      }),
      runoff: noiseTex(256, '#666c74', 14, 0),
      crowd: (function () {
        // rzędy siedzeń z kibicami (8 px na metr, rząd co 0,75 m)
        var c = document.createElement('canvas'); c.width = c.height = 96; var g = c.getContext('2d');
        g.fillStyle = '#6d727a'; g.fillRect(0, 0, 96, 96);
        var shirts = ['#d4202a', '#d4202a', '#d4202a', '#f2f0ea', '#f2c230', '#1f4fbf', '#262626', '#e0603a', '#2f8f46'];
        var skin = ['#e8bc98', '#d9a37f', '#b07a55', '#f1cdb0'];
        for (var y = 0; y < 96; y += 6) {
          g.fillStyle = '#a8262c'; g.fillRect(0, y + 1, 96, 3);
          g.fillStyle = '#4b4f56'; g.fillRect(0, y + 4, 96, 2);
          for (var x = 0; x < 96; x += 4) {
            if (hash(x, y) < 0.7) {
              var j = (hash(x + 1, y + 2) - 0.5) * 1.2;
              g.fillStyle = shirts[(hash(x + 3, y + 5) * shirts.length) | 0]; g.fillRect(x + 0.5 + j, y + 1.5, 3, 3);
              g.fillStyle = skin[(hash(x + 7, y + 1) * skin.length) | 0]; g.beginPath(); g.arc(x + 2 + j, y + 2.2, 1.1, 0, 7); g.fill();
            }
          }
        }
        return c;
      })(),
      roof: noiseTex(128, '#8e9399', 10, 0, function (g, s) { g.fillStyle = 'rgba(0,0,0,0.18)'; for (var x = 0; x < s; x += 16) g.fillRect(x, 0, 2, s); }),
      paddock: noiseTex(128, '#7b8088', 12, 0)
    };
    P.grass = pattern(this.tex.grass, 12);
    P.lawn = pattern(this.tex.lawn, 8);
    P.asphalt = pattern(this.tex.asphalt, 24);
    P.gravel = pattern(this.tex.gravel, 26);
    P.runoff = pattern(this.tex.runoff, 16);
    P.crowd = pattern(this.tex.crowd, 8);
    P.roof = pattern(this.tex.roof, 6);
    P.paddock = pattern(this.tex.paddock, 10);
  };

  // Obiekty otoczenia: boksy, trybuny, padok, podium, stary owal z mostem
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
    // sprite'y koron drzew
    this.treeSprites = [];
    var palettes = [['#1f4a22', '#2c6a2e', '#3f8a3a', '#62a94c'], ['#1c4320', '#285f2a', '#367a33', '#4f9640'], ['#244d1f', '#346a2a', '#4b8838', '#6fae52'], ['#203f26', '#2b5a33', '#3b7a44', '#5a9a5e'], ['#3e4a1c', '#5a6a26', '#7d8a33', '#a8ad4a'], ['#1a3d1f', '#24562a', '#2f6e34', '#468f45']];
    for (var v = 0; v < 6; v++) {
      var S = 128, c = document.createElement('canvas'); c.width = c.height = S; var g = c.getContext('2d'), pal = palettes[v];
      // cień + korona z kilku kęp
      g.fillStyle = 'rgba(0,0,0,0.0)';
      var blobs = [];
      for (var q = 0; q < 9; q++) { var a = hash(v, q) * Math.PI * 2, rr = hash(q, v + 3) * 22; blobs.push([64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr, 18 + hash(v + 7, q) * 14]); }
      blobs.forEach(function (bl) { g.fillStyle = pal[0]; g.beginPath(); g.arc(bl[0], bl[1], bl[2], 0, 7); g.fill(); });
      blobs.forEach(function (bl) { g.fillStyle = pal[1]; g.beginPath(); g.arc(bl[0] - 3, bl[1] - 3, bl[2] * 0.82, 0, 7); g.fill(); });
      blobs.forEach(function (bl) { g.fillStyle = pal[2]; g.beginPath(); g.arc(bl[0] - 6, bl[1] - 6, bl[2] * 0.55, 0, 7); g.fill(); });
      blobs.forEach(function (bl) { g.fillStyle = pal[3]; g.beginPath(); g.arc(bl[0] - 8, bl[1] - 8, bl[2] * 0.25, 0, 7); g.fill(); });
      for (var z = 0; z < 160; z++) { g.fillStyle = hash(z, v) < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)'; g.beginPath(); g.arc(20 + hash(z, 3) * 88, 20 + hash(z, 4) * 88, 2 + hash(z, 5) * 3, 0, 7); g.fill(); }
      this.treeSprites.push(c);
    }
  };

  PG.inRun = function (i, a, b) { return a <= b ? (i >= a && i <= b) : (i >= a || i <= b); };

  // ---------- rysowanie klatki ----------
  // cam: {x, y, rot, ppm, cx, cy}
  R.draw = function (ctx, W, H, S, cam, opts) {
    var T = this.T, N = T.N, hw = T.hw, P = this.pat;
    var self = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    var ppm = cam.ppm;
    ctx.translate(cam.cx, cam.cy); ctx.scale(ppm, ppm); ctx.rotate(-cam.rot); ctx.translate(-cam.x, -cam.y);
    var Rv = Math.hypot(Math.max(cam.cx, W - cam.cx), Math.max(cam.cy, H - cam.cy)) / ppm + 10;
    var vx = cam.x, vy = cam.y;
    // tło: trawa parku
    ctx.fillStyle = P.grass; ctx.fillRect(vx - Rv, vy - Rv, 2 * Rv, 2 * Rv);
    // stary owal
    this.drawBanking(ctx, vx, vy, Rv);
    // widoczne odcinki toru
    var vis = new Uint8Array(N), any = false, R2 = (Rv + 80) * (Rv + 80);
    for (var i = 0; i < N; i++) { var dx = T.x[i] - vx, dy = T.y[i] - vy; if (dx * dx + dy * dy < R2) { vis[i] = 1; any = true; } }
    var runs = [];
    if (any) {
      var start = -1;
      for (var j = 0; j < N; j++) if (vis[j] && !vis[wrapI(j - 1, N)]) { start = j; break; }
      if (start < 0) runs.push([0, N]);
      else {
        var k = start, cnt = 0;
        while (cnt < N) {
          if (vis[k]) { var s0 = k, len = 0; while (vis[k] && len < N) { k = wrapI(k + 1, N); len++; cnt++; } runs.push([wrapI(s0 - 1, N), len + 2]); }
          else { k = wrapI(k + 1, N); cnt++; }
        }
      }
    }
    function off(i, lat) { return [T.x[i] + T.nx[i] * lat, T.y[i] + T.ny[i] * lat]; }
    function bandPath(run, fa, fb) {
      ctx.beginPath();
      var a = run[0], n = run[1], q;
      for (q = 0; q <= n; q++) { var ii = wrapI(a + q, N), p = off(ii, fa(ii)); if (q === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
      for (q = n; q >= 0; q--) { var i2 = wrapI(a + q, N), p2 = off(i2, fb(i2)); ctx.lineTo(p2[0], p2[1]); }
      ctx.closePath();
    }
    function linePath(run, f) {
      ctx.beginPath();
      for (var q = 0; q <= run[1]; q++) { var ii = wrapI(run[0] + q, N), p = off(ii, f(ii)); if (q === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    }
    // sub-odcinki spełniające warunek
    function subRuns(run, pred) {
      var out = [], cur = null;
      for (var q = 0; q <= run[1]; q++) {
        var ii = wrapI(run[0] + q, N);
        if (pred(ii)) { if (!cur) cur = [ii, 0]; else cur[1]++; } else if (cur) { out.push(cur); cur = null; }
      }
      if (cur) out.push(cur);
      return out;
    }
    runs.forEach(function (run) {
      // trawnik wzdłuż toru
      ctx.fillStyle = P.lawn; bandPath(run, function (i) { return -T.barL[i] - 9; }, function (i) { return T.barR[i] + 9; }); ctx.fill();
      // pobocza
      [[-1, T.surfL, T.barL], [1, T.surfR, T.barR]].forEach(function (sd) {
        var s = sd[0];
        subRuns(run, function (i) { return sd[1][i] === 1; }).forEach(function (r) { ctx.fillStyle = P.gravel; bandPath(r, function (i) { return s * (hw + 1.4); }, function (i) { return s * (sd[2][i] - 0.6); }); ctx.fill(); });
        subRuns(run, function (i) { return sd[1][i] === 2; }).forEach(function (r) { ctx.fillStyle = P.runoff; bandPath(r, function (i) { return s * (hw + 1.4); }, function (i) { return s * (sd[2][i] - 0.6); }); ctx.fill(); });
      });
      // bariery: cień, mur/barierka, ściana opon
      [[-1, T.barL, T.surfL], [1, T.barR, T.surfR]].forEach(function (sd) {
        var s = sd[0];
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.4; linePath(run, function (i) { return s * (sd[1][i] - 0.2) - s * 0.6; }); ctx.stroke();
        ctx.strokeStyle = '#c9ccd0'; ctx.lineWidth = 0.7; linePath(run, function (i) { return s * sd[1][i]; }); ctx.stroke();
        subRuns(run, function (i) { return sd[2][i] === 1; }).forEach(function (r) {
          ctx.strokeStyle = '#1e2024'; ctx.lineWidth = 1.1; linePath(r, function (i) { return s * (sd[1][i] - 0.8); }); ctx.stroke();
          ctx.setLineDash([1.2, 1.2]); ctx.strokeStyle = '#d23a3a'; ctx.lineWidth = 0.5; ctx.stroke(); ctx.setLineDash([]);
        });
        // tablice reklamowe na barierze
        ctx.lineWidth = 0.35;
        for (var q = 0; q <= run[1]; q += 4) {
          var ii = wrapI(run[0] + q, N); if (sd[2][ii] === 1) continue;
          var a = off(ii, s * (sd[1][ii] - 0.45)), b = off(wrapI(ii + 3, N), s * (sd[1][wrapI(ii + 3, N)] - 0.45));
          ctx.strokeStyle = ['#d42a2a', '#f2f2f2', '#1f4fbf', '#f2c230', '#141414'][(ii >> 2) % 5];
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      });
      // krawężniki
      [[-1, T.kerbL], [1, T.kerbR]].forEach(function (sd) {
        var s = sd[0];
        subRuns(run, function (i) { return sd[1][i]; }).forEach(function (r) {
          ctx.fillStyle = '#f0efe9'; bandPath(r, function () { return s * (hw - 0.15); }, function () { return s * (hw + 1.5); }); ctx.fill();
          for (var q = 0; q < r[1]; q++) {
            var ii = wrapI(r[0] + q, N); if ((ii >> 1) % 2) continue;
            ctx.fillStyle = '#d0262b'; bandPath([ii, 2], function () { return s * (hw - 0.15); }, function () { return s * (hw + 1.5); }); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.1; linePath(r, function () { return s * (hw + 1.5); }); ctx.stroke();
        });
      });
      // asfalt
      ctx.fillStyle = P.asphalt; bandPath(run, function () { return -hw; }, function () { return hw; }); ctx.fill();
      // starta guma na linii jazdy
      ctx.strokeStyle = 'rgba(15,15,18,0.16)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath(); for (var q2 = 0; q2 <= run[1]; q2++) { var ii2 = wrapI(run[0] + q2, N); if (q2 === 0) ctx.moveTo(T.line.x[ii2], T.line.y[ii2]); else ctx.lineTo(T.line.x[ii2], T.line.y[ii2]); } ctx.stroke();
      // linie krawędzi
      ctx.strokeStyle = '#f2f2ec'; ctx.lineWidth = 0.22;
      [[-1, T.kerbL], [1, T.kerbR]].forEach(function (sd) {
        subRuns(run, function (i) { return !sd[1][i]; }).forEach(function (r) { linePath(r, function () { return sd[0] * (hw - 0.3); }); ctx.stroke(); });
      });
    });
    // linia mety, pola startowe, linie DRS
    this.drawMarkings(ctx, vx, vy, Rv);
    // ślady opon
    ctx.lineCap = 'round';
    for (var sk = 0; sk < this.skids.length; sk++) {
      var m = this.skids[sk]; if (Math.abs(m[0] - vx) > Rv || Math.abs(m[1] - vy) > Rv) continue;
      ctx.strokeStyle = m[5] || 'rgba(18,18,20,' + m[4] + ')'; ctx.lineWidth = m[6] || 0.28;
      ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(m[2], m[3]); ctx.stroke();
    }
    // linia jazdy: kolor zależny od prędkości (ta sama reguła co w 3D)
    var lmode = PG.lineMode(opts);
    if (lmode !== 'off' && S.player && S.player.profile && !this.lineOff) {
      try { this.drawRacingLine(ctx, S, lmode, (opts && opts.dt) || 0.016); }
      catch (e) { this.lineOff = true; console.warn('Linia jazdy 2D wyłączona:', e); }
    }
    // budynki i trybuny
    this.drawScenery(ctx, vx, vy, Rv);
    // tablice hamowania
    this.boards.forEach(function (b) {
      if (Math.abs(b.p[0] - vx) > Rv || Math.abs(b.p[1] - vy) > Rv) return;
      ctx.save(); ctx.translate(b.p[0], b.p[1]); ctx.rotate(b.h);
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(-0.5, -0.9, 1, 1.8); ctx.fillStyle = '#1b1b1b';
      for (var z = 0; z < b.n / 50; z++) ctx.fillRect(-0.4 + z * 0.22, -0.6, 0.12, 1.2);
      ctx.restore();
    });
    // cząsteczki pod bolidami
    // bolidy
    var shadow = PG.carShadow();
    var cars = S.cars;
    for (var c = 0; c < cars.length; c++) {
      var car = cars[c];
      if (Math.abs(car.x - vx) > Rv || Math.abs(car.y - vy) > Rv) continue;
      ctx.save(); ctx.translate(car.x + 0.35, car.y + 0.45); ctx.rotate(car.h);
      ctx.globalAlpha = 0.6; ctx.drawImage(shadow, -3.3, -1.45, 6.6, 2.9); ctx.globalAlpha = 1; ctx.restore();
    }
    for (var c2 = 0; c2 < cars.length; c2++) {
      var cr = cars[c2];
      if (Math.abs(cr.x - vx) > Rv || Math.abs(cr.y - vy) > Rv) continue;
      if (cr.ghost > 0 && Math.floor(cr.ghost * 10) % 2) continue;
      var tex = cr.drsOpen ? cr.texDrs : cr.tex; if (!tex) continue;
      ctx.save(); ctx.translate(cr.x, cr.y); ctx.rotate(cr.h);
      ctx.drawImage(tex, -tex.width / PG.CAR_TEX / 2, -tex.height / PG.CAR_TEX / 2, tex.width / PG.CAR_TEX, tex.height / PG.CAR_TEX);
      if (cr.brake > 0.5 && cr.v > 3) { ctx.fillStyle = 'rgba(255,40,40,0.9)'; ctx.fillRect(-2.98, -0.06, 0.12, 0.12); }
      if (S.env.wet) { ctx.fillStyle = (Math.floor(S.clock * 4) % 2) ? 'rgba(255,40,40,0.95)' : 'rgba(120,20,20,0.6)'; ctx.fillRect(-2.98, -0.06, 0.12, 0.12); }
      ctx.restore();
    }
    // samochód bezpieczeństwa
    var scc = S.rc && S.rc.sc;
    if (scc && !scc.inPit && Math.abs(scc.x - vx) < Rv && Math.abs(scc.y - vy) < Rv) {
      ctx.save(); ctx.translate(scc.x, scc.y); ctx.rotate(scc.h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-2.2, -0.85, 4.8, 2.0);
      ctx.fillStyle = '#b8bec4'; ctx.beginPath(); ctx.moveTo(-2.3, -0.95); ctx.lineTo(1.9, -0.95); ctx.quadraticCurveTo(2.4, -0.9, 2.4, 0); ctx.quadraticCurveTo(2.4, 0.9, 1.9, 0.95); ctx.lineTo(-2.3, 0.95); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b2430'; ctx.fillRect(-1.3, -0.8, 2.1, 1.6);
      ctx.fillStyle = '#c8e000'; ctx.fillRect(-2.3, -0.95, 4.2, 0.18); ctx.fillRect(-2.3, 0.77, 4.2, 0.18);
      if (scc.lights) { var ph = Math.floor(S.clock * 6) % 2; ctx.fillStyle = ph ? '#ffb000' : '#5a3a00'; ctx.fillRect(-0.3, -0.55, 0.3, 0.4); ctx.fillStyle = ph ? '#5a3a00' : '#ffb000'; ctx.fillRect(-0.3, 0.15, 0.3, 0.4); }
      ctx.restore();
    }
    // cząsteczki
    for (var pk = 0; pk < this.particles.length; pk++) {
      var pp = this.particles[pk], pt = Math.max(0, pp.life / pp.max);
      ctx.globalAlpha = Math.min(1, pt * (pp.grow > 1 ? 1.6 : 1)) * (pp.a || 1);
      ctx.fillStyle = pp.color; ctx.beginPath(); ctx.arc(pp.x, pp.y, pp.size * (1 + (pp.grow === undefined ? 0.5 : pp.grow) * (1 - pt)), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // drzewa
    this.drawTrees(ctx, vx, vy, Rv);
    // most i podium nad torem
    this.drawBridge(ctx, vx, vy, Rv);
    this.drawPodium(ctx, vx, vy, Rv);
    // znacznik gracza
    if (opts && opts.marker && S.player) {
      var pl = S.player;
      ctx.save(); ctx.translate(pl.x, pl.y); ctx.rotate(cam.rot);
      ctx.fillStyle = '#ffc93c'; ctx.strokeStyle = '#1a1205'; ctx.lineWidth = 0.15;
      ctx.beginPath(); ctx.moveTo(0, -3.6); ctx.lineTo(-0.75, -4.7); ctx.lineTo(0.75, -4.7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // pogoda (w przestrzeni ekranu)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (S.env.weather === 'cloud') { ctx.fillStyle = 'rgba(40,52,70,0.18)'; ctx.fillRect(0, 0, W, H); }
    if (S.env.wet) {
      ctx.fillStyle = 'rgba(25,35,55,0.32)'; ctx.fillRect(0, 0, W, H);
      var need = Math.round(W * H / 5000);
      while (this.rain.length < need) this.rain.push({ x: Math.random() * W, y: Math.random() * H, s: 600 + Math.random() * 500, l: 8 + Math.random() * 12 });
      ctx.strokeStyle = 'rgba(200,215,240,0.45)'; ctx.lineWidth = 1.2; ctx.beginPath();
      var dt = (opts && opts.dt) || 0.016;
      for (var r = 0; r < need; r++) {
        var d = this.rain[r]; d.y += d.s * dt; d.x -= d.s * 0.15 * dt;
        if (d.y > H) { d.y = -20; d.x = Math.random() * (W + 60); }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.15, d.y + d.l);
      }
      ctx.stroke();
    }
  };

  // Linia jazdy 2D: pasy o kolorze wg pilności hamowania, wygaszone na końcach
  R.drawRacingLine = function (ctx, S, mode, dt) {
    var T = this.T, L = T.line, pc = S.player;
    var RL = this.rl || (this.rl = new PG.RacingLine(T));
    if (this.rlS !== S) { this.rlS = S; RL.reset(); }
    var len = Math.min(320, 50 + 3 * Math.max(0, numOr(pc.v, 0)));
    var n = RL.update(pc, S.env, dt, len, 2);
    if (n < 2) return;
    var rgb = this.lineTmp || (this.lineTmp = [0, 0, 0]), cache = this.lineStyles || (this.lineStyles = {});
    var brake = mode === 'brake';
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (var pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 0.42 : 0.8;
      var runKey = -1, open = false;
      for (var k = 0; k < n - 1; k++) {
        var i = RL.idx[k], j = RL.idx[k + 1], d = RL.d[k], u = (RL.u[k] + RL.u[k + 1]) * 0.5;
        var a = sst(0, 8, d) * (1 - sst(len - 30, len, d)) * (pass ? 0.85 : 0.28);
        if (brake) a *= sst(0.16, 0.3, u);
        var ql = Math.round(a * 12);
        if (ql < 1) { if (open) { ctx.stroke(); open = false; } runKey = -1; continue; }
        var qc = Math.round(Math.min(1, u) * 40), key = qc * 16 + ql;
        if (key !== runKey) {
          if (open) ctx.stroke();
          var st = cache[key];
          if (!st) {
            PG.lineRGB(qc / 40, rgb);
            st = cache[key] = 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ',' + Math.round(rgb[2] * 255) + ',' + (ql / 12).toFixed(3) + ')';
          }
          ctx.strokeStyle = st; ctx.beginPath(); ctx.moveTo(L.x[i], L.y[i]);
          runKey = key; open = true;
        }
        ctx.lineTo(L.x[j], L.y[j]);
      }
      if (open) ctx.stroke();
    }
  };

  R.drawMarkings = function (ctx, vx, vy, Rv) {
    var T = this.T, hw = T.hw, N = T.N;
    function near(i) { return Math.abs(T.x[i] - vx) < Rv + 20 && Math.abs(T.y[i] - vy) < Rv + 20; }
    // szachownica mety
    if (near(0)) {
      ctx.save(); ctx.translate(T.x[0], T.y[0]); ctx.rotate(Math.atan2(T.ty[0], T.tx[0]));
      for (var a = -hw; a < hw; a += 0.6) for (var r = 0; r < 3; r++) { ctx.fillStyle = (Math.round((a + hw) / 0.6) + r) % 2 ? '#111' : '#f4f4f0'; ctx.fillRect(-r * 0.6, a, 0.6, 0.6); }
      ctx.restore();
    }
    // pola startowe z numerami
    ctx.font = '1.2px Titillium Web, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    T.grid.forEach(function (s, k) {
      if (!near(s.i)) return;
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.h);
      ctx.strokeStyle = '#f2f2ec'; ctx.lineWidth = 0.18;
      var side = s.lat < 0 ? -1 : 1;
      ctx.beginPath(); ctx.moveTo(-0.6, -1.3 * side); ctx.lineTo(3.2, -1.3 * side); ctx.moveTo(3.2, -1.3 * side); ctx.lineTo(3.2, 1.3 * side); ctx.stroke();
      ctx.rotate(Math.PI / 2); ctx.fillStyle = 'rgba(242,242,236,0.9)'; ctx.fillText(String(k + 1), 0, -4.4);
      ctx.restore();
    });
    // linie DRS
    T.drs.forEach(function (z) {
      [[z.from, '#f2f2ec'], [z.detect, '#f5c518']].forEach(function (d) {
        var i = d[0]; if (!near(i)) return;
        ctx.save(); ctx.translate(T.x[i], T.y[i]); ctx.rotate(Math.atan2(T.ty[i], T.tx[i]));
        ctx.fillStyle = d[1]; ctx.fillRect(-0.15, -hw, 0.3, 2 * hw); ctx.restore();
      });
    });
  };

  R.drawScenery = function (ctx, vx, vy, Rv) {
    var P = this.pat, T = this.T, self = this;
    this.scenery.forEach(function (o) {
      if (Math.abs(o.cx - vx) > Rv + o.r || Math.abs(o.cy - vy) > Rv + o.r) return;
      ctx.beginPath(); o.pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.closePath();
      switch (o.kind) {
        case 'pitlane': ctx.fillStyle = P.asphalt; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.15; ctx.stroke(); break;
        case 'wall': ctx.fillStyle = '#b9bcc0'; ctx.fill(); break;
        case 'roof': ctx.save(); ctx.translate(0.6, 0.8); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill(); ctx.restore(); ctx.fillStyle = P.roof; ctx.fill(); ctx.strokeStyle = '#5c6066'; ctx.lineWidth = 0.3; ctx.stroke(); break;
        case 'paddock': ctx.fillStyle = P.paddock; ctx.fill(); break;
        case 'stand': ctx.save(); ctx.translate(0.5, 0.8); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill(); ctx.restore(); ctx.fillStyle = P.crowd; ctx.fill(); ctx.strokeStyle = '#d6d8db'; ctx.lineWidth = 0.6; ctx.stroke(); break;
        case 'standroof': ctx.fillStyle = '#c4c8cd'; ctx.fill(); ctx.strokeStyle = '#7d828a'; ctx.lineWidth = 0.3; ctx.stroke(); break;
        case 'motorhome':
          self.drawMotorhome(ctx, o);
          break;
      }
    });
    // garaże w kolorach zespołów
    var hw = T.hw;
    (this.garages || []).forEach(function (gg) {
      var i = gg.i; if (Math.abs(T.x[i] - vx) > Rv + 30 || Math.abs(T.y[i] - vy) > Rv + 30) return;
      ctx.save(); ctx.translate(T.x[i] + T.nx[i] * (hw + 13), T.y[i] + T.ny[i] * (hw + 13)); ctx.rotate(Math.atan2(T.ty[i], T.tx[i]));
      var lv = gg.team.livery;
      // dach garażu w barwach zespołu
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 2.2, 0.3, 14.8);
      ctx.fillStyle = PG.shade(lv.primary, -0.25); ctx.fillRect(0.4, 2.6, 25.2, 13.8);
      ctx.fillStyle = PG.shade(lv.primary, 0.05); ctx.fillRect(1.2, 3.4, 23.6, 12.2);
      ctx.fillStyle = lv.secondary; ctx.fillRect(1.2, 8.6, 23.6, 1.8);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; for (var rr = 2; rr < 25; rr += 3) ctx.fillRect(rr, 3.4, 0.25, 12.2);
      ctx.fillStyle = lv.primary; ctx.fillRect(0, -0.2, 26, 2.2); ctx.fillStyle = lv.secondary; ctx.fillRect(0, 1.6, 26, 0.6);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; for (var d = 1; d < 26; d += 6.5) ctx.fillRect(d, -0.2, 4.5, 0.9);
      // stanowisko na murku
      ctx.fillStyle = lv.secondary; ctx.fillRect(8, -9.6, 8, 1.4);
      ctx.restore();
    });
  };

  R.drawMotorhome = function (ctx, o) {
    var lv = o.team.livery, p = o.pts;
    var ox = p[0][0], oy = p[0][1], ux = (p[1][0] - ox), uy = (p[1][1] - oy), vxx = (p[3][0] - ox), vyy = (p[3][1] - oy);
    var W = Math.hypot(ux, uy), L = Math.hypot(vxx, vyy);
    ctx.save(); ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([ux / W, uy / W, vxx / L, vyy / L, ox, oy])));
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0.6, 0.8, W, L);
    // dach budynku: dwa piętra
    var gr = ctx.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, PG.shade(lv.primary, -0.15)); gr.addColorStop(0.5, PG.shade(lv.primary, 0.08)); gr.addColorStop(1, PG.shade(lv.primary, -0.2));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, L);
    ctx.fillStyle = PG.shade(lv.primary, -0.3); ctx.fillRect(2, 2, W - 4, L - 4);
    ctx.fillStyle = PG.shade(lv.primary, 0.12); ctx.fillRect(2.4, 2.4, W - 4.8, L - 4.8);
    ctx.fillStyle = lv.secondary; ctx.fillRect(0, 0, 0.9, L); ctx.fillRect(W - 0.9, 0, 0.9, L);
    ctx.fillStyle = lv.accent; ctx.fillRect(0.9, 0, 0.5, L);
    // klimatyzatory i świetliki
    ctx.fillStyle = '#c9ccd0'; ctx.strokeStyle = '#7c8086'; ctx.lineWidth = 0.15;
    for (var k = 0; k < 3; k++) { ctx.fillRect(W * 0.62, 3.5 + k * 4.2, 3, 2.2); ctx.strokeRect(W * 0.62, 3.5 + k * 4.2, 3, 2.2); }
    ctx.fillStyle = 'rgba(160,200,235,0.75)'; ctx.fillRect(4, 4, W * 0.32, L - 8);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.2; ctx.strokeRect(0, 0, W, L);
    // markiza przed wejściem
    ctx.fillStyle = 'rgba(245,245,245,0.92)'; ctx.fillRect(-4.5, 2, 4.5, L - 4);
    ctx.fillStyle = lv.primary; for (var q = 2; q < L - 2; q += 2) ctx.fillRect(-4.5, q, 4.5, 1);
    ctx.restore();
  };

  R.drawTrees = function (ctx, vx, vy, Rv) {
    var cell = this.treeCell, g0x = Math.floor((vx - Rv - 10) / cell), g1x = Math.floor((vx + Rv + 10) / cell), g0y = Math.floor((vy - Rv - 10) / cell), g1y = Math.floor((vy + Rv + 10) / cell);
    var spr = this.treeSprites;
    for (var gx = g0x; gx <= g1x; gx++) for (var gy = g0y; gy <= g1y; gy++) {
      var arr = this.treeGrid.get(gx + ',' + gy); if (!arr) continue;
      for (var k = 0; k < arr.length; k++) {
        var t = arr[k], s = t.r * 2.3;
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#0b1f0c'; ctx.beginPath(); ctx.arc(t.x + t.r * 0.35, t.y + t.r * 0.45, t.r * 0.95, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
        ctx.drawImage(spr[t.v], t.x - s / 2, t.y - s / 2, s, s);
      }
    }
  };

  R.drawBanking = function (ctx, vx, vy, Rv) {
    var b = this.banking;
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 17; ctx.beginPath(); b.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0] + 1, p[1] + 1.5); else ctx.lineTo(p[0] + 1, p[1] + 1.5); }); ctx.stroke();
    ctx.strokeStyle = '#8a8780'; ctx.lineWidth = 15; ctx.beginPath(); b.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.stroke();
    ctx.strokeStyle = 'rgba(70,110,55,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([4, 9]); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#b4b1a8'; ctx.lineWidth = 0.6;
    [-7.2, 7.2].forEach(function (o) {
      ctx.beginPath();
      for (var i = 0; i < b.length; i++) {
        var p = b[i], q = b[Math.min(b.length - 1, i + 1)], r = b[Math.max(0, i - 1)];
        var tx = q[0] - r[0], ty = q[1] - r[1], l = Math.hypot(tx, ty) || 1;
        var x = p[0] - ty / l * o, y = p[1] + tx / l * o;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  };

  R.drawBridge = function (ctx, vx, vy, Rv) {
    var br = this.bridge; if (Math.abs(br.x - vx) > Rv + 60 || Math.abs(br.y - vy) > Rv + 60) return;
    ctx.save(); ctx.translate(br.x, br.y); ctx.rotate(br.ang);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-26, -7, 52, 17);
    ctx.fillStyle = '#a6a39b'; ctx.fillRect(-28, -7.5, 56, 15);
    ctx.fillStyle = '#8f8c84'; for (var x = -28; x < 28; x += 4) ctx.fillRect(x, -7.5, 0.4, 15);
    ctx.fillStyle = '#d8d6cf'; ctx.fillRect(-28, -7.5, 56, 0.8); ctx.fillRect(-28, 6.7, 56, 0.8);
    ctx.fillStyle = '#c23a2e'; ctx.font = 'bold 3px Titillium Web, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.restore();
  };

  R.drawPodium = function (ctx, vx, vy, Rv) {
    var o = this.podium; if (!o) return;
    var cx = (o.bb[0] + o.bb[2]) / 2, cy = (o.bb[1] + o.bb[3]) / 2;
    if (Math.abs(cx - vx) > Rv + 40 || Math.abs(cy - vy) > Rv + 40) return;
    ctx.beginPath(); o.pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.closePath();
    ctx.save(); ctx.translate(1.2, 1.6); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill(); ctx.restore();
    ctx.globalAlpha = 0.7; ctx.fillStyle = '#9aa3ad'; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#e8eaed'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.strokeStyle = '#c6262e'; ctx.lineWidth = 0.35; ctx.stroke();
  };

  // Efekty z ruchu bolidów
  // grow: przyrost promienia do końca życia (domyślnie 0,5 jak dawniej)
  R.spawn = function (x, y, vx, vy, life, color, size, a, grow) {
    if (this.particles.length > 900) return;
    this.particles.push({ x: x, y: y, vx: vx, vy: vy, life: life, max: life, color: color, size: size || 0.3, a: a, grow: grow });
  };
  R.addSkid = function (x1, y1, x2, y2, a, col, w) {
    this.skids.push([x1, y1, x2, y2, a, col, w]);
    if (this.skids.length > 5000) this.skids.splice(0, 500);
  };
  // Kłąb dymu opony (2D): unosi się z koła, rośnie i powoli zostaje za bolidem
  R.tyrePuff = function (x, y, c, I, wet) {
    var RN = Math.random, k = 0.25 + RN() * 0.2, v = numOr(c.v, 0);
    this.spawn(x + (RN() - 0.5) * 0.4, y + (RN() - 0.5) * 0.4, Math.cos(c.h) * v * k + (RN() - 0.5) * 1.6, Math.sin(c.h) * v * k + (RN() - 0.5) * 1.6,
      1.5 + I + RN() * 0.7, wet ? 'rgb(205,212,222)' : 'rgb(232,234,238)', 0.45 + I * 0.25, (0.3 + I * 0.35) * (wet ? 0.5 : 1), 3.2);
  };
  R.carEffects = function (S, dt) {
    var self = this, RN = Math.random, wet = !!(S.env && S.env.wet);
    if (!(dt > 0)) dt = 0;
    for (var ci = 0; ci < S.cars.length; ci++) {
      var c = S.cars[ci];
      var ch = Math.cos(c.h), sh = Math.sin(c.h), nx = -sh, ny = ch, v = numOr(c.v, 0), av = Math.abs(v);
      var rx = c.x - ch * 1.9, ry = c.y - sh * 1.9, fx = c.x + ch * 1.6, fy = c.y + sh * 1.6;
      // przednie koła: lewe po stronie −n, prawe po +n
      var flx = fx - nx * 0.8, fly = fy - ny * 0.8, frx = fx + nx * 0.8, fry = fy + ny * 0.8;
      var tar = c.surface === 'asphalt' || c.surface === 'kerb' || c.surface === 'runoff';
      var lock = c01(numOr(c.lock, 0)), side = Math.max(-1, Math.min(1, numOr(c.lockSide, 0))), spin = c01(numOr(c.wspin, 0));
      var slide = typeof c.beta === 'number' ? (av > 6 ? c01((Math.abs(c.beta) - 0.04) / 0.16) : 0) : (c.skid > 0.25 ? c.skid : 0);
      var st = c._fx2d || (c._fx2d = new Float64Array(7));
      if (st[6] === 1 && Math.hypot(rx - st[0], ry - st[1]) < 6) {
        // tył: poślizg i buksowanie
        var rearA = Math.max(slide > 0.15 ? Math.min(0.5, slide * 0.5) : 0, spin > 0.22 ? 0.2 + spin * 0.35 : 0);
        if (rearA > 0 && tar) {
          self.addSkid(st[0] + nx * 0.78, st[1] + ny * 0.78, rx + nx * 0.78, ry + ny * 0.78, rearA);
          self.addSkid(st[0] - nx * 0.78, st[1] - ny * 0.78, rx - nx * 0.78, ry - ny * 0.78, rearA);
          if (RN() < dt * (14 * slide + 30 * spin)) self.tyrePuff(rx + nx * (RN() < 0.5 ? 0.78 : -0.78), ry + ny * (RN() < 0.5 ? 0.78 : -0.78), c, Math.max(slide, spin) * 0.8, wet);
        }
        // przód: zablokowane koła (ślady i dym z każdego koła osobno)
        if (tar && av > 3) {
          var wl = lock * c01(1 - side), wr = lock * c01(1 + side);
          if (wl > 0.22) self.addSkid(st[2], st[3], flx, fly, Math.min(0.6, 0.18 + wl * 0.45), null, 0.3);
          if (wr > 0.22) self.addSkid(st[4], st[5], frx, fry, Math.min(0.6, 0.18 + wr * 0.45), null, 0.3);
          if (wl > 0.15 && RN() < dt * 40 * wl) self.tyrePuff(flx, fly, c, wl, wet);
          if (wr > 0.15 && RN() < dt * 40 * wr) self.tyrePuff(frx, fry, c, wr, wet);
        }
        if ((c.surface === 'grass' || c.surface === 'gravel') && v > 4) {
          var col = c.surface === 'grass' ? 'rgba(60,40,20,0.35)' : 'rgba(150,120,80,0.35)';
          self.addSkid(st[0] + nx * 0.78, st[1] + ny * 0.78, rx + nx * 0.78, ry + ny * 0.78, 0.4, col, 0.4);
          self.addSkid(st[0] - nx * 0.78, st[1] - ny * 0.78, rx - nx * 0.78, ry - ny * 0.78, 0.4, col, 0.4);
          var pc = c.surface === 'grass' ? '#6a8f3e' : '#cdb98e';
          for (var k = 0; k < 2; k++) self.spawn(rx + (RN() - 0.5) * 2, ry + (RN() - 0.5) * 2, -ch * v * 0.3 + (RN() - 0.5) * 8, -sh * v * 0.3 + (RN() - 0.5) * 8, 0.6 + RN() * 0.5, pc, 0.35);
        }
      }
      st[0] = rx; st[1] = ry; st[2] = flx; st[3] = fly; st[4] = frx; st[5] = fry; st[6] = 1;
      if (wet && v > 20 && RN() < 0.9) self.spawn(rx + (RN() - 0.5) * 1.5, ry + (RN() - 0.5) * 1.5, -ch * v * 0.2 + (RN() - 0.5) * 5, -sh * v * 0.2 + (RN() - 0.5) * 5, 0.5 + RN() * 0.4, 'rgba(215,225,240,0.5)', 0.9, 0.7);
      if (c.wall > 3) for (var s = 0; s < 10; s++) self.spawn(c.x, c.y, (RN() - 0.5) * 30, (RN() - 0.5) * 30, 0.4, RN() < 0.5 ? '#ffd24a' : '#ff8a2a', 0.15);
      // uszkodzenia: dym z silnika i odłamki przy nowym uszkodzeniu
      var dm = c.dmg;
      if (dm && dm.engine > 0.4 && RN() < dt * (6 + 20 * c01((dm.engine - 0.4) / 0.6))) {
        var g = Math.round(150 - 70 * c01((dm.engine - 0.4) / 0.6));
        self.spawn(rx + (RN() - 0.5) * 0.6, ry + (RN() - 0.5) * 0.6, ch * v * 0.25 + (RN() - 0.5) * 1.5, sh * v * 0.25 + (RN() - 0.5) * 1.5, 1.6 + RN() * 0.8, 'rgb(' + g + ',' + (g + 3) + ',' + (g + 8) + ')', 0.45, 0.45, 3);
      }
      var dtot = numOr(c.dmgTotal, 0), dprev = numOr(c._dmgT2d, 0);
      if (dtot > dprev + 0.015) {
        var nb = Math.min(14, 4 + Math.round((dtot - dprev) * 60)), lv = (c.team && c.team.livery && c.team.livery.primary) || '#888888';
        for (var b = 0; b < nb; b++) self.spawn(c.x + (RN() - 0.5) * 3, c.y + (RN() - 0.5) * 3, ch * v * 0.5 + (RN() - 0.5) * 12, sh * v * 0.5 + (RN() - 0.5) * 12, 0.8 + RN() * 0.7, RN() < 0.35 ? lv : '#1b1c20', 0.12 + RN() * 0.1, 1, 0);
      }
      c._dmgT2d = dtot;
    }
    var ps = this.particles;
    for (var i = ps.length - 1; i >= 0; i--) {
      var p = ps[i]; p.life -= dt; if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2; p.vy *= 1 - dt * 2;
    }
  };

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
