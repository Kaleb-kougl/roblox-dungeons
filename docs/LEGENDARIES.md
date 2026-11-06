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

**Plan only, nothing built.** Follows docs/BUILDS.md (BU0-BU10 built; BU11-BU14 open). Overkill was proposed in
docs/BUILDS_V2.md as a common boon with levels and an evolution (Annihilator); the owner moved it here as a legendary
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
10. co-op: a teammate's streaks and braces read as theirs (owner tint rules as for sparks).

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
