import { expect, test } from '@playwright/test';
import { ElectricSeaSource, defaultElectricSeaSettings } from '../src/lib/dsp-for-artists/electric-sea-source';
import type { RouterClient, RouterMessage } from '../src/lib/signals/router-client';

class FakeRouter {
  status: RouterClient['status'] = 'connected';
  sent: Array<{ type: string; enabled?: boolean }> = [];
  messageListeners = new Set<(message: RouterMessage) => void>();
  statusListeners = new Set<() => void>();
  subscribeMessages = (listener: (message: RouterMessage) => void) => {
    this.messageListeners.add(listener);
    return () => { this.messageListeners.delete(listener); };
  };
  subscribe = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  };
  send = (message: { type: string; enabled?: boolean }) => { this.sent.push(message); return true; };
  message(message: RouterMessage) { this.messageListeners.forEach(listener => listener(message)); }
  connection(status: RouterClient['status']) { this.status = status; this.statusListeners.forEach(listener => listener()); }
}

const resident = (device: string, ids: number[], ready = true) => ({
  type: 'resident_voices', device, ready,
  voices: ids.map((id, index) => ({ id, active: true, frequencyHz: 0.05 * (index + 1), confidence: 0.8 })),
});

test('Electric Sea source maps live voices while retaining independent stream snapshots', () => {
  const router = new FakeRouter();
  const source = new ElectricSeaSource(router as unknown as RouterClient, callback => callback());
  source.start();
  expect(router.sent).toContainEqual({ type: 'resident_subscribe', enabled: true });
  router.message(resident('osc/indoor-sky/temperature', [1]));
  router.message(resident('osc/electric-sky/rms', [1]));
  expect(source.getSnapshot()).toMatchObject({
    connection: 'connected', activeVoiceCount: 2,
    streams: ['osc/electric-sky/rms', 'osc/indoor-sky/temperature'],
  });
  expect(source.getSnapshot().oscillators[0]).toMatchObject({
    id: 'electric-sea-1', frequency: 130.8127826502993, waveform: 'sine', direction: 0,
  });

  router.message(resident('osc/indoor-sky/temperature', [], false));
  expect(source.getSnapshot().activeVoiceCount).toBe(1);
  expect(source.getSnapshot().streams).toHaveLength(2);
  source.configure({ ...defaultElectricSeaSettings, maximumVoices: 0 });
  expect(source.getSnapshot().activeVoiceCount).toBe(0);
  source.stop();
  expect(router.sent.at(-1)).toEqual({ type: 'resident_subscribe', enabled: false });
  expect(source.getSnapshot().streams).toEqual([]);
});

test('Electric Sea source filters streams, quantizes pitch, and clears on disconnect', () => {
  const router = new FakeRouter();
  const source = new ElectricSeaSource(router as unknown as RouterClient, callback => callback());
  source.start();
  router.message(resident('osc/indoor-sky/temperature', [1, 2]));
  router.message(resident('osc/electric-sky/rms', [1]));
  source.configure({
    ...defaultElectricSeaSettings,
    streamId: 'osc/indoor-sky/temperature', maximumVoices: 1, pitchMode: 'quantized',
  });
  expect(source.getSnapshot().activeVoiceCount).toBe(1);
  expect(source.getSnapshot().oscillators[0].frequency).toBeCloseTo(130.8127826502993, 10);
  router.connection('reconnecting');
  expect(source.getSnapshot()).toMatchObject({ connection: 'reconnecting', activeVoiceCount: 0, streams: [] });
  router.connection('connected');
  expect(router.sent.filter(message => message.enabled === true)).toHaveLength(2);
});
