export interface SitePage {
  title: string;
  href: string;
  description: string;
  children?: SitePage[];
}

export interface NavigationGroup {
  title: string;
  id: string;
  items: SitePage[];
}

export const groups: NavigationGroup[] = [
  {
    title: 'Nodes', id: 'nodes', items: [
      { title: 'Signals', href: '/', description: 'Live environmental signals from the Electric Sky and Indoor Sky sensor nodes.' },
    ],
  },
  {
    title: 'Hubs', id: 'hubs', items: [
      { title: 'Electric Sea', href: '/hubs/electric-sea', description: 'An interface to the live signal router connecting environmental signals across Post Occupancy.' },
      { title: 'Weather Brain', href: '/hubs/weather-brain', description: 'Documentation and experiments for the AI Weather Station.' },
    ],
  },
  {
    title: 'Interfaces', id: 'interfaces', items: [
      { title: 'Time Series Observatory', href: '/interfaces/apartment-observatory', description: 'An interactive view of the apartment’s environmental observations.' },
      { title: 'Spectral Visualizer', href: '/interfaces/spectral-visualizer', description: 'Spectral views of selectable live signals.' },
      { title: 'Microphone Visualizer', href: '/interfaces/microphone-visualizer', description: 'An interactive microphone visualization using p5 and Web Audio.' },
    ],
  },
  {
    title: 'Instruments', id: 'instruments', items: [
      { title: 'Weather Music', href: '/instruments/supercollider-compositions', description: 'SuperCollider compositions, source code, and recordings.' },
      { title: 'Resident Frequency', href: '/instruments/resident-frequency', description: 'Documentation, source material, and recordings for Resident Frequency.' },
      { title: 'Pattern Party', href: '/instruments/processing-sketches', description: 'A collection of Processing sketches, with source code and documentation.' },
    ],
  },
  {
    title: 'Lab', id: 'lab', items: [
      { title: 'DSP for Artists', href: '/lab/dsp-for-artists', description: 'Sequential, interactive material exploring digital signal processing for artists.', children: [
        { title: 'Audio Processing', href: '/lab/dsp-for-artists/audio-processing', description: 'Lesson 1: audio analysis and time-frequency views.' },
        { title: 'Interference Patterns', href: '/lab/dsp-for-artists/interference-patterns', description: 'Lesson 2: traveling waves and interference.' },
        { title: 'Make Some Art', href: '/lab/dsp-for-artists/make-some-art', description: 'Lesson 3: a complete audiovisual instrument.' },
      ] },
      { title: 'Notes', href: '/lab/notes', description: 'Longer-form writing about the work, its processes, and the ideas behind it.' },
    ],
  },
];

export const pages = groups.flatMap((group) => group.items.flatMap((page) => [page, ...(page.children ?? [])]));

export function getPage(href: string): SitePage {
  const page = pages.find((page) => page.href === href);
  if (!page) throw new Error(`Missing page definition: ${href}`);
  return page;
}
