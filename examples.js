var EXAMPLES = [
{ id: 'blink', title: 'Blink', note: 'Alternate D1 and D2 with SysCtlDelay.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// LaunchPad user LEDs: D1 = PN1, D2 = PN0
int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480,
        120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPION)) { }

    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1);

    while (1)
    {
        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_1);
        SysCtlDelay(sysClock / 6);      // 3 cycles per count: about 0.5 s

        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_0);
        SysCtlDelay(sysClock / 6);
    }
}
` },
{ id: 'buttons', title: 'Buttons (polling)', note: 'SW1 lights D1, SW2 lights D2. Needs the weak pull-ups.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// SW1 = PJ0, SW2 = PJ1 (pressed = 0). D1 = PN1, D2 = PN0.
int main(void)
{
    SysCtlClockFreqSet(SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOJ);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOJ)) { }

    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    GPIOPinTypeGPIOInput(GPIO_PORTJ_BASE, GPIO_PIN_0 | GPIO_PIN_1);

    // The board has no external pull-ups on the user switches.
    // Delete this line and watch what happens to the LEDs.
    GPIOPadConfigSet(GPIO_PORTJ_BASE, GPIO_PIN_0 | GPIO_PIN_1,
                     GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    while (1)
    {
        uint32_t sw = GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_0 | GPIO_PIN_1);

        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, (sw & GPIO_PIN_0) ? 0 : GPIO_PIN_1);
        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0, (sw & GPIO_PIN_1) ? 0 : GPIO_PIN_0);
    }
}
` },
{ id: 'button_irq', title: 'Button interrupt', note: 'SW1 toggles D1 from a GPIOJ interrupt and the count prints on UART0.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/interrupt.h"
#include "utils/uartstdio.h"

volatile uint32_t presses = 0;

// The handler name comes from the vector table: GPIOJ_Handler
void GPIOJ_Handler(void)
{
    uint32_t status = GPIOIntStatus(GPIO_PORTJ_BASE, true);
    GPIOIntClear(GPIO_PORTJ_BASE, status);

    if (status & GPIO_PIN_0)
    {
        presses++;
        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, ~GPIOPinRead(GPIO_PORTN_BASE, GPIO_PIN_1));
    }
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOJ);

    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_1);
    GPIOPinTypeGPIOInput(GPIO_PORTJ_BASE, GPIO_PIN_0);
    GPIOPadConfigSet(GPIO_PORTJ_BASE, GPIO_PIN_0, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    GPIOIntTypeSet(GPIO_PORTJ_BASE, GPIO_PIN_0, GPIO_FALLING_EDGE);
    GPIOIntClear(GPIO_PORTJ_BASE, GPIO_PIN_0);
    GPIOIntEnable(GPIO_PORTJ_BASE, GPIO_PIN_0);
    IntEnable(INT_GPIOJ);
    IntMasterEnable();

    UARTprintf("Press SW1\n");

    uint32_t shown = 0;
    while (1)
    {
        if (shown != presses)
        {
            shown = presses;
            UARTprintf("SW1 pressed %u times\n", shown);
        }
        SysCtlSleep();
    }
}
` },
{ id: 'timer_irq', title: 'Timer interrupt', note: 'Timer0A fires every 500 ms, toggles D2 and counts seconds.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/timer.h"
#include "driverlib/interrupt.h"
#include "utils/uartstdio.h"

volatile bool tick = false;

void Timer0A_Handler(void)
{
    TimerIntClear(TIMER0_BASE, TIMER_TIMA_TIMEOUT);   // forget this and the simulator reports an interrupt storm
    tick = true;
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_TIMER0);

    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);
    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_0);

    TimerConfigure(TIMER0_BASE, TIMER_CFG_PERIODIC);
    TimerLoadSet(TIMER0_BASE, TIMER_A, sysClock / 2 - 1);   // 0.5 s
    IntEnable(INT_TIMER0A);
    TimerIntEnable(TIMER0_BASE, TIMER_TIMA_TIMEOUT);
    IntMasterEnable();
    TimerEnable(TIMER0_BASE, TIMER_A);

    uint32_t ticks = 0;
    while (1)
    {
        if (tick)
        {
            tick = false;
            ticks++;
            GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0, ~GPIOPinRead(GPIO_PORTN_BASE, GPIO_PIN_0));
            if ((ticks % 2) == 0)
            {
                UARTprintf("%u s\n", ticks / 2);
            }
        }
    }
}
` },
{ id: 'uart_leds', title: 'UART LED control', note: 'Type 1 to 4 in the terminal to toggle D1 to D4.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/uart.h"
#include "utils/uartstdio.h"

// D1 = PN1, D2 = PN0, D3 = PF4, D4 = PF0
uint8_t led[4] = {0, 0, 0, 0};

void showLeds(void)
{
    GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1 | GPIO_PIN_0,
                 (led[0] ? GPIO_PIN_1 : 0) | (led[1] ? GPIO_PIN_0 : 0));
    GPIOPinWrite(GPIO_PORTF_BASE, GPIO_PIN_4 | GPIO_PIN_0,
                 (led[2] ? GPIO_PIN_4 : 0) | (led[3] ? GPIO_PIN_0 : 0));
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOF);

    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    GPIOPinTypeGPIOOutput(GPIO_PORTF_BASE, GPIO_PIN_0 | GPIO_PIN_4);

    UARTprintf("\nType 1-4 to toggle LEDs D1-D4\n");

    while (1)
    {
        char c = UARTCharGet(UART0_BASE);
        int n = c - '1';

        if (n >= 0 && n < 4)
        {
            led[n] ^= 1;
            showLeds();
            UARTprintf("D%d %s\n", n + 1, led[n] ? "on" : "off");
        }
        else if (c != '\r' && c != '\n')
        {
            UARTprintf("? (%c)\n", c);
        }
    }
}
` },
{ id: 'adc', title: 'ADC voltmeter', note: 'Reads AIN0 (PE3). Drag the slider on the board. D1 lights above 2 V.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/adc.h"
#include "utils/uartstdio.h"

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOE);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_ADC0);

    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_1);
    GPIOPinTypeADC(GPIO_PORTE_BASE, GPIO_PIN_3);          // AIN0

    ADCSequenceConfigure(ADC0_BASE, 3, ADC_TRIGGER_PROCESSOR, 0);
    ADCSequenceStepConfigure(ADC0_BASE, 3, 0, ADC_CTL_CH0 | ADC_CTL_IE | ADC_CTL_END);
    ADCSequenceEnable(ADC0_BASE, 3);
    ADCIntClear(ADC0_BASE, 3);

    uint32_t raw = 0;
    while (1)
    {
        ADCProcessorTrigger(ADC0_BASE, 3);
        while (!ADCIntStatus(ADC0_BASE, 3, false)) { }
        ADCIntClear(ADC0_BASE, 3);
        ADCSequenceDataGet(ADC0_BASE, 3, &raw);

        uint32_t mv = raw * 3300 / 4095;
        UARTprintf("raw=%4u  %d.%03d V\n", raw, mv / 1000, mv % 1000);

        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, mv > 2000 ? GPIO_PIN_1 : 0);
        SysCtlDelay(sysClock / 12);                        // about 250 ms
    }
}
` },
{ id: 'pwm_fade', title: 'PWM fade', note: 'D4 (PF0) is M0PWM0. Ramps the duty cycle up and down at 1 kHz.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pwm.h"

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_PWM0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOF);

    GPIOPinConfigure(GPIO_PF0_M0PWM0);
    GPIOPinTypePWM(GPIO_PORTF_BASE, GPIO_PIN_0);

    PWMClockSet(PWM0_BASE, PWM_SYSCLK_DIV_64);
    uint32_t period = sysClock / 64 / 1000;               // 1 kHz

    PWMGenConfigure(PWM0_BASE, PWM_GEN_0, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_0, period);
    PWMOutputState(PWM0_BASE, PWM_OUT_0_BIT, true);
    PWMGenEnable(PWM0_BASE, PWM_GEN_0);

    int duty = 0;
    int step = 2;                                         // percent per step
    while (1)
    {
        PWMPulseWidthSet(PWM0_BASE, PWM_OUT_0, period * duty / 100);

        duty += step;
        if (duty >= 100 || duty <= 0)
        {
            step = -step;
        }
        SysCtlDelay(sysClock / 300);                      // about 10 ms
    }
}
` }
,
{ id: 'keypad', needs: ['keypad'], title: 'Keypad scanner', note: 'Rows on PK0-PK3 (outputs), columns on PL0-PL3 (inputs with pull-ups). Click the keys on the keypad.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "utils/uartstdio.h"

// Wiring (wired on the bench): rows R1-R4 = PK0-PK3, columns C1-C4 = PL0-PL3
const char keymap[4][4] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
};
uint8_t rowPin[4] = {GPIO_PIN_0, GPIO_PIN_1, GPIO_PIN_2, GPIO_PIN_3};

void keypadInit(void)
{
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOK);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOL);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOL)) { }

    GPIOPinTypeGPIOOutput(GPIO_PORTK_BASE, 0x0F);
    GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);            // all rows idle high

    GPIOPinTypeGPIOInput(GPIO_PORTL_BASE, 0x0F);
    GPIOPadConfigSet(GPIO_PORTL_BASE, 0x0F, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);
}

// Returns the character of the pressed key, or 0 when nothing is pressed.
char keypadScan(void)
{
    for (int r = 0; r < 4; r++)
    {
        GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F & ~rowPin[r]);   // drive one row low
        SysCtlDelay(200);                                          // let the lines settle
        uint32_t cols = GPIOPinRead(GPIO_PORTL_BASE, 0x0F);

        for (int c = 0; c < 4; c++)
        {
            if (!(cols & (1 << c)))
            {
                GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);
                return keymap[r][c];
            }
        }
    }
    GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);
    return 0;
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    keypadInit();
    UARTprintf("Press a key\n");

    char last = 0;
    while (1)
    {
        char k = keypadScan();
        if (k != last)
        {
            if (k)
            {
                UARTprintf("key %c\n", k);
            }
            last = k;
        }
        SysCtlDelay(sysClock / 300);                      // scan about every 10 ms
    }
}
` },
{ id: 'relay', needs: ['relay'], title: 'Relay control', note: 'SW1 toggles the relay on PM0 (active-low module). Watch the 10 ms contact delay in the analyzer.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "utils/uartstdio.h"

// Relay module IN pin = PM0. The module is active-low: 0 energizes the coil.
void relaySet(bool on)
{
    GPIOPinWrite(GPIO_PORTM_BASE, GPIO_PIN_0, on ? 0 : GPIO_PIN_0);
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOM);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOJ);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinWrite(GPIO_PORTM_BASE, GPIO_PIN_0, GPIO_PIN_0);   // set the latch to "off" first
    GPIOPinTypeGPIOOutput(GPIO_PORTM_BASE, GPIO_PIN_0);      // then make it an output: no glitch

    GPIOPinTypeGPIOInput(GPIO_PORTJ_BASE, GPIO_PIN_0);
    GPIOPadConfigSet(GPIO_PORTJ_BASE, GPIO_PIN_0, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    bool on = false;
    UARTprintf("Press SW1 to toggle the relay\n");

    while (1)
    {
        if (GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_0) == 0)
        {
            on = !on;
            relaySet(on);
            UARTprintf("relay %s\n", on ? "ON" : "OFF");
            SysCtlDelay(sysClock / 6);                        // lockout for 0.5 s: simple debounce
            while (GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_0) == 0) { }
        }
    }
}
` },
{ id: 'door_lock', needs: ['keypad','relay'], title: 'Keypad door lock', note: 'Enter 1234 then #. Correct PIN energizes the relay for 3 s. * clears the entry.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "utils/uartstdio.h"

// Wiring (wired on the bench): keypad rows PK0-PK3, columns PL0-PL3, relay IN = PM0 (active-low)
#define PIN_LEN 4

const char keymap[4][4] = {
    {'1', '2', '3', 'A'},
    {'4', '5', '6', 'B'},
    {'7', '8', '9', 'C'},
    {'*', '0', '#', 'D'}
};
const char secret[] = "1234";
uint8_t rowPin[4] = {GPIO_PIN_0, GPIO_PIN_1, GPIO_PIN_2, GPIO_PIN_3};
uint32_t sysClock;

void relaySet(bool on)
{
    GPIOPinWrite(GPIO_PORTM_BASE, GPIO_PIN_0, on ? 0 : GPIO_PIN_0);
}

char keypadScan(void)
{
    for (int r = 0; r < 4; r++)
    {
        GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F & ~rowPin[r]);
        SysCtlDelay(200);
        uint32_t cols = GPIOPinRead(GPIO_PORTL_BASE, 0x0F);
        for (int c = 0; c < 4; c++)
        {
            if (!(cols & (1 << c)))
            {
                GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);
                return keymap[r][c];
            }
        }
    }
    GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);
    return 0;
}

// Waits for a key, debounces it, and waits for release.
char getKey(void)
{
    char k;
    do
    {
        k = keypadScan();
    } while (k == 0);

    SysCtlDelay(sysClock / 60);                           // about 5 ms
    while (keypadScan() != 0) { }
    SysCtlDelay(sysClock / 60);
    return k;
}

int main(void)
{
    sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOK);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOL);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOM);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinTypeGPIOOutput(GPIO_PORTK_BASE, 0x0F);
    GPIOPinWrite(GPIO_PORTK_BASE, 0x0F, 0x0F);
    GPIOPinTypeGPIOInput(GPIO_PORTL_BASE, 0x0F);
    GPIOPadConfigSet(GPIO_PORTL_BASE, 0x0F, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    GPIOPinWrite(GPIO_PORTM_BASE, GPIO_PIN_0, GPIO_PIN_0);   // relay off before enabling the pin
    GPIOPinTypeGPIOOutput(GPIO_PORTM_BASE, GPIO_PIN_0);
    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_0 | GPIO_PIN_1);   // D2 = wrong PIN, D1 = unlocked

    char entry[PIN_LEN];
    int count = 0;
    UARTprintf("Enter PIN, then #\n> ");

    while (1)
    {
        char k = getKey();

        if (k == '*')
        {
            count = 0;
            UARTprintf("\ncleared\n> ");
        }
        else if (k == '#')
        {
            bool ok = (count == PIN_LEN);
            for (int i = 0; i < PIN_LEN && ok; i++)
            {
                if (entry[i] != secret[i]) { ok = false; }
            }

            if (ok)
            {
                UARTprintf("\nunlocked\n");
                GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, GPIO_PIN_1);
                relaySet(true);
                SysCtlDelay(sysClock);                        // 3 s
                relaySet(false);
                GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, 0);
            }
            else
            {
                UARTprintf("\nwrong PIN\n");
                GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0, GPIO_PIN_0);
                SysCtlDelay(sysClock / 3);                    // 1 s
                GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_0, 0);
            }
            count = 0;
            UARTprintf("> ");
        }
        else if (count < PIN_LEN)
        {
            entry[count] = k;
            count++;
            UARTprintf("*");
        }
    }
}
` },
{ id: 'ledbar', needs: ['ledbar'], title: 'LED bar chaser', note: 'Back-and-forth light on the 8-LED bar (PD0-PD7).', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// LED bar on PD0-PD7 (wired on the bench). LED n lights when PDn is high.
int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOD);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOD)) { }
    GPIOPinTypeGPIOOutput(GPIO_PORTD_BASE, 0xFF);

    int pos = 0;
    int dir = 1;
    while (1)
    {
        GPIOPinWrite(GPIO_PORTD_BASE, 0xFF, 1 << pos);
        SysCtlDelay(sysClock / 30);                       // about 100 ms

        pos += dir;
        if (pos == 7 || pos == 0)
        {
            dir = -dir;
        }
    }
}
` },
{ id: 'dip_leds', needs: ['dip','ledbar'], title: 'DIP switches to LEDs', note: 'Each closed switch (PQ0-PQ3) lights the matching LED (PD0-PD3).', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// DIP switches on PQ0-PQ3 connect the pin to ground when closed, so the pins need pull-ups.
// LED bar on PD0-PD7.
int main(void)
{
    SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOQ);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOD);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOD)) { }

    GPIOPinTypeGPIOInput(GPIO_PORTQ_BASE, 0x0F);
    GPIOPadConfigSet(GPIO_PORTQ_BASE, 0x0F, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);
    GPIOPinTypeGPIOOutput(GPIO_PORTD_BASE, 0xFF);

    while (1)
    {
        uint32_t sw = GPIOPinRead(GPIO_PORTQ_BASE, 0x0F);      // closed switch reads 0
        GPIOPinWrite(GPIO_PORTD_BASE, 0xFF, ~sw & 0x0F);       // so invert it for the LEDs
    }
}
` },
{ id: 'rgb', needs: ['rgb'], title: 'RGB color wheel', note: 'PWM on PF1, PF2, PF3 (M0PWM1-3) cycles the hue of the RGB LED.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pwm.h"

// RGB LED: red = PF1 (M0PWM1), green = PF2 (M0PWM2), blue = PF3 (M0PWM3)
uint32_t sysClock;
uint32_t period;

// Converts a hue (0-359) into three duty cycles in percent.
void setHue(int hue)
{
    int r = 0;
    int g = 0;
    int b = 0;
    int seg = hue / 60;
    int rise = (hue % 60) * 100 / 60;
    int fall = 100 - rise;

    if (seg == 0) { r = 100; g = rise; }
    else if (seg == 1) { r = fall; g = 100; }
    else if (seg == 2) { g = 100; b = rise; }
    else if (seg == 3) { g = fall; b = 100; }
    else if (seg == 4) { b = 100; r = rise; }
    else { b = fall; r = 100; }

    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_1, period * r / 100);
    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_2, period * g / 100);
    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_3, period * b / 100);
}

int main(void)
{
    sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_PWM0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOF);

    GPIOPinConfigure(GPIO_PF1_M0PWM1);
    GPIOPinConfigure(GPIO_PF2_M0PWM2);
    GPIOPinConfigure(GPIO_PF3_M0PWM3);
    GPIOPinTypePWM(GPIO_PORTF_BASE, GPIO_PIN_1 | GPIO_PIN_2 | GPIO_PIN_3);

    PWMClockSet(PWM0_BASE, PWM_SYSCLK_DIV_64);
    period = sysClock / 64 / 1000;                        // 1 kHz

    PWMGenConfigure(PWM0_BASE, PWM_GEN_0, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenConfigure(PWM0_BASE, PWM_GEN_1, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_0, period);
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_1, period);
    PWMOutputState(PWM0_BASE, PWM_OUT_1_BIT | PWM_OUT_2_BIT | PWM_OUT_3_BIT, true);
    PWMGenEnable(PWM0_BASE, PWM_GEN_0);
    PWMGenEnable(PWM0_BASE, PWM_GEN_1);

    int hue = 0;
    while (1)
    {
        setHue(hue);
        hue = (hue + 2) % 360;
        SysCtlDelay(sysClock / 150);                      // about 20 ms
    }
}
` },
{ id: 'seg_counter', needs: ['seg'], title: '7-segment counter', note: 'Counts 0-9 on the display (PC0-PC7 = a-g, dp). SW1 resets to 0.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// 7-segment display (common cathode): PC0=a PC1=b PC2=c PC3=d PC4=e PC5=f PC6=g PC7=dp
const uint8_t digits[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOC);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOJ);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOJ)) { }

    GPIOPinTypeGPIOOutput(GPIO_PORTC_BASE, 0xFF);
    GPIOPinTypeGPIOInput(GPIO_PORTJ_BASE, GPIO_PIN_0);
    GPIOPadConfigSet(GPIO_PORTJ_BASE, GPIO_PIN_0, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    int n = 0;
    while (1)
    {
        GPIOPinWrite(GPIO_PORTC_BASE, 0xFF, digits[n]);

        for (int i = 0; i < 50; i++)                       // wait 0.5 s but stay responsive to SW1
        {
            if (GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_0) == 0)
            {
                n = 9;                                     // becomes 0 below
            }
            SysCtlDelay(sysClock / 300);                   // 10 ms
        }
        n = (n + 1) % 10;
    }
}
` },
{ id: 'buzzer_melody', needs: ['buzzer'], title: 'Buzzer melody', note: 'Passive buzzer on PG0 (M0PWM4) plays a tune. Double-click the buzzer and tick Sound to hear it at 1x speed.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pwm.h"

// Passive buzzer on PG0 (M0PWM4). The PWM frequency sets the pitch.
const uint16_t notes[14] = {262, 262, 392, 392, 440, 440, 392, 349, 349, 330, 330, 294, 294, 262};
const uint8_t  beats[14] = {1,   1,   1,   1,   1,   1,   2,   1,   1,   1,   1,   1,   1,   2};
uint32_t sysClock;

void playNote(uint32_t freq, uint32_t ms)
{
    uint32_t period = sysClock / 64 / freq;
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_2, period);
    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_4, period / 2);   // 50% duty is the loudest
    PWMOutputState(PWM0_BASE, PWM_OUT_4_BIT, true);

    SysCtlDelay(sysClock / 3000 * ms);                    // sound for ms milliseconds

    PWMOutputState(PWM0_BASE, PWM_OUT_4_BIT, false);
    SysCtlDelay(sysClock / 3000 * 40);                    // short gap between notes
}

int main(void)
{
    sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_PWM0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOG);
    GPIOPinConfigure(GPIO_PG0_M0PWM4);
    GPIOPinTypePWM(GPIO_PORTG_BASE, GPIO_PIN_0);
    PWMClockSet(PWM0_BASE, PWM_SYSCLK_DIV_64);
    PWMGenConfigure(PWM0_BASE, PWM_GEN_2, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenEnable(PWM0_BASE, PWM_GEN_2);

    while (1)
    {
        for (int i = 0; i < 14; i++)
        {
            playNote(notes[i], beats[i] * 300);
        }
        SysCtlDelay(sysClock);                            // 3 s pause before repeating
    }
}
` },
{ id: 'motor_ctrl', needs: ['motor'], title: 'DC motor speed', note: 'H-bridge on PH0/PH1 with PWM enable on PG1. SW1 speeds up, SW2 slows down, through zero it reverses.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pwm.h"
#include "utils/uartstdio.h"

// H-bridge: IN1 = PH0, IN2 = PH1, EN = PG1 (M0PWM5). EN carries the PWM speed signal.
int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOH);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOG);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOJ);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_PWM0);

    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    GPIOPinTypeGPIOOutput(GPIO_PORTH_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    GPIOPinTypeGPIOInput(GPIO_PORTJ_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    GPIOPadConfigSet(GPIO_PORTJ_BASE, GPIO_PIN_0 | GPIO_PIN_1, GPIO_STRENGTH_2MA, GPIO_PIN_TYPE_STD_WPU);

    GPIOPinConfigure(GPIO_PG1_M0PWM5);
    GPIOPinTypePWM(GPIO_PORTG_BASE, GPIO_PIN_1);
    PWMClockSet(PWM0_BASE, PWM_SYSCLK_DIV_64);
    uint32_t period = sysClock / 64 / 2000;               // 2 kHz
    PWMGenConfigure(PWM0_BASE, PWM_GEN_2, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_2, period);
    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_5, 0);
    PWMOutputState(PWM0_BASE, PWM_OUT_5_BIT, true);
    PWMGenEnable(PWM0_BASE, PWM_GEN_2);

    int speed = 0;                                        // -100 to 100 percent
    UARTprintf("SW1 faster, SW2 slower\n");

    while (1)
    {
        bool sw1 = (GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_0) == 0);
        bool sw2 = (GPIOPinRead(GPIO_PORTJ_BASE, GPIO_PIN_1) == 0);

        if (sw1 || sw2)
        {
            if (sw1 && speed < 100) { speed += 20; }
            if (sw2 && speed > -100) { speed -= 20; }

            if (speed >= 0)
            {
                GPIOPinWrite(GPIO_PORTH_BASE, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_0);   // forward
            }
            else
            {
                GPIOPinWrite(GPIO_PORTH_BASE, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_1);   // reverse
            }
            PWMPulseWidthSet(PWM0_BASE, PWM_OUT_5, period * abs(speed) / 100);
            UARTprintf("speed %d%%\n", speed);

            SysCtlDelay(sysClock / 6);                    // 0.5 s repeat delay
        }
    }
}
` },
{ id: 'servo_sweep', needs: ['servo'], title: 'Servo sweep', note: '50 Hz PWM on PK4 (M0PWM6). The pulse width, 1 to 2 ms, sets the angle.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pwm.h"

// Servo signal on PK4 (M0PWM6). 20 ms frame, pulse 1 ms = 0 degrees, 2 ms = 180 degrees.
uint32_t sysClock;
uint32_t ticksPerMs;

void setAngle(int angle)
{
    PWMPulseWidthSet(PWM0_BASE, PWM_OUT_6, ticksPerMs + ticksPerMs * angle / 180);
}

int main(void)
{
    sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_PWM0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOK);
    GPIOPinConfigure(GPIO_PK4_M0PWM6);
    GPIOPinTypePWM(GPIO_PORTK_BASE, GPIO_PIN_4);

    PWMClockSet(PWM0_BASE, PWM_SYSCLK_DIV_64);
    ticksPerMs = sysClock / 64 / 1000;
    PWMGenConfigure(PWM0_BASE, PWM_GEN_3, PWM_GEN_MODE_DOWN | PWM_GEN_MODE_NO_SYNC);
    PWMGenPeriodSet(PWM0_BASE, PWM_GEN_3, ticksPerMs * 20);   // 50 Hz
    setAngle(0);
    PWMOutputState(PWM0_BASE, PWM_OUT_6_BIT, true);
    PWMGenEnable(PWM0_BASE, PWM_GEN_3);

    while (1)
    {
        for (int a = 0; a <= 180; a += 5)
        {
            setAngle(a);
            SysCtlDelay(sysClock / 75);                   // 40 ms
        }
        for (int a = 180; a >= 0; a -= 5)
        {
            setAngle(a);
            SysCtlDelay(sysClock / 75);
        }
    }
}
` },
{ id: 'stepper_turn', needs: ['stepper'], title: 'Stepper motor', note: '28BYJ-48 on PP0-PP3, half-step drive. Turns 90 degrees clockwise, then back.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"

// 28BYJ-48 with ULN2003 driver: IN1-IN4 = PP0-PP3.
// Half-step sequence, 4096 half-steps per output revolution.
const uint8_t halfStep[8] = {0x01, 0x03, 0x02, 0x06, 0x04, 0x0C, 0x08, 0x09};
uint32_t sysClock;
int phase = 0;

void move(int count, int dir)
{
    for (int i = 0; i < count; i++)
    {
        phase = (phase + dir + 8) % 8;
        GPIOPinWrite(GPIO_PORTP_BASE, 0x0F, halfStep[phase]);
        SysCtlDelay(sysClock / 1500);                     // 2 ms per half-step
    }
    GPIOPinWrite(GPIO_PORTP_BASE, 0x0F, 0);               // release the coils
}

int main(void)
{
    sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOP);
    while (!SysCtlPeripheralReady(SYSCTL_PERIPH_GPIOP)) { }
    GPIOPinTypeGPIOOutput(GPIO_PORTP_BASE, 0x0F);

    GPIOPinWrite(GPIO_PORTP_BASE, 0x0F, halfStep[0]);     // align the rotor with the first phase
    SysCtlDelay(sysClock / 300);                          // 10 ms to settle

    while (1)
    {
        move(1024, 1);                                    // 1024 half-steps = 90 degrees
        SysCtlDelay(sysClock / 6);
        move(1024, -1);
        SysCtlDelay(sysClock / 6);
    }
}
` }
,{ id: 'reg_blink', title: 'Registers: PLL + SysTick blink', note: 'No DriverLib. Sets the 120 MHz clock through SYSCTL registers, then polls the SysTick COUNTFLAG to blink D1 at 1 Hz.', code: String.raw`#include <stdint.h>
#include "msp432e401y.h"

// D1 = PN1. Everything below is plain register access.
static void clock_120mhz(void)
{
    SYSCTL->MOSCCTL = 0x10;                       // main oscillator on (25 MHz crystal)
    while ((SYSCTL->RIS & 0x100) == 0) { }        // wait for MOSCPUPRIS

    SYSCTL->RSCLKCFG = (3 << 20) | (3 << 24);     // OSCSRC = PLLSRC = MOSC
    SYSCTL->PLLFREQ1 = 4;                         // N = 4, Q = 0  ->  25 MHz / 5 = 5 MHz
    SYSCTL->PLLFREQ0 = (1 << 23) | 96;            // PLLPWR, MINT = 96  ->  480 MHz VCO
    while ((SYSCTL->PLLSTAT & 1) == 0) { }        // wait for lock

    SYSCTL->RSCLKCFG = (3 << 20) | (3 << 24) | (1 << 28) | (1 << 30) | 3;   // USEPLL, NEWFREQ, PSYSDIV = 3 -> 120 MHz
}

int main(void)
{
    clock_120mhz();

    SYSCTL->RCGCGPIO |= (1 << 12);                // clock Port N
    while ((SYSCTL->PRGPIO & (1 << 12)) == 0) { }

    GPIO_PORTN_AHB->DIR |= 0x02;                  // PN1 output
    GPIO_PORTN_AHB->DEN |= 0x02;                  // digital enable

    SysTick->LOAD = 120000000 / 2 - 1;            // 0.5 s per tick
    SysTick->VAL  = 0;
    SysTick->CTRL = 0x5;                          // ENABLE | CLKSRC (system clock), no interrupt

    while (1)
    {
        while ((SysTick->CTRL & (1 << 16)) == 0) { }   // COUNTFLAG (cleared by reading CTRL)
        GPIO_PORTN_AHB->DATA ^= 0x02;
    }
}
` },
{ id: 'reg_timer_irq', title: 'Registers: Timer0A interrupt', note: 'Periodic Timer0A at 4 Hz through TIMER0 and NVIC registers. The handler is named like the vector, so no registration call is needed.', code: String.raw`#include <stdint.h>
#include "msp432e401y.h"

volatile uint32_t ticks = 0;

// Vector name from the startup file: TIMER0A_IRQHandler
void TIMER0A_IRQHandler(void)
{
    TIMER0->ICR = 0x1;                            // clear the time-out flag first
    ticks++;
    GPIO_PORTN_AHB->DATA ^= 0x01;                 // D2 = PN0
}

int main(void)
{
    SYSCTL->RCGCGPIO |= (1 << 12);                // Port N clock
    SYSCTL->RCGCTIMER |= (1 << 0);                // Timer 0 clock
    while ((SYSCTL->PRTIMER & 1) == 0) { }

    GPIO_PORTN_AHB->DIR |= 0x01;
    GPIO_PORTN_AHB->DEN |= 0x01;

    TIMER0->CTL  = 0;                             // disable while configuring
    TIMER0->CFG  = 0;                             // 32-bit timer
    TIMER0->TAMR = 0x2;                           // periodic, count down
    TIMER0->TAILR = 16000000 / 4 - 1;             // 16 MHz PIOSC system clock -> 250 ms
    TIMER0->IMR  = 0x1;                           // time-out interrupt
    NVIC->IP[TIMER0A_IRQn] = 3 << 5;              // priority 3 (top 3 bits)
    NVIC->ISER[0] = 1u << TIMER0A_IRQn;           // enable IRQ 19
    TIMER0->CTL  = 0x1;                           // go

    __enable_irq();
    while (1) { }
}
` },
{ id: 'reg_uart_echo', title: 'Registers: UART0 echo', note: 'Configures UART0 with IBRD/FBRD/LCRH/CTL and polls the FR flags. Type in the terminal and the characters come back in upper case.', code: String.raw`#include <stdint.h>
#include "msp432e401y.h"

static void uart_putc(char c)
{
    while (UART0->FR & (1 << 5)) { }              // TXFF: wait while the FIFO is full
    UART0->DR = c;
}

static void uart_puts(const char *s)
{
    for (int i = 0; s[i] != 0; i++) uart_putc(s[i]);
}

int main(void)
{
    SYSCTL->RCGCGPIO |= (1 << 0);                 // Port A
    SYSCTL->RCGCUART |= (1 << 0);                 // UART0
    while ((SYSCTL->PRUART & 1) == 0) { }

    GPIO_PORTA_AHB->AFSEL |= 0x03;                // PA0/PA1 alternate function
    GPIO_PORTA_AHB->PCTL   = (GPIO_PORTA_AHB->PCTL & ~0xFF) | 0x11;   // U0RX, U0TX
    GPIO_PORTA_AHB->DEN   |= 0x03;

    UART0->CTL  = 0;                              // UART off while configuring
    UART0->IBRD = 8;                              // 16 MHz / (16 * 115200) = 8.68
    UART0->FBRD = 44;                             // 0.68 * 64 + 0.5
    UART0->LCRH = 0x60;                           // 8 data bits, no parity, one stop, FIFOs off
    UART0->CC   = 0;                              // system clock
    UART0->CTL  = 0x301;                          // RXE | TXE | UARTEN

    uart_puts("\r\nRegister-level UART echo. Type something:\r\n");
    while (1)
    {
        while (UART0->FR & (1 << 4)) { }          // RXFE: wait for a byte
        char c = (char)UART0->DR;
        if (c >= 'a' && c <= 'z') c = c - 32;
        uart_putc(c);
    }
}
` },
{ id: 'reg_button_irq', title: 'Registers: SW1 interrupt', note: 'GPIOJ edge interrupt set up with IS/IBE/IEV/IM and cleared with ICR. SW1 toggles D1; the handler name matches the vector table.', code: String.raw`#include <stdint.h>
#include "msp432e401y.h"

volatile uint32_t presses = 0;

void GPIOJ_IRQHandler(void)
{
    uint32_t flags = GPIO_PORTJ_AHB->MIS;         // which pins caused this?
    GPIO_PORTJ_AHB->ICR = flags;                  // write-1-to-clear
    if (flags & 0x01)
    {
        presses++;
        GPIO_PORTN_AHB->DATA ^= 0x02;             // D1
    }
}

int main(void)
{
    SYSCTL->RCGCGPIO |= (1 << 8) | (1 << 12);     // Port J and Port N
    while ((SYSCTL->PRGPIO & ((1 << 8) | (1 << 12))) != ((1 << 8) | (1 << 12))) { }

    GPIO_PORTN_AHB->DIR |= 0x02;
    GPIO_PORTN_AHB->DEN |= 0x02;

    GPIO_PORTJ_AHB->DIR &= ~0x01;                 // PJ0 input
    GPIO_PORTJ_AHB->DEN |= 0x01;
    GPIO_PORTJ_AHB->PUR |= 0x01;                  // SW1 pulls to ground, so it needs a pull-up
    GPIO_PORTJ_AHB->IS  &= ~0x01;                 // edge sensitive
    GPIO_PORTJ_AHB->IBE &= ~0x01;                 // one edge only
    GPIO_PORTJ_AHB->IEV &= ~0x01;                 // falling edge = press
    GPIO_PORTJ_AHB->ICR  = 0x01;                  // drop any stale flag
    GPIO_PORTJ_AHB->IM  |= 0x01;

    NVIC->ISER[GPIOJ_IRQn >> 5] = 1u << (GPIOJ_IRQn & 31);
    __enable_irq();

    while (1) { }
}
` }
,{ id: 'i2c_scan', needs: ['i2c_tmp','i2c_eeprom','i2c_lcd','i2c_oled'], title: 'I2C0: bus scanner', note: 'Reads one byte from every 7-bit address and prints the ones that acknowledge. PB2 is SCL and PB3 is SDA. Double-click a device, change its address, and scan again.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"
#include "utils/uartstdio.h"

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
    GPIOPinConfigure(GPIO_PB2_I2C0SCL);
    GPIOPinConfigure(GPIO_PB3_I2C0SDA);
    GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);   // clock: push-pull
    GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);      // data: open-drain
    I2CMasterInitExpClk(I2C0_BASE, sysClock, false);  // false = 100 kHz

    UARTprintf("Scanning 0x08 to 0x77...\n");
    uint32_t addr, found = 0;
    for (addr = 0x08; addr < 0x78; addr++)
    {
        I2CMasterSlaveAddrSet(I2C0_BASE, addr, true);              // true = read
        I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_RECEIVE);
        while (I2CMasterBusy(I2C0_BASE)) { }
        if (I2CMasterErr(I2C0_BASE) == I2C_MASTER_ERR_NONE)
        {
            UARTprintf("  device at 0x%02x\n", addr);
            found++;
        }
    }
    UARTprintf("%d device(s) found\n", found);
    while (1) { }
}
` },
{ id: 'i2c_temp', needs: ['i2c_tmp'], title: 'I2C0: temperature sensor', note: 'Reads a TMP102 at 0x48 twice a second and prints degrees Celsius. Double-click the sensor and drag its temperature slider. D1 lights above 30 degrees.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"
#include "utils/uartstdio.h"

#define TMP102_ADDR 0x48

// Read the 16-bit temperature register (pointer 0). Result in 1/16 degree units.
int readTemp(void)
{
    uint32_t hi, lo;
    int raw;

    // 1. write the pointer byte
    I2CMasterSlaveAddrSet(I2C0_BASE, TMP102_ADDR, false);
    I2CMasterDataPut(I2C0_BASE, 0x00);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
    while (I2CMasterBusy(I2C0_BASE)) { }

    // 2. read two bytes: ACK the first, NACK the second and send STOP
    I2CMasterSlaveAddrSet(I2C0_BASE, TMP102_ADDR, true);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_START);
    while (I2CMasterBusy(I2C0_BASE)) { }
    hi = I2CMasterDataGet(I2C0_BASE);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_FINISH);
    while (I2CMasterBusy(I2C0_BASE)) { }
    lo = I2CMasterDataGet(I2C0_BASE);

    raw = ((hi << 8) | lo) >> 4;          // 12-bit two's complement
    if (raw & 0x800) raw -= 4096;
    return raw;
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPION);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);
    GPIOPinTypeGPIOOutput(GPIO_PORTN_BASE, GPIO_PIN_1);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
    GPIOPinConfigure(GPIO_PB2_I2C0SCL);
    GPIOPinConfigure(GPIO_PB3_I2C0SDA);
    GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
    GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
    I2CMasterInitExpClk(I2C0_BASE, sysClock, false);

    while (1)
    {
        int raw = readTemp();
        int tenths = raw * 10 / 16;                    // 0.0625 degrees per count
        int mag = tenths < 0 ? -tenths : tenths;
        UARTprintf("%s%d.%d C\n", tenths < 0 ? "-" : "", mag / 10, mag % 10);
        GPIOPinWrite(GPIO_PORTN_BASE, GPIO_PIN_1, tenths > 300 ? GPIO_PIN_1 : 0);
        SysCtlDelay(sysClock / 6);                     // about 500 ms
    }
}
` },
{ id: 'i2c_eeprom', needs: ['i2c_eeprom'], title: 'I2C0: EEPROM write and read', note: 'Writes "MSP432" to a 24C02 at address 0x10, waits for the 5 ms write cycle with acknowledge polling, then reads it back. The decoder shows the NACKs while the part is busy.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"
#include "utils/uartstdio.h"

#define EE_ADDR 0x50

void i2cWait(void) { while (I2CMasterBusy(I2C0_BASE)) { } }

// Page write: memory address first, then the data bytes, all in one transaction.
void eeWrite(uint32_t memAddr, const char *s, uint32_t n)
{
    uint32_t i;
    I2CMasterSlaveAddrSet(I2C0_BASE, EE_ADDR, false);
    I2CMasterDataPut(I2C0_BASE, memAddr);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_START);
    i2cWait();
    for (i = 0; i < n; i++)
    {
        I2CMasterDataPut(I2C0_BASE, s[i]);
        I2CMasterControl(I2C0_BASE, i == n - 1 ? I2C_MASTER_CMD_BURST_SEND_FINISH : I2C_MASTER_CMD_BURST_SEND_CONT);
        i2cWait();
    }
}

// Acknowledge polling: the part does not answer while it is storing the page.
uint32_t eeWaitReady(void)
{
    uint32_t polls = 0;
    do
    {
        I2CMasterSlaveAddrSet(I2C0_BASE, EE_ADDR, false);
        I2CMasterDataPut(I2C0_BASE, 0x00);
        I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
        i2cWait();
        polls++;
    } while (I2CMasterErr(I2C0_BASE) != I2C_MASTER_ERR_NONE);
    return polls;
}

void eeRead(uint32_t memAddr, uint8_t *buf, uint32_t n)
{
    uint32_t i;
    I2CMasterSlaveAddrSet(I2C0_BASE, EE_ADDR, false);        // set the address pointer
    I2CMasterDataPut(I2C0_BASE, memAddr);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
    i2cWait();

    I2CMasterSlaveAddrSet(I2C0_BASE, EE_ADDR, true);         // sequential read
    for (i = 0; i < n; i++)
    {
        if (i == 0)          I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_START);
        else if (i == n - 1) I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_FINISH);
        else                 I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_RECEIVE_CONT);
        i2cWait();
        buf[i] = I2CMasterDataGet(I2C0_BASE);
    }
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
    GPIOPinConfigure(GPIO_PB2_I2C0SCL);
    GPIOPinConfigure(GPIO_PB3_I2C0SDA);
    GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
    GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
    I2CMasterInitExpClk(I2C0_BASE, sysClock, true);          // 400 kHz

    eeWrite(0x10, "MSP432", 6);
    UARTprintf("write sent, polling...\n");
    uint32_t polls = eeWaitReady();
    UARTprintf("ready after %d poll(s)\n", polls);

    uint8_t buf[8];
    uint32_t i;
    eeRead(0x10, buf, 6);
    UARTprintf("read back: ");
    for (i = 0; i < 6; i++) UARTprintf("%c", buf[i]);
    UARTprintf("\n");
    while (1) { }
}
` },
{ id: 'i2c_lcd', needs: ['i2c_lcd'], title: 'I2C0: LCD 16x2 (PCF8574)', note: 'Drives an HD44780 through a PCF8574 backpack at 0x27: wake-up sequence, 4-bit mode, two lines of text and a seconds counter. If you remove a delay, the LCD drops the command and says so.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"

// PCF8574 pins: P0 RS, P1 RW, P2 E, P3 backlight, P4-P7 = LCD D4-D7
#define LCD_ADDR 0x27
#define RS 0x01
#define EN 0x04
#define BL 0x08

uint32_t g_clk;

void delayUs(uint32_t us) { SysCtlDelay((g_clk / 3000000) * us); }

void expWrite(uint8_t v)
{
    I2CMasterSlaveAddrSet(I2C0_BASE, LCD_ADDR, false);
    I2CMasterDataPut(I2C0_BASE, v);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_SINGLE_SEND);
    while (I2CMasterBusy(I2C0_BASE)) { }
}

// Put a nibble on D4-D7 and pulse E; the LCD latches on the falling edge.
void lcdNibble(uint8_t nib, uint8_t rs)
{
    uint8_t v = (nib << 4) | BL | rs;
    expWrite(v | EN);
    expWrite(v);
}

void lcdByte(uint8_t b, uint8_t rs)
{
    lcdNibble(b >> 4, rs);
    lcdNibble(b & 0x0F, rs);
    delayUs(50);
}

void lcdCmd(uint8_t c)
{
    lcdByte(c, 0);
    if (c < 4) delayUs(2000);              // clear and home take 1.52 ms
}

void lcdInit(void)
{
    delayUs(50000);                        // power-up
    lcdNibble(0x3, 0); delayUs(5000);      // wake-up sequence: 3, 3, 3, then 2 selects 4-bit mode
    lcdNibble(0x3, 0); delayUs(200);
    lcdNibble(0x3, 0); delayUs(200);
    lcdNibble(0x2, 0); delayUs(200);
    lcdCmd(0x28);                          // 4-bit, 2 lines, 5x8 font
    lcdCmd(0x0C);                          // display on, cursor off
    lcdCmd(0x06);                          // increment, no shift
    lcdCmd(0x01);                          // clear
}

void lcdPrint(const char *s)
{
    uint32_t i = 0;
    while (s[i]) { lcdByte(s[i], RS); i++; }
}

void lcdGoto(uint32_t row, uint32_t col) { lcdCmd(0x80 | (row ? 0x40 : 0x00) | col); }

int main(void)
{
    g_clk = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
    GPIOPinConfigure(GPIO_PB2_I2C0SCL);
    GPIOPinConfigure(GPIO_PB3_I2C0SDA);
    GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
    GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
    I2CMasterInitExpClk(I2C0_BASE, g_clk, false);

    lcdInit();
    lcdGoto(0, 0); lcdPrint("MSP432E401Y");
    lcdGoto(1, 0); lcdPrint("Uptime:");

    uint32_t secs = 0;
    while (1)
    {
        lcdGoto(1, 8);
        lcdByte('0' + (secs / 100) % 10, RS);
        lcdByte('0' + (secs / 10) % 10, RS);
        lcdByte('0' + secs % 10, RS);
        lcdPrint(" s");
        secs++;
        SysCtlDelay(g_clk / 3);            // about 1 s
    }
}
` },
{ id: 'i2c_oled', needs: ['i2c_oled'], title: 'I2C0: OLED 128x64 (SSD1306)', note: 'Initialises an SSD1306 at 0x3C, then draws a frame and a scrolling sine wave from a 1 KB frame buffer at 400 kHz. The screen stays dark if the charge pump command is left out.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/i2c.h"

#define OLED_ADDR 0x3C

uint8_t fb[1024];                       // 8 pages of 128 columns, bit 0 = top row of the page

void i2cWait(void) { while (I2CMasterBusy(I2C0_BASE)) { } }

// A control byte (0x00 = commands, 0x40 = display data) comes first, then the payload.
void oledCmd(uint8_t c)
{
    I2CMasterSlaveAddrSet(I2C0_BASE, OLED_ADDR, false);
    I2CMasterDataPut(I2C0_BASE, 0x00);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_START);
    i2cWait();
    I2CMasterDataPut(I2C0_BASE, c);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_FINISH);
    i2cWait();
}

void oledFlush(void)
{
    uint32_t i;
    oledCmd(0x21); oledCmd(0); oledCmd(127);      // column range
    oledCmd(0x22); oledCmd(0); oledCmd(7);        // page range
    I2CMasterSlaveAddrSet(I2C0_BASE, OLED_ADDR, false);
    I2CMasterDataPut(I2C0_BASE, 0x40);
    I2CMasterControl(I2C0_BASE, I2C_MASTER_CMD_BURST_SEND_START);
    i2cWait();
    for (i = 0; i < 1024; i++)
    {
        I2CMasterDataPut(I2C0_BASE, fb[i]);
        I2CMasterControl(I2C0_BASE, i == 1023 ? I2C_MASTER_CMD_BURST_SEND_FINISH : I2C_MASTER_CMD_BURST_SEND_CONT);
        i2cWait();
    }
}

void setPixel(int x, int y)
{
    if (x < 0 || x > 127 || y < 0 || y > 63) return;
    fb[(y >> 3) * 128 + x] |= 1 << (y & 7);
}

void oledInit(void)
{
    oledCmd(0xAE);                                // display off
    oledCmd(0xD5); oledCmd(0x80);                 // clock divide
    oledCmd(0xA8); oledCmd(0x3F);                 // 64 rows
    oledCmd(0xD3); oledCmd(0x00);                 // no vertical offset
    oledCmd(0x40);                                // start line 0
    oledCmd(0x8D); oledCmd(0x14);                 // charge pump ON (without it the panel stays dark)
    oledCmd(0x20); oledCmd(0x00);                 // horizontal addressing mode
    oledCmd(0xA1); oledCmd(0xC8);                 // flip so the image is upright
    oledCmd(0xDA); oledCmd(0x12);
    oledCmd(0x81); oledCmd(0xCF);                 // contrast
    oledCmd(0xD9); oledCmd(0xF1);
    oledCmd(0xDB); oledCmd(0x40);
    oledCmd(0xA4); oledCmd(0xA6);                 // follow RAM, normal polarity
    oledCmd(0xAF);                                // display on
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOB);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_I2C0);
    GPIOPinConfigure(GPIO_PB2_I2C0SCL);
    GPIOPinConfigure(GPIO_PB3_I2C0SDA);
    GPIOPinTypeI2CSCL(GPIO_PORTB_BASE, GPIO_PIN_2);
    GPIOPinTypeI2C(GPIO_PORTB_BASE, GPIO_PIN_3);
    I2CMasterInitExpClk(I2C0_BASE, sysClock, true);   // 400 kHz fast mode

    oledInit();

    uint32_t phase = 0;
    int x, y;
    while (1)
    {
        for (x = 0; x < 1024; x++) fb[x] = 0;
        for (x = 0; x < 128; x++) { setPixel(x, 0); setPixel(x, 63); }
        for (y = 0; y < 64; y++) { setPixel(0, y); setPixel(127, y); }
        for (x = 2; x < 126; x++)
        {
            y = 32 + (int)(20.0f * sinf((x + phase) * 0.1f));
            setPixel(x, y);
        }
        oledFlush();
        phase += 4;
    }
}
` },
{ id: 'spi_eeprom', needs: ['spi_eeprom'], title: 'SSI0: 25LC256 EEPROM', note: 'SPI mode 0 at 1 MHz. Chip select is a GPIO (PP4) so a whole command stays in one frame. Write enable, page write, poll the status register, then read back. The decoder shows each frame.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/ssi.h"
#include "utils/uartstdio.h"

#define CS_PIN GPIO_PIN_4          // PP4, chip select (active low)

void csLow(void)  { GPIOPinWrite(GPIO_PORTP_BASE, CS_PIN, 0); }
void csHigh(void)
{
    while (SSIBusy(SSI0_BASE)) { }                // let the last bit leave before releasing the chip
    GPIOPinWrite(GPIO_PORTP_BASE, CS_PIN, CS_PIN);
}

// One byte out, one byte in (SPI always does both)
uint8_t spi(uint8_t b)
{
    uint32_t r;
    SSIDataPut(SSI0_BASE, b);
    SSIDataGet(SSI0_BASE, &r);
    return (uint8_t)r;
}

void eeWriteEnable(void) { csLow(); spi(0x06); csHigh(); }       // WREN: its own frame

uint8_t eeStatus(void)
{
    uint8_t s;
    csLow(); spi(0x05); s = spi(0x00); csHigh();                 // RDSR
    return s;
}

void eeWrite(uint32_t addr, const char *s, uint32_t n)
{
    uint32_t i;
    eeWriteEnable();
    csLow();
    spi(0x02); spi(addr >> 8); spi(addr & 0xFF);                 // WRITE + 16-bit address
    for (i = 0; i < n; i++) spi(s[i]);
    csHigh();                                                    // the write starts when CS rises
    while (eeStatus() & 1) { }                                   // WIP bit: busy for about 5 ms
}

void eeRead(uint32_t addr, uint8_t *buf, uint32_t n)
{
    uint32_t i;
    csLow();
    spi(0x03); spi(addr >> 8); spi(addr & 0xFF);                 // READ
    for (i = 0; i < n; i++) buf[i] = spi(0x00);                  // clock out dummy bytes to receive
    csHigh();
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_UART0);
    GPIOPinConfigure(GPIO_PA0_U0RX);
    GPIOPinConfigure(GPIO_PA1_U0TX);
    GPIOPinTypeUART(GPIO_PORTA_BASE, GPIO_PIN_0 | GPIO_PIN_1);
    UARTStdioConfig(0, 115200, sysClock);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_SSI0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOP);
    GPIOPinConfigure(GPIO_PA2_SSI0CLK);
    GPIOPinConfigure(GPIO_PA4_SSI0XDAT0);                        // MOSI
    GPIOPinConfigure(GPIO_PA5_SSI0XDAT1);                        // MISO
    GPIOPinTypeSSI(GPIO_PORTA_BASE, GPIO_PIN_2 | GPIO_PIN_4 | GPIO_PIN_5);
    GPIOPinTypeGPIOOutput(GPIO_PORTP_BASE, CS_PIN);
    GPIOPinWrite(GPIO_PORTP_BASE, CS_PIN, CS_PIN);               // deselected

    SSIConfigSetExpClk(SSI0_BASE, sysClock, SSI_FRF_MOTO_MODE_0, SSI_MODE_MASTER, 1000000, 8);
    SSIEnable(SSI0_BASE);

    eeWrite(0x0100, "MSP432E401Y", 11);
    uint8_t buf[16];
    uint32_t i;
    eeRead(0x0100, buf, 11);
    UARTprintf("read back: ");
    for (i = 0; i < 11; i++) UARTprintf("%c", buf[i]);
    UARTprintf("\n");
    while (1) { }
}
` },
{ id: 'spi_595', needs: ['spi_595'], title: 'SSI0: 74HC595 LED chaser', note: 'Shifts one byte per step into a 74HC595 and latches it with chip select (PP5). A single light runs back and forth along the eight LEDs.', code: String.raw`#include <stdint.h>
#include <stdbool.h>
#include "driverlib/sysctl.h"
#include "driverlib/gpio.h"
#include "driverlib/pin_map.h"
#include "driverlib/ssi.h"

#define LATCH GPIO_PIN_5           // PP5 drives RCLK: outputs update when it goes high

void show(uint8_t pattern)
{
    uint32_t dummy;
    GPIOPinWrite(GPIO_PORTP_BASE, LATCH, 0);
    SSIDataPut(SSI0_BASE, pattern);
    SSIDataGet(SSI0_BASE, &dummy);                // wait until the byte is out
    while (SSIBusy(SSI0_BASE)) { }
    GPIOPinWrite(GPIO_PORTP_BASE, LATCH, LATCH);  // rising edge copies the shift register to the LEDs
}

int main(void)
{
    uint32_t sysClock = SysCtlClockFreqSet(
        SYSCTL_XTAL_25MHZ | SYSCTL_OSC_MAIN | SYSCTL_USE_PLL | SYSCTL_CFG_VCO_480, 120000000);

    SysCtlPeripheralEnable(SYSCTL_PERIPH_SSI0);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOA);
    SysCtlPeripheralEnable(SYSCTL_PERIPH_GPIOP);
    GPIOPinConfigure(GPIO_PA2_SSI0CLK);
    GPIOPinConfigure(GPIO_PA4_SSI0XDAT0);
    GPIOPinConfigure(GPIO_PA5_SSI0XDAT1);
    GPIOPinTypeSSI(GPIO_PORTA_BASE, GPIO_PIN_2 | GPIO_PIN_4 | GPIO_PIN_5);
    GPIOPinTypeGPIOOutput(GPIO_PORTP_BASE, LATCH);

    SSIConfigSetExpClk(SSI0_BASE, sysClock, SSI_FRF_MOTO_MODE_0, SSI_MODE_MASTER, 2000000, 8);
    SSIEnable(SSI0_BASE);

    int pos = 0, dir = 1;
    while (1)
    {
        show(1 << pos);
        pos += dir;
        if (pos == 7 || pos == 0) dir = -dir;
        SysCtlDelay(sysClock / 30);               // about 100 ms
    }
}
` },
{ id: 'reg_i2c_ssi', needs: ['i2c_tmp','spi_595'], title: 'Registers: I2C0 + SSI0', note: 'No DriverLib. Reads the TMP102 through the I2C0 master registers (MSA, MDR, MCS) and shows the temperature on the 74HC595 LEDs through SSI0 (CR0, CPSR, CR1, DR, SR).', code: String.raw`#include <stdint.h>

int main(void)
{
    // clocks: Port A (SSI0 pins), Port B (I2C0 pins), Port P (latch); then wait for ready
    SYSCTL->RCGCGPIO |= (1u << 0) | (1u << 1) | (1u << 13);
    SYSCTL->RCGCI2C  |= (1u << 0);
    SYSCTL->RCGCSSI  |= (1u << 0);
    while ((SYSCTL->PRGPIO & ((1u << 0) | (1u << 1) | (1u << 13))) != ((1u << 0) | (1u << 1) | (1u << 13))) { }
    while (!(SYSCTL->PRI2C & 1)) { }
    while (!(SYSCTL->PRSSI & 1)) { }

    // PB2 = I2C0SCL, PB3 = I2C0SDA (alternate function 2); SDA is open-drain
    GPIO_PORTB_AHB->AFSEL |= 0x0C;
    GPIO_PORTB_AHB->PCTL   = (GPIO_PORTB_AHB->PCTL & 0xFFFF00FF) | 0x00002200;
    GPIO_PORTB_AHB->ODR   |= 0x08;
    GPIO_PORTB_AHB->DEN   |= 0x0C;

    // PA2 = SSI0CLK, PA4 = SSI0XDAT0, PA5 = SSI0XDAT1 (alternate function 15)
    GPIO_PORTA_AHB->AFSEL |= 0x34;
    GPIO_PORTA_AHB->PCTL   = (GPIO_PORTA_AHB->PCTL & 0xFF00F0FF) | 0x00FF0F00;
    GPIO_PORTA_AHB->DEN   |= 0x34;

    // PP5 = latch, a plain output, idle high
    GPIO_PORTP_AHB->DIR |= 0x20;
    GPIO_PORTP_AHB->DEN |= 0x20;
    GPIO_PORTP_AHB->DATA = 0x20;

    // I2C0 master at 100 kHz with the 16 MHz default clock: TPR = 16e6 / (20 * 100e3) - 1 = 7
    I2C0->MCR  = 0x10;
    I2C0->MTPR = 7;

    // SSI0: master, mode 0, 8-bit, 16 MHz / (2 * (1 + 7)) = 1 MHz
    SSI0->CR1  = 0;
    SSI0->CPSR = 2;
    SSI0->CR0  = (7 << 8) | 0x07;
    SSI0->CR1  = 0x02;

    while (1)
    {
        // write the pointer byte (0 = temperature register)
        I2C0->MSA = (0x48 << 1) | 0;
        I2C0->MDR = 0;
        I2C0->MCS = 0x07;                        // RUN | START | STOP
        while (I2C0->MCS & 1) { }                // BUSY

        // read two bytes
        I2C0->MSA = (0x48 << 1) | 1;
        I2C0->MCS = 0x0B;                        // RUN | START | ACK
        while (I2C0->MCS & 1) { }
        uint32_t hi = I2C0->MDR;
        I2C0->MCS = 0x05;                        // RUN | STOP, no ACK on the last byte
        while (I2C0->MCS & 1) { }
        uint32_t lo = I2C0->MDR;

        uint32_t whole = ((hi << 8) | lo) >> 8;  // whole degrees in the high byte
        uint32_t bar = (1u << (whole / 8)) - 1;  // one LED per 8 degrees

        GPIO_PORTP_AHB->DATA = 0;
        SSI0->DR = bar & 0xFF;
        while (SSI0->SR & 0x10) { }              // BSY
        (void)SSI0->DR;                          // drain the receive FIFO
        GPIO_PORTP_AHB->DATA = 0x20;

        for (volatile uint32_t d = 0; d < 400000; d++) { }
    }
}
` }
];
if (typeof module !== 'undefined') module.exports = EXAMPLES;
