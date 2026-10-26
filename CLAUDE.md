# Kaleb-Vale (Roblox port)

A port of the web game **Project Kaleb-Vale** (top-down bullet-hell ARPG, M1 "First fight") to Roblox.
**roblox-ts + Flamework + Reflex + React**, synced with Rojo. The plan is `PLAN.md`; work it task by task.

## The source project

`/Users/kalebmon/Documents/project-kaleb-vale` @ **`42897e2`** (Three.js / TypeScript). It is the reference:
its outputs are exported as golden JSON fixtures (`fixtures/`) and this build must match them bit for bit.

**It is READ-ONLY.** Never modify it, commit to it, or run its build. Read its code; port from it.
Record every ported module in `PROVENANCE.md` (ported module, source path, source commit).

## Documents

| File | Authority over |
|---|---|
| `PLAN.md` | Scope, decisions, task order, go/no-go gates |
| `PROVENANCE.md` | One row per ported module: source path + source commit |
| `docs/SPIKES.md` | Task 1 spikes: how to run them in Studio and the recorded results |
| `docs/ART.md` | Vertical-slice art: packs, licences, contract v2, atlas pipeline, renderer, status |
| `docs/TUTORIAL.md` | First-run tutorial ("Practice Descent"): plan, as-built notes, tasks T1-T8, owner decisions |

Decision log (deviations from `PLAN.md`):
- **Art (docs/ART.md).** The theme contract gained a `"sprites"` kind (large pre-rendered cells, 1/4/8/16 screen-space
  facings, several atlases per set, `pixelsPerTile`) next to the web build's 16 px `spritesheet`; tile images may repeat
  (`tilesPerImage`) and ui images carry a `pivot`. The default pack is `vale` (`shared/config/theme.ts`), which equals
  `placeholder` until ids are pasted into `packs/vale/assetIds.ts`. Raw art packs live in gitignored `art/vendor/`
  (licences forbid redistribution); `npm run art:build` makes the atlases.
- The HUD uses **Reflex** (`@rbxts/reflex` + `@rbxts/react-reflex`), not charm.
- **Trig.** The sim never calls `math.sin`/`math.cos`: bullet bursts read a table of V8's exact values
  (`fixtures/arc-table.json`); the Dungeon Forge uses `shared/dungeon/forge/trig.ts`, a correctly rounded sin/cos
  that gives identical results on every Roblox client and server (platform libm does not). Cost: 2 of 20,000 tested
  MVP seeds (706, 10186) lay out differently from the web build, because V8's sin is 1 ulp off there. Exact parity
  for every seed would need a port of V8's LGPL glibc sin/cos; not done.
- `JSON.parse` syntax-error wording in `deserializeRecording` differs from V8's (not covered by fixtures).
- **Solid pillars on endless floors (docs/DECOR.md D2).** Endless floors set the Kaleb-Vale Forge option
  `solidPillars` (`endlessFloorParams`): after decoration every pillar cell becomes WALL (cover against bullets and
  sight), and the room enemies' walks (`walkToward(..., STEER)`, never the boss) use `SimConfig.actorSteerMover`
  (`actorSteerMover`) to round them; it only differs from `moveCircle` at pillars and clipped wall ends. M1
  (`KALEB_VALE_MVP_PARAMS`) and every fixture leave both off and replay exactly as before; endless replays changed.
- **Double-size rooms on endless floors.** Endless floors set the Kaleb-Vale Forge option `roomScale` to
  `ENDLESS_ROOM_SCALE` = 2 (`endlessFloorParams`): every rolled room width and height, `minCombatRoomSize` and the
  scatter radius are doubled (4x the floor area; corridor lengths stay about the same). No extra rng draws; 1 or
  undefined is the unscaled floor exactly, so M1 and every fixture are unchanged; endless layouts and replays changed.
  Room encounter budgets are unchanged, so the same enemies spread over more floor.
- **Archetype bands.** Kinds number by (`ArchetypeDef.band`, then id order), not id order alone. The web build's
  archetypes are band 0 (indices 0..6, pinned by hashed golden runs); a port-only archetype takes a NEW band so it
  numbers after the web table and no web index ever moves. The training dummy is band 1 (`PORT_BAND_TUTORIAL`),
  index 7 (`shared/sim/combat/actors/registry.ts`).
- **`enemy.dummy`.** The theme contract's `ENEMY_ARCHETYPES` gained `dummy` after the web build's six: every pack
  must fill `enemy.dummy` (asset and colour role) and `enemy.dummy.name` (placeholder: a post).
- **Tutorial (docs/TUTORIAL.md).** `SimConfig.tutorial` is an opt-in harmless mode (hits land but never cost hearts or
  armor, optional wounded start) with its own `tutorial` hash group appended after `party`; without it nothing
  changes and every fixture matches. The `tutorial` world is registered for the client's local build only: the server
  refuses it (`shared/run` `SERVER_REFUSED_WORLDS`) and it is never submitted or posted. "Has played the tutorial" is
  a per-player doc in DataStore `KV_Onboarding_v1` (`OnboardingService`, codec in `shared/onboarding`). Its floors are
  endless floors with fixed seeds (`tutorialForgeParams` = `endlessFloorParams` + seed / room count, world from
  `endlessFloorWorld`), so endless Forge options (solid pillars, `roomScale`) apply; a layout change fails its lock spec.
  A first join (onboarding loaded and not done, or `KV_Tutorial`) starts it before, instead of, the main menu; Skip
  leaves like Leave run (back to the menu), the outro's Start my first run is Play solo, and the main menu has the
  replay. A player in it is busy for lobbies (`RunSessionService.busyReason`), so no lobby start takes it over.
- **Breakable clutter on endless floors (docs/DECOR.md D4).** Endless floors get barrels and crates
  (`shared/dungeon` `placeBreakables`, on `EndlessFloorLayout` / `EndlessFloorWorld.breakables`): placed after the
  Forge from their own stream (`floorSeed ^ BREAKABLE.salt`), so layouts, digests, props and room spawns stay put; they
  keep clear of the party's own spawns (so pieces depend on the party size) and their cells leave `roomSpawnTiles`.
  Endless runs set `SimConfig.breakables` (`BREAKABLES_CONFIG`): `state.breakables` (per piece kind, cell, hp, broken
  tick) with its own `breakables` hash group appended last; the movers and the bullet blocker take an optional trailing
  `solid` (`SolidCells`) the sim passes from state (absent: exactly the grid-only path); they block bodies and every
  bullet but not sight, break under player bullets / sword swings / enemy bullets / the boss's slam, and a player's
  break scores the appended source `BREAKABLES` (no combo). M1 (`KALEB_VALE_MVP_PARAMS`), every fixture and the
  tutorial (no `breakables`, B7) replay exactly as before; endless replays and scores changed.

## Commands

```
npm run verify      # typecheck -> lint -> build -> headless tests. Run before you finish
npm test            # gen fixtures -> rbxtsc -> Lune runs every out/shared/**/*.spec
npm run test:only -- sim/rng   # rerun specs without rebuilding; args filter by source path
npm run build       # gen fixtures -> rbxtsc -> out/
npm run dev         # rbxtsc -w + rojo serve
npm run build:place # publishable place: build/kaleb-vale.rbxl from publish.project.json (no specs, fixtures or Jest)
npm run test:plugin # Studio test-runner plugin (same specs under real @rbxts/jest in Studio)
npm run art:build   # art/vendor -> art/build atlases + packs/vale/layout.ts (art:lock rewrites art/vendor.lock.json)
```

Tools come from `rokit.toml` (`rokit install`): rojo 7.7.0, lune 0.11.0.

## Tests

- Specs are `*.spec.ts` next to the code, written against `@rbxts/jest-globals`
  (`import { describe, expect, it } from "@rbxts/jest-globals"`). The same file runs headlessly and in Studio.
- `npm test` runs them **headlessly under Lune** (`scripts/lune/run-tests.luau`) with Jest's real JestCircus,
  Expect and JestMock modules. Only specs under `src/shared/**` are discovered (client/server code needs the engine).
- Not available headlessly: snapshots, fake timers, `jest.mock`, real Instances or services. Roblox datatypes
  (Vector3, CFrame, Color3, Enum, ...) exist outside the sim (Lune's float32 implementations).
- Fixtures: `fixtures/**/*.json` become `src/shared/fixtures-generated/<name>` (gitignored, regenerated before
  build / typecheck / lint). Import with a default import: `import rng from "shared/fixtures-generated/rng"`.
  Numbers are bit-exact (written as shortest round-trip literals, `-0` kept); a `.` in a file name becomes `_`.
  Never route fixtures through Rojo JSON modules or `HttpService:JSONDecode`: serde-style parsers can be 1 ULP off.

## The sim is deterministic and Roblox-API-free

`src/shared/sim/**` (and `src/shared/dungeon/**`, which the sim calls) is plain TypeScript: no Roblox services,
Instances, datatypes, Enums, Flamework decorators, `os.clock` / `tick` / `time` / `os.time`, or `math.random`.
Everything `step()` reaches must replay bit-identically (the source's `src/sim/README.md` rules apply: no trig in
the sim, fixed iteration order, every state field hashed). The headless runner **enforces** this: those modules
load in a restricted environment where the forbidden globals throw `[determinism] ...`. Spec files are exempt.

Port JS-isms deliberately: `.length` -> `.size()`, `null` -> `undefined`, 32-bit integer math through `bit32` and a
split-16-bit `imul`, no getters in sim state.

## Conventions

- **Janitor** for cleanup, never Maid.
- **Barrel `index.ts`** per directory. Import from the directory, not the file (generated fixtures are the exception).
- **`client/` and `server/` never import each other.** Shared contracts live in `shared/`.
- **No magic numbers.** Tunables live in `shared/config` (or the data module that owns them), never inline in logic.
- **Roblox properties are float32; Luau arithmetic is float64.** A value written to a property and read back is not
  the value you computed. Assert with tolerance (`toBeCloseTo`) only where a value passes through a property or
  accumulates; keep exact assertions where it never leaves float64 (all sim and fixture parity checks).
- Every visual and audio asset goes through logical IDs in `shared/theme`; no `rbxassetid://` anywhere else.
- Luau reserves some identifiers roblox-ts rejects (`next`, `not`, `end`, `table`, `type`, `local`, `_`); rename them.
- **`for (let i = 0; i < arr.size(); i++)` reads the bound once** (it compiles to a numeric Luau `for`). If the body
  grows or shrinks the array (queues, swap-remove, free stacks), use a `while` loop.
- roblox-ts drops arithmetic on the left of a for-loop condition: `for (let t = 0; t + 110 <= n; t++)` compiles to
  `for t = 0, n`. Keep the loop variable alone on the left (`const last = n - 110; t <= last`).
- Hooks on def objects (`ArchetypeDef`, `WeaponDef`) are called with `:`; write every hook as a method
  (`onHit(ctx, a) { engageOnHit(ctx, a); }`), never `onHit: engageOnHit`.
- A new bullet burst shape needs an entry in `combat/arcTable.ts` (regenerate with `scripts/gen-arc-table.js`);
  until then it fails with "arc table miss".
- `throw` compiles to `error(x)`, which prefixes `file:line:`; use `error(msg, 0)` where the message is compared.
- Interface methods compile to `:` calls: implement them with method syntax; type arrow-function properties as
  `f: (a) => T`. `**` compiles to `^` (pow): use plain multiplication on the sim path.
- No `splice`/`slice`: use `arr.remove(i)` and loops. Iterate fixture objects as a `ReadonlyMap` view
  (`pairs()` on a Record trips `roblox-ts/no-array-pairs`).
- `scripts/check-asset-ids.js` flags strings of 7+ digits; on a legitimate hex/digest test vector append
  `// check-asset-ids: allow (reason)`.

## Working agreement

- Report failures plainly, with output. If you skipped something, say what and why.
- Spikes and debug features are off by default (Workspace attributes / `shared/config`), cleaned up with Janitor.
