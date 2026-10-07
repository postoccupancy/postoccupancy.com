import { expect, test, type WebSocketRoute } from '@playwright/test';
import { aggregateWaveformSamples } from '../src/components/signals/scope-plot';
import { SampleRing } from '../src/lib/signals/sample-ring';
import { analyzeSpectrumRing, analyzeSpectrumSamples, prepareSpectrumSamples } from '../src/lib/signals/spectrum-analysis';

function batch(node: string, param: string, unit: string, value: number, start = 100_000_000, sequence = 0) {
  return JSON.stringify({
    type: 'sample_batch', sendTimeUs: start + 10_000_000,
    streams: [{ name: node, param, unit,
      samples: Array.from({ length: 101 }, (_, i) => [sequence + i, start + i * 100_000, value]),
    }],
  });
}

function periodicBatch(node: string, param: string, unit: string, frequency = 5, start = 100_000_000) {
  const samples = Array.from({ length: 1201 }, (_, index) => [index, start + index * 10_000, Math.sin(2 * Math.PI * frequency * index / 100)]);
  return JSON.stringify({ type: 'sample_batch', sendTimeUs: start + 12_000_000, streams: [{ name: node, param, unit, samples }] });
}

test('discovers channels, converts power, and shares one socket across routes', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    socket.send(periodicBatch('electric-sky', 'temperature', 'celsius'));
    socket.send(periodicBatch('electric-sky', 'humidity', 'percent'));
    socket.send(periodicBatch('electric-sky', 'pressure', 'hpa'));
    socket.send(periodicBatch('electric-sky', 'rms', 'dbfs'));
    socket.send(periodicBatch('electric-sky', 'power', 'mw'));
    socket.send(periodicBatch('electric-sky', 'solar-power', 'mw'));
    socket.send(batch('electric-sky', 'solar-voltage', 'volts', 5, 102_000_000));
    socket.send(batch('electric-sky', 'solar-current', 'ma', 150, 102_000_000));
    socket.send(periodicBatch('indoor-sky', 'temperature', 'celsius'));
    socket.send(periodicBatch('indoor-sky', 'humidity', 'percent'));
    socket.send(periodicBatch('indoor-sky', 'pressure', 'hpa'));
    socket.send(periodicBatch('indoor-sky', 'rms', 'dbfs'));
    socket.send('{broken json');
    socket.send(JSON.stringify({ type: 'sample_batch', streams: [null, { name: 'electric-sky', param: 'invalid', samples: [['bad', 1, 2]] }] }));
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Electric Sky Power', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Electric Sky Solar input power', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: /Solar voltage/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Solar current/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'invalid', exact: true })).toHaveCount(0);
  const temperature = page.getByRole('region', { name: 'Electric Sky Temperature', exact: true });
  await expect(page.getByRole('button', { name: 'Waveform', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const timeWindow = page.getByRole('slider', { name: 'Time Window', exact: true });
  const aggregation = page.getByRole('slider', { name: 'Aggregation', exact: true });
  await expect(timeWindow).toHaveValue('7');
  await expect(aggregation).toHaveValue('0');
  await expect(page.getByRole('img', { name: /Last 10 seconds\. Aggregation Off/ })).toHaveCount(10);
  await timeWindow.focus(); await timeWindow.press('ArrowRight');
  await aggregation.focus();
  for (let index = 0; index < 4; index++) await aggregation.press('ArrowRight');
  await expect(timeWindow).toHaveValue('8');
  await expect(page.getByRole('img', { name: /Last 30 seconds\. Aggregation 100 ms · 10\.0 Hz/ })).toHaveCount(10);
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await expect(page.getByRole('img', { name: /Spectrum/ })).toHaveCount(10);
  await expect(page.locator('canvas[data-spectrum-rate="10"]')).toHaveCount(10);
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-rate', '10');
  await page.getByRole('button', { name: 'Spectrogram', exact: true }).click();
  await expect(page.getByRole('img', { name: /spectrogram placeholder/ })).toHaveCount(10);
  await expect(temperature.getByRole('img')).toHaveAccessibleName('Electric Sky Temperature spectrogram placeholder');
  await expect(temperature).toContainText('Spectrogram coming soon');
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await expect(timeWindow).toHaveValue('8');
  await expect(aggregation).toHaveValue('4');
  await expect(page.getByRole('img', { name: /Last 30 seconds\. Aggregation 100 ms · 10\.0 Hz/ })).toHaveCount(10);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const delay = page.getByRole('slider', { name: /Presentation delay/ });
  await delay.focus(); await delay.press('Home');
  await expect(delay).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByText(/0\.5s delay/)).toBeVisible();
  await page.getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Resident Frequency', exact: true }).click();
  await page.getByRole('link', { name: 'Signals', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toBeVisible();
  expect(sockets).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('waveform aggregation averages fixed buckets and leaves empty buckets absent', () => {
  const observations = aggregateWaveformSamples([
    { t: 10_000, v: 1 },
    { t: 90_000, v: 3 },
    { t: 110_000, v: 5 },
    { t: 190_000, v: 7 },
    { t: 310_000, v: 9 },
  ], 100_000);

  expect(observations).toEqual([
    { bucket: 0, t: 50_000, v: 2 },
    { bucket: 1, t: 150_000, v: 6 },
    { bucket: 3, t: 350_000, v: 9 },
  ]);
});

test('spectrum selects one recent contiguous run without crossing native or aggregate gaps', () => {
  const older = Array.from({ length: 20 }, (_, index) => ({ seq: index, t: index * 10_000, v: 1 }));
  const newer = Array.from({ length: 10 }, (_, index) => ({ seq: 30 + index, t: 300_000 + index * 10_000, v: 2 }));
  const native = prepareSpectrumSamples([...older, ...newer], 0)!;
  expect(native.observations).toHaveLength(10);
  expect(native.observations.every((sample) => sample.v === 2)).toBe(true);
  expect(native.fftLength).toBe(8);

  const fixed = prepareSpectrumSamples([
    ...Array.from({ length: 10 }, (_, index) => ({ seq: index, t: index * 10_000 + 1000, v: 1 })),
    ...Array.from({ length: 8 }, (_, index) => ({ seq: 20 + index, t: (index + 11) * 10_000 + 1000, v: 3 })),
  ], 10)!;
  expect(fixed.observations).toHaveLength(8);
  expect(fixed.observations.every((sample) => sample.v === 3)).toBe(true);
});

test('spectrum falls back to the newest usable run and reports insufficient short data', () => {
  const usable = Array.from({ length: 20 }, (_, index) => ({ seq: index, t: index * 10_000, v: index }));
  const short = Array.from({ length: 7 }, (_, index) => ({ seq: 30 + index, t: 300_000 + index * 10_000, v: 100 + index }));
  const selected = prepareSpectrumSamples([...usable, ...short], 0)!;
  expect(selected.observations).toHaveLength(20);
  expect(selected.fftLength).toBe(16);
  expect(prepareSpectrumSamples(short, 0)).toBeNull();
});

test('signals spectrum reuses Welch analysis and locates a periodic peak', () => {
  const samples = Array.from({ length: 5200 }, (_, index) => ({
    seq: index,
    t: index * 10_000,
    v: Math.sin(2 * Math.PI * 5 * index / 100),
  }));
  const spectrum = analyzeSpectrumSamples(samples, 0, 60)!;
  expect(spectrum.fftLength).toBe(2048);
  expect(spectrum.welchSegmentCount).toBe(4);
  expect(spectrum.peakFrequency).toBeCloseTo(5, 1);

  const ring = new SampleRing();
  for (const sample of samples.slice(0, 1201)) ring.push({ ...sample, t: sample.t + 100_000_000 });
  const buffered = analyzeSpectrumRing(ring, 76_000_000, 106_000_000, 100, 30)!;
  expect(buffered.effectiveSampleRate).toBe(10);
});

test('shows stale data, reconnects, and accepts a device clock reset', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    socket.send(batch('indoor-sky', 'temperature', 'celsius', 21));
  });
  await page.goto('/');
  const temperature = page.getByRole('region', { name: 'Indoor Sky Temperature', exact: true });
  await expect(temperature).toContainText('21.0000 °C');
  await expect(page.getByRole('status', { name: 'Connection status' })).toContainText('signal data stale', { timeout: 8000 });
  sockets[0].send(batch('indoor-sky', 'temperature', 'celsius', 22, 1_000_000));
  await expect(temperature).toContainText('22.0000 °C');
  await expect(page.getByRole('status', { name: 'Connection status' })).toHaveText('Live');
  sockets[0].close();
  await expect.poll(() => sockets.length).toBe(2);
  await expect(temperature).toContainText('21.0000 °C');
});

test('sample rings stay bounded and do not duplicate or reorder samples', () => {
  const ring = new SampleRing();
  for (let seq = 0; seq < 30_000; seq++) ring.push({ seq, t: seq * 1000, v: seq });
  const values: number[] = [];
  ring.visitRange(0, Infinity, (sample) => values.push(sample.v));
  expect(values).toHaveLength(25_000);
  expect(values[0]).toBe(5000);
  ring.push({ seq: 20, t: 20_000, v: -1 });
  expect(ring.latest()?.v).toBe(29_999);
  ring.clear();
  for (let seq = 0; seq <= 70; seq++) ring.push({ seq, t: seq * 1_000_000, v: seq });
  const retained: number[] = [];
  ring.visitRange(0, Infinity, (sample) => retained.push(sample.v));
  expect(retained).toHaveLength(71);
  ring.push({ seq: 71, t: 71_000_000, v: 71 });
  const trimmed: number[] = [];
  ring.visitRange(0, Infinity, (sample) => trimmed.push(sample.v));
  expect(trimmed[0]).toBe(1);
  ring.clear();
  ring.push({ seq: 0, t: 0, v: 1 });
  expect(ring.latest()?.v).toBe(1);
});
