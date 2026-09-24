'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';

type Controls = ReturnType<typeof import('@/lib/microphone/engine').mountMicrophone>;
interface MicState { running: boolean; pending: boolean; inputName: string; error: string }
const views = ['Waveform', 'Spectrum', 'Spectrogram'];

export function MicrophoneVisualizer() {
  const router = useSignalRouter();
  const root = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState(0);
  const [state, setState] = useState<MicState>({ running: false, pending: false, inputName: '', error: '' });
  useEffect(() => {
    let disposed = false;
    // p5 accesses window while loading. Import it only after mounting in a browser.
    import('@/lib/microphone/engine').then(({ mountMicrophone }) => {
      if (disposed) return;
      controls.current = mountMicrophone(root.current!, router, setState);
      setReady(true);
    }).catch(() => { if (!disposed) setState({ running: false, pending: false, inputName: '', error: 'Could not load the microphone visualizer. Reload to try again.' }); });
    return () => { disposed = true; controls.current?.dispose(); controls.current = null; };
  }, [router]);

  return <Box>
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
      <Button variant="outlined" disabled={!ready || state.pending} onClick={() => state.running ? controls.current?.stop() : void controls.current?.start()}>
        {state.pending ? 'Requesting microphone…' : state.running ? 'Stop microphone' : 'Enable microphone'}
      </Button>
      <Typography role="status" aria-label="Microphone status" variant="body2">{state.error || (state.running ? state.inputName : ready ? 'Microphone is off' : 'Loading visualizer…')}</Typography>
      <Typography variant="body2" role="status" aria-label="Microphone router connection" color="text.secondary">Router {router.status}</Typography>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Uses your browser’s selected microphone. Raw audio stays on this computer; five analysis values are sent to the Pi while this page is visible. There is no speaker playback.</Typography>

    <Box ref={root} sx={{ bgcolor: '#000', color: '#dce6ee', borderRadius: 1, overflow: 'hidden' }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ p: 1.5, flexWrap: 'wrap' }}>
        {views.map((name, index) => <Button key={name} size="small" aria-pressed={view === index} onClick={() => { setView(index); controls.current?.setView(index); }} sx={{ color: view === index ? '#000' : '#b4bdc4', bgcolor: view === index ? '#fff' : 'transparent', border: 1, borderColor: '#4b5156', '&:hover': { bgcolor: view === index ? '#ddd' : '#222' } }}>{name}</Button>)}
      </Stack>
      <Box data-mic="canvas" sx={{ width: '100%', height: 'clamp(280px, 60dvh, 640px)', '& canvas': { display: 'block', maxWidth: '100%' } }} />
      <Box aria-label="Microphone analysis" aria-live="off" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 2, p: 2, borderTop: '1px solid #26313a', fontVariantNumeric: 'tabular-nums' }}>
        {['rms', 'peak', 'bass', 'mid', 'high', 'centroid'].map((name) => <Typography key={name} variant="body2" component="div"><Box component="span" sx={{ color: '#9baab5', mr: 1 }}>{name.toUpperCase()}</Box><span data-mic={name}>—</span></Typography>)}
      </Box>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
      Keep this page visible and <Link href="/hubs/electric-sea" target="_blank" rel="noopener">open Electric Sea in another window</Link> to see the five <code>json/mic-…</code> signals. No MIDI bus is required. In Electric Sea, assign CH/CC and enable Send to port to convert them into local MIDI. Leaving this page releases the microphone.
    </Typography>
  </Box>;
}
