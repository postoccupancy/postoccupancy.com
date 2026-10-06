'use client';

import { useEffect, useRef, useState } from 'react';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import { Box, Button, Collapse, IconButton, Slider, Stack, Typography } from '@mui/material';
import type { SignalAnalysisSettings } from '@/components/settings/settings-provider';
import { VisualizerSurface } from '@/components/visualizer/visualizer-surface';
import type { Assignment } from '@/lib/router/router-interface';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { useRouterInterface, useSignalRouter } from './router-provider';
import { SignalPlot, type SignalVisualization } from './signal-plot';

const gainLabel = (power: number) => `${Number((2 ** power).toFixed(2))}×`;

function AssignmentInput({ signal, field, value, fallback, onChange }: {
  signal: string;
  field: keyof Assignment;
  value?: number;
  fallback: number | '';
  onChange: (value: string) => void;
}) {
  const shown = value ?? fallback;
  if (field === 'channel' || field === 'cc') {
    const options = field === 'channel' ? Array.from({ length: 16 }, (_, index) => index + 1) : Array.from({ length: 128 }, (_, index) => index);
    return <Box>
      <Typography component="label" htmlFor={`${signal}-${field}`} variant="caption" color="text.secondary">{field === 'channel' ? 'MIDI channel' : 'CC'}</Typography>
      <Box component="select" id={`${signal}-${field}`} value={value ?? ''} onChange={(event) => onChange(event.currentTarget.value)}
        sx={{ display: 'block', width: '100%', mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'background.paper', color: 'text.primary', font: 'inherit' }}>
        <option value="">—</option>
        {options.map((option) => <option key={option} value={option}>{field === 'cc' ? `CC ${option}` : option}</option>)}
      </Box>
    </Box>;
  }
  return <Box>
    <Typography component="label" htmlFor={`${signal}-${field}`} variant="caption" color="text.secondary">{field.toUpperCase()}</Typography>
    <Box component="input" id={`${signal}-${field}`} type="number" key={String(shown)} defaultValue={shown}
      step="any" placeholder="—"
      onBlur={(event) => { if (event.currentTarget.validity.valid) onChange(event.currentTarget.value); else event.currentTarget.value = String(shown); }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      sx={{ display: 'block', width: '100%', mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'background.paper', color: 'text.primary', font: 'inherit' }} />
  </Box>;
}

export function SignalCard({ channel, clock, delay, color, scale, decimals, name, source, value, stale, visualization, windowSeconds, aggregationMs, analysisSettings }: {
  channel: Channel; clock?: NodeClock; delay: number; color: string; scale: number; decimals: number; name: string; source: string; value: string; stale: boolean;
  visualization: SignalVisualization; windowSeconds: number; aggregationMs: number; analysisSettings: SignalAnalysisSettings;
}) {
  const [expanded, setExpanded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRoot = useRef<HTMLDivElement>(null);
  const router = useSignalRouter();
  const signal = `osc/${channel.node}/${channel.param}`;
  const gainKey = `rf-signal-gain-${signal}`;
  const [gainPower, setGainPower] = useState(2);
  const [customGain, setCustomGain] = useState(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = localStorage.getItem(gainKey);
        if (saved !== null && Number.isFinite(Number(saved))) { setGainPower(Number(saved)); setCustomGain(true); }
      } catch {}
    });
    return () => { active = false; };
  }, [gainKey]);
  const model = useRouterInterface();
  const row = model.rows.get(signal);
  const assignment = row?.assignment ?? {};
  const custom = [assignment.channel !== undefined && `MIDI Ch ${assignment.channel}`, assignment.cc !== undefined && `CC ${assignment.cc}`, assignment.min !== undefined && `Min ${assignment.min}`, assignment.max !== undefined && `Max ${assignment.max}`, customGain && `Gain ${gainLabel(gainPower)}`, playing && 'Audio playing'].filter(Boolean) as string[];
  const audioMounted = expanded || playing;

  useEffect(() => {
    if (!audioMounted || !audioRoot.current) return;
    const button = audioRoot.current.querySelector<HTMLButtonElement>('[data-viz="audio"]');
    const gain = audioRoot.current.querySelector<HTMLInputElement>('[data-viz="gainControl"]');
    if (!button || !gain) return;
    gain.value = String(gainPower);
    gain.dispatchEvent(new Event('input', { bubbles: true }));
    const update = () => setPlaying(button.getAttribute('aria-pressed') === 'true');
    update();
    const observer = new MutationObserver(update);
    observer.observe(button, { attributes: true, attributeFilter: ['aria-pressed'] });
    return () => observer.disconnect();
  }, [audioMounted, gainPower]);

  function toggleAudio() {
    const button = audioRoot.current?.querySelector<HTMLButtonElement>('[data-viz="audio"]');
    if (button && !button.disabled) button.click();
  }

  function updateGain(next: number) {
    setGainPower(next); setCustomGain(true);
    try { localStorage.setItem(gainKey, String(next)); } catch {}
    const gain = audioRoot.current?.querySelector<HTMLInputElement>('[data-viz="gainControl"]');
    if (gain) { gain.value = String(next); gain.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  return <Box component="section" aria-label={`${source} ${name}`} sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
    <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 0.75, justifyContent: 'space-between', alignItems: 'center' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
        <IconButton size="small" aria-label={`${expanded ? 'Close' : 'Open'} settings for ${signal}`} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} sx={{ ml: -0.75 }}><ExpandMore sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} /></IconButton>
        <Typography component="h2" variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
        <Typography variant="caption" color="text.secondary">{source}</Typography>
      </Stack>
      <Typography component="output" aria-live="off" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', color: stale ? 'text.secondary' : 'text.primary' }}>{value}{stale && channel.ring.latest() ? ' · stale' : ''}</Typography>
    </Stack>
    <SignalPlot channel={channel} clock={clock} delay={delay} color={color} scale={scale} decimals={decimals} visualization={visualization} windowSeconds={windowSeconds} aggregationMs={aggregationMs} analysisSettings={analysisSettings} label={`${source} ${name}: ${value}${stale ? ', stale data' : ''}.`} />
    {!expanded && !!custom.length && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.75 }}>{custom.join(' · ')}</Typography>}
    <Collapse in={expanded} unmountOnExit>
      <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ mb: 2, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{signal}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(100px, 1fr))' }, gap: 1.5 }}>
          {(['channel', 'cc', 'min', 'max'] as const).map((field) => <AssignmentInput key={field} signal={signal} field={field} value={assignment[field]} fallback={field === 'min' ? row?.signal.min ?? 0 : field === 'max' ? row?.signal.max ?? 1 : ''} onChange={(next) => model.setAssignment(signal, field, next)} />)}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
          <Box sx={{ flex: 1, maxWidth: 360 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography id={`${signal}-gain`} variant="caption">Gain</Typography><Typography variant="caption" color="text.secondary">{gainLabel(gainPower)}</Typography></Stack>
            <Slider aria-labelledby={`${signal}-gain`} value={gainPower} min={-6} max={15} step={1} size="small" onChange={(_, next) => updateGain(Number(next))} />
          </Box>
          <Button variant={playing ? 'contained' : 'outlined'} startIcon={playing ? <Pause /> : <PlayArrow />} aria-pressed={playing} onClick={toggleAudio}>{playing ? 'Pause audio' : 'Start audio'}</Button>
        </Stack>
      </Box>
    </Collapse>
    {audioMounted && <Box ref={audioRoot} sx={{ display: 'none' }}><VisualizerSurface device={signal} router={router} audioOnly /></Box>}
  </Box>;
}
