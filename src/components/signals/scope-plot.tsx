'use client';

import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import type { Channel, NodeClock } from '@/lib/signals/router-client';

// Port of draw() from electric-sky's Dashboard.h: min/max pixel bins preserve
// high-rate peaks; empty bins break the line instead of hiding missing data.
export function ScopePlot({ channel, clock, delay, color, scale, decimals, label }: {
  channel: Channel; clock?: NodeClock; delay: number; color: string; scale: number; decimals: number; label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !clock) return;
    let frame = 0;
    let axisLow = Infinity;
    let axisHigh = -Infinity;
    let mins = new Float32Array(0);
    let maxs = new Float32Array(0);
    const windowUs = 10_000_000;
    function draw(now: number) {
      if (!canvas || !context) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * ratio));
      const height = Math.max(1, Math.floor(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.clearRect(0, 0, width, height);
      const end = clock!.timeUs + (now - clock!.atMs) * 1000 - delay * 1e6;
      const start = end - windowUs;
      const bins = Math.max(1, Math.ceil(width / 2));
      const binUs = windowUs / bins;
      const firstBin = Math.floor(start / binUs);
      if (mins.length !== bins + 2) { mins = new Float32Array(bins + 2); maxs = new Float32Array(bins + 2); }
      mins.fill(Infinity); maxs.fill(-Infinity);
      let low = Infinity; let high = -Infinity;
      channel.ring.visitRange(start, end, (sample) => {
        const value = sample.v * scale;
        low = Math.min(low, value); high = Math.max(high, value);
        const bin = Math.floor(sample.t / binUs) - firstBin;
        if (bin >= 0 && bin < mins.length) { mins[bin] = Math.min(mins[bin], value); maxs[bin] = Math.max(maxs[bin], value); }
      });
      context.strokeStyle = '#1b252d'; context.lineWidth = ratio; context.beginPath();
      for (let i = 1; i < 4; i++) { context.moveTo(0, height * i / 4); context.lineTo(width, height * i / 4); }
      context.stroke();
      if (low !== Infinity) {
        const range = high - low < 1e-9 ? 1 : high - low;
        axisLow = Math.min(axisLow, low - range * 0.12);
        axisHigh = Math.max(axisHigh, high + range * 0.12);
        context.strokeStyle = color; context.lineWidth = 2 * ratio; context.beginPath();
        let previous = -2;
        for (let bin = 0; bin < mins.length; bin++) {
          if (mins[bin] === Infinity) continue;
          const x = ((firstBin + bin + 0.5) * binUs - start) / windowUs * width;
          const y1 = height - (mins[bin] - axisLow) / (axisHigh - axisLow) * height;
          const y2 = height - (maxs[bin] - axisLow) / (axisHigh - axisLow) * height;
          if (bin !== previous + 1) context.moveTo(x, y1); else context.lineTo(x, y1);
          // Isolated, low-rate samples must still leave a visible mark.
          context.lineTo(x, y2 === y1 ? y2 + ratio : y2);
          previous = bin;
        }
        context.stroke();
      }
      context.fillStyle = '#8ba0af'; context.font = `${10 * ratio}px monospace`;
      context.textBaseline = 'top'; context.textAlign = 'left';
      context.fillText(low === Infinity ? 'Waiting for buffered samples' : `max ${high.toFixed(decimals)}`, 5 * ratio, 4 * ratio);
      context.textAlign = 'right'; context.fillText('time window 10s', width - 5 * ratio, 4 * ratio);
      if (low !== Infinity) {
        context.textBaseline = 'bottom'; context.textAlign = 'left'; context.fillText(`min ${low.toFixed(decimals)}`, 5 * ratio, height - 4 * ratio);
        context.textAlign = 'right'; context.fillText(`peak-to-peak ${(high - low).toFixed(decimals)}`, width - 5 * ratio, height - 4 * ratio);
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [channel, clock, delay, color, scale, decimals]);
  return <Box component="canvas" ref={canvasRef} role="img" aria-label={label} sx={{ display: 'block', width: '100%', height: 170, bgcolor: '#07090c' }} />;
}
