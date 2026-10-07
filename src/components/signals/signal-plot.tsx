'use client';

import { useEffect, useRef } from 'react';
import type { SignalAnalysisSettings } from '@/components/settings/settings-provider';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { useSignalsVisualization, type AnalysisMessage, type SpectrumPoint, type SpectrumResult } from './signals-visualization';

export type SignalVisualization = 'waveform' | 'spectrum' | 'spectrogram' | 'modulation';
const SPECTROGRAM_RATE = 30;
const SPECTROGRAM_COLUMNS = 60 * SPECTROGRAM_RATE;
const SPECTROGRAM_ROWS = 170;
const palettes: Record<string, [number, [number, number, number]][]> = {
  viridis: [[0, [68, 1, 84]], [.25, [59, 82, 139]], [.5, [33, 145, 140]], [.75, [92, 200, 99]], [1, [253, 231, 37]]],
  plasma: [[0, [13, 8, 135]], [.25, [126, 3, 168]], [.5, [203, 70, 121]], [.75, [248, 148, 65]], [1, [240, 249, 33]]],
  inferno: [[0, [0, 0, 4]], [.25, [85, 15, 109]], [.5, [186, 54, 85]], [.75, [249, 140, 10]], [1, [252, 255, 164]]],
  magma: [[0, [0, 0, 4]], [.25, [79, 18, 123]], [.5, [181, 54, 122]], [.75, [251, 135, 97]], [1, [252, 253, 191]]],
  cividis: [[0, [0, 32, 77]], [.25, [50, 72, 105]], [.5, [101, 111, 110]], [.75, [158, 154, 99]], [1, [255, 233, 69]]],
};

function frequencyPosition(frequency: number, points: SpectrumPoint[], mode: string) {
  const a = points[0].frequency; const b = points.at(-1)!.frequency; const x = (frequency - a) / (b - a);
  return mode === 'expanded' ? Math.sqrt(Math.max(0, x)) : mode === 'log' ? Math.log(frequency / a) / Math.log(b / a) : x;
}
function frequencyAt(position: number, points: SpectrumPoint[], mode: string) {
  const a = points[0].frequency; const b = points.at(-1)!.frequency;
  return mode === 'expanded' ? a + position * position * (b - a) : mode === 'log' ? a * (b / a) ** position : a + position * (b - a);
}
function valueAt(frequency: number, points: SpectrumPoint[], smooth: boolean) {
  let high = 1; while (high < points.length && points[high].frequency < frequency) high++;
  if (high >= points.length) return points.at(-1)!.power;
  const low = Math.max(0, high - 1); const span = points[high].frequency - points[low].frequency; const mix = span ? (frequency - points[low].frequency) / span : 0;
  return smooth ? points[low].power * (1 - mix) + points[high].power * mix : (mix < .5 ? points[low].power : points[high].power);
}
function level(value: number, spectrum: SpectrumResult, mode: string) {
  if (mode === 'relative') return Math.max(0, Math.min(1, (Math.log2(Math.max(value, Number.MIN_VALUE)) + 1) / 4));
  const db = 10 * Math.log10(Math.max(value, Number.MIN_VALUE) / spectrum.referencePsd);
  return Math.max(0, Math.min(1, (db + 100) / 100));
}
function rgb(value: number, name: string) {
  const stops = palettes[name] || palettes.viridis;
  for (let i = 1; i < stops.length; i++) if (value <= stops[i][0]) {
    const a = stops[i - 1]; const b = stops[i]; const mix = (value - a[0]) / (b[0] - a[0]);
    return a[1].map((channel, index) => Math.round(channel + (b[1][index] - channel) * mix));
  }
  return stops.at(-1)![1];
}

export function SignalPlot(props: {
  channel: Channel; clock?: NodeClock; delay: number; color: string; scale: number; decimals: number; label: string;
  visualization: SignalVisualization; windowSeconds: number; aggregationMs: number; analysisSettings: SignalAnalysisSettings;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  const visible = useRef(true);
  const spectrum = useRef<SpectrumResult | null>(null);
  const modulation = useRef<HTMLCanvasElement | null>(null);
  const spectrogram = useRef<HTMLCanvasElement | null>(null);
  const lastSpectrogramTime = useRef(0);
  const fullScale = useRef(0);
  const { register } = useSignalsVisualization();

  useEffect(() => { propsRef.current = props; }, [props]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const observer = new IntersectionObserver(entries => { visible.current = entries.some(entry => entry.isIntersecting); });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  function resize(canvas: HTMLCanvasElement) {
    const dpr = devicePixelRatio || 1; const width = Math.max(1, Math.round(canvas.clientWidth * dpr)); const height = Math.round(170 * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }
  function clear(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')!; context.fillStyle = '#050608'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(113,129,141,.16)'; context.lineWidth = 1;
    for (let i = 1; i < 4; i++) { context.beginPath(); context.moveTo(0, canvas.height * i / 4); context.lineTo(canvas.width, canvas.height * i / 4); context.stroke(); }
    return context;
  }
  function displayEnd(displayNow: number, current: typeof props) {
    const latest = current.channel.ring.latest();
    return latest ? latest.t + (displayNow - current.channel.receivedAt) * 1000 - current.delay * 1e6 : 0;
  }
  function drawWaveform(canvas: HTMLCanvasElement, displayNow: number, current: typeof props) {
    const context = clear(canvas); const end = displayEnd(displayNow, current); if (!end) return;
    const start = end - current.windowSeconds * 1e6; const binUs = current.windowSeconds * 1e6 / canvas.width;
    const mins = new Float32Array(canvas.width); const maxs = new Float32Array(canvas.width); mins.fill(Infinity); maxs.fill(-Infinity);
    const minTimes = new Float64Array(canvas.width); const maxTimes = new Float64Array(canvas.width);
    const aggregationSamples = Math.max(1, Math.round(current.channel.sampleRate * current.aggregationMs / 1000));
    const rolling: number[] = []; let rollingSum = 0; let sum = 0; let count = 0;
    current.channel.ring.visitRange(start - current.aggregationMs * 1000, end, sample => {
      rolling.push(sample.v); rollingSum += sample.v; if (rolling.length > aggregationSamples) rollingSum -= rolling.shift()!;
      if (sample.t < start) return; const value = rollingSum / rolling.length; const bin = Math.floor((sample.t - start) / binUs);
      if (bin < 0 || bin >= canvas.width) return;
      if (value < mins[bin]) { mins[bin] = value; minTimes[bin] = sample.t; }
      if (value > maxs[bin]) { maxs[bin] = value; maxTimes[bin] = sample.t; }
      sum += value; count++;
    });
    if (!count) return; const mean = sum / count; let observedPeak = 0;
    for (let i = 0; i < mins.length; i++) if (mins[i] !== Infinity) observedPeak = Math.max(observedPeak, Math.abs(mins[i] - mean), Math.abs(maxs[i] - mean));
    if (!fullScale.current && observedPeak) fullScale.current = observedPeak * 16; else if (observedPeak > fullScale.current) fullScale.current = observedPeak * 1.25;
    const amplitude = fullScale.current || 1; const gapUs = current.channel.sampleRate ? Math.max(3e6 / current.channel.sampleRate, binUs * 2.5) : Infinity;
    context.strokeStyle = current.color; context.lineWidth = Math.max(1, devicePixelRatio || 1); context.beginPath(); let prior: number | null = null;
    for (let i = 0; i < mins.length; i++) if (mins[i] !== Infinity) {
      const useMin = Math.abs(mins[i] - mean) >= Math.abs(maxs[i] - mean); const value = useMin ? mins[i] : maxs[i]; const time = useMin ? minTimes[i] : maxTimes[i];
      const x = (time - start) / (current.windowSeconds * 1e6) * canvas.width; const y = canvas.height / 2 - Math.max(-1, Math.min(1, (value - mean) / amplitude * 4)) * canvas.height * .45;
      if (prior === null || time - prior > gapUs) context.moveTo(x, y); else context.lineTo(x, y); prior = time;
    }
    context.stroke();
  }
  function drawSpectrum(canvas: HTMLCanvasElement, result: SpectrumResult | null, current: typeof props) {
    const context = clear(canvas); if (!result?.points.length) return;
    context.strokeStyle = '#fc8'; context.lineWidth = Math.max(1, devicePixelRatio || 1); context.beginPath();
    result.points.forEach((point, index) => { const x = frequencyPosition(point.frequency, result.points, current.analysisSettings.frequencyScale) * canvas.width; const y = canvas.height - level(point.power, result, current.analysisSettings.spectrumMode) * canvas.height; if (index) context.lineTo(x, y); else context.moveTo(x, y); });
    context.stroke(); canvas.dataset.analysisN = String(result.n); canvas.dataset.analysisSegments = String(result.segmentCount); canvas.dataset.analysisResolution = String(result.resolution);
    canvas.dataset.analysisPowerSum = String(result.power.reduce((sum, value) => sum + value, 0));
    canvas.dataset.analysisPowerChecksum = String(result.power.reduce((sum, value, index) => sum + value * (index + 1), 0));
  }
  function appendSpectrogram(columns: { timestamp: number; spectrum: SpectrumResult }[]) {
    const history = spectrogram.current || document.createElement('canvas'); spectrogram.current = history;
    if (history.width !== SPECTROGRAM_COLUMNS || history.height !== SPECTROGRAM_ROWS) { history.width = SPECTROGRAM_COLUMNS; history.height = SPECTROGRAM_ROWS; }
    const context = history.getContext('2d')!; const settings = propsRef.current.analysisSettings;
    for (const column of columns) {
      if (!column.spectrum.points.length) continue;
      let shift = lastSpectrogramTime.current ? Math.max(1, Math.round((column.timestamp - lastSpectrogramTime.current) / (1e6 / SPECTROGRAM_RATE))) : 1;
      shift = Math.min(SPECTROGRAM_COLUMNS, shift);
      context.drawImage(history, shift, 0, SPECTROGRAM_COLUMNS - shift, SPECTROGRAM_ROWS, 0, 0, SPECTROGRAM_COLUMNS - shift, SPECTROGRAM_ROWS);
      context.fillStyle = '#050608'; context.fillRect(SPECTROGRAM_COLUMNS - shift, 0, shift, SPECTROGRAM_ROWS); const x = SPECTROGRAM_COLUMNS - 1;
      for (let y = 0; y < SPECTROGRAM_ROWS; y++) {
        const frequency = frequencyAt(1 - y / Math.max(1, SPECTROGRAM_ROWS - 1), column.spectrum.points, settings.frequencyScale);
        const amount = level(valueAt(frequency, column.spectrum.points, settings.smooth), column.spectrum, settings.spectrumMode) * 255;
        context.fillStyle = `hsl(${240 - amount * .8} 90% ${amount * .28}%)`; context.fillRect(x, y, 1, 1);
      }
      lastSpectrogramTime.current = column.timestamp; spectrum.current = column.spectrum;
      if (canvasRef.current) (canvasRef.current as HTMLCanvasElement & { __spectrogramTime?: number }).__spectrogramTime = column.timestamp;
    }
  }
  function drawSpectrogram(canvas: HTMLCanvasElement, displayNow: number, current: typeof props) {
    const context = clear(canvas); const history = spectrogram.current; if (!history || !lastSpectrogramTime.current) return;
    const end = displayEnd(displayNow, current); const right = SPECTROGRAM_COLUMNS - (lastSpectrogramTime.current - end) / (1e6 / SPECTROGRAM_RATE);
    const width = Math.max(1, current.windowSeconds * SPECTROGRAM_RATE); const left = right - width;
    (canvas as HTMLCanvasElement & { __spectrogramWindowColumns?: number }).__spectrogramWindowColumns = width;
    const sourceLeft = Math.max(0, left); const sourceRight = Math.min(SPECTROGRAM_COLUMNS, right);
    if (sourceRight > sourceLeft) {
      const destinationLeft = (sourceLeft - left) / width * canvas.width; const destinationWidth = (sourceRight - sourceLeft) / width * canvas.width;
      context.drawImage(history, sourceLeft, 0, sourceRight - sourceLeft, SPECTROGRAM_ROWS, destinationLeft, 0, destinationWidth, canvas.height);
    }
    canvas.dataset.spectrogramTime = String(lastSpectrogramTime.current);
  }
  function updateModulation(message: Extract<AnalysisMessage, { type: 'modulation' }>) {
    const field = modulation.current || document.createElement('canvas'); modulation.current = field; field.width = message.modulationBins + 1; field.height = message.frequencyBins;
    const context = field.getContext('2d')!; const image = context.createImageData(field.width, field.height); const settings = propsRef.current.analysisSettings;
    for (let y = 0; y < field.height; y++) for (let x = 0; x < field.width; x++) {
      const value = message.display[field.height - 1 - y]?.[x] || 0; const color = rgb(value, settings.palette); const at = (y * field.width + x) * 4;
      image.data[at] = color[0]; image.data[at + 1] = color[1]; image.data[at + 2] = color[2]; image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    if (canvasRef.current) (canvasRef.current as HTMLCanvasElement & { __modulationTime?: number }).__modulationTime = message.timestamp;
  }
  function drawModulation(canvas: HTMLCanvasElement, current: typeof props) {
    const context = clear(canvas); const field = modulation.current; if (!field) return;
    context.imageSmoothingEnabled = current.analysisSettings.smooth; context.drawImage(field, 0, 0, canvas.width, canvas.height);
  }

  useEffect(() => register(props.channel.id, {
    analysis: (message: AnalysisMessage) => {
      if (message.type === 'spectrum') spectrum.current = message.spectrum;
      else if (message.type === 'spectrogram') appendSpectrogram(message.columns);
      else if (message.type === 'modulation') updateModulation(message);
    },
    draw: (displayNow: number) => {
      const canvas = canvasRef.current; if (!canvas) return;
      (canvas as HTMLCanvasElement & { __signalsDisplayNow?: number }).__signalsDisplayNow = displayNow;
      if (!visible.current) return;
      resize(canvas); const current = propsRef.current;
      if (current.visualization === 'waveform') drawWaveform(canvas, displayNow, current);
      else if (current.visualization === 'spectrum') drawSpectrum(canvas, spectrum.current, current);
      else if (current.visualization === 'spectrogram') drawSpectrogram(canvas, displayNow, current);
      else drawModulation(canvas, current);
    },
    // The renderer reads changing props through propsRef; remount only for a new stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [props.channel.id, register]);

  return <canvas ref={canvasRef} role="img" aria-label={`${props.label} ${props.visualization} view · ${props.windowSeconds} second window`}
    data-signals-lane={props.channel.id} style={{ display: 'block', width: '100%', height: 170, background: '#050608' }} />;
}
