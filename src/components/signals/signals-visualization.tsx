'use client';

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { SignalAnalysisSettings } from '@/components/settings/settings-provider';
import type { Channel, RouterClient } from '@/lib/signals/router-client';
import type { SignalVisualization } from './signal-plot';

export interface SpectrumPoint { frequency: number; power: number; rawPower?: number; background?: number }
export interface SpectrumResult {
  points: SpectrumPoint[]; rawPoints: SpectrumPoint[]; rate: number; n: number; selected: number;
  resolution: number; segmentCount: number; referencePsd: number; amplitudeReference: number; power: Float64Array;
}
export type AnalysisMessage =
  | { type: 'spectrum'; id: string; timestamp: number; spectrum: SpectrumResult }
  | { type: 'spectrogram'; id: string; columns: { timestamp: number; spectrum: SpectrumResult }[] }
  | { type: 'modulation'; id: string; timestamp: number; metadata: Record<string, number>; display: Float32Array[]; frequencyBins: number; modulationBins: number };

interface LaneCallbacks {
  draw: (displayNow: number) => void;
  analysis: (message: AnalysisMessage) => void;
}
interface VisualizationContextValue {
  register: (id: string, callbacks: LaneCallbacks) => () => void;
}
const VisualizationContext = createContext<VisualizationContextValue | null>(null);

export function SignalsVisualizationProvider({ router, channels, visualization, windowSeconds, aggregationMs, analysisSettings, children }: {
  router: RouterClient;
  channels: Channel[];
  visualization: SignalVisualization;
  windowSeconds: number;
  aggregationMs: number;
  analysisSettings: SignalAnalysisSettings;
  children: ReactNode;
}) {
  const lanes = useRef(new Map<string, LaneCallbacks>());
  const worker = useRef<Worker | null>(null);
  const channelsRef = useRef(channels);
  const lastSent = useRef(new Map<string, { timestamp: number; generation: number }>());
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  useEffect(() => {
    const instance = new Worker(new URL('../../lib/signals/signals-analysis.worker.js', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<AnalysisMessage>) => lanes.current.get(event.data.id)?.analysis(event.data);
    return () => { instance.terminate(); worker.current = null; };
  }, []);

  useEffect(() => {
    worker.current?.postMessage({ type: 'config', config: { view: visualization, windowSeconds, aggregationMs, ...analysisSettings } });
  }, [visualization, windowSeconds, aggregationMs, analysisSettings]);

  useEffect(() => {
    let frame = 0;
    let lastTransfer = 0;
    const tick = (displayNow: number) => {
      frame = requestAnimationFrame(tick);
      for (const lane of lanes.current.values()) lane.draw(displayNow);
      if (displayNow - lastTransfer < 50 || !worker.current) return;
      lastTransfer = displayNow;
      const active = new Set<string>();
      for (const channel of channelsRef.current) {
        active.add(channel.id);
        const latest = channel.ring.latest();
        if (!latest) continue;
        const generation = router.clocks.get(channel.node)?.generation ?? 0;
        const sent = lastSent.current.get(channel.id);
        if (sent?.timestamp === latest.t && sent.generation === generation) continue;
        const reset = !sent || sent.generation !== generation || latest.t < sent.timestamp;
        const samples: { t: number; v: number }[] = [];
        channel.ring.visitRange(reset ? -Infinity : sent.timestamp + Number.EPSILON, Infinity, sample => samples.push(sample));
        if (!samples.length) continue;
        const times = Float64Array.from(samples, sample => sample.t);
        const values = Float32Array.from(samples, sample => sample.v);
        worker.current.postMessage({ type: 'samples', id: channel.id, rate: channel.sampleRate, reset, times, values }, [times.buffer, values.buffer]);
        lastSent.current.set(channel.id, { timestamp: latest.t, generation });
      }
      for (const id of lastSent.current.keys()) if (!active.has(id)) {
        worker.current.postMessage({ type: 'remove', id });
        lastSent.current.delete(id);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [router]);

  const value = useMemo<VisualizationContextValue>(() => ({
    register: (id, callbacks) => {
      lanes.current.set(id, callbacks);
      return () => { if (lanes.current.get(id) === callbacks) lanes.current.delete(id); };
    },
  }), []);
  return <VisualizationContext.Provider value={value}>{children}</VisualizationContext.Provider>;
}

export function useSignalsVisualization() {
  const context = useContext(VisualizationContext);
  if (!context) throw new Error('useSignalsVisualization requires SignalsVisualizationProvider');
  return context;
}
