/* Components panel: a checklist of on-board items and add-on parts, one card per part with wiring selects. */
var PartsUI = (function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var S, store, cards = {}, picks = {}, binders = [], audio = null, soundOn = false, BENCH = false, hooks = {};

var LIST = [
  { id: 'leds', label: 'User LEDs D1-D4', grp: 'On the LaunchPad' },
  { id: 'sw', label: 'User switches SW1, SW2' },
  { id: 'keypad', label: '4x4 keypad', grp: 'Add-on parts' },
  { id: 'relay', label: 'Relay module' },
  { id: 'ledbar', label: 'LED bar (8 LEDs)' },
  { id: 'rgb', label: 'RGB LED' },
  { id: 'seg', label: '7-segment display' },
  { id: 'buzzer', label: 'Buzzer' },
  { id: 'motor', label: 'DC motor + H-bridge' },
  { id: 'servo', label: 'Servo' },
  { id: 'stepper', label: 'Stepper motor' },
  { id: 'dip', label: 'DIP switches (4)' },
  { id: 'btns', label: 'Push buttons (4)' },
  { id: 'i2c_tmp', label: 'Temperature sensor (TMP102)', grp: 'I2C0 devices (PB2 SCL, PB3 SDA)' },
  { id: 'i2c_eeprom', label: 'EEPROM 24C02 (256 B)' },
  { id: 'i2c_lcd', label: 'LCD 16x2 + PCF8574' },
  { id: 'i2c_oled', label: 'OLED 128x64 (SSD1306)' },
  { id: 'spi_eeprom', label: 'EEPROM 25LC256 (32 KB)', grp: 'SSI0 devices (PA2 CLK, PA4 MOSI, PA5 MISO)' },
  { id: 'spi_595', label: '74HC595 + 8 LEDs' }
];
var LABEL = {}; LIST.forEach(function (x) { LABEL[x.id] = x.label; });
var RESERVED_LED = { N0: 'LED D2', N1: 'LED D1', F4: 'LED D3', F0: 'LED D4' };
var RESERVED_SW = { J0: 'switch SW1', J1: 'switch SW2' };
var RESERVED_ALWAYS = { A0: 'UART RX', A1: 'UART TX' };
var DEFAULT_CFG = { v: 2, onboard: { leds: true, sw: true },
  keypad: { on: true, rows: ['K0', 'K1', 'K2', 'K3'], cols: ['L0', 'L1', 'L2', 'L3'], bounce: false },
  relay: { on: true, pin: 'M0', low: true }, mods: {} };

/* ---------- small DOM helpers ---------- */
function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function ca(el, k, v) { var c = el.__c || (el.__c = {}); if (c[k] !== v) { c[k] = v; el.setAttribute(k, v); } }
function ct(el, v) { if (el.__t !== v) { el.__t = v; el.textContent = v; } }
function f2(x, n) { return (+x).toFixed(n === undefined ? 0 : n); }
var SVGW = { '0 0 130 80': 'w200', '0 0 190 100': 'w300', '0 0 170 110': 'w260', '0 0 180 110': 'w260', '-14 0 188 134': 'w240' };
function svgBox(vb, label, inner) {
  var w = h('div'); w.innerHTML = '<svg class="partsvg ' + (SVGW[vb] || '') + '" viewBox="' + vb + '" role="img" aria-label="' + label + '">' + inner + '</svg>';
  return w.firstChild;
}
function q(root, k) { return root.querySelector('[data-k="' + k + '"]'); }
function changed() { apply(); }

function pinSelect(id, label, get, set) {
  var wrap = h('label'); wrap.appendChild(document.createTextNode(label));
  var sel = h('select'); sel.id = id; sel.setAttribute('aria-label', label + ' pin');
  var none = h('option'); none.value = ''; none.textContent = 'not wired'; sel.appendChild(none);
  MSP.PORTS.forEach(function (L) { for (var b = 0; b < 8; b++) { var o = h('option'); o.value = L + b; o.textContent = 'P' + L + b; sel.appendChild(o); } });
  sel.addEventListener('change', function () { set(sel.value); changed(); });
  binders.push(function () { sel.value = get() || ''; });
  wrap.appendChild(sel); return wrap;
}
var DERIVED = { lbLow: 1, rgAnode: 1, sgAnode: 1, dpVcc: 1, pbVcc: 1 };      // set by how the part's COM pin is wired on the bench
function check(id, label, get, set) {
  var l = h('label', 'chk'), i = h('input'); i.type = 'checkbox'; i.id = id;
  i.addEventListener('change', function () { set(i.checked); changed(); });
  binders.push(function () { i.checked = !!get(); });
  l.appendChild(i); l.appendChild(document.createTextNode(' ' + label));
  if (BENCH && DERIVED[id]) { i.disabled = true; l.title = 'Set by how COM is wired'; l.appendChild(h('span', 'dim', ' (from the COM wire)')); }
  return l;
}
function choose(id, label, opts, get, set) {
  var l = h('label', 'chk sel'); l.appendChild(document.createTextNode(label + ' '));
  var s = h('select'); s.id = id; s.setAttribute('aria-label', label);
  opts.forEach(function (o) { var op = h('option'); op.value = o[0]; op.textContent = o[1]; s.appendChild(op); });
  s.addEventListener('change', function () { set(s.value); changed(); });
  binders.push(function () { s.value = String(get()); });
  l.appendChild(s); return l;
}
function wires() { return h('div', 'wires'); }
function shell(name, title) {
  var c = h('div', 'part'); c.setAttribute('data-mod', name);
  var hd = h('div', 'parthead'); hd.appendChild(h('h3', 'ptitle', title)); c.appendChild(hd);
  return { el: c, head: hd };
}
function note(t) { return h('p', 'note', t); }
function hold(btn, press, release, minMs) {
  var down = false, t0 = 0;
  function dn() { if (down || btn.disabled) return; down = true; t0 = performance.now(); btn.classList.add('down'); press(); }
  function up() {
    if (!down) return;
    setTimeout(function () { down = false; btn.classList.remove('down'); release(); }, Math.max(0, minMs - (performance.now() - t0)));
  }
  btn.addEventListener('pointerdown', function (e) { try { btn.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); dn(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (n) { btn.addEventListener(n, up); });
  btn.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); dn(); } });
  btn.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') up(); });
  btn.addEventListener('blur', up);
  btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
}

/* ---------- card builders: each returns { el, upd(active) } ---------- */
var KEYS = ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D'];
function buildKeypad() {
  var c = shell('keypad', '4x4 keypad');
  c.head.appendChild(check('kpBounce', 'contact bounce', function () { return S.keypad.bounce; }, function (v) { S.keypad.bounce = v; }));
  var keys = h('div', 'keys'); keys.id = 'keys';
  KEYS.forEach(function (k, i) {
    var b = h('button', 'key', k); b.type = 'button'; b.setAttribute('aria-label', 'Keypad key ' + k + ', hold to press');
    hold(b, function () { S.keySet(i >> 2, i & 3, 1); }, function () { S.keySet(i >> 2, i & 3, 0); }, 120); keys.appendChild(b);
  });
  var w = wires(); w.id = 'kpWires';
  for (var i = 0; i < 4; i++) (function (i) { w.appendChild(pinSelect('kpr' + i, 'R' + (i + 1), function () { return S.keypad.rows[i]; }, function (v) { S.keypad.rows[i] = v; S.kpUpdate(); })); })(i);
  for (i = 0; i < 4; i++) (function (i) { w.appendChild(pinSelect('kpc' + i, 'C' + (i + 1), function () { return S.keypad.cols[i]; }, function (v) { S.keypad.cols[i] = v; S.kpUpdate(); })); })(i);
  c.el.appendChild(keys); c.el.appendChild(w);
  c.el.appendChild(note('A pressed key connects its row to its column. The keypad has no pull-ups, so enable them on the pins you read. Taps are held for at least 120 ms.'));
  return { el: c.el, upd: function () {} };
}

function buildRelay() {
  var c = shell('relay', 'Relay module');
  c.head.appendChild(check('rlLow', 'active-low input', function () { return S.relay.low; }, function (v) { S.setRelay({ low: v }); }));
  var svg = svgBox('0 0 380 150', 'Relay module with power and coil LEDs and a lamp on each contact',
    '<rect class="rl-body" x="14" y="14" width="124" height="122" rx="6"/><text class="rl-t" x="76" y="36" text-anchor="middle">RELAY 5V</text>' +
    '<path class="rl-coil" d="M40 72 q8 -16 16 0 t16 0 t16 0"/><text class="rl-t s" x="76" y="100" text-anchor="middle">coil</text>' +
    '<circle class="led-pwr" cx="168" cy="34" r="6"/><text class="rl-lbl" x="180" y="38">PWR</text>' +
    '<circle class="led-dim" cx="168" cy="64" r="6"/><circle data-k="inh" class="led-in" cx="168" cy="64" r="12" opacity="0" style="filter:blur(4px)"/><circle data-k="in" class="led-in" cx="168" cy="64" r="6" opacity="0"/><text class="rl-lbl" x="180" y="68">IN</text>' +
    '<path class="rl-wire" d="M240 84 H226 M310 50 H334 M310 118 H334"/>' +
    '<circle class="rl-term" cx="240" cy="84" r="5"/><circle class="rl-term" cx="310" cy="50" r="5"/><circle class="rl-term" cx="310" cy="118" r="5"/>' +
    '<line data-k="arm" class="rl-arm" x1="240" y1="84" x2="306" y2="114"/>' +
    '<text class="rl-lbl" x="240" y="106" text-anchor="middle">COM</text><text class="rl-lbl" x="310" y="38" text-anchor="middle">NO</text><text class="rl-lbl" x="310" y="138" text-anchor="middle">NC</text>' +
    '<circle class="lamp-off" cx="350" cy="50" r="11"/><circle id="lampNo" data-k="lno" class="lamp-on" cx="350" cy="50" r="9" opacity="0"/>' +
    '<circle class="lamp-off" cx="350" cy="118" r="11"/><circle data-k="lnc" class="lamp-on" cx="350" cy="118" r="9" opacity="0"/>');
  svg.id = 'relaySvg';
  var w = wires(); w.appendChild(pinSelect('rlpin', 'IN', function () { return S.relay.pin; }, function (v) { S.setRelay({ pin: v }); }));
  var st = h('p', 'note'); st.id = 'relayState';
  c.el.appendChild(svg); c.el.appendChild(w); c.el.appendChild(st);
  return { el: c.el, upd: function () {
    var r = S.relay, coil = r.on && r.coil, contact = r.on && r.contact;
    ca(q(svg, 'in'), 'opacity', coil ? 1 : 0); ca(q(svg, 'inh'), 'opacity', coil ? 0.6 : 0);
    ca(q(svg, 'lno'), 'opacity', contact ? 1 : 0); ca(q(svg, 'lnc'), 'opacity', !contact ? 1 : 0);
    ca(q(svg, 'arm'), 'y2', contact ? 54 : 114);
    var t = 'IN ' + (r.pin ? 'P' + r.pin : '(not wired)') + (r.low ? ', active-low' : ', active-high') + '. Coil ' + (coil ? 'energized' : 'off') +
      ', COM connected to ' + (contact ? 'NO' : 'NC') + ', ' + r.count + ' contact change' + (r.count === 1 ? '' : 's') + '.';
    if (r.chatter && S.now - r.chatterAt < 3) t += ' Switching faster than 100 ms: real contacts wear out quickly this way.';
    ct(st, t);
  } };
}

var LBCOL = ['#E5383B', '#E5383B', '#F5A524', '#F5A524', '#2BC48A', '#2BC48A', '#3B82F6', '#3B82F6'];
function buildLedbar() {
  var c = shell('ledbar', 'LED bar');
  c.head.appendChild(check('lbLow', 'active-low (LED to 3.3 V)', function () { return S.mods.ledbar.low; }, function (v) { S.mods.ledbar.low = v; }));
  var inner = '<defs><filter id="lbGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter></defs>';
  for (var i = 0; i < 8; i++) {
    var x = 22 + i * 38;
    inner += '<circle data-k="h' + i + '" cx="' + x + '" cy="25" r="16" fill="' + LBCOL[i] + '" opacity="0" filter="url(#lbGlow)"/>' +
      '<circle cx="' + x + '" cy="25" r="10" fill="' + LBCOL[i] + '" opacity="0.18" stroke="' + LBCOL[i] + '" stroke-width="1"/>' +
      '<circle data-k="c' + i + '" cx="' + x + '" cy="25" r="9" fill="' + LBCOL[i] + '" opacity="0"/>';
  }
  var svg = svgBox('0 0 320 50', 'Bar of eight LEDs', inner), w = wires();
  for (i = 0; i < 8; i++) (function (i) { w.appendChild(pinSelect('lbp' + i, 'L' + (i + 1), function () { return S.mods.ledbar.pins[i]; }, function (v) { S.mods.ledbar.pins[i] = v; })); })(i);
  c.el.appendChild(svg); c.el.appendChild(w);
  var cs = [], hs = []; for (i = 0; i < 8; i++) { cs.push(q(svg, 'c' + i)); hs.push(q(svg, 'h' + i)); }
  return { el: c.el, upd: function () {
    var m = S.mods.ledbar;
    for (var i = 0; i < 8; i++) {
      var b = 0; if (S.driven(m.pins[i])) { var l = S.lvl(m.pins[i], 'lb' + i); b = m.low ? 1 - l : l; }
      ca(cs[i], 'opacity', f2(b, 2)); ca(hs[i], 'opacity', f2(b * 0.7, 2));
    }
  } };
}

function buildRgb() {
  var c = shell('rgb', 'RGB LED');
  c.head.appendChild(check('rgAnode', 'common anode', function () { return S.mods.rgb.anode; }, function (v) { S.mods.rgb.anode = v; }));
  var svg = svgBox('0 0 190 100', 'RGB LED and its three channel levels',
    '<defs><filter id="rgGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7"/></filter></defs>' +
    '<circle data-k="halo" cx="50" cy="50" r="40" fill="#fff" opacity="0" filter="url(#rgGlow)"/><circle data-k="lens" cx="50" cy="50" r="32" fill="#12161a" stroke="#6B7782" stroke-width="2"/>' +
    '<g class="k-txt"><text x="108" y="30">R</text><text x="108" y="52">G</text><text x="108" y="74">B</text></g>' +
    '<rect x="122" y="22" width="60" height="9" rx="3" class="k-track"/><rect x="122" y="44" width="60" height="9" rx="3" class="k-track"/><rect x="122" y="66" width="60" height="9" rx="3" class="k-track"/>' +
    '<rect data-k="br" x="122" y="22" width="0" height="9" rx="3" fill="#E5383B"/><rect data-k="bg" x="122" y="44" width="0" height="9" rx="3" fill="#2BC48A"/><rect data-k="bb" x="122" y="66" width="0" height="9" rx="3" fill="#3B82F6"/>');
  var w = wires();
  ['red', 'green', 'blue'].forEach(function (n, i) { w.appendChild(pinSelect('rgp' + i, n, function () { return S.mods.rgb.pins[i]; }, function (v) { S.mods.rgb.pins[i] = v; })); });
  c.el.appendChild(svg); c.el.appendChild(w);
  c.el.appendChild(note('Works with PWM (PF1-PF3 are M0PWM1-3) or plain GPIO. Colors mix by average level.'));
  var lens = q(svg, 'lens'), halo = q(svg, 'halo'), bars = [q(svg, 'br'), q(svg, 'bg'), q(svg, 'bb')];
  return { el: c.el, upd: function () {
    var m = S.mods.rgb, v = [0, 0, 0], i;
    for (i = 0; i < 3; i++) if (S.driven(m.pins[i])) { var l = S.lvl(m.pins[i], 'rg' + i); v[i] = m.anode ? 1 - l : l; }
    var col = 'rgb(' + v.map(function (x) { return Math.round(18 + 237 * Math.pow(x, 0.6)); }).join(',') + ')';
    ca(lens, 'fill', col); ca(halo, 'fill', col); ca(halo, 'opacity', f2(Math.max(v[0], v[1], v[2]) * 0.8, 2));
    for (i = 0; i < 3; i++) ca(bars[i], 'width', f2(v[i] * 60, 1));
  } };
}

var SEGP = ['M22 14L30 8H74L82 14L74 20H30Z', 'M88 20L94 26V66L88 72L82 66V26Z', 'M88 82L94 88V128L88 134L82 128V88Z', 'M22 138L30 132H74L82 138L74 144H30Z',
            'M16 82L22 88V128L16 134L10 128V88Z', 'M16 20L22 26V66L16 72L10 66V26Z', 'M22 76L30 70H74L82 76L74 82H30Z'];
function buildSeg() {
  var c = shell('seg', '7-segment display');
  c.head.appendChild(check('sgAnode', 'common anode', function () { return S.mods.seg.anode; }, function (v) { S.mods.seg.anode = v; }));
  var inner = '<rect x="0" y="0" width="110" height="160" rx="8" fill="#17110F"/>', i;
  for (i = 0; i < 7; i++) inner += '<path d="' + SEGP[i] + '" fill="#34201E"/><path data-k="s' + i + '" d="' + SEGP[i] + '" fill="#FF4B3E" opacity="0"/>';
  inner += '<circle cx="102" cy="140" r="5" fill="#34201E"/><circle data-k="s7" cx="102" cy="140" r="5" fill="#FF4B3E" opacity="0"/>';
  var svg = svgBox('0 0 110 160', 'Seven-segment display', inner), w = wires();
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'].forEach(function (n, i) { w.appendChild(pinSelect('sgp' + i, n, function () { return S.mods.seg.pins[i]; }, function (v) { S.mods.seg.pins[i] = v; })); });
  var rd = h('p', 'note');
  var wrap = h('div', 'row2'); svg.classList.add('seg7'); wrap.appendChild(svg);
  var side = h('div', 'col1'); side.appendChild(w); side.appendChild(rd); wrap.appendChild(side);
  c.el.appendChild(wrap);
  var segs = []; for (i = 0; i < 8; i++) segs.push(q(svg, 's' + i));
  return { el: c.el, upd: function () {
    var m = S.mods.seg, bits = 0;
    for (var i = 0; i < 8; i++) {
      var b = 0; if (S.driven(m.pins[i])) { var l = S.lvl(m.pins[i], 'sg' + i); b = m.anode ? 1 - l : l; }
      ca(segs[i], 'opacity', f2(b, 2)); if (b > 0.5) bits |= 1 << i;
    }
    var ch = MSP.SEGCHARS[bits & 0x7F];
    ct(rd, bits === 0 ? 'Blank.' : ch !== undefined ? 'Shows ' + ch + (bits & 0x80 ? ' with the decimal point.' : '.') : 'Segment pattern 0x' + (bits & 0xFF).toString(16).toUpperCase() + '.');
  } };
}

function ensureAudio() {
  if (audio) { try { if (audio.ctx.state === 'suspended') audio.ctx.resume(); } catch (e) {} return true; }
  try {
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    var ctx = new AC(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'square'; g.gain.value = 0; osc.connect(g); g.connect(ctx.destination); osc.start();
    audio = { ctx: ctx, osc: osc, g: g }; if (ctx.state === 'suspended') ctx.resume(); return true;
  } catch (e) { audio = null; return false; }
}
function muteAudio() { if (audio) { try { audio.g.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.015); } catch (e) {} } }
function buildBuzzer() {
  var c = shell('buzzer', 'Buzzer');
  var sound = h('label', 'chk'), sc = h('input'); sc.type = 'checkbox'; sc.id = 'bzSound'; sound.appendChild(sc); sound.appendChild(document.createTextNode(' Sound'));
  var msg = h('p', 'note'); msg.id = 'bzMsg';
  sc.addEventListener('change', function () {
    soundOn = sc.checked;
    if (soundOn && !ensureAudio()) { soundOn = false; sc.checked = false; sc.disabled = true; ct(msg, 'Audio is not available in this browser.'); }
    if (!soundOn) muteAudio();
  });
  c.head.appendChild(sound);
  c.head.appendChild(choose('bzType', 'Type', [['p', 'passive'], ['a', 'active']], function () { return S.mods.buzzer.passive ? 'p' : 'a'; }, function (v) { S.mods.buzzer.passive = v === 'p'; }));
  c.head.appendChild(check('bzLow', 'active-low (active type)', function () { return S.mods.buzzer.low; }, function (v) { S.mods.buzzer.low = v; }));
  var svg = svgBox('0 0 130 80', 'Speaker that shows when the buzzer is sounding',
    '<path class="k-body" d="M20 30H38L58 14V66L38 50H20Z"/><path data-k="a1" class="k-wave" d="M70 30Q78 40 70 50"/><path data-k="a2" class="k-wave" d="M80 22Q94 40 80 58"/><path data-k="a3" class="k-wave" d="M90 14Q110 40 90 66"/>');
  var w = wires(); w.appendChild(pinSelect('bzp', 'Signal', function () { return S.mods.buzzer.pin; }, function (v) { S.mods.buzzer.pin = v; }));
  var st = h('p', 'note'); st.id = 'bzState';
  c.el.appendChild(svg); c.el.appendChild(w); c.el.appendChild(st); c.el.appendChild(msg);
  c.el.appendChild(note('A passive buzzer needs a toggling signal, and its pitch is the signal frequency. An active buzzer has its own oscillator and sounds whenever it is driven.'));
  var arcs = [q(svg, 'a1'), q(svg, 'a2'), q(svg, 'a3')];
  return { el: c.el, upd: function (active) {
    var b = S.buzzState(), speed = +($('speed').value) || 1, on = b.sound && active;
    for (var i = 0; i < 3; i++) ca(arcs[i], 'opacity', on ? f2(0.25 + 0.75 * b.vol, 2) : 0.12);
    ct(st, b.label);
    if (soundOn && audio) {
      var t = audio.ctx.currentTime, play = on && speed === 1;
      try {
        audio.g.gain.setTargetAtTime(play ? 0.05 * b.vol : 0, t, 0.015);
        if (b.freq > 0) audio.osc.frequency.setTargetAtTime(Math.min(b.freq, 20000), t, 0.005);
      } catch (e) {}
      ct(msg, speed === 1 ? '' : 'Muted: sound plays only at 1x speed.');
    }
  } };
}

function buildMotor() {
  var c = shell('motor', 'DC motor with H-bridge');
  c.head.appendChild(choose('mtRpm', 'Max speed', [['60', '60 rpm'], ['150', '150 rpm'], ['300', '300 rpm']], function () { return S.mods.motor.maxRpm; }, function (v) { S.mods.motor.maxRpm = +v; }));
  var inner = '<rect x="12" y="28" width="76" height="54" rx="9" fill="#5B6B7A" stroke="#3B4753" stroke-width="2"/><rect x="88" y="48" width="22" height="14" fill="#9AA5B1"/>' +
    '<text x="50" y="60" text-anchor="middle" class="k-onbody">DC</text><g data-k="rot">';
  [0, 120, 240].forEach(function (a) { inner += '<ellipse cx="130" cy="34" rx="7" ry="18" fill="#C9D1D9" stroke="#6B7782" transform="rotate(' + a + ' 130 55)"/>'; });
  inner += '<circle cx="130" cy="55" r="6" fill="#2A3036"/></g>';
  var svg = svgBox('0 0 170 110', 'Motor with a rotating propeller', inner), w = wires();
  w.appendChild(pinSelect('mtin1', 'IN1', function () { return S.mods.motor.in1; }, function (v) { S.mods.motor.in1 = v; }));
  w.appendChild(pinSelect('mtin2', 'IN2', function () { return S.mods.motor.in2; }, function (v) { S.mods.motor.in2 = v; }));
  w.appendChild(pinSelect('mten', 'EN (PWM)', function () { return S.mods.motor.en; }, function (v) { S.mods.motor.en = v; }));
  var st = h('p', 'note'); st.id = 'mtState';
  c.el.appendChild(svg); c.el.appendChild(w); c.el.appendChild(st);
  c.el.appendChild(note('IN1 high, IN2 low runs forward; the reverse runs backward; both high brakes. Speed is the average of EN (leave EN not wired to keep the bridge always enabled). Below about 12% drive the motor will not start.'));
  var rot = q(svg, 'rot');
  return { el: c.el, upd: function () {
    var s = S.ms.motor, m = S.mods.motor;
    ca(rot, 'transform', 'rotate(' + f2(s.angle, 1) + ' 130 55)');
    ct(st, s.state + (Math.abs(s.rpm) >= 1 ? ', ' + f2(Math.abs(s.rpm)) + ' rpm' : '') + (m.en && !S.driven(m.en) ? '. EN is not an output yet, so the bridge is off.' : ''));
  } };
}

function buildServo() {
  var c = shell('servo', 'Servo');
  c.head.appendChild(choose('svRange', 'Pulse range', [['n', '1-2 ms'], ['w', '0.5-2.5 ms']], function () { return S.mods.servo.wide ? 'w' : 'n'; }, function (v) { S.mods.servo.wide = v === 'w'; }));
  var svg = svgBox('0 0 180 110', 'Servo horn pointing at the commanded angle',
    '<path class="k-line" d="M20 95A70 70 0 0 1 160 95"/><g class="k-txt" text-anchor="middle"><text x="14" y="108">0</text><text x="90" y="16">90</text><text x="166" y="108">180</text></g>' +
    '<line data-k="horn" x1="90" y1="95" x2="90" y2="33" class="k-horn"/><circle cx="90" cy="95" r="8" fill="#2A3036"/>');
  var w = wires(); w.appendChild(pinSelect('svp', 'Signal', function () { return S.mods.servo.pin; }, function (v) { S.mods.servo.pin = v; }));
  var st = h('p', 'note'); st.id = 'svState';
  c.el.appendChild(svg); c.el.appendChild(w); c.el.appendChild(st);
  c.el.appendChild(note('Needs a pulse train of 20-100 Hz with a 0.4-2.6 ms pulse. The horn moves at up to 600 degrees per second and holds its position when the signal stops.'));
  var horn = q(svg, 'horn');
  return { el: c.el, upd: function () {
    var s = S.ms.servo, a = s.angle * Math.PI / 180;
    ca(horn, 'x2', f2(90 - 62 * Math.cos(a), 1)); ca(horn, 'y2', f2(95 - 62 * Math.sin(a), 1));
    ct(st, s.signal ? f2(s.angle) + ' degrees (target ' + f2(s.target) + '). Pulse ' + f2(s.pulse * 1000, 2) + ' ms at ' + f2(s.freq) + ' Hz.' :
      'No valid servo signal. Holding at ' + f2(s.angle) + ' degrees.');
  } };
}

function buildStepper() {
  var c = shell('stepper', 'Stepper motor (28BYJ-48)');
  var zero = h('button', 'btn small', 'Set zero'); zero.type = 'button'; zero.addEventListener('click', function () { S.zeroStepper(); });
  c.head.appendChild(zero);
  var inner = '<g data-k="rot"><circle cx="80" cy="60" r="38" fill="#5B6B7A" stroke="#3B4753" stroke-width="2"/><circle cx="80" cy="60" r="8" fill="#2A3036"/><rect x="77" y="24" width="6" height="22" rx="2" fill="#F5A524"/></g>';
  var dots = [[80, 10], [132, 60], [80, 110], [28, 60]];
  dots.forEach(function (d, i) { inner += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="7" class="k-coil"/><circle data-k="d' + i + '" cx="' + d[0] + '" cy="' + d[1] + '" r="6" fill="#F5A524" opacity="0"/><text x="' + d[0] + '" y="' + (d[1] + (i === 2 ? 20 : i === 0 ? -11 : 3)) + '" class="k-txt" text-anchor="' + (i === 1 ? 'start' : i === 3 ? 'end' : 'middle') + '" dx="' + (i === 1 ? 11 : i === 3 ? -11 : 0) + '">IN' + (i + 1) + '</text>'; });
  var svg = svgBox('-14 0 188 134', 'Stepper rotor with four coil indicators', inner), w = wires();
  for (var i = 0; i < 4; i++) (function (i) { w.appendChild(pinSelect('stp' + i, 'IN' + (i + 1), function () { return S.mods.stepper.pins[i]; }, function (v) { S.mods.stepper.pins[i] = v; })); })(i);
  var st = h('p', 'note'); st.id = 'stState';
  c.el.appendChild(svg); c.el.appendChild(w); c.el.appendChild(st);
  c.el.appendChild(note('Half-step sequence: IN1, IN1+IN2, IN2, IN2+IN3, IN3, IN3+IN4, IN4, IN4+IN1. 4096 half-steps make one turn of the output shaft. Faster than about 700 half-steps per second the rotor stalls.'));
  var rot = q(svg, 'rot'), ds = [0, 1, 2, 3].map(function (i) { return q(svg, 'd' + i); });
  return { el: c.el, upd: function () {
    var s = S.ms.stepper, ang = s.pos * 360 / 4096;
    ca(rot, 'transform', 'rotate(' + f2(ang, 2) + ' 80 60)');
    for (var i = 0; i < 4; i++) ca(ds[i], 'opacity', (s.pattern >> i) & 1 ? 1 : 0);
    ct(st, 'Angle ' + f2(ang, 1) + ' degrees (' + s.pos + ' half-steps). ' + (s.missed ? s.missed + ' missed step' + (s.missed === 1 ? '' : 's') + '. ' + s.note : s.pattern === 0 ? 'Coils off, holding.' : ''));
  } };
}

function buildDip() {
  var c = shell('dip', 'DIP switches');
  c.head.appendChild(check('dpVcc', 'closes to 3.3 V (otherwise GND)', function () { return S.mods.dip.vcc; }, function (v) { S.mods.dip.vcc = v; S.syncInputs(); }));
  var row = h('div', 'dipwrap'), togs = [], labs = [];
  for (var i = 0; i < 4; i++) (function (i) {
    var cell = h('div', 'dip1'), t = h('button', 'tog', '<span class="knob"></span>'); t.type = 'button'; t.setAttribute('role', 'switch'); t.setAttribute('aria-label', 'DIP switch ' + (i + 1));
    t.addEventListener('click', function () { S.dipSet(i, !S.mods.dip.state[i]); });
    var l = h('span', 'dl'); togs.push(t); labs.push(l);
    cell.appendChild(t); cell.appendChild(l);
    cell.appendChild(pinSelect('dpp' + i, 'S' + (i + 1), function () { return S.mods.dip.pins[i]; }, function (v) { S.mods.dip.pins[i] = v; S.syncInputs(); }));
    row.appendChild(cell);
  })(i);
  c.el.appendChild(row);
  c.el.appendChild(note('Knob down is closed. An open switch leaves the pin floating, so a switch to GND needs the weak pull-up enabled on its pin.'));
  return { el: c.el, upd: function () {
    var m = S.mods.dip;
    for (var i = 0; i < 4; i++) { ca(togs[i], 'aria-checked', m.state[i] ? 'true' : 'false'); ct(labs[i], 'S' + (i + 1) + (m.state[i] ? ' closed' : ' open')); }
  } };
}

function buildBtns() {
  var c = shell('btns', 'Push buttons');
  c.head.appendChild(check('pbVcc', 'closes to 3.3 V (otherwise GND)', function () { return S.mods.btns.vcc; }, function (v) { S.mods.btns.vcc = v; S.syncInputs(); }));
  c.head.appendChild(check('pbBounce', 'contact bounce', function () { return S.mods.btns.bounce; }, function (v) { S.mods.btns.bounce = v; }));
  var row = h('div', 'dipwrap');
  for (var i = 0; i < 4; i++) (function (i) {
    var cell = h('div', 'dip1'), b = h('button', 'pbtn', 'B' + (i + 1)); b.type = 'button'; b.setAttribute('aria-label', 'Push button ' + (i + 1) + ', hold to press');
    hold(b, function () { S.btnSet(i, 1); }, function () { S.btnSet(i, 0); }, 60);
    cell.appendChild(b);
    cell.appendChild(pinSelect('pbp' + i, 'B' + (i + 1), function () { return S.mods.btns.pins[i]; }, function (v) { S.mods.btns.pins[i] = v; S.syncInputs(); }));
    row.appendChild(cell);
  })(i);
  c.el.appendChild(row);
  c.el.appendChild(note('Hold a button to keep it closed. A button to GND needs the weak pull-up on its pin.'));
  return { el: c.el, upd: function () {} };
}


/* ---------- I2C and SPI devices ---------- */
function hexs(v, n) { return ('0000' + (v >>> 0).toString(16).toUpperCase()).slice(-n); }
function addrChoice(id, name) {
  var opts = (MSP.busRules[name].addr).map(function (a) { return [String(a), '0x' + hexs(a, 2)]; });
  return choose(id, 'I2C address', opts, function () { return S.mods[name].addr; }, function (v) { S.mods[name].addr = +v; });
}
function hexDump(mem, base, n) {
  var out = '', i, j;
  for (i = 0; i < n; i += 16) {
    out += hexs(base + i, 4) + ' ';
    for (j = 0; j < 16; j++) out += ' ' + hexs(mem[base + i + j], 2);
    out += '  ';
    for (j = 0; j < 16; j++) { var c = mem[base + i + j]; out += c >= 32 && c < 127 ? String.fromCharCode(c) : '.'; }
    out += '\n';
  }
  return out;
}
function buildTmp() {
  var c = shell('i2c_tmp', 'Temperature sensor (TMP102)');
  c.head.appendChild(addrChoice('tmAddr', 'i2c_tmp'));
  var row = h('label', 'slider'), lab = h('span', 'sl-v'), rg = h('input'); rg.type = 'range'; rg.min = -40; rg.max = 125; rg.step = 0.5; rg.id = 'tmTemp';
  rg.setAttribute('aria-label', 'Ambient temperature in degrees Celsius');
  rg.addEventListener('input', function () { S.mods.i2c_tmp.temp = +rg.value; apply(); });
  binders.push(function () { rg.value = S.mods.i2c_tmp.temp; });
  row.appendChild(document.createTextNode('Temperature ')); row.appendChild(rg); row.appendChild(lab);
  var st = h('p', 'note'); st.id = 'tmState';
  c.el.appendChild(row); c.el.appendChild(st);
  c.el.appendChild(note('Register 0 holds the temperature as a 12-bit two\'s complement value, left-justified in 16 bits, 0.0625 degrees per count. Write the pointer byte first, then read two bytes. Registers 1 to 3 (configuration, T_LOW, T_HIGH) can be written.'));
  return { el: c.el, upd: function () {
    var m = S.mods.i2c_tmp, d = S.busDevice('i2c_tmp'), raw = d.regVal(0);
    ct(lab, f2(m.temp, 1) + ' °C');
    ct(st, 'Register 0 = 0x' + hexs(raw, 4) + ' (' + (raw >> 4) + ' counts). Pointer register ' + d.st.ptr + '.');
  } };
}
function buildI2cEeprom() {
  var c = shell('i2c_eeprom', 'EEPROM 24C02');
  c.head.appendChild(addrChoice('eeAddr', 'i2c_eeprom'));
  var er = h('button', 'btn small', 'Erase'); er.type = 'button'; er.addEventListener('click', function () { var d = S.busDevice('i2c_eeprom'); d.st.mem.fill(0xFF); d.st.rev = (d.st.rev || 0) + 1; });
  c.head.appendChild(er);
  var pre = h('pre', 'hexdump'); pre.setAttribute('aria-label', 'EEPROM contents'); var st = h('p', 'note');
  c.el.appendChild(pre); c.el.appendChild(st);
  c.el.appendChild(note('256 bytes in 8-byte pages. The first byte after the address is the memory address; bytes after it are written, wrapping inside the page. After a STOP the part is busy for 5 ms and does not acknowledge, which is how acknowledge polling works. Contents survive a restart of your program.'));
  var last = '';
  return { el: c.el, upd: function () {
    var d = S.busDevice('i2c_eeprom'), s = d.st, txt = hexDump(s.mem, 0, 256);
    if (txt !== last) { last = txt; pre.textContent = txt; }
    ct(st, (S.T() < s.busyUntil ? 'Writing (internal cycle). ' : 'Idle. ') + s.writes + ' write' + (s.writes === 1 ? '' : 's') + (s.last ? ', last: ' + s.last : '') + '.');
  } };
}
var LCD_CH = function (b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : b === 0xFF || b >= 0xA0 ? '■' : b < 8 ? '▒' : ' '; };
function buildLcd() {
  var c = shell('i2c_lcd', 'LCD 16x2 + PCF8574');
  c.head.appendChild(addrChoice('lcAddr', 'i2c_lcd'));
  var disp = h('div', 'lcd'), rows = [h('div', 'lcdrow'), h('div', 'lcdrow')], cells = [[], []];
  rows.forEach(function (r, i) { for (var k = 0; k < 16; k++) { var s = h('span', 'lcdc', ' '); r.appendChild(s); cells[i].push(s); } disp.appendChild(r); });
  disp.setAttribute('role', 'img'); disp.setAttribute('aria-label', 'LCD screen');
  var st = h('p', 'note'); c.el.appendChild(disp); c.el.appendChild(st);
  c.el.appendChild(note('Backpack wiring: P0 RS, P1 RW, P2 E, P3 backlight, P4-P7 D4-D7, so the display runs in 4-bit mode. It must be initialised with the 0x3, 0x3, 0x3, 0x2 sequence. Commands sent while the controller is busy are lost: 37 microseconds for most, 1.52 ms for clear and home.'));
  return { el: c.el, upd: function () {
    var s = S.busDevice('i2c_lcd').st, k, r;
    ca(disp, 'class', 'lcd' + (s.bl ? ' bl' : '') + (s.on ? ' on' : ''));
    for (r = 0; r < 2; r++) for (k = 0; k < 16; k++) {
      var idx = r * 40 + ((k + s.shiftOff) % 40), ch = s.on ? LCD_CH(s.ddram[idx]) : ' ';
      ct(cells[r][k], ch);
      ca(cells[r][k], 'class', 'lcdc' + (s.on && s.cur && s.ac === idx ? ' cur' : '') + (s.on && s.blink && s.ac === idx ? ' blk' : ''));
    }
    ct(st, !s.is4 ? 'Not initialised: still in 8-bit mode.' : (s.on ? 'Display on' : 'Display off') + ', cursor address ' + s.ac + (s.drops ? '. ' + s.drops + ' byte' + (s.drops === 1 ? '' : 's') + ' lost while busy. ' + s.note : '.'));
  } };
}
function buildOled() {
  var c = shell('i2c_oled', 'OLED 128x64 (SSD1306)');
  c.head.appendChild(addrChoice('olAddr', 'i2c_oled'));
  var cv = h('canvas', 'oledc'); cv.width = 128; cv.height = 64; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'OLED screen');
  var st = h('p', 'note'); c.el.appendChild(cv); c.el.appendChild(st);
  c.el.appendChild(note('Control byte 0x00 introduces commands, 0x40 introduces display data (0x80 and 0xC0 send one byte at a time). The screen stays dark until the charge pump is on (0x8D, 0x14) and the display is switched on (0xAF). Page addressing mode is the default: set the page with 0xB0+n and the column with 0x00/0x10.'));
  var img = null, lastRev = -1, lastOn = null, lastDraw = 0;
  return { el: c.el, upd: function () {
    var s = S.busDevice('i2c_oled').st;
    var key = s.rev + ':' + s.on + ':' + s.pump;
    var nowMs = performance.now();
    if (key !== lastRev && nowMs - lastDraw >= 50) {       // at most about 20 redraws a second
      lastRev = key; lastDraw = nowMs;
      var g = cv.getContext('2d'); if (!g) return;
      var lit = s.on && s.pump;
      g.fillStyle = '#05070A'; g.fillRect(0, 0, 128, 64);
      if (lit) {
        img = g.createImageData(128, 64); if (!img || !img.data) return;
        var px = img.data, x, y, p, bit, v, on, col;
        for (p = 0; p < 8; p++) for (x = 0; x < 128; x++) {
          v = s.fb[p * 128 + x];
          for (bit = 0; bit < 8; bit++) {
            on = s.allOn ? 1 : (v >> bit) & 1; if (s.inv) on ^= 1;
            col = s.remap ? 127 - x : x; y = p * 8 + bit; if (s.comScan) y = 63 - y;
            var o = (y * 128 + col) * 4, k = on ? 70 + Math.round(185 * s.contrast / 255) : 5;
            px[o] = on ? k * 0.55 : 5; px[o + 1] = on ? k * 0.85 : 7; px[o + 2] = on ? k : 10; px[o + 3] = 255;
          }
        }
        g.putImageData(img, 0, 0);
      }
    }
    ct(st, s.on && !s.pump ? 'Display is ON but the charge pump is off, so the panel stays dark. Send 0x8D then 0x14.' : (s.on ? 'Display on' : 'Display off') + ', contrast ' + s.contrast + ', ' + s.cmds + ' command bytes, ' + s.bytes + ' data bytes.');
  } };
}
function csWire(id, name) {
  var w = wires();
  w.appendChild(pinSelect(id, 'Chip select', function () { return S.mods[name].cs; }, function (v) { S.mods[name].cs = v; }));
  return w;
}
function buildSpiEeprom() {
  var c = shell('spi_eeprom', 'EEPROM 25LC256');
  var er = h('button', 'btn small', 'Erase'); er.type = 'button'; er.addEventListener('click', function () { var d = S.busDevice('spi_eeprom'); d.st.mem.fill(0xFF); d.st.rev = (d.st.rev || 0) + 1; });
  c.head.appendChild(choose('seWin', 'Show', [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return [String(i), '0x' + hexs(i * 256, 4)]; }), function () { return win; }, function (v) { win = +v; }));
  c.head.appendChild(er);
  var win = 0, pre = h('pre', 'hexdump'), st = h('p', 'note');
  c.el.appendChild(csWire('seCs', 'spi_eeprom')); c.el.appendChild(pre); c.el.appendChild(st);
  c.el.appendChild(note('PA3 is the hardware frame select (SSI0FSS); any other pin works as a software chip select. SPI mode 0 or 3. Send WREN (0x06) as its own frame before every WRITE (0x02, address high, address low, data...). Pages are 64 bytes. Poll the status register (RDSR 0x05, bit 0 = write in progress) for 5 ms after a write.'));
  var last = '';
  return { el: c.el, upd: function () {
    var s = S.busDevice('spi_eeprom').st, txt = hexDump(s.mem, win * 256, 256);
    if (txt !== last) { last = txt; pre.textContent = txt; }
    ct(st, (S.T() < s.wip ? 'Writing. ' : 'Idle. ') + (s.wel ? 'Write latch set. ' : '') + s.writes + ' write' + (s.writes === 1 ? '' : 's') + (s.last ? ', last: ' + s.last : '') + '.');
  } };
}
function build595() {
  var c = shell('spi_595', '74HC595 + 8 LEDs');
  var row = h('div', 'bitrow'), leds = [];
  for (var i = 7; i >= 0; i--) { var l = h('span', 'bitled'); l.setAttribute('title', 'Q' + (7 - i)); leds.push(l); row.appendChild(l); }
  var st = h('p', 'note');
  c.el.appendChild(csWire('hcCs', 'spi_595')); c.el.appendChild(row); c.el.appendChild(st);
  c.el.appendChild(note('Chip select is wired to the latch clock (RCLK): the shifted byte appears on QA-QH when chip select goes high again. LEDs left to right are QH down to QA, so the first bit sent is QH. Use SPI mode 0 or 3.'));
  return { el: c.el, upd: function () {
    var s = S.busDevice('spi_595').st;
    for (var i = 0; i < 8; i++) ca(leds[i], 'class', 'bitled' + ((s.out >> (7 - i)) & 1 ? ' on' : ''));
    ct(st, 'Output 0x' + hexs(s.out, 2) + ', ' + s.latches + ' latch' + (s.latches === 1 ? '' : 'es') + '.');
  } };
}

/* ---------- bus decoder ---------- */
var busSeen = -1, busLast = 0;
function busFrame() {
  var pn = $('busPanel'); if (!pn) return;
  if (window.Win && !Win.isOpen('bus')) return;               // nothing to draw while the window is closed
  var nowMs = performance.now(); if (nowMs - busLast < 200) return; busLast = nowMs;
  var show = S.busLog.length > 0 || S.anyBus('i2c') || S.anyBus('spi') || S.i2c.en || S.ssi.en;
  if (!show) return;
  if (S.busRev === busSeen) return;
  busSeen = S.busRev;
  var box = $('busLog'), atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8, html = '';
  S.busLog.slice(-120).forEach(function (e) {
    var t = e.t < 1 ? f2(e.t * 1000, 3) + ' ms' : f2(e.t, 4) + ' s';
    html += '<div class="bl ' + (e.err ? 'err' : '') + '"><span class="bt">' + t + '</span><b>' + e.bus + '</b> ' + e.text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>';
  });
  box.innerHTML = html || '<div class="bl dim">No bus traffic yet.</div>';
  if (atEnd) box.scrollTop = box.scrollHeight;
}

var BUILD = { i2c_tmp: buildTmp, i2c_eeprom: buildI2cEeprom, i2c_lcd: buildLcd, i2c_oled: buildOled, spi_eeprom: buildSpiEeprom, spi_595: build595, keypad: buildKeypad, relay: buildRelay, ledbar: buildLedbar, rgb: buildRgb, seg: buildSeg, buzzer: buildBuzzer, motor: buildMotor, servo: buildServo, stepper: buildStepper, dip: buildDip, btns: buildBtns };

/* ---------- checks, validation, persistence ---------- */
function compute() {
  var list = S.partsPins(), seen = {}, msgs = [], unwired = {}, gens = {};
  var res = {}, k;
  for (k in RESERVED_ALWAYS) res[k] = RESERVED_ALWAYS[k];
  if (S.onboard.leds) for (k in RESERVED_LED) res[k] = RESERVED_LED[k];
  if (S.onboard.sw) for (k in RESERVED_SW) res[k] = RESERVED_SW[k];
  list.forEach(function (e) {
    if (!e.pin) { unwired[e.mod] = 1; return; }
    if (seen[e.pin]) msgs.push('P' + e.pin + ' is wired to both ' + seen[e.pin] + ' and ' + e.who + '.'); else seen[e.pin] = e.who;
    if (res[e.pin]) msgs.push('P' + e.pin + ' (' + e.who + ') is also the ' + res[e.pin] + '. Both see the same signal.');
    var g = MSP.PWMOF[e.pin]; if (g !== undefined) (gens[g >> 1] || (gens[g >> 1] = {}))[e.mod] = 1;
  });
  msgs = msgs.concat(MSP.busChecks(S));
  var un = Object.keys(unwired); if (un.length) msgs.push('Some pins are not wired on: ' + un.join(', ') + '.');
  Object.keys(gens).forEach(function (g) { var m = Object.keys(gens[g]); if (m.length > 1) msgs.push(m.join(' and ') + ' use outputs of the same PWM generator, so they share one period.'); });
  return msgs;
}
function validate() {
  var msgs = compute(), w = $('partsWarn'); if (!w) return msgs;
  w.className = msgs.length ? 'warnline on' : 'warnline';
  w.textContent = msgs.slice(0, 4).join(' ');
  return msgs;
}
function save() { if (BENCH) return; try { store.set('e401y.wiring2', JSON.stringify(S.partsExport())); } catch (e) {} }
function refresh() {
  binders.forEach(function (f) { f(); });
  LIST.forEach(function (x) {
    var on = S.partIsOn(x.id);
    if (picks[x.id]) picks[x.id].checked = on;
    if (cards[x.id]) cards[x.id].el.hidden = BENCH ? false : !on;
  });
  $('sw1').disabled = !S.onboard.sw; $('sw2').disabled = !S.onboard.sw;
  $('boardNote').textContent = S.onboard.leds ? 'D1 PN1 / D2 PN0 / D3 PF4 / D4 PF0' : 'User LEDs disconnected';
  if (ob.leds) ob.leds.checked = S.onboard.leds;
  if (ob.sw) ob.sw.checked = S.onboard.sw;
}
var ob = {};
function apply() { refresh(); validate(); save(); if (hooks.change) hooks.change(); }

function init(sim, st, opts) {
  S = sim; store = st; S.defaultParts(); opts = opts || {}; BENCH = !!opts.bench; hooks = opts;
  var saved = null;
  try { saved = BENCH ? null : JSON.parse(store.get('e401y.wiring2') || 'null'); } catch (e) { saved = null; }
  if (!saved && !BENCH) {
    try {
      var o = JSON.parse(store.get('e401y.wiring') || 'null');
      if (o && o.rows && o.cols) saved = { keypad: { on: o.kpOn !== false, rows: o.rows, cols: o.cols, bounce: !!o.bounce }, relay: { on: o.rlOn !== false, pin: o.pin, low: o.low !== false } };
    } catch (e) {}
  }
  if (saved) S.partsImport(saved);
  var box = $('partChecks'), cardBox = $('partCards');
  LIST.forEach(function (x) {
    if (box && !BENCH) {
      if (x.grp) box.appendChild(h('div', 'pickgrp', x.grp));
      var l = h('label', 'pick'), i = h('input'); i.type = 'checkbox'; i.id = 'pick-' + x.id;
      i.addEventListener('change', function () { S.partOn(x.id, i.checked); apply(); });
      l.appendChild(i); l.appendChild(document.createTextNode(x.label)); box.appendChild(l); picks[x.id] = i;
    }
    if (BUILD[x.id]) { var cd = BUILD[x.id](); cd.el.hidden = !BENCH; cardBox.appendChild(cd.el); cards[x.id] = cd; }
  });
  var pu = $('busPull'); if (pu) { pu.addEventListener('change', function () { S.mods.buses.pullups = pu.checked; apply(); }); binders.push(function () { pu.checked = !!S.mods.buses.pullups; }); }
  var bc = $('busClear'); if (bc) bc.addEventListener('click', function () { S.busLog = []; S.busRev++; });
  var wr = $('wiringReset'); if (wr) wr.addEventListener('click', function () { S.partsImport(DEFAULT_CFG); apply(); });
  if (!BENCH) apply();
}
// Tick boxes for the two on-board items that a LaunchPad jumper can disconnect.
function onboardChecks(box) {
  [['leds', 'User LEDs D1-D4 connected'], ['sw', 'User switches SW1, SW2 connected']].forEach(function (x) {
    var l = h('label', 'chk'), i = h('input'); i.type = 'checkbox'; i.id = 'ob-' + x[0]; i.checked = S.onboard[x[0]];
    i.addEventListener('change', function () { S.partOn(x[0], i.checked); apply(); });
    l.appendChild(i); l.appendChild(document.createTextNode(' ' + x[1])); box.appendChild(l); ob[x[0]] = i;
  });
}
function need(ids) {
  var any = false;
  ids.forEach(function (id) { if (!S.partIsOn(id)) { S.partOn(id, true); any = true; } });
  if (any) apply();
}
function labels(ids) { return ids.map(function (id) { return LABEL[id] || id; }).join(', '); }
function frame(active) {
  if (!S) return;
  S.modStep();
  LIST.forEach(function (x) { var cd = cards[x.id]; if (cd && S.partIsOn(x.id)) cd.upd(active); });
  if (!S.partIsOn('buzzer')) muteAudio();
  busFrame();
}
return { init: init, frame: frame, need: need, labels: labels, apply: apply, refresh: refresh, compute: compute, card: function (id) { return cards[id]; }, LIST: LIST, LABEL: LABEL, onboardChecks: onboardChecks };
})();
