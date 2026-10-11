// Monza Grand Prix — geometria toru, linia wyścigowa, profil prędkości.
(function (PG) {
  'use strict';
  var DS = 2; // odstęp próbek w metrach

  function wrapI(i, n) { return ((i % n) + n) % n; }

  // Zamknięty spline Catmulla-Roma (centripetalny) przez punkty z GeoJSON
  function spline(P) {
    var n = P.length, out = [], startOf = [];
    for (var i = 0; i < n; i++) {
      var p0 = P[wrapI(i - 1, n)], p1 = P[i], p2 = P[wrapI(i + 1, n)], p3 = P[wrapI(i + 2, n)];
      var t0 = 0, t1 = t0 + Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) + 1e-6;
      var t2 = t1 + Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) + 1e-6;
      var t3 = t2 + Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) + 1e-6;
      var segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      var steps = Math.max(1, Math.ceil(segLen / 0.5));
      startOf.push(out.length);
      for (var k = 0; k < steps; k++) {
        var t = t1 + (t2 - t1) * k / steps, pt = [];
        for (var d = 0; d < 2; d++) {
          var A1 = (t1 - t) / (t1 - t0) * p0[d] + (t - t0) / (t1 - t0) * p1[d];
          var A2 = (t2 - t) / (t2 - t1) * p1[d] + (t - t1) / (t2 - t1) * p2[d];
          var A3 = (t3 - t) / (t3 - t2) * p2[d] + (t - t2) / (t3 - t2) * p3[d];
          var B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
          var B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
          pt.push((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2);
        }
        out.push({ x: pt[0], y: pt[1] });
      }
    }
    return { pts: out, startOf: startOf };
  }

  PG.buildTrack = function (def) {
    var sp = spline(def.points);
    var raw = sp.pts;
    var cum = [0];
    for (var i = 1; i <= raw.length; i++) {
      var p = raw[i - 1], q = raw[i % raw.length];
      cum.push(cum[i - 1] + Math.hypot(q.x - p.x, q.y - p.y));
    }
    var total = cum[raw.length];
    var N = Math.round(total / DS);
    var ds = total / N;
    var X = new Float64Array(N), Y = new Float64Array(N);
    var k = 0;
    for (var s = 0; s < N; s++) {
      var target = s * ds;
      while (cum[k + 1] < target) k++;
      var t = (target - cum[k]) / (cum[k + 1] - cum[k]);
      var a = raw[k], b = raw[(k + 1) % raw.length];
      X[s] = a.x + (b.x - a.x) * t; Y[s] = a.y + (b.y - a.y) * t;
    }
    // wygładzenie szumu pomiarowego bez spłaszczania szykan
    for (var pass = 0; pass < 4; pass++) {
      var X2 = new Float64Array(N), Y2 = new Float64Array(N);
      for (var i2 = 0; i2 < N; i2++) {
        var im = wrapI(i2 - 1, N), ip = wrapI(i2 + 1, N);
        X2[i2] = (X[im] + 2 * X[i2] + X[ip]) / 4; Y2[i2] = (Y[im] + 2 * Y[i2] + Y[ip]) / 4;
      }
      X = X2; Y = Y2;
    }
    (def.smooth || []).forEach(function (r) {
      var a0 = Math.round(cum[sp.startOf[r[0]]] / ds), a1 = Math.round(cum[sp.startOf[r[1] % sp.startOf.length]] / ds);
      if (a1 <= a0) a1 += N;
      for (var ps = 0; ps < r[2]; ps++) {
        var Xs = Float64Array.from(X), Ys = Float64Array.from(Y);
        for (var q2 = a0 + 1; q2 < a1; q2++) {
          var c0 = wrapI(q2, N), cm = wrapI(q2 - 1, N), cp = wrapI(q2 + 1, N);
          X[c0] = (Xs[cm] + 2 * Xs[c0] + Xs[cp]) / 4; Y[c0] = (Ys[cm] + 2 * Ys[c0] + Ys[cp]) / 4;
        }
      }
    });
    var marks = def.marks.map(function (m) { return { name: m.name, type: m.type, s: cum[sp.startOf[m.p]] }; });
    var T = {
      def: def, name: def.name, N: N, ds: ds, length: total, hw: def.halfWidth,
      x: X, y: Y,
      tx: new Float64Array(N), ty: new Float64Array(N), nx: new Float64Array(N), ny: new Float64Array(N),
      k: new Float64Array(N), barL: new Float64Array(N), barR: new Float64Array(N),
      surfL: new Uint8Array(N), surfR: new Uint8Array(N), kerbL: new Uint8Array(N), kerbR: new Uint8Array(N),
      marks: marks
    };
    for (var j = 0; j < N; j++) {
      var jp = wrapI(j + 1, N), jm = wrapI(j - 1, N);
      var dx = X[jp] - X[jm], dy = Y[jp] - Y[jm], dl = Math.hypot(dx, dy);
      T.tx[j] = dx / dl; T.ty[j] = dy / dl;
      T.nx[j] = -T.ty[j]; T.ny[j] = T.tx[j]; // normalna w prawo
    }
    for (var j2 = 0; j2 < N; j2++) {
      var a1 = Math.atan2(T.ty[wrapI(j2 + 2, N)], T.tx[wrapI(j2 + 2, N)]);
      var a0 = Math.atan2(T.ty[wrapI(j2 - 2, N)], T.tx[wrapI(j2 - 2, N)]);
      var da2 = a1 - a0; while (da2 > Math.PI) da2 -= 2 * Math.PI; while (da2 < -Math.PI) da2 += 2 * Math.PI;
      T.k[j2] = da2 / (4 * ds); // + = w prawo
    }
    T.corners = marks.filter(function (m) { return m.type === 'A'; }).map(function (m) { return { name: m.name, i: Math.round(m.s / ds) % N, s: m.s }; });
    T.straights = marks.filter(function (m) { return m.type === 'S'; }).map(function (m) { return { name: m.name, i: Math.round(m.s / ds) % N }; });
    buildRunoff(T);
    T.grid = gridSlots(T, 24);
    T.sectors = [findMark(T, 'Curva di Lesmo 1') - Math.round(120 / ds), findMark(T, 'Variante Ascari') + Math.round(250 / ds)];
    var parab = findMark(T, 'Curva Alboreto (Parabolica)'), back = findMark(T, 'Rettifilo Centrale'), ret = findMark(T, 'Variante del Rettifilo');
    var asc = findMark(T, 'Variante Ascari');
    var straightF = findMark(T, 'Rettifilo Tribune');
    T.drs = [
      { from: wrapI(straightF + Math.round(30 / ds), N), to: wrapI(ret - Math.round(100 / ds), N), detect: wrapI(parab - Math.round(30 / ds), N) },
      { from: wrapI(back + Math.round(60 / ds), N), to: wrapI(parab - Math.round(120 / ds), N), detect: wrapI(asc - Math.round(80 / ds), N) }
    ];
    // prosta startowa: ściana boksów po prawej, trybuny po lewej
    T.mainFrom = wrapI(straightF - Math.round(20 / ds), N);
    T.mainTo = wrapI(ret - Math.round(140 / ds), N);
    for (var mi = T.mainFrom; mi !== T.mainTo; mi = wrapI(mi + 1, N)) { T.barR[mi] = Math.min(T.barR[mi], T.hw + 3); T.barL[mi] = Math.min(T.barL[mi], T.hw + 6); }
    T.line = racingLine(T);
    buildGrid(T);
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (var b2 = 0; b2 < N; b2++) { minx = Math.min(minx, X[b2]); maxx = Math.max(maxx, X[b2]); miny = Math.min(miny, Y[b2]); maxy = Math.max(maxy, Y[b2]); }
    T.bbox = { minx: minx, maxx: maxx, miny: miny, maxy: maxy };
    return T;
  };

  function findMark(T, name) {
    for (var i = 0; i < T.marks.length; i++) if (T.marks[i].name === name) return Math.round(T.marks[i].s / T.ds) % T.N;
    return 0;
  }
  PG.findMark = findMark;

  function buildRunoff(T) {
    var N = T.N, ds = T.ds;
    // wygładzona krzywizna do decyzji o krawężnikach i żwirze
    var ks = new Float64Array(N);
    var win = Math.round(16 / ds);
    for (var i = 0; i < N; i++) {
      var s = 0; for (var j = -win; j <= win; j++) s += T.k[wrapI(i + j, N)];
      ks[i] = s / (2 * win + 1);
    }
    T.ks = ks;
    // surf: 0 trawa, 1 żwir, 2 asfaltowe pobocze
    var look = Math.round(140 / ds);
    for (var i2 = 0; i2 < N; i2++) {
      var kk = ks[i2];
      // krawężniki w zakrętach (z obu stron), dłuższe na wyjściu
      var kerb = Math.abs(kk) > 1 / 420;
      T.kerbL[i2] = kerb ? 1 : 0; T.kerbR[i2] = kerb ? 1 : 0;
      T.barL[i2] = 24; T.barR[i2] = 24;
    }
    // poszerzenie kerbów o kilka metrów na wejściu/wyjściu
    var kL = Uint8Array.from(T.kerbL);
    for (var i3 = 0; i3 < N; i3++) if (kL[i3]) for (var e = -6; e <= 10; e++) { T.kerbL[wrapI(i3 + e, N)] = 1; T.kerbR[wrapI(i3 + e, N)] = 1; }
    // żwir / asfalt na zewnątrz zakrętów i na prostych dobiegowych przed zakrętami
    for (var i4 = 0; i4 < N; i4++) {
      var maxK = 0, sgn = 0;
      for (var j2 = -Math.round(30 / ds); j2 <= look; j2++) {
        var v = ks[wrapI(i4 + j2, N)];
        if (Math.abs(v) > Math.abs(maxK)) { maxK = v; }
      }
      if (Math.abs(maxK) > 1 / 160) {
        sgn = maxK > 0 ? 1 : -1; // skręt w prawo -> zewnętrzna strona lewa
        var depth = Math.min(46, 18 + Math.abs(maxK) * 900);
        if (sgn > 0) { T.surfL[i4] = 1; T.barL[i4] = Math.max(T.barL[i4], depth + 6); }
        else { T.surfR[i4] = 1; T.barR[i4] = Math.max(T.barR[i4], depth + 6); }
      }
    }
    // Parabolica i Rettifilo: asfaltowe pobocza (jak dziś na Monzy)
    var par = findMark(T, 'Curva Alboreto (Parabolica)');
    for (var p = par - Math.round(80 / T.ds); p < par + Math.round(420 / T.ds); p++) { var q = wrapI(p, N); if (T.surfL[q] === 1) T.surfL[q] = 2; T.barL[q] = Math.max(T.barL[q], 44); }
    var ret = findMark(T, 'Variante del Rettifilo');
    for (var r = ret - Math.round(150 / T.ds); r < ret + Math.round(60 / T.ds); r++) { var q2 = wrapI(r, N); T.surfL[q2] = 2; T.surfR[q2] = 2; T.barL[q2] = Math.max(T.barL[q2], 38); T.barR[q2] = Math.max(T.barR[q2], 30); }
    // prosta startowa: wąskie pobocza i ściana boksów po prawej
    var startF = findMark(T, 'Rettifilo Tribune');
    // wygładzenie odległości barier
    [T.barL, T.barR].forEach(function (arr) {
      for (var pass = 0; pass < 3; pass++) {
        var c = Float64Array.from(arr);
        for (var i5 = 0; i5 < N; i5++) {
          var m = 0; for (var j5 = -12; j5 <= 12; j5++) m = Math.max(m, c[wrapI(i5 + j5, N)] - Math.abs(j5) * 0.6);
          arr[i5] = m;
        }
      }
    });
  }

  function gridSlots(T, n) {
    var out = [];
    for (var k = 0; k < n; k++) {
      var back = 10 + k * 8; // co 8 m, rzędy po dwa przesunięte
      var i = wrapI(Math.round(-back / T.ds), T.N);
      var side = (k % 2 === 0) ? -2.6 : 2.6;
      out.push({ i: i, x: T.x[i] + T.nx[i] * side, y: T.y[i] + T.ny[i] * side, h: Math.atan2(T.ty[i], T.tx[i]), lat: side });
    }
    return out;
  }

  function racingLine(T) {
    var N = T.N, lim = T.hw - 1.6;
    var o = new Float64Array(N);
    var steps = [48, 24, 12, 6, 3, 1];
    for (var si = 0; si < steps.length; si++) {
      var st = steps[si];
      var iters = si < 2 ? 120 : 80;
      for (var it = 0; it < iters; it++) {
        for (var i = 0; i < N; i++) {
          var a = wrapI(i - st, N), b = wrapI(i + st, N);
          var px = (T.x[a] + T.nx[a] * o[a] + T.x[b] + T.nx[b] * o[b]) / 2;
          var py = (T.y[a] + T.ny[a] * o[a] + T.y[b] + T.ny[b] * o[b]) / 2;
          var v = (px - T.x[i]) * T.nx[i] + (py - T.y[i]) * T.ny[i];
          o[i] = Math.max(-lim, Math.min(lim, o[i] * 0.3 + v * 0.7));
        }
      }
    }
    var L = { o: o, x: new Float64Array(N), y: new Float64Array(N), k: new Float64Array(N), ds: new Float64Array(N) };
    for (var j = 0; j < N; j++) { L.x[j] = T.x[j] + T.nx[j] * o[j]; L.y[j] = T.y[j] + T.ny[j] * o[j]; }
    for (var j2 = 0; j2 < N; j2++) {
      var jp = wrapI(j2 + 1, N);
      L.ds[j2] = Math.hypot(L.x[jp] - L.x[j2], L.y[jp] - L.y[j2]);
    }
    // krzywizna z okręgu przez trzy punkty (±4 próbki)
    for (var j3 = 0; j3 < N; j3++) {
      var A = wrapI(j3 - 7, N), B = j3, C = wrapI(j3 + 7, N);
      var ax = L.x[A], ay = L.y[A], bx = L.x[B], by = L.y[B], cx = L.x[C], cy = L.y[C];
      var cr = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      var ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ca = Math.hypot(ax - cx, ay - cy);
      L.k[j3] = 2 * cr / (ab * bc * ca);
    }
    return L;
  }

  // Profil prędkości dla parametrów bolidu (p = {power, cd, gripMul, aeroMul, brakeMul}).
  // Hamowanie i napęd dzielą przyczepność ze skrętem tak jak w PG.stepCar (koło tarcia PHYS.comb).
  PG.speedProfile = function (T, p) {
    var N = T.N, L = T.line, v = new Float64Array(N);
    var P = PG.PHYS, vmax = 110;
    var gm = p.gripMul, am = p.aeroMul || 1, bm = p.brakeMul || 1;
    var A0 = P.latA0 * gm, B = P.latB * gm * am;
    var cr = P.comb || 1.2, R2 = cr * cr;
    // ułamek przyczepności wzdłużnej, który zostaje przy krzywiźnie k i prędkości s
    function lonAvail(k, s) {
      var s2 = s * s, cap = A0 + B * s2;
      var u = cap > 0 ? k * s2 / cap : 1;
      if (u > 1) u = 1;
      var r = R2 - u * u;
      return r >= 1 ? 1 : r <= 0 ? 0 : Math.sqrt(r);
    }
    for (var i = 0; i < N; i++) {
      var k = Math.abs(L.k[i]);
      v[i] = k <= B ? vmax : Math.min(vmax, Math.sqrt(A0 / (k - B)));
    }
    for (var pass = 0; pass < 2; pass++) {
      for (var j = 2 * N - 1; j >= 0; j--) {
        var a = j % N, b = (j + 1) % N;
        var vb = v[b];
        var dec = (P.brkA0 + P.brkB * am * vb * vb) * gm * bm * lonAvail(Math.abs(L.k[b]), vb) + p.cd * vb * vb;
        var lim = Math.sqrt(vb * vb + 2 * dec * L.ds[a]);
        if (v[a] > lim) v[a] = lim;
      }
      for (var j2 = 0; j2 < 2 * N; j2++) {
        var a2 = j2 % N, b2 = (j2 + 1) % N, va = Math.max(v[a2], 1);
        var acc = Math.min((P.tracA0 + P.tracB * am * va * va) * gm * lonAvail(Math.abs(L.k[a2]), va), p.power / va) - p.cd * va * va;
        var lim2 = Math.sqrt(Math.max(0, va * va + 2 * acc * L.ds[a2]));
        if (v[b2] > lim2) v[b2] = lim2;
      }
    }
    var t = 0;
    for (var k2 = 0; k2 < N; k2++) t += L.ds[k2] / ((v[k2] + v[(k2 + 1) % N]) / 2);
    return { v: v, lapTime: t };
  };

  function buildGrid(T) {
    var cell = 30;
    T.gcell = cell;
    T.gmap = new Map();
    for (var i = 0; i < T.N; i++) {
      var key = Math.floor(T.x[i] / cell) + ',' + Math.floor(T.y[i] / cell);
      var arr = T.gmap.get(key); if (!arr) { arr = []; T.gmap.set(key, arr); }
      arr.push(i);
    }
  }

  // Najbliższa próbka (globalnie, przez siatkę). Zwraca indeks lub -1.
  PG.nearestGlobal = function (T, x, y, radiusCells) {
    var c = T.gcell, cx = Math.floor(x / c), cy = Math.floor(y / c), best = -1, bd = Infinity, r = radiusCells || 2;
    for (var gx = cx - r; gx <= cx + r; gx++) for (var gy = cy - r; gy <= cy + r; gy++) {
      var arr = T.gmap.get(gx + ',' + gy); if (!arr) continue;
      for (var j = 0; j < arr.length; j++) {
        var i = arr[j], dx = T.x[i] - x, dy = T.y[i] - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  };

  // Najbliższa próbka lokalnie wokół poprzedniego indeksu
  PG.nearestLocal = function (T, x, y, prev) {
    var best = prev, bd = Infinity;
    for (var j = -12; j <= 30; j++) {
      var i = wrapI(prev + j, T.N), dx = T.x[i] - x, dy = T.y[i] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 60 * 60) { var g = PG.nearestGlobal(T, x, y, 3); if (g >= 0) best = g; }
    return best;
  };

  PG.wrapI = wrapI;
})(PG);
