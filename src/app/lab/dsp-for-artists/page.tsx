import type { Metadata } from 'next';
import { DocsPage } from '@/layouts/docs/page';
import Content from '@/content/lab/dsp-for-artists.mdx';
import { getPage } from '@/content/site';

const page = getPage('/lab/dsp-for-artists');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return (
    <DocsPage title={page.title} section="Lab">
      <Content />
    </DocsPage>
  );
}
