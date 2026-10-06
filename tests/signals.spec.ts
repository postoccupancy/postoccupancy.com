import { expect, test, type WebSocketRoute } from '@playwright/test';
import { SampleRing } from '../src/lib/signals/sample-ring';

function batch(node: string, param: string, unit: string, value: number, start = 100_000_000, sequence = 0, count = 101) {
  return JSON.stringify({
    type: 'sample_batch', sendTimeUs: start + (count - 1) * 100_000,
    streams: [{ name: node, param, unit,
      samples: Array.from({ length: count }, (_, i) => [sequence + i, start + i * 100_000, param === 'rms' ? value + Math.sin(i / 8) * 0.1 : value]),
    }],
  });
}

test('discovers channels, converts power, and shares one socket across routes', async ({ page }) => {
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
  await temperatureCard.getByRole('combobox', { name: 'MIDI channel' }).selectOption('3');
  await temperatureCard.getByRole('combobox', { name: 'CC' }).selectOption('21');
  await temperatureCard.getByRole('spinbutton', { name: 'MIN' }).fill('10');
  await temperatureCard.getByRole('spinbutton', { name: 'MIN' }).press('Enter');
  await temperatureCard.getByRole('spinbutton', { name: 'MAX' }).fill('35');
  await temperatureCard.getByRole('spinbutton', { name: 'MAX' }).press('Enter');
  const gain = temperatureCard.getByRole('slider', { name: 'Gain', exact: true });
  await gain.focus(); await gain.press('ArrowRight');
  await expect(temperatureCard.locator('[data-viz="gainControl"]')).toHaveValue('3');
  const audio = temperatureCard.getByRole('button', { name: 'Start audio' });
  await expect(audio.locator('svg')).toBeVisible();
  await audio.click();
  await expect(temperatureCard.locator('[data-viz="audio"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(temperatureCard.getByRole('button', { name: 'Pause audio' }).locator('svg')).toBeVisible();
  await temperatureCard.getByRole('button', { name: 'Pause audio' }).click();
  await expect(temperatureCard.locator('[data-viz="audio"]')).toHaveAttribute('aria-pressed', 'false');
  await temperatureCard.getByRole('button', { name: 'Close settings for osc/electric-sky/temperature' }).click();
  await expect(temperatureCard).toContainText('MIDI Ch 3 · CC 21 · Min 10 · Max 35 · Gain 8×');
  const charts = page.getByRole('img', { name: /view · 10 second window/ });
  await expect(charts).toHaveCount(6);
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
  await page.getByRole('button', { name: 'spectrogram', exact: true }).click();
  const spectrogramMetrics = () => page.getByRole('region', { name: 'Electric Sky Microphone RMS' }).getByRole('img').evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')!;
    const y = Math.floor(canvas.height * 0.6);
    const pixels = context.getImageData(0, y, canvas.width, 1).data;
    let filled = 0, blankRun = 0, longestBlankRun = 0, firstFilled = -1, lastFilled = -1;
    for (let x = 0; x < canvas.width; x++) {
      const offset = x * 4;
      const colored = pixels[offset] < 230 || pixels[offset + 1] < 230 || pixels[offset + 2] < 230;
      if (colored) { filled++; firstFilled = firstFilled < 0 ? x : firstFilled; lastFilled = x; }
    }
    for (let x = firstFilled; x <= lastFilled; x++) {
      const offset = x * 4;
      const colored = pixels[offset] < 230 || pixels[offset + 1] < 230 || pixels[offset + 2] < 230;
      if (colored) blankRun = 0; else { blankRun++; longestBlankRun = Math.max(longestBlankRun, blankRun); }
    }
    return { filledFraction: filled / canvas.width, longestBlankFraction: longestBlankRun / canvas.width };
  });
  await expect.poll(async () => (await spectrogramMetrics()).filledFraction).toBeGreaterThan(0.8);
  await expect.poll(async () => (await spectrogramMetrics()).longestBlankFraction).toBeLessThan(0.03);
  const aggregation = page.getByRole('slider', { name: 'Aggregation', exact: true });
  await aggregation.focus(); await aggregation.press('End');
  await expect.poll(async () => (await spectrogramMetrics()).filledFraction).toBeGreaterThan(0.8);
  await expect.poll(async () => (await spectrogramMetrics()).longestBlankFraction).toBeLessThan(0.03);
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
  await expect(page.getByRole('region', { name: 'Indoor Sky Humidity', exact: true })).toContainText('45.0000 %');
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText('23.5000 °C');
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
