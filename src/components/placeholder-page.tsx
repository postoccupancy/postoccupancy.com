import Typography from '@mui/material/Typography';
import { getPage, groups } from '@/content/site';
import { DocsPage } from '@/layouts/docs/page';

export function PlaceholderPage({ href }: { href: string }) {
  const page = getPage(href);
  const section = groups.find((group) => group.items.some((item) => item.href === href));
  return (
    <DocsPage title={page.title} section={section?.title}>
      <Typography sx={{ maxWidth: '65ch', color: 'text.secondary' }}>{page.description}</Typography>
      {href !== '/' && <Typography variant="body2" sx={{ mt: 4, color: 'text.secondary' }}>Content is forthcoming.</Typography>}
    </DocsPage>
  );
}
