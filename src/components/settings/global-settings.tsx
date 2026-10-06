'use client';

import { useState } from 'react';
import Close from '@mui/icons-material/Close';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton, Slider, Stack, Typography } from '@mui/material';
import { RouterConnectionSettings } from './router-connection-settings';
import { useSettings } from './settings-provider';

const categories = ['General', 'Signals', 'Voices'] as const;
type Category = typeof categories[number];

export function GlobalSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category>('General');
  const { presentationDelay, setPresentationDelay } = useSettings();

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
            {category === 'Signals' && <Typography color="text.secondary" sx={{ mt: 2 }}>Signal settings will appear here.</Typography>}
            {category === 'Voices' && <Typography color="text.secondary" sx={{ mt: 2 }}>Voice settings will appear here.</Typography>}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
