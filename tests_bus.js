const { runProg, MSP, CC } = require('./test.js');
let fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('  FAIL: ' + m); } else console.log('  ok: ' + m); }

const I2C_INIT = `
#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"
#include "driverlib/uart.h"
`;
const src1 = I2C_INIT + `
int main(void) {
  SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
  SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
  GPIOPinConfigure(GPIO_PB2_I2C0SCL);
  GPIOPinConfigure(GPIO_PB3_I2C0SDA);
  GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
  GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
  I2CMasterInitExpClk(I2C0_BASE, 16000000, false);
  /* write pointer 0, then read 2 bytes */
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x48, false);
  I2CMasterDataPut(I2C0_BASE, 0x00);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
  while (I2CMasterBusy(I2C0_BASE));
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x48, true);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_START);
  while (I2CMasterBusy(I2C0_BASE));
  uint32_t hi = I2CMasterDataGet(I2C0_BASE);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_FINISH);
  while (I2CMasterBusy(I2C0_BASE));
  uint32_t lo = I2CMasterDataGet(I2C0_BASE);
  int raw = ((hi << 8) | lo) >> 4;
  UARTprintf2(raw);
  while (1) {}
}`.replace('UARTprintf2(raw);', 'volatile int result = raw; (void)result; ');
const out = runProg('i2c-tmp', src1, { setup: S => { S.mods.i2c_tmp.on = true; S.mods.i2c_tmp.temp = 25; }, steps: [[0.05]] });
if (out) {
  ok(out.busLog.length >= 2, 'bus log has transactions: ' + JSON.stringify(out.busLog.map(x => x.text)));
  ok(/S 0x48 W ACK/.test(out.busLog[0].text), 'first txn address ack');
  ok(out.busLog.some(x => /S 0x48 R ACK\s+0x19/.test(x.text)), '25 C = 0x19 0x00 read back');
  ok(out.tr.B2 && out.tr.B2.length > 20, 'SCL trace recorded (' + (out.tr.B2 || []).length + ' edges)');
}

const I2C_SETUP = `
  SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
  SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
  GPIOPinConfigure(GPIO_PB2_I2C0SCL);
  GPIOPinConfigure(GPIO_PB3_I2C0SDA);
  GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
  GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
  I2CMasterInitExpClk(I2C0_BASE, 16000000, false);`;
const HELP = `
void wr(uint8_t a, uint8_t *d, int n) {
  int i;
  I2CMasterSlaveAddrSet(I2C0_BASE, a, false);
  I2CMasterDataPut(I2C0_BASE, d[0]);
  if (n == 1) { I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND); while (I2CMasterBusy(I2C0_BASE)); return; }
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_START); while (I2CMasterBusy(I2C0_BASE));
  for (i = 1; i < n - 1; i++) { I2CMasterDataPut(I2C0_BASE, d[i]); I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_CONT); while (I2CMasterBusy(I2C0_BASE)); }
  I2CMasterDataPut(I2C0_BASE, d[n - 1]); I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_FINISH); while (I2CMasterBusy(I2C0_BASE));
}`;
// ---- EEPROM write + ack polling + read back
const srcE = I2C_INIT + HELP + `
volatile uint32_t polls = 0, got = 0, err = 0;
int main(void) {
  uint8_t d[4]; d[0] = 0x10; d[1] = 0xAB; d[2] = 0xCD;
  ` + I2C_SETUP + `
  wr(0x50, d, 3);
  /* acknowledge polling: keep addressing until the part answers */
  for (;;) {
    I2CMasterSlaveAddrSet(I2C0_BASE, 0x50, false);
    I2CMasterDataPut(I2C0_BASE, 0x10);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND); while (I2CMasterBusy(I2C0_BASE));
    if (I2CMasterErr(I2C0_BASE) == I2C_MASTER_ERR_NONE) break;
    polls++;
  }
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x50, true);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_START); while (I2CMasterBusy(I2C0_BASE));
  got = I2CMasterDataGet(I2C0_BASE);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_FINISH); while (I2CMasterBusy(I2C0_BASE));
  got = (got << 8) | I2CMasterDataGet(I2C0_BASE);
  while (1) {}
}`;
let o = runProg('i2c-eeprom', srcE, { setup: S => { S.mods.i2c_eeprom.on = true; }, steps: [[0.1]] });
if (o) {
  ok(o.dev.eeprom.mem[0x10] === 0xAB && o.dev.eeprom.mem[0x11] === 0xCD, 'EEPROM stored two bytes');
  const pv = o.userFns; // polls/got are globals inside generated code; read through busLog
  ok(o.busLog.some(x => x.err && /NACK/.test(x.text)), 'address NACK during the 5 ms write cycle was logged');
  ok(o.busLog.filter(x => /S 0x50 R ACK\s+0xAB ACK\s+0xCD NACK/.test(x.text)).length === 1, 'read-back saw AB CD');
}
// ---- wrong address -> NACK warning
const srcW = I2C_INIT + `
int main(void) {` + I2C_SETUP + `
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x77, false);
  I2CMasterDataPut(I2C0_BASE, 1);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND); while (I2CMasterBusy(I2C0_BASE));
  while (1) {}
}`;
o = runProg('i2c-nack', srcW, { setup: S => { S.mods.i2c_tmp.on = true; }, steps: [[0.02]] });
if (o) ok(o.busLog.length === 1 && o.busLog[0].err && /NACK/.test(o.busLog[0].text), 'unknown address logged as NACK');
// ---- missing pin setup
const srcP = I2C_INIT + `
int main(void) {
  SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
  I2CMasterInitExpClk(I2C0_BASE, 16000000, false);
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x48, false);
  I2CMasterDataPut(I2C0_BASE, 0);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND); while (I2CMasterBusy(I2C0_BASE));
  while (1) {}
}`;
let logs = [];
o = new MSP.Sim({ onLog: (k, m) => logs.push(m) });
{
  const KN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KN[n] = 2);
  const c = CC.compile(srcP, KN); o.load(c); o.defaultParts(); o.mods.i2c_tmp.on = true; o.run(0.02, 2000);
  ok(logs.some(m => /PB2 is not set up as I2C0SCL/.test(m)), 'missing PB2 mux is explained: ' + logs.join(' | ').slice(0, 160));
}
// ---- LCD through PCF8574 (4-bit init + "Hi")
const srcL = I2C_INIT + `
void nib(uint8_t n, uint8_t rs) {
  uint8_t b = (n << 4) | 0x08 | rs;
  uint8_t t[1];
  t[0] = b | 4; wr(0x27, t, 1); t[0] = b; wr(0x27, t, 1);
}
void byte(uint8_t v, uint8_t rs) { nib(v >> 4, rs); nib(v & 15, rs); }` + HELP.replace(/^\n/, '') + `
int main(void) {` + I2C_SETUP + `
  SysCtlDelay(30000);
  nib(3, 0); SysCtlDelay(100000); nib(3, 0); SysCtlDelay(10000); nib(3, 0); SysCtlDelay(10000); nib(2, 0); SysCtlDelay(10000);
  byte(0x28, 0); SysCtlDelay(1000); byte(0x0C, 0); SysCtlDelay(1000); byte(0x01, 0); SysCtlDelay(20000); byte(0x06, 0); SysCtlDelay(1000);
  byte('H', 1); SysCtlDelay(1000); byte('i', 1);
  while (1) {}
}`;
o = runProg('i2c-lcd', srcL.replace(/void wr[\s\S]*?\n}\n/, m => m).replace('void nib', 'void wr(uint8_t a, uint8_t *d, int n);\nvoid nib'), { setup: S => { S.mods.i2c_lcd.on = true; }, steps: [[0.2]] });
if (o) {
  console.log('   busLog', o.busLog.length, JSON.stringify(o.busLog.slice(0,3)), 'mods', JSON.stringify(o.mods.i2c_lcd));
  const L = o.dev.lcd;
  ok(L && L.is4 && L.on, 'LCD reached 4-bit mode and display on');
  ok(L && String.fromCharCode(L.ddram[0], L.ddram[1]) === 'Hi', 'LCD shows "Hi" (got ' + (L ? String.fromCharCode(L.ddram[0], L.ddram[1]) : '-') + ', drops ' + (L && L.drops) + ')');
}
// ---- OLED: command stream + one data byte
const srcO = I2C_INIT + HELP + `
int main(void) {
  uint8_t c[4];` + I2C_SETUP + `
  c[0] = 0x00; c[1] = 0xAF; wr(0x3C, c, 2);
  c[0] = 0x40; c[1] = 0xFF; wr(0x3C, c, 2);
  while (1) {}
}`;
o = runProg('i2c-oled', srcO, { setup: S => { S.mods.i2c_oled.on = true; }, steps: [[0.05]] });
if (o) ok(o.dev.oled && o.dev.oled.on && o.dev.oled.fb[0] === 0xFF, 'OLED switched on and pixel column written');

const SPI_INIT = `
#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/ssi.h"
`;
const SPI_SETUP = (mode) => `
  SysCtlPeripheralEnable(SYSCTL_PERIPH_SSI0);
  SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
  SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOQ);
  GPIOPinConfigure(GPIO_PA2_SSI0CLK);
  GPIOPinConfigure(GPIO_PA4_SSI0XDAT0);
  GPIOPinConfigure(GPIO_PA5_SSI0XDAT1);
  GPIOPinTypeSSI(GPIO_PORTA_BASE, GPIO_PIN_2 | GPIO_PIN_4 | GPIO_PIN_5);
  GPIOPinTypeGPIOOutput(GPIO_PORTQ_BASE, GPIO_PIN_1);
  GPIOPinWrite(GPIO_PORTQ_BASE, GPIO_PIN_1, GPIO_PIN_1);
  SSIConfigSetExpClk(SSI0_BASE, 16000000, ${mode}, SSI_MODE_MASTER, 1000000, 8);
  SSIEnable(SSI0_BASE);`;
const SPI_HELP = `
volatile uint32_t dbg = 0;
uint8_t xfer(uint8_t b) { uint32_t r; SSIDataPut(SSI0_BASE, b); SSIDataGet(SSI0_BASE, &r); return (uint8_t)r; }
void cs(int on) { if (!on) { while (SSIBusy(SSI0_BASE)); } GPIOPinWrite(GPIO_PORTQ_BASE, GPIO_PIN_1, on ? 0 : GPIO_PIN_1); }
`;
const srcS = SPI_INIT + SPI_HELP + `
volatile uint32_t rd0 = 0, rd1 = 0, polls = 0;
int main(void) {` + SPI_SETUP('SSI_FRF_MOTO_MODE_0') + `
  cs(1); xfer(0x06); cs(0);
  cs(1); xfer(0x02); xfer(0x01); xfer(0x23); xfer(0x5A); xfer(0xA5); cs(0);
  do { cs(1); xfer(0x05); dbg = xfer(0); cs(0); polls++; } while (dbg & 1);
  cs(1); xfer(0x03); xfer(0x01); xfer(0x23); rd0 = xfer(0); rd1 = xfer(0); cs(0);
  while (1) {}
}`;
o = runProg('spi-eeprom', srcS, { setup: S => { S.mods.spi_eeprom.on = true; S.mods.spi_eeprom.cs = 'Q1'; }, steps: [[0.1]] });
if (o) {
  ok(o.dev.seeprom.mem[0x123] === 0x5A && o.dev.seeprom.mem[0x124] === 0xA5, '25LC256 stored 5A A5 at 0x0123');
  ok(o.busLog.some(x => /CS↓ 25LC256\s+MOSI 03 01 23 00 00\s+MISO \w\w \w\w \w\w 5A A5/.test(x.text)), 'READ frame decoded: ' + o.busLog.filter(x => /03 01 23/.test(x.text)).map(x => x.text).join(' | '));
  ok(o.tr.A2 && o.tr.A2.length > 100, 'SPI clock trace recorded (' + (o.tr.A2 || []).length + ' edges)');
}
// WRITE without WREN is ignored and explained
const srcN = SPI_INIT + SPI_HELP + `
int main(void) {` + SPI_SETUP('SSI_FRF_MOTO_MODE_0') + `
  cs(1); xfer(0x02); xfer(0x00); xfer(0x10); xfer(0x77); cs(0);
  while (1) {}
}`;
logs = []; o = new MSP.Sim({ onLog: (k, m) => logs.push(m) });
{
  const KN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KN[n] = 2);
  const c = CC.compile(srcN, KN); if (c.error) console.log(c.error); o.load(c); o.defaultParts(); o.mods.spi_eeprom.on = true; o.mods.spi_eeprom.cs = 'Q1'; o.run(0.05, 2000);
  ok(o.dev.seeprom && o.dev.seeprom.mem[0x10] === 0xFF, 'write without WREN did not change memory');
  ok(logs.some(m => /write latch/.test(m)), 'missing WREN is explained');
}
// 74HC595 latch
const srcH = SPI_INIT + SPI_HELP + `
int main(void) {` + SPI_SETUP('SSI_FRF_MOTO_MODE_0') + `
  cs(1); xfer(0xA5); cs(0);
  while (1) {}
}`;
o = runProg('spi-595', srcH, { setup: S => { S.mods.spi_595.on = true; S.mods.spi_595.cs = 'Q1'; }, steps: [[0.02]] });
if (o) ok(o.dev.h595 && o.dev.h595.out === 0xA5, '74HC595 latched A5 on chip-select rising edge');
// hardware FSS needs SPH=1 for multi-byte frames
const srcF = SPI_INIT + SPI_HELP + `
volatile uint32_t sr = 0;
int main(void) {` + SPI_SETUP('SSI_FRF_MOTO_MODE_3').replace('GPIOPinConfigure(GPIO_PA4_SSI0XDAT0);', 'GPIOPinConfigure(GPIO_PA3_SSI0FSS); GPIOPinConfigure(GPIO_PA4_SSI0XDAT0);').replace('GPIO_PIN_2 | GPIO_PIN_4', 'GPIO_PIN_2 | GPIO_PIN_3 | GPIO_PIN_4') + `
  uint32_t a, b;
  SSIDataPut(SSI0_BASE, 0x05); SSIDataPut(SSI0_BASE, 0x00);
  SSIDataGet(SSI0_BASE, &a); SSIDataGet(SSI0_BASE, &b); sr = b;
  while (1) {}
}`;
o = runProg('spi-fss-mode3', srcF, { setup: S => { S.mods.spi_eeprom.on = true; S.mods.spi_eeprom.cs = 'A3'; }, steps: [[0.02]] });
if (o) ok(o.busLog.some(x => /CS↓ 25LC256\s+MOSI 05 00/.test(x.text)), 'hardware FSS, mode 3: two bytes in one frame: ' + o.busLog.map(x => x.text).join(' | '));
logs = []; o = new MSP.Sim({ onLog: (k, m) => logs.push(m) });
{
  const KN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KN[n] = 2);
  const c = CC.compile(srcF.replace('MODE_3', 'MODE_0'), KN); o.load(c); o.defaultParts(); o.mods.spi_eeprom.on = true; o.mods.spi_eeprom.cs = 'A3'; o.run(0.02, 2000);
  ok(logs.some(m => /hardware frame-select pin goes high between every word/.test(m)), 'mode 0 + hardware FSS pitfall is explained');
}
// register-level I2C and SSI loopback
const srcR = `
#include <stdint.h>
volatile uint32_t status = 0, loop = 0;
int main(void) {
  SYSCTL->RCGCGPIO |= (1u << 1);
  SYSCTL->RCGCI2C |= 1;
  while (!(SYSCTL->PRI2C & 1)) {}
  GPIO_PORTB_AHB->AFSEL |= 0x0C;
  GPIO_PORTB_AHB->PCTL = (GPIO_PORTB_AHB->PCTL & 0xFFFF00FF) | 0x2200;
  GPIO_PORTB_AHB->ODR |= 0x08;
  GPIO_PORTB_AHB->DEN |= 0x0C;
  I2C0->MCR = 0x10;
  I2C0->MTPR = 7;
  I2C0->MSA = (0x48 << 1) | 0;
  I2C0->MDR = 0x00;
  I2C0->MCS = 0x07;
  while (I2C0->MCS & 1) {}
  status = I2C0->MCS;
  SYSCTL->RCGCSSI |= 1;
  while (!(SYSCTL->PRSSI & 1)) {}
  SSI0->CR1 = 0;
  SSI0->CPSR = 2;
  SSI0->CR0 = 0x0007;
  SSI0->CR1 = 0x03;           /* loopback + enable */
  SSI0->DR = 0x5C;
  while (!(SSI0->SR & 4)) {}
  loop = SSI0->DR;
  while (1) {}
}`;
o = runProg('regs-bus', srcR, { setup: S => { S.mods.i2c_tmp.on = true; }, steps: [[0.02]] });
if (o) {
  const R = o.getRegs();
  ok(o.busLog.some(x => /S 0x48 W ACK\s+0x00 ACK\s+P/.test(x.text)), 'register-level I2C transaction ran');
  ok(o.busLog.some(x => /loopback\s+5C/.test(x.text)), 'register-level SSI loopback ran');
  ok(R.peek(0x40020004, 4) !== undefined, 'MCS readable');
}
// I2C interrupt
const srcI = I2C_INIT + `
volatile uint32_t done = 0;
void I2C0_Handler(void) { I2CMasterIntClear(I2C0_BASE); done++; }
int main(void) {` + I2C_SETUP + `
  I2CMasterIntEnable(I2C0_BASE);
  IntEnable(INT_I2C0);
  IntMasterEnable();
  I2CMasterSlaveAddrSet(I2C0_BASE, 0x48, false);
  I2CMasterDataPut(I2C0_BASE, 0);
  I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
  while (done == 0) {}
  while (1) {}
}`;
o = runProg('i2c-irq', srcI.replace('#include "driverlib/uart.h"', '#include "driverlib/interrupt.h"'), { setup: S => { S.mods.i2c_tmp.on = true; }, steps: [[0.02]] });
if (o) ok(o.irqCount === 1, 'I2C0 interrupt fired once (irqCount ' + o.irqCount + ')');

// ---- shipped examples
const EXS = require('./examples.js');
function exRun(id, secs, setup) {
  const e = EXS.find(x => x.id === id), out = [], logs = [];
  const S = new MSP.Sim({ onTx: c => out.push(c), onLog: (k, m) => logs.push(k + ': ' + m) });
  const KN = {}; Object.keys(MSP.buildApi(new MSP.Sim())).forEach(n => KN[n] = 1); Object.keys(MSP.REGNAMES).forEach(n => KN[n] = 2);
  const c = CC.compile(e.code, KN);
  if (c.error) { ok(false, id + ' compiles: line ' + c.error.line + ' ' + c.error.msg); return null; }
  S.load(c); S.defaultParts(); (e.needs || []).forEach(n => { if (S.mods[n]) S.mods[n].on = true; });
  if (setup) setup(S);
  S.run(secs, 4000);
  S.uart = out.join(''); S.logs = logs;
  console.log('[' + id + '] t=' + S.now.toFixed(3) + ' halted=' + S.halted + ' uart=' + JSON.stringify(S.uart).slice(0, 160));
  logs.forEach(l => { if (!/^info/.test(l)) console.log('   ' + l.slice(0, 220)); });
  return S;
}
let x;
x = exRun('i2c_scan', 0.6);
if (x) { ok(/device at 0x27[\s\S]*0x3c[\s\S]*0x48[\s\S]*0x50[\s\S]*4 device\(s\) found/.test(x.uart), 'scan finds 0x27, 0x3C, 0x48, 0x50'); }
x = exRun('i2c_temp', 1.2, S => { S.mods.i2c_tmp.temp = -12.5; });
if (x) ok(/-12\.5 C/.test(x.uart) , 'temperature -12.5 C printed correctly');
x = exRun('i2c_temp', 1.2, S => { S.mods.i2c_tmp.temp = 36.25; });
if (x) ok(/36\.2 C/.test(x.uart) && x.gpio.N.out & 2, 'temperature 36.2 C printed, D1 lit');
x = exRun('i2c_eeprom', 0.3);
if (x) ok(/read back: MSP432/.test(x.uart) && /ready after [2-9]|ready after \d\d/.test(x.uart), 'EEPROM example reads back MSP432 after polling: ' + JSON.stringify(x.uart));
x = exRun('i2c_lcd', 1.5);
if (x) { const L = x.dev.lcd; ok(L && String.fromCharCode.apply(null, L.ddram.slice(0, 11)) === 'MSP432E401Y' && L.drops === 0, 'LCD shows title with no dropped bytes (drops ' + (L && L.drops) + ')'); ok(String.fromCharCode.apply(null, L.ddram.slice(40, 47)) === 'Uptime:', 'LCD second line'); }
x = exRun('i2c_oled', 0.8);
if (x) { const O = x.dev.oled; ok(O && O.on && O.pump && O.bytes >= 1024, 'OLED initialised and frame sent (' + (O && O.bytes) + ' data bytes)'); ok(O && O.fb[0] === 0xFF || (O && O.fb[0] & 1), 'OLED border drawn'); }
x = exRun('spi_eeprom', 0.5);
if (x) ok(/read back: MSP432E401Y/.test(x.uart), 'SPI EEPROM example reads back: ' + JSON.stringify(x.uart));
x = exRun('spi_595', 0.5);
if (x) ok(x.dev.h595 && x.dev.h595.latches > 3 && [1,2,4,8,16,32,64,128].indexOf(x.dev.h595.out) >= 0, '595 chaser latches one-hot patterns (' + (x.dev.h595 && x.dev.h595.out) + ')');
x = exRun('reg_i2c_ssi', 0.6, S => { S.mods.i2c_tmp.temp = 40; });
if (x) ok(x.dev.h595 && x.dev.h595.out === 31, 'register example: 40 C -> 5 LEDs lit (0x' + (x.dev.h595 && x.dev.h595.out.toString(16)) + ')');

//__END__


console.log(fails ? 'FAILURES: ' + fails : 'ALL BUS TESTS PASSED');
process.exit(fails ? 1 : 0);
