# Boosts from breakables: plan

Some barrels and crates **hold a boost**. Break one and the boost (Fury / Quickstep / Frenzy / Aegis, docs/BOOSTS.md)
hops out onto the floor, exactly like a kill drop: walk over it before it fades. Work it task by task, like `PLAN.md`;
each task ends with a **Verify**.

This is **gameplay** (it changes what lands on the floor), so it lives in the sim and the dungeon and replays,
validates and steps in lockstep like everything else. It closes the gap both earlier plans left open: docs/DECOR.md B5
("Drops ... are out of v1") and docs/BOOSTS.md "Out of scope" ("Drops from breakables ... `dropsOnBreak` could reuse
this later").

Status (2026-11-01): **code-complete except audio.** BL0-BL6 and BL8 built and headless-tested ("As built (BL0-BL4)",
"As built (BL5-BL6, review)"); the client half (glint, hop, fizzle) is typechecked and linted but its Verify needs
Studio. Open: BL7 (vale audio: the loot sound plays the drop sound until a clip is uploaded) and BL9 (playtest).
Owner decisions BLD1-BLD9 are settled (all accepted as recommended, 2026-11-01, Kaleb); see "Decisions".

## The idea in one paragraph

Which pieces are loaded, and with what, is decided **when the floor is built**, not when a piece breaks: a pure
function of the floor seed in `shared/dungeon` (its own stream, like breakables, affixes and the boss pick), stored on
the floor as `breakableLoot`. The sim copies it into `state.drops` at floor start and releases a piece's boost when the
piece breaks (any source). So the sim draws **no rng** for this feature, the loot does not depend on break order or on
who breaks what, a daily seed hides the same boosts for everyone, dev mode's `startFloor` gets the same loot as a
normal run reaching that floor, and the view can **hint** a loaded piece with a soft glint (BLD3).

## What the code gives us (checked against `main` @ `e58b1c1`)

| Fact | Where | Consequence |
|---|---|---|
| Every break goes through `damageBreakable(state, slot, amount, source)`: hp 0, `brokenTick`, out of `slotByCell`, `brokenSlots`; sources MELEE / PLAYER_BULLET (score) / ENEMY_BULLET / SLAM | `sim/breakables/breakables.ts` | One hook at the break line, `dropsOnBreak(state, slot)`. Break order is deterministic (bullet slot order, sweep order) |
| Pieces are per floor, slot = placement index, rebuilt by `resetBreakables` in `stepEndless` (`world.breakables`) and created in `createSimState` | `sim/endless.ts:247`, `sim/state.ts:345` | Loot is indexed by the same slot and reset at the same two places |
| Placement is pure, after the Forge, own stream `floorSeed ^ BREAKABLE.salt`; it keeps clear of the party's actual spawns, so solo and co-op floors with one seed get different pieces | `dungeon/breakables.ts`, `dungeon/endless.ts:462` | Loot is placed after breakables from ANOTHER stream (`floorSeed ^ BREAKABLE_LOOT.salt`), reading the placed list: layouts, digests, props, spawns, pieces, affixes and boss picks stay put |
| The precedent for "rolled on the floor, applied in the sim": `assignAffixes(floorSeed, floor, rooms, roomSpawns)` -> `EndlessFloorLayout.roomAffixes` -> `EndlessFloorWorld.roomAffixes` -> stamped in `spawnActor` | `dungeon/affixes.ts`, `dungeon/endless.ts:467`, `sim/endless.ts` | Same shape: `placeBreakableLoot` -> `breakableLoot` on layout and world |
| Ground drops: `state.drops`, `config.maxOnGround` (4) slots, `land()` in the lowest free one, `groundTicks` life (10 s), pickups by the first living player in index order within `pickupRadius` (0.6 tiles); the kind pick weights live in `BOOSTS` (3 / 3 / 3 / 2) | `sim/drops/drops.ts`, `dropsData.ts` | A released boost is an ordinary ground drop: pickup, expiry, floor clear, HUD, auras and sounds all work unchanged |
| The drops hash group is written by `writeDropsHash`; config-gated extras are a known pattern (`ScoreSource.JACKPOT` only with `SimConfig.builds`) | `drops.ts`, `score/` | `pieceLoot` is hashed only when the config turns the feature on: the tutorial (drops without breakables) and everything else keep their hash |
| The tutorial's config is `guaranteedDropsConfig(...)` = `{ ...DROPS_CONFIG, ... }` | `run/tutorial.ts:255`, `drops.ts` | The switch must NOT go on `DROPS_CONFIG`, or the tutorial inherits it through the spread. Endless gets its own `ENDLESS_DROPS_CONFIG` |
| Boss rooms get no pieces (`BREAKABLE.roomTypes` = combat / elite / treasure); the slam rule reaches a piece on ~1 of 240 boss floors | `dungeon/breakablesData.ts`, docs/DECOR.md | The kill rule "no drops during a boss fight" (BOOSTS P5) needs no twin here (BLD6) |
| `breakables.ts` is imported by `combat.ts`; `drops.ts` imports combat (`registry`, boss `shared`, `ctx`) | sim | `dropsOnBreak` lives in a LEAF (`drops/breakLoot.ts`: state types + dropsData only), or breakables -> drops -> combat -> breakables is a require cycle (BL0 checks) |
| The view already has the pieces: `decor.fx.glint` (the treasure sparkle, also drawn over boost gems, `BOOST_GLINT_FX`), `BreakableRenderController`, `BoostDropRenderController`, `shared/view/boosts` events | theme contract, client render | The hint and the hop reuse existing art; no new image slot |
| Census targets: kill drops 2.6 per floor, 6.6 % of kills, 87 % taken (docs/BOOSTS.md "As built (B4)"); pieces per room by band (kept 2.2 / worn 4.3 / ruined 6.7 / abyss 8.9, measured before `roomScale` 2) | docs/BOOSTS.md, docs/DECOR.md | Loot is set **per floor** (a small count), not per piece, so it does not balloon with depth bands and the doubled rooms. BL0 re-measures pieces per floor at `roomScale` 2 |

## Player experience

1. **Some crates glint.** A slow, soft sparkle every few seconds on a loaded barrel or crate (BLD3). Most pieces never
   glint; about one per floor does, a little more deeper down.
2. **Break it** (sword, arrows, or an enemy's stray bullets) and the boost **hops out** of the splinters with a small
   arc, a pop and a sound, then lies there like a kill drop: bobbing, blinking for its last 2 s, gone after 10 s.
3. **Walk over it**: the usual toast, aura, HUD row and timer (docs/BOOSTS.md). Co-op: first living player to touch it.
4. **Unloaded pieces** break as today (score only).
5. A loaded piece on a floor you leave, or one you never break, is simply gone with the floor.

## Architecture

### 1. Dungeon: `shared/dungeon/breakableLoot.ts` (pure)

**`breakableLootData.ts`** (tunables, a leaf):

```ts
export const BREAKABLE_LOOT = table.freeze({
	salt: 0xe6546b64,            // loot stream = floorSeed ^ salt (murmur3's n; unused in shared/, BL0 re-checks)
	bands: [                     // loaded pieces per floor, one draw in [min, max], by the DECOR depth bands
		{ fromFloor: 1, min: 0, max: 2 },   // kept   ~1.0 / floor
		{ fromFloor: 5, min: 1, max: 2 },   // worn   ~1.5
		{ fromFloor: 10, min: 1, max: 3 },  // ruined ~2.0
		{ fromFloor: 15, min: 1, max: 3 },  // abyss  ~2.0
	],
	maxPerRoom: 1,               // spread: never two loaded pieces in one room
	pieceWeight: { barrel: 1, crate: 2 },   // crates take twice the hits, so they hold loot twice as often
	kindWeights: [3, 3, 3, 2],   // MUST equal shared/sim BOOSTS weights (a sim spec checks it; dungeon cannot import sim)
});
```

**`placeBreakableLoot(floorSeed, floor, pieces, rooms)`** -> `BreakableLoot[]` (`{ slot, kind }`, slot order):

- one draw: the count `n` in the floor's band (capped by the pieces available);
- `n` times: one weighted draw over the candidate pieces (placement order; not in a room that already holds loot,
  room by `roomAt` on the piece's cell), then one weighted draw of the kind. No candidates left: stop.
- Fixed draws per case, own `EncounterRng`; nothing else on the floor reads this stream.

`EndlessFloorLayout.breakableLoot` and `EndlessFloorWorld.breakableLoot` carry it (optional: absent = none); the stage
loader's pre-generation builds it with the rest of the floor for free.

### 2. Sim: release on break

| Piece | Change |
|---|---|
| `DropsConfig.breakableLoot?: boolean` | Presence turns the feature on. `ENDLESS_DROPS_CONFIG = { ...DROPS_CONFIG, breakableLoot: true }` (run/endless.ts); `DROPS_CONFIG` and so the tutorial unchanged |
| `DropsState.pieceLoot: number[]` | Boost kind per breakable slot, `NO_BOOST` = empty. Filled by `dropsOnFloorPieces(state, loot)` from `createSimState` (floor 1, or dev `startFloor`) and from `stepEndless` right after `resetBreakables`. Non-endless sandboxes: `BreakablesConfig.loot?` beside `pieces` |
| `dropsOnBreak(state, slot)` (`drops/breakLoot.ts`, a leaf), from `damageBreakable`'s break line | `pieceLoot[slot] !== NO_BOOST`: it lands in the lowest free ground slot at the piece's cell centre (`spawnTick` = this tick, full `groundTicks`), `events.dropped` and `events.fromPiece`; `pieceLoot[slot] = NO_BOOST`. No free slot: lost (`events.lostLoot`, a fizzle in the view). Any source releases it (BLD4). Kill pity untouched (BLD7) |
| Hash | `writeDropsHash` appends `pieceLoot.length` + entries after `players` only when `config.breakableLoot`; `dropsHashNames` likewise; `cloneDropsState` copies it |
| Events (not hashed) | `fromPiece: number[]` (ground slots that came out of a piece, a subset of `dropped`), `lostLoot: { x, z }[]` |

Order inside a tick is already right: breaks happen in `stepCombat` (and the boss act), the landing tick skips aging,
and `stepDrops` step 5 lets it be taken the same tick; a break on a floor-change tick lands and is freed by step 1.
The release lands at the cell centre and the pickup radius is 0.6 tiles, so a sword user (1-2.5 tiles away) sees the
gem and steps onto it; nothing is auto-collected.

### 3. Worlds

| World | Breakable loot |
|---|---|
| M1, every fixture | none (no breakables, no drops): unchanged |
| Tutorial | none (no breakables, DECOR B7; `DROPS_CONFIG` unchanged): unchanged, lock spec passes |
| Endless solo / co-op, daily, dev | `ENDLESS_DROPS_CONFIG`: endless replays and scores change from floor 1 (boards stay `_v1`, as BUD9 / EVD: owner's call, BLD9) |

### 4. Client and theme (presentation only)

| Piece | Change |
|---|---|
| `BreakableRenderController` | Loaded intact pieces (`breakableLootAt(state, slot)`) get the glint (`decor.fx.glint`, its existing role), on a slow random-phase cadence (`BREAKABLE_LOOT_VIEW.glintEverySeconds`), on the piece's top, under every bullet. Reduced motion: a still sparkle. Off when BLD3 says so |
| `BoostDropRenderController` | A slot in `fromPiece` lands with a hop (an arc of `BREAKABLE_LOOT_VIEW.hopTiles` over `hopSeconds` from the piece's top) instead of the kill pop; `lostLoot` plays a small grey fizzle |
| `shared/view/boosts` | `fromPiece` / `lostLoot` join the collected `RunView.boostEvents`; pure hop curve with a spec |
| Audio cue mapper | `fromPiece` plays `sfx.breakable.loot` (new port audio ID in `PORT_AUDIO_EVENTS`, SILENT in the placeholder, falls back to `sfx.boost.drop` while silent) |
| Theme | One port audio ID; no new image slot, colour role or string (the toast is `hud.toast.boost`) |
| Debug | `KV_LootDebug` (Studio / KV_Debug): a label with the kind over every loaded piece. The existing debug drop key is unchanged |

Since docs/GOLDLING_RUMOURS.md GR4 the Goldling's hiding place (its own barrel or crate, the floor's last piece, never
loaded) glints exactly like a loaded piece while it hides: shared/view `pieceGlints` (`breakableLootAt` or shared/sim
`goldenPieceAt`) is the glint's one test; `KV_LootDebug` still labels loaded pieces only.

### 5. Server, lockstep, leaderboards

Nothing new: validation re-runs the same sim, co-op steps the same frames. Cost: one array per floor and one check per
break; re-run the replay bench. Daily boards: the loot is part of the day's seed, so every entrant of a board size
(solo / co-op) gets the same crates.

## Tasks

- [x] **BL0. Confirm the assumptions.** Every row of "What the code gives us"; the require graph for the leaf hook;
  the salt is unused; pieces per floor at `roomScale` 2 per band (a census print in `dungeon/breakables.spec.ts`), and
  how often all 4 ground slots are full at a break (from the drops census bot). Edit the band counts if a band has too
  few pieces to place them. -> Verify: each row confirmed or this plan edited.
- [x] **BL1. Dungeon.** `breakableLootData.ts`, `placeBreakableLoot`, `breakableLoot` on `EndlessFloorLayout` and
  `EndlessFloorWorld`, barrel. -> Verify: `breakableLoot.spec.ts`: pure (same seed, same list), fixed draws, band
  counts, one per room, crates about twice as often as barrels over the census, every kind reachable; `endless.spec`
  digests, pieces, spawns, affixes and boss picks unchanged; `roomPool.lock.spec` unchanged; a sim spec checks
  `kindWeights` equals `BOOSTS` weights.
- [x] **BL2. Sim state and hash.** `DropsConfig.breakableLoot`, `pieceLoot`, `dropsOnFloorPieces` at both call sites,
  clone, config-gated hash and names. -> Verify: `npm run verify` with every golden fixture, the M1 hash, the tutorial
  lock spec and every existing endless replay unchanged (nothing sets the flag yet); clone / hash specs.
- [x] **BL3. Release.** `drops/breakLoot.ts` `dropsOnBreak` from `damageBreakable`, events. -> Verify: `breakLoot.spec`:
  each source releases (melee, player bullet, piercing arrow that breaks and flies on, enemy bullet, slam); unloaded
  pieces release nothing; a piece releases once; position = cell centre; landing-tick pickup; full ground -> lost, no
  slot taken; `state.rngState` and the drop stream (`drops.rngState`, `killsSinceDrop`) untouched; floor change resets
  the loot; co-op picker only.
- [x] **BL4. Worlds.** `ENDLESS_DROPS_CONFIG` in `buildEndlessRunConfig` (solo, party, daily, dev). -> Verify: the
  endless / party / partyProgression specs replay and validate segmented; extend `run/dropsCensus.spec.ts`: drops per
  floor from kills vs pieces, share taken, lost-on-full count (expected ~0); replay bench within budget.
- [x] **BL5. Theme.** `sfx.breakable.loot` in `PORT_AUDIO_EVENTS`, placeholder SILENT, fallback rule.
  -> Verify: contract / validator / `audio.spec.ts`.
- [x] **BL6. View.** (code-complete; Studio check pending) Glint, hop, fizzle, cue, `KV_LootDebug`. -> Verify: headless specs for the pure parts; Studio:
  loaded pieces glint on every biome and never over a bullet, the hop reads, reduced motion still, 2 players see the
  same glints and the same gem.
- [x] **BL7. Vale audio.** Pick a Ninja Adventure clip (Audio/Sounds `Bonus`), `art/audio.json`, `audio:build`, upload,
  paste the id. -> Verify: `audio:build`, `test:art`, the vale validator.
  *Done 2026-11-21 (docs/OPEN_TASKS_TRIAGE.md): `sfx.breakable.loot` has its layout and `sfx-breakable-loot.ogg` its id in `packs/vale/assetIds.ts`.*
- [x] **BL8. Docs.** `CLAUDE.md` decision log line (and this file's docs-table row), `src/shared/sim/README.md` (hook,
  hash), docs/CLIENT.md (glint, debug attribute), docs/DECOR.md B5 and docs/BOOSTS.md "Out of scope" point here.
  -> Verify: `npm run verify`.
- [ ] **BL9. Playtest.** Solo and co-op, PC and phone: is the glint noticed, do players detour for it mid-fight, does
  a far bow break leave the gem to fade, total boost uptime with kill drops on floors 1-10. Tune `BREAKABLE_LOOT`.

Critical path: BL0 -> BL1 -> BL2 -> BL3 -> BL4. BL5 any time after BL0; BL6 after BL3 and BL5; BL7 after BL5.

## Edge cases

- **An enemy bullet opens a loaded crate** you hid behind: the boost lands on your side or theirs; anyone alive can
  take it. Cover that erodes and drops a reward is a feature, not a bug.
- **A piercing arrow** breaks the crate and flies on: the loot lands, the arrow keeps going (no change to the
  pierce rule).
- **A break on the tick the floor ends**: lands, then freed by the floor change. Consistent on every client.
- **Four drops already on the floor**: the loot is lost with a fizzle (BLD5). BL0 / BL4 measure how rare this is.
- **Solo vs co-op on one seed** place different pieces (DECOR R11), so their loot differs too; each board compares
  like with like.
- **Dev mode** (`startFloor` n) gets floor n's loot exactly as a run that walked there (per-floor stream).
- **The glint and readability**: it sits on the piece, is small and slow, and is drawn under bullets. Its colour is
  `decor.fx.glint`'s, already validated against the enemy-bullet roles.

## Decisions (2026-11-01, Kaleb: all accepted as recommended)

Each line is the accepted choice, then the alternative that was turned down.

- **BLD1. Rolled on the floor, not at the break** [BL1]. Deterministic per floor seed, no sim rng, break order and
  breaker do not matter, hintable, fair on daily boards. Alternative: a roll per break from the drop stream (like
  kills), which shifts every later kill drop's kind and cannot be hinted.
- **BLD2. A small count per floor** (kept 0-2, worn 1-2, ruined and abyss 1-3; at most one per room) [BL1, tuned BL9].
  About +40-75 % on today's 2.6 kill drops per floor. Alternative: a chance per piece (scales with piece counts, which
  grow ~4x through the bands and doubled with `roomScale`).
- **BLD3. Hint loaded pieces with a soft glint** [BL6]. Makes "sometimes" readable and makes a crate a choice in a
  fight instead of teaching players to smash everything (score only, no combo). Alternatives: no hint (pure surprise),
  or a glint tinted by the boost inside.
- **BLD4. Any break releases it** (player, enemy bullet, slam) [BL3]. The loot is in the crate. Alternative: player
  breaks only (an enemy-broken loaded crate loses its loot).
- **BLD5. Shared ground slots; full -> lost** [BL3]. Alternative: raise `maxOnGround` 4 -> 6 for endless if BL4 sees
  losses.
- **BLD6. No boss-fight exception** [BL3]: boss rooms have no pieces, so the rule would be dead code.
- **BLD7. Kill pity untouched; same 10 s ground life** [BL3]. Alternative: a longer life for piece drops if bow
  players see them fade (BL9).
- **BLD8. Same kind weights as kill drops** (3 / 3 / 3 / 2) [BL1]. Alternative: crates favour Aegis (defensive "supply
  crate" flavour).
- **BLD9. Leaderboards stay `_v1`** [BL4], as for Builds and Enemy variants: endless scores change.

## Risks

- **Too many boosts**: kill drops plus piece drops could keep Fury up most of a floor. Mitigation: per-floor counts,
  measured uptime in BL4, tuned in BL9.
- **Detours under fire**: a glinting crate across a bullet storm is bait. Intended risk / reward; watch it in BL9.
- **The require cycle**: the hook must stay a leaf (BL0).
- **Tutorial leakage** through the config spread: guarded by `ENDLESS_DROPS_CONFIG` and the tutorial lock spec.

## Out of scope

- Hearts, Ember or currency from pieces (hearts stay with the flask and Vampire Fang).
- Breakables in the tutorial, M1 or boss rooms.
- New boost kinds, loot tables per biome, mimics (a crate that bites).

## As built (BL0-BL4)

Code: `shared/dungeon` `breakableLootData.ts` (`BREAKABLE_LOOT`, a leaf) and `breakableLoot.ts` (`placeBreakableLoot`,
`breakableLootSeed`, `breakableLootBand`, type `BreakableLoot`); `shared/sim` `drops/breakLoot.ts` (a leaf:
`dropsOnFloorPieces`, `dropsOnBreak`, and the landing helpers `lowestFreeDropSlot` / `landDrop` that drops.ts now
imports from it); `ENDLESS_DROPS_CONFIG` in `drops/drops.ts`. Specs: `dungeon/breakableLoot.spec.ts`,
`sim/drops/breakLoot.spec.ts`, `run/endless.spec.ts` (the drops group), `run/dropsCensus.spec.ts` (BL4 census).

**BL0: the table above, checked against this branch.**

- Every row holds. All four break sources reach `damageBreakable` (`meleeHitBreakables`, the player bullet pass,
  `enemyBulletHitsBreakable`, `slamBreakables`); `dropsOnBreak` sits on its break line after the score.
  `resetBreakables` (sim/endless.ts `nextFloor`) and `createSimState` are the only two places pieces are made, and both
  now call `dropsOnFloorPieces` right after. `writeDropsHash` is the single writer behind both `writeHashFields`
  (replay.ts) and `hashLayout`, so gating inside it covers both. `TUTORIAL_DROPS_CONFIG = guaranteedDropsConfig(...)`
  spreads `DROPS_CONFIG`: the switch is off there. Boss rooms get no pieces.
- **Require graph.** `breakLoot.ts` requires only `shared/dungeon` and `./dropsData` (which requires `units` and
  `playerData`); its `SimState` / `DropsState` imports are type-only and erased (checked on `out/`). `breakables.ts`,
  `drops.ts`, `state.ts` and `endless.ts` require it; no cycle.
- **Salt.** `0xe6546b64` appeared nowhere in `src/` before; the floor salts in use stay distinct (breakables
  `0x5bd1e995`, boss pick `0x27d4eb2f`, affixes `0xcc9e2d51`, roster `0x165667b1` on the run seed, drops `0x4b564452`
  on the run's sim seed). The spec checks the floor ones.
- **Pieces per floor at `roomScale` 2** (census in `breakableLoot.spec.ts`: runs 1-10 x floors 1, 3, 4, 5, 7, 9, 10,
  12, 14, 15, 17, 19; boss floors included):

  | Band | Pieces / floor | Rooms with pieces / floor (min) | Floors with fewer such rooms than the band max | Loaded / floor |
  |---|---|---|---|---|
  | kept (0-2) | 22.0 | 6.3 (4) | 0 / 30 | 1.00 |
  | worn (1-2) | 42.0 | 9.6 (8) | 0 / 30 | 1.53 |
  | ruined (1-3) | 70.1 | 10.7 (10) | 0 / 30 | 2.10 |
  | abyss (1-3) | 107.5 | 11.6 (10) | 0 / 30 | 2.10 |

  Every band places its max on every census floor (one per room needs `max` rooms with pieces), so **the band counts
  are unchanged**. Crates are loaded 1.83x as often per piece as barrels (weights 2 : 1, drawn without replacement under
  the room cap); kinds 61 / 56 / 49 / 36 (Fury / Quickstep / Frenzy / Aegis) of 202. `roomAt` on the piece's cell centre
  agrees with the Forge's own room grid for every loaded piece of the census (the spec asserts it).
- **Full ground at a break**: 0 of the census's 14 loaded pieces (BL4 below). BLD5 stands.

**Differences from the sketch above.**

- `placeBreakableLoot(floorSeed, floor, pieces, encounter)` takes the floor's `EncounterConfig` (for `roomAt`), not
  `rooms`. A piece in no room (none in the census) would be uncapped. Draws: 1 (the count, always) + 2 per loaded piece;
  it stops early only when the candidates run out.
- `ENDLESS_DROPS_CONFIG` lives in shared/sim `drops.ts` beside `DROPS_CONFIG` (exported through `shared/sim`), not in
  run/endless.ts; `buildEndlessRunConfig` uses it for solo and party, so daily (`buildEndlessRunConfig`) and dev
  (`buildDevRunConfig` spreads it) get it too.
- `DropsEvents.lostLoot` entries are `{ kind, x, z }` (the stub's shape), not `{ x, z }`.
- `dropsOnFloorPieces` throws on a loot slot or kind out of range. With the switch on and no breakables state,
  `pieceLoot` stays empty and the hash still appends its length (0).
- The release reads the piece from `state.breakables` at the break; `spawnTick` is the piece's `brokenTick` (a break
  inside `step()` lands on the tick being stepped, so after the step it is `state.tick - 1`).

**BL2-BL3 Verify.** `breakLoot.spec.ts` (20 tests): the weights spec (`BREAKABLE_LOOT.kindWeights` = `BOOSTS` weights),
the switch never on `DROPS_CONFIG` / `guaranteedDropsConfig`, `pieceLoot` per piece and its hashed tail after
`drops.players[n].aegisPips`, the switch off giving per-tick hashes and dump names identical to the same run without
loot, clone, every break source (sword, bow, a heavy arrow that breaks the crate and still hits the dummy behind, enemy
bullets, the slam releasing several in slot order), unloaded and released-once, cell-centre position and full ground
life, landing-tick pickup, full ground -> `lostLoot` with no slot taken, `state.rngState` / `drops.rngState` /
`killsSinceDrop` equal to the unloaded twin run, floor 1 -> 2 loot (old drops freed), dev `startFloor` 6's loot, co-op
picker only, a recorded replay. The golden fixtures, the M1 hash and the tutorial lock spec are untouched (none sets the
switch); see the full-suite note below.

**BL4: worlds and census.** Only `endless.spec`'s hash-layout test needed editing (`drops` = `ENDLESS_DROPS_CONFIG`,
the group's `drops.pieceLoot.length` tail = floor 1's piece count, its loaded entries = floor 1's loot); every endless,
party, partyProgression, affixes, dev and tutorial spec passes unchanged (they compare live runs with their replays and
segmented validation). The census bot (`dropsCensus.spec.ts`) now also detours to every loaded piece still standing
once a floor's rooms are done (it swings through clutter in the way), then collects. Seeds 1337 / 4242 / 90210, floors
1-4, 12 floors:

- from kills: 478 kills, 37 drops = **3.08 per floor, 7.7 % of kills**, 81 % taken;
- from pieces: 14 loaded, 13 opened, **13 drops = 1.08 per floor** (+35 % on the kill drops), 9 taken (69 %: a few
  faded while the bot walked to the next glint);
- **lost to a full ground: 0**; all drops: 39 of 50 taken (78 %).

The honest one-floor run (seed 4242, no surgery) released 1 piece drop and took it; it replays to its live hash and
validates through `SegmentedValidator` in 1200-tick segments (the bot dies on that floor, as before this change).

**Replay bench** (`run/replay.bench.spec.ts`, ms per replayed tick, this branch / the untouched base on the same host,
one run each; floor 15 runs, which carry loot): solo room 0.305 / 0.333, 8 players room 0.704 / 0.736, solo floor
0.439 / 0.515, 8 players floor 1.359 / 1.393: no measurable cost (one array per floor, one check per break).

**Full suite** (`npm run test:only` after a build, 2026-11-01): 4027 of 4029 passed. `dungeon/forge/forge.spec`
("EncounterRng ... seedToState vectors", a NaN's sign bit under Lune) fails on the untouched base too.
`sim/bench.spec`'s dungeon case missed its 2 ms budget by 0.03 ms on a loaded host (M1 config: no drops, nothing of
this feature runs) and passed on a rerun. Every golden fixture, the M1 hash, `roomPool.lock.spec` and the tutorial lock
spec (`run/tutorial.spec`) pass unchanged.

## As built (BL5-BL6, review)

- **Theme (BL5).** `sfx.breakable.loot` appended to `PORT_AUDIO_EVENTS` (SILENT in the placeholder); while it has no
  clip it plays `sfx.boost.drop` (`SFX_FALLBACK`, like `sfx.boss.taunt` / `sfx.best.new`). Cue rank 63 (between the drop
  and the pickup), 0.1 s minimum interval; cues merge by the resolved id, so a silent loot sound gives one drop sound per
  frame. Lost loot has no sound of its own (the break sound plays). `contract.luau` / `validate.luau` unchanged at
  183 / 199 top-level locals (only an array entry).
- **View (BL6).** Pure half `shared/view/breakableLoot.ts` + `breakableLootConfig.ts` (`BREAKABLE_LOOT_VIEW`), specs
  next to it; client `BreakableRenderController` (glint), `BoostDropRenderController` (hop, fizzle),
  `ParticleController.lootFizzle`, and `render/glintParts.ts` (the glint parts moved out of BoostDropRenderController,
  no behaviour change). `BoostFrameEvents` gained `fromPiece` (`PieceLanding`: slot + landing tick) and `lostLoot`.
  Differences from the sketch:
  - The glint's phase is a hash of the piece's cell (`decorHash`), not a random draw, and it runs on sim time, so every
    co-op client shows the same sparkle.
  - Besides sitting under the bullets' plane, the glint hides while an enemy bullet is within
    `BREAKABLE_LOOT_VIEW.duckTiles` (1.25) of the piece. Ooze goo is skipped (review fix: a stationary floor decal,
    renewed while a slime lingers, would have hidden the hint for as long as the trail lay there).
  - The hop starts at the pieces' height cap (`maxHeightTiles`), not each piece's drawn height.
  - A drop hops only when its slot AND landing tick match a `fromPiece` entry, so a kill drop that refills the slot in
    the same frame pops as usual.
  - The fizzle uses the `uiTextDim` colour role (grey); no new role.
  - A pack without `decor.fx.glint` art (the placeholder) draws no glint and has no fallback: loaded pieces look like
    the rest there. The vale pack has the art.
  - Debug: Workspace boolean `KV_LootDebug` (Studio or `KV_Debug`, off by default) labels each loaded intact piece
    "loot: <kind>" through `createKvBillboardGui` (developer text, English).
- **Daily ruleset (review).** This changes endless play, so `DAILY.ruleset` went 1 -> 2 (docs/DAILY.md DSD11): servers
  still on an older build keep posting to `d<day>_r1`, new ones to `d<day>_r2`, and no daily board mixes the two.
  BLD9 (all-time boards stay `_v1`) is unchanged.
- **Studio smoke list.** Loaded pieces glint on every biome, slowly and out of step; the glint sits on the piece's top
  and hides when an enemy bullet comes near (not for goo); reduced motion: a still sparkle; it is gone the frame the
  piece breaks and on a floor change; a break shows the hop from the piece's top, then the normal bob; four drops on
  the ground + a loaded break shows the grey fizzle; the placeholder's loot sound plays the drop sound; two players see
  the same glints and the same gem; `KV_LootDebug` labels with the placeholder boxes and the vale art.

## Loot glint art (2026-11-01)

Loaded pieces have their own twinkle: `decor.fx.loot` (a new optional `DECOR_FX_NAMES` entry, tinted by the existing
`decor.fx.glint` role, so no new colour role and no Luau-locals change). The vale art is original, an anime-style
pixel-art star drawn by `scripts/art/gen-loot-glint.js` (8 frames of 31 x 31 white pixels, 12 fps: a dot pops into a
plus, stretches into a long thin four-point star with short diagonal rays and a small companion sparkle at the peak,
frame 4, then shrinks away; `scripts/art/gen-loot-glint.test.js`). `art:build` / `art:lock` run the generator first
into `art/vendor/kaleb-vale/loot-glint/` (byte-identical output, pinned in `art/vendor.lock.json`). The atlas pipeline
gained `own` on world sprite sets: the piece `lootglint` is its own sheet `loot-glint.png` (232 x 35, cells 29 x 35,
pivot (15, 18)), packed after the shared atlases, so `decor-atlas.png` does not repack and needs no re-upload
(`build-atlases.test.js` pins that). The `lootglint` layout entry was written from the pipeline's own functions; the
next full `art:build` reproduces it. Until `loot-glint.png` has an ID in `assetIds.ts`, BreakableRenderController
falls back to `decor.fx.glint` (`BREAKABLE_LOOT_VIEW.glintFx` / `glintFallbackFx`). Boost gems and the relic pedestal
keep the Lords of Pain glint.

`BREAKABLE_LOOT_VIEW.glintStillFrame` 2 -> 4 (the twinkle's peak). Frame 2 of the Lords of Pain glint is empty (as
are frames 1 and 2 of its source files), so under reduced motion the loaded-piece glint showed nothing; frame 4 is
visible in both arts. The boost gems' `BOOST_VIEW.glintStillFrame` is also 2 on the same Lords of Pain art, so their
reduced-motion glint is likely invisible too (not changed here; docs/BOOST_ART.md).

To switch it on: `npm run art:build`, upload `art/upload/loot-glint.png`, paste its ID into `assetIds.ts` as
`"loot-glint.png"`, `npm run verify`.

## Floor modifiers (2026-11-12)

docs/FLOOR_MODIFIERS.md's boon **Plunder** (`Plunder · A boost hides in every room's barrels`, endless only, 8.2 % of
non-boss floors in its FM9 census): `placeBreakableLoot(..., { everyRoom: true })` makes the count draw, ignores it,
then loads one weighted piece (and draws its boost kind) in every room that holds a weighted piece, in room id order;
only on floors with at least `MODIFIERS.plunder.minRooms` 3 such rooms. A Plunder floor loads 11.1 pieces on average
(5-13) against 1.8 natural: open owner call OC2 there. Breaking, the drop, the ground cap of 4 and the fizzle are
unchanged; the floor's status chip pulses on the first loaded piece broken.

## Silver in crates (2026-11-14)

docs/SILVER.md SC1-SC4: after every other floor part (after the secret room) a few clutter pieces without a boost hold
Silver (`placeBreakableSilver`, its own stream); they twinkle exactly like loaded pieces (`pieceGlints`), so a twinkle
now means a boost, Silver or the Goldling. A piece never holds both.
