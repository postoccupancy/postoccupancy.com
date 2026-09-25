'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonGroup, FormControl, InputLabel, MenuItem, Select, Slider, Stack, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';

type Controls = ReturnType<typeof import('@/lib/pattern-party/engine').mountPatternParty>;

const parameters = [
  ['maxAngle', 'Max angle', 0, 90, 0.5], ['maxRate', 'Max rate', 0.005, 1, 0.005], ['smoothing', 'Smoothing', 0.01, 0.5, 0.01], ['oscDepth', 'Oscillation depth', 0, Math.PI, 0.01],
  ['manualA', 'Layer A angle', -90, 90, 0.5], ['manualB', 'Layer B angle', -90, 90, 0.5], ['spacing', 'Spacing', 4, 40, 1], ['thick', 'Thickness', 1, 20, 0.5], ['blur', 'Blur', 0, 10, 0.5],
] as const;
const colors = [['bg', 'Background', 100], ['layerA', 'Layer A', 73], ['layerB', 'Layer B', 55]] as const;

export function PatternParty() {
  const router = useSignalRouter();
  const root = useRef<HTMLDivElement>(null);
  const controls = useRef<Controls | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Router connection is shared with the site.');
  const [mode, setMode] = useState(0);
  const [angleSource, setAngleSource] = useState('none');
  const [rateSource, setRateSource] = useState('none');
  const [values, setValues] = useState<Record<string, number>>({ maxAngle: 45, maxRate: 0.2, smoothing: 0.05, oscDepth: 0.05, manualA: 0, manualB: 0, spacing: 12, thick: 5, blur: 0 });
  const [colourValues, setColourValues] = useState<Record<string, Record<string, number>>>({ bg: { h: 0, s: 0, b: 100, o: 100 }, layerA: { h: 0, s: 0, b: 0, o: 73 }, layerB: { h: 0, s: 0, b: 0, o: 55 } });
  const [layers, setLayers] = useState({ A: { mode: 'still', rev: false }, B: { mode: 'still', rev: false } });
  const sources = ['none', ...[...router.devices.keys()].filter((id) => !id.startsWith('audio/')).sort()];

  useEffect(() => {
    let disposed = false;
    import('@/lib/pattern-party/engine').then(({ mountPatternParty }) => {
      if (disposed || !root.current) return;
      controls.current = mountPatternParty(root.current, router, setStatus);
      setReady(true);
    }).catch(() => { if (!disposed) setStatus('Could not load Pattern Party. Reload to try again.'); });
    return () => { disposed = true; controls.current?.dispose(); controls.current = null; };
  }, [router]);
  const updateParam = (key: string, value: number) => { setValues((current) => ({ ...current, [key]: value })); controls.current?.setParam(key, value); };
  const updateColour = (target: string, key: string, value: number) => { setColourValues((current) => ({ ...current, [target]: { ...current[target], [key]: value } })); controls.current?.setColor(target, key, value); };
  const chooseSource = (kind: 'angle' | 'rate', value: string) => { if (kind === 'angle') setAngleSource(value); else setRateSource(value); controls.current?.setSource(kind, value); };

  return <Box>
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
      <Button disabled={!ready} variant="outlined" onClick={() => void controls.current?.enableMidi()}>Enable MIDI input</Button>
      <Typography variant="body2" role="status">{status}</Typography>
      <Typography variant="body2" color="text.secondary">Router {router.status}</Typography>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>A p5 adaptation of the original Moiré sketch. It uses the shared router for selectable live signals and publishes its four derived values under <code>json/moire/…</code>. MIDI access is optional and requested only by the button above.</Typography>
    <Box ref={root} sx={{ bgcolor: '#fff', border: 1, borderColor: 'divider', minHeight: 'clamp(320px, 62dvh, 720px)', position: 'relative', overflow: 'hidden', '& canvas': { display: 'block' } }}>
      <Box data-pattern-party="canvas" sx={{ position: 'absolute', inset: 0 }} />
      <Stack spacing={1} sx={{ position: 'absolute', top: 12, left: 12, zIndex: 1 }}>
        <ButtonGroup size="small" sx={{ bgcolor: 'rgba(255,255,255,0.9)' }}>{['Comb', 'Mesh', 'Rings'].map((name, index) => <Button key={name} variant={mode === index ? 'contained' : 'outlined'} onClick={() => { setMode(index); controls.current?.setMode(index); }}>{name}</Button>)}</ButtonGroup>
      </Stack>
    </Box>
    <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
      <Stack spacing={2}>
        {(['angle', 'rate'] as const).map((kind) => <FormControl key={kind} size="small"><InputLabel id={`${kind}-source-label`}>{kind === 'angle' ? 'Angle source' : 'Rate source'}</InputLabel><Select labelId={`${kind}-source-label`} label={kind === 'angle' ? 'Angle source' : 'Rate source'} value={kind === 'angle' ? angleSource : rateSource} onChange={(event) => chooseSource(kind, event.target.value)}>{sources.map((source) => <MenuItem key={source} value={source}>{source === 'none' ? 'None (manual only)' : source}</MenuItem>)}</Select></FormControl>)}
        {(['A', 'B'] as const).map((layer) => <Box key={layer}><Typography variant="overline">Layer {layer}</Typography><Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{(['still', 'osc', 'rot'] as const).map((value) => <Button key={value} size="small" variant={layers[layer].mode === value ? 'contained' : 'outlined'} onClick={() => { setLayers((current) => ({ ...current, [layer]: { ...current[layer], mode: value } })); controls.current?.setLayer(layer, 'mode', value); }}>{value}</Button>)}<Button size="small" variant={layers[layer].rev ? 'contained' : 'outlined'} onClick={() => { const rev = !layers[layer].rev; setLayers((current) => ({ ...current, [layer]: { ...current[layer], rev } })); controls.current?.setLayer(layer, 'rev', rev); }}>Reverse</Button></Stack></Box>)}
      </Stack>
      <Stack spacing={1.5}>{parameters.map(([key, label, min, max, step]) => <Box key={key}><Typography variant="body2">{label}: {key === 'oscDepth' ? `${Math.round(values[key] * 180 / Math.PI)}°` : values[key].toFixed(step < 1 ? 3 : 0)}</Typography><Slider aria-label={label} value={values[key]} min={min} max={max} step={step} onChange={(_, value) => updateParam(key, value as number)} /></Box>)}</Stack>
    </Box>
    <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}>{colors.map(([target, label]) => <Box key={target}><Typography variant="overline">{label}</Typography>{(['h', 's', 'b', ...(target === 'bg' ? [] : ['o'])] as const).map((key) => <Box key={key}><Typography variant="caption">{key.toUpperCase()} {Math.round(colourValues[target][key])}</Typography><Slider size="small" value={colourValues[target][key]} min={0} max={key === 'h' ? 360 : 100} onChange={(_, value) => updateColour(target, key, value as number)} /></Box>)}</Box>)}</Box>
  </Box>;
}
