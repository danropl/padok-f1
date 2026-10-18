// WORLD GP — świat 3D toru: niebo, światło i cienie (mapa cieni przy bolidzie + wypalone cienie dalekie),
// asfalt z gumą, krawężniki, pobocza, bariery z reklamami, ściany opon, siatki, trybuny z kibicami, boksy, padok,
// las (instancje), stary owal z mostem, podium, tablice hamowania i DRS, posterunki porządkowych, światła startu.
// API: scene, sun, sunDir, setFocus(x, z), setWeather(env), setStartLights(n), update(dt, camera), dispose().
(function (PG) {
  'use strict';

  var wrapI = function (i, n) { return ((i % n) + n) % n; };
  var PI2 = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function inRun(i, a, b) { return a <= b ? (i >= a && i <= b) : (i >= a || i <= b); }
  function warn(name, e) { try { if (window.console && console.warn) console.warn('Świat 3D: ' + name, e); } catch (e2) { /* nic */ } }

  // ---------- deterministyczny szum ----------
  function hash2(x, y) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  // szum wartości, kafelkowalny z okresem p
  function vnoise(x, y, p, seed) {
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sd = seed * 131;
    var x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    var a = hash2(x0 + sd, y0), b = hash2(x1 + sd, y0), c = hash2(x0 + sd, y1), d = hash2(x1 + sd, y1);
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function lin(hex) { var c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
  function shadeHex(hex, f) {
    var n = parseInt(String(hex).slice(1), 16) || 0, r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function t(v) { return Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f); }
    return 'rgb(' + t(r) + ',' + t(g) + ',' + t(b) + ')';
  }
  // ACES jak w three.js (do dopasowania koloru mgły do horyzontu)
  function aces(c, exp) {
    var k = exp / 0.6, r = c[0] * k, g = c[1] * k, b = c[2] * k;
    var ir = 0.59719 * r + 0.35458 * g + 0.04823 * b, ig = 0.07600 * r + 0.90834 * g + 0.01566 * b, ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
    function fit(v) { return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081); }
    ir = fit(ir); ig = fit(ig); ib = fit(ib);
    return [clamp(1.60475 * ir - 0.53108 * ig - 0.07367 * ib, 0, 1), clamp(-0.10208 * ir + 1.10813 * ig - 0.00605 * ib, 0, 1), clamp(-0.00327 * ir - 0.07276 * ig + 1.07602 * ib, 0, 1)];
  }

  // Odcinki próbek spełniające warunek: [[start, długość], ...]
  function runs(N, pred) {
    var out = [], start = -1, first = 0;
    while (first < N && pred(first)) first++;
    if (first === N) return [[0, N]];
    for (var k = 1; k <= N; k++) {
      var i = (first + k) % N;
      if (pred(i)) { if (start < 0) start = i; }
      else if (start >= 0) { out.push([start, wrapI(i - start, N)]); start = -1; }
    }
    if (start >= 0) out.push([start, wrapI(first - start, N)]);
    return out;
  }

  // ---------- tekstury proceduralne ----------
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(c, srgb, repeat, aniso) {
    var t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
    t.flipY = false; // v = 0 to górny wiersz kanwy
    t.anisotropy = aniso || 1;
    return t;
  }
  function fillPixels(c, fn) {
    var g = c.getContext('2d'), w = c.width, h = c.height, img = g.createImageData(w, h), d = img.data, o = [0, 0, 0];
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      fn(x, y, o); var k = (y * w + x) * 4;
      d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return g;
  }
  // kółko z kopiami przy brzegach (kafel bez szwów)
  function dotWrap(g, S, x, y, r) {
    for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
      var X = x + ox * S, Y = y + oy * S;
      if (X < -r || X > S + r || Y < -r || Y > S + r) continue;
      g.beginPath(); g.arc(X, Y, r, 0, 6.2832); g.fill();
    }
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  var FONT = '"Titillium Web", "Arial Black", Arial, sans-serif';

  // Kanwa z tablic: kolor (0..1, sRGB, 3 kanały) albo skala szarości (1 kanał)
  function canvasOf(S, A, ch) {
    var c = makeCanvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, n = S * S;
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      if (ch === 3) { d[o] = A[i * 3] * 255; d[o + 1] = A[i * 3 + 1] * 255; d[o + 2] = A[i * 3 + 2] * 255; }
      else d[o] = d[o + 1] = d[o + 2] = A[i] * 255;
      d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // Mapa normalnych z pola wysokości (kafel bez szwów, wysokość w pikselach); k — siła nachylenia
  function normalFromHeight(H, S, k) {
    var c = makeCanvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    for (var y = 0; y < S; y++) {
      var yu = ((y - 1 + S) % S) * S, yd = ((y + 1) % S) * S, yr = y * S;
      for (var x = 0; x < S; x++) {
        var xl = (x - 1 + S) % S, xr = (x + 1) % S;
        var dx = (H[yr + xr] - H[yr + xl]) * k, dy = (H[yd + x] - H[yu + x]) * k;
        var il = 1 / Math.sqrt(dx * dx + dy * dy + 1), o = (yr + x) * 4;
        d[o] = (0.5 - 0.5 * dx * il) * 255; d[o + 1] = (0.5 - 0.5 * dy * il) * 255; d[o + 2] = (0.5 + 0.5 * il) * 255; d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // Ziarno (elipsa z kopułą) w polu wysokości z kolorem; zawija się na brzegach kafla
  function grain(S, H, C, RG, x0, y0, a, b, ang, hp, col, rough, shade) {
    var ca = Math.cos(ang), sa = Math.sin(ang), r = Math.ceil(Math.max(a, b)) + 1;
    var xi0 = Math.floor(x0), yi0 = Math.floor(y0);
    for (var yy = yi0 - r; yy <= yi0 + r; yy++) {
      var py = ((yy % S) + S) % S, dy = yy + 0.5 - y0;
      for (var xx = xi0 - r; xx <= xi0 + r; xx++) {
        var dx = xx + 0.5 - x0, u = (dx * ca + dy * sa) / a, w = (-dx * sa + dy * ca) / b, d2 = u * u + w * w;
        if (d2 >= 1) continue;
        var h = Math.sqrt(1 - d2), z = hp * h, i = py * S + ((xx % S) + S) % S;
        if (z <= H[i]) continue;
        H[i] = z;
        var k = 1 - shade + shade * Math.sqrt(h); // ciemniejsze brzegi ziarna (szczeliny)
        C[i * 3] = col[0] * k; C[i * 3 + 1] = col[1] * k; C[i * 3 + 2] = col[2] * k;
        if (RG) RG[i] = rough;
      }
    }
  }

  // asfalt: spoiwo, gęste kruszywo, wypolerowane wierzchołki kamieni (kafel 4 m): kolor, szorstkość, normalne
  function texAsphalt(S) {
    var n = S * S, H = new Float32Array(n), C = new Float32Array(n * 3), RG = new Float32Array(n), P = S / 32, x, y, i;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      i = y * S + x;
      var f = hash2(x, y) - 0.5, m = vnoise(x / P, y / P, 32, 3) - 0.5, M = vnoise(x / (P * 4), y / (P * 4), 8, 9) - 0.5;
      var v = 0.29 + f * 0.03 + m * 0.025 + M * 0.03;
      C[i * 3] = v; C[i * 3 + 1] = v * 1.01; C[i * 3 + 2] = v * 1.045;
      H[i] = f * 0.2 + m * 0.25 - 0.4; RG[i] = 0.95 + f * 0.05;
    }
    // kruszywo 3–12 mm: w większości oblepione ciemnym spoiwem, część wytarta do jasnego kamienia
    var R = rng(11), mm = S / 4000, cnt = Math.round(n * 0.75 / (Math.PI * Math.pow(Math.max(0.8, 3.2 * mm), 2)));
    for (var k = 0; k < cnt; k++) {
      var rr = (1.5 + R() * R() * 4.5) * mm, a = Math.max(0.6, rr), b = Math.max(0.55, rr * (0.6 + R() * 0.4)), t = R(), lum, warm = (R() - 0.5) * 0.025;
      if (t < 0.72) lum = 0.2 + R() * 0.1; else if (t < 0.97) lum = 0.33 + R() * 0.16; else lum = 0.55 + R() * 0.12;
      grain(S, H, C, RG, R() * S, R() * S, a, b, R() * PI2, a * 0.9, [lum + warm, lum, lum - warm + 0.012], t < 0.72 ? 0.9 : 0.62, 0.35);
    }
    // drobne ubytki (ciemne pory)
    for (k = 0; k < n / 90; k++) { i = (R() * n) | 0; H[i] -= 0.8; C[i * 3] *= 0.6; C[i * 3 + 1] *= 0.6; C[i * 3 + 2] *= 0.6; RG[i] = 1; }
    return { col: canvasOf(S, C, 3), rgh: canvasOf(S, RG, 1), nrm: normalFromHeight(H, S, 0.55) };
  }
  // Źdźbła trawy w tablicy koloru: krótkie kreski z losowym nachyleniem (kierunek bazowy dir, rozrzut spread)
  function blades(S, C, count, R, dir, spread, len, pal) {
    for (var k = 0; k < count; k++) {
      var x = R() * S, y = R() * S, an = dir + (R() - 0.5) * spread, L = len[0] + R() * (len[1] - len[0]);
      var dx = Math.cos(an), dy = Math.sin(an), c = pal[(R() * pal.length) | 0], al = 0.35 + R() * 0.45, steps = Math.ceil(L);
      for (var s = 0; s <= steps; s++) {
        var t = s / steps, px = ((Math.round(x + dx * L * t) % S) + S) % S, py = ((Math.round(y + dy * L * t) % S) + S) % S, i = (py * S + px) * 3;
        var a = al * (0.5 + 0.5 * t); // końcówka źdźbła jaśniejsza i bardziej kryjąca
        C[i] += (c[0] - C[i]) * a; C[i + 1] += (c[1] - C[i + 1]) * a; C[i + 2] += (c[2] - C[i + 2]) * a;
      }
    }
  }
  // trawa parku (kafel 10 m): plamy suchej i soczystej trawy, kępy, źdźbła w różnych kierunkach
  function texGrass(S) {
    var n = S * S, C = new Float32Array(n * 3), x, y;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var i = (y * S + x) * 3, n1 = vnoise(x / (S / 8), y / (S / 8), 8, 21), n2 = vnoise(x / (S / 32), y / (S / 32), 32, 22);
      var dry = clamp(vnoise(x / (S / 4), y / (S / 4), 4, 23) * 1.4 - 0.45, 0, 1), v = 0.78 + n1 * 0.22 + n2 * 0.14 + (hash2(x + 99, y) - 0.5) * 0.12;
      C[i] = (0.22 + dry * 0.12) * v; C[i + 1] = (0.33 + dry * 0.04) * v; C[i + 2] = (0.13 - dry * 0.02) * v;
    }
    var R = rng(5);
    blades(S, C, n / 3, R, 0, PI2, [2, S / 128 + 3], [[0.16, 0.27, 0.09], [0.27, 0.4, 0.15], [0.36, 0.45, 0.2], [0.2, 0.33, 0.1], [0.42, 0.44, 0.24]]);
    return canvasOf(S, C, 3);
  }
  // koszony trawnik przy torze (kafel 12 m): pasy koszenia wzdłuż v — źdźbła położone w przeciwne strony
  function texLawn(S) {
    var n = S * S, C = new Float32Array(n * 3), x, y;
    for (y = 0; y < S; y++) for (x = 0; x < S; x++) {
      var i = (y * S + x) * 3, st = clamp(Math.sin(y / S * Math.PI * 2) * 3, -1, 1);
      var v = 1 + st * 0.06 + (vnoise(x / (S / 16), y / (S / 16), 16, 31) - 0.5) * 0.16 + (vnoise(x / (S / 4), y / (S / 4), 4, 32) - 0.5) * 0.1;
      C[i] = 0.25 * v; C[i + 1] = 0.39 * v; C[i + 2] = 0.16 * v;
    }
    var R = rng(6), pal = [[0.2, 0.33, 0.12], [0.3, 0.46, 0.19], [0.37, 0.5, 0.23], [0.24, 0.38, 0.14]];
    for (var half = 0; half < 2; half++) {
      // źdźbła w każdym pasie pochylone zgodnie z kierunkiem koszenia
      var Cs = new Float32Array(C);
      blades(S, Cs, n / 4, R, half ? -Math.PI / 2 : Math.PI / 2, 1.1, [2, S / 160 + 3], pal);
      for (y = 0; y < S; y++) {
        var inHalf = Math.sin(y / S * Math.PI * 2) >= 0 ? 0 : 1;
        if (inHalf !== half) continue;
        for (x = 0; x < S; x++) { var j = (y * S + x) * 3; C[j] = Cs[j]; C[j + 1] = Cs[j + 1]; C[j + 2] = Cs[j + 2]; }
      }
    }
    return canvasOf(S, C, 3);
  }
  // żwir (kafel 2,5 m): zaokrąglone otoczaki 8–22 mm w kilku odcieniach, ciemne szczeliny między nimi, normalne
  function texGravel(S) {
    var n = S * S, H = new Float32Array(n), C = new Float32Array(n * 3), i;
    for (i = 0; i < n; i++) {
      var x = i % S, y = (i / S) | 0, f = hash2(x + 3, y + 11), v = 0.16 + f * 0.05 + (vnoise(x / (S / 16), y / (S / 16), 16, 41) - 0.5) * 0.05;
      C[i * 3] = v * 1.15; C[i * 3 + 1] = v; C[i * 3 + 2] = v * 0.8; H[i] = -2 + f;
    }
    var R = rng(12), mm = S / 2500;
    var PAL = [[0.72, 0.64, 0.5], [0.8, 0.74, 0.6], [0.6, 0.53, 0.42], [0.68, 0.66, 0.62], [0.86, 0.82, 0.74], [0.52, 0.48, 0.43], [0.76, 0.68, 0.53], [0.62, 0.58, 0.54], [0.7, 0.6, 0.46]];
    var cnt = Math.round(n * 1.5 / (Math.PI * Math.pow(6.5 * mm, 2)));
    for (var k = 0; k < cnt; k++) {
      var r = (4 + R() * R() * 7) * mm, c = PAL[(R() * PAL.length) | 0], lv = 0.85 + R() * 0.3;
      grain(S, H, C, null, R() * S, R() * S, Math.max(0.8, r), Math.max(0.7, r * (0.6 + R() * 0.35)), R() * PI2, r * 0.8, [c[0] * lv, c[1] * lv, c[2] * lv], 0, 0.45);
    }
    return { col: canvasOf(S, C, 3), nrm: normalFromHeight(H, S, 0.7) };
  }
  // smugi gumy w strefach hamowania: G = krycie (u w poprzek pasa 2 m, v wzdłuż, okres 24 m)
  function texStreaks() {
    var W = 64, Hh = 512, C = new Float32Array(W * Hh), R = rng(19), x, y;
    for (var k = 0; k < 46; k++) {
      var cx = 4 + R() * (W - 8), w = 0.6 + R() * 2.2, a = 0.25 + R() * 0.75, y0 = R() * Hh, L = Hh * (0.2 + R() * 0.8), drift = (R() - 0.5) * 3;
      for (var s = 0; s < L; s++) {
        y = Math.floor(y0 + s) % Hh;
        var t = s / L, xc = cx + drift * t, aa = a * Math.sin(Math.PI * t) * (0.7 + 0.3 * vnoise(s / 9, k, 1e6, 3));
        for (x = Math.floor(xc - w - 1); x <= Math.ceil(xc + w + 1); x++) {
          if (x < 0 || x >= W) continue;
          var e = 1 - Math.abs(x + 0.5 - xc) / (w + 0.8);
          if (e > 0) C[y * W + x] = Math.min(1, C[y * W + x] + aa * e);
        }
      }
    }
    var c = makeCanvas(W, Hh), g = c.getContext('2d'), img = g.createImageData(W, Hh), d = img.data;
    for (y = 0; y < Hh; y++) for (x = 0; x < W; x++) {
      var edge = Math.min(1, Math.min(x, W - 1 - x) / 10), o = (y * W + x) * 4, v = Math.round(C[y * W + x] * edge * 255);
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // krawężnik: u w poprzek (0 = przy asfalcie), v wzdłuż (okres 2,5 m: czerwony + biały)
  function texKerb() {
    var c = makeCanvas(64, 256), g = c.getContext('2d');
    g.fillStyle = '#c81e28'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#efeee8'; g.fillRect(0, 128, 64, 128);
    for (var y = 0; y < 256; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(8, y, 50, 3);
      g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(8, y + 3, 50, 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(58, 0, 6, 256);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 3, 256);
    var R = rng(13);
    for (var k = 0; k < 900; k++) { g.fillStyle = R() < 0.6 ? 'rgba(20,20,22,0.10)' : 'rgba(255,255,255,0.06)'; g.fillRect(R() * 64, R() * 256, 1 + R() * 2, 1 + R() * 2); }
    return c;
  }
  // beton (kafel 4 m)
  function texConcrete(S) {
    var c = makeCanvas(S, S);
    var g = fillPixels(c, function (x, y, o) {
      var n = (hash2(x + 3, y) - 0.5) * 14 + (vnoise(x / (S / 16), y / (S / 16), 16, 51) - 0.5) * 18 + (vnoise(x / (S / 4), y / (S / 4), 4, 52) - 0.5) * 14;
      o[0] = 184 + n; o[1] = 180 + n; o[2] = 171 + n;
    });
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, 2, S); g.fillRect(S / 2, 0, 2, S);
    var R = rng(14);
    for (var k = 0; k < 40; k++) { g.fillStyle = 'rgba(60,55,45,0.05)'; dotWrap(g, S, R() * S, R() * S, 6 + R() * 18); }
    return c;
  }
  // blacha falista
  function texRoof() {
    var c = makeCanvas(128, 128);
    fillPixels(c, function (x, y, o) {
      var s = Math.sin(x / 128 * Math.PI * 16) * 0.5 + 0.5, v = 168 + s * 34 + (hash2(x, y + 77) - 0.5) * 8;
      o[0] = v; o[1] = v + 2; o[2] = v + 5;
    });
    return c;
  }
  // siatka ogrodzenia (przezroczysta, kafel 1,2 m)
  function texFence() {
    var c = makeCanvas(128, 128), g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(200,206,212,0.95)'; g.lineWidth = 1.6;
    for (var k = -128; k <= 256; k += 16) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke();
    }
    return c;
  }
  // ściana opon: wiersze 0-63 pas A, 64-127 pas B, 128-255 opony z góry
  function texTyre() {
    var c = makeCanvas(256, 256), g = c.getContext('2d');
    function bolt(x, y) { g.beginPath(); g.arc(x, y, 2.5, 0, 6.3); g.fill(); }
    function belt(y0, a, b) {
      g.fillStyle = a; g.fillRect(0, y0, 256, 64);
      g.fillStyle = b; g.fillRect(0, y0 + 22, 256, 20);
      for (var x = 0; x < 256; x += 64) {
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y0, 3, 64);
        g.fillStyle = 'rgba(0,0,0,0.4)'; bolt(x + 12, y0 + 10); bolt(x + 52, y0 + 10); bolt(x + 12, y0 + 54); bolt(x + 52, y0 + 54);
      }
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y0, 256, 3);
    }
    belt(0, '#d42a2a', '#f2f2f0');
    belt(64, '#1f4fbf', '#f2c230');
    g.fillStyle = '#18191b'; g.fillRect(0, 128, 256, 128);
    for (var row = 0; row < 2; row++) for (var x2 = 0; x2 < 256; x2 += 64) {
      var cx = x2 + 32, cy = 160 + row * 64;
      g.fillStyle = '#2c2d31'; g.beginPath(); g.arc(cx, cy, 30, 0, 6.3); g.fill();
      g.fillStyle = '#0b0b0c'; g.beginPath(); g.arc(cx, cy, 15, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 24, 0, 6.3); g.stroke();
    }
    return c;
  }
  function texChecker() {
    var c = makeCanvas(64, 64), g = c.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#121212'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
    return c;
  }
  // płyty padoku (kafel 6 m)
  function texPaddock(S) {
    var c = makeCanvas(S, S);
    var g = fillPixels(c, function (x, y, o) {
      var n = (hash2(x, y + 21) - 0.5) * 12 + (vnoise(x / (S / 8), y / (S / 8), 8, 61) - 0.5) * 16;
      o[0] = 142 + n; o[1] = 145 + n; o[2] = 149 + n;
    });
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, 0, S, 2); g.fillRect(0, S / 2, S, 2); g.fillRect(0, 0, 2, S); g.fillRect(S / 2, 0, 2, S);
    return c;
  }
  // przeszklenia z ramami
  function texGlass() {
    var c = makeCanvas(128, 128), g = c.getContext('2d');
    var gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#3a5068'); gr.addColorStop(1, '#16212c');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    var R = rng(15);
    for (var x = 0; x < 128; x += 32) { g.fillStyle = 'rgba(255,255,255,' + (0.03 + R() * 0.07).toFixed(3) + ')'; g.fillRect(x, 0, 32, 128); }
    g.fillStyle = '#8d96a0';
    for (var x2 = 0; x2 < 128; x2 += 32) g.fillRect(x2, 0, 3, 128);
    g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4);
    return c;
  }
  // fasada boksów: lewa połowa garaż (górny pas barwiony kolorem zespołu), prawa ściana
  function texFacade() {
    var c = makeCanvas(512, 256), g = c.getContext('2d'), R = rng(16);
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 256, 50);
    var gr = g.createLinearGradient(0, 50, 0, 256); gr.addColorStop(0, '#3b424b'); gr.addColorStop(1, '#1a1d22');
    g.fillStyle = gr; g.fillRect(0, 50, 256, 206);
    g.fillStyle = '#5a6370'; g.fillRect(10, 80, 236, 110);
    g.fillStyle = 'rgba(255,255,255,0.85)'; for (var x = 14; x < 246; x += 26) g.fillRect(x, 56, 16, 4);
    for (var k = 0; k < 14; k++) { g.fillStyle = R() < 0.5 ? '#2a2f36' : '#7b8592'; g.fillRect(12 + R() * 220, 150 + R() * 20, 12 + R() * 20, 24 + R() * 16); }
    g.fillStyle = '#a3a7ad'; g.fillRect(122, 50, 12, 206); g.fillRect(0, 50, 6, 206); g.fillRect(250, 50, 6, 206);
    g.fillStyle = '#2a2e33'; g.fillRect(0, 248, 256, 8);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 46, 256, 4);
    g.fillStyle = '#c9ccd1'; g.fillRect(256, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (var x2 = 256; x2 < 512; x2 += 32) g.fillRect(x2, 0, 2, 256);
    g.fillRect(256, 127, 256, 2);
    for (var k2 = 0; k2 < 600; k2++) { g.fillStyle = 'rgba(0,0,0,0.04)'; g.fillRect(256 + R() * 254, R() * 254, 2, 2); }
    return c;
  }
  // fikcyjni sponsorzy: [nazwa, tło, tekst, akcent]
  var SPONSORS = [
    ['VELTRONIX', '#0d2a6b', '#ffffff', '#ffcc00'],
    ['AQUAMONTI', '#eaf5fb', '#0a5fa8', '#39b0e6'],
    ['LAMBRO OIL', '#d7261e', '#ffffff', '#111111'],
    ['CAFFÈ VITTORIA', '#2b1a12', '#f3d9a6', '#c8102e'],
    ['BRIANZA BANK', '#0f5132', '#ffffff', '#e7c65a'],
    ['ZEFIRO SOLAR', '#ffcf1a', '#1b1b1b', '#e1251b'],
    ['ORBIS TEL', '#111418', '#18e0c8', '#ffffff'],
    ['FULMINE', '#ffffff', '#d7261e', '#111111']
  ];
  // reklamy: 8 wierszy po 1024x128 (panel 8 m x 1 m)
  function texHoard() {
    var c = makeCanvas(1024, 1024), g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    SPONSORS.forEach(function (s, k) {
      var y = k * 128;
      g.fillStyle = s[1]; g.fillRect(0, y, 1024, 128);
      g.fillStyle = s[3];
      g.beginPath(); g.moveTo(40, y + 128); g.lineTo(90, y); g.lineTo(130, y); g.lineTo(80, y + 128); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(894, y + 128); g.lineTo(944, y); g.lineTo(984, y); g.lineTo(934, y + 128); g.closePath(); g.fill();
      var fs = 84; g.font = 'italic 900 ' + fs + 'px ' + FONT;
      while (g.measureText(s[0]).width > 720 && fs > 30) { fs -= 4; g.font = 'italic 900 ' + fs + 'px ' + FONT; }
      g.fillStyle = s[2]; g.fillText(s[0], 512, y + 68);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, 4, 128); g.fillRect(1020, y, 4, 128);
    });
    return c;
  }
  // tablice: wiersz 0 hamowanie (200/150/100/50), wiersz 1 DRS, potem nazwy zespołów (10 x 48 px)
  function texSigns(teams) {
    var c = makeCanvas(1024, 1024), g = c.getContext('2d');
    g.fillStyle = '#6b7078'; g.fillRect(0, 0, 1024, 1024);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [200, 150, 100, 50].forEach(function (n, k) {
      var x = k * 256;
      g.fillStyle = '#f5f5f2'; g.fillRect(x + 4, 4, 248, 248);
      g.strokeStyle = '#d01f26'; g.lineWidth = 12; g.strokeRect(x + 14, 14, 228, 228);
      g.fillStyle = '#111111'; g.font = '900 112px ' + FONT; g.fillText(String(n), x + 128, 134);
    });
    [['#ffd21a', '#111111', 'DETEKCJA'], ['#18a957', '#ffffff', 'AKTYWACJA']].forEach(function (d, k) {
      var x = k * 512;
      g.fillStyle = d[0]; g.fillRect(x + 4, 260, 504, 248);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 8; g.strokeRect(x + 14, 270, 484, 228);
      g.fillStyle = d[1]; g.font = 'italic 900 150px ' + FONT; g.fillText('DRS', x + 256, 360);
      g.font = '700 46px ' + FONT; g.fillText(d[2], x + 256, 462);
    });
    g.textAlign = 'left';
    for (var t = 0; t < 10; t++) {
      var y = 512 + t * 48, tm = teams[t];
      g.fillStyle = '#121418'; g.fillRect(0, y, 1024, 48);
      if (!tm) continue;
      var lv = tm.livery || {};
      g.fillStyle = lv.primary || '#888888'; g.fillRect(0, y + 2, 34, 44);
      g.fillStyle = lv.secondary || '#ffffff'; g.fillRect(34, y + 2, 8, 44);
      var name = String(tm.name || '').toUpperCase(), fs = 34;
      g.fillStyle = '#ffffff'; g.font = '700 ' + fs + 'px ' + FONT;
      while (g.measureText(name).width > 950 && fs > 16) { fs -= 2; g.font = '700 ' + fs + 'px ' + FONT; }
      g.fillText(name, 58, y + 25);
    }
    return c;
  }
  // kibice: kafel 4 m, 0-92 px podstopnica (widok z przodu), 92-256 stopień (dwa rzędy z góry)
  var CROWD_A = ['#d4202a', '#d4202a', '#d4202a', '#b5121b', '#f2f0ea', '#f2c230', '#1f1f1f', '#1f4fbf', '#2f8f46'];
  var CROWD_B = ['#f2f0ea', '#1f4fbf', '#f28a1a', '#2f8f46', '#1f1f1f', '#d4202a', '#7f3fbf', '#18a0c8', '#f2c230'];
  function texCrowd(seed, shirts, seat) {
    var c = makeCanvas(256, 256), g = c.getContext('2d'), R = rng(seed);
    var skins = ['#f1c9a5', '#e0ac85', '#c68b62', '#8d5a3b', '#f5d6bc'];
    var hair = ['#2b1d14', '#4a3423', '#111111', '#7a5a35', '#c9a36a', '#555555'];
    function pick(a) { return a[(R() * a.length) | 0]; }
    g.fillStyle = seat; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 84, 256, 8);
    for (var x = 0; x < 256; x += 32) {
      g.fillStyle = shadeHex(seat, -0.25); g.fillRect(x + 4, 40, 24, 30);
      if (R() > 0.86) continue;
      var jx = (R() - 0.5) * 4, up = R() < 0.18;
      g.fillStyle = pick(shirts); rrect(g, x + 6 + jx, 34, 20, 50, 6); g.fill();
      if (up) { g.fillRect(x + 4 + jx, 8, 4, 28); g.fillRect(x + 24 + jx, 8, 4, 28); }
      g.fillStyle = pick(skins); g.beginPath(); g.arc(x + 16 + jx, 24, 8, 0, 6.3); g.fill();
      g.fillStyle = pick(hair); g.beginPath(); g.arc(x + 16 + jx, 21, 8, Math.PI, 0); g.fill();
      if (R() < 0.08) { g.fillStyle = '#d4202a'; g.fillRect(x + 2 + jx, 0, 24, 13); g.fillStyle = '#f2c230'; g.fillRect(x + 10 + jx, 3, 8, 7); }
    }
    for (var row = 0; row < 2; row++) {
      var y0 = 92 + row * 82;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y0, 256, 5);
      for (var x2 = 0; x2 < 256; x2 += 32) {
        if (R() > 0.84) { g.fillStyle = shadeHex(seat, -0.12); g.fillRect(x2 + 5, y0 + 30, 22, 30); continue; }
        var jx2 = (R() - 0.5) * 5, jy = (R() - 0.5) * 8;
        g.fillStyle = pick(shirts); g.beginPath(); g.ellipse(x2 + 16 + jx2, y0 + 46 + jy, 13, 18, 0, 0, 6.3); g.fill();
        g.fillStyle = pick(hair); g.beginPath(); g.arc(x2 + 16 + jx2, y0 + 30 + jy, 7.5, 0, 6.3); g.fill();
      }
    }
    return c;
  }

  // ---------- wstrzyknięcia do shaderów ----------
  // Wypalone cienie dalekie i AO: tekstura w rzucie z góry, wygaszana w zasięgu prawdziwej mapy cieni
  var FAR_V_PARS = '\nvarying vec2 vFarW;\n';
  var FAR_F_PARS = '\nvarying vec2 vFarW;\nuniform sampler2D uFarTex;\nuniform vec4 uFarXf;\nuniform vec4 uFarFade;\nuniform vec2 uFarStr;\n';
  var FAR_APPLY = [
    '{',
    '  vec4 fT = texture2D( uFarTex, ( vFarW - uFarXf.xy ) * uFarXf.zw );',
    '  float fD = distance( vFarW, uFarFade.xy );',
    '  float fK = clamp( ( fD - uFarFade.z ) / max( uFarFade.w - uFarFade.z, 0.001 ), 0.0, 1.0 );',
    '  fK = fK * fK * ( 3.0 - 2.0 * fK );',
    '  float fS = mix( 1.0, fT.r, fK * uFarStr.x );',
    '  reflectedLight.directDiffuse *= fS;',
    '  reflectedLight.directSpecular *= fS;',
    '  reflectedLight.indirectDiffuse *= mix( 1.0, fT.g, uFarStr.y );',
    '}'
  ].join('\n');
  // extra(sh) — dodatkowe zmiany shadera tego materiału, key — jego klucz w pamięci programów
  function farShadowMat(mat, U, extra, key) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uFarTex = U.tex; sh.uniforms.uFarXf = U.xf; sh.uniforms.uFarFade = U.fade; sh.uniforms.uFarStr = U.str;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + FAR_V_PARS)
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n\tvFarW = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>' + FAR_F_PARS)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FAR_APPLY);
      if (extra) extra(sh);
    };
    mat.customProgramCacheKey = function () { return 'pgFarShadow1' + (key || ''); };
  }
  // smugi gumy: kolor wierzchołka (G) to krycie, barwa zostaje stała
  function rubberShader(sh) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#if defined( USE_COLOR )\n\tdiffuseColor.a *= vColor.g;\n#endif');
  }
  // Trawa oświetlona „kulistymi" normalnymi: tylna strona karty nie odwraca normalnej (bez ciemnych plam)
  var NO_FLIP = '#include <normal_fragment_begin>\n\tnormal = normalize( vNormal );';

  // Tekstura z łańcuchem mipmap, w którym kanał alfa zachowuje pokrycie (liście i trawa nie znikają z odległości).
  // d0: RGBA (Uint8ClampedArray), tło przezroczyste dostaje kolor bg (bez ciemnych obwódek przy filtrowaniu).
  function coverageTexture(d0, W, Hh, bg, thr) {
    var n = W * Hh, i, base = new Uint8Array(n * 4), cov0 = 0;
    for (i = 0; i < n; i++) {
      var o = i * 4, a = d0[o + 3];
      if (a < 8) { base[o] = bg[0]; base[o + 1] = bg[1]; base[o + 2] = bg[2]; base[o + 3] = 0; }
      else { base[o] = d0[o]; base[o + 1] = d0[o + 1]; base[o + 2] = d0[o + 2]; base[o + 3] = a; } // getImageData: bez mnożenia przez alfę
      if (a >= thr) cov0++;
    }
    cov0 /= n;
    var levels = [{ data: base, width: W, height: Hh }], src = base, w = W, h = Hh;
    function covOf(d, cnt, s) { var c = 0; for (var k = 0; k < cnt; k++) if (d[k * 4 + 3] * s >= thr) c++; return c / cnt; }
    while (w > 1 || h > 1) {
      var nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), dst = new Uint8Array(nw * nh * 4);
      for (var y = 0; y < nh; y++) for (var x = 0; x < nw; x++) {
        var sr = 0, sg = 0, sb = 0, sa = 0, cr = 0, cg = 0, cb = 0;
        for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++) {
          var sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), so = (sy * w + sx) * 4, al = src[so + 3];
          sr += src[so] * al; sg += src[so + 1] * al; sb += src[so + 2] * al; sa += al;
          cr += src[so]; cg += src[so + 1]; cb += src[so + 2];
        }
        var o2 = (y * nw + x) * 4;
        if (sa > 0) { dst[o2] = sr / sa; dst[o2 + 1] = sg / sa; dst[o2 + 2] = sb / sa; } else { dst[o2] = cr / 4; dst[o2 + 1] = cg / 4; dst[o2 + 2] = cb / 4; }
        dst[o2 + 3] = sa / 4;
      }
      // skala alfy dobrana tak, by odsetek tekseli powyżej progu był jak na pełnej rozdzielczości
      var cnt = nw * nh, lo2 = 1, hi2 = 4;
      for (var it = 0; it < 10; it++) { var mid = (lo2 + hi2) / 2; if (covOf(dst, cnt, mid) < cov0) lo2 = mid; else hi2 = mid; }
      for (i = 0; i < cnt; i++) dst[i * 4 + 3] = Math.min(255, dst[i * 4 + 3] * hi2);
      levels.push({ data: dst, width: nw, height: nh });
      src = dst; w = nw; h = nh;
    }
    var t = new THREE.DataTexture(base, W, Hh, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = levels; t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }
  // Kępka trawy: źdźbła od podstawy (v = 1) do góry (v = 0), ciemniejsze u nasady
  function texGrassTuft() {
    var W = 256, Hh = 128, c = makeCanvas(W, Hh), g = c.getContext('2d'), R = rng(83);
    g.clearRect(0, 0, W, Hh);
    g.lineCap = 'round';
    for (var k = 0; k < 64; k++) {
      var x0 = 16 + R() * (W - 32), h = Hh * (0.45 + R() * 0.53), bend = (R() - 0.5) * 60, w = 2.2 + R() * 3, lum = R();
      var gr = g.createLinearGradient(0, Hh, 0, Hh - h);
      gr.addColorStop(0, 'rgb(38,58,22)');
      gr.addColorStop(0.55, lum < 0.5 ? 'rgb(84,118,48)' : 'rgb(96,126,54)');
      gr.addColorStop(1, lum < 0.8 ? 'rgb(128,152,72)' : 'rgb(156,160,92)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x0 - w, Hh); g.quadraticCurveTo(x0 + bend * 0.3, Hh - h * 0.6, x0 + bend, Hh - h); g.quadraticCurveTo(x0 + bend * 0.3 + w * 0.3, Hh - h * 0.6, x0 + w, Hh); g.closePath(); g.fill();
    }
    return coverageTexture(g.getImageData(0, 0, W, Hh).data, W, Hh, [70, 100, 40], 128);
  }

  // Niebo: gradient, słońce z poświatą, warstwa chmur; pas horyzontu w kolorze mgły
  var SKY_VS = [
    'varying vec3 vDir;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
    '  vDir = wp.xyz - cameraPosition;',
    '  vec4 p = projectionMatrix * viewMatrix * wp;',
    '  p.z = p.w * 0.99999;',
    '  gl_Position = p;',
    '}'
  ].join('\n');
  var SKY_FS = [
    'uniform vec3 uSunDir;',
    'uniform vec3 uZenith;',
    'uniform vec3 uHorizon;',
    'uniform vec3 uGround;',
    'uniform vec3 uSunCol;',
    'uniform vec3 uCloudCol;',
    'uniform vec4 uCloud;',
    'uniform float uSunDisk;',
    'uniform float uHaze;',
    'varying vec3 vDir;',
    '#ifdef USE_FOG',
    'uniform vec3 fogColor;',
    '#endif',
    'float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }',
    'float vn( vec2 p ) {',
    '  vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );',
    '  return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );',
    '}',
    'float fbm( vec2 p ) {',
    '  float a = 0.5, s = 0.0;',
    '  for ( int i = 0; i < 5; i ++ ) { s += a * vn( p ); p = p * 2.03 + vec2( 17.1, 9.2 ); a *= 0.5; }',
    '  return s;',
    '}',
    'void main() {',
    '  vec3 d = normalize( vDir );',
    '  float h = d.y;',
    '  vec3 col = mix( uHorizon, uZenith, pow( clamp( h, 0.0, 1.0 ), 0.5 ) );',
    '  col = mix( col, uGround, 1.0 - smoothstep( -0.08, 0.0, h ) );',
    '  float cs = max( dot( d, uSunDir ), 0.0 );',
    '  col += uSunCol * ( pow( cs, 6.0 ) * 0.10 + pow( cs, 48.0 ) * 0.30 ) * ( 1.0 - uCloud.x * 0.6 );',
    '  float cl = 0.0;',
    '  if ( h > 0.0 ) {',
    '    vec2 uv = d.xz / ( h * 0.9 + 0.1 ) * 1.4 + vec2( uCloud.z * 0.006, uCloud.z * 0.002 );',
    '    float n = fbm( uv );',
    '    cl = smoothstep( 1.0 - uCloud.x - 0.08, 1.0 - uCloud.x + 0.32, n ) * smoothstep( 0.0, 0.18, h ) * uCloud.w;',
    '    float thick = smoothstep( 0.45, 1.0, n );',
    '    vec3 cc = uCloudCol * ( 1.0 - uCloud.y * thick ) + uSunCol * pow( cs, 4.0 ) * 0.18 * ( 1.0 - thick );',
    '    col = mix( col, cc, cl );',
    '  }',
    '  col += uSunCol * smoothstep( 0.99986, 0.99993, cs ) * 30.0 * uSunDisk * ( 1.0 - cl * 0.9 );',
    '  gl_FragColor = vec4( col, 1.0 );',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '  #ifdef USE_FOG',
    '    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, 1.0 - smoothstep( 0.0, uHaze, h ) );',
    '  #endif',
    '}'
  ].join('\n');

  // Warianty pogody (wartości liniowe)
  var WEATHER = {
    sun: {
      sunI: 3.9, sunC: [1.0, 0.94, 0.84], hemiI: 0.85, hemiS: [0.62, 0.74, 0.95], hemiG: [0.32, 0.34, 0.2],
      zen: [0.11, 0.27, 0.68], hor: [0.66, 0.77, 0.9], gnd: [0.22, 0.25, 0.2], skySun: [1.0, 0.92, 0.8], cloudC: [0.96, 0.97, 1.0],
      cloud: [0.36, 0.38, 0.92], disk: 1, haze: 0.05, fogN: 220, fogF: 2700, exp: 1.0, wet: false, envI: 0.35, shStr: 0.92
    },
    cloud: {
      sunI: 1.5, sunC: [0.92, 0.93, 0.95], hemiI: 1.2, hemiS: [0.66, 0.7, 0.76], hemiG: [0.3, 0.32, 0.26],
      zen: [0.3, 0.35, 0.43], hor: [0.6, 0.64, 0.69], gnd: [0.2, 0.22, 0.2], skySun: [0.8, 0.78, 0.74], cloudC: [0.74, 0.76, 0.8],
      cloud: [0.8, 0.45, 1.0], disk: 0.35, haze: 0.09, fogN: 120, fogF: 2000, exp: 1.12, wet: false, envI: 0.45, shStr: 0.7
    },
    rain: {
      sunI: 0.45, sunC: [0.85, 0.88, 0.95], hemiI: 1.3, hemiS: [0.55, 0.58, 0.64], hemiG: [0.22, 0.24, 0.22],
      zen: [0.17, 0.19, 0.22], hor: [0.36, 0.38, 0.41], gnd: [0.12, 0.13, 0.13], skySun: [0.4, 0.4, 0.42], cloudC: [0.3, 0.32, 0.35],
      cloud: [0.98, 0.5, 1.0], disk: 0, haze: 0.16, fogN: 30, fogF: 850, exp: 1.28, wet: true, envI: 0.55, shStr: 0.4
    }
  };
  var ENV_MATS = ['grass', 'lawn', 'gravel', 'kerb', 'paint', 'chk', 'paddock', 'concrete', 'hoard', 'tyre', 'dark', 'paintV', 'roof', 'crowdA', 'crowdB', 'sign', 'facade', 'tree', 'treeDet', 'treeFar', 'grassTuft', 'rubber'];

  // ---------- wsadowe budowanie geometrii (jedna siatka na materiał i komórkę świata) ----------
  var _m3 = new THREE.Matrix3(), _bv = new THREE.Vector3();
  function Batch(key) { this.key = key; this.p = []; this.n = []; this.t = []; this.c = []; this.ix = []; this.vc = 0; }
  Batch.prototype.v = function (x, y, z, nx, ny, nz, u, w, r, g, b) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.t.push(u, w); this.c.push(r, g, b);
    return this.vc++;
  };
  // trójkąt z kolejnością wierzchołków dopasowaną do normalnej
  Batch.prototype.tri = function (a, b, c) {
    var P = this.p, N = this.n, a3 = a * 3, b3 = b * 3, c3 = c * 3;
    var ux = P[b3] - P[a3], uy = P[b3 + 1] - P[a3 + 1], uz = P[b3 + 2] - P[a3 + 2];
    var vx = P[c3] - P[a3], vy = P[c3 + 1] - P[a3 + 1], vz = P[c3 + 2] - P[a3 + 2];
    var cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    var nx = N[a3] + N[b3] + N[c3], ny = N[a3 + 1] + N[b3 + 1] + N[c3 + 1], nz = N[a3 + 2] + N[b3 + 2] + N[c3 + 2];
    if (cx * nx + cy * ny + cz * nz >= 0) this.ix.push(a, b, c); else this.ix.push(a, c, b);
  };
  Batch.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  // prostokąt z 4 punktów [x,y,z], jedna normalna, uv = [u0,v0,u1,v1,u2,v2,u3,v3]
  Batch.prototype.rect = function (p0, p1, p2, p3, nx, ny, nz, uv, col) {
    var r = col ? col[0] : 1, g = col ? col[1] : 1, b = col ? col[2] : 1, a = this.vc;
    this.v(p0[0], p0[1], p0[2], nx, ny, nz, uv[0], uv[1], r, g, b);
    this.v(p1[0], p1[1], p1[2], nx, ny, nz, uv[2], uv[3], r, g, b);
    this.v(p2[0], p2[1], p2[2], nx, ny, nz, uv[4], uv[5], r, g, b);
    this.v(p3[0], p3[1], p3[2], nx, ny, nz, uv[6], uv[7], r, g, b);
    this.quad(a, a + 1, a + 2, a + 3);
  };
  // dołączenie gotowej geometrii z macierzą (bez odbić lustrzanych)
  Batch.prototype.geo = function (g, m, col) {
    var pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv, base = this.vc, k;
    var r = col ? col[0] : 1, gg = col ? col[1] : 1, b = col ? col[2] : 1;
    _m3.getNormalMatrix(m);
    for (k = 0; k < pos.count; k++) {
      _bv.fromBufferAttribute(pos, k).applyMatrix4(m);
      var x = _bv.x, y = _bv.y, z = _bv.z;
      if (nor) _bv.fromBufferAttribute(nor, k).applyMatrix3(_m3).normalize(); else _bv.set(0, 1, 0);
      this.v(x, y, z, _bv.x, _bv.y, _bv.z, uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0, r, gg, b);
    }
    var idx = g.index;
    if (idx) { for (k = 0; k < idx.count; k++) this.ix.push(base + idx.getX(k)); }
    else { for (k = 0; k < pos.count; k++) this.ix.push(base + k); }
  };
  Batch.prototype.build = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1));
    g.computeBoundingSphere();
    this.p = this.n = this.t = this.c = this.ix = null;
    return g;
  };

  // ---------- drzewa: barwy liści z mapy 2D (geometrie, atlas i materiał — js/trees3d.js) ----------
  var GREENS = [0x3b7a35, 0x2f6a2c, 0x4b7f32, 0x356b3d, 0x6f7f2e, 0x2c5e30];

  // =====================================================================
  PG.World3DLite = function (T, R2D, opts) {
    opts = opts || {};
    R2D = R2D || {};
    var q = opts.quality === 'low' || opts.quality === 'medium' ? opts.quality : 'high';
    var hi = q === 'high', lo = q === 'low';
    var renderer = opts.renderer || null;
    var self = this;
    var scene = this.scene = new THREE.Scene();
    this.T = T; this.q = q; this.renderer = renderer;
    this.disposables = [];
    this.forest = null;
    this.treeNear = hi ? 380 : q === 'medium' ? 300 : 200;
    this.time = 0; this.wKey = ''; this.envRT = null; this.pmrem = null; this.envOK = false; this.exposure = 1;
    this.sky = null; this.skyMat = null; this.envScene = null; this.rain = null; this.rainPos = null; this.lightMats = [];
    this.focus = new THREE.Vector3(T.x[0], 0, T.y[0]);
    this.fwd = new THREE.Vector3();
    this._v = new THREE.Vector3();
    var hw = T.hw, N = T.N, ds = T.ds;
    var KS = T.ks || T.k || new Float32Array(T.N), KR = T.k || KS;
    var LO = (T.line && T.line.o) || new Float32Array(T.N);
    var shadowsOn = this.shadowsOn = !lo;
    function keep(o) { if (o) self.disposables.push(o); return o; }
    function safe(name, fn) { try { fn(); } catch (e) { warn(name, e); } }
    function mS(v) { return Math.round(v / ds); }
    var maxAniso = 1;
    try { if (renderer && renderer.capabilities) maxAniso = renderer.capabilities.getMaxAnisotropy() || 1; } catch (e) { maxAniso = 1; }
    var aniso = Math.min(maxAniso, hi ? 16 : q === 'medium' ? 8 : 4);

    // słońce (popołudnie, ok. 38° nad horyzontem) i osie przestrzeni światła (jak lookAt kamery cieni, up = +Y)
    var sunDir = this.sunDir = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
    var sinE = sunDir.y, horiz = Math.sqrt(sunDir.x * sunDir.x + sunDir.z * sunDir.z), cotE = horiz / sinE;
    this.cotE = cotE;
    var shDx = -sunDir.x / horiz, shDz = -sunDir.z / horiz; // kierunek cieni na ziemi
    this.lsZ = sunDir.clone();
    this.lsX = new THREE.Vector3(sunDir.z, 0, -sunDir.x).normalize();
    this.lsY = new THREE.Vector3().crossVectors(this.lsZ, this.lsX);

    // ---------- kanwa wypalonych cieni dalekich (R = cień, G = AO) ----------
    var bb = T.bbox, mcx = (bb.minx + bb.maxx) / 2, mcz = (bb.miny + bb.maxy) / 2;
    var FL = Math.max(bb.maxx - bb.minx, bb.maxy - bb.miny) + 760;
    var fx0 = mcx - FL / 2, fz0 = mcz - FL / 2, FS = lo ? 1024 : 2048, fk = FS / FL;
    var fcan = makeCanvas(FS, FS), fg = fcan.getContext('2d');
    fg.fillStyle = '#ffffff'; fg.fillRect(0, 0, FS, FS);
    var farTex = keep(texOf(fcan, false, false, 1));
    var farU = this.farU = {
      tex: { value: farTex },
      xf: { value: new THREE.Vector4(fx0, fz0, 1 / FL, 1 / FL) },
      fade: { value: new THREE.Vector4(0, 0, -2, -1) },
      str: { value: new THREE.Vector2(0.92, 0.55) }
    };
    var blobS = makeCanvas(64, 64), blobA = makeCanvas(64, 64);
    (function () {
      var g1 = blobS.getContext('2d'), gr1 = g1.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr1.addColorStop(0, 'rgba(0,255,255,0.78)'); gr1.addColorStop(0.55, 'rgba(0,255,255,0.55)'); gr1.addColorStop(1, 'rgba(0,255,255,0)');
      g1.fillStyle = gr1; g1.fillRect(0, 0, 64, 64);
      var g2 = blobA.getContext('2d'), gr2 = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr2.addColorStop(0, 'rgba(255,0,255,0.5)'); gr2.addColorStop(1, 'rgba(255,0,255,0)');
      g2.fillStyle = gr2; g2.fillRect(0, 0, 64, 64);
    })();
    // cień korony: elipsa przesunięta z wysokości korony
    function fsTree(x, z, rh, hc, rv) {
      var cx = x + shDx * hc * cotE, cz = z + shDz * hc * cotE;
      var A = Math.sqrt(rh * rh * sinE * sinE + rv * rv * horiz * horiz) / sinE;
      fg.setTransform(fk * shDx * A, fk * shDz * A, -fk * shDz * rh, fk * shDx * rh, fk * (cx - fx0), fk * (cz - fz0));
      fg.drawImage(blobS, -1, -1, 2, 2);
      var ra = rh * 0.7;
      fg.setTransform(fk * ra, 0, 0, fk * ra, fk * (x - fx0), fk * (z - fz0));
      fg.drawImage(blobA, -1, -1, 2, 2);
    }
    // cień bryły od wysokości h0 do h1 (wielokąt przesuwany wzdłuż kierunku cienia)
    function fsPoly(pts, h0, h1, val) {
      if (!pts || pts.length < 3) return;
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.globalCompositeOperation = 'darken';
      fg.fillStyle = 'rgb(' + (val || 92) + ',255,255)';
      var steps = Math.max(1, Math.ceil((h1 - h0) * cotE / 2.5));
      for (var s = 0; s <= steps; s++) {
        var hh = h0 + (h1 - h0) * s / steps, ox = shDx * hh * cotE, oz = shDz * hh * cotE;
        fg.beginPath();
        for (var k = 0; k < pts.length; k++) {
          var X = (pts[k][0] + ox - fx0) * fk, Z = (pts[k][1] + oz - fz0) * fk;
          if (k) fg.lineTo(X, Z); else fg.moveTo(X, Z);
        }
        fg.closePath(); fg.fill();
      }
    }
    // linia cienia (punkty już przesunięte) i linia AO
    function fsStroke(pts, widthM, val, ao) {
      if (!pts || pts.length < 2) return;
      fg.setTransform(1, 0, 0, 1, 0, 0);
      fg.globalCompositeOperation = ao ? 'multiply' : 'darken';
      fg.strokeStyle = ao ? 'rgba(255,0,255,' + val + ')' : 'rgb(' + val + ',255,255)';
      fg.lineWidth = Math.max(1, widthM * fk); fg.lineJoin = 'round'; fg.lineCap = 'round';
      fg.beginPath();
      for (var k = 0; k < pts.length; k++) {
        var X = (pts[k][0] - fx0) * fk, Z = (pts[k][1] - fz0) * fk;
        if (k) fg.lineTo(X, Z); else fg.moveTo(X, Z);
      }
      fg.stroke();
    }

    // ---------- tekstury ----------
    var TX = {};
    function mk(name, fn) { try { TX[name] = keep(fn()); } catch (e) { warn('tekstura ' + name, e); TX[name] = null; } }
    var TS = lo ? 256 : 512, TSB = hi ? 1024 : TS;
    var asp = null, grv = null;
    try { asp = texAsphalt(TSB); } catch (e) { warn('asfalt', e); }
    TX.asph = asp ? keep(texOf(asp.col, true, true, aniso)) : null;
    TX.asphR = asp ? keep(texOf(asp.rgh, false, true, aniso)) : null;
    TX.asphN = asp && !lo ? keep(texOf(asp.nrm, false, true, aniso)) : null;
    mk('grass', function () { return texOf(texGrass(TS), true, true, aniso); });
    mk('lawn', function () { return texOf(texLawn(TS), true, true, aniso); });
    try { grv = texGravel(TSB); } catch (e) { warn('żwir', e); }
    TX.gravel = grv ? keep(texOf(grv.col, true, true, aniso)) : null;
    TX.gravelN = grv && !lo ? keep(texOf(grv.nrm, false, true, aniso)) : null;
    mk('streak', function () { return texOf(texStreaks(), false, true, aniso); });
    mk('foliage', function () {
      if (!PG.Trees3D) return null;
      var ac = PG.Trees3D.paintAtlas(hi ? 512 : 256), ag = ac.getContext('2d');
      var t = coverageTexture(ag.getImageData(0, 0, ac.width, ac.height).data, ac.width, ac.height, [205, 215, 170], 128);
      t.anisotropy = Math.min(aniso, 4); return t;
    });
    mk('tuft', function () { var t = texGrassTuft(); t.anisotropy = Math.min(aniso, 4); return t; });
    mk('kerb', function () { return texOf(texKerb(), true, true, aniso); });
    mk('concrete', function () { return texOf(texConcrete(256), true, true, Math.min(aniso, 4)); });
    mk('roof', function () { return texOf(texRoof(), true, true, Math.min(aniso, 4)); });
    mk('fence', function () { return texOf(texFence(), true, true, aniso); });
    mk('tyre', function () { return texOf(texTyre(), true, true, Math.min(aniso, 4)); });
    mk('chk', function () { return texOf(texChecker(), true, true, aniso); });
    mk('paddock', function () { return texOf(texPaddock(256), true, true, Math.min(aniso, 4)); });
    mk('glass', function () { return texOf(texGlass(), true, true, Math.min(aniso, 4)); });
    mk('facade', function () { return texOf(texFacade(), true, false, Math.min(aniso, 4)); });
    mk('hoard', function () { return texOf(texHoard(), true, false, aniso); });
    var teams = (R2D.garages || []).map(function (g2) { return g2 && g2.team; });
    mk('sign', function () { return texOf(texSigns(teams), true, false, aniso); });
    mk('crowdA', function () { return texOf(texCrowd(31, CROWD_A, '#2c4a8e'), true, true, Math.min(aniso, 4)); });
    mk('crowdB', function () { return texOf(texCrowd(47, CROWD_B, '#80868e'), true, true, Math.min(aniso, 4)); });

    // ---------- materiały ----------
    function std(o) { return keep(new THREE.MeshStandardMaterial(o)); }
    var M = this.mats = {
      grass: std({ map: TX.grass || null, vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 }),
      lawn: std({ map: TX.lawn || null, vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
      asphalt: std({ map: TX.asph, roughnessMap: TX.asphR, normalMap: TX.asphN, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 1, metalness: 0 }),
      runoff: std({ map: TX.asph, roughnessMap: TX.asphR, normalMap: TX.asphN, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 1, metalness: 0 }),
      gravel: std({ map: TX.gravel || null, normalMap: TX.gravelN, normalScale: new THREE.Vector2(1, 1), vertexColors: true, roughness: 0.96, metalness: 0 }),
      // smugi gumy: kolor stały, krycie = tekstura × kolor wierzchołka (G)
      rubber: std({ color: 0x0a0a0b, alphaMap: TX.streak || null, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      kerb: std({ map: TX.kerb || null, roughness: 0.55, metalness: 0 }),
      paint: std({ vertexColors: true, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      chk: std({ map: TX.chk || null, roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      paddock: std({ map: TX.paddock || null, vertexColors: true, roughness: 0.9, metalness: 0 }),
      concrete: std({ map: TX.concrete || null, vertexColors: true, roughness: 0.88, metalness: 0 }),
      hoard: std({ map: TX.hoard || null, roughness: 0.5, metalness: 0 }),
      tyre: std({ map: TX.tyre || null, roughness: 0.85, metalness: 0 }),
      fence: std({ map: TX.fence || null, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.5, alphaTest: 0.02 }),
      metal: std({ color: 0x8e949b, roughness: 0.4, metalness: 0.7 }),
      dark: std({ color: 0x24272c, roughness: 0.55, metalness: 0.3 }),
      paintV: std({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
      glass: std({ map: TX.glass || null, roughness: 0.1, metalness: 0.5 }),
      roof: std({ map: TX.roof || null, vertexColors: true, roughness: 0.5, metalness: 0.45 }),
      crowdA: std({ map: TX.crowdA || null, roughness: 0.95, metalness: 0 }),
      crowdB: std({ map: TX.crowdB || null, roughness: 0.95, metalness: 0 }),
      sign: std({ map: TX.sign || null, roughness: 0.45, metalness: 0 }),
      facade: std({ map: TX.facade || null, vertexColors: true, roughness: 0.6, metalness: 0.05 }),
      tree: std({ map: TX.foliage || null, alphaTest: TX.foliage ? 0.5 : 0, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 }),
      treeDet: std({ map: TX.foliage || null, alphaTest: TX.foliage ? 0.5 : 0, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, metalness: 0 }),
      treeFar: std({ map: TX.foliage || null, alphaTest: TX.foliage ? 0.5 : 0, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, metalness: 0 }),
      grassTuft: std({ map: TX.tuft || null, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 })
    };
    ['grass', 'lawn', 'asphalt', 'runoff', 'gravel', 'kerb', 'paint', 'chk', 'paddock'].forEach(function (k) { farShadowMat(M[k], farU); });
    farShadowMat(M.rubber, farU, rubberShader, 'r');
    this.windU = { value: 0 };
    // drzewa: blisko (treeDet), średnio (tree — bez drzew rysowanych blisko), daleko (treeFar — bez bliższych)
    this.treeLodMid = { value: new THREE.Vector4(0, 0, -1, 0) };
    this.treeLodFar = { value: new THREE.Vector4(0, 0, -1, 0) };
    if (PG.Trees3D) {
      PG.Trees3D.setupMaterial(M.treeDet, this.windU, {});
      PG.Trees3D.setupMaterial(M.tree, this.windU, { lod: this.treeLodMid });
      PG.Trees3D.setupMaterial(M.treeFar, this.windU, { far: true, lod: this.treeLodFar });
    }

    // ---------- niebo, światło, mgła ----------
    scene.fog = new THREE.Fog(0xcfdde8, 220, 2700);
    scene.background = new THREE.Color(0xcfdde8);
    // render do celu (postproces HDR): mgła liniowa, tony mapuje postproces; render na ekran: mgła już po ACES
    this._fogMap = [0.8, 0.85, 0.9]; this._fogLin = [0.66, 0.77, 0.9];
    scene.onBeforeRender = function (r, s, cam, rt) {
      try {
        var c = rt ? self._fogLin : self._fogMap;
        if (scene.fog) scene.fog.color.setRGB(c[0], c[1], c[2]);
        if (scene.background && scene.background.isColor) scene.background.setRGB(c[0], c[1], c[2]);
      } catch (e) { /* nic */ }
    };
    safe('niebo', function () {
      var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uSunDir: { value: sunDir.clone() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() },
        uCloud: { value: new THREE.Vector4(0.35, 0.4, 0, 1) }, uSunDisk: { value: 1 }, uHaze: { value: 0.05 }
      }]);
      var sm = keep(new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: true }));
      var sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1000, 32, 16)), sm);
      sky.frustumCulled = false; sky.renderOrder = 1000; // na końcu nieprzezroczystych: cieniuje tylko widoczne niebo
      scene.add(sky);
      var es = new THREE.Scene();
      es.add(new THREE.Mesh(keep(new THREE.SphereGeometry(10, 32, 16)), sm));
      self.skyMat = sm; self.sky = sky; self.envScene = es;
    });
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404030, 0.85); scene.add(this.hemi);
    var sun = this.sun = new THREE.DirectionalLight(0xffffff, 3.5);
    sun.position.copy(sunDir).multiplyScalar(200);
    scene.add(sun); scene.add(sun.target);
    this.shadowExt = hi ? 55 : 50; this.shadowSize = 0;
    if (shadowsOn) {
      var maxTex = 4096;
      try { if (renderer && renderer.capabilities) maxTex = renderer.capabilities.maxTextureSize || 4096; } catch (e) { maxTex = 4096; }
      var msz = Math.min(hi ? 4096 : 2048, maxTex);
      sun.castShadow = true; sun.shadow.mapSize.set(msz, msz); this.shadowSize = msz;
      var scam = sun.shadow.camera, ext = this.shadowExt;
      scam.left = -ext; scam.right = ext; scam.top = ext; scam.bottom = -ext; scam.near = 50; scam.far = 350;
      scam.updateProjectionMatrix();
      sun.shadow.bias = hi ? -0.00006 : -0.0001; sun.shadow.normalBias = hi ? 0.04 : 0.06;
    }

    // ---------- wsady geometrii ----------
    var CELL = hi ? 700 : q === 'medium' ? 900 : 1e7;
    var batches = {}, blist = [];
    function bat(key, x, z) {
      var id = key + '|' + Math.floor(x / CELL) + '|' + Math.floor(z / CELL), b = batches[id];
      if (!b) { b = batches[id] = new Batch(key); blist.push(b); }
      return b;
    }
    var CAST = { concrete: 1, hoard: 1, tyre: 1, metal: 1, dark: 1, paintV: 1, glass: 1, roof: 1, crowdA: 1, crowdB: 1, sign: 1, facade: 1 };
    function flush() {
      for (var k = 0; k < blist.length; k++) {
        var b = blist[k], mat = M[b.key];
        if (!b.vc || !mat) continue;
        try {
          var mesh = new THREE.Mesh(keep(b.build()), mat);
          mesh.castShadow = shadowsOn && !!CAST[b.key];
          mesh.receiveShadow = shadowsOn && b.key !== 'fence';
          mesh.matrixAutoUpdate = false; mesh.updateMatrix();
          if (b.key === 'fence') mesh.renderOrder = 1;
          scene.add(mesh);
        } catch (e) { warn('siatka ' + b.key, e); }
      }
      blist.length = 0; batches = {};
    }
    var unitBox = keep(new THREE.BoxGeometry(1, 1, 1));
    var _m4 = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    function boxM(x, y, z, ry, sx, sy, sz) { _q.setFromAxisAngle(UP, ry); return _m4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); }
    function box(key, x, y, z, ry, sx, sy, sz, col) { bat(key, x, z).geo(unitBox, boxM(x, y, z, ry, sx, sy, sz), col); }
    // pas wzdłuż toru: nL wierzchołków w poprzek; fn(i, si, j, o) ustawia o.lat, o.y, o.u, o.v, kolor i normalną
    var SEG = 96;
    function strip(key, from, count, nL, fn) {
      var o = { lat: 0, y: 0, u: 0, v: 0, r: 1, g: 1, b: 1, nx: 0, ny: 1, nz: 0 };
      for (var k0 = 0; k0 < count; k0 += SEG) {
        var k1 = Math.min(count, k0 + SEG), mid = wrapI(from + ((k0 + k1) >> 1), N);
        var B = bat(key, T.x[mid], T.y[mid]), base = B.vc;
        for (var k = k0; k <= k1; k++) {
          var i = wrapI(from + k, N);
          for (var j = 0; j < nL; j++) {
            o.lat = 0; o.y = 0; o.u = 0; o.v = 0; o.r = 1; o.g = 1; o.b = 1; o.nx = 0; o.ny = 1; o.nz = 0;
            fn(i, from + k, j, o);
            B.v(T.x[i] + T.nx[i] * o.lat, o.y, T.y[i] + T.ny[i] * o.lat, o.nx, o.ny, o.nz, o.u, o.v, o.r, o.g, o.b);
          }
        }
        for (var a = 0; a < k1 - k0; a++) for (var j2 = 0; j2 < nL - 1; j2++) {
          var p = base + a * nL + j2;
          B.quad(p, p + nL, p + nL + 1, p + 1);
        }
      }
    }
    function centroid(pts) { var x = 0, z = 0; for (var k = 0; k < pts.length; k++) { x += pts[k][0]; z += pts[k][1]; } return [x / pts.length, z / pts.length]; }
    // płaska pokrywa wielokąta (triangulacja earcut)
    function cap(pts, y, key, col, down, tile) {
      var n = pts ? pts.length : 0; if (n < 3) return;
      var ctr = centroid(pts), B = bat(key, ctr[0], ctr[1]), base = B.vc, tl = tile || 4, contour = [], k;
      for (k = 0; k < n; k++) contour.push(new THREE.Vector2(pts[k][0], pts[k][1]));
      var faces = THREE.ShapeUtils.triangulateShape(contour, []);
      var ny = down ? -1 : 1, r = col ? col[0] : 1, g = col ? col[1] : 1, b = col ? col[2] : 1;
      for (k = 0; k < n; k++) B.v(pts[k][0], y, pts[k][1], 0, ny, 0, pts[k][0] / tl, pts[k][1] / tl, r, g, b);
      for (var f = 0; f < faces.length; f++) B.tri(base + faces[f][0], base + faces[f][1], base + faces[f][2]);
    }
    // ściany boczne wielokąta od y0 do y1 (normalne na zewnątrz)
    function prism(pts, y0, y1, key, col, tile) {
      var n = pts ? pts.length : 0; if (n < 3) return;
      var area = 0, k, tl = tile || 4;
      for (k = 0; k < n; k++) { var a = pts[k], b = pts[(k + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
      var sg = area >= 0 ? 1 : -1, ctr = centroid(pts), B = bat(key, ctr[0], ctr[1]), s = 0, hv = (y1 - y0) / tl;
      for (k = 0; k < n; k++) {
        var p = pts[k], p2 = pts[(k + 1) % n], dx = p2[0] - p[0], dz = p2[1] - p[1], l = Math.sqrt(dx * dx + dz * dz);
        if (l < 1e-3) continue;
        B.rect([p[0], y0, p[1]], [p2[0], y0, p2[1]], [p2[0], y1, p2[1]], [p[0], y1, p[1]], sg * dz / l, 0, -sg * dx / l,
          [s / tl, hv, (s + l) / tl, hv, (s + l) / tl, 0, s / tl, 0], col);
        s += l;
      }
    }
    function nearI(x, z, rc) { try { return PG.nearestGlobal ? PG.nearestGlobal(T, x, z, rc || 4) : -1; } catch (e) { return -1; } }
    function inMain(i) { return T.mainFrom !== undefined && T.mainTo !== undefined && inRun(i, T.mainFrom, T.mainTo); }
    function barH(s, i) { return s > 0 && inMain(i) ? 1.25 : 1.05; }  // po prawej na prostej startowej: mur alei serwisowej
    function barT(s, i) { return s > 0 && inMain(i) ? 1.2 : 0.5; }
    // bezpieczne przesunięcie po wewnętrznej stronie łuku (bez zawijania pasów)
    function maxIn(i, s) {
      var k = 0;
      for (var d = -3; d <= 3; d++) { var kv = KR[wrapI(i + d, N)] * s; if (kv > k) k = kv; }
      return k > 1e-4 ? 0.85 / k : 1e9;
    }
    function teamCol(tm) {
      try { var c = new THREE.Color(tm.livery.primary); return [Math.max(0.05, c.r), Math.max(0.05, c.g), Math.max(0.05, c.b)]; }
      catch (e) { return [0.6, 0.6, 0.6]; }
    }
    var WHITE = lin(0xf2f2ec), YEL = lin(0xf5c518), GREENP = lin(0x2f8a4a);

    // ---------- teren ----------
    safe('ziemia', function () {
      var GS = 9000, GN = lo ? 36 : 72;
      var gg = keep(new THREE.PlaneGeometry(GS, GS, GN, GN));
      gg.rotateX(-Math.PI / 2); gg.translate(mcx, -0.08, mcz);
      var gp = gg.attributes.position, guv = gg.attributes.uv, gc = new Float32Array(gp.count * 3);
      for (var i = 0; i < gp.count; i++) {
        var x = gp.getX(i), z = gp.getZ(i);
        guv.setXY(i, x / 10, z / 10);
        var n = vnoise(x / 240, z / 240, 65536, 5) * 0.6 + vnoise(x / 60, z / 60, 65536, 6) * 0.4, dry = vnoise(x / 500, z / 500, 65536, 7);
        var v = 0.78 + n * 0.32;
        gc[i * 3] = v * (1 + dry * 0.18); gc[i * 3 + 1] = v; gc[i * 3 + 2] = v * (1 - dry * 0.15);
      }
      gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
      var gm = new THREE.Mesh(gg, M.grass);
      gm.receiveShadow = shadowsOn; gm.matrixAutoUpdate = false; gm.updateMatrix();
      scene.add(gm);
    });

    // ---------- tor ----------
    safe('asfalt', function () {
      var NA = hi ? 15 : q === 'medium' ? 11 : 7;
      strip('asphalt', 0, N, NA, function (i, si, j, o) {
        var lat = -hw + 2 * hw * j / (NA - 1), d = lat - LO[i], rub = Math.exp(-d * d / (2 * 1.15 * 1.15));
        var kk = Math.min(1, Math.abs(KS[i]) * 160), patch = vnoise(si * ds / 70, lat / 9 + 50, 65536, 77);
        var c = (1 - rub * (0.2 + 0.16 * kk)) * (0.93 + patch * 0.12) * (Math.abs(lat) > hw - 0.8 ? 1.04 : 1);
        o.lat = lat; o.u = lat / 4; o.v = si * ds / 4; o.r = c; o.g = c; o.b = c;
      });
    });
    // smugi gumy w strefach hamowania (wg profilu prędkości wzorcowego bolidu), dwa ślady opon wzdłuż linii jazdy
    safe('guma', function () {
      if (!M.rubber || !TX.streak || !PG.speedProfile || !PG.carParams || !PG.DEFAULT_TEAMS) return;
      var tm = PG.DEFAULT_TEAMS[0], pp = PG.carParams(tm, tm.drivers[0]);
      var sp = PG.speedProfile(T, { power: pp.power, cd: pp.cd, gripMul: pp.gripMul, aeroMul: pp.aeroMul, brakeMul: 1 });
      var prof = sp && sp.v;
      if (!prof || prof.length !== N) return;
      var ext = Math.round(14 / ds), lim = hw - 0.25;
      runs(N, function (i) { return prof[(i + 1) % N] < prof[i] - 0.02; }).forEach(function (r, ri) {
        if (r[1] * ds < 25 || r[1] >= N / 2) return;
        var I = clamp((prof[r[0]] - prof[wrapI(r[0] + r[1], N)]) / 35, 0.35, 1) * 0.85, L = r[1] + ext;
        [-0.8, 0.8].forEach(function (off, tk) {
          strip('rubber', r[0], L, 2, function (i, si, j, o) {
            var t = (si - r[0]) / L, a = I * Math.min(1, t * 2.4) * (t > 0.86 ? (1 - t) / 0.14 : 1) * (0.78 + 0.22 * Math.sin(si * ds * 0.07 + tk + ri));
            o.lat = clamp(LO[i] + off + (j ? 0.62 : -0.62), -lim, lim); o.y = 0.004; o.u = j; o.v = (si * ds + tk * 9 + ri * 5) / 24;
            o.r = o.g = o.b = a;
          });
        });
      });
    });
    safe('trawnik', function () {
      [-1, 1].forEach(function (s) {
        var bar = s < 0 ? T.barL : T.barR;
        strip('lawn', 0, N, 2, function (i, si, j, o) {
          var lat = j ? Math.max(hw + 2, Math.min(bar[i] + 9, maxIn(i, s))) : hw - 0.5;
          var x = T.x[i] + T.nx[i] * s * lat, z = T.y[i] + T.ny[i] * s * lat;
          var c = 0.86 + vnoise(x / 45, z / 45, 65536, 8) * 0.24;
          o.lat = s * lat; o.y = -0.04; o.u = s * lat / 12; o.v = si * ds / 12; o.r = c * 1.02; o.g = c; o.b = c * 0.96;
        });
      });
    });
    safe('pobocza', function () {
      [[-1, T.surfL, T.barL], [1, T.surfR, T.barR]].forEach(function (sd) {
        var s = sd[0], surf = sd[1], bar = sd[2];
        // żwir: lekko pofałdowany (koleiny, nawiane pagórki), ciemniejszy przy torze, gdzie zalega pył z opon
        var GL = lo ? 2 : 6;
        function gh(x, z) { return (vnoise(x / 2.4, z / 2.4, 65536, 44) - 0.5) * 0.1 + (vnoise(x / 0.9, z / 0.9, 65536, 45) - 0.5) * 0.035; }
        runs(N, function (i) { return surf[i] === 1; }).forEach(function (r) {
          strip('gravel', wrapI(r[0] - 1, N), r[1] + 1, GL, function (i, si, j, o) {
            var far = Math.max(hw + 2, Math.min(bar[i] - 0.4, maxIn(i, s))), near = hw + 1.3, lat = near + (far - near) * j / (GL - 1);
            var x = T.x[i] + T.nx[i] * s * lat, z = T.y[i] + T.ny[i] * s * lat;
            // plamy przemieszanego żwiru i ślady grabienia w poprzek
            var c = (0.8 + vnoise(x / 7, z / 7, 65536, 46) * 0.3 + (vnoise(x / 1.6, z / 1.6, 65536, 47) - 0.5) * 0.12) * (j === 0 ? 0.8 : 1);
            o.lat = s * lat; o.y = -0.02; o.u = s * lat / 2.5; o.v = si * ds / 2.5; o.r = c; o.g = c * 0.985; o.b = c * 0.965;
            if (j > 0 && j < GL - 1) {
              var h0 = gh(x, z), e = 0.35, gx = (gh(x + e, z) - h0) / e, gz = (gh(x, z + e) - h0) / e, il = 1 / Math.sqrt(gx * gx + gz * gz + 1);
              o.y += h0 + 0.03; o.nx = -gx * il; o.ny = il; o.nz = -gz * il;
            }
          });
        });
        runs(N, function (i) { return surf[i] === 2; }).forEach(function (r) {
          strip('runoff', wrapI(r[0] - 1, N), r[1] + 1, 4, function (i, si, j, o) {
            var far = Math.max(hw + 3.8, Math.min(bar[i] - 0.4, maxIn(i, s)));
            var lat = j === 0 ? hw + 1.3 : j === 1 ? hw + 3.3 : j === 2 ? hw + 3.4 : far;
            var c = j < 2 ? GREENP : null;
            o.lat = s * lat; o.y = -0.015; o.u = s * lat / 4; o.v = si * ds / 4;
            if (c) { o.r = c[0] * 1.6; o.g = c[1] * 1.6; o.b = c[2] * 1.6; } else { o.r = 0.9; o.g = 0.9; o.b = 0.92; }
          });
        });
      });
    });
    safe('krawężniki', function () {
      var KP = [[hw - 0.15, 0.012, 0], [hw + 0.05, 0.03, 0.12], [hw + 1.2, 0.05, 0.82], [hw + 1.5, 0.012, 1]];
      [[-1, T.kerbL], [1, T.kerbR]].forEach(function (sd) {
        var s = sd[0], kb = sd[1];
        runs(N, function (i) { return !!kb[i]; }).forEach(function (r) {
          strip('kerb', r[0], r[1], 4, function (i, si, j, o) {
            o.lat = s * KP[j][0]; o.y = KP[j][1]; o.u = KP[j][2]; o.v = (si - r[0]) * ds / 2.5;
          });
        });
      });
    });
    safe('linie', function () {
      [[-1, T.kerbL], [1, T.kerbR]].forEach(function (sd) {
        var s = sd[0], kb = sd[1];
        runs(N, function (i) { return !kb[i]; }).forEach(function (r) {
          strip('paint', r[0], r[1], 2, function (i, si, j, o) {
            o.lat = s * (j ? hw - 0.15 : hw - 0.4); o.y = 0.006; o.r = WHITE[0]; o.g = WHITE[1]; o.b = WHITE[2];
          });
        });
      });
      // prostokąt na nawierzchni wokół próbki i: wzdłuż od a0 do a1, w poprzek od l0 do l1
      function patchAt(key, i, a0, a1, l0, l1, y, col, tile) {
        var tx = T.tx[i], tz = T.ty[i], nx = T.nx[i], nz = T.ny[i], x = T.x[i], z = T.y[i];
        function P(a, l) { return [x + tx * a + nx * l, y, z + tz * a + nz * l]; }
        var uv = tile ? [l0 / tile, a0 / tile, l1 / tile, a0 / tile, l1 / tile, a1 / tile, l0 / tile, a1 / tile] : [0, 0, 1, 0, 1, 1, 0, 1];
        bat(key, x, z).rect(P(a0, l0), P(a0, l1), P(a1, l1), P(a1, l0), 0, 1, 0, uv, col);
      }
      // szachownica mety
      patchAt('chk', 0, -1.2, 0.6, -hw, hw, 0.007, null, 1.2);
      // linie DRS: aktywacja biała, detekcja żółta
      (T.drs || []).forEach(function (zn) {
        if (zn.from >= 0) patchAt('paint', zn.from, -0.15, 0.15, -hw, hw, 0.007, WHITE);
        if (zn.detect >= 0) patchAt('paint', zn.detect, -0.15, 0.15, -hw, hw, 0.007, YEL);
      });
      // pola startowe
      (T.grid || []).forEach(function (sl) {
        var ch = Math.cos(sl.h), sh = Math.sin(sl.h), nx = -sh, nz = ch, side = sl.lat < 0 ? -1 : 1;
        function P(a, l) { return [sl.x + ch * a + nx * l, 0.006, sl.y + sh * a + nz * l]; }
        var B = bat('paint', sl.x, sl.y), uv = [0, 0, 1, 0, 1, 1, 0, 1], lb = -1.3 * side;
        B.rect(P(3.05, -1.3), P(3.05, 1.3), P(3.25, 1.3), P(3.25, -1.3), 0, 1, 0, uv, WHITE);
        B.rect(P(-0.6, lb - 0.07), P(3.25, lb - 0.07), P(3.25, lb + 0.07), P(-0.6, lb + 0.07), 0, 1, 0, uv, WHITE);
      });
    });

    // ---------- trybuny w pobliżu (do siatek i rozmieszczania obiektów) ----------
    var markL = new Uint8Array(N), markR = new Uint8Array(N);
    var scen = R2D.scenery || [], stands = [];
    safe('znaczniki', function () {
      scen.forEach(function (o) { if (o && o.kind === 'stand' && o.pts) stands.push(o); });
      stands.forEach(function (o) {
        o.pts.forEach(function (p) {
          var gi = nearI(p[0], p[1], 4); if (gi < 0) return;
          var lat = (p[0] - T.x[gi]) * T.nx[gi] + (p[1] - T.y[gi]) * T.ny[gi];
          (lat < 0 ? markL : markR)[gi] = 1;
        });
      });
      [markL, markR].forEach(function (mk) {
        var src = new Uint8Array(mk);
        for (var i = 0; i < N; i++) if (src[i]) for (var d = -12; d <= 12; d++) mk[wrapI(i + d, N)] = 1;
        for (var i2 = 0; i2 < N; i2++) if (inMain(i2)) mk[i2] = 1;
      });
    });

    // ---------- bariery, opony, siatki ----------
    safe('bariery', function () {
      [[-1, T.barL], [1, T.barR]].forEach(function (sd) {
        var s = sd[0], bar = sd[1], shp = [], aop = [];
        // front z reklamami (panele po 8 m)
        for (var i = 0; i < N; i++) {
          var i1 = (i + 1) % N, d0 = s * bar[i], d1 = s * bar[i1];
          var x0 = T.x[i] + T.nx[i] * d0, z0 = T.y[i] + T.ny[i] * d0, x1 = T.x[i1] + T.nx[i1] * d1, z1 = T.y[i1] + T.ny[i1] * d1;
          var h0 = barH(s, i), h1 = barH(s, i1), row = (hash2(Math.floor(i / 4), s + 5) * 8) | 0, j = i % 4;
          var u0 = j / 4, u1 = (j + 1) / 4;
          if (s > 0) { u0 = 1 - u0; u1 = 1 - u1; }
          var vt = row / 8 + 0.004, vb = (row + 1) / 8 - 0.004;
          var B = bat('hoard', x0, z0), a = B.vc;
          B.v(x0, -0.06, z0, -s * T.nx[i], 0, -s * T.ny[i], u0, vb, 1, 1, 1);
          B.v(x1, -0.06, z1, -s * T.nx[i1], 0, -s * T.ny[i1], u1, vb, 1, 1, 1);
          B.v(x1, h1, z1, -s * T.nx[i1], 0, -s * T.ny[i1], u1, vt, 1, 1, 1);
          B.v(x0, h0, z0, -s * T.nx[i], 0, -s * T.ny[i], u0, vt, 1, 1, 1);
          B.quad(a, a + 1, a + 2, a + 3);
          var off = s * (bar[i] + 0.25), ho = h0 * 0.55 * cotE;
          shp.push([T.x[i] + T.nx[i] * off + shDx * ho, T.y[i] + T.ny[i] * off + shDz * ho]);
          aop.push([x0, z0]);
        }
        shp.push(shp[0]); aop.push(aop[0]);
        fsStroke(shp, 1.05 * cotE + 0.5, 112, false);
        fsStroke(aop, 2.4, 0.32, true);
        // korona i tył muru
        strip('concrete', 0, N, 4, function (i, si, j, o) {
          var d = bar[i], h = barH(s, i), t = barT(s, i);
          o.r = o.g = o.b = 0.86; o.v = si * ds / 4;
          if (j === 0) { o.lat = s * d; o.y = h; o.u = 0; }
          else if (j === 1) { o.lat = s * (d + t); o.y = h; o.u = 0.12; }
          else { o.lat = s * (d + t); o.y = j === 2 ? h : -0.06; o.nx = s * T.nx[i]; o.ny = 0; o.nz = s * T.ny[i]; o.u = j === 2 ? 0.12 : 0.12 + h / 4; }
        });
      });
    });
    safe('opony', function () {
      [[-1, T.barL, T.surfL], [1, T.barR, T.surfR]].forEach(function (sd, sIdx) {
        var s = sd[0], bar = sd[1], surf = sd[2];
        runs(N, function (i) { return surf[i] === 1; }).forEach(function (r, ri) {
          var vb0 = ((ri + sIdx) % 2) ? 0.25 : 0, D = 0.75;
          strip('tyre', r[0], r[1], 4, function (i, si, j, o) {
            var d = bar[i];
            o.u = (si - r[0]) * ds / 2;
            if (j < 2) { o.lat = s * (d - D); o.y = j ? 0.9 : -0.05; o.nx = -s * T.nx[i]; o.ny = 0; o.nz = -s * T.ny[i]; o.v = vb0 + (j ? 0.004 : 0.246); }
            else { o.lat = s * (j === 2 ? d - D : d); o.y = 0.9; o.v = j === 2 ? 0.504 : 0.996; }
          });
        });
      });
    });
    safe('siatki', function () {
      [[-1, T.barL, markL], [1, T.barR, markR]].forEach(function (sd) {
        var s = sd[0], bar = sd[1], mk = sd[2];
        runs(N, function (i) { return !!mk[i]; }).forEach(function (r) {
          strip('fence', r[0], r[1], 2, function (i, si, j, o) {
            var h = barH(s, i);
            o.lat = s * (bar[i] + 0.15); o.y = j ? h + 3.4 : h - 0.05;
            o.nx = -s * T.nx[i]; o.ny = 0; o.nz = -s * T.ny[i]; o.u = si * ds / 1.2; o.v = o.y / 1.2;
          });
          for (var k = 0; k <= r[1]; k += 2) {
            var i = wrapI(r[0] + k, N), d = s * (bar[i] + 0.15), h = barH(s, i) + 3.5;
            box('metal', T.x[i] + T.nx[i] * d, h / 2, T.y[i] + T.ny[i] * d, -Math.atan2(T.ty[i], T.tx[i]), 0.1, h, 0.1);
          }
        });
      });
    });

    // ---------- trybuny ----------
    var mainStand = null;
    stands.forEach(function (o) { if (!mainStand || o.pts.length > mainStand.pts.length) mainStand = o; });
    function edges(pts) {
      var Lp = pts.length, n = Lp / 2, F = [], Bk = [], k;
      for (k = 0; k < n; k++) { F.push(pts[k]); Bk.push(pts[Lp - 1 - k]); }
      var mid = n >> 1, gF = nearI(F[mid][0], F[mid][1]), gB = nearI(Bk[mid][0], Bk[mid][1]);
      if (gF >= 0 && gB >= 0) {
        var dF = Math.hypot(F[mid][0] - T.x[gF], F[mid][1] - T.y[gF]), dB = Math.hypot(Bk[mid][0] - T.x[gB], Bk[mid][1] - T.y[gB]);
        if (dB < dF) return { F: Bk, B: F, n: n, mid: mid };
      }
      return { F: F, B: Bk, n: n, mid: mid };
    }
    function buildStand(o, idx) {
      var pts = o.pts, Lp = pts.length;
      if (Lp < 4 || Lp % 2) { prism(pts, -0.06, 10, 'concrete', lin(0xbdbab2)); cap(pts, 10, 'crowdA', null); fsPoly(pts, 0, 10); return; }
      var E = edges(pts), F = E.F, Bk = E.B, n = E.n, mid = E.mid, k;
      var cols = [];
      for (k = 0; k < n; k += 3) cols.push(k);
      if (cols[cols.length - 1] !== n - 1) cols.push(n - 1);
      var depth = Math.hypot(Bk[mid][0] - F[mid][0], Bk[mid][1] - F[mid][1]);
      var R = clamp(Math.round(depth / 1.6), 3, 22), rise = 0.9, y0 = 2.4, top = y0 + R * rise;
      var hasRoof = o === mainStand || idx % 2 === 0;
      var cx = (F[mid][0] + Bk[mid][0]) / 2, cz = (F[mid][1] + Bk[mid][1]) / 2;
      var BC = bat(idx % 2 ? 'crowdB' : 'crowdA', cx, cz), BK = bat('concrete', cx, cz);
      var sAl = [0];
      for (k = 1; k < n; k++) sAl.push(sAl[k - 1] + Math.hypot(F[k][0] - F[k - 1][0], F[k][1] - F[k - 1][1]));
      function P(kk, r) { var t = r / R; return [F[kk][0] + (Bk[kk][0] - F[kk][0]) * t, F[kk][1] + (Bk[kk][1] - F[kk][1]) * t]; }
      function nf(kk) { var dx = F[kk][0] - Bk[kk][0], dz = F[kk][1] - Bk[kk][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; }
      var WALLC = lin(0x8f969c), BACKC = lin(0xc4c1b8);
      function wall(Bt, a0, a1, h0, h1, n0, n1, u0, u1, col) {
        var a = Bt.vc, hv = (h1 - h0) / 4;
        Bt.v(a0[0], h0, a0[1], n0[0], 0, n0[1], u0, hv, col[0], col[1], col[2]);
        Bt.v(a1[0], h0, a1[1], n1[0], 0, n1[1], u1, hv, col[0], col[1], col[2]);
        Bt.v(a1[0], h1, a1[1], n1[0], 0, n1[1], u1, 0, col[0], col[1], col[2]);
        Bt.v(a0[0], h1, a0[1], n0[0], 0, n0[1], u0, 0, col[0], col[1], col[2]);
        Bt.quad(a, a + 1, a + 2, a + 3);
      }
      for (var c = 0; c + 1 < cols.length; c++) {
        var k0 = cols[c], k1 = cols[c + 1], n0 = nf(k0), n1 = nf(k1), u0 = sAl[k0] / 4, u1 = sAl[k1] / 4, a;
        wall(BK, F[k0], F[k1], -0.06, y0, n0, n1, u0, u1, WALLC);
        for (var r = 0; r < R; r++) {
          var hR = y0 + r * rise, hT = hR + rise, A0 = P(k0, r), A1 = P(k1, r), C0 = P(k0, r + 1), C1 = P(k1, r + 1);
          a = BC.vc; // podstopnica z kibicami
          BC.v(A0[0], hR, A0[1], n0[0], 0, n0[1], u0, 0.36, 1, 1, 1);
          BC.v(A1[0], hR, A1[1], n1[0], 0, n1[1], u1, 0.36, 1, 1, 1);
          BC.v(A1[0], hT, A1[1], n1[0], 0, n1[1], u1, 0.0, 1, 1, 1);
          BC.v(A0[0], hT, A0[1], n0[0], 0, n0[1], u0, 0.0, 1, 1, 1);
          BC.quad(a, a + 1, a + 2, a + 3);
          a = BC.vc; // stopień
          BC.v(A0[0], hT, A0[1], 0, 1, 0, u0, 0.36, 1, 1, 1);
          BC.v(A1[0], hT, A1[1], 0, 1, 0, u1, 0.36, 1, 1, 1);
          BC.v(C1[0], hT, C1[1], 0, 1, 0, u1, 1.0, 1, 1, 1);
          BC.v(C0[0], hT, C0[1], 0, 1, 0, u0, 1.0, 1, 1, 1);
          BC.quad(a, a + 1, a + 2, a + 3);
        }
        // tył z attyką i attyka od strony widowni
        wall(BK, Bk[k0], Bk[k1], -0.06, top + 1.1, [-n0[0], -n0[1]], [-n1[0], -n1[1]], u0, u1, BACKC);
        wall(BK, Bk[k0], Bk[k1], top, top + 1.1, n0, n1, u0, u1, BACKC);
      }
      // ściany boczne (schodkowy profil)
      [[cols[0], cols[1]], [cols[cols.length - 1], cols[cols.length - 2]]].forEach(function (e) {
        var kk = e[0], ko = e[1], tx = F[kk][0] - F[ko][0], tz = F[kk][1] - F[ko][1], tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        for (var r2 = 0; r2 < R; r2++) {
          var A = P(kk, r2), C = P(kk, r2 + 1), hT2 = y0 + (r2 + 1) * rise;
          BK.rect([A[0], -0.06, A[1]], [C[0], -0.06, C[1]], [C[0], hT2, C[1]], [A[0], hT2, A[1]], tx, 0, tz,
            [r2 * 0.4, hT2 / 4, (r2 + 1) * 0.4, hT2 / 4, (r2 + 1) * 0.4, 0, r2 * 0.4, 0], BACKC);
        }
      });
      var shadowTop = top + 1.1;
      if (hasRoof) {
        var rf = Math.max(1, Math.round(R * 0.32)), hb = top + 3.6, hf = top + 4.6, RC = lin(0xd9dcdf), RU = lin(0x6e737a);
        var BR = bat('roof', cx, cz);
        for (var c2 = 0; c2 + 1 < cols.length; c2++) {
          var q0 = cols[c2], q1 = cols[c2 + 1], m0 = nf(q0), m1 = nf(q1);
          var b0 = [Bk[q0][0] - m0[0] * 1.2, Bk[q0][1] - m0[1] * 1.2], b1 = [Bk[q1][0] - m1[0] * 1.2, Bk[q1][1] - m1[1] * 1.2];
          var f0 = P(q0, rf), f1 = P(q1, rf), ua = sAl[q0] / 3, ub = sAl[q1] / 3, uvr = [ua, 0, ub, 0, ub, 1, ua, 1];
          BR.rect([b0[0], hb, b0[1]], [b1[0], hb, b1[1]], [f1[0], hf, f1[1]], [f0[0], hf, f0[1]], 0, 1, 0, uvr, RC);
          BR.rect([b0[0], hb - 0.35, b0[1]], [b1[0], hb - 0.35, b1[1]], [f1[0], hf - 0.35, f1[1]], [f0[0], hf - 0.35, f0[1]], 0, -1, 0, uvr, RU);
          BR.rect([f0[0], hf - 0.35, f0[1]], [f1[0], hf - 0.35, f1[1]], [f1[0], hf, f1[1]], [f0[0], hf, f0[1]], m0[0], 0, m0[1], [ua, 0, ub, 0, ub, 0.1, ua, 0.1], RC);
          BR.rect([b0[0], hb - 0.35, b0[1]], [b1[0], hb - 0.35, b1[1]], [b1[0], hb, b1[1]], [b0[0], hb, b0[1]], -m0[0], 0, -m0[1], [ua, 0, ub, 0, ub, 0.1, ua, 0.1], RC);
          if (c2 % 3 === 0) box('metal', b0[0], (hb - 0.35) / 2, b0[1], 0, 0.45, hb - 0.35, 0.45);
        }
        shadowTop = hf;
      }
      fsPoly(pts, 0, shadowTop, 88);
      fsStroke(pts.concat([pts[0]]), 4, 0.4, true);
    }
    safe('trybuny', function () { stands.forEach(function (o, idx) { try { buildStand(o, idx); } catch (e) { warn('trybuna', e); } }); });

    // ---------- boksy, padok, aleja serwisowa ----------
    function buildPit(o) {
      var pts = o.pts, Lp = pts.length, H1 = 6, H2 = 9.9;
      if (Lp < 4 || Lp % 2) { prism(pts, -0.06, 10.5, 'concrete', lin(0xd5d7da)); cap(pts, 10.5, 'roof', lin(0xc7cacd)); fsPoly(pts, 0, 10.5); return; }
      var E = edges(pts), F = E.F, Bk = E.B, n = E.n, k;
      var i0 = nearI(F[0][0], F[0][1], 2), gar = R2D.garages || [], WC = lin(0xd2d5d9), BACKC = lin(0xc9c7c0);
      for (k = 0; k + 1 < n; k++) {
        var p0 = F[k], p1 = F[k + 1], dx = p0[0] - Bk[k][0], dz = p0[1] - Bk[k][1], dl = Math.hypot(dx, dz) || 1, nx = dx / dl, nz = dz / dl;
        var gIdx = -1, off = 0;
        if (i0 >= 0) for (var g = 0; g < gar.length; g++) {
          if (!gar[g]) continue;
          var oo = wrapI(i0 + k - gar[g].i, N) * ds;
          if (oo < 25.9) { gIdx = g; off = oo; break; }
        }
        var u0, u1, col;
        if (gIdx >= 0) { u0 = off / 26 * 0.498; u1 = Math.min(26, off + ds) / 26 * 0.498; col = teamCol(gar[gIdx].team); }
        else { var jj = k % 4; u0 = 0.502 + jj * 0.124; u1 = u0 + 0.124; col = WC; }
        bat('facade', p0[0], p0[1]).rect([p0[0], -0.06, p0[1]], [p1[0], -0.06, p1[1]], [p1[0], H1, p1[1]], [p0[0], H1, p0[1]], nx, 0, nz, [u0, 1, u1, 1, u1, 0, u0, 0], col);
        var gu = (k % 2) * 0.5;
        bat('glass', p0[0], p0[1]).rect([p0[0], H1, p0[1]], [p1[0], H1, p1[1]], [p1[0], H2, p1[1]], [p0[0], H2, p0[1]], nx, 0, nz, [gu, 1, gu + 0.5, 1, gu + 0.5, 0, gu, 0]);
        var bq0 = Bk[k], bq1 = Bk[k + 1];
        bat('concrete', bq0[0], bq0[1]).rect([bq0[0], -0.06, bq0[1]], [bq1[0], -0.06, bq1[1]], [bq1[0], H2, bq1[1]], [bq0[0], H2, bq0[1]], -nx, 0, -nz, [k * 0.5, H2 / 4, (k + 1) * 0.5, H2 / 4, (k + 1) * 0.5, 0, k * 0.5, 0], BACKC);
      }
      // boki
      [[0, 1], [n - 1, n - 2]].forEach(function (e) {
        var a = F[e[0]], b = Bk[e[0]], tx = F[e[0]][0] - F[e[1]][0], tz = F[e[0]][1] - F[e[1]][1], tl = Math.hypot(tx, tz) || 1;
        bat('concrete', a[0], a[1]).rect([a[0], -0.06, a[1]], [b[0], -0.06, b[1]], [b[0], H2, b[1]], [a[0], H2, a[1]], tx / tl, 0, tz / tl, [0, H2 / 4, 4, H2 / 4, 4, 0, 0, 0], BACKC);
      });
      prism(pts, H2, 10.5, 'paintV', lin(0xeceff1));
      cap(pts, 10.5, 'roof', lin(0xc7cacd));
      fsPoly(pts, 0, 10.5);
      // tablice z nazwami zespołów nad garażami
      gar.forEach(function (gg, t) {
        if (!gg || t > 9) return;
        var ia = wrapI(gg.i + mS(20), N), ib = wrapI(gg.i + mS(6), N);
        var la = (Lp >= 4) ? (F[0][0] - T.x[i0 >= 0 ? i0 : 0]) * T.nx[i0 >= 0 ? i0 : 0] + (F[0][1] - T.y[i0 >= 0 ? i0 : 0]) * T.ny[i0 >= 0 ? i0 : 0] : hw + 13;
        var lat = la - (la > 0 ? 0.07 : -0.07), sgn = la > 0 ? -1 : 1;
        var xa = T.x[ia] + T.nx[ia] * lat, za = T.y[ia] + T.ny[ia] * lat, xb = T.x[ib] + T.nx[ib] * lat, zb = T.y[ib] + T.ny[ib] * lat;
        var v0 = (512 + t * 48 + 2) / 1024, v1 = (512 + t * 48 + 46) / 1024;
        // napis czytany z alei serwisowej: lewa krawędź = dalsza próbka (ia) dla budynku po prawej stronie toru
        var L0 = la > 0 ? [xa, za] : [xb, zb], L1 = la > 0 ? [xb, zb] : [xa, za];
        bat('sign', L0[0], L0[1]).rect([L0[0], 5.0, L0[1]], [L1[0], 5.0, L1[1]], [L1[0], 5.75, L1[1]], [L0[0], 5.75, L0[1]],
          sgn * T.nx[ia], 0, sgn * T.ny[ia], [0, v1, 1, v1, 1, v0, 0, v0]);
      });
    }
    // aleja serwisowa: asfalt + białe linie przy krawędziach
    function buildPitlane(o) {
      var pts = o.pts;
      cap(pts, 0.004, 'asphalt', [0.9, 0.9, 0.9], false, 4);
      if (pts.length < 4 || pts.length % 2) return;
      var E = edges(pts), F = E.F, Bk = E.B, n = E.n;
      for (var k = 0; k + 1 < n; k++) {
        [[F, Bk], [Bk, F]].forEach(function (pr) {
          var A = pr[0], O = pr[1];
          var d0x = O[k][0] - A[k][0], d0z = O[k][1] - A[k][1], l0 = Math.hypot(d0x, d0z) || 1;
          var d1x = O[k + 1][0] - A[k + 1][0], d1z = O[k + 1][1] - A[k + 1][1], l1 = Math.hypot(d1x, d1z) || 1;
          var w = 0.22, e = 0.25;
          bat('paint', A[k][0], A[k][1]).rect(
            [A[k][0] + d0x / l0 * e, 0.01, A[k][1] + d0z / l0 * e], [A[k + 1][0] + d1x / l1 * e, 0.01, A[k + 1][1] + d1z / l1 * e],
            [A[k + 1][0] + d1x / l1 * (e + w), 0.01, A[k + 1][1] + d1z / l1 * (e + w)], [A[k][0] + d0x / l0 * (e + w), 0.01, A[k][1] + d0z / l0 * (e + w)],
            0, 1, 0, [0, 0, 1, 0, 1, 1, 0, 1], WHITE);
        });
      }
    }
    safe('budynki', function () {
      scen.forEach(function (o) {
        if (!o || !o.pts || o.pts.length < 3) return;
        try {
          switch (o.kind) {
            case 'pitlane': buildPitlane(o); break;
            case 'paddock': cap(o.pts, 0.002, 'paddock', null, false, 6); break;
            case 'roof': buildPit(o); break;
            case 'standroof':
              prism(o.pts, -0.06, 8, 'concrete', lin(0xd0d2d4));
              prism(o.pts, 8, 12, 'glass', null);
              prism(o.pts, 12, 15.5, 'concrete', lin(0xd0d2d4));
              cap(o.pts, 15.5, 'roof', lin(0xbfc3c8));
              fsPoly(o.pts, 0, 15.5);
              break;
            case 'motorhome':
              var tc = o.team ? teamCol(o.team) : [0.6, 0.6, 0.6];
              prism(o.pts, -0.06, 4.6, 'paintV', tc);
              prism(o.pts, 4.6, 6.8, 'glass', null);
              cap(o.pts, 6.8, 'roof', lin(0xe4e6e8));
              fsPoly(o.pts, 0, 6.8);
              break;
            // 'wall' (mur alei) tworzy prawa bariera prostej startowej, 'stand' osobno
          }
        } catch (e) { warn('obiekt ' + o.kind, e); }
      });
      // podium nad torem
      var pd = R2D.podium;
      if (pd && pd.pts && pd.pts.length >= 4) {
        var pp = pd.pts;
        prism(pp, 7.0, 8.4, 'paintV', lin(0xf1f1f1));
        cap(pp, 8.4, 'concrete', lin(0xb9bcc0));
        cap(pp, 7.0, 'concrete', lin(0x8d9096), true);
        prism(pp, 8.4, 9.4, 'glass', null);
        [pp[1], pp[2]].forEach(function (p) { box('concrete', p[0], 3.5, p[1], 0, 1.0, 7.0, 1.0, lin(0xc8cacd)); });
        fsPoly(pp, 7.0, 8.4);
      }
    });

    // ---------- stary owal i most ----------
    safe('owal', function () {
      var Bp = R2D.banking, br = R2D.bridge;
      if (!Bp || !br || Bp.length < 2) return;
      var nb = Bp.length, hg = [], dd = [], b;
      for (b = 0; b < nb; b++) { dd[b] = Math.hypot(Bp[b][0] - br.x, Bp[b][1] - br.y); hg[b] = 6.2 * clamp(1 - (dd[b] - 45) / 140, 0, 1) + 0.05; }
      var BB = bat('concrete', br.x, br.y), CC = lin(0x8f8c84), SK = lin(0xa9a69e), vacc = 0, nrm = [], prevBase = -1;
      for (b = 0; b < nb; b++) {
        var p = Bp[b], qn = Bp[Math.min(nb - 1, b + 1)], pr = Bp[Math.max(0, b - 1)];
        var tx = qn[0] - pr[0], tz = qn[1] - pr[1], l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
        nrm.push([nx, nz]);
        if (b > 0) vacc += Math.hypot(p[0] - Bp[b - 1][0], p[1] - Bp[b - 1][1]);
        var base = BB.v(p[0] - nx * 7.5, hg[b], p[1] - nz * 7.5, 0, 1, 0, 0, vacc / 10, CC[0], CC[1], CC[2]);
        BB.v(p[0] + nx * 7.5, hg[b] + 0.6, p[1] + nz * 7.5, 0, 1, 0, 1.5, vacc / 10, CC[0], CC[1], CC[2]);
        if (prevBase >= 0) BB.quad(prevBase, base, base + 1, prevBase + 1);
        prevBase = base;
      }
      // ściany nasypu i balustrady (poza przęsłem nad torem)
      for (b = 0; b + 1 < nb; b++) {
        if (hg[b] < 0.4 && hg[b + 1] < 0.4) continue;
        var pa = Bp[b], pb = Bp[b + 1], na = nrm[b], nn = nrm[b + 1];
        [-1, 1].forEach(function (s) {
          var ea = [pa[0] + na[0] * 7.5 * s, pa[1] + na[1] * 7.5 * s], eb = [pb[0] + nn[0] * 7.5 * s, pb[1] + nn[1] * 7.5 * s];
          var ha = hg[b] + (s > 0 ? 0.6 : 0), hb2 = hg[b + 1] + (s > 0 ? 0.6 : 0);
          if (Math.min(dd[b], dd[b + 1]) > 36) {
            BB.rect([ea[0], -0.06, ea[1]], [eb[0], -0.06, eb[1]], [eb[0], hb2, eb[1]], [ea[0], ha, ea[1]], na[0] * s, 0, na[1] * s,
              [0, ha / 4, 1, hb2 / 4, 1, 0, 0, 0], SK);
          }
          if (hg[b] > 1.2) {
            BB.rect([ea[0], ha, ea[1]], [eb[0], hb2, eb[1]], [eb[0], hb2 + 0.9, eb[1]], [ea[0], ha + 0.9, ea[1]], -na[0] * s, 0, -na[1] * s, [0, 0.25, 1, 0.25, 1, 0, 0, 0], SK);
            BB.rect([ea[0], ha, ea[1]], [eb[0], hb2, eb[1]], [eb[0], hb2 + 0.9, eb[1]], [ea[0], ha + 0.9, ea[1]], na[0] * s, 0, na[1] * s, [0, 0.25, 1, 0.25, 1, 0, 0, 0], SK);
          }
        });
      }
      // przęsło nad torem i filary
      box('concrete', br.x, 5.35, br.y, -br.ang, 70, 1.8, 16, lin(0xb0ada5));
      [-30, 30].forEach(function (off) { box('concrete', br.x + Math.cos(br.ang) * off, 2.225, br.y + Math.sin(br.ang) * off, -br.ang, 3, 4.45, 14, lin(0xa5a29a)); });
      // cienie dalekie: nasyp i przęsło
      var seg = [];
      for (b = 0; b < nb; b++) {
        if (hg[b] > 0.6) seg.push(b);
        if ((hg[b] <= 0.6 || b === nb - 1) && seg.length > 1) {
          [0.35, 0.7, 1.0].forEach(function (t) {
            fsStroke(seg.map(function (bi) { var o2 = hg[bi] * cotE * t; return [Bp[bi][0] + shDx * o2, Bp[bi][1] + shDz * o2]; }), 15, 96, false);
          });
          seg = [];
        } else if (hg[b] <= 0.6) seg = [];
      }
      var ca = Math.cos(br.ang), sa = Math.sin(br.ang);
      fsPoly([[br.x + ca * 35 - sa * 8, br.y + sa * 35 + ca * 8], [br.x - ca * 35 - sa * 8, br.y - sa * 35 + ca * 8], [br.x - ca * 35 + sa * 8, br.y - sa * 35 - ca * 8], [br.x + ca * 35 + sa * 8, br.y + sa * 35 - ca * 8]], 4.45, 6.25);
    });

    // ---------- tablice hamowania i DRS ----------
    function sign(x, z, tx, tz, w, y0, y1, uv, legs) {
      var rx = -tz, rz = tx; // prawa ręka patrzącego (= normalna toru)
      bat('sign', x, z).rect([x - rx * w / 2, y0, z - rz * w / 2], [x + rx * w / 2, y0, z + rz * w / 2], [x + rx * w / 2, y1, z + rz * w / 2], [x - rx * w / 2, y1, z - rz * w / 2], -tx, 0, -tz, uv);
      box('dark', x + tx * 0.13, (y0 + y1) / 2, z + tz * 0.13, -Math.atan2(rz, rx), w + 0.1, y1 - y0 + 0.1, 0.12);
      for (var e = 0; e < legs; e++) {
        var lo2 = legs > 1 ? (e ? 0.35 : -0.35) * w : 0;
        box('metal', x + tx * 0.15 + rx * lo2, y0 / 2, z + tz * 0.15 + rz * lo2, 0, 0.08, y0, 0.08);
      }
    }
    safe('tablice', function () {
      (R2D.boards || []).forEach(function (b) {
        if (!b || !b.p) return;
        var gi = nearI(b.p[0], b.p[1], 2), tx, tz;
        if (gi >= 0) { tx = T.tx[gi]; tz = T.ty[gi]; } else { tx = Math.cos(b.h || 0); tz = Math.sin(b.h || 0); }
        var cell = [200, 150, 100, 50].indexOf(b.n); if (cell < 0) cell = 0;
        var u0 = cell * 0.25 + 0.004, u1 = u0 + 0.242;
        sign(b.p[0], b.p[1], tx, tz, 1.2, 0.75, 1.95, [u0, 0.246, u1, 0.246, u1, 0.004, u0, 0.004], 1);
      });
      (T.drs || []).forEach(function (zn) {
        [[zn.detect, 0], [zn.from, 1]].forEach(function (d) {
          var i = d[0]; if (!(i >= 0 && i < N)) return;
          var lat = -(hw + 3.6), x = T.x[i] + T.nx[i] * lat, z = T.y[i] + T.ny[i] * lat;
          var u0 = d[1] * 0.5 + 0.004, u1 = u0 + 0.492;
          sign(x, z, T.tx[i], T.ty[i], 2.4, 1.5, 2.7, [u0, 0.496, u1, 0.496, u1, 0.254, u0, 0.254], 2);
        });
      });
    });

    // ---------- posterunki porządkowych ----------
    safe('posterunki', function () {
      var WB = lin(0xf0f0ee), OR = lin(0xf26b1d), GL = lin(0x23d160), step = mS(300), cnt = 0;
      for (var i = mS(150); i < N; i += step, cnt++) {
        var s = cnt % 2 ? 1 : -1;
        if (inMain(i) || (s < 0 ? markL : markR)[i]) { s = -s; if (inMain(i) || (s < 0 ? markL : markR)[i]) continue; }
        var bar = s < 0 ? T.barL[i] : T.barR[i], d = s * (bar + 3.4);
        var x = T.x[i] + T.nx[i] * d, z = T.y[i] + T.ny[i] * d, ry = -Math.atan2(T.ty[i], T.tx[i]);
        if (R2D.bridge && Math.hypot(x - R2D.bridge.x, z - R2D.bridge.y) < 60) continue;
        box('paintV', x, 1.2, z, ry, 2.4, 2.4, 2.0, WB);
        box('paintV', x, 2.5, z, ry, 2.9, 0.22, 2.5, OR);
        box('paintV', x, 0.35, z, ry, 2.5, 0.7, 2.1, OR);
        var px = x - T.nx[i] * s * 1.04, pz = z - T.ny[i] * s * 1.04;
        box('dark', px, 1.65, pz, ry, 1.0, 0.7, 0.08);
        box('paintV', px - T.nx[i] * s * 0.03, 1.65, pz - T.ny[i] * s * 0.03, ry, 0.84, 0.08, 0.04, GL);
        fsPoly([[x - 1.5, z - 1.5], [x + 1.5, z - 1.5], [x + 1.5, z + 1.5], [x - 1.5, z + 1.5]], 0, 2.6);
      }
    });

    // ---------- duże bilbordy przy prostych ----------
    safe('bilbordy', function () {
      var step = mS(380), cnt = 0;
      for (var i = mS(190); i < N; i += step, cnt++) {
        if (Math.abs(KS[i]) > 1 / 300) continue;
        var s = cnt % 2 ? -1 : 1;
        if (inMain(i) || (s < 0 ? markL : markR)[i]) continue;
        var bar = s < 0 ? T.barL[i] : T.barR[i], d = s * (bar + 7.5);
        var x = T.x[i] + T.nx[i] * d, z = T.y[i] + T.ny[i] * d;
        if (R2D.bridge && Math.hypot(x - R2D.bridge.x, z - R2D.bridge.y) < 70) continue;
        var fx = -T.tx[i] * 0.85 - s * T.nx[i] * 0.5, fz = -T.ty[i] * 0.85 - s * T.ny[i] * 0.5, fl = Math.hypot(fx, fz) || 1;
        fx /= fl; fz /= fl;
        var rx = fz, rz = -fx, Wd = 10, y0 = 2.6, ph = 1.25;
        for (var pn = 0; pn < 2; pn++) {
          var row = (cnt * 3 + pn * 5) % SPONSORS.length, ya = y0 + (1 - pn) * ph, yb = ya + ph;
          var vt = row / 8 + 0.004, vb = (row + 1) / 8 - 0.004;
          bat('hoard', x, z).rect([x - rx * Wd / 2, ya, z - rz * Wd / 2], [x + rx * Wd / 2, ya, z + rz * Wd / 2], [x + rx * Wd / 2, yb, z + rz * Wd / 2], [x - rx * Wd / 2, yb, z - rz * Wd / 2],
            fx, 0, fz, [0, vb, 1, vb, 1, vt, 0, vt]);
        }
        var bx = x - fx * 0.18, bz = z - fz * 0.18;
        box('dark', bx, y0 + ph, bz, -Math.atan2(rz, rx), Wd + 0.3, ph * 2 + 0.3, 0.2);
        box('metal', bx + rx * Wd * 0.35, y0 / 2, bz + rz * Wd * 0.35, 0, 0.25, y0 + 0.2, 0.25);
        box('metal', bx - rx * Wd * 0.35, y0 / 2, bz - rz * Wd * 0.35, 0, 0.25, y0 + 0.2, 0.25);
        fsStroke([[x - rx * Wd / 2 + shDx * 4 * cotE, z - rz * Wd / 2 + shDz * 4 * cotE], [x + rx * Wd / 2 + shDx * 4 * cotE, z + rz * Wd / 2 + shDz * 4 * cotE]], 2.6 * cotE, 110, false);
      }
    });

    flush();

    // ---------- bramka ze światłami startu ----------
    safe('światła startu', function () {
      var gi = wrapI(-Math.round(4 / ds), N), gAng = Math.atan2(T.ty[gi], T.tx[gi]);
      var grp = new THREE.Group(); grp.position.set(T.x[gi], 0, T.y[gi]); grp.rotation.y = -gAng; scene.add(grp);
      var GB = new Batch('dark'), span = hw + 2.4;
      GB.geo(unitBox, boxM(0, 7.3, 0, 0, 0.7, 1.1, span * 2 + 0.6));
      GB.geo(unitBox, boxM(0, 3.65, -span, 0, 0.5, 7.3, 0.5));
      GB.geo(unitBox, boxM(0, 3.65, span, 0, 0.5, 7.3, 0.5));
      for (var L = 0; L < 5; L++) GB.geo(unitBox, boxM(-0.5, 7.3, (L - 2) * 1.0, 0, 0.45, 1.7, 0.8));
      var gm = new THREE.Mesh(keep(GB.build()), M.dark);
      gm.castShadow = shadowsOn; gm.receiveShadow = shadowsOn; grp.add(gm);
      var sph = keep(new THREE.SphereGeometry(0.21, 12, 8));
      for (var L2 = 0; L2 < 5; L2++) {
        var lm = keep(new THREE.MeshStandardMaterial({ color: 0x2a0707, emissive: 0xff1a10, emissiveIntensity: 0, roughness: 0.3, metalness: 0 }));
        self.lightMats.push(lm);
        var LB = new Batch('l');
        LB.geo(sph, boxM(-0.74, 6.9, (L2 - 2) * 1.0, 0, 1, 1, 1));
        LB.geo(sph, boxM(-0.74, 7.7, (L2 - 2) * 1.0, 0, 1, 1, 1));
        grp.add(new THREE.Mesh(keep(LB.build()), lm));
      }
    });

    // ---------- las: trzy poziomy szczegółów (geometrie i atlas — js/trees3d.js) ----------
    // Blisko kamery (do detR) pełne drzewa, dalej do treeNear uproszczone (te same kłęby, mniej i większych kart),
    // dalej kłęby w kuli albo stożek świerka. Listy bliskich i średnich drzew są przepisywane, gdy kamera się
    // przesunie (bliskie co 3 m, średnie co 20 m); dalekie siatki są stałe (duże komórki), a drzewo rysowane przez
    // bliższy poziom shader zwija do punktu — każde drzewo jest rysowane dokładnie raz.
    safe('drzewa', function () {
      var T3 = PG.Trees3D, list = [];
      if (!T3 || !TX.foliage) return;
      if (R2D.treeGrid && R2D.treeGrid.forEach) R2D.treeGrid.forEach(function (arr) { for (var t = 0; t < arr.length; t++) list.push(arr[t]); });
      if (!list.length) return;
      var step = hi ? 1 : q === 'medium' ? 2 : 3, NV = 2, NK = T3.SHAPES.length, NVAR = NK * NV;
      var detR = hi ? 110 : q === 'medium' ? 70 : 0, midR = self.treeNear, k, v, i, t;
      var detGeo = [], midGeo = [];
      for (k = 0; k < NK; k++) for (v = 0; v < NV; v++) {
        if (detR > 0) detGeo.push(keep(T3.nearGeometry(k, v, 2)));
        midGeo.push(keep(T3.nearGeometry(k, v, lo ? 0 : 1)));
      }
      var farGeo = [keep(T3.farGeometry(false)), keep(T3.farGeometry(true))];
      // dane drzew: położenie, wariant, macierz (pień na ziemi) i barwa liści
      var n = Math.ceil(list.length / step), TXa = new Float32Array(n), TZa = new Float32Array(n), TVa = new Uint8Array(n);
      var TMa = new Float32Array(n * 16), TCa = new Float32Array(n * 3), cntV = new Int32Array(NVAR);
      var mtx = new THREE.Matrix4(), qt = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), cc = new THREE.Color();
      var FCH = lo ? 900 : 600, farCells = {}, farKeys = [];
      fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalCompositeOperation = 'multiply';
      for (t = 0, i = 0; t < list.length; t += step, i++) {
        var tr = list[t], kind = T3.KIND_OF[(tr.v % 6) | 0] || 0, S = T3.SHAPES[kind];
        var ix = Math.round(tr.x * 10), iz = Math.round(tr.y * 10), hsh = hash2(ix, iz);
        var vi = kind * NV + (hash2(ix + 7, iz - 3) < 0.5 ? 0 : 1);
        var r = (tr.r || 4) * (0.92 + hsh * 0.16), ry = 1 + (hash2(ix - 11, iz + 17) - 0.5) * 0.2;
        qt.setFromAxisAngle(UP, hsh * 6.283);
        cc.setHex(GREENS[(tr.v % 6) | 0] || GREENS[0]);
        var kc = (0.78 + hash2(ix + 5, iz + 23) * 0.4) * 1.22;
        cc.r *= kc * S.tint[0]; cc.g *= kc * S.tint[1]; cc.b *= kc * S.tint[2];
        mtx.compose(pv.set(tr.x, 0, tr.y), qt, sv.set(r, r * ry, r)).toArray(TMa, i * 16);
        TCa[i * 3] = cc.r; TCa[i * 3 + 1] = cc.g; TCa[i * 3 + 2] = cc.b;
        TXa[i] = tr.x; TZa[i] = tr.y; TVa[i] = vi; cntV[vi]++;
        // daleki LOD (środek w środku korony), osobno korony okrągłe i stożki
        var fkey = Math.floor(tr.x / FCH) + ',' + Math.floor(tr.y / FCH) + ',' + S.cone, fc = farCells[fkey];
        if (!fc) { fc = farCells[fkey] = { cone: S.cone, m: [], c: [] }; farKeys.push(fkey); }
        mtx.compose(pv.set(tr.x, S.cy * r * ry, tr.y), qt, sv.set(S.sx * r, S.sy * r * ry, S.sz * r));
        for (k = 0; k < 16; k++) fc.m.push(mtx.elements[k]);
        fc.c.push(cc.r, cc.g, cc.b);
        fsTree(tr.x, tr.y, Math.max(S.sx, S.sz) * r, S.cy * r * ry, S.sy * r * ry);
      }
      n = i;
      self.treeCount = n;
      farKeys.forEach(function (key) {
        var fc = farCells[key], cnt = fc.c.length / 3, im = new THREE.InstancedMesh(farGeo[fc.cone ? 1 : 0], M.treeFar, cnt);
        im.instanceMatrix.array.set(fc.m);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(fc.c), 3);
        im.castShadow = false; im.receiveShadow = false; im.matrixAutoUpdate = false; im.updateMatrix();
        if (im.computeBoundingSphere) im.computeBoundingSphere();
        scene.add(im); keep(im);
      });
      // siatka do wybierania drzew wokół kamery (sortowanie przez zliczanie)
      var GC = 64, gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
      for (i = 0; i < n; i++) { gx0 = Math.min(gx0, TXa[i]); gx1 = Math.max(gx1, TXa[i]); gz0 = Math.min(gz0, TZa[i]); gz1 = Math.max(gz1, TZa[i]); }
      var GW = Math.floor((gx1 - gx0) / GC) + 1, GH = Math.floor((gz1 - gz0) / GC) + 1, cellOf = new Int32Array(n);
      var cellStart = new Int32Array(GW * GH + 1), cellItems = new Int32Array(n), fillAt = new Int32Array(GW * GH);
      for (i = 0; i < n; i++) { cellOf[i] = Math.floor((TZa[i] - gz0) / GC) * GW + Math.floor((TXa[i] - gx0) / GC); cellStart[cellOf[i] + 1]++; }
      for (i = 0; i < GW * GH; i++) { cellStart[i + 1] += cellStart[i]; fillAt[i] = cellStart[i]; }
      for (i = 0; i < n; i++) cellItems[fillAt[cellOf[i]]++] = i;
      // listy rysowane: blisko (rzucają cień), średnio w zasięgu cieni (rzucają) i średnio dalej (bez cieni)
      var depthMid = keep(T3.depthMaterial(self.windU, { lod: self.treeLodMid }));
      function dynMesh(geo, mat, cap, cast, depthMat) {
        var im = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        im.count = 0; im.visible = false; im.frustumCulled = false;
        im.castShadow = cast; im.receiveShadow = cast && hi;
        if (depthMat) im.customDepthMaterial = depthMat;
        im.matrixAutoUpdate = false; im.updateMatrix();
        scene.add(im); keep(im);
        return im;
      }
      var detM = [], midN = [], midF = [];
      for (v = 0; v < NVAR; v++) {
        if (detR > 0) detM.push(dynMesh(detGeo[v], M.treeDet, Math.min(cntV[v], 1500), shadowsOn, null));
        if (shadowsOn) midN.push(dynMesh(midGeo[v], M.tree, Math.min(cntV[v], 3000), true, depthMid));
        midF.push(dynMesh(midGeo[v], M.tree, cntV[v], false, null));
      }
      function scan(cx, cz, R, fn) {
        var ax = Math.max(0, Math.floor((cx - R - gx0) / GC)), bx = Math.min(GW - 1, Math.floor((cx + R - gx0) / GC));
        var az = Math.max(0, Math.floor((cz - R - gz0) / GC)), bz = Math.min(GH - 1, Math.floor((cz + R - gz0) / GC)), R2 = R * R;
        for (var gz = az; gz <= bz; gz++) for (var gx = ax; gx <= bx; gx++) {
          var c = gz * GW + gx;
          for (var p = cellStart[c]; p < cellStart[c + 1]; p++) {
            var j = cellItems[p], dx = TXa[j] - cx, dz = TZa[j] - cz;
            if (dx * dx + dz * dz <= R2) fn(j);
          }
        }
      }
      function put(im, j) {
        var c = im.count;
        if (c >= im.instanceMatrix.count) return;
        im.instanceMatrix.array.set(TMa.subarray(j * 16, j * 16 + 16), c * 16);
        var ca = im.instanceColor.array;
        ca[c * 3] = TCa[j * 3]; ca[c * 3 + 1] = TCa[j * 3 + 1]; ca[c * 3 + 2] = TCa[j * 3 + 2];
        im.count = c + 1;
      }
      function reset(arr) { for (var a = 0; a < arr.length; a++) arr[a].count = 0; }
      function flush(arr) {
        for (var a = 0; a < arr.length; a++) {
          var im = arr[a], c = im.count;
          im.visible = c > 0;
          if (!c) continue;
          im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, c * 16); im.instanceMatrix.needsUpdate = true;
          im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, c * 3); im.instanceColor.needsUpdate = true;
        }
      }
      // k — mnożnik zasięgów dla wąskiego kąta widzenia (kamery TV z daleka widzą drzewa jak z bliska)
      var F = self.forest = { dcx: 1e9, dcz: 1e9, mcx: 1e9, mcz: 1e9, scx: 1e9, scz: 1e9, detR: detR, midR: midR, k: 1 };
      F.rebuildDet = function (cx, cz) {
        F.dcx = cx; F.dcz = cz;
        if (!detM.length) return;
        var R = detR * F.k;
        reset(detM);
        scan(cx, cz, R, function (j) { put(detM[TVa[j]], j); });
        flush(detM);
        self.treeLodMid.value.set(cx, cz, R, 0);
      };
      // sr — promień wokół (scx, scz), w którym drzewa mogą rzucić cień do mapy cieni
      F.rebuildMid = function (cx, cz, scx, scz, sr) {
        F.mcx = cx; F.mcz = cz; F.scx = scx; F.scz = scz;
        var sr2 = sr * sr, useN = midN.length > 0 && sr > 0, R = midR * F.k;
        reset(midN); reset(midF);
        scan(cx, cz, R, function (j) {
          var dx = TXa[j] - scx, dz = TZa[j] - scz;
          put(useN && dx * dx + dz * dz <= sr2 ? midN[TVa[j]] : midF[TVa[j]], j);
        });
        flush(midN); flush(midF);
        self.treeLodFar.value.set(cx, cz, R, 0);
      };
    });
    // ---------- trawa 3D: kępki w siatce wokół kamery (położenie i maska liczone w shaderze) ----------
    // Maska w rzucie z góry: R — odległość od twardej nawierzchni (0..20 m, pole odległości dobrze się interpoluje),
    // G — gdzie rośnie trawa (pas między poboczem a barierą i trawnik za barierą bez trybun).
    safe('trawa 3D', function () {
      if (lo || !TX.tuft) return;
      var MS = 2048, mk2 = MS / FL, DF = 20;
      var cA = makeCanvas(MS, MS), gA = cA.getContext('2d'), cB = makeCanvas(MS, MS), gB = cB.getContext('2d');
      gA.fillStyle = '#000'; gA.fillRect(0, 0, MS, MS);
      gB.fillStyle = '#fff'; gB.fillRect(0, 0, MS, MS); gB.globalCompositeOperation = 'darken';
      function P(i, lat) { return [(T.x[i] + T.nx[i] * lat - fx0) * mk2, (T.y[i] + T.ny[i] * lat - fz0) * mk2]; }
      function quad(g2, i, i1, s, a0, a1, b0, b1) {
        var p0 = P(i, s * a0), p1 = P(i1, s * b0), p2 = P(i1, s * b1), p3 = P(i, s * a1);
        g2.beginPath(); g2.moveTo(p0[0], p0[1]); g2.lineTo(p1[0], p1[1]); g2.lineTo(p2[0], p2[1]); g2.lineTo(p3[0], p3[1]); g2.closePath(); g2.fill();
      }
      [[-1, T.surfL, T.barL, T.kerbL, markL], [1, T.surfR, T.barR, T.kerbR, markR]].forEach(function (sd) {
        var s = sd[0], surf = sd[1], bar = sd[2], kb = sd[3], mkS = sd[4];
        function hard(i) { // zewnętrzna krawędź twardej nawierzchni (asfalt, krawężnik, żwir, pobocze asfaltowe)
          if (surf[i] === 1 || surf[i] === 2) return Math.max(hw + 2, Math.min(bar[i] - 0.4, maxIn(i, s)));
          return kb[i] ? hw + 1.5 : hw;
        }
        for (var i = 0; i < N; i++) {
          var i1 = (i + 1) % N, h0 = hard(i), h1 = hard(i1);
          // pole odległości: gradient od krawędzi (0) do DF metrów dalej (1)
          var q0 = P(i, s * h0), q1 = P(i, s * (h0 + DF)), gr = gB.createLinearGradient(q0[0], q0[1], q1[0], q1[1]);
          gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); gB.fillStyle = gr;
          quad(gB, i, i1, s, h0 - 8, h0 + DF, h1 - 8, h1 + DF); // cała nawierzchnia w środku ma 0
          // przed barierą
          var e0 = Math.min(bar[i] - 0.3, maxIn(i, s)), e1 = Math.min(bar[i1] - 0.3, maxIn(i1, s));
          gA.fillStyle = '#fff';
          if (e0 > h0 + 0.6 && e1 > h1 + 0.6) quad(gA, i, i1, s, h0 + 0.2, e0, h1 + 0.2, e1);
          // za barierą (bez trybun i siatek)
          if (!mkS[i] && !inMain(i)) { var b0 = bar[i] + barT(s, i) + 0.4, b1 = bar[i1] + barT(s, i1) + 0.4; quad(gA, i, i1, s, b0, bar[i] + 8.5, b1, bar[i1] + 8.5); }
        }
      });
      var dA = gA.getImageData(0, 0, MS, MS).data, dB = gB.getImageData(0, 0, MS, MS).data, md = new Uint8Array(MS * MS * 4);
      for (var k = 0; k < MS * MS; k++) { md[k * 4] = dB[k * 4]; md[k * 4 + 1] = dA[k * 4]; md[k * 4 + 3] = 255; }
      cA.width = cA.height = cB.width = cB.height = 1;
      var mtex = keep(new THREE.DataTexture(md, MS, MS, THREE.RGBAFormat, THREE.UnsignedByteType));
      mtex.minFilter = THREE.LinearFilter; mtex.magFilter = THREE.LinearFilter; mtex.generateMipmaps = false; mtex.needsUpdate = true;
      // siatka kępek w kole o promieniu RAD (komórka CS), każda kępka to dwie skrzyżowane karty
      var CS = hi ? 0.36 : 0.5, RAD = hi ? 34 : 24, G2 = Math.ceil(RAD / CS), pos = [], uv = [], cell = [], nor = [], ix = [], vc = 0;
      var QX = [[-0.17, 0, 0.17, 0], [0, -0.17, 0, 0.17]];
      for (var gz = -G2; gz <= G2; gz++) for (var gx = -G2; gx <= G2; gx++) {
        if (gx * gx + gz * gz > G2 * G2) continue;
        for (var c2 = 0; c2 < 2; c2++) {
          var Qd = QX[c2];
          pos.push(Qd[0], 0, Qd[1], Qd[2], 0, Qd[3], Qd[2], 1, Qd[3], Qd[0], 1, Qd[1]);
          uv.push(0, 1, 1, 1, 1, 0, 0, 0);
          for (var v4 = 0; v4 < 4; v4++) { cell.push(gx, gz); nor.push(0, 1, 0); }
          ix.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3); vc += 4;
        }
      }
      var gg = keep(new THREE.BufferGeometry());
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      gg.setAttribute('aCell', new THREE.Float32BufferAttribute(cell, 2));
      gg.setIndex(new THREE.Uint32BufferAttribute(ix, 1));
      var GU = self.grassU = {
        o: { value: new THREE.Vector3(0, 0, CS) }, xf: { value: new THREE.Vector4(fx0, fz0, 1 / FL, 1 / FL) },
        mask: { value: mtex }, r: { value: new THREE.Vector2(RAD, 0.15) }, t: self.windU
      };
      var GV_PARS = '\nuniform vec3 uGrassO;\nuniform vec4 uGrassXf;\nuniform sampler2D uGrassMask;\nuniform vec2 uGrassR;\nuniform float uWindT;\nattribute vec2 aCell;\n';
      var GV_BEGIN = [
        'vec2 gC = floor( uGrassO.xy / uGrassO.z ) + aCell;',
        'vec3 gH = fract( vec3( gC.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );',
        'gH += dot( gH, gH.yzx + 33.33 );',
        'gH = fract( ( gH.xxy + gH.yzz ) * gH.zyx );',
        'vec2 gW = ( gC + gH.xy ) * uGrassO.z;',
        'vec4 gM = texture2D( uGrassMask, ( gW - uGrassXf.xy ) * uGrassXf.zw );',
        'float gD = distance( gW, uGrassO.xy );',
        // dalej od krawędzi asfaltu pewniej (pole odległości: R*20 m), na skraju koła kępki maleją
        'float gS = step( 0.2 + 0.6 * gH.z, gM.g ) * smoothstep( 0.03, 0.06, gM.r ) * ( 1.0 - smoothstep( uGrassR.x * 0.55, uGrassR.x, gD ) );',
        'gS *= 0.55 + 0.75 * gH.z;',
        'float gA = gH.x * 6.2832, gCa = cos( gA ), gSa = sin( gA );',
        'vec3 transformed = vec3( position );',
        'transformed.xz = vec2( gCa * position.x - gSa * position.z, gSa * position.x + gCa * position.z ) * ( 0.8 + 0.5 * gH.y ) * step( 0.02, gS );',
        'transformed.y *= uGrassR.y * gS;',
        'float gWv = sin( uWindT * 1.9 + gW.x * 0.35 + gW.y * 0.21 ) * 0.6 + sin( uWindT * 3.7 + gW.x * 1.3 ) * 0.3;',
        'transformed.xz += position.y * gS * uGrassR.y * vec2( 0.4, 0.25 ) * gWv;',
        'transformed.x += gW.x; transformed.z += gW.y; transformed.y -= 0.035;'
      ].join('\n');
      var gm = M.grassTuft;
      farShadowMat(gm, farU, function (sh) {
        sh.uniforms.uGrassO = GU.o; sh.uniforms.uGrassXf = GU.xf; sh.uniforms.uGrassMask = GU.mask; sh.uniforms.uGrassR = GU.r; sh.uniforms.uWindT = GU.t;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>' + GV_PARS).replace('#include <begin_vertex>', GV_BEGIN);
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', NO_FLIP);
      }, 'g');
      var mesh = new THREE.Mesh(gg, gm);
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = shadowsOn;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      scene.add(mesh);
      self.grassMesh = mesh;
    });
    try { fg.setTransform(1, 0, 0, 1, 0, 0); fg.globalCompositeOperation = 'source-over'; } catch (e) { /* nic */ }
    farTex.needsUpdate = true;

    // ---------- deszcz (smugi z zanikającym końcem) ----------
    safe('deszcz', function () {
      var RN = hi ? 4500 : q === 'medium' ? 3000 : 1500, R = rng(99);
      var rp = new Float32Array(RN * 6), rc = new Float32Array(RN * 8);
      for (var r = 0; r < RN; r++) {
        var x = (R() - 0.5) * 70, y = R() * 34 - 4, z = (R() - 0.5) * 70, len = 0.5 + R() * 0.5, o6 = r * 6, o8 = r * 8;
        rp[o6] = x; rp[o6 + 1] = y; rp[o6 + 2] = z; rp[o6 + 3] = x - 0.04; rp[o6 + 4] = y - len; rp[o6 + 5] = z + 0.02;
        rc[o8] = 0.75; rc[o8 + 1] = 0.8; rc[o8 + 2] = 0.88; rc[o8 + 3] = 0;
        rc[o8 + 4] = 0.75; rc[o8 + 5] = 0.8; rc[o8 + 6] = 0.88; rc[o8 + 7] = 0.5;
      }
      var rg = keep(new THREE.BufferGeometry());
      rg.setAttribute('position', new THREE.BufferAttribute(rp, 3).setUsage(THREE.DynamicDrawUsage));
      rg.setAttribute('color', new THREE.BufferAttribute(rc, 4));
      var rain = new THREE.LineSegments(rg, keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));
      rain.visible = false; rain.frustumCulled = false; rain.renderOrder = 6;
      scene.add(rain);
      self.rain = rain; self.rainPos = rp;
    });

    try { this.setWeather({ weather: 'sun' }); } catch (e) { warn('pogoda', e); }
    this.setFocus(T.x[0], T.y[0]);
  };

  var W = PG.World3DLite.prototype;

  // Pudełko cieni wokół ogniska, przyciągane do siatki tekseli (bez migotania)
  W._placeSun = function () {
    var sun = this.sun; if (!sun) return;
    var fx = this.focus.x + this.fwd.x, fz = this.focus.z + this.fwd.z;
    var X = this.lsX, Y = this.lsY, Z = this.lsZ;
    var px = fx * X.x + fz * X.z, py = fx * Y.x + fz * Y.z, pz = fx * Z.x + fz * Z.z;
    if (this.shadowSize > 0) {
      var tx0 = 2 * this.shadowExt / this.shadowSize;
      px = Math.round(px / tx0) * tx0; py = Math.round(py / tx0) * tx0;
    }
    var tx = X.x * px + Y.x * py + Z.x * pz, ty = X.y * px + Y.y * py + Z.y * pz, tz = X.z * px + Y.z * py + Z.z * pz;
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + Z.x * 200, ty + Z.y * 200, tz + Z.z * 200);
    sun.target.updateMatrixWorld();
    if (this.shadowsOn && this.farU) this.farU.fade.value.set(tx, tz, this.shadowExt * 0.62, this.shadowExt * 0.9);
  };

  W.setFocus = function (x, z) {
    if (!isFinite(x) || !isFinite(z)) return;
    this.focus.set(x, 0, z);
    this._placeSun();
  };

  // Mapa otoczenia (odbicia) z nieba bieżącej pogody
  W._makeEnv = function () {
    if (!this.renderer || !this.envScene || !this.skyMat) { this.envOK = false; return; }
    var u = this.skyMat.uniforms, disk = u.uSunDisk.value;
    try {
      if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
      u.uSunDisk.value = 0;
      var rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt; this.scene.environment = rt.texture; this.envOK = true;
    } catch (e) {
      warn('otoczenie', e); this.envOK = false; this.scene.environment = null;
    }
    u.uSunDisk.value = disk;
  };

  W.setWeather = function (env) {
    var key = env && (env.wet || env.weather === 'rain') ? 'rain' : (env && env.weather === 'cloud' ? 'cloud' : 'sun');
    var P = WEATHER[key], M = this.mats, w = P.wet, k;
    var changed = key !== this.wKey;
    this.wKey = key; this.exposure = P.exp;
    if (this.renderer) { try { this.renderer.toneMappingExposure = P.exp; } catch (e) { /* nic */ } }
    if (this.skyMat) {
      var u = this.skyMat.uniforms;
      u.uZenith.value.setRGB(P.zen[0], P.zen[1], P.zen[2]);
      u.uHorizon.value.setRGB(P.hor[0], P.hor[1], P.hor[2]);
      u.uGround.value.setRGB(P.gnd[0], P.gnd[1], P.gnd[2]);
      u.uSunCol.value.setRGB(P.skySun[0], P.skySun[1], P.skySun[2]);
      u.uCloudCol.value.setRGB(P.cloudC[0], P.cloudC[1], P.cloudC[2]);
      u.uCloud.value.x = P.cloud[0]; u.uCloud.value.y = P.cloud[1]; u.uCloud.value.w = P.cloud[2];
      u.uSunDisk.value = P.disk; u.uHaze.value = P.haze;
    }
    // mgła = kolor horyzontu po mapowaniu tonów (bez szwu z niebem)
    var fc = aces(P.hor, P.exp);
    this._fogMap = fc; this._fogLin = P.hor.slice();
    if (this.scene.fog) { this.scene.fog.color.setRGB(fc[0], fc[1], fc[2]); this.scene.fog.near = P.fogN; this.scene.fog.far = P.fogF; }
    if (this.scene.background && this.scene.background.isColor) this.scene.background.setRGB(fc[0], fc[1], fc[2]);
    if (changed || !this.envOK) this._makeEnv();
    if (this.sun) { this.sun.color.setRGB(P.sunC[0], P.sunC[1], P.sunC[2]); this.sun.intensity = P.sunI; }
    if (this.hemi) {
      this.hemi.color.setRGB(P.hemiS[0], P.hemiS[1], P.hemiS[2]);
      this.hemi.groundColor.setRGB(P.hemiG[0], P.hemiG[1], P.hemiG[2]);
      this.hemi.intensity = this.envOK ? P.hemiI : P.hemiI * 1.6; // bez mapy otoczenia więcej światła rozproszonego
    }
    // nawierzchnie: mokry tor ciemniejszy i błyszczący
    M.asphalt.color.setScalar(w ? 0.58 : 1); M.asphalt.roughness = w ? 0.24 : 1;
    M.runoff.color.setScalar(w ? 0.6 : 0.96); M.runoff.roughness = w ? 0.28 : 1;
    M.kerb.roughness = w ? 0.22 : 0.55; M.paint.roughness = w ? 0.22 : 0.6; M.chk.roughness = w ? 0.25 : 0.6;
    M.grass.color.setRGB(w ? 0.8 : 1, w ? 0.86 : 1, w ? 0.8 : 1); M.lawn.color.copy(M.grass.color);
    if (M.grassTuft) M.grassTuft.color.copy(M.grass.color);
    M.gravel.color.setScalar(w ? 0.72 : 1);
    M.paddock.color.setScalar(w ? 0.7 : 1); M.paddock.roughness = w ? 0.35 : 0.9;
    M.concrete.color.setScalar(w ? 0.82 : 1); M.concrete.roughness = w ? 0.6 : 0.88;
    for (k = 0; k < ENV_MATS.length; k++) if (M[ENV_MATS[k]]) M[ENV_MATS[k]].envMapIntensity = P.envI;
    M.asphalt.envMapIntensity = M.runoff.envMapIntensity = w ? 1.15 : P.envI * 0.9;
    M.glass.envMapIntensity = 1.4; M.metal.envMapIntensity = 1.1; M.fence.envMapIntensity = P.envI;
    if (this.farU) this.farU.str.value.x = P.shStr;
    if (this.rain) this.rain.visible = w;
  };

  W.setStartLights = function (n) {
    var L = this.lightMats || [];
    for (var i = 0; i < L.length; i++) L[i].emissiveIntensity = (n >= 0 && i < n) ? 6 : 0;
  };

  W.update = function (dt, camera) {
    if (!(dt > 0 && dt < 1)) dt = 0;
    this.time += dt;
    if (this.skyMat) this.skyMat.uniforms.uCloud.value.z = this.time;
    if (!camera) return;
    var cp = camera.position;
    if (this.sky) this.sky.position.copy(cp);
    // pudełko cieni wysunięte przed kamerę, gdy jest blisko ogniska
    if (this.shadowsOn) {
      var dx = cp.x - this.focus.x, dz = cp.z - this.focus.z;
      if (dx * dx + dz * dz < 1600) {
        var v = this._v; camera.getWorldDirection(v);
        var l = Math.sqrt(v.x * v.x + v.z * v.z), f = this.shadowExt * 0.35;
        if (l > 1e-3) this.fwd.set(v.x / l * f, 0, v.z / l * f); else this.fwd.set(0, 0, 0);
      } else this.fwd.set(0, 0, 0);
      this._placeSun();
    }
    // wiatr (drzewa, trawa) i środek siatki trawy 3D (z góry trawy nie widać — wyłączona)
    if (this.windU) this.windU.value = this.time;
    if (this.grassU && this.grassMesh) {
      this.grassMesh.visible = cp.y < 14;
      this.grassU.o.value.x = cp.x; this.grassU.o.value.y = cp.z;
    }
    // las: listy drzew bliskich i średnich wokół kamery; cienie rzucają drzewa, których cień może paść w pudełko
    // cieni (wzdłuż kierunku słońca sięga ext / sin(wysokości), w poprzek ext; do tego cień drzewa do 30 m wysokości
    // i zapas na ruch kamery między przebudowami list)
    var F = this.forest;
    if (F) {
      var scx = cp.x, scz = cp.z, sr = 0;
      if (this.shadowsOn && this.sun) {
        var st = this.sun.target.position, ext = this.shadowExt, along = ext * Math.sqrt(1 + this.cotE * this.cotE);
        scx = st.x; scz = st.z;
        sr = Math.sqrt(ext * ext + along * along) + 30 * this.cotE + 12 + 25;
      }
      // wąski kąt widzenia (teleobiektyw kamer TV): większe zasięgi szczegółów, skwantowane, by nie przebudowywać list
      // przy każdej zmianie zbliżenia
      var kf = 1;
      if (camera.fov > 0) kf = clamp(0.7265 / Math.max(0.05, Math.tan(camera.fov * Math.PI / 360)), 1, 1.4);
      kf = Math.round(kf * 5) / 5;
      var force = kf !== F.k;
      F.k = kf;
      var mdx = cp.x - F.mcx, mdz = cp.z - F.mcz, sdx = scx - F.scx, sdz = scz - F.scz;
      if (force || mdx * mdx + mdz * mdz > 400 || sdx * sdx + sdz * sdz > 225) F.rebuildMid(cp.x, cp.z, scx, scz, sr);
      var ddx = cp.x - F.dcx, ddz = cp.z - F.dcz;
      if (force || ddx * ddx + ddz * ddz > 9) F.rebuildDet(cp.x, cp.z);
    }
    // deszcz: każda kropla zawija się osobno
    if (this.rain && this.rain.visible && this.rainPos) {
      var P = this.rainPos, fall = dt * 24;
      for (var j = 0; j < P.length; j += 6) {
        P[j + 1] -= fall; P[j + 4] -= fall;
        if (P[j + 1] < -4) { P[j + 1] += 34; P[j + 4] += 34; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.set(cp.x, cp.y - 10, cp.z);
    }
  };

  W.dispose = function () {
    this.disposables.forEach(function (d) { try { if (d && d.dispose) d.dispose(); } catch (e) { /* nic */ } });
    this.disposables = [];
    this.forest = null;
    if (this.envRT) { try { this.envRT.dispose(); } catch (e) { /* nic */ } this.envRT = null; }
    if (this.pmrem) { try { this.pmrem.dispose(); } catch (e) { /* nic */ } this.pmrem = null; }
    if (this.sun && this.sun.shadow && this.sun.shadow.dispose) { try { this.sun.shadow.dispose(); } catch (e) { /* nic */ } }
    if (this.scene) this.scene.environment = null;
  };
})(PG);
