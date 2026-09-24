'use client';

import { useId, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

interface WaveExplorerProps {
  initialFrequency?: number;
  initialAmplitude?: number;
}

export function WaveExplorer({ initialFrequency = 3, initialAmplitude = 0.65 }: WaveExplorerProps) {
  const [frequency, setFrequency] = useState(initialFrequency);
  const [amplitude, setAmplitude] = useState(initialAmplitude);
  const id = useId();

  // Draw one second of y(t) = A sin(2πft), sampled for a responsive SVG plot.
  const points = Array.from({ length: 401 }, (_, index) => {
    const time = index / 400;
    const x = 32 + time * 576;
    const y = 100 - amplitude * Math.sin(2 * Math.PI * frequency * time) * 72;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');

  return (
    <Box component="section" aria-label="Wave explorer" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: { xs: 2, sm: 3 }, my: 3 }}>
      <Stack direction="row" spacing={2} sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography component="h3" sx={{ fontWeight: 600 }}>Wave explorer</Typography>
        <Button size="small" onClick={() => { setFrequency(initialFrequency); setAmplitude(initialAmplitude); }}>Reset</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">One second of a sine wave</Typography>
      <Box
        component="svg"
        viewBox="0 0 640 208"
        role="img"
        aria-label={`Sine wave: ${frequency} Hz, amplitude ${amplitude.toFixed(2)}`}
        sx={{ display: 'block', width: '100%', height: 'auto', my: 2, color: 'primary.main' }}
      >
        {[28, 100, 172].map((y) => <Box component="line" key={y} x1="32" y1={y} x2="608" y2={y} sx={(theme) => ({ stroke: theme.palette.divider })} />)}
        <path d={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <Box component="g" sx={(theme) => ({ fill: theme.palette.text.secondary, fontSize: 12 })}>
          <text x="4" y="32">1</text><text x="4" y="104">0</text><text x="0" y="176">−1</text>
          <text x="32" y="200">0 s</text><text x="608" y="200" textAnchor="end">1 s</text>
        </Box>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={`${id}-frequency`} variant="body2">Frequency: {frequency} Hz</Typography>
          <Slider aria-labelledby={`${id}-frequency`} value={frequency} min={1} max={8} step={1} valueLabelDisplay="auto" getAriaValueText={(value) => `${value} hertz`} onChange={(_, value) => setFrequency(Number(value))} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography id={`${id}-amplitude`} variant="body2">Amplitude: {amplitude.toFixed(2)}</Typography>
          <Slider aria-labelledby={`${id}-amplitude`} value={amplitude} min={0} max={1} step={0.05} valueLabelDisplay="auto" onChange={(_, value) => setAmplitude(Number(value))} />
        </Box>
      </Stack>
    </Box>
  );
}
