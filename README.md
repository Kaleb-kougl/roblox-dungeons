# Kaleb-Vale (Roblox)

Roblox port of Project Kaleb-Vale, a top-down bullet-hell action RPG. roblox-ts, Flamework, Reflex and React,
synced into Studio with Rojo. The plan is in [PLAN.md](PLAN.md); agent notes in [CLAUDE.md](CLAUDE.md).

## Getting started

Requires Node 20+ and [Rokit](https://github.com/rojo-rbx/rokit).

```bash
rokit install       # rojo 7.7.1 and lune 0.11.0 (rokit.toml)
npm install
npm test            # build, then run the headless spec suite under Lune
npm run dev         # rbxtsc in watch mode + rojo serve
```

Then open a place in Roblox Studio, connect the Rojo plugin (7.7.x) and press Play.

| Script | What it does |
| --- | --- |
| `npm run build` | Generate fixture modules, compile `src/` to `out/` with rbxtsc |
| `npm run dev` | `rbxtsc -w` and `rojo serve` together |
| `npm test` | Build, then run every `src/shared/**/*.spec.ts` headlessly (Lune + real Jest modules) |
| `npm run test:only [filter]` | Rerun the headless specs without rebuilding |
| `npm run typecheck` / `lint` / `format` | tsc, eslint (zero warnings), prettier |
| `npm run verify` | typecheck, lint, build, headless tests: the pre-merge gate |
| `npm run test:plugin` | Install the Studio test-runner plugin (runs the same specs with `@rbxts/jest` in Studio) |
| `npm run docs` | Build the API reference from the doc comments into `build/api/` (TypeDoc; [docs/DOC_COMMENTS.md](docs/DOC_COMMENTS.md)) |
| `npm run gen:fixtures` | `fixtures/*.json` to `src/shared/fixtures-generated/` (runs automatically) |

## Layout

```
src/shared/sim/        deterministic simulation (plain TS, no Roblox APIs)
src/shared/dungeon/    Dungeon Forge generator (deterministic, like the sim)
src/shared/theme/      theme contract and placeholder pack (logical asset IDs)
src/shared/config/     tunables (camera view, spike settings)
src/shared/view/       view math shared by client presentation (headless-testable)
src/client/            Flamework controllers, Reflex store, React UI (runtime.client.ts)
src/server/            Flamework services (runtime.server.ts)
fixtures/              golden JSON fixtures exported from the web build
scripts/               gen-fixtures.js, the Lune test harness (scripts/lune)
plugin/                Studio test-runner plugin
docs/SPIKES.md         Task 1 spikes: bullet count and iso camera, how to run and what to record
```
