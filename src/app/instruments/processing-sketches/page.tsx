import type { Metadata } from 'next';
import { PatternParty } from '@/components/pattern-party/pattern-party';
import { DocsPage } from '@/layouts/docs/page';
import { getPage } from '@/content/site';

const page = getPage('/instruments/processing-sketches');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Instruments" mode="dashboard"><PatternParty /></DocsPage>;
}
