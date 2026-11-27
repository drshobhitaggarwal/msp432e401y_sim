/* External parts wired to GPIO pins: 4x4 keypad matrix and relay module with status LEDs. */
(function (M) {
'use strict';
var P = M.Sim.prototype;

P.defaultParts = function () {
  var z = function () { return [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]; };
  this.keypad = { on: true, rows: ['K0','K1','K2','K3'], cols: ['L0','L1','L2','L3'], down: z(), eff: z(), n: 0, bounce: false };
  this.relay = { on: true, pin: 'M0', low: true, coil: false, contact: false, count: 0, last: -1, chatter: false, chatterAt: 0, ev: null };
};
P.partsReset = function () {
  var r = this.relay;
  if (r) { r.coil = false; r.contact = false; r.count = 0; r.last = -1; r.chatter = false; r.ev = null; }
  var k = this.keypad;
  if (k) { for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) k.eff[i][j] = k.down[i][j]; this.kpCount(); }
};

/* ---- keypad ---- */
P.kpCount = function () {
  var k = this.keypad, n = 0;
  for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) n += k.eff[i][j];
  k.n = k.on ? n : 0;
};
P.kpPorts = function () {
  var k = this.keypad, seen = {}, out = [];
  k.rows.concat(k.cols).forEach(function (p) { if (p && !seen[p[0]]) { seen[p[0]] = 1; out.push(p[0]); } });
  return out;
};
P.kpUpdate = function () { var ps = this.kpPorts(); for (var i = 0; i < ps.length; i++) this.gpioUpdate(ps[i]); };
// Level a pressed key forces onto an input pin, or undefined when nothing drives it.
P.kpDrive = function (key) {
  var k = this.keypad, v;
  for (var i = 0; i < 4; i++) {
    for (var j = 0; j < 4; j++) {
      if (!k.eff[i][j]) continue;
      var other = k.rows[i] === key ? k.cols[j] : k.cols[j] === key ? k.rows[i] : null;
      if (!other) continue;
      var q = this.gpio[other[0]], m = 1 << +other[1];
      if ((q.dir & m) && (q.den & m) && !q.alt[+other[1]]) { var lv = (q.out & m) ? 1 : 0; v = v === undefined ? lv : (v & lv); }
    }
  }
  return v;
};
P.keyEff = function (r, c, v) {
  this.keypad.eff[r][c] = v ? 1 : 0; this.kpCount(); this.kpUpdate();
};
P.keySet = function (r, c, v) {
  var k = this.keypad, S = this; v = v ? 1 : 0;
  if (k.down[r][c] === v) return;
  k.down[r][c] = v;
  if (!k.bounce) { this.keyEff(r, c, v); return; }
  var t = this.T(), n = 1 + 2 * (1 + Math.floor(Math.random() * 3));      // odd number of edges, ends at v
  for (var i = 0; i < n; i++) {
    t += 0.0002 + Math.random() * 0.0007;
    (function (val) { S.at(t, function () { S.keyEff(r, c, val); }); })(i % 2 === 0 ? v : 1 - v);
  }
};
P.setKeypadOn = function (on) { this.keypad.on = !!on; this.kpCount(); this.kpUpdate(); };

/* ---- relay module ---- */
P.relayCheck = function () {
  var r = this.relay; if (!r || !r.on || !r.pin) return;
  var b = +r.pin[1], m = 1 << b, p = this.gpio[r.pin[0]];
  var lvl = ((p.dir & m) && (p.den & m)) ? p.dig[b] : (r.low ? 1 : 0);     // idle level comes from the module's pull resistor
  var coil = r.low ? !lvl : !!lvl;
  if (coil === r.coil) return;
  var S = this, t = this.T();
  r.coil = coil; this.rec('COIL', t, coil ? 1 : 0);
  if (r.last >= 0 && t - r.last < 0.1) { r.chatter = true; r.chatterAt = t; }
  r.last = t;
  this.cancel(r.ev);
  r.ev = this.at(t + (coil ? 0.010 : 0.005), function (te) { r.contact = coil; r.count++; S.rec('RELAY', te, coil ? 1 : 0); });
};
P.setRelay = function (cfg) {
  var r = this.relay;
  if ('pin' in cfg) r.pin = cfg.pin; if ('low' in cfg) r.low = !!cfg.low; if ('on' in cfg) r.on = !!cfg.on;
  r.coil = false; r.contact = false; this.cancel(r.ev);
  this.relayCheck();
};
return M;
})(typeof MSP !== 'undefined' ? MSP : require('./core.js'));
