const fs = require('fs');
const dir = __dirname;
const MSP = require(dir + '/core.js');
require(dir + '/regs.js');
require(dir + '/buses.js');
require(dir + '/api.js');
require(dir + '/parts.js');
require(dir + '/parts2.js');
const CC = require(dir + '/compiler.js');

const KNOWN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KNOWN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KNOWN[n] = 2);
function runProg(name, src, opts) {
  opts = opts || {};
  const out = []; const logs = [];
  const S = new MSP.Sim({ onTx: c => out.push(c), onLog: (k, m) => logs.push(k + ': ' + m) });
  const c = CC.compile(src, KNOWN);
  if (c.error) { console.log('[' + name + '] COMPILE ERROR line ' + c.error.line + ': ' + c.error.msg); return null; }
  if (opts.dump) console.log(c.js);
  try { S.load(c); } catch (e) { console.log('[' + name + '] LOAD ERROR', e.message); if (opts.dump) console.log(c.js); return null; }
  S.defaultParts();
  if (opts.setup) opts.setup(S);
  const steps = opts.steps || [[1.0]];
  steps.forEach(st => { if (st.act) st.act(S); else S.run(st[0], 2000); });
  console.log('[' + name + '] t=' + S.now.toFixed(4) + 's halted=' + S.halted + ' uart=' + JSON.stringify(out.join('')).slice(0, 200));
  logs.forEach(l => console.log('   ' + l));
  return S;
}
module.exports = { runProg, MSP, CC };

if (require.main === module) {
  const ex = require(dir + '/examples.js');
  const only = process.argv[2];
  ex.forEach(e => {
    if (only && e.id !== only) return;
    const S = runProg(e.id, e.code, { steps: e.test ? e.test.steps : [[1.0]], setup: e.test && e.test.setup, dump: !!only && process.argv[3] === 'dump' });
    if (S && e.test && e.test.check) { try { console.log('   check:', e.test.check(S)); } catch (err) { console.log('   check failed:', err.message); } }
  });
}
