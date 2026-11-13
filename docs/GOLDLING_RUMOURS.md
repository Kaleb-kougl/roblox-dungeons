# Goldling rumours: hear it, find its hiding place, catch it

Status (2026-11-12): **built on branch `goldling-rumours` (GR0-GR9); owner tasks GR10 (audio audition), GR11
(Studio check / playtest), GR12 (telemetry, optional) and the confirmation of RD3-RD7 / RD9 pending** (see "As built").
Plan revision 3: the owner (Kaleb) confirmed RD1, RD2, RD8 and RD10-RD15 (see "Decisions"): the Goldling **brings its
own barrel or crate** into its room, the piece **glints like a loot piece**, **only players** can break it open, it
never shares a piece with loot, and a Goldling nobody finds is fine. RD3-RD7 and RD9 are built as their recommended
options (owner to confirm). Planned against `main` @ `677b5b1` (Fortune and treasure rooms merged; the uncommitted audio
work in the working tree is not assumed). Work it task by task like `PLAN.md`; each task ends with a **Verify**.
Project copy: `claude/goldling-rumours-plan.md`. Parent feature: docs/FORTUNE.md (the Goldling, GE1-GE4, FO8 / FO9).

Goal: turn the Goldling from a surprise into a **hunt**. Today it pops out 3 s into a fight in a room you never knew
was special. With this plan:

1. **Floor rumour.** You arrive on a floor with a Goldling: a soft, far-off coin jingle and a chip
   `Coins jingling...`. One fight room on this floor has a Goldling hiding in a barrel or crate.
2. **Room rumour.** You step into that room: a closer, brighter jingle, and the chip changes to `It's hiding here!`.
3. **The hiding place.** Its barrel or crate glints like one holding a boost. Break it and the Goldling bursts out in
   a shower of coins and runs (the 10 s chase, hp and payouts as today, RD8).

**Sim impact: gameplay, but only for the Goldling** (revision 1 was presentation only; RD10 changes that):

- the floor roll (`placeGolden`, its own salt `0x3d2f8b4d`) places **one more piece**, the Goldling's barrel or crate,
  in its room, **appended after every other piece** (after the vault's chest). It still runs last in
  `buildEndlessFloor`, so the layout, digest, props, planned spawns, the other pieces' slots, loot, affixes, pellets,
  the vault and the altars never move. Only `roomSpawnTiles` loses the new piece's cell (as it does the chest's);
- the sim releases it when **a player breaks that piece**, not when the room engages. No new rng draw in the sim (the
  Goldling's own stream is drawn as today: a jink's side, the catch's boosts);
- new hashed fields go at the **end** of the `golden` group.

M1, every golden fixture and the tutorial replay exactly as before (no Goldling there). **Endless, daily and dev
replays and scores change** on Goldling floors: `DAILY.ruleset` + 1 when this lands, all-time boards stay `_v1`.
RD8 (a) keeps the 10 s window, the hp and the payouts; it can't keep "no ruleset bump", because the hiding place
changes play.

Rules that keep it kind (FORTUNE.md): the rumour **never lies** (RD1), it gives no direction you have to decode (RD2),
and missing it costs nothing (RD12): you keep everything else the floor gives.

## What the code gives us (read in the source at 677b5b1 unless marked assumed)

| Fact | Where | Consequence |
|---|---|---|
| `buildEndlessFloor`: breakables, affixes, loot, pellets, the vault (its chest appended: `pieces = [...breakables, vaultChest]`), the altars (reading `pieces`), then `placeGolden` **last**; `roomSpawnTiles` = `withoutBreakableCells(..., pieces)` at the end | `shared/dungeon/endless.ts` 545-590 | The Goldling's piece is appended after the chest (`pieces = [...pieces, goldenPiece]`) before `roomSpawnTiles` is computed, so no earlier slot or output moves |
| `placeGolden` today: from floor 2, one chance draw (30 / 35 / 40 % by band), one room draw over combat / elite rooms with planned spawns and >= 100 FLOOR cells, never the boss room | `shared/dungeon/golden.ts` | The room filter gains "has a cell its piece fits on", tested before the draw (the vault's pattern), so the 30 / 35 / 40 % rate holds |
| The vault places its chest with `breakableCandidates(input, room)` (off doorways, spawns, pools, the entrance, the stairwell) + `pieceFitsAt` / `pieceFitter` (the 2-tile gap rule + ring reachability against every piece), off pellet cells, and the eligibility test computes the cells so a room with none is never picked | `dungeon/vault.ts`, `breakables.ts` | The Goldling's piece reuses exactly these, plus: not on a pellet cell and not in the vault chest's front cells (`VAULT.wallClearTiles` 2) or decor clearance **(assumed enough; GR1's spec checks the chest stays reachable)** |
| Kinds: barrel 0, crate 1, chest 2 (unbreakable); `BREAKABLE.crateShare` 0.5 | `breakablesData.ts` | One more draw picks barrel or crate at `crateShare` |
| Loot: `placeBreakableLoot` fills slots of the clutter only (it runs before the chest and the Goldling's piece exist); `dropsOnBreak(state, slot)` on any break | `dungeon/breakableLoot.ts`, `sim/drops/breakLoot.ts` | The Goldling's piece can never be a loot piece (RD15) without any new rule |
| The loot glint: shared/view `breakableLoot.ts` shows `decor.fx.glint` (vale `decor.fx.loot`) on a **loaded intact** piece, read through shared/sim `breakableLootAt`, phased per cell | `view/breakableLoot.ts`, `breakableLootConfig.ts` | RD14: the same glint, same art and phase rule, on the Goldling's piece while it is hidden. A player can't tell a Goldling from a boost until it breaks |
| `damageBreakable`: hp, `brokenTick`, `intact`, then `scoreBreakable` for player sources only (MELEE, PLAYER_BULLET, ROLL, BUILD), `dropsOnBreak`, `buildsOnPieceBroken`; a chest returns before any bookkeeping | `sim/breakables/breakables.ts` 205-242 | RD13: for the Goldling's slot, the enemy sources return before the bookkeeping (as the chest does); a player break calls a third leaf hook `goldenOnBreak` |
| Enemies hit pieces: enemy bullets, the Charger before each step, the Bomber's blast, the boss's slam (no pieces in boss rooms) | `breakablesData.ts`, NEW_ENEMIES.md | They meet a chest-like piece. **Assumed: the Charger stuns on it as on a chest; GR0 verifies** |
| `stepGolden` (after `stepScore`): WAITING latches `engageTick` and spawns at `engageTick + 180` on the spawn tile farthest from the players; RUNNING escapes at 600 ticks | `sim/golden/stepGolden.ts` | The appear rule becomes "its piece broke this tick", at the piece's cell centre. `engageTick` stays latched (the room rumour reads it). The escape is unchanged |
| `holdAbsoluteTimers` moves a waiting Goldling's `appearTick` / `engageTick` 1 tick per frozen draft tick | `sim/pacts/holdTimers.ts` | No waiting timer is left, so the waiting branch goes. A running one's `fieldTick` stays |
| The flee field's open mask is the walk mask minus intact pieces; the cache key includes the intact count | `sim/golden/golden.ts`, `goldenField.ts` | The broken piece's cell opens the moment it breaks: the Goldling starts on open floor |
| Today's census (GE4): a focused solo sword catches 15 / 18, fighting the room 6 / 18 | FORTUNE.md | A calm chase after the clear is now possible (RD12); GR8 re-runs the census |
| `GoldenState` status / room / record / `engageTick`; `isDraftOpen(state)`; the cue mapper's Goldling cues; `HordeChip`; `SIGHTING_IDS`; the audio pipeline's `gainDb` / `mix` / `lowpassHz` | revision 1 | The rumours themselves stay presentation |
| Local prediction: cues read the run view's collected state **(assumed: confirmed, not predicted; GR0 verifies)** | `shared/play`, `shared/lockstep` | The room cue never fires on a mispredicted step into the room |

## Player experience

| When | What you hear | What you see |
|---|---|---|
| Arrive on a Goldling floor (the floor's draft closed, + 1.0 s) | `sfx.golden.rumour.floor`: a soft, muffled coin jingle | Chip `Coins jingling...`. First time ever: the sighting card `Hear coins? A Goldling is hiding in a barrel or crate on this floor. Find it!` |
| Step into its room | `sfx.golden.rumour.room`: the same jingle, closer and brighter | Chip `It's hiding here!` (gentle pulse; reduced motion: no pulse). Its barrel or crate glints like a loot piece (a room can have one loot piece too: two glints, one of them the Goldling) |
| Break the right piece | The break, then `sfx.golden.appear` | A gold coin burst from the piece, `GOLDLING!`, the timer ring: the chase as today. The chip goes |
| Enemy fire on the piece | Nothing | Nothing: enemies can't break it open (RD13) |
| Clear the room without finding it | Nothing | The chip stays; it is still in there (RD12) |
| Leave the floor without finding it | Nothing | The chip goes with the floor |

- **Co-op (RD6).** Everyone hears the floor rumour; when anyone steps into the room everyone hears the room cue (full
  volume inside the room, teammate volume outside) and the chip changes. Whoever breaks the piece releases it for
  everyone.
- **Muted / no headphones.** The chip and the glint say everything the sounds say.

## Rules

- **Endless only**, wherever `SimConfig.golden` runs (endless, co-op, daily, dev). The tutorial and M1 have no
  Goldling.
- **Floor roll** (`placeGolden`, pure, its own stream):
  - the chance draw as today (30 / 35 / 40 %);
  - eligible rooms as today, **plus at least one cell its piece fits on** (`goldenPieceCells(input, room)`: the
    vault's candidate and fit rules against every piece, the chest included, off pellet cells and the chest's front);
  - on a hit: one room draw (weights 1 / 1), one **cell draw** uniform over that room's fitting cells (row order), one
    **kind draw** (crate at `crateShare` 0.5, else barrel).
  - Draws: 0 below floor 2; 1 on a miss or with no eligible room; 4 on a hit. No eligible room: no Goldling, no
    rumour.
  - Output: `FloorGolden` gains `piece` (its slot: the index after the chest, or after the clutter without a vault),
    `pieceX` / `pieceY`, `pieceKind`. `buildEndlessFloor` appends the piece to `breakables` before `roomSpawnTiles`.
- **Hidden** (status WAITING): the piece blocks bodies and bullets, has its kind's hp and scores like any piece when a
  player breaks it. The room engages as today; `engageTick` still latches (the room rumour).
- **Release:** in `damageBreakable`, for the Goldling's slot, ENEMY_BULLET and SLAM (and the Charger / Bomber paths,
  GR0) return before the bookkeeping. On a player break, `goldenOnBreak(state, slot)` records `releaseTick`.
  `stepGolden` (after `stepScore`, the same tick) spawns it at the piece's cell centre: RUNNING, `seen` + 1,
  `events.appeared`. A full actor pool: SKIPPED, as today.
- **Running, catch, escape:** unchanged (10 s, `GOLDEN_HP` 24, coins 50 x floor scale per hit, the catch 1500 x floor
  scale + party size + 1 boosts, flee field 1.2, jink). Released while nobody stands in its room, it stands still until
  someone walks in (today's rule); its 10 s run either way.
- **Never found** (RD12): it stays in its piece until the floor ends. No counter for a missed one.
- **Hash** (end of the `golden` group): `releaseTick` (-1 until released) and `piece`. `appearTick` keeps its meaning
  (the tick it came out) and is no longer computed from `engageTick`.
- **Glint** (view, pure): a piece glints when it is a loaded intact piece **or** the Goldling's piece while WAITING
  (`goldenPieceAt(state, slot)`), with the loot glint's art, tint and per-cell phase. Nothing else marks it.
- **Rumour phase** (view, pure): `NONE` without a Goldling or once it is not WAITING; `FLOOR` while WAITING and
  `engageTick < 0`; `ROOM` while WAITING and `engageTick >= 0`. The floor cue plays once per floor after 1.0 s of
  unfrozen time in `FLOOR` (skipped if `ROOM` came first); the room cue once, on the first `ROOM` frame.

## Design

1. **Dungeon** (`golden.ts`, `goldenData.ts`): `GoldenFloorInput` gains the pieces so far (`pieces`, the chest
   included), `pellets` and `vault`; `goldenPieceCells`; `placeGolden`'s cell and kind draws; `FloorGolden.piece` /
   `pieceX` / `pieceY` / `pieceKind`; `goldenPiece(g)` (the `BreakablePlacement` to append). `endless.ts` appends it.
2. **Sim** (`sim/golden/`): `goldenHooks.ts` `goldenOnBreak` (a leaf, like `dropsOnBreak`); `stepGolden`'s WAITING
   branch on `releaseTick`; `GoldenState.releaseTick` / `piece` (clone, hash appended, `goldenOnFloor` resets);
   `goldenPieceAt(state, slot)`; `damageBreakable`'s early return for enemy sources on that slot; `holdTimers.ts` drops
   the waiting branch.
3. **View, release and glint:** the loot glint's test takes `goldenPieceAt` too; `GoldenRenderController` plays the
   appear flash at the piece (the piece's own break first, then the coins).
4. **View, rumours** (revision 1): `shared/view/golden/rumour.ts` (`goldenRumourPhase`, `GoldenRumourClock`);
   `GOLDEN_VIEW.rumour` (`floorDelaySec` 1.0, `floorVolume` 0.45, `roomVolume` 0.8, pulse 0.8 s / 0.08).
5. **Audio:** `sfx.golden.rumour.floor` / `.room` in `PORT_AUDIO_EVENTS` (SILENT in the placeholder), category sfx (no
   music duck), `SFX_PRIORITY` 45 / 66, `SFX_FALLBACK` -> `sfx.score.tick`; the room cue at `teammateVolume` from
   outside the room. Candidates for GR10: `Bonus/Coin3` with `lowpassHz` ~2200 and `gainDb` -6 for the floor, the same
   clip unfiltered (or a `mix` of two `Coin2` taps) for the room; must read apart from the hit's plain `Coin.wav`.
6. **HUD:** `GoldenRumourChip` beside `HordeChip` (status corner and touch strip), coin glyph, `golden.coin`.
7. **Strings** (each with an l10n context entry): `hud.chip.golden.rumour` "Coins jingling...",
   `hud.chip.golden.hiding` "It's hiding here!", `bestiary.golden.rumour`; sighting id `golden.rumour` appended to
   `SIGHTING_IDS`. No new top-level Luau locals.
8. **Debug:** `KV_GoldenLabel` adds the rumour phase, the piece slot and `releaseTick`.

## Tasks

- [x] **GR0. Confirm the code assumptions.** The Charger / Bomber / slam paths into `damageBreakable` and what they do
  when it refuses (the chest's behaviour); anything that assumes the chest is the last piece; `engageTick` latching
  unchanged; the loot glint's call site; the cue mapper's state under local prediction; `isDraftOpen` per frame; the
  floor-change sequence; two chips on a phone; `SIGHTING_IDS` append rules; `lowpassHz` / `mix` on committed `main`.
  → Verify: each assumed row marked read or corrected.
- [x] **GR1. The Goldling's piece** (dungeon). → Verify (spec): pure; draws 0 / 1 / 4 as stated; the piece in its
  room, off doorways, spawns, pellets and the chest's front, passing the gap and reachability rules; appended last
  (every earlier slot, loot slot and the chest's slot unchanged); `roomSpawnTiles` loses only its cell; party sizes
  1-4; every other floor output identical to today; never the boss room. **Census** (runs 1-40 x floors 2-20, solo and
  party of 4): Goldling floors per band against today's (target: equal; a room with no fitting cell is the only loss),
  barrel / crate split.
- [x] **GR2. Hidden, released** (sim). → Verify (spec): no appearance before the break; a sword, an arrow, a roll and a
  build splinter each release it on the break tick at the cell centre; an enemy bullet, a Charger, a Bomber and a slam
  never damage that piece; it never drops loot; SKIPPED on a full pool; the room clears without it; floor change while
  hidden: gone, no counters; replays bit-identical; absent config unchanged; M1, fixtures, tutorial unchanged; the
  pacts freeze spec without the waiting branch.
- [x] **GR3. Hash and worlds.** → Verify: `releaseTick` / `piece` at the end of `golden`; the hash-group pins; daily /
  dev follow; `DAILY.ruleset` + 1; the pins that record endless floors (roomPool.lock, vault, charger / stormcaller)
  re-recorded where a Goldling piece now stands; `npm run verify`.
- [x] **GR4. Glint and release view.** → Verify (spec): the Goldling's piece glints while WAITING exactly like a loot
  piece (art, tint, phase) and stops at the break; the break, then the coins and `GOLDLING!`.
- [x] **GR5. Rumour phase and clock** (view). → Verify (spec): once per floor, never under a draft, room-before-floor
  skips the floor cue, a second floor re-arms, read-only on the state; the chip stays `ROOM` after the room clears
  while hidden.
- [x] **GR6. Audio IDs and cues.** → Verify (`view/audio/goldenRumourCues.spec.ts`): IDs, SILENT + fallback volume,
  priorities, teammate volume, no duck.
- [x] **GR7. Chip, first-time card, strings, debug label.** → Verify: both chip texts, pulse / reduced motion, beside
  `HORDE`, touch strip, never under a draft; the card once per account; l10n context entries; locale check; label
  lines.
- [x] **GR8. Census** (`run/goldenCensus.spec.ts`, a bot that walks to the glinting pieces and breaks them): catch rate
  and seconds from the room cue to the release, during the fight and after the clear, sword / bow, solo / party,
  floors 2 / 6 / 12, against GE4's numbers. Feeds FORTUNE.md's open owner calls 2 and 3.
- [x] **GR9. Docs.** FORTUNE.md ("Hiding places and rumours", as built), DECOR.md / BREAKABLE_DROPS.md (the appended
  piece, the shared glint), FX_AUDIO.md, CLIENT.md, DAILY.md (the bump), the CLAUDE.md docs row and log; seeds for the
  Studio check.
- [ ] **GR10. [owner] Audio audition** (`art/audio-audition.html`).
- [ ] **GR11. [owner] Studio check and playtest.** The questions: do players go looking, do kids get "it's in the
  glinting crate", and is a calm catch after the clear too easy?
- [ ] **GR12. Telemetry (optional, folds into FORTUNE.md FO11).** Per Goldling floor: found or not, during the fight or
  after, seconds from the room cue to the release, caught / escaped.

## Decisions

Confirmed by the owner (Kaleb), 2026-11-12:

- **RD1 (a). Always true.** A jingle means a Goldling, every time (the only miss is SKIPPED, a full actor pool).
- **RD2 (a). No direction.** The floor rumour says "somewhere on this floor"; you explore.
- **RD8 (a). The chase stays as it is:** the 10 s window, the hp and the payouts. The appear rule is replaced by RD10,
  and with it the "no ruleset bump" part (the hiding place changes play).
- **RD10. It hides in a barrel or crate** in its room and comes out when that piece breaks.
- **RD11 (b). It brings its own piece**, appended after every other piece, so the Goldling floor rate stays 30 / 35 /
  40 % and the floor's clutter is otherwise untouched.
- **RD12 (a). Not finding it is fine.** It stays hidden until the floor ends; you can still hunt after the clear.
- **RD13 (a). Players only.** Sword, arrows, rolls and build effects break it open; enemy bullets, Chargers, Bombers
  and slams leave it alone.
- **RD14. Its piece glints like a loot piece** (the boost glint: same art, tint and phase rule).
- **RD15 (a). Never loot and the Goldling in one piece.**

Built as the recommended option, owner to confirm (2026-11-12):

- **RD3. Room trigger.** (a) **On entering** (the room's engage tick) *(recommended)*. (b) At a doorway, within 3 tiles,
  before you go in. (c) Both.
- **RD4. Visual counterpart.** (a) **The chip** *(recommended: muted phones, players who can't hear it)*. (b) Sound
  only.
- **RD5. Repeats.** (a) **Once per floor, once per room** *(recommended)*. (b) The floor jingle repeats every 20 s while
  hidden and no fight is on.
- **RD6. Co-op.** (a) **Everyone hears both**, teammate volume from outside the room *(recommended)*. (b) The room cue
  only inside the room.
- **RD7. First-time card.** (a) **Yes, once per account** *(recommended)*. (b) No card.
- **RD9. Names.** (a) **Rumour** (`goldenRumour*`, `sfx.golden.rumour.*`) *(recommended)*. (b) Whisper / jingle.

## Risks

- **A quick hunt.** With the glint (RD14), the room shows at most two glinting pieces (one loot, one Goldling), so the
  find takes seconds once you are in the room; the floor-level search carries the hunt. GR11 asks whether that is
  enough.
- **Farming after the clear** (RD12): catches may rise sharply. GR8 measures it; the lever is the window (FORTUNE.md's
  open owner call 2).
- **A placement that hurts the room:** an extra solid piece can narrow a lane or sit by the vault's chest. The gap and
  reachability rules and GR1's chest-front rule cover it; GR1's spec checks reachability.
- **Enemy-proof pieces** (RD13) could read as odd if a player sees bullets bounce off one crate; GR11 watches for it.
- **Masking and confusion** of the faint jingle with the hit coins (GR10 tunes it; the chip is the backstop).
- **Prediction:** a room cue on a mispredicted step (GR0).

## As built (2026-11-12)

Branch `goldling-rumours` from `main` @ `677b5b1`, one commit per task (GR1-GR8; GR0's findings went into GR1 / GR2,
listed under "GR0" below); rebased onto `main` @ `6704c16` (the floor modifiers, docs/FLOOR_MODIFIERS.md) on
2026-11-12, see "Rebase onto the floor modifiers" below; then onto `4cf11cb` (DSD18, the audio sources) and `8b095ab`
(the long censuses split into shards: no change here but the shard helpers' barrel). Gameplay for the Goldling only; everything else on the floor and in the sim is unchanged.
M1, every golden fixture and the tutorial (no Goldling) replay exactly as before.

### GR0 (the code assumptions)

- **Enemy paths into `damageBreakable`:** enemy bullets (`ENEMY_BULLET`), the boss's slam, a Bomber's blast and a
  Charger's charge (the last three `SLAM` through `slamBreakables`, the blast / charge with their own radius). Refused
  like the chest's: a bullet that reaches the piece is still consumed (it stops on it), a Charger stops at it like a
  wall and stuns, the Bomber's blast leaves it intact. The comments that called the chest the floor's last piece now say
  "after the clutter; only the Goldling's piece comes after it" (`EndlessFloorLayout.vault`).
- `engageTick` latches as before; the glint's call site is BreakableRenderController (now through `pieceGlints`); the
  clock reads the run view's state (`ctx.run.state`: in co-op the merged state, never the predicted head, so no cue on
  a mispredicted step); `isDraftOpen` per frame; two chips share the boost row's one cell (below); `SIGHTING_IDS` and
  `BESTIARY_STRING_KEYS` append at the end; the candidates use the audio pipeline's `lowpassHz` / `mix` (GR6).

### Dungeon (GR1)

- `placeGolden` (still last in `buildEndlessFloor`, its own stream, salt `0x3d2f8b4d`) also places the hiding place.
  **Draws:** 0 below floor 2; 1 on a miss or with no eligible room; 4 on a hit (chance, room, cell, kind).
- **Eligible room** (`goldenRooms`, tested before the room draw): `goldenRoomOpen` (combat / elite, planned spawns,
  >= `minRoomTiles` 100 FLOOR cells, never the boss room) **and** at least one piece cell (`goldenPieceCells`).
- **Piece cell** (uniform draw, row order): a `breakableCandidates` cell of the room (off doorways, spawns, the
  entrance, the stairwell, pedestal, shrine, pools) that passes `pieceFitter` against every piece so far, the vault's
  chest included (the 2-tile gap rule and the ring reachability test), is no pellet's cell and lies outside the chest's
  **front box**: the chest's cell row plus `VAULT.wallClearTiles` (2) rows in front of it, `VAULT.sideClearTiles` cells
  to each side (the cells the vault keeps FLOOR and free, so the chest stays reachable and its boosts land on open
  floor). **Kind:** a crate at `BREAKABLE.crateShare` (0.5), else a barrel.
- `FloorGolden` gains `piece` (its breakables slot: the number of pieces before it), `pieceX` / `pieceY` (grid) and
  `pieceKind` (`GoldenRoomMask` is the room part). `GoldenFloorInput` extends `BreakableFloorInput` with `pieces` (the
  clutter, then the chest), `pellets` and `vault`. `buildEndlessFloor` appends `goldenPiece(golden)` after every other
  piece and before `roomSpawnTiles`, so every earlier output and slot is unchanged and only `roomSpawnTiles` loses its
  cell. Loot is rolled over the clutter before the piece exists: it never holds a boost (RD15).
- Test helpers `shared/dungeon/testing` `piecesBeforeGolden` / `withoutGoldenPiece` for specs that compare floor
  outputs placed before it.

### Sim (GR2, GR3)

- `GoldenState` gains `releaseTick` (-1 until a player broke its piece this floor) and `piece` (`FloorGolden.piece`,
  -1 without a Goldling); both cloned, reset by `goldenOnFloor` (which now throws if the slot is not an intact barrel /
  crate on the piece's cell) and hashed **at the end of the `golden` group** (`GOLDEN_HASH_TAIL_FIELDS`, after the
  flee field's source cells).
- **Hidden:** WAITING until a player breaks the piece; `engageTick` still latches (the room rumour). Never found: hidden
  until the floor ends, no counter (RD12).
- **Enemy refusal (RD13):** `damageBreakable` returns before any bookkeeping for `ENEMY_BULLET` and `SLAM` on that slot
  (`goldenGuardsPiece`), exactly like the chest (see GR0: bullets consumed, the Charger stuns, Bombers and slams leave
  it). A player's break (`MELEE` / `PLAYER_BULLET` / `ROLL` / `BUILD`) scores as any piece and calls the leaf hook
  `goldenOnBreak` (`releaseTick` = this tick).
- **Release:** `stepGolden` (after `stepScore`, the same tick) spawns it at the piece's cell centre
  (`goldenPieceCentre`): RUNNING, `appearTick` = that tick, `seen` + 1, `events.appeared`; a full actor pool
  (`MAX_ACTORS` 64): SKIPPED. Running, catch, escape, payouts and the flee field are unchanged (RD8).
- `holdAbsoluteTimers` drops the waiting branch (a running Goldling's `fieldTick` still moves). Removed:
  `GoldenConfig.appearTicks`, `GOLDEN_APPEAR_TICKS`, `goldenSpawnTile`. New queries: `goldenPieceAt(state, slot)` (the
  glint), `goldenGuardsPiece`, `goldenPieceCentre`.
- **Worlds (GR3):** `DAILY.ruleset` 15 -> 16 (docs/DAILY.md; 16 -> 17 on the rebase onto the floor modifiers, which
  took 16, and 17 -> 18 on the rebase onto DSD18, which took 17); the all-time boards stay `_v1`. Re-recorded, only where a
  Goldling piece now stands (each floor rolled a Goldling; with its piece filtered out the old values replay exactly):
  the Charger's run 4 floor 3 pin (`1a65fa83` -> `be9d10a6`, counts unchanged) and the Stormcaller's run 4 / run 23
  floor 3 pins (`3/0/4b457f84` -> `3/0/77c11a8d`, `6/0/c213cd8f` -> `6/0/a2fea36e`). No other pin, digest or
  hash-group layout moved (`hash.spec`, `roomPool.lock`, vault, determinism). After the rebase: run 23's co-op floor 3
  is also a Hoard floor (docs/FLOOR_MODIFIERS.md), so its pin is `6/0/87bec14a` (main's Hoard pin `6/0/59e6c52a` plus
  the Goldling's piece).

### View (GR4-GR7, presentation only)

- **Glint (GR4):** shared/view `pieceGlints(state, slot)` is the one test (a loaded piece, `breakableLootAt`, or the
  Goldling's piece while it hides, `goldenPieceAt`); `glintSlotCount` scans the loot table or one past the hiding place.
  BreakableRenderController's glints follow it: the same art, tint, cadence and per-cell phase, gone the frame it
  breaks (`KV_LootDebug` still labels loaded pieces only).
- **Release:** GoldenRenderController's coin flash, ring and `GOLDLING!` wait `GOLDEN_VIEW.appear.afterBreakSec`
  (0.12 s of sim time) through `GoldenAppearQueue`, so the piece's own break reads first (cleared on run start, floor
  change and exit). Sounds unchanged: the break and `sfx.golden.appear` share the release frame.
- **Rumour phase and clock (GR5):** `shared/view/golden/rumour.ts`: `GoldenRumourPhase` NONE / FLOOR / ROOM
  (`goldenRumourPhase`: FLOOR while it hides and its room has not engaged, ROOM once `engageTick` latched, so ROOM
  holds after the clear while it still hides) and the per-client `GoldenRumourClock` (pure, read-only on the state):
  the floor cue once per floor after `floorDelaySec` 1.0 s of unfrozen FLOOR time (skipped for good if ROOM came first),
  the room cue on the first unfrozen ROOM frame; `chip()` (NONE until this floor's first cue and while frozen) and
  `heard()`. SimController owns the clock (`getGoldenRumour`), stepped right after each frame's ticks, reset on a new
  run context, held under the stage cover, the loader's hold, a solo pause, the frozen tutorial and run over.
  `goldenRumourInRoom(state, viewIndex)` for the room cue's volume. Tunables `GOLDEN_VIEW.rumour`.
- **Audio (GR6):** port audio IDs `sfx.golden.rumour.floor` / `.room` appended to `PORT_AUDIO_EVENTS` after Fortune's
  eight (`GOLDEN_RUMOUR_AUDIO_IDS`), required, sfx group, **SILENT** in the placeholder (and in vale until GR10);
  `SFX_PRIORITY` 45 / 66; `SFX_FALLBACK` -> `sfx.score.tick` (at the rumour's volume, the pack's jitter, no hit ladder);
  not a jingle, no duck. Volumes: floor 0.45, room 0.8 inside the Goldling's room; from outside it (a teammate walked
  in, RD6) x `AUDIO_VIEW.teammateVolume` and `TEAMMATE_PRIORITY_DROP` (50) lower. `art/audio.json` lists both silent and
  unconfirmed with the candidates as alternates: the floor `Bonus/Coin3` low-passed 2200 Hz at -6 dB, the room `Coin3`
  plain or a `mix` of two `Coin2` taps.
- **Chip (GR7):** `GoldenRumourChip` beside the Horde chip: `hud.chip.golden.rumour` ("Coins jingling...") from the
  floor cue on, `hud.chip.golden.hiding` ("It's hiding here!") from the room cue on; `golden.coin` on `uiPanel` with
  the coin glyph (`ui.icon.coin`); in ROOM a gentle pulse (`goldenRumourChipScale`: 1 + 0.08 x a 0.8 s wave; still
  under reduced motion). In the status corner's boost row (StatusPanel `ChipBoostRow`: the chips split the row's one
  boost cell, shared/view/golden `chipRowWidth`; one chip is exactly the old Horde chip width) and on the touch strip's
  chip line after the Horde chip. It reaches the HUD as the snapshot's `goldenRumour` (`SnapshotExtras.goldenRumour` =
  the clock's `chip()`); a chip change sends the next snapshot at once.
- **First-time card:** sighting id `golden.rumour` appended to `SIGHTING_IDS`, line `bestiary.golden.rumour` ("Hear
  coins? A Goldling is hiding in a barrel or crate on this floor. Find it!") appended to `BESTIARY_STRING_KEYS`;
  SightingController queues it on this floor's first rumour cue of either kind (`withRumourSighting`, the clock's
  `heard()`); one card at a time, so never on top of `bestiary.golden`; once per account.
- **Strings:** `GOLDEN_RUMOUR_STRING_KEYS` (written out at the end of `REQUIRED_STRING_KEYS`) and
  `GOLDEN_RUMOUR_BESTIARY_KEY`, English in the placeholder manifest, context entries in `l10n/context.json`.
  **Luau locals (out/): `contract.luau` 186, `validate.luau` 192** (no new top-level local).
- **Debug:** `KV_GoldenLabel` while it hides reads `WAITING room R piece P rumour FLOOR|ROOM release T`; after it, the
  coins and the release tick.

### Census

**Floor share (GR1, `dungeon/golden.census.spec.ts --census`: run seeds 1-40 x floors 2-20, solo and party of 4).**
Goldling floors equal the old rule's in every band, no floor lost and no room pick moved: 44 / 120 floors 2-4 (36.7 %),
72 / 200 floors 5-9 (36.0 %), 180 / 440 floors 10-20 (40.9 %); crates 144 / 296 (48.6 %); 90.2 piece cells per
eligible room solo (75.6 in a party of 4), at least 1.

**The hunt (GR8, `run/goldenCensus.spec.ts --census`; 6 Goldling floors per row, GE4's sample).** A bot walks from the
floor's spawn to the glinting piece, breaks it and chases; god mode solo, hearts topped up in the party. `focused`: the
piece, then the Goldling only (upper bound); `during`: the piece first, then GE4's fighting bot (the nearest room
member, the Goldling within 4 tiles); `after`: clears the room, then the piece, then a calm chase. The bow rows are the
**Archer** (the dev world's `characters`: GE4's bow rows swapped to weapon set 1, empty for the Knight since
docs/ARCHER.md, and read 0 / 6); the bow leads its target by the arrow's flight. Cells: caught, hits to catch, seconds
engage -> release + release -> catch.

| Bot | Floor 2 (hp 25.9) | Floor 6 (hp 50.4) | Floor 12 (hp 101.5) |
|---|---|---|---|
| Sword, solo, focused | 6 / 6, 7 hits, 1.3 + 2.4 s | 6 / 6, 13, 2.2 + 4.5 s | 5 / 6 (1 SKIPPED), 25.4, 1.4 + 9.0 s |
| Sword, solo, during the fight | = focused | = focused | = focused |
| Sword, solo, after the clear | 6 / 6, 7, 4.4 + 2.6 s | 6 / 6, 13, 9.7 + 4.6 s | 6 / 6, 25.7, 13.9 + 8.8 s |
| Bow (Archer), solo, focused | 6 / 6, 26, 5.8 + 7.6 s | 0 / 6 (2.2 s to release) | 0 / 6 (8.4 s to release) |
| Bow (Archer), solo, after the clear | 6 / 6, 26, 8.3 + 7.4 s | 1 / 6, 51, 20.8 + 7.6 s | 0 / 6 (35.2 s to release) |
| Sword, party of 2, focused (hp 41.5 / 80.6 / 162.4) | 6 / 6, 10, 1.9 + 1.7 s | 6 / 6, 21, 2.6 + 3.9 s | 4 / 6 (2 SKIPPED), 41, 1.2 + 7.5 s |

Solo sword: focused 17 / 18, during the fight 17 / 18, after the clear 18 / 18 (GE4: focused 15 / 18, fighting the room
6 / 18; the plan's target 50-65 %). Bow (Archer): 6 / 18 and 7 / 18. Party of 2: 16 / 18 (GE4 18 / 18). Read with care:

- **It comes out within sword reach.** The bot is at the piece when it breaks, and a 6 u/s chaser stays on a 5.1 u/s
  runner (docs/FORTUNE.md open call 4), so the room's fight never gets a look in: `during` plays exactly as `focused`.
  GE4's lower bound (6 / 18) came from the Goldling appearing on the far spawn tile mid-fight; that case is gone.
- **The calm catch after the clear** (RD12) is 18 / 18, at 8.8 of 10 s on floor 12: hp scaling still bites at depth,
  the window does not.
- **The bow** catches only on floor 2: the stream is 5 arrows / s x 1 damage, so 50 hp (floor 6) needs 10 s of
  perfect hits (the bot never uses the heavy arrow).
- **SKIPPED:** 3 of the floor-12 focused hunts broke the piece with the actor pool full (64 live): the bot walks
  through rooms and fights none, so their enemies pile up. The rumour then lied (RD1's one exception). The `after` bot
  never hit it.

### Tests

New specs: `dungeon/golden.census.spec` (GR1), `view/golden/release.spec` (GR4), `view/golden/rumour.spec` (GR5),
`view/audio/goldenRumourCues.spec` (GR6), `view/golden/rumourChip.spec` (GR7); `dungeon/golden.spec` and
`sim/golden/golden.spec` grew the placement, refusal, release, replay and clone cases; `run/goldenCensus.spec` is the
GR8 hunt (default: 1 Goldling floor per row on floors 2 and 6, 16 s; `--census` 3.7 min). Pins that follow the
appended ids, keys and pieces: the payouts, freeze, view golden, theme (fortune, audio, boosts, contract,
enemyVariants, pellets, runRecap, treasure) and dungeon (affixes, breakableLoot, breakables, endless, pellets, vault)
specs, the charger / stormcaller pins, `daily.spec`. Re-run for GR9 (headless, after a fresh build): every Goldling,
pacts freeze, Charger, Bomber, Stormcaller and daily suite, 17 suites, 179 tests, all pass; typecheck and lint clean.
Full `npm run verify` on the branch after GR9 (cloud, x86): typecheck, lint, check:assets, check:autolocalize,
test:art, test:checks, test:l10n and the build clean; Lune 476 of 477 suites, 6201 of 6202 tests (90 min), the one
failure the known x86-only `dungeon/forge/forge.spec.ts` NaN sign bit. Review fixes after it (re-checked: typecheck,
lint, build, test:art, check:assets, test:checks, `view/audio view/golden theme/fortune theme/audio` 23 suites / 278
tests): both rumours fall back to `sfx.score.tick` (not `sfx.golden.hit`, which has no clip on main, and a fallback
resolves one step); the touch strip's boosts take the width the Horde and rumour chips leave. Open nit for the owner:
`sfx.golden.appear` plays on the break's frame while the flash and `GOLDLING!` wait `afterBreakSec` 0.12 s.

### Rebase onto the floor modifiers (2026-11-12)

- **Gilded** (`placeGolden`'s `certain`, a modifier floor's sure Goldling) now places its piece too: `placeFloorParts`
  passes the pieces so far (the chest included), the pellets and the vault; the piece is appended in
  `buildEndlessFloor` after `placeFloorParts`, so a forced re-run never sees it. Gilded's eligibility
  (`floorModifierEligible`) asks `goldenEligibleRooms` with the natural pieces and chest, so a Gilded floor always has
  a room its piece fits in. On a Hoard floor the Goldling's room and roll are the natural ones; its cell and slot are
  placed against the forced chest (modifiers.spec's Hoard case).
- **Chips:** the status corner's chip row holds the floor modifier, Horde and rumour chips. Without the modifier they
  split the row but one boost cell (`chipRowWidth`); with the modifier and another chip they take a line of their own
  (the modifier in a boost cell's width, as main had it with the Horde) above the boosts. The touch strip budgets all
  three before the boosts and items.
- **Theme order:** the rumours' two audio IDs and two chip strings come after the floor modifiers' five stings and
  eleven strings (their tail specs in floorModifiers / fortune / treasure / runRecap / boosts / contract skip them).
- `DAILY.ruleset` 17 (18 after the second rebase, onto `main` @ `4cf11cb`: DSD18 and the audio sources); the
  stormcaller co-op pin `6/0/87bec14a` (above). After the second rebase, on DSD18's rosters, the pins are re-recorded
  once more where the Goldling's piece stands: charger `7414ecc5` -> `e42f7fdf`, stormcaller `3/0/ad7f1462` ->
  `3/0/0406aa34`, `6/0/f7c37743` -> `6/0/346b5428` (strike and skip counts unchanged).
- Verify after the rebase (cloud, x86): typecheck, lint, check:assets, check:autolocalize, test:art, test:checks,
  test:l10n and the build clean; Lune 482 of 483 suites pass, the one failure the known x86-only
  `dungeon/forge/forge.spec.ts` NaN sign bit.

## Studio check

Not run yet. In Studio, dev panel (**F2**), pick the seed and floor (dev runs are solo; the co-op checks need a lobby
run). Turn on `KV_GoldenLabel` (rumour phase, piece slot, release tick) and `KV_LootDebug` (the loaded pieces). Cells
are grid (x, y); every Goldling piece is its floor's last breakables slot.

| Seed, floor | What is there |
|---|---|
| **2, floor 2** | The Goldling in room 3, a barrel at (60, 12), slot 30; no loaded piece in its room, no vault on the floor (docs/FORTUNE.md's Studio seed) |
| **14, floor 2** | Room 2, a barrel at (51, 42), slot 35, **and a loaded piece in the same room** (slot 7, Quickstep): two glints, one of them the Goldling. Also **42, floor 2** (room 6, a crate at (76, 28); loot slot 5, Quickstep) |
| **44, floor 2** | Room 6 is **also the vault room**: a crate at (39, 61), slot 26, the chest slot 25. Also **12, floor 3** (room 11) and **11, floor 4** (room 3) |
| any seed, floor 1 | No Goldling (from floor 2) |

- Arrive: the draft closes, about 1 s later the faint jingle (silent until GR10: the score tick plays) and
  `Coins jingling...`; nothing under the draft or the stage cover. First run on a fresh account: the card once.
- Enter its room: the brighter jingle, `It's hiding here!` (gentle pulse; reduced motion: none); a glinting barrel or
  crate; no Goldling yet, however long you fight.
- Enemy bullets on the glinting piece stop on it and do nothing; a Charger stuns on it; a Bomber's blast leaves it.
  Break it: its break, then (0.12 s later) the coin burst and `GOLDLING!`, the ring; the chase as before. On seed 14 /
  42 the loot piece's glint gives a boost as before and the two glints look the same.
- Seed 44: the chest stays reachable round the Goldling's piece; the vault opens as before.
- Clear the room without breaking it: the chip and the glint stay; break it after the clear: it runs, catchable.
- A floor without one: no jingle, no chip. SFX volume 0: the chip and the glint still tell the story. Phone: both chips
  on the touch strip.
- Co-op (lobby run): a teammate enters the room while you are elsewhere (the quieter cue, your chip changes); a
  teammate breaks the piece (everyone sees it come out).
