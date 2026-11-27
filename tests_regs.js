const { runProg, MSP } = require('./test.js');
let fails = 0;
function ok(name, cond, extra) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + (extra || ''))); if (!cond) fails++; }
function run(name, src, steps) {
  const logs = [];
  const S = runProg(name, src, { steps: steps || [[0.01]] });
  return S;
}
const edges = (S, k) => (S.tr[k] || []);
const period = (S, k) => { const e = edges(S, k).filter(x => x[1] === 1).map(x => x[0]); return e.length > 2 ? e[2] - e[1] : -1; };

// 1. SysTick register blink with CMSIS-style handler
let S = run('systick_regs', `
#include <stdint.h>
volatile uint32_t ticks = 0;
void SysTick_Handler(void) { ticks++; GPIO_PORTN_AHB->DATA ^= 0x02; }
int main(void) {
  SYSCTL->RCGCGPIO |= 0x1000;
  GPIO_PORTN_AHB->DIR = 0x03; GPIO_PORTN_AHB->DEN = 0x03;
  SysTick->LOAD = 16000 - 1;      /* 1 ms at 16 MHz */
  SysTick->VAL = 0;
  SysTick->CTRL = 7;
  __enable_irq();
  while (1) {}
}`, [[0.05]]);
ok('SysTick handler toggles N1 every ms', S && Math.abs(period(S, 'N1') - 0.002) < 1e-5, S && period(S, 'N1'));

// 2. TIMER0A register interrupt at 10 Hz
S = run('timer_regs', `
#include <stdint.h>
volatile int n = 0;
void TIMER0A_IRQHandler(void) { TIMER0->ICR = 1; n++; GPIO_PORTN_AHB->DATA ^= 0x01; }
int main(void) {
  SYSCTL->RCGCGPIO |= (1 << 12);
  SYSCTL->RCGCTIMER |= 1;
  GPIO_PORTN_AHB->DIR |= 1; GPIO_PORTN_AHB->DEN |= 1;
  TIMER0->CTL &= ~1;
  TIMER0->CFG = 0;
  TIMER0->TAMR = 2;
  TIMER0->TAILR = 1600000 - 1;
  TIMER0->IMR |= 1;
  NVIC_EnableIRQ(TIMER0A_IRQn);
  TIMER0->CTL |= 1;
  __enable_irq();
  while (1) {}
}`, [[1.05]]);
ok('Timer0A register mode fires at 10 Hz', S && S.irqCount === 10, S && S.irqCount);

// 3. Timer prescaler (16-bit split mode): 16 MHz / (255+1) -> load 62500 => 1 s ... load 62499 pre 255 = 1.0 s
S = run('timer_pre', `
volatile int n = 0;
void TIMER1A_Handler(void) { TIMER1_ICR_R = 1; n++; }
int main(void) {
  SYSCTL_RCGCTIMER_R |= 2;
  TIMER1_CTL_R = 0; TIMER1_CFG_R = 4; TIMER1_TAMR_R = 2;
  TIMER1_TAPR_R = 255; TIMER1_TAILR_R = 62499;
  TIMER1_IMR_R = 1;
  NVIC_EN0_R = 1 << 21;
  TIMER1_CTL_R = 1;
  __enable_irq();
  while (1) {}
}`, [[3.1]]);
ok('Timer1A prescaler 255 + load 62499 = 1 s', S && S.irqCount === 3, S && S.irqCount);

// 4. UART0 register transmit
S = run('uart_regs', `
#include <stdint.h>
void put(char c) { while (UART0->FR & 0x20) {} UART0->DR = c; }
int main(void) {
  SYSCTL->RCGCGPIO |= 1; SYSCTL->RCGCUART |= 1;
  GPIO_PORTA_AHB->AFSEL |= 3; GPIO_PORTA_AHB->PCTL = (GPIO_PORTA_AHB->PCTL & 0xFFFFFF00) | 0x11; GPIO_PORTA_AHB->DEN |= 3;
  UART0->CTL = 0;
  UART0->IBRD = 8; UART0->FBRD = 44;       /* 16 MHz / (16 * 8.6875) = 115107 */
  UART0->LCRH = 0x60;
  UART0->CC = 0;
  UART0->CTL = 0x301;
  const char *s = "hello";
  for (int i = 0; i < 5; i++) put(s[i]);
  while (1) {}
}`, [[0.01]]);
{ const out = []; const S2 = new MSP.Sim({ onTx: c => out.push(c) }); }
ok('UART0 baud from IBRD/FBRD', S && Math.abs(S.u.baud - 115107) < 100, S && S.u.baud);

// 5. GPIO interrupt via registers (SW1 = PJ0)
S = run('gpio_irq_regs', `
volatile int presses = 0;
void GPIOJ_IRQHandler(void) { GPIO_PORTJ_AHB_ICR_R = 1; presses++; }
int main(void) {
  SYSCTL_RCGCGPIO_R |= SYSCTL_RCGCGPIO_R8 | SYSCTL_RCGCGPIO_R12;
  GPIO_PORTJ_AHB_DIR_R &= ~1; GPIO_PORTJ_AHB_DEN_R |= 1; GPIO_PORTJ_AHB_PUR_R |= 1;
  GPIO_PORTJ_AHB_IS_R &= ~1; GPIO_PORTJ_AHB_IBE_R &= ~1; GPIO_PORTJ_AHB_IEV_R &= ~1;
  GPIO_PORTJ_AHB_IM_R |= 1;
  NVIC_EN1_R |= 1 << (51 - 32);
  __enable_irq();
  while (1) {}
}`, [[0.01], ...[0, 1, 0, 1].map(v => [S0 => 0.001]) ].slice(0, 1));
{
  const src = `volatile int presses = 0;
void GPIOJ_IRQHandler(void) { GPIO_PORTJ_AHB_ICR_R = 1; presses++; }
int main(void) {
  SYSCTL_RCGCGPIO_R |= SYSCTL_RCGCGPIO_R8;
  GPIO_PORTJ_AHB_DIR_R &= ~1; GPIO_PORTJ_AHB_DEN_R |= 1; GPIO_PORTJ_AHB_PUR_R |= 1;
  GPIO_PORTJ_AHB_IS_R &= ~1; GPIO_PORTJ_AHB_IBE_R &= ~1; GPIO_PORTJ_AHB_IEV_R &= ~1;
  GPIO_PORTJ_AHB_IM_R |= 1;
  NVIC_EN1_R |= 1 << (51 - 32);
  __enable_irq();
  while (1) {}
}`;
  const press = v => S => S.setInput('J', 0, v);
  const S3 = runProg('gpioj', src, { steps: [{ act: S => S.run(0.01, 2000) }, { act: press(0) }, { act: S => S.run(0.01, 2000) }, { act: press(null) }, { act: S => S.run(0.01, 2000) }, { act: press(0) }, { act: S => S.run(0.01, 2000) }] });
  ok('GPIOJ falling-edge interrupt via IS/IBE/IEV/IM/ICR and NVIC_EN1', S3 && S3.irqCount === 2, S3 && S3.irqCount);
}

// 6. PWM via registers: 1 kHz 25 % on PF2 (M0PWM2)  -> generator 1 output A
S = run('pwm_regs', `
int main(void) {
  SYSCTL_RCGCGPIO_R |= 1 << 5; SYSCTL_RCGCPWM_R |= 1;
  GPIO_PORTF_AHB_AFSEL_R |= 4; GPIO_PORTF_AHB_PCTL_R = (GPIO_PORTF_AHB_PCTL_R & ~0xF00) | 0x600; GPIO_PORTF_AHB_DEN_R |= 4;
  PWM0_CC_R = 0;
  PWM0_1_CTL_R = 0;
  PWM0_1_GENA_R = 0x8C;
  PWM0_1_LOAD_R = 16000 - 1;
  PWM0_1_CMPA_R = 12000 - 1;
  PWM0_1_CTL_R = 1;
  PWM0_ENABLE_R = 4;
  while (1) {}
}`, [[0.01]]);
{ const g = S && S.pwm.gens[1]; const duty = S ? S.pwm.pulse[2] / g.period : -1; ok('PWM register duty 25 %', Math.abs(duty - 0.25) < 0.01, duty);
  ok('PWM register period 16000 ticks', g && g.period === 16000, g && g.period);
  ok('PF2 level equals duty', S && Math.abs(S.pinLevel('F', 2) - 0.25) < 0.01, S && S.pinLevel('F', 2)); }

// 7. ADC via registers
S = run('adc_regs', `
volatile unsigned int result;
int main(void) {
  SYSCTL_RCGCADC_R |= 1; SYSCTL_RCGCGPIO_R |= 0x10;
  GPIO_PORTE_AHB_AFSEL_R |= 8; GPIO_PORTE_AHB_DEN_R &= ~8; GPIO_PORTE_AHB_AMSEL_R |= 8;   /* PE3 = AIN0 */
  ADC0_ACTSS_R &= ~8; ADC0_EMUX_R &= ~0xF000;
  ADC0_SSMUX3_R = 0; ADC0_SSCTL3_R = 0x6;     /* END0, IE0 */
  ADC0_IM_R &= ~8; ADC0_ACTSS_R |= 8;
  ADC0_PSSI_R = 8;
  while ((ADC0_RIS_R & 8) == 0) {}
  result = ADC0_SSFIFO3_R;
  ADC0_ISC_R = 8;
  while (1) {}
}`, [[0.01]]);
{ const v = S && S.adc[0].seq[3].ris; ok('ADC conversion completed and ISC cleared RIS', S && v === 0 && S.halted === false, v); }

// 8. PLL to 120 MHz
S = run('pll_regs', `
int main(void) {
  SYSCTL->MOSCCTL = 0x10;          /* MOSC on, no bypass */
  while ((SYSCTL->RIS & 0x100) == 0) {}
  SYSCTL->RSCLKCFG = (3 << 20) | (3 << 24);          /* OSCSRC = PLLSRC = MOSC */
  SYSCTL->PLLFREQ1 = 4;                              /* N = 4, Q = 0 */
  SYSCTL->PLLFREQ0 = (1 << 23) | 96;                 /* PLLPWR, MINT = 96 -> 480 MHz */
  while ((SYSCTL->PLLSTAT & 1) == 0) {}
  SYSCTL->RSCLKCFG = (3 << 20) | (3 << 24) | (1 << 28) | (1 << 30) | 3;   /* USEPLL, PSYSDIV = 3 */
  while (1) {}
}`, [[0.001]]);
ok('PLL 25 MHz -> 480 MHz -> 120 MHz', S && Math.abs(S.clk - 120e6) < 1, S && S.clk);

// 9. clock-off bus fault
S = run('fault_clock', `
int main(void) { GPIO_PORTN_AHB->DIR = 3; while (1) {} }`, [[0.001]]);
ok('GPIO access with clock off faults', S && S.halted, S && S.halted);

// 10. raw pointer style (TM4C tutorial style)
S = run('raw_ptr', `
#define SYSCTL_RCGCGPIO (*((volatile uint32_t *)0x400FE608))
#define GPION_DIR  (*((volatile uint32_t *)0x40064400))
#define GPION_DEN  (*((volatile uint32_t *)0x4006451C))
#define GPION_DATA (*((volatile uint32_t *)0x400643FC))
int main(void) {
  volatile uint32_t *reg = (uint32_t *)0x40064000;
  SYSCTL_RCGCGPIO |= 0x1000;
  GPION_DIR |= 3; GPION_DEN |= 3;
  GPION_DATA = 2;
  reg[0x3FC >> 2] = 3;
  while (1) {}
}`, [[0.001]]);
ok('raw address macros and pointer casts', S && S.gpio.N.out === 3, S && S.gpio.N.out);

// 11. SysTick COUNTFLAG polling at register level + PIOSC/4 clock source
S = run('systick_poll', `
volatile int n = 0;
int main(void) {
  SYSCTL->RCGCGPIO |= 0x1000; GPIO_PORTN_AHB->DIR |= 1; GPIO_PORTN_AHB->DEN |= 1;
  SysTick->LOAD = 4000 - 1;       /* PIOSC/4 = 4 MHz -> 1 ms */
  SysTick->CTRL = 1;             /* enable, CLKSRC = 0 */
  while (1) { while ((SysTick->CTRL & 0x10000) == 0) {} GPIO_PORTN_AHB->DATA ^= 1; n++; }
}`, [[0.0105]]);
ok('SysTick COUNTFLAG polling with PIOSC/4', S && edges(S, 'N0').length >= 9 && edges(S, 'N0').length <= 11, S && edges(S, 'N0').length);

console.log(fails ? fails + ' FAILED' : 'ALL REGISTER TESTS PASSED');

// register-level examples run clean
const EX = require('./examples.js'); const getEx = id => EX.find(e => e.id === id).code;
let e1 = runProg('reg_blink', getEx('reg_blink'), { steps: [[2.1]] });
ok('reg_blink: 120 MHz and ~2 blinks/s toggles', e1 && Math.abs(e1.clk - 120e6) < 1 && (e1.tr.N1 || []).length >= 4, e1 && [e1.clk, (e1.tr.N1 || []).length]);
let e2 = runProg('reg_timer_irq', getEx('reg_timer_irq'), { steps: [[1.05]] });
ok('reg_timer_irq: 4 Hz', e2 && e2.irqCount === 4, e2 && e2.irqCount);
let e3 = runProg('reg_uart_echo', getEx('reg_uart_echo'), { steps: [{ act: S => S.run(0.05, 2000) }, { act: S => S.uartRx('abc1') }, { act: S => S.run(0.05, 2000) }] });
ok('reg_uart_echo runs', e3 && !e3.halted);
let e4 = runProg('reg_button_irq', getEx('reg_button_irq'), { steps: [{ act: S => S.run(0.01, 2000) }, { act: S => S.setInput('J', 0, 0) }, { act: S => S.run(0.01, 2000) }, { act: S => S.setInput('J', 0, null) }, { act: S => S.run(0.01, 2000) }, { act: S => S.setInput('J', 0, 0) }, { act: S => S.run(0.01, 2000) }] });
ok('reg_button_irq: 2 presses', e4 && e4.irqCount === 2 && (e4.tr.N1 || []).length === 2, e4 && [e4.irqCount, (e4.tr.N1 || []).length]);
console.log(fails ? fails + ' FAILED' : 'ALL REGISTER TESTS PASSED (with examples)');
