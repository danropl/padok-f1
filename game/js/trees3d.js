// WORLD GP — drzewa 3D: atlas liści i kory, geometrie gatunków, daleki LOD i materiał z kołysaniem na wietrze.
//
// Drzewo jest budowane jak prawdziwe: pień rozszerzony przy korzeniach, rozwidlenie na konary, konary zakończone
// „kłębami" liści (kępy kart z gałązkami i liśćmi z atlasu), między kłębami prześwity, w których widać gałęzie.
// Karty leżą głównie na zewnętrznej powierzchni sumy kłębów (wnętrze zasłonięte i tak nie byłoby widać), gałązką
// do środka, liśćmi na zewnątrz. Normalne kart są uśrednione z kształtu kłębu i całej korony, więc korona cieniuje
// się jak bryła złożona z kilku kłębów (jak cumulus), a nie jak płaskie talerze; wnętrze i spód są ciemniejsze.
//
// Jednostka geometrii = promień korony z mapy 2D (instancja skaluje x, z przez r, a y przez r × ry).
// Gatunki: 0 — liściaste o szerokiej koronie (lipa, dąb), 1 — liściaste o koronie jajowatej (grab, buk),
// 2 — topola włoska (kolumnowa), 3 — świerk (stożek z piętrami gałęzi).
// API: paintAtlas(C) → płótno atlasu; nearGeometry(gatunek, wariant, det 0–2); farGeometry(stożek);
// setupMaterial(mat, wiatr, { far, lod }); depthMaterial(wiatr, { lod }); SHAPES, KIND_OF, CELL.
(function (PG) {
  'use strict';
  if (typeof THREE === 'undefined') return;
  var T3 = PG.Trees3D = {};
  var PI = Math.PI, PI2 = PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function nrm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function randDir(R) { var z = R() * 2 - 1, a = R() * PI2, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; }
  function hdir(p) { var l = Math.sqrt(p[0] * p[0] + p[2] * p[2]); return l > 1e-5 ? [p[0] / l, 0, p[2] / l] : [0, 0, 0]; }

  // Gatunki: bryła korony (środek na wysokości cy, półosie sx, sy, sz — cienie na ziemi i daleki LOD),
  // cone — korona stożkowa (inny daleki LOD), tint — mnożnik barwy liści względem koloru z mapy
  T3.SHAPES = [
    { kind: 0, sx: 1.0, sy: 1.0, sz: 1.0, cy: 1.72, cone: 0, tint: [1, 1, 1] },
    { kind: 1, sx: 0.78, sy: 1.2, sz: 0.78, cy: 1.95, cone: 0, tint: [0.93, 1.02, 0.96] },
    { kind: 2, sx: 0.48, sy: 1.52, sz: 0.48, cy: 2.02, cone: 0, tint: [1.1, 1.07, 0.88] },
    { kind: 3, sx: 0.64, sy: 1.6, sz: 0.64, cy: 1.92, cone: 1, tint: [0.6, 0.78, 0.92] }
  ];
  // wariant drzewa z mapy 2D (0–5) → gatunek: 1/3 szerokie, 1/3 jajowate, 1/6 topole, 1/6 świerki
  T3.KIND_OF = [0, 1, 0, 2, 1, 3];

  // ---------- atlas ----------
  // Siatka 4 × 2 komórek (atlas 4C × 2C). DataTexture nie odwraca wierszy: wiersz 0 płótna to v = 0.
  var CELL = T3.CELL = { leafA: [0, 0], leafB: [1, 0], poplar: [2, 0], spruce: [3, 0], mass: [0, 1], bark: [1, 1], spruceFar: [2, 1], barkS: [3, 1] };
  var PAD = 0.012;
  function cu(cell, f) { return (cell[0] + PAD + f * (1 - 2 * PAD)) / 4; }
  function cv(cell, f) { return (cell[1] + PAD + f * (1 - 2 * PAD)) / 2; }

  // Liście jasne i prawie bez barwy — kolor drzewa nadaje instancja. C — bok komórki w pikselach.
  T3.paintAtlas = function (C) {
    var c = mkCanvas(4 * C, 2 * C), g = c.getContext('2d'), Q = C, R = rng(91);
    g.clearRect(0, 0, 4 * C, 2 * C);
    function col(lum, hue) {
      return 'rgb(' + Math.round(255 * clamp(lum * (0.86 + hue), 0, 1)) + ',' + Math.round(255 * clamp(lum, 0, 1)) + ',' + Math.round(255 * clamp(lum * (0.6 - hue * 0.7), 0, 1)) + ')';
    }
    function clip(ox, oy) { g.save(); g.beginPath(); g.rect(ox + 2, oy + 2, Q - 4, Q - 4); g.clip(); }
    var PXS = 1; // pikseli na jednostkę bieżącego rysunku (gałązki rysowane są w jednostkach komórki)
    // liść: ogonek w (x, y), oś w kierunku ang, długość L, połowa szerokości W; shape 1 — trójkątny (topola)
    function leaf(x, y, ang, L, W, lum, hue, shape) {
      g.save(); g.translate(x, y); g.rotate(ang);
      var gr = g.createLinearGradient(0, -W, 0, W);
      gr.addColorStop(0, col(lum * 1.06, hue)); gr.addColorStop(0.5, col(lum, hue)); gr.addColorStop(1, col(lum * 0.74, hue + 0.02));
      g.fillStyle = gr;
      g.beginPath();
      if (shape === 1) {
        g.moveTo(0, 0); g.quadraticCurveTo(L * 0.1, -W * 1.1, L * 0.4, -W * 0.95); g.quadraticCurveTo(L * 0.78, -W * 0.5, L, 0);
        g.quadraticCurveTo(L * 0.78, W * 0.5, L * 0.4, W * 0.95); g.quadraticCurveTo(L * 0.1, W * 1.1, 0, 0);
      } else {
        g.moveTo(0, 0); g.bezierCurveTo(L * 0.16, -W * 0.95, L * 0.6, -W * 1.04, L, 0); g.bezierCurveTo(L * 0.6, W * 1.04, L * 0.16, W * 0.95, 0, 0);
      }
      g.fill();
      if (L * PXS > 7) {
        g.strokeStyle = 'rgba(255,255,220,' + (0.1 + lum * 0.12).toFixed(2) + ')'; g.lineWidth = Math.max(0.6 / PXS, W * 0.12);
        g.beginPath(); g.moveTo(L * 0.05, 0); g.lineTo(L * 0.85, 0); g.stroke();
      }
      g.restore();
    }
    // gałązka z liśćmi (w jednostkach komórki): pędy od podstawy (0, 0) w górę, pędy boczne, liście naprzemiennie
    // wzdłuż pędów; całość dopasowana do komórki z marginesem (bez ucięć na brzegu), podstawa przy dolnej krawędzi
    function spray(ox, oy, P) {
      var twigs = [], leaves = [];
      function grow(x, y, ang, L, w, depth) {
        var steps = Math.max(3, Math.round(L / P.step)), px = x, py = y, a = ang, side = R() < 0.5 ? 1 : -1;
        for (var i = 1; i <= steps; i++) {
          a += (R() - 0.5) * 0.28 + P.bend * (a < -PI / 2 ? 1 : -1);
          var nx = px + Math.cos(a) * L / steps, ny = py + Math.sin(a) * L / steps, fr = i / steps;
          twigs.push([px, py, nx, ny, w * (1 - 0.6 * fr)]);
          var ll = (P.leafL[0] + R() * (P.leafL[1] - P.leafL[0])) * (1 - 0.25 * fr * fr);
          leaves.push([nx, ny, a + side * (0.5 + R() * 0.7), ll, ll * P.leafW * (0.75 + R() * 0.35), R()]);
          if (R() < P.pair) { var l2 = ll * (0.8 + R() * 0.25); leaves.push([nx, ny, a - side * (0.5 + R() * 0.7), l2, l2 * P.leafW * (0.75 + R() * 0.35), R()]); }
          side = -side;
          if (depth < 2 && i < steps - 1 && R() < (depth ? P.sub2 : P.sub1)) grow(nx, ny, a + side * (0.5 + R() * 0.5), L * (0.3 + R() * 0.3) * (1 - fr * 0.5), w * 0.7, depth + 1);
          px = nx; py = ny;
        }
        var lt = P.leafL[1]; leaves.push([px, py, a + (R() - 0.5) * 0.3, lt, lt * P.leafW, R()]);
      }
      for (var s = 0; s < P.stems; s++) {
        var a0 = -PI / 2 + (s - (P.stems - 1) / 2) * P.spread + (R() - 0.5) * 0.2;
        grow((R() - 0.5) * 0.06, 0, a0, (P.len[0] + R() * (P.len[1] - P.len[0])) * (1 - Math.abs(s - (P.stems - 1) / 2) * 0.08), P.tw, 0);
      }
      var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      function ext(x, y, m) { x0 = Math.min(x0, x - m); x1 = Math.max(x1, x + m); y0 = Math.min(y0, y - m); y1 = Math.max(y1, y + m); }
      leaves.forEach(function (l) { ext(l[0], l[1], l[4]); ext(l[0] + Math.cos(l[2]) * l[3], l[1] + Math.sin(l[2]) * l[3], l[4]); });
      twigs.forEach(function (t) { ext(t[2], t[3], t[4]); });
      var sc = Math.min(0.94 / (x1 - x0), 0.95 / (y1 - y0)) * Q;
      PXS = sc;
      clip(ox, oy);
      g.setTransform(sc, 0, 0, sc, ox + Q / 2 - sc * (x0 + x1) / 2, oy + Q * 0.975 - sc * y1);
      g.lineCap = 'round';
      // liście z tyłu (ciemniejsze), pędy, liście z przodu (jaśniejsze)
      leaves.forEach(function (l) { if (l[5] < 0.38) leaf(l[0], l[1], l[2], l[3], l[4], 0.44 + R() * 0.2, (R() - 0.5) * 0.08, P.shape); });
      twigs.forEach(function (t) { g.strokeStyle = 'rgb(92,80,64)'; g.lineWidth = Math.max(1 / sc, t[4]); g.beginPath(); g.moveTo(t[0], t[1]); g.lineTo(t[2], t[3]); g.stroke(); });
      leaves.forEach(function (l) { if (l[5] >= 0.38) leaf(l[0], l[1], l[2], l[3], l[4], 0.68 + R() * 0.32, (R() - 0.5) * 0.1, P.shape); });
      g.restore();
      PXS = 1;
    }
    // gałąź świerka: oś od podstawy do czubka, pędy boczne naprzemiennie, gęste krótkie igły
    function frond(ox, oy) {
      var bx = ox + Q * 0.5, by = oy + Q * 0.98, tipY = oy + Q * 0.05, shoots = [];
      function axis(x0, y0, ang, L, w, depth, list) {
        var steps = Math.max(4, Math.round(L / (Q * 0.03))), px = x0, py = y0, a = ang, side = 1;
        for (var i = 1; i <= steps; i++) {
          a += (R() - 0.5) * 0.08;
          var nx = px + Math.cos(a) * L / steps, ny = py + Math.sin(a) * L / steps, fr = i / steps;
          list.push([px, py, nx, ny, w * (1 - 0.7 * fr), a, depth]);
          if (depth < 2 && fr < 0.92 && (depth || i % 2 === 0)) {
            var sl = L * (depth ? 0.36 : 0.62) * (1 - fr * 0.8) * (0.8 + R() * 0.4);
            axis(nx, ny, a + side * (0.95 + R() * 0.2), sl, w * 0.55, depth + 1, list);
            side = -side;
          }
          px = nx; py = ny;
        }
      }
      axis(bx, by, -PI / 2, by - tipY, Q * 0.014, 0, shoots);
      clip(ox, oy);
      g.lineCap = 'round';
      // igły: najpierw ciemne (w głębi), pędy, potem jaśniejsze na wierzchu; końcówki pędów jaśniejsze (przyrosty)
      for (var pass = 0; pass < 2; pass++) {
        shoots.forEach(function (s) {
          var dx = s[2] - s[0], dy = s[3] - s[1], L = Math.sqrt(dx * dx + dy * dy), n = Math.max(2, Math.round(L / (Q * 0.005)));
          for (var i = 0; i < n; i++) {
            var t = (i + R()) / n, x = s[0] + dx * t, y = s[1] + dy * t;
            for (var sd = -1; sd <= 1; sd += 2) {
              if (R() < (pass ? 0.35 : 0.5)) continue;
              var na = s[5] + sd * (0.55 + R() * 0.5), nl = Q * (0.03 + R() * 0.016) * (s[6] ? 0.85 : 1);
              var lum = pass ? 0.58 + R() * 0.34 + (s[6] === 2 ? 0.1 : 0) : 0.32 + R() * 0.2;
              g.strokeStyle = col(lum, -0.05 + (R() - 0.5) * 0.04); g.lineWidth = Math.max(1, Q * 0.0045);
              g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * nl, y + Math.sin(na) * nl); g.stroke();
            }
          }
        });
        if (!pass) shoots.forEach(function (s) { g.strokeStyle = 'rgb(46,40,30)'; g.lineWidth = Math.max(1, s[4] * 0.8); g.beginPath(); g.moveTo(s[0], s[1]); g.lineTo(s[2], s[3]); g.stroke(); });
      }
      g.restore();
    }
    // zwarta masa liści (dalekie drzewa, środek korony): koło z nieregularnym brzegiem
    function mass(ox, oy) {
      var cx = ox + Q / 2, cy = oy + Q / 2;
      clip(ox, oy);
      for (var pass = 0; pass < 2; pass++) {
        var n = pass ? 260 : 220;
        for (var i = 0; i < n; i++) {
          var a = R() * PI2, rr = Q * 0.37 * Math.pow(R(), pass ? 0.75 : 0.5), x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.95;
          var L = Q * (0.055 + R() * 0.045);
          leaf(x, y, R() * PI2, L, L * 0.42, pass ? 0.62 + R() * 0.38 : 0.36 + R() * 0.22, (R() - 0.5) * 0.08, 0);
        }
      }
      g.restore();
    }
    // cały świerk z daleka: stożek z pięter zwisających gałęzi (karty dalekiego LOD)
    function spruceFar(ox, oy) {
      var cx = ox + Q / 2, top = oy + Q * 0.03, bot = oy + Q * 0.97, n = 18, i, j;
      clip(ox, oy);
      g.lineCap = 'round';
      // ciemny środek: poszarpany stożek
      g.fillStyle = col(0.24, -0.04);
      g.beginPath(); g.moveTo(cx, top + Q * 0.02);
      for (i = 0; i <= n; i++) { var tt = i / n; g.lineTo(cx + Q * 0.36 * tt * (0.85 + R() * 0.3), top + (bot - top) * tt * 0.97); }
      for (i = n; i >= 0; i--) { var t2 = i / n; g.lineTo(cx - Q * 0.36 * t2 * (0.85 + R() * 0.3), top + (bot - top) * t2 * 0.97); }
      g.closePath(); g.fill();
      // piętra gałęzi: zwisające pędy z igłami, ciemniejsze w głębi, jaśniejsze na wierzchu
      for (var pass = 0; pass < 2; pass++) {
        for (i = 0; i < n; i++) {
          var t = (i + 0.5) / n, y = top + (bot - top) * Math.pow(t, 1.08), w = Q * 0.47 * Math.min(1, 0.06 + t * 1.02);
          var k = Math.round(14 + t * 34);
          for (j = 0; j < k; j++) {
            var side = j % 2 ? 1 : -1, ex = side * w * (0.3 + 0.7 * Math.sqrt(R())), dy = Math.abs(ex) * (0.16 + R() * 0.22);
            var x1 = cx + ex, y1 = y + dy + (R() - 0.5) * Q * 0.02, lum = pass ? 0.48 + R() * 0.42 : 0.26 + R() * 0.16;
            g.strokeStyle = col(lum, -0.05 + (R() - 0.5) * 0.04); g.lineWidth = Math.max(1, Q * (pass ? 0.006 : 0.011));
            g.beginPath(); g.moveTo(cx + ex * 0.15, y + (R() - 0.5) * Q * 0.01); g.quadraticCurveTo(cx + ex * 0.6, y - Q * 0.008, x1, y1); g.stroke();
            // igły wzdłuż końca pędu
            for (var m = 0; m < 4; m++) {
              var u = 0.55 + R() * 0.45, px = cx + ex * u, py = y + (y1 - y) * u * u, ln = Q * (0.015 + R() * 0.012);
              g.beginPath(); g.moveTo(px, py); g.lineTo(px + (R() - 0.5) * ln, py + ln * (0.4 + R() * 0.6)); g.stroke();
            }
          }
        }
      }
      g.restore();
    }
    // kora: pionowe spękania na tle, jaśniejsze płytki między nimi
    function bark(ox, oy, base, dark, light, nCrack, scaly) {
      g.fillStyle = base; g.fillRect(ox, oy, Q, Q);
      for (var k = 0; k < 900; k++) {
        var x = ox + R() * Q, y = oy + R() * Q, w = 1 + R() * Q / 70, h = Q * (scaly ? 0.02 + R() * 0.04 : 0.04 + R() * 0.16);
        g.fillStyle = R() < 0.5 ? 'rgba(' + dark + ',' + (0.16 + R() * 0.3).toFixed(2) + ')' : 'rgba(' + light + ',' + (0.08 + R() * 0.16).toFixed(2) + ')';
        g.fillRect(x, y, scaly ? w * 3 : w, h);
      }
      for (var j = 0; j < nCrack; j++) {
        var x0 = ox + R() * Q, cw = 2 + R() * Q / 45;
        g.fillStyle = 'rgba(' + dark + ',' + (0.4 + R() * 0.3).toFixed(2) + ')';
        g.beginPath(); g.moveTo(x0, oy);
        for (var t = 1; t <= 12; t++) g.lineTo(x0 + (R() - 0.5) * cw * 3, oy + Q * t / 12);
        g.lineTo(x0 + cw, oy + Q);
        for (t = 12; t >= 0; t--) g.lineTo(x0 + cw + (R() - 0.5) * cw * 2, oy + Q * t / 12);
        g.closePath(); g.fill();
      }
    }
    spray(0, 0, { stems: 5, spread: 0.3, len: [0.72, 0.95], tw: 0.011, step: 0.04, bend: 0.012, leafL: [0.08, 0.12], leafW: 0.42, pair: 0.45, sub1: 0.6, sub2: 0.35, shape: 0 });
    spray(Q, 0, { stems: 6, spread: 0.34, len: [0.62, 0.86], tw: 0.009, step: 0.03, bend: 0.01, leafL: [0.06, 0.09], leafW: 0.38, pair: 0.55, sub1: 0.65, sub2: 0.4, shape: 0 });
    spray(2 * Q, 0, { stems: 6, spread: 0.18, len: [0.66, 0.9], tw: 0.008, step: 0.026, bend: 0.004, leafL: [0.05, 0.075], leafW: 0.52, pair: 0.6, sub1: 0.5, sub2: 0.25, shape: 1 });
    frond(3 * Q, 0);
    mass(0, Q);
    bark(Q, Q, '#7f756a', '40,33,27', '196,188,174', 26, false);
    spruceFar(2 * Q, Q);
    bark(3 * Q, Q, '#6e5444', '44,30,22', '170,130,104', 10, true);
    return c;
  };

  // ---------- bufor geometrii ----------
  // pozycja, normalna (cieniowania), uv (atlas), kolor (zaciemnienie albo barwa kory), aLeaf (1 = liście barwione
  // instancją), aCardN — prawdziwa normalna karty (0 dla gałęzi): karta widziana z boku znika zamiast smug
  function Buf() { this.p = []; this.n = []; this.t = []; this.c = []; this.l = []; this.cn = []; this.ix = []; this.vc = 0; }
  Buf.prototype.v = function (p, n, u, w, c, leaf, cn) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.t.push(u, w); this.c.push(c[0], c[1], c[2]); this.l.push(leaf);
    if (cn) this.cn.push(cn[0], cn[1], cn[2]); else this.cn.push(0, 0, 0);
    return this.vc++;
  };
  // gałąź: rura wzdłuż łamanej P z promieniami Rr (pierścienie bez skręcania), kora z komórki cell atlasu;
  // ao — zaciemnienie całej gałęzi (w głębi korony ciemniej)
  Buf.prototype.tube = function (P, Rr, sides, col, ao, cell) {
    var n = P.length, base = this.vc, e1 = null, acc = 0, total = 0, i, s;
    for (i = 1; i < n; i++) total += len(sub(P[i], P[i - 1]));
    for (i = 0; i < n; i++) {
      var t = nrm(sub(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]));
      if (!e1) e1 = nrm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      else e1 = nrm(sub(e1, mul(t, dot(e1, t))));
      var e2 = cross(t, e1);
      if (i) acc += len(sub(P[i], P[i - 1]));
      var shade = clamp(0.6 + Math.max(0, P[i][1]) * 0.22, 0.6, 1) * ao;
      for (s = 0; s <= sides; s++) {
        var a = s / sides * PI2, d = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
        this.v(add(P[i], mul(d, Rr[i])), d, cu(cell, s / sides), cv(cell, total > 0 ? acc / total : 0), mul(col, shade), 0);
      }
    }
    for (i = 0; i < n - 1; i++) for (s = 0; s < sides; s++) {
      var a0 = base + i * (sides + 1) + s, b0 = a0 + sides + 1;
      this.ix.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
  };
  // karta liści: środek c, normalna karty nc, bok sz, obrót rot w płaszczyźnie karty, komórka atlasu cell;
  // up — kierunek „od gałązki do liści" (rzutowany na kartę); shade(p) → [normalna cieniowania, zaciemnienie]
  Buf.prototype.card = function (c, nc, sz, rot, cell, shade, up, stretch) {
    var a2 = null;
    if (up) { a2 = sub(up, mul(nc, dot(up, nc))); a2 = len(a2) > 0.15 ? nrm(a2) : null; }
    if (!a2) a2 = nrm(cross(Math.abs(nc[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], nc));
    var a1 = cross(a2, nc), cr = Math.cos(rot), sr = Math.sin(rot);
    var b2 = add(mul(a2, cr), mul(a1, sr)), b1 = add(mul(a2, -sr), mul(a1, cr));
    var h = sz / 2, hv = h * (stretch || 1), base = this.vc, CO = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
    for (var k = 0; k < 4; k++) {
      var q = CO[k], p = add(c, add(mul(b1, q[0] * h), mul(b2, q[1] * hv)));
      var sh = shade(p, nc);
      this.v(p, sh[0], cu(cell, q[2]), cv(cell, q[3]), [sh[1], sh[1], sh[1]], 1, nc);
    }
    this.ix.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  Buf.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.l, 1));
    g.setAttribute('aCardN', new THREE.Float32BufferAttribute(this.cn, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1));
    g.computeBoundingSphere();
    g.userData.tris = this.ix.length / 3;
    this.p = this.n = this.t = this.c = this.l = this.cn = this.ix = null;
    return g;
  };

  // łamana gałęzi od a do b wygięta łukiem: bow[0] w bok, bow[1] w górę
  function bowPath(a, b, bow, n) {
    var P = [], d = sub(b, a), sd = cross(d, [0, 1, 0]);
    sd = len(sd) < 1e-6 ? [1, 0, 0] : nrm(sd);
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), k = Math.sin(PI * t);
      P.push(add(lerp3(a, b, t), add([0, bow[1] * k, 0], mul(sd, bow[0] * k))));
    }
    return P;
  }
  function taper(n, r0, r1, pw) { var R = []; for (var i = 0; i < n; i++) R.push(r0 + (r1 - r0) * Math.pow(i / (n - 1), pw || 1)); return R; }
  var BARK = [0.72, 0.68, 0.64], BARK_P = [0.95, 0.98, 0.94], BARK_S = [0.62, 0.52, 0.46];

  // Liście kłębu: N kart w elipsoidzie (środek L, półosie rad), głównie przy jej powierzchni, z pominięciem miejsc
  // głęboko w innych kłębach (others). Normalne cieniowania: kłąb (wl) + korona + karta, lekko w górę.
  // Zaciemnienie: głąb kłębu, głąb korony i spód korony.
  function lobeCards(B, R, L, rad, N, size, crown, opt, others) {
    var C = crown.c, CR = crown.r, wl = opt.wl === undefined ? 0.45 : opt.wl;
    function shade(p, nc) {
      var dl = [(p[0] - L[0]) / rad[0], (p[1] - L[1]) / rad[1], (p[2] - L[2]) / rad[2]], ll = len(dl);
      var dc = [(p[0] - C[0]) / CR[0], (p[1] - C[1]) / CR[1], (p[2] - C[2]) / CR[2]], lc = len(dc);
      var n = nrm(add(add(mul(nrm(dl), wl), mul(nrm(dc), 0.92 - wl)), add(mul(nc, 0.1), [0, opt.lift, 0])));
      var ao = (0.62 + 0.38 * clamp(ll, 0, 1)) * (0.48 + 0.52 * clamp(lc * 1.1, 0, 1)) * (0.8 + 0.2 * clamp(dc[1] * 0.6 + 0.6, 0, 1));
      return [n, clamp(ao * 1.08, 0.16, 1)];
    }
    var out = hdir(sub(L, C));
    for (var k = 0, tries = 0; k < N && tries < N * 6; tries++) {
      var d = nrm(add(randDir(R), [out[0] * opt.outB, opt.upB, out[2] * opt.outB]));
      var rr = 0.45 + 0.55 * Math.pow(R(), 0.5);
      var p = [L[0] + d[0] * rad[0] * rr, L[1] + d[1] * rad[1] * rr, L[2] + d[2] * rad[2] * rr];
      var hidden = false;
      if (others) for (var j = 0; j < others.length && !hidden; j++) {
        var o = others[j];
        if (o.c === L) continue;
        var e = [(p[0] - o.c[0]) / o.r, (p[1] - o.c[1]) / (o.r * (o.fy || 1)), (p[2] - o.c[2]) / o.r];
        if (dot(e, e) < 0.42) hidden = true;
      }
      if (hidden) continue;
      k++;
      var nc = opt.flat ? nrm(add(mul(randDir(R), 0.8), [0, opt.flat, 0])) : nrm(add(mul(d, 0.85), mul(randDir(R), 0.8)));
      B.card(p, nc, size * (0.82 + R() * 0.36), (R() - 0.5) * opt.rot, opt.cell, shade, opt.up || d, opt.stretch);
    }
  }

  // ---------- gatunki ----------
  // det: 2 — pełne (blisko kamery), 1 — średnie (mniej, większych kart, tylko główne konary), 0 — najprostsze.
  // Szkielet (pień, konary, kłęby) jest losowany niezależnie od det, więc poziomy szczegółów mają ten sam obrys.
  function broadleaf(S, seed, det) {
    var B = new Buf(), R = rng(9001 + seed * 7919 + S.kind * 104729), RC = rng(55 + seed * 31 + S.kind * 977 + det * 7);
    var cell = seed & 1 ? CELL.leafB : CELL.leafA, C = [0, S.cy, 0], CR = [S.sx, S.sy, S.sz], bottom = S.cy - S.sy;
    var sides = [4, 6, 8][det], lsides = [3, 5, 6][det];
    // pień: lekko krzywy, rozszerzony przy ziemi; rozwidlenie poniżej korony — widać rozchodzące się konary
    var hf = bottom * (S.sy > 1.05 ? 0.86 + R() * 0.1 : 0.78 + R() * 0.17), lean = [(R() - 0.5) * 0.12 * S.sx, 0, (R() - 0.5) * 0.12 * S.sz], rb = 0.058 + R() * 0.012;
    var trunk = [[0, -0.15, 0], [0, 0.04, 0], [lean[0] * 0.3 + (R() - 0.5) * 0.025, hf * 0.4, lean[2] * 0.3], [lean[0] * 0.7, hf * 0.75, lean[2] * 0.7 + (R() - 0.5) * 0.025], [lean[0], hf, lean[2]]];
    B.tube(trunk, [rb * 1.8, rb * 1.3, rb * 1.04, rb * 0.97, rb * 0.92], sides, BARK, 1, CELL.bark);
    var F = trunk[4];
    // kłęby w piętrach [wysokość względna, liczba, zasięg w bok]; brzeg kłębu przy elipsoidzie korony, dolne piętro
    // na obwodzie niżej niż przy pniu (spód korony wklęsły jak w prawdziwych drzewach)
    var tiers = S.sy > 1.05
      ? [[0.74, 1, 0], [0.42, 4, 0.95], [0.04, 5, 1], [-0.36, 5, 0.98], [-0.66, 4, 0.82]]
      : [[0.66, 1, 0], [0.32, 5, 0.95], [-0.08, 6, 1], [-0.62, 6, 1]];
    var lobes = [], a0 = R() * PI2, lr0 = 0.3 + 0.04 * S.sx;
    tiers.forEach(function (ti, tn) {
      for (var j = 0; j < ti[1]; j++) {
        var skip = ti[1] > 3 && R() < 0.1;
        var lr = lr0 * (0.85 + R() * 0.3) * (tn === 0 ? 1.25 : tn === tiers.length - 1 ? 1.15 : 1), t = clamp(ti[0] + (R() - 0.5) * 0.12, -0.9, 0.9);
        var rho = ti[1] === 1 ? R() * 0.06 : Math.max(0, ti[2] * S.sx * Math.sqrt(Math.max(0.05, 1 - t * t)) - lr * 0.78) * (0.9 + R() * 0.2);
        var a = a0 + (j + tn * 0.5) / ti[1] * PI2 + (R() - 0.5) * 0.7;
        if (!skip) lobes.push({ c: [Math.cos(a) * rho + lean[0], S.cy + t * (S.sy - lr * 0.75), Math.sin(a) * rho + lean[2]], r: lr, fy: 0.9 });
      }
    });
    // trzy główne konary od rozwidlenia w dolną część korony i przewodnik w górę
    var scaf = [], leader = [lean[0] * 1.2, S.cy + S.sy * 0.4, lean[2] * 1.2];
    for (var s = 0; s < 3; s++) {
      var as = a0 + 0.5 + s / 3 * PI2 + (R() - 0.5) * 0.6;
      var end = [lean[0] + Math.cos(as) * S.sx * 0.5, S.cy - S.sy * (0.05 + R() * 0.2), lean[2] + Math.sin(as) * S.sz * 0.5];
      var st = [F[0] + Math.cos(as) * rb * 0.35, F[1] - rb * 0.6, F[2] + Math.sin(as) * rb * 0.35];
      scaf.push({ P: bowPath(st, end, [(R() - 0.5) * 0.1, -0.06 + R() * 0.05], det === 2 ? 4 : 3), end: end });
    }
    scaf.forEach(function (sc) { B.tube(sc.P, taper(sc.P.length, rb * 0.78, rb * 0.42, 1), lsides, BARK, 0.95, CELL.bark); });
    B.tube([F, lerp3(F, leader, 0.5), leader], [rb * 0.78, rb * 0.6, rb * 0.34], lsides, BARK, 0.9, CELL.bark);
    // gałęzie do kłębów: od najbliższego końca konaru albo punktu przewodnika
    lobes.forEach(function (Lb) {
      var best = null, bd = 1e9;
      scaf.forEach(function (sc) { var d = len(sub(Lb.c, sc.end)); if (d < bd) { bd = d; best = sc.end; } });
      var lp = lerp3(F, leader, clamp((Lb.c[1] - F[1]) / (leader[1] - F[1]), 0, 1) * 0.85);
      if (len(sub(Lb.c, lp)) < bd) best = lp;
      Lb.limb = [best, lerp3(best, Lb.c, 0.8), [(R() - 0.5) * 0.1, 0.04 + R() * 0.06]];
    });
    if (det === 2) lobes.forEach(function (Lb) {
      var P = bowPath(Lb.limb[0], Lb.limb[1], Lb.limb[2], 3);
      B.tube(P, taper(3, rb * 0.36, rb * 0.1, 0.8), 4, BARK, 0.78, CELL.bark);
    });
    // liście; w środku korony kilka ciemnych kart masy liści (bez prześwitów na wylot przez sam środek)
    var crown = { c: C, r: CR }, per = [4, 5, 20][det], sz = [1.55, 1.45, 1.0][det];
    lobes.forEach(function (Lb) {
      lobeCards(B, RC, Lb.c, [Lb.r, Lb.r * Lb.fy, Lb.r], per, Lb.r * sz, crown, { cell: cell, outB: 0.5, upB: 0.22, lift: 0.2, rot: 1.2 }, lobes);
    });
    lobeCards(B, RC, [lean[0], S.cy, lean[2]], [S.sx * 0.45, S.sy * 0.45, S.sz * 0.45], [3, 4, 6][det], S.sx * 0.62, crown, { cell: CELL.mass, outB: 0, upB: 0, lift: 0.1, rot: PI2 }, null);
    return B.build();
  }

  function poplar(S, seed, det) {
    var B = new Buf(), R = rng(4001 + seed * 104729), RC = rng(77 + seed * 13 + det * 5), k;
    var H = S.cy + S.sy * 1.02, rb = 0.05 + R() * 0.01, wob = [(R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.04];
    var trunk = [[0, -0.15, 0], [0, 0.05, 0], [wob[0] * 0.3, H * 0.25, wob[2] * 0.3], [wob[0], H * 0.5, wob[2]], [wob[0] * 0.6, H * 0.75, wob[2] * 0.6], [0, H * 0.94, 0]];
    B.tube(trunk, [rb * 1.6, rb * 1.2, rb, rb * 0.78, rb * 0.48, rb * 0.08], [4, 5, 6][det], BARK_P, 1, CELL.bark);
    // krótkie gałęzie stromo w górę (tylko z bliska)
    if (det === 2) for (k = 0; k < 10; k++) {
      var t = 0.2 + (k + RC()) / 10 * 0.7, y = H * t, a = RC() * PI2, L = 0.18 + RC() * 0.14 * (1 - t * 0.5);
      var from = [wob[0] * 0.8, y, wob[2] * 0.8], to = [Math.cos(a) * L * 0.5, y + L * 0.85, Math.sin(a) * L * 0.5];
      B.tube([from, lerp3(from, to, 0.5), to], [rb * 0.3, rb * 0.18, rb * 0.04], 3, BARK_P, 0.75, CELL.bark);
    }
    // kłęby wzdłuż osi: najszersze w dolnej połowie, zwężone ku czubkowi
    var crown = { c: [0, S.cy, 0], r: [S.sx, S.sy, S.sz] }, nl = 10, lobes = [];
    for (k = 0; k < nl; k++) {
      var tt = k / (nl - 1), yy = S.cy - S.sy * 0.84 + tt * S.sy * 1.74, aa = R() * PI2, off = 0.02 + R() * 0.05;
      var w = S.sx * (0.8 + R() * 0.12) * (1 - 0.6 * tt * tt) * Math.min(1, 0.72 + tt * 2.2);
      lobes.push({ c: [Math.cos(aa) * off, yy, Math.sin(aa) * off], r: w, fy: 1.5 });
    }
    var per = [6, 8, 22][det], sz = [1.4, 1.3, 1.02][det];
    lobes.forEach(function (Lb) {
      lobeCards(B, RC, Lb.c, [Lb.r, Lb.r * Lb.fy, Lb.r], per, Lb.r * sz, crown, { cell: CELL.poplar, outB: 0.6, upB: 0.05, lift: 0.12, rot: 0.5, up: [0, 1, 0], stretch: 1.3, wl: 0.3 }, lobes);
    });
    return B.build();
  }

  function spruce(S, seed, det) {
    var B = new Buf(), R = rng(3001 + seed * 15485863), RC = rng(99 + seed * 17 + det * 3), k, j;
    var H = S.cy + S.sy, base = S.cy - S.sy, RB = S.sx, rb = 0.052 + R() * 0.01, sides = [4, 5, 7][det];
    // pień: pod koroną jasny, w koronie ciemny (w cieniu gałęzi)
    B.tube([[0, -0.15, 0], [0, 0.05, 0], [0, base + 0.05, 0]], [rb * 1.6, rb * 1.2, rb * 1.02], sides, BARK_S, 1, CELL.barkS);
    B.tube([[0, base + 0.05, 0], [0, H * 0.6, 0], [0, H * 0.85, 0], [0, H - 0.1, 0]], [rb * 1.02, rb * 0.62, rb * 0.3, rb * 0.05], sides, BARK_S, 0.42, CELL.barkS);
    // cieniowanie: stożek (normalna na zewnątrz od osi, lekko w górę), w głębi i nisko ciemniej
    function shade(p, nc) {
      var hd = hdir(p), rho = Math.sqrt(p[0] * p[0] + p[2] * p[2]), hr = clamp((p[1] - base) / (H - base), 0, 1);
      var cone = Math.max(0.05, RB * (1 - hr) + 0.04);
      var n = nrm(add(add(mul(hd, 0.85), [0, 0.3 + 0.25 * hr, 0]), mul(nc, 0.15)));
      var ao = (0.35 + 0.65 * clamp(rho / cone, 0, 1)) * (0.72 + 0.28 * hr);
      return [n, clamp(ao * 1.05, 0.15, 1)];
    }
    var levels = 15, a0 = R() * PI2, nb = [4, 5, 7][det], szk = [1.5, 1.4, 1.18][det];
    for (k = 0; k < levels; k++) {
      var t = (k + 0.3 * R()) / levels, y = base + (H - base - 0.12) * t;
      var Lr = RB * (1 - (y - base) / (H - base)) * (0.88 + R() * 0.24) + 0.06;
      if (det < 2 && k % 2 === 1 && t < 0.85) continue; // średni poziom: co drugie piętro, większe karty
      var n = t > 0.82 ? Math.min(nb, 4) : nb;
      for (j = 0; j < n; j++) {
        var a = a0 + j / n * PI2 + k * 2.4 + (RC() - 0.5) * 0.5;
        var droop = t < 0.75 ? -0.22 - RC() * 0.15 : 0.15, dir = nrm([Math.cos(a), droop, Math.sin(a)]);
        var cen = add([0, y, 0], mul(dir, Lr * 0.5)), L = Lr * szk;
        // gałąź płaska (lekko pochylona na zewnątrz) i zwisające gałązki (karta pionowa wzdłuż gałęzi)
        var nH = nrm(add([0, 1, 0], add(mul(hdir(dir), 0.35), mul(randDir(RC), 0.2))));
        B.card(cen, nH, L, (RC() - 0.5) * 0.25, CELL.spruce, shade, dir);
        if (det === 2 || j % 2 === 0) {
          var sd = nrm(cross(dir, [0, 1, 0])), nV = nrm(add(sd, mul(randDir(RC), 0.25)));
          B.card(add(cen, [0, -Lr * 0.12, 0]), nV, L * 0.9, (RC() - 0.5) * 0.2, CELL.spruce, shade, dir);
        }
      }
    }
    // czubek
    for (j = 0; j < 3; j++) {
      var an = j / 3 * PI;
      B.card([0, H - 0.16, 0], [Math.cos(an), 0, Math.sin(an)], 0.2, 0, CELL.spruce, shade, [0, 1, 0], 1.75);
    }
    return B.build();
  }

  // Geometria drzewa gatunku kind (wariant seed, szczegółowość det: 2 blisko, 1 średnio, 0 najprościej)
  T3.nearGeometry = function (kind, seed, det) {
    var S = T3.SHAPES[kind] || T3.SHAPES[0];
    det = det === 2 ? 2 : det ? 1 : 0;
    return kind === 2 ? poplar(S, seed, det) : kind === 3 ? spruce(S, seed, det) : broadleaf(S, seed, det);
  };

  // Daleki LOD w jednostkach bryły korony (kula jednostkowa; kształt gatunku nadaje macierz instancji, jej środek
  // jest w środku korony): liściaste — kłęby kart masy liści, świerk (cone) — skrzyżowane pionowe karty gałęzi
  // świerka (sylwetka stożka). Pień sięga do ziemi: dolny pierścień (aGround = 1) shader stawia na wysokości 0.
  T3.farGeometry = function (cone) {
    var B = new Buf(), R = rng(4242), k;
    if (cone) {
      var shadeC = function (p, nc) {
        var hr = clamp(p[1] * 0.5 + 0.5, 0, 1);
        return [nrm(add(add(mul(hdir(p), 0.8), [0, 0.35 + 0.2 * hr, 0]), mul(nc, 0.1))), 0.55 + 0.4 * hr];
      };
      for (k = 0; k < 3; k++) {
        var a = k / 3 * PI;
        B.card([0, 0.0, 0], [Math.cos(a), 0, Math.sin(a)], 2.0, 0, CELL.spruceFar, shadeC, [0, 1, 0], 1.04);
      }
    } else {
      var lobes = [{ c: [0, 0.4, 0], r: 0.6 }];
      for (k = 0; k < 3; k++) { var b = k / 3 * PI2 + 0.4; lobes.push({ c: [Math.cos(b) * 0.36, -0.16 + (k % 2) * 0.1, Math.sin(b) * 0.36], r: 0.66 }); }
      var crown = { c: [0, 0, 0], r: [1, 1, 1] };
      lobes.forEach(function (Lb) {
        lobeCards(B, R, Lb.c, [Lb.r, Lb.r, Lb.r], 5, Lb.r * 1.6, crown, { cell: CELL.mass, outB: 0.4, upB: 0.1, lift: 0.18, rot: PI2, wl: 0.25 }, lobes);
      });
    }
    B.tube([[0, cone ? -0.8 : -0.2, 0], [0, -1.4, 0]], cone ? [0.03, 0.06] : [0.06, 0.1], 4, cone ? BARK_S : BARK, cone ? 0.6 : 1, cone ? CELL.barkS : CELL.bark);
    var gnd = new Float32Array(B.vc);
    for (k = B.vc - 5; k < B.vc; k++) gnd[k] = 1;
    var geo = B.build();
    geo.setAttribute('aGround', new THREE.BufferAttribute(gnd, 1));
    return geo;
  };

  // ---------- materiały ----------
  // kolor instancji barwi tylko liście (aLeaf), kora zostaje w swoim kolorze
  var TREE_COLOR = [
    '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )',
    '\tvColor = vec3( 1.0 );',
    '#endif',
    '#ifdef USE_COLOR',
    '\tvColor *= color;',
    '#endif',
    '#ifdef USE_INSTANCING_COLOR',
    '\tvColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aLeaf );',
    '#endif'
  ].join('\n');
  // Kołysanie liści na wietrze (faza z położenia instancji, wyżej w koronie mocniej); daleki LOD: pień postawiony
  // na ziemi. TREE_CULL: drzewo bliżej niż uTreeLod.z od punktu (uTreeLod.x, uTreeLod.y) jest zwijane do punktu —
  // rysuje je wtedy bliższy poziom szczegółów (każde drzewo rysuje dokładnie jeden poziom).
  var TREE_WIND = [
    '#include <begin_vertex>',
    '#ifdef USE_INSTANCING',
    '\tvec3 tIp = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );',
    '\tfloat tPh = tIp.x * 0.11 + tIp.z * 0.07;',
    '#ifdef TREE_FAR',
    '\tif ( aGround > 0.5 ) transformed.y = -instanceMatrix[ 3 ][ 1 ] / max( 0.001, length( instanceMatrix[ 1 ].xyz ) ) - 0.1;',
    '\tfloat tSw = aLeaf * smoothstep( -0.6, 1.0, position.y ) * 0.4;',
    '#else',
    '\tfloat tSw = aLeaf * smoothstep( 0.4, 2.6, position.y );',
    '#endif',
    '\ttransformed.x += tSw * ( sin( uWindT * 1.3 + tPh ) * 0.014 + sin( uWindT * 3.4 + tPh * 2.0 + position.y * 3.0 ) * 0.008 );',
    '\ttransformed.z += tSw * ( cos( uWindT * 1.1 + tPh * 1.3 ) * 0.011 + sin( uWindT * 2.9 + position.x * 4.0 ) * 0.007 );',
    '#ifdef TREE_CULL',
    '\tif ( length( tIp.xz - uTreeLod.xy ) <= uTreeLod.z ) transformed = vec3( 0.0 );',
    '#endif',
    '#endif'
  ].join('\n');
  // karta widziana prawie z boku: |cos| kąta między jej normalną a kierunkiem patrzenia (gałęzie: 1)
  var TREE_FACE = [
    '#include <project_vertex>',
    '#ifdef USE_INSTANCING',
    '\tvec3 tCn = mat3( instanceMatrix ) * aCardN;',
    '#else',
    '\tvec3 tCn = aCardN;',
    '#endif',
    '\tvFace = dot( tCn, tCn ) > 1e-8 ? abs( dot( normalize( normalMatrix * tCn ), normalize( -mvPosition.xyz ) ) ) : 1.0;'
  ].join('\n');
  // ...i znika (zamiast smug z rozmytej tekstury), zanim stanie się kreską
  var TREE_FADE = '\tdiffuseColor.a *= smoothstep( 0.05, 0.28, vFace );\n#include <alphatest_fragment>';
  // normalne „kuliste": tylna strona karty nie odwraca normalnej (bez ciemnych plam)
  var NO_FLIP = '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );';
  function header(o) {
    return '#include <common>\nattribute float aLeaf;\nuniform float uWindT;\n' +
      (o.far ? '#define TREE_FAR\nattribute float aGround;\n' : '') +
      (o.lod ? '#define TREE_CULL\nuniform vec4 uTreeLod;\n' : '');
  }
  // Materiał drzew: o.far — daleki LOD (atrybut aGround), o.lod — uniform { value: Vector4 } zwijania drzew
  // rysowanych przez bliższy poziom; o.key — nazwa wariantu programu
  T3.setupMaterial = function (mat, windU, o) {
    o = o || {};
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uWindT = windU;
      if (o.lod) sh.uniforms.uTreeLod = o.lod;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', header(o) + 'attribute vec3 aCardN;\nvarying float vFace;\n')
        .replace('#include <color_vertex>', TREE_COLOR)
        .replace('#include <begin_vertex>', TREE_WIND)
        .replace('#include <project_vertex>', TREE_FACE);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFace;')
        .replace('#include <alphatest_fragment>', TREE_FADE)
        .replace('#include <normal_fragment_begin>', NO_FLIP);
    };
    mat.customProgramCacheKey = function () { return 'pgTree3' + (o.far ? 'f' : '') + (o.lod ? 'c' : ''); };
    return mat;
  };
  // Materiał cieni (mapa głębokości) z tym samym kołysaniem i zwijaniem — drzewo rzuca cień tylko z jednego poziomu.
  // Mapę liści i alphaTest three.js przepisuje z materiału siatki.
  T3.depthMaterial = function (windU, o) {
    o = o || {};
    var m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uWindT = windU;
      if (o.lod) sh.uniforms.uTreeLod = o.lod;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', header(o)).replace('#include <begin_vertex>', TREE_WIND);
    };
    m.customProgramCacheKey = function () { return 'pgTreeD' + (o.far ? 'f' : '') + (o.lod ? 'c' : ''); };
    return m;
  };
})(PG);
