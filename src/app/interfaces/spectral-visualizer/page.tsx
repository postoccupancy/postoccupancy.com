import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SpectralVisualizer } from '@/components/visualizer/spectral-visualizer';
import { DocsPage } from '@/layouts/docs/page';
import { getPage } from '@/content/site';

const page = getPage('/interfaces/spectral-visualizer');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Interfaces" mode="dashboard">
    <Suspense fallback={<p>Loading visualizer…</p>}><SpectralVisualizer /></Suspense>
  </DocsPage>;
}
