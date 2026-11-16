import { expect, test, type WebSocketRoute } from '@playwright/test';
import { normalizeRouterUrl, ROUTER_URL_STORAGE_KEY, routerHttpOrigin } from '../src/lib/signals/router-url';

function sendSignals(socket: WebSocketRoute, hostname: string, value: number) {
  socket.send(JSON.stringify({ type: 'server_info', hostname, platform: 'linux', networkMode: 'ap' }));
  socket.send(JSON.stringify({ type: 'source_info', ip: '192.168.1.42', name: 'electric-sky', dashboard: '/electric-sky/' }));
  socket.send(JSON.stringify({ type: 'sample_batch', sendTimeUs: 110_000_000, streams: [
    { name: 'electric-sky', param: 'temperature', unit: 'celsius',
      samples: Array.from({ length: 101 }, (_, index) => [index, 100_000_000 + index * 100_000, value]) },
  ] }));
}

test('router addresses support LAN HTTPS, plain local WebSockets, and reject invalid endpoints', () => {
  expect(normalizeRouterUrl(' https://10.0.0.1:3000/ ')).toBe('wss://10.0.0.1:3000');
  expect(normalizeRouterUrl('http://adrian-pi.local:3000')).toBe('ws://adrian-pi.local:3000');
  expect(normalizeRouterUrl('https://[::1]:3000/')).toBe('wss://[::1]:3000');
  expect(routerHttpOrigin('wss://10.0.0.1:3000')).toBe('https://10.0.0.1:3000');
  expect(normalizeRouterUrl('wss://pi.local:3000/stream?channel=1')).toBe('wss://pi.local:3000/stream?channel=1');
  for (const address of ['10.0.0.1:3000', 'file:///tmp/router', 'https://user:password@pi.local', 'wss://pi.local/#fragment']) {
    expect(() => normalizeRouterUrl(address)).toThrow();
  }
  expect(() => normalizeRouterUrl('ws://pi.local:3000', 'https:')).toThrow(/secure router/);
});

test('switches to a LAN router, receives sensors across navigation and reload, then restores the default', async ({ page }) => {
  let publicConnections = 0;
  let localConnections = 0;
  await page.routeWebSocket('wss://rf.postoccupancy.com', socket => {
    publicConnections++;
    sendSignals(socket, 'public-router', 20);
  });
  await page.routeWebSocket('wss://10.0.0.1:3000', socket => {
    localConnections++;
    sendSignals(socket, 'lan-router', 26);
  });
  await page.goto('/interfaces/electric-sea');
  await expect(page.getByText('public-router (linux)')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Router address' }).fill('https://10.0.0.1:3000');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Connect to router', exact: true }).click()]);
  await expect(page.getByText('lan-router (linux)')).toBeVisible();
  await expect(page.getByRole('link', { name: /Modulation spectrum/ })).toHaveAttribute('href', 'https://10.0.0.1:3000/modulation-spectrum/');
  await expect(page.getByRole('link', { name: 'electric-sky', exact: true })).toHaveAttribute('href', '/nodes/indoor-sky');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Indoor Sky', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText('26.0000');
  expect(localConnections).toBe(1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText('26.0000');
  expect(localConnections).toBe(2);
  expect(publicConnections).toBe(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open connected router' })).toHaveAttribute('href', 'https://10.0.0.1:3000');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Use default router', exact: true }).click()]);
  await expect(page.getByRole('region', { name: 'Electric Sky Temperature', exact: true })).toContainText('20.0000');
  expect(publicConnections).toBe(2);
  expect(await page.evaluate(key => localStorage.getItem(key), ROUTER_URL_STORAGE_KEY)).toBeNull();
});

test('invalid input keeps the current connection and a corrupt saved address falls back to default', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, 'javascript:invalid'), ROUTER_URL_STORAGE_KEY);
  let connections = 0;
  await page.routeWebSocket('wss://rf.postoccupancy.com', socket => {
    connections++;
    sendSignals(socket, 'public-router', 20);
  });
  await page.goto('/interfaces/electric-sea');
  await expect(page.getByText('public-router (linux)')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Router address' }).fill('file:///router');
  await page.getByRole('button', { name: 'Connect to router', exact: true }).click();
  await expect(page.getByText('Use an HTTP or WebSocket address without credentials or a fragment.')).toBeVisible();
  expect(connections).toBe(1);
});
