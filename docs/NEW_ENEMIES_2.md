# New enemies 2: Bulwark, Chainhook, Snatcher, Pyre-keeper

Endless rooms buy eleven room enemies today (swarmer, sniper, bruiser; imp / Ooze / summoner from
docs/ENEMY_VARIANTS.md; bomber / charger / stormcaller / warbanner / reaper from docs/NEW_ENEMIES.md). They cover
rushing, sniping, slams, rings and spirals, blinks, goo, summons, explosions, lane charges, floor strikes and auras.
None of them **defends itself**, **moves the player**, **contests the room's loot** or **builds a battlefield**. This
plan adds four room archetypes (plus one child actor) that fill those gaps, each drawn by an unused 2D Demons rig
already in `art/vendor/demons-topdown/` (23 of its 34 rigs are unused today):

| Id | Role | Rig (NXD2) | Why this rig |
|---|---|---|---|
| `bulwark` | guards its front and the allies behind it; you flank it or break its guard | **Demon Spawn 9** (dark armour, curved sword, round shield) | `Block` holds the shield up; `Attack` is a shield-side swing for the bash; `TakeDamage` for the guard break |
| `chainhook` | throws a hook down a telegraphed line and drags you to it | **Demon Spawn 4** (heavy armour, chain-mesh shield, horned helm) | the chain mesh reads as "chains"; heavy build sells the yank; `Attack` / `Run Attack` for the throw |
| `snatcher` | harmless thief: eats the room's pellets and flees; kill it to get them back | **Imp 6** (small, bare-handed, horned) | the only empty-handed imp: reads as a pickpocket; `Run`, `Slide`, `Crouch walk`, `Taunt` |
| `pyrekeeper` | lights braziers around the room that fire at you; they go out when it dies | **Demon spawn 1** (hooded, torch staff) | the torch staff; `Attack` raises it for the throw; NED2's spare stormcaller rig |
| `pyre` (child) | the brazier a Pyre-keeper lights | the vale **decor brazier** art (`decor.*` `brazier`, flame + glow) | already drawn, lit and glowing in boss / entrance rooms |

Alternates kept for a swap after the Studio check: Bulwark **Imp 8** (same weapons, smaller) or **Spawn 12** (bone
armour, large shield); Chainhook **Spawn 12**; Snatcher **Imp 4** (small, dagger).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes live in the sim, replay, validate on the server and step in lockstep. It follows
docs/NEW_ENEMIES.md's patterns: a new registry band (no recorded index moves), kinds appended to `ENDLESS_ROOM_KINDS`,
the per-sheet Demons pipeline for the art, SILENT port audio IDs in the placeholder, first-sighting lines and Codex
entries. **No new hash group**: every new piece of state is actor scratch (`v[]`, hashed), a pellet's `taken` value
(hashed) or a transient per-tick list rebuilt from hashed state (the Warbanner aura's pattern). M1
(`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before; endless / daily / dev replays
and scores change (all-time boards stay `_v1`; `DAILY.ruleset` 19 -> 20, or the next free number when this lands).

## Status (2026-11-13)

**Decisions taken; NX0 and NX1 done on branch `new-enemies-2`** (from `main` @ `152553c`; "NX0 findings", "NX1
skeleton"); NX2 next. NXD1-NXD16 taken by the owner on 2026-11-13 (see Decisions): every one as recommended except
**NXD1** (the shield enemy is the **Bulwark**, id `bulwark`, not "Shieldbearer", to keep clear of the Shielded affix) and
**NXD12** (the pyre's fireballs get a **new flame bullet look** now, not the caster's). The code facts below were read on
`silver` @ `07623092`; NX0 re-checked them on the branch point (corrections in "NX0 findings").

## What the code gives us

Paths under `src/shared/` unless they say otherwise.

| Fact | Where | Consequence |
|---|---|---|
| Bands 0-5 are taken; band 5 (`PORT_BAND_FORTUNE`) holds `golden` 18 | `sim/combat/actors/registry.ts` | New band 6 `PORT_BAND_ENEMIES_3`. If `compareIds` is plain string order: `bulwark` 19, `chainhook` 20, `pyre` 21, `pyrekeeper` 22, `snatcher` 23. No older index moves |
| `ACTOR_SCRATCH_SLOTS` = 8, 0-2 shared | `sim/combat/actors/types.ts` | Each kind gets v3-v7 (budgets in Design). `ActorState` has `faceX` / `faceZ` (hashed): the shield's facing is the actor's facing, no new field |
| `damageActor(ctx, a, amount)` carries no hit origin or hit type; `filterDamage` sees only the amount | `sim/combat/actors/actors.ts` | The shield is NOT a `filterDamage`: it is tested at the hit sites, which know the origin. Three sites: the plain bullet loop and `piercingBulletHit` (`combat/combat.ts`) and the sword's `sweepArc` callbacks (`weapons/defs/sword.ts`, `weapons/melee.ts`). Effects that call `damageActor` directly (Overkill streaks, Riposte waves, Siege slams, smash procs, duos) are not stopped by the shield |
| `sweepArc` already takes a trailing `finisher` flag (docs/SECRET_ROOMS.md); `isHeavyArrow(payload, vx, vz)` exists | `combat/weapons/melee.ts`, `combat/combat.ts` | The guard break (finisher, heavy arrow) reads facts the sim already has |
| Enemy bullets test players in index order and call `ctx.hurtPlayerAt(k, damage, source)`; a rolling (i-framed) player is passed through; Phantom Step / Bastion branches sit right there; `STRIKE` shows how a kind gets its own rules in that loop | `combat/combat.ts` (~430-470) | The hook is an enemy bullet of a new kind `BulletKind.HOOK` = 13 (13-15 free): walls stop it, rolls dodge it, the sword's guard erases it (a parry, NXD8), the Hourglass slows it, the power pellet erases it, it grazes. On a hit it latches instead of hurting |
| `movePlayer(state, dx, dz, config, p)` moves a player through `config.moveResolver` (wall slide included) in sub-steps; exported for the sword's lunge | `sim/player.ts` | The drag reuses it: walls, pillars and pieces stop the pull exactly as they stop walking. No new mover. **No actor moves a player today**: NX0 audits the order (stepPlayer runs before stepCombat) |
| Local prediction mirrors `stepPlayer`'s motion (`predictMotion.ts`, pinned by `predictMotion.spec.ts`); any sim change to player motion must update the mirror | docs/LOCAL_PREDICTION.md | The drag does NOT go into `stepPlayer`, so the mirror and its parity spec are untouched. The view instead **suspends prediction while the local player is hooked** (merged state says so): see Architecture 4 |
| Pellets: `PelletsState.taken[k]` 0 / 1 (hashed), `PelletRoom.left` counts regular pellets not taken; Sweep = `left === 0 && count > 0` at the clear; `stepPellets` skips `taken !== 0` | `sim/pellets/` | A stolen pellet is `taken = 2` (carried), a digested one `taken = 3` (gone). Neither decrements `left`, so a digested pellet makes the room's Sweep impossible (NXD11) and a returned one (`taken = 0`) is collectable again. Without a Snatcher no pellet ever holds 2 or 3, so every hash is unchanged |
| Pellets are placed after the Forge (`placePellets`, off planned spawns); room spending runs before it | `shared/dungeon` | The room spender cannot know whether a room has pellets. A Snatcher with nothing to steal just flees (NXD10: no boost stealing in v1) |
| `fleeField` (allocation-free flee field over a room box) is shared/dungeon; the Goldling uses it through `goldenField` | `sim/golden/goldenField.ts` | The Snatcher flees on the same function, with its own cache per room (one Snatcher per room, NXD9) |
| Summoner: tracks its summons' ids in v slots, an alive cap and a per-life cap; `wither` kills them at its death; `adoptScoreRoomMember` keeps a room open for runtime children | `archetypes/summoner.ts`, `sim/score/score.ts` | The Pyre-keeper copies the shape for its braziers, but braziers are **not** adopted as members (NXD13: the room clears on the keeper and members; braziers wither) |
| `ENDLESS_ROOM_KINDS` (11 rows), `roomKindOpen(k, floor, bought, total, roster, unlockFloors)`, `maxPerRoom`, `needsCompany`; the roster shuffles every kind but the swarmer from the run seed, one more per floor (`ROSTER.floorsPerKind` 1, DSD18), unlock floors ignored in every world (DSD17 / DSD18) | `dungeon/endlessData.ts`, `dungeon/endless.ts` | Appending four rows reshuffles **every** run's roster (14 seeded kinds, full on floor 14). With unlock floors ignored, any new kind could be floor 1's seeded kind: NXD4 keeps the Chainhook off floor 1 with a minimum floor the spender always honours |
| Codex enemy entries are built from `ENDLESS_ROOM_KINDS` in order, then `enemy:golden`; the catalogue has an append-only order lock (`codex/catalog.spec`) | `codex/catalog.ts` | Appending to `ENDLESS_ROOM_KINDS` would insert four entries before `enemy:golden` and every later entry, breaking the lock. NXD14: the catalogue builder takes the four new kinds from a second list and appends their entries after `secret:room`. `pyre` folds into `enemy:pyrekeeper` like slimelets into `enemy:slime` |
| `enemyBulletLookOf` picks an enemy bullet's look per archetype (sniper needle / caster medium / boss large / else small); enemy bullet art must stay in the danger pink (means <= 12 CIE76 from `enemyBullet`, >= 3:1 on every floor and wall; `bulletArtReport`) | docs/PROJECTILE_ART.md, `shared/view/bullets` | NXD12: a new look `flame` for the pyre's fireballs, recoloured into the danger pink like the other enemy looks |
| `contract.luau` / `validate.luau` top-level locals 187 / 197 (CLAUDE.md, counted on out/) | CLAUDE.md (Codex) | Appending to `ENEMY_ARCHETYPES`, strings and `PORT_AUDIO_EVENTS` costs no locals; any new validator report folds into an existing module |
| `PORT_AUDIO_EVENTS` tail is pinned by `codex.spec` and skipped in a list of specs (fortune / treasure / runRecap / boosts / audio / contract / floorModifiers) | CLAUDE.md (Codex, Secret rooms) | New sounds are appended after `sfx.jingle.secret`; NX1 updates `codex.spec`'s tail and those skips |
| vale has a `brazier` decor piece (art, flame `glowAt`, glow, light pool) | `theme/packs/vale/manifest.ts`, `layout.ts` | `enemy.pyre` can point at the brazier's art; NX0 confirms the enemy slot accepts a one-facing world image or the brazier needs a one-facing sprite set |

## NX0 findings (2026-11-13)

Read on `new-enemies-2` @ `6ae9fcb` (main @ `152553c` + this plan). Paths under `src/shared/` unless they say
otherwise. Every row of "What the code gives us" holds except the corrections below. Skipped: the rigs' contact sheet
(no `art/vendor/` in this workspace): NX8 makes it.

**NX0 corrections** (the build follows these, not the rows above):

1. **`enemyShield` is taken.** It is the Shielded affix's shield segment (COLOR_ROLES, `AFFIX_COLOR_RULES`, the health
   bar's shield row, the shield-hit flash). The guard gets its own role **`enemyGuard`** (theme `newEnemies2.ts`
   ENEMY_GUARD_ROLE), held by `guardReport` (`variantColors.ts` GUARD_COLOR_RULES): >= 3:1 on every biome floor, >= 40
   CIE76 from the enemy-bullet roles, `enemyGoo`, `telegraph`, `enemyOutline`, the four affix rings, `enemyShield` and
   the four boosts. A Shielded Bulwark shows both.
2. **A second "Bulwark".** Warding's evolution is already shown as "Bulwark" (`boon.warding.evo.name`: draft, items row,
   Codex). Ids do not clash (`enemy.bulwark` vs `boon.warding.evo`; the sim's `bulwarkPending` is a builds field), but
   players see two Bulwarks, in the Codex too. Owner call OC1 below; NX1 ships "Bulwark" as NXD1 says.
3. **Indices** as guessed: `compareIds` is byte order, a prefix first: bulwark 19, chainhook 20, pyre 21, pyrekeeper
   22, snatcher 23.
4. **v[] budgets** do not fit the shapes they copy. Phase / drag / swallow ticks are the state's own `aiTicks` (every
   state counts it; `ctx.telegraph` sets it), which frees slots:
   - Bulwark: the bruiser's approach needs a lost counter. v3 lost, v4 hit bits, v5 guarding, v6-7 the bash heading
     locked at the telegraph (the `aimLine` hint reads a v-slot direction; the facing turns, so not faceX / faceZ).
   - Chainhook: the sniper's reposition needs a lost counter and a strafe side. v3-4 heading, v5 hooked + 1, v6 shared
     by state (lost ticks while keeping range, damage since the latch while dragging), v7 strafe.
   - Snatcher: v3 carried, v4 ticks since the first steal, v6 fleeing (v5, v7 free).
   - Pyre-keeper: the light's `ring` hint needs the landing point in two slots (`xSlot` / `zSlot`); 3 pyre ids + lit +
     panic leave none. The keeper keeps no pyre ids: each pyre's v4 (`PYRE_KEEPER`) names its keeper's actor id (ids
     are never reused in a run, `nextActorId`), so the alive cap, the stagger index and the wither scan the pool (at a
     cast decision and at death only). Keeper: v3 lit this life, v4-5 landing point, v6 strafe (the summoner's
     keepRange strafes), v7 panic latch.
5. **The flame look is per BulletKind, not per archetype.** `enemyBulletLookOf` (`view/bullets/looks.ts`) reads the
   payload's kind (SNIPER needle, CASTER medium, BOSS large, else small). The pyre fires BulletKind.ENEMY; NX7 maps it by
   the payload's `source` (archetype index + 1, stamped by `ctx.fireEnemy`) to a new `EnemyBulletLook` FLAME, so no
   BulletKind is spent (14-15 stay free). NX1: `bullet.enemy.flame` is a contract id and a placeholder only.
6. **The brazier in the enemy slot.** vale's `brazier` (`packs/vale/layout.ts`) is a one-facing `sprites` set in
   `decor-atlas.png` (cell 592 idle, 593-600 `lit`, 27 x 37, pivot (16, 35), 29.6 px a tile) with `glow` / `glowAt`. The
   ENEMY slot takes one-facing sets (the dummy) but requires `idle` / `move` / `attack` / `hit` / `death`, and `glow` /
   `glowAt` are decor-only. NX8: an `enemy.pyre` set on the same sheet and cells, every required animation aliased
   (idle / move / attack / hit = the 8 `lit` cells, death = the unlit 592; the turrets' alias pattern): no new pixels,
   no repack. No rim (decor-atlas has no outline sheet; it draws rimless) unless NX8 bakes one; the flame glow and light
   pool are the view's (NX7), not the slot's.
7. **The pyre has no ENCOUNTER_COST row** (like `slime.small`: costs buy spawns and size a room's par; a pyre is
   neither) and no 0 % drop row: it goes into `DROP_INELIGIBLE_ARCHETYPES` (`sim/drops/dropsData.ts`). A 0 % kill still
   counts as a dry kill (`killsSinceDrop`) and could trip the pity; an ineligible kill skips both.
8. `isHeavyArrow` lives in `sim/builds/duos.ts` (combat.ts imports it), not combat.ts.
9. **Effect bullets hit through the same loops.** BURST / SHARD / SPARK_BOLT / EMBER (BulletKind 8-11) are player
   bullets: the two loops see them, so the shield blocks them unless NX2 says otherwise. Recommend (OC2): block every
   moving player bullet (Mirror Cloak's reflections included: BulletKind.PLAYER), let EMBER (speed 0, a flame under its
   feet) through.
10. **The roster can still put the Chainhook on floor 1** (NXD4). `roomKindOpen` (`dungeon/endless.ts`) is a pure gate
    in both spender loops, so a `ROOM_KIND_MIN_FLOOR` test there closes it below floor 2 in every world with no draw and
    no change for any other kind. But with unlock floors off, `endlessRoster` may make the Chainhook floor 1's ONE seeded
    kind (about 1 run in 13), leaving floor 1 swarmers only. NX6 honours the minimum in `endlessRoster`'s join scan too
    (the next kind of `rosterOrder` at or past its minimum; the order is one shuffle, so no draw moves): floor 1 always
    has a seeded kind and the Chainhook joins on floor 2.

**`damageActor` callers and the shield** (NX2):

| Caller | Hit origin | Shield |
|---|---|---|
| `combat/combat.ts` plain player-bullet loop | the bullet | blocks (consumed); a heavy arrow breaks the guard |
| `combat/combat.ts` `piercingBulletHit` | the bullet | stops it (pierce ends there, the actors behind untouched); heavy breaks; a blocked Siege arrow never pins (`siegeTryPin` follows the hit) |
| `combat/weapons/defs/sword.ts` `hitSwing` / `hitFinisher` (sweepArc callbacks) | the swinging player (sweepArc's x, z) | a swing does nothing to it; the finisher breaks (sweepArc's `finisher` flag already exists) |
| `builds/siege.ts` slam, the pinned actor | none (the wall's) | no |
| `builds/siege.ts` slam, the shockwave | the slam point | breaks the guard (NXD7) |
| `builds/onKill.ts` (sparks, forks, Overkill streak), `duos.ts` (Conductor, Thunder Guard), `riposte.ts`, `smash.ts`, `fullHeart.ts` | none | no (the plan's "not from anywhere") |
| `weapons/defs/testMelee.ts` | specs only | n/a |

**The shield's transient list** is built once right after stepActors (end of stepCombat phase 2), not at the start of
the bullet phase: the sword's sweep (phase 4) and the Siege slam (5b `stepPins`, 6) read it too. A pure function of the
hashed pool after the actor step, like `SimCtx.rebuildAura` / `rebuildPins`.

**`PelletsState.taken` readers.** Every one treats `!== 0` as off the floor, so 2 / 3 need no change there:
`sim/pellets/pellets.ts` (reset, fill with 0, clone, hash: the value as is), `sim/pellets/stepPellets.ts` (pickups skip
`!== 0`, set 1; the power pellet's erase reads no `taken`), `view/pellets/pellets.ts` (the drawn look and
`livePowerPellet` skip `!== 0`: a carried pellet is hidden, as the plan wants), `run/testing/tutorialBot.ts` (`=== 0`
targets; no Snatcher in the tutorial). `sim/pellets/pelletRooms.ts` judges the Sweep on `left` / `count` only, so a
digested pellet loses it (NXD11) and a returned one is collectable again. View events come from the sim's `eaten` /
`power` lists, not `taken`. What 2 / 3 do touch, through `left`: `view/pellets/pellets.ts`'s last-few hint (`left` in
(0, lastFewHint]) would point at pellets in a belly and stay lit after a swallow, and the chomp ladder (`count - left`):
NX7 counts pellets on the floor (taken 0) for the hint.

**Emitter -> actor.** No index exists. Every actor takes a fresh emitter id at spawn (`acquireEmitter`: monotonic; a
freed actor's id is never reissued), and the enemy pool's visitor already gets `emitter` as its 4th argument
(`BulletVisitor`; `enemyBulletHit` / `enemyBulletHitParty` ignore it today: NX3 adds the parameter). A HOOK hit scans the
actor slots for `emitterId === emitter`, kind chainhook, alive (a hook from a dead or freed thrower latches nothing).
Only on a HOOK hit, so a normal tick pays nothing.

**The drag in the tick.** stepPlayer (prevX = x, walk, roll) for every player, then stepCombat: 2 stepActors (the
drag) -> 4 weapons (the sword's lunge, the other `movePlayer` from inside combat) -> 5 bullet steps -> 6 collisions -> 7
contact; then run / pacts / drops / pellets / score / treasure / golden. So the drag: lands after prevX (drawn
interpolated, like the lunge); is seen by everything after it at the dragged position (bullets, contact, pickups, room
entry, the stairs); runs in actor slot order inside stepActors on every client (state is hashed after the tick, so no
new order for co-op; actors earlier in the slot order saw the undragged player, later ones the dragged one, the same
everywhere); reads this tick's own walk and a roll pressed this tick (stepPlayer ran first), so "walking away slows it"
and "a roll breaks it" hold at once. `movePlayer(state, dx, dz, ctx.config, p)` uses the floor's world config and
`solidCells` (the sword does the same). The one difference from the lunge: `lockstep/predictMotion.ts` mirrors the lunge
(the local player's own input) but cannot mirror a drag, so the view suspends prediction (Architecture 4) and the mirror
and its parity spec stay untouched.

**The hook in the enemy loops** gets most rules for free: walls and intact pieces (it is not `quiet`), grazes,
Bastion's roll count, Phantom Step's erase, the guard erase (`bulletInArc` exempts only STRIKE; a guard counts it in
`deleted`, the parry feed), the power pellet (`eraseVisit` exempts GOO / STRIKE only), the Hourglass (the pool's step
scale). Mirror Cloak reflects it as a plain player bullet (NX11 note). The latch branch goes before `ctx.hurtPlayer`
(solo) and `ctx.hurtPlayerAt` (co-op). `playerHittable(k)`: `isPlayerInvulnerable` (dead, roll i-frames, post-hit
`hurtTicks`) and not hooked; NX3 decides dev god mode (`devBlocksHit`; a drag hurts nothing).

**Horde (NXD9).** `sim/pacts/stepPacts.ts` `telegraphWave`: wave 2 = the first `hordeMaxWave` of
`world.roomSpawns[h.room]` in order, through `safeRoomSpawns`. NX4 skips `snatcher` there and counts the cap over the
kept entries (its own counter, not `k`): no draw either way, and a room without a Snatcher builds the same wave.

**Codex.** `codex/catalog.ts` builds `enemy:` entries from ENDLESS_ROOM_KINDS order, then `enemy:golden` (confirmed):
NXD14's second list lands with NX6 / NX9.

**Sightings now, Codex later.** BESTIARY_STRING_KEYS must equal shared/onboarding SIGHTING_IDS (a spec), so NX1's four
`bestiary.<id>` lines bring their sighting ids (before the affix ids, NE1's rule) and `view/sighting`
ARCHETYPE_SIGHTINGS maps the four plus `pyre` -> `pyrekeeper` (as slimelets read as the Ooze). Until NX9 adds their
Codex entries, `seedFromSightings` / `codexSightingId` drop an id the catalogue lacks (`isCodexId`), so a sighting claims
nothing; and nothing can be sighted before NX6 buys them.

**Owner calls:** OC1 the two Bulwarks (enemy and Warding's evolution): keep both, or rename one display name (ids stay).
OC2 the shield against effect bullets (recommended above).

## NX1 skeleton (as built, 2026-11-13)

- Registry: `PORT_BAND_ENEMIES_3` = 6; `bulwark` 19, `chainhook` 20, `pyre` 21, `pyrekeeper` 22, `snatcher` 23; every
  older index unchanged (`sim/newEnemies2.spec.ts` and the id-list specs: actors, demonlord, dummy, encounterRun,
  enemyVariants, newEnemies).
- `archetypes/{bulwark,chainhook,snatcher,pyrekeeper,pyre}.ts`: full `data` blocks (the Design tables as named fields
  and constants, the v slots of NX0 correction 4, `fx` hints: the Bulwark's bash and the Chainhook's throw `aimLine`, the
  yank `ring`, the light `ring` on v[`PYREKEEPER_LAND_*`]) and stub steps: calm / leash / engage, then the Bulwark,
  Chainhook and Pyre-keeper keep their band straight along the bearing (facing at once: no turn limit yet), the
  Snatcher walks straight away inside fleeRadius, the brazier stands. No attack, no shield, no hook rule, no draw (a
  spec checks the rng word). The Bulwark's bash lunge time is a starting value of NX1's (`bashLungeTicks` 9, 0.15 s;
  the plan gives the distance only). The Chainhook's `yankFan` is the imp's spec object; the Pyre-keeper's panic ring
  the bruiser's.
- Rows: `ENCOUNTER_COST` (bulwark 3, chainhook 3, snatcher 2, pyrekeeper 3; no row for `pyre`), `KILL_POINTS` (200 /
  200 / 150 / 180, pyre 30), `DROPS.chanceByArchetype` (8 / 8 / 15 / 8; `pyre` in `DROP_INELIGIBLE_ARCHETYPES`).
  `ENDLESS_ROOM_KINDS` untouched (NX6): endless rooms spend exactly as before, no replay or hash moves.
- `BulletKind.HOOK` = 13 (14-15 free), the enemy bullet's hit radius (no row); no rules yet (NX3).
- Theme: `ENEMY_ARCHETYPES` + five (placeholders: a broad Block slab, a squat Cylinder drum, the smallest Cone, a slim
  Capsule robe, a low Cylinder bowl; colours `#a8a898`, `#58d8f8`, `#f8b8a8`, `#883868`, `#585808`, >= 26.6 CIE76 from
  every other enemy colour, the boss accent and the player outline, >= 40 from the danger roles; names Bulwark,
  Chainhook, Snatcher, Pyre-keeper, Brazier); `bullet.enemy.hook` (a neon Wedge) and `bullet.enemy.flame` (the small
  ball; not mapped to the pyre yet: NX7) after `bullet.enemy.strike`; role `enemyGuard` `#949c6c` (a dull bronze;
  `guardReport` in `variantColors.ts`: lowest floor 5.04:1, nearest `affix.hulking` 45.2); the eight SILENT sounds last
  in PORT_AUDIO_EVENTS (`newEnemies2.ts` NEW_ENEMY_2_AUDIO_IDS) with `shared/view/audio` SFX entries, ALL_SFX /
  PORT_SFX, `SFX_PRIORITY` (block 32, guard break 47, throw 44, latch 54, snatch 36, swallow 60, return 52, light 43),
  `SFX_MIN_INTERVAL` (block 0.08 s, snatch 0.1 s) and the plan's one-step `SFX_FALLBACK`s (the snatch's "pitched down"
  is a cue speed for NX7); no `art/audio.json` entries yet (NX10). `bestiary.<id>` for the four (in the archetypes'
  block, before the affixes) with their shared/onboarding sighting ids and `view/sighting` ARCHETYPE_SIGHTINGS (`pyre`
  reads as `pyrekeeper`), so the first-sighting wiring is done; their Codex entries are NX9. `l10n/context.json`
  entries for the nine strings. Vale inherits every entry from the placeholder.
- Tail / count specs updated for the eight sounds (codex, secrets, fortune, treasure, runRecap, boosts, audio,
  contract, floorModifiers, view/audio goldenRumourCues), the five archetypes (newEnemies, fortune, enemyVariants,
  contract), the two bullet ids (enemyVariants) and the four bestiary lines (enemyVariants, fortune); boosts.spec's
  planted dim green counts only its own errors (the guard is 31.7 CIE76 from it).
- `contract.luau` / `validate.luau` top-level locals 187 / 197, unchanged (counted on out/).

## As built

### NX2 Bulwark (as built, 2026-11-14)

- `archetypes/bulwark.ts`: the bruiser's approach (lost counter, STEER walk at the target out of sight) and keep range
  2-3 along the bearing; the facing turns by `turnFacing` (one literal (turnCos, turnSin) rotation through
  `rotateDir`, a snap within 2.5 degrees; engaged only: a calm Bulwark still snaps to "watching" in `stepCalm`). Bash:
  cooldown out + sight + within 1.8 -> heading locked in v6-7, the next cooldown drawn (the bash's one draw; the first in
  `init`), telegraph 27 ticks (the facing turns toward the heading), the lunge from the telegraph's last tick (the
  Charger's lane rule) 1.4 over 9 ticks on the plain mover (never scaled), one `HIT_NORMAL` per player per bash (the
  bit set on the first overlap, landed or not), then recover 36 ticks with v5 0. `bulwarkGuardBreak`: engaged if calm,
  stagger 90 ticks, v5 0, attack 0 (a telegraphed bash is cancelled; its drawn cooldown stands). A leash raises v5 again.
- `combat/shield.ts` (new): the guard list `SimCtx.guards` (slots of living Bulwarks with v5 1 that no Siege pin holds),
  built by `guardSlots` right after stepActors / stepAffixes, emptied by `bind`; every test re-reads alive and v5, so a
  guard broken or a Bulwark killed earlier in the tick stops blocking at once. Empty list: every caller returns first.
  - Bullets (`playerBulletHit`, after pieces and the Siege slam check, before the plain and piercing walks): any kind but
    EMBER, within max(coverRadius 1.0, body + bullet radius) of the centre, inside the front cone **and heading into the
    shield** (velocity . face < 0; deviation: a bullet that pierced its back and leaves through the front, or one fired
    from behind, is not stopped). Consumed; a heavy arrow (`isHeavyArrow`, Ballista's included) breaks instead of a
    block. With Ballista the stop is a wall (`buildsOnHeavyEnd(..., true)`: the back fan; a carrying Siege arrow slams
    there). A blocked Siege arrow never reaches `siegeTryPin`. Edge: a bullet in the cover zone that also overlaps an
    actor standing right in front of the shield is stopped by the shield.
  - Melee (`sword.ts` hitSwing / hitFinisher, origin = the swinging player): a swing blocks (event at the shield's
    front point), a finisher breaks. The guard sweep has no actor callback (unchanged).
  - Siege slam (`siege.ts`, the shockwave only, origin = the slam point): from in front it breaks and deals nothing; the
    pinned actor is never in the list.
  - A breaking hit deals **nothing** (it is the blocked hit; the stagger opens the next ones). A block or break engages a
    calm Bulwark. Wrecker rolls need no rule (rolls never hit enemies).
- Feed (unhashed): `SimEvents.shieldBlocks` / `guardBreaks` (`NEW_ENEMY_2_EVENT_FIELDS`, after `NEW_ENEMY_EVENT_FIELDS`
  in `ALL_EVENT_FIELDS`) and `CombatState.guardEvents` (`blockX` / `blockZ` / `blockSlot`, `breakSlot`; not in
  `writeCombatHash`, copied by `cloneCombatState`, cleared by `step` / `stepParty` beside `clearEvents`).
- Specs: `sim/bulwark.spec.ts` (21: front / back / cover / pierce / kinds / heading, 200 and 240 deg/s get behind, 120
  never leaves the cone, 72 turn steps for 180 degrees, finisher / heavy arrow / Siege shockwave break, back shock
  damages, blocked Siege arrow never pins, Wrecker roll does not, bash timings and one hit per player solo and co-op,
  draws, a determinism pair); `newEnemies2.spec`'s no-draw case now allows the Bulwark's init draw; `combat.spec`'s
  hash-coverage walk skips `guardEvents` (an unhashed feed); `warbanner.spec`'s aura-target list gains NX1's four room
  enemies (it failed since NX1, the Design's "the Warbanner's aura applies"). No hash, replay or
  fixture moves: no recorded run spawns a Bulwark (not in `ENDLESS_ROOM_KINDS` until NX6).
- Owner calls: OC1 (two Bulwarks) open; **OC3** a breaking hit deals 0 (built) or its full damage too; **OC4** Swift /
  the Warbanner aura do not speed the turn (built: the turn is a literal).

### NX4 Snatcher (as built, 2026-11-14)

- `archetypes/snatcher.ts`: steal / flee / swallow / return as Design says, no draw on any stream (spec). Rules in the
  file comment. Its pellets are its own score record's (`snatchRecordOf`: the record holding its slot and id, the
  corpse's at death), only while that room's pellets are LIVE. Eats on contact (`eatRadius` = the pickup reach) in both
  STEAL and FLEE, index order, up to the stomach. The swallow check runs before the flee, so a full belly stands still
  even with a player beside it. Phase ticks are `aiTicks` (`ctx.telegraph`), v3 carried, v4 belly ticks, v6 fleeing
  (NX0 correction 4; v5 / v7 free).
- `sim/pellets` `pelletsData.ts`: `PELLET_STOLEN` 2, `PELLET_DIGESTED` 3, `SNATCHER_KIND`; `snatch.ts` (a leaf):
  `snatchRecordOf`, `pelletStealable`, `pelletsNearestLive` (ties to the lower index, never the power pellet),
  `pelletsSteal`, `pelletsCarried`, `pelletsDigest(rec)`, `pelletsReturn(rec)`. None touches `left` (NXD11).
  `PelletEvents` gains unhashed `stolen` {index, x, z}, `returned` {index, fromX, fromZ} (the corpse) and `swallowed`
  {x, z, indices}; cleared and cloned with the rest.
- Flee field `archetypes/snatcherField.ts`: `fleeField` over the room's floor rectangle (`roomGridRect`), open = not
  `isBodyBlocked` and no intact piece; sources = living players within `SNATCHER_SOURCE_MARGIN_CELLS` 2 of the box,
  clamped onto it. Read fresh each fleeing tick from hashed state (no v slot for a field tick); the cache is a memo per
  encounter room id keyed on everything it reads (room, world config, pieces + intact, factor, sources), so clones and
  replays get the field they would build from scratch (spec). Allocates only for a new room id or a bigger box.
  Fallback to walking straight away (steer mover) when it stands outside the rectangle, on an unreached cell (no player
  near the room on an open cell) or in no room (the NX1 sandbox).
- Horde (NXD9): `stepPacts.ts` `telegraphWave` skips `SNATCHER_KIND` and caps over the kept entries (a while loop, the
  same entries as before without one; spec: 5 planned with a Snatcher -> 4, 12 with a Snatcher first -> 10).
- Specs `sim/snatcher.spec.ts` (an endless floor-1 room's planned spawns replaced by a Snatcher and a dummy).
- **Deviation:** it leashes only when every player is dead (no distance leash): its walks stay in its room by
  construction, and the 16-unit leash cut flights short in doubled endless rooms.
- **Not built / limits:** a Snatcher freed without dying (a floor change) returns nothing (the floor's pellets are
  replaced anyway). Two Snatchers in one room (not possible after NX6's cap) would share the record's carried pellets.
- **Owner call (NX4):** a Snatcher killed as the room's LAST member returns its pellets on the clear tick, so they go with
  the room before anyone can pick them up and the Sweep is lost (the clear judges `left`). Kill it first (the lesson) or
  change the rule (e.g. the clear waits for returned pellets, or they count as picked up by the killer).

### NX5 Pyre-keeper (as built, 2026-11-14)

- `archetypes/pyrekeeper.ts`: the summoner's keep range (6-9 from its target, the nearest living player; strafe flips
  on a wall and every 0.8-2.2 s in aiTicks) and panic (target in sight within 2.5 as the cooldown runs out: 0.5 s
  telegraph, the bruiser's gapped ring, 0.8 s back-off; v7 latched from the telegraph to the end of the back-off).
  Light decision: **two draws at every decision** (cooldown, start index 0..7), also when capped or when no cell is
  valid, so the count never depends on its pyres or the layout (the summoner's rule). It casts with < 3 of its pyres
  alive and < 6 lit this life (v3): `pyrekeeperLanding` takes the first valid compass point from the start index around
  its target, snapped to the cell centre (v4-5): FLOOR (`isBodyBlocked`: no wall / void / pool / solid decor), no intact
  piece, no pellet in play (taken 0 or a Snatcher's PELLET_STOLEN), the room holding its home (the imp's blink rule,
  encounter boxes), >= 2 from every living player and from its living pyres. None valid: spent, no telegraph, nothing
  lit. Else 0.8 s telegraph (attack LIGHT, the `ring` hint), then `lightPyre` spawns the pyre (not re-validated: actors
  block nothing); a full pool costs nothing (not lit). Its pyres are a pool scan (`v[PYRE_KEEPER] === id`) at a
  decision, a spawn and its death. Killed mid-telegraph: no pyre, `attack` cleared.
- `archetypes/pyre.ts`: not a room enemy, no draws. aiTicks counts the 0.5 s lighting (0 = lit, the view's flag; no
  spawnTick arithmetic, so a pacts freeze needs nothing in `holdAbsoluteTimers`), v3 the ticks to the next shot; at 0 it
  fires `shot` at `pyreTarget` (the nearest living player in sight, index order on ties) and reloads 2.0 s even with
  no one in sight (the shot skipped, the phase kept). Never affixed (runtime spawn), never a member, no drop roll
  (ineligible: no pity count), 30 points.
- Wither: the keeper's onDeath kills every living pyre naming it through `ctx.killActor` (the summoner's `wither`:
  scored, combo fed, no drop). No separate room-clear hook: the keeper is a member of its record, so the record cannot
  clear before it dies, and its death withers them earlier in the same tick (before stepScore). A pyre with no keeper
  (spec / sandbox only) never withers.
- Feed (unhashed): `SimEvents.pyresLanded` / `pyresWithered` (appended to `NEW_ENEMY_2_EVENT_FIELDS`).
- Specs `sim/pyrekeeper.spec.ts` (15: draws, caps, telegraph, mid-telegraph death, clearances solo and co-op, fire
  timing, targeting, stagger, wither of its own only, an endless-floor landing census against a written-out oracle
  (4 seeds x 40 casts: every landing the first valid point, rejections by tile / piece / pellet / room / clearance all
  seen), the room clearing with a stray pyre alive, no drop / no affix, a determinism pair). `newEnemies2.spec`'s
  no-draw case drops the keeper (it draws since NX5). No hash, replay or fixture moves: nothing recorded spawns a
  Pyre-keeper (not in `ENDLESS_ROOM_KINDS` until NX6).
- **Deviations:** (1) the stagger. "0.6 s x its index" from landing does not keep shots apart (casts are 4.8-5.8 s
  apart, so phases land anywhere on the 2 s period). Built: a pyre takes the lowest free stagger slot 0..2 (v5
  `PYRE_STAGGER`) and its first shot (>= the 0.5 s lighting) is aligned on a living sibling's period at 0.6 s x the slot
  difference, so a keeper's pyres fire 0.6 / 0.6 / 0.8 s apart and never together (spec); without siblings it fires on
  the tick it lights. A pinned (Siege) pyre does not step and drifts. (2) No strafe coin in init (the side from the
  actor id), so init draws once as specified; flips and the panic draw as the summoner's. (3) A spent cast shows no
  telegraph.
- **Owner calls (NX5):** PK1 withered pyres score 30 each and feed the combo (built, the summoner's precedent) or go
  out quietly (`killActor(..., true)`); PK2 the first shot on the tick a lone pyre lights (built) or a full 2 s later.

## Player experience

1. **Bulwark.** An armoured demon walks at you behind a round shield. Arrows and sword cuts that hit the shield spark
   off; so do arrows aimed at the sniper standing behind it. It turns to keep the shield on you, but slowly: step round
   it, or let a teammate take its back. When you get close it shoves the shield into you; after the shove the shield is
   down for a moment. A sword finisher, a charged arrow or a Siege slam knocks the guard open and it staggers.
   Lesson: flank it, or break the guard.
2. **Chainhook.** A heavy demon plants its feet and a line lights up from it to you. A hook flies down the line. If it
   catches you, a chain snaps taut and drags you across the floor to its feet, where it swings. Roll the throw, cut
   the hook out of the air with a guard, or roll mid-drag to break free. A teammate can free you by hitting it. It
   never appears on floor 1.
   Lesson: roll the line, and never let it pull you into a Bomber.
3. **Snatcher.** A small bare-handed imp darts out and starts eating the floor's pellets, fleeing from anyone who comes
   near. Its belly glows with what it carries. Kill it and the pellets pop back into place. Let it fill up and it
   swallows: those pellets are gone, and so is the room's Sweep. It never hurts you.
   Lesson: kill the thief first if you want the Sweep.
4. **Pyre-keeper.** A hooded demon with a torch staff hangs back and throws torches; where each lands a brazier flares
   up and starts lobbing fireballs at you. Three of them make a crossfire. Snuff a brazier, or kill the keeper and
   every one of its braziers goes out at once.
   Lesson: kill the keeper, not the fires.
5. **First sighting** (EVD10's toast) and a Codex entry for each of the four.

## Design

All four are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts, `walkStep` / `enemyCooldown`, the
Warbanner's aura and the affixes apply) and start every attack through `ctx.telegraph`. Numbers are starting values,
tuned in NX12. Speeds are units per second; angles are given as cosines (literals, no trig in the sim).

### Bulwark

| | |
|---|---|
| Body | 10 hp, r 0.45, 2.0, contact 0 |
| Engaged | Walks to 2-3 from its target with the shield toward it. The facing turns toward the target by at most `turnStep` a tick (a literal rotation: `turnCos` / `turnSin` for 2.5 degrees, 150 deg/s), so a player who circles faster than that gets behind it |
| Shield | While **guarding** (every state but bash recovery and stagger), a hit is **blocked** when its origin is inside the front cone (`dot(face, origin - centre) >= frontCos` 0.34 of the distance, ~140 degrees wide). Blocked: 0 damage, the bullet is consumed (a piercing arrow stops), a sword swing does nothing to it (other actors in the arc still take it). **Cover arc** (NXD6): a player bullet that comes within `coverRadius` 1.0 of the centre and inside the front cone is also stopped, so allies behind it are covered. The Bulwark's own body is still a target from the sides and back |
| Guard break (NXD7) | A blocked hit by a **sword finisher**, a **heavy arrow** (Ballista's included) or a **Siege slam** breaks the guard instead: **stagger** 1.5 s (shield down, still, takes full damage). A Wrecker roll does not (rolls never damage enemies). Riposte's counter-wave and every effect that calls `damageActor` directly ignore the shield (they are not "from" anywhere) |
| Attack | **Bash**: target within 1.8 and cooldown out (2.5-3.5 s): 0.45 s telegraph (`aimLine` length 1.6), lunge 1.4 units, the first overlap with each player hurts `HIT_NORMAL` once. Then **recover** 0.6 s with the shield down: the Knight's opening |
| Draws | First cooldown in `init`, one per bash |
| v[] (3-7) | 3 phase ticks (recover / stagger), 4 hit bits (bash), 5 guard flag (1 guarding), 6-7 free |
| Cost / points / drop % | 3 / 200 / 8 |
| Unlock / weight / per room | any floor / 1 / 2 |

The shield and cover tests are a **transient per-tick list** of guarding Bulwarks (position, facing), built at the start
of the player-bullet phase from tick-start hashed state, like the Warbanner's aura mask (`SimCtx.rebuildAura`): never
hashed, a pure function of hashed state. Without a Bulwark the list is empty and every hit site runs exactly as today.

### Chainhook

| | |
|---|---|
| Body | 9 hp, r 0.45, 2.2, contact 0 |
| Engaged | Keeps 4-7 from its target with line of sight (the sniper's `reposition`) |
| Throw | Cooldown 4.0-5.0 s, target within 8 and in sight: **aim** 0.7 s (`aimLine` at a heading locked at telegraph start, length 8). Then one `HOOK` bullet: speed 16, life 0.5 s (8 units), hit radius the enemy bullet's |
| Hook rules | Like a normal enemy bullet: walls and intact pieces stop it, a rolling player is passed through, the sword's guard erases it (counts as a parry, feeds the near-miss director; NXD8), the power pellet erases it, the Hourglass slows it, it grazes. **On a hit** it does not call `hurtPlayerAt`: if the player is hittable (not i-framed, not dead, not already hooked) it is consumed and **latches** (the Chainhook's v slots record the player). Finding the thrower: the bullet's emitter id -> the actor with that `emitterId` (NX0 checks whether a lookup exists; a scan of the actor slots is fine at this count) |
| Drag | While latched: each tick the Chainhook stands still and moves the hooked player toward itself by `pullSpeed` 10 u/s through `movePlayer` (the player's own walk still applies, so walking away slows the pull), until the player is within `pullStop` 1.3, 0.6 s pass, or the drag is **broken**: the player rolls (rollTicks > 0), the Chainhook loses sight of the player (a pillar between them), it dies, or it takes >= 3 damage since the latch (a teammate freed you). The drag never hurts |
| Yank strike | If the drag ends by arrival: 0.3 s telegraph (`ring` at its feet, radius 1.6), then a 5-bullet fan at the player (the imp's port row 5 @ 0.7), `HIT_NORMAL`. Roll out of it |
| Co-op | One player at a time (its aggro target). Teammates are never moved |
| Draws | First cooldown in `init`, one per throw |
| v[] (3-7) | 3-4 heading, 5 hooked player + 1 (0 none), 6 drag ticks, 7 damage since latch |
| Cost / points / drop % | 3 / 200 / 8 |
| Unlock / weight / per room | **floor 2** (NXD4: `ROOM_KIND_MIN_FLOOR`, honoured even with unlock floors off) / 1 / 1 |

### Snatcher

| | |
|---|---|
| Body | 3 hp, r 0.3, 5.0 (the Goldling's 5.1 less a hair), contact 0, harmless |
| Behaviour | Engages with its room like any member. **Steal**: walks (steer mover) to the nearest live pellet of its room (`rec` = its room's record, `taken` 0, never the power pellet) and eats it on contact: `taken = 2`, `v` counts it. **Flee**: any living player within `fleeRadius` 3 -> runs on `fleeField` over its room box (factor 1.2, the Goldling's) until none is within 4.5 |
| Swallow | At `stomach` 5 carried pellets, or 8 s after its first steal: **swallow** 1.0 s telegraph (belly glow; it stands still: the window to kill it), then every carried pellet becomes `taken = 3` (gone for good, `left` unchanged, so the room's Sweep is lost; NXD11). The count resets and it starts stealing again |
| Death | Every pellet of its room with `taken = 2` goes back to `taken = 0` in place (it never decrements `left`, so nothing else changes). One Snatcher per room (NXD9), so the room's `taken = 2` pellets are its own. Points: its own kill points only (the returned pellets pay when picked up) |
| No pellets | A room with no live pellets (none placed, all taken, the room not engaged): it flees only. No ground-boost stealing in v1 (NXD10) |
| Room clear | It is a member: the room cannot clear while it lives, so carried pellets are always either returned or swallowed before the clear |
| Draws | None (no cooldown, nearest pellet by index order on ties) |
| v[] (3-7) | 3 carried count, 4 ticks since first steal, 5 phase ticks (swallow), 6 flee flag, 7 free |
| Cost / points / drop % | 2 / 150 / 15 |
| Unlock / weight / per room | any floor / 1 / **1, never the room's first buy** (`needsCompany`); Horde's second wave never buys one (NXD9) |

### Pyre-keeper and `pyre`

| | **Pyre-keeper** | **pyre** (child) |
|---|---|---|
| Body | 6 hp, r 0.35, 2.4, contact 0 | 4 hp, r 0.4, 0 (still), contact 0 |
| Engaged | Keeps 6-9 from every living player (the summoner's `keepRange`); panic within 2.5 (the summoner's) | Lit 0.5 s after it lands (no fire while lighting) |
| Attack | **Light**: fewer than `maxAlive` 3 of its pyres alive, `perLife` 6 not spent, cooldown 4.0-5.0 s out: 0.8 s telegraph (`ring` radius 0.8 on the landing cell), then the pyre spawns there | **Fire**: every 2.0 s one aimed bullet at the nearest living player in sight, speed 4.5, life 2.5 s, `HIT_NORMAL`, drawn with the new `flame` look (NXD12); the first shot offset by 0.6 s x its index among the keeper's pyres, so three never fire together |
| Landing cell | 8 compass offsets at 3.5 units from its **target** (unit vectors as literals, 0.7071...), tried in order from a start index drawn once per cast; the first FLOOR cell inside the keeper's room, off solid decor / intact pieces / pellets, >= 2 from every living player and >= 2 from its other pyres. None valid: the cast is spent with no pyre | |
| Death | Its pyres wither (the summoner's `wither`) | Not a room member (NXD13: the room clears without it); withers at its keeper's death or the room clear; killing one gives 30 points, no drop roll |
| Draws | First cooldown in `init`, two per cast (cooldown, start index) | None |
| v[] (3-7) | 3-5 pyre ids (summoner-style slots), 6 lit count this life, 7 panic latch | 3 fire timer, 4 keeper id |
| Cost / points / drop % | 3 / 180 / 8 | 0 / 30 / 0 |
| Unlock / weight / per room | any floor / 1 / 1 | runtime only |

Shared safety rules (docs/NEW_ENEMIES.md's): no hook line, landing cell or pull is placed by a draw beyond the documented
draws per attack, so the draw count never depends on the layout. Every rule keys off the actor's aggro target. Affixes
apply to all four as planned spawns (a Hulking Bulwark, a Swift Snatcher; a Shielded Bulwark is legal); never to a pyre
(runtime spawn).

## Architecture

### 1. Sim

- `sim/combat/actors/archetypes/{bulwark,chainhook,snatcher,pyrekeeper,pyre}.ts`, each a copy of the nearest shape
  (never an import): bulwark <- bruiser (approach) + charger (lunge, hit bits); chainhook <- sniper (reposition,
  aimLine) + imp (fan); snatcher <- golden (flee) + swarmer (chase); pyrekeeper <- summoner; pyre <- the turrets' fire
  loop.
- `registry.ts`: `PORT_BAND_ENEMIES_3 = 6`, band comment updated.
- `combat/patterns.ts`: `BulletKind.HOOK = 13`. `combat.ts`'s enemy-bullet-vs-player loop: a HOOK branch before
  `hurtPlayerAt` (latch via a new `ctx.playerHittable(k)`: the same i-frame / dead test `hurtPlayerAt` makes, plus "not
  already hooked").
- **Shield**: `combat/shield.ts` (new): `rebuildShields(ctx)` at the start of the player-bullet phase; `shieldBlocks(ctx,
  x, z)` -> the blocking Bulwark's slot or -1; `shieldBreaks(...)`. Called from the plain bullet loop,
  `piercingBulletHit` and the sword's sweep callback (with the swinging player's position as the origin and the
  `finisher` flag), and from the Siege slam's hit. Unhashed events `shieldBlocks` (x, z) / `guardBreaks` for the view.
- **Drag**: `SimCtx.dragPlayer(k, dx, dz)` -> `movePlayer(state, dx, dz, config, playerAt(state, k))`. Only the
  Chainhook calls it, from its own step (stepActors, after stepPlayer). Unhashed events `hookLatched` / `hookBroken`.
- **Pellets**: `PELLET_STOLEN = 2`, `PELLET_DIGESTED = 3` beside today's 0 / 1 in `sim/pellets`; `pelletsSteal`,
  `pelletsReturn(record)`, `pelletsDigest(record)`. `stepPellets`, the power pellet and the view all read `taken !== 0`
  as "not on the floor" already (NX0 confirms every reader).
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype`.

### 2. Dungeon (`shared/dungeon`)

- `ENDLESS_ROOM_KINDS` appended (never reordered): bulwark 1, chainhook 1, snatcher 1 (`needsCompany`), pyrekeeper 1;
  `maxPerRoom` 2 / 1 / 1 / 1 (NXD5). `rosterOrder` shuffles 14 kinds (13 draws).
- NXD4: `ROOM_KIND_MIN_FLOOR` (new, `endlessData.ts`): `chainhook` 2. `roomKindOpen` closes a kind below its minimum
  floor in every world, unlock floors on or off (no draw). Every other kind has no minimum, so nothing else moves.
- Horde's second wave (docs/FORTUNE.md) skips `snatcher` when it copies the planned kinds (NXD9).
- `roomPool.lock.spec` (floor 1 without a roster unchanged), `roster.spec`, `rosterLine.spec`, `daily.spec` and the
  determinism pins that record endless floors re-pinned. `DAILY.ruleset` 19 -> 20 (NXD16).

### 3. Theme contract

- `ENEMY_ARCHETYPES` += the five ids (asset, colour role, `.name`); placeholders from the enemy palette (a disc with a
  flat front plate, a squat drum with a hook, a small cone, a tall robe cylinder, a low bowl). Display names Bulwark,
  Chainhook, Snatcher, Pyre-keeper, Brazier.
- One colour role `enemyShield` (the guard arc and the block sparks): in an existing report module, >= 40 CIE76 from the
  enemy-bullet roles, `telegraph`, `enemyOutline`, the affix Shielded role and the boosts. The chain draws in
  `enemyOutline` (no new role) unless NX8 shows it needs one.
- Bullet visuals: `bullet.enemy.hook` (a hook sprite with `heading`, per docs/PROJECTILE_ART.md) and the new
  `bullet.enemy.flame` (NXD12): `enemyBulletLookOf` maps the `pyre` to `flame`. Art: the Player Bullets pack's Hyper
  flame (already in `art/vendor/player-bullets/`) recoloured into the danger pink ramp, packed into `bullets.png`
  (`--only bullets`), held to `bulletArtReport` (mean <= 12 CIE76 from `enemyBullet`, >= 3:1 on every floor and wall).
  Until uploaded it draws the small ball placeholder like every enemy look.
- Port audio IDs, appended after `sfx.jingle.secret`, SILENT in the placeholder with `SFX_FALLBACK`s:
  `sfx.enemy.block` (-> breakable hit), `sfx.enemy.guardbreak` (-> Charger stun), `sfx.enemy.hook` (-> charge),
  `sfx.enemy.hooklatch` (-> Siege pin), `sfx.enemy.snatch` (-> pellet eat, pitched down), `sfx.enemy.swallow`
  (-> combo break), `sfx.pellet.return` (-> pellet eat), `sfx.enemy.pyrelight` (-> fuse).
- Strings: five `enemy.<id>.name`, four `bestiary.<id>` (none for `pyre`, NXD15), each with an `l10n/context.json`
  entry.

### 4. View and client

- Bulwark: a faint guard arc in `enemyShield` in front of a guarding Bulwark (so the facing reads at a glance), a spark
  at each block, stars on a stagger; `Block` held while guarding, `TakeDamage` slowed for the stagger.
- Chainhook: the `aimLine`; a chain drawn from its hand to the flying hook, then to the hooked player (one Beam or a
  run of small parts, pooled); a snap when it breaks. **Prediction**: while merged state says the local player is
  hooked (a Chainhook's v5), `SimController.getDrawnPlayer` draws the merged position (prediction suspended) and the
  `PredictionSmoother` blends back for `PREDICTION_VIEW.resumeSec` after the drag ends (no snap); the camera follows
  the drawn player as today. `predictMotion` and its parity spec are untouched.
- Snatcher: belly glow scaled by its carried count (5 pips), a gulp on each steal, the swallow telegraph pulsing; on
  death the carried pellets fly from the corpse back to their cells (`PelletRenderController` draws a `taken = 2`
  pellet hidden, a 0 one as today); a fizzle on each digested pellet's cell. The room-clear tally's `sweep` segment is
  unchanged (the sim just never pays it).
- Pyre-keeper: the ring on the landing cell, a torch arc flying to it (view-only), the brazier's flame and glow from
  the decor piece, a puff when a pyre dies or withers; fireballs in the `flame` look.
- Cue mapper rows for the eight sounds; `minInterval` on block (0.08 s) and snatch.
- First sighting: four ids into `SIGHTING_IDS` / `ARCHETYPE_SIGHTINGS` before the affix ids (NE1's rule).
- Codex: four `enemy:<id>` entries appended after `secret:room` (NXD14; catalogue 87 -> 91, order lock extended).

## Tasks

- **NX0. Audit (read-only).** Confirm every row of "What the code gives us" on the branch point; list every reader of
  `PelletsState.taken` (sim and view) and check each treats 2 / 3 as "not on the floor"; the emitter -> actor lookup;
  where in the tick a drag should run (stepActors after stepPlayer: the player's `prevX` / camera and the co-op hash
  order) and whether `movePlayer` from an actor step breaks anything the lunge does not; every `damageActor` caller and
  which hit sites need the shield (the Siege slam's included); whether the enemy slot takes the brazier's world art;
  how Horde copies planned kinds (for NXD9's skip). Contact sheet of the four rigs' `Idle` / `Walk` / `Run` /
  `Attack 1-4` / `Block` / `Taunt` / `TakeDamage` (gitignored `art/build/contact/`). Add this doc's row to CLAUDE.md's
  Documents table.
  **Verify:** findings written under "NX0 findings".
- **NX1. Registry, data and contract skeleton.** Band 6, five ids with stub steps, data rows, `BulletKind.HOOK`,
  `ENEMY_ARCHETYPES` + placeholders + strings, `enemyShield`, `bullet.enemy.hook` / `bullet.enemy.flame` (placeholder
  looks), the eight SILENT sounds (`codex.spec` tail and the listed skips updated).
  **Verify:** indices 19-23 and every older index unchanged; `contract.luau` / `validate.luau` compile under Lune within
  200 locals; `npm run verify` green; every fixture, M1 and tutorial lock unchanged.
- **NX2. Bulwark.** Facing turn, guard, cover arc, the hit sites, guard break, bash, recover.
  **Verify:** specs: a bullet from the front never damages it, one from behind does; a bullet passing in front toward an
  ally behind it stops; a piercing arrow stops on the shield; a finisher / heavy arrow / Siege slam staggers it, a
  Wrecker roll does not; a circling player faster than 150 deg/s gets behind it; without a Bulwark every hit site is
  byte-identical (a refactor spec over a recorded endless floor's hash).
- **NX3. Chainhook and `HOOK`.** Aim, throw, latch, drag, every break rule, yank fan, the floor-2 minimum.
  **Verify:** specs: a rolling player is never latched; a guard erases the hook and counts a parry; walls stop the drag
  (the player never enters a wall: `movePlayer`'s guarantee); a roll, a pillar, its death or 3 damage break it; only
  the aggro target is ever moved; no extra draws; no floor-1 room ever buys one, in every world.
- **NX4. Snatcher.** Steal, flee, swallow, return on death, no-pellet flee, Horde skip.
  **Verify:** specs: a returned pellet is collectable and the Sweep still pays; a swallowed one makes the Sweep
  impossible; it never eats the power pellet or another room's pellet; `left` is never changed by it; a Horde wave
  never adds one; a room without a Snatcher hashes as before.
- **NX5. Pyre-keeper and `pyre`.** Light cast, landing cell rule, pyre fire loop, alive / per-life caps, wither.
  **Verify:** specs: no pyre on a non-floor / decor / piece / pellet cell or within 2 of a player; at most 3 alive and 6
  per life; the room clears with pyres alive (they wither); exactly two draws per cast.
- **NX6. Room pool and roster.** Append the kinds, caps, `needsCompany`, `ROOM_KIND_MIN_FLOOR`; re-pin locks; ruleset
  bump; census of floors 1-20 x run seeds 1-60 (kinds per room, room cost, peak enemy bullets with three pyres per
  keeper), like NE7.
  **Verify:** floor 1 spends draw for draw as before without a roster; census table written.
- **NX7. View (placeholders).** Guard arc, sparks, stagger stars, chain, prediction suspension, belly glow, pellet
  return fly-in, landing ring and torch arc, the `flame` look mapping, cue rows.
  **Verify:** view specs (guard arc only on guarding Bulwarks; the drawn player equals merged while hooked and the blend
  never jumps over a tile; a `taken = 2` pellet is not drawn; `enemyBulletLookOf` gives the pyre `flame`).
- **NX8. Art.** Four sets in `art/atlases.json` (the NE9 recipe: grid 128, body over `Shadows/`, pad 3, 2 px rim,
  per-sheet cells), marks measured on the frames, `bodyTiles` against the knight; the pyre on the decor brazier; the
  hook bullet art; the flame bullet (Hyper flame, danger-pink recolour) into `bullets.png`.
  **Verify:** `test:art`, two `art:build`s byte-identical, older outputs unchanged, `bulletArtReport` passes,
  `vale.spec` cases; upload list.
- **NX9. Strings, first sighting, Codex.** `bestiary.<id>`, l10n context, sightings, four Codex entries after
  `secret:room` (the catalogue builder's second list).
  **Verify:** `l10n:check`, `check:autolocalize`, `catalog.spec` green (the lock extended, never reordered).
- **NX10. Audio.** Candidates from Ninja Adventure (Hit & Impact for the block, Whoosh for the throw, metal for the
  latch, Fire for the pyre) and Kenney impact sounds; `audio:audition`, `audio:lock`, `audio:build`.
  **Verify:** `audio.lock.json` updated; vale sounds switch on only with every file's id.
- **NX11. Builds and systems pass.** Check each kind against builds (Chain Spark / Overkill through a shield, Siege Bolt
  on a Bulwark, Wrecker near pyres), treasure locks (a drag is not a hit; the yank fan is), Horde waves, the Daily,
  co-op (a teammate freeing a hooked player), secret rooms (a heavy arrow into a guarding Bulwark near a crack).
  **Verify:** a spec per interaction that has a rule; a note per one that does not.
- **NX12. Tuning.** Bot / census runs: room time against par, TTK per kind for Knight and Archer, hits per kind, the
  Sweep rate in Snatcher rooms (target: lost in about a third of them for a passive bot, never for a bot that targets
  it), how often a drag ends in a yank.
  **Verify:** "NX12 tuning (as built)" table; owner calls listed.
- **NX13. Upload and Studio check.** Owner uploads (art, audio); checklist per kind (guard arc readable on every
  biome, the chain and the drag feel on a simulated 4G link with prediction on, pellet return readable, pyre crossfire
  and the flame look on a phone).
- **NX14. Docs.** CLAUDE.md decision log entry, this doc's "as built" notes, docs/NEW_ENEMIES.md cross-link.

## Edge cases

- **Bulwark vs the Archer.** The heavy arrow's aim assist flies at the nearest bearing: into the shield, which then
  staggers (by design, NXD7). A stream of normal arrows into the front does nothing: the Archer must reposition.
- **Two Bulwarks back to back.** Each covers the other's back; the guard break is the answer. Cap 2 per room.
- **Shield and the power pellet / Nova / Phantom Step.** Unaffected (they act on enemy bullets).
- **Chainhook pulling through a doorway.** `movePlayer` slides along walls; a pull across a corridor mouth ends at the
  wall if the line is blocked (the sight test breaks the drag).
- **Chainhook while the player is in a boon draft or the floor changes.** Drafts freeze the sim; a floor change frees
  every actor slot (the drag ends with it).
- **A hooked player dies to something else mid-drag.** `dead` -> the drag ends.
- **Two Chainhooks hooking the same player.** Cap 1 per room; across rooms, a latch on an already-hooked player is
  refused (`playerHittable`'s hooked test).
- **Snatcher and Horde.** Horde's second wave never buys a Snatcher (NXD9), so one carrier per room always holds.
- **Snatcher vs the Goldling.** Separate rooms (the Goldling's room is drawn last and independent); if they share a room
  both flee on their own fields.
- **Pyre on a cell later covered by a breakable's debris or a pellet.** Pyres are actors: they do not block cells.
- **Pyre-keeper killed during a light telegraph.** The cast is spent, no pyre.
- **M1 and the tutorial.** No new kind is in their pools; nothing changes.

## Decisions (2026-11-13, Kaleb)

- **NXD1. Ids and band:** `bulwark`, `chainhook`, `snatcher`, `pyrekeeper`, `pyre`; band 6 (indices 19-23). The shield
  enemy is the **Bulwark** (renamed from "Shieldbearer" to keep clear of the Shielded affix; a Shielded Bulwark is
  legal).
- **NXD2. Rigs:** Spawn 9 (Bulwark), Spawn 4 (Chainhook), Imp 6 (Snatcher), Spawn 1 (Pyre-keeper), the decor brazier
  (pyre); alternates kept for a swap after the Studio check.
- **NXD3. Scope:** these four only; the rest of the brainstorm stays out of scope.
- **NXD4. Floor 1:** the Bulwark, Snatcher and Pyre-keeper may appear on floor 1; the **Chainhook never does**
  (`ROOM_KIND_MIN_FLOOR` 2, honoured in every world even with unlock floors off).
- **NXD5. Weights 1 / 1 / 1 / 1 appended, caps 2 / 1 / 1 / 1;** the existing eleven weights never change.
- **NXD6. The Bulwark's shield covers allies behind it** (cover arc 1.0).
- **NXD7. Guard breaks on the sword finisher, any heavy arrow and a Siege slam;** not on a Wrecker roll.
- **NXD8. The hook is a `HOOK` enemy bullet the sword's guard erases** (counts as a parry).
- **NXD9. One Snatcher per room;** stolen pellets hold `taken = 2`; Horde's second wave never buys one.
- **NXD10. Pellets only in v1;** no ground-boost stealing.
- **NXD11. Swallowed pellets lose the room's Sweep.**
- **NXD12. The pyre's fireballs get a new `flame` bullet look now** (the Hyper flame recoloured into the danger pink),
  not the caster's.
- **NXD13. Pyres are not room members** and wither with their keeper or the room clear.
- **NXD14. Codex:** the four entries are appended after `secret:room`; the order lock is extended, never reordered.
- **NXD15. First-sighting toast and Codex entry for all four** (not for the pyre).
- **NXD16. Boards stay `_v1`; `DAILY.ruleset` 19 -> 20.**

## Risks

- **The drag in co-op.** The pull lands in merged state one lead late, and prediction is suspended while it runs. On a
  4G link that is up to 20 ticks of the knight not following your input. Mitigation: the drag is short (<= 0.6 s), the
  smoother blends, NX13 checks it on a simulated link; fallback: shorter drag, or a "hooked" status without movement.
- **First actor that moves a player.** Ordering, `prevX` interpolation and the camera all assume only stepPlayer and
  the lunge move players. NX0 audits; NX3's specs pin it.
- **Shield cost on the bullet loop.** One extra test per player bullet per guarding Bulwark (at most 2 per room).
  Measured in NX12 against the stress spec.
- **Archer frustration.** The Bulwark is built to resist the Archer's main tool. Mitigation: the heavy arrow breaks the
  guard, the Archer's longer roll flanks, and NX12 measures Archer TTK per kind.
- **Snatcher vs the room-clear feel.** A fleeing harmless enemy can drag a clear out. Mitigation: 3 hp, it stands
  still during the swallow, and it only exists where it has company.
- **Clutter.** Pyres add aimed fire. Mitigation: 3 alive per keeper, 1 keeper per room, staggered shots, NX6's bullet
  peak.
- **Flame look vs danger pink.** A fire bullet tempts orange; it must stay in the enemy-bullet pink to read as danger
  (`bulletArtReport` enforces it). If the flame no longer reads as fire once recoloured, NX13 decides.
- **Roster churn.** Every endless seed's roster reshuffles again and a new daily ruleset starts new day boards.
  Expected.
- **Codex order lock** and the `PORT_AUDIO_EVENTS` tail specs: NX1 / NX9 own them.

## Out of scope (later plans; art noted)

- The rest of the brainstorm: **Glutton** (Beast 4, `Eat`: eats corpses to heal and grow), **Harrier** (Spawn 3,
  winged swoops), **Void Wing** (Beast 2, attacks from the void), **Skirmisher pack** (Imp 1 / Imp 10, strafing trios),
  **Leaper** (Beast 5, `Jump`), **Duelist** (Spawn 13, parries your swings), **Reflector** (Spawn 4 alternate: arrows
  bounce back), **Javelineer** (Spawn 6 / Imp 7: a spear that sticks in the floor as cover).
- The Snatcher stealing ground boosts (NXD10).
- Warden mini-bosses on the five unused Elites.
