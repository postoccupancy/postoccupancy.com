'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { analyzeSpectrogramBackfill, spectrogramHopUs, type SpectrogramColumn } from '@/lib/signals/spectrum-analysis';
import type { SpectralSettings } from '@/lib/signals/spectral-settings';
import { frequencyPosition } from '@/lib/visualizer/frequency-position';

const HISTORY_US = 65_000_000;

function columnLevel(column: SpectrogramColumn, power: number, mode: SpectralSettings['mode']) {
  return mode === 'relative'
    ? Math.max(0, Math.min(1, (Math.log2(Math.max(power, Number.MIN_VALUE)) + 1) / 4))
    : Math.max(0, Math.min(1, (10 * Math.log10(Math.max(power, Number.MIN_VALUE) / column.referencePsd) + 100) / 100));
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
      const visible = historyRef.current.filter((column) => column.timeUs >= start && column.timeUs <= end && column.points.length > 1);
      if (visible.length) {
        const firstFrequency = Math.min(...visible.map((column) => column.points[0].frequency));
        const lastFrequency = Math.max(...visible.map((column) => column.points[column.points.length - 1].frequency));
        const columnWidth = Math.max(ratio, spectrogramHopUs(aggregationMs) / windowUs * width);
        for (const column of visible) {
          const x = (column.timeUs - start) / windowUs * width;
          const yPositions = column.points.map((point) => {
            const position = frequencyPosition(point.frequency, firstFrequency, lastFrequency, spectralSettings.frequencyScale);
            return (1 - Math.max(0, Math.min(1, position))) * height;
          });
          for (let index = 0; index < column.points.length; index++) {
            const point = column.points[index];
            const center = yPositions[index];
            if (!Number.isFinite(center)) continue;
            const top = index === column.points.length - 1 ? 0 : (center + yPositions[index + 1]) / 2;
            const bottom = index === 0 ? height : (yPositions[index - 1] + center) / 2;
            const level = columnLevel(column, point.power, spectralSettings.mode);
            context.fillStyle = `hsl(${240 - level * 240} 90% ${8 + level * 52}%)`;
            context.fillRect(x - columnWidth / 2, top, columnWidth, Math.max(ratio, bottom - top));
          }
        }
        context.fillStyle = '#d8e2e8'; context.font = `${10 * ratio}px monospace`; context.textBaseline = 'top';
        context.textAlign = 'left'; context.fillText(`${firstFrequency.toFixed(2)} Hz`, 5 * ratio, 4 * ratio);
        context.textAlign = 'right'; context.fillText(`${lastFrequency.toFixed(2)} Hz`, width - 5 * ratio, 4 * ratio);
        const latest = visible[visible.length - 1];
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
  }, [aggregationMs, clock, delay, revision, spectralSettings.frequencyScale, spectralSettings.mode, windowSeconds]);

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
