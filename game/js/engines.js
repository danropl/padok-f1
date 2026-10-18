// WORLD GP — dźwięk silników z nagrań paczki do F1 25 (synteza ziarnista w osobnym wątku audio).
//
// Każdy głos (bolid w kamerze i najbliżsi rywale) gra nagrania silnika swojego producenta przygotowane przez
// enginepack.js. Bank: { idle, rtop, top, cyl, mics: [{ on, off, g, go }, …] }. Warstwa to jedno nagranie
// przemiatania obrotów (gaz albo hamowanie silnikiem) ze znacznikami pełnych cykli silnika (2 obroty wału).
//
// Odtwarzanie jak TD-PSOLA: ziarno to dwa cykle z oknem Hanna wokół znacznika, co jeden cykl wchodzi następne.
// Odstęp między ziarnami to okres cyklu przy docelowych obrotach, a szybkość odczytu dopasowuje wysokość
// dźwięku. Ziarna idą po kolei jak w nagraniu, wahadłowo w oknie kilkunastu cykli wokół miejsca o właściwych
// obrotach (brzmienie nie zastyga). Na gazie głośność nie maleje z obrotami: każde ziarno gra z poziomem
// najgłośniejszego miejsca nagrania do docelowych obrotów, więc obroty maksymalne brzmią najmocniej. Przy
// ograniczniku i na jałowych gra w pętli stały zakres z końca nagrania. Między nagraniem z gazem i bez gazu
// przejście o stałej mocy, z kokpitu słychać mikrofon B (bliżej silnika). Do tego przerwa zapłonu przy zmianie
// biegu, międzygaz przy redukcji, ogranicznik w alei, strzały z wydechu, wypadanie zapłonów przy uszkodzeniu.
//
// Ten sam kod działa jako AudioWorklet (osobny wątek audio) i jako zapas w wątku głównym
// (ScriptProcessor, gdy strona nie jest otwarta z localhost ani https).
(function (root) {
  'use strict';

  // Parametry głosu (po NP liczb na głos, głos 0 to bolid w kamerze, kolejne to rywale)
  var NP = 16, MAXV = 5;
  var P = {
    ON: 0,      // 1 — głos gra
    RPM: 1,     // obroty wału w grze (4500..19000)
    LOAD: 2,    // gaz 0..1
    GAIN: 3,    // głośność (z odległością)
    PAN: 4,     // panorama −1..1
    LP: 5,      // tłumienie wysokich tonów z odległością (Hz)
    DOP: 6,     // efekt Dopplera (mnożnik częstotliwości)
    ONB: 7,     // 1 — z kokpitu (mikrofon B), 0 — z zewnątrz (mikrofon A)
    LIM: 8,     // ogranicznik obrotów
    UP: 9,      // licznik zmian biegu w górę (przyrost = przerwa zapłonu)
    DOWN: 10,   // licznik redukcji (przyrost = międzygaz i strzały)
    PIT: 11,    // ogranicznik prędkości w alei serwisowej
    DMG: 12,    // uszkodzenie silnika 0..1 (wypadanie zapłonów)
    SPD: 13,    // prędkość bolidu (m/s), wycie skrzyni z kokpitu
    RESET: 14,  // licznik: nowy bolid w tym głosie
    BANK: 15    // k — nagrania silnika z banku k−1 (0 — cisza)
  };

  // Obroty w grze (physics.js): jałowe, zmiana biegu w górę skrzyni automatycznej (0,97 × 19 000),
  // diody ogranicznika na kierownicy, ogranicznik
  var G_IDLE = 4500, G_SHIFT = 18430, G_LIM = 18800, G_TOP = 19000;

  var TWO_PI = Math.PI * 2;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function kTau(tau, sr) { return 1 - Math.exp(-1 / (tau * sr)); }

  var HN = 1024, HANN = new Float32Array(HN + 1), EQP = new Float32Array(HN + 1);
  for (var hi = 0; hi <= HN; hi++) { HANN[hi] = 0.5 + 0.5 * Math.cos(Math.PI * hi / HN); EQP[hi] = Math.sin(Math.PI / 2 * hi / HN); }

  // Strumień ziaren jednej warstwy (mikrofon × gaz/bez gazu)
  function Stream() {
    this.on = false; this.ph = 0; this.cur = 0; this.W = 8; this.plat = false; this.dir = 1; this.t = 0; this.vt = 0; this.ga = 1;
    this.aP = 0; this.aI = 0; this.aA = 0;              // ziarno wygasające: pozycja w nagraniu, 1/obroty odniesienia, amplituda
    this.bP = 0; this.bI = 0; this.bA = 0; this.bQ = 1; // ziarno narastające (+ 1/okres w próbkach nagrania)
  }

  function Voice(sr, idx, eng) {
    this.sr = sr; this.idx = idx; this.eng = eng || null;
    this.rng = (0x9E3779B9 ^ Math.imul(idx + 1, 0x85EBCA6B)) >>> 0 || 1;
    this.bk = null; this.plOn = false; this.st = [new Stream(), new Stream(), new Stream(), new Stream()];
    this.acc = new Float64Array(128); this.rb = new Float32Array(128); this.wOn = new Float32Array(128); this.wOff = new Float32Array(128);
    this.popT = new Float64Array(4); this.popA = new Float64Array(4);
    this.t = new Float64Array(NP);     // parametry docelowe
    this.seen = new Float64Array(3);   // ostatnio widziane liczniki: UP, DOWN, RESET
    this.whineK = 34;                  // wycie skrzyni: Hz na m/s
    this.reset(4500);
    this.on = false; this.gain = 0;
  }

  Voice.prototype.rand = function () {
    var x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0;
    return this.rng / 4294967296;
  };

  Voice.prototype.reset = function (rpm) {
    this.rpm = rpm; this.load = 0; this.gain = 0; this.dop = 1; this.onb = 0; this.lpK = 1; this.tilt = 1;
    this.panL = Math.SQRT1_2; this.panR = Math.SQRT1_2;
    this.lpS = 0; this.dcX = 0; this.dcY = 0;
    this.cutT = 0; this.blipT = 0; this.cutPh = 0; this.limCut = false; this.cutDuty = 0.5; this.limEnv = 0; this.lift = 0; this.lastLoad = 0;
    this.whPh = 0; this.popT.fill(-1);
    this.pcE = 0; this.pcP = 0; this.pbE = 0; this.pbF = 0; this.pbPh = 0;
    for (var i = 0; i < 4; i++) this.st[i].on = false;
  };

  Voice.prototype.schedulePop = function (delay, amp) {
    for (var i = 0; i < 4; i++) if (this.popT[i] < 0) { this.popT[i] = delay; this.popA[i] = amp; return; }
  };

  // Nowe parametry (z wątku gry)
  Voice.prototype.set = function (src, o) {
    var t = this.t;
    for (var i = 0; i < NP; i++) { var x = src[o + i]; t[i] = x === x && x !== Infinity && x !== -Infinity ? x : 0; } // bez NaN i nieskończoności
    var on = t[P.ON] > 0.5;
    if (t[P.RESET] !== this.seen[2]) {
      this.seen[2] = t[P.RESET];
      this.reset(clamp(t[P.RPM], 3000, 20000));
      this.seen[0] = t[P.UP]; this.seen[1] = t[P.DOWN];
    }
    if (t[P.UP] !== this.seen[0]) {
      this.seen[0] = t[P.UP];
      this.cutT = (0.018 + 0.012 * this.rand()) * this.sr;                       // przerwa zapłonu przy zmianie w górę
      if (this.rand() < 0.3) this.schedulePop(this.cutT + this.rand() * 0.01 * this.sr, 0.9 + this.rand());
    }
    if (t[P.DOWN] !== this.seen[1]) {
      this.seen[1] = t[P.DOWN];
      this.blipT = 0.06 * this.sr;                                                 // międzygaz przy redukcji
      if (this.rand() < 0.6) this.schedulePop((0.05 + 0.15 * this.rand()) * this.sr, 1 + 1.5 * this.rand());
      if (this.rand() < 0.3) this.schedulePop((0.12 + 0.2 * this.rand()) * this.sr, 0.8 + this.rand());
    }
    if (on && !this.on) { this.rpm = clamp(t[P.RPM], 3000, 20000); this.gain = 0; }
    this.on = on || this.gain > 1e-4;
    var bi = t[P.BANK] | 0, banks = this.eng && this.eng.banks, bk = bi > 0 && banks ? banks[bi - 1] || null : null;
    if (bk !== this.bk) { this.bk = bk; for (var s = 0; s < 4; s++) this.st[s].on = false; }
  };

  // odczyt nagrania z interpolacją Hermite'a (4 punkty)
  function rd(p, x, np) {
    var i = x | 0;
    if (i < 1 || i > np) return 0;
    var f = x - i, xm = p[i - 1], x0 = p[i], x1 = p[i + 1], x2 = p[i + 2];
    var c = (x1 - xm) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, b = w + a;
    return (((a * f) - b) * f + c) * f + x0;
  }

  // miejsce (ułamkowy numer cyklu) o obrotach R w zakresie przemiatania [a, b)
  function lidx(Ly, R) {
    var r = Ly.rpm, lo = Ly.a, hi = Ly.b - 1, m;
    if (Ly.up) {
      if (R <= r[lo]) return lo;
      if (R >= r[hi]) return hi;
      while (hi - lo > 1) { m = (lo + hi) >> 1; if (r[m] <= R) lo = m; else hi = m; }
    } else {
      if (R >= r[lo]) return lo;
      if (R <= r[hi]) return hi;
      while (hi - lo > 1) { m = (lo + hi) >> 1; if (r[m] >= R) lo = m; else hi = m; }
    }
    var d = r[hi] - r[lo];
    return lo + (d !== 0 ? (R - r[lo]) / d : 0);
  }

  // Następne ziarno strumienia st dla obrotów R. Kursor idzie cykl po cyklu jak w nagraniu (wtedy ziarna
  // łączą się bez śladu). Gdy odejdzie od miejsca o właściwych obrotach dalej niż ±W cykli, zawraca (wahadło),
  // a przy szybkim wzroście obrotów dogania cel krokami co 2–4 cykle; bliskie cykle są do siebie podobne,
  // więc połączenia są gładkie. Daleki skok tylko przy dużej zmianie obrotów (zmiana biegu, start).
  Voice.prototype.pick = function (st, Ly, R) {
    var b = Ly.b, z = Ly.z, cur = st.cur, c, d, s;
    // stały zakres: na gazie — ogranicznik obrotów w grze (plOn), bez gazu — jałowe
    var inPl = z - b >= 8 && (Ly.up ? this.plOn : R <= Ly.pt * (st.plat ? 1.008 : 1));
    if (inPl) {
      // stały zakres z końca nagrania (ogranicznik, jałowe): pętla do przodu, jak nagrano (ls..le)
      var ls = Ly.ls || b, le = Ly.le || z;
      if (st.plat && cur >= b && cur <= z) { c = cur + 1; if (c > le) c = ls; }
      else c = cur + 1 === b ? b : ls + ((this.rand() * 4) | 0);
      st.plat = true; st.cur = c; st.vt = 0; st.ga = Ly.gp || 1; st.dir = 1;
      return c;
    }
    var t = lidx(Ly, R);
    if (st.plat || cur < Ly.a || cur > b - 1) { st.vt = 0; d = 1e9; }
    else { st.vt += 0.25 * ((t - st.t) - st.vt); d = t - cur; }
    st.t = t;
    if (d > 40 || d < -40) {
      c = Math.round(t - 0.3 * this.rand() * this.wnd(Ly, t));
      st.dir = 1; st.W = this.wnd(Ly, t) * (0.7 + 0.6 * this.rand());
    } else {
      // granice wahadła: ±W wokół celu, bez samego początku nagrania, co najmniej 10 cykli
      var lo = t - st.W, hi = t + st.W;
      if (lo < Ly.a2) { lo = Ly.a2; if (hi < lo + 10) hi = lo + 10; }
      if (hi > b - 1) { hi = b - 1; if (lo > hi - 10) lo = hi - 10; }
      if (st.dir > 0 && cur + 1 > hi) { st.dir = -1; st.W = this.wnd(Ly, t) * (0.7 + 0.6 * this.rand()); }
      else if (st.dir < 0 && cur - 1 < lo) { st.dir = 1; st.W = this.wnd(Ly, t) * (0.7 + 0.6 * this.rand()); }
      s = st.vt + 0.15 * d;
      if (st.dir > 0) s = s < 1 ? 1 : s > 4 ? 4 : Math.round(s);
      else s = s > -1 ? -1 : s < -4 ? -4 : Math.round(s);
      c = cur + s;
    }
    if (c < Ly.a) { c = Ly.a; st.dir = 1; }
    if (c > b - 1) { c = b - 1; st.dir = -1; }
    // głośność ziarna: poziom docelowy w miejscu o obrotach R (na gazie nie maleje z obrotami)
    var lt = Ly.lt || Ly.lv, ti = t | 0, lvT = lt[ti] + (lt[ti + 1] - lt[ti]) * (t - ti), ga = lvT / Ly.lv[c];
    st.plat = false; st.cur = c; st.ga = ga < 0.5 ? 0.5 : ga > 2.5 ? 2.5 : ga;
    return c;
  };
  Voice.prototype.wnd = function (Ly, t) { var ti = Math.round(t); return Ly.wn[ti < Ly.a ? Ly.a : ti > Ly.b - 1 ? Ly.b - 1 : ti]; };

  Voice.prototype.sInit = function (st, Ly, R) {
    st.cur = -99; st.plat = false; st.W = 0; st.dir = 1; st.vt = 0;
    var g = this.pick(st, Ly, R);
    st.aP = Ly.mk[g]; st.aI = 1 / (st.plat ? Ly.pr : Ly.rf[g]); st.aA = st.ga;
    g = this.pick(st, Ly, R);
    st.bI = 1 / (st.plat ? Ly.pr : Ly.rf[g]); st.bQ = 1 / Ly.per[g]; st.bA = st.ga; st.bP = Ly.mk[g] - Ly.per[g];
    st.ph = 0; st.on = true;
  };

  // Jeden strumień ziaren dodany do acc z wagą g × w[i]; dm — szansa wypadnięcia zapłonu w cyklu (uszkodzenie)
  Voice.prototype.layer = function (st, Ly, n, rb, g, w, dm) {
    var i, mx = 0;
    for (i = 0; i < n; i += 16) if (w[i] > mx) mx = w[i];
    if (w[n - 1] > mx) mx = w[n - 1];
    if (!(g * mx > 1e-4)) { st.on = false; return; }
    if (!st.on) this.sInit(st, Ly, rb[0]);
    var acc = this.acc, pcm = Ly.pcm, np = pcm.length - 3, mk = Ly.mk, per = Ly.per, rp = Ly.rf, pr = Ly.pr;
    var kk = Ly.sr / this.sr * this.dop;                // szybkość odczytu = kk × R / obroty odniesienia ziarna
    var ph = st.ph, aP = st.aP, aI = st.aI, aA = st.aA, bP = st.bP, bI = st.bI, bA = st.bA, bQ = st.bQ;
    for (i = 0; i < n; i++) {
      var hw = HANN[(ph * HN) | 0];
      acc[i] += g * w[i] * (hw * aA * rd(pcm, aP, np) + (1 - hw) * bA * rd(pcm, bP, np));
      var rr = rb[i] * kk, rB = rr * bI;
      aP += rr * aI; bP += rB; ph += rB * bQ;
      if (ph >= 1) {
        ph -= 1; if (ph >= 1) ph = 0.999;
        aP = bP; aI = bI; aA = bA;
        var gi = this.pick(st, Ly, rb[i]);
        bI = 1 / (st.plat ? pr : rp[gi]); bQ = 1 / per[gi]; bP = mk[gi] - (1 - ph) * per[gi];
        bA = (dm > 0 && this.rand() < dm ? 0.22 : 1) * st.ga;
      }
    }
    st.ph = ph; st.aP = aP; st.aI = aI; st.aA = aA; st.bP = bP; st.bI = bI; st.bA = bA; st.bQ = bQ;
  };

  // Dodaje n próbek do wyjścia (L, R), od pozycji off
  Voice.prototype.render = function (L, R, off, n) {
    if (!this.on) return;
    var sr = this.sr, t = this.t, bk = this.bk, i;
    var on = t[P.ON] > 0.5;
    if (!bk) { if (!on) { this.on = false; this.gain = 0; } return; } // bez nagrań cisza (gra wtedy dźwięk klasyczny)
    var tRpm = clamp(t[P.RPM], 3000, 20000), tLoad = clamp(t[P.LOAD], 0, 1), tGain = on ? clamp(t[P.GAIN], 0, 4) : 0;
    var kR = kTau(0.02, sr), kL = kTau(0.006, sr), kG = kTau(0.03, sr), bkf = 1 - Math.exp(-n / (0.03 * sr));
    this.dop += (clamp(t[P.DOP], 0.5, 2) - this.dop) * (1 - Math.exp(-n / (0.06 * sr)));
    this.onb += (clamp(t[P.ONB], 0, 1) - this.onb) * (1 - Math.exp(-n / (0.05 * sr)));
    var lpT = 1 - Math.exp(-TWO_PI * clamp(t[P.LP], 200, 20000) / sr);
    this.lpK += (lpT - this.lpK) * bkf;
    var pan = clamp(t[P.PAN], -1, 1), a = (pan + 1) * Math.PI / 4;
    var pl0 = this.panL, pr0 = this.panR, pl1 = Math.cos(a), pr1 = Math.sin(a);
    this.panL = pl1; this.panR = pr1;
    var lim = t[P.LIM] > 0.5, pit = t[P.PIT] > 0.5, dmg = t[P.DMG], spd = t[P.SPD], onb = this.onb;
    // Obroty w grze → obroty nagrania, tak by maksymalne obroty w grze brzmiały jak maksymalne w nagraniu:
    // jałowe (4500) → jałowe nagrania, zmiana biegu skrzyni automatycznej (18 430) → koniec przemiatania na gazie,
    // ogranicznik (19 000) → nagranie silnika na ograniczniku. Od 18 800 (diody ogranicznika) i na ograniczniku
    // gra pętla ogranicznika z nagrania, na równych obrotach.
    var rtop = bk.rtop || bk.top, s1 = (rtop - bk.idle) / (G_SHIFT - G_IDLE), s2 = (bk.top - rtop) / (G_TOP - G_SHIFT);
    var rb = this.rb, wOn = this.wOn, wOff = this.wOff;
    var liftK = 1 - Math.exp(-1 / (1.2 * sr));
    if (lim) tRpm = G_TOP;
    this.plOn = lim || this.rpm >= (this.plOn ? G_LIM - 100 : G_LIM);
    for (i = 0; i < n; i++) {
      this.rpm += (tRpm - this.rpm) * kR;
      this.gain += (tGain - this.gain) * kG;
      // ogranicznik prędkości w alei (ok. 11 Hz): przerwy w zapłonie seriami
      if (pit) {
        this.cutPh += 11 / sr;
        if (this.cutPh >= 1) { this.cutPh -= 1; this.cutDuty = 0.42 + 0.2 * this.rand(); }
        this.limCut = this.cutPh > 1 - this.cutDuty;
      } else this.limCut = false;
      this.limEnv += ((this.limCut ? 1 : 0) - this.limEnv) * 0.002;
      if (this.cutT > 0) this.cutT--;
      if (this.blipT > 0) this.blipT--;
      var tl = tLoad;
      if (this.blipT > 0) tl = Math.max(tl, 0.8);                    // międzygaz przy redukcji
      if (this.cutT > 0) tl = 0;                                      // przerwa zapłonu przy zmianie w górę
      else if (this.limCut) tl = 0.05;
      this.load += (tl - this.load) * kL;
      var ld = this.load;
      if (this.lastLoad > 0.5 && ld < 0.1) this.lift = 1;
      this.lastLoad = ld; this.lift -= this.lift * liftK;
      var gr = this.rpm * (1 - 0.014 * this.limEnv);
      var x = gr <= G_SHIFT ? bk.idle + (gr - G_IDLE) * s1 : rtop + (gr - G_SHIFT) * s2;
      rb[i] = x > 0.5 * bk.idle ? x : 0.5 * bk.idle;
      var li = (ld * HN + 0.5) | 0;                                   // gaz/bez gazu: przejście o stałej mocy
      wOn[i] = EQP[li]; wOff[i] = EQP[HN - li];
    }
    // ziarna: mikrofon A (z zewnątrz) i B (z kokpitu), gaz i bez gazu
    var acc = this.acc, mics = bk.mics, one = !mics[1] || mics[1] === mics[0];
    for (i = 0; i < n; i++) acc[i] = 0;
    var dm = dmg > 0.05 ? 0.22 * dmg : 0;
    for (var m = 0; m < (one ? 1 : 2); m++) {
      var mic = mics[m], mw = one ? 1 : m === 0 ? 1 - onb : onb;
      this.layer(this.st[2 * m], mic.on, n, rb, mw * mic.g, wOn, dm);
      this.layer(this.st[2 * m + 1], mic.off, n, rb, mw * (mic.go || mic.g), wOff, 0);
    }
    if (one) { this.st[2].on = false; this.st[3].on = false; }
    // strzały z wydechu: po odpuszczeniu gazu na wysokich obrotach i w alei (V6 hybrydy — rzadziej)
    var pk = bk.cyl === 6 ? 0.35 : 1, hr = clamp((this.rpm - 4500) / 14500, 0, 1), pc = 0;
    if (this.load < 0.12 && this.rpm > 9000) pc = (0.2 + 1.6 * hr) * (1 + 3 * this.lift) * pk;
    if (this.limCut) pc = Math.max(pc, 3 * pk);
    if (pc > 0 && this.rand() < pc * n / sr) this.schedulePop(this.rand() * n, 0.7 + 1.6 * this.rand());
    // wysokie obroty brzmią mocniej: do +2 dB od 15 000 do 19 000 obr./min w grze
    var tilt0 = this.tilt, tilt1 = 1 + 0.26 * clamp((this.rpm - 15000) / 4000, 0, 1);
    this.tilt = tilt1;
    var dC = Math.exp(-1 / (0.0025 * sr)), dB = Math.exp(-1 / (0.02 * sr));
    var whG = onb > 0.05 ? 0.004 * onb * clamp(spd / 8, 0, 1) : 0, whF = this.whineK * spd / sr, lpK = this.lpK;
    for (i = 0; i < n; i++) {
      for (var q = 0; q < 4; q++) {
        if (this.popT[q] < 0) continue;
        this.popT[q] -= 1;
        if (this.popT[q] < 0) { var pa = this.popA[q] * pk; this.pcE += 0.3 * pa; this.pbE += 0.22 * pa; this.pbF = (65 + 55 * this.rand()) / sr; this.pbPh = 0; }
      }
      var u = i / n, y = acc[i] * (1 / 32768) * (tilt0 + (tilt1 - tilt0) * u);
      if (this.pcE > 1e-4) { var wn = this.rand() * 2 - 1; y += this.pcE * (wn - this.pcP); this.pcP = wn; this.pcE *= dC; }
      if (this.pbE > 1e-4) { this.pbPh += this.pbF; y += this.pbE * Math.sin(TWO_PI * this.pbPh); this.pbE *= dB; }
      if (whG > 0) { this.whPh += whF; if (this.whPh >= 1) this.whPh -= 1; y += whG * Math.sin(TWO_PI * this.whPh); }
      this.lpS += lpK * (y - this.lpS);
      var yo = this.lpS - this.dcX + 0.9975 * this.dcY; this.dcX = this.lpS; this.dcY = yo;
      var o = yo * this.gain;
      L[off + i] += o * (pl0 + (pl1 - pl0) * u);
      R[off + i] += o * (pr0 + (pr1 - pr0) * u);
    }
    if (!on && this.gain < 1e-4) { this.on = false; this.gain = 0; }
  };

  function Engine(sr) {
    this.sr = sr; this.v = []; this.banks = null;
    for (var i = 0; i < MAXV; i++) this.v.push(new Voice(sr, i, this));
  }
  // Banki nagrań z paczki (albo null — wszystkie głosy cichną)
  Engine.prototype.setBanks = function (b) {
    this.banks = b && b.length ? b : null;
    for (var i = 0; i < this.v.length; i++) {
      var vo = this.v[i], bi = vo.t[P.BANK] | 0, bk = bi > 0 && this.banks ? this.banks[bi - 1] || null : null;
      if (bk !== vo.bk) { vo.bk = bk; for (var s = 0; s < 4; s++) vo.st[s].on = false; }
    }
  };
  // Parametry wszystkich głosów (Float32Array MAXV × NP)
  Engine.prototype.set = function (a) {
    if (!a || a.length < NP) return;
    var nv = Math.min(MAXV, Math.floor(a.length / NP));
    for (var i = 0; i < nv; i++) this.v[i].set(a, i * NP);
  };
  // Wypełnia L i R (zeruje je najpierw)
  Engine.prototype.process = function (L, R, n) {
    for (var i = 0; i < n; i++) { L[i] = 0; R[i] = 0; }
    for (var k = 0; k < this.v.length; k++) {
      var vo = this.v[k];
      if (!vo.on) continue;
      // bloki po 128 próbek: płynna panorama i filtry
      for (var o = 0; o < n; o += 128) vo.render(L, R, o, Math.min(128, n - o));
    }
  };

  root.PG_ENGINES = { Engine: Engine, NP: NP, MAXV: MAXV, P: P };

  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
    registerProcessor('pg-engines', class extends AudioWorkletProcessor {
      constructor() {
        super();
        var eng = this.eng = new Engine(sampleRate);
        this.port.onmessage = function (ev) {
          var d = ev.data;
          if (d && d.banks !== undefined) eng.setBanks(d.banks); else eng.set(d);
        };
      }
      process(inputs, outputs) {
        var out = outputs[0];
        if (!out || !out[0]) return true;
        this.eng.process(out[0], out[1] || out[0], out[0].length);
        return true;
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
