// WORLD GP — wnętrze kokpitu w widoku z kokpitu (wzorowane na kokpicie współczesnego bolidu F1):
// kierownica z dużym wyświetlaczem, rzędem diod obrotów i diodami flag, kolorowymi przyciskami (N, +10, BW, PC, +1,
// PL), jasnoniebieskimi rolkami pod kciukami, trzema pokrętłami z kolorowymi skalami i gumowymi uchwytami odchylonymi
// na boki; dłonie w rękawicach obracające się z kierownicą i przedramiona w kombinezonie; wanna kokpitu z panelami
// z wytłoczeniami (osłony przeciwprzebiciowe), jasnoszara poduszka przed kolanami, przezroczysta owiewka z zębami
// na przedniej krawędzi, panel przełączników z lewej, naklejki ostrzegawcze, obszycie krawędzi i boczne poduszki.
// Model w układzie bolidu (x do przodu, y w górę, z w prawo) — dziecko nadwozia.
// API: build({ livery, helmet, quality }) → obiekt; update(obj, car, S, dt); setVisible(obj, on); dispose(obj).
(function (PG) {
  'use strict';
  if (typeof THREE === 'undefined') return;

  var PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rng(seed) { var s = seed >>> 0 || 1; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  var FONT = '"Barlow Semi Condensed", "Titillium Web", "Arial Narrow", Arial, sans-serif';

  // środek kierownicy w układzie bolidu i nachylenie płaszczyzny (góra odchylona do przodu)
  var SW_POS = [0.705, 0.555, 0], SW_TILT = 25 * PI / 180, MAX_ANG = 1.5;
  // płyta czołowa kierownicy (lokalnie: x w prawo, y w górę, +z w stronę kierowcy)
  var FX = 0.118, FY0 = -0.072, FY1 = 0.074, FACE_Z = 0.014;

  // obrys korpusu: prostokąt z „uszami" na górnych rogach i zwężonym dołem pod pokrętłami
  function bodyShape() {
    var s = new THREE.Shape();
    s.moveTo(0, FY0);
    s.lineTo(0.058, FY0); s.quadraticCurveTo(0.082, FY0 + 0.002, 0.09, -0.052);
    s.quadraticCurveTo(0.1, -0.02, 0.106, 0.004); s.lineTo(0.112, 0.03);
    s.quadraticCurveTo(FX, 0.046, FX, 0.06); s.quadraticCurveTo(FX, FY1, 0.104, FY1);
    s.lineTo(0.03, FY1 - 0.002); s.lineTo(0, FY1 - 0.003);
    s.lineTo(-0.03, FY1 - 0.002); s.lineTo(-0.104, FY1);
    s.quadraticCurveTo(-FX, FY1, -FX, 0.06); s.quadraticCurveTo(-FX, 0.046, -0.112, 0.03);
    s.lineTo(-0.106, 0.004); s.quadraticCurveTo(-0.1, -0.02, -0.09, -0.052);
    s.quadraticCurveTo(-0.082, FY0 + 0.002, -0.058, FY0); s.closePath();
    return s;
  }
  // uchwyt (prawy; lewy jako odbicie): gruby, lekko zakrzywiony, odchylony na zewnątrz u dołu
  function gripShape() {
    var s = new THREE.Shape();
    s.moveTo(0.104, 0.05);
    s.quadraticCurveTo(0.126, 0.064, 0.142, 0.048);
    s.quadraticCurveTo(0.152, 0.0, 0.158, -0.07);
    s.quadraticCurveTo(0.16, -0.098, 0.138, -0.1);
    s.quadraticCurveTo(0.12, -0.098, 0.118, -0.074);
    s.quadraticCurveTo(0.112, -0.02, 0.102, 0.012);
    s.closePath();
    return s;
  }
  function roundRect(w, h, r) {
    var s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }

  // ---------- elementy płyty czołowej ----------
  // przyciski okrągłe: x, y, kolor, napis, kolor napisu
  var BUTTONS = [
    [-0.1, 0.061, '#20307a', 'N', '#ffffff'], [-0.084, 0.055, '#20307a', '+10', '#ffffff'], [-0.07, 0.045, '#c8161d', 'BW', '#ffffff'],
    [0.1, 0.061, '#ef7c18', 'PL', '#1a1208'], [0.084, 0.055, '#20307a', '+1', '#ffffff'], [0.07, 0.045, '#ef7c18', 'PC', '#1a1208'],
    [-0.081, -0.003, '#eceef0', 'OK', '#14161a'], [-0.077, -0.029, '#eceef0', 'BB−', '#14161a'],
    [0.081, -0.003, '#1f74e8', 'ACS', '#ffffff'], [0.077, -0.029, '#eceef0', 'BB+', '#14161a']
  ];
  // przyciski prostokątne: x, y, kolor, napis
  var TOGGLES = [[-0.083, 0.023, '#58bdf0', 'TALK'], [0.083, 0.023, '#58bdf0', 'PIT']];
  // pokrętła: x, y, napis, barwy skali
  var ROTARIES = [[-0.044, -0.046, 'STRAT', ['#ffd21a', '#ff9a18']], [0, -0.05, 'DIFF', ['#f2f2f2', '#e8343a', '#3a8cff']], [0.044, -0.046, 'ERS', ['#1fd1b0', '#7fe24a']]];
  var DISP = { x: 0, y: 0.014, w: 0.104, h: 0.064 };
  var FW = 1024, FH = Math.round(FW * (FY1 - FY0) / (2 * FX));
  function fpx(x) { return (x + FX) / (2 * FX) * FW; }
  function fpy(y) { return (FY1 - y) / (FY1 - FY0) * FH; }
  function fpr(r) { return r / (2 * FX) * FW; }

  // splot skośny 2/2 (włókno węglowe)
  function carbonWeave(g, w, h, cell, c0, c1) {
    for (var y = 0; y < h; y += cell) for (var x = 0; x < w; x += cell) {
      var k = ((x + y) / cell) % 4 < 2;
      var gr = k ? g.createLinearGradient(x, y, x + cell, y) : g.createLinearGradient(x, y, x, y + cell);
      gr.addColorStop(0, k ? c0[0] : c1[0]); gr.addColorStop(0.5, k ? c0[1] : c1[1]); gr.addColorStop(1, k ? c0[2] : c1[2]);
      g.fillStyle = gr; g.fillRect(x, y, cell, cell);
    }
  }
  function faceTexture() {
    var c = mkCanvas(FW, FH), g = c.getContext('2d');
    carbonWeave(g, FW, FH, 10, ['#25282d', '#33373d', '#202327'], ['#1b1d21', '#24272b', '#18191c']);
    // lakier bezbarwny: delikatny połysk u góry
    var gl = g.createLinearGradient(0, 0, 0, FH);
    gl.addColorStop(0, 'rgba(255,255,255,0.07)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = gl; g.fillRect(0, 0, FW, FH);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // pas diod nad wyświetlaczem i ramka wyświetlacza
    g.fillStyle = '#060708';
    g.beginPath(); g.moveTo(fpx(-0.053), fpy(0.064)); g.lineTo(fpx(0.053), fpy(0.064)); g.lineTo(fpx(0.053), fpy(0.052)); g.lineTo(fpx(-0.053), fpy(0.052)); g.fill();
    var dx0 = fpx(DISP.x - DISP.w / 2 - 0.004), dy0 = fpy(DISP.y + DISP.h / 2 + 0.004), dw = fpx(DISP.x + DISP.w / 2 + 0.004) - dx0, dh = fpy(DISP.y - DISP.h / 2 - 0.004) - dy0;
    g.fillStyle = '#0a0b0c'; g.beginPath();
    g.moveTo(dx0 + 14, dy0); g.arcTo(dx0 + dw, dy0, dx0 + dw, dy0 + dh, 14); g.arcTo(dx0 + dw, dy0 + dh, dx0, dy0 + dh, 14); g.arcTo(dx0, dy0 + dh, dx0, dy0, 14); g.arcTo(dx0, dy0, dx0 + dw, dy0, 14); g.fill();
    g.strokeStyle = 'rgba(200,210,220,0.22)'; g.lineWidth = 3; g.stroke();
    // gniazda diod flag po bokach wyświetlacza
    [-1, 1].forEach(function (s) {
      g.fillStyle = '#060708';
      g.fillRect(fpx(s * 0.0595) - fpr(0.0045), fpy(0.047), fpr(0.009), fpy(0.006) - fpy(0.047));
    });
    // opisy przycisków: mały napis obok
    g.font = '700 20px ' + FONT; g.fillStyle = 'rgba(225,230,236,0.8)';
    [['MIX', -0.07, 0.033], ['PRE', 0.07, 0.033], ['SL', -0.096, 0.012], ['ENG', 0.096, 0.012]].forEach(function (l) { g.fillText(l[0], fpx(l[1]), fpy(l[2])); });
    // obwódki przycisków
    BUTTONS.forEach(function (b) {
      g.fillStyle = '#0b0c0e'; g.beginPath(); g.arc(fpx(b[0]), fpy(b[1]), fpr(0.0078), 0, TAU); g.fill();
    });
    TOGGLES.forEach(function (b) {
      g.fillStyle = '#0b0c0e'; g.fillRect(fpx(b[0]) - fpr(0.0072), fpy(b[1]) - fpr(0.0105), fpr(0.0144), fpr(0.021));
      g.fillStyle = 'rgba(225,230,236,0.8)'; g.font = '700 17px ' + FONT; g.fillText(b[3], fpx(b[0]), fpy(b[1] - 0.0155));
    });
    // skale pokręteł: kolorowe łuki z kreskami i numerami pozycji, napis nad pokrętłem
    ROTARIES.forEach(function (r) {
      var cx = fpx(r[0]), cy = fpy(r[1]), R0 = fpr(0.0112), R1 = fpr(0.0155), n = 12, cols = r[3];
      for (var i = 0; i < n; i++) {
        var a0 = -PI * 0.78 + i / n * PI * 1.56 - PI / 2, a1 = a0 + PI * 1.56 / n * 0.82;
        g.strokeStyle = cols[i % cols.length]; g.lineWidth = R1 - R0;
        g.beginPath(); g.arc(cx, cy, (R0 + R1) / 2, a0, a1); g.stroke();
      }
      g.fillStyle = '#e9edf1'; g.font = '700 13px ' + FONT;
      for (var j = 0; j < n; j += 2) {
        var a = -PI * 0.78 + (j + 0.4) / n * PI * 1.56 - PI / 2;
        g.fillText(String(j + 1), cx + Math.cos(a) * (R1 + 10), cy + Math.sin(a) * (R1 + 10));
      }
      g.font = '800 20px ' + FONT; g.fillStyle = cols[0];
      g.fillText(r[2], cx, cy - R1 - 24);
    });
    // drobne napisy i śruby mocowania
    g.fillStyle = 'rgba(180,186,194,0.9)';
    [[-0.11, 0.07], [0.11, 0.07], [-0.062, -0.066], [0.062, -0.066]].forEach(function (p) { g.beginPath(); g.arc(fpx(p[0]), fpy(p[1]), 5, 0, TAU); g.fill(); });
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  // nasadka przycisku z napisem (okrągła powierzchnia walca)
  function capTexture(col, label, lcol) {
    var c = mkCanvas(64, 64), g = c.getContext('2d');
    var gr = g.createRadialGradient(26, 24, 4, 32, 32, 32);
    gr.addColorStop(0, col); gr.addColorStop(1, col);
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(26, 24, 14, 0, TAU); g.fill();
    g.fillStyle = lcol; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 ' + (label.length > 2 ? 22 : 30) + 'px ' + FONT; g.fillText(label, 32, 34);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // wyświetlacz: bieg, prędkość, okrążenie, czasy, DRS, akumulator, balans hamulców, zużycie opon
  var DW = 416, DH = 256;
  function fmtTime(t) {
    if (!(t > 0)) return '-:--.---';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  function drawDisplay(g, st) {
    g.fillStyle = '#030405'; g.fillRect(0, 0, DW, DH);
    g.textBaseline = 'middle';
    // górny pasek
    g.fillStyle = '#0e1217'; g.fillRect(0, 0, DW, 38);
    g.font = '700 27px ' + FONT; g.textAlign = 'left'; g.fillStyle = '#e8edf2'; g.fillText(st.lap, 10, 20);
    g.textAlign = 'right'; g.fillText(st.pos, DW - 10, 20);
    g.textAlign = 'center';
    g.fillStyle = st.drs === 2 ? '#2fd07a' : st.drs === 1 ? '#0d3a22' : '#161b22'; g.fillRect(DW / 2 - 44, 5, 88, 28);
    g.fillStyle = st.drs === 2 ? '#04140b' : st.drs === 1 ? '#2fd07a' : '#4f5966'; g.fillText('DRS', DW / 2, 20);
    // bieg w ramce
    g.strokeStyle = st.limiter ? '#4aa3ff' : '#2a313a'; g.lineWidth = 4; g.strokeRect(DW / 2 - 62, 50, 124, 136);
    g.font = '700 132px ' + FONT; g.fillStyle = st.limiter ? '#4aa3ff' : '#ffffff'; g.fillText(st.gear, DW / 2, 122);
    // prędkość i czasy po bokach
    g.textAlign = 'left'; g.font = '700 54px ' + FONT; g.fillStyle = '#ffffff'; g.fillText(st.speed, 12, 92);
    g.font = '600 19px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText('KM/H', 14, 128);
    g.textAlign = 'right'; g.font = '700 30px ' + FONT; g.fillStyle = st.deltaCol; g.fillText(st.delta, DW - 10, 86);
    g.font = '600 18px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText(st.timeLbl, DW - 10, 120);
    g.font = '700 25px ' + FONT; g.fillStyle = '#e8edf2'; g.fillText(st.time, DW - 10, 148);
    // dół: akumulator, balans hamulców, opony
    g.fillStyle = '#161b22'; g.fillRect(10, 200, 140, 16);
    g.fillStyle = '#ffd21a'; g.fillRect(10, 200, 140 * st.ers, 16);
    g.textAlign = 'left'; g.font = '700 19px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText('ERS', 10, 234);
    g.textAlign = 'center'; g.fillStyle = '#e8edf2'; g.fillText('BB ' + st.bb, DW / 2, 214);
    g.textAlign = 'right'; g.fillStyle = st.tyreCol; g.fillText(st.tyre, DW - 10, 208);
    g.fillStyle = '#8f9aa8'; g.fillText('OPONY', DW - 10, 234);
  }

  // ---------- wnętrze: tekstury ----------
  // panel z wytłoczeniami: ciemny kompozyt z regularną siatką wypukłych wgłębień (kolor + mapa normalnych)
  function dimpleTextures(N) {
    var cell = N / 16, c = mkCanvas(N, N), g = c.getContext('2d');
    carbonWeave(g, N, N, N / 64, ['#1c1e22', '#24272c', '#1a1c1f'], ['#16181b', '#1d1f23', '#141518']);
    var H = new Float32Array(N * N), x, y, r = cell * 0.36;
    for (var j = 0; j < 16; j++) for (var i = 0; i < 17; i++) {
      var cx = (i + (j % 2 ? 0.5 : 0)) * cell, cy = (j + 0.5) * cell;
      for (y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d < 1.15) {
          var xx = ((x % N) + N) % N, yy = ((y % N) + N) % N, h = d < 1 ? Math.cos(d * PI / 2) : 0;
          H[yy * N + xx] = Math.max(H[yy * N + xx], h);
        }
      }
    }
    // kolor: wypukłość jaśniejsza od góry-lewej strony, ciemniejsza od dołu-prawej
    var img = g.getImageData(0, 0, N, N), d0 = img.data, nc = mkCanvas(N, N), ng = nc.getContext('2d'), nimg = ng.createImageData(N, N), nd = nimg.data;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var k = y * N + x, hx = H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N], hy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
      var shade = clamp(1 + (-hx - hy) * 2.2 + H[k] * 0.35, 0.5, 2.2), o = k * 4;
      d0[o] = clamp(d0[o] * shade + H[k] * 26, 0, 255); d0[o + 1] = clamp(d0[o + 1] * shade + H[k] * 28, 0, 255); d0[o + 2] = clamp(d0[o + 2] * shade + H[k] * 32, 0, 255);
      var nx = -hx * 2.2, ny = hy * 2.2, l = Math.sqrt(nx * nx + ny * ny + 1);
      nd[o] = (nx / l * 0.5 + 0.5) * 255; nd[o + 1] = (ny / l * 0.5 + 0.5) * 255; nd[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); ng.putImageData(nimg, 0, 0);
    var t = new THREE.CanvasTexture(c), tn = new THREE.CanvasTexture(nc);
    t.colorSpace = THREE.SRGBColorSpace;
    [t, tn].forEach(function (tt) { tt.wrapS = tt.wrapT = THREE.RepeatWrapping; tt.anisotropy = 8; });
    return { map: t, normal: tn };
  }
  // tkanina poduszek: drobny szum
  function fabricTexture() {
    var N = 128, c = mkCanvas(N, N), g = c.getContext('2d'), R = rng(5);
    g.fillStyle = '#9c9fa4'; g.fillRect(0, 0, N, N);
    for (var k = 0; k < 2600; k++) { var v = R(); g.fillStyle = v < 0.5 ? 'rgba(60,62,66,0.18)' : 'rgba(230,232,236,0.16)'; g.fillRect(R() * N, R() * N, 1 + R() * 2, 1); }
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  // rękaw kombinezonu: barwa zespołu, pas w drugim kolorze wzdłuż ręki, fałdy materiału (jaśniejsze i ciemniejsze pasy)
  function sleeveTexture(base, stripe) {
    var W = 256, H = 256, c = mkCanvas(W, H), g = c.getContext('2d'), R = rng(17);
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.fillStyle = stripe; g.fillRect(W * 0.62, 0, W * 0.1, H);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(W * 0.3, H * 0.62, W * 0.12, H * 0.08);
    for (var k = 0; k < 26; k++) {
      var y = R() * H, a = 0.06 + R() * 0.12, w = 4 + R() * 10, ph = R() * 6;
      g.strokeStyle = (k % 2 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + a.toFixed(2) + ')'; g.lineWidth = w;
      g.beginPath();
      for (var x = 0; x <= W; x += 8) { var yy = y + Math.sin(x / W * TAU * 2 + ph) * 6; if (x) g.lineTo(x, yy); else g.moveTo(x, yy); }
      g.stroke();
    }
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // naklejki: trójkąt ostrzegawczy z błyskawicą (wysokie napięcie) i mapka toru
  function stickerTexture(kind) {
    var c = mkCanvas(128, 128), g = c.getContext('2d');
    if (kind === 'hv') {
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(64, 6); g.lineTo(124, 120); g.lineTo(4, 120); g.closePath(); g.fill();
      g.strokeStyle = '#1d3d8f'; g.lineWidth = 7; g.stroke();
      g.fillStyle = '#d81e1e'; g.beginPath();
      g.moveTo(70, 36); g.lineTo(44, 80); g.lineTo(62, 80); g.lineTo(50, 112); g.lineTo(86, 66); g.lineTo(68, 66); g.lineTo(80, 36); g.closePath(); g.fill();
    } else {
      g.fillStyle = '#f4f5f6'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#1b1d22'; g.lineWidth = 6; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(22, 96); g.lineTo(22, 34); g.quadraticCurveTo(22, 16, 40, 18); g.lineTo(58, 22); g.lineTo(66, 30); g.lineTo(98, 26);
      g.quadraticCurveTo(110, 26, 108, 40); g.lineTo(100, 74); g.quadraticCurveTo(96, 92, 80, 98); g.lineTo(50, 108); g.quadraticCurveTo(24, 114, 22, 96); g.stroke();
      g.fillStyle = '#d81e1e'; g.fillRect(16, 60, 12, 4);
      g.fillStyle = '#1b1d22'; g.font = '700 14px ' + FONT; g.textAlign = 'center'; g.fillText('5.793 km', 64, 70);
    }
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  // ---------- geometria pomocnicza ----------
  function tube(pts, r, seg) {
    var c = new THREE.CatmullRomCurve3(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
    return new THREE.TubeGeometry(c, seg || 10, r, 8, false);
  }
  function ellipsoid(sx, sy, sz, x, y, z, rz) {
    var g = new THREE.SphereGeometry(1, 16, 12);
    g.scale(sx, sy, sz);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    return g;
  }
  // walec między punktami a i b (promienie ra przy a, rb przy b)
  function rod(a, b, ra, rb, seg, open) {
    var A = new THREE.Vector3(a[0], a[1], a[2]), B2 = new THREE.Vector3(b[0], b[1], b[2]), d = B2.clone().sub(A), L = d.length();
    var g = new THREE.CylinderGeometry(rb, ra, L, seg || 12, 1, !!open);
    g.translate(0, L / 2, 0);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
    return g;
  }
  // obrys wanny kokpitu (krawędź) od lewego tyłu przez przód do prawego tyłu
  var RIM = [[0.32, 0.672, 0.236], [0.52, 0.665, 0.236], [0.72, 0.652, 0.218], [0.86, 0.643, 0.182], [0.94, 0.637, 0.12], [0.962, 0.634, 0.05]];
  var RIM_ALL = RIM.map(function (p) { return [p[0], p[1], -p[2]]; }).concat([[0.966, 0.634, 0]]).concat(RIM.slice().reverse());
  // wanna: ściany od krawędzi w dół (lekko zbiegające się ku podłodze), normalne do środka, UV w metrach / rozmiar kafla
  function tubGeometry(tile) {
    var curve = new THREE.CatmullRomCurve3(RIM_ALL.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }), false, 'centripetal');
    var n = 64, P = [], N = [], U = [], I = [], acc = 0, prev = null, yB = 0.34;
    for (var i = 0; i <= n; i++) {
      var p = curve.getPoint(i / n), tg = curve.getTangent(i / n);
      if (prev) acc += p.distanceTo(prev);
      prev = p;
      // normalna pozioma do środka kokpitu (punkt odniesienia: x = 0.6, z = 0)
      var nx = tg.z, nz = -tg.x, l = Math.sqrt(nx * nx + nz * nz) || 1; nx /= l; nz /= l;
      if ((0.6 - p.x) * nx + (0 - p.z) * nz < 0) { nx = -nx; nz = -nz; }
      var top = [p.x - nx * 0.004, p.y - 0.014, p.z - nz * 0.004], bot = [p.x + nx * 0.03, yB, p.z + nz * 0.03];
      P.push(top[0], top[1], top[2], bot[0], bot[1], bot[2]);
      N.push(nx, 0.12, nz, nx, 0.05, nz);
      U.push(acc / tile, (top[1] - yB) / tile, acc / tile, 0);
      if (i) { var k = i * 2; I.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    return g;
  }
  // owiewka: płytka z zębami na górnej krawędzi
  function deflectorShape() {
    var s = new THREE.Shape(), w = 0.105, h0 = 0.0, teeth = 4, hT = 0.03, hB = 0.016;
    s.moveTo(-w, h0); s.lineTo(w, h0); s.lineTo(w, hB);
    for (var i = teeth; i > 0; i--) {
      var x1 = -w + (i - 0.5) / teeth * 2 * w, x0 = -w + (i - 1) / teeth * 2 * w;
      s.lineTo(x1, hT); s.lineTo(x0, hB);
    }
    s.closePath();
    return s;
  }

  var Cockpit3D = PG.Cockpit3D = {};

  Cockpit3D.build = function (opts) {
    opts = opts || {};
    var lv = opts.livery || {}, hiQ = opts.quality !== 'low';
    var primary = lv.primary || '#d40f1a';
    var disp = [];
    function keep(o) { disp.push(o); return o; }
    function mat(o) { return keep(new THREE.MeshStandardMaterial(o)); }
    var dimple = dimpleTextures(hiQ ? 512 : 256);
    keep(dimple.map); keep(dimple.normal);
    var M = {
      carbon: mat({ color: 0x272a2f, roughness: 0.36, metalness: 0.3, side: THREE.DoubleSide }),
      face: mat({ map: keep(faceTexture()), roughness: 0.34, metalness: 0.2 }),
      rubber: mat({ color: 0x141517, roughness: 0.88, metalness: 0 }),
      metal: mat({ color: 0x6b7077, roughness: 0.35, metalness: 0.85 }),
      knob: mat({ color: 0x0e0f11, roughness: 0.5, metalness: 0.35 }),
      mark: mat({ color: 0xf2f2f2, roughness: 0.4, metalness: 0 }),
      roller: mat({ color: 0x4cb6ee, roughness: 0.45, metalness: 0.1 }),
      glove: mat({ color: 0x1b1d22, roughness: 0.8, metalness: 0 }),
      gloveAcc: mat({ color: new THREE.Color(primary).multiplyScalar(0.55), roughness: 0.7, metalness: 0 }),
      suit: mat({ map: keep(sleeveTexture('#' + new THREE.Color(primary).getHexString(), '#' + new THREE.Color(lv.secondary || '#1a1a1a').getHexString())), color: new THREE.Color(0.55, 0.55, 0.55), roughness: 1, metalness: 0 }),
      suede: mat({ color: 0x17181b, roughness: 1, metalness: 0 }),
      tub: mat({ map: dimple.map, normalMap: dimple.normal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.5, metalness: 0.18, side: THREE.DoubleSide }),
      pad: mat({ map: keep(fabricTexture()), roughness: 0.96, metalness: 0 }),
      foam: mat({ color: 0x2c2f35, roughness: 0.95, metalness: 0 }),
      plate: mat({ color: 0x15171a, roughness: 0.5, metalness: 0.3 }),
      glass: mat({ color: 0xd6e6f2, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide })
    };
    var root = new THREE.Group(); root.name = 'Cockpit3D'; root.visible = false;
    function add(geo, m, parent, cast) {
      var mesh = new THREE.Mesh(keep(geo), m);
      mesh.castShadow = !!cast; mesh.receiveShadow = hiQ;
      (parent || root).add(mesh);
      return mesh;
    }
    var i;

    // --- kierownica: grupa zorientowana (płaszczyzna koła), w niej obracana część ---
    var wheel = new THREE.Group(), spin = new THREE.Group();
    var X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(Math.sin(SW_TILT), Math.cos(SW_TILT), 0), Z = new THREE.Vector3(-Math.cos(SW_TILT), Math.sin(SW_TILT), 0);
    wheel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    wheel.position.set(SW_POS[0], SW_POS[1], SW_POS[2]);
    root.add(wheel); wheel.add(spin);
    // korpus: przód (z = FACE_Z) ma dokładnie obrys płyty czołowej, fazowane krawędzie z tyłu
    var bodyG = new THREE.ExtrudeGeometry(bodyShape(), { depth: 0.03 - 0.004, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0035, bevelSegments: 2, curveSegments: 10 });
    bodyG.translate(0, 0, FACE_Z - 0.03);
    add(bodyG, M.carbon, spin, true);
    // płyta czołowa z teksturą (UV z obrysu)
    var fgeo = new THREE.ShapeGeometry(bodyShape(), 10), fp = fgeo.attributes.position, fu = fgeo.attributes.uv;
    for (i = 0; i < fp.count; i++) fu.setXY(i, (fp.getX(i) + FX) / (2 * FX), (fp.getY(i) - FY0) / (FY1 - FY0));
    fgeo.translate(0, 0, FACE_Z + 0.0004);
    add(fgeo, M.face, spin);
    // uchwyty: gruba guma, zaokrąglone krawędzie; łopatki zmiany biegów i sprzęgła za korpusem
    [-1, 1].forEach(function (s) {
      var gg = new THREE.ExtrudeGeometry(gripShape(), { depth: 0.026, bevelEnabled: true, bevelThickness: 0.011, bevelSize: 0.009, bevelSegments: 4, curveSegments: 10 });
      gg.translate(0, 0, FACE_Z - 0.03);
      if (s < 0) { gg.scale(-1, 1, 1); gg.computeVertexNormals(); }
      add(gg, M.rubber, spin, true);
      var pg = new THREE.ExtrudeGeometry(roundRect(0.05, 0.07, 0.012), { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
      pg.translate(s * 0.1, 0.012, FACE_Z - 0.052);
      add(pg, M.carbon, spin);
      var cg = new THREE.ExtrudeGeometry(roundRect(0.04, 0.032, 0.01), { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
      cg.translate(s * 0.085, -0.045, FACE_Z - 0.05);
      add(cg, M.carbon, spin);
    });
    // wyświetlacz (żywa tekstura)
    var dc = mkCanvas(DW, DH), dg = dc.getContext('2d'), dtex = keep(new THREE.CanvasTexture(dc));
    dtex.colorSpace = THREE.SRGBColorSpace; dtex.anisotropy = 8;
    var dmat = keep(new THREE.MeshBasicMaterial({ map: dtex, color: new THREE.Color(1.2, 1.2, 1.2) }));
    var dplane = add(new THREE.PlaneGeometry(DISP.w, DISP.h), dmat, spin);
    dplane.position.set(DISP.x, DISP.y, FACE_Z + 0.0012);
    // szybka wyświetlacza (odbłysk)
    var dglass = add(new THREE.PlaneGeometry(DISP.w + 0.004, DISP.h + 0.004), mat({ color: 0x0a0c0f, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }), spin);
    dglass.position.set(DISP.x, DISP.y, FACE_Z + 0.0019);
    // diody obrotów (15 w rzędzie) i diody flag (po 3 z boków wyświetlacza)
    var ledG = keep(new THREE.CylinderGeometry(0.0024, 0.0024, 0.002, 12)); ledG.rotateX(PI / 2);
    var ledM = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    var leds = new THREE.InstancedMesh(ledG, ledM, 21), mtx = new THREE.Matrix4(), off = new THREE.Color(0.03, 0.03, 0.035);
    for (i = 0; i < 15; i++) { mtx.makeTranslation(-0.0476 + i * 0.0068, 0.058, FACE_Z + 0.0012); leds.setMatrixAt(i, mtx); leds.setColorAt(i, off); }
    for (i = 0; i < 6; i++) { var sd = i < 3 ? -1 : 1, kk = i % 3; mtx.makeTranslation(sd * 0.0595, 0.0425 - kk * 0.0078, FACE_Z + 0.0012); leds.setMatrixAt(15 + i, mtx); leds.setColorAt(15 + i, off); }
    leds.frustumCulled = false; spin.add(leds);
    // przyciski: walce z nasadkami z napisami
    var btnG = keep(new THREE.CylinderGeometry(0.0064, 0.0068, 0.0045, 20)); btnG.rotateX(PI / 2);
    BUTTONS.forEach(function (b) {
      var side = mat({ color: new THREE.Color(b[2]), roughness: 0.35, metalness: 0.05 });
      var top = mat({ map: keep(capTexture(b[2], b[3], b[4])), roughness: 0.3, metalness: 0.05 });
      var m = new THREE.Mesh(btnG, [side, top, side]);
      // podstawa walca z napisem jest zwrócona do kierowcy; obrót o 90°, by napis stał prosto
      m.position.set(b[0], b[1], FACE_Z + 0.0024); m.rotation.z = PI / 2; m.receiveShadow = hiQ;
      spin.add(m);
    });
    TOGGLES.forEach(function (b) {
      var tg = new THREE.ExtrudeGeometry(roundRect(0.0115, 0.017, 0.003), { depth: 0.003, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: 3 });
      var m = add(tg, mat({ color: new THREE.Color(b[2]), roughness: 0.4, metalness: 0.05 }), spin);
      m.position.set(b[0], b[1], FACE_Z + 0.0005);
    });
    // jasnoniebieskie rolki pod kciukami (u góry uchwytów)
    var rolG = keep(new THREE.CylinderGeometry(0.0072, 0.0072, 0.013, 18)); rolG.rotateZ(PI / 2);
    [-1, 1].forEach(function (s) {
      var m = add(rolG, M.roller, spin); m.position.set(s * 0.1035, 0.036, FACE_Z + 0.0035);
      var hub = add(new THREE.BoxGeometry(0.016, 0.019, 0.004), M.plate, spin); hub.position.set(s * 0.1035, 0.036, FACE_Z + 0.0005);
    });
    // pokrętła: radełkowane gałki ze znacznikiem
    var rotG = keep(new THREE.CylinderGeometry(0.0085, 0.0092, 0.011, 24)); rotG.rotateX(PI / 2);
    var markG = keep(new THREE.BoxGeometry(0.0016, 0.0068, 0.0012));
    ROTARIES.forEach(function (r, k) {
      var knob = add(rotG, M.knob, spin); knob.position.set(r[0], r[1], FACE_Z + 0.0055);
      var mk = add(markG, M.mark, knob); mk.position.set(0, 0.0038, 0.0056);
      knob.rotation.z = (k - 1) * 0.6 + 0.3;
    });
    // kolumna kierownicy i szybkozłączka (nieruchome)
    add(rod([0, 0, FACE_Z - 0.03], [0, 0, -0.22], 0.019, 0.016, 14), M.metal, wheel);
    add(rod([0, 0, FACE_Z - 0.03], [0, 0, FACE_Z - 0.058], 0.03, 0.028, 18), M.knob, wheel);

    // --- dłonie w rękawicach (obracają się z kierownicą) ---
    var wrists = [];
    [-1, 1].forEach(function (s) {
      var hand = new THREE.Group(); spin.add(hand);
      function P(x, y, z) { return [s * x, y, z]; }
      add(ellipsoid(0.03, 0.045, 0.017, s * 0.141, -0.014, 0.031, -s * 0.2), M.glove, hand, true);    // grzbiet dłoni na uchwycie
      add(ellipsoid(0.017, 0.008, 0.004, s * 0.139, 0.006, 0.045, -s * 0.2), M.gloveAcc, hand);        // ochraniacz kostek
      add(ellipsoid(0.024, 0.04, 0.014, s * 0.123, -0.016, 0.028, -s * 0.12), M.glove, hand, true);  // kostki
      // kciuk oparty przy rolce
      add(tube([P(0.126, 0.008, 0.036), P(0.118, 0.022, 0.031), P(0.109, 0.031, 0.025)], 0.0078, 8), M.glove, hand, true);
      add(ellipsoid(0.0082, 0.0082, 0.0082, s * 0.109, 0.031, 0.025), M.glove, hand);
      // palce owinięte wokół wewnętrznej krawędzi uchwytu
      [0.0, -0.019, -0.038, -0.056].forEach(function (y, fi) {
        var xo = 0.112 + (0.004 - y) * 0.12, r = fi === 3 ? 0.0068 : 0.0078;
        add(tube([P(xo + 0.019, y, 0.027), P(xo + 0.004, y, 0.019), P(xo - 0.002, y + 0.002, -0.004), P(xo + 0.008, y + 0.003, -0.021)], r, 8), M.glove, hand, true);
      });
      // mankiet rękawicy
      add(rod(P(0.15, -0.046, 0.036), P(0.168, -0.094, 0.09), 0.029, 0.033, 14, true), M.glove, hand, true);
      add(rod(P(0.166, -0.09, 0.085), P(0.17, -0.1, 0.098), 0.0335, 0.0345, 14, true), M.gloveAcc, hand);
      wrists.push({ s: s, local: new THREE.Vector3(s * 0.17, -0.1, 0.098) });
    });
    // ręce w kombinezonie: bark nieruchomo w bolidzie, łokieć z prostego IK (dwa odcinki, łokieć odchylony w dół
    // i na zewnątrz), przedramię zwęża się ku dłoni; przedramię wchodzi w kadr od dolnych rogów
    var foreG = keep(new THREE.CylinderGeometry(0.032, 0.041, 1, 20, 4, true)); foreG.translate(0, 0.5, 0);
    var upG = keep(new THREE.CylinderGeometry(0.046, 0.052, 1, 16, 1, true)); upG.translate(0, 0.5, 0);
    var elbG = keep(new THREE.SphereGeometry(0.047, 16, 12));
    var arms = wrists.map(function (w) {
      return {
        fore: add(foreG, M.suit, root, true), upper: add(upG, M.suit, root, true), joint: add(elbG, M.suit, root, true), w: w,
        shoulder: new THREE.Vector3(0.27, 0.47, w.s * 0.19), pole: new THREE.Vector3(-0.2, -1, w.s * 0.75).normalize(), a: 0.29, b: 0.28,
        elbow: new THREE.Vector3()
      };
    });

    // --- wanna kokpitu, poduszki, owiewka, panel przełączników, naklejki ---
    add(tubGeometry(0.3), M.tub, root);
    add(tube(RIM_ALL, 0.017, 48), M.suede, root);
    // poduszka przed kolanami (jasnoszara, za kierownicą, pod przednią krawędzią kokpitu)
    var padG = new THREE.ExtrudeGeometry(roundRect(0.205, 0.12, 0.03), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 3, curveSegments: 6 });
    padG.rotateY(PI / 2); padG.translate(0.87, 0.565, 0);
    var pm = add(padG, M.pad, root); pm.castShadow = false;
    // uv poduszki: rzut z boku (tkanina bez rozciągnięć)
    (function () { var pp = padG.attributes.position, uu = padG.attributes.uv; for (var j = 0; j < pp.count; j++) uu.setXY(j, pp.getZ(j) * 8 + pp.getX(j) * 4, pp.getY(j) * 8); })();
    // owiewka z zębami na przedniej krawędzi kokpitu
    var defG = new THREE.ShapeGeometry(deflectorShape());
    defG.rotateY(-PI / 2); defG.rotateZ(0.32); defG.translate(0.958, 0.63, 0);
    var dm = add(defG, M.glass, root); dm.renderOrder = 2; dm.castShadow = false; dm.receiveShadow = false;
    // ramka owiewki
    add(rod([0.958, 0.632, -0.105], [0.958, 0.632, 0.105], 0.004, 0.004, 6), M.plate, root);
    // panel przełączników na lewej ścianie: dwa czerwone i zielony
    var plate = add(new THREE.BoxGeometry(0.075, 0.03, 0.008), M.plate, root);
    plate.position.set(0.62, 0.565, -0.212); plate.rotation.y = 0.05;
    var swG = keep(new THREE.CylinderGeometry(0.0055, 0.006, 0.008, 16)); swG.rotateX(PI / 2);
    [['#d4141c', -0.022], ['#d4141c', 0], ['#21b14a', 0.022]].forEach(function (b) {
      var m = add(swG, mat({ color: new THREE.Color(b[0]), roughness: 0.35, metalness: 0.05, emissive: new THREE.Color(b[0]), emissiveIntensity: 0.15 }), plate);
      m.position.set(b[1], 0, 0.007);
    });
    // naklejki na lewej ścianie (trójkąt wysokiego napięcia i mapka toru)
    [['hv', 0.78, 0.585, 0.05], ['map', 0.7, 0.6, 0.04]].forEach(function (st) {
      var sm = new THREE.MeshStandardMaterial({ map: keep(stickerTexture(st[0])), roughness: 0.5, metalness: 0, transparent: st[0] === 'hv', alphaTest: st[0] === 'hv' ? 0.1 : 0 });
      keep(sm);
      var zx = st[1] < 0.72 ? -0.2165 : -0.2;
      var sg = add(new THREE.PlaneGeometry(st[3], st[3]), sm, root);
      sg.position.set(st[1], st[2], zx + 0.004);
      sg.lookAt(st[1], st[2], 0); // przodem do środka kokpitu
    });
    // boczne poduszki przy biodrach
    [-1, 1].forEach(function (s) {
      var pad = new THREE.ExtrudeGeometry(roundRect(0.34, 0.12, 0.04), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
      pad.translate(0.36, 0.585, s > 0 ? 0.185 : -0.22);
      add(pad, M.foam, root);
    });

    return {
      root: root, wheel: wheel, spin: spin, leds: leds, dctx: dg, dtex: dtex, arms: arms, disp: disp,
      steer: 0, ers: 0.62, dispT: 0, ledKey: '', last: '', blink: 0,
      tmpA: new THREE.Vector3(), tmpB: new THREE.Vector3(), tmpC: new THREE.Vector3(), tmpD: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion()
    };
  };

  Cockpit3D.setVisible = function (o, on) { if (o && o.root) o.root.visible = !!on; };

  var LED_ON = [new THREE.Color(0.25, 3.2, 0.6), new THREE.Color(3.2, 0.25, 0.18), new THREE.Color(1.6, 0.5, 3.4)];
  var LED_OFF = new THREE.Color(0.03, 0.03, 0.035), LED_LIM = new THREE.Color(0.55, 1.2, 3.4);
  var FLAG_Y = new THREE.Color(3.2, 2.4, 0.2), FLAG_B = new THREE.Color(0.4, 1.0, 3.4);

  // walec jednostkowy (oś y, 0..1) rozciągnięty od p do q
  function seg(mesh, p, q, o) {
    var d = o.tmpD.copy(q).sub(p), L = d.length();
    mesh.position.copy(p);
    mesh.quaternion.setFromUnitVectors(o.up, d.multiplyScalar(1 / (L || 1)));
    mesh.scale.set(1, L, 1);
  }

  Cockpit3D.update = function (o, car, S, dt) {
    if (!o || !o.root || !o.root.visible || !car) return;
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    // skręt kierownicy (zgodnie z ruchem wskazówek zegara w prawo)
    var tgt = clamp(num(car.steer, 0), -1, 1);
    o.steer += (tgt - o.steer) * (dt > 0 ? Math.min(1, dt * 16) : 1);
    o.spin.rotation.z = -o.steer * MAX_ANG;
    o.spin.updateMatrix(); o.wheel.updateMatrix();
    // ręce: łokieć z IK dwóch odcinków (bark → łokieć → nadgarstek), odcinki jako skalowane walce
    for (var a = 0; a < o.arms.length; a++) {
      var A = o.arms[a], w = o.tmpA.copy(A.w.local).applyMatrix4(o.spin.matrix).applyMatrix4(o.wheel.matrix);
      var u = o.tmpB.copy(w).sub(A.shoulder), d = u.length();
      d = clamp(d, Math.abs(A.a - A.b) + 0.01, A.a + A.b - 0.002); u.normalize();
      var x = (A.a * A.a - A.b * A.b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.a * A.a - x * x));
      var pp = o.tmpC.copy(A.pole).addScaledVector(u, -A.pole.dot(u)).normalize();
      A.elbow.copy(A.shoulder).addScaledVector(u, x).addScaledVector(pp, h);
      seg(A.upper, A.shoulder, A.elbow, o);
      seg(A.fore, A.elbow, w, o);
      A.joint.position.copy(A.elbow);
    }
    // akumulator: ładuje się przy hamowaniu, rozładowuje przy pełnym gazie
    var v = Math.abs(num(car.v, 0)), thr = clamp(num(car.throttle, 0), 0, 1), brk = clamp(num(car.brake, 0), 0, 1);
    o.ers = clamp(o.ers + dt * (brk * 0.22 * Math.min(1, v / 20) - (thr > 0.9 && v > 30 ? 0.035 : 0) + 0.004), 0, 1);
    // diody zmiany biegu: od 15 000 do 18 800 obr./min, migające na ograniczniku; diody flag: żółte przy
    // żółtej fladze / samochodzie bezpieczeństwa, niebieskie przy otwartym DRS
    var rpm = num(car.rpm, 4500), lit = Math.round(clamp((rpm - 15000) / 3800, 0, 1) * 15), lim = !!car.limiter || rpm >= 18900;
    var rcm = S && S.rc ? S.rc.mode : 'green', flag = rcm && rcm !== 'green' ? 1 : car.drsOpen ? 2 : 0;
    o.blink += dt;
    var ph = lim ? (Math.floor(o.blink * 10) % 2) : 0, fph = flag ? Math.floor(o.blink * 3) % 2 : 0, key = (lim ? 'L' + ph : 'n' + lit) + '|' + flag + fph;
    if (key !== o.ledKey) {
      o.ledKey = key;
      for (var i = 0; i < 15; i++) o.leds.setColorAt(i, lim ? (ph ? LED_LIM : LED_OFF) : i < lit ? LED_ON[(i / 5) | 0] : LED_OFF);
      for (i = 15; i < 21; i++) o.leds.setColorAt(i, flag === 1 ? (fph ? FLAG_Y : LED_OFF) : flag === 2 ? FLAG_B : LED_OFF);
      o.leds.instanceColor.needsUpdate = true;
    }
    // wyświetlacz: najwyżej 12 razy na sekundę i tylko po zmianie treści
    o.dispT -= dt;
    if (o.dispT > 0 && o.last) return;
    o.dispT = 1 / 12;
    var gear = num(car.gear, 0) | 0, rev = num(car.v, 0) < -0.5;
    var kmh = Math.round(v * 3.6), lap = Math.max(1, (num(car.lap, 0) | 0) + 1), laps = S && S.laps ? S.laps : 0;
    var tNow = S && car.lapStart !== undefined && car.started ? Math.max(0, num(S.time, 0) - num(car.lapStart, 0)) : 0;
    var best = num(car.bestLap, 0), last = num(car.lastLap, 0), wear = clamp(1 - num(car.wear, 0), 0, 1);
    var delta = best > 0 && last > 0 ? last - best : 0;
    var st = {
      lap: laps ? 'OKR ' + Math.min(lap, laps) + '/' + laps : 'OKR ' + lap,
      pos: car.pos ? 'P' + car.pos : '',
      drs: car.drsOpen ? 2 : car.drsAllowed ? 1 : 0,
      gear: rev ? 'R' : gear > 0 ? String(gear) : 'N', limiter: lim,
      speed: String(kmh),
      delta: best > 0 && last > 0 ? (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(3) : '+0.000', deltaCol: delta > 0.0005 ? '#ff5a4f' : '#2fd07a',
      timeLbl: last > 0 ? 'OST ' + fmtTime(last) : 'CZAS', time: fmtTime(tNow),
      ers: o.ers, bb: (56 + 1.5 * Math.min(1, brk)).toFixed(1),
      tyre: Math.round(wear * 100) + '%', tyreCol: wear > 0.6 ? '#2fd07a' : wear > 0.35 ? '#ffd21a' : '#ff5a4f'
    };
    var sig = st.lap + st.pos + st.drs + st.gear + st.limiter + st.speed + st.delta + st.time + Math.round(st.ers * 60) + st.bb + st.tyre;
    if (sig === o.last) return;
    o.last = sig;
    drawDisplay(o.dctx, st);
    o.dtex.needsUpdate = true;
  };

  Cockpit3D.dispose = function (o) {
    if (!o) return;
    if (o.root && o.root.parent) o.root.parent.remove(o.root);
    (o.disp || []).forEach(function (d) { try { if (d && d.dispose) d.dispose(); } catch (e) { /* nic */ } });
    o.disp = [];
  };
})(PG);
