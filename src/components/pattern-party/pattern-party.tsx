'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, Button, ButtonGroup, Divider, FormControl, InputLabel, MenuItem, Select, Slider, Stack, Typography } from '@mui/material';
import { useSignalRouter } from '@/components/signals/router-provider';

type Controls = ReturnType<typeof import('@/lib/pattern-party/engine').mountPatternParty>;

const parameters = [
  ['maxAngle', 'Max angle', 'Ch2 / Ch3 · CC1', 0, 90, 0.5], ['maxRate', 'Max rate', 'Ch2 / Ch3 · CC2', 0.005, 1, 0.005], ['smoothing', 'Smoothing', 'Ch2 / Ch3 · CC3', 0.01, 0.5, 0.01], ['oscDepth', 'Oscillation depth', 'Ch2 / Ch3 · CC4', 0, Math.PI, 0.01],
  ['manualA', 'Layer A angle', 'Ch1 · CC8 / Ch3 · CC5', -90, 90, 0.5], ['manualB', 'Layer B angle', 'Ch1 · CC13 / Ch3 · CC6', -90, 90, 0.5], ['spacing', 'Spacing', 'Ch1 · CC2', 4, 40, 1], ['thick', 'Thickness', 'Ch1 · CC1', 1, 20, 0.5], ['blur', 'Blur', 'Ch1 · CC3', 0, 10, 0.5],
] as const;
const colors = [
  ['bg', 'Background', [['h', 'Hue', 'Ch1 · CC14'], ['s', 'Saturation', 'Ch1 · CC16'], ['b', 'Brightness', 'Ch1 · CC15']]],
  ['layerA', 'Layer A', [['h', 'Hue', 'Ch1 · CC4'], ['s', 'Saturation', 'Ch1 · CC6'], ['b', 'Brightness', 'Ch1 · CC5'], ['o', 'Opacity', 'Ch1 · CC7']]],
  ['layerB', 'Layer B', [['h', 'Hue', 'Ch1 · CC9'], ['s', 'Saturation', 'Ch1 · CC11'], ['b', 'Brightness', 'Ch1 · CC10'], ['o', 'Opacity', 'Ch1 · CC12']]],
] as const;

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
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
      <Button disabled={!ready} variant="outlined" size="small" onClick={() => void controls.current?.enableMidi()}>Enable MIDI input</Button>
      <Typography variant="caption" role="status">{status}</Typography>
      <Typography variant="caption" color="text.secondary">Router {router.status}</Typography>
    </Stack>
    <Box ref={root} sx={{ border: 1, borderColor: 'divider', bgcolor: '#fff', display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 264px' }, height: { xs: 'auto', md: 'calc(100dvh - 205px)' }, minHeight: { xs: 480, md: 560 }, maxHeight: { md: 760 }, overflow: 'hidden', '& canvas': { display: 'block' } }}>
      <Box sx={{ minHeight: { xs: 420, md: 0 }, position: 'relative', overflow: 'hidden' }}>
        <Box data-pattern-party="canvas" sx={{ position: 'absolute', inset: 0 }} />
        <ButtonGroup size="small" sx={{ position: 'absolute', top: 12, left: 12, zIndex: 1, bgcolor: 'rgba(255,255,255,0.92)' }}>{['Comb', 'Mesh', 'Rings'].map((name, index) => <Button key={name} variant={mode === index ? 'contained' : 'outlined'} onClick={() => { setMode(index); controls.current?.setMode(index); }}>{name}</Button>)}</ButtonGroup>
      </Box>
      <Stack spacing={1.25} sx={{ borderLeft: { md: 1 }, borderTop: { xs: 1, md: 0 }, borderColor: 'divider', overflowY: { md: 'auto' }, p: 1.5, bgcolor: 'rgba(255,255,255,0.98)' }}>
        <Typography variant="overline" sx={{ lineHeight: 1 }}>Signal sources</Typography>
        {(['angle', 'rate'] as const).map((kind) => <FormControl key={kind} size="small"><InputLabel id={`${kind}-source-label`}>{kind === 'angle' ? 'Angle source' : 'Rate source'}</InputLabel><Select labelId={`${kind}-source-label`} label={kind === 'angle' ? 'Angle source' : 'Rate source'} value={kind === 'angle' ? angleSource : rateSource} onChange={(event) => chooseSource(kind, event.target.value)}>{sources.map((source) => <MenuItem key={source} value={source}>{source === 'none' ? 'None (manual only)' : source}</MenuItem>)}</Select></FormControl>)}
        <Divider />
        <Typography variant="overline" sx={{ lineHeight: 1 }}>Mapping</Typography>
        {parameters.slice(0, 4).map(([key, label, cc, min, max, step]) => <Box key={key}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}><Typography variant="caption">{label}</Typography><Typography variant="caption" color="text.secondary">{cc}</Typography></Stack><Slider size="small" aria-label={label} value={values[key]} min={min} max={max} step={step} onChange={(_, value) => updateParam(key, value as number)} /></Box>)}
        {(['A', 'B'] as const).map((layer) => <Box key={layer}><Divider sx={{ mb: 1 }} /><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="overline" sx={{ lineHeight: 1 }}>Layer {layer}</Typography><Typography variant="caption" color="text.secondary">Ch2 · N{layer === 'A' ? '36 / 37' : '38 / 39'}</Typography></Stack><Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>{(['still', 'osc', 'rot'] as const).map((value) => <Button key={value} size="small" sx={{ minWidth: 0, px: 0.75 }} variant={layers[layer].mode === value ? 'contained' : 'outlined'} onClick={() => { setLayers((current) => ({ ...current, [layer]: { ...current[layer], mode: value } })); controls.current?.setLayer(layer, 'mode', value); }}>{value}</Button>)}<Button size="small" sx={{ minWidth: 0, px: 0.75 }} variant={layers[layer].rev ? 'contained' : 'outlined'} onClick={() => { const rev = !layers[layer].rev; setLayers((current) => ({ ...current, [layer]: { ...current[layer], rev } })); controls.current?.setLayer(layer, 'rev', rev); }}>Rev</Button></Stack>{parameters.slice(layer === 'A' ? 4 : 5, layer === 'A' ? 5 : 6).map(([key, label, cc, min, max, step]) => <Box key={key} sx={{ mt: 0.5 }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption">{label}</Typography><Typography variant="caption" color="text.secondary">{cc}</Typography></Stack><Slider size="small" aria-label={label} value={values[key]} min={min} max={max} step={step} onChange={(_, value) => updateParam(key, value as number)} /></Box>)}</Box>)}
        <Divider />
        <Typography variant="overline" sx={{ lineHeight: 1 }}>Pattern · Ch1</Typography>
        {parameters.slice(6).map(([key, label, cc, min, max, step]) => <Box key={key}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption">{label}</Typography><Typography variant="caption" color="text.secondary">{cc}</Typography></Stack><Slider size="small" aria-label={label} value={values[key]} min={min} max={max} step={step} onChange={(_, value) => updateParam(key, value as number)} /></Box>)}
        {colors.map(([target, label, channels]) => <Box key={target}><Divider sx={{ mb: 1 }} /><Typography variant="overline" sx={{ lineHeight: 1 }}>{label} · Ch1</Typography>{channels.map(([key, name, cc]) => <Box key={key} sx={{ mt: 0.5 }}><Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="caption">{name}</Typography><Typography variant="caption" color="text.secondary">{cc}</Typography></Stack><Slider size="small" aria-label={`${label} ${name}`} value={colourValues[target][key]} min={0} max={key === 'h' ? 360 : 100} onChange={(_, value) => updateColour(target, key, value as number)} /></Box>)}</Box>)}
      </Stack>
    </Box>
  </Box>;
}
