const { chromium } = require('playwright'); const fs = require('fs');
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (i !== undefined ? '  ' + i : '')); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const url = 'file://' + __dirname + '/shot.html';
  await p.goto(url); await p.waitForTimeout(700);
  const scr = ref => p.evaluate(r => BenchUI.screen(r), ref);
  const drag = async (a, z, steps = 12) => { await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps }); await p.mouse.move(z.x, z.y, { steps }); await p.mouse.up(); };
  const wait = () => p.waitForTimeout(150);
  // click-arm placement
  await p.click('.pal-item[data-type=btns]'); await wait();
  ok('click arms the part', await p.evaluate(() => document.querySelector('.pal-item[data-type=btns]').classList.contains('armed')));
  let t = await scr('h:20c'); await p.mouse.click(t.x, t.y); await wait();
  let info = await p.evaluate(() => BenchUI.bench().parts.map(x => x.type + ':' + x.col + x.half).join());
  ok('second click places it', /^btns:(19|20|21)[LU]$/.test(info), info);
  // part move
  const before = await p.evaluate(() => BenchUI.bench().parts[0].col);
  const pb = await p.evaluate(() => { const r = document.querySelector('.bpart .bpbody').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await drag(pb, { x: pb.x + 20 * 10 * (await p.evaluate(() => BenchUI.screen('h:11c').x - BenchUI.screen('h:10c').x)) / 20 * 0 + (await p.evaluate(() => BenchUI.screen('h:11c').x - BenchUI.screen('h:1c').x)) , y: pb.y }); await wait();
  const after = await p.evaluate(() => BenchUI.bench().parts[0].col);
  ok('dragging the part moves it', after !== before, before + ' -> ' + after);
  // wire from MCU pin to a hole, then move the hole end
  const pc = await p.evaluate(() => BenchUI.bench().parts[0].col);
  const a = await scr('m:F1'), h1 = await scr('h:' + (pc + 8) + 'e');
  await drag(a, h1); await wait();
  let w0 = await p.evaluate(() => BenchUI.bench().wires.map(w => w.a + '>' + w.b).join());
  ok('jumper from MCU pin to hole', /m:F1/.test(w0) && /h:/.test(w0), w0);
  const h2 = await scr('h:' + (pc + 9) + 'e');
  const wid = await p.evaluate(() => BenchUI.bench().wires[0].id);
  const hole = await p.evaluate(() => { const w = BenchUI.bench().wires[0]; return /^h:/.test(w.a) ? 'a' : 'b'; });
  const ep = await p.evaluate(o => { const el = document.querySelector('.w-end[data-wid="' + o.id + '"][data-end="' + o.e + '"]'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, { id: wid, e: hole });
  await drag(ep, h2); await wait();
  const w1 = await p.evaluate(() => BenchUI.bench().wires.map(w => w.a + '>' + w.b).join());
  ok('dragging a wire end moves it', w1 !== w0 && w1.includes('e'), w1);
  // keypad face click
  await p.evaluate(() => { BenchUI.bench().autoPlace('keypad'); BenchUI.refresh(); }); await wait();
  const key = await p.evaluate(() => { const k = document.querySelectorAll('.bkey')[5]; const r = k.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(key.x, key.y); await p.mouse.down();
  const down = await p.evaluate(() => JSON.stringify(BenchUI.sim().keypad.down));
  await p.mouse.up(); await wait();
  ok('keypad face responds to press', down && down.indexOf('1') >= 0, down);
  // dip + button faces
  await p.evaluate(() => { BenchUI.bench().autoPlace('dip'); BenchUI.refresh(); }); await wait();
  const dp = await p.evaluate(() => { const k = document.querySelector('.bdip'); const r = k.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(dp.x, dp.y); await wait();
  ok('DIP face toggles', await p.evaluate(() => BenchUI.sim().mods.dip.state.some(x => x)));
  // persistence reload
  await p.waitForTimeout(500);
  const cnt = await p.evaluate(() => BenchUI.bench().parts.length);
  await p.reload(); await p.waitForTimeout(700);
  ok('bench restored after reload', await p.evaluate(() => BenchUI.bench().parts.length) === cnt, cnt);
  console.log('   parts after reload:', await p.evaluate(() => BenchUI.bench().parts.map(x => x.type).join()));
  // clear bench
  await p.click('#benchClear'); await p.click('#benchClear'); await wait();
  ok('Clear bench empties parts and wires', await p.evaluate(() => BenchUI.bench().parts.length === 0 && BenchUI.bench().wires.length === 0));
  // migration
  await p.evaluate(() => { const S = BenchUI.sim(); S.partOn('ledbar', true); localStorage.removeItem('e401y.bench'); localStorage.setItem('e401y.wiring2', JSON.stringify(S.partsExport())); });
  await p.reload(); await p.waitForTimeout(800);
  const mig = await p.evaluate(() => BenchUI.bench().parts.map(x => x.type).join());
  ok('old wiring migrates onto the bench', /ledbar/.test(mig), mig);
  ok('no page errors', errs.length === 0, errs.join('|'));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(fails ? 1 : 0);
})();
