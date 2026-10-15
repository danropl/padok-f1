// WORLD GP — multiplayer: lobby (tworzenie, lista, dołączanie kodem lub linkiem), wybór zespołu i kierowcy,
// gotowość, ustawienia hosta, kwalifikacje Q1–Q3 online, pola startowe z wyborem opon, wyścig i wyniki.
// Host prowadzi lobby, AI, dyrekcję wyścigu i klasyfikację; każdy gracz prowadzi fizykę własnego bolidu,
// a pozostałe bolidy widzi jako „lalki" ze stanem z sieci (interpolacja z opóźnieniem ~0,1 s).
(function (PG) {
  'use strict';
  var UI = PG.UI, G = PG.Game, Net = PG.Net, Store = PG.Store, h = UI.h;
  function U() { return UI._; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function num(x, d) { return (typeof x === 'number' && isFinite(x)) ? x : d; }
  function angDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  var SURF = ['asphalt', 'gravel', 'grass', 'kerb', 'runoff'];
  var DEF_CFG = { track: 'monza', laps: 5, weather: 'sun', difficulty: 'normal', ai: true, quali: 'q3', inc: 'rare', wear: 'auto', damage: 'full', max: 8, priv: false };
  var RC_TXT = {
    sc: ['SAMOCHÓD BEZPIECZEŃSTWA', 'Bez wyprzedzania'], vsc: ['WIRTUALNY SAMOCHÓD BEZPIECZEŃSTWA', 'Zwolnij do limitu'],
    vscEnd: ['VSC KOŃCZY SIĘ', 'Przygotuj się do zielonej flagi'], scIn: ['SC ZJEŻDŻA W TYM OKRĄŻENIU', 'Restart na linii mety'], green: ['ZIELONA FLAGA', '']
  };

  var M = PG.Multi = { room: null, dir: null, isHost: false, L: null, entries: null, myEi: -1, buf: {}, phase: 'none', evq: [], snap: null, lobbies: [] };

  function seatTeams() { return PG.allTeams().filter(function (t) { return !t.custom; }).slice(0, 10); }
  function me() { return Net.me; }
  function myPlayer() { return M.L ? M.L.players.find(function (p) { return p.id === me().id; }) : null; }

  // ---------- kierowca z kreatora gracza (dane z sieci — sprawdzone) ----------
  var HEX = /^#[0-9a-fA-F]{6}$/;
  function cleanDriver(d, t) {
    if (!d || typeof d !== 'object') return null;
    var hp = PG.HELMET_PATTERNS.map(function (x) { return x.id; }), hm = d.helmet || {};
    function txt(s, def) { s = String(s || '').replace(/[<>]/g, '').trim().slice(0, 18); return s || def; }
    function st(v) { return clamp(Math.round(num(+v, 80)), 60, 99); }
    return {
      first: txt(d.first, 'Gracz'), last: txt(d.last, 'Online'), nat: PG.NATIONS[d.nat] ? d.nat : 'PL', num: clamp(Math.round(num(+d.num, 7)), 1, 99),
      pace: st(d.pace), start: st(d.start), tyre: st(d.tyre), wet: st(d.wet),
      helmet: { c1: HEX.test(hm.c1) ? hm.c1 : t.livery.secondary, c2: HEX.test(hm.c2) ? hm.c2 : t.livery.accent, pattern: hp.indexOf(hm.pattern) >= 0 ? hm.pattern : 'halves' }
    };
  }
  function buildEntries(spec) {
    var teams = seatTeams();
    return spec.map(function (s, i) {
      var t = teams.find(function (x) { return x.id === s.team; }) || teams[0];
      var drv = (s.drv && cleanDriver(s.drv, t)) || PG.clone(t.drivers[s.d] || t.drivers[0]);
      drv.uid = s.owner ? 'mp_' + s.owner : t.id + '_' + s.d;
      return { driver: drv, team: t, isPlayer: s.owner === me().id, owner: s.owner || null, ei: i, name: s.name || '' };
    });
  }

  // ---------- pakowanie stanu bolidu ----------
  function pack(c) {
    var d = c.dmg || {}, dm = '', P = PG.DMG_PARTS;
    // 9 tylko dla oderwanej części
    for (var k = 0; k < P.length; k++) { var v = num(d[P[k]], 0); dm += v >= 0.999 ? 9 : Math.min(8, Math.round(v * 9)); }
    var f = (c.drsOpen ? 1 : 0) | (c.inPit ? 2 : 0) | (c.retired || c.retiring ? 4 : 0) | (c.finished ? 8 : 0) | (c.pit && c.pit.ph === 'stop' ? 16 : 0) | (c.pitReq ? 32 : 0) | (c.ghost > 0 ? 64 : 0);
    return [c.ei, r2(c.x), r2(c.y), r3(c.h), r2(c.v), r2(c.steer || 0), r2(c.throttle || 0), r2(c.brake || 0), c.gear | 0, Math.round(c.rpm || 0), f,
      c.lap | 0, r1(c.dist), c.compound, r3(c.wear || 0), r3(c.lastLap || 0), r3(c.bestLap || 0), r3(c.finishTime || 0), c.penalty || 0, dm,
      r2(c.lock || 0), r2(c.skid || 0), Math.max(0, SURF.indexOf(c.surface))];
  }
  // pola dyskretne z najnowszego stanu
  function applyDiscrete(c, a, S) {
    if (!a || !c) return;
    c.gear = a[8]; c.rpm = a[9];
    var f = a[10];
    c.drsOpen = !!(f & 1); c.inPit = !!(f & 2); c.pitReq = !!(f & 32); c.ghost = (f & 64) ? 1 : 0;
    if ((f & 4) && !c.retired) { c.retired = true; c.v = 0; }
    c.lap = a[11];
    if (PG.TYRES[a[13]]) { c.compound = a[13]; (c.compounds || (c.compounds = {}))[a[13]] = true; }
    c.wear = a[14]; c.lastLap = a[15]; c.bestLap = a[16]; c.penalty = a[18];
    var P = PG.DMG_PARTS, dm = String(a[19] || '');
    if (c.dmg) for (var k = 0; k < P.length; k++) c.dmg[P[k]] = (+dm.charAt(k) || 0) / 9;
    c.lock = a[20]; c.skid = a[21]; c.surface = SURF[a[22]] || 'asphalt';
    if ((f & 8) && !c.finished) {
      c.finished = true; c.finishTime = (M.isHost && S) ? S.time : a[17]; // u hosta — jego zegar
      if (M.isHost && S) {
        if (S.finishOrder.indexOf(c) < 0) S.finishOrder.push(c);
        if (!S.leaderDone) { S.leaderDone = true; S.state = 'finish'; }
      }
    }
  }
  function pushBuf(ei, a) {
    var b = M.buf[ei] || (M.buf[ei] = []);
    b.push({ t: now(), a: a });
    if (b.length > 8) b.shift();
  }
  // Interpolacja „lalki" (bolid innego gracza albo AI hosta) do chwili rt
  function interp(S, c, b, rt) {
    var T = S.T, A = null, B = null, k;
    for (k = b.length - 1; k >= 0; k--) if (b[k].t <= rt) { A = b[k]; B = b[k + 1] || null; break; }
    if (!A) { A = b[0]; B = null; }
    var a = A.a, x, y, hd, v, st, dist;
    if (B) {
      var q = clamp((rt - A.t) / Math.max(1, B.t - A.t), 0, 1), bb = B.a;
      x = a[1] + (bb[1] - a[1]) * q; y = a[2] + (bb[2] - a[2]) * q; hd = a[3] + angDiff(bb[3], a[3]) * q;
      v = a[4] + (bb[4] - a[4]) * q; st = a[5] + (bb[5] - a[5]) * q; dist = a[12] + (bb[12] - a[12]) * q;
      c.throttle = bb[6]; c.brake = bb[7];
    } else {
      var ex = clamp((rt - A.t) / 1000, 0, 0.3);
      x = a[1] + Math.cos(a[3]) * a[4] * ex; y = a[2] + Math.sin(a[3]) * a[4] * ex; hd = a[3]; v = a[4]; st = a[5]; dist = a[12] + a[4] * ex;
      c.throttle = a[6]; c.brake = a[7];
    }
    c.x = x; c.y = y; c.h = hd; c.v = v; c.steer = st; c.dist = dist; c.beta = 0;
    c.idx = PG.nearestLocal ? PG.nearestLocal(T, x, y, c.idx || 0) : c.idx;
    c.lat = (x - T.x[c.idx]) * T.nx[c.idx] + (y - T.y[c.idx]) * T.ny[c.idx];
    applyDiscrete(c, b[b.length - 1].a, S);
  }

  // ---------- połączenie z pokojem ----------
  function handlers() {
    return {
      msg: function (m, from) { try { onMsg(m, from); } catch (e) { console.warn('Multiplayer:', m && m.t, e); } },
      presence: function (list) { onPresence(list); },
      peer: function (p) {
        if (!M.isHost || !M.L) return;
        var pl = M.L.players.find(function (x) { return x.id === p.id; });
        if (pl) { var lk = p.ok ? 'p2p' : p.relay ? 'relay' : 'wait'; if (pl.link !== lk) { pl.link = lk; pushLobby(); } }
      }
    };
  }

  M.reset = function () {
    if (M.room) { try { M.room.close(); } catch (e) { /* nic */ } }
    if (M.dir && M.isHost) { try { M.dir.advertise({}); } catch (e2) { /* nic */ } }
    clearTimeout(M.qTimer); clearTimeout(M.gTimer); clearTimeout(M.advTimer); clearTimeout(M.qAdvTimer); clearInterval(M.helloTimer); M.helloTimer = null;
    M.fwd = {}; M.denyAt = {};
    M.room = null; M.L = null; M.entries = null; M.isHost = false; M.myEi = -1; M.buf = {}; M.phase = 'none'; M.snap = null; M.evq = [];
    M.q = null; M.qt = null; M.comps = null; M.loaded = null; M.seen = {}; M.missing = {}; M.lastSnap = 0;
    // synchronizacja etapów: numer ostatniego etapu (ps), weekend (wk), wersja lobby (lv), ostatnie komunikaty hosta
    M.ps = 0; M.wk = 0; M.lv = 0; M.goMsg = null; M.cur = null; M.syncAt = 0; M.waitAt = 0;
    M.qSend = null; M.tyreSend = null; M.loadSend = 0; M.want = null; M.wantAt = 0; M.defer = [];
  };

  // Utworzenie lobby (host)
  M.host = function (name, priv) {
    M.reset();
    return Net.ready().then(function () {
      var code = Net.newCode();
      return Net.room(code, true, handlers()).then(function (room) {
        M.room = room; M.isHost = true;
        var cfg = PG.clone(DEF_CFG); cfg.priv = !!priv;
        var st = Store.data.settings; if (st.mp && typeof st.mp === 'object') Object.keys(DEF_CFG).forEach(function (k) { if (st.mp[k] !== undefined) cfg[k] = st.mp[k]; });
        cfg.priv = !!priv;
        M.L = { code: code, name: String(name || me().name + ' — lobby').slice(0, 32), host: me().id, cfg: cfg, st: 'lobby',
          players: [{ id: me().id, name: me().name, team: null, d: 0, ready: false, drv: null, link: 'host' }] };
        room.track({ id: me().id, name: me().name });
        advertise();
        return code;
      });
    });
  };

  // Dołączenie do lobby (klient)
  M.join = function (code) {
    M.reset();
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length < 4) return Promise.reject(new Error('Nieprawidłowy kod lobby'));
    return Net.ready().then(function () { return Net.room(code, false, handlers()); }).then(function (room) {
      M.room = room; M.isHost = false; M.joinAt = now();
      room.track({ id: me().id, name: me().name });
      room.toHost({ t: 'hello', name: me().name, v: PG.VERSION }, true);
      helloLoop();
      return code;
    });
  };
  // powtórne powitanie, dopóki host nie dopisze nas do lobby
  function helloLoop() {
    clearInterval(M.helloTimer);
    M.helloTimer = setInterval(function () { if (!M.room || myPlayer()) { clearInterval(M.helloTimer); M.helloTimer = null; return; } M.room.toHost({ t: 'hello', name: me().name, v: PG.VERSION }, true); }, 2500);
  }
  function helloCheck() { if (myPlayer()) { clearInterval(M.helloTimer); M.helloTimer = null; } else if (!M.helloTimer && M.room) helloLoop(); }
  // host odrzucił miejsce (zajęte) — nie ponawiaj prośby
  function wantCheck() {
    var w = M.want; if (!w || !M.L) return;
    if (M.L.players.some(function (p) { return p.id !== me().id && p.team === w.team && p.d === w.d; })) { M.want = null; if (UI.toast) UI.toast('To miejsce zajął już inny gracz'); }
  }

  M.leave = function () {
    var r = M.room;
    if (r) { if (M.isHost) r.broadcast({ t: 'end', why: 'Host zamknął lobby' }, true); else r.toHost({ t: 'bye' }, true); r.h = {}; }
    M.room = null; M.reset();
    // chwila na wysłanie pożegnania
    if (r) setTimeout(function () { try { r.close(); } catch (e) { /* nic */ } }, 300);
  };

  function advertise() {
    if (!M.isHost || !M.L || !M.dir) return;
    clearTimeout(M.advTimer);
    M.advTimer = setTimeout(function () {
      if (!M.L || !M.dir) return;
      var L = M.L;
      M.dir.advertise({ code: L.code, name: L.name, host: me().name, n: L.players.length, max: L.cfg.max, st: L.st, laps: L.cfg.laps, tr: L.cfg.track, w: L.cfg.weather, q: L.cfg.quali, priv: L.cfg.priv });
    }, 400);
  }
  function pushLobby() {
    if (!M.isHost || !M.room || !M.L) return;
    M.lv = (M.lv || 0) + 1;
    M.room.broadcast({ t: 'lobby', L: M.L, lv: M.lv, ps: M.ps }, true);
    advertise();
    if (UI.lobbyRefresh) UI.lobbyRefresh();
  }
  M.pushLobby = pushLobby;

  // ---------- obecność: rozłączenia ----------
  function onPresence(list) {
    var ids = {}; list.forEach(function (m) { if (m && m.id) ids[m.id] = 1; });
    var t = now();
    if (M.isHost && M.L) {
      M.L.players.forEach(function (p) {
        if (p.id === me().id) return;
        if (ids[p.id]) { delete M.missing[p.id]; return; }
        if (!M.missing[p.id]) M.missing[p.id] = t;
      });
    } else if (M.L && M.L.host) {
      if (ids[M.L.host]) delete M.missing.host; else if (!M.missing.host) M.missing.host = t;
    }
  }
  // sprawdzane co sekundę: długo nieobecny gracz odpada (w wyścigu — bolid przejmuje AI)
  setInterval(function () {
    if (!M.room || !M.L) return;
    var t = now();
    // rozłączony = brak w obecności i brak jakichkolwiek wiadomości przez dłuższą chwilę
    function quiet(id, ms) { return !M.seen[id] || t - M.seen[id] > ms; }
    if (M.isHost) {
      Object.keys(M.missing || {}).forEach(function (id) { if (t - M.missing[id] > 9000 && quiet(id, 8000)) { delete M.missing[id]; dropPlayer(id, 'rozłączony', true); } });
    } else if (M.missing && M.missing.host && t - M.missing.host > 12000 && quiet(M.L.host, 8000)) hostLost('Host rozłączył się');
    if (!M.isHost && M.phase === 'race' && M.lastSnap && t - M.lastSnap > 20000) hostLost('Brak danych od hosta');
  }, 1000);

  // Co sekundę: host nadaje numer bieżącego etapu, klient sprawdza, czy czegoś nie zgubił, i ponawia
  // własne komunikaty (czas okrążenia, opony, wczytanie wyścigu, miejsce i gotowość), aż host je potwierdzi
  setInterval(function () {
    if (!M.room || !M.L) return;
    var t = now();
    if (M.isHost) {
      M.beatT = (M.beatT || 0) + 1;
      if (M.beatT % 2 === 0) M.room.broadcast({ t: 'ph', ps: M.ps, lv: M.lv, wk: M.wk }, false);
      return;
    }
    // ekran oczekiwania bez postępu — poproś hosta o stan
    if (M.waitAt && t - M.waitAt > 4000) { M.waitAt = t; requestSync(); }
    if (M.qSend && M.phase === 'quali' && t - M.qSend.at > 3000) { M.qSend.at = t; M.room.toHost({ t: 'qtime', i: M.myEi, tm: M.qSend.tm, seg: M.qSend.seg }, true); }
    if (M.tyreSend && M.phase === 'grid' && t - M.tyreSend.at > 3000) { M.tyreSend.at = t; M.room.toHost({ t: 'tyre', i: M.myEi, c: M.tyreSend.c }, true); }
    if (M.loadSend && M.phase === 'race' && G.S && G.S.state === 'lights' && t - M.loadSend > 2500) { M.loadSend = t; M.room.toHost({ t: 'loaded' }, true); }
    if (M.want && M.phase === 'lobby' && t - M.wantAt > 3000) {
      var pl = myPlayer(), w = M.want;
      if (pl && (pl.team !== w.team || pl.d !== w.d || !!pl.ready !== !!w.ready)) {
        M.wantAt = t;
        if (pl.team !== w.team || pl.d !== w.d) M.room.toHost({ t: 'seat', team: w.team, d: w.d, drv: w.drv || null }, true);
        if (w.ready) M.room.toHost({ t: 'ready', on: true }, true);
      }
    }
  }, 1000);
  function requestSync() {
    var t = now();
    if (!M.room || M.isHost || M.phase === 'none' || t - (M.syncAt || 0) < 1500) return; // przed dołączeniem — tylko powitanie
    M.syncAt = t;
    M.room.toHost({ t: 'sync' }, true);
  }
  // host: komunikat etapu (start weekendu, segment, wyniki, pola, wyścig, klasyfikacja, powrót do lobby) z numerem
  function phaseSend(msg) {
    msg.ps = ++M.ps;
    if (msg.t === 'go') { M.wk = msg.ps; M.goMsg = msg; M.cur = null; } else M.cur = msg;
    msg.wk = M.wk;
    M.room.broadcast(msg, true);
  }
  var PHASE = { go: 1, qseg: 1, qres: 1, grid: 1, race: 1, final: 1, tolobby: 1 };
  // klient: czy przyjąć komunikat etapu (starsze i powtórzone pomija; bez startu tego weekendu — prosi o stan)
  function acceptPhase(m) {
    if (!m.ps) return true;
    if (m.ps <= M.ps) return false;
    if (m.t !== 'go' && m.t !== 'tolobby' && m.wk !== M.wk) { requestSync(); return false; }
    M.ps = m.ps;
    if (m.t === 'go') M.wk = m.wk;
    return true;
  }
  // klient: pełny stan od hosta (odpowiedź na „sync")
  function applyState(m) {
    if (m.L && (!m.lv || m.lv >= (M.lv || 0))) { M.L = m.L; M.lv = m.lv || M.lv; if (M.room) M.room.hostId = m.L.host; wantCheck(); }
    if (m.go && (!m.cur || m.cur.t !== 'tolobby')) clientPhase(m.go);
    if (m.cur) clientPhase(m.cur);
    if (M.phase === 'none' && M.L) { M.phase = 'lobby'; M.ps = Math.max(M.ps, m.ps || 0); helloCheck(); UI.lobby(); }
    else if (M.phase === 'lobby') { helloCheck(); if (UI.lobbyRefresh && UI.lobbyShown) UI.lobbyRefresh(); }
  }

  function dropPlayer(id, why, tell) {
    var L = M.L; if (!L) return;
    var pl = L.players.find(function (p) { return p.id === id; });
    if (!pl) return;
    L.players = L.players.filter(function (p) { return p.id !== id; });
    if (M.room) M.room.drop(id);
    // usunięty, choć może wciąż słuchać — powiedz mu (po zamknięciu łącza idzie przez serwer)
    if (M.room && tell) M.room.sendTo(id, { t: 'deny', why: 'Rozłączono z lobby' }, true);
    // w wyścigu: bolid przejmuje AI
    if (M.phase === 'race' && G.S && G.net) {
      G.S.cars.forEach(function (c) { if (c.owner === id && c.remote) takeOver(G.S, c); });
      G.note(pl.name + ' opuścił wyścig — bolid prowadzi AI');
    } else if (UI.toast) UI.toast(pl.name + ' ' + (why || 'wyszedł'));
    if (M.qt && M.phase === 'quali') qMaybeClose();
    if (M.comps && M.phase === 'grid') gridMaybeGo();
    if (M.loaded) loadedCheck();
    pushLobby();
  }
  // bolid gracza przejmuje AI: liczenie czasu od teraz (okrążenia z pakietu), bez rekordu z niepełnego okrążenia
  function takeOver(S, c) {
    var T = S.T, Lt = T.length, sb = T.sectors;
    c.remote = false; c.isPlayer = false; delete M.buf[c.ei];
    if (c.dist >= 0) { c.started = true; var inLap = c.dist - Math.floor(c.dist / Lt) * Lt; c.curSector = inLap < sb[0] * T.ds ? 0 : inLap < sb[1] * T.ds ? 1 : 2; }
    c.lapStart = c.sectorStart = S.time; c.noBest = true;
    c.compounds = c.compounds || {}; c.compounds[c.compound] = true;
    if (c.inPit && !c.pit) c.inPit = false;
  }
  function hostLost(why) {
    var inRace = M.phase === 'race' && G.net;
    console.warn('Multiplayer: ' + why);
    M.reset();
    if (inRace && G.S) {
      G.note(why + ' — wyścig kończy się tutaj');
      setTimeout(function () { if (G.net || G.mode === 'race') G.finish({ type: 'race', res: PG.classify(G.S) }); }, 1500);
    } else {
      if (G.mode === 'quali') { G.onDone = null; G.startAttract(); } // okrążenie kwalifikacyjne w toku
      if (UI.toast) UI.toast(why); UI.multi();
    }
  }

  // ---------- wiadomości ----------
  function onMsg(m, from) {
    var L = M.L, t = m.t;
    M.seen[from] = now(); // ostatnia wiadomość od tego gracza (do wykrywania rozłączeń)
    if (M.isHost) {
      var pl = L && L.players.find(function (p) { return p.id === from; });
      if (t === 'hello') {
        if (!L) return;
        if (!pl) {
          if (m.v !== PG.VERSION) { M.room.sendTo(from, { t: 'deny', why: 'Masz inną wersję gry niż host (Ty: ' + (m.v || 'starsza') + ', host: ' + PG.VERSION + '). Zaktualizujcie obaj grę (start.command / start.bat albo git pull) i odświeżcie stronę.' }, true); return; }
          if (L.st !== 'lobby') { M.room.sendTo(from, { t: 'deny', why: 'W tym lobby trwa już wyścig' }, true); return; }
          if (L.players.length >= L.cfg.max) { M.room.sendTo(from, { t: 'deny', why: 'Lobby jest pełne' }, true); return; }
          pl = { id: from, name: String(m.name || 'Gracz').replace(/[<>]/g, '').slice(0, 24), team: null, d: 0, ready: false, drv: null, link: 'wait' };
          L.players.push(pl);
        }
        M.room.connect(from);
        pushLobby();
        return;
      }
      if (!pl) {
        // nieznany gracz (np. usunięty z lobby) — powiedz mu o tym, najwyżej co 3 s
        if (L && t !== 'bye' && t !== 'leave' && t !== 'c' && now() - (M.denyAt[from] || 0) > 3000) { M.denyAt[from] = now(); M.room.sendTo(from, { t: 'deny', why: 'Rozłączono z lobby' }, true); }
        return;
      }
      if (t === 'seat') {
        if (L.st !== 'lobby') return;
        var taken = L.players.some(function (p) { return p !== pl && p.team === m.team && p.d === m.d; });
        if (!taken && seatTeams().some(function (x) { return x.id === m.team; })) { pl.team = m.team; pl.d = m.d ? 1 : 0; pl.drv = m.drv || null; pl.ready = false; }
        pushLobby();
      } else if (t === 'ready') { pl.ready = !!m.on && !!pl.team; pushLobby(); }
      else if (t === 'bye' || t === 'leave') dropPlayer(from, 'wyszedł');
      else if (t === 'sync') M.room.sendTo(from, { t: 'state', ps: M.ps, lv: M.lv, L: M.L, go: M.goMsg, cur: M.cur }, true);
      else if (t === 'qtime') { if (M.qt && M.q && m.seg === M.q.seg && M.entries[m.i] && M.entries[m.i].owner === from) { M.qt[m.i] = num(+m.tm, 0); qMaybeClose(); } }
      else if (t === 'tyre') { if (M.comps && M.entries[m.i] && M.entries[m.i].owner === from && PG.TYRES[m.c]) { M.comps[m.i] = m.c; gridMaybeGo(); } }
      else if (t === 'loaded') { if (M.loaded) { M.loaded[from] = 1; loadedCheck(); } }
      else if (t === 'c') { var a = m.a; if (a && M.entries && M.entries[a[0]] && M.entries[a[0]].owner === from) pushBuf(a[0], a); }
      return;
    }
    // klient
    if (t === 'lobby') {
      if (m.lv && m.lv < (M.lv || 0)) return; // starsza wersja lobby (np. spóźniona przez serwer)
      var first = M.phase === 'none';
      M.L = m.L; M.lv = m.lv || M.lv; if (M.room) M.room.hostId = m.L.host;
      if (first && m.ps) M.ps = m.ps; // dołączenie: wcześniejsze etapy tego lobby nas nie dotyczą
      wantCheck();
      if (first || M.phase === 'lobby') { M.phase = 'lobby'; helloCheck(); if (UI.lobbyRefresh && UI.lobbyShown) UI.lobbyRefresh(); else UI.lobby(); }
    } else if (t === 'deny') hostLost(m.why || 'Odmowa dołączenia');
    else if (t === 'end') hostLost(m.why || 'Lobby zamknięte');
    else if (t === 'state') applyState(m);
    else if (t === 'ph') { if (m.ps > M.ps || (m.lv && m.lv > (M.lv || 0))) requestSync(); }
    else if (t === 's') {
      if (m.ps && m.ps > M.ps) requestSync();
      if (M.phase !== 'race') return;
      M.snap = m; M.lastSnap = now(); (m.c || []).forEach(function (a) { if (a && a[0] !== M.myEi) pushBuf(a[0], a); });
    }
    else if (PHASE[t]) clientPhase(m);
  }
  function clientPhase(m) {
    if (!acceptPhase(m)) return;
    var t = m.t;
    M.waitAt = 0;
    if (t === 'go') startEvent(m.spec, m.cfg);
    else if (t === 'qseg') later(function () { onQseg(m); });
    else if (t === 'qres') later(function () { onQres(m); });
    else if (t === 'grid') later(function () { onGrid(m); });
    else if (t === 'race') { M.defer = []; if (G.mode === 'quali') { M.phase = 'race'; G.finish({ type: 'quali', time: 0, aborted: true }); } onRace(m); }
    else if (t === 'final') onFinal(m);
    else if (t === 'tolobby') { M.phase = 'lobby'; M.qSend = null; M.tyreSend = null; M.loadSend = 0; M.want = null; G.startAttract(); UI.lobby(); }
  }

  // Gracz jedzie właśnie okrążenie kwalifikacyjne: ekrany od hosta pokażą się po jego zakończeniu
  M.defer = [];
  function later(fn) { if (G.mode === 'quali' && G.S) M.defer.push(fn); else fn(); }
  function runDeferred() { var d = M.defer; M.defer = []; d.forEach(function (fn) { fn(); }); return d.length > 0; }

  // ---------- host: ustawienia, miejsca, start ----------
  M.setCfg = function (k, v) {
    if (!M.isHost || !M.L || M.L.st !== 'lobby') return;
    M.L.cfg[k] = v;
    var st = Store.data.settings; st.mp = st.mp || {}; st.mp[k] = v; Store.save();
    if (k === 'priv' || k === 'max') advertise();
    pushLobby();
  };
  M.pickSeat = function (team, d, drv) {
    var pl = myPlayer(); if (!pl || !M.L || M.L.st !== 'lobby') return;
    if (M.isHost) {
      var taken = M.L.players.some(function (p) { return p !== pl && p.team === team && p.d === d; });
      if (!taken) { pl.team = team; pl.d = d; pl.drv = drv || null; pl.ready = false; }
      pushLobby();
    } else {
      pl.team = team; pl.d = d; pl.drv = drv || null; pl.ready = false;
      M.want = { team: team, d: d, drv: drv || null, ready: false }; M.wantAt = now();
      M.room.toHost({ t: 'seat', team: team, d: d, drv: drv || null }, true);
    }
  };
  M.setReady = function (on) {
    var pl = myPlayer(); if (!pl || !pl.team) return;
    pl.ready = !!on;
    if (M.isHost) { pushLobby(); return; }
    M.want = { team: pl.team, d: pl.d, drv: pl.drv || null, ready: !!on }; M.wantAt = now();
    M.room.toHost({ t: 'ready', on: !!on }, true);
  };
  M.canStart = function () {
    var L = M.L; if (!L || !M.isHost || L.st !== 'lobby') return false;
    return L.players.every(function (p) { return p.team && (p.ready || p.id === me().id); });
  };
  M.start = function () {
    if (!M.canStart()) return;
    var L = M.L, spec = [];
    seatTeams().forEach(function (t) {
      t.drivers.forEach(function (d, k) {
        var p = L.players.find(function (x) { return x.team === t.id && x.d === k; });
        if (p) spec.push({ team: t.id, d: k, owner: p.id, drv: p.drv || null, name: p.name });
        else if (L.cfg.ai) spec.push({ team: t.id, d: k, owner: null });
      });
    });
    L.st = 'quali'; advertise();
    phaseSend({ t: 'go', spec: spec, cfg: L.cfg });
    startEvent(spec, L.cfg);
  };

  function cfgEnv(cfg) { return { wet: cfg.weather === 'rain', weatherGrip: PG.WEATHER[cfg.weather].grip }; }
  function startEvent(spec, cfg) {
    M.cfg = cfg; M.entries = buildEntries(spec);
    if (G.setTrack) G.setTrack(cfg.track || 'monza');
    M.myEi = M.entries.findIndex(function (e) { return e.owner === me().id; });
    M.phase = 'quali'; M.buf = {}; M.qseg = null; M.qres = null; M.grid = null; M.qSend = null; M.tyreSend = null; M.want = null;
    if (!M.isHost) { if (M.L) M.L.st = 'quali'; UI.mpWait('Kwalifikacje za chwilę…'); return; }
    var Q = PG.Quali;
    M.q = Q.create(M.entries, cfg.quali === 'one' ? 'one' : 'q3');
    if (cfg.quali === 'none') {
      // bez kwalifikacji: wszyscy symulowani (gracze na poziomie „normalnym")
      var env = cfgEnv(cfg);
      while (!Q.done(M.q)) {
        var tt = Q.simulate(M.q, M.entries, G.T, env, cfg.difficulty, function (e) { return !!e.owner; });
        M.q.alive.forEach(function (i) { if (M.entries[i].owner) tt[i] = Q.simTime(G.T, M.entries[i], env, 'normal', M.q.seg); });
        Q.complete(M.q, tt);
      }
      toGrid(M.q.final);
      return;
    }
    qNextSeg();
  }

  // ---------- kwalifikacje online ----------
  function qNextSeg() {
    var Q = PG.Quali, st = M.q, env = cfgEnv(M.cfg);
    var ai = Q.simulate(st, M.entries, G.T, env, M.cfg.difficulty, function (e) { return !!e.owner; });
    M.qt = {}; M.qAi = ai;
    var msg = { t: 'qseg', seg: st.seg, one: st.format === 'one' ? 1 : 0, alive: st.alive.slice(), target: Q.target(st, ai), keep: Q.keepNow(st), dl: 180 };
    phaseSend(msg);
    clearTimeout(M.qTimer); M.qTimer = setTimeout(qClose, (msg.dl + 4) * 1000);
    onQseg(msg);
  }
  function qMaybeClose() {
    if (!M.qt || !M.q) return;
    var all = M.q.alive.every(function (i) { var e = M.entries[i]; return !e.owner || M.qt[i] > 0 || !M.L.players.some(function (p) { return p.id === e.owner; }); });
    if (all) qClose();
  }
  function qClose() {
    if (!M.qt || !M.q) return;
    clearTimeout(M.qTimer);
    var Q = PG.Quali, st = M.q, env = cfgEnv(M.cfg), times = {};
    Object.keys(M.qAi).forEach(function (k) { times[k] = M.qAi[k]; });
    st.alive.forEach(function (i) { var e = M.entries[i]; if (e.owner) times[i] = M.qt[i] > 0 ? M.qt[i] : Q.simTime(G.T, e, env, 'normal', st.seg) + 0.8; });
    M.qt = null;
    var res = Q.complete(st, times);
    var msg = { t: 'qres', seg: res.seg, one: st.format === 'one' ? 1 : 0, rows: res.rows, keep: res.keep, done: Q.done(st) ? 1 : 0, final: st.final };
    phaseSend(msg);
    onQres(msg);
  }
  M.qAdvance = function () {
    if (!M.isHost || !M.q || M.qt || M.phase !== 'quali') return; // segment wciąż otwarty albo już po kwalifikacjach
    clearTimeout(M.qAdvTimer);
    if (!PG.Quali.done(M.q)) qNextSeg(); else toGrid(M.q.final);
  };
  function onQseg(m) {
    M.phase = 'quali'; M.qseg = m;
    UI.mpQualiSeg(m);
  }
  function onQres(m) {
    M.qres = m;
    if (M.qSend && M.qSend.seg <= m.seg) M.qSend = null; // host zamknął segment — nie ponawiaj czasu
    if (M.isHost && G.mode === 'quali' && G.S) { M.defer.push(function () { onQres(m); }); return; }
    UI.mpQualiRes(m);
    if (M.isHost) { clearTimeout(M.qAdvTimer); M.qAdvTimer = setTimeout(M.qAdvance, 20000); }
  }
  // czas przejechanego okrążenia (albo symulacja) wysyłany hostowi
  M.sendQTime = function (tm, seg) {
    if (M.myEi < 0) return;
    if (M.isHost) { if (M.qt && M.q && seg === M.q.seg) { M.qt[M.myEi] = tm; qMaybeClose(); } return; }
    if (!M.room) return;
    M.qSend = { tm: tm, seg: seg, at: now() };
    M.room.toHost({ t: 'qtime', i: M.myEi, tm: tm, seg: seg }, true);
  };

  // ---------- pola startowe ----------
  function toGrid(final) {
    var order = final.map(function (r) { return r.i; }), times = final.map(function (r) { return r.t; });
    M.comps = {};
    var msg = { t: 'grid', order: order, times: times, segs: final.map(function (r) { return r.seg; }) };
    phaseSend(msg);
    clearTimeout(M.gTimer); M.gTimer = setTimeout(goRace, 40000);
    onGrid(msg);
  }
  function gridMaybeGo() {
    if (!M.comps) return;
    var all = M.entries.every(function (e) { return !e.owner || M.comps[e.ei] || !M.L.players.some(function (p) { return p.id === e.owner; }); });
    if (all) goRace();
  }
  M.sendTyre = function (c) {
    if (M.myEi < 0) return;
    if (M.isHost) { if (M.comps) { M.comps[M.myEi] = c; gridMaybeGo(); } return; }
    if (!M.room) return;
    M.tyreSend = { c: c, at: now() };
    M.room.toHost({ t: 'tyre', i: M.myEi, c: c }, true);
  };
  function onGrid(m) {
    M.phase = 'grid'; M.grid = m;
    if (M.isHost && G.mode === 'quali' && G.S) { M.defer.push(function () { onGrid(m); }); return; }
    UI.mpGrid(m);
  }
  function goRace() {
    if (!M.comps || !M.grid) return;
    clearTimeout(M.gTimer);
    var wet = M.cfg.weather === 'rain', comps = {};
    M.entries.forEach(function (e) { comps[e.ei] = M.comps[e.ei] || (e.owner ? (wet ? 'W' : 'M') : (wet ? 'W' : (Math.random() < 0.3 ? 'S' : Math.random() < 0.75 ? 'M' : 'H'))); });
    M.comps = null;
    M.L.st = 'race'; advertise();
    var msg = { t: 'race', order: M.grid.order, comps: comps };
    phaseSend(msg);
    onRace(msg);
  }

  // ---------- wyścig ----------
  function onRace(m) {
    M.phase = 'race'; M.buf = {}; M.fwd = {}; M.snap = null; M.lastSnap = now(); M.evq = []; M.sendT = 0; M.gridPos = m.order.indexOf(M.myEi) + 1;
    M.tyreSend = null; M.qSend = null;
    var cfg = M.cfg, mine = me().id;
    var entries = m.order.map(function (ei) {
      var e = M.entries[ei];
      var remote = M.isHost ? !!(e.owner && e.owner !== mine) : e.owner !== mine;
      return { driver: e.driver, team: e.team, isPlayer: e.owner === mine, remote: remote, owner: e.owner, ei: ei, compound: m.comps[ei] || 'M' };
    });
    UI._.root().innerHTML = '';
    var wm = cfg.wear === 'auto' ? UI.wearAuto(cfg.laps) : +cfg.wear || 1;
    G.startSession({ mode: 'race', entries: entries, laps: cfg.laps, weather: cfg.weather, difficulty: cfg.difficulty, net: true, netClient: !M.isHost,
      wearMul: wm, incidents: cfg.inc, damage: cfg.damage }, function (out) { UI.mpResults(out); });
    var S = G.S;
    if (M.isHost) {
      S.holdLights = true; M.loaded = {}; M.loaded[mine] = 1; M.loadT = now();
      loadedCheck();
      setTimeout(function () { if (G.S === S && S.holdLights) { S.holdLights = false; M.loaded = null; } }, 15000);
    } else { M.loadSend = now(); M.room.toHost({ t: 'loaded' }, true); }
    G.msg('WYŚCIG ONLINE', M.isHost ? 'Czekam, aż wszyscy wczytają tor…' : 'Start, gdy wszyscy będą gotowi', '', 3);
  }
  function loadedCheck() {
    var S = G.S;
    if (!M.loaded || !S || !S.holdLights) return;
    var all = M.L.players.every(function (p) { return M.loaded[p.id]; });
    if (all) { S.holdLights = false; M.loaded = null; }
  }

  // przed krokiem symulacji: lalki i (u klienta) stan sesji od hosta
  M.pre = function (S, dt) {
    if (!M.room || M.phase !== 'race' || S.mode !== 'race') return;
    var rt = now() - (M.isHost ? 110 : 130);
    for (var i = 0; i < S.cars.length; i++) {
      var c = S.cars[i];
      if (!c.remote) continue;
      var b = M.buf[c.ei];
      if (b && b.length) interp(S, c, b, rt);
    }
    if (M.isHost || !M.snap) return;
    var sn = M.snap;
    if (S.state === 'lights') {
      if (sn.st === 'lights' && sn.lo !== S.lightsOn) { S.lightsOn = sn.lo; M.evq.push({ type: 'light', n: sn.lo }); }
      if (sn.st !== 'lights') { S.state = 'run'; S.lightsOn = 0; S.time = num(sn.tm, 0); M.evq.push({ type: 'go' }); }
    }
    if (sn.ld && !S.leaderDone) { S.leaderDone = true; if (S.state === 'run') S.state = 'finish'; }
    if (sn.o) S.netOrder = sn.o;
    var rc = S.rc, R = sn.rc;
    if (rc && R) {
      if (rc.mode !== R[0]) { var tx = RC_TXT[R[0]]; if (tx) M.evq.push({ type: 'rc', mode: R[0], text: R[0] === 'green' && (rc.mode === 'scIn') ? 'RESTART · ZIELONA FLAGA' : tx[0], sub: tx[1] }); rc.mode = R[0]; }
      rc.drsOk = !!R[2];
      var sc = R[1];
      if (sc) {
        var o = rc.sc || (rc.sc = { s: 0, idx: 0 });
        o.x = sc[0]; o.y = sc[1]; o.h = sc[2]; o.v = sc[3]; o.lights = !!sc[4]; o.inPit = !!sc[5];
        o.idx = PG.nearestLocal ? PG.nearestLocal(S.T, o.x, o.y, o.idx || 0) : o.idx; o.s = o.idx;
      } else rc.sc = null;
    }
  };
  // po kroku: wysyłka stanu, zdarzenia od hosta
  M.post = function (S, dt) {
    if (!M.room || M.phase !== 'race' || S.mode !== 'race') return;
    if (M.evq.length) { var ev = M.evq; M.evq = []; G.handleEvents(ev, true); }
    var t = now();
    if (M.isHost) {
      if (t - M.sendT < 66) return;
      M.sendT = t;
      var arr = [];
      S.cars.forEach(function (c) {
        // stan gracza przekazywany raz (bez powtórek starego pakietu); czas mety wg zegara hosta
        if (c.remote) { var b = M.buf[c.ei], la = b && b.length && b[b.length - 1].a; if (la && la !== M.fwd[c.ei]) { M.fwd[c.ei] = la; if (c.finished) la[17] = r3(c.finishTime); arr.push(la); } }
        else arr.push(pack(c));
      });
      var sc = S.rc && S.rc.sc;
      M.room.broadcast({ t: 's', ps: M.ps, tm: r2(S.time), st: S.state, lo: S.lightsOn, ld: S.leaderDone ? 1 : 0, o: S.order.map(function (c) { return c.ei; }),
        rc: S.rc ? [S.rc.mode, sc ? [r2(sc.x), r2(sc.y), r3(sc.h), r2(sc.v), sc.lights ? 1 : 0, sc.inPit ? 1 : 0] : 0, S.rc.drsOk ? 1 : 0] : 0, c: arr }, false);
    } else {
      if (t - M.sendT < 50 || !S.player) return;
      M.sendT = t;
      M.room.toHost({ t: 'c', a: pack(S.player) }, false);
    }
  };

  // koniec wyścigu: host ogłasza klasyfikację
  M.checkEnd = function (dt) {
    var S = G.S;
    if (!S || !M.room) {
      // bez połączenia: zwykłe zakończenie lokalne
      if (S && S.player && S.player.finished) { G.endT += dt; if (G.endT > 5) G.finish(); }
      return;
    }
    if (!M.isHost) {
      // host czeka najwyżej 120 s — dopiero potem wynik lokalny; pokój zostaje (przyjdzie klasyfikacja albo powrót do lobby)
      if (S.player && S.player.finished) { G.endT += dt; if (G.endT > 130) G.finish(); }
      return;
    }
    if (!S.leaderDone) return;
    G.endT += dt;
    var humansDone = S.cars.every(function (c) { return !c.owner || c.finished || c.retired || !c.remote && !c.isPlayer; });
    var allDone = S.cars.every(function (c) { return c.finished || c.retired || c.retiring; });
    if ((humansDone && (allDone || G.endT > 30)) || G.endT > 120) finalize();
  };
  function finalize() {
    var S = G.S; if (!S || M.phase !== 'race') return;
    M.phase = 'results';
    var res = PG.classify(S);
    var rows = res.map(function (r) { return { ei: r.car.ei, pos: r.pos, time: r3(r.time), gap: r3(r.gap), best: r3(r.best || 0), pen: r.penalty || 0, dnf: r.dnf ? 1 : 0 }; });
    if (M.room) phaseSend({ t: 'final', rows: rows });
    if (M.L) { M.L.st = 'results'; advertise(); }
    G.finish({ type: 'race', res: res, fastest: S.fastest });
  }
  function onFinal(m) {
    var S = G.S;
    if (!S || M.phase !== 'race' || S.mode !== 'race') {
      if (!M.isHost) { M.phase = 'results'; UI.mpWait('Wyścig się zakończył. Czekam, aż host wróci do lobby…'); }
      return;
    }
    M.phase = 'results';
    var byEi = {}; S.cars.forEach(function (c) { byEi[c.ei] = c; });
    var res = (m.rows || []).filter(function (r) { return byEi[r.ei]; }).map(function (r) {
      return { car: byEi[r.ei], pos: r.pos, time: r.time, gap: r.gap, best: r.best, penalty: r.pen, dnf: !!r.dnf, laps: S.laps };
    });
    if (G.mode === 'post') UI.mpResults({ type: 'race', res: res }); else G.finish({ type: 'race', res: res });
  }
  M.leaveRace = function () {
    var r = M.room;
    if (r) { if (M.isHost) r.broadcast({ t: 'end', why: 'Host opuścił wyścig' }, true); else r.toHost({ t: 'leave' }, true); r.h = {}; }
    M.room = null; M.reset(); G.startAttract(); UI.multi();
    // chwila na wysłanie pożegnania
    if (r) setTimeout(function () { try { r.close(); } catch (e) { /* nic */ } }, 300);
  };
  M.backToLobby = function () {
    if (!M.room || !M.L) { UI.multi(); return; }
    M.phase = 'lobby';
    if (M.isHost) {
      M.L.st = 'lobby'; M.L.players.forEach(function (p) { p.ready = false; });
      phaseSend({ t: 'tolobby' });
      pushLobby();
    }
    G.startAttract(); UI.lobby();
  };

  // =====================================================================
  // EKRANY
  // =====================================================================
  function wrap(max) { return h('div', { class: 'wrap', style: 'max-width:' + (max || 1150) + 'px' }); }
  function header(title, back) {
    return h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { text: title }), back ? h('button', { type: 'button', text: '← ' + back[0], onclick: back[1] }) : null);
  }
  var WNAME = { sun: 'Słońce', cloud: 'Chmury', rain: 'Deszcz' }, QNAME = { q3: 'Q1·Q2·Q3', one: '1 okrążenie', none: 'bez kwalifikacji' };

  // Lista lobby, tworzenie, dołączanie kodem
  UI.multi = function () {
    if (M.room) M.reset();
    var s = U().screen('multi', 'dim'), st = Store.data.settings, w = wrap(1000);
    w.appendChild(header('Multiplayer', ['Menu', function () { if (M.dir) { M.dir.close(); M.dir = null; } UI.menu(); }]));
    var g2 = h('div', { class: 'grid2' });
    var left = h('div', { class: 'panel col' }, h('h3', { text: 'Twoje lobby' }));
    var nameIn = h('input', { type: 'text', maxlength: 24, value: st.mpName || '', placeholder: 'np. Kowalski', oninput: function () { st.mpName = nameIn.value.slice(0, 24); Store.save(); Net.setName(st.mpName); } });
    left.appendChild(h('label', { class: 'field' }, 'Twoja nazwa', nameIn));
    var lname = h('input', { type: 'text', maxlength: 32, placeholder: 'Nazwa lobby (opcjonalnie)' });
    var priv = false;
    left.appendChild(h('label', { class: 'field' }, 'Nazwa lobby', lname));
    left.appendChild(h('div', { class: 'field' }, 'Widoczność', U().seg([[false, 'Publiczne (na liście)'], [true, 'Prywatne (tylko kod)']], false, function (v) { priv = v; })));
    var status = h('p', { class: 'muted', style: 'font-size:14px' });
    function busy(t) { status.textContent = t; }
    left.appendChild(h('button', { type: 'button', class: 'primary', text: 'Utwórz lobby', onclick: function () {
      if (!st.mpName) { st.mpName = nameIn.value || 'Kierowca'; Store.save(); }
      busy('Tworzę lobby…');
      Net.ready().then(function () { Net.setName(st.mpName); return ensureDir(); }).then(function () { return M.host(lname.value, priv); })
        .then(function () { UI.lobby(); }, function (e) { busy('Nie udało się utworzyć lobby: ' + (e && e.message || e)); });
    } }));
    var codeIn = h('input', { type: 'text', maxlength: 8, placeholder: 'KOD', style: 'text-transform:uppercase;letter-spacing:0.15em;width:120px' });
    left.appendChild(h('div', { class: 'field' }, 'Dołącz kodem', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, codeIn, h('button', { type: 'button', text: 'Dołącz', onclick: function () { joinCode(codeIn.value); } }))));
    left.appendChild(status);
    left.appendChild(U().note(Net.local() ? 'Tryb testowy: lobby widzą tylko karty tej przeglądarki (parametr ?mp=local).' :
      'Lobby i łączenie graczy działa przez Supabase Realtime, a sam wyścig — bezpośrednio między przeglądarkami (WebRTC). Gdy połączenie bezpośrednie się nie uda, dane idą przez serwer, rzadziej. Host prowadzi AI i dyrekcję wyścigu — nie przełączaj karty, gdy jesteś hostem.'));
    var right = h('div', { class: 'panel col' }, h('h3', { text: 'Otwarte lobby' }));
    var list = h('div', { class: 'col', style: 'gap:8px' }, h('p', { class: 'muted', text: 'Łączę z serwerem…' }));
    right.appendChild(list);
    g2.appendChild(left); g2.appendChild(right); w.appendChild(g2); s.appendChild(w);
    function joinCode(code) {
      if (!st.mpName) { st.mpName = nameIn.value || 'Kierowca'; Store.save(); }
      busy('Dołączam…');
      Net.ready().then(function () { Net.setName(st.mpName); return M.join(code); }).then(function () {
        busy('Czekam na odpowiedź hosta…');
        setTimeout(function () { if (!M.L && M.room) { M.reset(); busy('Host nie odpowiada. Sprawdź kod lobby.'); } }, 15000);
      }, function (e) { busy('Nie udało się dołączyć: ' + (e && e.message || e)); });
    }
    function renderList(arr) {
      if (!list.isConnected) return;
      list.innerHTML = '';
      if (!arr.length) { list.appendChild(h('p', { class: 'muted', text: 'Brak otwartych lobby. Utwórz własne albo dołącz kodem od znajomego.' })); return; }
      arr.forEach(function (l) {
        var full = l.n >= l.max, open = l.st === 'lobby';
        list.appendChild(h('div', { class: 'card', style: 'cursor:default' },
          h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap' }, h('b', { text: String(l.name || l.code) }), h('span', { class: 'pill ' + (open ? 'green' : 'amber'), text: open ? 'w lobby' : 'trwa wyścig' })),
          h('span', { class: 'muted', style: 'font-size:14px', text: 'Host: ' + l.host + ' · ' + l.n + '/' + l.max + ' graczy · ' + (PG.trackDef ? PG.trackDef(l.tr).short : 'Monza') + ' · ' + l.laps + ' okr. · ' + (WNAME[l.w] || '') + ' · ' + (QNAME[l.q] || '') }),
          h('div', { class: 'row' }, h('span', { class: 'pill', text: 'Kod: ' + l.code }), h('button', { type: 'button', class: 'small primary', text: 'Dołącz', disabled: !open || full, onclick: function () { joinCode(l.code); } }))));
      });
    }
    M.onList = renderList;
    ensureDir().then(function () { renderList(M.lobbies || []); }, function (e) {
      list.innerHTML = ''; list.appendChild(h('p', { class: 'muted', text: 'Brak połączenia z serwerem lobby: ' + (e && e.message || e) + '. Możesz spróbować ponownie za chwilę.' }));
    });
    // link z kodem lobby
    var m = /[?&]lobby=([A-Za-z0-9]{4,8})/.exec(location.search || '');
    if (m && !M.autoJoined) { M.autoJoined = true; codeIn.value = m[1].toUpperCase(); joinCode(m[1]); }
  };
  function ensureDir() {
    if (M.dir) return Promise.resolve(M.dir);
    if (M.dirP) return M.dirP;
    M.dirP = Net.directory(function (arr) {
      // bez duplikatów i bez własnego (pustego) wpisu
      var seen = {}, out = [];
      arr.forEach(function (l) { if (l.code && !seen[l.code]) { seen[l.code] = 1; out.push(l); } });
      M.lobbies = out;
      if (M.onList) M.onList(out);
    }).then(function (d) { M.dir = d; M.dirP = null; return d; }, function (e) { M.dirP = null; throw e; });
    return M.dirP;
  }
  // link „?lobby=KOD" otwiera multiplayer od razu
  UI.multiAuto = function () {
    if (M.autoChecked) return false;
    M.autoChecked = true;
    if (/[?&]lobby=[A-Za-z0-9]{4,8}/.test(location.search || '')) { UI.multi(); return true; }
    return false;
  };

  // Pokój lobby
  UI.lobby = function () {
    if (!M.L) { UI.multi(); return; }
    var s = U().screen('lobby', 'dim'), w = wrap(1150);
    UI.lobbyShown = true;
    var head = h('div'), body = h('div', { class: 'grid2' });
    w.appendChild(head); w.appendChild(body); s.appendChild(w);
    UI.onLeave(function () { UI.lobbyShown = false; UI.lobbyRefresh = null; });
    var cur = { team: null, d: 0, custom: '' };
    function render() {
      var L = M.L; if (!L || !s.isConnected) return;
      var mine = myPlayer() || {}, teams = seatTeams();
      if (mine.team && !cur.team) { cur.team = mine.team; cur.d = mine.d; }
      head.innerHTML = '';
      var link = location.origin + location.pathname + '?lobby=' + L.code;
      head.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'col', style: 'gap:2px' }, h('h2', { text: L.name }), h('span', { class: 'muted', text: (M.isHost ? 'Jesteś hostem' : 'Host: ' + ((L.players.find(function (p) { return p.id === L.host; }) || {}).name || '?')) + ' · ' + (L.cfg.priv ? 'prywatne' : 'publiczne') })),
        h('div', { class: 'row' }, h('span', { class: 'pill amber', style: 'font-size:20px;letter-spacing:0.15em;padding:3px 12px', text: L.code }),
          h('button', { type: 'button', class: 'small', text: 'Kopiuj link', onclick: function () { try { navigator.clipboard.writeText(link).then(function () { UI.toast('Skopiowano link do lobby'); }); } catch (e) { UI.toast(link); } } }),
          h('button', { type: 'button', class: 'small danger', text: M.isHost ? 'Zamknij lobby' : 'Wyjdź', onclick: function () { M.leave(); UI.multi(); } }))));
      body.innerHTML = '';
      // gracze
      var tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Gracz' }), h('th', { text: 'Bolid' }), h('th', { text: 'Status' }), h('th', { text: 'Łącze' })));
      L.players.forEach(function (p) {
        var t = teams.find(function (x) { return x.id === p.team; });
        var dn = t ? (p.drv ? (p.drv.first + ' ' + p.drv.last) : PG.driverName(t.drivers[p.d] || t.drivers[0])) : '—';
        tbl.appendChild(h('tr', { class: p.id === me().id ? 'me' : '' },
          h('td', {}, (p.id === L.host ? '★ ' : '') + p.name),
          h('td', {}, t ? h('span', { class: 'teamchip', style: 'background:' + t.livery.primary }) : null, t ? t.short + ' · ' + dn : 'wybiera…'),
          h('td', {}, h('span', { class: 'pill ' + (p.ready || p.id === L.host ? 'green' : ''), text: p.id === L.host ? 'host' : p.ready ? 'gotowy' : 'czeka' })),
          h('td', { class: 'muted', text: p.id === L.host ? '' : p.link === 'p2p' ? 'bezpośrednie' : p.link === 'relay' ? 'przez serwer' : 'łączenie…' })));
      });
      var left = h('div', { class: 'panel col' }, h('h3', { text: 'Gracze ' + L.players.length + '/' + L.cfg.max }), h('div', { class: 'tblwrap' }, tbl));
      // ustawienia wyścigu
      var c = L.cfg, ro = !M.isHost;
      function opt(label, key, opts) {
        if (ro) { var o = opts.find(function (x) { return x[0] === c[key]; }); return h('div', { class: 'kv' }, h('span', { text: label }), h('span', { text: o ? o[1] : String(c[key]) })); }
        return h('label', { class: 'field' }, label, U().seg(opts, c[key], function (v) { M.setCfg(key, v); }));
      }
      var setP = h('div', { class: 'col', style: 'gap:8px' }, h('h3', { text: 'Wyścig' }));
      setP.appendChild(opt('Tor', 'track', (PG.TRACKS || [PG.MONZA]).map(function (t) { return [t.id, t.short || t.name]; })));
      setP.appendChild(opt('Dystans', 'laps', [[3, '3'], [5, '5'], [10, '10'], [15, '15'], [27, '27 · ½'], [53, '53 · pełny']]));
      setP.appendChild(opt('Pogoda', 'weather', [['sun', 'Słońce'], ['cloud', 'Chmury'], ['rain', 'Deszcz']]));
      setP.appendChild(opt('Kwalifikacje', 'quali', [['q3', 'Q1·Q2·Q3'], ['one', '1 okrążenie'], ['none', 'Bez (symulacja)']]));
      setP.appendChild(opt('Bolidy AI', 'ai', [[true, 'Pełna stawka'], [false, 'Tylko gracze']]));
      setP.appendChild(opt('Poziom AI', 'difficulty', [['easy', 'Łatwy'], ['normal', 'Normalny'], ['hard', 'Trudny']]));
      setP.appendChild(opt('SC i awarie', 'inc', PG.RC ? PG.RC.LEVELS : [['rare', 'Rzadko']]));
      setP.appendChild(opt('Zużycie opon', 'wear', [['auto', 'Auto'], [1, 'Realne'], [2, '×2'], [4, '×4']]));
      setP.appendChild(opt('Uszkodzenia', 'damage', [['full', 'Pełne'], ['visual', 'Wizualne'], ['off', 'Brak']]));
      setP.appendChild(opt('Miejsca', 'max', [[2, '2'], [4, '4'], [6, '6'], [8, '8'], [10, '10']]));
      if (!ro) setP.appendChild(opt('Widoczność', 'priv', [[false, 'Publiczne'], [true, 'Prywatne']]));
      left.appendChild(setP);
      // własne miejsce
      var right = h('div', { class: 'panel col' }, h('h3', { text: 'Twój bolid' }));
      var grid = h('div', { class: 'grid3' });
      teams.forEach(function (t) {
        var occ = [0, 1].map(function (k) { return L.players.find(function (p) { return p.team === t.id && p.d === k && p.id !== me().id; }); });
        var card = h('button', { type: 'button', class: 'card' + (cur.team === t.id ? ' on' : ''), disabled: !!(occ[0] && occ[1]), onclick: function () {
          cur.team = t.id; cur.d = occ[cur.d] ? (occ[0] ? 1 : 0) : cur.d; render();
        } }, U().teamStripe(t), h('b', { text: t.name }), h('span', { class: 'muted', style: 'font-size:13px', text: 'Osiągi ' + Math.round(PG.teamRating(t)) + (occ[0] || occ[1] ? ' · zajęte: ' + [occ[0], occ[1]].filter(Boolean).map(function (p) { return p.name; }).join(', ') : '') }));
        grid.appendChild(card);
      });
      right.appendChild(grid);
      var t0 = teams.find(function (x) { return x.id === cur.team; });
      if (t0) {
        var dsel = h('select', { onchange: function () { cur.d = +dsel.value; render(); } });
        t0.drivers.forEach(function (d, k) {
          var occ = L.players.find(function (p) { return p.team === t0.id && p.d === k && p.id !== me().id; });
          dsel.appendChild(h('option', { value: k, selected: cur.d === k, disabled: !!occ, text: '#' + d.num + ' ' + PG.driverName(d) + (occ ? ' (zajęte: ' + occ.name + ')' : '') }));
        });
        right.appendChild(h('label', { class: 'field' }, 'Miejsce w zespole', dsel));
        var cs = h('select', { onchange: function () { cur.custom = cs.value; } });
        cs.appendChild(h('option', { value: '', text: 'Kierowca zespołu', selected: !cur.custom }));
        Store.data.drivers.forEach(function (d, i) { cs.appendChild(h('option', { value: String(i), text: '★ ' + PG.driverName(d), selected: cur.custom === String(i) })); });
        if (Store.data.drivers.length) right.appendChild(h('label', { class: 'field' }, 'Kierowca', cs));
        right.appendChild(h('button', { type: 'button', text: mine.team === t0.id && mine.d === cur.d ? 'Miejsce zajęte ✓ (zmień)' : 'Zajmij to miejsce', onclick: function () {
          var drv = cur.custom !== '' ? Store.data.drivers[+cur.custom] : null;
          M.pickSeat(t0.id, cur.d, drv ? cleanDriver(drv, t0) : null);
        } }));
      }
      if (M.isHost) {
        var can = M.canStart();
        right.appendChild(h('button', { type: 'button', class: 'primary', disabled: !can, text: can ? 'Start weekendu →' : 'Start (wszyscy muszą wybrać bolid i być gotowi)', onclick: function () { M.start(); } }));
      } else {
        right.appendChild(h('button', { type: 'button', class: mine.ready ? '' : 'primary', disabled: !mine.team, text: mine.ready ? 'Gotowy ✓ (cofnij)' : 'Gotowy', onclick: function () { M.setReady(!mine.ready); render(); } }));
      }
      right.appendChild(U().note('Zespoły bez gracza prowadzi AI (gdy host wybrał pełną stawkę). Wyścig online nie zatrzymuje się na pauzie. Zjazd do boksu: B (pad: L1, przy ręcznej skrzyni Create).'));
      body.appendChild(left); body.appendChild(right);
    }
    UI.lobbyRefresh = render;
    render();
  };

  // Ekran oczekiwania
  UI.mpWait = function (text) {
    if (!M.isHost) M.waitAt = now();
    var s = U().screen('mpwait', 'dim');
    s.appendChild(h('div', { class: 'wrap', style: 'max-width:520px;margin:0;padding-block:12vh' }, h('div', { class: 'panel col' },
      h('h2', { text: M.L ? M.L.name : 'Multiplayer' }), h('p', { text: text }),
      h('button', { type: 'button', class: 'danger', text: 'Opuść', onclick: function () { M.leave(); UI.multi(); } }))));
  };

  // Kwalifikacje online: segment
  UI.mpQualiSeg = function (m, res) {
    var Q = PG.Quali, name = m.one ? 'Kwalifikacje' : Q.NAMES[m.seg], alive = m.alive.indexOf(M.myEi) >= 0, sent = false;
    var s = U().screen('mpq', 'dim'), p = h('div', { class: 'panel col' });
    p.appendChild(h('h3', { text: (M.L ? M.L.name : 'Online') + ' · kwalifikacje' }));
    p.appendChild(h('h2', { text: name }));
    p.appendChild(h('p', { text: m.one ? 'Jedno szybkie okrążenie ustala pola startowe.' : m.keep ? 'Awansuje ' + m.keep + ' z ' + m.alive.length + '. Każdy gracz jedzie swoje okrążenie, AI ma czasy symulowane.' : 'Q3: walka o pole position.' }));
    var info = h('p', { class: 'muted' });
    p.appendChild(info);
    var me0 = M.entries[M.myEi];
    function done(tm, how) { if (sent) return; sent = true; M.sendQTime(tm, m.seg); info.textContent = how + ' Czekam na pozostałych graczy…'; row.innerHTML = ''; }
    var row = h('div', { class: 'row' });
    if (alive && me0) {
      row.appendChild(h('button', { type: 'button', class: 'primary', text: 'Jedź okrążenie', onclick: function () {
        U().root().innerHTML = '';
        G.startSession({ mode: 'quali', entries: [{ driver: me0.driver, team: me0.team, isPlayer: true, compound: M.cfg.weather === 'rain' ? 'W' : 'S' }], laps: 1, weather: M.cfg.weather, difficulty: M.cfg.difficulty,
          target: m.target, targetLabel: m.keep ? 'AWANS' : 'POLE', qualiName: name }, function (out) {
          if (M.phase === 'race') return; // host już wystartował wyścig
          if (!M.room || !M.entries) { G.startAttract(); UI.multi(); return; } // lobby już nie ma
          G.startAttract();
          var t = out.aborted || !out.time ? Q.simTime(G.T, me0, cfgEnv(M.cfg), 'normal', m.seg) + 0.8 : out.time;
          UI.mpQualiSeg(m, { how: out.time ? 'Twój czas: ' + PG.fmtTime(t) + '.' : 'Czas symulowany: ' + PG.fmtTime(t) + '.' });
          M.sendQTime(t, m.seg); // po ekranie: u hosta może od razu zamknąć segment i pokazać wyniki
          runDeferred();
        });
      } }));
      row.appendChild(h('button', { type: 'button', text: 'Symuluj', onclick: function () { var t = Q.simTime(G.T, me0, cfgEnv(M.cfg), 'normal', m.seg); done(t, 'Czas symulowany: ' + PG.fmtTime(t) + '.'); } }));
      info.textContent = 'Masz ' + Math.round(m.dl / 60) + ' min na okrążenie. Cel: ' + PG.fmtTime(m.target) + (m.keep ? ' (awans)' : ' (pole position)') + '.';
    } else info.textContent = M.myEi < 0 ? 'Oglądasz — nie masz bolidu w tym wyścigu.' : 'Odpadłeś wcześniej — czekasz na wyniki.';
    if (res) { sent = true; row.innerHTML = ''; info.textContent = res.how + ' Czekam na pozostałych graczy…'; }
    p.appendChild(row);
    p.appendChild(h('button', { type: 'button', class: 'danger small', text: 'Opuść', onclick: function () { M.leave(); UI.multi(); } }));
    s.appendChild(h('div', { class: 'wrap', style: 'max-width:600px;margin:0;padding-block:6vh' }, p));
  };
  // Kwalifikacje online: wyniki segmentu
  UI.mpQualiRes = function (m) {
    var Q = PG.Quali, s = U().screen('mpqr', 'dim'), w = wrap(980), g2 = h('div', { class: 'grid2' });
    var name = m.one ? 'Kwalifikacje' : Q.NAMES[m.seg];
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Wyniki · ' + name }), h('div', { class: 'tblwrap' }, UI.qualiTable({ entries: M.entries }, m.rows, m.keep, M.myEi))));
    var side = h('div', { class: 'panel col' }), pos = m.rows.findIndex(function (r) { return r.i === M.myEi; }) + 1;
    if (pos) side.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + pos }), h('b', { text: m.keep ? (pos <= m.keep ? 'Awans!' : 'Odpadasz') : pos === 1 ? 'Pole position!' : 'Pole startowe P' + pos })));
    if (M.isHost) side.appendChild(h('button', { type: 'button', class: 'primary', text: m.done ? 'Pola startowe →' : 'Dalej: ' + Q.NAMES[m.seg + 1] + ' →', onclick: function () { M.qAdvance(); } }));
    else side.appendChild(h('p', { class: 'muted', text: 'Host przejdzie dalej (najpóźniej za 20 s).' }));
    g2.appendChild(side); w.appendChild(g2); s.appendChild(w);
  };
  // Pola startowe online: wybór opon
  UI.mpGrid = function (m) {
    var s = U().screen('mpgrid', 'dim'), w = wrap(980), g2 = h('div', { class: 'grid2' });
    var tbl = h('table', { class: 'tbl' }, h('tr', {}, h('th', { text: 'Poz' }), h('th', { text: 'Kierowca' }), h('th', { text: 'Gracz' }), h('th', { class: 'num', text: 'Czas' })));
    m.order.forEach(function (ei, k) {
      var e = M.entries[ei], pl = e.owner && M.L ? M.L.players.find(function (p) { return p.id === e.owner; }) : null;
      tbl.appendChild(h('tr', { class: ei === M.myEi ? 'me' : '' }, h('td', { class: 'num', text: String(k + 1) }),
        h('td', {}, h('span', { class: 'teamchip', style: 'background:' + e.team.livery.primary }), PG.driverName(e.driver)),
        h('td', { class: 'muted', text: pl ? pl.name : e.owner ? (e.name || 'gracz') : 'AI' }),
        h('td', { class: 'num', text: m.times[k] ? PG.fmtTime(m.times[k]) : '' })));
    });
    g2.appendChild(h('div', { class: 'panel col' }, h('h3', { text: 'Pola startowe' }), h('div', { class: 'tblwrap' }, tbl)));
    var side = h('div', { class: 'panel col' }), pos = m.order.indexOf(M.myEi) + 1;
    if (pos) {
      side.appendChild(h('div', { class: 'row' }, h('span', { class: 'big-pos', text: 'P' + pos }), h('b', { text: 'Twoje pole startowe' })));
      var wet = M.cfg.weather === 'rain', comp = wet ? 'W' : 'M', sent = false;
      side.appendChild(h('h3', { text: 'Opony na start' }));
      side.appendChild(U().seg(wet ? [['W', 'Deszczowe'], ['M', 'Pośrednie (slick)']] : [['S', 'Miękkie'], ['M', 'Pośrednie'], ['H', 'Twarde'], ['W', 'Deszczowe']], comp, function (v) { comp = v; }));
      var b = h('button', { type: 'button', class: 'primary', text: 'Gotowy na start', onclick: function () { if (sent) return; sent = true; M.sendTyre(comp); b.disabled = true; b.textContent = 'Czekam na pozostałych…'; } });
      side.appendChild(b);
    }
    side.appendChild(h('p', { class: 'muted', style: 'font-size:14px', text: 'Wyścig: ' + U().raceLen(M.cfg.laps) + '. Start, gdy wszyscy potwierdzą (najpóźniej za 40 s). Zjazd do boksu: B (pad: L1), opony 1–4.' }));
    g2.appendChild(side); w.appendChild(g2); s.appendChild(w);
  };
  // Wyniki online
  UI.mpResults = function (out) {
    var ctx = { mp: true, entries: M.entries || [], laps: M.cfg ? M.cfg.laps : 0, weather: M.cfg ? M.cfg.weather : 'sun', title: 'Wyścig online' };
    UI.results(ctx, out, M.gridPos || 0);
  };
})(PG);
