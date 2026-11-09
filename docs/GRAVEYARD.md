# Graveyards: rows of solid graves in the playable area

Status: **planned 2026-11-08**, not started (the device shell was down; implementation needs `npm run verify`).
Builds on docs/DECOR.md "Graves" (the five gravestone looks, original art) and "Solid decor" / "Room themes" (the
`solidDecor` Forge option, endless only).

## Goal

On grim floors the Dungeon Forge already marks up to 3 combat rooms as graveyards (`Room.grave`). Today their graves
are moved by the decor plan onto the rooms' far-wall tops (2-3 a room) and the rooms themselves are dressed as crypts
(tombs along the walls). Instead, a graveyard room becomes a real graveyard: **rows of headstones standing in the room
itself, solid like the tombs**, with aisles to fight in.

## Owner decisions (2026-11-08)

| # | Question | Answer |
|---|---|---|
| GYD1 | Collision | **Solid cover**: every grave's cell becomes WALL (blocks movement, enemies, bullets and sight), like tombs. Gameplay change. |
| GYD2 | Which rooms | **Grim graveyards only**: the Forge's existing `Room.grave` rooms (combat, not ellipse, short side >= 8, up to 3 on a grim floor, about 1 floor in 5). |
| GYD3 | Density | **Rows with aisles**: graves 2 tiles apart along a row (one floor cell between stones), rows 3 tiles apart (2-tile aisles); doorways and a fighting space in the middle stay open. |
| GYD4 | The far-wall graves | **Removed** in graveyard rooms: graves stand only in the rows. |

Proposed (confirm while building):

- GYD5. **M1 and the tutorial keep today's look.** They have no solid decor (fixtures and lessons), so their graveyard
  rooms keep the far-wall graves; only endless (solo, co-op, daily, dev) gets the rows.
- GYD6. **The stones keep facing the camera.** All five looks are already turned to the camera (28 degrees to their lit
  side), so every row reads as stones facing the same way, as in a real graveyard. Looks by cell hash as now.

## What exists

- Forge (`forge/generate.ts`): `TH.graveyards` (grim only) marks rooms; a grave room gets no pillars and no pools, and
  its props are `grave` on a 2-step grid (80 %), a `sarco` at the centre of big ones and a few candles.
- Solid decor (`forge/solidDecor.ts`, own stream `seed ^ SOLID_DECOR.salt`): a grave room's theme is always `crypt`
  (3-4 wall tombs, 5-6 in big rooms, maybe a centre tomb). Rules: pieces flush or free-standing with `clearTiles` (2)
  of floor round them, nothing within `doorTiles` (3) of a doorway, the floor stays one piece, and solidDecor.spec
  forbids new one-tile pinches (one by-design exception today: a free-standing tomb's candle).
- Decor plan (`view/decor/decorPlan.ts`): the `solid` step stands every `Dungeon.solidDecor` piece on its cells at
  floor level (layer low, a fade box from `DECOR_BOX[kind]`, no footprint rule); the tall step moves Forge `grave`
  props to far-wall tops.
- Art: `grave-rounded` / `-cross` / `-cracked` / `-obelisk` / `-skull` (own PNGs, uploaded), today `pivot: "bottom"`
  (the lowest pixel: the plinth's front corner), mapped as `decor.delve.b<n>.grave` variants 1-5, layer tall.

## Plan

1. **A `graveyard` room theme** (solidDecor.ts): `Room.grave` rooms take `graveyard` instead of `crypt` (no wall
   tombs). New `SolidDecorKind` `grave` (1 x 1, fx = fz = 0). Tunables `SOLID_DECOR.graveyard`:
   - `rowAxis`: rows run along the room's long side (ties: along X);
   - `step` 2 (stone, gap, stone ...) along a row, `rowStep` 3 (two aisle cells between rows);
   - `wallClear` 2 (the perimeter walk stays two wide, the crypt rule), `doorTiles` 3 plus a **door lane**: the cells
     within 1 of the straight line from each doorway to the room centre stay floor, so every door opens onto an aisle
     into the middle;
   - `centreClear` 3: a 7 x 7 open square at the centre (the fight's middle; a big room's Forge sarco is a far-wall
     tall prop, unaffected);
   - `jitter`: each row's phase (0 or 1 along the row) and the grid's offset from its own stream, and each stone kept
     at `keepShare` 0.85 (a few missing stones, like the Forge's 80 %), so rows read hand-laid, not stamped;
   - `minStones` 6: a room where fewer fit (small or broken up by doors) falls back to `crypt`.
   Draw order and counts are fixed per room (no reroll on the main stream). Census target: 15-30 stones a room.
2. **Pinches by design.** The one-cell gap between two stones of a row is a one-tile pinch with two-wide aisles on
   both sides; solidDecor.spec gets a second by-design exception (a cell between two `grave` pieces of one room in a
   row), every other rule unchanged (floor in one piece, nothing new elsewhere). A stone is an isolated 1 x 1 blocker
   (all 8 neighbours open), so the wall slide's pillar slip (docs/WALL_SLIDE.md WSD3) rounds it.
3. **Decor plan.** The `solid` step draws `grave` pieces like the candle stand (one cell, fade box, variant by cell hash
   over the pack's grave variants). On a floor with solid decor (`Dungeon.roomThemes` present) the tall step skips Forge
   `grave` props in `graveyard` rooms (GYD4); floors without it plan them as today (GYD5).
4. **Art and box.** The stones stand on the floor now, so their pivot should be the cell's centre on the floor, not the
   plinth's corner: gen-grave-art.js writes its canvas pivot (the cell centre) to `grave/grave_<look>.pivot.json`
   (render_kit.py `pivotOut`'s format) and atlases.json takes explicit `pivot: [x, y]` (layout.ts regenerated; the PNGs
   do not change, so nothing is re-uploaded). The layer of the vale mapping becomes `low`; the wall-top use (M1, GYD5)
   keeps working with the centre pivot as long as its tall box allows the plinth's 4 render px below it (measure; else
   keep a second, tall-only mapping). `DECOR_BOX.grave` measured on the built outlines (today's 18 x 26 was a guess):
   about 18 wide (x -2), 17 high, `below` 4.
5. **Gameplay follow-ups.** Room spawn tiles, breakables, pellets, the vault chest and the Goldling already avoid solid
   cells; check the census that a graveyard still fits its encounter (spawn tiles >= the room's budget) and that the
   vault never picks a cell sealed between stones. Enemies steer round them (`actorSteerMover`).
6. **Pins and rules.** Endless layouts, spawns, replays and scores change on every grim floor with a graveyard; boards
   stay `_v1`; `DAILY.ruleset` +1; `roomPool.lock.spec`'s roster digests and the determinism pins that walk endless
   floors (charger / stormcaller run 4, the snag census) re-recorded. M1, every fixture and the tutorial unchanged.

## Tasks

- [ ] **GY0. Findings.** Census of the current graveyard rooms (72 floors, the solidDecor.spec set): how many, sizes,
  doors, and how many stones each layout rule yields; pick `rowStep` / `centreClear` from it.
- [ ] **GY1. Theme and placement** (solidDecor.ts, types.ts): `graveyard`, kind `grave`, `SOLID_DECOR.graveyard`,
  the crypt fallback. Spec: rows on the census floors, every rule, the pinch exception, determinism, no main-stream draw.
- [ ] **GY2. Decor plan**: draw `grave` solid pieces, skip the Forge graves in graveyard rooms; decorPlan specs.
- [ ] **GY3. Art pivot**: `pivotOut` in gen-grave-art.js, explicit pivots in atlases.json, `art:lock`, `art:build`,
  `DECOR_BOX.grave` measured; vale mapping layer; valeArt / valeWorld specs.
- [ ] **GY4. Gameplay census**: spawns, vault, pellets, Goldling, bots (the endless test bot paths round stones:
  `pathField` blocked cells already cover WALL).
- [ ] **GY5. Re-pins**: roomPool.lock digests, determinism pins, `DAILY.ruleset`, CLAUDE.md entry, docs/DECOR.md.
- [ ] **GY6. Verify**: `npm run verify` (every spec file).
- [ ] **GY7. [owner] Studio check**: seed 2 or 3, floor 1 (grim) in dev mode: rows read as a graveyard, aisles feel
  fair under fire, enemies do not snag, the fade works when you walk behind a stone.
