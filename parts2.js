/* Add-on parts model: LED bar, RGB LED, 7-segment, buzzer, DC motor, servo, stepper, DIP switches, push buttons.
   Output parts watch pin signals (average level, frequency, pulse width). Input parts drive pins through S.inputs. */
(function (M) {
'use strict';
var P = M.Sim.prototype;

M.isPin = function (s) { return typeof s === 'string' && s.length === 2 && M.PORTS.indexOf(s[0]) >= 0 && s[1] >= '0' && s[1] <= '7'; };
function pinOk(s) { return s === '' || M.isPin(s); }
M.PWMOF = { F0: 0, F1: 1, F2: 2, F3: 3, G0: 4, G1: 5, K4: 6, K5: 7 };
M.SEGCHARS = { 0x3F: '0', 0x06: '1', 0x5B: '2', 0x4F: '3', 0x66: '4', 0x6D: '5', 0x7D: '6', 0x07: '7', 0x7F: '8', 0x6F: '9', 0x77: 'A', 0x7C: 'b', 0x39: 'C', 0x5E: 'd', 0x79: 'E', 0x71: 'F' };
var HALF = [1, 3, 2, 6, 4, 12, 8, 9];            // 28BYJ-48 half-step coil patterns, bit0 = IN1

M.defMods = function () {
  return {
    ledbar:  { on: false, pins: ['D0','D1','D2','D3','D4','D5','D6','D7'], low: false },
    rgb:     { on: false, pins: ['F1','F2','F3'], anode: false },
    seg:     { on: false, pins: ['C0','C1','C2','C3','C4','C5','C6','C7'], anode: false },
    buzzer:  { on: false, pin: 'G0', passive: true, low: false },
    motor:   { on: false, in1: 'H0', in2: 'H1', en: 'G1', maxRpm: 150 },
    servo:   { on: false, pin: 'K4', wide: false },
    stepper: { on: false, pins: ['P0','P1','P2','P3'] },
    dip:     { on: false, pins: ['Q0','Q1','Q2','Q3'], vcc: false, state: [0,0,0,0] },
    btns:    { on: false, pins: ['B0','B1','B2','B3'], vcc: false, bounce: false, down: [0,0,0,0], eff: [0,0,0,0] }
  };
};
var baseDefMods = M.defMods;
M.defMods = function () { var o = baseDefMods(); var b = M.busDefMods ? M.busDefMods() : {}; Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; };
function merge(def, src) {
  var out = {};
  Object.keys(def).forEach(function (k) {
    var d = def[k], s = src ? src[k] : undefined;
    if (Array.isArray(d)) {
      var ok = Array.isArray(s) && s.length === d.length && s.every(function (x) {
        return typeof x === typeof d[0] && (typeof x !== 'string' || pinOk(x)) && (typeof x !== 'number' || x === 0 || x === 1);
      });
      out[k] = (ok ? s : d).slice();
    } else if (typeof d === 'boolean') out[k] = typeof s === 'boolean' ? s : d;
    else if (typeof d === 'string') out[k] = typeof s === 'string' && pinOk(s) ? s : d;
    else if (typeof d === 'number') out[k] = [60, 150, 300].indexOf(s) >= 0 ? s : d;
  });
  return out;
}

/* ---------- lifecycle ---------- */
var oldDefault = P.defaultParts;
P.defaultParts = function () {
  oldDefault.call(this);
  this.mods = M.defMods();
  if (!this._hooked) { var S = this; this._hooked = true; this.hooks.push(function (L) { stepperHook(S, L); }); }
  this.partsReset();
};
var oldReset = P.partsReset;
P.partsReset = function () {
  oldReset.call(this);
  this.ms = {
    st: {}, last: undefined,
    motor: { rpm: 0, angle: 0, drive: 0, state: 'stopped' },
    servo: { angle: 90, target: 90, signal: false, pulse: 0, freq: 0 },
    stepper: { pos: 0, phase: -1, pattern: 0, lastT: -1, missed: 0, stalled: false, stallAt: -1, note: '' }
  };
  if (this.mods) { var b = this.mods.btns; b.eff = b.down.slice(); this.syncInputs(); }
};

/* ---------- signals ---------- */
P.driven = function (pin) {
  if (!M.isPin(pin)) return false;
  var p = this.gpio[pin[0]], b = +pin[1], m = 1 << b;
  if (p.alt[b]) return true;
  return !!((p.dir & m) && (p.den & m));
};
P.pinSig = function (pin) {
  var r = { level: 0, freq: 0, duty: 0, pulse: 0, pwm: false };
  if (!M.isPin(pin)) return r;
  var p = this.gpio[pin[0]], b = +pin[1], alt = p.alt[b], T = this.T();
  r.level = p.lv[b];
  if (alt && alt.indexOf('pwm') === 0) {
    var n = +alt.slice(3), g = this.pwm.gens[n >> 1], rate = this.clk / this.pwm.div;
    r.pwm = true;
    if ((this.pwm.outEn & (1 << n)) && g.en && g.period) {
      r.freq = rate / g.period; r.pulse = Math.min(this.pwm.pulse[n], g.period) / rate; r.duty = r.pulse * r.freq;
    }
    return r;
  }
  var sg = p.sg[b];
  if (sg && sg.per > 0 && T - sg.chg < Math.max(2 * sg.per, 0.02)) { r.freq = 1 / sg.per; r.pulse = sg.hi; r.duty = Math.min(1, sg.hi / sg.per); }
  else r.duty = p.dig[b];
  return r;
};
// Average level since the previous call with the same key, 0 when the MCU is not driving the pin.
P.lvl = function (pin, key) {
  if (!M.isPin(pin) || !this.ms) return 0;
  var st = this.ms.st[key] || (this.ms.st[key] = {});
  var p = this.gpio[pin[0]], b = +pin[1], t = this.now, i = p.acc[b] + p.lv[b] * (t - p.lt[b]), r;
  if (st.e !== this.epoch || st.t === undefined || t < st.t) r = p.lv[b];
  else if (t > st.t) r = (i - st.i) / (t - st.t);
  else r = st.r;
  st.e = this.epoch; st.t = t; st.i = i; st.r = r;
  return this.driven(pin) ? Math.max(0, Math.min(1, r)) : 0;
};

/* ---------- switches and buttons (drive pins) ---------- */
P.syncInputs = function () {
  var mo = this.mods, want = {}, self = this;
  function add(pin, level, closed) { if (M.isPin(pin) && closed) want[pin] = level; }
  if (mo) {
    if (mo.dip.on) mo.dip.pins.forEach(function (p, i) { add(p, mo.dip.vcc ? 1 : 0, mo.dip.state[i]); });
    if (mo.btns.on) mo.btns.pins.forEach(function (p, i) { add(p, mo.btns.vcc ? 1 : 0, mo.btns.eff[i]); });
  }
  Object.keys(this.owned).forEach(function (p) { if (!(p in want)) { delete self.owned[p]; self.setInput(p[0], +p[1], null); } });
  Object.keys(want).forEach(function (p) { self.owned[p] = 1; self.setInput(p[0], +p[1], want[p]); });
};
P.dipSet = function (i, v) { this.mods.dip.state[i] = v ? 1 : 0; this.syncInputs(); };
P.btnSet = function (i, v) {
  var b = this.mods.btns, S = this; v = v ? 1 : 0;
  if (b.down[i] === v) return;
  b.down[i] = v;
  if (!b.bounce) { b.eff[i] = v; this.syncInputs(); return; }
  var t = this.T(), n = 1 + 2 * (1 + Math.floor(Math.random() * 3));
  for (var k = 0; k < n; k++) {
    t += 0.0002 + Math.random() * 0.0007;
    (function (val) { S.at(t, function () { b.eff[i] = val; S.syncInputs(); }); })(k % 2 === 0 ? v : 1 - v);
  }
};

/* ---------- on/off ---------- */
P.partOn = function (name, on) {
  on = !!on;
  if (name === 'leds') this.onboard.leds = on;
  else if (name === 'sw') { this.onboard.sw = on; if (!on) { this.setInput('J', 0, null); this.setInput('J', 1, null); } }
  else if (name === 'keypad') this.setKeypadOn(on);
  else if (name === 'relay') this.setRelay({ on: on });
  else if (this.mods && this.mods[name]) {
    this.mods[name].on = on;
    var pre = { ledbar: 'lb', rgb: 'rg', seg: 'sg', buzzer: 'bz', motor: 'm', servo: 'sv' }[name];
    var st = this.ms.st;
    Object.keys(st).forEach(function (k) { if (pre && k.indexOf(pre) === 0) delete st[k]; });
    if (name === 'dip' || name === 'btns') this.syncInputs();
  }
};
P.partIsOn = function (name) {
  if (name === 'leds') return this.onboard.leds;
  if (name === 'sw') return this.onboard.sw;
  if (name === 'keypad') return this.keypad.on;
  if (name === 'relay') return this.relay.on;
  return !!(this.mods && this.mods[name] && this.mods[name].on);
};

/* ---------- dynamics (call once per frame, virtual time) ---------- */
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
P.modStep = function () {
  var mo = this.mods, ms = this.ms; if (!mo || !ms) return;
  var t = this.now, dt = ms.last === undefined || t < ms.last ? 0 : t - ms.last; ms.last = t;

  var m = mo.motor, s = ms.motor;
  if (m.on) {
    var a1 = m.in1 ? this.lvl(m.in1, 'm1') : 0, a2 = m.in2 ? this.lvl(m.in2, 'm2') : 0, en = m.en ? this.lvl(m.en, 'me') : 1;
    var drive = en * (a1 - a2), brake = a1 > 0.9 && a2 > 0.9 && en > 0.5, weak = Math.abs(drive) < 0.12;
    var target = brake || weak ? 0 : drive * m.maxRpm, tau = brake ? 0.05 : weak ? 0.35 : 0.2;
    if (dt > 0) {
      s.rpm += (target - s.rpm) * (1 - Math.exp(-dt / tau));
      if (Math.abs(s.rpm) < 0.5 && target === 0) s.rpm = 0;
      s.angle = (s.angle + s.rpm * 6 * dt) % 360; if (s.angle < 0) s.angle += 360;
    }
    s.drive = drive;
    s.state = brake ? 'braking' : Math.abs(s.rpm) < 1 ? (weak && Math.abs(drive) > 0.02 ? 'too little drive to start' : 'stopped') : s.rpm > 0 ? 'forward' : 'reverse';
  } else { s.rpm = 0; s.state = 'off'; }

  var v = mo.servo, sv = ms.servo;
  if (v.on && v.pin) {
    var sg = this.pinSig(v.pin), lo = v.wide ? 0.5e-3 : 1e-3, hi = v.wide ? 2.5e-3 : 2e-3;
    sv.freq = sg.freq; sv.pulse = sg.pulse;
    sv.signal = this.driven(v.pin) && sg.freq >= 20 && sg.freq <= 100 && sg.pulse >= 0.4e-3 && sg.pulse <= 2.6e-3;
    if (sv.signal) sv.target = clamp((sg.pulse - lo) / (hi - lo) * 180, 0, 180);
    if (dt > 0) { var d = sv.target - sv.angle, md = 600 * dt; sv.angle += Math.abs(d) <= md ? d : (d > 0 ? md : -md); }
  }
};
P.zeroStepper = function () { var s = this.ms.stepper; s.pos = 0; s.missed = 0; s.stalled = false; s.note = ''; };

function stepperHook(S, L) {
  var m = S.mods && S.mods.stepper; if (!m || !m.on || !S.ms) return;
  var hit = false; m.pins.forEach(function (p) { if (p && p[0] === L) hit = true; });
  if (!hit) return;
  var n = 0;
  m.pins.forEach(function (p, i) { if (M.isPin(p) && S.gpio[p[0]].dig[+p[1]] && S.driven(p)) n |= 1 << i; });
  var s = S.ms.stepper; if (n === s.pattern) return;
  s.pattern = n;
  var ph = HALF.indexOf(n), t = S.T();
  if (ph < 0) return;                                  // all coils off or an invalid pattern: the rotor holds
  if (s.phase < 0) { s.phase = ph; s.lastT = t; return; }
  var d = (ph - s.phase + 8) % 8; if (d > 4) d -= 8;
  var gap = t - s.lastT; s.lastT = t;
  if (d === 0) return;
  if (Math.abs(d) > 2) { s.missed++; s.note = 'The coil sequence skips phases, so the rotor cannot follow.'; return; }
  s.phase = ph;
  if (gap < 0.0014) { s.stalled = true; s.stallAt = t; s.missed++; s.note = 'Stepping faster than about 700 half-steps per second: the rotor stalls.'; return; }
  s.pos += d;
}

/* ---------- buzzer ---------- */
P.buzzState = function () {
  var z = this.mods && this.mods.buzzer, r = { sound: false, freq: 0, vol: 0, label: '' };
  if (!z || !z.on) return r;
  if (!z.pin) { r.label = 'Input is not wired'; return r; }
  if (!this.driven(z.pin)) { r.label = 'P' + z.pin + ' is not an output yet'; return r; }
  if (!z.passive) {
    var l = this.lvl(z.pin, 'bz'), on = z.low ? 1 - l : l;
    if (on > 0.05) { r.sound = true; r.freq = 2700; r.vol = Math.min(1, on); r.label = 'Beeping (active buzzer, fixed 2.7 kHz)'; } else r.label = 'Silent';
    return r;
  }
  var sg = this.pinSig(z.pin);
  if (sg.freq >= 20 && sg.freq <= 20000) {
    r.freq = sg.freq; r.vol = Math.min(1, 4 * sg.duty * (1 - sg.duty)); r.sound = r.vol > 0.05;
    r.label = Math.round(sg.freq) + ' Hz' + (r.sound ? '' : ' (duty too extreme to hear)');
  } else if (sg.freq > 20000) r.label = Math.round(sg.freq) + ' Hz is above hearing range';
  else r.label = sg.duty > 0.5 ? 'Steady high. A passive buzzer only clicks; it needs a toggling signal.' : 'Silent';
  return r;
};

/* ---------- wiring list and persistence ---------- */
P.partsPins = function () {
  var out = [], mo = this.mods, k = this.keypad, r = this.relay;
  function add(mod, who, pin) { out.push({ mod: mod, who: who, pin: pin }); }
  if (k && k.on) { k.rows.forEach(function (p, i) { add('Keypad', 'keypad R' + (i + 1), p); }); k.cols.forEach(function (p, i) { add('Keypad', 'keypad C' + (i + 1), p); }); }
  if (r && r.on) add('Relay', 'relay IN', r.pin);
  if (!mo) return out;
  if (mo.ledbar.on) mo.ledbar.pins.forEach(function (p, i) { add('LED bar', 'LED ' + (i + 1), p); });
  if (mo.rgb.on) ['red', 'green', 'blue'].forEach(function (c, i) { add('RGB LED', 'RGB ' + c, mo.rgb.pins[i]); });
  if (mo.seg.on) ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].forEach(function (c, i) { add('7-segment', 'segment ' + c, mo.seg.pins[i]); });
  if (mo.buzzer.on) add('Buzzer', 'buzzer', mo.buzzer.pin);
  if (mo.motor.on) { add('DC motor', 'motor IN1', mo.motor.in1); add('DC motor', 'motor IN2', mo.motor.in2); if (mo.motor.en) add('DC motor', 'motor EN', mo.motor.en); }
  if (mo.servo.on) add('Servo', 'servo signal', mo.servo.pin);
  if (mo.stepper.on) mo.stepper.pins.forEach(function (p, i) { add('Stepper', 'stepper IN' + (i + 1), p); });
  if (mo.dip.on) mo.dip.pins.forEach(function (p, i) { add('DIP switches', 'switch ' + (i + 1), p); });
  if (mo.btns.on) mo.btns.pins.forEach(function (p, i) { add('Push buttons', 'button ' + (i + 1), p); });
  if (M.busPins) M.busPins(this, add);
  return out;
};
P.partsExport = function () {
  var k = this.keypad, r = this.relay, mo = this.mods, out = {
    v: 2, onboard: { leds: this.onboard.leds, sw: this.onboard.sw },
    keypad: { on: k.on, rows: k.rows.slice(), cols: k.cols.slice(), bounce: k.bounce },
    relay: { on: r.on, pin: r.pin, low: r.low }, mods: {}
  };
  Object.keys(mo).forEach(function (n) {
    var c = {};
    Object.keys(mo[n]).forEach(function (f) { if (f !== 'down' && f !== 'eff') c[f] = Array.isArray(mo[n][f]) ? mo[n][f].slice() : mo[n][f]; });
    out.mods[n] = c;
  });
  return out;
};
P.partsImport = function (c) {
  if (!c || typeof c !== 'object') return;
  var def = M.defMods(), mo = {}, k = this.keypad, r = this.relay;
  Object.keys(def).forEach(function (n) { mo[n] = M.BUSMODS && (M.BUSMODS.indexOf(n) >= 0 || n === 'buses') ? M.busMerge(n, def[n], c.mods && c.mods[n]) : merge(def[n], c.mods && c.mods[n]); });
  mo.btns.down = [0, 0, 0, 0]; mo.btns.eff = [0, 0, 0, 0];
  this.mods = mo;
  var mk = merge({ on: true, rows: k.rows.slice(), cols: k.cols.slice(), bounce: false }, c.keypad);
  k.on = mk.on; k.rows = mk.rows; k.cols = mk.cols; k.bounce = mk.bounce;
  var mr = merge({ on: true, pin: r.pin, low: true }, c.relay);
  r.on = mr.on; r.pin = mr.pin; r.low = mr.low;
  var ob = merge({ leds: true, sw: true }, c.onboard);
  this.onboard.leds = ob.leds; this.onboard.sw = ob.sw;
  this.partsApply();
};
P.partsApply = function () {
  this.kpCount(); this.kpUpdate(); this.setRelay({});
  for (var i = 0; i < 4; i++) this.mods.btns.eff[i] = this.mods.btns.down[i];
  this.syncInputs();
};
return M;
})(typeof MSP !== 'undefined' ? MSP : require('./core.js'));
