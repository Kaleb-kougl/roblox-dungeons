# First-run tutorial ("Practice Descent"): plan

Status (2026-10-25, branch `tutorial`): **T1-T7 code-complete and verified headlessly** (`npm run verify`; the sim,
world, director, onboarding codec and funnel filter are specced under `src/shared/**`). **Nothing has run in Studio
yet**: the client (T6), the OnboardingService DataStore and remotes (T5) and the funnel calls (T7) are untested at
runtime. **T8 (playtest) is pending.** Planned against the `slice` vertical slice (M1-M5 code-complete headless), then
ported onto `main`'s main menu / Options with rebinding / same-server lobbies / Leave run (the M4 `KV_Party` invite
flow it first hooked into is gone; §4 / §5 say how it fits the new flow); the sections below are the plan with "as
built" notes where the build differs. Branch `tutorial-linear` (2026-10-26, headless only) made floor 1 a strict
linear chain of the lesson rooms (a new opt-in Forge option, `chain`) and the floor-2 boss fast
(`TUTORIAL.bossHpPercent` = 20); see "Decisions" 6-7. 2026-10-26 (headless only): combat B's boost drop became a
real step, `boost` (funnel step 6 of 16; the funnel was renumbered, §6); see "Decisions" 8. 2026-10-26 (headless
only): blocking is mandatory: the `guard` step (combat D) is never waived, because the sim holds the bruiser at 1 hp
until a sword guard erases a bullet (`TutorialSimConfig.guardLock`), and its prompt says "block"; see "Decisions" 9.
2026-11-01 (headless only; Studio check pending): a map lesson, step `map` (funnel step 11 of 17, after `ember`: open
the full map), was added and the funnel renumbered again (§6); see "Decisions" 10 and docs/TUTORIAL_MAP.md.
2026-11-02 (headless only; Studio check and playtest pending): a pellet lesson, **combat G** (room 7, after combat F),
step `pellets` (funnel step 12 of 18), held by a sweep lock until every pellet is taken; floor 1's seed 7500 -> 7574 and
the funnel renumbered again (§6); see "Decisions" 11 and docs/PELLETS.md "Tutorial lesson".

## Goal

The first time a player joins, they play a short, guided **Practice Descent** instead of a ranked run. It is the real
game: the same sim, Dungeon Forge collision, renderers, HUD, juice, boon draft, relics, shrine, stairwell and Mother
Mayhem. The one difference is that **enemies can hit you but never take hearts**. Prompts teach every verb in the
room where it matters, and the last screen spells out the objective: go as deep as you can, because death ends the run
and your score goes on the leaderboard.

Target length: **4-6 minutes**. You can skip it at any time from the pause overlay, and replay it later from the main
menu (**Tutorial**).

## What the codebase gives us (and the constraints it sets)

| Fact | Where | Consequence for the tutorial |
|---|---|---|
| Every hit on a player goes through `damagePlayer()` (bullets, contact, DEBUG_HIT) | `shared/sim/player.ts`, `combat/ctx.ts` `hurtPlayer*` | "No damage" is one branch in one function, not a per-enemy change |
| The sim must replay bit for bit; every state field is hashed; opt-in features add a hash group only when their config is present | `shared/sim/README.md`, `step.ts` (`endless`, `scoring`, `party`) | Add `SimConfig.tutorial` with its own appended `tutorial` hash group. Without it nothing changes, and every golden fixture still matches |
| Endless worlds are `EndlessConfig.worldForFloor(floor) -> EndlessFloorWorld` with `roomSpawns` per room id (spawned when the player first enters a room), `bossFloor`, spawn and stairwell | `shared/sim/endless.ts`, `shared/run/endless.ts` | The tutorial is an **endless config with two hand-scripted floors**. Room-by-room spawns, the stairwell, the draft, pedestals and the shrine all come for free |
| Worlds are one line in a registry; only `LEADERBOARD_ELIGIBLE_WORLDS` post | `shared/run/worlds.ts` | `registerRunWorld("tutorial", ...)`. It never posts and is never submitted |
| Per-player DataStore docs already have a cache, retries, a leave/BindToClose save and rate limiting | `SettingsService`, `shared/settings` `PlayerDocCache` | The "has played the tutorial" flag is a second small doc built on the same pattern |
| Funnel analytics already wired | `TelemetryService` (`AnalyticsService.LogFunnelStepEvent`) | Per-step drop-off for free |
| The flask only heals when hurt; START_HALF_HEARTS = 6, FLASK_HEAL_HALF_HEARTS = 2 | `shared/sim/playerData.ts` | With no damage the flask can't be taught, so the tutorial **starts the player wounded** (4 of 6 half hearts) |
| All text is theme strings, all tunables live in `shared/config`, Workspace `KV_*` attributes drive Studio testing | `CLAUDE.md`, `docs/CLIENT.md` | `tutorial.*` string keys, a `TUTORIAL` tunables block, plus `KV_Tutorial` and `KV_ResetOnboarding` |

## Player experience

### Flow

```
join -> server loads onboarding doc --(tutorialDone = false)--> Practice Descent (floor 1 -> draft -> floor 2 boss),
                                   |                             straight away: no main menu first
                                   \-(true / load failed / timeout)-> the normal join flow: the main menu (Tutorial in it)
Practice Descent end (stairwell on floor 2) -> server marks done -> outro card -> "Start my first run" (= Play solo)
Skip (pause) -> server marks done -> back to the menu, like Leave run (the main menu; the lobby room while in a lobby)
```

### Floor 1: "The Training Halls" (scripted rooms, linear)

Each lesson belongs to a room. The prompt appears when the room is entered (`events.roomEntered`), so the lessons hold
up even if the player wanders off. A world marker (beam or arrow) always points at the next lesson room's door.

| # | Room | Spawns (deferred) | Prompt (keyboard / gamepad glyphs by `game.inputDevice`) | Done when |
|---|---|---|---|---|
| 0 | Entrance | none | **Objective card** (2 lines): "Descend as deep as you can. Each floor is harder; the run ends when your hearts run out." `Continue` | Card dismissed (FIRE) |
| 1 | Entrance | none | "Move: **WASD** / left stick" | Moved >= `TUTORIAL.moveTiles` (3 tiles) |
| 2 | Entrance | none | "You're wounded. Drink your flask: **F** / D-pad up. You get 3 per floor, refilled on every new floor." (pulse on the Flask pips) | `flaskUsed` event |
| 3 | Combat A | 2 training dummies (or low-hp swarmers, see open questions) | "Aim with the mouse / right stick. Hold **Left click** / RT to attack. The third swing is a finisher." | Both killed |
| 4 | Combat B | 3 swarmers | "They rush you. Getting hit flashes you red. **In a real run that costs half a heart.**" (first harmless hit: ghost half-heart flash + toast) | Room cleared |
| 5 | Combat C | 1 sniper | "The orange line is its aim. **Roll through the shot**: Space / LB. You can't be hit mid-roll." | Room cleared and >= 1 roll (praise toast on a graze) |
| 6 | Combat D | 1 bruiser | "**Block** with the sword: **Right click** / LT as a shot reaches you. It deletes bullets, and shockwaves too." (the guard is a press, 0.3 s). While the bruiser waits at 1 hp: "It won't go down until you block one of its shots" | >= 1 guard cancel (score `guard` source) and room cleared. **Never waived** (Decisions 9): the sim holds the bruiser at 1 hp until the first block (`guardLock`), so the room cannot be cleared without one |
| 7 | Combat E | 1 turretSniper behind cover | "Swap to the bow: **E** / Y. Hold Right click / LT to charge a heavy arrow, then release." (pulse on WeaponPanel) | Weapon swapped, a heavy arrow fired, room cleared |
| 8 | Combat F | turretSprayer x2 (a bullet storm) | "Too many bullets? **Q** / RB burns an Ember and clears every enemy bullet. 2 per floor." | `emberUsed`, room cleared (the Ember waived if none is left) |
| (M) | Combat F's exit, then the walks to the treasure, shrine and stairwell rooms | none | Step `map` (funnel step 11, docs/TUTORIAL_MAP.md): "The map in the corner fills in as you explore. Open the full map: **M** / D-pad left. Press it again to close." (touch: "Tap the pause button to see the whole floor."). Rings the corner minimap; the marker keeps leading to the treasure room; inside a lesson room that room's prompt wins | The full map open (touch: the pause overlay's map shown; an earlier open counts); waived (done, not skipped) when floor 1 is left unopened or the map is unavailable |
| (G) | Combat G (docs/PELLETS.md) | 1 sniper over a ring of 12 pellets | "Grab the pellets while enemies are alive. Get them all for a Sweep!" While the sniper waits at 1 hp: "Grab the last pellets to finish the fight." | Room cleared with a Sweep (skill `sweep`). **Never waived**: the sweep lock (`pelletLock`) holds the sniper at 1 hp until the last pellet |
| 9 | Treasure | pedestal (existing M2 logic; drawn as the vault chest since 2026-11-06) | "Relics are permanent for the run. Walk up to the chest to open it." | Pedestal taken |
| 10 | Shrine | curse shrine | "Curses make the run harder and your **score multiplier** bigger. **1** / A to accept, or walk away." | Accepted, or left the zone after seeing it |
| 11 | (any time, first kill) | | Callout on ScorePanel: "Kills, grazes and guard cancels score. Chain them for combo." | Shown once |
| (B) | Combat B, its last kill (wherever that swarmer died) | the guaranteed Fury (docs/BOOSTS.md B9) | Step `boost` (funnel step 6): "A boost! Walk over it before it fades: it powers you up for a few seconds." The marker points at the drop while it lies there; the pickup rings the boost row | Picked up (on its landing frame too); waived (done, not skipped) when it fades untaken |
| 12 | Boss room (stairwell, open) | none | "The **stairwell** takes you down. Every floor is more dangerous than the last." (shown on the way there; marker on the stairwell. Depth only grows per boss kill, so the plan's "raises the Depth" was dropped) | Floor changes |

Then the real **boon draft** opens. Prompt: "Pick a boon: **A / D** / stick, then click / RT." It is done when a boon
is confirmed.

### Floor 2: "Mother Mayhem" (boss floor, harmless)

- On entry: "Every 5th floor ends with a boss. **Orange previews show exactly where her bullets will go.**"
- Boss phase callouts on `bossPhase` events: "Phase II: new patterns." The boss bar is highlighted the first time.
- `TUTORIAL.bossHpPercent` = **20** (built on `tutorial-linear`, §2 "Scaling"): she has 108 of her 540 hp, so the
  practice fight is ~20-30 s and still plays phases II and III.
- The boss dies, the stairwell opens, and the prompt reads "Take the stairwell to finish." Stepping in (the floor 2 -> 3
  change) **ends the tutorial**. The client stops the run before the floor 3 draft is shown.

### Outro card

"That's the descent. In a real run: no respawns, the floors keep getting harder, and your score goes to the
**leaderboard** (B)." Buttons: **Start my first run** (the ranked `startRun`) and **Play the tutorial again**.

### Throughout

- **Harmless hits look real.** The hurt blink, hurt sound, post-hit invulnerability (0.75 s) and combo cut all still
  happen. Only hearts, armor and death are skipped. The first few hits also get the ghost half-heart flash.
- The HUD is the real HUD. A small `TutorialPanel` (lower centre) adds the step's prompt, progress dots and
  `P: pause / skip`. Highlights are a pulsing `uiAccent` ring around the HUD element being taught.
- The InfoPanel verdict line reads `Practice: not submitted (tutorial)`.
- R (restart) is off during the tutorial. The pause overlay shows **Resume / Restart tutorial / Skip tutorial /
  Options** (Skip asks first). Skip counts as done.

## Architecture

### 1. Sim: `SimConfig.tutorial` (deterministic, opt-in)

```ts
// shared/sim/tutorial/tutorialData.ts (tunables) + tutorial.ts
export interface TutorialSimConfig {
	/** Hits land (events, hurtTicks, combo cut, on-hit hooks) but never remove armor or hearts, and never kill. */
	readonly harmless: boolean;
	/** Hearts at run start (half hearts); START_HALF_HEARTS when absent. Lets the flask lesson work. */
	readonly startHalfHearts?: number;
}
export interface TutorialState { harmlessHits: number } // hashed as the appended "tutorial" group
```

- `createSimState`: with `config.tutorial`, create `state.tutorial` and apply `startHalfHearts` to every player.
- `damagePlayer`: after the invulnerability check, `if (state.tutorial !== undefined && harmless)`: do
  `events.playerHits += 1`, `hurtTicks = HURT_INVULN_TICKS`, `runOnPlayerHit` and `harmlessHits += 1`, then return
  true. Skip the armor, hearts, Second Wind and death steps. `isPlayerInvulnerable` is unchanged, so a bullet is
  consumed exactly as in a real run.
- Hash: `writeTutorialHash` appended after `party` in the group order (update `shared/sim/README.md`).
- Nothing else in the sim changes. The tutorial **script** (prompts, step completion) lives outside the sim (part 3),
  so it can be reworded without touching replays.

### 2. World: `buildTutorialRunConfig()` (`shared/run/tutorial.ts`) (built, T2)

```ts
registerRunWorld("tutorial", (_seed, o) => buildTutorialRunConfig(o.partySize)); // seed ignored; party > 1 throws
```

- `config = { endless: { runSeed: TUTORIAL.runSeed, worldForFloor }, scoring: ENDLESS_SCORING, tutorial: { harmless: true, startHalfHearts: TUTORIAL.startHalfHearts, bossHpPercent: TUTORIAL.bossHpPercent }, drops: TUTORIAL_DROPS_CONFIG }`.
  Drops (docs/BOOSTS.md B9): `TUTORIAL_DROPS_CONFIG` = `guaranteedDropsConfig([{ floor: 1, room: TUTORIAL_BOOST_ROOM,
  kind: TUTORIAL_BOOST_KIND }])`: the last of combat B's three swarmers (room id 2, `TUTORIAL_BOOST_LESSON`) always
  drops a Fury; no random drops, no pity. The lock spec pins it; nothing else in the world changed.
  The setup is an `EndlessRunSetup` (it hands out `endlessFloor(floor)` like an endless run, so the client renders it
  the same way). Tunables: `TUTORIAL` in `shared/config/tutorial.ts` (`runSeed`, `floor1` / `floor2` Forge seed + room
  count, `lastFloor = 2`, `startHalfHearts`, `moveTiles`, `clusterSpacingTiles`).
- **Tutorial floors are endless floors.** Every floor's Forge params are `tutorialForgeParams(seed, roomCount, chain?)`
  = `{ ...endlessFloorParams(TUTORIAL.runSeed, 1), seed, roomCount }` (floor 1 adds `chain`): the M1 preset plus every endless option
  (`solidPillars`: pillars are 1-tile WALL cells, cover against bullets and sight; `roomScale` = `ENDLESS_ROOM_SCALE`
  = 2: double-size rooms). Every floor's sim world is `endlessFloorWorld(layout)` (`shared/run/endless.ts`, the same
  builder `endlessRunFloor` uses): `circleMover`, `bulletBlocker`, `actorMover` and `actorSteerMover` (room enemies
  steer round pillars) on its dungeon. Only the seed, the room count and the room spawns are the tutorial's, so the
  practice run plays like a real endless floor, and a later endless change reaches the tutorial by itself: the lock
  spec checks the params (all but seed / room count / chain) and the world's SimConfig fields against an endless
  floor's, and its layout digests (and the chain check) fail when a Forge or endless change moves the layout.
- **Floor 1** (rebuilt on `tutorial-linear`; before it was the seed-searched Forge seed 7513: a 277-tile tour, one
  loop corridor, legs through branching corridors): a **Forge chain floor**. The Kaleb-Vale Forge option `chain`
  (`ForgeParams.chain`, `shared/dungeon/forge/chain.ts`; opt-in, off on every other floor) takes the rooms in walk
  order and replaces the rolled stages 1-4.2 (scatter, separation, Delaunay, MST + loops, room-type draws): room i + 1
  is placed on the given side of room i, centres on one row (column), `gap` tiles of corridor between their floors,
  and the only Forge edges are the chain's neighbours, so the carve stage stamps ONE straight 3-wide corridor per pair
  (no L bend, no rng draw). `chainGraph` throws if any two pieces (rooms, corridors) that are not joined come within
  `CHAIN_CLEARANCE` (2) tiles. Everything after the graph (theme mutations: frozen lakes, graveyards; carving, pits,
  arches, BFS, decoration, solid pillars, torches, banners, the name) is the unchanged Forge code on the seed's stream,
  so the floor has the real look and every Dungeon consumer (WorldController, DecorController / `planDecor`: 131
  pieces, `encounterRooms`, the populator tiles, the boss seal) reads it like any floor. The chain is `tutorialChain()`:
  `TUTORIAL_ROOMS` (each row now carries the room's `w` / `h` before the endless room scale, `shape` and `next` side)
  with `TUTORIAL.floor1.corridorTiles` = 4 tiles between neighbours, laid out as a three-row snake (entrance -> A -> B
  east, down to C, C -> D -> E west, down to F, F -> G -> treasure -> shrine -> boss east). The seed
  (`TUTORIAL.floor1.seed` = **7574** since room G; it was 7500, which with the longer chain left lesson E's turret
  without cover) only picks the theme (frost, as before) and the decoration: its frozen lakes are in combat D / F, so
  lesson E keeps its solid pillars (`node scripts/find-tutorial-seed.js --floor 1 --from 7500 --to 7700` lists working seeds:
  40 of the first 48; a lake or graveyard on room 5 is what rules a seed out). Room id = place in the chain. The
  **tour is 225 tiles** with room G (198 before it; centre to centre round the pillars), corridors 4 tiles
  (5 where they meet the ellipse treasure room's rim). `bossFloor: false`, so the stairwell is open from the start.
  Room order (`TUTORIAL_ROOMS`, lesson -> room id / type / size x2 / shape -> deferred spawns):

  | Lesson | Room | Spawns |
  |---|---|---|
  | entrance | 0 entrance, 12x12 rect | none |
  | combatA | 1 combat, 16x16 rect | 2 `dummy` (cluster at the centre) |
  | combatB | 2 combat, 16x16 oct | 3 `swarmer` (cluster) |
  | combatC | 3 combat, 18x16 rect | 1 `sniper` (far from the door) |
  | combatD | 4 elite, 18x18 oct (frozen lake) | 1 `bruiser` (far) |
  | combatE | 5 combat, 18x18 rect | 1 `turret.sniper` (`cover`: behind a solid pillar, out of sight of the door the player comes in by; the farthest such tile) |
  | combatF | 6 combat, 18x16 rect (frozen lake) | 2 `turret.sprayer` (far, spread) |
  | combatG | 7 combat, 9x9 rect | 1 `sniper` (far) over a `ring` of pellets (`tutorialPellets`: `TUTORIAL.pellets` inset 2, max 12; no power pellet) |
  | treasure | 8 treasure, 12x12 ellipse | the normal relic pedestal |
  | shrine | 9 shrine, 12x12 oct | the normal curse shrine |
  | stairwell | 10 boss, 18x18 rect | none (the open stairwell at its centre) |

  **Contiguity** is guaranteed by construction and checked: solid pillars (and lava pits) are each placed with all 8
  neighbours FLOOR, so none touches another or a wall and none can split a room (a path through one goes round its
  ring), and the chain's pieces keep apart. `checkTutorialChain(d, order)` (`tutorialLayout.ts`, run by the lock spec)
  proves it on the built floor: exactly the 11 rooms, no room's floor 4-touching another's, exactly one corridor region
  per consecutive pair and none touching a third room (no loops, side corridors or dead ends; the Forge edges agree),
  every room's walkable floor ONE 4-connected region holding its centre, every spawn tile (`roomSpawnTiles`) and both
  doors (in from the previous room, out to the next), and no leg walking through a later room.
  Placement `cover` (lesson E, "behind cover"): `coverTiles(d, room, door)` are the room's spawn tiles with no line of
  sight from the door and a solid pillar within `COVER_PILLAR_TILES` (2: spawn tiles keep 8 floor neighbours, so one
  free tile separates it from the pillar); the farthest of them from the door. With none it falls back to `far`.
  Spawns stand on the populator's spawn tiles (`roomSpawnTiles`), which are also the floor's `roomSpawnTiles` for the
  safe-spawn rule. `tutorialRooms()` / `tutorialRoom(lesson)` add each room's `center`, `door` (the last corridor tile
  of the walk from the previous lesson room: the marker's target) and `spawns`. Also exported:
  `TUTORIAL_ENTRANCE_ROOM`, `TUTORIAL_TREASURE_ROOM`, `TUTORIAL_SHRINE_ROOM`, `TUTORIAL_STAIRWELL_ROOM`,
  `TUTORIAL_WORLD_KIND`.
- **Floor 2**: Forge seed **905**, 2 rooms (the entrance and a 34x26 boss arena, a 28-tile walk; `--floor 2 --rooms
  2,3,4 --to 3000`: the shortest walk, then the larger of the two 28-tile arenas) as a boss floor:
  Mother Mayhem is the only spawn. **Floor 3+** (reached only by the floor 2 -> 3 change that ends the tutorial, or a
  debug skip) reuses floor 2's layout, empty, with the stairwell open, so the sim never throws.
- **Scaling**: in a tutorial run enemy hp and bullet speed scale as endless floor 1 on every floor (sim
  `tutorialScalingFloor`), and Depth is 1 until the boss dies: the dummy has its 8 hp. **Boss hp** (built on
  `tutorial-linear`): `TutorialSimConfig.bossHpPercent` (an integer >= 1; absent = 100) is carried into
  `TutorialState.bossHpPercent`, a new hashed field appended to the `tutorial` group (`TUTORIAL_HASH_FIELDS` =
  harmless, harmlessHits, bossHpPercent), and spawnActor gives a boss archetype `hp x percent / 100`
  (`tutorialBossHp`, after the endless and party scaling; outside a tutorial run, and at 100, the hp is untouched, so
  every fixture and normal run hashes as before; every tutorial run's state hash changed by the appended field). The
  tutorial passes `TUTORIAL.bossHpPercent` = **20**: Mother Mayhem has 108 hp. Her phase marks (`phaseHp` 0.66 /
  0.33) are fractions of hpMax, so phases II and III start at 71.28 and 35.64 hp, and the HUD boss bar (snapshot
  `bossHp / bossHpMax`, notches at `phaseHp`) stands on its notches then (0.660 / 0.331 measured). The damage cap
  (`damageCapPerSecond` 6) and the roars (intro 1 s, transitions 1.5 s x2, immune) were **left alone**: the bot fight
  is 21.3 s of sim (phase II at 7.8 s, III at 14.6 s), of which the roars are 4 s, and the cap only binds at the
  bot's full melee uptime (~6 dps), which a human rarely beats, so a human fight lands at ~20-30 s without them.
- **Guard lock** (the block lesson, "Decisions" 9): `TutorialSimConfig.guardLock` = `TUTORIAL_GUARD_LOCK` = `{ floor:
  1, room: TUTORIAL_GUARD_ROOM }` (combat D, room id 4, `TUTORIAL_GUARD_LESSON`). When that room is first entered
  (endless `enterRoom`, after its deferred spawns: `tutorialOnRoomSpawned`) the lock arms on the spawned actors' ids
  (`guardLockFirstId` .. `guardLockEndId`, one spawn's ids are consecutive). While armed, `damageActor` keeps a held
  actor at `TUTORIAL_GUARD_HOLD_HP` = 1 (`tutorialHeldDamage`: the hit still lands, flashes, calls `onHit` and counts in
  `enemyHits`; only the hp stops). The first sword guard sweep that erases an enemy bullet (`sword.ts` ->
  `tutorialOnGuardCancels`, the same count the score's `guard` source gets) releases it for good; a room that spawned
  nothing releases at once. Hashed: `TUTORIAL_HASH_FIELDS` gained `guardLockFloor`, `guardLockRoom`, `guardLock`
  (0 waiting / 1 armed / 2 released), `guardLockFirstId`, `guardLockEndId`, appended after `bossHpPercent`. Without
  `guardLock` (and outside a tutorial run) nothing is held, so every fixture and normal run hashes as before; every
  tutorial run's state hash changed by the appended fields. The bot's tour run is unchanged (it guards before it
  swings, so the lock releases before any hold); `guardLate` (swing first) shows the hold.
- **Sweep lock** (the pellet lesson, "Decisions" 11, docs/PELLETS.md PL12): `TutorialSimConfig.pelletLock` =
  `TUTORIAL_PELLET_LOCK` (floor 1, combat G's room 7) is the guard lock's twin: armed on room G's spawned ids, the same
  hold (`tutorialHeldDamage`, `TUTORIAL_GUARD_HOLD_HP`), released by `stepPellets` on the room's last pickup
  (`tutorialOnPelletsSwept`), at once when the room spawned nothing or has no pellet. Five fields appended to the
  `tutorial` group (`pelletLockFloor`, `pelletLockRoom`, `pelletLock`, `pelletLockFirstId`, `pelletLockEndId`);
  `isTutorialPelletHolding` / `isTutorialPelletReleased`. The tutorial's run config sets `pellets: PELLETS_CONFIG`, so
  its score gains the `PELLETS` / `SWEEP` sources; tutorial replays changed, no fixture did.
- **Lock spec** (`tutorial.spec.ts`): the Forge params and floor-world SimConfig fields are an endless floor's (floor 1
  `chain` = `tutorialChain()`), both layout digests (floor 1 `fc231be9` since room G, floor 2 `c0fd5b19`), the lesson table's room
  ids / types / order and the chain built from it, `checkTutorialChain` with no problem (10 corridors of 4-5 tiles, the
  225-tile tour, the lesson doors are the tour's) and that it does catch a rolled floor and a wrong order, solid
  pillars in lesson E's room and decor on every layer (`planDecor`), lesson E's turret behind a pillar out of the
  door's sight, every spawn on a floor tile of its room, pedestal / shrine / stairwell rooms, determinism, a harmless
  smoke run, the debug floor skip 1 -> 2 (boss at 20 % hp, draft) -> 3, the dummy's 8 hp, the registry, solo only.
- Server: `tutorial` is not in `LEADERBOARD_ELIGIBLE_WORLDS`, and the server never runs it: it is in
  `SERVER_REFUSED_WORLDS` (`shared/run/worlds.ts`, `isServerRunWorld`), so `RunSessionRegistry.start` (every session
  start: the ranked `startRun` and a lobby's party / solo start, hence every segment and final) answers `unknown_world`
  for it (lobby runs are always `RANKED_WORLD_KIND` anyway). It stays
  registered so the client's local `buildWorldSetup` builds it; the client plays it locally and never submits it (the
  one-shot `submitRun` validates only in the fixed `RunLimits.world` set, which never includes it).
- `RunTelemetry` now starts from `runStartHalfHearts(config)` (the run's real start hearts) in `LiveRun`, `validateRun`,
  `SegmentedValidator` and `LockstepClient`, so the wounded start is not logged as 2 half hearts lost on tick 1.

### 3. Tutorial script: `shared/tutorial/` (pure, headless-tested) (built, T4)

- `steps.ts` `TUTORIAL_STEPS` (18 steps since the pellet lesson, funnel numbers 1..18; `TUTORIAL_STEP_COUNT`, `tutorialStepName(n)`): per step
  a stable `id` (= funnel step name), `number`, `floor`, the floor-1 `lesson` room, a `prompt` id (theme keys
  `tutorial.prompt.<prompt>.<keyboard|gamepad|touch>`, `tutorialPromptKey(step | promptId, device)`; touch holds the
  keyboard text for now), an optional `highlight` (`flask | weapons | score | bossBar | hearts | boosts | minimap`),
  the `marker` target and the completion `rule`:

  | # | id | Room / floor | Done when |
  |---|---|---|---|
  | 1 | `objective` | entrance (the objective card) | a FIRE press edge in the frame's raw buttons, the card up >= `TUTORIAL.objectiveCardMinSeconds` (0.75 s) |
  | 2 | `move` | entrance | walked >= `TUTORIAL.moveTiles` (3) tiles |
  | 3 | `flask` | entrance (highlight: flask) | `events.flaskUsed` |
  | 4 | `attack` | combatA | room cleared (both dummies) |
  | 5 | `hits` | combatB (highlight: hearts) | room cleared |
  | 6 | `boost` | floor 1, no room (marker: the drop; no highlight) | a boost runs on the player (combat B's Fury taken, on its landing frame too); waived when a drop was seen on floor 1 and none lies any more with no boost run (it faded) |
  | 7 | `roll` | combatC | room cleared and >= 1 roll since entering |
  | 8 | `guard` | combatD (hold prompt `guardHold`) | room cleared and >= 1 guard cancel since entering (or the sim's guard lock released); never waived: the room cannot clear without a block (§2 "Guard lock") |
  | 9 | `bow` | combatE (highlight: weapons) | room cleared, the bow in hand and a heavy arrow released since entering |
  | 10 | `ember` | combatF | room cleared and an Ember burnt since entering (waived when cleared with none left) |
  | 11 | `map` | floor 1, no room (highlight: minimap; marker `next`: the next open lesson's) | the full map seen (`TutorialFrame.mapSeen`; touch: the pause overlay's map too); waived (done, not skipped, `waived`) when floor 1 is left unopened, or while current with `mapAvailable` false (docs/TUTORIAL_MAP.md) |
  | 12 | `pellets` | combatG (hold prompt `pelletsHold`) | room cleared and the score's SWEEP count rose since entering (or the sim's sweep lock released); never waived (skill `sweep`, docs/PELLETS.md PL13) |
  | 13 | `relic` | treasure | a relic taken |
  | 14 | `curse` | shrine (highlight: score) | a curse accepted, or the shrine zone left after standing in it |
  | 15 | `stairwell` | stairwell room (prompt shown on the way) | floor >= 2 |
  | 16 | `draft` | floor 2 | a boon confirmed |
  | 17 | `boss` | floor 2 (highlight: boss bar; marker: the boss) | Mother Mayhem dead (Depth grew) |
  | 18 | `finish` | floor 2 (marker: its stairwell) | floor >= 3: `finished` |

  Callouts (`TUTORIAL_CALLOUTS`, one-shot toasts `tutorial.callout.<id>`, not funnel steps): `score` on the first kill
  (rings the score panel for `TUTORIAL.calloutHighlightSeconds`; this is lesson 11), `harmlessHit` on the first harmless
  hit (rings the hearts), `graze` on the first graze, `bossPhase2` / `bossPhase3`. (The `boost` callout and its
  `boostDrop` trigger are gone: the `boost` step's prompt replaced them, and `tutorial.callout.boost` left the
  placeholder pack.) The first `TUTORIAL.ghostHeartHits` (3) harmless hits set `ghostHeart`.
- Boosts (docs/BOOSTS.md B9; P8 reversed 2026-10-26): the `boost` step (6, rule kind `boost`, marker kind `drop`,
  prompt `boost`: "A boost! Walk over it before it fades: it powers you up for a few seconds.", the same text on every
  device). Combat B's last kill drops the Fury as the room clears, so in the tour `hits` and the landing share a frame
  and `boost` is current at once, wherever the last swarmer died; its marker is `{ kind: "drop", x, z }`, the ground
  drop nearest the player (lowest slot on a tie), nothing when none lies. Done on the pickup (a boost runs on the
  player, the landing frame included); waived, done not skipped, when the drop was seen on floor 1 and none lies any
  more with no boost run (it faded); skipped when floor 1 is left first (the floor change clears the ground, which is
  not a fade). The first frame a boost runs (the pickup) rings `TUTORIAL_BOOST_HIGHLIGHT` = `boosts` (the HUD's boost
  row) for `TUTORIAL.calloutHighlightSeconds`; the step has no highlight of its own (the row is empty until then), and
  no toast of the tutorial's own (the HUD's `hud.toast.boost` names the boost).
  **Out of order**: the old "drop override" of the marker (a drop on the floor pointed the marker at it whatever the
  step) is gone, but one case it covered is kept: a drop lying while the `boost` step is open but NOT current (an
  earlier step still open when combat B clears: the flask never drunk, or combat A skipped past). Then the director
  shows the `boost` step out of order, its prompt and its drop marker (like a lesson room's prompt holds up out of
  order), except inside an entered, unfinished lesson room (the fight keeps its own prompt and marker) and under the
  objective card. While `boost` is current its marker shows wherever the player stands (a current step's marker is
  never hidden by an out-of-order room). The marker controller only reads x / z, so the client needed no change.
  A KV_Debug drop (key Semicolon; M before docs/MINIMAP.md MD11) also counts: taken, it completes the step; left to fade, it waives it (debug only).
- `director.ts` `TutorialDirector`: `new TutorialDirector()`, then `update({ state, config, events, buttons, dt,
  mapSeen, mapAvailable })` once per rendered frame (state read only, `LiveRun.frameEvents`, the frame's raw InputFrame
  buttons, real dt, and two client facts for the `map` step: the full map seen this frame and the map available) ->
  `TutorialView` (reused object: `active`, `finished`, `stepIndex` / `stepCount` / `stepId`, `promptStepIndex`,
  `prompt`, `card`, `highlight`, `marker { kind, x, z }`, `done[]` / `skipped[]` / `waived[]` / `stepsDone`,
  `callouts[]`, `ghostHeart`, `funnelStepReached` / `newFunnelSteps[]`, `revision`). It reads facts from the state
  wherever the state keeps them (rooms entered, score room clears and source counts, relics / curses / boons, the shrine
  zone, harmlessHits, the weapon in hand and the bow's heavy-arrow tick, the boss, floor and Depth), events only for
  flask / roll / Ember. Never writes the sim; deterministic for a frame sequence.
- Lessons latch done in any order (a room lesson only once its room is entered; its skills count from then). The current
  step is the lowest unfinished one: the marker points at it (a room's door until entered, then nothing while inside /
  the room centre after wandering out; pedestal, shrine, stairwell, the live boss; `next`, the `map` step's: the marker
  of the next open step that has one, reported as that step's kind). The prompt is the current step's, except inside an
  entered, unfinished lesson room (that lesson's) and before a lesson room is entered (`follow`: "Follow the marker to
  the next room."). A step still open when its floor is left is marked skipped, so an early stairwell never strands the
  player (the `map` step is waived instead, docs/TUTORIAL_MAP.md TMD3); the floor 2 -> 3 change finishes the tutorial
  and skips anything left.
- Funnel: `funnelStepReached` = leading steps PRACTISED (done and not skipped); `newFunnelSteps` lists the numbers
  reached this frame (send each with `tutorialStep(n)`). Strictly increasing by construction. It stops for good at the
  first skipped step: a lesson left behind when its floor was left is never credited, and steps done after it (the
  stairwell, the draft, the boss) do not move the funnel past it.
- `strings.ts`: `TUTORIAL_STRINGS` (objective card, panel, outro, pause, verdict) and `tutorialStringKeys()`, checked
  against the placeholder pack by `hud.spec.ts` and `tutorial.spec.ts`.
- Bot: `shared/run/testing` `playTutorial(options)` plays the world through `LiveRun` and the director (in tour order,
  or `order` / `flaskAfter` for an out-of-order run; `bossDebugEvery` presses J, unused by the spec). It walks straight
  only along a clear line in the same room (three parallel lines of sight a player radius apart), else the tile-grid
  BFS field (round solid pillars, through corridors), and shoots the bow only with a line of sight. After combat A / B
  it walks over any boost drop lying on the floor (docs/BOOSTS.md B9: it takes combat B's Fury 6 ticks after it lands;
  with Fury the sniper lesson is shorter). Bot time with boosts: **70.8 s** (4246 ticks; 71.4 s / 4283 ticks before
  B9 on the same build), out of order 78.2 s (78.0 s). With `boost` as a step (2026-10-26) the bot times are
  unchanged (the director never drives the sim, and the route is the same): in order 4246 ticks (70.8 s; `boost` done
  @491, current 6 frames, marker on the drop every one), out of order 4690 ticks (78.2 s; `boost` @1084, 7 frames),
  guide-steered 4292 ticks (71.5 s; 8 frames); both bot runs report the funnel 1..16 in order.
  With `map` as a step (2026-11-01) the ticks are unchanged and the runs report 1..17; option `map` (`current` /
  `early` / `never` / `unavailable`) picks when the bot opens the full map (docs/TUTORIAL_MAP.md §8).
  With room G (2026-11-02) the runs report 1..18 and take 82.6 s of sim (about 13 s more; room G about 11 s: 12
  pellets in 9.4 s, the sniper 1.7 s); option `pellets` (`first`: the pellets, then the sniper; `late`: the sniper until
  the sweep lock holds it, then the pellets, about 15 s) picks the order (docs/PELLETS.md PL13).
  Bot time (on `tutorial-linear`): **69.8 s** of sim (4187 ticks;
  was 151 s): floor 1 ~45 s on the chain, the Mother Mayhem fight
  **21.3 s** from engage to death at 20 % hp (was ~100 s); the out-of-order run (combat C before B, walking through B)
  76.4 s. It records the boss milestones (engage, each phase with the HUD bar's fill, death), and the director spec
  asserts the fight is <= 30 s with phases II and III. A human reads prompts and fights at well under full uptime, so
  the 4-6 min target needs T8's real timing (the walk and the boss are now much shorter).

### 4. Client (`src/client`)

| Piece | Job |
|---|---|
| `TutorialController` (new, `controllers/game/`) | Waits for `onboardingStatus` (timeout `TUTORIAL.statusTimeoutSeconds`). If not done, or `KV_Tutorial` is true, asks `SimController` to start world `tutorial` **locally** (unranked, never submitted); otherwise tells `MenuController` to run the normal join flow (the main menu). Runs the `TutorialDirector` each frame after `KV_FxTracker` and pushes `tutorial` state to Reflex. Ends the run on the floor 2 -> 3 change, fires `tutorialFinished`, shows the outro |
| `SimController` | New entry point `startTutorial()`. `submitPolicy` gets the `tutorial` reason (never sent). R is off while the tutorial is running |
| `store/tutorial.ts` (Reflex slice) | `active`, `step`, `stepCount`, `promptKey`, `highlight`, `outroOpen` |
| `ui/hud/TutorialPanel.tsx`, `ObjectiveCard.tsx`, `TutorialOutro.tsx` | Prompt card, objective card, outro. Theme strings and roles only, scaled by `useHudScale` |
| Highlight ring | A `highlight` prop on `StatusPanel` (flask pips), `WeaponPanel`, `ScorePanel`, `BossBar` |
| `TutorialMarkerController` (`controllers/render/`) | One beam/arrow on the next target, built like `RunMarkerController`. Uses theme ID `ui.marker.tutorial` (placeholder: a `uiAccent` cylinder). Its pulse follows `motionScale` |
| `TutorialArrowController` (`controllers/render/`) | The guidance arrow (docs/TUTORIAL_ARROW.md): a flat chevron beside the player pointing along the walkable path to the marker's target (shared/tutorial `TutorialGuide`), hidden in lesson rooms, near the target and when the target is on screen with a clear way. Optional theme ID `ui.arrow.tutorial` (placeholder: two `uiAccent` Neon bars). Its slide follows `motionScale` |
| `PauseOverlay` | During the tutorial: Resume / Restart tutorial / Skip tutorial (confirm) / Options. Otherwise unchanged |
| `MainMenu` | Gains a **Tutorial** entry for replays (after Lobbies) |

As built (T6; code-complete, Studio check pending; ported onto the main menu / lobbies / Leave run build of `main`):

- **Gate**: `shared/tutorial` `flow.ts` `FirstRunGate` / `firstRunChoice` (`KV_Tutorial` > the status > the timeout
  `TUTORIAL.statusTimeoutSeconds` = 6 s), answering `"tutorial"` or `"normal"`. Nothing starts and no menu shows (the
  menu shell's backdrop only: Reflex `menu.awaitingFirstRun`) until it decided. `"tutorial"`: the TutorialController
  starts it at once, **without the main menu first**. `"normal"`: MenuController (`TutorialController
  .onFirstRunDecided`) runs main's join flow unchanged: the main menu, or a solo run with `KV_SkipMenu`.
- **SimController**: `startTutorial()` (the gate, the main menu's Tutorial, Restart tutorial, Play the tutorial again;
  the old solo run is left as by Play solo), `RunContext.tutorial` (and `lobbyId` ""), `freezeTutorialRun()` (a pacer
  that freezes every frame: the finished run stays on screen with no tick and no events, the floor 3 draft is never
  shown), `shared/play` `unsubmittedReason` (`tutorial` first), R / D-pad down off in a tutorial run (`handleReset`),
  `leaveRun()` stops a tutorial run at once (unsubmitted, no forfeit), `inRunningTutorial()` (playing, not yet
  finished).
- **Render step** `RENDER_ORDER.tutorialAfterFx` (Input + 3, `KV_Tutorial`). The director is not updated while the run
  is paused (a mouse-down on a menu button must not count as Continue).
- **End**: freeze and `tutorialFinished("completed")` at once; `TUTORIAL.outroDelaySeconds` (1.5 s) later the outro
  card (only the card waits for the beat, so a leave during it still records the completion). The outro's **Start my
  first run** is exactly the main menu's **Play solo** (HudController: `MenuController.playSolo`); **Play the tutorial
  again** starts a new tutorial run.
- **Skip** (pause -> Skip tutorial -> Skip): `tutorialFinished("skipped")`, then `SimController.leaveRun()`: the run
  stops for the menu like main's Leave run, so MenuController opens the after-run menu (the lobby room while in a
  lobby, else the main menu). Any run left for the menu clears the tutorial slice (`onRunExited`).
- **Pause overlay**: `shared/view/menu` `pauseItems(coop, tutorial)`: a tutorial run shows Resume / Restart tutorial /
  Skip tutorial / Options (no Leave run: Skip is the way out; no Leaderboards); Skip uses main's confirm layout
  (`Skip the tutorial?`, Skip / Keep playing, Keep playing selected on a pad). The old pause **Tutorial** replay button
  is gone: the replay is the main menu's **Tutorial** (`tutorial.menu.open`).
- **Lobbies** (main replaced the KV_Party invites with same-server lobbies): nothing takes a running tutorial over.
  `partyRunStarted` and a one-player lobby's `lobbyRunStart` are ignored while `inRunningTutorial()` (the server
  refuses those starts anyway: §5); the in-run `Lobby invites: N` badge is hidden during a tutorial run, and invite
  toasts only show on menu screens (not on the join backdrop). A finished tutorial (on its outro) is over: a lobby
  start may take the player from there.
- **Slice** `client/store/tutorial.ts`: `active`, step index / count / done, `prompt` (id; `selectTutorialPromptKey`
  resolves it by `game.inputDevice`), `card`, `highlight`, `markerKind`, `ended`, `outroOpen`, `skipConfirmOpen`,
  `ghostHeart` (a pulse token).
- **HUD**: `TutorialPanel`, `ObjectiveCard`, `TutorialOutro`, `HighlightRing` / `GhostHeart` (`TutorialFx.tsx`), the
  `highlight` props; tunables `TUTORIAL_VIEW`. Callouts are toasts (`TUTORIAL_VIEW.calloutSeconds`, wrapped).
- **Key names follow the player's bindings** (main's Options > Controls rebinding): the prompts are templates (`{move}`,
  `{fire}`, `{alt}`, `{roll}`, `{flask}`, `{swap}`, `{ember}`, `{skill1}`, `{left}`, `{right}`, `{map}`) filled by
  `shared/view/hud` `tutorialPromptVars(device, selectBindings)` (each action's primary on the last-used device; the
  pad's move / draft stick is fixed), so a rebound key shows in every prompt and the objective card. The outro's
  leaderboard key is the bound one (`tutorialLeaderboardHint`; `Start` on a pad: the pause menu's Leaderboards). `P` /
  `Start` in the panel's pause hint are fixed keys.
- **Marker**: a `uiAccent` Neon Cylinder; `ui.marker.tutorial` is optional (`ThemePack.image` returns undefined in the
  placeholder pack, so no contract or pack change was needed).

### 5. Server: onboarding persistence (`OnboardingService`)

- Doc in a new DataStore `KV_Onboarding_v1`, key `playerDataKey(userId)`:
  `{ tutorialVersion: number, outcome: "completed" | "skipped", at: number }`. The codec lives in
  `shared/onboarding` (decode/encode/equals/empty + spec), so it reuses `PlayerDocCache` as it is.
- `tutorialDone = doc.tutorialVersion >= TUTORIAL.version`. Bump `TUTORIAL.version` after a major rewrite to re-offer
  the tutorial (it is offered, not forced: the outro has a Skip).
- Remotes (`shared/network.ts`, built in T5): server -> client `onboardingStatus({ loaded, tutorialDone })`, sent after
  the join load and in answer to `requestOnboarding()` / `tutorialFinished(outcome)`. Client -> server
  `requestOnboarding()`, `tutorialStarted()` (new funnel attempt, in-tutorial: busy for lobbies),
  `tutorialStep(step)` (the server names the step from the shared step list, T4) and `tutorialFinished("completed" | "skipped")`, all re-validated and rate-limited.
  The version constant is `ONBOARDING_TUTORIAL_VERSION` (`shared/onboarding`). Details: docs/SERVER.md
  "Onboarding (tutorial)".
- **A failed load does not force the tutorial.** The client gets `loaded: false`, gets the normal main menu, and its
  Tutorial entry still works. A veteran never gets dragged through it because of a DataStore outage.
- Trust: completion only skips a practice mode, so the server just records what the client says. There is nothing to
  replay or validate.
- Lobbies (main's same-server lobbies replaced the `KV_Party` invites this was first built for): a player whose
  tutorial is running is busy for lobbies, the same "busy" path as a member of a party run still being decided
  (`RunSessionService.busyReason` = the registry's reason or `tutorialBusyReason`): they cannot create or join a lobby
  or be invited, the host's Start is refused and a due countdown is cancelled while they are in the lobby, and
  `startLobbyRun` re-checks every member before the handoff. As built: when a party run does start, every member's
  open attempt is closed (`OnboardingService.leaveTutorial`, unlogged), and a `tutorialStarted` from a member of an
  unconcluded party run is ignored (a late message), so nobody stays busy for the rest of the session.
- Rate limits (as built): `ONBOARDING_REQUEST_RATE` (request / started), `TUTORIAL_FINISH_RATE` (`tutorialFinished`
  alone, so other traffic never drops it; over it, the attempt still closes) and `TUTORIAL_STEP_RATE`.

### 6. Telemetry

**Superseded by docs/TUTORIAL_FUNNEL.md (2026-11-01):** the `tutorial` funnel is now `TutorialAttempt` (`started` = 1,
lessons 2..18, `completed` = 19) next to a once-per-user onboarding funnel and the lesson / skip / abandon / outro /
gate / new-player events. The text below describes the original T7 build.

`tutorialStep(step)` -> `TelemetryService` -> `AnalyticsService.LogFunnelStepEvent(player, "tutorial", sessionId, step,
stepName)`, `stepName` = the step's id in `shared/tutorial` `TUTORIAL_STEPS` (1..17; `completed` is 18).
**Renumbered on 2026-10-26**: the `boost` step was inserted as step 6, so `roll` .. `finish` moved from 6..15 to 7..16
and `completed` from 16 to 17 (step ids unchanged). Funnel data recorded before that date is **not comparable past
step 5** (`hits`): compare by step name, not number, or start a fresh dashboard window from the change.
**Renumbered again on 2026-11-01**: the `map` step was inserted as step 11 (docs/TUTORIAL_MAP.md), so `relic` ..
`finish` moved from 11..16 to 12..17 and `completed` from 17 to 18 (`TutorialAttempt`: lessons 2..18, `completed` 19).
Funnel data recorded before 2026-11-01 is **not comparable past step 10** (`ember`): filter by revision `t1r2`
(`TUTORIAL_FUNNEL_REVISION` 2, step 1's field02) or compare by step name.
**Renumbered again on 2026-11-02**: the `pellets` step was inserted as step 12 (docs/PELLETS.md PL13), so `relic` ..
`finish` moved from 12..17 to 13..18 (`TutorialAttempt`: lessons 2..19, `completed` 20). Revision `t1r3`
(`TUTORIAL_FUNNEL_REVISION` 3): data before it is not comparable past step 11 (`map`).
It logs only increasing steps per attempt (each `tutorialStarted` is a new funnel session), plus `completed` as the
last step. The client reports only the leading lessons practised (§3: the funnel stops at the first skipped one), so a
player who took the stairwell early drops off at the first lesson they left behind. As built (T7), a skip is the custom event `TutorialSkipped` instead of a funnel step, because Roblox counts
every lower step as reached and a skip step would credit skippers with every lesson. This gives the drop-off per
lesson in the Creator Dashboard funnel view.

## Tasks

- [x] **T1. Sim harmless mode.** (Done, headless: `shared/sim/tutorial` + spec; every golden fixture unchanged.) `SimConfig.tutorial`, `TutorialState`, the `damagePlayer` branch, `startHalfHearts`,
  the appended hash group, the README. → Verify: `npm run verify` passes with every golden fixture unchanged. New
  specs: with `harmless`, bullets, contact hits and DEBUG_HIT leave hearts and armor alone, `playerHits` / `hurtTicks`
  / combo cut behave as in a real hit, the player never dies, and a replay hashes the same.
- [x] **T2. Tutorial world.** (Done: see §2.) Seed search script, `buildTutorialRunConfig`, `TUTORIAL_ROOMS`, the floor 2 boss,
  `registerRunWorld("tutorial")`, `TUTORIAL` tunables in `shared/config`. → Verify: the lock spec (layout digest,
  room order and types). Both floors build on client and server alike. Not in `LEADERBOARD_ELIGIBLE_WORLDS`.
- [x] **T3. (Optional) Training dummy archetype.** (Done: `dummy`, band 1 / index 7, 8 hp, `enemy.dummy` in the
  theme contract and placeholder pack; specs headless. Studio check pending: the placeholder post renders.) `dummy`: immobile, no attack, `hpMax` ~6, theme ID `enemy.dummy`
  (placeholder: a post). → Verify: an archetype spec, and that the registry and theme validation pass.
- [x] **T4. Tutorial director.** (Done: see §3.) `shared/tutorial` steps + director + `tutorial.*` strings in the placeholder pack
  (`hud.spec.ts` checks the keys). → Verify: a **tutorial bot** (`run/testing/tutorialBot.ts`, like `endlessBot`)
  plays the tutorial world headlessly. Every step completes in order, hearts never drop below the start (until the
  flask raises them), the floor 2 -> 3 change finishes it, and an out-of-order room visit still completes.
- [x] **T5. Onboarding persistence.** (Server + shared contract done; the Studio check is still to do.) `shared/onboarding` codec, `OnboardingService`, the remotes, the
  failed-load rule, busy for lobbies (first built for KV_Party invites). → Verify: codec specs headless. In Studio (API access on): a new player gets
  `tutorialDone: false`, and after finishing or skipping, rejoining gives `true`. `KV_ResetOnboarding` clears it.
- [x] **T6. Client.** (Code-complete; Studio check pending: see §4 "As built" and docs/CLIENT.md "The tutorial run".)
  `TutorialController`, the SimController changes, the Reflex slice, `TutorialPanel` /
  `ObjectiveCard` / `TutorialOutro`, HUD highlights, `TutorialMarkerController`, the pause overlay changes. →
  Verify: the Studio smoke test below.
- [x] **T7. Telemetry.** (Server side done: `TutorialFunnelTracker` + spec; the Studio check is still to do.) The funnel steps. → Verify: a spec on the step filter (only increasing, no repeats after Restart tutorial); in Studio, no
  `ANALYTICS_FAILED` warnings while playing it through.
- [ ] **T8. Playtest pass.** Time the run (target 4-6 min), tune `bossHpPercent`, prompt wording and dummy hp. Check
  the phone emulator layout and a gamepad.

Critical path: T1 -> T2 -> T4 -> T6. T5 can run alongside T2-T4.

## Studio smoke test (for T6)

1. A fresh player (or `KV_ResetOnboarding`): F5 shows a dark backdrop for a moment (no main menu), then the
   objective card on a wounded player (2 of 3 hearts). No ranked `startRun` goes out (Output).
2. Walk each room: every prompt appears on entry with the right glyphs (repeat on a gamepad; rebind e.g. Flask to G
   in Options > Controls first: the flask prompt says G), the marker leads on, and harmless hits blink and play the
   hurt sound but hearts stay put. Between rooms the floor chevron beside the player points along the corridor (round
   the snake's turns) and fades out inside a lesson room (docs/TUTORIAL_ARROW.md, Studio check).
3. Flask: F fills the hearts. Ember, guard, bow charge, roll: each one ticks its step.
4. Pedestal and shrine work as in a real run. The stairwell leads to the draft, then the floor 2 boss with
   previews and phase callouts.
5. Boss dies, step into the stairwell: the outro shows and the verdict line reads `Practice: not submitted
   (tutorial)`. "Start my first run" begins a ranked run (as the main menu's Play solo does).
6. Rejoin: the main menu shows (no tutorial). Main menu -> Tutorial replays it. Pause -> Skip tutorial -> Skip during
   a replay goes back to the main menu (the lobby room while in a lobby), as Leave run does.
7. Studio without API access: no forced tutorial, the main menu shows, its Tutorial entry still works.
8. Lobbies (Test > Clients and Servers, 2 players, Player1 fresh): while Player1 plays the tutorial, Player2's
   Invite on them answers `Finish your current run first`. Rejoin both; Player1 joins Player2's lobby, readies, goes
   back to the main menu and picks Tutorial: Player2's Start answers the same until Player1 finished or skipped, and
   no lobby run ever replaces Player1's running tutorial.
9. Map lesson: after combat F the prompt names the map key and the corner minimap rings; M opens the full map and the
   step completes (full list: docs/TUTORIAL_MAP.md "Studio check").

## Edge cases

- **Leaves mid-tutorial**: not marked done, so it starts over next join. (A floor 2 checkpoint is out of scope.)
- **R / D-pad down**: off during the tutorial. Restart lives in the pause overlay.
- **First join vs the main menu**: a first-time player never sees the main menu first; the join waits (backdrop only)
  for the gate, at most `TUTORIAL.statusTimeoutSeconds`. `KV_Tutorial = true` wins over `KV_SkipMenu`; with the
  tutorial done, `KV_SkipMenu` still starts its solo run at once.
- **Skip / outro destinations**: Skip goes where Leave run goes (the main menu, or the lobby room while in a lobby);
  the outro's Start my first run is Play solo (ranked unless a debug attribute says otherwise), from the frozen run.
- **Lobbies**: a player in a lobby can start the tutorial (main menu -> Tutorial); they stay a member, the lobby cannot
  start (busy) until they finish or skip, and nothing (a party start, a solo lobby start, an invite toast) takes the
  running tutorial over. Once it finished (the outro is up) the server no longer counts them busy, so a lobby start
  may take them from the outro.
- **Leave run**: not offered in a tutorial run (Skip is its stand-in); `SimController.leaveRun` on a tutorial run
  stops it unsubmitted (no forfeit: the run was never ranked).
- **Debug keys** (K, J, N) still work under KV_Debug. K is harmless here, and N skips a floor (that is how you test
  floor 2 quickly).
- **Reduced motion**: the marker pulse and highlight ring scale by `motionScale`. Juice settings work as normal.
- **Boss on the stairwell**: Mother Mayhem fights around the arena centre, where her stairwell opens. A player
  standing within `STAIRWELL_RADIUS` of it when she dies descends on that tick, so the `finish` prompt ("Take the
  stairwell to finish.") may never show and the outro follows the kill at once (the T4 bot, meleeing her, always does).
  Fine for the tutorial; T6 / T8 may want a short beat before the outro.
- **Co-op**: the tutorial is solo only (the builder throws for partySize > 1).
- **Touch**: the game has no touch controls yet (CLIENT.md lists keyboard/mouse and gamepad only). The prompts
  carry a touch variant key, to be filled in once touch controls exist.

## Decisions (owner, 2026-10-25; were the open questions)

1. **Flask lesson**: yes, the tutorial starts the player wounded (2 of 3 hearts, `TUTORIAL.startHalfHearts`).
2. **Training dummy**: yes, combat A uses two training dummies (T3), not low-hp swarmers.
3. **Boss in the tutorial**: yes, floor 2 is the Mother Mayhem boss floor (the full loop).
4. **Curse shrine**: yes, it is taught (lesson 10, the shrine room).
5. **Forced vs offered**: offered on the first join (before the main menu), and **Skip is available from the pause
   menu at any time** (not hidden until the first room is done).
6. **Floor 1 is linear** (owner, 2026-10-26: "each room is contiguous and has the next step in the tutorial").
   Decision log (deviation from the plan's seed-searched Forge floor; recorded here, not in CLAUDE.md): the Forge gained
   the opt-in Kaleb-Vale option `chain` (§2 "Floor 1"), chosen over a constrained seed search because a rolled Forge
   floor cannot be a chain that still has a treasure room and a shrine (treasure rooms are leaves off the critical
   path and shrines are non-critical rooms, so a path-shaped graph has neither), and over a hand-built `Dungeon`
   because the option reuses every later Forge stage, so the floor keeps the real look and every consumer works
   unchanged. With `chain` unset `tryGenerate` runs the same code in the same order (stages 1-4.2 moved into
   `rolledGraph` verbatim), so M1, endless floors and every fixture and digest are byte-identical. The seed search
   script's floor-1 mode now lists the seeds the chain works with; the old layout analysis (`analyzeTutorialLayout`)
   is gone, `checkTutorialChain` replaced it.
7. **The tutorial boss dies fast** (owner, 2026-10-26): `TUTORIAL.bossHpPercent` = 20 through the hashed
   `TutorialSimConfig` / `TutorialState.bossHpPercent` (§2 "Scaling"); no change to her cap or timers.
8. **The boost pickup is a step** (owner, 2026-10-26; reverses docs/BOOSTS.md P8): `boost`, step 6 of 16, after
   `hits` (§3). It replaces the `boost` callout; the funnel was renumbered (§6). Presentation only: no sim, hash,
   replay or world change.
9. **Blocking is a mandatory step** (owner, 2026-10-26: "add block as a step"; chosen over a separate `block` room /
   funnel step and over a new block verb): the existing `guard` step (8, combat D's bruiser) stays where it is with
   its id and funnel number, but is no longer waived when the room is cleared first. The sim makes that impossible
   instead: the bruiser cannot drop below 1 hp until the player has blocked a bullet with the sword's guard (§2
   "Guard lock", a hashed `TutorialSimConfig` field, so tutorial replays changed; no fixture did). While it waits at
   1 hp the prompt switches to `guardHold` ("It won't go down until you block one of its shots"). The prompts say
   "block"; the action name (Options "Guard / charge") and the score source ("Guard cancels") are unchanged.
10. **The map is a step** (owner, 2026-11-01; reverses the lesson half of docs/MINIMAP.md MD13): `map`, step 11 of 17,
   after `ember`; done on opening the full map (touch: the pause overlay's map), waived (not skipped) when ignored or
   unavailable. The funnel was renumbered (§6). Tutorial script, HUD and telemetry only. Plan, as-built notes and
   decisions: docs/TUTORIAL_MAP.md.
11. **A pellet lesson, combat G** (owner, 2026-11-02; docs/PELLETS.md PD13-PD15): a new room after combat F with one
   sniper over a ring of pellets, step `pellets` (12 of 18), held by a sweep lock (the sniper stays at 1 hp until the
   last pellet) so every new player sees a Sweep. Room ids 7-10 (G, treasure, shrine, stairwell), floor-1 seed 7574,
   funnel revision 3. No power pellet in the tutorial (PD16).
