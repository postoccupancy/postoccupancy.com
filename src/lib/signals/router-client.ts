import { SampleRing } from './sample-ring';

export type RouterMessage = { type: string; [key: string]: unknown } | ArrayBuffer;
export interface Channel {
  id: string;
  node: string;
  param: string;
  unit: string;
  ring: SampleRing;
  receivedAt: number;
}
export interface NodeClock {
  timeUs: number;
  atMs: number;
  lastSendTimeUs: number;
  generation: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// One instance per mounted site. Samples stay here, outside React render state.
export class RouterClient {
  channels = new Map<string, Channel>();
  clocks = new Map<string, NodeClock>();
  status: 'connecting' | 'connected' | 'reconnecting' = 'connecting';
  now = 0;
  private socket: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private messages = new Set<(message: RouterMessage) => void>();
  private version = 0;

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  getServerSnapshot = () => 0;

  // Future router / voices features can use this same connection for their own messages.
  subscribeMessages = (listener: (message: RouterMessage) => void) => {
    this.messages.add(listener);
    return () => { this.messages.delete(listener); };
  };
  send = (message: { type: string; [key: string]: unknown }) => {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  };

  private notify = () => { this.now = performance.now(); this.version++; this.listeners.forEach((listener) => listener()); };

  connect(url: string) {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    // React labels refresh at 4 Hz; canvases read their buffers independently.
    const refresh = setInterval(this.notify, 250);
    const scheduleRetry = () => {
      if (stopped) return;
      this.status = 'reconnecting';
      this.notify();
      retry = setTimeout(open, Math.min(1000 * 2 ** attempt++, 15_000));
    };
    const open = () => {
      if (stopped) return;
      let socket: WebSocket;
      try { socket = new WebSocket(url); } catch { scheduleRetry(); return; }
      this.socket = socket;
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        attempt = 0;
        this.status = 'connected';
        this.clocks.clear();
        this.channels.forEach((channel) => { channel.ring.clear(); channel.receivedAt = 0; });
        this.notify();
      };
      socket.onmessage = (event) => {
        let message: unknown;
        try { message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
        if (!(message instanceof ArrayBuffer) && (!isRecord(message) || typeof message.type !== 'string')) return;
        if (!(message instanceof ArrayBuffer)) this.ingest(message as Record<string, unknown>);
        this.messages.forEach((listener) => listener(message as RouterMessage));
      };
      socket.onerror = () => socket.close();
      socket.onclose = scheduleRetry;
    };
    open();
    return () => {
      stopped = true;
      clearInterval(refresh);
      clearTimeout(retry);
      if (this.socket) {
        this.socket.onopen = this.socket.onmessage = this.socket.onclose = this.socket.onerror = null;
        this.socket.close();
        this.socket = null;
      }
    };
  }

  private ingest(message: Record<string, unknown>) {
    if (message.type !== 'sample_batch' || !Array.isArray(message.streams)) return;
    const now = performance.now();
    for (const stream of message.streams) {
      if (!isRecord(stream) || typeof stream.name !== 'string' || typeof stream.param !== 'string' || !Array.isArray(stream.samples)) continue;
      const samples = stream.samples.filter((sample): sample is [number, number, number] =>
        Array.isArray(sample) && sample.length === 3 && sample.every((value) => typeof value === 'number' && Number.isFinite(value)));
      if (!samples.length) continue;
      const latestTime = samples[samples.length - 1][1];
      const sendTime = typeof message.sendTimeUs === 'number' && Number.isFinite(message.sendTimeUs) ? message.sendTimeUs : latestTime;
      let clock = this.clocks.get(stream.name);
      if (!clock || sendTime < clock.lastSendTimeUs - 1_000_000) {
        // Device uptime rolls back on restart. Do not draw a line across boots.
        this.channels.forEach((channel) => { if (channel.node === stream.name) { channel.ring.clear(); channel.receivedAt = 0; } });
        clock = { timeUs: latestTime, atMs: now, lastSendTimeUs: sendTime, generation: (clock?.generation ?? 0) + 1 };
        this.clocks.set(stream.name, clock);
      }
      clock.lastSendTimeUs = Math.max(clock.lastSendTimeUs, sendTime);
      const id = `${stream.name}/${stream.param}`;
      let channel = this.channels.get(id);
      if (!channel) {
        // Bound metadata as well as each stream's sample history.
        if (this.channels.size >= 128) continue;
        channel = { id, node: stream.name, param: stream.param, unit: typeof stream.unit === 'string' ? stream.unit : '', ring: new SampleRing(), receivedAt: now };
        this.channels.set(id, channel);
      }
      for (const [seq, t, v] of samples) channel.ring.push({ seq, t, v });
      channel.receivedAt = now;
    }
  }
}
