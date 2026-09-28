'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Box } from '@mui/material';

const initialState = {
  mode: 0, angleSource: 'none', rateSource: 'none',
  values: { maxAngle: 45, maxRate: 0.2, smoothing: 0.05, oscDepth: 0.05, manualA: 0, manualB: 0, spacing: 12, thick: 5, blur: 0 },
  colors: { bg: { h: 0, s: 0, b: 100, o: 100 }, layerA: { h: 0, s: 0, b: 0, o: 73 }, layerB: { h: 0, s: 0, b: 0, o: 55 } },
  layers: { A: { mode: 'still', rev: false }, B: { mode: 'still', rev: false } },
};

function validSession(value: string | null) {
  return value !== null && /^[a-zA-Z0-9-]{8,128}$/.test(value);
}

export function PatternPartyPresentation() {
  const session = useSearchParams().get('session');
  const root = useRef<HTMLDivElement>(null);
  const state = useRef(initialState);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!validSession(session) || !root.current) return;
    let dispose: (() => void) | undefined;
    let active = true;
    const channel = new BroadcastChannel(`pattern-party:${session}`);
    channel.onmessage = (event) => {
      const message = event.data;
      if (message?.type === 'state' && message.state && typeof message.state === 'object') { state.current = message.state; setConnected(true); }
    };
    channel.postMessage({ type: 'ready' });
    import('@/lib/pattern-party/presentation-renderer').then(({ mountPresentation }) => { if (active && root.current) dispose = mountPresentation(root.current, state); });
    return () => { active = false; dispose?.(); channel.close(); };
  }, [session]);

  if (!validSession(session)) return <Box sx={{ width: '100vw', height: '100dvh', bgcolor: '#fff' }} />;
  return <Box ref={root} aria-label={connected ? 'Pattern Party presentation' : 'Waiting for Pattern Party controller'} sx={{ width: '100vw', height: '100dvh', overflow: 'hidden', bgcolor: '#fff', '& canvas': { display: 'block' } }} />;
}
