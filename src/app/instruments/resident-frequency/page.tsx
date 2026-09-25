import type { Metadata } from 'next';
import { ResidentVoices } from '@/components/voices/resident-voices';
import { DocsPage } from '@/layouts/docs/page';
import { getPage } from '@/content/site';

const page = getPage('/instruments/resident-frequency');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Instruments" mode="dashboard"><ResidentVoices /></DocsPage>;
}
