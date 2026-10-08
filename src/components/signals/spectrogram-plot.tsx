'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { analyzeSpectrogramBackfill, spectrogramHopUs, type SpectrogramColumn } from '@/lib/signals/spectrum-analysis';
import type { SpectralSettings } from '@/lib/signals/spectral-settings';

const HISTORY_US = 65_000_000;

function columnLevel(column: SpectrogramColumn, power: number, mode: SpectralSettings['mode']) {
  return mode === 'relative'
    ? Math.max(0, Math.min(1, (Math.log2(Math.max(power, Number.MIN_VALUE)) + 1) / 4))
    : Math.max(0, Math.min(1, (10 * Math.log10(Math.max(power, Number.MIN_VALUE) / column.referencePsd) + 100) / 100));
}

export interface SpectrogramTimeRun {
  columns: SpectrogramColumn[];
  startTimeUs: number;
  endTimeUs: number;
}

export function spectrogramTimeRuns(columns: SpectrogramColumn[], hopUs: number): SpectrogramTimeRun[] {
  const runs: SpectrogramColumn[][] = [];
  for (const column of columns) {
    const run = runs[runs.length - 1];
    if (!run || column.timeUs - run[run.length - 1].timeUs > hopUs * 1.5) runs.push([column]);
    else run.push(column);
  }
  return runs.map((run) => ({
    columns: run,
    startTimeUs: run[0].timeUs - hopUs / 2,
    endTimeUs: run[run.length - 1].timeUs + hopUs / 2,
  }));
}

export function visibleSpectrogramRuns(runs: SpectrogramTimeRun[], startTimeUs: number, endTimeUs: number) {
  return runs.filter((run) => run.endTimeUs > startTimeUs && run.startTimeUs < endTimeUs);
}

export function interpolateSpectrogramPower(points: SpectrogramColumn['points'], frequency: number) {
  if (frequency <= points[0].frequency) return points[0].power;
  if (frequency >= points[points.length - 1].frequency) return points[points.length - 1].power;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (points[middle].frequency <= frequency) low = middle;
    else high = middle;
  }
  const span = points[high].frequency - points[low].frequency;
  const mix = span ? (frequency - points[low].frequency) / span : 0;
  return points[low].power * (1 - mix) + points[high].power * mix;
}

function frequencyAtPosition(position: number, first: number, last: number, scale: SpectralSettings['frequencyScale']) {
  if (scale === 'log') return first * 2 ** (position * Math.log2(last / first));
  const linearPosition = scale === 'expanded' ? position * position : position;
  return first + linearPosition * (last - first);
}

function hslToRgb(hue: number, saturation: number, lightness: number) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match].map((value) => Math.round(value * 255));
}

function buildRunRaster(
  run: SpectrogramTimeRun,
  height: number,
  firstFrequency: number,
  lastFrequency: number,
  mode: SpectralSettings['mode'],
  frequencyScale: SpectralSettings['frequencyScale'],
) {
  const raster = document.createElement('canvas');
  raster.width = run.columns.length;
  raster.height = height;
  const context = raster.getContext('2d')!;
  const image = context.createImageData(raster.width, height);
  for (let x = 0; x < run.columns.length; x++) {
    const column = run.columns[x];
    for (let y = 0; y < height; y++) {
      const position = 1 - y / Math.max(1, height - 1);
      const frequency = frequencyAtPosition(position, firstFrequency, lastFrequency, frequencyScale);
      const power = interpolateSpectrogramPower(column.points, frequency);
      const level = columnLevel(column, power, mode);
      const [red, green, blue] = hslToRgb(240 - level * 240, 0.9, (8 + level * 52) / 100);
      const offset = (y * raster.width + x) * 4;
      image.data[offset] = red;
      image.data[offset + 1] = green;
      image.data[offset + 2] = blue;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return raster;
}

export const SpectrogramPlot = memo(function SpectrogramPlot({ channel, clock, delay, windowSeconds, aggregationMs, spectralSettings, refreshKey, label }: {
  channel: Channel;
  clock?: NodeClock;
  delay: number;
  windowSeconds: number;
  aggregationMs: number;
  spectralSettings: SpectralSettings;
  refreshKey: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<SpectrogramColumn[]>([]);
  const lastHopRef = useRef<number | null>(null);
  const backfillMsRef = useRef(0);
  const preparationMsRef = useRef(0);
  const [revision, setRevision] = useState(0);
  const analysisKey = `${channel.id}/${clock?.generation ?? -1}/${aggregationMs}/${spectralSettings.fftSize}/${spectralSettings.welchSegments}/${spectralSettings.bandAverage}/${spectralSettings.mode}`;
  const spectralMode = spectralSettings.mode;
  const frequencyScale = spectralSettings.frequencyScale;
  const analysisKeyRef = useRef('');

  useEffect(() => {
    void refreshKey;
    if (!clock) return;
    const end = clock.timeUs + (performance.now() - clock.atMs) * 1000 - delay * 1e6;
    const hopUs = spectrogramHopUs(aggregationMs);
    const samples: Array<{ seq: number; t: number; v: number }> = [];
    channel.ring.visitRange(end - 70_000_000, end, (sample) => samples.push(sample));
    if (!samples.length) return;
    const rebuild = analysisKeyRef.current !== analysisKey;
    const analysisStarted = performance.now();
    if (rebuild) {
      analysisKeyRef.current = analysisKey;
      historyRef.current = [];
      lastHopRef.current = null;
    }
    const firstEligible = Math.max(samples[0].t, end - HISTORY_US);
    const hop = lastHopRef.current === null
      ? Math.ceil(firstEligible / hopUs) * hopUs
      : lastHopRef.current + hopUs;
    const finalHop = Math.floor(end / hopUs) * hopUs;
    let changed = rebuild;
    if (hop <= finalHop) {
      const result = analyzeSpectrogramBackfill(samples, hop, finalHop, hopUs, aggregationMs, spectralSettings);
      historyRef.current.push(...result.columns);
      lastHopRef.current = finalHop;
      preparationMsRef.current = result.preparationMs;
      changed = true;
    }
    const retainAfter = end - HISTORY_US;
    const firstRetained = historyRef.current.findIndex((column) => column.timeUs >= retainAfter);
    if (firstRetained > 0) historyRef.current.splice(0, firstRetained);
    if (rebuild) backfillMsRef.current = performance.now() - analysisStarted;
    if (changed) setRevision((value) => value + 1);
  }, [channel, clock, delay, aggregationMs, spectralSettings, refreshKey, analysisKey]);

  useEffect(() => {
    void revision;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !clock) return;
    let frame = 0;
    const hopUs = spectrogramHopUs(aggregationMs);
    const columns = historyRef.current.filter((column) => column.points.length > 1);
    const runs = spectrogramTimeRuns(columns, hopUs);
    let rasterHeight = 0;
    let rasterFirstFrequency = 0;
    let rasterLastFrequency = 0;
    let rasters: Array<{ run: SpectrogramTimeRun; canvas: HTMLCanvasElement }> = [];
    const ensureRasters = (height: number, firstFrequency: number, lastFrequency: number) => {
      if (height === rasterHeight && firstFrequency === rasterFirstFrequency && lastFrequency === rasterLastFrequency) return;
      rasterHeight = height;
      rasterFirstFrequency = firstFrequency;
      rasterLastFrequency = lastFrequency;
      rasters = runs.map((run) => ({ run, canvas: buildRunRaster(run, height, firstFrequency, lastFrequency, spectralMode, frequencyScale) }));
    };
    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.clearRect(0, 0, width, height);
      const end = clock.timeUs + (now - clock.atMs) * 1000 - delay * 1e6;
      const windowUs = windowSeconds * 1e6;
      const start = end - windowUs;
      const visibleRuns = visibleSpectrogramRuns(runs, start, end);
      if (visibleRuns.length) {
        const visibleColumns = visibleRuns.flatMap((run) => run.columns.filter((column) =>
          column.timeUs + hopUs / 2 > start && column.timeUs - hopUs / 2 < end));
        const firstFrequency = Math.min(...visibleColumns.map((column) => column.points[0].frequency));
        const lastFrequency = Math.max(...visibleColumns.map((column) => column.points[column.points.length - 1].frequency));
        ensureRasters(height, firstFrequency, lastFrequency);
        context.save();
        context.beginPath(); context.rect(0, 0, width, height); context.clip();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        for (const { run, canvas: raster } of rasters) {
          if (!visibleRuns.includes(run)) continue;
          const left = (run.startTimeUs - start) / windowUs * width;
          const right = (run.endTimeUs - start) / windowUs * width;
          context.drawImage(raster, left, 0, right - left, height);
        }
        context.restore();
        context.fillStyle = '#d8e2e8'; context.font = `${10 * ratio}px monospace`; context.textBaseline = 'top';
        context.textAlign = 'left'; context.fillText(`${firstFrequency.toFixed(2)} Hz`, 5 * ratio, 4 * ratio);
        context.textAlign = 'right'; context.fillText(`${lastFrequency.toFixed(2)} Hz`, width - 5 * ratio, 4 * ratio);
        const latestRun = visibleRuns[visibleRuns.length - 1];
        const latest = latestRun.columns[latestRun.columns.length - 1];
        context.textBaseline = 'bottom';
        context.fillText(`FFT ${latest.fftLength} · Welch ${latest.welchSegmentCount} · Δ ${latest.resolution.toFixed(3)} Hz`, width - 5 * ratio, height - 4 * ratio);
      } else {
        context.fillStyle = '#8ba0af'; context.font = `${12 * ratio}px monospace`; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.fillText('Insufficient contiguous data', width / 2, height / 2);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [aggregationMs, clock, delay, revision, frequencyScale, spectralMode, windowSeconds]);

  const latest = historyRef.current[historyRef.current.length - 1];
  const state = latest
    ? `${label}. Spectrogram. ${historyRef.current.length} timestamped columns. FFT ${latest.fftLength}. Welch ${latest.welchSegmentCount}.`
    : `${label}. Spectrogram. Insufficient contiguous data.`;
  return <Box component="canvas" ref={canvasRef} role="img" aria-label={state}
    data-spectrogram-columns={historyRef.current.length} data-spectrogram-hop-ms={spectrogramHopUs(aggregationMs) / 1000}
    data-spectrogram-fft={latest?.fftLength} data-spectrogram-requested-fft={spectralSettings.fftSize}
    data-spectrogram-welch={latest?.welchSegmentCount} data-spectrogram-rate={latest?.effectiveSampleRate}
    data-spectrogram-peak={latest?.peakFrequency} data-spectrogram-bands={spectralSettings.bandAverage}
    data-spectrogram-mode={spectralSettings.mode} data-spectrogram-frequency-scale={spectralSettings.frequencyScale}
    data-spectrogram-first-time={historyRef.current[0]?.timeUs} data-spectrogram-last-time={latest?.timeUs}
    data-spectrogram-backfill-ms={backfillMsRef.current.toFixed(1)}
    data-spectrogram-preparation-ms={preparationMsRef.current.toFixed(1)}
    sx={{ display: 'block', width: '100%', height: 170, bgcolor: '#071017' }} />;
});
