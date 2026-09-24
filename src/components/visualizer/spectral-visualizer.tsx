'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box, Stack, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';
import { VisualizerSurface } from './visualizer-surface';

function selectDevice(device: string, replace = false) {
  const url = new URL(window.location.href);
  if (device) url.searchParams.set('device', device); else url.searchParams.delete('device');
  if (replace) window.history.replaceState(null, '', url); else window.history.pushState(null, '', url);
}

export function SpectralVisualizer() {
  const router = useSignalRouter();
  const params = useSearchParams();
  const device = params.get('device') || '';
  const devices = [...router.devices.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Default only to a scalar; discovering audio must not silently enable a mic.
  const firstScalar = devices.find((item) => item.kind === 'scalar')?.id;
  useEffect(() => { if (!device && firstScalar) selectDevice(firstScalar, true); }, [device, firstScalar]);
  const needsAudioSource = device.startsWith('pcm/') || /^osc\/[^/]+\/(bass|mid|high|centroid)$/.test(device);
  return <Box>
    <Stack spacing={1} sx={{ mb: 3 }}>
      <Typography component="label" htmlFor="visualizer-device" variant="body2">Signal</Typography>
      <Box component="select" id="visualizer-device" value={device} onChange={(event) => selectDevice(event.target.value)} sx={{ width: '100%', maxWidth: 640, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', color: 'text.primary', font: 'inherit' }}>
        {!device && <option value="">{devices.length ? 'Choose a signal' : 'Waiting for signals…'}</option>}
        {device && !router.devices.has(device) && <option value={device}>{device} (waiting for signal)</option>}
        {devices.map((item) => <option key={item.id} value={item.id}>{item.id}{item.kind === 'audio' ? ' · PCM audio' : item.unit ? ` · ${item.unit}` : ''}</option>)}
      </Box>
      <Typography variant="body2" color="text.secondary">{needsAudioSource ? 'This selection enables its audio source on the router. Press Start audio to listen on this computer.' : 'Choose any discovered signal, or open a link with a device query parameter.'}</Typography>
    </Stack>
    {device ? <VisualizerSurface key={device} device={device} router={router} /> : <Typography role="status" color="text.secondary">Router {router.status} · waiting for a signal selection.</Typography>}
  </Box>;
}
