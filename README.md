# Post Occupancy

A minimal Next.js App Router, React, TypeScript, and MUI site for documentation and interactive applications. The shell takes its layout cues from the Devias documentation site and the local v6 documentation navigation, with a full-height, collapsible sidebar and no top app bar.

## Run locally

Use Node 22 (`nvm use` selects the version in `.nvmrc`), then:

```sh
npm ci
npm run dev
```

Open http://localhost:3001. Development and production preview use port 3001 to leave port 3000 available for Grafana. No environment variables are required. Node dashboards connect to the public Pi router; the rest of the site also works offline. Inter is served locally from the installed font package.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
```

Browser checks cover all 14 routes, section disclosure, desktop collapse and focus, mobile navigation, and 404s:

```sh
npx playwright install chromium
npm run build
npm run test:e2e
```

The browser tests start a temporary production server on port 3100.

Use `npm start` to serve the production build. Next.js generates `next-env.d.ts` and route types; these are not committed. Use npm and the committed `package-lock.json` for reproducible installs.

ESLint is pinned to 9.39.5 because the React/import/accessibility plugins bundled with this Next.js lint configuration do not yet support ESLint 10. npm reports that ESLint 9 is out of support; upgrade the lint stack together when its plugins support version 10.

## Structure

- `src/content/site.ts`: navigation groups, page titles, and placeholder descriptions.
- The Post Occupancy wordmark links to Overview; it has no sidebar entry or breadcrumb. Notes lives under Lab in navigation (at `/lab/notes`). Breadcrumbs start with the current section.
- `src/app/**/page.tsx`: individual routes, ready to replace independently with real content or interactive applications.
- `src/layouts/docs/shell.tsx`: desktop sidebar, mobile drawer, and navigation visibility. Visibility is retained during client navigation and resets on reload.
- `src/layouts/docs/navigation.tsx`: expandable groups, links, and active states.
- `src/layouts/docs/page.tsx`: breadcrumbs and readable article spacing. Group names in breadcrumbs are labels because groups do not have landing pages.
- `src/components/placeholder-page.tsx`: shared presentation for the initial placeholder routes.
- `src/theme.ts`: typography, colors, and small MUI overrides.
- `src/app/layout.tsx` and `providers.tsx`: server-rendered MUI styles, theme, and root shell.

## Interactive pages

Keep route components server-rendered where practical; place browser APIs, audio, canvases, and live connections in dedicated client components. For an application that needs the available viewport:

```tsx
<DocsPage title="Spectral Visualizer" mode="viewport">
  <Visualizer />
</DocsPage>
```

Viewport mode removes the article header, breadcrumbs, width limit, and padding. The main area fills the available height; collapsing navigation releases its full width. A small navigation button remains at the top left, so application controls should leave that corner available. This fills the browser viewport, without invoking the browser Fullscreen API.

DSP for Artists contains a local MDX + React example. The two node pages display live router data; other pages remain placeholders. Supabase and the existing audio/visual applications are not yet integrated.

## Live node dashboards

Open `/nodes/electric-sky` or `/nodes/indoor-sky`. A single `RouterProvider` in the root providers opens `wss://rf.postoccupancy.com` and survives navigation between all pages. Set `NEXT_PUBLIC_SIGNAL_ROUTER_URL` in `.env.local` to override that address, then restart/rebuild Next.js. Each browser tab has its own connection.

- `src/components/signals/router-provider.tsx`: root provider and `useSignalRouter()` hook.
- `src/lib/signals/router-client.ts`: shared connection, reconnect handling, incoming channel discovery, and node clocks. Future router and Resident Frequency components can use `subscribeMessages()` and `send()` on the same client. Binary frames are available to subscribers too; no PCM or voices subscription is enabled automatically. Features that subscribe later must handle reconnection and unsubscribe on unmount.
- `src/lib/signals/sample-ring.ts`: bounded sample buffers adapted from the Electric Sky firmware dashboard's `Ring` class.
- `src/components/signals/scope-plot.tsx`: canvas renderer adapted from `electric-sky/esp32-s3-cam/include/Dashboard.h`, preserving its 10-second window, expanding axes, min/max pixel bins, and peak-to-peak labels. Missing bins break the line. Canvas painting does not drive React renders.
- `src/components/signals/node-dashboard.tsx`: one dashboard filtered by node name. Incoming `sample_batch` stream metadata determines the grid; known channels get familiar labels/colors and new channels appear automatically. Milliwatts are displayed as watts. Labels refresh four times per second.

Samples use device-relative microsecond timestamps, not wall-clock dates. The shared client resets node history when its clock moves backwards after a reboot. Buffers retain at most 25 seconds and 25,000 samples per channel. The presentation delay starts at six seconds, matching the existing Electric Sky dashboard; plots fill as samples arrive. Stale values are labeled after five seconds without updates.

This integration receives data only. It adds no HTTP proxy, status polling, camera controls, restart actions, or changes to the Pi/firmware. The live router and `/voices` UI will be integrated separately using the same connection. Browser tests mock the WebSocket instead of depending on live hardware.

## Editing the site

| Change | File |
| --- | --- |
| Navigation hierarchy, ordering, labels, and placeholder descriptions | `src/content/site.ts` |
| Route URLs and page composition | `src/app/**/page.tsx` (folders determine the URL) |
| Design tokens: palette, typography, radii, global element defaults | `src/theme.ts` |
| Sidebar width and responsive layout | `src/layouts/docs/shell.tsx` |
| Navigation spacing, active states, disclosure buttons | `src/layouts/docs/navigation.tsx` |
| Article width, padding, title, and breadcrumbs | `src/layouts/docs/page.tsx` |
| Markdown heading, paragraph, link, list, and code styling | `src/mdx-components.tsx` |
| MDX example content | `src/content/lab/dsp-for-artists.mdx` |
| Interactive wave component | `src/components/lab/wave-explorer.tsx` |

Styles currently use MUI's `sx` prop rather than a separate CSS stylesheet. For example, `color: 'text.secondary'` reads the theme palette, and `p: 3` means three spacing units (24px with MUI's default 8px unit). Responsive values such as `px: { xs: 3, sm: 5 }` change with viewport width. A few component-specific values, such as sidebar width and selected-link background, are still local to their components rather than centralized tokens.

Changing an item in `site.ts` changes navigation; it does not create a route. To add a page, also create its `src/app/.../page.tsx`. Moving Notes between sidebar groups, for example, does not require changing its `/lab/notes` URL.

## Combining MDX and React

Open http://localhost:3001/lab/dsp-for-artists for the running example. Its route wraps an imported MDX document in `DocsPage`, which supplies the page title and breadcrumbs. Inside the `.mdx` document, normal Markdown and React components can be interleaved:

```mdx
import { WaveExplorer } from '@/components/lab/wave-explorer';

## Frequency and amplitude

Move the sliders to explore the wave.

<WaveExplorer initialFrequency={3} initialAmplitude={0.65} />

Continue writing ordinary **Markdown** below the component.
```

The MDX document is compiled at build time. `WaveExplorer` has `'use client'` because it uses React state and event handlers; the MDX document and route can remain server components. Props supplied in MDX set the component's initial state. The example draws a sine wave as SVG and needs no audio permission or external service.

`next.config.ts` enables the official `@next/mdx` integration, and `src/mdx-components.tsx` maps Markdown elements to MUI components. The page already supplies its H1, so start article sections with `##`. To use this pattern elsewhere, create another `.mdx` document and import it inside that route's `DocsPage`.
