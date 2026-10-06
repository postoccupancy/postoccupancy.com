'use client';

import { useState } from 'react';
import Close from '@mui/icons-material/Close';
import { Box, Button, Checkbox, Dialog, DialogContent, DialogTitle, FormControlLabel, IconButton, List, ListItemButton, MenuItem, Select, Slider, Stack, Typography } from '@mui/material';
import { RouterConnectionSettings } from './router-connection-settings';
import { useSettings } from './settings-provider';

const categories = ['General', 'Signals', 'Voices'] as const;
type Category = typeof categories[number];

export function GlobalSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category>('General');
  const { presentationDelay, setPresentationDelay, signalAnalysis, updateSignalAnalysis } = useSettings();
  const welchSegments = [1, 2, 4, 8, 16];
  const frequencyScales = ['expanded', 'log', 'linear'] as const;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="settings-title">
      <DialogTitle id="settings-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 3 }}>
        Settings
        <IconButton aria-label="Close settings" onClick={onClose}><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px minmax(0, 1fr)' }, minHeight: 480 }}>
          <List aria-label="Settings categories" sx={{ borderRight: { sm: 1 }, borderBottom: { xs: 1, sm: 0 }, borderColor: 'divider', p: 1.5 }}>
            {categories.map((name) => <ListItemButton key={name} selected={category === name} onClick={() => setCategory(name)} sx={{ borderRadius: 1 }}>{name}</ListItemButton>)}
          </List>
          <Box sx={{ px: { xs: 2, sm: 3 }, py: 2.5, minWidth: 0, overflow: 'auto' }}>
            <Typography component="h2" variant="h6">{category}</Typography>
            {category === 'General' && <>
              <Stack spacing={0.5} sx={{ mt: 2, maxWidth: 360 }}>
                <Typography id="global-presentation-delay" variant="body2">Presentation delay: {presentationDelay.toFixed(2)} s</Typography>
                <Slider aria-labelledby="global-presentation-delay" value={presentationDelay} min={0.5} max={10} step={0.25} size="small" onChange={(_, value) => setPresentationDelay(Number(value))} />
              </Stack>
              <RouterConnectionSettings />
            </>}
            {category === 'Signals' && <Stack spacing={2.5} sx={{ mt: 2, maxWidth: 520 }}>
              <Box>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography id="global-fft" variant="body2">FFT</Typography><Typography variant="body2" color="text.secondary">{2 ** signalAnalysis.fftPower}</Typography></Stack>
                <Slider aria-labelledby="global-fft" value={signalAnalysis.fftPower} min={7} max={14} step={1} size="small" onChange={(_, value) => updateSignalAnalysis({ fftPower: Number(value) })} valueLabelDisplay="auto" valueLabelFormat={(value) => 2 ** value} />
              </Box>
              <Box>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography id="global-welch" variant="body2">Welch</Typography><Typography variant="body2" color="text.secondary">{welchSegments[signalAnalysis.welchIndex]}</Typography></Stack>
                <Slider aria-labelledby="global-welch" value={signalAnalysis.welchIndex} min={0} max={4} step={1} size="small" onChange={(_, value) => updateSignalAnalysis({ welchIndex: Number(value) })} valueLabelDisplay="auto" valueLabelFormat={(value) => welchSegments[value]} />
              </Box>
              <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
                <FormControlLabel control={<Checkbox checked={signalAnalysis.bands} onChange={(event) => updateSignalAnalysis({ bands: event.target.checked })} />} label="Bands" />
                <FormControlLabel control={<Checkbox checked={signalAnalysis.smooth} onChange={(event) => updateSignalAnalysis({ smooth: event.target.checked })} />} label="Smooth" />
                <FormControlLabel control={<Checkbox checked={signalAnalysis.centroid} onChange={(event) => updateSignalAnalysis({ centroid: event.target.checked })} />} label="Centroid" />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button variant="outlined" onClick={() => updateSignalAnalysis({ frequencyScale: frequencyScales[(frequencyScales.indexOf(signalAnalysis.frequencyScale) + 1) % frequencyScales.length] })}>Frequency: {signalAnalysis.frequencyScale}</Button>
                <Button variant="outlined" onClick={() => updateSignalAnalysis({ spectrumMode: signalAnalysis.spectrumMode === 'raw' ? 'relative' : 'raw' })}>Spectrum: {signalAnalysis.spectrumMode}</Button>
              </Stack>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Typography id="global-palette" variant="body2">Color palette</Typography>
                <Select inputProps={{ 'aria-label': 'Color palette' }} size="small" value={signalAnalysis.palette} onChange={(event) => updateSignalAnalysis({ palette: event.target.value as typeof signalAnalysis.palette })} sx={{ minWidth: 140 }}>
                  {['viridis', 'plasma', 'inferno', 'magma', 'cividis'].map((palette) => <MenuItem key={palette} value={palette}>{palette}</MenuItem>)}
                </Select>
              </Stack>
            </Stack>}
            {category === 'Voices' && <Typography color="text.secondary" sx={{ mt: 2 }}>Voice settings will appear here.</Typography>}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
