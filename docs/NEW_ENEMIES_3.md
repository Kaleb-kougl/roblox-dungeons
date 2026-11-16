# New enemies 3 (Mortar, Mender, Jackal)

Endless rooms buy fifteen room enemies today: swarmer, sniper and bruiser; imp, Ooze and summoner
(docs/ENEMY_VARIANTS.md); bomber, charger, stormcaller, warbanner and reaper (docs/NEW_ENEMIES.md); Shieldwall,
Chainhook, Snatcher and Pyre-keeper (docs/NEW_ENEMIES_2.md). Three gaps are left:

- **Nothing punishes hiding.** Solid pillars, tombs and bookcases stop every enemy bullet, and the Sniper teaches you to
  stand behind them. No enemy reaches you there.
- **Nothing undoes your damage.** The Warbanner buffs its allies and the Shieldwall protects them, but every hit you
  land stays landed. Kill order matters only for who shoots you.
- **Nothing uses your facing.** Your facing is hashed sim state (`faceX` / `faceZ`), and the guard and the swing use it,
  but no enemy reads it. You can face one way for a whole fight.

This plan adds three room archetypes, one per gap. Each is drawn by an unused 2D Demons rig already in
`art/vendor/demons-topdown/` (19 of its 34 rigs are unused today):

| Id | Role | Rig (NTD2) | Why this rig |
|---|---|---|---|
| `mortar` | lobs a shell over walls and pillars at where you are heading; shrapnel bursts where it lands | **Demon Spawn 6** (bow, lean build) | `Attack 4` draws the bow straight up, which is exactly the lob; `Attack 1` is the release |
| `mender` | channels a heal beam into the most wounded ally; cut the beam or kill it first | **Imp 10** (bone charms, empty hands) | `Attack 1` / `Attack 3` raise both arms over the head (a channel pose to loop); the pale bone charms read as a shaman next to the red imps |
| `jackal` | comes as a pack of three that circles you and lunges at your back; face one and it shies away | **Demon Beast 2** (lanky, clawed, hunched) | `Run` is a low lope for the circling; `Crouch` is the lunge's wind-up; **`BackFlip 1`** is the spooked hop back |

Alternates kept for a swap after the Studio check: Mortar **Imp 7** (the same bow on an imp body; its `Attack 4` aims
up too); Mender **Imp 4** (small, plain); Jackal **Imp 2** (if three Beast-2 bodies read too heavy for a pack).
Contact sheets of all 19 unused rigs and of these candidates: `Claude outputs/unused-demons/` (gitignored, local only).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes live in the sim, replay, validate on the server and step in lockstep. It follows
docs/NEW_ENEMIES_2.md's patterns: a new registry band (no recorded index moves), kinds appended to
`ENDLESS_ROOM_KINDS`, the per-sheet Demons pipeline for the art, SILENT port audio IDs in the placeholder,
first-sighting lines and Codex entries. **No new hash group and no new bullet kind**: a heal is a write to the hashed
`hp`, every new value is actor scratch (`v[]`, hashed), and the Mortar's shell is the Stormcaller's `STRIKE`. M1
(`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before. Endless, daily and dev replays
and scores change. The all-time boards stay `_v1`; `DAILY.ruleset` goes 21 -> 22, or the next free number when this
lands.

## Status (2026-11-16)

**NT0, NT1 and NT2 done** (see "NT0 findings": four small Design changes, no decision changed; "NT1 skeleton (as
built)"; "NT2 Mortar (as built)": the Mortar's behaviour, `ArchetypeDef.stepCorpse`, `SimConfig.roomIdAt`,
`events.shells`).
Read on `main` @ `80f57769`. NTD1-NTD14 taken by the owner on
2026-11-16 (see Decisions): every one as recommended except **NTD3** (the Mortar fires only while its target is in the
Mortar's own room), **NTD9** (a guard that stops a Jackal's lunge counts as a parry) and **NTD10** (the last Jackal of a
pack keeps the back-only rule).

## What the code gives us (read on `main` @ `80f57769`)

Paths under `src/shared/` unless they say otherwise.

| Fact | Where | Consequence |
|---|---|---|
| Bands 0-6 are taken; band 6 (`PORT_BAND_ENEMIES_3`) holds `bulwark` .. `snatcher`, indices 19-23 | `sim/combat/actors/registry.ts` | New band 7 `PORT_BAND_ENEMIES_4`. With `compareIds`: `jackal` 24, `mender` 25, `mortar` 26. No older index moves |
| `ActorState` has `hp` and `hpMax` (both hashed, in `ACTOR_HASH_FIELDS`); `ACTOR_SCRATCH_SLOTS` = 8, 0-2 shared | `sim/combat/actors/types.ts` | A heal is `hp = min(hpMax, hp + n)` on the ally: no new field. Each kind gets v3-v7 |
| Player `faceX` / `faceZ` (hashed) follow the aim input, else the roll direction, else the move input; `prevX` / `prevZ` are the tick-start position | `sim/player.ts` (~165, ~245-255) | The Jackal reads its target's facing. The Mortar's lead is `(x - prevX, z - prevZ)` x ticks: one tick of the player's own motion, no new state |
| `BulletKind.STRIKE`: speed 0, radius `STRIKE_BULLET_RADIUS` 1.1, a non-floor point skipped (the Stormcaller's `stormcallerPointOpen`: `ctx.isBlocked` + `solidCells`, so a POOL cell counts as open; NT0 finding 5), no grazes, never erased by any sweep or Phantom Step, ignores breakables, held for 6 collision passes; counted in `events.strikes` | `archetypes/stormcaller.ts`, `combat/combat.ts`, `combatData.ts`, `sim/state.ts` | The Mortar's shell is one `STRIKE` at the landing point (NTD4). The view tells a shell from lightning by its payload source (kind + 1); `events.strikes` must not play the Stormcaller's sound for a shell (NT0 checks every reader) |
| `ctx.fireEnemy(actor, dirX, dirZ, spec, x, z)` takes an origin override | `combat/ctx.ts` | The shrapnel ring fires from the landing point, not the Mortar |
| Port arc row **6 @ FULL_RING** exists (Ballista's rings) | `combat/arcTablePort.ts` | The shrapnel needs no new row; NT1 adds the Mortar to that row's `source` comment |
| `ctx.lineOfSight(x0, z0, x1, z1)` tests `isBulletBlocked` | `combat/ctx.ts` | The heal beam's sight test; the Mortar never calls it (it fires over cover) |
| Enemy melee hits: the Shieldwall's bash and the Charger call `ctx.hurtPlayerAt` directly with per-player hit bits (`bashHits`); **the swarmer's lunge does not** (it hurts through the generic contact damage, `contactDamage` `HIT_NORMAL`, `stepContactDamage` after the actors; NT0 correction 1). The sword's guard only erases enemy bullets; it never stops a melee hit | `archetypes/bulwark.ts`, `charger.ts`, `swarmer.ts`, `weapons/defs/sword.ts` | A guard that stops a Jackal's lunge is a new rule at the Jackal's own hit site (NTD9). The guard is readable there: the target's active slot (`activeWeaponSlot`), `slot.v[SWORD_V_GUARD] > 0`, the cone `swordGuardSweepCos` (NT0 finding 8) |
| The swarmer has a lunge (`aimLine` hint, `LUNGE_SPEED` x `LUNGE_SECONDS`) | `archetypes/swarmer.ts` | The Jackal copies its lunge (wind-up, locked heading, the wall-stop rule); its hit-once rule is the Bulwark's `bashHits` (a bit per player in one v slot), since the swarmer has none |
| Hints are data on the archetype (`aimLine`, `ring`, `strikeRow`) | `archetypes/*.ts` | The Mortar uses `ring` at v3-v4. The heal beam has no hint today: a view-only tether drawn from v3 (the ally's id), see Architecture 4 |
| `spendEncounterBudget` buys ONE kind per draw, up to `ENDLESS_ROOM_ACTOR_CAP` 16; `populateEndlessRoom` places swarmers in packs of up to `ENDLESS_PACK_SIZE` 4 around an anchor (placement only, no extra draws) | `dungeon/endless.ts`, `dungeon/endlessData.ts` | A Jackal pack needs a new optional `packOf` on `EndlessRoomKind`: one buy pushes three `jackal` entries, and the swarmer's anchor placement is generalised to any pack kind. Without a pack kind in the pool, every draw and tile is as today |
| `ENCOUNTER_COST` is per archetype and read outside the spender (Horde's wave cost, the score record's cost and par) | `dungeon/encounterCost.ts` | The Jackal costs 1 **each**; the spender prices a pack at `packOf` x cost (3). Every per-spawn reader stays right (NT0 lists them) |
| `ENDLESS_ROOM_KINDS` has 15 rows; `ROOM_KIND_MIN_FLOOR` (Chainhook 2) is honoured in every world; the roster shuffles every kind but the swarmer, one more per floor | `dungeon/endlessData.ts`, `dungeon/endless.ts` | Appending three rows reshuffles **every** run's roster (17 seeded kinds, full on floor 17). Any new kind could be floor 1's seeded kind unless it gets a minimum floor (NTD7) |
| Codex: kinds past `CODEX_FIRST_ROOM_KINDS` (11) are the second list, appended after `secret:room` in `ENDLESS_ROOM_KINDS` order | `codex/catalog.ts` (~200, ~443) | The three entries land after the Pyre-keeper's on their own: catalogue 91 -> 94, the order lock extended, never reordered |
| `PORT_AUDIO_EVENTS` ends with New enemies 2's eight (`sfx.enemy.pyrelight` last); its tail is pinned by `codex.spec` and skipped in a list of specs | `theme/contract.ts`, CLAUDE.md | New sounds are appended after `sfx.enemy.pyrelight`; NT1 updates `codex.spec`'s tail and the listed skips |
| `enemyBulletLookOf(payload)` picks the look per **`BulletKind`** (SNIPER needle, CASTER medium, BOSS large, HOOK hook, the pyre's ENEMY source flame, else small), not per archetype (NT0 correction 3); enemy bullet art stays in the danger pink (`bulletArtReport`) | `view/bullets/looks.ts` | Shrapnel (`BulletKind.ENEMY`) draws the small look; the Mender's bolt fires as `BulletKind.CASTER` (a look-only kind: no sim rule reads it) and draws the medium look with no view change. No new bullet art in v1 (NTD12) |
| `contract.luau` / `validate.luau` / `sprites.luau` top-level locals **189** / 192 / 195 `local` lines on out/ at the branch point (CLAUDE.md's New enemies 2 entry said 187; the Silver shop's 189 is current). Counted by NAMES (a `local a, b` line is two): 189 / **197** / 195 (NT0 finding 11) | CLAUDE.md (New enemies 2, Silver shop) | Appending to `ENEMY_ARCHETYPES`, strings and `PORT_AUDIO_EVENTS` costs no locals; the heal role's check folds into an existing report module |
| `DAILY.ruleset` is 21 | `daily/config.ts` | 21 -> 22 (NTD14) |

## NT0 findings (2026-11-16)

Read on `new-enemies-3` @ `b6f5822` (main @ `80f57769` + this plan). Paths under `src/shared/` unless they say
otherwise. Every row of "What the code gives us" holds except the corrections written into the table (correction 1:
the swarmer's lunge hurts through contact damage; 3: bullet looks are per `BulletKind`; the STRIKE point test and the
Luau counts). Skipped: the rigs' contact sheet (already re-rendered outside the repo).

| Question | Finding | Consequence |
|---|---|---|
| 1. Indices | `compareIds` is byte order: `jackal` 24, `mender` 25, `mortar` 26 in band 7. Every older index is fixed by its band | As planned |
| 2. `ENCOUNTER_COST` readers | Gameplay: `dungeon/endless.ts` `spendEncounterBudget` (affordability, `need`, dearest, `left`); `sim/score/score.ts` `buildDeferredScoreRooms` (par per PLANNED SPAWN: `encounterCost(sp.kind)`) and the non-deferred `buildScoreRooms` (par per actor); `sim/pacts/stepPacts.ts` `spawnWave` (Horde wave par per SPAWNED actor, then `appendScoreRoomMembers` and `vaultParGrown`, so the treasure SWIFT par follows the record's `parTicks`). Tools only: `dungeon/testing` `spenderFallback.ts` / `poolCensus.ts`, `run/testing` `buildTune.ts` / `variantTtk.ts` | Every reader outside the spender is per spawn, so a pack of three Jackals at 1 each is 3 everywhere with no change: the record's par, the SWIFT countdown, Horde's par. Only the spender prices a whole pack (NT5). Horde copies the first `hordeMaxWave` (10) planned spawns, so a pack at the cut is copied as 1 or 2 Jackals (each priced 1; the "pack" is just Jackals on one target, so it still works): NT11 note. `spenderFallback.ts` and `poolCensus.ts` mirror the spender and must learn `packOf` in NT5 |
| 3. `events.strikes` readers | Written only by `ctx.fireEnemy` (any `BulletKind.STRIKE` spec). Read only by the view: `view/audio/cues.ts` (the enemy-shoot cue skips `gooSpawned + strikes`) and `view/fx/variantCueEvents.ts` -> `sfx.enemy.strike` whenever `strikes > 0`. The guard (`melee.ts` `bulletInArc`), the power pellet (`stepPellets.ts` `eraseVisit`), Phantom Step and the collision loops test the bullet's **kind**, not the count. The strike's look (`view/variants.ts` `enemyBulletPool`, `view/newEnemies.ts` `isStrikePayload`, the client's decal / hazard pools, `HazardSpritePool`'s lightning art and the view-only scorch) also reads the kind only | A shell needs its **own count**: an unhashed `events.shells` (shells fired this tick, `fireEnemy`'s STRIKE count left as is, so the shoot cue's skip keeps working); `variantCueEvents` plays the lightning only for `strikes - shells > 0` and the shell's sound for `shells > 0` (NT2 adds the field, NT7 the cue rows). The view must tell a shell from lightning by the payload `source` (Mortar kind + 1) in every strike reader (pool, decal, hazard art, scorch): NT7. The shrapnel ring (6 `ENEMY` bullets) raises `enemySpawned` past the skip, so it also plays `sfx.enemy.shoot` on the impact tick unless NT7 adds the shrapnel to the skip |
| 4. Bosses, Goldling, dummy, pyres in data | `data.boss === true` marks a boss; room enemies carry `data.roomEnemy === true` (`isRoomEnemyData`). The Goldling, the dummy, the pyre and the bosses have no `roomEnemy` (turrets neither). `warbanner.ts` `isWarbannerAuraTarget(kind, bannerKind)` is exactly NTD8's predicate shape: `isRoomEnemyData(data) && data.boss !== true` and not its own kind. A boss's swarmer adds are room enemies (they never share a room with a Mender: boss rooms buy nothing) | NTD8 = `isRoomEnemyData(ctx.data(o)) && data.boss !== true && o.kind !== menderKind`. Slimelets and summoned swarmers are room enemies: healable, as the edge cases say. No id list needed |
| 5. The shell's floor test | `stormcallerPointOpen` uses `ctx.isBlocked` (`isBulletBlocked`): a POOL cell is open to bullets, so a lead point over a pool would land there. `ctx.isBodyBlocked` (`bodyBlocker` = `blocksMove`: anything but FLOOR, solid decor and pillars are WALL cells) plus `solidCells` (every intact piece, the vault's chest and a secret's crack included) is exactly "not floor" | NT2's landing test is `!ctx.isBodyBlocked(x, z)` and not a `solidCells` cell (Design updated). Without `isBodyBlocked` (hand-built arenas) it falls back to `isBlocked`, as `ctx.isBodyBlocked` already does |
| 6. NTD5, a dead Mortar's flight | A dead actor gets no hook but `def.stepDead` (`stepActors`' dead branch), and `stepDead` marks a reviver (`runOnKill` / `dropsOnKill` take `def.stepDead !== undefined`, and it suppresses the corpse timer). The Vengeful hold works because a separate system (`stepAffixes`, per-slot `state.affixes`, hashed) fires from the corpse; `affixHoldsCorpse` only keeps the slot. A held corpse keeps its emitter (`freeActor` releases it), so `fireEnemy` from a corpse works (the Vengeful ring does it) | The corpse hold alone cannot land the shell. Smallest faithful change (Design updated): a new optional `ArchetypeDef.stepCorpse?(ctx, actor): boolean`, called in `stepActors`' dead branch only when `stepDead` is absent, returning true to hold the slot past its corpse timer. The Mortar's counts down v5 (hashed) and lands the shell on time, then lets the slot go. No other archetype defines it, so every other path is unchanged byte for byte; it is not a reviver (Vampire Fang, drops unchanged). Note for NT11: a Siege-pinned Mortar does not step (`isPinned`), so its flight freezes while pinned (the ring holds); and a posthumous shell lands after its room may already have cleared (PERFECT and pellets were judged at the clear) |
| 7. Player `prevX` | `stepPlayer` sets `prevX / prevZ = x / z` first, then walks or rolls; stepCombat runs after every player's stepPlayer, and the actors (phase 2) before the sword's lunge (phase 4). So at the Mortar's step `x - prevX` is this tick's walk or roll step, plus any drag by a Chainhook in a lower actor slot (slot order; the same on every client). The lunge is never in it (it happens after the actors, and the next tick starts from the lunged position). Floor change, respawn and a frozen draft (`progression.ts`) set `prevX = x`, so a teleport never reads as motion | The lead never jumps from a teleport. A roll's dash step (and Quickstep, the Archer's longer roll, a drag) is longer than a walk step, but a full-speed walk already leads 6 / 60 x 36 = 3.6 > `maxLead` 3.0, so every fast motion clamps to the same 3.0 in its direction: no jump in length, only in direction (a roll turns it at once). Co-op: the target is the nearest living player, re-bound every tick (`ctx.targetNearest`), and its `prevX` is its own |
| 8. The sword guard at a hit site | Per player: `weaponsAt(state, i)`, `activeWeaponSlot(w)`, `slot.weapon === weaponIndex("weapon.sword")`, `slot.v[SWORD_V_GUARD] > 0` (ticks left). The guard sweeps from `(p.x, p.z)` along `(p.faceX, p.faceZ)`, reach `SWORD_DATA.guardReach` 1.9, cone `swordGuardSweepCos(state, i)` (-0.2, about 203 degrees; Bastion: below -1, every direction), cone test `dot >= halfCos x dist` (`melee.ts` `inCone`). The guard counter is stepped in the weapons phase (4), after the actors (2): at the Jackal's step `v[GUARD] > 0` means the guard sweeps this tick too; a guard pressed this tick is up from the next tick's actor phase (one tick late, the same for every client). A roll started this tick zeroes the guard only in phase 4, but the rolling player is i-framed anyway | NT4 reads it exactly so (and skips the stop for a player with `rollTicks > 0`, so a roll is never a parry). The guard cone (-0.2) is wider behind than the Jackal's front cone (0.34): a lunge from straight behind (dot about -1) is outside the guard; a guard stops a lunge only once the player has turned to within about 100 degrees of it. Fine by NTD9; NT12 measures it |
| 9. The parry feed (NTD9) | `ScoreEvents.guardX / guardZ / guardPlayer` (unhashed, cleared at the start of each tick in `step.ts`), scored runs only. The sword pushes one x / z per erased bullet through the sweep's `ArcEraseSink`, then one `guardPlayer` per cancel, then `scoreGuardCancels` (hashed GUARD points, `guardCancels`), then the builds' brace and Riposte hooks with the cancel count. Readers: `view/fx/nearMissEvents.ts` (the director: sparks, PARRY!, freeze, haptics) and `view/fx/recapTally.ts` (recap and contribution parries); `run/testing/legendaryTune.ts` counts `guardPlayer` as erased bullets (a tool) | A Jackal stop pushes `guardX / guardZ` (the contact point) and `guardPlayer` (the player) only: no `scoreGuardCancels` (no points, no hashed score change), no brace or Riposte count, as the plan says. The push happens in phase 2, before the weapon phase reads `guardX.size()` as Riposte's `guardFrom`, so the duos' erased-bullet positions still start after it. `legendaryTune` would count a stop as an erased bullet: NT11 note |
| 10. Room test (NTD3) and room members | Actors see the encounter rooms (`ctx.encounter`, `ctx.roomAt`: the first room whose rectangle contains the point; the rectangle is the bounding box of the room's FLOOR cells, `encounterRooms`). The score's engagement test (`scoreRoomEngaged`) and the Snatcher (`snatcherInRoomBox`) use that rectangle. Rooms are rect / ellipse / oct (`RoomShape`), so an ellipse or oct room's rectangle can hold corridor cells next to its rounded sides. The exact cell rule is `roomIdAt(d, x, z)` (FLOOR cell, `Dungeon.roomId`), used by room entry (`enterRoom`) and drawn as the room edges' dashed line (docs/ROOM_EDGES.md); it lives on `EndlessFloorWorld.roomIdAt`, which actors cannot reach (`ctx.config` is the floor's `SimConfig`) | NT2 (Design updated): an optional `SimConfig.roomIdAt` (a pure callback like `isBodyBlocked`, unhashed config), set by `run/endless.ts` `endlessFloorWorld` to the same `roomIdAt(d, x, z)`, read through `ctx.roomIdAt(x, z)` (-1 without it). The Mortar's room is `ctx.roomIdAt(home)` (its spawn tile); the target is in it iff `ctx.roomIdAt(target) === room`. So a doorway and every corridor cell are outside, exactly where the dashed line says. Without the callback (hand-built arenas): `ctx.roomAt(home)`'s rectangle. A room's score record (its members) is found by scanning `state.score.rooms[k].memberSlots / memberIds` (`pellets/snatch.ts` `snatchRecordOf`); the Mender needs no record: its allies are room enemies by data (finding 4) within heal range and sight |
| 11. Luau locals | Counted on out/ at the branch point: `contract.luau` 189 lines / 189 names, `validate.luau` 192 lines / **197 names**, `view/sprites.luau` 195 / 195 | `validate.luau` has 3 names left: the heal colour rule goes into `variantColors.ts` (`variantColorProblems` already folds its reports in), so validate takes no new name |
| 12. Keep range vs the view | The short side shows `VIEW_TILES_HIGH` 16.875 tiles along the camera's up axis; on the floor that is 16.875 / sin 55 degrees = 20.6 tiles screen-up to screen-down, **10.3 each side** of a centred player. Screen-across: landscape 16:9 30 tiles (15 each side), 4:3 22.5 (11.25); upright phones 16.875 (**8.4** each side), with the player lifted a sixth of the height (the top 14.9 floor tiles away). A Mortar 11 away straight screen-up has its feet past the edge and its body (drawn upward) gone; the lob range 13 is farther still | Too far. Design updated (the Risks' own mitigation): keep **6-9**, lob only within **10**. In landscape a firing Mortar then has its feet on screen at the worst angle (at most 10 away against 10.3; at its keep range of at most 9, its body too); upright, one standing straight across at 9-10 can be just outside (8.4), which NT13 checks with the ring (always on screen: it is within 3 of the target) |
| 13. Packs in the spender | `populateEndlessRoom`'s swarmer pack is not one buy: consecutive or later swarmer picks join the CURRENT pack (`pack` / `packLeft` survive other kinds' picks). `safeRoomSpawns` (`sim/endless.ts`) moves a spawn that lands within `SPAWN_SAFE_RADIUS` of a living player to another tile, so a pack can be split at room entry. The spender's `need` (budget left per slot left) compares a kind's cost per ONE slot | NT5: a Jackal pack must not join or reset the swarmers' pack state (a separate anchor; the swarmers' behaviour unchanged when no Jackal is bought), and should compare a pack's cost per slot (`packOf x cost / packOf`) against `need`; a split pack at entry is still a pack by NT4's rule (same target) |
| 14. Codex timing | `codex/catalog.ts` builds the second list from `ENDLESS_ROOM_KINDS[CODEX_FIRST_ROOM_KINDS..]`, so the three entries appear the moment NT6 appends the kinds (not at NT9); their descriptions are the `bestiary.<id>` strings | NT1 adds the `bestiary.<id>` strings (with their sighting ids and `ARCHETYPE_SIGHTINGS`), as NX1 did; NT6 extends `catalog.spec`'s order lock and the Codex counts (`doc.spec`, `view/codex/screen.spec`) when it appends the rows; NT9 is left with the claims and checks |
| 15. The aggro target | There is no stored target: every actor's hooks see `ctx.player` = the nearest living player to it, re-bound per actor per tick (`stepActors` -> `ctx.targetNearest`; solo: player 0) | "The same target" for the Jackals' one-at-a-time token and the pack means `nearestLivingPlayer(state, o.x, o.z)` per other Jackal in the scan (`party.ts`; solo: 0 at once). The Mortar's "target in my room" is about its own nearest player: in co-op a Mortar whose nearest player stands in the doorway holds fire even if a farther teammate is inside (NTD3 as written; NT11 note) |

**Owner calls:** none forced. The Design changes above (keep range 6-9 and lob range 10; the landing test on
`isBodyBlocked`; `stepCorpse` for NTD5's on-time landing; `SimConfig.roomIdAt` for NTD3's room) are the smallest
faithful readings of the taken decisions and the Risks' own mitigation; flag any of them back if not wanted.

## NT1 skeleton (as built, 2026-11-16)

- Registry: `PORT_BAND_ENEMIES_4` = 7; `jackal` 24, `mender` 25, `mortar` 26; every older index unchanged
  (`sim/newEnemies3.spec.ts` and the id-list specs: actors, demonlord, dummy, encounterRun, enemyVariants, newEnemies,
  newEnemies2, warbanner, golden).
- `archetypes/{mortar,mender,jackal}.ts`: full `data` blocks (the Design tables as named fields, with NT0 finding 12's
  keep 6-9 / lob 10 for the Mortar), the v slots, states and attack ids, and the `fx` hints (the Mortar's `ring` on
  v[`MORTAR_LAND_X / _Z`] while `MORTAR_FLIGHT`, filling over the flight; the Jackal's wind-up `aimLine` on
  v[`JACKAL_DIR_X / _Z`], 2.8 long). Stub steps: idle / walking home / leashing (enemyShared), and engaged they only
  face their target. No attack, no movement while engaged, no draw (the first cooldowns come with NT2-NT4; a spec checks
  the rng word). Aggro / leash / lost / alert (no plan numbers): Mortar 10 / 16 / unused (0: it never leashes for sight,
  NTD3) / 4.5, Mender 9 / 15 / 2.5 s / 4.5 (the imp's), Jackal 8 / 16 / 2 s / 4.5 (the swarmer's). The Mender's bolt is
  `BulletKind.CASTER` (the medium look, NT0 correction 3); the shell is the Stormcaller's STRIKE spec shape (pierce 6);
  the shrapnel 6 @ `FULL_RING`, speed 3.5, life 1.2.
- Rows: `ENCOUNTER_COST` (mortar 2, mender 2, jackal 1 each), `KILL_POINTS` (120 / 150 / 70), `DROPS.chanceByArchetype`
  (8 / 10 / 4). `ENDLESS_ROOM_KINDS` untouched (NT6): endless rooms spend exactly as before, no replay or hash moves.
- Arc table: Ballista's 6 @ FULL_RING row's `source` names the Mortar's shrapnel; no new row.
- Theme: `ENEMY_ARCHETYPES` + three after `pyre` (placeholders: a thin Cylinder post, a short Capsule robe, a low Wedge;
  colours `#b01840`, `#3848c8`, `#f87880`, >= 26.6 CIE76 from every other enemy colour, the boss accent and the player
  outline, >= 40 from the danger roles; names Mortar, Mender, Jackal); role `enemyHeal` `#608c00` (a bilious moss green,
  theme `newEnemies3.ts` ENEMY_HEAL_ROLE; `healReport` / HEAL_COLOR_RULES in `variantColors.ts`, folded into
  `variantColorProblems`: >= 3:1 on every biome floor, >= 40 CIE76 from the enemy-bullet roles, `telegraph`,
  `enemyOutline`, `enemyAura`, `enemyGuard`, `fx.heal`, `build.counter` and the boosts; lowest placeholder floor 3.66:1,
  nearest `enemyGuard` 40.3, then `fx.heal` 40.9 and `boost.frenzy` 41.1: the greens are crowded and this is about the
  farthest green that clears 40 from all of them); the six SILENT sounds last in PORT_AUDIO_EVENTS (`newEnemies3.ts`
  NEW_ENEMY_3_AUDIO_IDS) with `shared/view/audio` SFX entries, ALL_SFX / PORT_SFX, `SFX_PRIORITY` (lob 44, shell 48,
  lunge 46, beam cut 41, spook 40, heal 37), `SFX_MIN_INTERVAL` (lunge 0.1 s, beam cut 0.15 s) and the plan's
  `SFX_FALLBACK`s (lob -> hook, shell -> blast, beam cut -> block, lunge -> charge; heal and spook none); no
  `art/audio.json` entries yet (NT10). `bestiary.<id>` for the three (the archetypes' block, before the affixes) with
  their shared/onboarding sighting ids and `view/sighting` ARCHETYPE_SIGHTINGS, so the first-sighting wiring is done
  (NT0 finding 14: the Codex entries appear with NT6's rows). `l10n/context.json` entries for the six strings. Vale
  inherits every entry from the placeholder.
- Tail / count specs updated for the six sounds (codex, secrets, silver, fortune, treasure, runRecap, boosts, audio,
  contract, floorModifiers, newEnemies2, view/audio goldenRumourCues), the three archetypes (newEnemies, newEnemies2,
  fortune, enemyVariants, contract) and the three bestiary lines (enemyVariants, fortune, newEnemies2); boosts.spec's
  planted dim green counts only its own errors (the heal is near it too).
- `contract.luau` / `validate.luau` / `sprites.luau` top-level locals unchanged: 189 / 192 / 195 lines (189 / 197 / 195
  names), counted on out/.

## NT2 Mortar (as built, 2026-11-16)

Gameplay (sim), no hash group, no bullet kind, no theme change; the Mortar is still outside the room pool (NT6), so no
endless replay moves yet. Files: `sim/combat/actors/archetypes/mortar.ts` (the behaviour and two exported tests,
`mortarRoomHolds` and `mortarPointOpen`), `actors/types.ts` + `actors/actors.ts` (`stepCorpse`), `sim/step.ts` +
`combat/ctx.ts` (`SimConfig.roomIdAt`, `SimCtx.roomIdAt`), `run/endless.ts` (`endlessFloorWorld` sets it to the world's
own `roomIdAt`, one closure shared with `EndlessRunFloor.roomIdAt`), `sim/state.ts` (`events.shells`,
`NEW_ENEMY_3_EVENT_FIELDS`, appended last to `ALL_EVENT_FIELDS`), `view/fx/variantCueEvents.ts` (the lightning cue counts
`strikes - shells`). Specs: `sim/mortar.spec.ts` (21 cases), `view/fx/variantCueEvents.spec.ts` (+2), and
`sim/newEnemies3.spec.ts`'s stub cases now leave the Mortar out.

- **`stepCorpse`.** In `stepActors`' dead branch, when `stepDead` is absent: `stepCorpse` runs first and a true holds the
  slot this tick; otherwise the corpse timer and the Vengeful hold (`affixHoldsCorpse`) decide exactly as before. No
  other archetype defines it (a spec walks the registry), so every other corpse is byte for byte as before.
- **Room test (NTD3).** The room is `ctx.roomIdAt(home)`; the target (and the Mortar's own position) is inside iff its
  cell's id matches, so a doorway and every corridor cell are outside. Two fallbacks the plan left open: a home outside
  every room by `roomIdAt` (never on a real floor: homes are room spawn tiles) or no callback uses the encounter
  rectangle holding the home; with no such rectangle either (a hand-built arena without rooms) everything counts as
  inside, so the specs' open arenas fire.
- **The release re-checks the room.** The lob starts only with the target in the room (and 3-10 away), and the release
  checks the room again: a target that stepped out during the 0.35 s draw is not fired at (no ring, no shell). The
  cooldown drawn at the draw's start stays spent (the Stormcaller's rule: one draw per lob whatever the lob does).
  Range is not re-checked at the release (the point is fixed there, as planned).
- **Staying in its room.** A keep-range move whose end leaves the room is undone and the strafe side flips (the
  Stormcaller's wall flip); a Mortar standing outside its room (only a Siege pin can drag it there) walks home on the
  steer mover before anything else. A far target pulls it to the room's edge, never past it.
- **Keep range without sight.** The Stormcaller's approach / back-off / strafe, minus the sight branch: no
  walk-to-find-a-line, no `lostTicks` leash (`lostTicks` stays 0, unused). It still engages like every room enemy
  (`stepCalm`: sight within aggro range, an alert, a hit).
- **Too close.** Within `tooClose` 3: a straight back-off (no strafe) at its walk speed, no lob.
- **The flight.** `v[MORTAR_FLIGHT_TICKS]` = 60 at the release and `aiTicks` mirrors it (the `ring` hint fills on
  `aiTicks`). While the shell flies the Mortar keeps range (no new lob) and **neither leashes nor goes calm** until the
  shell has landed, so a drawn ring always gets its shell. The cooldown counts down while keeping range and in flight,
  not during the draw.
- **The impact.** `ctx.fireEnemy` fires the shell (STRIKE, `events.strikes` as before) and `events.shells` adds what it
  fired; then the shrapnel ring from the point, oriented along the Mortar's facing at that tick (a corpse's last
  facing). The point is not re-tested at the impact (fixed and floor at the release; pieces only ever break). Collision
  order: on the impact tick a standing target is hit by ONE of the seven bullets, which may be a shrapnel bullet rather
  than the strike (the i-frames let the rest pass): still one `HIT_NORMAL` (NT11: a shell is a hit for UNTOUCHED either
  way).
- **The corpse (NTD5).** `stepCorpse` counts the flight down on the corpse (no draw) and lands the shell on its planned
  tick, holding the slot until then; afterwards the corpse timer frees it (on the landing tick if the timer already ran
  out). A Mortar killed during the draw has no flight: an ordinary corpse.
- **`events.shells`.** Unhashed, cleared per tick (`clearEvents` / `ALL_EVENT_FIELDS`; LiveRun's frame totals add it).
  `events.strikes` still counts a shell, so the enemy-shoot cue's skip (`gooSpawned + strikes`) is unchanged; the
  shrapnel ring still plays `sfx.enemy.shoot` on the impact tick (NT7 decides). The lightning cue
  (`VariantCueEvents.strikes`) is now `strikes - shells` (spec'd with a real Mortar: 0 lightning over its shells);
  NT7 adds the shell's own cue and every strike reader's look by payload source.
- **Draws.** Exactly one in `init` and one per lob at the draw's start (spec'd tick by tick over 2,400 ticks); none for
  the landing point, the fallback, a call-off or the corpse.
- **Byte for byte without a Mortar.** Run green on the change: `sim/determinism`, `enemies.determinism`,
  `combat.determinism`, `encounterRun`, `runFull`, `runBoss`, `runBullets`, `runPlayer`, `runPlayerDungeon`, `actors`,
  `hash`, `step`, `smoke`, `affixes/affixes`, `run/affixes`, `run/endless`, `run/validate`, `run/slice`, `run/tutorial`,
  `tutorial/*`, `sim/tutorial`, `dungeon/roomPool.lock`, `stormcaller`, `bomber`, `charger`, `summoner`, `slime`,
  `dummy`, `pyrekeeper`, `party`, `enemyVariants`, `newEnemies`, `newEnemies2`, `view/audio/*`, `play/liveRun*`.

## Player experience

1. **Mortar.** A lean demon at the back of the room draws its bow straight up. A ring lights up on the floor ahead of
   you, where you are walking to, not where you stand. A second later the shell lands in it and bursts into a ring of
   shrapnel. It fires over pillars, tombs and bookcases, so the cover that saves you from the Sniper does nothing here.
   Change direction once the ring appears, and stay out of the burst. Leave its room and it stops firing.
   Lesson: cover is not safety; keep moving.
2. **Mender.** A small imp with bone charms raises its arms, and a beam ties it to the most hurt demon in the room. The
   demon's wounds close while the beam holds. Hit the Mender and the beam snaps. Step into the beam yourself and it
   snaps. A pillar between them snaps it too. With nobody to heal, it plinks you with slow bolts.
   Lesson: kill the healer first, or cut the line.
3. **Jackal.** Three lanky beasts lope in a circle round you, never quite in front. The one behind you crouches. Turn to
   face it and it flinches back with a hop; look away and it lunges into your back. Only one lunges at a time, so the
   fight is a rhythm of turning. A Knight who guards into a lunge knocks it reeling.
   Lesson: watch your back, and turn at the right moment.
4. **First sighting** (EVD10's toast) and a Codex entry for each of the three.

## Design

All three are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts, `walkStep` / `enemyCooldown`, the
Warbanner's aura and the affixes apply) and start every attack through `ctx.telegraph`. Numbers are starting values,
tuned in NT12. Speeds are units per second; angles are cosines (literals, no trig in the sim). The player walks at 6.

### Mortar

| | |
|---|---|
| Body | 4 hp, r 0.35, 2.2, contact 0 |
| Engaged | Keeps **6-9** from its target (NT0 finding 12: 7-11 put it off screen; the stormcaller's keep-range walk and strafe side), staying inside its own room. It needs **no line of sight** to keep range or to fire, but it fires **only while its target stands in the Mortar's own room** (NTD3; NT0 finding 10: the room is `ctx.roomIdAt` of its home, the target is inside iff `ctx.roomIdAt(target)` is that room, so a doorway and every corridor cell are outside, exactly where the room edge's dashed line is; a new optional `SimConfig.roomIdAt` set by `run/endless.ts`, the encounter rectangle without it). Target outside: no lob, it holds its range from inside the room. It leashes only by home distance (`shouldLeash`), never for lost sight |
| Lob | Cooldown 3.2-4.2 s out, target in the Mortar's room, within **10** (NT0 finding 12) and at least 3 away: **draw** 0.35 s (`ctx.telegraph`). On release the landing point is fixed: target + `(x - prevX, z - prevZ)` x `leadTicks` (the flight's 60 ticks x `leadShare` 0.6 = 36), the lead clamped to `maxLead` 3.0 (scaled by `maxLead / len` when longer; one sqrt). If the point's cell is not floor (wall, void, pool, solid decor, an intact piece: `ctx.isBodyBlocked` or a `solidCells` cell, NT0 finding 5; not the Stormcaller's `isBlocked` test, which lets a pool through), the target's own position is used instead (always floor). Then **flight** 1.0 s: the `ring` hint (radius `STRIKE_BULLET_RADIUS`) sits on the point and fills |
| Impact | On the flight's last tick: one `STRIKE` bullet at the point (the Stormcaller's rules: no grazes, never erased, hurts `HIT_NORMAL` once), then **shrapnel**: 6 @ FULL_RING from the point (the existing port row), speed 3.5, life 1.2 s, `HIT_NORMAL`. The shrapnel is ordinary enemy bullets: walls and pieces stop it, the guard erases it, it grazes |
| Too close | Within 3 of its target it does not lob; it backs off at its walk speed |
| Draws | First cooldown in `init`; one per lob (the next cooldown). The landing point uses no draw |
| v[] (3-7) | 3-4 landing x / z, 5 flight ticks left, 6 strafe side (+1 / -1), 7 free |
| Cost / points / drop % | 2 / 120 / 8 |
| Unlock / weight / per room | NTD7 / 1 / 2 |

A Mortar killed mid-flight: dead actors are not stepped, so its flight timer stops and the shell would never land.
NTD5: the shell **lands anyway**, so a visible ring never lies: the corpse finishes the flight and lands it
on time, the way a Vengeful corpse holds its pending ring (`affixHoldsCorpse` in `actors.ts`). Not through `def.stepDead`: defining it
marks an archetype as a reviver, which `runOnKill` and `dropsOnKill` treat differently. NT0 finding 6: the hold alone
cannot step a corpse (the Vengeful ring is fired by `stepAffixes`, a system of its own), so NT2 adds an optional
`ArchetypeDef.stepCorpse?(ctx, actor): boolean`, called in `stepActors`' dead branch only when `stepDead` is absent;
true holds the slot past its corpse timer. The Mortar's counts v5 down and lands the shell on its tick, then lets the
slot go. No other archetype defines it (every other path unchanged); not a reviver. No draw.

### Mender

| | |
|---|---|
| Body | 5 hp, r 0.35, 2.6, contact 0 |
| Engaged | Keeps 5-8 from its target. With a wounded ally, it walks to stay within `healRange` 6 of that ally instead |
| Pick | Every 15 ticks while not channelling: the **most wounded eligible ally** within `healRange` and in sight (`ctx.lineOfSight`): a living room enemy (`RoomEnemyData`) with `hp < hpMax`, never a Mender, never a boss, the Goldling, the dummy or a pyre (NTD8). Most wounded = lowest `hp / hpMax`, compared by cross-multiplying (no division); ties go to slot order |
| Channel | **Link** 0.4 s (`ctx.telegraph`: the beam forms; it stands still facing the ally), then **channel** up to 3.0 s, standing still: every 30 ticks the ally gains 1 hp (never above `hpMax`). The channel **ends** when: the ally is full or dead; sight is lost; a living player's centre is within `PLAYER_RADIUS` + 0.15 of the segment between them (body block; between the end points only); the Mender takes any damage (a 0.4 s flinch follows); the 3.0 s are up. Then cooldown 1.2-1.6 s |
| Bolt | No wounded ally and its target in sight within 9: one aimed bolt every 2.2-2.8 s, speed 4.5, life 2.5 s, `HIT_NORMAL` |
| Draws | First cooldown in `init`; one per channel end (the next cooldown); one per bolt |
| v[] (3-7) | 3 ally's actor id (0 none), 4 channel ticks, 5 pulse timer, 6 strafe side, 7 hp healed this life (scratch, hashed like every v slot; read by the view and NT12) |
| Cost / points / drop % | 2 / 150 / 10 |
| Unlock / weight / per room | NTD7 / 1 / **1, never the room's first buy** (`needsCompany`) |

The heal is the only write. Score, combo, room records and drops never see it: a healed enemy pays its normal kill
points once. Unhashed `events.heals` (ally slot, amount) feeds the view's `+` sparks.

### Jackal

| | |
|---|---|
| Body | 3 hp, r 0.32, 4.6, contact 0 |
| Pack | Bought as a **pack of three** (one buy; NTD6). The pack is every living Jackal with the same aggro target: no pack id is stored |
| Engaged | **Circles** its target at 3.0-3.6: each tick the walk is the tangent (side +1 / -1 from the actor id's parity, no draw) plus a radial pull back into the band, plus a push away from every other Jackal within 1.4 (slot order), normalised, through `walkStep` with the steer mover |
| Lunge | When the cooldown is out, **no other Jackal on the same target is in its wind-up or lunge** (a slot-order scan), and the Jackal is **outside its target's front cone** (`dot(face, toJackal) < frontCos` 0.34, about 70 degrees either side): **wind-up** 0.35 s (`ctx.telegraph`, crouch, `aimLine` length 2.8 at a heading locked at the start) |
| Spooked | If during the wind-up the target's facing turns onto it (`dot >= spookCos` 0.5), the lunge is **called off**: a hop back 1.2 units over 0.2 s (`moveActor`), cooldown 0.6 s. No draw |
| Strike | Otherwise **lunge** 2.8 units over 0.18 s along the locked heading; the first overlap with its target hurts `HIT_NORMAL` once (the swarmer's hit bit). Then **recover** 0.5 s |
| Guard (NTD9) | A sword guard that is up while the lunging Jackal overlaps the player, with the Jackal inside the guard's sweep, refuses the hit and **staggers** it 1.0 s (still, takes full damage). It **counts as a parry**: the stop pushes the guard's entry on the unhashed `ScoreEvents` feed (`guardX/Z/Player`, the feed the sword's bullet erases use, docs/GRAZE_PARRY.md), so the near-miss director, the parry sparks, the PARRY! floor text and its solo freeze, the recap's and contribution screen's parry counts and the parry haptic all see it with no new path. Scored runs only, like every parry |
| Last of the pack (NTD10) | **Keeps the back-only rule**: a lone Jackal still lunges only from outside its target's front cone. Facing it holds it off; it dies to 3 hp of damage like any Jackal |
| Draws | First cooldown in `init`; one per lunge (cooldown 1.4-2.0 s). A spook draws nothing |
| v[] (3-7) | 3 phase ticks (hop / recover / stagger), 4-5 lunge heading, 6 hit bit, 7 free |
| Cost / points / drop % | 1 each (a pack is 3) / 70 each / 4 |
| Unlock / weight / per room | NTD7 / 1 / **1 pack** |

Shared safety rules (docs/NEW_ENEMIES.md's): no landing point, heal target or circling step is placed by a draw beyond
the documented draws per attack, so the draw count never depends on the layout. Every rule keys off the actor's aggro
target. Affixes apply to all three as planned spawns (a Swift Jackal, a Hulking Mender, a Vengeful Mortar).

## Architecture

### 1. Sim

- `sim/combat/actors/archetypes/{mortar,mender,jackal}.ts`, each a copy of the nearest shape (never an import):
  mortar <- stormcaller (keep range, strafe, `STRIKE`) + bomber (a ring from a point); mender <- summoner (keep range,
  ally scans) + caster (bolt); jackal <- swarmer (lunge, hit bit) + golden (steer mover walk).
- `registry.ts`: `PORT_BAND_ENEMIES_4 = 7`, band comment updated.
- **Shell**: `STRIKE` unchanged. The Mortar's impact fires it with the Mortar's payload source; NT0 confirms
  `events.strikes` and the cue mapper can tell a shell from lightning (else a second count `events.shells`, unhashed).
- **Heal**: `healActor(ctx, a, n)` in `actors.ts` (clamps to `hpMax`, pushes `events.heals`), called only by the
  Mender. Never through `damageActor`, so no cap bucket, flash or build proc moves.
- **Facing test**: a small pure helper `behindPlayer(p, x, z, frontCos)` (no sqrt: compares `dot` against
  `frontCos x len` with both sides squared, sign checked).
- **Guard stop**: the Jackal's hit site reads the target's sword slot (`swordGuard` > 0) and the guard's sweep cone
  (`swordGuardSweepCos` for that player: Bastion's full ring included). A stop pushes one `guardX/Z/Player` entry on
  `ScoreEvents` (NTD9: a parry), exactly as an erased bullet does. It does not count toward Riposte's erased-bullet
  count or Bastion's brace (they count bullets); NT11 confirms that reads right in play.
- **Room test**: the Mortar's "target in my room" (NT0 finding 10): optional `SimConfig.roomIdAt` (set by
  `run/endless.ts` `endlessFloorWorld` to `roomIdAt(d, x, z)`), `ctx.roomIdAt(x, z)` (-1 without it); the room is that
  of the Mortar's home, the target is in it iff its cell's room id matches. Without the callback, the encounter room's
  rectangle (`ctx.roomAt(home)`), the score's engagement test.
- **Dead flight** (NTD5, NT0 finding 6): optional `ArchetypeDef.stepCorpse` (see Mortar).
- **Shell count** (NT0 finding 3): unhashed `events.shells` (shells fired this tick; `events.strikes` still counts them)
  so the cue mapper plays the lightning only for `strikes - shells`.
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype`.

### 2. Dungeon (`shared/dungeon`)

- `EndlessRoomKind.packOf?: number` (absent = 1). `spendEncounterBudget`: a pack kind is open only when
  `cap - out.size() >= packOf`, costs `packOf x encounterCost(kind)`, and pushes `packOf` entries; `bought` counts
  packs, so `maxPerRoom` 1 means one pack. With no pack kind open, every draw is as today.
- `populateEndlessRoom`: the swarmer's anchor-and-nearest placement becomes a map of pack sizes (`swarmer` 4 as today,
  `jackal` 3). A Jackal pack always starts a new anchor (its `spreadTile` draw, as a new swarmer pack does).
- `ENDLESS_ROOM_KINDS` appended (never reordered): `mortar` 1 (cap 2), `mender` 1 (cap 1, `needsCompany`), `jackal` 1
  (`packOf` 3, cap 1). `rosterOrder` shuffles 17 kinds.
- `roomPool.lock.spec` (floor 1 without a roster unchanged), `roster.spec`, `rosterLine.spec`, `daily.spec` and the
  determinism pins that record endless floors re-pinned. `DAILY.ruleset` 21 -> 22.

### 3. Theme contract

- `ENEMY_ARCHETYPES` += the three ids (asset, colour role, `.name`); placeholders from the enemy palette (a thin
  cylinder with an upturned bow, a short robe with a halo ring, a low wedge). Display names Mortar, Mender, Jackal.
- One colour role `enemyHeal` (the beam and the `+` sparks): a sickly green, >= 40 CIE76 from the enemy-bullet roles,
  `telegraph`, `enemyOutline`, `enemyAura`, `enemyGuard`, the player's `fx.heal`, `build.counter` and the boosts, so it
  never reads as the player's own heal. Folded into an existing report (`guardReport`'s module).
- Bullet looks: the Mortar's shrapnel maps to the small look, the Mender's bolt to the medium. The shell draws as the
  `STRIKE` disc in v1 (NTD12); optional hazard art `bullet.enemy.shell` later.
- Port audio IDs, appended after `sfx.enemy.pyrelight`, SILENT in the placeholder with `SFX_FALLBACK`s:
  `sfx.enemy.lob` (-> `sfx.enemy.hook`), `sfx.enemy.shell` (-> `sfx.enemy.blast`), `sfx.enemy.heal` (no fallback: the
  beam carries it), `sfx.enemy.healcut` (-> `sfx.enemy.block`), `sfx.enemy.lunge` (-> `sfx.enemy.charge`),
  `sfx.enemy.spooked` (no fallback).
- Strings: three `enemy.<id>.name`, three `bestiary.<id>`, each with an `l10n/context.json` entry.

### 4. View and client

- Mortar: the bow drawn skyward (`Attack 4` segments: draw, release), a view-only shell arc from its hand to the ring
  over the flight (the Pyre-keeper's torch arc), the ring filling, a dust burst and the shrapnel on impact.
- Mender: `Attack 1` / `Attack 3` looped while channelling (`ActorAttack.loop`); a tether from its hands to the ally in
  `enemyHeal` (one Beam or a pooled run of parts, the Chainhook's chain), a soft pulse every 30 ticks, `+` sparks on
  the ally; a snap when the channel is cut. The tether is drawn from v3 (the ally's id), so it needs no sim hint.
- Jackal: `Run` while circling, `Crouch` held over the wind-up, `Attack 2` or `Run Attack` for the lunge (marks measured
  in NT8), `BackFlip 1` for the spooked hop, `TakeDamage` slowed for a stagger. A faint arc on the floor behind the
  player is **not** drawn (the lesson is to read the crouch).
- Cue mapper rows for the six sounds; `minInterval` on lunge (0.1 s) and healcut.
- First sighting: three ids into `SIGHTING_IDS` / `ARCHETYPE_SIGHTINGS` before the affix ids (NE1's rule).
- Codex: three `enemy:<id>` entries after `enemy:pyrekeeper` (the second list does it; catalogue 91 -> 94).

## Tasks

- **NT0. Audit (read-only).** Confirm every row of "What the code gives us" on the branch point. List every reader of
  `ENCOUNTER_COST` and check a pack of three costs right in each (Horde's wave, the score record's cost and par, the
  treasure SWIFT par); every reader of `events.strikes` (the cue mapper, the hazard view, the power pellet's and the
  guard's skips) and whether a shell needs its own count; how bosses, the Goldling, the dummy and pyres are told apart
  in data (for NTD8); whether a corpse hold like the Vengeful affix's (`affixHoldsCorpse`; never `def.stepDead`, which
  marks a reviver) can finish a dead Mortar's flight (NTD5); whether `prevX` is the tick-start position for a player
  that rolled or was dragged by a Chainhook (the lead must never jump); the Mortar's keep range against
  `VIEW_TILES_HIGH` in landscape and portrait. Re-render the contact sheet of the three
  rigs at full size with `Crouch`, `BackFlip 1`, `Attack 1-4` and `Run` (gitignored `art/build/contact/`). Write the
  plan into `docs/NEW_ENEMIES_3.md` and add its row to CLAUDE.md's Documents table.
  **Verify:** findings written under "NT0 findings".
- **NT1. Registry, data and contract skeleton.** Band 7, three ids with stub steps, data rows, `ENEMY_ARCHETYPES` +
  placeholders + strings, `enemyHeal`, the six SILENT sounds (`codex.spec` tail and the listed skips updated), the arc
  row's comment.
  **Verify:** indices 24-26 and every older index unchanged; `contract.luau` / `validate.luau` compile under Lune within
  200 locals; `npm run verify` green; every fixture, M1 and tutorial lock unchanged.
- **NT2. Mortar.** Keep range without sight, draw, landing point and its fallback, flight, impact, shrapnel, too-close
  back-off, NTD5's death rule.
  **Verify:** specs: no lob while the target stands outside the Mortar's room (a corridor included); the landing point leads a walking target by exactly `leadTicks` of its last tick's motion and
  never more than `maxLead`; a point on a wall, a pillar or a crate falls back to the target; a target behind a pillar
  is still hit; a standing target is hit at its feet; the shrapnel is erased by a guard and the strike is not; exactly
  one draw per lob.
- **NT3. Mender.** Pick, link, channel, every end rule, flinch, bolt.
  **Verify:** specs: it heals the most wounded ally by ratio and never above `hpMax`; never a boss, the Goldling, a pyre
  or another Mender; a player standing on the beam, a pillar between them or one hit on the Mender ends the channel; a
  healed ally pays its normal kill points once; `damageActor`'s cap buckets and build procs never see a heal.
- **NT4. Jackal.** Circling, separation, the one-at-a-time token, the front-cone rule, wind-up, spook, lunge, recover,
  guard stop, the last-of-the-pack rule.
  **Verify:** specs: a player who keeps facing a Jackal through its wind-up is never hit by it; one who faces away is;
  at most one Jackal per target is ever in wind-up or lunge; a guard into a lunge staggers it and the player takes no
  damage and the parry feed gets one guard entry; a spook draws nothing; a lone Jackal still never lunges from inside
  its target's front cone.
- **NT5. Packs in the spender.** `packOf`, the pricing and cap rule, pack placement.
  **Verify:** floor 1 without a roster spends draw for draw and tile for tile as before (`roomPool.lock.spec`); a room
  with a pack holds three Jackals on neighbouring tiles; a room with 2 or fewer free slots never buys one.
- **NT6. Room pool and roster.** Append the kinds, caps, `needsCompany`, NTD7's minimum floors; re-pin locks; ruleset
  bump; census of floors 1-20 x run seeds 1-60 (kinds per room, room cost, shells and heals per room), like NX6.
  **Verify:** census table written.
- **NT7. View (placeholders).** Shell arc and ring, impact burst, heal tether, pulses and sparks, the Jackal's crouch
  and hop, the stagger, cue rows.
  **Verify:** view specs (the tether only while a channel is live and only to a living ally; a shell's strike never
  plays the lightning look or sound; `enemyBulletLookOf` maps shrapnel small and the bolt medium).
- **NT8. Art.** Three sets in `art/atlases.json` (the NE9 / NX8 recipe: grid 128, body over `Shadows/`, pad 3, 2 px
  rim, per-sheet cells), marks measured on the frames, `bodyTiles` against the knight (the Jackal checked at pack size
  three), the extra animations (`crouch`, `hop`) through the optional enemy animation slots.
  **Verify:** `test:art`, two `art:build`s byte-identical, older outputs unchanged, `vale.spec` cases; upload list.
- **NT9. Strings, first sighting, Codex.** `bestiary.<id>`, l10n context, sightings, the three Codex entries.
  **Verify:** `l10n:check`, `check:autolocalize`, `catalog.spec` green (the lock extended, never reordered).
- **NT10. Audio.** Candidates from Ninja Adventure and Kenney (a bowstring and whistle for the lob, a thump for the
  shell, a low hum for the heal, a snap for the cut, a snarl for the lunge, a yelp for the spook); `audio:audition`,
  `audio:lock`, `audio:build`.
  **Verify:** `audio.lock.json` updated; vale sounds switch on only with every file's id.
- **NT11. Builds and systems pass.** Each kind against builds (Siege Bolt pinning a channelling Mender or a lunging
  Jackal; Riposte's wave through a pack; Overkill streaks), Horde waves (a copied pack, a copied Mender), treasure
  locks (a shell is a hit for UNTOUCHED), the Shieldwall (it covers a Mender; a beam through it), the Chainhook (a
  drag into a ring), the Warbanner (its aura on cooldowns), co-op (one Jackal pack on two players), floor modifiers
  (Blood Moon affixes on a pack).
  **Verify:** a spec per interaction that has a rule; a note per one that does not.
- **NT12. Tuning.** Bot and census runs: room time against par, TTK per kind for Knight and Archer, hits per kind, how
  often a shell lands on a moving bot, heal per Mender life, Jackal hits per pack for a bot that faces its nearest
  enemy versus one that never turns.
  **Verify:** "NT12 tuning (as built)" table; owner calls listed.
- **NT13. Upload and Studio check.** Owner uploads (art, audio); checklist per kind (the ring readable on every biome,
  the lead fair at 4G latency, the tether readable through a crowd, the spook window on a simulated 4G link with
  prediction on, touch auto-target against a pack).
- **NT14. Docs.** CLAUDE.md decision log entry, the doc's "as built" notes, docs/NEW_ENEMIES_2.md cross-link.

## Edge cases

- **Mortar and a standing player.** The lead is zero: the ring is on your feet. Fair, because standing still is the
  thing it punishes.
- **Mortar's lead across a wall.** A lead point inside a wall falls back to your position; a point on floor on the far
  side of a thin wall stays (you were walking into it anyway). NT2 checks a corridor mouth.
- **Two Mortars.** Cap 2 per room; their rings can overlap. NT12 measures the peak.
- **Mender heals a Hulking or Shielded ally.** The heal is hp only; a Shielded ally's shield row is untouched.
- **Two Menders.** Cap 1 per room; across rooms they never see each other's allies (heal range and sight).
- **Mender and the Ooze's slimelets.** They are room members: healable. A 1 hp swarmer is never wounded.
- **Jackal and touch auto-target.** Auto-target faces the nearest enemy, often one Jackal; the other two are then behind
  you. Fine by design; NT13 checks it feels fair on a phone.
- **Jackal in co-op.** It reads its target's **merged** facing, which arrives one input lead late (up to 20 ticks on a
  4G link against a 21-tick wind-up). See Risks.
- **A lone Jackal held off.** A player who keeps facing the last Jackal is never lunged at (NTD10); the room still
  clears when they kill it, and a teammate or the other enemies still pressure them. NT12 checks it does not stall
  rooms for a bot that faces its nearest enemy.
- **Mortar target in a doorway.** The doorway cell belongs to the corridor, not the room, so a player standing in it is
  safe from that Mortar (NTD3). NT2 pins which cells count.
- **Jackal pack split across a doorway.** Separation and circling can push one into a corridor; it keeps circling its
  target there. Leash rules as for every room enemy.
- **A pack where only two fit.** The spender never buys a pack into fewer than three free slots; placement stops early
  only when a room runs out of tiles, as for swarmers.
- **M1 and the tutorial.** No new kind is in their pools; nothing changes.

## Decisions (2026-11-16, Kaleb)

- **NTD1. Ids and band:** `mortar`, `mender`, `jackal`; band 7 (indices 24-26).
- **NTD2. Rigs:** Spawn 6 (Mortar), Imp 10 (Mender), Beast 2 (Jackal); the alternates kept for a swap.
- **NTD3. The Mortar fires without line of sight, but only while its target is in the Mortar's own room;** it never
  leashes for lost sight. (Owner's pick over firing from anywhere.)
- **NTD4. The shell is the Stormcaller's `STRIKE`** (unguardable, no grazes) plus a 6-bullet guardable shrapnel ring.
  No new bullet kind.
- **NTD5. A Mortar killed mid-flight still lands its shell,** on time through a corpse hold like the Vengeful
  affix's, else at once.
- **NTD6. Jackals are bought as one pack of three** (`packOf`), costing 1 each.
- **NTD7. Minimum floors:** none for the Mortar and the Jackal; **floor 2 for the Mender**
  (`ROOM_KIND_MIN_FLOOR`), so the first floor never shows a healer before the player has learned kill order.
- **NTD8. The Mender heals room enemies only:** never a boss, the Goldling, the dummy, a pyre or another Mender.
- **NTD9. A sword guard stops a Jackal's lunge,** staggers it 1.0 s and **counts as a parry** (the `ScoreEvents`
  guard feed: sparks, PARRY!, recap, contribution, haptics). (Owner's pick over a stop that is not a parry.)
- **NTD10. The last Jackal of a pack keeps the back-only rule.** (Owner's pick over lunging from any side.)
- **NTD11. Weights 1 / 1 / 1 appended; caps 2 / 1 / 1 pack;** the existing fifteen weights never change.
- **NTD12. No new bullet art in v1:** shrapnel small, bolt medium, the shell as the strike disc (hazard art later).
- **NTD13. First-sighting toast and Codex entry for all three.**
- **NTD14. Boards stay `_v1`; `DAILY.ruleset` 21 -> 22.**

## Risks

- **The Jackal's facing in co-op.** The sim reads merged facing, one input lead late, while your own knight is drawn
  ahead by local prediction. A turn you see on screen can arrive after the spook window closes. Mitigation: NT13 on a
  simulated 4G link; if it fails, a longer wind-up in party runs (`partyWindupTicks`, from the party size, no draw) or
  a spook cone that also counts the aim input sent this tick. Solo is exact.
- **Parry inflation.** A Jackal stop counts as a parry (NTD9), so parry counts on the recap and contribution screens
  rise in Jackal rooms. Expected; the near-miss director already groups parries per guard, so one guard is one parry.
- **The Mortar off screen.** A shell from a Mortar the camera cannot see is unfair. Mitigation: the ring is drawn whatever
  the camera sees, and NT0 checks the 7-11 keep range against `VIEW_TILES_HIGH` (shorten it if the Mortar would stand
  off screen); NT13 checks portrait framing.
- **Healing stalemates.** A Mender behind a Shieldwall could undo a slow player's damage indefinitely. Mitigation: any
  hit cancels the channel, 1 hp per 0.5 s, 3 s channels with a cooldown, a body block, cap 1 per room; NT12 measures
  heal per life.
- **Pack density.** Three bodies for one buy in a 16-actor cap. Mitigation: a pack is priced 3 and capped at one per
  room; NT6's census shows the actor counts.
- **Roster churn.** Every endless seed's roster reshuffles again and a new daily ruleset starts new day boards.
  Expected.
- **Codex order lock** and the `PORT_AUDIO_EVENTS` tail specs: NT1 / NT9 own them.

## Out of scope (later plans; art noted)

- The rest of the brainstorm: **Ricochet** (Spawn 2, bouncing balls: a new bullet kind), **Javelineer** (Spawn 13,
  spears that stick as short-lived cover), **Glutton** (Beast 4, `Eat`: eats corpses to heal and grow), **Lurker**
  (Spawn 12, crouched ambusher), **Wyrm** (Beast 5, sweeping flame).
- Champions or a third boss on the five unused Elites: **Warlord** (Elite 4, `Point`: marks a player for the room),
  **Duelist** (Elite 5, counters your swing), **Twinblade** (Elite 1, after-images).
- Hazard art for the shell (NTD12); a Jackal stop counting toward Riposte or Bastion's brace.
