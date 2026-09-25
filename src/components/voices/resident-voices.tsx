'use client';

import { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';
import { mountVoices } from '@/lib/voices/engine';
import { voicesTemplate } from '@/lib/voices/template';
import styles from './voices.module.css';

export function ResidentVoices() {
  const router = useSignalRouter();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The original controls own this isolated subtree. Template is local/static;
    // received strings use textContent and voice fields are validated numbers.
    root.current!.innerHTML = voicesTemplate;
    return mountVoices(root.current!, router);
  }, [router]);
  return <Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>Live voice extraction from the Pi. Streams become ready as analysis fills its observation window. Start audio for a device, or enable MIDI and select a local output.</Typography>
    <div ref={root} className={styles.surface} aria-label="Resident voices controls" />
    <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>Notes controls affect both browser audio and MIDI notes. Beat CC can be routed per stream, per device, or across all devices; width and center controls appear when a CC route sends. Panic stops MIDI output. Leaving this page releases its audio and MIDI ports.</Typography>
  </Box>;
}
