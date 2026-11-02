# New enemies: plan

Endless rooms buy six room enemies today (swarmer, sniper, bruiser, then imp / Ooze / summoner from docs/ENEMY_VARIANTS.md),
and the seeded roster (docs/DAILY.md) shows a run about half of them by floor 10. This plan adds **five more room
archetypes**, each one a role the roster lacks and each one drawn by a 2D Demons rig that is already in
`art/vendor/demons-topdown/` and has the animation the role needs:

| Id | Role | Rig (recommended) | Why this rig |
|---|---|---|---|
| `bomber` | rusher that blows up | **Imp 5** (bare red imp) | `Explode` bursts the body into pieces; a crouched `Run` |
| `charger` | lane charge, stuns on walls | **Demon Beast 1** (blade-armed) | `Slide 1` is a low lunge; `Run`, `TakeDamage 1` for the stun |
| `stormcaller` | marks the floor, lightning strikes | **Demon Spawn 7** (dark robe, staff) | `Attack 4` lifts the staff overhead and holds it |
| `warbanner` | aura support, priority target | **Imp 3** (carries a banner) | the only banner rig; `Run Backwards` keeps the banner up while it retreats |
| `reaper` | closes in and spins a bullet spiral | **Demon Spawn 5** (two sickles) | `Taunt` frames 5-11 hold the sickles out wide (the spin); `Roll 1` |

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes live in the sim, replay, validate on the server and step in lockstep. It follows
the established patterns: a new registry band (no recorded index moves), kinds appended to `ENDLESS_ROOM_KINDS` with an
unlock floor, the per-sheet Demons pipeline for the art, port arc rows for new burst shapes, SILENT port audio IDs in
the placeholder. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before; endless
replays and scores change (all-time boards stay `_v1`; `DAILY.ruleset` 2 -> 3).

## Status (2026-11-02)

Planned. Scope chosen by the owner (below, "Decisions"): five new room archetypes (Bomber, Charger, Stormcaller,
Warbanner, Reaper), unlocking from floor 2 like the others so the seeded roster decides which a run meets. NED1-NED14
taken by the owner on 2026-11-02, every one as recommended (rigs included, so NE0's owner pick is done). NE0 audit
done and NE1 skeleton built on `ne-skeleton` (below); NE2-NE14 not started.

Contact sheets made for this plan (gitignored `art/build/contact/`, scratch PIL script, not committed; dark `#1a1619`):
`ne-imps.png`, `ne-spawns.png`, `ne-beasts.png`, `ne-elites.png` (every rig: Idle / Walk / Attack 1-4 / Taunt, the used
ones marked), `ne-strips.png` (all 15 frames of the animations named in this plan, front row), `ne-lop-heroes.png` (the
Lords of Pain warrior / knight / fighter, S facing).

## The art on hand (read 2026-11-02)

| Pack | Used today | Unused |
|---|---|---|
| 2D Demons (SmallScaleInt, 34 rigs, 8 facings, 128 px cells, 20-23 animations each) | Beast 3 `enemy.bruiser`, Elite 3 `boss.act1`, Spawn 8 `enemy.sprayer`, Spawn 10 `enemy.summoner`, Spawn 11 `enemy.caster`, Imp 9 `enemy.imp` | **28**: Imps 1-8, 10; Spawns 1-7, 9, 12, 13; Beasts 1, 2, 4, 5; Elites 1, 2, 4, 5, 6 |
| Lords of Pain (16 facings, 256 px cells) | skeleton `enemy.swarmer`, subservient `enemy.sniper`, slime `enemy.slime`, demonlord `boss.demonlord`, props | warrior / knight / fighter (idle 1 frame, walk / attack / death 8 frames; small and dark) |
| Ninja Adventure FX (CC0) | Explosion, RockSpike, Magic Aura / Boost / Circle / Shield / Spark / Spirit, Smoke, Slash, Particles | **Thunder**, Ice, Water, WaterPillar, Plant, Rock, Flam, Kunai / Shuriken |
| Ninja Adventure Audio (CC0) | (see `art/audio.json`) | Elemental `Explosion`-`Explosion6`, `Fire*`, `Fireball*`; Whoosh & Slash `Whoosh`, `Whoosh2`; Creature `Wings*`; no thunder clip |

What each pick borrows (frames counted on `ne-strips.png`; exact frame lists and marks are measured in NE9):

| Kind | idle | move | attack (wind-up / act) | extra | hit | death |
|---|---|---|---|---|---|---|
| `bomber` (Imp 5) | `Idle` | `Run` (fps ~14) | fuse: `Crouch` held, flashing | | `TakeDamage 1` | **`Explode`** (detonation; f0 whole, f1-14 gibs) / `Die 1` (fizzle) |
| `charger` (Beast 1) | `Idle` | `Walk` | lane: `Slide 1` f0-2 (rear back); charge: `Slide 1` f3-8 loop | stun: `TakeDamage 1` slowed | `TakeDamage 1` | `Die 1` |
| `stormcaller` (Spawn 7) | `Idle 16` | `Walk` | `Attack 4`: [0, mark) staff rising over the cast, [mark, 1] held on the strike | | `TakeDamage 1` | `Die 1` |
| `warbanner` (Imp 3) | `Idle` | `Walk`; `Run Backwards` while backing off | panic: `Attack 4` (banner raised f3-6, sweep f8-11) | | `TakeDamage 1` | `Die 1` |
| `reaper` (Spawn 5) | `Idle` | `Run` | wind: `Taunt` f0-4; spin: `Taunt` f5-11 looped (or `Roll 1`) | dizzy: `Idle` slowed | `TakeDamage 1` | `Die 1` |

Alternates for the owner (NED2): bomber **Imp 10** (bone-white armour; reads apart from the red Imp 9 at a glance),
charger **Beast 2** (horned, one scythe arm), stormcaller **Spawn 1** (hooded, torch staff, has Attack 5 / 6 / Attack
Run like the turrets' rig), reaper **Spawn 3** (winged, one scythe).

## What the code gives us (read on `main` @ `fa6bb8c`)

| Fact | Where | Consequence |
|---|---|---|
| Kinds number by (`band`, then `compareIds`); band 3 holds `imp` 9, `slime` 10, `slime.small` 11, `summoner` 12 | `combat/actors/registry.ts` | The new ids would sort **between** them in band 3 (`bomber` < `charger` < `imp`). They take **band 4** (`PORT_BAND_ENEMIES_2`): `bomber` 13, `charger` 14, `reaper` 15, `stormcaller` 16, `warbanner` 17 |
| `ACTOR_SCRATCH_SLOTS` = 8 (0-2 shared), so 5 free | `combat/actors/types.ts` | Each kind's state fits in v3-v7 (budgets below). The Stormcaller stores one centre and one offset, not three points |
| `contactDamage` is one static number per archetype | `actors.ts` `contactDamageOn` | The Charger's heavy hit only while charging is its own overlap check in its step (`ctx.hurtPlayerAt`), contact 0 otherwise |
| A stationary enemy bullet with its own hit radius exists (`BulletKind.GOO`, `enemyBulletHitRadius`, no grazes, guard / swing rules) | `combat/patterns.ts`, `combat.ts` | The lightning strike is a stationary bullet of a new kind `STRIKE` (12) with a short life and a large radius: no area-damage system, roll i-frames and co-op hits work as for every bullet |
| `BulletKind` takes 4 bits; 0-11 are used (web 0-6, `GOO` 7, build kinds 8-11) | `combat/payload.ts` | `STRIKE` = 12 leaves 13-15 free |
| Port arc rows: 7 @ 2.4, 8 @ hellfire, 5 @ 0.7, **8 and 12 @ FULL_RING**; **16 @ FULL_RING is a WEB row** (the turret sprayer's ring, `fixtures/arc-table.json`) | `combat/arcTablePort.ts`, `arcTable.ts` | The Bomber's blast reuses the port 12 @ FULL_RING; the Reaper's spiral reads the web 16 @ FULL_RING. **No new row**: a port row that keys like a web shape errors at load (`projectilePatterns.ts`). (NE0 correction: the plan had "one new row 16 @ FULL_RING".) |
| Walk and cooldown choke points `actorWalkPercent` / `actorCooldownPercent` (affixes today, Respite planned); `combinedPercent` | `combat/actors/actorMods.ts`, `progression/runMods.ts` | The Warbanner's aura is a third percent source here; telegraphs never go through it (EVD9) |
| `ActorFxHints` has `aimLine` (with length), `shockwave`, `ring` (one point from two v slots) | `archetypes/enemyShared.ts` | Charger lane = `aimLine`; fuse / spin = `ring` at the feet; the Stormcaller needs one new hint `strikeRow` (centre + offset slots, count 3) |
| `spendEncounterBudget` walks `ENDLESS_ROOM_KINDS` in order; `roomKindOpen(k, floor, bought, roster)` filters with no draw; `maxPerRoom` exists | `dungeon/endless.ts`, `endlessData.ts` | Kinds with `fromFloor: 2` leave floor 1's spend draw for draw as today. "Never a room's first buy" (Warbanner) is one more filter in `roomKindOpen` on `bought` |
| `rosterOrder` shuffles every kind but swarmer (5 today, 10 after) with one Fisher-Yates from the run seed; one more seeded kind every 2 floors | `dungeon/endless.ts`, `ROSTER` | Appending kinds **reshuffles every run's roster**: floor 1's seeded kind (still a sniper or a bruiser) changes for many seeds; a full roster now arrives on floor 19 instead of 9. Owner accepted early-floor change ("spread in everywhere") |
| `slamBreakables` breaks every piece within `config.slamRadius` (3 tiles, fixed) | `breakables/breakables.ts` | NE0 correction: the radius was not a parameter. NE1 added an optional trailing `radius` (absent: the boss's slam exactly), so the Bomber's 1.5 and the Charger's sweep use the existing helper |
| Kills proc builds only on `damageActor`'s kill line, never in `killActor`; but `killActor` itself scores (`scoreKill`), runs Vampire Fang, rolls drops and arms Vengeful | docs/BUILDS.md, `actors/actors.ts` | A self-detonating Bomber never procs builds, but **through `killActor` it would still score, roll a drop and fire a Vengeful ring**. NE0 correction: NE2 needs its own quiet death path (see findings) |
| First sighting: `BESTIARY_ARCHETYPES` / `BESTIARY_STRING_KEYS`, remote `bestiarySeen` | `theme/variants.ts`, `network.ts` | Five ids and five `bestiary.<id>` lines appended |
| `contract.luau` / `validate.luau` top-level locals: CLAUDE.md says 179 / 199; **counted on out/ @ `480afbe`: 185 / 196** (NE1: unchanged) | CLAUDE.md (New best) | Adding to `ENEMY_ARCHETYPES` costs no locals; any new validator report must fold into a module (NE1's `auraReport` is in `variantColors.ts`) |
| `KILL_POINTS`, `DROPS.chanceByArchetype`, `ENCOUNTER_COST` are per-id maps | `scoreData.ts`, `dropsData.ts`, `encounterCost.ts` | Data rows; no code |

## NE0 findings (2026-11-02)

Read on `new-enemies` @ `480afbe` (main @ `fa6bb8c` + this plan). Paths under `src/shared/sim/combat/` unless they
say otherwise. Every row of "What the code gives us" holds except the three corrected in the table (the 16-row is a
web row, `slamBreakables` had no radius, `killActor` scores and drops) and the locals count (185 / 196, not 179 / 199).

**Templates per kind** (copy, never import, the shape; each kind owns its file):

| Kind | Movement | Attack | Shared bits it calls |
|---|---|---|---|
| `bomber` | `swarmer.ts` `chase` (stop at `chaseStop`; `separate` optional) | fuse = `summoner.ts` telegraph + `ring` hint at the feet; blast = `ctx.fireEnemy(a, dir, BOMBER.data.blast)` (12 @ FULL_RING, `radius` 0.6 is the spawn offset) | `slamBreakables(state, x, z, radius)` (NE1 param); a quiet death (below) |
| `charger` | `sniper.ts` `reposition` (approach / back off / strafe; its v slots differ) | lane = `sniper.ts` `aimAtPlayer` with the `aimLine` hint (`length` fixed, `boldTicks` = lane); charge = `swarmer.ts` LUNGE (`moveActor` WITHOUT steer, `blocked` = moved < half the step) like `boss/demonlord.ts` CHARGE (395-406); hit = `actors.ts` `contactDamageOn`'s loop with `ctx.hurtPlayerAt(k, chargeDamage, a.kind)` per party index and a bit in v6 | `slamBreakables` every charge tick |
| `stormcaller` | `sniper.ts` `reposition` (keep 7-10, strafe flips draw like the sniper's) | cast = telegraph + `strikeRow` (centre v3-4 = target at cast start, offset v5-6 = (-dirZ, dirX) x 2.2: exact, no Pythagorean turn needed); strike = `ctx.fireEnemy(a, 0, 1, strike, px, pz)` (fireEnemy takes an origin) per open point | `imp.ts` `impBlinkValid`-style cell test (`ctx.isBlocked`, `solidCells`) per point; STRIKE rules in `combat.ts` / `weapons/melee.ts` / `ctx.ts` (GOO's exclusions, minus the guard erase) |
| `warbanner` | `summoner.ts` `keepRange` (+ centroid pull) and `backingOff` | panic = `summoner.ts` panic (`BRUISER.data.ring`, `GAP_TURNS` draw) | aura mask on `SimCtx` (`ctx.ts`) rebuilt at the start of `stepActors` (`actors.ts`); `actorMods.ts` `auraWalkPercent` / `auraCooldownPercent` bodies |
| `reaper` | `bruiser.ts` chase (closes to 3-4) | wind = telegraph + `ring` at the feet; spin volleys: rotate the aim by entry k of `arcTrig(16, FULL_RING)` and fire `spiralShot` (1 @ 0, a web row) twice, k and k + 8 (or one 2-bullet burst: 2 @ FULL_RING is in NO table, so not that) | none |

**v[] plan** (0-2 shared; NE1 constants in each file): bomber 3 `BOMBER_FUSED`; charger 3-4 `CHARGER_DIR_X/Z`, 5
`CHARGER_LEFT`, 6 `CHARGER_HIT_BITS` (7 free: a `lost` counter if wanted); stormcaller 3-4 `STORMCALLER_CENTRE_X/Z`, 5-6
`STORMCALLER_OFFSET_X/Z`, 7 `STORMCALLER_STRAFE` (no slot for a `lost` counter: it keeps range by `shouldLeash` only, or
packs the strafe sign into aiTicks' sign); warbanner 3 `WARBANNER_STRAFE`, 4 `WARBANNER_PANIC`; reaper 3
`REAPER_PHASE_TICKS`, 4 `REAPER_SPIRAL_INDEX`, 5 `REAPER_TURN`.

**Draws per attack loop** (the plan's "one documented draw per attack"): bomber 0 (the fuse is a distance test; a
first cooldown is not needed); charger 1 (cooldown); stormcaller 1 (cooldown) plus the sniper's strafe-flip draws and a
side coin in `init`; warbanner 2 per panic (cooldown, `GAP_TURNS`) plus strafe flips; reaper 2 per cast (cooldown, turn
sign). Every first cooldown drawn in `init` goes through `enemyCooldown` (EV plan change 7). No point, lane end or
blast is placed by a draw.

**Aura and the view.** No view reads a room enemy's cooldown; telegraph timelines (`view/sprites.ts` `*Attack`) read
telegraph ticks, which the aura never touches. The move loops scale by measured speed (`tickSpeed`) over `refSpeed`
(`data.speed`), so a buffed walk plays its loop 1.25x faster, as Swift already does. Nothing to fix.

**Charger vs movers and breakables.** `moveActor` without `steer` uses `config.actorMover` with `solidCells`: an intact
barrel stops the body like a wall, so a charge must `slamBreakables` around (and ahead of) itself BEFORE the move of
the tick or every barrel reads as "blocked" and stuns it. `moveActor` never clamps to the room: "room bound -> stun" is
the charger's own check (`roomAt` / the encounter's room rect of its home). Use the plain mover (no `STEER`): the steer
mover rounds pillars and would hide the block.

**Plan items that do not fit the code as written:**
1. Reaper row (above): no new arc row; NE1's spec pins the web 16-row and the port 12-row.
2. Bomber detonation: `killActor` (and `ctx.killActor`) always scores, runs Vampire Fang, rolls drops and arms
   Vengeful before `onDeath`. NE2 adds a quiet path in `actors/actors.ts` (e.g. `killActor(ctx, a, quiet)`: events and
   `onDeath` only; the score room still sees it dead), owned by the bomber agent alone.
3. `combinedPercent` is integer only for the cooldown side: Swift 75 x aura 80 = 60, Hulking 100 x 80 = 80; the walk
   side is not (Swift 135 x 125 / 100 = 168.75, Hulking 106.25). `scalePercent` takes any number, so walks are fine;
   the "integer percent" comments on `actorWalkPercent` stop being true once NE6 fills the aura (say so there).
4. Hourglass: there is no GOO-specific Hourglass rule. The enemy pool steps by `SIM_DT x scale`, so every enemy
   bullet's life (goo and strikes too) stretches under the slow; a 6-tick strike lasts ~6 / scale ticks. NE5 decides
   (a tick-counted life for STRIKE, or accept it).
5. `strikeRow` (`archetypes/enemyShared.ts`): one centre + one offset + count draws the row; NE1 added the type
   (`state`, `centreX/Z`, `offsetX/Z`, `count`, `radius`, `fillTicks`, `attack`).
6. First sighting: `shared/onboarding` `SIGHTING_IDS` must equal `BESTIARY_STRING_KEYS` (a spec), so NE1 inserted the
   five archetype ids before the affix ids there and in `view/sighting` `ARCHETYPE_SIGHTINGS` (canonical order is
   re-derived on every load, nothing stores indices). `BESTIARY_SEEN_RATE` (10 per 10 s) still covers 12 ids.

## NE1 skeleton (as built, 2026-11-02)

- Registry: `PORT_BAND_ENEMIES_2` = 4; `bomber` 13, `charger` 14, `reaper` 15, `stormcaller` 16, `warbanner` 17; every
  older index unchanged (`sim/newEnemies.spec.ts` and the id-list specs).
- `archetypes/{bomber,charger,reaper,stormcaller,warbanner}.ts`: full `data` blocks (Design tables as named fields and
  constants, `fx` hints wired to the v slots above) and stub steps: calm / leash / engage, then the bomber chases and
  the others keep their band straight along the bearing (no strafe, no attack, no draw).
- Rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype` (plan numbers). `ENDLESS_ROOM_KINDS` untouched (NE7),
  so endless rooms spend exactly as before.
- `BulletKind.STRIKE` = 12, `STRIKE_BULLET_RADIUS` 1.1 in `enemyBulletHitRadius` (no rules yet: NE5).
- `actorMods.ts`: `auraWalkPercent` / `auraCooldownPercent` (PERCENT) combined into `actorWalkPercent` /
  `actorCooldownPercent` by `combinedPercent` (the affix percent exactly).
- `slamBreakables(state, x, z, radius?)`.
- Theme: `ENEMY_ARCHETYPES` + five (placeholder cone / wedge / tall drum / thin post / flat disc; colours `#b0f0b0`,
  `#806070`, `#b0c0f0`, `#f0e0a0`, `#507060`), `enemy.<id>.name`, `bullet.enemy.strike` (flat neon disc), role
  `enemyAura` `#a86078` (`auraReport` in `variantColors.ts`: >= 3:1 on every floor, >= 40 CIE76 from the enemy-bullet
  roles, telegraph, boosts, affixes and the shield; placeholder 3.21:1, nearest boost.aegis 46.5), six SILENT sounds,
  `bestiary.<id>` lines, `l10n/context.json` entries. Vale inherits every entry from the placeholder (placeholder
  visuals, silent sounds). `contract.luau` / `validate.luau` stay at 185 / 196 top-level locals.

## Player experience

1. **Floor 1 is today's game**: swarmers plus a sniper or a bruiser (which one may differ from today for a given seed).
2. **From floor 2 a run starts drawing from eleven kinds.** Every two floors one more joins, picked by the run seed, so
   two runs meet the new enemies in different orders and the daily dungeon has its own.
3. **Bomber.** A small imp sprints straight at you. Next to you it stops, crouches and flashes under a ring the size of
   its blast; a beat later it bursts into a ring of slow bullets. Shoot it on the way in and it just falls apart.
   Lesson: kill it early or roll away from the ring.
4. **Charger.** A blade-armed beast stops, rears back, and a lane lights up between it and you. It charges down the
   lane, smashing barrels. Step aside and it slams into the wall behind you and staggers: that is your opening.
   Lesson: lead it into walls.
5. **Stormcaller.** A robed demon at the back of the room lifts its staff; three circles light up on the floor in a row
   across your path. Lightning hits all three. Lesson: keep moving, never along the row.
6. **Warbanner.** An imp with a banner stays behind the pack. Enemies near it move faster and attack more often (a
   coloured ring under the banner, a faint tint on everyone it touches). It never fights unless you corner it.
   Lesson: cut through to the banner first.
7. **Reaper.** A demon with two sickles closes in, holds its blades out, and spins: a slow spiral of bullets winds out
   around it while it drifts toward you. Then it stands there dizzy. Lesson: back off through the gaps, punish the dizzy.
8. **First sighting** (EVD10's toast): the first time an account meets each one, a line names it and its tell.

## Design

All five are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts, `walkStep` / `enemyCooldown`) and start
every attack through `ctx.telegraph`. Numbers are starting values, tuned in NE12. Speeds are units per second.

| | **Bomber** | **Charger** | **Stormcaller** |
|---|---|---|---|
| Body | 2 hp, r 0.3, 4.0, contact 0 | 12 hp, r 0.5, 2.2, contact 0 (own check while charging) | 5 hp, r 0.35, 2.4, contact 0 |
| Engaged | Steers straight at its target (the swarmer's chase, `actorSteerMover` round pillars) | Keeps 5-9 from its target with line of sight (the sniper's approach / back off) | Keeps 7-10, strafes; prefers line of sight |
| Attack | Within 1.6 of a living player: **fuse** 0.7 s (stops; `ring` at its feet, radius 2.0, filling). Then **blast**: 12 bullets @ FULL_RING (port row), slow, spawned 0.6 from its centre so point blank still hits; `slamBreakables` radius 1.5; it dies | Every 3.0-4.0 s: **lane** 0.75 s (`aimLine` at the locked heading, length = charge range); heading locks at telegraph start. **Charge**: 11 for up to 9 units; first overlap with each player hurts `HIT_HEAVY` once; breaks pieces it passes. Blocked before the end (wall, pillar, room bound) -> **stun** 1.4 s; else **recover** 0.6 s | Every 3.6-4.4 s: **cast** 1.0 s (`strikeRow`: three `ring`s, radius 1.1, centred on the target's position at cast start, spaced 2.2 along the caster -> target line turned 90 degrees). Then **strike**: one `STRIKE` bullet per point (speed 0, life 6 ticks, hit radius 1.1); a point on a wall / void / breakable cell is skipped |
| Death | Shot / cut: **fizzles** (no blast, NED4), ordinary kill. Detonated: no points, no drop roll, no build procs | ordinary | ordinary |
| Counterplay | Kill it at range; roll out of the ring | Sidestep late, lure it into walls, punish the stun | Move off the row; the strike lands where the ring is, never tracks |
| v[] (3-7) | 3 fuse flag | 3-4 heading, 5 charge distance left, 6 per-player hit bits | 3-4 centre, 5-6 offset, 7 strafe sign |
| Cost / points / drop % | 2 / 80 / 3 | 3 / 220 / 10 | 3 / 180 / 8 |
| Unlock / weight / per room | floor 2 / 2 / 4 | floor 2 / 1 / 2 | floor 2 / 1 / 2 |

| | **Warbanner** | **Reaper** |
|---|---|---|
| Body | 6 hp, r 0.35, 2.6, contact 0 | 7 hp, r 0.4, 3.0, contact `HIT_NORMAL` |
| Engaged | Keeps 5-8 from every living player, staying near its allies' centroid; backs off with `Run Backwards` | Closes to 3-4 |
| Aura | Every living room enemy (not a boss, turret, dummy or another Warbanner) within 4.5 of a living Warbanner: walk **125 %**, attack cooldowns **80 %** (through `actorMods`, `combinedPercent` with the affix percent). One aura at most (no stacking). Telegraphs, lunges and recovers never change (EVD9). Computed at the start of each `stepActors` from tick-start positions into a per-tick mask on the ctx (a pure function of hashed state, nothing new hashed) | |
| Attack | **Panic** (the summoner's): a living player within 2.5 -> 0.5 s telegraph (`Attack 4`), the bruiser's gapped ring, then it backs off | Every 3.5-4.5 s: **wind** 0.6 s (`ring` at its feet, radius 3). **Spin** 1.6 s: drifts toward its target at 1.4; every 8 ticks fires entries k and k + 8 of 16 @ FULL_RING (k += 1 per volley, turn sign drawn per cast: 12 volleys, 24 bullets), slow (4), life 1.6 s. Then **dizzy** 0.9 s (still, vulnerable) |
| Death | Aura ends that tick | ordinary |
| Counterplay | Dive the banner; the pack slows the moment it dies | Back away through the spiral's gaps; punish the dizzy |
| v[] (3-7) | 3 strafe sign, 4 panic latch | 3 phase ticks, 4 spiral index, 5 turn sign |
| Cost / points / drop % | 2 / 160 / 10 | 3 / 200 / 8 |
| Unlock / weight / per room | floor 2 / 1 / **1, never the room's first buy** | floor 2 / 1 / 2 |

Safety rules shared with the imp's blink: no strike point, charge lane end or blast is ever placed through rng beyond
the one documented draw per attack (cooldowns, the Reaper's turn sign), so the draw count never depends on the layout.
Every rule keys off the actor's aggro target (co-op: one player per attack), like the existing archetypes.

Affixes (docs/ENEMY_VARIANTS.md) apply to all five as planned spawns (NED10): a Hulking Charger, a Swift Bomber and a
Shielded Warbanner are all legal. Vengeful on a Bomber fires its ring only when it was shot (a detonation already
fired one).

## Architecture

### 1. Sim (`combat/actors/archetypes/`)

- One file per kind (`bomber.ts`, `charger.ts`, `stormcaller.ts`, `warbanner.ts`, `reaper.ts`), each a copy of the
  nearest existing shape: bomber <- swarmer (chase) + bruiser (ring), charger <- sniper (approach) + boss charge
  (`moveCircle` until blocked), stormcaller <- sniper + imp (Pythagorean turn), warbanner <- summoner (panic),
  reaper <- bruiser (approach) + a timed volley loop.
- `registry.ts`: `PORT_BAND_ENEMIES_2 = 4`; band comment updated (indices 13-17).
- `patterns.ts`: `BulletKind.STRIKE = 12`; `enemyBulletHitRadius` gains its radius; STRIKE follows GOO's exclusions
  (no grazes, no shoot cue: `events.strikes` instead) except NED7 (the guard does not erase it).
- `arcTablePort.ts`: one row `{ count: 16, spread: TAU }` (source `archetypes/reaper.ts SPIRAL`).
- `actorMods.ts`: `actorWalkPercent` / `actorCooldownPercent` combine `auraPercent(ctx, a)` (100 without a living
  Warbanner, so every existing run is a no-op: M1 and the fixtures have none). The aura mask lives on `SimCtx`, rebuilt
  each tick; specs prove it equals a recompute from state.
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype`, par costs if any.

### 2. Dungeon (`shared/dungeon`)

- `ENDLESS_ROOM_KINDS` appended (never reordered): bomber 2, charger 1, stormcaller 1, warbanner 1, reaper 1, each
  `fromFloor: 2` (`ROOM_KIND_UNLOCK_FLOOR` rows), `maxPerRoom` 4 / 2 / 2 / 1 / 2.
- `EndlessRoomKind.needsCompany` (Warbanner): `roomKindOpen` also requires `bought` total >= 1. No draw.
- `rosterOrder` reshuffles (10 seeded kinds). `roomPool.lock.spec`: floor 1 no-roster digests unchanged; the rest and
  the roster lock re-pinned. `DAILY.ruleset` 2 -> 3.

### 3. Theme contract

- `ENEMY_ARCHETYPES` += `bomber`, `charger`, `stormcaller`, `warbanner`, `reaper` (asset, colour role, `.name`);
  placeholder kinds (cone / wedge / tall cylinder / flag post / disc) and colours from the existing enemy palette.
- One colour role `enemyAura` (the Warbanner's ring and tint), checked in an existing report module (>= 40 CIE76 from
  the enemy-bullet roles, `telegraph`, the boost and affix roles).
- Bullet visual `bullet.enemy.strike`; FX `fx.enemy.strike` (Ninja Adventure Thunder), `fx.enemy.blast` (Explosion,
  tinted apart from `fx.boss.death`).
- Port audio IDs (SILENT in the placeholder): `sfx.enemy.fuse`, `sfx.enemy.blast`, `sfx.enemy.charge`,
  `sfx.enemy.stun`, `sfx.enemy.strike`, `sfx.enemy.spin`.
- Strings: five `enemy.<id>.name`, five `bestiary.<id>`, each with an `l10n/context.json` entry.

### 4. View and client

- Hints: `ring` (fuse, Reaper wind), `aimLine` with length (lane), new `strikeRow`, aura ring under the Warbanner and a
  rim tint on aura-buffed sprites (never a Highlight, EVD12), stun stars (`fx.*`).
- Second death animation for the Bomber (`Explode` when `events` says detonated, `Die 1` otherwise): an optional
  `death.2` in the enemy slot contract (`ENEMY.optionalAnimations`, like the summoner's `attack.2`).
- Optional `move.back` for the Warbanner (`Run Backwards` while its velocity points away from its facing).
- `STRIKE` drawn from the bullet renderer as a short bolt flash (the decal pool's code path, `GOO_VIEW`-like config).
- Cue mapper rows for the six sounds; `minInterval` on spin and strike.

## Tasks

- **NE0. Audit (read-only).** Confirm every row of "What the code gives us" on the branch point; count draws in the
  five planned attack loops; list every view read of raw archetype timings the aura could make wrong (EV0's list);
  check the Charger's blocked test against `actorSteerMover` and breakables; owner looks at the contact sheets and
  checks the picked rigs (NED2, taken) still hold once the frames are measured. Add this doc's row to CLAUDE.md's
  Documents table.
  **Verify:** findings written under "NE0 findings".
- **NE1. Registry, data and contract skeleton.** Band 4, five ids with stub steps (idle only), data rows,
  `BulletKind.STRIKE`, the 16 @ FULL_RING row, `ENEMY_ARCHETYPES` + placeholder + strings, `enemyAura`.
  **Verify:** indices 13-17 and every older index unchanged (registry spec); `contract.luau` / `validate.luau` compile
  under Lune within 200 locals; `npm run verify` green; every fixture, M1 and tutorial lock unchanged.
- **NE2. Bomber.** Chase, fuse, blast, fizzle, detonation rules (no points / drops / procs), breakables.
  **Verify:** specs: fuse never starts out of range; a shot Bomber never fires; a detonation scores 0 and procs nothing;
  12 bullets exactly; determinism spec pins a seed.
- **NE3. Charger.** Lane, locked heading, charge, per-player single hit, stun vs recover, breakables.
  **Verify:** specs: blocked -> stun ticks, clear -> recover ticks; one heavy hit per player per charge; never leaves
  its room's bounds; no extra draws.
- **NE4. Reaper.** Wind, spin volleys from the 16-row, dizzy.
  **Verify:** 24 bullets per spin, directions equal the arc table's; turn sign is the only draw; no arc table miss.
- **NE5. Stormcaller and `STRIKE`.** Cast, three points, skipped cells, the strike bullet and its exclusions.
  **Verify:** points never land on non-floor cells; a strike hurts once per player, respects roll i-frames, never
  grazes, survives a guard (NED7), breaks nothing.
- **NE6. Warbanner and the aura.** Keep-away, panic, aura mask, `actorMods` combination, needs-company rule.
  **Verify:** without a Warbanner every helper returns its raw value (refactor spec, like EV1's); telegraph ticks
  identical inside and outside the aura; Swift + aura combine as `combinedPercent` says; no stacking.
- **NE7. Room pool and roster.** Append the kinds, unlock floors, caps, needs-company; re-pin locks; ruleset bump;
  census of floors 2-20 x run seeds 1-60 (kinds per room, bullets alive peak, room cost), like EV5.
  **Verify:** floor 1 spends draw for draw as before without a roster; roster spec re-pinned; census table written.
- **NE8. View (placeholders).** Hints, `strikeRow`, aura ring and tint, STRIKE look, stun stars, Bomber death split,
  `move.back`, cue mapper rows.
  **Verify:** view specs (hint geometry, aura tint only on buffed actors, timing bars read the scaled cooldowns).
- **NE9. Art.** Five sets in `art/atlases.json` (the bruiser's shape: grid 128, body over `Shadows/`, `rowForFacing`,
  pad 3, 2 px rim, per-sheet cells), renderer inputs, `VARIANT_ANIM_MARKS` measured on the frames, contact sheets,
  `art:lock`, `bodyTiles` against the knight; Thunder and Explosion FX sheets.
  **Verify:** `test:art`, two `art:build`s byte-identical, older outputs unchanged, `vale.spec` cases; upload list.
- **NE10. Audio.** Candidates: `Explosion*` (blast), `Fire*` (fuse), `Whoosh` / `Whoosh2` (charge, spin), Hit & Impact
  (stun); strike has no Ninja Adventure thunder (owner's Pixabay pick, like the combo break). `audio:audition`,
  `audio:lock`, `audio:build`.
  **Verify:** `audio.lock.json` updated; vale sounds switch on only with every file's id.
- **NE11. First sighting and strings.** `BESTIARY_ARCHETYPES` += five, `bestiary.<id>` lines, l10n context.
  **Verify:** `l10n:check` and `check:autolocalize` green; toast shows once per account.
- **NE12. Tuning.** Bot / census runs: room time against par, TTK per kind, hits taken per kind, peak bullets in the
  densest room (two Reapers + a Stormcaller), weights against the old six.
  **Verify:** "NE12 tuning (as built)" table; owner calls listed.
- **NE13. Upload and Studio check.** Owner uploads (art, audio); checklist per kind (tells readable on every biome,
  aura tint, stun opening, strike flash, mobile frame time in the census's densest room).
- **NE14. Docs.** CLAUDE.md decision log entry, this doc's "as built" notes, `docs/ENEMY_VARIANTS.md` cross-link.

## Edge cases

- A Bomber reaching a downed co-op player: the fuse needs a **living** player in range.
- A Charger lane through a doorway: room bounds stop it (stun), so it never charges into the next room.
- A Stormcaller row across a corridor: wall cells skipped; a cast with all three skipped still spends its cooldown.
- A Warbanner whose room is cleared but which lives: it has no allies, so it only keeps away; the room still needs it
  dead to clear (it is a member).
- Summons and slimelets inside an aura: buffed (they are room enemies). Boss adds: never (boss floors' boss room has
  no room spawns anyway).
- Hourglass (slower bullets) and the 6-tick strike: strike life is ticks of hold, not travel; check it is not
  stretched into a lingering hazard (follow GOO's Hourglass rule).
- Hitstop / slow motion (room clear): sim-side nothing changes; the view's fuse flash follows sim ticks.

## Decisions (2026-11-02, Kaleb)

Scope:

- **New room archetypes only** (not Warden mini-bosses, a third boss or biome looks).
- **Five roles:** Bomber, Charger (melee / pressure); Stormcaller, Warbanner, Reaper (ranged / support).
- **Spread in everywhere:** every new kind unlocks on floor 2; the seeded roster decides which a run meets.

Details (taken 2026-11-02, all as recommended; the task in brackets builds it):

- **NED1. Ids and band** [NE1]: `bomber`, `charger`, `stormcaller`, `warbanner`, `reaper`, band 4
  (`PORT_BAND_ENEMIES_2`), indices 13-17.
- **NED2. Rigs** [NE9]: Imp 5, Beast 1, Spawn 7, Imp 3, Spawn 5 (alternates kept for a swap after Studio: Imp 10,
  Beast 2, Spawn 1, -, Spawn 3).
- **NED3. Unlock floor 2, weights 2 / 1 / 1 / 1 / 1 appended** [NE7]; the existing six weights never change.
- **NED4. A shot Bomber fizzles**, even mid-fuse [NE2]. Killing it is always the answer.
- **NED5. The blast is a bullet ring only** (no area hit) [NE2]: roll and guard read it like every bullet.
- **NED6. Charger heading locks at telegraph start; 1.4 s stun on a wall; it breaks pieces** [NE3].
- **NED7. Strikes are stationary `STRIKE` bullets the guard does NOT erase** [NE5]: the answer is moving, and a held
  guard would trivialise the Stormcaller.
- **NED8. Aura 125 % walk / 80 % cooldown, radius 4.5, no stacking, never a telegraph** [NE6].
- **NED9. Warbanner: 1 per room, never a room's first buy** [NE7].
- **NED10. Affixes on all five** [NE7]; revisit Swift Bomber in NE12.
- **NED11. Roster pace stays one kind every 2 floors** (full roster on floor 19) [NE7].
- **NED12. Boards stay `LB_Solo_v1` / `LB_Coop_v1`; `DAILY.ruleset` 2 -> 3** [NE7].
- **NED13. First-sighting toast for all five** [NE11].
- **NED14. Reaper spiral: 16-direction row, 2 bullets every 8 ticks for 1.6 s, at most 2 per room** [NE4].

## Risks

- **Red-imp soup.** Bomber (Imp 5), Warbanner (Imp 3) and the Imp (Imp 9) are all red imps. Mitigation: behaviour and
  silhouette (the banner, the sprint), the Bomber drawn smaller with a fuse flash, NED2's Imp 10 alternate.
- **Clutter.** Spirals, strike rows and blasts on top of today's patterns. Mitigation: caps per room, slow bullets,
  NE7's census peak, NE13's density check on a phone.
- **Aura snowball.** A Warbanner behind Swift elites. Mitigation: `combinedPercent` caps, no telegraph change, NE12
  measures room times.
- **Roster churn.** Every endless seed's roster reshuffles and daily ruleset 3 starts new day boards. Expected.
- **Locals limits** in `contract.luau` / `validate.luau`. NE1 compiles them before anything else lands.
- **Upload volume.** Five sets x (body sheets + rims) plus FX and six clips: one owner session in NE13.

## Out of scope (later plans; art noted)

- **Warden mini-bosses** (Elites 1, 2, 4, 5, 6: 6 has a tower shield, 4 has `Point`, 5 a flaming sword).
- **A third endless boss** (Elite 4 or winged Beast 4, which has `Eat`).
- **Biome look variants** of today's archetypes.
- **Shieldbearer** (Imp 8 / Spawn 12 / Spawn 9, all with `Block`) and **Leaper** (Beast 5, `Jump`): good next roles.
- Lords of Pain warrior / knight / fighter as "fallen adventurers" (small, dark; would need the outline pass).
- Changing any existing archetype, weight or unlock floor.
