# Rollback spike (measure before building)

Co-op rollback would draw the whole world ahead of the server: every frame, copy the confirmed state, step it forward
over the inputs not confirmed yet (your own known, teammates' guessed), draw the copy, and redo it when the server's
frames arrive. This spike does **not** build that. It answers, with numbers, whether it is worth building:

- **Q1. CPU.** Can a phone copy the state and step it H ticks every rendered frame, inside a frame's budget?
- **Q2. Mispredictions.** With real co-op inputs, how often and how far would the drawn world visibly correct itself
  (enemies jumping, kills undone, bullets appearing and vanishing, teammates pulled back)?
- **Q3. Client cost (paper).** How much of the client would have to change (the state copy, every per-tick event feed)?

The answer is compared with the cheaper plan, docs/LOCAL_PREDICTION.md (your knight and your attacks' looks predicted,
bullets drawn ahead exactly), which the same harness measures for free.

**Spike only.** No sim, dungeon, hash, replay, fixture, score, lockstep wire or server-validation change. Everything runs
in specs or behind debug switches that are off by default and cleaned up with Janitor (`KV_RollbackSpike` on the
client, `KV_RollbackCapture` on the server). Nothing predicted ever reaches the sim, a hash or a recording; only debug
summaries reach a debug remote. The device work runs **off the main thread** (Parallel Luau) by default, so a test does
not freeze the game; a serial mode exists only as the comparison. All measuring and logging is Roblox-side
(MicroProfiler, Developer Console, server log, a DataStore read from Studio, AnalyticsService); Open Cloud is a
fallback only.

## Status (2026-11-09)

**Built headlessly** on branch `rollback-spike` (@ `6569ef9`, from `main` @ `3f7ce65`, which has the measured lead,
`frame-pacing-lead`, merged). The plan was written against `main` @ `49a74856` after the discussion of local
prediction vs rollback (2026-11-09); revision 2 (same day, owner): the device work off the main thread (Parallel Luau,
a worker that mirrors the run), Roblox-side measuring and logging instead of Open Cloud, and live metrics on the
players' devices (Design 5-7, R3a, R4b). Revision 3 (same day): as built ("As built" below), task R1b (the pooled copy)
added, the headless results filled in. Revision 4 (same day): an independent review's fixes (branch `rs-fixes`): the
probe intake gated on the capture policy and budgeted (rows once a minute per player, bounded analytics), captures
encoded block by block off the lockstep step, erasure tags, the live model at H, live windows' prediction counts, the
spike out of the `shared/lockstep` barrel, the generic copy renamed `cloneForRollback` ("As built"). Merged into `main`
(2026-11-09, `e298301`, fast-forwarded to `ce1d207`) on top of the Archer: the spike now carries the run's characters
("Merged into main with the Archer"); full Lune suite on the merge: 467 spec files, the only failures the known x86
`forge.spec` vector and the three spikes specs fixed in `ce1d207` (re-run green).

| Part | State |
|---|---|
| R0 census, R1 generic copy, R1b pooled copy, R2 model / metrics / bot sweep | Done, verified headlessly (Lune specs) |
| R3a facts, R3 CPU probe, R4 capture / plugin / receiver, R4b live metrics | Built, compiled, pure cores spec'd headlessly. **Studio check pending** (the Actor, the remote, DataStores, the plugin, AnalyticsService need the engine): "Studio and device checklist" below |
| R5 devices and playtest, R6 report, R7 cleanup | Not started (owner) |

Nothing under `src/shared/sim/**`, `src/shared/dungeon/**` or `fixtures/` changed, nor the lockstep wire, session, log,
validator, hashes, replays or scores (checked with `git diff` against `3f7ce65`). Every runtime part is off by default.

Headless answers so far (Lune, no native code, bots; device numbers decide):
- **Q1.** The realistic per-frame cost (pooled copy + 15 steps + bookkeeping) is about 4.4-5.0 ms in a 3-player bot
  run; the generic copy alone is 21-41 ms (an upper bound nobody would ship).
- **Q2.** Even with bots (who under-state wrong guesses), at today's lead (L 11, D 4, `repeatLast`) teammate
  corrections >= 1 tile come about 62 a minute against a proposed gate of 6, and undone kills 4.5 a minute against 1
  (3 kills in 40 s of play: a small sample). Enemy corrections (1.5) and phantom bullets (7.5) pass. Human numbers
  (R4b live metrics, R5 captures) decide.
- **Q3.** On paper (R0 census): a real rollback would rework about 44 client files and 30 shared classes.

## What is known (findings)

| Fact | Where | Consequence |
|---|---|---|
| One sim tick costs 0.19-0.21 ms (solo, one room), 0.54-0.60 ms (8 players, one room), 0.72-1.17 ms (whole floor entered), headless under Lune without Luau fast paths or native codegen | docs/SERVER.md "Replay capacity", `run/replay.bench.spec.ts`, `sim/bench.spec.ts` | Rollback at 16 ticks a frame: ~3-19 ms headless. A pessimistic host; the device number is unknown (Q1) |
| No usable state copy exists (sim/state.ts `cloneSimState` throws once any bullet was spawned: R0). `SimState` is a core (tick, rng, player, events, combat with its `BulletSimulation`) plus ~15 optional subsystems (endless, score, run, party, tutorial, breakables, drops, affixes, dev, builds, pellets, treasure, pacts, golden) | sim/state.ts, sim/hashLayout.ts | The spike needs a copy; R0 lists what is mutable, shared and transient |
| `step` / `stepParty` clear every subsystem's events at the start of each tick; views collect them per stepped tick (`RunView` collectors: room clears, combo, near miss, recap tally, build fx, ...) | sim/step.ts, shared/view/fx | Under rollback every feed can show an event, lose it in a re-run, or show it twice (Q3) |
| Ahead of the confirmed tick T: frames through T + D are already in the playout buffer (truth for everyone), your own inputs are known through T + D + L, teammates' are guessed for L ticks | lockstep/client.ts, pacer.ts | The guessed span is the net lead L, not the whole horizon. Measured on the spec networks: L 11-12 (20-120 ms one way), 15-17 (0-200 ms); D 3-5 (docs/FRAME_PACING.md) |
| No human co-op inputs are kept. The server replays and validates a run's segments and discards them | server RunSessionService, run/segments.ts | Human inputs must be captured for Q2 (R4) |
| The bots' aim follows their movement and their presses are scripted (`partyBot`: walks, swings at the nearest enemy, fights the boss; replay.bench's fighter: strafes, rolls, aims, never kills) | run/testing | Bots under-state how often a guess is wrong (a mouse moves the aim almost every tick). Good for building and sanity, not for the answer |
| A bullet in flight is ballistic: velocity += acceleration, position += velocity, life counts down; only a hit, a guard / erase or a wall / piece removes it | combat/bullets.ts `step` | The cheap plan's bullets-ahead are exact until removed; the harness can measure their error beside rollback's |

## Census (R0)

Read from the code on `rs-census` (= `main` + this plan). Paths are under `src/shared/` unless they start with
`client/`. "Copy" = mutable per tick, deep-copied; "share" = immutable data the state only points at
(`SHARED_BY_REFERENCE`); "scratch" = module-level, outside the state.

### (a) The copy surface

**An existing copy.** `sim/state.ts:492` already exports `cloneSimState` (hand-written per subsystem), but
`cloneCombatState` (`sim/combat/combat.ts:250`) throws once either bullet pool has ever spawned a bullet (it rebuilds
pristine pools by re-stepping them). It is used only by specs (`sim/combat.spec.ts`, `sim/builds/builds.spec.ts`). The
spike's copy must therefore be new, and must not be called `cloneSimState`: that name is exported through the
`shared/sim` barrel (`sim/index.ts:33`). Suggested (and built): `cloneForRollback` in `lockstep/rollbackSpike/clone.ts`.

**SimState and every object it reaches** (`sim/state.ts:259-343`; created in `createSimState`, `:375`):

| Field | Holds | Kind | Notes |
|---|---|---|---|
| `tick`, `rngState` | numbers | copy | |
| `player` | `PlayerState` (`state.ts:47`), numbers | copy | ALIASED: `party.players[0] === state.player` (`sim/party.ts:84`) |
| `events` | `SimEvents` (`state.ts:92`), 28 numbers | copy | per-tick feed, cleared by `clearEvents` at step start |
| `combat` | `CombatState` (`combat.ts:125`) | copy | numbers + the objects below |
| `combat.enemyBullets`, `.playerBullets` | `SimulationCore` class instances (`combat/bullets.ts:210`) | copy, keep metatable | the only class instances in the state. Fields: `pos` / `vel` / `acc` = arrays of `{x,y,z}` tables (one per slot), number arrays `delay` / `life` / `payload` / `emitter` / `scale` / `color` / `prev` (3 per slot) / `dense` / `slotToDense` / `free`, scalars `freeTop` / `highWaterMark` / `nextEmitterId` / `activeCount` / `stepCount`, readonly `capacity` / `boundsLimit` / `interpolation` / `fadeTime`, `onPoolExhausted` (a function field, always undefined from `createSims`, `combat.ts:169`). Capacities are fixed: 2048 enemy + 512 player slots (`combatData.ts:39,41`), so a generic copy copies 7,680 small vector tables and ~25 k array entries every time, whatever is alive |
| `combat.actors` | `ActorState[]` (`combat/actors/types.ts`), numbers + `v[8]` + `capWindow` | copy | up to `MAX_ACTORS` 64 (`combatData.ts:57`); kind / weapon are registry indices, no def references |
| `combat.weapons` | `WeaponsState` (`combat/weapons/types.ts`), `sets[].v` | copy | ALIASED: `party.weapons[0] === state.combat.weapons` (`party.ts:85`) |
| `endless` | `EndlessState` (`sim/endless.ts:179`), numbers + `roomsEntered[]` | copy | the floor world is NOT in the state: `config.endless.worldForFloor(floor)` every tick (`endless.ts:238`) |
| `score` | `ScoreState` (`score/score.ts:242`): totals, `points[]`, `counts[]`, `rooms: RoomScore[]` (bounds, member slots / ids), `events: ScoreEvents` (23 parallel arrays + scalars, `:183`) | copy | |
| `run` | `RunState` (`progression/runMods.ts:163`): `players[]` (boons, relics, curses, draft offers, `mods: RunMods`, `events`), pedestals, shrine, `events` | copy | `mods` is a derived plain object (`computeRunMods`, `runMods.ts:280`); a deep copy keeps it exact, no refresh needed |
| `party` | `PartyState` (`party.ts:47`): `players[]`, `weapons[]`, `left[]` | copy | the two aliases above; a memoized copy keeps them aliased |
| `tutorial` | `TutorialState` (`tutorial/tutorial.ts:97`), numbers | copy | solo only |
| `breakables` | `BreakablesState` (`breakables/breakables.ts:104`): `pieces[]`, `slotByCell: Map` (`:110`, derived index), `intact`, `hitSlots` / `brokenSlots` (feed) | copy; `config` share | `slotByCell` is also the movers' `solid` argument (`breakables/cells.ts:14`) |
| `drops` | `DropsState` (`drops/drops.ts:233`): own `rngState`, `ground[]` (each with `spawnTick`), `guards[]`, `players[]`, `pieceLoot[]`, `events` (8 lists) | copy; `config` share | `DropsConfig` holds a `Map` (`chanceByArchetype`) |
| `affixes` | `AffixesState` (`affixes/affixes.ts:92`): `slots[]` (by actor slot + `actorId`), `events` (5 lists) | copy; `config` share | |
| `dev` | `DevState` (`dev/dev.ts:25`), 3 numbers | copy | not in co-op worlds |
| `builds` | `BuildsState` (`builds/builds.ts:509`): `players[]` (levels, duos, counters), `procs[]`, `pins[]`, `waves[]` (with `hits[]`), `stillCombo` / `stillTick`, `events: BuildEvents` (~90 parallel arrays + 2 scalars, `:176`, list `BUILD_EVENT_LISTS` `:383`) | copy; `config` share | the largest feed; referenced actors by slot + id only |
| `pellets` | `PelletsState` (`pellets/pellets.ts:113`): `x` / `z` / `rec` / `taken`, `rooms[]`, `byCell: Map` (`:126`), `events` | copy; `config` share | |
| `treasure` | `TreasureState` (`treasure/treasure.ts:79`): own `rngState`, vault numbers, `bonusDeals[]`, `events` | copy; `config` share | |
| `pacts` | `PactsState` (`pacts/pacts.ts:109`): altars, `players[]`, `horde` (wave kinds / x / z), `taken[]`, `events` | copy; `config` share | |
| `golden` | `GoldenState` (`golden/golden.ts:136`): own `rngState`, status numbers, `src[]`, `floor`, `cache`, `events` | copy; `config`, `floor` share | `floor` (`:166`) is the world's `FloorGolden`; `cache` (`GoldenFieldCache`, `:123`: `floor` again, `open[]`, `field[]`, `scratch: FleeScratch` from `dungeon/golden.ts:140`) is a derived flee-field cache inside the state, keyed by `fieldTick` / floor identity / intact count (`golden/goldenField.ts:56`). Copy it (resetting it forces a whole flee-field rebuild in every prediction) |

**`SHARED_BY_REFERENCE`** (the only references from the state to data it does not own): the eight subsystem `config`
fields (`breakables`, `drops`, `affixes`, `builds`, `pellets`, `treasure`, `pacts`, `golden`: the run's `SimConfig`
parts, most of them `table.freeze`d constants, `BUILDS_CONFIG` / `AFFIXES_CONFIG` plain rule tables) and
`golden.floor` / `golden.cache.floor` (a `FloorGolden` of the cached floor world). Nothing else: the state holds no
reference to the `SimConfig`, the dungeon, the floor world, arc tables or def registries (those are read through
`config` / module registries at step time). The state holds **no buffers**, **no functions** (bar the undefined
`onPoolExhausted`), and **no cycles**. Shared references inside the state: only the two party aliases and the golden
`floor` pair. Copying an alias twice would desync silently (player 0 stepped through one object, hashed through the
other), so the copy's memo is required, not optional.

**Module-level scratch that `step` / `stepParty` reach:**

| Scratch | Where | Carries state between ticks? |
|---|---|---|
| `soloInputs`, `soloPrev`, `partyPrev` | `sim/step.ts:240-242` | No: rewritten at the start of every step (`:288-289`, `:384`) |
| `SimCtx` instances (`state`, `player`, `weapons`, ... and the transient `auraMask` / `pinMask` Maps keyed by `ActorState`, `procGen`, `procCause`, `killCarry`) | `combat/ctx.ts:41` (`:89`, `:95`); instances `combat/combat.ts:225`, `endless.ts:243`, `golden/stepGolden.ts:27`, `pacts/stepPacts.ts:74` | No: `bind` (`ctx.ts:97`) rebinds and clears every call; masks rebuilt at the start of `stepActors` (`rebuildAura` / `rebuildPins`, `:120`, `:125`). They keep a pointer to the last bound state until the next call (GC only) |
| collision flags `hitBlocked`, `hitPieces`, `grazeOn`, `grazeR2`, `buildsOn`, `ballistaOn`, `phantom[]`, `bastionRolling[]` | `combat/combat.ts:318-356` | No: set and reset inside `stepCombat` (`:644-673`) |
| builds scratch (Ricochet, duo sparks, Chain Reaction crosses, embers, effect budget `session`, volley targets, Riposte returns, Ballista bursts) | `builds/evolutions.ts:130-202`, `builds/duos.ts:174-442`, `builds/effects.ts:44-48`, `builds/riposte.ts:137`, `builds/ballista.ts:61-69` | No: empty at the end of a normal tick; `resetBuildScratch` (`builds/procs.ts:183-201`) also clears it whenever `stepCombat` is bound to a different state, i.e. every tick when two states alternate (cheap) |
| burst limit | `combat/patterns.ts:250` `resetBurstLimit` | No: reset first in every `stepCombat` |
| arc, melee and pellet sinks `arcCtx` / `arcSink`, `finisherFirst`, `sinkX` / `sinkZ`, `near` | `combat/weapons/melee.ts:29,41`, `weapons/defs/sword.ts:163`, `pellets/stepPellets.ts:36-40` | No: set and cleared around one call |
| small vector scratch (`dirScratch`, `turned`, `gapScratch`, `toPlayerScratch`, `packScratch`, `origin`, `cut`, `gooScratch`, slide `hit` / `pushed` / `slipped`, `nudged`) | archetypes, `combat/patterns.ts:83-143`, `combat/actors/helpers.ts:29`, `dungeon/slide.ts:65-206`, `dungeon/collision.ts:162` | No: written before every read |
| spawn-data pool `spawnPool` / `pooled` | `combat/bullets.ts:142-143` | No effect on values: every field is reset on reuse (`:146`) |
| memo caches: arc shapes `fullRings` / `cones` / `single`, bow `arrowSource` / `arrowLife`, the Wrecker hook `rollSmasher`, archetype / weapon registries | `combat/projectilePatterns.ts:35-39`, `builds/duos.ts:124-126`, `builds/wrecker.ts:28`, `actors/registry.ts:51-53`, `weapons/registry.ts:13-15` | Immutable once built (pure functions of constants): safe to share by any number of states |
| the endless floor cache: `floorCache` closure (last-floor memo + LRU of `ENDLESS_FLOOR_CACHE_SIZE` 3 floors) and the dungeon LRU (8) | `run/endless.ts:183-210`, `run/endless.ts:69-70`, `run/limits.ts:74,80` | Pure in (seed, floor): correct for any interleaving. Two states on floors n and n + 1 alternate inside the LRU with no regeneration. Cost: a prediction that crosses a floor change generates floor n + 1 (the Forge) inside the predicted step unless it was pre-generated (the main client pre-generates it during the draft; the worker mirror does not) |
| process-wide tuning setters (`setSwordTimings`, `setSwarmerHp`, `setBossHp`, `setBowTuning`, `setPlayerMover` / `run/playerMover.ts:20`) | | Constant during a run; the worker VM must keep the defaults (never the web parity values) or its mirror drifts |

**No module scratch carries state from one tick to the next.** Everything is either rebuilt per step, reset on a
state change, or an immutable memo, so stepping the confirmed state and a clone alternately in one VM (the headless
model) is safe. The only derived cache that does carry is inside the state (`golden.cache`) and is copied with it.

### (b) The event feeds

Sim feeds cleared at the start of every `step` / `stepParty` (`sim/step.ts:290-308`, `:385-401`): `state.events`
(`clearEvents`), `score.events`, `breakables.hitSlots` / `brokenSlots`, `drops.events`, `affixes.events`,
`builds.events`, `pellets.events`, `treasure.events`, `pacts.events`, `golden.events`, `run.events` and every
`run.players[i].events` (`clearRunEvents`). Not cleared but diffed by views: `combat.enemySpawned` /
`playerSpawned` (run totals). Collected after every stepped tick by `LiveRun` (`play/liveRun.ts:472-495`) and
`LockstepClient.pump` (`lockstep/client.ts:533-556`) into the `RunView` (`play/liveRun.ts:162`):

| RunView field / collector | Sim source | Client consumers | Under rollback |
|---|---|---|---|
| `frameEvents` (`accumulateEvents`, `liveRun.ts:227`) | `state.events` | AudioController, FxSpriteController, DecorController; SimController (solo segment cut on `floorChanged`, `SimController.ts:1523`); TutorialController (solo, funnel) | presentation (dedup); segment cut and tutorial funnel stay confirmed (solo only anyway) |
| `scorePops` | `score.events.pop*` | ScorePopController | presentation (dedup) |
| `runEvents` (`collectRunEvents`, `liveRun.ts:143`) | `run.events`, `run.players[i].events` | SimController `pushToasts` (`:1678`), DraftRevealController | toasts: presentation; the draft opening / confirm gate must stay confirmed (it gates input) |
| `boostEvents` (`BoostFrameEvents`, `view/boosts/events.ts:63`) | `drops.events` | AudioController, BoostDropRenderController | presentation (dedup) |
| `roomClears` (`RoomClearEvents`, `view/fx/roomClears.ts:102`) | diff of `score` totals / rooms, pellets, horde | RoomClearController (solo slow motion, co-op hold), TeamMomentsController | presentation; the collector itself keeps previous totals (`prevTotal`, `prevCleared[]`, ...): fed a re-run it double-counts, so it needs a confirmed copy or a snapshot / restore |
| `combo` (`ComboEvents`, `view/fx/comboEvents.ts:80`) | `score` combo, `comboCut` / `comboFed` | ComboController, AudioController | presentation; stateful (`lastCombo`, `streakPeak`) |
| `nearMiss` (`NearMissEvents`, `view/fx/nearMissEvents.ts:68`) | `score.events.graze*` / `guard*` | NearMissController (its director feeds ParticleController, ParryFlashController, AudioController, SyncCalloutController, TeamMomentsController) | presentation (dedup) |
| `variantCues` (`VariantCueEvents`, `view/fx/variantCueEvents.ts:123`) | actor slot transitions, `affixes.events`, `events.strikes` | AudioController | presentation; stateful per actor slot AND keyed on state identity (`:182`: a different state object reads as "fresh", so a clone gets no transitions) |
| `builds` (`BuildFxEvents`, `view/fx/buildFxEvents.ts:342`) | `builds.events` | BuildFxController, CounterWaveController, HappyHourController, HeartBeamController, OvercapPopController, SiegeFxController, WreckerFxController, ScorePopController, AudioController | presentation (dedup) |
| `pellets` (`PelletFrameEvents`, `view/pellets/events.ts:49`) | `pellets.events` | PelletRenderController, ScorePopController, FxSpriteController, AudioController | presentation (dedup) |
| `recapTally` (`RecapTally`, `view/fx/recapTally.ts:77`, run-long) | score events per player, pickups, deaths | RecapController (run-over recap, contribution tabs, the `runRecap` remote) | must stay confirmed |
| `treasure` (`TreasureFrameEvents`, `view/treasure/events.ts:80`) | `treasure.events` | TreasureRenderController, TreasureToastController, AudioController | presentation (dedup) |
| `pacts` (`PactFrameEvents`, `view/pacts/events.ts:37`) | `pacts.events` | PactRenderController, AudioController | presentation (dedup); the Greed deal is a draft (confirmed) |
| `golden` (`GoldenFrameEvents`, `view/golden/events.ts:69`) | `golden.events` | GoldenRenderController, BoostDropRenderController, ScorePopController, AudioController | presentation (dedup) |

Inside `LockstepClient` and on the confirmed state only: `RunTelemetry.observe` (`run/telemetry.ts:147`, the final
claim's summary), the `kills` / `hitsTaken` counters (`client.ts:536-537`), the hash reports every `hashEvery` ticks,
`isPartyWiped` and `finalClaim` (sent to the server). In the client, also confirmed-only: SightingController (first
sightings -> remote `bestiarySeen`), SimController's spectate choice (`SpectateTracker`, deaths) and draft gate,
RecapController, and NewBestController's records baseline (its NEW BEST shout is presentation but must not fire on an
undone score).

Besides the feeds, 17 view-side **state differs** compare the drawn state frame to frame and would turn a
correction into a fake event (an undone kill reads as a respawn): `HitTracker` (`view/fx/tracker.ts`, via
FxTrackerController -> HealthBarController, DamageNumberController, ParticleController, FreezeFrameController,
AudioController), `StateWatch` (`view/watch.ts`: HurtFlashController, FreezeFrameController, RoomClearController),
the audio cue mapper's `lastEnemySpawned` (`view/audio/cues.ts:1813`), and the render trackers (`BlinkWatch`,
`DetonationWatch`, `ShieldFlashWatch`, `RollEdgeWatch`, `DropSlotTracker`, `BreakableTracker`, `PelletViewTracker`,
`TreasureViewTracker`, `PedestalChestTracker`, `ScorchTracker`, `VaultToastTracker`, `TreasureCueTracker`,
`DailyRankTracker`, `NewBestTracker`). The bullet renderers draw by pool slot index.

**Count.** A real rollback would touch about **44 client files**: all 26 controllers in `client/controllers/fx/`,
AudioController, 12 render files (Actor, BoostDrop, Breakable, Decor, Golden,
Pact, Pellet, Treasure, RunMarker render controllers, HazardSpritePool, motionFx, BulletRenderController's slot
mapping), TreasureToastController, and SimController / StageController / TutorialController / SightingController in
`game/`; plus about 30 shared classes (the 11 collectors in the table, `LiveRun`, `LockstepClient`, the 17 trackers and
watches above). Of the 14 RunView feeds, 11 are pure presentation (dedup), 1 is run-long confirmed (`recapTally`), 1 mixes
(`runEvents`: toasts vs the draft gate), and `frameEvents` is presentation in co-op.

### (c) Bullet identity

No bullet carries a spawn tick or a serial id. Per slot the pool keeps position, velocity, acceleration, delay (always
0), life, payload, emitter, scale and colour (`combat/bullets.ts:220-230`); the payload packs `damage` 6, `kind` 4,
`source` 8 (enemy: archetype index + 1; player: weapon index + 1, build effects from 128), `pierce` 3, `lastHit` 7
(player bullets: last actor slot + 1; enemy bullets: Bastion's brace mark) (`combat/payload.ts:5-29`). What is usable:

- **Slot index**: not stable across two predictions. Slots come from a LIFO free stack (`acquireSlot`, `:282`): the
  most recently released slot is reused first, so one extra or missing release before a burst shifts every slot of
  that burst; `dense` order changes by swap-remove.
- **Emitter id**: enemy bullets carry their actor's emitter id, unique per actor for the run (`acquireEmitter` is
  monotonic, `releaseEmitter` never lowers it; `actors.ts:167`); the stress emitter has its own. Player bullets carry
  their player's id (index + 1, `party.ts` `playerBulletOwner`), shared by all of that player's bullets.
- **Life**: counts down by the pool's dt from the pattern's spawn life; enemy bullets step by `SIM_DT x` the
  Hourglass scale (`combat.ts:637-638`), so `(life0 - life) / SIM_DT` gives the age exactly only without the Hourglass.
- **Actors** do have identity: `ActorState.id` (serial, unique for the run) and `spawnTick`; ground drops have
  `spawnTick`.

So the model's digest identifies a bullet by **(emitter, payload, then position continuity)**: same emitter and payload
within the distance one tick can move (speed x SIM_DT) of the bullet's ballistic position; "first appears far along
its path" is read from `life` against the pattern's spawn life (an age > 1 tick at first sight). An exact
alternative for the harness only: tag bullets in the spike by reading the pool after each step (a new `dense` entry =
a spawn this tick), keeping a side table slot -> (spawn tick, emitter) per predicted run; no sim change.

### (d) For the R2 harness and the client mirror

| Need | Function | Where |
|---|---|---|
| Build a party run's config | `buildEndlessRunConfig(seed, partySize)` -> `EndlessRunSetup { config, spawn, dungeon, endlessFloor }`; or `buildWorldSetup(worldKind, seed, { atBossDoor: false, partySize })`, what `startCoop` uses | `run/endless.ts`, `run/worlds.ts:82`; `client/controllers/game/SimController.ts:1002` |
| Fresh state | `createSimState(seed, spawn.x, spawn.z, setup.config)` | `sim/state.ts:375` (the LockstepClient constructor does the same, `client.ts:259`) |
| A recorded bot run | `recordPartyRun(seed, n, { walkTicks?, boss? })` -> `RecordedPartyRun { setup, drv, recording, finalHash, log }`; a custom bot drives `PartyDriver` (`tick(frames)` = `Recorder.recordParty` + `stepParty`) | `run/testing/partyBot.ts:335`, `:64`, `:94` |
| The recording | `Recording { seed, spawn, frames, others? }` (player 0 in `frames`, player k in `others[k - 1]`); `Recorder.recordParty(frames)` | `sim/replay.ts:35`, `:92`, `:110` |
| Per-tick merged frames | `partyFrameAt(recording, t, out)` (player index order, writes `out`: copy it if kept); `stepRecorded(state, recording, t, config)` | `sim/replay.ts:54`, `:80` |
| Step | `stepParty(state, inputs, config)` (inputs.size() must equal the party size; a solo state goes to `step`) | `sim/step.ts:372` |
| Whole replay / hash | `runReplay(recording, config, ticks?)`, `hashState(state)` | `sim/replay.ts:153`, `:239` |
| Codec (captures) | `encodeRecording` / `decodeRecording(buf, limits)` (party = version 2); the server's `PartyRunLog.slice` / `encodeSlice` | `sim/recordingCodec.ts:199`, `:427`; `lockstep/log.ts` |

`replay.bench.spec.ts`'s cases (`bench`, `:117`) are not recordings: they debug-skip to floor 15, then mutate the
state directly (Depth set to 3, players teleported, `dismissDraft` from `run/testing/endlessBot.ts:135`, hearts topped
up). The harness can reuse that setup only by taking the prepared state as the confirmed state and generating the
`fighter` frames in-process. `recordPartyRun` uses `DEBUG_FLOOR_BUTTON` skips and resolves drafts by input, so its
recording replays to `finalHash`. Draft ticks freeze the world (`stepParty` steps only the draft, `step.ts:402`): the
model should count them apart. The lockstep harness's `Channel` / `Net` are private classes inside
`lockstep/lockstep.spec.ts` (`:262`, `:464`), not exported.

**LockstepClient's buffers** (`lockstep/client.ts`, all private but `state`): the playout buffer is
`queue: InputFrame[][]` read from `queueHead` (`:188-189`; `backlog()` = queued, not stepped = D; `received` ticks so
far), filled by `receive` (`:407`), stepped by `pump` (`:463`, `stepParty` at `:533`), compacted by `compact`
(`:688`). The local inputs already sent ahead are `sent: Map<number, InputFrame>` (`:194`, keyed by target tick,
deleted when that tick is stepped in `checkDeadline`, `:647`) through `lastSentTick` (`:193`), plus `latched` buttons
(`:219`) not sent yet; `inputLead()` / `netLead()` / `nextInputTick()` give L. A worker mirror or live model needs
read-only accessors for the queued frames and `sent` (a client-side spike addition, no wire change).

### What this means for R1 / R2 / R3

**R1.** A generic memoized deep copy works: one class (`SimulationCore`, keep its metatable), no buffers, no closures,
no cycles; `SHARED_BY_REFERENCE` = the eight subsystem `config` objects plus `golden.floor` (and the same object at
`golden.cache.floor`). The memo is mandatory for the two party aliases. Name it `cloneForRollback` (not
`cloneSimState`). Expect the bullet pools to dominate the clone time (2,560 fixed slots copied whatever is alive); if
the upper bound is too high to read, a pool-aware copy of only live slots plus the free stack is exact, because
`fireAt` rewrites every field of a slot it acquires (`bullets.ts:309-350`). **R2.** Stepping the confirmed state and
a clone alternately in one Lune VM is safe: no module scratch carries between ticks (builds scratch resets itself on a
state change). Use `recordPartyRun` + `partyFrameAt` + `stepParty`; identify bullets by emitter + payload + position
continuity (or a spike-side spawn table); actors by id. A prediction across a floor change may generate a floor
inside the timed step: keep it out of the per-tick cost or note it. **R3.** The worker builds its config with
`buildWorldSetup(worldKind, seed, { atBossDoor: false, partySize })` and the default tunings; every collector in the
table is presentation except `recapTally`, telemetry, hashes, sightings, spectate and drafts, so the probe touches none
of them. A real rollback would rework about 44 client files and 30 shared classes, chiefly because the collectors and
state differs keep cross-tick memory.

## Design

### 1. State copy (spike-grade, `shared/lockstep/rollbackSpike/clone.ts` and `pooledCopy.ts`)

Two copies, both in `shared/lockstep` (the sim is not touched), both exact (the copy hashes like the source and,
stepped with the same inputs, stays equal; the source is never written):

- **Generic** `cloneForRollback(state)` (clone.ts, R1): a deep copy. Recursive over tables with a memo (a reference
  shared inside the state stays shared in the copy), metatables kept by reference (class instances such as
  `BulletSimulation` stay instances), buffers copied, `table.clone` per table so `pairs` order matches. Immutable data
  the state only points at (R0's list `SHARED_BY_REFERENCE`) is shared, not copied. It copies every table every time,
  the 2,560 bullet slots' vectors included: the **upper bound**.
- **Pooled** `PooledStateCopier.copyInto(src)` (pooledCopy.ts, R1b): copies INTO a scratch state the copier keeps and
  reuses. Bullet pools copy only the live slots and the bookkeeping (dead slots are never read by the sim nor hashed:
  `fireAt` rewrites a slot it takes, `writeStateHash` reads only slots with `slotToDense >= 0`), records and dense
  arrays are written in place, Maps re-cloned. Steady state allocates 2 tables a copy. This is how a real rollback
  would copy (into preallocated pools): the **realistic cost**. The model (R2) and the device probe (R3) use it.

So the generic clone time is an upper bound, the pooled copy time is the realistic cost, and the **step time is the
floor** of what rollback costs.

### 2. The prediction model (headless, `rollbackSpike/model.ts`)

Replays a recorded co-op run as one client sees it, for every player index i in turn:

- Step the real (confirmed) state through the log, one tick at a time, as the client does.
- At each tick T (a client frame; the harness models 60 Hz paced play, one tick a frame): clone, then step the copy to
  the drawn tick `T + D + L` (capped at H) with: the log's frames through T + D (truth), player i's own frames from the
  log (known), every teammate's input **guessed** for the ticks after T + D.
- Guess strategies: `repeatLast` (GGPO's default, the baseline), `repeatLastAxesOnly` (held axes and aim kept, buttons
  released), `neutral`. A held button repeats as held, so a guess never invents a new press (`prevButtons` edges).
- The network is a fixed (L, D) per pass, swept: L in {6, 11, 16, 25}, D in {0, 4}. (With rollback the playout buffer
  might go away, which is D = 0: the sweep covers it.)
- Per predicted tick a compact **view digest** is kept, not the state: per actor slot (kind, alive, x, z, hp), per
  bullet slot (alive, x, z, kind; identity from slot + spawn tick, or position continuity if the payload carries no
  spawn tick: R0 confirms), per player (x, z, hearts, dead), and the tick's events (kills, pickups, hits on players,
  erased bullets).

Nothing here is a production predictor: no smoothing, no rendering, no event dedup.

### 3. Metrics (`rollbackSpike/metrics.ts`)

All per minute of play, per player, split by room type (combat / boss / walking) and by (L, D, strategy):

| Metric | Definition | What the player would see |
|---|---|---|
| Correction | The same drawn tick predicted on two consecutive frames: per entity, the position change. Buckets >= 0.1 / 0.25 / 0.5 / 1.0 tiles | Enemies / teammates jumping (small ones a smoother hides) |
| Truth error | The prediction for tick K vs the confirmed state at K | How wrong the drawn world was |
| Undone event | A kill, death, pickup or bullet erase shown in a prediction for K and absent from the truth at K (counted once per entity and event) | An enemy dying and coming back, a pickup reappearing |
| Late event | In the truth, never predicted before it was confirmed | Shown late (today's behaviour), not a glitch |
| Phantom bullet | A bullet shown in a prediction that vanishes in a later prediction for the same tick, or that first appears already far along its path | Bullets blinking in and out |
| Your hearts | A predicted hit on player i that the truth does not have, and the reverse | Counted only: neither plan would draw it |

The same pass computes the **cheap plan's** numbers for comparison: bullets drawn ahead ballistically (stopped at
walls and unbroken pieces) with enemies at the confirmed state, its phantom / late bullets, and the delay each plan
leaves on an enemy's reaction to your hit.

Sanity rules the harness must pass: with perfect guesses (teammates' true inputs) every glitch metric is zero; with
L = 0 (no guessed span) every glitch metric is zero.

### 4. Inputs

- **Bots** (for building and sanity): `recordPartyRun`, and a noisy variant of it (aim drifting every tick, tapped
  attacks, random rolls) as a rough stand-in for a mouse.
- **Human play** (the answer): live metrics on the players' devices (Design 7) and captured runs (Design 6, R4).

### 5. CPU probe on devices (`KV_RollbackSpike`, client)

Workspace attributes: `KV_RollbackSpike` a number = H (0 or absent: off), `KV_RollbackSpikeMode` `"parallel"` (default)
or `"serial"`. Both modes, in a live run (solo or co-op): clone the confirmed state, step the copy H ticks (co-op:
everyone repeats their last input; solo: the local input, then neutral), discard it. Timed with `os.clock()`: clone ms,
step ms, total; p50 / p95 / max over 10 s, the frame time and `gcinfo()` growth per second.

**Parallel (off the main thread, the default).** An `Actor` (created by the probe, cleaned up with Janitor) with its own
LocalScript runs the work in Parallel Luau. It never receives the state: the sim is deterministic, so the worker
**mirrors** the run itself. At co-op start it gets the run setup (world kind, seed, party size, start floor: the same
inputs `startCoop` builds its config from) and builds its own config and state; then, every frame, the merged frames
the main thread just stepped (a few bytes a tick, `Actor:SendMessage`). Its confirmed state is the main one's; every
600 ticks it sends its `hashState` back and the main thread compares (a mismatch stops the probe and prints both). On
that mirror it clones and steps H ticks, desynchronized (`task.desynchronize()`), in slices of `ROLLBACK_SPIKE.sliceTicks`
(4) with a yield between them, so no single parallel task runs long (Roblox's guidance: even in parallel, long
computations can block other scripts). It reports both "work ms" and "frames from start to finish of one prediction"
(how far behind a rollback built this way would draw). Modules are required in the serial phase at the worker's start
(`require` is not allowed while desynchronized). The worker's module scratch is its own VM's, so it cannot touch the
main sim's.

It also measures what a real rollback would have to send back each frame: a buffer the size of a view digest (64 actors,
150 bullets, 8 players: `ROLLBACK_SPIKE.digestBytes`) sent to the main thread, timed at both ends. Whether `SendMessage`
carries a `buffer` is not documented: R3a checks it first and falls back to a `SharedTable` (shared, not copied).

**Serial (the main thread).** The same work in the frame, as a serial rollback would do it: this mode is the one that
costs frames, and it is the comparison. Never on in a playtest with other people.

Under KV_Debug, once a second, the main thread checks its own state's hash is unchanged by the probe.

Cases (with dev mode, docs/DEV_MODE.md, to reach them): floor 15 at Depth 3 one-room fight and whole floor entered (the
replay bench's cases), a boss fight, solo and a 2-4 player party. H 8 / 16 / 24. Devices: a PC, an iPhone, a mid and a
low Android phone; 60 Hz and a 120 Hz screen. Native code generation (`--!native`) runs on the client on **Android
only** (Roblox's docs), so the spike measures the sim with and without it on Android and records iOS as interpreted.

**Reading the numbers (all Roblox-side, no Open Cloud).**
- The probe wraps its phases in `debug.profilebegin("kv.rollback.clone" / ".step" / ".send")` / `debug.profileend()`,
  so they show on the **MicroProfiler** timeline: Ctrl+F6 on a PC; on a phone, Settings > MicroProfiler On, then a
  browser on a laptop on the same network at the IP and port the phone shows (port 1338 in Roblox's example). Whether
  labels show on worker threads is not documented: R3 records it.
- A `[Rollback]` line every 10 s in the **Developer Console** (F9; on a phone, the in-game console) and an overlay line.
- **Logged, not only shown.** Every 10 s window the worker (or the serial mode) sends a `ProbeSummary` to the server
  through a rate-limited debug remote (`rollbackProbe`, only while `KV_RollbackSpike` is on and the server allows the
  player; the server re-reads every field, like `readRunRecapReport`): mode, H, case (room / floor / boss / walk, from
  the state), party size, actors and enemy bullets alive, clone / step / send ms p50 / p95 / max, the digest's arrival
  on the main thread, frames per prediction, the live model's own work in the same rounds, render fps, frame ms p95,
  `gcinfo()` KB/s, whether `--!native` ran, and a device label. Roblox gives scripts no device model, so the label is
  what the game knows (touch / gamepad / keyboard, viewport size, `GuiService:IsTenFootInterface()`) plus an optional
  tester's tag typed in the dev panel (F2, e.g. "Pixel 6a"). The server writes it to three places:
  - **the server log** (`[Rollback] ...`, Developer Console > Server), live while you are in the session;
  - **`KV_RollbackProbe_v1`**, at most one row a minute per player holding that minute's summaries (key: a writer id
    the server makes per player + a row number, a player's rows listed by a prefix), the per-session record the Studio
    plugin pulls with the captures (Design 6) and the harness turns into the device table;
  - **AnalyticsService** in published places: one custom event `RollbackCpu`, value = total ms p95 of the window,
    custom fields (three): device class (pc / phone / tablet / console), mode + H (`parallel16`), case; a dashboard
    across sessions and testers, daily (up to 24 h), within a per-player budget (As built, R4). Together with
    `RollbackProbe` (Design 7) that is two of the 100 event names.

### 6. Capturing human runs (`KV_RollbackCapture`, server)

On a server where the switch is on and only for parties of DEV_MODE-allowed players (or a private server whose owner
is one): at the end of every co-op run the server writes the run's merged log through the existing recording codec to
DataStore `KV_RollbackCapture_v1`, keyed by run id, chunked under the 4 MB value limit, with user ids replaced by player
indices in the data (inputs only; each write is tagged with the party's UserIds for erasure). Studio and published
places only; never on by default (Studio needs the switch too).

**Getting them out without Open Cloud:** the existing Studio plugin (`plugin/RunTestsPlugin.server.lua`, or a small
second one) gains a "Pull rollback captures" action: with Game Settings > Security > "Enable Studio Access to API
Services" on, it lists and reads `KV_RollbackCapture_v1` and `KV_RollbackProbe_v1` from Studio (no API key) and posts
each capture and probe row over HttpService to a receiver on the laptop (`scripts/rollback/receive-captures.js`, localhost only, the way Rojo's plugin talks to
`rojo serve`), which writes gitignored `captures/`; the fixture generator turns them into gitignored modules for the
harness. Open Cloud stays the fallback (`scripts/rollback/fetch-captures.js`, the key from the environment) if the
plugin path fails.

### 7. Live metrics (on the players' devices, no capture needed)

The parallel worker (Design 5) already holds the confirmed state and the real merged frames, so it can run the
prediction model (Design 2) live: each frame it predicts the drawn tick with the guess strategy, and when that tick is
confirmed it compares, computing Design 3's metrics on the real network (the real L and D) and the real inputs. Every
60 s it sends a summary (per metric per minute, L and D seen, room type, predictions made over main frames seen) to the
server by the same debug remote; the server prints it and, in published places, logs aggregate custom events through
AnalyticsService (`RollbackProbe`: one event name, value = the metric, custom fields: metric (the four gate metrics),
device class, horizon bucket; one more of the 100 names Roblox allows). Custom
events are server-only, published-place only and aggregated daily (charts can take up to 24 h), so they are a
dashboard over many sessions; the server log and `KV_RollbackProbe_v1` are the per-session record.

Live metrics answer Q2 at today's lead with `repeatLast` (the gate), with no capture to move. Captures stay for what
live cannot do: rerun the same play at other (L, D, H, strategy) after the fact. The live model runs only in the
parallel mode and only with `KV_RollbackSpike` on, at horizon H (it draws T + min(D + L, H)).

## Gates (proposed; the owner sets them in R6)

- **CPU:** clone + 16 steps, p95 at most 4 ms a frame on the mid phone in the one-room fight and 8 ms whole floor (room
  for rendering at 60 fps). If only the PC passes, PC-only rollback is an owner call. The report gives the largest H
  that passes on each device.
- **Mispredictions** (human captures, the measured L): enemy corrections >= 0.5 tile under 6 a minute, undone kills
  under 1 a minute, phantom bullets under 10 a minute, teammate corrections >= 1 tile under 6 a minute. And fewer
  visible problems than the cheap plan for what it gains.

## Decisions (proposed)

- **RBD1. Measure, don't build.** The spike adds no production path; its code stays behind its switches or is removed
  (R7).
- **RBD2. Generic copy first, then a pooled one.** The generic copy (R1) is correct first and its time an upper bound;
  it measured 21-41 ms (bullet slots dominate), too far from any budget to read, so the pooled copy (R1b) was added as
  the realistic cost, checked exact against the generic one. Both stay (Design 1); the model and the probe use the
  pooled copy.
- **RBD3. An offline model over recorded logs** for Q2, not a live rollback client: deterministic, every capture rerun
  at any (L, D, H, strategy). The network is a fixed (L, D) per pass; one pass through the lockstep harness's `Channel`
  with the measured lead is an optional check.
- **RBD4. Human inputs decide.** Live metrics (Design 7) set the gate at today's lead; captures rerun it at other
  settings. Bots only build and sanity-check the harness.
- **RBD5. `repeatLast` is the baseline guess** (the standard choice); the other strategies are measured beside it.
- **RBD6. Parallel by default, through a mirror.** The worker steps its own copy of the run from the merged frames
  (deterministic, hash-checked) instead of receiving the state: a few bytes a tick cross threads, not the state. A real
  rollback would be built the same way, so the probe measures the architecture it would use. Serial mode stays as the
  comparison.
- **RBD7. Roblox-side tools first.** MicroProfiler labels, the Developer Console, the server log, DataStores read from
  Studio by the plugin, AnalyticsService for the cross-session dashboard. Open Cloud only if the plugin path fails.

Open owner calls: the gates' numbers, the test devices, whether PC-only rollback is acceptable.

## As built

Paths under `src/` unless they start elsewhere. Everything is imported from its directory's barrel: the state copy, the
model and the worker core from `shared/lockstep/rollbackSpike` (barrel `lockstep/rollbackSpike/index.ts`, worker
`rollbackSpike/worker/index.ts`; NOT re-exported by `shared/lockstep`, so production code importing the lockstep barrel
never loads the spike; the pooled copier's module-load work is lazy), the summaries, readers, intake and capture codec
from `shared/spikes`.

### R1. Generic copy (`shared/lockstep/rollbackSpike/clone.ts`)

- `cloneForRollback(state): SimState`, `deepCopy(value, shared?)`, `cloneStats()`, `SHARED_BY_REFERENCE` (a path tree:
  the eight subsystem `.config` fields, `golden.floor`, `golden.cache.floor`; frozen tables are shared too).
  `table.clone`
  per table, so key layout and `pairs` order equal the original's (the sim walks Maps with `pairs`).
- The name is the census's `cloneForRollback`: `shared/sim` exports an unrelated `cloneSimState` (throws once bullets
  exist, specs only).
- Tunables `ROLLBACK_SPIKE` (`rollbackSpike/config.ts`): `sliceTicks` 4, `statsWindowSec` 10, `liveSummarySec` 60,
  `mirrorHashTicks` 600, `digestActors` / `digestBullets` / `digestPlayers` 64 / 150 / 8, `horizons` [8, 16, 24], plus
  the `model` and `probe` blocks (below).
- Test helpers moved out of `run/replay.bench.spec.ts` into `shared/run/testing/denseFight.ts` (`tickAll`, `sameFrames`,
  `skipPartyToFloor`, `busiestRoom`, `bossRoomOf`, `placeParty`, `topUpHearts`, `denseFighterFrame`).
- `clone.spec.ts` (endless floors 1 / 5 / 15, 1 and 4 players): hashes equal; copy and original stepped 600 ticks stay
  equal at every check; the original is untouched; original and copies stepped alternately in one VM are exact (no
  module scratch carries between ticks).

### R1b. Pooled copy (`shared/lockstep/rollbackSpike/pooledCopy.ts`)

- `StateCopyFn = (state) => SimState`; `PooledStateCopier` (`copyInto(src)`, `copyFn()`, `stats()`), `pooledCopyFn()`,
  `stateDifference(a, b)`. The returned state is the copier's scratch, overwritten by the next call: one copier per
  state that must stay alive; its own scratch passed back as a source is an error.
- Dead bullet slots are skipped (never read by the sim, never hashed). A reused record keeps the scratch's key order,
  which can differ from the source's; nothing iterates state records with `pairs`, and `stateDifference` compares key
  sets after stepping. A reused array scratch must iterate exactly 1..n after the copy (walked with `next`), else it is
  re-cloned. Steady state allocates 2 tables a copy (`breakables.slotByCell`, `pellets.byCell`, re-cloned).
- `pooledCopy.spec.ts`: exact copies on the same six cases, reuse into a dirty scratch (other ticks, floors,
  subsystems), the bench (Results).

### R2. Model and metrics (`model.ts`, `digest.ts`, `metrics.ts`, `harness.ts`, `captureModules.ts`)

```ts
new RollbackModel({ playerIndex, config, strategy?, horizonCap? /* ROLLBACK_SPIKE.model.horizonCap 32 */,
                    copy? /* a StateCopyFn, default its own pooledCopyFn() */, oracle?, cheapPlan? })
reset(state)                 // run start / mirror rebuild
putTruth(tick, frames)       // every merged frame (everyone, index order) as soon as received, in tick order
putOwn(tick, frame)          // own sent frames past the merged ones
beginPredict(state): number  // copies; returns the drawn tick K = T + min(D + L, horizonCap) (T if nothing pending)
stepPredict(maxTicks): boolean  // true once the copy reached K
finishPredict(): number
predict(state): number       // begin + step(all) + finish
isPredicting(): boolean
confirm(state)               // after each confirmed step, in order, draft ticks included (throws while predicting)
lastTimes()                  // { copy, step, other } seconds of the last prediction
drawn(): ViewDigest | undefined
metrics: RollbackMetrics     // toLiveSummaryCounts(), leadSeen(), totalSeconds(), perMinute(m, room?), reset()
```

- While a sliced prediction is in flight the caller must not step its state (`confirm` / `reset` throw). Per frame:
  `beginPredict(mirror)` -> `stepPredict(ROLLBACK_SPIKE.sliceTicks)` with a yield between slices -> `finishPredict()`
  -> step the mirror and `confirm(mirror)` once per tick. Truth / own rings hold 256 ticks (`model.frameRingTicks`).
- Harness: `runModelOverRecording(...)`, `recordedFrame`, `firstTickWhere`, `captureModelInput(capture)` (rebuilds the
  config with `buildWorldSetup` and replays to the capture's server hash). The noisy bot is `shared/run/testing`
  `recordNoisyPartyRun(seed, n)` (`NOISY_BOT`: aim drifting every tick, tapped attacks, random rolls).
- Metrics as built (deviations from Design 3; tunables `ROLLBACK_SPIKE.model`):
  - bullet identity: per pool slot with a spike-side spawn tag (R0's exact alternative), matched by key, else same
    emitter + kind within `bulletMatchTiles` 0.35; "appears far along" = age > `appearAgeTicks` 1 at the drawn tick;
  - corrections and truth errors count only living enemies / teammates within `viewRadiusTiles` 12 of the observer,
    once per entity per frame, in cumulative buckets (>= 0.1 counts every >= 0.25, ...);
  - undone / late / phantom events once per entity per `dedupTicks` 600, with +/- `eventSlackTicks` 6 of slack;
  - the 20 metric names are `ROLLBACK_LIVE_METRICS` (`enemyCorr010/025/050/100`, `mateCorr010/025/050/100`,
    `enemyErr050/100`, `undoneKill/Death/Pickup/Erase`, `lateEvent`, `phantomBullet`, `heartPhantom`, `heartMissed`,
    `cheapPhantomBullet`, `cheapLateBullet`);
  - the cheap plan's numbers saturate (they read about as "bullets fired / removed in view per minute") and it ignores
    the Hourglass; `undoneErase` is a heuristic; a floor change produces no kills; draft ticks add no seconds;
  - **not built:** "the delay each plan leaves on an enemy's reaction to your hit".
- Captures reach the harness through `scripts/gen-fixtures.js`: each `captures/<runId>.json` becomes a gitignored
  module under `shared/fixtures-generated/captures/`, read by `loadCaptureModules`. No captures: nothing changes.
- Runner: `scripts/lune/run-tests.luau` takes `--flag name` (sets `_G.KV_SPEC_FLAGS[name]`; a `--flag` without a
  value exits 2). The full sweep is
  `npm run test:only -- lockstep/rollbackSpike/model.sweep --flag rollbackSweep` (bots and every capture present, about
  19 minutes on the cloud container); `npm test` runs `model.spec.ts`'s small passes only.
- `model.spec.ts` sanity, exact: perfect guesses (oracle = the truth) over 1,600 frames with 52 true events: glitch
  total 0; L = 0: glitch total 0; sliced, one-shot and generic-copy passes identical.

### R4. Capture and server sinks (`shared/spikes`, server `RollbackSpikeService`, plugin, receiver)

- Shared `shared/spikes/rollbackSpike.ts`: `ROLLBACK_CAPTURE` (attribute `KV_RollbackCapture`, registered in
  `shared/config` spikes.ts `SPIKE_DEFAULTS.rollbackCapture` / `SPIKE_ATTRIBUTES.rollbackCapture`; player attribute
  `probeAllowedAttribute` `KV_RollbackAllowed`; stores `KV_RollbackCapture_v1` / `KV_RollbackProbe_v1`; `chunkChars`
  3,000,000; `blockTicks` 600; `receiverPort` 34880; ids `maxIdChars` 38 of `[A-Za-z0-9_{}-]`), `ROLLBACK_PROBE_RATE`
  (cpu 12 / 60 s, live 3 / 60 s, `refused` 3 warnings / 60 s), `ROLLBACK_ANALYTICS_RATE` (cpu 7 windows / 60 s, live
  2 windows / 120 s), `ROLLBACK_PROBE_ROWS` (`writeEverySeconds` 60, `pollSeconds` 5, `maxPerRow` cpu 24 / live 6,
  `budgetReserve` 20), the enums (`ROLLBACK_PROBE_MODES`, `ROLLBACK_PROBE_CASES`, `ROLLBACK_ROOM_TYPES`,
  `ROLLBACK_GUESS_STRATEGIES`, `ROLLBACK_DEVICE_CLASSES`, `ROLLBACK_LIVE_METRICS`, `ROLLBACK_ANALYTICS_LIVE_METRICS`),
  `ProbeSummary` / `LiveSummary` / `RollbackProbeRow` and the strict readers `readProbeSummary` / `readLiveSummary`
  (labels: at most 48 bytes of valid UTF-8, no control characters), `analyticsForProbeSummary` /
  `analyticsForLiveSummary`, `describeProbeSummary` / `describeLiveSummary`, the key helpers (`rollbackProbeRowKey`,
  `rollbackCaptureMetaKey`, `rollbackCaptureChunkKey`), the gates `rollbackCaptureAllowed` (a party) and
  `rollbackProbeAllowed` (one player, the same rule).
- The summaries as built (beyond Design 5 / 7): `ProbeSummary` has a `total` stat, `samples` / `windowSeconds`,
  `framesPerPrediction` as a p50 / p95 / max stat, `digest` (ms from the digest's send to its arrival on the main
  thread, the main thread's clock: the client fills it from its own window of arrivals) and `live` / `liveSamples` (the
  live model's work per round, see R4b). `LiveSummary` has `predictions` (live predictions made in the window) and
  `mainFrames` (main rendered frames the worker saw).
- Intake `shared/spikes/rollbackIntake.ts` `RollbackProbeIntake` (pure, `rollbackIntake.spec.ts`), per player in this
  order: the gate (`rollbackProbeAllowed`: Studio, a DEV_MODE-allowed player, or anyone in a private server a
  DEV_MODE-allowed player owns); the rate limits, before anything is read or logged (refused payloads of every kind,
  not allowed, unknown kind, malformed, a stolen session id, print at most `refused` warnings, the rest are dropped
  silently); the readers; the session id bound to the first player who sent it on this server (anyone else's summary
  with it is refused); the row buffer; the analytics budget (a summary's events logged whole or not at all).
- Codec `shared/spikes/rollbackCapture.ts`: `encodeCapture` / `decodeCapture(meta, chunks)` ->
  `{ setup, info, recording }`; setup = world kind, seed, party size, at boss door, debug, ruleset, daily?, place
  version (no user ids); `info` = run id, how it ended, `verifiedTicks`, `serverHash`. `RollbackCaptureRecorder` reads
  the server's merged log through a structural interface (no shared/lockstep change): `pull` only copies frame
  references and closes a block every `blockTicks` into a queue; `encodePending(n)` encodes queued blocks one at a time
  (the recording codec, then base64 through `Base64Stream`, which carries 0-2 bytes between blocks so the text equals
  the base64 of the joined bytes: the format did not change); `finish(setup, info, chunkChars, pause?)` encodes the
  rest and cuts the chunks, calling `pause()` between blocks and chunks.
- Remote `Events.rollbackProbe(kind: string, payload: unknown)` (client -> server, `shared/network.ts`).
- Server `RollbackSpikeService` (`server/services/spikes`): intake only while `KV_RollbackCapture` is on (Studio too);
  it then sets `KV_RollbackAllowed` on every player the gate allows (the client's probe waits for it). Per summary
  taken: one `[Rollback] CPU:` / `LIVE:` server log line; the summary into its player's row buffer; AnalyticsService
  through `TelemetryService.logSpike` in published places only, within the budget (in Studio, `KV_AnalyticsDebug` prints
  what would be sent). **Rows** in `KV_RollbackProbe_v1`: a player's buffer leaves as ONE row (a SetAsync of a new key
  `<writerId>/<n>`, the writer id a GUID the server makes per player, never the client's session id; row `{ v: 2, at,
  placeVersion, cpu: [...], live: [...], dropped }`) once its oldest summary is 60 s old (polled every 5 s), when the
  player leaves, when the switch goes off and when the server closes: at most one write a minute per player (plus one at
  a leave / close), each tagged with the player's UserId, skipped (logged `PROBE_ROW_SKIPPED`, the server log keeps the
  lines) while `GetRequestBudgetForRequestType(SetIncrementAsync)` is under 20. **Analytics**: `RollbackCpu` (value
  total ms p95; device class, mode + H bucket, case), one per CPU window, at most 7 windows a minute per player;
  `RollbackProbe` (value per minute; metric, device class, H bucket) for the four gate metrics only
  (`ROLLBACK_ANALYTICS_LIVE_METRICS`: `enemyCorr050`, `undoneKill`, `phantomBullet`, `mateCorr100`; every metric stays
  in the log line and the row), at most 2 live windows per 2 minutes: at most 15 events in any minute, about 10 a minute
  sustained, per player. `ROLLBACK_ANALYTICS_EVENT`. The catalog is now 39 of 100 names and 3000 of 8,000 field
  combinations (`RollbackProbe` 4 x 4 x 5 = 80; `analyticsCatalog.spec.ts`).
- Capture hook in `RunSessionService`: `startLockstep` -> `beginCapture` (undefined when off), `stepLockstep` ->
  `tapCapture` after every `coop.step` (the merged log releases validated ticks, so every tick is read before it
  goes; a pull copies references only, and a finished block starts a deferred encoder thread that encodes one block per
  resumption with a `task.wait()` between, never inside the step), `forgetLockstep` -> `endCapture` (the one place a
  lockstep entry is deleted: every exit path). `endCapture` spawns a thread, waits up to 60 s for the validator's hash,
  encodes the rest with a yield between blocks and chunks, writes the chunks and then the meta (all under pcall, each
  tagged with the party's UserIds), logs `CAPTURE_ENCODED` (size, ms, slices) / `CAPTURE_WRITTEN`. `BindToClose` ends
  every verdict wait at once (a capture without a verdict is written with status `shutdown`), writes the open captures
  with status `shutdown` and every buffered probe row, and waits for all of those writes (counted together), at most
  20 s.
- **Who is captured** (with the switch on): Studio, a party whose every member is DEV_MODE-allowed, or a private server
  whose owner is. The private-server rule is deliberate: R5's playtest is a developer's private server with friends on
  their own connections, whose inputs are the answer; their data is tagged with their UserIds for erasure. Turning the
  switch off mid-run abandons the open recorders (`CAPTURE_DROPPED`).
- Measured: a 3-player bot run of 964 ticks encodes to 6,323 bytes (about 6.6 bytes a tick for the party). At that
  rate a 30-minute run (108,000 ticks) is about 0.7 MB, about 1 MB of base64: one 3,000,000-character chunk. Human
  inputs change more often and encode larger; R4's Studio check and R5 measure the real size.
- Plugin `plugin/RollbackCapturePlugin.server.lua` (toolbar button "Pull rollback captures", edit mode only; built by
  `rollback-plugin.project.json`, `npm run rollback:plugin`). Receiver `scripts/rollback/receive-captures.js`
  (`npm run rollback:receive`): 127.0.0.1 only, Host header and JSON content type checked, 64 MB cap, writes
  `captures/<runId>.json` and appends `captures/probe/<kind>.jsonl`: each v2 row becomes one line per summary (key
  `<writerId>/<n>/<kind>/<i>`, row `{ v, kind, at, placeVersion, summary }`), a v1 row one line; lines it has are
  skipped. `/captures` is gitignored. `npm run test:rollback` (node tests of the receiver and gen-fixtures' capture
  modules) is in `verify`.
- **Not built:** the Open Cloud fallback (`scripts/rollback/fetch-captures.js`).

### R3a / R3 / R4b. The worker, the probe, live metrics

- Pure core `shared/lockstep/rollbackSpike/worker/`: `stats.ts` (`WindowSamples`), `device.ts` (`rollbackDeviceClass`,
  `rollbackDeviceLabel`, `rollbackProbeCase`, `aliveActors`), `protocol.ts` (messages and their readers
  `readMainToWorker` / `readWorkerToMain`; frames packed `[moveX, moveZ, aimX, aimZ, buttons]`), `setup.ts`
  (`buildRollbackMirror` / `rollbackMirrorConfig`), `core.ts` (`RollbackWorkerCore`, `fillDigestBuffer`), `feed.ts`
  (`RollbackFeed`, the main side), `sources.ts` (`lockstepFrameSource`, `soloFrameSource`), `facts.ts` (R3a). Tunables
  `ROLLBACK_SPIKE.probe`; `rollbackDigestBytes()` = 3,184 bytes (actor records of 20 bytes: id, kind, alive, x, z, hp).
  The device label is cut with `utf8Truncate` (never inside a character); a tag that is not valid UTF-8 keeps its
  ASCII.
- `LockstepClient` read-only accessors (no behaviour change): `queuedFrame(k)`, `lastSentInputTick()`,
  `sentInput(tick)`, `pacingDepthTicks()`.
- Protocol: main -> worker `actor:SendMessage("kv.rollback.toWorker", msg)`: `setup` (session id, mode, horizon, world
  kind, seed, party size, local index, coop, at boss door, scoring, stress, dev?, live, strategy, borrowed, device
  label / class, native), `frames` (each rendered frame BEFORE the sim steps: tick, frame ms, truth, own, hash tick),
  `control` stop / end. Worker -> main through the BindableEvent `KV_RollbackReply` inside the Actor (fired in the
  serial phase): ready, cpu, live, mirrorHash, status, digest `{ sentAt, data: buffer }`, error. Facts topic
  `kv.rollback.facts`.
- Shipping: `client/rollbackWorker/worker.client.ts` is the LocalScript `StarterPlayerScripts.TS.rollbackWorker.worker`,
  disabled by `worker.meta.json`. Per probe session the controller creates the Actor `KV_RollbackWorker` with the reply
  event, clones the template into it, parents the Actor to PlayerScripts and enables the clone; the worker requires its
  modules in the serial phase, `BindToMessageParallel`, fires ready; the main side waits up to 15 s
  (`probe.readyTimeoutSec`). Yields between slices: `task.synchronize()`, flush, `task.desynchronize()`. Outside an
  Actor the script does nothing.
- Client `RollbackSpikeController` (spikes barrel); store slice and the spike HUD's `ROLLBACK ...` line (`SpikeHud`);
  the dev panel's "Rollback probe device tag" field (DevPanel / DevModeController, docs/DEV_MODE.md);
  `SimController.getDevRunOptions()`; `RENDER_ORDER.rollbackProbeBeforeSim`. The probe starts only while the server's
  player attribute `KV_RollbackAllowed` is true (RollbackSpikeService sets it, with `KV_RollbackCapture` on, for the
  players the capture policy allows), so a Workspace attribute, which replicates to every client, never starts it on
  anyone else's device; serial mode refuses a run with more than one player. Facts mode's Heartbeat samplers are
  janitor-owned (turning the probe off mid-phase disconnects them).
- Attributes (`ROLLBACK_SPIKE_ATTRIBUTES`, `shared/config` spikes.ts): `KV_RollbackSpike` (a number H 1..64; 0 or
  absent: off, nothing created), `KV_RollbackSpikeMode` `parallel` (default) / `serial` / `facts`,
  `KV_RollbackDeviceTag` (a string). Changing an attribute restarts the probe; a co-op run past tick 0 is skipped until
  the next run (its early merged frames are gone); a solo run picked up mid-run replays its recorded frames into the
  mirror unless they were released. Under `KV_Debug` the main state's hash is checked before / after the probe's work
  once a second.
- **As built vs Design 5 / 7:** the live model predicts at horizon H (`horizonCap` = the setup's H: it draws
  T + min(D + L, H), and the live window's `horizon` is H); hash checks are requested by the main thread (about every
  600 ticks); the mirror runs one frame behind the main state; the digest `send` stat is measured on the worker
  (fill + Fire), its arrival on the main thread is the summary's `digest` stat (and the HUD line's `send .. ms`);
  `native` is always false (no `--!native` variant built); the CPU probe copies with the pooled copy, so its `clone`
  stat is R1b's cost; the MicroProfiler labels are `kv.rollback.copy` / `.step` / `.send` / `.live` / `.mirror` /
  `.facts` (`probe.profileLabels`; Design 5 said `.clone`).
- **CPU and live loads (co-op parallel): measured separately, not alternated.** Each worker round runs the CPU
  prediction (H ticks) and then the live model's prediction on the same worker. A CPU window's `clone` / `step` /
  `send` / `total` are the CPU prediction's own work (yields excluded), and its `live` stat / `liveSamples` are the
  live model's work per round, timed apart; `framesPerPrediction`, the frame rate, frame time and gc carry both loads.
  `liveSamples` 0 (solo, serial) means the window is the CPU probe alone; read the device table from solo windows, or
  from `total` beside `live`.
- **Reading a live window.** The worker predicts once a round on the newest confirmed tick, so when it falls behind it
  coalesces frames: `predictions` < `mainFrames`. Then corrections are undercounted (only drawn ticks two consecutive
  predictions both drew are compared), ticks never drawn count as late events (overcount), and seconds come from the
  confirmed ticks. Read the rates with `predictions / mainFrames` beside them (1 means every frame predicted).
- Specs (`worker/core.spec.ts`, `protocol.spec.ts`, `lockstep/rollbackAccessors.spec.ts`), with synchronous yields:
  3-player bot run, 949 frames, observer 1, L 11, D 4, H 8 (the CPU probe's ticks and the live model's cap): 7 / 7
  mirror hash checks equal a plain replay; 10 CPU and 2 live windows pass the server's readers; each of the 20 metrics
  summed over the live windows equals `runModelOverRecording` at the same H exactly, the windows' `mainFrames` sum to
  the 949 frames and their `predictions` to the harness's, the CPU windows' `liveSamples` to 949. Perfect-guess hook: 0
  glitches. One slice per frame: hashes equal, up to 2 frames per prediction, live counts differ from offline
  (coalescing, expected). Serial: the lent state's hash unchanged. Accessors over a real `LockstepClient`: exact replay,
  0 mismatches.
- Build note: a clean `npm run build` can exhaust node's default heap on a small host:
  `NODE_OPTIONS=--max-old-space-size=4096 npm run build`.

### Merged into main with the Archer (docs/ARCHER.md)

Since the Archer, a run's config depends on every player's character (loadout and roll traits), so the spike carries
the characters wherever it rebuilds a run: the worker's setup message has `characters` (the main client's
`SimController.getRunCharacters()`, i.e. `RunSetup.characters`) and the dev world's `bothWeapons`, both re-read by
`readMainToWorker` and passed to `buildWorldSetup` by `buildRollbackMirror`; a capture's setup has `characters`
(`RunSession.characters`, character ids only) and `captureModelInput` passes them on. Without them an Archer's mirror
or capture replay would not match the main state's hashes. The replay bench's fighter in `run/testing/denseFight.ts`
is `denseFighterFrame` (the Archer's `characterTune.ts` owns `fighterFrame`). Specs: protocol (characters round trip,
unknown refused, an Archer mirror equal to `buildWorldSetup`'s state, a dropped list would differ) and the capture codec.

## Tasks

- [x] **R0. Census (paper).** (a) The copy surface: every `SimState` subsystem and every object it reaches, marked
  mutable (copied), shared immutable (`SHARED_BY_REFERENCE`) or transient (module scratch rebuilt each step: `SimCtx`
  masks, step.ts's `soloPrev`, ...). (b) The event feeds: every client consumer of per-tick sim events or `RunView`
  collectors, each marked "presentation, needs dedup under rollback" or "must stay on the confirmed state" (telemetry,
  recap tallies, records). (c) Whether bullet payloads carry a spawn tick. -> Verify: the three lists in this doc, and a
  rough count of the client files a real rollback would touch.
- [x] **R1. State copy.** `cloneForRollback` + `SHARED_BY_REFERENCE`. -> Verify: `clone.spec.ts` on endless floors 1, 5
  (boss) and 15 (dense), solo and 4 players: the copy's hash equals the original's; both stepped 600 ticks with the same
  inputs stay equal at every 60-tick check; stepping the copy 600 ticks leaves the original's hash unchanged; a bench
  prints the clone time per case. Done headlessly: every check holds; 21-41 ms a clone (Results).
- [x] **R1b. Pooled copy.** `PooledStateCopier` (Design 1): copies into a reused scratch, live bullet slots only.
  -> Verify: `pooledCopy.spec.ts` on R1's six cases: the copy hashes like the original; stepped alike they stay equal;
  the original is untouched; alternate stepping is exact; copies into a dirty scratch (other ticks, floors, subsystems)
  are exact; a bench prints generic vs pooled time, tables allocated, copy + 16 steps. Done headlessly: every check
  holds; 0.7-1.8 ms a copy, 2 tables allocated (Results).
- [x] **R2. Model and metrics (headless).** Design 2-4 over bot runs. -> Verify: the two sanity rules (Design 3) hold
  exactly; the report table prints for `recordPartyRun` and the noisy bot over the (L, D, strategy) sweep. The full
  sweep is opt-in (`npm run test:only -- lockstep/rollbackSpike/model.sweep --flag rollbackSweep`), so `npm test` runs
  one small pass. Done headlessly: both rules give 0 glitches; the sweep's table is in Results.
- [ ] **R3a. Parallel facts (Studio, small).** **Built; Studio check pending** (`KV_RollbackSpikeMode` = `facts`,
  checklist step 2). An Actor with a LocalScript under roblox-ts: required modules in the serial phase, the sim built
  and stepped desynchronized; `SendMessage` with a table, a `buffer` and a `SharedTable` (what arrives, copied or not,
  metatables); MicroProfiler labels from the worker; how a 5 ms and a 20 ms parallel task affect the frame time.
  -> Verify: the answers written here (they are not in Roblox's docs); Design 5 adjusted to them.
  **Frame-time facts (2026-11-09, the owner's Mac, Studio Play solo, 60 Hz, while the later preload tier was still
  loading):**

  | Task per frame | Frame ms p50 / p95 / max | fps |
  |---|---|---|
  | none (baseline) | 16.67 / 17.68 / 19.14 | 60.0 |
  | 5 ms, parallel (worker Actor) | 16.70 / 21.94 / 29.30 | 58.0 |
  | 20 ms, parallel | 21.09 / 21.35 / 22.09 | 47.4 |
  | 5 ms, main thread | 16.66 / 17.44 / 17.60 | 60.1 |
  | 20 ms, main thread | 20.66 / 21.31 / 52.91 | 47.8 |

  Reading: the frame waits for desynchronized work, so a long parallel task holds the frame like a main-thread one (20
  ms costs the same 47-48 fps either way): Parallel Luau is not a background thread here. 5 ms fits in this frame's
  slack on either side; in parallel it adds p95 / max jitter (21.9 / 29.3 ms) the main thread did not. So one worker
  only helps while its work fits the frame's slack; spreading a prediction over frames needs a wait for the next frame
  between slices (not `synchronize` / `desynchronize`, which may resume in the same frame), or the work split across
  several Actors (cores).

  **The other facts (same run):**
  - Worker ready 0.13 s after the Actor was parented (modules required in the serial phase).
  - The sim stepped desynchronized in the Actor: 600 ticks of a 4-player endless run in 14.5 ms (main thread 15.0 ms),
    hash equal to the main thread's. That is about 0.024 ms a tick, 8-50x under Lune's headless 0.19-1.17 ms, but on a
    light state (the run's start, few actors and bullets): step 3's dense floor-15 case is the real number.
  - `SendMessage(table)`: arrives, nested tables and lists intact, COPIED (the worker's writes do not show), a table
    referenced twice arrives as two tables, metatables stripped. The protocol's plain tables are fine.
  - `SendMessage(buffer)`: arrives as a buffer, content intact, copied; a buffer back through the BindableEvent arrives
    as a buffer. The digest path works as built: no `SharedTable` fallback needed.
  - `SendMessage(SharedTable)`: shared (not copied: the worker's write shows on the main thread).
  - The main thread cannot `BindToMessage` on another Actor ("only allowed in scripts that are a descendent of that
    Actor"); the worker's `SendMessage` while desynchronized is fine. The worker -> main path must stay the
    BindableEvent `KV_RollbackReply`, as built.
  - MicroProfiler label `kv.rollback.facts` on a worker thread: not yet recorded.
- [ ] **R3. CPU probe.** **Built; headless specs pass; Studio check pending** (checklist steps 3-5). Design 5, both
  modes, the mirror and its hash check, the digest send. -> Verify: `npm run verify`; Studio: at H 16 the probe shows
  its line in both modes, the mirror's hash matches for a 10-minute run, the main hash check passes, attribute off
  creates nothing (no Actor); every window's summary prints on the server and lands in `KV_RollbackProbe_v1`, the
  plugin pulls the rows, and a malformed summary is refused (spec on the reader: done, `rollbackSpike.spec.ts`).
- [ ] **R4. Capture.** **Built; headless specs pass; Studio check pending** (checklist steps 6-7). Design 6, the plugin
  action and the receiver. -> Verify: Studio (Test > Clients and Servers, 2 players): a run's capture is written, pulled
  by the plugin through the receiver, and replays in the harness to the run's final hash (the capture is whole).
- [ ] **R4b. Live metrics.** **Built; headless specs pass; Studio check pending** (checklist step 8). Design 7 in the
  worker, the summary remote, the server line, `KV_RollbackProbe_v1`, the `RollbackProbe` custom event. -> Verify: in
  Studio with Incoming Replication Lag 100 ms and two clients, the summaries print on the server; with a test hook that
  makes the guess the truth (teammates' frames read from the log ahead of time) every glitch metric is zero (done
  headlessly, `worker/core.spec.ts`); the live numbers for a captured run equal R2's offline numbers for the same run at
  the same (L, D) within the lead's movement (headlessly exact over a bot run; the Studio capture pending).
- [ ] **R5 [owner]. Device and playtest session.** The probe on a PC, an iPhone, a mid and a low Android phone (Design
  5's cases; both modes, MicroProfiler screenshots kept), numbers recorded here; a co-op playtest of 20-30 minutes with
  friends on their own connections, capture and live metrics on (parallel mode only; pairs with FP14 / FP15).
  -> Verify: the device table, the live summaries and at least three captured runs. (Checklist step 9.)
- [ ] **R6. Report and decision.** The live summaries (the gate) and the harness over the captures (the sweeps); the
  result tables filled in; a recommendation (build rollback and its scope, build the cheap plan, or the cheap plan
  first). -> Verify: the owner's decision recorded here as RBD8; docs/LOCAL_PREDICTION.md points at it.
- [ ] **R7. Cleanup.** Per RBD8: the spike code removed, or kept behind its switches as the first piece of the build
  (the worker mirror is reusable).

Order: R0 -> R1 -> R1b -> R3a -> R2, R3, R4 (in parallel) -> R4b -> R5 -> R6 -> R7. R2 needs only R1 / R1b. As built,
R3a / R3 / R4b were written together before any Studio run, so the Studio checks below run in that order instead.

## Results (filled in by R2, R5, R6)

### Headless CPU (R1 / R1b / R2)

Lune on the cloud container (x86, shared with other builds): no Luau fast paths, no native code, wall clock noisy
(the same case moves by 20-50 % between runs). Pessimistic; R5's devices decide Q1.

`pooledCopy.spec.ts` bench, one run (2026-11-09), endless floor at the replay bench's dense-fight setup:

| Case | Tick | Actors / enemy bullets alive | Generic clone ms | Pooled copy ms (max) | Copy + 16 steps ms, generic / pooled |
|---|---|---|---|---|---|
| floor 1, solo | 734 | 3 / 0 | 26.3 | 1.52 (1.71) | 27.9 / 3.2 |
| floor 1, 4 players | 734 | 8 / 0 | 23.0 | 1.34 (2.00) | 26.1 / 5.0 |
| floor 5, solo | 742 | 14 / 3 | 21.8 | 1.01 (1.27) | 24.1 / 3.4 |
| floor 5, 4 players | 742 | 12 / 6 | 22.4 | 1.17 (3.25) | 26.8 / 5.3 |
| floor 15, solo | 762 | 12 / 21 | 26.5 | 1.18 (1.69) | 30.4 / 4.2 |
| floor 15, 4 players | 762 | 16 / 39 | 41.1 | 1.83 (2.69) | 51.8 / 9.3 |

Earlier runs: generic 21-38 ms, pooled 0.74-1.65 ms, copy + 16 steps pooled 1.7-7.4 ms vs generic 22.7-40.2 ms; one sim
step 0.085-0.39 ms. Of the ~8,100 tables a generic clone copies, 7,708 are the two bullet pools' per-slot `{x, y, z}`
tables (2048 enemy + 512 player slots, live or not); the pooled copy visits 330-520 tables and allocates 2.

Model per frame (R2, pooled copy, 3-player bot run, a 15-tick prediction): copy 1.1-1.3 ms, step 3.1-3.5 ms
(0.21-0.23 ms a tick), other (digest, metrics) about 0.17 ms: **about 4.4-5.0 ms a frame** headless.

### Devices (R5; the probe's `ProbeSummary` rows)

The copy column is the summary's `clone` stat (the pooled copy). Native is always off as built. The Mac row's digest
(worker send -> main-thread arrival) was 11.1 / 12.1 / 15.0 ms p50 / p95 / max: the result reaches the main thread
about one frame later, a frame a real rollback would add unless the worker ran earlier in the frame. The first run
also showed every 10 s window's `kv.rollback.send` label closing after the send's `task.synchronize()` ("No active
profile annotation"): fixed (the label covers the fill, the Fire has its own), and the core spec's host now refuses a
label left open across a yield or a send. The floor-15 rows: the step cost grows with the awake actors (about 0.08 ms a tick at
11, 0.21 at 31; Lune headless: 0.19 a room, 0.72-1.17 at 64); the first window's 54.7 fps and 635 KB/s GC are the dev
run's floor build and asset loading, not the probe (the next window is back at 60 fps with 4 ms of probe work). The phone row is
from its HUD line (last prediction 20.56 ms, digest arrival 20.8 ms): about 3x the Mac's floor case, 12 of the 16.7
ms frame, so the frame waits and the phone drops to 50 fps; its stored CPU rows (pull) give the full columns.

| Device / host | Mode | Case | Party | H | Copy ms p50 / p95 | Step ms p50 / p95 | Total p95 | Frames / prediction p95 | Frame ms p95 | GC KB/s |
|---|---|---|---|---|---|---|---|---|---|---|
| Owner's Mac, Studio Play (2026-11-09) | parallel | room (11 actors, 19 bullets) | 1 | 16 | 0.52 / 0.57 | 1.20 / 1.44 | 1.99 | 1.00 | 19.09 (60 fps) | 117 |
| Owner's Mac, Studio Play, dev floor 15 | parallel | floor (21 actors, 23 bullets; the run's first window) | 1 | 16 | 0.50 / 0.59 | 0.96 / 2.43 | 3.04 | 1.00 | 20.66 (54.7 fps) | 635 |
| Owner's Mac, Studio Play, dev floor 15 | parallel | floor (31 actors, 14 bullets) | 1 | 16 | 0.61 / 0.67 | 3.13 / 3.40 | 4.06 | 1.00 | 18.84 (60 fps) | 59 |
| Phone (model to confirm), published place, dev floor 15 (2026-11-10) | parallel | floor, many rooms walked (counts not on the HUD line; dev panel open) | 1 | 16 | - / 1.22 | - | 11.77 | 1 | (50 fps) | - |
| PC | | | | | | | | | | |
| iPhone | | | | | | | | | | |
| Mid Android | | | | | | | | | | |
| Low Android | | | | | | | | | | |

### Mispredictions, bots (R2 sweep)

`model.sweep.spec.ts` (`--flag rollbackSweep`, 1,142 s): seed 4242, 3 players, observer player 0, `horizonCap` 32.
`bot` = `recordPartyRun` (2,608 ticks, floors 1-7 with the floor 5 boss; 40 s of play once drafts are taken out),
`noisy bot` = `recordNoisyPartyRun` (3,972 ticks; 63 s of play). Per minute of play, D 4. Proposed gates (Gates):
enemy corrections under 6, undone kills under 1, phantom bullets under 10, teammate corrections under 6.

| Input | L | D | Strategy | Enemy corr. >= 0.5 /min | Undone kills /min | Phantom bullets /min | Teammate corr. >= 1 /min | Cheap plan: phantom / late bullets /min |
|---|---|---|---|---|---|---|---|---|
| bot | 6 | 4 | repeatLast | 0.00 | 0.00 | 7.51 | 27.05 | 13.52 / 112.69 |
| bot | 6 | 4 | repeatLastAxesOnly | 0.00 | 0.00 | 7.51 | 27.05 | 13.52 / 112.69 |
| bot | 6 | 4 | neutral | 1.50 | 0.00 | 7.51 | 123.21 | 13.52 / 112.69 |
| bot | 11 | 4 | repeatLast | 1.50 | 4.51 | 7.51 | 61.60 | 13.52 / 112.69 |
| bot | 11 | 4 | repeatLastAxesOnly | 0.00 | 4.51 | 6.01 | 58.60 | 13.52 / 112.69 |
| bot | 11 | 4 | neutral | 16.53 | 4.51 | 6.01 | 124.71 | 13.52 / 112.69 |
| bot | 16 | 4 | repeatLast | 4.51 | 0.00 | 9.02 | 73.62 | 13.52 / 112.69 |
| bot | 16 | 4 | repeatLastAxesOnly | 3.01 | 4.51 | 1.50 | 61.60 | 13.52 / 112.69 |
| bot | 16 | 4 | neutral | 52.59 | 4.51 | 4.51 | 126.21 | 13.52 / 112.69 |
| bot | 25 | 4 | repeatLast | 25.54 | 15.03 | 31.55 | 199.83 | 13.52 / 112.69 |
| bot | 25 | 4 | repeatLastAxesOnly | 24.04 | 7.51 | 28.55 | 157.76 | 13.52 / 112.69 |
| bot | 25 | 4 | neutral | 117.20 | 7.51 | 31.55 | 126.21 | 13.52 / 112.69 |
| noisy bot | 6 | 4 | repeatLast | 0.00 | 0.00 | 3.83 | 30.64 | 45.96 / 123.51 |
| noisy bot | 6 | 4 | repeatLastAxesOnly | 0.00 | 0.00 | 3.83 | 30.64 | 45.96 / 123.51 |
| noisy bot | 6 | 4 | neutral | 0.00 | 0.00 | 6.70 | 35.43 | 45.96 / 123.51 |
| noisy bot | 11 | 4 | repeatLast | 0.96 | 0.00 | 8.62 | 44.04 | 45.00 / 123.51 |
| noisy bot | 11 | 4 | repeatLastAxesOnly | 0.96 | 0.00 | 8.62 | 43.09 | 45.00 / 123.51 |
| noisy bot | 11 | 4 | neutral | 3.83 | 0.96 | 14.36 | 39.26 | 45.00 / 123.51 |
| noisy bot | 16 | 4 | repeatLast | 3.83 | 0.00 | 75.64 | 64.15 | 45.00 / 125.43 |
| noisy bot | 16 | 4 | repeatLastAxesOnly | 3.83 | 0.00 | 35.43 | 55.53 | 45.00 / 125.43 |
| noisy bot | 16 | 4 | neutral | 15.32 | 0.00 | 45.96 | 39.26 | 45.00 / 125.43 |
| noisy bot | 25 | 4 | repeatLast | 18.19 | 3.83 | 153.19 | 160.85 | 38.30 / 126.38 |
| noisy bot | 25 | 4 | repeatLastAxesOnly | 18.19 | 1.91 | 55.53 | 115.85 | 38.30 / 126.38 |
| noisy bot | 25 | 4 | neutral | 45.96 | 1.91 | 64.15 | 39.26 | 38.30 / 126.38 |

D 0 (no playout buffer) changes only the teammate corrections, about 8-18 a minute more (bot L 11 `repeatLast`: 75.13
vs 61.60); every enemy, kill and phantom column is identical to D 4, the cheap plan's moves by a few. The sweep prints
the D 0 rows and a 20-metric
table per pass (every `ROLLBACK_LIVE_METRICS` count per minute).

What the bots say (not the answer: RBD4):
- Enemy corrections and undone kills grow steeply with L (bot `repeatLast`: 0 / 1.5 / 4.5 / 25.5 enemy corrections a
  minute at L 6 / 11 / 16 / 25). At today's measured lead (L 11-12, docs/FRAME_PACING.md) enemies pass the gate.
- Teammate corrections >= 1 tile fail the proposed gate at every L, even L 6 (27-31 a minute), with bots that move
  smoothly.
- `repeatLastAxesOnly` roughly halves the noisy bot's phantom bullets at L 16-25 (75.6 -> 35.4, 153.2 -> 55.5) and trims
  teammate corrections; `neutral` trades: more enemy errors always, fewer teammate jumps only for the noisy bot.
- The cheap plan's two numbers barely move with L and saturate: read them as "bullets fired / removed in view per
  minute", not as glitches comparable one for one.

Caveats: bots are not people (aim follows the walk; presses scripted); few bullets (10-19 enemy bullets alive, and the
knights fire none); one run per input, so one count is 1.50 a minute (bot) or 0.96 (noisy bot): the undone kills at
L 11 are 3 kills; (L, D) is fixed per pass, not measured.

### Mispredictions, humans (R4b live windows, R5 captures)

| Source | L mean / max | D mean / max | Strategy | Enemy corr. >= 0.5 /min | Undone kills /min | Phantom bullets /min | Teammate corr. >= 1 /min | Cheap plan: phantom / late bullets /min |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Studio and device checklist (owner)

Everything below is built and off by default. Run the steps in order; paste each result into this doc (the facts
under R3a, the numbers in Results) and tick the task once its Verify is met.

**Switches.** Workspace attributes (Explorer -> Workspace -> Properties -> Attributes, before Play; or the command bar,
server side while playing: Workspace attributes replicate to every client; in a live server, the Developer Console's
server command line, F9 > Server):

| Attribute | Side | Value | Does |
|---|---|---|---|
| `KV_RollbackSpike` | client | number H 1..64 (0 or absent: off) | the probe: CPU windows (H ticks a prediction) and, co-op parallel, live metrics (at horizon H); runs only while the server set `KV_RollbackAllowed` on the player (`KV_RollbackCapture` on) |
| `KV_RollbackSpikeMode` | client | `parallel` (default) / `serial` / `facts` | worker Actor / main thread / the R3a facts once (needs `KV_RollbackSpike` > 0) |
| `KV_RollbackDeviceTag` | client | string, e.g. "Pixel 6a" | appended to the device label; the dev panel's "Rollback probe device tag" field (F2) sets it |
| `KV_RollbackCapture` | server | boolean | takes probe / live summaries from the players the capture policy allows (Studio, DEV_MODE-allowed, everyone in a developer's private server; it sets their `KV_RollbackAllowed`) and captures co-op runs (Studio, an all-developer party, or a developer's private server). Needed in Studio too |
| `KV_Debug` | both | boolean | adds the once-a-second main hash check around the probe's work |
| `KV_AnalyticsDebug` | server | boolean | in Studio, prints the `RollbackCpu` / `RollbackProbe` events that a published place would send |

Set `KV_RollbackCapture` (server) and `KV_RollbackSpike` before the run starts: a co-op run already past tick 0 is
skipped until the next run. Changing any of the three client attributes (or `KV_RollbackAllowed`) restarts the probe.

**Pulling captures and probe rows** (after any session that wrote them):
1. Once: `npm run rollback:plugin` (builds `KalebValeRollbackCapture.rbxm` into Studio's Plugins folder), restart
   Studio. The place must be published, with Game Settings > Security > "Enable Studio Access to API Services" on
   (also needed for the server to write DataStores in Studio: without it the server logs `STORE_OFF` once).
2. On the laptop: `npm run rollback:receive` (listens on 127.0.0.1:34880; `--port`, `--out` to change).
3. In Studio, edit mode (not playing): Plugins > toolbar "Kaleb-Vale Rollback" > "Pull rollback captures". Allow the
localhost request the first time
   Studio asks. The plugin lists `KV_RollbackCapture_v1` and `KV_RollbackProbe_v1` and posts everything; the receiver
   writes `captures/<runId>.json` and appends `captures/probe/cpu.jsonl` / `live.jsonl` (one line per window: each
   stored row holds a player's minute of windows; lines already there are skipped). Nothing is deleted from the
   stores.
4. Replay: `npm run build` turns `captures/*.json` into gitignored modules; `npm run test:only --
   lockstep/rollbackSpike/model` replays each capture to its server hash (the spec fails on a miss) and prints a
   short report at L 11, D 4;
   `npm run test:only -- lockstep/rollbackSpike/model.sweep --flag rollbackSweep` sweeps the bots and every capture
   (a capture whose replay misses the server's hash is printed and skipped).

**Steps.**
1. **Off leaves nothing (R3).** `npm run verify`, `npm run dev`, Play with no attribute set. In
   `Players.<you>.PlayerScripts.TS.rollbackWorker` the `worker` LocalScript is Disabled and nothing runs; there is no
   `KV_RollbackWorker` Actor, no `[Rollback]` line, no spike HUD line.
2. **Facts (R3a).** `KV_RollbackSpike` 16, `KV_RollbackSpikeMode` `facts`, Play solo, open the MicroProfiler (Ctrl+F6)
   for the label part. Copy every `[RollbackFacts] ...` line from the Output into R3a: the worker ready; the sim built
   in the serial phase and stepped desynchronized with a hash equal to the main thread's; what a `SendMessage` table
   (nested, double reference, metatable), a `buffer` and a `SharedTable` arrive as (copied or shared); the reply
   BindableEvent with a buffer; binding to a second Actor's messages; whether `kv.rollback.facts` shows on worker
   threads in the MicroProfiler; the main frame time with a 5 ms and a 20 ms parallel task per frame vs the baseline and
   vs the same task on the main thread. Adjust Design 5 to the answers.
3. **Parallel probe, solo (R3).** `KV_RollbackCapture` on (server), `KV_RollbackSpikeMode` `parallel` (or absent),
   `KV_RollbackSpike` 16, `KV_Debug` on. Start a solo endless run. Expect `[Rollback] probe on: H 16, parallel`, `worker
   ready after .. s`, the HUD line `ROLLBACK parallel H16 | tick .. total .. ms over .. fr | hash ok N | 10s p95 total
   .. clone .. .. fps | send .. ms`, a `[Rollback] ...` CPU line every 10 s on the client and `[Rollback] CPU: ...` on
   the server (Developer Console > Server). Play 10 minutes: "hash ok" keeps counting (a mirror hash mismatch stops the
   probe and prints both hashes), no main hash warning. Note the frames per prediction and whether `kv.rollback.copy` /
   `.step` / `.send` show in the MicroProfiler. Then the dense case: dev mode (docs/DEV_MODE.md, F2) floor 15, and a dev
   run with the vault override (`KV_TreasureDebug`): the mirror must follow without a mismatch.
4. **Parallel probe, co-op (R3, R4b).** Test > Clients and Servers, 2 players, `KV_RollbackSpike` 16 and
   `KV_RollbackCapture` on (server), start a co-op run from a lobby. Both clients show the HUD line with `live fr ..`;
   the server prints `[Rollback] CPU:` every 10 s per client and `[Rollback] LIVE:` every 60 s (with `pred N/M fr`:
   predictions over main frames). After two minutes, pull (above): `captures/probe/cpu.jsonl` and `live.jsonl` have one
   line per window (the store holds at most one row a minute per player).
5. **Serial (R3).** Solo only, `KV_RollbackSpikeMode` `serial`, H 16: the HUD line and CPU windows as in step 3 (frames
   per prediction 1); the frame time shows the cost. A run with more than one player is refused (`serial mode is solo
   only`).
6. **Capture (R4).** In step 4's session, finish the co-op run (die, win or leave). The server logs `CAPTURE_START`,
   then `CAPTURE_ENCODED` (size) and `CAPTURE_WRITTEN`. Pull, then build and run the model spec (Pulling, 4): the
   capture replays to the server's hash. Check large bodies: a long run (or several) still pulls (receiver cap 64 MB).
   Stop a Play session with a co-op run open (or right after one ended, while its capture waits for the verdict):
   `BindToClose` writes it with status `shutdown`, and the buffered probe rows.
7. **Analytics (R4).** In Studio with `KV_AnalyticsDebug` on, the server prints
   `[Rollback] ANALYTICS_STUDIO: (not sent) ...` for `RollbackCpu` / `RollbackProbe`. In a published place they reach
   the Creator Hub's custom events after up to a day.
8. **Live metrics under lag (R4b).** Studio Network settings: Incoming Replication Lag 100 ms, two clients, co-op run,
   `KV_RollbackSpike` 16 parallel: `[Rollback] LIVE:` lines print with L and D near the run's lead; capture the run and
   compare its live rows with the sweep's capture row at the nearest (L, D).
9. **Devices and playtest (R5).** A published place, a private server owned by a DEV_MODE-allowed account,
   `KV_RollbackCapture` on (server console). Per device (PC, iPhone, mid Android, low Android; a 120 Hz screen if
   available): type the device into the dev panel's device tag, `KV_RollbackSpike` 8 / 16 / 24 parallel (and serial
   on the PC, solo), the Design 5 cases (floor 15 one room and whole floor, a boss fight, walking; solo and a party),
   MicroProfiler screenshots kept (on a phone: Settings > MicroProfiler On, then a laptop browser at the address the
   phone shows). Then a 20-30 minute co-op playtest with friends on their own connections, parallel only, capture on.
   Pull everything; fill the Devices and humans tables in Results (the `cpu.jsonl` / `live.jsonl` rows carry every
   field); at least three captures.

## Risks

- **Bots are not people.** Their aim follows their walk, so they under-state wrong guesses. Only human captures (R4,
  R5) decide (RBD4).
- **Headless timing is not a device.** Lune runs without fast paths or native codegen, so the headless numbers are
  pessimistic; R5's device numbers decide Q1.
- **Capture size.** Bots encode to about 6.6 bytes a tick for a 3-player party (about 1 MB of base64 for 30 minutes,
  one chunk); human inputs encode larger and are measured in R5. Chunked under the DataStore limit either way.
- **A hidden shared reference in the copy** would make the probe or the model corrupt the real state. R1's checks and
  R3's hash check catch it.
- **The probe costs frames.** Off by default. The parallel mode keeps the work off the main thread, but Roblox does not
  document how a long parallel task affects the frame (its guidance: long computations can still cause lag), so the
  work runs in slices and R3a measures it; the serial mode is never on with other players.
- **Parallel Luau's undocumented corners** (message types, worker labels in the MicroProfiler, frame effects) are
  checked first, in R3a, before anything is built on them.
- **The worker mirror drifts** (a config built differently from the main one). The 600-tick hash check stops the probe
  and prints both hashes.
- **Native code only on Android.** iPhones run the sim interpreted (Roblox's docs), so an iPhone may fail a gate an
  Android phone passes; the device table keeps them apart.
- **What it does not measure:** how rollback's corrections look after smoothing, sound and effect dedup in practice,
  and memory pooling. Those belong to a build plan if R6 says build.
