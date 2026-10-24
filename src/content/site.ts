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
    title: 'Lab', id: 'lab', items: [
      { title: 'DSP for Artists', href: '/', description: 'Sequential, interactive material exploring digital signal processing for artists.', children: [
        { title: 'Harmonics', href: '/lab/dsp-for-artists/audio-processing', description: 'Lesson 1: audio analysis and time-frequency views.' },
        { title: 'Interference', href: '/lab/dsp-for-artists/interference-patterns', description: 'Lesson 2: traveling waves and interference.' },
        { title: 'Sandbox', href: '/lab/dsp-for-artists/make-some-art', description: 'Lesson 3: a complete audiovisual instrument.' },
      ] },
    ],
  },
  {
    title: 'Sensors', id: 'sensors', items: [
      { title: 'Indoor Sky', href: '/nodes/indoor-sky', description: 'Live environmental signals from the Electric Sky and Indoor Sky sensor nodes.' },
    ],
  },
  {
    title: 'Interfaces', id: 'interfaces', items: [
      { title: 'Electric Sea', href: '/interfaces/electric-sea', description: 'An interface to the live signal router connecting environmental signals across the Post Occupancy Media network.' },
      { title: 'Spectral Weather', href: '/interfaces/spectral-visualizer', description: 'Spectral views of selectable live signals.' },
      { title: 'Microphone', href: '/interfaces/microphone-visualizer', description: 'An interactive microphone visualization using p5 and Web Audio.' },
    ],
  },
  {
    title: 'Instruments', id: 'instruments', items: [
      { title: 'Wave Interference', href: '/instruments/wave-interference', description: 'Microphone-driven spectral and plane-wave interference for exhibition display.' },
      { title: 'Signal Voices', href: '/instruments/resident-frequency', description: 'Live tracked environmental voices with browser audio and MIDI output.' },
      { title: 'Moire Patterns', href: '/instruments/processing-sketches', description: 'An interactive collection of signal-driven moire patterns.' },
    ],
  },
];

export const pages = groups.flatMap((group) => group.items.flatMap((page) => [page, ...(page.children ?? [])]));

export function getPage(href: string): SitePage {
  const page = pages.find((page) => page.href === href);
  if (!page) throw new Error(`Missing page definition: ${href}`);
  return page;
}
