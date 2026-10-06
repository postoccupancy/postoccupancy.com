'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useSettings } from '@/components/settings/settings-provider';
import { useSignalRouter } from './router-provider';
import { ScopePlot } from './scope-plot';

// Presentation hints only: incoming metadata determines which channels exist.
const labels: Record<string, string> = { temperature: 'Temperature', humidity: 'Humidity', pressure: 'Pressure', power: 'Power', 'solar-power': 'Solar input power', rms: 'Microphone RMS', 'solar-voltage': 'Solar voltage', 'solar-current': 'Solar current' };
const colors: Record<string, string> = { temperature: '#66ddff', humidity: '#75ee99', pressure: '#dd99ff', power: '#ffcc66', 'solar-power': '#ff9f43', rms: '#ff6688' };
const units: Record<string, string> = { celsius: '°C', percent: '%', hpa: 'hPa', dbfs: 'dBFS', volts: 'V', ma: 'mA', mw: 'W' };
const nodeLabel = (node: string) => node.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

export function SignalsDashboard() {
  const router = useSignalRouter();
  const { presentationDelay } = useSettings();
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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 3 }}>
        <Typography role="status" aria-label="Connection status" variant="body2" sx={{ color: fresh && router.status === 'connected' ? 'primary.main' : 'text.secondary' }}>{status}</Typography>
        <Typography variant="body2" color="text.secondary">· {Number(presentationDelay.toFixed(2))}s delay</Typography>
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
              <ScopePlot channel={channel} clock={router.clocks.get(channel.node)} delay={presentationDelay} color={colors[channel.param] || '#9bc9d8'} scale={scale} decimals={decimals} label={`${source} ${name}: ${value}. Last 10 seconds${stale ? ', stale data' : ''}.`} />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
