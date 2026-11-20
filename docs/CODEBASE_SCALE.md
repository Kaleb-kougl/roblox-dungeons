# Codebase scale

The repo has grown past the point where a few things can stay manual. Adding one feature touched the same shared
lists, the same pinned spec tails and the same hand-counted numbers in CLAUDE.md, and three modules were one step from
Luau's 200-locals limit. This plan takes the four items from a front-end scalability checklist that fit this repo
(budgets in the build, generators over docs, no junk-drawer modules, docs that stay synced) plus one smaller gap (lint
for determinism), and leaves the rest alone (already done, or web-only: URL state, TanStack, Storybook, Turborepo,
module federation; CI declined by the owner, DXD5).

Work it task by task; each task ends with a **Verify**.

**Tooling only.** No sim, dungeon, lockstep, hash, replay, wire, fixture, score, theme content or presentation change.
Every list keeps its contents and order (DXD1), so every pack validates as before. `DAILY.ruleset` unchanged.

## Status (2026-11-20)

**Owner (2026-11-20): every open question answered.** The decision log moves to `docs/DECISIONS.md` (DXD4); no CI
(DXD5); no list order is known to be read beyond the ones Design 2 locks (DX3 checked the code and agrees).

Built 2026-11-20: DX1-DX5 and DX7-DX11. **Open: DX6** (the archetype skeleton generator DX5's census picked; not
built in this pass, see its task).

## Findings (2026-11-20)

| Fact | Where | Consequence |
|---|---|---|
| Top-level local names: `validate.luau` 197, `sprites.luau` 195, `contract.luau` 190 of Luau's 200 (measured: 200 load, 201 fail with "Out of local registers ... exceeded limit 200"). Next: `score.luau` 158, `combat.luau` 150. | `out/shared/theme`, `out/shared/view` | One more feature's constants broke the load. The counts were done by hand and copied into CLAUDE.md entries. |
| `contract.ts` 2,391 lines, `validate.ts` 2,689, `decorPlan.ts` 2,407, `cues.ts` 2,265, `SimController.ts` 2,428. | `src/` | Every feature appends to the same few modules; the locals limit sat in two of them. |
| 12 theme specs used `tail(list, n, skip)` (37 calls) to pin a feature's ids at a list's end, with `*_AFTER` skip constants for every later feature; five more pinned positions by hand; `contract.spec` pinned both lists' totals; `audio.spec` the whole of `PORT_AUDIO_EVENTS`; five sim specs each held a copy of the whole archetype table. | `src/shared/theme/*.spec.ts`, `src/shared/sim/*.spec.ts` | A new port audio ID meant editing every earlier feature's spec (docs/NEW_ENEMIES_3.md NT1 touched 25 spec files). |
| `.eslintrc.json` blocked client <-> server imports only. The sim's determinism rules were enforced at test time (the restricted Lune realm). | `.eslintrc.json`, `scripts/lune` | An `os.clock()` in `shared/sim` showed up only after a full build and test run. |
| No `.github/workflows`, no git remote. `verify` runs only on the owner's machine. | repo root | Kept that way (DXD5): every gate in this plan is in `npm run verify`. |
| CLAUDE.md was 1,795 lines, about 90 % decision log, with numbers that drift (locals counts, `DAILY.ruleset` history, Codex entry count, analytics names, `SIM_BUTTONS`). | `CLAUDE.md` | It loads into every agent session; stale numbers get trusted. |
| Nearly every feature entry ends "Studio check pending"; there was no one list of them. | `docs/*.md`, CLAUDE.md | Checks pile up feature by feature instead of being cleared in a batch. |

## Design

### 1. A locals budget in `verify`

`scripts/check-luau-locals.js` (`npm run check:locals`, in `verify` after `build`): for every `out/**/*.luau` except
specs, count top-level local NAMES (a line at column 0 starting `local `: `local function f` is 1, `local a, b = ...`
is 2). Fail past `LIMIT` 200 with the module and its count; print every module at or above `WARN` 185. The count is an
upper bound: the compiler does not charge locals it folds as constants.

### 2. Runs instead of tail pins

`shared/theme/testing` `runOf(list, ids)`: the stretch of `list` starting at its first `ids[0]`, as long as `ids`. So
`expect(runOf(PORT_AUDIO_EVENTS, CODEX_AUDIO_IDS)).toEqual([...CODEX_AUDIO_IDS])` holds exactly when the ids are in the
list, together and in order, wherever they sit. A later feature never edits an earlier feature's spec.

Where order is recorded or hashed it stays locked in ONE spec per list (DXD3): the archetype index table
(`sim/actors.spec.ts`), the Codex catalogue (`codex/catalog.spec.ts`), boon / duo indices, breakable piece kinds, the
hash layout.

### 3. Generators for the recurring additions

Only where DX5's census leaves more than about five hand edits (DXD6): `node scripts/new/<recipe>.js <args>` edits the
files in place and prints what is left to do by hand; each has a `node:test` spec on a scratch copy, run with
`test:checks`. Not built yet (DX6).

### 4. Split the near-limit modules

Pure moves into a directory whose `index.ts` re-exports exactly the old module's exports, so no importer changes:
`shared/theme/contract/`, `shared/theme/validate/`, `shared/view/sprites/`. Proof of no change: `npm run dump:lists`
(`scripts/lune/dump-lists.luau`) writes every export of the theme barrel and the sprites module, and the validator's
verdict on every bundled pack, as stable JSON; the file before and after must be byte-identical.

### 5. Docs that stay synced

- **The decision log is `docs/DECISIONS.md`** (DXD4), moved verbatim. CLAUDE.md keeps the intro, the document table,
  a pointer with the rules that apply to every task, Commands, Tests, the determinism rules, Conventions and the
  working agreement.
- **Generated facts:** `npm run facts` writes `docs/FACTS.md` from the build (`scripts/facts.js`,
  `scripts/lune/dump-facts.luau`): `DAILY.ruleset`, `SIM_BUTTONS`, boon / Codex / analytics counts, theme list sizes,
  the archetype index table, every module at or above 150 top-level locals. `verify` runs `facts:check` and fails when
  the checked-in file is stale.

### 6. Determinism in the linter

An ESLint override on `src/shared/sim/**` and `src/shared/dungeon/**` (specs excepted): `no-restricted-properties`
(`math.random` / `randomseed` / `noise`, `os.clock` / `time` / `date` / `difftime`), `no-restricted-globals` (`game`,
`workspace`, `script`, `Instance`, `tick`, `time`, `task`, `wait`, the Roblox datatypes, ...), `no-restricted-imports`
(anything but `shared/sim`, `shared/dungeon`, `shared/jsmath`, `shared/fixtures-generated`; no `@rbxts/*` or
`@flamework/*`). The Lune realm stays the authority: it also catches a forbidden call reached through a helper.

### 7. The open task list

`npm run tasks:open` (`scripts/open-tasks.js`) writes `docs/OPEN_TASKS.md`: every unchecked `- [ ]` task in
`docs/*.md`, grouped (Studio / playtest / device checks; uploads, art and audio; the rest) and by doc with its line,
then the decision log's sentences that say something is pending (some plans list owner checks without a checkbox).
Generated, not gated in `verify`.

## Decisions

- **DXD1. Tooling only.** No list changes contents or order; the dump diff (Design 4) and the suite prove it.
- **DXD2. Fail past 200, warn from 185.** The check reports the real limit with a clear message; the splits, not the
  gate, make the headroom.
- **DXD3. Order locks only where order is read** (owner 2026-11-20: no other order-read list known; DX3 agrees).
  Everything else is checked as a run, so features stop editing each other's specs.
- **DXD4. The decision log moves to `docs/DECISIONS.md`** (owner, 2026-11-20). Every agent session reads CLAUDE.md, so
  the log cost context in every task; the cost of moving it is that an agent must open the log when a task touches a
  past decision (CLAUDE.md's Decisions section says when).
- **DXD5. No CI** (owner, 2026-11-20). Every gate is in `npm run verify`, run locally before finishing as today.
- **DXD6. Generators only where the census says so.** A generator for a two-step recipe is more to maintain than the
  steps.

## Tasks

- [x] **DX1. Locals budget.** → Verify: counts match the hand counts; a scratch module with 201 locals fails.

  **As built.** `scripts/check-luau-locals.js` (+ `.test.js`, 5 cases, in `test:checks`), `check:locals` in `verify`
  after `build`. First run: `validate.luau` 197, `sprites.luau` 195, `contract.luau` 190: CLAUDE.md's hand counts
  exactly. The limit measured on Lune 0.11.0: 200 non-constant locals load, 201 do not.
- [x] **DX2. Determinism lint** (Design 6). → Verify: today's tree passes; scratch violations fail; a spec passes.

  **As built.** One override in `.eslintrc.json`. Today's sim and dungeon lint clean (they import only each other and
  `shared/jsmath`). Scratch files: `@rbxts/services`, `shared/view`, `math.random()`, `os.clock()`, `tick()`,
  `new Vector3` in `shared/sim` and `game.GetService` in `shared/dungeon` each fail with the rule's message; the same
  code in a `.spec.ts` passes; a local named `time` and the words in comments are not flagged.
- [x] **DX3. Which list orders are read.** → Verify: the table.

  | List | Readers outside specs | Order read? |
  |---|---|---|
  | `PORT_AUDIO_EVENTS` | spread into `REQUIRED_ASSET_IDS`; `SLOTS` lookups by id | no |
  | `REQUIRED_ASSET_IDS` | the validator's "required" loop (`validate/manifest.ts`) | no (only the order of problem lines) |
  | `REQUIRED_STRING_KEYS` | the validator's loop; the l10n dump sorts keys | no |
  | `COLOR_ROLES` | a `Set` in `core.ts` and the validator, their loops, `includes` in `view/fx/particles.ts` | no |
  | `ENEMY_ARCHETYPES` (theme) | mapped into asset ids / name keys, `placeholders.ts` loop | no (the sim numbers kinds by its own registry bands) |
  | `BESTIARY_ARCHETYPES` / `BESTIARY_STRING_KEYS` | `includes` in `codex/catalog.ts`; equal to `SIGHTING_IDS` by a spec | no |
  | `FX_IDS` | `includes` (`isFxId`), a filter in `packs/vale/fx.ts` | no |
  | archetype registry (`archetypeIds()`) | actor `kind` indices in state, hashes and recordings | **yes**: `sim/actors.spec.ts` |
  | `CODEX_CATALOG` | stored ids are keys, the screen's order | append-only: `codex/catalog.spec.ts` |

  No reader indexes a theme list by position.
- [x] **DX4. `runOf`** (Design 2). → Verify: a scratch id appended to a list fails no spec but its own.

  **As built.** `shared/theme/testing` (`runOf.ts`, its spec, `index.ts`). 37 `tail(...)` calls in 12 theme specs
  became `runOf`; their local `tail` helpers, the `*_AFTER` / `after` / `skip` constants and the imports only those
  used are gone. Five hand-indexed pins follow (`boosts.spec`, `newEnemies3.spec`, `newEnemies.spec`, `fortune.spec`,
  `view/audio/goldenRumourCues.spec`). `contract.spec` no longer pins the totals of `REQUIRED_ASSET_IDS` /
  `REQUIRED_STRING_KEYS` (uniqueness and "every ID has a slot" stay). `audio.spec` and the theme's `enemyVariants.spec`
  keep their literal lists as a pinned run (the ids up to docs/NEW_ENEMIES_3.md stay together and in order; a later
  feature appends without touching them); the second literal copy of `BESTIARY_STRING_KEYS` is gone (the structural
  check beside it stays). Sim: `sim/actors.spec.ts` is the one lock of the archetype table; `demonlord` / `dummy` /
  `encounterRun` / `enemyVariants` check the head they are about; `golden` / `newEnemies` / `newEnemies2` drop the
  table's total.

  Measured with a scratch `sfx.zz.scratch` (with its SILENT placeholder row), `zz.scratch` string and `zzScratch`
  colour role appended: before, 29 tests in 15 theme specs and 1 view spec failed; after, none (theme 71 suites, the
  79 other specs that read a theme list or pack). Not scratch-tested: `REQUIRED_ASSET_IDS`, `FX_IDS`,
  `ENEMY_ARCHETYPES` (their pins were all `tail` calls, converted).
- [x] **DX5. Touch-point census** (from git, the last features; hand-edited files, specs apart).

  | Recipe | Before DX4 | After DX4 | Generator (DXD6)? |
  |---|---|---|---|
  | A port audio ID (Codex CX5, Silver SV7, secret rooms SR10) | `contract.ts`, the feature's theme module, the placeholder manifest, `view/audio/cues.ts`, `art/audio.json` + 10-17 specs | the same 5 files + the feature's own spec | no |
  | A required string set (the same commits) | `contract.ts` or the feature module, the placeholder manifest, `l10n/context.json` + the same specs | 3 files + its own spec | no |
  | A room archetype's skeleton (NX1 `1e66e18c`, NT1 `d904f630`) | 24-26 non-spec files + 23-25 specs | about 20 non-spec files (`encounterCost.ts`, `sightings.ts`, the archetype file, `archetypes/index.ts`, `actors/index.ts`, `registry.ts`, `dropsData.ts`, `scoreData.ts`, `contract/ids.ts`, `types.ts`, the feature's theme module, `theme/index.ts`, the placeholder manifest, `placeholders.ts`, `variants.ts`, `variantColors.ts`, `cues.ts`, `sighting.ts`, `l10n/context.json`, the doc) + `sim/actors.spec.ts`, `sim/warbanner.spec.ts` and its own specs | **yes** |
- [ ] **DX6. The archetype skeleton generator** (Design 3): `node scripts/new/archetype.js <id> ...` appends the data
  rows DX5 lists (cost, drop weight, score, sighting, theme slot / role / name / bestiary line, placeholder shape,
  the `actors.spec` lock row) and a stub archetype file, and prints what is left (behaviour, band, tuning, art, cues).
  → Verify: its `node:test` spec on a scratch copy; on a scratch branch, generator then `npm run verify` passes with
  only the printed manual steps left. **Not built in this pass** (about 20 insertion points in differently shaped
  lists; wants its own session).
- [x] **DX7. List dump.** → Verify: two runs on the same build are byte-identical.

  **As built.** `scripts/lune/dump-lists.luau` (`npm run dump:lists -- --out <path> [module ...]`): by default the
  theme barrel (566 exports with `view/sprites`) and `validateManifest`'s problems for every bundled pack; arrays in
  order, keys sorted, numbers `%.17g`, functions as `"<function>"`. 1.3 MB, under a second. Output in gitignored
  `build/`.
- [x] **DX8. Splits** (Design 4). → Verify: dumps byte-identical; all three under 170; no import cycle.

  **As built.** Each split by a one-off tool over the TypeScript AST (top-level statements moved verbatim with their
  comments, imports computed, the chunk graph checked acyclic), one commit each; `dump:lists` byte-identical after
  each; theme specs (71 suites) and the sprite specs pass.

  | Module (was) | Now | Top-level locals |
  |---|---|---|
  | `theme/contract.ts` (190) | `theme/contract/`: `slots`, `ids`, `strings`, `colors`, `decor`, `skins`, `fx`, `index` | at most 58 (`colors`) |
  | `theme/validate.ts` (197) | `theme/validate/`: `helpers`, `reports`, `manifest`, `assets`, `index` | at most 84 (`assets`) |
  | `view/sprites.ts` (195) | `view/sprites/`: `facing`, `player`, `actors`, `frames`, `registry`, `index` | at most 119 (`actors`) |

  The fullest compiled module is now `sim/score/score.luau` (158). Helpers that two chunks share are exported from
  their chunk but not from the `index.ts` (which lists the old exports by name where that matters), so the barrels
  export exactly what they did. Comments in the moved code that say "written out (an import would be one more
  top-level local)" are history: the pressure is gone.
- [x] **DX9. Decision log** (Design 5, DXD4). → Verify: byte for byte; CLAUDE.md under 300 lines.

  **As built.** `docs/DECISIONS.md`: a short header (when to read, how to add, what is superseded), then the log,
  equal to CLAUDE.md's removed section byte for byte (180,266 bytes, checked against `HEAD`). CLAUDE.md is 220 lines
  (was 1,795): a `## Decisions` section with the pointer and six rules that apply to every task, four new document
  rows, four commands, two conventions (runs not positions; split before 150 locals) and the lint note.
- [x] **DX10. Facts** (Design 5). → Verify: today's numbers; a changed fact fails `facts:check`.

  **As built.** `scripts/facts.js` (+ `check-facts.test.js`), `scripts/lune/dump-facts.luau`, `npm run facts` /
  `facts:check` (in `verify` after `check:locals`). First file: `DAILY.ruleset` 26, `SIM_BUTTONS` 114687, 20 boons,
  94 Codex entries, 39 of 100 analytics event names, 4,898 of 8,000 combinations, `PORT_AUDIO_EVENTS` 115,
  `REQUIRED_ASSET_IDS` 219, `REQUIRED_STRING_KEYS` 679, `COLOR_ROLES` 137, 27 archetypes. The locals table lists
  modules at or above 150 only (a "top N" would go stale with every edit of a large module). Not in the file: the hash
  group order (no single list to read it from).
- [x] **DX11. Open task list** (Design 7). → Verify: the list holds the open checks; the owner picks a first batch.

  **As built.** `scripts/open-tasks.js` (+ `check-open-tasks.test.js`), `npm run tasks:open`, `docs/OPEN_TASKS.md`
  (named for what it holds: every open task, Studio checks first). First file: 167 open tasks in 60 docs, this plan's DX6 among them (106 Studio /
  playtest / device, 18 uploads / art / audio, 43 other) and 68 decision-log entries with a pending sentence (NT13 and
  NX13 are there: their docs list them without a checkbox). The owner's first batch is open.

## Risks

- **`runOf` is weaker than a tail pin** for a list whose order matters. DX3 found none among the theme lists; the two
  ordered tables keep their locks.
- **The splits moved code, not meaning,** but three large files now live under new paths: an open branch that edits
  `contract.ts`, `validate.ts` or `view/sprites.ts` will conflict on merge. Resolve by applying its hunks to the chunk
  that now holds the statement (`git log --follow` does not track the move).
- **`facts:check` adds a step** whenever a listed number changes (`npm run build && npm run facts`, commit).
- **Agents miss a decision** once the log leaves CLAUDE.md. CLAUDE.md's Decisions section says when to open it and
  carries the rules that apply to every task.
- **No CI** (DXD5): a gate only protects work that runs `verify`.
