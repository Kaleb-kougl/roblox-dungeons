# Treasure rooms: vaults and locked chests (plan and as built)

Some endless floors get a **vault**: a combat or elite room holds a **chest in a cage**, sparkling in its rarity colour.
You can see it through the doorway before the fight starts. Clearing the room **unlocks** it. If you meet the vault's
**lock condition** during the fight (clear it **untouched**, or clear it **swift**, under par), the chest **keeps its
full rarity**. Miss the condition and the lock **cracks**: the chest drops one rarity, on screen, on the frame it
happens. It never drops to nothing, so a miss reads as "so close", not as a loss. Walk up to the unlocked chest and it
**bursts open** with a rarity-coloured column, a sting and its reward: a relic, boosts, or a **bonus draft** on the next
floor. Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

Status (2026-11-04): **built; every task done but the owner's TR9 (vale art and audio) and TR11 (playtest and tuning),
and the Studio check is pending ("Studio check" below). Open for TR11: SWIFT at `swiftParPercent` 100 is far too easy
(kept 30 / 30 in the TR5 census, the bot clearing vault rooms at ~28 % of par; target 40-60 %), and UNTOUCHED sits at
the bottom of its 30-50 % target (8 / 25).** **TR0 done (plan checked against the code, below). TR1 done (the dungeon
roll, behind the option `EndlessFloorOptions.vaults`, off everywhere until TR5; "As built (TR1)" below). TR2 done (the
sim state, hash group and chest piece behind `SimConfig.treasure`, unset everywhere until TR5; "As built (TR2)"). TR3
done (the lock: arm, crack, unlock; "As built (TR3)"). TR4 done (the open and its rewards; "As built (TR4)"). TR5 done
(every endless world has vaults and `SimConfig.treasure`, the dev override, the census; "As built (TR5)"). TR6 done
(theme; "As built (TR6)"). TR7 done (the world view: chest, cage, sparkle, plate, crack / unlock / open timelines,
cards, freeze and shake; presentation only; "As built (TR7)"). TR8 done (the toasts, the minimap mark, the sounds;
presentation only; "As built (TR8)"). Merged with `main` @ `5ae04db` (run recap, bookshelves; "As built (merge with
main)"). TR10 done (this file as built; CLAUDE.md, src/shared/sim/README.md,
docs/CLIENT.md, docs/DECOR.md, docs/DAILY.md).** The owner (Kaleb) confirmed every decision (TRD1-TRD14) on 2026-11-03.
This file is the project doc `claude/treasure-rooms-plan.md` with every "(assumed; TR0 verifies)" item checked against
branch `treasure-rooms` @ `82f0ff9` (a snapshot of `main` @ `288a33b`, which already has Pellets, solid decor, room
themes and the new enemies merged). Sibling plans: BO (`claude/build-online-plan.md`), RR (`claude/run-recap-plan.md`:
its optional "chests opened" highlight reads this plan's run summary), CX (`claude/codex-plan.md`: vaults could become a
codex category later).

**Sim impact: yes, this is gameplay.** It follows the opt-in pattern of boosts (docs/BOOSTS.md), breakable loot
(docs/BREAKABLE_DROPS.md) and pellets (docs/PELLETS.md):

- a pure **dungeon** roll per floor, on its own stream, decides where the vault is, which lock it has and its rarity;
- an opt-in `SimConfig.treasure`, its own `SimState.treasure` and its own **hash group appended last** (after `pellets`);
- its **own rng stream** for the draws made when a chest opens, so **no existing draw moves** on a floor where no chest
  opens (boon offers, relics, curses, kill drops, archetype rolls);
- one config-gated score source, `ScoreSource.TREASURE` (12).

Without `SimConfig.treasure` nothing changes: M1, every golden fixture and the tutorial replay exactly as before.
Endless replays and scores change (every vault floor gains a breakables slot and the run gains a hash group), so the
leaderboard rule applies (TRD13) and `DAILY.ruleset` goes 5 -> 6 (7 with main's bookcases merged, "As built (merge
with main)").

## TR0 findings (2026-11-03)

Checked by reading the code only (no build or test was run for TR0; the base `npm run verify` was running on the same
tree). Paths are under `src/shared/` unless they start with `src/client/`, `docs/` or `l10n/`.

### Conflicts with owner decisions (flagged, not changed)

- **C1. Co-op boost spill vs `DROPS.maxOnGround` 4 (TRD8).** TRD8 has chest boosts spill onto the floor (party size x
  count) and get picked up first-touch. There are only **4 ground slots** (`sim/drops/dropsData.ts` `DROPS.maxOnGround`),
  shared with kill drops and piece loot. A 4-player Common chest is 8 boosts and a 4-player Rare with no relic left is
  8 too, so at least half would be lost (`lostLoot` fizzle). That contradicts "everyone alive gets their own reward" and
  "missing must never mean nothing". Raising `maxOnGround` changes every endless drop stream (a full ground skips its
  draw), so it is not free either. **Owner call needed before TR4.** Recommended: the draws stay fixed (party x count
  boost-kind draws, always made, so the treasure stream never depends on the ground). Each boost lands in the lowest
  free slot, and any that doesn't fit is **given straight to the player whose share it is** (the pickup's own effect:
  `bp.ticks[kind] = boostTicks(kind)`, Aegis pips; `DropsEvents.collected`), so nothing is lost. Alternative: cap the
  spill at the free slots and pay the rest as `TREASURE` points.
  **Owner answer (Kaleb, 2026-11-03): the recommended rule.** Boosts that fit land in the lowest free slots; the rest
  go straight to the player whose share they are (nothing is lost). TR4 builds this.
- **C2. Rarity colours on the floor vs "no new colour role" (TRD5 and design §5).** TRD5 says chests use "the draft's
  rarity names and colours". The draft's colours are **`boon.common` / `boon.rare` / `boon.legendary`** (`#d7d0c0`
  bone, `#f46669` blood red, `#f1bd44` candle gold; `theme/contract.ts` `BOON_RARITY_ROLES`, `view/hud/progression.ts`
  `RARITY_COLOR_ROLES`). They are **not** the loot roles `rarity.normal` / `.rare` / `.unique` the plan named. So the
  chest follows TRD5's intent and uses `boon.*` plus the strings `boon.rarity.common` / `.rare` / `.legendary`. But on
  the floor (sparkle, plate, rising tier line, column) every danger-adjacent colour must be >= 40 CIE76 from
  `enemyBullet`, `enemyBulletOutline` and `telegraph` (`MIN_DECOR_FX_BULLET_DIFFERENCE`, `ROOM_EDGE_DIFFERENCE_ROLES`).
  By a TR0 estimate (sRGB -> Lab D65, not the validator's own code), `boon.rare` is about **36.8** and `boon.legendary`
  about **34.2** from `telegraph` `#ff8a3d`. Both fail, though they pass the enemy bullet (43.5 / 105) and every floor
  (>= 4.1:1). The plan's own fallback then applies: TR6 adds floor-only roles `treasure.common` / `.rare` / `.legendary`,
  the draft's hues nudged to >= 40 from the telegraph, and keeps `boon.*` for UI-only uses (toasts, reward cards,
  minimap mark). That is a new colour role, which design §5 had ruled out. **Owner to confirm the floor roles at TR6**
  (TR6 prints the validator's real numbers first).
  **Owner answer (Kaleb, 2026-11-03): floor-only `treasure.*` roles** if the validator confirms the draft colours fail on
  the floor (hues nudged to pass, UI keeps `boon.*`). TR6 builds this.
  **TR6 (2026-11-03): confirmed by the validator** (`boon.rare` 36.8, `boon.legendary` 34.2 from `telegraph`; every
  other check passes): the floor roles are built. Numbers and values in "As built (TR6)".

TRD10 (Respite eases the lock) is **not** a conflict but is **dormant**: Respite (docs/DIFFICULTY.md) is planned, not
built (no `SimConfig.respite`, no `state.respite`; only comments in `sim/combat/actors/actorMods.ts`). The tables go in
`TreasureConfig` now and the level is read through one leaf accessor that returns 0 until Respite lands (TR3).

### Corrections that change the design

1. **Placement runs last, after pellets.** `buildEndlessFloor` (`dungeon/endless.ts`) now runs breakables -> affixes
   -> loot -> **pellets** (last, reading the pieces). `placeVault` runs **after `placePellets`**, keeps off every
   pellet cell (`FloorPellets.tiles`, the power pellet included), and only then appends the chest to the pieces. So
   pellets, like every other floor output, are **identical to the option-off floor**. The chest's reachability test
   (the breakables' `ringOk`) keeps every pellet reachable.
2. **The chest is not a `BREAKABLE_KINDS` entry.** `dungeon/breakablesData.ts` `BREAKABLE_KINDS` is mirrored by
   `theme/contract.ts` `BREAKABLE_KINDS` (pinned equal by `theme/decor.spec.ts`). Every entry needs a required
   `breakable.<kind>` asset, colour role and name, vale art (`VALE_BREAKABLE_ART`), a renderer look, a particle palette
   entry and a `BREAKABLE_VIEW.chips` row. Instead the dungeon gets **`BREAKABLE_PIECE_KINDS = ["barrel", "crate",
   "chest"]`** (the sim's kind index table), and `BREAKABLE_KINDS` stays the two clutter kinds. Sim
   `BreakableKind.CHEST = 2`. Renderers that loop `BREAKABLE_KINDS` are unchanged, but `BreakableRenderController` must
   **skip** chest slots: today it falls back to `looks[0]` and would draw a barrel. The chest's art lives in its own
   `treasure.*` slot (TR6).
3. **`damageBreakable` returns before the hit bookkeeping** for a chest (before `events.breakableHits`, `hitSlots`): no
   hit flash, chips, score, loot or break. Every bullet still stops on it (`enemyBulletHitsBreakable` returns true, a
   player bullet's `damageBreakable` returns false, so a piercing one stops). `slamBreakables` (boss slams, Bomber blast,
   Charger) never breaks it. A Charger charging into it is blocked and **stunned**, as at a wall (`charger.ts` step 2b),
   and goo is never laid on its cell (`slime.ts` `breakableSlotAt`). The hp field holds `CHEST_HP` = 1, set by kind in
   `piecesFrom`, not read from `BreakablesConfig.hp`, so `BREAKABLE_HP` stays two entries.
4. **The swift lock equals FAST exactly, and drafts never freeze it in play.** A boon draft only opens on a floor change
   (`stepRun` step 1, `redeal`), when every room record is new, so a draft can never open mid-room in endless.
   `tick - engageTick` and a countdown are therefore the same in play. The plan keeps the hashed countdown, defined so
   that it agrees with `clearRoom`'s FAST: armed on tick E with `ticksLeft = S`; on each later tick `ticksLeft -= 1`
   **before** the clear check, and at 0 it cracks. A clear on tick T keeps the lock iff `T - E < S`, which at 100 %
   (`S = parTicks`) is exactly when FAST pays (`under = parTicks - (T - E) > 0`). The "frozen through a draft" spec in
   TR3 is synthetic (a draft opened by hand).
5. **TRD11's "room bonus multipliers except combo" means depth x curse only.** `awardPoints` always multiplies by
   `s.combo`. ROOMS / PERFECT / FAST include the combo, and kills add the floor scale and Bounty. TREASURE needs a
   **combo-neutral award**: `floor(base x depth x (4 + curses) / 4)`, combo fixed at `COMBO_MIN` (x1.0). TR2 adds
   `scoreTreasure` with that integer formula (one more exported helper beside `awardPoints`; its default path is
   untouched).
6. **The boss double-draft rule has no "Legendary boon when no duo" fallback.** `drawCardOffers(..., guaranteeDuo)`
   (`sim/builds/cards.ts`) puts a duo at card 0 only when the duo pool isn't empty. Otherwise card 0 is an ordinary
   type roll. The bonus deal reuses that rule as is.
7. **The extra deal is per player; `stepRun` deals one count for everyone.** `stepRun` step 1 computes one `deals` per
   floor (`floorDrafts` 1 / `bossFloorDrafts` 2) and calls `openDraft(state, i, floorCleared, deals)` per present player.
   The first deal guarantees a duo iff `deals > 1`. TR4 adds per-player `bonusDeals` to `TreasureState` (hashed) and
   step 1 becomes `deals + takeTreasureBonusDeals(state, i)`, through a leaf module so `progression` doesn't import the
   treasure step. A Legendary before an ordinary floor's draft gives 2 deals (duo first). Before a boss floor's draft
   it gives 3 deals with one guaranteed duo, not two.
8. **Boost-kind draws need an rng parameter.** `pickBoostKind(d: DropsState)` draws from the drop stream. TR4 changes it
   to `pickBoostKind(rng: RngHolder)` (`DropsState` and `TreasureState` both satisfy `RngHolder`, so `dropsOnKill` is
   unchanged) and calls it with `state.treasure`. Weights: Fury 3 / Quickstep 3 / Frenzy 3 / Aegis 2 (total 11).
9. **Boosts land in front of the chest, not on a ring.** The chest stands against a wall, so half of a 0.9-tile ring
   lies inside the wall. `VaultPlan` carries the facing `(fx, fz)` (into the room) and the landing offsets are a
   constant table in the front half-plane (`TREASURE.boostOffsets`, relative to the facing; none within the chest cell
   or behind its front edge).
10. **The vault room must have planned spawns.** Only rooms with `roomSpawns[id].size() > 0` get a `RoomScore` (and
    pellets). A combat room the spender left empty would never arm, so `placeVault` skips it.
11. **The back wall must be a real wall, preferably a far wall.** Endless combat / elite rooms have solid decor (tombs
    2 x 1 and candle stands, `Dungeon.solidDecor`, WALL cells) and solid pillars (WALL). The chest's back row (the three
    cells behind it) must be non-FLOOR and not a solid-decor cell, and no solid-decor cell may be within Chebyshev 1, so
    a chest never stands in front of a tomb or against a lone pillar. "Far wall" means the wall at `-x` or `-z` (front
    facing `(1, 0)` / `(0, 1)`, the Forge's own convention in `forge/solidDecor.ts`; screen-up is `(-1, -1)`), so the
    chest is seen front-on through the doorway. Candidates are sorted far wall first, then by distance from the room's
    doorways (farthest first), then row order.
12. **Dev overrides belong in the floor build, not the sim.** Placement is dungeon data, so `KV_TreasureDebug`
    ("every", "legendary", "rare", "swift", "untouched") becomes a `VaultOverride` passed to `placeVault` through
    `buildEndlessFloor` -> `endlessRunFloor` -> the dev world's floor cache (`run/dev.ts`). It never reaches the server
    (the dev world is in `SERVER_REFUSED_WORLDS`). With `every` the chance draw is still made and its result ignored, so
    the later draws keep their positions. `TreasureConfig.debug` is dropped.
13. **The minimap mark is a dynamic marker, not a `RoomMark`.** `MinimapController` builds the treasure / shrine
    `RoomMark`s once per floor with a fixed role. The vault mark changes colour (crack) and style (hollow once opened),
    so it is its own marker, like the stairwell (`showMarker(..., "fill" | "hollow")`). It shows at the chest cell once
    that cell isn't UNKNOWN or the room was revealed (the room marks' rule).
14. **The chest open sets no `relicCollected` run event.** `run.events.relicCollected` / `me.events.relicCollected`
    feed `shared/play/liveRun.ts` `collectRunEvents` (the relic toast and `sfx.relic.take`). The chest's own cards and
    sting would double them, so `TreasureEvents.opened` carries the grants and the HUD's owned-relic row reads state as
    usual.

### Every row checked

| # | Fact (plan) | Verdict | Where (real) | Note |
|---|---|---|---|---|
| 1 | Room types combat / elite / treasure (pedestal) / shrine / entrance / boss; breakables in combat / elite / treasure | Confirmed | `dungeon/encounterTypes.ts` `EncounterRoomType`; `dungeon/breakablesData.ts` `BREAKABLE.roomTypes` | Entrance / boss excluded by id in `placeBreakables` |
| 2 | Rolled-on-floor precedent; used salts | Corrected | `dungeon/affixes.ts`, `breakableLoot.ts`, `pellets.ts`, `forge/solidDecor.ts`, `endless.ts`, `sim/drops/dropsData.ts` | Two salts the plan missed: pellets `0x27220a95`, solid decor `0x7f4a7c15` (Forge, `makeRng(seed ^ salt)`). New: **`VAULT.salt = 0xb5297a4d`** (floor, `EncounterRng(floorSeed ^ salt)`), **`TREASURE.salt = 0x4b565452`** ("KVTR", sim stream `seedToState(seed) ^ salt`, like drops' "KVDR" `0x4b564452`). Grep of `src/`, `scripts/`, `fixtures/` (hex and decimal 3039394381 / 1263948882): unused. Also avoided: view-only `0x1b873593`, `0x68e31da4`, `0x1b56c4e9`, `0x2545f491`, `0x9e3779b9`, fmix `0x85ebca6b` (= `FLOOR_SEED_MUL`) / `0xc2b2ae35` |
| 3 | Breakables: slot = placement index, `resetBreakables` in stepEndless, created in createSimState; block movement and bullets, not sight; `damageBreakable(state, slot, amount, source)` the one path | Confirmed, with corrections 2 and 3 | `sim/breakables/breakables.ts`, `cells.ts` `solidCells` / `breakableSlotAt` | `resetBreakables` is called in `sim/endless.ts` `nextFloor` |
| 4 | Placement rules and exported helpers | Corrected | `dungeon/breakables.ts` | Only `breakableCandidates(input, room)` (doorway 3, spawns 1.5, entrance 3, stairwell 2, pedestal / shrine 2, pools) and `withoutBreakableCells` are exported. `Placer` (`gapOk`, `ringOk`, `hugsWall`), `doorwaysByRoom`, `prepFloor` are private: TR1 exports `pieceFitsAt` and `roomDoorways`. Removing the chest cell from `roomSpawnTiles` moves no **planned** spawn, but it is one candidate fewer for the sim's safe-spawn move (`sim/endless.ts` `safeRoomSpawns`), as with every piece |
| 5 | `RoomScore` (`room`, bounds, `parTicks`, `engageTick`, `hitsAtEngage`, `cleared`); ROOMS 250 / PERFECT 500 / FAST; endless rooms engage on entry | Confirmed | `sim/score/score.ts` `RoomScore`, `clearRoom`, `stepScore`, `attachScoreRoomMembers` | **The party hit counter is `ScoreState.hitsTaken`**: the sum of `events.playerHits` (every player's hits) added in `stepScore` step 2. Endless records engage in `attachScoreRoomMembers` (stepEndless `enterRoom`, phase 5) with `hitsAtEngage = hitsTaken` before that tick's hits are added, so hits on the entry tick count, for PERFECT and the vault alike. Hits since engagement = `s.hitsTaken - r.hitsAtEngage`, read after `stepScore` |
| 6 | Which hits count | Confirmed | `sim/player.ts` `damagePlayer` | `playerHits += 1` after Aegis (`absorbWithAegis`) and armor, so both count (as for PERFECT). I-frames / post-hit invulnerability (`isPlayerInvulnerable`) and dev god mode (`devBlocksHit`) land nothing. Tutorial harmless hits count, but the tutorial has no vaults |
| 7 | `step` / `stepParty` return early in a draft; `tick` still advances | Confirmed, with correction 4 | `sim/step.ts` | Drafts only open on a floor change |
| 8 | Runtime children adopted (`adoptScoreRoomMember`) | Confirmed | `sim/score/score.ts` | "Cleared" is a safe unlock edge |
| 9 | Pedestal: first living player in index order within `PEDESTAL_RADIUS` (0.5); `grantRelic`; per-player relics | Confirmed | `sim/progression/progression.ts` `stepRun` step 4, `grantRelic`; `progressionData.ts` | The relic is `left[rngInt(state, 0, left.size() - 1)]` over `unowned(me.relics, RELIC_COUNT)` (index order): **the sim rng**. `unowned` is private: TR4 exports `unownedRelics(state, i)`. `grantRelic` works mid-floor (no one-off effect; `refreshRunMods(p, buildPlayer(...))`; no-op if owned). See correction 14 |
| 10 | Builds: `draftsLeft`; boss double draft, first deal's card 0 a guaranteed duo | Confirmed, with corrections 6 and 7 | `sim/builds/builds.ts`, `cards.ts` `drawCardOffers` / `drawPlayerCardOffers`, `buildsData.ts` (`floorDrafts` 1, `bossFloorDrafts` 2), `progression.ts` `openDraft` / `redeal` | |
| 11 | Ground drops: 4 slots, `landDrop` / `lowestFreeDropSlot` (leaf `drops/breakLoot.ts`), 10 s life, hop for `fromPiece` | Confirmed, with conflict C1 | `sim/drops/breakLoot.ts` `landDrop(d, slot, kind, x, z, tick)`, `lowestFreeDropSlot(d)`; `dropsData.ts` `DROPS` (`maxOnGround` 4, `groundSeconds` 10, `pickupRadius` 0.6) | Pickup is the first living player in reach, per slot (not picker-only). `stepDrops` runs before `stepScore`, so a chest boost landed in `stepTreasure` (after it) ages and can be picked up from the next tick, like piece loot landed in stepCombat on the same tick it could be (one tick later here: harmless) |
| 12 | Config-gated score sources | Confirmed, values new | `sim/score/scoreData.ts` `ScoreSource`; `score.ts` `addBuildScoreSources`, `addPelletScoreSources`, `sourceName`; `view/hud/strings.ts` `SCORE_SOURCE_KEYS` | JACKPOT 9 (builds), PELLETS 10 / SWEEP 11 (pellets; padding includes JACKPOT). **TREASURE = 12**, `TREASURE_SCORE_SOURCE_NAMES = ["treasure"]`. See "Score source gating" below |
| 13 | Respite levers | Not built | docs/DIFFICULTY.md (Status: planned, nothing built) | TRD10 dormant (above) |
| 14 | `DAILY.ruleset` | Corrected | `daily/config.ts` (history comment), `daily/daily.spec.ts` (`toBe(5)`) | **Current 5** (2 loot, 3 solid decor / themes / new enemies, 4 pellets branch-only, 5 pellets on main). Vaults: **5 -> 6** (if another branch bumps first, take the next free number, the PELLETS precedent) |
| 15 | Minimap marks; breakables drawn as floor | Confirmed, with correction 13 | `view/minimap/config.ts` `MINIMAP_VIEW.roomMarkRoles` (treasure `decor.fx.glint`, shrine `fx.curse`); `src/client/controllers/ui/MinimapController.ts`; `view/minimap/sight.ts` ("Breakables are not map tiles") | Boost drops in sight: diamond markers (MD14) |
| 16 | Floor text never hides a bullet | Confirmed | `view/hud/comboConfig.ts` `COMBO_SHOUT.maxOpacity` 0.55 / duck; `view/breakableLootConfig.ts` `BREAKABLE_LOOT_VIEW.duckTiles` 1.25; glint art `decor.fx.loot` (`src/client/controllers/render/glintParts.ts`) | |
| 17 | HUD corners; score panel 158 / 160 | Confirmed | `view/hud/footprint.ts` (status 160, score 160) | No new always-on panel |
| 18 | Luau locals 183-199 | Corrected | counted on `out/` built 2026-11-03 | **`contract.luau` 186, `validate.luau` 196** (191 `local` lines + 5 extra names in three multi-name declarations), matching CLAUDE.md's Pellets entry |
| 19 | Rarity roles `rarity.*` | Corrected | conflict C2 | Strings to reuse: `boon.rarity.common` / `.rare` / `.legendary` ("Common" / "Rare" / "Legendary") |
| 20 | Dead co-op players return on the next floor | Confirmed | `sim/endless.ts` `nextFloor` (`revivePartyMember(p, PARTY_REVIVE_HALF_HEARTS)` unless `hasLeft`) | So "dead players get nothing at the open" costs them only that chest; the next floor's draft (and a Legendary bonus deal granted to living players) opens after the revive |
| 21 | Room themes | New | `dungeon/forge/solidDecor.ts` (`crypt` tombs along walls, `hall` candles every few tiles, `store` corner clusters of breakables, `plain`) | Correction 11. Store rooms leave the fewest free wall cells; the TR1 census reports vault rooms by theme |
| 22 | Pellets placement | New | `dungeon/pellets.ts` (rooms with deferred enemies; cells off pieces and planned spawns, reachable by BFS from the entrance) | Correction 1 |
| 23 | `stepEndless` floor change hooks | Confirmed | `sim/endless.ts` `nextFloor`: `awardFloorClear` -> clear bullets / procs / actors -> floor += 1 -> players to the entrance (revive) -> `resetBreakables` -> `dropsOnFloorPieces` -> spawns -> `rebuildScoreRooms` -> `pelletsOnFloor` -> `events.floorChanged` | `treasureOnFloor(state, world.vault)` goes right after `pelletsOnFloor` (the records exist) |
| 24 | Tick order | Confirmed | `sim/step.ts` `step` / `stepParty` | 1 clears (score, breakables, drops, affixes, builds, pellets; forfeit; dev toggle; run events; frozen draft -> stepDraft, return) -> 2 stepPlayer -> 3 stepCombat -> 4 stepEndless -> 5 stepRun -> 6 stepDrops -> 7 stepPellets -> 8 stepScore -> **8b stepTreasure** -> 9 tick += 1. `clearTreasureEvents` joins the clears. A future `stepRespite` (also planned after stepScore) goes after stepTreasure |
| 25 | Hash group order | Confirmed | `sim/hashLayout.ts`, `sim/replay.ts` `writeHashFields` | core, combatHeader, actors, weapons, enemyBullets, playerBullets, endless, score, run, party, tutorial, breakables, drops, affixes, dev, builds, pellets, **treasure** (new, last) |
| 26 | One builder for client, server and lockstep | Confirmed | `run/endless.ts` `buildEndlessRunConfig` (solo and party branches; the daily world uses it); `run/dev.ts` `buildDevRunConfig` builds on it | The tutorial builds its own layouts (`run/tutorial.ts`, not `buildEndlessFloor`), so it never gets a vault |

### Score source gating

Every endless world sets builds **and** pellets, so its score arrays already hold 12 sources (0-11). The rule for
`treasure`, consistent for every subset of {builds, pellets, treasure}:

- `addTreasureScoreSources(s)` pads `points` / `counts` to `SCORE_SOURCE_COUNT + BUILD_SCORE_SOURCE_NAMES.size() +
  PELLET_SCORE_SOURCE_NAMES.size() + TREASURE_SCORE_SOURCE_NAMES.size()` = 13 (idempotent `while size < total`), called
  in `createSimState` **after** the builds and pellets padding. A treasure run without builds or pellets pads JACKPOT /
  PELLETS / SWEEP with 0.
- `scoreTreasure` is gated by `s.points.size() <= ScoreSource.TREASURE` (the JACKPOT pattern). The padded sources stay
  0 without their feature: `scorePellet` / `scoreSweep` / `scorePowerBullets` also require `state.pellets`, and
  `scoreJackpot` is only called from build procs.
- `sourceName(k)` gains the treasure names after the pellet names. `SCORE_SOURCE_KEYS` gains `score.source.treasure`
  (string in TR6; `hud.spec.ts` checks every key exists, so the key is added in TR6, not TR2). The run-over breakdown
  already shows port-only rows only when they scored.

## As built (TR1, 2026-11-03)

Files: `src/shared/dungeon/vaultData.ts` (`VAULT`, `VaultLock`, `VaultTier`, `CHEST_KIND`, `VAULT_PERCENT_RANGE` 100,
`vaultChancePercent`, `legendaryPercent`), `src/shared/dungeon/vault.ts` (`vaultSeed`, `VaultPlan`, `VaultOverride`,
`VaultCell`, `VaultRoom`, `vaultRoomOpen`, `vaultCandidates`, `vaultRooms`, `placeVault`, `vaultChest`,
`vaultCentre`, `isFarWallFacing`), `breakablesData.ts` (`BREAKABLE_PIECE_KINDS`, `BreakablePieceKindName`;
`BREAKABLE_KINDS` unchanged), `breakables.ts` (`BreakablePlacement.kind` widened; `pieceFitsAt`, `pieceFitter`,
`breakableCandidateFinder`; no placement change), `breakableLoot.ts` (`lootPieceWeight`: 0 for the chest, so the
widened kind still types; no draw change), `endless.ts`, `sim/endless.ts` (`EndlessFloorWorld.vault?`, type only),
`run/endless.ts` (`endlessFloorWorld` passes `vault`). Specs: `dungeon/vault.spec.ts` (18 tests, ~50 s headless) and
`dungeon/vault.census.spec.ts` (2 tests, ~70 s).

Deviations from the implementation map (none touches an owner decision):

- **The option gate.** `buildEndlessFloor(runSeed, floor, dungeonFor, partySize, options?)` takes
  `EndlessFloorOptions { vaults?, vaultOverride? }` instead of a positional `vaultOverride`. Without `vaults: true` no
  draw is made and the layout is exactly the old one (`vault` absent; spec "the option gate"), so **every endless
  world, the tutorial, M1 and every fixture are unchanged by TR1** (the sim's `kindIndex` would refuse a `chest` until
  TR2 anyway). `endlessRunFloor` does not pass it yet: **TR5 passes `{ vaults: true }` in `endlessRunFloor` /
  `buildEndlessRunConfig`'s floor cache and the dev world's floor cache (with `vaultOverride`)**.
- **Doorways** come from the existing `enemyRooms.ts` `roomDoorways(d, roomId)` (grid cells; already exported, so no new
  `roomDoorways` in `breakables.ts`: the name was taken).
- **Two cell rules made stricter**: the back row must be **WALL** (the plan said non-FLOOR: a pool or the void is not
  "against a wall"), and a new **`VAULT.sideClearTiles` 1**: the cells beside the chest along its wall are FLOOR of the
  room and free of pieces, so a chest never stands tucked into a corner or wedged against a set piece, and reads
  front-on. `pellets` is an optional parameter of `placeVault` (absent: no pellet cells to avoid).
- `placeVault` draws are as planned: 0 below `fromFloor`, 1 on a miss (or a hit on a floor with no eligible room), 4 on a
  hit. Weighted picks use `rng.int(0, total - 1)` walked in order (the loot's style). The chance draw is made before any
  cell is computed, so a miss costs nothing; a hit floor's `vaultRooms` costs ~15 ms headless.
- No tunable changed: every chance hit in the census found an eligible room.

Census (`vault.census.spec.ts`, run seeds 1-10 x floors 2-20, 190 floors; party 1 / party 4):

| | Party 1 | Party 4 |
|---|---|---|
| Vault floors, floors 2-4 (40 %) | 9 / 30 = 30.0 % | same |
| Vault floors, floors 5-9 (50 %) | 25 / 50 = 50.0 % | same |
| Vault floors, floors 10-20 (55 %) | 51 / 110 = 46.4 % | same |
| Chance hits lost (no eligible room) | 0 | 0 |
| Open rooms (combat / elite, spawns, >= 120 tiles) with no valid cell | 381 / 1720 = 22.2 % (crypt 134 / 482, store 85 / 357, hall 81 / 384, plain 78 / 429) | 441 / 1720 = 25.6 % (crypt 157, store 93, hall 96, plain 88) |
| Mean valid cells per open room | 8.1 | 7.0 |
| Legendary | 23 / 85 = 27.1 % (want 33.8 % on these floors) | same |
| SWIFT | 47 / 85 = 55.3 % | same |
| Elite vault rooms | 14 / 85 = 16.5 % (eligible rooms 13.1 % elite) | 12 / 85 = 14.1 % (13.3 %) |
| Chest on a far wall | 76 / 85 = 89.4 % | 70 / 85 = 82.4 % |
| Vault rooms by theme | crypt 23, plain 23, hall 19, store 19, none 1 | crypt 25, plain 23, hall 19, store 17, none 1 |

The rates sit within binomial noise of the bands (the chance draw decides alone, since no hit was lost; the 1000-stream
spec on floor 6 gives 486 vaults for 50 %, 29 % Legendary for 29 %, 50 % SWIFT, 24.7 % in elite rooms). Crypt rooms
lose the most cells (wall tombs), as TR0 predicted, but they still hold their share of vaults. Party 4 has fewer cells
(more spawns, so more pieces' clear zones) but the same vaults on these seeds.

## As built (TR2, 2026-11-03)

Files: `src/shared/sim/treasure/treasureData.ts` (`TreasureConfig`, `TREASURE` with salt `0x4b565452` and the four
`boostOffsets` (forward 0.9 / 1.7, side -0.3 / +0.3 tiles: in the two FLOOR cells straight in front, one per ground
slot), `VaultStatus`, `TREASURE_UNSET` -1, `CHEST_HP` 1, `VAULT_TIER_COUNT` / `VAULT_LOCK_COUNT`, the tunables and
`ENDLESS_TREASURE_CONFIG`), `treasure.ts` (`TreasureState`, `TreasureEvents { armed, cracked, unlocked }`,
`treasureSeedState`, `createTreasureState`, `treasureOnFloor`, `clearTreasureEvents`, `cloneTreasureState`,
`treasureRunSummary`, `TREASURE_HASH_FIELDS`, `writeTreasureHash`, `treasureHashNames`), `stepTreasure.ts` (a no-op
stub in TR2), `index.ts`; `sim/breakables` (`BreakableKind.CHEST` 2, `kindIndex` over `BREAKABLE_PIECE_KINDS`, the chest's
hp `CHEST_HP` by kind, `damageBreakable` returns false for a chest before any bookkeeping, `meleeHitBreakables` /
`slamBreakables` skip it), `sim/score` (`ScoreSource.TREASURE` 12, `TREASURE_SCORE_SOURCE_NAMES`,
`addTreasureScoreSources`, `treasureAwardPoints`, `scoreTreasure`, `sourceName` past the pellet names; `award` books
through a new private `credit`, same arithmetic), `step.ts` (`SimConfig.treasure`, the clears, `stepTreasure` after
`stepScore` in both), `state.ts`, `endless.ts` (`treasureOnFloor` after `pelletsOnFloor`), `hashLayout.ts` /
`replay.ts` (`TREASURE_SUBSYSTEM`, last). Test support: `src/shared/run/testing/vaultRun.ts` `buildVaultRunConfig(seed,
party, { override, treasure, startFloor })` (the endless config with `{ vaults: true }` floors and the treasure config;
TR5 replaces it with the real worlds).

Deviations and details (none touches an owner decision):

- **The record lookup.** `treasureOnFloor` looks the plan's room up in `state.score.rooms`; a room without a record (no
  scoring) gives `NONE`, not a vault that could never arm. With breakables it throws when piece `plan.slot` is not an
  intact chest on the plan's cell (floor data out of step with the plan).
- **Unset values are -1** (`TREASURE_UNSET`) for room / record / slot / lock / tiers / ticks / allowance / missBy / spare
  on `NONE` and before they apply; `x` / `z` / `fx` / `fz` are 0 then.
- **Hash group `treasure`:** `TREASURE_HASH_FIELDS` (21 scalars: `rngState`, `status`, `room`, `record`, `slot`, `x`, `z`,
  `fx`, `fz`, `lock`, `startTier`, `tier`, `armTick`, `ticksLeft`, `allowance`, `crackTick`, `missBy`, `spare`, `opened`,
  `kept`, `legendary`), then `bonusDeals.length` and values; dump names `treasure.<field>`, `treasure.bonusDeals[i]`.
  `bonusDeals` and the run counters exist from TR2 so TR4 adds no hash field.
- **Score:** `scoreTreasure` is gated by size like JACKPOT; `treasureAwardPoints` = `floor(base x depth x (4 + curses) /
  4)`. Padding per subset of builds / pellets / treasure: 9 / 10 / 12 / 12 / 13 (any with treasure), pinned in
  `score.spec.ts`. `scoreJackpot` is gated by size alone, so in a treasure run without builds it would pay if called;
  it is only called from build procs, as TR0 said.
- **The chest piece in breakables:** every bullet still stops on it (an enemy bullet is consumed, a player bullet's
  `damageBreakable` is false, so a heavy arrow stops too); a Charger stuns on it (its break pass skips the chest, the
  mover stops it); goo is never laid on it. Specs in `breakables.spec.ts`, `charger.spec.ts`, `bomber.spec.ts`.

Verify (2026-11-03, this host): `npm run typecheck` and `npm run lint` clean; `npm run test:only -- sim/ run/ lockstep/
play/liveRun`: 107 suites, **1322 passed, 0 failed** (891 s; golden runs, M1 hash, `run/tutorial` lock, endless /
party / partyProgression / segments / validate replays, `sim/hash`, clone and score specs among them), so with the
config absent every fixture, the M1 hash, the tutorial lock and every endless replay are bit-identical.

## As built (TR3, 2026-11-03)

Files: `src/shared/sim/treasure/stepTreasure.ts` (steps 1-3, `vaultAllowance(present, level, config)`,
`swiftTicks(par, level, config)`), `respite.ts` (`treasureRespiteLevel(state)`: `TREASURE_RESPITE_NONE` 0 until
docs/DIFFICULTY.md's Respite exists), `treasureData.ts` (`TREASURE_RESPITE_NONE`, `VAULT_LOWEST_TIER`,
`VAULT_CRACK_TIERS`). Specs: `stepTreasure.spec.ts` (20 tests, ~6 s) and `stepTreasure.bot.spec.ts` (the 200 bot
rooms, ~65 s).

As planned, with these details (none touches an owner decision):

- **Arm:** `armTick = state.tick`, which is always the record's `engageTick` (endless records engage in stepEndless's
  `attachScoreRoomMembers`, M1-style ones inside stepScore, both before stepTreasure on the same tick). The allowance
  uses `presentPlayerCount(state) ?? 1` at arm time and stays fixed.
- **UNTOUCHED** is checked on the arm tick too (a hit landed on the entry tick cracks there, as it spoils PERFECT);
  **SWIFT** first counts down on the tick after arming. A cracked SWIFT stops at `ticksLeft` 0.
- **Clear:** `spare` = SWIFT `ticksLeft` (exactly FAST's `under` at 100 %) / UNTOUCHED `allowance - hits`; `missBy` =
  SWIFT `clear tick - crackTick` (0 when the countdown ends on the clear tick) / UNTOUCHED `hits - allowance`.
- **Respite tables** are read with the level clamped into the table (`byLevel`), so a future level past the table
  reads its last entry.
- **Events** (`armed` / `cracked` / `unlocked`, 0 / 1 per tick) are cleared with the others and never hashed.
- **Worlds in the specs:** real endless floors with forced vaults (`buildVaultRunConfig`, seed 4242 floor 2 for most;
  seeds 1-20 floors 2-11 for the bot), no hand-built `EndlessFloorWorld`: the real floors cover every rule, and the
  slime test finds a real vault room with a slime (seeds 1-30, floors 4-9). Hits are landed through `damagePlayer` in a
  score-and-treasure-only tick (score.spec.ts's pattern), except the entry-tick hit (an enemy bullet in a real step).
- **Bot rooms:** 200 UNTOUCHED vault rooms solo, the pellet census's sword fight (20 s cap, then the rest killed): 29
  kept, 171 cracked; kept exactly when the clear paid PERFECT in every room.

For TR4: step 4 goes in `stepTreasure` after step 3 (today the early return only lets SEALED / ARMED / CRACKED
through, so let UNLOCKED reach step 4; an unlock and an open on the same tick are fine); `TreasureEvents` gains
`opened` (and `clearTreasureEvents` / `cloneTreasureState` with it); `bonusDeals`, `opened` / `kept` / `legendary`
and the stream (`rngState`, an `RngHolder`) are already hashed, and `scoreTreasure(state, config.points[tier])` is
ready. `TREASURE.boostOffsets` are `{ forward, side }` tiles: forward along `(fx, fz)`, side along a perpendicular TR4
picks (`(-fz, fx)` suggested), from the chest centre `(x, z)`.

Verify (2026-11-03): `npm run test:only -- sim/treasure`: 3 suites, 33 passed. Regression: `npm run test:only --
sim/treasure sim/hash sim/runFull sim/determinism sim/step sim/score sim/breakables sim/pellets sim/drops sim/party
run/tutorial run/endless run/party run/partyProgression run/segments run/validate run/dev lockstep/`: 30 suites, **449
passed, 0 failed** (222 s); typecheck and lint clean.

## As built (TR4, 2026-11-03)

Files: `src/shared/sim/treasure/stepTreasure.ts` (step 4: `openerOf`, `openChest`, `grantBoosts`, `grantRelicShare`;
steps 1-3 moved into `stepLock`, unchanged), `bonus.ts` (new leaf: `takeTreasureBonusDeals(state, i)`), `treasure.ts`
(`TreasureGrant`, `TreasureOpened`, `TreasureEvents.opened`, cleared and deep-cloned), `treasureData.ts`
(`TreasureConfig.relicFallbackBoosts`, `TREASURE_RELIC_FALLBACK_BOOSTS` 2), `progression/progression.ts`
(`unownedRelics(state, i)`; `stepRun` step 1 deals `deals + takeTreasureBonusDeals(state, i)`), `drops/drops.ts`
(`pickBoostKind(rng: RngHolder)`; `DropsEvents.fromChest`, cleared and cloned; the pickup goes through `applyBoost`),
`drops/breakLoot.ts` (`applyBoost`, `giveBoost`), `drops/dropsData.ts` (`GIVEN_DROP_SLOT` -1),
`view/hud/strings.ts` (`SCORE_SOURCE_KEYS` spreads `TREASURE_SCORE_SOURCE_NAMES`, TR6's literal gone; same key, index 12).
Specs: new `sim/treasure/open.spec.ts` (18 tests); `stepTreasure.spec.ts` (`enter` now steps back out of reach, the last
clear test opens), `stepTreasure.bot.spec.ts` (an unlocked chest may be opened by the bot), `treasure.spec.ts` (the
draft takes the bonus deals), `builds.spec.ts` (a bonus deal re-deals), `progression.spec.ts` (`unownedRelics`, no bonus
without treasure), `drops.spec.ts` (`pickBoostKind` on any `RngHolder`).

As planned, with these details (none touches an owner decision):

- **Opener:** the first player in index order with `dead === 0`, not left, whose centre is within `reachTiles` of the
  chest's centre (`<=`). An unlock and an open on the same tick are fine (stepLock, then step 4). "Living present" (dead
  0, not left) is also who gets a share.
- **Draw order:** players in index order; per player its relic (or bonus deal) first, then its boosts. Fixed counts:
  Common 2 per player; Rare 1 (a relic) or 2 (pool empty); Legendary 1 with builds, 2 (relic + boost) or 3 (pool empty:
  2 + 1) without. All on `state.treasure` (`pickBoostKind(t)`, `rngInt(t, ...)`), never `state.rngState` or the drop
  stream; the ground never changes a draw.
- **Landing:** the k-th boost that lands in this open takes `TREASURE.boostOffsets[k]` (mod 4) at `(x + fx * forward -
  fz * side, z + fz * forward + fx * side)` (side along `(-fz, fx)`), in the lowest free slot (`landDrop`, spawnTick =
  this tick; `events.dropped` and `events.fromChest`). stepDrops ran earlier in the tick, so a landed chest boost can be
  picked up from the next tick. **C1:** with no free slot the boost is given at once (`giveBoost`: the pickup's own
  effect, ticks = full duration, Aegis its pip) and reported as `DropsEvents.collected` with `slot = GIVEN_DROP_SLOT`
  (-1) at the player's position, so liveRun's boost toast and the collect cue fire as for a pickup. The view's slot
  lookups only read `dropped` slots, which never hold -1.
- **The relic** goes through `grantRelic` (no `relicCollected` run event, correction 14); the pool is
  `unownedRelics(state, i)` (the pedestal's, relic index order).
- **The bonus deal:** `bonusDeals[i] += 1` (Legendary, builds present); stepRun step 1 takes it (zeroed) into
  `openDraft`, so an ordinary floor deals 2 (first deal a guaranteed duo when one is available) and a boss floor 3 (one
  duo guaranteed). A player who left keeps an untaken bonus (never dealt).
- **Score / counters:** `scoreTreasure(state, points[tier])` once per open (0 without scoring); `opened += 1`, `kept += 1`
  when `crackTick` is unset, `legendary += 1` for a Legendary tier. `treasureRunSummary` (TR2) reads them.

**For the view (TR7 / TR8):** `state.treasure.events.opened: TreasureOpened | undefined` on the open's tick only:
`{ opener, tier, startTier, lock, kept (0/1), missBy, spare, points, grants }`, `grants` one `TreasureGrant` per living
present player in index order: `{ player, relic (TREASURE_UNSET none), bonusDeal (0/1), boosts: kinds[], slots: ground
slot | GIVEN_DROP_SLOT | TREASURE_UNSET (no drops)[] }`. The hop out of the chest: `DropsEvents.fromChest` (landed slots,
a subset of `dropped`). Other per-tick events: `armed`, `cracked`, `unlocked` (0 / 1). State the view reads:
`status` (VaultStatus), `x` / `z` (chest centre), `fx` / `fz`, `lock`, `startTier`, `tier`, `armTick`, `ticksLeft`
(SWIFT), `allowance` (UNTOUCHED) with the record's hits (`score.hitsTaken - rooms[record].hitsAtEngage`), `crackTick`,
`missBy`, `spare`, `slot` (the chest's breakables slot), `room`, `bonusDeals`; the run counters through
`treasureRunSummary(state)`.

Verify (2026-11-03, this host, worlds still without `SimConfig.treasure`): `npm run typecheck` and `npm run lint` clean;
`npm run test:only -- sim/treasure sim/drops sim/progression sim/builds/builds`: all passed (open.spec 18 / 18);
regression `npm run test:only -- sim/ run/ lockstep/ play/liveRun`: 110 suites, **1364 passed, 0 failed** (948 s), so
every fixture, the M1 hash, the tutorial lock and every endless replay stay bit-identical with the config absent.

## As built (TR5, 2026-11-04)

Files: `src/shared/run/endless.ts` (`treasure: ENDLESS_TREASURE_CONFIG` in both branches of `buildEndlessRunConfig`;
every floor built with `{ vaults: true }` in `endlessRunFloor` and the per-run floor cache; new `EndlessRunOptions {
vaultOverride? }` as the third parameter, passed by the dev world and specs only), `run/dev.ts` (`DevRunOptions.vault?:
VaultOverride` into `buildEndlessRunConfig`; `TREASURE_DEBUG_ATTRIBUTE` "KV_TreasureDebug" and the pure
`parseTreasureDebug(text)`), `src/client/controllers/ui/DevModeController.tsx` (Go reads the Workspace string into
`vault`), `src/client/controllers/game/SimController.ts` (`startDev` keeps `vault`, so R / Restart keep it),
`daily/config.ts` (`ruleset` 6, history comment) and `daily.spec.ts`, `run/testing/vaultRun.ts` (no longer builds its
own floors: a thin wrapper over `buildEndlessRunConfig(seed, party, { vaultOverride })` with `startFloor` and an optional
`treasure` replacement or `false`; the treasure specs keep it for the forced vaults and the start floor at any party
size), `run/testing/endlessBot.ts` (`Driver.openVault`, `VaultVisit`, the census-only `immortal` flag), new
`run/treasureCensus.spec.ts`. Spec updates: `run/endless.spec.ts` (15 groups, `treasure` last), `run/dev.spec.ts` (the
group order; `parseTreasureDebug`; the override reaches the dev floors, without one they are the endless run's),
`run/affixes.spec.ts`, `run/partyProgression.spec.ts`, `sim/breakables/breakables.spec.ts`, `sim/builds/builds.spec.ts`,
`sim/progression/progression.spec.ts` (group order, `treasure` last; builds' "only the appended group" case leaves treasure
out of both runs, as it did pellets), `sim/pellets/pellets.spec.ts` (its configs leave treasure out, so pellets stay the
last group and source it pins), `sim/pellets/stepPellets.spec.ts` (groups matched by name), `run/tutorial.spec.ts` (the
tutorial has no `treasure` and no vaults), `sim/treasure/treasure.spec.ts` (the "absent" case strips the config from the
endless world), and two determinism pins re-recorded (below).

Details (none touches an owner decision):

- **Who gets vaults:** endless solo, co-op, daily (the same builder) and dev. The tutorial builds its own layouts and M1 /
  the fixtures never call the endless builder, so all three replay exactly as before (their lock and golden specs pass
  untouched).
- **KV_TreasureDebug** words (any case, any separator; last of a kind wins): `every`, `legendary` / `rare`, `untouched`
  / `swift`. Read when Go starts a dev run (dev runs are never submitted, so never counted: `unsubmittedReason` `dev`,
  `SERVER_REFUSED_WORLDS`). The server never sees an override (the dev world is client-only).
- **Replays:** the endless / party / partyProgression / daily / dev / segments / validate specs record their runs live and
  compare against the server's own replay, so they changed and still agree: seed 1337's descent, the party runs and the
  new honest vault run replay and validate segmented with the vaults in (validate's pinned `03c59442` is the web build's
  M1 `run-player.json`, unchanged). Two determinism pins on real endless floors moved, because run 4's floor 3 now holds
  a vault (one more breakables slot, its chest): `charger.spec.ts` `PIN_HASH` 4860eb56 -> c5df44a4 (counts unchanged)
  and `stormcaller.spec.ts` run 4 3/0/49e332ac -> 3/0/e303e3be (strikes unchanged; run 23's pin unchanged).
- **Replay bench** (`run/replay.bench.spec.ts`, budget 10 ms per replayed tick): room solo 0.224 ms, room 8 players
  0.646 ms, floor solo 0.540 ms, floor 8 players 1.293 ms (TR4's run on the same host: 0.281 / 0.805 / 0.468 / 1.412;
  host noise either way). The cost of a vault floor is one record read per tick and a few draws per open.
- **The census bot** (`Driver.openVault`): walks to the chest's second front cell (engaging the room; the open stairwell
  avoided), fights the room's members with the sword (nearest one, straight at it in sight, else along the grid; 60 s
  cap), then walks onto the first front cell to open. It does not change `recordEndlessRun` (no spec descent detours).
  **Deviation:** `partyBot.ts` is not extended (the map listed it): `recordPartyRun` debug-skips floors 2+, so its runs
  never meet an armed vault; co-op opens are covered by `open.spec.ts` (party 1-4 grants, allowance, C1 overflow per
  player) and TR3's party lock cases. A co-op census is left to TR11's playtest.

### Census (`run/treasureCensus.spec.ts`, run seeds 1-12 x floors 2-12, solo, 132 floors)

Hearts topped up (census only), floors ended by the debug skip with the draft answered like a player.

| Floors | Vaults seen | Opened | UNTOUCHED kept | SWIFT kept | Mean tier opened (started) | Legendary opened | SWIFT clear / par |
|---|---|---|---|---|---|---|---|
| 2-4 (40 %) | 13 / 36 = 36.1 % | 11 (84.6 %) | 1 / 2 | 9 / 9 | 1.27 (1.36) | 3 | 0.32 |
| 5-9 (50 %) | 29 / 60 = 48.3 % | 28 (96.6 %) | 5 / 13 (38.5 %) | 15 / 15 | 1.00 (1.29) | 7 | 0.27 |
| 10-12 (55 %) | 20 / 36 = 55.6 % | 16 (80.0 %) | 2 / 10 (20.0 %) | 6 / 6 | 0.81 (1.31) | 3 | 0.22 |
| **2-12** | **62 / 132 = 47.0 %** | **55 (88.7 %)** | **8 / 25 (32.0 %)** | **30 / 30 (100 %)** | **1.00 (1.31)** | **13** | **0.28** |

Tier: 0 Common, 1 Rare, 2 Legendary. The 7 vaults not opened: 2 rooms the walk never reached (engaged false), 5 fights
past the 60 s cap. **For TR11:** UNTOUCHED sits at the bottom of its 30-50 % target for this bot (a sword bot that walks
into every bullet; a careful player should do better), and gets harder with depth. **SWIFT is far too easy at
`swiftParPercent` 100:** the bot clears vault rooms in 22-32 % of par and kept all 30, against a 40-60 % target. Par is
tuned as FAST's bonus window, not as a target (the Risk named in this plan); a SWIFT percent around 30-40 would put this
bot near the target. Not changed here (TR11 is the owner's tuning task).

The honest run (no surgery, flask when hurt, drafts with the stick): seed 5, floor 1 walked, floor 2's UNTOUCHED Rare
vault fought (cracked to Common) and opened (300 TREASURE points), floor 2's stairwell walked, the draft picked: 2296
ticks; it replays to the live hash and validates through `SegmentedValidator` in 1200-tick segments, same hash and
score.

Verify (2026-11-04, this host): **`npm run verify`**: typecheck, lint, check:assets, check:autolocalize, test:art,
test:checks, test:l10n and the build clean; headless tests **327 suites, 4539 passed, 1 failed** (2345 s). The one
failure is the known host-only `dungeon/forge/forge.spec.ts` "EncounterRng is the sim's new Rng(seed): seedToState
vectors and streams" (fails on `main` too). M1 (golden runs, the M1 hash), every golden fixture and the tutorial lock
pass untouched.

## Player experience (target)

### Finding the room

- **About 1 floor in 2** from floor 2 on (TRD6) has one vault. A short toast on the floor reveal says
  `A vault lies on this floor` (top centre, 2 s, once per floor; it doesn't stack with the new-best stage-card line).
- **Through the doorway.** The chest stands against the room's far wall, caged in iron bars, with a slow sparkle in its
  tier colour: **blood-red Rare** or **candle-gold Legendary** (the draft's colours, TRD5, conflict C2; Common is
  bone and never a starting tier). The Legendary sparkle is bigger and faster (`decor.fx.loot` star, the BL glint art).
  The room's edge lines stay as they are (waiting grey), so the room still reads as "enemies inside".
- **On the minimap** a chest mark in the tier colour appears once the chest cell is seen or the room revealed.

### The lock (on entering the room)

The room engages as usual: spawns, live edges. On the same frame:

- **Top-centre toast**, 2.5 s: `VAULT · UNTOUCHED: clear without a hit` or `VAULT · SWIFT: clear in 0:42`, with the
  lock's icon.
- **The lock plate** lies on the floor in front of the chest (SurfaceGui, under every bullet, at most 55 % opaque,
  ducking near bullets):
  - **UNTOUCHED**: the lock icon plus hit pips, **0 allowed solo** (one pip outlined); co-op shows the allowance (a
    3-player party has 2 spare pips; TRD7).
  - **SWIFT**: a countdown `0:42` that turns `ember` in its last 10 s and pulses in its last 5 s (1 Hz; reduced motion:
    colour only).
- Off-screen it doesn't nag. The plate is where the chest is, and the toast already said what to do.

### The crack (a miss, mid-fight)

The hit that uses up the last spare pip, or the countdown reaching 0, **cracks** the lock:

| t (s) | What happens |
|---|---|
| 0 | `sfx.treasure.crack` (a short metal snap). The lock plate **shatters** (the combo break's shards, in the lost tier's colour) |
| 0 | The chest's sparkle **flashes white, then steps down** one tier colour (Legendary -> Rare, Rare -> Common) and keeps sparkling at the new tier |
| 0 | A small floor line `Rare` (the new tier's name, `boon.rarity.*`, in its colour) rises from the chest and fades (0.6 s) |
| 0 | Minimap mark recolours |

It doesn't freeze, shake or block anything: it happens mid-fight, and the hurt sound or the fight is louder. A lock
cracks **once**. After that the room just needs clearing.

### The unlock (room clear)

The room clear's sequence (stamp, tally, roll; docs/ROOM_CLEAR.md) plays first. At **+0.6 s** (once the stamp has landed):

- the cage bars **sink into the floor** (0.35 s, a short rattle `sfx.treasure.unlock`);
- the chest **wobbles** every 1.2 s (anticipation) and its sparkle doubles in rate;
- a kept lock shows a floor line `UNTOUCHED ✓` / `SWIFT ✓ 4.2 s to spare` in the tier colour (0.9 s). A cracked one
  stays quiet here: the "so close" line waits for the open, where it doesn't fight the stamp.

If you leave the room unfinished, the chest stays caged. The swift countdown keeps running, because the room is still
engaged. Come back, clear it, and it unlocks. If you leave the floor first, the vault is gone with it.

### The opening (walk up to it)

Any living player within `reachTiles` (1.5) of the chest's centre opens it, for the whole party (TRD8).

| t (s) | What happens |
|---|---|
| 0 | Anticipation: the lid jolts twice (0.25 s). Solo: a 40 ms freeze on the pop (the heavy-hit length, through the hitstop clock; off under Freeze frame off / reduced motion) |
| 0.25 | The lid **pops**. A **tier-coloured light column** and a ring burst (24 sparks, the tier colour, never the enemy-bullet hues). A small camera shake (the `stamp` nudge, Screen shake setting; solo and co-op both, since it's view-only) |
| 0.25 | The sting: `sfx.treasure.open`, pitched by tier (Common 0 / Rare +3 / Legendary +7 semitones). **Legendary also plays `sfx.jingle.treasure`** (a jingle: it ducks the music) |
| 0.3 | **Reward cards** pop above the chest (BillboardGui, like the score pops: they float up 1 tile and fade at 1.6 s): `RELIC · Hourglass` / `BONUS DRAFT next floor` / `+2 BOOSTS` and the score `+1,200` |
| 0.3 | Boosts **hop out** (the BL hop curve) and land in front of the chest. Pick them up as usual |
| 0.6 | **The near-miss line**, only after a crack: `So close: 2.1 s over` / `So close: 1 hit` in `uiTextDim`, under the cards, 1.4 s. A kept lock shows `Kept Legendary` in the tier colour instead |

The open chest stays there for the rest of the floor, lid up, no sparkle. The minimap mark turns hollow.

### What's inside

| Tier | How you get it | Reward (each living, present player) | Score (`TREASURE`) |
|---|---|---|---|
| **Legendary** | rolled Legendary, lock kept | **Bonus draft**: your next floor's draft deals one extra round, and its first deal's card 0 is a guaranteed duo when you have one available (the boss double-draft rule; correction 6). **Plus one boost** for you | 1,500 |
| **Rare** | rolled Rare and kept, or Legendary cracked | **A relic** (unowned, from the pedestal's pool; none left: two boosts) | 800 |
| **Common** | rolled Rare, cracked | **Two boosts** for you | 300 |

Score is `floor(points x depth x curse)`, without combo (TRD11, correction 5). In co-op the boosts are spilled (party
size x the count) and picked up first-touch, like every drop; what doesn't fit the 4 ground slots goes straight to the
player whose share it is (owner answer C1).

## Rules

- **Endless only** (solo, co-op, daily, dev). Off in the tutorial, M1 and every fixture.
- **Rooms:** combat or elite with planned spawns (elite weighted x2: harder fights hold the vaults). Never the entrance,
  the pedestal room, the shrine or the boss / stairwell room. On boss floors the vault can still be in an ordinary room.
- **Starting tier:** Rare or Legendary, never Common. Common exists only as a cracked Rare.
- **Lock kinds (v1): UNTOUCHED and SWIFT** (TRD4). The lock and tier are fixed with the floor. Respite eases the lock
  (TRD10, dormant until Respite exists) but never the tier.
- **UNTOUCHED** is cracked by the party's hits since the room engaged (`hitsTaken - hitsAtEngage`) beyond the allowance:
  present players - 1 (`presentPlayerCount(state) ?? 1`; players who left don't count), plus Respite. Armor and Aegis
  hits count, because PERFECT counts them.
- **SWIFT** is cracked when `ticksLeft` reaches 0 (correction 4). `ticksLeft` starts at `scaleTicks(parTicks,
  swiftParPercent + respiteSwiftPercent[level])` (`progression/runMods.ts`, round half up; 100 % returns `parTicks`).
- **One crack per vault.** Clearing the room unlocks it. Opening happens on proximity to the unlocked chest.
- **Floor change:** an unopened vault is lost silently (it was the player's choice to leave it).
- **Death:** dead players get nothing at the open. A run that ends before the open loses it.
- **Co-op:** the vault is party state. Every client shows the same lock, crack and open (lockstep). The opener is only
  who triggered it; everyone alive gets their own reward.
- **Spectating:** the view player's rewards show (the cards follow the watched player's grants).
- **Reduced motion:** no wobble, jolt, freeze or shake. The bars fade instead of sinking. Colours, text and sounds stay.
- **Particles off:** no sparks or column. The sparkle becomes a still star (the BL reduced-motion frame).

## Design

### 1. Dungeon: `shared/dungeon/vault.ts` + `vaultData.ts` (pure)

```ts
export const VAULT = table.freeze({
	salt: 0xb5297a4d,              // TR0: unused anywhere in src/, scripts/, fixtures/ (hex and decimal)
	fromFloor: 2,
	chanceByBand: [                // percent of floors with a vault
		{ fromFloor: 2, percent: 40 }, { fromFloor: 5, percent: 50 }, { fromFloor: 10, percent: 55 },
	],
	roomWeight: { combat: 1, elite: 2 },
	minRoomTiles: 120,             // floor cells of the room
	legendaryPercent: { base: 25, perFloor: 1, max: 40 },   // else Rare
	lockWeights: [1, 1],           // VaultLock order: UNTOUCHED, SWIFT (index table, append only)
	wallClearTiles: 2,             // in front of the chest: floor of its room
	doorFarTiles: 6,               // at least this far from every doorway of its room
	decorClearTiles: 1,            // no solid-decor cell within this Chebyshev distance (correction 11)
});
export const VaultLock = { UNTOUCHED: 0, SWIFT: 1 } as const;   // append only: stored and hashed
export const VaultTier = { COMMON: 0, RARE: 1, LEGENDARY: 2 } as const;
export const CHEST_KIND = "chest";                               // BREAKABLE_PIECE_KINDS[2]
export interface VaultPlan {
	room: number;            // encounter room id
	x: number; y: number;    // tile coords of the chest cell
	fx: number; fz: number;  // facing into the room: (1, 0) / (0, 1) on far walls, negative on near walls
	slot: number;            // the chest's index in the floor's breakables (= pieces before it)
	lock: number; tier: number;
}
export interface VaultOverride { every?: boolean; tier?: number; lock?: number }  // dev world only (correction 12)
export function placeVault(input: BreakableFloorInput, floor: number, pieces: ReadonlyArray<BreakablePlacement>,
	pellets: FloorPellets, override?: VaultOverride): VaultPlan | undefined;
```

- Stream: one `EncounterRng(vaultSeed(floorSeed))`, `vaultSeed = bxor(u32(floorSeed), VAULT.salt)`. Draws, fixed per
  case: below `fromFloor`, none. Else 1 (chance, `rng.int(0, 99) < percent`). On a hit: 1 weighted room pick over the
  eligible rooms (id order), then the cell (deterministic: no draw), then 1 tier draw (`rng.int(0, 99) <
  legendaryPercent(floor)`), then 1 lock draw (weighted). If the picked room has no valid cell there's no vault (no
  reroll; counted in the TR1 census).
- Eligible room: type combat / elite, not entrance / boss, `roomSpawns[id].size() > 0`, at least `minRoomTiles` floor
  cells, at least one valid cell (the eligibility test computes the cells, so a room with none is never picked).
- Valid cell: in `breakableCandidates(input, room)`, not a piece cell, not a pellet cell, at least `doorFarTiles` from
  every doorway of the room (`roomDoorways`), a back row of three non-FLOOR cells none of them solid decor, no solid
  decor within `decorClearTiles`, its front `wallClearTiles` cells FLOOR of the room, and `pieceFitsAt` (gap rule +
  ring reachability against the floor's pieces). Order: far wall first, then farthest from the doorways, then row order.
- `EndlessFloorLayout.vault?` / `EndlessFloorWorld.vault?` carry it. The stage loader's pre-generation builds it with the
  floor (it's part of `buildEndlessFloor`).
- **The chest is appended to the floor's breakables list** as kind `chest`, after loot and pellets, so `breakableLoot`
  slots and pellet cells never include it. `roomSpawnTiles` is computed from the full list, so its cell leaves the
  safe-spawn candidates (no planned spawn moves).
- `dungeon` can't import `sim`, so the tier and lock tables live here and the sim reads them, like
  `BREAKABLE_LOOT.kindWeights` (with a spec pinning the shared numbers).

### 2. Sim: `shared/sim/treasure/` (opt-in, deterministic)

```ts
export interface TreasureConfig {                      // ENDLESS_TREASURE_CONFIG
	readonly swiftParPercent: number;                  // 100
	readonly reachTiles: number;                       // 1.5
	readonly respiteAllowance: ReadonlyArray<number>;  // extra hits by Respite level: [0, 0, 1, 1]
	readonly respiteSwiftPercent: ReadonlyArray<number>; // extra par percent by level: [0, 10, 20, 30]
	readonly points: ReadonlyArray<number>;            // by tier: 300, 800, 1500
	readonly boosts: ReadonlyArray<number>;            // per player by tier: 2, 0 (relic), 1
}
export const VaultStatus = { NONE: 0, SEALED: 1, ARMED: 2, CRACKED: 3, UNLOCKED: 4, OPENED: 5 } as const;
export interface TreasureState {
	readonly config: Readonly<TreasureConfig>;
	rngState: number;          // own mulberry32: seedToState(seed) ^ TREASURE.salt (0x4b565452), never state.rngState
	status: number;            // VaultStatus
	room: number; record: number; slot: number; x: number; z: number;   // room id, score record index, breakables slot, world centre
	fx: number; fz: number;    // facing (boost landing offsets)
	lock: number; startTier: number; tier: number;
	armTick: number;           // -1 until armed
	ticksLeft: number;         // SWIFT countdown, -1 otherwise
	allowance: number;         // UNTOUCHED: hits allowed this vault (present - 1 + Respite at arm time)
	crackTick: number;         // -1 unless cracked
	missBy: number;            // after a crack, on clear: ticks over (SWIFT: clear tick - crack tick) or hits over the allowance
	spare: number;             // kept: ticks or hits to spare
	bonusDeals: number[];      // per player: extra deals for the next floor's draft (Legendary; correction 7)
	opened: number; kept: number; legendary: number;    // run counters (the recap's highlight)
	events: TreasureEvents;    // NOT hashed: armed, cracked, unlocked, opened { tier, kept, missBy, spare, grants[] }
}
```

`stepTreasure(state)` runs **after `stepScore`** (this tick's engagement, hits and clear are known; slot 8b above), in
`step` and `stepParty`, never on frozen draft ticks:

1. **SEALED -> ARMED** when the vault room's record has `engageTick >= 0` (`armTick = state.tick`). UNTOUCHED:
   `allowance = (present - 1) + respiteAllowance[level]`. SWIFT: `ticksLeft = scaleTicks(parTicks, swiftParPercent +
   respiteSwiftPercent[level])`. `level = treasureRespiteLevel(state)` (0 until Respite exists).
2. **ARMED** (not on the arm tick for SWIFT): UNTOUCHED: `hitsTaken - hitsAtEngage > allowance` -> **crack**. SWIFT:
   `ticksLeft -= 1`, at 0 -> **crack**. A crack sets `tier = max(COMMON, tier - 1)`, `status = CRACKED`, `crackTick`,
   `events.cracked`.
3. **Cleared** (record `cleared === 1`) from ARMED or CRACKED -> **UNLOCKED**. Kept: `spare` = ticks left / hits unused.
   Cracked: `missBy` = clear tick - crack tick (SWIFT) or hits over the allowance (UNTOUCHED). Then `events.unlocked`.
   Step 2 runs before step 3 on the same tick, so a cracking hit on the clear tick cracks (PERFECT counts it too).
4. **UNLOCKED:** the first living player (index order) within `reachTiles` of the chest centre opens it: **OPENED**, the
   grants below, `opened += 1`, `kept += 1` if it wasn't cracked, `legendary += 1` if `tier = LEGENDARY`, then
   `events.opened`.

Floor change (`sim/endless.ts` `nextFloor`, right after `pelletsOnFloor`) calls `treasureOnFloor(state, world.vault)`:
the new floor's plan (`SEALED`, record index looked up by room id) or `NONE`. The run counters and `bonusDeals` stay.
`createSimState` does the same for floor 1 / dev `startFloor`, after the pellets block.

**Grants** (every draw on `state.treasure`, an `RngHolder`; living present players in index order; fixed counts per case):

| Tier | Per living present player |
|---|---|
| Legendary | builds present: `bonusDeals[i] += 1` (taken by `stepRun` step 1 on the next floor change, correction 7). Builds absent: a relic as Rare. Then 1 `pickBoostKind(treasure)` -> landed |
| Rare | 1 `rngInt(treasure, 0, left - 1)` over `unownedRelics(state, i)` -> `grantRelic`. None left: 2 boost draws instead |
| Common | 2 `pickBoostKind(treasure)` -> landed |

Boosts land at `TREASURE.boostOffsets` (constant table, front half-plane, correction 9) in the lowest free ground
slots (`landDrop`, `DropsEvents.fromChest`). What doesn't fit goes straight to the player whose share it is (C1). `scoreTreasure(state, points[tier])` once
per open (not per player), combo-neutral (correction 5).

**What touches what:** `drawCardOffers` sees one more deal only after a Legendary open, so from that draft on the run's
sim-rng draws differ, deterministically. That's a consequence of play, like taking a boon. A floor without an open draws
nothing new from `state.rngState` or `drops.rngState`. (Landed chest boosts can still change later kill-drop draws: a
full ground skips its draw. That is also downstream of an open.) TR3 and TR4 pin both.

**Hash:** group `treasure` appended last (after `pellets`): every scalar above but `config` and `events`, then
`bonusDeals.length` and values, with dump names `treasure.<field>`, `treasure.bonusDeals[i]`. `cloneSimState` copies
it. The breakables group carries the chest piece (kind 2, hp `CHEST_HP`).

**The chest piece:** `BreakableKind.CHEST` = 2 (`BREAKABLE_PIECE_KINDS`, correction 2), unbreakable (correction 3).
Minimap: breakables aren't map tiles, so the chest cell draws as floor and the vault has its own mark (correction 13).

### 3. Worlds

| World | `SimConfig.treasure` / vault plan |
|---|---|
| M1, every fixture | absent: unchanged |
| Tutorial | absent and no plan (`run/tutorial.ts` builds its own layouts): unchanged, the lock spec passes untouched |
| Endless solo / co-op / daily | `treasure: ENDLESS_TREASURE_CONFIG` in both branches of `buildEndlessRunConfig`; plans from `buildEndlessFloor` |
| Dev (`buildDevRunConfig`) | the same, plus a `VaultOverride` from `KV_TreasureDebug` through the dev world's own floor cache (correction 12); dev runs never count (records and leaderboard policy) |

### 4. View (presentation only)

| Piece | Change |
|---|---|
| `shared/view/treasure/` (pure) | `TreasureFrameEvents` (collect per tick, reset per frame: the `BoostFrameEvents` / `PelletFrameEvents` pattern) on `RunView` (`shared/play/liveRun.ts`, `shared/lockstep/client.ts`; `NO_TREASURE_EVENTS` elsewhere); `TREASURE_VIEW` tunables; the timelines (crack flash, bars sink, wobble, jolt, column, cards, near-miss) as pure functions of time with specs; text helpers (`lockToastText`, `lockPlateText`, `nearMissText`, `rewardCardTexts`); `vaultMarkStyle(status, tier)` for the minimap |
| `TreasureRenderController` (client, new) | The chest (closed / open art on the piece's cell; BreakableRenderController skips chest slots), the cage overlay, the tier sparkle (`decor.fx.loot` tinted by the floor tier role, Legendary at 1.5x size and 2x rate; ducks within 1.25 tiles of an enemy bullet like BL6, `glintParts.ts`), the lock plate (the combo shout's construction: floor SurfaceGui via `createKvSurfaceGui`, at most 55 % opaque, ducks), the crack shards (ComboController's shard helper), the column and ring (ParticleController), the reward cards (BillboardGui, the score pops' style) |
| Hitstop / camera | 40 ms freeze on the pop (solo, `freezeFrameOn`, FreezeFrameController); the `stamp` nudge (`view/fx/freezeRules.ts`) under the Screen shake setting |
| ToastPanel | `hud.toast.vault` on the floor reveal; `hud.toast.vaultLock.<lock>` on arm |
| Minimap | A dynamic vault marker at the chest cell (correction 13), filled in the tier's UI colour, hollow once opened |
| Audio cue mapper | `sfx.treasure.crack`, `sfx.treasure.unlock`, `sfx.treasure.open` (speed per tier), `sfx.jingle.treasure` (Legendary; in `DUCKING_SFX` and `JINGLE_SFX`, `SFX_PRIORITY` 73: below `sfx.best.new` 74, above the room-clear jingles 72) |
| Room clear | The unlock waits `TREASURE_VIEW.unlockDelaySec` 0.6 after the clear frame. RoomClearController isn't changed |
| Run recap (RR) | `treasureRunSummary(state)` -> `{ opened, kept, legendary }` (shared/sim treasure) |
| Debug | `KV_TreasureLabel` (Studio / KV_Debug): a label over the chest with lock, tier, status and ticksLeft |

### 5. Theme contract

Following `theme/pellets.ts` / `pelletColors.ts`: the IDs live in a pure-data `theme/treasure.ts`, named inline inside
`contract.ts`' existing lists; the colour rules and `treasureReport` live in `theme/treasureColors.ts`, folded into
`variantColors.ts`' problems (validate.ts takes no new name).

- One new slot `TREASURE` (prefix `treasure.`; required, a gameplay object is always drawn): `treasure.chest` (closed),
  `treasure.chestOpen`, `treasure.cage`. The placeholder draws a box, a lid wedge and a bar Frame. Optional:
  `fx.treasure.column`. Cost: one top-level local in `contract.luau` (186 -> 187) for the slot; `validate.ts` gains the
  prefix in its known-prefix string and an inline unknown-ID check (no new local).
- Strings: `hud.toast.vault`, `hud.toast.vaultLock.untouched` / `.swift`, `treasure.lock.untouched` / `.swift`,
  `treasure.kept`, `treasure.spareTime` / `.spareHits`, `treasure.nearMiss.time` / `.hits`, `treasure.reward.relic` /
  `.draft` / `.boosts`, `score.source.treasure`. Tier names reuse `boon.rarity.common` / `.rare` / `.legendary`. Every
  new string needs an entry in `l10n/context.json` (`l10n:check`, in verify).
- Audio: the four IDs above appended to `PORT_AUDIO_EVENTS` (SILENT in the placeholder). `SFX_FALLBACK` while silent:
  crack -> `sfx.combo.break`, unlock -> `sfx.stairwell.open`, open -> `sfx.relic.take`, jingle -> `sfx.room.perfect`
  (all exist; one step each).
- Colours: UI uses `boon.*` (already held to 3:1 on `uiPanel` by `boonRarityReport`). Floor uses `treasure.common` /
  `.rare` / `.legendary` if TR6's `treasureReport` confirms `boon.rare` / `.legendary` fail the 40 CIE76 telegraph bar
  (conflict C2). `treasureReport`: each floor role >= 40 CIE76 from `ROOM_EDGE_DIFFERENCE_ROLES` (enemy bullet,
  outline, telegraph), >= 3:1 on every biome floor and on `minimap.floor`; the UI roles >= 3:1 on `minimap.floor` too.

### 6. Server, lockstep, leaderboards

Nothing new to run. Validation and segmented validation re-run the sim; co-op steps the same frames. Cost: one record
read per tick on vault floors and a few draws per open. TR5 re-runs `run/replay.bench.spec.ts`. Endless replays and
scores change, so: **`DAILY.ruleset` 5 -> 6** (DSD11), and the all-time boards stay `_v1` (TRD13; nothing has launched,
the BLD9 / BUD9 / Pellets precedent).

## As built (TR6, 2026-11-03)

Theme only (no sim, dungeon, hash, replay or fixture change). Files: `src/shared/theme/treasure.ts` (new, pure data:
`TREASURE_TIERS` / `TREASURE_LOCKS` in VaultTier / VaultLock order, `TREASURE_IDS`, `TREASURE_CHEST_ID` /
`TREASURE_CHEST_OPEN_ID` / `TREASURE_CAGE_ID`, `TREASURE_COLUMN_FX_ID`, `TREASURE_PIECE_ROLES`, `TREASURE_FLOOR_ROLES`,
`TREASURE_UI_ROLES`, `treasureFloorRole` / `treasureUiRole` / `treasureTierNameKey` / `treasureLockNameKey`,
`TREASURE_AUDIO_IDS`, `TREASURE_STRING_KEYS`, `TREASURE_SCORE_SOURCE_KEY`), `treasureColors.ts` (new:
`TREASURE_COLOR_RULES`, `treasureReport`), `contract.ts` (slot `TREASURE`, in `SLOTS` and `WORLD_ART_SLOTS`; IDs inline in
`REQUIRED_ASSET_IDS`, `PORT_AUDIO_EVENTS`, `FX_IDS`, `REQUIRED_STRING_KEYS`), `validate.ts` (`treasure.` prefix, inline
unknown-ID check, the pivot message), `variantColors.ts` (folds `treasureReport` into `variantColorProblems`, with "map"
and "bullet" message forms), `types.ts` (5 roles), `placeholders.ts`, the placeholder manifest (vale clones it),
`packs/vale/fx.ts` (`fx.treasure.column` pending), `index.ts`; `shared/view/hud/strings.ts` (`SCORE_SOURCE_KEYS`),
`shared/view/audio/cues.ts`; `l10n/context.json` (17 entries). Spec: `theme/treasure.spec.ts` (16 tests).

### C2: the validator's numbers

The draft's colours measured as floor colours (`treasureReport` with `treasure.*` = `boon.*`; the same in the
placeholder pack, vale, and vale with its textured floor `#1a1619`):

| Role | vs `enemyBullet` `#ff3fa4` | vs `enemyBulletOutline` `#1a0610` | vs `telegraph` `#ff8a3d` | Lowest biome floor | `minimap.floor` `#36342f` |
|---|---|---|---|---|---|
| `boon.common` `#d7d0c0` | 84.0 | 81.3 | 65.2 | 9.53:1 (biome.3) | 8.09:1 |
| `boon.rare` `#f46669` | 43.5 | 79.0 | **36.8 (fails 40)** | 4.85:1 (biome.3) | 4.12:1 |
| `boon.legendary` `#f1bd44` | 105.5 | 101.1 | **34.2 (fails 40)** | 8.44:1 (biome.3) | 7.17:1 |

TR0's estimate was right to the decimal. So, per the owner's answer, the floor takes its own roles; UI uses keep `boon.*`
(their `minimap.floor` numbers above all pass). Each floor colour is the nearest sRGB colour to the draft's (by CIE76,
searched over every colour within 70 per channel) that clears every bar by at least 0.5 (rare sits between the pink
bullet and the orange telegraph, so it can't move far either way):

| Floor role | Value | From the draft's | vs `enemyBullet` | vs outline | vs `telegraph` | Lowest biome floor | vale textured | `minimap.floor` |
|---|---|---|---|---|---|---|---|---|
| `treasure.common` | `#d7d0c0` (= `boon.common`) | 0.0 | 84.0 | 81.3 | 65.2 | 9.53:1 | 11.66:1 | 8.09:1 |
| `treasure.rare` | `#ea5c66` | 4.5 | 40.5 | 76.1 | 40.6 | 4.34:1 | 5.30:1 | 3.68:1 |
| `treasure.legendary` | `#ebc444` | 6.4 | 110.6 | 102.9 | 40.5 | 8.72:1 | 10.67:1 | 7.41:1 |

The tiers stay >= 25 CIE76 apart step to step (the draft's ladder rule). Not a rule, for TR7 / TR11: `treasure.legendary`
is about 8 CIE76 from `boost.fury` `#ffc83d` (the draft's gold already was), and a Legendary chest drops a boost in front
of itself; the sparkle and the coin read apart by shape.

Two more roles (a TR6 addition: the placeholders need colours, and colours are roles): `treasure.chest` `#663418`, a dark
red-brown wood (the enemy bullet is 3.14:1 on it, the breakables' rule: bullets stop on the chest; 15 CIE76 from the
crate) and `treasure.cage` `#a8adb5`, light iron (>= 6.49:1 on every biome floor, 7.94:1 on vale's textured floor). The
open chest uses `treasure.chest`. `treasureReport`'s checks, in order: per floor role "floor" (every biome), "map"
(`minimap.floor`), "difference" (`ROOM_EDGE_DIFFERENCE_ROLES`, >= 40); per UI role "map"; the cage's "floor"; the
chest's "bullet" (`enemyBullet` on it, >= 3:1). Every check passes in every bundled pack (printed by the spec).

### Names the view tasks use (TR7 / TR8)

- **Assets** (required, slot `TREASURE`, free-size world art like `pellet.*`): `treasure.chest`, `treasure.chestopen`
  (the plan's `chestOpen`: asset ID segments are lowercase), `treasure.cage`. Placeholders (`PLACEHOLDER_VISUALS`): the
  chest a Block 3.5 x 2.25 x 2.5 studs, the open chest a Wedge with the same footprint (2.75 studs tall, slope = the lid),
  both `faces` (turn to the vault's facing); the cage ONE bar (0.25 x 3 x 0.25 studs) with `dash` (`length` = the bar,
  `gap` = `CAGE_BAR_GAP_PX` 3 px): the treasure renderer repeats it along the cage's sides (a generic placeholder
  renderer would draw one bar). Optional effect `fx.treasure.column` (last in `FX_IDS`; vale pending until TR9), to tint
  with the tier's floor role.
- **Colours**: floor `treasureFloorRole(tier)` (`treasure.common` / `.rare` / `.legendary`); UI `treasureUiRole(tier)`
  (`boon.*`); tier names `treasureTierNameKey(tier)` (`boon.rarity.*`); lock names `treasureLockNameKey(lock)`.
- **Strings** (required, `TREASURE_STRING_KEYS`, every one with an `l10n/context.json` entry): `hud.toast.vault`;
  `hud.toast.vaultLock.untouched` (solo), `.untouchedParty` (`{hits}`, the party's allowance), `.swift` (`{time}`, m:ss);
  `treasure.lock.untouched` / `.swift` ("UNTOUCHED" / "SWIFT"); the unlock line `treasure.unlocked` (`{lock}`: nothing to
  spare), `treasure.spareTime` (`{lock}`, `{seconds}` one decimal), `treasure.spareHits` (`{lock}`, `{hits}`); the open's
  `treasure.kept` (`{tier}`); `treasure.nearMiss.time` (`{seconds}`) / `.hits` (`{hits}`); the cards
  `treasure.reward.relic` (`{name}`), `.draft`, `.boosts` (`{count}`), `.points` (`{points}`, preformatted). The run-over
  row `score.source.treasure` ("Vaults") is in `SCORE_SOURCE_KEYS` at index 12, not required by the contract.
- **Audio** (`PORT_AUDIO_EVENTS`, SILENT in both packs): `sfx.treasure.crack` (priority 66, fallback `sfx.combo.break`),
  `sfx.treasure.unlock` (65, `sfx.stairwell.open`), `sfx.treasure.open` (70, `sfx.relic.take`), `sfx.jingle.treasure`
  (73, `sfx.room.perfect`; in `JINGLE_SFX` between `sfx.best.new` and the room clear's, and in `DUCKING_SFX`). Crack /
  unlock / open have a 0.5 s minimum interval. `SFX` names: `treasureCrack`, `treasureUnlock`, `treasureOpen`,
  `jingleTreasure`. Nothing plays them yet (TR8's cue mapper).

### Deviations from the plan (none touches an owner decision)

- **Strings.** Three additions: `hud.toast.vaultLock.untouchedParty` ("clear without a hit" is wrong for a party, TRD7),
  `treasure.unlocked` (a kept UNTOUCHED lock solo has nothing to spare) and `treasure.reward.points` (the card's number
  goes through a string, like `room.clear.fly`). The plan's check mark is spelled "kept" (`UNTOUCHED kept`,
  `SWIFT kept · 4.2 s to spare`): no string uses a non-ASCII glyph beyond the middle dot, and the per-script fonts
  (docs/LOCALIZATION.md) are not checked for it.
- **`FX_IDS` is built inside a function** (like `REQUIRED_ASSET_IDS`): an entry after its `...BOOST_FX_IDS` spread cost a
  top-level length local. That also moved its two array temporaries off the top level.
- **`SCORE_SOURCE_KEYS`** names `"treasure"` literally: shared/sim `TREASURE_SCORE_SOURCE_NAMES` is TR2's, on the sim
  branch. On merge, replace the literal with `...TREASURE_SCORE_SOURCE_NAMES` (same key, same index 12).
- `boonRarity.spec.ts`'s dark-rare case now expects one more message (the `minimap.floor` rule on the UI roles).

### Luau locals (counted on `out/`, top-level names)

`contract.luau` 186 -> **185** (+1 `TREASURE`, -2 `FX_IDS`' temporaries); `validate.luau` **196** unchanged (191 `local`
lines; no new name: the prefix string and the inline check only).

## As built (TR7, 2026-11-04)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). Files:

- `src/shared/view/treasure/` (new sub-barrel; never imports the `shared/view/hud` barrel, which imports `shared/play`,
  which imports this one): `config.ts` (`TREASURE_VIEW`: every tunable below), `events.ts` (`TreasureFrameEvents` /
  `TreasureFrameSource`, `NO_TREASURE_EVENTS`, `vaultOnFloor(state)`, `vaultHits(state)`, `crackedFromTier`),
  `timeline.ts` (every animation as a pure function of sim time), `vault.ts` (`TreasureViewTracker` -> one mutable
  `TreasureLook` per frame, with its edges), `text.ts` (`TREASURE_TEXT_KEYS`, `vaultClock`, `ticksToTenths`,
  `lockToastText`, `lockPlateText`, `platePips`, `unlockLineText`, `nearMissText`, `keptText`, `openLineText`,
  `tierNameText`, `lockNameText`, `rewardCardTexts`, `grantOf`, `relicNameKey`, `treasureDebugText`), `layout.ts`
  (`forwardPoint`, `cageBarOffsets`, `floorTextBoxAt` / `FloorTextBox`, `floorTextCanvas`, `pipCentres`). Specs:
  `timeline.spec.ts`, `vault.spec.ts`, `text.spec.ts`, `layout.spec.ts` (51 tests).
- `src/shared/play/liveRun.ts`, `src/shared/lockstep/client.ts`: `RunView.treasure` (reset per frame, collected after
  every tick). Spec: new `src/shared/play/treasureView.spec.ts` (the real sim through LiveRun and a 2-player
  LockstepClient: a forced SWIFT Rare vault on seed 4242 floor 2 armed, cracked, cleared and opened; each event once, on
  the tick the state shows it; the look and the pop edge (once) follow; the open's landed boosts are `fromChest`).
- `src/shared/view/breakables.ts`: `isChestPiece(kind)`; `BreakableTracker` never lists a chest slot as hit / broken /
  restored (it stays in the layout). `BreakableRenderController` gives a chest slot no view at all (no body, glint,
  debris; today's barrel look is gone). Spec case in `view/breakables.spec.ts`.
- `src/shared/view/boosts/events.ts`: `BoostEventSource.fromChest` (the open's landings, `DropsEvents.fromChest`, NOT in
  `fromPiece`, so the breakable loot sound never plays for them) and `chestLandingAt`. `BoostDropRenderController`
  keeps a chest's boost hidden until `open.hopDelaySec` (0.3 s) after its landing tick (`chestHopAge`), then the BL hop.
- `src/shared/theme/core.ts`, `pack.ts`, `index.ts`: `ThemeCore.treasurePiece(id)` / `ThemePack.treasurePiece(id)`
  (`TreasurePiece`: art or placeholder and colour; the open chest takes `treasure.chest`'s role), the pellet accessor's
  pattern. No contract, validator or Luau-locals change.
- `src/client/controllers/fx/ParticleController.ts`: `treasureBurst(x, z, tier, seed)` (one ring and
  `open.burst`'s 24 bits + 6 sparks in the tier's floor role, `treasure.*` appended to the palette; nothing with
  Particles off).
- `src/client/controllers/render/TreasureRenderController.ts` (new; the header comment lists every piece).

What the view does (times are sim seconds: pause and the hitstop hold them):

| Moment | On screen |
|---|---|
| Sealed | The closed chest (art or the placeholder box, turned into the room), the cage (the placeholder's one bar repeated round the chest's footprint grown 0.25 studs, `cageBarOffsets` at the bar's `dash` spacing: 14 bars; art: one billboard), the sparkle (`decor.fx.loot`, else `decor.fx.glint`, tinted by `treasureFloorRole(tier)`; one pass every 3 s, Legendary every 1.5 s at 1.5x; no glint art: a self-lit Neon diamond, peaking during a pass). Ducks within 1.25 tiles of an enemy bullet (`lootGlintDucked`) |
| Arm | The lock plate fades in over 0.15 s, 1.3 tiles in front of the chest: the lock's name over pips (UNTOUCHED: allowance + 1, the last outlined, spent ones dimmed) or the m:ss countdown (SWIFT: `ember` in the last 10 s, a 1 Hz pulse down to 0.45 in the last 5 s; colour only under reduced motion). The combo shout's construction and layer, at most 55 % opaque, `ShoutDuck` + `shoutDucked` over its 2.6 x 0.9 tile box grown by 1 tile |
| Crack | The sparkle mixes to white (1 -> 0 over 0.18 s) and shows the lost tier until 0.09 s; the plate's body goes and 6 shards (`comboShardAt`, flight x3 px) fly in the lost tier's colour over 0.45 s (in place under reduced motion); the new tier's name (`boon.rarity.*`) rises 0.8 tiles up-screen and fades over 0.6 s (a floor line, same construction and duck) |
| Unlock | At +0.6 s the bars sink (ease in) over 0.35 s, or fade under reduced motion; a kept lock's plate fades with them and its line (`treasure.unlocked` / `.spareTime` / `.spareHits`) shows 0.9 s; a cracked one stays quiet; the sparkle runs at 2x; once the bars are down the closed chest wobbles every 1.2 s (6 degrees, 2 cycles over 0.3 s; placeholder: a roll about its base, image art: the label's rotation, sprites: none; never under reduced motion) |
| Open | The whole chest hops twice over 0.25 s (0.35 studs; the placeholder has no separate lid; none under reduced motion); at 0.25 s the pop (`TreasureLook.popEdge`, once): the open art, solo the 40 ms freeze (`hitstop.request`, so `freezeFrameOn`), the `stamp` nudge (`requestNudge`: Screen shake, solo and co-op), `treasureBurst`, and the column (Particles off: none) rising 5 tiles over 0.12 s, holding 0.35 s, fading 0.5 s, at most 65 % (`fx.treasure.column` upright and tinted when a pack has it, else a Neon block 0.9 tiles wide, 35 % toward white). From 0.3 s the view player's cards (`rewardCardTexts`: relic / bonus draft / boosts in the opened tier's UI role, then the party's points in `uiAccent`), staggered 0.06 s, rising 1 tile and fading by 1.6 s; from 0.6 s for 1.4 s the line under them (`Kept <tier>` in the UI role, or `So close: ...` in `uiTextDim`). Boosts hop out at 0.3 s |
| Opened | The open chest stays, no sparkle, no cage |

A vault the view meets mid-way (a spectator's first frame, a restart, a missed event) shows its state settled: no
flash, shards, lines, column, cards or edges. A new vault (another room / slot / centre, the tick going back) forgets
every time; a frame's events of another vault (a floor change) are ignored. Debug: `KV_TreasureLabel` (Workspace
boolean, Studio or KV_Debug, off by default): `untouched legendary armed hits 0/0` / `swift rare cracked t=1234` over
the chest (developer English).

**For TR8:** `RunView.treasure` (`TreasureFrameSource`: `armed` {allowance, ticksLeft at the arm}, `cracked`
{fromTier}, `unlocked` {kept, spare, missBy}, `opened` {opener, tier, startTier, lock, kept, missBy, spare, points,
grants}, each with room / slot / tick / x / z / lock / tier) and `NO_TREASURE_EVENTS`; `lockToastText(str, lock,
allowance, ticksLeft)` for the arm toast; `vaultOnFloor(state)` for the floor-reveal toast; `TreasureLook.crackEdge` /
`unlockEdge` (the bars start: the rattle) / `popEdge` (the sting and jingle) if the cue mapper wants the view's timing
rather than the tick's (an `unlockEdge` is 0.6 s after `unlocked`, a `popEdge` 0.25 s after `opened`); the tier's UI
roles `treasureUiRole`. The open's landings are `boostEvents.fromChest` (today they still count in `dropped`, so
`sfx.boost.drop` plays on the open tick; TR8 decides). `vaultMarkStyle` (minimap) is not written.

Deviations (none touches an owner decision): the lid jolt moves the whole chest (no separate lid part or art); the
sparkle has no cell phase (one vault per floor); the plate is visible only while ARMED (a cracked lock shows no plate,
as the plan's "it shatters"); a sprite-set chest does not wobble; a chest's boosts are hidden 0.3 s after landing
(the sim lands them on the open tick, before the view's pop).

Verify (2026-11-04, this host): `npm run typecheck`, `npm run lint`, `npm run check:autolocalize`, `npm run
check:assets` clean; `npm run build` and `npm run build:place` clean; `npm run test:only -- view/ play/ theme/
lockstep/`: **166 suites, 2439 passed, 0 failed** (557 s).

### Studio-only assumptions to check first

1. The placeholder cage (14 bars, 0.25 studs, 3 studs tall round a 3.5 x 2.5 stud chest) reads as "closed" against
   every biome wall and does not hide a bullet behind it (the bars are taller than the BREAKABLE_VIEW height cap).
2. Sinking parts and an art cage's billboard moved below the floor are hidden by the floor slab (the sink relies on it;
   the reduced-motion fade does not).
3. The Neon diamond star (no glint art in the placeholder pack) and the tinted glint are visible at the far wall of a
   2x room through the doorway, and the 1.25-tile duck hides them before a bullet passes over.
4. The plate's SurfaceGui: `ClipsDescendants = false` lets the shards fly outside the plate's canvas; if Roblox clips
   SurfaceGui content to the face anyway, the shards are cut at the plate's edge (then widen the plate or shrink
   `crack.shardPxScale`).
5. `UIStroke` on the pips inside a SurfaceGui draws at the canvas scale (3 px of 166 px canvas); check it is not lost
   at the camera's distance.
6. The chest placeholder faces into the room with `CFrame.lookAt` (the wedge's slope, the open lid, toward the room):
   check the open wedge is not backwards.
7. The cards are `AlwaysOnTop` BillboardGuis (score pops' style) 4 studs up: check they never cover the player when
   they open the chest from the room side, on the smallest phone and at 70 % HUD.
8. The 40 ms pop freeze and the boost hop delay (0.3 s) together: a boost under the opener's feet is picked up on the
   tick after the open, before it is shown (the toast still says what was taken).
9. A floor change on the frame of an open (walking into the stairwell at once) drops the cards (the tracker forgets
   the vault): acceptable, but confirm nothing stays parked visibly.

## As built (TR8, 2026-11-04)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture, score or theme contract change; no new string,
colour role or audio ID: TR6 made them all). Files:

- `src/shared/view/treasure/toasts.ts` (new): `VaultToastTracker` (pure), `VaultToast`, `VaultToastInput`.
  `text.ts`: `lockToastLine(lock, allowance, ticksLeft)` (`TreasureToastLine`: the key and literal vars the toast store
  keeps, so the line is looked up when drawn and follows a language change; `lockToastText` now goes through it) and
  `TREASURE_TEXT_KEYS.toastFloor`. `config.ts`: `TREASURE_VIEW.toast` (`floorSec` 2, `lockSec` 2.5, `idBase`
  -(2^22)) and `TREASURE_VIEW.audio.openSemitones` [0, 3, 7].
- `src/shared/view/treasure/minimap.ts` (new): `vaultMarkStyle(status, tier, revealed)` -> `{ role, style }` or
  undefined. `src/shared/view/minimap/config.ts`: `MINIMAP_VIEW.markers.vault` 7 (a step over the room marks' 6).
- `src/shared/view/treasure/cues.ts` (new): `TreasureCueSource { crack, unlock, openTier }`, `NO_TREASURE_CUES`,
  `NO_TREASURE_OPEN`, `TreasureCueTracker` (its own `TreasureViewTracker`; the look's `crackEdge` / `unlockEdge` /
  `popEdge`).
- `src/shared/view/audio/cues.ts`: `AudioCueMapper.frame(..., pellets, treasure = NO_TREASURE_CUES)` (a trailing
  parameter: every existing call is unchanged), private `treasureCues`, exported `treasureOpenSpeed(tier)`; a frame's
  `boosts.fromChest` landings no longer count toward `sfx.boost.drop`. The IDs, ranks, fallbacks, `DUCKING_SFX` and
  `JINGLE_SFX` entries are TR6's, unchanged.
- `src/client/controllers/ui/TreasureToastController.ts` (new; render step `KV_TreasureToasts` after the FX tracker,
  the SightingController's slot), `MinimapController.ts` (the vault marker: `LAYER_Z.vault` 3 between the room marks
  and the stairwell, `FrameMarks.vault*`, `gatherVault`), `AudioController.ts` (owns a `TreasureCueTracker`, stepped in
  its sound frame on the sim clock `(tick + alpha) / SIM_HZ`; reset on run start, floor change and exit).
- `treasureRunSummary` / `TreasureRunSummary` (TR2) are exported from the `shared/sim` barrel, which is what
  `claude/run-recap-plan.md`'s "Chests opened" slot imports; a spec pins the barrel path.

Specs: new `view/audio/treasureCues.spec.ts` (12 tests), `view/treasure/minimap.spec.ts` (4), `view/treasure/toasts.spec.ts`
(7).

What it does:

| Piece | Behaviour |
|---|---|
| Floor toast | `hud.toast.vault` for 2 s, once per (run, floor), on the first frame with no stage cover (`isInputCovered` false: the fade is over), no open boon draft and no solo pause, so it never shares the screen with the stairwell card's new-best line or hides under the draft. Only while the vault is SEALED: a floor met with its vault already armed (a spectator, a dev start) is settled silently. None in the tutorial or after run over |
| Arm toast | One per armed event, on its frame, for 2.5 s: `hud.toast.vaultLock.untouched` (solo), `.untouchedParty` (`{hits}` = the allowance, TRD7), `.swift` (`{time}`, m:ss at the arm). ToastPanel's line (uiAccent, top centre), ids from `TREASURE_VIEW.toast.idBase` down |
| Minimap | A square at the chest's centre once its cell is not UNKNOWN to the party's fog or its room was revealed (the room marks' rule), in the CURRENT tier's floor role (`treasureFloorRole`: the sparkle's colour, so a crack recolours it), filled until OPENED, then a ring (`ringStroke`) |
| Crack | `sfx.treasure.crack` on the crack's frame (the look's `crackEdge`) |
| Unlock | `sfx.treasure.unlock` when the bars start to sink (`unlockEdge`, 0.6 s after the clear's tick) |
| Open | `sfx.treasure.open` on the lid's pop (`popEdge`, 0.25 s after the open's tick) at the exact speed 2^(st / 12), st = 0 / 3 / 7 by the opened tier; a Legendary also cues `sfx.jingle.treasure` (one jingle a frame: it beats a room clear's jingle, 72, and yields to the new-best fanfare, 74; it ducks the music). The chest's boosts play no `sfx.boost.drop` (they land on the open's tick, hop out 0.3 s later, and the sting is their sound). Silent IDs fall back as TR6 set them (the sting's tier pitch carries over to `sfx.relic.take`) |

Deviations (none touches an owner decision):

- **The minimap mark uses the floor roles**, not the UI roles Design §4 named: the map shows what the doorway shows (the
  sparkle is drawn in the floor role), and TR6's `treasureReport` holds every floor role to 3:1 on `minimap.floor`
  (`treasure.rare` 3.68:1 is the lowest). Mark size 7 reference px.
- **No lock icon in the toast** ("with the lock's icon"): the toast store is text-only (ToastPanel draws a Text line,
  or a headshot row); the lock's name leads the line (`VAULT · UNTOUCHED: ...`). An icon is a ToastPanel change for later
  (UI art, docs/UI_ART.md).
- **The audio keeps its own look** (`TreasureCueTracker`) instead of reading TreasureRenderController's: the sound frame
  (a NearMissController subscriber inside FxTrackerController's dispatch) and the renderer's step (after the camera)
  run in different render steps, so a shared look would make the sounds depend on the order they run in. The two
  trackers read the same frame events and sim clock, so their edges land on the same frame.
- **The world sounds are not gated** by the stage cover or run over (like the room clear and the relic take): a vault
  cannot arm under a solo cover, and a co-op cover is short.
- **A boost given straight to a player** (C1's overflow, `DropsEvents.collected` with `GIVEN_DROP_SLOT`) still plays
  `sfx.boost.collect` on the open's tick, 0.25 s before the sting: it is the pickup's own sound and toast (TR4).

Verify (2026-11-04, this host): `npm run typecheck`, `npm run lint`, `npm run check:autolocalize`, `npm run build`,
`npm run build:place` clean; `npm run test:only -- view/ theme/ play/`: **167 suites, 2426 passed, 0 failed** (532 s).

## As built (merge with main, 2026-11-04)

`main` @ `5ae04db` (Run recap, docs/RUN_RECAP.md; Bookshelves, docs/BOOKSHELVES.md) merged into `treasure-rooms`.
Both features kept whole. Resolutions:

- **Lists, in order: main's entries first, treasure's appended last** (so every "treasure is the tail" spec holds):
  `PORT_AUDIO_EVENTS` / `SFX` / `ALL_SFX` / the cue table / `SFX_FALLBACK` (pellets, then `sfx.room.teamperfect` /
  `sfx.player.syncparry`, then the four `sfx.treasure.*` / `sfx.jingle.treasure`), the placeholder manifest's sounds,
  `REQUIRED_STRING_KEYS` (RECAP / TEAM_MOMENT strings, then TREASURE_STRING_KEYS), `shared/theme` exports
  (`./runRecap`, then `./treasure` and its colour rules). `AudioCueMapper.frame` takes `syncs` then `treasure` (both
  trailing, defaulted); AudioController and treasureCues.spec pass `NO_SYNC_CUES` / `this.team.syncs()` before the
  vault edges. `LiveRun` / `LockstepClient` carry both `recapTally` and `treasure`, both collected every tick
  (`recapTally` never reset, `treasure` per frame). ParticleController's palette: the team pulse colour, then the
  treasure tier roles.
- **Specs:** contract.spec counts both (assets + 2 + 4 + 3; strings + 28 + 4 + 16); boosts.spec skips 6 + 3 + 2 + 4;
  pellets.spec finds the pellets' block by its last ID (main's form); runRecap.spec's tails skip the treasure entries
  after them.
- **`DAILY.ruleset` 7** (main's bookcases took 6, this branch's 6 never shipped); `daily.spec`, docs/DAILY.md, CLAUDE.md.
- **Luau locals (out/):** `contract.luau` **185**, `validate.luau` **196** (unchanged from TR6; main kept 186 / 196).

**Re-pins** (main's pins assumed no vaults, this branch's no bookcases; both re-derived on the merged tree; counts are
main's, only the hashes moved, and only where a vault stands):

- `charger.spec.ts` `PIN_HASH` -> **e54ef63f** (main acd2ce64, branch c5df44a4): run 4's floor 3 holds a vault on the
  bookcase layout (room 1, a crypt, Legendary SWIFT; the chest one more breakables slot); `PIN_COUNTS` [4, 2, 2, 4, 3]
  are main's, unchanged.
- `stormcaller.spec.ts` run 4 -> **2/1/f21b6834** (main 2/1/d5a796ef, branch 3/0/e303e3be): the same vault; strikes /
  skips main's. Run 23 (co-op) has no vault on floor 3: **6/0/ae2b2503**, main's exactly.
- Nothing else moved: roomPool.lock, the pellets census's honest power-pellet run (seed 14), every recorded endless /
  party / daily / dev replay and the honest vault run validate as they are.

**Vaults vs bookcases.** A bookcase is a 1 x 1 `Dungeon.solidDecor` piece whose cell is WALL; `placeVault` runs after
the Forge, so its cell filter already sees them: no back-row cell may be solid decor and no solid decor may stand within
`decorClearTiles` (1) of the chest, so a chest is never on, against or beside a case, and stands against a real wall.
New case in `dungeon/vault.spec.ts` (every vault floor of its sample, natural and forced): every case > 1 tile
(Chebyshev) from the chest, the back row WALL and no piece; `[vault x bookcases] 52 vaults: 7 in a room with bookcases
(5 library), 5 of them on a far wall; nearest case 3 tiles`. In the census below, 18 of 62 vaults stand in a room with
cases (11 library, 7 hall), and the libraries still get far-wall chests between the runs.

**Census** (`run/treasureCensus.spec.ts`, the same 132 floors, merged tree):

| Floors | Vaults seen | Opened | UNTOUCHED kept | SWIFT kept | Mean tier opened (started) | Legendary opened | SWIFT clear / par |
|---|---|---|---|---|---|---|---|
| 2-4 | 13 / 36 = 36.1 % | 13 (100 %) | 0 / 3 | 10 / 10 | 1.08 (1.31) | 3 | 0.37 |
| 5-9 | 29 / 60 = 48.3 % | 27 (93.1 %) | 1 / 13 (7.7 %) | 14 / 14 | 0.85 (1.30) | 5 | 0.30 |
| 10-12 | 20 / 36 = 55.6 % | 19 (95.0 %) | 1 / 12 (8.3 %) | 7 / 7 | 0.68 (1.26) | 2 | 0.26 |
| **2-12** | **62 / 132 = 47.0 %** | **59 (95.2 %)** | **2 / 28 (7.1 %)** | **31 / 31 (100 %)** | **0.85 (1.29)** | **10** | **0.32** |

Vault chance by floor is unchanged (its own stream). **UNTOUCHED kept fell from 8 / 25 (32 %) to 2 / 28 (7.1 %)** for
the sword bot. Not a vault bug: the drop is spread over every room kind, not the shelved ones (unshelved rooms 2 / 20
kept, shelved 0 / 8; both kept chests are in crypts), because `library` joining the theme weights re-themes and re-lays
every combat room (BOOKSHELVES.md BK2), so these are 28 different fights; the honest run (seed 5) now keeps its
UNTOUCHED Rare (800 points). For TR11 it sharpens the open item: UNTOUCHED is now under its 30-50 % target for this
bot, SWIFT still far too easy.

**The recap's Chests highlight** (follow-up commit): RUN_RECAP.md reserved a `Chests opened` slot for this plan; it
is filled. `RECAP_HIGHLIGHTS` P9 `chests` (between Sweeps and Grazes; Grazes .. the fill rows renumbered 10-14), min
1, `coop: "team"`; `RunRecapInput.chests?` (`RecapChestsInput`, `treasureRunSummary(state)` from RecapController when
`state.treasure` exists, else absent: no row at all); string `run.recap.hl.chests` "Chests opened" (in
`RECAP_STRING_KEYS`, 29; written out in `REQUIRED_STRING_KEYS`; `l10n/context.json`). Presentation only; recap.spec
covers the gate, the threshold, the priority and the co-op label. Locals unchanged (185 / 196).

Verify (merged tree, this host): typecheck, lint, check:assets, check:autolocalize, test:art, test:checks, test:l10n,
build and `build:place` clean; headless tests **347 suites, 4756 passed, 1 failed** (2523 s): the known host-only
`dungeon/forge/forge.spec.ts` seedToState vectors (NaN sign bit, `fff8...` for `7ff8...`).

## Implementation map (TR1-TR8)

`npm run test:only` runs the compiled specs in `out/`: rebuild first (`npm run build`, or `npx rbxtsc` after the
fixtures exist). Filters are plain substrings of the spec path; several can be given. `npm run verify` before each
commit.

### TR1. Dungeon

| File | Change |
|---|---|
| `src/shared/dungeon/vaultData.ts` (new) | `VAULT`, `VaultLock`, `VaultTier`, `CHEST_KIND`, `legendaryPercent(floor)`, `vaultChancePercent(floor)` |
| `src/shared/dungeon/vault.ts` (new) | `vaultSeed`, `VaultPlan`, `VaultOverride`, `vaultCandidates(input, room, pieces, pellets)` (ordered), `placeVault(...)` |
| `src/shared/dungeon/breakablesData.ts` | `BREAKABLE_PIECE_KINDS = ["barrel", "crate", "chest"] as const`, `BreakablePieceKindName`; `BREAKABLE_KINDS` unchanged |
| `src/shared/dungeon/breakables.ts` | `BreakablePlacement.kind: BreakablePieceKindName`; export `pieceFitsAt(d, pieces, gx, gy)` (a `Placer` with `taken` = the pieces, a fresh group: `valid`) and `roomDoorways(d)` (`doorwaysByRoom`). No placement change |
| `src/shared/dungeon/endless.ts` | `EndlessFloorLayout.vault?`; `buildEndlessFloor(runSeed, floor, dungeonFor, partySize, vaultOverride?)`: after `placePellets`, `placeVault(...)`; `pieces = vault ? [...breakables, chest] : breakables`; `roomSpawnTiles` from `pieces`; `breakables: pieces`; file comment gains the `vault` line |
| `src/shared/dungeon/index.ts` | barrel exports |
| `src/shared/sim/endless.ts` | `EndlessFloorWorld.vault?: VaultPlan` (type only) |
| `src/shared/run/endless.ts` | `endlessFloorWorld` passes `vault: layout.vault` |

Specs: new `src/shared/dungeon/vault.spec.ts` (pure; fixed draw counts per case; never entrance / pedestal / shrine /
boss / spawnless rooms; back row and far-wall preference; >= `doorFarTiles`; full BFS reachability of every floor cell
and every pellet; no new pinch (the gap rule); every room, prop, spawn, piece, loot slot, affix, pellet and boss pick
identical to a build with the vault stripped; `roomSpawnTiles` = the option-off list minus the chest cell; override
`every` keeps later draws aligned). New `src/shared/dungeon/vault.census.spec.ts` (run seeds 1-10 x floors 2-20, solo
and party 4: vault rate per band, rooms with no valid cell, Legendary share, lock split, vault rooms by theme). Must
pass unchanged: `dungeon/breakables`, `dungeon/breakableLoot`, `dungeon/pellets`, `dungeon/roomPool.lock`,
`dungeon/solidDecor`, `dungeon/endless`, `theme/decor` (the kind mirror).
Run: `npm run test:only -- dungeon/vault dungeon/endless dungeon/breakables dungeon/breakableLoot dungeon/pellets dungeon/roomPool.lock dungeon/solidDecor theme/decor`.

### TR2. Sim state and hash

| File | Change |
|---|---|
| `src/shared/sim/treasure/treasureData.ts` (new) | `TREASURE` (salt `0x4b565452`, `boostOffsets`), `VaultStatus`, `TreasureConfig`, `ENDLESS_TREASURE_CONFIG`, `CHEST_HP` 1, the pinned copies of the dungeon tier / lock tables |
| `src/shared/sim/treasure/treasure.ts` (new) | `TreasureState`, `TreasureEvents`, `createTreasureState(config, seed, players)`, `cloneTreasureState`, `clearTreasureEvents`, `treasureOnFloor(state, plan)`, `writeTreasureHash`, `treasureHashNames`, `treasureRunSummary` |
| `src/shared/sim/treasure/index.ts` (new) | barrel |
| `src/shared/sim/breakables/breakablesData.ts` | `BreakableKind.CHEST: 2` |
| `src/shared/sim/breakables/breakables.ts` | `kindIndex` over `BREAKABLE_PIECE_KINDS`; `piecesFrom` uses `CHEST_HP` for the chest; `damageBreakable` returns false for a chest before any bookkeeping; `meleeHitBreakables` / `slamBreakables` skip it (count unchanged) |
| `src/shared/sim/score/scoreData.ts` | `ScoreSource.TREASURE: 12`, `TREASURE_SCORE_SOURCE_NAMES = ["treasure"]` |
| `src/shared/sim/score/score.ts` | `addTreasureScoreSources`, `sourceName` past the pellet names, `scoreTreasure(state, base)` (combo-neutral, gated by size) |
| `src/shared/sim/step.ts` | `SimConfig.treasure`; `clearTreasureEvents` in both clears; `stepTreasure` call sites after `stepScore` (no-op stub until TR3); tick-order comments |
| `src/shared/sim/state.ts` | `SimState.treasure`; `createSimState`: after the pellets block, create + `treasureOnFloor(state, firstFloor?.vault)` + `addTreasureScoreSources`; `cloneSimState` |
| `src/shared/sim/endless.ts` | `nextFloor`: `treasureOnFloor(state, world.vault)` after `pelletsOnFloor` |
| `src/shared/sim/hashLayout.ts`, `src/shared/sim/replay.ts` | `TREASURE_SUBSYSTEM = "treasure"`, group after `pellets` in `hashLayout` and `writeHashFields` |
| `src/shared/sim/index.ts` | barrel |

Specs: new `src/shared/sim/treasure/treasure.spec.ts` (create, clone, hash values = layout group, dump names,
`treasureOnFloor`). Extend `src/shared/sim/hash.spec.ts` (group order with every port group),
`src/shared/sim/breakables/breakables.spec.ts` (chest: sword, arrow, piercing arrow stops, enemy bullet consumed, slam /
Bomber / Charger never break it, Charger stunned, no events), `src/shared/sim/score/score.spec.ts` (padding for every
subset of builds / pellets / treasure; `scoreTreasure` formula; padded sources stay 0). Must stay green with the config
absent: `sim/runFull`, `sim/determinism`, `sim/step`, `sim/score/score.replay`, `run/tutorial`, `sim/pellets`,
`sim/drops`. Run: `npm run test:only -- sim/treasure sim/hash sim/breakables sim/score sim/runFull sim/determinism sim/step run/tutorial sim/pellets sim/drops`.

### TR3. The lock

| File | Change |
|---|---|
| `src/shared/sim/treasure/stepTreasure.ts` (new) | steps 1-3, the allowance / swift helpers `vaultAllowance(present, level, config)` and `swiftTicks(par, level, config)` (pure, exported for specs) |
| `src/shared/sim/treasure/respite.ts` (new, leaf) | `treasureRespiteLevel(state)`: 0 until docs/DIFFICULTY.md's `state.respite` exists |
| `src/shared/sim/step.ts` | the real `stepTreasure` in both |

Specs: new `src/shared/sim/treasure/stepTreasure.spec.ts`: arm on engage (not on sight), UNTOUCHED crack at allowance +
1 (solo the first hit; party of 3 the third), armor and Aegis hits count, i-framed / god-mode hits don't; SWIFT crack at
exactly `E + S` and the FAST agreement (keep iff FAST > 0 at 100 %); a synthetic draft holds the countdown; one crack
only; a cracking hit on the clear tick cracks; unlock on clear including adopted children (a slime split); `missBy` /
`spare`; the Respite tables through the pure helpers at each level; floor change drops a sealed / armed vault; PERFECT
and an UNTOUCHED keep agree on 200 bot rooms solo (`src/shared/run/testing/endlessBot.ts`). Worlds: a hand-made
`EndlessFloorWorld` with a vault plan (the `sim/pellets/stepPellets.spec.ts` pattern), plus a real floor from TR1's
census. Run: `npm run test:only -- sim/treasure`.

### TR4. Opening and rewards

| File | Change |
|---|---|
| `src/shared/sim/treasure/stepTreasure.ts` | step 4 and the grants |
| `src/shared/sim/treasure/bonus.ts` (new, leaf: types only) | `takeTreasureBonusDeals(state, i)` |
| `src/shared/sim/progression/progression.ts` | export `unownedRelics(state, i)`; `stepRun` step 1: `openDraft(state, i, floorCleared, deals + takeTreasureBonusDeals(state, i))` |
| `src/shared/sim/drops/drops.ts` | `pickBoostKind(rng: RngHolder)`; `DropsEvents.fromChest: number[]` (cleared in `clearDropsEvents`, copied by clone) |
| `src/shared/sim/drops/breakLoot.ts` | nothing (`landDrop` / `lowestFreeDropSlot` reused) |

Specs: new `src/shared/sim/treasure/open.spec.ts`: opens on reach, the first living player in index order, never by the
dead; every tier's grants per player (party 1-4); relic pool exhausted -> boosts; builds absent -> relic; Legendary adds
exactly one deal with a guaranteed duo (when one is available) on the next floor, three deals after a boss floor; boosts
land at the offsets, a full ground per C1's resolution; `state.rngState`, `drops.rngState` and `killsSinceDrop`
identical to the no-vault twin run up to the first open; points and the combo-neutral formula; counters. Extend
`src/shared/sim/progression/progression.spec.ts` (no bonus = today's deals), `src/shared/sim/builds/builds.spec.ts`
(bonus deal re-deals), `src/shared/sim/drops/drops.spec.ts` (`pickBoostKind` on the drop stream unchanged).
Run: `npm run test:only -- sim/treasure sim/progression sim/builds sim/drops`.

### TR5. Worlds

| File | Change |
|---|---|
| `src/shared/run/endless.ts` | `treasure: ENDLESS_TREASURE_CONFIG` in both branches; file comment; optional `VaultOverride` through `endlessRunFloor` / `floorCache` |
| `src/shared/run/dev.ts` | `options.vault?: VaultOverride` -> the dev world's own floor cache |
| `src/client/controllers/ui/DevModeController.tsx` (or where dev runs start) | `KV_TreasureDebug` -> `VaultOverride` |
| `src/shared/daily/config.ts`, `src/shared/daily/daily.spec.ts` | `ruleset: 6` (history comment), the pin 5 -> 6 |
| `src/shared/run/testing/endlessBot.ts`, `partyBot.ts` | detour into the vault room, fight, open |
| `src/shared/run/treasureCensus.spec.ts` (new) | the `pelletsCensus.spec.ts` pattern: vaults seen / opened per floor, kept share per lock, mean tier opened |

Re-check: `run/endless`, `run/party`, `run/partyProgression`, `run/segments`, `run/validate`, `run/dev`, `run/config`,
`run/replay.bench`, `play/liveRun`, `lockstep/lockstep`. Run: `npm run test:only -- run/ daily/ play/liveRun lockstep/`, then
`npm run verify`; numbers into this doc.

### TR6. Theme

| File | Change |
|---|---|
| `src/shared/theme/treasure.ts` (new, pure data) | `TREASURE_IDS`, `TREASURE_FLOOR_ROLES`, `TREASURE_STRING_KEYS`, `TREASURE_AUDIO_IDS` |
| `src/shared/theme/treasureColors.ts` (new) | `TREASURE_COLOR_RULES`, `treasureReport`, folded into `variantColors.ts` problems |
| `src/shared/theme/contract.ts` | the `TREASURE` slot; inline IDs in `REQUIRED_ASSET_IDS`, `PORT_AUDIO_EVENTS`, the required strings function |
| `src/shared/theme/validate.ts` | `treasure.` in the known prefixes; inline unknown-ID check |
| `src/shared/theme/types.ts` | the floor roles (if C2 confirmed) |
| `src/shared/theme/placeholders.ts`, `packs/placeholder/manifest.ts`, `packs/vale/manifest.ts` | placeholder primitives, strings, colours (vale: placeholders until TR9) |
| `src/shared/view/hud/strings.ts` | `SCORE_SOURCE_KEYS` gains `TREASURE_SCORE_SOURCE_NAMES` |
| `src/shared/view/audio/cues.ts` | `SFX` ids, `SFX_PRIORITY` (jingle 73), `DUCKING_SFX`, `JINGLE_SFX`, `SFX_FALLBACK` |
| `l10n/context.json` | a context entry per new string |

Specs: new `src/shared/theme/treasure.spec.ts` (lists agree with contract; the report's numbers printed), extend
`theme/contract`, `theme/validate`, `theme/audio`, `theme/strings`, `theme/placeholders`, `view/hud/hud`,
`view/audio/audio`. Count top-level locals in `out/shared/theme/contract.luau` / `validate.luau` (both < 200). Run:
`npm run test:only -- theme/ view/hud/hud view/audio/audio`, plus `npm run test:l10n`.

### TR7. World view

| File | Change |
|---|---|
| `src/shared/view/treasure/{config,events,timeline,text,index}.ts` (new) | pure pieces (§4) |
| `src/shared/play/liveRun.ts`, `src/shared/lockstep/client.ts` | `RunView.treasure` (`TreasureFrameEvents`, collect per tick, reset per frame) |
| `src/shared/view/breakables.ts` | `isChestPiece(kind)`; `BreakableTracker` / the controller skip chest slots |
| `src/client/controllers/render/TreasureRenderController.ts` (new) | §4 |
| `src/client/controllers/render/BreakableRenderController.ts` | skip chest slots |
| `src/client/controllers/fx/ParticleController.ts` | column / ring burst kinds |
| `src/client/controllers/fx/FreezeFrameController.ts` | the pop freeze |

Specs: new `src/shared/view/treasure/*.spec.ts` (every timeline and text helper; reduced motion / particles off);
extend `view/breakables` (chest skipped), `play/liveRun` (events collected). Run: `npm run test:only -- view/treasure
view/breakables play/liveRun`, then `npm run build:place` and `npm run check:autolocalize`.

### TR8. HUD, minimap, audio

| File | Change |
|---|---|
| `src/client/ui/hud/ToastPanel.tsx` (+ its view helper) | floor-reveal and arm toasts |
| `src/client/controllers/ui/MinimapController.ts`, `src/shared/view/minimap/config.ts` | the dynamic vault marker (`vaultMarkStyle`) |
| `src/shared/view/audio/cues.ts` | the cue mapper reads `RunView.treasure` (tier pitch, jingle) |
| `src/client/controllers/audio/AudioController.ts` | pass the source |

Specs: new `src/shared/view/audio/treasureCues.spec.ts` (tier pitch, jingle priority vs `sfx.best.new` / room clears,
fallbacks); `src/shared/view/treasure/minimap.spec.ts` (colour by tier, hollow when opened, hidden until seen). Run:
`npm run test:only -- view/audio view/treasure`.

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [x] **TR0. Confirm the code assumptions.** → Done 2026-11-03: "TR0 findings" above (every row confirmed or
  corrected, two flagged conflicts C1 / C2, the implementation map).
- [x] **TR1. Dungeon.** `vaultData.ts`, `placeVault`, `BREAKABLE_PIECE_KINDS`, the chest appended last, `vault` on
  layout and world. → Verify: TR1 specs and census above. → Done 2026-11-03: "As built (TR1)" (option-gated, off
  until TR5; census numbers there).
- [x] **TR2. Sim state and hash.** `SimConfig.treasure`, `TreasureState`, create, clone, the hash group, dump names,
  `ScoreSource.TREASURE` gated, the chest's `damageBreakable` early return. → Verify: every golden fixture, the M1
  hash, the tutorial lock spec and every endless replay unchanged with the config absent; clone and hash specs. → Done
  2026-11-03: "As built (TR2)".
- [x] **TR3. The lock.** `stepTreasure` steps 1-3. → Verify: TR3 specs above. → Done 2026-11-03: "As built (TR3)"
  (UNLOCKED stays UNLOCKED until TR4).
- [x] **TR4. Opening and rewards.** Step 4, the grants, the landing offsets. (C1 answered: overflow goes to the player.) → Verify:
  TR4 specs above. → Done 2026-11-03: "As built (TR4)".
- [x] **TR5. Worlds.** `ENDLESS_TREASURE_CONFIG` on endless; the dev override and `KV_TreasureDebug`. Re-record and check
  the endless / party / partyProgression / daily / dev specs replay and validate segmented. Extend the census bot.
  `DAILY.ruleset` 5 -> 6. → Verify: `npm run verify`; numbers into this doc. → Done 2026-11-04: "As built (TR5)".
- [x] **TR6. Theme.** Assets, strings, audio IDs, fallbacks, `treasureReport`, the placeholder pack. (C2 answered: floor-only `treasure.*`
  roles if the report confirms the draft colours fail.) → Verify: contract / validator / `audio.spec.ts` / `hud.spec.ts`; Luau locals
  still under 200 on `out/`. → Done 2026-11-03: "As built (TR6)" (C2 confirmed, floor roles built; `contract.luau` /
  `validate.luau` 185 / 196).
- [x] **TR7. World view.** `TreasureRenderController`, the pure timelines, the cards, freeze and shake. → Verify:
  headless specs for every timeline and text helper; `npm run build:place`. → Done 2026-11-04: "As built (TR7)"
  (presentation only; Studio check pending, the assumptions to check first listed there).
- [x] **TR8. HUD, minimap, audio.** Toasts, the minimap mark, the cue mapper, the recap summary export. → Verify: cue
  spec (tier pitch, jingle priority, fallbacks), minimap marker spec (colour by tier, hollow when opened, hidden until
  revealed). → Done 2026-11-04: "As built (TR8)" (presentation only; Studio check pending).
- [ ] **TR9. [owner] Vale art and audio.** A chest and a cage that read at the camera (Ninja Adventure Items / Dungeon
  Modular Set, or a `scripts/art` generator like the loot glint); audition crack / unlock / open / jingle (Ninja
  Adventure `Hit & Impact`, `Bonus`, `Jingles/LevelUp*` not yet primary); `audio:lock`, `audio:build`, upload, IDs into
  `packs/vale/assetIds.ts`.
  **Chest art rendered (2026-11-04).** The owner's model "Old Chest" (SebastianSosnowski, Sketchfab, CC-BY 4.0;
  THIRD_PARTY_NOTICES.md and the Credits screen) in `art/vendor/old-chest/` (the .glb and its renders), rendered by
  `scripts/art/kit/render_kit.py` with `scripts/art/kit/old-chest.json`: closed (`kit-chest`) and open
  (`kit-chest-open`), four facings each like the wall banner (output d = NE, NW, SW, SE = the chest's front toward -Z,
  -X, +Z, +X; the SE front lit by the mirrored sun), at world scale (0.94 x 0.58 tiles, 0.58 tall), each facing's
  pivot its footprint centre (the open lid never moves it). The renderer gained a kit-level `importScale` (the model
  is in metres) and a piece-level `lid` (the box has no separate lid: copies cut at `cutZ`, welded first, the cut
  filled dark, the lid turned 110 degrees back on its rear edge, the wooden box hollowed); the atlas pipeline takes a
  per-facing `pivot: [[x, y], ...]` on world sprite sets. Vale maps `treasure.chest` / `.chestopen` to them
  (`VALE_TREASURE_ART`); TreasureRenderController now turns a sprite chest to the vault's facing (`fx`, `fz`) and caps
  the closed chest at `maxHeightTiles` 0.9 (it stands 0.84 tiles above its pivot) and the open one at
  `openMaxHeightTiles` 1.35 (1.22), so neither is shrunk. The wobble rotates image and placeholder chests only (a
  sprite view has no rotation). **Pending:** upload `kit-chest.png` / `kit-chest-open.png` (art/upload after
  `npm run art:build`) and paste their IDs into `packs/vale/assetIds.ts` (until then vale draws the placeholder box);
  the cage keeps its placeholder bars; the four sounds; the Studio check of the chest's facings on every wall.
- [x] **TR10. Docs.** This file as built, the `CLAUDE.md` decision log, `src/shared/sim/README.md` (module, tick order,
  hash group), docs/CLIENT.md (controller, debug attributes), docs/DECOR.md (the chest piece kind), docs/DAILY.md (the
  ruleset). → Verify: `npm run verify`. → Done 2026-11-04: the Documents row and decision-log entry in `CLAUDE.md`;
  the README's `treasure/` row, tick phase 9b, hash order and "Treasure rooms" section; docs/CLIENT.md's
  `TreasureRenderController` / `TreasureToastController` rows, the minimap / audio notes, `KV_TreasureDebug` /
  `KV_TreasureLabel` and a Studio pointer; docs/DECOR.md's chest piece; docs/DAILY.md's ruleset history (6); the
  "Studio check" below brought up to date. `npm run verify` (2026-11-04, this host, with TR8):
  typecheck, lint, check:assets, check:autolocalize, test:art, test:checks, test:l10n and the build clean; headless
  tests **335 suites, 4616 passed, 1 failed** (2347 s), the one failure the known host-only `dungeon/forge/forge.spec.ts`
  seedToState vectors case (fails on `main` too).
- [ ] **TR11. [owner] Playtest.** Solo and co-op 2 / 4, PC and phone: is the chest noticed from the doorway; do players
  understand the lock from the toast and plate; how often is each lock kept (target: UNTOUCHED 30-50 % solo, SWIFT
  40-60 %); does the crack read mid-fight without drowning the bullets; does the near-miss line feel like "next time"
  or "unfair"; Legendary power spike vs the boss floors. Tune `VAULT` and `TreasureConfig`.
  **Open tuning item (TR5 census):** SWIFT at `swiftParPercent` 100 was kept 30 / 30 (the sword bot clears vault rooms
  at 22-32 % of par, mean ~28 %), far above the 40-60 % target: par is tuned as FAST's bonus window, not as a target.
  A `swiftParPercent` around 30-40 would put that bot near the target; measure real players first. UNTOUCHED was kept
  8 / 25 (32 %, at the target's bottom, falling with depth). A co-op census is part of this task too (TR5's deviation).

Critical path: TR0 -> TR1 -> TR2 -> TR3 -> TR4 -> TR5. TR6 can start after TR0; TR7 and TR8 after TR3 and TR6; TR9
any time after TR6.

## Studio check

Pending (nothing here has run in Studio yet). Before step 1, TR7's "Studio-only assumptions to check first". With the
placeholder pack every vault sound is its fallback (combo break, stairwell open, relic take pitched by tier, PERFECT
jingle) until TR9 uploads the clips.

1. `KV_Debug`, `KV_TreasureDebug = "every,legendary,untouched"`, `KV_TreasureLabel` on, dev world (F2, Go) floor 2:
   once the stairwell card has faded (and the draft is closed) the toast `A vault lies on this floor` (2 s, once); the
   caged chest sparkles gold through the doorway (Legendary: bigger, twice as often); the minimap's gold square
   appears once the chest's cell is seen or its room revealed, not before.
2. Enter: `VAULT · UNTOUCHED: clear the room without a hit` (2.5 s) and the plate (one outlined pip); take a hit: the
   snap, shards in gold, the sparkle flashes white and turns red, `Rare` rises; the minimap square turns red. Clear: the
   stamp first, then (0.6 s) the rattle and the bars sink, the chest wobbles. Walk up: two jolts, the pop (solo
   freeze, shake), column, sting (+3 semitones for a Rare), the `RELIC · <name>` card and `+<points>`, then
   `So close: 1 too many hits`; the minimap mark becomes a ring.
3. `swift`: `VAULT · SWIFT: clear the room in 0:42`-style toast; the countdown on the plate turns ember at 10 s and
   pulses at 5 s; let it run out, then clear: `So close: 3.4 s over`. (A draft can't open mid-room in play, correction
   4; the freeze is covered by the TR3 spec.)
4. A kept Legendary: `UNTOUCHED kept` at the unlock, at the pop the sting (+7) with the jingle ducking the music,
   `BONUS DRAFT next floor`, `BOOSTS +1`, `Kept Legendary`; one boost hops out (no boost-drop sound); the next floor
   deals the extra round with a duo at card 0 (when one is available).
5. Bullets over the plate and the sparkle stay fully readable (both duck); the chest blocks bullets (cover) and isn't
   breakable by sword, arrows, the slam, a Bomber or a Charger (which stuns on it).
6. Co-op (2 and 4 clients): the same lock, crack and open on every client; `party hits allowed: <n>` in the arm toast
   and the party's pips; every living player's reward card; the spilled boosts per C1 (a given boost's pickup toast);
   a spectating dead player sees the watched player's cards; every client hears the crack, rattle and sting.
7. Reduced motion, Particles off, Freeze frame off, Screen shake off; touch HUD scale; 70 % HUD; the toast line fits
   the smallest phone (it wraps).
8. Risks to check first: the sparkle visible enough at the far wall of a 2x room; the open sequence on the same frame as
   a boost pickup or a combo tier-up (the floor shout slot); the reward cards' crispness; the cage art reading as
   "closed" against every biome wall; the minimap mark's red on a live (tinted) room floor.

## Decisions (all confirmed by the owner, Kaleb, 2026-11-03; each is the recommended option)

- **TRD1. A miss cracks the lock down a tier; clearing always pays.** Alternatives: a strict lock (a miss keeps the
  chest shut for good: the most tension, but it punishes young players and turns a vault into a loss), or two locks (the
  clear opens it, the condition adds a bonus item: weaker to look at, since nothing visibly drops).
- **TRD2. The vault is a combat or elite room with a caged chest**, not a separate room behind a gate. A side room
  behind a portcullis needs the Forge to make dead-end leaves and a new door collision; a good v2 if TR11 asks for a
  "proper" vault room. The existing pedestal room stays as it is.
- **TRD3. The chest is an unbreakable breakables kind**, so it gets collision, bullet blocking, render pooling and the
  floor reset for free, and stays visible through its cage (breakables don't block sight). TR0: kind index 2 in
  `BREAKABLE_PIECE_KINDS`, not in the theme-mirrored `BREAKABLE_KINDS` (correction 2). Alternative: a solid-decor piece
  (WALL cells): it blocks sight and draws as a wall on the minimap, which is wrong for a thing you should see.
- **TRD4. Locks v1: UNTOUCHED and SWIFT** (50 / 50). Both read the room record PERFECT and FAST already use, and both
  have a live readout. Rejected for v1: **combo tier held** (tiers are presentation only by Combo CD1, and the combo
  lapses on every walk) and **a key from an elite** (a carried item, who holds it in co-op, a second objective mid-fight:
  a good v2 with its own UI).
- **TRD5. Tiers use the draft's rarity names and colours** (Common / Rare / Legendary): one rarity language across the
  game. TR0: the draft's are `boon.*` and `boon.rarity.*`, not `rarity.*`; floor use pending C2. Alternative: bronze /
  silver / gold chests (familiar, but they would clash with the draft's).
- **TRD6. About 1 floor in 2** (40 % / 50 % / 55 % by band, from floor 2), at most one vault per floor, elite rooms
  weighted x2. Rare 75 % / Legendary 25 %, +1 point per floor up to 40 %.
- **TRD7. Co-op UNTOUCHED allows party size - 1 hits** (present players - 1), shown as pips. Four players taking zero
  hits is near impossible, and the PERFECT stamp keeps its own strict rule. Alternative: co-op vaults always SWIFT.
- **TRD8. Any living player opens it, for the whole party; everyone alive gets their own reward.** Contested chests
  breed grief among friends. Boosts still spill and are picked up first-touch, as everywhere (ground capacity: C1).
- **TRD9. Legendary = a bonus draft on the next floor** (the boss double-draft path), plus a boost now. It needs no
  mid-floor draft, so it never freezes the world on a teammate mid-fight. Alternative: an immediate free boon level-up.
- **TRD10. Respite eases the lock, not the tier:** +1 allowed hit from level II, +10 % par per level. Assist only;
  placement and tier stay seed-pure (daily-fair). TR0: dormant until Respite is built.
- **TRD11. `TREASURE` score uses the room bonus's multipliers except combo**, once per open (TR0: depth x curse,
  correction 5). It isn't combo-fed: the walk to the chest lapses the combo anyway, and it doesn't feed the combo (no
  farming).
- **TRD12. Open on proximity, not a button.** The pedestal and drops already teach "walk onto it". No new input bit or
  binding row.
- **TRD13. Leaderboards stay `_v1`** if nothing has launched (BLD9 / BUD9 precedent); after launch, bump `LB_Solo_v1` /
  `LB_Coop_v1`. `DAILY.ruleset` bumps either way (5 -> 6).
- **TRD14. A floor-reveal toast says a vault exists**, but not where: the minimap and the glint do the finding.
  Alternative: no toast (pure discovery, but most players would walk past the far rooms).

## Risks

- **Power creep.** Relics and bonus drafts on half the floors on top of pedestals, boosts and builds. Mitigation: the
  census in TR5 (opens per floor) and TR11's boss-floor TTK check; `chanceByBand` and the Legendary share are the levers.
- **Readability.** A sparkle, a plate and a cage in a fight room. Mitigation: all under bullets, ducking, validated
  colours (C2), the plate only in the vault room.
- **SWIFT feels unfair** if `parTicks` is tuned for a fast bonus rather than as a target (EV notes there is no
  room-time-vs-par data). Mitigation: `swiftParPercent` is a tunable; TR5's bot and TR11 measure it before the default
  is final.
- **Detours.** Players skip rooms on the way to the stairwell; a vault is bait into the hardest (elite) rooms. Intended
  risk and reward.
- **Few valid cells in store / crypt rooms.** Corner breakables and wall tombs take the wall cells a chest needs.
  Mitigation: the TR1 census reports rooms with no valid cell by theme; the elite weight and `doorFarTiles` are the
  levers.
- **Luau locals** in `contract.luau` / `validate.luau` (186 / 196): TR6 adds one top-level name (the slot) to
  `contract.luau` and none to `validate.luau`.
- **Co-op allowance gaming** (one tank takes every hit): harmless; the reward is shared.

## Out of scope

- A separate vault room behind a gate or portcullis, keys and key-carrying, mimics.
- Hearts, Ember or currency from chests; paid or Robux chests of any kind. Vault rewards come from play only.
- Chests in the tutorial, M1, boss rooms or the pedestal room.
- More than one vault per floor, chest rerolls, chests that scale with combo.
- A codex entry for vaults (a later follow-up in `claude/codex-plan.md`).
