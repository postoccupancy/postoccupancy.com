import { expect, test } from '@playwright/test';
import { ElectricSeaSource, defaultElectricSeaSettings } from '../src/lib/dsp-for-artists/electric-sea-source';
import { RouterClient, type RouterMessage } from '../src/lib/signals/router-client';

class FakeRouter {
  status: RouterClient['status'] = 'connected';
  sent: Array<{ type: string; enabled?: boolean }> = [];
  messageListeners = new Set<(message: RouterMessage) => void>();
  statusListeners = new Set<() => void>();
  residentOwners = 0;
  subscribeMessages = (listener: (message: RouterMessage) => void) => {
    this.messageListeners.add(listener);
    return () => { this.messageListeners.delete(listener); };
  };
  subscribe = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  };
  send = (message: { type: string; enabled?: boolean }) => { this.sent.push(message); return true; };
  acquireResidentSubscription = () => {
    if (this.residentOwners++ === 0) this.send({ type: 'resident_subscribe', enabled: true });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.residentOwners === 0) this.send({ type: 'resident_subscribe', enabled: false });
    };
  };
  message(message: RouterMessage) { this.messageListeners.forEach(listener => listener(message)); }
  connection(status: RouterClient['status']) {
    this.status = status;
    if (status === 'connected' && this.residentOwners > 0) this.send({ type: 'resident_subscribe', enabled: true });
    this.statusListeners.forEach(listener => listener());
  }
}

const resident = (device: string, ids: number[], ready = true) => ({
  type: 'resident_voices', device, ready,
  voices: ids.map((id, index) => ({ id, active: true, frequencyHz: 0.05 * (index + 1), confidence: 0.8 })),
});

test('Electric Sea source maps live voices while retaining independent stream snapshots', () => {
  const router = new FakeRouter();
  const source = new ElectricSeaSource(router as unknown as RouterClient, { schedule: callback => callback() });
  source.start();
  expect(router.sent).toContainEqual({ type: 'resident_subscribe', enabled: true });
  router.message(resident('osc/indoor-sky/temperature', [1]));
  router.message(resident('osc/electric-sky/rms', [1]));
  expect(source.getSnapshot()).toMatchObject({
    connection: 'connected', activeVoiceCount: 2, allocatedVoiceCount: 2,
    streams: ['osc/electric-sky/rms', 'osc/indoor-sky/temperature'],
  });
  expect(source.getSnapshot().oscillators[0]).toMatchObject({
    id: 'electric-sea-1', sourceVoiceKey: 'osc/indoor-sky/temperature::1',
    frequency: 130.8127826502993, waveform: 'sine', direction: 0, sourceAmplitude: 0.144,
  });

  router.message(resident('osc/indoor-sky/temperature', [], false));
  expect(source.getSnapshot().activeVoiceCount).toBe(1);
  expect(source.getSnapshot().streams).toHaveLength(2);
  source.configure({ ...defaultElectricSeaSettings, maximumVoices: 0 });
  expect(source.getSnapshot()).toMatchObject({ activeVoiceCount: 1, allocatedVoiceCount: 0 });
  source.stop();
  expect(router.sent.at(-1)).toEqual({ type: 'resident_subscribe', enabled: false });
  expect(source.getSnapshot().streams).toEqual([]);
});

test('Electric Sea source filters streams, quantizes pitch, and clears on disconnect', () => {
  const router = new FakeRouter();
  const source = new ElectricSeaSource(router as unknown as RouterClient, { schedule: callback => callback() });
  source.start();
  router.message(resident('osc/indoor-sky/temperature', [1, 2]));
  router.message(resident('osc/electric-sky/rms', [1]));
  source.configure({
    ...defaultElectricSeaSettings,
    streamId: 'osc/indoor-sky/temperature', maximumVoices: 1, pitchMode: 'quantized',
  });
  expect(source.getSnapshot()).toMatchObject({ activeVoiceCount: 2, allocatedVoiceCount: 1 });
  expect(source.getSnapshot().oscillators[0].frequency).toBeCloseTo(130.8127826502993, 10);
  router.connection('reconnecting');
  expect(source.getSnapshot()).toMatchObject({ connection: 'reconnecting', activeVoiceCount: 0, allocatedVoiceCount: 0, streams: [] });
  router.connection('connected');
  expect(router.sent.filter(message => message.enabled === true)).toHaveLength(2);
});

test('Electric Sea source reports eligible and allocated counts and applies SC per-device normalization', () => {
  const router = new FakeRouter();
  const source = new ElectricSeaSource(router as unknown as RouterClient, { schedule: callback => callback() });
  source.start();
  router.message(resident('osc/shared/temperature', [1, 2]));
  router.message(resident('osc/shared/humidity', [1, 2]));
  source.configure({ ...defaultElectricSeaSettings, maximumVoices: 3 });
  const snapshot = source.getSnapshot();
  expect(snapshot).toMatchObject({ activeVoiceCount: 4, allocatedVoiceCount: 3 });
  expect(snapshot.oscillators[0].sourceAmplitude).toBeCloseTo(0.144 / Math.pow(4, 0.35), 10);
  source.stop();
});

test('Electric Sea source releases only the stream whose stale timer expires', () => {
  const router = new FakeRouter();
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const source = new ElectricSeaSource(router as unknown as RouterClient, {
    schedule: callback => callback(),
    setTimer: callback => {
      const timer = ++nextTimer;
      timers.set(timer, callback);
      return timer as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: timer => { timers.delete(timer as unknown as number); },
  });
  source.start();
  router.message(resident('osc/indoor-sky/temperature', [1]));
  router.message(resident('osc/electric-sky/rms', [1]));
  expect(source.getSnapshot().activeVoiceCount).toBe(2);
  const [staleTimer, expire] = timers.entries().next().value!;
  timers.delete(staleTimer);
  expire();
  expect(source.getSnapshot()).toMatchObject({
    streams: ['osc/electric-sky/rms'], activeVoiceCount: 1,
  });
  source.stop();
  expect(timers.size).toBe(0);
});

test('resident subscription leases do not disable overlapping consumers', () => {
  const router = new RouterClient();
  const commands: Array<{ type: string; enabled?: unknown }> = [];
  router.send = message => { commands.push(message); return true; };
  const releaseVoices = router.acquireResidentSubscription();
  const releaseDsp = router.acquireResidentSubscription();
  expect(commands).toEqual([{ type: 'resident_subscribe', enabled: true }]);
  releaseDsp();
  expect(commands).toHaveLength(1);
  releaseVoices();
  expect(commands).toEqual([
    { type: 'resident_subscribe', enabled: true },
    { type: 'resident_subscribe', enabled: false },
  ]);
  releaseVoices();
  expect(commands).toHaveLength(2);
});
