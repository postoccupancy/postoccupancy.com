'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSignalRouter } from './router-provider';
import { ScopePlot } from './scope-plot';

// Presentation hints only: incoming metadata determines which channels exist.
const labels: Record<string, string> = { temperature: 'Temperature', humidity: 'Humidity', pressure: 'Pressure', power: 'Power', 'solar-power': 'Solar input power', rms: 'Microphone RMS', 'solar-voltage': 'Solar voltage', 'solar-current': 'Solar current' };
const colors: Record<string, string> = { temperature: '#66ddff', humidity: '#75ee99', pressure: '#dd99ff', power: '#ffcc66', 'solar-power': '#ff9f43', rms: '#ff6688' };
const units: Record<string, string> = { celsius: '°C', percent: '%', hpa: 'hPa', dbfs: 'dBFS', volts: 'V', ma: 'mA', mw: 'W' };

export function NodeDashboard({ node }: { node: string }) {
  const router = useSignalRouter();
  const [delay, setDelay] = useState(6);
  const channels = [...router.channels.values()].filter((channel) => channel.node === node);
  channels.sort((a, b) => {
    const order = Object.keys(labels);
    const rank = (param: string) => order.includes(param) ? order.indexOf(param) : order.length;
    return rank(a.param) - rank(b.param) || a.param.localeCompare(b.param);
  });
  const now = router.now;
  const lastReceived = Math.max(0, ...channels.map((channel) => channel.receivedAt));
  const fresh = lastReceived > 0 && now - lastReceived < 5000;
  const status = router.status !== 'connected' ? `Router ${router.status}` : !lastReceived ? 'Router connected · waiting for node' : fresh ? 'Live' : 'Router connected · node data stale';
  const clock = router.clocks.get(node);

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}>
        <Typography role="status" aria-label="Connection status" variant="body2" sx={{ color: fresh && router.status === 'connected' ? 'primary.main' : 'text.secondary' }}>{status}</Typography>
        <Box sx={{ width: { xs: '100%', sm: 220 }, px: 1 }}>
          <Typography id="presentation-delay" variant="body2">Presentation delay: {delay.toFixed(2)} s</Typography>
          <Slider aria-labelledby="presentation-delay" value={delay} min={0.5} max={10} step={0.25} size="small" onChange={(_, value) => setDelay(Number(value))} />
        </Box>
      </Stack>
      {!channels.length && <Typography color="text.secondary">Waiting for {node} channels. Plots appear as data arrives.</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 2 }}>
        {channels.map((channel) => {
          const name = labels[channel.param] || channel.param.replaceAll('-', ' ');
          const unit = units[channel.unit.toLowerCase()] ?? channel.unit;
          const scale = channel.unit.toLowerCase() === 'mw' ? 0.001 : 1;
          const decimals = channel.param === 'rms' ? 2 : 4;
          const latest = channel.ring.latest();
          const stale = channel.receivedAt === 0 || now - channel.receivedAt >= 5000 || router.status !== 'connected';
          const value = latest ? `${(latest.v * scale).toFixed(decimals)} ${unit}`.trim() : '—';
          return (
            <Box component="section" aria-label={name} key={channel.id} sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Typography component="h2" variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                <Typography component="output" aria-live="off" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', color: stale ? 'text.secondary' : 'text.primary' }}>{value}{stale && latest ? ' · stale' : ''}</Typography>
              </Stack>
              <ScopePlot channel={channel} clock={clock} delay={delay} color={colors[channel.param] || '#9bc9d8'} scale={scale} decimals={decimals} label={`${name}: ${value}. Last 10 seconds${stale ? ', stale data' : ''}.`} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
