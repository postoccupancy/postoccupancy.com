import type { RouterClient, RouterInfo, RouterMessage } from '../signals/router-client';

// Adapted from signal-router/router/public/index.html: signal keys, assignments,
// CC normalization/smoothing, port loop prevention, and USB batch presentation.
export interface Signal {
  type: 'osc' | 'json' | 'midi' | 'audio';
  device: string;
  source: string;
  value?: number;
  min?: number;
  max?: number;
  channel?: number;
  cc?: number;
  note?: number;
  velocity?: number;
  msgType?: string;
  raw?: number[];
  enabled?: boolean;
  available?: boolean;
  sampleRate?: number;
}
export type Assignment = Partial<Record<'channel' | 'cc' | 'min' | 'max', number>>;
export interface SignalRow { key: string; signal: Signal; assignment: Assignment; out: boolean; receivedAt: number }
type PortState = Record<string, { receive?: boolean; send?: boolean }>;
type Presenter = { queue: RouterInfo[]; timer?: ReturnType<typeof setTimeout>; lastTimeUs: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* In-memory controls still work without storage. */ }
}
export function signalKey(data: Signal) {
  if (data.type !== 'midi') return data.device;
  if (data.msgType === 'cc') return `${data.device}/ch${data.channel}/cc${data.cc}`;
  if (data.msgType === 'noteon' || data.msgType === 'noteoff') return `${data.device}/ch${data.channel}/n${data.note}`;
  if (data.msgType === 'pitchbend') return `${data.device}/ch${data.channel}/pb`;
  return data.device;
}
export function normalized(row: SignalRow) {
  const { signal, assignment } = row;
  const min = assignment.min ?? signal.min ?? 0;
  const max = assignment.max ?? signal.max ?? (signal.type === 'midi' ? 127 : 1);
  return max === min ? 0 : Math.max(0, Math.min(1, ((signal.value ?? 0) - min) / (max - min)));
}
export function connectionType(info: RouterInfo) {
  const ip = String(info.ip || '');
  if (info.isServerMachine) return 'Same machine';
  if (info.oscUdpAvailable === false) return 'Web tunnel';
  if (ip.startsWith('100.')) return 'Remote via Tailscale';
  if (ip.startsWith('192.168.4.')) return 'Local via access point';
  if (ip.startsWith('10.0.0.')) return 'Local via ethernet switch';
  if (ip.startsWith('192.168.')) return 'Local via WiFi';
  return 'Direct connection';
}
function detectOS() {
  const ua = navigator.userAgent;
  return /CrOS/.test(ua) ? 'ChromeOS' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
}

export class RouterInterface {
  rows = new Map<string, SignalRow>();
  sources = new Map<string, RouterInfo>();
  server: RouterInfo | null = null;
  client: RouterInfo | null = null;
  clients: RouterInfo | null = null;
  midi: MIDIAccess | null = null;
  midiStatus = 'MIDI is not enabled';
  portState: PortState = {};
  now = 0;
  private active = false;
  private generation = 0;
  private version = 0;
  private listeners = new Set<() => void>();
  private smoothed = new Map<string, number>();
  private presenters = new Map<string, Presenter>();
  private opening = new WeakMap<MIDIOutput, Promise<MIDIOutput>>();
  private notes = new Map<MIDIOutput, Set<number>>();
  private broadcast: BroadcastChannel | null = null;
  constructor(readonly router: RouterClient) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.version;
  getServerSnapshot = () => 0;
  private notify = () => { this.now = performance.now(); this.version++; this.listeners.forEach((listener) => listener()); };

  start() {
    this.active = true;
    this.portState = this.loadPorts();
    this.broadcast = new BroadcastChannel('rf-midi');
    this.broadcast.onmessage = () => { this.portState = this.loadPorts(); this.restorePorts(); this.notify(); };
    const unsubscribe = this.router.subscribeMessages(this.receive, true);
    let status = this.router.status;
    const refresh = setInterval(() => {
      if (status !== this.router.status) {
        status = this.router.status;
        if (status !== 'connected') {
          this.notes.forEach((_, output) => this.releaseNotes(output));
          this.clearPresenters();
          this.smoothed.clear();
          this.rows.clear();
          this.sources.clear();
          this.server = this.client = this.clients = null;
        }
      }
      this.notify();
    }, 250);
    return () => {
      this.active = false;
      this.generation++;
      unsubscribe();
      clearInterval(refresh);
      this.clearPresenters();
      this.broadcast?.close();
      this.broadcast = null;
      if (this.midi) {
        this.midi.onstatechange = null;
        for (const input of this.midi.inputs.values()) { input.onmidimessage = null; void input.close().catch(() => {}); }
        for (const output of this.midi.outputs.values()) { this.releaseNotes(output); void output.close().catch(() => {}); }
      }
      this.midi = null;
    };
  }
  private loadPorts(): PortState {
    const saved = read<unknown>('rf-port-state', {});
    return record(saved) ? Object.fromEntries(Object.entries(saved).filter(([, value]) => record(value))) as PortState : {};
  }
  private clearPresenters() {
    this.presenters.forEach((presenter) => clearTimeout(presenter.timer));
    this.presenters.clear();
  }

  enableMidi = async () => {
    if (this.midi || this.midiStatus === 'Requesting MIDI access…') return;
    if (!navigator.requestMIDIAccess) { this.midiStatus = 'WebMIDI is unavailable in this browser'; this.notify(); return; }
    const generation = this.generation;
    this.midiStatus = 'Requesting MIDI access…'; this.notify();
    try {
      const access = await navigator.requestMIDIAccess();
      if (!this.active || generation !== this.generation) return;
      this.midi = access;
      this.midiStatus = 'WebMIDI ready';
      access.onstatechange = () => { this.restorePorts(); this.notify(); };
      this.restorePorts();
    } catch { if (this.active) this.midiStatus = 'MIDI access denied or unavailable'; }
    if (this.active) this.notify();
  };
  setPort(name: string, direction: 'send' | 'receive', enabled: boolean) {
    // Legacy names: receive sends router data TO a port; send reads FROM it.
    this.portState[name] = { ...this.portState[name], [direction]: enabled, ...(enabled ? { [direction === 'send' ? 'receive' : 'send']: false } : {}) };
    write('rf-port-state', this.portState);
    this.broadcast?.postMessage({ type: 'port-state-changed' });
    this.restorePorts(); this.notify();
  }
  private restorePorts() {
    if (!this.midi) return;
    for (const input of this.midi.inputs.values()) {
      const name = input.name || input.id;
      input.onmidimessage = this.portState[name]?.send && !this.portState[name]?.receive
        ? (event) => this.localMidi(event, name) : null;
    }
    for (const output of this.midi.outputs.values()) {
      if (this.portState[output.name || output.id]?.receive) void this.openOutput(output).catch(() => {});
      else this.releaseNotes(output);
    }
  }
  private releaseNotes(output: MIDIOutput) {
    for (const note of this.notes.get(output) || []) {
      try { output.send([0x80 + (note >> 7), note & 127, 0]); } catch { /* Port may have been unplugged. */ }
    }
    this.notes.delete(output);
  }
  private openOutput(output: MIDIOutput) {
    if (output.connection === 'open') return Promise.resolve(output);
    const pending = this.opening.get(output);
    if (pending) return pending;
    const generation = this.generation;
    const opening = output.open().then(() => {
      if (!this.active || generation !== this.generation) void output.close().catch(() => {});
      return output;
    }).finally(() => this.opening.delete(output));
    this.opening.set(output, opening);
    return opening;
  }
  private sendMidi(bytes: number[]) {
    if (!this.active || !this.midi || this.router.status !== 'connected' || !bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) return;
    const generation = this.generation;
    for (const output of this.midi.outputs.values()) {
      const send = () => {
        if (!this.active || generation !== this.generation || !this.portState[output.name || output.id]?.receive) return;
        try {
          output.send(bytes);
          const kind = bytes[0] & 0xf0;
          const note = ((bytes[0] & 0x0f) << 7) | bytes[1];
          if (kind === 0x90 && bytes[2] > 0) {
            const notes = this.notes.get(output) || new Set<number>();
            notes.add(note); this.notes.set(output, notes);
          } else if (kind === 0x80 || kind === 0x90) this.notes.get(output)?.delete(note);
        } catch { this.midiStatus = `Could not send to ${output.name || output.id}`; }
      };
      if (!this.portState[output.name || output.id]?.receive) continue;
      if (output.connection === 'open') send();
      else void this.openOutput(output).then(send).catch(() => { this.midiStatus = `Could not open ${output.name || output.id}`; });
    }
  }
  private localMidi(event: MIDIMessageEvent, device: string) {
    if (!event.data || this.portState[device]?.receive) return;
    const raw = [...event.data];
    if (raw.length < 3) return;
    const kind = raw[0] & 0xf0;
    const signal: Signal = { type: 'midi', device, source: String(this.client?.ip || 'unknown'), raw, channel: (raw[0] & 0x0f) + 1 };
    if (kind === 0xb0) Object.assign(signal, { msgType: 'cc', cc: raw[1], value: raw[2] });
    else if (kind === 0x90 || kind === 0x80) Object.assign(signal, { msgType: kind === 0x90 ? 'noteon' : 'noteoff', note: raw[1], velocity: raw[2] });
    else if (kind === 0xe0) Object.assign(signal, { msgType: 'pitchbend', value: (raw[2] << 7) | raw[1] });
    else return;
    this.router.send({ ...signal });
    this.signal(signal);
  }
  setAssignment(key: string, field: keyof Assignment, value: string) {
    const row = this.rows.get(key);
    if (!row) return;
    const parsed = Number(value);
    if (value === '') delete row.assignment[field];
    else {
      if (!Number.isFinite(parsed)) return;
      if (field === 'channel' && (!Number.isInteger(parsed) || parsed < 1 || parsed > 16)) return;
      if (field === 'cc' && (!Number.isInteger(parsed) || parsed < 0 || parsed > 127)) return;
      row.assignment[field] = parsed;
    }
    write(`rf-assign-${key}`, row.assignment);
    this.smoothed.delete(key); this.notify();
  }
  toggleOut(row: SignalRow) {
    if (row.signal.type === 'audio') {
      // Audio state comes back from the server; do not claim success optimistically.
      this.router.send({ type: 'pcm_source_enable', device: row.signal.device, enabled: !row.signal.enabled, page: '/hubs/electric-sea' });
    } else {
      row.out = !row.out; write(`rf-out-${row.key}`, row.out); this.notify();
    }
  }
  private signal = (data: unknown) => {
    if (!record(data) || !['osc', 'json', 'midi', 'audio'].includes(String(data.type)) || typeof data.device !== 'string') return;
    if ((data.type === 'osc' || data.type === 'json') && !number(data.value)) return;
    const signal = { ...data, source: typeof data.source === 'string' ? data.source : 'unknown' } as unknown as Signal;
    const key = signalKey(signal);
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= 512) return;
      const saved = read<unknown>(`rf-assign-${key}`, {});
      const assignment: Assignment = {};
      if (record(saved)) for (const field of ['channel', 'cc', 'min', 'max'] as const) {
        if (number(saved[field])) assignment[field] = saved[field];
      }
      if (signal.type === 'midi' && signal.msgType === 'cc') {
        assignment.channel ??= signal.channel; assignment.cc ??= signal.cc;
      }
      row = { key, signal, assignment, out: read(`rf-out-${key}`, true) === true, receivedAt: performance.now() };
      this.rows.set(key, row);
    }
    row.signal = signal; row.receivedAt = performance.now();
    if (row.out && (signal.type === 'osc' || signal.type === 'json' || (signal.type === 'midi' && signal.msgType === 'cc')) && number(signal.value)) {
      const { channel, cc } = row.assignment;
      if (number(channel) && Number.isInteger(channel) && channel >= 1 && channel <= 16 && number(cc) && Number.isInteger(cc) && cc >= 0 && cc <= 127) {
        const norm = normalized(row);
        const smooth = 0.3 * norm + 0.7 * (this.smoothed.get(key) ?? norm);
        this.smoothed.set(key, smooth);
        this.sendMidi([0xb0 + channel - 1, cc, Math.round(smooth * 127)]);
      }
    }
    // A muted row must still release a note that was already sounding.
    if ((row.out || signal.msgType === 'noteoff' || (signal.msgType === 'noteon' && signal.velocity === 0)) && signal.type === 'midi' && signal.msgType !== 'cc' && Array.isArray(signal.raw)) this.sendMidi(signal.raw);
  };
  private presentBatch(data: RouterInfo) {
    if (!Array.isArray(data.streams)) return;
    for (const stream of data.streams) {
      if (!record(stream) || !Array.isArray(stream.samples)) continue;
      const latest = stream.samples.at(-1);
      if (!Array.isArray(latest) || !number(latest[2])) continue;
      this.signal({ type: 'osc', device: stream.device || `osc/${stream.name}/${stream.param}`, source: data.source || stream.name, value: latest[2] });
    }
  }
  private queueBatch(data: RouterInfo) {
    const source = String(data.source || 'unknown');
    if (!number(data.sendTimeUs)) return;
    let presenter = this.presenters.get(source);
    if (!presenter) { presenter = { queue: [], lastTimeUs: -1 }; this.presenters.set(source, presenter); }
    if (data.sendTimeUs <= presenter.lastTimeUs) { clearTimeout(presenter.timer); presenter.queue = []; presenter.timer = undefined; }
    presenter.lastTimeUs = data.sendTimeUs;
    presenter.queue.push(data);
    if (presenter.queue.length > 32) presenter.queue.shift();
    if (presenter.timer !== undefined) return;
    const drain = () => {
      presenter.timer = undefined;
      const current = presenter.queue.shift();
      if (!current || !this.active) return;
      this.presentBatch(current);
      const next = presenter.queue[0];
      if (next) presenter.timer = setTimeout(drain, Math.max(1, Math.min(250, (Number(next.sendTimeUs) - Number(current.sendTimeUs)) / 1000)));
    };
    presenter.timer = setTimeout(drain, 500);
  }
  private receive = (data: RouterMessage) => {
    if (data instanceof ArrayBuffer) return;
    if (data.type === 'server_info') {
      // A new handshake also resets buffered presentation after reconnect.
      this.clearPresenters(); this.rows.clear(); this.sources.clear(); this.smoothed.clear();
      this.server = data;
    }
    if (data.type === 'client_info') {
      this.client = data;
      this.router.send({ type: 'client_meta', os: detectOS(), connType: connectionType(data) });
    }
    if (data.type === 'client_count') this.clients = data;
    if (data.type === 'source_info' && typeof data.ip === 'string' && this.sources.size < 256) this.sources.set(data.ip, data);
    this.signal(data);
    if (data.type === 'signal_batch' && Array.isArray(data.signals)) data.signals.forEach(this.signal);
    if (data.type === 'sample_batch' && Array.isArray(data.streams)) {
      if (data.transport === 'usb') this.queueBatch(data); else this.presentBatch(data);
    }
  };
}
