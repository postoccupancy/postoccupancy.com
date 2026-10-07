'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useSettings } from '@/components/settings/settings-provider';
import { useSignalRouter } from './router-provider';
import { ScopePlot } from './scope-plot';

// Presentation hints only: incoming metadata determines which channels exist.
const labels: Record<string, string> = { temperature: 'Temperature', humidity: 'Humidity', pressure: 'Pressure', power: 'Power', 'solar-power': 'Solar input power', rms: 'Microphone RMS', 'solar-voltage': 'Solar voltage', 'solar-current': 'Solar current' };
const colors: Record<string, string> = { temperature: '#66ddff', humidity: '#75ee99', pressure: '#dd99ff', power: '#ffcc66', 'solar-power': '#ff9f43', rms: '#ff6688' };
const units: Record<string, string> = { celsius: '°C', percent: '%', hpa: 'hPa', dbfs: 'dBFS', volts: 'V', ma: 'mA', mw: 'W' };
const nodeLabel = (node: string) => node.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
const windowChoices = [.05, .1, .25, .5, 1, 2, 5, 10, 30, 60] as const;

export function SignalsDashboard() {
  const router = useSignalRouter();
  const { presentationDelay } = useSettings();
  const [view, setView] = useState<'waveform' | 'spectrum' | 'spectrogram'>('waveform');
  const [windowIndex, setWindowIndex] = useState(7);
  const windowSeconds = windowChoices[windowIndex];
  const channels = [...router.channels.values()];
  channels.sort((a, b) => {
    const nodeOrder = a.node.localeCompare(b.node);
    if (nodeOrder) return nodeOrder;
    const order = Object.keys(labels);
    const rank = (param: string) => order.includes(param) ? order.indexOf(param) : order.length;
    return rank(a.param) - rank(b.param) || a.param.localeCompare(b.param);
  });
  const now = router.now;
  const lastReceived = Math.max(0, ...channels.map((channel) => channel.receivedAt));
  const fresh = lastReceived > 0 && now - lastReceived < 5000;
  const status = router.status !== 'connected' ? `Router ${router.status}` : !lastReceived ? 'Router connected · waiting for signals' : fresh ? 'Live' : 'Router connected · signal data stale';

  return (
    <Box>
      <Stack spacing={2} sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography role="status" aria-label="Connection status" variant="body2" sx={{ color: fresh && router.status === 'connected' ? 'primary.main' : 'text.secondary' }}>{status}</Typography>
          <Typography variant="body2" color="text.secondary">· {Number(presentationDelay.toFixed(2))}s delay</Typography>
        </Stack>
        <ToggleButtonGroup exclusive size="small" value={view} aria-label="Visualization view" onChange={(_, next) => { if (next) setView(next); }}>
          <ToggleButton value="waveform">Waveform</ToggleButton>
          <ToggleButton value="spectrum">Spectrum</ToggleButton>
          <ToggleButton value="spectrogram">Spectrogram</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ maxWidth: 420 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography id="signals-time-window" variant="body2">Time Window</Typography>
            <Typography variant="body2" color="text.secondary">{windowSeconds} s</Typography>
          </Stack>
          <Slider aria-labelledby="signals-time-window" value={windowIndex} min={0} max={windowChoices.length - 1} step={1} size="small"
            onChange={(_, next) => setWindowIndex(Number(next))} valueLabelDisplay="auto" valueLabelFormat={(index) => `${windowChoices[index]} s`} />
        </Box>
      </Stack>
      {!channels.length && <Typography color="text.secondary">Waiting for signal channels. Plots appear as data arrives.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {channels.map((channel) => {
          const name = labels[channel.param] || channel.param.replaceAll('-', ' ');
          const source = nodeLabel(channel.node);
          const unit = units[channel.unit.toLowerCase()] ?? channel.unit;
          const scale = channel.unit.toLowerCase() === 'mw' ? 0.001 : 1;
          const decimals = channel.param === 'rms' ? 2 : 4;
          const latest = channel.ring.latest();
          const stale = channel.receivedAt === 0 || now - channel.receivedAt >= 5000 || router.status !== 'connected';
          const value = latest ? `${(latest.v * scale).toFixed(decimals)} ${unit}`.trim() : '—';
          return (
            <Box component="section" aria-label={`${source} ${name}`} key={channel.id} sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
              <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 1, justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                  <Typography component="h2" variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
                  <Typography variant="caption" color="text.secondary">{source}</Typography>
                </Stack>
                <Typography component="output" aria-live="off" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', color: stale ? 'text.secondary' : 'text.primary' }}>{value}{stale && latest ? ' · stale' : ''}</Typography>
              </Stack>
              {view === 'waveform'
                ? <ScopePlot channel={channel} clock={router.clocks.get(channel.node)} delay={presentationDelay} color={colors[channel.param] || '#9bc9d8'} scale={scale} decimals={decimals} windowSeconds={windowSeconds} label={`${source} ${name}: ${value}. Last ${windowSeconds} seconds${stale ? ', stale data' : ''}.`} />
                : <Box role="img" aria-label={`${source} ${name} ${view} placeholder`} sx={{ display: 'grid', placeItems: 'center', width: '100%', height: 170, bgcolor: 'whitesmoke', color: 'text.secondary' }}>
                    <Typography variant="body2">{view === 'spectrum' ? 'Spectrum' : 'Spectrogram'} coming soon</Typography>
                  </Box>}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
