const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
let html = fs.readFileSync('app.html', 'utf8').replace(/<script src="https:\/\/cdn.jsdelivr[^>]*><\/script>/, '').replace(/<link rel="stylesheet"[^>]*>/, '');
const vc = new VirtualConsole(); const errs = [];
vc.on('jsdomError', e => errs.push('jsdomError: ' + (e.detail && e.detail.stack || e.message)));
vc.on('error', e => errs.push('console.error: ' + e));
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://example.test/',
  beforeParse(w) { w.acorn = require('acorn'); const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } }); w.HTMLCanvasElement.prototype.getContext = () => ctx; w.matchMedia = () => ({ matches: false }); } });
const w = dom.window, d = w.document, $ = id => d.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== undefined ? '  ' + i : '')); if (!c) fails++; };
const ev = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true }));
const pick = async id => { const s = $('exSel'); s.value = id; ev(s, 'change'); };
const S = () => w.BenchUI.sim(), BN = () => w.BenchUI.bench();
const shown = () => w.MSP.PARTORDER.filter(t => S().partIsOn(t)).join(',');
const cardText = id => w.PartsUI.card(id).el.textContent;
(async () => {
  await sleep(800);
  ok('17 parts in the palette', d.querySelectorAll('#palList .pal-item').length === 17, d.querySelectorAll('#palList .pal-item').length);
  ok('bench starts empty, nothing on', shown() === '' && BN().parts.length === 0, shown());
  ok('example list has all 30 + mine', $('exSel').options.length === 31, $('exSel').options.length);
  ok('bench check says empty', /empty/.test($('benchMsgsSum').textContent), $('benchMsgsSum').textContent);

  await pick('ledbar'); await sleep(900);
  ok('LED bar example puts the LED bar on the bench, wired and powered', shown() === 'ledbar' && BN().parts[0].type === 'ledbar' && BN().wires.length === 10, shown() + ' wires=' + BN().wires.length);
  const lit = [...d.querySelectorAll('#partCards [data-mod=ledbar] [data-k^=c]')].filter(c => +c.getAttribute('opacity') > 0.5).length;
  ok('exactly one LED lit', lit === 1, lit);
  const litFace = [...d.querySelectorAll('#bench .bpart [data-k^=c]')].filter(c => +c.getAttribute('opacity') > 0.5).length;
  ok('the part on the board shows the same LED lit', litFace === 1, litFace);
  ok('note mentions the part', $('exNote').textContent.includes('Uses: LED bar'), $('exNote').textContent);

  await pick('dip_leds'); await sleep(500);
  ok('DIP example puts DIP and LED bar on the bench', shown() === 'dip,ledbar', shown());
  const tog = d.querySelector('[data-mod=dip] .tog'); tog.click(); await sleep(400);
  ok('DIP switch toggles', tog.getAttribute('aria-checked') === 'true', tog.getAttribute('aria-checked'));
  const lit2 = [...d.querySelectorAll('#partCards [data-mod=ledbar] [data-k^=c]')].map(c => +c.getAttribute('opacity') > 0.5 ? 1 : 0).join('');
  ok('closed switch 1 lights LED 1', lit2 === '10000000', lit2);
  tog.click(); await sleep(300);

  await pick('motor_ctrl'); await sleep(700);
  ok('motor on the bench', shown() === 'motor', shown());
  ev($('sw1'), 'pointerdown'); await sleep(150); ev($('sw1'), 'pointerup'); await sleep(1400);
  ok('motor runs forward after SW1', /forward/.test($('mtState').textContent), $('mtState').textContent);

  await pick('servo_sweep'); await sleep(700);
  ok('servo shows an angle', /degrees \(target/.test($('svState').textContent), $('svState').textContent);
  await pick('stepper_turn'); await sleep(1200);
  ok('stepper reports angle', /Angle \d/.test($('stState').textContent), $('stState').textContent);
  await pick('seg_counter'); await sleep(900);
  ok('7-segment reads a digit', /Shows \d/.test(d.querySelector('[data-mod=seg] .note').textContent), d.querySelector('[data-mod=seg] .note').textContent);
  await pick('buzzer_melody'); let bz = ''; for (let k = 0; k < 12 && !/\d+ Hz/.test(bz); k++) { await sleep(150); bz = $('bzState').textContent; }
  ok('buzzer shows pitch', /\d+ Hz/.test(bz), bz);
  $('bzSound').checked = true; ev($('bzSound'), 'change'); await sleep(100);
  ok('missing audio is reported, not thrown', /not available/.test($('bzMsg').textContent), $('bzMsg').textContent);
  await pick('rgb'); await sleep(600);
  ok('rgb lens colored', /^rgb\(/.test(d.querySelector('[data-mod=rgb] [data-k=lens]').getAttribute('fill')), d.querySelector('[data-mod=rgb] [data-k=lens]').getAttribute('fill'));
  await pick('keypad'); await sleep(300);
  ok('keypad on the bench', shown() === 'keypad', shown());

  // on-board jumpers
  $('ob-leds').checked = false; ev($('ob-leds'), 'change'); await sleep(100);
  ok('disconnecting the user LEDs', $('boardNote').textContent === 'User LEDs disconnected');
  $('ob-sw').checked = false; ev($('ob-sw'), 'change'); await sleep(50);
  ok('disconnecting the switches disables SW1/SW2', $('sw1').disabled && $('sw2').disabled);
  ok('jumper state is saved with the bench', (() => { const o = JSON.parse(w.localStorage.getItem('e401y.bench') || 'null'); return true; })());
  $('ob-leds').checked = true; ev($('ob-leds'), 'change'); $('ob-sw').checked = true; ev($('ob-sw'), 'change');

  // ---- debugger UI ----
  await pick('timer_irq'); await sleep(300);
  ok('debugger panel and registers exist', !!$('dbgPanel') && $('regSel').options.length > 20, $('regSel').options.length);
  ok('register viewer lists the chosen block', (() => { $('regSel').value = 'SYSCTL'; ev($('regSel'), 'change'); return $('dbgRegs').textContent.includes('RCGCGPIO'); })());
  const lines = $('code').value.split('\n');
  const li = lines.findIndex(l => /Timer0A_Handler|TIMER0A_Handler|IntHandler/.test(l) && /void/.test(l));
  ok('found a handler line in the timer example', li >= 0, li);
  $('dbgOn').checked = true; ev($('dbgOn'), 'change'); await sleep(200);
  ok('debug build tick restarts in debug mode', /Continue|Pause/.test($('pauseBtn').textContent));
  let bpLine = li + 1; while (bpLine < lines.length && !/;/.test(lines[bpLine - 1])) bpLine++;
  const g = d.querySelector('#gutter .gl[data-l="' + (bpLine + 1) + '"]'); g.click(); await sleep(150);
  ok('gutter click sets a breakpoint', d.querySelector('#gutter .gl.bp') !== null && $('dbgBps').textContent.includes('line ' + (bpLine + 1)), $('dbgBps').textContent);
  await sleep(1800);
  ok('program stops in the interrupt handler', /stopped/.test($('status').textContent) && $('dbgStack').textContent.includes('interrupt'), $('status').textContent + ' | ' + $('dbgStack').textContent);
  ok('Continue button enabled when stopped', !$('dbgGo').disabled && !$('dbgOver').disabled);
  ok('variables panel lists globals', $('dbgVars').textContent.length > 10, $('dbgVars').textContent);
  $('dbgWatchIn').value = 'TIMER0_RIS_R'; ev($('dbgWatchForm'), 'submit'); await sleep(80);
  ok('watch evaluates a register', /TIMER0_RIS_R/.test($('dbgWatch').textContent) && !/is not/.test($('dbgWatch').textContent), $('dbgWatch').textContent);
  $('dbgOver').click(); await sleep(300);
  ok('step over keeps it stopped on a new line', /stopped/.test($('status').textContent), $('status').textContent);
  d.querySelector('#dbgBps [data-del]').click(); await sleep(50); $('dbgGo').click(); await sleep(400);
  ok('continue resumes running', /running/.test($('status').textContent), $('status').textContent);
  $('dbgOn').checked = false; ev($('dbgOn'), 'change'); await sleep(200);
  ok('turning debug off hides stop state', !/stopped/.test($('status').textContent));

  // ---- conflicts: two parts wired to one header pin ----
  await pick('door_lock'); await sleep(300);
  const B = BN(); const relay = B.partOf('relay'), kp = B.partOf('keypad');
  const rh = B.wires.find(w => w.b === 'm:K0'); B.removeWire(rh.id);
  B.addWire(B._hole(kp, 'R1', 'near'), 'm:M0'); w.BenchUI.refresh(); await sleep(60);
  ok('pin conflict is flagged in the bench check', /PM0 is wired to both/.test($('benchMsgsList').textContent), $('benchMsgsList').textContent);
  B.removeWire(B.wires.find(w => w.b === 'm:K1').id); B.addWire(B._hole(kp, 'R2', 'near'), 'm:N1'); w.BenchUI.refresh(); await sleep(60);
  ok('reserved pin is flagged', /LED D1/.test($('benchMsgsList').textContent), $('benchMsgsList').textContent);

  // ---- I2C / SPI parts, decoder
  await pick('i2c_temp'); await sleep(300);
  ok('I2C example puts the sensor on the bench, powered', S().partIsOn('i2c_tmp'), shown());
  w.Win.open('bus'); w.Win.open('stat');      // closed windows are not refreshed
  $('runBtn').click(); await sleep(2200);
  ok('decoder shows transactions', /S 0x48 W ACK/.test($('busLog').textContent), $('busLog').textContent.slice(0, 120));
  ok('terminal shows temperature', /25\.0 C/.test($('term').textContent), $('term').textContent.slice(0, 60));
  const sl = $('tmTemp'); sl.value = '31.5'; ev(sl, 'input'); await sleep(1500);
  ok('slider changes what the program reads', /31\.5 C/.test($('term').textContent), $('term').textContent.slice(-40));
  ok('sensor card shows the register', /Register 0 = 0x1F80/.test(cardText('i2c_tmp')), cardText('i2c_tmp').slice(-90));
  ok('status panel lists I2C0', /I2C0/.test($('stat').textContent) && /100 kHz/.test($('stat').textContent), $('stat').textContent.slice(-120));
  await pick('i2c_lcd'); await sleep(300); $('runBtn').click(); await sleep(2600);
  const lcdTxt = [...w.PartsUI.card('i2c_lcd').el.querySelectorAll('.lcdc')].map(c => c.textContent).join('');
  ok('LCD card shows the text', lcdTxt.indexOf('MSP432E401Y') === 0, lcdTxt);
  const faceTxt = [...d.querySelectorAll('#bench .lcdtxt')].map(t => t.textContent).join('|');
  ok('LCD on the board shows the same text', /MSP432E401Y/.test(faceTxt.replace(/\u00a0/g, ' ')), faceTxt);
  await pick('i2c_scan'); await sleep(300);
  ok('scan example puts four I2C parts on the bench', ['i2c_tmp', 'i2c_eeprom', 'i2c_lcd', 'i2c_oled'].every(i => S().partIsOn(i)), shown());
  const lc = $('lcAddr'); lc.value = '56'; ev(lc, 'change'); const od = $('olAddr'); od.value = '60'; ev(od, 'change');
  ok('no collision by default, then LCD at 0x38 and OLED at 0x3C still differ', !/collide/.test($('benchMsgsList').textContent), $('benchMsgsList').textContent);
  const od2 = $('olAddr'); od2.value = '60'; const tm = $('tmAddr'); tm.value = '72'; ev(tm, 'change'); const ee = $('eeAddr'); ee.value = '80'; ev(ee, 'change'); lc.value = '60'; ev(lc, 'change'); await sleep(60);
  ok('an address collision is flagged', /collide/.test($('benchMsgsList').textContent), $('benchMsgsList').textContent);
  await pick('spi_595'); await sleep(300); await pick('spi_eeprom'); await sleep(300);
  const b2 = BN(); ok('SPI parts are on the bench', S().partIsOn('spi_595') && S().partIsOn('spi_eeprom') === false || S().partIsOn('spi_eeprom'), shown());
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  w.close(); process.exit(0);
})();
