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
- The Post Occupancy wordmark links to Home; it has no sidebar entry or breadcrumb. Notes lives under Lab in navigation (at `/lab/notes`). Breadcrumbs start with the current section.
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

DSP for Artists contains a local MDX + React example. The two node pages display live router data. Electric Sea contains the router interface, Spectral Visualizer provides a selectable signal dashboard, Microphone Visualizer analyzes local microphone input, Resident Frequency adapts the live Pi voice controls, and Pattern Party runs the Moiré sketch; other pages remain placeholders. Supabase is not yet integrated.

## Live node dashboards

Open `/` for the combined Signals dashboard. The former `/nodes/electric-sky` and `/nodes/indoor-sky` routes redirect there. A single `RouterProvider` in the root providers opens `wss://rf.postoccupancy.com` and survives navigation between all pages. Set `NEXT_PUBLIC_SIGNAL_ROUTER_URL` in `.env.local` to override that address, then restart/rebuild Next.js. Each browser tab has its own connection.

- `src/components/signals/router-provider.tsx`: root provider for the shared router client and global router-interface model.
- `src/lib/signals/router-client.ts`: shared connection, reconnect handling, incoming channel discovery, and node clocks. Electric Sea and Resident Frequency use `subscribeMessages()` and `send()` on the same client. Passing `true` as the second subscription argument replays connection metadata and audio capabilities, without replaying old signal events. Binary frames are available to subscribers too; no PCM subscription is enabled automatically. Features that subscribe later must handle reconnection and unsubscribe on unmount.
- `src/lib/signals/sample-ring.ts`: bounded sample buffers adapted from the Electric Sky firmware dashboard's `Ring` class.
- `src/components/signals/signals-visualization.tsx` owns one page animation clock and one analysis worker for the complete Signals dashboard. `signal-plot.tsx` is a lightweight lane canvas: waveform reads the shared RouterClient ring on the page clock, while spectrum, timestamped spectrogram columns, and modulation fields arrive from the worker.
- `src/components/signals/signals-dashboard.tsx`: one dashboard containing every discovered node stream. Each chart identifies its node; known channels get familiar labels/colors and new channels appear automatically. Milliwatts are displayed as watts.
- `src/components/signals/signal-card.tsx`: expandable per-signal controls for the full signal name, shared MIDI channel/CC selectors and min/max assignments, playback gain, and local browser audio. Collapsed cards summarize only settings that the user has assigned.

Samples use device-relative microsecond timestamps, not wall-clock dates. The shared client resets node history when its clock moves backwards after a reboot. Dashboard controls switch every chart together among waveform, spectrum, spectrogram, and modulation. Time-window stops span 0.001–60 seconds. Waveform displays that interval; Spectrum and Modulation analyze that interval; Spectrogram crops the same retained 30 Hz STFT history to that interval without changing FFT, hop, window, or frequency resolution. Aggregation uses the visualizer engine's established rolling model and exact resolution stops. **Settings → Signals** controls FFT size, Welch segments, bands, smoothing, centroid, frequency scale, spectrum mode, and color palette. Spectrum mode defaults to **relative**; **raw** remains available with the frozen Electric Sea processing semantics. The global presentation delay starts at six seconds, is configured under **Settings → General**, and is shown beside the live status. Stale values are labeled after five seconds without updates.

Each chart’s expansion button opens settings for that signal. MIDI and range fields write through the same persisted `RouterInterface` assignments used by Electric Sea. Gain and Start audio drive the same `VisualizerSurface` playback engine used by Interfaces → Spectral Visualizer; the engine mounts in audio-only mode while the panel is open or playing, so it keeps the proven buffering and worklet path without running a duplicate canvas loop. Gain is saved per signal. Playback still requires a user gesture, and pausing, filtering out the card, or leaving the page releases its audio resources.

Node and sensor-type filters share the visualization-selector row and default to all nodes and Audio, Weather, and Power. Cards sort by that type order, then signal, then node so corresponding Electric Sky and Indoor Sky measurements remain adjacent. All lanes share one continuously advancing page display clock, so packet cadence does not control waveform or spectrogram motion. One module worker applies the same spectral functions used by the standalone visualizer and maintains every stream's spectrogram history even when its row is offscreen; offscreen rows may skip only physical canvas paint. The main thread handles ring ingestion, current values, and lightweight canvas presentation.

The node dashboards receive data only. They add no HTTP proxy, status polling, camera controls, restart actions, or changes to the Pi/firmware. Browser tests mock the WebSocket instead of depending on live hardware.

## Electric Sea router interface

Open `/hubs/electric-sea`. This adapts `signal-router/router/public/index.html` into the MUI documentation shell, using the existing shared WebSocket rather than another connection or an iframe.

- `src/components/router/router-dashboard.tsx`: server/client details, live signal tables grouped by source, assignments, output controls, and setup help. Tables scroll horizontally on smaller screens.
- `src/components/settings/global-settings.tsx`: site-wide General, Signals, and Voices settings modal. General contains presentation delay, OSC UDP, and Local MIDI ports. Signals contains the shared spectral analysis controls.
- `src/lib/router/router-interface.ts`: signal identity, scalar-to-CC normalization and smoothing, MIDI input/output, port loop prevention, persisted assignments, and the original 500 ms USB batch presentation buffer. React updates at 4 Hz while routing handles each incoming event. Rows and queued batches are bounded.

Choose **Enable MIDI** in **Settings → General** to request browser MIDI access. **Send to port** routes signals to a local output; **Receive from port** forwards local input through the shared WebSocket. Enabling one direction disables the other for that port. CC uses the configured channel/controller and min/max range, with the original 0.3 smoothing. Non-CC MIDI messages pass through. The global router interface remains active across site navigation and releases its listeners, presentation timers, and MIDI ports when the site unmounts.

Assignments and port settings retain the original `rf-assign-`, `rf-out-`, and `rf-port-state` localStorage keys. Storage is per origin, so settings on the Pi site do not automatically transfer here. Scalar Out is local to this browser. Audio Out sends `pcm_source_enable` to the Pi and displays the server's acknowledged state; it affects the shared audio source, but does not subscribe to or play PCM in this page.

OSC availability comes from the router handshake. UDP back to the browser's machine is unavailable through Cloudflare; direct LAN/VPN connections are required for that. The WebSocket URL override also supplies the origin for links to existing Pi applications. View links open the local Spectral Visualizer with the signal’s `device` parameter. Modulation spectrum still opens the separate application on the Pi. Resident Frequency is available locally at `/instruments/resident-frequency`; setup help retains the Pi `/voices/` page as a reference.

Tests cover metadata replay after client navigation, reconnects, audio acknowledgments, mapping persistence, MIDI CC output/input, port direction exclusion and cleanup, and mobile overflow. MIDI tests use simulated ports and never send to physical hardware.

## Spectral Visualizer

Open `/interfaces/spectral-visualizer`, or link directly with `?device=osc/electric-sky/rms`. The selector discovers scalar, MIDI, and PCM devices through the existing root connection; it retains an explicit device parameter even before that signal arrives. Changing the selector updates browser history, and Back/Forward restores the selection. Electric Sea’s View links now open this page without starting another WebSocket.

- `src/components/visualizer/spectral-visualizer.tsx`: MUI page controls, discovered-device selector, and query parameter handling under a Suspense boundary.
- `src/components/visualizer/visualizer-surface.tsx` and `visualizer.module.css`: the original inspector controls, scoped to a single mounted surface. Its dark charts sit within the documentation shell and expand when the sidebar collapses.
- `src/lib/visualizer/engine.js`: rendering, buffering, PCM/IMA ADPCM decoding, and Web Audio adapted from `signal-router/visualizer/index.html`. It remains JavaScript to preserve the existing implementation rather than rewrite its algorithms; React owns the surrounding page. This includes waveform, spectrum, spectrogram, modulation, aggregate/window controls, shared spectral settings, cursor readouts, and audio diagnostics.
- `src/lib/visualizer/{spectral-analysis,modulation-analysis}.js`: the existing numerical routines, converted from script globals to ES modules.
- `src/lib/visualizer/connection.ts`: filtering the selected signal and managing page-local PCM/analysis subscriptions through the shared client.
- `src/lib/signals/signal-device.ts`: signal IDs and scalar/MIDI value extraction. `RouterClient.devices` retains bounded discovery metadata rather than replaying signal events.

Selecting PCM or the derived bass/mid/high/centroid channels enables the corresponding audio source on the Pi, matching the original visualizer. The page only subscribes to the selected stream and resubscribes after reconnects. **Start audio** is required for local playback. Leaving the page or switching signals cancels its subscription, animation, listeners, scheduled playback, and AudioContext; it does not disable a shared source that another application may use.

The router’s ESAU binary frames have no device ID. `RouterClient` tracks ordered PCM subscription acknowledgments so packets from a previous selection are discarded until the current selection is acknowledged. Keep only one selected PCM stream on this shared connection unless the server protocol is extended to identify frames. Analysis subscriptions do not carry binary audio.

Visualizer history retains up to 120 seconds, capped at two million samples and 12,000 chunks. Sequence/time resets clear history after a node reboot; reconnects also reset display buffers. Scalar full-scale calibration uses the original `rf.scalarFullScale.<device>` localStorage keys. The audio worklet queue is bounded as well. Signal-specific playback and controls reset when changing devices.

`tests/visualizer.spec.ts` covers selection/history, all four views, plotted spectrum pixels, PCM and ADPCM ingestion, subscription switching/reconnects, malformed data, MIDI discovery, device reboot handling, known-tone FFT/power accuracy, and audio startup/cleanup with a simulated AudioContext.

## Microphone Visualizer

Open `/interfaces/microphone-visualizer` and choose **Enable microphone**. The page uses the browser’s default/selected microphone, not a sensor stream from the Pi. It bundles the original sketch’s p5 1.9.0 locally and preserves its waveform, spectrum, and spectrogram views, 2048-point analyser, frequency bands, log-normalized centroid, and smoothing.

- `src/components/microphone/microphone-visualizer.tsx`: MUI controls, status, analysis readouts, and client-only lazy loading of p5.
- `src/lib/microphone/engine.js`: adapted `signal-router/mic/index.html` sketch, microphone lifecycle, and publication through the shared router client.

Raw audio remains on this computer and is never connected to the speakers. The original app does use a WebSocket for output: it publishes five numeric values at 20 Hz under `json/mic-<client-ip>/{rms,bass,mid,high,centroid}`. The new page preserves those keys and uses the existing shared connection. No MIDI bus is needed for these signals to appear on the Pi or another Electric Sea page.

Keep the microphone page visible in one window and open Electric Sea in another. The Pi forwards JSON signals to other connections rather than echoing them to the sender. Navigating away stops capture; a hidden or stalled page does not publish frozen values. In Electric Sea, assign CH/CC and enable **Send to port** to convert the received values to local MIDI. **Receive from port** instead forwards MIDI from a local bus to the Pi. These are separate steps from microphone analysis.

**Stop microphone**, navigation, or a disconnected input releases media tracks, the AudioContext, and associated processing. A late permission result after navigation also has its tracks stopped. The renderer, resize observer, publishing timer, and message subscriptions are cleaned up when the component unmounts. Visual analysis can run while the router is offline; publishing resumes after a new client identity arrives on reconnect. Microphone access requires a supported browser on HTTPS or localhost.

`tests/microphone.spec.ts` uses simulated microphone and WebSocket APIs to check delivery of all five values to a second Electric Sea page without MIDI, all three views, denial/retry, hidden-page publishing, reconnects, stop/navigation cleanup, and delayed permission results. It never captures a physical microphone or plays audio.

## Resident Frequency

Open `/instruments/resident-frequency` for the existing Pi `/voices/` controls inside the documentation shell. The Pi continues to perform live extraction; this page only subscribes to its `resident_voices` and `resident_values` messages through the shared router connection.

The page subscribes after connecting and disables the subscription when it is closed. It validates incoming data before display, clears stale analysis, and preserves the Pi interface’s stream notes, pitch, browser synth, device/stream/global beat CC, MIDI, and panic controls. Audio and MIDI remain off until you explicitly enable them and select an output. Leaving the page releases browser audio, MIDI notes and ports, handlers, and the resident subscription.

The implementation is in `src/components/voices/` and `src/lib/voices/`; `tests/voices.spec.ts` covers mocked router subscription, rendering, MIDI and synth lifecycle, beat CC controls, and cleanup. Tests never select a physical MIDI output or start real browser audio.

## Pattern Party

Open `/instruments/processing-sketches` for Pattern Party, the original Moiré p5 sketch in the documentation shell. Comb, Mesh, and Rings modes retain the two-layer movement, color, pattern, and manual angle controls. The two selectors receive scalar signals from the shared router connection, while the page sends its phase, interference, beating, and rate values back as `json/moire/…` signals at 20 Hz.

Choose **Enable MIDI input** only when a local controller should drive the original channel 1–3 CC mappings. MIDI permission is never requested on page load, and the page has no MIDI output or audio. Leaving the page stops p5, derived-signal publication, router listeners, resize handling, and MIDI listeners.

On desktop, the canvas and a right control rail occupy the full viewport. The rail uses the site navigation’s compact typography and muted colors, and each control names its MIDI channel/CC or note mapping. **Presentation** opens a canvas-only window with a unique session ID in its URL. A private `BroadcastChannel` synchronizes the complete control state when the window opens and on later edits; separate Pattern Party tabs and presentation windows do not share state.

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
