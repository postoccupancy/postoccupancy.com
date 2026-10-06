'use client';

import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { aggregateValues } from '@/lib/visualizer/controls';
import { logBandAverage, welchPsd } from '@/lib/visualizer/spectral-analysis';
import { ModulationAnalysis } from '@/lib/visualizer/modulation-analysis';

export type SignalVisualization = 'waveform' | 'spectrum' | 'spectrogram' | 'modulation';

interface SpectrumPoint { frequency: number; power: number }
interface SpectrumData {
  points: SpectrumPoint[];
  referencePsd: number;
  resolution: number;
  segmentLength: number;
  segmentCount: number;
  sampleRate: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

function valueAtFrequency(frequency: number, points: SpectrumPoint[]) {
  let high = 1;
  while (high < points.length && points[high].frequency < frequency) high++;
  if (high >= points.length) return points.at(-1)?.power ?? 0;
  const low = Math.max(0, high - 1);
  const span = points[high].frequency - points[low].frequency;
  const mix = span ? (frequency - points[low].frequency) / span : 0;
  return points[low].power * (1 - mix) + points[high].power * mix;
}

function viridis(value: number) {
  const stops: [number, number[]][] = [[0, [68, 1, 84]], [.25, [59, 82, 139]], [.5, [33, 145, 140]], [.75, [92, 200, 99]], [1, [253, 231, 37]]];
  for (let index = 1; index < stops.length; index++) {
    if (value <= stops[index][0]) {
      const before = stops[index - 1];
      const after = stops[index];
      const mix = (value - before[0]) / (after[0] - before[0]);
      return before[1].map((part, channel) => Math.round(part + (after[1][channel] - part) * mix));
    }
  }
  return stops.at(-1)![1];
}

export function SignalPlot({ channel, clock, delay, color, scale, decimals, label, visualization, windowSeconds, aggregationMs }: {
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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !clock) return;
    let animationFrame = 0;
    let lastDraw = 0;
    let lastAnalysisTime = -1;
    let axisLow = Infinity;
    let axisHigh = -Infinity;
    let currentSpectrum: SpectrumData | null = null;
    const spectrogram: { time: number; spectrum: SpectrumData }[] = [];
    const modulation = new ModulationAnalysis();
    const modulationField = document.createElement('canvas');
    const modulationContext = modulationField.getContext('2d')!;

    function dimensions() {
      const rect = canvas!.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas!.width !== width || canvas!.height !== height) { canvas!.width = width; canvas!.height = height; }
      return { width, height, ratio };
    }

    function frame() {
      const size = dimensions();
      context!.clearRect(0, 0, size.width, size.height);
      context!.fillStyle = 'whitesmoke';
      context!.fillRect(0, 0, size.width, size.height);
      context!.strokeStyle = 'rgba(27, 37, 45, 0.05)';
      context!.lineWidth = size.ratio;
      context!.beginPath();
      for (let index = 1; index < 4; index++) {
        context!.moveTo(0, size.height * index / 4);
        context!.lineTo(size.width, size.height * index / 4);
      }
      context!.stroke();
      return size;
    }

    function text(size: ReturnType<typeof dimensions>, left: string, right: string, bottom = '') {
      context!.fillStyle = '#71818d';
      context!.font = `${10 * size.ratio}px monospace`;
      context!.textBaseline = 'top';
      context!.textAlign = 'left';
      context!.fillText(left, 5 * size.ratio, 4 * size.ratio);
      context!.textAlign = 'right';
      context!.fillText(right, size.width - 5 * size.ratio, 4 * size.ratio);
      if (bottom) {
        context!.textBaseline = 'bottom';
        context!.textAlign = 'left';
        context!.fillText(bottom, 5 * size.ratio, size.height - 4 * size.ratio);
      }
    }

    function endTime(now: number) {
      return clock!.timeUs + (now - clock!.atMs) * 1000 - delay * 1e6;
    }

    function series(end: number) {
      const start = end - windowSeconds * 1e6;
      const lookback = aggregationMs * 1000;
      const times: number[] = [];
      const raw: number[] = [];
      channel.ring.visitRange(start - lookback, end, (sample) => { times.push(sample.t); raw.push(sample.v * scale); });
      const rate = channel.sampleRate || (times.length > 1 ? (times.length - 1) * 1e6 / (times.at(-1)! - times[0]) : 0);
      const values = aggregateValues(raw, rate || 1, aggregationMs);
      const first = times.findIndex((time) => time >= start);
      return { start, rate, times: first < 0 ? [] : times.slice(first), values: first < 0 ? new Float64Array() : values.slice(first) };
    }

    function analyze(data: ReturnType<typeof series>): SpectrumData | null {
      if (!(data.rate > 0) || data.values.length < 8) return null;
      let segmentLength = 8;
      while (segmentLength * 2 <= 2048 && segmentLength * 2 <= data.values.length) segmentLength *= 2;
      const spectrum = welchPsd(data.values, data.rate, segmentLength, 16);
      if (!spectrum) return null;
      let mean = 0;
      for (const value of data.values) mean += value;
      mean /= data.values.length;
      let peak = 0;
      for (const value of data.values) peak = Math.max(peak, Math.abs(value - mean));
      const referencePsd = spectrum.fullScaleSinePsd * Math.max(peak, Number.EPSILON) ** 2;
      return { ...spectrum, points: logBandAverage(spectrum), referencePsd };
    }

    function drawWaveform(data: ReturnType<typeof series>) {
      const size = frame();
      if (!data.values.length) { text(size, 'Waiting for buffered samples', `${windowSeconds} s window`); return; }
      let low = Infinity;
      let high = -Infinity;
      for (const value of data.values) { low = Math.min(low, value); high = Math.max(high, value); }
      const observedRange = high - low < 1e-9 ? 1 : high - low;
      axisLow = Math.min(axisLow, low - observedRange * .12);
      axisHigh = Math.max(axisHigh, high + observedRange * .12);
      const bins = Math.max(1, Math.ceil(size.width / 2));
      const mins = new Float64Array(bins); mins.fill(Infinity);
      const maxs = new Float64Array(bins); maxs.fill(-Infinity);
      for (let index = 0; index < data.values.length; index++) {
        const bin = Math.min(bins - 1, Math.max(0, Math.floor((data.times[index] - data.start) / (windowSeconds * 1e6) * bins)));
        mins[bin] = Math.min(mins[bin], data.values[index]);
        maxs[bin] = Math.max(maxs[bin], data.values[index]);
      }
      context!.strokeStyle = color;
      context!.lineWidth = 2 * size.ratio;
      context!.beginPath();
      let previous = -2;
      for (let bin = 0; bin < bins; bin++) {
        if (mins[bin] === Infinity) continue;
        const x = (bin + .5) / bins * size.width;
        const y1 = size.height - (mins[bin] - axisLow) / (axisHigh - axisLow) * size.height;
        const y2 = size.height - (maxs[bin] - axisLow) / (axisHigh - axisLow) * size.height;
        if (bin !== previous + 1) context!.moveTo(x, y1); else context!.lineTo(x, y1);
        context!.lineTo(x, y2 === y1 ? y2 + size.ratio : y2);
        previous = bin;
      }
      context!.stroke();
      text(size, `max ${high.toFixed(decimals)}`, `${windowSeconds} s · ${data.values.length} samples`, `min ${low.toFixed(decimals)} · peak-to-peak ${(high - low).toFixed(decimals)}`);
    }

    function logX(frequency: number, points: SpectrumPoint[]) {
      const first = points[0].frequency;
      const last = points.at(-1)!.frequency;
      return Math.log(frequency / first) / Math.log(last / first);
    }

    function level(power: number, spectrum: SpectrumData) {
      return clamp((10 * Math.log10(Math.max(power, Number.MIN_VALUE) / spectrum.referencePsd) + 100) / 100);
    }

    function drawSpectrum(spectrum: SpectrumData | null) {
      const size = frame();
      if (!spectrum?.points.length) { text(size, 'Waiting for enough samples', `${windowSeconds} s analysis`); return; }
      context!.strokeStyle = '#d47b28';
      context!.lineWidth = 1.5 * size.ratio;
      context!.beginPath();
      spectrum.points.forEach((point, index) => {
        const x = logX(point.frequency, spectrum.points) * size.width;
        const y = size.height - level(point.power, spectrum) * size.height;
        if (index) context!.lineTo(x, y); else context!.moveTo(x, y);
      });
      context!.stroke();
      text(size, `${spectrum.resolution.toFixed(3)} Hz/bin`, `${windowSeconds} s analysis`, `frequency → · ${(spectrum.sampleRate / 2).toFixed(1)} Hz Nyquist · Welch ${spectrum.segmentCount}`);
    }

    function drawSpectrogram(end: number) {
      const size = frame();
      const start = end - windowSeconds * 1e6;
      const visible = spectrogram.filter((entry) => entry.time >= start && entry.time <= end && entry.spectrum.points.length);
      if (!visible.length) { text(size, 'Waiting for enough samples', `${windowSeconds} s visible`); return; }
      const rows = Math.min(96, Math.max(24, Math.floor(size.height / (2 * size.ratio))));
      for (const entry of visible) {
        const x = (entry.time - start) / (windowSeconds * 1e6) * size.width;
        const width = Math.max(size.ratio, size.width / Math.max(1, visible.length));
        for (let row = 0; row < rows; row++) {
          const position = 1 - row / Math.max(1, rows - 1);
          const points = entry.spectrum.points;
          const frequency = points[0].frequency * (points.at(-1)!.frequency / points[0].frequency) ** position;
          const hue = 240 - level(valueAtFrequency(frequency, points), entry.spectrum) * 190;
          context!.fillStyle = `hsl(${hue} 90% 38%)`;
          context!.fillRect(x - width, row / rows * size.height, width + size.ratio, size.height / rows + size.ratio);
        }
      }
      text(size, `${(visible.at(-1)!.spectrum.sampleRate / 2).toFixed(1)} Hz`, `${windowSeconds} s visible`, 'frequency ↑ · time →');
    }

    function drawModulation(spectrum: SpectrumData | null) {
      const size = frame();
      const metadata = modulation.metadata();
      if (!spectrum || !(metadata.maxFrequency > metadata.minFrequency)) { text(size, 'Building modulation history', `${windowSeconds} s analysis`); return; }
      const sourceWidth = modulation.modulationBins + 1;
      const sourceHeight = modulation.frequencyBins;
      const image = context!.createImageData(sourceWidth, sourceHeight);
      for (let y = 0; y < sourceHeight; y++) {
        for (let x = 0; x < sourceWidth; x++) {
          const rgb = viridis(modulation.display[sourceHeight - y - 1][x]);
          const offset = (y * sourceWidth + x) * 4;
          image.data[offset] = rgb[0]; image.data[offset + 1] = rgb[1]; image.data[offset + 2] = rgb[2]; image.data[offset + 3] = 255;
        }
      }
      if (modulationField.width !== sourceWidth || modulationField.height !== sourceHeight) {
        modulationField.width = sourceWidth; modulationField.height = sourceHeight;
      }
      modulationContext.putImageData(image, 0, 0);
      context!.imageSmoothingEnabled = true;
      context!.drawImage(modulationField, 0, 0, size.width, size.height);
      text(size, `${metadata.minFrequency.toFixed(2)}–${metadata.maxFrequency.toFixed(1)} Hz`, `${windowSeconds} s analysis`, `steady/current · modulation ${metadata.minModulation.toFixed(2)}–${metadata.maxModulation.toFixed(2)} Hz`);
    }

    function draw(now: number) {
      animationFrame = requestAnimationFrame(draw);
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      const bounds = canvas!.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      const end = endTime(now);
      const data = series(end);
      if (visualization === 'waveform') { drawWaveform(data); return; }
      const latest = data.times.at(-1) ?? -1;
      if (latest !== lastAnalysisTime) {
        lastAnalysisTime = latest;
        currentSpectrum = analyze(data);
        if (currentSpectrum) {
          spectrogram.push({ time: latest, spectrum: currentSpectrum });
          while (spectrogram.length && latest - spectrogram[0].time > 60e6) spectrogram.shift();
          const analysisRate = Math.min(25, Math.max(2, (data.rate || 8) / 4));
          modulation.ingest(currentSpectrum, latest, analysisRate, 'raw');
        }
      }
      if (visualization === 'spectrum') drawSpectrum(currentSpectrum);
      else if (visualization === 'spectrogram') drawSpectrogram(end);
      else drawModulation(currentSpectrum);
    }

    animationFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animationFrame);
  }, [aggregationMs, channel, clock, color, decimals, delay, scale, visualization, windowSeconds]);

  return <Box component="canvas" ref={canvasRef} role="img" aria-label={`${label} ${visualization} view · ${windowSeconds} second window`} sx={{ display: 'block', width: '100%', height: 170, bgcolor: 'whitesmoke' }} />;
}
