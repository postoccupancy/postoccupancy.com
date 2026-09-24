import Link from 'next/link';
import Typography from '@mui/material/Typography';
import { DocsPage } from '@/layouts/docs/page';

export default function NotFound() {
  return (
    <DocsPage title="Page not found">
      <Typography sx={{ mb: 2 }}>This page does not exist.</Typography>
      <Link href="/">Return to Overview</Link>
    </DocsPage>
  );
}
