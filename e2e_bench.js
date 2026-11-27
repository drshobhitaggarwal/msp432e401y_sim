const { chromium } = require('playwright'); const fs = require('fs');
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== undefined ? '  ' + i : '')); if (!c) fails++; };
(async () => {
  let html = fs.readFileSync(__dirname + '/app.html', 'utf8');
  html = html.replace(/<script src="https:\/\/cdn.jsdelivr[^>]*><\/script>/, () => '<script>' + fs.readFileSync(__dirname + '/node_modules/acorn/dist/acorn.js', 'utf8') + '</script>').replace(/<link rel="stylesheet"[^>]*>/, '');
  fs.writeFileSync(__dirname + '/shot.html', html);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('file://' + __dirname + '/shot.html'); await p.waitForTimeout(700);
  const scr = ref => p.evaluate(r => BenchUI.screen(r), ref);
  const st = async () => { await p.waitForTimeout(120); return p.evaluate(() => { const S = BenchUI.sim(), b = BenchUI.bench(); return { led: S.mods.ledbar.on, pins: S.mods.ledbar.pins.join(','), low: S.mods.ledbar.low, parts: b.parts.map(x => x.type), wires: b.wires.length, msgs: BenchUI.report().msgs, status: document.getElementById('status').textContent }; }); };
  const drag = async (a, z, steps = 12) => { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps }); await p.mouse.move(z.x, z.y, { steps }); await p.mouse.up(); };
  ok('starts empty, no errors', (await st()).parts.length === 0 && errs.length === 0, errs.join('|'));

  // drag a part from the palette onto the lower half of the board
  const item = await p.locator('.pal-item[data-type=ledbar]').boundingBox();
  const target = await scr('h:10c');
  await drag({ x: item.x + 30, y: item.y + 15 }, target);
  let s = await st();
  ok('palette drag places the LED bar', s.parts.join() === 'ledbar', JSON.stringify(s.parts));
  const col = await p.evaluate(() => BenchUI.bench().parts[0].col + ',' + BenchUI.bench().parts[0].half);
  ok('snapped near the drop column on the lower half', /^(9|10|11),L$/.test(col), col);
  ok('part off until wired, message tells what is missing', !s.led && s.msgs.some(m => /COM is not connected/.test(m)), s.msgs.join('|'));

  // wire COM to GND and L1 to PD0 by dragging
  const c0 = await p.evaluate(() => BenchUI.bench().parts[0].col);
  await drag(await scr('h:' + c0 + 'e'), await scr('m:GND.1'));
  s = await st(); ok('a dragged jumper powers the common pin', s.led === true && s.wires === 1, JSON.stringify(s));
  await drag(await scr('h:' + (c0 + 1) + 'e'), await scr('m:D0'));
  s = await st(); ok('L1 wired to PD0', s.pins.split(',')[0] === 'D0', s.pins);
  // a wire to a wrong column does nothing
  await drag(await scr('h:' + (c0 + 20) + 'e'), await scr('m:D5'));
  s = await st(); ok('wrong column wire changes nothing', s.pins.indexOf('D5') < 0 && s.wires === 3, s.pins + ' wires=' + s.wires);
  // click-click wire
  const a2 = await scr('h:' + (c0 + 2) + 'd'), z2 = await scr('m:D1');
  await p.mouse.click(a2.x, a2.y); await p.mouse.click(z2.x, z2.y);
  s = await st(); ok('click, click makes a wire', s.pins.split(',')[1] === 'D1', s.pins);

  // run a program that blinks the bar
  await p.evaluate(() => { const e = document.getElementById('exSel'); e.value = 'ledbar'; e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(300);
  s = await st(); ok('example keeps the student\'s part and wires', s.parts.join() === 'ledbar', JSON.stringify(s.parts));

  // double-click the part opens its details
  const pb = await scr('h:' + (c0 + 3) + 'a'); await p.mouse.dblclick(pb.x, pb.y + 110);
  await p.waitForTimeout(300);
  ok('double-click on a part opens its inspector', await p.evaluate(() => !document.getElementById('win-insp-ledbar').hidden));
  await p.screenshot({ path: __dirname + '/shot_e1.png' });
  await p.evaluate(() => Win.close('insp-ledbar'));
  // double-click the LaunchPad
  const mc = await p.evaluate(() => { const r = document.querySelector('#bench .pcb').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + 30 }; });
  await p.mouse.dblclick(mc.x, mc.y); await p.waitForTimeout(300);
  ok('double-click on the LaunchPad opens the editor', await p.evaluate(() => !document.getElementById('win-program').hidden));
  ok('editor has the program', await p.evaluate(() => document.getElementById('code').value.includes('main')));
  await p.screenshot({ path: __dirname + '/shot_e2.png' });
  await p.evaluate(() => Win.close('program'));

  // short circuit
  await drag(await scr('r:T+:30'), await scr('m:3V3.0')); await drag(await scr('r:T-:30'), await scr('m:GND.0'));
  s = await st(); ok('no short yet', !s.msgs.some(m => /Short/.test(m)));
  await drag(await scr('r:T+:32'), await scr('r:T-:32'));
  s = await st(); ok('joining 3V3 and GND is a short circuit that stops the program', s.msgs.some(m => /Short circuit/.test(m)) && /power fault/.test(s.status), s.status);
  await p.screenshot({ path: __dirname + '/shot_e3.png' });
  // select the bad wire and delete it
  const mid = await p.evaluate(() => { const w = BenchUI.bench().wires[BenchUI.bench().wires.length - 1]; return w.id; });
  const wp = await p.evaluate(id => { const el = document.querySelector('.bwire[data-wid="' + id + '"] .w-col'); const l = el.getTotalLength(); const pt = el.getPointAtLength(l / 2); const r = document.getElementById('bench').getBoundingClientRect(); const m = el.getScreenCTM(); return { x: m.a * pt.x + m.e, y: m.d * pt.y + m.f }; }, mid);
  await p.mouse.click(wp.x, wp.y); await p.keyboard.press('Delete');
  s = await st(); ok('selecting a wire and pressing Delete removes it, short gone', !s.msgs.some(m => /Short/.test(m)) && !/power fault/.test(s.status), s.status);

  // remove the GND wire: part goes off
  await p.evaluate(() => { const b = BenchUI.bench(); const w = b.wires.find(w => w.b === 'm:GND.1'); document.querySelector('.bwire[data-wid="' + w.id + '"] .w-end').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  await p.keyboard.press('Delete');
  s = await st(); ok('unplugging the common wire turns the bar off', s.led === false, JSON.stringify(s));

  // persistence
  await p.waitForTimeout(500);
  await p.reload(); await p.waitForTimeout(700);
  s = await st(); ok('bench survives a reload', s.parts.join() === 'ledbar' && s.wires >= 4, JSON.stringify(s));
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
