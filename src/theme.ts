'use client';

import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#365b4c' },
    background: { default: '#ffffff', paper: '#fafbfa' },
    text: { primary: '#202825', secondary: '#626c66' },
    divider: '#e5e9e6',
  },
  typography: {
    fontFamily: '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.25 },
    h2: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.025em' },
    body1: { fontSize: '0.9375rem', lineHeight: 1.8 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.6 },
    button: { textTransform: 'none' },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body': { height: '100%' },
        body: { margin: 0 },
        '*': { boxSizing: 'border-box' },
        '::selection': { backgroundColor: '#e0ebe5' },
        ':focus-visible': { outline: '2px solid #365b4c', outlineOffset: '3px' },
      },
    },
    MuiIconButton: { defaultProps: { size: 'small' } },
  },
});
