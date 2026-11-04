# Fortune: risk shrines (pacts) and the Goldling

Status (2026-11-03): **plan; the owner (Kaleb) confirmed every decision (FD1-FD16) on 2026-11-03, each the recommended
option.** Planned against `main` @ `82c2af6`. Work it task by task like `PLAN.md`; each task ends with a **Verify**.
Project copy: `claude/fortune-plan.md`. Sibling plan (unbuilt): `claude/treasure-rooms-plan.md` (vaults); whichever lands
second takes the next hash slot, salt and daily ruleset.

Goal: two hits of dopamine that come from the **player's choice** and a **chase**, not from more stat bonuses.

1. **Pacts (risk shrines).** The shrine room stops being a single "take a random curse" button. Two **altars** stand in
   it, each stating its bet up front:
   - **Pact of Greed**: *take this curse (shown on the altar), choose a Legendary now.*
   - **Pact of the Horde**: *the next room you enter fights twice the enemies and pays twice the score.*
2. **The Goldling (golden enemy).** On some floors, a few seconds into a room's fight, a small gold creature pops out
   and **runs**. Every hit sprays coins (points). Catch it within 10 s for a jackpot of points and boosts; too slow and
   it dives into a crack and is gone.

**Sim impact: both are gameplay**, opt-in like boosts / breakable loot / pellets:

- `SimConfig.pacts` and `SimConfig.golden` (endless only), each with its own state and **its own hash group appended
  last** (`pacts`, then `golden`, after `pellets`);
- floor-side rolls are pure dungeon functions on **their own salts**, so layouts, digests, props, spawns, pieces, loot,
  affixes, rosters, pellets and boss picks stay put;
- the main rng (`state.rngState`) is drawn **only** as a consequence of a pact the player took (the Legendary deal goes
  through the card draw, the way a boon pick does). The Goldling draws from its own stream.

M1, every golden fixture and the tutorial (it keeps today's classic shrine) replay exactly as before. Endless replays
and scores change: `DAILY.ruleset` 5 -> 6, all-time boards stay `_v1` (FD15).

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
| **Room spawns:** `enterRoom` spawns `world.roomSpawns[id]` through `safeRoomSpawns(state, planned, roomSpawnTiles[id])`, affixes for planned spawns only; a full pool (`MAX_ACTORS` 64) drops the rest | `sim/endless.ts` | Wave 2 = the planned kinds again through `safeRoomSpawns`, no affixes. The Goldling spawns on the room's spawn tile farthest from the players |
| `awardPoints(..., scalePercent, bonusPercent, extraPercent)`: exact integer factors; `scoreKill` passes bonus = affix x Bounty, extra = Gold Rush | `score.ts` | Horde x2 multiplies into `bonusPercent` |
| Gated score sources: `JACKPOT` 9 (builds), `PELLETS` 10 / `SWEEP` 11 (pellets) | `scoreData.ts` | Append `HORDE` 12 (pacts only) and `GOLDEN` 13 (golden only; pads HORDE when pacts is absent, the pellets/JACKPOT pattern) |
| Hash groups: the last is `pellets` | `sim/hashLayout.ts` | Append `pacts`, then `golden` |
| Salts in use: `0x165667b1`, `0x27220a95`, `0x27d4eb2f`, `0x4b564452`, `0x5bd1e995`, `0x7f4a7c15`, `0xcc9e2d51`, `0xe6546b64` | `src/shared` | Pacts salt `0x5c3a91e7`, golden salt `0x3d2f8b4d` (the floor roll), Goldling sim stream salt `0x7a3c5e91` (unused at 82c2af6) |
| `DAILY.ruleset` = 5 | `shared/daily/config.ts` | 6 |
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
  ticks up (+0.25). At 0.5 s the **Legendary deal** opens: the draft overlay titled `PACT OF GREED`; every card is
  legendary so the draft reveal plays its full beat by itself. Pick, the world resumes.
- **Horde:** `sfx.pact.take`, the altar's flame turns red, a chip in the status corner's boost row
  `HORDE · next room x2`. Entering the next enemy room: edges flash `roomEdge.horde`, `sfx.horde.horn`, floor shout
  `HORDE x2`, score pops drawn in the horde colour with `x2`. Half the first wave down: spawn rings at the wave-2 tiles
  (1.0 s), `WAVE 2` shout. Clear: the tally plays, then a last **`HORDE x2`** segment slams in and doubles the number
  (0.4 s, `sfx.horde.double`).

### The Goldling

| When | What happens |
|---|---|
| Room engages + 3 s | A gold flash on the tile farthest from you, `sfx.golden.appear`, floor shout `GOLDLING!`, gold minimap blip in sight; first ever sighting: toast `A Goldling! Catch it before it escapes!` |
| Running (10 s) | Flees within the room, jinks sideways when you get within 2.5 tiles, slips past you rather than cornering itself. A gold ring under it shrinks with its time. A positional coin-jingle loop |
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
  room. `EndlessFloorLayout.golden?` / `EndlessFloorWorld.golden?` (`{ room }`).
- **Appears** `appearTicks` (180) after its room's record engages, on the room's spawn tile farthest from every living
  player; a full pool skips it. **Not a room member** (the room clears without it; no PERFECT effect; no affixes); it
  keeps running after the clear until its time is up.
- **Moves** at 5.1 within its room's FLOOR cells (breakables blocked) on a **flee field**: multi-source BFS from every
  living player over the room box every `fieldTicks` (6), with the `-1.2 x distance` re-relax so a cornered Goldling
  slips past. **Jink:** a player within 2.5 and a 1.5 s cooldown ready -> 0.25 s sidestep at 9 u/s perpendicular to the
  nearest player's bearing, side from the golden stream. No Warbanner aura.
- **hp** `GOLDEN.hp` (start 10) through endless and party hp scaling; about 6-8 sword hits on floor 2 (GE4 tunes).
- **Payouts** (`ScoreSource.GOLDEN`, usual multipliers): each damaging hit `hitPoints` (50) x floor scale, no combo
  feed; kill `killPoints` (1500) x floor scale (the kill feeds the combo once) and `partySize + 1` boosts (kinds from
  the golden stream with the BOOSTS weights, a fixed ring of offsets, lowest free slots; full ground loses one).
- **Escape** at `escapeTicks` (600) after appearing: `freeActor` (no onDeath, score or drops); coins won stay.
- Floor change: gone. Builds procs treat it like any actor.

## Design

1. **Dungeon (pure).** `shared/dungeon/pacts.ts` + `pactsData.ts` (`PACTS`, `placePactAltars`, `pactCurseIndex`), run
   after solid decor, breakables and pellets. `shared/dungeon/golden.ts` + `goldenData.ts` (`GOLDEN_PLACE`,
   `placeGolden`, `fleeField(d, box, sources, blocked, out)` allocation-free). Layout / world gain `pactAltars?`,
   `golden?`; stage pre-gen builds them with the floor.
2. **Sim pacts** `shared/sim/pacts/`: `PactsConfig` (`legendaryCards` 3, `hordeMaxWave` 10, `waveTelegraphTicks` 60,
   `hordePercent` 200, `debug?`), `PactKind { GREED: 0, HORDE: 1 }` (append only), `PactsState` (per-player
   `greedTaken`, `hordeTaken`, per-player `draftKind`, `horde { armed, room, record, firstWave, waveDueTick, waveX[],
   waveZ[], waveKinds[], spawned }`, run counters `taken[]`, unhashed `events`). `stepPacts` in stepRun slot 5; Horde's
   room-entered hook in `enterRoom`; `stepPactsWave` just before `stepScore`; `pactHoldsRoom` / `pactRoomPercent` hooks
   in score.ts; `openLegendaryDraft` reuses `dealOffers`.
3. **Sim golden:** `combat/actors/archetypes/golden.ts` (band 5, index 18, states `GOLDEN_RUN` / `GOLDEN_JINK`, v slots
   ticksLeft / jinkCooldown / hitsTaken, `onHit` method books coins, no contact damage, not a room enemy for
   engagement, in `DROP_INELIGIBLE_ARCHETYPES`, no aura). `shared/sim/golden/` `GoldenState` (own `rngState`, status
   NONE / WAITING / RUNNING / CAUGHT / ESCAPED, room, record, appearTick, actorSlot, actorId, coins, run counters
   `seen` / `caught`, unhashed events), `stepGolden` after `stepScore`.
4. **Worlds:** absent in M1 / fixtures / tutorial; `ENDLESS_PACTS_CONFIG` / `ENDLESS_GOLDEN_CONFIG` in
   `buildEndlessRunConfig`; dev world the same plus `KV_FortuneDebug` overrides (debug runs never count).
5. **View** (presentation only): `shared/view/pacts/`, `shared/view/golden/` (frame events on `RunView`, text, timelines),
   `PactRenderController`, `GoldenRenderController`, room-clear `horde` segment, draft title from `draftKind`,
   `roomEdge.horde`, minimap gold blip, `bestiary.golden` sighting, touch auto-target (after any enemy within 3 tiles),
   cue mapper (`sfx.pact.take`, `sfx.horde.horn` / `.wave` / `.double`, `sfx.golden.appear` / `.hit` (ladder) /
   `.jackpot` (ducking) / `.escape`, `amb.golden.loop`), debug labels.
6. **Theme:** `pact.altar` (required, placeholder plinth), `enemy.golden` in `ENEMY_ARCHETYPES` (+ `.name` "Goldling",
   placeholder gold block), optional `fx.golden.coin`; roles `roomEdge.horde`, `pact.greed`, `pact.horde`,
   `golden.coin` (`fortuneReport` folded into an existing report: >= 3:1 on biome floors, >= 40 CIE76 from enemy-bullet
   roles and `telegraph`, coin >= 30 from `pellet.normal`); strings with l10n context; the audio IDs in
   `PORT_AUDIO_EVENTS` (SILENT in the placeholder) with fallbacks to existing clips. No new top-level Luau locals.
7. **Server / lockstep:** nothing new to run; bench re-run; daily ruleset 6.

## Tasks

- [ ] **FO0. Confirm the code assumptions** (mid-floor draft path, aura shape, auto-target ranking, room cell iteration,
  altar geometry, salts, fallback audio IDs, Luau locals).
- [ ] **PS1. Altars (dungeon).** → Verify: pure, FLOOR, not solid, not on pellets, reachable, zones apart; every other
  floor output identical; census (fallback rate 0).
- [ ] **PS2. Pacts sim state and hash.** → Verify: fixtures, M1, tutorial unchanged without the config; a pacts run
  without presses draws exactly as a no-pacts run.
- [ ] **PS3. Greed.** → Verify: once per player; dim cases; the shown curse is applied; deal composition; freeze and
  resume; co-op 2-4.
- [ ] **PS4. Horde.** → Verify: 1- and 8-enemy rooms; no clear between waves; PERFECT over both waves; pool cap;
  affix-free; lapse on floor change; never the boss room; exact x2 totals with Bounty, affixes and Gold Rush.
- [ ] **PS5. Pacts worlds and bot census.** → Verify: `npm run verify`; numbers in this doc.
- [ ] **GE1. Goldling roll and flee field.** → Verify: pure; rate per band; never boss room.
- [ ] **GE2. Goldling archetype and state.** → Verify: appears at engage + 180 farthest; not a member; stays in its
  room; slips out of a corner; escapes at 600; replays bit-identically; absent config unchanged.
- [ ] **GE3. Goldling payouts.** → Verify: no combo feed per hit; one on the kill; party 1-4 boosts; full ground; main
  and drops rng identical to a no-golden twin.
- [ ] **GE4. Goldling tuning census** (sword / bow, solo / party, floors 2 / 6 / 12; target catch 50-65 % solo).
- [ ] **FO6. Theme.** **FO7. Pacts view.** **FO8. Goldling view.** **FO9. Audio cue mapper.**
- [ ] **FO10. [owner] Art and audio** (gold recolour via a pipeline `recolor` option, altar art, nine sounds).
- [ ] **FO11. Telemetry (optional).** **FO12. Docs** (this doc as built, CLAUDE.md log, sim README, CLIENT.md, DAILY.md).
- [ ] **FO13. [owner] Playtest.**

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
- **FD10.** Room-bound, 3 s after engaging, not a room member, 10 s to escape.
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

## As built

(Filled in as tasks land.)
