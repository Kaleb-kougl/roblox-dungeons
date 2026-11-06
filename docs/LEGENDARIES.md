# Legendaries: plan

The draft has two legendary boons, Ember Wake (offense) and Composure (score). They stay at level I and are the anchors
duos are built on (docs/BUILDS.md BUD1), but two anchors are not enough: defense has none, a player who owns both never
sees a legendary card again (the rarity roll falls through to every rarity), and only three duos sit on a legendary.
This plan adds two:

1. **Overkill** (offense). The damage left over from a kill jumps to the next enemy as a streak, and keeps going while
   it keeps killing. Big hits stop being wasted.
2. **Bastion** (defense). The sword's guard becomes a full ring that lasts longer, and a guard that eats a volley gives
   an armor pip back. The guard finally has a defensive build.

Four duos come with them, so each new legendary anchors two: **Supernova**, **Skewer**, **Citadel**, **Stone Heart**
(Stone Heart is Hearty's first duo).
Bastion's brace also works for a bow player: rolling through 3 bullets counts like guarding them (LGD7).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**, on the established builds patterns: boons appended to `BOONS` (hashed, append only), duos appended
to `DUOS`, everything opt-in through `SimConfig.builds` (endless worlds only, BUD8), new hashed fields appended to the
`builds` group, effects through the proc engine (`gen`, `GEN_MAX` 3, `procsPerTick`), unhashed `BuildEvents` for the
view, the `buildFx` Reduced setting respected. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial
(`CLASSIC_BOON_COUNT` 12, no builds) replay exactly as before. Same rule of thumb as BUILDS.md: **if a player cannot
see it happen, it is not in this plan.**

## Status (2026-11-06)

**LG0-LG6 built** (the audit, the data and scaffolding, Overkill's and Bastion's rules, the four duos, the theme, the
view: "LG0 findings", "LG1 (as built)" .. "LG6 (as built)"); LG7-LG9 open (LG6's Studio check is in LG9's checklist). Follows docs/BUILDS.md (BU0-BU10 built; BU11-BU14 open). Overkill was proposed in docs/BUILDS_V2.md as
a common boon with levels and an evolution (Annihilator); the owner moved it here as a legendary
(2026-11-06), so V2's Overkill row is withdrawn and its Supernova duo is redefined below. Decisions LGD1-LGD12 are
proposed defaults until the owner settles them; LGD2, LGD3, LGD5-LGD7 and LGD12 are settled (owner, 2026-11-06).

## What the code gives us (read on `main` @ `749f788`)

| Fact | Where | Consequence |
|---|---|---|
| `damageActor` clamps the hit to the hp left (`if (dmg > a.hp) dmg = a.hp; // overkill does not count`) after `filterDamage`, the Shielded absorb, the boss cap and Executioner | `combat/actors/actors.ts` 198-227 | The excess is known on the kill line, one line before it is thrown away. A transient `ctx` field carries it to `buildsOnKill`, like `ctx.procGen` |
| A kill queues one `BuildProc` `{ x, z, owner, gen, slot, id }`; `stepBuilds` resolves each proc's on-kill effects in boon index order | `builds/builds.ts`, `builds/procs.ts`, `builds/onKill.ts` | Overkill is one more on-kill effect; its carry needs one appended proc field, `excess` |
| Chain Spark is instant damage: `nearestEnemy` (never the victim, never an enemy already hit, never one spawned this tick), `ctx.damageActor` under `ctx.procGen = gen + 1`, one `BuildEvents` segment per hop | `builds/onKill.ts` `chainSpark` | Overkill's streak is the same shape: one segment, one strike, the kill procs one generation on |
| Executioner returns `a.hp` for an execute, so an executed hit has no excess | `builds/execute.ts` | Overkill needs its own rule for executes (LGD3) |
| Player damage: sword 3, finisher 6, bow stream 1, heavy arrow 4; swarmers 1 hp (`SWARMER_HP`), hp grows with depth | `weapons/defs/sword.ts`, `bow.ts`, archetypes | Without help, bow stream arrows never overkill: they deal exactly a swarmer's hp (LGD2) |
| The guard: 18 ticks, `guardReach` 1.9, `guardHalfAngleCos` -0.2 (~203 degrees), cooldown 60 ticks, read straight from `SWORD_DATA`; `cancels` counted per tick from `bulletsDeleted` (goo erased outside it) | `weapons/defs/sword.ts` 229-275 | Bastion reads its guard numbers through `runMods`; the per-guard erase count is a new hashed builds counter |
| A bullet overlapping a rolling player with i-frames passes through (`hurtPlayer` returns false) and may overlap for
several ticks; Phantom Step (`phantomStepOn`: Slippery III, `rollTicks > 0` and `iframeTicks > 0`) erases it instead | `combat/combat.ts` 340-413, `builds/evolutions.ts` 359-375 | A roll brace needs to count each bullet once: enemy bullets never use the payload's `lastHit` field (player bullets only; Mirror Cloak packs a fresh payload), so it can mark "already counted" with no layout change |
| Armor: `armor` / `armorMax` per player, one pip absorbs a whole hit; Warding refills to `armorMax` when a room's enemies spawn (`armorOnRoomSpawn`); `buildsOnArmorBreak` hook exists | `player.ts`, `progression/progression.ts` 503-511, `builds/hooks.ts` | Bastion's pip and its once-per-room recharge hang off the same moment |
| Legendaries: `boonMaxLevel` is 1 for every legendary, upgrade pools take common / rare only, Greed's `drawLegendaryOffers` draws unowned legendaries first | `progressionData.ts`, `builds/cards.ts` | Two new legendaries need no card-kind change; Greed's deal gets twice the pool |
| `DAILY.ruleset` is 8 | `shared/daily/config.ts` | Bumps to 9 (LGD11) |

## LG0 findings (2026-11-06)

Read on `legendaries` @ `aa2cb55` (= `main` @ `749f788` + this plan). Paths under `src/shared/sim/` unless noted. Every
row of the table above holds; the points below add to it or say where the next tasks must take care.

- **Indices.** Boon 15 / 16, Duo 9-12 and `KillCause` 3 were free; no BUILDS_V2 boon or duo has landed (no code names
  one). The proc's `BuildProc` fields, the per-player scalars and the payload layout had no other pending append.
- **`damageActor`** (`combat/actors/actors.ts` 198-227): the order is `filterDamage`, the Shielded absorb, the boss cap,
  `buildsExecute`, then the clamp at line 211. `buildsExecute` replaces `dmg` by `a.hp` before the clamp, so "an
  execute carries the full hit" (LGD3) needs the hit as it was BEFORE `buildsExecute` (after the cap), not the value
  at the clamp: LG2 should keep that value and tell an execute by `buildsExecute` having changed it. The tutorial's
  held damage comes after the clamp (no builds there, so it never meets a carry).
- **Procs** (`builds/procs.ts`): `hasOnKillEffect` gates the queue on `ON_KILL_BOONS`, and `resolveProc` sends every
  boon in that list that is not Chain Spark or Volatile to `soulShards` (an `else`). LG2 must add `Boon.OVERKILL` to
  `ON_KILL_BOONS` AND give it its own branch; until then an Overkill-only player queues no proc at all. A kill of
  generation `genMax` queues nothing, so the streak chain gives exactly 3 carries, as the plan says. The proc literal
  in `buildsOnKill` and the scratch proc in `builds/duos.ts` (`pseudo`, Storm Blade / Chain Reaction) both carry the
  new `excess` field (0).
- **Chain Spark** (`builds/onKill.ts` `chainSpark`) matches the plan's shape; `nearestEnemy` (`builds/effects.ts`) skips
  the victim by id, dead slots, actors spawned this tick and an exclude list. Sparks apply `playerHitDamage`; the
  streak must not (LGD4).
- **Weapons**: sword 3 / finisher 6, bow 1 / heavy 4, `SWARMER_HP` 1, as listed.
- **The guard** (`combat/weapons/defs/sword.ts` 78-82 data, 229-275 rule) as listed, plus three things LG3 / LG6 need:
  `swordGuard()` (the render progress) divides by `SWORD_DATA.guardTicks`, so with 27 ticks it would read 1.5 at a
  guard's start; a roll (`rollTicks > 0`) and a swap zero the guard; and `melee.ts` `inCone` tests
  `dot >= halfCos x dist`, so at exactly -1 a bullet straight behind the knight can miss by one rounding step when the
  facing is not exactly unit (the novas pass `NOVA_HALF_ANGLE_COS` = -2 for this reason). LG1 keeps the plan's
  `BASTION_GUARD_HALF_ANGLE_COS` = -1 (the number a view draws); LG3 should pass a value below -1 to `sweepArc` for
  the full ring.
- **Enemy bullet `lastHit`** is unused, as the plan says: enemy patterns pack it 0, the only enemy payload writes are a
  strike's `pierce` hold (`combat/combat.ts` `strikeHoldSpent`) and the graze bits `GRAZE_NEAR_BIT` / `GRAZE_DONE_BIT`
  ABOVE the 28 layout bits (`score/score.ts` 988-1028). `BulletPayload.with` keeps bits above the layout (it masks with
  0x7fffffff), so LG3's mark keeps a bullet's graze state. Payloads are hashed with the pool (`combat/bullets.ts`).
- **Armor / Warding** (`progression/progression.ts`): the refill is step 3 of `stepProgression` (503-512), only for
  living players, only for a room with spawns, and only when someone is alive; step 1 (a floor change) returns early,
  so the floor-start re-arm of `braceReady` belongs in step 1's branch, not beside the refill. Warding's pip is added by
  `cards.ts` `applyLevelGained` in builds runs and by `grantBoon`'s own branch without builds.
- **Cards** (`builds/cards.ts`): `drawCardOffers`, `legendaryPool` and `drawLegendaryOffers` loop `BOON_COUNT`, so both
  new legendaries are dealt with no code change; `boonMaxLevel` 1 keeps them out of the upgrade pool and the Greed
  fills. `cardKind` would call an owned legendary's card UPGRADE (level 1), but no draw deals one. Without builds
  nothing reaches them: `drawBoonOffers` and Greed's classic pool (`pacts/stepPacts.ts` `classicLegendaryPool`) loop
  `CLASSIC_BOON_COUNT`.
- **Nothing outside specs hardcodes 15 boons or 9 duos.** Specs did: `builds.spec.ts` (counts, the builds hash group's
  size, "Hearty in no duo"), `progression.spec.ts` (`BOON_COUNT` 15), `procs.spec.ts` (the proc literal),
  `duos.spec.ts` (every duo granted), `pacts/greed.spec.ts` (two legendaries in the pool) and `daily.spec.ts`
  (`DAILY.ruleset` 8); LG1 updated each (see below). `play/snapshot.ts` copies the owned boons' levels and the duos
  only; no counter is in the snapshot (as for `closeGrazes` / `bulwarkPending`), so the new counters need no snapshot
  field until a view reads them (LG6).
- **`DAILY.ruleset`** was 8 (`shared/daily/config.ts`).

## LG1 (as built)

Data and hashed state only: no rule reads any of it yet, so a builds run plays as before, except that the draft can deal
the two new boons and four duos (endless drafts change). Paths under `src/shared/` unless noted.

- **Boons** (`sim/progression/progressionData.ts`): `Boon.OVERKILL` 15 (`boon.overkill`, legendary, offense) and
  `Boon.BASTION` 16 (`boon.bastion`, legendary, defense) appended to `Boon` / `BOONS`; `BOON_COUNT` 17,
  `CLASSIC_BOON_COUNT` stays 12. Granting either is level I through `grantCard` (its only level); Bastion adds no pip
  yet (LG3).
- **Duos** (`sim/builds/buildsData.ts`): `Duo.SUPERNOVA` 9 (`duo.supernova`, Overkill + Volatile), `Duo.SKEWER` 10
  (`duo.skewer`, Overkill + Piercing Arrows), `Duo.CITADEL` 11 (`duo.citadel`, Bastion + Warding),
  `Duo.STONE_HEART` 12 (`duo.stoneHeart`, Bastion + Hearty); `DUO_COUNT` 13. Card ids 73-76.
- **Tunables.** Overkill and the duos in `sim/builds/effectsData.ts`: `OVERKILL_RANGE` (4 x `TILE_SIZE`),
  `OVERKILL_MIN_CARRY` 1, `OVERKILL_ONE_SHOT_MIN` 1, `SUPERNOVA_CARRY` 3, `SKEWER_RADIUS` (0.5 x `TILE_SIZE`), and
  `KillCause.OVERKILL` 3. Bastion beside Warding's numbers in `progressionData.ts` (a boon's one-off pip and the mods
  `runMods` reads live there): `BASTION_ARMOR_PIPS` 1, `BASTION_GUARD_HALF_ANGLE_COS` -1, `BASTION_GUARD_TICKS` 27,
  `BASTION_BRACE_BULLETS` 3.
- **Hashed state** (`sim/builds/builds.ts`, appended, 0 everywhere for now): `BuildProc.excess` (last of
  `BUILD_PROC_FIELDS`, set 0 by `buildsOnKill` and in `duos.ts`' scratch proc); per player `braceCount` and
  `braceReady` (last of `BUILD_PLAYER_SCALARS`, created 0 by `newPlayer`). Clone copies them with the spread, the hash
  and the dump names come from the two lists; no snapshot field (LG0). Every builds run's `builds` group grows by 2
  levels and 2 scalars per player and 1 value per queued proc, so endless state hashes differ from tick 0; no spec pins
  an endless builds hash, and no pinned value changed.
- **Theme** (placeholder pack, `theme/packs/placeholder/manifest.ts`): `boon.overkill.*` ("Overkill", "Damage left over
  from a kill jumps to the next enemy", `OVK`), `boon.bastion.*` ("Bastion", "+1 armor pip; a full-ring guard;
  stopping 3 bullets restores a pip", `BST`), `duo.supernova.*` (`SNV`), `duo.skewer.*` (`SKW`), `duo.citadel.*`
  (`CTD`), `duo.stoneHeart.*` (`STH`), name / desc / icon each (18 strings; listed by `progressionStringKeys` through
  `BOONS` / `DUOS`, no `.desc.2` / `.evo.*`: legendaries have one level). Each has an `l10n/context.json` entry (the
  Chain Spark / Unshaken notes, with a line on pips, the guard, braces or overkill); `l10n:check` 0 errors. No colour
  role, audio ID, toast or floor text yet (LG5). No top-level constant in `contract.ts`, so the Luau locals are
  unchanged.
- **`DAILY.ruleset`** 8 -> 9 (`shared/daily/config.ts`, LGD11).
- **Specs.** `sim/builds/builds.spec.ts`: the two boons' rows and the four legendaries; the tutorial's draft
  (`drawBoonOffers`) never deals 12 or above over 2000 draws; thirteen duos and their pairs (Deep Flask is now the only
  boon in no duo); the hash group's size and the appended names; a new block "legendaries Overkill and Bastion": the
  appended fields, both dealt as New to a fresh build and never again once owned, granting (New, then refused, no pip,
  no evolution event), the four duos available exactly when both boons are owned (a boss deal's guaranteed duo, granted
  once), and Greed's pool with all four legendaries. Pinned counts updated in `progression.spec.ts`, `procs.spec.ts`,
  `duos.spec.ts`, `pacts/greed.spec.ts` (a fresh build's Greed deal is now 3 legendary cards, was 2) and
  `daily/daily.spec.ts`.
- **Verify.** typecheck, lint, check:assets, build, test:l10n, test:checks, check:autolocalize and `l10n:check` green.
  Headless (Lune): every spec under `sim/builds`, `sim/progression`, `sim/pacts`, `golden`, `fixture`, `tutorial`,
  `roomPool`, `run/`, `theme`, `view/hud`, `view/fx`, `shared/play` and `daily`, plus every fixture parity spec (golden
  runs `sim/run*`, `constants`, `hash`, the dungeon parity) and the four determinism specs: all pass (the tutorial lock,
  `roomPool.lock.spec` and the golden runs match exactly).

## LG2 (as built)

Overkill's rule. Paths under `src/shared/sim/` unless noted. Endless builds runs with Overkill change; every other run
(M1, the fixtures, the tutorial, builds runs without Overkill) plays as before.

- **The carry** (`builds/execute.ts` `buildsKillCarry`, called from `combat/actors/actors.ts` `damageActor`'s kill
  line with `state.builds` only). `damageActor` keeps `hit` (the damage after `filterDamage`, the Shielded absorb and
  the boss cap, before `buildsExecute`), `hpBefore` (the hp the hit met) and `executed` (`buildsExecute` changed the
  damage). Carry = `hit` for an execute (LGD3), else `hit - hpBefore`; a kill with `ctx.procGen === 0` of an enemy at
  full hp (`hpBefore === hpMax`) carries at least `OVERKILL_ONE_SHOT_MIN` (LGD2; streak and effect kills are gen >= 1,
  no floor); below `OVERKILL_MIN_CARRY` it is 0; a boss (`data.boss`) never carries. The carry rides in the transient
  `SimCtx.killCarry` (new, `combat/ctx.ts`: set just before `buildsOnKill`, 0 again right after and in `bind`; never
  hashed).
- **The proc** (`builds/procs.ts`): `Boon.OVERKILL` appended to `ON_KILL_BOONS` (so an Overkill-only player queues
  procs); `buildsOnKill` stores `excess = ctx.killCarry` only when the owner has Overkill (every other proc keeps 0, so
  builds runs without Overkill hash as after LG1); `resolveProc` has its own `Boon.OVERKILL` branch (after Soul Shards,
  boon index order). Turrets, the dummy, quiet deaths, withers and leavers never queue (existing rules).
- **The streak** (`builds/onKill.ts` `overkill(ctx, s, q)`, exported): a proc with `excess >= OVERKILL_MIN_CARRY`
  strikes `nearestEnemy(q.x, q.z, OVERKILL_RANGE^2, q.id, [])` (the spark's skips: dead, the victim, spawned this tick)
  for `excess` exactly (no `playerHitDamage`, LGD4) with `ctx.procGen = q.gen + 1`, `ctx.procCause =
  KillCause.OVERKILL`, both reset after. The Goldling and bosses can be struck (the cap applies). No target: nothing.
- **Chain Reaction** (`builds/duos.ts` `chainReactionKill`): it used to cross-trigger on any `procCause` but NONE; it
  now tests SPARK or BURST explicitly, so a streak's genMax kill never cross-triggers (no behaviour change before
  Overkill: those were the only two causes).
- **Feed** (`builds/builds.ts` `BuildEvents`, cleared every tick, not hashed; parallel lists, one entry per streak
  that struck, in resolution order): `overkillX1` / `overkillZ1` (the corpse), `overkillX2` / `overkillZ2` (the
  target's position when struck), `overkillOwner` (party index), `overkillGen` (the proc's generation: 0 for the
  player's own kill, +1 per link of a chain), `overkillCarry` (the damage the streak dealt).
- **Specs** (`builds/overkill.spec.ts`): a finisher (6) on a 1-hp swarmer carries 5 to the nearest; a stream one-shot
  carries 1; no floor for a wounded enemy or a gen-1 kill; an execute carries the full 8; a 0.5 carry does nothing; no
  `playerHitDamage` (Sharpened); only an Overkill owner's procs carry; range 4 reaches, 4.01 does not; a chain gives
  9 / 8 / 7 at gens 0 / 1 / 2 and stops at GEN_MAX; a turret kill never carries; a boss strike takes exactly its cap
  and a boss kill carries 0; a streak's genMax kill never cross-triggers Chain Reaction; without builds nothing
  changes; Overkill + Chain Spark + Volatile on an 8-swarmer pack (bow stream) streaks, clears the pack, and two runs
  hash the same every tick. No pinned value changed.

## LG3 (as built)

Bastion's rule. Paths under `src/shared/sim/` unless noted. Builds runs with Bastion change; without it the sword's
step, the roll and the bullet walk are exactly as before (the guard reads `SWORD_DATA`'s numbers, the roll mask is one
`false`).

- **Mods** (`progression/runMods.ts`): `RunMods.bastion` (owns Bastion; `NEUTRAL_RUN_MODS` false). New tunable
  `BASTION_GUARD_SWEEP_HALF_ANGLE_COS` -2 (`progression/progressionData.ts`, LG0 trap 4): what the sweep passes;
  `BASTION_GUARD_HALF_ANGLE_COS` -1 stays the number a view draws.
- **The guard** (`combat/weapons/defs/sword.ts`, exported through `combat/weapons/index.ts`): the guard's start sets
  `SWORD_V_GUARD` to `swordGuardTicks(state, i)` (27 with Bastion, else `SWORD_DATA.guardTicks`) and sweeps with
  `swordGuardSweepCos(state, i)` (-2 with Bastion, else `SWORD_DATA.guardHalfAngleCos`); reach and cooldown unchanged.
  After the tutorial hook, every guard tick calls `buildsOnGuardCancels(state, i, cancels, starting)` (builds runs;
  `starting` on the press tick). For the view (LG6): `swordGuardTicks(state, i)` (the guard's length),
  `swordGuardHalfAngleCos(state, i)` (-1 with Bastion: draw the full ring), `swordGuardRing(state, i)` (true with
  Bastion), and `swordGuard(slot, guardTicks = SWORD_DATA.guardTicks)`, which now takes the length and clamps to 1
  (LG0 trap 3). The client still calls `swordGuard(slot)` and draws `SWORD_DATA.guardHalfAngleCos`
  (`WeaponViewController`, `fxCues` `guardOf`, `watch.ts` `guardUp`): unchanged without Bastion; with it the default
  length reads 1 for the guard's first 9 ticks (a longer flash) until LG6 passes `swordGuardTicks`. No snapshot field:
  the weapon view reads the live state, like `swordGuard`.
- **The brace** (`builds/hooks.ts`, a leaf): `buildsOnGuardCancels` (resets `braceCount` on `starting`, adds the
  cancels), `bastionRollOn(state, i)` (Bastion, present, alive, `rollTicks > 0 && iframeTicks > 0`),
  `buildsOnRollThrough(state, i)` (+1), `buildsOnRollStart(state, i)` (`braceCount` 0), `buildsOnSwap(state, i)`
  (`braceCount` 0 unless mid-roll: a swap ends a guard), `buildsBraceRearm(state)` (`braceReady` 1 for every present
  Bastion owner). The brace fires on the bullet that takes `braceCount` from below `BASTION_BRACE_BULLETS` to it or
  above (so one per guard or roll), only while `braceReady` is 1, and clears it: a missing pip comes back
  (`armor + 1`, never past `armorMax`, `BraceKind.PIP`), else it is spent (`BraceKind.SPENT`, an addition to the
  plan's pip / heal so the view can show the once per room). Goo is erased outside `bulletsDeleted` and strikes are
  never erased, so neither is in `cancels`.
- **The roll brace** (`combat/combat.ts`): a per-tick mask `bastionRolling` / `bastionAny` (built beside Phantom
  Step's with `bastionRollOn`, only with builds). In `enemyBulletHit` and `enemyBulletHitParty`, a bullet (not goo, not
  a strike) inside a rolling Bastion owner's hit circle goes through `bastionRollThrough`: if its payload `lastHit` is
  0 it is set to 1 (`BulletPayload.with`, the graze bits above the layout kept) and counts once for that player; a
  marked bullet never counts again, for anyone (co-op: the first rolling owner it overlaps, index order). It runs
  before Phantom Step's erase, so erased bullets count.
- **Resets and re-arm.** `combat/weapons/weapons.ts` `stepWeapons`: the roll's start tick (`rollTicks ===
  ROLL_TICKS`, Ember Wake's moment) calls `buildsOnRollStart`, a swap calls `buildsOnSwap`.
  `progression/progression.ts` `stepRun`: step 1 (a floor change, LG0 trap 5) and step 3 (a room's enemies spawned,
  beside Warding's refill) call `buildsBraceRearm`. `builds/cards.ts`: `applyLevelGained` adds `BASTION_ARMOR_PIPS` to
  `armorMax` and `armor`, `grantCard` sets `braceReady` 1.
- **Feed** (`BuildEvents`, cleared every tick, not hashed): `bracePlayer` (party index) and `braceKind` (`BraceKind`
  in `builds/effectsData.ts`: PIP 0, HEAL 1 (LG4's Stone Heart), SPENT 2), one entry per brace.
- **Specs** (`builds/bastion.spec.ts`): the pick's pip and arming; 27 ticks with, 18 without, the view helpers and
  `swordGuard`'s clamp; a bullet straight behind is erased only with Bastion; 3 cancels brace once, a second guard in
  the room does nothing; the count builds over a guard's ticks and restarts with the next; SPENT at full armor; a swap
  or roll mid-guard resets the count; re-arm on a room's spawn and a floor change; a roll through 3 bullets braces
  with the bow; a bullet overlapping for 5 ticks counts once; a roll start restarts the count; post-hit invulnerability
  never counts; goo never counts; Phantom Step's erasures count; no Bastion, no count or mark; co-op: own armor only,
  a marked bullet never counts for a second roller; two co-op runs rolling through fans hash the same every tick.
  `builds.spec.ts`' LG1 grant spec now expects the pip (the only pinned change).

## LG4 (as built)

The four duos' rules. Paths under `src/shared/sim/builds/`. Only players owning a duo play differently.

- **Supernova** (`onKill.ts` `volatileBurst`): a proc whose `excess >= SUPERNOVA_CARRY` (3) with the duo bursts from
  `SUPERNOVA_BURSTS` (new in `effectsData.ts`: I = `VOLATILE_BURSTS[1]` 12, II = a 16-bolt ring without pierce, III =
  16 piercing `SUPERNOVA_CATACLYSM_PIERCE` 2) or, with Shrapnel too, `SUPERNOVA_SHRAPNEL_BURSTS` (I =
  `SHRAPNEL_BURSTS[1]` 12 piercing 1, II = 16 piercing `SHRAPNEL_PIERCE` 1, III = 16 piercing the larger of Shrapnel's
  Cataclysm pierce and Supernova's: 2); damage as the level's own ring. Two new BurstSpec entries, both on the existing
  12 / 16 @ FULL_RING arc rows (no arc table row added). A `duoProc` entry (`Duo.SUPERNOVA`, the corpse, bolts spawned)
  marks the larger ring. Chain Reaction's cross triggers use a scratch proc with `excess` 0, so they never Supernova.
- **Skewer** (`onKill.ts` `overkill`): with the duo, before the target, every other enemy (nearestEnemy's skips: free,
  dead, the victim, spawned this tick) whose position is within `SKEWER_RADIUS` (0.5) of the corpse -> target segment
  (`onSkewerLine`: point-to-segment squared distance with multiplies and comparisons only, end caps included) takes
  the full carry, in slot order, the list fixed before the first strike; then the target. Each strike is one
  generation on with `KillCause.OVERKILL` (`streakStrike`), so each kill carries on. One overkill segment per streak as
  before, plus a `duoProc` entry (`Duo.SKEWER`, the corpse, enemies struck including the target) when the line struck
  anyone else.
- **Citadel** (`hooks.ts` `brace`): with the duo, `braceReady` is neither needed nor cleared; one brace per guard or
  roll still holds (the brace fires only on the bullet that crosses the threshold).
- **Stone Heart** (`hooks.ts` `brace`): a brace with no pip missing heals `STONE_HEART_HEAL_HALF_HEARTS` (1, new in
  `effectsData.ts`) half hearts up to `heartsMax` (`BraceKind.HEAL`); nothing to heal either: SPENT. Once per room
  through `braceReady` like any brace, unlimited with Citadel.
- **Feed**: no new list; `braceKind` HEAL (1) and the two `duoProc` duos above.
- **Specs** (`legendaryDuos.spec.ts`): Supernova I / II / III -> 12 / 16 / 16 (II no pierce, III pierce 2) on a
  carry of 3+, the ordinary 8 / 12 / 16 (pierce 1) below it or without the duo, Shrapnel's damage and pierce kept, and
  no arc table miss at any level; Skewer strikes a line of three in slot order with the target last (strike order read
  from the queued procs), skips an enemy just off the line and one behind the corpse beyond the radius, and only the
  target without the duo; Citadel braces twice in one room, one brace for a 6-bullet guard; Stone Heart heals only at
  full armor, once per room, SPENT at full hearts, unlimited with Citadel.
- **Open (owner call).** Skewer as specified rarely strikes more than the target: the target is the NEAREST enemy, so
  any enemy within 0.5 of the inside of the segment is (nearly always) nearer than the target and would have been the
  target itself. The line therefore catches only enemies clustered within 0.5 of the target's end (or of the corpse);
  a row of swarmers spaced 1 apart is struck one per tick, like plain Overkill. Fixing it needs a design change (e.g.
  extend the line past the target to `OVERKILL_RANGE`, or aim at the farthest enemy in range); not done.

## LG6 (as built)

The view and client presentation. Presentation only: no sim, dungeon, hash, replay, fixture or lockstep change (sim
exports read only). Paths under `src/` unless noted. Nothing here could run in Studio (client code needs the engine):
the Studio checklist below holds what to look at.

- **Feed** (`shared/view/fx/buildFxEvents.ts`). `overkills` (`StreakRecord`: corpse `x1` / `z1`, target `x2` / `z2`,
  owner, gen, carry, tick; from `overkillX1` .. `overkillCarry`) and `braces` (an `EffectRecord`: owner = the bracing
  player, x / z where they stood at collect, kind = `BraceKind`, amount 1, gen 0). Supernova's and Skewer's `duoProc`
  entries fall into `duoProcs` like BU6's (no code change), so each pops BU6's origin flare in `boon.duo` at the corpse.
- **Overkill streak** (`buildFxRules.ts` director, drawn by `client/controllers/fx/BuildFxController`). One straight
  Neon segment corpse -> target per strike (the spark beam pool's construction, one segment, no jag) in `build.overkill`,
  a thinner core segment a hair above it in the role mixed 75 % toward white, alive 0.16 s (opaque 45 %, then fading),
  at most 24. Thickness 0.22 studs for a carry of 1, +0.03 per carry above 1 up to 4 steps (`streakThickness`; the
  spark beam is 0.12), so a heavy arrow's carry 3 reads thicker than a stream's 1. An impact flash at the target: a flat
  disc 0.8 tiles in `build.overkill`, popping 0.5 -> 1 over 0.06 s and fading over 0.18 s, at most 8. Reduced
  `buildFx`: every streak 0.1 studs, no core, no impact flash; reduced motion: no pop. Skewer: a streak whose corpse,
  tick and owner match a `SKEWER` duoProc is 1.3x thicker (Full and Reduced) and has the duo's flare at the corpse.
  Tunables `BUILD_FX_VIEW.overkill` (`shared/view/fx/buildFxConfig.ts`). New parts pools `OverkillStreak` /
  `OverkillImpact` (`getPoolSizes` now returns five sizes).
- **Supernova.** Nothing new: the larger ring is the bolts themselves (real effect bullets, `BulletRenderController`'s
  burst look and trails), and the burst cue reads the burst records as before; plus the duo flare above.
- **Overkill audio** (`shared/view/audio/cues.ts`). `sfx.build.overkill` once per frame for the frame's streaks at
  `buildGenSpeed(highest overkillGen)` (BU8's +2 semitones per generation, capped at +6: a chain climbs per link),
  volume `BUILD_FX_VIEW.audio.volume`, a teammate-only streak quieter and lower; under the voice cap and FIRST in
  `BUILD_VOICE_SFX` (a busy frame drops the spark before the legendary's streak). Interval 0.06 s (LG5).
- **Bastion's guard.** `WeaponViewController` draws the view player's guard with `swordGuard(slot,
  swordGuardTicks(state, viewIndex))` and `swordGuardHalfAngleCos(state, viewIndex)`: with Bastion the full ring
  (`sector` with -1 draws the whole circle and no edge rays) and the right progress over 27 ticks; without, exactly the
  old arc. `fxCues` `guardOf` and `watch.ts` `guardUp` pass `swordGuardTicks` per player (read only while the guard's
  timer runs, so a hand-made state without `run.players` never reaches `runMods`). Also `nearMissRules`
  `parryStartsGroup(..., guardTicks)` (default `SWORD_DATA.guardTicks`), passed `swordGuardTicks` by the near-miss
  director and the recap tally: a 27-tick Bastion guard is ONE parry (one PARRY! flash, one recap parry), not two.
- **Brace ring** (director, `brace` ring look). A ring on the bracing player (following them): 0.3 s, 0.75 -> 1 tile,
  10 segments (Reduced 5) in `uiMana` (the armor pips' colour; no new role), its chords shrinking from 30 % of its life
  to 45 % of their length at the end (`braceChordShare`: the crack). PIP and HEAL full strength; SPENT a faint one
  (opacity x 0.35, `braceRingStrength`; no text, toast, pulse or sound, so the once-per-room limit reads). HEAL also
  starts BU8 follow-up's Lionheart heal pulse (`fx.heal`, following). A newer brace replaces the player's ring. Tunables
  `BUILD_FX_VIEW.brace`.
- **Brace feedback** (`shared/view/fx/braceFx.ts` / `braceFxConfig.ts` `BRACE_VIEW`; client
  `client/controllers/fx/BraceFxController`, a BuildFxController subscriber reading `BuildFxFrame.braces`).
  `braceFeedbackOf(kind)`: PIP = shout + armor pulse + sound + `hud.toast.brace`; HEAL = shout + sound +
  `hud.toast.braceHeal`; SPENT = nothing. The view player's shout: `fx.brace.text` (BRACED) through
  `ComboController.requestShout` (the combo shout's slot and construction: its placement keeps it off the bullets, CD9)
  in `uiMana` for 0.9 s at the new `FLOOR_SHOUT_PRIORITY.brace` 0 (shared/view/hud `dailyRankConfig.ts`): the lowest
  request, equal to a tier shout (it replaces a showing tier shout like every priority request; any other shout
  replaces it; a tier-up while it shows stays in the panel). The view player's armor pulse: a `uistroke` round the
  armor pips in `StatusPanel` (`BRACE_UI` bindings, `client/ui/hud/braceUi.ts`; thickness 4 -> 1 px eased out while
  fading over 0.45 s, `bracePulseLook`; 1 px and fading only under reduced motion; cleared on a run exit). The plan's
  "pip flies into the armor row" is this pulse, not a flight. The local player's toast: `ToastPanel`, 2.5 s, ids from
  `BRACE_VIEW.toast.idBase` -(2^23). Sound: `sfx.build.brace` through `playerCue` (yours full volume, a teammate's at
  teammate volume) for PIP / HEAL, outside the voice cap (it answers the player's own guard), interval 0.3 s (LG5).
- **Toasts, Build list, items panel.** Data-driven already (`BOONS` / `DUOS` loops, `itemIconKey`): Overkill and
  Bastion show as legendary cells (no pips) with `OVK` / `BST`, the four duos as joined chips (`SNV` .. `STH` come from
  the duo strings; the chip shows the two boons' labels), Build list rows with their lines, the boon / duo toasts. No
  code change; pinned by a spec.
- **Not done.** Recap lines ("Longest overkill chain", "Braces"): skipped (two new strings, a tally, two highlight ids
  and the recap / telemetry specs: not a trivial add). No debug attribute (BuildFx has none). The touch strip's armor
  pips get no pulse (the status panel's only). The guard's `fx.guard.shield` sprite stays the half-moon art ahead of
  the knight with Bastion (the full ring is the marking).
- **Specs.** `view/fx/buildFxEvents.spec.ts` (the two lists, per tick, reset; legendary duos into duoProcs),
  `view/fx/buildFxRules.spec.ts` (streak timeline, thickness by carry / Reduced / Skewer, core, impacts and pop,
  outsiders ignored, cap, quiet / new run; the crack, strength, PIP / SPENT / HEAL rings and the heal pulse, following,
  the braces list, Reduced, reduced motion, replacement), `view/fx/braceFx.spec.ts` (feedback per kind, strings in the
  pack, the shout's priority, the pulse timeline), `view/audio/buildCues.spec.ts` (the streak cue's gen pitch,
  teammates, first under the cap; the brace cue per kind, teammates, outside the cap, its interval),
  `view/fx/nearMissRules.spec.ts` (`parryStartsGroup` with a Bastion guard's length), `view/hud/buildHud.spec.ts` (the
  two boons and four duos in the items row, Build list and toasts).
- **Verify.** typecheck, lint, check:assets, build, check:autolocalize and test:l10n green. Headless (Lune): every spec
  under `view`, `theme`, `shared/play` and `sim/builds` passes.

Studio checklist additions (LG9): 11. the armor row's pips pulse once on a pip restored (status panel; no pulse on the
touch strip); 12. Stone Heart: "Braced: healed" toast with the green pulse, no armor pulse; 13. a SPENT brace (second
guard in a room, full armor) draws only a faint ring, no text or sound; 14. a 27-tick Bastion guard flashes PARRY! once
and counts one parry in the recap; 15. the Overkill streak reads apart from Volatile's apricot bolts on every biome
(shape: a straight thick line with a white core) and its impact flash never reads as an enemy bullet.

## Player experience

1. **Floor 4 draft.** A card trembles, the others dim, it flips gold: **Overkill.** "The damage left over from a kill
   jumps to the next enemy." The next finisher lands on a swarmer; a hot streak snaps from the corpse to the swarmer
   behind it, then to the sniper behind that. Three kills from one swing.
2. **With the bow.** Every one-shot carries at least 1, so a stream into a swarmer pack ripples through it. A heavy
   arrow into a pack visibly carries 3.
3. **Floor 6, a duo.** The player owns Volatile: **DUO - Supernova.** "Big overkills burst one ring bigger." A finisher
   into a pack now blows out 12-bolt rings where 8 used to be.
4. **Bastion.** The guard flashes as a full stone ring around the knight instead of a half moon, and lasts half as long
   again. A caster's fan arrives from behind; the guard eats all six bullets, a pip flies into the armor row and the
   knight's ring cracks with a chime: **BRACED.** Once per room, so the player learns to save the guard for the volley.
5. **Citadel / Stone Heart.** With Warding, every braced guard restores a pip, not just the first in a room. With Hearty,
   a brace at full armor heals half a heart instead. Clean guarding is how this build stays alive.

## Design

### Overkill (`boon.overkill`, legendary, offense, icon `OVK`)

Level I only (LGD1). One rule:

> A kill's **carry** jumps from the corpse to the nearest living enemy within `OVERKILL_RANGE` (4 tiles) as a streak
> and deals the carry to it. If the streak kills, that kill's own carry jumps on.

- **Carry** = the hit's damage after `filterDamage`, the Shielded absorb and the boss cap, minus the hp the enemy had
  left; a one-shot by the player's own hit (gen 0: a swing or arrow on an enemy at full hp) carries at least
  `OVERKILL_ONE_SHOT_MIN` (1), so a streak's own kills never get the floor and carries do not grow (LGD2); an Executioner
  execute carries the hit's full damage (LGD3). A carry below `OVERKILL_MIN_CARRY` (1) does nothing. Damage is
  always an exact binary fraction (multiples of 1/8 through Fury and Sharpened), so the carry is exact.
- **The streak is instant** (Chain Spark's shape): `nearestEnemy` with the spark's skips, one strike through
  `ctx.damageActor` with `ctx.procGen = gen + 1` and a new `KillCause.OVERKILL`. The carry is already the player's
  damage, so `playerHitDamage` is **not** applied again (LGD4).
- **Chains** are ordinary procs: the streak's kill queues a proc whose `excess` is its own carry, resolved next tick,
  so a chain ripples outward and stops at `GEN_MAX` (3 carries). No target in range: the carry is lost (no event).
- **Which kills carry**: every kill that queues a proc (sword, arrows, embers, effect bullets, sparks, streaks), so
  never turrets (revivers), the dummy, or a quiet death (a Bomber's own blast).
- **Bosses**: a streak may strike a boss (the cap applies, as for sparks); a boss's kill never carries (the fight is
  over). Bosses are never executed, so LGD3 never reaches them.
- Resolution order: Overkill is index 15, so it resolves after Chain Spark, Volatile and Soul Shards for the same proc.

Tunables (`builds/effectsData.ts`): `OVERKILL_RANGE` 4 tiles, `OVERKILL_MIN_CARRY` 1, `OVERKILL_ONE_SHOT_MIN` 1.

### Bastion (`boon.bastion`, legendary, defense, icon `BST`)

Level I only. Three parts:

1. **On pick**: +1 armor pip (`BASTION_ARMOR_PIPS`; `armorMax` and `armor`), like Warding I, so Brace always has a slot
   to fill. Not refilled per room by itself; with Warding the room refill covers it (Warding refills to `armorMax`).
2. **A bigger guard**: `guardHalfAngleCos` -1 (the full ring, `BASTION_GUARD_HALF_ANGLE_COS`) and `BASTION_GUARD_TICKS`
   27 (1.5x the 18; whole ticks). Reach and the 60-tick cooldown are unchanged; the numbers are settled by LG7's
   tuning (LGD5).
3. **Brace**: one guard **or one roll** that stops at least `BASTION_BRACE_BULLETS` (3) enemy bullets restores one
   armor pip, up to `armorMax`. A guard counts the `cancels` it already counts; a roll counts each enemy bullet that
   overlaps the player while rolling with i-frames (`rollTicks > 0` and `iframeTicks > 0`, Phantom Step's test), once
   per bullet: the first time a Bastion roller counts a bullet, its payload's `lastHit` is set to 1 (unused on enemy
   bullets), and a marked bullet never counts again for anyone. Phantom Step's erased bullets count too. Goo and
   strikes never count (as for the parry feed). The count (`braceCount`) resets when a guard or a roll starts. Once
   per room (LGD6, threshold and limit settled by LG7): `braceReady` is set when a room's enemies spawn (Warding's
   moment) and at a floor's start, cleared by a brace. A brace with no missing pip is spent anyway (unless Stone
   Heart), so the "once" is readable.

The guard is the sword's, but the roll is every weapon's, so a bow player braces by rolling through a volley (LGD7).
Mirror Cloak reflects every bullet a guard erases, so with Bastion a full-ring guard reflects everything around the
knight; a full pool still drops reflections, as today.

### Duos (appended: Duo indices 9-12)

| Duo | Boons | Rule | Beat |
|---|---|---|---|
| **Supernova** | Overkill + Volatile | a kill whose carry is `SUPERNOVA_CARRY` (3) or more bursts one Volatile ring larger: level I -> 12 bolts, II -> 16, III (Cataclysm) -> 16 that pierce 2 (LGD8) | Big hits make visibly bigger rings |
| **Skewer** | Overkill + Piercing Arrows | the streak strikes every enemy its line passes within `SKEWER_RADIUS` (0.5 tiles) of, each for the full carry, the target last; each kill carries on | One heavy arrow skewers a line of swarmers; the bow's Overkill duo |
| **Citadel** | Bastion + Warding | Brace is no longer once per room: every guard that erases 3+ bullets restores a pip | Warding's pips become something you earn back mid-fight |
| **Stone Heart** | Bastion + Hearty | a Brace with no missing pip heals half a heart instead (a heal pulse); still once per room unless Citadel | Hearty's first duo: perfect guarding heals |

Supernova keeps V2's name but not V2's rule ("+1 bolt per point of excess, cap +8" needs a ring row in
`arcTablePort.ts` for every count from 9 to 24); the larger ring reuses the 8 / 12 / 16 @ FULL_RING rows that exist.
Skewer's line test is a point-to-segment distance (multiplies and one comparison, no sqrt, no trig), actors in slot
order.

### The legendary economy

- The rarity roll is unchanged (5 % + 1 per floor after the first, at most 15). The pool goes from 2 to 4, so a given
  legendary is half as likely per legendary card, and the legendary slot stays meaningful after two picks.
- Greed's deal (`drawLegendaryOffers`) draws unowned legendaries first: twice the pool before it falls back to fills.
- Duo anchors: Ember Wake 2, Composure 1, Overkill 2, Bastion 2 (7 of 13 duos sit on a legendary).
- LG7 measures the effect on evolutions / duos per run with the BU13 offer harness before any number moves.

### Where it shows

- **Draft**: both are legendary cards, so they get the legendary beat for free (DRD7). Duo cards use `boon.duo`.
- **Overkill**: a straight streak per strike (the spark beam pool's construction, thicker, no jag), white core in
  `build.overkill`, an impact flash at the target; the kill sound's pitch steps up per carry along a chain. Reduced
  `buildFx`: a thin streak, no impact flash.
- **Bastion**: the guard drawn as a full ring (the weapon view reads the guard's arc from the snapshot, not
  `SWORD_DATA`); a brace cracks a stone ring on the knight (0.3 s), flies a pip into the armor row and plays
  `sfx.build.brace`; floor text `BRACED` on the combo shout's construction (never over a bullet, CD9).
- **Toasts / build list / items panel**: as for any boon and duo (BU10), with the new strings.
- **Recap** (optional, RUN_RECAP highlights, presentation only from the unhashed events): "Longest overkill chain N",
  "Braces N".

## Architecture

1. **Data** (`progressionData.ts`, `buildsData.ts`, `effectsData.ts`). `Boon.OVERKILL` 15, `Boon.BASTION` 16 appended
   to `Boon` / `BOONS` (rarity legendary; `CLASSIC_BOON_COUNT` stays 12). `Duo.SUPERNOVA` 9 .. `Duo.STONE_HEART` 12
   appended to `Duo` / `DUOS`. Tunables above. `KillCause.OVERKILL`.
2. **State** (`builds/builds.ts`, hashed, appended in this order): `BuildProc.excess` (0 for a proc that carries
   nothing); per player `braceCount` (bullets stopped by the current guard or roll), `braceReady` (0 / 1). The roll
   brace's mark lives in the enemy bullet's payload (`lastHit`, already hashed with the pool); only a Bastion roller
   ever sets it, so runs without Bastion hash exactly as before. `levels` grows with
   `BOON_COUNT` (17). Clone, hash and the snapshot follow the existing pattern.
3. **Rules**.
   - `actors.ts` `damageActor`: before the clamp, compute the carry into a transient `ctx.killCarry` (not state, set
     and cleared around the kill line like `ctx.procGen`); `buildsOnKill` copies it into the proc. No change without
     `state.builds`.
   - `builds/onKill.ts` `overkill(ctx, s, q)`: the streak (and Skewer's line); `volatileBurst` reads Supernova.
   - `progression/runMods.ts`: `bastion` mod; `weapons/defs/sword.ts` reads `guardTicks` / `guardHalfAngleCos` through
     it (exactly `SWORD_DATA`'s numbers without Bastion) and calls a new `buildsOnGuardCancels(state, i, cancels,
     starting)` hook (`builds/hooks.ts`: resets `braceCount` on a guard's start, adds cancels, braces at the
     threshold).
   - Roll brace: `combat.ts` `enemyBulletHit` / `enemyBulletHitParty` call `buildsOnRollThrough(state, k, i, payload)`
     where a bullet overlaps a rolling, i-framed Bastion owner (before `hurtPlayer`, beside Phantom Step's branch;
     a per-tick `bastionRolling` mask like `phantom`, so other runs pay one boolean); it marks the payload
     (`BulletPayload.with(p, "lastHit", 1)`) and adds to `braceCount`. The roll's start (Ember Wake's moment) resets
     the count.
   - Brace re-arm: `progression.ts` step 3 (a room's enemies spawned) and the floor start set `braceReady`.
   - Grant: `cards.ts` `grantCard` adds Bastion's pip, as Warding's level step does.
4. **Feed** (`BuildEvents`, unhashed): `overkillX1/Z1/X2/Z2/Owner/Gen/Carry`, `bracePlayer`, `braceKind` (pip / heal),
   `guardRing` per player for the view.
5. **Theme**: strings `boon.overkill.*`, `boon.bastion.*`, `duo.supernova.*` / `.skewer.*` / `.citadel.*` /
   `.stoneHeart.*`, `hud.toast.brace` and `fx.brace.text` (`BUILD_STRING_KEYS` / `progressionStringKeys`), each with an
   `l10n/context.json` entry; colour role `build.overkill` (`buildReport`: >= 40 CIE76 from every danger and boost
   role; enemy bullets are pink, so the candidate is a hot white-orange, measured in LG5); port audio IDs
   `sfx.build.overkill` / `sfx.build.brace` (SILENT in the placeholder; `SFX_FALLBACK` to the spark and the armor
   sounds). Check `contract.luau` / `validate.luau` stay under Luau's 200 top-level locals (185 / 196 today).
6. **View**: `BuildFxController` streaks, the weapon view's guard ring, the brace ring / pip flight / floor text, icon
   labels until art (BU11's path).

## Tasks

- **LG0 Audit.** Read the files in "What the code gives us" on the branch's base; record differences here. Confirm no
  V2 boon has landed (indices 15 / 16 free). **Verify:** findings section written; indices confirmed.
- **LG1 Data and scaffolding.** Append the two boons and four duos, tunables, `KillCause.OVERKILL`, the hashed fields
  (no rule yet), placeholder strings, `DAILY.ruleset` 8 -> 9. **Verify:** `npm run verify` green; the tutorial's
  floor-2 draft and `roomPool.lock.spec` unchanged; golden fixtures match; a builds run can be offered and granted
  both (cards spec), and neither ever appears as an upgrade or evolution.
- **LG2 Overkill.** `ctx.killCarry`, `BuildProc.excess`, `overkill` in the proc loop, events. **Verify:** specs: a
  finisher (6) on a 1-hp swarmer carries 5 to the nearest; a stream one-shot carries 1; an execute carries the full
  hit; a 0.5 carry does nothing; chains stop at `GEN_MAX`; a turret kill never carries; a boss strike respects the cap;
  two runs hash the same every tick (determinism spec with Overkill + Chain Spark + Volatile on a swarmer pack).
- **LG3 Bastion.** `runMods.bastion`, guard numbers through it, `buildsOnGuardCancels`, brace, re-arm, the pip on
  grant. **Verify:** specs: the guard erases a bullet behind the knight only with Bastion; 27 ticks with, 18 without;
  3 cancels in one guard restore a pip once per room; a second guard in the room does nothing; a swap or roll mid-guard
  resets the count; a roll through 3 bullets braces with the bow in hand; a bullet overlapping the roller for 5 ticks
  counts once, and a second Bastion roller never counts it again; a bullet passing through post-hit invulnerability
  (no roll) never counts; Phantom Step's erasures count; co-op: one player's brace never touches another's armor; without Bastion the sword's step is
  identical (golden runs).
- **LG4 Duos.** Supernova, Skewer, Citadel, Stone Heart. **Verify:** one spec per duo (Supernova uses only existing arc
  rows: no "arc table miss"); Skewer hits a line of three in slot order; Stone Heart heals only at full armor.
- **LG5 Theme.** Strings, context entries, `build.overkill` (measured through `buildReport`), audio IDs and fallbacks.
  **Verify:** theme validator and `l10n:check` green; Luau locals counted on out/.
- **LG6 View.** Streaks, guard ring, brace feedback, Reduced variants, optional recap lines. **Verify:** Studio
  checklist below; presentation only (no hash change from this task).
- **LG7 Tuning.** Extend the BU13 harnesses: TTK rows for Overkill (sword / bow / with Sharpened / with Executioner),
  pack-clear chains per finisher, Bastion's pip uptime in sniper / reaper / caster rooms (bot guarding on a fixed
  cadence), and offer statistics with four legendaries (evolutions / duos per run by floor 11 for each policy).
  **Verify:** tables in this doc; recommendations listed as owner calls, no number changed in this task.
- **LG8 Art and audio.** Two boon icons, four duo icons (BU11's sheet), the two clips (BU12's path). **Verify:** vale
  pack validates; ids in `assetIds.ts`.
- **LG9 Studio check and playtest.** **Verify:** checklist passed; frame time with Overkill + Supernova + Chain Reaction
  in a dense room within BU14's budget.

Studio checklist (LG6 / LG9): 1. a finisher chain draws one streak per carry, rising in pitch; 2. a bow one-shot carries
1 visibly; 3. Supernova's bigger ring shows on a 3+ carry only; 4. Skewer's streak visibly passes through the line;
5. the guard ring is full with Bastion and the old arc without; 5b. a roll through a fan braces (bow in hand); 6. BRACED floor text never covers a bullet; 7. the pip
flies into the armor row; 8. Stone Heart's heal pulse; 9. Reduced build effects thin the streak and drop the flash;
10. co-op: a teammate's streaks and braces read as theirs (owner tint rules as for sparks). Items 11-15: "LG6 (as built)".

## Edge cases

- A kill on the floor-change tick: its proc is dropped with the queue (BU3), carry included.
- The streak's target dies before the proc resolves: `nearestEnemy` only sees living enemies at resolution.
- A phase-invulnerable boss (`filterDamage` 0) takes 0 from a streak: no carry, no chain.
- A Shielded affix absorbs a streak like any hit; the carry is computed after the absorb.
- The Goldling: a streak can strike it like a spark can, so a chain can catch it (LGD12, settled).
- Breakables are never streak targets (sparks ignore them too).
- Bastion with no sword equipped: it braces by rolling. A guard started before a swap ends on the swap (existing
  rule); the count resets.
- A marked bullet reflected by Mirror Cloak: the reflection packs a fresh player payload, so the mark never reaches a
  player bullet's `lastHit`.
- Bastion picked mid-room: `braceReady` starts at 1 (the pick arms it once).
- A dead or departed co-op player: no brace, no carry (procs already skip departed owners).

## Decisions (proposed defaults, 2026-11-06)

- **LGD1** Overkill is a legendary at level I only; V2's level II and Annihilator are withdrawn (owner, 2026-11-06).
- **LGD2** (settled, owner 2026-11-06) One-shots by the player's own hit carry at least 1, so the bow's stream works with Overkill. Streak
  kills never get the floor.
- **LGD3** (settled, owner 2026-11-06) An Executioner execute carries the hit's full damage (the "one finisher clears every low enemy"
  moment V2 promised).
- **LGD4** The streak deals the carry as is; `playerHitDamage` is never applied twice.
- **LGD5** (settled after LG7, owner 2026-11-06) Bastion's guard: full ring, 27 ticks to start; reach and cooldown
  unchanged. LG7's numbers pick the final size.
- **LGD6** (settled after LG7, owner 2026-11-06) Brace: 3 bullets in one guard or roll, once per room to start
  (Citadel lifts the limit). LG7's numbers pick the final threshold and limit.
- **LGD7** (settled, owner 2026-11-06) A roll through 3+ bullets braces too, with any weapon, each bullet counted once.
- **LGD8** Supernova = one ring size larger on a 3+ carry (no new arc rows).
- **LGD9** Boon indices 15 / 16 and duo indices 9-12, before any V2 boon; V2's boons renumber after them.
- **LGD10** Legendary rarity percents unchanged.
- **LGD11** `DAILY.ruleset` 8 -> 9; all-time boards stay `_v1` (BUD9's precedent).
- **LGD12** (settled, owner 2026-11-06) Streaks may strike the Goldling.

## Risks

- **The roll brace is cheap with Slippery.** Longer i-frames mean more bullets per roll; LG7 measures braces per room
  with and without Slippery.
- **Bastion trivialises the guard.** A full ring with 1.5x duration may make caster / reaper rooms free. LG7's uptime
  table decides; fallbacks: 1.25x duration, or the ring at 270 degrees.
- **Overkill early, weak late.** Hp grows with depth while weapon damage does not, so carries shrink on deep floors.
  LG7's TTK rows by Depth show it; LGD2's floor keeps it alive on swarmers.
- **Cascade noise.** Overkill + Supernova + Chain Reaction is the loudest combination in the game. The proc cap and the
  effect budget hold the sim; audio needs the voice cap and the gen pitch (BUILDS.md audio risk).
- **Pool dilution.** Four legendaries halve each one's odds; a player chasing Ember Wake's duos sees it less. LG7's
  offer table shows the size of it.

## Out of scope

- Bastion + Riposte (docs/BUILDS_V2.md): a duo once Riposte exists.
- A third new legendary (score): Composure stays the only score anchor in this plan.
- Legendary-only presentation beyond the existing beat (no new card frame).

## Owner calls

1. After LG7: the guard's final size, the brace threshold and its once-per-room limit (LGD5 / LGD6).

## LG5 (as built)

Theme, l10n and audio registration only: no sim, hash, replay or fixture change, and nothing draws or plays any of it
yet (LG6). Paths under `src/shared/` unless noted.

- **Colour role `build.overkill` `#ffe0b0`** (a hot white-orange; `theme/types.ts` `COLOR_ROLES` after `build.ember`,
  so it is required; appended to `theme/builds.ts` `BUILD_EFFECT_ROLES`, so `buildReport` holds it to BUD12's bars and
  `pelletReport` keeps the pellets away from it). Placeholder pack only: vale clones the placeholder's colours and
  overrides no build role, so it is the same hex there. Measured by `buildReport` (printed by `theme/builds.spec.ts`,
  identical in placeholder, vale and vale's textured floor):

  | Against | CIE76 |
  |---|---|
  | `boost.fury` (nearest) | 45.5 |
  | `telegraph` | 51.7 |
  | `boost.quickstep` | 60.2 |
  | `boost.frenzy` | 69.4 |
  | `boost.aegis` | 74.1 |
  | `enemyOutline` | 79.8 |
  | `enemyBullet` | 88.7 |
  | `enemyBulletOutline` | 92.0 |
  | `enemyGoo` | 128.7 |

  Floor contrast 11.53:1 at the lowest (biome.3; vale's textured floor 14.10:1). The first candidate tried; whiter
  ones (`#ffe8c8` 54.8) drift into the player outline, oranger ones (`#ffd0a0` 42.4, `#ffc890` 37.3) into Fury and the
  telegraph. Not checked but measured: 72.0 from the pellets, 57.7 from `build.spark`, 34.0 from `build.shard`, 15.7
  from `build.ember`, 10.4 from `build.burst` (the apricot Volatile bolts: the streak reads by its shape, a straight
  line, not by hue; the view's white core helps). No bullet visual: the streak is drawn like Chain Spark's beam, which
  is a colour role only (pooled Neon segments in `build.spark`), so the streak needs nothing more from the theme.
- **Strings** (`theme/builds.ts` `BUILD_STRING_KEYS`, written out inline in `contract.ts` `REQUIRED_STRING_KEYS`;
  placeholder pack): `hud.toast.brace` "Braced: +1 armor", `hud.toast.braceHeal` "Braced: healed" (Stone Heart),
  `fx.brace.text` "BRACED" (floor text, capitals in the string itself; never upper-cased in code). Each has an
  `l10n/context.json` entry (`fx.brace.text` `max` 10, like `fx.parry.text`). No overkill toast.
- **Card text.** `boon.bastion.desc` was 66 characters, 6 over the longest card line (Slippery's evolution, 60) and
  21 over the longest level-I line (45): now "+1 armor pip; a full-ring guard; stop 3 bullets: +1 pip" (54, like
  Sharpened's evolution); the `boon.bastion.name` context note quotes it. The others stay: Overkill 52, Skewer 49,
  Citadel 47, Stone Heart 40, Supernova 35 (no translations exist yet, so nothing goes stale).
- **Audio** (port audio IDs, `theme/builds.ts` `BUILD_AUDIO_IDS`' last two and `contract.ts` `PORT_AUDIO_EVENTS` right
  after `sfx.build.jackpot`, so the build block stays one run): `sfx.build.overkill`, `sfx.build.brace`, SILENT in the
  placeholder; vale has no layout for them, so they stay SILENT there too (LG8). `view/audio/cues.ts`: `SFX.buildOverkill`
  / `SFX.buildBrace` in `ALL_SFX` and `PORT_SFX`; `SFX_MIN_INTERVAL` 0.06 s / 0.3 s; `SFX_PRIORITY` 53 (over the
  spark's 51, under the swing's 54) / 60 (over the parry's 57, under the Aegis break's 66); `SFX_FALLBACK`
  `sfx.build.overkill` -> `sfx.build.spark`, `sfx.build.brace` -> `sfx.boost.aegisbreak` (one step each: in the
  placeholder the spark is silent too, so a streak has no sound). Registered only: no cue mapping and not in
  `BUILD_VOICE_SFX` (LG6 decides; the streak is a cascade sound, so the voice cap is the likely home).
- **Specs.** `theme/builds.spec.ts` (the ten string keys, eleven sounds), `theme/audio.spec.ts` (the port list),
  `theme/contract.spec.ts` (required assets + 2, strings + 3), `view/audio/buildCues.spec.ts` (the eleven IDs; the two
  new ones ranked, timed, never a jingle / duck, their fallbacks and ranks), `view/hud/dailyRankStrings.spec.ts` (the
  rank layer's two now follow `sfx.build.brace`).
- **Luau locals.** No top-level constant added (list entries only): `contract.luau` / `validate.luau` at 186 / 196 of
  Luau's 200 top-level locals (counted on out/: `local function` = 1, `local a, b = ...` = one per name).
- **Verify.** typecheck, lint, check:assets, build, test:l10n (36), test:checks, check:autolocalize and `l10n:check`
  (0 errors, 0 warnings) green. Headless (Lune): every spec under `theme`, `view/hud`, `view/audio` and `view/fx` (112,
  the theme validator's placeholder and vale specs among them), plus `tutorial`, `play/bindings` and `shared/l10n`:
  all pass.

## LG7 tuning (as built, 2026-11-06)

Branch `legendaries-tune`. Measurements only: test support and spec files, **no gameplay number or rule changed**; the
recommendations at the end are owner calls. Harnesses: BU13's `run/testing/buildTune.ts` (extended: `arenaConfig` /
`anyLiving` exported, an optional per-step `observe` on `buildFight`, `KillCounts.streakKills` (kills whose
`ctx.procCause` is `KillCause.OVERKILL`) and `setProbeHitObserver`, a hook the kill probe calls on every hit before the
archetype's own `onHit`), `run/testing/buildOffers.ts` (extended: legendary tallies and Greed's deal per checkpoint) and
the new `run/testing/legendaryTune.ts` (Overkill rows and the Skewer counterfactuals, Bastion's defence fights). Specs
(each prints its tables with a `[legendaries tune]` prefix and asserts only loose bounds; headless runtimes in
brackets): `sim/legendaries.ttk.pack.spec.ts` (2.4 s), `sim/legendaries.ttk.room.spec.ts` (15 s),
`sim/legendaries.bastion.guard.spec.ts` (35 s), `sim/legendaries.bastion.roll.spec.ts` (44 s),
`run/legendariesOffers.spec.ts` (3 s). BU13's own specs (`sim/builds.ttk.*`, `run/buildsOffers`, `run/buildsPool`)
still pass unchanged.

**Method.** Overkill: BU13's arena exactly (solo, open endless arena, god mode, the build granted through `grantCard`
before tick 0, floors 1 / 6 / 11 at Depth 1 / 2 / 3, run seeds 1-3, BU13's sword and leading bow bots), on BU13's
8-swarmer pack, the census rooms (picked again by `tuneCensusRoom` from solo runs 1-10: the rosters changed since BU13,
so the rooms did too: f1 run 2 room 0 (4 swarmer, 1 sniper); f6 run 2 room 7 (3 imp, 1 bomber, 2 swarmer, 1 sniper);
f11 run 10 room 3 (bruiser, stormcaller, warbanner, summoner, sniper, charger\*, 2 swarmer)), and a new **line**: 6
swarmers in a row straight ahead, 1 unit apart (Skewer's best case). Streaks come from the unhashed `BuildEvents`
(`overkill*` lists: one entry per streak that struck; the longest chain = the highest proc generation + 1 links) and
Skewer's line strikes from its `duoProc` entries. **Skewer counterfactuals** (no sim change): at each streak's first
strike the probe's hit observer sees every actor where the streak found it (the corpse and target are the streak's
event, pushed before the strike) and counts the other living enemies (the spark's skips) within `SKEWER_RADIUS` of three
lines: as built (corpse -> target), **extended** (corpse -> the point `OVERKILL_RANGE` from the corpse through the
target) and **farthest** (corpse -> the farthest enemy within `OVERKILL_RANGE`). Geometry at the first link only: no
chain is replayed under the alternative rule.

Bastion: one room = one fight (the pick arms the brace once; nothing re-arms it in an arena), floor 6 hp (Depth 2), 20 s
at most, run seeds 1-5 (the player's start moves 0.5 x ((seed mod 5) - 2) along X, so the turret rooms, which draw no
rng, give five fights too), god mode (hits that landed and half hearts lost counted before the refill). Rooms: 2
`turret.caster` (3-arm spiral) and 2 `turret.sprayer` (16-rings) 3 units either side, 5 ahead (the M1 sandbox turrets:
no endless roster has them, so they are the dense-pattern stress tests; they revive, so these rooms never clear), 4
snipers (two ahead, two flanking behind), 2 reapers, and the f6 census room above. Bots: **guard** = the sword bot plus
the guard (ALT) whenever it is off cooldown, the knight is not rolling and an enemy bullet is within guard reach + 0.6;
**roll** = the bow bot (stream) plus a roll toward the nearest enemy bullet whenever 2+ are within 1.6 units; each also
as a **hold** bot that never attacks (the bow bot's kiting at 5 units with FIRE cleared, nothing dies, the full 20 s of
pressure: the defence alone). Guard erasures come from the scored `ScoreEvents.guardPlayer` (every row counts them);
roll counts are Bastion's own `braceCount` (only a Bastion roller marks bullets). The guard's shape without Bastion is
varied by setting `SWORD_DATA.guardTicks` / `guardHalfAngleCos` for the fight (restored after; the sword reads both
live); Bastion's `BASTION_GUARD_TICKS` / `BASTION_GUARD_SWEEP_HALF_ANGLE_COS` are constants, so Bastion rows run the
shipped numbers only, and other sizes WITH the brace and pip need a setter in sim code (not added). The shape rows
stand for Bastion's guard: the "ring, 27 ticks" row takes exactly Bastion's hits in every room.

Offers: BU13's 1000 simulated runs per policy unchanged, now with four legendaries and thirteen duos; Greed's deal is
drawn (`drawLegendaryOffers`, `PACT_LEGENDARY_CARDS` 3, on its own rng stream per run) for the build at each checkpoint.

### 1. Overkill: time to clear (mean seconds, x no build)

Pack (8 swarmers):

| build | sword s f1 / f6 / f11 (x no build) | bow s f1 / f6 / f11 (x no build) |
|---|---|---|
| no build | 1.4 / 1.4 / 1.8 | 1.6 / 4.7 / 9.5 |
| Overkill | 0.4 / 0.7 / 1.0 (0.30 / 0.50 / 0.55) | 0.8 / 4.7 / 9.5 (0.52 / 1.00 / 1.00) |
| Sharpened I | 1.4 / 1.4 / 1.8 (1.00 / 1.00 / 1.00) | 1.6 / 3.2 / 6.4 (1.00 / 0.67 / 0.67) |
| Overkill + Sharpened I | 0.4 / 0.7 / 1.0 (0.30 / 0.50 / 0.55) | 0.8 / 3.2 / 6.4 (0.52 / 0.67 / 0.67) |
| Executioner (Sharpened III) | 1.4 / 1.4 / 1.4 (1.00 / 1.00 / 0.79) | 1.6 / 1.6 / 3.2 (1.00 / 0.34 / 0.33) |
| Overkill + Executioner | 0.3 / 0.6 / 0.7 (0.25 / 0.40 / 0.40) | 0.8 / 0.5 / 1.8 (0.52 / 0.10 / 0.19) |
| Volatile I | 0.4 / 0.6 / 1.1 (0.29 / 0.41 / 0.60) | 0.3 / 1.5 / 3.4 (0.20 / 0.32 / 0.36) |
| Supernova (Overkill + Volatile I) | 0.4 / 0.5 / 0.9 (0.25 / 0.34 / 0.49) | 0.3 / 1.5 / 3.4 (0.20 / 0.32 / 0.36) |
| Piercing Arrows I | 1.4 / 1.4 / 1.8 (1.00 / 1.00 / 1.00) | 1.2 / 3.4 / 5.5 (0.77 / 0.72 / 0.58) |
| Skewer (Overkill + Piercing Arrows I) | 0.4 / 0.7 / 1.0 (0.30 / 0.50 / 0.55) | 0.6 / 3.4 / 5.5 (0.36 / 0.72 / 0.58) |

Mixed census room:

| build | sword s f1 / f6 / f11 (x no build) | bow s f1 / f6 / f11 (x no build) |
|---|---|---|
| no build | 1.9 / 7.0 / 25.6 | 1.9 / 10.1 / 56.4 |
| Overkill | 1.7 / 6.4 / 24.7 (0.87 / 0.92 / 0.96) | 1.4 / 10.1 / 56.4 (0.72 / 1.00 / 1.00) |
| Sharpened I | 1.9 / 4.0 / 21.9 (1.00 / 0.57 / 0.85) | 1.9 / 8.2 / 44.3 (1.00 / 0.81 / 0.79) |
| Overkill + Sharpened I | 1.7 / 3.2 / 21.6 (0.87 / 0.46 / 0.84) | 1.4 / 7.9 / 44.2 (0.72 / 0.79 / 0.78) |
| Executioner (Sharpened III) | 1.7 / 3.2 / 15.6 (0.88 / 0.46 / 0.61) | 1.4 / 4.8 / 25.4 (0.71 / 0.48 / 0.45) |
| Overkill + Executioner | 1.4 / 3.8 / 15.6 (0.71 / 0.55 / 0.61) | 1.0 / 4.3 / 25.6 (0.50 / 0.42 / 0.45) |
| Volatile I | 1.7 / 6.2 / 25.6 (0.90 / 0.89 / 1.00) | 1.4 / 9.3 / 53.6 (0.72 / 0.93 / 0.95) |
| Supernova (Overkill + Volatile I) | 1.6 / 6.0 / 24.5 (0.84 / 0.87 / 0.96) | 1.4 / 9.3 / 53.6 (0.72 / 0.93 / 0.95) |
| Piercing Arrows I | 1.9 / 7.0 / 25.6 (1.00 / 1.00 / 1.00) | 1.9 / 9.4 / 50.1 (1.00 / 0.93 / 0.89) |
| Skewer (Overkill + Piercing Arrows I) | 1.7 / 6.4 / 24.7 (0.87 / 0.92 / 0.96) | 1.4 / 9.4 / 50.1 (0.72 / 0.93 / 0.89) |

Every fight cleared; no weapon shot dropped; the proc queue never held more than 3 after a drain.

### 2. Overkill: streaks and chains

Per fight, f1 / f6 / f11 (the pack has 8 kills, the rooms 5 / 7 / 8-14 with summons and slimelets). "Carry max" and
"longest chain" over every fight of the row. Skewer's rows equal Overkill's everywhere (its line never struck anyone).

| fight, build | streaks per kill | kills by a streak | carry mean | carry max | longest chain (links) |
|---|---|---|---|---|---|
| pack, sword, Overkill | 0.58 / 0.71 / 0.58 | 58% / 21% / 33% | 1.57 / 1.60 / 2.66 | 5.80 | 2 |
| pack, sword, Overkill + Sharpened I | 0.58 / 0.79 / 0.67 | 58% / 29% / 33% | 2.32 / 2.38 / 3.69 | 7.20 | 3 |
| pack, sword, Overkill + Executioner | 0.67 / 0.71 / 0.71 | 67% / 50% / 21% | 3.62 / 2.16 / 2.07 | 8.85 | 3 |
| pack, sword, Supernova | 0.58 / 0.33 / 0.42 | 58% / 0% / 25% | 1.57 / 1.00 / 2.55 | 5.95 | 2 |
| pack, bow, Overkill | 0.50 / 0.00 / 0.00 | 50% / 0% / 0% | 1.00 / - / - | 1.00 | 1 |
| pack, bow, Overkill + Sharpened I | 0.50 / 0.00 / 0.00 | 50% / 0% / 0% | 1.00 / - / - | 1.00 | 1 |
| pack, bow, Overkill + Executioner | 0.50 / 0.75 / 0.88 | 50% / 75% / 25% | 1.00 / 1.75 / 1.75 | 1.75 | 3 |
| pack, bow, Supernova | 0.12 / 0.00 / 0.00 | 13% / 0% / 0% | 1.00 / - / - | 1.00 | 1 |
| room, sword, Overkill | 0.40 / 0.33 / 0.21 | 40% / 0% / 8% | 1.83 / 1.24 / 1.83 | 2.70 | 2 |
| room, sword, Overkill + Sharpened I | 0.40 / 0.52 / 0.17 | 40% / 10% / 8% | 2.58 / 2.30 / 3.71 | 6.60 | 2 |
| room, sword, Overkill + Executioner | 0.47 / 0.33 / 0.12 | 47% / 29% / 0% | 3.82 / 4.35 / 1.20 | 5.25 | 3 |
| room, sword, Supernova | 0.40 / 0.38 / 0.21 | 40% / 0% / 8% | 1.83 / 1.29 / 1.83 | 2.50 | 2 |
| room, bow, Overkill | 0.40 / 0.00 / 0.00 | 40% / 0% / 0% | 1.00 / - / - | 1.00 | 1 |
| room, bow, Overkill + Sharpened I | 0.40 / 0.14 / 0.02 | 40% / 0% / 0% | 1.00 / 1.20 / 1.00 | 1.20 | 1 |
| room, bow, Overkill + Executioner | 0.40 / 0.24 / 0.52 | 40% / 19% / 0% | 1.00 / 1.75 / 1.75 | 1.75 | 1 |
| line, sword, Overkill | 0.67 / 0.50 / 0.17 | 67% / 17% / 17% | 1.50 / 1.30 / 1.95 | 2.00 | 2 |
| line, bow, Overkill | 0.50 / 0.00 / 0.00 | 50% / 0% / 0% | 1.00 / - / - | 1.00 | 1 |

**The bow's stream stops carrying after floor 1.** LGD2's floor applies only to a one-shot of an enemy at full hp, and
from floor 2 a stream arrow (1 damage) one-shots nothing: a swarmer has 1.08 hp at f2, 2.1 at f6 (Depth 2), 4.05 at f11
(Depth 3) (`endlessActorHp`). The killing arrow's excess is then the fraction left over, always below 1 =
`OVERKILL_MIN_CARRY`, so it carries nothing: 0 streaks with the bow at f6 and f11 in every fight without Executioner
(Executioner's execute carries the full hit, LGD3, which is why Overkill + Executioner is the best bow row in the
tables: pack x 0.10 / 0.19). The sword carries mostly from its finisher (6) and is comparable to Chain Spark I in the
pack (x 0.30 / 0.50 / 0.55 here; BU13's Chain Spark I x 0.25 / 0.50 / 0.56) and weaker than it in rooms
(x 0.87 / 0.92 / 0.96). Chains are short: 2 links alone, 3 only with Sharpened or Executioner. Supernova rarely reaches
its 3+ carry (carry means 1.0-2.7), so it adds little to Volatile I (sword pack f6 / f11 x 0.34 / 0.49 against
0.41 / 0.60; the bow identical).

### 3. Skewer's line

| fight, weapon (streaks seen) | as built: streaks with another enemy on the line / others per streak | extended to OVERKILL_RANGE | to the farthest enemy in range |
|---|---|---|---|
| pack, sword (45) | 0% / 0.00 | 18% / 0.18 | 18% / 0.18 |
| pack, bow (12) | 0% / 0.00 | 75% / 0.75 | 50% / 0.50 |
| room, sword (18) | 0% / 0.00 | 6% / 0.06 | 17% / 0.17 |
| room, bow (6) | 0% / 0.00 | 50% / 0.50 | 50% / 1.00 |
| line, sword (24) | 0% / 0.00 | 88% / 2.25 | 88% / 2.12 |
| line, bow (9) | 0% / 0.00 | 67% / 1.67 | 67% / 1.67 |

As built, Skewer's line struck **nobody** besides the target in every fight, the row of swarmers included (the sim's own
`duoProc` feed agrees: 0 Skewer entries). The target is the nearest enemy, so anything inside the corpse -> target
segment would have been the target. Extending the line through the target to `OVERKILL_RANGE` catches 2.25 more per
streak on a row (sword) and some extra in packs and rooms; aiming at the farthest enemy does about the same on a row and
a little more in rooms (17 % of sword streaks) but sends the streak past the nearest enemies. The bow numbers are floor
1 only (the bow carries nothing later, section 2), so today Skewer's bow TTK from f6 is Piercing Arrows I's
(x 0.72 / 0.58 pack, 0.93 / 0.89 room).

### 4. Bastion, the guard (sword)

Hold bot (never attacks: the defence alone), 20 s per room, hits taken per minute / half hearts lost per room:

| room | today (203 deg, 18) | ring, 18 | 203 deg, 27 | ring, 27 | Bastion (ring 27 + pip + brace) | Warding I | Bastion + Warding I + Citadel |
|---|---|---|---|---|---|---|---|
| 2 turret.caster | 28.8 / 9.6 | 28.2 / 9.4 | 18.6 / 6.2 | 18.6 / 6.2 | 18.6 / 5.0 | 28.8 / 8.6 | 18.6 / 0.0 |
| 2 turret.sprayer | 16.8 / 5.6 | 16.8 / 5.6 | 8.4 / 2.8 | 8.4 / 2.8 | 8.4 / 1.8 | 16.8 / 4.6 | 8.4 / 0.2 |
| 4 sniper | 13.8 / 4.6 | 12.0 / 4.0 | 12.6 / 4.2 | 9.6 / 3.2 | 9.6 / 2.0 | 13.8 / 3.6 | 9.6 / 0.0 |
| 2 reaper | 3.0 / 1.0 | 3.0 / 1.0 | 1.8 / 0.6 | 1.8 / 0.6 | 1.8 / 0.0 | 3.0 / 0.4 | 1.8 / 0.0 |
| mixed f6 census | 10.2 / 3.4 | 7.8 / 2.6 | 10.8 / 3.6 | 9.0 / 3.0 | 9.0 / 2.0 | 10.2 / 2.4 | 9.0 / 0.2 |

Braces and guards per room (hold bot; "3+ / 5+" = guards that erased at least 3 / 5 bullets: Citadel's braces at the
shipped threshold and at 5):

| room | guards | erased per guard today / Bastion | 3+ / 5+ guards today | 3+ / 5+ guards Bastion | Bastion braces (pips restored) | Citadel braces (pips restored) |
|---|---|---|---|---|---|---|
| 2 turret.caster | 19.0 | 3.9 / 5.7 | 17.4 / 4.8 | 18.0 / 14.8 | 1.00 (0.20) | 18.0 (5.8) |
| 2 turret.sprayer | 19.0 | 1.8 / 2.5 | 5.2 / 0.2 | 9.0 / 0.6 | 1.00 (0.00) | 9.0 (2.4) |
| 4 sniper | 14.0 | 2.7 / 4.0 | 8.6 / 2.2 | 10.4 / 5.0 | 1.00 (0.20) | 10.4 (3.2) |
| 2 reaper | 7.8-8.6 | 1.2 / 1.5 | 0.6 / 0.0 | 1.0 / 0.2 | 0.60 (0.60) | 1.0 (0.6) |
| mixed f6 census | 9.8-10.0 | 2.3 / 2.8 | 4.6 / 1.6 | 5.4 / 1.8 | 1.00 (0.00) | 5.4 (2.2) |

Fighting bot (attacks and guards greedily), s per room / hits per minute / half hearts lost per room (turret rooms: 20 s,
never cleared):

| room | today (203 deg, 18) | ring, 18 | 203 deg, 27 | ring, 27 | Bastion | Warding I | Citadel |
|---|---|---|---|---|---|---|---|
| 2 turret.caster | 20 / 28.2 / 9.4 | 20 / 27.0 / 9.0 | 20 / 41.4 / 13.8 | 20 / 38.4 / 12.8 | 20 / 38.4 / 11.8 | 20 / 28.2 / 8.4 | 20 / 38.4 / 0.0 |
| 2 turret.sprayer | 20 / 0.0 / 0.0 | 20 / 0.0 / 0.0 | 20 / 14.4 / 4.8 | 20 / 1.2 / 0.4 | 20 / 1.2 / 0.0 | 20 / 0.0 / 0.0 | 20 / 1.2 / 0.0 |
| 4 sniper | 7.1 / 5.1 / 0.6 | 7.1 / 5.1 / 0.6 | 7.6 / 3.1 / 0.4 | 7.6 / 3.1 / 0.4 | 7.6 / 3.1 / 0.0 | 7.1 / 5.1 / 0.0 | 7.6 / 3.1 / 0.0 |
| 2 reaper | 3.4 / 17.8 / 1.0 | 3.4 / 17.8 / 1.0 | 4.2 / 28.7 / 2.0 | 4.2 / 28.7 / 2.0 | 4.2 / 28.7 / 1.0 | 3.4 / 17.8 / 0.0 | 4.2 / 28.7 / 0.0 |
| mixed f6 census | 8.7 / 5.5 / 0.8 | 8.7 / 5.5 / 0.8 | 9.1 / 6.6 / 1.0 | 9.1 / 6.6 / 1.0 | 9.1 / 6.6 / 0.2 | 8.7 / 5.5 / 0.0 | 9.1 / 6.6 / 0.0 |

Readings: for a player who defends, the guard's **length** does most of the work against spirals and rings (27 ticks:
caster and sprayer hits -35 % / -50 %, the ring alone ~0) and the **ring** against flanks (snipers: ring 18 -13 %, 27
ticks alone -9 %, both -30 %; the mixed room: ring 18 -24 %, 27 ticks alone +6 %). Bastion's full guard cuts hits 30-50 %
in the turret, sniper and reaper rooms and ~12 % in the mixed room, and halves the hearts lost; it does not make a room
free (1.8-5.0 half hearts per 20 s room but the reapers'). A player who keeps attacking pays for the longer guard: the
greedy bot guards 43 % of the time instead of 21 % next to the casters, clears 0.4-0.8 s slower and takes more hits next to casters and
reapers (the guard cancels the combo and halves the walk). **Citadel is what trivialises the guard:** one brace per 3+
guard is 5-18 braces per 20 s room with a defending player (1 against the reapers), and the hearts lost drop to 0.0-0.2
in every room; a threshold of 5 for those braces still leaves 5.0-14.8 in the caster and sniper rooms. **Bastion's own brace is mostly spent:** it fires in nearly every
room (the threshold of 3 never binds: 1.0-18 qualifying guards per room) but restores a pip in 0-0.6 of them, because
the first 3+ guard comes before the first hit.

### 5. Bastion, the roll (bow)

Per room; hold bot (never attacks) and fighting bot (the stream), hits per minute / half hearts lost, rolls, bullets
counted per roll (Bastion), rolls that stopped 3+ / 5+, braces (pips restored):

| room, bot | no build | Bastion | Bastion + Slippery I | counted per roll: Bastion / + Slippery | 3+ / 5+ rolls: Bastion / + Slippery | braces: Bastion / + Slippery | Citadel braces (pips), half hearts lost |
|---|---|---|---|---|---|---|---|
| caster, hold | 51.6 / 17.2 | 51.6 / 15.2 | 49.8 / 14.8 | 2.0 / 1.8 | 13.8 / 5.4; 12.8 / 4.8 | 1.0 (1.0) / 1.0 (0.8) | 13.8 (11.8), 4.4 |
| caster, fight | 48.6 / 16.2 | 48.6 / 14.2 | 46.8 / 13.8 | 1.7 / 1.6 | 9.8 / 4.0; 8.0 / 3.4 | 1.0 (1.0) / 1.0 (0.8) | 9.8 (8.8), 5.8 |
| sprayer, hold | 18.0 / 6.0 | 18.0 / 4.8 | 12.0 / 2.6 | 1.1 / 1.1 | 0.2 / 0.0; 0.8 / 0.4 | 0.2 (0.2) / 0.4 (0.4) | 0.2 (0.2), 3.8 |
| sniper, hold | 7.2 / 2.4 | 7.2 / 1.2 | 5.4 / 0.6 | 2.2 / 2.3 | 4.8 / 0.6; 4.8 / 0.4 | 1.0 (0.2) / 1.0 (0.2) | 4.8 (1.6), 0.2 |
| sniper, fight | 3.6 / 0.6 | 3.6 / 0.0 | 3.7 / 0.0 | 2.0 / 2.3 | 1.2 / 0.2; 1.4 / 0.2 | 0.8 (0.0) / 0.8 (0.0) | 1.2 (0.0), 0.0 |
| reaper, hold | 9.0 / 3.0 | 9.0 / 1.6 | 7.2 / 0.8 | 1.3 / 1.4 | 0.8 / 0.2; 0.8 / 0.2 | 0.6 (0.4) / 0.8 (0.6) | 0.8 (0.6), 0.6 |
| mixed, hold | 8.4 / 2.8 | 8.4 / 1.8 | 8.4 / 1.8 | 1.5 / 1.6 | 1.8 / 0.0; 1.8 / 0.0 | 1.0 (0.2) / 1.0 (0.2) | 1.8 (0.6), 0.8 |
| mixed, fight | 6.2 / 1.2 | 6.2 / 0.2 | 3.9 / 0.0 | 1.7 / 1.7 | 1.8 / 0.0; 1.8 / 0.0 | 1.0 (0.4) / 1.0 (0.4) | 1.8 (0.8), 0.0 |

Rolls per room: 45-48 (caster), 17-24 (sprayer), 4-12 (sniper), 2-7 (reaper), 5-8 (mixed). Slippery I does **not**
make the roll brace cheaper: bullets counted per roll stay 1.1-2.3 with or without it, rolls reaching 3 are as many or
fewer, and the once-per-room limit caps the braces at 1 either way (its hits saved are its own i-frames). The roll
brace fires in most dense rooms (caster, sniper, mixed) and rarely against sprayer rings or reapers. Rolling into a
caster spiral is costly (48-52 hits per minute: the roll's vulnerable tail lands in the spiral), so Citadel's 10-14
braces per room there buy back hits the roll itself took.

### 6. Offers with four legendaries

BU13's table rerun (1000 runs per policy); BU13's recorded numbers (two legendaries, nine duos) -> now:

| policy | by floor | runs with >= 1 duo | mean duos | mean evolutions | drafts offering a duo | boss deal: a duo to guarantee (floor 5 / 10) |
|---|---|---|---|---|---|---|
| greedy | 6 | 8.8% -> 9.4% | 0.09 -> 0.09 | 1.80 -> 1.80 | 1.5% -> 1.6% | 7.7% -> 7.7% |
| greedy | 11 | 45.9% -> 47.2% | 0.52 -> 0.53 | 3.42 -> 3.42 | 4.7% -> 4.9% | 17.9% -> 18.0% |
| random | 6 | 10.4% -> 10.7% | 0.10 -> 0.11 | 0.71 -> 0.71 | 5.4% -> 5.4% | 14.9% -> 14.4% |
| random | 11 | 45.3% -> 45.6% | 0.53 -> 0.54 | 2.28 -> 2.29 | 13.4% -> 13.7% | 32.9% -> 33.8% |
| duo-seeking | 6 | 42.1% -> 42.5% | 0.44 -> 0.45 | 1.45 -> 1.45 | 8.2% -> 8.3% | 24.3% -> 24.7% |
| duo-seeking | 11 | 93.9% -> 93.2% | 1.50 -> 1.56 | 2.82 -> 2.77 | 14.3% -> 14.7% | 31.2% -> 30.7% |

Evolutions everywhere 100 % / 65 % / 97 % of runs by floor 6 as before; picks by kind unchanged within a point (greedy
new 36 % / upgrade 31 % / evolution 28.5 % / duo 4.4 %). Legendaries (now):

| policy | by floor | mean legendaries owned | runs owning Ember Wake / Composure / Overkill / Bastion | drafts offering each (New) | runs offered each | Greed deal: new legendary / duo / evolution / fill (mean cards) | Greed deals holding each |
|---|---|---|---|---|---|---|---|
| greedy | 6 | 0.15 | 3.2 / 3.1 / 4.0 / 4.3 % | 4.6 / 4.0 / 4.1 / 4.4 % | 26 / 22 / 22 / 24 % | 2.87 / 0.01 / 0.10 / 0.01 | 71 / 74 / 71 / 71 % |
| greedy | 11 | 0.41 | 9.2 / 10.3 / 10.8 / 10.7 % | 5.9 / 5.6 / 5.5 / 5.5 % | 54 / 52 / 50 / 51 % | 2.68 / 0.07 / 0.19 / 0.01 | 69 / 67 / 65 / 67 % |
| random | 6 | 0.24 | 6.7 / 5.2 / 5.5 / 6.3 % | 3.0 / 2.9 / 3.1 / 3.1 % | 17 / 16 / 18 / 18 % | 2.32 / 0.13 / 0.55 / 0.01 | 57 / 61 / 57 / 57 % |
| random | 11 | 0.50 | 13.3 / 11.6 / 10.5 / 15.0 % | 3.1 / 3.1 / 3.1 / 3.5 % | 33 / 32 / 33 / 37 % | 2.07 / 0.28 / 0.64 / 0.01 | 53 / 53 / 52 / 49 % |
| duo-seeking | 6 | 0.18 | 5.2 / 2.9 / 5.6 / 4.8 % | 4.3 / 3.8 / 3.9 / 4.2 % | 24 / 21 / 21 / 24 % | 2.74 / 0.09 / 0.16 / 0.00 | 68 / 70 / 68 / 68 % |
| duo-seeking | 11 | 0.54 | 14.9 / 8.0 / 17.4 / 13.4 % | 4.9 / 4.9 / 4.9 / 5.1 % | 46 / 47 / 46 / 48 % | 2.49 / 0.25 / 0.21 / 0.03 | 63 / 67 / 59 / 60 % |

Readings: the two new legendaries and four duos leave BU13's numbers where they were (duos +0.0-0.06 per run, within
the noise of 1000 runs): the legendary duos need a legendary, which a run owns 0.4-0.5 of by floor 11. Legendary cards
are offered at about 22 % per greedy draft by floor 11 (the four columns' sum; the rarity roll is unchanged), each
legendary a quarter of that, so each one is offered about half as often as with two (an arithmetic estimate: BU13 recorded
no per-legendary rates) and a run sees a given one by floor 11 in 33-54 % of runs. Greed's deal is almost always three
cards with 2.1-2.9 new legendaries (98-100 % of deals hold at least one): the doubled pool keeps Greed a legendary deal
deep into a run, where with two a player who owned both got only duos, evolutions and fills.

### Recommendations (owner calls; nothing changed here)

1. **LGD5, the guard: keep the full ring at 27 ticks.** It is the size that helps in every room type (the length
   against spirals and rings, the ring against flanks; either alone leaves one of them as today) and it does not make a
   room free on its own (section 4). If playtests say the sword feels sluggish while guarding (the fighting bot's
   slower clears), the fallback is the ring at 22-23 ticks; measuring it with the brace needs a test setter for
   `BASTION_GUARD_TICKS` in sim code (the shape rows here measure only the guard).
2. **LGD6, the brace: keep 3 bullets and once per room, but do not spend the brace while nothing is missing.** The
   threshold never binds (section 4: 1-18 qualifying guards per room), and once per room is right for Bastion alone,
   but today the brace is spent on the first 3+ guard, before the player has lost a pip, so it restores 0-0.6 pips per
   room. Proposed: a brace with no pip missing and no Stone Heart neither fires nor clears `braceReady` (no SPENT),
   so the pip comes back after the first hit that took one (Citadel's "pips restored" column, 0.6-5.8 per room, is the
   ceiling; once per room makes it at most 1). The view's BRACED then always means a pip.
3. **Citadel: limit it.** Unlimited braces are 5-18 per 20 s room for a defending player and zero hearts lost in every
   room (sections 4-5): this, not Bastion, trivialises caster / sprayer / sniper rooms. Options: a brace cooldown
   (`CITADEL_BRACE_COOLDOWN` ~5 s: at most 4 per 20 s room), or at most 2-3 per room; raising its threshold to 5 is not
   enough (still 5.0-14.8 per room against casters and snipers).
4. **Slippery: no change.** The roll brace is not cheaper with Slippery I (section 5); the risk did not show.
5. **Overkill: give every kill by the player's own hit the carry floor.** Today `OVERKILL_ONE_SHOT_MIN` applies only to
   a one-shot of a full-hp enemy, so the bow's stream carries nothing from floor 2 (section 2) and Overkill, Supernova
   and Skewer do nothing for a bow player past floor 1. Proposed: a gen-0 kill (any player hit that kills) carries at
   least 1 (LGD2 reworded; streak and effect kills still get no floor). Floor 1, where every stream kill is such a
   one-shot, shows the size: bow pack x 0.52, room x 0.72, row x 0.64. Lowering `OVERKILL_MIN_CARRY` instead would
   send fractional chips (0.05-0.95) that rarely kill. For the sword Overkill is about a Chain Spark I (pack x 0.30-0.55,
   rooms x 0.87-0.96, chains of 2): modest for a legendary; if it should stand out, a carry multiplier (e.g. x 1.5,
   a new `OVERKILL_CARRY_PERCENT`) is the lever, re-measured with these specs. Keep `OVERKILL_RANGE` 4. Supernova:
   `SUPERNOVA_CARRY` 3 -> 2 if it should show more often (carries average 1.0-2.7).
6. **Skewer: extend the line through the target to `OVERKILL_RANGE`.** As built it never strikes anyone besides the
   target (section 3, 0 in every fight). Keep the nearest enemy as the target (readable: the streak still goes where
   plain Overkill's does) and strike every enemy within `SKEWER_RADIUS` of the segment from the corpse to the point
   `OVERKILL_RANGE` from it through the target, each for the full carry, in slot order, the target last; the view draws
   the streak to that point. On a row of swarmers that is 2.25 extra enemies per streak (88 % of streaks) with the
   sword's carries, 1.67 (67 %) with the bow's at floor 1; aiming at the farthest enemy gives about the same on a row
   but flies past nearer enemies. It needs recommendation 5 too: Skewer is the bow's Overkill duo, and the bow has no
   carries to skewer with after floor 1.
7. **The legendary pool: no change.** Four legendaries move duos and evolutions per run by less than the noise; each
   legendary is seen about half as often (by floor 11 in 33-54 % of runs), and Greed's deal stays a legendary deal.

**Not measured.** Real floor geometry (walls end bullets and break lines: the arenas are open), party play, bosses
(capped by `damageCapPerSecond`, as BU13), Mirror Cloak with the full ring, Stone Heart's heals, human play (dodging,
timing the guard to volleys; the bots are greedy and god mode), Stormcaller strikes (never erased or counted), and the
alternative Overkill / Skewer / brace rules themselves (the counterfactuals are first-link geometry only; each proposal
needs its rule change and a rerun of these specs).
