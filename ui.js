/* UI: editor, board, terminal, analyzer, status. Depends on MSP, CC, EXAMPLES. */
(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var NS = 'http://www.w3.org/2000/svg';
var S, KNOWN = {}, compiled = null, running = false, errLine = 0;
var TEMPLATE = '#include <stdint.h>\n#include <stdbool.h>\n#include "driverlib/sysctl.h"\n#include "driverlib/gpio.h"\n\nint main(void)\n{\n    uint32_t sysClock = SysCtlClockFreqSet(\n        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);\n\n    // your code here\n\n    while (1)\n    {\n    }\n}\n';
var LEDS = [{ L: 'N', b: 1, n: 'D1' }, { L: 'N', b: 0, n: 'D2' }, { L: 'F', b: 4, n: 'D3' }, { L: 'F', b: 0, n: 'D4' }];
var AINS = ['PE3', 'PE2', 'PE1', 'PE0'];
var store = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
var drafts = {}, cur = 'blink';
try { drafts = JSON.parse(store.get('e401y.drafts') || '{}') || {}; } catch (e) { drafts = {}; }

function el(name, attrs, parent) {
  var e = document.createElementNS(NS, name);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

/* ---------- editor ---------- */
var code = $('code'), gutter = $('gutter');
var lineCount = 1, lineH = 20;
function updateGutter() {
  var n = code.value.split('\n').length, out = [], D = window.DbgUI, cur = D ? D.curLine() : 0;
  for (var i = 1; i <= n; i++) {
    var cls = 'gl' + (i === errLine ? ' bad' : '') + (D && D.hasBp(i) ? ' bp' : '') + (i === cur ? ' cur' : '');
    out.push('<div class="' + cls + '" data-l="' + i + '">' + i + '</div>');
  }
  gutter.innerHTML = out.join('');
  gutter.scrollTop = code.scrollTop;
  lineCount = n; placeCur(cur);
}
function placeCur(cur) {
  var c = $('curline'); if (!c) return;
  lineH = parseFloat(getComputedStyle(code).lineHeight) || 20;
  if (!cur) { c.style.display = 'none'; return; }
  c.style.display = 'block'; c.style.height = lineH + 'px'; c.style.top = (10 + (cur - 1) * lineH - code.scrollTop) + 'px';
}
function scrollToLine(line) {
  var h = parseFloat(getComputedStyle(code).lineHeight) || 20, top = (line - 1) * h;
  if (top < code.scrollTop || top > code.scrollTop + code.clientHeight - 2 * h) code.scrollTop = Math.max(0, top - 2 * h);
  gutter.scrollTop = code.scrollTop; placeCur(window.DbgUI ? DbgUI.curLine() : 0);
}
gutter.addEventListener('click', function (e) {
  var g = e.target.closest ? e.target.closest('.gl') : null;
  if (g && window.DbgUI) DbgUI.toggleBp(+g.getAttribute('data-l'));
});
function showErr(line, msg) {
  errLine = line || 0;
  var e = $('err'); e.className = 'on';
  e.innerHTML = '<b>' + (line ? 'Line ' + line + ': ' : 'Error: ') + '</b>' + esc(msg);
  updateGutter();
  if (line) scrollToLine(line);
}
function clearErr() { errLine = 0; $('err').className = ''; updateGutter(); }
code.addEventListener('scroll', function () { gutter.scrollTop = code.scrollTop; placeCur(window.DbgUI ? DbgUI.curLine() : 0); });
var saveTimer = 0;
code.addEventListener('input', function () {
  var oldN = lineCount, caret = code.value.slice(0, code.selectionStart).split('\n').length;
  if (window.DbgUI) DbgUI.onEdit(oldN, code.value.split('\n').length, caret);
  updateGutter();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { drafts[cur] = code.value; store.set('e401y.drafts', JSON.stringify(drafts)); store.set('e401y.cur', cur); }, 400);
});
code.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runBuild(); return; }
  if (e.key === 'F9' && window.DbgUI) { e.preventDefault(); DbgUI.toggleBp(code.value.slice(0, code.selectionStart).split('\n').length); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    var s = code.selectionStart, t = code.selectionEnd;
    code.value = code.value.slice(0, s) + '    ' + code.value.slice(t);
    code.selectionStart = code.selectionEnd = s + 4;
    code.dispatchEvent(new Event('input'));
  }
});

/* example picker */
var exSel = $('exSel');
function addOpt(id, title) { var o = document.createElement('option'); o.value = id; o.textContent = title; exSel.appendChild(o); }
addOpt('mine', 'My program');
EXAMPLES.forEach(function (e) { addOpt(e.id, e.title); });
function srcFor(id) {
  if (drafts[id] !== undefined) return drafts[id];
  if (id === 'mine') return TEMPLATE;
  return EXAMPLES.filter(function (e) { return e.id === id; })[0].code;
}
function exOf(id) { return EXAMPLES.filter(function (x) { return x.id === id; })[0]; }
function noteFor(id) {
  var e = exOf(id);
  if (!e) return 'Your own program. It is saved in this browser.';
  return e.note + (e.needs && window.PartsUI ? ' Uses: ' + PartsUI.labels(e.needs) + '.' : '');
}
exSel.addEventListener('change', function () {
  drafts[cur] = code.value;
  cur = exSel.value; code.value = srcFor(cur); if (window.DbgUI) DbgUI.setExample(cur);
  var ex = exOf(cur); if (window.BenchUI) BenchUI.useExample(ex && ex.needs ? ex.needs : []);
  $('exNote').textContent = noteFor(cur);
  store.set('e401y.drafts', JSON.stringify(drafts)); store.set('e401y.cur', cur);
  clearErr(); runBuild();
});

/* ---------- board ---------- */
var ledEls = [], capEls = [];
(function drawBoard() {
  var hl = $('hdrL'), hr = $('hdrR');
  for (var i = 0; i < 16; i++) {
    el('rect', { class: 'pad', x: 14, y: 58 + i * 8.6, width: 7, height: 5 }, hl);
    el('rect', { class: 'pad', x: 379, y: 112 + i * 7, width: 7, height: 4 }, hr);
  }
  var g = $('leds');
  LEDS.forEach(function (d, i) {
    var x = 190 + i * 46, y = 200;
    var grp = el('g', { transform: 'translate(' + x + ' ' + y + ')' }, g);
    var halo = el('circle', { r: 17, class: 'led-on', filter: 'url(#glow)', opacity: 0 }, grp);
    el('circle', { r: 8.5, class: 'led-off' }, grp);
    var core = el('circle', { r: 6.5, class: 'led-on', opacity: 0 }, grp);
    var t1 = el('text', { class: 'silk', y: 28, 'text-anchor': 'middle' }, grp); t1.textContent = d.n;
    var t2 = el('text', { class: 'silk s', y: 38, 'text-anchor': 'middle' }, grp); t2.textContent = 'P' + d.L + d.b;
    ledEls.push({ d: d, halo: halo, core: core });
  });
  var sw = $('sws');
  [['SW1', 'PJ0', 50], ['SW2', 'PJ1', 96]].forEach(function (s) {
    var grp = el('g', { transform: 'translate(' + s[2] + ' 200)' }, sw);
    el('rect', { x: -13, y: -13, width: 26, height: 26, rx: 3, fill: '#2A3036' }, grp);
    capEls.push(el('circle', { r: 8.5, class: 'cap' }, grp));
    var t1 = el('text', { class: 'silk', y: 28, 'text-anchor': 'middle' }, grp); t1.textContent = s[0];
    var t2 = el('text', { class: 'silk s', y: 38, 'text-anchor': 'middle' }, grp); t2.textContent = s[1];
  });
})();

function bindHold(btn, L, b) {
  var down = false;
  function press() { if (down || !S.onboard.sw) return; down = true; btn.classList.add('down'); S.setInput(L, b, 0); }
  function release() { if (!down) return; down = false; btn.classList.remove('down'); S.setInput(L, b, null); }
  btn.addEventListener('pointerdown', function (e) { try { btn.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); press(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { btn.addEventListener(n, release); });
  btn.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
  btn.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') release(); });
  btn.addEventListener('blur', release);
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}

function buildAnalog() {
  var box = $('analog');
  S.analogCfg.forEach(function (c, i) {
    var lab = document.createElement('label'); lab.textContent = 'AIN' + i + ' ' + AINS[i]; lab.htmlFor = 'ain' + i;
    var rng = document.createElement('input'); rng.type = 'range'; rng.id = 'ain' + i; rng.min = 0; rng.max = 3.3; rng.step = 0.01; rng.value = c.v;
    var out = document.createElement('output'); out.textContent = c.v.toFixed(2) + ' V';
    var sel = document.createElement('select'); sel.setAttribute('aria-label', 'Waveform for AIN' + i);
    [['dc', 'DC'], ['sine1', 'Sine 1 Hz'], ['sine10', 'Sine 10 Hz'], ['noise', 'Noise']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
    rng.addEventListener('input', function () { c.v = +rng.value; out.textContent = c.v.toFixed(2) + ' V'; });
    sel.addEventListener('change', function () { c.mode = sel.value; });
    box.appendChild(lab); box.appendChild(rng); box.appendChild(out); box.appendChild(sel);
  });
  var lab = document.createElement('label'); lab.textContent = 'Die temp'; lab.htmlFor = 'tempC';
  var rng = document.createElement('input'); rng.type = 'range'; rng.id = 'tempC'; rng.min = -10; rng.max = 85; rng.step = 1; rng.value = S.tempC;
  var out = document.createElement('output'); out.textContent = S.tempC + ' C';
  rng.addEventListener('input', function () { S.tempC = +rng.value; out.textContent = S.tempC + ' C'; });
  box.appendChild(lab); box.appendChild(rng); box.appendChild(out); box.appendChild(document.createElement('span'));
}

/* ---------- terminal ---------- */
var term = $('term'), queue = [], txFlashUntil = 0;
function onTx(ch) {
  if (ch === '\r') return;
  var q = queue[queue.length - 1];
  if (q && q.k === 'tx') q.t += ch; else queue.push({ k: 'tx', t: ch });
  txFlashUntil = performance.now() + 70;
}
function onLog(kind, msg) { queue.push({ k: kind, t: msg }); }
function flushTerm() {
  if (!queue.length) return;
  var atBottom = term.scrollTop + term.clientHeight >= term.scrollHeight - 30;
  queue.forEach(function (q) {
    var last = term.lastChild;
    if (q.k === 'tx') {
      if (last && last.className === 'tx') last.textContent += q.t;
      else { var s = document.createElement('span'); s.className = 'tx'; s.textContent = q.t; term.appendChild(s); }
    } else {
      var d = document.createElement('div'); d.className = 'msg ' + q.k; d.textContent = '[sim] ' + q.t; term.appendChild(d);
    }
  });
  queue = [];
  while (term.childNodes.length > 300) term.removeChild(term.firstChild);
  if (term.lastChild && term.lastChild.className === 'tx' && term.lastChild.textContent.length > 20000) term.lastChild.textContent = term.lastChild.textContent.slice(-10000);
  if (atBottom) term.scrollTop = term.scrollHeight;
}
function termClear() { term.textContent = ''; queue = []; }
$('termClear').addEventListener('click', termClear);
$('termForm').addEventListener('submit', function (e) {
  e.preventDefault();
  var inp = $('termIn');
  if (S) S.uartRx(inp.value + '\r');
  inp.value = '';
});

/* ---------- build and run ---------- */
function setStatus() {
  var s = $('status'), flt = window.BenchUI ? BenchUI.fault() : '';
  if (flt) { s.className = 'chip halt'; s.textContent = 'power fault: ' + flt; }
  else if (!S.loaded) { s.className = 'chip idle'; s.textContent = 'idle'; }
  else if (S.halted) { s.className = 'chip halt'; s.textContent = 'halted'; }
  else if (S.paused) { s.className = 'chip stop'; s.textContent = 'stopped, line ' + S.dbg.line; }
  else if (!running) { s.className = 'chip idle'; s.textContent = 'paused'; }
  else { s.className = 'chip run'; s.textContent = S.cpuWait ? 'running (sleeping)' : 'running'; }
  $('pauseBtn').textContent = S.paused ? 'Continue' : running || !S.loaded || S.halted ? 'Pause' : 'Resume';
}
function startProgram() {
  S.reset(); termClear(); pinKey = '';
  try { S.load(compiled); }
  catch (e) { S.halted = true; showErr(null, 'Could not start the program: ' + (e && e.message ? e.message : e)); setStatus(); return; }
  running = true; if (window.DbgUI) DbgUI.onStart(); setStatus();
}
function runBuild() {
  clearErr();
  if (typeof acorn === 'undefined') { showErr(null, 'The compiler library did not load (cdn.jsdelivr.net may be blocked). Reload the page.'); return; }
  var res;
  try { res = CC.compile(code.value, KNOWN, { debug: !!(window.DbgUI && DbgUI.enabled()) }); }
  catch (e) { showErr(null, 'Internal compiler error: ' + (e && e.message ? e.message : e)); return; }
  if (res.error) { showErr(res.error.line, res.error.msg); return; }
  compiled = res; startProgram();
}
$('runBtn').addEventListener('click', runBuild);
$('resetBtn').addEventListener('click', function () { if (compiled && !$('err').classList.contains('on')) startProgram(); else runBuild(); });
$('pauseBtn').addEventListener('click', function () {
  if (!S.loaded || S.halted) return;
  if (S.paused) { DbgUI.step('run'); return; }
  if (compiled && compiled.debug && running) { S.dbg.mode = 'pause'; return; }      // stops at the next statement
  running = !running; setStatus();
});

/* ---------- pins ---------- */
var pinKey = '', pinEls = [];
function pinList() {
  var a = [];
  MSP.PORTS.forEach(function (L) {
    var p = S.gpio[L];
    for (var b = 0; b < 8; b++) { var m = 1 << b; if (((p.den | p.analog | p.dir) & m) || p.alt[b]) a.push({ L: L, b: b, p: p, m: m }); }
  });
  return a;
}
function updatePins() {
  var list = pinList(), key = list.map(function (x) { return x.L + x.b; }).join(',');
  var box = $('pins');
  if (key !== pinKey) {
    pinKey = key; box.textContent = ''; pinEls = [];
    if (!list.length) { box.innerHTML = '<span class="note">No pins configured yet.</span>'; return; }
    list.forEach(function (x) {
      var input = (x.p.den & x.m) && !(x.p.dir & x.m) && !x.p.alt[x.b];
      var e = document.createElement(input ? 'button' : 'span'); e.className = 'pin';
      if (input) { e.type = 'button'; e.addEventListener('click', function () { var k = x.L + x.b, v = S.inputs[k]; S.setInput(x.L, x.b, v === undefined ? 1 : v === 1 ? 0 : null); }); }
      e.innerHTML = '<i></i><span></span>'; box.appendChild(e); pinEls.push({ x: x, e: e, txt: '', hi: null });
    });
  }
  pinEls.forEach(function (pe) {
    var x = pe.x, p = x.p, b = x.b, t, hi, cls = 'pin';
    var lv = p.lv[b], alt = p.alt[b];
    if (alt && alt.indexOf('pwm') === 0) { t = 'P' + x.L + b + ' PWM ' + Math.round(lv * 100) + '%'; hi = lv > 0; cls += ' pwm'; }
    else if (alt) { t = 'P' + x.L + b + ' ' + alt.toUpperCase(); hi = false; }
    else if (p.analog & x.m) { var ch = x.L === 'E' ? 3 - b : -1; t = 'P' + x.L + b + ' analog' + (ch >= 0 && ch < 4 ? ' ' + S.analogV(ch, S.now).toFixed(2) + ' V' : ''); hi = false; }
    else if (p.dir & x.m) { t = 'P' + x.L + b + ' out ' + (p.dig[b] ? 'high' : 'low'); hi = !!p.dig[b]; }
    else { var d = S.inputs[x.L + b]; t = 'P' + x.L + b + ' in ' + (p.dig[b] ? 'high' : 'low') + ' (' + (d === 0 ? 'driven low' : d === 1 ? 'driven high' : p.pur & x.m ? 'pull-up' : p.pdr & x.m ? 'pull-down' : 'floating') + ')'; hi = !!p.dig[b]; }
    if (t !== pe.txt) { pe.e.lastChild.textContent = t; pe.txt = t; }
    if (hi !== pe.hi) { pe.hi = hi; }
    pe.e.className = cls + (hi ? ' hi' : '');
  });
}

/* ---------- logic analyzer ---------- */
function scopeKeys() {
  var set = {};
  Object.keys(S.tr).forEach(function (k) { set[k] = 1; });
  MSP.PORTS.forEach(function (L) {
    var p = S.gpio[L];
    for (var b = 0; b < 8; b++) { var m = 1 << b; if ((p.den & m) && !(p.alt[b] && p.alt[b].indexOf('pwm') === 0)) set[L + b] = 1; }
  });
  var all = Object.keys(set).sort(), act = all.filter(function (k) { return (S.tr[k] || []).length > 0; }), idle = all.filter(function (k) { return !(S.tr[k] || []).length; });
  return act.concat(idle).slice(0, 16);
}
var BUSNAME = { i2c0scl: 'SCL', i2c0sda: 'SDA', ssi0clk: 'CLK', ssi0fss: 'FSS', ssi0mosi: 'MOSI', ssi0miso: 'MISO' };
function scopeName(k) {
  if (!/^[A-Z]\d$/.test(k)) return k;
  var a = S.gpio[k[0]].alt[+k[1]];
  return a && BUSNAME[a] ? BUSNAME[a] : 'P' + k;
}
function fmtT(t, win) { return t >= 1 || win >= 1 ? (+t.toFixed(3)) + ' s' : (+(t * 1000).toFixed(win < 0.01 ? 3 : 2)) + ' ms'; }
function drawScope() {
  var c = $('scope'), dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300;
  var keys = scopeKeys(), rows = Math.max(1, keys.length), h = rows * 26 + 24;
  if (c.style.height !== h + 'px') c.style.height = h + 'px';
  var W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  var g = c.getContext('2d'); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  var cs = getComputedStyle(document.documentElement), col = function (n) { return cs.getPropertyValue(n).trim() || '#999'; };
  g.fillStyle = col('--scr-bg'); g.fillRect(0, 0, w, h);
  var win = +$('win').value, tR = Math.max(S.now, win), tL = tR - win, x0 = 46, x1 = w - 8, span = x1 - x0;
  var xOf = function (t) { return x0 + (t - tL) / win * span; };
  g.font = '11px ' + (cs.getPropertyValue('--f-mono') || 'monospace'); g.textBaseline = 'middle';
  g.strokeStyle = col('--scr-grid'); g.fillStyle = col('--scr-dim'); g.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var gx = Math.round(x0 + span * i / 4) + 0.5;
    g.beginPath(); g.moveTo(gx, 4); g.lineTo(gx, h - 18); g.stroke();
    g.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    g.fillText(fmtT(tL + win * i / 4, win), gx, h - 8);
  }
  g.textAlign = 'left'; g.lineWidth = 1.6; g.lineJoin = 'miter';
  keys.forEach(function (k, r) {
    var yH = 10 + r * 26, yL = yH + 14, a = S.tr[k] || [];
    g.fillStyle = col('--scr-ink'); g.fillText(scopeName(k), 4, (yH + yL) / 2);
    var lo = 0, hi = a.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid][0] < tL) lo = mid + 1; else hi = mid; }
    var lvl = lo > 0 ? a[lo - 1][1] : 0, y = lvl ? yH : yL;
    g.strokeStyle = col('--scr-trace'); g.beginPath(); g.moveTo(x0, y);
    // At most one step or one full-height bar per pixel column, so a fast signal costs the same to draw as a slow one.
    var cx = null, cn = 0, cy0 = y;
    var flush = function () {
      if (cx === null) return;
      g.lineTo(cx, cy0);
      if (cn === 1) g.lineTo(cx, y); else { g.lineTo(cx, yH); g.lineTo(cx, yL); g.lineTo(cx, y); }
    };
    for (var j = lo; j < a.length && a[j][0] <= tR; j++) {
      var ix = Math.floor(xOf(a[j][0])) + 0.5;
      if (ix !== cx) { flush(); cx = ix; cn = 0; cy0 = y; }
      cn++; y = a[j][1] ? yH : yL;
    }
    flush();
    g.lineTo(x1, y); g.stroke();
  });
}

/* ---------- status ---------- */
function updateStatus() {
  var rows = [], k;
  function add(a, b) { rows.push('<dt>' + a + '</dt><dd>' + b + '</dd>'); }
  add('CPU', !S.loaded ? 'idle' : S.halted ? 'halted' : S.paused ? 'stopped by the debugger' : S.cpuWait ? 'waiting (' + (S.cpuWait.until != null ? 'delay' : 'polling or WFI') + ')' : 'executing');
  add('Virtual time', S.now.toFixed(S.now < 10 ? 4 : 2) + ' s');
  add('System clock', (S.clk / 1e6).toFixed(S.clk % 1e6 ? 3 : 0) + ' MHz' + (S.clk === 16e6 ? ' (PIOSC default)' : ''));
  add('Interrupts taken', S.irqCount + (S.master ? '' : ' (master disabled)'));
  var pe = Object.keys(S.periph); add('Clocked peripherals', pe.length ? pe.join(' ') : 'none');
  var tm = [];
  S.timers.forEach(function (t, n) { ['A', 'B'].forEach(function (w) { var s = t[w]; if (s.run) tm.push('T' + n + w + ' ' + fmtT((s.load + 1) / S.clk, 1) + (s.mode === 0x22 ? ' periodic' : ' one-shot') + ((s.mask & 1) ? '' : ', irq off')); }); });
  if (S.st.en) tm.push('SysTick ' + fmtT((S.st.period + 1) / S.clk, 1));
  add('Timers', tm.length ? tm.join('<br>') : 'none running');
  var pw = [];
  for (k = 0; k < 8; k++) { var g = S.pwm.gens[k >> 1]; if ((S.pwm.outEn & (1 << k)) && g.en && g.period) pw.push('M0PWM' + k + ' ' + Math.round(S.pwm.div ? S.clk / S.pwm.div / g.period : 0) + ' Hz, ' + Math.round(100 * S.pwm.pulse[k] / g.period) + '%'); }
  add('PWM0', pw.length ? pw.join('<br>') : 'off');
  var ad = [];
  S.adc.forEach(function (a, n) { a.seq.forEach(function (q, s) { if (q.en) ad.push('ADC' + n + ' SS' + s + (q.ris ? ' (flag set)' : '')); }); });
  add('ADC', ad.length ? ad.join('<br>') : 'off');
  add('UART0', S.u.en ? S.u.baud + ' baud, rx fifo ' + S.u.rx.length : 'not enabled');
  add('I2C0', S.i2c.en ? Math.round(S.clk / (20 * (S.i2c.tpr + 1)) / 100) / 10 + ' kHz master' + (S.i2c.busy ? ', busy' : '') : 'not enabled');
  add('SSI0', S.ssi.en ? (function () { var d = (S.ssi.cpsr & 0xFE) || 2, r = S.clk / (d * (1 + ((S.ssi.cr0 >> 8) & 255))), m = (((S.ssi.cr0 >> 6) & 1) << 1) | ((S.ssi.cr0 >> 7) & 1); return (r >= 1e6 ? +(r / 1e6).toFixed(2) + ' MHz' : +(r / 1e3).toFixed(1) + ' kHz') + ', mode ' + m + ', ' + ((S.ssi.cr0 & 15) + 1) + ' bit'; })() : 'not enabled');
  $('stat').innerHTML = rows.join('');
  $('baud').textContent = S.u.baud;
}

/* ---------- windows ---------- */
function makeWindows() {
  var desk = $('desk'), dw = desk.clientWidth || 1000, dh = desk.clientHeight || 700;
  Win.init(desk, store);
  Win.create('program', 'Program: main.c, debugger and registers', $('pgmBody'), { x: Math.max(8, dw - 820), y: 8, w: Math.min(800, dw - 16), h: Math.min(dh - 16, 740) });
  Win.create('board', 'LaunchPad: switches, analog inputs, pins', $('boardBody'), { x: 12, y: 12, w: 440, h: Math.min(dh - 24, 620) });
  Win.create('term', 'UART0 terminal', $('termBody'), { x: Math.max(8, dw - 520), y: dh - 420, w: 500, h: 400 });
  Win.create('scope', 'Logic analyzer', $('scopeBody'), { x: 40, y: dh - 340, w: Math.min(660, dw - 60), h: 320 });
  Win.create('bus', 'Bus decoder', $('busBody'), { x: 60, y: 60, w: 540, h: 400 });
  Win.create('stat', 'Status', $('statBody'), { x: Math.max(8, dw - 420), y: 80, w: 400, h: 440 });
  Win.create('help', 'What this simulator models', $('helpBody'), { x: 80, y: 40, w: 580, h: 540 });
  Array.prototype.forEach.call(document.querySelectorAll('[data-win]'), function (b) { Win.bind(b, b.getAttribute('data-win')); });
  var pt = $('palToggle'); if (pt) pt.addEventListener('click', function () { document.body.classList.toggle('paldrawer'); });
  document.addEventListener('winshow', function () { lastScope = 0; lastStat = 0; updateGutter(); });
}
window.UIState = { txFlash: function (ts) { return ts < txFlashUntil; } };

/* ---------- main loop ---------- */
var lastTs = 0, lastStat = 0, lastScope = 0, scopeGap = 40, lastFault = '';
function frame(ts) {
  var dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000)); lastTs = ts;
  var flt = window.BenchUI ? BenchUI.fault() : '';
  if (flt !== lastFault) { lastFault = flt; setStatus(); }
  if (running && S.loaded && !S.halted && !S.paused && !flt) {
    S.run(dt * (+$('speed').value || 1), 10);
    if (S.halted) { running = false; setStatus(); }
  }
  flushTerm();
  if (window.DbgUI) DbgUI.frame(ts);
  if (window.PartsUI) PartsUI.frame(running && S.loaded && !S.halted && !flt);
  if (window.BenchUI) BenchUI.frame(ts);
  ledEls.forEach(function (l) {
    var b = S.loaded && S.onboard.leds ? S.brightness(l.d.L, l.d.b) : 0;
    l.core.setAttribute('opacity', b.toFixed(3)); l.halo.setAttribute('opacity', (b * 0.7).toFixed(3));
  });
  var tx = $('txOn'); if (tx) tx.setAttribute('opacity', ts < txFlashUntil ? 1 : 0);
  capEls[0].setAttribute('class', 'cap' + (S.inputs.J0 === 0 ? ' down' : ''));
  capEls[1].setAttribute('class', 'cap' + (S.inputs.J1 === 0 ? ' down' : ''));
  updatePins();
  // Windows that are closed are not redrawn. The analyzer backs off when a redraw is slow (long traces, slow computers).
  if (ts - lastScope > scopeGap) {
    lastScope = ts;
    if (Win.isOpen('scope')) { var t0 = performance.now(); drawScope(); scopeGap = Math.min(500, Math.max(40, (performance.now() - t0) * 5)); }
  }
  if (ts - lastStat > 250) { lastStat = ts; if (Win.isOpen('stat')) updateStatus(); setStatus(); }
  requestAnimationFrame(frame);
}

function init() {
  S = new MSP.Sim({ onTx: onTx, onLog: onLog });
  Object.keys(MSP.buildApi(new MSP.Sim())).forEach(function (n) { KNOWN[n] = 1; });
  Object.keys(MSP.REGNAMES).forEach(function (n) { KNOWN[n] = 2; });
  makeWindows();
  if (window.PartsUI) PartsUI.init(S, store, { bench: true, change: function () { if (window.BenchUI) BenchUI.settingsChanged(); } });
  if (window.PartsUI) PartsUI.onboardChecks($('obChecks'));
  if (window.BenchUI) BenchUI.init(S, store, { onChange: function () { setStatus(); } });
  buildAnalog();
  bindHold($('sw1'), 'J', 0); bindHold($('sw2'), 'J', 1);
  var saved = store.get('e401y.cur');
  if (saved && (saved === 'mine' || EXAMPLES.some(function (e) { return e.id === saved; }))) cur = saved;
  exSel.value = cur; code.value = srcFor(cur); $('exNote').textContent = noteFor(cur);
  if (window.DbgUI) DbgUI.init({ S: function () { return S; }, store: store, cur: function () { return cur; }, compiled: function () { return compiled; }, updateGutter: updateGutter,
    rebuild: function () { runBuild(); }, setRunning: function (v) { running = v; setStatus(); }, scrollToLine: scrollToLine });
  updateGutter();
  window.addEventListener('resize', function () { lastScope = 0; });
  $('win').addEventListener('change', function () { lastScope = 0; });
  runBuild();
  requestAnimationFrame(frame);
}
init();
})();
