import { expect, test, type WebSocketRoute } from '@playwright/test';

function handshake(socket: WebSocketRoute, hostname = 'adrian-pi') {
  for (const message of [
    { type: 'server_info', hostname, platform: 'linux', networkMode: 'wifi', networkSsid: 'Studio' },
    { type: 'source_info', ip: '192.168.1.42', name: 'electric-sky', dashboard: '/electric-sky/' },
    { type: 'audio', device: 'pcm/electric-sky/audio', source: '192.168.1.42', enabled: false, available: true, sampleRate: 16000 },
    { type: 'client_info', ip: '203.0.113.10', tabCount: 1, oscUdpAvailable: false, oscUdpReason: 'Connect on LAN or VPN to enable' },
    { type: 'client_count', count: 3, tabCount: 1, allClients: [] },
  ]) socket.send(JSON.stringify(message));
}
const signal = { type: 'osc', device: 'osc/electric-sky/temperature', source: '192.168.1.42', value: 25, min: 0, max: 50 };

test('replays router metadata after navigation, discovers signals, and acknowledges audio controls', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  const sent: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => {
    sockets.push(socket); handshake(socket);
    socket.onMessage((raw) => sent.push(JSON.parse(String(raw))));
  });
  await page.goto('/');
  await expect.poll(() => sockets.length).toBe(1);
  await page.getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await expect(page.getByText('adrian-pi (linux)')).toBeVisible();
  await expect(page.getByText('WiFi: Studio · 3 client(s)')).toBeVisible();
  await expect(page.getByText('Web tunnel · 1 tab(s)')).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText('Disabled');
  const audio = page.getByRole('button', { name: 'pcm/electric-sky/audio output' });
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  await audio.click();
  await expect.poll(() => sent.find((item) => item.type === 'pcm_source_enable')).toEqual({ type: 'pcm_source_enable', device: 'pcm/electric-sky/audio', enabled: true, page: '/hubs/electric-sea' });
  await expect(audio).toHaveAttribute('aria-pressed', 'false');
  sockets[0].send(JSON.stringify({ type: 'audio', device: 'pcm/electric-sky/audio', source: signal.source, enabled: true, available: true, sampleRate: 16000 }));
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  sockets[0].send(JSON.stringify({ type: 'signal_batch', signals: [signal, null] }));
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: signal.device, exact: true }) });
  await expect(row).toContainText('25.0000');
  await expect(row).toContainText('64');
  const cc = page.getByRole('spinbutton', { name: `${signal.device} cc`, exact: true });
  await cc.fill('0'); await cc.press('Enter');
  const channel = page.getByRole('spinbutton', { name: `${signal.device} channel` });
  await channel.fill('3'); await channel.press('Enter');
  await page.getByRole('button', { name: `${signal.device} output` }).click();
  await expect(page.getByRole('link', { name: `View ${signal.device}` })).toHaveAttribute('href', 'https://rf.postoccupancy.com/visualizer/?device=osc%2Felectric-sky%2Ftemperature');
  await page.getByRole('link', { name: 'Indoor Sky', exact: true }).click();
  await page.getByRole('link', { name: 'Electric Sea', exact: true }).click();
  await expect(audio).toHaveAttribute('aria-pressed', 'true');
  sockets[0].send(JSON.stringify(signal));
  await expect(cc).toHaveValue('0');
  await expect(channel).toHaveValue('3');
  await expect(page.getByRole('button', { name: `${signal.device} output` })).toHaveAttribute('aria-pressed', 'false');
  expect(sockets).toHaveLength(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('refreshes metadata and capabilities after reconnect and presents USB batches', async ({ page }) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (socket) => { sockets.push(socket); handshake(socket, `pi-${sockets.length}`); });
  await page.goto('/hubs/electric-sea');
  await expect(page.getByText('pi-1 (linux)')).toBeVisible();
  sockets[0].send(JSON.stringify({ type: 'sample_batch', source: signal.source, transport: 'usb', sendTimeUs: 1_000_000,
    streams: [{ device: signal.device, name: 'electric-sky', param: 'temperature', samples: [[0, 1_000_000, 23.4]] }] }));
  await expect(page.getByRole('cell', { name: '23.4000', exact: true })).toBeVisible();
  sockets[0].close();
  await expect.poll(() => sockets.length).toBe(2);
  await expect(page.getByText('pi-2 (linux)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'pcm/electric-sky/audio output' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: signal.device })).toHaveCount(0);
});

test('maps MIDI, prevents port feedback, forwards input, and releases ports on navigation', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { sent: [] as number[][], requests: 0, closed: 0 };
    const input = { id: 'in', name: 'Test bus', onmidimessage: null as null | ((event: { data: Uint8Array }) => void), close: async () => { state.closed++; } };
    const output = { id: 'out', name: 'Test bus', connection: 'closed', open: async () => { output.connection = 'open'; return output; }, close: async () => { output.connection = 'closed'; state.closed++; }, send: (bytes: number[]) => state.sent.push([...bytes]) };
    Object.assign(window, { midiTest: { state, input } });
    Object.defineProperty(navigator, 'requestMIDIAccess', { value: async () => { state.requests++; return { inputs: new Map([['in', input]]), outputs: new Map([['out', output]]), onstatechange: null }; } });
  });
  let socket!: WebSocketRoute;
  const sent: Record<string, unknown>[] = [];
  await page.routeWebSocket('wss://rf.postoccupancy.com', (ws) => { socket = ws; handshake(ws); ws.onMessage((raw) => sent.push(JSON.parse(String(raw)))); });
  await page.goto('/hubs/electric-sea');
  await page.getByRole('button', { name: 'Enable MIDI', exact: true }).click();
  await page.getByRole('button', { name: 'Send to Test bus', exact: true }).click();
  socket.send(JSON.stringify(signal));
  for (const [field, value] of [['channel', '2'], ['cc', '0']]) {
    const input = page.getByRole('spinbutton', { name: `${signal.device} ${field}`, exact: true });
    await input.fill(value); await input.press('Enter');
  }
  socket.send(JSON.stringify(signal));
  const midiState = () => page.evaluate(() => (window as unknown as { midiTest: { state: { sent: number[][]; closed: number } } }).midiTest.state);
  await expect.poll(async () => (await midiState()).sent).toContainEqual([0xb1, 0, 64]);
  // Mapped CC emits once, with no second raw passthrough.
  socket.send(JSON.stringify({ type: 'midi', device: 'Remote keyboard', source: 'remote', msgType: 'cc', channel: 4, cc: 7, value: 127, raw: [0xb3, 7, 127] }));
  await expect.poll(async () => (await midiState()).sent.filter((bytes) => bytes[0] === 0xb3)).toHaveLength(1);
  await page.getByRole('button', { name: 'Receive from Test bus', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send to Test bus', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => (window as unknown as { midiTest: { input: { onmidimessage: (event: { data: Uint8Array }) => void } } }).midiTest.input.onmidimessage({ data: new Uint8Array([0x90, 60, 100]) }));
  await expect.poll(() => sent.find((item) => item.type === 'midi')).toMatchObject({ device: 'Test bus', raw: [0x90, 60, 100], msgType: 'noteon', note: 60, velocity: 100 });
  await page.getByRole('button', { name: 'Send to Test bus', exact: true }).click();
  socket.send(JSON.stringify({ type: 'midi', device: 'Remote keyboard', source: 'remote', msgType: 'noteon', channel: 1, note: 62, velocity: 100, raw: [0x90, 62, 100] }));
  await expect.poll(async () => (await midiState()).sent).toContainEqual([0x90, 62, 100]);
  await page.getByRole('link', { name: 'Indoor Sky', exact: true }).click();
  await expect.poll(async () => (await midiState()).closed).toBe(2);
  expect((await midiState()).sent).toContainEqual([0x80, 62, 0]);
  const count = (await midiState()).sent.length;
  socket.send(JSON.stringify(signal));
  expect((await midiState()).sent).toHaveLength(count);
});
