'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Typography from '@mui/material/Typography';

export function DocsPage({ title, section, children, mode = 'article' }: {
  title: string;
  section?: string;
  children: ReactNode;
  mode?: 'article' | 'dashboard' | 'viewport';
}) {
  // Applications can fill the main viewport without an article header or margins.
  if (mode === 'viewport') return <Box aria-label={title} sx={{ width: '100%', height: '100%', minHeight: 0 }}>{children}</Box>;

  return (
    <Box component="article" sx={{ maxWidth: mode === 'dashboard' ? 'none' : 960, mx: 'auto', px: { xs: 3, sm: 5, lg: 7 }, pt: { xs: 8, md: 7 }, pb: 8 }}>
      {section && (
        <Breadcrumbs aria-label="Breadcrumb" separator="/" sx={{ mb: 3, fontSize: 12, '& .MuiBreadcrumbs-separator': { mx: 1.25, color: 'divider' } }}>
          <Typography component="span" sx={{ fontSize: 'inherit' }}>{section}</Typography>
          <Typography component="span" aria-current="page" sx={{ fontSize: 'inherit', color: 'text.primary' }}>{title}</Typography>
        </Breadcrumbs>
      )}
      <Typography component="h1" variant="h1" sx={{ mb: 2 }}>{title}</Typography>
      {children}
    </Box>
  );
}
