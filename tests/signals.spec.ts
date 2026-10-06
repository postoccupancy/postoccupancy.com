import { expect, test, type WebSocketRoute } from '@playwright/test';
import { SampleRing } from '../src/lib/signals/sample-ring';

function batch(node: string, param: string, unit: string, value: number, start = 100_000_000, sequence = 0) {
  return JSON.stringify({
    type: 'sample_batch', sendTimeUs: start + 10_000_000,
    streams: [{ name: node, param, unit,
      samples: Array.from({ length: 101 }, (_, i) => [sequence + i, start + i * 100_000, value]),
    }],
  });
}

test('discovers channels, converts power, and shares one socket across routes', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket);
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
  const charts = page.getByRole('img', { name: /view · 10 second window/ });
  await expect(charts).toHaveCount(4);
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
  const aggregation = page.getByRole('slider', { name: 'Aggregation', exact: true });
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
