import type { Metadata } from 'next';
import { RouterDashboard } from '@/components/router/router-dashboard';
import { DocsPage } from '@/layouts/docs/page';
import { getPage } from '@/content/site';

const page = getPage('/interfaces/electric-sea');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy Media`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Interfaces" mode="dashboard"><RouterDashboard /></DocsPage>;
}
