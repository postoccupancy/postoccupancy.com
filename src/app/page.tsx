import type { Metadata } from 'next';
import { NodeDashboard } from '@/components/signals/node-dashboard';
import { getPage } from '@/content/site';
import { DocsPage } from '@/layouts/docs/page';

const page = getPage('/nodes/electric-sky');

export const metadata: Metadata = {
  title: `${page.title} | Post Occupancy`,
  description: page.description,
};

export default function Page() {
  return (
    <DocsPage title={page.title} section="Nodes" mode="dashboard">
      <NodeDashboard node="electric-sky" />
    </DocsPage>
  );
}