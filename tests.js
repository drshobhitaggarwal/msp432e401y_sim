const {runProg, MSP} = require('./test.js');
require('./parts.js');
const EX = require('./examples.js');
const get = id => EX.find(e => e.id === id).code;
const run = t => S => S.run(t, 5000);
const press = (L,b,v) => S => S.setInput(L,b,v);
const T = {};
T.blink = { steps:[run(1.0)], check:S => JSON.stringify({n1:(S.tr.N1||[]).length, n0:(S.tr.N0||[]).length, first:(S.tr.N1||[])[0]}) };
T.buttons = { steps:[run(0.01), press('J',0,0), run(0.01), press('J',0,null), press('J',1,0), run(0.01)], check:S => JSON.stringify({N1:S.tr.N1, N0:S.tr.N0}) };
T.button_irq = { steps:[run(0.05), press('J',0,0), run(0.01), press('J',0,null), run(0.01), press('J',0,0), run(0.01), press('J',0,null), run(0.05)], check:S => 'irqCount='+S.irqCount };
T.timer_irq = { steps:[run(2.2)], check:S => 'irqCount='+S.irqCount+' N0edges='+(S.tr.N0||[]).length };
T.uart_leds = { steps:[run(0.05), S=>S.uartRx('1'), run(0.05), S=>S.uartRx('3x'), run(0.1)], check:S => 'N1='+JSON.stringify(S.tr.N1)+' F4='+JSON.stringify(S.tr.F4) };
T.adc = { steps:[run(0.6), S=>{S.analogCfg[0].v=2.5;}, run(0.6)], check:S => 'N1='+JSON.stringify(S.tr.N1) };
T.pwm_fade = { steps:[run(1.0)], check:S => { const b=[]; for(let i=0;i<6;i++){ S.run(0.1,2000); b.push(S.brightness('F',0).toFixed(2)); } return b.join(' ')+' pwm='+JSON.stringify(S.pwm.pulse[0]); } };

const hold = (r,c,v) => S => S.keySet(r,c,v);
T.keypad = { steps:[S=>{S.defaultParts();}, run(0.1), hold(1,2,1), run(0.1), hold(1,2,0), run(0.05), hold(3,3,1), hold(0,0,1), run(0.1), hold(3,3,0), hold(0,0,0), run(0.05)], check:S=>'' };
T.relay = { steps:[S=>{S.defaultParts();}, run(0.05), press('J',0,0), run(0.05), press('J',0,null), run(0.6), press('J',0,0), run(0.05), press('J',0,null), run(0.1)], check:S=>JSON.stringify({relay:S.relay, tr:{COIL:S.tr.COIL,RELAY:S.tr.RELAY}}) };
const key = (r,c) => [S=>S.keySet(r,c,1), run(0.15), S=>S.keySet(r,c,0), run(0.15)];
const seq = [[0,0],[0,1],[0,2],[1,0],[3,2]];   // 1 2 3 4 #
T.door_lock = { steps:[S=>{S.defaultParts();}, run(0.1), ...seq.flatMap(([r,c]) => key(r,c)), run(0.2), ...key(0,0), ...key(3,2), run(1.5)], check:S=>JSON.stringify({relay:S.relay, N1:S.tr.N1, N0:S.tr.N0}) };
const only = process.argv[2];
EX.forEach(e => {
  if (only && e.id !== only) return;
  const t = T[e.id]; if (!t) return; const S = runProg(e.id, e.code, { steps: t.steps.map(f => ({act: f})), dump: process.argv[3]==='dump' });
  if (S && t.check) { try { console.log('   check:', t.check(S)); } catch (err) { console.log('   check failed:', err.stack); } }
});
