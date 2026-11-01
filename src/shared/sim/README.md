# shared/sim

The deterministic 60 Hz simulation, ported from the web build's `src/sim` (`project-kaleb-vale` @ `42897e2`). Replaying
a recording must reproduce the web build's `hashState` bit for bit (golden fixtures in `fixtures/`).

Import from `shared/sim` (the `index.ts` barrel). Inside the sim, modules import their siblings directly (a barrel
import from inside would create require cycles).

## Rules (enforced headlessly for everything here except `*.spec.ts`)

- Plain TypeScript: no Roblox services, Instances, datatypes, Enums, Flamework, clocks or `math.random`.
- Same rules as the source's `src/sim/README.md`: the `InputFrame` is the only input, no trig, fixed iteration order,
  every state field hashed (append to the module's `write*Hash` AND its dump names).
- JS-isms are ported deliberately: `shared/jsmath` (`u32`, `i32`, `imul`, `jsRound`, `jsRem`, `jsMax` / `jsMin`,
  `stableSort`), `./jsnum` (`Number.isFinite` / `isInteger`, `String(number)`), explicit `!== 0` instead of number
  truthiness, `bit32` on uint32 values, `error(msg, 0)` for exact error messages.
- No getters / setters. Port renames: `Rng.state` -> `getState()` / `setState()`, `FixedStepLoop.alpha` ->
  `getAlpha()`, `Recorder.length` / `.recording` -> `size()` / `getRecording()`, `SimCtx` getters -> fields refreshed
  by `bind()`, bullet pool `activeCount` -> a plain field. `null` -> `undefined` (empty loadout slots, `roomAt`).
- Hooks on defs (`WeaponDef`, `ArchetypeDef`) are METHODS: implement them with method syntax (roblox-ts calls them with
  `:`). Config callbacks (`moveResolver`, `isBulletBlocked`, `actorMover`, `actorSteerMover`) are callback properties
  (arrow functions). Each takes an optional trailing `solid` (shared/dungeon `SolidCells`: the intact breakables'
  cells, `breakables/cells.ts` `solidCells(state)`), which the sim passes at its call sites (movePlayer, moveActor);
  undefined (no breakables state) is exactly the grid-only path. Line of sight calls the blocker with (x, z) only.

## Modules

| File | Source | What |
| --- | --- | --- |
| `units.ts` | `src/config.ts` | `SIM_HZ`, `SIM_DT`, `TILE_SIZE` (camera / render numbers are in `shared/config`) |
| `jsnum.ts` | (port helper) | `isFiniteNumber`, `isIntegerNumber`, `jsTrunc`, `numberToJsString`, `SQRT1_2` |
| `json.ts` | (port helper) | strict `JSON.parse` for recordings (`parseJson`, tagged values, `JSON_NULL`) |
| `rng.ts` | `src/sim/rng.ts` | mulberry32 on uint32 words: `seedToState`, `rngNext`, `rngInt`, `Rng` |
| `input.ts` | `src/sim/input.ts` | `InputFrame`, `Button`, quantization (`jsRound` halves), `isDown`, `wasPressed`, `isValidInput` |
| `loop.ts` | `src/sim/loop.ts` | `FixedStepLoop` (5-tick cap, alpha in [0, 1)) |
| `playerData.ts` | `src/sim/playerData.ts` | player tunables, `secondsToTicks` |
| `player.ts` | `src/sim/player.ts` | `stepPlayer`, `movePlayer`, `damagePlayer`, respawn / refill, `writePlayerHash` (+ dump names) |
| `state.ts` | `src/sim/state.ts` | `SimState`, `createSimState`, `cloneSimState`, `SimEvents`, `clearEvents` |
| `step.ts` | `src/sim/step.ts` | `step`, `SimConfig` (+ `MoveResolver`, `BulletBlocker`, `ActorMover`), `DEFAULT_SIM_CONFIG`; Roblox: `stepParty`, `forfeitSoloRun` |
| `replay.ts` | `src/sim/replay.ts` | `Recorder`, `runReplay`, `writeHashFields`, `hashNumbers` (FNV-1a over `buffer.writef64` bytes), `hashState`, `serializeRecording` / `deserializeRecording` (same messages), `float64Hex` / `float64FromHex` |
| `recordingCodec.ts` | (Roblox only) | `encodeRecording` / `decodeRecording`: the compact binary recording (`buffer`) the `submitRun` remote carries; hostile-input-safe decode (docs/SERVER.md "The wire format") |
| `observer.ts` | `src/sim/observer.ts` | `SimObserver` / `SimControls` types |
| `hashLayout.ts` | (port helper) | the hash split into the fixtures' six subsystems, with dump names (plus `endless`, then `score`, then `run`, then `party`, then `tutorial`, then `breakables`, then `drops`, each appended only when present) |
| `endless.ts` | (Roblox only) | endless mode: `SimConfig.endless` (`worldForFloor`), `SimState.endless` (floor, Depth, stairwell, rooms entered), `stepEndless` (Depth on a boss kill, floor clear points + stairwell / `DEBUG_FLOOR_BUTTON` -> next floor, deferred room spawns attached to score rooms), `writeEndlessHash` |
| `endlessData.ts` | (Roblox only) | endless tunables: hp scaling by floor / Depth, enemy bullet speed scaling (speed only, never the burst shape), stairwell radius, the debug floor-skip bit |
| `parity.ts` | (port helper) | `firstFieldMismatch`, `subsystemHashes`, `checkRunFixture` (whole-run parity), `replaySummary` (totals / firstTick / hitsBySource), `fixtureNumber` |
| `combat/` | see below | bullets, actors, archetypes, weapons |
| `score/` | (M2, new) | opt-in scoring (`SimConfig.scoring`; every endless run): `scoreData.ts` tunables, `score.ts` state / hooks / `stepScore` / `writeScoreHash` (the "score" hash subsystem, appended after `endless` only when `state.score` exists), Depth / floor from `state.endless` (`scoreDepth` / `scoreFloor`), deferred room records for endless floors (`buildDeferredScoreRooms`, `attachScoreRoomMembers`); see the file comment |
| `progression/` | (M2, new) | in-run progression, endless runs only (`SimState.run`, hashed as the "run" group after `score`): `progressionData.ts` tunables and the BOONS (12) / RELICS (4) / CURSES (4) tables; `runMods.ts` the per-player state (`run.players[i]`), THE accessor `runMods(state, playerIndex)` + helpers (`playerHitDamage`, `attackTicks`, `rollIframeTicks`) and gameplay hooks (`runOnPlayerHit`, `runSecondWind`, `runOnKill`, `consumeEnemyBulletTimeScale`), a leaf module; `progression.ts` the draft (`drawBoonOffers`, `openDraft`, `stepDraft`, `draftColumn`), `grantBoon` / `grantRelic` / `acceptCurse`, `stepRun` (pedestals, shrine, Warding), `writeRunHash`; see the file comments |
| `partyData.ts` | (Roblox only) | M4 co-op tunables: MAX_PARTY_SIZE 8, enemy hp x [1, 1.6, ... 4.4] by party size, the revive hearts, the server's `PARTY_LEFT_BUTTON` bit (= `FORFEIT_BUTTON`, the solo "Leave run"; see "Solo forfeit") |
| `party.ts` | (Roblox only) | M4 co-op: `SimConfig.party`, `SimState.party` (players by index, [0] aliasing `state.player`), `playerAt` / `weaponsAt` / `partySize`, nearest-living targeting, leave / revive, `writePartyHash` (the "party" group); see "Co-op" below |
| `tutorial/` | (Roblox only) | first-run tutorial (docs/TUTORIAL.md): `tutorialData.ts` tunables (`TUTORIAL_START_HALF_HEARTS`, the start clamp), `tutorial.ts` `SimConfig.tutorial` (`TutorialSimConfig`: `harmless`, `startHalfHearts`, `bossHpPercent`), `SimState.tutorial` (`TutorialState`: `harmless`, `harmlessHits`, `bossHpPercent`), `tutorialBossHp`, `isTutorialHarmless`, `writeTutorialHash` (the "tutorial" group, last); see "Tutorial" below |
| `breakables/` | (Roblox only) | breakable barrels and crates (docs/DECOR.md D4): `breakablesData.ts` tunables (B4 toughness as hp = arrow hits x the bow's damage, the enemy bullet's share, hit / slam radii, `BreakableKind`, `BreakableSource`), `breakables.ts` `SimConfig.breakables` (`BreakablesConfig`, the game's `BREAKABLES_CONFIG`), `SimState.breakables` (pieces: kind, cell, hp, brokenTick; the derived cell -> slot lookup and intact count, never hashed), `damageBreakable`, the melee pass, the slam, `writeBreakablesHash` (the "breakables" group, last); `cells.ts` the leaf lookups (`solidCells`, `breakableSlotAt`) the movement code reads; see "Breakables" below |
| `drops/` | (Roblox only) | boost drops (docs/BOOSTS.md B1-B3): `dropsData.ts` tunables (a leaf: `Boost` / `BOOSTS` Fury / Quickstep / Frenzy / Aegis, the percents, `DROPS` chance / pity / ground life / pickup radius / slots, `DEBUG_DROP_BUTTON`), `drops.ts` `SimConfig.drops` (`DropsConfig`, the game's `DROPS_CONFIG`, the tutorial's `guaranteedDropsConfig`), `SimState.drops` (`DropsState`: its own rng word, pity, ground slots, guards, per-player timers and Aegis pips; presentation `events`), `dropsOnKill` (killActor), `dropsOnRoomSpawned` (enterRoom), `stepDrops`, `ENDLESS_DROPS_CONFIG` (+ `breakableLoot`), the client's read helpers, `writeDropsHash` (the "drops" group, last); `boostMods.ts` the effect reads (a leaf: Fury / Frenzy percents for runMods, Quickstep's walk percent, `absorbWithAegis`, `boostsOnPlayerDied`); `breakLoot.ts` boosts from breakables (a leaf, docs/BREAKABLE_DROPS.md: `dropsOnFloorPieces` from createSimState / nextFloor fills `pieceLoot` from the floor's `breakableLoot`, `dropsOnBreak` from `damageBreakable`'s break line lands it; `landDrop` / `lowestFreeDropSlot`, which drops.ts uses); see "Boost drops" below |
| `testing/` | `src/sim/actors/__test__/testArchetypes.ts` | test-only archetypes for specs (never imported by the game) |

`SimConfig.moveResolver` has the source's signature and call contract (sub-steps of at most `MAX_MOVE_STEP`, one call
per walking tick, two per roll dash tick), so `circleMover(dungeon, PLAYER_RADIUS)` from `shared/dungeon` (task 5)
plugs in unchanged; then `run-player-dungeon-1337.json` can be checked with `checkRunFixture`.

## Combat

`createSimState` builds `CombatState`, `step` calls `stepCombat` and `hashState` includes `writeCombatHash`, exactly as in
the source. It is EXACT against every golden run: player-only (`run-player.json`, `run-player-dungeon-1337.json`), the
bullet run (`run-bullets.json`), and the real game with every archetype (`run-full-1337.json`: 21 kills, the boss
fight, the player's death; `run-boss-1337.json`: all three boss phases, slams with swarmer summons) on every tick,
every subsystem hash, every event and every dump field.

The bullet library (`@k9kbdev/r3f-projectiles` 0.6.0, MIT) is ported in `combat/bullets.ts` (the pool) and
`combat/projectilePatterns.ts` (`gen.arc`, `mod`, `compose`, `definePayload`); both keep the library's license header.
`gen.arc` never calls `math.sin` / `math.cos`: it reads V8's values for the burst shape from `combat/arcTable.ts`,
GENERATED from `fixtures/arc-table.json` (generator in its header; `bullets.spec.ts` checks it bit for bit). A new
burst shape (an archetype with a new count / spread) errors with `arc table miss ...` until the web build's exporter
lists it and the table is regenerated. Roblox port: shapes only the port's own archetypes fire (the Demon Lord's cleave
and hellfire arcs) are rows in `combat/arcTablePort.ts` (sin / cos from shared/dungeon's deterministic `dsin` / `dcos`,
merged into the same lookup, never shadowing a web shape; `arcTablePort.spec.ts`).

| Path | Status | Owner |
| --- | --- | --- |
| `combat/combat.ts` | ported: state, `createCombatState`, `startCombat`, `cloneCombatState`, `stepCombat` order, stress emitter, enemy / player / piercing collision callbacks, `countActors`, hash writers | done |
| `combat/combatData.ts` | ported (checked against constants.json) | done |
| `combat/payload.ts` | ported: `BulletPayload = definePayload(...)` (`get` / `with` / `pack` / `max` / `shift`, dev-build range checks, checked against `payloadLayout`) | done |
| `combat/patterns.ts` | ported: `BulletKind`, `BurstSpec`, `FULL_RING`, `packPayload`, `fireBurstRaw` / `fireBurst` (`finishBurst`), `rotateDir` / `turnDir` / `halfRotation` / `aimAt` | done |
| `combat/bullets.ts` | ported r3f-projectiles `SimulationCore`: sparse-set pool (LIFO free stack from slot 0, swap-remove, backward walks), `step`, `clear`, `forEachActive`, `writeStateHash`, emitters, interpolation (`previousPositionAt`), read access for the renderer; spawn-data pool | done |
| `combat/projectilePatterns.ts`, `combat/arcTable.ts` | ported `gen.arc` (table trig), `mod.payload` / `color` / `scale`, `compose`, `definePayload`; generated V8 sin / cos table | done |
| `combat/stress.ts` | `MAX_STRESS_BULLETS`, `stressTargetFrom` (the source's `stressFromQuery` for a debug attribute), `stressConfig` | done (task 8 reads the attribute) |
| `combat/ctx.ts` | `SimCtx` ported (`lineOfSight` = the tile DDA in `shared/dungeon`) | done |
| `combat/actors/types.ts`, `registry.ts` | ported (registry sorts ids by code unit; index table `boss.act1, bruiser, sniper, swarmer, turret.caster, turret.sniper, turret.sprayer`, checked against every run fixture and constants.json; Roblox port: `def.band` numbers the port's own archetypes after that table, e.g. the tutorial's `dummy` = 7) | done |
| `combat/actors/encounter.ts` | re-exports the canonical `EncounterConfig` / `ActorSpawn` / `EncounterRoom` / `EMPTY_ENCOUNTER` / `roomAt` from `shared/dungeon` (encounterTypes.ts), so `placeEncounter(d, DEFAULT_ENCOUNTER)` IS a `SimConfig.encounter` | done |
| `combat/actors/actors.ts` | ported: pool (lowest free slot, MAX_ACTORS, actorsDropped), `spawnActor`, `damageActor` (filterDamage -> sliding 2 s damage cap over 12 buckets of 10 ticks -> hp -> flash -> onHit -> death), `killActor`, `reviveActor`, `freeActor`, `stepActors` (slot order, `while` loop: runtime spawns append slots), `stepContactDamage`, hash writers | done |
| `combat/actors/helpers.ts` | ported: `toPlayer`, `faceToward`, `moveActor` (actorMover sub-steps / bounds clamp / free), `walkToward`; re-exports `lineOfSight` from `shared/dungeon`. Roblox addition: `walkToward(..., steer)` moves with `SimConfig.actorSteerMover` when set (endless floors: `actorSteerMover(dungeon)`, which rounds solid pillars); only the room enemies' walks pass `STEER` (enemyShared.ts), the boss's charge / reposition stay plain; absent (M1, every fixture) it is the web build's | done |
| `combat/actors/archetypes/*` | ported: `enemyShared` (aggro, pack alerts, leash), `swarmer`, `sniper`, `bruiser`, `turretShared` + `turret.{caster,sniper,sprayer}`, `boss/act1` (Mother Bramble: wake / seal, 3 phases at 66 % / 33 %, fans, gapped rings, spiral, phase-3 slam with swarmer summons, DEBUG_BOSS). Roblox port: the fight skeleton is `boss/shared.ts` (moved out of act1, bit for bit), shared with `boss/demonlord` (the Demon Lord, band 2, index 8; docs/BOSS_DEMONLORD.md). The index re-exports every archetype's states, slots and data | done |
| `combat/weapons/*` | ported: types, registry, loadout, `stepWeapons`, `writeWeaponsHash`, `sweepArc`, defs `weapon.sword` / `weapon.bow` / `weapon.test` / `weapon.test.melee` (index table = the web build's) | done |

Test-only archetypes (`test.dummy`, `test.chaser`, `test.boss`) live in `testing/` (import `shared/sim/testing` from a
spec, before the first `createSimState` seals the registry). Port deviation: `test.boss` fires a 16-bullet ring (the
source: 12) because gen.arc's sin / cos come from the arc table, which only holds shapes the game fires.

## Tests

| Spec | Checks |
| --- | --- |
| `rng.spec.ts` | `fixtures/rng.json` sim sequences, states, int samples, edge seeds; source rng tests |
| `hash.spec.ts` | `fixtures/hash.json` vectors (NaN, -0, subnormals) and `freshState` field by field |
| `input.spec.ts` | `fixtures/input.json` (quantization incl. halves / -0, dequantize table, buttons, validity, recording (de)serialization and error messages); source input tests |
| `constants.spec.ts` | `fixtures/constants.json`: every ported module constant, derived steps, weapon table, payload layout |
| `runPlayer.spec.ts` | `fixtures/run-player.json`: hash every tick, six subsystem hashes every tick, events, dumps at 0 / 1 / 60 / 600 field by field, final summary |
| `loop.spec.ts`, `player.spec.ts`, `step.spec.ts`, `determinism.spec.ts`, `weapons.spec.ts` | the source's unit / determinism tests for these modules |
| `jsnum.spec.ts` | JS number printing and the JSON reader |
| `runBullets.spec.ts` | `fixtures/run-bullets.json`: hash and six subsystem hashes every tick, events, totals, dumps at 0 / 1 / 60 / 300 (every live bullet by slot), final summary |
| `bullets.spec.ts` | pool order (slots, swap-remove, LIFO reuse, backward walks, hash order), step arithmetic (incl. -0 velocity), culling, delay, emitters, the arc table vs `fixtures/arc-table.json` bit for bit, `gen.arc` / `compose` / `mod`, `fireBurstRaw`, `definePayload` |
| `combat.spec.ts`, `bow.spec.ts`, `stress.spec.ts` | the source's combat (turrets, Ember clear, dungeon walls, hash / clone), bow (piercing heavy arrow) and `stressFromQuery` tests |
| `constants.spec.ts` (archetypes) | every archetype module constant and the archetype registry (index order + data) vs constants.json |
| `runFull.spec.ts`, `runBoss.spec.ts` | `run-full-1337.json` / `run-boss-1337.json` (the real game config): hash and six subsystem hashes every tick, events, dumps field by field, totals, firstTick, hitsBySource, final summary |
| `actors.spec.ts`, `enemies.spec.ts` | the source's actor pool / damage cap / contact damage / moveActor / lineOfSight tests and room enemy behaviour |
| `enemies.determinism.spec.ts` | scripted walkers vs replays, incl. docs/M1.md "Tuning notes" (bow rows with the current code, sword / default rows with the pre-retune sword they were measured with) |
| `bossAct1.spec.ts`, `bossAct1.ttk.spec.ts`, `bossAct1.weapons.spec.ts` | Mother Bramble: wake / seal, phases, attacks, telegraphs, summons, DEBUG_BOSS, TTK per weapon at the cap (matches the source boss README table) |
| `combat.determinism.spec.ts`, `swordBow.determinism.spec.ts` | live vs replay over 3600 ticks on dungeons 1337 / 42 with the real encounter |
| `encounterRun.spec.ts` | every `placeEncounter` kind is registered; the encounter spawns into slots in order through `createSimState` |
| `bench.spec.ts` | `step()` with ~1,000 stress bullets over 600 ticks; prints the mean (budget 2 ms) |
| `../dungeon/solidPillars.spec.ts` | solid pillars on endless floors (`ForgeParams.solidPillars`): the rng stream and every other piece unchanged, the floor still connected, nothing placed on a pillar; pillars block sight, bullets and bodies; `moveCircleAroundCorners` walks every enemy radius round a pillar and never into a wall |
| `../run/endlessPillars.spec.ts` | the same in a real endless floor's sim world: a swarmer and a bruiser chasing a player hidden behind a pillar reach them with the floor's `actorSteerMover` (and stall without it); an idle enemy does not see through a pillar |
| `../dungeon/endless.spec.ts`, `../run/endless.spec.ts` | endless floors (seeds, room counts, boss floors, budgets), scaling values, transitions, Depth, and a recorded 8-floor run (two stairwells walked, a boss kill) that replays and validates exactly |
| `score/score.spec.ts`, `score/score.replay.spec.ts` | M2 scoring: points per event, combo (the co-op cut by the players present), grazes, guard, rooms, floors (the rooms-cleared ratio and its rounding), hash; run-full-1337 replayed scored (deterministic, gameplay subsystems identical to the fixture) |
| `score/score.endless.spec.ts` | scoring on endless floors: one room record per room with deferred spawns (par from their encounter cost), members attached and the room engaged on the entry tick, clear / perfect / fast and floor-scaled kills, records rebuilt on a floor change after the floor clear |
| `progression/progression.spec.ts` | M2 progression: offers (distinct, unowned, rarity weights incl. the per-floor legendary ramp and cap, a hand-made twin of the draw, 20,000-draft frequencies, exhausted rarities), the draft (opens on a floor change, freezes every world group, early confirms ignored, stick + FIRE, held buttons quiet after it, replays identically), each boon / relic / curse at its application point (an open endless arena), the shrine once per floor, the "run" hash group and clone |
| `tutorial/tutorial.spec.ts` | tutorial harmless mode: bullets, contact and DEBUG_HIT land without armor / hearts / death, playerHits / hurtTicks / lastHitSource / combo cut / Hourglass as in a real hit, no Second Wind, startHalfHearts (solo, a party, the clamp), the flask heals back up, floor changes keep hearts, bossHpPercent (boss hp and hpMax x percent, other actors and runs untouched, validation, phase marks on the reduced hpMax), guardLock (arming only on its floor / room, the hold at TUTORIAL_GUARD_HOLD_HP, release on a block, validation, no hold without it), the appended "tutorial" group, clone, replay |
| `../run/slice.spec.ts` | the slice: the recorded endless run scored (replays twice to hash and score, floor clears by rooms cleared at the Depth in force, the boss at Depth 1), segmented per floor through `SegmentedValidator`, an edited later segment rejected |
| `../run/replay.bench.spec.ts` | server replay cost per tick on endless floor 15 at Depth 3 in combat, solo and 8 players, one room / the whole floor (docs/SERVER.md "Replay capacity") |
| `breakables/breakables.spec.ts` | breakables: opt-in state, the appended group and its dump names, clone; B4 hit counts vs SWORD_DATA / BOW_DATA; players, plain and steered enemy walks and bullets blocked (LOS not); every damage source (bow, sword, guard none, heavy arrow pierce on a break only, enemy bullets, the slam in a real fight); scoring without the combo; an endless run's floor rebuild; co-op; a replay |
| `../dungeon/breakables.spec.ts` | breakable placement (R11): determinism, its own stream, every placement rule, BFS reachability and counts per band over the census floors; the collision functions with and without `solid` |
| `drops/drops.spec.ts` | boost drops: opt-in state, the appended group (names, guards, clone, party size), the own stream (state.rngState and boon offers unchanged), draws per case, eligibility (turrets, the dummy, bosses, the boss room, any kill while a boss fight is on), pity at exactly pityKills, the cap, kind weights, pickups (slot then player index, landing tick, never the dead), expiry, refresh, timers, draft freeze, floor change, death / forfeit / leave clears, DEBUG_DROP_BUTTON, the tutorial guarantee, a replay |
| `drops/boosts.spec.ts` | boost effects: neutral paths (===), Fury exact for every damage number with / without Sharpened and the boss cap still binding, Frenzy's integer combined percents (sword, bow), Quickstep's two sub-steps / roll unchanged / no wall or crate tunnelling, Aegis before armor, never refilled by Warding, before Second Wind, untouched by harmless mode |

## Co-op (M4, Roblox port)

Opt-in through `SimConfig.party` with `size` 2..8 (shared/run `buildEndlessRunConfig(seed, partySize)` /
`buildWorldSetup(kind, seed, { partySize })`). Without it there is no `state.party`, `step()` runs exactly as before
and nothing extra is hashed, so every fixture, every solo endless hash and score is unchanged. With it every tick takes
one InputFrame per player: `stepParty(state, inputs, config)` (step() refuses a party state). Player 0 is
`state.player` with `state.combat.weapons` (hashed where they always were); players 1..n-1 live in `state.party` and
are hashed in the **party** group, appended after `score` and `run` (only `tutorial` and `breakables` come after it).

Every per-player loop runs in player index order; ties go to the lower index:

| Phase | Co-op rule |
| --- | --- |
| stepParty 2 | a frame with `PARTY_LEFT_BUTTON` marks the player `left` (dead, never revived); then (no draft open) stepPlayer per player with its own PlayerState, weapons and player index |
| draft (M2) | while ANY player's boon draft is open the tick is only stepDraft: each player picks with their own input; the world stays frozen until every present player confirmed (a player who leaves has theirs closed without a pick) |
| stepCombat 2 | `SimCtx.player` = each actor's target, the nearest LIVING player (squared distance; nobody alive: player 0), bound before its step / stepDead (aggro, aim, lunges, boss targeting and engagement all read it); the boss seals EVERY player into its arena |
| stepCombat 4 | each player's weapons (`ctx.bindPlayer(i, inputs[i])`: player / weapons / input), each seeing only its own `weaponSwapped` |
| stepCombat 6 | enemy bullets: graze flags against the nearest living player, then a hit on the first player in range whose hit lands (per-player armor, i-frames, post-hit invulnerability); player bullets carry their owner as the emitter id (player i: i + 1, kept per slot through swap-remove, hashed), bound as `ctx.player` while they damage |
| stepCombat 7 | contact damage per living player |
| stepEndless | run over when EVERY player is dead; the floor ends when every LIVING player is in the stairwell zone, or on any player's debug floor skip; then everyone moves to the entrance, the dead (not left) come back with `PARTY_REVIVE_HALF_HEARTS`, everyone's armor / flask / Embers refill; each living player can enter rooms |
| spawn (endless) | hp x `partyHpMultiplier(n)` (bosses too); room budgets x `PARTY_BUDGET_MULTIPLIERS` (shared/dungeon), still capped at ENDLESS_ROOM_ACTOR_CAP per room and MAX_ACTORS (no waves) |
| scoring | one team score; `partySize` = n (hashed); the combo hit cut is 1 / max(2, p) with p = the players PRESENT (not `left`) at the tick of the hit (`presentPlayerCount`); any player's kill / graze feeds the combo, any landed hit cuts it, a dead player never grazes, a room engages when any living player is in it |
| stepRun (M2) | a floor change opens a draft for EVERY player who has not left (offers drawn in player index order from the sim rng, excluding only that player's boons); pedestals go to the first living player on them (index order) with a relic left, from THEIR unowned set; the shrine to the first living player in its zone pressing SKILL1 (their curse; the shrine is then used for everyone); Warding per living owner |

M2 progression in co-op (progression/runMods.ts; Phase B integration). Personal modifiers use the player the rule is
about, from the bound context: damage (Sharpened), bow pierce, cooldown / recovery (Swift Strikes), the Ember Wake ring
(the acting player's own roll start, `rollTicks === ROLL_TICKS`) and Mirror Cloak (reflected bullets carry the
guarding player's emitter) are the ACTING / OWNING player's (`ctx.playerIndex`: the weapons phase binds each player,
a player bullet's hit binds its owner); roll i-frames (Slippery), the Hourglass trigger and Second Wind the HIT
player's; Vampire Fang and Bounty the KILLER's (`ctx.playerIndex` when killActor runs); the graze radius (Daredevil) the
grazing player's. One-off grants (Hearty, Deep Flask, Warding, Frailty, Thirst) write that player's PlayerState.
Team-wide (`team*` accessors, one value for the world): the combo window (Lingering if any living player owns it,
Impatience once if any player took it), the hit cut (Composure if any living player owns it), enemy bullet speed
(Haste once if any player took it), the Hourglass slow (global while any player's timer runs); the score's curse
multiplier counts every accepted curse (+0.25 each). "Living" falls back to everyone when nobody is alive, so a solo
run's dead player keeps their boons exactly as before. Per-player presentation events: `run.players[i].events` (the
client's toasts for its own player); `run.events` keeps the last of any player's.

Events stay party-wide (e.g. `playerHits` counts hits on anyone). Recordings: `Recording.others` holds players
1..n-1's streams (`Recorder.recordParty`, `runReplay` steps them with stepParty); the binary codec's version 2 carries
them (recordingCodec.ts). Specs: `party.spec.ts` (state, targeting, hits, ownership, codec), `../run/party.spec.ts`
(scripted 2- and 8-player endless runs, floor rules, scaling, segmented validation), `../lockstep/lockstep.spec.ts`,
`progression/progression.party.spec.ts` (M2 rules per player and team-wide, drafts, pedestals, the shrine in co-op),
`../run/partyProgression.spec.ts` (a scripted 2-player run with different drafts, a relic and a curse: replayed twice,
through the codec and SegmentedValidator).

## Endless mode (Roblox port)

Opt-in through `SimConfig.endless` (shared/run `buildEndlessRunConfig`, which also sets `scoring`: endless runs are
always scored). Without it no endless code runs and the hash has exactly the fixtures' six groups, so every golden run
is unchanged. With it, each tick runs with the current floor's SimConfig (`simWorldConfig`), `stepEndless` runs after
`stepCombat`, and `writeHashFields` appends the `endless` group (then `score`).

The full tick order (step.ts; co-op `stepParty` runs the same phases, every per-player one in player index order, with
the party's leave bits handled right after the event clears):

| # | Phase | Only when |
| --- | --- | --- |
| 1 | `clearEvents` | |
| 2 | `clearScoreEvents`, `clearBreakableEvents`, `clearDropsEvents`; then (solo) `FORFEIT_BUTTON` -> `forfeitSoloRun` | `state.score` / `state.breakables` / `state.drops` (the forfeit: always) |
| 3 | `stepPlayer` (current floor's config in endless) | |
| 4 | `stepCombat` (kills score here: `scoreKill` in killActor, grazes, guard cancels; breakables: movers get `solidCells`, the sword's melee pass, the slam, bullets vs pieces after the wall test; drops: `dropsOnKill` in killActor, before onDeath; `dropsOnBreak` when a loaded piece breaks) | |
| 5 | `stepEndless`: boss kill -> Depth + 1; dead -> stop; stairwell / debug skip -> `awardFloorClear(floor, bossFloor, bossDead)` (floor(1000 x floor x rooms cleared / enemy rooms), the boss one more room on a boss floor, the full 1000 x floor without enemy rooms; then the multipliers), next floor, `resetBreakables` (the new floor's pieces), `rebuildScoreRooms`; first room entry -> deferred spawns -> `attachScoreRoomMembers` | `state.endless` |
| 6 | `stepRun` (M2): a floor change -> the new floor's pedestals / shrine, Second Wind re-armed, a boon draft opens for every present player (offers from the sim rng, player index order); nobody alive -> stop; a room's spawns -> Warding refills each living owner's armor; pedestals (first living player on one, relic from the sim rng); the shrine (first living player in the zone with a SKILL1 edge -> their curse from the sim rng + `addCurse`) | `state.run` |
| 7 | `stepDrops`: a floor change frees every ground slot and guard; DEBUG_DROP_BUTTON drops; boost timers (player, kind order); ground life (slot order); pickups (per slot the first living player in reach) | `state.drops` |
| 8 | `stepScore`: final-phase window, hit cuts, combo timer, room engagement / clears | `state.score` |
| 9 | `tick += 1` | |

While a boon draft is open (`isDraftOpen`: ANY player's) a tick is only: `clearEvents`, `clearScoreEvents`,
`clearRunEvents` (co-op: then the leave bits), `stepDraft` (per player with an open draft: the stick's
screen-horizontal component selects a card, a FIRE press edge after `DRAFT_MIN_OPEN_TICKS` takes it; every player's and
their weapons' `prevButtons` follow their input), `tick += 1`. Nothing else moves: no actor, bullet, timer or score
phase runs and nobody can be hurt.

Every personal M2 boon / relic / curse modifier is read through `runMods(state, playerIndex)` or a helper taking a
player index (progression/runMods.ts), team-wide ones through the `team*` accessors (see "Co-op" above for which player
each rule uses; a solo run is player 0 everywhere). Application points:
damage when a player bullet / melee hits (combat.ts `playerBulletHit` / `piercingBulletHit`, sword.ts), sword
recovery and the generic weapon cooldown (sword.ts, weapons.ts), bow pierce (bow.ts), the roll ring (weapons.ts),
roll i-frames, Second Wind and the Hourglass trigger (player.ts), the enemy bullet time scale and the graze radius
(combat.ts), enemy bullet speed (ctx.ts `fireEnemy`), Vampire Fang (actors.ts `killActor`), Mirror Cloak (sword.ts
guard -> melee.ts `sweepArc` reflect), combo window / hit cut / kill points (score.ts).

So a boss kill scores at the Depth before it (4 before 5), and the floor clear of the floor a boss died on already
uses the new Depth. Hash order: `core`, `combatHeader`, `actors`, `weapons`, `enemyBullets`, `playerBullets`, then
`endless`, then `score`, then `run` (players.length = the party size; per player boons, relics, curses, draftOffers (length + values),
draftOpen, draftTicks, draftSelected, hourglassTicks, fangKills, secondWindUsed; then pedestals.length, (room, taken)
per pedestal, shrineRoom, shrineUsed; dump names `run.players[0].boons[1]`, `run.pedestals[0].taken`, ...), then
`party` (co-op only: size, left[0..n-1], then per player 1..n-1 the player fields and their weapons), then `tutorial`
(tutorial runs only: harmless, harmlessHits, bossHpPercent, guardLockFloor, guardLockRoom, guardLock, guardLockFirstId,
guardLockEndId; dump names `tutorial.<field>`), then
`breakables` (runs with SimConfig.breakables, i.e. every endless run: pieces.length, then per piece kind,
x, y, hp, brokenTick; dump names `breakables.length`, `breakables[0].hp`, ...), then `drops` (runs with SimConfig.drops;
always last: rngState, killsSinceDrop, debugNextKind, ground.length, per slot kind / x / z / spawnTick / ticksLeft,
guards.length, per guard kind / ids.length / ids, players.length, per player ticks.length / ticks / aegisPips, and only
with `DropsConfig.breakableLoot` (endless: docs/BREAKABLE_DROPS.md) pieceLoot.length / pieceLoot; dump names
`drops.rngState`, `drops.ground[0].kind`, `drops.players[0].ticks[1]`, ...). The
per-tick `SimState.run.events` (draftOpened, draftChosen, relicCollected, curseAccepted, secondWind, fangHealed) and
each player's `run.players[i].events` are presentation only and not hashed. New per-tick events (not in `SIM_EVENT_FIELDS`, which stays the web build's list; see
`ENDLESS_EVENT_FIELDS` / `BREAKABLE_EVENT_FIELDS` / `ALL_EVENT_FIELDS`): `floorChanged`, `depthChanged`,
`stairwellOpened`, `roomEntered`, `breakableHits`, `breakablesBroken`.
`DEBUG_FLOOR_BUTTON` (8192) is a port bit outside `ALL_BUTTONS` (pinned by fixtures/input.json): `SIM_BUTTONS` /
`isValidSimInput` accept it, and the binary recording codec does too; the JSON recordings keep the web build's rules.

## Solo forfeit (L6a "Leave run counts as a death")

`FORFEIT_BUTTON` (partyData.ts) IS `PARTY_LEFT_BUTTON` (16384): one bit meaning "this player leaves the run for good"
(co-op: marked `left`; solo: dead). It stays outside `SIM_BUTTONS` (the lockstep relay keeps refusing it from clients);
the binary codec accepts it in both variants (`RECORDED_BUTTONS`). On a solo tick whose input carries it, step() calls
`forfeitSoloRun` right after the event clears: `killPlayerState` + `events.playerDied = 1`, the bookkeeping of a lethal
hit but no hit (no playerHits, armor, Second Wind or Hourglass), and an open boon draft closes without a pick (that tick
stays a frozen draft tick). Idempotent (a dead player: nothing). Everything downstream reads it as a death:
`isPartyWiped`, stepEndless / stepRun stop, the telemetry (`deathCause` "forfeit"), the server summary `died`. No new
state and no hash change: a run that never sets the bit steps exactly as before (every fixture unchanged). The client
side is `LiveRun.requestForfeit()` (shared/play). Spec: `forfeit.spec.ts` (+ `play/liveRun.forfeit.spec.ts`: the
validators accept it with died = true).

| Bit | Name | Where |
| --- | --- | --- |
| 1 .. 4096 | `Button.*` (`ALL_BUTTONS` 8191) | the web build's, fixtures/input.json |
| 8192 | `DEBUG_FLOOR_BUTTON` (`PORT_BUTTONS`) | endless debug floor skip (a debug bit) |
| 16384 | `PARTY_LEFT_BUTTON` = `FORFEIT_BUTTON` (outside `SIM_BUTTONS`; in `RECORDED_BUTTONS` 65535) | co-op leave (relay only) / solo "Leave run" |
| 32768 | `DEBUG_DROP_BUTTON` (`PORT_BUTTONS`; `SIM_BUTTONS` 49151) | boost drops: drop the next boost kind in front of the player (a debug bit) |

## Tutorial (Roblox port)

Opt-in through `SimConfig.tutorial` (`TutorialSimConfig`, tutorial/tutorial.ts; docs/TUTORIAL.md "Architecture §1").
Without it there is no `state.tutorial`, nothing extra runs and nothing extra is hashed, so every fixture and every
solo, endless and party hash is unchanged. With it createSimState creates `state.tutorial` (`harmless` 0/1,
`harmlessHits`, `bossHpPercent`, the guard lock's `guardLockFloor` / `guardLockRoom` / `guardLock` / `guardLockFirstId`
/ `guardLockEndId`), hashed as the **tutorial** group, appended after `party` (only `breakables` and `drops` come after it, and a tutorial run has no breakables).

| Rule | Where |
| --- | --- |
| `startHalfHearts`: every player (solo, every party member) starts with it, clamped to [TUTORIAL_MIN_START_HALF_HEARTS, heartsMax]; heartsMax is unchanged, so the flask heals back up; floor changes keep hearts (`refillAtCheckpoint` never heals) | createSimState (after the party exists, before the encounter spawns; no rng) |
| Scaling: endless enemy hp and enemy bullet speed scale as on floor `TUTORIAL_SCALING_FLOOR` (1) on every floor (`tutorialScalingFloor`), so the tutorial's floor-2 boss is the Depth 1 / floor 1 fight | spawnActor (actors.ts), SimCtx.fireEnemy (ctx.ts) |
| `bossHpPercent` (an integer >= 1, 100 when absent): a boss archetype (`data.boss`) spawns with hp x bossHpPercent / 100 (`tutorialBossHp`, after the endless and party scaling; exactly the hp at 100). Its phase marks are fractions of hpMax, so every phase still plays; the damage cap and the roar timers are unchanged | spawnActor (actors.ts) |
| `guardLock` ({ floor, room }; the block lesson, docs/TUTORIAL.md "Decisions" 9): when that room is first entered the lock arms on its deferred spawns (`tutorialOnRoomSpawned`; ids `guardLockFirstId` .. `guardLockEndId`; an empty spawn releases it). While armed a held actor never drops below `TUTORIAL_GUARD_HOLD_HP` (1): `tutorialHeldDamage` clamps the hp a hit removes (it still flashes, counts and calls onHit). The first sword guard sweep that erases an enemy bullet releases it for good (`tutorialOnGuardCancels`). Absent: nothing is held | enterRoom (endless.ts), damageActor (actors.ts), the guard (sword.ts) |
| `harmless`: a hit that lands (a positive amount, `isPlayerInvulnerable` false) does `events.playerHits += 1`, `hurtTicks = HURT_INVULN_TICKS`, `runOnPlayerHit` (Hourglass) and `tutorial.harmlessHits += 1`, then returns true (the bullet is consumed, `lastHitSource` is set, the score's combo cut runs from `playerHits`). Armor, hearts, Second Wind and death are skipped | damagePlayer (player.ts) |

`runStartHalfHearts(config)` (player.ts) is the start hearts createSimState gives a fresh player (START_HALF_HEARTS, or
the tutorial's): RunTelemetry's baseline on the client, the server and in lockstep, so a wounded start is not logged
as hearts lost. The tutorial world itself is shared/run `tutorial.ts`. The tutorial script (prompts, step completion)
lives outside the sim. Spec: `tutorial/tutorial.spec.ts`.

## Breakables (Roblox port, docs/DECOR.md D4)

Opt-in through `SimConfig.breakables` (`BreakablesConfig`; every endless run sets `BREAKABLES_CONFIG` in shared/run
`buildEndlessRunConfig`; the tutorial does not, docs/DECOR.md B7). Without it there is no `state.breakables`, no code
path below runs, every mover / blocker gets no `solid` argument and no `breakables` group is hashed, so every fixture,
M1 and the tutorial play exactly as before. One hashed difference remains: the appended score source BREAKABLES
widens the `score` group of every scored run by `score.points.breakables` / `score.counts.breakables` (always 0
without breakables), so the tutorial's and a `KV_Scoring` M1 run's state hashes differ from builds before it (no
fixture is scored). With it createSimState builds `state.breakables` from floor 1's pieces
(`EndlessFloorWorld.breakables`, placed by shared/dungeon `placeBreakables`; without endless mode from
`breakables.pieces`), and every endless floor change replaces them (`resetBreakables` in stepEndless).

| Rule | Where |
| --- | --- |
| Block movement: players and actors, plain and steered walks (a lone crate is rounded like a pillar) | movePlayer, moveActor: `solidCells(state)` as the movers' trailing argument |
| Block every bullet, after the wall test and before graze / players / actors (a crate shields what is behind it) | combat.ts enemyBulletHit(Party) / playerBulletHit |
| Not line of sight (low cover: a sniper still sees you and shoots the crate) | ctx.lineOfSight passes no `solid` |
| Damage: player bullets their payload damage (plain: consumed; piercing: flies on, no pierce spent, only if it broke the piece), enemy bullets `enemyBulletDamage` (consumed), the sword's swings their BASE damage (sweepArc's pass after the actors: no enemyHits, no combo; the guard none), Mother Bramble's slam breaks everything within `slamRadius` at impact (nearly dormant: boss rooms get no pieces, `BREAKABLE.roomTypes`, and the radius ignores walls, so it only reaches a piece in a room that touches the boss room: 1 of 240 boss floors, run seeds 1-60 x floors 5-20; kept for that and covered by specs) | `damageBreakable`, melee.ts, act1.ts |
| Score: a piece a player breaks scores ScoreSource.BREAKABLES (appended: index 8), BREAKABLE_POINTS[kind] x floor; never feeds the combo, no room record | score.ts `scoreBreakable` |
| Events: `breakableHits`, `breakablesBroken`; per tick `state.breakables.hitSlots` / `brokenSlots` (presentation, cleared each tick, not hashed) | state.ts, breakables.ts |

Co-op needs nothing extra (every rule is per bullet / swing; the team score gets the points). Spec:
`breakables/breakables.spec.ts`, placement `../dungeon/breakables.spec.ts`.

## Boost drops (Roblox port, docs/BOOSTS.md)

Opt-in through `SimConfig.drops` (`DropsConfig`; `DROPS_CONFIG` is the game's, `guaranteedDropsConfig(list)` the
tutorial's). No world sets it yet (B4 / B9). Without it there is no `state.drops`, `dropsOnKill` / `stepDrops` never run,
every boost read is neutral (the callers' `scalePercent` / `scaleTicks` return their input unchanged) and no `drops`
group is hashed, so every fixture, M1 and every endless / tutorial replay is unchanged. With it createSimState builds
`state.drops` (after the party; no sim rng) with its OWN mulberry32 word, `seedToState(seed) ^ DROPS.salt`: drops never
draw from `state.rngState`, so no boon offer, relic, curse or archetype roll moves.

| Rule | Where |
| --- | --- |
| A kill rolls (rules and draw counts in the drops.ts header): a guaranteed room's last member drops its kind; reviving archetypes, bosses, the training dummy, kills in the boss room and (boss floors) any kill while the boss fight is on never roll; a full ground skips without a draw; pity, else one `rngInt(0, 99)` against the archetype's percent; one weighted kind draw | `dropsOnKill` (killActor, before onDeath) |
| A guaranteed room's deferred spawns become a guard (their actor ids, hashed) | `dropsOnRoomSpawned` (endless.ts enterRoom) |
| Floor change frees every slot and guard; debug drops; timers; ground life; pickups by slot, first living player in reach | `stepDrops` (after stepRun, before stepScore; frozen draft ticks skip it) |
| Fury x 150 % after Sharpened (two scalePercents); Frenzy one combined integer percent with Swift Strikes (`combinedPercent`) | runMods.ts `playerHitDamage` / `attackTicks` |
| Quickstep walk x 130 % (movePlayer's equal sub-steps of at most MAX_MOVE_STEP); the roll is untouched | player.ts stepPlayer |
| Aegis: after the harmless branch, before armor, a pip absorbs the whole hit (`events.aegisBroke`); Warding never refills it | player.ts damagePlayer (`absorbWithAegis`) |
| Death, forfeit, leave: the player's boosts and pips end | `boostsOnPlayerDied` (damagePlayer, forfeitSoloRun, markPlayerLeft) |

Client reads (shared/sim barrel): `dropsGround(state)`, `dropGroundTicks(state)`, `dropsEvents(state)`,
`activeBoosts(state, i)`, `boostTicksLeft(state, i, kind)`, `aegisPips(state, i)`, `isBoostActive`. Specs:
`drops/drops.spec.ts`, `drops/boosts.spec.ts`.
