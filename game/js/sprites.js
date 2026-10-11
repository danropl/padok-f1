// Monza Grand Prix — grafika wektorowa w wysokiej rozdzielczości: bolid F1 z malowaniem, kask, flagi.
(function (PG) {
  'use strict';

  function hex(c) { var n = parseInt(String(c).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function shade(c, f) { var r = hex(c); return toHex(f > 0 ? r.map(function (v) { return v + (255 - v) * f; }) : r.map(function (v) { return v * (1 + f); })); }
  function lum(c) { var r = hex(c); return (0.299 * r[0] + 0.587 * r[1] + 0.114 * r[2]) / 255; }
  PG.shade = shade; PG.hex = hex; PG.lum = lum;

  // Siatka malowania ręcznego: 40 x 16 pól na prostokącie bolidu (5,8 x 2,1 m)
  PG.PAINT_W = 40; PG.PAINT_H = 16;
  var BX0 = -2.9, BX1 = 2.9, BY0 = -1.05, BY1 = 1.05;
  PG.CAR_BOX = { x0: BX0, x1: BX1, y0: BY0, y1: BY1 };

  function poly(g, pts, mirror) {
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (mirror) for (var j = pts.length - 1; j >= 0; j--) g.lineTo(pts[j][0], -pts[j][1]);
    g.closePath();
  }

  // Kształty nadwozia (metry, przód w stronę +x)
  var POD = [[0.58, 0.36], [0.58, 0.73], [0.42, 0.78], [0.0, 0.79], [-0.5, 0.74], [-0.95, 0.6], [-1.35, 0.44], [-1.62, 0.31], [-1.62, 0.2], [-0.2, 0.2]];

  function bodyPath(g) {
    g.beginPath();
    // jedna obwiednia: nos + kokpit + pokrywa
    var top = [[-2.18, 0], [-2.12, 0.1], [-1.85, 0.14], [-1.3, 0.2], [-0.6, 0.27], [-0.15, 0.34], [0.5, 0.33], [0.9, 0.27], [1.2, 0.22], [1.7, 0.17], [2.2, 0.13], [2.5, 0.1], [2.62, 0.06], [2.66, 0]];
    poly(g, top, true);
    // boczne sekcje
    podPath(g, 1); podPath(g, -1);
  }
  function podPath(g, s) {
    g.moveTo(POD[0][0], POD[0][1] * s);
    for (var i = 1; i < POD.length; i++) g.lineTo(POD[i][0], POD[i][1] * s);
    g.closePath();
  }
  function wingsPath(g) {
    g.rect(2.3, -0.98, 0.44, 1.96);   // przednie skrzydło
    g.rect(-2.84, -0.56, 0.36, 1.12); // tylne skrzydło
  }

  function roundRect(g, x, y, w, h, r) {
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }

  function tyre(g, x, y, w, h, comp) {
    g.fillStyle = '#121214'; g.beginPath(); roundRect(g, x, y, w, h, 0.08); g.fill();
    var gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(255,255,255,0.02)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.13)'); gr.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.fillStyle = gr; g.beginPath(); roundRect(g, x + 0.04, y + 0.03, w - 0.08, h - 0.06, 0.06); g.fill();
    if (comp) { g.fillStyle = comp; g.fillRect(x + 0.08, y + (y > 0 ? h - 0.05 : 0.01), w - 0.16, 0.04); }
  }

  function patternLayer(g, lv) {
    var p = lv.pattern;
    g.fillStyle = lv.accent;
    switch (p) {
      case 'stripe': g.fillRect(-2.3, -0.08, 5, 0.16); break;
      case 'twin': g.fillRect(-2.3, 0.11, 5, 0.08); g.fillRect(-2.3, -0.19, 5, 0.08); break;
      case 'chevron':
        g.fillStyle = lv.secondary; g.beginPath(); g.moveTo(0.55, 0); g.lineTo(-0.35, 0.9); g.lineTo(3, 0.9); g.lineTo(3, -0.9); g.lineTo(-0.35, -0.9); g.closePath(); g.fill();
        g.fillStyle = lv.accent; g.beginPath(); g.moveTo(0.55, 0); g.lineTo(-0.35, 0.9); g.lineTo(-0.6, 0.9); g.lineTo(0.3, 0); g.lineTo(-0.6, -0.9); g.lineTo(-0.35, -0.9); g.closePath(); g.fill();
        break;
      case 'split': g.fillStyle = lv.secondary; g.fillRect(0.35, -1, 3, 2); g.fillStyle = lv.accent; g.fillRect(0.28, -1, 0.07, 2); break;
      case 'pods': g.beginPath(); podPath(g, 1); podPath(g, -1); g.fill(); break;
      case 'tail': g.fillRect(-2.4, -1, 1.35, 2); break;
      case 'checker':
        g.fillStyle = lv.secondary;
        for (var cx = -2.2; cx < -0.4; cx += 0.18) for (var cy = -0.9; cy < 0.9; cy += 0.18) if ((Math.round(cx / 0.18) + Math.round(cy / 0.18)) % 2 === 0) g.fillRect(cx, cy, 0.18, 0.18);
        break;
      case 'fade':
        var gr = g.createLinearGradient(-2.2, 0, 0.6, 0); gr.addColorStop(0, lv.secondary); gr.addColorStop(0.55, lv.secondary); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(-2.4, -1, 3.2, 2);
        g.fillStyle = lv.accent; g.fillRect(-1.6, 0.24, 1.8, 0.05); g.fillRect(-1.6, -0.29, 1.8, 0.05);
        break;
    }
  }

  function paintLayer(g, lv) {
    var paint = lv.paint2 || {}, cw = (BX1 - BX0) / PG.PAINT_W, ch = (BY1 - BY0) / PG.PAINT_H;
    Object.keys(paint).forEach(function (k) {
      var a = k.split(','), x = +a[0], y = +a[1];
      g.fillStyle = paint[k]; g.fillRect(BX0 + x * cw - 0.002, BY0 + y * ch - 0.002, cw + 0.004, ch + 0.004);
    });
  }

  // Warstwy malowania (kolor główny + wzór + malowanie ręczne) w metrach, środek (0,0), przód w +x.
  // Używane przez teksturę bolidu 3D (rzut z góry, prostokąt PG.CAR_BOX).
  PG.liveryLayers = function (g, lv) {
    g.fillStyle = lv.primary; g.fillRect(BX0 - 0.2, BY0 - 0.2, BX1 - BX0 + 0.4, BY1 - BY0 + 0.4);
    patternLayer(g, lv);
    paintLayer(g, lv);
  };

  // Rysuje bolid w metrach, środek w (0,0), przód w +x
  PG.drawCarShape = function (g, lv, helmet, opts) {
    opts = opts || {};
    var dark = '#18191c', carbon = '#222327';
    // podłoga
    g.fillStyle = '#101113';
    g.beginPath(); poly(g, [[-2.1, 0.8], [-1.0, 0.86], [0.7, 0.86], [1.18, 0.66], [1.25, 0.3]], true); g.fill();
    g.strokeStyle = '#2b2d31'; g.lineWidth = 0.025; g.stroke();
    // zawieszenie
    g.strokeStyle = '#0c0c0e'; g.lineWidth = 0.055; g.lineCap = 'round';
    g.beginPath();
    [1, -1].forEach(function (s) {
      g.moveTo(0.95, 0.18 * s); g.lineTo(1.6, 0.74 * s); g.moveTo(1.35, 0.14 * s); g.lineTo(1.62, 0.74 * s);
      g.moveTo(-1.35, 0.25 * s); g.lineTo(-1.85, 0.72 * s); g.moveTo(-1.7, 0.18 * s); g.lineTo(-1.88, 0.72 * s);
    });
    g.stroke();
    // opony
    tyre(g, -2.3, 0.56, 0.84, 0.45, opts.compound); tyre(g, -2.3, -1.01, 0.84, 0.45, opts.compound);
    tyre(g, 1.24, 0.62, 0.72, 0.36, opts.compound); tyre(g, 1.24, -0.98, 0.72, 0.36, opts.compound);
    // nadwozie w kolorze głównym
    g.save();
    g.beginPath(); bodyPath(g); g.clip();
    g.fillStyle = lv.primary; g.fillRect(-3, -1.2, 6, 2.4);
    patternLayer(g, lv);
    paintLayer(g, lv);
    // cieniowanie 3D
    var sh = g.createLinearGradient(0, -0.8, 0, 0.8);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)'); sh.addColorStop(0.32, 'rgba(0,0,0,0.05)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    sh.addColorStop(0.68, 'rgba(0,0,0,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = sh; g.fillRect(-3, -1.2, 6, 2.4);
    g.restore();
    // krawędzie nadwozia
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.03; g.beginPath(); bodyPath(g); g.stroke();
    // wloty boczne
    g.fillStyle = '#060607';
    g.beginPath(); roundRect(g, 0.47, 0.4, 0.1, 0.32, 0.03); g.fill();
    g.beginPath(); roundRect(g, 0.47, -0.72, 0.1, 0.32, 0.03); g.fill();
    // grzbiet i płetwa
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.035;
    g.beginPath(); g.moveTo(-0.1, 0); g.lineTo(-2.05, 0); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 0.02;
    g.beginPath(); g.moveTo(2.55, 0); g.lineTo(1.0, 0); g.stroke();
    // wlot airboxa
    g.fillStyle = '#08080a'; g.beginPath(); roundRect(g, -0.08, -0.11, 0.18, 0.22, 0.05); g.fill();
    // kokpit
    g.fillStyle = '#0b0b0d'; g.beginPath(); g.ellipse(0.5, 0, 0.42, 0.21, 0, 0, Math.PI * 2); g.fill();
    // kask
    var hm = helmet || { c1: '#f2f2f2', c2: '#d22', pattern: 'plain' };
    g.fillStyle = hm.c1; g.beginPath(); g.arc(0.42, 0, 0.145, 0, Math.PI * 2); g.fill();
    if (hm.pattern && hm.pattern !== 'plain') {
      g.save(); g.beginPath(); g.arc(0.42, 0, 0.145, 0, Math.PI * 2); g.clip(); g.fillStyle = hm.c2;
      if (hm.pattern === 'halves') g.fillRect(0.2, 0, 0.5, 0.3);
      else if (hm.pattern === 'top') g.fillRect(0.2, -0.05, 0.5, 0.1);
      else if (hm.pattern === 'band') g.fillRect(0.3, -0.3, 0.06, 0.6);
      else if (hm.pattern === 'star') { g.beginPath(); g.arc(0.38, 0, 0.06, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(0.39, -0.05, 0.05, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1d2533'; g.fillRect(0.52, -0.09, 0.05, 0.18);
    // halo
    g.strokeStyle = '#1a1b1e'; g.lineWidth = 0.075; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0.98, 0); g.quadraticCurveTo(0.85, 0.25, 0.5, 0.26); g.lineTo(0.05, 0.25);
    g.moveTo(0.98, 0); g.quadraticCurveTo(0.85, -0.25, 0.5, -0.26); g.lineTo(0.05, -0.25); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.02; g.beginPath(); g.moveTo(0.95, -0.02); g.quadraticCurveTo(0.84, -0.22, 0.5, -0.23); g.stroke();
    // lusterka
    g.fillStyle = carbon;
    [1, -1].forEach(function (s) { g.beginPath(); g.ellipse(0.66, 0.5 * s, 0.07, 0.11, 0, 0, Math.PI * 2); g.fill(); g.fillRect(0.64, 0.3 * s - (s < 0 ? 0.2 : 0), 0.03, 0.2); });
    // przednie skrzydło: płat główny, klapy, płyty boczne
    g.fillStyle = lv.secondary; g.beginPath(); poly(g, [[2.5, 0.97], [2.72, 0.97], [2.8, 0.32], [2.8, 0]], true); g.lineTo(2.58, 0); g.closePath(); g.fill();
    g.beginPath(); poly(g, [[2.5, 0.97], [2.72, 0.97], [2.8, 0.32], [2.8, 0], [2.58, 0], [2.58, 0.3]], true); g.fill();
    g.fillStyle = lv.primary;
    [1, -1].forEach(function (s2) { g.beginPath(); g.moveTo(2.3, 0.97 * s2); g.lineTo(2.47, 0.97 * s2); g.lineTo(2.56, 0.3 * s2); g.lineTo(2.44, 0.28 * s2); g.closePath(); g.fill(); });
    g.fillStyle = shade(lv.primary, -0.3);
    [1, -1].forEach(function (s2) { g.beginPath(); g.moveTo(2.47, 0.97 * s2); g.lineTo(2.5, 0.97 * s2); g.lineTo(2.58, 0.3 * s2); g.lineTo(2.56, 0.3 * s2); g.closePath(); g.fill(); });
    g.fillStyle = lv.accent; g.fillRect(2.26, 0.93, 0.5, 0.07); g.fillRect(2.26, -1.0, 0.5, 0.07);
    // tylne skrzydło
    g.fillStyle = lv.secondary; g.fillRect(-2.84, -0.54, 0.2, 1.08);
    if (opts.drs) { g.fillStyle = '#050506'; g.fillRect(-2.64, -0.54, 0.06, 1.08); g.fillStyle = shade(lv.secondary, 0.25); g.fillRect(-2.58, -0.54, 0.06, 1.08); }
    else { g.fillStyle = shade(lv.secondary, 0.18); g.fillRect(-2.64, -0.54, 0.13, 1.08); }
    g.fillStyle = lv.accent; g.fillRect(-2.9, 0.52, 0.48, 0.06); g.fillRect(-2.9, -0.58, 0.48, 0.06);
    // światło deszczowe
    g.fillStyle = opts.rainLight ? '#ff2b2b' : '#5a1212'; g.fillRect(-2.94, -0.05, 0.08, 0.1);
    // malowanie ręczne na skrzydłach
    var paint = lv.paint2 || {};
    if (Object.keys(paint).length) { g.save(); g.beginPath(); wingsPath(g); g.clip(); paintLayer(g, lv); g.restore(); }
  };

  // Tekstura bolidu w wysokiej rozdzielczości (piksele na metr)
  var TEX = 30;
  PG.CAR_TEX = TEX;
  PG.carTexture = function (lv, helmet, opts) {
    var c = document.createElement('canvas');
    c.width = Math.ceil((BX1 - BX0 + 0.2) * TEX); c.height = Math.ceil((BY1 - BY0 + 0.2) * TEX);
    var g = c.getContext('2d');
    g.translate(c.width / 2, c.height / 2); g.scale(TEX, TEX);
    PG.drawCarShape(g, lv, helmet, opts);
    return c;
  };
  // Cień: rozmyta sylwetka
  PG.carShadow = function () {
    if (PG._shadow) return PG._shadow;
    var c = document.createElement('canvas'); c.width = 6.6 * 20; c.height = 2.9 * 20;
    var g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.scale(20, 20);
    g.filter = 'blur(4px)';
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); roundRect(g, -2.85, -1.0, 5.6, 2.0, 0.5); g.fill();
    PG._shadow = c; return c;
  };

  PG.carCanvas = function (lv, helmet, scale) { return PG.carTexture(lv, helmet, { compound: null }); };

  // Maska pól siatki, które leżą na nadwoziu lub skrzydłach (do edytora malowania)
  PG.paintMask = function () {
    if (PG._pmask) return PG._pmask;
    var c = document.createElement('canvas'); c.width = c.height = 4;
    var g = c.getContext('2d'), m = new Uint8Array(PG.PAINT_W * PG.PAINT_H);
    var cw = (BX1 - BX0) / PG.PAINT_W, ch = (BY1 - BY0) / PG.PAINT_H;
    for (var y = 0; y < PG.PAINT_H; y++) for (var x = 0; x < PG.PAINT_W; x++) {
      var hit = 0;
      for (var a = 0.2; a < 1 && !hit; a += 0.3) for (var b = 0.2; b < 1 && !hit; b += 0.3) {
        var px = BX0 + (x + a) * cw, py = BY0 + (y + b) * ch;
        g.beginPath(); bodyPath(g); if (g.isPointInPath(px, py, 'nonzero')) hit = 1;
        g.beginPath(); wingsPath(g); if (g.isPointInPath(px, py)) hit = 1;
      }
      m[y * PG.PAINT_W + x] = hit;
    }
    PG._pmask = m; return m;
  };

  // Kask w wysokiej rozdzielczości
  PG.drawHelmet = function (canvas, hm, size) {
    var S = (size || 3) * 16, dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = S * dpr; canvas.height = S * dpr; canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
    var g = canvas.getContext('2d'); g.setTransform(dpr * S / 100, 0, 0, dpr * S / 100, 0, 0);
    g.clearRect(0, 0, 100, 100);
    // skorupa
    g.beginPath(); g.moveTo(14, 70); g.bezierCurveTo(8, 30, 35, 8, 58, 10); g.bezierCurveTo(84, 12, 94, 36, 92, 58); g.lineTo(90, 78); g.bezierCurveTo(70, 90, 34, 90, 14, 70); g.closePath();
    g.fillStyle = hm.c1; g.fill();
    g.save(); g.clip();
    g.fillStyle = hm.c2;
    switch (hm.pattern) {
      case 'band': g.fillRect(0, 62, 100, 10); break;
      case 'top': g.fillRect(40, 0, 18, 46); break;
      case 'halves': g.fillRect(53, 0, 50, 100); break;
      case 'star':
        g.beginPath(); for (var i = 0; i < 10; i++) { var r = i % 2 ? 7 : 16, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); } g.closePath(); g.fill(); break;
    }
    var gl = g.createLinearGradient(0, 10, 0, 90); gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gl; g.fillRect(0, 0, 100, 100);
    g.restore();
    g.lineWidth = 3; g.strokeStyle = '#0b0d10'; g.stroke();
    // wizjer
    g.beginPath(); g.moveTo(30, 44); g.bezierCurveTo(46, 36, 80, 36, 92, 44); g.lineTo(91, 60); g.bezierCurveTo(76, 56, 48, 56, 34, 62); g.closePath();
    var vg = g.createLinearGradient(0, 38, 0, 62); vg.addColorStop(0, '#5a8fd6'); vg.addColorStop(0.45, '#1b2b48'); vg.addColorStop(1, '#0c1322');
    g.fillStyle = vg; g.fill(); g.lineWidth = 2.5; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(52, 41, 22, 3);
  };

  // Flaga
  PG.drawFlag = function (canvas, code, scale) {
    var n = PG.NATIONS[code] || PG.NATIONS.PL, f = n.flag;
    var W = 12 * (scale || 2), H = 8 * (scale || 2), dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var g = canvas.getContext('2d'); g.setTransform(W * dpr / 12, 0, 0, H * dpr / 8, 0, 0);
    function r(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
    var t = f[0];
    if (t === 'h') { var k = f.length - 1; for (var i = 0; i < k; i++) r(0, i * 8 / k, 12, 8 / k + 0.02, f[i + 1]); }
    else if (t === 'v') { var k2 = f.length - 1; for (var j = 0; j < k2; j++) r(j * 12 / k2, 0, 12 / k2 + 0.02, 8, f[j + 1]); }
    else if (t === 'dot') { r(0, 0, 12, 8, f[1]); g.fillStyle = f[2]; g.beginPath(); g.arc(6, 4, 2.2, 0, Math.PI * 2); g.fill(); }
    else if (t === 'vdot') { r(0, 0, 12, 8, f[2]); r(0, 0, 3, 8, f[1]); r(9, 0, 3, 8, f[1]); g.fillStyle = f[1]; g.beginPath(); g.moveTo(6, 1.8); g.lineTo(7.6, 5.4); g.lineTo(4.4, 5.4); g.closePath(); g.fill(); }
    else if (t === 'cross') { r(0, 0, 12, 8, f[1]); r(3.2, 0, 1.6, 8, f[2]); r(0, 3.2, 12, 1.6, f[2]); }
    else if (t === 'plus') { r(0, 0, 12, 8, f[1]); r(5.2, 1.5, 1.6, 5, f[2]); r(3.5, 3.2, 5, 1.6, f[2]); }
    else if (t === 'diamond') { r(0, 0, 12, 8, f[1]); g.fillStyle = f[2]; g.beginPath(); g.moveTo(6, 1); g.lineTo(11, 4); g.lineTo(6, 7); g.lineTo(1, 4); g.closePath(); g.fill(); g.fillStyle = '#002776'; g.beginPath(); g.arc(6, 4, 1.6, 0, Math.PI * 2); g.fill(); }
    else if (t === 'gb') {
      r(0, 0, 12, 8, '#012169');
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 0); g.lineTo(12, 8); g.moveTo(12, 0); g.lineTo(0, 8); g.stroke();
      g.strokeStyle = '#c8102e'; g.lineWidth = 0.6; g.stroke();
      r(0, 2.9, 12, 2.2, '#fff'); r(4.9, 0, 2.2, 8, '#fff'); r(0, 3.4, 12, 1.2, '#c8102e'); r(5.4, 0, 1.2, 8, '#c8102e');
    }
  };
})(PG);
