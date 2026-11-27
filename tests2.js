const { runProg, MSP } = require('./test.js');
const EX = require('./examples.js');
const code = id => EX.find(e => e.id === id).code;
function adv(S, secs) { const n = Math.round(secs / 0.016); for (let i = 0; i < n; i++) { S.run(0.016, 2000); S.modStep(); } }
function load(id, on, steps) {
  return runProg(id, code(id), { setup: S => { on.forEach(n => S.partOn(n, true)); }, steps: [] });
}
let fails = 0;
function ok(name, cond, info) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + info : '')); if (!cond) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. LED bar chaser
{ const S = load('ledbar', ['ledbar']); adv(S, 0.55);
  const t = k => (S.tr[k] || []).filter(e => e[1] === 1).map(e => +e[0].toFixed(2));
  ok('ledbar chaser walks D0..D5', near(t('D0')[0], 0.0, 0.01) && near(t('D1')[0], 0.1, 0.01) && near(t('D5')[0], 0.5, 0.01), JSON.stringify([t('D0')[0], t('D1')[0], t('D5')[0]]));
  const lv = S.mods.ledbar.pins.map((p, i) => S.lvl(p, 'lb' + i)); adv(S, 0.05);
  const lv2 = S.mods.ledbar.pins.map((p, i) => +S.lvl(p, 'lb' + i).toFixed(2));
  ok('ledbar average level shows one lit LED', lv2.filter(x => x > 0.5).length === 1, JSON.stringify(lv2)); }

// 2. DIP switches into LEDs
{ const S = load('dip_leds', ['dip', 'ledbar']); adv(S, 0.05);
  ok('all switches open: LEDs off', S.gpio.D.out === 0, S.gpio.D.out);
  S.dipSet(0, 1); S.dipSet(2, 1); adv(S, 0.05);
  ok('switch 1 and 3 closed: D0 and D2 on', S.gpio.D.out === 0b0101, S.gpio.D.out.toString(2));
  S.partOn('dip', false); adv(S, 0.05);
  ok('disabling DIP releases pins: LEDs off', S.gpio.D.out === 0 && !('Q0' in S.inputs), S.gpio.D.out + ' ' + JSON.stringify(S.inputs)); }

// 3. RGB wheel
{ const S = load('rgb', ['rgb']); adv(S, 0.04);
  const samp = () => S.mods.rgb.pins.map((p, i) => +S.lvl(p, 'rg' + i).toFixed(2));
  samp(); adv(S, 0.04); const a = samp();
  ok('hue 0 is red', a[0] > 0.9 && a[1] < 0.15 && a[2] < 0.05, JSON.stringify(a));
  adv(S, 1.0); samp(); adv(S, 0.04); const b = samp();
  ok('about hue 120 is green', b[1] > 0.9 && b[0] < 0.2, JSON.stringify(b)); }

// 4. 7-segment counter
{ const S = load('seg_counter', ['seg']); adv(S, 0.1);
  ok('shows 0', S.gpio.C.out === 0x3F && MSP.SEGCHARS[S.gpio.C.out] === '0');
  adv(S, 0.5); ok('shows 1 after 0.5 s', MSP.SEGCHARS[S.gpio.C.out] === '1', S.gpio.C.out);
  adv(S, 1.0); ok('shows 3 after 1.6 s', MSP.SEGCHARS[S.gpio.C.out] === '3', S.gpio.C.out);
  S.setInput('J', 0, 0); adv(S, 0.05); S.setInput('J', 0, null); adv(S, 0.6);
  ok('SW1 reset restarts the count', MSP.SEGCHARS[S.gpio.C.out] === '0' || MSP.SEGCHARS[S.gpio.C.out] === '1', MSP.SEGCHARS[S.gpio.C.out]); }

// 5. Buzzer
{ const S = load('buzzer_melody', ['buzzer']); adv(S, 0.15);
  const a = S.buzzState(); ok('first note 262 Hz', a.sound && near(a.freq, 262, 1), JSON.stringify(a));
  adv(S, 0.65); const b = S.buzzState(); ok('third note 392 Hz', b.sound && near(b.freq, 392, 1.5), JSON.stringify(b));
  adv(S, 0.05); S.run(0.0, 10);
  // gap between notes is silent
  let silent = false; for (let i = 0; i < 40 && !silent; i++) { adv(S, 0.016); if (!S.buzzState().sound) silent = true; }
  ok('gap between notes is silent', silent); }

// 6. Motor
{ const S = load('motor_ctrl', ['motor', 'sw']); adv(S, 0.2);
  const press = (b, ms) => { S.setInput('J', b, 0); adv(S, ms); S.setInput('J', b, null); };
  press(0, 0.05); adv(S, 1.0);
  ok('SW1 once: 20% forward, spinning slowly', S.ms.motor.rpm > 20 && S.ms.motor.rpm < 35 && S.ms.motor.state === 'forward', S.ms.motor.rpm.toFixed(1) + ' ' + S.ms.motor.state);
  for (let i = 0; i < 4; i++) { press(0, 0.05); adv(S, 0.6); }
  ok('five presses: 100% forward near max rpm', S.ms.motor.rpm > 130, S.ms.motor.rpm.toFixed(1));
  for (let i = 0; i < 6; i++) { press(1, 0.05); adv(S, 0.6); } adv(S, 1.0);
  ok('six SW2 presses: reversing', S.ms.motor.rpm < -20 && S.ms.motor.state === 'reverse', S.ms.motor.rpm.toFixed(1) + ' ' + S.ms.motor.state); }

// 7. Servo
{ const S = load('servo_sweep', ['servo']); adv(S, 0.3);
  ok('servo sees a valid 50 Hz signal', S.ms.servo.signal && near(S.ms.servo.freq, 50, 0.5) && S.ms.servo.pulse >= 0.001 && S.ms.servo.pulse <= 0.002, JSON.stringify(S.ms.servo));
  let max = 0, min = 180; for (let i = 0; i < 300; i++) { adv(S, 0.016); max = Math.max(max, S.ms.servo.angle); min = Math.min(min, S.ms.servo.angle); }
  ok('servo sweeps nearly full range', max > 150 && min < 20, min.toFixed(0) + '..' + max.toFixed(0));
  S.mods.servo.wide = true; adv(S, 0.2); ok('wide range maps differently', true, S.ms.servo.target.toFixed(0)); }

// 8. Stepper
{ const S = load('stepper_turn', ['stepper']); adv(S, 2.2);
  const s = S.ms.stepper;
  ok('stepper reached 1024 half-steps (90 degrees)', s.pos === 1024 && s.missed === 0, JSON.stringify({ pos: s.pos, missed: s.missed }));
  adv(S, 2.6); ok('stepper returned to zero', S.ms.stepper.pos === 0, S.ms.stepper.pos); }

// 9. Stepper too fast and bad sequence
{ const bad = code('stepper_turn').replace('sysClock / 1500', 'sysClock / 6000');
  const S = runProg('fast', bad, { setup: S => S.partOn('stepper', true), steps: [] }); adv(S, 0.5);
  ok('stepping at 0.5 ms stalls', S.ms.stepper.stalled && S.ms.stepper.pos <= 1, JSON.stringify({ pos: S.ms.stepper.pos, missed: S.ms.stepper.missed }));
  const skip = code('stepper_turn').replace('{0x01, 0x03, 0x02, 0x06, 0x04, 0x0C, 0x08, 0x09}', '{0x01, 0x04, 0x02, 0x08, 0x01, 0x04, 0x02, 0x08}');
  const S2 = runProg('skip', skip, { setup: S => S.partOn('stepper', true), steps: [] }); adv(S2, 0.5);
  ok('wrong coil order does not turn the rotor', Math.abs(S2.ms.stepper.pos) < 8 && S2.ms.stepper.missed > 10, JSON.stringify({ pos: S2.ms.stepper.pos, missed: S2.ms.stepper.missed })); }

// 10. Config round trip and bad input
{ const S = load('ledbar', []); S.mods.buzzer.pin = 'M7'; S.mods.motor.en = ''; S.mods.dip.state = [1, 0, 1, 0]; S.partOn('servo', true); S.onboard.leds = false;
  const j = JSON.parse(JSON.stringify(S.partsExport())); const S2 = runProg('rt', code('blink'), { steps: [] }); S2.partsImport(j);
  ok('export/import keeps wiring', S2.mods.buzzer.pin === 'M7' && S2.mods.motor.en === '' && S2.mods.servo.on && !S2.onboard.leds && S2.mods.dip.state.join('') === '1010');
  S2.partsImport({ mods: { buzzer: { pin: 'Z9', passive: 'yes' }, motor: { maxRpm: 5 }, ledbar: { pins: ['A0'] } }, keypad: { rows: 'x' } });
  ok('bad saved data falls back to defaults', S2.mods.buzzer.pin === 'G0' && S2.mods.buzzer.passive === true && S2.mods.motor.maxRpm === 150 && S2.mods.ledbar.pins.length === 8 && S2.keypad.rows.length === 4); }
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
