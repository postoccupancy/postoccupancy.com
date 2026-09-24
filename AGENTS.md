<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Post Occupancy project context

Updated 2026-09-24. This file records agreed direction and implementation context for future work. Check the actual source and Git state before acting; live service availability and dependency versions can change. `README.md` contains the user-facing development guide. `CLAUDE.md` imports this file.

## Product direction and constraints

- Build `postoccupancy.com` as a technical documentation site containing substantial running React applications alongside explanatory content.
- Primary layout reference: https://material-kit-pro-react-docs.devias.io/introduction. Reproduce the useful documentation shell with ordinary Next.js, React, and MUI; do not turn this into the generic Devias dashboard.
- Keep the foundation small and close to Next.js conventions. Prefer reusing existing Post Occupancy application logic over inventing replacement systems or adding another documentation framework.
- No authentication, accounts, customer/commerce screens, analytics dashboards, marketing headers/heroes, testimonials, feature grids, stock imagery, decorative animation, or placeholder SaaS content.
- Use a full-height left navigation and main content area, with no conventional top marketing header or large dashboard app bar.
- Pages must support both readable articles and applications that can occupy essentially the whole viewport when navigation is collapsed.
- Do not modify the working Pi/ESP32 infrastructure as a side effect of website work. No Next.js proxy, Supabase integration, camera controls, device restart controls, or extra status polling has been requested. Revisit those only when needed and agreed.
- The user prefers simple proposals and direct implementation within the agreed scope. Avoid overengineering and repeatedly asking for permission already given.
- Commit completed, verified units of work with descriptive messages. Inspect the working tree first and include only relevant files; preserve unrelated user changes. Do not push or deploy merely because a local commit was requested.

## Workspace and source material

The user may open the entire parent `postoccupancy/` directory. Confirm the working directory rather than assuming the editor root is this repository. The project has lived at `/Users/adrianmacdonald/Documents/projects/developer/postoccupancy/postoccupancy.com`.

Sibling repositories:

- `devias-kit-pro`: original purchased MUI-store Devias Material Kit Pro React template. Earlier inspection found the v6 TypeScript template with environment/CI/deployment setup additions. It is reference material, not this site's application base.
- `b2b-dashboard-demo`: the user's modified Devias template, including Next.js/build compatibility updates. Earlier inspection found little substantive UI divergence; consult its Git history for exact changes. It uses the older template structure, whereas this site uses App Router.
- `signal-router`: existing Raspberry Pi server and live applications. The router interface source is `router/public/index.html`; `router/server.js` implements the WebSocket protocol. Other applications, including `/voices`, live in this repository.
- `electric-sky`: node firmware and reusable dashboard logic. The scope renderer and sample ring originated in `esp32-s3-cam/include/Dashboard.h`.

Sibling repositories have independent histories and may have different write permissions. Do not bundle their changes into this site's work. Purchased Devias source should not be made public as an incidental deployment workaround.

Historical deployment context: removing `docs/` from `b2b-dashboard-demo/.vercelignore` did not resolve a Vercel deployment rejection. The reported blocker was a private GitHub organization repository on Vercel Hobby. Recheck current deployment/account state before diagnosing further; this was not a site-code issue. This site's root `docs/` directory is currently ignored and has been used for font comparison screenshots.

## Current stack and local commands

- Next.js App Router, React, TypeScript, MUI, Emotion, and official `@next/mdx` integration.
- At this update: Next 16.3.6, React 19.3, MUI 9.4, TypeScript 5.9, ESLint 9.39.5, Playwright 1.63. `package.json` and `package-lock.json` are authoritative.
- Node 22, selected by `.nvmrc`; use npm and keep the lockfile in sync.
- `npm ci` installs dependencies. `npm run dev` and `npm start` use port **3001**. Port **3000 is occupied by Grafana**; do not take it over.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` are the checks.
- Browser tests use a production build and start a temporary server on port **3100**. Install Chromium with `npx playwright install chromium` if necessary.
- Next/MDX builds and Playwright may need environment permission to launch workers, bind local ports, or start Chromium. Do not change application configuration to work around a sandbox-only restriction.
- ESLint remains on 9 because the bundled Next lint plugins previously failed with ESLint 10. Upgrade the lint stack together rather than independently bumping that package.
- `next-env.d.ts`, `.next/`, build artifacts, local environment files, browser reports, and `node_modules/` are not committed. `.env.example` is committed.

## Navigation and layout decisions

Overview is the home route `/`, reached through the **Post Occupancy** wordmark. It has no sidebar entry and no breadcrumb. All navigation groups are peers; Overview is not their parent. Breadcrumbs read, for example, `Lab / DSP for Artists`, never `Overview / Lab / DSP for Artists`.

Current IA and routes:

| Group | Page | Route |
| --- | --- | --- |
| Nodes | Electric Sky | `/nodes/electric-sky` |
| Nodes | Indoor Sky | `/nodes/indoor-sky` |
| Hubs | Electric Sea | `/hubs/electric-sea` |
| Hubs | AI Weather Station | `/hubs/ai-weather-station` |
| Interfaces | Apartment Observatory | `/interfaces/apartment-observatory` |
| Interfaces | Spectral Visualizer | `/interfaces/spectral-visualizer` |
| Interfaces | Microphone Visualizer | `/interfaces/microphone-visualizer` |
| Instruments | Resident Frequency | `/instruments/resident-frequency` |
| Instruments | Processing sketches | `/instruments/processing-sketches` |
| Instruments | SuperCollider compositions | `/instruments/supercollider-compositions` |
| Instruments | Other Weather Music work | `/instruments/weather-music` |
| Lab | DSP for Artists | `/lab/dsp-for-artists` |
| Lab | Notes | `/lab/notes` |

Notes was deliberately moved under Lab; do not restore it as a separate top-level section. Groups do not have landing pages, so group breadcrumbs are labels rather than links.

- The entire sidebar collapses, with a minimal fixed control to reopen it. Sections individually expand/collapse with disclosure arrows. Current links have a subtle active state.
- Desktop sidebar width is 280px. Mobile uses a drawer. Keep keyboard/focus behavior, the skip link, and responsive overflow handling intact.
- Sidebar visibility survives client navigation but is not currently persisted across reloads.
- `DocsPage` has `article` (readable width), `dashboard` (unrestricted content width), and `viewport` (no article header, breadcrumbs, or padding) modes. Viewport mode fills the available area; it does not invoke the browser Fullscreen API. Leave the top-left reopening control accessible.
- The current font is locally hosted **Inter Variable**. An earlier Arial issue came from navigation buttons not inheriting the font. Be Vietnam Pro was briefly tried, then the user explicitly chose to restore Inter once inheritance was fixed. Do not reintroduce Arial or switch fonts based only on the original reference site.
- Use restrained MUI styling and the existing theme. Most styles are `sx` values, not a separate CSS stylesheet.

## File map and MDX conventions

- `src/content/site.ts`: navigation groups, ordering, labels, page descriptions, and lookup helpers. Editing this file does not create routes.
- `src/app/**/page.tsx`: route composition and metadata. Keep route components server-rendered where practical, with browser behavior in client components.
- `src/app/layout.tsx`: root layout, font import, MUI App Router style cache, providers, and docs shell.
- `src/app/providers.tsx`: theme, CssBaseline, and root shared router provider.
- `src/theme.ts`: font stack, typography, palette, and component defaults. Some layout dimensions remain local `sx` values.
- `src/layouts/docs/{shell,navigation,page}.tsx`: shell, sidebar, and article/application wrapper. These were deliberately moved out of `components/docs-*.tsx`; retain the directory structure and unprefixed filenames. Exported names remain `DocsShell`, `DocsNavigation`, and `DocsPage`.
- `src/components/placeholder-page.tsx`: presentation for routes awaiting actual content/applications.
- `src/mdx-components.tsx`: MDX-to-MUI element mapping in the location Next expects. The user explicitly reversed moving it into `components/`; keep the standard convention without an unnecessary shim.
- `next.config.ts`: official MDX integration and supported page extensions, with the Turbopack root set for this repository.
- `src/content/lab/dsp-for-artists.mdx`: example prose containing an imported React component.
- `src/components/lab/wave-explorer.tsx`: interactive SVG sine-wave example with frequency/amplitude sliders and reset. It produces no audio and needs no audio permission.
- The DSP route wraps MDX in `DocsPage`, which provides the H1; article headings begin at H2. MDX can remain server-rendered while embedded components use `'use client'`.

## Existing infrastructure and shared connection

The live sensor/router infrastructure runs on a Raspberry Pi 3 in `signal-router` and is publicly available through Cloudflare at `rf.postoccupancy.com`. The website consumes it directly from the browser. Historical Supabase data exists but is not integrated.

- Default connection: `wss://rf.postoccupancy.com`.
- Optional override: `NEXT_PUBLIC_SIGNAL_ROUTER_URL` in `.env.local`; restart/rebuild Next after changing it. See `.env.example`.
- One `RouterProvider` at the root creates one logical shared `RouterClient` per browser tab. It survives client navigation. React development Strict Mode may briefly mount/clean up an initial connection; do not confuse that with separate page sockets.
- `src/components/signals/router-provider.tsx` exposes `useSignalRouter()`.
- `src/lib/signals/router-client.ts` owns connection/reconnection, discovered channels, node clocks, and bounded sample history. It reconnects with exponential delay from 1 to 15 seconds.
- Features use `subscribeMessages()` and `send()` on that client. Passing `true` as the second subscription argument replays cached connection metadata and audio capabilities for pages mounted after the handshake. Do not replay old signal events: they could emit obsolete MIDI output.
- JSON messages and binary frames reach subscribers. No PCM or Resident Frequency subscription is enabled automatically. Future subscribing features must handle reconnects and unsubscribe on unmount.
- `sample_batch` streams include node `name`, `param`, `unit`, and samples `[sequence, deviceTimeMicroseconds, value]`. Device times are relative uptime, not wall-clock dates. A backwards clock jump resets node history.
- HTTP status requests previously encountered CORS limitations through the Pi proxy; a Next proxy was explicitly deferred. Do not add one preemptively.
- Earlier Electric Sky intermittency happened through local/VPN/Cloudflare paths and was resolved by the user physically resetting the ESP32. A remote restart was discussed but not executed. Treat future outages as fresh diagnostics, not automatically a website or tunnel bug.

## Live node dashboards

Electric Sky and Indoor Sky are implemented using the same `NodeDashboard`, filtered by node name.

- `src/components/signals/node-dashboard.tsx`: metadata-driven channel discovery, current values, status, delay control, and responsive plot grid. Known labels/colors are presentation hints, not a hardcoded required channel list.
- `src/lib/signals/sample-ring.ts`: ring adapted from the firmware dashboard; retains at most 25 seconds and 25,000 samples per channel, rejects duplicate/out-of-order sequences.
- `src/components/signals/scope-plot.tsx`: adapted canvas renderer with a 10-second window, min/max pixel bins that preserve peaks, expanding axes, and peak-to-peak annotations. Missing samples break the line. Canvas animation reads buffers independently of React.
- Default presentation delay is six seconds; labels update at 4 Hz. Values become stale after five seconds. Milliwatts display as watts.
- No camera controls, firmware modifications, status polling, or restart actions were added.

## Electric Sea router integration

Completed in commit `ae503f1` (`feat: integrate signal router interface into Electric Sea`). The page adapts the existing `signal-router/router/public/index.html` interface into React/MUI, without an iframe or a second WebSocket.

- `src/components/router/router-dashboard.tsx`: connection/client/server details, OSC endpoints, local MIDI ports, signal tables grouped by source, CH/CC/min/max mappings, output switches, external application links, and setup help. Wide tables scroll within their containers on mobile.
- `src/lib/router/router-interface.ts`: reused/adapted signal keys, localStorage assignments, scalar normalization and CC smoothing, local MIDI input/output, port loop prevention, and 500ms USB batch presentation. Routing processes events independently of the 4Hz React display refresh. Rows and queues are bounded.
- MIDI access starts only when the user chooses **Enable MIDI**. **Send to port** sends router values to a local output; **Receive from port** forwards local MIDI input to the router. Enabling one direction disables the other for the same named port.
- Legacy settings retain `rf-assign-`, `rf-out-`, and `rf-port-state` localStorage keys. Storage belongs to the site origin, so the Pi site's assignments do not automatically transfer. Port direction changes are synchronized between same-origin tabs using BroadcastChannel.
- Scalars map their configured min/max range to 0–127, with the original 0.3 smoothing. CC uses configured channel/controller assignments rather than additionally passing through raw CC bytes. Other supported MIDI messages pass through; note-offs can still release already sounding notes when a row is muted.
- Leaving Electric Sea removes its subscriptions/timers, releases notes it sent, and closes MIDI ports. The root connection stays alive. MIDI routing is currently active only while Electric Sea is mounted; future Resident Frequency work must coordinate MIDI ownership if requirements change.
- Scalar Out is local browser output state. **Audio Out** sends `pcm_source_enable` to the Pi, affects the shared source, and waits for acknowledged server state. It does not subscribe to or play PCM in this page.
- OSC availability comes from the router handshake. UDP input uses port 5005, and output to directly reachable clients uses 9000. Cloudflare WebSocket access does not make browser-side UDP possible; LAN/VPN access is needed for that behavior.
- Known node headings link to the site's node pages. View links and Modulation spectrum still open the existing Pi applications. Local recorder links to `http://127.0.0.1:3010/`. The WebSocket override supplies the origin for Pi application links.
- Resident Frequency is still a placeholder; setup help retains a link to the working Pi `/voices/` application.

## Verification and remaining scope

At completion of Electric Sea, lint, type checking, production build, and all 12 Playwright tests passed. A live browser check displayed 12 sensor channels across Electric Sky and Indoor Sky plus both audio capability entries, without browser errors. This is a historical verification result, not a guarantee of current device availability.

- `tests/navigation.spec.ts`: routes, breadcrumbs, section disclosure, sidebar collapse/focus, mobile drawer, MDX interaction, and 404 behavior.
- `tests/signals.spec.ts`: shared connection across routes, node filtering/discovery, units, stale values, reconnects/clock resets, and ring bounds.
- `tests/router.spec.ts`: handshake replay after navigation, reconnects, audio acknowledgment, mapping persistence, USB batches, MIDI CC mapping/input, direction exclusion, note/port cleanup, and mobile overflow.
- Automated browser tests mock WebSocket traffic and MIDI ports. Do not toggle real audio sources or send physical MIDI merely to run tests.
- Scope navigation test selectors to the intended region when page links duplicate sidebar labels.

Future work already discussed, not yet implemented:

- Resident Frequency should eventually run the existing Pi `/voices` live MIDI extraction interface through the shared connection.
- Spectral Visualizer should visualize selectable live signals; Microphone Visualizer should incorporate the existing p5/Web Audio sketch.
- Node pages can grow explanatory documentation alongside their live dashboards.
- Processing/SuperCollider and other Weather Music pages will hold artwork documentation, source, recordings, and related material.
- Lab will hold sequential interactive DSP tutorials; Notes will hold longer-form writing.
- AI Weather Station, Apartment Observatory, and the remaining named routes are foundations/placeholders pending content or application integration.
- Supabase history and any necessary HTTP proxy are later phases, not implicit additions to the current work.
