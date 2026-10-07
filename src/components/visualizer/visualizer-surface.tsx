'use client';

import { memo, useEffect, useRef } from 'react';
import { useSettings } from '@/components/settings/settings-provider';
import type { RouterClient } from '@/lib/signals/router-client';
import { VISUALIZER_AGGREGATION_MS, VISUALIZER_WINDOWS_SECONDS } from '@/lib/visualizer/controls';
import { mountVisualizer } from '@/lib/visualizer/engine';
import styles from './visualizer.module.css';
// Keep the original renderer's imperative controls isolated from selector updates.
export const VisualizerSurface = memo(function VisualizerSurface({
  device,
  router,
  audioOnly = false,
  compact = false,
  visualization = 'waveform',
  windowSeconds,
  aggregationMs,
  label,
}: {
  device: string;
  router: RouterClient;
  audioOnly?: boolean;
  compact?: boolean;
  visualization?: 'waveform' | 'spectrum' | 'spectrogram' | 'modulation';
  windowSeconds?: number;
  aggregationMs?: number;
  label?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { signalAnalysis } = useSettings();
  useEffect(() => mountVisualizer(root.current!, device, router, signalAnalysis, { audioOnly, compact, height: compact ? 170 : undefined }), [audioOnly, compact, device, router, signalAnalysis]);
  useEffect(() => {
    if (!root.current || audioOnly) return;
    const view = visualization === 'waveform' ? 'wave' : visualization;
    root.current.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)?.click();
    if (windowSeconds !== undefined) {
      const control = root.current.querySelector<HTMLInputElement>('[data-viz="windowControl"]');
      const index = VISUALIZER_WINDOWS_SECONDS.findIndex((value) => value === windowSeconds);
      if (control && index >= 0) { control.value = String(index); control.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (aggregationMs !== undefined) {
      const control = root.current.querySelector<HTMLInputElement>('[data-viz="aggregate"]');
      const index = VISUALIZER_AGGREGATION_MS.findIndex((value) => value === aggregationMs);
      if (control && index >= 0) { control.value = String(index); control.dispatchEvent(new Event('input', { bubbles: true })); }
    }
  }, [aggregationMs, audioOnly, signalAnalysis, visualization, windowSeconds]);
  return <div ref={root} data-visualizer-surface={audioOnly ? 'audio' : compact ? 'compact' : 'full'} className={`${styles.surface} ${compact ? styles.compact : ''}`}>
    <header><div className="signal-title">SIGNAL · <span data-viz="deviceLabel"></span></div><div className="controls global-controls">
    <button data-viz="audio" aria-pressed="false">start audio</button>
    <label>aggregate <input data-viz="aggregate" type="range" min="0" max="8" defaultValue="0" /><span data-viz="aggregateValue">off</span></label>
    <label>buffer <input data-viz="bufferControl" type="range" min="0" max="4" defaultValue="2" /><span data-viz="bufferValue">1 s</span></label>
    <label>gain <input data-viz="gainControl" type="range" min="-6" max="15" defaultValue="2" /><span data-viz="gainValue">4×</span></label>
    </div><div className="controls view-controls">
    <button className="view active" data-view="wave" aria-pressed="true">waveform</button><button className="view" data-view="spectrum" aria-pressed="false">spectrum</button><button className="view" data-view="spectrogram" aria-pressed="false">spectrogram</button><button className="view" data-view="modulation" aria-pressed="false">modulation</button>
    <label className="wave-control">window <input data-viz="windowControl" type="range" min="0" max="15" step="1" defaultValue="5" /><span data-viz="windowValue">0.043 s</span></label>
    </div></header>
    <div hidden>
      <button data-viz="frequencyScale">frequency: {signalAnalysis.frequencyScale}</button>
      <input data-viz="fftPower" type="range" min="7" max="14" value={signalAnalysis.fftPower} readOnly /><span data-viz="fftValue">{2 ** signalAnalysis.fftPower}</span>
      <input data-viz="welchControl" type="range" min="0" max="4" value={signalAnalysis.welchIndex} readOnly /><span data-viz="welchValue">{[1, 2, 4, 8, 16][signalAnalysis.welchIndex]}</span>
      <input data-viz="bandAverage" type="checkbox" checked={signalAnalysis.bands} readOnly />
      <button data-viz="spectrumMode">spectrum: {signalAnalysis.spectrumMode}</button>
      <input data-viz="smooth" type="checkbox" checked={signalAnalysis.smooth} readOnly />
      <input data-viz="centroidEnabled" type="checkbox" checked={signalAnalysis.centroid} readOnly />
      <select data-viz="modulationPalette" value={signalAnalysis.palette} onChange={() => undefined}><option value="viridis">viridis</option><option value="plasma">plasma</option><option value="inferno">inferno</option><option value="magma">magma</option><option value="cividis">cividis</option></select>
    </div>
    <canvas data-viz="canvas" role="img" aria-label={label ?? `${device} visualization`} />
    <p data-viz="audioError" role="status" className="audio-error" /><footer aria-label="Visualizer statistics" aria-live="off"><div>WS <span data-viz="connection" className="warning">connecting</span></div><div>source <span data-viz="sourceStats">—</span></div><div>shown <span data-viz="shown">0</span></div><div>cursor <span data-viz="cursorValue">—</span></div><div>missing <span data-viz="missing">0</span></div><div>arrival now/max <span data-viz="arrival">0/0 ms</span></div><div>audio buffer <span data-viz="audioBuffer">—</span></div><div>audio underruns <span data-viz="underruns">0</span></div><div>output peak <span data-viz="outputPeak">0.000</span></div><div>clipping <span data-viz="clipping">0</span></div><div>centroid <span data-viz="centroidValue">—</span></div><div>spectral color <span data-viz="spectralColor">—</span></div><div>PSD <span data-viz="psdStats">—</span></div></footer>
    </div>;
});
