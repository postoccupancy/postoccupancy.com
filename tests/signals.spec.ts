import { expect, test, type WebSocketRoute } from '@playwright/test';
import { aggregateWaveformSamples } from '../src/components/signals/scope-plot';
import { SampleRing } from '../src/lib/signals/sample-ring';
import { analyzePreparedSpectrogramColumn, analyzeSpectrogramBackfill, analyzeSpectrogramColumn, analyzeSpectrumRing, analyzeSpectrumSamples, prepareSpectrogramTimeline, prepareSpectrumSamples, prepareSpectrumSamplesAt, spectrogramHopUs } from '../src/lib/signals/spectrum-analysis';
import { defaultSpectralSettings } from '../src/lib/signals/spectral-settings';
import { frequencyPosition } from '../src/lib/visualizer/frequency-position';

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
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Signals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Spectral Analysis' })).toBeVisible();
  const fftSize = page.getByRole('combobox', { name: 'FFT size' });
  const welchSegments = page.getByRole('combobox', { name: 'Welch segments' });
  const bandAverage = page.getByRole('switch', { name: 'Band averaging' });
  const spectrumMode = page.getByRole('combobox', { name: 'Spectrum mode' });
  const frequencyScale = page.getByRole('combobox', { name: 'Frequency scale' });
  await expect(fftSize).toHaveText('Auto');
  await expect(welchSegments).toHaveText('4');
  await expect(bandAverage).toBeChecked();
  await expect(spectrumMode).toHaveText('Relative');
  await expect(frequencyScale).toHaveText('Log');
  await expect(page.getByText('Welch overlap: 50% (fixed)')).toBeVisible();
  await fftSize.click(); await page.getByRole('option', { name: '512', exact: true }).click();
  await welchSegments.click(); await page.getByRole('option', { name: '1', exact: true }).click();
  await bandAverage.uncheck();
  await spectrumMode.click(); await page.getByRole('option', { name: 'Raw', exact: true }).click();
  await frequencyScale.click(); await page.getByRole('option', { name: 'Linear', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-requested-fft', '512');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-welch', '1');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-bands', 'false');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-mode', 'raw');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrum-frequency-scale', 'linear');
  await page.getByRole('button', { name: 'Spectrogram', exact: true }).click();
  await expect(page.getByRole('img', { name: /Spectrogram/ })).toHaveCount(10);
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-requested-fft', '512');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-welch', '1');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-bands', 'false');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-mode', 'raw');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-frequency-scale', 'linear');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-hop-ms', '100');
  await expect(Number(await temperature.getByRole('img').getAttribute('data-spectrogram-columns'))).toBeGreaterThan(0);
  const firstColumn = await temperature.getByRole('img').getAttribute('data-spectrogram-first-time');
  await timeWindow.focus(); await timeWindow.press('ArrowLeft');
  await expect(timeWindow).toHaveValue('7');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-requested-fft', '512');
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-first-time', firstColumn!);
  await timeWindow.press('ArrowRight');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Signals', exact: true }).click();
  const spectrogramFft = page.getByRole('combobox', { name: 'FFT size' });
  await spectrogramFft.click(); await page.getByRole('option', { name: '256', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(temperature.getByRole('img')).toHaveAttribute('data-spectrogram-requested-fft', '256');
  await expect.poll(async () => Number(await temperature.getByRole('img').getAttribute('data-spectrogram-fft'))).toBeLessThanOrEqual(256);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Signals', exact: true }).click();
  await page.getByRole('combobox', { name: 'FFT size' }).click(); await page.getByRole('option', { name: '512', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await expect(timeWindow).toHaveValue('8');
  await expect(aggregation).toHaveValue('4');
  await expect(page.getByRole('img', { name: /Last 30 seconds\. Aggregation 100 ms · 10\.0 Hz/ })).toHaveCount(10);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General', exact: true }).click();
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

test('signals spectral configuration controls requested FFT, Welch, bands, and mode', () => {
  const samples = Array.from({ length: 5200 }, (_, index) => ({
    seq: index,
    t: index * 10_000,
    v: Math.sin(2 * Math.PI * 5 * index / 100),
  }));
  const fft512 = analyzeSpectrumSamples(samples, 0, 60, { ...defaultSpectralSettings, fftSize: 512 })!;
  expect(fft512.requestedFftSize).toBe(512);
  expect(fft512.fftLength).toBe(512);
  expect(fft512.fftDurationSeconds).toBeCloseTo(5.12);

  const fallback = analyzeSpectrumSamples(samples.slice(0, 600), 0, 10, { ...defaultSpectralSettings, fftSize: 2048 })!;
  expect(fallback.requestedFftSize).toBe(2048);
  expect(fallback.fftLength).toBe(512);

  const requestedWelch = analyzeSpectrumSamples(samples, 0, 60, { ...defaultSpectralSettings, welchSegments: 16 })!;
  expect(requestedWelch.welchSegmentCount).toBe(4);

  const bands = analyzeSpectrumSamples(samples, 0, 60, defaultSpectralSettings)!;
  const bins = analyzeSpectrumSamples(samples, 0, 60, { ...defaultSpectralSettings, bandAverage: false })!;
  expect(bands.points.length).toBeLessThan(bins.points.length);
  const raw = analyzeSpectrumSamples(samples, 0, 60, { ...defaultSpectralSettings, mode: 'raw' })!;
  expect(Object.hasOwn(bands.points[0], 'rawPower')).toBe(true);
  expect(Object.hasOwn(raw.points[0], 'rawPower')).toBe(false);
});

test('signals frequency scales use the visualizer positioning semantics', () => {
  expect(frequencyPosition(10, 1, 100, 'log')).toBeCloseTo(0.5);
  expect(frequencyPosition(10, 1, 100, 'linear')).toBeCloseTo(9 / 99);
  expect(frequencyPosition(10, 1, 100, 'expanded')).toBeCloseTo(Math.sqrt(9 / 99));
});

test('spectrogram columns are timestamp anchored, reuse Welch DSP, and locate a periodic peak', () => {
  const samples = Array.from({ length: 1201 }, (_, index) => ({
    seq: index,
    t: index * 10_000,
    v: Math.sin(2 * Math.PI * 5 * index / 100),
  }));
  const column = analyzeSpectrogramColumn(samples, 10_000_000, 0, { ...defaultSpectralSettings, fftSize: 512 })!;
  expect(column.timeUs).toBe(10_000_000);
  expect(column.fftLength).toBe(512);
  expect(column.welchSegmentCount).toBe(2);
  expect(column.fftDurationSeconds).toBeCloseTo(5.12);
  expect(Math.abs(column.peakFrequency - 5)).toBeLessThanOrEqual(column.resolution);
});

test('prepared spectrogram history matches single-column analysis and anchors Welch at each endpoint', () => {
  const samples = Array.from({ length: 6001 }, (_, index) => ({
    seq: index,
    t: index * 10_000,
    v: index < 5000
      ? Math.sin(2 * Math.PI * 3 * index / 100)
      : Math.sin(2 * Math.PI * 11 * index / 100),
  }));
  const settings = { ...defaultSpectralSettings, fftSize: 512 as const, welchSegments: 4 as const };
  const timeline = prepareSpectrogramTimeline(samples, 0)!;
  const prepared = analyzePreparedSpectrogramColumn(timeline, 60_000_000, settings)!;
  const legacyEntryPoint = analyzeSpectrogramColumn(samples, 60_000_000, 0, settings)!;
  expect(Math.abs(prepared.peakFrequency - 11)).toBeLessThanOrEqual(prepared.resolution);
  expect(prepared.points).toEqual(legacyEntryPoint.points);
  expect(prepared.welchSegmentCount).toBe(4);
});

test('spectrogram backfill prepares continuity once and preserves gaps and settings', () => {
  const first = Array.from({ length: 1001 }, (_, index) => ({ seq: index, t: index * 10_000, v: Math.sin(index / 10) }));
  const second = Array.from({ length: 1001 }, (_, index) => ({ seq: 1100 + index, t: 11_000_000 + index * 10_000, v: Math.sin(index / 10) }));
  const settings = { ...defaultSpectralSettings, fftSize: 256 as const, welchSegments: 2 as const, bandAverage: false, mode: 'raw' as const };
  const result = analyzeSpectrogramBackfill([...first, ...second], 8_000_000, 21_000_000, 100_000, 0, settings);
  expect(result.attemptedColumns).toBe(131);
  expect(result.columns.some((column) => column.timeUs > 10_000_000 && column.timeUs < 11_000_000)).toBe(false);
  expect(result.columns.at(-1)).toMatchObject({ fftLength: 256, welchSegmentCount: 2, requestedFftSize: 256 });
  expect(Object.hasOwn(result.columns.at(-1)!.points[0], 'rawPower')).toBe(false);
});

test('spectrogram never crosses gaps or substitutes an older run at a newer timestamp', () => {
  const older = Array.from({ length: 600 }, (_, index) => ({ seq: index, t: index * 10_000, v: 1 }));
  const short = Array.from({ length: 7 }, (_, index) => ({ seq: 700 + index, t: 7_000_000 + index * 10_000, v: 2 }));
  expect(prepareSpectrumSamplesAt([...older, ...short], 0, 7_060_000)).toBeNull();
  expect(analyzeSpectrogramColumn([...older, ...short], 7_060_000, 0)).toBeNull();

  const usable = [...short, { seq: 707, t: 7_070_000, v: 2 }];
  const prepared = prepareSpectrumSamplesAt([...older, ...usable], 0, 7_070_000)!;
  expect(prepared.observations).toHaveLength(8);
  expect(prepared.observations.every((observation) => observation.v === 2)).toBe(true);
  expect(prepared.fftLength).toBe(8);
  expect(prepareSpectrumSamplesAt([...older, ...usable], 0, 7_200_000)).toBeNull();
});

test('spectrogram aggregation preserves empty buckets and hop policy follows aggregation', () => {
  const samples = [
    { seq: 0, t: 10_000, v: 1 }, { seq: 1, t: 90_000, v: 3 },
    { seq: 2, t: 110_000, v: 5 }, { seq: 3, t: 190_000, v: 7 },
    ...Array.from({ length: 8 }, (_, index) => ({ seq: 10 + index, t: 300_000 + index * 100_000 + 10_000, v: index })),
  ];
  expect(prepareSpectrumSamplesAt(samples, 100, 250_000)).toBeNull();
  expect(spectrogramHopUs(0)).toBe(100_000);
  expect(spectrogramHopUs(100)).toBe(100_000);
  expect(spectrogramHopUs(250)).toBe(250_000);
  expect(spectrogramHopUs(1000)).toBe(1_000_000);
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
