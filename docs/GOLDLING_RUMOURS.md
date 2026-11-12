# Goldling rumours: hear it, find its hiding place, catch it

Status (2026-11-12): **plan, revision 3.** The owner (Kaleb) has confirmed RD1, RD2, RD8 and RD10-RD15 (see
"Decisions"): the Goldling **brings its own barrel or crate** into its room, the piece **glints like a loot piece**,
**only players** can break it open, it never shares a piece with loot, and a Goldling nobody finds is fine. RD3-RD7 and
RD9 are built as their recommended options (owner to confirm). Planned against `main` @ `677b5b1` (Fortune and treasure rooms merged; the uncommitted audio
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
   music duck), `SFX_PRIORITY` 45 / 66, `SFX_FALLBACK` -> `sfx.golden.hit`; the room cue at `teammateVolume` from
   outside the room. Candidates for GR10: `Bonus/Coin3` with `lowpassHz` ~2200 and `gainDb` -6 for the floor, the same
   clip unfiltered (or a `mix` of two `Coin2` taps) for the room; must read apart from the hit's plain `Coin.wav`.
6. **HUD:** `GoldenRumourChip` beside `HordeChip` (status corner and touch strip), coin glyph, `golden.coin`.
7. **Strings** (each with an l10n context entry): `hud.chip.golden.rumour` "Coins jingling...",
   `hud.chip.golden.hiding` "It's hiding here!", `bestiary.golden.rumour`; sighting id `golden.rumour` appended to
   `SIGHTING_IDS`. No new top-level Luau locals.
8. **Debug:** `KV_GoldenLabel` adds the rumour phase, the piece slot and `releaseTick`.

## Tasks

- [ ] **GR0. Confirm the code assumptions.** The Charger / Bomber / slam paths into `damageBreakable` and what they do
  when it refuses (the chest's behaviour); anything that assumes the chest is the last piece; `engageTick` latching
  unchanged; the loot glint's call site; the cue mapper's state under local prediction; `isDraftOpen` per frame; the
  floor-change sequence; two chips on a phone; `SIGHTING_IDS` append rules; `lowpassHz` / `mix` on committed `main`.
  → Verify: each assumed row marked read or corrected.
- [ ] **GR1. The Goldling's piece** (dungeon). → Verify (spec): pure; draws 0 / 1 / 4 as stated; the piece in its
  room, off doorways, spawns, pellets and the chest's front, passing the gap and reachability rules; appended last
  (every earlier slot, loot slot and the chest's slot unchanged); `roomSpawnTiles` loses only its cell; party sizes
  1-4; every other floor output identical to today; never the boss room. **Census** (runs 1-40 x floors 2-20, solo and
  party of 4): Goldling floors per band against today's (target: equal; a room with no fitting cell is the only loss),
  barrel / crate split.
- [ ] **GR2. Hidden, released** (sim). → Verify (spec): no appearance before the break; a sword, an arrow, a roll and a
  build splinter each release it on the break tick at the cell centre; an enemy bullet, a Charger, a Bomber and a slam
  never damage that piece; it never drops loot; SKIPPED on a full pool; the room clears without it; floor change while
  hidden: gone, no counters; replays bit-identical; absent config unchanged; M1, fixtures, tutorial unchanged; the
  pacts freeze spec without the waiting branch.
- [ ] **GR3. Hash and worlds.** → Verify: `releaseTick` / `piece` at the end of `golden`; the hash-group pins; daily /
  dev follow; `DAILY.ruleset` + 1; the pins that record endless floors (roomPool.lock, vault, charger / stormcaller)
  re-recorded where a Goldling piece now stands; `npm run verify`.
- [ ] **GR4. Glint and release view.** → Verify (spec): the Goldling's piece glints while WAITING exactly like a loot
  piece (art, tint, phase) and stops at the break; the break, then the coins and `GOLDLING!`.
- [ ] **GR5. Rumour phase and clock** (view). → Verify (spec): once per floor, never under a draft, room-before-floor
  skips the floor cue, a second floor re-arms, read-only on the state; the chip stays `ROOM` after the room clears
  while hidden.
- [ ] **GR6. Audio IDs and cues.** → Verify (`view/audio/goldenRumourCues.spec.ts`): IDs, SILENT + fallback volume,
  priorities, teammate volume, no duck.
- [ ] **GR7. Chip, first-time card, strings, debug label.** → Verify: both chip texts, pulse / reduced motion, beside
  `HORDE`, touch strip, never under a draft; the card once per account; l10n context entries; locale check; label
  lines.
- [ ] **GR8. Census** (`run/goldenCensus.spec.ts`, a bot that walks to the glinting pieces and breaks them): catch rate
  and seconds from the room cue to the release, during the fight and after the clear, sword / bow, solo / party,
  floors 2 / 6 / 12, against GE4's numbers. Feeds FORTUNE.md's open owner calls 2 and 3.
- [ ] **GR9. Docs.** FORTUNE.md ("Hiding places and rumours", as built), DECOR.md / BREAKABLE_DROPS.md (the appended
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

## Studio check

In Studio, dev panel (**F2**); seeds from GR9 (a Goldling floor, a Goldling floor whose room also has a loot piece, a
Goldling room with a vault). Turn on `KV_GoldenLabel` (rumour phase, piece slot, release tick).

- Arrive: the draft closes, about 1 s later the faint jingle and `Coins jingling...`; nothing under the draft.
- Enter its room: the brighter jingle, `It's hiding here!`; a glinting barrel or crate; no Goldling yet, however long
  you fight.
- Enemy bullets on the glinting piece do nothing to it. Break it: its break, the coin burst, `GOLDLING!`, the ring;
  the chase as today. A loot piece's glint in the same room gives a boost as before.
- Clear the room without breaking it: the chip and the glint stay; break it after the clear: it runs, catchable.
- A floor without one (floor 1): no jingle, no chip. First run on a fresh account: the card once. Reduced motion: no
  pulse. SFX volume 0: the chip and the glint still tell the story.
- Co-op (lobby run): a teammate enters the room while you are elsewhere (the quieter cue, your chip changes); a
  teammate breaks the piece (everyone sees it come out).
