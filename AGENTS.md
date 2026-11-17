<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Post Occupancy — agent instructions

This is a Next.js App Router, React, TypeScript, MUI, Emotion, and MDX site for technical writing and interactive environmental/audio/data applications. Work from the actual checkout and current code, not historical descriptions. `README.md` covers local setup; `agent-notes/INDEX.md` points to task-specific architecture and historical decisions. Read only the relevant reference for the task.

## Product and UI

- Design is a Devias-inspired **documentation shell**, not a generic dashboard or marketing site: full-height collapsible left sidebar, readable articles, viewport-filling interactive applications, restrained existing MUI theme, locally hosted Inter.
- Avoid unrequested accounts/auth, commerce, marketing sections, stock imagery, unrelated frameworks, or placeholder SaaS features. Reuse working React/DSP/visualization code before replacing it.
- `src/content/site.ts` is authoritative for navigation and `homepage`. `/` redirects to the chosen canonical page (currently `/lab/dsp-for-artists`); change the homepage there, not by moving pages. `src/app/**/page.tsx` owns routes and metadata.
- Use `src/layouts/docs/` for the shell and `DocsPage` modes; keep page routes server-rendered where practical and isolate browser/audio/canvas/WebSocket APIs in client components. `src/mdx-components.tsx` stays at the standard Next location.

## Live infrastructure and lifecycle

- The browser consumes Electric Sea via a **single root `RouterClient` per tab** (`src/components/signals/router-provider.tsx`, `src/lib/signals/router-client.ts`). Reuse the shared client; manage subscriptions, timers, Web Audio, media tracks, MIDI, and rendering with explicit cleanup. Avoid additional page-specific sockets unless deliberately required.
- Default router is `wss://rf.postoccupancy.com`. A browser setting and `NEXT_PUBLIC_SIGNAL_ROUTER_URL` can override it; inspect existing implementation before changing connection behavior.
- Do **not** modify the Pi, ESP32 firmware, Cloudflare, real audio/MIDI devices, or sibling repositories as a side effect of website work. Tests should mock WebSockets, sensor values, microphone, and MIDI rather than drive live hardware.
- Preserve bounded sample buffers, real sequence/timestamp gaps, and deliberate separate lifecycles of shared versus page-local resources; see `agent-notes/ARCHITECTURE.md` and topic references before changing DSP or transports.

## Workflow and checks

- Confirm repository and branch first, especially when VS Code opens the parent `postoccupancy/` workspace. Inspect Git status; preserve unrelated changes and divergent local/remote histories. Use a focused feature branch/worktree where appropriate; never discard unmerged work. Only push, deploy, or merge with authorization.
- Node version is in `.nvmrc` (currently 22). Use npm with `package-lock.json`; dev/preview run on **3001** (local 3000 is reserved); Playwright uses **3100**.
- Verify relevant changes with `npm run lint`, `npm run typecheck`, `npm run build`, and targeted `npm run test:e2e` as appropriate. Browser tests must not publish to the production router. Check `package.json` for current scripts and versions.
- Keep this file **short and stable**. Do not append commit logs, test results, or feature history to `AGENTS.md`. For durable architectural changes update the relevant `agent-notes/` topic; for ordinary changes, Git commits/PR descriptions are the history. Use `agent-notes/HISTORY-2026.md` only to consult preserved historical implementation notes, not as current instructions.
