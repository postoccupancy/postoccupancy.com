'use client';

import { useState } from 'react';
import Close from '@mui/icons-material/Close';
import { Box, Dialog, DialogContent, DialogTitle, FormControl, FormControlLabel, IconButton, InputLabel, List, ListItemButton, MenuItem, Select, Slider, Stack, Switch, Typography } from '@mui/material';
import { RouterConnectionSettings } from './router-connection-settings';
import { useSettings } from './settings-provider';
import { spectralFftSizes, spectralWelchChoices, type SpectralFrequencyScale, type SpectralFftSize, type SpectralMode, type SpectralWelchSegments } from '@/lib/signals/spectral-settings';

const categories = ['General', 'Signals', 'Voices'] as const;
type Category = typeof categories[number];

export function GlobalSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category>('General');
  const settings = useSettings();
  const { presentationDelay, setPresentationDelay } = settings;

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
            {category === 'Signals' && <Stack spacing={2} sx={{ mt: 2, maxWidth: 420 }}>
              <Typography component="h3" variant="subtitle1">Spectral Analysis</Typography>
              <FormControl size="small">
                <InputLabel id="spectral-fft-size-label">FFT size</InputLabel>
                <Select labelId="spectral-fft-size-label" label="FFT size" value={settings.spectralFftSize} onChange={(event) => settings.setSpectralFftSize(event.target.value as SpectralFftSize)}>
                  {spectralFftSizes.map((size) => <MenuItem key={size} value={size}>{size === 'auto' ? 'Auto' : size}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel id="spectral-welch-label">Welch segments</InputLabel>
                <Select labelId="spectral-welch-label" label="Welch segments" value={settings.spectralWelchSegments} onChange={(event) => settings.setSpectralWelchSegments(Number(event.target.value) as SpectralWelchSegments)}>
                  {spectralWelchChoices.map((segments) => <MenuItem key={segments} value={segments}>{segments}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControlLabel control={<Switch checked={settings.spectralBandAverage} onChange={(event) => settings.setSpectralBandAverage(event.target.checked)} />} label="Band averaging" />
              <FormControl size="small">
                <InputLabel id="spectral-mode-label">Spectrum mode</InputLabel>
                <Select labelId="spectral-mode-label" label="Spectrum mode" value={settings.spectralMode} onChange={(event) => settings.setSpectralMode(event.target.value as SpectralMode)}>
                  <MenuItem value="relative">Relative</MenuItem><MenuItem value="raw">Raw</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small">
                <InputLabel id="spectral-frequency-scale-label">Frequency scale</InputLabel>
                <Select labelId="spectral-frequency-scale-label" label="Frequency scale" value={settings.spectralFrequencyScale} onChange={(event) => settings.setSpectralFrequencyScale(event.target.value as SpectralFrequencyScale)}>
                  <MenuItem value="log">Log</MenuItem><MenuItem value="linear">Linear</MenuItem><MenuItem value="expanded">Expanded</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="body2" color="text.secondary">Welch overlap: 50% (fixed)</Typography>
            </Stack>}
            {category === 'Voices' && <Typography color="text.secondary" sx={{ mt: 2 }}>Voice settings will appear here.</Typography>}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
