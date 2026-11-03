# Pellets: plan

When a fight starts, **pellets** appear on the room's floor in Pac-Man lines: small squares (cubes) you collect by
walking over them while enemies are still alive. Each one pays a few points; collect **every** pellet before the last
enemy dies for a **Sweep** bonus. Once a room clears, any pellets left fade away. Rarely, a floor holds a **power
pellet**: grab it and every enemy bullet on screen turns into points. Work it task by task, like `PLAN.md`; each task
ends with a **Verify**.

This is **gameplay** (it changes the score and what the player chases mid-fight), so it lives in the sim and the
dungeon and replays, validates and steps in lockstep like everything else.

Status (2026-11-02): **plan.** Owner answers (2026-11-02, Kaleb): pellets do **not** feed the combo (PD1); the
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
   shorter than a kill's) and a short "chomp" whose pitch alternates, Pac-Man style (`sfx.pellet.eat`, rate-limited).
3. **The last few glow.** With `PELLETS_VIEW.lastFewHint` (3) or fewer left in the room, the rest pulse brighter so you
   can find them in a doubled room.
4. **Sweep.** Collect every pellet before the last enemy dies: the room clear's tally shows `Pellets 120` and
   `Sweep +250` next to Clear / Perfect / Speed, and the clear jingle gets a short sting (`sfx.pellet.sweep`).
5. **Too slow.** When the last enemy dies, whatever is left shrinks away (0.3 s). No sound, no penalty.
6. **Power pellet (rare).** About one floor in three from floor 2 has one, in one fight. It is a bigger cube that pulses
   slowly. Grab it: a ring flashes out from you, every enemy bullet on screen becomes a little cube that flies into
   you, and each one pays points (`sfx.pellet.power`, solo 30 ms freeze like a parry). Then the fight goes on.
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
| Endless solo / co-op, daily, dev | `PELLETS_CONFIG`: endless replays and scores change from floor 1. All-time boards stay `_v1` (PD10); `DAILY.ruleset` 3 -> 4 |

### 4. Client and theme (presentation only)

| Piece | Change |
|---|---|
| `PelletRenderController` (new, `client/controllers/render`, pooled, Janitor) | One view per pellet of a live room (pool of 64). Placeholder: a small axis-aligned `Block` Part (`PELLETS_VIEW.sizeTiles` 0.25; power 0.45), the `pellet` / `pellet.power` colour. With art: the vale cube sprite flat on the floor (FX floor placement, under every bullet). Pop-in wave, last-few pulse, shrink at the clear, power pellet's slow pulse. Reduced motion: no wave, no pulse (the last few just brighten), a fade instead of the shrink |
| Pellet pops | One tiny pop per pellet (`PELLETS_VIEW.pop`: about 60 % of a kill pop's text size, 0.4 s, a short rise) from `eaten`'s points, through the kill pops' pool; pellets taken by the same player on one frame merge into one pop (`+10`). Reduced motion: no rise, a fade |
| Power pellet fly-in | Erased bullets become cubes flying to the picker over 0.3 s (`ParticleController`), a ring from the picker; the solo 30 ms freeze through the hitstop clock (parry's) |
| `shared/view/pellets` | `PelletEvents` collected per tick like `BoostFrameEvents`; pure pop-in / pulse curves with specs |
| Room clear tally | `TallyKind` gains `pellets` (points earned in the room, shown like Kills) and `sweep` (a bonus: it flies with clear / perfect / fast). `RoomClear` gains `pelletPoints` / `sweepPoints`; killPoints subtracts the pellets. `ROOM_CLEAR_SEGMENTS` 4 -> 6; segments with 0 still hidden. PL7 checks the row fits the transient slot on the smallest phone (fallback: pellets fold into the first segment, renamed "Room") |
| Results screen | Two source rows `score.source.pellets` / `score.source.sweep` |
| Audio cue mapper | `sfx.pellet.eat` (two alternating pitches, `minInterval` 0.06 s, several on one frame play once), `sfx.pellet.sweep`, `sfx.pellet.power`: three port audio IDs in `PORT_AUDIO_EVENTS`, SILENT in the placeholder |
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

- [ ] **PL0. Confirm the assumptions.** Every row of "What the code gives us"; the require graph (score.ts -> the leaf
  helper only); the salt is unused; a census print of usable pellets per room by pattern at `roomScale` 2 (runs 1-10,
  floors 1-20) and how many rooms fall under `minPerRoom`. Edit `PELLETS` if needed. -> Verify: each row confirmed or
  this plan edited.
- [ ] **PL1. Dungeon.** `pelletsData.ts`, `placePellets`, `pellets` on `EndlessFloorLayout` / `EndlessFloorWorld`,
  barrel. -> Verify: `pellets.spec.ts` (shared/dungeon): pure, fixed draws, only FLOOR cells, never a piece or spawn
  cell, every pellet reachable from the room's spawns, `maxPerRoom`, power rate near `chancePercent` from floor 2 and
  never before; `endless.spec` digests, pieces, spawns, affixes, loot and boss picks unchanged; `roomPool.lock.spec`
  unchanged.
- [ ] **PL2. Sim state, score sources and hash.** `SimConfig.pellets`, `state.pellets`, `pelletsOnFloor` at both call
  sites, `addPelletScoreSources`, the `pellets` group, clone, names. -> Verify: `npm run verify` with every golden
  fixture, the M1 hash, the tutorial lock spec and every endless replay unchanged (nothing sets it yet); clone / hash
  specs; the non-pellet runs' `score` groups unchanged.
- [ ] **PL3. Live, pickup, gone, sweep.** `stepPellets`, the room hooks, `scorePellet` / `scoreSweep`. -> Verify:
  `pellets.spec.ts` (shared/sim): dormant before engagement (walking over does nothing), live on the engagement tick,
  pickup radius edges, a roll collects, a dead player does not, co-op first living player in index order, a pickup on
  the clear tick counts for the sweep, gone at the clear (no pickup after), sweep only with every pellet taken, the
  combo and its timer untouched by every pellet award, floor change resets, `state.rngState` untouched, a recorded
  replay matches.
- [ ] **PL4. Power pellet.** `pelletsPower`, `scorePowerBullets`. -> Verify: every non-goo enemy bullet erased and paid
  once, goo left alone, the cap, an empty pool pays nothing, segmented validation of a run that takes one.
- [ ] **PL5. Worlds.** `PELLETS_CONFIG` in `buildEndlessRunConfig`; `DAILY.ruleset` 3 -> 4. -> Verify: endless / party
  / partyProgression / dev specs replay and validate segmented; a census bot (extend `run/dropsCensus.spec.ts` or a new
  `pelletsCensus.spec.ts`): pellets per room, share taken, sweep rate, power pellets per floor, pellet + sweep share of
  the floor's score, speed bonus lost vs a run that ignores pellets; replay bench within budget.
- [ ] **PL6. Theme.** Roles, assets (placeholder `Block`), strings + l10n context, three port audio IDs,
  `pelletReport`. -> Verify: contract / validator / audio specs, `l10n:check`, the Luau locals count.
- [ ] **PL7. View.** `PelletRenderController`, the fly-in, `shared/view/pellets`, the tally's two segments, results rows,
  pellet pops, cues, `KV_PelletDebug`. -> Verify: headless specs for the pure parts and the tally (six segments, zeros hidden, the
  sweep in the flying bonus exactly once, footprint on the smallest phone); Studio: pellets read as squares on every
  biome, never over a bullet, pop in on engagement, shrink at the clear, the power fly-in, two players see the same.
- [ ] **PL8. Vale art.** `gen-pellet.js`, its test, `art/atlases.json` `own` sheet, upload, id. -> Verify: `test:art`,
  `art:build` byte-identical, the vale validator.
- [ ] **PL9. Playtest and tune.** Solo and co-op, PC and phone: do players chase pellets mid-fight, is a sweep
  reachable without throwing the speed bonus away every time, is the power pellet noticed, do pellets ever get mistaken
  for bullets. Tune `PELLETS` and the points.
- [ ] **PL11. Tutorial room G.** `TUTORIAL_ROOMS` entry, `combatG`, `tutorialPellets`, `pellets` in the tutorial run
  config. -> Verify: the layout lock spec re-pinned (room G 7, treasure 8, shrine 9, stairwell 10; the snake still
  fits), room G's pellets on floor cells only and reachable, none elsewhere on floors 1-2, the guard lock still on
  combat D (room 4; `TUTORIAL_GUARD_ROOM` is derived from the lesson, so it follows by itself).
- [ ] **PL12. Sweep lock.** `pelletLock`, `TUTORIAL_PELLET_LOCK`, the shared hold, release, hash fields,
  `isTutorialPelletHolding`. -> Verify: `sim/tutorial` specs: held while pellets remain (sword, arrows, a heavy arrow),
  released on the last pickup (also when the last pickup and the kill land on one tick), no lock without the config,
  guard lock unchanged, a recorded tutorial replay matches.
- [ ] **PL13. Script, strings, funnel.** Step `pellets`, skill `sweep`, `holdPrompt`, strings + context, revision 3,
  caps. -> Verify: `tutorial.spec` / `flow.spec` / `guide.spec`, the onboarding funnel and `analyticsCatalog` budget
  specs, `l10n:check`; the full-run bot (option `pellets`) finishes the tutorial; the map step's `next` marker now
  points at G's door.
- [ ] **PL14. Power pellet first sighting.** `pellet.power`, `bestiary.pellet.power`, the SightingController trigger.
  -> Verify: sightings spec (canonical order, string list equal), Studio: the toast once per account.
- [ ] **PL15. Tutorial playtest** (with PL9). New players: is the lock read as "grab the pellets" rather than "the
  game is broken", how long room G takes, funnel drop at step 12. Tune `TUTORIAL.pellets.max` and the prompts.
- [ ] **PL10. Docs.** `CLAUDE.md` decision log line and docs-table row (`docs/PELLETS.md`, this plan moved into the
  repo), `src/shared/sim/README.md` (step order, hash group), docs/ROOM_CLEAR.md (tally), docs/CLIENT.md (debug
  attribute), docs/TUTORIAL.md (room G, the sweep lock), docs/TUTORIAL_FUNNEL.md (revision 3). -> Verify: `npm run
  verify`.

Critical path: PL0 -> PL1 -> PL2 -> PL3 -> PL5. PL4 after PL3; PL6 any time after PL0; PL7 after PL3 and PL6; PL8
after PL6. PL11 after PL1; PL12 after PL3; PL13 after PL12 and PL6; PL14 after PL4 and PL7; PL15 with PL9.

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
- **PD6. Power pellet = convert, no "frightened" enemies** [PL4]. Every non-goo enemy bullet on screen becomes points
  at once (a shmup bomb with a Pac-Man coat). Goo stays: it is terrain, and the guard pays nothing for it either.
  Alternative: enemies also hold fire for 3 s (a hook in every archetype's firing; bigger change).
- **PD7. Pickup radius 0.45 tiles** [PL3]. Under half a tile, so a pass through a line takes the pellets on it and the
  cell lookup stays 3 x 3. Alternative: drops' 0.6.
- **PD8. The power pellet is not needed for a sweep** [PL3]. You choose when to fire it; leaving it does not cost the
  bonus. Alternative: it counts like any pellet.
- **PD9. Enemy rooms only; no pellets in boss rooms** [PL1]. Boss rooms have no room record and their own score
  (no-hit bonus). Alternative: a ring of pellets per boss phase.
- **PD10. Leaderboards stay `_v1`** [PL5], as for Builds, Enemy variants and breakable loot; `DAILY.ruleset` 3 -> 4.
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
