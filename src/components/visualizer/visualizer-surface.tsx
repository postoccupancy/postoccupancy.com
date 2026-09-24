'use client';

import { memo, useEffect, useRef } from 'react';
import type { RouterClient } from '@/lib/signals/router-client';
import { mountVisualizer } from '@/lib/visualizer/engine';
import styles from './visualizer.module.css';
// Keep the original renderer's imperative controls isolated from selector updates.
export const VisualizerSurface = memo(function VisualizerSurface({
  device,
  router
}: {
  device: string;
  router: RouterClient;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => mountVisualizer(root.current!, device, router), [device, router]);
  return <div ref={root} className={styles.surface}>
    <header><div className="signal-title">SIGNAL · <span data-viz="deviceLabel"></span></div><div className="controls global-controls">
    <button data-viz="audio" aria-pressed="false">start audio</button>
    <label>aggregate <input data-viz="aggregate" type="range" min="0" max="8" defaultValue="0" /><span data-viz="aggregateValue">off</span></label>
    <label>buffer <input data-viz="bufferControl" type="range" min="0" max="4" defaultValue="2" /><span data-viz="bufferValue">1 s</span></label>
    <label>gain <input data-viz="gainControl" type="range" min="-6" max="15" defaultValue="2" /><span data-viz="gainValue">4×</span></label>
    </div><div className="controls view-controls">
    <button className="view active" data-view="wave" aria-pressed="true">waveform</button><button className="view" data-view="spectrum" aria-pressed="false">spectrum</button><button className="view" data-view="spectrogram" aria-pressed="false">spectrogram</button><button className="view" data-view="modulation" aria-pressed="false">modulation</button><button data-viz="frequencyScale" className="spectral-control">frequency: log</button>
    <label className="wave-control">window <input data-viz="windowControl" type="range" min="0" max="15" step="1" defaultValue="5" /><span data-viz="windowValue">0.043 s</span></label>
    <label className="spectral-control">FFT <input data-viz="fftPower" type="range" min="7" max="14" defaultValue="11" /><span data-viz="fftValue">2048</span></label>
    <label className="spectral-control">Welch <input data-viz="welchControl" type="range" min="0" max="4" defaultValue="2" /><span data-viz="welchValue">4</span></label>
    <label className="spectral-control"><input data-viz="bandAverage" type="checkbox" defaultChecked /> bands</label><button data-viz="spectrumMode" className="spectral-control">spectrum: raw</button>
    <label className="image-control"><input data-viz="smooth" type="checkbox" defaultChecked /> smooth</label><label className="regular-spectral-control"><input data-viz="centroidEnabled" type="checkbox" /> centroid</label><label className="modulation-control">palette <select data-viz="modulationPalette"><option value="viridis">viridis</option><option value="plasma">plasma</option><option value="inferno">inferno</option><option value="magma">magma</option><option value="cividis">cividis</option></select></label>
    </div></header><canvas data-viz="canvas" role="img" aria-label={`${device} visualization`} />
    <p data-viz="audioError" role="status" className="audio-error" /><footer aria-label="Visualizer statistics" aria-live="off"><div>WS <span data-viz="connection" className="warning">connecting</span></div><div>source <span data-viz="sourceStats">—</span></div><div>shown <span data-viz="shown">0</span></div><div>cursor <span data-viz="cursorValue">—</span></div><div>missing <span data-viz="missing">0</span></div><div>arrival now/max <span data-viz="arrival">0/0 ms</span></div><div>audio buffer <span data-viz="audioBuffer">—</span></div><div>audio underruns <span data-viz="underruns">0</span></div><div>output peak <span data-viz="outputPeak">0.000</span></div><div>clipping <span data-viz="clipping">0</span></div><div>centroid <span data-viz="centroidValue">—</span></div><div>spectral color <span data-viz="spectralColor">—</span></div><div>PSD <span data-viz="psdStats">—</span></div></footer>
    </div>;
});
