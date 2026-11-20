/* hangulkb.js — 두벌식 Hangul typing without an OS input method.
   Reads the PHYSICAL key (event.code), so it works on any laptop, any keyboard layout
   (Swiss/German QWERTZ included) and needs no Korean input set up on the computer.
   window.HangulKB: MAP, compose(tokens), tokensFor(text), cho(text), keyFor(jamo), rows(opts) */
(function () {
  var MAP = {
    KeyQ: ['ㅂ', 'ㅃ'], KeyW: ['ㅈ', 'ㅉ'], KeyE: ['ㄷ', 'ㄸ'], KeyR: ['ㄱ', 'ㄲ'], KeyT: ['ㅅ', 'ㅆ'],
    KeyY: ['ㅛ', 'ㅛ'], KeyU: ['ㅕ', 'ㅕ'], KeyI: ['ㅑ', 'ㅑ'], KeyO: ['ㅐ', 'ㅒ'], KeyP: ['ㅔ', 'ㅖ'],
    KeyA: ['ㅁ', 'ㅁ'], KeyS: ['ㄴ', 'ㄴ'], KeyD: ['ㅇ', 'ㅇ'], KeyF: ['ㄹ', 'ㄹ'], KeyG: ['ㅎ', 'ㅎ'],
    KeyH: ['ㅗ', 'ㅗ'], KeyJ: ['ㅓ', 'ㅓ'], KeyK: ['ㅏ', 'ㅏ'], KeyL: ['ㅣ', 'ㅣ'],
    KeyZ: ['ㅋ', 'ㅋ'], KeyX: ['ㅌ', 'ㅌ'], KeyC: ['ㅊ', 'ㅊ'], KeyV: ['ㅍ', 'ㅍ'], KeyB: ['ㅠ', 'ㅠ'],
    KeyN: ['ㅜ', 'ㅜ'], KeyM: ['ㅡ', 'ㅡ']
  };
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  var JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var VV = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
  var CC = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
  var SPLIT_V = {}, SPLIT_C = {};
  Object.keys(VV).forEach(function (k) { SPLIT_V[VV[k]] = [k[0], k[1]]; });
  Object.keys(CC).forEach(function (k) { SPLIT_C[CC[k]] = [k[0], k[1]]; });
  var isV = function (j) { return JUNG.indexOf(j) >= 0; };
  var isC = function (j) { return CHO.indexOf(j) >= 0; };

  function compose(tokens) {
    var out = '', cur = null;
    function flush() {
      if (!cur) return;
      if (cur.c && cur.v) {
        var f = cur.f ? (cur.f.length === 2 ? CC[cur.f[0] + cur.f[1]] : cur.f[0]) : '';
        out += String.fromCharCode(0xAC00 + (CHO.indexOf(cur.c) * 21 + JUNG.indexOf(cur.v)) * 28 + JONG.indexOf(f));
      } else out += (cur.c || '') + (cur.v || '');
      cur = null;
    }
    tokens.forEach(function (t) {
      if (t === ' ') { flush(); out += ' '; return; }
      if (isC(t)) {
        if (!cur) { cur = { c: t }; return; }
        if (!cur.v || !cur.c) { flush(); cur = { c: t }; return; }
        if (!cur.f) { if (JONG.indexOf(t) > 0) cur.f = [t]; else { flush(); cur = { c: t }; } return; }
        if (cur.f.length === 1 && CC[cur.f[0] + t]) { cur.f = [cur.f[0], t]; return; }
        flush(); cur = { c: t }; return;
      }
      if (isV(t)) {
        if (!cur) { cur = { v: t, vs: true }; return; }
        if (!cur.v) { cur.v = t; cur.vs = true; return; }
        if (!cur.f) {
          if (cur.vs && VV[cur.v + t]) { cur.v = VV[cur.v + t]; cur.vs = false; return; }
          flush(); cur = { v: t, vs: true }; return;
        }
        var moved;
        if (cur.f.length === 2) { moved = cur.f[1]; cur.f = [cur.f[0]]; } else { moved = cur.f[0]; cur.f = null; }
        flush(); cur = { c: moved, v: t, vs: true };
      }
    });
    flush();
    return out;
  }

  // the exact keystroke (jamo) sequence that types a text
  function tokensFor(text) {
    var out = [];
    String(text).split('').forEach(function (ch) {
      var code = ch.charCodeAt(0);
      if (ch === ' ') { if (out.length && out[out.length - 1] !== ' ') out.push(' '); return; }
      if (code >= 0xAC00 && code <= 0xD7A3) {
        var n = code - 0xAC00, c = CHO[Math.floor(n / 588)], v = JUNG[Math.floor((n % 588) / 28)], f = JONG[n % 28];
        out.push(c);
        if (SPLIT_V[v]) out.push(SPLIT_V[v][0], SPLIT_V[v][1]); else out.push(v);
        if (f) { if (SPLIT_C[f]) out.push(SPLIT_C[f][0], SPLIT_C[f][1]); else out.push(f); }
        return;
      }
      if (isC(ch) || isV(ch)) out.push(ch);
    });
    return out;
  }

  function cho(text) {
    return String(text).split('').map(function (ch) {
      var code = ch.charCodeAt(0);
      if (code >= 0xAC00 && code <= 0xD7A3) return CHO[Math.floor((code - 0xAC00) / 588)];
      return ch;
    }).join('');
  }

  // which key (and whether Shift) types a jamo
  var KEY_OF = {};
  Object.keys(MAP).forEach(function (code) {
    var a = MAP[code][0], b = MAP[code][1];
    if (!KEY_OF[a]) KEY_OF[a] = { code: code, shift: false };
    if (b !== a && !KEY_OF[b]) KEY_OF[b] = { code: code, shift: true };
  });
  function keyFor(j) { if (j === ' ') return { code: 'Space', shift: false }; return KEY_OF[j] || null; }

  var ROWS = [
    ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'],
    ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'],
    ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Backspace'],
    ['Space', 'Enter']
  ];
  // opts: { hi: code to glow, hiShift: bool, bad: bool (glow Backspace red), down: code just pressed, shiftOn: bool, press: fn(code) }
  function rows(opts) {
    opts = opts || {};
    return ROWS.map(function (r, ri) {
      return {
        cls: 'kb-r' + ri,
        keys: r.map(function (code) {
          var cls = 'kb-k', main = '', sub = '', w = 1;
          if (MAP[code]) {
            main = opts.shiftOn ? MAP[code][1] : MAP[code][0];
            sub = (!opts.shiftOn && MAP[code][1] !== MAP[code][0]) ? MAP[code][1] : '';
            cls += isV(MAP[code][0]) ? ' kb-v' : ' kb-c';
          } else if (code === 'ShiftLeft') { main = '⇧'; sub = 'Shift'; w = 1.5; cls += ' kb-fn' + (opts.shiftOn ? ' kb-on' : ''); }
          else if (code === 'Backspace') { main = '⌫'; sub = '지우기'; w = 1.5; cls += ' kb-fn'; }
          else if (code === 'Space') { main = ''; sub = '띄어쓰기 · Leertaste'; w = 6; cls += ' kb-fn kb-space'; }
          else if (code === 'Enter') { main = '⏎'; sub = 'Enter'; w = 2; cls += ' kb-fn kb-enter'; }
          if (opts.bad) { if (code === 'Backspace') cls += ' kb-bad'; }
          else if (opts.hi && code === opts.hi) cls += ' kb-hi';
          else if (opts.hi && opts.hiShift && code === 'ShiftLeft') cls += ' kb-hi';
          if (opts.down === code) cls += ' kb-down';
          return { code: code, main: main, sub: sub, cls: cls, grow: w, press: function () { if (opts.press) opts.press(code); } };
        })
      };
    });
  }

  // edit similarity on jamo (0..1)
  function sim(a, b) {
    var x = tokensFor(a).filter(function (t) { return t !== ' '; }), y = tokensFor(b).filter(function (t) { return t !== ' '; });
    if (!x.length && !y.length) return 1;
    var d = [], i, j;
    for (i = 0; i <= x.length; i++) { d[i] = [i]; }
    for (j = 0; j <= y.length; j++) d[0][j] = j;
    for (i = 1; i <= x.length; i++) for (j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return 1 - d[x.length][y.length] / Math.max(x.length, y.length);
  }

  window.HangulKB = { MAP: MAP, compose: compose, tokensFor: tokensFor, cho: cho, keyFor: keyFor, rows: rows, sim: sim };
  if (typeof module !== 'undefined') module.exports = window.HangulKB;
})();
