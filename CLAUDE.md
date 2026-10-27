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
| `docs/TUTORIAL_ARROW.md` | Tutorial guidance arrow (floor chevron pointing along the path to the objective): plan, tasks A1-A6, decisions |
| `docs/OUTLINE.md` | Enemy outlines: plan, as-built notes, tasks O1-O7, decisions E1-E6 |
| `docs/FX_AUDIO.md` | Sprite effects and audio (Ninja Adventure FX / Audio): slots, pipelines, cue mappers, tasks X0 / F0-F6 / A0-A5 |
| `docs/SPECTATE.md` | Co-op spectating (watch and switch between living teammates after a death): plan, tasks S0-S6, decisions |
| `docs/BOOSTS.md` | Temporary boosts dropped by killed enemies (Fury / Quickstep / Frenzy / Aegis): plan, tasks B0-B11, decisions |
| `docs/BOOST_ART.md` | Boost drop art (Lords of Pain gold coins and gemstones, tinted halo and beam, gems out of decor): plan, tasks BA0-BA7, decisions |
| `docs/SNIPER_ART.md` | Sniper art (`enemy.sniper` as the Lords of Pain subservient): mapping, budget, tasks SN1-SN8, decisions D1-D6 |
| `docs/BOSS_DEMONLORD.md` | Demon Lord boss variant (`boss.demonlord`, seeded pick per endless boss floor, Lords of Pain Demonlord art): plan, tasks D0-D8, decisions |
| `docs/CURSOR.md` | Gauntlet mouse cursor (Lords of Pain `cursor_gauntlet_*`, software cursor, hover / target colours): plan, tasks C0-C8, decisions D1-D5 |
| `docs/DEMON_ART.md` | Placeholder enemies as 2D Demons (bruiser = Demon Beast 3; turrets later; Lords of Pain art unchanged): plan, tasks DA0-DA8, decisions DD1-DD6 |
| `docs/BRAMBLE_ART.md` | Mother Bramble (`boss.act1`) as a 2D Demons Elite: state-to-animation mapping, size and budget, tasks BR0-BR7, decisions BD1-BD7 |
| `docs/ROOM_EDGES.md` | Room edges (dashed floor line where every corridor meets a room, tinted safe / waiting / live): plan, tasks RE1-RE8, decisions RD1-RD9 |

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
- **Slower, longer sword (port retune).** `SWORD_DATA`'s swing recovery, finisher wind-up and finisher recovery are
  `SWORD_TEMPO_PERCENT` = 120% of the web build's (`WEB_SWORD_TIMINGS` 12 / 9 / 21 -> 14 / 11 / 25 ticks, rounded);
  the lunge keeps its distance over the longer wind-up. The knight's attack animations stretch over these timers, and
  the swing fan / blade visuals (`WEAPON_VIEW` swing / finisher show, blade sweep) are 20% longer too. Swing and
  finisher reach are `SWORD_REACH_PERCENT` = 115% of the web build's (1.7 / 2.2 -> 1.955 / 2.53; the guard keeps 1.9),
  so the fan and blade, drawn from the swing's radius, are 15% larger. Every golden fixture was recorded with the web
  sword, so the parity specs (golden runs, validate / segments, constants, the boss TTK table) replay under
  `setSwordTimings(WEB_SWORD_TIMINGS)` (timers and reach) and still match bit for bit; live play (every world) and
  live replays use the port's sword.
- **Archetype bands.** Kinds number by (`ArchetypeDef.band`, then id order), not id order alone. The web build's
  archetypes are band 0 (indices 0..6, pinned by hashed golden runs); a port-only archetype takes a NEW band so it
  numbers after the web table and no web index ever moves. The training dummy is band 1 (`PORT_BAND_TUTORIAL`),
  index 7 (`shared/sim/combat/actors/registry.ts`).
- **`enemy.dummy`.** The theme contract's `ENEMY_ARCHETYPES` gained `dummy` after the web build's six: every pack
  must fill `enemy.dummy` (asset and colour role) and `enemy.dummy.name` (placeholder: a post).
- **Decor and breakables in the theme (docs/DECOR.md R2, R13).** Two port slots. `decor.*` is optional (no
  placeholder kind; `decor.delve.b<n>.<kind>[.<v>]` with a lowercase kind segment, `decor.fx.<name>`,
  `decor.fx.ambient.b<n>`; free-size art with `layer` / `pivot` / `glow` / `emissive`), rebuilt from the plan since the
  web DECOR source was not at hand. `breakable.*` is required: every pack fills `breakable.barrel` / `breakable.crate`
  (asset, colour role, `.name`; placeholder: low boxes), `sfx.breakable.hit` / `sfx.breakable.break`, and the
  `decor.fx.*` colour roles, which the validator keeps >= 40 CIE76 Delta E from the enemy-bullet roles.
- **Tutorial (docs/TUTORIAL.md).** `SimConfig.tutorial` is an opt-in harmless mode (hits land but never cost hearts or
  armor, optional wounded start) with its own `tutorial` hash group appended after `party`; without it nothing
  changes and every fixture matches. The `tutorial` world is registered for the client's local build only: the server
  refuses it (`shared/run` `SERVER_REFUSED_WORLDS`) and it is never submitted or posted. "Has played the tutorial" is
  a per-player doc in DataStore `KV_Onboarding_v1` (`OnboardingService`, codec in `shared/onboarding`). Its floors are
  endless floors with fixed seeds (`tutorialForgeParams` = `endlessFloorParams` + seed / room count, world from
  `endlessFloorWorld`), so endless Forge options (solid pillars, `roomScale`) apply; a layout change fails its lock spec.
  Blocking is mandatory (TUTORIAL.md Decisions 9): `TutorialSimConfig.guardLock` holds combat D's bruiser at 1 hp until a
  sword guard erases a bullet (hashed fields appended to the `tutorial` group; tutorial replays changed, no fixture did).
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
  tutorial (no `breakables`, B7) play exactly as before, but the appended source widens every scored run's `score`
  hash group by `score.points.breakables` / `score.counts.breakables` (always 0 there), so the tutorial's and a
  `KV_Scoring` M1 run's state hashes differ from older builds (no fixture is scored); endless replays and scores
  changed. Mother Bramble's slam rule is nearly dormant: boss rooms get no pieces, so it only reaches one in a room
  that touches the boss room (1 of 240 boss floors, run seeds 1-60 x floors 5-20).
- **Enemy outlines (docs/OUTLINE.md).** Presentation only (no sim, hash or replay change). A new colour role
  `enemyOutline` (validated >= 3:1 on every biome floor and wall, CIE76 >= 40 from the enemy-bullet roles). Placeholder
  enemies and bosses sit under `KV_Actors/Enemies`, a Model with ONE `Highlight` (never one per actor: the engine
  draws at most 31); corpses move to `KV_Actors/Corpses`. Sprite enemies draw a baked `<sheet>-outline.png` (from
  `art/atlases.json` `outline`) in a second ImageLabel behind the frame. The skeleton's `pad` went 1 -> 3 (cells 98x74),
  so its atlases were re-uploaded with the two outline sheets (`assetIds.ts`).
- **Sprite effects and audio (docs/FX_AUDIO.md).** Source: the Ninja Adventure pack's FX and Audio folders (CC0),
  in gitignored `art/vendor/ninja-adventure/`. Theme port additions: sound assets take `variants` / `pitch` /
  `minInterval` (not on looped `music.*` / `amb.*`); `PORT_AUDIO_EVENTS` (the old `PORT_SFX` plus 13 new IDs) and
  `amb.b1`..`b5` are required (SILENT in the placeholder); an optional `fx.*` slot (one-facing sprites, `play`
  animation, `sizeTiles` <= 3, `tint` / `meanColor` >= 40 CIE76 from the enemy-bullet roles) and the `fx.heal` /
  `fx.curse` roles. `npm run audio:build` (`art/audio.json`, `art/audio.lock.json`) makes `art/build/audio/*.ogg` and
  `packs/vale/audioLayout.ts`; `art:build` also makes the `fx-effects.png` atlas and ambient flipbooks
  (`packs/vale/fxLayout.ts`). A vale sound turns on once every one of its files has an id; effects once the atlas has
  one. Effects are drawn flat on the floor (`FxSpriteController`), under markings and bullets; bullets keep their
  neon placeholders. `decor.fx.ambient.b<n>`: main's R5 mote (`decor-mote.png`) wins once uploaded; the Ninja
  Adventure flipbooks (`fx-ambient-b<n>.png`) only fill a biome it leaves empty. Presentation only: no sim, dungeon or
  hash change.
- **Co-op spectating (docs/SPECTATE.md).** Presentation only (no sim, lockstep, server, hash or replay change). A dead
  party member watches a living teammate and cycles with Attack / Alt; `SimController.getViewPlayerIndex()` replaces
  the local index in the camera, weapon view, bullet transparency, actor ring and audio, and `SnapshotExtras.vitalsIndex`
  drives the HUD's vitals (personal fields keep `playerIndex`). A dead client's co-op frames carry EMPTY_INPUT (debug
  bits kept under KV_Debug), which changes the hashed `prevButtons` of the dead player but cannot desync (every client
  steps the same merged log). Tunables `SPECTATE` in `shared/view/spectateConfig.ts`.
- **Boost drops (docs/BOOSTS.md).** `SimConfig.drops` (endless: `DROPS_CONFIG`; tutorial: `guaranteedDropsConfig`,
  a Fury on combat B's last kill) adds `state.drops` with its own `drops` hash group appended after `breakables`
  (last) and its OWN rng stream (`seed ^ DROPS.salt`), so no main-stream draw moves. Kills roll in `killActor`
  (never turrets, the dummy, the boss, or a boss floor's boss room); pickups are the first living player (index order)
  in range; Fury / Frenzy go through `playerHitDamage` / `attackTicks` (Frenzy as one integer percent with Swift
  Strikes), Quickstep scales the walk, Aegis is a pip in `state.drops` taken before armor. A port input bit
  `DEBUG_DROP_BUTTON` (32768, key M, KV_Debug only) joins `PORT_BUTTONS`. Theme: `boost.<kind>` (required, placeholder
  `"Diamond"`), `sfx.boost.*` in `PORT_AUDIO_EVENTS`. M1 and every fixture are unchanged; endless and tutorial
  replays changed.
- **Demon art (docs/DEMON_ART.md, docs/BRAMBLE_ART.md).** Presentation only (no sim, dungeon, hash, replay or
  fixture change). Source: the 2D Demons - TopDown asset pack v1.1 by SmallScaleInt (Standard Commercial License,
  `THIRD_PARTY_NOTICES.md`) in gitignored `art/vendor/demons-topdown/`.
  Pipeline: a grid source may list `source.layers` (sub-folders, bottom to top: `["Shadows", ""]` = the body over its
  shadow; `Effects/` is dropped, its swipes read as bullets), and a set may say `"cells": "perSheet"`: each sheet
  trims to its own animations and carries its own `frameW` / `frameH` / `pivot` (theme `SpriteSheetImage`, accepted in
  the actor slots only, `SlotContract.perSheetCells`; `SpriteView` re-places the billboard per sheet). The boss
  contract gained optional `attack.2` / `attack.3` / `attack.4` / `intro` / `taunt`; an actor attack in `shared/view`
  names its animation and plays segments of it (`ActorAttack.anim` / `segment` / `loop`, `ActorSpecial`, `flinch`),
  split at `SPRITE_ANIM_MARKS` (fractions of the frame count, measured on the art). Two sets: `enemy.bruiser` = Demon
  Beast 3 (the knight's density, 3 sheets + rims) and `boss.act1` = Demon Elite 3 (`bodyTiles` 2.5, 7 sheets + rims);
  both uploaded 2026-10-26 (ids in `assetIds.ts`), so the bundled vale pack draws them.
- **Room edges (docs/ROOM_EDGES.md).** Presentation only (no sim, hash, replay or fixture change). Three required theme
  colour roles `roomEdge.safe` / `.waiting` / `.live` (`ROOM_EDGE_ROLES`; waiting and live >= 3:1 on every biome floor,
  all three >= 40 CIE76 from the enemy-bullet roles and `telegraph`, `roomEdgeReport`). shared/sim score exports its
  room predicates as `scoreRoomEngaged` / `scoreRoomDown` (renamed, unchanged) so the view's unscored-M1 fallback
  judges rooms exactly as scoring does. `DisplaySettings.roomEdges` (default On, only Off stored; settings doc stays
  v2). `DashStyle.liftStuds` is optional (absent: every existing marking layer unchanged).

## Commands

```
npm run verify      # typecheck -> lint -> build -> headless tests. Run before you finish
npm test            # gen fixtures -> rbxtsc -> Lune runs every out/shared/**/*.spec
npm run test:only -- sim/rng   # rerun specs without rebuilding; args filter by source path
npm run build       # gen fixtures -> rbxtsc -> out/
npm run dev         # rbxtsc -w + rojo serve
npm run build:place # publishable place: build/kaleb-vale.rbxl from publish.project.json (no specs, fixtures or Jest)
npm run test:plugin # Studio test-runner plugin (same specs under real @rbxts/jest in Studio)
npm run art:build   # art/vendor -> art/build atlases + packs/vale/layout.ts / fxLayout.ts (art:lock rewrites art/vendor.lock.json)
npm run test:art    # node:test specs of the atlas pipeline (scripts/art/*.test.js; part of verify)
npm run audio:build # art/vendor/ninja-adventure/Audio -> art/build/audio/*.ogg + packs/vale/audioLayout.ts (audio:lock, audio:audition)
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
