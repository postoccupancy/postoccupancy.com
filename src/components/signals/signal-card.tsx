'use client';

import { useEffect, useRef, useState } from 'react';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import { Box, Button, Collapse, IconButton, Link, Slider, Stack, Typography } from '@mui/material';
import type { SignalAnalysisSettings } from '@/components/settings/settings-provider';
import type { Assignment } from '@/lib/router/router-interface';
import type { Channel, NodeClock } from '@/lib/signals/router-client';
import { useRouterInterface } from './router-provider';
import { SignalPlot, type SignalVisualization } from './signal-plot';

const routerOrigin = () => (process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com').replace(/^ws/, 'http');
const gainLabel = (power: number) => `${Number((2 ** power).toFixed(2))}×`;

function AssignmentInput({ signal, field, value, fallback, onChange }: {
  signal: string;
  field: keyof Assignment;
  value?: number;
  fallback: number | '';
  onChange: (value: string) => void;
}) {
  const shown = value ?? fallback;
  return <Box>
    <Typography component="label" htmlFor={`${signal}-${field}`} variant="caption" color="text.secondary">{field === 'channel' ? 'MIDI channel' : field.toUpperCase()}</Typography>
    <Box component="input" id={`${signal}-${field}`} type="number" key={String(shown)} defaultValue={shown}
      min={field === 'channel' ? 1 : field === 'cc' ? 0 : undefined} max={field === 'channel' ? 16 : field === 'cc' ? 127 : undefined}
      step={field === 'channel' || field === 'cc' ? 1 : 'any'} placeholder="—"
      onBlur={(event) => { if (event.currentTarget.validity.valid) onChange(event.currentTarget.value); else event.currentTarget.value = String(shown); }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      sx={{ display: 'block', width: '100%', mt: 0.5, p: 0.75, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: 'background.paper', color: 'text.primary', font: 'inherit' }} />
  </Box>;
}

function useSignalAudio(channel: Channel, gainPower: number) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const state = useRef<{ context: AudioContext; gain: GainNode; timer: ReturnType<typeof setInterval>; lastTime: number; nextStart: number; sources: Set<AudioBufferSourceNode> } | null>(null);

  const dispose = () => {
    const current = state.current;
    state.current = null;
    if (current) {
      clearInterval(current.timer);
      current.sources.forEach((source) => { try { source.stop(); } catch {} source.disconnect(); });
      void current.context.close();
    }
  };
  const stop = () => {
    dispose();
    setPlaying(false);
  };

  useEffect(() => { if (state.current) state.current.gain.gain.setTargetAtTime(2 ** gainPower, state.current.context.currentTime, 0.025); }, [gainPower]);
  useEffect(() => () => { mounted.current = false; dispose(); }, []);

  const start = async () => {
    setError('');
    try {
      const context = new AudioContext();
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass'; highpass.frequency.value = 0.001; highpass.Q.value = 0.707;
      const gain = context.createGain();
      gain.gain.value = 2 ** gainPower;
      highpass.connect(gain).connect(context.destination);
      await context.resume();
      if (!mounted.current) { void context.close(); return; }
      const latest = channel.ring.latest();
      const current = { context, gain, lastTime: latest?.t ?? -1, nextStart: context.currentTime + 0.15, sources: new Set<AudioBufferSourceNode>(), timer: 0 as unknown as ReturnType<typeof setInterval> };
      const feed = () => {
        if (state.current !== current || !(channel.sampleRate > 0)) return;
        const samples: { t: number; v: number }[] = [];
        channel.ring.visitRange(current.lastTime + Number.EPSILON, Infinity, (sample) => samples.push(sample));
        if (samples.length < 2) return;
        current.lastTime = samples.at(-1)!.t;
        let mean = 0;
        samples.forEach((sample) => { mean += sample.v; }); mean /= samples.length;
        let peak = 0;
        samples.forEach((sample) => { peak = Math.max(peak, Math.abs(sample.v - mean)); });
        const storageKey = `rf.scalarFullScale.osc/${channel.node}/${channel.param}`;
        let fullScale = Number(localStorage.getItem(storageKey)) || 0;
        if (!fullScale && peak) { fullScale = peak * 16; try { localStorage.setItem(storageKey, String(fullScale)); } catch {} }
        fullScale ||= 1;
        const duration = samples.length / channel.sampleRate;
        const outputLength = Math.max(1, Math.round(duration * context.sampleRate));
        const buffer = context.createBuffer(1, outputLength, context.sampleRate);
        const output = buffer.getChannelData(0);
        for (let index = 0; index < output.length; index++) {
          const position = index / Math.max(1, output.length - 1) * (samples.length - 1);
          const low = Math.floor(position); const high = Math.min(samples.length - 1, low + 1); const mix = position - low;
          output[index] = (samples[low].v * (1 - mix) + samples[high].v * mix) / fullScale;
        }
        const now = context.currentTime;
        if (current.nextStart < now + 0.02) current.nextStart = now + 0.15;
        const source = context.createBufferSource();
        source.buffer = buffer; source.connect(highpass); current.sources.add(source);
        source.onended = () => { current.sources.delete(source); source.disconnect(); };
        source.start(current.nextStart); current.nextStart += buffer.duration;
      };
      current.timer = setInterval(feed, 50);
      state.current = current;
      setPlaying(true);
    } catch {
      stop();
      setError('Audio could not start. Check browser audio permissions and try again.');
    }
  };

  return { playing, error, toggle: () => playing ? stop() : void start() };
}

export function SignalCard({ channel, clock, delay, color, scale, decimals, name, source, value, stale, visualization, windowSeconds, aggregationMs, analysisSettings }: {
  channel: Channel; clock?: NodeClock; delay: number; color: string; scale: number; decimals: number; name: string; source: string; value: string; stale: boolean;
  visualization: SignalVisualization; windowSeconds: number; aggregationMs: number; analysisSettings: SignalAnalysisSettings;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const audio = useSignalAudio(channel, gainPower);
  const custom = [assignment.channel !== undefined && `MIDI Ch ${assignment.channel}`, assignment.cc !== undefined && `CC ${assignment.cc}`, assignment.min !== undefined && `Min ${assignment.min}`, assignment.max !== undefined && `Max ${assignment.max}`, customGain && `Gain ${gainLabel(gainPower)}`, audio.playing && 'Audio playing'].filter(Boolean) as string[];
  const sourceUrl = new URL(`/${channel.node}/`, routerOrigin()).href;

  return <Box component="section" aria-label={`${source} ${name}`} sx={{ minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
    <Stack direction="row" spacing={1} sx={{ px: 1.5, py: 0.75, justifyContent: 'space-between', alignItems: 'center' }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
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
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'baseline' }, mb: 2 }}>
          <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{signal}</Typography>
          <Link href={sourceUrl} target="_blank" rel="noreferrer">Open {source} node ↗</Link>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(100px, 1fr))' }, gap: 1.5 }}>
          {(['channel', 'cc', 'min', 'max'] as const).map((field) => <AssignmentInput key={field} signal={signal} field={field} value={assignment[field]} fallback={field === 'min' ? row?.signal.min ?? 0 : field === 'max' ? row?.signal.max ?? 1 : ''} onChange={(next) => model.setAssignment(signal, field, next)} />)}
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
          <Box sx={{ flex: 1, maxWidth: 360 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography id={`${signal}-gain`} variant="caption">Gain</Typography><Typography variant="caption" color="text.secondary">{gainLabel(gainPower)}</Typography></Stack>
            <Slider aria-labelledby={`${signal}-gain`} value={gainPower} min={-6} max={15} step={1} size="small" onChange={(_, next) => { const value = Number(next); setGainPower(value); setCustomGain(true); try { localStorage.setItem(gainKey, String(value)); } catch {} }} />
          </Box>
          <Button variant={audio.playing ? 'contained' : 'outlined'} startIcon={audio.playing ? <Pause /> : <PlayArrow />} aria-pressed={audio.playing} onClick={audio.toggle}>{audio.playing ? 'Pause audio' : 'Start audio'}</Button>
        </Stack>
        {audio.error && <Typography role="status" variant="caption" color="error">{audio.error}</Typography>}
      </Box>
    </Collapse>
  </Box>;
}
