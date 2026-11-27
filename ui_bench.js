/* The bench screen: a big breadboard, the LaunchPad above it, a parts palette on the left, drag and drop, jumper wires.
   Everything electrical lives in bench.js; this file draws it and turns pointer input into bench edits. */
var BenchUI = (function () {
'use strict';
var NS = 'http://www.w3.org/2000/svg', G = MSP.BENCH, DEFS = MSP.PARTDEFS, ORDER = MSP.PARTORDER;
var $ = function (id) { return document.getElementById(id); };
var S, store, bench, svg, world, gBoard, gParts, gMcu, gWires, gOver, report = null, hooks = {};
var view = { x: 0, y: 0, k: 1 }, partObjs = {}, wireObjs = {}, sel = null, armed = null, pending = null, drag = null, ring = null, prev = null, wprev = null, pendMark = null;
var mcuLeds = [], mcuSw = [], pinEls = {}, txOn = null, inspInfo = {}, palItems = {}, pointers = {}, pinch = null, toastT = 0, saveT = 0, lastPin = 0, uidc = 0;
var LEG = { U: 82, L: 86 };
var GRPCOL = { Input: '#4A78B5', Output: '#2F9A6F', 'I2C0 devices': '#8458C4', 'SSI0 devices': '#C47A2C' };
var PINFN = { A0: 'UART0 RX (USB serial)', A1: 'UART0 TX (USB serial)', A2: 'SSI0 CLK', A3: 'SSI0 FSS', A4: 'SSI0 MOSI', A5: 'SSI0 MISO', B2: 'I2C0 SCL', B3: 'I2C0 SDA',
  E0: 'AIN3', E1: 'AIN2', E2: 'AIN1', E3: 'AIN0', F0: 'M0PWM0, LED D4', F1: 'M0PWM1', F2: 'M0PWM2', F3: 'M0PWM3', F4: 'LED D3', G0: 'M0PWM4', G1: 'M0PWM5',
  K4: 'M0PWM6', K5: 'M0PWM7', J0: 'switch SW1', J1: 'switch SW2', N0: 'LED D2', N1: 'LED D1' };
var BUSPIN = { A2: 1, A3: 1, A4: 1, A5: 1, B2: 1, B3: 1 };

function se(name, attrs, parent, text) {
  var e = document.createElementNS(NS, name);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  if (text !== undefined) e.textContent = text;
  return e;
}
function he(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function cls(el, v) { if (el.__c !== v) { el.__c = v; el.setAttribute('class', v); } }
function at(el, k, v) { var c = el.__a || (el.__a = {}); if (c[k] !== v) { c[k] = v; el.setAttribute(k, v); } }
function tx(el, v) { if (el.__t !== v) { el.__t = v; el.textContent = v; } }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function pinName(ref) { var r = G.parseRef(ref); if (!r) return ref; if (r.k === 'm') return r.sup ? r.sup : 'P' + r.pin; if (r.k === 'r') return 'rail ' + r.rail; return 'column ' + r.col + ' row ' + r.row; }

/* ---------- the board, the LaunchPad ---------- */
function buildBoard() {
  var BX = G.BX, BY = G.BY, BW = G.BW, BH = G.BH, d = '', c, i, k;
  se('rect', { class: 'bb-body', x: BX, y: BY, width: BW, height: BH, rx: 10 }, gBoard);
  se('rect', { class: 'bb-trench', x: BX + 12, y: BY + 168, width: BW - 24, height: 16, rx: 3 }, gBoard);
  [['T+', -10, 'bb-plus'], ['T-', 10, 'bb-minus'], ['B+', -10, 'bb-plus'], ['B-', 10, 'bb-minus']].forEach(function (r) {
    var y = G.railY(r[0]) + r[1]; se('line', { class: r[2], x1: BX + 18, x2: BX + BW - 18, y1: y, y2: y }, gBoard);
    var s = r[0].charAt(1) === '+' ? '+' : '−';
    se('text', { class: 'bb-sign ' + r[2], x: BX + 10, y: G.railY(r[0]) + 4, 'text-anchor': 'middle' }, gBoard, s);
    se('text', { class: 'bb-sign ' + r[2], x: BX + BW - 10, y: G.railY(r[0]) + 4, 'text-anchor': 'middle' }, gBoard, s);
  });
  for (c = 1; c <= G.COLS; c++) {
    for (i = 0; i < 10; i++) d += 'M' + (G.X(c) - 3) + ' ' + (G.rowY(G.ROWS[i]) - 3) + 'h6v6h-6z';
    if (c === 1 || c % 5 === 0) {
      se('text', { class: 'bb-num', x: G.X(c), y: BY + 56, 'text-anchor': 'middle' }, gBoard, c);
      se('text', { class: 'bb-num', x: G.X(c), y: BY + 300, 'text-anchor': 'middle' }, gBoard, c);
    }
  }
  G.RAILS.forEach(function (r) { for (k = 0; k < G.RAILN; k++) d += 'M' + (G.railX(k) - 3) + ' ' + (G.railY(r) - 3) + 'h6v6h-6z'; });
  se('path', { class: 'bb-hole', d: d }, gBoard);
  G.ROWS.forEach(function (r) {
    se('text', { class: 'bb-num', x: BX + 40, y: G.rowY(r) + 3, 'text-anchor': 'middle' }, gBoard, r);
    se('text', { class: 'bb-num', x: BX + BW - 40, y: G.rowY(r) + 3, 'text-anchor': 'middle' }, gBoard, r);
  });
  se('text', { class: 'bb-note', x: BX + BW / 2, y: BY + 176 + 4, 'text-anchor': 'middle' }, gBoard, 'Each column of five holes is joined inside the board. The two halves are not joined. Each power rail runs the whole length.');
}
function holdSvg(el, press, release, minMs) {
  var down = false, t0 = 0;
  function dn(e) { e.stopPropagation(); e.preventDefault(); if (down) return; down = true; t0 = performance.now(); try { el.setPointerCapture(e.pointerId); } catch (x) {} press(); }
  function up() { if (!down) return; setTimeout(function () { down = false; release(); }, Math.max(0, minMs - (performance.now() - t0))); }
  el.addEventListener('pointerdown', dn);
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { el.addEventListener(n, up); });
}
function buildMcu() {
  var g = se('g', { class: 'mcu' }, gMcu), H = G.MCU_H, i;
  se('rect', { class: 'pcb', x: 30, y: 0, width: 1280, height: H, rx: 12, 'data-role': 'mcu' }, g);
  se('rect', { class: 'metal', x: 330, y: 0, width: 100, height: 26, rx: 3, 'data-role': 'mcu' }, g);
  se('text', { class: 'silk dark', x: 380, y: 17, 'text-anchor': 'middle', 'data-role': 'mcu' }, g, 'USB');
  se('text', { class: 'silk big', x: 54, y: 28, 'data-role': 'mcu' }, g, 'MSP-EXP432E401Y');
  se('text', { class: 'silk s', x: 54, y: 42, 'data-role': 'mcu' }, g, 'SimpleLink Ethernet MSP432E401Y LaunchPad');
  var ob = se('g', { class: 'mcu-open', 'data-role': 'open', tabindex: '0', role: 'button', 'aria-label': 'Open the program editor and debugger' }, g);
  se('rect', { x: 54, y: 52, width: 150, height: 26, rx: 6 }, ob); se('text', { x: 129, y: 69, 'text-anchor': 'middle' }, ob, 'Open program ▸');
  se('text', { class: 'silk s', x: 54, y: 96, 'data-role': 'mcu' }, g, 'Double-click the board to open the editor and debugger.');
  se('rect', { class: 'ic', x: 560, y: 40, width: 150, height: 52, rx: 4, 'data-role': 'mcu' }, g);
  se('text', { class: 'icx', x: 635, y: 62, 'text-anchor': 'middle', 'data-role': 'mcu' }, g, 'MSP432E401Y');
  se('text', { class: 'icx s', x: 635, y: 78, 'text-anchor': 'middle', 'data-role': 'mcu' }, g, 'Cortex-M4F 120 MHz');
  se('circle', { class: 'led-off', cx: 232, cy: 65, r: 4 }, g); txOn = se('circle', { class: 'led-on', cx: 232, cy: 65, r: 3.2, opacity: 0 }, g);
  se('text', { class: 'silk s', x: 242, y: 68, 'data-role': 'mcu' }, g, 'UART');
  [['D1', 'N', 1], ['D2', 'N', 0], ['D3', 'F', 4], ['D4', 'F', 0]].forEach(function (d, k) {
    var lg = se('g', { transform: 'translate(' + (800 + k * 46) + ' 62)', 'data-role': 'mcu' }, g);
    var halo = se('circle', { r: 15, class: 'led-on', filter: 'url(#bGlow)', opacity: 0 }, lg);
    se('circle', { r: 8.5, class: 'led-off' }, lg); var core = se('circle', { r: 6.5, class: 'led-on', opacity: 0 }, lg);
    se('text', { class: 'silk', y: 22, 'text-anchor': 'middle' }, lg, d[0]);
    mcuLeds.push({ L: d[1], b: d[2], halo: halo, core: core });
  });
  [['SW1', 'J', 0, 1010], ['SW2', 'J', 1, 1060]].forEach(function (d) {
    var sg = se('g', { transform: 'translate(' + d[3] + ' 62)', class: 'mcu-sw', 'data-role': 'ctl', tabindex: '0', role: 'button', 'aria-label': 'User switch ' + d[0] + ', hold to press' }, g);
    se('rect', { x: -13, y: -13, width: 26, height: 26, rx: 3, class: 'swbase' }, sg); var cap = se('circle', { r: 8.5, class: 'cap' }, sg);
    se('text', { class: 'silk', y: 26, 'text-anchor': 'middle' }, sg, d[0]);
    var press = function () { if (S.onboard.sw) S.setInput(d[1], d[2], 0); }, rel = function () { S.setInput(d[1], d[2], null); };
    holdSvg(sg, press, rel, 0);
    sg.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
    sg.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') rel(); });
    mcuSw.push({ L: d[1], b: d[2], cap: cap });
  });
  var i0 = G.GROUPS;
  [i0.out, i0.inn].forEach(function (row, ri) {
    row.forEach(function (L, pi) {
      var a = G.mcuXY('m:' + L + 0), b = G.mcuXY('m:' + L + 7);
      se('rect', { class: 'pgrp' + (pi % 2 ? ' alt' : ''), x: a.x - 10, y: a.y - 20, width: b.x - a.x + 20, height: 32, rx: 6 }, g);
      for (i = 0; i < 8; i++) {
        var ref = 'm:' + L + i, p = G.mcuXY(ref), fn = PINFN[L + i];
        var pad = se('circle', { class: 'mpad' + (BUSPIN[L + i] ? ' bus' : ''), cx: p.x, cy: p.y, r: 4.6 }, g);
        se('title', null, pad, 'P' + L + i + (fn ? ' • ' + fn : ''));
        se('text', { class: 'mplab', x: p.x, y: p.y - 8, 'text-anchor': 'middle' }, g, L + i);
        pinEls[L + i] = pad;
      }
    });
  });
  G.GROUPS.supply.forEach(function (s, k) {
    var ref = 'm:' + s[0] + '.' + s[1], p = G.mcuXY(ref);
    var pad = se('circle', { class: 'mpad sup ' + (s[0] === 'GND' ? 'gnd' : s[0] === '5V' ? 'v5' : 'v33'), cx: p.x, cy: p.y, r: 4.6 }, g);
    se('title', null, pad, s[0] === 'GND' ? 'GND' : s[0] === '5V' ? '5 V' : '3.3 V');
    se('text', { class: 'mplab sup', x: p.x, y: p.y - 8, 'text-anchor': 'middle' }, g, s[0]);
  });
}
function updatePins() {
  var L, b, p, st, m, alt, c;
  G.GROUPS.out.concat(G.GROUPS.inn).forEach(function (L) {
    p = S.gpio[L];
    for (b = 0; b < 8; b++) {
      m = 1 << b; alt = p.alt[b];
      if (alt && alt.indexOf('pwm') === 0) c = 'mpad pwm' + (p.lv[b] > 0 ? ' hi' : '');
      else if (alt) c = 'mpad alt';
      else if (p.analog & m) c = 'mpad alt';
      else if ((p.dir & m) && (p.den & m)) c = 'mpad out' + (p.dig[b] ? ' hi' : '');
      else if (p.den & m) c = 'mpad in' + (p.dig[b] ? ' hi' : '');
      else c = 'mpad';
      if (BUSPIN[L + b]) c += ' bus';
      cls(pinEls[L + b], c);
    }
  });
}

/* ---------- parts on the board ---------- */
var DYN = ['opacity', 'fill', 'width', 'transform', 'x2', 'y2'];
// A live copy of a part card's drawing: the card keeps animating, the copy follows it.
function mirror(cardEl, parent, x, y, w, h) {
  var src = cardEl && cardEl.querySelector('svg.partsvg'); if (!src) return null;
  var vb = src.getAttribute('viewBox') || '0 0 100 100', n = se('svg', { x: x, y: y, width: w, height: h, viewBox: vb, preserveAspectRatio: 'xMidYMid meet' }, parent);
  var wrap = se('g', { class: 'partsvg' + (src.id === 'relaySvg' ? ' relaysvg' : '') }, n), uid = ++uidc, used = {};
  var html = src.innerHTML.replace(/url\(#([\w-]+)\)/g, function (m, i) { used[i] = 1; return m; });
  html = html.replace(/\sid="([\w-]+)"/g, function (m, i) { return used[i] ? ' id="' + i + '_b' + uid + '"' : ''; }).replace(/url\(#([\w-]+)\)/g, 'url(#$1_b' + uid + ')');
  wrap.innerHTML = html;
  var pairs = [];
  Array.prototype.forEach.call(src.querySelectorAll('[data-k]'), function (s) {
    var d = wrap.querySelector('[data-k="' + s.getAttribute('data-k') + '"]'); if (!d) return;
    var init = {}; DYN.forEach(function (a) { init[a] = d.getAttribute(a); }); pairs.push({ s: s, d: d, init: init });
  });
  return { upd: function (on) {
    pairs.forEach(function (p) {
      DYN.forEach(function (a) { var v = on ? p.s.getAttribute(a) : p.init[a]; if (v !== null && p.d.getAttribute(a) !== v) p.d.setAttribute(a, v); });
    });
  } };
}
var KEYS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D'];
function chip(g, w, h, label) {
  se('rect', { class: 'chipbody', x: w / 2 - 36, y: h / 2 - 14, width: 72, height: 28, rx: 3 }, g);
  se('circle', { class: 'chipdot', cx: w / 2 - 28, cy: h / 2 - 6, r: 2.2 }, g);
  se('text', { class: 'chiptxt', x: w / 2, y: h / 2 + 4, 'text-anchor': 'middle' }, g, label);
}
var FACES = {
  keypad: function (g, w, h) {
    var cw = w / 4, ch = h / 4, ks = [];
    KEYS.forEach(function (k, i) {
      var r = i >> 2, c = i & 3, kg = se('g', { class: 'bkey', 'data-role': 'ctl', transform: 'translate(' + c * cw + ' ' + r * ch + ')' }, g);
      se('rect', { x: 1.5, y: 1.5, width: cw - 3, height: ch - 3, rx: 3 }, kg); se('text', { x: cw / 2, y: ch / 2 + 4, 'text-anchor': 'middle' }, kg, k);
      holdSvg(kg, function () { S.keySet(r, c, 1); }, function () { S.keySet(r, c, 0); }, 120); ks.push(kg);
    });
    return { upd: function () { var dn = S.keypad.down; ks.forEach(function (kg, i) { cls(kg, 'bkey' + (dn[i >> 2][i & 3] ? ' down' : '')); }); } };
  },
  btns: function (g, w, h) {
    var bs = [];
    for (var i = 0; i < 4; i++) (function (i) {
      var bg = se('g', { class: 'bbtn', 'data-role': 'ctl', transform: 'translate(' + (w / 8 + i * w / 4) + ' ' + h / 2 + ')' }, g);
      se('circle', { r: Math.min(12, h / 2 - 2) }, bg); se('text', { y: 3.5, 'text-anchor': 'middle' }, bg, 'B' + (i + 1));
      holdSvg(bg, function () { S.btnSet(i, 1); }, function () { S.btnSet(i, 0); }, 60); bs.push(bg);
    })(i);
    return { upd: function () { var dn = S.mods.btns.down; bs.forEach(function (b, i) { cls(b, 'bbtn' + (dn[i] ? ' down' : '')); }); } };
  },
  dip: function (g, w, h) {
    var ks = [], tw = 20, th = Math.min(46, h - 4);
    for (var i = 0; i < 4; i++) (function (i) {
      var x = w / 8 + i * w / 4 - tw / 2, tg = se('g', { class: 'bdip', 'data-role': 'ctl', transform: 'translate(' + x + ' ' + (h - th) / 2 + ')', role: 'switch' }, g);
      se('rect', { width: tw, height: th, rx: 3 }, tg); var kn = se('rect', { class: 'knob', x: 2, y: 2, width: tw - 4, height: th / 2 - 2, rx: 2 }, tg);
      tg.addEventListener('pointerdown', function (e) { e.stopPropagation(); e.preventDefault(); S.dipSet(i, !S.mods.dip.state[i]); });
      ks.push({ g: tg, k: kn, th: th });
    })(i);
    return { upd: function () { var st = S.mods.dip.state; ks.forEach(function (o, i) { at(o.k, 'y', st[i] ? o.th / 2 : 2); at(o.g, 'aria-checked', st[i] ? 'true' : 'false'); }); } };
  },
  i2c_tmp: function (g, w, h) {
    chip(g, w, h, 'TMP102'); var t = se('text', { class: 'bigtxt', x: w / 2, y: h - 4, 'text-anchor': 'middle' }, g, '');
    return { upd: function (on) { tx(t, on ? S.mods.i2c_tmp.temp.toFixed(1) + ' °C' : ''); } };
  },
  i2c_eeprom: function (g, w, h) {
    chip(g, w, h, '24C02'); var t = se('text', { class: 'bigtxt s', x: w / 2, y: h - 4, 'text-anchor': 'middle' }, g, '');
    return { upd: function (on) { tx(t, on ? S.busDevice('i2c_eeprom').st.writes + ' writes' : ''); } };
  },
  spi_eeprom: function (g, w, h) {
    chip(g, w, h, '25LC256'); var t = se('text', { class: 'bigtxt s', x: w / 2, y: h - 4, 'text-anchor': 'middle' }, g, '');
    return { upd: function (on) { tx(t, on ? S.busDevice('spi_eeprom').st.writes + ' writes' : ''); } };
  },
  i2c_lcd: function (g, w, h, card) {
    var bg = se('rect', { class: 'lcdbg', width: w, height: h, rx: 4 }, g), ls = [], cells = card ? card.el.querySelectorAll('.lcdc') : [], disp = card ? card.el.querySelector('.lcd') : null;
    for (var r = 0; r < 2; r++) ls.push(se('text', { class: 'lcdtxt', x: 6, y: h / 2 - 6 + r * 24 + 2, textLength: w - 12, lengthAdjust: 'spacing' }, g, ''));
    return { upd: function (on) {
      var dc = disp ? disp.className : '', lit = /\bon\b/.test(dc), bl = /\bbl\b/.test(dc);
      cls(bg, 'lcdbg' + (on && lit ? (bl ? ' bl' : ' on') : ''));
      for (var r = 0; r < 2; r++) { var s = ''; for (var k = 0; k < 16; k++) s += on && cells[r * 16 + k] ? (cells[r * 16 + k].textContent || ' ') : ' '; tx(ls[r], s.replace(/ /g, ' ')); }
    } };
  },
  i2c_oled: function (g, w, h, card) {
    var fo = se('foreignObject', { x: (w - 128) / 2, y: (h - 64) / 2, width: 128, height: 64 }, g), cv = document.createElement('canvas');
    cv.width = 128; cv.height = 64; cv.style.cssText = 'width:128px;height:64px;display:block;background:#05070A;image-rendering:pixelated'; fo.appendChild(cv);
    var src = card ? card.el.querySelector('canvas') : null, last = '';
    return { upd: function (on) {
      var k = on ? (S.busDevice('i2c_oled').st.rev + ':' + S.mods.i2c_oled.on) : 'off';
      if (k === last) return; last = k;
      var c = cv.getContext && cv.getContext('2d'); if (!c) return;
      c.fillStyle = '#05070A'; c.fillRect(0, 0, 128, 64); if (on && src) c.drawImage(src, 0, 0);
    } };
  },
  spi_595: function (g, w, h) {
    var ls = [];
    for (var i = 0; i < 8; i++) ls.push(se('circle', { class: 'bled', cx: 12 + i * ((w - 24) / 7), cy: h / 2, r: 6.5 }, g));
    return { upd: function (on) { var o = on ? S.busDevice('spi_595').st.out : 0; ls.forEach(function (l, i) { cls(l, 'bled' + ((o >> (7 - i)) & 1 ? ' on' : '')); }); } };
  }
};
var MIRRORED = { relay: 1, ledbar: 1, rgb: 1, seg: 1, buzzer: 1, motor: 1, servo: 1, stepper: 1 };

var SHORTT = { i2c_tmp: 'TMP102', i2c_eeprom: 'EEPROM 24C02', i2c_lcd: 'LCD 16x2', i2c_oled: 'OLED 128x64', spi_eeprom: 'EEPROM 25LC256', spi_595: '74HC595 + LEDs', motor: 'DC motor', stepper: 'Stepper', ledbar: 'LED bar', btns: 'Buttons', dip: 'DIP switches', keypad: 'Keypad' };
function partShort(res) {
  var m = (res.msgs[0] || '');
  if (/^VCC/.test(m)) return /GND/.test(m) ? 'VCC on GND' : /needs/.test(m) ? 'wrong voltage' : 'no power';
  if (/^GND/.test(m)) return 'no GND';
  if (/^COM/.test(m)) return 'no COM wire';
  return 'check bus wires';
}
function buildPart(part) {
  var d = DEFS[part.type], U = part.half === 'U', ox = G.X(part.col), oy = G.rowY(G.PINROW[part.half]);
  var g = se('g', { class: 'bpart', transform: 'translate(' + ox + ' ' + oy + ')', 'data-role': 'part', 'data-uid': part.id }, gParts);
  var by = U ? -(LEG.U + d.bodyH) : LEG.L, col = GRPCOL[d.grp];
  d.pins.forEach(function (p, k) {
    se('line', { class: 'bleg', x1: k * 20, x2: k * 20, y1: 0, y2: U ? -LEG.U : LEG.L }, g);
    se('circle', { class: 'bpin', cx: k * 20, cy: 0, r: 4.2 }, g);
  });
  var body = se('g', { transform: 'translate(-10 ' + by + ')' }, g);
  var rect = se('rect', { class: 'bpbody', x: 0, y: 0, width: d.bodyW, height: d.bodyH, rx: 6, stroke: col }, body);
  se('rect', { class: 'bphead', x: 0, y: U ? 0 : d.bodyH - 16, width: d.bodyW, height: 16, rx: 6, fill: col }, body);
  se('text', { class: 'bptitle', x: 6, y: U ? 12 : d.bodyH - 4 }, body, SHORTT[part.type] || d.label.replace(/ \(.*\)$/, ''));
  d.pins.forEach(function (p, k) {
    se('text', { class: 'bplabel ' + p.r, x: 10 + k * 20, y: U ? d.bodyH - 4 : 10, 'text-anchor': 'middle' }, body, p.n);
  });
  var fx = 6, fy = U ? 20 : 14, fw = d.bodyW - 12, fh = d.bodyH - 20 - 16 - (U ? 0 : 0);
  if (!U) fh = d.bodyH - 14 - 16 - 2;
  var fg = se('g', { transform: 'translate(' + fx + ' ' + fy + ')' }, body), card = window.PartsUI ? PartsUI.card(part.type) : null, face = null;
  if (MIRRORED[part.type]) face = mirror(card && card.el, fg, 0, 0, fw, fh);
  else if (FACES[part.type]) face = FACES[part.type](fg, fw, fh, card);
  var dot = se('circle', { class: 'bpwr', cx: d.bodyW - 9, cy: U ? 8 : d.bodyH - 8, r: 3.2 }, body);
  var badge = se('text', { class: 'bpbadge', x: d.bodyW - 16, y: U ? 12 : d.bodyH - 4, 'text-anchor': 'end' }, body, '');
  var po = { part: part, g: g, rect: rect, face: face, dot: dot, badge: badge, upd: function () {
    var on = S.partIsOn(part.type), res = report && report.parts[part.type];
    if (face) face.upd(on);
    cls(dot, 'bpwr ' + (on ? 'on' : 'off'));
    tx(badge, on || !res ? '' : partShort(res));
    cls(g, 'bpart' + (on ? '' : ' off') + (sel && sel.k === 'part' && sel.id === part.id ? ' sel' : ''));
  } };
  partObjs[part.id] = po; return po;
}
function drawParts() {
  while (gParts.firstChild) gParts.removeChild(gParts.firstChild);
  partObjs = {};
  bench.parts.forEach(buildPart);
  Object.keys(partObjs).forEach(function (k) { partObjs[k].upd(); });
}

/* ---------- wires ---------- */
function wirePath(a, b) {
  var p = G.xy(a), q = G.xy(b), ma = a.charAt(0) === 'm', mb = b.charAt(0) === 'm', c;
  if (ma !== mb) {
    var m = ma ? p : q, o = ma ? q : p; c = Math.max(34, Math.min(150, Math.abs(o.y - m.y) * 0.45));
    return 'M' + m.x + ' ' + m.y + ' C' + m.x + ' ' + (m.y + c) + ' ' + o.x + ' ' + (o.y - c) + ' ' + o.x + ' ' + o.y;
  }
  if (ma && mb) { c = 40 + Math.abs(p.x - q.x) * 0.1; return 'M' + p.x + ' ' + p.y + ' C' + p.x + ' ' + (p.y + c) + ' ' + q.x + ' ' + (q.y + c) + ' ' + q.x + ' ' + q.y; }
  var h = 28 + Math.min(Math.abs(p.x - q.x) * 0.22, 80), top = Math.min(p.y, q.y) - h;
  return 'M' + p.x + ' ' + p.y + ' C' + p.x + ' ' + top + ' ' + q.x + ' ' + top + ' ' + q.x + ' ' + q.y;
}
function drawWires() {
  while (gWires.firstChild) gWires.removeChild(gWires.firstChild);
  wireObjs = {};
  bench.wires.forEach(function (w) {
    var g = se('g', { class: 'bwire' + (sel && sel.k === 'wire' && sel.id === w.id ? ' sel' : ''), 'data-role': 'wire', 'data-wid': w.id }, gWires), d = wirePath(w.a, w.b);
    se('path', { class: 'w-out', d: d }, g); se('path', { class: 'w-col', d: d, stroke: w.color }, g); se('path', { class: 'w-hit', d: d }, g);
    ['a', 'b'].forEach(function (e) {
      var p = G.xy(w[e]);
      se('circle', { class: 'w-end', cx: p.x, cy: p.y, r: 5.5, fill: w.color, 'data-role': 'wend', 'data-wid': w.id, 'data-end': e }, g);
    });
    wireObjs[w.id] = g;
  });
}

/* ---------- view ---------- */
function applyView() { world.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'); }
function fit() {
  var r = svg.getBoundingClientRect(), W = 1340, Hh = G.BY + G.BH + 8 + 240 + 8;
  if (!r.width) return;
  view.k = Math.max(0.15, Math.min(1.6, Math.min((r.width - 16) / W, (r.height - 16) / Hh)));
  view.x = (r.width - W * view.k) / 2 + 5 * view.k; view.y = 8; applyView();
}
function zoomAt(f, cx, cy) {
  var k = Math.max(0.15, Math.min(3, view.k * f)); f = k / view.k;
  view.x = cx - (cx - view.x) * f; view.y = cy - (cy - view.y) * f; view.k = k; applyView();
}
function worldPt(ev) { var r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k }; }
function toast(msg, bad) {
  var t = $('benchToast'); if (!t) return; t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(function () { t.className = ''; }, 3800);
}

/* ---------- preview while dragging ---------- */
function clearPrev() { if (prev) { prev.remove(); prev = null; } }
function showPrev(type, col, half, why) {
  clearPrev();
  var d = DEFS[type], U = half === 'U', g = prev = se('g', { class: 'bprev ' + (why ? 'bad' : 'good') }, gOver);
  var ox = G.X(col), oy = G.rowY(G.PINROW[half]), by = U ? -(LEG.U + d.bodyH) : LEG.L;
  var gg = se('g', { transform: 'translate(' + ox + ' ' + oy + ')' }, g);
  se('rect', { x: -10, y: by, width: d.bodyW, height: d.bodyH, rx: 6 }, gg);
  se('text', { x: -4, y: by + (U ? 14 : d.bodyH - 6) }, gg, d.label);
  d.pins.forEach(function (p, k) { se('circle', { cx: k * 20, cy: 0, r: 6 }, gg); se('line', { x1: k * 20, x2: k * 20, y1: 0, y2: U ? -LEG.U : LEG.L }, gg); });
  if (why) se('text', { class: 'prevwhy', x: ox - 10, y: oy + (U ? by - 8 : by + d.bodyH + 16) }, g, why);
}
function slot(type, world, grab) {
  var half = world.y < G.BY + G.BH / 2 ? 'U' : 'L';
  var col = Math.round((world.x - (grab || 0) - G.X(1)) / 20) + 1;
  return { col: col, half: half };
}
function inBand(w) { return w.x > -40 && w.x < 1400 && w.y > G.BY - 230 && w.y < G.BY + G.BH + 230; }

/* ---------- editing ---------- */
function changed(keepSel) {
  report = bench.derive(S);
  if (window.PartsUI) PartsUI.refresh();
  if (!keepSel) { /* selection stays valid unless the thing is gone */ }
  if (sel && ((sel.k === 'part' && !bench.partById(sel.id)) || (sel.k === 'wire' && !bench.wireById(sel.id)))) sel = null;
  drawParts(); drawWires(); drawMessages(); drawPalette(); drawSel(); Object.keys(inspInfo).forEach(updateInspector); save();
  if (hooks.onChange) hooks.onChange(report);
}
function select(k, id) {
  sel = k ? { k: k, id: id } : null;
  Object.keys(partObjs).forEach(function (i) { partObjs[i].upd(); });
  Object.keys(wireObjs).forEach(function (i) { wireObjs[i].classList.toggle('sel', !!(sel && sel.k === 'wire' && sel.id === +i)); });
  drawSel();
}
function place(type, col, half) {
  var p = bench.addPart(type, col, half);
  if (!p) { toast(bench.lastError, true); return null; }
  changed(); select('part', p.id); return p;
}
function drawSel() {
  var b = $('benchSel'); if (!b) return;
  if (!sel) { b.className = ''; b.innerHTML = ''; return; }
  if (sel.k === 'wire') {
    var w = bench.wireById(sel.id); if (!w) { b.className = ''; return; }
    b.className = 'on'; b.innerHTML = '<span><b>Wire</b> ' + esc(pinName(w.a)) + ' to ' + esc(pinName(w.b)) + '</span><button class="btn small" data-act="rmwire" type="button">Remove wire</button>';
    return;
  }
  var p = bench.partById(sel.id); if (!p) { b.className = ''; return; }
  b.className = 'on';
  b.innerHTML = '<span><b>' + esc(DEFS[p.type].label) + '</b></span><button class="btn small" data-act="inspect" type="button">Open details</button>' +
    '<button class="btn small" data-act="autowire" type="button" title="Add the jumpers this part is missing, using the pins the examples use">Wire the missing pins</button>' +
    '<button class="btn small" data-act="rmpart" type="button">Remove part</button>';
}
function autoWire(part) {
  var n = bench.autoWire(part, MSP.BENCHPINS[part.type], true);
  changed(); toast(n ? 'Added ' + n + ' wire' + (n === 1 ? '' : 's') + '. Change them if your program uses other pins.' : 'Nothing to add: every pin of this part already has a wire.');
}
function removeSelected() {
  if (!sel) return;
  if (sel.k === 'wire') bench.removeWire(sel.id);
  else { var p = bench.partById(sel.id); if (p) { bench.removePart(sel.id); if (window.Win) Win.close('insp-' + p.type); } }
  sel = null; changed();
}

/* ---------- messages ---------- */
function drawMessages() {
  var box = $('benchMsgs'); if (!box || !report) return;
  var items = [], seen = {};
  report.msgs.forEach(function (m) { items.push({ t: m, c: /^Short circuit/.test(m) ? 'bad' : 'warn' }); seen[m] = 1; });
  if (window.PartsUI) PartsUI.compute().forEach(function (m) { if (!seen[m] && !/^Some pins are not wired/.test(m)) items.push({ t: m, c: 'info' }); });
  bench.parts.forEach(function (p) { var r = report.parts[p.type]; if (r && r.hint) items.push({ t: DEFS[p.type].label + ': ' + r.hint, c: 'info' }); });
  var n = items.length, sum = $('benchMsgsSum'), list = $('benchMsgsList');
  var bad = items.some(function (i) { return i.c === 'bad'; });
  box.className = n ? (bad ? 'bad' : 'warn') : (bench.parts.length ? 'ok' : 'empty');
  sum.textContent = n ? 'Bench check: ' + n + ' issue' + (n === 1 ? '' : 's') : bench.parts.length ? 'Bench check: all wired parts are powered' : 'Bench check: the bench is empty';
  list.innerHTML = items.map(function (i) { return '<li class="' + i.c + '">' + esc(i.t) + '</li>'; }).join('');
}
function fault() { return report && report.shorts.length ? 'short circuit' : ''; }

/* ---------- inspector windows ---------- */
function updateInspector(type) {
  var box = inspInfo[type]; if (!box) return;
  var part = bench.partOf(type), res = report && report.parts[type];
  if (!part) { box.innerHTML = '<p class="warnline on">This part is not on the bench. Drag it from the parts list onto the breadboard.</p>'; return; }
  var h = '<div class="wstat ' + (res && res.on ? 'ok' : 'bad') + '">' + (res && res.on ? 'Powered and wired' : 'Not working yet') + '</div>';
  if (res && res.msgs.length) h += '<ul class="wmsg">' + res.msgs.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
  if (res && res.hint) h += '<p class="note">' + esc(res.hint) + '</p>';
  h += '<table class="kv wtab"><tbody>' + res.pins.map(function (p) {
    return '<tr class="' + (p.to ? '' : 'miss') + '"><th>' + esc(p.n) + '</th><td>' + (p.to ? esc(p.to) : '<span class="dim">not connected</span>') + '</td></tr>';
  }).join('') + '</tbody></table>';
  if (DEFS[type].note) h += '<p class="note">' + esc(DEFS[type].note) + '</p>';
  h += '<div class="parthead"><button class="btn small" data-act="autowire" type="button">Wire the missing pins</button><button class="btn small" data-act="rmpart" type="button">Remove from bench</button></div>';
  box.innerHTML = h;
}
function inspect(type) {
  var id = 'insp-' + type;
  if (!Win.get(id)) {
    var cd = PartsUI.card(type), box = he('div', 'insp'), info = he('div', 'benchwires');
    box.appendChild(info); box.appendChild(cd.el); inspInfo[type] = info;
    var dw = $('desk').clientWidth, n = Object.keys(inspInfo).length;
    info.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var p = bench.partOf(type); if (!p) return;
      if (b.getAttribute('data-act') === 'autowire') autoWire(p); else if (b.getAttribute('data-act') === 'rmpart') { bench.removePart(p.id); if (sel && sel.id === p.id) sel = null; changed(); Win.close(id); }
    });
    Win.create(id, DEFS[type].label, box, { x: Math.max(8, dw - 440 - n * 24), y: 20 + n * 24, w: 420, h: 540 });
  }
  updateInspector(type); Win.open(id);
}

/* ---------- palette ---------- */
function buildPalette(box) {
  var grp = '';
  ORDER.forEach(function (t) {
    var d = DEFS[t];
    if (d.grp !== grp) { grp = d.grp; var hd = he('div', 'pal-grp'); hd.textContent = grp; hd.style.setProperty('--gc', GRPCOL[grp]); box.appendChild(hd); }
    var b = he('button', 'pal-item'); b.type = 'button'; b.setAttribute('data-type', t);
    b.innerHTML = '<span class="pn">' + esc(d.label) + '</span><span class="pm">' + d.pins.length + ' pins' + (d.vcc ? ', ' + d.vcc.map(function (v) { return v === '3V3' ? '3.3 V' : '5 V'; }).join('/') : '') + '</span><span class="pt"></span>';
    b.title = d.pins.map(function (p) { return p.n; }).join('  ');
    b.style.setProperty('--gc', GRPCOL[d.grp]);
    palItems[t] = b; box.appendChild(b); palDrag(b, t);
  });
}
function drawPalette() {
  ORDER.forEach(function (t) {
    var b = palItems[t], on = !!bench.partOf(t);
    b.classList.toggle('used', on); b.classList.toggle('armed', armed === t);
    b.querySelector('.pt').textContent = on ? 'on bench' : armed === t ? 'click the board' : '';
  });
}
var ghost = null;
function palDrag(btn, type) {
  var st = null;
  btn.addEventListener('pointerdown', function (e) {
    if (e.button && e.pointerType === 'mouse') return;
    var ex = bench.partOf(type);
    if (ex) { select('part', ex.id); toast('The ' + DEFS[type].label + ' is already on the bench. Drag it to move it. Only one of each part is supported.'); return; }
    st = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    try { btn.setPointerCapture(e.pointerId); } catch (x) {}
    e.preventDefault();
  });
  btn.addEventListener('pointermove', function (e) {
    if (!st) return;
    if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6) {
      st.moved = true; arm(null); document.body.classList.remove('paldrawer');
      ghost = he('div', 'palghost'); ghost.textContent = DEFS[type].label; document.body.appendChild(ghost);
    }
    if (!st.moved) return;
    ghost.style.left = e.clientX + 12 + 'px'; ghost.style.top = e.clientY + 12 + 'px';
    var r = svg.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      var w = worldPt(e); if (!inBand(w)) { clearPrev(); return; }
      var s = slot(type, w, 0); showPrev(type, s.col, s.half, bench.whyNot(type, s.col, s.half));
    } else clearPrev();
  });
  function end(e) {
    if (!st) return; var s0 = st; st = null;
    if (ghost) { ghost.remove(); ghost = null; }
    clearPrev();
    if (!s0.moved) { arm(armed === type ? null : type); return; }
    var r = svg.getBoundingClientRect();
    if (e.type === 'pointerup' && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      var w = worldPt(e); if (inBand(w)) { var s = slot(type, w, 0); place(type, s.col, s.half); }
    }
  }
  btn.addEventListener('pointerup', end); btn.addEventListener('pointercancel', end);
}
function arm(type) {
  armed = type; svg.classList.toggle('armed', !!type); drawPalette(); clearPrev();
  if (type) { document.body.classList.remove('paldrawer'); toast('Click a spot on the breadboard to place the ' + DEFS[type].label + '. Press Esc to cancel.'); }
}

/* ---------- pointer handling on the canvas ---------- */
function roleOf(t) { while (t && t !== svg) { if (t.getAttribute && t.getAttribute('data-role')) return t; t = t.parentNode; } return null; }
function startWire(ref, ev) { drag = { k: 'wire', from: ref, sx: ev.clientX, sy: ev.clientY, moved: false }; wprev = se('path', { class: 'wprev' }, gOver); }
function endDrag() {
  if (wprev) { wprev.remove(); wprev = null; } if (ring) ring.setAttribute('opacity', 0); clearPrev();
  Object.keys(partObjs).forEach(function (k) { partObjs[k].g.classList.remove('lift'); });
  drag = null;
}
function setPending(ref) {
  pending = ref;
  if (pendMark) { pendMark.remove(); pendMark = null; }
  if (ref) { var p = G.xy(ref); pendMark = se('circle', { class: 'pend', cx: p.x, cy: p.y, r: 9 }, gOver); toast('Wire started at ' + pinName(ref) + '. Click where it should end, or press Esc.'); }
}
function onDown(ev) {
  pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
  if (Object.keys(pointers).length === 2) { endDrag(); var ids = Object.keys(pointers), a = pointers[ids[0]], b = pointers[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
  if (ev.pointerType === 'mouse' && ev.button === 2) return;
  svg.focus({ preventScroll: true });
  var w = worldPt(ev), role = roleOf(ev.target), r = role && role.getAttribute('data-role');
  if (armed) {
    var s = slot(armed, w, 0), type = armed;
    if (!bench.whyNot(type, s.col, s.half)) { armed = null; svg.classList.remove('armed'); place(type, s.col, s.half); } else toast(bench.whyNot(type, s.col, s.half), true);
    return;
  }
  if (r === 'wend') { var wid = +role.getAttribute('data-wid'); select('wire', wid); drag = { k: 'wend', wid: wid, end: role.getAttribute('data-end'), moved: false, sx: ev.clientX, sy: ev.clientY }; wprev = se('path', { class: 'wprev' }, gOver); return; }
  if (r === 'wire') { var hr = G.refAt(w.x, w.y, 6); if (hr && !bench.occupied(hr)) { startWire(hr, ev); return; } select('wire', +role.getAttribute('data-wid')); return; }
  if (r === 'part') {
    var part = bench.partById(+role.getAttribute('data-uid')); select('part', part.id);
    drag = { k: 'part', id: part.id, grab: w.x - G.X(part.col), moved: false, sx: ev.clientX, sy: ev.clientY }; return;
  }
  var ref = G.refAt(w.x, w.y, 9);
  if (ref && !bench.occupied(ref)) { startWire(ref, ev); return; }
  if (pending) setPending(null);
  if (sel) select(null);
  drag = { k: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
}
function onMove(ev) {
  if (pointers[ev.pointerId]) { pointers[ev.pointerId].x = ev.clientX; pointers[ev.pointerId].y = ev.clientY; }
  if (pinch) {
    var ids = Object.keys(pointers); if (ids.length < 2) { pinch = null; return; }
    var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = svg.getBoundingClientRect();
    view.x += mx - pinch.mx; view.y += my - pinch.my; zoomAt(d / pinch.d, mx - r.left, my - r.top); pinch.d = d; pinch.mx = mx; pinch.my = my; return;
  }
  var w = worldPt(ev);
  if (!drag) {
    if (armed) { if (inBand(w)) { var s = slot(armed, w, 0); showPrev(armed, s.col, s.half, bench.whyNot(armed, s.col, s.half)); } else clearPrev(); return; }
    var ref = G.refAt(w.x, w.y, 9), rl = roleOf(ev.target), rr = rl && rl.getAttribute('data-role');
    var ok = ref && !bench.occupied(ref) && (!rr || rr === 'mcu' || rr === 'wire');
    if (ok) { var p = G.xy(ref); ring.setAttribute('cx', p.x); ring.setAttribute('cy', p.y); ring.setAttribute('opacity', 1); } else ring.setAttribute('opacity', 0);
    return;
  }
  if (drag.k === 'pan') { if (!drag.cap) { drag.cap = true; try { svg.setPointerCapture(ev.pointerId); } catch (x) {} } view.x = drag.vx + ev.clientX - drag.sx; view.y = drag.vy + ev.clientY - drag.sy; applyView(); return; }
  if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) > 5) { drag.moved = true; try { svg.setPointerCapture(ev.pointerId); } catch (x) {} }
  if (drag.k === 'part') {
    if (!drag.moved) return;
    var part = bench.partById(drag.id); if (!part) return;
    if (partObjs[part.id]) partObjs[part.id].g.classList.add('lift');
    if (!inBand(w)) { clearPrev(); drag.slot = null; return; }
    var sl = slot(part.type, w, drag.grab), why = bench.whyNot(part.type, sl.col, sl.half, part);
    drag.slot = why ? null : sl; showPrev(part.type, sl.col, sl.half, why); return;
  }
  // wire or wire end
  var fromRef = drag.k === 'wire' ? drag.from : (drag.end === 'a' ? bench.wireById(drag.wid).b : bench.wireById(drag.wid).a);
  var tgt = G.refAt(w.x, w.y, 11), good = tgt && tgt !== fromRef && !bench.occupied(tgt, drag.k === 'wend' ? bench.wireById(drag.wid) : null);
  var end = good ? G.xy(tgt) : w, p0 = G.xy(fromRef);
  var fake = good ? tgt : null;
  wprev.setAttribute('d', good ? wirePath(fromRef, tgt) : 'M' + p0.x + ' ' + p0.y + ' L' + w.x + ' ' + w.y);
  wprev.setAttribute('class', 'wprev' + (good ? ' good' : ''));
  if (good) { ring.setAttribute('cx', end.x); ring.setAttribute('cy', end.y); ring.setAttribute('opacity', 1); } else ring.setAttribute('opacity', 0);
}
function onUp(ev) {
  delete pointers[ev.pointerId]; if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
  if (!drag) return;
  var d = drag, w = worldPt(ev); endDrag();
  if (d.k === 'part') {
    if (!d.moved || !d.slot) { if (d.moved) toast(bench.lastError || 'That spot does not work.', true); return; }
    var p = bench.partById(d.id); if (bench.movePart(d.id, d.slot.col, d.slot.half)) changed(); else toast(bench.lastError, true); return;
  }
  if (d.k === 'wire') {
    var tgt = G.refAt(w.x, w.y, 11);
    if (d.moved) {
      if (tgt && tgt !== d.from) { var wr = bench.addWire(d.from, tgt); if (wr) { changed(); select('wire', wr.id); } else toast(bench.lastError, true); }
      return;
    }
    // a click: start or finish a wire in two clicks
    if (pending) { var a = pending; setPending(null); if (a !== d.from) { var w2 = bench.addWire(a, d.from); if (w2) { changed(); select('wire', w2.id); } else toast(bench.lastError, true); } }
    else setPending(d.from);
    return;
  }
  if (d.k === 'wend') {
    if (!d.moved) return;
    var tg = G.refAt(w.x, w.y, 11), wire = bench.wireById(d.wid);
    if (tg && wire && bench.moveWireEnd(d.wid, d.end, tg)) changed(); else if (wire) { toast(bench.lastError || 'That end cannot go there.', true); drawWires(); }
  }
}
function bindCanvas() {
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; pinch = null; endDrag(); });
  svg.addEventListener('pointerleave', function () { if (ring && !drag) ring.setAttribute('opacity', 0); });
  svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  svg.addEventListener('wheel', function (e) {
    e.preventDefault(); var r = svg.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  svg.addEventListener('dblclick', function (e) {
    var role = roleOf(e.target), r = role && role.getAttribute('data-role');
    if (r === 'part') { var p = bench.partById(+role.getAttribute('data-uid')); if (p) inspect(p.type); }
    else if (r === 'mcu') Win.open('program');
  });
  svg.addEventListener('click', function (e) { var role = roleOf(e.target); if (role && role.getAttribute('data-role') === 'open') Win.open('program'); });
  svg.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.getAttribute && e.target.getAttribute('data-role') === 'open') Win.open('program');
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (typing) return;
    if (e.key === 'Escape') { if (armed) arm(null); if (pending) setPending(null); if (drag) endDrag(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !(t && t.closest && t.closest('.win'))) { e.preventDefault(); removeSelected(); }
  });
  $('benchSel').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !sel) return; var act = b.getAttribute('data-act');
    if (act === 'rmwire' || act === 'rmpart') removeSelected();
    else if (act === 'inspect') { var p = bench.partById(sel.id); if (p) inspect(p.type); }
    else if (act === 'autowire') { var q = bench.partById(sel.id); if (q) autoWire(q); }
  });
  $('zoomIn').addEventListener('click', function () { var r = svg.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); });
  $('zoomOut').addEventListener('click', function () { var r = svg.getBoundingClientRect(); zoomAt(0.8, r.width / 2, r.height / 2); });
  $('zoomFit').addEventListener('click', fit);
  var clr = $('benchClear'), armedClear = 0;
  clr.addEventListener('click', function () {
    if (!armedClear) { armedClear = setTimeout(function () { armedClear = 0; clr.textContent = 'Clear bench'; }, 3000); clr.textContent = 'Click again to clear'; return; }
    clearTimeout(armedClear); armedClear = 0; clr.textContent = 'Clear bench';
    Object.keys(inspInfo).forEach(function (t) { Win.close('insp-' + t); });
    bench.clear(); sel = null; changed();
  });
  window.addEventListener('resize', function () { if (svg.getBoundingClientRect().width) applyView(); });
}

/* ---------- frame ---------- */
function frame(ts) {
  if (!bench) return;
  Object.keys(partObjs).forEach(function (k) { partObjs[k].upd(); });
  mcuLeds.forEach(function (l) {
    var b = S.loaded && S.onboard.leds ? S.brightness(l.L, l.b) : 0;
    at(l.core, 'opacity', b.toFixed(2)); at(l.halo, 'opacity', (b * 0.7).toFixed(2));
  });
  mcuSw.forEach(function (s) { cls(s.cap, 'cap' + (S.inputs[s.L + s.b] === 0 ? ' down' : '')); });
  if (txOn && window.UIState) at(txOn, 'opacity', UIState.txFlash(ts) ? 1 : 0);
  if (ts - lastPin > 120) { lastPin = ts; updatePins(); }
}

/* ---------- save and load ---------- */
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(function () {
    try { store.set('e401y.bench', JSON.stringify({ v: 1, bench: bench.export(), settings: S.partsExport() })); } catch (e) {}
  }, 300);
}
function load() {
  var o = null;
  try { o = JSON.parse(store.get('e401y.bench') || 'null'); } catch (e) { o = null; }
  if (o && o.bench) {
    if (o.settings) S.partsImport(o.settings);
    bench.import(o.bench);
    return true;
  }
  // an older saved wiring (before the bench) is carried over as parts plugged into the board with their old pins wired
  var old = null;
  try { old = JSON.parse(store.get('e401y.wiring2') || 'null'); } catch (e) { old = null; }
  if (old && typeof old === 'object') {
    S.partsImport(old); var any = false;
    ORDER.forEach(function (t) { if (S.partIsOn(t)) { bench.autoPlace(t, MSP.pinMapOf(S, t)); any = true; } });
    bench.onboard.leds = S.onboard.leds; bench.onboard.sw = S.onboard.sw;
    bench.parts.forEach(function (p) { p.auto = false; }); bench.wires.forEach(function (w) { w.auto = false; });
    return any;
  }
  return false;
}

/* ---------- examples ---------- */
// Put the parts an example needs on the bench, wired the way its code expects. Parts and wires made for an earlier example go away.
function useExample(needs) {
  if (!bench) return;
  needs = needs || [];
  var want = needs.filter(function (n) { return DEFS[n]; });
  bench.parts.filter(function (p) { return p.auto && want.indexOf(p.type) < 0; }).forEach(function (p) { Win.close('insp-' + p.type); });
  bench.dropAuto();
  // wires made for parts that are gone have been dropped above; keep the ones the student made
  var made = [];
  want.forEach(function (t) { if (!bench.partOf(t)) { if (bench.autoPlace(t)) made.push(t); else toast('There is no room on the bench for the ' + DEFS[t].label + '.', true); } else { var p = bench.partOf(t); bench.autoWire(p, MSP.BENCHPINS[t], true); } });
  if (needs.indexOf('leds') >= 0) bench.onboard.leds = true;
  if (needs.indexOf('sw') >= 0) bench.onboard.sw = true;
  S.partOn('leds', bench.onboard.leds); S.partOn('sw', bench.onboard.sw);
  changed();
  return made;
}

/* ---------- init ---------- */
function init(sim, st, opts) {
  S = sim; store = st; hooks = opts || {};
  bench = new MSP.Bench();
  svg = $('bench'); world = se('g', { id: 'world' }, svg);
  var defs = se('defs', null, svg); var f = se('filter', { id: 'bGlow', x: '-150%', y: '-150%', width: '400%', height: '400%' }, defs); se('feGaussianBlur', { stdDeviation: 5 }, f);
  svg.insertBefore(defs, world);
  gBoard = se('g', null, world); gParts = se('g', null, world); gMcu = se('g', null, world); gWires = se('g', null, world); gOver = se('g', null, world);
  buildBoard(); buildMcu();
  ring = se('circle', { class: 'hring', r: 8, opacity: 0, cx: 0, cy: 0 }, gOver);
  buildPalette($('palList'));
  bindCanvas();
  var had = load();
  bench.onboard.leds = S.onboard.leds = bench.onboard.leds; bench.onboard.sw = S.onboard.sw = bench.onboard.sw;
  S.partOn('leds', bench.onboard.leds); S.partOn('sw', bench.onboard.sw);
  report = bench.reapply(S);
  if (window.PartsUI) PartsUI.refresh();
  drawParts(); drawWires(); drawMessages(); drawPalette(); drawSel();
  requestAnimationFrame(function () { fit(); });
  if (window.ResizeObserver) new ResizeObserver(function () { if (!view.manual) fit(); }).observe($('desk'));
  return had;
}
// Called when a settings control on a part card changed something the bench must save.
function settingsChanged() { if (!bench) return; bench.onboard.leds = S.onboard.leds; bench.onboard.sw = S.onboard.sw; drawMessages(); save(); }

function screen(ref) { var p = G.xy(ref), r = svg.getBoundingClientRect(); return { x: r.left + view.x + p.x * view.k, y: r.top + view.y + p.y * view.k }; }
return { refresh: function () { changed(); }, screen: screen, sim: function () { return S; }, init: init, frame: frame, useExample: useExample, fault: fault, inspect: inspect, settingsChanged: settingsChanged, fit: fit,
  bench: function () { return bench; }, report: function () { return report; }, toast: toast };
})();
