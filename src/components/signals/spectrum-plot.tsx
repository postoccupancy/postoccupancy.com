'use client';

import { memo, useEffect, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { analyzeSpectrumRing } from '@/lib/signals/spectrum-analysis';

export const SpectrumPlot = memo(function SpectrumPlot({ channel, clock, delay, windowSeconds, aggregationMs, color, refreshKey, label }: {
  channel: Channel;
  clock?: NodeClock;
  delay: number;
  windowSeconds: number;
  aggregationMs: number;
  color: string;
  refreshKey: number;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrum = useMemo(() => {
    void refreshKey;
    if (!clock) return null;
    const end = clock.timeUs + (performance.now() - clock.atMs) * 1000 - delay * 1e6;
    return analyzeSpectrumRing(channel.ring, end - windowSeconds * 1e6, end, aggregationMs, windowSeconds);
  }, [channel, clock, delay, windowSeconds, aggregationMs, refreshKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.clearRect(0, 0, width, height);
    if (!spectrum?.points.length) {
      context.fillStyle = '#8ba0af'; context.font = `${12 * ratio}px monospace`; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText('Insufficient contiguous data', width / 2, height / 2);
      return;
    }
    const firstFrequency = spectrum.points[0].frequency;
    const lastFrequency = spectrum.points[spectrum.points.length - 1].frequency;
    const frequencyRange = Math.log(lastFrequency / firstFrequency);
    context.strokeStyle = 'rgba(27, 37, 45, 0.05)'; context.lineWidth = ratio; context.beginPath();
    for (let index = 1; index < 4; index++) { context.moveTo(0, height * index / 4); context.lineTo(width, height * index / 4); }
    context.stroke();
    context.strokeStyle = color; context.lineWidth = 2 * ratio; context.beginPath();
    spectrum.points.forEach((point, index) => {
      const x = frequencyRange ? Math.log(point.frequency / firstFrequency) / frequencyRange * width : 0;
      const level = Math.max(0, Math.min(1, (Math.log2(Math.max(point.power, Number.MIN_VALUE)) + 1) / 4));
      const y = height - level * height;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
    context.fillStyle = '#8ba0af'; context.font = `${10 * ratio}px monospace`; context.textBaseline = 'top';
    context.textAlign = 'left'; context.fillText(`${firstFrequency.toFixed(2)} Hz`, 5 * ratio, 4 * ratio);
    context.textAlign = 'right'; context.fillText(`${lastFrequency.toFixed(2)} Hz`, width - 5 * ratio, 4 * ratio);
    context.textBaseline = 'bottom'; context.textAlign = 'right';
    context.fillText(`FFT ${spectrum.fftLength} · Welch ${spectrum.welchSegmentCount} · Δ ${spectrum.resolution.toFixed(3)} Hz`, width - 5 * ratio, height - 4 * ratio);
  }, [color, spectrum]);

  const state = spectrum
    ? `${label}. Spectrum. ${spectrum.effectiveSampleRate.toFixed(1)} Hz. FFT ${spectrum.fftLength}. Welch ${spectrum.welchSegmentCount}. ${spectrum.contiguousDurationSeconds.toFixed(3)} seconds contiguous.`
    : `${label}. Spectrum. Insufficient contiguous data.`;
  return <Box component="canvas" ref={canvasRef} role="img" aria-label={state} data-spectrum-fft={spectrum?.fftLength} data-spectrum-rate={spectrum?.effectiveSampleRate} data-spectrum-peak={spectrum?.peakFrequency} sx={{ display: 'block', width: '100%', height: 170, bgcolor: 'whitesmoke' }} />;
});
