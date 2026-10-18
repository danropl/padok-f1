// WORLD GP — dźwięki silników z paczki do gry F1 25 (pliki .bdl), wczytywane z dysku gracza.
//
// Gra nie zawiera tych nagrań (należą do EA/Codemasters). Gracz wskazuje paczkę na swoim dysku
// (Ustawienia → Dźwięk: plik ZIP, pliki .bdl albo rozpakowany folder), a wybrany zestaw zostaje tylko
// w jego przeglądarce (IndexedDB). Nic nie jest nigdzie wysyłane.
//
// Format .bdl (silnik EGO): pakiet „bndl” z sekcjami „egoe” (wersje r, v, w). Sekcja to jedno nagranie
// przemiatania obrotów: nagłówek (próbkowanie pod +0x34, liczba cylindrów +0x40, długość bloku danych +0x44,
// początek końcowego, stałego zakresu obrotów +0x48), potem [u32 n][n próbek PCM 16 bit mono]
// [u32 nc][nc × f32: obroty, równo w czasie][u32 nm][nm × f64: znaczniki] i lista pętli. Znaczniki to początki
// kolejnych pełnych cykli silnika (2 obroty wału), z dokładnością do ułamka próbki. Zwykle 4 sekcje: gaz
// (obroty rosną aż do ogranicznika) i hamowanie silnikiem (maleją do jałowych) z dwóch mikrofonów.
(function (PG) {
  'use strict';
  var EP = PG.EnginePack = { ready: false, info: null, banks: [], map: {}, sets: null, source: '', busy: false, progress: 0, error: '' };

  // Producenci w grze → nagrania w paczce (pliki z F1 25: *_2025 dla bolidów 2025, *_2026 dla 2026)
  var KEYS = ['ferrari', 'mercedes', 'honda', 'renault'];
  var LABEL = { ferrari: 'Ferrari', mercedes: 'Mercedes', honda: 'Honda', renault: 'Renault' };
  var ENGINE_OF = { Ferro: 'ferrari', Stella: 'mercedes', Honta: 'honda', Renova: 'renault' };
  var PREF = {
    ferrari: ['ferrari_2025', 'ferrari_2026', 'ferrari'],
    mercedes: ['mercedes_2025', 'mercedes_2026', 'mercedes'],
    // w paczkach slot renault_2026 to zwykle Honda, a audi/ford_2026 to dawne Renault
    honda: ['honda_2025', 'honda_2026', 'honda', 'renault_2026', 'ford_2026', 'audi_2026'],
    renault: ['renault_2025', 'renault', 'audi_2026', 'ford_2026', 'renault_2026']
  };
  EP.LABEL = LABEL; EP.ENGINE_OF = ENGINE_OF;

  // ---------- odczyt .bdl ----------
  function tryAt(dv, p, e) {
    if (p < 0 || p + 16 > e) return null;
    var n = dv.getUint32(p, true);
    if (n < 20000 || n > 8000000) return null;
    var q = p + 4 + 2 * n; if (q + 8 > e) return null;
    var nc = dv.getUint32(q, true); if (nc < 8 || nc > 65536) return null;
    var r = q + 4 + 4 * nc; if (r + 12 > e) return null;
    var nm = dv.getUint32(r, true); if (nm < 16 || nm > 200000 || r + 4 + 8 * nm > e) return null;
    var prev = -Infinity, i;
    for (i = 0; i < Math.min(nm, 48); i++) { var m = dv.getFloat64(r + 4 + 8 * i, true); if (!(m > prev) || m > n) return null; prev = m; }
    if (dv.getFloat64(r + 4, true) < -2) return null;
    for (i = 0; i < nc; i += 7) { var c = dv.getFloat32(q + 4 + 4 * i, true); if (!(c > 300 && c < 40000)) return null; }
    return { p: p, n: n, q: q, nc: nc, r: r, nm: nm };
  }
  function findLayout(dv, s, e) {
    var r = tryAt(dv, s + 0x48 + dv.getUint32(s + 0x44, true), e); // zwykle blok ma długość podaną w nagłówku
    if (r) return r;
    var lim = Math.min(e - 16, s + 0x20000);
    for (var p = s + 8; p < lim; p += 2) { r = tryAt(dv, p, e); if (r) return r; }
    return null;
  }
  // Sekcje z nagraniami: [{ sr, cyl, plat, pcm: Int16Array, curve: Float32Array, mk: Float64Array }]
  EP.parseBdl = function (u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), N = u8.length, out = [], pos = 0, o = u8.byteOffset;
    while (pos < N - 0x80) {
      var s = -1;
      for (var i = pos; i < N - 4; i++) if (u8[i] === 0x65 && u8[i + 1] === 0x67 && u8[i + 2] === 0x6f && u8[i + 3] === 0x65) { s = i; break; }
      if (s < 0 || s + 0x80 > N) break;
      var L = findLayout(dv, s, N);
      if (!L) { pos = s + 4; continue; }
      var sr = dv.getUint32(s + 0x34, true), cyl = dv.getUint32(s + 0x40, true);
      out.push({
        sr: sr >= 8000 && sr <= 192000 ? sr : 48000, cyl: cyl >= 1 && cyl <= 24 ? cyl : 0, plat: dv.getUint32(s + 0x48, true),
        // kopie (wyrównane w pamięci)
        pcm: new Int16Array(u8.buffer.slice(o + L.p + 4, o + L.p + 4 + 2 * L.n)),
        curve: new Float32Array(u8.buffer.slice(o + L.q + 4, o + L.q + 4 + 4 * L.nc)),
        mk: new Float64Array(u8.buffer.slice(o + L.r + 4, o + L.r + 4 + 8 * L.nm))
      });
      pos = L.r + 4 + 8 * L.nm;
    }
    return out;
  };

  // regresja izotoniczna (niemalejąca), algorytm PAVA
  function isotonic(a) {
    var val = [], wt = [], i;
    for (i = 0; i < a.length; i++) {
      val.push(a[i]); wt.push(1);
      while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
        var w = wt[wt.length - 2] + wt[wt.length - 1], v = (val[val.length - 2] * wt[wt.length - 2] + val[val.length - 1] * wt[wt.length - 1]) / w;
        val.pop(); wt.pop(); val[val.length - 1] = v; wt[wt.length - 1] = w;
      }
    }
    var o = new Float64Array(a.length), k = 0;
    for (var b = 0; b < val.length; b++) for (var r = 0; r < wt[b]; r++) o[k++] = val[b];
    return o;
  }

  // Warstwa do odtwarzania: okres i obroty każdego cyklu, zakres przemiatania [a, b) i stały zakres [b, z]
  function prepLayer(sec) {
    var mk = sec.mk, M = mk.length, sr = sec.sr, i, k;
    var per = new Float32Array(M), raw = new Float64Array(M), sm = new Float64Array(M);
    for (i = 0; i < M; i++) {
      var d = i === 0 ? mk[1] - mk[0] : i === M - 1 ? mk[M - 1] - mk[M - 2] : (mk[i + 1] - mk[i - 1]) / 2;
      per[i] = d; raw[i] = 120 * sr / d;
    }
    for (i = 0; i < M; i++) { var s = 0, c = 0; for (k = Math.max(0, i - 4); k <= Math.min(M - 1, i + 4); k++) { s += raw[k]; c++; } sm[i] = s / c; }
    var cv = sec.curve, up = cv[cv.length - 1] > cv[0];
    var a = 2, z = M - 3, b = sec.plat;
    if (!(b > a + 16 && b < z - 4)) {
      // bez wskazówki w nagłówku: tam, gdzie obroty przestają się zmieniać
      var ext = sm[z];
      for (i = Math.floor(z * 0.9); i <= z; i++) ext = up ? Math.max(ext, sm[i]) : Math.min(ext, sm[i]);
      b = z - 4;
      for (i = a; i < z - 4; i++) if (up ? sm[i] >= ext * 0.985 : sm[i] <= ext * 1.015) { b = i; break; }
      if (b < a + 16) b = Math.min(z - 4, a + 16);
    }
    // rpm: obroty monotonicznie w zakresie przemiatania (do szukania miejsca w nagraniu),
    // rf: średnia z kilku cykli (odniesienie wysokości dźwięku ziarna)
    var seg = [];
    for (i = a; i < b; i++) seg.push(up ? sm[i] : -sm[i]);
    var iso = isotonic(seg), rpm = new Float32Array(M), rf = new Float32Array(M);
    for (i = 0; i < M; i++) { rpm[i] = sm[i]; rf[i] = sm[i]; }
    for (i = a; i < b; i++) rpm[i] = up ? iso[i - a] : -iso[i - a];
    // okno wędrówki po nagraniu: tyle cykli, ile mieści się w ok. ±4 % obrotów (8..28)
    var wn = new Uint8Array(M);
    for (i = 0; i < M; i++) {
      var i0 = Math.max(a, i - 4), i1 = Math.min(b - 1, i + 4), sl = i1 > i0 ? Math.abs(rpm[i1] - rpm[i0]) / (i1 - i0) : 0;
      wn[i] = Math.max(8, Math.min(28, Math.round(0.04 * rpm[i] / Math.max(sl, 1e-3))));
    }
    var pl = [];
    for (i = b; i <= z; i++) pl.push(sm[i]);
    pl.sort(function (x, y) { return x - y; });
    var pr = pl.length ? pl[pl.length >> 1] : rpm[b - 1], re = rpm[b - 1];
    var pcm = sec.pcm, s0 = Math.max(0, Math.floor(mk[a])), s1 = Math.min(pcm.length, Math.floor(mk[b])), ss = 0;
    for (i = s0; i < s1; i += 2) ss += pcm[i] * pcm[i];
    // głośność cykli (średnia z ±3): ziarno z okna wokół celu gra z głośnością miejsca docelowego,
    // więc wahadło przez rezonans nie pulsuje
    var e2 = new Float64Array(M), lv = new Float32Array(M);
    for (i = 0; i < M - 1; i++) {
      var q0 = Math.max(0, Math.floor(mk[i])), q1 = Math.min(pcm.length, Math.floor(mk[i + 1])), se = 0;
      for (k = q0; k < q1; k++) se += pcm[k] * pcm[k];
      e2[i] = se / Math.max(1, q1 - q0);
    }
    e2[M - 1] = e2[M - 2];
    for (i = 0; i < M; i++) { var sv = 0, cn = 0; for (k = Math.max(0, i - 3); k <= Math.min(M - 1, i + 3); k++) { sv += e2[k]; cn++; } lv[i] = Math.sqrt(sv / cn) + 1; }
    // pętla w stałym zakresie (ogranicznik, jałowe) grana do przodu, jak nagrano: koniec le i początek ls
    // dobrane tak, by cykl le był jak najbardziej podobny do cyklu ls−1 (wtedy przejście jest niesłyszalne)
    var ls = b, le = z;
    if (z - b >= 24) {
      var K = 128, cyc = function (j) {
        var o = new Float64Array(K), a0 = mk[j], st = (mk[j + 1] - a0) / K, mean = 0, nn = 0, q;
        for (q = 0; q < K; q++) { var x = a0 + q * st, xi = Math.floor(x), fr = x - xi; o[q] = pcm[xi] + (pcm[xi + 1] - pcm[xi]) * fr; mean += o[q]; }
        mean /= K;
        for (q = 0; q < K; q++) { o[q] -= mean; nn += o[q] * o[q]; }
        nn = Math.sqrt(nn) || 1;
        for (q = 0; q < K; q++) o[q] /= nn;
        return o;
      };
      var best = -2, span = Math.min(12, (z - b) >> 2), starts = [];
      for (k = b + 1; k <= b + span; k++) starts.push(cyc(k - 1));
      for (var e = z - span; e <= z; e++) {
        var ce = cyc(e);
        for (k = 0; k < starts.length; k++) {
          var r = 0, cs = starts[k];
          for (var q2 = 0; q2 < K; q2++) r += ce[q2] * cs[q2];
          if (r > best) { best = r; ls = b + 1 + k; le = e; }
        }
      }
    }
    return {
      pcm: pcm, sr: sr, mk: mk, per: per, rpm: rpm, rf: rf, wn: wn, lv: lv, a: a, b: b, z: z, ls: ls, le: le, up: up, pr: pr, re: re, rs: rpm[a],
      a2: a + Math.min(20, (b - a) >> 3), // początek nagrania (otwarcie/zamknięcie przepustnicy) tylko po skoku, nie w wahadle
      pt: up ? Math.min(re, pr) * 0.998 : Math.max(re, pr) * 1.002, // od tych obrotów stały zakres (ogranicznik / jałowe)
      rms: Math.sqrt(ss / Math.max(1, (s1 - s0) / 2)) / 32768, cyl: sec.cyl
    };
  }
  function sameMarks(x, y) {
    if (x.mk.length !== y.mk.length || x.pcm.length !== y.pcm.length) return false;
    for (var i = 0; i < x.mk.length; i++) if (x.mk[i] !== y.mk[i]) return false;
    return true;
  }
  // Bank jednego silnika: obroty jałowe i ogranicznika z nagrań, dwa mikrofony (przy wydechu, bliżej silnika)
  function prepBank(secs, name) {
    var ons = [], offs = [];
    secs.forEach(function (s) { if (s.mk.length >= 40) (s.curve[s.curve.length - 1] > s.curve[0] ? ons : offs).push(s); });
    if (!ons.length || !offs.length) return null;
    var mics = [];
    for (var m = 0; m < 2; m++) {
      var so = ons[Math.min(m, ons.length - 1)], sf = offs[Math.min(m, offs.length - 1)];
      if (m === 1 && sameMarks(so, ons[0]) && sameMarks(sf, offs[0])) { mics.push(mics[0]); break; }
      var on = prepLayer(so), off = prepLayer(sf), g = 0.2 / Math.max(0.02, on.rms); // ta sama głośność gazu w każdym banku
      mics.push({ on: on, off: off, g: g, go: g * 0.71 });                       // bez gazu o 3 dB ciszej: wyraźniej słychać odpuszczenie
    }
    var A = mics[0], idle = A.off.pr, top = A.on.pr;
    if (!(top > idle * 1.5)) { idle = Math.min(A.off.re, A.on.rs); top = Math.max(A.on.re, A.off.rs); }
    return { name: name, cyl: A.on.cyl, idle: idle, top: top, mics: mics };
  }
  EP.prepBank = prepBank;

  // ---------- źródła: ZIP, pliki .bdl, folder ----------
  function readSlice(file, a, b) { return file.slice(a, b).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  function u64(dv, o) { return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296; }
  function zipEntries(file) {
    var size = file.size, tail = Math.min(size, 65557 + 20);
    var cnt, cdSize, cdOff;
    return readSlice(file, size - tail, size).then(function (u8) {
      var dv = new DataView(u8.buffer), e = -1;
      for (var i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
      if (e < 0) throw new Error('To nie jest plik ZIP.');
      cnt = dv.getUint16(e + 10, true); cdSize = dv.getUint32(e + 12, true); cdOff = dv.getUint32(e + 16, true);
      if (cdOff !== 0xffffffff && cdSize !== 0xffffffff && cnt !== 0xffff) return null;
      var l = e - 20; // ZIP64: lokalizator tuż przed końcem katalogu
      if (l < 0 || dv.getUint32(l, true) !== 0x07064b50) throw new Error('Nieobsługiwany format ZIP.');
      var ro = u64(dv, l + 8);
      return readSlice(file, ro, ro + 56).then(function (r) {
        var d = new DataView(r.buffer);
        if (d.getUint32(0, true) !== 0x06064b50) throw new Error('Nieobsługiwany format ZIP.');
        cnt = u64(d, 32); cdSize = u64(d, 40); cdOff = u64(d, 48);
      });
    }).then(function () { return readSlice(file, cdOff, cdOff + cdSize); }).then(function (cd) {
      var d = new DataView(cd.buffer), o = 0, list = [];
      while (o + 46 <= cd.length && d.getUint32(o, true) === 0x02014b50) {
        var flags = d.getUint16(o + 8, true), meth = d.getUint16(o + 10, true), crc = d.getUint32(o + 16, true);
        var csz = d.getUint32(o + 20, true), usz = d.getUint32(o + 24, true), lho = d.getUint32(o + 42, true);
        var nl = d.getUint16(o + 28, true), xl = d.getUint16(o + 30, true), cl = d.getUint16(o + 32, true);
        var nb = cd.subarray(o + 46, o + 46 + nl), name = '';
        if (typeof TextDecoder !== 'undefined' && (flags & 0x800)) name = new TextDecoder('utf-8').decode(nb);
        else for (var j = 0; j < nb.length; j++) name += String.fromCharCode(nb[j]);
        // ZIP64: rozmiary i położenie w polu dodatkowym 0x0001
        for (var x = o + 46 + nl, xe = x + xl; x + 4 <= xe;) {
          var id = d.getUint16(x, true), ln = d.getUint16(x + 2, true), y = x + 4;
          if (id === 1) {
            if (usz === 0xffffffff && y + 8 <= x + 4 + ln) { usz = u64(d, y); y += 8; }
            if (csz === 0xffffffff && y + 8 <= x + 4 + ln) { csz = u64(d, y); y += 8; }
            if (lho === 0xffffffff && y + 8 <= x + 4 + ln) { lho = u64(d, y); }
          }
          x += 4 + ln;
        }
        list.push({ path: name, size: usz, csize: csz, method: meth, crc: crc, off: lho, zip: file });
        o += 46 + nl + xl + cl;
      }
      list.forEach(function (en) { en.read = function () { return readEntry(en); }; });
      return list;
    });
  }
  function readEntry(en) {
    return readSlice(en.zip, en.off, en.off + 30).then(function (h) {
      var d = new DataView(h.buffer);
      if (d.getUint32(0, true) !== 0x04034b50) throw new Error('Uszkodzony plik ZIP.');
      var st = en.off + 30 + d.getUint16(26, true) + d.getUint16(28, true);
      return readSlice(en.zip, st, st + en.csize);
    }).then(function (data) {
      if (en.method === 0) return data;
      if (en.method !== 8) throw new Error('Nieobsługiwana kompresja w pliku ZIP.');
      return inflate(data, en);
    });
  }
  // Rozpakowanie (deflate) wbudowanym strumieniem przeglądarki; gdy brak „deflate-raw”, przez nagłówek gzip
  function inflate(u8, en) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Ta przeglądarka nie rozpakowuje plików ZIP. Rozpakuj paczkę i wskaż jej folder albo pliki .bdl.'));
    var src;
    try { src = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    catch (e) {
      var hd = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]), tl = new Uint8Array(8), dt = new DataView(tl.buffer);
      dt.setUint32(0, en.crc >>> 0, true); dt.setUint32(4, en.size >>> 0, true);
      src = new Blob([hd, u8, tl]).stream().pipeThrough(new DecompressionStream('gzip'));
    }
    return new Response(src).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function fileEntries(files) {
    return files.map(function (f) {
      return { path: f.webkitRelativePath || f.name, size: f.size, crc: null, read: function () { return f.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); } };
    });
  }
  function baseName(p) { var s = p.replace(/\\/g, '/').split('/'); return s[s.length - 1]; }
  // Zestawy: folder nad „F1 25/audio/…” (tak jest w paczce); luźne pliki to jeden zestaw
  function groupSets(entries) {
    var sets = [], by = {};
    entries.forEach(function (en) {
      if (!/\.bdl$/i.test(en.path) || !(en.size > 100000)) return;
      var parts = en.path.replace(/\\/g, '/').split('/').filter(Boolean), name = null;
      for (var i = 1; i < parts.length; i++) if (/^f1 ?25$/i.test(parts[i])) { name = parts[i - 1]; break; }
      if (!name) name = parts.length > 1 ? parts[parts.length - 2] : 'Pliki .bdl';
      var s = by[name];
      if (!s) { s = by[name] = { name: name, files: {}, count: 0 }; sets.push(s); }
      var key = baseName(en.path).toLowerCase().replace(/\.bdl$/, '');
      if (!s.files[key]) { s.files[key] = en; s.count++; }
    });
    sets.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return sets;
  }
  // Domyślny zestaw: bolidy 2024 (F1 24), potem F1 25, potem pierwszy
  EP.defaultSet = function (sets) {
    var tests = [/f1 ?24/i, /f1 ?25/i, /f1 ?23/i];
    for (var t = 0; t < tests.length; t++) for (var i = 0; i < sets.length; i++) if (tests[t].test(sets[i].name)) return sets[i];
    return sets[0] || null;
  };

  // Wybrane pliki (ZIP albo .bdl, także cały folder) → lista zestawów
  EP.open = function (files) {
    var list = Array.prototype.slice.call(files || []), zip = null, bdl = [];
    list.forEach(function (f) { if (/\.zip$/i.test(f.name)) zip = zip || f; else if (/\.bdl$/i.test(f.name)) bdl.push(f); });
    if (!zip && !bdl.length) return Promise.reject(new Error('Wybierz plik ZIP z paczką albo pliki .bdl.'));
    var p = zip ? zipEntries(zip) : Promise.resolve(fileEntries(bdl));
    return p.then(function (entries) {
      var sets = groupSets(entries);
      if (!sets.length) throw new Error('W wybranych plikach nie ma dźwięków silników (.bdl).');
      EP.sets = sets; EP.source = zip ? zip.name : bdl.length + ' plików .bdl';
      notify();
      return sets;
    });
  };

  // Instalacja zestawu: 4 producentów (te same pliki tylko raz), sprawdzenie, zapis w przeglądarce
  EP.install = function (set) {
    if (EP.busy) return Promise.reject(new Error('Trwa wczytywanie paczki.'));
    var pick = {}, uniq = [], idOf = {}, anyKey = Object.keys(set.files)[0];
    KEYS.forEach(function (k) {
      var en = null;
      for (var i = 0; i < PREF[k].length && !en; i++) en = set.files[PREF[k][i]] || null;
      if (!en) en = set.files[anyKey];
      var id = en.crc != null ? en.crc + ':' + en.size : en.path + ':' + en.size;
      if (!(id in idOf)) { idOf[id] = uniq.length; uniq.push(en); }
      pick[k] = idOf[id];
    });
    EP.busy = true; EP.progress = 0; EP.error = ''; notify();
    var blobs = [], names = [], banks = [];
    return uniq.reduce(function (pr, en, i) {
      return pr.then(function () { return en.read(); }).then(function (u8) {
        var bank = prepBank(EP.parseBdl(u8), baseName(en.path));
        if (!bank) throw new Error('Plik ' + baseName(en.path) + ' nie zawiera nagrań silnika w znanym formacie.');
        banks.push(bank); names.push(baseName(en.path));
        blobs.push(u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);
        EP.progress = (i + 1) / uniq.length; notify();
      });
    }, Promise.resolve()).then(function () {
      var rec = { v: 1, set: set.name, date: Date.now(), blobs: blobs, names: names, map: pick };
      return dbOp('readwrite', function (st) { return st.put(rec, 'current'); }).then(function () { return false; }, function (e) {
        console.warn('Paczka dźwięków: nie udało się zapisać w przeglądarce', e); return true;
      }).then(function (unsaved) {
        rec.blobs = null; rec.unsaved = unsaved;
        useRecord(rec, banks, blobs.reduce(function (s, b) { return s + b.byteLength; }, 0));
        EP.busy = false; notify();
        return EP.info;
      });
    }).catch(function (e) { EP.busy = false; EP.error = e && e.message ? e.message : String(e); notify(); throw e; });
  };

  function useRecord(rec, banks, bytes) {
    if (!banks) banks = rec.blobs.map(function (ab, i) {
      var b = prepBank(EP.parseBdl(new Uint8Array(ab)), rec.names[i]);
      if (!b) throw new Error('Zapisana paczka jest uszkodzona.');
      return b;
    });
    if (bytes == null) bytes = rec.blobs.reduce(function (s, b) { return s + b.byteLength; }, 0);
    EP.banks = banks; EP.map = {};
    Object.keys(ENGINE_OF).forEach(function (e) { EP.map[e] = rec.map[ENGINE_OF[e]] | 0; });
    EP.info = { set: rec.set, names: rec.names, keys: rec.map, bytes: bytes, unsaved: !!rec.unsaved, date: rec.date,
      cyl: banks[0].cyl, rpm: [Math.round(banks[0].idle), Math.round(banks[0].top)] };
    EP.ready = true;
    if (PG.Audio && PG.Audio.setBanks) PG.Audio.setBanks(banks, EP.map);
  }

  // Zapisana paczka (przy starcie gry)
  EP.load = function () {
    return dbOp('readonly', function (st) { return st.get('current'); }).then(function (rec) {
      if (rec && rec.blobs && rec.blobs.length) { useRecord(rec); notify(); }
      return EP.info;
    }).catch(function (e) { console.warn('Paczka dźwięków: nie udało się wczytać', e); return null; });
  };
  EP.remove = function () {
    EP.ready = false; EP.banks = []; EP.map = {}; EP.info = null; EP.error = '';
    if (PG.Audio && PG.Audio.setBanks) PG.Audio.setBanks(null, null);
    notify();
    return dbOp('readwrite', function (st) { return st.delete('current'); }).catch(function () {});
  };

  // ---------- IndexedDB ----------
  var DBN = 'worldgp-engine-pack', STN = 'pack';
  function dbOpen() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === 'undefined') { rej(new Error('Brak IndexedDB')); return; }
      var r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains(STN)) r.result.createObjectStore(STN); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB')); };
      r.onblocked = function () { rej(new Error('IndexedDB zablokowane')); };
    });
  }
  function dbOp(mode, fn) {
    return dbOpen().then(function (d) {
      return new Promise(function (res, rej) {
        var tx, out;
        try { tx = d.transaction(STN, mode); } catch (e) { d.close(); rej(e); return; }
        var rq = fn(tx.objectStore(STN));
        if (rq) rq.onsuccess = function () { out = rq.result; };
        tx.oncomplete = function () { d.close(); res(out); };
        tx.onerror = tx.onabort = function () { d.close(); rej(tx.error || new Error('IndexedDB')); };
      });
    });
  }

  // ---------- powiadomienia (ekran ustawień) ----------
  var subs = [];
  EP.onChange = function (fn) { subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; };
  function notify() { subs.slice().forEach(function (fn) { try { fn(EP); } catch (e) { console.warn(e); } }); }
})(PG);
