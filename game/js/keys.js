// WORLD GP — przypisanie klawiszy: każda akcja ma dwa miejsca na klawisz, zapis w ciasteczku przeglądarki (nie na serwerze).
(function (PG) {
  'use strict';
  var COOKIE = 'wgp_keys';
  // [akcja, nazwa w ustawieniach, domyślne klawisze (KeyboardEvent.code)]
  var ACTIONS = [
    ['up', 'Gaz', ['ArrowUp', 'KeyW']],
    ['down', 'Hamulec', ['ArrowDown', 'KeyS']],
    ['left', 'Skręt w lewo', ['ArrowLeft', 'KeyA']],
    ['right', 'Skręt w prawo', ['ArrowRight', 'KeyD']],
    ['drs', 'DRS', ['KeyE', 'Space']],
    ['shiftUp', 'Bieg w górę (ręczna skrzynia)', ['KeyX', 'NumpadAdd']],
    ['shiftDown', 'Bieg w dół (ręczna skrzynia)', ['KeyZ', 'NumpadSubtract']],
    ['back', 'Patrz do tyłu', ['KeyV', '']],
    ['camera', 'Zmiana kamery', ['KeyC', '']],
    ['reset', 'Powrót na tor', ['KeyR', '']],
    ['box', 'Zjazd do boksu', ['KeyB', '']],
    ['tyreS', 'Opony miękkie (w boksie)', ['Digit1', 'Numpad1']],
    ['tyreM', 'Opony pośrednie (w boksie)', ['Digit2', 'Numpad2']],
    ['tyreH', 'Opony twarde (w boksie)', ['Digit3', 'Numpad3']],
    ['tyreW', 'Opony deszczowe (w boksie)', ['Digit4', 'Numpad4']],
    ['pause', 'Pauza', ['Escape', 'KeyP']],
    ['sound', 'Dźwięk wł./wył.', ['KeyM', '']]
  ];
  var K = PG.Keys = { ACTIONS: ACTIONS, map: {}, byCode: {} };

  function defaults() { var m = {}; ACTIONS.forEach(function (a) { m[a[0]] = a[2].slice(); }); return m; }
  function readCookie() {
    try {
      var m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]*)'));
      return m ? JSON.parse(decodeURIComponent(m[1])) : null;
    } catch (e) { return null; }
  }
  function writeCookie(obj) {
    try {
      document.cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify(obj)) + '; max-age=' + (60 * 60 * 24 * 400) + '; path=/; SameSite=Lax';
    } catch (e) { /* ciasteczka zablokowane: zostają ustawienia na czas sesji */ }
  }
  function rebuild() {
    K.byCode = {};
    ACTIONS.forEach(function (a) { (K.map[a[0]] || []).forEach(function (c) { if (c) K.byCode[c] = a[0]; }); });
  }
  K.load = function () {
    var d = defaults(), saved = readCookie();
    if (saved && typeof saved === 'object') Object.keys(d).forEach(function (k) {
      var v = saved[k];
      if (Array.isArray(v)) d[k] = [String(v[0] || ''), String(v[1] || '')];
    });
    K.map = d; rebuild();
  };
  // Zapis tylko różnic względem domyślnych, by ciasteczko było krótkie
  K.save = function () {
    var d = defaults(), diff = {};
    Object.keys(K.map).forEach(function (k) { if (K.map[k].join('|') !== d[k].join('|')) diff[k] = K.map[k]; });
    writeCookie(diff);
  };
  K.action = function (code) { return K.byCode[code] || null; };
  K.is = function (code, action) { return K.byCode[code] === action; };
  // Przypisanie klawisza; jeśli był przy innej akcji, tamta dostaje klawisz zastępowany (zamiana miejscami)
  K.set = function (action, slot, code) {
    var old = K.map[action][slot];
    ACTIONS.forEach(function (a) {
      var m = K.map[a[0]];
      for (var i = 0; i < 2; i++) if (m[i] === code && !(a[0] === action && i === slot)) m[i] = old || '';
    });
    K.map[action][slot] = code;
    rebuild(); K.save();
  };
  K.clear = function (action, slot) { K.map[action][slot] = ''; rebuild(); K.save(); };
  K.reset = function () { K.map = defaults(); rebuild(); K.save(); };
  // Czytelna nazwa klawisza
  var NAMES = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Spacja', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab',
    ShiftLeft: 'L Shift', ShiftRight: 'P Shift', ControlLeft: 'L Ctrl', ControlRight: 'P Ctrl', AltLeft: 'L Alt', AltRight: 'P Alt',
    NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadEnter: 'Num Enter', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`' };
  K.label = function (code) {
    if (!code) return '—';
    if (NAMES[code]) return NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
    return code;
  };
  K.load();
})(PG);
