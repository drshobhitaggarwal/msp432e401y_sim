/* Bench model (no DOM): a real solderless breadboard, the LaunchPad's header pins, parts plugged into the board and jumper wires.
   The circuit is a netlist: every breadboard column strip, power rail and header pin is a node, wires join nodes, and the nets that
   result decide which microcontroller pin each part pin reaches and whether each part has power. derive() writes that into the
   simulator (S.mods, S.keypad, S.relay), so the parts model underneath is unchanged. */
(function (M) {
'use strict';

/* ---------- geometry (world units, shared with the drawing code) ---------- */
var G = M.BENCH = { PITCH: 20, COLS: 60, RAILN: 50, BX: 30, BW: 1280, BY: 400, BH: 356, MCU_H: 170 };
G.X = function (c) { return 80 + (c - 1) * 20; };
var ROWY = { j: 74, i: 94, h: 114, g: 134, f: 154, e: 198, d: 218, c: 238, b: 258, a: 278 };
var RAILY = { 'T+': 16, 'T-': 36, 'B+': 316, 'B-': 336 };
G.ROWS = ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
G.RAILS = ['T+', 'T-', 'B+', 'B-'];
G.PINROW = { U: 'j', L: 'a' };                       // parts plug into the outer row of their half
G.FREE = { U: ['f', 'g', 'h', 'i'], L: ['e', 'd', 'c', 'b'] };   // free holes, nearest the trench first
G.rowOf = function (half) { return G.PINROW[half]; };
G.halfOf = function (row) { return 'abcde'.indexOf(row) >= 0 ? 'L' : 'U'; };
G.railX = function (k) { return G.X(1) + (k + Math.floor(k / 5)) * 20; };
G.railY = function (rail) { return G.BY + RAILY[rail]; };
G.rowY = function (row) { return G.BY + ROWY[row]; };

var OUT_ROW = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], IN_ROW = ['J', 'K', 'L', 'M', 'N', 'P', 'Q'];
var SUPPLY = [['3V3', 0], ['3V3', 1], ['5V', 0], ['5V', 1], ['GND', 0], ['GND', 1], ['GND', 2]];
var MCUXY = {}, MCUPINS = [];
(function () {
  var y1 = G.MCU_H - 24, y2 = G.MCU_H - 48, i, p;
  SUPPLY.forEach(function (s, k) { MCUXY['m:' + s[0] + '.' + s[1]] = { x: 54 + k * 16, y: y1, sup: s[0] }; });
  OUT_ROW.forEach(function (L, pi) { for (i = 0; i < 8; i++) { MCUXY['m:' + L + i] = { x: 178 + pi * 140 + i * 16, y: y1, port: L, bit: i }; } });
  IN_ROW.forEach(function (L, pi) { for (i = 0; i < 8; i++) { MCUXY['m:' + L + i] = { x: 178 + pi * 140 + i * 16, y: y2, port: L, bit: i }; } });
  for (p in MCUXY) MCUPINS.push(p);
})();
G.MCUPINS = MCUPINS;
G.mcuXY = function (ref) { return MCUXY[ref] || null; };
G.GROUPS = { out: OUT_ROW, inn: IN_ROW, supply: SUPPLY };

/* ---------- references ---------- */
// h:<col><row> breadboard hole, r:<rail>:<k> power rail hole, m:<port><bit> or m:<supply>.<n> header pin.
function parseRef(ref) {
  if (typeof ref !== 'string') return null;
  var m = /^h:(\d{1,2})([a-j])$/.exec(ref);
  if (m) { var c = +m[1]; if (c < 1 || c > G.COLS) return null; return { k: 'h', col: c, row: m[2], half: G.halfOf(m[2]) }; }
  m = /^r:(T\+|T-|B\+|B-):(\d{1,2})$/.exec(ref);
  if (m) { var i = +m[2]; if (i < 0 || i >= G.RAILN) return null; return { k: 'r', rail: m[1], idx: i }; }
  if (MCUXY[ref]) return { k: 'm', pin: ref.slice(2), sup: MCUXY[ref].sup || null };
  return null;
}
function nodeOf(ref) {
  var r = parseRef(ref); if (!r) return null;
  if (r.k === 'h') return r.half + r.col;
  if (r.k === 'r') return r.rail;
  return r.sup ? r.sup : ref;
}
G.parseRef = parseRef; G.nodeOf = nodeOf;
G.xy = function (ref) {
  var r = parseRef(ref); if (!r) return null;
  if (r.k === 'h') return { x: G.X(r.col), y: G.rowY(r.row) };
  if (r.k === 'r') return { x: G.railX(r.idx), y: G.railY(r.rail) };
  var p = MCUXY[ref]; return { x: p.x, y: p.y };
};
G.holeRef = function (col, row) { return 'h:' + col + row; };
// Nearest target (breadboard hole, rail hole or header pin) to a world point, or null.
G.refAt = function (x, y, tol) {
  tol = tol || 9;
  var best = null, bd = tol * tol, k, d, p;
  if (y >= G.BY - 4 && y <= G.BY + G.BH + 4) {
    var col = Math.round((x - 80) / 20) + 1;
    for (var c = col - 1; c <= col + 1; c++) {
      if (c < 1 || c > G.COLS) continue;
      for (var ri = 0; ri < 10; ri++) { var row = G.ROWS[ri]; d = Math.pow(G.X(c) - x, 2) + Math.pow(G.rowY(row) - y, 2); if (d < bd) { bd = d; best = G.holeRef(c, row); } }
    }
    G.RAILS.forEach(function (rl) {
      var ry = G.railY(rl); if (Math.abs(ry - y) > tol) return;
      var kk = Math.round((x - G.X(1)) / 20); // approximate, then refine across the group gap
      for (var q = 0; q < G.RAILN; q++) { var dx = G.railX(q) - x; if (Math.abs(dx) > tol) continue; d = dx * dx + Math.pow(ry - y, 2); if (d < bd) { bd = d; best = 'r:' + rl + ':' + q; } }
    });
  }
  if (y < G.MCU_H + 6) for (k = 0; k < MCUPINS.length; k++) { p = MCUXY[MCUPINS[k]]; d = Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2); if (d < bd) { bd = d; best = MCUPINS[k]; } }
  return best;
};

/* ---------- part catalogue ---------- */
// pins: n = pin name, r = role (sig, vcc, gnd, com). vcc: supplies it accepts. bus: pins that must reach a fixed MCU pin.
function P(n, r) { return { n: n, r: r || 'sig' }; }
function seq(p, n, from) { var o = []; for (var i = 0; i < n; i++) o.push(P(p + (i + (from === undefined ? 1 : from)))); return o; }
var ANY = ['3V3', '5V'];
var DEFS = M.PARTDEFS = {
  keypad:     { label: '4x4 keypad', grp: 'Input', bodyW: 160, bodyH: 150, pref: 'any',
    pins: seq('R', 4).concat(seq('C', 4)), note: 'A matrix with no power. A pressed key joins its row to its column.' },
  btns:       { label: 'Push buttons (4)', grp: 'Input', bodyW: 120, bodyH: 70, pref: 'any', com: 'COM',
    pins: [P('COM', 'com')].concat(seq('B', 4)), comHelp: 'COM to GND makes a pressed button pull its pin low; COM to 3V3 makes it pull the pin high.' },
  dip:        { label: 'DIP switches (4)', grp: 'Input', bodyW: 120, bodyH: 90, pref: 'any', com: 'COM',
    pins: [P('COM', 'com')].concat(seq('S', 4)), comHelp: 'COM to GND makes a closed switch pull its pin low; COM to 3V3 makes it pull the pin high.' },
  ledbar:     { label: 'LED bar (8 LEDs)', grp: 'Output', bodyW: 180, bodyH: 70, pref: 'any', com: 'COM',
    pins: [P('COM', 'com')].concat(seq('L', 8)), comHelp: 'COM to GND: an LED lights when its pin is high. COM to 3V3: an LED lights when its pin is low.' },
  rgb:        { label: 'RGB LED', grp: 'Output', bodyW: 100, bodyH: 100, pref: 'any', com: 'COM',
    pins: [P('COM', 'com'), P('R'), P('G'), P('B')], comHelp: 'COM to GND is a common-cathode LED (high lights a color). COM to 3V3 is common-anode (low lights a color).' },
  seg:        { label: '7-segment display', grp: 'Output', bodyW: 180, bodyH: 130, pref: 'any', com: 'COM',
    pins: [P('COM', 'com'), P('a'), P('b'), P('c'), P('d'), P('e'), P('f'), P('g'), P('dp')], comHelp: 'COM to GND is common-cathode (high lights a segment). COM to 3V3 is common-anode (low lights a segment).' },
  buzzer:     { label: 'Buzzer', grp: 'Output', bodyW: 100, bodyH: 70, pref: 'any', vcc: ANY, vccName: 'VCC',
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('SIG')] },
  relay:      { label: 'Relay module', grp: 'Output', bodyW: 150, bodyH: 110, pref: 'L', vcc: ['5V'],
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('IN')] },
  motor:      { label: 'DC motor + H-bridge', grp: 'Output', bodyW: 150, bodyH: 110, pref: 'L', vcc: ['5V'],
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('IN1'), P('IN2'), P('EN')], note: 'EN left unwired keeps the bridge enabled, like the jumper on a real module.' },
  servo:      { label: 'Servo', grp: 'Output', bodyW: 120, bodyH: 100, pref: 'L', vcc: ['5V'],
    pins: [P('GND', 'gnd'), P('VCC', 'vcc'), P('SIG')] },
  stepper:    { label: 'Stepper motor', grp: 'Output', bodyW: 140, bodyH: 120, pref: 'L', vcc: ['5V'],
    pins: [P('VCC', 'vcc'), P('GND', 'gnd')].concat(seq('IN', 4)) },
  i2c_tmp:    { label: 'Temperature sensor (TMP102)', grp: 'I2C0 devices', bodyW: 100, bodyH: 70, pref: 'U', vcc: ['3V3'], bus: { SCL: 'B2', SDA: 'B3' },
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('SCL', 'bus'), P('SDA', 'bus')] },
  i2c_eeprom: { label: 'EEPROM 24C02 (256 B)', grp: 'I2C0 devices', bodyW: 100, bodyH: 70, pref: 'U', vcc: ANY, bus: { SCL: 'B2', SDA: 'B3' },
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('SCL', 'bus'), P('SDA', 'bus')] },
  i2c_lcd:    { label: 'LCD 16x2 + PCF8574', grp: 'I2C0 devices', bodyW: 180, bodyH: 100, pref: 'L', vcc: ['5V'], bus: { SCL: 'B2', SDA: 'B3' },
    pins: [P('GND', 'gnd'), P('VCC', 'vcc'), P('SDA', 'bus'), P('SCL', 'bus')] },
  i2c_oled:   { label: 'OLED 128x64 (SSD1306)', grp: 'I2C0 devices', bodyW: 160, bodyH: 110, pref: 'U', vcc: ANY, bus: { SCL: 'B2', SDA: 'B3' },
    pins: [P('GND', 'gnd'), P('VCC', 'vcc'), P('SCL', 'bus'), P('SDA', 'bus')] },
  spi_eeprom: { label: 'EEPROM 25LC256 (32 KB)', grp: 'SSI0 devices', bodyW: 120, bodyH: 70, pref: 'U', vcc: ANY, bus: { SCK: 'A2', MOSI: 'A4', MISO: 'A5' },
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('CS'), P('SCK', 'bus'), P('MOSI', 'bus'), P('MISO', 'bus')] },
  spi_595:    { label: '74HC595 + 8 LEDs', grp: 'SSI0 devices', bodyW: 180, bodyH: 80, pref: 'U', vcc: ANY, bus: { SCK: 'A2', MOSI: 'A4' },
    pins: [P('VCC', 'vcc'), P('GND', 'gnd'), P('CS'), P('SCK', 'bus'), P('MOSI', 'bus')] }
};
var ORDER = M.PARTORDER = ['keypad', 'btns', 'dip', 'ledbar', 'rgb', 'seg', 'buzzer', 'relay', 'motor', 'servo', 'stepper', 'i2c_tmp', 'i2c_eeprom', 'i2c_lcd', 'i2c_oled', 'spi_eeprom', 'spi_595'];
ORDER.forEach(function (t) { var d = DEFS[t]; d.id = t; d.reserve = Math.max(d.pins.length, Math.ceil(d.bodyW / 20)); });
var PINLABEL = { B2: 'I2C0 SCL', B3: 'I2C0 SDA', A2: 'SSI0 CLK', A4: 'SSI0 MOSI', A5: 'SSI0 MISO' };
var SUPNAME = { '3V3': '3V3', '5V': '5 V', GND: 'GND' };
function volts(s) { return s === '3V3' ? '3.3 V' : s === '5V' ? '5 V' : s; }

/* default pins used when a part is placed for an example (the pins the example programs expect) */
var DEFPIN = M.BENCHPINS = {
  keypad: { R1: 'K0', R2: 'K1', R3: 'K2', R4: 'K3', C1: 'L0', C2: 'L1', C3: 'L2', C4: 'L3' },
  relay: { IN: 'M0' },
  ledbar: { L1: 'D0', L2: 'D1', L3: 'D2', L4: 'D3', L5: 'D4', L6: 'D5', L7: 'D6', L8: 'D7' },
  rgb: { R: 'F1', G: 'F2', B: 'F3' },
  seg: { a: 'C0', b: 'C1', c: 'C2', d: 'C3', e: 'C4', f: 'C5', g: 'C6', dp: 'C7' },
  buzzer: { SIG: 'G0' }, motor: { IN1: 'H0', IN2: 'H1', EN: 'G1' }, servo: { SIG: 'K4' },
  stepper: { IN1: 'P0', IN2: 'P1', IN3: 'P2', IN4: 'P3' },
  dip: { S1: 'Q0', S2: 'Q1', S3: 'Q2', S4: 'Q3' }, btns: { B1: 'B0', B2: 'B1', B3: 'B2', B4: 'B3' },
  i2c_tmp: { SCL: 'B2', SDA: 'B3' }, i2c_eeprom: { SCL: 'B2', SDA: 'B3' }, i2c_lcd: { SCL: 'B2', SDA: 'B3' }, i2c_oled: { SCL: 'B2', SDA: 'B3' },
  spi_eeprom: { CS: 'P4', SCK: 'A2', MOSI: 'A4', MISO: 'A5' }, spi_595: { CS: 'P5', SCK: 'A2', MOSI: 'A4' }
};

/* ---------- how a part's nets become simulator settings ---------- */
function bits(S, a) { return a; }
var APPLY = {
  keypad: function (S, c) {
    var k = S.keypad, old = S.kpPorts(), i;
    for (i = 0; i < 4; i++) { k.rows[i] = c.pin('R' + (i + 1)); k.cols[i] = c.pin('C' + (i + 1)); }
    S.setKeypadOn(c.on);
    old.forEach(function (L) { S.gpioUpdate(L); });
  },
  relay: function (S, c) { S.setRelay({ pin: c.pin('IN'), on: c.on }); },
  ledbar: function (S, c) { var m = S.mods.ledbar; for (var i = 0; i < 8; i++) m.pins[i] = c.pin('L' + (i + 1)); m.low = c.sup('COM') !== 'GND'; },
  rgb: function (S, c) { var m = S.mods.rgb; m.pins[0] = c.pin('R'); m.pins[1] = c.pin('G'); m.pins[2] = c.pin('B'); m.anode = c.sup('COM') !== 'GND'; },
  seg: function (S, c) { var m = S.mods.seg; ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].forEach(function (n, i) { m.pins[i] = c.pin(n); }); m.anode = c.sup('COM') !== 'GND'; },
  buzzer: function (S, c) { S.mods.buzzer.pin = c.pin('SIG'); },
  motor: function (S, c) { var m = S.mods.motor; m.in1 = c.pin('IN1'); m.in2 = c.pin('IN2'); m.en = c.pin('EN'); },
  servo: function (S, c) { S.mods.servo.pin = c.pin('SIG'); },
  stepper: function (S, c) { for (var i = 0; i < 4; i++) S.mods.stepper.pins[i] = c.pin('IN' + (i + 1)); },
  dip: function (S, c) { var m = S.mods.dip; for (var i = 0; i < 4; i++) m.pins[i] = c.pin('S' + (i + 1)); m.vcc = c.sup('COM') !== 'GND'; },
  btns: function (S, c) { var m = S.mods.btns; for (var i = 0; i < 4; i++) m.pins[i] = c.pin('B' + (i + 1)); m.vcc = c.sup('COM') !== 'GND'; },
  i2c_tmp: function () {}, i2c_eeprom: function () {}, i2c_lcd: function () {}, i2c_oled: function () {},
  spi_eeprom: function (S, c) { S.mods.spi_eeprom.cs = c.pin('CS'); },
  spi_595: function (S, c) { S.mods.spi_595.cs = c.pin('CS'); }
};

// The pin map a simulator configuration currently holds for a part (used to carry older saved wiring over to the bench).
M.pinMapOf = function (S, t) {
  var m = S.mods, o = {}, i;
  function arr(prefix, a, from) { for (var k = 0; k < a.length; k++) if (a[k]) o[prefix + (k + (from === undefined ? 1 : from))] = a[k]; }
  if (t === 'keypad') { arr('R', S.keypad.rows); arr('C', S.keypad.cols); }
  else if (t === 'relay') { if (S.relay.pin) o.IN = S.relay.pin; }
  else if (t === 'ledbar') arr('L', m.ledbar.pins);
  else if (t === 'rgb') { ['R', 'G', 'B'].forEach(function (n, k) { if (m.rgb.pins[k]) o[n] = m.rgb.pins[k]; }); }
  else if (t === 'seg') { ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].forEach(function (n, k) { if (m.seg.pins[k]) o[n] = m.seg.pins[k]; }); }
  else if (t === 'buzzer') { if (m.buzzer.pin) o.SIG = m.buzzer.pin; }
  else if (t === 'motor') { if (m.motor.in1) o.IN1 = m.motor.in1; if (m.motor.in2) o.IN2 = m.motor.in2; if (m.motor.en) o.EN = m.motor.en; }
  else if (t === 'servo') { if (m.servo.pin) o.SIG = m.servo.pin; }
  else if (t === 'stepper') arr('IN', m.stepper.pins);
  else if (t === 'dip') arr('S', m.dip.pins);
  else if (t === 'btns') arr('B', m.btns.pins);
  else if (t === 'spi_eeprom' || t === 'spi_595') { var d = {}; Object.keys(M.BENCHPINS[t]).forEach(function (k) { d[k] = M.BENCHPINS[t][k]; }); if (m[t].cs) d.CS = m[t].cs; return d; }
  else return null;
  return o;
};

/* ---------- the bench ---------- */
function Bench() { this.parts = []; this.wires = []; this.seq = 1; this.applied = {}; this.last = null; this.onboard = { leds: true, sw: true }; }
M.Bench = Bench;
var B = Bench.prototype;
Bench.G = G;

B.partOf = function (type) { for (var i = 0; i < this.parts.length; i++) if (this.parts[i].type === type) return this.parts[i]; return null; };
B.partById = function (id) { for (var i = 0; i < this.parts.length; i++) if (this.parts[i].id === id) return this.parts[i]; return null; };
B.wireById = function (id) { for (var i = 0; i < this.wires.length; i++) if (this.wires[i].id === id) return this.wires[i]; return null; };
B.pinRef = function (part, k) { return G.holeRef(part.col + k, G.PINROW[part.half]); };
// Where each pin of a part sits.
B.pinRefs = function (part) { var s = this; return DEFS[part.type].pins.map(function (p, k) { return s.pinRef(part, k); }); };

// Why a part cannot go at (col, half), or '' when it fits. skip = a part being moved.
B.whyNot = function (type, col, half, skip) {
  var d = DEFS[type]; if (!d) return 'Unknown part.';
  if (half !== 'U' && half !== 'L') return 'Pick the upper or lower half of the board.';
  if (!(col >= 1) || col + d.pins.length - 1 > G.COLS || col !== Math.floor(col)) return 'The part does not fit on the board there.';
  var other = this.partOf(type); if (other && other !== skip) return 'Only one ' + d.label + ' is supported on the bench.';
  var end = col + d.reserve - 1;
  for (var i = 0; i < this.parts.length; i++) {
    var q = this.parts[i]; if (q === skip || q.half !== half) continue;
    var qe = q.col + DEFS[q.type].reserve - 1;
    if (!(end < q.col || col > qe)) return 'That spot is taken by the ' + DEFS[q.type].label + '.';
  }
  var row = G.PINROW[half], me = this;
  for (var k = 0; k < d.pins.length; k++) {
    var ref = G.holeRef(col + k, row);
    for (var w = 0; w < this.wires.length; w++) if (this.wires[w].a === ref || this.wires[w].b === ref) return 'A wire is plugged into that hole.';
  }
  return '';
};
B.addPart = function (type, col, half, auto) {
  var why = this.whyNot(type, col, half); if (why) { this.lastError = why; return null; }
  var p = { id: this.seq++, type: type, col: col, half: half, auto: !!auto }; this.parts.push(p); this.lastError = ''; return p;
};
B.movePart = function (id, col, half) {
  var p = this.partById(id); if (!p) return false;
  var why = this.whyNot(p.type, col, half, p); if (why) { this.lastError = why; return false; }
  p.col = col; p.half = half; p.auto = false; this.lastError = ''; return true;
};
B.removePart = function (id) { var n = this.parts.length; this.parts = this.parts.filter(function (p) { return p.id !== id; }); return this.parts.length < n; };

// A hole holds one wire end or one part pin. Header pins and supply pins take any number of wires.
B.occupied = function (ref, skipWire) {
  var r = parseRef(ref); if (!r) return true;
  if (r.k === 'h') {
    for (var i = 0; i < this.parts.length; i++) {
      var p = this.parts[i];
      if (G.PINROW[p.half] === r.row && r.col >= p.col && r.col < p.col + DEFS[p.type].pins.length) return true;
    }
  }
  if (r.k === 'm') return false;
  for (var w = 0; w < this.wires.length; w++) { var x = this.wires[w]; if (x !== skipWire && (x.a === ref || x.b === ref)) return true; }
  return false;
};
var WIRECOL = ['#2F6FDE', '#1E9E6A', '#E0A100', '#8A4FD1', '#E8E8E8', '#B5651D', '#E8772E', '#14A3B8'];
B.autoColor = function (a, b) {
  var na = nodeOf(a), nb = nodeOf(b), n = [na, nb];
  if (n.indexOf('GND') >= 0 || n.indexOf('T-') >= 0 || n.indexOf('B-') >= 0) return '#202428';
  if (n.indexOf('5V') >= 0) return '#E8772E';
  if (n.indexOf('3V3') >= 0 || n.indexOf('T+') >= 0 || n.indexOf('B+') >= 0) return '#D6342C';
  return WIRECOL[(this.seq++) % WIRECOL.length];
};
B.addWire = function (a, b, color, auto) {
  if (!parseRef(a) || !parseRef(b)) { this.lastError = 'A wire needs two valid ends.'; return null; }
  if (a === b) { this.lastError = 'A wire cannot start and end in the same hole.'; return null; }
  if (this.occupied(a)) { this.lastError = 'That hole is already in use.'; return null; }
  if (this.occupied(b)) { this.lastError = 'That hole is already in use.'; return null; }
  if (nodeOf(a) === nodeOf(b)) { this.lastError = 'Both ends are already joined (same column strip or rail).'; return null; }
  var w = { id: this.seq++, a: a, b: b, color: color || this.autoColor(a, b), auto: !!auto }; this.wires.push(w); this.lastError = ''; return w;
};
B.moveWireEnd = function (id, end, ref) {
  var w = this.wireById(id); if (!w || !parseRef(ref)) return false;
  var o = end === 'a' ? w.b : w.a;
  if (ref === o || this.occupied(ref, w) || nodeOf(ref) === nodeOf(o)) { this.lastError = 'That end cannot go there.'; return false; }
  w[end] = ref; w.auto = false; this.lastError = ''; return true;
};
B.removeWire = function (id) { var n = this.wires.length; this.wires = this.wires.filter(function (w) { return w.id !== id; }); return this.wires.length < n; };
B.clear = function () { this.parts = []; this.wires = []; this.applied = {}; };

/* ---------- nets ---------- */
B.nets = function () {
  var par = {};
  function find(x) { if (par[x] === undefined) par[x] = x; while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }
  this.wires.forEach(function (w) { var a = find(nodeOf(w.a)), b = find(nodeOf(w.b)); if (a !== b) par[a] = b; });
  var info = {};
  function add(node) {
    var root = find(node), it = info[root] || (info[root] = { sup: [], mcu: [] });
    if (node === 'GND' || node === '3V3' || node === '5V') { if (it.sup.indexOf(node) < 0) it.sup.push(node); }
    else if (node.slice(0, 2) === 'm:') { var pin = node.slice(2); if (it.mcu.indexOf(pin) < 0) it.mcu.push(pin); }
  }
  ['GND', '3V3', '5V'].forEach(add);
  this.wires.forEach(function (w) { add(nodeOf(w.a)); add(nodeOf(w.b)); });
  return { of: function (node) { var it = info[find(node)]; return it || { sup: [], mcu: [] }; }, find: find, info: info };
};

/* ---------- check the circuit and write it into the simulator ---------- */
B.derive = function (S, force) {
  var net = this.nets(), self = this, msgs = [], report = { parts: {}, msgs: msgs, shorts: [], contention: [] }, seenShort = {};
  Object.keys(net.info).forEach(function (r) {
    var it = net.info[r];
    if (it.sup.length > 1) { var t = it.sup.join(' and '); if (!seenShort[t]) { seenShort[t] = 1; report.shorts.push(t); msgs.push('Short circuit: ' + it.sup.map(function (s) { return SUPNAME[s]; }).join(' and ') + ' are joined by your wiring. Remove the wire that connects them.'); } }
    if (it.mcu.length > 1) { report.contention.push(it.mcu.slice()); msgs.push('Header pins ' + it.mcu.map(function (p) { return 'P' + p; }).join(' and ') + ' are wired together. If both are outputs they fight each other.'); }
  });
  ORDER.forEach(function (type) {
    var d = DEFS[type], part = self.partOf(type), res = { type: type, placed: !!part, on: false, msgs: [], pins: [] };
    report.parts[type] = res;
    if (!part) { self._apply(S, type, null, { on: false, pin: function () { return ''; }, sup: function () { return ''; } }, force); return; }
    var pinNet = {};
    d.pins.forEach(function (p, k) { pinNet[p.n] = net.of(nodeOf(self.pinRef(part, k))); });
    function pin(n) { var it = pinNet[n]; return it && it.mcu.length ? it.mcu[0] : ''; }
    function sup(n) { var it = pinNet[n]; return it && it.sup.length === 1 ? it.sup[0] : ''; }
    var block = [];
    d.pins.forEach(function (p) {
      var it = pinNet[p.n], s = it.sup, to;
      if (s.length) to = s.map(function (x) { return SUPNAME[x]; }).join(' + ');
      else if (it.mcu.length) to = it.mcu.map(function (x) { return 'P' + x; }).join(', ');
      else to = '';
      res.pins.push({ n: p.n, r: p.r, to: to });
      if (p.r === 'vcc') {
        if (s.length > 1) block.push('VCC touches both ' + s.join(' and ') + '.');
        else if (!s.length) block.push('VCC is not connected to power. Wire it to ' + d.vcc.map(volts).join(' or ') + '.');
        else if (s[0] === 'GND') block.push('VCC is wired to GND.');
        else if (d.vcc.indexOf(s[0]) < 0) block.push('VCC is on ' + volts(s[0]) + ' but this part needs ' + d.vcc.map(volts).join(' or ') + '.');
      } else if (p.r === 'gnd') {
        if (!s.length) block.push('GND is not connected. Wire it to a GND pin.');
        else if (s.length > 1 || s[0] !== 'GND') block.push('GND is wired to ' + s.map(volts).join(' and ') + ', not to ground.');
      } else if (p.r === 'com') {
        if (!s.length) block.push('COM is not connected. ' + d.comHelp);
        else if (s.length > 1) block.push('COM touches both ' + s.join(' and ') + '.');
      }
    });
    if (d.bus) Object.keys(d.bus).forEach(function (n) {
      var need = d.bus[n], it = pinNet[n];
      if (it.mcu.indexOf(need) >= 0) return;
      block.push(it.mcu.length ? n + ' goes to P' + it.mcu[0] + ', but ' + PINLABEL[need] + ' is P' + need + '.' : n + ' is not connected. Wire it to P' + need + ' (' + PINLABEL[need] + ').');
    });
    res.on = block.length === 0; res.msgs = block;
    block.forEach(function (m) { msgs.push(d.label + ': ' + m); });
    if (type === 'spi_eeprom' || type === 'spi_595') { if (!pin('CS')) res.hint = 'CS is not connected. Wire it to PA3 (hardware frame select) or any GPIO pin you use as chip select.'; }
    self._apply(S, type, part, { on: res.on, pin: pin, sup: sup }, force);
  });
  this.last = report; return report;
};
B._apply = function (S, type, part, c, force) {
  if (!S || !S.mods) return;
  var cfg = { on: c.on };
  var d = DEFS[type];
  d.pins.forEach(function (p) { cfg[p.n] = p.r === 'sig' || p.r === 'bus' ? c.pin(p.n) : c.sup(p.n); });
  var sig = JSON.stringify(cfg);
  if (!force && this.applied[type] === sig) return;
  this.applied[type] = sig;
  if (part || S.partIsOn(type)) APPLY[type](S, c);
  if (type === 'keypad') return;                       // setKeypadOn is part of APPLY
  if (type === 'relay') return;                        // setRelay is part of APPLY
  if (S.partIsOn(type) !== c.on) S.partOn(type, c.on);
  if (type === 'dip' || type === 'btns') S.syncInputs();
};
// Called after the simulator's settings were replaced (import, reset of the parts model).
B.reapply = function (S) { this.applied = {}; return this.derive(S, true); };

/* ---------- placing parts for an example ---------- */
B.freeSpan = function (type, half) {
  var d = DEFS[type];
  for (var c = 1; c + d.pins.length - 1 <= G.COLS; c++) if (!this.whyNot(type, c, half)) return c;
  return 0;
};
B._hole = function (part, pinName, mode) {
  var d = DEFS[part.type], k = d.pins.map(function (p) { return p.n; }).indexOf(pinName), col = part.col + k, list = G.FREE[part.half].slice();
  if (mode === 'far') list.reverse();
  for (var i = 0; i < list.length; i++) { var ref = G.holeRef(col, list[i]); if (!this.occupied(ref)) return ref; }
  return null;
};
B._railHole = function (rail, nearX) {
  var best = null, bd = 1e9;
  for (var k = 0; k < G.RAILN; k++) { var ref = 'r:' + rail + ':' + k; if (this.occupied(ref)) continue; var d = Math.abs(G.railX(k) - nearX); if (d < bd) { bd = d; best = ref; } }
  return best;
};
B._supplyPin = function (sup) { return sup === 'GND' ? 'm:GND.1' : 'm:' + sup + '.1'; };
// Wire the rail to its supply pin once.
B._feedRail = function (rail) {
  var ref = { 'T+': 'm:3V3.0', 'T-': 'm:GND.0', 'B+': 'm:5V.0', 'B-': 'm:GND.2' }[rail];
  for (var i = 0; i < this.wires.length; i++) { var w = this.wires[i]; if (nodeOf(w.a) === rail && w.b === ref || nodeOf(w.b) === rail && w.a === ref) return true; }
  var free = this._railHole(rail, G.railX(0)); if (!free) return false;
  return !!this.addWire(free, ref, undefined, true);
};
// Place a part and wire it the way the example programs expect (signal pins to their default header pins, power to rails).
B.autoPlace = function (type, pinMap) {
  var d = DEFS[type]; if (!d) return null;
  if (this.partOf(type)) return this.partOf(type);
  var half = null, col = 0, order = ['L', 'U'], i;
  for (i = 0; i < order.length && !col; i++) { col = this.freeSpan(type, order[i]); if (col) half = order[i]; }
  if (!col) return null;
  var part = this.addPart(type, col, half, true); if (!part) return null;
  this.autoWire(part, pinMap, false);
  return part;
};
// Add the jumpers a part is missing: signal pins to the pins the example programs use (or pinMap), power to the nearest rail or supply pin.
B.autoWire = function (part, pinMap, onlyMissing) {
  var d = DEFS[part.type], map = pinMap || DEFPIN[part.type] || {}, self = this, net = this.nets(), n = 0;
  d.pins.forEach(function (p, k) {
    var near = G.X(part.col + k), hole, it = net.of(nodeOf(self.pinRef(part, k)));
    if (p.r === 'sig' || p.r === 'bus') {
      var want = map[p.n]; if (!want || (onlyMissing && it.mcu.length)) return;
      hole = self._hole(part, p.n, 'near'); if (hole && self.addWire(hole, 'm:' + want, undefined, true)) n++;
      return;
    }
    if (onlyMissing && it.sup.length) return;
    var sup = p.r === 'vcc' ? (part.half === 'U' && d.vcc.indexOf('3V3') >= 0 ? '3V3' : part.half === 'L' && d.vcc.indexOf('5V') >= 0 ? '5V' : d.vcc[0]) : 'GND';
    var rail = sup === 'GND' ? (part.half === 'U' ? 'T-' : 'B-') : sup === '3V3' && part.half === 'U' ? 'T+' : sup === '5V' && part.half === 'L' ? 'B+' : null;
    hole = self._hole(part, p.n, 'far'); if (!hole) return;
    if (rail && self._feedRail(rail)) { var rh = self._railHole(rail, near); if (rh && self.addWire(hole, rh, undefined, true)) n++; }
    else { var sp = self._supplyPin(sup); if (sp && self.addWire(hole, sp, undefined, true)) n++; }
  });
  return n;
};
// Remove everything an earlier example placed automatically and was not touched since.
B.dropAuto = function () {
  var keep = {}, self = this;
  this.parts = this.parts.filter(function (p) { return !p.auto; });
  this.wires = this.wires.filter(function (w) { return !w.auto; });
};

/* ---------- save and load ---------- */
B.export = function () {
  return { v: 1, seq: this.seq, onboard: { leds: this.onboard.leds, sw: this.onboard.sw },
    parts: this.parts.map(function (p) { return { id: p.id, t: p.type, c: p.col, h: p.half, a: p.auto ? 1 : 0 }; }),
    wires: this.wires.map(function (w) { return { id: w.id, a: w.a, b: w.b, k: w.color, x: w.auto ? 1 : 0 }; }) };
};
B.import = function (o) {
  this.parts = []; this.wires = []; this.applied = {};
  if (!o || typeof o !== 'object') return false;
  var self = this, max = 0;
  if (o.onboard) { this.onboard.leds = o.onboard.leds !== false; this.onboard.sw = o.onboard.sw !== false; }
  (Array.isArray(o.parts) ? o.parts : []).forEach(function (p) {
    if (!p || !DEFS[p.t] || self.whyNot(p.t, p.c, p.h)) return;
    var id = +p.id > 0 ? +p.id : ++max; self.parts.push({ id: id, type: p.t, col: p.c, half: p.h, auto: !!p.a }); max = Math.max(max, id);
  });
  (Array.isArray(o.wires) ? o.wires : []).forEach(function (w) {
    if (!w || !parseRef(w.a) || !parseRef(w.b) || w.a === w.b || self.occupied(w.a) || self.occupied(w.b)) return;
    var id = +w.id > 0 ? +w.id : ++max, col = typeof w.k === 'string' && /^#[0-9A-Fa-f]{6}$/.test(w.k) ? w.k : self.autoColor(w.a, w.b);
    self.wires.push({ id: id, a: w.a, b: w.b, color: col, auto: !!w.x }); max = Math.max(max, id);
  });
  this.seq = Math.max(this.seq, +o.seq || 1, max + 1);
  return true;
};

M.supplyName = function (s) { return SUPNAME[s] || s; };
return M;
})(typeof MSP !== 'undefined' ? MSP : require('./core.js'));
