# Developing

Everything a contributor needs to build, test and run the game. The project overview is the root `README.md`;
the conventions every change follows are in `CLAUDE.md`.

## Setup

Requires Node 20+ and [Rokit](https://github.com/rojo-rbx/rokit).

```bash
rokit install       # rojo 7.7.1 and lune 0.11.0 (rokit.toml)
npm install
npm test            # build, then run the headless spec suite under Lune
npm run dev         # rbxtsc in watch mode + rojo serve
```

Then open a place in Roblox Studio, connect the Rojo plugin (7.7.x) and press Play.

The build and the spec suite need no art packs: the atlas layouts and asset ids are committed. Rebuilding the
atlases or audio (`art:build`, `audio:build`) needs the licensed packs under `art/vendor/`, which are never in git
(`art/README.md` lists each pack and where it goes). Without them, 5 of the atlas pipeline's tests skip.

## Scripts

### Every day

| Script | What it does |
|---|---|
| `npm run verify` | The pre-merge gate, 13 steps in order: `typecheck`, `lint`, `check:docs`, `docs:check`, `check:assets`, `check:autolocalize`, `test:art`, `test:checks`, `test:l10n`, `build`, `check:locals`, `facts:check`, `test:only` |
| `npm test` | Build, then run every `src/shared/**/*.spec.ts` headlessly (Lune + real Jest modules) |
| `npm run test:only -- sim/rng` | Rerun specs without rebuilding; arguments filter by source path. `--census <path>` runs an opt-in census spec's full sample |
| `npm run build` | Generate the fixture modules, compile `src/` to `out/` with rbxtsc |
| `npm run dev` | `rbxtsc -w` and `rojo serve` together |
| `npm run typecheck` / `lint` / `format` | tsc, ESLint at zero warnings, Prettier |
| `npm run build:place` | A publishable place, `build/roblox-dungeons.rbxl`, without specs, fixtures or Jest |
| `npm run test:plugin` | Install the Studio test-runner plugin (the same specs under `@rbxts/jest` in Studio) |

### Checks (all part of `verify`)

| Script | What it checks |
|---|---|
| `check:docs` | Every export has a doc comment; fields too in `shared/sim`, `shared/dungeon`, `shared/lockstep` (docs/DOC_COMMENTS.md) |
| `docs:check` | TypeDoc without output: broken `{@link}`, unknown tags, a `@param` naming no parameter |
| `check:assets` | No hard-coded asset id outside `src/shared/theme` |
| `check:autolocalize` | AutoLocalize is off on every GUI (docs/LOCALIZATION.md) |
| `check:locals` | (after build) top-level locals per compiled module: fails past Luau's 200, warns from 185 |
| `facts:check` | `docs/FACTS.md` matches the build |
| `test:art` / `test:checks` / `test:l10n` | node:test specs of the atlas pipeline, the check scripts and the localization pipeline |

### Generators and reports

| Script | What it does |
|---|---|
| `npm run gen:fixtures` | `fixtures/*.json` to `src/shared/fixtures-generated/` (runs before build, typecheck, lint and docs) |
| `npm run facts` | (after build) regenerate `docs/FACTS.md` |
| `npm run tasks:open` | Regenerate `docs/OPEN_TASKS.md` from the unchecked tasks in `docs/*.md` |
| `npm run docs` | TypeDoc to `build/api/index.html`: the API reference, with `docs/*.md` as pages (about 33 s, never committed) |
| `npm run out:digest -- --out <file>` | (after build) one digest per compiled module with comments stripped: digest before and after, then `cmp`, to prove a change is comment only |
| `npm run dump:lists -- --out <file>` | (after build) every theme export as stable JSON: dump before and after a pure-move refactor, then `cmp` |

### Art, audio and localization

| Script | What it does |
|---|---|
| `npm run art:build` | `art/vendor` to the atlases in `art/build` and the generated layouts in `packs/vale/` (`art:lock` rewrites `art/vendor.lock.json`) |
| `npm run audio:build` | `art/vendor/ninja-adventure/Audio` to `art/build/audio/*.ogg` and `packs/vale/audioLayout.ts` (`audio:lock`, `audio:audition`) |
| `npm run l10n:export` | (after build) the English strings and `l10n/context.json` to CSVs for the Roblox cloud table |
| `npm run l10n:import -- <table.csv>` | The downloaded cloud table to `shared/theme/locales/*.ts` and `l10n/report.md` |
| `npm run l10n:check` | (after build) translation coverage, stale and context report |

## Layout

```
src/shared/sim/        the deterministic simulation: plain TypeScript, no Roblox APIs
src/shared/dungeon/    the Dungeon Forge floor generator, deterministic like the sim
src/shared/lockstep/   co-op: relay, session, playout pacer, input lead, prediction, wire format
src/shared/run/        run configs, recordings, replay validation and its limits
src/shared/theme/      the theme contract, validators, packs (logical asset ids), locale tables
src/shared/view/       presentation math shared by the client, testable headlessly
src/shared/config/     tunables
src/shared/...         one directory per feature's shared contract (daily, codex, wallet, lobby, cosmetics, ...)
src/client/            Flamework controllers, the Reflex store, the React UI
src/server/            Flamework services: run validation, lobby, leaderboards, wallet, shop
fixtures/              golden JSON fixtures the sim must reproduce bit for bit (fixtures/README.md)
scripts/               the Lune test harness (scripts/lune), the art, audio and l10n pipelines, the check scripts
art/                   atlas and audio manifests and lock files; the packs themselves are not in git
l10n/                  localization context and pipeline inputs
plugin/                the Studio test-runner plugin
docs/                  one plan per feature, the decision log, the generated FACTS and OPEN_TASKS
docs/decisions/        six decision records extracted from the log (docs/decisions/README.md)
ARCHITECTURE.md        the layers, one frame of co-op, the trust boundary, the determinism invariant
```

`client/` and `server/` never import each other; shared contracts live in `shared/`. Each directory has a barrel
`index.ts`: import from the directory, not the file.

## Tests

Specs are `*.spec.ts` next to the code, written against `@rbxts/jest-globals`. Only specs under `src/shared/**`
run headlessly (client and server code need the engine). Modules under `shared/sim` and `shared/dungeon` load in
a restricted environment where clocks, RNG and Roblox globals throw `[determinism]`. `CLAUDE.md` has the full
rules: what is unavailable headlessly, how fixtures are imported, how a long census is sharded.
