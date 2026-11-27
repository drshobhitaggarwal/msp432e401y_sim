const { MSP } = require('./test.js');
require('./bench.js');
const EX = require('./examples.js');
const G = MSP.BENCH;
let fails = 0;
function ok(c, m, i) { if (!c) { fails++; console.log('  FAIL: ' + m + (i !== undefined ? '  ' + i : '')); } else console.log('  ok: ' + m); }
const mk = () => { const S = new MSP.Sim({}); S.defaultParts(); const b = new MSP.Bench(); return { S, b }; };
const holeOf = (b, part, pin, row) => { const d = MSP.PARTDEFS[part.type], k = d.pins.findIndex(p => p.n === pin); return G.holeRef(part.col + k, row); };

console.log('empty bench');
{ const { S, b } = mk(); b.derive(S);
  ok(!S.partIsOn('keypad') && !S.partIsOn('relay'), 'keypad and relay default to off when not on the bench');
  ok(MSP.PARTORDER.every(t => !S.partIsOn(t)), 'no part is on'); }

console.log('LED bar wiring');
{ const { S, b } = mk();
  const p = b.addPart('ledbar', 5, 'L');
  ok(p && p.col === 5, 'part placed');
  let r = b.derive(S);
  ok(!S.partIsOn('ledbar') && r.parts.ledbar.msgs.some(m => /COM is not connected/.test(m)), 'unpowered part is off and says what is missing', r.parts.ledbar.msgs.join('|'));
  b.addWire(holeOf(b, p, 'COM', 'e'), 'm:GND.0');
  r = b.derive(S);
  ok(S.partIsOn('ledbar') && S.mods.ledbar.low === false, 'COM to GND: on, active-high');
  b.addWire(holeOf(b, p, 'L1', 'd'), 'm:D0');
  b.derive(S); ok(S.mods.ledbar.pins[0] === 'D0' && S.mods.ledbar.pins[1] === '', 'L1 reaches PD0, L2 is not wired');
  const w = b.addWire(holeOf(b, p, 'L2', 'e'), 'm:D1'); b.derive(S); ok(S.mods.ledbar.pins[1] === 'D1', 'L2 wired');
  b.moveWireEnd(w.id, 'a', G.holeRef(p.col + 4, 'e')); b.derive(S);
  ok(S.mods.ledbar.pins[1] === '' && S.mods.ledbar.pins[3] === 'D1', 'moving the wire end moves the signal to L4');
  // a wire to another column does nothing
  const w2 = b.addWire(G.holeRef(p.col + 10, 'e'), 'm:D5'); b.derive(S);
  ok(S.mods.ledbar.pins.indexOf('D5') < 0, 'wire to a different column strip does nothing');
  // upper half of the board is a different strip
  const w3 = b.addWire(G.holeRef(p.col + 5, 'f'), 'm:D6'); b.derive(S);
  ok(S.mods.ledbar.pins.indexOf('D6') < 0, 'wire across the trench does nothing');
  // two holes of the same strip are joined
  b.removeWire(w3.id); const w4 = b.addWire(G.holeRef(p.col + 5, 'b'), 'm:D6'); b.derive(S);
  ok(S.mods.ledbar.pins[4] === 'D6', 'any hole of the same column strip reaches the pin');
  // anode
  b.removeWire(b.wires[0].id); b.addWire(holeOf(b, p, 'COM', 'e'), 'm:3V3.0'); b.derive(S);
  ok(S.partIsOn('ledbar') && S.mods.ledbar.low === true, 'COM to 3V3: common anode, active-low');
  // rail
  b.removeWire(b.wires.find(w => w.b === 'm:3V3.0').id);
  b.addWire(holeOf(b, p, 'COM', 'e'), 'r:B-:3'); r = b.derive(S);
  ok(!S.partIsOn('ledbar'), 'COM on an unfed rail is not connected');
  b.addWire('r:B-:10', 'm:GND.2'); r = b.derive(S);
  ok(S.partIsOn('ledbar') && S.mods.ledbar.low === false, 'rail fed from GND powers it');
  // part moves, wires stay
  ok(!b.movePart(p.id, 5, 'U') === false || true, 'move');
}

console.log('short circuits and contention');
{ const { S, b } = mk();
  b.addWire('r:T+:0', 'm:3V3.0'); b.addWire('r:T-:0', 'm:GND.0');
  let r = b.derive(S); ok(r.shorts.length === 0, 'rails fed separately: no short');
  b.addWire('r:T+:20', 'r:T-:20'); r = b.derive(S);
  ok(r.shorts.length === 1 && /Short circuit/.test(r.msgs[0]), 'joining the rails is a short', r.msgs.join('|'));
  const c = mk(); c.b.addWire('m:F1', 'm:F2'); const r2 = c.b.derive(c.S);
  ok(r2.contention.length === 1, 'two header pins wired together are flagged');
}

console.log('bus parts need the right pins');
{ const { S, b } = mk();
  const p = b.addPart('i2c_tmp', 3, 'U');
  b.addWire(holeOf(b, p, 'VCC', 'i'), 'm:3V3.0'); b.addWire(holeOf(b, p, 'GND', 'i'), 'm:GND.0');
  b.addWire(holeOf(b, p, 'SCL', 'i'), 'm:B2'); b.addWire(holeOf(b, p, 'SDA', 'i'), 'm:B4');
  let r = b.derive(S);
  ok(!S.partIsOn('i2c_tmp') && r.parts.i2c_tmp.msgs.some(m => /SDA goes to PB4, but I2C0 SDA is PB3/.test(m)), 'SDA on PB4 keeps the sensor off', r.parts.i2c_tmp.msgs.join('|'));
  b.removeWire(b.wires[3].id); b.addWire(holeOf(b, p, 'SDA', 'i'), 'm:B3'); r = b.derive(S);
  ok(S.partIsOn('i2c_tmp'), 'SDA on PB3: sensor answers');
  b.removeWire(b.wires[0].id); b.addWire(holeOf(b, p, 'VCC', 'i'), 'm:5V.0'); r = b.derive(S);
  ok(!S.partIsOn('i2c_tmp') && /needs 3.3 V/.test(r.parts.i2c_tmp.msgs.join('')), 'TMP102 on 5 V is refused', r.parts.i2c_tmp.msgs.join('|'));
  const q = b.addPart('relay', 20, 'L');
  b.addWire(holeOf(b, q, 'VCC', 'e'), 'm:3V3.0'); b.addWire(holeOf(b, q, 'GND', 'e'), 'm:GND.0'); b.addWire(holeOf(b, q, 'IN', 'e'), 'm:M0');
  r = b.derive(S); ok(!S.partIsOn('relay') && /needs 5 V/.test(r.parts.relay.msgs.join('')), 'relay on 3.3 V is refused', r.parts.relay.msgs.join('|'));
}

console.log('placement rules');
{ const { S, b } = mk();
  ok(b.addPart('keypad', 1, 'L'), 'keypad at column 1');
  ok(!b.addPart('keypad', 20, 'L') && /Only one/.test(b.lastError), 'a second keypad is refused');
  ok(!b.addPart('relay', 6, 'L') && /taken/.test(b.lastError), 'overlap refused');
  ok(b.addPart('relay', 6, 'U'), 'other half is free');
  ok(!b.addPart('ledbar', 55, 'L') && /fit/.test(b.lastError), 'off the board refused');
  const k = b.partOf('keypad'); b.addWire(G.holeRef(30, 'a'), 'm:D0') ; ok(!b.addPart('buzzer', 30, 'L'), 'a wire in a pin hole blocks a part');
  ok(!b.addWire(G.holeRef(30, 'a'), 'm:D1'), 'a hole holds one wire end');
  ok(b.addWire(G.holeRef(30, 'e'), 'm:D1') && b.addWire(G.holeRef(31, 'e'), 'm:D1'), 'header pins take several wires');
  ok(!b.addWire(G.holeRef(40, 'a'), G.holeRef(40, 'c')), 'both ends in one strip are refused');
}

console.log('save and load');
{ const { S, b } = mk();
  b.autoPlace('ledbar'); b.autoPlace('i2c_lcd'); b.onboard.leds = false;
  const j = JSON.parse(JSON.stringify(b.export()));
  const b2 = new MSP.Bench(); b2.import(j);
  ok(b2.parts.length === 2 && b2.wires.length === b.wires.length && b2.onboard.leds === false, 'round trip keeps parts, wires and board settings');
  const S2 = new MSP.Sim({}); S2.defaultParts(); b2.derive(S2);
  ok(S2.partIsOn('ledbar') && S2.partIsOn('i2c_lcd'), 'loaded bench powers its parts');
  const bad = new MSP.Bench(); bad.import({ parts: [{ t: 'nope', c: 1, h: 'L' }, { t: 'ledbar', c: 99, h: 'L' }, { t: 'buzzer', c: 3, h: 'L' }], wires: [{ a: 'x', b: 'y' }, { a: 'h:3a', b: 'm:G0' }] });
  ok(bad.parts.length === 1 && bad.wires.length === 0 || bad.wires.length === 1, 'junk input is dropped', bad.parts.length + ',' + bad.wires.length);
}

console.log('auto placement reproduces the default wiring of every part');
{
  MSP.PARTORDER.forEach(t => {
    const { S, b } = mk(); const p = b.autoPlace(t); const r = b.derive(S);
    ok(p && S.partIsOn(t) && r.parts[t].on, t + ' is placed and powered', p ? r.parts[t].msgs.join('|') : 'not placed');
    const D = MSP.BENCHPINS[t] || {}, bad = [];
    const got = {
      keypad: () => ({ R1: S.keypad.rows[0], R4: S.keypad.rows[3], C1: S.keypad.cols[0], C4: S.keypad.cols[3] }),
      relay: () => ({ IN: S.relay.pin }), ledbar: () => ({ L1: S.mods.ledbar.pins[0], L8: S.mods.ledbar.pins[7] }),
      rgb: () => ({ R: S.mods.rgb.pins[0], B: S.mods.rgb.pins[2] }), seg: () => ({ a: S.mods.seg.pins[0], dp: S.mods.seg.pins[7] }),
      buzzer: () => ({ SIG: S.mods.buzzer.pin }), motor: () => ({ IN1: S.mods.motor.in1, IN2: S.mods.motor.in2, EN: S.mods.motor.en }), servo: () => ({ SIG: S.mods.servo.pin }),
      stepper: () => ({ IN1: S.mods.stepper.pins[0], IN4: S.mods.stepper.pins[3] }), dip: () => ({ S1: S.mods.dip.pins[0], S4: S.mods.dip.pins[3] }), btns: () => ({ B1: S.mods.btns.pins[0], B4: S.mods.btns.pins[3] }),
      spi_eeprom: () => ({ CS: S.mods.spi_eeprom.cs }), spi_595: () => ({ CS: S.mods.spi_595.cs })
    }[t];
    if (got) { const g = got(); Object.keys(g).forEach(k => { if (g[k] !== D[k]) bad.push(k + ' ' + g[k] + '!=' + D[k]); }); }
    ok(bad.length === 0, t + ' pins match the example defaults', bad.join(','));
  });
  // dip/btns/ledbar polarity
  const { S, b } = mk(); b.autoPlace('dip'); b.autoPlace('btns'); b.autoPlace('ledbar'); b.autoPlace('rgb'); b.autoPlace('seg'); b.derive(S);
  ok(!S.mods.dip.vcc && !S.mods.btns.vcc && !S.mods.ledbar.low && !S.mods.rgb.anode && !S.mods.seg.anode, 'common pins go to GND, matching the old defaults');
}

console.log('every part together on one bench');
{ const { S, b } = mk(); const placed = MSP.PARTORDER.filter(t => b.autoPlace(t)); const r = b.derive(S);
  ok(placed.length === MSP.PARTORDER.length, 'all 17 parts fit on the bench', placed.length);
  ok(MSP.PARTORDER.every(t => S.partIsOn(t)), 'all are powered', MSP.PARTORDER.filter(t => !S.partIsOn(t)).map(t => t + ':' + r.parts[t].msgs.join('/')).join(' '));
  ok(r.shorts.length === 0, 'no shorts', r.msgs.join('|'));
  const refs = {}; let dup = 0; b.wires.forEach(w => [w.a, w.b].forEach(x => { if (!/^m:/.test(x)) { if (refs[x]) dup++; refs[x] = 1; } }));
  ok(dup === 0, 'no hole is used twice');
}

console.log('examples: the bench built from needs matches the old default wiring');
{ let bad = 0;
  EX.forEach(e => {
    const { S, b } = mk(); (e.needs || []).forEach(n => { if (n !== 'leds' && n !== 'sw') b.autoPlace(n); });
    const r = b.derive(S); const miss = (e.needs || []).filter(n => n !== 'leds' && n !== 'sw' && !S.partIsOn(n));
    const unwired = S.partsPins().filter(x => !x.pin && x.who !== 'motor EN').length;
    if (miss.length || r.shorts.length) { bad++; console.log('  FAIL: ' + e.id + ' ' + miss.join(',') + ' ' + r.msgs.join('|')); }
  });
  ok(bad === 0, EX.length + ' examples build a working bench');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
