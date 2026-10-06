import type { Metadata } from 'next';
import { SignalsDashboard } from '@/components/signals/signals-dashboard';
import { getPage } from '@/content/site';
import { DocsPage } from '@/layouts/docs/page';

const page = getPage('/');

export const metadata: Metadata = {
  title: `${page.title} | Post Occupancy`,
  description: page.description,
};

export default function Page() {
  return (
    <DocsPage title={page.title} mode="dashboard">
      <SignalsDashboard />
    </DocsPage>
  );
}
