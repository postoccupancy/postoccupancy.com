import { expect, test, type WebSocketRoute } from '@playwright/test';
import { welchPsd, spectrumPoints } from '../src/lib/visualizer/spectral-analysis';

const path = '/interfaces/spectral-visualizer';
const temperature = 'osc/electric-sky/temperature';
const humidity = 'osc/indoor-sky/humidity';
function batch(device: string, start = 100_000_000, sequence = 0) {
  const [, name, param] = device.split('/');
  return JSON.stringify({ type: 'sample_batch', sendTimeUs: start + 10_235_000,
    streams: [{ device, name, param, unit: 'units', samples: Array.from({ length: 2048 }, (_, i) => [sequence + i, start + i * 5000, Math.sin(2 * Math.PI * 10 * i / 200)]) }] });
}
function pcm(rate = 16000, bits = 16) {
  const count = 160, header = bits === 16 ? 32 : 36;
  const buffer = Buffer.alloc(header + (bits === 16 ? count * 2 : Math.ceil((count - 1) / 2)));
  buffer.write('ESAU'); buffer[4] = 1; buffer[5] = 1; buffer[6] = bits;
  buffer.writeBigUInt64LE(BigInt(1_000_000), 12); buffer.writeUInt32LE(rate, 20); buffer.writeUInt16LE(count, 24); buffer.writeUInt16LE(header, 26);
  if (bits === 16) for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.sin(i / 5) * 16000), header + 2 * i);
  return buffer;
}
function capabilities(socket: WebSocketRoute) {
  socket.send(JSON.stringify({ type: 'audio', device: 'pcm/electric-sky/audio', enabled: false }));
  socket.send(JSON.stringify({ type: 'audio', device: 'pcm/indoor-sky/audio', enabled: false }));
}

test('selects discovered signals, plots all views, and keeps query history on one socket', async ({ page }) => {
  const sockets: WebSocketRoute[] = [], sent: unknown[] = [], errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket); capabilities(socket); socket.send(batch(temperature)); socket.send(batch(humidity));
    socket.onMessage((message) => sent.push(JSON.parse(String(message))));
  });
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Spectral Visualizer', exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Signal', exact: true });
  await expect(selector).toHaveValue(temperature);
  sockets[0].send(batch(temperature));
  await expect(page.locator('[data-viz=sourceStats]')).toContainText('200.0 Hz');
  await expect(page.locator('[data-viz=shown]')).not.toHaveText('0');
  for (const name of ['spectrum', 'spectrogram', 'modulation', 'waveform']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
    if (name === 'spectrum') {
      await expect(page.getByRole('slider', { name: /FFT/ })).toBeVisible();
      await expect(page.locator('[data-viz=psdStats]')).toContainText('segments');
      await page.getByRole('checkbox', { name: 'centroid', exact: true }).check();
      await expect(page.locator('[data-viz=centroidValue]')).toContainText('Hz');
      // Confirm plotted pixels, not just changing text labels.
      await expect.poll(() => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240 && pixels[i + 1] > 180 && pixels[i + 2] < 180) count++;
        return count;
      })).toBeGreaterThan(10);
    }
    if (name === 'modulation') await page.getByRole('combobox', { name: 'palette' }).selectOption('magma');
  }
  await expect(page.getByRole('slider', { name: /FFT/ })).toBeHidden();
  await selector.selectOption(humidity);
  await expect(page).toHaveURL(new RegExp('device=osc%2Findoor-sky%2Fhumidity'));
  await expect(page.locator('[data-viz=shown]')).toHaveText('0');
  sockets[0].send(batch(temperature, 120_000_000, 2048));
  await expect(page.locator('[data-viz=shown]')).toHaveText('0');
  sockets[0].send(batch(humidity));
  await expect(page.locator('[data-viz=shown]')).not.toHaveText('0');
  await page.goBack(); await expect(selector).toHaveValue(temperature);
  await page.goForward(); await expect(selector).toHaveValue(humidity);
  expect(sockets).toHaveLength(1);
  expect(sent).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('switches PCM and derived subscriptions, gates old packets, and resubscribes after reconnect', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  const commands: Record<string, unknown>[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket); capabilities(socket);
    socket.onMessage((message) => {
      const command = JSON.parse(String(message)); commands.push(command);
      if (command.type === 'pcm_subscribe' && command.enabled === false) socket.send(JSON.stringify({ type: 'pcm_stream', device: command.device }));
    });
  });
  await page.goto(`${path}?device=pcm%2Felectric-sky%2Faudio`);
  await expect.poll(() => commands.filter((m) => m.type === 'pcm_subscribe' && m.enabled)).toHaveLength(1);
  sockets[0].send(pcm()); // Data before subscription acknowledgment must be ignored.
  await expect(page.locator('[data-viz=sourceStats]')).toHaveText('—');
  sockets[0].send(JSON.stringify({ type: 'pcm_stream', device: 'pcm/electric-sky/audio', available: true }));
  sockets[0].send(Buffer.from([0, 1])); sockets[0].send(pcm());
  await expect(page.locator('[data-viz=sourceStats]')).toContainText('16000.0 Hz');
  await page.getByRole('combobox', { name: 'Signal', exact: true }).selectOption('pcm/indoor-sky/audio');
  await expect.poll(() => commands).toContainEqual(expect.objectContaining({ type: 'pcm_subscribe', device: 'pcm/electric-sky/audio', enabled: false }));
  sockets[0].send(pcm());
  await expect(page.locator('[data-viz=sourceStats]')).toHaveText('—');
  sockets[0].send(JSON.stringify({ type: 'pcm_stream', device: 'pcm/indoor-sky/audio', available: true }));
  sockets[0].send(pcm(8000, 4));
  await expect(page.locator('[data-viz=sourceStats]')).toContainText('8000.0 Hz');
  sockets[0].close();
  await expect.poll(() => sockets.length).toBe(2);
  await expect.poll(() => commands.filter((m) => m.type === 'pcm_subscribe' && m.device === 'pcm/indoor-sky/audio' && m.enabled)).toHaveLength(2);
  const derived = 'osc/electric-sky/bass';
  sockets[1].send(JSON.stringify({ type: 'osc', device: derived, value: 0.2 }));
  await page.getByRole('combobox', { name: 'Signal', exact: true }).selectOption(derived);
  await expect.poll(() => commands).toContainEqual(expect.objectContaining({ type: 'pcm_analysis_subscribe', device: 'pcm/electric-sky/audio', enabled: true }));
  await page.getByRole('navigation').getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await expect.poll(() => commands).toContainEqual(expect.objectContaining({ type: 'pcm_analysis_subscribe', device: 'pcm/electric-sky/audio', enabled: false }));
  expect(commands.filter((m) => m.type === 'pcm_source_enable' && m.enabled === false)).toEqual([]);
});

test('retains an unknown deep link, discovers MIDI, and resets after a device reboot', async ({ page }) => {
  let socket!: WebSocketRoute;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (ws) => { socket = ws; });
  await page.goto(`${path}?device=${encodeURIComponent(temperature)}`);
  await expect(page.getByRole('combobox', { name: 'Signal', exact: true })).toHaveValue(temperature);
  await expect(page.locator('[data-viz=connection]')).toHaveText('connected');
  socket.send(batch(temperature));
  await expect(page.locator('[data-viz=shown]')).not.toHaveText('0');
  socket.send(batch(temperature, 1_000_000));
  await expect(page.locator('[data-viz=missing]')).toHaveText('0');
  socket.send(JSON.stringify({ type: 'sample_batch', streams: [null, { device: temperature, samples: [[0, 'bad', null]] }] }));
  socket.send(JSON.stringify({ type: 'midi', device: 'Keyboard', msgType: 'cc', channel: 1, cc: 7, value: 64 }));
  const selector = page.getByRole('combobox', { name: 'Signal', exact: true });
  await selector.selectOption('Keyboard/ch1/cc7');
  socket.send(JSON.stringify({ type: 'midi', device: 'Keyboard', msgType: 'cc', channel: 1, cc: 7, value: 127 }));
  await expect(page.locator('[data-viz=shown]')).toContainText('1 ·');
  expect(errors).toEqual([]);
});

test('reused Welch analysis locates a known tone and preserves its power', () => {
  const samples = Float64Array.from({ length: 8192 }, (_, i) => Math.sin(2 * Math.PI * 64 * i / 1024));
  const spectrum = welchPsd(samples, 1024, 1024, 8)!;
  const points = spectrumPoints(spectrum);
  const peak = points.reduce((a, b) => a.power > b.power ? a : b);
  expect(peak.frequency).toBe(64);
  const power = spectrum.power.reduce((sum: number, value: number) => sum + value, 0) * spectrum.resolution;
  expect(power).toBeCloseTo(0.5, 2);
});

test('starts audio only on request and closes processing when the signal changes', async ({ page }) => {
  // Simulate Web Audio without a hardware destination. Compile the actual
  // worklet module against a fake processor so syntax/registration still run.
  await page.addInitScript(() => {
    const state = { created: 0, closed: 0, samples: 0, registered: [] as string[] };
    Object.assign(window, { audioTest: state });
    const processors = new Map<string, new () => { port: { onmessage: (e: { data: unknown }) => void; postMessage: (data: unknown) => void } }>();
    class FakeNode {
      gain = { value: 0, setTargetAtTime: () => {} };
      frequency = { value: 0, setTargetAtTime: () => {} };
      Q = { value: 0 };
      fftSize = 2048;
      connect(node: unknown) { return node; }
      disconnect() {}
      getFloatTimeDomainData(array: Float32Array) { array.fill(0); }
    }
    class Context {
      currentTime = 0; sampleRate = 48000; destination = {};
      constructor() { state.created++; }
      audioWorklet = { addModule: async (url: string) => {
        const code = await (await fetch(url)).text();
        class Processor { port = { onmessage: null, postMessage: () => {} }; }
        new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', code)(Processor, (name: string, processor: typeof Processor) => { processors.set(name, processor as unknown as NonNullable<ReturnType<typeof processors.get>>); state.registered.push(name); }, 48000);
      } };
      createBiquadFilter() { return new FakeNode(); }
      createGain() { return new FakeNode(); }
      createAnalyser() { return new FakeNode(); }
      async resume() {}
      async close() { state.closed++; }
    }
    class Worklet extends FakeNode {
      port: { postMessage: (data: { samples?: Float32Array }) => void; onmessage: unknown; close: () => void };
      constructor(context: unknown, name: string) {
        super(); const Processor = processors.get(name)!; const processor = new Processor();
        this.port = { onmessage: null, close: () => {}, postMessage: (data) => { state.samples += data.samples?.length || 0; processor.port.onmessage({ data }); } };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
    Object.defineProperty(window, 'AudioWorkletNode', { value: Worklet });
  });
  let socket!: WebSocketRoute;
  await page.routeWebSocket('wss://rf.postoccupancy.com', (ws) => { socket = ws; });
  await page.goto(`${path}?device=${encodeURIComponent(temperature)}`);
  const state = () => page.evaluate(() => (window as unknown as { audioTest: { created: number; closed: number; samples: number; registered: string[] } }).audioTest);
  await expect(page.locator('[data-viz=connection]')).toHaveText('connected');
  socket.send(batch(temperature)); socket.send(batch(humidity));
  expect((await state()).created).toBe(0);
  await page.getByRole('button', { name: 'start audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'stop audio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  socket.send(batch(temperature, 120_000_000, 2048));
  await expect.poll(async () => (await state()).samples).toBeGreaterThan(0);
  expect((await state()).registered).toEqual(['low-rate-source', 'signal-meter']);
  await page.getByRole('combobox', { name: 'Signal', exact: true }).selectOption(humidity);
  await expect.poll(async () => (await state()).closed).toBe(1);
  await expect(page.getByRole('button', { name: 'start audio', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
