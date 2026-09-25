export interface SitePage {
  title: string;
  href: string;
  description: string;
}

export interface NavigationGroup {
  title: string;
  id: string;
  items: SitePage[];
}

export const overview: SitePage = {
  title: 'Overview',
  href: '/',
  description: 'Post Occupancy brings together environmental sensing, sound, and software through connected nodes, hubs, interfaces, and instruments.',
};

export const groups: NavigationGroup[] = [
  {
    title: 'Nodes', id: 'nodes', items: [
      { title: 'Electric Sky', href: '/nodes/electric-sky', description: 'Live environmental observations and documentation for the Electric Sky sensor node.' },
      { title: 'Indoor Sky', href: '/nodes/indoor-sky', description: 'Live environmental observations and documentation for the Indoor Sky sensor node.' },
    ],
  },
  {
    title: 'Hubs', id: 'hubs', items: [
      { title: 'Electric Sea', href: '/hubs/electric-sea', description: 'An interface to the live signal router connecting environmental signals across Post Occupancy.' },
      { title: 'AI Weather Station', href: '/hubs/ai-weather-station', description: 'Documentation and experiments for the AI Weather Station.' },
    ],
  },
  {
    title: 'Interfaces', id: 'interfaces', items: [
      { title: 'Anomaly Monitor', href: '/interfaces/apartment-observatory', description: 'An interactive view of the apartment’s environmental observations.' },
      { title: 'Spectral Visualizer', href: '/interfaces/spectral-visualizer', description: 'Spectral views of selectable live signals.' },
      { title: 'Microphone Visualizer', href: '/interfaces/microphone-visualizer', description: 'An interactive microphone visualization using p5 and Web Audio.' },
    ],
  },
  {
    title: 'Instruments', id: 'instruments', items: [
      { title: 'Resident Frequency', href: '/instruments/resident-frequency', description: 'Documentation, source material, and recordings for Resident Frequency.' },
      { title: 'Pattern Party', href: '/instruments/processing-sketches', description: 'A collection of Processing sketches, with source code and documentation.' },
      { title: 'Weather Music', href: '/instruments/supercollider-compositions', description: 'SuperCollider compositions, source code, and recordings.' },
    ],
  },
  {
    title: 'Lab', id: 'lab', items: [
      { title: 'DSP for Artists', href: '/lab/dsp-for-artists', description: 'Sequential, interactive material exploring digital signal processing for artists.' },
      { title: 'Notes', href: '/lab/notes', description: 'Longer-form writing about the work, its processes, and the ideas behind it.' },
    ],
  },
];

export const pages = [overview, ...groups.flatMap((group) => group.items)];

export function getPage(href: string): SitePage {
  const page = pages.find((page) => page.href === href);
  if (!page) throw new Error(`Missing page definition: ${href}`);
  return page;
}
