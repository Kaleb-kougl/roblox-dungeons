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

**NT0-NT7 and NT9 done** (see "NT0 findings": four small Design changes, no decision changed; "NT1 skeleton (as
built)"; "NT2 Mortar (as built)": the Mortar's behaviour, `ArchetypeDef.stepCorpse`, `SimConfig.roomIdAt`,
`events.shells`; "NT3 Mender (as built)": the Mender's behaviour, `healActor`, `events.heals` / `healCuts` and
`CombatState.healEvents`, two data fields the plan left open; "NT4 Jackal (as built)": the Jackal's behaviour, the
locked target `JACKAL_TARGET` (a co-op finding), `lungeRange`, `events.lunges` / `spooks`; "NT5 packs (as built)":
`EndlessRoomKind.packOf`, the spender's pack rule and placement, an optional `kinds` table for specs; "NT6 room pool
and roster (as built)": the three rows, the Mender's floor 2, 17 seeded kinds, `DAILY.ruleset` 22, Codex 94, the
re-pins and the census; "NT7 view (as built)": the shell told from lightning in every strike reader, its arc and a
corpse's ring, the heal tether, the Jackal's sprite contract (`crouch` / `hop`), the cue rows; "NT9 strings, sightings
and Codex (as built)"). **NT8 art built, NT10 audio sourced** ("NT8 art (as built)": three sets, upload pending, the
Jackal drawn at bodyTiles 1.2 instead of the knight's density; "NT10 audio (as built)": six unconfirmed picks in
`art/audio.json` and the lock, the build and upload left to the owner). Next: NT11-NT13; the owner's uploads (20 PNGs,
six OGGs after `audio:build`).
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

## NT3 Mender (as built, 2026-11-16)

Gameplay (sim), no hash group, no bullet kind, no theme change; the Mender is still outside the room pool (NT6), so no
endless replay moves yet. Files: `sim/combat/actors/archetypes/mender.ts` (the behaviour; exported `isMenderHealTarget`,
`menderPick`, `menderBeamBlocker`, `menderAllyOf`, `menderLinked`), `actors/actors.ts` + `combat/ctx.ts` (`healActor`,
`SimCtx.healActor`), `combat/healEvents.ts` (new: `HealEnd`, `healEndCuts`, `HealEvents`), `combat/combat.ts`
(`CombatState.healEvents`, created / cloned like `hookEvents`), `sim/step.ts` (cleared beside `hookEvents`),
`sim/state.ts` (`events.heals`, `events.healCuts`, appended to `NEW_ENEMY_3_EVENT_FIELDS` after `shells`). Specs:
`sim/mender.spec.ts` (19 cases), `sim/newEnemies3.spec.ts` (the stub cases leave the Mender out; the two new data
fields pinned).

- **The heal.** `healActor(ctx, a, n)` (actors.ts, through `SimCtx.healActor`): a live actor only, `hp = min(hpMax, hp +
  n)`, returns what it restored; `events.heals` += it and one `CombatState.healEvents` entry (the actor's slot, the hp).
  It never calls `damageActor`, so no cap bucket, flash, `onHit`, score, combo, Vampire Fang, drop or build proc sees it
  (spec'd in an endless arena with scoring, builds, drops and affixes on); a healed ally pays its normal kill points
  once (spec'd equal to an unhealed twin's).
- **The feed.** The plan's "`events.heals` (ally slot, amount)" is two parts, as the Chainhook's is: the scalar
  `events.heals` (hp healed this tick; `SimEvents` holds numbers only) and the lists in `CombatState.healEvents`
  (`healSlot` / `healAmount` per pulse, `endSlot` / `endReason` per link or channel end, `HealEnd` FULL / TIME /
  ALLY_GONE / LEASH / DEATH / SIGHT / BLOCKED / DAMAGE). `events.healCuts` counts the ends that are cuts
  (`healEndCuts`: SIGHT, BLOCKED, DAMAGE), so NT7's snap and `sfx.enemy.healcut` need no state diffing. Unhashed,
  cleared per tick, never read back by the sim.
- **NTD8.** `isMenderHealTarget(kind)` = `isRoomEnemyData(data) && data.boss !== true && kind !== mender` (warbanner.ts
  `isWarbannerAuraTarget`'s shape, NT0 finding 4). A registry walk pins it; the Goldling, the dummy, a pyre, both
  bosses, the turrets and another Mender are never picked (spec'd with wounded look-alikes beside a Mender for 600 ticks:
  no heal, only bolts).
- **The pick.** Every `pickEveryTicks` (15) while keeping range (v5 is the pick timer outside the channel, the pulse
  timer inside it): the lowest `hp / hpMax` by cross-multiplication, ties by slot order, among living heal targets below
  hpMax within `healRange` (inclusive) and in sight. The pick is kept in v3 between picks (it is the ally the Mender
  follows), dropped at once when that ally dies or is full again.
- **One cooldown for both actions (decision; the plan is silent).** `a.cooldown` gates the link and the bolt alike, so the
  Mender does one thing at a time: init draws the first (a bolt's range, 2.2-2.8 s), a channel end draws 1.2-1.6 s, a
  bolt 2.2-2.8 s. So a heal can wait up to 2.8 s after a bolt: a window to finish a freshly wounded ally. The cooldown
  counts down while keeping range and flinching, not while linking, channelling or winding up a bolt.
- **The link** starts when the cooldown is out and the picked ally is still wounded, within `healRange`, in sight and
  not body-blocked (the end rules are checked first, so a link never starts already cut), then `ctx.telegraph`
  `linkTicks` (24) with `MENDER_ATTACK_HEAL`. The link and the channel stand still facing the ally. Range is not an end
  rule (the plan's list): an ally that walks off keeps its beam while sight and the body rule allow.
- **The channel.** The first pulse 30 ticks after the link, then every 30 (6 in the 180), `healAmount` 1 each, clamped
  (spec'd: 7.5 / 10 heals 1, 1, 0.5 and ends FULL on the pulse that fills it). End rules, checked every link and channel
  tick in this order: the ally dead or gone, full, sight lost (`ctx.lineOfSight`: walls and pillars; breakables never
  block sight, so a crate does not cut it), a living player's centre within `PLAYER_RADIUS` + `beamBlockPad` of the
  segment where it projects between the two ends (`menderBeamBlocker`; any player, so a teammate body-blocks in co-op,
  spec'd; a dead one does not), then the 180 ticks up. A hit is `onHit`'s (below); a leash ends it (`HealEnd.LEASH`).
  Every end but the Mender's death draws ONE cooldown (`channelCooldownMin`-`Max`), clears the ally and re-picks on the
  next keep tick.
- **A hit (decision).** Any hit that reaches `damageActor` cuts the link or the channel (`HealEnd.DAMAGE`), including
  one a Shielded affix soaks up whole (`onHit` with 0 damage): "hit the Mender and the beam snaps". A hit that a
  Shieldwall's shield stops never reaches `damageActor` and cuts nothing (NT11). Then `MENDER_FLINCH` for `flinchTicks`
  (24), standing still. A killing hit is the death: `onDeath` pushes `HealEnd.DEATH`, no draw, and clears v3 / the
  state, so the corpse never reads as linked.
- **The bolt.** Cooldown out, no ally, its target alive, in sight and within `boltRange` 9: one cooldown draw, a short
  wind-up (decision: a new data field `boltWindupTicks` 18 = 0.3 s through `ctx.telegraph` with `MENDER_ATTACK_BOLT`,
  since every attack starts through a telegraph and the view needs a pose), then one aimed `BulletKind.CASTER` at the
  target's position at the release (sight not re-checked). The strafe side flips after every bolt.
- **Movement (decision on "stay within healRange").** Without an ally: keep 5-8 with the summoner's strafe; without
  sight of its target it walks toward it to find a line and leashes after `lostTicks` 2.5 s (aiTicks counts them, the
  Stormcaller's way). With an ally: a new data field `followSlack` 1, it walks to the ally (steer mover) while farther
  than `healRange - followSlack` (5), so the next pick still finds it in range; nearer, it keeps its range from the
  target but undoes a move that would take it past 5 from the ally (the strafe side flips). An ally keeps it from
  leashing for lost sight of the target.
- **Pinned (decision).** A Siege-pinned Mender does not step (every actor's rule): its link, channel, flinch and cooldown
  wait while it is held. The pinning arrow hits it first, so a channel is cut (DAMAGE) before the pin holds it; no
  special case. NT11 checks it in play.
- **Draws.** Exactly one in `init`, one per channel end (any reason but its death; also a hit from outside the actor
  phase, drawn where `onHit` runs) and one per bolt at the wind-up's start; none for the pick, the heal, the movement or
  the death. The spec checks this on every tick of every scenario (the allies frozen so only the Mender draws).
- **Byte for byte without a Mender.** Run green on the change: `sim/determinism`, `enemies.determinism`,
  `combat.determinism`, `encounterRun`, `runFull`, `runBoss`, `runBullets`, `runPlayer`, `runPlayerDungeon`, `actors`,
  `hash`, `step`, `smoke`, `affixes/affixes`, `run/affixes`, `run/endless*`, `run/validate`, `run/slice`, `run/tutorial`,
  `tutorial/*`, `sim/tutorial`, `dungeon/roomPool.lock`, `stormcaller`, `bomber`, `charger`, `chainhook`, `summoner`,
  `slime`, `dummy`, `pyrekeeper`, `party`, `enemyVariants`, `newEnemies`, `newEnemies2*`, `newEnemies3`, `mortar`,
  `view/audio/*`, `view/fx/variantCueEvents`, `play/liveRun*` (818 tests in 66 files; with `mender` 837 in 67).

## NT4 Jackal (as built, 2026-11-16)

Gameplay (sim), no hash group, no bullet kind, no theme change; the Jackal is still outside the room pool (NT6), so no
endless replay moves yet. Files: `sim/combat/actors/archetypes/jackal.ts` (the behaviour; exported `jackalBehind`,
`jackalHoldsToken`, `jackalTokenFree`, `jackalGuardStops`, v slot `JACKAL_TARGET`), `sim/state.ts` (`events.lunges`,
`events.spooks`, appended to `NEW_ENEMY_3_EVENT_FIELDS` after `healCuts`), `sim/score/score.ts` (the `guardX` comment).
Specs: `sim/jackal.spec.ts` (17 cases), `sim/newEnemies3.spec.ts` (the NT1 stub cases are gone: every kind has its own
spec now; `lungeRange` pinned).

- **Circling.** The tangent (side from the actor id's parity) plus a radial pull `(dist - mid) / half` toward the middle
  of the 3.0-3.6 band (decision: "a pull back into the band" read as a pull to its middle, equal to the tangent at the
  band's edges and dominant far out; a pull that starts only outside the band leaves a circling Jackal at ~3.61, where
  the lunge misses a standing player), plus the separation push (each Jackal within 1.4 by its overlap share, slot
  order, exactly stacked split along X by id). **Normalised to at most unit length** (decision): a sum longer than 1
  walks one step its way, a shorter one walks that share of a step. Normalising every sum to one step made a follower
  walk as fast as its leader, so two Jackals going the same way never spread (spec'd: a stacked pack spreads, no pair
  within 0.5 for 40 ticks). It faces the way it walks. Without sight of its target it walks straight at it on the steer
  mover and leashes after `lostTicks` (aiTicks counts them, the Mender's way). Its cooldown counts down only while
  circling.
- **Starting a wind-up** needs, besides the plan's three (cooldown out, token free, outside the front cone): its target
  in sight and within a new data field **`lungeRange` 3.4** (the plan is silent; the lunge's 2.8 plus the overlap reach
  0.67 is 3.47, so a lunge from there reaches a player who stands). The front-cone test is `jackalBehind` (no sqrt:
  both sides squared, the sign checked; a point on the player is never behind).
- **The token and co-op (finding).** NT0 finding 15's "same target" (each other Jackal's nearest living player, read
  in the scan) breaks in co-op: a lunging Jackal's nearest player can change mid-attack (it lunges past one player
  toward another, or a teammate walks up), so two Jackals ended up winding up / lunging at one player (the co-op
  endless spec caught it). Smallest faithful fix: the wind-up locks its target (its nearest living player then) in the
  free slot **v7 `JACKAL_TARGET`**, and the token compares the holders' locked targets. The spook reads the LOCKED
  target's facing too (a teammate turning onto a Jackal that is attacking someone else does not spook it; a dead target
  never spooks). The hit test still covers every player (bit per player). Solo is unchanged by this (target 0 always).
- **Spook.** On any wind-up tick, when the locked target faces it (`dot >= spookCos` x the distance): `JACKAL_HOP`,
  `hopDistance` back along the locked heading over `hopTicks` (the plain mover; the call-off tick stands, the hop moves
  from the next), then `spookCooldownTicks` through `enemyCooldownFixed` (no draw). `events.spooks` += 1.
- **Lunge.** The wind-up's last tick turns it into `JACKAL_LUNGE` and **draws the next cooldown there** (the plan's
  "one per lunge": a wind-up that ends in a spook has drawn nothing), `events.lunges` += 1; it moves from the next tick,
  `lungeDistance / lungeTicks` a tick on the plain mover (under half a step is a wall: it ends early, the swarmer's
  rule), then the hit test after every move: the first overlap with each living player (`radius + PLAYER_RADIUS`) sets
  that player's bit in v6 and hurts `HIT_NORMAL` through `ctx.hurtPlayerAt` (NT0 correction 1), unless the guard stops
  it. Then `JACKAL_RECOVER` 0.5 s. `attack` stays `JACKAL_ATTACK_LUNGE` through the lunge (the swarmer's view contract).
  v3 counts the hop / recover / stagger; aiTicks the wind-up and the lunge.
- **Guard stop (NTD9).** `jackalGuardStops` reads NT0 finding 8 exactly: not rolling, the active slot is the sword with
  `v[SWORD_V_GUARD] > 0`, the Jackal within `guardReach` and `dot >= swordGuardSweepCos x the distance` (melee.ts
  `inCone`'s test, one sqrt; Bastion's ring always holds). The stop sets the bit, staggers it `staggerTicks` (standing),
  ends the lunge, and in a scored run pushes ONE `guardX / guardZ` (the contact point: on the player's rim toward the
  Jackal) and `guardPlayer` entry: no `scoreGuardCancels`, no brace / Riposte count (spec'd: GUARD points and counts
  0, `guardCancels` 0, and the hashed score group, `writeScoreHash`, the start's every tick of a stop scenario). The
  feed's `size() === guardCancels` comment in score.ts now says the Jackal adds entries. A guard from straight behind
  (dot -1 < -0.2) is no stop and a rolling player's guard is no parry (spec'd: no stagger, no feed; the roll's i-frames
  take the hit).
- **NTD10.** No exception anywhere: a lone Jackal starts a wind-up only from outside its target's front cone (spec'd at
  every wind-up start of a slowly turning player and in every other scenario).
- **Draws.** Exactly one in `init` and one per lunge at its start; none for the wind-up, a spook, the circling, a
  stagger or the death (spec'd on every tick of every scenario, the real endless floors included).
- **Pinned (note for NT11).** A pinned Jackal does not step: a wind-up it was pinned in waits, and it keeps its
  target's token while held, so its packmates do not lunge at that player until it is released or dies.
- **Feeds** (unhashed, cleared per tick): `events.lunges`, `events.spooks` for NT7's `sfx.enemy.lunge` /
  `sfx.enemy.spooked`; the stagger's parry through the guard feed.
- **Byte for byte without a Jackal.** Run green on the change (990 tests in 83 files): `sim/determinism`,
  `enemies.determinism`, `combat.determinism`, `encounterRun`, `runFull`, `runBoss`, `runBullets`, `runPlayer`,
  `runPlayerDungeon`, `actors`, `hash`, `step`, `smoke`, `affixes/affixes`, `run/affixes`, `run/endless*`,
  `run/validate`, `run/slice`, `run/tutorial`, `tutorial/*`, `sim/tutorial`, `dungeon/roomPool.lock`, `stormcaller`,
  `bomber`, `charger`, `chainhook`, `summoner`, `slime`, `dummy`, `pyrekeeper`, `party`, `enemyVariants`,
  `newEnemies*`, `mortar`, `mender`, `jackal`, `view/audio/*`, `view/fx/variantCueEvents`, `play/liveRun*`,
  `score/nearMissFeed`, `score/score`.

## NT5 packs (as built, 2026-11-16)

Gameplay (dungeon) once a pack kind is in the pool; no kind has `packOf` yet (the Jackal's row is NT6), so every
endless floor spends and places exactly as before. Files: `dungeon/endlessData.ts` (`EndlessRoomKind.packOf?`),
`dungeon/endless.ts` (`spendEncounterBudget`, `populateEndlessRoom`), `dungeon/testing/spenderFallback.ts`,
`dungeon/testing/poolCensus.ts`. Spec: `dungeon/packs.spec.ts` (8 cases).

- **The spender.** Per pick, `slots = cap - out.size()`, `need = left / slots` as before. A kind with `packOf` n is
  skipped while `n > slots`, is affordable when `n x encounterCost <= left`, and compares its **per-slot** cost (its
  `encounterCost`) against `need` and in the dearest pick (spec'd both ways: at need 3 a bruiser is drawn over a
  heavily weighted pack of 1-cost Jackals, and the no-draw fallback takes a sniper over the pack). A pick pushes n
  entries, adds ONE to `bought` (so `maxPerRoom` counts packs; spec'd with 1 and 2) and spends `n x cost`. With n = 1
  every test, total and subtraction is the single-kind rule's exactly (`n > slots` never holds inside the loop, `c * 1`
  is `c`), so without a pack kind every draw is as before. `needsCompany`, the roster and the minimum floors see a pack
  kind like any other (a closed pack kind moves no total and no draw: spec'd draw for draw against the plain table over
  200 seeds x 4 budgets x 3 floors).
- **Testability (decision, the brief's).** `spendEncounterBudget` and `populateEndlessRoom` take an optional trailing
  `kinds` (default `ENDLESS_ROOM_KINDS`; every game caller passes nothing), and so do the testing mirror's `traceSpend` /
  `tieSpend`, so the specs buy from `ENDLESS_ROOM_KINDS` + a Jackal row without touching the real table.
- **Placement.** The swarmers' `pack` / `packLeft` are untouched. A bought pack has its own state (`buyPack`, its kind,
  its count): the pack's first entry takes a new anchor (`spreadTile`, one draw, pushed to `anchors` like a new swarmer
  pack's), the other n - 1 the free tiles nearest that anchor (`nearestFree`, no draw); a pack never joins or resets
  the swarmers' pack, so a swarmer bought after a Jackal pack still joins the earlier swarmer pack (spec'd on real Forge
  rooms by replaying the placement's used set: every pack member and every swarmer pack member is exactly the nearest
  free tile to its own anchor). Placement stops early only when the room runs out of tiles, as before.
- **Mirrors.** `spenderFallback.ts` applies the same rules (agrees with the spender draw for draw with a pack in the
  table, spec'd); `poolCensus.ts`'s maximum check is `maxPerRoom x packOf` enemies.
- **Verify.** "A room with a pack holds three Jackals on neighbouring tiles": spec'd on 12 runs x floors 3 / 6 / 9 of
  real Forge rooms (the two members on tiles touching the anchor in every pack but at most one). "2 or fewer free
  slots never buys one": caps 1 and 2 buy nothing, cap 16 with only packs stops at 15, and no pack ever starts past
  `cap - 3`. Floor 1 without a roster, draw for draw and tile for tile: `dungeon/roomPool.lock` unchanged.
- **Byte for byte without a pack kind.** Run on the change (665 of 667 tests in 64 files green): every `dungeon/*` spec
  (`roomPool.lock`, `roomPool`, `roster`, `spenderFallback`, the default census shards, `affixes`, `breakables`,
  `golden`, `vault`, `secrets`, `pacts`, `pellets`, `modifiers`, ...), `run/floorModifiers`, `run/party`,
  `run/endless*`, `run/validate`, `run/slice`, `daily/*`, `view/hud/rosterLine`, `sim/encounterRun`, `sim/charger`,
  `sim/stormcaller`, `sim/dummy`, `sim/newEnemies*`. Two failures not caused by NT5 and left as they are:
  `dungeon/endless.spec` "encounter costs" pins `ENCOUNTER_COST.size()` 18, which NT1's three rows made 21 (NT6, which
  extends the other count pins, should update it); `dungeon/forge/forge.spec` "EncounterRng ... seedToState vectors"
  reads a NaN fixture seed as `fff8000000000000` where the fixture says `7ff8000000000000` (a NaN sign bit in the
  fixture round trip under Lune; no NT code touches it).

## NT6 room pool and roster (as built, 2026-11-16)

Gameplay (dungeon): endless, daily and dev rooms, replays and scores change from floor 1; M1, every golden fixture and
the tutorial replay exactly as before (no golden-run, segments / validate or tutorial spec moved); boards stay `_v1`.

- `ENDLESS_ROOM_KINDS` + three rows, appended after the Pyre-keeper (`endlessData.ts`, `NEW_KIND_3_MAX_PER_ROOM`,
  `JACKAL_PACK_SIZE` 3): mortar 1 / max 2, mender 1 / 1 `needsCompany`, jackal 1 / 1 pack with `packOf` 3 (NTD6, NTD11).
  Each has `fromFloor` 2 (`ROOM_KIND_UNLOCK_FLOOR`), copied from NX6: read only with unlock floors (specs and tools), so
  floor 1 without a roster spends draw for draw and tile for tile as before (`roomPool.lock`'s no-roster floor-1
  digests 6504 / 8482 / 10531 / 12293 spawns unchanged: the three are closed there, and a closed pack kind moves no
  total and no draw, NT5). Every endless world ignores `fromFloor` (DSD17 / DSD18), so NTD7's "no minimum" holds for the
  Mortar and the Jackal.
- NTD7: `ROOM_KIND_MIN_FLOOR` gains `mender` 2, honoured in `roomKindOpen` (no draw) and in `endlessRoster`'s join scan,
  unlock floors on or off, exactly as the Chainhook's: a run whose order starts with the Mender (runs 46, 54, 57, 76,
  91, ... of 0-499) takes the order's first kind with no minimum on floor 1 and the Mender on floor 2. 48 of 500 runs
  start with the Chainhook or the Mender; none of 0-499 has both in front.
- `rosterOrder` shuffles 17 seeded kinds (16 draws); full roster on floor 17.
- `DAILY.ruleset` 21 -> 22 (NTD14; `daily.spec`).
- Codex: `enemy:mortar` / `enemy:mender` / `enemy:jackal` appear after `enemy:pyrekeeper` on their own (NT0 finding 14);
  `catalog.spec`'s order lock extended (94 entries, the appended list grown, never reordered), `view/codex/screen.spec`
  (the Enemies section 16 -> 19 tiles), `codex/doc.spec` (their first-time cards now seed their entries: 18 -> 21).
- Census helpers: `run/testing` `newEnemies3Census.ts` (`newEnemies3Census`, `nt6CensusProblems`, `jackalPacks`) and the
  shard specs `run/newEnemies3Pool.<1-5>.spec` (floors 1-4 / 5-8 / 9-12 / 13-16 / 17-20; by default run seeds 1-10,
  `--census` 1-60, about 60-80 s a shard).

Re-pinned ("re-recorded for docs/NEW_ENEMIES_3.md NT6"). Every move is the three kinds in the draw or the 17-kind
reshuffle: nothing else in the branch reaches an endless floor, the layouts never move, and the pinned floors were
checked against the NX6 build (a worktree at `af6045c`): with their NX6 rosters, `endlessRoomSpawns` on today's table
gives exactly the old spawn lists (run 4 floor 3, run 23 floor 3 party 2, run 4242 floor 1), so only the roster moved
them.

| Spec | Old -> new | Why |
|---|---|---|
| `dungeon/roomPool.lock` | no roster floors 2-6 `5dd95c58 / 68e4f441 / a674542e / f03db93c / 91268968` -> `2c1a3d7e / ab06d380 / 00ef4f85 / bdd889c6 / 78868284`; roster floor 1 `0b8658d7 / e7fb379d / a6ccba66 / 114ba42c` -> `32d26649 / 0daddec8 / 24f62f94 / 88f91250`; roster floors 2-6 `5e506771 / f579a0c3 / 8538cbf3 / 20dcde0a / c84d264a` -> `e601539c / 897c3c54 / 7fe826ce / 78b2c8cd / 9eb8d68a` | the three join the no-roster draw from floor 2; every roster reshuffled. Floor 1 without a roster unchanged |
| `dungeon/roster.spec` | `SEEDED` + 3, run 1 / 1337 orders and rosters, full floor 14 -> 17, the floor-1 join rule generalised to the Chainhook and the Mender (runs 25 / 46), a new "no floor-1 Mender" case | 17-kind shuffle; NTD7 |
| `dungeon/roomPool.spec` | rows + 3, `needsCompany` + mender, the pack kind, min floors + mender; the per-room max check counts packs (`maxPerRoom x packOf`) | the rows |
| `dungeon/endless.spec` | `ENCOUNTER_COST.size()` 18 -> 21 | NT1's rows (left stale by NT1, noted in NT5) |
| `dungeon/packs.spec` | its base table is `ENDLESS_ROOM_KINDS` without the real Jackal row | the real table has one now |
| `sim/charger.spec` | `PIN_HASH` `2fcc46ea` -> `5332ee3f` (counts unchanged) | run 4 floor 3's roster is swarmer / sniper / jackal / charger (was swarmer / stormcaller / bruiser / sniper): a Jackal pack and Chargers in its rooms, the breakables around them moved (39 pieces, were 36) |
| `sim/stormcaller.spec` | `3/0/04cfeefe`, `6/0/71038c42` -> `3/0/31c1996c`, `6/0/eb11734f` (strike / skip counts unchanged) | the same run 4 floor 3; run 23's co-op floor 3 buys slime / summoner / reaper (was charger / imp / reaper) |
| `view/hud/rosterLine.spec` | run 1337: floor 1 `Swarmer · Bruiser` -> `Swarmer · Imp`, the joins of floors 2-17, built floor 3 `New: Shieldwall` -> `New: Jackal` | 17-kind shuffle |
| `run/slice.spec` | the floor-6 segment's start tick 2962 -> 2953 (the edit still after the tick-3000 checkpoint) | the bot's floors 1-5 buy other kinds |
| `codex/*`, `view/codex/screen`, `daily.spec`, `sim/newEnemies2` / `newEnemies3` | counts and rows as above | the rows |

Not pins (loose bounds or test setups the new rosters broke; NT12 items where they are tuning):
- `sim/pellets/stepPellets` "pickups move only the score and pellets groups": run 4242's floor-1 kind is now the
  Snatcher (was the Reaper), which reads the pellets, so the actors group differs between a run with and without them.
  The test uses `NO_SNATCHER_SEED` 4244 (floor 1: the sniper), asserted to hold no Snatcher.
- `sim/score/contributionFeed` "solo runs credit player 0": 4242's solo walk to the floor-1 stairs (now Snatchers) lands
  no hit in 1500 ticks; it uses 4244.
- `sim/archer.ttk.builds`: the floor-20 census room is now run 3 floor 20 room 11, 16 enemies with a Mortar. More fights
  time out there (seeds 1-2): the Knight's and the two-weapon player's with no build, the two-weapon player's Siege Bolt
  (all cleared at NX6); the Archer's Siege Bolt still clears (149 s), its Fire Arrows now does (167 s, kept in the
  allowance). The allowance is per character (`MAY_TIME_OUT`), printed; every other fight must be won.
- `sim/archer.roll.fight` and `sim/legendaries.bastion.roll` (the fighting roll bot): the floor-6 census room is now a
  bomber, 3 swarmers, a Stormcaller, a Mender and a Snatcher; the bot clears it (10 s Archer) without ever meeting a
  volley to roll into, so "the bot rolled" is waived for that room for the fighting bot only (the kiting bot still rolls
  there).

Ran green on the change: every `dungeon/*` spec (but `forge.spec`'s known NaN-sign vector, unrelated), every `run/*`
spec (the censuses included: `newEnemies2Pool.<1-5>`, `poolHighWater.*`, `enemyBullets.*`, `pellets`, `treasure`,
`silver`, `golden`, `drops`, `pacts`, `snagCensus.<1-3>`, `archer.survival`, `replay.bench`), `daily/`, `codex/`,
`view/codex`, `view/hud/rosterLine`, `leaderboard/`, `onboarding`, and in `sim/` the determinism specs, every
per-archetype spec (bomber .. jackal / mender / mortar), `newEnemies*`, `encounterRun`, `enemyVariants`, the golden-run
specs (`runFull`, `runBoss`, `runBullets`, `runPlayer*`, `constants`, `recordingCodec`, `bossAct1`), the TTK / roll
specs above, and `sim/{affixes,breakables,builds,combat,dev,drops,golden,pacts,pellets,progression,score,secrets,silver,treasure,tutorial}/`.

**Census** (`run/newEnemies3Pool.<1-5>.spec`, `--census`: floors 1-20 x solo run seeds 1-60, every endless world's rule;
means per populated room unless marked per floor (per run); "(n)" after Mortars is the most in one room, after Menders
and Jackal packs the rooms holding one; p4 = party 4 over the same floors). Gates held on every floor: every roster and
room rule (`censusViolations` with `appears`: caps counted in packs, the Mender never a room's first buy, every roster
kind placed), every room's Jackals whole packs of three consecutive spawns, no room past the 16-actor cap (solo or party
4), party 4's worst room under the pool target 48, no Mender on floor 1.

| floor | rooms | enemies | kinds | cost / budget | Mortars (max) | Menders / floor (rooms) | Jackal packs / floor (rooms) | max spawns solo / p4 (p4 rooms at 16) | p4 packs / floor | p4 max slots / alive |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 452 | 5.26 | 1.70 | 6.50 / 6.50 | 0.05 (2) | 0.00 (0) | 0.48 (29) | 9 / 16 (8.0 %) | 0.47 | 21 / 19 |
| 2 | 465 | 5.37 | 2.28 | 7.59 / 7.91 | 0.11 (2) | 0.42 (25) | 0.92 (55) | 10 / 16 (9.0 %) | 1.00 | 25 / 22 |
| 3 | 444 | 5.57 | 2.74 | 8.67 / 9.10 | 0.11 (2) | 0.78 (47) | 0.83 (50) | 11 / 16 (6.1 %) | 1.18 | 24 / 20 |
| 4 | 456 | 5.89 | 3.13 | 9.73 / 10.31 | 0.14 (2) | 0.97 (58) | 0.77 (46) | 11 / 16 (4.6 %) | 1.05 | 25 / 22 |
| 5 | 457 | 6.21 | 3.55 | 10.98 / 11.69 | 0.20 (2) | 1.03 (62) | 0.85 (51) | 12 / 16 (3.7 %) | 0.95 | 29 / 22 |
| 6 | 507 | 7.00 | 4.05 | 12.85 / 12.85 | 0.23 (2) | 1.58 (95) | 1.00 (60) | 14 / 16 (3.6 %) | 1.07 | 31 / 25 |
| 7 | 513 | 7.47 | 4.56 | 13.95 / 14.24 | 0.26 (2) | 1.57 (94) | 1.70 (102) | 13 / 16 (6.8 %) | 1.07 | 32 / 25 |
| 8 | 499 | 7.89 | 4.94 | 15.23 / 15.67 | 0.28 (2) | 1.77 (106) | 1.68 (101) | 13 / 16 (11.2 %) | 0.70 | 39 / 29 |
| 9 | 510 | 8.11 | 5.27 | 16.16 / 16.73 | 0.31 (2) | 1.72 (103) | 1.68 (101) | 13 / 16 (14.5 %) | 0.43 | 40 / 30 |
| 10 | 509 | 8.45 | 5.80 | 17.49 / 18.19 | 0.35 (2) | 1.75 (105) | 1.33 (80) | 14 / 16 (16.9 %) | 0.22 | 40 / 30 |
| 11 | 570 | 9.25 | 6.29 | 19.33 / 19.33 | 0.45 (2) | 2.33 (140) | 1.85 (111) | 15 / 16 (17.5 %) | 0.08 | 40 / 30 |
| 12 | 566 | 9.37 | 6.69 | 20.29 / 20.57 | 0.43 (2) | 2.63 (158) | 1.47 (88) | 14 / 16 (25.3 %) | 0.02 | 40 / 30 |
| 13 | 569 | 9.78 | 7.04 | 21.58 / 22.01 | 0.48 (2) | 2.68 (161) | 1.52 (91) | 15 / 16 (31.1 %) | 0.00 | 40 / 30 |
| 14 | 561 | 10.06 | 7.41 | 22.49 / 23.06 | 0.45 (2) | 2.98 (179) | 1.33 (80) | 15 / 16 (61.0 %) | 0.00 | 39 / 29 |
| 15 | 561 | 10.63 | 7.93 | 23.97 / 24.67 | 0.50 (2) | 3.50 (210) | 1.57 (94) | 15 / 16 (100.0 %) | 0.00 | 38 / 29 |
| 16 | 624 | 11.36 | 8.41 | 25.73 / 25.73 | 0.49 (2) | 3.82 (229) | 1.78 (107) | 16 / 16 (100.0 %) | 0.00 | 37 / 27 |
| 17 | 616 | 11.47 | 8.67 | 26.69 / 26.98 | 0.52 (2) | 4.03 (242) | 1.17 (70) | 15 / 16 (100.0 %) | 0.00 | 16 / 16 |
| 18 | 627 | 11.83 | 8.96 | 27.66 / 28.08 | 0.53 (2) | 4.48 (269) | 1.37 (82) | 16 / 16 (100.0 %) | 0.00 | 16 / 16 |
| 19 | 614 | 12.31 | 9.12 | 29.10 / 29.67 | 0.56 (2) | 3.92 (235) | 1.12 (67) | 16 / 16 (100.0 %) | 0.00 | 16 / 16 |
| 20 | 626 | 12.56 | 9.21 | 29.92 / 30.64 | 0.63 (2) | 4.37 (262) | 1.12 (67) | 16 / 16 (100.0 %) | 0.00 | 16 / 16 |

Read: floor 1 buys Jackal packs (in 29 rooms over the sample) and Mortars (2 at most in a room) but never a Mender;
from floor 2 every rule holds unlocked (DSD18). A solo room holds at most one pack (the cap) and never reaches 16
spawns before floor 16. **Party 4 buys almost no Jackals from floor 10 on**: a party room's budget per free slot rises
past 1, so the spender's per-slot rule (NT5: a pack compares its per-slot cost, 1, against budget-left / slots-left)
leaves the 1-cost pack out of the weighted draw and the no-draw fallback takes the dearest kind; from floor 15 every
party-4 room saturates at 16 and from floor 17 the fallback buys 16 Bruisers (EV13's, as in NX6). That is NT5's rule as
taken, the swarmers' fate too; NT12 / owner item if deep co-op should meet packs. Party 4's worst room is 40 slots
(floors 9-13: 8 Oozes, a summoner, a Pyre-keeper among them), unchanged from NX6's and under the 48 target. Shells and
heals per room (the plan's NT6 line) need stepped fights; they are NT12's measurements, not this spawn census.

## NT7 view (as built, 2026-11-16)

Presentation and client only: no sim, dungeon, lockstep, hash, replay, wire, fixture or score change (no file under
`shared/sim`, `shared/dungeon` or `shared/run` changed; `shared/lockstep/client.ts` and `shared/play/liveRun.ts` only
collect the new view feed). Placeholder looks; NT8 brings the art.

- **Pure rules** `shared/view/newEnemies3.ts` (tunables `newEnemies3Config.ts`): `isShellPayload` (a STRIKE whose
  payload `source` is the Mortar's archetype index + 1) / `isLightningPayload` (a STRIKE that is not), `mortarFlying` /
  `mortarCorpseFlying` (MORTAR_FLIGHT with flight ticks left, alive or dead), `ShellArcs` (the shell's arc: per actor
  slot the Mortar's drawn position on the first frame of each flight, a new origin when the ticks left rise again or the
  id changes, so the arc starts where the shell left and does not follow the Mortar as it keeps walking; a straight
  floor path to v[MORTAR_LAND_*], height from the hand `handTiles` 0.9 to the floor plus a parabola peaking at
  `arcTiles` 3), `menderTetherAlly` (only a living Mender in its link (TELEGRAPH + MENDER_ATTACK_HEAL) or channel, and
  only to a living ally: `menderAllyOf`), `tetherShare` (the beam growing over the link, whole in the channel),
  `tetherPulse` (1 on a heal pulse's tick, gone after `pulseSec` 0.25: v[MENDER_PULSE] resets on every heal once the
  channel has run `pulseTicks`), `tetherSegments` (hands to the ally's rim), `HealPlusMarks` (the `+`: a cross growing
  over 0.5 sim seconds screen-up of the healed enemy, at most 12), `jackalStaggered` (the stars), `newEnemy3Bursts`
  (impact dust in `secret.dust`, heal sparks and the snap in `enemyHeal`).
- **Feed** `shared/view/fx/newEnemy3Events.ts` `NewEnemy3FrameEvents` (new `RunView.newEnemies3`, collected by LiveRun
  and LockstepClient after every tick like NX7's): impacts at the landing point of every shell (a Mortar slot that had
  one flight tick left after the last tick and is no longer flying, at the remembered point: a corpse may free its
  slot on the landing tick; at most `events.shells` per tick), heals at each `CombatState.healEvents` pulse's actor,
  snaps at each end that `healEndCuts` (the middle of the beam to the ally the Mender was linked to after the last
  tick: the end clears v[MENDER_ALLY]; without one, at the Mender).
- **Every strike reader** (NT0 finding 3): the strike flash DecalPool (`STRIKE_DECAL`) now accepts lightning only, so
  its hazard art (`StrikeSpritePool`) and the view-only scorch never see a shell; a new `SHELL_DECAL` DecalPool on the
  enemy simulation draws the shell as the strike's disc (its placeholder, the shell's life, `SHELL_ARC_VIEW
  .discFolderName`) and never builds a sprite drawer, so it is the disc on every pack, vale's lightning art included
  (NTD12). The enemy pool's skip is unchanged (every STRIKE). `enemyBulletPool` answers `"shell"` for a shell (spec
  only). `BulletAhead` already holds every STRIKE still. Lightning cue: `strikes - shells` (NT2).
- **A dead Mortar's flight (NTD5).** TelegraphController skipped every corpse, so the ring vanished at the Mortar's death
  while the shell still landed. It now also draws a corpse that `mortarCorpseFlying` (the same `ring` hint, filling on
  the corpse's aiTicks), and the arc flies on, so a visible ring never lies.
- **Sprite inputs** `shared/view/newEnemy3Sprites.ts`, added through newEnemy2Sprites.ts `withNewEnemy2SpriteInputs`
  (no new name in sprites.luau, still 195): Mortar `attack` = the draw plus the first `mortarReleaseTicks` (9) of the
  flight (NT8 places the release frame); Mender link `attack` stretched, channel `attack` looped (`ActorAttack.loop`),
  bolt `attack.2` (absent: `attack`), flinch `hit`; Jackal wind-up `crouch` (absent: `attack`, the swarmer's way),
  lunge `attack`, the spooked hop the special `hop` (absent: skipped, so it plays its move, never the attack), stagger
  `hit` stretched over the 1 s. Theme contract `ENEMY.optionalAnimations` += `crouch`, `hop` (inline; contract.luau
  still 189 locals), so NT8 only fills art.
- **Cues.** VariantCueEvents gains `lobs` (a Mortar leaving TELEGRAPH + MORTAR_ATTACK_LOB for MORTAR_FLIGHT; a draw
  called off by NTD3 is silent), `shells`, `heals` (pulses), `healCuts`, `lunges`, `spooks`; the mapper plays
  `sfx.enemy.lob` / `.shell` / `.heal` / `.healcut` / `.lunge` / `.spooked` once per frame that has one. Minimum
  intervals: lunge 0.1, beam cut 0.15 (NT1), lob 0.12, shell 0.1, heal 0.25, spook 0.12 (`NEW_ENEMY_3_AUDIO`). The
  enemy-shoot skip adds `events.shells x shrapnelPerShell` (6), so the shrapnel ring never plays `sfx.enemy.shoot` on
  the impact tick (a full bullet pool firing fewer shrapnel can then hide another enemy's shot on that one frame: the
  shot is one sound per frame).
- **Looks.** `enemyBulletLookOf` needs no change: the shrapnel (`BulletKind.ENEMY`, Mortar source) is the small look,
  the Mender's bolt (`BulletKind.CASTER`) the medium (spec'd on real bullets).
- **The parry (NTD9).** A Jackal's guard stop reaches the near-miss director through NearMissEvents with no view change:
  spec'd on the jackal.spec stop scenario, each stop is exactly one erase and one parry group on its own frame, and no
  other frame has one.
- **Client.** New `NewEnemy3MarksController` (the shell balls, `enemyBullet` Neon, pool 16; the tether and its pulse
  run, two DashLayers in `enemyHeal`; the `+` marks; the Jackal's stagger stars), ParticleController (the three bursts,
  palette entries appended last), BulletRenderController (the shell DecalPool, `getShellPoolSize`),
  TelegraphController (the corpse's ring).
- **Specs.** `view/newEnemies3.spec.ts` (19 cases), `view/audio/newEnemy3Cues.spec.ts` (9); moved counts: `view/sprites.spec`
  ACTOR_SPRITE_INPUTS 24 -> 27, `view/fx/variantCueEvents.spec`'s NT2 case reads the shell's own count,
  `theme/contract.spec` (the optional list). Ran green: every `view/**` spec (the endless shards of room edges and
  minimap tiles included) but one, every `theme/**` and `codex/**` spec, `sim/newEnemies3`, `mortar`, `mender`,
  `jackal`; lint, typecheck, build, `l10n:check`, `check:autolocalize`.
- **Not NT7's (pre-existing, left as is):** `view/predict/bulletAhead.spec` "draws every enemy bullet where the sim has
  it n ticks later, on real endless floors" fails with `seed 6 floor 12 window 25 slot 12 n 9: off by 0.0915` (n 10:
  0.183), identically on NT6's commit `cec2eea` (checked in a worktree): NT6's rosters put new kinds on that floor and
  one bullet leaves the closed form after 9 ticks. NT6 did not run that spec. It is LP10's closed form against a new
  sim rule (a candidate: something the new kinds do to a flying bullet); for NT11 to find, not a view pin to move.
- **Studio checklist (NT13 adds):** the shell ball's arc reads as a lob over walls on every biome and lands as the disc
  appears; the disc is the plain one on vale (lightning keeps its art and scorch; a shell leaves no scorch); a Mortar
  killed mid-flight keeps its ring and its shell; the tether reads through a crowd, grows over the link, pulses per
  heal, the `+` reads over the ally and the snap on a cut, never on a natural end; the Jackal's stars on a guard stop
  and the PARRY! text; the six cues (silent in the placeholder, the four fallbacks playing); no shot sound with a
  shell's shrapnel.

## NT8 art (as built, 2026-11-16)

Presentation only: no sim, dungeon, lockstep, hash, replay, fixture or score change. Built on a machine holding only
the three rigs' folders (and two alternates) of the Demons pack, so every build was `--only <set>` (never a whole
`art:build`); the lock was extended with `--lock --only <set>` (`art/vendor.lock.json` + 30 files, additions only).

- **Three sprite sets** in `art/atlases.json` (NX8's recipe: grid 128, body over `Shadows/`, no `Effects/`,
  `rowForFacing` clockwise, `noiseAlpha` 2, pad 3, 2 px rim sheets, `cells: "perSheet"`, pivot on idle facing 6
  frame 0). Frames picked on zoomed contact sheets of every facing (PIL, scratch in `/tmp`), the moments placed with the
  pack's own `Effects/` sheets (the frame where the arrow / the swipe starts), then checked on the pipeline's
  `art/build/contact/enemy.<id>.png`. `layout.ts` gains the three entries only (144 lines added, none changed).

  | Set | Rig | Animations (source file: kept frames) | Measured marks | Scale | Sheets |
  |---|---|---|---|---|---|
  | `enemy.mortar` | Demon Spawn 6 | idle `Idle 12` 0, 3, 7, 10; move `Walk` (8, fps 10); attack `Attack 4` 0, 2-10; hit `TakeDamage 1` 1, 3, 5, 8; death `Die 1` 0, 2, 4, 6, 9, 14 | the loose f8 (the Effects arrow starts there; f7 is the full draw aimed straight up, 66 px tall) is kept index 7 of 10 = 0.7 of the attack timeline = 21 / (21 + 9): the plain stretch shows the full draw on the draw's last tick and the loose from the flight's first (pinned on the built layout, `view/newEnemies3.spec`) | bodyTiles **1.374** = 31.3 px/tile, the Spawns' density (idle 43 px, 24 px = 0.77 tiles wide) | attack 512x870, body 660x949, death 376x972 |
  | `enemy.mender` | Imp 10 | idle `Idle`; move `Walk` (8, fps 10); attack `Attack 3` 7, 8, 9 (fps 6); **attack.2** `Attack 2` 1-5; hit `TakeDamage 1` 1, 3, 5, 8; death `Die 1` | `attack` is both arms spread and raised (the end of Attack 3's spin): stretched over the 24-tick link, looped through the channel at fps 6, 3 frames = 0.5 s = the 30-tick heal pulse, so each pulse restarts the loop on f7 (pinned); the wrap f9 -> f7 changes 1.3x the pixels of a step inside it, a sway. The bolt: f1-f3 a charm raised, f5 the cast (Effects starts on f5) over the wind-up's last fifth, as the bolt leaves | bodyTiles **1.518** = 28.3 px/tile, the imps' density (idle 43 px with the horns, 30 px = 1.06 tiles wide) | attack (+ attack.2) 552x600, body 976x536, death 272x852 |
  | `enemy.jackal` | Demon Beast 2 | idle `Idle`; move `Run` (8, **fps 18**: 0.44 s a cycle = 2 tiles at 4.6 u/s); **crouch** `Crouch` 0, 3, 7, 10 (a held crouch, 55 px against idle's 60); attack `Run Attack` 3-8; **hop** `BackFlip 1` 1, 3, 4, 6-9; hit `TakeDamage 1` 1, 3, 5, 7, 9, 11, 13; death `Die 1` | the lunge: f3-f4 claws flung up, f5 the rake (Effects starts there) at kept index 2 of 6, tick 4 of the 11-tick lunge. The hop: f1 the take-off, f3-f7 in the air (the body leaves its shadow), f8-f9 the landing; **f5 dropped**: the flip's peak touches the source cell's top edge in rows 0-3 (clipped in the pack). The stagger: `hit` stretched over the 60 ticks (NX8's Shieldwall way) | bodyTiles **1.2** = 50 px/tile (see below) | attack (+ crouch) 870x872, body 980x935, **hop** 588x840, death 552x760 |

  No view code needed a mark (each timeline is one stretch or one loop, as NT7 left them). `pixelsPerTileFrom` would
  need the referenced set's pack on the building machine, so the densities are reproduced with `bodyTiles` (31.3 and
  28.3 exactly, the `vale.spec` case pins them equal to the Shieldwall's and the imp's).
- **The Jackal's size (NTD2 checked, the rig kept).** At the knight's density (the other Beasts': bruiser, charger)
  Beast 2's idle body (60 px tall facing the camera, 44 px wide with the claws) stands **1.58 tiles**, the bruiser's
  size: three of them a pack against a r 0.32 hitbox read far too heavy for a light pack hunter. NT8 draws it at
  **bodyTiles 1.2** instead (the imp's height, under the swarmer's 1.25 and the knight's 1.5; 0.88 tiles wide), a free
  size like the imp / Bomber / Snatcher. Its silhouette is still the bulkiest of the small enemies (hunched, claws
  wide); NT13 decides with a pack of three beside the knight, Imp 2 stays the alternate (NTD2).
- **Optional sheet.** The Jackal's `hop` is in a sheet of its own (`jackal-hop.png`): its animation is optional, so the
  set draws once attack / body / death have IDs and the hop joins when its sheet does (until then the spooked hop plays
  its move, NT7's fallback). `crouch` and the Mender's `attack.2` share the required attack sheets.
- **Checks:** `npm run test:art` 320 pass / 5 skipped; two consecutive `--only` builds and a clean rebuild into an empty
  `art/build` byte-identical (the 20 PNGs, the 3 contact sheets and `layout.ts`); `layout.ts` and the lock additions
  only. Specs: `theme/packs/vale/vale.spec` (the perSheet list + a new describe: layouts, densities, measured frame
  counts, placeholders as bundled, sprites with the required sheets, any missing one keeps the placeholder, the hop
  sheet optional), `theme/newEnemies3.spec` (vale may be `sprites` / `sound` once uploaded, every other pack the
  placeholders, like `newEnemies2.spec`), `view/newEnemies3.spec` (the loose and the pulse on the built layouts).
- **Upload (owner):** every PNG below from `art/build/` (copies in `art/upload/`), then each ID into
  `packs/vale/assetIds.ts`; a set switches on once its required sheets have IDs, its rims as they arrive.
  - Mortar: `mortar-attack.png`, `mortar-attack-outline.png`, `mortar-body.png`, `mortar-body-outline.png`,
    `mortar-death.png`, `mortar-death-outline.png`
  - Mender: `mender-attack.png`, `mender-attack-outline.png`, `mender-body.png`, `mender-body-outline.png`,
    `mender-death.png`, `mender-death-outline.png`
  - Jackal: `jackal-attack.png`, `jackal-attack-outline.png`, `jackal-body.png`, `jackal-body-outline.png`,
    `jackal-hop.png`, `jackal-hop-outline.png`, `jackal-death.png`, `jackal-death-outline.png`
  - No bullet sheet (NTD12: the shell is the strike disc, the shrapnel and the bolt the existing looks).
- **Studio check (NT13) adds:** the three at their scales beside the knight (the Mender at 1.52 tiles is the
  summoner's height; the Jackal pack at 1.2), the Mortar's bow raised straight up reading as a lob and the loose landing
  with the shell's first frame of flight, the Mender's spread-arms loop through a channel (the f9 -> f7 wrap), the
  Jackal's crouch reading against its idle (only 5 px lower: if it does not read, `Crouch walk` or a squash), the hop at
  12 ticks for 7 frames (fast: if it blurs, fewer frames), the 18 fps lope against the ground.

## NT10 audio (as built, 2026-11-16)

Config and lock only: **not built** here. `scripts/audio/build-audio.js` has no `--only`: `audio:build` and
`audio:lock` read every sound in `art/audio.json`, and this machine holds only four of the vendor packs (no
`dhsfx-horror-stingers`, `pixabay`, `oga-chain-winch`, ...), so both refuse (a missing source fails the lock; a full
build would also rewrite `audioLayout.ts` and the audition page). Done instead:

- **Six entries** appended to `art/audio.json` after `sfx.enemy.pyrelight`, every one `"confirmed": false` with
  alternates and a note (NX10's shape). All four packs are CC0 and already credited (THIRD_PARTY_NOTICES' "Used for"
  lines name the new picks; no new Credits row). Picks by length and spectral centroid (ffprobe / ffmpeg
  `aspectralstats`), **not heard**:

  | ID | Pick | Alternates | Why |
  |---|---|---|---|
  | `sfx.enemy.lob` | Kenney Interface `pluck_002` (0.18 s), pitch 0.75-0.8 | Ninja `Jump2`, `Whoosh2`; Interface `drop_002` | a bowstring twang, played low so it is not Silver's `pluck_001` |
  | `sfx.enemy.shell` | Ninja `Elemental/Explosion` (0.37 s, unused so far) | Kenney `impactSoft_heavy_002`, `impactPunch_heavy_001`; Ninja `Explosion4` | the shortest explosion, apart from the Bomber's (Explosion5) and the burst's (Explosion2); thumps if too big |
  | `sfx.enemy.heal` | Ninja `Magic & Skill/Heal3` (0.34 s) | Ninja `Bonus/PowerUp1`, `Spirit` | the soft chime (Heal is the flask, Heal2 the brace); quiet at the mix |
  | `sfx.enemy.healcut` | Kenney Impact `impactGlass_light_001` (0.21 s) | `impactWood_light_002` (a twig snap); Interface `glass_004` | a crisp snap |
  | `sfx.enemy.lunge` | rubberduck `roar_01` (0.37 s) | `troll_01`, `monster_03`, `grunt_03` | the shortest snarl for a 0.18 s lunge |
  | `sfx.enemy.spooked` | Ninja `Creature/Dog` (0.26 s, high) | rubberduck `hurt_02`, `hurt_04`, `cute_03` | a short high yelp |

- **Lock:** `art/audio.lock.json` gains the six picks' sha256 / bytes (computed exactly as `hashFile` does, inserted
  in `sourceFiles`' sort order; checked equal to the set the config reads, 142 files), so `audio:lock` on the owner's
  machine changes nothing.
- **Vale stays silent** for the six (the placeholder's SILENT, NT7's four fallbacks playing) until the build and the
  upload: a vale sound turns on only once every one of its files has an ID (`audioLayout.ts` is generated by the build).
- **Owner, on the Mac with every pack:** `npm run audio:audition` (listen; tick a pick per ID, Download picks.json,
  `node scripts/audio/build-audio.js --apply-picks <picks.json>`), then `npm run audio:lock`, `npm run audio:build`
  (makes `art/build/audio/sfx-enemy-lob.ogg`, `-shell`, `-heal`, `-healcut`, `-lunge`, `-spooked` and their
  `audioLayout.ts` rows), upload the six OGGs and paste their IDs into `packs/vale/assetIds.ts`, then `npm run build`
  and `npm run test:only -- theme/`.

## NT9 strings, sightings and Codex (as built, 2026-11-16)

No new string, role or sound: NT1 added the three `enemy.<id>.name` and `bestiary.<id>` lines with their
`l10n/context.json` entries and their sighting ids (`ARCHETYPE_SIGHTINGS`), and NT6's rows made the Codex entries
(`enemy:mortar` / `enemy:mender` / `enemy:jackal`, catalogue 94, the order lock extended, `catalog.spec` green).
Checked: the Codex claims use NX9's path with no change (`readCodexFrame` lists living actors near the view player and
the frame's deaths by archetype id; `CodexTracker` maps them to `enemy:<id>`): `view/codex/tracker.spec` gains a case,
the three seen go to their first-sighting cards (no codex toast, `sightingChip` true), each death is found with a codex
toast, and `codexSightingId` resolves the three sighting ids. `l10n:check` 0 errors / 0 warnings, `check:autolocalize`
green.

## NT11 systems pass (as built, 2026-11-16)

Specs `sim/newEnemies3.systems.spec.ts` (20) and `run/newEnemies3.validate.spec.ts` (3); no sim rule changed. Two fixes,
neither in the sim:

- **The bug hunt: `view/predict/bulletAhead.spec` "real endless floors" (failing since NT6).** Root cause: not a new
  sim rule and not a new kind's bullet. NT6's rosters put an **imp** in seed 6 floor 12's busiest room; its 5-bullet
  fan reaches a barrel at 0.5 hp, the fan's first bullet breaks it, and the bullets behind fly through the cell
  (slot 12 was the fan's third: `kind 5` ENEMY, `source 10` the imp). BulletAhead tested pieces against the merged
  state only ("a piece broken inside the window still stops bullets", a documented gap of LP10), so it drew the trailing
  bullets stopped at the barrel while the sim let them pass: on screen a freeze of up to the prediction horizon (0.3 s at
  20 ticks), then a jump. Fixed in BulletAhead (presentation only): a **break plan** once a frame per pool, lazily and
  only with intact pieces: every flying enemy bullet's first stop, the pieces' hits in the sim's order (tick, then slot;
  `config.enemyBulletDamage` each; none on an inert piece or the Goldling's, which refuse enemy sources), and every
  bullet that reaches a piece after its break re-routed to its next stop, until none moves (at most 8 rounds). A piece
  broken by a player's shot, a swing, a slam or a Charger inside the window still stops bullets, and a bullet a hit takes
  first still counts toward its piece (both documented; docs/LOCAL_PREDICTION.md Design 5 updated). New case
  "lets the bullets behind the ones that break a piece fly through it" (a row into a barrel and a crate behind it,
  against the real sim; it fails with the plan off). The real-floor case is green again (max diff 7e-14); the bench
  0.31-0.38 ms for 150 bullets at 10 ticks (was 0.33).
- **`run/testing` `legendaryTune.ts`** counted the guard feed's `guardPlayer` entries as erased bullets; a Jackal's
  guard-stopped lunge is an entry there too (NTD9, a parry), so a Jackal room would have counted parries as erasures
  toward the "<brace>+" guard rows. It now reads `ScoreEvents.guardCancels` (the erased bullets). A tool, no game change.

Every interaction with a rule:

| Interaction | Rule (as built) | Pinned by |
|---|---|---|
| Siege Bolt on a channelling Mender | the pinning hit is a hit: the beam is cut (`HealEnd.DAMAGE`) before the pin holds it; a carried Mender does not step, so it heals nothing and links nothing while carried | systems spec |
| Siege Bolt on a winding-up / lunging Jackal | a carried Jackal does not step and keeps its target's token (`jackalHoldsToken`), so no packmate winds up at that player until it is released or dies; after the release it finishes its wind-up / lunge from where it was dropped | systems spec |
| Siege Bolt on a Mortar mid-flight | a carried Mortar does not step: its flight waits, the shell lands exactly the carried ticks later and the ring holds where it was (fair: the ring never lies). A Mortar slammed dead while carried lands it from its corpse (stepCorpse is not skipped for the dead) | systems spec |
| Riposte | a guard that only stops a lunge erases nothing (`riposteCount` 0): no counter-wave, no Thunder Guard spark (NTD9); a counter-wave (a Counterstrike ring) strikes each Jackal of a pack once | systems spec |
| Overkill | a kill's carry streaks to the nearest enemy through `damageActor`: into a channelling Mender it cuts the beam (DAMAGE) | systems spec |
| Treasure UNTOUCHED (and PERFECT) | count `score.hitsTaken`: a shell on a standing target is ONE hit (the strike or a shrapnel bullet, whichever collides first; the i-frames pass the rest); a landed lunge is one; a guard-stopped lunge none | systems spec |
| A posthumous shell after its room cleared | the clear was judged at the last kill: ROOMS, PERFECT and FAST stand; the shell's hit only adds to `hitsTaken` (a vault's lock is UNLOCKED at the clear and `stepLock` cracks only while ARMED) | systems spec |
| Treasure SWIFT par | per planned spawn (`buildDeferredScoreRooms`): a pack is 3 x 90 ticks, a Mortar or a Mender 180 (NT0 finding 2) | NT0; the Horde case (par = old + telegraph + 90 x the wave's cost) |
| The Shieldwall covering a Mender | a hit the shield stops never reaches `damageActor`: the beam goes on; the beam passes through the Shieldwall's body (actors never cut sight; only players body-block, `menderBeamBlocker`); a hit from behind cuts it | systems spec |
| The Chainhook's drag and the Mortar | the lead reads `x - prevX`, which includes a drag by a Chainhook in a lower slot (slot order, the same on every client): the ring leads along the pull, clamped to `maxLead` 3 (10 u/s x 36 ticks = 6). A Chainhook in a higher slot drags after the Mortar stepped and every tick starts `prevX` at the dragged position, so its drag never shows in the lead (the ring then leads the player's own walk only) | systems spec |
| The Warbanner's aura | on all three (`isWarbannerAuraTarget`): cooldowns 80 % (the lob, the Mender's channel / bolt cooldowns, the lunge and the fixed spook cooldown 36 -> 29), walks 125 % (the keep-range walks, the circling); never the literal timers: the draw 21, the flight 60, the wind-up 21, the lunge 11, the link 24, the 30-tick pulse, the hop 12, the stagger 60 (EVD9) | systems spec |
| Co-op, one pack on two players | the token is per target: at most one Jackal attacks each player, both are lunged at; the spook reads the locked target's facing | systems spec; `jackal.spec` |
| Co-op, the Mortar's nearest player in a doorway | NTD3 per target: a Mortar whose nearest living player stands outside its room holds fire even with a teammate inside (it keeps range from the nearest one) | systems spec |
| Affixes | each Jackal of a pack rolls its own affix (`assignAffixes` per planned spawn; in an elite room the pack's three spawns raise the room's affix count `eliteAffixCount(n)`); a Swift Jackal circles at 135 % but lunges the literal 2.8 / 11 a tick; a Shielded Mender's beam is cut by a hit its affix shield absorbs whole; a Vengeful Mortar killed mid-flight fires the Vengeful ring from its corpse and still lands its shell on the planned tick (both holds keep the slot) | systems spec |
| Feast's power pellet | erases the shrapnel and the Mender's bolt; never a shell (a strike, like the Stormcaller's) | systems spec |
| Pacts' freeze (`holdAbsoluteTimers`) | nothing to hold: every new timer is `aiTicks` / `v[]` / `cooldown`, stepped only by stepActors | systems spec |
| Horde wave 2 | copies the first `hordeMaxWave` (10) planned spawns: a Mender and a Mortar like any kind; a pack at the cut is copied in part (two Jackals here, each priced 1: the par grows by 90 each); a partial pack is still a pack (same target) | systems spec |
| Server validation | a recorded endless run per kind (the first planning room of floors 2-6 whose run shows the kind's own action: a shell landed, a Mender's bolt or link, a lunge; 8 s passive at 3-5, then a sword fight to 20 s) replays to the same hash and `validateRun` accepts it | `run/newEnemies3.validate.spec` |

No rule, notes only:

- **Blood Moon** doubles the affix shares (docs/FLOOR_MODIFIERS.md); nothing pack-specific beyond the per-spawn rule
  above (a Blood Moon elite room with a pack has three more eligible spawns).
- **Hulking Jackal**: its radius grows, so its lunge's overlap reach (`radius + PLAYER_RADIUS`) and its guard-stop
  distance grow with it; its lunge distance is literal.
- **Phantom Step and the strike**: a roll through a shell is i-framed (strikes are never erased by Phantom Step); the
  shrapnel is erased like any bullet. Bastion's roll brace counts the shrapnel (not the strike: quiet bullets).
- **Mirror Cloak** reflects a guard-erased shrapnel bullet or Mender bolt like any bullet; a shell is never erased.
- **The Goldling's piece**: the shell ignores breakables (a strike), the shrapnel is an enemy bullet, which
  `goldenGuardsPiece` refuses (it stops on the piece, no damage): a Mortar never releases the Goldling.
- **Secret rooms**: a shell or its shrapnel on a cracked wall is a knock at most (enemy sources never open it); a player
  inside an opened chamber is outside every Mortar's room (`roomIdAt` reads the Forge grid, where the chamber is void),
  so no Mortar lobs at them there.
- **Dev god mode**: the shell, the shrapnel, the bolt and the lunge go through `damagePlayer` / `hurtPlayerAt` and count
  in `dev.blockedHits` like every enemy hit.
- **A Mortar's lead in co-op** is its nearest player's own `prevX`; a Siege-dragged Mortar that ends outside its room
  walks home before anything else (NT2).
- **The Snatcher and a Jackal pack**: no rule between them (the Snatcher takes pellets, Jackals ignore pellets).

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
| v[] (3-7) | 3 phase ticks (hop / recover / stagger), 4-5 lunge heading, 6 hit bit, 7 the target locked at the wind-up (NT4: the token's and the spook's target, a co-op finding) |
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
