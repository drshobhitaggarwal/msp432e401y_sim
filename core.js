/* MSP432E401Y simulator core: virtual time, events, interrupts, GPIO, timers, SysTick */
var MSP = (function (M) {
'use strict';
var PORTS = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q'];
M.PORTS = PORTS;
function SimFault(msg) { this.message = msg; this.isFault = true; }
M.SimFault = SimFault;

function z8() { return [0,0,0,0,0,0,0,0]; }
function mkPort() {
  return { dir:0, den:0, out:0, pur:0, pdr:0, is:0, ibe:0, iev:0, im:0, ris:0, analog:0, used:0,
           alt:{}, afsel:0, pctl:0, raw:{}, lv:z8(), dig:z8(), lt:z8(), acc:z8(), accLast:z8(), tLast:z8(), sg:[] };
}
function mkSub() { return { load:0xFFFFFFFF, mode:0, run:false, start:0, ev:null, ris:0, mask:0, pre:0, up:false, mr:0 }; }

function Sim(cb) {
  cb = cb || {};
  this.onTx = cb.onTx || function () {};
  this.onLog = cb.onLog || function () {};
  this.inputs = {};                                   // external pin drive: "J0" -> 0|1 (absent = floating)
  this.analogCfg = [0,1,2,3].map(function () { return { v: 1.65, mode: 'dc' }; });
  this.tempC = 25;
  this.keypad = null; this.relay = null; this.mods = null;   // external parts (wiring persists across restarts)
  this.hooks = []; this.owned = {}; this.epoch = 0;
  this.peeking = false;
  this.dbg = { on: false, bps: {}, rev: 0, where: '', mode: 'run', stepDepth: 0, pauseReq: false, line: 0, frames: [], reason: '', vars: null, globals: null, isrName: null };
  this.onboard = { leds: true, sw: true };
  this.reset();
}
M.Sim = Sim;
var P = Sim.prototype;

P.reset = function () {
  var self = this;
  this.now = 0; this.cpu = 0; this.spent = 0; this.clk = 16e6; this.epoch++;
  this._regs = null; this.regsh = {}; this.nvicRaw = [0, 0, 0, 0, 0]; this.isr = null; this.paused = false;
  this.prio = {}; this.swPend = {}; this.raw = {}; this.resetReq = false;
  this.sc = { mosc: false, pllfreq0: 0, pllfreq1: 0, rsclkcfg: 0, pllOn: false };
  var d = this.dbg; d.frames = []; d.mode = 'run'; d.pauseReq = false; d.line = 0; d.reason = ''; d.vars = null; d.isrName = null;
  this.events = []; this.halted = false; this.cpuWait = null; this.gen = null; this.loaded = false;
  this.userFns = {}; this.nameMap = {}; this.handlers = {};
  this.master = false; this.nvic = {}; this.dirty = false; this.irqCount = 0; this.streak = 0; this.lastIrq = '';
  this.periph = {}; this.warned = {}; this.tr = {};
  this.gpio = {};
  PORTS.forEach(function (L) { self.gpio[L] = mkPort(); });
  this.timers = [];
  for (var i = 0; i < 8; i++) this.timers.push({ A: mkSub(), B: mkSub(), split: false, cfg: 0, ctl: 0, imr: 0, raw: {} });
  this.st = { period: 0xFFFFFF, en: false, inten: false, flag: false, cnt: false, rate: 0, ev: null, start: 0 };
  this.u = { en: false, baud: 115200, cfg: false, rx: [], im: 0, ris: 0, txq: [], txEnd: 0, rxEnd: 0, txe: true, rxe: true, ibrd: 0, fbrd: 0, lcrh: 0, ifls: 0x12, cc: 0 };
  this.adc = [0, 1].map(function () {
    return { raw: {}, seq: [0,1,2,3].map(function () {
      return { trig: 0, steps: [], en: false, fifo: [], ris: 0, im: 0, ev: null, mux: 0, ctl: 0 };
    }) };
  });
  this.pwm = { div: 1, gens: [0,1,2,3].map(function () { return { period: 0, en: false, R: { ctl: 0, load: 0, cmpa: 0, cmpb: 0, gena: 0, genb: 0 }, reg: false }; }), invert: 0, cc: 0, raw: {},
               pulse: [0,0,0,0,0,0,0,0], outEn: 0 };
  if (this.busReset) this.busReset();
  if (this.partsReset) this.partsReset();
};

/* ---------- logging / faults ---------- */
P.getRegs = function () { return this._regs || (this._regs = M.buildRegs(this)); };
P.log = function (kind, msg) { this.onLog(kind, msg, this.now); };
P.fault = function (msg) { throw new SimFault(msg); };
P.warn = function (key, msg) { if (!this.warned[key]) { this.warned[key] = 1; this.log('warn', msg); } };

/* ---------- time and events (all times are virtual seconds) ---------- */
P.T = function () { return this.now + this.cpu; };
P.at = function (t, fn) {
  var e = { t: t, fn: fn, dead: false }, a = this.events, i = a.length;
  while (i > 0 && a[i - 1].t > t) i--;
  a.splice(i, 0, e);
  return e;
};
P.cancel = function (e) { if (e) e.dead = true; };
P.runDue = function () {
  var a = this.events;
  while (a.length && a[0].t <= this.now) { var e = a.shift(); if (!e.dead) e.fn(e.t); }
};
P.sync = function () { this.now += this.cpu; this.cpu = 0; this.runDue(); };
P.touch = function () { this.dirty = true; };

/* ---------- interrupts ---------- */
var IRQN = { gpioa: 0, gpiob: 1, gpioc: 2, gpiod: 3, gpioe: 4, uart0: 5, uart1: 6, ssi0: 7, i2c0: 8, adc0ss0: 14, adc0ss1: 15, adc0ss2: 16, adc0ss3: 17,
  timer0a: 19, timer0b: 20, timer1a: 21, timer1b: 22, timer2a: 23, timer2b: 24, gpiof: 30, gpiog: 31, gpioh: 32, uart2: 33, ssi1: 34, timer3a: 35, timer3b: 36, i2c1: 37,
  adc1ss0: 46, adc1ss1: 47, adc1ss2: 48, adc1ss3: 49, gpioj: 51, gpiok: 52, gpiol: 53, ssi2: 54, ssi3: 55, uart3: 56, uart4: 57, uart5: 58, uart6: 59, uart7: 60,
  i2c2: 61, i2c3: 62, timer4a: 63, timer4b: 64, timer5a: 65, timer5b: 66, i2c4: 70, i2c5: 71, gpiom: 72, gpion: 73, timer6a: 98, timer6b: 99, timer7a: 100, timer7b: 101 };
for (var pi = 0; pi < 8; pi++) { IRQN['gpiop' + pi] = 76 + pi; IRQN['gpioq' + pi] = 84 + pi; }
var IRQS = ['systick'], IRQNAME = {};
Object.keys(IRQN).sort(function (a, b) { return IRQN[a] - IRQN[b]; }).forEach(function (n) { IRQS.push(n); IRQNAME[IRQN[n]] = n; });
M.IRQN = IRQN; M.IRQNAME = IRQNAME;
M.IRQS = IRQS;

P.irqLine = function (name) {
  var m;
  if (name === 'systick') return (this.st.flag && this.st.inten) || this.swPend.systick;
  if (this.swPend[name]) return true;
  if ((m = /^gpio([a-z])(\d)?$/.exec(name))) { var p = this.gpio[m[1].toUpperCase()]; return (p.ris & p.im & (m[2] === undefined ? 0xFF : 1 << +m[2])) !== 0; }
  if ((m = /^uart(\d)$/.exec(name))) return +m[1] === 0 && (this.u.ris & this.u.im) !== 0;
  if ((m = /^timer(\d)([ab])$/.exec(name))) { var s = this.timers[+m[1]][m[2].toUpperCase()]; return (s.ris & s.mask) !== 0; }
  if ((m = /^adc(\d)ss(\d)$/.exec(name))) { var q = this.adc[+m[1]].seq[+m[2]]; return q.ris && q.im; }
  if ((name === 'i2c0' || name === 'ssi0') && this.busIrq) return this.busIrq(name);
  return false;
};
P.activeIrq = function () {
  var best = null, bp = 99;
  for (var i = 0; i < IRQS.length; i++) {
    var n = IRQS[i];
    if ((n === 'systick' || this.nvic[n]) && this.irqLine(n)) { var pr = this.prio[n] || 0; if (pr < bp) { best = n; bp = pr; } }
  }
  return best;
};
function norm(n) { return n.toLowerCase().replace(/_/g, '').replace(/(irq)?(int)?(handler|isr)$/, ''); }
P.findHandler = function (name) {
  var h = this.handlers[name] || this.nameMap[name], m;
  if (!h && (m = /^gpio([pq])\d$/.exec(name))) h = this.handlers['gpio' + m[1]] || this.nameMap['gpio' + m[1]];
  return h || null;
};
P.runIsr = function (fn) { this.dbg.isrName = this.isrName; this.dbg.isrBase = this.dbg.frames.length; this.isr = fn(); this.pumpIsr(); };
P.pumpIsr = function () {
  var g = this.isr;
  if (!g || typeof g.next !== 'function') { this.isr = null; return; }
  var r;
  while (!(r = g.next()).done) {
    var v = r.value;
    if (v && v.dbg) { this.paused = true; return; }          // debugger stop inside a handler: keep the generator
    if (v && v.wait) {                                       // blocking call inside an ISR: let time pass
      this.sync();
      var tn = this.events.length ? this.events[0].t : this.now + 1e-3;
      var t = v.until != null ? Math.min(v.until, tn) : tn;
      this.now = Math.max(this.now, t); this.runDue();
    } else if (this.cpu > 0.05) { this.sync(); }
  }
  this.isr = null;
};
P.service = function () {
  if (!this.master || !this.dirty) return;
  this.dirty = false;
  for (var guard = 0; guard < 200; guard++) {
    var name = this.activeIrq();
    if (!name) return;
    var h = this.findHandler(name);
    if (!h) this.fault(name.toUpperCase() + ' interrupt fired but no handler is registered. The default handler spins forever on real hardware. Define a function named ' + this.suggestName(name) + ' or register one with IntRegister().');
    if (this.streak > 2000) this.fault('Interrupt storm: ' + name.toUpperCase() + ' keeps firing because its flag is never cleared. Clear it inside the handler (for example TimerIntClear, GPIOIntClear, UARTIntClear or ADCIntClear).');
    this.irqCount++;
    if (name === 'systick') this.st.flag = false;
    delete this.swPend[name];
    this.cpu += 24 / this.clk;                 // exception entry + exit
    this.isrName = name;
    this.runIsr(h);
    if (this.paused) return;
    this.sync();
    this.streak = this.irqLine(name) ? this.streak + 1 : 0;
  }
  this.dirty = true;
};
P.suggestName = function (name) {
  var m;
  if (name === 'systick') return 'SysTick_Handler';
  if ((m = /^gpio([a-z])(\d?)$/.exec(name))) return 'GPIO' + m[1].toUpperCase() + m[2] + '_Handler';
  return name.toUpperCase() + '_Handler';
};

/* ---------- peripheral clock gating ---------- */
P.need = function (key, api) {
  if (!this.periph[key]) this.fault('Hard fault in ' + api + ': peripheral ' + key + ' has no clock. Call SysCtlPeripheralEnable(SYSCTL_PERIPH_' + key + ') first.');
};

/* ---------- GPIO ---------- */
// alternate-function table: [port, pin, PCTL mux value, signal]
var PINFN = [];
(function () {
  [['F',0],['F',1],['F',2],['F',3],['G',0],['G',1],['K',4],['K',5]].forEach(function (d, n) { PINFN.push([d[0], d[1], 6, 'M0PWM' + n, 'pwm' + n]); });
  PINFN.push(['A',0,1,'U0RX','u0rx'], ['A',1,1,'U0TX','u0tx']);
  PINFN.push(['B',2,2,'I2C0SCL','i2c0scl'], ['B',3,2,'I2C0SDA','i2c0sda']);
  PINFN.push(['A',2,15,'SSI0CLK','ssi0clk'], ['A',3,15,'SSI0FSS','ssi0fss'], ['A',4,15,'SSI0XDAT0','ssi0mosi'], ['A',5,15,'SSI0XDAT1','ssi0miso']);
})();
M.PINFN = PINFN;
var PINMAP = {};
PINFN.forEach(function (d) { PINMAP[d[0] + d[1] + ':' + d[2]] = d[4]; });
P.pinMux = function (L) {
  var p = this.gpio[L];
  for (var b = 0; b < 8; b++) {
    var fn = null;
    if (p.afsel & (1 << b)) {
      var mux = (p.pctl >>> (4 * b)) & 15;
      fn = PINMAP[L + b + ':' + mux] || null;
      if (!fn && mux) this.warn('mux' + L + b + mux, 'P' + L + b + ' is set to an alternate function (AFSEL=1, PCTL=' + mux + ') that this simulator does not model, so the pin is treated as disconnected.');
    }
    if (fn) p.alt[b] = fn; else delete p.alt[b];
  }
  this.gpioUpdate(L);
};
P.pinLevel = function (L, b) {
  var p = this.gpio[L], m = 1 << b;
  var alt = p.alt[b];
  if (alt && alt.indexOf('pwm') === 0) {
    var n = +alt.slice(3);
    if (!(this.pwm.outEn & (1 << n))) return 0;
    var g = this.pwm.gens[n >> 1];
    return g.en && g.period ? Math.min(1, this.pwm.pulse[n] / g.period) : 0;
  }
  if (p.afsel & m) return alt ? (alt.indexOf('pwm') === 0 ? 0 : (this.altLevel ? this.altLevel(alt) : 1)) : 0;
  if (p.dir & m) return (p.out & m) ? 1 : 0;
  var e = this.inputs[L + b];
  if (e === 0 || e === 1) return e;
  if (this.keypad && this.keypad.n) { var kv = this.kpDrive(L + b); if (kv !== undefined) return kv; }
  if (p.pur & m) return 1;
  return 0;
};
P.rec = function (key, t, v) {
  var a = this.tr[key] || (this.tr[key] = []);
  if (a.length > 40000) a.splice(0, 10000);
  a.push([t, v]);
};
P.gpioUpdate = function (L) {
  var p = this.gpio[L], t = this.T(), dm = 0;
  for (var b = 0; b < 8; b++) {
    var m = 1 << b, lv = this.pinLevel(L, b), al = p.alt[b], busAlt = !!al && (al.indexOf('i2c') === 0 || al.indexOf('ssi') === 0);
    if (lv !== p.lv[b]) {
      p.acc[b] += p.lv[b] * (t - p.lt[b]); p.lt[b] = t; p.lv[b] = lv;
      var d = lv >= 0.5 ? 1 : 0;
      if (busAlt && d !== p.dig[b]) { p.dig[b] = d; if (!(this.tr[L + b] || []).length) this.rec(L + b, t, d); }   // bus pins: edges are recorded by the bus engine
      else if (!(al && al.indexOf('pwm') === 0) && d !== p.dig[b]) {
        p.dig[b] = d;
        var sg = p.sg[b] || (p.sg[b] = { rise: -1, per: 0, hi: 0, chg: 0 });
        if (d) { if (sg.rise >= 0) sg.per = t - sg.rise; sg.rise = t; } else if (sg.rise >= 0) sg.hi = t - sg.rise;
        sg.chg = t;
        this.rec(L + b, t, d);
        if (!(p.is & m) && ((p.ibe & m) || (d ? (p.iev & m) : !(p.iev & m)))) p.ris |= m;
      }
    }
    if (p.dig[b]) dm |= m;
  }
  if (p.is) p.ris = (p.ris & ~p.is) | (p.is & ((p.iev & dm) | (~p.iev & ~dm)));
  this.touch();
  if (!this._net) {
    this._net = true;
    if (this.keypad && this.keypad.n) { var ps = this.kpPorts(); for (var q = 0; q < ps.length; q++) if (ps[q] !== L) this.gpioUpdate(ps[q]); }
    if (this.relay) this.relayCheck();
    for (var h = 0; h < this.hooks.length; h++) this.hooks[h](L);
    this._net = false;
  }
};
P.gpioAll = function () { for (var i = 0; i < PORTS.length; i++) if (this.gpio[PORTS[i]].used) this.gpioUpdate(PORTS[i]); };
P.setInput = function (L, b, v) {         // v: 0 | 1 | null (floating)
  if (v === null || v === undefined) delete this.inputs[L + b]; else this.inputs[L + b] = v;
  this.gpioUpdate(L);
};
P.brightness = function (L, b) {           // average level since previous call (for LEDs)
  var p = this.gpio[L], t = this.now;
  var acc = p.acc[b] + p.lv[b] * (t - p.lt[b]);
  var dt = t - p.tLast[b], r = dt > 0 ? (acc - p.accLast[b]) / dt : p.lv[b];
  p.accLast[b] = acc; p.tLast[b] = t;
  return Math.max(0, Math.min(1, r));
};

/* ---------- Timers (32-bit, or split A/B) ---------- */
P.subFor = function (n, which) { return this.timers[n][which]; };
P.timerStart = function (n, which) {
  var s = this.timers[n][which], self = this;
  if (s.run) return;
  s.run = true; s.start = this.T();
  var arm = function (t0) {
    s.ev = self.at(t0 + (s.load + 1) * (self.timers[n].split ? (s.pre || 0) + 1 : 1) / self.clk, function (te) {
      s.ris |= 1; self.touch();
      if (s.mode === 0x22) { s.start = te; arm(te); } else s.run = false;
    });
  };
  arm(s.start);
};
P.timerVal = function (n, w) {
  var t = this.timers[n], s = t[w], pre = t.split ? (s.pre || 0) + 1 : 1;
  if (!s.run) return s.up ? (s.mode === 0x21 && s.ris ? s.load : 0) : (s.mode === 0x21 && s.ris ? 0 : s.load);
  var el = Math.floor((this.T() - s.start) * this.clk / pre) % (s.load + 1);
  return s.up ? el : s.load - el;
};
P.timerStop = function (n, which) {
  var s = this.timers[n][which]; this.cancel(s.ev); s.run = false;
};

/* ---------- SysTick ---------- */
P.stArm = function (t0) {
  var self = this, st = this.st;
  st.start = t0;
  st.ev = this.at(t0 + (st.period + 1) / (st.rate || this.clk), function (te) { st.flag = true; st.cnt = true; self.touch(); self.stArm(te); });
};

/* ---------- debugger hooks (only used by debug builds) ---------- */
function condJs(src) {              // C expression -> JavaScript (watch and breakpoint conditions)
  var s = String(src).replace(/->/g, '.');
  s = s.replace(/\((?:\s*(?:unsigned|signed|const|volatile|struct)\s+)*(?:u?int(?:8|16|32|64)_t|char|short|int|long|float|double|bool|size_t)\s*\*?\s*\)/g, '');
  var names = M.REGNAMES || {};
  s = s.replace(/\b[A-Za-z_][A-Za-z0-9_]*_R\b/g, function (n) { return names[n] ? '__r.' + n : n; });
  return s;
}
M.condJs = condJs;
P.dbgEval = function (frame, expr) {              // evaluates a C expression in a paused frame; never throws
  var S = this, js = condJs(expr);
  if (!frame || !frame.ev) return { err: 'no frame' };
  this.peeking = true;
  try { return { v: frame.ev(js) }; }
  catch (e) { return { err: (e && e.message) ? e.message.replace(/ is not defined/, ' is not visible here') : String(e) }; }
  finally { this.peeking = false; }
};
P.dbgHook = function (line, ev) {
  var d = this.dbg, fr = d.frames, f = fr[fr.length - 1];
  if (!f) return false;
  f.line = line; f.ev = ev;
  var stop = false, n = fr.length, bp = d.bps[line], why = '';
  if (bp) {
    if (bp === true || !bp.cond) { stop = true; why = 'breakpoint'; }
    else { var r = this.dbgEval(f, bp.cond); if (r.err) { stop = true; why = 'breakpoint condition error: ' + r.err; } else if (r.v) { stop = true; why = 'breakpoint'; } }
  }
  if (!stop) {
    if (d.mode === 'pause') { stop = true; why = 'paused'; }
    else if (d.mode === 'into') { stop = true; why = 'step'; }
    else if (d.mode === 'over' && n <= d.stepDepth) { stop = true; why = 'step'; }
    else if (d.mode === 'out' && n < d.stepDepth) { stop = true; why = 'step'; }
  }
  if (stop) { d.mode = 'run'; d.reason = why; d.line = line; d.where = this.isr ? (d.isrName || 'interrupt') : 'main'; d.rev = (d.rev || 0) + 1; }
  return stop;
};
P.dbgResume = function (mode) {
  var d = this.dbg; d.mode = mode || 'run'; d.stepDepth = d.frames.length; d.reason = ''; this.paused = false; this.touch();
};

/* ---------- running ---------- */
var WAITPOLL = { wait: true, until: null };
M.WAITPOLL = WAITPOLL;
var nowMs = (typeof performance !== 'undefined' && performance.now) ? function () { return performance.now(); } : function () { return Date.now(); };

P.run = function (dt, wallMs) {
  var goal = this.now + dt, t0 = nowMs(), n = 0;
  try {
    while (!this.halted && this.now < goal) {
      if ((++n & 31) === 0 && nowMs() - t0 > wallMs) break;
      if (this.paused) break;
      if (this.isr) { this.pumpIsr(); if (this.paused) break; this.sync(); this.dirty = true; continue; }
      this.service();
      if (this.paused) break;
      if (this.cpuWait) {
        var w = this.cpuWait, tn = this.events.length ? this.events[0].t : Infinity;
        var tgt = Math.min(goal, tn, w.until != null ? w.until : Infinity);
        if (tgt < this.now) tgt = this.now;
        this.now = tgt; this.runDue();
        if (w.until != null) { if (this.now >= w.until) this.cpuWait = null; }
        else this.cpuWait = null;
      } else {
        var r = this.gen.next();
        this.spent = 0;
        this.sync();
        if (r.done) { this.halted = true; this.log('info', 'main() returned. On real hardware the CPU would now run off the end of main.'); }
        else if (r.value && r.value.dbg) this.paused = true;
        else if (r.value && r.value.wait) this.cpuWait = r.value;
      }
    }
  } catch (e) {
    this.halted = true;
    this.log(e && e.isFault ? 'fault' : 'error', this.explain(e));
  }
  return this.now >= goal;
};
P.explain = function (e) {
  if (e && e.isFault) return e.message;
  var msg = (e && e.message) || String(e), line = null, m;
  if (e && e.stack && (m = /usercode\.js:(\d+):\d+/.exec(e.stack))) line = +m[1] - 2;
  var pre = line ? 'Line ' + line + ': ' : '';
  if ((m = /^(\w+) is not defined/.exec(msg))) return pre + "'" + m[1] + "' is not declared (or is not part of this simulator's driver library).";
  if ((m = /^(\w+) is not a function/.exec(msg))) return pre + "'" + m[1] + "' is not a function this simulator provides.";
  return pre + msg;
};

return M;
})(typeof MSP !== 'undefined' ? MSP : {});
if (typeof module !== 'undefined') module.exports = MSP;
