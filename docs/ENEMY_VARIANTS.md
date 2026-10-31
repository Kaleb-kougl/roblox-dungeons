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

## Status (2026-10-30)

Planned. Every decision is taken (below, "Decisions": the scope answers and EVD1-EVD12, 2026-10-30). Nothing
built. Respite (docs/DIFFICULTY.md) is planned, not built: whichever lands second hooks into the
other's choke points (see "Respite").

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

**Imp and summoner sets: not built, waiting on the owner's rig picks.** Decide, from `art/build/contact/ev-imps.png`
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
- **EV12. First sighting.** Per-account seen flags in `KV_Onboarding_v1` (codec bump in `shared/onboarding`), one toast
  per archetype / affix. **Verify:** codec specs (old docs read as "nothing seen"); a co-op party member who has seen
  it gets no toast.
- **EV13. Tuning.** TTK table per new archetype and affix vs the sword and the bow (like `bossAct1.ttk.spec.ts`), the
  EV5 census re-run with affixes, actor-pool high-water mark per floor (target < 48 of 64). **Verify:** the tables in
  this doc; no floor in the census drops a spawn.
- **EV14. Studio check and docs.** The checks in docs/CLIENT.md (readability next to bullets, mobile frame time on the
  densest census room), CLAUDE.md decision log entry, `THIRD_PARTY_NOTICES.md` (LoP slime and the new Demons rigs are
  already covered; list them). No PROVENANCE row (no web source). **Verify:** owner sign-off.

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
- **EVD10. First-sighting toast, once per account** [EV12].
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
