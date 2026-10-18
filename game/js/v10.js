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
//
// Z paczką dźwięków F1 25 (enginepack.js) głos gra zamiast syntezy nagrania silnika producenta
// (synteza ziarnista z oznaczonych cykli silnika, zob. „nagrania z paczki” niżej).
(function (root) {
  'use strict';

  // Parametry głosu (po NP liczb na głos, głos 0 to bolid w kamerze, kolejne to rywale)
  var NP = 17, MAXV = 5;
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
    RESET: 15,  // licznik: nowy bolid w tym głosie
    BANK: 16    // 0 — synteza V10, k — nagrania silnika z banku k−1 (paczka dźwięków)
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

  function Voice(sr, idx, eng) {
    this.sr = sr; this.idx = idx; this.eng = eng || null;
    // nagrania: bank, 4 strumienie ziaren (mikrofon A gaz/bez gazu, mikrofon B gaz/bez gazu), bufory bloku
    this.bk = null; this.st = [new Stream(), new Stream(), new Stream(), new Stream()];
    this.acc = new Float64Array(128); this.rb = new Float32Array(128); this.wOn = new Float32Array(128); this.wOff = new Float32Array(128);
    this.pcE = 0; this.pcP = 0; this.pbE = 0; this.pbF = 0; this.pbPh = 0;
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
    for (i = 0; i < 4; i++) this.st[i].on = false;
    this.pcE = 0; this.pbE = 0;
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
    // bank nagrań (0 — synteza)
    var bi = t[P.BANK] | 0, banks = this.eng && this.eng.banks, bk = bi > 0 && banks ? banks[bi - 1] || null : null;
    if (bk !== this.bk) { this.bk = bk; for (var s = 0; s < 4; s++) this.st[s].on = false; }
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
    if (this.bk) { this.renderBank(L, R, off, n); return; }
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

  // ---------- nagrania z paczki (synteza ziarnista) ----------
  // Bank: { idle, top, cyl, mics: [{ on, off, g }, …] } (enginepack.js). Warstwa to jedno nagranie przemiatania
  // obrotów (gaz albo hamowanie silnikiem) ze znacznikami pełnych cykli silnika. Odtwarzanie jak TD-PSOLA:
  // ziarno to dwa cykle z oknem Hanna wokół znacznika, co jeden cykl wchodzi następne. Odstęp między ziarnami
  // to okres cyklu przy docelowych obrotach, a szybkość odczytu dopasowuje wysokość dźwięku. Ziarna idą po kolei
  // jak w nagraniu, wahadłowo w oknie kilkunastu cykli wokół miejsca o właściwych obrotach (brzmienie nie zastyga),
  // z głośnością miejsca docelowego; przy ograniczniku i na jałowych kursor wędruje po stałym zakresie z końca
  // nagrania. Między nagraniem z gazem i bez gazu przejście o stałej mocy, mikrofon B (bliżej silnika) z kokpitu.
  var HN = 1024, HANN = new Float32Array(HN + 1), EQP = new Float32Array(HN + 1);
  for (var hi = 0; hi <= HN; hi++) { HANN[hi] = 0.5 + 0.5 * Math.cos(Math.PI * hi / HN); EQP[hi] = Math.sin(Math.PI / 2 * hi / HN); }

  function Stream() {
    this.on = false; this.ph = 0; this.cur = 0; this.W = 8; this.plat = false; this.dir = 1; this.t = 0; this.vt = 0; this.ga = 1;
    this.aP = 0; this.aI = 0; this.aA = 0;          // ziarno wygasające: pozycja w nagraniu, 1/obroty odniesienia, amplituda
    this.bP = 0; this.bI = 0; this.bA = 0; this.bQ = 1; // ziarno narastające (+ 1/okres w próbkach nagrania)
  }

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
    var inPl = z - b >= 8 && (Ly.up ? R >= Ly.pt * (st.plat ? 0.992 : 1) : R <= Ly.pt * (st.plat ? 1.008 : 1));
    if (inPl) {
      // stały zakres z końca nagrania (ogranicznik, jałowe): wahadło, zawracanie w losowych miejscach
      if (!st.plat || cur < b || cur > z) { c = b + ((this.rand() * Math.min(8, (z - b) >> 1)) | 0); st.dir = 1; st.W = 0; }
      else {
        c = cur + st.dir;
        if (st.dir > 0 && c > z - st.W) { st.dir = -1; c = cur - 1; st.W = this.rand() * (z - b) * 0.3; }
        else if (st.dir < 0 && c < b + st.W) { st.dir = 1; c = cur + 1; st.W = this.rand() * (z - b) * 0.3; }
      }
      st.plat = true; st.cur = c; st.vt = 0; st.ga = 1;
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
    // głośność ziarna jak w miejscu docelowym
    var lv = Ly.lv, ti = t | 0, lt = lv[ti] + (lv[ti + 1] - lv[ti]) * (t - ti), ga = lt / lv[c];
    st.plat = false; st.cur = c; st.ga = ga < 0.5 ? 0.5 : ga > 2 ? 2 : ga;
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

  Voice.prototype.renderBank = function (L, R, off, n) {
    var sr = this.sr, t = this.t, bk = this.bk, i;
    var on = t[P.ON] > 0.5;
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
    var sc = (bk.top - bk.idle) / 14500, rb = this.rb, wOn = this.wOn, wOff = this.wOff;
    var liftK = 1 - Math.exp(-1 / (1.2 * sr));
    for (i = 0; i < n; i++) {
      this.rpm += (tRpm - this.rpm) * kR;
      this.gain += (tGain - this.gain) * kG;
      // ogranicznik obrotów (ok. 17 Hz) i w alei (ok. 11 Hz): przerwy w zapłonie seriami
      if (lim || pit) {
        this.cutPh += (pit ? 11 : 17) / sr;
        if (this.cutPh >= 1) { this.cutPh -= 1; this.cutDuty = (pit ? 0.42 : 0.4) + 0.2 * this.rand(); }
        this.limCut = this.cutPh > 1 - this.cutDuty;
      } else this.limCut = false;
      this.limEnv += ((this.limCut ? 1 : 0) - this.limEnv) * 0.002;
      if (this.cutT > 0) this.cutT--;
      if (this.blipT > 0) this.blipT--;
      var tl = tLoad;
      if (this.blipT > 0) tl = Math.max(tl, 0.8);                    // międzygaz przy redukcji
      if (this.cutT > 0) tl = 0;                                      // przerwa zapłonu przy zmianie w górę
      else if (this.limCut) tl = pit ? 0.05 : 0.15;
      this.load += (tl - this.load) * kL;
      var ld = this.load;
      if (this.lastLoad > 0.5 && ld < 0.1) this.lift = 1;
      this.lastLoad = ld; this.lift -= this.lift * liftK;
      // obroty w grze (4500..19000) → obroty nagrań (jałowe..ogranicznik)
      var x = bk.idle + (this.rpm * (1 - 0.014 * this.limEnv) - 4500) * sc;
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
    // strzały z wydechu: po odpuszczeniu gazu na wysokich obrotach i na ogranicznikach (V6 hybrydy — rzadziej)
    var pk = bk.cyl === 6 ? 0.35 : 1, hr = clamp((this.rpm - 4500) / 14500, 0, 1), pc = 0;
    if (this.load < 0.12 && this.rpm > 9000) pc = (0.2 + 1.6 * hr) * (1 + 3 * this.lift) * pk;
    if (this.limCut) pc = Math.max(pc, 3 * pk);
    if (pc > 0 && this.rand() < pc * n / sr) this.schedulePop(this.rand() * n, 0.7 + 1.6 * this.rand());
    var dC = Math.exp(-1 / (0.0025 * sr)), dB = Math.exp(-1 / (0.02 * sr));
    var whG = onb > 0.05 ? 0.004 * onb * clamp(spd / 8, 0, 1) : 0, whF = this.whineK * spd / sr, lpK = this.lpK;
    for (i = 0; i < n; i++) {
      for (var q = 0; q < 4; q++) {
        if (this.popT[q] < 0) continue;
        this.popT[q] -= 1;
        if (this.popT[q] < 0) { var pa = this.popA[q] * pk; this.pcE += 0.3 * pa; this.pbE += 0.22 * pa; this.pbF = (65 + 55 * this.rand()) / sr; this.pbPh = 0; }
      }
      var y = acc[i] * (1 / 32768);
      if (this.pcE > 1e-4) { var wn = this.rand() * 2 - 1; y += this.pcE * (wn - this.pcP); this.pcP = wn; this.pcE *= dC; }
      if (this.pbE > 1e-4) { this.pbPh += this.pbF; y += this.pbE * Math.sin(TWO_PI * this.pbPh); this.pbE *= dB; }
      if (whG > 0) { this.whPh += whF; if (this.whPh >= 1) this.whPh -= 1; y += whG * Math.sin(TWO_PI * this.whPh); }
      this.lpS += lpK * (y - this.lpS);
      var yo = this.lpS - this.dcX + 0.9975 * this.dcY; this.dcX = this.lpS; this.dcY = yo;
      var o = yo * this.gain, u = i / n;
      L[off + i] += o * (pl0 + (pl1 - pl0) * u);
      R[off + i] += o * (pr0 + (pr1 - pr0) * u);
    }
    if (!on && this.gain < 1e-4) { this.on = false; this.gain = 0; }
  };

  function Engine(sr) {
    this.sr = sr; this.v = []; this.banks = null;
    for (var i = 0; i < MAXV; i++) this.v.push(new Voice(sr, i, this));
  }
  // Banki nagrań z paczki (albo null — tylko synteza)
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

  root.PG_V10 = { Engine: Engine, NP: NP, MAXV: MAXV, P: P };

  if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor === 'function') {
    registerProcessor('pg-v10', class extends AudioWorkletProcessor {
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
