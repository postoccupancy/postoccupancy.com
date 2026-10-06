'use client';

import type { ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '@/theme';
import { RouterProvider } from '@/components/signals/router-provider';
import { SettingsProvider } from '@/components/settings/settings-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider><SettingsProvider>{children}</SettingsProvider></RouterProvider>
    </ThemeProvider>
  );
}
