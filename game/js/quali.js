// WORLD GP — kwalifikacje w formacie Q1 / Q2 / Q3: po Q1 odpada stawka powyżej 15. miejsca, po Q2 powyżej 10.,
// Q3 ustala pierwszą dziesiątkę. Czasy AI symulowane z profilu prędkości (z niewielkim przyspieszeniem toru w kolejnych
// segmentach), czasy graczy z przejechanych okrążeń. Logika bez interfejsu — używa jej ekran weekendu i multiplayer.
(function (PG) {
  'use strict';

  var Q = PG.Quali = {};
  Q.NAMES = ['Q1', 'Q2', 'Q3'];

  // Ile bolidów przechodzi dalej z każdego segmentu (20 bolidów: 15, 10)
  function keeps(n) {
    if (n >= 16) return [15, 10];
    var k1 = Math.max(2, n - Math.max(1, Math.round(n * 0.25))), k2 = Math.max(1, Math.min(k1 - 1, Math.round(n * 0.5)));
    return [k1, k2];
  }

  // entries: tablica wpisów (driver, team, isPlayer); format 'q3' albo 'one' (jedno okrążenie)
  Q.create = function (entries, format) {
    var n = entries.length, k = keeps(n), all = [];
    for (var i = 0; i < n; i++) all.push(i);
    return { format: format === 'one' ? 'one' : 'q3', n: n, keep: format === 'one' ? [] : k, seg: 0, alive: all, segRes: [], out: [], final: null };
  };
  Q.segCount = function (st) { return st.format === 'one' ? 1 : 3; };
  Q.segName = function (st, s) { return st.format === 'one' ? 'Kwalifikacje' : Q.NAMES[s === undefined ? st.seg : s]; };
  // Ilu awansuje z bieżącego segmentu (0 = ostatni segment)
  Q.keepNow = function (st) { return st.seg < st.keep.length ? st.keep[st.seg] : 0; };

  // Symulowany czas okrążenia AI w danym segmencie (tor szybszy z każdym segmentem)
  Q.simTime = function (T, e, env, difficulty, seg) {
    return PG.simQualiTime(T, e.team, e.driver, env, difficulty) * (1 - 0.0016 * (seg || 0));
  };

  // Czasy AI w bieżącym segmencie: { idx: czas } dla żyjących wpisów, które nie są graczami
  Q.simulate = function (st, entries, T, env, difficulty, isHuman) {
    var out = {};
    st.alive.forEach(function (i) { if (!isHuman(entries[i], i)) out[i] = Q.simTime(T, entries[i], env, difficulty, st.seg); });
    return out;
  };

  // Czas potrzebny do awansu (najwolniejszy, który jeszcze przechodzi) albo do pole position w ostatnim segmencie
  Q.target = function (st, aiTimes) {
    var arr = Object.keys(aiTimes).map(function (k) { return aiTimes[k]; }).sort(function (a, b) { return a - b; });
    if (!arr.length) return 0;
    var keep = Q.keepNow(st);
    return keep > 0 ? arr[Math.min(arr.length - 1, keep - 1)] : arr[0];
  };

  // Zamknięcie segmentu: times = { idx: czas } dla wszystkich żyjących (brak czasu = bez pomiaru, na końcu stawki)
  Q.complete = function (st, times) {
    var rows = st.alive.map(function (i) { return { i: i, t: times[i] > 0 ? times[i] : 0 }; });
    rows.sort(function (a, b) { return (a.t || 1e9) - (b.t || 1e9); });
    var keep = Q.keepNow(st), seg = st.seg;
    var res = { seg: seg, rows: rows, keep: keep };
    st.segRes.push(res);
    if (keep > 0) {
      var gone = rows.slice(keep);
      // odpadli w późniejszym segmencie startują przed odpadłymi wcześniej
      st.out = gone.map(function (r) { return { i: r.i, t: r.t, seg: seg }; }).concat(st.out);
      st.alive = rows.slice(0, keep).map(function (r) { return r.i; });
      st.seg++;
    } else {
      st.final = rows.map(function (r) { return { i: r.i, t: r.t, seg: seg }; }).concat(st.out);
    }
    return res;
  };
  Q.done = function (st) { return !!st.final; };

  // Cała reszta segmentów symulacją (np. gdy gracz odpadł albo wybrał „Symuluj")
  Q.simulateAll = function (st, entries, T, env, difficulty) {
    while (!Q.done(st)) {
      var t = Q.simulate(st, entries, T, env, difficulty, function () { return false; });
      Q.complete(st, t);
    }
    return st.final;
  };
})(PG);
