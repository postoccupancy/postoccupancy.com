import { expect, test, type BrowserContext, type WebSocketRoute } from '@playwright/test';

const route = '/interfaces/microphone-visualizer';
interface MicTest {
  requested: number; stopped: number; closed: number; destinationConnections: number;
  mode: 'normal' | 'denied' | 'pending'; visible: boolean; resolve?: () => void;
}
async function simulateMicrophone(context: BrowserContext) {
  await context.addInitScript(() => {
    const state: MicTest = { requested: 0, stopped: 0, closed: 0, destinationConnections: 0, mode: 'normal', visible: true };
    Object.assign(window, { micTest: state });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.visible ? 'visible' : 'hidden' });
    const track = { label: 'Simulated microphone', onended: null, stop: () => { state.stopped++; } };
    const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      state.requested++;
      if (state.mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError');
      if (state.mode === 'pending') await new Promise<void>((resolve) => { state.resolve = resolve; });
      return stream;
    } });
    class Context {
      sampleRate = 48000; destination = {};
      async resume() {}
      async close() { state.closed++; }
      createMediaStreamSource() { return { connect: (target: unknown) => { if (target === this.destination) state.destinationConnections++; }, disconnect: () => {} }; }
      createAnalyser() {
        return { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.8, disconnect: () => {},
          getFloatTimeDomainData: (values: Float32Array) => { for (let i = 0; i < values.length; i++) values[i] = 0.2 * Math.sin(i / 10); },
          getByteFrequencyData: (values: Uint8Array) => { values.fill(32); values.fill(160, 1, 80); },
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
  });
}

test('publishes five microphone values to Electric Sea without MIDI and renders all views', async ({ context, page }) => {
  await simulateMicrophone(context);
  const sockets: WebSocketRoute[] = [], messages: Record<string, unknown>[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: 'client_info', ip: '192.168.1.50', tabCount: sockets.length, oscUdpAvailable: false }));
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)); messages.push(message);
      if (message.type === 'json') for (const peer of sockets) if (peer !== socket) peer.send(JSON.stringify(message));
    });
  });
  const sea = await context.newPage();
  await sea.goto('/hubs/electric-sea');
  await page.goto(route);
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  const state = () => page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest);
  expect((await state()).requested).toBe(0);
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Microphone status', exact: true })).toHaveText('Simulated microphone');
  for (const param of ['rms', 'bass', 'mid', 'high', 'centroid']) {
    await expect(sea.getByRole('rowheader', { name: `json/mic-192.168.1.50/${param}`, exact: true })).toBeVisible();
    await expect(page.locator(`[data-mic=${param}]`)).toHaveText(/^\d\.\d{4}$/);
  }
  for (const view of ['Spectrum', 'Spectrogram', 'Waveform']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(page.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect.poll(() => page.locator('[data-mic=canvas] canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 1] > data[i] + 20) colored++;
    return colored;
  })).toBeGreaterThan(100);
  const json = messages.filter((message) => message.type === 'json');
  expect(new Set(json.map((message) => message.device)).size).toBe(5);
  expect(json.every((message) => typeof message.value === 'number' && message.value >= 0 && message.value <= 1)).toBe(true);
  expect(messages.some((message) => message.type === 'midi')).toBe(false);
  expect((await state()).destinationConnections).toBe(0);
  expect(sockets).toHaveLength(2); // One shared connection for each browser page.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Stop microphone', exact: true }).click();
  await expect.poll(async () => (await state()).stopped).toBe(1);
  expect((await state()).closed).toBe(1);
  const count = messages.length;
  await page.waitForTimeout(150);
  expect(messages).toHaveLength(count);
  expect(errors).toEqual([]);
});

test('handles denial, pauses hidden-tab publishing, reconnects, and cleans up on navigation', async ({ context, page }) => {
  await simulateMicrophone(context);
  const sockets: WebSocketRoute[] = [], messages: Record<string, unknown>[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket); socket.send(JSON.stringify({ type: 'client_info', ip: `client-${sockets.length}` }));
    socket.onMessage((raw) => messages.push(JSON.parse(String(raw))));
  });
  await page.goto(route);
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.mode = 'denied'; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Microphone status', exact: true })).toHaveText('Permission denied');
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.mode = 'normal'; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => messages.length).toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.visible = false; });
  const count = messages.length;
  await page.waitForTimeout(150); expect(messages).toHaveLength(count);
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.visible = true; });
  await expect.poll(() => messages.length).toBeGreaterThan(count);
  sockets[0].close();
  await expect.poll(() => sockets.length).toBe(2);
  await expect.poll(() => messages.some((message) => String(message.device).startsWith('json/mic-client-2/'))).toBe(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest.closed)).toBe(2); // Denied context + active context.
  await expect(page.locator('[data-mic=canvas] canvas')).toHaveCount(0);
  expect(sockets).toHaveLength(2);
});

test('releases a microphone permission result that arrives after leaving the page', async ({ context, page }) => {
  await simulateMicrophone(context);
  await page.routeWebSocket('wss://rf.postoccupancy.com', () => {});
  await page.goto(route);
  await expect(page.getByRole('button', { name: 'Enable microphone', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.mode = 'pending'; });
  await page.getByRole('button', { name: 'Enable microphone', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest.requested)).toBe(1);
  await page.getByRole('navigation').getByRole('link', { name: 'Signals', exact: true }).click();
  await page.evaluate(() => { (window as unknown as { micTest: MicTest }).micTest.resolve!(); });
  await expect.poll(() => page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest.stopped)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { micTest: MicTest }).micTest.closed)).toBe(1);
});
