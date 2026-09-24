'use client';

import type { ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { theme } from '@/theme';
import { RouterProvider } from '@/components/signals/router-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider>{children}</RouterProvider>
    </ThemeProvider>
  );
}
