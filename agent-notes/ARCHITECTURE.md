# Post Occupancy architecture reference

This document captures stable guidance extracted from the former root `AGENTS.md`. Always verify against current code.

## Site and workflow

- Next.js App Router, React, TypeScript, MUI/Emotion, official Next MDX integration.
- `src/content/site.ts` defines current navigation and the canonical `homepage`. The current landing route is `/lab/dsp-for-artists`; `/` is a redirect, not the old Signals dashboard. Route components live under `src/app/`.
- `src/layouts/docs/{shell,navigation,page}.tsx` contains sidebar and page layouts. `DocsPage` offers article, dashboard, and viewport modes. Viewport instruments omit article spacing and must leave the sidebar reopening affordance accessible.
- `src/theme.ts` owns theme typography and MUI defaults; `src/mdx-components.tsx` maps MDX elements; article headings start below the page H1 provided by `DocsPage`.
- Next/MDX routes should remain server components where practical. Keep browser-only Web Audio, p5, canvas, microphone, MIDI and WebSocket behavior in client components.
- Preferred product is a documentation/workshop site with functional applications. Do not add generic dashboards, top marketing headers, authentication, or artificial product marketing.
- Prefer the actual source tree over old route tables and historical narrative. Earlier “Signals at /” and “homepage at /” references are obsolete.

## Connected Electric Sea

- `src/app/providers.tsx` and `src/components/signals/router-provider.tsx` establish a shared browser `RouterClient` from `src/lib/signals/router-client.ts`. It survives navigation within a tab; ordinary subscribers should not create competing sockets.
- Live default: `wss://rf.postoccupancy.com`. The Settings > General browser override is stored in `postoccupancy:router-url:v1`; it takes precedence over `NEXT_PUBLIC_SIGNAL_ROUTER_URL`, which takes precedence over the public default. Updating the browser override reloads and releases router/audio/MIDI state. `https` pages do not accept insecure `ws://` overrides.
- A fully offline deployment needs a locally served site *and* network access to the Pi. No automatic LAN discovery or fallback is implemented.
- `src/lib/signals/sample-ring.ts` retains bounded channel samples. Timestamps are device-relative; preserve real discontinuities and reset logic. Visual signal resampling/reconstruction must not silently rewrite acquired data.
- `src/lib/router/router-interface.ts` manages browser MIDI/OSC-facing router controls and mapping. Persistent router state is shared; page-local audio capture, playback and subscriptions must stop when unmounted.
- The browser microphone visualizer analyzes local audio and publishes derived JSON signals only after explicit user permission. It is not a hidden microphone capture service; use mocks for testing.
- WebSocket and audio tests should use simulated devices/traffic. Never send test readings or change real Pi output modes as routine regression testing.

## Main component families

- Sensor UI: `src/components/signals/` and `src/lib/signals/`.
- Electric Sea controls: `src/components/router/`, `src/lib/router/`, and `src/components/settings/`.
- Spectral Weather/visualizer: `src/components/visualizer/`, `src/lib/visualizer/`, and `src/lib/signals/signal-device.ts`.
- Microphone: `src/components/microphone/`, `src/lib/microphone/`.
- Signal Voices and allocation: `src/components/voices/`, `src/lib/voices/`.
- DSP workshop and Wave Interference: `src/lib/dsp-for-artists/`, `src/components/` and `src/app/` routes for the associated lessons/instruments; refer to topic documents.
- Navigation & metadata: `src/content/site.ts`, `src/app/**/page.tsx`.

## Development and verification

```sh
nvm use
npm ci
npm run dev          # localhost:3001
npm run lint
npm run typecheck
npm run build
npm run test:e2e     # temporary production browser server on 3100
```

Current scripts and dependencies are in `package.json`; Node target is in `.nvmrc`. Local port 3000 is reserved for Grafana. Chromium may need `npx playwright install chromium`. Sandboxed port/worker limitations should not prompt production config changes. Only relevant checks need run for a docs-only change.

## Repository boundaries

This repository is the Next frontend; the Pi router and ESP32 firmware live in separate repos (currently `electric-sea` and `indoor-sky` among related projects). Historical archives refer to `signal-router` and `electric-sky` names. Confirm current locations and deployed Git revisions before treating either as authoritative. The purchased Devias template is reference material and must not be redistributed.
