// WORLD GP — postprocessing 3D (PG.Post3D): scena do bufora HDR (half float, MSAA na WebGL2),
// bloom (próg z miękkim kolanem, łańcuch mip: zmniejszanie i powiększanie), złożenie na ekran:
// mapowanie tonów i sRGB dokładnie raz, lekka winieta i korekcja barw.
// Każdy błąd → ok = false; wywołujący (view3d) renderuje wtedy bezpośrednio przez renderer.render.
(function (PG) {
  'use strict';

  // Ustawienia jakości ('low' → bez postprocessingu)
  var QUAL = {
    high: { levels: 5, samples: 4, taps4: true, bloom: 0.38, threshold: 1.0, knee: 0.45, scatter: 0.82, vignette: 0.22, saturation: 1.06, contrast: 0.1, warmth: 0.025 },
    medium: { levels: 3, samples: 4, taps4: false, bloom: 0.34, threshold: 1.0, knee: 0.45, scatter: 0.85, vignette: 0.2, saturation: 1.05, contrast: 0.08, warmth: 0.02 }
  };
  var MARK = 'PG_POST3D';          // znacznik w źródle shaderów (rozpoznanie własnych błędów)
  var BIG_PX = 3.7e6;              // powyżej tylu pikseli bufora: MSAA x2 zamiast x4 (ekrany HiDPI)

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- shadery ----------
  // Jeden trójkąt na cały ekran (pozycje w przestrzeni przycięcia)
  var VS = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = position.xy * 0.5 + 0.5;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Filtr wstępny: próg z miękkim kolanem + średnia Karisa (tłumi migoczące pojedyncze piksele), 1/2 rozdzielczości
  var FS_PRE = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform vec4 uThr;',
    'uniform float uExpo;',
    'varying vec2 vUv;',
    'float pgLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    'vec3 pgPre(vec3 c) {',
    '  c = clamp(c, vec3(0.0), vec3(64.0));',
    '  float br = max(c.r, max(c.g, c.b)) * uExpo;',
    '  float rq = clamp(br - uThr.y, 0.0, uThr.z);',
    '  rq = uThr.w * rq * rq;',
    '  return c * (max(rq, br - uThr.x) / max(br, 1e-4));',
    '}',
    'void main() {',
    '  vec3 a = pgPre(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);',
    '  vec3 b = pgPre(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);',
    '  vec3 c = pgPre(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);',
    '  vec3 d = pgPre(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);',
    '  float wa = 1.0 / (1.0 + pgLum(a) * uExpo);',
    '  float wb = 1.0 / (1.0 + pgLum(b) * uExpo);',
    '  float wc = 1.0 / (1.0 + pgLum(c) * uExpo);',
    '  float wd = 1.0 / (1.0 + pgLum(d) * uExpo);',
    '  gl_FragColor = vec4((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), 1.0);',
    '}'
  ].join('\n');

  // Zmniejszanie: 13 próbek (36 tekseli), bez aliasingu przy ruchu kamery
  var FS_DOWN = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'varying vec2 vUv;',
    'vec3 pgT(vec2 o) { return texture2D(tSrc, vUv + uTexel * o).rgb; }',
    'void main() {',
    '  vec3 s = pgT(vec2(0.0, 0.0)) * 0.125;',
    '  s += (pgT(vec2(-2.0, -2.0)) + pgT(vec2(2.0, -2.0)) + pgT(vec2(-2.0, 2.0)) + pgT(vec2(2.0, 2.0))) * 0.03125;',
    '  s += (pgT(vec2(0.0, -2.0)) + pgT(vec2(-2.0, 0.0)) + pgT(vec2(2.0, 0.0)) + pgT(vec2(0.0, 2.0))) * 0.0625;',
    '  s += (pgT(vec2(-1.0, -1.0)) + pgT(vec2(1.0, -1.0)) + pgT(vec2(-1.0, 1.0)) + pgT(vec2(1.0, 1.0))) * 0.125;',
    '  gl_FragColor = vec4(s, 1.0);',
    '}'
  ].join('\n');

  // Powiększanie: filtr namiotowy 3x3, dodawany (mieszanie ONE+ONE) do poziomu wyżej
  var FS_UP = [
    'uniform sampler2D tSrc;',
    'uniform vec2 uTexel;',
    'uniform float uW;',
    'varying vec2 vUv;',
    'vec3 pgT(vec2 o) { return texture2D(tSrc, vUv + uTexel * o).rgb; }',
    'void main() {',
    '  vec3 s = pgT(vec2(0.0, 0.0)) * 4.0;',
    '  s += (pgT(vec2(0.0, -1.0)) + pgT(vec2(-1.0, 0.0)) + pgT(vec2(1.0, 0.0)) + pgT(vec2(0.0, 1.0))) * 2.0;',
    '  s += pgT(vec2(-1.0, -1.0)) + pgT(vec2(1.0, -1.0)) + pgT(vec2(-1.0, 1.0)) + pgT(vec2(1.0, 1.0));',
    '  gl_FragColor = vec4(s * (uW / 16.0), 0.0);',
    '}'
  ].join('\n');

  // Złożenie na ekran: HDR + bloom → mapowanie tonów (chunk three) → korekcja barw i winieta
  // (liniowo, po mapowaniu tonów) → sRGB (chunk three) → dithering
  var FS_COMP = [
    'uniform sampler2D tScene;',
    'uniform sampler2D tBloom;',
    'uniform vec2 uBloomTexel;',
    'uniform float uBloom;',
    'uniform float uVig;',
    'uniform vec2 uVigScale;',
    'uniform float uSat;',
    'uniform float uCon;',
    'uniform vec3 uWarm;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec3 c = clamp(texture2D(tScene, vUv).rgb, vec3(0.0), vec3(65000.0));',
    '#ifdef PG_BLOOM4',
    '  vec3 b = texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, -0.5)).rgb;',
    '  b += texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, -0.5)).rgb;',
    '  b += texture2D(tBloom, vUv + uBloomTexel * vec2(-0.5, 0.5)).rgb;',
    '  b += texture2D(tBloom, vUv + uBloomTexel * vec2(0.5, 0.5)).rgb;',
    '  c += b * (0.25 * uBloom);',
    '#else',
    '  c += texture2D(tBloom, vUv).rgb * uBloom;',
    '#endif',
    '  gl_FragColor = vec4(c, 1.0);',
    '  #include <tonemapping_fragment>',
    '  vec3 g = clamp(gl_FragColor.rgb, 0.0, 1.0) * uWarm;',
    '  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));',
    '  g = clamp(mix(vec3(l), g, uSat), 0.0, 1.0);',
    '  vec3 p = sqrt(g);',
    '  p = clamp(p + uCon * p * (1.0 - p) * (2.0 * p - 1.0), 0.0, 1.0);',
    '  g = p * p;',
    '  vec2 d = (vUv - 0.5) * uVigScale;',
    '  float r2 = min(dot(d, d), 1.0);',
    '  g *= 1.0 - uVig * r2 * r2;',
    '  gl_FragColor = vec4(g, 1.0);',
    '  #include <colorspace_fragment>',
    '  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));',
    '  gl_FragColor.rgb += (n - 0.5) / 255.0;',
    '}'
  ].join('\n');

  // ---------- odwrotne mapowanie tonów (mgła i tło) ----------
  // Przy renderowaniu na ekran three miesza mgłę i czyści tło kolorem BEZ mapowania tonów; w buforze HDR
  // oba przechodzą potem przez mapowanie w złożeniu. Na czas przejścia sceny podmieniamy ich kolor na
  // „odwrotnie zmapowany”, żeby horyzont wyglądał tak samo jak przy renderowaniu bezpośrednim.
  function inv3(m) {
    var a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    var D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    var G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
    var det = a * A + b * B + c * C;
    return [A / det, D / det, G / det, B / det, E / det, H / det, C / det, F / det, I / det];
  }
  // macierze ACES z tonemapping_pars_fragment (r159), zapisane wierszami
  var ACES_IN_INV = inv3([0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777]);
  var ACES_OUT_INV = inv3([1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602]);
  // odwrotność RRTAndODTFit (dodatni pierwiastek równania kwadratowego)
  function rrtInv(z) {
    z = clamp(z, 0, 0.99);
    var a = 0.983729 * z - 1, b = 0.4329510 * z - 0.0245786, c = 0.238081 * z + 0.000090537;
    return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
  }
  // wynik do out[5..7]; false, gdy nie umiemy odwrócić danego mapowania
  function invTone(r, g, b, tm, e, out) {
    var x, y, z, M, N, u, v, w, k;
    e = Math.max(1e-4, e);
    r = clamp(r, 0, 0.985); g = clamp(g, 0, 0.985); b = clamp(b, 0, 0.985);
    if (tm === THREE.LinearToneMapping) { x = r / e; y = g / e; z = b / e; }
    else if (tm === THREE.ReinhardToneMapping) { x = r / ((1 - r) * e); y = g / ((1 - g) * e); z = b / ((1 - b) * e); }
    else if (tm === THREE.ACESFilmicToneMapping) {
      M = ACES_OUT_INV; N = ACES_IN_INV;
      u = rrtInv(M[0] * r + M[1] * g + M[2] * b);
      v = rrtInv(M[3] * r + M[4] * g + M[5] * b);
      w = rrtInv(M[6] * r + M[7] * g + M[8] * b);
      k = 0.6 / e;
      x = (N[0] * u + N[1] * v + N[2] * w) * k;
      y = (N[3] * u + N[4] * v + N[5] * w) * k;
      z = (N[6] * u + N[7] * v + N[8] * w) * k;
    } else return false;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    out[5] = Math.max(0, x); out[6] = Math.max(0, y); out[7] = Math.max(0, z);
    return true;
  }
  // Podmienia kolor (z pamięcią podręczną, bez alokacji); oryginał do save
  function compColor(col, tm, e, cache, save) {
    var r = col.r, g = col.g, b = col.b;
    if (cache[0] !== r || cache[1] !== g || cache[2] !== b || cache[3] !== tm || cache[4] !== e) {
      cache[0] = r; cache[1] = g; cache[2] = b; cache[3] = tm; cache[4] = e;
      cache[8] = invTone(r, g, b, tm, e, cache) ? 1 : 0;
    }
    if (!cache[8]) return false;
    save[0] = r; save[1] = g; save[2] = b;
    col.r = cache[5]; col.g = cache[6]; col.b = cache[7];
    return true;
  }

  // ---------- pomocnicze ----------
  function makeRT(w, h, samples, depth, name) {
    var rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      generateMipmaps: false, depthBuffer: !!depth, stencilBuffer: false, samples: samples || 0
    });
    rt.texture.name = name;
    return rt;
  }
  function makeMat(fs, uniforms, defines, toneMapped, additive) {
    var d = {}, k;
    d[MARK] = 1;
    if (defines) for (k in defines) d[k] = defines[k];
    var m = new THREE.ShaderMaterial({
      uniforms: uniforms, vertexShader: VS, fragmentShader: fs, defines: d,
      depthTest: false, depthWrite: false, fog: false, lights: false,
      side: THREE.DoubleSide, toneMapped: !!toneMapped,
      blending: additive ? THREE.CustomBlending : THREE.NoBlending
    });
    if (additive) { m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor; }
    return m;
  }
  function isMine(gl, sh) {
    var s = sh ? gl.getShaderSource(sh) : null;
    return !!s && s.indexOf(MARK) >= 0;
  }
  // Zastępstwo domyślnego logu three (gdy nie było wcześniejszej obsługi)
  function logShaderErr(gl, program, vs, fs) {
    try {
      console.error('THREE.WebGLProgram: Shader Error ' + gl.getError() + ' - VALIDATE_STATUS ' + gl.getProgramParameter(program, gl.VALIDATE_STATUS) +
        '\n\nProgram Info Log: ' + gl.getProgramInfoLog(program) +
        '\nVertex: ' + gl.getShaderInfoLog(vs) + '\nFragment: ' + gl.getShaderInfoLog(fs));
    } catch (e) { /* nic */ }
  }
  function fbComplete(r, gl, rt) {
    r.setRenderTarget(rt);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  }

  // =====================================================================
  PG.Post3D = function (renderer, opts) {
    opts = opts || {};
    this.ok = false;
    this.renderer = renderer || null;
    this.quality = opts.quality || 'high';
    this.gl = null;
    this.rtScene = null; this.mips = []; this.mw = []; this.mh = [];
    this.mats = []; this.geo = null; this.quad = null; this.qScene = null; this.qCam = null;
    this.W = 0; this.H = 0; this.samples = 0; this.maxSamples = 0; this.msaaOff = false;
    this.params = null;
    this._live = false; this._inScene = false; this._needCheck = true; this._failed = false; this._lost = false;
    this._prevErr = null; this._onErr = null; this._checked = [];
    this._fogCache = [NaN, NaN, NaN, NaN, NaN, 0, 0, 0, 0]; this._bgCache = [NaN, NaN, NaN, NaN, NaN, 0, 0, 0, 0];
    this._fogSave = [0, 0, 0]; this._bgSave = [0, 0, 0]; this._fogCol = null; this._bgCol = null;
    var Q = this.quality === 'low' ? null : (QUAL[this.quality] || QUAL.high);
    if (!Q || !renderer || typeof THREE === 'undefined') return;
    // parametry do strojenia w locie (czytane co klatkę)
    this.params = {
      bloom: Q.bloom, threshold: Q.threshold, knee: Q.knee, scatter: Q.scatter,
      vignette: Q.vignette, saturation: Q.saturation, contrast: Q.contrast, warmth: Q.warmth, fogMatch: true
    };
    try {
      var caps = renderer.capabilities, ext = renderer.extensions;
      if (!caps || !caps.isWebGL2) { console.info('Post3D: brak WebGL2 — renderowanie bez postprocessingu'); return; }
      if (!ext || !(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))) {
        console.info('Post3D: brak renderowania do half float — renderowanie bez postprocessingu');
        return;
      }
      this.gl = renderer.getContext();
      this.maxSamples = Math.max(0, Math.min(Q.samples, caps.maxSamples | 0));
      this.v2 = new THREE.Vector2();
      this.build(Q);
      this.hookErrors();
      this._live = true;
      this.ok = true;
      renderer.getDrawingBufferSize(this.v2);
      this.alloc(this.v2.x, this.v2.y);
      this.checkTargets();
    } catch (e) {
      this.fail('inicjalizacja', e);
    }
    if (!this.ok) this.dispose();
  };
  var P = PG.Post3D.prototype;

  P.build = function (Q) {
    var V2 = THREE.Vector2, i;
    this.uPre = { tSrc: { value: null }, uTexel: { value: new V2(1, 1) }, uThr: { value: new THREE.Vector4(1, 0.5, 1, 0.5) }, uExpo: { value: 1 } };
    this.uDown = { tSrc: { value: null }, uTexel: { value: new V2(1, 1) } };
    this.uUp = { tSrc: { value: null }, uTexel: { value: new V2(1, 1) }, uW: { value: 1 } };
    this.uComp = {
      tScene: { value: null }, tBloom: { value: null }, uBloomTexel: { value: new V2(1, 1) }, uBloom: { value: 0 },
      uVig: { value: 0 }, uVigScale: { value: new V2(1, 1) }, uSat: { value: 1 }, uCon: { value: 0 },
      uWarm: { value: new THREE.Vector3(1, 1, 1) }
    };
    this.mPre = makeMat(FS_PRE, this.uPre, null, false, false);
    this.mDown = makeMat(FS_DOWN, this.uDown, null, false, false);
    this.mUp = makeMat(FS_UP, this.uUp, null, false, true);
    this.mComp = makeMat(FS_COMP, this.uComp, Q.taps4 ? { PG_BLOOM4: 1 } : null, true, false);
    this.mats = [this.mPre, this.mDown, this.mUp, this.mComp];
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(this.geo, this.mComp);
    this.quad.frustumCulled = false; this.quad.matrixAutoUpdate = false;
    this.qScene = new THREE.Scene();
    this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.samples = this.maxSamples;
    this.rtScene = makeRT(1, 1, this.samples, true, 'Post3D.scene');
    for (i = 0; i < Q.levels; i++) { this.mips.push(makeRT(1, 1, 0, false, 'Post3D.bloom' + i)); this.mw.push(1); this.mh.push(1); }
    this.W = this.H = 0;
  };

  // Przechwycenie błędów kompilacji shaderów (renderer.debug.onShaderError), z przekazaniem dalej
  P.hookErrors = function () {
    var dbg = this.renderer.debug, self = this;
    if (!dbg) return;
    this._prevErr = typeof dbg.onShaderError === 'function' ? dbg.onShaderError : null;
    this._onErr = function (gl, program, vs, fs) {
      if (self._live) {
        var mine = false;
        try { mine = isMine(gl, vs) || isMine(gl, fs); } catch (e) { mine = false; }
        // własny shader albo shader sceny skompilowany pod bufor HDR (np. bez funkcji toneMapping)
        if (mine || self._inScene) self.fail(mine ? 'błąd shadera postprocessingu' : 'błąd shadera sceny w trybie HDR');
      }
      if (self._prevErr) { try { self._prevErr(gl, program, vs, fs); } catch (e2) { /* nic */ } }
      else logShaderErr(gl, program, vs, fs);
    };
    dbg.onShaderError = this._onErr;
  };

  P.fail = function (why, err) {
    var first = !this._failed;
    this.ok = false; this._failed = true;
    if (first) console.warn('Post3D wyłączony: ' + why, err || '');
  };

  // Rozmiary buforów (w pikselach bufora rysowania)
  P.alloc = function (W, H) {
    W = Math.max(1, Math.floor(W) || 1); H = Math.max(1, Math.floor(H) || 1);
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    // MSAA: x4, na bardzo gęstych ekranach x2 (koszt pasma bufora half float)
    var s = this.msaaOff ? 0 : (W * H > BIG_PX ? Math.min(2, this.maxSamples) : this.maxSamples);
    if (s !== this.samples) {
      this.rtScene.dispose();
      this.samples = s;
      this.rtScene = makeRT(W, H, s, true, 'Post3D.scene');
    } else this.rtScene.setSize(W, H);
    var w = W, h = H;
    for (var i = 0; i < this.mips.length; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.mips[i].setSize(w, h); this.mw[i] = w; this.mh[i] = h;
    }
    var a = W / H, k = 2 / Math.sqrt(a * a + 1);
    this.uComp.uVigScale.value.set(a * k, k);
    this._needCheck = true;
  };

  // Kompletność buforów ramki (czy sterownik naprawdę renderuje do half float / MSAA)
  P.checkTargets = function () {
    var r = this.renderer, gl = this.gl, ok = true, i;
    if (gl.isContextLost && gl.isContextLost()) return true;
    this._needCheck = false;
    try {
      if (!fbComplete(r, gl, this.rtScene)) {
        if (this.samples > 0) {
          console.warn('Post3D: bufor HDR z MSAA niedostępny, próba bez MSAA');
          this.rtScene.dispose();
          this.msaaOff = true; this.samples = 0;
          this.rtScene = makeRT(this.W, this.H, 0, true, 'Post3D.scene');
          ok = fbComplete(r, gl, this.rtScene);
        } else ok = false;
      }
      for (i = 0; ok && i < this.mips.length; i++) ok = fbComplete(r, gl, this.mips[i]);
    } finally {
      r.setRenderTarget(null);
    }
    if (!ok) this.fail('niekompletny bufor ramki half float');
    return ok;
  };

  P.setSize = function (w, h, dpr) {
    if (!this._live || !this.ok) return;
    try {
      var W = 0, H = 0, r = this.renderer, v = this.v2;
      if (r.getDrawingBufferSize) { r.getDrawingBufferSize(v); W = v.x; H = v.y; }
      if (!(W > 0 && H > 0)) { var d = dpr > 0 ? dpr : 1; W = Math.floor(num(w, 1) * d); H = Math.floor(num(h, 1) * d); }
      this.alloc(W, H);
    } catch (e) { this.fail('zmiana rozmiaru', e); }
  };

  // Mgła i jednolite tło: kolor „odwrotnie zmapowany” na czas przejścia sceny
  P.matchFog = function (scene, tm, expo) {
    this._fogCol = this._bgCol = null;
    if (!scene || tm === THREE.NoToneMapping) return;
    var fog = scene.fog, bg = scene.background;
    if (fog && fog.color && fog.color.isColor && compColor(fog.color, tm, expo, this._fogCache, this._fogSave)) this._fogCol = fog.color;
    if (bg && bg.isColor && !(fog && bg === fog.color) && compColor(bg, tm, expo, this._bgCache, this._bgSave)) this._bgCol = bg;
  };
  P.restoreFog = function () {
    var c = this._fogCol, s;
    if (c) { s = this._fogSave; c.r = s[0]; c.g = s[1]; c.b = s[2]; this._fogCol = null; }
    c = this._bgCol;
    if (c) { s = this._bgSave; c.r = s[0]; c.g = s[1]; c.b = s[2]; this._bgCol = null; }
  };

  P.pass = function (mat, rt) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.qScene, this.qCam);
  };

  // Jednorazowe sprawdzenie linkowania własnych programów (gdy debug.checkShaderErrors jest wyłączony)
  P.verifyPrograms = function () {
    var props = this.renderer.properties, gl = this.gl, i, mp, cp;
    if (!props) return;
    for (i = 0; i < this.mats.length; i++) {
      mp = props.get(this.mats[i]); cp = mp && mp.currentProgram;
      if (!cp || cp === this._checked[i]) continue;
      this._checked[i] = cp;
      if (cp.program && gl.getProgramParameter(cp.program, gl.LINK_STATUS) === false) { this.fail('błąd linkowania shadera'); return; }
    }
  };

  // Cały potok; true = obraz gotowy na ekranie
  P.pipeline = function (scene, camera, autoReset) {
    var r = this.renderer, p = this.params, n = this.mips.length, i, U;
    // rozmiar wg bufora rysowania (np. zmiana pixelRatio bez setSize)
    r.getDrawingBufferSize(this.v2);
    this.alloc(this.v2.x, this.v2.y);
    if (this._needCheck && !this.checkTargets()) return false;
    if (autoReset) r.info.reset();
    r.info.autoReset = false;   // statystyki: scena + przejścia postprocessingu razem
    var tm = r.toneMapping, expo = tm === THREE.NoToneMapping ? 1 : Math.max(1e-4, num(r.toneMappingExposure, 1));

    // 1) scena → bufor HDR (liniowo: three nie mapuje tonów ani sRGB przy celu innym niż ekran)
    if (p.fogMatch) this.matchFog(scene, tm, expo);
    r.setRenderTarget(this.rtScene);
    this._inScene = true;
    r.render(scene, camera);
    this._inScene = false;
    this.restoreFog();
    if (!this.ok) return false;
    r.autoClear = false;

    // 2) bloom
    var sc = clamp(num(p.scatter, 0.8), 0, 1), sum = 0, wl = 1;
    for (i = 0; i < n; i++) { sum += wl; wl *= sc; }
    var bk = n > 0 ? Math.max(0, num(p.bloom, 0)) / Math.max(1, sum) : 0;
    if (bk > 0) {
      var kn = Math.max(1e-3, num(p.knee, 0.5)), th = Math.max(0, num(p.threshold, 1));
      U = this.uPre;
      U.tSrc.value = this.rtScene.texture;
      U.uTexel.value.set(1 / this.W, 1 / this.H);
      U.uThr.value.set(th, th - kn, 2 * kn, 0.25 / kn);
      U.uExpo.value = expo;
      this.pass(this.mPre, this.mips[0]);
      U = this.uDown;
      for (i = 1; i < n; i++) {
        U.tSrc.value = this.mips[i - 1].texture;
        U.uTexel.value.set(1 / this.mw[i - 1], 1 / this.mh[i - 1]);
        this.pass(this.mDown, this.mips[i]);
      }
      U = this.uUp;
      U.uW.value = sc;
      for (i = n - 1; i >= 1; i--) {
        U.tSrc.value = this.mips[i].texture;
        U.uTexel.value.set(1 / this.mw[i], 1 / this.mh[i]);
        this.pass(this.mUp, this.mips[i - 1]);
      }
      if (!this.ok) return false;
    }

    // 3) złożenie na ekran (mapowanie tonów + sRGB tylko tutaj)
    U = this.uComp;
    U.tScene.value = this.rtScene.texture;
    U.tBloom.value = this.mips[0].texture;
    U.uBloomTexel.value.set(1 / this.mw[0], 1 / this.mh[0]);
    U.uBloom.value = bk;
    U.uVig.value = clamp(num(p.vignette, 0), 0, 0.8);
    U.uSat.value = clamp(num(p.saturation, 1), 0, 2);
    U.uCon.value = clamp(num(p.contrast, 0), -0.5, 0.5);
    var wm = clamp(num(p.warmth, 0), -0.2, 0.2), L = 1 + 0.1404 * wm;
    U.uWarm.value.set((1 + wm) / L, 1 / L, (1 - wm) / L);
    this.pass(this.mComp, null);
    this.verifyPrograms();
    return this.ok;
  };

  P.render = function (scene, camera) {
    var r = this.renderer;
    if (!r) return;
    if (!this.ok) { r.setRenderTarget(null); r.render(scene, camera); return; }
    // utracony kontekst: nic się nie narysuje; po odzyskaniu sprawdzamy bufory od nowa
    var gl = this.gl;
    if (gl && gl.isContextLost && gl.isContextLost()) { this._lost = true; return; }
    if (this._lost) { this._lost = false; this._needCheck = true; this._checked = []; }
    var autoClear = r.autoClear, info = r.info, autoReset = info.autoReset, done = false;
    try {
      done = this.pipeline(scene, camera, autoReset);
    } catch (e) {
      this.fail('błąd renderowania', e);
    } finally {
      this._inScene = false;
      this.restoreFog();
      r.autoClear = autoClear;
      info.autoReset = autoReset;
      try { r.setRenderTarget(null); } catch (e2) { /* nic */ }
    }
    if (!done || !this.ok) {
      if (this.ok) this.fail('przerwany potok');
      // awaryjnie ta sama klatka bezpośrednio
      r.render(scene, camera);
    }
  };

  // Pomocnik dla innych modułów: kolor materiału z toneMapped = false ma przy aktywnym Post3D
  // wyglądać jak przy renderowaniu bezpośrednim (złożenie mapuje tony całego obrazu).
  // Zmienia kolor (THREE.Color, przestrzeń robocza) w miejscu; false = bez zmian.
  var UNTONE = [NaN, NaN, NaN, NaN, NaN, 0, 0, 0, 0];
  PG.Post3D.untone = function (color, renderer) {
    if (!color || !color.isColor || !renderer || renderer.toneMapping === THREE.NoToneMapping) return false;
    var e = Math.max(1e-4, num(renderer.toneMappingExposure, 1));
    if (!invTone(color.r, color.g, color.b, renderer.toneMapping, e, UNTONE)) return false;
    color.r = UNTONE[5]; color.g = UNTONE[6]; color.b = UNTONE[7];
    return true;
  };

  P.dispose = function () {
    var r = this.renderer, i;
    this.ok = false;
    this._live = false;
    try {
      if (r && r.debug && this._onErr && r.debug.onShaderError === this._onErr) r.debug.onShaderError = this._prevErr;
    } catch (e) { /* nic */ }
    try { if (this.rtScene) this.rtScene.dispose(); } catch (e1) { /* nic */ }
    for (i = 0; i < this.mips.length; i++) { try { this.mips[i].dispose(); } catch (e2) { /* nic */ } }
    for (i = 0; i < this.mats.length; i++) { try { this.mats[i].dispose(); } catch (e3) { /* nic */ } }
    try { if (this.geo) this.geo.dispose(); } catch (e4) { /* nic */ }
    if (this.qScene && this.quad) this.qScene.remove(this.quad);
    this.rtScene = null; this.mips = []; this.mw = []; this.mh = []; this.mats = []; this._checked = [];
    this.geo = null; this.quad = null; this.qScene = null; this.qCam = null;
    this._fogCol = this._bgCol = null;
  };
})(PG);
