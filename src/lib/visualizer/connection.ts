import type { RouterClient, RouterInfo } from '../signals/router-client';
import { signalDevice, signalValue } from '../signals/signal-device';

type Sample = [number, number, number];
interface Callbacks {
  samples: (samples: Sample[], unit: string) => void;
  pcm: (packet: DataView) => void;
  reset: () => void;
  status: (status: string) => void;
}

/** Page-local subscriptions using the site's one WebSocket. */
export function connectVisualizer(router: RouterClient, device: string, callbacks: Callbacks) {
  const isPcm = device.startsWith('pcm/');
  const derived = device.match(/^osc\/([^/]+)\/(bass|mid|high|centroid)$/);
  const pcmDevice = isPcm ? device : derived ? `pcm/${derived[1]}/audio` : null;
  const subscription = isPcm ? 'pcm_subscribe' : 'pcm_analysis_subscribe';
  const page = `/interfaces/spectral-visualizer?${new URLSearchParams({ device })}`;
  let sequence = 0;
  let status = '';
  const single = (message: RouterInfo) => {
    if (signalDevice(message) !== device) return;
    const value = signalValue(message);
    if (value !== null) callbacks.samples([[sequence++, performance.now() * 1000, value]], typeof message.unit === 'string' ? message.unit : '');
  };
  const unsubscribe = router.subscribeMessages((message) => {
    if (message instanceof ArrayBuffer) {
      // ESAU frames have no device ID. Wait for the selected subscription's
      // ordered acknowledgment so queued packets from the previous device drop.
      if (isPcm && router.pcmDevice === device) callbacks.pcm(new DataView(message));
      return;
    }
    if (message.type === 'sample_batch' && Array.isArray(message.streams)) {
      for (const stream of message.streams) {
        if (!stream || typeof stream !== 'object') continue;
        const id = stream.device || `osc/${stream.name}/${stream.param}`;
        if (id !== device || !Array.isArray(stream.samples)) continue;
        const samples = stream.samples.filter((sample: unknown): sample is Sample => Array.isArray(sample) && sample.length === 3 && sample.every((value) => typeof value === 'number' && Number.isFinite(value)));
        if (samples.length) callbacks.samples(samples, typeof stream.unit === 'string' ? stream.unit : '');
      }
    } else if (message.type === 'signal_batch' && Array.isArray(message.signals)) {
      for (const signal of message.signals) if (signal && typeof signal === 'object') single(signal);
    } else if (['osc', 'json', 'midi'].includes(message.type)) single(message);
  });
  const update = () => {
    if (router.status === status) return;
    status = router.status;
    sequence = 0;
    callbacks.reset(); callbacks.status(status);
    if (status === 'connected' && pcmDevice) {
      router.send({ type: 'pcm_source_enable', device: pcmDevice, enabled: true, page });
      router.send({ type: subscription, device: pcmDevice, enabled: true, page });
    }
  };
  const unsubscribeStatus = router.subscribe(update);
  update();
  return () => {
    unsubscribe(); unsubscribeStatus();
    if (pcmDevice) router.send({ type: subscription, device: pcmDevice, enabled: false, page });
    // Do not disable a shared source another tab or instrument may still use.
  };
}
