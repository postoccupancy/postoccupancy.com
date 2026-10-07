import { expect, test, type WebSocketRoute } from '@playwright/test';
import { SampleRing } from '../src/lib/signals/sample-ring';

function batch(node: string, param: string, unit: string, value: number, start = 100_000_000, sequence = 0, count = 101, waveDivisor = 8, oscillate = param === 'rms') {
  return JSON.stringify({
    type: 'sample_batch', sendTimeUs: start + (count - 1) * 100_000,
    streams: [{ name: node, param, unit,
      samples: Array.from({ length: count }, (_, i) => [sequence + i, start + i * 100_000, oscillate ? value + Math.sin(i / waveDivisor) * 0.1 : value]),
    }],
  });
}

test('discovers channels, converts power, and shares one socket across routes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rf-signal-gain-osc/electric-sky/humidity', '0'));
  const sockets: WebSocketRoute[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
    socket.send(batch('electric-sky', 'rms', 'dbfs', -40, 70_000_000, 0, 401));
    socket.send(batch('indoor-sky', 'rms', 'dbfs', -42));
    socket.send(batch('electric-sky', 'temperature', 'celsius', 23.5));
    socket.send(batch('electric-sky', 'power', 'mw', 1250));
    socket.send(batch('electric-sky', 'light-level', 'lux', 120));
    socket.send(batch('indoor-sky', 'humidity', 'percent', 45));
    socket.send(batch('electric-sky', 'humidity', 'percent', 44));
    socket.send(batch('electric-sky', 'pressure', 'hpa', 1012));
    socket.send(batch('electric-sky', 'solar-power', 'mw', 800));
    socket.send(batch('indoor-sky', 'temperature', 'celsius', 22));
    socket.send(batch('indoor-sky', 'pressure', 'hpa', 1011));
    socket.send(batch('indoor-sky', 'power', 'mw', 900));
    socket.send('{broken json');
    socket.send(JSON.stringify({ type: 'sample_batch', streams: [null, { name: 'electric-sky', param: 'invalid', samples: [['bad', 1, 2]] }] }));
  });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText('23.5000 °C');
  await expect(page.getByRole('region', { name: 'Electric Sky Power', exact: true })).toContainText('1.2500 W');
  await expect(page.getByRole('region', { name: 'Electric Sky light level', exact: true })).toContainText('120.0000 lux');
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toContainText('45.0000 %');
  await expect(page.getByRole('region', { name: 'invalid', exact: true })).toHaveCount(0);
  const temperatureCard = page.getByRole('region', { name: 'Electric Sky Temperature', exact: true });
  await temperatureCard.getByRole('button', { name: 'Open settings for osc/electric-sky/temperature' }).click();
  await expect(temperatureCard.getByRole('paragraph').filter({ hasText: 'osc/electric-sky/temperature' })).toBeVisible();
  await expect(temperatureCard.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Electric Sky Humidity', exact: true })).not.toContainText('Gain 1×');
  await temperatureCard.getByRole('combobox', { name: 'MIDI channel' }).selectOption('3');
  await temperatureCard.getByRole('combobox', { name: 'CC' }).selectOption('21');
  await temperatureCard.getByRole('spinbutton', { name: 'MIN' }).fill('10');
  await temperatureCard.getByRole('spinbutton', { name: 'MIN' }).press('Enter');
  await temperatureCard.getByRole('spinbutton', { name: 'MAX' }).fill('35');
  await temperatureCard.getByRole('spinbutton', { name: 'MAX' }).press('Enter');
  const gain = temperatureCard.getByRole('slider', { name: 'Gain', exact: true });
  await gain.focus(); await gain.press('ArrowRight');
  await expect(temperatureCard.locator('[data-visualizer-surface="audio"] [data-viz="gainControl"]')).toHaveValue('3');
  const audio = temperatureCard.getByRole('button', { name: 'Start audio' });
  await expect(audio.locator('svg')).toBeVisible();
  await audio.click();
  await expect(temperatureCard.locator('[data-visualizer-surface="audio"] [data-viz="audio"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(temperatureCard.getByRole('button', { name: 'Pause audio' }).locator('svg')).toBeVisible();
  await temperatureCard.getByRole('button', { name: 'Pause audio' }).click();
  await expect(temperatureCard.locator('[data-visualizer-surface="audio"] [data-viz="audio"]')).toHaveAttribute('aria-pressed', 'false');
  await temperatureCard.getByRole('button', { name: 'Close settings for osc/electric-sky/temperature' }).click();
  await expect(temperatureCard).toContainText('MIDI Ch 3 · CC 21 · Min 10 · Max 35 · Gain 8×');
  const charts = page.getByRole('img', { name: /view · 10 second window/ });
  await expect(charts).toHaveCount(12);
  const cards = page.locator('section[aria-label]');
  await expect(cards.nth(0)).toHaveAttribute('aria-label', 'Electric Sky Microphone RMS');
  await expect(cards.nth(1)).toHaveAttribute('aria-label', 'Indoor Sky Microphone RMS');
  const nodeFilter = page.getByRole('combobox', { name: 'Node', exact: true });
  const typeFilter = page.getByRole('combobox', { name: 'Sensor type', exact: true });
  await expect(nodeFilter).toContainText('All nodes');
  await expect(typeFilter).toContainText('All sensor types');
  await nodeFilter.click();
  await page.getByRole('option', { name: /Indoor Sky/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toHaveCount(0);
  await nodeFilter.click();
  await page.getByRole('option', { name: /Indoor Sky/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('img', { name: /view · 10 second window/ })).toHaveCount(12);
  sockets[0].send(batch('electric-sky', 'rms', 'dbfs', -40, 110_100_000, 401));
  sockets[0].send(batch('indoor-sky', 'rms', 'dbfs', -42, 110_100_000, 101));
  for (const [node, param, unit, value] of [
    ['electric-sky', 'temperature', 'celsius', 23.5], ['electric-sky', 'power', 'mw', 1250], ['electric-sky', 'light-level', 'lux', 120],
    ['electric-sky', 'humidity', 'percent', 44], ['electric-sky', 'pressure', 'hpa', 1012], ['electric-sky', 'solar-power', 'mw', 800],
    ['indoor-sky', 'humidity', 'percent', 45], ['indoor-sky', 'temperature', 'celsius', 22], ['indoor-sky', 'pressure', 'hpa', 1011], ['indoor-sky', 'power', 'mw', 900],
  ] as const) sockets[0].send(batch(node, param, unit, value, 110_100_000, 101, 101, 8, true));
  const electricRmsSurface = page.getByRole('region', { name: 'Electric Sky Microphone RMS' }).locator('[data-visualizer-surface="compact"]');
  await expect(electricRmsSurface.getByRole('img')).toHaveAccessibleName(/waveform view/);
  await page.getByRole('button', { name: 'spectrogram', exact: true }).click();
  const compactSurfaces = page.locator('[data-visualizer-surface="compact"]');
  await expect(compactSurfaces).toHaveCount(12);
  const rmsCanvas = page.getByRole('region', { name: 'Electric Sky Microphone RMS' }).getByRole('img');
  const indoorRmsCanvas = page.getByRole('region', { name: 'Indoor Sky Microphone RMS' }).getByRole('img');
  const electricSpectrogram = await rmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  const indoorSpectrogram = await indoorRmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  sockets[0].send(batch('electric-sky', 'rms', 'dbfs', -40, 120_200_000, 502, 101, 2));
  sockets[0].send(batch('indoor-sky', 'rms', 'dbfs', -42, 120_200_000, 202, 101, 3));
  await expect.poll(() => rmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(electricSpectrogram);
  await expect.poll(() => indoorRmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(indoorSpectrogram);
  await page.getByRole('button', { name: 'spectrum', exact: true }).click();
  const spectrumBefore = await rmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  sockets[0].send(batch('electric-sky', 'rms', 'dbfs', -40, 130_300_000, 603, 101, 4));
  await expect.poll(() => rmsCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(spectrumBefore);
  await page.getByRole('button', { name: 'spectrogram', exact: true }).click();
  await expect(rmsCanvas).toHaveAccessibleName(/spectrogram view/);
  const aggregation = page.getByRole('slider', { name: 'Aggregation', exact: true });
  await aggregation.focus(); await aggregation.press('End');
  await expect(rmsCanvas).toHaveAccessibleName(/spectrogram view/);
  await aggregation.press('Home');
  await page.getByRole('button', { name: 'waveform', exact: true }).click();
  await expect(charts.first()).toHaveAccessibleName(/waveform view/);
  for (const view of ['spectrum', 'spectrogram', 'modulation', 'waveform']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    await expect(charts.first()).toHaveAccessibleName(new RegExp(`${view} view`));
  }
  const timeWindow = page.getByRole('slider', { name: 'Time window', exact: true });
  await timeWindow.focus(); await timeWindow.press('Home');
  await expect(page.getByText('0.001 s', { exact: true }).first()).toBeVisible();
  await timeWindow.press('End');
  await expect(page.getByText('60 s', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('native', { exact: true }).first()).toBeVisible();
  await aggregation.focus(); await aggregation.press('End');
  await expect(page.getByText('1.0 Hz', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const delay = page.getByRole('slider', { name: /Presentation delay/ });
  await delay.focus(); await delay.press('Home');
  await expect(delay).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByText(/0\.5s delay/)).toBeVisible();
  await page.getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Resident Frequency', exact: true }).click();
  await page.getByRole('link', { name: 'Signals', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toContainText(/44\.99\d{2} %/);
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText(/23\.49\d{2} °C/);
  expect(sockets).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
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
  ring.push({ seq: 0, t: 0, v: 1 });
  expect(ring.latest()?.v).toBe(1);
});
