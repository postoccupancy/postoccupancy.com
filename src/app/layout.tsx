import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import '@fontsource-variable/inter';
import { DocsShell } from '@/layouts/docs/shell';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Post Occupancy',
  description: 'Documentation, instruments, and experiments in environmental sensing, sound, and software.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider>
          <Providers>
            <DocsShell>{children}</DocsShell>
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
