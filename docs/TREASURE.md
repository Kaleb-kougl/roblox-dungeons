# Treasure rooms: vaults and locked chests (plan)

Some endless floors get a **vault**: a combat or elite room holds a **chest in a cage**, sparkling in its rarity colour.
You can see it through the doorway before the fight starts. Clearing the room **unlocks** it. If you meet the vault's
**lock condition** during the fight (clear it **untouched**, or clear it **swift**, under par), the chest **keeps its
full rarity**. Miss the condition and the lock **cracks**: the chest drops one rarity, on screen, on the frame it
happens. It never drops to nothing, so a miss reads as "so close", not as a loss. Walk up to the unlocked chest and it
**bursts open** with a rarity-coloured column, a sting and its reward: a relic, boosts, or a **bonus draft** on the next
floor. Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

Status (2026-11-03): **TR0 done (plan checked against the code, below). TR1 done (the dungeon roll, behind the
option `EndlessFloorOptions.vaults`, off everywhere until TR5; "As built (TR1)" below).** The owner (Kaleb)
confirmed every decision (TRD1-TRD14) on 2026-11-03. This file is the project doc `claude/treasure-rooms-plan.md` with
every "(assumed; TR0 verifies)" item checked against branch `treasure-rooms` @ `82f0ff9` (a snapshot of `main` @
`288a33b`, which already has Pellets, solid decor, room themes and the new enemies merged). Sibling plans: BO
(`claude/build-online-plan.md`), RR (`claude/run-recap-plan.md`: its optional "chests opened" highlight reads this plan's
run summary), CX (`claude/codex-plan.md`: vaults could become a codex category later).

**Sim impact: yes, this is gameplay.** It follows the opt-in pattern of boosts (docs/BOOSTS.md), breakable loot
(docs/BREAKABLE_DROPS.md) and pellets (docs/PELLETS.md):

- a pure **dungeon** roll per floor, on its own stream, decides where the vault is, which lock it has and its rarity;
- an opt-in `SimConfig.treasure`, its own `SimState.treasure` and its own **hash group appended last** (after `pellets`);
- its **own rng stream** for the draws made when a chest opens, so **no existing draw moves** on a floor where no chest
  opens (boon offers, relics, curses, kill drops, archetype rolls);
- one config-gated score source, `ScoreSource.TREASURE` (12).

Without `SimConfig.treasure` nothing changes: M1, every golden fixture and the tutorial replay exactly as before.
Endless replays and scores change (every vault floor gains a breakables slot and the run gains a hash group), so the
leaderboard rule applies (TRD13) and `DAILY.ruleset` goes 5 -> 6.

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
size x the count) and picked up first-touch, like every drop; what doesn't fit the 4 ground slots is pending owner call
C1.

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
slots (`landDrop`, `DropsEvents.fromChest`). What doesn't fit: owner call C1. `scoreTreasure(state, points[tier])` once
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
- [ ] **TR2. Sim state and hash.** `SimConfig.treasure`, `TreasureState`, create, clone, the hash group, dump names,
  `ScoreSource.TREASURE` gated, the chest's `damageBreakable` early return. → Verify: every golden fixture, the M1
  hash, the tutorial lock spec and every endless replay unchanged with the config absent; clone and hash specs.
- [ ] **TR3. The lock.** `stepTreasure` steps 1-3. → Verify: TR3 specs above.
- [ ] **TR4. Opening and rewards.** Step 4, the grants, the landing offsets. **Needs owner call C1 first.** → Verify:
  TR4 specs above.
- [ ] **TR5. Worlds.** `ENDLESS_TREASURE_CONFIG` on endless; the dev override and `KV_TreasureDebug`. Re-record and check
  the endless / party / partyProgression / daily / dev specs replay and validate segmented. Extend the census bot.
  `DAILY.ruleset` 5 -> 6. → Verify: `npm run verify`; numbers into this doc.
- [ ] **TR6. Theme.** Assets, strings, audio IDs, fallbacks, `treasureReport`, the placeholder pack. **Owner confirms C2's
  floor roles once the report prints.** → Verify: contract / validator / `audio.spec.ts` / `hud.spec.ts`; Luau locals
  still under 200 on `out/`.
- [ ] **TR7. World view.** `TreasureRenderController`, the pure timelines, the cards, freeze and shake. → Verify:
  headless specs for every timeline and text helper; `npm run build:place`.
- [ ] **TR8. HUD, minimap, audio.** Toasts, the minimap mark, the cue mapper, the recap summary export. → Verify: cue
  spec (tier pitch, jingle priority, fallbacks), minimap marker spec (colour by tier, hollow when opened, hidden until
  revealed).
- [ ] **TR9. [owner] Vale art and audio.** A chest and a cage that read at the camera (Ninja Adventure Items / Dungeon
  Modular Set, or a `scripts/art` generator like the loot glint); audition crack / unlock / open / jingle (Ninja
  Adventure `Hit & Impact`, `Bonus`, `Jingles/LevelUp*` not yet primary); `audio:lock`, `audio:build`, upload, IDs into
  `packs/vale/assetIds.ts`.
- [ ] **TR10. Docs.** This file as built, the `CLAUDE.md` decision log, `src/shared/sim/README.md` (module, tick order,
  hash group), docs/CLIENT.md (controller, debug attributes), docs/DECOR.md (the chest piece kind), docs/DAILY.md (the
  ruleset). → Verify: `npm run verify`.
- [ ] **TR11. [owner] Playtest.** Solo and co-op 2 / 4, PC and phone: is the chest noticed from the doorway; do players
  understand the lock from the toast and plate; how often is each lock kept (target: UNTOUCHED 30-50 % solo, SWIFT
  40-60 %); does the crack read mid-fight without drowning the bullets; does the near-miss line feel like "next time"
  or "unfair"; Legendary power spike vs the boss floors. Tune `VAULT` and `TreasureConfig`.

Critical path: TR0 -> TR1 -> TR2 -> TR3 -> TR4 -> TR5. TR6 can start after TR0; TR7 and TR8 after TR3 and TR6; TR9
any time after TR6.

## Studio check

1. `KV_Debug`, `KV_TreasureDebug = "every,legendary,untouched"`, dev world floor 2: the floor toast; the caged chest
   sparkles gold through the doorway; the minimap mark appears on sight.
2. Enter: the toast and plate; take a hit: snap, shards, sparkle flashes and turns red, `Rare` rises; the mark
   recolours. Clear: the stamp first, then the bars sink and the chest wobbles. Walk up: jolt, pop, column, sting, a
   relic card, `So close: 1 hit`.
3. `swift`: the countdown on the plate turns ember at 10 s and pulses at 5 s; let it run out, then clear:
   `So close: 3.4 s over`. (A draft can't open mid-room in play, correction 4; the freeze is covered by the TR3 spec.)
4. A kept Legendary: `UNTOUCHED ✓`, the jingle ducks the music, `BONUS DRAFT next floor`, one boost hops out; the next
   floor deals the extra round with a duo at card 0 (when one is available).
5. Bullets over the plate and the sparkle stay fully readable (both duck); the chest blocks bullets (cover) and isn't
   breakable by sword, arrows, the slam, a Bomber or a Charger (which stuns on it).
6. Co-op (2 and 4 clients): the same lock, crack and open on every client; party allowance pips; every living player's
   reward card; the spilled boosts per C1; a spectating dead player sees the watched player's cards.
7. Reduced motion, Particles off, Freeze frame off, Screen shake off; touch HUD scale; 70 % HUD.
8. Risks to check first: the sparkle visible enough at the far wall of a 2x room; the open sequence on the same frame as
   a boost pickup or a combo tier-up (the floor shout slot); the reward cards' crispness; the cage art reading as
   "closed" against every biome wall.

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
