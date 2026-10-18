// WORLD GP — wnętrze kokpitu w widoku z kokpitu: kierownica z wyświetlaczem, diodami obrotów, przyciskami,
// pokrętłami i łopatkami, dłonie w rękawicach obracające się z kierownicą, przedramiona, obszycie krawędzi kokpitu,
// kolumna kierownicy i osłona kolan. Model w układzie bolidu (x do przodu, y w górę, z w prawo) — dziecko nadwozia.
// API: build({ livery, helmet, quality }) → obiekt; update(obj, car, S, dt); setVisible(obj, on); dispose(obj).
(function (PG) {
  'use strict';
  if (typeof THREE === 'undefined') return;

  var PI = Math.PI, TAU = PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var FONT = '"Barlow Semi Condensed", "Titillium Web", "Arial Narrow", Arial, sans-serif';

  // środek kierownicy w układzie bolidu i nachylenie płaszczyzny (góra odchylona do przodu)
  var SW_POS = [0.705, 0.555, 0], SW_TILT = 25 * PI / 180, MAX_ANG = 1.5;
  // obrys korpusu kierownicy (lokalnie: x w prawo, y w górę, przód +z w stronę kierowcy)
  var BX = 0.1, BY0 = -0.07, BY1 = 0.076, FACE_Z = 0.025;

  function bodyShape() {
    var s = new THREE.Shape();
    s.moveTo(-BX, BY0 + 0.012); s.quadraticCurveTo(-BX, BY0, -BX + 0.012, BY0);
    s.lineTo(-0.032, BY0); s.quadraticCurveTo(0, BY0 + 0.009, 0.032, BY0);
    s.lineTo(BX - 0.012, BY0); s.quadraticCurveTo(BX, BY0, BX, BY0 + 0.012);
    s.lineTo(BX, BY1 - 0.016); s.quadraticCurveTo(BX, BY1, BX - 0.016, BY1);
    s.lineTo(-BX + 0.016, BY1); s.quadraticCurveTo(-BX, BY1, -BX, BY1 - 0.016);
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

  // ---------- tekstury ----------
  // płyta czołowa: splot węglowy, ramka wyświetlacza, pas diod, opisy przycisków i pokręteł, pasek w kolorze zespołu
  var BUTTONS = [
    [-0.072, 0.038, '#1e6fff', 'DRS'], [-0.072, 0.012, '#ffcc00', 'PIT'], [0.072, 0.038, '#e01b24', 'RADIO'], [0.072, 0.012, '#22b14c', 'OK'],
    [-0.05, -0.022, '#f2f2f2', 'BB−'], [0.05, -0.022, '#f2f2f2', 'BB+'], [0, -0.052, '#f07c1e', 'N'],
    [-0.088, 0.061, '#c9ccd2', ''], [0.088, 0.061, '#c9ccd2', '']
  ];
  var ROTARIES = [[-0.026, -0.031, 'MODE'], [0.026, -0.031, 'DIFF'], [-0.078, -0.05, 'ENTRY'], [0.078, -0.05, 'SOC']];
  var DISP = { x: 0, y: 0.018, w: 0.084, h: 0.05 };
  var FW = 512, FH = Math.round(512 * (BY1 - BY0) / (2 * BX));
  function fpx(x) { return (x + BX) / (2 * BX) * FW; }
  function fpy(y) { return (BY1 - y) / (BY1 - BY0) * FH; }
  function faceTexture(accent) {
    var c = mkCanvas(FW, FH), g = c.getContext('2d'), x, y;
    g.fillStyle = '#16181b'; g.fillRect(0, 0, FW, FH);
    // splot skośny 2/2
    for (y = 0; y < FH; y += 8) for (x = 0; x < FW; x += 8) {
      var k = ((x + y) / 8) % 4 < 2;
      var gr = k ? g.createLinearGradient(x, y, x + 8, y) : g.createLinearGradient(x, y, x, y + 8);
      gr.addColorStop(0, k ? '#26292e' : '#1c1e22'); gr.addColorStop(0.5, k ? '#33373d' : '#24272b'); gr.addColorStop(1, k ? '#212327' : '#191b1e');
      g.fillStyle = gr; g.fillRect(x, y, 8, 8);
    }
    // pasek w kolorze zespołu u dołu i cienka linia nad diodami
    g.fillStyle = accent; g.fillRect(0, FH - 14, FW, 14);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(fpx(-0.07), fpy(0.071), fpx(0.07) - fpx(-0.07), 2);
    // pas diod
    g.fillStyle = '#060708'; g.fillRect(fpx(-0.068), fpy(0.07), fpx(0.068) - fpx(-0.068), fpy(0.061) - fpy(0.07));
    // ramka wyświetlacza
    var dx0 = fpx(DISP.x - DISP.w / 2 - 0.004), dy0 = fpy(DISP.y + DISP.h / 2 + 0.004), dw = fpx(DISP.x + DISP.w / 2 + 0.004) - dx0, dh = fpy(DISP.y - DISP.h / 2 - 0.004) - dy0;
    g.fillStyle = '#050506'; g.beginPath(); g.moveTo(dx0 + 8, dy0); g.arcTo(dx0 + dw, dy0, dx0 + dw, dy0 + dh, 8); g.arcTo(dx0 + dw, dy0 + dh, dx0, dy0 + dh, 8); g.arcTo(dx0, dy0 + dh, dx0, dy0, 8); g.arcTo(dx0, dy0, dx0 + dw, dy0, 8); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    BUTTONS.forEach(function (b) {
      g.strokeStyle = b[2]; g.lineWidth = 3; g.globalAlpha = 0.85;
      g.beginPath(); g.arc(fpx(b[0]), fpy(b[1]), 0.0082 / (2 * BX) * FW, 0, TAU); g.stroke(); g.globalAlpha = 1;
      if (b[3]) { g.fillStyle = '#d9dde3'; g.font = '700 15px ' + FONT; g.fillText(b[3], fpx(b[0]), fpy(b[1] - 0.0125)); }
    });
    ROTARIES.forEach(function (r) {
      var cx = fpx(r[0]), cy = fpy(r[1]), R = 0.0125 / (2 * BX) * FW;
      g.strokeStyle = '#c8ccd3'; g.lineWidth = 2;
      for (var i = 0; i < 12; i++) { var a = -PI * 0.75 + i / 11 * PI * 1.5 - PI / 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R + 5), cy + Math.sin(a) * (R + 5)); g.stroke(); }
      g.fillStyle = '#d9dde3'; g.font = '700 13px ' + FONT; g.fillText(r[2], cx, cy + R + 14);
    });
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  // wyświetlacz: bieg, prędkość, okrążenie, czasy, DRS, akumulator, balans hamulców, zużycie opon
  var DW = 320, DH = 190;
  function fmtTime(t) {
    if (!(t > 0)) return '-:--.---';
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3);
  }
  function drawDisplay(g, st) {
    g.fillStyle = '#040506'; g.fillRect(0, 0, DW, DH);
    g.textBaseline = 'middle';
    // górny pasek
    g.fillStyle = '#11151a'; g.fillRect(0, 0, DW, 30);
    g.font = '700 22px ' + FONT; g.textAlign = 'left'; g.fillStyle = '#e8edf2'; g.fillText(st.lap, 8, 16);
    g.textAlign = 'right'; g.fillText(st.pos, DW - 8, 16);
    g.textAlign = 'center';
    g.fillStyle = st.drs === 2 ? '#2fd07a' : st.drs === 1 ? '#0d3a22' : '#1a1f26'; g.fillRect(DW / 2 - 34, 4, 68, 23);
    g.fillStyle = st.drs === 2 ? '#04140b' : st.drs === 1 ? '#2fd07a' : '#5a6370'; g.fillText('DRS', DW / 2, 16);
    // bieg
    g.font = '700 108px ' + FONT; g.fillStyle = st.limiter ? '#4aa3ff' : '#ffffff'; g.fillText(st.gear, DW / 2, 98);
    // prędkość i czasy po bokach
    g.textAlign = 'left'; g.font = '700 42px ' + FONT; g.fillStyle = '#ffffff'; g.fillText(st.speed, 10, 74);
    g.font = '600 16px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText('KM/H', 12, 102);
    g.textAlign = 'right'; g.font = '700 24px ' + FONT; g.fillStyle = st.deltaCol; g.fillText(st.delta, DW - 8, 70);
    g.font = '600 16px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText(st.timeLbl, DW - 8, 98);
    g.font = '700 20px ' + FONT; g.fillStyle = '#e8edf2'; g.fillText(st.time, DW - 8, 120);
    // dół: akumulator, balans hamulców, opony
    g.fillStyle = '#1a1f26'; g.fillRect(8, 146, 120, 14);
    g.fillStyle = '#ffd21a'; g.fillRect(8, 146, 120 * st.ers, 14);
    g.textAlign = 'left'; g.font = '700 16px ' + FONT; g.fillStyle = '#8f9aa8'; g.fillText('ERS', 8, 174);
    g.textAlign = 'center'; g.fillStyle = '#e8edf2'; g.fillText('BB ' + st.bb, DW / 2 + 10, 158);
    g.textAlign = 'right'; g.fillStyle = st.tyreCol; g.fillText(st.tyre, DW - 8, 158);
    g.fillStyle = '#8f9aa8'; g.fillText('OPONY', DW - 8, 178);
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
  function rod(a, b, ra, rb, seg) {
    var A = new THREE.Vector3(a[0], a[1], a[2]), B2 = new THREE.Vector3(b[0], b[1], b[2]), d = B2.clone().sub(A), L = d.length();
    var g = new THREE.CylinderGeometry(rb, ra, L, seg || 12, 1, false);
    g.translate(0, L / 2, 0);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.applyQuaternion(q); g.translate(A.x, A.y, A.z);
    return g;
  }

  // powierzchnia z profilu (x, y) rozciągniętego wzdłuż z ∈ [-hz, hz]; normalne w stronę kierowcy
  function sheet(prof, hz) {
    var P = [], N = [], I = [], n = prof.length;
    for (var i = 0; i < n; i++) {
      var a = prof[Math.max(0, i - 1)], b = prof[Math.min(n - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
      var nx = ty / l, ny = -tx / l;
      if (nx > 0) { nx = -nx; ny = -ny; }
      P.push(prof[i][0], prof[i][1], -hz, prof[i][0], prof[i][1], hz); N.push(nx, ny, 0, nx, ny, 0);
      if (i) { var k = i * 2; I.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setIndex(I);
    return g;
  }

  var Cockpit3D = PG.Cockpit3D = {};

  Cockpit3D.build = function (opts) {
    opts = opts || {};
    var lv = opts.livery || {}, hiQ = opts.quality !== 'low';
    var primary = lv.primary || '#d40f1a', accent = lv.accent || lv.secondary || '#ffd400';
    var disp = [];
    function keep(o) { disp.push(o); return o; }
    function mat(o) { return keep(new THREE.MeshStandardMaterial(o)); }
    var M = {
      carbon: mat({ color: 0x2a2d32, roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide }),
      face: mat({ map: keep(faceTexture(primary)), roughness: 0.48, metalness: 0.15 }),
      rubber: mat({ color: 0x1b1c1f, roughness: 0.92, metalness: 0 }),
      metal: mat({ color: 0x6b7077, roughness: 0.35, metalness: 0.85 }),
      knob: mat({ color: 0x0f1012, roughness: 0.55, metalness: 0.2 }),
      mark: mat({ color: 0xf2f2f2, roughness: 0.4, metalness: 0 }),
      glove: mat({ color: 0x1c1e23, roughness: 0.78, metalness: 0 }),
      gloveAcc: mat({ color: new THREE.Color(primary), roughness: 0.6, metalness: 0 }),
      suit: mat({ color: new THREE.Color(primary).multiplyScalar(0.6), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
      suede: mat({ color: 0x17181b, roughness: 1, metalness: 0 }),
      foam: mat({ color: 0x2a2c31, roughness: 0.95, metalness: 0 })
    };
    var root = new THREE.Group(); root.name = 'Cockpit3D'; root.visible = false;
    function add(geo, m, parent, cast) {
      var mesh = new THREE.Mesh(keep(geo), m);
      mesh.castShadow = !!cast; mesh.receiveShadow = hiQ;
      (parent || root).add(mesh);
      return mesh;
    }

    // --- kierownica: grupa zorientowana (płaszczyzna koła), w niej obracana część ---
    var wheel = new THREE.Group(), spin = new THREE.Group();
    var X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(Math.sin(SW_TILT), Math.cos(SW_TILT), 0), Z = new THREE.Vector3(-Math.cos(SW_TILT), Math.sin(SW_TILT), 0);
    wheel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    wheel.position.set(SW_POS[0], SW_POS[1], SW_POS[2]);
    root.add(wheel); wheel.add(spin);
    // korpus: przód (z = FACE_Z) ma dokładnie obrys płyty czołowej, fazowane krawędzie z tyłu
    var bodyG = new THREE.ExtrudeGeometry(bodyShape(), { depth: FACE_Z - 0.003, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 });
    add(bodyG, M.carbon, spin, true);
    // płyta czołowa z teksturą (UV z obrysu)
    var fg = new THREE.ShapeGeometry(bodyShape(), 8), fp = fg.attributes.position, fu = fg.attributes.uv;
    for (var i = 0; i < fp.count; i++) fu.setXY(i, (fp.getX(i) + BX) / (2 * BX), (fp.getY(i) - BY0) / (BY1 - BY0));
    fg.translate(0, 0, FACE_Z + 0.0003);
    add(fg, M.face, spin);
    // uchwyty z gumy
    [-1, 1].forEach(function (s) {
      var gg = new THREE.ExtrudeGeometry(roundRect(0.03, 0.118, 0.012), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.009, bevelSegments: 3, curveSegments: 6 });
      gg.translate(0, 0, -0.009);
      gg.rotateZ(-s * 0.07);
      gg.translate(s * 0.121, -0.004, -0.004);
      add(gg, M.rubber, spin, true);
      // łopatki zmiany biegów za uchwytami
      var pg = new THREE.ExtrudeGeometry(roundRect(0.05, 0.06, 0.01), { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
      pg.translate(s * 0.108, 0.006, -0.022);
      add(pg, M.carbon, spin);
    });
    // wyświetlacz (żywa tekstura)
    var dc = mkCanvas(DW, DH), dg = dc.getContext('2d'), dtex = keep(new THREE.CanvasTexture(dc));
    dtex.colorSpace = THREE.SRGBColorSpace; dtex.anisotropy = 8;
    var dmat = keep(new THREE.MeshBasicMaterial({ map: dtex, color: new THREE.Color(1.25, 1.25, 1.25) }));
    var dplane = add(new THREE.PlaneGeometry(DISP.w, DISP.h), dmat, spin);
    dplane.position.set(DISP.x, DISP.y, FACE_Z + 0.0012);
    // diody obrotów: 5 zielonych, 5 czerwonych, 5 niebieskich
    var ledG = keep(new THREE.BoxGeometry(0.0064, 0.0052, 0.003)), ledM = keep(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    var leds = new THREE.InstancedMesh(ledG, ledM, 15), mtx = new THREE.Matrix4(), off = new THREE.Color(0.03, 0.03, 0.035);
    for (i = 0; i < 15; i++) { mtx.makeTranslation(-0.0595 + i * 0.0085, 0.0655, FACE_Z + 0.0015); leds.setMatrixAt(i, mtx); leds.setColorAt(i, off); }
    leds.frustumCulled = false; spin.add(leds);
    // przyciski i pokrętła
    var btnG = keep(new THREE.CylinderGeometry(0.0055, 0.006, 0.0045, 16)); btnG.rotateX(PI / 2);
    BUTTONS.forEach(function (b) {
      var m = add(btnG, mat({ color: new THREE.Color(b[2]), roughness: 0.35, metalness: 0.05 }), spin);
      m.position.set(b[0], b[1], FACE_Z + 0.0022);
    });
    var rotG = keep(new THREE.CylinderGeometry(0.0082, 0.0092, 0.009, 20)); rotG.rotateX(PI / 2);
    var markG = keep(new THREE.BoxGeometry(0.0016, 0.007, 0.0012));
    ROTARIES.forEach(function (r, k) {
      var knob = add(rotG, M.knob, spin); knob.position.set(r[0], r[1], FACE_Z + 0.0045);
      var mk = add(markG, M.mark, knob); mk.position.set(0, 0.0035, 0.0046);
      knob.rotation.z = (k - 1.5) * 0.45;
    });
    // kolumna kierownicy i szybkozłączka (nieruchome)
    add(rod([0, 0, -0.004], [0, 0, -0.2], 0.019, 0.016, 14), M.metal, wheel);
    add(rod([0, 0, -0.004], [0, 0, -0.03], 0.028, 0.026, 18), M.knob, wheel);

    // --- dłonie w rękawicach (obracają się z kierownicą) ---
    var wrists = [];
    [-1, 1].forEach(function (s) {
      var hand = new THREE.Group(); spin.add(hand);
      function P(x, y, z) { return [s * x, y, z]; }
      add(ellipsoid(0.034, 0.052, 0.024, s * 0.124, 0.002, 0.043, -s * 0.15), M.glove, hand, true);   // grzbiet dłoni
      add(ellipsoid(0.028, 0.044, 0.016, s * 0.104, 0.0, 0.038, -s * 0.1), M.glove, hand, true);     // kostki
      // kciuk na płycie czołowej
      add(tube([P(0.106, 0.026, 0.047), P(0.096, 0.04, 0.038), P(0.086, 0.047, 0.031)], 0.0085, 8), M.glove, hand, true);
      add(ellipsoid(0.0088, 0.0088, 0.0088, s * 0.086, 0.047, 0.031), M.glove, hand);
      // palce owinięte wokół wewnętrznej krawędzi uchwytu
      [0.026, 0.006, -0.014, -0.034].forEach(function (y) {
        add(tube([P(0.114, y, 0.04), P(0.098, y, 0.028), P(0.094, y + 0.002, 0.004), P(0.104, y + 0.003, -0.016)], 0.0088, 8), M.glove, hand, true);
      });
      // mankiet rękawicy
      add(rod(P(0.128, -0.026, 0.052), P(0.15, -0.074, 0.112), 0.031, 0.035, 14), M.glove, hand, true);
      add(rod(P(0.148, -0.07, 0.106), P(0.152, -0.079, 0.118), 0.036, 0.036, 14), M.gloveAcc, hand);
      wrists.push({ s: s, local: new THREE.Vector3(s * 0.152, -0.079, 0.118) });
    });
    // przedramiona: od łokcia (nieruchomo w bolidzie) do nadgarstka (obraca się z kierownicą)
    var armG = keep(new THREE.CylinderGeometry(0.035, 0.044, 1, 20, 1, true)); armG.translate(0, 0.5, 0);
    var arms = wrists.map(function (w) {
      var m = add(armG, M.suit, root, true);
      // łokieć nisko i z tyłu: przedramię wchodzi w kadr od dołu, nie zasłania widoku
      return { mesh: m, w: w, elbow: new THREE.Vector3(0.36, 0.4, w.s * 0.215) };
    });

    // --- kokpit: obszycie krawędzi, osłona kolan, boczne poduszki ---
    var rim = [[0.32, 0.672, 0.236], [0.52, 0.665, 0.236], [0.72, 0.652, 0.218], [0.86, 0.643, 0.182], [0.94, 0.637, 0.12], [0.962, 0.634, 0.05]];
    var rimPts = rim.concat([[0.966, 0.634, 0]]).concat(rim.slice().reverse().map(function (p) { return [p[0], p[1], -p[2]]; }));
    add(tube(rimPts, 0.017, 48), M.suede, root);
    // osłona kolan: przednia ściana kokpitu opadająca od krawędzi ku kierowcy
    add(sheet([[0.964, 0.633], [0.945, 0.6], [0.915, 0.56], [0.88, 0.525], [0.84, 0.5]], 0.15), M.carbon, root);
    [-1, 1].forEach(function (s) {
      var pad = new THREE.ExtrudeGeometry(roundRect(0.36, 0.13, 0.04), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
      pad.translate(0.36, 0.585, s > 0 ? 0.19 : -0.225);
      add(pad, M.foam, root);
    });

    return {
      root: root, wheel: wheel, spin: spin, leds: leds, dctx: dg, dtex: dtex, arms: arms, disp: disp,
      steer: 0, ers: 0.62, dispT: 0, ledKey: '', last: '', blink: 0,
      tmpA: new THREE.Vector3(), tmpB: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), q: new THREE.Quaternion()
    };
  };

  Cockpit3D.setVisible = function (o, on) { if (o && o.root) o.root.visible = !!on; };

  var LED_ON = [new THREE.Color(0.25, 3.2, 0.6), new THREE.Color(3.2, 0.25, 0.18), new THREE.Color(0.55, 1.2, 3.4)];
  var LED_OFF = new THREE.Color(0.03, 0.03, 0.035), LED_LIM = new THREE.Color(0.55, 1.2, 3.4);

  Cockpit3D.update = function (o, car, S, dt) {
    if (!o || !o.root || !o.root.visible || !car) return;
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    // skręt kierownicy (zgodnie z ruchem wskazówek zegara w prawo)
    var tgt = clamp(num(car.steer, 0), -1, 1);
    o.steer += (tgt - o.steer) * (dt > 0 ? Math.min(1, dt * 16) : 1);
    o.spin.rotation.z = -o.steer * MAX_ANG;
    o.spin.updateMatrix(); o.wheel.updateMatrix();
    // przedramiona: walec od łokcia do nadgarstka
    for (var a = 0; a < o.arms.length; a++) {
      var A = o.arms[a], w = o.tmpA.copy(A.w.local).applyMatrix4(o.spin.matrix).applyMatrix4(o.wheel.matrix);
      var d = o.tmpB.copy(w).sub(A.elbow), L = d.length();
      A.mesh.position.copy(A.elbow);
      A.mesh.quaternion.setFromUnitVectors(o.up, d.multiplyScalar(1 / (L || 1)));
      A.mesh.scale.set(1, L, 1);
    }
    // akumulator: ładuje się przy hamowaniu, rozładowuje przy pełnym gazie
    var v = Math.abs(num(car.v, 0)), thr = clamp(num(car.throttle, 0), 0, 1), brk = clamp(num(car.brake, 0), 0, 1);
    o.ers = clamp(o.ers + dt * (brk * 0.22 * Math.min(1, v / 20) - (thr > 0.9 && v > 30 ? 0.035 : 0) + 0.004), 0, 1);
    // diody obrotów
    // diody zmiany biegu: od 15 000 do 18 800 obr./min (V10), niebieskie na ograniczniku
    var rpm = num(car.rpm, 4500), lit = Math.round(clamp((rpm - 15000) / 3800, 0, 1) * 15), lim = !!car.limiter || rpm >= 18900;
    o.blink += dt;
    var ph = lim ? (Math.floor(o.blink * 10) % 2) : 0, key = lim ? 'L' + ph : 'n' + lit;
    if (key !== o.ledKey) {
      o.ledKey = key;
      for (var i = 0; i < 15; i++) o.leds.setColorAt(i, lim ? (ph ? LED_LIM : LED_OFF) : i < lit ? LED_ON[(i / 5) | 0] : LED_OFF);
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
      timeLbl: last > 0 ? 'OSTATNIE ' + fmtTime(last) : 'CZAS', time: fmtTime(tNow),
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
