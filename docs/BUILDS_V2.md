# Builds v2: plan (wave 1)

Wave 1 of the builds v2 proposal (the proposal itself is kept below as "Appendix: the proposal (2026-11-05)"; wave 2 is
still read from it). Three boons, seven duos and two fixes:

1. **Riposte** (rare, offense). A guard that erases bullets answers with a counter-wave. The sword's best skill move
   gets a build (gap 1).
2. **Ballista** (rare, offense). The heavy arrow bursts into bolts; evolved, it pins an enemy and slams it into a wall.
   Holding ALT becomes a build decision (gap 2).
3. **Wrecker** (common, offense). Rolling smashes breakables, and every piece you break fires splinters; evolved, the
   pieces explode and set each other off (gap 4).
4. **Seven duos.** Thunder Guard, Stillwater and **Rebuke** (the Bastion + Riposte duo, owner call 6) on Riposte;
   Dragon Bolt on Ballista; Powder Keg on Wrecker; Full Heart and Happy Hour give Hearty and Deep Flask a duo (gap 3).
5. **Duo hint** (presentation): a New card that unlocks a duo says so (gap 6).
6. **Overcap points** (score): boss damage the cap throws away pops as gold points (gap 5).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**, on the established builds patterns (docs/BUILDS.md, docs/LEGENDARIES.md): boons appended to
`BOONS`, duos to `DUOS`, effects to `BuildEffect` (hashed, append only); everything opt-in through `SimConfig.builds`
(endless worlds only, BUD8); new hashed fields appended to the `builds` group; effects through the proc engine (`gen`,
`GEN_MAX` 3, `procsPerTick`, the per-player effect budget); unhashed `BuildEvents` for the view; the `buildFx` Reduced
setting respected; new bullet looks through `buildReport` (BUD12). M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture
and the tutorial (`CLASSIC_BOON_COUNT` 12, no builds) replay exactly as before. Same rule of thumb: **if a player
cannot see it happen, it is not in this plan.**

## Status (2026-11-07)

**BV0-BV10 built** (on branch `builds-v2`): the audit ("BV0 findings"), the data and scaffolding ("BV1 (as built)"),
the rules (Riposte and Counterstrike BV2, Ballista BV3, Siege Bolt BV4, Wrecker and Demolition BV5, the wave 1 duos BV6,
Full Heart and Happy Hour BV7), the duo hint (BV8), overcap points (BV9) and the theme (BV10: colour roles, strings,
audio IDs; plus the wave 1 integration spec), each in its "BVn (as built)" section. **Open:** BV11 (view), BV12
(tuning), BV13 (art, audio, Studio check, playtest). The full suite (`npm run verify`) on the merged branch is pending
the integrator's run; each task ran its targeted specs (listed in its section). The six owner calls of the proposal are settled
("Owner calls"); this plan turns them into tasks BV0-BV13 and decisions BVD1-BVD20; the owner settled BVD3 and
BVD13-BVD15 on review (2026-11-07), the rest are defaults. Follows docs/BUILDS.md (BU0-BU10 built,
BU11-BU14 open) and docs/LEGENDARIES.md (LG0-LG7 built, LG8-LG9 open). The proposal's advice to land after BU14 stands
for the merge to `main`: BV1-BV10 can be built on a branch; BV13's frame-time check uses BU14's budget.

## What the code gives us (read on `main` @ `0a8e8ec`)

Paths under `src/shared/sim/` unless noted.

| Fact | Where | Consequence |
|---|---|---|
| The guard: `SWORD_V_GUARD` ticks left, set on the ALT press (`swordGuardTicks`: 18, Bastion 27), decremented every guard tick; each tick's erases are `ctx.events.bulletsDeleted - deletedBefore` (goo erased outside it, strikes never); `buildsOnGuardCancels(state, i, cancels, starting)` is called every guard tick | `combat/weapons/defs/sword.ts` 240-289 | Riposte counts in the same place. The guard **ends** on the tick its counter reaches 0, or early when the sword's step sees a roll (`rollTicks > 0` zeroes it) or a swap (in) |
| The erased bullets' positions reach `score.events.guardX` / `guardZ` (the parry feed's sink) only in scored runs | `sword.ts` 249-285 | Thunder Guard sparks from those positions; every builds run is an endless run, which is scored (BV0 confirms) |
| Bastion's `braceCount` exists only for Bastion owners and is reset by a roll's start and by a swap | `builds/hooks.ts` | Riposte needs its own per-guard count (`riposteCount`); Rebuke reads both |
| Heavy arrow: a `BulletKind.PLAYER` bullet with the bow's source, speed 22, life 0.7 (15.4 tiles), pierce 2 (+ Piercing Arrows), damage 5; told apart from stream arrows (16), Flurry arrows and the bow-held Ember Wake ring (12) by its squared speed (`bowArrowLife`) | `combat/weapons/defs/bow.ts`, `builds/duos.ts` 110-150 | Ballista needs no payload change to find its arrows |
| The charge reads `BOW_DATA.chargeTicks` (36) directly in `BOW.step` and `bowCharge` | `bow.ts` 245-291 | Ballista II's shorter charge needs a `bowChargeTicks(state, i)` read (like `swordGuardTicks`) |
| A player bullet on a blocked cell is consumed first thing in `playerBulletHit`; a piece it does not break consumes it too; a piercing hit with no pierce left consumes it, and `buildsOnPierceHit(..., consumed)` already says which hit that is | `combat/combat.ts` 466-545, `builds/evolutions.ts` 140 | Ballista's two moments (wall, last pierce) each have one line to hook |
| The bullet walks never spawn into the pool they walk: Fire Arrows records ember spots in the walk and fires them after | `builds/duos.ts` 351-398 | Ballista's bursts and Wrecker's splinters are queued in the walk and fired in `stepBuilds` |
| The bullet pool's free list is a LIFO stack; `isLive(i)`; a slot released by `step` (life over) is the next one handed out | `combat/bullets.ts` | A pin keyed by bullet slot must be checked right after the move phase, before anything can spawn |
| `moveActor(ctx, actor, dx, dz)` moves a body with `config.actorMover` (walls slide, intact pieces block) in sub-steps of 0.1; `stepActors` calls `def.step`; the Warbanner's aura is a transient per-tick mask rebuilt from hashed state (`ctx.rebuildAura`) | `combat/actors/helpers.ts` 71, `combat/actors/actors.ts` 294 | Siege Bolt drags with `moveActor` and holds a pinned actor's AI with the same kind of mask |
| `damageActor`: `filterDamage`, the Shielded absorb, `applyDamageCap` (returns what it let through), Executioner, the clamp | `combat/actors/actors.ts` 198-236 | The dropped damage is `before - after` at one line; only bosses have a cap (`damageCapPerSecond` 6) |
| Breakables are **barrels and crates only** (`BreakableKind` 0 / 1; the vault chest 2 never breaks). Bookcases, tombs, candle stands, statues and solid pillars are WALL cells | `breakables/breakablesData.ts`, shared/dungeon `solidDecor` | The proposal's "bookshelf rows and pillars go off like fireworks" cannot happen: Demolition chains barrels and crates (BVD11) |
| Pieces sit in wall clusters of 2-4 (storerooms x2 + 3, clusters 3-5); 0-2 per 150 floor tiles on floors 1-4, up to 3-6 from floor 15; rooms are double size | shared/dungeon `breakablesData.ts` `BREAKABLE` | A chain has neighbours to reach; floor 1 rooms often have none (BV11 measures) |
| `damageBreakable(state, slot, amount, source)` knows no player; it scores only `MELEE` / `PLAYER_BULLET` (`scoreBreakable`) | `breakables/breakables.ts` 198-224 | Wrecker passes an owner and two new scored sources (`ROLL`, `BUILD`) |
| Pieces block bodies: the roll moves through `movePlayer` with the intact pieces as `solid` | `player.ts` 107-125, 209-212 | A roll smash breaks the piece before the roll's move, so the roll goes through |
| The combo is team-wide (`state.score.combo`, `comboTimer`); `feedCombo` (+0.1, timer refilled) is private; `cutCombo` runs in `stepScore` once per landed hit | `score/score.ts` 685-705, 1138 | Wrecker refills the timer and Demolition steps the combo through two new exports; Stillwater records the combo before the tick's cuts |
| Score sources 0-14, the gated ones padded (`addBuildScoreSources` .. `addGoldenScoreSources`); every endless run holds 15 | `score/scoreData.ts` 136-176, `score/score.ts` 781-910 | Overcap is `ScoreSource.OVERCAP` 15, builds runs only, padded like the others |
| `duoAvailable(levels, duos, d)`; the draft card model is pure (`draftCardModel`); the snapshot carries every player's levels and duos | `builds/cards.ts` 65, shared/view/hud `draftCards.ts`, shared/play `snapshot.ts` | The duo hint is a pure view function |
| A duo card is only **offered** once both boons are owned (the duo band, BUD3); owning both never grants it | `builds/cards.ts` | The hint says "Unlocks a duo", not "Completes" (BVD17) |
| Strings come from the tables: `<id>.name` / `.desc` / `.icon`, levelled boons also `.desc.2`, `.evo.name`, `.evo.desc` | shared/view/hud `progression.ts` `progressionStringKeys` | New boons and duos need their rows and `l10n/context.json` entries, nothing else |
| Arc rows: web 16 @ FULL_RING, 5 @ 0.5, 1 @ 0; port 8 / 12 @ FULL_RING; no 6 or 10 row | `combat/arcTable.ts`, `combat/arcTablePort.ts` | Ballista's bolts need four port rows (BVD8) |
| Free indices: Boon 17+, Duo 13+ (card ids 77+), `BuildEffect` 9+, `BreakableSource` 4+, `ScoreSource` 15; `DAILY.ruleset` is 11 | `progressionData.ts`, `buildsData.ts`, `breakablesData.ts`, shared/daily `config.ts` | Wave 1 takes them in this plan's order; ruleset 11 -> 12 (BVD20) |

## BV0 findings (2026-11-07)

Read on `builds-v2` @ `d9ab301` (= `main` @ `0a8e8ec` + this plan). Paths under `src/shared/sim/` unless noted. Every
row of the table above holds (line numbers drift by a few lines, given here as found); the points below add to it or say
where the next tasks must take care.

- **Indices.** Boon 17-19, Duo 13-19 (card ids 77-83), `BuildEffect` 9-11, `BreakableSource` 4-5 and `ScoreSource` 15
  were free; no code named Riposte, Ballista, Wrecker or overcap. `DAILY.ruleset` was 11 (`shared/daily/config.ts`).
- **Every builds run is scored.** Every game config that sets `builds` (shared/run `buildEndlessRunConfig`, solo and
  co-op, so the daily and dev worlds built from it, and `run/testing/buildTune.ts`'s tuning config) also sets
  `scoring`. A hand-built `SimConfig` may still set `builds` without `scoring` (specs do), so BV2 / BV6 / BV9 must keep
  their `state.score !== undefined` guards: the guard's erase positions reach `score.events.guardX` / `guardZ` only in
  a scored run (`combat/weapons/defs/sword.ts` 251-285), and an overcap payout needs a score to pay into.
- **The guard** (`sword.ts` 227-290) as the table says, with three details for BV2: the guard sweeps on its press tick
  (`starting`, the counter set and decremented on the same tick), so an 18-tick guard sweeps 18 ticks; its natural end
  is the tick the decrement leaves `SWORD_V_GUARD` at 0, inside the same branch, right after `buildsOnGuardCancels`;
  a roll zeroes it at the top of `step` (line 234), and a swap zeroes it only when the sword is swapped back IN
  (`weaponSwapped` while the sword is the active set, line 230): while holstered the sword does not step, so its counter
  is frozen, as the plan says. **The floor change does not touch weapon slots** (`endless.ts` `nextFloor` 264-: it clears
  both bullet pools and calls `clearBuildProcs`, nothing else of the weapons), so a guard running at a floor change keeps
  running on the next floor and would end "naturally" there: BV2 must discard `riposteCount` at the floor change
  (`clearBuildProcs`, which BV1 left free of per-player counters) to keep the edge case "count reset with the floor".
- **Bastion's `braceCount`** (`builds/hooks.ts` 223-272) is a field of every player but only counted and reset for
  Bastion owners (`hasBastion`); a swap resets it only when not mid-roll. Riposte's own count is needed, as the table says.
- **The bow.** `BOW.step` read `BOW_DATA.chargeTicks` at two places and `bowCharge(slot)` (the view's charge, also
  `client/.../WeaponViewController.ts` 201) divided by it; BV1 routes them through `bowChargeTicks` (below). Heavy arrows
  (speed 22) are told from stream and Flurry arrows (both 16: Flurry fires stream specs with the bow's source) and the
  bow-held Ember Wake ring (12) by `builds/duos.ts` `bowArrowLife` (128-140); Ricochet's split arrows are `SPARK_BOLT`
  effect bolts with a build source, so no arrow test confuses them. The heavy arrow's `pierce` field is 3 bits (max 7:
  2 + Piercing Arrows' 2 fits).
- **Collisions** (`combat/combat.ts`): `playerBulletHit` 514-551 (blocked cell first, then the piece: a piercing bullet
  flies on only when it broke the piece, else consumed), `piercingBulletHit` 472-512 (`buildsOnPierceHit(..., pierce ===
  0)` is the consuming hit). `lastHit` holds the last actor's slot + 1 (7 bits); the "already inside at the start of
  the tick" rule applies only while `lastHit !== 0`, so a plowing arrow (BV4) must keep `lastHit` set.
- **The bullet pool** (`combat/bullets.ts`): the free list is a LIFO stack (`free` / `freeTop`, 235-304), `isLive(i)` is
  `slotToDense[i] >= 0` (510), `forEachActive` skips delayed bullets (465-472). There is **no release by index**: a slot
  is released only by `step` (life over or out of bounds), `clear(emitter?)` or a `true` return from a `forEachActive`
  visitor. So a pin must end in the same walk visit that consumes its arrow (BV4: the slam / last-pierce / wall hooks),
  because the next spawn (`fireEffect` in `stepBuilds` 6b, or the next tick's weapons before phase 5b) can reuse that
  very slot; an arrow released by `step` is caught by phase 5b's `isLive` check before anything spawns.
- **Nothing spawns a player bullet between the move and the collisions.** Phase 5 (`stepCombat` 600-603) is followed
  only by the collision setup (605-614); player bullets spawn only in the weapons phase (4: `ctx.firePlayer` from
  `weapons.ts` / `bow.ts` / `test.ts`, Mirror Cloak's reflections in the guard's `sweepArc`, `melee.ts` 44-60) and in
  `stepBuilds` (6b: every `fireEffect`). Kills in the walk queue procs and module scratch (Ricochet, duo sparks, Fire
  Arrows' embers) that fire after the walk. Phase 5b is safe where the plan puts it.
- **Actors.** `damageActor` (`combat/actors/actors.ts` 198-236): the dropped damage is `before - after` around
  `applyDamageCap` (207), after `filterDamage` and the Shielded absorb, as the plan says. `stepActors` (294-) rebuilds the
  Warbanner mask first (`ctx.rebuildAura`, `combat/ctx.ts` 84-130: a transient `Map<ActorState, id>` cleared by `bind`);
  the pinned mask can copy it exactly. `moveActor` (`helpers.ts` 71) uses `config.actorMover` with the intact pieces as
  `solid`. Actor slots are freed by the corpse timer and reused: a pin keeps slot AND id (as `nearestEnemy` skips by id).
- **Who pins (BV4).** A boss is `def.data.boss === true` (`ArchetypeData.boss`, `combat/actors/types.ts` 121; set by
  `boss/act1.ts` 270 and `boss/demonlord.ts` 284; the test Executioner and Overkill use, `builds/execute.ts`). The
  Goldling is the archetype id `GOLDEN_KIND` = `"golden"` (`golden/goldenData.ts` 12; test `def.id === GOLDEN_KIND`): its
  kills do proc today (`PROC_INELIGIBLE_ARCHETYPES` is only `"dummy"`), so the pin test must name it. Revivers (turrets)
  are `def.stepDead !== undefined`.
- **Rooms tolerate a carried actor.** Score room records are membership lists (`memberSlots`): `scoreRoomEngaged` /
  `scoreRoomDown` (`score/score.ts` 1059-1081) read player positions and member state, never a member's position, so a
  pinned actor dragged out of its room's box still belongs to its record (and so do pellets / vaults, which follow the
  record). The plan's fallback (stop the drag at the room's box) is not needed for scoring; BV4 should still check the
  Charger's room-box stun and the Goldling's walk mask, which read positions.
- **Breakables.** `damageBreakable` (`breakables/breakables.ts` 198-220) scores MELEE / PLAYER_BULLET only and knows no
  player; `scoreBreakable(state, kind)` (`score/score.ts` 769) credits no one either. `stepCombat` caches `hitPieces`
  once before the walk (`intact > 0`), so pieces broken mid-walk (a slam, BV4) are handled by `breakableSlotAt`'s
  cell map, not that cache.
- **Procs** (`builds/procs.ts`): `resolveProc` treats every proc as a kill and `dropLeavers` drops a leaver's procs
  (132); BV5 must branch on `BuildProc.kind` before the on-kill boons, and BV2 / BV4 must drop a leaver's waves and pins
  the same way. A kill of generation `genMax` queues nothing (Chain Reaction aside), so smashes stop at `GEN_MAX` too.
- **Flask drink** (`player.ts` 200-205): `events.flaskUsed` is not per player; Overflowing reads the drinker's
  `flaskTicks === FLASK_USE_TICKS` on the drink tick (`builds/evolutions.ts` 268), and Happy Hour (BV7) should too.
- **Hashed pins.** Endless state hashes pinned in specs (`charger.spec.ts` `PIN_HASH`, `stormcaller.spec.ts`,
  `warbanner.spec.ts`, `reaper.spec.ts`) build their configs without `builds`, so BV1's appended fields moved none of
  them (all pass unchanged).

## BV1 (as built)

Data and hashed state only: no rule reads any of it yet, so a builds run plays as before, except that the draft can deal
the three new boons and seven duos (endless drafts change) and every builds run's `builds` hash group is wider (endless
state hashes differ from tick 0). M1, every golden fixture and the tutorial (no builds; `CLASSIC_BOON_COUNT` 12) replay
exactly as before. Paths under `src/shared/` unless noted. The names below are final: later tasks use them as is.

- **Boons** (`sim/progression/progressionData.ts`): `Boon.RIPOSTE` 17 (`boon.riposte`, rare, offense), `Boon.BALLISTA`
  18 (`boon.ballista`, rare, offense), `Boon.WRECKER` 19 (`boon.wrecker`, common, offense) appended to `Boon` / `BOONS`;
  `BOON_COUNT` 20, `CLASSIC_BOON_COUNT` stays 12. Each goes I -> II -> III through `grantCard` (the evolution event at
  III); no level does anything yet. `BALLISTA_CHARGE_PERCENT` [100, 75, 75] sits beside Bastion's numbers (a weapon mod
  `runMods` will read, like `BASTION_GUARD_TICKS`).
- **Duos** (`sim/builds/buildsData.ts`): `Duo.THUNDER_GUARD` 13 (`duo.thunderGuard`, Riposte + Chain Spark),
  `STILLWATER` 14 (`duo.stillwater`, Composure + Riposte), `REBUKE` 15 (`duo.rebuke`, Bastion + Riposte), `DRAGON_BOLT`
  16 (`duo.dragonBolt`, Ballista + Ember Wake), `POWDER_KEG` 17 (`duo.powderKeg`, Wrecker + Volatile), `FULL_HEART` 18
  (`duo.fullHeart`, Hearty + Sharpened), `HAPPY_HOUR` 19 (`duo.happyHour`, Deep Flask + Bounty); `DUO_COUNT` 20, card
  ids 77-83. Every boon is now in 1-4 duos (Chain Spark and Volatile 4; Deep Flask 1).
- **Effects and procs** (`buildsData.ts`): `BuildEffect.BALLISTA` 9, `WRECKER` 10, `RIPOSTE` 11 (Counterstrike's
  returns); `ProcKind` { `KILL` 0, `SMASH` 1 } (type `ProcKindId`).
- **Tunables** (`sim/builds/effectsData.ts`, block "Builds v2, wave 1"; values exactly the Design's, world units with
  `TILE_SIZE` 1, durations in ticks):
  - Riposte: `RIPOSTE_MIN_ERASED` 1, `RIPOSTE_WAVE_HALF_ANGLE_COS` 0.5, `RIPOSTE_WAVE_SPEED` 24, `RIPOSTE_WAVE_RANGE` 7,
    `RIPOSTE_MAX_COUNT` [6, 10, 10], `RIPOSTE_WAVES_MAX` 8, `COUNTERSTRIKE_RING_ERASED` 5,
    `COUNTERSTRIKE_RING_HALF_ANGLE_COS` (= `NOVA_HALF_ANGLE_COS` -2), `COUNTERSTRIKE_RETURN` (`SOUL_SHARD` at 1 damage),
    `COUNTERSTRIKE_RANGE` (= `SOUL_SHARDS_RANGE`), `WaveKind` { `FORWARD` 0, `RING` 1, `REBUKE` 2 }.
  - Ballista: `BALLISTA_BOLT_COUNTS` [6, 10, 10], `BALLISTA_FAN_SPREAD` 1.6, `BALLISTA_BOLT_SPEED` 12 / `_LIFE` 0.35 /
    `_DAMAGE` 1, `BALLISTA_BOLT` (one `BURST` bolt), `BALLISTA_RINGS` (per level, @ `FULL_RING`) and `BALLISTA_FANS` (per
    level, @ `BALLISTA_FAN_SPREAD`). Siege Bolt: `SIEGE_PINS_MAX` 4, `SIEGE_SLAM_SHORT` 0.25, `SIEGE_SLAM_DAMAGE_PERCENT`
    300, `SIEGE_SHOCK_RADIUS` 2, `SIEGE_SHOCK_DAMAGE` 3.
  - Wrecker: `WRECKER_SPLINTERS` [3, 5, 5], `WRECKER_SPLINTER` (speed 14, life 0.6, 1 damage, `SHARD`), `WRECKER_RANGE`
    (= `SOUL_SHARDS_RANGE`), `DEMOLITION_DAMAGE` 2, `DEMOLITION_RADIUS` 1.5. The roll smash radius is not a new
    tunable (`PLAYER_RADIUS` + `BREAKABLE_HIT_RADIUS`); Demolition's combo step is `COMBO_STEP`.
  - Duos: `THUNDER_GUARD_RANGE` (= `CHAIN_SPARK_RANGE`), `THUNDER_GUARD_DAMAGE` 1, `THUNDER_GUARD_MAX` 8, `SparkFork`
    { `HOP` 0, `FORK` 1, `THUNDER` 2 } (the existing `sparkFork` values named; existing pushes still write 0 / 1 as
    literals), `STILLWATER_SECONDS` 3 / `STILLWATER_TICKS` 180, `STILL_NONE` -1, `DRAGON_BOLT_EMBER_TICKS` 3,
    `FULL_HEART_RADIUS` (= `SKEWER_RADIUS`), `FULL_HEART_RANGE` 4, `HAPPY_HOUR_SECONDS` 5 / `HAPPY_HOUR_TICKS` 300,
    `HAPPY_HOUR_KILL_PERCENT` 200. Rebuke needs no tunable of its own (`BASTION_BRACE_BULLETS`, `RIPOSTE_MAX_COUNT`).
- **Arc rows** (`sim/combat/arcTablePort.ts`): 6 @ FULL_RING, 10 @ FULL_RING, 6 @ 1.6, 10 @ 1.6 appended to
  `PORT_ARC_SOURCES` (`PORT_ARC_SHAPES[5..8]`); `sim/arcTablePort.spec.ts` checks every level's ring and fan resolves to
  its row and fires (no "arc table miss"), and none shadows a web row.
- **Breakables and score** (declared only): `BreakableSource.ROLL` 4, `BUILD` 5 (`damageBreakable` still scores MELEE /
  PLAYER_BULLET only); `ScoreSource.OVERCAP` 15 and `OVERCAP_POINTS` 10 (`sim/score/scoreData.ts`). **No run's points /
  counts hold OVERCAP yet** (an endless run still has 15 entries, 0..14): BV9 adds `addOvercapScoreSources`, which
  changes every builds run's `score` group.
- **Hashed state** (`sim/builds/builds.ts`, appended, empty / 0 everywhere for now):
  - per player, after `braceCooldown`: `riposteCount`, `overcap`, `happyHourTicks` (`BUILD_PLAYER_SCALARS`);
  - per proc, after `excess`: `kind` (`BUILD_PROC_FIELDS`), `ProcKind.KILL` in `buildsOnKill` (`procs.ts`), the duos'
    scratch `pseudo` proc (`duos.ts`) and the spec literals (`procs.spec.ts`, `overkill.spec.ts`);
  - after the procs: `pins: BuildPin[]` (`bullet`, `owner`, `slot`, `id`, `x0`, `z0`, `slam`; `BUILD_PIN_FIELDS`), then
    `waves: BuildWave[]` (`owner`, `x`, `z`, `dirX`, `dirZ`, `halfCos`, `radius`, `range`, `speed`, `damage`, `kind`;
    `BUILD_WAVE_FIELDS`, then `hits: number[]` (actor ids) as length + values), then the world scalars `stillCombo`,
    `stillTick` (`BUILD_WORLD_SCALARS`; `stillTick` starts at `STILL_NONE`). Each list hashes its length first.
  - Clone (pins spread, waves with `hits` copied), `writeBuildsHash`, `buildsHashNames` (`builds.pins[0].bullet`,
    `builds.waves[0].hits[1]`, `builds.stillTick`, ...) follow the existing pattern; `clearBuildProcs` (the floor change)
    now also clears pins and waves and resets `stillCombo` 0 / `stillTick` `STILL_NONE`. Per-player counters are not
    touched there (BV2 adds `riposteCount`'s discard: BV0 findings, "The guard"). No snapshot field (no view reads them
    yet). Every builds run's group grows by 3 scalars per player, 1 value per queued proc and 4 values (two lengths, two
    scalars); no spec pins an endless builds hash, and no pinned value changed.
- **Events** (`BuildEvents`, unhashed, in the interface, `BUILD_EVENT_LISTS` and `emptyEvents`, so clone and the
  per-tick clear cover them): `waveX` / `waveZ` / `waveDirX` / `waveDirZ` / `waveHalfCos` / `waveRange` / `waveSpeed` /
  `waveOwner` / `waveDamage` / `waveKind` and `counterCount` (parallel, one per spawned wave); `ballistaX` / `Z` /
  `Owner` / `Fired` / `Wall` (1 back fan, 0 ring); `pinStartSlot` / `Owner` / `X` / `Z`; `pinEndSlot` / `Owner` /
  `Carried` / `Slam`; `slamX` / `Z` / `Owner` / `Struck`; `smashX` / `Z` / `Owner` / `Gen` / `Fired`; `demolitionX` /
  `Z` / `Owner`; `beamX1` / `Z1` / `X2` / `Z2` / `Owner` / `Struck`; `happyPlayer`; `overcapX` / `Z` / `Owner` /
  `Points`. Thunder Guard's sparks use the spark lists with `sparkFork` `SparkFork.THUNDER`.
- **The bow** (`sim/combat/weapons/defs/bow.ts`): `bowChargeTicks(state, playerIndex)` (exported through the weapons
  barrel) returns `BOW_DATA.chargeTicks` (36) for everyone; `BOW.step` reads it for the charge and the release, and
  `bowCharge(slot, chargeTicks = BOW_DATA.chargeTicks)` takes it like `swordGuard`'s `guardTicks`. BV3 makes it read
  `BALLISTA_CHARGE_PERCENT` (through `runMods`) and passes it from WeaponViewController.
- **Theme** (placeholder pack, `theme/packs/placeholder/manifest.ts`): `boon.riposte.*` ("Riposte", `RIP`),
  `boon.ballista.*` ("Ballista", `BAL`), `boon.wrecker.*` ("Wrecker", `WRK`) with `.name` / `.desc` / `.icon` /
  `.desc.2` / `.evo.name` ("Counterstrike", "Siege Bolt", "Demolition") / `.evo.desc`; `duo.<id>.name` / `.desc` /
  `.icon` for the seven duos (`TGD`, `STW`, `RBK`, `DRB`, `PKG`, `FHT`, `HHR`): 39 strings, listed by
  `progressionStringKeys` through `BOONS` / `DUOS`. Each has an `l10n/context.json` entry (the existing boon / duo notes
  plus a glossary line on guards, counter-waves, charged arrows, pieces, splinters, braces and finishers); `l10n:check`
  0 errors, 0 warnings. The generated locale tables are untouched (new English keys fall back to English, LD7). No
  colour role, audio ID, toast, floor text or `hud.draft.duoHint` yet (BV10); no top-level constant in `contract.ts`,
  so the Luau locals are unchanged.
- **`DAILY.ruleset`** 11 -> 12 (`shared/daily/config.ts`, BVD20).
- **Specs.** `sim/builds/builds.spec.ts`: `BOON_COUNT` 20, twenty duos with every boon in 1-4 (the hubs Chain Spark and
  Volatile 4), the builds hash group's size and its new tail names (`builds.procs.length` .. `builds.stillTick`), the
  LG1 block's field lists; a new block "builds v2, wave 1 (BV1)": the three boons' rows and tables, the tutorial draft
  never dealing them, the seven duos' pairs and card ids, the other indices (and an endless run still holding 15 score
  sources), each new boon dealt New to a fresh build and taken to II and III, each duo available exactly when both
  boons are owned (never dealt with one, a boss deal's guaranteed duo, granted once), the appended hashed state (zeroed,
  hashed, cloned independently, named in hash order, cleared by `clearBuildProcs`), the new event lists cleared each
  tick, and `bowChargeTicks` 36. `sim/arcTablePort.spec.ts` (the four rows), `progression.spec.ts` (`BOON_COUNT` 20),
  `procs.spec.ts` / `overkill.spec.ts` (the proc literal's `kind`), `pacts/greed.spec.ts` (Hearty + Sharpened now make
  Full Heart, so the Greed pool lists it after Gold Rush) and `daily/daily.spec.ts` (ruleset 12).
- **Verify.** typecheck, lint, build, check:assets, check:autolocalize, test:checks, test:l10n and `l10n:check` green.
  Headless (Lune), about 3,100 tests in 227 suites, all passing (`pacts/greed.spec` after its update): every spec
  under `sim/builds` (the five `builds.ttk.*` harnesses included), `sim/progression`, `sim/pacts`, `sim/score`, `sim/breakables`, `sim/drops`, `sim/golden`,
  `sim/treasure`, `sim/pellets`, `shared/daily`, `shared/theme`, `view/hud`, `view/fx`, `view/audio`, `shared/play`,
  `shared/tutorial`, `shared/lockstep`, `dungeon/roomPool*` (`roomPool.lock.spec` matches), `run/tutorial` (the tutorial
  lock), `run/validate`, `run/segments`, `run/endless`, `run/dev`, `run/party`, `run/slice`, `run/config`,
  `run/affixes`, `run/endlessSpawn`; the fixture parity specs (`sim/runFull`, `runBoss`, `runBullets`, `constants`,
  `hash`, `recordingCodec`), the determinism specs (`sim/determinism`, `combat.determinism`, `enemies.determinism`,
  `swordBow.determinism`), the hashed pins (`charger`, `stormcaller`, `warbanner`, `reaper`), `arcTablePort`, `bow`,
  `bullets`, `combat`, `weapons`, `step`, `smoke`, `encounterRun`, `forfeit`, `party`, `runPlayer*`,
  `legendaries.bastion.*`. Not run on this 2-core box: the full `npm run verify` / unfiltered `npm test` (hours) and
  the other tuning censuses (`run/buildsOffers`, `run/buildsPool`, `run/legendariesOffers`, `legendaries.ttk.*`,
  `variants.ttk.*`).

## Player experience

1. **Riposte, floor 3.** A sniper's fan arrives. The guard eats four bullets, the parry tick climbing a step each, and
   when the guard drops a crescent of light rolls out from the knight: **COUNTER x4.** The sniper takes 4.
2. **Counterstrike.** A reaper's spiral: the guard eats seven. The counter goes out as a full ring and seven shards fly
   back at the nearest enemies. The pack in front is gone.
3. **Ballista.** A fully charged arrow pierces two swarmers and bursts into six bolts where it stops. At a wall it
   shatters into a fan that comes back into the room.
4. **Siege Bolt.** The arrow hits a bruiser and does not stop: it carries it, plows through three swarmers and slams it
   into the far wall. Freeze, a shockwave ring, the crates beside it break: **PINNED** while it flies, **SLAM** at the
   wall.
5. **Wrecker.** The knight rolls through a crate cluster; each crate pops and throws splinters at the nearest enemies,
   and the combo timer jumps back to full. With Demolition the cluster goes off one piece after the other.
6. **Rebuke.** With Bastion, a roll through eight bullets that wins back a pip fires the counter as a full ring, even
   with the bow in hand.
7. **The draft.** A New card shows a small joined chip: **Unlocks a duo: Thunder Guard.** The duo is now a goal two
   picks early.
8. **The boss.** A strong build hits the cap; small gold numbers rise off the boss, `+12`, `+12`: the build is working
   even when the fight cannot go faster.

## Design

Numbers are starting points for BV11's tuning pass. Every damage below goes through `playerHitDamage` (Sharpened,
Fury) unless it says otherwise, and every kill it makes queues a proc like any kill.

### Riposte (`boon.riposte`, rare, offense, icon `RIP`)

`riposteCount` (per player, hashed) counts the enemy bullets the current guard erased (`cancels`, the number Bastion
counts; goo never). Reset on the guard's start tick.

| Level | Rule |
|---|---|
| I | When a guard that erased at least `RIPOSTE_MIN_ERASED` (1) ends, a **counter-wave** goes out forward: a crescent (`RIPOSTE_WAVE_HALF_ANGLE_COS` 0.5, 120 degrees) that grows at `RIPOSTE_WAVE_SPEED` 24 tiles/s to `RIPOSTE_WAVE_RANGE` 7 tiles and hits every enemy it reaches once, for min(`riposteCount`, `RIPOSTE_MAX_COUNT`[I] 6) |
| II | `RIPOSTE_MAX_COUNT`[II] 10 |
| III **Counterstrike** | max 10; a guard that erased `COUNTERSTRIKE_RING_ERASED` (5) or more sends the wave as a full ring (`NOVA_HALF_ANGLE_COS`), and fires min(count, max) **returns**: shards (`COUNTERSTRIKE_RETURN`, Soul Shards' look, 1 damage) at the nearest enemies within `SOUL_SHARDS_RANGE`, nearest first (Soul Shards' aim), effect `BuildEffect.RIPOSTE` gen 0 |

**The wave is not bullets** (BVD1). It is a hashed record in `state.builds.waves` (`BuildWave`: owner, origin, unit
direction, half-angle cosine, radius, damage, the ids it has hit) stepped first in `stepBuilds`: the radius grows by
speed x `SIM_DT`, and every living, non-hit enemy whose circle the radius reaches (`d - a.radius <= radius`) and that
stands in the cone (melee's `inCone` test, so an enemy the origin is inside always counts) is struck once, in slot
order, through `ctx.damageActor` with `procGen` 0 (the player's own move). It reaches far enough for a sniper, hits each
enemy once (no double hits from overlapping bolts), takes no bullet slot and no arc row, and the full ring is the same
record with another cosine. A wave ends at its range; at most `RIPOSTE_WAVES_MAX` (8) live at once (a ninth is not
spawned; the guard's 60-tick cooldown and the wave's 18-tick life keep each player to one wave at a time). The wave does not erase
bullets and does not hit breakables (BVD2).

**When a guard ends** (BVD3, owner 2026-11-07): only a guard that runs its full length (its counter reaching 0)
fires the counter, on that tick. A roll cutting it short (the sword's step zeroes it) discards the count, and so does a
swap (the sword does not step while holstered, so a swap-out guard is frozen and zeroed on the swap back in). Damage =
the capped count, through `playerHitDamage`.

### Ballista (`boon.ballista`, rare, offense, icon `BAL`)

| Level | Rule |
|---|---|
| I | A heavy arrow **bursts** into `BALLISTA_BOLTS`[I] 6 bolts when it is consumed: on its last pierce, a ring at the hit (6 @ FULL_RING); on a wall or a piece it does not break, a **back fan** from its position at the start of the tick, aimed back along its flight (6 @ `BALLISTA_FAN_SPREAD` 1.6 rad). Bolts: `BALLISTA_BOLT` (speed 12, life 0.35, 1 damage, `BulletKind.BURST`), effect `BuildEffect.BALLISTA` gen 0 |
| II | 10 bolts; the charge takes `BALLISTA_CHARGE_PERCENT`[II] 75 % (36 -> 27 ticks, `bowChargeTicks`) |
| III **Siege Bolt** | II's bolts and charge; the first enemy the heavy arrow hits and does not kill is **pinned** (owner call 2) |

An arrow that ends its life in the air does not burst (BVD5; the pool releases expired bullets silently). Bursts found
in the bullet walk are queued and fired in `stepBuilds` (the walk never spawns into the pool it walks).

**Siege Bolt.** A pin is a hashed record in `state.builds.pins` (`BuildPin`: bullet slot, owner, actor slot and id, the
pin's start x / z, a `slam` flag), at most `SIEGE_PINS_MAX` (4).

- **Who pins**: any living enemy but a boss, the Goldling, a reviver (turrets), the dummy, or an actor already pinned
  (`PROC_INELIGIBLE_ARCHETYPES`, `def.stepDead`, the boss archetypes and `GOLDEN_KIND`; BV0 names the boss test). A hit that kills pins nothing.
  One pin per arrow, ever: losing it does not re-arm the arrow (BVD6).
- **Carrying** (a new phase 5b in `stepCombat`, right after the bullets move, before the collisions): pins whose bullet
  is no longer live are dropped (the arrow expired: no slam), pins whose actor died are dropped (the arrow flies on as
  an ordinary heavy arrow), then each pin in index order drags its actor to the arrow's position with `moveActor` (the
  actor's own mover: walls slide, pieces block). A drag that falls more than `SIEGE_SLAM_SHORT` (0.25 tiles) short of
  the arrow sets `slam` (the body hit something the arrow did not).
- **Held**: a pinned actor does not step (no walk, no attack, no timers), through a transient mask rebuilt from
  `state.builds.pins` at the start of `stepActors` (the Warbanner aura's construction; never hashed, a pure function of
  hashed state). Contact damage is unchanged.
- **Plowing**: while it carries, the arrow still hits every enemy it enters (the piercing walk's rules, never the pinned
  one) but spends no pierce, so a pierce hit cannot end the pin (BVD7). Each hit enemy is hit once (the walk's
  "already inside at the start of the tick" rule holds while `lastHit` is set).
- **The slam**: in the arrow's walk visit, a wall, a piece it does not break, or a set `slam` consumes it. The pinned
  actor takes `SIEGE_SLAM_DAMAGE_PERCENT` (300 %) of the heavy arrow's damage; every other living enemy within
  `SIEGE_SHOCK_RADIUS` (2 tiles) of it takes `SIEGE_SHOCK_DAMAGE` (3), in slot order, `procGen` 1; every intact piece in
  that radius breaks (`BreakableSource.BUILD`, owner the archer). Ballista's back fan fires too. The slam damage's kill is
  the player's own (gen 0).
- **Floor change**: pins are cleared with the procs (`clearBuildProcs`).

### Wrecker (`boon.wrecker`, common, offense, icon `WRK`)

| Level | Rule |
|---|---|
| I | **Roll smash**: a rolling owner breaks every intact piece their body would touch this roll tick (before the roll's move: the circle of `PLAYER_RADIUS` + `BREAKABLE_HIT_RADIUS` swept along the step), so the roll goes through. **Every piece the owner breaks** (rolled, swung, shot, or broken by their build effects) fires `WRECKER_SPLINTERS`[I] 3 splinters (`WRECKER_SPLINTER`: Soul Shards' aim, speed 14, life 0.6, 1 damage, `BulletKind.SHARD`, effect `BuildEffect.WRECKER`) and refills the combo timer (a running combo only) |
| II | 5 splinters |
| III **Demolition** | 5 splinters; every piece the owner breaks also **explodes**: `DEMOLITION_DAMAGE` (2) to every enemy within `DEMOLITION_RADIUS` (1.5 tiles), and every intact piece in that radius breaks (`BreakableSource.BUILD`), each its own smash one generation on, so a cluster goes off piece by piece; each piece adds one combo step (+0.1) |

A broken piece queues a **smash proc**: `BuildProc` gains an appended `kind` (`ProcKind.KILL` 0, `ProcKind.SMASH` 1);
a smash has the piece's cell centre as x / z, slot / id -1, the breaker's generation (a roll or a swing 0, a bullet
`killGenOfSource`, a blast or slam the proc's gen + 1), and is queued only for an owner with Wrecker or Powder Keg and
below `genMax`. Smashes resolve in the same drain as kills, so a chain ripples one piece a tick and stops at
`GEN_MAX` (3) (BVD10). `damageBreakable` takes an optional trailing `owner` (-1: none, as today) and calls a leaf hook
`buildsOnPieceBroken(state, slot, owner, gen)`; pieces broken by `ROLL` and `BUILD` score like a swing's (BVD12).

### Duos (appended: Duo indices 13-19, card ids 77-83)

| Duo | Boons | Rule | Beat |
|---|---|---|---|
| **Thunder Guard** | Riposte + Chain Spark | every bullet the guard erases sparks from where it was to the nearest enemy within `CHAIN_SPARK_RANGE`: `THUNDER_GUARD_DAMAGE` 1, `procGen` 1, at most `THUNDER_GUARD_MAX` (8) per guard tick; queued like Storm Blade's sparks, released after the drain | One guard against a sprayer lights up the room |
| **Stillwater** | Composure + Riposte | a hit that cuts the combo while an owner is present records the combo before the cut (`stillCombo`, `stillTick`, world scalars); an owner's guard that erases at least one bullet within `STILLWATER_TICKS` (180, 3 s) gives it back (combo = max(now, recorded), timer refilled), once | The greyed lost multiplier lights up again |
| **Rebuke** | Bastion + Riposte | a guard or roll whose brace count reaches `BASTION_BRACE_BULLETS` (8) fires Riposte's counter as a **full ring**, but only when that brace restored something (a pip, or Stone Heart's heal), so it follows Bastion's once per room (Citadel: its cooldown): a roll at once (damage min(brace count, Riposte's max)), a guard at its full-length end instead of the forward wave (damage min(`riposteCount`, max)); a guard cut by a roll after it braced fires nothing (BVD3); once per guard or roll (BVD14) | A bow player's roll through a volley answers it |
| **Dragon Bolt** | Ballista + Ember Wake | a heavy arrow drops an ember every `DRAGON_BOLT_EMBER_TICKS` (3) for its whole flight (Fire Arrows' `dropEmber`; `FIRE_ARROWS_EMBERS_MAX` does not apply; ember duo id DRAGON_BOLT) | A line of fire across the room |
| **Powder Keg** | Wrecker + Volatile | a smash proc also fires the owner's on-kill boons from the piece (Chain Spark, Volatile, Soul Shards; Overkill carries nothing) | Every crate is a kill |
| **Full Heart** | Hearty + Sharpened | at full hearts, every finisher swing and every heavy arrow release also strikes a **beam**: every living enemy within `SKEWER_RADIUS` of the line from the player along the facing (the arrow's aim) to `FULL_HEART_RANGE` (4 tiles), slot order, for the finisher's damage, gen 0 | Not getting hit pays off in every swing |
| **Happy Hour** | Deep Flask + Bounty | a flask drink sets `happyHourTicks` to `HAPPY_HOUR_TICKS` (300, 5 s); the owner's kill points x `HAPPY_HOUR_KILL_PERCENT` (200) while it runs, folded into Bounty's `bonusPercent` as one integer percent (130 x 200 / 100 = 260), so `awardPoints` keeps its exact two-factor numerator | Saving a flask for a big pack is a score play |

Duo anchors after wave 1: Riposte 3, Chain Spark 4, Volatile 4, Bastion 3, Ember Wake 3, Hearty 2, Deep Flask 1. Every
v1 boon now has a duo (gap 3).

Full Heart and Happy Hour need no wave 1 boon; they are in this wave because the proposal put gap 3 first (BVD15,
settled). BV7 builds them on its own.

### Duo hint (presentation only)

`duoUnlockedBy(levels, duos, boon)` (pure, shared/view/hud, beside `draftCardModel`): the duos that picking an unowned
`boon` would make available (`duoAvailable` true after, false before), in duo index order. A New card with one or more
shows a joined chip (the first duo's two icon labels, `DUO_CHIP_SPAN`) and `hud.draft.duoHint` ("Unlocks a duo:
{duo}"). Upgrade, evolution and duo cards never show it. Read from the snapshot (levels and duos are in it). No partner
bias in the odds (owner call 4).

### Overcap points (score)

`damageActor`, right after `applyDamageCap`: with `state.builds` and `state.score`, the damage the cap dropped
(`before - after`, after `filterDamage` and the Shielded absorb, so a phase-invulnerable boss gives nothing) goes to the
acting player's `overcap` (hashed). While `overcap >= 1`, 1 is taken and `OVERCAP_POINTS` (10) are awarded into
`ScoreSource.OVERCAP` (15) at the kills' floor scaling (`floorScalePercent`), the Goldling coins' way: through the
usual multipliers, never feeding the combo (BVD18). Builds runs only (`addOvercapScoreSources` pads the earlier gated
sources); every other scored run's `score` group is unchanged. `BuildEvents` `overcapX` / `Z` / `Owner` / `Points` for
the pops.

## Architecture

1. **Data.** `progressionData.ts`: `Boon.RIPOSTE` 17, `BALLISTA` 18, `WRECKER` 19 (rare / rare / common, offense);
   their per-level tables. `buildsData.ts`: `Duo.THUNDER_GUARD` 13 .. `Duo.HAPPY_HOUR` 19; `BuildEffect.BALLISTA` 9,
   `WRECKER` 10, `RIPOSTE` 11; `ProcKind`. `effectsData.ts`: every tunable above, the specs (`BALLISTA_BOLTS` as
   BurstSpecs by level for the ring and the fan, `WRECKER_SPLINTER`, `COUNTERSTRIKE_RETURN`). `breakablesData.ts`:
   `BreakableSource.ROLL` 4, `BUILD` 5. `scoreData.ts`: `ScoreSource.OVERCAP` 15, `OVERCAP_POINTS`.
   `combat/arcTablePort.ts`: 6 / 10 @ FULL_RING and 6 / 10 @ `BALLISTA_FAN_SPREAD`.
2. **State** (`builds/builds.ts`, hashed, appended in this order): `BUILD_PLAYER_SCALARS` += `riposteCount`,
   `overcap`, `happyHourTicks`; `BUILD_PROC_FIELDS` += `kind`; after the procs, `pins` (length, then `BUILD_PIN_FIELDS`
   per pin), `waves` (length, then `BUILD_WAVE_FIELDS` and the hit ids, length + values, per wave), then the world
   scalars `stillCombo`, `stillTick`. `levels` grows with `BOON_COUNT` (20). Clone, hash names and the snapshot follow
   the existing pattern.
3. **Rules.**
   - `sword.ts`: `buildsOnGuardCancels` also counts `riposteCount` and Thunder Guard's sparks (positions from the
     sink); a new `buildsOnGuardEnd(ctx)` on the natural end only (Riposte's wave, Counterstrike's returns, Rebuke's ring,
     Stillwater's restore); a roll's cut and a swap discard the count.
   - `builds/riposte.ts` (new): waves (`spawnWave`, `stepWaves`, first in `stepBuilds`).
   - `bow.ts`: `bowChargeTicks(state, i)` (runMods `ballistaChargePercent`; exactly 36 without Ballista II); a release
     hook for Full Heart's beam.
   - `combat.ts`: `playerBulletHit`'s wall / unbroken-piece exits and `piercingBulletHit`'s last pierce call
     `buildsOnHeavyEnd(ctx, i, pos, payload, wall)` (queue the burst; the slam); `piercingBulletHit` reads the pin
     (no pierce spent while carrying); phase 5b `stepPins(ctx)` between the move and the collisions.
   - `builds/siege.ts` (new): pins (pin on the first surviving hit, carry, slam, the pinned mask).
   - `actors.ts`: `stepActors` skips `def.step` for a masked (pinned) actor; `damageActor` calls
     `buildsOnOvercap(ctx, dropped)`.
   - `player.ts`: the roll's step calls the leaf `buildsRollSmash(state, i, x, z, dx, dz)` before `movePlayer`.
   - `breakables.ts`: `damageBreakable(..., owner = -1)`; `ROLL` / `BUILD` scored; `buildsOnPieceBroken` queues smashes.
   - `builds/procs.ts`: smash procs (Wrecker's splinters and combo refill, Demolition's blast, Powder Keg's on-kill
     boons); `hasOnKillEffect` stays the kill gate, smashes have their own (`hasSmashEffect`).
   - `score/score.ts`: exported `refillComboTimer(state)` (a running combo only) and `stepCombo(state)` (+0.1, the
     timer refilled: `feedCombo`'s body); `stepScore` records Stillwater's combo before its cuts; Happy Hour's percent
     in `scoreKill`; `addOvercapScoreSources`, `scoreOvercap`.
   - Duos in `builds/duos.ts` (Thunder Guard, Dragon Bolt, Powder Keg's branch) and `builds/hooks.ts` (Stillwater,
     Rebuke, Happy Hour's drink, read on the drink tick as Overflowing does).
4. **Feed** (`BuildEvents`, unhashed): `waveX/Z/DirX/DirZ/HalfCos/Range/Speed/Owner/Damage/Kind` per spawned wave
   (forward / ring / Rebuke), `counterCount`; `ballistaX/Z/Owner/Fired/Wall`; `pinStart*` / `pinEnd*` (actor slot,
   owner, distance carried, `slam`); `slamX/Z/Owner/Struck`; `smashX/Z/Owner/Gen/Fired` and `demolitionX/Z/Owner`;
   `thunder*` through the spark lists (`sparkFork` 2: a Thunder Guard spark); `beamX1/Z1/X2/Z2/Owner/Struck`;
   `happyPlayer`; `overcapX/Z/Owner/Points`.
5. **Theme**: strings for the three boons (name, desc, icon, `.desc.2`, `.evo.name`, `.evo.desc`) and the seven duos,
   `fx.counter.text` ("COUNTER x{n}"), `fx.pinned.text`, `fx.slam.text`, `hud.draft.duoHint`,
   `score.source.overcap`, `hud.toast.happyHour`; context entries in `l10n/context.json`. Colour roles `build.counter`
   (the wave) and `build.overcap` (the pops; gold, `buildReport`: >= 40 CIE76 from every danger and boost role, and
   far enough from `newBest` that an overcap pop never reads as a record; measured in BV10). Port audio IDs
   `sfx.build.counter`, `sfx.build.pin`, `sfx.build.slam`, `sfx.build.smash`, `sfx.build.beam` (SILENT in the
   placeholder; `SFX_FALLBACK` entries to existing clips, picked in BV10). Ballista's bolts are `BulletKind.BURST` and the splinters and
   returns `SHARD`: no new bullet look (BVD9). Check `contract.luau` / `validate.luau` stay under Luau's 200 top-level
   locals (186 / 197 today).
6. **View**: the wave (a crescent / ring growing on the record's numbers, in `build.counter`), the parry tick's pitch
   climbing per bullet eaten (from the guard events), `COUNTER xN` / `PINNED` / `SLAM` floor text on the combo shout's
   construction (never over a bullet, CD9), the pin's drag streak, the slam's solo 40 ms freeze (the Goldling catch's)
   and shock ring, splinter and demolition pops climbing in pitch (voice cap, generation pitch), the beam, Happy Hour's
   pop colour, the overcap pops (merged per 0.25 s), the duo hint chip; Reduced `buildFx` thins the wave and drops the
   shock ring and the pops' particles. Recap lines (RUN_RECAP highlights, optional): best counter, longest pin (tiles),
   biggest demolition chain.

## Tasks

- **BV0 Audit.** Read the files in "What the code gives us" on the branch's base; record differences here as "BV0
  findings". Confirm: every builds run is scored; the bullet pool's `isLive` and free list as described; nothing can
  spawn a player bullet between phase 5 and the collisions; the indices free. **Verify:** findings written; indices
  confirmed.
- **BV1 Data and scaffolding.** The boons, duos, effects, sources, `ProcKind`, tunables, the hashed fields (no rule
  yet), the four port arc rows, `bowChargeTicks` (no Ballista: 36), placeholder strings, `DAILY.ruleset` 11 -> 12; the
  specs that count boons / duos / the builds group (as LG1 did). **Verify:** `npm run verify` green; the tutorial's
  floor-2 draft and `roomPool.lock.spec` unchanged; golden fixtures match; a builds run is offered and granted each new
  boon and duo (cards spec); the three boons reach II and III and the seven duos are offered only with both boons.
- **BV2 Riposte and Counterstrike.** `riposteCount`, `buildsOnGuardEnd`, waves, returns. **Verify:** specs: a guard
  that erases 4 sends a forward wave dealing 4 (x Sharpened) to an enemy 6 tiles ahead and nothing behind; 0 erased
  sends nothing; the cap (6 / 10); a wave hits an enemy once however long it stays in the band; a roll-cut guard and a
  swapped guard fire nothing; Counterstrike: 5 erased -> full ring + 5 returns, 4 -> forward wave, no returns; a full
  effect budget drops returns, never the wave; the wave kills proc at gen 0; two runs hash the same every tick.
- **BV3 Ballista.** The burst on the last pierce (ring) and on a wall / unbroken piece (back fan); II's bolts and charge.
  **Verify:** specs: a heavy arrow through 3 enemies bursts 6 on the third; into a wall, 6 back into the room (none
  spawned inside the wall cell); an expired arrow bursts nothing; stream arrows, Flurry arrows and the Ember Wake ring
  never burst; II charges in 27 ticks and the view's `bowCharge` reads it; no "arc table miss".
- **BV4 Siege Bolt.** Pins, phase 5b, the mask, plowing, the slam. **Verify:** specs: a bruiser hit is carried to the
  wall and slams for 300 %; a swarmer the first hit kills is not pinned; a boss, the Goldling and a turret are never
  pinned; a pinned actor does not fire or walk; an expired arrow drops its actor with no slam; a pinned actor killed by
  a teammate releases the arrow, which flies on; the drag never leaves an actor inside a wall or a piece (every tick,
  `isBodyBlocked` false at its centre); a body stopped by a pillar short of the arrow slams there; four pins at once,
  a fifth arrow plows only; the slot-reuse case (an arrow expiring on the tick a burst spawns) cannot hand a pin to the
  new bullet; co-op: two archers, one actor, one pin.
- **BV5 Wrecker and Demolition.** The roll smash, owners on `damageBreakable`, the two sources, smash procs, splinters,
  the combo refill and step, the blast. **Verify:** specs: a roll into a crate breaks it before the move and the roll
  reaches the far side; a piece broken by a swing / an arrow / a Volatile bolt splinters for its owner only; a teammate's
  break splinters nothing for you; the timer refill keeps a x2 combo alive past its window; a 4-crate cluster chains
  over 3 ticks and stops at `GEN_MAX`; the chest never breaks; pieces broken by `ROLL` / `BUILD` score; without Wrecker
  a roll still stops at a crate (golden runs, `breakables.spec`).
- **BV6 Wave 1 duos.** Thunder Guard, Stillwater, Rebuke, Dragon Bolt, Powder Keg. **Verify:** one spec each:
  Thunder Guard's sparks start at the erased bullets and cap at 8 a tick; Stillwater restores within 3 s, not after,
  once; Rebuke fires a ring from a bow roll through 8 bullets that restores a pip, none when no pip is missing (no Stone
  Heart), none on a second brace in the room, and replaces (not adds to) the guard's forward wave;
  Dragon Bolt's embers keep coming past 4 and stay inside the effect budget; Powder Keg's crate fires Volatile's ring.
- **BV7 Gap-3 duos.** Full Heart, Happy Hour. **Verify:** Full Heart's beam only at full hearts, from both the finisher
  and the heavy arrow; Happy Hour doubles kill points for 300 ticks after a drink, multiplied with Bounty.
- **BV8 Duo hint.** `duoUnlockedBy`, the chip and string on New cards. **Verify:** pure specs (no hint for upgrades,
  evolutions, duos, or a boon whose partner is unowned; one hint per card even with two duos); draft overlay renders it
  (Studio item 9). Presentation only: no hash change from this task.
- **BV9 Overcap points.** `overcap`, `ScoreSource.OVERCAP`, padding, the pops' events. **Verify:** specs: hitting a
  capped boss at 10/s for 10 s books 40 payouts of `OVERCAP_POINTS` (through `awardPoints`: combo, depth, curses, the floor scale); a phase-invulnerable boss pays nothing;
  the combo is untouched; a scored run without builds keeps 15 sources (hash unchanged); co-op credits the hitter.
- **BV10 Theme.** Strings, context entries, the two colour roles (measured), the five audio IDs and fallbacks.
  **Verify:** theme validator and `l10n:check` green; Luau locals counted on out/.
- **BV11 View.** Everything in Architecture 6. **Verify:** Studio checklist below; presentation only.
- **BV12 Tuning.** Extend the BU13 / LG7 harnesses: TTK rows for the three boons by level (sword / bow, room and pack),
  Riposte's counts per guard in sniper / caster / reaper rooms, pin rate and carried distance, smashes and chain length
  per floor band, overcap points per boss fight by build, and offer statistics with 20 boons (evolutions and duos per
  run by floor 11: pool dilution). **Verify:** tables in this doc; recommendations listed as owner calls, no number
  changed in this task.
- **BV13 Art, audio, Studio check, playtest.** Three boon icons and seven duo icons (BU11's sheet), the five clips
  (BU12's path); the checklist; frame time with Demolition in a storeroom and Siege Bolt + Dragon Bolt in a dense room
  within BU14's budget. **Verify:** vale pack validates; ids in `assetIds.ts`; checklist passed.

Studio checklist (BV11 / BV13): 1. the counter wave grows from the knight and reads as the bullets coming back; 2. the
parry tick climbs per bullet; 3. `COUNTER xN` never covers a bullet; 4. Counterstrike's ring and returns; 5. Ballista's
ring at the last pierce and the back fan at a wall; 6. a pinned bruiser travels with the arrow, its animation held, and
slams with a freeze and a ring; 7. a roll through a crate cluster; Demolition's chain one piece a tick; 8. Rebuke's ring
from a bow roll; 9. the duo hint chip on a New card (and none on an Upgrade); 10. overcap pops on a capped boss,
merged, never over a boss bullet; 11. Reduced build effects; 12. co-op: a teammate's waves, pins and smashes read as
theirs (owner tint rules as for sparks).

## Edge cases

- A guard cut by the floor change: the count is reset with the floor (no wave crosses floors; waves are cleared with
  the procs). The guard itself survives the floor change (weapon slots are not reset, BV0 findings), so BV2 zeroes every
  player's `riposteCount` in `clearBuildProcs`.
- Riposte with Mirror Cloak: the guard reflects as today; the counter fires on top. With Bastion: a 27-tick full-ring
  guard counts more, the wave stays forward unless Counterstrike's 5 or Rebuke.
- A wave reaching a boss: the cap applies (overcap points if over). Shielded absorbs. The Goldling can be struck
  (LGD12's rule for sparks and streaks).
- A heavy arrow that breaks a piece flies on (today's rule): no burst there.
- Siege Bolt with Piercing Arrows III (Ricochet): a last-pierce kill splits as today, but a carrying arrow spends no
  pierce, so it never has a last pierce while it carries.
- A pinned Charger mid-charge or Bomber mid-fuse: its step is held, so the charge and the fuse wait; a Bomber released
  by the slam's death never blasts (a killed Bomber fizzles, NE2).
- A pinned actor carried out of its room's box: the room's engagement and the score room records use the actor's
  position as for any knock (BV0 checks the room box tests tolerate it; fallback: the drag stops at the room's box and
  slams there).
- The vault chest is a piece and the solid decor is wall: a drag stops on either and slams; the chest never breaks.
- A smash on the floor-change tick: dropped with the queue. A piece broken by an enemy bullet or a boss slam has no
  owner: no splinters.
- Wrecker in co-op: one roll through a cluster another player is shooting: each piece belongs to whoever broke it.
- Stillwater with no running combo cut (a hit at x1.0 cuts nothing): nothing recorded.
- Happy Hour and the Greed draft: `happyHourTicks` waits through frozen draft ticks (counted in `stepBuilds`, which a
  frozen tick never reaches).
- Overcap on the boss's killing hit: the dropped part still pays.

## Decisions (2026-11-07; BVD3, BVD13-BVD15 settled by the owner, the rest defaults)

- **BVD1** Riposte's wave is a hashed expanding sweep, not bullets: one hit per enemy, sniper reach, no slot or arc row.
- **BVD2** The wave neither erases bullets nor hits breakables.
- **BVD3** (settled, owner 2026-11-07) Only a guard that runs its full length fires the counter; a roll's cut and a
  swap discard the count.
- **BVD4** Counterstrike's returns fire at the guard's end (with the ring), not per erase.
- **BVD5** A heavy arrow that expires in the air does not burst.
- **BVD6** One pin per arrow; a lost pin does not re-arm it.
- **BVD7** A carrying arrow plows (hits) without spending pierce.
- **BVD8** Ballista keeps the proposal's 6 / 10 bolts: four new port arc rows (6 / 10 @ FULL_RING, 6 / 10 @ the fan).
- **BVD9** No new bullet look: bolts are `BURST`, splinters and returns `SHARD`; the wave is the one new colour role.
- **BVD10** Demolition's chain is bounded by `GEN_MAX` like every cascade (3 pieces after the first).
- **BVD11** Demolition chains barrels and crates only: bookcases, tombs and pillars are walls (the proposal's
  bookshelf line is withdrawn).
- **BVD12** Pieces broken by a roll or a build effect score `BREAKABLES` like a swing's.
- **BVD13** (settled, owner 2026-11-07) Wrecker's splinters fire for every piece its owner breaks, not only rolled ones; the roll smash is what
  Wrecker adds to the roll.
- **BVD14** (settled, owner 2026-11-07) Rebuke: the name, and the ring fires only when the brace restored something
  (a pip, or Stone Heart's heal), once per guard or roll, replacing the guard's forward wave.
- **BVD15** (settled, owner 2026-11-07) Full Heart and Happy Hour ship in wave 1 (gap 3), as BV7.
- **BVD16** Stillwater's combo is the team's (the combo is team-wide); any owner's parry restores it.
- **BVD17** The duo hint says "Unlocks a duo: {name}": a duo is only offered once both boons are owned.
- **BVD18** Overcap points: `OVERCAP_POINTS` 10 per point of dropped damage at the kills' floor scaling, combo-neutral,
  builds runs only.
- **BVD19** Boon indices 17-19, duo indices 13-19 in this plan's order; wave 2 renumbers after them.
- **BVD20** `DAILY.ruleset` 11 -> 12 once, in BV1; the all-time boards stay `_v1` (BUD9's precedent).

## Risks

- **Siege Bolt's collision.** Dragging bodies is new (owner call 2 chose it). The drag reuses `moveActor`, so a body
  can never enter a wall, but a body pulled out of its room or into a doorway can strand an enemy; BV4's specs and BV12's
  pin census look for it.
- **Riposte trivialises bullet rooms with Bastion.** A 27-tick full-ring guard plus Counterstrike's ring may clear
  reaper and caster rooms by itself. BV12's counts decide; fallbacks: Rebuke and Counterstrike share a cooldown, or the
  cap stays 6 with Bastion.
- **Wrecker is floor-dependent.** Floors 1-4 have 0-2 pieces per 150 tiles; the boon may read as dead early. BV12's
  smash census decides; fallback: Wrecker's splinters also fire on a roll through an enemy (the proposal did not ask).
- **Pool dilution.** 20 boons: every given boon and evolution is rarer. BV12's offer table shows the cost; the upgrade
  pity and the duo hint soften it.
- **Cascade noise and frame time.** Demolition in a storeroom, Powder Keg and Dragon Bolt are new spawners. The proc cap
  and the effect budget hold the sim; the view needs the voice cap and pop merging (BUILDS.md audio risk). BV13 measures.
- **Overcap farming.** Points scale with damage over the cap; a strong build over a 45 s fight could pay more than the
  boss kill (5000). BV12 measures; `OVERCAP_POINTS` is the dial.

## Out of scope

- Wave 2: Hemorrhage, Berserk (on at or below 25 % of max hearts, owner call 3), Glutton, and the duos Adrenaline and
  Blood Shards. Read from the appendix when wave 1 is in.
- Partner bias in the draft odds (owner call 4: badge only).
- New bullet looks, a new card frame, recap lines beyond the optional three.

## Owner calls

Settled 2026-11-07 (the proposal's six):

1. Wave 1 is Riposte, Ballista and Wrecker; wave 2 stays Hemorrhage, Berserk and Glutton.
2. Siege Bolt is a true pin and drag; bosses and the Goldling never pin.
3. Berserk turns on at or below 25 % of max hearts (wave 2).
4. Duo hint: the badge only, no partner bias.
5. Overcap points: yes, their own score source.
6. A Bastion + Riposte duo, designed here: **Rebuke** (Design, Duos).

Settled on review of this plan (2026-11-07):

7. Rebuke keeps its name; its ring fires only when the brace restored something (BVD14).
8. A guard cut short by a roll fires nothing (BVD3).
9. Wrecker's splinters and Demolition fire for every piece the owner breaks (BVD13).
10. Full Heart and Happy Hour ship in wave 1 (BVD15).

## BV2 (as built)

Riposte and Counterstrike, on BV1's names. Paths under `src/shared/sim/` unless noted.

- **`builds/riposte.ts`** (new, in the builds barrel): `spawnWave(s, owner, x, z, dirX, dirZ, halfCos, damage, kind,
  count)` (a `BuildWave` record, radius 0, `RIPOSTE_WAVE_RANGE` / `RIPOSTE_WAVE_SPEED`; refused with no event once
  `RIPOSTE_WAVES_MAX` are live; pushes the `wave*` lists and `counterCount`), `buildsOnRiposteGuard(ctx, cancels,
  starting, guardFrom, braced)` (every guard tick: the count and BV6's duos), `buildsOnGuardEnd(ctx)` (the counter-wave),
  `stepWaves(ctx, s)` and `resetRiposteScratch()`.
  - The count: `riposteCount` += the guard tick's `cancels` (goo is never in it), Riposte owners only; reset on the
    guard's start tick (before the count, after Bastion's hook so a brace on the start tick is seen).
  - The end: on the tick the guard's counter reaches 0, with at least `RIPOSTE_MIN_ERASED` counted, a living present
    owner sends a wave from their position along the facing, damage min(count, `RIPOSTE_MAX_COUNT`[level]): FORWARD
    (`RIPOSTE_WAVE_HALF_ANGLE_COS`), or at level III with `COUNTERSTRIKE_RING_ERASED` or more a RING
    (`COUNTERSTRIKE_RING_HALF_ANGLE_COS`) plus min(count, max) returns queued in module scratch (owner, origin, count).
    The count is spent (zeroed) at every end, fired or not.
  - `stepWaves`: a party drops leavers' waves (`dropLeavers`' pattern); Rebuke's roll rings spawn (BV6); every wave in
    index order grows by speed x `SIM_DT` (capped at the range) and strikes each living actor not in `hits` with
    d2 <= (radius + a.radius)^2 inside the cone (melee's `inCone`: skipped only when d > a.radius and dot < halfCos x d),
    slot order: id pushed to `hits`, then `ctx.damageActor(a, playerHitDamage(owner, damage))` under
    `ctx.actingPlayer(owner)`, `procGen` 0, `KillCause.NONE`; a wave is removed after the tick its radius reached the
    range (18 ticks). Then the queued returns fire (`fireAimedVolley`, `COUNTERSTRIKE_RETURN` within
    `COUNTERSTRIKE_RANGE`, `BuildEffect.RIPOSTE` gen 0), after the wave struck, so they aim at what survived. A dead
    owner's waves keep going; waves erase no bullet and hit no piece (BVD2).
- **`combat/weapons/defs/sword.ts`** (the guard branch only): `guardFrom` (the score events' `guardX` size before the
  sweep); after `buildsOnGuardCancels` (unchanged) `buildsOnRiposteGuard` with `braced` (Bastion's `bracePlayer` grew in
  that call), and `if (v[SWORD_V_GUARD] === 0) buildsOnGuardEnd(ctx)`: only the full-length end (BVD3). The roll
  branch and the swap branch are untouched: a roll or a swap zeroes the counter without the end hook.
- **`builds/hooks.ts`**: `buildsOnRollStart` and `buildsOnSwap` also zero `riposteCount` (and Rebuke's mark, BV6) for
  every builds player (0 already for anyone without Riposte, so no hash moves).
- **`builds/procs.ts`**: `stepWaves(ctx, s)` right after `beginEffectBudget` (inside the budget session, so the returns
  count in it), before `stepEvolutions`; `resetRiposteScratch()` in `resetBuildScratch`.
- **`builds/builds.ts`**: `clearBuildProcs` (the floor change) zeroes every player's `riposteCount` and `rebukePending`.
- **The floor change (choice).** The guard itself is **not** stopped at the floor change: weapon slots are not reset
  there for anyone (BV0), and stopping it would change the guard (and Bastion's brace) for players without Riposte.
  Its count is discarded, so a guard running across the change fires nothing for the old floor's bullets; it would
  only fire for bullets it erased in its remaining ticks on the new floor (there are none at a floor's start).
- **Specs** `builds/riposte.spec.ts` (BV2 part): 4 erased -> one FORWARD wave on the guard's 18th tick dealing 4 (5 with
  Sharpened, `playerHitDamage`) to a dummy 6 tiles ahead, nothing to one behind; the wave's growth (0.4 a tick) and
  18-tick life; 0 erased and goo-only guards send nothing; the cap (12 erased: 6 at I, 10 at II); one hit per enemy (a
  body on the origin and one in the band); a roll-cut guard and a swapped guard (out, 30 ticks, back in) fire nothing and
  zero the count; a guard across the floor change fires nothing; a wave kill procs at gen 0 (Chain Spark's segment
  `sparkGen` 0); `RIPOSTE_WAVES_MAX`; Counterstrike 5 -> RING + 5 returns (the dummy behind struck), 4 -> FORWARD, no
  returns; a full effect budget (`effectBulletsMax` live shards) drops all 6 returns (`effectDropped` 6) while the ring
  still deals 6; determinism (below). `builds/builds.spec.ts`: 14 per-player scalars, `rebukePending` last,
  `clearBuildProcs` now zeroes `riposteCount`.

## BV6 (as built: Thunder Guard, Stillwater, Rebuke)

The three guard-side duos (BV6's other two, Dragon Bolt and Powder Keg, are another worker's). Paths under
`src/shared/sim/`.

- **New hashed field**: `rebukePending` appended LAST to `BuildPlayerState` / `BUILD_PLAYER_SCALARS` (after
  `happyHourTicks`; nothing BV1 declared could say "this guard braced"), values `RebukePending` { `NONE` 0, `GUARD` 1,
  `ROLL` 2 } (`builds/effectsData.ts`, after `WaveKind`). Every builds run's group grows by 1 per player. `ROLL` never
  outlives its tick (set in the enemy bullet walk, consumed by `stepWaves` in 6b).
- **Thunder Guard** (`builds/riposte.ts` `buildsOnRiposteGuard`, `builds/duos.ts`): an owner's guard tick queues
  min(cancels, `THUNDER_GUARD_MAX`) sparks (`queueThunderSpark(owner, x, z)`: the existing spark queue, duo
  THUNDER_GUARD, slot -1, id `NO_SKIP_ID`) from the positions the guard's sink recorded this tick (`guardX` /
  `guardZ` from `guardFrom`; without a score, the player's position). `releaseSparks` (after the drain) gives each to
  `thunderSpark`: the nearest living enemy within `THUNDER_GUARD_RANGE` takes `playerHitDamage(owner,
  THUNDER_GUARD_DAMAGE)` with `procGen` 1 and `KillCause.SPARK`; one spark segment (`sparkGen` 0, `sparkFork`
  `SparkFork.THUNDER`) and the usual `duoProc` entry (value 1) per spark that struck.
- **Stillwater** (`builds/hooks.ts` `buildsStillwaterRecord`, `score/score.ts`, `builds/riposte.ts`): `stepScore`, right
  before the cut loop, with `cuts > 0`, a running combo and builds: when a present player owns the duo, records
  `stillCombo` = the combo before the cuts and `stillTick` = the tick. **Deviation (choice):** a live record (within
  `STILLWATER_TICKS`) of a combo at least as high is kept as it is (combo and tick), so a second hit never lowers what
  can be given back. An owner's guard tick that erased >= 1 bullet with a record calls `stillwaterRestoreCombo(state,
  stillCombo)` (new export in score.ts: combo = max(now, recorded), `maxCombo` kept, timer refilled to the window; it
  does not set `comboFed`) when `tick - stillTick <= STILLWATER_TICKS`, and clears the record either way (an expired one
  too). Team-wide (BVD16), scored runs only.
- **Rebuke** (`builds/riposte.ts`, `builds/hooks.ts`): a brace that pushed PIP or HEAL marks the owner: in a guard
  (`braced` from sword.ts) `GUARD`; in a roll (`buildsOnRollThrough`, the brace list grew) `ROLL`. `GUARD`: the guard's
  full-length end sends a REBUKE ring (`COUNTERSTRIKE_RING_HALF_ANGLE_COS`, damage min(`riposteCount`, max)) instead
  of the forward wave or Counterstrike's ring; **Counterstrike's returns still fire** with it (choice: the returns are
  Counterstrike's own, the ring only replaces the wave). A roll's start or a swap discards `GUARD`, so a guard that
  braced and is then cut fires nothing. `ROLL`: `stepWaves` spawns the REBUKE ring at once from the roller (any weapon),
  damage min(`braceCount`, max) as counted by then. Once per guard or roll (the mark is reset on the guard's start and
  the roll's start; a brace fires once per count). A brace that restored nothing pushes no brace, so marks nothing.
- **Specs** `builds/riposte.spec.ts` (BV6 part): Thunder Guard: 10 erased -> exactly 8 THUNDER segments, each starting
  at the first 8 `guardX` / `guardZ` positions, all at the dummy, 8 damage; none without the duo. Stillwater: a hit at
  x3.0 records 30 and the tick; an erasing guard 179 ticks later restores 30 and clears the record; the next guard
  gives nothing; 181 ticks later restores nothing; a guard that erased nothing keeps the record; no record without the
  duo or at x1.0. Rebuke: a bow roll through 8 bullets with armor 0 restores the pip and sends one REBUKE ring at once
  (damage 6, `counterCount` 8) that strikes a dummy behind; none at full armor (no Stone Heart), none on a second brace
  in the room, none without the duo; a guard that braces sends one REBUKE ring (not a forward wave beside it; FORWARD
  without the duo); a braced guard cut by a roll sends nothing. Determinism: a co-op room of 12 firing `test.chaser`s,
  both players at Riposte III with Chain Spark, Composure, Bastion and all three duos, guarding into volleys and
  rolling for 240 ticks: two runs hash the same every tick (waves > 0).
## BV3 (as built)

Ballista I / II / III's bursts and II's charge. Gameplay, builds runs only: a run whose players own no Ballista takes
exactly the old paths (the walk's new branches sit behind one per-tick boolean, `ballistaOn`, false without Ballista and
pins). Paths under `src/shared/sim/` unless noted.

- **Heavy arrows** (`builds/duos.ts`): `isHeavyArrow(payload, vx, vz)` beside `bowArrowLife` (kind PLAYER, the bow's
  source, the heavy arrow's squared speed within `ARROW_SPEED_TOLERANCE`). Stream / Flurry arrows (16), the bow-held
  Ember Wake ring (12) and effect bolts (Ricochet's splits are `SPARK_BOLT`) are not.
- **`builds/ballista.ts`** (new): `ballistaActive(state)` (some player owns Ballista, or a pin record exists),
  `buildsOnHeavyEnd(ctx, i, pos, payload, wall, struck?)` (called by the walk where a heavy arrow is consumed; ends its
  Siege Bolt record through `siegeArrowEnd` and queues the owner's burst in module scratch), `stepBallista(ctx, s)`
  (fires the queue: `fireEffect`, `BuildEffect.BALLISTA` gen 0, the owner's level at fire time through `levelEntry`;
  a departed owner's bursts are dropped; `ballistaX / Z / Owner / Fired / Wall` per burst that spawned a bolt) and
  `resetBallistaScratch` (in `resetBuildScratch`).
  - Ring (`BALLISTA_RINGS`): the last pierce (`piercingBulletHit`'s `pierce === 0` hit). **Deviation:** centred on the
    struck enemy, its bolts spawned on that enemy's hit circle (BurstSpec `radius` = its radius + `PLAYER_BULLET_RADIUS`)
    and flying outward, turned onto the arrow's flight direction. "A ring at the hit" taken literally (at the arrow's
    position) puts every bolt inside a surviving enemy, which would soak the whole ring next tick (+6 / +10 damage to one
    enemy, no burst); the spec pins that a survivor keeps its hp and the bolts all fly away from it.
  - Back fan (`BALLISTA_FANS`): a blocked cell or a piece it does not break (`playerBulletHit`'s two consuming exits:
    the chest, or a piece with hp left), from `pos - v x SIM_DT` aimed along `-v` (one sqrt). A blocked start position
    (an arrow fired point blank into a wall) fans nothing, so no bolt ever spawns in a wall cell. A Siege Bolt slam's fan
    starts from the slammed actor instead (BV4).
  - Nothing for an arrow that expires (the pool releases it silently), breaks a piece and flies on, or is no heavy arrow.
- **Charge**: `RunMods.ballistaChargePercent` (appended, derived, not hashed; `NEUTRAL_RUN_MODS` 100;
  `perLevel(level(Boon.BALLISTA), BALLISTA_CHARGE_PERCENT, PERCENT)`); `combat/weapons/defs/bow.ts` `bowChargeTicks` =
  `scaleTicks(BOW_DATA.chargeTicks, ...)` (36 itself at 100, 27 at 75); `client/controllers/render/WeaponViewController.ts`
  passes `bowChargeTicks(s, me)` to `bowCharge`.
- **Hot files**: `combat/combat.ts` (imports; `ballistaOn` next to `buildsOn`, set in the collide setup and cleared after;
  `playerBulletHit`'s wall exit and unbroken-piece exit, each one `buildsOnHeavyEnd` line; `piercingBulletHit`'s
  consuming hit); `builds/procs.ts` (`stepBallista` as step 1b after `stepDuosBeforeDrain`, the scratch reset).
- **Specs** (`builds/ballista.spec.ts`, a hand-built walled floor): ring on the third of three enemies (6, BURST, BALLISTA
  gen 0, flying outward, the survivor untouched), the ring's bolts hitting enemies round it, 6 / 10 / 10 by level and
  none without Ballista, an expired arrow, the wall's fan (start-of-tick position, outside the wall, every bolt within the
  1.6 rad spread of `-v`), a point-blank wall shot, the chest's fan and a crate it breaks (flies on, fans at the wall),
  stream / Flurry / Ember Wake ring / Ricochet bolts never burst, a real charged shot vs the stream, `bowChargeTicks` 36 /
  36 / 27 / 27 and `bowCharge` reading it, a 27-tick hold releasing at II (26 not, 36 at I), and a full effect budget
  dropping the burst (`effectDropped` 6).

## BV4 (as built)

Siege Bolt (Ballista III). Paths under `src/shared/sim/` unless noted.

- **`builds/siege.ts`** (new; the file comment is the rule): `siegeTryPin` (the walk, after a piercing hit's damage),
  `stepPins` (phase 5b), `siegeCarriedSlot` / `siegeSlamDue` (the walk's reads), `siegeArrowEnd` (the slam; from
  `buildsOnHeavyEnd`), `PIN_SPENT` (-1).
  - **One pin per arrow, hashed** (BVD6): when a carried actor dies or its slot is freed (slot AND id checked), its
    `BuildPin` becomes a **spent record** (`slot` -1, `id` 0, `slam` 0) and stays until its arrow is consumed or expires,
    so the arrow, flying on as an ordinary heavy arrow (pierce spent again), can never pin again. No field added: the
    record's `slot` says it. `SIEGE_PINS_MAX` counts carrying records only (spent ones live at most an arrow's 0.7 s).
  - **Pin**: a heavy arrow of a present Ballista III owner with no record hits an actor that survives the hit; never a
    boss (`def.data.boss`), the Goldling (`GOLDEN_KIND`), a reviver (`def.stepDead`), `PROC_INELIGIBLE_ARCHETYPES` or an
    actor already pinned; `pinStart*`. **The pinning hit spends no pierce** and so never consumes the arrow (the plan
    leaves it open; a pin on the arrow's last pierce would otherwise end at once): the pin wins over the last pierce's ring.
  - **Phase 5b** (`combat/combat.ts`, one line after the player bullets move, only with records): a departed owner's
    record is dropped; a record whose slot is not live, or no longer holds a heavy arrow (belt and braces: by BV0 nothing
    spawns between the move and the walk), is dropped (an expired arrow: no slam); a carried actor that died or was freed
    makes its record spent; the rest drag their actor onto the arrow with `moveActor` (no steer) and set `slam` when it
    ends more than `SIEGE_SLAM_SHORT` short. Ended carries push `pinEnd*` (carried = distance from x0 / z0, slam 0).
  - **Held**: `combat/ctx.ts` `pinMask` / `rebuildPins()` / `isPinned(a)` (the aura mask's construction: actor -> id,
    rebuilt first thing in `stepActors` from the carrying records, cleared by `bind`; never hashed), and
    `combat/actors/actors.ts` `stepActors` skips `def.step` for a pinned living actor (prevX / prevZ and the hit flash
    still update; contact damage unchanged).
  - **Plow** (`piercingBulletHit`): `carriedSlot` (the live pinned actor) is skipped like `lastHit`; while it is set no
    pierce is spent and no hit consumes the arrow (`buildsOnPierceHit`'s `consumed` and `buildsOnArrowHit`'s `passing`
    follow, so Ricochet never splits a carrying arrow); `lastHit` still moves to each actor hit, so each is hit once.
    With no pin both flags are exactly the old `pierce === 0` / `pierce > 0`.
  - **Slam** (the arrow's walk visit: a blocked cell, a piece it does not break, or `siegeSlamDue`, checked after the
    pieces and before the piercing walk): the pinned actor takes `playerHitDamage(owner, scalePercent(payload damage,
    300))` at procGen 0; every other living enemy within `SIEGE_SHOCK_RADIUS` (centre distance; not one spawned this tick),
    slot order, `playerHitDamage(owner, SIEGE_SHOCK_DAMAGE)` at procGen 1 (ctx.procGen / procCause saved and restored:
    the wall exit runs before the walk binds them); every intact piece but the chest whose cell centre is within the
    radius breaks through `damageBreakable(state, slot, piece hp, BreakableSource.BUILD)` (a `// Wrecker: owner` comment
    marks where BV5's owner argument goes; `BUILD` scores nothing until BV5). The record is removed, `pinEnd*` (slam 1) and
    `slam*` pushed, and Ballista's back fan queues **from the slammed actor** (its hit circle, aimed `-v`): from the arrow,
    as the plan's fan, every bolt would start inside the body just behind it and hit it (+10 at III).
- **BV0 checks.** The Charger: held mid-charge it keeps `CHARGER_CHARGE` and its `CHARGER_LEFT`; dropped on open floor
  outside its room's box, its next charge tick's box bound cuts the step to 0 and it is stunned (spec); outside a charge
  it cannot start a lane until it walks back inside the box, so nothing strands it outward. Score rooms are membership
  lists (BV0), so carrying out of a room changes nothing there. The Goldling is never pinned, so its walk mask never sees
  a dragged Goldling. A pinned Bomber's fuse waits (its step is held).
- **Specs** (`builds/siege.spec.ts`, a walled floor with nine pillars): carried to the wall (the body exactly on the arrow
  every tick until it stops, at x <= 36) and slammed for 5 + 15, the back fan, released afterwards; the shockwave (two in
  the radius take 3, one outside none; a crate in the radius breaks, one outside and the chest do not); a swarmer the
  first hit kills is not pinned, the dummy behind it is; a boss, the Goldling, a turret and the training dummy never are;
  a pinned test chaser / sniper / bruiser keeps every AI field and fires nothing while carried; an expired arrow drops its
  actor (no slam, no fan); a pinned actor killed by someone else leaves a spent record and the arrow hits the next one as
  an ordinary arrow without pinning it; plowing through five (pierce never spent, each hit once); the Charger case; a
  pillar stopping the body beside the arrow's lane (slam there); 60 drags across the pillared room (30 lanes x 2
  directions, two chests in the way) with the body's centre cell and circle clear of walls and pieces every tick; four pins
  at once and a fifth arrow that plows only; the slot-reuse case (a pinned arrow expiring on the very tick a wall fan
  spawns: its slot goes to a BURST bolt, no record survives, the actor is never dragged again); co-op (two archers on one
  actor: one pin, the second arrow still hits it; a departed archer's pin dropped with no slam); determinism (a dense room,
  Ballista III + Ember Wake + Dragon Bolt, 600 ticks of charged shots twice: identical hashes every tick, pins and slams
  happen).

## BV6 (as built, Dragon Bolt)

Dragon Bolt only (Ballista + Ember Wake; the other wave 1 duos are other tasks). `builds/duos.ts`: the Fire Arrows walk
also runs when any player owns Dragon Bolt (`dragonBoltOn` per player, beside `fireArrowsOn`); a live heavy arrow of an
owner (`bowArrowLife` = the heavy life) drops an ember at every age that is a multiple of `DRAGON_BOLT_EMBER_TICKS` for
its whole flight (no `FIRE_ARROWS_EMBERS_MAX`), ember duo `Duo.DRAGON_BOLT` (the walk now records each ember's duo). An
owner of both duos gets Dragon Bolt's schedule on heavy arrows (a superset of Fire Arrows' ages 6 / 12 / 18 / 24: no
doubled ember) and Fire Arrows' on the rest. Embers go through `dropEmber` / `fireEffect`, so the effect budget holds
them. Specs (`builds/ballista.spec.ts`): ages 3, 6, 9, ... while it flies (13 in its 0.7 s, past 4), none without the
duo, Fire Arrows + Dragon Bolt (one ember per tick at most, all Dragon Bolt's), none from stream arrows, and a nearly
full budget spawning 3 then dropping the rest.
## BV5 (as built)

Wrecker and Demolition (gameplay, builds runs only). Paths under `src/shared/sim/`. Nothing changes for a player
without Wrecker (or Powder Keg): no proc is queued, the roll hook returns at its ownership test, and the only shared
change, two more scored breakables sources, reaches no run today (nothing but Wrecker passes `ROLL`; `BUILD` is also
passed by BV4's Siege slam). M1, every golden fixture and the tutorial (no builds, no breakables) replay as before.

- **`breakables/breakables.ts`.** `damageBreakable(state, slot, amount, source, owner = -1, gen = 0)`: the chest still
  returns before anything; `ROLL` and `BUILD` breaks score like a swing's (BVD12); after `dropsOnBreak`, a break with
  an owner calls the leaf hook `buildsOnPieceBroken(state, slot, owner, gen)`. `meleeHitBreakables` takes a trailing
  `owner = -1` (generation 0). New `rollSmashBreakables(state, owner, x, z, dx, dz)`: every intact non-chest piece, in
  slot order, whose circle (`config.hitRadius` round its cell centre) the body (`PLAYER_RADIUS`) touches along the
  step (squared segment-to-point distance strictly below the radii's sum, a division for the segment parameter, no
  trig or sqrt) breaks at full hp, `BreakableSource.ROLL`, owner, gen 0. Bound into the leaf at load
  (`bindRollSmash(rollSmashBreakables)`).
- **`builds/wrecker.ts` (new leaf).** `player.ts` cannot import `breakables.ts` (its scoring imports `party.ts`, which
  imports `player.ts`: a require cycle), and `breakables.ts` needs the proc queue, so the hooks sit in a leaf importing
  only data, `shared/dungeon` and `./hooks.ts`: `hasSmashEffect(p)` (Wrecker at any level, or Powder Keg),
  `buildsOnPieceBroken` (queues `{ x / z the cell centre, owner, gen, slot -1, id -1, excess 0, kind SMASH }` when the
  owner has a smash effect, has not left and `gen < genMax`), `buildsRollSmash(state, i, x, z, dx, dz)` (Wrecker owner
  present: calls the bound `rollSmashBreakables`; an unbound smasher is an error: `breakables.ts` creates
  `state.breakables`, so it is always loaded when there are pieces) and `bindRollSmash`.
- **`player.ts`.** The roll branch calls `buildsRollSmash(state, playerIndex, p.x, p.z, dx, dz)` (only with
  `state.builds`) right before `movePlayer`, so the pieces leave the solid cells before the move and the roll goes
  through. `playerIndex` is the party index in co-op (`stepParty` passes it) and `SOLO_PLAYER` 0 solo.
- **Owners at the call sites.** `combat/weapons/melee.ts` `sweepArc` passes `ctx.playerIndex` (the swinging player;
  only the sword's swings pass `breakableDamage`); `combat/combat.ts` `playerBulletHit` passes `ctx.playerIndex` (the
  bullet's owner, bound by `playerBulletHitParty`) and `ctx.procGen` (the bullet's `killGenOfSource`: 0 for a weapon
  shot, gen + 1 for an effect bolt). Enemy bullets, the boss slam, Bomber blasts and Charger charges keep no owner.
- **`builds/smash.ts` (new).** `resolveSmash(ctx, s, q, p)`: at III (Demolition) first the blast (one `demolition*`
  entry; every living enemy not spawned this tick whose body reaches within `DEMOLITION_RADIUS` of the cell centre,
  i.e. centre distance <= radius + body radius, slot order, takes `playerHitDamage(owner, DEMOLITION_DAMAGE)` through
  `ctx.damageActor` at `procGen` gen + 1; then every intact non-chest piece whose cell centre lies within the radius
  breaks at full hp, `BUILD`, owner, gen + 1, queuing its own smash); then the splinters (`fireAimedVolley`,
  `WRECKER_SPLINTERS[level]` x `WRECKER_SPLINTER` within `WRECKER_RANGE`, `BuildEffect.WRECKER` at the proc's gen);
  then the combo (III: `stepCombo`, one step per exploding piece; I-II: `refillComboTimer`); one `smash*` entry
  (`smashFired` = splinters spawned).
- **`builds/procs.ts`.** `resolveProc` branches on `q.kind`: a SMASH resolves through `resolveSmash` (when
  `hasSmashEffect`) and returns, except for a Powder Keg owner (BV6 below). `hasOnKillEffect` stays the kill gate.
  `dropLeavers` needed no change: it drops by owner, kills and smashes alike (comment says so; a spec covers it).
- **`score/score.ts`.** `refillComboTimer(state)` (timer = the window, only when combo > `COMBO_MIN` and the timer is
  running) and `stepCombo(state)` (`feedCombo`'s body: +0.1 capped, timer refilled, `comboFed`).
- **Barrel.** `builds/index.ts` exports `./wrecker` and `./smash`. No new hashed field, tunable, event list or string:
  BV1's `BuildProc.kind`, `smash*` / `demolition*` lists and Wrecker tunables are used as declared.

Decisions taken while building (defaults, open to BV11 / the owner):
- **Order inside a Demolition smash:** blast first, splinters after, so the splinters aim at what the blast left alive.
- **Demolition's combo step** is per exploding piece (each Demolition smash resolved), the first piece included; the
  last piece of a chain (broken at `genMax`, no smash) adds none. A Demolition smash can start a combo from x1.0
  (`stepCombo` is a feed); Wrecker I-II only refill a running one.
- **Blast reach** counts the enemy's body (as the wave's `d - a.radius <= radius`); pieces use the centre distance
  (as `slamBreakables`). A cluster's pieces are 1 tile apart, so the 1.5 radius reaches orthogonal and diagonal
  neighbours only.
- **Roll smash touch** is strict (`<`): a body resting flush against a crate and rolling away does not break it.
- A dead owner's bullets still break pieces for them (only "left" is tested, as for kills).

Specs: `builds/wrecker.spec.ts` (13): without Wrecker the roll stops at a crate row's face and breaks nothing; with
it the middle crate breaks before the move (the body did not yet reach it at the tick's start), the side crates stay,
the roll's path equals a roll on open floor tick for tick and reaches the far side, and the break scores; the chest
never breaks and stops the roll (Wrecker III); a sword swing's break queues a smash at the cell centre and fires 3
SHARD splinters (gen 0); an arrow's break (gen 0, level II: 5) and a Volatile bolt's (gen 1) splinter; no enemy: 0
splinters; an enemy bullet's break queues nothing; co-op: a teammate's break splinters nothing for you, yours is
credited to you; a leaver's queued smash is dropped; the refill keeps a x2 combo alive past its window (control: it
lapses), nothing at x1.0; Demolition: a line of five crates breaks on ticks t, t, t + 1, t + 2 and the fifth stays
(smash gens 0 / 1 / 2, three blasts, combo +0.3, four BREAKABLES counts, a chest beside the chain intact); the blast
hits a body within reach and not one just outside, and its kill procs at gen 1; Powder Keg (below); a dense room
with Demolition, Powder Keg, Volatile and Soul Shards (bow, rolls through two rows) hashes the same every tick.

## BV6 (as built, Powder Keg only)

Powder Keg (Wrecker + Volatile; the other BV6 duos are other workers'). In `builds/procs.ts` `resolveProc`: after
`resolveSmash`, a smash of an owner with `Duo.POWDER_KEG` pushes one `duoProc` entry (`Duo.POWDER_KEG`, the owner, the
cell centre, value 1) and falls through to the on-kill loop with the smash proc itself, so Chain Spark, Volatile
(Shrapnel's ring with that duo) and Soul Shards fire from the piece at the owner's levels and the proc's gen, exactly
as a kill proc there would (slot / id -1: nothing is skipped as the victim; excess 0: Overkill and Supernova do
nothing). Spec (`builds/wrecker.spec.ts`): a crate broken by a Wrecker + Volatile + Powder Keg owner fires Volatile's
ring at the cell centre (`burst*` event, gen 0, `VOLATILE_BURSTS[0].count` bolts live) beside the splinters and a
Powder Keg `duoProc`; without the duo, no ring.
## BV7 (as built)

Full Heart and Happy Hour, gameplay, builds runs only (both need the duo, which only `SimConfig.builds` deals). Paths
under `src/shared/sim/` unless noted.

- **Full Heart** (`builds/fullHeart.ts`, new): `fullHeartBeam(ctx, dirX, dirZ)`: nothing without `state.builds`, the
  duo, or with the acting player dead or below full hearts (`hearts !== heartsMax`); else the segment from the player
  to `FULL_HEART_RANGE` along the unit direction, every living enemy whose centre is within `FULL_HEART_RADIUS` of it
  (nearestEnemy's skips: free slots, corpses, actors spawned this tick; no actor radius, as Skewer), chosen in slot
  order before any strike, each struck through `ctx.damageActor` for `playerHitDamage(owner, finisherDamage)` at
  `procGen` 0 (restored after). One `beam*` event per beam (`beamStruck` may be 0: the beam still shows). Returns the
  count struck, -1 for no beam. It neither erases bullets nor hits breakables.
  - Callers: `builds/evolutions.ts` `buildsOnFinisher` (one line, along `faceX` / `faceZ`, before the Swift Strikes
    check, so every finisher fires it) and `combat/weapons/defs/bow.ts` (one line right after the heavy arrow's
    `muzzleFire`, along the assisted aim `dir`, guarded by `state.builds`). The stream never fires it.
  - The finisher damage is read through the weapon registry (`weaponAt(weaponIndex(FULL_HEART_WEAPON_ID))`, a new
    constant `FULL_HEART_WEAPON_ID` = `"weapon.sword"` in `effectsData.ts`): bow.ts cannot import sword.ts's
    `SWORD_DATA` (sword.ts -> evolutions.ts -> fullHeart.ts would cycle).
  - Skewer's point-to-segment test moved to a leaf `builds/segment.ts` (`nearSegment(x, z, x1, z1, x2, z2, r2)`, the
    same operations in the same order); `onKill.ts` `onSkewerLine` now calls it (Skewer unchanged).
- **Happy Hour** (`builds/hooks.ts`, the leaf): `stepHappyHour(state, s)`, called by `stepBuilds` right after
  `stepBraceCooldowns` (`builds/procs.ts`, one line): every player's `happyHourTicks` counts down by 1, then an owner
  present, alive and on the drink tick (`flaskTicks === FLASK_USE_TICKS`, Overflowing's moment) gets
  `HAPPY_HOUR_TICKS` (a drink while it runs restarts it) and a `happyPlayer` entry. A frozen draft tick never reaches
  stepBuilds, so the timer waits. `buildsHappyHourPercent(state, killer)`: `HAPPY_HOUR_KILL_PERCENT` while the
  killer's timer runs and they are present, else 100. `score/score.ts` `scoreKill` folds it into the existing bonus
  (Bounty, then the affix percent) with `combinedPercent` (130 x 200 / 100 = 260; exactly the bonus at 100), so
  `awardPoints` keeps its integer numerator. It applies to every kill branch the bonus reaches (kills, the boss, the
  Goldling's jackpot), as Bounty does. Window: the drink tick's drain kills and the next 299 ticks get it, and tick
  300's weapon-phase kills (the countdown runs at the start of stepBuilds).
- **Specs** (`builds/gapDuos.spec.ts`, new): tunables; a finisher's beam strikes an enemy past the swing's reach (one
  beam per finisher, its segment, Sharpened's damage), none off the line; no beam below full hearts, without the duo,
  or dead; the heavy release's beam along the assisted aim (none during the charge, none below full hearts, none from
  the stream); slot order, the radius at the segment's end, kills queue procs at gen 0; co-op per-player ownership;
  Happy Hour's start / countdown / no-duo case; doubled kill points at Bounty 0 / I / III on the drink tick and on the
  300th tick, back to normal after, 130 x 200 / 100 = 260; co-op (a teammate's kill unchanged); a determinism run (8
  swarmers, both duos, a drink at tick 100: two runs hash the same every tick).

## BV8 (as built)

Presentation only (no sim, hash or replay change).

- **`src/shared/view/hud/draftCards.ts`**: `duoUnlockedBy(levels, duos, boon)` (pure: empty for an owned boon; else
  every duo with `duoAvailable` false now and true with `boon` at level I, in duo index order); `draftDuoHint(levels,
  duos, boon)` (the first: `DraftDuoHint { duo, chipIcons, chipRoles, text }`, the chip exactly the duo card's, the
  text `hud.draft.duoHint` with `varKeys { duo: <duo>.name }`); `DraftCardModel.hint?` (only on the New branch);
  `draftCardModel(card, kind, levels?, duos?)` takes the local build as two optional trailing arguments (absent
  without builds: no hint); the duo chip is built by one helper `duoChip(d)` for the duo card and the hint.
  `DRAFT_CARD_VIEW` gained `hintChipCell` 16, `hintChipText` 8, `hintText` 14, `hintTextMaxWidth` 180.
- **String**: `PROGRESSION_STRINGS.draftDuoHint` = `hud.draft.duoHint` ("Unlocks a duo: {duo}", placeholder
  manifest) with an `l10n/context.json` entry (max 36). Not added to `BUILD_STRING_KEYS` (BV10 decides what is
  required); `progressionStringKeys` lists it through `PROGRESSION_STRINGS`.
- **Client**: `DraftRevealController.begin` passes `run.state.builds?.players[localIndex]`'s `levels` / `duos` to
  `draftCardModel` at the deal (the state, as `draftCardKinds` already reads; the snapshot carries the same).
  `DraftOverlay.tsx`: the duo chip is a component (`DuoChip`, cells from `chipCells`), shared by the banner row and a
  new `HintRow` at the card's foot (`WAS_TOP`: a New card has no "was" line; the description shrinks to the Upgrade
  card's height while a hint shows): the smaller chip outlined in `boon.duo` and the line in `boon.duo`, truncated
  past `hintTextMaxWidth`, faded with the card's text. **Deviation:** the plan says "under the banner"; the banner row
  sits at 0.30 and the description at 0.48 of a 150 px card, so the hint takes the foot row instead of pushing the
  description down. Studio item 9 pending.
- **Specs** (`src/shared/view/hud/duoHint.spec.ts`, new): an unowned boon with its partner owned unlocks the duo; an
  unowned partner, a taken duo or an owned boon unlock nothing; several duos in index order (and the definition
  checked over every boon); the New card's hint (first duo only, the duo card's chip, key and varKeys); no hint on
  Upgrade / Evolution / Duo cards, without a build, or with the partner unowned; the placeholder reads "Unlocks a
  duo: Thunder Guard".

## BV9 (as built)

Gameplay (score), builds runs only.

- **Score sources** (`score/scoreData.ts`, `score/score.ts`): `OVERCAP_SCORE_SOURCE_NAMES` `["overcap"]`;
  `addOvercapScoreSources(s)` pads points / counts to `ScoreSource.OVERCAP + 1` (16), every earlier gated source
  included; `createSimState` calls it LAST (after the Goldling's padding) when `config.builds` and a score are set;
  `sourceName` (the dump names) knows it. A scored run without builds keeps its sources and hash (9 bare, 15 for an
  endless config without builds); every builds run's `score` group grows (a builds-only run from 10 to 16 sources, an
  endless run from 15 to 16). No nextFloor / clone change (both copy the arrays). `scoreOvercap(state)`: one award of
  `OVERCAP_POINTS` at `floorScalePercent(scoreFloor(state))` into OVERCAP through `award` (combo, depth, curses), never
  the combo (scoreGoldenHit's way); 0 without the source.
- **Hook** (`builds/overcap.ts`, new): `buildsOnOvercap(ctx, a, dropped)`: with `state.builds` and `state.score`,
  adds `dropped` to the acting player's `overcap` (`ctx.playerIndex`), then while it holds 1 or more takes 1 and pays
  `scoreOvercap`; one `overcap*` event per paying hit (the boss's position, the hitter, this hit's points).
  `combat/actors/actors.ts` `damageActor`: two lines around `applyDamageCap` (`const uncapped = dmg;` before it; after
  it `if (dmg < uncapped && ctx.state.builds !== undefined) buildsOnOvercap(ctx, a, uncapped - dmg)`).
- **Gating fix** (`score.ts` `scoreTreasure`): it also returns 0 without `state.treasure`, because a builds run now pads
  TREASURE (0) on its way to OVERCAP; its only caller (sim/treasure) always has the state, so no run changes. The other
  gated awards already check their state (pellets, Goldling) or are build-only (Jackpot); `awardX`'s Horde reads
  pacts' percent (100 without pacts).
- **Views**: `shared/view/hud` `SCORE_SOURCE_KEYS` adds `score.source.overcap` ("Overcap", placeholder manifest,
  `l10n/context.json`); the run-over breakdown shows the row only when it scored (`scoreBreakdownRows`).
- **Edge case found:** "Overcap on the boss's killing hit: the dropped part still pays" cannot happen with today's
  bosses: their `filterDamage` (the phase floor, 0 in the final phase) cuts a killing hit to the hp left BEFORE the
  cap, so the cap only drops part of a hit that leaves the boss alive. Kept as the plan says (after `filterDamage`);
  the spec documents it.
- **Specs** (`builds/overcap.spec.ts`, new): sources (16 in a builds run, the names hashed; 15 for the endless config
  without builds; 9 bare; a bare builds run 16); a capped boss hit at 10/s for 10 s lands 60 and books exactly 40
  payouts of `awardPoints(OVERCAP_POINTS, floor scale)` at x2.3, combo / timer / `comboFed` untouched; a fractional
  drop waits in `overcap`, one event per hit; a phase-invulnerable boss (TRANSITION) pays nothing; the killing-hit
  case above; co-op credits the hitter; without builds nothing is counted and two runs hash the same. Updated for the
  new padding: `builds.spec` (the score group's padding, 16 sources), `evolutions.spec` (Jackpot's run), `golden/
  payouts.spec`, `pacts/pacts.spec`, `pellets/pellets.spec`, `score/score.spec` (the subset table, the treasure
  gate), `treasure/treasure.spec`, `view/hud/hud.spec` (16 keys, the Overcap row).

## BV10 (as built)

Theme, l10n and audio registration (presentation only: no sim, hash, replay or fixture change; nothing draws or plays
any of it yet, BV11), plus one integration spec. Paths under `src/shared/` unless noted.

- **Colour roles** `build.counter` `#00ff8c` (Riposte's wave: a spring green) and `build.overcap` `#fff0b0` (the
  overcap pops: a pale gold), in `theme/types.ts` `COLOR_ROLES` after `build.overkill` (so required) and appended to
  `theme/builds.ts` `BUILD_EFFECT_ROLES`, so `buildReport` holds both to BUD12's bars (and `pelletReport` keeps the
  pellets away from them). New in `theme/buildColors.ts`: `BUILD_APART_RULES` (`build.overcap` >= 40 CIE76 from
  `newBest`, the decor fx bar), reported as `buildReport` entries with check `"apart"` after the floor / difference
  ones; `variantColors.ts`' `WHY.build.apart` words the failure ("the overcap points' gold must never read as the
  new-best gold (a pop is not a record)"). Placeholder pack only; vale clones the placeholder's colours, so the same
  hexes there. Measured by `buildReport` (printed by `theme/builds.spec.ts`; identical in placeholder, vale and vale's
  textured floor but for the floor contrast):

  | Against | `build.counter` | `build.overcap` |
  |---|---|---|
  | `boost.frenzy` | **42.9** (nearest) | 60.2 |
  | `boost.quickstep` | 49.5 | 56.7 |
  | `boost.fury` | 87.7 | **42.5** (nearest) |
  | `telegraph` | 116.8 | 56.4 |
  | `boost.aegis` | 132.3 | 82.8 |
  | `enemyOutline` | 150.2 | 87.0 |
  | `enemyBullet` | 163.7 | 99.2 |
  | `enemyBulletOutline` | 126.8 | 98.3 |
  | `enemyGoo` | 198.2 | 139.0 |
  | `newBest` (apart, overcap only) | | 54.9 |
  | lowest biome floor contrast | 10.93:1 (biome.3) | 12.79:1 (biome.3) |
  | vale's textured floor | 13.37:1 | 15.64:1 |

  How they were picked (a grid search over sRGB with the bars above, the pellet yellow's 40 and >= 3:1 on every floor):
  - **The overcap gold has to be pale.** Every saturated gold sits within 40 CIE76 of `boost.fury` (`#ffc83d`; the
    new-best gold itself is 17.7 from it); the golds that pass are either dark bronzes (about 3:1 on the floors, too
    dim for a small number) or pale golds with chroma <= ~37. `#fff0b0` keeps 42.5 from Fury and 54.9 from `newBest`.
    Not checked but measured: it is the family of the pale golds already in use, 3.5 from `nearMiss.parry`, 3.6 from
    `boon.evolved` (a card frame), 6.1 from `build.ember`, 10.5 from `build.overkill`; 28.5 above the kill pops'
    `uiAccent` (`#c9a45c`), 37.6 from the Jackpot pops' `boon.legendary`, 34.0 from `golden.coin`. BV11 should tell the
    pops apart by their small size and rise (as LG5 said of the streak vs the burst). A changed `newBest` now also has to
    keep the 40 (`newBest.spec`'s `#ffd75e` case shows the second error).
  - **The counter wave is the one hue left at full brightness.** Every light colour that clears the danger, boost and
    pellet bars sits within ~30 of an existing player colour (the pale golds, the sky / ice blues, the violet-white);
    the spring greens are the exception: `#00ff8c` is >= 63 from every build role, `nearMiss.*`, `playerOutline` and
    `boon.duo`. Not checked but measured: 29.7 from `affix.swift` (`#3ce0a0`, the Swift elite's floor ring): the wave is
    a crescent leaving the player, the affix a ring under an enemy. Mint whites (`#a0ffc0`) fail Quickstep (24.7).
- **Strings** (placeholder pack; `theme/builds.ts` `BUILD_STRING_KEYS` appended, written out in `contract.ts`
  `REQUIRED_STRING_KEYS` right after `fx.brace.text`): `hud.draft.duoHint` (BV8's, now required), `fx.counter.text`
  "COUNTER x{n}" (`{n}` the bullets the guard erased), `fx.pinned.text` "PINNED", `fx.slam.text` "SLAM" (floor texts,
  capitals in the strings, never upper-cased in code), `hud.toast.happyHour` "Happy Hour: double kill points".
  `score.source.overcap` (BV9's) stays a score-source string like `score.source.jackpot` / `.treasure` / `.pellets`:
  checked by shared/view/hud `SCORE_SOURCE_KEYS` (`hud.spec`), not in `REQUIRED_STRING_KEYS` (the treasure / pellet
  precedent). New `l10n/context.json` entries for the four new keys (`fx.counter.text` max 13 with an example, like
  `fx.parry.count`; the floor words max 10; the toast max 40); BV8 / BV9 already added `hud.draft.duoHint` and
  `score.source.overcap`. The generated locale tables are untouched (English fallback, LD7).
- **Audio** (port audio IDs, `theme/builds.ts` `BUILD_AUDIO_IDS`' last five, `contract.ts` `PORT_AUDIO_EVENTS` right
  after `sfx.build.brace`, so the build block stays one run): `sfx.build.counter`, `.pin`, `.slam`, `.smash`, `.beam`,
  SILENT in the placeholder; vale has no layout entry for them, so it keeps the placeholder's SILENT (its manifest
  switches a sound on only once every file has an ID). `view/audio/cues.ts`: `SFX.buildCounter` .. `SFX.buildBeam` in
  `ALL_SFX` and `PORT_SFX`; registered only (no cue mapping, not in `BUILD_VOICE_SFX`: BV11 decides). Tables:

  | ID | `SFX_FALLBACK` (one step) | Why | Rank | Interval |
  |---|---|---|---|---|
  | `sfx.build.counter` | `sfx.player.parry` | the counter answers the guard's parry | 58 (over the parry 57, under the brace 60) | 0.15 s |
  | `sfx.build.pin` | `sfx.player.charged` | the heavy arrow's own sound (the bow's full-charge ping) | 53 (with the Overkill streak, under the swing 54) | 0.1 s |
  | `sfx.build.slam` | `sfx.enemy.stun` | a Charger hitting a wall: a body slammed into a wall | 59 | 0.15 s |
  | `sfx.build.smash` | `sfx.breakable.break` | the piece breaking | 49 (over the burst 48, under the spark 51) | 0.06 s (a chain climbs like the sparks) |
  | `sfx.build.beam` | `sfx.build.spark` | a line of light, like the spark's zap | 53 | 0.1 s |

  In the placeholder every target is silent too (no sound); vale has clips for the parry, the charge, the stun and the
  break, not yet for the spark (BU12), so a beam is silent there until its own clip or the spark's.
- **Luau locals.** No top-level constant added to `contract.ts` (list entries only): `contract.luau` / `validate.luau`
  at 186 / 197 of Luau's 200 top-level locals (counted on out/ after the build: `local function` = 1, `local a, b =
  ...` = one per name), unchanged.
- **Integration spec** `sim/builds/wave1.spec.ts` (new). Scenario 1: three players on siege.spec's walled-floor
  construction (three pillars, 28 barrels / crates in four rows, 20 bruisers / snipers / swarmers / chasers and six
  stationary 10-hp bodies on the archer's lanes), every wave 1 boon at III and every wave 1 duo granted through
  `grantCard`: player 0 (sword) Riposte III + Chain Spark + Composure + Bastion with Thunder Guard / Stillwater / Rebuke,
  guarding into a 10-bullet volley every 70 ticks (armor emptied every other one) and swinging; player 1 (bow) Ballista
  III + Ember Wake + Hearty + Sharpened + Bastion + Riposte with Dragon Bolt / Full Heart / Rebuke, 30-tick charged shots
  on six lanes 14.5 tiles from the east wall, every fourth cycle a roll through a 12-bullet volley with armor 0; player 2
  (sword) Wrecker III + Volatile + Soul Shards + Deep Flask + Bounty with Powder Keg / Happy Hour, walking and rolling
  through the crate rows, swinging, two drinks. 720 ticks, players kept unhurt by i-frames. Two runs hash the same every
  tick; every tick each player's live effect bullets stay <= `effectBulletsMax`, the live player bullets <= the pool,
  carrying pins <= `SIEGE_PINS_MAX` and waves <= `RIPOSTE_WAVES_MAX`; nothing throws. Measured: 9 Counterstrike rings,
  1 Rebuke ring, 14 Thunder Guard sparks, 11 Ballista back fans, 7 pins, 5 slams, 18 smashes and 18 Demolition blasts
  (all 28 pieces broken), 11 Full Heart beams, both Happy Hour drinks, 22 kills, at most 68 effect bullets per player,
  0 dropped. Scenario 2: two players and a capped boss (Mother Mayhem in her final phase, 100,000 hp) in an open arena,
  a Counterstrike guard into a volley every 70 ticks and Siege Bolt heavy arrows aimed at the boss, 480 ticks: two runs
  hash the same every tick, 97 overcap payouts, 7 rings, no pin (a boss never pins; no wall, so no burst). No bug found
  in the merged rules. Both scenarios run in about 9 s headless.
- **Specs updated.** `theme/builds.spec.ts` (the fifteen string keys, sixteen sounds, `BUILD_APART_RULES`, the apart
  count per pack, an overcap gold equal to `newBest` failing Fury's difference and the apart check), `theme/contract.spec.ts`
  (required assets + 5, strings + 5), `theme/audio.spec.ts` (the port list), `theme/newBest.spec.ts` (the plan's
  `#ffd75e` case now also trips the overcap apart check), `view/audio/buildCues.spec.ts` (the sixteen IDs; the five new
  ranked, timed, never a jingle / duck, not under the voice cap, their fallbacks and ranks),
  `view/hud/dailyRankStrings.spec.ts` (the rank layer's two now follow `sfx.build.beam`).
- **Verify.** typecheck, lint, build, `check:assets`, `check:autolocalize`, `test:l10n` (36 pass) and `l10n:check` (0
  errors, 0 warnings) green. Headless (Lune): every spec under `shared/theme` (644), `view/hud` (524), `view/audio`
  (195), `view/fx` (410), `shared/l10n`, `shared/tutorial`, `play/bindings`, and `sim/builds/` (the new spec among
  them) pass. Not run here: the full `npm run verify` (the integrator's).

## Appendix: the proposal (2026-11-05)

Kept as written (Overkill withdrawn to docs/LEGENDARIES.md 2026-11-06, Matador dropped and the owner calls settled
2026-11-07), for wave 2. Where this plan differs (Rebuke, BVD1-BVD20), the plan above wins.

### Why: the gaps v1 leaves

Read from the code and docs on `main` today:

1. **The guard has no build.** Parries already feel great (GRAZE_PARRY: gold burst, PARRY!, 30 ms freeze), but the only
   thing that scales off them is the Mirror Cloak relic. The sword's best skill move has no boon behind it.
2. **The bow's charged shot has no build.** Every bow duo reads stream / heavy / Flurry arrows the same way, so holding
   ALT is never a build decision.
3. **The safe picks never get a payoff.** Hearty and Deep Flask have no duo, and Composure is only in Unshaken
   (BUILDS.md: "they are the safe picks"). Picking safety should still lead somewhere exciting.
4. **Systems players already enjoy have no build.** Breakables (DECOR D4), pellets and the power pellet, and the Goldling
   all give dopamine on their own, but nothing in the draft makes them bigger.
5. **Bosses ignore builds.** `damageCapPerSecond` 6 means no build shortens a boss (BU13 recommendation 6), so a
   strong build feels the same as no build in the biggest fight of a floor.
6. **Duos are hard to find** (BU13 recommendation 1). The best moment of v1 is also its rarest.

### New boons (indices 17-22)

**Overkill moved (2026-11-06):** the owner made Overkill a legendary in docs/LEGENDARIES.md (indices 15 / 16 go to
Overkill and Bastion), so its row below is withdrawn and the rest renumber after them.

Each common / rare boon has levels I / II and an evolution at III, like v1. Numbers are starting points for a BU13-style
tuning pass.

| Boon | Lvl I | Lvl II | Evolution (III): the new visible rule | The dopamine beat |
|---|---|---|---|---|
| **Riposte** (rare, offense) | a guard that erases at least 1 bullet fires a counter-wave forward when it ends: 1 damage per bullet erased (max 6), pierces all | max 10 | **Counterstrike**: erasing 5+ bullets in one guard turns the wave into a full ring, and each erased bullet also flies back at the nearest enemy (gen 0) | The PARRY! tick climbs in pitch per bullet eaten, then `COUNTER x7` pops as the wave goes out. Sniper volleys turn into ammo |
| **Ballista** (rare, offense) | a heavy arrow bursts into 6 bolts when it spends its last pierce or hits a wall | 10 bolts, charge time -25 % | **Siege Bolt**: the first non-boss the heavy arrow hits is **pinned** and carried until the arrow hits a wall; a wall slam deals 3x heavy damage plus a shockwave ring | Charging becomes the anticipation. Dragging a bruiser through a swarm into a wall is a moment players will clip |
| **Hemorrhage** (common, offense) | each player hit adds a blood mark to the enemy (pips over its head); 5 marks **rupture** for 4 damage and a red ring | ruptures at 4 marks | **Crimson Bloom**: a rupture spreads 2 marks to every enemy within 3 tiles (rupture kills proc like any kill) | Pips fill up visibly. In a dense room the marks spread, then the whole room ruptures in one rolling wave |
| ~~**Overkill**~~ | withdrawn: now a legendary, docs/LEGENDARIES.md | | | |
| **Wrecker** (common, offense) | rolling through a breakable smashes it; smashed pieces fire 3 splinters at the nearest enemies (gen 0) and refill the combo timer | 5 splinters | **Demolition**: smashed breakables explode (1.5 tiles) and set off neighbouring breakables, chaining across the room; each piece +1 combo step | The room becomes ammo. Bookshelf rows and pillars go off like fireworks |
| **Berserk** (rare, offense) | at 1 heart: +40 % damage and attacks recover 20 % faster; the knight glows red | +60 % / 30 % | **Undying Rage**: at 1 heart, every 10 kills heal half a heart (still only up to 1.5 hearts, so the build stays on the edge) | Staying alive at 1 heart is the strongest feeling in the genre. A `CLUTCH` shout plays when a room clears at 1 heart |
| **Glutton** (common, score) | pellet pickup radius x2; each pellet fires a tiny shard at the nearest enemy (1 damage, gen 0) | x3 radius, 2 shards | **Devour**: a Sweep (every pellet before the last enemy dies) grants 3 s of power pellet: enemy bullets you touch turn into points instead of hurting you | A chomp chain climbing in pitch, and a Sweep becomes something to chase every room, not only for score |

Recommended order (owner call): **wave 1** = Riposte, Ballista, Wrecker (they fill gaps 1, 2 and 4, and each reuses
an existing sim hook: guard cancels, the heavy arrow, breakable hits). **Wave 2** = Hemorrhage, Berserk,
Glutton.

### New duos

Gap 3 first: every v1 boon now has at least one duo.

| Duo | Boons | Rule | Beat |
|---|---|---|---|
| **Full Heart** | Hearty + Sharpened | at full hearts, every finisher and every heavy arrow also fires a piercing light beam (4 tiles, finisher damage) | The classic full-health sword beam. Not getting hit pays off in every swing |
| **Adrenaline** | Deep Flask + Berserk | drinking at 1 heart grants Fury (the boost, +50 % damage) for 6 s, and the flask still heals | A near-death drink becomes a power spike instead of a retreat |
| **Happy Hour** | Deep Flask + Bounty | drinking doubles kill points for 5 s (its own pop colour) | Saving a flask for a big pack becomes a score play |
| **Stillwater** | Composure + Riposte | a parry gives back the combo the last hit cut, if within 3 s | You take it back. The greyed-out lost multiplier (COMBO break) lights up again |
| **Thunder Guard** | Riposte + Chain Spark | every bullet the guard erases sparks to the nearest enemy (1 damage, gen 1) | One guard against a sprayer turret lights up the room |
| **Dragon Bolt** | Ballista + Ember Wake | a heavy arrow leaves an ember along its whole path (the Fire Arrows ember, `FIRE_ARROWS_EMBERS_MAX` does not apply) | A line of fire across the room in one shot |
| **Blood Shards** | Hemorrhage + Soul Shards | each shard hit adds 2 marks instead of 1 | Shards seed the room, ruptures finish it |
| ~~**Supernova**~~ | Overkill + Volatile | moved to docs/LEGENDARIES.md (redefined: a 3+ carry bursts one ring larger) | |
| **Powder Keg** | Wrecker + Volatile | a smashed breakable procs like a kill (gen 0: bursts, sparks and shards all fire) | Every crate is a kill |

**Matador dropped (owner, 2026-11-07).** Riposte + Slippery (a bullet rolled through counts as a guard erase) is
withdrawn: Bastion's roll brace (docs/LEGENDARIES.md LGD7) already counts bullets rolled through as blocked.

### Builds: how they come together

Each build is named as the player would describe it, with the cards that make it and the moment it "comes online".

1. **The Duelist** (sword): Riposte -> Counterstrike, Chain Spark (Thunder Guard), Composure (Stillwater). *Online:* a
   sniper fan arrives, guard, 7 bullets eaten, `COUNTER x7`, ring wave plus 7 sparks, the pack is gone.
2. **The Siege Engine** (bow): Ballista -> Siege Bolt, Ember Wake (Dragon Bolt), Piercing Arrows. *Online:* charge, pin a
   bruiser, drag it through 4 swarmers, wall slam, shockwave, a line of fire left behind.
3. **The Blood Gardener**: Hemorrhage -> Crimson Bloom, Soul Shards (Blood Shards), Swift Strikes. *Online:* the whole room
   wears pips, one more hit, rupture spreads, the room pops in a rolling red wave.
4. **The Wrecking Crew**: Wrecker -> Demolition, Volatile (Powder Keg), Slippery (Blazing Trail). *Online:* one roll
   through a bookshelf row and the room detonates.
5. **The Last Stand**: Berserk -> Undying Rage, Deep Flask (Adrenaline), plus the Second Wind relic. *Online:* at 1
   heart, red glow, Fury on the drink, `CLUTCH` on the clear.
6. **The Executioner**: Overkill (legendary, docs/LEGENDARIES.md), Sharpened -> Executioner, Volatile (Supernova). *Online:* one finisher
   on a bruiser, a red streak hops through every low enemy, each corpse bursts.
7. **The Paladin**: Hearty -> Lionheart, Sharpened (Full Heart), Warding -> Bulwark. *Online:* full hearts, every
   swing fires a beam, a PERFECT clear heals. It rewards clean play instead of chaos.
8. **The Glutton**: Glutton -> Devour, Bounty -> Jackpot (Happy Hour), Lingering (Gold Rush). *Online:* a Sweep, bullets
   turn to points, Jackpot pops, the score panel's number jumps.

### Dopamine rules for every new boon

Reused from systems already in the game, so no new presentation machinery is needed:

- **Anticipation you can see:** pips (Hemorrhage marks), a charge glow (Ballista), a counter that grows during the
  guard (Riposte). The payoff should be visible on its way.
- **Pitch climbs:** the combo kill sound and the graze shimmer already climb. Riposte's erase tick, Glutton's chomp and
  Demolition's chain pops do the same, with a voice cap and generation pitch (BUILDS.md risks: audio spam).
- **Named breakpoints:** `COUNTER x7`, `PINNED`, `CLUTCH` use the combo shout's construction, which must never hide a
  bullet (CD9).
- **Freeze on the big hit:** solo only, through the existing Freeze frame setting: Counterstrike's ring, the Siege Bolt
  wall slam (40 ms, as the Goldling catch).
- **Recap brag lines** (RUN_RECAP highlights, presentation only from an unhashed feed): `Biggest cascade 23 kills`,
  `Best counter x9`, `Longest pin 6 tiles`, `Rooms cleared at 1 heart: 4`.

### Two fixes that make every build feel better

1. **Duo hint on cards** (presentation only). A New card whose boon completes a duo with something you own shows a small
   joined-icon badge with the duo's silhouette and `Completes a duo`. This makes the duo visible as a goal two picks
   early. Pair it with BU13 recommendation 1(b) (the boss double draft falls back to a partner card), a sim change.
2. **Overcap pays points** (boss gap 5, sim and score change, owner call). Damage the boss cap throws away pops as small
   gold points (`+12`) at the boss, in its own score source. A strong build still can't shorten the fight, but the
   player sees their build working on the boss.

### Fit with the sim (what each one needs)

| Item | Sim hook it reuses | New state (hashed, `builds` group) | Risk |
|---|---|---|---|
| Riposte, Thunder Guard | `scoreGuardCancels` / the guard sweep's erase count | per-player erase count for the current guard | low |
| Ballista, Dragon Bolt | the heavy arrow's last pierce and wall hit | none | low |
| Siege Bolt | the heavy arrow | pinned actor id per arrow | **medium**: moving actors through walls and pillars needs `collision.ts`; bosses and Goldlings never pin |
| Hemorrhage, Blood Shards | `damageActor` | marks per actor slot (cleared on death and floor change) | medium: per-actor state and its clone / hash |
| ~~Overkill, Supernova~~ | moved to docs/LEGENDARIES.md | | |
| Wrecker, Powder Keg, Demolition | breakable hits (DECOR D4) | none (the chain runs through the proc queue) | medium: breakable counts per room, frame time on dense decor floors |
| Berserk, Adrenaline | hearts, flask drink, the Fury boost | none | low; co-op per player |
| Glutton, Devour | pellet pickup, the power pellet rule | power timer per player | low |
| Duo hint | `cardKind`, duo table | none (presentation) | none |
| Overcap points | `damageCapPerSecond` | none (a score source) | endless replays change |

Every row changes endless replays and scores from the first draft on, as v1 did (M1, fixtures and the tutorial do not
move). Recommend landing wave 1 **after BU14**, so the frame-time and readability numbers for v1 are known before more
bullets go on screen.

### Owner calls (settled 2026-11-07)

1. **Wave 1:** Riposte, Ballista and Wrecker, as proposed. Wave 2 stays Hemorrhage, Berserk and Glutton.
2. **Siege Bolt:** true pin and drag. The first non-boss enemy the heavy arrow hits is carried with it until the arrow
   hits a wall (bosses and the Goldling never pin). This needs the collision work in the risk table (medium).
3. **Berserk:** on at or below 25 % of max hearts, so it scales with Hearty and Stone Heart.
4. **Duo hint:** the badge only (presentation). No partner bias in the odds.
5. **Overcap points:** yes. Damage the boss cap throws away pops as small gold points at the boss, in its own score
   source (a score change: endless scores and replays change).
6. **Bastion + Riposte duo:** yes, designed as part of the wave 1 plan (Riposte lands in wave 1; the duo's rule is open,
   for example a brace also fires Riposte's counter-wave as a full ring).
