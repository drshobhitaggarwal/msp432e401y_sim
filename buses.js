/* MSP432E401Y simulator: I2C0 master, SSI0 (SPI master), bus waveforms, protocol decoder and virtual devices.
   Devices are modelled at transaction level with real timing; the bus lines are still drawn bit by bit in the logic analyzer. */
(function (M) {
'use strict';
var P = M.Sim.prototype;
function hx(v, n) { return (v >>> 0).toString(16).toUpperCase().padStart(n || 2, '0'); }
function u32(x) { return x >>> 0; }

/* ======================================================================================================== */
/* state                                                                                                    */
/* ======================================================================================================== */
P.busReset = function () {
  var S = this, keep = this.dev || {};
  this.i2c = { en: false, tpr: 1, msa: 0, mdr: 0, mdrNext: undefined, busy: false, err: 0, busbsy: false, mris: 0, mimr: 0, lpbk: false, mode: 'tx', ev: null, txn: null, mcr: 0, devs: [] };
  this.ssi = { en: false, cr0: 0, cr1: 0, cpsr: 0, im: 0, ris: 0x8, tx: [], rx: [], shifting: false, fss: false, ev: null, raw: {}, cur: null, lastEnd: 0 };
  this.busLog = []; this.busRev = (this.busRev || 0) + 1; this.busNow = undefined;
  this.wave = { B2: 1, B3: 1, A2: 0, A3: 1, A4: 0, A5: 0, t: 0 };
  this.devSel = {};
  // external memories keep their contents when the MCU restarts; every other device powers up fresh
  this.dev = {};
  ['eeprom', 'seeprom'].forEach(function (k) { if (keep[k]) { keep[k].busyUntil = 0; keep[k].wip = 0; keep[k].wel = false; S.dev[k] = keep[k]; } });
  if (!this._busHook) { this._busHook = true; this.hooks.push(function () { spiCsScan(S); }); }
};
P.busPowerCycle = function () { this.dev = {}; this.busLog = []; this.busRev++; };
function logBus(S, bus, text, err) {
  var a = S.busLog; if (a.length > 400) a.splice(0, 100);
  a.push({ t: S.T(), bus: bus, text: text, err: !!err }); S.busRev = (S.busRev || 0) + 1;
}

/* ---------- waveform helper: edges are recorded for the analyzer, in the future if needed ---------- */
function edge(S, key, t, v) {
  if (S.wave[key] === v) return;
  S.wave[key] = v; S.rec(key, t, v);
}

/* ======================================================================================================== */
/* mods / config                                                                                            */
/* ======================================================================================================== */
M.BUSMODS = ['i2c_tmp', 'i2c_eeprom', 'i2c_lcd', 'i2c_oled', 'spi_eeprom', 'spi_595'];
M.busDefMods = function () {
  return {
    buses:      { pullups: true },
    i2c_tmp:    { on: false, addr: 0x48, temp: 25 },
    i2c_eeprom: { on: false, addr: 0x50 },
    i2c_lcd:    { on: false, addr: 0x27 },
    i2c_oled:   { on: false, addr: 0x3C },
    spi_eeprom: { on: false, cs: 'P4' },
    spi_595:    { on: false, cs: 'P5' }
  };
};
M.busRules = {
  i2c_tmp: { addr: [0x48, 0x49, 0x4A, 0x4B], temp: { min: -40, max: 125 } },
  i2c_eeprom: { addr: [0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57] },
  i2c_lcd: { addr: [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x38, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F] },
  i2c_oled: { addr: [0x3C, 0x3D] }
};
M.busMerge = function (name, def, src) {
  var out = {}, rule = M.busRules[name] || {};
  Object.keys(def).forEach(function (k) {
    var d = def[k], v = src ? src[k] : undefined;
    if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : d;
    else if (typeof d === 'string') out[k] = typeof v === 'string' && (v === '' || M.isPin(v)) ? v : d;
    else if (typeof d === 'number') {
      var r = rule[k];
      if (Array.isArray(r)) out[k] = r.indexOf(v) >= 0 ? v : d;
      else if (r && typeof v === 'number' && v >= r.min && v <= r.max) out[k] = v;
      else out[k] = d;
    } else out[k] = d;
  });
  return out;
};
M.BUSLABEL = { i2c_tmp: 'TMP102 temperature sensor', i2c_eeprom: '24C02 EEPROM', i2c_lcd: 'LCD 16x2 (I2C backpack)', i2c_oled: 'SSD1306 OLED', spi_eeprom: '25LC256 EEPROM', spi_595: '74HC595' };
M.busPins = function (S, add) {
  var m = S.mods; if (!m) return;
  if (S.anyBus('i2c')) { add('I2C bus', 'I2C0 SCL', 'B2'); add('I2C bus', 'I2C0 SDA', 'B3'); }
  var sp = ['spi_eeprom', 'spi_595'].filter(function (n) { return S.busOn(n); });
  if (sp.length) { add('SPI bus', 'SSI0 CLK', 'A2'); add('SPI bus', 'SSI0 MOSI', 'A4'); add('SPI bus', 'SSI0 MISO', 'A5'); }
  sp.forEach(function (n) { add(M.BUSLABEL[n], M.BUSLABEL[n] + ' chip select', m[n].cs); });
};
M.busChecks = function (S) {
  var out = [], m = S.mods; if (!m) return out;
  var seen = {};
  ['i2c_tmp', 'i2c_eeprom', 'i2c_lcd', 'i2c_oled'].forEach(function (n) {
    if (!S.busOn(n)) return;
    var a = m[n].addr;
    if (seen[a]) out.push('The ' + M.BUSLABEL[n] + ' and the ' + seen[a] + ' both answer at I2C address 0x' + hx(a) + ', so they collide on the bus.'); else seen[a] = M.BUSLABEL[n];
  });
  var cs = {};
  ['spi_eeprom', 'spi_595'].forEach(function (n) {
    if (!S.busOn(n)) return;
    var p = m[n].cs;
    if (p && cs[p]) out.push('The ' + M.BUSLABEL[n] + ' and the ' + cs[p] + ' share chip select P' + p + ', so both listen at once.'); else if (p) cs[p] = M.BUSLABEL[n];
  });
  if (S.anyBus('i2c') && !m.buses.pullups) out.push('I2C pull-up resistors are off. Nothing on SDA or SCL can go high.');
  return out;
};
P.busOn = function (name) { return !!(this.mods && this.mods[name] && this.mods[name].on); };
P.anyBus = function (kind) {
  var S = this; return M.BUSMODS.some(function (n) { return n.indexOf(kind) === 0 && S.busOn(n); });
};

/* ======================================================================================================== */
/* I2C devices                                                                                              */
/* ======================================================================================================== */
function dn(S) { return S.busNow !== undefined ? S.busNow : S.T(); }
function devState(S, k, init) { return S.dev[k] || (S.dev[k] = init()); }

/* --- TMP102 style temperature sensor --- */
function tmp102(S) {
  var st = devState(S, 'tmp', function () { return { ptr: 0, cfg: 0x60A0, tlow: 0x4B00, thigh: 0x5000, n: 0 }; });
  var cfgMod = function () { return S.mods.i2c_tmp; };
  function regVal(p) {
    if (p === 0) { var raw = Math.round(cfgMod().temp / 0.0625) & 0xFFF; return (raw << 4) & 0xFFFF; }
    return p === 1 ? st.cfg : p === 2 ? st.tlow : p === 3 ? st.thigh : 0;
  }
  return {
    name: 'TMP102', addr: function () { return cfgMod().addr; },
    start: function (rw) { st.n = 0; st.wr = !rw; return true; },
    write: function (b) {
      if (st.n === 0) { st.ptr = b & 3; st.tmp = 0; }
      else if (st.ptr >= 1) { st.tmp = ((st.tmp << 8) | b) & 0xFFFF; if (st.n === 2) { if (st.ptr === 1) st.cfg = st.tmp; else if (st.ptr === 2) st.tlow = st.tmp; else if (st.ptr === 3) st.thigh = st.tmp; } }
      st.n++; return true;
    },
    read: function () { var v = regVal(st.ptr); var b = st.n % 2 === 0 ? v >> 8 : v & 0xFF; st.n++; return b; },
    stop: function () {}, st: st, regVal: regVal
  };
}

/* --- AT24C02 EEPROM, 256 bytes, 8 byte pages, 5 ms write cycle --- */
function at24c02(S) {
  var st = devState(S, 'eeprom', function () { var m = new Array(256).fill(0xFF); return { mem: m, ptr: 0, n: 0, wr: false, busyUntil: 0, page: [], base: 0, last: '', writes: 0 }; });
  var cfg = function () { return S.mods.i2c_eeprom; };
  return {
    name: 'AT24C02', addr: function () { return cfg().addr; },
    start: function (rw) {
      if (dn(S) < st.busyUntil) return false;                // internal write cycle: no ACK
      st.n = 0; st.wr = !rw; st.page = []; return true;
    },
    write: function (b) {
      if (st.n === 0) { st.ptr = b & 0xFF; st.base = st.ptr & 0xF8; }
      else { st.mem[st.ptr] = b & 0xFF; st.ptr = st.base + ((st.ptr + 1) & 7); st.page.push(b); }
      st.n++; return true;
    },
    read: function () { var b = st.mem[st.ptr]; st.ptr = (st.ptr + 1) & 0xFF; return b; },
    stop: function () {
      if (st.wr && st.page.length) { st.busyUntil = dn(S) + 0.005; st.writes++; st.last = st.page.length + ' byte' + (st.page.length > 1 ? 's' : '') + ' written'; }
    }, st: st
  };
}

/* --- HD44780 16x2 behind a PCF8574 backpack --- */
function lcd1602(S) {
  var st = devState(S, 'lcd', function () {
    return { ddram: new Array(80).fill(0x20), cgram: new Array(64).fill(0), ac: 0, cg: false, is4: false, hi: -1, bl: false, on: false, cur: false, blink: false, id: 1, sh: 0, shiftOff: 0,
             lines2: true, lastE: 0, busyUntil: 0, inited: false, drops: 0, note: '', port: 0, fs: 0, rev: 0 };
  });
  var cfg = function () { return S.mods.i2c_lcd; };
  function busy(us) { st.busyUntil = dn(S) + us * 1e-6; }
  function inc() {
    if (st.cg) st.ac = (st.ac + (st.id ? 1 : -1)) & 63;
    else st.ac = (st.ac + (st.id ? 1 : -1) + 80) % 80;
  }
  function instr(v) {
    var now = dn(S);
    if (now < st.busyUntil - 1e-9) { st.drops++; st.note = 'Instruction 0x' + hx(v) + ' arrived while the LCD was busy and was lost. Wait 37 us after most commands, 1.52 ms after clear/home.'; S.warn('lcdbusy', 'LCD: ' + st.note); return; }
    if (v & 0x80) { st.cg = false; st.ac = v & 0x7F; if (st.ac >= 0x40) st.ac = 40 + (st.ac - 0x40); else if (st.ac > 39) st.ac = 39; busy(37); }
    else if (v & 0x40) { st.cg = true; st.ac = v & 63; busy(37); }
    else if (v & 0x20) { st.lines2 = !!(v & 8); st.fs = v; st.inited = true; busy(37); }
    else if (v & 0x10) { var sc = v & 8, rl = v & 4; if (sc) st.shiftOff = (st.shiftOff + (rl ? 1 : -1) + 40) % 40; else st.ac = (st.ac + (rl ? 1 : -1) + 80) % 80; busy(37); }
    else if (v & 0x08) { st.on = !!(v & 4); st.cur = !!(v & 2); st.blink = !!(v & 1); busy(37); }
    else if (v & 0x04) { st.id = (v & 2) ? 1 : 0; st.sh = v & 1; busy(37); }
    else if (v & 0x02) { st.ac = 0; st.shiftOff = 0; busy(1520); }
    else if (v & 0x01) { for (var i = 0; i < 80; i++) st.ddram[i] = 0x20; st.ac = 0; st.id = 1; st.shiftOff = 0; busy(1520); }
    st.rev++;
  }
  function data(v) {
    var now = dn(S);
    if (now < st.busyUntil - 1e-9) { st.drops++; st.note = 'A character (0x' + hx(v) + ') arrived while the LCD was busy and was lost.'; S.warn('lcdbusy', 'LCD: ' + st.note); return; }
    if (st.cg) st.cgram[st.ac & 63] = v & 0x1F; else st.ddram[st.ac] = v;
    inc(); busy(43); st.rev++;
  }
  function byteIn(rs, v) { if (rs) data(v); else instr(v); }
  function nibble(rs, n) {                                    // one latched nibble (E falling edge)
    if (!st.is4) {                                            // power-on state: 8-bit interface, only D7-D4 wired
      var v = n << 4;
      if ((v & 0xF0) === 0x30) { busy(4100); return; }          // function set, 8 bit
      if (v === 0x20) { st.is4 = true; st.hi = -1; busy(37); return; }
      return;
    }
    if (st.hi < 0) st.hi = n; else { var b = (st.hi << 4) | n; st.hi = -1; byteIn(rs, b); }
  }
  return {
    name: 'HD44780 via PCF8574', addr: function () { return cfg().addr; },
    start: function () { return true; },
    write: function (b) {
      var e = (b >> 2) & 1, rs = b & 1, rw = (b >> 1) & 1;
      st.bl = !!(b & 8); st.port = b;
      if (st.lastE && !e && !rw) nibble(rs, (b >> 4) & 15);
      st.lastE = e; st.rev++; return true;
    },
    read: function () { return st.port; },
    stop: function () {}, st: st
  };
}

/* --- SSD1306 128x64 OLED --- */
function ssd1306(S) {
  var st = devState(S, 'oled', function () {
    return { fb: new Array(1024).fill(0), mode: 2, col: 0, page: 0, c0: 0, c1: 127, p0: 0, p1: 7, on: false, pump: false, contrast: 0x7F, inv: false, allOn: false, remap: false, comScan: false,
             startLine: 0, ctl: -1, co: false, dc: 0, args: [], need: 0, op: 0, rev: 0, cmds: 0, bytes: 0 };
  });
  var cfg = function () { return S.mods.i2c_oled; };
  var ONE = { 0x20: 1, 0x81: 1, 0x8D: 1, 0xA8: 1, 0xD3: 1, 0xD5: 1, 0xD9: 1, 0xDA: 1, 0xDB: 1, 0xAD: 1 }, TWO = { 0x21: 2, 0x22: 2 };
  function cmd(b) {
    st.cmds++;
    if (st.need > 0) {
      st.args.push(b); st.need--;
      if (st.need === 0) {
        var a = st.args, o = st.op;
        if (o === 0x20) st.mode = a[0] & 3;
        else if (o === 0x21) { st.c0 = a[0] & 127; st.c1 = a[1] & 127; st.col = st.c0; }
        else if (o === 0x22) { st.p0 = a[0] & 7; st.p1 = a[1] & 7; st.page = st.p0; }
        else if (o === 0x81) st.contrast = a[0];
        else if (o === 0x8D) st.pump = (a[0] & 0x14) === 0x14;
        st.rev++;
      }
      return;
    }
    if (ONE[b]) { st.need = 1; st.op = b; st.args = []; return; }
    if (TWO[b]) { st.need = 2; st.op = b; st.args = []; return; }
    if (b === 0xAE) st.on = false; else if (b === 0xAF) st.on = true;
    else if (b === 0xA4) st.allOn = false; else if (b === 0xA5) st.allOn = true;
    else if (b === 0xA6) st.inv = false; else if (b === 0xA7) st.inv = true;
    else if (b === 0xA0) st.remap = false; else if (b === 0xA1) st.remap = true;
    else if (b === 0xC0) st.comScan = false; else if (b === 0xC8) st.comScan = true;
    else if (b >= 0xB0 && b <= 0xB7) st.page = b & 7;
    else if (b <= 0x0F) st.col = (st.col & 0xF0) | b;
    else if (b >= 0x10 && b <= 0x1F) st.col = (st.col & 0x0F) | ((b & 15) << 4);
    else if (b >= 0x40 && b <= 0x7F) st.startLine = b & 63;
    st.rev++;
  }
  function data(b) {
    st.bytes++;
    st.fb[st.page * 128 + st.col] = b & 0xFF;
    if (st.mode === 2) { st.col = (st.col + 1) & 127; }
    else if (st.mode === 0) { st.col++; if (st.col > st.c1) { st.col = st.c0; st.page++; if (st.page > st.p1) st.page = st.p0; } }
    else { st.page++; if (st.page > st.p1) { st.page = st.p0; st.col++; if (st.col > st.c1) st.col = st.c0; } }
    st.rev++;
  }
  return {
    name: 'SSD1306', addr: function () { return cfg().addr; },
    start: function () { st.ctl = -1; st.co = false; return true; },
    write: function (b) {
      if (st.ctl === -1) { st.ctl = b; st.co = !!(b & 0x80); st.dc = (b >> 6) & 1; return true; }
      if (st.dc) data(b); else cmd(b);
      if (st.co) st.ctl = -1;
      return true;
    },
    read: function () { return 0x00; },
    stop: function () {}, st: st
  };
}

function i2cDevices(S) {
  var out = [];
  if (S.busOn('i2c_tmp')) out.push(tmp102(S));
  if (S.busOn('i2c_eeprom')) out.push(at24c02(S));
  if (S.busOn('i2c_lcd')) out.push(lcd1602(S));
  if (S.busOn('i2c_oled')) out.push(ssd1306(S));
  return out;
}
P.busDevice = function (name) {
  return { i2c_tmp: tmp102, i2c_eeprom: at24c02, i2c_lcd: lcd1602, i2c_oled: ssd1306, spi_eeprom: eeprom25lc256, spi_595: hc595 }[name](this);
};

/* ======================================================================================================== */
/* I2C master                                                                                               */
/* ======================================================================================================== */
var I2C_ERR_ADDR = 4, I2C_ERR_DATA = 8, I2C_ERR_ARB = 16;
function i2cF(S) { var tp = S.i2c.tpr; return S.clk / (20 * (tp + 1)); }
function i2cPinsOk(S) {
  var pb = S.gpio.B, msgs = [];
  if (!(pb.alt[2] === 'i2c0scl')) msgs.push('PB2 is not set up as I2C0SCL (GPIOPinConfigure(GPIO_PB2_I2C0SCL) + GPIOPinTypeI2CSCL, or AFSEL bit 2 and PCTL = 2)');
  if (!(pb.alt[3] === 'i2c0sda')) msgs.push('PB3 is not set up as I2C0SDA (GPIOPinConfigure(GPIO_PB3_I2C0SDA) + GPIOPinTypeI2C, or AFSEL bit 3 and PCTL = 2)');
  else if (!(pb.raw[0x50C] & 8)) msgs.push('PB3 (SDA) must be open-drain: GPIOPinTypeI2C sets it, or set bit 3 of GPIO_PORTB_AHB->ODR');
  if (S.mods && S.mods.buses && !S.mods.buses.pullups) msgs.push('SDA and SCL have no pull-up resistors (turn the pull-ups on in Bus settings, or add 4.7 kOhm to 3.3 V)');
  return msgs;
}
function wcur(S, t) { var w = S.wave; return Math.max(w.t, t); }
function i2cWave(S, kind, t, T, val, ack) {      // writes SCL/SDA edges starting at t, returns end time
  var w = S.wave;
  if (kind === 'start' || kind === 'rstart') {
    if (kind === 'rstart') { edge(S, 'B3', t, 1); edge(S, 'B2', t + 0.25 * T, 1); t += 0.5 * T; }
    edge(S, 'B3', t, 0); edge(S, 'B2', t + 0.25 * T, 0); return t + 0.5 * T;
  }
  if (kind === 'stop') { edge(S, 'B3', t, 0); edge(S, 'B2', t + 0.25 * T, 1); edge(S, 'B3', t + 0.5 * T, 1); return t + 0.75 * T; }
  for (var k = 0; k < 9; k++) {                  // 8 data bits + ack
    var bit = k < 8 ? (val >> (7 - k)) & 1 : (ack ? 0 : 1), tb = t + k * T;
    edge(S, 'B3', tb + 0.05 * T, bit); edge(S, 'B2', tb + 0.3 * T, 1); edge(S, 'B2', tb + 0.8 * T, 0);
  }
  return t + 9 * T;
}
function i2cFinish(S, t) {
  var c = S.i2c; c.busy = false; c.mris |= 1; S.touch();
}
function i2cAddrAck(S, addr, rw) {
  var devs = i2cDevices(S), ack = false, got = [];
  devs.forEach(function (d) { if (d.addr() === addr) { if (d.start(rw)) { ack = true; got.push(d); } } });
  return { ack: ack, devs: got, found: devs.some(function (d) { return d.addr() === addr; }) };
}
P.i2cCmd = function (cmd) {
  var S = this, c = this.i2c;
  if (!S.periph.I2C0) S.fault('Bus fault: an I2C0 register was accessed while its clock is off. Set bit 0 of SYSCTL_RCGCI2C_R (SYSCTL->RCGCI2C) or call SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0).');
  if (!c.en) { S.warn('i2cen', 'I2C0 master is not enabled (I2CMasterEnable, or MCR bit 4). The command was ignored.'); return; }
  if (c.busy) { S.warn('i2cbusy', 'I2C0: a command was written while BUSY was set. Poll I2CMasterBusy() before the next command. The command was ignored.'); return; }
  var RUN = cmd & 1, START = (cmd >> 1) & 1, STOP = (cmd >> 2) & 1, ACK = (cmd >> 3) & 1;
  var t0 = S.T(), T = 1 / i2cF(S), t = Math.max(t0, S.wave.t);
  if (!RUN) {                                    // STOP only: releases the bus after an error
    if (STOP && c.busbsy) S.i2cStop(t, T);
    return;
  }
  var txn = c.txn || (c.txn = { t: t0, parts: [], err: false });
  c.err = 0; c.busy = true;
  var devs = c.devs || [], endT = t, pins = i2cPinsOk(S);
  if (START) {
    var rs = c.busbsy, addr = c.msa >> 1, rw = c.msa & 1;
    if (!rs) { txn = c.txn = { t: t0, parts: [], err: false }; }
    endT = i2cWave(S, rs ? 'rstart' : 'start', endT, T);
    S.busNow = endT + 9 * T;
    var res = pins.length ? { ack: false, devs: [], found: false } : i2cAddrAck(S, addr, rw);
    S.busNow = undefined;
    endT = i2cWave(S, 'byte', endT, T, c.msa & 0xFF, res.ack);
    txn.parts.push((rs ? 'Sr ' : 'S ') + '0x' + hx(addr) + (rw ? ' R' : ' W') + (res.ack ? ' ACK' : ' NACK'));
    c.busbsy = true; c.mode = rw ? 'rx' : 'tx'; c.devs = devs = res.devs;
    if (res.devs.length) txn.dev = res.devs.map(function (d) { return d.name; }).join(' + ');
    if (!res.ack) {
      c.err = I2C_ERR_ADDR; txn.err = true;
      if (pins.length) S.warn('i2cpins', 'I2C0: nothing can reach the bus. ' + pins.join('. ') + '.');
      else S.warn('i2cnack', 'I2C0: no device acknowledged address 0x' + hx(addr) + ' (' + (res.found ? 'the device is busy, for example in its internal write cycle' : 'check the 7-bit address; the simulator shows 0x' + hx(addr) + ' here, and the MSA register holds it shifted left by one with the R/S bit in bit 0') + '). Only the first NACK is reported here; the bus decoder lists every one.');
      if (STOP) { endT = i2cWave(S, 'stop', endT, T); txn.parts.push('P'); S.i2cEndTxn(); c.busbsy = false; c.devs = []; }
      S.i2cSchedule(endT);
      return;
    }
  } else if (!c.busbsy) {
    S.warn('i2cnostart', 'I2C0: a command without START was issued while the bus is idle. Begin with a command that has START, for example I2C_MASTER_CMD_BURST_SEND_START.');
    c.busy = false; return;
  }
  if (c.mode === 'tx') {
    var b = c.mdr & 0xFF, ack = true;
    S.busNow = endT + 9 * T;
    devs.forEach(function (d) { if (!d.write(b)) ack = false; });
    S.busNow = undefined;
    endT = i2cWave(S, 'byte', endT, T, b, ack);
    txn.parts.push('0x' + hx(b) + (ack ? ' ACK' : ' NACK'));
    if (!ack) { c.err = I2C_ERR_DATA; txn.err = true; }
  } else {
    var v = 0xFF;
    S.busNow = endT + 9 * T;
    devs.forEach(function (d) { v &= d.read(); });
    S.busNow = undefined;
    c.mdrNext = v & 0xFF;
    endT = i2cWave(S, 'byte', endT, T, v, ACK);
    txn.parts.push('0x' + hx(v) + (ACK ? ' ACK' : ' NACK'));
  }
  if (STOP) {
    endT = i2cWave(S, 'stop', endT, T); txn.parts.push('P');
    S.busNow = endT; devs.forEach(function (d) { d.stop(); }); S.busNow = undefined;
    S.i2cEndTxn(); c.busbsy = false; c.devs = [];
  }
  S.i2cSchedule(endT);
};
P.i2cStop = function (t, T) {
  var c = this.i2c, endT = i2cWave(this, 'stop', t, T);
  if (c.txn) { c.txn.parts.push('P'); this.i2cEndTxn(); }
  this.busNow = endT; (c.devs || []).forEach(function (d) { d.stop(); }); this.busNow = undefined;
  c.busbsy = false; c.devs = []; this.wave.t = endT;
};
P.i2cEndTxn = function () {
  var c = this.i2c, x = c.txn; if (!x) return;
  var pp = x.parts;
  if (pp.length > 24) pp = pp.slice(0, 14).concat(['\u2026 ' + (pp.length - 17) + ' more bytes \u2026'], pp.slice(-3));
  logBus(this, 'I2C0', pp.join('  ') + (x.dev ? '   ' + x.dev : ''), x.err);
  c.txn = null;
};
P.i2cSchedule = function (endT) {
  var S = this, c = this.i2c; S.wave.t = endT;
  S.cancel(c.ev);
  c.ev = S.at(endT, function () {
    if (c.mode === 'rx' && c.mdrNext !== undefined) { c.mdr = c.mdrNext; c.mdrNext = undefined; }
    i2cFinish(S, endT);
  });
};

/* ======================================================================================================== */
/* SSI (SPI) master                                                                                         */
/* ======================================================================================================== */
function ssiBits(c) { return (c.cr0 & 15) + 1; }
function ssiRate(S) { var c = S.ssi, d = (c.cpsr & 0xFE) || 2, scr = (c.cr0 >> 8) & 0xFF; return S.clk / (d * (1 + scr)); }
function ssiMode(c) { return (((c.cr0 >> 6) & 1) << 1) | ((c.cr0 >> 7) & 1); }   // standard SPI mode number: CPOL*2 + CPHA (SPO = CR0 bit 6, SPH = CR0 bit 7)
function ssiPinsOk(S) {
  var pa = S.gpio.A, miss = [];
  [['A', 2, 'ssi0clk', 'SSI0CLK'], ['A', 4, 'ssi0mosi', 'SSI0XDAT0 (MOSI)'], ['A', 5, 'ssi0miso', 'SSI0XDAT1 (MISO)']].forEach(function (d) { if (pa.alt[d[1]] !== d[2]) miss.push('PA' + d[1] + ' (' + d[3] + ')'); });
  return miss;
}

/* --- SPI devices --- */
function eeprom25lc256(S) {
  var st = devState(S, 'seeprom', function () { return { mem: new Array(32768).fill(0xFF), wel: false, wip: 0, sr: 0, n: 0, op: 0, addr: 0, buf: [], last: '', writes: 0 }; });
  var cfg = function () { return S.mods.spi_eeprom; };
  function sr() { var wip = dn(S) < st.wip; return (wip ? 1 : 0) | (st.wel ? 2 : 0); }
  return {
    name: '25LC256', cs: function () { return cfg().cs; },
    select: function () { st.n = 0; st.buf = []; },
    xfer: function (b, mode) {
      if (mode !== 0 && mode !== 3) return 0xFF;                       // needs CPOL/CPHA = 0/0 or 1/1
      var out = 0xFF, n = st.n++;
      if (n === 0) { st.op = b; if (b === 0x06) st.wel = true; else if (b === 0x04) st.wel = false; }
      else if (st.op === 0x05) out = sr();
      else if (st.op === 0x03) { if (n === 1) st.addr = (b << 8); else if (n === 2) { st.addr |= b; } else { out = st.mem[st.addr & 0x7FFF]; st.addr = (st.addr + 1) & 0x7FFF; } if (n === 2) {} }
      else if (st.op === 0x02) { if (n === 1) st.addr = (b << 8); else if (n === 2) st.addr |= b; else st.buf.push(b); }
      else if (st.op === 0x01 && n === 1) { st.sr = b; }
      if (st.op === 0x03 && n === 2) out = 0xFF;
      return out;
    },
    deselect: function () {
      if (st.op === 0x06 || st.op === 0x04) return;
      if (st.op === 0x02 && st.n >= 4) {
        if (dn(S) < st.wip) { S.warn('eewip', '25LC256: a WRITE was sent while the previous write was still in progress (WIP). It was ignored. Poll the status register (RDSR) first.'); return; }
        if (!st.wel) { S.warn('eewel', '25LC256: WRITE ignored because the write latch is not set. Send WREN (0x06) in its own chip-select frame before every WRITE.'); return; }
        var page = st.addr & ~63, a = st.addr;
        st.buf.forEach(function (v) { st.mem[a & 0x7FFF] = v; a = page + ((a + 1) & 63); });
        st.wip = dn(S) + 0.005; st.wel = false; st.writes++; st.last = st.buf.length + ' bytes at 0x' + hx(st.addr, 4);
      }
    }, st: st
  };
}
function hc595(S) {
  var st = devState(S, 'h595', function () { return { shift: 0, out: 0, n: 0, latches: 0 }; });
  var cfg = function () { return S.mods.spi_595; };
  return {
    name: '74HC595', cs: function () { return cfg().cs; },
    select: function () { st.n = 0; },
    xfer: function (b, mode) {
      var prev = st.shift;
      if (mode === 0 || mode === 3) { st.shift = b & 0xFF; st.n++; }       // samples on the rising clock edge
      else { st.shift = (b >> 1) & 0x7F; st.bad = true; }
      return prev;                                                         // QH' chain output is the previous byte (not wired back)
    },
    deselect: function () { if (st.n) { st.out = st.shift; st.latches++; S.touch(); } },   // RCLK is tied to chip select: latches on the rising edge
    st: st
  };
}
function spiDevices(S) {
  var out = [];
  if (S.busOn('spi_eeprom')) out.push(eeprom25lc256(S));
  if (S.busOn('spi_595')) out.push(hc595(S));
  return out;
}
function csLow(S, d) {
  var pin = d.cs();
  if (!M.isPin(pin)) return false;
  var p = S.gpio[pin[0]], b = +pin[1];
  if (p.alt[b] === 'ssi0fss') return !!S.ssi.fss;
  return !!(S.driven(pin) && !p.dig[b] && !p.alt[b]);
}
function spiCsScan(S) {
  if (!S.mods || !S.devSel) return;
  spiDevices(S).forEach(function (d) {
    var key = d.name, low = csLow(S, d), was = !!S.devSel[key];
    if (low && !was) { S.devSel[key] = d; d.select(); S.spiCsEdge(d, true); }
    else if (!low && was) {
      delete S.devSel[key];
      if ((S.ssi.shifting || S.ssi.tx.length) && !S.ssi.fss) S.warn('spicsearly', 'SPI: chip select for ' + d.name + ' went inactive while SSI0 was still sending (SSIBusy() was 1). On real hardware the last byte is cut off. Wait for SSIBusy() to return 0 before raising chip select.');
      d.deselect(); S.spiCsEdge(d, false);
    }
  });
}
P.spiCsEdge = function (d, low) {
  var S = this, c = S.ssi;
  if (low) { c.cur = { t: S.T(), dev: d.name, mosi: [], miso: [] }; }
  else if (c.cur) {
    var x = c.cur; c.cur = null;
    if (x.mosi.length) logBus(S, 'SSI0', 'CS↓ ' + x.dev + '  MOSI ' + x.mosi.map(function (v) { return hx(v, x.w || 2); }).join(' ') + '  MISO ' + x.miso.map(function (v) { return hx(v, x.w || 2); }).join(' ') + '  CS↑');
  }
};
P.ssiKick = function (tStart) {
  var S = this, c = this.ssi;
  if (c.shifting || !c.en || !c.tx.length) return;
  var bits = ssiBits(c), rate = ssiRate(S), bt = 1 / rate, fT = bits * bt, mode = ssiMode(c), word = c.tx.shift();
  var t0 = tStart !== undefined ? Math.max(tStart, c.lastEnd) : Math.max(S.T(), c.lastEnd), tEnd;
  c.shifting = true; tEnd = t0 + fT;
  if ((c.cpsr & 0xFE) < 2) S.warn('ssicpsr0', 'SSI0: the clock prescale register (CPSR) is 0, which is not a valid divisor (even, 2 to 254). The simulator uses 2. Use SSIConfigSetExpClk, or write CPSR yourself.');
  if ((c.cr0 & 0xF) < 3) S.warn('ssidss', 'SSI0: the data size field (DSS) in CR0 is below 4 bits. Use 8 for bytes (SSIConfigSetExpClk width argument).');
  if ((c.cr0 & 0x30) !== 0) S.warn('ssifrf', 'SSI0: only the Freescale SPI frame format (FRF = 0) is simulated. TI and Microwire frames behave like SPI here.');
  if (c.cr1 & 4) S.warn('ssislave', 'SSI0: slave mode is not simulated.');
  var loop = !!(c.cr1 & 1), miss = ssiPinsOk(S);
  if (miss.length && !loop) S.warn('ssipins', 'SSI0: ' + miss.join(', ') + ' not set up for SSI. Use GPIOPinConfigure(GPIO_PA2_SSI0CLK, GPIO_PA4_SSI0XDAT0, GPIO_PA5_SSI0XDAT1) with GPIOPinTypeSSI, or AFSEL and PCTL = 15.');
  var hwFss = S.gpio.A.alt[3] === 'ssi0fss';
  if (hwFss && !c.fss) { c.fss = true; edge(S, 'A3', t0, 0); spiCsScan(S); }
  var cpol = (mode >> 1) & 1, cpha = mode & 1, data = word & ((1 << bits) - 1), miso = (1 << bits) - 1, k;
  var sel = Object.keys(S.devSel).map(function (n) { return S.devSel[n]; });
  if (loop) miso = data;
  else if (sel.length) {
    var bytes = bits > 8 ? 2 : 1, outv = 0;
    S.busNow = tEnd;
    for (var bi = 0; bi < bytes; bi++) {
      var sh = bits > 8 ? Math.max(0, bits - 8 * (bi + 1)) : 0, mb = (data >> sh) & 0xFF, r = 0xFF;
      sel.forEach(function (d) { r &= d.xfer(mb, mode); });
      outv = (outv << 8) | r;
    }
    S.busNow = undefined;
    miso = (bytes === 2 ? outv : outv & 0xFF) & ((1 << bits) - 1);
  }
  edge(S, 'A2', t0, cpol);
  for (k = 0; k < bits; k++) {
    var tb = t0 + k * bt, sb = bits - 1 - k, td = tb + (cpha ? 0.5 * bt : 0);
    edge(S, 'A4', td, (data >> sb) & 1);
    edge(S, 'A5', td, (miso >> sb) & 1);
    edge(S, 'A2', tb + 0.25 * bt, cpol ^ 1); edge(S, 'A2', tb + 0.75 * bt, cpol);
  }
  var w4 = bits > 8 ? 4 : 2;
  if (c.cur) { c.cur.mosi.push(data); c.cur.miso.push(miso); c.cur.w = w4; }
  else if (loop) logBus(S, 'SSI0', 'loopback  ' + hx(data, w4), false);
  else if (!sel.length) logBus(S, 'SSI0', 'no chip selected  MOSI ' + hx(data, w4) + (mode ? '  (SPI mode ' + mode + ')' : ''), false);
  c.ev = S.at(tEnd, function (te) {
    c.shifting = false; c.lastEnd = te;
    if (c.rx.length >= 8) c.ris |= 1; else c.rx.push(miso);
    if (c.rx.length >= 4) c.ris |= 4;
    if (hwFss && !cpha) {                       // SPH = 0: the frame signal returns high between words
      c.fss = false; edge(S, 'A3', te, 1); spiCsScan(S);
      if (c.tx.length) {
        S.warn('ssifssgap', 'SSI0: with SPH = 0 (SPI mode 0 or 2) the hardware frame-select pin goes high between every word, so a device sees each byte as a separate transaction. Use mode 1 or 3 (SSI_FRF_MOTO_MODE_3), or drive chip select from a GPIO pin.');
        S.ssiKick(te + bt);
      }
    } else if (c.tx.length) S.ssiKick(te);
    else if (hwFss) { c.fss = false; edge(S, 'A3', te, 1); spiCsScan(S); }
    if (c.tx.length <= 4) c.ris |= 8;
    S.touch();
  });
  if (c.tx.length > 4) c.ris &= ~8;
};
P.ssiPut = function (v) {
  var c = this.ssi;
  if (!this.periph.SSI0) this.fault('Bus fault: an SSI0 register was accessed while its clock is off. Set bit 0 of SYSCTL_RCGCSSI_R (SYSCTL->RCGCSSI) or call SysCtlPeripheralEnable(SYSCTL_PERIPH_SSI0).');
  if (!c.en) this.warn('ssien', 'SSI0 is not enabled (SSIEnable, or CR1 bit 1 = SSE). Data written to the FIFO is held and sent once it is enabled.');
  if (c.tx.length >= 8) { this.warn('ssitxfull', 'SSI0: data written while the TX FIFO was full (SR.TNF = 0) was lost. Check SR bit 1 first, or use SSIDataPut, which waits.'); return; }
  c.tx.push(v & 0xFFFF);
  if (c.tx.length > 4) c.ris &= ~8;
  this.ssiKick();
};
P.ssiStatus = function () {
  var c = this.ssi; this.sync();
  return (c.tx.length === 0 ? 1 : 0) | (c.tx.length < 8 ? 2 : 0) | (c.rx.length ? 4 : 0) | (c.rx.length >= 8 ? 8 : 0) | ((c.shifting || c.tx.length) ? 0x10 : 0);
};
P.ssiGet = function () {
  var c = this.ssi; this.sync();
  if (!c.rx.length) return 0;
  var v = c.rx.shift(); if (c.rx.length < 4) c.ris &= ~4; return v;
};

/* ======================================================================================================== */
/* hooks used by core                                                                                       */
/* ======================================================================================================== */
function lvlAt(S, key, t, def) {
  var a = S.tr[key]; if (!a || !a.length) return def;
  var lo = 0, hi = a.length;
  while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid][0] <= t) lo = mid + 1; else hi = mid; }
  return lo ? a[lo - 1][1] : def;
}
P.altLevel = function (alt) {
  var t = this.T();
  switch (alt) {
    case 'i2c0scl': return lvlAt(this, 'B2', t, 1);
    case 'i2c0sda': return lvlAt(this, 'B3', t, 1);
    case 'ssi0clk': return lvlAt(this, 'A2', t, 0);
    case 'ssi0mosi': return lvlAt(this, 'A4', t, 0);
    case 'ssi0miso': return lvlAt(this, 'A5', t, 0);
    case 'ssi0fss': return lvlAt(this, 'A3', t, 1);
    default: return 1;
  }
};
P.busIrq = function (name) {
  if (name === 'i2c0') return !!(this.i2c && (this.i2c.mris & this.i2c.mimr & 1));
  if (name === 'ssi0') return !!(this.ssi && (this.ssi.ris & this.ssi.im & 15));
  return false;
};

/* ======================================================================================================== */
/* register blocks                                                                                          */
/* ======================================================================================================== */
(function () {
  var R = M.R, rawR = M.rawR;
  function need(S, k, what) { if (!S.periph[k]) S.fault('Bus fault: ' + what + ' was accessed while its clock is off. Set the ' + k + ' bit in SYSCTL->RCGC' + k.replace(/\d+$/, '') + ' first.'); }
  var i2 = [
    R(0x000, 'MSA', { g: function (S) { return S.i2c.msa; }, s: function (S, I, v) { need(S, 'I2C0', 'an I2C0 register'); S.i2c.msa = v & 0xFF; } }),
    R(0x004, 'MCS', {
      g: function (S, I, peek) { if (!peek) S.sync(); var c = S.i2c; return (c.busy ? 1 : 0) | (c.err ? 2 : 0) | (c.err & I2C_ERR_ADDR ? 4 : 0) | (c.err & I2C_ERR_DATA ? 8 : 0) | (c.err & I2C_ERR_ARB ? 16 : 0) | (c.busy ? 0 : 0x20) | (c.busbsy ? 0x40 : 0); },
      s: function (S, I, v) { need(S, 'I2C0', 'an I2C0 register'); S.i2cCmd(v & 0x7F); }
    }),
    R(0x008, 'MDR', { g: function (S, I, peek) { if (!peek) S.sync(); return S.i2c.mdr; }, s: function (S, I, v) { need(S, 'I2C0', 'an I2C0 register'); S.i2c.mdr = v & 0xFF; } }),
    R(0x00C, 'MTPR', { g: function (S) { return S.i2c.tpr; }, s: function (S, I, v) { S.i2c.tpr = v & 0x7F; } }),
    R(0x010, 'MIMR', { g: function (S) { return S.i2c.mimr; }, s: function (S, I, v) { S.i2c.mimr = v & 3; S.touch(); } }),
    R(0x014, 'MRIS', { g: function (S, I, peek) { if (!peek) S.sync(); return S.i2c.mris; }, s: null }),
    R(0x018, 'MMIS', { g: function (S, I, peek) { if (!peek) S.sync(); return S.i2c.mris & S.i2c.mimr; }, s: null }),
    R(0x01C, 'MICR', { g: function () { return 0; }, s: function (S, I, v) { S.i2c.mris &= ~v; S.touch(); } }),
    R(0x020, 'MCR', { g: function (S) { return S.i2c.mcr; }, s: function (S, I, v) { need(S, 'I2C0', 'an I2C0 register'); S.i2c.mcr = v & 0x31; S.i2c.en = !!(v & 0x10); S.i2c.lpbk = !!(v & 1); } }),
    rawR('I2C0', 0x024, 'MCLKOCNT', 0),
    R(0x02C, 'MBMON', { g: function (S) { var pu = !S.mods || !S.mods.buses || S.mods.buses.pullups; return pu ? 3 : 0; }, s: null }),
    rawR('I2C0', 0x800, 'SOAR', 0), rawR('I2C0', 0x804, 'SCSR', 0), rawR('I2C0', 0x808, 'SDR', 0), rawR('I2C0', 0x80C, 'SIMR', 0), rawR('I2C0', 0x810, 'SRIS', 0), rawR('I2C0', 0x814, 'SMIS', 0), rawR('I2C0', 0x818, 'SICR', 0),
    rawR('I2C0', 0xFC0, 'PP', 0x1), rawR('I2C0', 0xFC4, 'PC', 0x1)
  ];
  M.addRegBlock({ id: 'I2C0', title: 'I2C0 (master)', base: 0x40020000, size: 0x1000, I: 0, prefixes: ['I2C0'], regs: i2 });
  var ss = [
    R(0x000, 'CR0', { g: function (S) { return S.ssi.cr0; }, s: function (S, I, v) { need(S, 'SSI0', 'an SSI0 register'); S.ssi.cr0 = v & 0xFFFF; } }),
    R(0x004, 'CR1', { g: function (S) { return S.ssi.cr1; }, s: function (S, I, v) { need(S, 'SSI0', 'an SSI0 register'); var c = S.ssi; c.cr1 = v & 0xF; c.en = !!(v & 2); if (c.en) S.ssiKick(); } }),
    R(0x008, 'DR', { g: function (S, I, peek) { if (peek) { return S.ssi.rx.length ? S.ssi.rx[0] : 0; } return S.ssiGet(); }, s: function (S, I, v) { S.ssiPut(v); } }),
    R(0x00C, 'SR', { g: function (S, I, peek) { if (peek) { var c = S.ssi; return (c.tx.length === 0 ? 1 : 0) | (c.tx.length < 8 ? 2 : 0) | (c.rx.length ? 4 : 0) | (c.rx.length >= 8 ? 8 : 0) | ((c.shifting || c.tx.length) ? 0x10 : 0); } return S.ssiStatus(); }, s: null }),
    R(0x010, 'CPSR', { g: function (S) { return S.ssi.cpsr; }, s: function (S, I, v) { need(S, 'SSI0', 'an SSI0 register'); S.ssi.cpsr = v & 0xFF; if (v & 1) S.warn('ssicpsr', 'SSI0: CPSDVSR must be an even number from 2 to 254.'); } }),
    R(0x014, 'IM', { g: function (S) { return S.ssi.im; }, s: function (S, I, v) { S.ssi.im = v & 15; S.touch(); } }),
    R(0x018, 'RIS', { g: function (S, I, peek) { if (!peek) S.sync(); return S.ssi.ris; }, s: null }),
    R(0x01C, 'MIS', { g: function (S, I, peek) { if (!peek) S.sync(); return S.ssi.ris & S.ssi.im; }, s: null }),
    R(0x020, 'ICR', { g: function () { return 0; }, s: function (S, I, v) { S.ssi.ris &= ~(v & 3); S.touch(); } }),
    rawR('SSI0', 0x024, 'DMACTL', 0),
    R(0xFC8, 'CC', { g: function (S) { return S.ssi.raw.cc || 0; }, s: function (S, I, v) { S.ssi.raw.cc = v & 15; } })
  ];
  M.addRegBlock({ id: 'SSI0', title: 'SSI0 (SPI master)', base: 0x40008000, size: 0x1000, I: 0, prefixes: ['SSI0'], regs: ss });
})();

/* ======================================================================================================== */
/* DriverLib API                                                                                            */
/* ======================================================================================================== */
M.busConsts = function (K) {
  K.I2C0_BASE = 0x40020000; K.SYSCTL_PERIPH_I2C0 = 0xf0002000; K.SSI0_BASE = 0x40008000; K.SYSCTL_PERIPH_SSI0 = 0xf0001c00;
  K.I2C_MASTER_CMD_SINGLE_SEND = 0x07; K.I2C_MASTER_CMD_SINGLE_RECEIVE = 0x07; K.I2C_MASTER_CMD_BURST_SEND_START = 0x03; K.I2C_MASTER_CMD_BURST_SEND_CONT = 0x01;
  K.I2C_MASTER_CMD_BURST_SEND_FINISH = 0x05; K.I2C_MASTER_CMD_BURST_SEND_STOP = 0x05; K.I2C_MASTER_CMD_BURST_SEND_ERROR_STOP = 0x04;
  K.I2C_MASTER_CMD_BURST_RECEIVE_START = 0x0B; K.I2C_MASTER_CMD_BURST_RECEIVE_CONT = 0x09; K.I2C_MASTER_CMD_BURST_RECEIVE_FINISH = 0x05; K.I2C_MASTER_CMD_BURST_RECEIVE_ERROR_STOP = 0x04;
  K.I2C_MASTER_ERR_NONE = 0; K.I2C_MASTER_ERR_ADDR_ACK = 0x04; K.I2C_MASTER_ERR_DATA_ACK = 0x08; K.I2C_MASTER_ERR_ARB_LOST = 0x10;
  K.I2C_MASTER_INT_DATA = 1; K.I2C_MASTER_INT_TIMEOUT = 2;
  K.SSI_FRF_MOTO_MODE_0 = 0x00; K.SSI_FRF_MOTO_MODE_1 = 0x02; K.SSI_FRF_MOTO_MODE_2 = 0x01; K.SSI_FRF_MOTO_MODE_3 = 0x03; K.SSI_FRF_TI = 0x10; K.SSI_FRF_NMW = 0x20;
  K.SSI_MODE_MASTER = 0; K.SSI_MODE_SLAVE = 1; K.SSI_MODE_SLAVE_OD = 2;
  K.SSI_RXOR = 1; K.SSI_RXTO = 2; K.SSI_RXFF = 4; K.SSI_TXFF = 8;
};
M.busApi = function (S, A, K, WAIT) {
  function i2c(base, api) {
    if (base !== K.I2C0_BASE) S.fault(api + ': only I2C0 (base 0x40020000) is simulated.');
    S.need('I2C0', api); return S.i2c;
  }
  function ssi(base, api) {
    if (base !== K.SSI0_BASE) S.fault(api + ': only SSI0 (base 0x40008000) is simulated.');
    S.need('SSI0', api); return S.ssi;
  }
  A.I2CMasterInitExpClk = function (b, clk, fast) {
    var c = i2c(b, 'I2CMasterInitExpClk'), scl = fast ? 400000 : 100000;
    c.tpr = Math.max(1, Math.ceil(clk / (2 * 10 * scl)) - 1); c.mcr |= 0x10; c.en = true;
  };
  A.I2CMasterEnable = function (b) { var c = i2c(b, 'I2CMasterEnable'); c.en = true; c.mcr |= 0x10; };
  A.I2CMasterDisable = function (b) { var c = i2c(b, 'I2CMasterDisable'); c.en = false; c.mcr &= ~0x10; };
  A.I2CMasterSlaveAddrSet = function (b, addr, recv) { i2c(b, 'I2CMasterSlaveAddrSet').msa = ((addr & 0x7F) << 1) | (recv ? 1 : 0); };
  A.I2CMasterDataPut = function (b, d) { i2c(b, 'I2CMasterDataPut').mdr = d & 0xFF; };
  A.I2CMasterDataGet = function (b) { var c = i2c(b, 'I2CMasterDataGet'); S.sync(); return c.mdr; };
  A.I2CMasterControl = function (b, cmd) { i2c(b, 'I2CMasterControl'); S.i2cCmd(cmd & 0x7F); };
  A.I2CMasterBusy = function (b) { var c = i2c(b, 'I2CMasterBusy'); S.sync(); return c.busy ? 1 : 0; };
  A.I2CMasterBusBusy = function (b) { var c = i2c(b, 'I2CMasterBusBusy'); S.sync(); return c.busbsy ? 1 : 0; };
  A.I2CMasterErr = function (b) { var c = i2c(b, 'I2CMasterErr'); S.sync(); return c.err; };
  A.I2CMasterIntEnable = function (b) { i2c(b, 'I2CMasterIntEnable').mimr |= 1; S.touch(); };
  A.I2CMasterIntDisable = function (b) { i2c(b, 'I2CMasterIntDisable').mimr &= ~1; };
  A.I2CMasterIntClear = function (b) { i2c(b, 'I2CMasterIntClear').mris &= ~1; S.touch(); };
  A.I2CMasterIntStatus = function (b, masked) { var c = i2c(b, 'I2CMasterIntStatus'); S.sync(); return masked ? ((c.mris & c.mimr & 1) ? 1 : 0) : (c.mris & 1 ? 1 : 0); };
  A.I2CMasterIntEnableEx = function (b, f) { i2c(b, 'I2CMasterIntEnableEx').mimr |= f & 3; S.touch(); };
  A.I2CMasterIntClearEx = function (b, f) { i2c(b, 'I2CMasterIntClearEx').mris &= ~f; S.touch(); };
  A.I2CMasterIntRegister = function (b, fn) { i2c(b, 'I2CMasterIntRegister'); S.handlers.i2c0 = fn; };
  A.I2CMasterTimeoutSet = A.I2CMasterGlitchFilterConfigSet = function () {};
  A.SSIConfigSetExpClk = function (b, clk, proto, mode, bitrate, width) {
    var c = ssi(b, 'SSIConfigSetExpClk');
    if (mode !== 0) S.warn('ssislave', 'SSIConfigSetExpClk: only master mode is simulated.');
    var cpsr = 2, scr = 0, best = false;
    for (cpsr = 2; cpsr <= 254; cpsr += 2) { scr = Math.ceil(clk / (cpsr * bitrate)) - 1; if (scr <= 255) { best = true; break; } }
    if (!best) { cpsr = 254; scr = 255; }
    c.cpsr = cpsr; c.cr0 = ((Math.max(0, scr) & 0xFF) << 8) | ((proto & 2) ? 0x80 : 0) | ((proto & 1) ? 0x40 : 0) | (proto & 0x30) | ((width - 1) & 15);
    c.cr1 = c.cr1 & ~4;
  };
  A.SSIEnable = function (b) { var c = ssi(b, 'SSIEnable'); c.en = true; c.cr1 |= 2; S.ssiKick(); };
  A.SSIDisable = function (b) { var c = ssi(b, 'SSIDisable'); c.en = false; c.cr1 &= ~2; };
  function waitFor(c) { return c.shifting && c.ev && !c.ev.dead ? { wait: true, until: c.ev.t } : WAIT; }
  A.SSIDataPut = function* (b, d) {
    var c = ssi(b, 'SSIDataPut');
    while (c.tx.length >= 8) {
      if (!c.en) S.fault('SSIDataPut is waiting for room in the TX FIFO, but SSI0 is not enabled, so it never drains. Call SSIEnable(SSI0_BASE).');
      S.sync(); if (c.tx.length < 8) break; yield waitFor(c);
    }
    S.ssiPut(d);
  };
  A.SSIDataPutNonBlocking = function (b, d) { var c = ssi(b, 'SSIDataPutNonBlocking'); if (c.tx.length >= 8) return 0; S.ssiPut(d); return 1; };
  A.SSIDataGet = function* (b, buf) {
    var c = ssi(b, 'SSIDataGet');
    for (;;) {
      S.sync(); if (c.rx.length) break;
      if (!c.shifting && !c.tx.length) S.fault('SSIDataGet is waiting for received data, but nothing is being transmitted. SPI only receives while it sends a word; write a dummy word with SSIDataPut first (and make sure SSI0 is enabled).');
      yield waitFor(c);
    }
    var v = S.ssiGet(); if (buf && 'v' in buf) buf.v = v; else if (Array.isArray(buf)) buf[0] = v;
  };
  A.SSIDataGetNonBlocking = function (b, buf) { var c = ssi(b, 'SSIDataGetNonBlocking'); S.sync(); if (!c.rx.length) return 0; var v = S.ssiGet(); if (buf && 'v' in buf) buf.v = v; else if (Array.isArray(buf)) buf[0] = v; return 1; };
  A.SSIBusy = function (b) { var c = ssi(b, 'SSIBusy'); S.sync(); return (c.shifting || c.tx.length) ? 1 : 0; };
  A.SSIIntEnable = function (b, f) { ssi(b, 'SSIIntEnable').im |= f & 15; S.touch(); };
  A.SSIIntDisable = function (b, f) { ssi(b, 'SSIIntDisable').im &= ~f; };
  A.SSIIntClear = function (b, f) { ssi(b, 'SSIIntClear').ris &= ~(f & 3); S.touch(); };
  A.SSIIntStatus = function (b, masked) { var c = ssi(b, 'SSIIntStatus'); S.sync(); return masked ? c.ris & c.im : c.ris; };
  A.SSIIntRegister = function (b, fn) { ssi(b, 'SSIIntRegister'); S.handlers.ssi0 = fn; };
  A.SSILoopbackEnable = function (b) { ssi(b, 'SSILoopbackEnable').cr1 |= 1; };
  A.SSILoopbackDisable = function (b) { ssi(b, 'SSILoopbackDisable').cr1 &= ~1; };
};
return M;
})(typeof MSP !== 'undefined' ? MSP : require('./core.js'));
