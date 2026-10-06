'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useSettings } from '@/components/settings/settings-provider';
import { formatAggregation, formatWindow, VISUALIZER_AGGREGATION_MS, VISUALIZER_WINDOWS_SECONDS } from '@/lib/visualizer/controls';
import { useSignalRouter } from './router-provider';
import { SignalCard } from './signal-card';
import type { SignalVisualization } from './signal-plot';

// Presentation hints only: incoming metadata determines which channels exist.
const labels: Record<string, string> = { temperature: 'Temperature', humidity: 'Humidity', pressure: 'Pressure', power: 'Power', 'solar-power': 'Solar input power', rms: 'Microphone RMS', 'solar-voltage': 'Solar voltage', 'solar-current': 'Solar current' };
const colors: Record<string, string> = { temperature: '#66ddff', humidity: '#75ee99', pressure: '#dd99ff', power: '#ffcc66', 'solar-power': '#ff9f43', rms: '#ff6688' };
const units: Record<string, string> = { celsius: '°C', percent: '%', hpa: 'hPa', dbfs: 'dBFS', volts: 'V', ma: 'mA', mw: 'W' };
const nodeLabel = (node: string) => node.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
const sensorTypes = ['Audio', 'Weather', 'Power'] as const;
type SensorType = typeof sensorTypes[number];
const nodes = ['electric-sky', 'indoor-sky'] as const;
const sensorOrder: Record<SensorType, string[]> = {
  Audio: ['rms', 'bass', 'mid', 'high', 'centroid'],
  Weather: ['temperature', 'humidity', 'absolute-humidity', 'pressure'],
  Power: ['power', 'solar-power', 'solar-voltage', 'solar-current'],
};
function sensorType(param: string): SensorType {
  const normalized = param.toLowerCase();
  if (sensorOrder.Power.includes(normalized) || normalized.includes('power') || normalized.includes('solar')) return 'Power';
  if (sensorOrder.Audio.includes(normalized) || normalized.includes('audio') || normalized.includes('pcm') || normalized.includes('frequency') || normalized.includes('band')) return 'Audio';
  return 'Weather';
}

export function SignalsDashboard() {
  const router = useSignalRouter();
  const { presentationDelay, signalAnalysis } = useSettings();
  const [visualization, setVisualization] = useState<SignalVisualization>('waveform');
  const [windowIndex, setWindowIndex] = useState(13);
  const [aggregationIndex, setAggregationIndex] = useState(0);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([...nodes]);
  const [selectedTypes, setSelectedTypes] = useState<SensorType[]>([...sensorTypes]);
  const windowSeconds = VISUALIZER_WINDOWS_SECONDS[windowIndex];
  const aggregationMs = VISUALIZER_AGGREGATION_MS[aggregationIndex];
  const channels = [...router.channels.values()];
  channels.sort((a, b) => {
    const aType = sensorType(a.param); const bType = sensorType(b.param);
    const typeOrder = sensorTypes.indexOf(aType) - sensorTypes.indexOf(bType);
    if (typeOrder) return typeOrder;
    const order = sensorOrder[aType];
    const aRank = order.includes(a.param) ? order.indexOf(a.param) : order.length;
    const bRank = order.includes(b.param) ? order.indexOf(b.param) : order.length;
    return aRank - bRank || a.param.localeCompare(b.param) || a.node.localeCompare(b.node);
  });
  const visibleChannels = channels.filter((channel) => selectedNodes.includes(channel.node) && selectedTypes.includes(sensorType(channel.param)));
  const now = router.now;
  const lastReceived = Math.max(0, ...channels.map((channel) => channel.receivedAt));
  const fresh = lastReceived > 0 && now - lastReceived < 5000;
  const status = router.status !== 'connected' ? `Router ${router.status}` : !lastReceived ? 'Router connected · waiting for signals' : fresh ? 'Live' : 'Router connected · signal data stale';

  return (
    <Box>
      <Stack spacing={2.5} sx={{ mb: 3 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography role="status" aria-label="Connection status" variant="body2" sx={{ color: fresh && router.status === 'connected' ? 'primary.main' : 'text.secondary' }}>{status}</Typography>
          <Typography variant="body2" color="text.secondary">· {Number(presentationDelay.toFixed(2))}s delay</Typography>
        </Stack>
        <Stack direction="row" spacing={2} useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <ToggleButtonGroup exclusive size="small" value={visualization} aria-label="Visualization type" onChange={(_, value: SignalVisualization | null) => { if (value) setVisualization(value); }} sx={{ flexWrap: 'wrap' }}>
            {(['waveform', 'spectrum', 'spectrogram', 'modulation'] as const).map((view) => <ToggleButton key={view} value={view} aria-label={view}>{view}</ToggleButton>)}
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', ml: 'auto' }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="signals-node-filter">Node</InputLabel>
              <Select labelId="signals-node-filter" label="Node" multiple value={selectedNodes} renderValue={(selected) => selected.length === nodes.length ? 'All nodes' : selected.map(nodeLabel).join(', ')} onChange={(event) => setSelectedNodes(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}>
                {nodes.map((node) => <MenuItem key={node} value={node}><Checkbox checked={selectedNodes.includes(node)} /><ListItemText primary={nodeLabel(node)} /></MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="signals-type-filter">Sensor type</InputLabel>
              <Select labelId="signals-type-filter" label="Sensor type" multiple value={selectedTypes} renderValue={(selected) => selected.length === sensorTypes.length ? 'All sensor types' : selected.join(', ')} onChange={(event) => setSelectedTypes((typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value) as SensorType[])}>
                {sensorTypes.map((type) => <MenuItem key={type} value={type}><Checkbox checked={selectedTypes.includes(type)} /><ListItemText primary={type} /></MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 2, md: 4 }, maxWidth: 900 }}>
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography id="signals-time-window" variant="body2">Time window</Typography>
              <Typography variant="body2" color="text.secondary">{formatWindow(windowSeconds)}</Typography>
            </Stack>
            <Slider aria-labelledby="signals-time-window" value={windowIndex} min={0} max={VISUALIZER_WINDOWS_SECONDS.length - 1} step={1} size="small" onChange={(_, value) => setWindowIndex(Number(value))} valueLabelDisplay="auto" valueLabelFormat={(value) => formatWindow(VISUALIZER_WINDOWS_SECONDS[value])} />
          </Box>
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography id="signals-aggregation" variant="body2">Aggregation</Typography>
              <Typography variant="body2" color="text.secondary">{formatAggregation(aggregationMs)}</Typography>
            </Stack>
            <Slider aria-labelledby="signals-aggregation" value={aggregationIndex} min={0} max={VISUALIZER_AGGREGATION_MS.length - 1} step={1} size="small" onChange={(_, value) => setAggregationIndex(Number(value))} valueLabelDisplay="auto" valueLabelFormat={(value) => formatAggregation(VISUALIZER_AGGREGATION_MS[value])} />
          </Box>
        </Box>
      </Stack>
      {!channels.length && <Typography color="text.secondary">Waiting for signal channels. Plots appear as data arrives.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {visibleChannels.map((channel) => {
          const name = labels[channel.param] || channel.param.replaceAll('-', ' ');
          const source = nodeLabel(channel.node);
          const unit = units[channel.unit.toLowerCase()] ?? channel.unit;
          const scale = channel.unit.toLowerCase() === 'mw' ? 0.001 : 1;
          const decimals = channel.param === 'rms' ? 2 : 4;
          const latest = channel.ring.latest();
          const stale = channel.receivedAt === 0 || now - channel.receivedAt >= 5000 || router.status !== 'connected';
          const value = latest ? `${(latest.v * scale).toFixed(decimals)} ${unit}`.trim() : '—';
          return <SignalCard key={channel.id} channel={channel} clock={router.clocks.get(channel.node)} delay={presentationDelay} color={colors[channel.param] || '#9bc9d8'} scale={scale} decimals={decimals} name={name} source={source} value={value} stale={stale} visualization={visualization} windowSeconds={windowSeconds} aggregationMs={aggregationMs} analysisSettings={signalAnalysis} />;
        })}
      </Box>
    </Box>
  );
}
