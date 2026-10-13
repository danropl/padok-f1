// Monza Grand Prix — sieć: lista lobby i sygnalizacja przez Supabase Realtime (obecność + broadcast, publiczne kanały),
// dane gry bezpośrednio między przeglądarkami (WebRTC, kanały danych), a gdy połączenie bezpośrednie się nie uda —
// przekaźnik przez Supabase z mniejszą częstotliwością. Tryb ?mp=local: karty tej samej przeglądarki (BroadcastChannel).
// API: Net.ready() → Promise, Net.me, Net.directory(onList), Net.room(code, isHost, handlers), Net.newCode().
(function (PG) {
  'use strict';

  function noop() { /* nic */ }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  var DEF = { url: 'https://wkqtnfbhxdhzyhpbiihf.supabase.co', key: 'sb_publishable_TZS8sxyiLgtuB770dgKEJw_-5pcrrds' };
  var ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
  var RELAY_MS = 125; // przekaźnik: najwyżej 8 wiadomości stanu na sekundę na odbiorcę

  var Net = PG.Net = { sb: null, mode: 'supabase', me: null, status: 'off', error: '' };

  function rid(n) { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; for (var i = 0; i < n; i++) s += a[(Math.random() * a.length) | 0]; return s; }
  Net.newCode = function () { return rid(5); };

  Net.local = function () { try { return /[?&]mp=local\b/.test(location.search) && typeof BroadcastChannel === 'function'; } catch (e) { return false; } };

  // Wczytanie biblioteki Supabase (dołączona do gry) i klienta
  var loading = null;
  Net.ready = function () {
    if (loading) return loading;
    var st = PG.Store && PG.Store.data ? PG.Store.data.settings : {};
    Net.me = { id: 'p_' + rid(8), name: (st.mpName || 'Kierowca ' + rid(3)).slice(0, 24) };
    if (Net.local()) { Net.mode = 'local'; Net.status = 'ok'; loading = Promise.resolve(true); return loading; }
    Net.status = 'loading';
    loading = new Promise(function (res, rej) {
      function make() {
        try {
          Net.sb = window.supabase.createClient(st.mpUrl || DEF.url, st.mpKey || DEF.key, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            realtime: { params: { eventsPerSecond: 40 } }
          });
          Net.status = 'ok'; res(true);
        } catch (e) { Net.status = 'error'; Net.error = String(e && e.message || e); rej(e); }
      }
      if (window.supabase && window.supabase.createClient) { make(); return; }
      var s = document.createElement('script');
      s.src = 'js/vendor/supabase.js'; s.async = true;
      s.onload = make;
      s.onerror = function () { Net.status = 'error'; Net.error = 'Nie udało się wczytać biblioteki Supabase'; rej(new Error(Net.error)); };
      document.head.appendChild(s);
    });
    loading.catch(function () { loading = null; });
    return loading;
  };
  Net.setName = function (name) { if (Net.me) Net.me.name = String(name || '').slice(0, 24) || Net.me.name; };

  // ---------- kanały: Supabase albo lokalny ----------
  // kanał: { onMsg(fn), onPresence(fn(list)), send(msg), track(meta), close() }
  function sbChannel(name) {
    return new Promise(function (res, rej) {
      var ch = Net.sb.channel(name, { config: { broadcast: { self: false, ack: false }, presence: { key: Net.me.id } } });
      var api = { mf: [], pf: [], closed: false };
      ch.on('broadcast', { event: 'm' }, function (p) { var m = p && p.payload; if (m) api.mf.forEach(function (f) { f(m); }); });
      ch.on('presence', { event: 'sync' }, function () {
        var st = ch.presenceState(), list = [];
        Object.keys(st).forEach(function (k) { (st[k] || []).forEach(function (m) { list.push(m); }); });
        api.pf.forEach(function (f) { f(list); });
      });
      api.onMsg = function (f) { api.mf.push(f); };
      api.onPresence = function (f) { api.pf.push(f); };
      api.send = function (m) { if (api.closed) return; try { var r = ch.send({ type: 'broadcast', event: 'm', payload: m }); if (r && r.catch) r.catch(noop); } catch (e) { /* nic */ } };
      api.track = function (meta) { api.meta = meta; try { var r = ch.track(meta); if (r && r.catch) r.catch(noop); } catch (e) { /* nic */ } };
      api.close = function () { api.closed = true; try { ch.untrack(); } catch (e) { /* nic */ } try { Net.sb.removeChannel(ch); } catch (e2) { /* nic */ } };
      var done = false;
      ch.subscribe(function (status, err) {
        // po ponownym połączeniu serwer nie pamięta obecności — zgłoś ją od nowa
        if (done && status === 'SUBSCRIBED' && api.meta && !api.closed) api.track(api.meta);
        if (done) return;
        if (status === 'SUBSCRIBED') { done = true; res(api); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { done = true; rej(err || new Error('Kanał ' + name + ': ' + status)); }
      });
      setTimeout(function () { if (!done) { done = true; rej(new Error('Brak odpowiedzi serwera (Supabase Realtime)')); } }, 12000);
    });
  }
  function localChannel(name) {
    var bc = new BroadcastChannel('mgp:' + name), api = { mf: [], pf: [], closed: false }, peers = {}, mine = null, iv;
    function emitPres() {
      var t = Date.now(), list = [];
      if (mine) list.push(mine);
      Object.keys(peers).forEach(function (id) { if (t - peers[id].t < 6500) list.push(peers[id].meta); else delete peers[id]; });
      api.pf.forEach(function (f) { f(list); });
    }
    function sendPres() { if (mine && !api.closed) bc.postMessage({ k: 'p', id: Net.me.id, meta: mine }); }
    bc.onmessage = function (e) {
      var d = e.data; if (!d || api.closed) return;
      if (d.k === 'm') api.mf.forEach(function (f) { f(d.m); });
      else if (d.k === 'p') { peers[d.id] = { meta: d.meta, t: Date.now() }; emitPres(); }
      else if (d.k === 'bye') { delete peers[d.id]; emitPres(); }
      else if (d.k === 'ask') sendPres();
    };
    api.onMsg = function (f) { api.mf.push(f); };
    api.onPresence = function (f) { api.pf.push(f); };
    api.send = function (m) { if (!api.closed) bc.postMessage({ k: 'm', m: m }); };
    api.track = function (meta) { mine = meta; sendPres(); emitPres(); };
    api.close = function () { if (api.closed) return; api.closed = true; clearInterval(iv); try { bc.postMessage({ k: 'bye', id: Net.me.id }); bc.close(); } catch (e) { /* nic */ } };
    iv = setInterval(function () { sendPres(); emitPres(); }, 2000);
    bc.postMessage({ k: 'ask' });
    setTimeout(emitPres, 60);
    return Promise.resolve(api);
  }
  function channel(name) { return Net.mode === 'local' ? localChannel(name) : sbChannel(name); }

  // ---------- lista lobby (obecność w kanale „mgp-lobbies") ----------
  Net.directory = function (onList) {
    return Net.ready().then(function () { return channel('mgp-lobbies'); }).then(function (ch) {
      ch.onPresence(function (list) {
        onList(list.filter(function (m) { return m && m.code && !m.priv; }));
      });
      // pusta obecność, by dostać stan kanału
      return {
        advertise: function (info) { ch.track(info); },
        close: function () { ch.close(); }
      };
    });
  };

  // ---------- połączenie WebRTC z jednym graczem ----------
  function Peer(room, id, initiator) {
    var self = this;
    this.room = room; this.id = id; this.ok = false; this.relay = false; this.pend = []; this.dcU = null; this.dcR = null; this.last = 0; this.rtt = 0;
    var pc;
    try { pc = this.pc = new RTCPeerConnection({ iceServers: ICE }); }
    catch (e) { this.relay = true; this.pc = null; room._peerState(this); return; }
    pc.onicecandidate = function (e) { if (e.candidate) room._signal(id, { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.onconnectionstatechange = function () {
      var s = pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') { if (!self.closed) { self.ok = false; if (s !== 'disconnected') self.relay = true; room._peerState(self); } }
      else if (s === 'connected' && !self.closed && !self.ok && self.dcU && self.dcR && self.dcU.readyState === 'open' && self.dcR.readyState === 'open') { self.ok = true; self.relay = false; room._peerState(self); }
    };
    if (initiator) {
      this.setup(pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }));
      this.setup(pc.createDataChannel('r', { ordered: true }));
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        room._signal(id, { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      }).catch(function () { self.relay = true; room._peerState(self); });
    } else pc.ondatachannel = function (e) { self.setup(e.channel); };
    // bez połączenia bezpośredniego w 10 s — przekaźnik
    this.timer = setTimeout(function () { if (!self.ok && !self.closed) { self.relay = true; room._peerState(self); } }, 10000);
  }
  Peer.prototype.setup = function (dc) {
    var self = this;
    if (dc.label === 'u') this.dcU = dc; else this.dcR = dc;
    dc.onopen = function () {
      if (self.dcU && self.dcR && self.dcU.readyState === 'open' && self.dcR.readyState === 'open') { self.ok = true; self.relay = false; clearTimeout(self.timer); self.room._peerState(self); }
    };
    dc.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (er) { return; }
      self.last = now();
      self.room._recv(m, self.id);
    };
  };
  Peer.prototype.signal = function (d) {
    var pc = this.pc, self = this;
    if (!pc) return;
    if (d.sdp) {
      pc.setRemoteDescription(d.sdp).then(function () {
        self.pend.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(noop); });
        if (d.sdp.type === 'offer') {
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); }).then(function () {
            self.room._signal(self.id, { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          });
        }
      }).catch(function () { self.relay = true; self.room._peerState(self); });
    } else if (d.c) {
      if (pc.remoteDescription) pc.addIceCandidate(d.c).catch(noop); else this.pend.push(d.c);
    }
  };
  Peer.prototype.send = function (msg, reliable) {
    var dc = reliable ? this.dcR : this.dcU;
    if (this.ok && dc && dc.readyState === 'open') { try { dc.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); return true; } catch (e) { return false; } }
    return false;
  };
  Peer.prototype.close = function () {
    this.closed = true; clearTimeout(this.timer);
    try { if (this.pc) this.pc.close(); } catch (e) { /* nic */ }
  };

  // ---------- pokój gry ----------
  // handlers: msg(m, fromId), presence(list), peer(peer)
  function Room(code, isHost, ch, handlers) {
    this.code = code; this.isHost = isHost; this.ch = ch; this.h = handlers || {};
    this.peers = {}; this.hostId = isHost ? Net.me.id : null; this.relayAt = {}; this.closed = false; this.seq = 0; this.nonce = rid(6); this.seen = {}; this.seenN = 0;
    var self = this;
    ch.onMsg(function (m) {
      if (!m || self.closed || m.f === Net.me.id) return;
      if (m.to && m.to !== Net.me.id && m.to !== '*') return;
      if (m.t === 'sig') { self._onSignal(m); return; }
      self._recv(m, m.f, true);
    });
    ch.onPresence(function (list) { if (self.h.presence) self.h.presence(list); });
  }
  Room.prototype._signal = function (to, d) { this.ch.send({ t: 'sig', f: Net.me.id, to: to, d: d }); };
  Room.prototype._onSignal = function (m) {
    var p = this.peers[m.f];
    // klient: oferta hosta tworzy połączenie
    if (!p && !this.isHost && m.d && m.d.sdp && m.d.sdp.type === 'offer') { p = this.peers[m.f] = new Peer(this, m.f, false); this._peerState(p); }
    if (p) p.signal(m.d);
  };
  Room.prototype._peerState = function (p) { if (this.h.peer) this.h.peer(p); };
  Room.prototype._recv = function (m, from, viaRelay) {
    if (this.closed) return;
    m.f = m.f || from;
    // stan przez przekaźnik od gracza, od którego właśnie płynie ruch bezpośredni — ignoruj (duplikat)
    var p = this.peers[from];
    if (viaRelay && m.u && p && p.ok && now() - p.last < 500) return;
    // wiadomości pewne mogą dojść dwiema drogami — tylko raz
    if (m.mid) {
      if (this.seen[m.mid]) return;
      this.seen[m.mid] = 1;
      if (++this.seenN > 600) { this.seen = {}; this.seenN = 0; this.seen[m.mid] = 1; }
    }
    if (this.h.msg) this.h.msg(m, from);
  };
  // host: połączenie z nowym graczem
  Room.prototype.connect = function (id) {
    if (!this.isHost || this.peers[id] || id === Net.me.id) return this.peers[id];
    var p = this.peers[id] = new Peer(this, id, true);
    this._peerState(p);
    return p;
  };
  Room.prototype.drop = function (id) { var p = this.peers[id]; if (p) { p.close(); delete this.peers[id]; } };
  // wysyłka do gracza: kanał bezpośredni, a bez niego przekaźnik (stan — z ograniczeniem częstotliwości)
  Room.prototype.sendTo = function (id, msg, reliable) {
    if (this.closed) return;
    msg.f = Net.me.id;
    if (reliable && !msg.mid) msg.mid = Net.me.id + ':' + this.nonce + ':' + (++this.seq);
    var p = this.peers[id];
    if (p && p.send(msg, reliable)) return;
    if (!reliable) {
      var t = now(); if (t - (this.relayAt[id] || 0) < RELAY_MS) return; this.relayAt[id] = t;
      msg.u = 1;
    }
    msg.to = id; this.ch.send(msg);
  };
  // host: do wszystkich (bezpośrednio albo jedną wiadomością przez przekaźnik)
  Room.prototype.broadcast = function (msg, reliable, ids) {
    if (this.closed) return;
    msg.f = Net.me.id;
    if (reliable && !msg.mid) msg.mid = Net.me.id + ':' + this.nonce + ':' + (++this.seq);
    var s = null, relayNeeded = false, self = this;
    (ids || Object.keys(this.peers)).forEach(function (id) {
      var p = self.peers[id];
      if (p && p.ok) { if (!s) s = JSON.stringify(msg); if (p.send(s, reliable)) return; }
      relayNeeded = true;
    });
    if (!relayNeeded) return; // nikt nie potrzebuje przekaźnika (albo nikogo nie ma)
    if (!reliable) { var t = now(); if (t - (this.relayAt['*'] || 0) < RELAY_MS) return; this.relayAt['*'] = t; msg.u = 1; }
    msg.to = '*'; this.ch.send(msg);
  };
  Room.prototype.toHost = function (msg, reliable) {
    if (this.hostId) { this.sendTo(this.hostId, msg, reliable); return; }
    msg.f = Net.me.id; if (reliable && !msg.mid) msg.mid = Net.me.id + ':' + this.nonce + ':' + (++this.seq);
    msg.to = '*'; this.ch.send(msg);
  };
  Room.prototype.track = function (meta) { this.ch.track(meta); };
  Room.prototype.close = function () {
    if (this.closed) return;
    this.closed = true;
    var self = this;
    Object.keys(this.peers).forEach(function (id) { self.peers[id].close(); });
    this.peers = {};
    this.ch.close();
  };
  Room.prototype.link = function (id) { var p = this.peers[id]; return !p ? '' : p.ok ? 'p2p' : p.relay ? 'relay' : 'wait'; };

  Net.room = function (code, isHost, handlers) {
    return Net.ready().then(function () { return channel('mgp-room-' + code); }).then(function (ch) { return new Room(code, isHost, ch, handlers); });
  };
})(PG);
