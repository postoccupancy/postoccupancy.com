import type { Metadata } from 'next';
import { MicrophoneVisualizer } from '@/components/microphone/microphone-visualizer';
import { DocsPage } from '@/layouts/docs/page';
import { getPage } from '@/content/site';

const page = getPage('/interfaces/microphone-visualizer');
export const metadata: Metadata = { title: `${page.title} | Post Occupancy`, description: page.description };

export default function Page() {
  return <DocsPage title={page.title} section="Interfaces" mode="dashboard"><MicrophoneVisualizer /></DocsPage>;
}
