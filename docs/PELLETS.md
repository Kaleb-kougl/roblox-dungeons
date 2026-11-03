# Pellets: plan

When a fight starts, **pellets** appear on the room's floor in Pac-Man lines: small squares (cubes) you collect by
walking over them while enemies are still alive. Each one pays a few points; collect **every** pellet before the last
enemy dies for a **Sweep** bonus. Once a room clears, any pellets left fade away. Rarely, a floor holds a **power
pellet**: grab it and every enemy bullet on the floor turns into points. Work it task by task, like `PLAN.md`; each task
ends with a **Verify**.

This is **gameplay** (it changes the score and what the player chases mid-fight), so it lives in the sim and the
dungeon and replays, validates and steps in lockstep like everything else.

Status (2026-11-02): **built headlessly** on branch `pellets` (from `main` @ `4f041f1`): PL0-PL7 and PL10-PL14 are
code-complete (PL8 short of its `art:build` confirmation and upload) and verified headlessly (full `npm run verify`: typecheck, lint, asset / autolocalize checks, art, l10n,
build; Lune 316 / 317 suites, 4408 / 4409 tests, the one failure the known base `forge.spec` seedToState NaN, which
also fails on `4f041f1`); see "As built". **Pending:** every Studio check (PL7, PL14), the vale art upload (PL8), the
vale sounds (`audio:build`, upload), the playtests PL9 / PL15, and four **owner calls** ("As built", "Open owner
calls").

Update (2026-11-03): `main` (now with the parked work: solid decor, room themes, 3D kits, credits) is merged into
`pellets`; `DAILY.ruleset` is 5 (main 3, this branch's earlier 4). Owner changes: the pellets are **yellow** (`#ffff00`,
both kinds; the boost colour bar lowered to 30, "As built" > Theme) and the chomp **climbs the major scale** as a room's
pellets are eaten (root to octave, the Sweep's sting after it; "As built" > View).

Owner answers (2026-11-02, Kaleb): pellets do **not** feed the combo (PD1); the
tension with the speed bonus is accepted (PD2); squares / cubes, not dots (PD3); the power pellet is **rare** (PD4).
Second round (2026-11-02, Kaleb): PD5-PD10 and PD12 accepted as recommended, PD11 flipped (each pellet shows a tiny
score pop), starting point values kept. Tutorial lesson (2026-11-02, Kaleb): a new combat room G after combat F
(PD13), with a sweep lock (PD14) and one sniper (PD15); the power pellet gets a first-sighting toast in real runs, not a
lesson (PD16). Every decision is settled.

## The idea in one paragraph

Where the pellets lie, and whether a floor has a power pellet, is decided **when the floor is built**: a pure function
of the floor seed in `shared/dungeon` (its own stream, like breakables, affixes, loot and the boss pick), stored on the
floor as `pellets`. The sim copies it into `state.pellets` at floor start. A room's pellets go **live** on the tick its
score record engages and are **gone** on the tick it clears, so "while enemies are present" is exactly the scoring
system's own idea of a fight (`scoreRoomEngaged` / `scoreRoomDown`). The sim draws **no rng**; every client, the
server's validation and a daily seed see the same pellets.

## What the code gives us (checked against `wip-2026-11-02` @ `795665a`)

| Fact | Where | Consequence |
|---|---|---|
| Each encounter room with members has a `RoomScore`: bounds, `engageTick` (latched in `stepScore` step 4 when a living player is inside or a member is hurt / aggroed / gone), `cleared`, `clearRoom` awarding ROOMS / PERFECT / FAST on the same tick. The entrance, treasure and boss rooms have none | `sim/score/score.ts` | Pellets hang off room records: enemy rooms only, live from engagement, gone at the clear. No pellets in boss rooms (PD9) |
| `award(state, s, source, base, scalePercent?)` runs every multiplier (combo, Depth, curses, optional floor scale percent) and writes `points` / `counts` / `events.points`. `scoreBreakable` and `scoreJackpot` are the "scores but never feeds the combo" precedent | `score.ts` | `scorePellet` / `scoreSweep` / `scorePowerBullets` in score.ts, same shape; no `feedCombo` (PD1) |
| Score sources are append-only (hash order); `JACKPOT` (9) exists only with `SimConfig.builds` (`addBuildScoreSources`). Every endless world (solo, party, daily, dev) sets `builds: BUILDS_CONFIG` | `scoreData.ts`, `run/endless.ts:201-212` | `PELLETS` (10) and `SWEEP` (11) appended after JACKPOT, created only with `SimConfig.pellets` (`addPelletScoreSources` pads JACKPOT too); every other scored run's `score` group is unchanged |
| Floor-built, sim-applied data: `placeBreakableLoot` (salt `0xe6546b64`) -> `EndlessFloorLayout` / `EndlessFloorWorld.breakableLoot` -> `dropsOnFloorPieces` at `createSimState` and after `resetBreakables` in `nextFloor` | `dungeon/breakableLoot.ts`, `dungeon/endless.ts`, `sim/drops/breakLoot.ts` | Same shape: `placePellets` -> `pellets` on layout and world -> `pelletsOnFloor` at the same two call sites. Placed LAST, reading walls, pieces and spawn tiles: nothing earlier moves |
| Salts in use: breakables `0x5bd1e995`, boss pick `0x27d4eb2f`, affixes `0xcc9e2d51`, roster `0x165667b1`, loot `0xe6546b64`, solid decor `0x7f4a7c15`, drops `0x4b564452`; floor seed mul `0x85ebca6b` | dungeon / sim data | Pellet salt `0x27220a95` (unused in `src/`; `0xc2b2ae35` is taken by the view's decor / fx hashes; PL0 re-checks) |
| Endless rooms are doubled (`roomScale` 2), with solid pillars, tombs / candle stands (`solidDecor`) and breakables on WALL / solid cells; `solidDecor` keeps each room's floor in one piece | `dungeon/endless.ts`, `forge/solidDecor.ts` | Pellets only on open FLOOR cells, not on a piece's cell or a spawn tile. Every placed pellet is reachable |
| Ground drops: 0.6-tile pickup radius, first living player in index order | `sim/drops/drops.ts` | Same pickup rule (radius 0.45 tiles, PD7) |
| Enemy bullets: `combat.enemyBullets.forEachActive(fn)` (sweepArc's walk); goo is `BulletKind.GOO` (no grazes, no guard points) | `combat/weapons/melee.ts`, `combat/bullets.ts` | The power pellet walks the pool the same way and skips goo (PD6) |
| Hash groups: the port's extras appended after `playerBullets`, `builds` documented as LAST | `sim/hashLayout.ts` | New group `pellets` appended after `builds` (only when `state.pellets` exists); the comment's "LAST" moves |
| Room clear view: `RoomClear` diffs per-source points; tally `TallyKind` kills / clear / perfect / fast, `ROOM_CLEAR_SEGMENTS` 4; killPoints = room points - bonus | `view/fx/roomClears.ts`, `roomClearSequence.ts` | Pellet points would show up as "Kills". The tally gains `pellets` (earned in the room) and `sweep` (a bonus that flies to the score panel) |

## Player experience

1. **The fight starts, the pellets appear.** On the engagement tick the room's pellets pop in as a quick wave
   out from the room's centre (0.4 s, presentation only: they are all collectable at once). Small square cubes in
   their own colour, flat under every bullet, no bob (bobbing reads as alive; it is not an enemy).
2. **Walk over them** (walk or roll) while you fight. Each one disappears with a tiny score pop (`+5`, smaller and
   shorter than a kill's) and a short "chomp" that climbs a note with every pellet of the room, from the root to the octave
   on the last one (`sfx.pellet.eat`, rate-limited).
3. **The last few glow.** With `PELLETS_VIEW.lastFewHint` (3) or fewer left in the room, the rest pulse brighter so you
   can find them in a doubled room.
4. **Sweep.** Collect every pellet before the last enemy dies: the room clear's tally shows `Pellets 120` and
   `Sweep +250` next to Clear / Perfect / Speed, and the clear jingle gets a short sting (`sfx.pellet.sweep`).
5. **Too slow.** When the last enemy dies, whatever is left shrinks away (0.3 s). No sound, no penalty.
6. **Power pellet (rare).** About one floor in three from floor 2 has one, in one fight. It is a bigger cube that pulses
   slowly. Grab it: a ring flashes out from you, every enemy bullet on the floor (the whole floor, not only what is on
   screen; goo and lightning strikes stay) becomes a little cube that flies into you, and each one pays points
   (`sfx.pellet.power`, solo 30 ms freeze like a parry). Then the fight goes on.
7. **Co-op.** One set of pellets per room, the first living teammate to touch a pellet takes it, and the points, the
   sweep and the score are the team's (the combo already is). Spectators see it all.

## Architecture

### 1. Dungeon: `shared/dungeon/pellets.ts` (pure)

**`pelletsData.ts`** (tunables, a leaf; starting values, PL9 tunes):

```ts
export const PELLETS = table.freeze({
	salt: 0x27220a95,          // pellet stream = floorSeed ^ salt
	spacingTiles: 2,           // one pellet every 2 tiles along a pattern (rooms are doubled)
	minPerRoom: 8,             // fewer usable cells than this: the room gets none
	maxPerRoom: 28,            // trimmed evenly along the pattern
	patterns: ["ring", "cross", "lanes", "zigzag"],  // one draw per room
	insetTiles: [2, 3],        // ring / lanes distance from the walls, one draw per room
	power: {
		fromFloor: 2,
		chancePercent: 33,       // per floor: one draw; "rare" (PD4)
		perFloor: 1,
	},
});
```

**`placePellets(floorSeed, floor, dungeon, encounter, pieces, roomSpawnTiles)`** -> `FloorPellets`:

- for each encounter room with spawns, in room id order: one pattern draw, one inset draw; walk the pattern across
  the room's floor rectangle on tile centres every `spacingTiles`; keep cells that are FLOOR, not a breakable's cell
  and not a spawn tile; fewer than `minPerRoom`: none; more than `maxPerRoom`: keep every k-th;
- then the power pellet: one draw against `chancePercent` (from `fromFloor`); on success one draw for the room (rooms
  that got pellets) and one for which of its pellets becomes the power pellet;
- fixed draws per case, own `EncounterRng`; nothing else on the floor reads this stream.

`FloorPellets = { tiles: TileXZ[], room: number[] /* encounter room id */, power: number /* index or -1 */ }`.
`EndlessFloorLayout.pellets` and `EndlessFloorWorld.pellets` carry it (optional: absent = none); the stage loader's
pre-generation builds it with the rest of the floor.

### 2. Sim

| Piece | Change |
|---|---|
| `SimConfig.pellets?: PelletsConfig` | Presence turns the feature on (`PELLETS_CONFIG`: `pickupRadius`, points). Endless worlds only (`buildEndlessRunConfig`; dev spreads it). M1, fixtures, the tutorial: absent |
| `state.pellets` (`sim/pellets/pellets.ts`) | Per floor: `x[]` / `z[]` (world), `rec[]` (index of the room's `RoomScore`), `taken[]` (0 / 1), `power` (index or -1); per room record: `first`, `count`, `left`, `phase` (0 dormant, 1 live, 2 gone), `swept`. Filled by `pelletsOnFloor(state, floorPellets)` from `createSimState` and from `nextFloor` after `resetBreakables` |
| `stepPellets(state)` | In `step()` as a new step between `stepDrops` (6) and `stepScore` (7), only with the config (a pickup on the clear tick counts for the sweep). For each living player in index order, the pellets of live rooms in the player's cell and its 8 neighbours (a cell -> index map; the radius is under half a tile), index order: within `pickupRadius` -> taken, `left -= 1`, `scorePellet`. The power pellet -> `pelletsPower` |
| `pelletsPower(state, player)` | Walks `combat.enemyBullets.forEachActive` (as sweepArc does), skips goo, erases each (`bulletsDeleted` as the guard does) and pays `scorePowerBullets(state, n)` (one award per bullet, capped at `powerMaxBullets`). Events record each position for the fly-in |
| Room hooks (from `stepScore`) | On a record's engagement: `phase = 1`. In `clearRoom`, before the other awards: `left === 0 && count > 0` -> `scoreSweep`; then `phase = 2`. A leaf helper (`pellets/pelletRooms.ts`, state types only) so score.ts never requires pellets.ts (PL0 checks the require graph) |
| Score | `ScoreSource.PELLETS` (10, pellets and power bullets) and `SWEEP` (11), names `pellets` / `sweep` in a `PELLET_SCORE_SOURCE_NAMES` list after `BUILD_SCORE_SOURCE_NAMES`; `addPelletScoreSources` (pads to 12, JACKPOT included). `PELLET_POINTS` 5 at the kills' floor scale (`floorScalePercent`), `SWEEP_POINTS` 250 flat (like `ROOM_CLEAR_POINTS`), `POWER_BULLET_POINTS` 5 flat. All through combo / Depth / curses; **none feeds the combo or refills its timer** (PD1) |
| Hash | New group `pellets`, appended after `builds`, only with `state.pellets`: per pellet `taken`, per record `left` / `phase` / `swept`, `power` (positions and room links are floor data, hashed as a count). `clonePelletsState`; names for the dump |
| Events (not hashed) | `eaten: { x, z, player, points }[]`, `live: number[]` / `gone: number[]` (records), `swept: number[]`, `power: { player, x[], z[] }` |

### 3. Worlds

| World | Pellets |
|---|---|
| M1, every fixture | none: unchanged |
| Tutorial | only in its pellet lesson room (combat G, floor 1; no power pellet): see "Tutorial lesson". Tutorial replays and its lock spec change |
| Endless solo / co-op, daily, dev | `PELLETS_CONFIG`: endless replays and scores change from floor 1. All-time boards stay `_v1` (PD10); `DAILY.ruleset` 3 -> 5 (4 on this branch before main merged) |

### 4. Client and theme (presentation only)

| Piece | Change |
|---|---|
| `PelletRenderController` (new, `client/controllers/render`, pooled, Janitor) | One view per pellet of a live room (pool of 64). Placeholder: a small axis-aligned `Block` Part (`PELLETS_VIEW.sizeTiles` 0.25; power 0.45), the `pellet` / `pellet.power` colour. With art: the vale cube sprite flat on the floor (FX floor placement, under every bullet). Pop-in wave, last-few pulse, shrink at the clear, power pellet's slow pulse. Reduced motion: no wave, no pulse (the last few just brighten), a fade instead of the shrink |
| Pellet pops | One tiny pop per pellet (`PELLETS_VIEW.pop`: about 60 % of a kill pop's text size, 0.4 s, a short rise) from `eaten`'s points, through the kill pops' pool; pellets taken by the same player on one frame merge into one pop (`+10`). Reduced motion: no rise, a fade |
| Power pellet fly-in | Erased bullets become cubes flying to the picker over 0.3 s (`ParticleController`), a ring from the picker; the solo 30 ms freeze through the hitstop clock (parry's) |
| `shared/view/pellets` | `PelletEvents` collected per tick like `BoostFrameEvents`; pure pop-in / pulse curves with specs |
| Room clear tally | `TallyKind` gains `pellets` (points earned in the room, shown like Kills) and `sweep` (a bonus: it flies with clear / perfect / fast). `RoomClear` gains `pelletPoints` / `sweepPoints`; killPoints subtracts the pellets. `ROOM_CLEAR_SEGMENTS` 4 -> 6; segments with 0 still hidden. PL7 checks the row fits the transient slot on the smallest phone (fallback: pellets fold into the first segment, renamed "Room") |
| Results screen | Two source rows `score.source.pellets` / `score.source.sweep` |
| Audio cue mapper | `sfx.pellet.eat` (climbing the room's ladder, `minInterval` 0.06 s, several on one frame play once), `sfx.pellet.sweep`, `sfx.pellet.power`: three port audio IDs in `PORT_AUDIO_EVENTS`, SILENT in the placeholder |
| Theme | Required: assets + colour roles `pellet` / `pellet.power` (`PELLET_ROLES`; placeholder kind `"Block"`); validator `pelletReport`: >= 3:1 on every biome floor, >= 40 CIE76 from the enemy-bullet roles, `telegraph`, every boost and build role and `playerOutline`. Strings: the two source names, `room.clear.pellets` / `.sweep`, with `l10n/context.json` entries. `contract.luau` / `validate.luau` sit near Luau's 200 top-level locals: array entries and function-scoped constants only (count on `out/`) |
| Vale art | Original, like the loot glint: `scripts/art/gen-pellet.js` draws a small pixel cube in 3/4 view (and a larger power cube with a highlight), run by `art:build` / `art:lock` into `art/vendor/kaleb-vale/pellets/`, its own sheet via `own` (no atlas repack) |
| Debug | `KV_PelletDebug` (Studio / KV_Debug): the room's left / count over each live room |

### 5. Server, lockstep, leaderboards

Nothing new: validation re-runs the same sim, co-op steps the same frames. Cost: per tick, 9 cells per living player
and one pass over the live rooms' records; a power pellet walks the enemy pool once. Re-run the replay bench.

## Tutorial lesson

A new lesson in the Practice Descent (docs/TUTORIAL.md): **combat G**, a room after combat F where one sniper fights
you over a ring of pellets, and the fight cannot end until you have taken every one. Every new player sees a Sweep
once, with its tally, before their first real run.

### What the code gives us (checked against `wip-2026-11-02` @ `795665a`)

| Fact | Where | Consequence |
|---|---|---|
| Floor 1 IS `TUTORIAL_ROOMS`: a Forge chain in tour order, entrance 0, combat A-F 1-6, treasure 7, shrine 8, boss / stairwell 9, a snake of three rows (F -> treasure -> shrine -> boss east); spawns are deferred to the first entry | `run/tutorial.ts` | Room G goes between F and the treasure room (id 7; treasure 8, shrine 9, stairwell 10). The third row gets one room longer. `TutorialLessonId` gains `combatG`; the layout lock spec is re-pinned |
| The guard lock: `TutorialSimConfig.guardLock { floor, room }` holds the room's spawned actors at `TUTORIAL_GUARD_HOLD_HP` (`tutorialHeldDamage`: the hit lands and flashes, only the hp stops) until a guard erases a bullet; hashed in the `tutorial` group | `sim/tutorial/tutorial.ts`, `tutorialData.ts` | The sweep lock is its twin: `pelletLock { floor, room }`, released when the room's last pellet is taken |
| Steps are data (`STEP_DEFS`): a lesson-room step has `lesson`, `prompt`, optional `holdPrompt` (shown while the sim holds the enemies), a `door` marker and a `clear` rule with `skills`; `guard` is a never-waived skill | `tutorial/steps.ts` | Step `pellets`: `clear` with a new never-waived skill `sweep`, `holdPrompt` `pelletsHold` |
| `map` (step 11) sits after `ember` with marker `next` (the next open lesson's door) | `steps.ts` | `pellets` goes right after `map`: the map prompt plays on the walk F -> G and its marker points at G's door, with no change to the map step |
| Funnel: `TUTORIAL_FUNNEL_REVISION` 2 (`t1r2`), 17 lessons, completed = 19, caps `maxEventsPerAttempt` 84 / `maxEventsPerSession` 252 (the `analyticsCatalog` budget spec) | `onboarding/config.ts` | One more lesson: revision 3 (`t1r3`), `relic` .. `finish` move 12..17 -> 13..18, completed = 20, caps re-measured by the budget spec (about 88 / 264) |
| First sightings: `SIGHTING_IDS` (archetypes and affixes), stored once per account in the onboarding doc's `seen` list, toast string `bestiary.<id>`, `SightingController` | `onboarding/sightings.ts`, `client/controllers/game/SightingController.ts` | The power pellet is one more sighting id, appended: `pellet.power` |

### Player experience

1. **After combat F** the map prompt plays as today; the marker leads to **combat G**'s door.
2. **Walk in**: the sniper appears at the far side and the room's pellet ring pops in. Prompt: *"Grab the pellets while
   enemies are alive. Get them all for a Sweep!"*
3. **Fight and collect.** Sniper shots push you to move and roll (combat C's lesson, reused). Hits are harmless, as
   everywhere in the tutorial. You can shoot the sniper whenever you like.
4. **The lock.** While pellets remain, the sniper stops at 1 hp (it flashes, it does not fall), and the prompt becomes
   *"Grab the last pellets to finish the fight."* The last pellets pulse (the last-few hint).
5. **Last pellet taken**: the lock releases; finish the sniper; the room clear shows `Pellets` and `Sweep +250` in the
   tally. On to the treasure room.

Prompt texts are drafts (device variants: the same words; touch keeps them short for the top prompt bar).

### Changes

| Piece | Change |
|---|---|
| `TUTORIAL_ROOMS` (`run/tutorial.ts`) | `{ lesson: "combatG", roomId: 7, roomType: "combat", w: 9, h: 9, shape: "rect", next: "e", kinds: [SNIPER_KIND], placement: "far", pellets: "ring" }` after combat F; treasure / shrine / stairwell renumber. `TutorialRoomPlan.pellets?` (a pattern name). `TutorialLessonId` gains `combatG` |
| Tutorial pellets | Not `placePellets`: `tutorialPellets(layout)` lays room G's pattern with the same pattern walker (`pelletPatternCells`, shared with `placePellets`), capped at `TUTORIAL.pellets.max` (12: a short lesson), no power pellet; floor 1's world carries them, floor 2 none. `buildTutorialRunConfig` sets `pellets: PELLETS_CONFIG` |
| Sweep lock (sim) | `TutorialSimConfig.pelletLock?: { floor, room }` (`TUTORIAL_PELLET_LOCK`, room 7): actors spawned in that room (`tutorialOnRoomSpawned`) are held at the hold hp (`tutorialHeldDamage`, shared with the guard lock) while any of the room's pellets is untaken; `stepPellets` releases it on the last pickup (`tutorialOnPelletsSwept`). Phase / floor / room appended to the `tutorial` hash group. `isTutorialPelletHolding(state)` for the script |
| Script (`tutorial/steps.ts`) | Step `pellets` after `map`: `{ id: "pellets", floor: 1, lesson: "combatG", prompt: "pellets", holdPrompt: "pelletsHold", marker: { kind: "door", lesson: "combatG" }, rule: { kind: "clear", skills: ["sweep"] } }`. New `TutorialSkill` `sweep`: the score's SWEEP count rose since the room was entered, or the pellet lock released; never waived (the lock makes it unavoidable). No highlight (the tally shows the result) |
| Director | `holdPrompt` while `isTutorialPelletHolding`, like `isTutorialGuardHolding`; `sweep` judged in the skills switch |
| Funnel | `TUTORIAL_FUNNEL_REVISION` 3; numbering comment in steps.ts; completed step and caps from the budget spec |
| Strings | `tutorial.prompt.pellets.<device>`, `tutorial.prompt.pelletsHold.<device>` (keyboard / gamepad / touch), with `l10n/context.json` entries |
| Test bot | Bot option `pellets` in `run/testing/tutorialBot.ts`: walks room G's pellets in index order, then fights |
| Power pellet sighting | `pellet.power` appended to `SIGHTING_IDS`; string `bestiary.pellet.power` (*"Power pellet! Grab it to turn every enemy bullet into points."*); `SightingController` fires on the first frame a live power pellet is on screen in a real run. Onboarding doc stays v1 |

The tutorial is local-only (`SERVER_REFUSED_WORLDS`), so the lock and the new room touch no server path.

## Tasks

- [x] **PL0. Confirm the assumptions.** Every row of "What the code gives us"; the require graph (score.ts -> the leaf
  helper only); the salt is unused; a census print of usable pellets per room by pattern at `roomScale` 2 (runs 1-10,
  floors 1-20) and how many rooms fall under `minPerRoom`. Edit `PELLETS` if needed. -> Verify: each row confirmed or
  this plan edited.
- [x] **PL1. Dungeon.** `pelletsData.ts`, `placePellets`, `pellets` on `EndlessFloorLayout` / `EndlessFloorWorld`,
  barrel. -> Verify: `pellets.spec.ts` (shared/dungeon): pure, fixed draws, only FLOOR cells, never a piece or spawn
  cell, every pellet reachable from the room's spawns, `maxPerRoom`, power rate near `chancePercent` from floor 2 and
  never before; `endless.spec` digests, pieces, spawns, affixes, loot and boss picks unchanged; `roomPool.lock.spec`
  unchanged.
- [x] **PL2. Sim state, score sources and hash.** `SimConfig.pellets`, `state.pellets`, `pelletsOnFloor` at both call
  sites, `addPelletScoreSources`, the `pellets` group, clone, names. -> Verify: `npm run verify` with every golden
  fixture, the M1 hash, the tutorial lock spec and every endless replay unchanged (nothing sets it yet); clone / hash
  specs; the non-pellet runs' `score` groups unchanged.
- [x] **PL3. Live, pickup, gone, sweep.** `stepPellets`, the room hooks, `scorePellet` / `scoreSweep`. -> Verify:
  `pellets.spec.ts` (shared/sim): dormant before engagement (walking over does nothing), live on the engagement tick,
  pickup radius edges, a roll collects, a dead player does not, co-op first living player in index order, a pickup on
  the clear tick counts for the sweep, gone at the clear (no pickup after), sweep only with every pellet taken, the
  combo and its timer untouched by every pellet award, floor change resets, `state.rngState` untouched, a recorded
  replay matches.
- [x] **PL4. Power pellet.** `pelletsPower`, `scorePowerBullets`. -> Verify: every non-goo enemy bullet erased and paid
  once, goo left alone, the cap, an empty pool pays nothing, segmented validation of a run that takes one.
- [x] **PL5. Worlds.** `PELLETS_CONFIG` in `buildEndlessRunConfig`; `DAILY.ruleset` 3 -> 4. -> Verify: endless / party
  / partyProgression / dev specs replay and validate segmented; a census bot (extend `run/dropsCensus.spec.ts` or a new
  `pelletsCensus.spec.ts`): pellets per room, share taken, sweep rate, power pellets per floor, pellet + sweep share of
  the floor's score, speed bonus lost vs a run that ignores pellets; replay bench within budget.
- [x] **PL6. Theme.** Roles, assets (placeholder `Block`), strings + l10n context, three port audio IDs,
  `pelletReport`. -> Verify: contract / validator / audio specs, `l10n:check`, the Luau locals count.
- [x] **PL7. View.** (code-complete; Studio check pending) `PelletRenderController`, the fly-in, `shared/view/pellets`,
  the tally's two segments, results rows, pellet pops, cues, `KV_PelletDebug`. -> Verify: headless specs for the pure
  parts and the tally (six segments, zeros hidden, the sweep in the flying bonus exactly once, footprint on the
  smallest phone); Studio: pellets read as squares on every
  biome, never over a bullet, pop in on engagement, shrink at the clear, the power fly-in, two players see the same.
- [ ] **PL8. Vale art.** (generator, test, `own` sheets and layout built; the first real `art:build` / `art:lock`
  confirming them byte for byte, and the upload, pending) `gen-pellet.js`, its test, `art/atlases.json` `own` sheet,
  upload, id. -> Verify: `test:art`, `art:build` byte-identical, the vale validator.
- [ ] **PL9. Playtest and tune.** Solo and co-op, PC and phone: do players chase pellets mid-fight, is a sweep
  reachable without throwing the speed bonus away every time, is the power pellet noticed, do pellets ever get mistaken
  for bullets. Tune `PELLETS` and the points.
- [x] **PL11. Tutorial room G.** `TUTORIAL_ROOMS` entry, `combatG`, `tutorialPellets`, `pellets` in the tutorial run
  config. -> Verify: the layout lock spec re-pinned (room G 7, treasure 8, shrine 9, stairwell 10; the snake still
  fits), room G's pellets on floor cells only and reachable, none elsewhere on floors 1-2, the guard lock still on
  combat D (room 4; `TUTORIAL_GUARD_ROOM` is derived from the lesson, so it follows by itself).
- [x] **PL12. Sweep lock.** `pelletLock`, `TUTORIAL_PELLET_LOCK`, the shared hold, release, hash fields,
  `isTutorialPelletHolding`. -> Verify: `sim/tutorial` specs: held while pellets remain (sword, arrows, a heavy arrow),
  released on the last pickup (also when the last pickup and the kill land on one tick), no lock without the config,
  guard lock unchanged, a recorded tutorial replay matches.
- [x] **PL13. Script, strings, funnel.** Step `pellets`, skill `sweep`, `holdPrompt`, strings + context, revision 3,
  caps. -> Verify: `tutorial.spec` / `flow.spec` / `guide.spec`, the onboarding funnel and `analyticsCatalog` budget
  specs, `l10n:check`; the full-run bot (option `pellets`) finishes the tutorial; the map step's `next` marker now
  points at G's door.
- [x] **PL14. Power pellet first sighting.** (code-complete; Studio check pending) `pellet.power`,
  `bestiary.pellet.power`, the SightingController trigger. -> Verify: sightings spec (canonical order, string list
  equal), Studio: the toast once per account.
- [ ] **PL15. Tutorial playtest** (with PL9). New players: is the lock read as "grab the pellets" rather than "the
  game is broken", how long room G takes, funnel drop at step 12. Tune `TUTORIAL.pellets.max` and the prompts.
- [x] **PL10. Docs.** `CLAUDE.md` decision log line and docs-table row (`docs/PELLETS.md`, this plan moved into the
  repo), `src/shared/sim/README.md` (step order, hash group), docs/ROOM_CLEAR.md (tally), docs/CLIENT.md (debug
  attribute), docs/TUTORIAL.md (room G, the sweep lock), docs/TUTORIAL_FUNNEL.md (revision 3). -> Verify: `npm run
  verify`.

Critical path: PL0 -> PL1 -> PL2 -> PL3 -> PL5. PL4 after PL3; PL6 any time after PL0; PL7 after PL3 and PL6; PL8
after PL6. PL11 after PL1; PL12 after PL3; PL13 after PL12 and PL6; PL14 after PL4 and PL7; PL15 with PL9.

## As built (2026-11-02)

Branch `pellets` from `main` @ `4f041f1` (New enemies merged; the parked `wip-2026-11-02` work is not). Built by
sub-branches `pl-sim-core` (PL0-PL2), `pl-theme` (PL6, PL8, every string), `pl-sim-behaviour` (PL3-PL5), `pl-view`
(PL7, PL14), `pl-tutorial` (PL11-PL13), `pl-viewfix` (the power pellet vs the guard cues, integration specs) and
`pl-docs` (two review fixes, PL10). An independent read-only review found no serious defects. The plan's "What the
code gives us" rows were read on `wip-2026-11-02`; `main` has no solid decor (tombs / candle stands), so on this branch
pellets only keep off WALL (pillars included), pieces and spawn cells.

### Open owner calls

1. **Balance (PL9).** As tuned, chasing pellets costs score: the census bot that chases them ends **-13.6 %** on rooms'
   points (111 491 vs 128 980), because it loses 58.3 % of the speed bonus. PD2 accepted the tension, not a net loss.
   Levers: `SWEEP_POINTS` / `PELLET_POINTS`, `maxPerRoom`, or par time while pellets remain (PD2's alternative).
2. **The room clear tally on the smallest phone.** Six segments do not fit the 360 ref-px slot there: the row folds
   pellets into the first segment (`roomClearFoldPellets`, below). Folded it is still smaller than today's four-segment
   row (6.0 vs 7.3 px). Two rows or a wider slot?
3. **The run-over breakdown on phones.** menu `fit.spec`'s `SCORE_LINES` = 11 is already stale; with the Jackpot /
   Pellets / Sweep rows a run can show 14 lines, at which three fit tests would fail. A layout decision (scroll,
   two columns, or fold the rare rows).
4. **Vale sounds and the upload.** `sfx.pellet.eat` / `.sweep` / `.power` are SILENT in both packs (clips need
   `audio:build`, not run here); `pellet.png` / `pellet-power.png` wait for the first real `art:build` / `art:lock`
   and the upload.

### Dungeon (PL0, PL1)

- `placePellets(input: BreakableFloorInput, floor, pieces)` in `shared/dungeon/pellets.ts`, the pattern walker
  `pelletPatternCells(d, room, pattern, insetTiles, maxCount, usable?)` (shared with the tutorial), `pelletPatternPath`,
  `roomGridRect`, `reachableFloor`. Salt `0x27220a95` (unused elsewhere).
- **Deviation:** one inset and spacing for every pattern did not work (the cross fell under `minPerRoom` in 28 % of the
  rooms, 45 % at inset 3 where pillars sit on the centre lines; the zigzag in 62 %). `PELLETS.patterns` is a list of
  `PelletPatternDef { pattern, insetTiles, spacingTiles }`: ring [2, 3] / 2, cross [1, 2] / 2, lanes [2, 3] / 2,
  zigzag [1, 3] / 1, plus `laneGapTiles` 4. No `perFloor` (one `power` index).
- "Not a spawn tile" means the planned spawn cells (`roomSpawns`): `roomSpawnTiles` covers nearly every room cell. A
  reachability filter (BFS over FLOOR round the breakables from the entrance) keeps every pellet reachable.
- Census (runs 1-10 x floors 1-20, after tuning):

  | Pattern | Pellets avg (min-max) | Under minPerRoom | Trimmed to 28 |
  |---|---|---|---|
  | ring | 24.5 (12-62) | 0 % | 20 % |
  | cross | 11.3 (4-33) | 7.4 % | 0.7 % |
  | lanes | 31.6 (14-136) | 0 % | 39 % |
  | zigzag | 14.0 (6-35) | 1.7 % | 2.3 % |

  1754 of 1794 enemy rooms get pellets (2.2 % under `minPerRoom`), about 159 pellets a floor, 18 a room. A power pellet
  on 57 of 190 floors from floor 2 (31.7 % over 1000 streams, target 33 %).

### Sim (PL2-PL5)

- Points live in the config (`PELLETS_CONFIG` from `sim/pellets/pelletsData.ts`): `pelletPoints` 5 (x the kills' floor
  scale), `sweepPoints` 250, `powerBulletPoints` 5, `powerMaxBullets` 100 (chosen: the plan gave no number);
  `pickupRadius` 0.45 tiles. `PelletsConfig.floor` gives specs without endless their pellets.
- State: per score record also `span` (its pellet range, the power pellet included); `count` / `left` are regular
  pellets only (PD8). A pellet whose room has no record gets `NO_PELLET_RECORD` and never goes live.
- Hash `pellets` group (LAST, after `builds`): the count, `taken[]`, `power`, the record count, per record `left` /
  `phase` / `swept`. Positions, links and ranges are floor data (hashed as the count).
- Events (not hashed): `eaten { index, x, z, player, points }[]`, `live` / `gone` / `swept` (record indices),
  `power { player, x[], z[], points }`.
- `pelletsOnFloor` in `createSimState` after the score and builds states, and in `nextFloor` after
  `rebuildScoreRooms`. `stepPellets` (with `pelletsPower`) runs between `stepDrops` and `stepScore` in `step` and
  `stepParty`; the leaf `pelletRooms.ts` (`pelletRoomLive`, `pelletRoomClear`) is called from `stepScore`.
  `PelletPhase` moved to `pelletsData.ts`.
- **The power pellet** pushes no `eaten` event and pays no pellet points: only `events.power` and `taken = 1`. It
  erases every active enemy bullet on the **whole floor** but goo and lightning strikes (delayed, unfired bullets
  skipped like `sweepArc`), adds them to `events.bulletsDeleted`, and pays `powerBulletPoints` each up to
  `powerMaxBullets`.
- **Live timing:** endless records engage in `attachScoreRoomMembers` (stepEndless), so the pellets go LIVE in
  stepScore at the end of the entry tick; a pellet under the player then is taken on the next tick. A room that engages
  and clears on one tick emits live, then gone.
- Worlds: `pellets: PELLETS_CONFIG` in both branches of `buildEndlessRunConfig` (daily and dev follow), and the
  tutorial's run config (only room G has pellets). `DAILY.ruleset` 3 -> 4; boards stay `_v1`. Hash-layout pins updated
  in the endless / affixes / dev / partyProgression / builds / breakables / progression specs.
- Census (`run/pelletsCensus.spec.ts`, seeds 1337 / 4242 / 90210, floors 1-4; the chasing bot spares a room's last
  enemy up to 30 s until its pellets are done):

  | | Chasing | Ignoring |
  |---|---|---|
  | Pellets per room | 20.2 | 20.2 |
  | Taken | 76.6 % | 7.1 % |
  | Sweeps | 39 / 75 cleared rooms (52 %) | 0 |
  | Pellet + Sweep points | 8552 + 12500 | 809 + 0 |
  | Share of rooms' points | 18.9 % (14.8 % with floor clears) | 0.6 % |
  | Speed bonus (FAST) | 21 401 | 51 322 |
  | Rooms' points | 111 491 (-13.6 %) | 128 980 |

  Power pellets: 0.25 a floor (27.8 % of floors 2+); the census bot erased 0 bullets with them (it grabs them before
  anything is fired), the validated segmented run erased 3. Replay bench within noise (an 8-player floor maybe
  +3-5 %), far under budget.

### Theme and art (PL6, PL8)

- Ids `pellet.normal` / `pellet.power` (asset and colour role: the validator needs two segments), slot `PELLET`,
  exports `PELLET_KINDS`, `pelletId`, `isPelletId`, `PELLET_IDS`, `PELLET_ROLES`, `PELLET_AUDIO_IDS`,
  `PELLET_COLOR_RULES`, `pelletReport` and the generic `floorAndDifferenceReport` (pulled out of `buildColors.ts`).
  Colours (owner, 2026-11-03): Pac-Man yellow `#ffff00` for both kinds (the power pellet reads by size, pulse and glow).
  Yellow sits between the boosts' gold and lime, so the rule was split: >= 40 CIE76 from the enemy bullet (82), its
  outline, the telegraph (76), every build effect colour (nearest build.ember 63) and the player outline
  (`PELLET_COLOR_RULES`), >= 30 from every boost (`PELLET_BOOST_COLOR_RULES`, `MIN_PELLET_BOOST_DIFFERENCE`; nearest
  frenzy 34.4, fury 38.7): a boost is a coin or gem with a halo and beam, a pellet a cube, and mixing them up costs
  nothing. Floor contrast >= 13.6:1. (Before: green `#00c868` / `#00ff80`, the only hue clearing 40 from every role.) Placeholder `Block` cubes 0.25 / 0.45 tile. The core preload tier includes `pellet.`.
- Strings: `score.source.pellets` "Pellets" / `score.source.sweep` "Sweeps"; tally `room.clear.line.pellets`
  "Pellets {points}" / `room.clear.line.sweep` "Sweep +{points}"; `bestiary.pellet.power` "Power pellet: grab it to
  turn every enemy bullet into points" (the bestiary's "Name: tip" format); the tutorial prompts below. Audio
  `sfx.pellet.eat` / `.sweep` / `.power`, SILENT in both packs.
- Vale art: `scripts/art/gen-pellet.js` (+ test) draws two own PNGs, `pellet.png` 11 x 11 and `pellet-power.png`
  17 x 17 (different sizes cannot share one sheet), 29.6 px per tile, centred pivot, greyscale tinted by the role. The
  layout entries and lock hashes were written with the pipeline's own functions; the first real `art:build` /
  `art:lock` must confirm them byte for byte.
- `contract.luau` 185 -> 186 top-level locals; `validate.luau` unchanged at 196.

### View (PL7, PL14)

- `PelletFrameEvents` (not `PelletEvents`: the sim has that type), `PelletViewTracker`, `PELLETS_VIEW`,
  `RunView.pellets` in LiveRun and LockstepClient; `ThemeCore.pellet` / `ThemePack.pellet` (types `PelletTheme` /
  `Pellet`), no contract change.
- `PelletRenderController`: a pool of 64, one BulkMoveTo per frame, a still pellet is not re-placed (only a new or
  rescaled one), art flat at 0.03 studs (over floor effects, under markings and bullets), `KV_PelletDebug`.
- Pops: a third layer in `ScorePopController`, 0.6 of a kill pop, 0.4 s, merged per player per frame; the power
  pellet's points join its picker's pop (the plan did not say).
- Audio: `sfx.pellet.eat` climbs (owner, 2026-11-03): the k-th of a room's n regular pellets plays
  `PELLETS_VIEW.audio.ladderSemitones` [0, 2, 4, 5, 7, 9, 11, 12] at floor((k - 1) / (n - 1) x 7) (`pelletEatSpeed`,
  from the room's progress after the frame: `pelletRoomProgress`), so the major scale rises from the root to the octave
  on the pellet that earns the Sweep, and a teammate's pellets climb the shared room's ladder too. Once per frame,
  `minInterval` 0.06 s, quieter for teammates. (Before: two alternating speeds 1 / 1.122.) Until the vale clips are
  uploaded the three pellet sounds fall back (`SFX_FALLBACK`): the chomp to the room tally's `sfx.score.tick` (the
  ladder's speed carries over), the Sweep to `sfx.combo.tier`, the power pellet to `sfx.player.parry`.
- Vale clips (owner, 2026-11-03): `sfx.pellet.eat` = "Chomp" by Barnaby (cryptologymedia, Pixabay 155392), trimmed
  [0.12, 0.38] to its first bite (0.25 s built); `sfx.pellet.sweep` = "Swish swoosh woosh SFX 27" by Stereogenic Studio
  (Pixabay 357164), trimmed [0, 1.2] (1.147 s built); raw files in gitignored `art/vendor/pixabay/`, credited in
  THIRD_PARTY_NOTICES.md and on the Credits screen. The owner uploaded the raw MP3s (untrimmed, not normalised: the
  chomp's raw peak is -17 dBFS, so it plays quieter and 0.12 s late, both bites); uploading the built OGGs from
  `art/upload/` and pasting their IDs fixes that. `sfx.pellet.power` = "Power up 01a" by EdR (Pixabay 484722), used whole (0.413 s built; raw peak -15.6 dBFS), uploaded
  the same way.
- The power pellet's erases are no deflect: they are taken out of `bulletsDeleted` for the deflect cue, the guard
  effect (`FxCueFrame.pellets`) and WeaponViewController's guard fan flash (`deflectedBullets` /
  `tickDeflectedBullets` in `view/pellets/events.ts`, imported by file against a require cycle).
- Tracker: a room clearing inside its pop-in wave shrinks from each pellet's reached size; a tick going back (the dev
  restart) resets it.
- Room clear: `TallyKind` `pellets` / `sweep`, `RoomClear.pelletPoints` / `sweepPoints`, `ROOM_CLEAR_SEGMENTS` 6, the
  Sweep in `roomClearBonus`. A clear's `pelletPoints` are the points of its OWN room's pellets (the sim's `eaten`
  events give the pellet index, `rec[index]` its record; the power pellet's points go to its own room), so another
  room live at the same time keeps its pellets; kill points = room points - own pellets - bonus (review fix).
- **The fold:** when a row's estimated text size (`ROOM_CLEAR_VIEW.tallyFit`: glyph aspect 0.62, provisional until
  Studio measures TextBounds) falls under `minText` 10 ref px, `roomClearFoldPellets` folds the pellets into the
  first segment (it keeps the "Kills" label: "Room" would need a string). Smallest phone (HUD 0.73): today's four
  segments 7.3 px; six segments 5.0; folded 6.0; Kills / Pellets / Clear / Sweep 7.4 (owner call 2).
- Results: Jackpot / Pellets / Sweep rows only when they scored (owner call 3).
- PL14: `sightingsInView` adds `pellet.power` while the power pellet lies untaken in a live room within
  `SIGHTING_VIEW.radius`; SightingController already skips the tutorial.
- Integration spec `src/shared/play/pelletsView.spec.ts`: a solo LiveRun dev world and a 2-player LockstepClient party
  against the real sim (sweep, power pellet, two rooms live at once, two players on one tick, a merged pop).

### Tutorial (PL11-PL13)

- Room G = room 7 (9 x 9 rect before the room scale, one sniper, `far`, a `ring`); treasure / shrine / stairwell
  8 / 9 / 10. `TUTORIAL_PELLET_LESSON` / `_ROOM` / `_LOCK`; `tutorialPellets(d, rooms, roomSpawns)` with
  `TUTORIAL.pellets` { insetTiles 2, max 12 }; tutorial layouts never call `placePellets`.
- **Floor-1 seed 7500 -> 7574:** with the longer chain, 7500 left lesson E's turret without cover; 7574 is still frost
  with its lakes in combat D / F. Lock digest `fc231be9`, tour 225 tiles.
- Sweep lock: five hashed fields appended to the `tutorial` group (`pelletLockFloor`, `pelletLockRoom`, `pelletLock`,
  `pelletLockFirstId`, `pelletLockEndId`); the hold reuses `TUTORIAL_GUARD_HOLD_HP`; released at once when the room
  spawned nothing or has no pellet; `isTutorialPelletHolding` / `isTutorialPelletReleased`. On the last-pickup tick a
  lethal hit still stops at 1 hp (the release lands in stepPellets, after combat).
- Step `pellets` at 12 (`relic` .. `finish` 13..18); the director shows a hold prompt only for the step's own lock.
  Prompts "Grab the pellets while enemies are alive. Get them all for a Sweep!" / hold "Grab the last pellets to finish
  the fight." (every device). `TUTORIAL_FUNNEL_REVISION` 3 (`t1r3`), attempt `completed` 20, onboarding `Completed`
  22, caps 88 / 264. Bot option `pellets: "first" | "late"`. `roomEdgeState.spec` lesson count 6 -> 7.
- Timing (bot): 82.6 s of sim, about 13 s longer; room G about 11 s (12 pellets in 9.4 s, the sniper 1.7 s); `late`
  about 15 s.

### Verification

Full `npm run verify` on the merged branch: typecheck, lint, asset / autolocalize checks, art (90), checks, l10n, build
pass; Lune 316 / 317 suites, 4408 / 4409 tests. The one failure is the known base failure `dungeon/forge/forge.spec`
"EncounterRng ... seedToState vectors" (a NaN sign bit under Lune), which also fails on `4f041f1`. M1, every golden
fixture and every replay without `SimConfig.pellets` replay exactly as before; endless and tutorial replays and scores
changed.

## Edge cases

- **Deferred rooms** (members spawn later, `attachScoreRoomMembers`): a record with no members yet never engages, so
  its pellets stay dormant until it does.
- **Adopted members** (slimelets, `adoptScoreRoomMember`) keep the room open, so the pellets stay live until they die
  too.
- **Two rooms engaged at once**: both sets are live; each sweep is judged per room.
- **A room cleared without being entered** (a bow kill from a corridor): it engaged when the member was hurt, so its
  pellets were live, briefly; no sweep unless the room had none (then no sweep either: `count > 0`).
- **Floor change mid-fight** (the stairwell is reachable): the floor's pellets go with it.
- **Power pellet with a full screen**: capped at `powerMaxBullets` paid; every bullet is still erased.
- **Dev mode** (`startFloor` n) gets floor n's pellets exactly.

## Decisions

All settled by the owner (2026-11-02, Kaleb): PD1-PD4 in the first round, PD5-PD12 in the second. Each line is the
choice, then the alternative.

- **PD1. Pellets never feed the combo** (owner) [PL3]. They are multiplied by it, nothing more; a pellet trail cannot
  hold a streak with no fighting. Alternative: +0.1 per pellet like a graze.
- **PD2. Sweep vs speed is a real choice** (owner) [PL5, PL9]. Par times unchanged. Alternative: pause the par clock
  while pellets remain.
- **PD3. Squares / cubes** (owner) [PL6-PL8]. Distinct from every round bullet. Alternative: dots.
- **PD4. The power pellet is rare** (owner) [PL1]: about one floor in three from floor 2, at most one per floor.
  Alternative: one per elite room.
- **PD5. Floor-built placement** [PL1]. Deterministic per floor seed, no sim rng, fair on daily boards. Alternative:
  placement at engagement from the sim stream (reacts to where the player entered, but moves every later draw).
- **PD6. Power pellet = convert, no "frightened" enemies** [PL4]. Every non-goo enemy bullet on the floor (not only on
  screen) becomes points at once (a shmup bomb with a Pac-Man coat). Goo stays: it is terrain, and the guard pays nothing for it either.
  Alternative: enemies also hold fire for 3 s (a hook in every archetype's firing; bigger change).
- **PD7. Pickup radius 0.45 tiles** [PL3]. Under half a tile, so a pass through a line takes the pellets on it and the
  cell lookup stays 3 x 3. Alternative: drops' 0.6.
- **PD8. The power pellet is not needed for a sweep** [PL3]. You choose when to fire it; leaving it does not cost the
  bonus. Alternative: it counts like any pellet.
- **PD9. Enemy rooms only; no pellets in boss rooms** [PL1]. Boss rooms have no room record and their own score
  (no-hit bonus). Alternative: a ring of pellets per boss phase.
- **PD10. Leaderboards stay `_v1`** [PL5], as for Builds, Enemy variants and breakable loot; `DAILY.ruleset` 3 -> 5 (with main merged).
- **PD11. A tiny score pop per pellet, plus the chomp sound** (owner, flipped from the recommendation) [PL7]. Pops
  on one frame merge. Alternative turned down: the chomp alone.
- **PD12. Pellets are not on the minimap** [PL7]. Alternative: dots on the full map only.
- **PD13. The lesson is a new room, combat G, after combat F** (owner) [PL11]. One lesson per room like the rest; the
  map prompt plays on the walk to it. Costs about 30-45 s and a layout re-pin. Alternatives: pellets in combat E or C
  (two lessons in one room).
- **PD14. A sweep lock** (owner) [PL12]: the room's enemies stay at 1 hp until every pellet is taken, like the guard
  lesson, so every new player sees a Sweep. Alternative: take one pellet, with a callout if pellets are lost.
- **PD15. One sniper** (owner) [PL11]: aimed shots at range, so collecting happens under light fire and reuses the roll.
  Alternatives: one bruiser, two swarmers.
- **PD16. No power pellet in the tutorial; a first-sighting toast in real runs** (owner) [PL14]. Alternatives: a power
  pellet in room G, or nothing.

## Risks

- **Readability**: more small objects among bullets. The square shape, its own validated colour, no bob, floor
  placement under bullets. PL7 / PL9 check every biome.
- **Pellet pops over bullets**: kill pops are `AlwaysOnTop` billboards, so a stream of pellet pops could cover
  bullets. Kept tiny, short and merged per frame; PL9 checks it in a dense room (fallback: pellet pops only while no
  enemy bullet is within a tile, like the floor shout's ducking).
- **Pellets outscore fighting**: the census (PL5) sets a target for pellets + sweep (about 10-20 % of a room's points)
  and PL9 tunes the points.
- **Kiting gets stronger for the bow**: bow players move more and will sweep more often. Watch it in PL9; a sword
  player still crosses the room.
- **The tally row on phones**: six segments may not fit; the fallback is in the view table.
- **The tutorial lock reads as a bug**: a sniper that will not die. The hold prompt, the hit flash and the last-few
  pulse carry it; PL15 watches for players stuck in room G (the `stuck` telemetry). It also makes floor 1 about
  30-45 s longer.
- **Luau locals** in `contract.luau` / `validate.luau`: function-scoped additions only.

## Out of scope

- Pellets in M1, in boss rooms, or in any tutorial room but combat G; the power pellet in the tutorial (PD16).
- Fruit / bonus items, ghosts, pellets that respawn, pellet streak multipliers.
- Pellets on the minimap (PD12).
