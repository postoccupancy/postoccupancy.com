# Agent reference index

The root `AGENTS.md` is intentionally concise and loaded as project guidance. These documents are **on-demand references**, not instructions to read in every Codex session.

| Task | Read |
| --- | --- |
| App architecture, routes, layouts, shared clients, build/test commands | [ARCHITECTURE.md](ARCHITECTURE.md) |
| DSP for Artists, audio source ownership, signal analysis, reusable rendering | [DSP-FOR-ARTISTS.md](DSP-FOR-ARTISTS.md) |
| Wave Interference instrument, geometry, renderer semantics, MIDI | [WAVE-INTERFERENCE.md](WAVE-INTERFERENCE.md) |
| Historic decisions, performance measurements, prior validation, old paths | [HISTORY-2026.md](HISTORY-2026.md) |

Read only the documents needed for the current task. Current source code, `src/content/site.ts`, `package.json`, and Git state take precedence over historical notes. Some historical notes refer to removed routes or earlier service/repository names.

**History policy:** use commit messages and PR descriptions for routine change logs; update the relevant topic document when a durable architecture decision changes. Do not append every change to `AGENTS.md` and do not automatically load the historical archive.
