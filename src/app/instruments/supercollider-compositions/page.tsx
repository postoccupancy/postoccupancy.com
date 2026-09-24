import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/placeholder-page';
import { getPage } from '@/content/site';

const page = getPage('/instruments/supercollider-compositions');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <PlaceholderPage href="/instruments/supercollider-compositions" />;
}
