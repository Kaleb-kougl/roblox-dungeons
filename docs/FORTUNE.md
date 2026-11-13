# Fortune: risk shrines (pacts) and the Goldling

Status (2026-11-04): **built on branch `fortune` (FO0, PS1-PS5, GE1-GE4, FO6-FO9, FO12) and merged into `main` after
main's treasure rooms (docs/TREASURE.md; "Merge with main" below: hash groups `... pellets, treasure, pacts, golden`,
score sources `TREASURE` 12, `HORDE` 13, `GOLDEN` 14, `DAILY.ruleset` 7 -> 8); owner tasks FO10 (art and audio), FO11
(telemetry), FO13 (playtest), the Studio check and the open owner calls pending** (see "As built"). Since 2026-11-12
the Goldling hides in its own glinting barrel or crate and comes out when a player breaks it, with a floor and a room
rumour (docs/GOLDLING_RUMOURS.md, "Hiding places and rumours" below); lines here that describe the old engage + 3 s
appearance are marked *superseded*. Plan:
the owner (Kaleb) confirmed every decision (FD1-FD16) on 2026-11-03, each the recommended option. Planned against
`main` @ `82c2af6`. Work it task by task like `PLAN.md`; each task ends with a **Verify**.
Project copy: `claude/fortune-plan.md`. Sibling plan: `claude/treasure-rooms-plan.md` (vaults, docs/TREASURE.md); it
landed on main first, so Fortune took the next hash slots, score sources and daily ruleset on the merge.

Goal: two hits of dopamine that come from the **player's choice** and a **chase**, not from more stat bonuses.

1. **Pacts (risk shrines).** The shrine room stops being a single "take a random curse" button. Two **altars** stand in
   it, each stating its bet up front:
   - **Pact of Greed**: *take this curse (shown on the altar), choose a Legendary now.*
   - **Pact of the Horde**: *the next room you enter fights twice the enemies and pays twice the score.*
2. **The Goldling (golden enemy).** On some floors, a few seconds into a room's fight, a small gold creature pops out
   and **runs**. Every hit sprays coins (points). Catch it within 10 s for a jackpot of points and boosts; too slow and
   it dives into a crack and is gone. *(Superseded 2026-11-12: it hides in a glinting barrel or crate in its room and
   pops out when a player breaks it; a coin jingle tells you it is on the floor. docs/GOLDLING_RUMOURS.md.)*

**Sim impact: both are gameplay**, opt-in like boosts / breakable loot / pellets:

- `SimConfig.pacts` and `SimConfig.golden` (endless only), each with its own state and **its own hash group appended
  last** (`pacts`, then `golden`, after `pellets`; after `treasure` since the merge with main);
- floor-side rolls are pure dungeon functions on **their own salts**, so layouts, digests, props, spawns, pieces, loot,
  affixes, rosters, pellets and boss picks stay put;
- the main rng (`state.rngState`) is drawn **only** as a consequence of a pact the player took (the Legendary deal goes
  through the card draw, the way a boon pick does). The Goldling draws from its own stream.

M1, every golden fixture and the tutorial (it keeps today's classic shrine) replay exactly as before. Endless replays
and scores change: `DAILY.ruleset` 5 -> 6 as planned (7 -> 8 on the merge with main's treasure rooms), all-time boards
stay `_v1` (FD15).

Rules that keep it kind (kids play this): **you always see the cost before you pay it, walking away is always an
option, and a miss always leaves you something.**

## What the code gives us (read in the source at 82c2af6 unless marked assumed)

| Fact | Where | Consequence |
|---|---|---|
| **The shrine today:** at most one SHRINE room per floor (Forge `shrineCap` 1); a zone of `SHRINE_RADIUS` (1 tile) at the room centre; the first living player (index order) in the zone with a `SHRINE_BUTTON` (SKILL1) press edge and a curse left gets a curse drawn from **their** unused set (one main-rng `rngInt`), `acceptCurse`, plus `addCurse` (team score x +0.25); then the shrine is used for everyone. Hashed in `run` (`shrineRoom`, `shrineUsed`) | `sim/progression/progression.ts` stepRun 5 | Pacts reuse the press edge, the zone test and `acceptCurse` / `addCurse`. With `SimConfig.pacts` set, step 5 is skipped and the altars take over. Without it (tutorial) step 5 is unchanged |
| 4 curses (Frailty, Haste, Impatience, Thirst), append only | `progressionData.ts` | Greed needs a curse left for the taker |
| **Any open draft freezes the whole world**; `openDraft(state, i, floorCleared, deals)`; builds runs deal cards via `drawPlayerCardOffers` / `drawCardOffers(rng, rules, levels, duos, floorCleared, guaranteeDuo)` on the main rng; `dealOffers` puts offers on the table | `progression.ts`, `sim/builds/cards.ts` | The Legendary deal is a draft opened mid-floor for the taker, with a new offers function. The shrine room has no enemies; in co-op it pauses teammates for the pick (FD4) |
| Legendary cards: the two legendary boons (Ember Wake, Composure), every duo (`DUO_RARITY = LEGENDARY`, 9 duos), evolutions (a common or rare boon at level II -> III) | `progressionData.ts`, `buildsData.ts` | The Legendary pool. Early in a run it is thin, so the deal fills with upgrades (FD4) |
| Endless always runs builds | `buildEndlessRunConfig` | Pacts can rely on cards |
| **Room records:** `RoomScore` (bounds, `parTicks`, `engageTick`, `hitsAtEngage`, `cleared`, `memberSlots` / `memberIds`). `stepScore` latches engagement then `clearRoom` when `scoreRoomDown`: ROOMS 250, PERFECT 500, FAST, pellets' Sweep first | `sim/score/score.ts` | Horde holds its room's clear while wave 2 is pending and appends wave 2 to the same record |
| `attachScoreRoomMembers(state, roomId, spawned)`, `adoptScoreRoomMember(state, parent, child)` | `score.ts` | Wave 2 needs a sibling `appendScoreRoomMembers(state, k, spawned)` |
| **Room spawns:** `enterRoom` spawns `world.roomSpawns[id]` through `safeRoomSpawns(state, planned, roomSpawnTiles[id])`, affixes for planned spawns only; a full pool (`MAX_ACTORS` 64) drops the rest | `sim/endless.ts` | Wave 2 = the planned kinds again through `safeRoomSpawns`, no affixes. The Goldling spawns on the room's spawn tile farthest from the players *(superseded: at its piece's cell centre, docs/GOLDLING_RUMOURS.md GR2)* |
| `awardPoints(..., scalePercent, bonusPercent, extraPercent)`: exact integer factors; `scoreKill` passes bonus = affix x Bounty, extra = Gold Rush | `score.ts` | Horde x2 multiplies into `bonusPercent` |
| Gated score sources: `JACKPOT` 9 (builds), `PELLETS` 10 / `SWEEP` 11 (pellets) | `scoreData.ts` | Append `HORDE` 12 (pacts only) and `GOLDEN` 13 (golden only; pads HORDE when pacts is absent, the pellets/JACKPOT pattern; on main: `TREASURE` 12, `HORDE` 13, `GOLDEN` 14) |
| Hash groups: the last is `pellets` | `sim/hashLayout.ts` | Append `pacts`, then `golden` (on main: after `treasure`) |
| Salts in use: `0x165667b1`, `0x27220a95`, `0x27d4eb2f`, `0x4b564452`, `0x5bd1e995`, `0x7f4a7c15`, `0xcc9e2d51`, `0xe6546b64` | `src/shared` | Pacts salt `0x5c3a91e7`, golden salt `0x3d2f8b4d` (the floor roll), Goldling sim stream salt `0x7a3c5e91` (unused at 82c2af6) |
| `DAILY.ruleset` = 5 | `shared/daily/config.ts` | 6 (on main: 7 -> 8) |
| Archetype bands 0-4 hold indices 0-17 | `combat/actors/registry.ts` | The Goldling is band 5 (`PORT_BAND_FORTUNE`), index 18 |
| `PLAYER_SPEED` 6, `ROLL_SPEED` 11 | `sim/playerData.ts` | The Goldling runs at 5.1 |
| Drops: 4 ground slots, `lowestFreeDropSlot` / `landDrop`; `dropsOnKill` skips `DROP_INELIGIBLE_ARCHETYPES` | `sim/drops/` | The Goldling is ineligible and lands its jackpot boosts itself, kinds from its own stream |
| `pathField` (dungeon) allocates W x H per call (test bots) | `dungeon/pathField.ts` | The flee field is a new allocation-free helper over the room's box |
| Mid-floor drafts: the client's draft gate, stage pre-generation, music dip and HUD title may assume a draft follows a floor change **(assumed; FO0 verifies)** | `client/`, `shared/view/hud` | FO0 lists what keys on `floorChanged` vs `draftOpened` |
| Warbanner aura (125 % walk) on room enemies within 4.5 **(assumed shape; FO0 verifies)** | `combat/actors/actorMods.ts` | The Goldling opts out |
| Room themes put the shrine statue (3 x 3, solid) by a far wall, 3+ tiles clear of the shrine's centre | `dungeon/forge/solidDecor.ts` | Altars are placed after solid decor, on FLOOR cells only |

## Player experience

### Pacts

The shrine room looks as today (crystal in the middle, statue behind), with two **altars**, one each side of the
crystal on the screen-horizontal line. Each shows a **floor card** (SurfaceGui under every bullet, the combo shout's
construction), readable from the doorway:

```
 PACT OF GREED                        PACT OF THE HORDE
 Take: Frailty  (-1 heart max)        Next room: twice the enemies
 Gain: choose a LEGENDARY now         Pays: twice the score
 [1] Accept                           [1] Accept
```

Step on an altar for the existing shrine hint (`Press 1 / A`; touch: the shrine button). An altar with nothing to give
you is greyed out with one line (`No curses left` / `No legendary to draw` / `No room left to rouse`).

- **Greed:** `sfx.pact.take` (a low bell); the curse icon **brands** into your owned-items row (0.4 s); the multiplier
  ticks up (+0.25). *(As built: no brand flight, the HUD's item row has no world anchor; a dark disc pulse at the
  altar and the curse toast carry the take.)* At 0.5 s the **Legendary deal** opens: the draft overlay titled
  `PACT OF GREED`; every card is legendary so the draft reveal plays its full beat by itself. Pick, the world resumes.
- **Horde:** `sfx.pact.take`, the altar's flame turns red, a chip in the status corner's boost row
  `HORDE · next room x2`. Entering the next enemy room: edges flash `roomEdge.horde`, `sfx.horde.horn`, floor shout
  `HORDE x2`, score pops drawn in the horde colour with `x2`. Half the first wave down: spawn rings at the wave-2 tiles
  (1.0 s), `WAVE 2` shout. Clear: the tally plays, then a last **`HORDE x2`** segment slams in and doubles the number
  (0.4 s, `sfx.horde.double`).

### The Goldling

| When | What happens |
|---|---|
| Room engages + 3 s *(superseded: a player breaks its glinting barrel or crate; the flash at the piece, 0.12 s after its break; the rumours before it, docs/GOLDLING_RUMOURS.md "Player experience")* | A gold flash on the tile farthest from you, `sfx.golden.appear`, floor shout `GOLDLING!`, gold minimap blip in sight; first ever sighting: toast `A Goldling! Catch it before it escapes!` |
| Running (10 s) | Flees within the room, jinks sideways when you get within 2.5 tiles, slips past you rather than cornering itself. A gold ring under it shrinks with its time. A positional coin-jingle loop *(as built: no loop, the theme contract has no optional positional ambience; GE4 found a 6 u/s chaser corners it anyway, see "Open owner calls")* |
| Each hit | A coin burst, a `+50` pop, `sfx.golden.hit` climbing a scale |
| Last 3 s | Flicker, squeak, ring pulse (reduced motion: colour only) |
| Caught | Coin fountain, 40 ms freeze (solo, Freeze frame setting), `sfx.golden.jackpot` (ducks music), `+1,500` pop, boosts hop out |
| Escaped | Dives into a crack, `sfx.golden.escape`, `It got away!  +350 banked` |

It never attacks and does no contact damage.

## Rules

### Pacts

- **Endless only**, on floors with a shrine room. The tutorial keeps the classic shrine.
- **Altars:** two, placed at floor build; zone `SHRINE_RADIUS` around each cell centre; the classic centre zone is off.
  If an altar cell can't be found the floor keeps the classic shrine (PS1 census; target 0 %).
- **Greed, once per player per shrine.** Needs a curse left and a non-empty Legendary pool for that player.
  - The curse is fixed in advance (FD3): `pactCurseIndex(floorSeed, player, unusedCount)`, pure, no rng draw, the
    view recomputes it from hashed state. Accepting runs `acceptCurse` + `addCurse`, then opens the deal.
  - **The deal** (`drawLegendaryOffers`, main rng): up to 3 cards from the pool (unowned legendary boons, available
    duos, owned level-II boons -> their evolution), one `rngInt` pick each without repeats; with fewer than 3, the rest
    are ordinary upgrade cards, so the deal is 3 cards whenever anything is upgradable. `draftsLeft` 1. Per-player
    `draftKind` = GREED (hashed) for the HUD title.
- **Horde, once per party per shrine.** Needs an enemy room (planned spawns, never the boss room) nobody has entered.
  - Accept arms it. The **next** such room any living player enters is the horde room.
  - **Wave 2** = the room's planned kinds again in order, **no affixes**, capped at `hordeMaxWave` (10) and the pool.
    Trigger: living first-wave members <= floor(n / 2) (a 1-enemy room triggers when it dies); telegraph
    `waveTelegraphTicks` (60) at tiles chosen at the trigger through `safeRoomSpawns` (stored, hashed); spawn; append to
    the record. The record **can't clear** while wave 2 is armed but unspawned.
  - **x2:** kills of the record's members, its ROOMS / PERFECT / FAST, its pellets and Sweep (`bonusPercent` x 2); the
    extra half is booked to `ScoreSource.HORDE`. Not breakables, boosts or the floor clear.
  - Leaving the floor armed with no room entered: lapses silently.
- **Co-op:** altars are party state; Greed's draft freezes everyone like any draft (others see `hud.draft.waiting`).

### The Goldling

- **Endless only**, from floor 2. `placeGolden` on its own salt: one chance draw (30 % floors 2-4, 35 % 5-9, 40 % 10+),
  one weighted room pick over combat / elite rooms with planned spawns and >= `minRoomTiles` floor cells, never the boss
  room. `EndlessFloorLayout.golden?` / `EndlessFloorWorld.golden?` (`{ room }`; as built `FloorGolden`: the room plus
  its floor rectangle and walk mask, so the sim keeps it in the room without a Dungeon).
- **Appears** `appearTicks` (180) after its room's record engages, on the room's spawn tile farthest from every living
  player; a full pool skips it. *(Superseded: it hides in its own piece and comes out at the piece's cell centre the tick
  a player breaks it; `appearTicks` is gone. docs/GOLDLING_RUMOURS.md "Rules".)* **Not a room member** (the room clears without it; no PERFECT effect; no affixes); it
  keeps running after the clear until its time is up.
- **Moves** at 5.1 within its room's FLOOR cells (breakables blocked) on a **flee field**: multi-source BFS from every
  living player over the room box every `fieldTicks` (6), with the `-1.2 x distance` re-relax so a cornered Goldling
  slips past. **Jink:** a player within 2.5 and a 1.5 s cooldown ready -> 0.25 s sidestep at 9 u/s perpendicular to the
  nearest player's bearing, side from the golden stream. No Warbanner aura.
- **hp** `GOLDEN.hp` (start 10) through endless and party hp scaling; about 6-8 sword hits on floor 2 (GE4 tunes).
  *As built: `GOLDEN_HP` 24 (the archetype's data); 10 took 3 port-sword hits on floor 2, 24 takes 7.*
- **Payouts** (`ScoreSource.GOLDEN`, usual multipliers): each damaging hit `hitPoints` (50) x floor scale, no combo
  feed; kill `killPoints` (1500) x floor scale (the kill feeds the combo once) and `partySize + 1` boosts (kinds from
  the golden stream with the BOOSTS weights, a fixed ring of offsets, lowest free slots; full ground loses one).
- **Escape** at `escapeTicks` (600) after appearing: `freeActor` (no onDeath, score or drops); coins won stay.
- Floor change: gone. Builds procs treat it like any actor.

## Design

1. **Dungeon (pure).** `shared/dungeon/pacts.ts` + `pactsData.ts` (`PACTS`, `placePactAltars`, `pactCurseIndex`), run
   after solid decor, breakables and pellets. `shared/dungeon/golden.ts` + `goldenData.ts` (`GOLDEN_PLACE`,
   `placeGolden`, `fleeField(d, box, sources, blocked, out)` allocation-free). Layout / world gain `pactAltars?`,
   `golden?`; stage pre-gen builds them with the floor. *(As built: `fleeField(open, w, h, sources, sourceCount, out,
   scratch, factor)` over a box mask the caller builds, plus `fleeStep`; altars and the Goldling both run last in
   `buildEndlessFloor`.)*
2. **Sim pacts** `shared/sim/pacts/`: `PactsConfig` (`legendaryCards` 3, `hordeMaxWave` 10, `waveTelegraphTicks` 60,
   `hordePercent` 200, `debug?`), `PactKind { GREED: 0, HORDE: 1 }` (append only), `PactsState` (per-player
   `greedTaken`, `hordeTaken`, per-player `draftKind`, `horde { armed, room, record, firstWave, waveDueTick, waveX[],
   waveZ[], waveKinds[], spawned }`, run counters `taken[]`, unhashed `events`). `stepPacts` in stepRun slot 5; Horde's
   room-entered hook in `enterRoom`; `stepPactsWave` just before `stepScore`; `pactHoldsRoom` / `pactRoomPercent` hooks
   in score.ts; `openLegendaryDraft` reuses `dealOffers`. *(As built: `PactsConfig.floor?` (specs without endless)
   instead of `debug?`; step.ts calls `stepPacts` right after `stepRun`, not inside it (stepPacts requires
   progression: a require cycle); the draft opens through `openDealtDraft`; plus `holdAbsoluteTimers`, see "As
   built".)*
3. **Sim golden:** `combat/actors/archetypes/golden.ts` (band 5, index 18, states `GOLDEN_RUN` / `GOLDEN_JINK`, v slots
   ticksLeft / jinkCooldown / hitsTaken, `onHit` method books coins, no contact damage, not a room enemy for
   engagement, in `DROP_INELIGIBLE_ARCHETYPES`, no aura). `shared/sim/golden/` `GoldenState` (own `rngState`, status
   NONE / WAITING / RUNNING / CAUGHT / ESCAPED, room, record, appearTick, actorSlot, actorId, coins, run counters
   `seen` / `caught`, unhashed events), `stepGolden` after `stepScore`. *(As built: status SKIPPED appended (a full
   pool); also engageTick, hits, `escaped`, the field's `fieldTick` / `src`; v slots add the jink's direction.)*
4. **Worlds:** absent in M1 / fixtures / tutorial; `ENDLESS_PACTS_CONFIG` / `ENDLESS_GOLDEN_CONFIG` in
   `buildEndlessRunConfig`; dev world the same plus `KV_FortuneDebug` overrides (debug runs never count). *(As built:
   the dev world spreads the endless config; `KV_FortuneDebug` is not built.)*
5. **View** (presentation only): `shared/view/pacts/`, `shared/view/golden/` (frame events on `RunView`, text, timelines),
   `PactRenderController`, `GoldenRenderController`, room-clear `horde` segment, draft title from `draftKind`,
   `roomEdge.horde`, minimap gold blip, `bestiary.golden` sighting, touch auto-target (after any enemy within 3 tiles),
   cue mapper (`sfx.pact.take`, `sfx.horde.horn` / `.wave` / `.double`, `sfx.golden.appear` / `.hit` (ladder) /
   `.jackpot` (ducking) / `.escape`, `amb.golden.loop`), debug labels. *(As built: no `amb.golden.loop`, so eight
   sounds, not nine.)*
6. **Theme:** `pact.altar` (required, placeholder plinth), `enemy.golden` in `ENEMY_ARCHETYPES` (+ `.name` "Goldling",
   placeholder gold block), optional `fx.golden.coin`; roles `roomEdge.horde`, `pact.greed`, `pact.horde`,
   `golden.coin` (`fortuneReport` folded into an existing report: >= 3:1 on biome floors, >= 40 CIE76 from enemy-bullet
   roles and `telegraph`, coin >= 30 from `pellet.normal`); strings with l10n context; the audio IDs in
   `PORT_AUDIO_EVENTS` (SILENT in the placeholder) with fallbacks to existing clips. No new top-level Luau locals.
7. **Server / lockstep:** nothing new to run; bench re-run; daily ruleset 6 (8 with treasure rooms merged).

## Tasks

- [x] **FO0. Confirm the code assumptions** (mid-floor draft path, aura shape, auto-target ranking, room cell iteration,
  altar geometry, salts, fallback audio IDs, Luau locals).
- [x] **PS1. Altars (dungeon).** → Verify: pure, FLOOR, not solid, not on pellets, reachable, zones apart; every other
  floor output identical; census (fallback rate 0).
- [x] **PS2. Pacts sim state and hash.** → Verify: fixtures, M1, tutorial unchanged without the config; a pacts run
  without presses draws exactly as a no-pacts run.
- [x] **PS3. Greed.** → Verify: once per player; dim cases; the shown curse is applied; deal composition; freeze and
  resume; co-op 2-4.
- [x] **PS4. Horde.** → Verify: 1- and 8-enemy rooms; no clear between waves; PERFECT over both waves; pool cap;
  affix-free; lapse on floor change; never the boss room; exact x2 totals with Bounty, affixes and Gold Rush.
- [x] **PS5. Pacts worlds and bot census.** → Verify: `npm run verify`; numbers in this doc.
- [x] **GE1. Goldling roll and flee field.** → Verify: pure; rate per band; never boss room.
- [x] **GE2. Goldling archetype and state.** → Verify: appears at engage + 180 farthest *(superseded by
  docs/GOLDLING_RUMOURS.md GR2: on its piece's break)*; not a member; stays in its
  room; slips out of a corner; escapes at 600; replays bit-identically; absent config unchanged.
- [x] **GE3. Goldling payouts.** → Verify: no combo feed per hit; one on the kill; party 1-4 boosts; full ground; main
  and drops rng identical to a no-golden twin.
- [x] **GE4. Goldling tuning census** (sword / bow, solo / party, floors 2 / 6 / 12; target catch 50-65 % solo).
- [x] **FO6. Theme.** **FO7. Pacts view.** **FO8. Goldling view.** **FO9. Audio cue mapper.**
- [ ] **FO10. [owner] Art and audio** (gold recolour via a pipeline `recolor` option, altar art, nine sounds; eight as
  built, no `amb.golden.loop`). The recolour is built (2026-11-04, docs/ART.md "Recolour"): `enemy.golden` = the
  swarmer's skeleton on a gold luminance ramp, bodyTiles 0.95, `golden-move.png` / `golden-death.png` + their two
  outline sheets, uploaded 2026-11-04 5:03 PM (ids in `assetIds.ts`, so the bundled vale pack draws it). The altar
  and the coin burst are built (2026-11-06, presentation only; "Altar and coin art" below): original pixel art,
  `pact-altar.png` / `golden-coin.png`, uploaded 2026-11-06 6:04 PM (ids in `assetIds.ts`, so the bundled vale pack
  draws both); the sounds pending.
- [ ] **FO11. Telemetry (optional).** Pending.
- [x] **FO12. Docs** (this doc as built, CLAUDE.md log, sim README, CLIENT.md, DAILY.md).
- [ ] **FO13. [owner] Playtest.** Pending.

## Decisions (all confirmed by the owner, Kaleb, 2026-11-03)

- **FD1.** Two altars in the shrine room, walk-on + the shrine button.
- **FD2.** v1 pacts are Greed and Horde; the classic curse-only shrine retires on endless (the tutorial keeps it).
- **FD3.** Greed shows the exact curse in advance (pure pick, no draw).
- **FD4.** Greed's Legendary is a 3-card Legendary deal now (filled with upgrades), freezing the world like every draft.
- **FD5.** Greed's curse keeps today's +0.25 team multiplier.
- **FD6.** Greed once per player per shrine; Horde once per party.
- **FD7.** Horde is a second wave (same kinds, no affixes, at half down, 1 s telegraph; no clear between waves).
- **FD8.** Horde doubles everything the room pays (kills, room / perfect / fast, pellets, Sweep).
- **FD9.** The Goldling is its own archetype (band 5).
- **FD10.** Room-bound, 3 s after engaging, not a room member, 10 s to escape. *(The 3 s superseded by
  docs/GOLDLING_RUMOURS.md RD10: it comes out of its own barrel or crate when a player breaks it.)*
- **FD11.** Harmless.
- **FD12.** Coins per hit (no combo feed), jackpot on the kill (1500 x floor scale + party size + 1 boosts).
- **FD13.** 30 / 35 / 40 % of floors by band from floor 2.
- **FD14.** Art: a gold recolour of an existing small set for v1.
- **FD15.** Daily ruleset bumps; all-time boards stay `_v1` before launch.
- **FD16.** Touch auto-target includes the Goldling after any enemy within 3 tiles.

## Risks

Power creep (Legendary on shrine floors); Horde deaths feeling like a trap; the chase pulling players into bullets;
readability of cards, rings and coins; a thin Legendary pool early; Luau locals in contract / validate; mid-floor draft
side effects.

## As built (2026-11-04)

Branch `fortune` from `main` @ `82c2af6`, built by sub-branches `fortune-pacts` (PS1-PS5), `fortune-golden`
(GE1-GE4), `fortune-view-pacts` (FO7, FO9 pacts half) and `fortune-view-golden` (FO8, FO9 Goldling half), with FO0
and FO6 on the branch, then three review fixes: the Goldling's sim stream got its own salt, `pactsSpent` counts a
Horde with no room left as spent, and the mid-floor freeze holds the absolute-tick timers. Both features are endless
only: M1, every golden fixture and the tutorial (the classic shrine) replay exactly as before.

- **Hash and score.** *(Numbers on the branch; on main since the merge: groups `... pellets, treasure, pacts, golden`,
  sources `TREASURE` 12, `HORDE` 13, `GOLDEN` 14, 15 entries in an endless run, `DAILY.ruleset` 8; "Merge with main"
  below.)* Hash groups end `... pellets, pacts, golden` (each appended only when its state exists). Score
  sources `HORDE` 12 (pacts runs only, `addPactScoreSources`) and `GOLDEN` 13 (Goldling runs only,
  `addGoldenScoreSources`; a Goldling run without pacts pads HORDE at 0, the pellets / JACKPOT pattern). An endless
  run's points / counts hold 12 entries without either, 13 with pacts, 14 with the Goldling (or both).
  `DAILY.ruleset` 5 -> 6 (one bump for both); the all-time boards stay `_v1` (FD15).

### Merge with main (2026-11-04)

`fortune` merged into `main` @ `59fbd6e` (treasure rooms, docs/TREASURE.md, plus the run recap, bookshelves / reading
area and art ids). Main's treasure landed first, so Fortune moved after it; both features kept whole.

- **Hash groups** `... pellets, treasure, pacts, golden`; **score sources** `TREASURE` 12, `HORDE` 13, `GOLDEN` 14, each
  gated on its config and padding the lower gated ones (`addPactScoreSources` pads TREASURE, `addGoldenScoreSources`
  TREASURE and HORDE). An endless run's points / counts hold 15 entries (13 with treasure alone, 14 with pacts and no
  Goldling). `sourceName`, `SCORE_SOURCE_KEYS` (and the run-over breakdown), the specs that pin counts and order moved.
  **`DAILY.ruleset` 7 -> 8.** Salts: treasure's `0xb5297a4d` (vault roll) and `0x4b565452` (treasure stream) do not
  collide with Fortune's three; the Goldling keeps band 5, index 18 (main added no archetype).
- **Floor order** in `buildEndlessFloor`: pellets, the vault, the pact altars (reading the pieces with the chest), the
  Goldling's room. Main's floors are unchanged by the merge but for the two new fields.
- **Tick order:** stepScore, stepTreasure, stepGolden (step.ts: 8 / 8b / 9 in `step`, 9 / 9b / 10 in `stepParty`).
- **`holdAbsoluteTimers`** also moves a live vault lock's (ARMED / CRACKED) `armTick` and `crackTick`, so `armTick`
  stays the record's `engageTick` and a SWIFT clear's `missBy` counts live ticks only; SWIFT's `ticksLeft` is a
  countdown of live steps already (`pacts/freeze.spec.ts`, two new cases).
- **A Horde room that is the vault room** (`pacts/pactsTreasure.spec.ts`): the lock arms once, the chest cannot unlock
  between the waves (`pactHoldsRoom` holds the record's clear), ROOMS pays once, the chest's TREASURE award is not
  doubled (it is not one of the room's x2 awards). Fixed on the merge: SWIFT's countdown was fixed at the arm from the
  first wave's par while FAST's par grows with wave 2, so SWIFT could crack while FAST still paid. Now SWIFT does not
  crack while the horde record's wave 2 is pending and `vaultParGrown` (stepPacts' spawn, treasure/stepTreasure.ts)
  adds `swiftTicks(new par) - swiftTicks(old par)` when it spawns: SWIFT at 100 % is exactly FAST over both waves.
- **The chest and the Goldling** (`golden/goldenVault.spec.ts`): the chest is an intact breakables piece that never
  breaks, so its cell is blocked in the flee field (the walk mask still has the FLOOR cell), and it is never a spawn
  tile (main's `roomSpawnTiles` drop it).
- **Greed and the bonus deal** (`pacts/pactsTreasure.spec.ts`): Greed's one deal (`openDealtDraft`, `draftsLeft` 1)
  never takes a Legendary chest's pending `bonusDeals`; the next floor's draft deals floor deals + the bonus with
  `draftKind` reset. Not changed (main's, view only): `draftRedealt`'s "Pick again" compares `draftsLeft` with the
  floor's deals, so a bonus deal's extra re-deal is labelled one deal late.
- **Run recap:** it reads sources by name (`ScoreSource.BOSS` / `PERFECT` / `ROOMS` / `GRAZES` / `FAST` / `SWEEP`), so
  the renumbering moves nothing; no Horde / Goldling highlight (RUN_RECAP.md has none).
- **Theme:** both sides kept (the `pact.` slot inline in `SLOTS` after `TREASURE`; `WORLD_ART_SLOTS` a filter in
  SLOTS order, treasure before pact; `FX_IDS` in a function with `fx.golden.coin` before the boost spread and
  `fx.treasure.column` after it; port audio IDs pellets, co-op moments, treasure, Fortune). **Luau locals (out/):
  `contract.luau` 185, `validate.luau` 196.**
- **View / client:** `AudioCueMapper.frame` takes `syncs`, `treasure`, `pacts`, `golden` (trailing, defaulted); the
  Legendary chest jingle and the Goldling's jackpot both rank 73 (the chest's is cued first and wins a shared frame);
  `JINGLE_SFX` lists the chest's before the jackpot. Minimap layers: vault 3, ..., enemy 6, Goldling 7. Particle
  palette: team pulse, treasure tiers, then `golden.coin`. Boost drops hop out of a chest (after the lid's pop) or a
  Goldling catch. Floor shouts unchanged (treasure has none: its lines are toasts).
- **Verify (merged tree, this host):** typecheck, lint, check:assets, check:autolocalize, test:art, test:checks,
  test:l10n, build and `build:place` clean; headless tests 365 suites, 4906 passed, 2 failed: the known host-only
  `dungeon/forge/forge.spec.ts` seedToState vectors (NaN sign bit) and `sim/hash.spec.ts`'s group-order pin (main's,
  written before Fortune: fixed in the follow-up commit, passing).

### Hiding places and rumours (docs/GOLDLING_RUMOURS.md, 2026-11-12)

Branch `goldling-rumours` (GR0-GR9; owner tasks GR10-GR12 and RD3-RD7 / RD9 pending). Gameplay for the Goldling only;
M1, every fixture and the tutorial replay as before; endless replays and scores changed, boards stay `_v1`,
`DAILY.ruleset` 17 -> 18 (after the floor modifiers' 16 and DSD18's 17). A Gilded floor's certain Goldling hides in its piece too.

- **Appear rule:** no more "3 s after its room engages on the farthest spawn tile" (FD10's delay, `appearTicks`,
  `GOLDEN_APPEAR_TICKS`, `goldenSpawnTile`, the freeze's waiting branch: gone). It hides (WAITING) until a player breaks
  its piece and comes out at the piece's cell centre on the break tick (`releaseTick`); never found, it stays hidden
  until the floor ends. A full pool at the break: SKIPPED, as before.
- **Its piece:** `placeGolden` also places its own barrel or crate in its room (a cell the clutter rules and every
  piece so far allow, off pellets and the vault chest's front; two more draws, 4 on a hit), appended after every other
  piece (after the chest), so nothing else on the floor moves; a room needs such a cell to be eligible, and the
  Goldling floor rate is unchanged (GR1 census: 296 of 760 floors, none lost). It never holds loot.
- **Players only:** enemy bullets, the boss's slam, a Bomber's blast and a Charger's charge never damage it (refused
  like the chest's: bullets stop on it, the Charger stuns).
- **Glint:** it glints exactly like a loot piece while it hides (`pieceGlints`), so a room can show two glints.
- **Rumours** (presentation): a soft coin jingle and the chip `Coins jingling...` 1 s into a floor where one hides,
  a brighter jingle and `It's hiding here!` when its room engages (teammate volume from outside it), a first-time card
  once per account; two silent port audio IDs (`sfx.golden.rumour.floor` / `.room`, GR10 picks the clips).
- **Hash:** `releaseTick` and `piece` appended at the end of the `golden` group.
- **Census (GR8, the hunt; it replaces GE4's table above):** from the floor's spawn to the glinting piece, then the
  chase. Solo sword 17 / 18 focused, 17 / 18 during the fight, 18 / 18 after the clear; Archer bow 6 / 18 focused, 7 / 18
  after the clear (floor 2, plus one on floor 6); sword party of 2 16 / 18. Every sword miss was SKIPPED (a full actor
  pool on floor 12), none an escape. Table and notes in docs/GOLDLING_RUMOURS.md "As built", "Census"; open calls 2 and
  3 below.

### Open owner calls

1. **Greed's deal is short.** The deal fills with ordinary upgrades (owned level-I boons) only, so from floor 4 it is
   usually 2 cards (census below). Fill with new boons too?
2. **The Goldling's depth scaling.** Its hp scales with the floor like any enemy, but the window is a fixed 10 s: the
   focused solo sword catches 6 / 6 on floors 2 and 6 but 3 / 6 on floor 12, and fighting the room 5 / 6, 1 / 6, 0 / 6.
   Scale the window, cap the hp, or accept it?
   *GR8 (hiding places, 2026-11-12):* the call has turned around. It now comes out of its piece within sword reach of
   whoever broke it, so the solo sword catches 17 / 18 focused, 17 / 18 during the fight (it plays exactly as focused:
   the bot never leaves it) and 18 / 18 after the clear, floor 12 included (25 hits, 8.8-9.0 of the 10 s; hp 101.5).
   Against the plan's 50-65 % the sword's catch is now too easy, not too hard: the lever is the release (a head start
   or a dash away from the breaker, a shorter window), not the depth scaling, which only shows in the time to catch.
3. **The bow.** The solo bow caught 6 / 6 on floor 2, then 0 / 6 on floors 6 and 12. A bow-specific lever, or accept?
   *GR8:* the bow is now the Archer's (GE4's rows swapped to the Knight's weapon set 1, empty since docs/ARCHER.md, and
   read 0 / 6). With the stream led onto it: focused 6 / 6, 0 / 6, 0 / 6; after the clear 6 / 6, 1 / 6, 0 / 6. The cap
   is the stream's damage, 5 arrows / s x 1 = 5 hp / s, so the floor-6 Goldling (50.4 hp) needs 10 s of perfect hits;
   the bot never charges the heavy arrow. Still open: a bow lever (Goldling hp per weapon, arrows that pay double on
   it) or accept a sword-only jackpot past floor 2.
4. **"Slips past" did not hold.** The flee field's re-relax does make a cornered Goldling run past the player on the
   field (fleeField spec), but at factor 1.2, 2 or 3 a 6 u/s chaser corners a 5.1 u/s runner in any 17 x 17 room
   (GE4). Kept 1.2 (`GoldenConfig.fleeFactor`); a faster runner or a bigger jink is the lever.
5. **`pact.greed` vs `enemy.golden`.** `#ffc800` and `#f5c400` are 3.5 CIE76 apart: Greed's altar flame and card read
   in the Goldling's gold. Nothing validates that pair; on purpose (treasure gold) or move one?
6. **The Horde crimson.** `pact.horde` / `roomEdge.horde` `#ff0040` is 8.3 CIE76 from `combo.carnage` (`#ff2050`)
   and 15.5 from the enemy outline red (`#ff3b30`): all hot and hostile on purpose, but a Horde pop next to a CARNAGE
   meter is close. Keep?
7. **Horde death risk** is not measured (the census tops hearts up; it counts hits: 15 with the Horde against 9 for the
   twins over 8 rooms).

### Pacts

**Floor side (PS1).** `shared/dungeon` `pactsData.ts` (`PACTS`, `PactKind`) and `pacts.ts`: `placePactAltars` puts
Greed screen-left and the Horde screen-right of the crystal (the shrine room's centre floor cell) on the
screen-horizontal line, a mirrored pair at the first of `offsetSteps` [3, 4, 2, 5, 6, 7] where both fit; a cell fits
when every cell within `clearCells` (1) is FLOOR of the shrine room, holds no breakable or pellet, and is reachable from
the entrance. When nothing fits on the crystal's line (a small room whose statue stands on it), the whole pair shifts
1-3 steps screen-up / down (`PACTS.shiftSteps` 0, 1, -1, 2, -2, 3, -3), then each side alone. No draw; run last in
`buildEndlessFloor`, so nothing else on the floor moves. `pactCurseIndex(floorSeed, player, unusedCount)` is the
curse Greed shows, one draw of its own stream (floor seed ^ salt `0x5c3a91e7` ^ `imul(player + 1, playerMul)`), so
each player sees their own and the view recomputes it. Layout / world field: `pactAltars` (`FloorPacts { room, seed,
altars }`). Census (runs 1-20 x floors 1-20): 391 of 400 floors have a shrine, every one got both altars (fallback 0),
11 of them shifted.

**Sim (PS2-PS5).** `sim/pacts/`: `pactsData.ts` (`PACT_LEGENDARY_CARDS` 3, `HORDE_MAX_WAVE` 10,
`HORDE_WAVE_TELEGRAPH_TICKS` 60, `HORDE_PERCENT` 200, `PactDim`), `pacts.ts` (`PactsConfig`, `ENDLESS_PACTS_CONFIG`,
state, `pactsOnFloor`, clone, hash), `pactRooms.ts` (the leaf endless.ts and score.ts call), `stepPacts.ts`,
`holdTimers.ts`.

- Tick: step.ts calls `stepPacts` right after `stepRun` (not inside it: stepPacts requires progression, a require
  cycle) and `stepPactsWave` between `stepPellets` and `stepScore`, in `step` and `stepParty`. `stepPacts` skips a
  floor-change tick. On a floor whose altars stand the classic shrine zone and the sim's `atShrine` are off; a floor
  without altars keeps the classic shrine.
- **Greed:** a SHRINE_BUTTON press edge in an altar's zone with the pact available: `acceptCurse` on the shown curse
  (+0.25), then `drawLegendaryOffers` (main rng) opened through `openDealtDraft` (one deal: `draftsLeft` 1, no
  re-deal; the next floor's draft unchanged), `draftKind` GREED (hashed, the HUD title). The legendary pool
  (`legendaryPool`): unowned legendary boons, available duos, level-II boons' evolutions; one `rngInt` per card, then
  filled with level-I upgrades. Without builds: the unowned legendary classic boons.
- **Dim reasons** (`PactDim`): TAKEN, NO_CURSE, NO_LEGENDARY, NO_ROOM and an extra UNABLE (no altars here, or a dead /
  departed player).
- **Horde:** the take arms it; `pactsOnRoomSpawned` (endless.ts `enterRoom`) makes the next room with planned spawns
  anyone enters the horde room. It needs scoring (the record carries the wave and the x2): without `state.score` the
  altar dims NO_ROOM. A first wave that got no slots still makes the horde room (its wave 2 then triggers at once).
  Wave 2 (planned kinds in order, at most 10, through `safeRoomSpawns`, no affixes) is telegraphed once the living
  first-wave members are at most floor(n / 2), spawns 60 ticks later, and joins the record through
  `appendScoreRoomMembers`, whose par grows by the wave's encounter cost x `ROOM_PAR_TICKS_PER_COST` plus the
  telegraph. The record may not clear before the wave spawned (`pactHoldsRoom`). The x2 (`awardX`: each source books
  its x1 award, HORDE the rest) covers the record's kills (adopted children and wave 2 included), ROOMS / PERFECT /
  FAST, pellets and Sweep; power pellet conversions and the Jackpot are not doubled. Lapses on the floor change.
- **Mid-floor freeze** (review fix): every open draft freezes the world while `state.tick` counts, and Greed opens one
  mid-floor. `holdAbsoluteTimers` (`sim/pacts/holdTimers.ts`), only with `state.pacts`, runs on every frozen draft
  tick and shifts one tick forward: the `engageTick` of engaged, uncleared score records; the Horde's pending
  `waveDueTick`; the waiting Goldling's `appearTick` / `engageTick` and a running one's `fieldTick`; an armed Vengeful
  corpse's `vengeArmTick`. So a teammate's Greed draft never eats FAST par, the telegraph or the Goldling's delay. All
  are hashed already; a no-op on floor-change drafts. *(The waiting branch superseded by docs/GOLDLING_RUMOURS.md GR2:
  a hidden Goldling has no timer; a running one's `fieldTick` still moves.)*
- View queries (pure reads of hashed state): `pactAltarAt`, `pactAvailability`, `greedCurseFor`, `hordePhase`,
  `pactAltarOffered`, `pactDraftKind`, `greedTakes`, `pactsSpent` (takes the SimConfig: the Horde counts as spent when
  taken or NO_ROOM, so the crystal dims).
- FO0 readers fixed: a Greed deal on the floor after a boss floor no longer reads as the double draft's re-deal; the
  snapshot's `atShrine` is also true on an offered altar (the hint and the touch shrine button show).
- Worlds (PS5): `ENDLESS_PACTS_CONFIG` in both branches of `buildEndlessRunConfig` (daily and dev follow); the endless
  test bot takes Greed and the Horde on an altar floor (`run/testing/pactsBot.ts`).

**Census (`run/pactsCensus.spec.ts`).** Greed's deal over 400 simulated builds (greedy picks):

| Floor | Greed available | Legendary cards | All 3 legendary | Under 3 cards | Cards |
|---|---|---|---|---|---|
| 2 | 100 % | 1.94 | 0.0 % | 6.5 % | 2.87 |
| 4 | 99.5 % | 2.00 | 0.8 % | 99.2 % | 2.01 |
| 6 | 98.0 % | 2.06 | 9.4 % | 90.3 % | 2.10 |
| 11 | 95.5 % | 2.13 | 29.3 % | 64.9 % | 2.32 |
| 16 | 93.5 % | 2.05 | 34.5 % | 48.7 % | 2.34 |

The Horde (sword bot, solo, 8 seeds, the first altar floor's nearest enemy room against a twin without it): 7 of 8
horde rooms cleared (the twins 7 too; seed 23's room never triggered wave 2 in 90 s), room points 46 947 vs 12 577
(x3.73), HORDE 49.5 % of the horde rooms' points. Death risk not measured (hearts topped up).

### Goldling

**Floor side (GE1).** `shared/dungeon` `goldenData.ts` (`GOLDEN_PLACE`, `GOLDEN_FLEE`) and `golden.ts`:
`placeGolden` (salt `0x3d2f8b4d`, run last in `buildEndlessFloor`): from floor 2 one chance draw at 30 / 35 / 40 % by
band (floors 2-4 / 5-9 / 10+), then one weighted room draw over combat / elite rooms (weights 1 / 1: the plan named
none) with planned spawns and at least `minRoomTiles` 100 FLOOR cells, never the boss room. `FloorGolden` carries the
room, its floor rectangle and walk mask. `fleeField(open, w, h, sources, sourceCount, out, scratch, factor)`: a
multi-source BFS, then the `-factor x D` re-relax as an exact unit-step Dijkstra; allocation-free (`newFleeScratch`);
`fleeStep` walks it downhill (8 neighbours).

**Sim (GE2, GE3).** Archetype `golden` (`combat/actors/archetypes/golden.ts`), band `PORT_BAND_FORTUNE` 5, index 18:
`GOLDEN_HP` 24 (raised from the plan's 10 by GE4), radius 0.3, 5.1 u/s, harmless, not a room enemy (never a record
member, never aggroed, alerting or in a Warbanner aura), in `DROP_INELIGIBLE_ARCHETYPES`. `sim/golden/`:
`goldenData.ts`, `golden.ts` (`GoldenConfig`, `ENDLESS_GOLDEN_CONFIG`, state, `goldenOnFloor`, clone, hash),
`goldenField.ts`, `goldenHooks.ts`, `stepGolden.ts`.

- Its own sim stream: `seedToState(seed) ^ 0x7a3c5e91` (`GOLDEN_SIM_SALT`; not the floor roll's salt), drawn only for a
  jink's side and the catch's boost kinds.
- Status NONE / WAITING / RUNNING / CAUGHT / ESCAPED / SKIPPED (SKIPPED: due with the actor pool full). `stepGolden`
  (after `stepScore`) spawns it `appearTicks` (180) after its room's record engages, on the room's spawn tile farthest
  from every living player, and frees it `escapeTicks` (600) later (no onDeath, score or drops; coins kept).
  *(Superseded: it spawns at its piece's cell centre the tick a player broke the piece; `appearTicks`,
  `GOLDEN_APPEAR_TICKS` and `goldenSpawnTile` are gone. docs/GOLDLING_RUMOURS.md GR2.)*
- Moves on the flee field (flee factor 1.2, `GoldenConfig.fleeFactor`), sources = living players inside its room's
  rectangle re-read every 6 ticks; with no player inside its room it stands still. Jink: a player within 2.5, cooldown
  1.5 s, 0.25 s at 9 u/s. Every step is kept inside the walk mask.
- Payouts (`ScoreSource.GOLDEN`): each damaging hit `scoreGoldenHit`, 50 x the kills' floor scale, no combo feed; the
  catch pays 1500 x the floor scale into GOLDEN instead of KILLS (the kill's Bounty / affix / Gold Rush factors), feeds
  the combo once, and lands party size + 1 boosts (one golden-stream `weightedBoostKind` draw each, the fixed
  `GOLDEN_BOOST_RING`, lowest free slots; a full ground loses the rest with the same draws).
- Hashed (group `golden`, last): `rngState`, status, room, record, engage / appear ticks, actor slot / id, coins, hits,
  seen / caught / escaped, `fieldTick`, the source cells, then (docs/GOLDLING_RUMOURS.md GR3) `releaseTick` and
  `piece`. The walk mask enters through `room`; the field cache is a
  pure function of hashed state (unhashed).
- Worlds: `ENDLESS_GOLDEN_CONFIG` in `buildEndlessRunConfig` (solo, co-op; daily and dev follow).

**Census (GE4, `run/goldenCensus.spec.ts`; 6 Goldling floors per row, a chase bot; superseded by the GR8 hunt census
under "Hiding places and rumours", which rewrote the spec):**

| Bot | Floor 2 | Floor 6 | Floor 12 |
|---|---|---|---|
| Sword, solo, focused (upper bound) | 6 / 6, 7 hits, 3.6 s | 6 / 6, 13 hits, 6.1 s | 3 / 6, 23.3 hits, 8.9 s |
| Sword, solo, fighting the room (lower bound) | 5 / 6 | 1 / 6 | 0 / 6 |
| Bow, solo | 6 / 6, 26 hits, 7.0 s | 0 / 6 | 0 / 6 |
| Sword, party of 2 | 6 / 6 | 6 / 6 | 6 / 6 |

Solo sword: focused 15 of 18, fighting the room 6 of 18, bracketing the plan's 50-65 % target. hp 10 had caught 18 of
18 in 3 hits on floor 2.

### Theme (FO6)

- Asset `pact.altar` (a new required `pact.` world-art slot, inline in contract.ts `SLOTS`; placeholder stone plinth);
  `enemy.golden` in `ENEMY_ARCHETYPES` (name "Goldling", placeholder gold block); optional `fx.golden.coin`.
- Colour roles `roomEdge.horde` / `pact.horde` `#ff0040`, `pact.greed` `#ffc800`, `golden.coin` `#ffdc5a`;
  `enemy.golden` `#f5c400` (was `#c08000`: 25.5 CIE76 from the telegraph, now 44.5). `fortuneReport`
  (`fortuneColors.ts`), folded into `variantColorProblems`: >= 3:1 on every biome floor and >= 40 from the enemy
  bullets and telegraph, coins >= 30 from `pellet.normal`, the Goldling >= 40 from the bullets, telegraph and enemy
  outline.
- Strings (each with an l10n context entry): `pact.*` (cards, accept, five dim lines), `hud.draft.title.greed`,
  `hud.chip.horde`, `fx.horde.shout` / `.wave`, `room.clear.line.horde`, `hud.score.pop.horde`, `score.source.horde`
  / `.golden`, `fx.golden.shout` / `.escaped`, `bestiary.golden`.
- Eight port audio IDs (`sfx.pact.take`, `sfx.horde.horn` / `.wave` / `.double`, `sfx.golden.appear` / `.hit` /
  `.jackpot` / `.escape`), SILENT in the placeholder, each with an `SFX_FALLBACK` entry (shrine use, combo tier,
  summon, score land, power pellet, score tick, room perfect, combo break). No `amb.golden.loop`: the contract has no
  optional positional ambience.
- `contract.luau` / `validate.luau` still 186 / 196 top-level locals.

### Altar and coin art (FO10, 2026-11-06)

Presentation only (no sim, dungeon, lockstep, hash, replay, fixture or score change). Original pixel art drawn by
`scripts/art/gen-fortune-art.js` (art:build and art:lock run it first, like the vault cage) into
`art/vendor/kaleb-vale/pact-altar/` and `golden-coin/`; no licence, notices or Credits entry.

- **`pact.altar`**: a round stone altar (a two-step foot, a drum with a carved rune band, a cap slab) holding an iron
  fire bowl with a bed of coals, modelled as solids of revolution and ray-cast in the game camera's projection (55
  degrees, azimuth -45, 29.6 px a tile: gen-treasure-art.js' camera and sun), shaded from a 7-step neutral stone ramp
  and the cage's iron ramp with cast shadows, a dark rim on the shadow side and a dithered contact shadow. Round, so one
  facing. Neutral by design: the pact is still told by the view's Neon flame (in `pact.greed` / `pact.horde`) and the
  card. A one-facing world sprite set (`idle`, 1 frame, `Pixelated`), cell 31 x 32, pivot the footprint centre.
- **`fx.golden.coin`**: a greyscale one-shot (10 frames @ 20 fps, cell 29 x 30) tinted `golden.coin`: a four-point
  flash, 7 coins tossed out over an arc spinning face / three-quarter / edge, twinkles at the top and on landing, a
  one-pixel bounce, then they blink out. Vale look `sizeTiles` 1, not additive (the coins' dark rims would vanish);
  GoldenRenderController plays it on each hit and x `fountainFxScale` 1.6 on a catch.
- **Pipeline**: atlas group `fortune` (`--only fortune`, `--lock --only fortune`), each in a sheet of its own
  (`pact-altar.png`, `golden-coin.png`), generated `packs/vale/fortuneLayout.ts` (`VALE_PACT_ALTAR_LAYOUT`,
  `VALE_FORTUNE_FX_SHEET` / `_LAYOUTS`), so no shared atlas repacks. Vale maps the altar in `addWorldArt` and the coin
  burst as its fourth fx source (`VALE_FX_PENDING` keeps only the boost pickup burst). Each switches on once its PNG has
  an ID in `assetIds.ts`.
- **View**: PactRenderController draws altar art at its own scale (shared/view/pacts `altarArtFit`: capped at
  `PACTS_VIEW.artMaxHeightTiles` 1 above the pivot; `artHeightTiles` is gone) as an upright billboard of an image or a
  sprite set's `idle` frame 0 in its resample mode, and stands the flame on `PACTS_VIEW.artTopTiles` 0.64 (the coal
  bed, the generator's `ALTAR.coals`, scaled with any cap), so it rises out of the bowl. The plinth is unchanged.
- Tests: `scripts/art/gen-fortune-art.test.js`, `scripts/art/fortune.test.js`, vale `fortuneArt.spec.ts`,
  `pacts.spec.ts` (altarArtFit). Both PNGs uploaded 2026-11-06 6:04 PM. Open: the Studio check (the flame in the bowl,
  the burst's size).

### View (FO7-FO9)

**Pacts.** `shared/view/pacts` (frame events collected per tick on `RunView.pacts`, altar look, the floor card, hint
text, `GreedDealGap`, Horde helpers, `pactDebugText`); `PactRenderController` (folder / render step `KV_Pacts`: per
altar `pact.altar` (FO10 art at its own scale, the flame on its coal bed) or the plinth with a Neon flame, the floor card on the combo shout's construction, the take's disc
pulse, `HORDE x2` / `WAVE 2` shouts, wave 2's spawn rings); `HordeChip` (status corner's boost row, touch strip);
the shrine hint on an altar is the pact's title + accept line; the draft title from `draftKind` (`PACT OF GREED`);
Greed's reveal waits 0.5 s after the draft opens (`GreedDealGap`, confirm held); room edges `roomEdge.horde`; kill pops
in the horde room `ScorePopTone.HORDE` (`+N x2`); the room clear's last `horde` segment slams in (0.4 s longer) with
`sfx.horde.double`; the shrine run marker reads used on altar floors. Debug `KV_PactLabel`.

**Goldling.** `shared/view/golden` (frame events on `RunView.golden`, ring, flicker, hit ladder, freeze, hop match,
blip, strings, `goldenDebugText`); `GoldenRenderController` (folder / render step `KV_Golden`): a timer ring of 24
fixed floor pieces in `golden.coin`, pulsing in the last 3 s (reduced motion: colour only); the appear flash and
`GOLDLING!`; hit coins; the catch's coin fountain and 40 ms solo freeze (Freeze frame setting) plus `stamp` nudge; the
escape's puff and `It got away!  +N banked`. The hit sound climbs one major-scale step per hit (`goldenHitSpeed`,
`pelletEatSpeed`'s scale); the jackpot's own pop replaces its kill pop; the catch's boosts hop in, matched by drop slot
and landing tick; a minimap gold diamond while in sight; the body flickers in the last 3 s; touch auto-target ranks it
after any other actor within `goldenYieldTiles` 3 (FD16); first sighting `bestiary.golden`. Debug `KV_GoldenLabel`.

**Audio (FO9).** `AudioCueMapper.frame` takes the pact and Goldling events: `SFX_PRIORITY` horn 77, wave 87, double
61, pact take 70, appear 68, hit 53, jackpot 73 (a ducking jingle), escape 70. World sounds, not positional.

**Floor shout priorities** (`FLOOR_SHOUT_PRIORITY`): goldenAppear 4 > newBest 3 > horde 2 > rankThreshold =
goldenEscaped 1 > comboTier 0. A jackpot pop is never Horde-tinted.

### Tests

Specs: `dungeon/pacts.spec`, `dungeon/golden.spec`, `sim/pacts/{pacts,greed,horde,freeze}.spec`,
`sim/golden/{golden,payouts}.spec`, `run/pactsCensus.spec`, `run/goldenCensus.spec` (GR8's hunt since
docs/GOLDLING_RUMOURS.md), `theme/fortune.spec`,
`view/pacts/pacts.spec`, `view/golden/golden.spec`, `view/audio/{pactCues,goldenCues,fortuneCues}.spec`; the hash-group
order / count pins in the endless, affixes, dev, party progression, breakables, builds, pellets and progression specs
moved for `pacts` / `golden`. Known failures, both not Fortune's: `dungeon/forge/forge.spec.ts › EncounterRng is the
sim's new Rng(seed)` (a NaN's sign bit under Lune on Linux: `7ff8...` expected, `fff8...` received; the branch does not
touch the Forge or the rng) and `sim/bench.spec.ts` (a wall-clock budget, flaky under load).
Re-run for FO12 (headless, after a fresh build): the Fortune specs pass (dungeon pacts 7, golden 13; sim pacts 29,
golden 20; theme 11; view pacts 22, golden 13; view/audio 162), both censuses print the numbers above, and
forge.spec fails as described; the whole suite was not re-run (its dungeon censuses run for many minutes each).

## Studio check

Not run yet. In Studio (dev mode is allowed there), open the dev panel (**F2**), pick **seed 2, floor 2**: the floor
has altars (shrine room 10) and a Goldling in room 3. Seeds 6 / 9 / 10 at floor 2 and 4 / 5 at floor 3 have one too.
Turn on the Workspace booleans `KV_PactLabel` (each altar's availability, Greed's curse, the Horde's phase) and
`KV_GoldenLabel` (status, ticks left, hp). Dev runs are solo: the co-op checks need a lobby run.

- **Altar cards.** Two altars either side of the crystal on the screen-horizontal line, Greed gold, the Horde an
  ember; each card readable from the doorway, under every bullet, ducking near enemy bullets; Greed shows *your* curse;
  standing on an altar shows its hint (touch: the shrine button, Accept tinted); a dimmed altar shows its one line.
- **Greed.** The take's pulse and toast, the multiplier +0.25, then 0.5 s later the `PACT OF GREED` draft (up to 3
  cards); pick, the world resumes; Greed then dims for you; the crystal dims once nothing is left.
- **Horde.** The chip `HORDE · next room x2`; the next enemy room's edges in the Horde crimson, `HORDE x2` shout, x2
  pops; at half down the wave-2 rings fill for 1 s and `WAVE 2` shows; no clear before wave 2; the tally's last
  `Horde x2` segment slams in with `sfx.horde.double`. Leaving the floor armed: the chip goes, nothing else.
- **Goldling.** *(Superseded: the hiding place's checks and seeds are in docs/GOLDLING_RUMOURS.md "Studio check"; on
  seed 2 floor 2 it hides in room 3's glinting barrel at (60, 12).)* 3 s into room 3's fight: the flash on the far spawn
  tile, `GOLDLING!`, the first-sighting toast, the
  minimap diamond; the ring shrinks a piece at a time, pulses and the body flickers in the last 3 s; each hit a coin
  burst, a pop and a climbing note; a catch: fountain, 40 ms freeze, the big pop, boosts hopping in; an escape: the
  puff and `It got away!  +N banked`. It never hurts you; with nobody in its room it stands still.
- **Settings.** Reduced motion (no ring pulse or flicker, the take pulse fades in place), Particles Off (no bursts or
  pulse), Freeze frame off (no catch freeze), Screen shake off (no nudge), Room clear Off (`sfx.horde.double` at the
  clear, no tally), touch: auto-target prefers a threat within 3 tiles over the Goldling.
- **Co-op.** A teammate's Greed freezes everyone (`hud.draft.waiting` for the others) and an engaged room's FAST par,
  the wave-2 telegraph and the Goldling's delay *(gone: it waits for its piece)* resume where they stood; each player sees their own Greed curse; the
  Horde once per party; every client sees the same Goldling; the catch freeze is solo only.

## Floor modifiers (2026-11-12)

docs/FLOOR_MODIFIERS.md's boon **Gilded** (`Gilded · A Goldling is certain`, endless only, 2.0 % of non-boss floors in
its FM9 census) makes the Goldling certain: `placeGolden(..., { certain: true })` makes the chance draw and ignores its
result, so the room draw is a natural hit's. Only on floors whose own roll missed and that have an eligible room
(FMD7), so it always adds a Goldling; the floor's status chip pulses when it appears. The Goldling's rules, catch and
score are unchanged; a Goldling skipped by a full actor pool is the one accepted miss (FMD3).
