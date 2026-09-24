'use client';

import { useRef, useState, type ReactNode } from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import MenuOpen from '@mui/icons-material/MenuOpen';
import Menu from '@mui/icons-material/Menu';
import { DocsNavigation } from './navigation';

const SIDEBAR_WIDTH = 280;

export function DocsShell({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktop = useMediaQuery(useTheme().breakpoints.up('md'));
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);

  function collapse() {
    setExpanded(false);
    requestAnimationFrame(() => opener.current?.focus());
  }

  function open() {
    if (desktop) {
      setExpanded(true);
      requestAnimationFrame(() => closer.current?.focus());
    } else {
      setMobileOpen(true);
    }
  }

  function sidebar(mobile: boolean) {
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, py: 3, gap: 1 }}>
          <Typography component={NextLink} href="/" onClick={() => setMobileOpen(false)} sx={{ color: 'text.primary', textDecoration: 'none', fontSize: 16, fontWeight: 600, letterSpacing: '-0.04em' }}>
            Post Occupancy
          </Typography>
          <Tooltip title={mobile ? 'Close navigation' : 'Collapse navigation'}>
            <IconButton ref={mobile ? undefined : closer} aria-label={mobile ? 'Close navigation' : 'Collapse navigation'} onClick={mobile ? () => setMobileOpen(false) : collapse}>
              <MenuOpen sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <DocsNavigation onNavigate={() => setMobileOpen(false)} />
      </>
    );
  }

  return (
    <Box sx={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <Box component="a" href="#main-content" sx={{ position: 'fixed', top: 8, left: 8, zIndex: 1500, transform: 'translateY(-200%)', '&:focus': { transform: 'none' }, bgcolor: 'background.default', color: 'primary.main', px: 2, py: 1 }}>
        Skip to content
      </Box>
      {expanded && (
        <Box component="aside" id="desktop-navigation" sx={{ display: { xs: 'none', md: 'block' }, width: SIDEBAR_WIDTH, flexShrink: 0, height: '100%', overflowY: 'auto', bgcolor: 'background.paper', borderRight: 1, borderColor: 'divider' }}>
          {sidebar(false)}
        </Box>
      )}
      <Drawer
        open={mobileOpen && !desktop}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { md: 'none' } }}
        slotProps={{ paper: { id: 'mobile-navigation', sx: { width: SIDEBAR_WIDTH, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        {sidebar(true)}
      </Drawer>
      <Tooltip title="Open navigation">
        <IconButton
          ref={opener}
          aria-label="Open navigation"
          aria-expanded={desktop ? expanded : mobileOpen}
          aria-controls={desktop ? (expanded ? 'desktop-navigation' : undefined) : (mobileOpen ? 'mobile-navigation' : undefined)}
          onClick={open}
          sx={{ display: { xs: 'inline-flex', md: expanded ? 'none' : 'inline-flex' }, position: 'fixed', zIndex: 1100, top: 12, left: 12, width: 36, height: 36, bgcolor: 'background.default', border: 1, borderColor: 'divider', '&:hover': { bgcolor: 'background.paper' } }}
        >
          <Menu sx={{ fontSize: 20 }} />
        </IconButton>
      </Tooltip>
      <Box component="main" id="main-content" tabIndex={-1} sx={{ flex: 1, minWidth: 0, height: '100%', overflowY: 'auto', '&:focus': { outline: 'none' } }}>
        {children}
      </Box>
    </Box>
  );
}
