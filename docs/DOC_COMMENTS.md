# Doc comments and the API reference

A standard for the `/** */` comments on the code, a build step that turns them into a browsable reference
(`npm run docs` -> `build/api/`), and two gates that keep both from rotting. Tasks DC0-DC11, decisions DCD1-DCD10.

Work it task by task; each task ends with a **Verify**.

**Tooling and comments only.** No sim, dungeon, lockstep, hash, replay, wire, fixture, score, theme content or
presentation change. `DAILY.ruleset` unchanged. One new devDependency (`typedoc`).

## Status (2026-11-20)

**Built 2026-11-20 on branch `doc-comments`, merged to `main` the same day (owner; before `npm run verify` had run on the Mac): DC0-DC6** (TypeDoc, the ratchet, the digest, `@module` on the headers,
a clean `docs:check`, the standard in CLAUDE.md) and **DC7**: the deterministic core (`shared/sim`, `shared/dungeon`,
`shared/lockstep`) has no gap left, exports or fields, **DC8** and **DC9**: **the known-gaps list is empty.** Every
exported declaration in `src/` has a doc comment (generated sources apart, DCD10), and `check:docs` fails on the
first new one without. **DC10** (links) and **DC11** (the plan docs in the site, every `docs/NAME.md` a link) are
built too: **every task of this plan is done.** Left: a second look at the comments the subagents flagged as
uncertain (about 170 over DC7-DC9, listed in each task's notes), and on the owner's Mac `npm install`,
`npm run verify` and `npm run docs`. Not yet done on the owner's Mac:
`npm install` (for `typedoc`), `npm run docs`, a full `npm run verify` (Verification).

**Owner (2026-11-20): every call answered.** `docs:check` in `verify`; one page per file; interface fields gated in
the deterministic core (OC3: choice B, 851 fields); backfill all 1,509 exports; the plan docs go into the site.

## Findings (DC0, 2026-11-20)

Measured on `main` @ `0c58681a` in a Linux arm64 VM (node 22.23.5), with TypeDoc 0.28.20 and TypeScript 5.5.3
installed in a scratch directory and pointed at the repo's `tsconfig.json`. Specs and `fixtures-generated` excluded.

| Fact | Consequence |
|---|---|
| The code is already commented: 19,373 `/** */` blocks in 1,138 of 1,144 source files. **7,143 of 8,652 exported declarations (82.6 %) have one**; 1,509 do not. | This is a backfill and a gate, not a rewrite. |
| The comments are prose. Two `@param` tags and no `{@link}` in the whole tree. | The standard must fit that style (DCD1). Requiring `@param` / `@returns` everywhere would add about 3,500 functions' worth of tags that repeat the types. |
| Interface and class members: 7,110 of 15,047 documented (47 %). TypeDoc's own `notDocumented` check reports 10,820 gaps, 9,171 of them properties. | TypeDoc's check cannot be the coverage gate: it is all or nothing. A ratchet is (Design 3): on exports everywhere, and on interface fields in the deterministic core (DCD4). |
| TypeDoc builds the whole tree **as it is**: 0 errors, 31 s, 1,108 module pages, 9,419 files, 124 MB of HTML. `noLib`, the `@rbxts` type roots, TSX and the Flamework transformer entry in `tsconfig.json` needed nothing special. | No second tsconfig. The output is far too large to commit (DCD3). |
| Entry points from the 100 `index.ts` barrels instead: 29 s, 8,522 files, 108 MB, 24 "referenced but not included" warnings. Only 100 directories have a barrel (25 in `shared/view`, 21 in `shared/sim`, 15 in `client`). | Barrels save nothing and lose the file names every doc and decision entry cites (DCD2). |
| **File header comments are dropped.** 642 files open with a `/** */` followed by an import; TypeDoc discards it without a `@module` tag (`shared/sim/rng`'s page has no text). 64 files already work (header, then a second comment). In 15 files the header sits above the first declaration after a blank line and is read as that declaration's comment. | The best prose in the repo is missing from the output until DC4. |
| 18 exported signatures name a type that is not exported (`Cell` in `dungeon/pellets.ts`, `ArcEraseSink`, `SpriteInputOf`, ...). | Export them or mark them (DC5); then the warning can be an error. |
| Undocumented exports by area: `shared/sim` 373, `shared/view` 326, `shared/theme` 172, `client` 150, `shared/run` 125, `shared/dungeon` 70, `shared/play` 37, `shared/lockstep` 34 (60 % covered, the lowest with `shared/lobby` 55 %), `shared/wallet` 33, `shared/settings` 31, `shared/lobby` 30, the other 14 areas 128. | The backfill order (DC7-DC9). |
| Undocumented exports by kind: 667 `const`, 345 interfaces, 245 functions, 200 type aliases, 52 classes. | Mostly data tables and shapes, not behaviour. |
| `rbxtsc` copies comments into `out/**/*.luau` (11,000 doc comment starts today), and so into the published place. Block comment lines are tab-indented, so `check:locals` does not count them. | A comment edit changes `out/`. "Comment only" needs its own proof (DC3). The place grows slightly with every comment; not addressed here (Risks). |
| No git remote. TypeDoc warns that source links will be broken. | `disableSources: true` (no CI or remote, DXD5). |
| ESLint is 7.32. `eslint-plugin-jsdoc` 65.5.0 needs node `^22.22.2 \|\| >=24.15`; 46.x is the last line built for ESLint 7 / 8. | No lint plugin (DCD5): TypeDoc already reports unknown tags, `@param` names that match no parameter, and broken links. |
| Source comments cite `docs/<NAME>.md` 6,295 times. | Plain text until DC11 makes them links. |

## Design

### 1. The comment standard

TypeScript holds the types; the comment holds what the types cannot say. Added to CLAUDE.md's Conventions as one
bullet that points here.

- **Every exported declaration has a `/** */`** whose first sentence says what it is for. That sentence is the
  summary TypeDoc shows in lists, so it must stand alone. A comment that only restates the name
  (`/** The player state. */ export interface PlayerState`) does not count; say the thing a reader cannot see: units
  (tiles, ticks, half-hearts), ranges and inclusive bounds, what is mutated, what is hashed, what must replay.
- **No types in comments**, ever (`@param {number} x`, `@type`).
- **`@param` and `@returns` only when they add something** the name and type do not. When one parameter gets a
  `@param`, the name must match the signature (TypeDoc reports a mismatch; `docs:check` fails on it).
- **A file's header ends with `@module`** on its own last line, so the header becomes the module page's text.
  A file whose header is also its only declaration's comment (`theme/testing/runOf.ts`) needs none.
- **Code symbols are linked with `{@link name}`** when the reader should follow them; backticks stay for values,
  paths and anything not exported. A bare name resolves when the file can see it (declared or imported there, or
  re-exported by the barrel the comment is in); otherwise name its module:
  `{@link shared/theme/contract/strings!REQUIRED_STRING_KEYS | REQUIRED_STRING_KEYS}`. A member is
  `{@link SimState.pellets}`. `docs:check` fails on a link that does not resolve.
- **Plan docs are cited as plain text**, `docs/WALL_SLIDE.md WS4`: the site turns each `docs/NAME.md` into a link
  (Design 2), so comments stay readable in the editor. Not inside backticks if it should link.
- **Allowed tags:** `@module`, `@param`, `@returns`, `@remarks`, `@example`, `@see`, `@throws`, `@deprecated`,
  `@internal`, `{@link}`. Anything else is an unknown-tag warning and fails `docs:check`.
- **`@internal`** marks an export that exists for a sibling chunk or a spec and is not part of the directory's
  surface (the helpers DX8 exported from chunks but not from their `index.ts`). It still needs its summary.
- **Members** (interface properties, class methods) get a comment when a unit, range or invariant is not obvious
  from the name. **In `shared/sim`, `shared/dungeon` and `shared/lockstep` every field of an exported interface has
  one** (gated, DCD4): the state, config and wire shapes are where a unit or a hash rule is easiest to get wrong.
  For a field, say the unit, the range and whether it is hashed; one line is enough.
- **Ported code keeps its source note in prose** (`source: src/sim/rng.ts`). `PROVENANCE.md` stays the authority.
- Inline `//` comments are untouched by all of this.

### 2. The build

`typedoc` pinned exactly (0.28.20: its peer range covers TypeScript 5.5.x) and a `typedoc.json` at the root:

| Option | Value | Why |
|---|---|---|
| `entryPoints` / `entryPointStrategy` | `["src"]` / `expand` | One page per source file, named as the docs name it: `shared/sim/rng` (DCD2) |
| `exclude` | `**/*.spec.ts(x)`, `**/fixtures-generated/**` | Specs and generated fixtures are not API |
| `out` | `build/api` | `build/` is already gitignored (DCD3) |
| `readme` | `README.md` | The landing page |
| `projectDocuments` | `docs/*.md` | Every plan doc is a page of the site (DC11) |
| `plugin` | `./scripts/typedoc-doc-links.mjs` | Turns each `docs/NAME.md` in a comment or a doc into a link to that page |
| `highlightLanguages` | TypeDoc's defaults + `lua`, `csv` | The docs' code blocks; an unlisted language is a warning, so an error |
| `disableSources` | `true` | No git remote |
| `excludeInternal` | `false` | `@internal` exports are shown, labelled |
| `blockTags` / `inlineTags` | the allowed list of Design 1 | Unknown tags warn |
| `validation` | `notExported`, `invalidLink`: on; `notDocumented`: off | Coverage is Design 3's job |
| `intentionallyNotExported` | `AssetIds`, `SpriteInputOf`, `pellets.ts:Cell` | Private aliases repeated per file (DC5) |
| `treatWarningsAsErrors` | `true` (since DC5) | Makes `docs:check` a gate: an unknown tag or a stray `@param` is a plain warning, not a validation one |

Commands:

```
npm run docs        # typedoc -> build/api/index.html: the API and the plan docs (about 33 s, 136 MB, never committed)
npm run docs:check  # typedoc --emit none: broken {@link}, unknown tags, @param names, unexported types (in verify, OC1)
npm run check:docs  # the export coverage ratchet (in verify; Design 3)
```

`docs` runs `gen:fixtures` first (as `typecheck` does), since the sources import the generated fixtures.

### 3. The coverage ratchet

`scripts/check-doc-coverage.js` (`npm run check:docs`, + a `node:test` spec in `test:checks`): parses every
non-spec file under `src/` with the TypeScript parser (no type check, a few seconds) and counts exported top-level
declarations (functions, classes, interfaces, type aliases, `const`s; `export ... from` lines are not declarations)
that have no `/** */`. It compares them, per area (`shared/<dir>`, `shared` for the files directly in it, `client`,
`server`), with the known gaps in the checked-in `scripts/doc-coverage.json`:

- a gap that is **not in the list** fails with its file, line and name;
- a listed gap that has been documented passes and prints "run `npm run check:docs -- --update`"; the update only
  ever removes names;
- an area with an empty list stays empty: from then on every new export there needs its comment.

The list holds names, not counts (as built, DC2): a count would let a new gap hide behind a closed one, and could not
say which export is new. Gaps are keyed by area and name, not file, so moving an undocumented export inside its area
changes nothing; renaming one, or moving it to another area, means documenting it. A file header that ends in
`@module` belongs to the module, not to the declaration under it.

Two things are not gaps (as built, DC8). **A generated source is skipped**: a file whose first two lines say
`GENERATED by` / `Generated by` and `Do not edit` (the 19 atlas and audio layouts under `theme/packs/vale` that
`art:build` and `audio:build` write; DCD10). **An overloaded function is one declaration**: its later signatures and
its implementation share the first signature's comment.

A second list per area, `fields`, does the same for the properties and method signatures of exported interfaces,
for the areas listed in the script's `FIELD_AREAS` (`shared/sim`, `shared/dungeon`, `shared/lockstep`; DCD4). Class
members and other areas' fields are not counted. Adding an area later is one entry and its backfill.

So new code is held to the standard from DC2 on, and the backfill can land area by area without a flag day. The
gaps live in that file, not in `docs/FACTS.md` (a fact there would go stale on every commit that adds an export). The script does not judge quality; review does.

### 4. Proving a commit is comment only

A backfill pass touches hundreds of files in `shared/sim`. `scripts/out-digest.js` (`npm run out:digest -- --out
<path>`, after `build`): one line per `out/**/*.luau` with the digest of its text with comments removed (a small
Luau lexer: short and long strings are kept, `--` and `--[[ ]]` / `--[=[ ]=]` comments and blank lines dropped).
Digest before and after a pass and `cmp` the two files, as `dump:lists` is used for a pure move. Identical digests
mean the compiled code is identical, so the fixtures, hashes and replays cannot have moved.

**Two modules can differ with no change at all: `client/network.luau` and `server/network.luau`.** Flamework's
generated network guards list a union's literals in an order that varies from build to build
(`t.literalList({ "none", "party", "lobby" })` against `{ "party", "none", "lobby" }`: a set, the order means
nothing), and likewise the fields of a guard built from a mapped type over a union of keys. Seen between the first
and second build of one source, and again after DC7, DC8 and DC9 (there also the order of a `t.union`'s two
members). When those two are the only lines that differ, compare
their stripped text as a multiset of lines with each `literalList` sorted: it must be equal (checked for
`client/network.luau` each time; the server's is built from the same types). Every other module was stable
across every build.

## Decisions

- **DCD1. Prose first, tags only where they add something.** The existing 19,373 comments set the style and it is
  a good one. TSDoc as TypeDoc reads it; no JSDoc type annotations.
- **DCD2. One page per source file** (`expand`), not per barrel (owner, 2026-11-20).
- **DCD3. The reference is built, never committed.** 124 MB of HTML; `build/api` is local output like `build/*.rbxl`.
- **DCD4. Exports are gated everywhere; interface fields are gated in the deterministic core** (owner, 2026-11-20,
  OC3 choice B): `shared/sim`, `shared/dungeon`, `shared/lockstep`, 851 fields to write. Class members and the
  other areas' fields are not gated: 7,086 more gaps, mostly React props and controller internals, would be closed
  with filler.
- **DCD5. No ESLint doc plugin.** One tool (TypeDoc) checks tag names, parameter names and links; one script checks
  presence. ESLint stays at 7.32 with no new plugin.
- **DCD6. A ratchet, not a threshold.** A percentage gate lets a new undocumented export hide behind someone else's
  backfill; a list of known gaps that may only shrink does not (names rather than counts: as built, DC2).
- **DCD7. `docs:check` is in `verify`** (about 30 s more), because there is no CI (DXD5) and a gate outside `verify`
  does not run (owner, 2026-11-20).
- **DCD8. Comments are written from the code, not from the name.** A backfill comment that turns out wrong is worse
  than a gap. Each pass reads the declaration, its callers and its doc entry; where the purpose cannot be
  established, the export keeps its gap and is listed in the task's notes.
- **DCD9. The whole tree is backfilled, the deterministic core first** (`shared/sim`, `shared/dungeon`,
  `shared/lockstep`), then shared contracts, then view and client (owner, 2026-11-20: all of it).

- **DCD10. Generated sources are not gated** (2026-11-20, not an owner call yet: say so if they should be). Their
  39 gaps left the list. A comment written into them by hand is lost on the next `art:build` / `audio:build`; the
  place to document them is the generator (`scripts/art/build-atlases.js`, the icon generators,
  `scripts/audio/build-audio.js`), which could emit a `/** */` per export. Not done: `art:build` cannot run without
  the vendor art, so the change could not be checked here.

## Owner calls

| | Call | Recommendation | Owner (2026-11-20) |
|---|---|---|---|
| OC1 | `docs:check` inside `verify` (+ about 30 s on a run that already takes minutes), or a separate command run before a merge? | In `verify` (DCD7) | **In `verify`** |
| OC2 | One page per file (1,108 pages) or one per barrel? | Per file (DCD2) | **Per file** |
| OC3 | Gate interface / class members too, for some areas (the sim's state shapes, the network contracts)? | No gate; write them where units matter (DCD4) | **B** (below) |
| OC4 | Backfill all 1,509, or stop after the core and shared contracts (DC7-DC8, 1,029) and let the ratchet hold the rest? | All, in three passes (DCD9) | **All** |
| OC5 | Put the plan docs (`docs/*.md`, 84 files) into the same site (DC11)? | Yes if the DC11 spike is cheap; not needed for the rest | **Yes** |

**OC3, spelled out.** "Gated" means `npm run verify` fails when the comment is missing, as `check:docs` does for
exports. A member is a line inside an exported interface or class: a field of `SimState`, a method of a controller.
Today 7,937 of 15,047 members have no comment. The three choices:

| Choice | What `verify` enforces | Comments to write first |
|---|---|---|
| A. No member gate (was recommended) | Exports only. Members are commented where a unit, range or invariant is not obvious | none |
| **B. Gate interface fields in the deterministic core (chosen)** | Every field of an exported interface in `shared/sim`, `shared/dungeon`, `shared/lockstep` (the state, config and wire shapes) | 851 (`sim` 537 of 1,434, `dungeon` 263 of 558, `lockstep` 51 of 209) |
| C. Gate every member everywhere | Every interface field and class member | 7,937 (`shared/view` 2,899 and `client` 1,921 alone) |

B is the same ratchet with a second count per area (Design 3). C would be met largely with filler on React props
and controller internals.

## Tasks

- [x] **DC0. Census and spike.** → Verify: the Findings table.

  **As built.** Scratch only (a parser census of exports and headers; TypeDoc run three ways: `sim` + `dungeon`
  22 s, the whole tree `expand` 31 s, the 100 barrels 29 s). Not tried: `@module` on this repo's headers,
  `projectDocuments`, `--emit none` timing, the owner's Mac.
- [x] **DC1. TypeDoc in the repo.** `typedoc` exact in `devDependencies`, `typedoc.json` (Design 2, with
  `treatValidationWarningsAsErrors` still off), `npm run docs`. Three hand-edited headers with `@module` as a check.
  → Verify: `npm run docs` builds with 0 errors; the three module pages show their header text; `git status` shows
  nothing under `build/`; `npm run verify` still passes (the new dependency moves no type).

  **As built.** `typedoc.json`, `typedoc` 0.28.20 in `devDependencies` (the lock gained 259 lines, lost none),
  `docs` / `docs:check` with `gen:fixtures` pre-hooks. Headers tagged by hand: `sim/rng.ts`, `sim/index.ts`,
  `jsmath/index.ts`; all three pages show their text. `typecheck` clean. **The shared `node_modules` was not touched**
  (it is the owner's macOS install, linked into the worktree; npm run from a Linux VM could drop its platform
  packages): the lock was updated with `npm i --package-lock-only` and TypeDoc ran from a copy outside the repo.
  Run `npm install` on the Mac once. **In the VM, `npm run docs` could not write its 9,400 files into the mounted
  folder** ("Could not write ..." after about 1,000); with `--out` pointed outside the mount the same build is clean
  (0 errors, 32 s). Expected to be a limit of the mount, not of the build; to confirm on the Mac.
- [x] **DC2. Coverage ratchet** (Design 3). `scripts/check-doc-coverage.js`, its `.test.js`, the first
  `scripts/doc-coverage.json`, `check:docs` in `verify` after `lint`. → Verify: the first baseline totals 1,509 exports and
  matches the Findings per area; its `fields` total 851 (`sim` 537, `dungeon` 263, `lockstep` 51); a scratch
  uncommented field in a `shared/sim` interface fails, the same field in `shared/view` does not; a scratch undocumented export fails with its file and line; a scratch documented one
  passes; `--update` never raises a number.

  **As built.** `scripts/check-doc-coverage.js` (+ `.test.js`, 13 cases), `scripts/doc-coverage.json`, `check:docs`
  in `verify` after `lint`. The first list: 1,509 exports and 851 fields (`sim` 537, `dungeon` 263, `lockstep` 51),
  the Findings exactly. Names, not counts (Design 3). Scratch: an uncommented export in `sim/rng.ts`, an uncommented
  interface in `shared/view` and an uncommented field in a `shared/sim` interface each fail with file and line; a
  commented export passes and the `shared/view` interface's field is not reported; `--update` refuses while a new
  gap exists.
- [x] **DC3. Out digest** (Design 4). `scripts/out-digest.js` + `.test.js`. → Verify: editing a comment leaves the
  digest file byte-identical; changing one literal changes exactly that module's line; a string containing `--` and a
  long-bracket string are kept (spec cases).

  **As built.** `scripts/out-digest.js`, `scripts/check-out-digest.test.js` (7 cases; named `check-*` so
  `test:checks` finds it), `npm run out:digest`. On the real tree: 1,793 modules; identical before and after DC4's
  793-file comment change and again after DC5 / DC6. The first-build note is in Design 4.
- [x] **DC4. Headers become module pages.** A one-off codemod adds ` * @module` as the last line of the 642 headers
  that are followed by an import. The 15 headers above a first declaration are split by hand (header with
  `@module`, then the declaration's own comment); the 64 two-comment files get the tag too, so the rule is uniform.
  One commit, when no long-lived branch is open (Risks). → Verify: DC3's digests identical; a script counts module
  pages with header text: at least 721 of 1,108; prettier clean.

  **As built.** The codemod (not kept in the repo) tagged 793 headers: 629 followed by an import, 89 by an
  `export ... from` line (barrels: DC0's census had missed these), 63 by a second doc comment, 12 by a blank line and
  a declaration. With DC1's three: **796 of 1,145 module pages carry their header** (64 before). In nine of the twelve
  the header had been standing in for the first export's comment; those exports got their own (`CacheLoad`,
  `HealthBarsMode`, `StringVars`, `Obj`, `DAILY_STRINGS`, `Vec3`, `CreditSection`, `SIGHTING_VIEW`,
  `SilverCrateFxTunables`), written from the code. Left alone: 33 files whose only comment is their one declaration's
  own, 12 generated `packs/vale/*Layout.ts` files (a `//` header written by `art:build`), 303 files with no header.
  `out:digest` identical for all 1,793 modules; prettier clean.
- [x] **DC5. Unexported types and first warnings.** The 18 types named by exported signatures are exported (with a
  comment) or their users marked `@internal`; any tag or link warning fixed. Then
  `treatValidationWarningsAsErrors: true` and `npm run docs:check`. → Verify: `docs:check` passes with 0 warnings; a
  scratch `{@link NoSuchThing}`, a scratch `@parm` and a `@param` naming no parameter each fail it. Barrels changed by
  a new export: `dump:lists` shows only the added names.

  **As built.** 19 warnings, 13 names. Exported, with a comment where one was missing: `TestBossData` (and its two
  fields: `shared/sim` is a field area), `CaseRule`, `PooledActorView`, `ListRowProps`, `CircleSpec`,
  `PromptKeyState`, `DriverListener`, `MapListener`, `MenuPadListener`. Not exported, listed in
  `intentionallyNotExported`: `AssetIds` (the same private alias in seven `packs/vale` files), `SpriteInputOf` (in
  two sprite files), `Cell` in `dungeon/pellets.ts` (exporting it collides with the Forge's `Cell` in the dungeon
  barrel, TS2308). Folding those aliases into one exported type each is a refactor, not done here.
  `treatWarningsAsErrors` rather than the validation-only switch: an unknown tag and a `@param` naming no parameter
  are plain warnings. `docs:check`: 0 warnings, 24 s. Scratch: `{@link NoSuchThing}`, `@parm` and
  `@param nosuch` each fail it (exit 4 / 3), the tree without them passes. Types only, so no runtime export moved:
  `out:digest` identical (`dump:lists` not run).
- [x] **DC6. The standard in the repo.** `docs/DOC_COMMENTS.md` (this plan, as built), its row in CLAUDE.md's
  document table, three command lines, one Conventions bullet, a `docs/DECISIONS.md` entry; `docs:check` into
  `verify` (OC1). → Verify: `npm run verify`; `facts:check` and `tasks:open` regenerated.

  **As built.** This file; CLAUDE.md (the document row, four command lines, one Conventions bullet); README's script
  table; the `docs/DECISIONS.md` entry; `docs:check` in `verify` after `check:docs`; `docs/OPEN_TASKS.md`
  regenerated (`facts:check`: up to date, nothing to regenerate). See Verification for what of `verify` ran.
- [x] **DC7. Backfill, the deterministic core:** `shared/sim` 373, `shared/dungeon` 70, `shared/lockstep` 34 (477
  exports), and their interface fields: 537, 263, 51 (851). Units, hash membership and replay rules stated where
  they apply; DCD8. Exports and fields in separate commits per area (six). → Verify: the three areas' export and
  field baselines at 0; DC3's digests identical per commit; `docs:check` clean.

  **As built so far (2026-11-20).** `shared/lockstep`: 34 exports and 51 fields. `shared/dungeon`: 70 exports and 263
  fields (the Forge's `Room` / `Prop` / `Dungeon` / `ForgeTheme` shapes, every placer's tunables and plans, the
  census helpers under `testing/`). Both lists are empty, so both areas are held at zero from here. Written from each
  declaration, its file header and its readers (DCD8); units stated (grid tiles, world units, ticks, percent); the
  Forge theme's colours and lights are marked as the web demo's reference data. `out:digest`: identical but for the
  two network modules' literal order (Design 4); `docs:check` clean; prettier clean.

  **`shared/sim` (2026-11-20, owner: with subagents).** 373 exports and 537 fields, written by seven subagents in
  parallel on disjoint files (the root files with `dev` / `testing` / `tutorial`; `builds`; `combat` with `weapons`;
  `combat/actors` in two halves; `drops` / `golden` / `pacts` / `pellets` / `progression`; `affixes` / `breakables` /
  `score` / `secrets` / `silver` / `treasure`), each given the standard, told to leave a gap rather than guess and to
  report what it was unsure of. None left a gap. Reviewed here: every flagged comment's claim spot-checked where it
  was a fact about another file (the treasure Respite percent is added, not multiplied; the boss's band; bullet speed
  units; the Goldling's own stream), a random sample of the 910 read, none under four words but five index / count
  one-liners. **Corrected in review:** `ActorState.hp` said it starts as `data.hp`; it starts at `hpMax`, which is
  `data.hp` after the spawn's scaling and the Hulking affix. **One existing comment replaced:** the doc comment above
  the private `cloneRun` in `state.ts` described `cloneSimState` (left behind by an earlier refactor);
  `cloneSimState` has its own now and `cloneRun`'s says what it does. Not independently verified: the rest of the
  flagged comments (about sixty, listed in the subagents' reports: mostly units inferred from a sibling comment, and
  "the view reads it" claims made without opening the view). `out:digest`: identical but for the two network
  modules, whose stripped text is equal once each `literalList` is sorted; `docs:check` clean; prettier clean.
- [x] **DC8. Backfill, shared contracts:** `theme` 172, `run` 125, `play` 37, `wallet` 33, `settings` 31, `lobby`
  30 and the 13 small shared areas (124): 552; with DC7, 1,029. → Verify: as DC7.

  **As built (2026-11-20).** 513 comments by four subagents on disjoint directories (`theme` 133; `run` 125; `play`
  37, `wallet` 33, `settings` 31, `lobby` 30; the small areas 124: `leaderboard` 27, `onboarding` 24, `codex` 18,
  `records` 11, `tutorial` 11, `invite` 8, `l10n` 6, `config` 6, `silver` 4, `characters` 3, `daily` 2, `spikes` 1,
  `network.ts` 3), none left a gap; the other 39 of `theme`'s 172 are the generated layouts (DCD10). Reviewed as
  DC7: a random sample read, none under four words, no tags. The subagents corrected nine of their own comments
  against the code before handing back. About forty-five comments were flagged as less than certain and are not
  independently verified (mostly "who reads this" statements made from a grep or a file header, and reject-code
  meanings read from call sites). **Existing headers corrected in review**, each confirmed from the code:
  `settings/store.ts` ("settings today": four services construct a `PlayerDocCache`), `settings/doc.ts` (the display
  group listed four of `DisplaySettings`' 19 keys; the juice line lacked the room clear setting). **Reported, not
  changed:** `lobby/config.ts`'s header says display strings "come from shared/theme later" (not checked); comments
  that sit above the wrong neighbour (`l10n/hash.ts`, `l10n/localeTable.ts` `LocaleEntry`, `config/mode.ts`
  `PlayMode`, `theme/contract/ids.ts` `boostStringKeys`): each export now has its own, the stray ones stay;
  `variantColors.ts` keeps private copies of `fixed1` / `fixed2` (code, not comments). `check:docs` also learned that
  an overload group is one declaration (two gaps in later areas closed by that). `out:digest`: identical but for the
  two network modules (Design 4); `docs:check` clean; prettier clean.
- [x] **DC9. Backfill, presentation and engine code:** `shared/view` 326, `client` 150, `server` 4 (480). → Verify: every baseline at 0; `npm run verify`.

  **As built (2026-11-20).** 478 comments (two of the 480 were overload signatures, DC8) by five subagents on
  disjoint directories: `shared/view`'s root files and small directories 121, `view/fx` 73, `view/hud` 81,
  `view/menu` 49 with `client` outside the store 41 and `server` 4, `client/store` 109. None left a gap;
  `scripts/doc-coverage.json` now holds empty lists only. Selectors say what the value means (unit, range, what
  empty looks like), none opens with "Selects". Reviewed as before: a random sample read, none under four words, no
  tags; `git diff` shows insertions only from the subagents (one had overwritten an existing field comment in
  `client/store/wallet.ts` and restored it; confirmed). About sixty comments were flagged as less than certain and
  are not independently verified: mostly "which controller reads this" from a grep, and the summaries of the large
  config objects (`TOUCH_LAYOUT`, `HUD_STRINGS`, `DRAFT_REVEAL`, `BUILD_FX_VIEW`, `BOOST_VIEW` and the like), written
  from the file header and top-level keys rather than every field. **Corrected in review:** `SILVER_SHOP`'s new
  comment named `silverShop.ts` as a reader (it reads the wallet's, not this one). **Existing comments corrected**,
  each confirmed from the code: `InputController`'s long class comment was orphaned above `chatFocused` and is back
  above `@Controller` (the subagent's stand-in summary dropped); `server/log.ts` gave the line shape without its
  colon; `particles.ts` `SHRINK_AT` and `particleSize` said "the last SHRINK_AT share" where the code shrinks past
  65 % of the life (the last 35 %); `client/store/wallet.ts` `seenAffordable` was described as a balance and is a
  list of item ids. **Reported, not changed:** slice headers that sit above an unrelated type in `client/store`
  (`codex.ts`, `lobby.ts`, `options.ts`); comments covering a pair or trio of declarations from above the first
  (`hud/progression.ts`, `hud/draftCards.ts`, `hud/contributionConfig.ts`, `sprites/actors.ts`); `hud/tooltip.ts`'s
  header cites `docs/ITEM_TOOLTIPS.md`, which CLAUDE.md's table does not list; `minimap/config.ts` `teammateRoles`
  says every player is the vanguard capsule (the Archer may have changed that); `store/settings.ts` `selectDisplay`
  says "(HUD scale percent)" of a group that holds more; overlong comment lines in `sprites/facing.ts`,
  `decor/director.ts` and `settings/display.ts`. `typecheck`, `docs:check`, prettier clean; `out:digest` identical
  but for the two network modules (Design 4).
- [x] **DC10. Links where they pay.** `{@link}` on the references a reader follows most: the sim barrel's header,
  `SimConfig`'s opt-in fields to their feature modules, archetype and weapon defs to their hooks, each theme
  feature module to its contract ids. Not a sweep of every backticked name. → Verify: `docs:check` clean; the
  `SimConfig` page links to each feature's module.

  **As built (2026-11-20).** Four places, 91 links. The sim barrel's header says where to start (`step`,
  `stepParty`, `createSimState`, `SimConfig`, `SimState`, `hashState`). Each of `SimConfig`'s 15 opt-in fields links
  its state (`SimState.pellets`) and, where one exists in that file's scope, its step function (`stepPellets`): the
  field's type already links the feature's config. `registerArchetype` / `registerWeapon` link the def and each of
  its hooks, and `ArchetypeDef` / `WeaponDef` link back. 21 theme feature modules list, as links, the contract lists
  their headers name (`REQUIRED_STRING_KEYS`, `PORT_AUDIO_EVENTS`, `FX_IDS`, `REQUIRED_ASSET_IDS`, `SLOTS`,
  `COLOR_ROLES`: 43 links, module-qualified since those files import nothing). What resolves was found by trying
  (Design 1's rule). Rendered and checked: the `SimConfig` page's links open `SimState`'s fields and the step
  functions' pages; `docs:check` clean; `out:digest` identical but for the two network modules.
- [x] **DC11. Plan docs in the site** (owner 2026-11-20: yes). TypeDoc's `projectDocuments` with `docs/*.md`
  (not tried in DC0: spike it first and record build time and size); then `docs/<NAME>.md` in comments becomes a
  link. → Verify: every plan doc has a page and its tables render; a comment's `docs/WALL_SLIDE.md` opens that page;
  the spike's numbers recorded here. If `projectDocuments` cannot carry them, say so here and stop.

  **As built (2026-11-20).** `projectDocuments: ["docs/*.md"]`: 85 pages under `documents/`, tables rendered. The
  whole build went from 31 s / 124 MB to 33 s / 136 MB (9,904 files). Two code block languages the docs use (`lua`,
  `csv`) had to be added to `highlightLanguages`, or each is a warning and `docs:check` fails. **The links are made
  at render time, not written into the comments:** `scripts/typedoc-doc-links.mjs` (a TypeDoc plugin of 40 lines, no
  import from `typedoc`) runs before the markdown parser and calls `scripts/doc-links.js` `linkDocMentions`
  (+ `check-doc-links.test.js`, 4 cases): a `docs/NAME.md` in running text becomes a link to that doc's page,
  relative to the page being rendered; code spans, fenced blocks, existing links, longer paths and names without a
  page are left alone. 4,498 links in the built site (comments and docs alike). Rewriting the 6,295 mentions in the
  sources as markdown links was the alternative and would have made every comment harder to read in the editor.
  Checked: `shared/run/playerMover`'s page links `docs/WALL_SLIDE.md` to `documents/WALL_SLIDE.html`; `docs:check`
  clean, 25 s. Not linked: mentions inside backticks (a deliberate rule; many headers cite docs that way).

## Verification (2026-11-20)

On branch `doc-comments` in a Linux arm64 VM (node 22.23.5, Lune 0.11.0 fetched for the run; `rbxtsc` needs
`NODE_OPTIONS=--max-old-space-size=3200` there, 89 s). Passed: `typecheck`; `lint` with `--max-warnings=0`;
`check:docs`; `docs:check` (0 warnings); `check:assets`; `check:autolocalize`; `test:checks` (45 tests);
`test:l10n` (36); `build`; `check:locals` (1,161 modules, none at or above 185); `facts:check`; prettier.
`out:digest`: every one of the 1,793 compiled modules, specs included, is identical with comments stripped to the
build of the source before DC4.

**Not passed / not run:**

- **`test:art`: 345 pass, 6 fail, 5 skipped** (the boon / boost / duo / heart / item / pip icon atlas groups). The
  fresh worktree has no `art/vendor` (gitignored, licensed packs); nothing under `art/` or `scripts/art/` changed on
  this branch. Not re-run against the main checkout's vendor art.
- **The headless suite was not run in full.** One spec file per process, four at a time, got through 35 of 632
  files in 150 s (all passing) under that shell's 3-minute cap; the whole suite would have been about 45 minutes of
  batches. The digest above is the evidence that the specs' compiled code did not change. Run `npm run verify` on
  the Mac before merging.
- `npm run docs` writing into `build/api` (DC1's note), `dump:lists`, the Studio test-runner plugin.

**After the backfill (2026-11-20, DC7-DC9).** Run after each pass in the same VM: `check:docs`, `docs:check`,
prettier, `build`, `out:digest` (identical every time but for the ordering in the two generated network modules);
after DC9 also `typecheck`, `lint` and `test:checks` (47 tests). Not run, as before: the headless suite, `test:art`, `npm run docs` into `build/api`. The comment-only digest is the evidence that no
compiled code moved; `npm run verify` on the Mac is still the gate before merging.

## Risks

- **Stale comments.** No tool checks that a comment is true. The gates catch a missing comment, a renamed parameter
  and a dead link; a changed behaviour under an old sentence is caught only in review. The standard's bias toward
  short comments about units and invariants (not narration of the body) is the mitigation.
- **Filler.** A ratchet rewards any comment. DCD8 and review hold the line; the baseline can also be met by marking
  an accidental export non-exported, which is the better fix where it applies.
- **DC4 touches 721 files** (one added line each). A branch that edits a header's last line conflicts; land it when
  the open worktrees are merged or rebase them straight after.
- **A plan doc can now fail `verify`.** The docs are part of `docs:check`: a code block in a language missing from
  `highlightLanguages`, or a broken relative link in a doc, is a warning and so an error. Add the language to
  `typedoc.json`.
- **`verify` grows** by about 30 s (`docs:check`, estimated from the full build) plus a few seconds (`check:docs`).
- **TypeDoc is pinned to TypeScript's version.** A TypeScript upgrade (roblox-ts drives it) may need a TypeDoc
  bump in the same commit; 0.28.20 accepts 5.0 through 6.0.
- **Comments ship in the place.** `rbxtsc` writes them into the Luau, so 1,509 more comments add a little source to
  the published place. Stripping comments from `build:place` is a separate decision, not taken here.
- **The spike ran in a Linux VM,** not on the owner's Mac; timings there will differ, results should not.
