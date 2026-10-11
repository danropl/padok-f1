// Monza Grand Prix — widok 3D: renderer, kamery, bolidy na torze, efekty (dym opon, pył, iskry, odłamki,
// ślady opon, linia jazdy), postprocessing (PG.Post3D, jeśli jest).
(function (PG) {
  'use strict';

  // Czy przeglądarka udźwignie widok 3D (WebGL + moduły 3D)
  PG.has3D = function () {
    if (!window.THREE || !(PG.World3D || PG.World3DLite) || !PG.Car3D) return false;
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  };

  PG.CAMERAS = [
    { id: 'chase', name: 'Za bolidem' },
    { id: 'far', name: 'Za bolidem, dalej' },
    { id: 'tcam', name: 'T-kamera' },
    { id: 'cockpit', name: 'Z kokpitu' },
    { id: 'tv', name: 'Telewizyjna' },
    { id: 'heli', name: 'Z helikoptera' }
  ];

  var wrapI = function (i, n) { return ((i % n) + n) % n; };
  function damp(k, dt) { return 1 - Math.exp(-k * dt); }
  function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function c01(x) { return x > 0 ? (x < 1 ? x : 1) : 0; }
  function sst(a, b, x) { var t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  var RND = Math.random, PI = Math.PI, TAU = PI * 2;

  // budżety efektów wg jakości (em: mnożnik intensywności emisji)
  var FXQ = {
    high: { smoke: 1400, dust: 900, sparks: 500, shards: 160, skids: 4000, debris: 16, em: 1, block: true },
    medium: { smoke: 800, dust: 600, sparks: 360, shards: 100, skids: 2600, debris: 12, em: 0.65, block: true },
    low: { smoke: 320, dust: 300, sparks: 200, shards: 48, skids: 1200, debris: 8, em: 0.35, block: false }
  };
  // ślady: kolory (liniowe) — guma, żwir, trawa
  var MARK_RGB = [[0.035, 0.035, 0.04], [0.45, 0.38, 0.26], [0.16, 0.13, 0.08]];
  // punkty części bolidu (układ lokalny: x do przodu, y w górę, z w prawo)
  var PART_LOC = {
    fwL: [2.75, 0.12, -0.6], fwR: [2.75, 0.12, 0.6], rw: [-2.6, 0.8, 0], floor: [0.2, 0.05, 0],
    suspFL: [1.6, 0.4, -0.75], suspFR: [1.6, 0.4, 0.75], suspRL: [-1.9, 0.4, -0.75], suspRR: [-1.9, 0.4, 0.75], engine: [-1.4, 0.75, 0]
  };

  // Częściowe wysyłanie bufora na GPU (przy wielu zaległych zakresach — całość)
  function dirty(attr, start, count) {
    if (attr.addUpdateRange && attr.updateRanges) {
      if (attr.updateRanges.length > 6) attr.clearUpdateRanges();
      else attr.addUpdateRange(start, count);
    }
    attr.needsUpdate = true;
  }

  // ---------- szum do tekstur proceduralnych ----------
  function hsh(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    var a = hsh(xi, yi, s), b = hsh(xi + 1, yi, s), c = hsh(xi, yi + 1, s), d = hsh(xi + 1, yi + 1, s);
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, s) { return vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.15; }

  // Atlas 2×2 kłębów dymu (kanwa, nieprzezroczysta): R = gęstość, G/B = normalna (x, y w górę)
  function smokeAtlas() {
    var S = 256, T = 128, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), img = g.createImageData(S, S), px = img.data, D = new Float32Array(T * T);
    var norm = 1 - Math.exp(-2.6);
    for (var t = 0; t < 4; t++) {
      var ox = (t % 2) * T, oy = ((t / 2) | 0) * T, seed = 17 + t * 31, bl = [], nb = 5 + (t % 2) * 2, x, y, k;
      for (k = 0; k < nb; k++) {
        var an = hsh(k, seed, 3) * TAU, rr = 0.1 + hsh(k + 9, seed, 3) * 0.3;
        bl.push(Math.cos(an) * rr, Math.sin(an) * rr, 0.26 + hsh(k + 21, seed, 3) * 0.22);
      }
      var mx = 1e-6;
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        var u = (x + 0.5) / T * 2 - 1, v = (y + 0.5) / T * 2 - 1, r = Math.sqrt(u * u + v * v) / 0.94, s = 0;
        for (k = 0; k < bl.length; k += 3) { var dx = u - bl[k], dy = v - bl[k + 1]; s += Math.exp(-(dx * dx + dy * dy) / (bl[k + 2] * bl[k + 2]) * 1.6); }
        var dd = s * (0.5 + 0.95 * fbm(u * 3.2 + t * 7.1, v * 3.2 + t * 3.3, seed)) * sst(1, 0.42, r);
        D[y * T + x] = dd; if (dd > mx) mx = dd;
      }
      for (k = 0; k < T * T; k++) D[k] = (1 - Math.exp(-2.6 * D[k] / mx)) / norm;
      for (y = 0; y < T; y++) for (x = 0; x < T; x++) {
        var d0 = D[y * T + x], xl = x > 0 ? x - 1 : x, xr = x < T - 1 ? x + 1 : x, yu = y > 0 ? y - 1 : y, yd = y < T - 1 ? y + 1 : y;
        var hu = (D[y * T + xr] - D[y * T + xl]) * T / 4, hv = (D[yd * T + x] - D[yu * T + x]) * T / 4;
        var uu = (x + 0.5) / T * 2 - 1, vv = (y + 0.5) / T * 2 - 1, sz = Math.sqrt(Math.max(0, 1 - uu * uu - vv * vv));
        // normalna: kula (kształt kłębu) + gradient gęstości (grudki)
        var nx = uu * 0.7 - hu * 0.21, ny = -vv * 0.7 + hv * 0.21, nz = sz * 0.7 + 0.6, nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        var o = ((oy + y) * S + ox + x) * 4;
        px[o] = Math.round(c01(d0) * 255); px[o + 1] = Math.round((nx / nl * 0.5 + 0.5) * 255); px[o + 2] = Math.round((ny / nl * 0.5 + 0.5) * 255); px[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  }
  // Maska przezroczystości śladów opon (G = krycie): miękkie brzegi i smugi gumy
  function skidMask() {
    var W = 64, H = 4, c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'), img = g.createImageData(W, H), px = img.data;
    for (var x = 0; x < W; x++) {
      var u = (x + 0.5) / W, a = sst(0, 0.2, u) * sst(1, 0.8, u) * (0.78 + 0.22 * vnoise(x * 0.7, 3, 5));
      for (var y = 0; y < H; y++) { var o = (y * W + x) * 4, q = Math.round(a * 255); px[o] = q; px[o + 1] = q; px[o + 2] = q; px[o + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
  // Maska linii jazdy (G = krycie): miękkie brzegi i delikatne szewrony wskazujące kierunek jazdy
  function lineMask() {
    var W = 32, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'), img = g.createImageData(W, H), px = img.data;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var u = (x + 0.5) / W, v = 1 - (y + 0.5) / H; // v rośnie do przodu (tekstura odwrócona w pionie)
      var edge = sst(0, 0.3, u) * sst(1, 0.7, u);
      var cv = 0.62 - 0.62 * Math.abs(u - 0.5), chev = sst(0.085, 0.035, Math.abs(v - cv));
      var a = edge * (0.58 + 0.4 * chev);
      var o = (y * W + x) * 4, q = Math.round(c01(a) * 255);
      px[o] = q; px[o + 1] = q; px[o + 2] = q; px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // ---------- pył i mgiełka wodna: punkty (SoA, bez alokacji) ----------
  var PT_VS = [
    'attribute vec4 aColor;',
    'attribute float aSize;',
    'varying vec4 vColor;',
    'uniform float uScale;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  vColor = aColor;',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  var PT_FS = [
    'varying vec4 vColor;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  vec2 d = gl_PointCoord - vec2(0.5);',
    '  float r = length(d);',
    '  if (r > 0.5) discard;',
    '  float a = vColor.a * smoothstep(0.5, 0.15, r);',
    '  gl_FragColor = vec4(pow(vColor.rgb, vec3(2.2)), a);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');
  var PS = 16; // x y z vx vy vz life max r g b a size grow drag grav

  function Dust(scene, max) {
    this.max = max; this.n = 0; this.ring = 0;
    this.d = new Float32Array(max * PS);
    var g = this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aSize', this.aSize);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 } }]),
      vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, fog: true
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false; this.pts.renderOrder = 5;
    scene.add(this.pts);
  }
  // kolory w przestrzeni wyświetlania (jak dawniej), shader zamienia na liniowe
  Dust.prototype.add = function (x, y, z, vx, vy, vz, life, r, g, b, a, size, grow, drag, grav) {
    var i;
    if (this.n < this.max) i = this.n++;
    else { i = this.ring; this.ring = (this.ring + 1) % this.max; }
    var o = i * PS, D = this.d;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz; D[o + 6] = life; D[o + 7] = life;
    D[o + 8] = r; D[o + 9] = g; D[o + 10] = b; D[o + 11] = a; D[o + 12] = size; D[o + 13] = grow; D[o + 14] = drag; D[o + 15] = grav;
  };
  Dust.prototype.update = function (dt) {
    var D = this.d, n = this.n, i = 0, P = this.aPos.array, C = this.aCol.array, Z = this.aSize.array;
    while (i < n) {
      var o = i * PS;
      D[o + 6] -= dt;
      if (!(D[o + 6] > 0)) { n--; if (i < n) D.copyWithin(o, n * PS, n * PS + PS); continue; }
      var dr = Math.exp(-D[o + 14] * dt);
      D[o + 3] *= dr; D[o + 5] *= dr; D[o + 4] = D[o + 4] * dr - D[o + 15] * dt;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      if (D[o + 1] < 0.02) { D[o + 1] = 0.02; D[o + 4] = Math.abs(D[o + 4]) * 0.3; }
      var t = D[o + 6] / D[o + 7];
      P[i * 3] = D[o]; P[i * 3 + 1] = D[o + 1]; P[i * 3 + 2] = D[o + 2];
      C[i * 4] = D[o + 8]; C[i * 4 + 1] = D[o + 9]; C[i * 4 + 2] = D[o + 10]; C[i * 4 + 3] = D[o + 11] * Math.min(1, t * 2.5);
      Z[i] = D[o + 12] * (1 + (1 - t) * D[o + 13]);
      i++;
    }
    this.n = n;
    if (this.ring >= n) this.ring = 0;
    this.geo.setDrawRange(0, n);
    if (n > 0) { dirty(this.aPos, 0, n * 3); dirty(this.aCol, 0, n * 4); dirty(this.aSize, 0, n); }
  };
  Dust.prototype.clear = function () { this.n = 0; this.ring = 0; this.geo.setDrawRange(0, 0); };
  Dust.prototype.dispose = function () { if (this.pts.parent) this.pts.parent.remove(this.pts); this.geo.dispose(); this.mat.dispose(); };

  // ---------- dym opon: billboardy z atlasu, obrót, oświetlenie słońcem, ciemniejszy rdzeń, mgła ----------
  var SM_VS = [
    'attribute vec3 iPos;',
    'attribute vec4 iA;', // promień, obrót, krycie, kafel atlasu
    'attribute vec4 iC;', // kolor, przyciemnienie rdzenia
    'varying vec2 vUv;',
    'varying vec2 vRot;',
    'varying vec4 vC;',
    'varying float vA;',
    'varying float vWY;',
    '#include <fog_pars_vertex>',
    'void main() {',
    '  float s = iA.x;',
    '  float c = cos(iA.y);',
    '  float sn = sin(iA.y);',
    '  vec2 o = vec2(position.x * c - position.y * sn, position.x * sn + position.y * c) * s;',
    '  vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);',
    '  float dist = -mvPosition.z;',
    // przesunięcie ku kamerze zmniejsza przecinanie kłębu z asfaltem
    '  float push = min(s * 0.5, max(0.0, dist - 0.6) * 0.5);',
    '  mvPosition.xy += o;',
    '  mvPosition.z += push;',
    '  vWY = iPos.y + viewMatrix[1][0] * o.x + viewMatrix[1][1] * o.y + viewMatrix[1][2] * push;',
    '  vUv = (vec2(mod(iA.w, 2.0), floor(iA.w * 0.5)) + position.xy * 0.5 + 0.5) * 0.5;',
    '  vRot = vec2(c, sn);',
    '  vC = iC;',
    '  vA = iA.z * clamp((dist - 0.3) / (s * 1.6 + 0.4), 0.0, 1.0);',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  #include <fog_vertex>',
    '}'
  ].join('\n');
  var SM_FS = [
    'uniform sampler2D uTex;',
    'uniform vec3 uSunV;',
    'uniform vec3 uSunC;',
    'uniform vec3 uAmbC;',
    'varying vec2 vUv;',
    'varying vec2 vRot;',
    'varying vec4 vC;',
    'varying float vA;',
    'varying float vWY;',
    '#include <fog_pars_fragment>',
    'void main() {',
    '  vec4 t = texture2D(uTex, vUv);',
    '  float d = t.r;',
    '  float a = d * vA * smoothstep(0.0, 0.4, vWY);',
    '  if (a < 0.004) discard;',
    '  vec2 nt = t.gb * 2.0 - 1.0;',
    '  vec3 n = normalize(vec3(nt.x * vRot.x - nt.y * vRot.y, nt.x * vRot.y + nt.y * vRot.x, 0.8));',
    '  float l = clamp(dot(n, uSunV) * 0.55 + 0.45, 0.0, 1.0);',
    '  float back = pow(max(0.0, -uSunV.z), 3.0) * (1.0 - d) * 0.6;',
    '  float core = 1.0 - vC.a * smoothstep(0.3, 1.0, d);',
    '  vec3 col = vC.rgb * (uAmbC * core + uSunC * (l * core + back));',
    '  gl_FragColor = vec4(col, min(a, 1.0));',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '  #include <fog_fragment>',
    '}'
  ].join('\n');
  // x y z vx vy vz wiek życie r0 r1 krycie obrót obrótV r g b rdzeń wypór opór faza kafel
  var SS = 21;
  var QUAD = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];

  function Smoke(scene, max, tex) {
    this.max = max; this.n = 0; this.nf = max;
    this.d = new Float32Array(max * SS);
    this.ord = new Uint16Array(max); this.key = new Float32Array(max); this.free = new Uint16Array(max);
    for (var i = 0; i < max; i++) this.free[i] = max - 1 - i;
    var g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(QUAD), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iA', this.iA); g.setAttribute('iC', this.iC);
    g.instanceCount = 0;
    var U = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uSunV: { value: new THREE.Vector3(0, 0.6, 0.8) }, uSunC: { value: new THREE.Color(0.8, 0.74, 0.62) }, uAmbC: { value: new THREE.Color(0.3, 0.34, 0.42) }
    }]);
    U.uTex = { value: tex };
    this.mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SM_VS, fragmentShader: SM_FS, transparent: true, depthWrite: false, fog: true });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  // Nowy kłąb (kolor liniowy); przy pełnym buforze zastępuje najbardziej wygasły z kilku kolejnych (bez przeglądania całej puli)
  Smoke.prototype.emit = function (x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b, core, buoy, drag) {
    var slot, D = this.d;
    if (this.nf > 0) { slot = this.free[--this.nf]; this.ord[this.n++] = slot; }
    else {
      var cnt = this.n, best = -1, bv = -1, rr = (this.rr | 0) % (cnt || 1);
      for (var k = 0; k < 8 && k < cnt; k++) { var s = this.ord[(rr + k) % cnt], f = D[s * SS + 6] / D[s * SS + 7]; if (f > bv) { bv = f; best = s; } }
      this.rr = cnt ? (rr + 8) % cnt : 0;
      if (best < 0) return;
      slot = best;
    }
    var o = slot * SS;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz;
    D[o + 6] = 0; D[o + 7] = life > 0.1 ? life : 0.1; D[o + 8] = s0; D[o + 9] = s1; D[o + 10] = a0;
    D[o + 11] = RND() * TAU; D[o + 12] = (RND() - 0.5) * 0.9; D[o + 13] = r; D[o + 14] = g; D[o + 15] = b;
    D[o + 16] = core; D[o + 17] = buoy; D[o + 18] = drag; D[o + 19] = RND() * TAU; D[o + 20] = (RND() * 4) | 0;
    this.key[slot] = 1e9;
  };
  // Symulacja, sortowanie od najdalszych (sortowanie przez wstawianie — kolejność prawie stała) i bufory
  Smoke.prototype.update = function (dt, cx, cy, cz, fx, fy, fz, wx, wz) {
    var D = this.d, ord = this.ord, key = this.key, n = this.n, w = 0, k, s, o;
    var kv = Math.exp(-1.2 * dt), kr = Math.exp(-0.5 * dt);
    for (k = 0; k < n; k++) {
      s = ord[k]; o = s * SS;
      var age = D[o + 6] + dt;
      if (age >= D[o + 7]) { this.free[this.nf++] = s; continue; }
      D[o + 6] = age;
      var f = age / D[o + 7], dr = Math.exp(-D[o + 18] * dt), ph = D[o + 19] + age * 1.7;
      // opór powietrza (dąży do wiatru), lekka turbulencja, wypór słabnący z wiekiem
      D[o + 3] = wx + (D[o + 3] - wx) * dr + Math.sin(ph) * 0.4 * dt;
      D[o + 5] = wz + (D[o + 5] - wz) * dr + Math.cos(ph * 1.3) * 0.4 * dt;
      D[o + 4] = D[o + 4] * kv + D[o + 17] * (1 - f) * dt;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      var g1 = 1 - f, sz = D[o + 8] + (D[o + 9] - D[o + 8]) * (1 - g1 * g1);
      if (D[o + 1] < sz * 0.32) { D[o + 1] = sz * 0.32; if (D[o + 4] < 0) D[o + 4] = 0; }
      D[o + 11] += D[o + 12] * dt; D[o + 12] *= kr;
      key[s] = (D[o] - cx) * fx + (D[o + 1] - cy) * fy + (D[o + 2] - cz) * fz;
      ord[w++] = s;
    }
    n = this.n = w;
    for (k = 1; k < n; k++) {
      var si = ord[k], ki = key[si], j = k - 1;
      while (j >= 0 && key[ord[j]] < ki) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = si;
    }
    // za kamerą nic nie rysujemy (posortowane: są na końcu)
    var nd = n;
    while (nd > 0 && key[ord[nd - 1]] < -5) nd--;
    var P = this.iPos.array, A = this.iA.array, C = this.iC.array;
    for (k = 0; k < nd; k++) {
      s = ord[k]; o = s * SS;
      var f2 = D[o + 6] / D[o + 7], g2 = 1 - f2;
      P[k * 3] = D[o]; P[k * 3 + 1] = D[o + 1]; P[k * 3 + 2] = D[o + 2];
      A[k * 4] = D[o + 8] + (D[o + 9] - D[o + 8]) * (1 - g2 * g2);
      A[k * 4 + 1] = D[o + 11];
      A[k * 4 + 2] = D[o + 10] * Math.min(1, D[o + 6] * 8) * Math.pow(g2, 1.4);
      A[k * 4 + 3] = D[o + 20];
      C[k * 4] = D[o + 13]; C[k * 4 + 1] = D[o + 14]; C[k * 4 + 2] = D[o + 15]; C[k * 4 + 3] = D[o + 16];
    }
    this.geo.instanceCount = nd;
    this.mesh.visible = nd > 0;
    if (nd > 0) { dirty(this.iPos, 0, nd * 3); dirty(this.iA, 0, nd * 4); dirty(this.iC, 0, nd * 4); }
  };
  Smoke.prototype.clear = function () {
    this.n = 0; this.nf = this.max;
    for (var i = 0; i < this.max; i++) this.free[i] = this.max - 1 - i;
    this.geo.instanceCount = 0; this.mesh.visible = false;
  };
  Smoke.prototype.dispose = function () { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); };

  // ---------- iskry: smugi rozciągnięte wzdłuż prędkości (addytywne) ----------
  var SP_VS = [
    'attribute vec3 iPos;',
    'attribute vec3 iVel;',
    'attribute vec4 iA;', // szerokość, krycie, żar, czas smugi
    'varying vec2 vQ;',
    'varying float vA;',
    'varying float vHeat;',
    'void main() {',
    '  vec4 h = viewMatrix * vec4(iPos, 1.0);',
    '  vec4 t = viewMatrix * vec4(iPos - iVel * iA.w, 1.0);',
    '  vec2 dir = h.xy / max(0.05, -h.z) - t.xy / max(0.05, -t.z);',
    '  float l = length(dir);',
    '  vec2 nd = l > 0.000001 ? dir / l : vec2(1.0, 0.0);',
    '  vec2 sd = vec2(-nd.y, nd.x);',
    // co najmniej ~1 piksel szerokości także z daleka
    '  float wv = max(iA.x, -h.z * 0.0016);',
    '  vec4 p = mix(t, h, position.x * 0.5 + 0.5);',
    '  p.xy += sd * (position.y * wv) + nd * (position.x * wv);',
    '  vQ = position.xy;',
    '  vA = iA.y;',
    '  vHeat = iA.z;',
    '  gl_Position = projectionMatrix * p;',
    '}'
  ].join('\n');
  var SP_FS = [
    'uniform float uBoost;',
    'varying vec2 vQ;',
    'varying float vA;',
    'varying float vHeat;',
    'void main() {',
    '  float across = 1.0 - vQ.y * vQ.y;',
    '  float along = smoothstep(-1.0, 0.1, vQ.x);',
    '  float a = vA * across * along;',
    '  if (a < 0.003) discard;',
    '  vec3 c = mix(vec3(1.0, 0.28, 0.05), vec3(1.0, 0.82, 0.52), vHeat) * (0.5 + vHeat * uBoost);',
    '  gl_FragColor = vec4(c, a);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');
  var KS = 12; // x y z vx vy vz wiek życie szer żar krycie grawitacja

  function Sparks(scene, max) {
    this.max = max; this.n = 0; this.ring = 0;
    this.d = new Float32Array(max * KS);
    var g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(QUAD), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iVel', this.iVel); g.setAttribute('iA', this.iA);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uBoost: { value: 3.2 } }, vertexShader: SP_VS, fragmentShader: SP_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  Sparks.prototype.emit = function (x, y, z, vx, vy, vz, life, w, heat, a) {
    var i;
    if (this.n < this.max) i = this.n++;
    else { i = this.ring; this.ring = (this.ring + 1) % this.max; }
    var o = i * KS, D = this.d;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz;
    D[o + 6] = 0; D[o + 7] = life > 0.05 ? life : 0.05; D[o + 8] = w; D[o + 9] = heat; D[o + 10] = a; D[o + 11] = 9.81;
  };
  Sparks.prototype.update = function (dt) {
    var D = this.d, n = this.n, i = 0, P = this.iPos.array, V = this.iVel.array, A = this.iA.array, dr = Math.exp(-0.9 * dt);
    while (i < n) {
      var o = i * KS;
      D[o + 6] += dt;
      if (D[o + 6] >= D[o + 7]) { n--; if (i < n) D.copyWithin(o, n * KS, n * KS + KS); continue; }
      D[o + 3] *= dr; D[o + 5] *= dr; D[o + 4] = D[o + 4] * dr - D[o + 11] * dt;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      // odbicie od asfaltu (iskry ślizgają się po nawierzchni)
      if (D[o + 1] < 0.02 && D[o + 4] < 0) { D[o + 1] = 0.02; D[o + 4] = -D[o + 4] * 0.35; D[o + 3] *= 0.75; D[o + 5] *= 0.75; }
      var f = D[o + 6] / D[o + 7];
      P[i * 3] = D[o]; P[i * 3 + 1] = D[o + 1]; P[i * 3 + 2] = D[o + 2];
      V[i * 3] = D[o + 3]; V[i * 3 + 1] = D[o + 4]; V[i * 3 + 2] = D[o + 5];
      A[i * 4] = D[o + 8]; A[i * 4 + 1] = D[o + 10] * (1 - f * f); A[i * 4 + 2] = D[o + 9] * Math.pow(1 - f, 0.7); A[i * 4 + 3] = 0.03;
      i++;
    }
    this.n = n;
    if (this.ring >= n) this.ring = 0;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) { dirty(this.iPos, 0, n * 3); dirty(this.iVel, 0, n * 3); dirty(this.iA, 0, n * 4); }
  };
  Sparks.prototype.clear = function () { this.n = 0; this.ring = 0; this.geo.instanceCount = 0; this.mesh.visible = false; };
  Sparks.prototype.dispose = function () { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); };

  // ---------- odłamki włókna węglowego (instancje, koziołkują i opadają) ----------
  var HS = 18; // x y z vx vy vz ex ey ez wx wy wz rozmiar wiek życie r g b
  function Shards(scene, max) {
    this.max = max; this.n = 0;
    this.d = new Float32Array(max * HS);
    this.geo = new THREE.TetrahedronGeometry(1, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.3 });
    var m = this.mesh = new THREE.InstancedMesh(this.geo, this.mat, max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    if (m.instanceColor) m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.visible = false;
    scene.add(m);
    this.M = new THREE.Matrix4(); this.E = new THREE.Euler(); this.V = new THREE.Vector3(); this.C = new THREE.Color();
  }
  Shards.prototype.emit = function (x, y, z, vx, vy, vz, size, life, r, g, b) {
    var i = this.n < this.max ? this.n++ : (RND() * this.max) | 0, o = i * HS, D = this.d;
    D[o] = x; D[o + 1] = y; D[o + 2] = z; D[o + 3] = vx; D[o + 4] = vy; D[o + 5] = vz;
    D[o + 6] = RND() * TAU; D[o + 7] = RND() * TAU; D[o + 8] = RND() * TAU;
    D[o + 9] = (RND() - 0.5) * 24; D[o + 10] = (RND() - 0.5) * 24; D[o + 11] = (RND() - 0.5) * 24;
    D[o + 12] = size; D[o + 13] = 0; D[o + 14] = life; D[o + 15] = r; D[o + 16] = g; D[o + 17] = b;
  };
  Shards.prototype.update = function (dt) {
    var D = this.d, n = this.n, i = 0, m = this.mesh, M = this.M, E = this.E, V = this.V, C = this.C;
    var ad = Math.exp(-0.5 * dt), gd = Math.exp(-7 * dt);
    while (i < n) {
      var o = i * HS;
      D[o + 13] += dt;
      if (D[o + 13] >= D[o + 14]) { n--; if (i < n) D.copyWithin(o, n * HS, n * HS + HS); continue; }
      D[o + 4] -= 9.81 * dt; D[o + 3] *= ad; D[o + 5] *= ad;
      D[o] += D[o + 3] * dt; D[o + 1] += D[o + 4] * dt; D[o + 2] += D[o + 5] * dt;
      D[o + 6] += D[o + 9] * dt; D[o + 7] += D[o + 10] * dt; D[o + 8] += D[o + 11] * dt;
      if (D[o + 1] < 0.012) {
        D[o + 1] = 0.012;
        if (D[o + 4] < -1) { D[o + 4] = -D[o + 4] * 0.3; D[o + 3] *= 0.6; D[o + 5] *= 0.6; D[o + 9] *= 0.5; D[o + 10] *= 0.5; D[o + 11] *= 0.5; }
        else {
          // leży: wytraca prędkość i układa się płasko
          D[o + 4] = 0; D[o + 3] *= gd; D[o + 5] *= gd; D[o + 9] *= gd; D[o + 10] *= gd; D[o + 11] *= gd;
          D[o + 6] *= gd; D[o + 8] *= gd;
        }
      }
      var s = D[o + 12] * Math.min(1, (D[o + 14] - D[o + 13]) / 0.6);
      E.set(D[o + 6], D[o + 7], D[o + 8]);
      M.makeRotationFromEuler(E); M.scale(V.set(s, s * 0.16, s * 0.65)); M.setPosition(D[o], D[o + 1], D[o + 2]);
      m.setMatrixAt(i, M);
      m.setColorAt(i, C.setRGB(D[o + 15], D[o + 16], D[o + 17]));
      i++;
    }
    this.n = n; m.count = n; m.visible = n > 0;
    if (n > 0) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  };
  Shards.prototype.clear = function () { this.n = 0; this.mesh.count = 0; this.mesh.visible = false; };
  Shards.prototype.dispose = function () { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); if (this.mesh.dispose) this.mesh.dispose(); };

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

  // ---------- ślady opon: bufor pierścieniowy czworokątów na asfalcie ----------
  function Skids(scene, max, mask) {
    this.max = max; this.k = 0; this.lo = -1; this.hi = -1; this.full = false;
    var g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 12); this.col = new Float32Array(max * 16);
    var uv = new Float32Array(max * 8), idx = new (max * 4 > 65535 ? Uint32Array : Uint16Array)(max * 6);
    for (var i = 0; i < max; i++) {
      var b = i * 4, o = i * 6;
      // trójkąty zwrócone w górę (widoczne z góry)
      idx[o] = b; idx[o + 1] = b + 2; idx[o + 2] = b + 1; idx[o + 3] = b; idx[o + 4] = b + 3; idx[o + 5] = b + 2;
      uv[i * 8] = 1; uv[i * 8 + 1] = 0; uv[i * 8 + 2] = 0; uv[i * 8 + 3] = 0; uv[i * 8 + 4] = 0; uv[i * 8 + 5] = 1; uv[i * 8 + 6] = 1; uv[i * 8 + 7] = 1;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('color', this.aCol); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setDrawRange(0, 0);
    this.mat = linBlend(new THREE.MeshBasicMaterial({ vertexColors: true, alphaMap: mask || null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  // Odcinek śladu od (x1,z1) do (x2,z2): szerokość w, krycie a1 → a2, kolor wg indeksu (MARK_RGB)
  Skids.prototype.add = function (x1, z1, x2, z2, w, a1, a2, ci) {
    var dx = x2 - x1, dz = z2 - z1, l = Math.sqrt(dx * dx + dz * dz);
    if (l < 0.05 || l > 8) return false;
    var nx = -dz / l * w * 0.5, nz = dx / l * w * 0.5, y = 0.04, i = this.k % this.max, P = this.pos, C = this.col, o = i * 12;
    P[o] = x1 + nx; P[o + 1] = y; P[o + 2] = z1 + nz;
    P[o + 3] = x1 - nx; P[o + 4] = y; P[o + 5] = z1 - nz;
    P[o + 6] = x2 - nx; P[o + 7] = y; P[o + 8] = z2 - nz;
    P[o + 9] = x2 + nx; P[o + 10] = y; P[o + 11] = z2 + nz;
    var c = MARK_RGB[ci] || MARK_RGB[0], q = i * 16;
    for (var j = 0; j < 4; j++) { C[q + j * 4] = c[0]; C[q + j * 4 + 1] = c[1]; C[q + j * 4 + 2] = c[2]; C[q + j * 4 + 3] = j < 2 ? a1 : a2; }
    this.k++;
    if (this.lo < 0) { this.lo = i; this.hi = i; } else if (i === this.hi + 1) this.hi = i; else this.full = true;
    return true;
  };
  // Raz na klatkę: wysyła zmienione czworokąty
  Skids.prototype.flush = function () {
    if (this.lo < 0) return;
    if (this.full) {
      if (this.aPos.clearUpdateRanges) { this.aPos.clearUpdateRanges(); this.aCol.clearUpdateRanges(); }
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true;
    } else {
      var c = this.hi - this.lo + 1;
      dirty(this.aPos, this.lo * 12, c * 12); dirty(this.aCol, this.lo * 16, c * 16);
    }
    this.geo.setDrawRange(0, Math.min(this.k, this.max) * 6);
    this.lo = this.hi = -1; this.full = false;
  };
  Skids.prototype.clear = function () { this.k = 0; this.lo = this.hi = -1; this.full = false; this.geo.setDrawRange(0, 0); };
  Skids.prototype.dispose = function () { if (this.mesh.parent) this.mesh.parent.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); };

  // Najniższy punkt prostopadłościanu (układ lokalny) po transformacji macierzą
  function lowestY(m, b) {
    var e = m.elements, mn = Infinity;
    for (var i = 0; i < 8; i++) {
      var x = (i & 1) ? b.max.x : b.min.x, y = (i & 2) ? b.max.y : b.min.y, z = (i & 4) ? b.max.z : b.min.z;
      var wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      if (wy < mn) mn = wy;
    }
    return mn;
  }

  // Czy postprocessing ma szansę ruszyć (WebGL2 + render do half float); sprawdzane raz, na osobnym płótnie
  var POST_CAN = null;
  function postLikely() {
    if (POST_CAN !== null) return POST_CAN;
    POST_CAN = false;
    try {
      var gl = document.createElement('canvas').getContext('webgl2');
      if (gl) {
        POST_CAN = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
        var lc = gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
      }
    } catch (e) { POST_CAN = false; }
    return POST_CAN;
  }

  // =====================================================================
  PG.View3D = function (canvas, T, R2D, opts) {
    opts = opts || {};
    var q = this.quality = opts.quality || 'high';
    var Q = this.fxq = FXQ[q] || FXQ.high;
    this.T = T; this.canvas = canvas;
    // MSAA płótna tylko bez postprocessingu (Post3D ma własny MSAA w buforze HDR)
    var aa = q !== 'low' && !(opts.post !== false && PG.Post3D && postLikely());
    var r = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: aa, powerPreference: 'high-performance', alpha: false, stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    // r159: światła fizyczne (useLegacyLights = false) są domyślne — natężenia świata są pod nie dobrane, nie ruszamy
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    // cienie: wysoka — miękkie PCF, średnia — PCF, niska — brak (zostają cienie kontaktowe bolidów)
    r.shadowMap.enabled = q !== 'low';
    r.shadowMap.type = q === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    var t0 = performance.now();
    var W3 = PG.World3D || PG.World3DLite;
    this.world = new W3(T, R2D, { quality: q, renderer: r });
    this.buildMs = performance.now() - t0;
    this.scene = this.world.scene;
    this.findLights();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.08, 3200);
    this.scene.add(this.camera);
    this.cars = new Map();
    this.debris = [];
    this.time = 0;
    this.fxOn = true;
    this.W = { fx: 1.6, rx: -1.9, fz: 0.8, rz: 0.79, r: 0.36 };
    this.wpx = new Float32Array(4); this.wpz = new Float32Array(4);
    this.st = { v: 0, steer: 0, drs: false, brake: 0, rain: false, lock: 0, lockSide: 0, wspin: 0, dmg: null, ground: 0 };
    this.tv = new THREE.Vector3(); this.tv2 = new THREE.Vector3(); this.tq = new THREE.Quaternion(); this.tc = new THREE.Color();
    this.v = new THREE.Vector3(); this.v2 = new THREE.Vector3();
    // efekty
    this.smokeTex = smokeAtlas();
    this.skidTex = skidMask();
    this.dust = new Dust(this.scene, Q.dust);
    this.smoke = new Smoke(this.scene, Q.smoke, this.smokeTex);
    this.sparks = new Sparks(this.scene, Q.sparks);
    this.shards = new Shards(this.scene, Q.shards);
    this.skids = new Skids(this.scene, Q.skids, this.skidTex);
    this.makeLine();
    this.makeMarker();
    this.makeTvCams();
    this.cam = { mode: 'chase', pos: new THREE.Vector3(), look: new THREE.Vector3(), hs: 0, fov: 60, init: false, tv: -1, shake: 0, vib: 0, kick: 0 };
    this.rs = 1; // skala rozdzielczości (adaptacyjna)
    this.size = null;
    this.post = null;
    this.initPost(opts.post !== false);
  };
  var V = PG.View3D.prototype;

  // Światła świata (do cieniowania dymu): najpierw pola świata, potem przeszukanie sceny
  V.findLights = function () {
    var w = this.world, self = this;
    this.sunLight = (w.sun && w.sun.isDirectionalLight) ? w.sun : null;
    this.hemiLight = (w.hemi && (w.hemi.isHemisphereLight || w.hemi.isAmbientLight)) ? w.hemi : null;
    if (!this.sunLight || !this.hemiLight) {
      this.scene.traverse(function (o) {
        if (!self.sunLight && o.isDirectionalLight) self.sunLight = o;
        if (!self.hemiLight && (o.isHemisphereLight || o.isAmbientLight)) self.hemiLight = o;
      });
    }
  };

  // ---------- postprocessing (opcjonalny, z awaryjnym powrotem do zwykłego renderowania) ----------
  V.initPost = function (on) {
    this.post = null;
    if (!on || !PG.Post3D) return;
    try {
      var p = new PG.Post3D(this.renderer, { quality: this.quality });
      if (p && p.ok) {
        this.post = p;
        // mgłę i tło dla bufora HDR dobiera już świat (scene.onBeforeRender) — bez podwójnej pracy
        var sc = this.world && this.world.scene;
        if (p.params && sc && Object.prototype.hasOwnProperty.call(sc, 'onBeforeRender')) p.params.fogMatch = false;
        if (this.size) p.setSize(this.size.w, this.size.h, this.size.dpr);
      } else if (p && p.dispose) { try { p.dispose(); } catch (e2) { /* nic */ } }
    } catch (e) { console.warn('Post3D wyłączony:', e); this.post = null; }
  };
  V.killPost = function (err) {
    var p = this.post; this.post = null;
    if (err) console.warn('Post3D wyłączony:', err);
    if (p && p.dispose) { try { p.dispose(); } catch (e) { /* nic */ } }
    try { this.renderer.setRenderTarget(null); } catch (e2) { /* nic */ }
  };
  // Włączenie/wyłączenie postprocessingu w trakcie gry (np. z menu ustawień)
  V.setPost = function (on) {
    if (!!on === !!this.post) return;
    if (on) this.initPost(true); else this.killPost();
  };

  V.resize = function (w, h, dpr) {
    this.size = { w: w, h: h, dpr: dpr };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.dust.mat.uniforms.uScale.value = h * dpr * 0.9;
    if (this.post) { try { this.post.setSize(w, h, dpr); } catch (e) { this.killPost(e); } }
  };

  // ---------- bolidy ----------
  V.carKey = function (c) { return JSON.stringify(c.team.livery) + '|' + JSON.stringify(c.driver.helmet || {}) + '|' + c.compound; };

  // Usuwa modele bolidów ze sceny (bez przerywania przy błędzie modułu Car3D)
  V.dropCars = function () {
    var self = this, C3 = PG.Car3D;
    this.cars.forEach(function (rec) {
      self.scene.remove(rec.root);
      rec.models.forEach(function (m) { try { if (C3 && C3.dispose) C3.dispose(m); } catch (e) { /* nic */ } });
    });
    this.cars.clear();
  };

  // Buduje modele dla bolidów sesji (jeden model dla wszystkich, różni się tylko malowaniem)
  V.setSession = function (S) {
    var self = this;
    this.clearDebris();
    this.dropCars();
    this.cars.clear();
    this.dust.clear(); this.sparks.clear(); this.smoke.clear(); this.shards.clear(); this.skids.clear();
    if (this.rl) this.rl.reset();
    var q = this.quality;
    S.cars.forEach(function (c) {
      var comp = PG.TYRES[c.compound] ? PG.TYRES[c.compound].color : '#ffffff';
      var o = { compound: comp, number: String(c.driver.num || '') };
      var root = new THREE.Group(), body = new THREE.Group(), models = [];
      // 'high' tylko na wysokiej jakości (lakier bezbarwny na 20 bolidach jest drogi); niżej 'medium'
      var lod = PG.Car3D.build(c.team.livery, c.driver.helmet, { quality: q === 'high' ? 'high' : 'medium', compound: o.compound, number: o.number });
      models.push(lod);
      body.add(lod); root.add(body);
      self.scene.add(root);
      var lv = new THREE.Color(0x777777);
      try { if (c.team && c.team.livery && c.team.livery.primary) lv.set(c.team.livery.primary); } catch (e) { /* zostaje szary */ }
      self.cars.set(c, {
        root: root, body: body, lod: lod, models: models, lastV: c.v, acc: 0, pitch: 0, roll: 0,
        mk: new Float32Array(16), mon: new Uint8Array(4), mci: new Uint8Array(4), em: new Float32Array(12),
        wallT: -9, hitT: -9, lv: lv, ph: RND() * 100
      });
    });
    this.world.setWeather(S.env);
    this.cam.init = false; this.cam.tv = -1;
    this.S = S;
  };

  V.syncCars = function (S, dt) {
    var wet = !!(S.env && S.env.wet), cam = this.camera.position, st = this.st, C3 = PG.Car3D, W = this.W;
    var W0 = C3 && C3.WHEELS;
    W.fx = num(W0 && W0.fx, 1.6); W.rx = num(W0 && W0.rx, -1.9); W.fz = num(W0 && W0.fz, 0.8); W.rz = num(W0 && W0.rz, 0.79); W.r = num(W0 && W0.r, 0.36);
    for (var ci = 0; ci < S.cars.length; ci++) {
      var c = S.cars[ci], rec = this.cars.get(c);
      if (!rec) continue;
      var root = rec.root;
      root.position.set(c.x, 0, c.y);
      root.rotation.y = -c.h;
      root.visible = !(c.ghost > 0 && Math.floor(c.ghost * 10) % 2) && !c.hidden3d;
      // przechył i nurkowanie (+ osiadanie na uszkodzonym zawieszeniu)
      var a = dt > 0 ? (c.v - rec.lastV) / dt : 0; rec.lastV = c.v;
      if (!isFinite(a)) a = 0;
      rec.acc += (Math.max(-60, Math.min(30, a)) - rec.acc) * damp(8, dt);
      var pitchT = Math.max(-0.03, Math.min(0.02, rec.acc * 0.0007));
      var rollT = Math.max(-0.025, Math.min(0.025, -(c.latAcc || 0) * 0.0006));
      rec.pitch += (pitchT - rec.pitch) * damp(10, dt); rec.roll += (rollT - rec.roll) * damp(10, dt);
      var d = c.dmg, sagR = 0, sagP = 0;
      if (d) {
        sagR = 0.011 * ((num(d.suspFR, 0) + num(d.suspRR, 0)) - (num(d.suspFL, 0) + num(d.suspRL, 0)));
        sagP = -0.006 * (num(d.suspFL, 0) + num(d.suspFR, 0)) + 0.004 * (num(d.suspRL, 0) + num(d.suspRR, 0));
      }
      rec.body.rotation.z = rec.pitch + sagP; rec.body.rotation.x = rec.roll + sagR;
      // drgania na krawężnikach i poza torem
      var av = Math.abs(c.v || 0);
      var bump = (c.surface === 'kerb' ? 0.012 : c.surface === 'grass' || c.surface === 'gravel' ? 0.02 : 0) * Math.min(1, av / 20);
      if (dt > 0) rec.ph += dt;
      rec.body.position.y = bump ? bump * 0.5 * (Math.sin(rec.ph * 71) * 0.6 + Math.sin(rec.ph * 113 + 1.3) * 0.4) : 0;
      // stan dla modelu: koła (blokada, buksowanie), DRS, uszkodzenia
      st.v = num(c.v, 0); st.steer = num(c.steer, 0); st.drs = !!c.drsOpen; st.brake = num(c.brake, 0); st.rain = wet;
      st.lock = num(c.lock, 0); st.lockSide = num(c.lockSide, 0); st.wspin = num(c.wspin, 0); st.dmg = c.dmg || null;
      st.ground = c.surface === 'kerb' ? 0.05 : 0; // cień kontaktowy nad krawężnikiem
      for (var m = 0; m < rec.models.length; m++) {
        try {
          if (C3.setDamage) C3.setDamage(rec.models[m], st.dmg);
          C3.update(rec.models[m], st, dt);
        } catch (e) { if (!this.c3err) { this.c3err = true; console.warn('Car3D.update:', e); } }
      }
      if (this.fxOn && dt > 0) {
        var dx = c.x - cam.x, dz = c.y - cam.z;
        try { this.carFx(c, rec, dt, wet, root.visible && dx * dx + dz * dz < 380 * 380); }
        catch (e2) { this.fxFail(e2); }
      }
    }
  };

  // Ile cząstek wyemitować w tej klatce (akumulator ułamków, limit na klatkę)
  function take(acc, k, rate, dt, cap) {
    if (!(rate > 0)) { acc[k] = RND() * 0.5; return 0; }
    var a = acc[k] + rate * dt, n = Math.floor(a);
    acc[k] = a - n;
    return n > cap ? cap : n;
  }

  // Ślad koła k: ciągły pas z płynnym pojawianiem się i wygaszaniem (a ≤ 0 kończy ślad)
  V.mark = function (rec, k, x, z, a, w, ci) {
    var M = rec.mk, o = k * 4, on = a > 0.01;
    if (rec.mon[k]) {
      var dx = x - M[o], dz = z - M[o + 1], l2 = dx * dx + dz * dz;
      if (l2 > 64) { rec.mon[k] = 0; if (!on) return; }
      else {
        if (on && ci === rec.mci[k]) {
          if (l2 < 0.16) return; // czekamy na odcinek ≥ 0,4 m
          this.skids.add(M[o], M[o + 1], x, z, w, M[o + 2], a, ci);
          M[o] = x; M[o + 1] = z; M[o + 2] = a; M[o + 3] = w;
          return;
        }
        // koniec śladu (albo zmiana nawierzchni): wygaszenie ostatniego odcinka
        if (l2 > 0.0025) this.skids.add(M[o], M[o + 1], x, z, M[o + 3], M[o + 2], 0, rec.mci[k]);
        rec.mon[k] = 0;
        if (!on) return;
      }
    } else if (!on) return;
    rec.mon[k] = 1; rec.mci[k] = ci; M[o] = x; M[o + 1] = z; M[o + 2] = 0; M[o + 3] = w;
  };

  // Kłąb dymu opony z łaty styku (x, z); I = intensywność, lat = strona koła (±1), kick = wyrzut do tyłu
  V.tyreSmoke = function (x, z, vx, vz, ch, sh, I, lat, kick, dt, aMul, sMul) {
    var back = RND() * dt, k = 0.22 + RND() * 0.2, out = 0.3 + RND() * 0.6, Q = this.fxq;
    var lx = -sh * lat, lz = ch * lat, gc = 0.84 + RND() * 0.07;
    var aB = (1 + (1 - Q.em) * 0.6) * (aMul || 1), sB = sMul || 1;
    this.smoke.emit(
      x - vx * back - ch * 0.15 + (RND() - 0.5) * 0.3, 0.15 + RND() * 0.12, z - vz * back - sh * 0.15 + (RND() - 0.5) * 0.3,
      vx * k + lx * out - ch * kick + (RND() - 0.5) * 0.8, 0.3 + RND() * 0.55, vz * k + lz * out - sh * kick + (RND() - 0.5) * 0.8,
      1.9 + I * 1.5 + RND() * 0.7,
      (0.3 + I * 0.15) * sB, (1.9 + I * 1.4 + RND() * 0.8) * sB,
      Math.min(0.78, (0.22 + I * 0.36) * aB),
      gc, gc + 0.005, gc + 0.02, 0.28, 0.45 + RND() * 0.3, 1.3 + RND() * 0.5);
  };

  // Efekty spod kół i z uszkodzonego bolidu
  V.carFx = function (c, rec, dt, wet, near) {
    var Q = this.fxq, em = Q.em, W = this.W, acc = rec.em;
    var v = num(c.v, 0), av = v < 0 ? -v : v, h = c.h, ch = Math.cos(h), sh = Math.sin(h);
    var psi = h + num(c.beta, 0), vx = Math.cos(psi) * v, vz = Math.sin(psi) * v;
    var surf = c.surface, tar = surf === 'asphalt' || surf === 'kerb' || surf === 'runoff' || surf === undefined;
    var lock = c01(num(c.lock, 0)), side = clamp(num(c.lockSide, 0), -1, 1), spin = c01(num(c.wspin, 0));
    var beta = Math.abs(num(c.beta, 0)), skid = c01(num(c.skid, 0));
    var lockL = lock * c01(1 - side), lockR = lock * c01(1 + side);
    var slide = av > 8 ? c01((beta - 0.05) / 0.16) : 0;
    var scrub = tar && av > 10 ? c01(skid - Math.max(lock * 0.9, spin * 0.75, beta * 3.5)) : 0;
    var fx = W.fx, rx = W.rx, fz = W.fz, rz = W.rz;
    var X = this.wpx, Z = this.wpz;
    // łaty styku kół w świecie: przód lewy (−Z), przód prawy (+Z), tył lewy, tył prawy
    X[0] = c.x + ch * fx + sh * fz; Z[0] = c.y + sh * fx - ch * fz;
    X[1] = c.x + ch * fx - sh * fz; Z[1] = c.y + sh * fx + ch * fz;
    X[2] = c.x + ch * rx + sh * rz; Z[2] = c.y + sh * rx - ch * rz;
    X[3] = c.x + ch * rx - sh * rz; Z[3] = c.y + sh * rx + ch * rz;

    // --- ślady opon ---
    var onRub = tar && av > 2.5;
    var mF0 = onRub && lockL > 0.2 ? Math.min(0.62, 0.18 + lockL * 0.5) : 0;
    var mF1 = onRub && lockR > 0.2 ? Math.min(0.62, 0.18 + lockR * 0.5) : 0;
    if (onRub && scrub > 0.45) { mF0 = Math.max(mF0, scrub * 0.16); mF1 = Math.max(mF1, scrub * 0.16); }
    var mR = onRub ? Math.min(0.58, Math.max(spin > 0.2 ? 0.2 + spin * 0.4 : 0, slide > 0.15 ? slide * 0.55 : 0)) : 0, ciR = 0;
    if ((surf === 'gravel' || surf === 'grass') && av > 3) { ciR = surf === 'gravel' ? 1 : 2; mR = surf === 'gravel' ? 0.35 : 0.26; }
    this.mark(rec, 0, X[0], Z[0], mF0, 0.3, 0);
    this.mark(rec, 1, X[1], Z[1], mF1, 0.3, 0);
    this.mark(rec, 2, X[2], Z[2], mR, 0.4, ciR);
    this.mark(rec, 3, X[3], Z[3], mR, 0.4, ciR);
    if (!near) return;

    var wetK = wet ? 0.3 : 1, n, j, I;
    // --- dym z zablokowanych przednich kół ---
    var sf = 0.15 + 0.85 * c01((av - 3) / 22);
    for (var w = 0; w < 2; w++) {
      I = w ? lockR : lockL;
      n = take(acc, w, (tar && I > 0.12 && av > 3) ? em * 52 * Math.pow(I, 1.2) * sf * wetK : 0, dt, 5);
      for (j = 0; j < n; j++) this.tyreSmoke(X[w], Z[w], vx, vz, ch, sh, I, w ? 1 : -1, 0, dt, wet ? 0.6 : 1, 1);
    }
    // --- buksowanie tylnych kół ---
    for (w = 2; w < 4; w++) {
      n = take(acc, w, (tar && spin > 0.12) ? em * 55 * (spin - 0.1) * (0.55 + 0.45 * c01(av / 20)) * wetK : 0, dt, 5);
      for (j = 0; j < n; j++) this.tyreSmoke(X[w], Z[w], vx, vz, ch, sh, spin, w === 3 ? 1 : -1, 1.5 + 3 * spin, dt, wet ? 0.6 : 1, 1.1);
    }
    // --- poślizg tyłu i szorowanie przodu (podsterowność) ---
    n = take(acc, 4, tar && slide > 0 ? em * 30 * slide * wetK : 0, dt, 4);
    for (j = 0; j < n; j++) { w = RND() < 0.5 ? 2 : 3; this.tyreSmoke(X[w], Z[w], vx, vz, ch, sh, slide * 0.8, w === 3 ? 1 : -1, 0, dt, 0.7, 1); }
    n = take(acc, 5, scrub > 0.3 ? em * 10 * scrub * wetK : 0, dt, 2);
    for (j = 0; j < n; j++) { w = RND() < 0.5 ? 0 : 1; this.tyreSmoke(X[w], Z[w], vx, vz, ch, sh, scrub * 0.5, w ? 1 : -1, 0, dt, 0.5, 0.8); }
    // --- płaskie miejsca na oponach: drobne obłoczki gumy ---
    var flat = c01(num(c.flat, 0));
    n = take(acc, 6, (tar && flat > 0.12 && av > 15) ? em * 5 * flat * wetK : 0, dt, 1);
    for (j = 0; j < n; j++) { w = RND() < 0.5 ? 0 : 1; this.tyreSmoke(X[w], Z[w], vx, vz, ch, sh, 0.15, w ? 1 : -1, 0, dt, 0.45 + flat * 0.4, 0.5); }
    // --- dym z uszkodzonego silnika ---
    var d = c.dmg, eng = d ? num(d.engine, 0) : 0;
    if (eng > 0.4) {
      var e = c01((eng - 0.4) / 0.6);
      n = take(acc, 7, em * (8 + 24 * e) * (av < 1 ? 0.6 : 1), dt, 4);
      for (j = 0; j < n; j++) {
        var back = RND() * dt, gcol = 0.42 - 0.24 * e + RND() * 0.05, ex = -2.25 + (RND() - 0.5) * 0.3, ez = (RND() - 0.5) * 0.25;
        this.smoke.emit(c.x + ch * ex - sh * ez - vx * back, 0.85 + RND() * 0.15, c.y + sh * ex + ch * ez - vz * back,
          vx * 0.3 - ch + (RND() - 0.5) * 0.6, 0.7 + RND() * 0.5, vz * 0.3 - sh + (RND() - 0.5) * 0.6,
          2.2 + e + RND() * 0.6, 0.22, 1.3 + 1.3 * e, 0.22 + 0.25 * e, gcol, gcol, gcol + 0.02, 0.45, 0.9, 1.1);
      }
    } else acc[7] = 0;
    // --- iskry spod podłogi (płozy przy dużej prędkości, uszkodzona podłoga) ---
    var fl = d ? num(d.floor, 0) : 0, kerb = surf === 'kerb';
    var rate = 0;
    if (Q.block && av > 68) rate += (kerb ? 14 : 1.5) * c01((av - 68) / 22);
    if (fl > 0.25) rate += 50 * (fl - 0.25) * c01((av - 20) / 40) * (kerb ? 2 : 1) * (num(c.brake, 0) > 0.5 ? 1.5 : 1);
    n = take(acc, 8, wet ? rate * 0.3 : rate * Math.max(0.5, em), dt, 6);
    for (j = 0; j < n; j++) {
      var bk = RND() * dt, lx2 = -1.6 + RND() * 2.2, lz2 = (RND() - 0.5) * 1.0, kk = 0.35 + RND() * 0.35;
      this.sparks.emit(c.x + ch * lx2 - sh * lz2 - vx * bk, 0.04, c.y + sh * lx2 + ch * lz2 - vz * bk,
        vx * kk + (RND() - 0.5) * 2.5, 0.4 + RND() * 2.2, vz * kk + (RND() - 0.5) * 2.5, 0.25 + RND() * 0.35, 0.022, 1, 1);
    }
    // --- pył ze żwiru i trawy (jak dawniej) ---
    var rx0 = c.x - ch * 1.9, rz0 = c.y - sh * 1.9;
    if ((surf === 'gravel' || surf === 'grass') && av > 4) {
      var gr = surf === 'gravel';
      n = take(acc, 9, em * 60, dt, 4);
      for (j = 0; j < n; j++) this.dust.add(rx0 + (RND() - 0.5) * 1.6, 0.3, rz0 + (RND() - 0.5) * 1.6, -ch * av * 0.15 + (RND() - 0.5) * 3, 1 + RND() * 2, -sh * av * 0.15 + (RND() - 0.5) * 3, 1.2 + RND(), gr ? 0.78 : 0.42, gr ? 0.7 : 0.5, gr ? 0.55 : 0.3, 0.55, 1.1, 2.5, 1.2, 0.4);
    } else acc[9] = 0;
    // --- mgiełka wodna w deszczu ---
    if (wet && av > 18) {
      n = take(acc, 10, em * (av > 50 ? 100 : 33), dt, 5);
      for (j = 0; j < n; j++) this.dust.add(rx0 - ch * 0.8 + (RND() - 0.5) * 1.6, 0.35 + RND() * 0.4, rz0 - sh * 0.8 + (RND() - 0.5) * 1.6, ch * av * 0.55 + (RND() - 0.5) * 3, 0.8 + RND() * 1.5, sh * av * 0.55 + (RND() - 0.5) * 3, 0.9 + RND() * 0.6, 0.82, 0.85, 0.9, 0.28, 1.6, 3.5, 2.2, 0.3);
    } else acc[10] = 0;
  };

  V.fxFail = function (e) {
    if (!this.fxOn) return;
    this.fxOn = false;
    console.warn('Efekty 3D wyłączone po błędzie:', e);
    try { this.smoke.clear(); this.sparks.clear(); this.shards.clear(); this.dust.clear(); } catch (e2) { /* nic */ }
  };

  // ---------- zdarzenia sesji (game.js przekazuje każde zdarzenie) ----------
  V.event = function (e) {
    if (!e || !e.type || !this.fxOn) return;
    try {
      switch (e.type) {
        case 'wall': this.evWall(e); break;
        case 'hit': this.evHit(e); break;
        case 'damage': this.evDamage(e); break;
        case 'detach': this.evDetach(e); break;
        case 'lockup': this.evLock(e); break;
      }
    } catch (err) {
      if (!this.evErr) { this.evErr = true; console.warn('View3D.event:', err); }
    }
  };

  // Snop iskier w punkcie (x, z) z prędkością bazową (vx, vz)
  V.sparkBurst = function (x, y, z, n, vx, vz, spread, nx, nz) {
    var S = this.sparks;
    for (var i = 0; i < n; i++) {
      var k = 0.35 + RND() * 0.45, out = 1 + RND() * 3;
      S.emit(x + (RND() - 0.5) * 0.3, y + RND() * 0.25, z + (RND() - 0.5) * 0.3,
        vx * k - (nx || 0) * out + (RND() - 0.5) * spread, 0.6 + RND() * 4, vz * k - (nz || 0) * out + (RND() - 0.5) * spread,
        0.25 + RND() * 0.5, 0.018 + RND() * 0.012, 0.75 + RND() * 0.25, 1);
    }
  };
  // Mały obłok (pył, guma, dym) w punkcie
  V.puff = function (x, y, z, n, vx, vz, g, a, s1, life) {
    for (var i = 0; i < n; i++) {
      this.smoke.emit(x + (RND() - 0.5) * 0.6, y + RND() * 0.2, z + (RND() - 0.5) * 0.6,
        vx * (0.2 + RND() * 0.2) + (RND() - 0.5) * 1.6, 0.4 + RND() * 0.8, vz * (0.2 + RND() * 0.2) + (RND() - 0.5) * 1.6,
        life * (0.8 + RND() * 0.4), 0.25, s1 * (0.8 + RND() * 0.4), a, g, g, g + 0.02, 0.3, 0.4, 1.6);
    }
  };

  V.evWall = function (e) {
    var c = e.car, f = num(e.force, 0);
    if (!c || f < 5) return;
    var rec = this.cars.get(c);
    if (rec) { if (this.time - rec.wallT < 0.07) return; rec.wallT = this.time; }
    var nx = num(c.wallNx, 0), nz = num(c.wallNy, 0), ps = c.h + num(c.beta, 0), v = num(c.v, 0);
    var vx = Math.cos(ps) * v, vz = Math.sin(ps) * v, px = c.x + nx * 0.95, pz = c.y + nz * 0.95;
    var n = Math.round(Math.min(40, 8 + f * 1.5) * Math.max(0.5, this.fxq.em));
    this.sparkBurst(px, 0.25, pz, n, vx, vz, 5, nx, nz);
    if (f > 8) this.puff(px, 0.3, pz, f > 15 ? 3 : 2, vx, vz, 0.7, 0.28, 1.6, 1.3);
  };
  V.evHit = function (e) {
    var f = num(e.force, 0);
    if (f < 3 || !isFinite(e.x) || !isFinite(e.y)) return;
    var a = e.a, b = e.b, rec = a && this.cars.get(a);
    if (rec) { if (this.time - rec.hitT < 0.08) return; rec.hitT = this.time; }
    var vx = 0, vz = 0, k = 0;
    if (a) { vx += Math.cos(a.h) * num(a.v, 0); vz += Math.sin(a.h) * num(a.v, 0); k++; }
    if (b) { vx += Math.cos(b.h) * num(b.v, 0); vz += Math.sin(b.h) * num(b.v, 0); k++; }
    if (k) { vx /= k; vz /= k; }
    var n = Math.round(Math.min(26, 4 + f * 1.5) * Math.max(0.5, this.fxq.em));
    this.sparkBurst(e.x, 0.3, e.y, n, vx, vz, 6, 0, 0);
    if (f > 8) this.puff(e.x, 0.3, e.y, 2, vx, vz, 0.72, 0.25, 1.4, 1.2);
  };
  // Punkt części bolidu w świecie → this.v
  V.partPos = function (c, part) {
    var L = PART_LOC[part] || PART_LOC.floor, ch = Math.cos(c.h), sh = Math.sin(c.h);
    return this.v.set(c.x + ch * L[0] - sh * L[2], L[1], c.y + sh * L[0] + ch * L[2]);
  };
  V.evDamage = function (e) {
    var c = e.car;
    if (!c || !isFinite(c.x)) return;
    var dl = Math.max(0, num(e.level, 0) - num(e.prev, 0)), f = num(e.force, 0), part = String(e.part || 'floor');
    var p = this.partPos(c, part), px = p.x, py = p.y, pz = p.z;
    // punkt uderzenia (gdy blisko) przesuwa źródło odłamków
    if (isFinite(e.x) && isFinite(e.y)) {
      var dx = e.x - px, dz = e.y - pz;
      if (dx * dx + dz * dz < 16) { px += dx * 0.5; pz += dz * 0.5; }
    }
    var ps = c.h + num(c.beta, 0), v = num(c.v, 0), vx = Math.cos(ps) * v, vz = Math.sin(ps) * v;
    var rec = this.cars.get(c), lv = rec ? rec.lv : null;
    var n = Math.round(clamp(4 + dl * 26 + f * 0.25, 3, 22) * Math.max(0.4, this.fxq.em));
    if (part === 'engine') n = Math.round(n * 0.3);
    for (var i = 0; i < n; i++) {
      var k = 0.4 + RND() * 0.5, paint = lv && RND() < 0.35;
      this.shards.emit(px + (RND() - 0.5) * 0.4, py + RND() * 0.2, pz + (RND() - 0.5) * 0.4,
        vx * k + (RND() - 0.5) * 8, 1 + RND() * 3.5, vz * k + (RND() - 0.5) * 8,
        0.04 + RND() * 0.07, 5 + RND() * 4,
        paint ? lv.r : 0.018, paint ? lv.g : 0.018, paint ? lv.b : 0.021);
    }
    if (part === 'engine') this.puff(c.x - Math.cos(c.h) * 2.2, 0.8, c.y - Math.sin(c.h) * 2.2, 4, vx, vz, 0.3, 0.45, 2.2, 2.4);
    else this.puff(px, Math.max(0.15, py), pz, part === 'floor' || part.indexOf('susp') === 0 ? 3 : 2, vx, vz, 0.66, 0.24, 1.5, 1.4);
    if (f > 6 && part !== 'engine') this.sparkBurst(px, py, pz, Math.round(Math.min(14, f * 0.6)), vx, vz, 4, 0, 0);
  };
  V.evDetach = function (e) {
    var c = e.car;
    if (!c || !isFinite(c.x)) return;
    this.spawnDebris(e);
    var p = this.partPos(c, e.part), v = num(c.v, 0);
    this.sparkBurst(p.x, p.y, p.z, 8, Math.cos(c.h) * v, Math.sin(c.h) * v, 4, 0, 0);
  };
  // Początek blokady: krótki „ugryziony" kłąb przy kole
  V.evLock = function (e) {
    var c = e.car;
    if (!c || !isFinite(c.x)) return;
    var dx = c.x - this.camera.position.x, dz = c.y - this.camera.position.z;
    if (dx * dx + dz * dz > 200 * 200) return;
    var side = clamp(num(c.lockSide, 0), -1, 1), ch = Math.cos(c.h), sh = Math.sin(c.h), v = num(c.v, 0), W = this.W;
    var wet = !!(this.S && this.S.env && this.S.env.wet);
    for (var w = 0; w < 2; w++) {
      var s = w ? 1 : -1, wt = c01(1 + s * side);
      if (wt < 0.3) continue;
      var x = c.x + ch * W.fx - sh * W.fz * s, z = c.y + sh * W.fx + ch * W.fz * s;
      for (var j = 0; j < 2; j++) this.tyreSmoke(x, z, ch * v, sh * v, ch, sh, 0.5 * wt, s, 0, 0.016, wet ? 0.5 : 0.9, 0.8);
    }
  };

  // Zgodność wstecz: iskry w punkcie (stary interfejs)
  V.sparksAt = function (x, z, force, vx, vz) {
    if (!this.fxOn) return;
    try {
      var f = num(force, 5);
      this.sparkBurst(x, 0.3, z, Math.round(Math.min(40, 6 + f * 2)), num(vx, 0), num(vz, 0), 6, 0, 0);
      this.puff(x, 0.3, z, 2, num(vx, 0), num(vz, 0), 0.7, 0.25, 1.5, 1.2);
    } catch (e) { this.fxFail(e); }
  };

  // ---------- odłamki części (Car3D.detach): lot, koziołkowanie, odbicia, poślizg, spoczynek ----------
  V.spawnDebris = function (e) {
    var c = e.car, rec = c && this.cars.get(c), C3 = PG.Car3D;
    if (!rec || !rec.lod || !C3 || !C3.detach) return;
    if (C3.setDamage && c.dmg) C3.setDamage(rec.lod, c.dmg);
    var obj = C3.detach(rec.lod, e.part);
    if (!obj) return;
    // bieżące położenie bolidu (zdarzenie przychodzi przed klatką)
    rec.root.position.set(c.x, 0, c.y); rec.root.rotation.y = -c.h;
    rec.lod.updateWorldMatrix(true, false);
    // prostopadłościan części w jej własnym układzie
    var p0 = obj.position.clone(), q0 = obj.quaternion.clone(), s0 = obj.scale.clone();
    obj.position.set(0, 0, 0); obj.quaternion.set(0, 0, 0, 1); obj.scale.set(1, 1, 1);
    obj.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty() || !isFinite(box.min.x) || !isFinite(box.max.y)) box.set(new THREE.Vector3(-0.3, -0.05, -0.3), new THREE.Vector3(0.3, 0.05, 0.3));
    var sz = box.getSize(new THREE.Vector3());
    var thin = new THREE.Vector3(sz.x <= sz.y && sz.x <= sz.z ? 1 : 0, sz.y < sz.x && sz.y <= sz.z ? 1 : 0, sz.z < sz.x && sz.z < sz.y ? 1 : 0);
    if (thin.lengthSq() < 0.5) thin.set(0, 1, 0);
    obj.position.copy(p0); obj.quaternion.copy(q0); obj.scale.copy(s0); obj.updateMatrix();
    var M = new THREE.Matrix4().multiplyMatrices(rec.lod.matrixWorld, obj.matrix);
    M.decompose(obj.position, obj.quaternion, obj.scale);
    obj.matrixAutoUpdate = true;
    this.scene.add(obj);
    var sp = Math.abs(num(c.v, 0)), k = 0.55 + RND() * 0.3;
    var vx = num(e.vx, Math.cos(c.h) * num(c.v, 0)), vz = num(e.vy, Math.sin(c.h) * num(c.v, 0));
    var spin = 4 + RND() * 6 + Math.min(10, sp * 0.15);
    var w = new THREE.Vector3(RND() - 0.5, RND() - 0.5, RND() - 0.5);
    if (w.lengthSq() < 1e-4) w.set(1, 0, 0);
    w.normalize().multiplyScalar(spin);
    this.debris.push({
      o: obj, box: box, thin: thin, w: w, age: 0, rest: 0, sleep: false, sink: 0,
      vel: new THREE.Vector3(vx * k + (RND() - 0.5) * 3, 1.5 + RND() * 2.5 + Math.min(3, sp / 25), vz * k + (RND() - 0.5) * 3)
    });
    var cap = this.fxq.debris;
    while (this.debris.length > cap) this.removeDebris(0);
  };
  V.removeDebris = function (k) {
    var d = this.debris[k];
    if (d && d.o.parent) d.o.parent.remove(d.o);
    this.debris.splice(k, 1);
  };
  V.clearDebris = function () { while (this.debris.length) this.removeDebris(this.debris.length - 1); };
  V.updateDebris = function (dt) {
    var L = this.debris, cam = this.camera.position, tq = this.tq, tv = this.tv, tv2 = this.tv2;
    if (!L.length || !(dt > 0)) return;
    for (var k = L.length - 1; k >= 0; k--) {
      var d = L[k], o = d.o;
      d.age += dt;
      if (d.age > 25) {
        // po ~25 s: daleko — znika od razu, blisko — zapada się w nawierzchnię
        var dx = o.position.x - cam.x, dz = o.position.z - cam.z;
        if (d.sink === 0 && dx * dx + dz * dz > 90 * 90) { this.removeDebris(k); continue; }
        d.sink += dt; o.position.y -= dt * 0.35; o.updateMatrix();
        if (d.sink > 1.5) this.removeDebris(k);
        continue;
      }
      if (d.sleep) continue;
      var v = d.vel, w = d.w;
      v.y -= 9.81 * dt;
      var ad = Math.exp(-0.25 * dt); v.x *= ad; v.z *= ad;
      o.position.x += v.x * dt; o.position.y += v.y * dt; o.position.z += v.z * dt;
      var wl = w.length();
      if (wl > 1e-4) { tq.setFromAxisAngle(tv.copy(w).divideScalar(wl), wl * dt); o.quaternion.premultiply(tq); }
      o.updateMatrix();
      var minY = lowestY(o.matrix, d.box);
      if (minY < 0) {
        o.position.y -= minY;
        if (v.y < -1.5) {
          // odbicie: utrata energii, nowy losowy obrót, iskry przy szybkim uderzeniu
          var hs0 = Math.sqrt(v.x * v.x + v.z * v.z);
          v.y = -v.y * 0.3; v.x *= 0.7; v.z *= 0.7;
          w.multiplyScalar(0.6); w.x += (RND() - 0.5) * 4; w.z += (RND() - 0.5) * 4;
          if (hs0 > 8) this.sparkBurst(o.position.x, 0.05, o.position.z, 4, v.x, v.z, 3, 0, 0);
        } else {
          if (v.y < 0) v.y = 0;
          var hs = Math.sqrt(v.x * v.x + v.z * v.z), fr = 6 * dt;
          if (hs > fr) { v.x -= v.x / hs * fr; v.z -= v.z / hs * fr; } else { v.x = 0; v.z = 0; }
          w.multiplyScalar(Math.exp(-6 * dt));
          // układa się na płask (najcieńsza oś pionowo)
          tv.copy(d.thin).applyQuaternion(o.quaternion);
          tv2.set(0, tv.y >= 0 ? 1 : -1, 0);
          tq.setFromUnitVectors(tv, tv2).multiply(o.quaternion);
          o.quaternion.slerp(tq, 1 - Math.exp(-5 * dt));
          if (hs < 0.2 && wl < 0.3) {
            d.rest += dt;
            if (d.rest > 0.8) {
              d.sleep = true;
              o.updateMatrix();
              o.position.y -= lowestY(o.matrix, d.box) - 0.004;
              o.updateMatrix(); o.matrixAutoUpdate = false;
            }
          } else d.rest = 0;
        }
        o.updateMatrix();
      }
    }
  };

  // ---------- linia wyścigowa: wstęga przed graczem, kolor wg prędkości ----------
  V.makeLine = function () {
    this.lineMesh = null;
    if (!PG.RacingLine || !PG.lineRGB) return;
    var rl = this.rl = new PG.RacingLine(this.T), cap = rl.cap, k;
    var g = this.lineGeo = new THREE.BufferGeometry();
    this.lPos = new THREE.BufferAttribute(new Float32Array(cap * 6), 3).setUsage(THREE.DynamicDrawUsage);
    this.lCol = new THREE.BufferAttribute(new Float32Array(cap * 8), 4).setUsage(THREE.DynamicDrawUsage);
    this.lUv = new THREE.BufferAttribute(new Float32Array(cap * 4), 2).setUsage(THREE.DynamicDrawUsage);
    var idx = new Uint16Array((cap - 1) * 6), uv = this.lUv.array;
    for (k = 0; k < cap - 1; k++) {
      var a = 2 * k, o = k * 6;
      // A = lewa krawędź (+n), B = prawa; trójkąty zwrócone w górę
      idx[o] = a; idx[o + 1] = a + 3; idx[o + 2] = a + 1; idx[o + 3] = a; idx[o + 4] = a + 2; idx[o + 5] = a + 3;
    }
    for (k = 0; k < cap; k++) { uv[k * 4] = 0; uv[k * 4 + 2] = 1; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', this.lPos); g.setAttribute('color', this.lCol); g.setAttribute('uv', this.lUv);
    g.setDrawRange(0, 0);
    var tex = this.lineTex = lineMask();
    try { tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy()); } catch (e) { /* nic */ }
    this.lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, alphaMap: tex, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6
    });
    var m = this.lineMesh = new THREE.Mesh(g, this.lineMat);
    m.frustumCulled = false; m.renderOrder = 3; m.visible = false;
    this.scene.add(m);
    // odstęp szewronów: całkowita liczba na okrążenie (bez skoku na linii mety)
    this.lineSp = rl.total / Math.max(1, Math.round(rl.total / 3.2));
    // tablica kolorów (sRGB → liniowe)
    var lut = this.lineLut = new Float32Array(65 * 3), rgb = [0, 0, 0], c = new THREE.Color();
    for (k = 0; k <= 64; k++) {
      PG.lineRGB(k / 64, rgb); c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      lut[k * 3] = c.r; lut[k * 3 + 1] = c.g; lut[k * 3 + 2] = c.b;
    }
  };
  // Tablica kolorów do rysowania: przy postprocessingu złożenie mapuje tony całego obrazu, więc kolory
  // „odwrotnie zmapowane” (PG.Post3D.untone), z jasnością ≤ 0,9 — poniżej progu poświaty
  V.lineLutFor = function () {
    var p = this.post, r = this.renderer, U = PG.Post3D && PG.Post3D.untone;
    if (!p || !p.ok || !U || r.toneMapping === THREE.NoToneMapping) return this.lineLut;
    var key = r.toneMapping * 100 + num(r.toneMappingExposure, 1);
    if (this.lineLutU && this.lineLutKey === key) return this.lineLutU;
    var src = this.lineLut, lut = this.lineLutU || (this.lineLutU = new Float32Array(src.length));
    var c = this.lutC || (this.lutC = new THREE.Color());
    for (var k = 0; k < src.length; k += 3) {
      c.setRGB(src[k], src[k + 1], src[k + 2]);
      if (U(c, r)) {
        var mx = Math.max(c.r, c.g, c.b);
        if (mx > 0.9) c.multiplyScalar(0.9 / mx);
      }
      lut[k] = c.r; lut[k + 1] = c.g; lut[k + 2] = c.b;
    }
    this.lineLutKey = key;
    return lut;
  };
  V.updateLine = function (S, dt, mode) {
    var M = this.lineMesh;
    if (!M) return;
    var pc = S.player;
    if (mode === 'off' || !pc || !pc.profile || pc.retired || pc.finished) { M.visible = false; return; }
    var rl = this.rl, len = Math.min(480, 60 + 4 * Math.max(0, num(pc.v, 0)));
    var n = rl.update(pc, S.env, dt, len, 3);
    if (n < 2) { M.visible = false; return; }
    var L = this.T.line, P = this.lPos.array, C = this.lCol.array, UV = this.lUv.array, lut = this.lineLutFor();
    var hw = 0.3, y = 0.028, brake = mode === 'brake', any = false, sp = this.lineSp;
    var s0 = rl.s[rl.idx[0]], d0 = rl.d[0];
    for (var k = 0; k < n; k++) {
      var i = rl.idx[k], d = rl.d[k], u = rl.u[k];
      var x = L.x[i], z = L.y[i], sx = -rl.ty[i] * hw, sz = rl.tx[i] * hw, o = k * 6;
      P[o] = x + sx; P[o + 1] = y; P[o + 2] = z + sz; P[o + 3] = x - sx; P[o + 4] = y; P[o + 5] = z - sz;
      var a = sst(1, 12, d) * (1 - sst(len - 45, len, d)) * 0.85;
      if (brake) a *= sst(0.16, 0.3, u);
      if (a > 0.01) any = true;
      var li = u >= 1 ? 64 : (u * 64 + 0.5) | 0, q = k * 8;
      C[q] = C[q + 4] = lut[li * 3]; C[q + 1] = C[q + 5] = lut[li * 3 + 1]; C[q + 2] = C[q + 6] = lut[li * 3 + 2]; C[q + 3] = C[q + 7] = a;
      UV[k * 4 + 1] = UV[k * 4 + 3] = (s0 + (d - d0)) / sp;
    }
    if (!any) { M.visible = false; return; }
    M.visible = true;
    this.lineGeo.setDrawRange(0, (n - 1) * 6);
    dirty(this.lPos, 0, n * 6); dirty(this.lCol, 0, n * 8); dirty(this.lUv, 0, n * 4);
  };

  // ---------- znacznik gracza ----------
  V.makeMarker = function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#ffc93c'; g.strokeStyle = '#1a1205'; g.lineWidth = 6; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(32, 58); g.lineTo(8, 14); g.lineTo(56, 14); g.closePath(); g.stroke(); g.fill();
    var tex = this.markerTex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.marker.scale.set(2.2, 2.2, 1); this.marker.renderOrder = 10; this.marker.visible = false;
    this.scene.add(this.marker);
  };

  // ---------- kamery telewizyjne wzdłuż toru ----------
  V.makeTvCams = function () {
    var T = this.T, N = T.N, step = Math.round(170 / T.ds), cams = [];
    for (var i = 0; i < N; i += step) {
      var k = T.ks ? T.ks[i] : T.k[i];
      var side = k > 0.0008 ? -1 : k < -0.0008 ? 1 : (cams.length % 2 ? 1 : -1); // na zewnątrz zakrętu
      var bar = side > 0 ? T.barR[i] : T.barL[i];
      var off = bar + 10 + (cams.length % 3) * 4;
      cams.push({ i: i, x: T.x[i] + T.nx[i] * off * side, z: T.y[i] + T.ny[i] * off * side, y: 5 + (cams.length % 4) * 2.5 });
    }
    this.tvCams = cams; this.tvStep = step;
  };
  V.pickTv = function (car) {
    var T = this.T, N = T.N, cams = this.tvCams, best = -1, bd = Infinity;
    for (var k = 0; k < cams.length; k++) {
      var d = wrapI(cams[k].i - car.idx, N); if (d > N / 2) d -= N; // >0 kamera przed bolidem
      var score = Math.abs(d * T.ds - 45);
      if (d * T.ds < -110) continue;
      if (score < bd) { bd = score; best = k; }
    }
    return best;
  };

  V.setMode = function (mode) { if (this.cam.mode !== mode) { this.cam.mode = mode; this.cam.init = false; this.cam.tv = -1; } };

  // ---------- kamera ----------
  V.updateCamera = function (car, dt, o) {
    var C = this.cam, cam = this.camera, mode = C.mode;
    var cx = car.x, cz = car.y, h = car.h, av = Math.abs(car.v || 0);
    // wygładzony kierunek (kamera nie wiruje razem z bolidem w poślizgu)
    if (!C.init) { C.hs = h; }
    C.hs += angDiff(h, C.hs) * damp(mode === 'chase' || mode === 'far' ? 5.5 : 12, dt);
    var back = o.lookBack ? -1 : 1;
    var fx = Math.cos(C.hs) * back, fz = Math.sin(C.hs) * back;
    var fov = 60, tx, ty, tz, lx, ly, lz, snap = !C.init, k = 14;
    var onboard = mode === 'chase' || mode === 'far' || mode === 'tcam' || mode === 'cockpit';
    // lekki „oddech" kąta widzenia: szerzej z otwartym DRS, węziej przy mocnym hamowaniu
    var kickT = 0;
    if (onboard) {
      if (car.drsOpen) kickT += 2.5;
      var br = c01(num(car.brake, 0));
      if (br > 0.4 && av > 25) kickT -= 2.2 * br;
    }
    C.kick += (kickT - C.kick) * damp(2.5, dt);
    if (mode === 'chase' || mode === 'far') {
      var dist = (mode === 'far' ? 9.6 : 6.4) + av * (mode === 'far' ? 0.012 : 0.008), hgt = mode === 'far' ? 3.3 : 2.05;
      tx = cx - fx * dist; ty = hgt; tz = cz - fz * dist;
      lx = cx + fx * 6; ly = 0.9; lz = cz + fz * 6;
      fov = 58 + Math.min(14, av * 0.14) + C.kick;
      k = 18;
    } else if (mode === 'tcam' || mode === 'cockpit') {
      var tc = mode === 'tcam';
      var hf = h + (o.lookBack ? Math.PI : 0), ffx = Math.cos(hf), ffz = Math.sin(hf);
      var along = tc ? -0.25 : 0.42, up = tc ? 1.12 : 0.74;
      if (o.lookBack) along = tc ? -0.6 : 0.2;
      tx = cx + Math.cos(h) * along; ty = up; tz = cz + Math.sin(h) * along;
      lx = tx + ffx * 20; ly = up - (tc ? 0.9 : 0.6); lz = tz + ffz * 20;
      fov = (tc ? 66 : 74) + Math.min(8, av * 0.08) + C.kick;
      snap = true;
    } else if (mode === 'heli') {
      tx = cx - fx * 38; ty = 46; tz = cz - fz * 38;
      lx = cx + fx * 12; ly = 0; lz = cz + fz * 12;
      fov = 50; k = 3;
    } else { // tv
      var pick = this.pickTv(car);
      if (pick !== C.tv) { C.tv = pick; snap = true; }
      var tc2 = this.tvCams[Math.max(0, C.tv)];
      tx = tc2.x; ty = tc2.y; tz = tc2.z;
      lx = cx + Math.cos(h) * Math.min(12, av * 0.25); ly = 0.6; lz = cz + Math.sin(h) * Math.min(12, av * 0.25);
      var d = Math.hypot(tx - lx, ty - ly, tz - lz);
      fov = Math.max(6, Math.min(50, 2 * Math.atan(16 / d) * 180 / Math.PI));
      k = 30;
    }
    if (snap) { C.pos.set(tx, ty, tz); C.look.set(lx, ly, lz); C.fov = fov; }
    else {
      var f = damp(k, dt);
      C.pos.x += (tx - C.pos.x) * f; C.pos.y += (ty - C.pos.y) * f; C.pos.z += (tz - C.pos.z) * f;
      var fl = damp(mode === 'tv' ? 40 : 22, dt);
      C.look.x += (lx - C.look.x) * fl; C.look.y += (ly - C.look.y) * fl; C.look.z += (lz - C.look.z) * fl;
      C.fov += (fov - C.fov) * damp(mode === 'tv' ? 6 : 3, dt);
    }
    C.init = true;
    cam.position.copy(C.pos);
    if (C.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * C.shake * 0.08; cam.position.y += (Math.random() - 0.5) * C.shake * 0.05; cam.position.z += (Math.random() - 0.5) * C.shake * 0.08;
      C.shake = Math.max(0, C.shake - dt * 10);
    }
    // drgania: krawężniki, trawa/żwir, płaskie miejsca na oponach, blokada kół
    var vibT = 0;
    if (onboard && !o.lookBack) {
      var sf = c01(av / 30);
      if (car.surface === 'kerb') vibT = sf; else if (car.surface === 'grass' || car.surface === 'gravel') vibT = 1.4 * sf;
      vibT += c01(num(car.flat, 0) * 1.5) * c01((av - 15) / 40) * 0.6;
      vibT += c01(num(car.lock, 0)) * c01(av / 20) * 0.5;
    }
    C.vib += (vibT - C.vib) * damp(vibT > C.vib ? 25 : 8, dt);
    var inCar = mode === 'cockpit' || mode === 'tcam';
    if (C.vib > 0.002) {
      var t = this.time, amp = C.vib * (inCar ? 0.011 : 0.016);
      cam.position.y += amp * (Math.sin(t * 83) * 0.6 + Math.sin(t * 131 + 1.7) * 0.4);
      cam.position.x += amp * 0.5 * Math.sin(t * 59 + 0.4);
      cam.position.z += amp * 0.5 * Math.sin(t * 71 + 2.1);
    }
    cam.lookAt(C.look);
    if (inCar && C.vib > 0.002) cam.rotateZ(C.vib * 0.006 * Math.sin(this.time * 47));
    if (Math.abs(cam.fov - C.fov) > 0.01) { cam.fov = C.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  };

  V.shake = function (amount) { this.cam.shake = Math.max(this.cam.shake, amount); };

  // Oświetlenie dymu: kierunek i kolor słońca (w układzie kamery) oraz światło nieba
  V.updateFxUniforms = function () {
    var U = this.smoke.mat.uniforms, sun = this.sunLight, hemi = this.hemiLight, v = this.tv;
    if (sun) {
      v.copy(sun.position);
      if (sun.target) v.sub(sun.target.position);
      if (v.lengthSq() < 1e-6) v.set(-0.45, 0.8, 0.35);
      v.normalize().transformDirection(this.camera.matrixWorldInverse);
      U.uSunV.value.copy(v);
      U.uSunC.value.copy(sun.color).multiplyScalar(num(sun.intensity, 2.6) / PI * 1.1);
    }
    if (hemi) {
      var a = U.uAmbC.value.copy(hemi.color);
      if (hemi.groundColor) a.lerp(hemi.groundColor, 0.3);
      a.multiplyScalar(num(hemi.intensity, 1.1) / PI * 1.25);
    }
  };

  V.updateFx = function (dt) {
    var cam = this.camera, cp = cam.position, fw = cam.getWorldDirection(this.v2);
    this.updateFxUniforms();
    this.dust.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt, cp.x, cp.y, cp.z, fw.x, fw.y, fw.z, 0.5, 0.25);
    this.shards.update(dt);
    this.updateDebris(dt);
    this.skids.flush();
  };

  // ---------- klatka ----------
  // o: {focus, lookBack, line ('full'|'brake'|'off'), brakeHint (stare), marker, lights (0..5 | -1)}
  V.render = function (S, dt, o) {
    if (S !== this.S) this.setSession(S);
    o = o || {};
    dt = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.time += dt;
    this.syncCars(S, dt);
    var focus = o.focus || S.player || S.cars[0];
    if (focus) {
      this.updateCamera(focus, dt, o);
      this.world.setFocus(focus.x, focus.y);
      var showMarker = o.marker && S.player && (this.cam.mode === 'tv' || this.cam.mode === 'heli');
      this.marker.visible = !!showMarker;
      if (showMarker) this.marker.position.set(S.player.x, 3.2 + (this.cam.mode === 'heli' ? 4 : 0), S.player.y);
      this.marker.scale.setScalar(this.cam.mode === 'heli' ? 6 : 2.4);
    } else this.camera.updateMatrixWorld();
    if (this.fxOn) { try { this.updateFx(dt); } catch (e) { this.fxFail(e); } }
    if (this.lineMesh) {
      try { this.updateLine(S, dt, PG.lineMode ? PG.lineMode(o) : (o.brakeHint ? 'brake' : 'off')); }
      catch (e2) { console.warn('Linia jazdy 3D wyłączona:', e2); this.lineMesh.visible = false; this.lineMesh = null; }
    }
    this.world.setStartLights(o.lights === undefined ? -1 : o.lights);
    this.world.update(dt, this.camera);
    // postprocessing, a przy jakimkolwiek błędzie zwykłe renderowanie
    var done = false, p = this.post;
    if (p) {
      if (p.ok) { try { p.render(this.scene, this.camera); done = !!p.ok; } catch (e3) { this.killPost(e3); } }
      if (!done && this.post) this.killPost(new Error('Post3D zgłosił błąd (ok = false)'));
    }
    if (!done) this.renderer.render(this.scene, this.camera);
  };

  V.info = function () { var i = this.renderer.info.render; return { calls: i.calls, tris: i.triangles }; };

  V.dispose = function () {
    var self = this;
    this.clearDebris();
    this.dropCars();
    this.cars.clear();
    [this.dust, this.smoke, this.sparks, this.shards, this.skids].forEach(function (s) { try { if (s) s.dispose(); } catch (e) { /* nic */ } });
    if (this.lineMesh) this.scene.remove(this.lineMesh);
    if (this.lineGeo) this.lineGeo.dispose();
    if (this.lineMat) this.lineMat.dispose();
    if (this.lineTex) this.lineTex.dispose();
    if (this.smokeTex) this.smokeTex.dispose();
    if (this.skidTex) this.skidTex.dispose();
    if (this.marker) { this.marker.material.dispose(); if (this.markerTex) this.markerTex.dispose(); }
    if (this.post) this.killPost();
    if (this.world.dispose) this.world.dispose();
    this.renderer.dispose();
  };
})(PG);
