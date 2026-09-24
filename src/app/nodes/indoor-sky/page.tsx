import type { Metadata } from 'next';
import { DocsPage } from '@/layouts/docs/page';
import { NodeDashboard } from '@/components/signals/node-dashboard';
import { getPage } from '@/content/site';

const page = getPage('/nodes/indoor-sky');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Nodes" mode="dashboard"><NodeDashboard node="indoor-sky" /></DocsPage>;
}
