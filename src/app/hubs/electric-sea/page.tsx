import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/placeholder-page';
import { getPage } from '@/content/site';

const page = getPage('/hubs/electric-sea');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <PlaceholderPage href="/hubs/electric-sea" />;
}
