// WORLD GP — dźwięk silników V10 (synteza w czasie rzeczywistym, bez nagrań).
//
// Model fizyczny w uproszczeniu: 10 cylindrów zapala co 72° obrotu wału, czyli 5 razy na obrót
// (przy 18 000 obr./min to 1500 zapłonów na sekundę — stąd wysoki „wrzask” V10). Kolejność zapłonu
// przeplata rzędy, a każdy rząd (5 cylindrów) ma osobny wydech: impuls ciśnienia po zapłonie przechodzi
// przez rurę (falowód z odbiciem na otwartym końcu, rezonanse w stałych częstotliwościach). Do tego dolot
// z rezonansem airboksu, szum spalania, rozrzut siły spalania między zapłonami (szorstkość), strzały
// z wydechu po odpuszczeniu gazu, przerwa zapłonu przy zmianie biegu, ogranicznik obrotów
// i ogranicznik prędkości w alei serwisowej.
//
// Ten sam kod działa jako AudioWorklet (osobny wątek audio) i jako zapas w wątku głównym
// (ScriptProcessor, gdy strona nie jest otwarta z localhost ani https).
(function (root) {
  'use strict';

  // Parametry głosu (po NP liczb na głos, głos 0 to bolid w kamerze, kolejne to rywale)
  var NP = 16, MAXV = 5;
  var P = {
    ON: 0,      // 1 — głos gra
    RPM: 1,     // obroty wału
    LOAD: 2,    // gaz 0..1
    GAIN: 3,    // głośność (z odległością)
    PAN: 4,     // panorama −1..1
    LP: 5,      // tłumienie wysokich tonów z odległością (Hz)
    DOP: 6,     // efekt Dopplera (mnożnik częstotliwości)
    ONB: 7,     // 1 — z kokpitu (więcej dolotu), 0 — z zewnątrz (więcej wydechu)
    LIM: 8,     // ogranicznik obrotów
    UP: 9,      // licznik zmian biegu w górę (przyrost = przerwa zapłonu)
    DOWN: 10,   // licznik redukcji (przyrost = międzygaz i strzały)
    PIT: 11,    // ogranicznik prędkości w alei serwisowej
    DMG: 12,    // uszkodzenie silnika 0..1 (wypadanie zapłonów)
    SPD: 13,    // prędkość bolidu (m/s), wycie skrzyni z kokpitu
    SEED: 14,   // numer bolidu: charakter brzmienia (długości rur, rozrzut cylindrów)
    RESET: 15   // licznik: nowy bolid w tym głosie
  };

  var TWO_PI = Math.PI * 2;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function kTau(tau, sr) { return 1 - Math.exp(-1 / (tau * sr)); }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }

  // Pasmowo-przepustowy (RBJ, wzmocnienie 1 w środku pasma), stan w tablicy s[o..o+1]
  function bpCoef(f, q, sr, out, o) {
    var w = TWO_PI * clamp(f, 20, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    out[o] = al / a0; out[o + 1] = -2 * Math.cos(w) / a0; out[o + 2] = (1 - al) / a0; // b0 (b2 = −b0), a1, a2
  }

  var NPUL = 32, BUF = 512, BM = BUF - 1;

  function Voice(sr, idx) {
    this.sr = sr; this.idx = idx;
    this.rng = (0x9E3779B9 ^ Math.imul(idx + 1, 0x85EBCA6B)) >>> 0 || 1;
    // impulsy: wiek (próbki), długość, amplituda, rodzaj (0/1 — wydech rzędu A/B, 2 — szum spalania, 3 — dolot, 4 — strzał)
    this.pAge = new Float64Array(NPUL); this.pLen = new Float64Array(NPUL); this.pAmp = new Float64Array(NPUL);
    this.pKind = new Uint8Array(NPUL); this.act = new Int32Array(NPUL); this.nAct = 0;
    this.free = new Int32Array(NPUL); this.nFree = NPUL;
    for (var i = 0; i < NPUL; i++) this.free[i] = NPUL - 1 - i;
    this.bufA = new Float64Array(BUF); this.bufB = new Float64Array(BUF);
    this.flt = new Float64Array(24);   // współczynniki filtrów
    this.fs = new Float64Array(16);    // stany filtrów
    this.cylF = new Float64Array(10);
    this.popT = new Float64Array(4); this.popA = new Float64Array(4);
    this.t = new Float64Array(NP);     // parametry docelowe
    this.seen = new Float64Array(3);   // ostatnio widziane liczniki: UP, DOWN, RESET
    this.character(idx);
    this.reset(4500);
    this.on = false; this.gain = 0;
  }

  Voice.prototype.rand = function () {
    var x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x >>> 0;
    return this.rng / 4294967296;
  };

  // Charakter silnika danego bolidu: długości rur, asymetria rzędów, rozrzut cylindrów, rezonanse dolotu
  Voice.prototype.character = function (seed) {
    var sr = this.sr, u = function (k) { return hash((seed + 1) * 7919 + k * 104729); };
    var c = 700; // prędkość dźwięku w gorących spalinach (m/s)
    var LA = 0.58 + 0.08 * u(1), LB = LA + 0.03 + 0.04 * u(2);
    this.DA = Math.min(BUF - 2, Math.round(sr * 2 * LA / c));
    this.DB = Math.min(BUF - 2, Math.round(sr * 2 * LB / c));
    this.gB = 0.84 + 0.1 * u(3);
    this.kW = 0.62 + 0.08 * u(4);       // szerokość impulsu wydechu (część odstępu między zapłonami)
    for (var k = 0; k < 10; k++) this.cylF[k] = 1 + 0.07 * (u(10 + k) - 0.5) * 2;
    var f = this.flt;
    bpCoef(330 + 70 * u(5), 3.2, sr, f, 0);     // airbox
    bpCoef(1050 + 250 * u(6), 4.0, sr, f, 3);   // trąbki dolotu
    bpCoef(1500 + 300 * u(7), 0.8, sr, f, 6);   // szum dolotu
    bpCoef(3300 + 900 * u(8), 0.65, sr, f, 9);  // szum spalania w wydechu
    bpCoef(2600 + 400 * u(9), 1.4, sr, f, 12);  // „wrzask” rury końcowej
    this.kLoop = 0.38 + 0.08 * u(11);           // tłumienie w rurze (filtr w pętli falowodu)
    this.whineK = 30 + 8 * u(12);               // wycie skrzyni: Hz na m/s
  };

  Voice.prototype.reset = function (rpm) {
    this.pf = this.rand() * 10; this.nf = Math.floor(this.pf) + 1;
    this.rpm = rpm; this.load = 0; this.gain = 0; this.dop = 1; this.onb = 0; this.lpK = 1;
    this.panL = Math.SQRT1_2; this.panR = Math.SQRT1_2;
    this.bufA.fill(0); this.bufB.fill(0); this.wA = 0; this.wB = 0; this.zA = 0; this.zB = 0;
    this.fs.fill(0); this.exP = 0; this.lpS = 0; this.dcX = 0; this.dcY = 0; this.crP = 0; this.crY = 0;
    this.cutT = 0; this.blipT = 0; this.cutPh = 0; this.limCut = false; this.cutDuty = 0.5; this.limEnv = 0; this.lift = 0; this.lastLoad = 0;
    this.whPh = 0; this.popT.fill(-1);
    for (var i = 0; i < this.nAct; i++) { this.free[this.nFree++] = this.act[i]; }
    this.nAct = 0;
  };

  Voice.prototype.spawn = function (kind, age, len, amp) {
    if (this.nFree === 0 || !(len > 0.5) || amp === 0) return;
    var s = this.free[--this.nFree];
    this.pKind[s] = kind; this.pAge[s] = age; this.pLen[s] = len; this.pAmp[s] = amp;
    this.act[this.nAct++] = s;
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
      this.character(t[P.SEED] | 0);
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
  };

  // Jeden zapłon: cylinder m (0..9, rzędy na przemian), ułamek próbki od chwili zapłonu, odstęp między zapłonami
  Voice.prototype.fire = function (m, frac, iv, ld, rpm) {
    var t = this.t, cut = this.cutT > 0 || this.limCut;
    var bank = m & 1, comb;
    var hi = clamp((rpm - 4500) / 14500, 0, 1);
    if (this.blipT > 0) ld = Math.max(ld, 0.8);
    // ogranicznik obrotów wycina część zapłonów (silnik się „krztusi”, ale nie milknie);
    // przerwa przy zmianie biegu wycina wszystkie
    if (this.limCut && this.rand() > 0.75) cut = false;
    // bez gazu silnik wciąż pompuje powietrze: na jałowym potrzebuje paliwa, na wysokich obrotach odcięcie
    var c0 = 0.4 - 0.15 * clamp((rpm - 4500) / 6000, 0, 1);
    if (cut) comb = 0.06 * this.rand();
    else {
      // rozrzut spalania: mniejszy na gazie, duży bez gazu i na wolnych obrotach (nierówna praca)
      var sig = 0.1 + 0.25 * (1 - ld) + (rpm < 7500 ? 0.1 : 0);
      var g = (this.rand() + this.rand() + this.rand() - 1.5) * 2;
      comb = (c0 + (1 - c0) * ld) * Math.max(0.05, 1 + sig * g) * this.cylF[m];
      var dmg = t[P.DMG];
      if (dmg > 0.05 && this.rand() < 0.28 * dmg) { comb *= 0.05; if (this.rand() < 0.25) this.schedulePop(iv * (0.5 + this.rand()), 0.8 + this.rand()); }
    }
    var amp = 0.68 + 0.32 * hi;
    // chwila spalania i jego szybkość różnią się od cyklu do cyklu (rozmycie wyższych harmonicznych)
    frac += (this.rand() - 0.5) * 0.06 * iv;
    // impuls w wydechu: przy pełnym spalaniu krótszy i ostrzejszy
    var w = (this.kW + 0.22 * (1 - ld)) * iv * (0.92 + 0.16 * this.rand());
    this.spawn(bank, frac, w, comb * amp);
    // szum spalania w wydechu
    this.spawn(2, frac, 0.7 * iv, comb * (0.3 + 0.7 * ld) * amp);
    // dolot: szerszy impuls, przesunięty względem zapłonu; z zamkniętą przepustnicą cichy
    this.spawn(3, frac - 0.35 * iv, 1.6 * iv, (0.12 + 0.88 * ld) * amp * (cut ? 0.6 : 1));
    // strzały z wydechu: po odpuszczeniu gazu na wysokich obrotach, w przerwach zapłonu i na ogranicznikach
    // (ok. 2 na sekundę bez gazu na wysokich obrotach, kilka razy więcej tuż po odpuszczeniu)
    var pc = 0;
    if (ld < 0.12 && rpm > 8000) pc = (0.0002 + 0.0016 * clamp((rpm - 8000) / 10000, 0, 1)) * (1 + 3 * this.lift);
    if (cut) pc = Math.max(pc, t[P.PIT] > 0.5 ? 0.012 : this.limCut ? 0.006 : 0.02);
    if (pc > 0 && this.rand() < pc) this.schedulePop(iv * (0.3 + this.rand()), 0.7 + 1.6 * this.rand());
  };

  // Dodaje n próbek do wyjścia (L, R), od pozycji off
  Voice.prototype.render = function (L, R, off, n) {
    if (!this.on) return;
    var sr = this.sr, t = this.t, f = this.flt, s = this.fs;
    var on = t[P.ON] > 0.5;
    var tRpm = clamp(t[P.RPM], 3000, 20000), tLoad = clamp(t[P.LOAD], 0, 1), tGain = on ? clamp(t[P.GAIN], 0, 4) : 0;
    var kR = kTau(0.02, sr), kL = kTau(0.012, sr), kG = kTau(0.03, sr);
    // parametry zmieniane raz na blok
    var bk = 1 - Math.exp(-n / (0.03 * sr));
    this.dop += (clamp(t[P.DOP], 0.5, 2) - this.dop) * (1 - Math.exp(-n / (0.06 * sr)));
    this.onb += (clamp(t[P.ONB], 0, 1) - this.onb) * bk;
    var lpT = 1 - Math.exp(-TWO_PI * clamp(t[P.LP], 200, 20000) / sr);
    this.lpK += (lpT - this.lpK) * bk;
    var pan = clamp(t[P.PAN], -1, 1), a = (pan + 1) * Math.PI / 4;
    var pl0 = this.panL, pr0 = this.panR, pl1 = Math.cos(a), pr1 = Math.sin(a);
    this.panL = pl1; this.panR = pr1;
    var lim = t[P.LIM] > 0.5, pit = t[P.PIT] > 0.5, dmg = t[P.DMG], spd = t[P.SPD];
    var onb = this.onb, lpK = this.lpK, gB = this.gB, kLoop = this.kLoop, DA = this.DA, DB = this.DB;
    var exG = 1 - 0.38 * onb, inG = 0.1 + 0.62 * onb;
    var whG = onb > 0.05 ? 0.004 * onb * clamp(spd / 8, 0, 1) : 0, whF = this.whineK * spd / sr;
    var bufA = this.bufA, bufB = this.bufB, pAge = this.pAge, pLen = this.pLen, pAmp = this.pAmp, pKind = this.pKind, act = this.act;
    var liftK = 1 - Math.exp(-1 / (1.2 * sr));
    for (var i = 0; i < n; i++) {
      this.rpm += (tRpm - this.rpm) * kR;
      this.load += (tLoad - this.load) * kL;
      this.gain += (tGain - this.gain) * kG;
      var ld = this.load;
      // odpuszczenie gazu z pełnego: przez chwilę więcej strzałów
      if (this.lastLoad > 0.5 && ld < 0.1) this.lift = 1;
      this.lastLoad = ld;
      this.lift -= this.lift * liftK;
      // ogranicznik obrotów (ok. 17 Hz) i ogranicznik w alei (ok. 11 Hz): zapłon przerywany seriami
      if (lim || pit) {
        this.cutPh += (pit ? 11 : 17) / sr;
        if (this.cutPh >= 1) { this.cutPh -= 1; this.cutDuty = (pit ? 0.42 : 0.4) + 0.2 * this.rand(); }
        this.limCut = this.cutPh > 1 - this.cutDuty;
      } else this.limCut = false;
      this.limEnv += ((this.limCut ? 1 : 0) - this.limEnv) * 0.002;
      if (this.cutT > 0) this.cutT--;
      if (this.blipT > 0) this.blipT--;
      var rpm = this.rpm * (1 - 0.014 * this.limEnv);
      // zapłony
      var dpf = rpm * this.dop / 12 / sr; // zapłonów na próbkę (10 na 2 obroty)
      this.pf += dpf;
      while (this.pf >= this.nf) {
        var m = this.nf % 10;
        this.fire(m, (this.pf - this.nf) / dpf, 1 / dpf, ld, rpm);
        this.nf++;
        if (this.nf > 10) { this.nf -= 10; this.pf -= 10; }
      }
      // zaplanowane strzały
      for (var q = 0; q < 4; q++) {
        if (this.popT[q] < 0) continue;
        this.popT[q] -= 1;
        if (this.popT[q] < 0) {
          var pa = this.popA[q], ivp = 1 / dpf;
          this.spawn(this.rand() < 0.5 ? 0 : 1, 0, 1.3 * ivp, 0.8 * pa);
          this.spawn(4, 0, 0.003 * sr, 0.3 * pa);
        }
      }
      // suma impulsów
      var sA = 0, sB = 0, rs = 0, inx = 0, cr = 0;
      for (var j = 0; j < this.nAct; j++) {
        var sl = act[j], age = pAge[sl], len = pLen[sl];
        if (age >= len) {
          this.free[this.nFree++] = sl; act[j] = act[--this.nAct]; j--;
          continue;
        }
        pAge[sl] = age + 1;
        if (age < 0) continue;
        var x = age / len, y = 1 - x, kd = pKind[sl];
        if (kd === 3) { var ys = x * y; inx += pAmp[sl] * 16 * ys * ys; continue; } // x²(1−x)², symetryczny
        var y2 = y * y, sh = 45.5625 * x * x * y2 * y2;                         // x²(1−x)⁴: szybki wzrost, wolniejsze opadanie
        if (kd === 0) sA += pAmp[sl] * sh;
        else if (kd === 1) sB += pAmp[sl] * sh;
        else if (kd === 2) rs += pAmp[sl] * sh;
        else cr += pAmp[sl] * sh;
      }
      // szum (xorshift)
      var r = this.rng; r ^= r << 13; r ^= r >>> 17; r ^= r << 5; this.rng = r >>> 0;
      var wn = (this.rng / 2147483648) - 1;
      var r2 = this.rng; r2 ^= r2 << 13; r2 ^= r2 >>> 17; r2 ^= r2 << 5; this.rng = r2 >>> 0;
      var wn2 = (this.rng / 2147483648) - 1;
      // rury wydechowe: falowód z odbiciem na otwartym końcu (odwrócenie fazy) i stratami
      var dA = bufA[(this.wA - DA) & BM]; this.zA += kLoop * (dA - this.zA);
      var yA = sA - 0.5 * this.zA; bufA[this.wA] = yA; this.wA = (this.wA + 1) & BM;
      var dB = bufB[(this.wB - DB) & BM]; this.zB += kLoop * (dB - this.zB);
      var yB = sB - 0.5 * this.zB; bufB[this.wB] = yB; this.wB = (this.wB + 1) & BM;
      var ex = yA + gB * yB;
      // promieniowanie z wylotu (wyższe tony mocniej)
      var rad = 0.3 * ex + 2.2 * (ex - this.exP); this.exP = ex;
      // „wrzask” rury końcowej
      var b0 = f[12], a1 = f[13], a2 = f[14];
      var sc = b0 * rad + s[8]; s[8] = -a1 * sc + s[9]; s[9] = -b0 * rad - a2 * sc;
      // szum spalania
      var rx = rs * wn;
      b0 = f[9]; a1 = f[10]; a2 = f[11];
      var rsf = b0 * rx + s[6]; s[6] = -a1 * rsf + s[7]; s[7] = -b0 * rx - a2 * rsf;
      // dolot: rezonans airboksu i trąbek + szum dolotu
      b0 = f[0]; a1 = f[1]; a2 = f[2];
      var i1 = b0 * inx + s[0]; s[0] = -a1 * i1 + s[1]; s[1] = -b0 * inx - a2 * i1;
      b0 = f[3]; a1 = f[4]; a2 = f[5];
      var i2 = b0 * inx + s[2]; s[2] = -a1 * i2 + s[3]; s[3] = -b0 * inx - a2 * i2;
      var nx = inx * wn2;
      b0 = f[6]; a1 = f[7]; a2 = f[8];
      var i3 = b0 * nx + s[4]; s[4] = -a1 * i3 + s[5]; s[5] = -b0 * nx - a2 * i3;
      var intake = 2.2 * i1 + 1.6 * i2 + 0.9 * i3;
      // strzały: trzask (szum o szybkim zaniku, górnoprzepustowo)
      var cx = cr * wn; var crh = cx - this.crP + 0.97 * this.crY; this.crP = cx; this.crY = crh;
      // wycie skrzyni (tylko z kokpitu)
      var wh = 0;
      if (whG > 0) { this.whPh += whF; if (this.whPh >= 1) this.whPh -= 1; wh = whG * Math.sin(TWO_PI * this.whPh); }
      var mix = exG * (rad + 0.45 * sc + 0.5 * rsf) + inG * intake + 0.6 * crh + wh;
      // nasycenie: na pełnym gazie ostrzej
      var dr = 0.9 + 0.9 * ld, xs = mix * dr;
      if (xs > 3) xs = 3; else if (xs < -3) xs = -3;
      var sat = xs * (27 + xs * xs) / (27 + 9 * xs * xs) / dr;
      // odległość: tłumienie wysokich tonów
      this.lpS += lpK * (sat - this.lpS);
      // bez składowej stałej
      var yo = this.lpS - this.dcX + 0.9975 * this.dcY; this.dcX = this.lpS; this.dcY = yo;
      var o = yo * this.gain, u = i / n;
      L[off + i] += o * (pl0 + (pl1 - pl0) * u);
      R[off + i] += o * (pr0 + (pr1 - pr0) * u);
    }
    if (!on && this.gain < 1e-4) { this.on = false; this.gain = 0; }
  };

  function Engine(sr) {
    this.sr = sr; this.v = [];
    for (var i = 0; i < MAXV; i++) this.v.push(new Voice(sr, i));
  }
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

  root.PG_V10 = { Engine: Engine, NP: NP, MAXV: MAXV, P: P };

  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
    registerProcessor('pg-v10', class extends AudioWorkletProcessor {
      constructor() {
        super();
        var eng = this.eng = new Engine(sampleRate);
        this.port.onmessage = function (ev) { eng.set(ev.data); };
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
