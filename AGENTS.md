<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Post Occupancy project context

Updated 2026-09-28. This file records agreed direction and implementation context for future work. Check the actual source and Git state before acting; live service availability and dependency versions can change. `README.md` contains the user-facing development guide. `CLAUDE.md` imports this file.

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
- Update `AGENTS.md` with every commit and include that update in the same commit. Record the relevant changes, decisions, validation, and remaining work so future sessions have current context. For changes that do not affect architecture, a brief context or verification note is sufficient; do not invent new decisions or duplicate the entire history.

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

## Phase 1 combined signals and global settings (2026-10-06)

- `/` is the **Signals** dashboard and combines all discovered Electric Sky and Indoor Sky streams. Each chart identifies its node. The former node-specific routes redirect to `/`.
- Dashboard v2 starts with a three-choice Waveform/Spectrum/Spectrogram selector. Waveform remains the unchanged `ScopePlot`; Spectrum and Spectrogram are plot-area placeholders pending later incremental implementation. No signal transport, buffering, timing, or DSP behavior changed in this step.
- Dashboard v2 waveform windows use discrete 0.05/0.1/0.25/0.5/1/2/5/10/30/60-second choices with a 10-second default. Consecutive sample sequences connect across sparse pixel bins while missing sequences remain visible as gaps. The shared ring retains 70 seconds, covering the 60-second view plus the maximum 10-second presentation delay, within the existing 25,000-sample cap.
- Dashboard v2 waveform aggregation is shared across every row and defaults to Off. Enabled stops are 10/20/50/100/250/500/1000 ms (100/50/20/10/4/2/1 Hz); fixed-time buckets use arithmetic means at bucket midpoints and leave empty buckets as gaps. Solar Voltage and Solar Current remain available from the router but are omitted from Signals; Solar Input Power remains visible.
- Dashboard v2 Spectrum uses each channel's existing `SampleRing`, the shared buffered endpoint/Time Window/Aggregation settings, and the numerical routines in `src/lib/visualizer/spectral-analysis.js`. It never fills gaps: native sequence/timestamp discontinuities and empty aggregate buckets split runs, and analysis uses the newest run with at least eight samples. FFT length is the largest fitting power of two up to 2048 with up to four Welch segments.
- Global Settings → Signals now owns shared spectral configuration for the Signals views: requested FFT size (Auto or 128–16384), Welch segments, band averaging, Relative/Raw mode, and Log/Linear/Expanded frequency scale. Defaults preserve the original Signals Spectrum output (Auto capped at 2048, Welch 4, bands on, Relative, Log); effective FFT size may fall below the request when contiguous data is shorter. Welch overlap remains fixed at 50%. The diagnostic Spectral Visualizer keeps independent control state while sharing the pure frequency-position semantics.
- Dashboard v2 Spectrogram uses the same rings, presentation clock, aggregation, and global spectral settings. It stores source-time-aligned columns at `max(500 ms, aggregation)` hops, backfills retained history, renders columns on the physical Time Window axis, and leaves real discontinuities blank. Timestamp-anchored analysis uses only the run reaching that column and never relabels Spectrum's earlier-run fallback. Frequency scale is render-only. Backfill prepares aggregation, sampling intervals, and contiguous runs once per chart update and feeds Welch only its trailing eligible observations. With the 500 ms hop, ten synthetic 100 Hz charts measured about 0.12 s for 10 seconds (200 columns) and 2.04 s for 60 seconds (1,200 columns); FFT/Welch work still dominates the 60-second synchronous backfill. Rendering groups contiguous columns into cached rasters, fixes frequency bounds from the configured FFT target and established sample rate, leaves unavailable frequency coverage transparent, uses the legacy spectrogram color formula, and holds the newest display cell only through its next scheduled hop boundary. It linearly interpolates spectral power vertically, uses canvas interpolation between time columns, clips edge cells, and never smooths across real gaps. The legacy Spectral Visualizer is unchanged.
- Native spectral continuity now keeps sequence gaps as hard breaks while evaluating timestamps through bounded cumulative clock drift instead of individual sample intervals. The nominal interval is the median of 64-sample block means; a rolling two-second clock window allows `max(30 ms, four nominal intervals)` of phase jitter. This prevents high-rate Electric Sky power streams from repeatedly restarting FFT analysis while still detecting clock jumps and sustained drift. Fixed-time aggregation continuity is unchanged. A bounded opt-in live diagnostic is available at `scripts/diagnose-spectrogram-continuity.cjs`.
- Signals Spectrum and Spectrogram now share a gap-tolerant, regularly spaced analysis representation. Native and aggregated gaps up to 100 ms are linearly reconstructed without mutating `SampleRing` or Waveform data; longer outages and invalid clock timing still split runs. Prepared results carry original/interpolated counts, reconstructed fraction, largest interpolated gap, and fresh/reconstructed/held status. After a long outage the plots hold the last reliable FFT result until the new run regains its prior FFT size. Ten-chart synthetic backfill measured about 0.08 s for 10 seconds/200 columns and 1.50 s for 60 seconds/1,200 columns. The representation remains independent of FFT/Welch so future CWT work can consume it without changing acquisition data.
- Every Signals chart heading shows the effective analysis sample rate once calculated. Waveform uses the same buffered presentation endpoint, selected Time Window, and nominal-interval estimator as Spectrum/Spectrogram; aggregation reports its effective fixed rate. Compact formatting suppresses insignificant decimal churn, and no loading placeholder is shown.
- CWT Scalagram Phase 1 adds a rendering-independent complex Morlet analysis engine in `src/lib/signals/cwt-analysis.ts`. It consumes the same gap-tolerant reconstructed runs as Spectrum/Spectrogram, supports reusable kernels and selected-timestamp analysis, returns complex coefficients, power, reconstruction quality, and scale-specific edge validity, and does not convolve across disconnected runs. No Scalagram UI exists yet.
- Signals now includes Scalagram as a fourth visualization. It renders 48 logarithmic Morlet bands at 250 ms timestamped hops, shows the most recent three seconds before progressively backfilling a bounded 65-second history, caches raster tiles, and displays engine validity through reduced edge opacity without bridging disconnected runs. Actual observation lookup tolerates cumulative native timestamp drift; recent columns are reanalyzed only across the support horizon of the largest Morlet kernel so edge coefficients mature as future samples arrive. Color uses a frozen 95th-percentile valid-power reference from a consistent 30-second historical calibration interval. Transient preparation failures preserve valid history and retry when new data arrives. A newly opened view whose delayed presentation endpoint precedes retained samples reports that it is waiting for the presentation buffer rather than claiming reconstruction failed. The newest raster cell may extend visually to the moving edge for at most one hop plus 50 ms; it never extends while unavailable or across a longer acquisition gap. Reconstruction quality remains explicitly run-level, aggregation rates too low for the default 0.5 Hz minimum report an unavailable state, compatible Morlet kernels are reused, and FFT-specific settings do not apply.
- Scalagram acquisition support is separate from its delayed presentation timeline. CWT preparation may use acquired observations after the six-second presentation endpoint to mature centered wavelet coefficients, while displayed column timestamps never advance past that endpoint. Bootstrap waits without consuming future column cursors, and newest-edge raster extension requires one continuous reconstructed run spanning both the last computed column and the presentation edge, so real acquisition gaps remain visible. Timeline endpoints and attempted analysis bounds are exposed as bounded canvas diagnostics. A growing-ring regression covers initially empty, jittered 100 Hz acquisition through delayed startup and steady updates.
- CWT kernel reuse now retains only the reusable kernels while replacing bootstrap runs with the current reconstructed timeline; previously a stable sample rate could preserve a short initial run indefinitely, which blanked Indoor Sky weather scalagrams. Scalagram raster tiles include adjacent guard columns and crop to their original time bounds so canvas interpolation remains continuous across the four-second tile boundaries without covering actual acquisition gaps. Live verification showed sustained 100 Hz Indoor Sky output with 54 columns after 20 seconds and incremental analysis remaining below one 250 ms hop.
- A Settings button at the bottom of the side rail opens the global settings modal. Categories currently include General, Signals, and Voices; General owns presentation delay, OSC UDP status, and Local MIDI ports.
- Presentation delay defaults to six seconds, applies globally to all signal plots, and appears beside the dashboard live status.
- `RouterInterface` now lives in the root router provider so its MIDI/OSC state is available to global settings and MIDI routing survives page navigation. It still releases resources when the provider unmounts.
- These decisions replace the older Overview, separate node-dashboard, and page-local MIDI lifecycle notes below.

## Navigation and layout decisions

Overview is the home route `/`, reached through the **Post Occupancy** wordmark. It has no sidebar entry and no breadcrumb. All navigation groups are peers; Overview is not their parent. Breadcrumbs read, for example, `Lab / DSP for Artists`, never `Overview / Lab / DSP for Artists`.

Current IA and routes:

| Group | Page | Route |
| --- | --- | --- |
| Nodes | Electric Sky | `/nodes/electric-sky` |
| Nodes | Indoor Sky | `/nodes/indoor-sky` |
| Hubs | Electric Sea | `/hubs/electric-sea` |
| Hubs | AI Weather Station | `/hubs/ai-weather-station` |
| Interfaces | Anomaly Monitor | `/interfaces/apartment-observatory` |
| Interfaces | Spectral Visualizer | `/interfaces/spectral-visualizer` |
| Interfaces | Microphone Visualizer | `/interfaces/microphone-visualizer` |
| Instruments | Resident Frequency | `/instruments/resident-frequency` |
| Instruments | Pattern Party | `/instruments/processing-sketches` |
| Instruments | Weather Music | `/instruments/supercollider-compositions` |
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
- JSON messages and binary frames reach subscribers. No PCM subscription is enabled automatically. Resident Frequency subscribes only while its page is mounted and disables its subscription on unmount; other future features must do the same.
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
- Leaving Electric Sea removes its subscriptions/timers, releases notes it sent, and closes MIDI ports. The root connection stays alive. MIDI routing is currently active only while Electric Sea is mounted; Resident Frequency manages its own explicitly selected browser output.
- Scalar Out is local browser output state. **Audio Out** sends `pcm_source_enable` to the Pi, affects the shared source, and waits for acknowledged server state. It does not subscribe to or play PCM in this page.
- OSC availability comes from the router handshake. UDP input uses port 5005, and output to directly reachable clients uses 9000. Cloudflare WebSocket access does not make browser-side UDP possible; LAN/VPN access is needed for that behavior.
- Known node headings link to the site's node pages. View links now open the site's Spectral Visualizer with a device parameter; Modulation spectrum still opens the separate Pi application. Local recorder links to `http://127.0.0.1:3010/`. The WebSocket override supplies the origin for Pi application links.
- Resident Frequency now adapts the working Pi `/voices/` application in this site; setup help links there as a reference implementation.

## Verification and remaining scope

At completion of Electric Sea, lint, type checking, production build, and all 12 Playwright tests passed. A live browser check displayed 12 sensor channels across Electric Sky and Indoor Sky plus both audio capability entries, without browser errors. This is a historical verification result, not a guarantee of current device availability.

- `tests/navigation.spec.ts`: routes, breadcrumbs, section disclosure, sidebar collapse/focus, mobile drawer, MDX interaction, and 404 behavior.
- `tests/signals.spec.ts`: shared connection across routes, node filtering/discovery, units, stale values, reconnects/clock resets, and ring bounds.
- `tests/router.spec.ts`: handshake replay after navigation, reconnects, audio acknowledgment, mapping persistence, USB batches, MIDI CC mapping/input, direction exclusion, note/port cleanup, and mobile overflow.
- Automated browser tests mock WebSocket traffic and MIDI ports. Do not toggle real audio sources or send physical MIDI merely to run tests.
- Scope navigation test selectors to the intended region when page links duplicate sidebar labels.

Future work already discussed, not yet implemented:
- Microphone Visualizer and Spectral Visualizer are now implemented; see their integration sections below.
- Node pages can grow explanatory documentation alongside their live dashboards.
- Pattern Party and Weather Music will hold artwork documentation, source, recordings, and related material.
- Lab will hold sequential interactive DSP tutorials; Notes will hold longer-form writing.
- AI Weather Station, Anomaly Monitor, and the remaining named routes are foundations/placeholders pending content or application integration.
- Supabase history and any necessary HTTP proxy are later phases, not implicit additions to the current work.


## Spectral Visualizer integration

- `/interfaces/spectral-visualizer?device=...` reproduces the existing `signal-router/visualizer` inspector with a selector for discovered scalar, MIDI, and PCM signals. Explicit unknown device parameters remain selected while awaiting data. The default is a discovered scalar, never automatic microphone activation. Browser Back/Forward follows selector changes.
- Electric Sea’s View links now navigate here within the site, preserving the shared WebSocket.
- `src/components/visualizer/spectral-visualizer.tsx` owns selection/URL state inside Suspense; `visualizer-surface.tsx` isolates the original imperative controls and canvas under React. `visualizer.module.css` scopes the inspector’s dark styling. This is a deliberate local CSS exception to the site’s otherwise mostly MUI `sx` styling.
- `src/lib/visualizer/engine.js` ports the original rendering, chunk ring, PCM/IMA ADPCM decoding, and Web Audio logic. `spectral-analysis.js` and `modulation-analysis.js` reuse the original algorithms as ES modules. Keep those routines aligned with the source rather than replacing them with approximate charts.
- All four views are present: waveform, spectrum, spectrogram, modulation. Preserve aggregation, buffer/gain, time window, FFT/Welch, bands, frequency scaling, raw/filtered mode, centroid, smoothing/palette, cursor, and diagnostic controls.
- `src/lib/visualizer/connection.ts` filters the selected signal and owns PCM/analysis subscriptions. Selecting PCM or derived bass/mid/high/centroid enables the corresponding source on the Pi, matching the original. Local playback requires Start audio. Unmount/selection changes unsubscribe and release audio, scheduled sources, animation, observers, and handlers without disabling the shared source.
- `RouterClient.devices` provides bounded discovery metadata. `signal-device.ts` maps scalar and MIDI event identities/values. No old MIDI events are replayed for discovery.
- ESAU binary frames lack a device ID. The shared client tracks ordered subscription acknowledgments to reject data from a previous selection, including rapid switches. Only one PCM selection may consume that connection unless the server protocol gains frame identity; do not independently subscribe multiple binary consumers.
- History is capped at 120 seconds, two million samples, and 12,000 chunks; source resets/reconnects clear buffers. Worklet queues are bounded. Full-scale calibration retains the original `rf.scalarFullScale.<device>` localStorage convention.
- `tests/visualizer.spec.ts` adds mocked selection/history, plotting, PCM/ADPCM subscription lifecycle, MIDI discovery, reboot/malformed-data, known-tone FFT accuracy, and simulated audio startup/cleanup checks. Do not activate real microphones or speaker playback merely to run regression tests.
- During this work the user reported a WebSocket interruption. A subsequent read-only test received 717 sample batches in 12 seconds, and the local visualizer received live Electric Sky data without runtime errors. The earlier interruption’s cause was not established. A temporary approval-service failure interrupted verification separately; do not conflate it with a Pi outage.
- Completion verification: production build, TypeScript, lint, and all 17 Playwright tests passed. A read-only live scalar check rendered spectrum, spectrogram, and modulation at approximately 251 Hz with no browser errors. PCM switching and audio lifecycle were tested with simulated data/audio, not physical playback.


## Resident Frequency integration

`/instruments/resident-frequency` now adapts the live controls from `signal-router/router/resident-live.js`. Analysis remains on the Pi: the browser consumes `resident_voices` and `resident_values` through the root shared `RouterClient`; it does not reproduce the extraction process locally.

- `src/components/voices/resident-voices.tsx` mounts the page-local control surface. `voices.module.css` scopes the original dark control styling, while `src/lib/voices/template.ts` holds the static local markup and `src/lib/voices/engine.js` contains the adapted interaction code.
- The page sends `{ type: 'resident_subscribe', enabled: true }` after each connected handshake and sends `enabled: false` on unmount. It validates and bounds incoming device, stream, voice, and value data before displaying it; stale data is cleared after 30 seconds.
- Browser audio and MIDI stay inactive until the user explicitly enables them and chooses an output. Stream notes, pitch range, device/stream/global beat CC controls, and panic retain the Pi interface’s behavior. Audio, MIDI notes, ports, handlers, and the resident subscription are released on unmount or page hide.
- `tests/voices.spec.ts` uses mocked router, MIDI, and AudioContext APIs to cover subscription/reconnection, data validation, MIDI and synth lifecycle, beat CC routing, panic, and cleanup. The completed verification passed lint, type checking, production build, and all 23 Playwright tests. A read-only live check displayed three live device groups with 14 of 21 streams ready; it did not start browser audio or MIDI.

The current instrument labels are Resident Frequency, Pattern Party, and Weather Music. The legacy `/instruments/weather-music` folder remains only to return a deliberate 404 until a redirect or replacement is chosen; it is not part of the current navigation.

## Pattern Party integration

`/instruments/processing-sketches` is now the **Pattern Party** route. It adapts `signal-router/moire/index.html` into the documentation shell rather than embedding the Pi page or creating another socket.

- `src/components/pattern-party/pattern-party.tsx` provides the page-local MUI controls. `src/lib/pattern-party/engine.js` keeps the p5 drawing behavior: Comb, Mesh, and Rings modes; two independently moving layers; pattern, color, and manual angle controls.
- It receives selectable scalar/router signals and router MIDI through the shared `RouterClient`, and publishes the original derived values at 20 Hz as `json/moire/{phase,interference,beating,rate}`. The router must be connected before those derived signals are sent.
- Direct Web MIDI input is available only after the user presses **Enable MIDI input**. Do not request MIDI permission on mount. The original channel 1–3 CC mappings update visual controls; no local MIDI output or audio is created.
- Cleanup removes the p5 sketch, resize observer, message subscription, publishing interval, and direct MIDI listeners. Build, lint, type checking, and a production browser check passed; the browser rendered one canvas without runtime errors.
- The route deliberately uses `DocsPage` `viewport` mode. The p5 canvas and 264px right control rail run flush from the top to bottom of the main viewport, without a page header, outer padding, or document scrolling. The rail begins with MIDI enablement, router status, and the Comb/Mesh/Rings picker, then scrolls independently if needed so control browsing never displaces the artwork. Every slider shows its original channel/CC mapping, and layer mode controls show their channel/note mappings. On narrow screens, the rail stacks below the canvas for usable touch controls.
- Rail typography, muted text, button weight, and border treatment intentionally match the left navigation. Keep controls restrained rather than restoring the original Moiré page’s larger Courier styling.
- **Presentation** opens `/instruments/processing-sketches/presentation?session=<uuid>`. Each invocation creates a new UUID and `BroadcastChannel` named `pattern-party:<uuid>`, so multiple Pattern Party controller/presentation pairs do not share updates. The controller sends its complete current mode, source selection, parameter, color, and layer state immediately, responds again when the presentation announces readiness, and broadcasts every later control-state change. The presentation route bypasses `DocsShell` and contains only the p5 canvas; it does not create a router connection, publish derived signals, request MIDI, or affect Electric Sea.

## Microphone Visualizer integration

- `/interfaces/microphone-visualizer` adapts `signal-router/mic/index.html`, reusing the original p5 waveform/spectrum/spectrogram views and Web Audio analysis. p5 is pinned to the source sketch’s 1.9.0 and bundled locally, not loaded from a CDN. It is lazy-imported after client mounting because p5 requires browser globals.
- `src/components/microphone/microphone-visualizer.tsx` owns MUI controls and lifecycle wiring; `src/lib/microphone/engine.js` owns the reused sketch, capture/analysis, and shared-connection publication.
- The input is the browser’s default/selected local microphone. Enable microphone is an explicit user action; no media permission request occurs merely by visiting. The analyser is not connected to the audio destination and raw audio is not uploaded.
- Clarification of the user’s routing question: the original mic app **does publish over WebSocket**, even though its input is local. It sends five normalized JSON values (RMS, bass, mid, high, centroid) at 20 Hz as `json/mic-<router-client-ip>/<parameter>`. Preserve this protocol. No local MIDI bus is required for them to reach the Pi or another Electric Sea page.
- To convert those values to MIDI, configure CH/CC mappings and **Send to port** in Electric Sea. **Receive from port** forwards a local MIDI bus’s input to the Pi; it is not necessary for microphone JSON publication. The microphone sketch itself does not emit MIDI.
- Keep the mic page visible in a separate window while viewing Electric Sea. The Pi excludes the sending connection when forwarding JSON messages. Navigating away releases capture, and hidden/throttled pages stop publishing rather than sending stale analyser values. This is page-local capture, not a new global background microphone service.
- Stop/navigation/input disconnection releases media tracks and AudioContext; a permission result arriving after unmount is also released. Unmount additionally removes the p5 instance, graphics buffers, observer, timer, and router listeners. Reconnect publication waits for the current client identity.
- Tests use a simulated microphone/AudioContext and mocked router, including two-page signal delivery without MIDI, rendering, denial/retry, visibility gating, reconnects, and delayed-permission cleanup. Do not use physical audio hardware or publish synthetic test readings to the live Pi for regression tests.
- Completion verification: lint, TypeScript, production build, and all 20 browser/analysis tests passed. A separate visual check used Chromium’s synthetic microphone and a mocked WebSocket, with no physical capture, speaker playback, or test data sent to the live Pi.
