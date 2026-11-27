const T = require('./test.js'); const { MSP, CC } = T;
const KNOWN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KNOWN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KNOWN[n] = 2);
let fails = 0;
function ok(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(extra))); if (!cond) fails++; }
function mk(src, bps) {
  const c = CC.compile(src, KNOWN, { debug: true });
  if (c.error) throw new Error('compile: ' + c.error.line + ' ' + c.error.msg);
  const S = new MSP.Sim({ onTx() {}, onLog() {} }); S.load(c); (bps || []).forEach(l => S.dbg.bps[l] = true);
  return { S, c };
}
const top = S => S.dbg.frames[S.dbg.frames.length - 1];
const names = S => S.dbg.frames.map(f => f.name).join('>');
const go = (S, t) => S.run(t || 0.01, 2000);

const SRC = `int g = 5;
int add(int a, int b)
{
  int s = a + b;
  return s;
}
int main(void)
{
  int i;
  for (i = 0; i < 3; i++)
  {
    g = add(g, i);
  }
  g = g + 100;
  while (1) {}
}`;
let { S } = mk(SRC, [12]);
go(S);
ok('breakpoint stops at line 12 in main', S.paused && S.dbg.line === 12 && names(S) === 'main', [S.paused, S.dbg.line, names(S)]);
ok('local i readable', S.dbgEval(top(S), 'i').v === 0 && S.dbgEval(top(S), 'g').v === 5, S.dbgEval(top(S), 'i'));
S.dbgResume('into'); go(S);
ok('step into enters add (line 4)', S.paused && S.dbg.line === 4 && names(S) === 'main>add', [S.dbg.line, names(S)]);
ok('params visible in callee', S.dbgEval(top(S), 'a').v === 5 && S.dbgEval(top(S), 'b').v === 0);
ok('uninitialised local is reported not thrown', typeof S.dbgEval(top(S), 's').err === 'string' || S.dbgEval(top(S), 's').v === undefined, S.dbgEval(top(S), 's'));
S.dbgResume('over'); go(S);
ok('step over -> line 5', S.paused && S.dbg.line === 5 && S.dbgEval(top(S), 's').v === 5, [S.dbg.line]);
S.dbgResume('out'); go(S);
ok('step out returns to main, g updated', S.paused && names(S) === 'main' && S.dbgEval(top(S), 'g').v === 5, [names(S), S.dbg.line, S.dbgEval(top(S), 'g')]);
S.dbgResume('over'); go(S);
ok('step over main statement', S.paused && names(S) === 'main', names(S));
// run to the end of the loop through the breakpoint three times
S.dbgResume('run'); go(S);
ok('breakpoint hits once per loop iteration (3rd)', S.paused && S.dbg.line === 12 && S.dbgEval(top(S), 'i').v === 2, [S.dbg.line, S.dbgEval(top(S), 'i')]);
S.dbg.bps = {}; S.dbgResume('run'); go(S, 0.01);
ok('runs to completion of the loop', !S.paused && S.dbgEval(top(S), 'g').v === 5 + 0 + 1 + 2 + 100, S.dbgEval(top(S), 'g'));

// pause request inside an empty loop
({ S } = mk(`int main(void) { int n = 0; while (1) { } }`));
go(S, 0.002); ok('no stop without breakpoint', !S.paused);
S.dbg.mode = 'pause'; go(S, 0.002);
ok('pause stops inside empty while loop', S.paused && S.dbg.line === 1 && S.dbg.reason === 'paused', [S.paused, S.dbg.line, S.dbg.reason]);

// interrupt-aware breakpoint
const ISR = `volatile int ticks = 0;
volatile int spin = 0;
void SysTick_Handler(void)
{
  ticks++;
  GPIO_PORTN_AHB->DATA ^= 1;
}
int main(void)
{
  SYSCTL->RCGCGPIO |= 0x1000;
  GPIO_PORTN_AHB->DIR = 1; GPIO_PORTN_AHB->DEN = 1;
  SysTick->LOAD = 16000 - 1; SysTick->VAL = 0; SysTick->CTRL = 7;
  __enable_irq();
  while (1) { spin++; }
}`;
({ S } = mk(ISR, [5]));
go(S, 0.01);
ok('breakpoint inside ISR pauses with ISR on top of main', S.paused && S.dbg.line === 5 && names(S) === 'main>SysTick_Handler' && S.isr, [S.paused, S.dbg.line, names(S)]);
const spin0 = S.dbgEval(S.dbg.frames[0], 'spin').v;
ok('main frame still inspectable (spin) while in ISR', typeof spin0 === 'number');
S.dbgResume('over'); go(S, 0.01);
ok('step over inside ISR', S.paused && S.dbg.line === 6 && names(S) === 'main>SysTick_Handler', [S.dbg.line, names(S)]);
S.dbgResume('over'); go(S, 0.01);
ok('stepping off the end of the ISR lands in main', S.paused && names(S) === 'main' && !S.isr, [names(S), S.dbg.line]);
S.dbg.bps = {}; S.dbgResume('run'); const t0 = S.now; go(S, 0.01);
ok('virtual time frozen while paused, resumes after', S.now > t0 && S.irqCount >= 5, [t0, S.now, S.irqCount]);

// watch on a register, no side effects
({ S } = mk(`int main(void) { SYSCTL->RCGCGPIO |= 0x1000; GPIO_PORTN_AHB->DIR = 3; GPIO_PORTN_AHB->DEN = 3; GPIO_PORTN_AHB->DATA = 2; int x = 1;
  x = 2; while (1) {} }`));
S.dbg.bps[2] = true; go(S, 0.001);
const f = top(S);
ok('watch: register via -> and _R names', S.dbgEval(f, 'GPIO_PORTN_AHB->DIR').v === 3 && S.dbgEval(f, 'GPIO_PORTN_DATA_R').v === 2, [S.dbgEval(f, 'GPIO_PORTN_AHB->DIR'), S.dbgEval(f, 'GPIO_PORTN_DATA_R')]);
const u = S.dbgEval(f, 'x = 42'); ok('watch can assign', S.dbgEval(f, 'x').v === 42);
ok('bad expression reports an error', !!S.dbgEval(f, 'nosuchvar + 1').err);
console.log(fails ? fails + ' FAILED' : 'ALL DEBUGGER TESTS PASSED');
