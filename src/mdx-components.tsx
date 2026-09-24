import type { MDXComponents } from 'mdx/types';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

// Markdown elements use the same MUI theme as the surrounding application.
const components: MDXComponents = {
  h2: ({ children, id }) => <Typography component="h2" variant="h2" id={id} sx={{ mt: 5, mb: 2 }}>{children}</Typography>,
  h3: ({ children, id }) => <Typography component="h3" variant="h6" id={id} sx={{ mt: 3, mb: 1.5 }}>{children}</Typography>,
  p: ({ children }) => <Typography component="p" sx={{ mb: 2.5 }}>{children}</Typography>,
  ul: ({ children }) => <Box component="ul" sx={{ pl: 3, mb: 3 }}>{children}</Box>,
  ol: ({ children }) => <Box component="ol" sx={{ pl: 3, mb: 3 }}>{children}</Box>,
  li: ({ children }) => <Typography component="li" sx={{ mb: 1 }}>{children}</Typography>,
  a: ({ children, href }) => <Link href={href} underline="hover">{children}</Link>,
  blockquote: ({ children }) => <Box component="blockquote" sx={{ mx: 0, my: 3, pl: 2.5, borderLeft: 3, borderColor: 'divider', color: 'text.secondary' }}>{children}</Box>,
  code: ({ children, className }) => <Box component="code" className={className} sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '0.875em' }}>{children}</Box>,
  pre: ({ children }) => <Box component="pre" sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, p: 2, my: 3, overflowX: 'auto', lineHeight: 1.7 }}>{children}</Box>,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
