// Monza Grand Prix — bolid F1 w 3D: proceduralny model ery efektu przypowierzchniowego (2022+), tylko rdzeń THREE.
// Układ lokalny: początek na ziemi między osiami, przód wzdłuż +X, +Y w górę, ±Z to boki (2D y ↔ lokalne z).
// API: build, update (v, steer, drs, brake, rain, lock, lockSide, wspin, dmg, ground), pose, setDamage, detach, setCompound,
// dispose, liveryTexture, clearCache, purge, studioEnv, snapshot, Showroom, Q, WHEELS, PARTS.
(function (PG) {
  'use strict';
  if (typeof THREE === 'undefined') return;

  var PI = Math.PI, TAU = PI * 2;
  // wymiary w metrach: osie, koła, sworzeń zwrotnicy
  var FA = 1.6, RA = -1.9, RW = 0.36, RIM = 0.229, WF = 0.305, WR = 0.405, ZF = 0.80, ZR = 0.79, KPF = 0.655;
  var DRS_PV = [-2.846, 0.928], DRS_OPEN = 0.46;
  // punkty mocowania części odpadających przy uszkodzeniach: połówka przedniego skrzydła (z = ±), zespół tylnego skrzydła
  var FWP = [2.62, 0.11, 0.14], RWP = [-2.69, 0.80, 0];
  // siłownik DRS: oś klapy w układzie zespołu skrzydła, ucho tłoczyska na klapie (układ osi klapy),
  // przegub tłoczyska w obudowie (układ zespołu skrzydła), długość tłoczyska
  var DRS_G = [DRS_PV[0] - RWP[0], DRS_PV[1] - RWP[1]], DRS_BR = [0.110, -0.108], DRS_P0 = [-2.742 - RWP[0], 0.805 - RWP[1]], ROD_L = 0.11;
  // cień kontaktowy: wymiary płaszczyzny, środek w x, wysokość nad podłożem
  var CS_LX = 6.8, CS_LZ = 2.9, CS_CX = -0.05, SH_LIFT = 0.025;

  // jakość: gęstość przekrojów, łuków, profili i kół
  var Q = {
    high: { id: 'high', st: 0.075, pst: 0.075, arc: 3, side: 3, af: 7, span: 24, wseg: 40, tube: 10, path: 40, helm: [26, 18], strut: 8, det: 2, wheel: 'full' },
    medium: { id: 'medium', st: 0.15, pst: 0.16, arc: 2, side: 2, af: 4, span: 12, wseg: 24, tube: 6, path: 20, helm: [16, 11], strut: 5, det: 1, wheel: 'lite' },
    low: { id: 'low', st: 0.4, pst: 0.45, arc: 1, side: 1, af: 2, span: 6, wseg: 12, tube: 4, path: 10, helm: [10, 7], strut: 4, det: 0, wheel: 'min' }
  };

  // ---------- drobne narzędzia ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function sq(v) { return v * v; }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function cst(v) { return function () { return v; }; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function centroid(r) { var c = [0, 0, 0]; for (var i = 0; i < r.length; i++) { c[0] += r[i][0]; c[1] += r[i][1]; c[2] += r[i][2]; } return mul(c, 1 / r.length); }
  function newell(r) {
    var n = [0, 0, 0];
    for (var i = 0; i < r.length; i++) {
      var a = r[i], b = r[(i + 1) % r.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return n;
  }
  function shade(c, f) { return PG.shade ? PG.shade(c, f) : c; }
  function lumOf(c) { var n = parseInt(String(c).slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

  // Interpolacja monotoniczna (bez przestrzeleń) przez punkty kluczowe [[x, v], ...]
  function mono(keys) {
    var k = keys.slice().sort(function (a, b) { return a[0] - b[0]; }), n = k.length, xs = [], ys = [], d = [], m = [], i;
    for (i = 0; i < n; i++) { xs.push(k[i][0]); ys.push(k[i][1]); }
    if (n === 1) return cst(ys[0]);
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (x) {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      var j = 0; while (x > xs[j + 1]) j++;
      var h = xs[j + 1] - xs[j], t = (x - xs[j]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[j] + (t3 - 2 * t2 + t) * h * m[j] + (-2 * t3 + 3 * t2) * ys[j + 1] + (t3 - t2) * h * m[j + 1];
    };
  }

  // Lista przekrojów od a do b z krokiem; punkty dodatkowe wypierają pobliskie równomierne
  function stations(a, b, step, extra) {
    var lo = Math.min(a, b), hi = Math.max(a, b), n = Math.max(1, Math.round((hi - lo) / step)), out = [], i;
    extra = (extra || []).filter(function (x) { return x > lo && x < hi; });
    for (i = 0; i <= n; i++) {
      var x = lo + (hi - lo) * i / n, near = false;
      for (var j = 0; j < extra.length; j++) if (Math.abs(extra[j] - x) < Math.min(0.012, step * 0.4) && i > 0 && i < n) near = true;
      if (!near) out.push(x);
    }
    out = out.concat(extra).sort(function (p, q) { return p - q; });
    var res = [];
    out.forEach(function (x) { if (!res.length || x - res[res.length - 1] > 1e-4) res.push(x); });
    return a > b ? res.reverse() : res;
  }

  // ---------- budowa geometrii ----------
  function mkGeo(p, idx) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Powierzchnia rozpięta na pierścieniach (każdy o tej samej liczbie punktów). Zwraca {grupa: geometria}.
  // o: open (pierścień otwarty), flat (ostre krawędzie wzdłuż pierścienia), group(s, j), capStart/capEnd (grupa lub true), capStartFlip, flip
  function loft(rings, o) {
    o = o || {};
    var S = rings.length, M = rings[0].length, closed = !o.open, segs = closed ? M : M - 1, s, j;
    var cs = rings.map(centroid), flip = o.flip;
    if (flip === undefined) {
      var acc = 0;
      for (s = 0; s < S - 1; s++) for (j = 0; j < segs; j++) {
        var a = rings[s][j], b = rings[s][(j + 1) % M], d = rings[s + 1][j];
        var n = cross(sub(b, a), sub(d, a)), mc = mul(add3(cs[s], cs[s + 1]), 0.5);
        acc += dot(n, sub(mul(add3(add3(a, b), d), 1 / 3), mc));
      }
      flip = acc < 0;
    }
    var out = {};
    function G(k) { return out[k] || (out[k] = { p: [], i: [], m: {} }); }
    function V(g, s, j, seg) {
      var key = o.flat ? s + ':' + j + ':' + seg : s + ':' + j, v = g.m[key];
      if (v === undefined) { var p = rings[s][j]; v = g.p.length / 3; g.p.push(p[0], p[1], p[2]); g.m[key] = v; }
      return v;
    }
    for (s = 0; s < S - 1; s++) for (j = 0; j < segs; j++) {
      var g = G(o.group ? o.group(s, j) : 0), j2 = (j + 1) % M;
      var va = V(g, s, j, j), vb = V(g, s, j2, j), vc = V(g, s + 1, j2, j), vd = V(g, s + 1, j, j);
      if (flip) g.i.push(va, vc, vb, va, vd, vc); else g.i.push(va, vb, vc, va, vc, vd);
    }
    function cap(ri, dir, k) {
      var r = rings[ri], g = G(k), c = cs[ri], base = g.p.length / 3, i;
      g.p.push(c[0], c[1], c[2]);
      for (i = 0; i < M; i++) g.p.push(r[i][0], r[i][1], r[i][2]);
      var rev = dot(newell(r), dir) < 0;
      for (i = 0; i < M; i++) { var i2 = (i + 1) % M; if (rev) g.i.push(base, base + 1 + i2, base + 1 + i); else g.i.push(base, base + 1 + i, base + 1 + i2); }
    }
    if (o.capStart !== undefined && o.capStart !== false) cap(0, mul(sub(cs[0], cs[1]), o.capStartFlip ? -1 : 1), o.capStart === true ? 0 : o.capStart);
    if (o.capEnd !== undefined && o.capEnd !== false) cap(S - 1, sub(cs[S - 1], cs[S - 2]), o.capEnd === true ? 0 : o.capEnd);
    var res = {};
    for (var key in out) res[key] = mkGeo(out[key].p, out[key].i);
    return res;
  }
  function loft1(rings, o) { return loft(rings, o)[0]; }

  // Odbicie lustrzane względem płaszczyzny z = 0 (z odwróceniem kolejności wierzchołków)
  function mirrorZ(g) {
    var m = g.clone(), p = m.attributes.position, n = m.attributes.normal, i;
    for (i = 0; i < p.count; i++) { p.setZ(i, -p.getZ(i)); if (n) n.setZ(i, -n.getZ(i)); }
    if (!m.index) { var c = p.count, ix = []; for (i = 0; i < c; i++) ix.push(i); m.setIndex(ix); }
    var a = m.index.array;
    for (i = 0; i < a.length; i += 3) { var t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    return m;
  }

  // Scalanie geometrii (pozycja, normalna, uv) w jedną indeksowaną
  function merge(list) {
    var nv = 0, ni = 0;
    list = list.filter(Boolean);
    if (!list.length) return null;
    list.forEach(function (g) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
    var P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    var vo = 0, io = 0;
    list.forEach(function (g) {
      if (!g.attributes.normal) g.computeVertexNormals();
      var c = g.attributes.position.count, i;
      P.set(g.attributes.position.array.subarray(0, c * 3), vo * 3);
      N.set(g.attributes.normal.array.subarray(0, c * 3), vo * 3);
      if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, c * 2), vo * 2);
      if (g.index) { var ix = g.index.array; for (i = 0; i < g.index.count; i++) I[io + i] = ix[i] + vo; io += g.index.count; }
      else { for (i = 0; i < c; i++) I[io + i] = vo + i; io += c; }
      vo += c;
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    out.setIndex(new THREE.BufferAttribute(I, 1));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }

  // ---------- atlas malowania ----------
  // Płótno 1024x1024: rejon A (wiersze 0..383) = malowanie z góry, rejon B (384..767) = kolor drugi + malowanie ręczne,
  // dalej próbki kolorów. Tekstura ma repeat (1, HA/H), więc UV u=(x+2.9)/5.8, v=(z+1.05)/2.1 trafia w rejon A.
  var LIV = { W: 1024, H: 1024, HA: 384, SW: 128 }, LA = LIV.HA / LIV.H;
  var S_P = 0, S_S = 1, S_A = 2, S_BLK = 3, S_WHT = 4, S_PD = 5, S_SL = 6, S_AD = 7, S_CK = 8, S_INL = 9, S_GRY = 10;
  function swatchUV(k) { return [((k % 8) + 0.5) / 8, (2 * LIV.HA + (Math.floor(k / 8) + 0.5) * LIV.SW) / LIV.H / LA]; }
  function uvPaint(g, mode, ox, oz) {
    var p = g.attributes.position, n = p.count, uv = new Float32Array(n * 2), i, sw = typeof mode === 'number' ? swatchUV(mode) : null;
    ox = ox || 0; oz = oz || 0;
    for (i = 0; i < n; i++) {
      if (sw) { uv[i * 2] = sw[0]; uv[i * 2 + 1] = sw[1]; continue; }
      uv[i * 2] = clamp((p.getX(i) + ox + 2.9) / 5.8, 0.002, 0.998);
      uv[i * 2 + 1] = clamp((p.getZ(i) + oz + 1.05) / 2.1, 0.004, 0.996) + (mode === 'B' ? 1 : 0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  // UV dla włókna węglowego: rzut z dominującej osi normalnej
  function uvTri(g, k) {
    var p = g.attributes.position, nr = g.attributes.normal, n = p.count, uv = new Float32Array(n * 2), i;
    k = k || 1 / 0.07;
    for (i = 0; i < n; i++) {
      var ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i)), u, v;
      if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (az >= ax) { u = p.getX(i); v = p.getY(i); } else { u = p.getZ(i); v = p.getY(i); }
      uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  // Worek części: materiał → lista [geometria, tryb UV]
  function Bag(low) { this.m = {}; this.low = low; }
  Bag.prototype.add = function (mat, g, uv) {
    if (!g) return;
    if (this.low && mat === 'dark') mat = 'carbon';
    (this.m[mat] = this.m[mat] || []).push([g, uv]);
  };
  Bag.prototype.add2 = function (mat, g, uv) { this.add(mat, g, uv); this.add(mat, mirrorZ(g), uv); };
  Bag.prototype.lofts = function (res, map, both) {
    for (var k in res) { var t = map[k] || map[0]; if (both) this.add2(t[0], res[k], t[1]); else this.add(t[0], res[k], t[1]); }
  };
  Bag.prototype.build = function (mat) {
    var L = this.m[mat];
    if (!L) return null;
    L.forEach(function (e) {
      if (e[1] === 'tri') uvTri(e[0]);
      else if (e[1] !== undefined && e[1] !== 'keep') uvPaint(e[0], e[1]);
    });
    return merge(L.map(function (e) { return e[0]; }));
  };

  // ---------- profile i pierścienie ----------
  // Profil skrzydła (NACA z ugięciem w dół): pierścień [c, t], c=0 krawędź natarcia
  function airfoil(n, th, cam) {
    var up = [], lo = [], i, R = [];
    for (i = 0; i <= n; i++) {
      var c = 0.5 - 0.5 * Math.cos(i / n * PI);
      var yt = 5 * th * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c * c * c - 0.1036 * c * c * c * c);
      var yc = -cam * 4 * c * (1 - c);
      up.push([c, yc + Math.max(yt, 0.004)]); lo.push([c, yc - Math.max(yt, 0.004)]);
    }
    for (i = n; i >= 0; i--) R.push(up[i]);
    for (i = 1; i < n; i++) R.push(lo[i]);
    return R;
  }
  // Element skrzydła wzdłuż rozpiętości z; f(z) → {x, y (krawędź natarcia), c (cięciwa), a (kąt, spływ wyżej)}
  function wingEl(prof, zs, f, o) {
    var rings = zs.map(function (z) {
      var e = f(z), ca = Math.cos(e.a), sa = Math.sin(e.a);
      return prof.map(function (p) { var c = p[0] * e.c, t = p[1] * e.c; return [e.x - c * ca + t * sa, e.y + c * sa + t * ca, z]; });
    });
    return loft1(rings, o || { capStart: true, capEnd: true });
  }
  function spanZs(half, n) { var z = []; for (var i = 0; i <= n; i++) z.push(half * Math.sin(-PI / 2 + PI * i / n)); return z; }
  // Cienka płyta wzdłuż x (np. płyta boczna): przekroje prostokątne y0..y1 przy z ± t
  function plateX(xs, fy0, fy1, fz, t) {
    return loft1(xs.map(function (x) { var y0 = fy0(x), y1 = Math.max(fy1(x), y0 + 0.003), z = fz(x); return [[x, y0, z - t], [x, y0, z + t], [x, y1, z + t], [x, y1, z - t]]; }), { flat: true, capStart: true, capEnd: true });
  }
  // Cienka płyta wzdłuż y (płyta tylnego skrzydła): przekroje x0..x1 przy z ± t
  function plateY(ys, fx0, fx1, fz, t) {
    return loft1(ys.map(function (y) { var x0 = fx0(y), x1 = fx1(y), z = fz(y); return [[x0, y, z - t], [x1, y, z - t], [x1, y, z + t], [x0, y, z + t]]; }), { flat: true, capStart: true, capEnd: true });
  }
  // Zaokrąglony prostokąt w płaszczyźnie y-z przy danym x
  function rrRing(x, zc, w, y0, y1, r, n) {
    var pts = [], C = [[w - r, y1 - r, 0], [-(w - r), y1 - r, PI / 2], [-(w - r), y0 + r, PI], [w - r, y0 + r, 1.5 * PI]];
    C.forEach(function (c) { for (var i = 0; i <= n; i++) { var a = c[2] + i / n * PI / 2; pts.push([x, c[1] + r * Math.sin(a), zc + c[0] + r * Math.cos(a)]); } });
    return pts;
  }
  function circRing(x, yc, zc, r, n) { var p = []; for (var i = 0; i < n; i++) { var a = i / n * TAU; p.push([x, yc + r * Math.sin(a), zc + r * Math.cos(a)]); } return p; }
  function ellProf(a, b, n, ov) { var p = []; for (var i = 0; i < n; i++) { var t = i / n * TAU; p.push([a * Math.cos(t), (ov || 0) + b * Math.sin(t)]); } return p; }
  function rectProf(w, h) { return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; }
  // Przesunięcie pierścienia do środka (wlot): o d metrów albo o ułamek frac odległości od środka
  function shrink(ring, d, dx, frac) {
    var c = centroid(ring);
    return ring.map(function (p) {
      var vy = c[1] - p[1], vz = c[2] - p[2], L = Math.sqrt(vy * vy + vz * vz) || 1, k = frac ? frac : Math.min(d, L * 0.9) / L;
      return [p[0] + dx, p[1] + vy * k, p[2] + vz * k];
    });
  }
  // Rura/listwa po krzywej: profil [h, v] (v ≈ w górę, h = T × V)
  function sweepCurve(curve, prof, u0, u1, n, o) {
    var rings = [], Vp = [0, 1, 0];
    for (var i = 0; i <= n; i++) {
      var u = lerp(u0, u1, i / n), P = curve.getPointAt(u), Tt = curve.getTangentAt(u), T = [Tt.x, Tt.y, Tt.z];
      var V = sub([0, 1, 0], mul(T, T[1]));
      V = len(V) < 0.05 ? Vp : norm(V); Vp = V;
      var H = norm(cross(T, V));
      rings.push(prof.map(function (q) { return [P.x + H[0] * q[0] + V[0] * q[1], P.y + H[1] * q[0] + V[1] * q[1], P.z + H[2] * q[0] + V[2] * q[1]]; }));
    }
    return loft1(rings, o || { capStart: true, capEnd: true });
  }
  function sweep(pts, prof, n, o, closedCurve) {
    var c = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), !!closedCurve, 'centripetal');
    return sweepCurve(c, prof, 0, 1, n, o);
  }
  // Opływowy drążek (wahacz, popychacz) od a do b: elipsa z cięciwą wzdłuż ±X
  function strut(a, b, cw, th, n) {
    var d = norm(sub(b, a)), p = sub([1, 0, 0], mul(d, d[0]));
    if (len(p) < 0.25) p = sub([0, 1, 0], mul(d, d[1]));
    p = norm(p);
    var q = cross(d, p);
    function ring(c) { var r = []; for (var i = 0; i < n; i++) { var t = i / n * TAU; r.push(add3(c, add3(mul(p, Math.cos(t) * cw / 2), mul(q, Math.sin(t) * th / 2)))); } return r; }
    return loft1([ring(a), ring(b)], { capStart: true, capEnd: true });
  }
  function box(x0, x1, y0, y1, z0, z1) {
    var g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  }

  // ---------- kadłub: nos, kokpit, pokrywa silnika ----------
  var SPN = {
    w: mono([[-2.14, 0.075], [-2.0, 0.115], [-1.85, 0.14], [-1.3, 0.2], [-0.6, 0.27], [-0.15, 0.32], [0.3, 0.335], [0.6, 0.33], [0.85, 0.312], [1.0, 0.285], [1.2, 0.24], [1.5, 0.195], [1.75, 0.168], [2.2, 0.132], [2.5, 0.108], [2.66, 0.085], [2.74, 0.058], [2.775, 0.024]]),
    yt: mono([[-2.14, 0.40], [-1.8, 0.47], [-1.4, 0.55], [-0.9, 0.62], [-0.4, 0.67], [0.0, 0.70], [0.3, 0.688], [0.6, 0.675], [0.95, 0.65], [1.3, 0.585], [1.6, 0.52], [1.9, 0.43], [2.2, 0.335], [2.5, 0.25], [2.66, 0.207], [2.74, 0.182], [2.775, 0.158]]),
    yb: mono([[-2.14, 0.2], [-1.9, 0.1], [-1.5, 0.07], [0.8, 0.07], [1.1, 0.12], [1.45, 0.165], [2.0, 0.158], [2.5, 0.127], [2.74, 0.108], [2.775, 0.114]]),
    tr: mono([[-2.14, 0.6], [-1.5, 0.55], [-0.3, 0.55], [-0.05, 0.93], [0.9, 0.93], [1.3, 0.86], [2.0, 0.8], [2.775, 0.75]]),
    rt: mono([[-2.14, 0.85], [-0.3, 0.75], [-0.05, 0.13], [0.95, 0.13], [1.3, 0.3], [2.0, 0.6], [2.775, 0.75]]),
    cw: mono([[0.0, 0.215], [0.15, 0.238], [0.4, 0.245], [0.7, 0.232], [0.85, 0.2], [0.96, 0.14]])
  };
  var CK_Y = 0.33;
  function dipAt(x) { return x > 0.02 && x < 0.96 ? 1 : 0; }
  // Prawa połowa przekroju (z ≥ 0) od środka spodu do środka góry; 4 ostatnie punkty tworzą wycięcie kokpitu
  function spineHalf(x, q) {
    var w = SPN.w(x), yt = SPN.yt(x), yb = SPN.yb(x), wt = w * SPN.tr(x), rt = Math.min(wt * SPN.rt(x), (yt - yb) * 0.45);
    var rb = Math.min(0.035, w * 0.3, (yt - yb) * 0.22), ys = yb + (yt - yb) * 0.4, R = [], i, t, a;
    R.push([0, yb], [(w - rb) * 0.5, yb]);
    for (i = 0; i <= q.arc; i++) { a = i / q.arc * PI / 2; R.push([w - rb + rb * Math.sin(a), yb + rb - rb * Math.cos(a)]); }
    var y0 = Math.max(ys, yb + rb + 0.003), y1 = yt - rt;
    R.push([w, y0]);
    for (i = 1; i <= q.side; i++) { t = i / q.side; R.push([w - (w - wt) * t * t, y0 + (y1 - y0) * t]); }
    for (i = 1; i <= q.arc; i++) { a = i / q.arc * PI / 2; R.push([wt - rt + rt * Math.cos(a), yt - rt + rt * Math.sin(a)]); }
    var tz = wt - rt, dip = dipAt(x), cw = SPN.cw(x), cr = 0.012, top = [];
    function crown(z) { return yt + cr * (1 - sq(clamp(z / tz, 0, 1))); }
    for (i = 1; i <= 4; i++) { var z = tz * (1 - i / 4); top.push([z, crown(z)]); }
    if (dip > 0) {
      var ck = [[cw + 0.016, crown(cw + 0.016)], [cw, yt - 0.014], [cw - 0.008, CK_Y + 0.05], [0, CK_Y]];
      for (i = 0; i < 4; i++) top[i] = [lerp(top[i][0], ck[i][0], dip), lerp(top[i][1], ck[i][1], dip)];
    }
    return R.concat(top);
  }
  function fullRing(x, half, zc) {
    var ring = [], i;
    for (i = 0; i < half.length; i++) ring.push([x, half[i][1], (zc || 0) + half[i][0]]);
    for (i = half.length - 2; i >= 1; i--) ring.push([x, half[i][1], (zc || 0) - half[i][0]]);
    return ring;
  }
  function buildSpine(B, q) {
    var xs = stations(-2.14, 2.775, q.st, [0.019, 0.021, 0.959, 0.961, 2.7, 2.74, 2.76, -2.1, -2.05]);
    var rings = [], dips = [], L = 0;
    xs.forEach(function (x) { var h = spineHalf(x, q); L = h.length; rings.push(fullRing(x, h)); dips.push(dipAt(x)); });
    var res = loft(rings, { capStart: true, capEnd: true, group: function (s, j) { return (j >= L - 4 && j <= L + 1 && Math.max(dips[s], dips[s + 1]) > 0.5) ? 'ck' : 0; } });
    B.lofts(res, { 0: ['paint', 'A'], ck: ['paint', S_CK] });
    return res[0];
  }
  // Wysokość górnej powierzchni kadłuba w punkcie (x, z) — do naklejki z numerem
  function spineTopY(x, z) {
    var h = spineHalf(x, Q.high), best = null;
    for (var i = h.length - 1; i > 0; i--) {
      var a = h[i], b = h[i - 1];
      if (z >= a[0] && z <= b[0]) { var t = (z - a[0]) / ((b[0] - a[0]) || 1); best = lerp(a[1], b[1], t); break; }
    }
    return best === null ? SPN.yt(x) : best;
  }

  // ---------- sekcje boczne z wlotami i podcięciem ----------
  var POD = {
    zo: mono([[-1.8, 0.2], [-1.62, 0.31], [-1.35, 0.44], [-0.95, 0.6], [-0.5, 0.735], [0.0, 0.785], [0.35, 0.785], [0.5, 0.765], [0.6, 0.735]]),
    yt: mono([[-1.8, 0.23], [-1.6, 0.30], [-1.3, 0.37], [-0.9, 0.45], [-0.5, 0.53], [-0.1, 0.595], [0.3, 0.625], [0.6, 0.62]]),
    zi: mono([[-1.8, 0.09], [-1.5, 0.11], [-0.6, 0.17], [-0.2, 0.2], [0.2, 0.27], [0.6, 0.345]]),
    yl: mono([[-1.8, 0.11], [-1.2, 0.17], [-0.6, 0.27], [0.0, 0.35], [0.6, 0.44]]),
    zu: mono([[-1.8, 0.17], [-1.2, 0.34], [-0.6, 0.47], [0.0, 0.5], [0.3, 0.52], [0.6, 0.56]])
  };
  function podRing(x, q, front) {
    var zo = POD.zo(x), yt = POD.yt(x), zi = POD.zi(x), yl = POD.yl(x), zu = POD.zu(x), yb = 0.062;
    var r = Math.min(0.065, (yt - yl) * 0.4), dr = 1 - sstep(0.36, 0.6, x), P = [], i, a;
    P.push([zi, yt - 0.03], [lerp(zi, zo, 0.45), yt + 0.006], [zo - r, yt]);
    for (i = 1; i <= q.arc; i++) { a = i / q.arc * PI / 2; P.push([zo - r + r * Math.sin(a), yt - r + r * Math.cos(a)]); }
    P.push([zo, lerp(yt - r, yl, 0.55)], [zo - 0.008, yl + 0.022], [zo - 0.04, yl]);
    var lo = [[zu + 0.06, yl - 0.045], [zu, (yl + yb) * 0.5], [zu + 0.015, yb], [zi + 0.02, yb], [zi, yb + 0.03]];
    var fr = [[lerp(zo - 0.04, zi, 0.25), yl], [lerp(zo - 0.04, zi, 0.5), yl], [lerp(zo - 0.04, zi, 0.75), yl], [zi + 0.02, yl], [zi, yl + 0.02]];
    for (i = 0; i < 5; i++) P.push([lerp(fr[i][0], lo[i][0], dr), lerp(fr[i][1], lo[i][1], Math.pow(dr, 0.7))]);
    return P.map(function (p) { return [x + (front ? (p[1] - 0.53) * 0.3 : 0), p[1], p[0]]; });
  }
  function buildPods(B, q) {
    var xs = stations(0.6, -1.8, q.pst, [0.36, 0.5, 0.56]);
    var rings = xs.map(function (x, i) { return podRing(x, q, i === 0); });
    var fr = rings[0];
    rings.unshift(shrink(fr, 0, -0.16, 0.55), shrink(fr, 0.016, -0.012));
    var res = loft(rings, { capStart: 'inl', capStartFlip: true, capEnd: true, group: function (s) { return s === 0 ? 'inl' : 0; } });
    B.lofts(res, { 0: ['paint', 'A'], inl: ['paint', S_INL] }, true);
    return res[0];
  }

  // ---------- airbox nad głową, pałąk, płetwa ----------
  var ABX = {
    yt: mono([[0.075, 0.95], [0.0, 0.958], [-0.25, 0.952], [-0.5, 0.915], [-0.8, 0.835], [-1.1, 0.735], [-1.4, 0.635], [-1.7, 0.535], [-2.0, 0.43]]),
    w: mono([[0.075, 0.098], [-0.2, 0.104], [-0.6, 0.1], [-1.0, 0.088], [-1.5, 0.07], [-2.0, 0.05]]),
    yb: mono([[0.045, 0.6], [-1.0, 0.5], [-2.0, 0.3]])
  };
  function airRing(x, q, mouth) {
    var yt = ABX.yt(x), w = ABX.w(x), yb = mouth ? 0.775 : ABX.yb(x), wb = mouth ? w : w * 1.3, yc = yt - w, P = [], i, a, n = q.arc + 1;
    P.push([0, yb], [wb, yb], [lerp(wb, w, 0.6), lerp(yb, yc, 0.6)], [w, yc]);
    for (i = 1; i <= n; i++) { a = i / n * PI / 2; P.push([w * Math.cos(a), yc + w * Math.sin(a)]); }
    var r = fullRing(x, P);
    if (mouth) r.forEach(function (p) { p[0] += (p[1] - 0.86) * 0.25; });
    return r;
  }
  function buildAirbox(B, q) {
    var xs = stations(0.045, -2.0, q.st, [0.0, -0.25]);
    var rings = [airRing(0.075, q, true)].concat(xs.map(function (x) { return airRing(x, q, false); }));
    var fr = rings[0];
    rings.unshift(shrink(fr, 0, -0.2, 0.6), shrink(fr, 0.012, -0.01));
    var res = loft(rings, { capStart: 'inl', capStartFlip: true, capEnd: true, group: function (s) { return s === 0 ? 'inl' : 0; } });
    B.lofts(res, { 0: ['paint', 'A'], inl: ['paint', S_INL] });
    // płetwa rekina
    var h = mono([[-1.62, 0.004], [-1.56, 0.062], [-1.2, 0.072], [-0.7, 0.045], [-0.34, 0.004]]), t = 0.004;
    var fx = stations(-0.34, -1.62, q.det ? 0.1 : 0.42);
    B.add('paint', loft1(fx.map(function (x) { var y0 = ABX.yt(x) - 0.012, y1 = ABX.yt(x) + h(x); return [[x, y0, -t], [x, y0, t], [x, y1, t], [x, y1, -t]]; }), { flat: true, capStart: true, capEnd: true }), 'A');
    // kamera T na szczycie airboxa
    var cam = wingEl(airfoil(Math.max(2, q.af - 2), 0.3, 0), stations(-0.075, 0.075, 0.075), function () { return { x: 0.055, y: 0.982, c: 0.11, a: 0 }; });
    B.add('paint', cam, S_A);
    B.add('paint', box(-0.03, 0.015, 0.94, 0.98, -0.012, 0.012), S_A);
  }

  // ---------- kokpit: zagłówek, kierownica ----------
  function buildCockpit(B, q) {
    var path = [[0.54, 0.648, 0.208], [0.3, 0.652, 0.214], [0.17, 0.656, 0.17], [0.13, 0.66, 0.0], [0.17, 0.656, -0.17], [0.3, 0.652, -0.214], [0.54, 0.648, -0.208]];
    var prof = q.det ? ellProf(0.03, 0.045, 8) : rectProf(0.055, 0.08);
    B.add('paint', sweep(path, prof, q.det ? 24 : 6), S_GRY);
    if (!q.det) return;
    var sw = box(-0.016, 0.016, -0.055, 0.055, -0.12, 0.12);
    sw.rotateZ(0.55); sw.translate(0.72, 0.56, 0);
    B.add('carbon', sw, 'tri');
    var disp = box(-0.003, 0.003, -0.025, 0.03, -0.05, 0.05);
    disp.rotateZ(0.55); disp.translate(0.70, 0.56, 0);
    B.add('paint', disp, S_BLK);
    [1, -1].forEach(function (s) { B.add('paint', strut([0.71, 0.5, 0.115 * s], [0.735, 0.615, 0.12 * s], 0.03, 0.03, 6), S_BLK); });
  }

  // ---------- halo, lusterka ----------
  function buildHalo(B, q, darkHalo) {
    var pts = [[0.04, 0.655, -0.245], [0.06, 0.745, -0.25], [0.14, 0.802, -0.256], [0.42, 0.826, -0.255], [0.7, 0.836, -0.205], [0.86, 0.841, -0.11], [0.925, 0.843, 0]];
    var all = pts.concat(pts.slice(0, -1).reverse().map(function (p) { return [p[0], p[1], -p[2]]; }));
    var curve = new THREE.CatmullRomCurve3(all.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    B.add('dark', sweepCurve(curve, ellProf(0.026, 0.021, q.tube), 0, 1, q.path * 2));
    if (q.det) {
      var fair = [], n = q.tube, i;
      for (i = 0; i <= n; i++) { var a = i / n * PI; fair.push([0.036 * Math.cos(a), 0.012 + 0.014 * Math.sin(a)]); }
      fair.push([-0.03, 0.006], [0.03, 0.006]);
      B.add(darkHalo ? 'dark' : 'paint', sweepCurve(curve, fair, 0.1, 0.9, q.path * 2), 'A');
    }
    // przedni słupek halo
    var py = stations(0.6, 0.845, 0.08), pr = airfoil(Math.max(2, q.af - 2), 0.45, 0);
    var pyl = loft1(py.map(function (y) { var t = (y - 0.6) / 0.245, xc = lerp(1.0, 0.925, t); return pr.map(function (p) { return [xc + 0.04 - p[0] * 0.08, y, p[1] * 0.08]; }); }), { capStart: true, capEnd: true });
    B.add(darkHalo ? 'dark' : 'paint', pyl, 'A');
  }
  function buildMirrors(B, q) {
    if (!q.det && q.id === 'low') return;
    var zs = stations(0.4, 0.6, q.det > 1 ? 0.025 : 0.1), n = q.det > 1 ? 3 : 1;
    var rings = zs.map(function (z) {
      var t = (z - 0.5) / 0.1, k = 1 - 0.35 * Math.pow(Math.abs(t), 3);
      return rrRing(0, 0, 0.036 * k, -0.026 * k, 0.026 * k, 0.014 * k, n).map(function (p) { return [0.655 + p[2], 0.705 + p[1], z]; });
    });
    B.add2('paint', loft1(rings, { capStart: true, capEnd: true }), 'A');
    B.add2('dark', box(0.611, 0.618, 0.684, 0.726, 0.415, 0.585));
    B.add2('carbon', strut([0.655, 0.69, 0.43], [0.7, 0.645, 0.27], 0.03, 0.012, 5), 'tri');
    B.add2('carbon', strut([0.645, 0.685, 0.57], [0.56, 0.6, 0.62], 0.03, 0.012, 5), 'tri');
  }

  // ---------- przednie skrzydło: dwie połówki (prawa +z, lewa −z) — razem w nadwoziu, osobno przy uszkodzeniu ----------
  function buildFrontWing(q) {
    var half = 0.972, m = Math.max(2, Math.ceil(q.span / 2)), zs = [], i;
    for (i = 0; i <= m; i++) zs.push(half * Math.sin(PI / 2 * i / m));
    var E = [
      { x: 2.82, dx: -0.05, y: 0.07, dy: 0.012, rise: 0.02, c: 0.19, dc: -0.03, a: 3, da: 4, th: 0.075, cam: 0.05 },
      { x: 2.66, dx: -0.07, y: 0.105, dy: 0.02, rise: 0.03, c: 0.135, dc: 0, a: 12, da: 6, th: 0.07, cam: 0.06 },
      { x: 2.55, dx: -0.09, y: 0.15, dy: 0.025, rise: 0.04, c: 0.115, dc: 0, a: 24, da: 6, th: 0.065, cam: 0.06 },
      { x: 2.46, dx: -0.1, y: 0.205, dy: 0.025, rise: 0.045, c: 0.1, dc: 0, a: 36, da: 4, th: 0.06, cam: 0.06 }
    ];
    if (!q.det) E = [E[0], { x: 2.64, dx: -0.08, y: 0.11, dy: 0.02, rise: 0.04, c: 0.3, dc: 0, a: 26, da: 4, th: 0.06, cam: 0.05 }];
    var R = new Bag(false), L = new Bag(false);
    // prawa połówka wprost, lewa jako odbicie (UV liczone osobno, bo malowanie bywa niesymetryczne)
    function put(g, uv) { R.add('paint', g, uv); L.add('paint', mirrorZ(g), uv); }
    E.forEach(function (e, k) {
      put(wingEl(airfoil(q.af, e.th, e.cam), zs, function (z) {
        var s = Math.abs(z) / half;
        return { x: e.x + e.dx * s * s, y: e.y + e.dy * s + e.rise * sstep(0.72, 1, s), c: e.c + e.dc * s, a: (e.a + e.da * s) * PI / 180 };
      }), k < 2 ? 'B' : 'A');
    });
    var top = mono([[2.36, 0.355], [2.5, 0.33], [2.65, 0.27], [2.78, 0.19], [2.82, 0.145], [2.845, 0.1]]);
    var xs = stations(2.36, 2.845, q.det ? 0.04 : 0.24);
    put(plateX(xs, cst(0.045), top, cst(0.975), 0.006), 'B');
    put(plateX(xs, top, function (x) { return top(x) + 0.022; }, cst(0.975), 0.006), S_A);
    if (q.det) put(plateX(stations(2.42, 2.84, 0.21), cst(0.045), cst(0.054), cst(0.95), 0.025), 'B');
    return { R: R.build('paint'), L: L.build('paint') };
  }

  // ---------- tylne skrzydło (zespół zdejmowany), belka, DRS z siłownikiem ----------
  // Obudowa siłownika DRS na środku płata głównego (obejmuje szczyt pylonu)
  var PODD = {
    yt: mono([[-2.81, 0.792], [-2.79, 0.806], [-2.75, 0.813], [-2.70, 0.811], [-2.66, 0.802], [-2.63, 0.783]]),
    yb: mono([[-2.81, 0.74], [-2.79, 0.705], [-2.75, 0.695], [-2.70, 0.70], [-2.66, 0.725], [-2.63, 0.765]]),
    w: mono([[-2.81, 0.004], [-2.79, 0.018], [-2.75, 0.025], [-2.70, 0.024], [-2.66, 0.018], [-2.63, 0.004]])
  };
  function drsPod(q) {
    var n = q.det > 1 ? 12 : q.det ? 8 : 6, xs = stations(-2.63, -2.81, q.det ? 0.02 : 0.045);
    return loft1(xs.map(function (x) {
      var yt = PODD.yt(x), yb = PODD.yb(x), w = PODD.w(x), yc = (yt + yb) / 2, ry = (yt - yb) / 2, r = [], i;
      for (i = 0; i < n; i++) { var a = i / n * TAU; r.push([x, yc + ry * Math.sin(a), w * Math.cos(a)]); }
      return r;
    }), { capStart: true, capEnd: true });
  }
  // Tłoczysko: walec od 0 w dół do −ROD_L (górny koniec w uchu klapy)
  function rodGeo(q) {
    var g = new THREE.CylinderGeometry(0.0055, 0.0055, ROD_L, q.det > 1 ? 10 : 6, 1);
    g.translate(0, -ROD_L / 2, 0);
    return g;
  }
  // Zwraca {main: płaty + płyty + obudowa (układ bolidu), flap: klapa z uchem (układ osi klapy), lights: światła na płytach (układ zespołu)}
  function buildRearWing(B, q) {
    var half = 0.536, zs = spanZs(half, q.span), RB = new Bag(false);
    RB.add('paint', wingEl(airfoil(q.af, 0.09, 0.06), zs, function (z) {
      var s = Math.abs(z) / half;
      return { x: -2.6, y: 0.785 - 0.012 * (1 - s * s) - 0.05 * sstep(0.84, 1, s), c: 0.24, a: (10 + 4 * sstep(0.7, 1, s)) * PI / 180 };
    }), 'B');
    // klapa DRS w układzie osi obrotu (przy krawędzi spływu) + ucho tłoczyska pod krawędzią natarcia
    var flap = wingEl(airfoil(q.af, 0.075, 0.05), zs, function (z) {
      var s = Math.abs(z) / half;
      return { x: -2.70 - DRS_PV[0], y: 0.835 - 0.012 * (1 - s * s) - 0.04 * sstep(0.84, 1, s) - DRS_PV[1], c: 0.17, a: 32 * PI / 180 };
    });
    uvPaint(flap, 'A', DRS_PV[0], 0);
    var clev = box(DRS_BR[0] - 0.011, DRS_BR[0] + 0.011, DRS_BR[1] - 0.002, DRS_BR[1] + 0.016, -0.012, 0.012);
    uvPaint(clev, S_BLK);
    var flapGeo = merge([flap, clev]);
    // płyty boczne
    var fx0 = mono([[0.32, -2.47], [0.55, -2.53], [0.8, -2.565], [0.9, -2.6], [0.93, -2.66]]);
    var fx1 = mono([[0.32, -2.78], [0.5, -2.9], [0.93, -2.93]]);
    var fz = function (y) { return 0.5 + 0.04 * sstep(0.32, 0.6, y); };
    var ys = q.det ? stations(0.32, 0.93, 0.05, [0.6, 0.88, 0.91]) : [0.32, 0.6, 0.93];
    RB.add2('paint', plateY(ys, fx0, fx1, fz, 0.007), 'B');
    RB.add2('paint', plateY([0.93, 0.942, 0.955], function (y) { return lerp(-2.66, -2.72, (y - 0.93) / 0.025); }, cst(-2.93), fz, 0.007), S_A);
    // obudowa siłownika DRS (czarny lakier)
    RB.add('paint', drsPod(q), S_BLK);
    // światła deszczowe na płytach bocznych (od razu w układzie zespołu)
    var lights = q.det ? merge([1, -1].map(function (s) {
      return box(-2.939 - RWP[0], -2.926 - RWP[0], 0.6 - RWP[1], 0.8 - RWP[1], s * 0.5375 - 0.0045, s * 0.5375 + 0.0045);
    })) : null;
    // pylon (łabędzia szyja) i belka zostają na bolidzie
    var py = stations(0.47, 0.8, q.det ? 0.06 : 0.33);
    B.add('carbon', loft1(py.map(function (y) { var t = (y - 0.47) / 0.33, xc = lerp(-2.36, -2.69, t); return [[xc + 0.05, y, 0], [xc, y, 0.009], [xc - 0.05, y, 0], [xc, y, -0.009]]; }), { capStart: true, capEnd: true }), 'tri');
    if (q.det) {
      var bz = spanZs(0.44, Math.max(4, q.span >> 1));
      B.add('carbon', wingEl(airfoil(q.af, 0.09, 0.05), bz, function () { return { x: -2.43, y: 0.43, c: 0.11, a: 8 * PI / 180 }; }), 'tri');
      B.add('carbon', wingEl(airfoil(q.af, 0.08, 0.05), bz, function () { return { x: -2.53, y: 0.468, c: 0.1, a: 24 * PI / 180 }; }), 'tri');
      B.add2('carbon', box(-2.6, -2.42, 0.4, 0.5, 0.435, 0.45), 'tri');
    }
    return { main: RB.build('paint'), flap: flapGeo, lights: lights };
  }

  // ---------- podłoga, dyfuzor, skrzynia biegów, wydech ----------
  function buildFloor(B, q) {
    var R = [[1.12, 0], [1.14, 0.3], [1.08, 0.62], [0.92, 0.8], [0.6, 0.86], [-0.3, 0.86], [-0.95, 0.845], [-1.25, 0.78], [-1.45, 0.66], [-1.56, 0.57], [-1.95, 0.555], [-1.95, 0]];
    var pts = R.concat(R.slice(1, -1).reverse().map(function (p) { return [p[0], -p[1]]; }));
    var g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); })), { depth: 0.022, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(PI / 2); g.translate(0, 0.058, 0);
    g.deleteAttribute('uv'); g.computeVertexNormals();
    B.add('carbon', g, 'tri');
    B.add('carbon', box(-1.6, 1.0, 0.026, 0.037, -0.15, 0.15), 'tri');
    // krawędź podłogi
    B.add2('carbon', sweep([[0.95, 0.075, 0.785], [0.62, 0.075, 0.857], [-0.3, 0.075, 0.857], [-0.95, 0.075, 0.842], [-1.25, 0.075, 0.777], [-1.42, 0.075, 0.67]], rectProf(0.008, 0.04), q.det ? 24 : 6, { flat: true, capStart: true, capEnd: true }), 'tri');
    if (!q.det) return;
    // skrzydełko krawędzi podłogi z podporami
    B.add2('carbon', wingEl(airfoil(q.af, 0.08, 0.06), stations(0.6, 0.835, q.det > 1 ? 0.04 : 0.12), function (z) {
      var s = (z - 0.6) / 0.235; return { x: 1.05 - 0.08 * s, y: 0.105 + 0.035 * s, c: 0.17, a: 14 * PI / 180 };
    }), 'tri');
    B.add2('carbon', plateX(stations(0.82, 1.06, 0.12), cst(0.058), mono([[0.82, 0.1], [0.95, 0.165], [1.06, 0.12]]), cst(0.832), 0.004), 'tri');
    B.add2('carbon', plateX(stations(0.86, 1.07, 0.1), cst(0.058), mono([[0.86, 0.09], [1.0, 0.14], [1.07, 0.12]]), cst(0.6), 0.004), 'tri');
    // płetwy pod podłogą (wloty kanałów Venturiego)
    [0.24, 0.36, 0.48].forEach(function (z0) {
      var xs = stations(0.62, 1.1, 0.12);
      B.add2('carbon', loft1(xs.map(function (x) { var u = (1.1 - x) / 0.48, z = z0 + 0.1 * u * u, y1 = 0.07 + 0.08 * (1 - u); return [[x, 0.05, z - 0.004], [x, 0.05, z + 0.004], [x, y1, z + 0.004], [x, y1, z - 0.004]]; }), { flat: true, capStart: true, capEnd: true }), 'tri');
    });
  }
  function diffRoof(x, z) { var t = clamp((-1.95 - x) / 0.71, 0, 1); return 0.058 + 0.27 * Math.pow(t, 1.4) + 0.05 * t * (1 - sstep(0.1, 0.22, Math.abs(z))); }
  function buildDiffuser(B, q) {
    var xs = stations(-1.95, -2.66, q.det ? 0.08 : 0.71), nz = q.det > 1 ? 13 : q.det ? 7 : 3;
    var rings = xs.map(function (x) {
      var top = [], bot = [], i;
      for (i = 0; i <= nz; i++) { var z = -0.5 + i / nz; top.push([x, diffRoof(x, z) + 0.012, z]); bot.push([x, diffRoof(x, z), z]); }
      return top.concat(bot.reverse());
    });
    B.add('carbon', loft1(rings, { capStart: true, capEnd: true }), 'tri');
    B.add2('carbon', plateX(xs, cst(0.036), function (x) { return diffRoof(x, 0.5) + 0.012; }, cst(0.5), 0.006), 'tri');
    if (q.det) [0.17, 0.34].forEach(function (z) {
      B.add2('carbon', plateX(stations(-2.05, -2.66, 0.1), cst(0.04), function (x) { return diffRoof(x, z) + 0.002; }, cst(z), 0.004), 'tri');
    });
  }
  var GBX = { w: mono([[-1.7, 0.15], [-2.2, 0.11], [-2.6, 0.08], [-2.88, 0.055]]), y0: mono([[-1.7, 0.1], [-2.2, 0.2], [-2.6, 0.27], [-2.88, 0.285]]), y1: mono([[-1.7, 0.44], [-2.2, 0.43], [-2.6, 0.39], [-2.88, 0.365]]) };
  function buildGearbox(B, q) {
    var xs = stations(-1.7, -2.88, q.det ? 0.1 : 0.6);
    B.add('carbon', loft1(xs.map(function (x) { return rrRing(x, 0, GBX.w(x), GBX.y0(x), GBX.y1(x), 0.03, Math.max(1, q.arc - 1)); }), { capStart: true, capEnd: true }), 'tri');
    // wydech: rura z ciemnym wnętrzem
    var n = q.det > 1 ? 14 : q.det ? 10 : 6, yc = 0.462;
    var rings = [circRing(-2.34, yc, 0, 0.034, n), circRing(-2.432, yc, 0, 0.036, n), circRing(-2.432, yc, 0, 0.043, n), circRing(-2.42, yc, 0, 0.045, n), circRing(-1.9, yc, 0, 0.045, n)];
    var res = loft(rings, { capStart: 'in', capStartFlip: true, capEnd: true, group: function (s) { return s < 1 ? 'in' : 0; } });
    B.add('dark', res[0]); B.add('paint', res['in'], S_INL);
  }

  // ---------- zawieszenie i kanały hamulcowe ----------
  function buildSusp(B, q) {
    var n = q.strut, F = [], R = [];
    var UF = [FA, 0.515, 0.635], LF = [1.62, 0.175, 0.665], UR = [RA, 0.51, 0.6], LR = [RA, 0.16, 0.62];
    F.push([[1.82, 0.43, 0.12], UF, 0.05, 0.018], [[1.35, 0.53, 0.19], UF, 0.05, 0.018]);
    F.push([[1.98, 0.19, 0.11], LF, 0.05, 0.018], [[1.28, 0.16, 0.19], LF, 0.05, 0.018]);
    R.push([[-1.7, 0.42, 0.12], UR, 0.05, 0.018], [[-2.12, 0.4, 0.1], UR, 0.05, 0.018]);
    R.push([[-1.62, 0.12, 0.14], LR, 0.05, 0.018], [[-2.1, 0.2, 0.1], LR, 0.05, 0.018]);
    if (q.det) {
      F.push([[1.58, 0.2, 0.62], [1.5, 0.47, 0.15], 0.042, 0.022]);
      F.push([[1.72, 0.3, 0.14], [1.7, 0.3, 0.63], 0.035, 0.014]);
      R.push([[-1.88, 0.49, 0.58], [-1.74, 0.14, 0.14], 0.042, 0.022]);
      R.push([[-2.08, 0.32, 0.1], [-2.04, 0.33, 0.6], 0.035, 0.014]);
      R.push([[-1.9, 0.33, 0.1], [-1.9, 0.36, 0.58], 0.055, 0.055]);
    }
    F.concat(R).forEach(function (s) { B.add2('carbon', strut(s[0], s[1], s[2], s[3], n), 'tri'); });
    // tylne zwrotnice z kanałami hamulcowymi
    var hn = q.det > 1 ? 18 : 10;
    if (q.det) {
      B.add2('carbon', loft1([circRing(0, RW, 0, 0.12, hn), circRing(0, RW, 0, 0.12, hn)].map(function (r, i) { return r.map(function (p) { return [RA + (p[2]), p[1], i ? 0.645 : 0.53]; }); }), { capStart: true, capEnd: true }), 'tri');
      B.add2('carbon', box(-2.06, -1.76, 0.49, 0.505, 0.52, 0.64), 'tri');
      B.add2('carbon', box(-1.93, -1.87, 0.15, 0.53, 0.585, 0.63), 'tri');
    }
  }
  // Część obracana ze skrętem: zwrotnica, bęben kanału hamulcowego, deflektor nad oponą (układ: oś sworznia)
  function frontHub(q) {
    var parts = [], hn = q.det > 1 ? 18 : 10;
    parts.push(loft1([-0.055, 0.045].map(function (z) { return circRing(0, 0, 0, 0.115, hn).map(function (p) { return [p[2], p[1], z]; }); }), { capStart: true, capEnd: true }));
    parts.push(box(0.09, 0.17, -0.06, 0.0, -0.05, 0.03));
    parts.push(strut([0, -0.19, -0.012], [0, 0.155, -0.02], 0.05, 0.03, 6));
    if (q.det) {
      var arc = [], i, N = q.det > 1 ? 12 : 6;
      for (i = 0; i <= N; i++) { var b = (40 + 85 * i / N) * PI / 180; arc.push([0.405 * Math.cos(b), 0.405 * Math.sin(b), 0.02]); }
      parts.push(sweep(arc, rectProf(0.1, 0.008), N * 2, { flat: true, capStart: true, capEnd: true }));
      parts.push(strut([0.0, 0.1, -0.02], [0.0, 0.405, -0.02], 0.05, 0.008, 4));
    }
    parts.forEach(function (g) { g.computeVertexNormals && !g.attributes.normal && g.computeVertexNormals(); });
    var gR = merge(parts.map(function (g) { return g.index ? g : g; }));
    uvTri(gR);
    return { R: gR, L: mirrorZ(gR) };
  }

  // ---------- kierowca: kask i numer ----------
  function buildDriver(B, q) {
    var hs = new THREE.SphereGeometry(0.125, q.helm[0], q.helm[1]);
    hs.scale(1.08, 1.0, 0.92); hs.rotateZ(-0.1); hs.translate(0.36, 0.735, 0);
    var uv = hs.attributes.uv;
    for (var i = 0; i < uv.count; i++) uv.setY(i, 0.5 + uv.getY(i) * 0.5);
    B.add('driver', hs, 'keep');
    if (q.id === 'low') return;
    // naklejka z numerem na nosie (dopasowana do powierzchni)
    var nx = q.det > 1 ? 10 : 5, nz = q.det > 1 ? 8 : 4, x0 = 2.03, x1 = 2.31, zw = 0.075, p = [], ix = [], u = [], a, b;
    for (a = 0; a <= nx; a++) for (b = 0; b <= nz; b++) {
      var x = lerp(x0, x1, a / nx), z = lerp(zw, -zw, b / nz);
      var y = spineTopY(x, Math.abs(z)), yx = spineTopY(x + 0.01, Math.abs(z)), yz = spineTopY(x, Math.abs(z) + 0.01);
      var nrm = norm([-(yx - y) / 0.01, 1, -(yz - y) / 0.01 * (z < 0 ? -1 : 1)]);
      p.push(x + nrm[0] * 0.003, y + nrm[1] * 0.003, z + nrm[2] * 0.003);
      u.push(b / nz, 0.48 - (x - x0) / (x1 - x0) * 0.46);
    }
    for (a = 0; a < nx; a++) for (b = 0; b < nz; b++) {
      var i0 = a * (nz + 1) + b, i1 = i0 + 1, i2 = i0 + nz + 1, i3 = i2 + 1;
      ix.push(i0, i1, i3, i0, i3, i2);
    }
    var dg = mkGeo(p, ix);
    // kontrola kierunku normalnych (w górę)
    if (dg.attributes.normal.getY(0) < 0) { var A = dg.index.array; for (i = 0; i < A.length; i += 3) { var t = A[i + 1]; A[i + 1] = A[i + 2]; A[i + 2] = t; } dg.computeVertexNormals(); }
    dg.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    B.add('driver', dg, 'keep');
  }

  // ---------- światła (środkowe; światła na płytach skrzydła są w zespole tylnego skrzydła) ----------
  function buildLights(B) {
    B.add('rain', box(-2.905, -2.872, 0.298, 0.352, -0.05, 0.05));
  }

  // ---------- koło (opona, felga, osłona, tarcza) — tokarka z atlasem UV ----------
  // seg: [{p: [[r, z], ...], v0, v1}] — v w wierszach atlasu (0..256)
  function lathe(segs, n) {
    var P = [], N = [], U = [], I = [];
    segs.forEach(function (sg) {
      var pts = sg.p, m = pts.length, L = [0], i, k;
      for (i = 1; i < m; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      var nr = [];
      for (i = 0; i < m; i++) {
        var a = pts[Math.max(0, i - 1)], b = pts[Math.min(m - 1, i + 1)], dr = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dr, dz) || 1;
        nr.push([dz / l, -dr / l]);
      }
      var base = P.length / 3;
      for (i = 0; i < m; i++) {
        var v = lerp(sg.v0, sg.v1, L[i] / (L[m - 1] || 1)) / 256;
        for (k = 0; k <= n; k++) {
          var ph = k / n * TAU, c = Math.cos(ph), s = Math.sin(ph);
          P.push(pts[i][0] * c, pts[i][0] * s, pts[i][1]);
          N.push(nr[i][0] * c, nr[i][0] * s, nr[i][1]);
          U.push(1 - k / n, v);
        }
      }
      for (i = 0; i < m - 1; i++) for (k = 0; k < n; k++) {
        var a0 = base + i * (n + 1) + k, b0 = a0 + 1, c0 = a0 + n + 1 + 1, d0 = a0 + n + 1;
        I.push(a0, b0, c0, a0, c0, d0);
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  }
  function wheelGeo(W, q) {
    var hw = W / 2, R = RW, Rr = RIM, S = [], lv = q.wheel;
    if (lv === 'full') {
      S.push({ p: [[Rr - 0.012, hw - 0.05], [Rr - 0.012, -hw + 0.03]], v0: 246, v1: 252 });
      S.push({ p: [[Rr - 0.012, -hw + 0.03], [Rr + 0.004, -hw + 0.018], [Rr + 0.012, -hw + 0.014]], v0: 164, v1: 180 });
      S.push({ p: [[Rr + 0.012, -hw + 0.014], [Rr + 0.05, -hw + 0.001], [0.3, -hw - 0.003], [0.333, -hw + 0.006]], v0: 158, v1: 130 });
      S.push({ p: [[0.333, -hw + 0.006], [0.348, -hw + 0.02], [0.357, -hw + 0.045], [R, -hw + 0.08], [R + 0.002, 0], [R, hw - 0.08], [0.357, hw - 0.045], [0.348, hw - 0.02], [0.333, hw - 0.006]], v0: 2, v1: 40 });
      S.push({ p: [[0.333, hw - 0.006], [0.3, hw + 0.003], [Rr + 0.05, hw - 0.001], [Rr + 0.012, hw - 0.014]], v0: 44, v1: 120 });
      S.push({ p: [[Rr + 0.012, hw - 0.014], [Rr + 0.002, hw - 0.012], [Rr - 0.016, hw - 0.016]], v0: 180, v1: 164 });
      S.push({ p: [[Rr - 0.016, hw - 0.016], [Rr - 0.032, hw - 0.024], [0.12, hw - 0.03], [0.06, hw - 0.032]], v0: 188, v1: 216 });
      S.push({ p: [[0.06, hw - 0.032], [0.05, hw - 0.018], [0.03, hw - 0.012], [0.0005, hw - 0.012]], v0: 220, v1: 230 });
      S.push({ p: [[0.0005, hw - 0.05], [Rr - 0.012, hw - 0.05]], v0: 252, v1: 255 });
      var d0 = -hw + 0.06, d1 = d0 + 0.032;
      S.push({ p: [[0.165, d0], [0.165, d1]], v0: 234, v1: 242 }, { p: [[0.165, d1], [0.07, d1]], v0: 234, v1: 242 }, { p: [[0.07, d1], [0.07, d0]], v0: 234, v1: 242 }, { p: [[0.07, d0], [0.165, d0]], v0: 242, v1: 234 });
    } else if (lv === 'lite') {
      S.push({ p: [[Rr - 0.012, hw - 0.05], [Rr - 0.012, -hw + 0.025], [Rr + 0.012, -hw + 0.014]], v0: 246, v1: 170 });
      S.push({ p: [[Rr + 0.012, -hw + 0.014], [0.3, -hw - 0.003], [0.34, -hw + 0.012]], v0: 158, v1: 130 });
      S.push({ p: [[0.34, -hw + 0.012], [0.357, -hw + 0.045], [R, -hw + 0.08], [R, hw - 0.08], [0.357, hw - 0.045], [0.34, hw - 0.012]], v0: 2, v1: 40 });
      S.push({ p: [[0.34, hw - 0.012], [0.3, hw + 0.003], [Rr + 0.012, hw - 0.014]], v0: 44, v1: 120 });
      S.push({ p: [[Rr + 0.012, hw - 0.014], [Rr - 0.016, hw - 0.016]], v0: 180, v1: 166 });
      S.push({ p: [[Rr - 0.016, hw - 0.016], [0.06, hw - 0.03], [0.0005, hw - 0.014]], v0: 190, v1: 228 });
      S.push({ p: [[0.0005, hw - 0.05], [Rr - 0.012, hw - 0.05]], v0: 252, v1: 255 });
      var e0 = -hw + 0.06;
      S.push({ p: [[0.165, e0], [0.165, e0 + 0.03], [0.07, e0 + 0.03]], v0: 234, v1: 242 }, { p: [[0.07, e0], [0.165, e0]], v0: 242, v1: 234 });
    } else {
      S.push({ p: [[Rr, -hw + 0.02], [0.33, -hw], [R, -hw + 0.06], [R, hw - 0.06], [0.33, hw], [Rr, hw - 0.02]], v0: 140, v1: 100 });
      S.push({ p: [[Rr, hw - 0.02], [0.0005, hw - 0.03]], v0: 176, v1: 214 });
      S.push({ p: [[0.0005, -hw + 0.04], [Rr, -hw + 0.02]], v0: 248, v1: 250 });
    }
    return lathe(S, q.wseg);
  }

  // ---------- geometria współdzielona (pamięć podręczna według jakości) ----------
  // Nakładka z otarciami: kopia powierzchni kadłuba i sekcji bocznych odsunięta o 1,5 mm, UV z rzutu osiowego
  function scuffGeo(list) {
    return merge(list.map(function (g) {
      var c = g.clone(), p = c.attributes.position, n = c.attributes.normal, i;
      for (i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * 0.0015, p.getY(i) + n.getY(i) * 0.0015, p.getZ(i) + n.getZ(i) * 0.0015);
      uvTri(c, 1 / 0.6);
      return c;
    }));
  }

  var GEO = {};
  function getGeo(qn, darkHalo) {
    var key = qn + (darkHalo ? '|d' : '');
    if (GEO[key]) return GEO[key];
    var q = Q[qn], B = new Bag(qn === 'low');
    var spine = buildSpine(B, q), pods = buildPods(B, q);
    buildAirbox(B, q); buildCockpit(B, q); buildHalo(B, q, darkHalo); buildMirrors(B, q);
    var fw = buildFrontWing(q), rw = buildRearWing(B, q);
    buildFloor(B, q); buildDiffuser(B, q); buildGearbox(B, q);
    buildSusp(B, q); buildDriver(B, q); buildLights(B);
    // nadwozie bez skrzydeł (po uszkodzeniu) i pełne (jedna siatka, gdy bolid jest cały)
    var body = B.build('paint'), full = merge([body, fw.R, fw.L, rw.main]);
    // części ruchome: geometria w układzie własnego punktu mocowania
    fw.R.translate(-FWP[0], -FWP[1], -FWP[2]); fw.L.translate(-FWP[0], -FWP[1], FWP[2]);
    rw.main.translate(-RWP[0], -RWP[1], -RWP[2]);
    var wf = wheelGeo(WF, q), wr = wheelGeo(WR, q);
    var wfl = wf.clone(); wfl.rotateY(PI);
    var wrl = wr.clone(); wrl.rotateY(PI);
    var r1 = wr.clone(); r1.translate(0, 0, ZR);
    var r2 = wrl.clone(); r2.translate(0, 0, -ZR);
    var G = {
      paint: full, paintBody: body, carbon: B.build('carbon'), dark: B.build('dark'), driver: B.build('driver'), rain: B.build('rain'),
      fwR: fw.R, fwL: fw.L, rwMain: rw.main, rwLights: rw.lights, drs: rw.flap, rod: rodGeo(q),
      wheelFR: wf, wheelFL: wfl, wheelRear: merge([r1, r2]), wheelRR: wr, wheelRL: wrl, hub: q.det ? frontHub(q) : null,
      scuff: scuffGeo([spine, pods, mirrorZ(pods)])
    };
    [wf, wfl, wr, wrl].forEach(function (g) { g.computeBoundingSphere(); });
    GEO[key] = G;
    return G;
  }

  // ---------- tekstury ----------
  function texCommon(t, srgb) {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
  var SHARED = {};
  // Splot skośny 2/2 włókna węglowego (wiązki z widocznymi włóknami i szczelinami)
  function carbonTex() {
    if (SHARED.ctex) return SHARED.ctex;
    var c = mkCanvas(256, 256), g = c.getContext('2d'), n = 16, s = 16, i, j, k;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var hor = ((i + j) & 3) < 2, x = i * s, y = j * s;
      var gr = hor ? g.createLinearGradient(x, y, x, y + s) : g.createLinearGradient(x, y, x + s, y);
      gr.addColorStop(0, hor ? '#17181b' : '#101113'); gr.addColorStop(0.5, hor ? '#393b41' : '#292b30'); gr.addColorStop(1, hor ? '#17181b' : '#101113');
      g.fillStyle = gr; g.fillRect(x, y, s, s);
      g.fillStyle = hor ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.035)';
      for (k = 2; k < s; k += 3) { if (hor) g.fillRect(x, y + k, s, 1); else g.fillRect(x + k, y, 1, s); }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      if (hor) g.fillRect(x, y + s - 1, s, 1); else g.fillRect(x + s - 1, y, 1, s);
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    SHARED.ctex = texCommon(t, true);
    return SHARED.ctex;
  }
  // Węgiel: lakier bezbarwny tylko na 'high', na 'medium' zwykły PBR z teksturą, na 'low' jednolity
  function carbonMat(qn) {
    var k = 'carbon_' + qn;
    if (SHARED[k]) return SHARED[k];
    SHARED[k] = qn === 'high' ? new THREE.MeshPhysicalMaterial({ map: carbonTex(), roughness: 0.42, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.9 })
      : qn === 'medium' ? new THREE.MeshStandardMaterial({ map: carbonTex(), roughness: 0.3, metalness: 0.2, envMapIntensity: 0.9 })
      : new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.45, metalness: 0.2 });
    SHARED[k].name = 'car3d_carbon';
    return SHARED[k];
  }
  // Tytan (halo, wydech, tłoczysko DRS)
  function darkMat() {
    if (SHARED.dark) return SHARED.dark;
    SHARED.dark = new THREE.MeshStandardMaterial({ color: 0x43464d, roughness: 0.26, metalness: 0.9, envMapIntensity: 1.1, name: 'car3d_titan' });
    return SHARED.dark;
  }

  // Nazwa mieszanki (po polsku, wielkimi literami) na podstawie koloru z PG.TYRES
  function compLabel(comp) {
    var T = PG.TYRES || {}, c = String(comp || '').toLowerCase();
    for (var k in T) if (T[k] && T[k].color && String(T[k].color).toLowerCase() === c) return String(T[k].name || '').toUpperCase();
    return '';
  }
  // Atlas koła (1024 x 256): bieżnik, bok z kolorowym pierścieniem mieszanki i napisami, felga, osłona, tarcza
  function tyreCanvas(comp) {
    var c = mkCanvas(1024, 256), g = c.getContext('2d'), i, label = compLabel(comp) || 'SLICK';
    g.fillStyle = '#151517'; g.fillRect(0, 0, 1024, 256);
    // bieżnik: lekkie smugi zużycia
    for (i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,' + (0.012 + Math.random() * 0.02) + ')'; g.fillRect(Math.random() * 1024, 2 + Math.random() * 38, 2 + Math.random() * 30, 1); }
    // bok zewnętrzny (wiersze 44..120, 44 = bark, 120 = stopka)
    g.fillStyle = '#1b1b1e'; g.fillRect(0, 42, 1024, 80);
    g.fillStyle = comp; g.fillRect(0, 54, 1024, 9);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, 63, 1024, 1);
    g.textBaseline = 'middle'; g.textAlign = 'center';
    // napisy fikcyjnego producenta opon i nazwa mieszanki (dwa razy na obwodzie)
    for (var k = 0; k < 2; k++) {
      var x0 = k * 512;
      g.fillStyle = '#ededed'; g.font = 'bold 28px Arial, Helvetica, sans-serif';
      g.fillText('V E L T R A', x0 + 140, 84);
      g.fillStyle = comp; g.font = 'italic bold 22px Arial, Helvetica, sans-serif';
      g.fillText(label, x0 + 372, 80);
      g.fillStyle = '#ededed'; g.fillRect(x0 + 302, 95, 140, 3);
      g.fillStyle = 'rgba(237,237,237,0.7)'; g.font = 'bold 11px Arial, Helvetica, sans-serif';
      g.fillText('MONZA GP  ·  18', x0 + 372, 106);
    }
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 110, 1024, 2);
    // bok wewnętrzny
    g.fillStyle = '#18181a'; g.fillRect(0, 126, 1024, 36);
    g.fillStyle = comp; g.globalAlpha = 0.85; g.fillRect(0, 150, 1024, 4); g.globalAlpha = 1;
    // felga (magnez, ciemna) i osłona koła
    g.fillStyle = '#3c3f45'; g.fillRect(0, 162, 1024, 22);
    g.fillStyle = '#8b9098'; g.fillRect(0, 170, 1024, 2);
    var cg = g.createLinearGradient(0, 186, 0, 218); cg.addColorStop(0, '#16171a'); cg.addColorStop(0.5, '#0d0e10'); cg.addColorStop(1, '#1d1f23');
    g.fillStyle = cg; g.fillRect(0, 186, 1024, 33);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(0, 205, 1024, 1);
    g.fillStyle = '#a9adb4'; g.fillRect(0, 219, 1024, 12);
    g.fillStyle = '#4a4540'; g.fillRect(0, 232, 1024, 12);
    g.fillStyle = '#1b1b1d'; g.fillRect(0, 244, 1024, 12);
    return c;
  }
  function wheelMaps() {
    if (SHARED.wrm) return SHARED;
    var c = mkCanvas(64, 256), g = c.getContext('2d');
    // G = chropowatość, B = metaliczność
    function band(y0, y1, r, m) { g.fillStyle = 'rgb(0,' + Math.round(r * 255) + ',' + Math.round(m * 255) + ')'; g.fillRect(0, y0, 64, y1 - y0); }
    band(0, 42, 0.86, 0); band(42, 126, 0.72, 0); band(126, 162, 0.75, 0); band(162, 186, 0.35, 0.85); band(186, 219, 0.28, 0.15); band(219, 232, 0.25, 0.9); band(232, 244, 0.55, 0.25); band(244, 256, 0.5, 0.5);
    SHARED.wrm = texCommon(new THREE.CanvasTexture(c), false);
    SHARED.wrm.flipY = false;
    var e = mkCanvas(16, 256), h = e.getContext('2d');
    h.fillStyle = '#000'; h.fillRect(0, 0, 16, 256);
    h.fillStyle = '#fff'; h.fillRect(0, 232, 16, 12);
    h.fillStyle = '#4a4a4a'; h.fillRect(0, 244, 16, 12);
    SHARED.wem = texCommon(new THREE.CanvasTexture(e), false);
    SHARED.wem.flipY = false;
    return SHARED;
  }
  var TYRE = {};
  function tyreTex(comp) {
    comp = comp || '#f2f2f2';
    if (TYRE[comp]) return TYRE[comp];
    var t = texCommon(new THREE.CanvasTexture(tyreCanvas(comp)), true);
    t.flipY = false; t.wrapS = THREE.RepeatWrapping;
    TYRE[comp] = t;
    return t;
  }
  function makeWheelMat(comp, qn) {
    var m = wheelMaps();
    if (qn === 'low') return new THREE.MeshStandardMaterial({ map: tyreTex(comp), roughness: 0.7, metalness: 0.1, name: 'car3d_wheel' });
    return new THREE.MeshStandardMaterial({ map: tyreTex(comp), roughnessMap: m.wrm, metalnessMap: m.wrm, roughness: 1, metalness: 1, emissiveMap: m.wem, emissive: 0x000000, envMapIntensity: 0.8, name: 'car3d_wheel' });
  }

  // Atlas malowania zespołu
  function paintCells(g, lv) {
    var paint = lv.paint2 || {}, BX = PG.CAR_BOX || { x0: -2.9, x1: 2.9, y0: -1.05, y1: 1.05 }, PW = PG.PAINT_W || 40, PH = PG.PAINT_H || 16;
    var cw = (BX.x1 - BX.x0) / PW, ch = (BX.y1 - BX.y0) / PH;
    Object.keys(paint).forEach(function (k) {
      var a = k.split(','), x = +a[0], y = +a[1];
      g.fillStyle = paint[k]; g.fillRect(BX.x0 + x * cw - 0.002, BX.y0 + y * ch - 0.002, cw + 0.004, ch + 0.004);
    });
  }
  function liveryCanvas(lv) {
    var c = mkCanvas(LIV.W, LIV.H), g = c.getContext('2d'), sx = LIV.W / 5.8, sy = LIV.HA / 2.1;
    g.save(); g.beginPath(); g.rect(0, 0, LIV.W, LIV.HA); g.clip();
    g.setTransform(sx, 0, 0, sy, 2.9 * sx, 1.05 * sy);
    if (PG.liveryLayers) PG.liveryLayers(g, lv); else { g.fillStyle = lv.primary; g.fillRect(-3, -1.2, 6, 2.4); }
    g.restore();
    g.save(); g.beginPath(); g.rect(0, LIV.HA, LIV.W, LIV.HA); g.clip();
    g.setTransform(sx, 0, 0, sy, 2.9 * sx, LIV.HA + 1.05 * sy);
    g.fillStyle = lv.secondary; g.fillRect(-3, -1.2, 6, 2.4);
    paintCells(g, lv);
    g.restore();
    var sw = [lv.primary, lv.secondary, lv.accent, '#0c0d0f', '#f2f2f2', shade(lv.primary, -0.35), shade(lv.secondary, 0.15), shade(lv.accent, -0.3), '#070708', '#030304', '#26272b'];
    for (var i = 0; i < sw.length; i++) { g.fillStyle = sw[i]; g.fillRect((i % 8) * 128, 2 * LIV.HA + Math.floor(i / 8) * LIV.SW, 128, LIV.SW); }
    return c;
  }
  var LCACHE = {}, LORDER = [];
  function liveryEntry(lv) {
    var key = JSON.stringify(lv);
    var e = LCACHE[key];
    if (e) return e;
    var c = liveryCanvas(lv), t = texCommon(new THREE.CanvasTexture(c), true);
    t.flipY = false; t.repeat.set(1, LA);
    // jasność nosa (dla koloru numeru)
    var px = c.getContext('2d').getImageData(Math.round((2.2 + 2.9) / 5.8 * LIV.W), Math.round(1.05 / 2.1 * LIV.HA), 1, 1).data;
    e = LCACHE[key] = { key: key, tex: t, lum: (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255, mats: {} };
    LORDER.push(key);
    if (LORDER.length > 40) evict(LORDER.shift());
    return e;
  }
  function evict(key) {
    var e = LCACHE[key]; if (!e) return;
    e.tex.dispose(); for (var k in e.mats) e.mats[k].dispose();
    delete LCACHE[key];
  }
  // Lakier: na 'high' z warstwą bezbarwną (clearcoat), niżej zwykły PBR dostrojony do połysku
  function paintMat(lv, qn) {
    var e = liveryEntry(lv), k = Q[qn] ? qn : 'high';
    if (!e.mats[k]) {
      e.mats[k] = k === 'high' ? new THREE.MeshPhysicalMaterial({ map: e.tex, roughness: 0.4, metalness: 0.06, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1 })
        : k === 'medium' ? new THREE.MeshStandardMaterial({ map: e.tex, roughness: 0.28, metalness: 0.1, envMapIntensity: 1.05 })
        : new THREE.MeshStandardMaterial({ map: e.tex, roughness: 0.36, metalness: 0.08 });
      e.mats[k].name = 'car3d_paint';
    }
    return e.mats[k];
  }

  // Kask (górna połowa atlasu 512x512) i numer (dolna połowa, przezroczyste tło)
  // Punkt wewnątrz gwiazdy pięcioramiennej o promieniu R (krawędzie proste)
  function starIn(px, py, R) {
    var r = Math.hypot(px, py); if (r > R) return false;
    var sec = TAU / 5, a = ((Math.atan2(py, px) % sec) + sec) % sec, d = Math.min(a, sec - a), al = sec / 2, Ri = R * 0.4;
    var e0 = Ri * Math.cos(al) - R, e1 = Ri * Math.sin(al);
    return r < R * e1 / (Math.cos(d) * e1 - Math.sin(d) * e0);
  }
  // Obszar wizjera na sferze kasku: 2 = szyba, 1 = uszczelka, 0 = skorupa
  function visorAt(dx, dy, dz) {
    if (dx > 0.4 && dy > -0.14 && dy < 0.3 && Math.abs(dz) < 0.8 - Math.max(0, dy) * 0.4) return 2;
    if (dx > 0.36 && dy > -0.18 && dy < 0.34 && Math.abs(dz) < 0.86 - Math.max(0, dy) * 0.4) return 1;
    return 0;
  }
  function helmetPixels(g, hm) {
    var W = 512, H = 256, img = g.createImageData(W, H), d = img.data;
    var c1 = PG.hex ? PG.hex(hm.c1 || '#f2f2f2') : [242, 242, 242], c2 = PG.hex ? PG.hex(hm.c2 || '#d22222') : [210, 34, 34], pat = hm.pattern || 'plain';
    for (var py = 0; py < H; py++) {
      var th = (py + 0.5) / H * PI, st = Math.sin(th), dy = Math.cos(th);
      for (var px = 0; px < W; px++) {
        var ph = (px + 0.5) / W * TAU, dx = -Math.cos(ph) * st, dz = Math.sin(ph) * st, col = c1, k = (py * W + px) * 4;
        var two = false;
        if (pat === 'band') two = dy > -0.42 && dy < -0.24;
        else if (pat === 'top') two = Math.abs(dz) < 0.2 && dy > -0.35;
        else if (pat === 'halves') two = dx > 0.05;
        else if (pat === 'star') two = (dy > 0.3 && starIn(dx, dz, 0.5)) || (Math.abs(dz) > 0.3 && starIn(dx + 0.25, dy - 0.25, 0.32));
        if (two) col = c2;
        var r = col[0], gg = col[1], b = col[2];
        // wizjer: przyciemniana szyba z irydowym odcieniem (metaliczna w mapie chropowatości), uszczelka
        var va = visorAt(dx, dy, dz);
        if (va === 1) { r = 18; gg = 18; b = 20; }
        if (va === 2) { var tv = (dy + 0.14) / 0.44; r = lerp(18, 120, tv * tv); gg = lerp(24, 105, tv * tv); b = lerp(50, 175, tv); if (dy > 0.2 && dy < 0.24) { r = 200; gg = 210; b = 228; } }
        if (dy < -0.62) { r = 14; gg = 14; b = 16; } else if (dy < -0.56) { r *= 0.5; gg *= 0.5; b *= 0.5; }
        d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  // Wspólna mapa chropowatości (G) i metaliczności (B) dla atlasu kierowcy: lustrzany wizjer, gładka skorupa, matowa szyja
  function helmetRM() {
    if (SHARED.hrm) return SHARED.hrm;
    var W = 512, c = mkCanvas(W, 512), g = c.getContext('2d'), img = g.createImageData(W, 256), d = img.data;
    for (var py = 0; py < 256; py++) {
      var th = (py + 0.5) / 256 * PI, st = Math.sin(th), dy = Math.cos(th);
      for (var px = 0; px < W; px++) {
        var ph = (px + 0.5) / W * TAU, va = visorAt(-Math.cos(ph) * st, dy, Math.sin(ph) * st), k = (py * W + px) * 4, r = 0.3, m = 0.04;
        if (va === 2) { r = 0.06; m = 0.85; } else if (va === 1) { r = 0.6; m = 0; }
        if (dy < -0.56) { r = 0.75; m = 0; }
        d[k] = 0; d[k + 1] = Math.round(r * 255); d[k + 2] = Math.round(m * 255); d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // dolna połowa: naklejka z numerem
    g.fillStyle = 'rgb(0,115,0)'; g.fillRect(0, 256, W, 256);
    SHARED.hrm = texCommon(new THREE.CanvasTexture(c), false);
    return SHARED.hrm;
  }
  var DCACHE = {}, DORDER = [];
  function driverMat(hm, num, lum, qn) {
    hm = hm || { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' };
    var dark = lum > 0.58, key = JSON.stringify(hm) + '|' + (num || '') + '|' + (dark ? 1 : 0) + '|' + qn;
    if (DCACHE[key]) return DCACHE[key];
    var c = mkCanvas(512, 512), g = c.getContext('2d');
    helmetPixels(g, hm);
    if (num) {
      g.save(); g.translate(256, 384);
      g.font = 'italic 900 150px "Arial Black", Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
      g.strokeText(String(num), 0, 6); g.fillStyle = dark ? '#111' : '#fff'; g.fillText(String(num), 0, 6);
      g.restore();
    }
    var t = texCommon(new THREE.CanvasTexture(c), true);
    var m = qn === 'high' ? new THREE.MeshPhysicalMaterial({ map: t, roughnessMap: helmetRM(), metalnessMap: helmetRM(), roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.05, alphaTest: 0.5 })
      : qn === 'medium' ? new THREE.MeshStandardMaterial({ map: t, roughnessMap: helmetRM(), metalnessMap: helmetRM(), roughness: 1, metalness: 1, alphaTest: 0.5 })
      : new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, alphaTest: 0.5 });
    m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; m.name = 'car3d_driver';
    DCACHE[key] = m; DORDER.push(key);
    if (DORDER.length > 60) { var ok = DORDER.shift(), o = DCACHE[ok]; delete DCACHE[ok]; if (o) { o.map.dispose(); o.dispose(); } }
    return m;
  }

  // ---------- cień kontaktowy (miękka plama pod bolidem, zawsze włączona) ----------
  // Alfa liczona piksel po pikselu (bez filtrów płótna): podłoga, opony, przednie skrzydło i szeroka poświata
  function contactTex() {
    if (SHARED.cst) return SHARED.cst;
    var W = 256, H = 128, c = mkCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    var X0 = CS_CX - CS_LX / 2, i, j, k;
    var hwf = mono([[-2.75, 0.42], [-1.95, 0.55], [-1.5, 0.62], [-1.25, 0.78], [-0.95, 0.845], [0.6, 0.86], [0.92, 0.8], [1.1, 0.55], [1.3, 0.2], [2.4, 0.14], [2.8, 0.1]]);
    var WH = [[FA, ZF, WF / 2], [RA, ZR, WR / 2]];
    for (j = 0; j < H; j++) {
      // wiersz 0 ↔ z = −CS_LZ/2 (flipY), kształt i tak jest symetryczny
      var z = -CS_LZ / 2 + (j + 0.5) / H * CS_LZ, az = Math.abs(z);
      for (i = 0; i < W; i++) {
        var x = X0 + (i + 0.5) / W * CS_LX;
        var ex = x > 2.8 ? x - 2.8 : x < -2.75 ? -2.75 - x : 0, dz = Math.max(0, az - hwf(clamp(x, -2.75, 2.8))), dd = dz * dz + ex * ex;
        // nos i dyfuzor są wyżej nad ziemią — jaśniejszy cień
        var hgt = x > 1.1 ? lerp(1, 0.5, sstep(1.1, 1.7, x)) : x < -1.95 ? lerp(1, 0.55, sstep(-1.95, -2.6, x)) : 1;
        var body = 0.62 * hgt * Math.exp(-dd / (2 * 0.13 * 0.13)), amb = 0.26 * Math.exp(-dd / (2 * 0.38 * 0.38)), wh = 0;
        for (k = 0; k < 2; k++) {
          var qx = (x - WH[k][0]) / 0.3, qz = (az - WH[k][1]) / (WH[k][2] + 0.07);
          wh = Math.max(wh, 0.82 * Math.exp(-(qx * qx + qz * qz) * 1.4));
        }
        var fw = x > 2.3 && x < 3.0 ? 0.24 * sstep(2.3, 2.45, x) * (1 - sstep(2.85, 3.0, x)) * (1 - sstep(0.9, 1.08, az)) : 0;
        var a = 1 - (1 - body) * (1 - amb) * (1 - wh) * (1 - fw);
        // wygaszenie przy krawędziach płaszczyzny
        a *= sstep(0, 0.3, Math.min(x - X0, X0 + CS_LX - x, CS_LZ / 2 - az));
        var p = (j * W + i) * 4;
        d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = Math.round(clamp(a, 0, 1) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    SHARED.cst = texCommon(new THREE.CanvasTexture(c), false);
    return SHARED.cst;
  }
  function contactGeo() {
    if (SHARED.csGeo) return SHARED.csGeo;
    var g = new THREE.PlaneGeometry(CS_LX, CS_LZ);
    g.rotateX(-PI / 2); g.translate(CS_CX, 0, 0);
    SHARED.csGeo = g;
    return g;
  }
  // Render do bufora (postprocessing HDR) miesza liniowo i ciemne nakładki jaśnieją: krycie przeliczone tak,
  // by wyglądały jak przy renderowaniu prosto na ekran (sRGB)
  function linBlend(mat) {
    var U = { value: 1 };
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uAG = U;
      sh.fragmentShader = 'uniform float uAG;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        'diffuseColor.a = 1.0 - pow(max(1.0 - diffuseColor.a, 0.0), uAG);\n#include <opaque_fragment>');
    };
    mat.onBeforeRender = function (r) { U.value = (r && r.getRenderTarget && r.getRenderTarget()) ? 2.2 : 1; };
    return mat;
  }
  function contactMat() {
    if (SHARED.csMat) return SHARED.csMat;
    SHARED.csMat = linBlend(new THREE.MeshBasicMaterial({
      color: 0x000000, map: contactTex(), transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'car3d_contactShadow'
    }));
    return SHARED.csMat;
  }

  // ---------- otarcia lakieru (nakładka pokazywana przy uszkodzeniach) ----------
  function scuffTex() {
    if (SHARED.stex) return SHARED.stex;
    var S = 256, c = mkCanvas(S, S), g = c.getContext('2d'), R = Math.random, i, k;
    g.lineCap = 'round';
    // smugi gumy i brudu
    for (i = 0; i < 22; i++) {
      var x1 = R() * S, y1 = R() * S, l1 = 20 + R() * 70, a1 = (R() - 0.5) * 0.35;
      g.strokeStyle = 'rgba(18,16,14,' + (0.25 + R() * 0.35).toFixed(2) + ')'; g.lineWidth = 2 + R() * 6;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a1) * l1, y1 + Math.sin(a1) * l1); g.stroke();
    }
    // odpryski lakieru z widocznym węglem
    for (i = 0; i < 12; i++) {
      var cx = R() * S, cy = R() * S, rr = 4 + R() * 10;
      g.beginPath();
      for (k = 0; k < 7; k++) {
        var an = k / 7 * TAU, qr = rr * (0.55 + R() * 0.6), px = cx + Math.cos(an) * qr * 1.6, py = cy + Math.sin(an) * qr;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath(); g.fillStyle = 'rgba(28,29,33,0.92)'; g.fill();
      g.strokeStyle = 'rgba(225,225,230,0.55)'; g.lineWidth = 1; g.stroke();
    }
    // rysy wzdłuż bolidu
    for (i = 0; i < 80; i++) {
      var x2 = R() * S, y2 = R() * S, l2 = 6 + R() * 34, a2 = (R() - 0.5) * 0.5;
      g.strokeStyle = 'rgba(235,236,240,' + (0.3 + R() * 0.45).toFixed(2) + ')'; g.lineWidth = 0.6 + R() * 1.1;
      g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 + Math.cos(a2) * l2, y2 + Math.sin(a2) * l2); g.stroke();
    }
    // pył z trawy i żwiru
    for (i = 0; i < 160; i++) { g.fillStyle = R() < 0.5 ? 'rgba(120,104,70,0.35)' : 'rgba(70,96,48,0.3)'; g.fillRect(R() * S, R() * S, 1 + R() * 2, 1 + R() * 2); }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    SHARED.stex = texCommon(t, true);
    return SHARED.stex;
  }
  // Cztery wspólne poziomy krycia (bez materiału na bolid)
  function scuffMat(k) {
    var key = 'scuff' + k;
    if (SHARED[key]) return SHARED[key];
    SHARED[key] = new THREE.MeshStandardMaterial({
      map: scuffTex(), transparent: true, opacity: k / 4, depthWrite: false, roughness: 0.8, metalness: 0.05,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3, name: 'car3d_scuff'
    });
    return SHARED[key];
  }

  // ---------- API ----------
  var DEF_LV = { primary: '#d40f1a', secondary: '#1a1a1a', accent: '#ffd400', pattern: 'plain' };
  var Car3D = PG.Car3D = {};
  Car3D.Q = Q;
  // środki kół w układzie bolidu (m): oś przednia x, oś tylna x, połowa rozstawu przód/tył, promień opony
  Car3D.WHEELS = { fx: FA, rx: RA, fz: ZF, rz: ZR, r: RW };
  // części, które mogą odpaść (Car3D.detach)
  Car3D.PARTS = ['fwL', 'fwR', 'rw'];
  var DKEYS = ['fwL', 'fwR', 'rw', 'floor', 'suspFL', 'suspFR', 'suspRL', 'suspRR', 'engine'];
  var NOST = {}, VUP = new THREE.Vector3(0, 1, 0), VTMP = new THREE.Vector3();
  function c01(x) { return x > 0 ? (x < 1 ? x : 1) : 0; }
  function c11(x) { return x > -1 ? (x < 1 ? x : 1) : (x <= -1 ? -1 : 0); }

  Car3D.build = function (livery, helmet, opts) {
    opts = opts || {};
    var qn = Q[opts.quality] ? opts.quality : 'high', lv = livery || DEF_LV, hiQ = qn === 'high';
    var G = getGeo(qn, opts.halo === 'dark'), le = liveryEntry(lv);
    var paint = paintMat(lv, qn), drv = driverMat(helmet, opts.number, le.lum, qn), carbon = carbonMat(qn), titan = darkMat();
    var wheelMat = makeWheelMat(opts.compound || '#f2f2f2', qn);
    var rainMat = new THREE.MeshStandardMaterial({ color: 0x2a0707, emissive: 0xff1c1c, emissiveIntensity: 0, roughness: 0.35, name: 'car3d_rain' });
    var root = new THREE.Group();
    root.name = 'Car3D';
    // solid = false: drobne lub świecące części (bez rzucania i odbierania cieni)
    function add(geo, mat, parent, name, solid) {
      if (!geo) return null;
      var m = new THREE.Mesh(geo, mat);
      solid = solid !== false;
      m.castShadow = solid; m.receiveShadow = solid && hiQ; m.name = name || '';
      (parent || root).add(m);
      return m;
    }
    function group(name, p, zs) { var o = new THREE.Group(); o.name = name; o.position.set(p[0], p[1], p[2] * zs); root.add(o); return o; }
    var body = add(G.paint, paint, null, 'paint');
    add(G.carbon, carbon, null, 'carbon');
    if (G.dark) add(G.dark, titan, null, 'titan');
    add(G.driver, drv, null, 'driver');
    var rain = add(G.rain, rainMat, null, 'rain', false);
    // połówki przedniego skrzydła: osobne siatki widoczne dopiero po uszkodzeniu (wcześniej są częścią nadwozia)
    var fwR = group('fwR', FWP, 1), fwL = group('fwL', FWP, -1);
    add(G.fwR, paint, fwR, 'fwR'); add(G.fwL, paint, fwL, 'fwL');
    fwR.visible = false; fwL.visible = false;
    // zespół tylnego skrzydła: płaty, płyty, obudowa siłownika (po uszkodzeniu), klapa DRS, tłoczysko, światła
    var rw = group('rw', RWP, 1);
    var rwMain = add(G.rwMain, paint, rw, 'rwMain'); rwMain.visible = false;
    var drs = add(G.drs, paint, rw, 'drs'); drs.position.set(DRS_G[0], DRS_G[1], 0);
    var rod = add(G.rod, titan, rw, 'drsRod', false);
    var rwLights = add(G.rwLights, rainMat, rw, 'rainRw', false);
    if (rwLights) rwLights.visible = false;
    var piv = [];
    [1, -1].forEach(function (s) {
      var p = new THREE.Group(); p.position.set(FA, RW, s * KPF); root.add(p);
      if (G.hub) add(s > 0 ? G.hub.R : G.hub.L, carbon, p, 'hub');
      var w = add(s > 0 ? G.wheelFR : G.wheelFL, wheelMat, p, 'wheel');
      w.position.set(0, 0, s * (ZF - KPF));
      piv.push({ p: p, w: w, s: s });
    });
    var rear = add(G.wheelRear, wheelMat, null, 'wheels_r'); rear.position.set(RA, RW, 0);
    // miękki cień kontaktowy (także na niskiej jakości)
    var shadow = new THREE.Mesh(contactGeo(), contactMat());
    shadow.name = 'contactShadow'; shadow.renderOrder = 1; shadow.castShadow = false; shadow.receiveShadow = false;
    shadow.position.y = SH_LIFT; root.add(shadow);
    function anchor(name, x, y, z, ry) { var o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); if (ry) o.rotation.y = ry; root.add(o); return o; }
    var R = Math.random;
    var u = root.userData = {
      car3d: true, quality: qn, piv: piv, rear: rear, drs: drs, rain: rain, wheelMat: wheelMat, rainMat: rainMat,
      spin: 0, steer: 0, drsT: 0, heat: 0, t: R() * 2, compound: opts.compound || '#f2f2f2',
      // kamery: lokalne −Z dziecka kamery patrzy wzdłuż +X bolidu
      cockpit: anchor('cockpit', 0.41, 0.765, 0, -PI / 2), tcam: anchor('tcam', -0.08, 1.07, 0, -PI / 2),
      rearEmitter: anchor('rearEmitter', -2.98, 0.22, 0), frontEmitter: anchor('frontEmitter', 2.88, 0.08, 0),
      // części ruchome i stan animacji
      G: G, hiQ: hiQ, body: body, fw: { fwR: fwR, fwL: fwL }, rw: rw, rwMain: rwMain, rod: rod, rwLights: rwLights,
      shadow: shadow, shadowOff: false, spinF: [0, 0], lockF: [0, 0], ws: 0, heatSet: -1,
      drsTgt: 0, drsFrom: 0, drsAge: 1, drsX: 0, drsAng: -1, drsStuck: 0,
      // uszkodzenia
      dmg: { fwL: 0, fwR: 0, rw: 0, floor: 0, suspFL: 0, suspFR: 0, suspRL: 0, suspRR: 0, engine: 0 },
      det: { fwL: false, fwR: false, rw: false }, detAt: { fwL: 0, fwR: 0, rw: 0 },
      base: { fwR: [0, 0, 0, 0], fwL: [0, 0, 0, 0], rw: [0, 0, 0, 0] },
      dvar: [0.8 + 0.4 * R(), 0.8 + 0.4 * R(), 0.8 + 0.4 * R()], lean: R() < 0.5 ? -1 : 1,
      split: false, rearW: null, rearSplit: false, scuff: null, flut: false
    };
    setDrsAngle(u, 0);
    return root;
  };

  // ---------- DRS: hydrauliczne otwarcie z lekkim przeregulowaniem, twarde zamknięcie z odbiciem od ogranicznika ----------
  var DZ = 0.62, DW = 28, DSQ = Math.sqrt(1 - DZ * DZ), DWD = DW * DSQ, DK = DZ / DSQ;
  // Położenie klapy (0 zamknięta … 1 otwarta) po czasie t od zmiany; x0 = położenie w chwili zmiany
  function drsCurve(open, x0, t) {
    if (open) {
      var e = Math.exp(-DZ * DW * t);
      return x0 + (1 - x0) * (1 - e * (Math.cos(DWD * t) + DK * Math.sin(DWD * t)));
    }
    if (!(x0 > 0)) return 0;
    var T = 0.07 * Math.sqrt(x0);
    if (t < T) { var k = t / T; return x0 * (1 - k * k); }
    t -= T;
    if (t < 0.05) return 0.06 * x0 * Math.sin(PI * t / 0.05);
    t -= 0.05;
    if (t < 0.03) return 0.015 * x0 * Math.sin(PI * t / 0.03);
    return 0;
  }
  // Kąt klapy i położenie tłoczyska (tłoczysko wysuwa się z obudowy, celując w przegub)
  function setDrsAngle(u, ang) {
    u.drsAng = ang;
    u.drs.rotation.z = ang;
    var c = Math.cos(ang), s = Math.sin(ang);
    var bx = DRS_G[0] + DRS_BR[0] * c - DRS_BR[1] * s, by = DRS_G[1] + DRS_BR[0] * s + DRS_BR[1] * c;
    u.rod.position.set(bx, by, 0);
    u.rod.rotation.z = Math.atan2(-(bx - DRS_P0[0]), by - DRS_P0[1]);
    // przy zamkniętej klapie tłoczysko jest schowane w obudowie (bez dodatkowego wywołania rysowania)
    u.rod.visible = ang > 0.012;
  }
  function drsStep(u, st, dt, av) {
    var tgt = st.drs ? 1 : 0;
    if (tgt !== u.drsTgt) { u.drsFrom = u.drsX; u.drsTgt = tgt; u.drsAge = 0; }
    if (u.drsAge < 0.5) {
      u.drsAge += dt;
      u.drsX = u.drsAge < 0.5 ? clamp(drsCurve(tgt, u.drsFrom, u.drsAge), 0, 1.2) : tgt;
    }
    u.drsT = u.drsX;
    var x = u.drsX > u.drsStuck ? u.drsX : u.drsStuck, fl = 0;
    // drgania otwartej klapy przy dużej prędkości
    if (av > 40 && x > 0.05) fl = x * sstep(40, 85, av) * 0.045 * (Math.sin(u.t * 57) * 0.65 + Math.sin(u.t * 86 + 1.3) * 0.35);
    // luźna klapa uszkodzonego skrzydła
    if (u.dmg.rw > 0.3 && av > 10) fl += sstep(0.3, 0.9, u.dmg.rw) * sstep(10, 60, av) * 0.06 * Math.abs(Math.sin(u.t * 43));
    var ang = (x + fl) * DRS_OPEN;
    if (Math.abs(ang - u.drsAng) > 1e-5) setDrsAngle(u, ang);
  }

  // ---------- uszkodzenia ----------
  // Nadwozie: jedna siatka, gdy skrzydła są całe; po uszkodzeniu nadwozie bez skrzydeł + osobne części
  function setSplit(u, on) {
    if (on === u.split) return;
    u.split = on;
    u.body.geometry = on ? u.G.paintBody : u.G.paint;
    u.rwMain.visible = on;
  }
  // Tylne koła: wspólna siatka, a przy uszkodzeniu zawieszenia osobne (pochylenie i zbieżność)
  function setRearSplit(g, u, on) {
    if (on === u.rearSplit) return;
    u.rearSplit = on;
    if (on && !u.rearW) {
      u.rearW = [];
      for (var i = 0; i < 2; i++) {
        var m = new THREE.Mesh(i ? u.G.wheelRL : u.G.wheelRR, u.wheelMat);
        m.name = 'wheel_r'; m.castShadow = true; m.receiveShadow = u.hiQ;
        m.position.set(RA, RW, i ? -ZR : ZR); m.rotation.z = -u.spin;
        g.add(m); u.rearW.push(m);
      }
    }
    u.rear.visible = !on;
    if (u.rearW) { u.rearW[0].visible = on; u.rearW[1].visible = on; }
  }
  // Koło przy uszkodzonym zawieszeniu: pochylenie (góra do środka), rozbieżność, podniesienie nad asfalt
  function wheelDmg(w, v, s, width, x0, z0, y0) {
    var a = Math.pow(v, 0.9), cam = 0.3 * a, toe = 0.15 * a;
    w.rotation.x = -s * cam; w.rotation.y = -s * toe;
    w.position.set(x0, y0 + RW * Math.cos(cam) + width / 2 * Math.sin(cam) - RW, z0 - s * 0.035 * a);
  }
  function setScuff(g, u, sc) {
    if (!(sc >= 0.04)) { if (u.scuff) u.scuff.visible = false; return; }
    if (!u.scuff) {
      u.scuff = new THREE.Mesh(u.G.scuff, scuffMat(1));
      u.scuff.name = 'scuff'; u.scuff.renderOrder = 1; u.scuff.castShadow = false; u.scuff.receiveShadow = false;
      g.add(u.scuff);
    }
    u.scuff.material = scuffMat(Math.min(4, Math.ceil(sc * 4)));
    u.scuff.visible = true;
  }
  function applyDamage(g, u) {
    var D = u.dmg, i, s, key, v, a, o, b;
    // drobne uszkodzenia (< 0,04) nie zmieniają wyglądu skrzydeł i nie dokładają wywołań rysowania
    setSplit(u, D.fwL > 0.04 || D.fwR > 0.04 || D.rw > 0.04 || u.det.fwL || u.det.fwR || u.det.rw);
    u.flut = false;
    // przednie skrzydło: opadająca, wygięta do tyłu połówka
    for (i = 0; i < 2; i++) {
      key = i ? 'fwL' : 'fwR'; s = i ? -1 : 1; v = D[key]; o = u.fw[key]; b = u.base[key];
      if (u.det[key] && v < u.detAt[key] - 0.3) u.det[key] = false; // naprawa (np. nowe skrzydło)
      o.visible = u.split && v < 0.999 && !u.det[key];
      a = u.split ? Math.pow(v, 0.8) * u.dvar[i] : 0;
      b[0] = s * 0.05 * a; b[1] = -s * 0.15 * a; b[2] = 0.045 * a; b[3] = -0.006 * a;
      o.rotation.set(b[0], b[1], b[2]); o.position.y = FWP[1] + b[3];
      if (o.visible && v > 0.12) u.flut = true;
    }
    // tylne skrzydło: luźne, odchylone do tyłu i na bok
    v = D.rw; o = u.rw; b = u.base.rw;
    if (u.det.rw && v < u.detAt.rw - 0.3) u.det.rw = false;
    o.visible = v < 0.999 && !u.det.rw;
    a = u.split ? Math.pow(v, 0.8) * u.dvar[2] : 0;
    b[0] = u.lean * 0.08 * a; b[1] = u.lean * 0.03 * a; b[2] = 0.11 * a; b[3] = -0.02 * a;
    o.rotation.set(b[0], b[1], b[2]); o.position.y = RWP[1] + b[3];
    if (o.visible && v > 0.12) u.flut = true;
    // zepsuty siłownik: klapa zostaje częściowo otwarta
    u.drsStuck = 0.35 * sstep(0.35, 0.8, v);
    // zawieszenie
    for (i = 0; i < u.piv.length; i++) {
      s = u.piv[i].s;
      wheelDmg(u.piv[i].w, D[s > 0 ? 'suspFR' : 'suspFL'], s, WF, 0, s * (ZF - KPF), 0);
    }
    setRearSplit(g, u, D.suspRL > 0.04 || D.suspRR > 0.04);
    if (u.rearW) for (i = 0; i < 2; i++) { s = i ? -1 : 1; wheelDmg(u.rearW[i], D[s > 0 ? 'suspRR' : 'suspRL'], s, WR, RA, s * ZR, RW); }
    // otarcia lakieru
    setScuff(g, u, Math.max(D.floor, 0.8 * Math.max(D.suspFL, D.suspFR, D.suspRL, D.suspRR), 0.55 * Math.max(D.fwL, D.fwR, D.rw), 0.4 * D.engine));
  }
  // Drgania luźnych części przy prędkości (bez alokacji)
  function flutter(u, av) {
    var amp = sstep(8, 70, av), t = u.t, i, key, o, b, f;
    for (i = 0; i < 2; i++) {
      key = i ? 'fwL' : 'fwR'; o = u.fw[key];
      if (!o.visible) continue;
      b = u.base[key]; f = amp * sstep(0.12, 0.6, u.dmg[key]);
      o.rotation.set(b[0] + (i ? -1 : 1) * 0.014 * f * Math.sin(t * 53 + i * 2.1), b[1], b[2] + 0.01 * f * Math.sin(t * 71 + i));
    }
    o = u.rw;
    if (o.visible) {
      b = u.base.rw; f = amp * sstep(0.12, 0.6, u.dmg.rw);
      o.rotation.set(b[0] + 0.012 * f * Math.sin(t * 29), b[1], b[2] + 0.02 * f * Math.sin(t * 37 + 0.7));
    }
  }
  // Uszkodzenia wg car.dmg (0 cały … 1 zniszczony); tanie przy wywołaniu co klatkę (zmiany < 0,003 pomijane)
  Car3D.setDamage = function (g, d) {
    var u = g && g.userData; if (!u || !u.car3d) return;
    var D = u.dmg, ch = false, i, k, v;
    for (i = 0; i < DKEYS.length; i++) {
      k = DKEYS[i]; v = d ? c01(+d[k]) : 0;
      if (v - D[k] > 0.003 || D[k] - v > 0.003 || (v >= 0.999) !== (D[k] >= 0.999)) { D[k] = v; ch = true; }
    }
    if (ch) applyDamage(g, u);
  };
  // Kopia części do odłamków: wspólne geometrie i materiały, transformacja względem korzenia bolidu
  function copyPart(o) {
    var n = o.isMesh ? new THREE.Mesh(o.geometry, o.material) : new THREE.Group(), i;
    n.name = o.name; n.position.copy(o.position); n.quaternion.copy(o.quaternion); n.scale.copy(o.scale); n.visible = o.visible;
    if (o.isMesh) { n.castShadow = o.castShadow; n.receiveShadow = false; n.renderOrder = o.renderOrder; }
    for (i = 0; i < o.children.length; i++) n.add(copyPart(o.children[i]));
    return n;
  }
  // Oderwanie części ('fwL' | 'fwR' | 'rw'): ukrywa ją na bolidzie i zwraca obiekt do lotu odłamków (null, gdy już odpadła)
  Car3D.detach = function (g, part) {
    var u = g && g.userData; if (!u || !u.car3d) return null;
    var src = part === 'rw' ? u.rw : (part === 'fwL' || part === 'fwR') ? u.fw[part] : null;
    if (!src || u.det[part]) return null;
    u.det[part] = true; u.detAt[part] = u.dmg[part];
    applyDamage(g, u);
    var out = copyPart(src);
    out.name = 'car3d_debris_' + part; out.visible = true;
    out.userData = { car3dDebris: true, part: part };
    return out;
  };

  // Cień kontaktowy zawsze na ziemi (y = 0 świata), także gdy nadwozie nurkuje lub się przechyla;
  // st.ground: wysokość podłoża (np. krawężnik), by cień nie chował się pod nim
  function placeShadow(g, u, st) {
    var sh = u.shadow, gy = (st && +st.ground) || 0;
    gy = gy > 0 ? (gy < 0.3 ? gy : 0.3) : 0;
    g.updateWorldMatrix(true, false);
    var e = g.matrixWorld.elements, nx = e[1], ny = e[5], nz = e[9], l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    if (!(ny > 0.5 * l) || e[13] > 4 || e[13] < -1) { sh.visible = false; return; }
    sh.visible = true;
    sh.position.y = (SH_LIFT + gy - e[13]) / ny;
    VTMP.set(nx / l, ny / l, nz / l);
    sh.quaternion.setFromUnitVectors(VUP, VTMP);
  }

  Car3D.update = function (g, st, dt) {
    var u = g && g.userData;
    if (!u || !u.car3d) return;
    st = st || NOST; dt = clamp(+dt || 0, 0, 0.1);
    var v = +st.v; if (!isFinite(v)) v = 0;
    var av = v < 0 ? -v : v, i;
    if (st.dmg !== undefined) Car3D.setDamage(g, st.dmg);
    u.t += dt;
    // skręt kół
    var tgt = -clamp(+st.steer || 0, -1, 1) * 0.3;
    u.steer += (tgt - u.steer) * Math.min(1, dt * 14);
    // przednie koła: zablokowane (lock, lockSide: −1 lewe, +1 prawe) płynnie zatrzymują obrót
    var lock = c01(+st.lock), side = c11(+st.lockSide), kl = Math.min(1, dt * 14), w = v / RW;
    u.lockF[0] += (sstep(0.05, 0.4, lock * c01(1 + side)) - u.lockF[0]) * kl;
    u.lockF[1] += (sstep(0.05, 0.4, lock * c01(1 - side)) - u.lockF[1]) * kl;
    for (i = 0; i < u.piv.length; i++) {
      u.spinF[i] = (u.spinF[i] + w * (1 - u.lockF[i]) * dt) % TAU;
      u.piv[i].w.rotation.z = -u.spinF[i];
      u.piv[i].p.rotation.y = u.steer;
    }
    // tylne koła: przy buksowaniu kręcą się szybciej, niż wynika z prędkości
    u.ws += (c01(+st.wspin) - u.ws) * Math.min(1, dt * 10);
    u.spin = (u.spin + (v + (v < -0.5 ? -1 : 1) * u.ws * (9 + av * 0.5)) / RW * dt) % TAU;
    u.rear.rotation.z = -u.spin;
    if (u.rearW) { u.rearW[0].rotation.z = -u.spin; u.rearW[1].rotation.z = -u.spin; }
    // DRS
    if (u.rw.visible) drsStep(u, st, dt, av);
    // rozgrzane tarcze hamulcowe: od ciemnej czerwieni do pomarańczu
    var br = c01(+st.brake), hot = br > 0.3 && av > 12 ? c01((av - 12) / 45) * c01((br - 0.3) / 0.5) : 0;
    u.heat += (hot - u.heat) * Math.min(1, dt * (hot > u.heat ? 2.2 : 0.5));
    if (u.wheelMat.emissiveMap && Math.abs(u.heat - u.heatSet) > 0.003) {
      u.heatSet = u.heat;
      var hk = 3.2 * u.heat;
      u.wheelMat.emissive.setRGB(hk, hk * (0.22 + 0.3 * u.heat), hk * (0.04 + 0.08 * u.heat * u.heat));
    }
    // światła deszczowe (na płytach skrzydła rysowane tylko w deszczu)
    var rainOn = !!st.rain;
    u.rainMat.emissiveIntensity = rainOn && (u.t * 4.5) % 2 < 1 ? 4 : 0;
    if (u.rwLights) u.rwLights.visible = rainOn;
    if (u.flut) flutter(u, av);
    if (!u.shadowOff) placeShadow(g, u, st);
  };
  // Ustawienie stanu natychmiast (bez wygładzania) — podgląd, zdjęcia
  Car3D.pose = function (g, st) {
    var u = g && g.userData; if (!u || !u.car3d) return;
    st = st || NOST;
    Car3D.update(g, st, 0);
    u.steer = -clamp(+st.steer || 0, -1, 1) * 0.3;
    for (var i = 0; i < u.piv.length; i++) u.piv[i].p.rotation.y = u.steer;
    var lock = c01(+st.lock), side = c11(+st.lockSide);
    u.lockF[0] = sstep(0.05, 0.4, lock * c01(1 + side)); u.lockF[1] = sstep(0.05, 0.4, lock * c01(1 - side));
    u.ws = c01(+st.wspin);
    u.drsTgt = st.drs ? 1 : 0; u.drsFrom = u.drsX = u.drsT = u.drsTgt; u.drsAge = 1;
    setDrsAngle(u, Math.max(u.drsX, u.drsStuck) * DRS_OPEN);
    if (st.rain) u.rainMat.emissiveIntensity = 4;
  };

  Car3D.setCompound = function (g, hex) {
    var u = g && g.userData; if (!u || !u.car3d) return;
    u.compound = hex; u.wheelMat.map = tyreTex(hex);
  };

  Car3D.dispose = function (g) {
    var u = g && g.userData; if (!u || !u.car3d) return;
    u.wheelMat.dispose(); u.rainMat.dispose();
    if (g.parent) g.parent.remove(g);
    u.car3d = false;
  };

  Car3D.liveryTexture = function (lv) { return liveryEntry(lv || DEF_LV).tex; };

  Car3D.clearCache = function () {
    Object.keys(LCACHE).forEach(evict); LORDER.length = 0;
    Object.keys(DCACHE).forEach(function (k) { var m = DCACHE[k]; m.map.dispose(); m.dispose(); delete DCACHE[k]; }); DORDER.length = 0;
  };

  // Działające salony (Showroom) — korzystają ze wspólnych zasobów, więc wtedy purge nic nie zwalnia
  var LIVE = 0;
  // Zwolnienie wspólnych geometrii, tekstur i materiałów (po zmianie renderera widoku 3D); true = zwolnione
  Car3D.purge = function () {
    if (LIVE > 0) return false;
    function disp(o) { if (o && typeof o.dispose === 'function') { try { o.dispose(); } catch (e) { /* nic */ } } }
    Car3D.clearCache();
    Object.keys(GEO).forEach(function (k) {
      var G = GEO[k];
      Object.keys(G).forEach(function (n) {
        var o = G[n];
        if (o && o.isBufferGeometry) disp(o);
        else if (o && typeof o === 'object') Object.keys(o).forEach(function (s) { if (o[s] && o[s].isBufferGeometry) disp(o[s]); });
      });
      delete GEO[k];
    });
    Object.keys(SHARED).forEach(function (k) { disp(SHARED[k]); delete SHARED[k]; });
    Object.keys(TYRE).forEach(function (k) { disp(TYRE[k]); delete TYRE[k]; });
    return true;
  };

  // ---------- studio: otoczenie do odbić, światła ----------
  var ENV = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  Car3D.studioEnv = function (renderer) {
    if (ENV && ENV.has(renderer)) return ENV.get(renderer);
    var sc = new THREE.Scene(), geo = new THREE.SphereGeometry(30, 32, 16), col = [], p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) { var y = p.getY(i) / 30, k = y > 0 ? 0.16 + 0.22 * y : 0.1 + 0.06 * (1 + y); col.push(k, k * 1.02, k * 1.06); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sc.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    function panel(w, h, x, y, z, k) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); sc.add(m);
    }
    panel(14, 5, 0, 16, 0, 6); panel(18, 2.2, -6, 6, 14, 4); panel(18, 2.2, 6, 6, -14, 3); panel(3, 10, 18, 4, 2, 2.5); panel(3, 10, -18, 4, -3, 2);
    var pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(sc, 0.03).texture;
    pm.dispose(); geo.dispose();
    if (ENV) ENV.set(renderer, env);
    return env;
  };
  function studioLights(scene, shadows) {
    var hemi = new THREE.HemisphereLight(0xdfe6ef, 0x202124, 0.6); scene.add(hemi);
    var key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 9, 5); scene.add(key);
    if (shadows) {
      key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
      var c = key.shadow.camera; c.left = -4; c.right = 4; c.top = 4; c.bottom = -4; c.near = 1; c.far = 25;
      key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
    }
    var rim = new THREE.DirectionalLight(0xcfe0ff, 1.2); rim.position.set(-6, 4, -5); scene.add(rim);
    return key;
  }
  // Dopasowanie kamery do prostopadłościanu bolidu
  function fitCamera(cam, az, el, aspect, margin, target) {
    var dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    var tg = target || new THREE.Vector3(-0.08, 0.42, 0), d = 12, pts = [], i, x, y, z;
    for (x = -1; x <= 1; x += 2) for (y = 0; y <= 1; y++) for (z = -1; z <= 1; z += 2) pts.push(new THREE.Vector3(x > 0 ? 2.85 : -2.95, y ? 0.97 : 0, z * 1.0));
    cam.aspect = aspect;
    for (var it = 0; it < 4; it++) {
      cam.position.copy(tg).addScaledVector(dir, d); cam.lookAt(tg); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      var mx = -9, nx = 9, my = -9, ny = 9;
      for (i = 0; i < pts.length; i++) { var p = pts[i].clone().project(cam); mx = Math.max(mx, p.x); nx = Math.min(nx, p.x); my = Math.max(my, p.y); ny = Math.min(ny, p.y); }
      var ext = Math.max((mx - nx) / 2, (my - ny) / 2) / (1 - margin);
      // przesunięcie celu do środka obrysu
      var cx = (mx + nx) / 2, cy = (my + ny) / 2, right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      var hh = Math.tan(cam.fov * PI / 360) * d;
      tg.addScaledVector(right, cx * hh * aspect).addScaledVector(up, cy * hh);
      d *= ext;
    }
    cam.position.copy(tg).addScaledVector(dir, d); cam.lookAt(tg); cam.updateMatrixWorld();
    return d;
  }

  // ---------- zdjęcie studyjne (jeden wspólny renderer poza ekranem) ----------
  var SNAP = null;
  function snapRig() {
    if (SNAP !== null) return SNAP;
    try {
      var r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setClearColor(0x000000, 0);
      var sc = new THREE.Scene();
      sc.environment = Car3D.studioEnv(r);
      studioLights(sc, true);
      var floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.45 }));
      floor.rotation.x = -PI / 2; floor.receiveShadow = true; sc.add(floor);
      var bg = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.55, metalness: 0 }));
      bg.rotation.x = -PI / 2; bg.position.y = -0.002; bg.receiveShadow = true; bg.visible = false; sc.add(bg);
      SNAP = { r: r, scene: sc, cam: new THREE.PerspectiveCamera(22, 2, 0.1, 100), bg: bg };
    } catch (e) { SNAP = false; }
    return SNAP;
  }
  Car3D.snapshot = function (livery, helmet, opts) {
    opts = opts || {};
    var S = snapRig(); if (!S) return null;
    var w = Math.max(16, Math.round(opts.w || 480)), h = Math.max(16, Math.round(opts.h || 240)), ss = w * h < 400000 ? 2 : 1;
    try {
      var car = Car3D.build(livery, helmet, { quality: 'high', compound: opts.compound || '#f2f2f2', number: opts.number, halo: opts.halo });
      Car3D.pose(car, { steer: opts.steer || 0, v: 0, drs: !!opts.drs });
      S.scene.add(car);
      var studio = opts.background === 'studio';
      S.bg.visible = studio;
      S.r.setClearColor(studio ? 0x0d0f12 : 0x000000, studio ? 1 : 0);
      S.r.setPixelRatio(1); S.r.setSize(w * ss, h * ss, false);
      fitCamera(S.cam, opts.angle !== undefined ? opts.angle : 0.72, opts.elevation !== undefined ? opts.elevation : 0.24, w / h, 0.04);
      S.r.render(S.scene, S.cam);
      var out = mkCanvas(w, h), g = out.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(S.r.domElement, 0, 0, w, h);
      S.scene.remove(car); Car3D.dispose(car);
      return out;
    } catch (e) { return null; }
  };

  // ---------- salon: interaktywny podgląd 3D ----------
  Car3D.Showroom = function (container, opts) {
    opts = opts || {};
    var r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    var el = r.domElement;
    el.style.display = 'block'; el.style.width = '100%'; el.style.height = '100%'; el.style.touchAction = 'pan-y'; el.style.cursor = 'grab';
    el.setAttribute('aria-label', 'Bolid 3D — przeciągnij, aby obrócić; dwuklik otwiera lub zamyka DRS');
    container.appendChild(el);
    var scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 2, 0.1, 200);
    scene.environment = Car3D.studioEnv(r);
    scene.background = opts.transparent ? null : new THREE.Color(0x0b0d10);
    scene.fog = opts.transparent ? null : new THREE.Fog(0x0b0d10, 14, 30);
    studioLights(scene, true);
    // podłoga studia z gradientem i półprzezroczystym „odbiciem”
    var fc = mkCanvas(512, 512), fg = fc.getContext('2d'), grd = fg.createRadialGradient(256, 256, 10, 256, 256, 256);
    grd.addColorStop(0, '#3a3e46'); grd.addColorStop(0.35, '#23262c'); grd.addColorStop(0.75, '#121418'); grd.addColorStop(1, '#0b0d10');
    fg.fillStyle = grd; fg.fillRect(0, 0, 512, 512);
    var fTex = texCommon(new THREE.CanvasTexture(fc), true);
    var floorMat = new THREE.MeshStandardMaterial({ map: fTex, roughness: 0.32, metalness: 0.0, transparent: true, opacity: 0.86 });
    var floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), floorMat);
    floor.rotation.x = -PI / 2; floor.receiveShadow = true; scene.add(floor);
    // DRS: dwuklik przełącza, a w bezczynności klapa co kilka sekund otwiera się na pokaz (opts.drsDemo = false wyłącza)
    var st = {
      az: opts.angle !== undefined ? opts.angle : 0.75, el: 0.2, dist: 10, vaz: 0, drag: null, idle: 0, car: null, mirror: null, raf: 0, dead: false, last: 0, w: 0, h: 0,
      drsOn: false, demo: opts.drsDemo !== false, pose: { steer: 0.35, v: 0, drs: false }
    };
    function resize() {
      var w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight || Math.round(w * 0.5));
      if (w === st.w && h === st.h) return;
      st.w = w; st.h = h; r.setSize(w, h, false);
      cam.aspect = w / h;
      st.dist = fitCamera(cam, 0.75, 0.2, w / h, 0.08, new THREE.Vector3(-0.05, 0.38, 0)) ;
    }
    function place() {
      var c = Math.cos(st.el), tg = new THREE.Vector3(-0.05, 0.38, 0);
      cam.position.set(tg.x + st.dist * c * Math.cos(st.az), tg.y + st.dist * Math.sin(st.el), tg.z + st.dist * c * Math.sin(st.az));
      cam.lookAt(tg); cam.updateProjectionMatrix();
    }
    function frame(t) {
      if (st.dead) return;
      st.raf = requestAnimationFrame(frame);
      var dt = st.last ? Math.min(0.05, (t - st.last) / 1000) : 0; st.last = t;
      if (!el.isConnected || document.hidden) return;
      resize();
      if (!st.drag) {
        st.idle += dt;
        st.az += st.vaz * dt; st.vaz *= Math.exp(-dt * 3);
        if (st.idle > 2) st.az += dt * 0.22 * Math.min(1, (st.idle - 2) / 1.5);
      }
      place();
      if (st.car) {
        st.pose.drs = st.drsOn || (st.demo && !st.drag && st.idle > 4 && (st.idle - 4) % 7 < 2.6);
        Car3D.update(st.car, st.pose, dt);
        if (st.mirror) Car3D.update(st.mirror, st.pose, dt);
      }
      r.render(scene, cam);
    }
    function down(e) { st.drag = { x: e.clientX, y: e.clientY, az: st.az, el: st.el, t: performance.now() }; st.vaz = 0; el.style.cursor = 'grabbing'; if (el.setPointerCapture) try { el.setPointerCapture(e.pointerId); } catch (er) { /* brak */ } }
    function move(e) {
      if (!st.drag) return;
      var dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y, now = performance.now();
      var naz = st.drag.az + dx * 0.009;
      st.vaz = (naz - st.az) / Math.max(0.008, (now - st.drag.t) / 1000); st.drag.t = now;
      st.az = naz;
      if (e.pointerType === 'mouse') st.el = clamp(st.drag.el + dy * 0.006, 0.03, 1.1);
    }
    function up() { if (!st.drag) return; st.drag = null; st.idle = 0; el.style.cursor = 'grab'; st.vaz = clamp(st.vaz, -4, 4); }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    function dbl(e) { st.drsOn = !st.drsOn; if (e && e.preventDefault) e.preventDefault(); }
    el.addEventListener('dblclick', dbl);
    function setCar(lv, hm, o) {
      o = o || {};
      if (st.car) { Car3D.dispose(st.car); Car3D.dispose(st.mirror); }
      var bo = { quality: 'high', compound: o.compound || '#f2f2f2', number: o.number, halo: o.halo };
      st.pose.steer = o.steer !== undefined ? o.steer : 0.35;
      st.pose.drs = st.drsOn;
      st.car = Car3D.build(lv, hm, bo); Car3D.pose(st.car, st.pose);
      st.mirror = Car3D.build(lv, hm, bo); Car3D.pose(st.mirror, st.pose);
      st.mirror.scale.y = -1;
      // odbicie: bez cieni i bez własnego cienia kontaktowego
      st.mirror.traverse(function (m) { m.castShadow = false; m.receiveShadow = false; });
      st.mirror.userData.shadowOff = true; st.mirror.userData.shadow.visible = false;
      scene.add(st.car); scene.add(st.mirror);
    }
    function dispose() {
      if (st.dead) return;
      st.dead = true; cancelAnimationFrame(st.raf);
      LIVE = LIVE > 0 ? LIVE - 1 : 0;
      if (st.car) { Car3D.dispose(st.car); Car3D.dispose(st.mirror); }
      floor.geometry.dispose(); floorMat.dispose(); fTex.dispose();
      if (ENV && ENV.has(r)) { ENV.get(r).dispose(); ENV.delete(r); }
      r.dispose(); if (r.forceContextLoss) r.forceContextLoss();
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    resize(); place();
    LIVE++;
    st.raf = requestAnimationFrame(frame);
    return { setCar: setCar, setDrs: function (on) { st.drsOn = !!on; }, dispose: dispose, renderer: r, scene: scene, camera: cam, state: st };
  };
})(PG);
