import { expect, test, type BrowserContext, type WebSocketRoute } from '@playwright/test';

const route = '/instruments/resident-frequency';
const device = 'osc/electric-sky/temperature';
function voices(ready = true, frequency = 0.2) {
  return { type: 'resident_voices', device, ready, reason: ready ? '' : 'coverage', coverage: ready ? 1 : 0.4, value: 22.25,
    voices: [{ id: 1, active: true, frequencyHz: frequency, periodSeconds: 1 / frequency, confidence: 0.8, phase: 0 }] };
}
interface OutputTest { sent: { bytes: number[]; timestamp?: number }[]; requests: number; opened: number; closed: number; audioClosed: number; started: number; stopped: number }
async function simulateOutputs(context: BrowserContext) {
  await context.addInitScript(() => {
    const state: OutputTest = { sent: [], requests: 0, opened: 0, closed: 0, audioClosed: 0, started: 0, stopped: 0 };
    Object.assign(window, { voicesTest: state });
    const output = { id: 'test', name: 'IAC Test', state: 'connected', send: (bytes: number[], timestamp?: number) => state.sent.push({ bytes: [...bytes], timestamp }),
      clear: () => {}, open: async () => { state.opened++; }, close: async () => { state.closed++; } };
    Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, value: async () => { state.requests++; return { outputs: new Map([['test', output]]), onstatechange: null }; } });
    class Parameter { value = 0; setTargetAtTime() {} setValueAtTime() {} cancelScheduledValues() {} }
    class Node {
      gain = new Parameter(); frequency = new Parameter(); threshold = new Parameter(); knee = new Parameter(); ratio = new Parameter(); attack = new Parameter(); release = new Parameter();
      connect(node: unknown) { return node; } disconnect() {} start() { state.started++; } stop() { state.stopped++; }
    }
    class Context {
      currentTime = 0; state = 'running'; destination = new Node();
      async resume() {} async close() { state.audioClosed++; }
      createDynamicsCompressor() { return new Node(); } createGain() { return new Node(); } createOscillator() { return new Node(); }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
  });
}

test('subscribes on the shared socket, shows live values/readiness, and resubscribes', async ({ page }) => {
  const sockets: WebSocketRoute[] = [], commands: Record<string, unknown>[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    socket.onMessage((raw) => { const message = JSON.parse(String(raw)); commands.push(message); if (message.type === 'resident_subscribe' && message.enabled) socket.send(JSON.stringify(voices(false))); });
  });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Resident Frequency', exact: true }).click();
  await expect(page.getByText('0 of 1 streams ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'enable MIDI', exact: true })).toBeDisabled();
  const group = page.getByRole('region', { name: 'electric-sky voices' });
  await expect(group).toContainText('reading'); await expect(group).toContainText('40%');
  sockets[0].send(JSON.stringify(voices()));
  await expect(page.getByText('1 of 1 streams ready')).toBeVisible();
  await expect(group).toContainText('0.2000 Hz'); await expect(group).toContainText('22.2500');
  sockets[0].send(JSON.stringify({ type: 'resident_values', updates: [{ device, value: 23.75 }] }));
  await expect(group).toContainText('23.7500');
  sockets[0].send(JSON.stringify({ type: 'resident_voices', device: '<img src=x onerror=alert(1)>', ready: true, voices: [{ id: '<script>', frequencyHz: 1 }] }));
  await expect(page.locator('img')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  sockets[0].close(); await expect.poll(() => sockets.length).toBe(2);
  await expect(page.getByText('0 of 2 streams ready')).toBeVisible();
  expect(commands.filter((message) => message.type === 'resident_subscribe' && message.enabled)).toHaveLength(2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('navigation').getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'resident_subscribe', enabled: false });
  expect(errors).toEqual([]);
});

test('routes notes and all beat levels, applies CC ranges, and stops output on cleanup', async ({ context, page }) => {
  await simulateOutputs(context);
  let socket!: WebSocketRoute;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (ws) => { socket = ws; ws.onMessage((raw) => { if (JSON.parse(String(raw)).enabled) ws.send(JSON.stringify(voices())); }); });
  await page.goto(route);
  const state = () => page.evaluate(() => (window as unknown as { voicesTest: OutputTest }).voicesTest);
  await expect(page.getByRole('button', { name: 'enable MIDI', exact: true })).toBeEnabled();
  expect((await state()).requests).toBe(0); expect((await state()).started).toBe(0);
  await page.getByRole('button', { name: 'enable MIDI', exact: true }).click();
  expect((await state()).opened).toBe(0);
  await page.getByRole('combobox', { name: 'output', exact: true }).selectOption('test');
  await expect.poll(async () => (await state()).sent.some(({ bytes }) => bytes[0] === 0x90 && bytes[1] === 65)).toBe(true);
  const before = (await state()).sent.length;
  socket.send(JSON.stringify(voices(true, 0.201)));
  await page.waitForTimeout(100); expect((await state()).sent).toHaveLength(before); // Hysteresis prevents retriggering.
  socket.send(JSON.stringify(voices(true, 0.4)));
  await expect.poll(async () => (await state()).sent.some(({ bytes, timestamp }) => bytes[0] === 0x80 && timestamp !== undefined)).toBe(true);
  await page.getByRole('checkbox', { name: `${device} beat`, exact: true }).check();
  await expect.poll(async () => (await state()).sent.some(({ bytes }) => bytes[0] === 0xb0 && bytes[1] === 20)).toBe(true);
  const range = page.locator('[data-beat-range-key="0:20"]');
  await range.getByRole('slider', { name: /Width/ }).focus(); await range.getByRole('slider', { name: /Width/ }).press('Home');
  await range.getByRole('slider', { name: /Center/ }).focus(); await range.getByRole('slider', { name: /Center/ }).press('End');
  await expect.poll(async () => (await state()).sent.some(({ bytes }) => bytes[0] === 0xb0 && bytes[1] === 20 && bytes[2] === 127)).toBe(true);
  await page.locator('.device-beat-enabled').check(); await page.locator('[data-voices=global-beat-enabled]').check();
  await expect.poll(async () => (await state()).sent.some(({ bytes }) => bytes[0] === 0xbd && bytes[1] === 11)).toBe(true);
  await expect.poll(async () => (await state()).sent.some(({ bytes }) => bytes[0] === 0xbf && bytes[1] === 1)).toBe(true);
  await page.getByRole('button', { name: 'electric-sky audio', exact: true }).click();
  await expect.poll(async () => (await state()).started).toBe(1);
  await page.getByRole('checkbox', { name: `${device} notes`, exact: true }).uncheck();
  await expect.poll(async () => (await state()).stopped).toBe(1);
  await page.getByRole('checkbox', { name: `${device} notes`, exact: true }).check();
  await expect.poll(async () => (await state()).started).toBe(2);
  await page.getByRole('button', { name: 'panic', exact: true }).click();
  const count = (await state()).sent.length;
  socket.send(JSON.stringify(voices())); await page.waitForTimeout(100); expect((await state()).sent).toHaveLength(count);
  await page.getByRole('navigation').getByRole('link', { name: 'Signals', exact: true }).click();
  await expect.poll(async () => (await state()).audioClosed).toBe(1);
  expect((await state()).closed).toBe(1); expect((await state()).stopped).toBe(2);
  expect(errors).toEqual([]);
});

test('releases notes when analysis becomes unready and ignores late MIDI permission', async ({ context, page }) => {
  await simulateOutputs(context);
  let socket!: WebSocketRoute;
  await page.routeWebSocket('wss://rf.postoccupancy.com', (ws) => { socket = ws; ws.onMessage(() => ws.send(JSON.stringify(voices()))); });
  await page.goto(route);
  await page.getByRole('button', { name: 'enable MIDI', exact: true }).click();
  await page.getByRole('combobox', { name: 'output', exact: true }).selectOption('test');
  socket.send(JSON.stringify(voices(false)));
  await expect(page.getByRole('button', { name: 'enable MIDI', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { voicesTest: OutputTest }).voicesTest.sent.some(({ bytes }) => bytes[0] === 0x80))).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Signals', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: () => new Promise((resolve) => Object.assign(window, { resolveMidi: resolve })) });
  });
  await page.getByRole('navigation').getByRole('link', { name: 'Resident Frequency', exact: true }).click();
  await page.getByRole('button', { name: 'enable MIDI', exact: true }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Signals', exact: true }).click();
  await page.evaluate(() => (window as unknown as { resolveMidi: (access: unknown) => void }).resolveMidi({ outputs: new Map(), onstatechange: null }));
  await expect(page.getByRole('heading', { name: 'Signals', exact: true })).toBeVisible();
});
