# Enemy variants: plan

Endless floors buy only three room enemies today (swarmer 3 / sniper 2 / bruiser 1, `ENDLESS_ROOM_KINDS`), so floor 20
fights like floor 2 with more hp. This plan adds **three new archetypes** that fill the roster's gaps (a flanker, a
zone-denier, a support) and **elite affixes**: one-rule modifiers (Hulking, Swift, Shielded, Vengeful) that ride on any
room enemy. Both **unlock by depth**, so each stretch of an endless run meets something new. Work it task by task, like
`PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes and affixes live in the sim, replay, validate on the server and step in lockstep.
It follows the established patterns: new archetypes take a new registry band (no web index moves), new kinds join the
room pool only from their unlock floor (floors before it spend exactly as today), and affixes are opt-in
`SimConfig.affixes` with their own `state.affixes`, their own rng stream on the dungeon side and their own hash group
appended last. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before.

## Status (2026-10-31)

Built (EV0-EV7, EV9, EV12, EV13 in code; EV10 / EV11 prepared) and merged to `main` (`34977e5`, 2026-10-31).
Decisions: the scope answers, EVD1-EVD12 and EVD13-EVD16 (below). Headless: the full suite passes. Open:

- **Uploaded 2026-10-31** (EV10 / EV11): `slime-body.png` / `slime-body-outline.png` and the five `sfx-enemy-*` /
  `sfx-affix-*` clips have ids in `packs/vale/assetIds.ts`, so the bundled vale pack draws the slime (and the 0.6x
  slimelet) as its sprite set with its rim and plays the five sounds.
- **Imp and summoner sets uploaded 2026-10-31** (the picks delegated by the owner; see "EV10 imp / summoner (as
  built)"): `enemy.imp` = Demons **Imp 9** (idle, Run, Attack 5 split at `VARIANT_ANIM_MARKS.imp.land` 5 / 9,
  TakeDamage 1, Die 1), `enemy.summoner` = **Demon Spawn 10** (idle, Walk, Attack 2 = panic, Taunt = `attack.2` the
  summon cast, TakeDamage 1, Die 1). All 12 files have ids in `assetIds.ts`, so the bundled vale pack draws both as
  their sprite sets with rims. Every new enemy now has its art.
- **Owner calls from EV13** (see "EV13 tuning (as built)"): the spender's dearest-kind tie-break plus an Ooze cap of 8
  per room; Ooze hp 8 -> 6 and slimelet 3 -> 2. From the branch review: the Summoner only checks for panic when its
  summon cooldown is up (so a dive right after a cast gets no panic for up to ~5.5 s); the Imp fires its fan even if it
  lost sight during the 0.35 s aim (the sniper cancels).
- **Studio check (EV14)**: the checklists under EV9 / EV12 / EV10; nothing has run in Studio.
- Respite (docs/DIFFICULTY.md) is not built: it hooks into `actorWalkPercent` / `actorCooldownPercent`
  (`combat/actors/actorMods.ts`) when it lands.
- `validate.luau` sits at Luau's 200 top-level locals: the next theme validator addition must fold into a module.

## EV0 findings (2026-10-30)

Read-only audit of `enemy-variants` @ `c9849b7` (main + draft reveal + grazes and parries). Paths are under `src/`
unless they start with `docs/` or `art/`. Contact sheets (gitignored `art/build/contact/`, made by a scratch PIL
script, not committed: dark `#1a1619`, 2x nearest): `ev-imps.png` (Imp 1-10, Idle frame 0, rows 2 / 1 / 6 =
front / three-quarter / back by DA1's row order), `ev-spawns.png` (Demon spawn 1-7, 9, 10, 12, 13), `ev-slime.png`
(LoP slime S: idle 1, walk 8, death 7 frames; the body is only ~42 px of the 256 px cell). **Owner rig picks: pending.**

**1. Tutorial vs the spender: never reached.** `shared/run/tutorial.ts` `buildTutorialFloor` (475-503) calls
`placeEncounter(d, { boss })` with no `populate` (480; `dungeon/encounter.ts:188` populates only when given one), takes
floor 1's spawns from `TUTORIAL_ROOMS` (131; explicit kinds placed by `placeLesson` 353 in `buildFloor1Plan` 417) and
gives every other floor empty spawns (`emptyPerRoom`, 485). `TUTORIAL.lastFloor` = 2 (`config/tutorial.ts:93`);
"floor 3" (the draft reveal's) is floor 2's layout, empty (file comment 25, `tutorialFloorCache` 507). Only
`buildEndlessFloor` (`dungeon/endless.ts:323`) calls `endlessRoomSpawns`; `populateEndlessRoom` /
`spendEncounterBudget` have no other caller. Nothing to gate.

**2. Speed and cooldown reads.**

| Site | Read | Swift / helper |
|---|---|---|
| `sim/.../archetypes/swarmer.ts:199` | `d.speed * SIM_DT` (chase walk) | `walkStep` |
| `sniper.ts:206` | `d.speed * SIM_DT` (approach / back off / strafe) | `walkStep` |
| `bruiser.ts:197` | `d.speed * SIM_DT` | `walkStep` |
| `enemyShared.ts:173` | `d.speed * SIM_DT` (stepCalm leash walk home) | `walkStep` |
| `boss/shared.ts:397` | `d.speed * SIM_DT` (boss walk home) | boss: stays raw |
| `swarmer.ts:133` | `d.lungeSpeed * SIM_DT` (lunge, an attack) | stays raw (reach is the telegraphed aim line) |
| `testing/testArchetypes.ts:42` | `ctx.data(a).speed` | test only |
| `swarmer.ts:114` | `randomInt(0, jitter)` first lunge, in **`init`** | `enemyCooldown` (see plan change 7) |
| `swarmer.ts:189` | `randomInt(lungeCooldownMin, Max)` | `enemyCooldown` |
| `sniper.ts:132` | `randomInt(firstVolleyMin, Max)`, in **`init`** | `enemyCooldown` (plan change 7) |
| `sniper.ts:175` / `177` | volley cooldown / cancelled retry | `enemyCooldown` |
| `bruiser.ts:139` | `a.cooldown = d.firstSlam` (fixed, NO draw, every calm tick) | a no-draw scale or leave |
| `bruiser.ts:212` | `randomInt(slamCooldownMin, Max)` | `enemyCooldown` |
| `sniper.ts:180`, `235` | `randomInt(strafeFlipMin, Max)` into `aiTicks` | movement timer, not a cooldown: leave |
| `bruiser.ts:205`, `boss/*` | gap turns / boss picks | not timing |
| `turretShared.ts:73/98/105` | fixed `firstTicks` / `periodTicks` | turrets: never affixed |

View reads that predict sim timing or speed: `view/sprites.ts` `swarmerAttack` 457-466 (`lungeTelegraphTicks` +
`lungeTicks`), `sniperAttack` 488-492 (`telegraphTicks`), `bruiserAttack` 661-674 (`telegraphTicks`, `recoverTicks`),
boss 798 (`slamRecoverTicks` / `recoverTicks`); corpse time 474 / 499 / 517 / 619 / 681 and
`client/.../render/ActorRenderController.ts:347` (`data.corpseTicks ?? CORPSE_TICKS`); move-anim rate
`sprites.ts:218-220` = measured ground speed / `refSpeed` (clamped 0.25-2), refs `view/config.ts:219/221/226/253/255`
(`data.speed`); markings `view/markings.ts:216-235` (aim line bold when `aiTicks < boldTicks`; shockwave
`startTicks` = the bruiser's fixed recover, `speed` unscaled) via `TelegraphController.ts:140-142`. **None reads a
cooldown**, so Swift (cooldowns only, telegraphs never shorten, EVD9) needs no view change; the walk anim speeds up
by itself (1.35x Swift, 0.85x Hulking). Only a lever that scales telegraph / lunge / recover ticks would need these
view sites to read the helpers.

**3. Arc shapes.** Web table (`combat/arcTable.ts`): bruiser ring 17 @ 5.026548245743669 (summoner panic ring and
Vengeful reuse `BRUISER.data.ring` or the same expression: no row); 1 @ 0 (goo's single bullet: no row); 5 @ 0.5
(turret.sniper, 28.6 deg) and 5 @ 1 (boss FAN, 57.3 deg). **No 5-bullet ~40 deg fan exists.** Port table today:
7 @ 2.4 and 8 @ TAU/3 - 1 (Demon Lord). Add the imp row: (a) `IMP_FAN` spread as a literal constant in `imp.ts`
(e.g. 0.7 = 40.1 deg); (b) one `PORT_ARC_SOURCES` row in `combat/arcTablePort.ts` `{ count: 5, spread: 0.7, source:
"archetypes/imp.ts FAN" }`, written with the SAME literal (the Demon Lord rows copy literals; no import, to keep
the module graph flat); (c) a case in `sim/arcTablePort.spec.ts` ("resolve to these shapes and fire"); nothing to
regenerate. Reusing 5 @ 0.5 or 5 @ 1 instead needs NO row: a port row equal to a web shape throws at load
(`combat/projectilePatterns.ts:66-68`).

**4. Corpses.** `CORPSE_TICKS` 30 (`combat/combatData.ts:52`); `stepActors` (`actors.ts:267-269`): dead ->
`deadTicks++`, then `def.stepDead` or free at `data.corpseTicks ?? CORPSE_TICKS`; `freeActor` (237-240) releases the
emitter (bullets keep flying), so a held corpse can still `ctx.fireEnemy` (no alive check, `ctx.ts:176`). View:
`corpseTransparency` (`sprites.ts:1147`) is `clamp(deadTicks / corpseTicks)`: past 30 ticks a held corpse is fully
transparent, and the death animation is stretched over `corpseTicks`. Holding a slot longer breaks nothing in the sim
(pool pressure only; `roomClears.ts:57` picks the member with the smallest `deadTicks`, fine), but Vengeful's 36-tick
hold would pulse an invisible corpse (plan change 5). `def.stepDead` must NOT be used for the hold: it marks a kind as
a reviver (`scoreKill` `scoredReviverIds`, `runOnKill` Vampire Fang, `dropsOnKill` exclusion; `actors.ts:221-226`).

**5. Grazes, parries, per-bullet mechanics.** Graze (`score/score.ts:671-708`, called from `combat/combat.ts:290` solo
and 304-315 co-op): an enemy bullet that enters the graze ring (`PLAYER_RADIUS + ENEMY_BULLET_RADIUS + GRAZE_MARGIN`)
and leaves without entering the hit circle awards `GRAZE_POINTS` 5 (hashed score), **feeds the combo** and pushes the
unhashed spark feed; once per bullet (payload `GRAZE_DONE_BIT`). Guard (`weapons/defs/sword.ts:222-264`): every enemy
bullet erased by the guard sweep scores `GUARD_CANCEL_POINTS` 10 (`scoreGuardCancels`), pushes `guardX/Z` (PARRY!
flash, sparks, solo 30 ms freeze, sound) and releases the tutorial guard lock; Mirror Cloak reflect skips speed-0
bullets already (`weapons/melee.ts:37`). **Every sword swing and finisher also erases enemy bullets**
(`sword.ts:166-195`, `deleteEnemyBullets` true; unscored). Other per-bullet paths: Ember clears all; walls and
breakables consume enemy bullets and **enemy bullets damage breakables** (`breakables.ts:200`, `combat.ts:284` / `302`); the
enemy-shoot cue fires on any rise of `combat.enemySpawned` (`view/audio/cues.ts:864-866`); combo shout / PARRY! /
HUD occlusion duck near enemy bullets (`ComboController`, `ParryFlashController`, `HudOcclusionController`). A goo
puddle (stationary, one per 0.5 s, 3 s life) is farmable: walk the trail = 2 grazes/s per Ooze (points + combo kept
alive), guard the trail = 10 pts + a PARRY per puddle. Exclusions by `BulletKind.GOO`: graze visit (both hit
callbacks), guard cancel count + sink (count goo apart from `arc.deleted`, `melee.ts:67`), the enemy-shoot cue, and
(owner call) breakable damage. Hit radius is global (`ENEMY_BULLET_RADIUS` 0.12, `combat.ts:270`): see plan change 1.

**6. Hash groups.** Order (`sim/hashLayout.ts`, `sim/replay.ts:182-183`): core, combatHeader, actors, weapons,
enemyBullets, playerBullets, endless, score, run, party, tutorial, breakables, **drops (last)**. Respite: not built
(no `respite` in `src/`; docs/DIFFICULTY.md status 2026-10-27, planned).

**7. Score.** Par = `ROOM_PAR_BASE_TICKS` 360 + `ROOM_PAR_TICKS_PER_COST` 90 x `encounterCost(kind)` summed over the
PLANNED spawns, fixed at floor start (`buildDeferredScoreRooms`, `score.ts:320-333`, via `rebuildScoreRooms`,
`sim/endless.ts:208`). Members: `attachScoreRoomMembers` (`score.ts:341-357`) on room entry
(`sim/endless.ts:320-332`: `spawnAll`, then attach, drops, tutorial); hashed as count + (slot, id) pairs
(`score.ts:851-852`); `member()` (713-716) guards stale slots by id; `scoreRoomDown` (739-745) = no member present
and alive, judged in the end-of-tick pass (802-808), so a child spawned in `onDeath` and adopted in the same tick
keeps the room open. `adoptScoreRoomMember` goes next to `attachScoreRoomMembers` in `score.ts` (find the record
whose members hold the parent's slot + id, `cleared === 0`, append the child; no par change), exported through the
score barrel. View: `view/fx/roomClears.ts` reads `memberSlots` live (57, 129); `view/roomEdgeState.ts` uses the
exported `scoreRoomDown` / `scoreRoomEngaged` (fallback only for unscored M1); both follow adopted members as is.

**8. Elite in the view.** `view/fx/tracker.ts:201`: `snapElite` = the actor's room type is `elite` at the first frame
its slot is seen (so runtime spawns in an elite room are already "elite"); `events.ts:62`; consumers:
`HealthBarController.ts:129/276/342` (plate `enemyHealthElite`), `ParticleController.ts:160` (x1.5 gold sparks),
`hitReact.ts:58` / `freezeRules.ts:51` (heavier kill freeze). "Affixed" must come from `state.affixes` (actorId
guard) at the same line.

**9. Worlds.** One builder for client and server: `shared/run/endless.ts` `buildEndlessRunConfig` (182-211; config
literals 191-205, solo and party) through `shared/run/worlds.ts:65` `buildWorldSetup`; `affixes: AFFIXES_CONFIG` goes
next to `breakables` / `drops` there. Floors: `endlessRunFloor` -> `endlessFloorWorld(layout)` (115-139, add
`roomAffixes`); layout from `dungeon/endless.ts:309` `buildEndlessFloor` (`EndlessFloorLayout` 276, breakables run last
at 325); sim type `EndlessFloorWorld` (`sim/endless.ts:65`). The tutorial also uses `endlessFloorWorld`
(`run/tutorial.ts:503`), so `roomAffixes` must be optional.

**10. Bullet renderer.** `client/.../render/BulletRenderController.ts`: `BulletPool` (28-162) maps part i = bullet
SLOT i, lazily grown to `highWater()`, one `BulkMoveTo` per pool per frame; two pools today (enemy, player). The client
reads no payload today; kind = `BulletPayload.get(sim.payloadAt(i), "kind")` (graze flag bits sit above the layout).
A second enemy pool fits: give `BulletPool` an optional kind filter (`include GOO` / `exclude GOO`) on the same
`state.combat.enemyBullets`, the goo pool with its own look, a flat floor CFrame and its own fade (the sim's
`fadeAt` shrinks over the last 1 s, `bullets.ts:79`). Cost: a second part array as long as the enemy high-water mark
(parked parts).

**11. Onboarding.** `shared/onboarding/doc.ts`: `{ v, tutorialVersion, outcome, at }`, `ONBOARDING_DOC_VERSION` 1
(`config.ts`); `decodeOnboardingDoc` returns the EMPTY doc for any other `v`. A per-account seen set fits as an
optional field (`seen: string[]` of archetype / affix ids, capped, unknown ids dropped) read as empty when missing,
**under v 1** (plan change 9). Status reaches the client by `onboardingStatus` (`shared/network.ts:344`); a
`markSeen` remote with its own rate limit like `TUTORIAL_STEP_RATE`. Toast: `client/ui/hud/ToastPanel.tsx`.

**12. Theme contract.** `ENEMY_ARCHETYPES` (`theme/contract.ts:348`) generates the required `enemy.<x>` asset slots
(685) and `enemy.<x>.name` strings (788); colour roles are a hand list (`theme/types.ts:60-67`); placeholders
`PLACEHOLDER_PROPORTIONS` (`placeholders.ts:100-116`), `ENEMY_SHAPES` (216-223), `buildTable` (313); placeholder pack
colours / assets / strings (`packs/placeholder/manifest.ts:62/189/331`); vale deep-clones the placeholder manifest
(`packs/vale/manifest.ts:397`). Top-level locals in the compiled `out/` (built after HEAD): **contract.luau 196,
validate.luau 200** (at the limit).

**13. Packs.** `populateEndlessRoom` (`dungeon/endless.ts:168-205`) packs only `kind === SWARMER_KIND`; every other
kind (so imp, slime, summoner) takes `spreadTile` and becomes an anchor: spread out. The spender (132-160) also
computes `dearest` over all affordable kinds; `fromFloor` / `maxPerRoom` must skip in that loop too.

**14. Recent work to account for.** Grazes / parries (item 5). Combo window 6 s (grazes and withered summons feed
it). Draft reveal: no sim change; tutorial floor 3 (item 1). UI art (planned): restyles toasts and HUD panels, so the
first-sighting toast must use `ToastPanel`, and affix chips / shield segment the existing health-bar plate, not new
widgets. Hourglass (`progression/runMods.ts:342`) slows enemy bullet TIME, so bullet lives stretch.

### Plan changes needed

1. **Goo size.** `BurstSpec.radius` is a spawn OFFSET, not a hit size (`combat/patterns.ts:61`); every enemy bullet
   hits at `ENEMY_BULLET_RADIUS` 0.12. Either a GOO hit radius in `enemyBulletHit` / `enemyBulletHitParty` (by kind;
   no other bullet changes) or keep 0.12 and only draw it larger (`scale` / the decal).
2. **"At most 6 goo alive by construction" is false under Hourglass** (bullet life slows). Cap by count or restate the
   bound and spec it without Hourglass.
3. **Exclude `BulletKind.GOO`** from grazes, from guard cancel points and the parry feed (still erased), from the
   enemy-shoot cue; decide breakable damage. Collision / hashing unchanged otherwise.
4. **Any sword swing erases goo**, not only the guard (unscored). Fix the counterplay text, or exempt GOO from swing
   erases.
5. **Vengeful corpse view:** the view needs a per-actor corpse length (hold + fade, from `state.affixes`) or the
   pulse is invisible after 30 ticks; never implement the hold with `def.stepDead`.
6. **Vengeful in co-op:** `stepAffixes` runs after the actor phase, so it must `ctx.targetNearest(corpse)` itself;
   its gap turn is one main-rng `ctx.randomInt` (affixed runs only).
7. **Stamping happens after `init`:** swarmer and sniper draw their first cooldown in `init` (inside `spawnActor`),
   so Swift cannot scale it unless the affix is known before `init`; accept and spec it, or stamp inside the spawn.
   Pair each planned spawn with `spawnActor`'s result in the loop (`spawnAll` silently drops; `sim/endless.ts:164`).
   Bruiser's first slam is a fixed value (no draw): `enemyCooldown` needs a no-draw form or it stays unscaled.
8. **Affix par goes in at floor start:** `AFFIX_PAR_COST` must be added in `buildDeferredScoreRooms` from
   `roomAffixes` (plumbed through `rebuildScoreRooms`), not when stamping. Adopted children add no par; set the
   slime's cost with the split included (`slime.small` without a row would cost `DEFAULT_ENCOUNTER_COST` 1).
9. **EV12 must not bump `ONBOARDING_DOC_VERSION`:** old docs would decode as empty and every existing player would be
   forced through the first-run tutorial again. Add an optional `seen` field under v 1.
10. **`validate.luau` is at 200 top-level locals** (contract.luau 196): `affixReport` / `gooReport` go in a new module
    whose call is folded into existing code; EV1 / EV8 compile both under Lune.
11. **Summoner wither by id:** `onBossDeath` kills everything in the arena and `summonedAlive` counts by kind; the
    summoner must count and wither only its own summons (ids in v4-6), through `ctx.killActor` (they score, feed the
    combo, roll drops and pity).
12. **Hulking draw size:** placeholders are pooled by `id@spriteScale` (`ActorRenderController.ts:386-390`) and sprite
    views by set id; 1.2x needs a per-actor scale in both (pool key including it).
13. **Elite look:** the view already marks runtime spawns in elite rooms elite (`tracker.ts:201`); say whether
    summons and slimelets keep that.
14. **Radius > 0.5:** slime 0.55 (Hulking 0.66) and Hulking bruiser 0.6 would be the first room enemies wider than a
    tile: check 1-tile pillar gaps with the steer mover in EV3 / EV7 (corridors are 3 wide).
15. Minor: the "4 sites" are right for room enemies; `boss/shared.ts:397` also reads `d.speed` (boss, stays raw).

### EV10 slime (as built) (2026-10-30)

Branch `ev-art`. Built and verified headlessly; **nothing uploaded** (uploads happen on the owner's side), so the
bundled vale pack still draws the placeholder dome for `slime` / `slime.small` and the five EV sounds stay silent.

**Slime set `enemy.slime`** (`art/atlases.json`; `slime.small` draws the same set at `spriteScale` 0.6, no set of its
own). Source `lords-of-pain/enemy/slime/` (`frames` source, the skeleton's 16 `facingDirs`, E = 0 counter-clockwise;
the 256 new PNGs are in `art/vendor.lock.json` via `art:lock`). Animations: `idle` = `slime_default_idle` (1 frame),
`move` = `slime_default_walk` (8, 10 fps), `death` = `slime_special_death` (7, 10 fps), every frame kept;
stand-ins `hit` = idle's cell (flash only, no hit animation) and `attack` = the walk's cells (the Ooze has no
telegraphed attack; the slot requires the name). Rim: `outline.widthPx` 2, `pad` 3 (docs/OUTLINE.md, as every enemy).

- **Measured.** Union box (alpha > 2, baked shadow included) 64x46 -> cells **70x52**. The lit body (alpha > 64,
  max RGB > 8, the skeleton's cut) is much smaller than EV0's "~42 px" (that was the shadowed box): 24x25 px on the
  measured frame (idle, facing 12 = S, frame 0, stalk included); over the 16 idle facings 24-27 px wide, **mean 25.6
  px** (N / S 24, E / W 27), the walk stretches to 34 px along its axis.
- **Size.** Sized by width, not by the pack's scale (the skeleton's 29.6 px/tile would draw it 0.87 tiles wide):
  1.1 tiles for r 0.55 needs 25.6 / 1.1 = 23.3 px/tile, so `bodyTiles` 1.07 (25 px / 1.07) -> **pixelsPerTile
  23.4**: the dome is 1.03-1.15 tiles wide (mean 1.09); the slimelet at 0.6x is 0.66 tiles for r 0.35 (0.7). Pivot
  (35, 36): the bottom edge of the dome.
- **Budget: 2 textures**, one atlas for all three animations (16 x (1 + 8 + 7) = 256 cells, 14 per row x 19 rows):
  `slime-body.png` **980x988** (676 KB) + `slime-body-outline.png` 980x988 (141 KB), ~3.9 MB GPU each (~7.7 MB),
  the sniper's / one swarmer sheet pair's cost. `slime.small` adds nothing. Two builds are byte-identical.
- **Contact sheet** (`art/build/contact/enemy.slime.png`, read 2026-10-30): all 16 facings x idle / walk / death
  upright, the 2 px rim closed around the dome in every cell, the pivot cross on the dome's bottom edge in every facing.
  Facing evidence: the walk stretches along the facing axis (wide on the E / W rows, tall on N / S) with the stalk
  trailing; N rows show the back (no bright core), S rows the bright green core towards the camera; death melts the
  stalk and slumps the dome into a puddle. Mean body colour `#2a3622`, **1.41:1** on the biome 1 floor (`#1a1619`):
  the rim carries it, as on the sniper. Verdict: good to upload; the Studio check (EV14) judges size vs hitbox and the
  0.6x slimelet.
- **Code.** `packs/vale/layout.ts` gains `enemy.slime` (generated); `vale.spec.ts` covers the layout, placeholder
  without IDs, the switch with `slime-body.png`, the rim joining only with its outline, and hand-computed cells.
  `assetIds.ts` lists the pending files as commented slots (an absent key keeps the fallback; an empty string would not).

**Owner: upload** `art/upload/slime-body.png` and `art/upload/slime-body-outline.png` (art), and the five OGGs below
(`art/upload/sfx-enemy-blink.ogg`, `sfx-enemy-summon.ogg`, `sfx-enemy-split.ogg`, `sfx-affix-shieldbreak.ogg`,
`sfx-affix-vengeful.ogg`); paste each ID into the commented slot at the end of `src/shared/theme/packs/vale/assetIds.ts`
and uncomment it; `npm run verify`. (The six `sfx-draft-*.ogg` of docs/DRAFT_REVEAL.md were built in the same run and
sit in `art/upload/` too; they are that plan's upload.)

**Imp and summoner sets (the pre-pick brief; superseded by "EV10 imp / summoner (as built)" below).** Decide, from `art/build/contact/ev-imps.png`
and `ev-spawns.png`:

1. **Imp rig**: one of Imp 1-10.
2. **Summoner rig**: a robed Demon Spawn other than 8 / 11 (the turrets): 1-7, 9, 10, 12 or 13.
3. **Imp blink source**: `Crouch.png` (a wind-up held over the 0.5 s ring), a segment of `Roll 1.png`, or
   `BackFlip 1.png`; and which frames (a short segment, ~4-6 kept).
4. **Imp fan**: which of `Attack 1-4.png` (shown over the 0.35 s aim telegraph, the shot on its last tick).
5. **Summoner summon** (the 1.0 s cast under the ring): which `Attack N.png` (or `Taunt.png`); **panic** (0.5 s, the
   gapped ring): another `Attack N.png`, or the same one.
6. **Walk vs Run** for each (the imp moves at 3.2 u/s, the summoner at 1.8: `Run.png` may suit the imp).
7. Whether blink / panic get **their own animation names** (`blink`, `panic`: extra names the contract allows, but
   EV9's sprite inputs must choose them) or fold into `attack`.

What each set entry will look like (per-sheet Demons pipeline, a copy of `enemy.bruiser`'s shape):
`source: { type: "grid", dir: "demons-topdown/Spritesheets with seperated shadows and effects/<rig>", frameW: 128,
frameH: 128, layers: ["Shadows", ""] }` (Effects/ skipped, DD3), `facingCount` 8, `rowForFacing` [0, 7, 6, 5, 4, 3,
2, 1] (clockwise rows, the knight's order), `noiseAlpha` 2, `pad` 3, pivot measured on idle facing 6 frame 0
(`bodyAlpha` 250, `bodyMinRgb` 0, `footBand` 6), `outline: { widthPx: 2 }`, `pixelsPerTileFrom: "class.vanguard"`
(the artist's scale next to the knight; check drawn width vs r 0.35 / 0.4 in Studio), `resample` Default, `cells`
"perSheet", and `layerNoiseAlpha: { "": 254 }` only if the rig's body sheets bake a glow (as Spawn 8 / 11 do: look at
the contact sheet). Animation slots:

| Slot | Imp (`enemy.imp`) | Summoner (`enemy.summoner`) |
|---|---|---|
| `idle` | `Idle.png`, 4 of 15 frames, 6 fps, loop | `Idle.png` (Spawn 1: `Idle 1.png`), 4 frames, 6 fps, loop |
| `move` | `Walk.png` or `Run.png` (decision 6), 8 frames, 10 fps, loop | `Walk.png`, 8 frames, 10 fps, loop |
| `attack` | the fan: `Attack N.png` (decision 4), ~6-8 frames, not looped | the summon cast: `Attack N.png` (decision 5), ~8 frames, stretched over the 1.0 s telegraph |
| `blink` / `panic` (decision 7) | blink = `Crouch.png` or a `Roll 1.png` segment (decision 3) | panic = `Attack N.png` (decision 5) |
| `hit` | `TakeDamage 1.png`, 4 frames, 12 fps | `TakeDamage 1.png`, 4 frames, 12 fps |
| `death` | `Die 1.png`, 6 frames, 10 fps | `Die 1.png`, 6 frames, 10 fps |

Sheets as the bruiser's: `<id>-body` (idle + move + hit, + blink for the imp), `<id>-attack` (+ panic for the
summoner), `<id>-death`, each with its `-outline` sheet: expect **3 sheets + 3 rims = 6 textures per archetype**
(the bruiser's count; the per-sheet crop decides the exact sizes). Then `npm run art:lock` (the new rig's files),
`art:build`, the contact sheet, `vale.spec` cases like the bruiser's, upload, IDs.

### EV10 imp / summoner (as built) (2026-10-31)

Branch `ev-rigs`. Built and verified headlessly; **nothing uploaded**, so the bundled vale pack still draws the
placeholder cone (`enemy.imp`) and drum (`enemy.summoner`) until the 12 files below have IDs. Presentation only:
nothing under `sim/`, `dungeon/` or the fixtures changed.

**Picks** (delegated by the owner, 2026-10-31): `enemy.imp` = Demons **Imp 9** (the red imp with a staff),
`enemy.summoner` = Demons **Demon Spawn 10** (the pale robed horned demon with a scythe: the priority target, a
different body from the dark turrets Spawn 8 / 11 and from the red imps). Both are a copy of `enemy.bruiser`'s shape
in `art/atlases.json`: grid 128, body over `Shadows/` (no `Effects/`, DD3), the knight's `rowForFacing`, `noiseAlpha`
2, `pad` 3, the 2 px rim, pivot on idle facing 6 frame 0 (`bodyAlpha` 250, `bodyMinRgb` 0, `footBand` 6),
`resample` Default, `cells` "perSheet". Neither rig bakes a glow into its body sheets (alpha 0 / 255 only), so no
`layerNoiseAlpha`; the shadow layer is flat alpha 194 (Imp 9) / 191 (Spawn 10), RGB (2, 4, 5). `art:lock` added
exactly the 22 files the two sets read (11 body sheets + their `Shadows/` layers).

| Slot | Imp 9 (`enemy.imp`) | Demon Spawn 10 (`enemy.summoner`) |
|---|---|---|
| `idle` (loop) | `Idle 1`, 0 3 7 10, fps 6 | `Idle 16`, 0 3 7 10, fps 6 |
| `move` (loop, by speed) | **`Run`** (a crouched sprint), 0 2 4 5 7 9 11 12, fps 14 | `Walk`, 0 2 4 5 7 9 11 12, fps 10 |
| `attack` | **`Attack 5`**, 0 2 4 5 7 8 9 10 11 (9): lean back, deep crouch, then the rising staff sweep; [0, `land`) over the 30-tick blink wind-up, [`land`, 1] over the 21-tick landing aim | **`Attack 2`** (the panic), 0 2 3 4 5 6 (6): the scythe raised overhead, then the wide sweep down on the ring's release, over the 30-tick panic wind-up |
| `attack.2` | | **`Taunt`** (the summon cast), 0 3 4 5 7 9 10 12 (8), fps 8: standing, arms out sinking low (the body drops 47 -> 30 px), rising as the summons burst, over the 60-tick ring |
| `hit` | `TakeDamage 1`, 1 3 5 8, fps 12 | `TakeDamage 1`, 1 3 5 8, fps 12 |
| `death` | `Die 1`, 0 2 4 6 9 14, fps 10 | `Die 1`, 0 2 4 6 9 14, fps 10 |

- **The imp's mark.** Body height (alpha > 250, facing the camera) over Attack 5: 42 35 40 39 37 **23 23 25** 35 49
  51 50 47 43 42 px (frames 0-14): the crouch bottoms out over f5-f7 and the body rises from f8 into the sweep
  (f9-f11); f12-f14 return to idle and are not kept. So the sweep starts at kept index 5 of 9:
  **`VARIANT_ANIM_MARKS.imp.land` = 5 / 9** (was the 0.5 placeholder; frames 0-4 over the blink, 5-8 over the aim, the
  last sweep frame on the fan's tick). Attack 5 splits cleanly, so Roll 1 was not needed for the blink.
- **The summoner's names.** `VARIANT_SPRITE_VIEW.summonerAnims` (cast `attack.2`, panic `attack`) unchanged. The enemy
  slot's contract now names `attack.2` as an optional animation (inline `ENEMY.optionalAnimations`: the compiled contract.luau is at the 200-locals limit):
  the validator already accepted any extra name, so this only documents what the renderer asks for (theme README, the
  contract spec).
- **Walk vs Run (stride against the knight).** Planted-foot slide per source frame in the profile row: knight Run
  ~5.7 px (at 6 u/s and fps 12 it plays 1.8x its stride), bruiser Walk ~5 px (0.8x at 2 u/s), Imp 9 Walk ~1.9 px,
  Imp 9 Run ~2.6 px, Spawn 10 Walk ~2.9 px. At 3.2 u/s the imp's Walk (1.0 tile a cycle) would skate 2.6x at fps 10;
  the Run (1.4 tiles a cycle) at fps 14 plays 1.3x: Run, and it reads as a darting imp. The summoner's Walk (1.4 tiles
  a cycle) at fps 10 and 1.8 u/s plays 1.0x.
- **Scale** (`bodyTiles`, not the knight's density). At the knight's 38 px/tile Imp 9 would stand 0.89 tiles (60% of
  the knight's 1.5) and Spawn 10 1.24. As built: the imp **bodyTiles 1.2** (34 px -> 28.3 px/tile: a bit smaller
  than the knight; 31-33 px = 1.1-1.2 tiles wide with the staff, against r 0.35), the summoner **bodyTiles 1.5**
  (47 px -> 31.3 px/tile: the knight's height; 34-36 px = 1.1 tiles wide, against r 0.4). The Studio check (EV14)
  judges both against the hitbox.
- **Budget: 6 textures per set** (3 atlases + 3 rims, each <= 1024), the bruiser's count:

| Sheet | Animations | Cell | Pivot | Cells | Size | PNG |
|---|---|---|---|---|---|---|
| `imp-attack` | attack | 64x74 | (37, 57) | 72 | 384x888 | 299 KB |
| `imp-body` | idle, move, hit | 62x64 | (36, 48) | 128 | 496x1024 | 483 KB |
| `imp-death` | death | 78x70 | (44, 46) | 48 | 312x840 | 212 KB |
| `summoner-attack` | attack, attack.2 | 80x93 | (42, 68) | 112 | 960x930 | 778 KB |
| `summoner-body` | idle, move, hit | 70x77 | (37, 55) | 128 | 700x1001 | 766 KB |
| `summoner-death` | death | 100x87 | (52, 51) | 48 | 600x696 | 366 KB |

  Set cells (the unions) 78x81, pivot (44, 57) = source (69, 86) for the imp; 100x104, pivot (52, 68) = source
  (66, 83) for the summoner. Each sheet has its `-outline` sheet of the same size (17-60 KB). GPU: ~8.9 MB for the
  imp (rims included), ~16 MB for the summoner (the bruiser ~14 MB). No frame touches the 128 source edge (source
  boxes 28,32-99,106 and 17,18-110,115), no rim is clipped at a cell edge. Two builds are byte-identical; `layout.ts`
  only gained the two sets (every older layout unchanged).
- **Contact sheets** (`art/build/contact/enemy.imp.png`, `enemy.summoner.png`, read 2026-10-31; the source rows at
  4x in `art/build/ev-previews/`): every frame inside its cell with the 2 px rim closed around it; the pivot cross on
  the feet facing the camera. In the other facings the per-facing feet measure stays within 3 px vertically for the
  imp (horizontally up to ~15 px in the right profile: its back foot; the knight spreads ~10 px) and sits up to 8 px
  lower for the summoner (the scythe blade below the feet in the profiles, as the turrets' staff). Row order (the
  pack's, DA1) checked by eye: Imp 9 row 2 shows the face (both eyes, the purple belt gem), row 6 the horns from
  behind; Spawn 10 row 2 the red face marking under the hood, row 6 the strap across its back; row 0 faces screen
  right for both. Mean body colour on the biome 1 floor (`#1a1619`): the imp `#862f29` **2.09:1**, the summoner
  `#765b4e` **2.88:1** (the turrets: Spawn 8 1.88:1, Spawn 11 3.37:1). By mean luminance the summoner is not paler
  than the caster turret: it stands apart by its silhouette (horns, the scythe, the long grey-olive robe), and the
  turrets never share an endless room with it (`ENDLESS_ROOM_KINDS` picks no turret). The rim carries both on the
  dark floors. **Verdict: good to upload**; EV14 judges size against the hitbox, the Run at 3.2 u/s and the cast /
  panic timing in Studio.
- **Code.** `art/atlases.json` (+ `vendor.lock.json` additions), `packs/vale/layout.ts` (generated),
  `variantsConfig.ts` (`VARIANT_ANIM_MARKS.imp.land`), `theme/contract.ts` (`ENEMY.optionalAnimations`), `assetIds.ts`
  (12 commented slots: an absent key keeps the placeholder, an empty string would not). Specs: `vale.spec` "vale
  enemy.imp and enemy.summoner" (layouts, placeholder as bundled, the switch on all three sheets and any one missing,
  rims per sheet, hand-computed cells, the preload core tier) and the per-sheet list; `variants.spec` "VARIANT_ANIM_MARKS
  and summonerAnims on the built ..." (the mark lands on kept index 5 of 9; the cast draws `attack.2` 0-7, the panic
  `attack` 0-5); `contract.spec` (the enemy's optional list).

**Owner: upload** these 12 files from `art/upload/`: `imp-attack.png`, `imp-attack-outline.png`, `imp-body.png`,
`imp-body-outline.png`, `imp-death.png`, `imp-death-outline.png`, `summoner-attack.png`,
`summoner-attack-outline.png`, `summoner-body.png`, `summoner-body-outline.png`, `summoner-death.png`,
`summoner-death-outline.png`; paste each ID into its commented slot at the end of
`src/shared/theme/packs/vale/assetIds.ts` and uncomment it. A set switches once its three sheets have IDs (each
outline adds its rim). Then `vale.spec`'s "as bundled (nothing uploaded yet) both are the placeholder" fails by
design: rewrite it as the turrets' bundled case. `npm run verify`.

**EV11 audio picks (for the owner's audition).** `art/audio.json` gains the five IDs (`"confirmed": false`); `audio:lock`, `audio:build` (ffmpeg 6.1.1) and
`audio:audition` ran, so `packs/vale/audioLayout.ts` lists them (silent until their IDs are in `assetIds.ts`: a sound
switches on once all its files have IDs) and `art/audio-audition.html` has a section per ID with the pick and the
alternates. Listen there (open it from `art/`). Clips under `ninja-adventure/Audio/Sounds/`; the pack's Sounds folders
are Alert, Ambient, Bonus, Creature, Elemental, Hit & Impact, Jump & Bounce, Magic & Skill, Menu, Voice and Whoosh &
Slash (plus Jingles and Musics). The picks avoid clips already picked for another ID; they were chosen by name,
length, onset and brightness (measured), not by ear.

| ID | Pick (built length) | Why | Alternates | Settings |
|---|---|---|---|---|
| `sfx.enemy.blink` | `Whoosh & Slash/Whoosh2.wav` (0.29 s) | a short air cut for the snap onto the ring; unused as a pick (roll's alternate) | `Magic & Skill/Magic1.wav` (brighter zap), `Creature/Wings.wav` (a flutter) | vol 0.45, pitch 0.95-1.08, 0.15 s |
| `sfx.enemy.summon` | `Magic & Skill/Spirit.wav` (1.5 s) | a high ghostly swell that fills the 1.0 s summon ring if played at its start | `Alert/Alert5.wav` (1.5 s warning swell), `Magic & Skill/Magic2.wav` (0.31 s, if the cue plays on the burst) | vol 0.6, 0.5 s |
| `sfx.enemy.split` | `Elemental/Bubble2.wav` (0.43 s) | a wet bubble pop; it plays over the kill's `sfx.enemy.death`, so quieter | `Elemental/Water4.wav` (splash), `Elemental/Water9.wav` (slower slosh) | vol 0.5, pitch 0.9-1.1, 0.1 s |
| `sfx.affix.shieldbreak` | `Elemental/Explosion3.wav` (0.31 s) | a short bright crunch, apart from the Hit* hurts and the combo's glass | `Hit & Impact/Hit5.wav` (check it does not read as the player hit), `Elemental/Explosion.wav` (duller) | vol 0.6, pitch 0.97-1.03, 0.1 s |
| `sfx.affix.vengeful` | `Elemental/Fire3.wav` (0.63 s) | a flare about as long as the corpse's 0.6 s telegraph, so started with the pulse it ends on the ring | `Alert/Alert4.wav` (a warning, if it should read as a telegraph), `Elemental/Explosion2.wav` (if it plays on the ring) | vol 0.6, 0.2 s |

When each cue fires (blink on the landing tick or the ring; summon at the ring or the burst; vengeful at the pulse or
the ring) is EV9's cue mapper; the alternates cover either choice. After the audition: edit the clips in
`art/audio.json`, set `"confirmed": true`, `npm run audio:lock`, `audio:build`, `audio:audition`, upload the five OGGs.

## What the code gives us (read on `main` @ `3900250`)

| Fact | Where | Consequence |
|---|---|---|
| Kinds number by (`ArchetypeDef.band`, then `compareIds`); web 0..6, `dummy` band 1 (7), `boss.demonlord` band 2 (8) | `combat/actors/registry.ts` | New archetypes take **band 3** (`PORT_BAND_ENEMIES`): `imp` 9, `slime` 10, `slime.small` 11, `summoner` 12 (`compareIds`: a prefix sorts first). No recorded index moves |
| `spendEncounterBudget` walks `ENDLESS_ROOM_KINDS` in order, skips unaffordable kinds, one `rng.next()` per weighted pick | `dungeon/endless.ts` | A kind filtered out by `fromFloor` changes neither the totals nor the walk: **floors below every unlock spend draw for draw as today**. Existing weights must not change (that would move floor 1) |
| Only `buildEndlessFloor` calls `endlessRoomSpawns`; M1 uses the web `planRoom` (`enemyRooms.ts`) | `dungeon/endless.ts`, `enemyRooms.ts` | M1 and the fixtures never see the new kinds. EV0 confirms the tutorial's rooms never reach the spender at an unlock floor |
| Elite rooms exist (`ELITE_BUDGET_MULTIPLIER` 1.5) and the view already draws an elite health plate (`enemyHealthElite`) for actors spawned in one; "there is no elite flag in the sim" | `endlessData.ts`, `view/fx/events.ts`, `view/fx/bars.ts` | Affixes have a natural home and a look to extend. The view's elite test becomes "elite room OR affixed" |
| Every runtime spawn goes through `ctx.spawnActor`; `summonAdds` / `summonedAlive` (boss/shared.ts) push adds out with `moveActor`, set home and `engage` them | `combat/actors/actors.ts`, `boss/shared.ts` | The slime split and the summoner reuse the same shape of code. The pool is `MAX_ACTORS` 64; a full pool drops the spawn and counts `actorsDropped` |
| A room's score record fixes its members at room spawn (`attachScoreRoomMembers` -> `memberSlots` / `memberIds`); `scoreRoomDown` = every member dead | `score/score.ts` | **Runtime children are not members**: a room would CLEAR (stamp, room edges go safe) with slimelets or summons still alive. Needs `adoptScoreRoomMember(state, parent, child)` |
| Room enemies walk with `d.speed * SIM_DT` read at 4 sites (swarmer, sniper, bruiser, `stepCalm`); cooldowns are one `ctx.randomInt(min, max)` each | `archetypes/*.ts` | Swift needs one `walkStep(ctx, a)` helper and one `enemyCooldown(ctx, a, min, max)` helper (the SAME single draw, then scaled). Respite plans the same cooldown helper |
| Telegraphs all start through `ctx.telegraph`; render hints are `ActorFxHints` (`aimLine`, `shockwave`) | `combat/ctx.ts`, `enemyShared.ts` | One new hint, `ring` (a floor circle at v-slot coordinates), covers the imp's landing spot and the summoner's circle |
| `BurstSpec` has `speed`, `life`, `radius`, `scale` (render only); every enemy bullet is drawn with ONE look (`BULLET_VIEW.enemyVisualId`); the payload's `kind` field takes 0..15 and `BulletKind` uses 0..6 | `combat/patterns.ts`, `BulletRenderController.ts` | Goo puddles are stationary bullets (speed 0, short life, larger radius): no new bullet system. Their floor-decal look (EVD5) needs a new `BulletKind.GOO` (7) so the renderer can draw them from a second pool |
| A new burst shape a port-only archetype fires is a row in `combat/arcTablePort.ts` | CLAUDE.md conventions | The imp's 5-bullet fan (and any summoner shape not already in the table) are port rows |
| `CORPSE_TICKS` 30 (0.5 s); `freeActor` releases the emitter; in-flight bullets keep flying | `combatData.ts`, `actors.ts` | Vengeful's 0.6 s corpse telegraph needs the corpse held a little longer (one check in `stepActors`) |
| `ENEMY_ARCHETYPES` already lists `summoner` (web contract: placeholder `#5a8a4a` cylinder, name "Summoner"), no sim archetype uses it | `theme/contract.ts`, placeholder manifest | The support enemy fills the existing slot; only `imp` and `slime` are new contract entries |
| Placeholders get ONE Highlight under `KV_Actors/Enemies` (engine cap 31) | docs/OUTLINE.md | Affix colour cannot be a per-actor Highlight: it is a floor ring (both renderers) plus the sprite rim's tint |
| `KILL_POINTS`, `DROPS.chanceByArchetype`, `ENCOUNTER_COST` are per-id maps with defaults | `scoreData.ts`, `dropsData.ts`, `encounterCost.ts` | Data rows per new id; no code |
| Art on hand: LoP **slime** (16 facings, idle 1 / walk 8 / death 7 frames, 256 px cells) unused; Demons pack **31 unused rigs** (Imps 1-10, Spawns, Beasts, Elites; 8 facings, 20-23 animations each) | `art/vendor/` | Slime through the LoP pipeline (like the swarmer's skeleton); imp and summoner through the per-sheet Demons pipeline (like the bruiser) |

## Player experience

1. **Floor 1 is today's game.** Swarmers, snipers, bruisers.
2. **Floor 2: Imps.** A small demon that hangs back, then crouches and a ring lights up on the floor beside you. It
   blinks into the ring and, a beat later, fires a short fan at you. Lesson: you can always see where it lands; move off
   the ring's line.
3. **Floor 4: Oozes and the first Champions.** A slow slime that leaves a trail of goo (puddles on the floor that hurt
   and fade after 3 s) and bursts into two fast slimelets when it dies. Lesson: kite it where you won't need to walk
   back. Elite rooms now hold enemies with an affix: a coloured ring under them and a name on their health bar
   ("Swift"). Hulking ones are big and tanky, Swift ones walk fast and attack more often.
4. **Floor 6 (after the first boss): Summoners.** A Summoner keeps its distance and, under a glowing circle, calls
   swarmers to its side; kill it and its summons wither.
5. **Floors 7-9: Shielded and Vengeful champions.** Shielded ones carry a shield that refills if you leave them alone;
   Vengeful ones pulse when they die and burst into a gapped ring.
6. **Floor 11+:** a champion can turn up in any combat room, not only elite rooms.
7. **First sighting** (EVD10): the first time an account meets each new enemy or affix, a one-line toast names it and
   its tell ("Imp: watch the ring").

## Design

### New archetypes (band 3, `PORT_BAND_ENEMIES`)

All three are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts) and use `ctx.telegraph` for every
attack. Numbers are starting values, tuned in EV13.

| | **Imp** (`imp`) - flanker | **Ooze** (`slime`) - zone-denier | **Summoner** (`summoner`) - support |
|---|---|---|---|
| Gap it fills | Nothing today relocates; snipers kite slowly | Nothing denies floor over time | Nothing makes you pick a target |
| Body | 3 hp, r 0.35, 3.2 u/s, no contact damage | 8 hp, r 0.55, 1.6 u/s, contact HIT_NORMAL | 6 hp, r 0.4, 1.8 u/s, no contact damage |
| Engaged | Keeps 4-7 units (the sniper's approach / back off / strafe) | Crawls at the player | Keeps 6-9 units, prefers to break line of sight |
| Attack | Every 2.4-3.2 s: **blink**. Telegraph 0.5 s: a `ring` on the floor at the destination (the player's bearing turned ~90 degrees either way with the Pythagorean rotations the bruiser uses, 5 units from the player). On the tick it lands it snaps there (prev = new position, no streak), then a 0.35 s aim telegraph and a **5-bullet fan** (~40 degrees, slow) at the player | **Goo trail**: every 0.5 s while moving, one stationary bullet (`BulletKind.GOO`: speed 0, life 3 s, radius ~0.4, drawn as a floor decal, EVD5) at its trailing edge; at most 6 alive by construction | **Summon**: every 4.5-5.5 s, telegraph 1.0 s (`ring` at its feet), 2 swarmers burst out (`summonAdds` shape), at most 3 of its summons alive, at most 6 per life. **Panic**: player within 3 units -> 0.5 s telegraph, a gapped ring (the bruiser's ring spec) and it backs off |
| Death | - | **Splits** into 2 `slime.small` (3 hp, r 0.35, 2.6 u/s, contact HIT_NORMAL, no trail, never splits, drawn 0.6x from `enemy.slime`), pushed out sideways, engaged, adopted into the parent's room | Its live summons **wither** (die with it, like a boss's adds) |
| Counterplay | Read the ring, step off its line, punish the landing | Choose where to fight; the sword guard erases goo | Dive it; summons stop when it dies |
| v[] budget (0-2 shared) | 3-4 destination, 5-6 aim dir, 7 strafe sign | 3 trail timer, 4-5 last facing | 3 summons left, 4-6 summon ids, 7 strafe sign |
| Cost / points / drop % | 2 / 120 / 6 | 3 / 150 / 8 (small: - / 40 / 2) | 3 / 200 / 10 |
| Unlock / weight (EVD2) | floor 2 / 2 | floor 4 / 1 | floor 6 / 1, **at most 1 per room** |
| Art | Demons **Imp** rig (owner picks from the EV0 contact sheet; Roll / Crouch / Attack read as the blink) | LoP **slime** (idle, walk, death; hit = flash only) | Demons robed **Spawn** rig other than 8 / 11 (those are the turrets) |

Blink safety: the destination must be a floor cell (`ctx.isBlocked` false, no breakable), inside the imp's own room,
in line of sight of the player and at least `SPAWN_SAFE_RADIUS` from every living player; it tries the two sides and
two distances (no rng beyond the side pick) and, if none is valid, skips the blink and strafes instead (the cooldown is
drawn the same either way, so the draw count never depends on the layout).

### Elite affixes

One affix per enemy in v1. Never on bosses, turrets, the dummy, `slime.small` or any runtime spawn (summons, splits,
boss adds): only planned room spawns get one.

| Affix | Rule (sim) | Tell (view) | Unlock |
|---|---|---|---|
| **Hulking** | hp x175 %, radius x120 % (at stamp time), walk x85 % | drawn 1.2x, ring `affix.hulking` | floor 4 |
| **Swift** | walk x135 %, attack cooldowns x75 %; **telegraphs never shorten** (EVD9) | ring `affix.swift`, a faint afterimage while walking (FEEL's ghosts) | floor 4 |
| **Shielded** | a shield of 40 % of its hp absorbs damage first; refills fully after 5 s without damage | ring `affix.shielded`, a shield segment on the health bar (`enemyShield`), shield hits flash in the shield colour, `sfx.affix.shieldBreak` | floor 7 |
| **Vengeful** | on death the corpse telegraphs 0.6 s, then fires a gapped ring (the bruiser's ring, gap toward the nearest living player turned like the bruiser's) | ring `affix.vengeful`, the corpse pulses in `telegraph`, `sfx.affix.vengeful` | floor 9 |

Where (EVD7): elite rooms from floor 4, 35 % of a room's members (rounded up, at least 1) get an affix; combat rooms
from floor 11, each member 10 %. The pick (who and which affix, among the unlocked ones) is drawn from the affix
stream `new EncounterRng(floorSeed ^ AFFIX.salt)` (as the boss pick does), room by room in id order, member by member in spawn order.

Rewards (EVD8): an affixed kill scores +50 % (through `scoreKill`'s bonus percent), rolls drops with +4 points of
chance, and each affixed member adds `AFFIX_PAR_COST` to its room's par time.

## Architecture

### 1. Sim: archetypes (`combat/actors/archetypes/`)

- `imp.ts`, `slime.ts` (registers `slime` and `slime.small`), `summoner.ts`, each one file, imported by the archetypes
  index; `PORT_BAND_ENEMIES = 3` in `registry.ts`.
- `helpers.ts`: `walkStep(ctx, a)` (today `d.speed * SIM_DT`; Swift / Hulking scale it when `state.affixes` exists) and
  `enemyCooldown(ctx, a, min, max)` (one `ctx.randomInt`, then the Swift percent through `scaleTicks`; Respite's lever
  joins here). The four existing `d.speed * SIM_DT` sites and every room enemy cooldown move to them: a pure refactor
  outside affixed runs.
- `enemyShared.ts`: `ActorFxHints.ring` (`{ state, xSlot, zSlot, radius }`, drawn while `aiState === state`).
- `score/score.ts`: `adoptScoreRoomMember(state, parent, child)`: the child joins the record that holds the parent's
  slot, unless that room is already cleared. Called by the split and by the summoner (never by bosses: their adds stay
  outside room records, as today).
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype` for every new id.
- `combat/patterns.ts`: `BulletKind.GOO = 7` (the Ooze's puddles). Collision, the guard's erase and hashing treat it
  like every enemy bullet; only the renderer looks at the kind.

### 2. Dungeon: room pool and affix assignment (`shared/dungeon`)

- `EndlessRoomKind` gains optional `fromFloor` and `maxPerRoom`. `spendEncounterBudget(rng, budget, cap, floor)` skips
  a kind below its floor or at its room maximum, in BOTH loops. New kinds are appended after bruiser; existing weights
  unchanged.
- `assignAffixes(floorSeed, floor, rooms, roomSpawns)` after the Forge, from its own stream (salt chosen in EV6), output
  `roomAffixes: number[][]` (affix id per planned spawn, 0 none) on `EndlessFloorLayout` / `EndlessFloorWorld`, like
  the breakables. Layouts, digests, props, room spawns, breakables and the boss pick do not move.
- `AFFIXES` tunables in `affixesData.ts` (unlock floors, shares, salt).

### 3. Sim: affixes (`shared/sim/affixes/`, opt-in)

- `SimConfig.affixes` (`AFFIXES_CONFIG` on endless worlds; absent in M1, fixtures and the tutorial).
- `state.affixes`: per actor slot `affix`, `actorId` (stale-slot guard), `shield`, `shieldIdleTicks`, `vengeTicks`;
  slots grow with the actor pool and clear in `freeActor`. Its own hash group **`affixes`, appended last** (after
  `drops`, or after `respite` if that lands first); `hashLayout.ts` names it.
- Hooks, each a no-op without `state.affixes`: stamping in `enterRoom` after `spawnAll` (spawn index -> affix; Hulking
  hp / radius here); `damageActor` (Shielded absorbs after `filterDamage`, before the cap); `killActor` (arm Vengeful;
  score / drop bonus); `stepActors` (a Vengeful corpse is not freed while `vengeTicks > 0`); `stepAffixes` after the
  actor phase (shield refill, Vengeful countdown and fire through `ctx.fireEnemy` from the corpse).

### 4. Worlds, server, lockstep

The server builds the SimConfig itself from `StartRunRequest`; endless worlds gain `affixes` there, and floors carry
`roomAffixes` because they are built by the same pure `buildEndlessFloor` on every machine. No new request field, no
new lockstep message. Leaderboards stay on `_v1` (EVD11).

### 5. Theme contract

- `ENEMY_ARCHETYPES` += `imp`, `slime` (every pack fills `enemy.imp` / `enemy.slime` and `.name`; placeholders: a small
  cone and a low dome).
- Goo (EVD5): a bullet visual `bullet.enemy.goo` (placeholder: a flat disc; vale: a slime puddle, flat on the floor)
  and a colour role `enemyGoo`, validated >= 3:1 on every biome floor and within the enemy-bullet family (it must read
  as "this hurts", never as decor: >= 40 CIE76 from `DECOR_FX_ROLES` and every boost role), `gooReport`.
- Colour roles `AFFIX_ROLES` (`affix.hulking` / `.swift` / `.shielded` / `.vengeful`) and `enemyShield`, validated by an
  `affixReport`: >= 3:1 on every biome floor, >= 40 CIE76 from `ENEMY_BULLET_ROLES`, `telegraph` and `enemyOutline`.
- Strings: `enemy.imp.name`, `enemy.slime.name`, `affix.<id>.name`, the first-sighting lines (`AFFIX_STRING_KEYS`,
  `BESTIARY_STRING_KEYS`).
- Port audio IDs (SILENT in the placeholder): `sfx.enemy.blink`, `sfx.enemy.summon`, `sfx.enemy.split`,
  `sfx.affix.shieldBreak`, `sfx.affix.vengeful`.
- `contract.luau` sits at Luau's 200-locals limit: every new list goes inside an existing array or a function, and EV1
  checks it compiles under Lune.

### 6. View and client

- `ACTOR_SPRITE_INPUTS` builders `impSpriteInput` (blink = crouch segment, landing = roll / attack), `slimeSpriteInput`
  (`slime.small` reads `spriteScale`), `summonerSpriteInput` (summon = a cast segment; panic = attack).
- Markings: the `ring` hint (telegraph colour, filling like the existing telegraph bars).
- Goo decals (EVD5): `BulletRenderController` gains a second pool for `BulletKind.GOO`, drawn flat on the floor (the
  sprite effects' floor placement) under markings, so moving bullets always draw over it; a puddle fades over its last
  0.5 s of life and pops in over its first few ticks. Every other enemy bullet keeps today's look.
- Affixes: a floor ring under the actor (one per affixed actor, pooled; never a Highlight), the sprite rim's tint, the
  name chip and shield segment on the health bar, the elite plate when affixed, Vengeful's corpse pulse.
- Every timing the view predicts (telegraph fill, attack animation stretch) reads the same helpers the sim uses, so
  Swift and Respite never draw a bar that fills early.

### Respite

If Respite is built first, `enemyCooldown` already exists and Swift adds its percent with `combinedPercent`; hp levers
multiply after Hulking. If this plan lands first, Respite's RS0 list gains these helpers and the new archetypes. Either
way new archetypes use only the shared choke points (`ctx.telegraph`, `enemyCooldown`, `walkStep`, `ctx.fireEnemy`).

## Tasks

- **EV0. Audit and contact sheets.** Read-only: confirm the tutorial never calls the spender at floor >= 2 (its floors use their own room content); list every
  `d.speed` and cooldown read (sim and view); list the arc shapes needed (imp fan, anything the summoner fires that the
  table lacks); confirm `CORPSE_TICKS` and corpse handling in the view. Build contact sheets for Imp 1-10, the robed
  Spawns and the LoP slime (`art/build/contact/`). **Verify:** the findings and the owner's rig picks are written into
  this doc.
- **EV1. Scaffolding.** `PORT_BAND_ENEMIES`; `walkStep` / `enemyCooldown` refactor; `ActorFxHints.ring`;
  `adoptScoreRoomMember`; theme contract entries with placeholder values (vale falls back to placeholders until art);
  data rows. **Verify:** `npm run verify`; every golden fixture, M1 and the tutorial lock specs match bit for bit;
  `archetypeIds()` keeps indices 0-8; `contract.luau` compiles under Lune.
- **EV2. Imp.** Archetype, blink safety, the fan's `arcTablePort` row. **Verify:** specs: the ring is shown >= 0.5 s
  before every blink; a blink never lands in a wall, a breakable, another room or inside `SPAWN_SAFE_RADIUS`; no valid
  spot -> no blink, same draw count; determinism spec (two runs, same hashes).
- **EV3. Ooze.** `slime`, `slime.small`, `BulletKind.GOO`, the goo trail, the split and its adoption. **Verify:**
  specs: at most 6 goo alive per slime; goo carries `BulletKind.GOO`; the split spawns 2 (1 or 0 when the pool is full, `actorsDropped` counts the rest); smalls never
  split; the room does not CLEAR until both smalls die; a guard erases goo.
- **EV4. Summoner.** Summon, caps, wither, panic ring, adoption. **Verify:** specs: never more than 3 summons alive or
  6 per life; summons wither on its death; the room clears only when summons are dead; a full pool drops summons
  cleanly.
- **EV5. Room pool.** `fromFloor` / `maxPerRoom` in the spender; the new kinds appended. **Verify:** a lock spec built
  BEFORE the change (spender output for floor 1, seeds 1-200, solo and party 2-4) still matches after it; no kind
  before its floor; at most one summoner per room; a census table (floors 1-20 x run seeds 1-60: mean enemies per room
  by kind, budget spent) recorded here.
- **EV6. Affix assignment (dungeon).** `assignAffixes`, `roomAffixes`, `AFFIXES` data. **Verify:** layouts, digests,
  room spawns, breakables and boss picks identical with and without; affixes never on excluded kinds or below their
  unlock floor; the elite / combat shares hold over the census.
- **EV7. Affixes (sim).** `SimConfig.affixes`, `state.affixes`, the hash group, the four rules, score / drop / par
  bonuses, the corpse hold. **Verify:** one spec per affix (Hulking hp and radius; Swift walk and cooldown but equal
  telegraph ticks; Shielded absorb and refill; Vengeful telegraph >= 0.6 s, then exactly one ring); without
  `affixes` the hash layout is unchanged; recording round trip and server validation of an affixed endless run.
- **EV8. Theme and validators.** Final colour roles, `affixReport`, `gooReport`, `bullet.enemy.goo`, strings, audio
  IDs, vale values. **Verify:** the
  theme validator passes for placeholder and vale; the report prints every pair it checks.
- **EV9. View.** Sprite inputs, `ring` markings, blink snap and puff, the goo decal pool (Studio: goo reads as
  harmful on every biome floor, and moving bullets stay on top of it), affix rings / chips / shield segment / elite
  plate / corpse pulse, first-sighting toast plumbing. **Verify:** pure view specs (sprite input per state, ring fill
  timing equals the sim's telegraph, affix chip text); no Highlight added.
- **EV10. Art.** Slime set (LoP pipeline, 16 facings), imp and summoner sets (per-sheet Demons pipeline + rims),
  measured budgets in this doc, `npm run art:build`, upload, ids in `assetIds.ts`. **Verify:** `npm run test:art`;
  the contact sheets signed off by the owner; texture counts within the budget table.
- **EV11. Audio.** The five port IDs from the Ninja Adventure pack (`art/audio.json`), `audio:build`, upload.
  **Verify:** `audio:audition` by the owner; silent fallback while ids are missing.
  *As built (cue mapping, branch `ev-cues`):* per-tick collector `shared/view/fx` `VariantCueEvents` (`RunView.variantCues`,
  LiveRun / LockstepClient) feeds `AudioCueMapper.frame`'s trailing `variants`: `sfx.enemy.blink` on the imp's LANDING tick
  (the wind-up start already plays `sfx.enemy.telegraph`), `sfx.enemy.summon` when summoned swarmers appear (cast
  resolved), `sfx.enemy.split` when slimelets appear, `sfx.affix.shieldbreak` on `shieldBroke`, `sfx.affix.vengeful` on
  `vengefulFired` (arming is the kill: no cue). World sounds (full volume for every client), ranks 49 / 47 / 46 / 42 / 41
  (shield break, vengeful, blink, summon, split: under every player sound, over enemy hurt / death / shot), minimum
  intervals 0.1-0.2 s, no fallback, no jingle / duck; silent under the stage cover and after run over
  (`audibleVariantCues(.., comboQuiet(..))`).
- **EV12. First sighting.** Per-account seen flags in `KV_Onboarding_v1` (codec bump in `shared/onboarding`), one toast
  per archetype / affix. **Verify:** codec specs (old docs read as "nothing seen"); a co-op party member who has seen
  it gets no toast.
  *As built (branch `ev-cues`):* NO codec bump (plan change 9): an optional `seen` list of sighting ids (`imp`, `slime`,
  `summoner`, `affix.<id>`; `shared/onboarding` sightings.ts, canonical order, unknown ids dropped, written only when
  non-empty) under doc v 1; an old doc decodes exactly as before. `onboardingStatus.seen` (optional) tells the client;
  remote `bestiarySeen(id)` (validated against `SIGHTING_IDS`, idempotent, `BESTIARY_SEEN_RATE` 10 / 10 s, never written
  after a failed join load; a finish keeps `seen`). Client `SightingController` + pure `shared/view/sighting`
  (`sightingsInView`: living actors within `SIGHTING_VIEW.radius` 9 of the view player; `SightingQueue`: one toast at a
  time, 5 s + 0.75 s gap, nothing before a loaded status), toast line `bestiary.<id>` through the existing toasts; not in
  the tutorial, under the stage cover or after run over; waits while a draft is open or paused. Studio check pending.
  *Card, not a toast (owner, 2026-11-06: "the text blocks the player's view"):* the top-centre toast panel hangs over
  the far side of the room, exactly where a new enemy walks in, for 5 s. The line now shows on its own card
  (`SightingCard`, store `game.sighting`, set and expired by `SightingController`, hidden at run over / exit): the left
  edge under the status panel (`HUD_TRANSIENT.sighting`, `SIGHTING_CARD` 240 wide, smallText, 3 lines estimated), held
  out of `HUD_CLEAR_ZONE` at HUD scale <= 100 % by footprint.spec.ts; on touch the safe area's top left
  (`TOUCH_SIGHTING_BOX`, under the touch strip when it hangs below the top bar; clear-zone overlap printed, not held).
  The card and the top-centre toasts both fade under the action (docs/HUD_LAYOUT.md H7, fade slots `sighting` /
  `toasts`). No new strings; presentation only. Studio check pending.
- **EV13. Tuning.** TTK table per new archetype and affix vs the sword and the bow (like `bossAct1.ttk.spec.ts`), the
  EV5 census re-run with affixes, actor-pool high-water mark per floor (target < 48 of 64). **Verify:** the tables in
  this doc; no floor in the census drops a spawn.
- **EV14. Studio check and docs.** The checks in docs/CLIENT.md (readability next to bullets, mobile frame time on the
  densest census room), CLAUDE.md decision log entry, `THIRD_PARTY_NOTICES.md` (LoP slime and the new Demons rigs are
  already covered; list them). No PROVENANCE row (no web source). **Verify:** owner sign-off.

### EV5 census (as built, 2026-10-30)

Built: `EndlessRoomKind.fromFloor` / `maxPerRoom`; `spendEncounterBudget(rng, budget, floor, cap?)` and
`populateEndlessRoom(room, tools, budget, floor)` (floor threaded from `endlessRoomSpawns`) skip a kind below its floor
or at its room maximum in both the dearest scan and the weighted pick (`roomKindOpen`, no draw). Appended after bruiser:
`imp` (floor 2, weight 2), `slime` (4, 1), `summoner` (6, 1, `SUMMONERS_PER_ROOM` 1); unlock floors are
`ROOM_KIND_UNLOCK_FLOOR` in `endlessData.ts`. Wide bodies: `WIDE_BODY_KINDS` (`slime`, r 0.55; checked against the
sim radii in `roomPool.spec.ts`) only take a tile whose 8 neighbours are FLOOR (`isOpenTile`). `roomSpawnTiles` already
gives only such tiles except in a tiny room's fallback (fewer than 8 open tiles), and breakables keep 1.5 tiles from
every planned spawn, so the filter changes no candidate list and no draw on normal rooms; with no open tile left a wide
body ends the room's placement ("runs out of tiles"). Not covered: Hulking radii (applied after placement; a Hulking
bruiser, 0.6, could only touch a wall in a fallback room) and the sim's safe-spawn move in a fallback room.

Lock (`dungeon/roomPool.lock.spec.ts`, recorded before the change): floor 1, run seeds 1-200, party 1-4 is digest for
digest identical; floors 2-6 (seeds 1-40, solo) all differ from their pre-EV5 digests. Census specs:
`roomPool.census.spec.ts` (floors 1-10), `roomPool.census.deep.spec.ts` (11-20), `roomPool.census.party.spec.ts`
(party 4). Means per populated room (combat / elite rooms other than the entrance and the boss room); "spent" is the
placed enemies' encounter cost against the room budget; "affixed" is the share of affix-eligible planned spawns that
`assignAffixes` stamps (elite rooms only below floor 11, which is why it doubles there).

Solo, run seeds 1-60:

| floor | rooms | enemies / room | swarmer | sniper | bruiser | imp | slime | summoner | spent / budget | max summoners | affixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 452 | 4.27 | 2.51 | 1.27 | 0.48 | 0.00 | 0.00 | 0.00 | 6.50 / 6.50 (100 %) | 0 | 0.0 % |
| 2 | 465 | 4.69 | 2.23 | 0.96 | 0.45 | 1.05 | 0.00 | 0.00 | 7.59 / 7.91 (96 %) | 0 | 0.0 % |
| 3 | 444 | 5.19 | 2.27 | 1.17 | 0.55 | 1.19 | 0.00 | 0.00 | 8.67 / 9.10 (95 %) | 0 | 0.0 % |
| 4 | 456 | 5.57 | 2.34 | 1.18 | 0.48 | 1.13 | 0.45 | 0.00 | 9.73 / 10.31 (94 %) | 0 | 8.5 % |
| 5 | 457 | 6.15 | 2.43 | 1.36 | 0.57 | 1.25 | 0.54 | 0.00 | 10.98 / 11.69 (94 %) | 0 | 9.6 % |
| 6 | 507 | 6.89 | 2.55 | 1.38 | 0.62 | 1.33 | 0.54 | 0.46 | 12.85 / 12.85 (100 %) | 1 | 7.8 % |
| 7 | 513 | 7.40 | 2.66 | 1.40 | 0.64 | 1.53 | 0.66 | 0.50 | 13.95 / 14.24 (98 %) | 1 | 8.2 % |
| 8 | 499 | 8.00 | 2.78 | 1.58 | 0.76 | 1.64 | 0.71 | 0.54 | 15.23 / 15.67 (97 %) | 1 | 8.9 % |
| 9 | 510 | 8.37 | 2.81 | 1.64 | 0.83 | 1.69 | 0.87 | 0.53 | 16.16 / 16.73 (97 %) | 1 | 7.2 % |
| 10 | 509 | 8.87 | 2.60 | 1.94 | 0.84 | 1.99 | 0.90 | 0.60 | 17.49 / 18.19 (96 %) | 1 | 8.7 % |
| 11 | 570 | 9.64 | 2.66 | 2.15 | 0.99 | 2.13 | 1.08 | 0.64 | 19.33 / 19.33 (100 %) | 1 | 14.9 % |
| 12 | 566 | 9.90 | 2.38 | 2.33 | 1.08 | 2.32 | 1.12 | 0.67 | 20.29 / 20.57 (99 %) | 1 | 14.9 % |
| 13 | 569 | 10.31 | 2.11 | 2.53 | 1.17 | 2.60 | 1.20 | 0.69 | 21.58 / 22.01 (98 %) | 1 | 15.6 % |
| 14 | 561 | 10.63 | 2.04 | 2.66 | 1.31 | 2.66 | 1.26 | 0.70 | 22.49 / 23.06 (98 %) | 1 | 15.0 % |
| 15 | 561 | 11.10 | 1.99 | 2.59 | 1.49 | 2.77 | 1.49 | 0.77 | 23.97 / 24.67 (97 %) | 1 | 15.6 % |
| 16 | 624 | 11.90 | 2.10 | 2.84 | 1.65 | 2.93 | 1.59 | 0.79 | 25.73 / 25.73 (100 %) | 1 | 15.3 % |
| 17 | 616 | 12.03 | 1.68 | 3.09 | 1.76 | 2.95 | 1.74 | 0.81 | 26.69 / 26.98 (99 %) | 1 | 14.8 % |
| 18 | 627 | 12.27 | 1.53 | 2.97 | 1.87 | 3.11 | 1.96 | 0.82 | 27.66 / 28.08 (98 %) | 1 | 14.3 % |
| 19 | 614 | 12.71 | 1.39 | 3.19 | 2.10 | 3.06 | 2.15 | 0.81 | 29.10 / 29.67 (98 %) | 1 | 15.4 % |
| 20 | 626 | 12.93 | 1.28 | 3.19 | 2.26 | 3.11 | 2.24 | 0.85 | 29.92 / 30.64 (98 %) | 1 | 14.5 % |

Party of 4, run seeds 1-15:

| floor | rooms | enemies / room | swarmer | sniper | bruiser | imp | slime | summoner | spent / budget | max summoners | affixed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 113 | 8.15 | 4.16 | 2.96 | 1.03 | 0.00 | 0.00 | 0.00 | 13.17 / 13.50 (98 %) | 0 | 0.0 % |
| 2 | 115 | 9.31 | 3.90 | 2.24 | 1.09 | 2.08 | 0.00 | 0.00 | 15.81 / 16.43 (96 %) | 0 | 0.0 % |
| 3 | 115 | 10.03 | 2.99 | 2.96 | 1.24 | 2.84 | 0.00 | 0.00 | 18.32 / 18.64 (98 %) | 0 | 0.0 % |
| 4 | 112 | 10.21 | 2.56 | 2.58 | 1.35 | 2.48 | 1.23 | 0.00 | 20.43 / 21.09 (97 %) | 0 | 6.9 % |
| 5 | 112 | 11.14 | 1.79 | 3.04 | 1.64 | 3.12 | 1.54 | 0.00 | 23.67 / 23.82 (99 %) | 0 | 7.2 % |
| 6 | 125 | 11.66 | 1.90 | 3.02 | 1.39 | 2.84 | 1.65 | 0.87 | 25.34 / 25.98 (98 %) | 1 | 5.3 % |
| 7 | 130 | 12.66 | 1.47 | 3.26 | 2.06 | 2.98 | 2.08 | 0.81 | 28.80 / 28.93 (100 %) | 1 | 6.4 % |
| 8 | 133 | 13.41 | 1.19 | 3.08 | 2.66 | 3.20 | 2.47 | 0.83 | 31.59 / 32.07 (99 %) | 1 | 7.7 % |
| 9 | 128 | 13.95 | 0.96 | 3.70 | 2.30 | 3.47 | 2.63 | 0.88 | 32.75 / 33.73 (97 %) | 1 | 4.7 % |
| 10 | 134 | 14.46 | 0.69 | 2.94 | 4.86 | 2.86 | 2.33 | 0.78 | 36.19 / 37.14 (97 %) | 1 | 6.5 % |
| 11 | 142 | 14.63 | 0.58 | 2.53 | 5.03 | 2.51 | 3.15 | 0.84 | 37.69 / 39.50 (95 %) | 1 | 14.0 % |
| 12 | 141 | 14.87 | 0.40 | 1.94 | 5.89 | 1.76 | 4.00 | 0.87 | 40.09 / 41.73 (96 %) | 1 | 12.7 % |
| 13 | 136 | 15.19 | 0.30 | 1.41 | 7.12 | 1.27 | 4.27 | 0.82 | 42.29 / 45.66 (93 %) | 1 | 15.5 % |
| 14 | 136 | 15.52 | 0.40 | 0.61 | 7.39 | 0.68 | 5.56 | 0.88 | 44.47 / 46.88 (95 %) | 1 | 13.4 % |
| 15 | 139 | 16.00 | 0.83 | 0.00 | 8.60 | 0.00 | 5.73 | 0.83 | 46.33 / 50.61 (92 %) | 1 | 13.6 % |
| 16 | 154 | 16.00 | 0.00 | 0.00 | 16.00 | 0.00 | 0.00 | 0.00 | 48.00 / 53.19 (90 %) | 0 | 15.3 % |
| 17 | 153 | 16.00 | 0.00 | 0.00 | 16.00 | 0.00 | 0.00 | 0.00 | 48.00 / 55.37 (87 %) | 0 | 13.8 % |
| 18 | 153 | 16.00 | 0.00 | 0.00 | 16.00 | 0.00 | 0.00 | 0.00 | 48.00 / 57.30 (84 %) | 0 | 13.2 % |
| 19 | 154 | 16.00 | 0.00 | 0.00 | 16.00 | 0.00 | 0.00 | 0.00 | 48.00 / 60.62 (79 %) | 0 | 13.8 % |
| 20 | 154 | 16.00 | 0.00 | 0.00 | 16.00 | 0.00 | 0.00 | 0.00 | 48.00 / 62.87 (76 %) | 0 | 13.6 % |

Readings: no kind before its floor and never two summoners in a room (both checked over every census room); a room
holds about one imp per 4-5 enemies from floor 2. Budget use stays as before: below 100 % only by a fractional
budget's remainder (elite x1.5, the per-floor 1.2) and the odd room that runs out of tiles. **Open (owner call, not
changed in EV5):** once a room's budget passes `ENDLESS_ROOM_ACTOR_CAP` x 3 (48: for a party of 4 elite rooms from
floor 10 and every room from floor 16; solo elite rooms from floor 23), every slot's "need" exceeds the dearest cost,
so the spender's no-draw fallback buys the FIRST cost-3 kind every time: 16 bruisers, no oozes or summoners (this
saturation predates EV5; before it the room was also 16 bruisers). A fix that leaves floor 1 alone: when two or more
open kinds tie for dearest, pick among them by weight with one draw (floor 1 never reaches the fallback, so the lock
spec would still hold; summoners stay capped at 1).

### EV13 tuning (as built, 2026-10-31)

Branch `ev-tune`. Measurements only: spec files and test support, **no gameplay number or code changed**; the
recommendations at the end are owner calls. New files: `sim/variants.ttk.sword.spec.ts` / `variants.ttk.bow.spec.ts`
(harness `run/testing/variantTtk.ts`), `run/poolHighWater.shallow.spec.ts` / `.deep.spec.ts` (analytic,
`run/testing/poolHighWater.ts`), `run/poolHighWater.sim.spec.ts` (simulated), `dungeon/spenderFallback.spec.ts`
(`dungeon/testing/spenderFallback.ts`). Each prints its table and asserts only loose bounds (everything dies, floor 1
fast, the pool under 48, the spender mirror exact). Headless runtimes: 3 / 5 / 19 / 24 / 11 / 7 s. The EV5 census specs
re-ran on the merged base (affixes, view, art all in): all three tables above are unchanged row for row.

**1. Time to kill.** One enemy in an open 24 x 24 arena, the player at the origin and the enemy 4.5 units away (inside
every aggro range), god mode (hits counted, never lethal), run seeds 1-6, mean seconds from tick 0 (approach and chases
after a blink count). Hp: spawn hp (Hulking x175 % and the shield stamped from base hp) x `endlessActorHp(1, false,
floor, depth)` with Depth +1 per boss on the way (floor 1 / 6 / 11 / 20 = Depth 1 / 2 / 3 / 4: x1 / 2.1 / 4.05 / 8.5),
applied to slimelets and summons as they appear. Sword: the port's timings (swing, swing, finisher: 12 damage per 64
ticks, 11.25 dps flat out), walks to 1.4 units and holds FIRE in reach. Bow: the stream only (1 per arrow, 5 dps), keeps
5 units, aims at the centre with no lead. Slime = until the Ooze and both slimelets are dead; summoner = until it dies
(its summons wither). "Par" = what the member adds to its room's par, 1.5 s x (cost + 2 if affixed); the room base 6 s
comes on top.

| enemy | hp f1 / f20 | par s | sword f1 / f6 / f11 / f20 | bow f1 / f6 / f11 / f20 | hits taken f20 sword / bow |
|---|---|---|---|---|---|
| swarmer | 2 / 17 | 1.5 | 0.2 / 0.5 / 0.9 / 1.6 | 0.4 / 1.0 / 1.8 / 3.5 | 1.3 / 0.0 |
| sniper | 4 / 34 | 3.0 | 0.8 / 1.2 / 1.9 / 3.4 | 1.3 / 4.6 / 9.3 / 19.8 | 0.7 / 7.3 |
| bruiser | 10 / 85 | 4.5 | 1.0 / 2.0 / 3.7 / 7.8 | 2.0 / 4.2 / 8.1 / 17.1 | 10.0 / 1.0 |
| **imp** | 3 / 25.5 | 3.0 | 0.6 / 1.2 / 1.7 / 3.1 | 2.1 / 8.1 / 15.3 / **29.3** | 1.0 / 7.7 |
| **slime (+2 small)** | 8 (+3 +3) / 68 (+26 +26) | 4.5 | 0.9 / 3.1 / 5.9 / **11.2** | 3.0 / 6.2 / 11.8 / 24.0 | **14.0** / 9.0 |
| **summoner** | 6 / 51 | 4.5 | 0.7 / 1.6 / 2.6 / 5.0 | 1.3 / 3.9 / 7.6 / 15.9 | 1.0 / 16.5 |
| swarmer Hulking | 3.5 / 29.8 | 4.5 | 0.5 / 0.9 / 1.3 / 2.6 | 0.8 / 1.6 / 3.0 / 5.8 | 3.0 / 2.0 |
| swarmer Swift | 2 / 17 | 4.5 | 0.2 / 0.5 / 0.9 / 1.5 | 0.4 / 1.0 / 1.8 / 3.4 | 1.8 / 1.0 |
| swarmer Shielded | 2 + 0.8 / 17 + 6.8 | 4.5 | 0.2 / 0.5 / 0.9 / 2.0 | 0.6 / 1.2 / 2.4 / 4.6 | 2.0 / 1.0 |
| sniper Hulking | 7 / 59.5 | 6.0 | 1.2 / 1.6 / 2.9 / 5.4 | 2.3 / 5.4 / 10.4 / 21.9 | 2.0 / 8.2 |
| sniper Swift | 4 / 34 | 6.0 | 0.9 / 1.3 / 1.9 / 3.4 | 2.7 / 5.1 / 10.0 / 20.5 | 1.7 / 9.3 |
| sniper Shielded | 4 + 1.6 / 34 + 13.6 | 6.0 | 0.8 / 1.2 / 2.3 / 4.4 | 3.4 / 6.6 / 12.2 / 27.3 | 1.7 / 10.3 |
| bruiser Hulking | 17.5 / 148.8 | 7.5 | 1.6 / 3.5 / 6.3 / 13.3 | 3.6 / 7.4 / 14.1 / 29.7 | 17.0 / 1.0 |
| bruiser Swift | 10 / 85 | 7.5 | 0.9 / 2.0 / 3.7 / 7.8 | 2.0 / 4.2 / 8.1 / 17.1 | 10.0 / 1.0 |
| bruiser Shielded | 10 + 4 / 85 + 34 | 7.5 | 1.4 / 2.7 / 5.2 / 10.5 | 2.8 / 6.0 / 11.3 / 23.9 | 13.0 / 1.0 |

Shielded **without** the refill (`shieldRefillTicks` = infinity) prints exactly the Shielded rows for every enemy, floor
and weapon, and Vengeful prints exactly the plain rows (its ring comes after the kill). Readings:

- **Ooze is the slowest kill per cost**: from floor 6, 1.45-1.6x the bruiser's sword TTK at the same cost 3 (f6 3.1 vs
  2.0, f11 5.9 vs 3.7, f20 11.2 vs 7.8), 1.4-1.5x with the bow, and the most hits taken by a sword player (14 per kill at f20: contact
  plus goo). Its 14 hp of bodies (8 + 3 + 3) against the bruiser's 10 is most of it.
- **Imp vs the bow**: 17 % of the bow's flat-out dps at f20 (sniper 34 %, bruiser 99 %): blink plus strafe make a
  centre-aimed stream miss. The bot never shoots the landing spot during the 0.35 s aim telegraph, which is the intended
  counterplay, so a human does better; with the sword the imp dies like a sniper. Summoner vs the bow: its summons
  screen the arrows (16.5 hits taken); with the sword it dies in 5 s at f20 ("dive it" works).
- **Affixes**: Hulking +60-75 % TTK (its hp; only +11 % for the bow on a sniper, where misses dominate), Shielded
  +25-40 % (its shield), Swift and Vengeful 0 % (pressure only:
  Swift raises the hits a swarmer / sniper lands, 1.3 -> 1.8 and 0.7 -> 1.7 with the sword). **The Shielded refill never
  fires in a continuous fight**: it only matters to a player who stops dealing damage to that enemy for 5 s.
- **Par vs TTK**: a member's par share (1.5 s per cost) covers its solo sword TTK up to about floor 11 for every kind but
  the Ooze (f11 ratio TTK / par: swarmer 0.6, sniper 0.63, imp 0.57, summoner 0.58, bruiser 0.82, **slime 1.31**); by f20
  (hp x8.5) every kind is past its par share (bruiser 1.73, slime 2.49). Par does not scale with hp or Depth anywhere
  (pre-existing, not an EV issue); `AFFIX_PAR_COST` 2 (+3 s) covers Hulking's extra sword TTK up to f11 on a bruiser
  (+2.6 s) and at every floor on a swarmer / sniper (<= +2 s).

**2. Actor-pool high-water.** Analytic, from the real planned spawns of run seeds 1-20 x floors 1-20 (one Forge floor
serves both party sizes). Per room: *alive* = bought + every Ooze already split (+1 each) + every summoner at its 3 live
summons; *slots* = alive + every Ooze's corpse (held 30 ticks while its children live) + one cast's summon corpses (2):
the room's worst instant. *Floor alive* = the sum over a floor's rooms (the pool is per floor).

| floor | solo max alive / slots | party 4 max alive / slots | max floor alive solo / party 4 |
|---|---|---|---|
| 1 | 8 / 8 | 13 / 13 | 36 / 72 |
| 2 | 8 / 8 | 14 / 14 | 43 / 84 |
| 3 | 9 / 9 | 14 / 14 | 49 / 96 |
| 4 | 10 / 12 | 17 / 20 | 58 / 108 |
| 5 | 11 / 13 | 18 / 22 | 63 / 119 |
| 6 | 15 / 19 | 25 / 34 | 92 / 167 |
| 7 | 15 / 18 | 26 / 36 | 101 / 178 |
| 8 | 17 / 21 | 27 / 38 | 111 / 193 |
| 9 | 16 / 20 | 30 / **43** | 111 / 196 |
| 10 | 18 / 24 | 24 / 32 | 117 / 203 |
| 11 | 19 / 26 | 25 / 36 | 147 / 233 |
| 12 | 19 / 25 | 26 / 37 | 150 / 247 |
| 13 | 20 / 26 | 28 / 40 | 134 / 231 |
| 14 | 21 / 27 | 30 / **43** | 140 / 254 |
| 15 | 22 / 29 | 30 / **43** | 171 / 264 |
| 16 | 23 / 31 | 16 / 16 | 179 / 192 |
| 17 | 24 / 33 | 16 / 16 | 186 / 192 |
| 18 | 25 / 34 | 16 / 16 | 196 / 192 |
| 19 | 28 / 40 | 16 / 16 | 193 / 192 |
| 20 | 28 / 40 | 16 / 16 | 223 / 192 |

Worst rooms (43 slots, all party 4, all "11 Oozes + the summoner"): run 9 floor 9 room 0 (elite: 11 slime, 1 summoner,
3 bruiser, 1 sniper), run 17 floor 14 room 10 (combat: 11 slime, 1 summoner, bruiser, imp, sniper, swarmer), run 4
floor 15 room 1 (combat: 11 slime, 3 bruiser, 1 summoner, 1 swarmer); solo worst 40 (run 12 floor 19 room 0, run 19
floor 20 room 11: 10 Oozes + the summoner). Party 4 from floor 16 is the spender's saturated fallback (16 bruisers, see
4), hence the drop to 16.

Simulated (`poolHighWater.sim.spec.ts`: party 4 debug-skipped to the floor, Depth set to the boss count, all four in
the floor's densest room, 40 s, god mode; "passive" never attacks, "sword" walks in and swings):

| room | estimate | passive: max present / alive, dropped | sword: max present / alive, dropped, kills |
|---|---|---|---|
| run 1 floor 20 room 2 (16 bruiser, Depth 4) | 16 | 17 / 17, 0 | 17 / 17, 0, 16 (cleared) |
| run 17 floor 14 room 10 (11 slime + summoner + 4, Depth 3) | 43 | 19 / 19, 0 (3 summons) | 21 / 18, 0, 44 (cleared; peak 10 slimelets + 5 corpses) |

(The 17th actor is the floor's dormant boss in its arena.) **Target met**: no room reaches 48 in the analytic worst case
(max 43) and the measured peak is half of it; no spawn dropped. Two caveats: the analytic bound is not a construction
bound (a room below budget 48 could in principle buy 15 Oozes + the summoner: 16 + 15 + 3 = 34 alive, 51 slots), and
the pool is per floor: a party that runs through rooms without clearing them can hold far more than 64 (floor sums up
to 264; 72 already on floor 1 for a party of 4, so this predates the variants), and then splits and summons are the
spawns that get dropped.

**3. Room time vs par: skipped.** No endless bot clears rooms: `run/testing` `endlessBot` walks and debug-skips,
`partyBot` swings only while walking floor 1 to the stairwell, and `replay.bench.spec.ts`'s fighter never attacks. The
par-share comparison in 1 is the rough substitute; EV14's Studio pass (or a room-clearing bot, a later task) measures
real clear times.

**4. The spender's dearest fallback** (`spenderFallback.spec.ts`: floors 1-30, party 1-4, combat and elite, 200 room
streams each, mirror checked draw for draw against `spendEncounterBudget`). 141 of the 240 (floor, party, room type)
rows fire it at least once; 95 of those break a tie by the kinds' order. Two regimes:

- **Tail** (near the cap, the budget left falls between two costs): 0.01-1 pick per room, almost always one swarmer
  (no tie: harmless). The one tied case is a budget of exactly 48.0 (party 4 elite, floor 9): every room's last pick is a
  sniper, never an imp, by order.
- **Saturated** (budget >= 16 x 3 = 48): all 16 picks, a three-way tie bruiser / slime / summoner that the order always
  gives to the bruiser: **16 bruisers, no Ooze, no summoner, no affix-eligible variety**. It starts at elite rooms
  floor 10 (party 4), 12 (party 3), 16 (party 2), 23 (solo); combat rooms floor 16 (party 4), 20 (party 3), 26 (party
  2), 36 (solo). Above it the extra budget is simply not spent: 93 % spent at its start, 54 % (party 4 elite, floor 20),
  38 % (floor 30).
- **The EV5 proposal** (when the fallback has a tie, one draw picks among the tied kinds by weight) changes **no floor-1
  room** (0 of 1600 samples: the lock spec would hold) and only the tied rows above: a saturated room becomes about 7.5
  bruisers + 7.5 Oozes + 1 summoner. But it pushes the pool: worst slots 16 -> 45-47 per 200 samples, and a construction
  worst case of 15 Oozes (51 slots).

**Recommendations (owner calls; nothing changed here).**

1. **Spender tie-break: yes, with an Ooze room cap.** Add the weighted tie-break (one draw only on a fallback tie) AND
   `maxPerRoom` 8 on `slime` (a `SLIMES_PER_ROOM` like `SUMMONERS_PER_ROOM`). Saturated rooms become ~1 summoner + 7.5
   Oozes (capped at 8) + bruisers, and a room's pool slots are bounded by construction at 16 + 8 + 3 + 8 + 2 = 37 (< 48)
   whatever the budget. The cap also trims today's 11-Ooze rooms (party 4, floors 9-15). Cost: the endless rooms that hit
   a fallback tie or would buy more than 8 Oozes change (deep and party rooms; floor 1 never, so the EV5 lock still
   holds); the census tables are re-recorded. The unspent
   budget above 48 is a separate, later decision (spend it on affixes or raise the cap with the party size; each +1 cap
   adds at most 3 pool slots).
2. **Ooze hp 8 -> 6 and slimelet hp 3 -> 2** (`slime.ts`): 10 hp of bodies, the bruiser's, at the same cost 3; expected
   TTK about 0.7x today (f20 sword ~8 s, the bruiser's 7.8). Alternative: keep the hp and accept the Ooze as the hard
   cost-3 kind (par share 4.5 s vs 5.9 s TTK at f11). Raising its cost to 4 is NOT advised: it would make the Ooze the
   dearest kind, so the saturated fallback would buy 16 of them.
3. **Imp and summoner: no change.** Sword TTKs sit with the sniper's; their bow weakness is the design (shoot the landing,
   dive the summoner). EV14's Studio check should confirm with a human bow player (target: an imp within ~2x a sniper's
   bow time).
4. **Shielded: no change**, but know that the 5 s refill only punishes disengaging; if it should matter more, 3 s
   (`shieldRefillTicks` 180) is the lever. Hulking, Swift, Vengeful and `AFFIX_PAR_COST` 2: no change.

## Edge cases

- **Co-op.** Each actor already targets the nearest living player; blink safety checks every living player; the party
  budget can buy more imps and oozes but never a second summoner in a room.
- **Pool pressure.** A floor-20 party room (16 bought) plus splits and summons can approach 64: spawns past the pool
  are dropped and counted, never an error; EV13 measures the high-water mark.
- **Last kill is Vengeful.** The room CLEARs on the kill (room clear celebration, PERFECT judged then); the ring still
  fires 0.6 s later. A hit from it does not revoke PERFECT (score already awarded) - accepted, noted in docs/ROOM_CLEAR.md.
- **Floor change with goo or a pending Vengeful ring.** Bullets and corpses clear with the floor, as today.
- **Leash.** Summons and smalls take their spawn point as home; a summoner leashing home keeps its summons engaged.
- **Withering vs. scoring.** Withered summons score and roll drops like a boss's withered adds (bounded: 6 per
  summoner life).
- **Stage cover / tutorial / M1.** No new kind or affix can appear; the tutorial lock spec is the check.

## Decisions (2026-10-30, Kaleb)

Scope:

- **Both:** new archetypes and elite affixes.
- **Unlock by depth:** floor 1 stays today's roster; new kinds and affixes join at set floors.
- **Three new archetypes** in v1: flanker, zone-denier, support.
- **Art:** the Lords of Pain slime plus the 2D Demons pack.

Details (the task in brackets builds it):

- **EVD1. Roster and ids** [EV1]: `imp` (flanker), `slime` (+ `slime.small`) as the zone-denier Ooze, `summoner` (fills
  the existing `enemy.summoner` slot, a Demon Spawn rig), band 3.
- **EVD2. Unlock floors 2 / 4 / 6, weights 2 / 1 / 1 appended** [EV5]. Faster than the recommended 3 / 6 / 8: only
  floor 1 spends as today. The existing 3 / 2 / 1 never change.
- **EVD3. Summoner limits** [EV4]: 1 per room, 2 per cast, 3 alive, 6 per life, summons wither on its death.
- **EVD4. One split generation, 2 slimelets** [EV3].
- **EVD5. Goo is drawn as a flat floor decal** [EV3, EV9]. Still an ordinary enemy bullet in the sim (speed 0, 3 s
  life), tagged `BulletKind.GOO`; the renderer draws it from a second pool, flat on the floor under markings and every
  moving bullet, with its own visual `bullet.enemy.goo` and colour role `enemyGoo` (`gooReport`).
- **EVD6. Four affixes, one per enemy** [EV6]: Hulking, Swift (floor 4), Shielded (7), Vengeful (9). Two affixes on one
  enemy is a later plan.
- **EVD7. Where** [EV6]: elite rooms from floor 4 (35 %, at least 1), combat rooms from floor 11 (10 % each).
- **EVD8. Rewards** [EV7]: +50 % kill points, +4 points of drop chance, `AFFIX_PAR_COST` = 2 per affixed member.
- **EVD9. Swift never shortens a telegraph** [EV7]. Readability beats difficulty.
- **EVD10. First-sighting toast, once per account** [EV12]. Shown on a left-edge card, not the top-centre toasts
  (owner, 2026-11-06).
- **EVD11. Leaderboards stay on `LB_Solo_v1` / `LB_Coop_v1`** [EV7], as with the earlier endless changes (breakables,
  the Demon Lord, the combo window).
- **EVD12. Affix colour is a floor ring plus the sprite rim's tint and the name chip, never a Highlight** [EV9].
- **EVD13. Goo hit size** [EV1] (after EV0): a real hit radius by bullet kind in `enemyBulletHit` /
  `enemyBulletHitParty` (goo ~0.35, every other kind keeps 0.12), drawn to match.
- **EVD14. Goo exclusions** [EV1] (after EV0): no grazes, no guard-erase points or parry feed (the guard still erases
  it), no enemy-shoot cue, no breakable damage, and ordinary sword swings do NOT erase it (only the guard does, so the
  goo keeps denying floor). The 6-puddle cap is a count (live `BulletKind.GOO` bullets with the slime's emitter id), not
  "by construction", because Hourglass slows bullet life.
- **EVD15. Summons and slimelets spawned in an elite room keep the elite plate** [EV9] (today's view rule).
- **EVD16. Vengeful corpses get a per-actor corpse length in the view** (hold + fade) [EV9]; the sim hold is never
  built with `def.stepDead` (that marks a reviver for scoring, Vampire Fang and drops).

## Risks

- **Clutter.** Goo, fans and gapped rings on top of today's patterns. Mitigation: the goo decal sits flat under every
  moving bullet, `gooReport` keeps it in the danger family and away from decor, the trail cap, EV14's readability
  check. Fallback if the decal reads as decor in Studio: draw `BulletKind.GOO` with the normal bullet look (one line in
  the renderer, no sim change).
- **Summoner frustration.** Hiding plus adds can drag a room. Mitigation: the caps, the wither, the panic ring that
  ends with it backing off into the open; EV13 measures room times against par.
- **Endless replays and scores change** from floor 2 (kinds) and from tick 0 in hash terms (the `affixes` group
  exists on every endless run). Expected; fixtures and M1 do not move.
- **View drift.** A view read of raw archetype timings shows a wrong bar under Swift. EV0's list and EV9's timing spec.
- **`contract.luau` locals limit.** EV1 compiles it under Lune before anything else lands.
- **Mobile frame time** with more bullets and actors. EV14 checks the densest census room on a device.

## Out of scope

- New bosses or boss affixes; affixes in M1 or the tutorial.
- Biome-specific rosters (a later plan could filter `ENDLESS_ROOM_KINDS` by biome band as well as floor).
- Changing the existing three archetypes' behaviour or weights.
- Two affixes on one enemy, affix synergies, a bestiary screen.
