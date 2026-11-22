# Silver: cross-run currency

Status (2026-11-14): **phase 1 built** (SV1-SV10, SV16-SV18, SC1-SC4; see "As built"); cosmetics (SV11-SV13) and the
owner's SV15 not started; nothing checked in Studio. Branch `silver` from `secret-rooms` @ `dc2c4a56`. SV0 read the
code and confirmed or corrected every assumption (section "SV0 findings"; the plan below is edited to match). Owner
answers (2026-11-13): **OC1** upgrades count in the Daily too (SVD3); **OC3** Silver is found in crates (SVD15, track
SC); **OC6** base hearts down by one, the Archer at 1 1/2 (SVD18); **OC7** the Archer is a Silver unlock (SVD12);
**OC8** Silver pieces twinkle exactly like boost pieces; **OC9** barrels as well as crates; **OC10** existing players
keep nothing (SVD14); **OC11** the tutorial shows 2 hearts; **OC13** prices scale exponentially (SVD22); **OC15**
prices scaled back for a young audience (the ladder doubles per tier, top 5,000); **OC16** the earn side too: Silver
per room cleared, a minimum per run, a first-run-of-the-day bonus (SVD25, SVD26). The numbers, which tier each item
sits on and every other decision are recommendations until the owner answers; SV0 added three new calls (OC18-OC20).
Numbers marked *(tune)* are starting points for the censuses, not commitments. Task prefixes **SV** (wallet, Armory,
upgrades, hearts, the Archer) and **SC** (Silver in crates), decisions **SVD**.

Goal: every run pays out **Silver**, a currency that is kept between runs (the model is Megabonk's silver: found and
earned by playing, spent in a menu shop on permanent upgrades and unlocks). In Kaleb-Vale, gold already means *this
run's score* (Goldling coins, the score panel, `ui.icon.coin` beside the score number); Silver is what you take home.
Some of it is **in the dungeon**: a few barrels and crates on every floor hold Silver, and breaking them spills it. It
is spent in a new main-menu screen, the **Armory**, on:

1. **Upgrades**: permanent, levelled, small. Characters now start **one heart lower** than today, and the first
   upgrade track, Vigor, buys it back. Phase 1.
2. **Unlocks**: **the Archer** (every account starts with the Knight only), later characters and weapon skins.
   Phase 1.
3. **Cosmetics**: outline colours, roll trails, spark colours, titles. Phase 2. The long tail.

Everything in the Armory is priced on **one exponential ladder** of eight tiers, 40 to 5,000 Silver, each tier
about double the last. The economy is sized for young players who die early: every room cleared pays, every real
run pays a minimum, and showing up each day pays a flat bonus, so progress does not depend on getting deep.

Three rules shape everything:

- **The server owns the wallet.** Silver is computed from the server's own replay of the run, never from a client
  claim, and every balance change is a transaction inside `UpdateAsync`. This is the "rewards later" hook
  docs/SERVER.md has been reserving (`onRunAccepted`; "Rewards should key on the server-issued run nonce").
- **Hearts and upgrades are character data and sim config, not sim rules.** They ride the Archer's path: the server
  reads each member's levels at run start, stores them on the `RunSession`, and they become `PlayerTraits`. The heart
  cut is two numbers in `shared/characters`. The sim's constants do not move, so M1 and every golden fixture (no
  traits) replay bit for bit with no setter.
- **Crate Silver is floor-built, like boosts in breakables** (docs/BREAKABLE_DROPS.md): the floor decides which
  pieces hold how much from its own stream; the sim draws no rng and only counts what was broken, in one small hashed
  group.

## SV0 findings

Read on `secret-rooms` @ `dc2c4a56` (2026-11-13). Each row: what the plan assumed, what the code does, and the plan
edit it caused (if any).

### The earn rows

| Row | The code | Plan edit |
|---|---|---|
| Rooms cleared | `counts[ScoreSource.ROOMS]`: `clearRoom` (sim/score score.ts) books one ROOMS award per room record that clears, run-wide (`credit` adds 1 to `counts[source]`). A record exists only for a room with members: the entrance, empty rooms and **the boss room have none** (`RoomScore` comment). A Horde room is ONE record (its second wave is appended to it; the Horde's extra half goes to `counts[HORDE]`, never ROOMS). Runtime children (slimelets, summons) are adopted into their parent's record (`adoptScoreRoomMember`), so they never add a room. A far co-op clear clears the shared record once, for the whole team | Read `counts[ROOMS]`. The boss pays its own row, never a room |
| Floors cleared | `state.endless.floor` (from 1); a dev run's `EndlessConfig.startFloor` | `floor - startFloor` (dev never pays anyway) |
| Bosses killed | `state.endless.depth` (+1 per boss kill); `shared/view/hud` recap `bossKillsOf(depth, startDepth)` already exists. `counts[BOSS]` also counts no-hit awards (`bossNoHitAwards`), so it is **not** a kill count | Read `bossKillsOf`; the k-th kill pays 40 x (startDepth + k), the Depth it reached |
| Vault chest opened | `state.treasure.opened` (run counter, treasure.ts); `counts[TREASURE]` is the same number (one `credit` per open) | Read `state.treasure.opened` |
| Secret room opened | `secretsRunSummary(state).found`. `counts[SECRET]` counts the open **and** the secret chest's treasure points (two credits per secret whose chest is taken) | Read `secretsRunSummary().found`, never `counts[SECRET]` |
| Goldling caught | `state.golden.caught` (run counter). `counts[GOLDEN]` counts every coin hit too | Read `state.golden.caught` |
| Kills | `RunSummary.kills` (sum of `events.enemiesKilled`, shared/run validate.ts) | As planned |

**`conclude` does not have the final `SimState`.** `RunSessionService.conclude` gets a `SegmentedRunResult`
(summary, `RunScore`, telemetry); the replay state lives in `SegmentedValidator` (shared/run segments.ts) and is
released in `decide()`. Solo and party runs both go through the validator (`session.validator`). So SV4 adds a reader
beside `readScore`: `decide()` computes `readSilver(state, summary)` (shared/silver `runSilver`) and the result carries
`silver?: RunSilver` (accepted runs only; rejected runs keep it undefined). The rows are a pure function of the final
state, so nothing is kept alive past `release()`.

### Hearts, armor and the flask

- **Odd maxima are safe in the sim.** Every heal clamps with `jsMin(heartsMax, ...)`: the flask (`FLASK_HEAL_HALF_HEARTS`
  2, player.ts and its mirror in lockstep predictMotion.ts), Fang (1), Lionheart (1), Stone Heart, the heart boon /
  card (+2 to max and hearts), a party revive (`PARTY_REVIVE_HALF_HEARTS` 2, clamped by `revivePartyMember`), Second
  Wind (keeps 1). Odd *current* hearts already happen today (Fang, Lionheart, Second Wind). `heartsMax` is already
  hashed; an odd value changes no layout.
- **The curse at odd maxima:** `heartsMax = max(CURSE_MIN_HEARTS_MAX 2, heartsMax - CURSE_HEART_LOSS 2)`. At the
  Archer's 3 half hearts the curse costs **half a heart** (3 -> 2), at 4 or less nothing below 2. Acceptable; the
  curse text ("lose a heart") is then slightly generous. Noted in SV16's specs, no plan change.
- **The HUD draws odd maxima as damage.** `heartFills(hearts, heartsMax)` (shared/view/hud layout.ts) draws
  `ceil(heartsMax / 2)` hearts with fills 2 / 1 / 0, and the touch strip the same count. A full Archer at 3 shows one
  full heart and one **half-filled** heart: it reads as hurt. SV16 needs a fourth fill, a half container (owner call
  OC18 for its look), in both rows and the hearts' art.
- **The tutorial's flask lesson breaks at 2 hearts.** The tutorial starts wounded at `TUTORIAL_START_HALF_HEARTS` 4
  (clamped to the max) so the flask can heal; the flask needs `hearts < heartsMax`. With the Knight at 4 half hearts the
  start is full and the lesson cannot heal. SV16 lowers it to 2 (one heart; owner call OC19). The tutorial already
  builds the Knight's traits (`TUTORIAL_CHARACTER`, shared/run tutorial.ts), so the heart cut reaches it with no new
  plumbing.
- **Armor and flask maxima** are `armorMax` / `flaskMax` on each player (`START_ARMOR_MAX` 0, `FLASK_CHARGES` 3), read
  by `respawnPlayer`, `refillAtCheckpoint`, boons / curses / cards and the HUD. Plating and Deep Flask set them once in
  `createSimState` beside the hearts (the same loop as `playerStartHalfHearts`). `predictMotion.ts` copies
  `heartsMax` and the flask for the flask's slowdown only; no mirror change.
- **The unranked fallback keeps the picked character.** A refused or unanswered `startRun` plays unranked with
  `SimController.runCharacter`. A `locked_character` refusal would today fall back to **playing the locked Archer
  unranked**. SV17 / SV18: on `locked_character` the client resets the pick to the Knight and starts as the Knight;
  `makeRun` never builds a character the wallet does not own (an unknown wallet: the Knight).

### Server plumbing

- **Lobbies.** `Lobbies.setReady(userId, ready, characterId)` (shared/lobby lobbies.ts) is pure and sees no wallet;
  the countdown's end (`tick`) re-checks members through its ctx (the `busy` check). SV17 adds an ownership predicate
  to `setReady` (refuse `lockedCharacter`) and to the tick ctx (a member who no longer owns their pick cancels the
  countdown with a reason). The party start (RunSessionService, `start.characters`) reads each member's levels from
  WalletService into `StartContext.upgrades`.
- **The UTC day.** shared/daily `dailyDay(unixSeconds)` (day 0 = 2026-01-01, rolls at UTC midnight). The first-run
  bonus uses `dailyDay(os.time())` at the grant; the Daily bonus uses `session.daily.day`, the day the run **started**
  (the day of its board, DSD5), so a Daily started before midnight pays that day's bonus.
- **Economy events.** `AnalyticsService:LogEconomyEvent(player, flowType, currencyType, amount, endingBalance,
  transactionType, itemSku, customFields)`: server only, published places only, `amount` positive, `endingBalance`
  >= 0, at most 5 currency types per experience, item SKUs past about 100 grouped as "Other"; rejected events log and do
  not throw. Nothing logs economy events today. SV10: one Source event per non-zero row of a grant (itemSku = the
  row's name, transactionType `Gameplay` for run rows, `TimedReward` for the day bonuses), one Sink per purchase
  (itemSku = catalogue id, transactionType `Shop`). Silver is 1 of the 5 currency types.
- **The score panel has no room in its label row.** ScorePanel is five rows in 158 of `HUD_FOOTPRINT.score`'s 160 px;
  row 1 is `BestTargetRow` (the `SCORE` label and points-to-best), and the score number already wears the gold coin.
  The Silver counter goes on **row 5, the floor and Depth line** (endless only, where Silver is earned), left of the
  text, in the `silver` role with its own icon, which must not read as the coin (SV8 fit spec on the smallest phone).
- **The room-clear tally is score.** Its segments (Kills / Clear / No hits / Speed, pellets, sweep, horde) are points
  that sum to its `total`, and the full four-segment row already sits at `ROOM_CLEAR_UI.tallyFit.minText` (the pellet
  segment folds on the smallest phone). A `+2` Silver segment would mix units and force folds. **Plan edit (OC20):** a
  room clear ticks the Silver counter with a small `+2` at the counter, not a tally line.

### Silver in crates (SC)

- **The break line.** `damageBreakable` (sim/breakables breakables.ts): inert pieces (the chest, a cracked wall) return
  before any bookkeeping; the Goldling's piece refuses enemy sources (`goldenGuardsPiece`); at the break, player
  sources score (`scoreBreakable`) and release a hiding Goldling (`goldenOnBreak`), then **every source** releases loot
  (`dropsOnBreak`), then an owned break procs builds (`buildsOnPieceBroken`). `silverOnBreak` goes right after
  `dropsOnBreak` (any source, a leaf). Slams, rolls, Chargers and Wrecker chains all reach this line.
- **Placement order (plan edit).** `placeFloorParts` (shared/dungeon endless.ts) holds affixes, loot, pellets, the vault,
  pact altars and the Goldling, and a floor modifier re-runs it from its placer on; `placeSecret` runs once **outside**
  it, after the modifier. Silver reads the final loot (a Plunder floor's) and the Goldling's piece, and no modifier's
  eligibility reads Silver, so `placeBreakableSilver` runs **once, after `placeSecret`**, on the final parts, never
  inside `placeFloorParts`. Candidates are the clutter pieces only (`BREAKABLE_KINDS`, slots before the Goldling's and
  the secret's appended pieces).
- **Pieces per floor at `roomScale` 2** (docs/BREAKABLE_DROPS.md BL0 census): kept (floor 1-4) 22.0 pieces in 6.3
  rooms; worn (5-9) 42.0 in 9.6; ruined (10-14) 70.1 in 10.7; abyss (15+) 107.5 in 11.6. Loot takes 1.0 / 1.5 / 2.1 /
  2.1 of them. The Silver counts use the same four bands: **2-3 / 3-4 / 3-5 / 3-5** *(tune)*, at most 2 per room;
  every band has the rooms for its max.
- **The twinkle.** `pieceGlints(state, slot)` (shared/view breakableLoot.ts) = a loot slot or the Goldling's hiding
  piece; `glintSlotCount` scans slots 0 .. max(loot table, the Goldling's piece + 1). SC3 adds Silver to both.
- **The stage manifest.** shared/run stageInput.ts sets the `breakableLoot` feature from `layout.breakableLoot` being
  non-empty, which loads the glint ids (`decor.fx.glint`, `decor.fx.loot`, stageAssetsConfig.ts); the forecast has every
  feature on. SC3 sets the feature when `breakableSilver` is non-empty too, so a floor with Silver and no loot still
  loads the glint.
- **Hash pins that will move with the `silver` group:** literal endless pins are few: sim/charger.spec `PIN_HASH`
  (run 4 floor 3) and sim/stormcaller.spec's run 4 floor 3; the other run / play specs compare two builds' hashes
  rather than pinning them. SC2 lists every one it re-records. The heart cut (SV16) moves the character-built specs:
  characters/archerHearts, characters/characters, run/characterRuns, run/tutorial and the tutorial's funnel rows.
- **`DAILY.ruleset` is 19** (secret rooms took it).

## Owner calls

| # | Question | Answer / recommended | Alternative |
|---|---|---|---|
| OC1 | Do upgrades count on the leaderboards? | **Answered: yes, everywhere.** Endless solo, co-op and the Daily (SVD3) | |
| OC2 | May Silver buy offence (damage, attack speed)? | **Not in v1** (SVD4). The tail is cosmetics and unlocks, not more power | A small Might track on the upper tiers; it moves boss kill times and every score table |
| OC3 | Is Silver something you find in the dungeon? | **Answered: yes, in crates.** Track SC, SVD15 | |
| OC4 | Name | **Silver** / the **Armory** | Marks, Sigils; "Shop" |
| OC5 | Do veterans start with some Silver? | **Assumed no** (follows OC10): every wallet starts at 0 | A one-time grant from `KV_Records_v1` |
| OC6 | Base hearts down by one? | **Answered: yes.** Knight 3 -> 2 hearts, Archer 2 -> 1 1/2 (SVD18) | |
| OC7 | The Archer behind a Silver unlock? | **Answered: yes.** Tier 4, 300 *(tune)* (SVD12) | Tier 3, 150, if she should arrive in the first session |
| OC8 | Do Silver crates show before they are broken? | **Answered: the same twinkle as boost crates** | |
| OC9 | Which pieces hold Silver? | **Answered: barrels too.** Crates 2 : 1 *(tune)* | |
| OC10 | What do existing players keep? | **Answered: nothing** (SVD14) | |
| OC11 | Does the tutorial show 2 hearts? | **Answered: yes** | |
| OC12 | Tell returning players what changed? | **Yes:** a one-time main-menu card for accounts that played before the update | Nothing |
| OC13 | How do prices grow? | **Answered: exponentially** (SVD22) | |
| OC14 | Does the top of the ladder hold any power? | **No:** tiers 6-8 are later characters and prestige cosmetics (SVD23) | Extra Vigor / Flask levels at tiers 6-8 |
| OC15 | Are the prices right for children, who die early? | **Answered: scaled back.** x2 a tier: 40, 80, 150, 300, 600, 1,200, 2,500, 5,000 | |
| OC16 | Should weak players also earn more? | **Answered: yes.** +2 per room cleared, at least 20 per run that cleared 2 rooms, +50 for the first paying run of each UTC day *(tune)* (SVD25) | |
| OC17 | The Daily's own bonus, now that there is a first-run bonus | **+50** (was +100), so a day's flat income is 100 when the Daily is played | Keep +100 (150 a day flat) |
| OC18 | How does a half-heart container look (an odd heart max, SV0)? | **A half heart in the empty heart's outline**, its right half missing (not the half-*filled* heart, which means hurt). **Art made (2026-11-13):** `scripts/art/gen-heart-halfmax.js` cuts the UI sheet's own `ui.heart.full` / `ui.heart.empty` at their centre and closes the cut in each heart's edge colour: `ui.heart.halfmax` (holding its half) and `ui.heart.halfmax.empty`, 18 x 15 like the hearts, into gitignored `art/vendor/kaleb-vale/heart-icons/` (run by `art:build` / `art:lock`; `--contact` writes a review sheet). Not packed or uploaded yet: SV16 gives them a sheet of their own and theme ids | A full container with a "1/2" pip |
| OC19 | The tutorial's wounded start at 2 hearts (SV0) | **1 heart** (`TUTORIAL_START_HALF_HEARTS` 4 -> 2), so the flask lesson still heals | Start full and drop the flask lesson's heal check |
| OC20 | Where a room clear's +2 shows (SV0) | **On the Silver counter** (a small `+2`), not as a tally segment (the tally is score and already at its minimum text size) | A second, Silver-coloured tally row |
| OC21 | The SV1 census: the fastest two-room run pays about 3,350 Silver an hour against about 990 for normal play (fact 9's guard fails) | **Answered (owner, 2026-11-13): fine as is.** No cap, `minimumRooms` stays 2. (The review adds: a ranked restart, R, forfeits as a death, so the loop is clear two rooms, press R; `RUN_START_RATE` does not slow it.) | A soft daily cap on top-ups, `minimumRooms` 3+, a minimum run length |
| OC22 | The SV1 census: floor-1-2 and floor-3 runs pay 24-29 % under the targets (a weak player's day about 196, not 250) | **Answered (owner): fine as is.** `roomPay` stays 2 | More room pay |
| OC23 | The SC4 census: a bot that never detours breaks 3 % of Silver pieces, so crates are 2.5 % of its run amount (target 25-40 %; 27-32 % if half the pieces are broken) | **Answered (owner): fine as is.** Players go for the twinkle; placement unchanged | Silver pieces nearer the fights |

## What already exists (and is reused)

| Piece | Today | Where |
|---|---|---|
| Server-issued runs | `startRun` -> the SERVER picks the seed and builds the world; segments replayed live; `finishRun` -> `RunFinishVerdict` with the server's own summary, score and floor. Party runs: the server replays its own merged log through the same `SegmentedValidator` | RunSessionService, shared/run runSessions.ts / segments.ts, docs/SERVER.md "Segmented runs" |
| The final replayed state | Only inside `SegmentedValidator.decide()` (`readScore(state)`, `summarizeRun`), released right after; `conclude` sees `SegmentedRunResult` | shared/run segments.ts |
| Per-recipient verdict extras | `RunFinishVerdict.records` / `.daily`, filled per member in `conclude` (`forRecipient`); credited members = `partyContributors` | RunSessionService.conclude, RecordsService.applyRun |
| Characters | `CHARACTERS` (append-only): Knight `NEUTRAL_TRAITS`, Archer `heartsMaxDelta` -2, roll 140 % / i-frames 125 %. `StartRunRequest.characterId`, `Lobby.characters` with the Ready, `RunSession.characters`, `PartyRunStart.characters` -> `SimConfig.traits` / `PartyConfig.traits[i]` (shared/run characters.ts `withCharacters`). M1 worlds, the legacy `validateRun` path and every fixture use no traits. The pick persists as `DisplaySettings.character` | shared/characters, shared/run, docs/ARCHER.md |
| Hearts | `START_HALF_HEARTS` 6; `playerStartHalfHearts(traits)` = 6 + delta, at least 1; applied per player in `createSimState`; every heal clamps to the max | sim playerData.ts, state.ts, `archerHearts.spec` |
| Other levers | `START_ARMOR_MAX` 0 ("until gear adds it"); `FLASK_CHARGES` 3; per-player `armorMax` / `flaskMax`; `refillAtCheckpoint`, `respawnPlayer` | sim playerData.ts, player.ts |
| What a run did, in hashed state | `state.endless.floor` / `.depth`, `state.score.counts[ROOMS]`, `state.treasure.opened`, `state.golden.caught`, `secretsRunSummary(state).found`; `bossKillsOf` | sim/score, sim/treasure, sim/golden, sim/secrets, shared/view/hud recap.ts |
| Breakables | Barrels and crates on endless floors (`placeBreakables`), `state.breakables`; they break under player bullets, swings, Wrecker rolls, enemy bullets, slams, a Charger; inert pieces, the Goldling's piece and the secret's pieces are appended after them | shared/dungeon, sim/breakables |
| Boosts in breakables (the pattern SC copies) | `placeBreakableLoot`: per floor, own stream, crates 2 : 1; the leaf hook `dropsOnBreak` on `damageBreakable`'s break line, **any source** | docs/BREAKABLE_DROPS.md |
| The loot twinkle | `pieceGlints` / `glintSlotCount`, the glint renderer with `decor.fx.loot`; the stage feature `breakableLoot` loads it | shared/view breakableLoot.ts, shared/run stageInput.ts |
| Floor build order | `buildEndlessFloor` -> breakables -> `placeFloorParts` (affixes, loot, pellets, vault, pact altars, Goldling; re-run by a modifier) -> the Goldling's piece -> `placeSecret` (last) | shared/dungeon endless.ts |
| The UTC day | `dailyDay(unixSeconds)`; a Daily session's `daily.day` | shared/daily day.ts |
| Fly-to-HUD and pops | The power pellet's fly-in, pops that duck near bullets, the room-clear tally (`RoomClearEvents`) | shared/view, client fx |
| Player docs | `PlayerDocCache`, `MergeKeyValue`, delta writes for the daily ledger, Studio fakes; the onboarding doc's `at` / `firstDay`, its `seen` list | server/services/data, shared/records, shared/onboarding |
| Run-over panel, menu, character screen | Recap rows, `MenuScreen` union, `MenuButton` `badge`, focus scopes, the character screen before every run | client/ui, shared/view |
| Telemetry | `analyticsCatalog` budget spec; the new-player window (first 3 runs, return within 7 days); no economy events yet | shared/onboarding, TelemetryService |

Facts that constrain the design:

1. **A balance cannot be max-merged.** Every wallet change is its own `UpdateAsync` transaction (SVD5).
2. **`predictMotion.ts` mirrors the player's motion.** Nothing here touches motion (it copies `heartsMax` and the
   flask for the flask's slowdown only).
3. **`PORT_AUDIO_EVENTS` and `REQUIRED_STRING_KEYS` have pinned tails** (`codex.spec` and the listed skips);
   `contract.luau` / `validate.luau` are at 187 / 197 of Luau's 200 top-level locals. New keys go in their own
   module, built inside a function.
4. **The fallback run path earns nothing** and applies no upgrades (unranked, local seed), and it must never build a
   locked character (SV0).
5. **A new hash group changes every endless hash.** Crate Silver adds `state.silver`; pins that cover endless states
   are re-recorded. Layouts, spawns and scores do not move.
6. **The heart cut changes every character run.** Endless, daily, dev and tutorial replays change; M1 and the
   fixtures do not (no traits). The Archer survival census and the tables built on 3 hearts are re-measured.
7. **Odd heart maxima are new as maxima.** The Archer at 3 half hearts and Vigor I at 5: the sim's heals all clamp
   (SV0), but the HUD draws a full odd max as a half-filled heart, and the curse costs only half a heart at 3. SV16
   adds the half container (OC18).
8. **Much of the audience is young and dies early.** The economy is sized for a player who rarely leaves floor 2.
   Room pay, the run minimum and the day bonus are flat, so they are most of a weak player's income and a small
   part of a strong one's.
9. **A per-run minimum is the first thing a farmer tries.** The fastest valid run must never beat real play per
   hour (SVD25's two-room rule; SV1 measures it).
10. **The verdict has no state.** Silver's rows are read inside the validator's final check and carried on the result
    (SV0).
11. **The HUD is full where the plan first put things.** The score panel's label row and the room-clear tally have no
    room (SV0): the counter goes on the floor / Depth line, room clears tick the counter.

## Player experience (target)

### The price ladder

| Tier | Price | For a player who dies on floor 1-2 *(tune, SV1)* | What sits here |
|---|---|---|---|
| 1 | 40 | the first run | Vigor I |
| 2 | 80 | the same day | Prospector I, the first colours |
| 3 | 150 | the first or second day | Vigor II, Deep Flask I, Prospector II |
| 4 | 300 | two or three days | **the Archer**, Prospector III |
| 5 | 600 | most of a week | Deep Flask II, Plating, Prospector IV |
| 6 | 1,200 | a week or two | the next character (later), rare colours and trails |
| 7 | 2,500 | two or three weeks | prestige sparks and titles |
| 8 | 5,000 | a month or more | the last title |

("A day" here is three short runs and the day bonus: about 250 Silver.)

- Each tier costs about twice the one before (`ARMORY_TIERS`, one table; an item names its tier, never a raw
  price). Within a track every level sits at least one tier above the last.
- **The first session:** Vigor I after run one (the first-run bonus alone covers it), a tier 2 item after run two,
  Vigor II (the Knight's third heart back) by about run four, even for a player who never leaves floor 2.
- **The long game:** the whole power tree is tiers 1-5 (about 3,000 Silver). Past that the ladder holds only
  unlocks and cosmetics (OC14), each twice as dear as the last.
- The Armory sorts each tab by tier and always marks the **next affordable** item and the one after it
  (`180 to go`). Items two or more tiers above the dearest thing owned show their price dimmed.

### Hearts and Vigor

| | Today | After the update | Vigor I (40) | Vigor II (150) |
|---|---|---|---|---|
| Knight | 3 | **2** | 2 1/2 | 3 |
| Archer | 2 | **1 1/2** | 2 | 2 1/2 |

- Everyone starts as the Knight with 2 hearts, in the tutorial too (which starts wounded at 1 heart, OC19).
- A half heart of maximum draws as a half container (OC18), never as a half-filled heart.
- Fully upgraded, the Knight is back at today's 3 hearts and the Archer is half a heart above today's 2, so today's
  tuning stays the reference for upgraded players.
- **Existing players get no head start** (OC10). A one-time card tells them what changed (OC12).

### The Archer unlock

- The character screen shows the Archer's card locked: her art dimmed, `Unlock 300` and the Silver balance. With
  enough Silver the button buys her in place (a 0.4 s hold), the card lights with `sfx.shop.buy`, and she can be
  picked at once. Too poor: `Need 140 more`.
- The same card is in the Armory's **Unlocks** tab.
- In a lobby a player who does not own her cannot Ready as her; the pick falls back to the Knight.
- The server decides: `startRun` and the lobby Ready check ownership against the wallet. A stored
  `DisplaySettings.character` of a character you do not own reads as the Knight, and so does the unranked fallback.
- If the wallet could not be loaded this session, only the Knight is offered (`Characters unavailable`).

### Silver in crates

- On every endless floor from floor 1, a few barrels and crates hold Silver (2-3 / 3-4 / 3-5 / 3-5 pieces in the
  kept / worn / ruined / abyss bands *(tune)*), each a small stack fixed when the floor is built (4-8 at floor 1, rising
  with the floor *(tune)*). Crates are twice as likely as barrels.
- **They twinkle exactly like boost pieces** (OC8). A twinkling piece holds a boost, Silver, or the Goldling.
- **Any break pays** (the loot rule), enemy bullets, slams and Chargers included. Nothing to walk over.
- On the break: silver coins hop once and fly to the Silver counter; `+6` rises from the piece; a coin clink
  (`sfx.silver.crate`) climbing a step for quick successive breaks. Reduced motion: the pop and the counter only.
- **Co-op:** crate Silver is the team's (SVD6).
- A piece holds a boost **or** Silver, never both; the vault chest, the cracked wall and the Goldling's own piece
  never hold Silver.

### Earning (the whole picture)

- **In the run:** a small Silver counter on the score panel's floor / Depth line (row 5, endless only). It ticks `+2`
  on **every room clear** (a small `+2` at the counter, OC20), for crates, and for a floor cleared, a boss, a vault
  chest, a secret room and a caught Goldling, each with a `+N` pop.
- **Run over:** recap rows after the score rows: `Silver +46`, counting up; then, when they apply, `First run
  today +50`, `Daily bonus +50`, and `Topped up to 20` for a short run; then `Total 310` and, when something is in
  reach, `Vigor II: 66 to go`. In a party run every credited member gets the **team's** run amount plus their own
  bonuses. Before the verdict the rows show the client's own figures dimmed; a rejected or unranked run shows `No
  Silver: unranked run`.
- **The run minimum:** a paying run that cleared at least 2 rooms is topped up to 20. A run that cleared fewer is
  paid what it earned.
- **First run of the day:** each player's first paying run of a UTC day adds 50, in any world, solo or co-op (the day
  at the grant).
- **Daily:** each player's first accepted Daily finish of a UTC day adds 50 (OC17), the day the Daily run started (its
  board's). It stacks with the first-run bonus.
- **What never pays:** the tutorial, M1, `dev`, debug runs, Studio (unless faked), unranked fallback runs, rejected /
  desynced / expired runs. Private servers and abandoned-but-validated runs pay (same as records, NBD4).

Earn table (*(tune)* in SV1). The run rows are a pure function of the replayed state (read in the validator's final
check, fact 10); the last four are applied by the server at the grant:

| Source | Silver | Read from |
|---|---|---|
| **Each room cleared** | 2 | `state.score.counts[ROOMS]` (records with members; never the boss room) |
| Barrels and crates broken | the pieces' stacks | `state.silver.total` |
| Each floor cleared (descending from floor n) | 5 + n | `state.endless.floor` - the start floor |
| Each boss killed | 40 x the Depth it reached | `bossKillsOf(depth, startDepth)` |
| Vault chest opened | 15 | `state.treasure.opened` |
| Secret room opened | 25 | `secretsRunSummary(state).found` (not `counts[SECRET]`) |
| Goldling caught | 30 | `state.golden.caught` |
| Kills | 1 per 10 | `RunSummary.kills` |
| **Run minimum** | topped up to 20 if 2+ rooms were cleared | the run rows' sum |
| Prospector upgrade | +5 % a level on the run amount (not on bonuses; shown exactly) | wallet |
| **First run of the day** | +50, once per player per UTC day | wallet `runDay` vs `dailyDay(os.time())` |
| **Daily bonus** | +50, once per player per UTC day | wallet `dailyDay` vs `session.daily.day` |

Targets the census must hit **at 2 hearts** (run amount, before bonuses): a first-ever run that clears two rooms
pays 20 or more, which with the first-run bonus always buys tier 1; a floor-1-2 death about 45; floor 3 about 75;
floor 5 with its boss about 160; floor 10 about 500. A weak player's day (three short runs) is about 250 with the
bonuses; a strong player's (three floor-10 runs) about 1,600. Crates are between a quarter and 40 % of the run
amount. Nothing pays for time, and the fastest two-room run pays less per hour than playing on (fact 9).

### The Armory (main menu)

- A **Silver** readout on the main menu and an **Armory** button after Codex, with a badge dot when something new is
  affordable. Three tabs (LB / RB, Q / E): **Upgrades**, **Unlocks**, **Cosmetics**.

```
 ARMORY                                                          Silver 460
 [ Upgrades ] [ Unlocks ] [ Cosmetics ]
 +-----------------------------------------+  +------------------------------+
 | Vigor        [#][#]      full           |  |  DEEP FLASK  II      Tier 5  |
 | Deep Flask   [#][ ]      +1 charge      |  |  +1 flask charge (4 -> 5).   |
 | Prospector   [#][#][ ][ ] +5 % Silver   |  |  Endless, co-op and Daily.   |
 | Plating      [ ]         armor pip      |  |  600   (140 to go)           |
 +-----------------------------------------+  |  [ Buy ]                     |
                                              +------------------------------+
```

- Buying: a 0.4 s hold (no confirm dialog below tier 6; tiers 6-8 ask once, `Spend 2,500 Silver?`), the server
  answers, the pip fills with `sfx.shop.buy`. Wallet not loaded: `Armory unavailable`, greyed, like the Codex.
- Every upgrade states its exact numbers now and at the next level, per character (`Knight 2 1/2 -> 3`).
- The main menu shows `First run today: +50` under the balance until it has been claimed.
- The character screen lists the upgrades that will apply under each card.

### Catalogue v1 (power and the Archer: tiers 1-5)

| Item | Levels | Effect | Tiers (price) | Lever |
|---|---|---|---|---|
| **Vigor** | 2 | +1 half heart max and start, per level | 1 / 3 (40 / 150) | `heartsMaxDelta` (summed with the character's) |
| **Deep Flask** | 2 | +1 flask charge per level | 3 / 5 (150 / 600) | new trait `flaskChargesDelta` (sets `flaskMax` / `flask` in `createSimState`) |
| **Plating** | 1 | Start with 1 armor pip (max 1), refilled at checkpoints | 5 (600) | new trait `armorMaxDelta` (sets `armorMax` / `armor` in `createSimState`) |
| **Prospector** | 4 | +5 % Silver per level on run amounts | 2 / 3 / 4 / 5 (80 / 150 / 300 / 600) | none (server) |
| **The Archer** (unlock) | 1 | The bow character | 4 (300) | ownership check at run start |

Total 2,970 Silver. Deliberately absent: damage, attack speed, move speed, roll changes, draft rerolls.

### Cosmetics (phase 2, colour-only first: tiers 2-8)

| Slot | Items | How it draws | Tiers |
|---|---|---|---|
| Outline colour | 8 colours | Overrides `playerOutline` for that player; each must pass `playerOutlineReport`'s rules in a spec | 2, 2, 3, 3, 4, 4, 5, 6 |
| Roll trail | 6 colours | Tints the afterimage ghosts | 3, 3, 4, 5, 6, 7 |
| Spark colour | 5 colours | Graze / parry sparks' player tint, validated like `nearMissReport` | 4, 5, 6, 6, 7 |
| Title | 6 titles | A line under the name in lobbies and the run-over party tab | 4, 5, 6, 7, 7, 8 |

About 26,000 Silver in all: the long tail. Equipped per slot, stored in the wallet doc, sent to teammates with the
run start (unhashed, presentation only). Later characters enter at tier 6, then 8.

## Hearts (characters)

- `shared/characters`: `KNIGHT_HEARTS_MAX_DELTA` -2 (the Knight's traits stop being `NEUTRAL_TRAITS`) and
  `ARCHER_HEARTS_MAX_DELTA` -2 -> -3. `START_HALF_HEARTS` stays 6: what a run without traits gets, so M1 worlds and
  every golden fixture are untouched and need no `set...(WEB_...)` call.
- `upgradeTraits(character, levels)` adds Vigor's half hearts to the character's delta.
- The tutorial already builds the Knight's traits (`TUTORIAL_CHARACTER`), so it shows 2 hearts (OC11) with no new
  plumbing; `TUTORIAL_START_HALF_HEARTS` 4 -> 2 keeps the flask lesson's heal (OC19). Its harmless mode means no lesson
  gets harder. Its replays and the pinned funnel rows are re-recorded.
- HUD: `heartFills` and the touch strip gain a half-container fill for an odd maximum (OC18), with its art.
- Re-measure: the Archer survival census, the endless bots' depth by floor, the new-player window after launch.
- `DAILY.ruleset` + 1 on this commit. All-time boards stay `_v1`.

## The Archer unlock (server)

- Catalogue row `character.archer` (kind `unlock`, tier 4). `ownsCharacter(wallet, id)`: the Knight always; others
  by `own`.
- `RunSessionRegistry.start`: a `characterId` the owner does not own is refused (`locked_character`, a new
  `StartRunRejectCode`); the client then resets its pick and starts as the Knight (never the unranked fallback as the
  Archer, SV0). Lobby Ready: an ownership predicate on `Lobbies.setReady` (refusal `lockedCharacter`); the countdown's
  end re-checks through the tick ctx and cancels with a reason; a party start re-checks (a wallet can turn unknown).
- Unknown wallet: the Knight only, for that session.
- **No grandfathering** (OC10): a new wallet is empty for everyone.
- Everything bow-only (boons, relics, the Codex's entries) is unchanged. Leaderboard entries posted as the Archer
  stay as they are.

## Silver in crates (dungeon and sim)

- **Floor-built.** shared/dungeon `placeBreakableSilver`, its own stream `floorSeed ^ BREAKABLE_SILVER.salt`, runs
  **once, last** in `buildEndlessFloor`, after `placeSecret`, on the final parts (a modifier's loot included; never
  inside `placeFloorParts`, SV0). Candidates: intact clutter pieces (`BREAKABLE_KINDS`: barrels and crates, the slots
  before the Goldling's and the secret's appended pieces) that hold no boost; never an inert piece. Draws: the count
  for the band (kept / worn / ruined / abyss), then per piece a weighted pick (crates 2 : 1, at most 2 per room) and its
  stack. Stored as `EndlessFloorLayout.breakableSilver` / `EndlessFloorWorld.breakableSilver` (`{ slot, amount }[]`).
  It adds no piece and takes no cell, so every earlier output, digest, slot and `roomSpawnTiles` is unchanged.
- **Sim.** Opt-in `SimConfig.silver` (`ENDLESS_SILVER_CONFIG`; endless solo / co-op, the Daily, dev, the server's
  registry and validator; never M1 or the tutorial) creates `state.silver` `{ total, pieces: number[] }`, hashed as
  the `silver` group appended **LAST** (after `secrets`). No rng. A leaf hook `silverOnBreak` on `damageBreakable`'s
  break line, right after `dropsOnBreak` (any source): adds the slot's amount to `total`, zeroes the slot, pushes an
  unhashed per-tick event (`events.silver`: slot, x, z, amount). `total` carries across floors; `pieces` is refilled
  where loot is (`createSimState`, `nextFloor`). No score source.
- **Twinkle.** `pieceGlints` and `glintSlotCount` gain the intact Silver pieces, drawn by the existing glint renderer
  with the existing `decor.fx.loot` art: no new art, role or theme id. The stage feature `breakableLoot` is also set by
  a non-empty `breakableSilver`, so a floor with Silver but no loot loads the glint.
- **Payout.** `runSilver` reads `state.silver.total` as a row. Room pay needs no sim change: it reads
  `counts[ROOMS]`, which every scored endless run already has.
- **Floor modifiers.** Plunder keeps its pieces; Silver takes what is left.
- **Debug.** `KV_SilverDebug` (dev world: `every`), `KV_SilverLabel` (labels on Silver pieces).
- **Changes.** Endless, daily and dev replays and hashes change; layouts, spawns and scores do not; `DAILY.ruleset`
  + 1.

## Wallet (server)

- DataStore `KV_Wallet_v1`, key `u_<UserId>`:
  `{ v: 1, earned, spent, own: { [itemId]: level }, eq?: { [slot]: itemId }, runs: string[], runDay?, dailyDay? }`.
  Balance = `earned - spent` (never stored). `runs` = a ring of the last 64 granted run ids. `runDay` / `dailyDay`
  = the UTC day number (shared/daily `dailyDay`) of the last first-run bonus / Daily bonus. Decoding never throws; a
  missing doc is an empty wallet.
- **Silver shop fields (docs/SILVER_SHOP.md SH1, 2026-11-14):** optional `bought` (Silver bought with Robux) and
  `receipts` (the last 128 granted `PurchaseId`s), and every unknown top-level field is kept and written back (so an
  older server never erases a newer one's fields). Balance = `earned + bought - spent`; `earned` still means play.
- **Every change is a transaction** (`WalletTransactions`, an `UpdateAsync` wrapper beside `MergeKeyValue`); the
  transform re-reads the stored doc, so concurrent servers compose:
  - `grant(runId, run, ctx)`: cancels if `runId` is in `runs`. Otherwise, **inside the transform** (`applyGrant`,
    pure): the run amount (topped up to the minimum when it qualifies) x Prospector from the STORED levels; `+50` if
    the stored `runDay` is before `ctx.day` (`dailyDay(os.time())` at the grant), then `runDay = ctx.day`; `+50` if the
    run is a Daily finish and the stored `dailyDay` is before `ctx.dailyDay` (`session.daily.day`), then set it;
    `earned += total`, push the id. So a bonus is paid once per day even with two servers, and never lost to a stale
    session copy. Returns the breakdown.
  - `buy(itemId)`: checks against the STORED doc that the item exists, the next level exists, prerequisites hold and
    `earned - spent >= price`; then `spent += price`, level + 1. Otherwise cancels with a reason. The price is the
    item's tier in the SERVER's `ARMORY_TIERS`; the client never sends one.
  - `equip(slot, itemId | none)`: owned check, then set.
  The session cache is only a **read copy**, replaced by each transaction's result; it is never saved.
- **The run's rows.** `SegmentedRunResult.silver` (from the validator's final check, fact 10); `conclude` grants from
  it for every credited member.
- **The verdict's figure.** `RunFinishVerdict.silver` carries the run amount and the bonuses predicted from the
  session copy, so `runFinished` is not held for the write (records' rule). The `wallet` push after the transaction
  carries the real breakdown; the recap row settles on it (it differs only if another server claimed the day's
  bonus first).
- **Failure rule:** a failed join load sends `{ loaded: false }`: the Armory is greyed, runs start as the Knight with
  no upgrades (the run-start reply says so), but grants still land, bonuses included: the transform reads the
  stored doc, not the session's.
- **Remotes:** server -> client `wallet(WalletStatus)` (with whether today's first-run bonus is still open);
  client -> server `requestWallet`, `walletBuy(itemId)`, `walletEquip(slot, itemId)` (5 / 10 s each, one in flight
  per player).
- **Run start:** each member's effective levels from `WalletService` (`StartContext.upgrades`), stored on the
  `RunSession`, returned in `runStarted` / `PartyRunStart`. `upgradesApply(world)`: endless and the Daily, solo and
  co-op; `dev` by its panel; M1 worlds and the tutorial never. A purchase applies from the next run.
- **Studio:** no writes; `KV_FakeWallet` (`"0"`, `"460"`, `"460;vigor:2,character.archer:1"`, `"unknown"`; a
  trailing `;claimed` marks today's bonuses as taken).
- **Budget:** +1 `GetAsync` per join; +1 `UpdateAsync` per credited member per paying run; +1 per purchase or equip.

## Design (summary)

| Piece | Where | Step |
|---|---|---|
| `SILVER` tunables (rows, `roomPay`, `runMinimum` + `minimumRooms`, `firstRunBonus`, `dailyBonus`), `runSilver(state, summary)` (pure, integer: the run rows and whether the minimum applies), `silverEligibility(world, flags)` | shared/silver (new; never imported by the sim) | SV1 |
| `ARMORY_TIERS`, `ARMORY_CATALOG` (append-only; each level names a tier), `itemPrice`, `nextGoals(wallet)`, `WalletDoc` codec, `applyGrant` (minimum, Prospector, day bonuses) / `applyBuy` / `applyEquip`, `walletBalance`, `ownsCharacter`, `parseFakeWallet` | shared/wallet (new) | SV2 |
| `WalletTransactions`, `WalletService` (join load, remotes, `effectiveUpgrades`), docs/SERVER.md | server/services | SV3 |
| `readSilver` in `SegmentedValidator.decide()`, `SegmentedRunResult.silver`; grant in `conclude` (the UTC day and the run's daily day as `ctx`), `RunFinishVerdict.silver` (`forRecipient`), the settling `wallet` push | shared/run segments.ts, RunSessionService | SV4 |
| `placeBreakableSilver` (after `placeSecret`), `BREAKABLE_SILVER`, layout / world field, floor option, dev override | shared/dungeon | SC1 |
| `SimConfig.silver`, `state.silver`, hash group, `silverOnBreak`, `events.silver`, run configs; pins; ruleset | shared/sim/silver, shared/run | SC2 |
| Twinkle through `pieceGlints` / `glintSlotCount`; the stage feature; `SilverCrateFx` (pure) and `SilverCrateController`; optional `fx.silver.coins`; `sfx.silver.crate` | shared/view, shared/run stageInput.ts, client fx | SC3 |
| Crate census | shared/run | SC4 |
| `PlayerTraits.armorMaxDelta` / `flaskChargesDelta` (neutral 0), applied in `createSimState`'s per-player loop; `upgradeTraits(character, levels)` | shared/sim playerData.ts, state.ts; shared/run | SV5 |
| Upgrades on the session, `upgradesApply(world)`, ruleset, dev panel `Upgrades: none / mine / max` | shared/run, RunSessionService, LobbyService | SV6 |
| Theme: `SILVER_STRING_KEYS` (own module), l10n context, role `silver` + `silverReport`, `ui.icon.silver` (distinct from `ui.icon.coin`), port audio IDs `sfx.silver.gain` / `sfx.silver.crate` / `sfx.shop.buy` / `sfx.shop.deny` (SILENT; fallbacks) | shared/theme, packs | SV7 |
| Store slice `wallet`, `WalletController`, `SilverTracker`, the counter on ScorePanel's floor / Depth line, its `+2` on room clears, pops, recap rows (run, bonuses, top-up, total, `to go`) | client, shared/view/silver, shared/view/hud | SV8 |
| Armory screen (tier sort, next-goal marks, dimmed far tiers, the tier 6+ confirm), menu button + badge + balance + the first-run line, character screen upgrade lines | client/ui/menu | SV9 |
| Telemetry: `LogEconomyEvent` sources (one per non-zero row) and sinks (one per purchase), `ArmoryPurchase` (tier as a field), upgrade total on daily finishes | TelemetryService, analyticsCatalog | SV10 |
| Cosmetics | shared/wallet, shared/view, render controllers | SV11-SV13 |
| **Heart cut:** the two character deltas, `TUTORIAL_START_HALF_HEARTS` 2, the half container in the hearts rows, re-recorded pins and censuses, ruleset | shared/characters, shared/sim tutorialData.ts, shared/view/hud layout.ts / touchStrip.ts | SV16 |
| **Archer unlock, server:** `locked_character`, the `setReady` predicate and the tick re-check, unknown-wallet rule | shared/run runSessions.ts, shared/lobby lobbies.ts, RunSessionService, LobbyService, shared/wallet | SV17 |
| **Archer unlock, client:** locked card, buy in place, pick fallback (the stored pick, `locked_character`, the unranked fallback), lobby and dev panel states; the returning-player card (OC12) | client/ui/menu, SimController, shared/view/menu, shared/onboarding | SV18 |

### Changed and not changed

- **Sim:** one new opt-in group (`silver`) and two new trait fields. No rng, rule, lockstep wire or recording
  change. Room pay, the minimum and the bonuses add nothing to the sim. `START_HALF_HEARTS` is not touched;
  `TUTORIAL_START_HALF_HEARTS` is (tutorial only). M1 and every golden fixture hash as today.
- **Endless, daily, dev and tutorial replays change** (hearts, then `state.silver`). `DAILY.ruleset` bumps once per
  commit that changes a Daily run: hearts, crates, upgrades (19 -> 22 on this branch if each ships alone).
- **Scoring rules: not changed.** Scores will run lower at 2 hearts; all-time boards stay `_v1`.
- **`predictMotion.ts`: not changed.**

## Tasks

Each step is a commit; specs next to the code; `npm run verify` before each. Order: SV0; SV1-SV4 (wallet and
payout); SC1-SC4 (crates); SV5-SV6 (upgrades); **SV16-SV18 together with SV9** (the heart cut and the lock must not
ship before Vigor and the unlock can be bought); then SV7-SV8, SV10 and the cosmetics.

- [x] **SV0. Confirm the assumptions.** Done 2026-11-13 ("SV0 findings"): every earn row's field (rooms =
  `counts[ROOMS]`, bosses by Depth, secrets and the Goldling by their own counters); the final state only in the
  validator (`readSilver`); odd maxima safe in the sim but drawn as damage in the HUD; the tutorial's wounded start;
  the unranked fallback and the lobby's pure Ready; the UTC day; the economy API; no room in the score panel's label
  row or the tally; the break line; placement after `placeSecret`; pieces per floor by band; the glint and the stage
  feature; the pins. New owner calls OC18-OC20.
- [x] **SV1. Earn function and census.** -> Verify: pure specs per row; the minimum applies at exactly 2 rooms and
  never below; the boss row by the Depth reached; a secret pays once whether or not its chest is taken; the census
  (bots at 2 hearts, then at each Vigor level) meets the targets within 20 %, re-run after SC4 and SV16; a printed
  **pacing table**: days and runs to afford each tier for a floor-1-2, floor-3, floor-5 and floor-10 player with and
  without the day bonuses, checked against the ladder's column; a **farm table**: Silver per hour of the fastest
  two-room run, of die-at-once runs and of normal play, with the fastest farm below normal floor-3 play (fact 9); an
  idle run pays 0.
- [x] **SV2. Ladder, catalogue and wallet core.** -> Verify: every tier is 1.8 to 2.2 times the one before; every
  catalogue level names a tier, a track's levels rise by at least one tier; nothing with a sim lever sits above
  tier 5; `nextGoals`; codec round trip and junk; a missing doc is an empty wallet; `applyGrant`: idempotent per
  run id, the minimum, Prospector on the run amount only, each day bonus once per day and again the next day, a
  day number that goes backwards pays no bonus, two grants on the same day in either order give the same total;
  `applyBuy` refuses poor / maxed / unknown / missing prerequisite; transforms compose in any order; order lock.
- [x] **SV3. WalletService.** -> Verify: fakes; a buy before load is refused; a failed load greys the Armory and
  still lets a grant land with its bonuses; two simulated servers' interleaved grants pay the day bonus once; a
  client-sent price is ignored.
- [x] **SV4. Grants at the verdict.** -> Verify: `SegmentedRunResult.silver` equals `runSilver` on the final state for
  solo and party replays, absent on rejections; grants for solo, party (each credited member: the team's run amount,
  their own bonuses and Prospector), abandoned, rejected, desync; both bonuses once per UTC day and across midnight (a
  Daily started before midnight pays its start day's bonus); a re-concluded session grants once; the settling push
  corrects a wrong prediction.
- [x] **SC1. Placement.** -> Verify: `roomPool.lock.spec` and every earlier output byte-identical on and off; never
  a loot piece, the Goldling's piece or an inert / secret piece; barrels and crates both picked, about 2 : 1; at most 2
  per room; counts and stacks in range over runs 1-40 x floors 1-20 per band; a Plunder floor's Silver avoids its
  loot; each floor modifier yields valid slots.
- [x] **SC2. Sim.** -> Verify: every break source pays once; a broken piece pays nothing again; `total` carries over
  `nextFloor`; without the flag every hash is today's; determinism; pins re-recorded and listed; ruleset bumped.
- [x] **SC3. View and sound.** -> Verify: `pieceGlints` / `glintSlotCount` list intact Silver pieces with the loot
  look and drop them at the break; boost, Silver and Goldling pieces are indistinguishable in its output; the stage
  feature is on for a floor with Silver and no loot; `SilverCrateFx` specs; a far co-op break ticks the counter.
- [x] **SC4. Crate census.** -> Verify: the bot breaks at least half of Silver pieces without detouring; crates'
  share of the run amount is 25-40 %; twinkling pieces per floor printed by band.
- [x] **SV5. Traits.** -> Verify: neutral deltas hash as today; each level's starting values; refills and revives
  respect the new maxima; golden fixtures and `predictMotion.spec` untouched.
- [x] **SV6. Upgrades on the session.** -> Verify: client and server configs hash equal for every level set in
  endless and the Daily, solo and party; the tutorial and M1 ignore upgrades; an unloaded wallet starts neutral and
  says so; a client that lies about levels fails its first segment; ruleset bumped.
- [x] **SV16. Heart cut.** -> Verify: Knight 4 / Archer 3 half hearts solo and per co-op player, with Vigor 5 / 6
  and 4 / 5; `archerHearts.spec` and the character specs updated; a run without traits still 6 and the same hash;
  every golden fixture untouched with no setter; `heartFills` and the touch strip draw a half container for an odd
  max (full, hurt and empty), never a half-filled heart; the flask, Hearty, Lionheart, Fang, revive, Second Wind and
  the curse at odd maxima; the tutorial at 2 hearts starting at 1 heart, its flask lesson still healing, its lock spec
  and funnel pins re-recorded; the Archer survival census re-run and recorded in docs/ARCHER.md; ruleset bumped.
- [x] **SV17. Archer unlock, server.** -> Verify: solo start as an unowned Archer is `locked_character`; `setReady` as
  her is refused, a countdown whose member lost ownership is cancelled, and a party start re-checks; a buyer passes;
  an account with old records and no purchase is refused like a new one; unknown wallet = Knight only; old clients
  that send no `characterId` start as the Knight.
- [x] **SV18. Archer unlock, client.** -> Verify: pure card-state specs (locked poor / locked affordable / owned /
  unavailable); buying lights the card and allows the pick in the same visit; a stored Archer pick without
  ownership reads as the Knight; a `locked_character` refusal starts the Knight, never an unranked Archer; lobby,
  run-over Character button and dev panel states; portrait fit; the returning-player card shows once for a
  pre-update account and never for a new one.
- [x] **SV7. Theme.** -> Verify: contract / placeholder / vale specs; the pinned tails updated; Luau top-level
  locals counted on out/ and still <= 200; `l10n:check`; the bonus and `to go` lines fit in every locale.
- [x] **SV8. Live counter, pops, recap rows.** -> Verify: `SilverTracker` specs (a room clear ticks once, a far
  co-op clear too); the counter fits row 5 beside the floor / Depth text on the smallest phone and in portrait; the
  recap rows' dimmed -> settled states, the bonus and top-up rows only when they apply, the `to go` line; nothing in
  the tutorial or dev runs.
- [x] **SV9. Armory screen.** -> Verify: pure layout specs (tier sort, next-goal marks, dimming, the tier 6+
  confirm); per-character effect lines; the first-run line shows until claimed; gamepad focus and hints;
  `KV_FakeWallet` poor / rich / unknown.
- [x] **SV10. Telemetry.** -> Verify: catalogue budget spec; one economy Source per non-zero grant row (amount > 0,
  ending balance >= 0) and one Sink per purchase with its tier; daily finishes carry the upgrade total; the new-player
  events carry starting hearts; days and runs from first run to each tier's first purchase, split by the player's usual
  death floor; the share of runs paid at the minimum.
- [x] **SV11-SV13. Cosmetics** (catalogue with tiers and colour validation; equip and per-player looks; drawing the
  slots).
  *Done 2026-11-21 (docs/OPEN_TASKS_TRIAGE.md): built as docs/COSMETICS.md (CS3-CS8); what is left is tracked by its tasks.*
- [x] **SV14. Docs.** This doc's "As built", docs/SERVER.md, docs/CLIENT.md, docs/DAILY.md, docs/ARCHER.md,
  docs/ROOM_CLEAR.md (room clears tick the counter), docs/BREAKABLE_DROPS.md and docs/GOLDLING_RUMOURS.md (what a
  twinkle can hold), docs/TUTORIAL.md (the 1-heart start), the CLAUDE.md row and decision log.
- [ ] **SV15. [owner] Studio check, sounds, the coin icon, the half container and burst art, tuning playtest (with
  young players if possible: the first hour's pacing above all).**

## As built (phase 1, 2026-11-14)

Built in four tracks, then merged and wired (the integration commit). Nothing has run in Studio: server and client code
is typechecked, linted and built only; the pure cores are specced. The whole headless suite passes on the merged tracks
(sim 1371, dungeon 396 of 397: the known x86 `forge.spec` NaN bit pattern, run 382, view 2625, the rest 1960).

### Earn function, wallet, grants (SV1-SV4, SV10's server half)

- **shared/silver** (never imported by the sim; must not import shared/run: segments.ts imports it): `SILVER` (roomPay
  2, floorBase 5, bossPerDepth 40, vaultOpened 15, secretFound 25, goldlingCaught 30, killsPerSilver 10, runMinimum 20,
  minimumRooms 2, firstRunBonus 50, dailyBonus 50, Prospector 5 % a level), `SILVER_ROWS`, `SILVER_PAYING_WORLDS`
  (`"endless"` as a pinned literal, the Daily), `runSilver(input)` -> rows, sum, `qualifies`, `topUp`, `amount`;
  `silverRunInputOf(state, summary, config?)` (config: a dev run's start floor / Depth), `crateSilverOf` =
  `silverTotalOf`; `silverEligibility(worldKind, flags)` -> undefined (pays) or the reason (`world`, `unranked`, `debug`,
  `dev`, `stress`, `studio`).
- **shared/wallet**: `ARMORY_TIERS`, `POWER_TIER_CAP` 5, `CONFIRM_FROM_TIER` 6, `ARMORY_CATALOG` (append-only, order
  lock; vigor tiers 1 / 3, deepFlask 3 / 5, plating 5, prospector 2-5, `character.archer` 4; total 2,970); the
  `WalletDoc` codec (never throws; another version reads as empty; unknown item ids kept), `applyGrant` /
  `grantBreakdown` / `applyBuy` / `applyEquip` / `nextGoals`, `walletTransaction` (refuses a newer doc version),
  `walletBalance`, `ownsCharacter`, `walletUpgradeLevels` (`WalletUpgradeLevels` = shared/characters `UpgradeLevels`),
  `parseFakeWallet`, `WalletStatus` / `walletStatusOf`; `WalletBook` (the pure service core: join load, per-player
  transaction lock with retries, read copies, `notLoaded` / `busy` / `failed`), `MemoryWalletStore`; `planRunGrants`
  (skip reasons), `grantContextOf`, `predictRunGrants`; economy analytics builders.
- **Server**: `WalletTransactions` (UpdateAsync on `KV_Wallet_v1`), `WalletService` (join load + push; remotes
  `requestWallet` / `walletBuy` / `walletEquip`, 5 / 10 s each; Studio transacts on a MemoryWalletStore seeded by
  `KV_FakeWallet`, a change resets it; BindToClose waits for pending grants). `readSilver` in
  `SegmentedValidator.decide()` -> `SegmentedRunResult.silver` (accepted runs). `conclude` plans grants for the credited
  members and `grantRun` spawns one transaction each; `RunFinishVerdict.silver` is the prediction, the settled
  breakdown is pushed as `WalletStatus.grant` (match on runId: for the Daily it can arrive before the verdict).
  `TelemetryService.logEconomy`: one Source per non-zero part (the 8 rows, `prospectorBonus`, `runMinimum` as Gameplay;
  `firstRunBonus` / `dailyBonus` as TimedReward), a Sink per purchase (Shop, SKU = item id), custom event
  `ArmoryPurchase` (38 of 100 names).
- **Wiring**: WalletService sets `SilverAccessService` at construction (no start sees the open default): upgrades =
  `effectiveUpgrades` (undefined: unknown wallet, no upgrades), ownership = `ownsCharacter` (unknown: the Knight only).

### Silver in crates (SC1-SC4)

- **Placement** (shared/dungeon `breakableSilver.ts` / `breakableSilverData.ts`): `BREAKABLE_SILVER` salt `0x4b56534c`
  ("KVSL"), bands 2-3 / 3-4 / 3-5 / 3-5 from floors 1 / 5 / 10 / 15, `maxPerRoom` 2, barrel 1 : crate 2, stacks 4-8
  rising one every 2 floors (cap +10). Runs once, last, after `placeSecret`, on the final loot, behind
  `EndlessFloorOptions.silver` (set by `endlessRunFloor`); candidates are the clutter slots only (`placeBreakables`'
  pieces) without loot. `EndlessFloorLayout` / `EndlessFloorWorld.breakableSilver` (`{ slot, amount }[]`). Dev
  `KV_SilverDebug` = `every`: every candidate holds Silver, no room cap (`SilverOverride`, `parseSilverDebug`).
- **Sim** (`sim/silver`): `SimConfig.silver` (`ENDLESS_SILVER_CONFIG`, on every endless / daily / dev build, solo and
  party; never M1 or the tutorial), `state.silver { config, total, pieces, events.breaks }` (the per-tick list lives on
  the silver state: SimEvents holds numbers only), hash group `silver` LAST (after `secrets`: total, the pieces' length,
  the pieces), `silverOnBreak` right after `dropsOnBreak` (every source), `silverTotalOf` / `silverPieceAt`. No pin
  moved (charger / stormcaller build their own configs without the flag); the group-order specs of builds, breakables,
  golden, progression, pellets, pacts, treasure and the run specs were updated (run/endless: 19 groups).
- **View**: `pieceGlints` / `glintSlotCount` include Silver pieces; the stage feature `breakableLoot` is on for a
  Silver-only floor; shared/view/silver `SilverFrameEvents`, `SilverCrateFx` (pops max 3 a frame, coins max 12, one
  clink stepping within 0.6 s, reduced motion: no coins), `silverDebugText`.

### Hearts, upgrades, the Archer lock (SV5, SV6, SV16, SV17)

- **Traits**: `armorMaxDelta` / `flaskChargesDelta`, `playerStartArmorMax` / `playerStartFlaskMax`, set in
  `createSimState` beside the hearts. shared/characters `upgrades.ts`: `UpgradeLevels`, `NO_UPGRADES`,
  `UPGRADE_MAX_LEVELS` 2 / 2 / 1, `upgradeTraits(characterId, levels)`, `readUpgradeLevels`.
- **Session**: `WorldBuildOptions.upgrades` -> `withCharacters`, `upgradesApply(kind)` (endless, daily), dev
  `DevRunOptions.upgrades` none / mine / max; `StartContext.upgrades`, `RunSession.upgrades` / `upgradesUnknown`,
  `StartRunReply.upgrades`, `PartyRunStart.upgrades`; SimController builds ranked and party runs with them (unranked:
  none). Spec: every level set x character in endless and the Daily, solo and party, hashes equal; a lying client fails
  segment 0.
- **Heart cut**: `KNIGHT_HEARTS_MAX_DELTA` -2, `ARCHER_HEARTS_MAX_DELTA` -3, `TUTORIAL_START_HALF_HEARTS` 2; `HEART_FILL`
  (EMPTY 0, HALF 1, FULL 2, HALF_MAX_FULL 3, HALF_MAX_EMPTY 4), `heartFills` ends an odd maximum in a half container,
  `heartArt`; StatusPanel and the touch strip draw `ui.heart.halfmax` / `.halfmax.empty` (theme `heartIcons.ts`), else the
  whole heart clipped to its left half, else a flat half box. Art pipeline group `heartIcons` -> `heart-icons.png`,
  `packs/vale/heartIconLayout.ts` (written by hand; the Mac build matched it), uploaded 2026-11-14. No hash pin moved;
  run/secrets.spec now picks the first of 6 seeds where the 2-heart bot opens its secret and lives.
- **Lock**: `locked_character` (`RunSessionRegistry.start`, worlds with characters: endless, daily, dev), `Lobbies.setReady`
  ownership predicate (`lockedCharacter`, string `lobby.err.lockedCharacter`), the countdown cancels when a pick is no
  longer owned, `STARTER_CHARACTERS`; `SilverAccess` / `SilverAccessService`.
- **Archer survival census** (12 runs each): Knight at 4 half hearts mean floor 4.1, 6 of 12 alive entering floor 5;
  Archer at 3 half hearts 4.8, 8 of 12; both weapons without traits 4.7, 10 of 12.

### Client and theme (SV7, SV8, SV9, SV18)

- **Theme**: `shared/theme/silver.ts` / `silverColors.ts`: `SILVER_STRING_KEYS` (66, spread last into
  `REQUIRED_STRING_KEYS`), role `silver` `#c4d0dc` (`silverReport`), optional `ui.icon.silver` (a silver chip without
  it) and `fx.silver.coins`, port audio IDs `sfx.silver.gain` / `.crate` / `sfx.shop.buy` / `.deny` (last in
  `PORT_AUDIO_EVENTS`, SILENT in both packs; fallbacks score tick, breakable loot, relic take, ui back).
  `contract.luau` / `validate.luau` top-level locals 188 / 192. A later feature appending to the pinned tails must skip
  Silver's entries too.
- **In the run**: store slice `wallet`, `WalletController`; `RunView.silver` / `.kills`; `SilverTracker` (runSilver on
  the view's reads), the counter on ScorePanel row 5 (`SilverFloorRow`, the floor / Depth text scaled beside it), the
  `+N` chip, `SilverHudController` (crate pops that duck near bullets, coins flying to the counter as a ScreenGui layer,
  the clink, `sfx.silver.gain`), `KV_SilverLabel` in BreakableRenderController; run-over `SilverRecapBlock` (dimmed client
  figures, settled by the verdict, then by the grant with the same runId). The Silver rows replace the run-over panel's
  info line (still in the pause overlay): one more row overflowed the smallest layouts.
- **Armory**: `shared/view/menu/armory.ts` (tabs, tier sort, next / after marks, dimmed far tiers, the tier 6+ confirm,
  per-character effect lines, `BuyHold` 0.4 s, the badge) and `ArmoryScreen`; the main menu's Silver line (balance,
  `First run today: +50`), the Armory button after Codex (on phones a small button in the Silver line).
- **Unlock**: `characterLock.ts` (`characterLockState`, `offeredCharacters`, `characterPickAllowed`); the character
  screen's locked card with the hold-to-buy; `selectPlayableCharacter`; a `locked_character` reply restarts the ranked
  request as the Knight (never an unranked Archer) and resets the stored pick; `makeRun` never builds an unowned
  character for an unranked run. OC12's card (`SilverWelcomeCard`) shows once for a loaded wallet that never earned
  and has personal records; `DisplaySettings.silverNoticeSeen` (only true stored). Dev panel: `Upgrades` cycle, Go
  reads `KV_SilverDebug`.

### Census (owner answers OC21-OC23: fine as is)

At today's hearts (before the cut), 16 Knight seeds to floor 10 plus 6 immortal: run amounts floor 1-2 32 (target 45),
floor 3 57 (75), floor 5 with its boss 205 (160), floor 10 434 (500). A floor-1-2 player's day is about 196 with the
bonuses; the Archer in about 3 days, tier 8 in about 50. Farm: the fastest two-room run about 3,350 an hour, normal play
about 990. Crates (SC4, runs 1-40 x floors 1-20): 2.5 / 3.5 / 4.0 / 4.1 Silver pieces and 16 / 31 / 45 / 57 Silver a
floor by band, crates 65.5 % of the pieces; the honest bot breaks 3 % of them.

### Decisions added in the build

- **SVD31. A party run pays every credited member even below `COOP_MIN_PARTY`** (a solo run pays too).
- **SVD32. The grant day is the Daily's clock** (`dailyClockNow()`, Workspace server time), so it agrees with the Daily's
  own day.
- **SVD33. The first-run bonus pays on any eligible accepted run, even one that earned 0** (SVD19).
- **SVD34. A transaction on a stored doc of a newer version is refused** (logged; a grant there is lost, never a
  downgrade).
- **SVD35. `KV_SilverDebug` = `every` loads every candidate piece**, no room cap.
- **SVD37. A failed grant is retried** (review): a grant whose DataStore call failed every retry waits
  `WALLET.grantRetrySeconds` (30) and is tried again, up to `grantRetryMax` (10) times and once more at BindToClose; the
  run-id ring makes a retry safe. The run-over rows stay dimmed until the settled grant arrives (the verdict's figure
  is a prediction).
- **SVD38. A buy carries the level the player chose** (review): a retried UpdateAsync that already committed answers
  `stale`, reported as the purchase it was, never a second level.
- **SVD39. Stored levels are kept as written and capped on read** (review): an older server in a rolling update never
  rewrites a newer catalogue's levels down; a doc of a newer version loads as unknown (Knight only, no upgrades), never
  as an empty wallet.
- **SVD40. The server's access default is Knight-only** (review, `LOCKED_SILVER_ACCESS`): a wiring mistake locks the
  Archer instead of giving her away. The client keeps the stored pick until the first wallet push (the server decides a
  ranked start or a Ready), and builds a run the server never sees only with a character it owns.
- **SVD41. The returning-player card is decided once, at join** (review): when both the wallet and the records pushes
  are in (`silverWelcomeDecision`, latched in the store), so a new player's first run never turns it on.
- **SVD36. The run-over Silver rows take the info line's place** on the run-over panel; the compact panel folds the
  bonuses, top-up and Prospector into one row.

### Left for the owner (SV15) and later

Studio check (the list below; first the pad's hold-to-buy and the coins' screen positions); the four sounds' volumes
(each is 1 until the mix pass); cosmetics (SV11-SV13); translations. Done since: the heart containers locked and
built on the Mac (the hand-written layout matched), `heart-icons.png` uploaded 2026-11-14 (133175128335720, in
`assetIds.ts`), so the bundled vale pack draws them; Silver merged into main. The four sounds' candidates sourced
2026-11-14 (art/audio.json, silent until the audition): Kenney Interface Sounds (CC0, new in
`art/vendor/kenney-interface-sounds/`) glass / select / pluck / confirmation / error clips, plus Little Robot Sound
Factory and Kenney Impact clips already in the vendor folder; none reuses a gold coin sound. Picked at the audition
2026-11-14: `sfx.silver.crate` LRSF `Collect_Point_02`, `sfx.silver.gain` Interface `pluck_001`, `sfx.shop.buy`
`maximize_007`, `sfx.shop.deny` `error_008`; built and uploaded 2026-11-14 (`assetIds.ts`), so the bundled vale pack
plays them.

### As built: Silver's art (2026-11-14)

Presentation only. Both optional pieces are ORIGINAL pixel art by `scripts/art/gen-silver-art.js` (run by `art:build`
/ `art:lock`) into `art/vendor/kaleb-vale/silver/`, packed by a new atlas group `silver` (`--only silver`, generated
`packs/vale/silverLayout.ts`) into two sheets of their own, so no uploaded sheet repacks:

- `ui.icon.silver` (`silver-icon.png`): the counter's 12 x 12 icon (SILVER_COUNTER.iconPx, so it draws at whole steps):
  an **octagonal** coin in a cool silver ramp around the `silver` role, lit from the top left, stamped with a crescent
  (the alchemists' sign for silver), outlined in the boon icons' near black; never the score's round gold coin. Vale
  `VALE_SILVER_ICON_SOURCE` (all or nothing on the sheet's one ID, like the heart containers). `SilverIcon` now wraps
  the art or the chip in one box that carries `iconRef`, so the crate coins still fly to the icon once the art draws.
- `fx.silver.coins` (`silver-coin.png`): the crate burst's coin in flight, an 8-frame greyscale turn (face with a
  shine, oblique, a 2 px milled edge, the back a step darker) looped at 12 fps, tinted `silver`, cells 11 x 11. Vale
  draws it (`VALE_FX`, no longer in `VALE_FX_PENDING`); `SilverHudController` shows it in the coin layer at
  `SILVER_BURST_VIEW.coinArtScale` (1) screen px per art px, each pooled coin phased by its slot
  (`silverCoinArtFrame`), once it has downloaded on the device (`PreloadController.isArtReady`); before, the dots.

Without the sheets' IDs every screen is exactly as before (the chip, the dots). Specs: `valeSilverArt.spec.ts`,
`gen-silver-art.test.js`, `silver.spec.ts` (`silverCoinArtFrame`). Both PNGs uploaded 2026-11-14 (`silver-icon.png`
106444206037710, `silver-coin.png` 111342292690960, in `assetIds.ts`), so the bundled vale pack draws them; the
Studio check pending (the coins still fly into the icon; the icon crisp in the counter, the main menu and the Armory).

## Studio check

1. `KV_FakeWallet = "0"`: the tutorial and the first run show 2 hearts (the tutorial starting at 1, its flask healing);
   each room clear ticks the counter by 2; a run that dies in room 3 shows `Silver`, `Topped up to 20` if it was short,
   `First run today +50`, and a total that buys Vigor I; a run that dies in room 1 gets no top-up; the Archer is locked
   at 300; twinkling pieces look alike, and with `KV_SilverLabel` the labelled ones burst into coins that fly to the
   counter.
2. A second run the same day: no first-run row. The Daily: `Daily bonus +50` once. After midnight UTC (or a faked
   day): both come back.
3. Buy Vigor I: the next endless run and the next Daily run start at 2 1/2 hearts, drawn as two hearts and a half
   container; the flask heals to the cap without a ghost half. The Armory marks the next goal and the one after.
4. Reach 300, unlock the Archer on the character screen, pick her in the same visit: 1 1/2 hearts (2 with Vigor I).
5. A pre-update account (real onboarding and records docs, last pick the Archer): the one-time card, then the
   Knight at 2 hearts, the Archer locked, the wallet at 0, records and Codex intact.
6. Co-op, one player who bought the Archer and one who did not, endless and a Daily lobby: the second cannot Ready
   as the Archer; each starts with their own hearts; no desync over three floors; both get the team's run amount
   and each their own first-run bonus.
7. `KV_FakeWallet = "unknown"`: Armory greyed, Knight only, 2 hearts, the notice shown; the run still pays.
8. `KV_FakeWallet = "6000"`: a tier 8 title asks to confirm, buys, equips, and shows in a lobby.
9. Published place: rejoin keeps the balance; buy on one server, teleport, the purchase is there; two servers the
   same day pay the first-run bonus once; kill the server mid-verdict and rejoin: the run is granted once or not at
   all.
10. A Plunder floor and a floor with a vault, a secret and a Goldling: every twinkling piece pays exactly one thing.
11. Touch upright, gamepad only, HUD 70 %, reduced motion, a long translated item name.
12. Risks to look at first: floor 1-2 at 2 hearts for a first-time player; whether the first three runs each end
    with something to buy when every run ends on floor 1; the recap growing by up to four rows on a compact panel;
    the half container's look; the counter on row 5 on the smallest phone; coin effects in a busy room.

## Decisions

- **SVD1. One currency, earned only by play.** No premium currency, no Robux purchase of Silver in v1. **Superseded
  (2026-11-14) by docs/SILVER_SHOP.md:** Silver can be bought with Robux (developer products), one pool with earned
  Silver; still one currency, and what play pays is unchanged (SHD3).
- **SVD2. Silver's run amount is a pure function of the replayed run** (`runSilver`, read in the validator's final
  check); the server's number is the only one that counts. Crate Silver and room clears are part of that state.
- **SVD3. Upgrades apply in every ranked world: endless, co-op and the Daily** (owner, 2026-11-13).
- **SVD4. v1 upgrades are survivability and utility, capped small.** No offence, no motion.
- **SVD5. Transactions, not dirty-saves.**
- **SVD6. Party runs pay every credited member the team's run amount,** plus that member's own bonuses.
- **SVD7. Abandoned-but-validated runs and private servers pay; the unranked fallback never does.**
- **SVD8. Its own DataStore `KV_Wallet_v1`.**
- **SVD9. Purchases take effect from the next run** (a character unlock: from the next pick).
- **SVD10. No refunds or respec in v1.** Tiers 6-8 ask to confirm instead.
- **SVD11. Prices and effects are always shown exactly, per character.**
- **SVD12. The Archer is a Silver unlock at tier 4, 300** (owner: an unlock; the tier is recommended).
- **SVD13. Cosmetics are colour-only first.**
- **SVD14. Existing players keep nothing** (owner, 2026-11-13).
- **SVD15. Silver in crates** (owner, 2026-11-13): floor-built, placed last (after the secret room); the sim only
  counts breaks; any break pays; credited at once, no ground pickup.
- **SVD16. A piece holds a boost or Silver, never both.** Barrels and crates both qualify (owner), crates 2 : 1.
- **SVD17. Crate Silver is not score.**
- **SVD18. Base hearts down by one; the Archer half a heart under the Knight** (owner, 2026-11-13): Knight 2,
  Archer 1 1/2, as character trait deltas, not a sim constant; the tutorial shows 2 (owner).
- **SVD19. The first run always buys something.** The first-run bonus alone covers tier 1.
- **SVD20. The heart cut, the lock, Vigor and the unlock ship in one release.**
- **SVD21. Silver pieces use the boost pieces' twinkle unchanged** (owner, 2026-11-13).
- **SVD22. One exponential price ladder, doubling per tier** (owner, 2026-11-13): 40, 80, 150, 300, 600, 1,200,
  2,500, 5,000. Items name a tier, not a price.
- **SVD23. Power stops at tier 5; tiers 6-8 are unlocks and cosmetics** (OC14, recommended). A spec enforces it.
- **SVD24. The Armory always shows the next goal** (and the one after), in the screen and on the run-over row.
- **SVD25. Weak players earn from effort and from showing up** (owner, 2026-11-13: update the earn side): +2 per
  room cleared; a run that cleared at least 2 rooms is topped up to 20; +50 for the first paying run of each UTC
  day. All three are flat, so they matter most to the players who earn least. The two-room rule is what keeps the
  minimum from paying for instant deaths.
- **SVD26. Day bonuses are decided inside the grant transaction,** from the stored `runDay` / `dailyDay`, not from
  the records doc or the session copy: once per day across servers, and safe when the join load failed.
- **SVD27. Prospector multiplies run amounts only,** never the minimum's top-up or a day bonus, so its shown
  percentage is exact and flat income stays flat.
- **SVD28. The run's rows are read in the validator's final check** (SV0): `readSilver` beside `readScore`, carried as
  `SegmentedRunResult.silver`; nothing keeps the replay state alive for the verdict.
- **SVD29. A room clear is counted by its score record** (`counts[ROOMS]`, SV0): the boss room has none and pays its
  own row; a Horde room and a room's runtime children are one clear.
- **SVD30. The first-run bonus uses the day at the grant, the Daily bonus the day the Daily run started** (its
  board's day), both from shared/daily `dailyDay`.

## Risks

- **Short-run farming.** The minimum and room pay make very short runs worth something. Mitigation: the two-room
  rule; the first-run bonus is once a day; SV1's farm table must show the fastest loop paying less per hour than
  ordinary floor-3 play. Levers: `minimumRooms`, `runMinimum`, a soft daily cap on minimum top-ups.
- **Strong players run out early.** At about 500 a run plus bonuses, the power tree is about six runs and every
  cosmetic about fifty more. Mitigation: that is the cost of sizing for children; more cosmetics, later characters
  at tiers 6 and 8 and the Later list refill the top. Watch the share of wallets holding more than the dearest
  unowned item.
- **Weak players still stall at the top.** At about 250 a day, tier 8 is three weeks. That is intended as the long
  goal; if tier 5 (power) takes a weak player more than a week, raise the room pay first.
- **Returning players lose a heart and the Archer on update day** (SVD14, owner). The heart is back at about run
  three and the Archer within two days. Mitigation: the one-time card; watch 7-day return of pre-update accounts.
- **New-player retention.** First runs at 2 hearts are harder, most of all for young players. Mitigation: SVD19;
  the tutorial shows 2 hearts. Lever: the Knight's delta.
- **Daily fairness.** The power gap closes at about 3,000 Silver, and nothing above tier 5 adds power (SVD23).
- **Recap length.** Up to four more rows on the run-over panel. Mitigation: bonus and top-up rows only when they
  apply; they fold into one `Bonuses +100` row on a compact panel.
- **Odd heart maxima** (fact 7). Mitigation: SV0's list, SV16's specs, the half container (OC18).
- **The Archer at 1 1/2 hearts is too fragile before Vigor.** Mitigation: the survival census; lever: her delta.
- **Retuning debt.** Censuses and tables assumed 3 and 2 hearts. SV16 re-runs the ones that gate specs.
- **The twinkle means less.** Mitigation: Silver's coin burst is its own reward. Lever: fewer, larger stacks.
- **Coin effects as noise.** Mitigation: under every bullet, short, capped per frame, ducking near enemy bullets.
- **HUD crowding.** The score panel is at 158 of 160 px; the counter shares row 5 with the floor / Depth text (SV8's
  fit spec). Lever: the counter only on the pause overlay on the smallest phone.
- **Replay and pin churn** from hearts and the new hash group. Mitigation: SC2 and SV16 each land alone.
- **Bot farming.** Watch Silver per hour per player; a soft daily earn cap is a config change.
- **Double grants or lost Silver** across teleports and shutdowns. Mitigation: SVD5, SVD26, Studio check 9.
- **Pinned theme tails and the Luau locals limit** (fact 3).

## Later (not in this plan)

- **More Silver in the world:** rare drops from elites, a Silver shrine pact, a `Silver Rush` floor modifier, silver
  in secret-room chests.
- **Draft tools as upgrades:** rerolls, banishes, a skip-for-Silver.
- **More characters** (tier 6, then 8) **and weapon skins**, palette skins through the atlas pipeline's `recolor`,
  cursor skins.
- **Codex milestone rewards** paid in Silver; needs server-derived discoveries first (CXD1).
- **Offence upgrades** (OC2), a respec, quests / weekly goals and login streaks that pay Silver, gifting.
