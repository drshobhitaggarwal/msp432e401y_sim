/* MSP432E401Y simulator: DriverLib-style API, constants, printf */
(function (M) {
'use strict';
var P = M.Sim.prototype, PORTS = M.PORTS;

/* ---------- constants ---------- */
var K = { NULL: 0, UINT32_MAX: 0xFFFFFFFF, INT32_MAX: 0x7FFFFFFF };
var GB = {}, TB = {}, UB = {}, PK = {}, INTN = {}, CFG = {}, PINMAPLOCAL = {};
M.PINFN.forEach(function (d) { PINMAPLOCAL[d[0] + d[1] + ':' + d[2]] = d[4]; });
PORTS.forEach(function (L, i) {
  var base = 0x40058000 + i * 0x1000;
  K['GPIO_PORT' + L + '_BASE'] = base; K['GPIO_PORT' + L + '_AHB_BASE'] = base; GB[base] = L;   // SimpleLink SDK also has the _AHB_ names
  K['SYSCTL_PERIPH_GPIO' + L] = 0xf0000800 + i; PK[0xf0000800 + i] = 'GPIO' + L;
});
for (var i = 0; i < 8; i++) {
  K['GPIO_PIN_' + i] = 1 << i;
  K['TIMER' + i + '_BASE'] = 0x40030000 + i * 0x1000; TB[0x40030000 + i * 0x1000] = i;
  K['SYSCTL_PERIPH_TIMER' + i] = 0xf0000400 + i; PK[0xf0000400 + i] = 'TIMER' + i;
  K['UART' + i + '_BASE'] = 0x4000C000 + i * 0x1000; UB[0x4000C000 + i * 0x1000] = i;
  K['SYSCTL_PERIPH_UART' + i] = 0xf0001800 + i; PK[0xf0001800 + i] = 'UART' + i;
}
K.ADC0_BASE = 0x40038000; K.ADC1_BASE = 0x40039000;
K.SYSCTL_PERIPH_ADC0 = 0xf0003800; K.SYSCTL_PERIPH_ADC1 = 0xf0003801; PK[0xf0003800] = 'ADC0'; PK[0xf0003801] = 'ADC1';
K.PWM0_BASE = 0x40028000; K.SYSCTL_PERIPH_PWM0 = 0xf0004000; PK[0xf0004000] = 'PWM0';
PK[0xf0002000] = 'I2C0'; PK[0xf0001c00] = 'SSI0';
K.GPIO_PIN_ALL = 0xFF;
K.GPIO_STRENGTH_2MA = 1; K.GPIO_STRENGTH_4MA = 2; K.GPIO_STRENGTH_6MA = 3; K.GPIO_STRENGTH_8MA = 4;
K.GPIO_PIN_TYPE_STD = 8; K.GPIO_PIN_TYPE_STD_WPU = 10; K.GPIO_PIN_TYPE_STD_WPD = 12;
K.GPIO_PIN_TYPE_OD = 9; K.GPIO_PIN_TYPE_ANALOG = 0;
K.GPIO_DIR_MODE_IN = 0; K.GPIO_DIR_MODE_OUT = 1; K.GPIO_DIR_MODE_HW = 2;
K.GPIO_FALLING_EDGE = 0; K.GPIO_RISING_EDGE = 4; K.GPIO_BOTH_EDGES = 8; K.GPIO_LOW_LEVEL = 2; K.GPIO_HIGH_LEVEL = 6;
K.SYSCTL_XTAL_25MHZ = 0x380; K.SYSCTL_OSC_MAIN = 0; K.SYSCTL_USE_PLL = 0x2000; K.SYSCTL_USE_OSC = 0x3800;
K.SYSCTL_CFG_VCO_480 = 0xF1000000; K.SYSCTL_CFG_VCO_320 = 0xF0000000; K.SYSCTL_XTAL_16MHZ = 0x340;
K.UART_CONFIG_WLEN_8 = 0x60; K.UART_CONFIG_WLEN_7 = 0x40; K.UART_CONFIG_STOP_ONE = 0; K.UART_CONFIG_STOP_TWO = 8;
K.UART_CONFIG_PAR_NONE = 0; K.UART_CONFIG_PAR_EVEN = 0x6; K.UART_CONFIG_PAR_ODD = 0x2;
K.UART_INT_RX = 0x10; K.UART_INT_TX = 0x20; K.UART_INT_RT = 0x40;
K.TIMER_A = 0xFF; K.TIMER_B = 0xFF00; K.TIMER_BOTH = 0xFFFF;
K.TIMER_CFG_ONE_SHOT = 0x21; K.TIMER_CFG_PERIODIC = 0x22; K.TIMER_CFG_SPLIT_PAIR = 0x04000000;
K.TIMER_CFG_A_ONE_SHOT = 0x21; K.TIMER_CFG_A_PERIODIC = 0x22; K.TIMER_CFG_B_ONE_SHOT = 0x2100; K.TIMER_CFG_B_PERIODIC = 0x2200;
K.TIMER_TIMA_TIMEOUT = 1; K.TIMER_TIMB_TIMEOUT = 0x100;
K.ADC_TRIGGER_PROCESSOR = 0; K.ADC_TRIGGER_TIMER = 5; K.ADC_TRIGGER_ALWAYS = 0xF;
for (i = 0; i < 20; i++) K['ADC_CTL_CH' + i] = i;
K.ADC_CTL_TS = 0x80; K.ADC_CTL_IE = 0x40; K.ADC_CTL_END = 0x20; K.ADC_CTL_D = 0x10;
for (i = 0; i < 4; i++) K['PWM_GEN_' + i] = [0x40, 0x80, 0xC0, 0x100][i];
var POUT = [0x40, 0x41, 0x60, 0x61, 0x80, 0x81, 0xA0, 0xA1];
for (i = 0; i < 8; i++) { K['PWM_OUT_' + i] = POUT[i]; K['PWM_OUT_' + i + '_BIT'] = 1 << i; }
K.PWM_GEN_MODE_DOWN = 0; K.PWM_GEN_MODE_UP_DOWN = 2; K.PWM_GEN_MODE_NO_SYNC = 0; K.PWM_GEN_MODE_SYNC = 0x38;
K.PWM_SYSCLK_DIV_1 = 0; K.PWM_SYSCLK_DIV_2 = 0x100; K.PWM_SYSCLK_DIV_4 = 0x101; K.PWM_SYSCLK_DIV_8 = 0x102;
K.PWM_SYSCLK_DIV_16 = 0x103; K.PWM_SYSCLK_DIV_32 = 0x104; K.PWM_SYSCLK_DIV_64 = 0x105;
// pin mux codes (TivaWare/DriverLib encoding: port index << 16 | pin*4 << 8 | mux)
M.PINFN.forEach(function (d) {
  var v = (PORTS.indexOf(d[0]) << 16) | (d[1] * 4 << 8) | d[2]; v = v >>> 0;
  K['GPIO_P' + d[0] + d[1] + '_' + d[3]] = v; CFG[v] = d;
});
// interrupt numbers: INT_* = 16 + IRQ number (DriverLib), *_IRQn = IRQ number (CMSIS)
K.INT_SYSTICK = 15; INTN[15] = 'systick'; K.SysTick_IRQn = -1;
Object.keys(M.IRQN).forEach(function (n) { var u = n.toUpperCase(); K['INT_' + u] = 16 + M.IRQN[n]; INTN[16 + M.IRQN[n]] = n; K[u + '_IRQn'] = M.IRQN[n]; });
if (M.busConsts) M.busConsts(K);
K.INT_WATCHDOG = 34; K.INT_PWM0_FAULT = 25; K.INT_PWM0_0 = 26; K.INT_PWM0_1 = 27; K.INT_PWM0_2 = 28; K.INT_PWM0_3 = 59;
M.K = K;

/* ---------- helpers ---------- */
function cstr(a) {
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) { var s = ''; for (var j = 0; j < a.length && a[j]; j++) s += String.fromCharCode(a[j]); return s; }
  return a === undefined || a === null ? '(null)' : String(a);
}
function pad(s, w, left, zero) {
  if (!w || s.length >= w) return s;
  if (left) return s + new Array(w - s.length + 1).join(' ');
  if (zero) { var sg = /^[+-]/.test(s) ? s[0] : ''; return sg + new Array(w - s.length + 1).join('0') + s.slice(sg.length); }
  return new Array(w - s.length + 1).join(' ') + s;
}
function fmt(f, args, floats) {
  var ai = 0;
  return cstr(f).replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(hh|h|ll|l|z)?([diuxXcsfp%])/g, function (all, fl, w, pr, len, sp) {
    if (sp === '%') return '%';
    var v = args[ai++], s;
    switch (sp) {
      case 'd': case 'i': s = String(v | 0); if (fl.indexOf('+') >= 0 && (v | 0) >= 0) s = '+' + s; break;
      case 'u': s = String(v >>> 0); break;
      case 'x': s = (v >>> 0).toString(16); break;
      case 'X': s = (v >>> 0).toString(16).toUpperCase(); break;
      case 'p': s = '0x' + (v >>> 0).toString(16); break;
      case 'c': s = String.fromCharCode(v); break;
      case 's': s = cstr(v); if (pr !== undefined) s = s.slice(0, +pr); break;
      case 'f': if (!floats) return 'ERROR'; s = Number(v).toFixed(pr === undefined ? 6 : +pr); break;
    }
    return pad(s, w ? +w : 0, fl.indexOf('-') >= 0, fl.indexOf('0') >= 0 && sp !== 's' && sp !== 'c');
  });
}
M.fmt = fmt;
function bits(m) { var a = []; for (var b = 0; b < 8; b++) if (m & (1 << b)) a.push(b); return a; }
function which(t) { var a = []; if (t & 0xFF) a.push('A'); if (t & 0xFF00) a.push('B'); return a; }

P.analogV = function (ch, t) {
  var c = this.analogCfg[ch]; if (!c) return 0;
  var v = c.v;
  if (c.mode === 'sine1') v += 0.8 * Math.sin(2 * Math.PI * t);
  else if (c.mode === 'sine10') v += 0.8 * Math.sin(2 * Math.PI * 10 * t);
  else if (c.mode === 'noise') v += (Math.random() - 0.5) * 0.2;
  return Math.max(0, Math.min(3.3, v));
};
P.pwmChanged = function () { this.gpioAll(); this.touch(); };
P.uartEnq = function (ch) {
  var S = this, u = this.u, a = this.gpio.A;
  if (!(a.alt[0] && a.alt[1])) this.warn('uartpins', 'UART0 pins PA0/PA1 are not set up (GPIOPinConfigure + GPIOPinTypeUART). On a real board nothing would reach the PC.');
  var end = Math.max(this.T(), u.txEnd) + 10 / u.baud;
  u.txEnd = end; u.txq.push(end);
  this.at(end, function () { S.onTx(String.fromCharCode(ch), end); });
};
P.uartRx = function (str) {                     // text typed in the terminal
  var S = this, u = this.u;
  for (var j = 0; j < str.length; j++) {
    (function (c) {
      u.rxEnd = Math.max(S.now, u.rxEnd) + 10 / u.baud;
      S.at(u.rxEnd, function () {
        if (!u.en) return;
        if (u.rx.length < 16) u.rx.push(c);
        u.ris |= 0x50; S.touch();
      });
    })(str.charCodeAt(j) & 0xFF);
  }
};

P.adcStart = function (ai, n) {
  var S = this, q = this.adc[ai].seq[n], depth = [8, 4, 4, 1][n], t0 = S.T();
  if (!q.en || q.trig !== 0) return;
  var steps = [], j;
  for (j = 0; j < q.steps.length && q.steps[j] !== undefined; j++) { steps.push(q.steps[j]); if (q.steps[j] & 0x20) break; }
  if (!steps.length) S.fault('ADC trigger: sequencer ' + n + ' has no steps. Call ADCSequenceStepConfigure() (or write SSMUX/SSCTL) first.');
  var done = t0 + (steps.length + 0.5) * 1e-6;
  S.cancel(q.ev);
  q.ev = S.at(done, function () {
    var ie = false;
    steps.forEach(function (c, k) {
      var ts = t0 + (k + 0.5) * 1e-6, v;
      if (c & 0x80) v = (147.5 - S.tempC) * 4096 / (75 * 3.3);
      else v = S.analogV(c & 0x1F, ts) / 3.3 * 4095;
      if (q.fifo.length < depth) q.fifo.push(Math.max(0, Math.min(4095, Math.round(v))));
      if (c & 0x40) ie = true;
    });
    if (ie) q.ris = 1;
    S.touch();
  });
};

/* ---------- API factory ---------- */
M.buildApi = function (S) {
  var A = {}, WAIT = M.WAITPOLL;
  function gp(base, api) {
    var L = GB[base];
    if (!L) S.fault(api + ': 0x' + (base >>> 0).toString(16) + ' is not a GPIO port base address.');
    S.need('GPIO' + L, api);
    var p = S.gpio[L]; p.used = 1; S._L = L; return p;
  }
  function tim(base, api) {
    var n = TB[base];
    if (n === undefined) S.fault(api + ': 0x' + (base >>> 0).toString(16) + ' is not a timer base address.');
    S.need('TIMER' + n, api); S._n = n; return S.timers[n];
  }
  function uart(base, api) {
    if (UB[base] !== 0) S.fault(api + ': only UART0 (the USB virtual COM port) is simulated.');
    S.need('UART0', api); return S.u;
  }
  function adc(base, api) {
    var n = base === K.ADC0_BASE ? 0 : base === K.ADC1_BASE ? 1 : -1;
    if (n < 0) S.fault(api + ': not an ADC base address.');
    S.need('ADC' + n, api); return S.adc[n];
  }
  function irqName(v, api) { var n = INTN[v]; if (!n) S.fault(api + ': unknown interrupt number ' + v + '. Use an INT_ constant such as INT_TIMER0A.'); return n; }

  /* system control */
  A.SysCtlClockFreqSet = function (cfg, f) { S.clk = Math.min(120e6, f); return S.clk; };
  A.SysCtlClockGet = function () { return S.clk; };
  A.SysCtlPeripheralEnable = function (v) { var k = PK[v]; if (!k) S.fault('SysCtlPeripheralEnable: unknown peripheral constant.'); S.periph[k] = true; };
  A.SysCtlPeripheralDisable = function (v) { delete S.periph[PK[v]]; };
  A.SysCtlPeripheralReady = function (v) { return S.periph[PK[v]] ? 1 : 0; };
  A.SysCtlPeripheralReset = function () {};
  A.SysCtlDelay = function* (n) { yield { wait: true, until: S.T() + 3 * (n >>> 0) / S.clk }; };
  A.SysCtlSleep = A.__WFI = function* () { var c = S.irqCount; while (S.irqCount === c) yield WAIT; };
  A.IntMasterEnable = A.__enable_irq = function () { S.master = true; S.touch(); return 1; };
  A.IntMasterDisable = A.__disable_irq = function () { S.master = false; return 1; };
  A.IntEnable = function (v) { S.nvic[irqName(v, 'IntEnable')] = true; S.touch(); };
  A.IntDisable = function (v) { delete S.nvic[irqName(v, 'IntDisable')]; };
  A.IntRegister = function (v, fn) { S.handlers[irqName(v, 'IntRegister')] = fn; };
  A.IntPendClear = function () {};

  /* GPIO */
  A.GPIOPinTypeGPIOOutput = function (b, pins) {
    var p = gp(b, 'GPIOPinTypeGPIOOutput'), L = S._L;
    p.afsel &= ~pins; bits(pins).forEach(function (n) { delete p.alt[n]; }); p.dir |= pins; p.den |= pins; p.analog &= ~pins; S.gpioUpdate(L);
  };
  A.GPIOPinTypeGPIOInput = function (b, pins) {
    var p = gp(b, 'GPIOPinTypeGPIOInput'), L = S._L;
    p.afsel &= ~pins; bits(pins).forEach(function (n) { delete p.alt[n]; }); p.dir &= ~pins; p.den |= pins; p.analog &= ~pins; S.gpioUpdate(L);
  };
  A.GPIODirModeSet = function (b, pins, mode) {
    var p = gp(b, 'GPIODirModeSet'); if (mode === 1) p.dir |= pins; else p.dir &= ~pins; S.gpioUpdate(S._L);
  };
  A.GPIOPadConfigSet = function (b, pins, strength, type) {
    var p = gp(b, 'GPIOPadConfigSet');
    p.pur &= ~pins; p.pdr &= ~pins;
    if (type === 10) p.pur |= pins; else if (type === 12) p.pdr |= pins;
    p.den |= pins; S.gpioUpdate(S._L);
  };
  A.GPIOPinConfigure = function (cfg) {
    var d = CFG[cfg >>> 0];
    if (!d) S.fault('GPIOPinConfigure: unsupported pin function 0x' + (cfg >>> 0).toString(16) + ' (the simulator supports M0PWM0-7, U0RX/U0TX, I2C0SCL/SDA and SSI0).');
    var p = S.gpio[d[0]]; p.pctl = ((p.pctl & ~(15 << (4 * d[1]))) | (d[2] << (4 * d[1]))) >>> 0; S.need('GPIO' + d[0], 'GPIOPinConfigure');
  };
  function altType(name, prefix) {
    return function (b, pins) {
      var p = gp(b, name), L = S._L;
      bits(pins).forEach(function (n) {
        var f = PINMAPLOCAL[L + n + ':' + ((p.pctl >>> (4 * n)) & 15)];
        if (!(f && f.indexOf(prefix) === 0)) S.warn(name + L + n, name + ': P' + L + n + ' has no ' + prefix.toUpperCase() + ' function selected. Call GPIOPinConfigure() with the matching GPIO_P' + L + n + '_... constant first.');
      });
      p.afsel |= pins; p.den |= pins; p.analog &= ~pins; S.pinMux(L);
    };
  }
  A.GPIOPinTypePWM = altType('GPIOPinTypePWM', 'pwm');
  A.GPIOPinTypeUART = altType('GPIOPinTypeUART', 'u');
  var i2cType = altType('GPIOPinTypeI2C', 'i2c');
  A.GPIOPinTypeI2C = function (b, pins) { i2cType(b, pins); var p = gp(b, 'GPIOPinTypeI2C'); p.raw[0x50C] = ((p.raw[0x50C] || 0) | pins) >>> 0; };      // SDA is open-drain
  A.GPIOPinTypeI2CSCL = altType('GPIOPinTypeI2CSCL', 'i2c');
  A.GPIOPinTypeSSI = altType('GPIOPinTypeSSI', 'ssi');
  A.GPIOPinTypeADC = function (b, pins) {
    var p = gp(b, 'GPIOPinTypeADC'); p.afsel &= ~pins; bits(pins).forEach(function (n) { delete p.alt[n]; });
    p.analog |= pins; p.den &= ~pins; p.dir &= ~pins; S.gpioUpdate(S._L);
  };
  A.GPIOPinWrite = function (b, mask, val) {
    var p = gp(b, 'GPIOPinWrite'); p.out = (p.out & ~mask) | (val & mask); S.gpioUpdate(S._L);
  };
  A.GPIOPinRead = function (b, mask) {
    var p = gp(b, 'GPIOPinRead'); S.sync(); var r = 0;
    for (var n = 0; n < 8; n++) { var m = 1 << n; if ((mask & m) && (p.den & m) && p.dig[n]) r |= m; }
    return r;
  };
  A.GPIOIntTypeSet = function (b, pins, type) {
    var p = gp(b, 'GPIOIntTypeSet');
    p.is &= ~pins; p.ibe &= ~pins; p.iev &= ~pins;
    if (type & 2) p.is |= pins;
    if (type & 8) p.ibe |= pins; else if (type & 4) p.iev |= pins;
    S.gpioUpdate(S._L);
  };
  A.GPIOIntEnable = function (b, f) { var p = gp(b, 'GPIOIntEnable'); p.im |= f; S.touch(); };
  A.GPIOIntDisable = function (b, f) { var p = gp(b, 'GPIOIntDisable'); p.im &= ~f; };
  A.GPIOIntClear = function (b, f) { var p = gp(b, 'GPIOIntClear'); p.ris &= ~f; S.gpioUpdate(S._L); };
  A.GPIOIntStatus = function (b, masked) { var p = gp(b, 'GPIOIntStatus'); S.sync(); return masked ? p.ris & p.im : p.ris; };
  A.GPIOIntRegister = function (b, fn) { gp(b, 'GPIOIntRegister'); S.handlers['gpio' + S._L.toLowerCase()] = fn; };

  /* timers */
  A.TimerConfigure = function (b, cfg) {
    var t = tim(b, 'TimerConfigure');
    if (cfg & 0x04000000) { t.split = true; t.A.mode = cfg & 0xFF; t.B.mode = (cfg >> 8) & 0xFF; t.A.load = t.B.load = 0xFFFF; }
    else { t.split = false; t.A.mode = cfg & 0xFF; }
  };
  A.TimerLoadSet = function (b, timer, v) { var t = tim(b, 'TimerLoadSet'); which(timer).forEach(function (w) { t[w].load = (t.split ? v & 0xFFFF : v >>> 0); }); };
  A.TimerEnable = function (b, timer) {
    var t = tim(b, 'TimerEnable'), n = S._n;
    which(timer).forEach(function (w) { if (!t[w].mode) S.fault('TimerEnable: TIMER' + n + ' was not configured. Call TimerConfigure() first.'); S.timerStart(n, w); });
  };
  A.TimerDisable = function (b, timer) { var t = tim(b, 'TimerDisable'), n = S._n; which(timer).forEach(function (w) { S.timerStop(n, w); }); };
  A.TimerIntEnable = function (b, f) { var t = tim(b, 'TimerIntEnable'); if (f & 1) t.A.mask |= 1; if (f & 0x100) t.B.mask |= 1; S.touch(); };
  A.TimerIntDisable = function (b, f) { var t = tim(b, 'TimerIntDisable'); if (f & 1) t.A.mask &= ~1; if (f & 0x100) t.B.mask &= ~1; };
  A.TimerIntClear = function (b, f) { var t = tim(b, 'TimerIntClear'); S.sync(); if (f & 1) t.A.ris = 0; if (f & 0x100) t.B.ris = 0; S.touch(); };
  A.TimerIntStatus = function (b, masked) {
    var t = tim(b, 'TimerIntStatus'); S.sync();
    return ((masked ? t.A.ris & t.A.mask : t.A.ris) ? 1 : 0) | ((masked ? t.B.ris & t.B.mask : t.B.ris) ? 0x100 : 0);
  };
  A.TimerValueGet = function (b, timer) {
    tim(b, 'TimerValueGet'); return S.timerVal(S._n, timer === K.TIMER_B ? 'B' : 'A');
  };
  A.TimerPrescaleSet = function (b, timer, v) { var t = tim(b, 'TimerPrescaleSet'); which(timer).forEach(function (w) { t[w].pre = v & 0xFF; }); };
  A.TimerIntRegister = function (b, timer, fn) { tim(b, 'TimerIntRegister'); S.handlers['timer' + S._n + (timer === K.TIMER_B ? 'b' : 'a')] = fn; };

  /* SysTick */
  A.SysTickPeriodSet = function (p) { S.st.period = (p >>> 0) - 1 < 0 ? 0 : (p >>> 0) - 1; };
  A.SysTickEnable = function () { if (!S.st.en) { S.st.en = true; S.stArm(S.T()); } };
  A.SysTickDisable = function () { S.st.en = false; S.cancel(S.st.ev); };
  A.SysTickIntEnable = function () { S.st.inten = true; S.touch(); };
  A.SysTickIntDisable = function () { S.st.inten = false; };
  A.SysTickIntRegister = function (fn) { S.handlers.systick = fn; };
  A.SysTickValueGet = function () {
    if (!S.st.en) return 0;
    var per = S.st.period + 1, el = Math.floor((S.T() - S.st.start) * (S.st.rate || S.clk));
    return per - 1 - (el % per);
  };

  /* UART0 */
  A.UARTConfigSetExpClk = function (b, clk, baud) { var u = uart(b, 'UARTConfigSetExpClk'); u.baud = baud; u.cfg = true; u.en = true; };
  A.UARTStdioConfig = function (n, baud, clk) { S.need('UART0', 'UARTStdioConfig'); S.u.baud = baud; S.u.cfg = true; S.u.en = true; };
  A.UARTEnable = function (b) { uart(b, 'UARTEnable').en = true; };
  A.UARTDisable = function (b) { uart(b, 'UARTDisable').en = false; };
  A.UARTFIFOEnable = A.UARTFIFODisable = A.UARTFIFOLevelSet = function () {};
  function purge() { var q = S.u.txq, t = S.T(); while (q.length && q[0] <= t) q.shift(); }
  function* put(ch) {
    var u = S.u;
    if (!u.en) { S.warn('uartoff', 'UART0 is not enabled. Call UARTStdioConfig() or UARTConfigSetExpClk() first; nothing is transmitted until you do.'); return; }
    for (;;) { purge(); if (u.txq.length < 16) break; yield { wait: true, until: u.txq[0] }; }
    S.uartEnq(ch & 0xFF);
  }
  function* putStr(s) { for (var j = 0; j < s.length; j++) yield* put(s.charCodeAt(j)); }
  A.UARTCharPut = function* (b, ch) { uart(b, 'UARTCharPut'); yield* put(ch); };
  A.UARTCharPutNonBlocking = function (b, ch) {
    var u = uart(b, 'UARTCharPutNonBlocking'); purge();
    if (!u.en || u.txq.length >= 16) return 0; S.uartEnq(ch & 0xFF); return 1;
  };
  A.UARTCharGet = function* (b) { var u = uart(b, 'UARTCharGet'); while (!u.rx.length) yield WAIT; return u.rx.shift(); };
  A.UARTCharGetNonBlocking = function (b) { var u = uart(b, 'UARTCharGetNonBlocking'); S.sync(); return u.rx.length ? u.rx.shift() : -1; };
  A.UARTCharsAvail = function (b) { var u = uart(b, 'UARTCharsAvail'); S.sync(); return u.rx.length ? 1 : 0; };
  A.UARTSpaceAvail = function (b) { uart(b, 'UARTSpaceAvail'); purge(); return S.u.txq.length < 16 ? 1 : 0; };
  A.UARTBusy = function (b) { uart(b, 'UARTBusy'); purge(); return S.u.txq.length ? 1 : 0; };
  A.UARTIntEnable = function (b, f) { uart(b, 'UARTIntEnable').im |= f; S.touch(); };
  A.UARTIntDisable = function (b, f) { uart(b, 'UARTIntDisable').im &= ~f; };
  A.UARTIntClear = function (b, f) { uart(b, 'UARTIntClear').ris &= ~f; S.touch(); };
  A.UARTIntStatus = function (b, masked) { var u = uart(b, 'UARTIntStatus'); S.sync(); return masked ? u.ris & u.im : u.ris; };
  A.UARTIntRegister = function (b, fn) { uart(b, 'UARTIntRegister'); S.handlers.uart0 = fn; };
  A.UARTprintf = function* (f) { var a = Array.prototype.slice.call(arguments, 1); yield* putStr(fmt(f, a, false)); };
  A.UARTwrite = function* (s, n) { yield* putStr(cstr(s).slice(0, n)); };
  A.printf = function* (f) { var a = Array.prototype.slice.call(arguments, 1); yield* putStr(fmt(f, a, true)); };
  A.puts = function* (s) { yield* putStr(cstr(s) + '\n'); };
  A.putchar = function* (c) { yield* put(c); return c; };

  /* ADC */
  A.ADCSequenceConfigure = function (b, n, trig) {
    var q = adc(b, 'ADCSequenceConfigure').seq[n]; q.trig = trig; q.steps = [];
    if (trig !== 0) S.warn('adctrig', 'Only ADC_TRIGGER_PROCESSOR is simulated; other triggers never start a conversion.');
  };
  A.ADCSequenceStepConfigure = function (b, n, step, cfg) { adc(b, 'ADCSequenceStepConfigure').seq[n].steps[step] = cfg; };
  A.ADCSequenceEnable = function (b, n) { adc(b, 'ADCSequenceEnable').seq[n].en = true; };
  A.ADCSequenceDisable = function (b, n) { adc(b, 'ADCSequenceDisable').seq[n].en = false; };
  A.ADCReferenceSet = A.ADCHardwareOversampleConfigure = A.ADCClockConfigSet = function () {};
  A.ADCProcessorTrigger = function (b, n) { adc(b, 'ADCProcessorTrigger'); S.adcStart(b === K.ADC1_BASE ? 1 : 0, n); };
  A.ADCIntStatus = function (b, n, masked) { var q = adc(b, 'ADCIntStatus').seq[n]; S.sync(); return masked ? (q.ris && q.im ? 1 : 0) : q.ris; };
  A.ADCIntClear = function (b, n) { adc(b, 'ADCIntClear').seq[n].ris = 0; S.touch(); };
  A.ADCIntEnable = function (b, n) { adc(b, 'ADCIntEnable').seq[n].im = 1; S.touch(); };
  A.ADCIntDisable = function (b, n) { adc(b, 'ADCIntDisable').seq[n].im = 0; };
  A.ADCIntRegister = function (b, n, fn) { var a = adc(b, 'ADCIntRegister'); S.handlers['adc' + (b === K.ADC1_BASE ? 1 : 0) + 'ss' + n] = fn; };
  A.ADCSequenceDataGet = function (b, n, buf) {
    var q = adc(b, 'ADCSequenceDataGet').seq[n], c = q.fifo.length;
    if (Array.isArray(buf)) q.fifo.forEach(function (v, k) { buf[k] = v; });
    else if (buf && 'v' in buf) buf.v = q.fifo[0];
    q.fifo = []; return c;
  };

  /* PWM0 */
  function gi(g, api) { var k = [0x40, 0x80, 0xC0, 0x100].indexOf(g); if (k < 0) S.fault(api + ': invalid PWM generator (use PWM_GEN_0 to PWM_GEN_3).'); return k; }
  A.PWMClockSet = function (b, d) { S.need('PWM0', 'PWMClockSet'); S.pwm.div = d ? 2 << (d & 7) : 1; S.pwmChanged(); };
  A.PWMGenConfigure = function (b, g) { S.need('PWM0', 'PWMGenConfigure'); gi(g, 'PWMGenConfigure'); };
  A.PWMGenPeriodSet = function (b, g, per) { S.need('PWM0', 'PWMGenPeriodSet'); S.pwm.gens[gi(g, 'PWMGenPeriodSet')].period = per >>> 0; S.pwmChanged(); };
  A.PWMPulseWidthSet = function (b, o, w) {
    S.need('PWM0', 'PWMPulseWidthSet'); var n = POUT.indexOf(o);
    if (n < 0) S.fault('PWMPulseWidthSet: invalid output (use PWM_OUT_0 to PWM_OUT_7).');
    S.pwm.pulse[n] = w >>> 0; S.pwmChanged();
  };
  A.PWMOutputState = function (b, m, en) { S.need('PWM0', 'PWMOutputState'); if (en) S.pwm.outEn |= m; else S.pwm.outEn &= ~m; S.pwmChanged(); };
  A.PWMGenEnable = function (b, g) { S.need('PWM0', 'PWMGenEnable'); S.pwm.gens[gi(g, 'PWMGenEnable')].en = true; S.pwmChanged(); };
  A.PWMGenDisable = function (b, g) { S.need('PWM0', 'PWMGenDisable'); S.pwm.gens[gi(g, 'PWMGenDisable')].en = false; S.pwmChanged(); };

  /* small C library */
  A.sprintf = function (buf, f) {
    var s = fmt(f, Array.prototype.slice.call(arguments, 2), true);
    for (var j = 0; j < s.length; j++) buf[j] = s.charCodeAt(j); buf[s.length] = 0; return s.length;
  };
  A.snprintf = function (buf, n, f) {
    var s = fmt(f, Array.prototype.slice.call(arguments, 3), true).slice(0, Math.max(0, n - 1));
    for (var j = 0; j < s.length; j++) buf[j] = s.charCodeAt(j); buf[s.length] = 0; return s.length;
  };
  A.strlen = function (s) { return cstr(s).length; };
  A.strcmp = function (a, b) { a = cstr(a); b = cstr(b); return a < b ? -1 : a > b ? 1 : 0; };
  A.strcpy = function (d, s) { s = cstr(s); for (var j = 0; j < s.length; j++) d[j] = s.charCodeAt(j); d[s.length] = 0; return d; };
  A.memset = function (d, v, n) { for (var j = 0; j < n; j++) d[j] = v; return d; };
  A.abs = A.labs = Math.abs; A.fabs = A.fabsf = Math.abs;
  A.sqrt = A.sqrtf = Math.sqrt; A.sin = A.sinf = Math.sin; A.cos = A.cosf = Math.cos; A.tan = A.tanf = Math.tan;
  A.pow = A.powf = Math.pow; A.floor = A.floorf = Math.floor; A.ceil = A.ceilf = Math.ceil;
  A.round = A.roundf = Math.round; A.log = A.logf = Math.log; A.log10 = Math.log10; A.exp = A.expf = Math.exp;
  A.fmin = A.fminf = Math.min; A.fmax = A.fmaxf = Math.max; A.atan2 = A.atan2f = Math.atan2;

  if (M.busApi) M.busApi(S, A, K, WAIT);

  /* loop budget used by compiled code */
  A.__chk = function () { var c = 10 / S.clk; S.cpu += c; S.spent += c; return S.spent >= 400 / S.clk; };
  A.__ref = function (get, set) { return { get v() { return get(); }, set v(x) { set(x); } }; };
  A.__mk = function (dims, i) { i = i || 0; var a = []; for (var j = 0; j < dims[i]; j++) a.push(i + 1 < dims.length ? A.__mk(dims, i + 1) : 0); return a; };
  A.__trunc = function (x) { return Math.trunc(x); };
  A.__cs = function (s) { if (typeof s !== 'string') return s; var a = []; for (var j = 0; j < s.length; j++) a.push(s.charCodeAt(j)); a.push(0); return a; };

  // each plain call costs a few cycles
  Object.keys(A).forEach(function (k) {
    var f = A[k];
    if (k.charAt(0) !== '_' && typeof f === 'function' && f.constructor && f.constructor.name !== 'GeneratorFunction') {
      A[k] = function () { var c = 20 / S.clk; S.cpu += c; S.spent += c; return f.apply(null, arguments); };
    }
  });
  Object.keys(K).forEach(function (k) { A[k] = K[k]; });
  /* register-level access (regs.js) */
  var RG = S.getRegs();
  A.__r = RG.r; A.__M8 = RG.M8; A.__M16 = RG.M16; A.__M32 = RG.M32;
  A.__P8 = function (a) { return RG.ptr(a, 1); }; A.__P16 = function (a) { return RG.ptr(a, 2); }; A.__P32 = function (a) { return RG.ptr(a, 4); };
  Object.keys(RG.objs).forEach(function (k) { A[k] = RG.objs[k]; });
  Object.keys(M.REGBITS).forEach(function (k) { A[k] = M.REGBITS[k]; });
  Object.keys(M.REGOFFS).forEach(function (k) { A[k] = M.REGOFFS[k]; });
  var base = { SYSCTL_BASE: 0x400FE000, NVIC_BASE: 0xE000E100, SCB_BASE: 0xE000ED00, SYSTICK_BASE: 0xE000E010 };
  Object.keys(base).forEach(function (k) { A[k] = base[k]; });
  A.HWREG = function (a) { return RG.read(a, 4); }; A.HWREGH = function (a) { return RG.read(a, 2); }; A.HWREGB = function (a) { return RG.read(a, 1); };
  /* CMSIS core functions */
  A.NVIC_EnableIRQ = function (n) { RG.write(0xE000E100 + 4 * (n >> 5), 1 << (n & 31), 4); };
  A.NVIC_DisableIRQ = function (n) { RG.write(0xE000E180 + 4 * (n >> 5), 1 << (n & 31), 4); };
  A.NVIC_SetPendingIRQ = function (n) { RG.write(0xE000E200 + 4 * (n >> 5), 1 << (n & 31), 4); };
  A.NVIC_ClearPendingIRQ = function (n) { RG.write(0xE000E280 + 4 * (n >> 5), 1 << (n & 31), 4); };
  A.NVIC_GetPendingIRQ = function (n) { return (RG.read(0xE000E200 + 4 * (n >> 5), 4) >>> (n & 31)) & 1; };
  A.NVIC_SetPriority = function (n, p) { if (n < 0) { var sh = (S.raw['SCB:shpr3'] || 0); S.raw['SCB:shpr3'] = ((sh & 0x00FFFFFF) | ((p & 7) << 29)) >>> 0; S.prio.systick = p & 7; } else RG.write(0xE000E400 + n, (p & 7) << 5, 1); };
  A.NVIC_GetPriority = function (n) { return n < 0 ? S.prio.systick || 0 : (RG.read(0xE000E400 + n, 1) >> 5) & 7; };
  A.NVIC_SystemReset = function () { RG.write(0xE000ED0C, 0x05FA0004, 4); };
  A.SysTick_Config = function (ticks) {
    ticks = ticks >>> 0; if (ticks - 1 > 0xFFFFFF) return 1;
    RG.write(0xE000E014, ticks - 1, 4); RG.write(0xE000E018, 0, 4); RG.write(0xE000E010, 7, 4); return 0;
  };
  /* debug build support */
  A.__DBG = { dbg: true };
  A.__enter = function (name, line) { S.dbg.frames.push({ name: name, line: line, ev: null, isr: !!S.isr && S.dbg.frames.length === S.dbg.isrBase }); };
  A.__leave = function () { S.dbg.frames.pop(); };
  A.__d = function (line, ev) { return S.dbgHook(line, ev); };
  A.__NOP = A.__DSB = A.__ISB = A.__DMB = A.__WFE = function () {};
  A.SystemCoreClock = S.clk;
  return A;
};

/* ---------- loading compiled programs ---------- */
function normName(n) { return n.toLowerCase().replace(/_/g, '').replace(/(irq)?(int)?(handler|isr)$/, ''); }
P.load = function (compiled) {
  var S = this, api = M.buildApi(this), names = Object.keys(api);
  var body = compiled.js + '\n;return {' + compiled.fns.map(function (n) { return n + ':' + n; }).join(',') + '};\n//# sourceURL=usercode.js';
  var fn = Function.apply(null, names.concat([body]));
  var fns = fn.apply(null, names.map(function (n) { return api[n]; }));
  this.api = api; this.userFns = fns; this.nameMap = {};
  Object.keys(fns).forEach(function (n) { S.nameMap[normName(n)] = fns[n]; });
  if (typeof fns.main !== 'function') throw new Error('No main() function found.');
  this.gen = fns.main(); this.loaded = true;
};
return M;
})(typeof MSP !== "undefined" ? MSP : require("./core.js"));
