/* MSP432E401Y simulator: memory-mapped register layer.
   Register blocks are described once (static tables). buildRegs(S) binds them to one simulator instance and exposes
   - S.regs.read / write (address based, sizes 1/2/4)       used by HWREG(), *(volatile uint32_t*)ADDR, p[i]
   - named registers  GPIO_PORTF_DATA_R, SYSCTL_RCGCGPIO_R  used through  __r.NAME  (compiler rewrites)
   - CMSIS style structs  GPIO_PORTF_AHB->DATA, SYSCTL->RCGCGPIO, TIMER0->CTL, NVIC->ISER[0], SysTick->CTRL
   - S.regs.dump(blockId)                                   used by the debugger register viewer                      */
(function (M) {
'use strict';
var P = M.Sim.prototype, PORTS = M.PORTS;

/* ---------- helpers ---------- */
function u32(x) { return x >>> 0; }
function hex(a) { return '0x' + u32(a).toString(16).toUpperCase(); }
function bitsOf(m) { var a = []; for (var b = 0; b < 8; b++) if (m & (1 << b)) a.push(b); return a; }
function raw(key, rst) {            // plain read/write register stored in S.raw
  return { g: function (S) { var v = S.raw[key]; return v === undefined ? rst || 0 : v; }, s: function (S, I, v) { S.raw[key] = u32(v); } };
}
function R(off, name, def, extra) { var o = { off: off, name: name }; for (var k in def) o[k] = def[k]; if (extra) for (var k2 in extra) o[k2] = extra[k2]; return o; }
function rawR(blk, off, name, rst) { return R(off, name, raw(blk + ':' + off, rst)); }

/* ---------- block tables ---------- */
var BLOCKS = [];          // {id, base, size, kind, I, prefixes[], regs[], win}
var BYPAGE = {};          // page number -> block
function addBlock(b) {
  b.byOff = {}; b.regs.forEach(function (r) { b.byOff[r.off] = r; });
  BLOCKS.push(b);
  for (var a = b.base; a < b.base + b.size; a += 0x1000) BYPAGE[a >>> 12] = b;
  return b;
}

/* GPIO ----------------------------------------------------------------------------------------------------------- */
function gpioRegs(L) {
  function gp(S, peek) {
    if (!S.periph['GPIO' + L]) {
      if (peek) return null;
      S.fault('Bus fault: a GPIO Port ' + L + ' register was accessed while the port clock is off. Set bit ' + PORTS.indexOf(L) + ' of SYSCTL_RCGCGPIO_R (SYSCTL->RCGCGPIO) first, then wait for the matching bit in SYSCTL_PRGPIO_R.');
    }
    var p = S.gpio[L]; p.used = 1; return p;
  }
  function plain(off, name, key, after, rst) {
    return R(off, name, {
      g: function (S, I, peek) { var p = gp(S, peek); return p ? p[key] >>> 0 : 0; },
      s: function (S, I, v) { var p = gp(S); p[key] = v & 0xFF; if (after) after(S, p); }
    });
  }
  function upd(S) { S.gpioUpdate(L); }
  function rawp(off, name, rst) {
    return R(off, name, {
      g: function (S, I, peek) { var p = gp(S, peek); if (!p) return 0; var v = p.raw[off]; return v === undefined ? rst || 0 : v; },
      s: function (S, I, v) { gp(S).raw[off] = u32(v); }
    });
  }
  var regs = [
    R(0x3FC, 'DATA', {
      g: function (S, I, peek, off) {
        var p = gp(S, peek); if (!p) return 0; if (!peek) S.sync();
        var mask = (off >> 2) & 0xFF, r = 0;
        for (var n = 0; n < 8; n++) { var m = 1 << n; if ((mask & m) && (p.den & m) && p.dig[n]) r |= m; }
        return r;
      },
      s: function (S, I, v, off) { var p = gp(S), mask = (off >> 2) & 0xFF; p.out = (p.out & ~mask) | (v & mask); S.gpioUpdate(L); }
    }, { win: 0x400 }),
    plain(0x400, 'DIR', 'dir', upd), plain(0x404, 'IS', 'is', upd), plain(0x408, 'IBE', 'ibe', upd), plain(0x40C, 'IEV', 'iev', upd),
    plain(0x410, 'IM', 'im', function (S) { S.touch(); }),
    R(0x414, 'RIS', { g: function (S, I, peek) { var p = gp(S, peek); if (!p) return 0; if (!peek) S.sync(); return p.ris; }, s: null }),
    R(0x418, 'MIS', { g: function (S, I, peek) { var p = gp(S, peek); if (!p) return 0; if (!peek) S.sync(); return p.ris & p.im; }, s: null }),
    R(0x41C, 'ICR', { g: function () { return 0; }, s: function (S, I, v) { var p = gp(S); p.ris &= ~v; S.gpioUpdate(L); } }),
    R(0x420, 'AFSEL', { g: function (S, I, peek) { var p = gp(S, peek); return p ? p.afsel : 0; }, s: function (S, I, v) { var p = gp(S); p.afsel = v & 0xFF; S.pinMux(L); } }),
    rawp(0x500, 'DR2R', 0xFF), rawp(0x504, 'DR4R', 0), rawp(0x508, 'DR8R', 0), rawp(0x50C, 'ODR', 0),
    plain(0x510, 'PUR', 'pur', upd), plain(0x514, 'PDR', 'pdr', upd), rawp(0x518, 'SLR', 0),
    plain(0x51C, 'DEN', 'den', upd),
    R(0x520, 'LOCK', { g: function (S, I, peek) { var p = gp(S, peek); return p ? (p.raw.unlocked ? 0 : 1) : 1; }, s: function (S, I, v) { gp(S).raw.unlocked = (u32(v) === 0x4C4F434B); } }),
    rawp(0x524, 'CR', 0xFF),
    plain(0x528, 'AMSEL', 'analog', upd),
    R(0x52C, 'PCTL', { g: function (S, I, peek) { var p = gp(S, peek); return p ? p.pctl : 0; }, s: function (S, I, v) { var p = gp(S); p.pctl = u32(v); S.pinMux(L); } }),
    rawp(0x530, 'ADCCTL', 0), rawp(0x534, 'DMACTL', 0), rawp(0x538, 'SI', 0), rawp(0x53C, 'DR12R', 0), rawp(0x540, 'WAKEPEN', 0),
    rawp(0x544, 'WAKELVL', 0), rawp(0x548, 'WAKESTAT', 0)
  ];
  return regs;
}
PORTS.forEach(function (L, i) {
  var base = 0x40058000 + i * 0x1000;
  addBlock({ id: 'GPIO' + L, title: 'GPIO Port ' + L, base: base, size: 0x1000, I: L, prefixes: ['GPIO_PORT' + L + '_AHB', 'GPIO_PORT' + L], regs: gpioRegs(L), win: 0x400 });
});

/* SYSCTL --------------------------------------------------------------------------------------------------------- */
(function () {
  var GROUPS = [   // [offset of RCGC register, name, key prefix, count]
    [0x600, 'WD', 'WDT', 2], [0x604, 'TIMER', 'TIMER', 8], [0x608, 'GPIO', 'GPIO', 15], [0x60C, 'DMA', 'UDMA', 1], [0x610, 'EPI', 'EPI', 1],
    [0x614, 'HIB', 'HIB', 1], [0x618, 'UART', 'UART', 8], [0x61C, 'SSI', 'SSI', 4], [0x620, 'I2C', 'I2C', 10], [0x628, 'USB', 'USB', 1],
    [0x634, 'CAN', 'CAN', 2], [0x638, 'ADC', 'ADC', 2], [0x63C, 'ACMP', 'ACMP', 1], [0x640, 'PWM', 'PWM', 1], [0x644, 'QEI', 'QEI', 1],
    [0x658, 'EEPROM', 'EEPROM', 1], [0x69C, 'EMAC', 'EMAC', 1]
  ];
  function key(g, i) { return g[2] === 'GPIO' ? 'GPIO' + PORTS[i] : g[2] + i; }
  function rcgcGet(g) {
    return function (S) { var v = 0; for (var i = 0; i < g[3]; i++) if (S.periph[key(g, i)]) v |= 1 << i; return u32(v); };
  }
  function rcgcSet(g) {
    return function (S, I, v) { for (var i = 0; i < g[3]; i++) { if ((v >>> i) & 1) S.periph[key(g, i)] = true; else delete S.periph[key(g, i)]; } S.touch(); };
  }
  var regs = [];
  GROUPS.forEach(function (g) {
    var o = g[0] - 0x600;
    regs.push(R(0x600 + o, 'RCGC' + g[1], { g: rcgcGet(g), s: rcgcSet(g) }));
    regs.push(R(0x700 + o, 'SCGC' + g[1], { g: rcgcGet(g), s: rcgcSet(g) }));
    regs.push(R(0x800 + o, 'DCGC' + g[1], { g: rcgcGet(g), s: rcgcSet(g) }));
    regs.push(R(0xA00 + o, 'PR' + g[1], { g: rcgcGet(g), s: null }));
    regs.push(R(0x500 + o, 'SR' + g[1], { g: function () { return 0; }, s: function () {} }));
  });
  function srcFreq(sel) { return sel === 3 ? 25e6 : sel === 4 ? 32768 : sel === 1 ? 33e3 : 16e6; }
  function apply(S) {
    var sc = S.sc, v = sc.rsclkcfg, psys = v & 0x3FF, osys = (v >>> 10) & 0x3FF, osc = (v >>> 20) & 15, pll = (v >>> 24) & 15, f;
    if (v & 0x10000000) {                                    // USEPLL
      if (!sc.pllOn) S.fault('RSCLKCFG selects the PLL as the system clock but the PLL is not powered. Set PLLPWR in SYSCTL_PLLFREQ0_R and wait for PLLSTAT.LOCK first.');
      var mint = sc.pllfreq0 & 0x3FF, mfrac = (sc.pllfreq0 >>> 10) & 0x3FF, n = sc.pllfreq1 & 31, q = (sc.pllfreq1 >>> 8) & 31;
      var vco = srcFreq(pll) / ((q + 1) * (n + 1)) * (mint + mfrac / 1024);
      f = vco / (psys + 1);
    } else f = srcFreq(osc) / (osys + 1);
    if (f > 120e6 + 1) S.fault('System clock computed as ' + (f / 1e6).toFixed(1) + ' MHz, which is above the 120 MHz maximum of the MSP432E401Y.');
    S.clk = f; S.touch();
  }
  var blk = 'SYS';
  regs.push(R(0x000, 'DID0', { g: function () { return 0x180F0000; }, s: null }), R(0x004, 'DID1', { g: function () { return 0x10A1F0D4 >>> 0; }, s: null }));
  regs.push(rawR(blk, 0x030, 'PBORCTL', 0), rawR(blk, 0x054, 'IMC', 0), rawR(blk, 0x058, 'MISC', 0), rawR(blk, 0x05C, 'RESC', 0));
  regs.push(R(0x050, 'RIS', { g: function (S) { return (S.sc.mosc ? 0x100 : 0) | (S.sc.pllOn ? 0x40 : 0); }, s: null }));
  regs.push(R(0x07C, 'MOSCCTL', { g: function (S) { return S.raw.moscctl === undefined ? 0xC : S.raw.moscctl; }, s: function (S, I, v) { S.raw.moscctl = v & 0x3F; S.sc.mosc = !(v & 4) && !(v & 8); } }));
  regs.push(R(0x0B0, 'RSCLKCFG', { g: function (S) { return u32(S.sc.rsclkcfg); }, s: function (S, I, v) { S.sc.rsclkcfg = u32(v); apply(S); } }));
  regs.push(rawR(blk, 0x0C0, 'MEMTIM0', 0x01850185));
  regs.push(R(0x160, 'PLLFREQ0', { g: function (S) { return u32(S.sc.pllfreq0); }, s: function (S, I, v) { S.sc.pllfreq0 = u32(v); S.sc.pllOn = !!(v & 0x800000); } }));
  regs.push(R(0x164, 'PLLFREQ1', { g: function (S) { return u32(S.sc.pllfreq1); }, s: function (S, I, v) { S.sc.pllfreq1 = u32(v); } }));
  regs.push(R(0x168, 'PLLSTAT', { g: function (S) { return S.sc.pllOn ? 1 : 0; }, s: null }));
  regs.push(rawR(blk, 0x138, 'ALTCLKCFG', 0), rawR(blk, 0x144, 'DSCLKCFG', 0), rawR(blk, 0x14C, 'SYSPROP', 0x1D31), rawR(blk, 0x150, 'PIOSCCAL', 0));
  regs.push(rawR(blk, 0x148, 'DIVSCLK', 0), rawR(blk, 0x1B0, 'SLPPWRCFG', 0), rawR(blk, 0x1B4, 'DSLPPWRCFG', 0), rawR(blk, 0x1C0, 'NVMSTAT', 1));
  regs.push(R(0x060, 'RCC_STUB', { g: function () { return 0; }, s: function () {} }));
  regs = regs.filter(function (r) { return r.name !== 'RCC_STUB'; });
  addBlock({ id: 'SYSCTL', title: 'System Control (SYSCTL)', base: 0x400FE000, size: 0x1000, I: 0, prefixes: ['SYSCTL'], regs: regs });
})();

/* TIMER ---------------------------------------------------------------------------------------------------------- */
function timerRegs(n) {
  function tm(S) { S.need('TIMER' + n, 'a TIMER' + n + ' register access'); return S.timers[n]; }
  function tmq(S, peek) { if (peek && !S.periph['TIMER' + n]) return null; return tm(S); }
  function sub(w) { return function (S) { return S.timers[n][w]; }; }
  function modeOf(v) { return (v & 3) === 1 ? 0x21 : (v & 3) === 2 ? 0x22 : 0; }
  function MR(off, name, w) {
    return R(off, name, {
      g: function (S, I, peek) { var t = tmq(S, peek); return t ? t[w].mr : 0; },
      s: function (S, I, v) {
        var t = tm(S), s = t[w]; s.mr = v & 0xFFFF; s.mode = modeOf(v); s.up = !!(v & 0x10);
        if ((v & 3) === 3) S.warn('tcap' + n, 'TIMER' + n + ': capture mode is not simulated.');
      }
    });
  }
  function ILR(off, name, w) {
    return R(off, name, {
      g: function (S, I, peek) { var t = tmq(S, peek); return t ? (t.split ? t[w].load & 0xFFFF : u32(t[w].load)) : 0; },
      s: function (S, I, v) { var t = tm(S); t[w].load = t.split ? v & 0xFFFF : u32(v); }
    });
  }
  function PR(off, name, w) {
    return R(off, name, { g: function (S, I, peek) { var t = tmq(S, peek); return t ? t[w].pre : 0; }, s: function (S, I, v) { tm(S)[w].pre = v & 0xFF; } });
  }
  function VAL(off, name, w) {
    return R(off, name, { g: function (S, I, peek) { var t = tmq(S, peek); if (!t) return 0; if (!peek) S.sync(); return u32(S.timerVal(n, w)); }, s: function () {} });
  }
  var regs = [
    R(0x000, 'CFG', { g: function (S, I, peek) { var t = tmq(S, peek); return t ? t.cfg : 0; }, s: function (S, I, v) {
      var t = tm(S); t.cfg = v & 7; t.split = (v & 7) === 4;
      if (t.split) { t.A.load &= 0xFFFF; t.B.load = 0xFFFF; }
      if ((v & 7) === 1) S.warn('trtc' + n, 'TIMER' + n + ': RTC mode is not simulated.');
    } }),
    MR(0x004, 'TAMR', 'A'), MR(0x008, 'TBMR', 'B'),
    R(0x00C, 'CTL', {
      g: function (S, I, peek) { var t = tmq(S, peek); return t ? (t.ctl & ~0x101) | (t.A.run ? 1 : 0) | (t.B.run ? 0x100 : 0) : 0; },
      s: function (S, I, v) {
        var t = tm(S), w;
        t.ctl = v & 0x7FFF;
        [['A', 1], ['B', 0x100]].forEach(function (x) {
          w = x[0]; var s = t[w], want = !!(v & x[1]);
          if (w === 'B' && !t.split) return;
          if (want && !s.run) { if (!s.mode) S.warn('tmode' + n + w, 'TIMER' + n + ': TAEN/TBEN set but the mode field in TAMR/TBMR is 0 (reserved), so the timer does not start. Write 1 (one-shot) or 2 (periodic) to TnMR first.'); else S.timerStart(n, w); }
          else if (!want && s.run) S.timerStop(n, w);
        });
      }
    }),
    rawR('T' + n, 0x010, 'SYNC', 0),
    R(0x018, 'IMR', { g: function (S, I, peek) { var t = tmq(S, peek); return t ? t.imr : 0; }, s: function (S, I, v) { var t = tm(S); t.imr = v & 0x1F1F; t.A.mask = v & 1; t.B.mask = (v >>> 8) & 1; S.touch(); } }),
    R(0x01C, 'RIS', { g: function (S, I, peek) { var t = tmq(S, peek); if (!t) return 0; if (!peek) S.sync(); return (t.A.ris & 1) | ((t.B.ris & 1) << 8); }, s: null }),
    R(0x020, 'MIS', { g: function (S, I, peek) { var t = tmq(S, peek); if (!t) return 0; if (!peek) S.sync(); return ((t.A.ris & t.imr) & 1) | (((t.B.ris & t.imr) >>> 8 & 1) << 8); }, s: null }),
    R(0x024, 'ICR', { g: function () { return 0; }, s: function (S, I, v) { var t = tm(S); S.sync(); if (v & 1) t.A.ris = 0; if (v & 0x100) t.B.ris = 0; S.touch(); } }),
    ILR(0x028, 'TAILR', 'A'), ILR(0x02C, 'TBILR', 'B'),
    rawR('T' + n, 0x030, 'TAMATCHR', 0xFFFFFFFF), rawR('T' + n, 0x034, 'TBMATCHR', 0xFFFF),
    PR(0x038, 'TAPR', 'A'), PR(0x03C, 'TBPR', 'B'),
    rawR('T' + n, 0x040, 'TAPMR', 0), rawR('T' + n, 0x044, 'TBPMR', 0),
    VAL(0x048, 'TAR', 'A'), VAL(0x04C, 'TBR', 'B'), VAL(0x050, 'TAV', 'A'), VAL(0x054, 'TBV', 'B'),
    rawR('T' + n, 0x058, 'RTCPD', 0xFFFF),
    PR(0x05C, 'TAPS', 'A'), PR(0x060, 'TBPS', 'B'), VAL(0x064, 'TAPV', 'A'), VAL(0x068, 'TBPV', 'B'),
    rawR('T' + n, 0xFC0, 'PP', 0), rawR('T' + n, 0xFC8, 'CC', 0)
  ];
  return regs;
}
for (var ti = 0; ti < 8; ti++) addBlock({ id: 'TIMER' + ti, title: 'General-Purpose Timer ' + ti, base: 0x40030000 + ti * 0x1000, size: 0x1000, I: ti, prefixes: ['TIMER' + ti], regs: timerRegs(ti) });

/* UART ----------------------------------------------------------------------------------------------------------- */
function uartRegs(n) {
  function sim(S, peek) {
    if (n !== 0) { if (!peek) S.warn('uartn' + n, 'UART' + n + ' is not simulated; only UART0 (the USB virtual COM port) is. Accesses to UART' + n + ' registers are ignored.'); return null; }
    if (!S.periph.UART0) { if (peek) return null; S.fault('Bus fault: a UART0 register was accessed while its clock is off. Set bit 0 of SYSCTL_RCGCUART_R (SYSCTL->RCGCUART) first.'); }
    return S.u;
  }
  function baudCalc(S, u) {
    var d = u.ibrd + u.fbrd / 64;
    if (d > 0) u.baud = S.clk / ((u.ctl8 ? 8 : 16) * d);
    u.cfg = true;
  }
  function sget(fn) { return function (S, I, peek) { var u = sim(S, peek); return u ? fn(S, u, peek) : 0; }; }
  function sset(fn) { return function (S, I, v) { var u = sim(S); if (u) fn(S, u, v); }; }
  function purge(S, u) { var t = S.T(); while (u.txq.length && u.txq[0] <= t) u.txq.shift(); }
  var regs = [
    R(0x000, 'DR', {
      g: sget(function (S, u, peek) { if (!peek) S.sync(); if (peek) return u.rx.length ? u.rx[0] : 0; return u.rx.length ? u.rx.shift() : 0; }),
      s: sset(function (S, u, v) {
        purge(S, u);
        if (!u.en || !u.txe) { S.warn('uartoff', 'UART0: a byte was written to UARTDR but the UART is not enabled (UARTEN and TXE in UARTCTL). Nothing is transmitted.'); return; }
        if (u.txq.length >= 16) return;                      // FIFO full: byte is lost, like the hardware
        S.uartEnq(v & 0xFF);
      })
    }),
    R(0x004, 'RSR', { g: function () { return 0; }, s: function () {} }),
    R(0x018, 'FR', {
      g: sget(function (S, u, peek) {
        if (!peek) S.sync(); purge(S, u);
        return (u.txq.length === 0 ? 0x80 : 0) | (u.rx.length >= 16 ? 0x40 : 0) | (u.txq.length >= 16 ? 0x20 : 0) | (u.rx.length === 0 ? 0x10 : 0) | (u.txq.length ? 0x08 : 0);
      }), s: null
    }),
    rawR('U' + n, 0x020, 'ILPR', 0),
    R(0x024, 'IBRD', { g: sget(function (S, u) { return u.ibrd; }), s: sset(function (S, u, v) { u.ibrd = v & 0xFFFF; baudCalc(S, u); }) }),
    R(0x028, 'FBRD', { g: sget(function (S, u) { return u.fbrd; }), s: sset(function (S, u, v) { u.fbrd = v & 63; baudCalc(S, u); }) }),
    R(0x02C, 'LCRH', { g: sget(function (S, u) { return u.lcrh; }), s: sset(function (S, u, v) { u.lcrh = v & 0xFF; }) }),
    R(0x030, 'CTL', {
      g: sget(function (S, u) { return (u.en ? 1 : 0) | (u.txe ? 0x100 : 0) | (u.rxe ? 0x200 : 0) | (u.ctl8 ? 0x20 : 0) | (u.ctlx || 0); }),
      s: sset(function (S, u, v) { u.en = !!(v & 1); u.txe = !!(v & 0x100); u.rxe = !!(v & 0x200); u.ctl8 = !!(v & 0x20); u.ctlx = v & 0xC4DE; if (u.ibrd) baudCalc(S, u); S.touch(); })
    }),
    R(0x034, 'IFLS', { g: sget(function (S, u) { return u.ifls; }), s: sset(function (S, u, v) { u.ifls = v & 0x3F; }) }),
    R(0x038, 'IM', { g: sget(function (S, u) { return u.im; }), s: sset(function (S, u, v) { u.im = v & 0xFFF; S.touch(); }) }),
    R(0x03C, 'RIS', { g: sget(function (S, u, peek) { if (!peek) S.sync(); return u.ris; }), s: null }),
    R(0x040, 'MIS', { g: sget(function (S, u, peek) { if (!peek) S.sync(); return u.ris & u.im; }), s: null }),
    R(0x044, 'ICR', { g: function () { return 0; }, s: sset(function (S, u, v) { u.ris &= ~v; S.touch(); }) }),
    R(0xFC8, 'CC', { g: sget(function (S, u) { return u.cc; }), s: sset(function (S, u, v) { u.cc = v & 15; }) })
  ];
  return regs;
}
for (var ui = 0; ui < 8; ui++) addBlock({ id: 'UART' + ui, title: 'UART' + ui + (ui ? ' (not simulated)' : ' (USB virtual COM port)'), base: 0x4000C000 + ui * 0x1000, size: 0x1000, I: ui, prefixes: ['UART' + ui], regs: uartRegs(ui) });

/* ADC ------------------------------------------------------------------------------------------------------------ */
function adcRegs(n) {
  function ad(S, peek) { if (!S.periph['ADC' + n]) { if (peek) return null; S.fault('Bus fault: an ADC' + n + ' register was accessed while its clock is off. Set bit ' + n + ' of SYSCTL_RCGCADC_R (SYSCTL->RCGCADC) first.'); } return S.adc[n]; }
  function qget(fn) { return function (S, I, peek) { var a = ad(S, peek); return a ? fn(S, a, peek) : 0; }; }
  function qset(fn) { return function (S, I, v) { fn(S, ad(S), v); }; }
  var DEPTH = [8, 4, 4, 1], MUXN = [8, 4, 4, 1];
  function stepsOf(q, ns) {                    // rebuild API-style step codes from SSMUXn / SSCTLn
    var out = [];
    for (var k = 0; k < ns; k++) {
      var ch = (q.mux >>> (4 * k)) & 15, c = (q.ctl >>> (4 * k)) & 15;
      out.push(ch | ((c & 8) ? 0x80 : 0) | ((c & 4) ? 0x40 : 0) | ((c & 2) ? 0x20 : 0) | ((c & 1) ? 0x10 : 0));
    }
    return out;
  }
  function rebuild(q, s) { q.steps = stepsOf(q, DEPTH[s]); }
  var regs = [
    R(0x000, 'ACTSS', { g: qget(function (S, a) { var v = 0; for (var s = 0; s < 4; s++) if (a.seq[s].en) v |= 1 << s; return v; }), s: qset(function (S, a, v) { for (var s = 0; s < 4; s++) a.seq[s].en = !!(v & (1 << s)); }) }),
    R(0x004, 'RIS', { g: qget(function (S, a, peek) { if (!peek) S.sync(); var v = 0; for (var s = 0; s < 4; s++) if (a.seq[s].ris) v |= 1 << s; return v; }), s: null }),
    R(0x008, 'IM', { g: qget(function (S, a) { var v = 0; for (var s = 0; s < 4; s++) if (a.seq[s].im) v |= 1 << s; return v; }), s: qset(function (S, a, v) { for (var s = 0; s < 4; s++) a.seq[s].im = (v >>> s) & 1; S.touch(); }) }),
    R(0x00C, 'ISC', { g: qget(function (S, a, peek) { if (!peek) S.sync(); var v = 0; for (var s = 0; s < 4; s++) if (a.seq[s].ris && a.seq[s].im) v |= 1 << s; return v; }), s: qset(function (S, a, v) { for (var s = 0; s < 4; s++) if ((v >>> s) & 1) a.seq[s].ris = 0; S.touch(); }) }),
    rawR('A' + n, 0x010, 'OSTAT', 0),
    R(0x014, 'EMUX', { g: qget(function (S, a) { var v = 0; for (var s = 0; s < 4; s++) v |= (a.seq[s].trig & 15) << (4 * s); return v; }), s: qset(function (S, a, v) {
      for (var s = 0; s < 4; s++) { a.seq[s].trig = (v >>> (4 * s)) & 15; if (a.seq[s].trig !== 0 && a.seq[s].en) S.warn('adctrig', 'Only the processor trigger (EMUX = 0) is simulated; other triggers never start a conversion.'); }
    }) }),
    rawR('A' + n, 0x018, 'USTAT', 0), rawR('A' + n, 0x01C, 'TSSEL', 0), rawR('A' + n, 0x020, 'SSPRI', 0x3210), rawR('A' + n, 0x024, 'SPC', 0),
    R(0x028, 'PSSI', { g: function () { return 0; }, s: qset(function (S, a, v) { for (var s = 0; s < 4; s++) if ((v >>> s) & 1) S.adcStart(n, s); }) }),
    rawR('A' + n, 0x030, 'SAC', 0), rawR('A' + n, 0x034, 'DCISC', 0), rawR('A' + n, 0x038, 'CTL', 0),
    rawR('A' + n, 0xFC4, 'PC', 7),
    R(0xFC8, 'CC', { g: qget(function (S, a) { return a.raw.cc || 0; }), s: qset(function (S, a, v) { a.raw.cc = v & 0xF; }) })
  ];
  var bases = [0x040, 0x060, 0x080, 0x0A0];
  for (var s = 0; s < 4; s++) (function (s) {
    var b = bases[s], q = function (S, peek) { var a = ad(S, peek); return a ? a.seq[s] : null; };
    regs.push(R(b, 'SSMUX' + s, { g: function (S, I, peek) { var x = q(S, peek); return x ? x.mux : 0; }, s: function (S, I, v) { var x = q(S); x.mux = u32(v); rebuild(x, s); } }));
    regs.push(R(b + 4, 'SSCTL' + s, { g: function (S, I, peek) { var x = q(S, peek); return x ? x.ctl : 0; }, s: function (S, I, v) { var x = q(S); x.ctl = u32(v); rebuild(x, s); } }));
    regs.push(R(b + 8, 'SSFIFO' + s, { g: function (S, I, peek) { var x = q(S, peek); if (!x) return 0; if (!peek) S.sync(); return x.fifo.length ? (peek ? x.fifo[0] : x.fifo.shift()) : 0; }, s: null }));
    regs.push(R(b + 12, 'SSFSTAT' + s, { g: function (S, I, peek) { var x = q(S, peek); if (!x) return 0; if (!peek) S.sync(); return (x.fifo.length === 0 ? 0x100 : 0) | (x.fifo.length >= DEPTH[s] ? 0x1000 : 0) | ((x.fifo.length & 15) << 4); }, s: null }));
  })(s);
  return regs;
}
for (var ai = 0; ai < 2; ai++) addBlock({ id: 'ADC' + ai, title: 'ADC' + ai, base: 0x40038000 + ai * 0x1000, size: 0x1000, I: ai, prefixes: ['ADC' + ai], regs: adcRegs(ai) });

/* PWM0 ----------------------------------------------------------------------------------------------------------- */
(function () {
  function pw(S, peek) { if (!S.periph.PWM0) { if (peek) return null; S.fault('Bus fault: a PWM0 register was accessed while its clock is off. Set bit 0 of SYSCTL_RCGCPWM_R (SYSCTL->RCGCPWM) first.'); } return S.pwm; }
  P.pwmRecalc = function (g) {
    var G = this.pwm.gens[g], r = G.R, load = r.load, ud = (r.ctl & 2) !== 0, period = ud ? 2 * load : load + 1;
    G.reg = true; G.en = (r.ctl & 1) !== 0; G.period = Math.max(0, period);
    [[0, r.gena, r.cmpa], [1, r.genb, r.cmpb]].forEach(function (o) {
      var gen = o[1], cmp = o[2], act = function (sh) { return (gen >>> sh) & 3; }, evs;
      if (period <= 0) { this.pwm.pulse[2 * g + o[0]] = 0; return; }
      var sh = o[0] ? [8, 10] : [4, 6];                       // CMPxU, CMPxD
      if (ud) evs = [[0, act(0)], [cmp, act(sh[0])], [load, act(2)], [2 * load - cmp, act(sh[1])]];
      else evs = [[0, act(2)], [load - cmp, act(sh[1])], [load, act(0)]];
      evs = evs.filter(function (e) { return e[0] >= 0 && e[0] <= period; }).sort(function (a, b) { return a[0] - b[0]; });
      var lvl = 0, high = 0;
      for (var pass = 0; pass < 2; pass++) {
        high = 0; var t = 0;
        for (var k = 0; k < evs.length; k++) {
          if (pass === 1) high += lvl * (evs[k][0] - t);
          t = evs[k][0];
          var a = evs[k][1]; lvl = a === 1 ? 1 - lvl : a === 2 ? 0 : a === 3 ? 1 : lvl;
        }
        if (pass === 1) high += lvl * (period - t);
      }
      var duty = Math.max(0, Math.min(1, high / period));
      if ((this.pwm.invert >> (2 * g + o[0])) & 1) duty = 1 - duty;
      this.pwm.pulse[2 * g + o[0]] = duty * period;
    }, this);
    this.pwmChanged();
  };
  var regs = [
    rawR('PWM', 0x000, 'CTL', 0), rawR('PWM', 0x004, 'SYNC', 0),
    R(0x008, 'ENABLE', { g: function (S, I, peek) { var w = pw(S, peek); return w ? w.outEn : 0; }, s: function (S, I, v) { var w = pw(S); w.outEn = v & 0xFF; S.pwmChanged(); } }),
    R(0x00C, 'INVERT', { g: function (S, I, peek) { var w = pw(S, peek); return w ? w.invert : 0; }, s: function (S, I, v) { var w = pw(S); w.invert = v & 0xFF; for (var g = 0; g < 4; g++) if (w.gens[g].reg) S.pwmRecalc(g); S.pwmChanged(); } }),
    rawR('PWM', 0x010, 'FAULT', 0), rawR('PWM', 0x014, 'INTEN', 0), rawR('PWM', 0x018, 'RIS', 0), rawR('PWM', 0x01C, 'ISC', 0), rawR('PWM', 0x020, 'STATUS', 0),
    R(0xFC8, 'CC', { g: function (S, I, peek) { var w = pw(S, peek); return w ? w.cc : 0; }, s: function (S, I, v) { var w = pw(S); w.cc = v & 0x10F; w.div = (v & 0x100) ? 2 << (v & 7) : 1; S.pwmChanged(); } })
  ];
  for (var g = 0; g < 4; g++) (function (g) {
    var b = 0x040 + g * 0x40;
    function gr(name, off, key, recalc) {
      regs.push(R(b + off, '_' + g + '_' + name, {
        g: function (S, I, peek) { var w = pw(S, peek); return w ? u32(w.gens[g].R[key]) : 0; },
        s: function (S, I, v) { var w = pw(S); w.gens[g].R[key] = u32(v); S.pwmRecalc(g); }
      }));
    }
    gr('CTL', 0x00, 'ctl'); regs.push(rawR('PWM', b + 0x04, '_' + g + '_INTEN', 0), rawR('PWM', b + 0x08, '_' + g + '_RIS', 0), rawR('PWM', b + 0x0C, '_' + g + '_ISC', 0));
    gr('LOAD', 0x10, 'load');
    regs.push(R(b + 0x14, '_' + g + '_COUNT', { g: function (S, I, peek) { var w = pw(S, peek); if (!w) return 0; var G = w.gens[g]; if (!G.en || !G.period) return 0; if (!peek) S.sync(); var tk = Math.floor(S.T() * S.clk / w.div) % G.period; return (G.R.ctl & 2) ? (tk <= G.R.load ? tk : 2 * G.R.load - tk) : G.R.load - tk; }, s: null }));
    gr('CMPA', 0x18, 'cmpa'); gr('CMPB', 0x1C, 'cmpb'); gr('GENA', 0x20, 'gena'); gr('GENB', 0x24, 'genb');
    regs.push(rawR('PWM', b + 0x28, '_' + g + '_DBCTL', 0), rawR('PWM', b + 0x2C, '_' + g + '_DBRISE', 0), rawR('PWM', b + 0x30, '_' + g + '_DBFALL', 0));
  })(g);
  addBlock({ id: 'PWM0', title: 'PWM0', base: 0x40028000, size: 0x1000, I: 0, prefixes: ['PWM0'], regs: regs });
})();

/* Cortex-M4 system block: SysTick, NVIC, SCB ---------------------------------------------------------------------- */
(function () {
  var N = M.IRQNAME;
  function nvicBit(S, word, bit) { return N[word * 32 + bit]; }
  function enGet(S, w) { var v = u32(S.nvicRaw[w] || 0); return v; }
  function enSet(S, w, v, on) {
    for (var b = 0; b < 32; b++) if ((v >>> b) & 1) {
      var nm = nvicBit(S, w, b);
      if (on) { S.nvicRaw[w] = u32((S.nvicRaw[w] || 0) | (1 << b)); if (nm) S.nvic[nm] = true; } else { S.nvicRaw[w] = u32((S.nvicRaw[w] || 0) & ~(1 << b)); if (nm) delete S.nvic[nm]; }
    }
    S.touch();
  }
  function pendBits(S, w) { var v = 0; for (var b = 0; b < 32; b++) { var nm = N[w * 32 + b]; if (nm && S.irqLine(nm)) v |= 1 << b; } return u32(v); }
  var regs = [];
  // SysTick
  function stArmChange(S) { if (S.st.en) { S.cancel(S.st.ev); S.stArm(S.T()); } }
  regs.push(R(0x010, 'CTRL', {
    g: function (S, I, peek) { if (!peek) S.sync(); var st = S.st, v = (st.en ? 1 : 0) | (st.inten ? 2 : 0) | (st.rate ? 0 : 4) | (st.cnt ? 0x10000 : 0); if (!peek) st.cnt = false; return v; },
    s: function (S, I, v) {
      var st = S.st, en = !!(v & 1), rate = (v & 4) ? 0 : 4e6;
      st.inten = !!(v & 2); if (st.rate !== rate) { st.rate = rate; stArmChange(S); }
      if (en && !st.en) { st.en = true; S.stArm(S.T()); } else if (!en && st.en) { st.en = false; S.cancel(st.ev); }
      S.touch();
    }
  }));
  regs.push(R(0x014, 'LOAD', { g: function (S) { return S.st.period & 0xFFFFFF; }, s: function (S, I, v) { S.st.period = v & 0xFFFFFF; } }));
  regs.push(R(0x018, 'VAL', {
    g: function (S, I, peek) {
      var st = S.st; if (!st.en) return 0; if (!peek) S.sync();
      var per = st.period + 1, el = Math.floor((S.T() - st.start) * (st.rate || S.clk)); return per - 1 - (el % per);
    },
    s: function (S) { S.st.cnt = false; if (S.st.en) stArmChange(S); }
  }));
  regs.push(R(0x01C, 'CALIB', { g: function () { return 0x80000000 | 0; }, s: null }));
  // NVIC
  for (var w = 0; w < 5; w++) (function (w) {
    regs.push(R(0x100 + 4 * w, 'ISER' + w, { g: function (S) { return enGet(S, w); }, s: function (S, I, v) { enSet(S, w, v, true); } }));
    regs.push(R(0x180 + 4 * w, 'ICER' + w, { g: function (S) { return enGet(S, w); }, s: function (S, I, v) { enSet(S, w, v, false); } }));
    regs.push(R(0x200 + 4 * w, 'ISPR' + w, { g: function (S, I, peek) { if (!peek) S.sync(); return pendBits(S, w); }, s: function (S, I, v) { for (var b = 0; b < 32; b++) if ((v >>> b) & 1) { var nm = N[w * 32 + b]; if (nm) S.swPend[nm] = true; } S.touch(); } }));
    regs.push(R(0x280 + 4 * w, 'ICPR' + w, { g: function (S, I, peek) { if (!peek) S.sync(); return pendBits(S, w); }, s: function (S, I, v) { for (var b = 0; b < 32; b++) if ((v >>> b) & 1) { var nm = N[w * 32 + b]; if (nm) delete S.swPend[nm]; } } }));
    regs.push(R(0x300 + 4 * w, 'IABR' + w, { g: function (S) { var v = 0; for (var b = 0; b < 32; b++) { var nm = N[w * 32 + b]; if (nm && S.dbg.isrName === nm && S.isr) v |= 1 << b; } return u32(v); }, s: null }));
  })(w);
  for (var ip = 0; ip < 60; ip++) (function (ip) {
    regs.push(R(0x400 + 4 * ip, 'IPR' + ip, {
      g: function (S) { var v = 0; for (var k = 0; k < 4; k++) v |= (((S.raw['ip' + (4 * ip + k)] || 0) & 7) << 5) << (8 * k); return u32(v); },
      s: function (S, I, v) { for (var k = 0; k < 4; k++) { var pr = (v >>> (8 * k + 5)) & 7, irq = 4 * ip + k, nm = N[irq]; S.raw['ip' + irq] = pr; if (nm) S.prio[nm] = pr; } }
    }));
  })(ip);
  // SCB
  regs.push(R(0xD04, 'ICSR', {
    g: function (S) { return (S.isr ? 1 : 0) | (S.swPend.systick || (S.st.flag && S.st.inten) ? 0x4000000 : 0); },
    s: function (S, I, v) { if (v & 0x4000000) S.swPend.systick = true; if (v & 0x2000000) delete S.swPend.systick; S.touch(); }
  }));
  regs.push(rawR('SCB', 0xD08, 'VTOR', 0), R(0xD0C, 'AIRCR', { g: function (S) { return 0xFA050000 | ((S.raw['SCB:aircr'] || 0) & 0x700); }, s: function (S, I, v) {
    if ((u32(v) >>> 16) !== 0x5FA) return;
    S.raw['SCB:aircr'] = v & 0x700; if (v & 4) { S.resetReq = true; S.halted = true; S.log('info', 'SYSRESETREQ: the program requested a system reset (NVIC_SystemReset). Press Run to start again.'); }
  } }));
  regs.push(rawR('SCB', 0xD10, 'SCR', 0), rawR('SCB', 0xD14, 'CCR', 0x200), rawR('SCB', 0xD18, 'SHPR1', 0), rawR('SCB', 0xD1C, 'SHPR2', 0));
  regs.push(R(0xD20, 'SHPR3', { g: function (S) { return u32((S.raw['SCB:shpr3'] || 0)); }, s: function (S, I, v) { S.raw['SCB:shpr3'] = u32(v); S.prio.systick = (v >>> 29) & 7; } }));
  regs.push(rawR('SCB', 0xD24, 'SHCSR', 0), rawR('SCB', 0xD28, 'CFSR', 0), rawR('SCB', 0xD88, 'CPACR', 0));
  addBlock({ id: 'SCS', title: 'Cortex-M4 core: SysTick, NVIC, SCB', base: 0xE000E000, size: 0x1000, I: 0, prefixes: [], regs: regs });
})();

/* Peripherals that exist on the chip but are not simulated: reads give 0, writes are ignored (with a warning). */
var STUBS = {};
(function () {
  function stub(name, base, size) { for (var a = base; a < base + size; a += 0x1000) STUBS[a >>> 12] = name; }
  for (var i = 1; i < 4; i++) stub('SSI' + i, 0x40008000 + i * 0x1000, 0x1000);
  for (i = 1; i < 4; i++) stub('I2C' + i, [0x40020000, 0x40021000, 0x40022000, 0x40023000][i], 0x1000);
  stub('QEI0', 0x4002C000, 0x1000); stub('WDT0', 0x40000000, 0x1000); stub('WDT1', 0x40001000, 0x1000); stub('CAN0', 0x40040000, 0x1000); stub('CAN1', 0x40041000, 0x1000);
  stub('USB0', 0x40050000, 0x1000); stub('COMP', 0x4003C000, 0x1000); stub('EEPROM', 0x400AF000, 0x1000); stub('UDMA', 0x400FF000, 0x1000);
  stub('FLASH_CTRL', 0x400FD000, 0x1000); stub('HIB', 0x400FC000, 0x1000); stub('EMAC0', 0x40048000, 0x1000); stub('EPI0', 0x4000F000, 0x1000);
})();
M.REG_STUBS = STUBS;

/* ---------- name table (static) ---------- */
var NAMES = {};       // TivaWare style NAME_R -> {blk, reg}
var OFFS = {};        // DriverLib offset constants
var ALIAS = {
  SCS: { ISER0: 'EN0', ISER1: 'EN1', ISER2: 'EN2', ISER3: 'EN3', ISER4: 'EN4', ICER0: 'DIS0', ICER1: 'DIS1', ICER2: 'DIS2', ICER3: 'DIS3', ICER4: 'DIS4',
         ISPR0: 'PEND0', ISPR1: 'PEND1', ISPR2: 'PEND2', ISPR3: 'PEND3', ISPR4: 'PEND4', ICPR0: 'UNPEND0', ICPR1: 'UNPEND1', ICPR2: 'UNPEND2', ICPR3: 'UNPEND3', ICPR4: 'UNPEND4',
         IABR0: 'ACTIVE0', IABR1: 'ACTIVE1', IABR2: 'ACTIVE2', IABR3: 'ACTIVE3', IABR4: 'ACTIVE3' }
};
function indexBlock(b) {
  b.regs.forEach(function (r) {
    var pre = b.prefixes.length ? b.prefixes : [];
    pre.forEach(function (p) {
      var nm = (b.id === 'PWM0' && r.name.charAt(0) === '_') ? p + r.name : p + '_' + r.name;
      NAMES[nm + '_R'] = { b: b, r: r };
    });
    if (b.id === 'SCS') {
      var al = ALIAS.SCS[r.name];
      if (al) NAMES['NVIC_' + al + '_R'] = { b: b, r: r };
      var mm = /^IPR(\d+)$/.exec(r.name); if (mm) NAMES['NVIC_PRI' + mm[1] + '_R'] = { b: b, r: r };
      if (r.off === 0x010) NAMES.NVIC_ST_CTRL_R = { b: b, r: r };
      if (r.off === 0x014) NAMES.NVIC_ST_RELOAD_R = { b: b, r: r };
      if (r.off === 0x018) NAMES.NVIC_ST_CURRENT_R = { b: b, r: r };
      if (r.off === 0xD04) NAMES.NVIC_INT_CTRL_R = { b: b, r: r };
      if (r.off === 0xD0C) NAMES.NVIC_APINT_R = { b: b, r: r };
      if (r.off === 0xD10) NAMES.NVIC_SYS_CTRL_R = { b: b, r: r };
      if (r.off === 0xD88) NAMES.NVIC_CPAC_R = { b: b, r: r };
    }
    var kind = b.id.replace(/\d+$/, '').replace(/^GPIO[A-Z]$/, 'GPIO');
    if (!/^SCS$/.test(kind) && r.name.charAt(0) !== '_') OFFS[kind + '_O_' + r.name] = r.off;
  });
}
BLOCKS.forEach(indexBlock);
M.R = R; M.rawR = rawR;
M.addRegBlock = function (b) { addBlock(b); indexBlock(b); return b; };

// per-bit constants for the common clock-gate registers (SYSCTL_RCGCGPIO_R0 ... as in TivaWare)
var BITS = {};
for (var bi = 0; bi < 15; bi++) { BITS['SYSCTL_RCGCGPIO_R' + bi] = 1 << bi; BITS['SYSCTL_PRGPIO_R' + bi] = 1 << bi; }
for (bi = 0; bi < 8; bi++) { BITS['SYSCTL_RCGCTIMER_R' + bi] = 1 << bi; BITS['SYSCTL_RCGCUART_R' + bi] = 1 << bi; BITS['SYSCTL_PRTIMER_R' + bi] = 1 << bi; BITS['SYSCTL_PRUART_R' + bi] = 1 << bi; }
BITS.SYSCTL_RCGCADC_R0 = 1; BITS.SYSCTL_RCGCADC_R1 = 2; BITS.SYSCTL_RCGCPWM_R0 = 1;
BITS.TIMER_CTL_TAEN = 1; BITS.TIMER_CTL_TBEN = 0x100; BITS.TIMER_IMR_TATOIM = 1; BITS.TIMER_ICR_TATOCINT = 1; BITS.TIMER_RIS_TATORIS = 1;
BITS.UART_FR_TXFF = 0x20; BITS.UART_FR_RXFE = 0x10; BITS.UART_FR_BUSY = 8; BITS.UART_FR_TXFE = 0x80; BITS.UART_FR_RXFF = 0x40; BITS.UART_CTL_UARTEN = 1; BITS.UART_CTL_TXE = 0x100; BITS.UART_CTL_RXE = 0x200;
BITS.NVIC_ST_CTRL_ENABLE = 1; BITS.NVIC_ST_CTRL_INTEN = 2; BITS.NVIC_ST_CTRL_CLK_SRC = 4; BITS.NVIC_ST_CTRL_COUNT = 0x10000;
OFFS.GPIO_O_DATA = 0;
M.REGNAMES = NAMES; M.REGOFFS = OFFS; M.REGBITS = BITS; M.REGBLOCKS = BLOCKS;

/* ---------- bound instance ---------- */
function cost(S) { var c = 2 / S.clk; S.cpu += c; S.spent += c; }
function lookup(S, addr, peek) {
  var blk = BYPAGE[addr >>> 12];
  if (!blk) return null;
  var off = (addr - blk.base) >>> 0, r = blk.byOff[off];
  if (!r && blk.win && off < blk.win) r = blk.byOff[blk.win - 4];
  return r ? { b: blk, r: r, off: off } : { b: blk, r: null, off: off };
}
M.buildRegs = function (S) {
  var sram = null;
  function sramBuf() { return sram || (sram = new DataView(new ArrayBuffer(0x40000))); }
  function read32(addr, peek) {
    if (addr >= 0x20000000 && addr < 0x20040000) return sramBuf().getUint32(addr - 0x20000000, true);
    var L = lookup(S, addr, peek);
    if (!L) {
      var st = STUBS[addr >>> 12];
      if (st) { if (!peek) S.warn('stub' + st, st + ' registers are not simulated by this tool yet; the read returned 0.'); return 0; }
      if (peek) return 0;
      S.fault('Bus fault: read from ' + hex(addr) + ', which is not a peripheral register or RAM address on the MSP432E401Y (' + (addr < 0x100000 ? 'that range is Flash' : 'reserved') + ').');
    }
    if (!L.r) {
      if (peek) return 0;
      S.warn('res' + hex(addr), 'Read of ' + hex(addr) + ' (' + L.b.title + '+0x' + L.off.toString(16).toUpperCase() + '): there is no register at that offset; returned 0.'); return 0;
    }
    return u32(L.r.g(S, L.b.I, peek, L.off));
  }
  function write32(addr, val) {
    val = u32(val);
    if (addr >= 0x20000000 && addr < 0x20040000) { sramBuf().setUint32(addr - 0x20000000, val, true); return; }
    var L = lookup(S, addr);
    if (!L) {
      var st = STUBS[addr >>> 12];
      if (st) { S.warn('stub' + st, st + ' registers are not simulated by this tool yet; the write was ignored.'); return; }
      S.fault('Bus fault: write to ' + hex(addr) + ', which is not a peripheral register or RAM address on the MSP432E401Y.');
    }
    if (!L.r) { S.warn('res' + hex(addr), 'Write to ' + hex(addr) + ' (' + L.b.title + '+0x' + L.off.toString(16).toUpperCase() + '): there is no register at that offset; ignored.'); return; }
    if (!L.r.s) { S.warn('ro' + hex(addr), L.b.title + ' ' + L.r.name + ' is read-only; the write was ignored.'); return; }
    L.r.s(S, L.b.I, val, L.off);
  }
  function read(addr, size, peek) {
    addr = u32(addr); if (S.peeking) peek = true;
    if (!peek) { S.sync(); cost(S); }
    var a4 = addr & ~3, w = read32(a4, peek);
    if (size === 4) { if (addr & 3) S.fault('Unaligned 32-bit access at ' + hex(addr)); return w; }
    var sh = (addr & 3) * 8; return size === 2 ? (w >>> sh) & 0xFFFF : (w >>> sh) & 0xFF;
  }
  function write(addr, val, size) {
    addr = u32(addr); cost(S);
    if (size === 4) { if (addr & 3) S.fault('Unaligned 32-bit access at ' + hex(addr)); write32(addr, val); return; }
    var a4 = addr & ~3, w = read32(a4, true), sh = (addr & 3) * 8, mk = size === 2 ? 0xFFFF : 0xFF;
    write32(a4, ((w & ~(mk << sh)) | ((val & mk) << sh)) >>> 0);
  }
  /* typed memory windows for compiled code: __M32[addr] */
  function window(size) {
    return new Proxy({}, {
      get: function (t, k) { return read(+k, size, false); },
      set: function (t, k, v) { write(+k, v, size); return true; }
    });
  }
  /* pointer objects for (uint32_t *)0x40025000 style casts: p.v and p[i] */
  function ptr(addr, size) {
    return new Proxy({}, {
      get: function (t, k) { return k === 'v' ? read(addr, size, false) : read(addr + (+k) * size, size, false); },
      set: function (t, k, v) { if (k === 'v') write(addr, v, size); else write(addr + (+k) * size, v, size); return true; }
    });
  }
  /* __r.NAME_R */
  var rObj = {};
  Object.keys(NAMES).forEach(function (nm) {
    var e = NAMES[nm];
    Object.defineProperty(rObj, nm, {
      get: function () { return read(e.b.base + e.r.off, 4, false); },
      set: function (v) { write(e.b.base + e.r.off, v, 4); }
    });
  });
  var rProxy = new Proxy(rObj, { get: function (t, k) { if (typeof k === 'string' && !(k in t)) S.fault("'" + k + "' is not a register name this simulator knows."); return t[k]; } });
  /* CMSIS-style structs */
  function struct(b, sub) {
    var o = {};
    b.regs.forEach(function (r) {
      if (sub && !sub(r)) return;
      var nm = r.name;
      if (b.id === 'SCS') nm = r.name;
      Object.defineProperty(o, nm, { get: function () { return read(b.base + r.off, 4, false); }, set: function (v) { write(b.base + r.off, v, 4); }, enumerable: true });
    });
    return o;
  }
  var objs = {};
  BLOCKS.forEach(function (b) {
    if (b.id === 'SCS') return;
    var st = struct(b);
    if (/^GPIO/.test(b.id)) {
      var bitsObj = new Proxy({}, {
        get: function (t, k) { return read(b.base + (+k << 2), 4, false); },
        set: function (t, k, v) { write(b.base + (+k << 2), v, 4); return true; }
      });
      Object.defineProperty(st, 'DATA_BITS', { value: bitsObj, enumerable: true });
    }
    b.prefixes.forEach(function (p) { objs[p] = st; });
    if (/^GPIO[A-Z]$/.test(b.id)) objs[b.id] = st;
  });
  // GPIOA..GPIOQ short aliases follow the CMSIS header (GPIO_PORTN_AHB is the canonical name)
  var scs = BLOCKS.filter(function (b) { return b.id === 'SCS'; })[0];
  var nv = {}, sc = {}, sy = {};
  ['ISER', 'ICER', 'ISPR', 'ICPR', 'IABR'].forEach(function (pfx) {
    var a = [];
    for (var w = 0; w < 5; w++) (function (w) {
      var r = scs.byOff[{ ISER: 0x100, ICER: 0x180, ISPR: 0x200, ICPR: 0x280, IABR: 0x300 }[pfx] + 4 * w];
      Object.defineProperty(a, w, { get: function () { return read(scs.base + r.off, 4, false); }, set: function (v) { write(scs.base + r.off, v, 4); }, enumerable: true });
    })(w);
    nv[pfx] = a;
  });
  nv.IP = new Proxy({}, {
    get: function (t, k) { var irq = +k; return (read(scs.base + 0x400 + (irq & ~3), 4, false) >>> ((irq & 3) * 8)) & 0xFF; },
    set: function (t, k, v) { write(scs.base + 0x400 + (+k), v, 1); return true; }
  });
  scs.regs.forEach(function (r) {
    var tgt = r.off >= 0xD00 ? sc : r.off < 0x100 ? sy : null; if (!tgt) return;
    Object.defineProperty(tgt, r.name, { get: function () { return read(scs.base + r.off, 4, false); }, set: function (v) { write(scs.base + r.off, v, 4); }, enumerable: true });
  });
  objs.SysTick = sy; objs.NVIC = nv; objs.SCB = sc;
  /* debugger / UI helpers */
  function dump(id) {
    var b = BLOCKS.filter(function (x) { return x.id === id; })[0]; if (!b) return [];
    return b.regs.map(function (r) { var v; try { v = r.g(S, b.I, true, r.off); } catch (e) { v = 0; } return { name: r.name, addr: b.base + r.off, value: u32(v), ro: !r.s }; });
  }
  return { read: read, write: write, peek: function (a, sz) { return read(a, sz || 4, true); }, M8: window(1), M16: window(2), M32: window(4), ptr: ptr, r: rProxy, objs: objs, dump: dump, blocks: BLOCKS };
};
return M;
})(typeof MSP !== "undefined" ? MSP : require("./core.js"));
