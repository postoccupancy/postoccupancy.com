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
  await page.goto('/nodes/electric-sky');
  await expect(page.getByRole('region', { name: 'Temperature', exact: true })).toContainText('23.5000 °C');
  await expect(page.getByRole('region', { name: 'Power', exact: true })).toContainText('1.2500 W');
  await expect(page.getByRole('region', { name: 'light level', exact: true })).toContainText('120.0000 lux');
  await expect(page.getByRole('region', { name: 'invalid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Humidity', exact: true })).toHaveCount(0);
  const delay = page.getByRole('slider', { name: /Presentation delay/ });
  await delay.focus(); await delay.press('Home');
  await expect(delay).toHaveValue('0.5');
  await page.getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await page.getByRole('link', { name: 'Resident Frequency', exact: true }).click();
  await page.getByRole('link', { name: 'Indoor Sky', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Humidity', exact: true })).toContainText('45.0000 %');
  await expect(page.getByRole('region', { name: 'Temperature', exact: true })).toHaveCount(0);
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
  await page.goto('/nodes/indoor-sky');
  const temperature = page.getByRole('region', { name: 'Temperature', exact: true });
  await expect(temperature).toContainText('21.0000 °C');
  await expect(page.getByRole('status', { name: 'Connection status' })).toContainText('node data stale', { timeout: 8000 });
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
