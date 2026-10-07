'use client';

import type { SignalAnalysisSettings } from '@/components/settings/settings-provider';
import { VisualizerSurface } from '@/components/visualizer/visualizer-surface';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { useSignalRouter } from './router-provider';

export type SignalVisualization = 'waveform' | 'spectrum' | 'spectrogram' | 'modulation';

export function SignalPlot({ channel, label, visualization, windowSeconds, aggregationMs }: {
  channel: Channel;
  clock?: NodeClock;
  delay: number;
  color: string;
  scale: number;
  decimals: number;
  label: string;
  visualization: SignalVisualization;
  windowSeconds: number;
  aggregationMs: number;
  analysisSettings: SignalAnalysisSettings;
}) {
  const router = useSignalRouter();
  return <VisualizerSurface
    device={`osc/${channel.node}/${channel.param}`}
    router={router}
    compact
    visualization={visualization}
    windowSeconds={windowSeconds}
    aggregationMs={aggregationMs}
    label={`${label} ${visualization} view · ${windowSeconds} second window`}
  />;
}
