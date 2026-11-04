# Bookshelves (plan, as built)

Status (2026-11-03): **BK0-BK5 and BK7 done** on branch `bookshelves` (BK0-BK4 in `caa1ef3`): kit facts, the Forge
piece and the library theme, the re-pins, the decor plan, the rendered art wired into vale, the full suite green on
aarch64, the art uploaded. Bookcases are solid in endless floors and drew nothing until `kit-bookcase-x.png` / `-z.png` were uploaded
(BK6, done the same evening). BK0 switched the piece to 1 x 1 (BKD4) and set the scale (BKD9).
Owner answers (2026-11-03): bookshelves are **solid** (BKD1); a **new `library` room theme plus a few in `hall`
rooms** (BKD2). Everything else is proposed.
Reading area (2026-11-04, owner: "the library reads as partially done; add a table and chair"): built on branch
`reading-area`, see "Reading area" below (tasks RA1-RA6, decisions BKD11-BKD14).

Goal: rooms that read as libraries. Bookcases from the **Dungeon Essential Kit** (Rakshaan, CC-BY 4.0, already on the
Credits screen) stand flush against a room's walls, end to end in runs, the way real bookshelves line a wall. They
build on docs/DECOR.md "Solid decor" and "Room themes": a bookcase is one more solid set piece, placed by the Forge's
`solidDecor.ts` and drawn by the decor plan's `solid` step.

**Sim impact: dungeon only.** A bookcase's cells become WALL, so they block movement, bullets and sight like a tomb.
No sim code, hash group, rng stream, payload or lockstep change, but **endless layouts, spawns, replays and scores
change** from floor 1 (all-time boards stay `_v1`, as with every earlier endless change; `DAILY.ruleset` 5 -> 6).
M1, every fixture and the tutorial (`solidDecor: false`) replay exactly as before.

## What the code says (checked 2026-11-03)

| Fact | Where | Consequence |
|---|---|---|
| `placeSolidDecor` runs after every decoration and solid pillars, on its own stream `makeRng(seed ^ SOLID_DECOR.salt)`; rooms in id order; one `pickTheme` draw per combat / elite room | shared/dungeon/forge/solidDecor.ts | Bookcases go in here. Adding `library` to the weights moves which theme other rooms get, so every solid decor layout changes (accepted: it is a gameplay change anyway) |
| `flushOk(spot, clear, room, doorR)`: every cell behind the back row is non-floor; every cell within `clearTiles` (2) of the open sides is floor of the room; past the ends the back line may be wall **only as one solid run from the piece** | solidDecor.ts | A run of cases end to end is just one long spot (len n, depth 1): it passes the same rule tombs do, so a run never makes a pinch |
| `spotsOf(..., FACES_FAR, ...)` gives only the far walls' spots (facing +X / +Z), used by the throne and the statue | solidDecor.ts | Bookcases use FACES_FAR (BKD3) |
| The camera looks at the -X / -Z walls at `CAMERA_PITCH_DEG` 55; walls are 1 tile tall (`wallHeightTiles`) | shared/config/view.ts, shared/view/config.ts | A far-wall bookcase faces the camera and rises **screen-up over its wall**, never over the room. A near-wall one would show its back and cover the floor in front of it, so near walls get none |
| Standing art of height h covers ~0.7 h of ground behind its base on screen (cos 55 / sin 55) | camera math | The 1.78-tall case (BKD9) covers ~1.25 tiles behind its cell: the wall cell and a quarter tile past it. If the wall is 1 cell thick with walkable floor behind it, the shelf can hide a bullet there: BKD5's back rule |
| Forge torches (`Dungeon.torches`, x / y / dx / dy) and banner props are placed **before** solid decor | generate.ts 1054, 1230 | The Forge can keep bookcases off the wall faces that hold a torch or a banner (BKD6) |
| The decor plan's room banners step (`DECOR_BANNERS`) runs before the `solid` step and only knows wall pieces | shared/view/decor/decorPlan.ts 1139 | It must skip the wall faces behind bookcases (presentation only) |
| The `solid` step stands art on a piece's cells at floor level, layer low, with a fade box; variants by axis for tombs, by facing (`fx !== 0`) for 2D rectangles (throne, statue) | decorPlan.ts 1220-1276 | A bookcase is 2 x 1, not a rectangle: it needs its own facing branch |
| `DECOR_KINDS` (theme contract) is an array; new kinds are appended last | shared/theme/contract.ts 1113 | `bookcase` appended after `carpet`: no Luau top-level local added |
| Re-flood after solid decor: any split takes every piece back | generate.ts 1268-1282 | Bookcases inherit the safety net; the spec checks it never fires |
| The kit has **one** bookcase: mesh `BookCase_Set5_0` (node `BookCase`, material Set5, 19,360 verts). **113.6 wide x 47 deep x 222.4 tall** kit units (Blender X = depth, Y = width), its base at z -0.8; **open-backed** (books show from behind) | BK0, the .glb | One look only: variants are just the two facings |
| Kit scale: the kit's barrel is 93.5 tall, the game's barrel `maxHeightTiles` 5/8 -> **150 units a tile**; the kit's floor tile is 200, its wall 318 tall | BK0; shared/view/breakablesConfig.ts | At 2 tiles wide the case would be 3.9 tiles tall (the wall is 1): **2 x 1 is out, 1 x 1 cells** (BKD4) |
| Facings: the front is -X unrotated; `rotZ` **180 faces +X**, **90 faces +Z** (the throne's turns) | BK0 test renders | Same `rotZ` pair as `kit-throne-x / -z` |
| Test sprites at 125 units a tile (BKD9): 33 x 54 px PNG, body **27 x 48 px**, pivot `[23.14, 46.11]` (+X) / `[10.15, 46.11]` (+Z) with `pivotAt [-39.8, 0]`: the cell centre, so the case's back sits on the cell's back edge (its back face is at x 22.7, the centre half a tile = 62.5 units in front) | BK0 render_kit.py run | Ready for BK5; the +X front faces away from the kit sun and reads dark (Risks) |
| `Pedestal_Set5_0` (45 x 45 x 124, the same Set5 material) | BK0 | A lectern-like stand for BK9 |
| Room spawns, breakables, pellets, loot, the chandelier scatter and the minimap all read the grid after solid decor | breakables.ts, pellets, minimap | Nothing to add: they avoid bookcase cells and the minimap draws them as wall |

## Design

### The piece

`bookcase`: a new `SolidDecorKind`, **1 x 1** (BKD4), flush against a **far wall** only, facing +X or +Z, standing
end to end in **runs**. At 125 kit units a tile (BKD9) a case is 0.91 tiles wide, 0.38 deep and 1.78 tall: neighbours
nearly touch, so a run reads as one wall of shelves, and its top stands above the 1-tile wall like real furniture.
Two art variants: 1 facing +X, 2 facing +Z (as the throne). The kit has one look only.

Placement rules, on top of `flushOk`:

- **Far walls only** (`FACES_FAR`).
- **Back rule** (BKD5): every cell up to `backTiles` (2) behind the back row is non-walkable (WALL / VOID), so the
  shelf's top (1.78 tiles: ~1.25 tiles of ground behind its cell on screen) never stands over another floor, corridor
  or pool. Most far walls back onto the void and pass.
- **Torch rule** (BKD6): no bookcase cell in front of a wall face holding a Forge torch or banner prop. Runs fit
  between the torches, which keeps the room lit and reads like a real library wall.
- Doorways: `doorTiles` (3), as every piece.

### The library theme (combat / elite rooms)

`RoomTheme` gains `library`. Its rooms get:

- **Runs** of bookcases end to end: `runsMin`..`runsMax` (2-3, big rooms +1), each run 2-5 cases (`runMin` /
  `runMax`), checked as one spot of length n, the longest that fits tried first, then shorter (so a short wall still
  gets one); at most `maxCases` (16) a room.
- Runs at least `runGap` (3) tiles apart along a wall, so each reads as its own piece of furniture.
- A candle stand at one or both run ends (`bothCandles` 0.5, `flankSpots`, as the tombs).
- Big rooms (`bigRoomTiles` 320+): maybe the statue on a far wall (`statueShare` 0.3), reading as a study.

Weights as built (BK8 tunes them; raised from the first proposal, 0.10 / 0.15, after the census):

| | crypt | hall | store | plain | library |
|---|---|---|---|---|---|
| grim | 0.40 | 0.20 | 0.15 | 0.13 | 0.12 |
| other | 0.20 | 0.20 | 0.20 | 0.20 | 0.20 |

Graveyard rooms stay crypts; frozen-lake rooms stay bare. **A room where no run fits is dressed as plain instead**
(BKD10): about a third of the rolled libraries are round or stepped rooms whose far walls hold no straight stretch
with the 2-tile clearance, and a library with no shelves would only be a bare room. The statue is placed after the
runs, and only when at least one run stood.

### Halls

A `hall` room gets **one run of 2-3 cases** on a far wall at `hall.shelfShare` (0.5), placed before its candle
stands so the candles line the walls around it.

### Census (72 floors, as built)

`[bookcases]` in solidDecor.spec: **1.0 library a floor, 5.1 library cases + 0.9 hall cases = 6.0 cases a floor**,
2.2 runs a floor, 2.7 cases a run. The first guess (12-16) assumed straight far walls: the Forge's rooms are mostly
rounded or stepped, and a run needs one straight stretch with 2 tiles of floor on its open sides (the no-pinch rule),
3+ tiles from a doorway and clear of torches. Relaxing the back rule and the torch rule together only reached 5.7;
more runs per library did not help (no wall left). Raising the count means more libraries (the weights) or a looser
clearance (a pinch risk): BK8. Other pieces per floor: tombs 9.8 -> 9.4, candle stands 29.0 -> 26.7 (fewer crypts /
halls / plains).

### Drawing (decor plan, presentation only)

- `bookcase` joins `StandingKind`, `DECOR_KINDS` (appended last), the contract's layer table (`["low"]`) and
  `DECOR_BOX` (one box per case, measured on the render: art body 27 x 48 px over its cell, `below` for the
  floor-standing art, as the candle stand).
- The `solid` step: variant by facing (`piece.fx !== 0` -> variant 1, else 2) when the pack has both.
- Room banners skip the wall faces behind bookcases; a far-wall-top piece (sarco, candle, column) on a wall cell
  directly behind a bookcase is dropped with a new drop reason `behindShelf` (the shelf's top would cut through it).
- Fade box: kept as every solid piece (a player can stand at its ends where it hides the feet).

### Art (Dungeon Essential Kit)

- `scripts/art/kit/dungeon-essential-kit.json` gains `bookcase` (tested in BK0; the kit's grade):

  ```json
  "bookcase": {
  	"objects": ["BookCase_Set5_0"],
  	"az": [-45, -45],
  	"rotZ": [180, 90],
  	"pivotAt": [-39.8, 0],
  	"fit": "world",
  	"unitsPerTile": 125,
  	"pivotOut": true,
  	"files": ["bookcase_x.png", "bookcase_z.png"],
  	"grade": { "brightness": 0.8 }
  }
  ```

  `pivotAt` is the cell centre half a tile in front of the case's back (x 22.7 - 62.5): centred in its cell the case
  would stand 0.3 tiles off the wall.
- `art/atlases.json`: `kit-bookcase-x` / `kit-bookcase-z`, own PNGs (the decor atlas never repacks).
- Vale `manifest.ts`: `{ kind: "bookcase", variant: 1 | 2, art: "kit-bookcase-x" | "-z", layer: "low" }`.
- Upload, then `packs/vale/assetIds.ts`. Without ids the cases block but draw nothing (as the throne did).
- The +X facing's shelves are in the kit sun's shadow (BK0 render): lift its grade (a per-file brightness, or a
  second sun for that facing) until both facings read alike.

## Tasks

- [x] **BK0. Kit facts** (2026-11-03). One bookcase, `BookCase_Set5_0`, 113.6 x 47 x 222.4 units, open-backed;
  150 units a tile on the barrel; `rotZ` 180 / 90 face +X / +Z; test sprites and a mock room at 150 and 125 units a
  tile (see "What the code says"). BKD4 switched to 1 x 1; BKD9 picks 125. The .glb is back in
  `art/vendor/dungeon-essential-kit/` (gitignored; md5 `22184a5895b5ec7dac8c9f605917de84`).
- [x] **BK1. Forge piece** (2026-11-03). `bookcase` in `SolidDecorKind`; `SOLID_DECOR.bookcase { backTiles 2 }`;
  `placeSolidDecor` takes a trailing `hangs` (generate.ts passes `torches` and the banner props; default `[]`);
  `shelfOk` (back rule, torch rule, `runGap`) and `bookcaseRun` (the longest of want..min cases that fits as one
  `spotsOf(r, n, 1, FACES_FAR, clearTiles)` spot, picked at random, flank candles checked before walling, then n
  1 x 1 pieces facing the run's way).
- [x] **BK2. Library theme** (2026-11-03). `library` in `RoomTheme`, `themeWeights` and `pickTheme` (one draw, as
  before); `SOLID_DECOR.library { runsMin 2, runsMax 3, bigExtra 1, runMin 2, runMax 5, maxCases 16, runGap 3,
  bothCandles 0.5, statueShare 0.3 }`; `hall { shelfShare 0.5, shelfMin 2, shelfMax 3 }` (a run before the candles,
  one end candle). The plain fallback (BKD10). solidDecor.spec: kinds by room type and themes gain them; a new case
  checks 1 x 1, far facings only, library / hall rooms only, 2 non-walkable cells behind, no torch or banner on the
  back cell, every library has a case, and prints the census; "floor in one piece" and "no new pinch" pass unchanged.
- [x] **BK3. Re-pins** (2026-11-03). `roomPool.lock` roster digests (spawn counts unchanged, tiles moved; old
  digests in its header); `charger.spec` run 4 floor 3 (counts [3, 0, 2, 3, 0] -> [4, 2, 2, 4, 3], hash 4860eb56 ->
  acd2ce64); `stormcaller.spec` runs 4 / 23 (3/0/49e332ac, 0/0/7c9c4b5e -> 2/1/d5a796ef, 6/0/ae2b2503);
  `DAILY.ruleset` 5 -> 6 and daily.spec. pelletsCensus.spec's honest power-pellet run: its first candidate (seed 2)
  now walks over the power pellet on the way in, before the room fires; the run now tries the first
  `POWER_SEED_TRIES` (6) candidate seeds and keeps the first that erases bullets (seed 14 today). M1, every fixture
  and the tutorial specs untouched.
- [x] **BK4. Decor plan** (2026-11-03). `bookcase` in `StandingKind`, `DECOR_BOX` (`{ w: 22, h: 24, below: 3 }` from
  the BK0 test render; BK5 re-measures), the contract's `DECOR_KIND_LAYERS` (`["low"]`) and `DECOR_KINDS` (last;
  void.spec's order check); the solid step's variant by facing (BK5 re-measured the box to `{ w: 23, h: 24, below: 4 }`). Found: banners and far-wall-top pieces skip the wall
  behind a case by themselves (the case's cell is WALL, so that wall is no far wall); R6's corner / jamb columns did
  not, so `keptOut` drops anything on a case's back cell with the new reason `behindShelf` (appended to
  `DECOR_DROP_REASONS`; ~0.00 a floor in the census). decorPlan.spec: variant by facing, low, one cell, a fade box,
  nothing standing or hanging on a back cell.
- [x] **BK5. Render** (2026-11-03). The +X front no longer sits in shadow: render_kit.py gained `sunSide` (a list
  parallel to `az`; 1 the usual sun from the camera's upper left, -1 mirrored to its upper right, 0 behind the camera;
  default 1, so every other kit piece renders byte-identically), and the bookcase renders with `[-1, 1]`: the +X case
  gets exactly the +Z case's shading (front and shelves lit, side panel shaded). A per-file brightness was rejected: it
  over-brightens the already lit side. Trade-off for the Studio check: the +X case is lit from the other side than the
  rest of the decor. The kit entry is in `scripts/art/kit/dungeon-essential-kit.json`; renders `bookcase_x.png` /
  `bookcase_z.png` (33 x 54, pivots [23.14, 46.11] / [10.15, 46.11]) in `art/vendor/dungeon-essential-kit/bookcase/`;
  `art/atlases.json` `kit-bookcase-x` / `-z` (own PNGs, outline, as the throne); vale `manifest.ts` variants 1 / 2;
  `art:build` (layout.ts: only the two entries) and `art:lock` (vendor.lock.json +2 files); valeWorld.spec's world
  file list. `DECOR_BOX.bookcase` re-measured from the built outline (half-width 11.43 / 11.27, height 23.3, below
  3.18 render px): `{ w: 23, h: 24, below: 4 }` (22 / 3 would have scaled the art down). Verified on the Mac's VM:
  typecheck, lint, test:art, check:assets, and the vale pack / void / decor specs (valeArt, valeWorld, void,
  decorPlan, decorPlan.void, decor, decorFx) pass. The vendor PNGs on the Mac carry a content-credentials chunk the
  bridge added (pixels identical; the lock hashes them as on disk).
- [x] **BK6. [owner] Upload** (2026-11-03 6:20 PM): `kit-bookcase-x.png` 84780192220821, `kit-bookcase-z.png`
  106394405354637 in `packs/vale/assetIds.ts`, so the bundled vale pack draws them (the vale pack specs pass).
- [x] **BK7. Verify** (2026-11-03). On `caa1ef3` in the Mac's Linux VM (aarch64, Lune 0.11.0 linux-aarch64 in the
  VM's `$HOME/bin`): typecheck, lint, check:assets, check:autolocalize, test:art, test:checks, test:l10n and build
  pass, and **all 319 suites / 4433 tests pass** (run one spec file at a time: the VM's shell stops after ~180 s; log
  `Claude outputs/bk-verify-caa1ef3-aarch64.log`). forge.spec's NaN bit-pattern vector, which fails on x86-64 Lune
  (fff8... for 7ff8...) on the clean checkout too, passes on aarch64: a platform NaN sign, not this change.
- [ ] **BK8. [owner] Studio check** (below), then tuning: theme weights, run lengths, `shelfShare`, height.
- [ ] **BK9. Later / optional.** The Essential Kit's `Pedestal_Set5_0` or the Modular Set V2's lectern ("Book And
  Base") in big libraries; a near-wall low shelf (half height) if near walls look bare.
- [x] **BK10. Docs.** docs/DECOR.md's "Room themes" table (the `library` row, the hall line, the new shares),
  THIRD_PARTY_NOTICES.md's Essential Kit "Used for" (the bookcase), the CLAUDE.md decision log entry, the DECOR.md
  "3D kits" table row.

## Studio check

- Bookcases read as bookcases at the game camera on every biome (spines not a smear), back against the wall, no gap.
- A run of 2-3 reads as one wall of shelves; torches between runs still light the room.
- No bullet or enemy ever hidden behind a shelf's top; nothing standing on the wall top cut through.
- Enemies (walkers, chargers, the Ooze's split) round runs without snagging; snipers' lines feel fair.
- Small library rooms still have room to fight (spawn tiles, pellets patterns).
- Minimap shows runs as wall.

## Decisions

| | Decision | Why |
|---|---|---|
| BKD1 | **Solid** (owner, 2026-11-03) | A bookcase you walk through looks wrong against a wall; matches tombs, throne, statue |
| BKD2 | **New `library` theme + some `hall` rooms** (owner, 2026-11-03) | One idea per room (the room themes rule), with a few shelves elsewhere so they are not only in one room a floor |
| BKD3 | Far walls only (+X / +Z facings) | The camera sees their fronts; a near-wall case shows its back and covers the floor in front |
| BKD4 | **1 x 1 pieces in runs end to end** (BK0, 2026-11-03; was 2 x 1) | The kit's case is about twice as tall as wide: at 2 tiles wide it would stand 3.9 tiles tall. A run is still one `flushOk` spot, so no new pinch rule |
| BKD5 | 2 non-walkable cells behind the back row (proposed) | A ~1.5-tile case covers ~1 tile of ground behind its cell on screen; never over another floor |
| BKD6 | Never in front of a Forge torch or banner face (proposed) | Keeps rooms lit and the wall art visible; done in the Forge so the layout is final |
| BKD7 | Same stream as solid decor, no new salt (proposed) | The theme draw changes anyway when `library` joins the weights; a second stream buys nothing |
| BKD8 | `DAILY.ruleset` 5 -> 6, all-time boards stay `_v1` (proposed) | As every earlier endless layout change |
| BKD9 | **125 kit units a tile** (proposed after the BK0 mock; 150 is the barrel's scale) | At 150 a case is 0.76 x 1.48 tiles and a run shows gaps; at 125 (0.91 x 1.78) neighbours nearly touch and a run reads as one bookshelf wall. 20 % larger than the barrel's scale, unnoticeable side by side in the mock |
| BKD10 | **A library where no run fits is dressed as plain** (as built, 2026-11-03) | About a third of rolled libraries are rooms with no straight far wall; a bare "library" helps nobody. Costs one theme's draws in those rooms only |

## Reading area (2026-11-04)

Every library gets a reading area: a **table (2 x 1) with a chair at each end facing it**, one solid line of 4 cells
on open floor in front of the shelves. Art from the **Dungeon Assets Pack by zver.3d** (v1.0.0, free for video games,
credit to "zver.3d" requested: THIRD_PARTY_NOTICES.md, the Credits screen), in `art/vendor/zver-dungeon-assets/`.

- **Forge** (`solidDecor.ts` `readingArea`, after the library's runs, before its statue roll; no rng draw): new
  `SolidDecorKind`s `table` (2 x 1 along X or Z, fx = fz = 0) and `chair` (1 x 1, fx / fz = the way it faces: toward
  the table). The line lies parallel to the room's first run. A spot is valid when every cell of the line and of its
  2-tile ring is floor of the room **or a solid pillar of the room**, no cell is within `doorTiles` of a doorway, and its
  nearest bookcase (Chebyshev) is within `SOLID_DECOR.reading.maxDist` (8). Ranking: closest to `readingDist` (4),
  then fewer pillars cleared, then nearest the room centre, then cell order. Pillars under the line or in the ring
  are **cleared**: their cells go back to FLOOR (or become the piece) and are listed in the new
  `Dungeon.clearedPillars` (always present); `Dungeon.props` keeps the pillar props, so every prop index is the
  option-off floor's, and the decor plan draws nothing for a cleared pillar (no stump, no Forge column). Only floor is
  added, so the one-piece and no-pinch checks pass unchanged. `SOLID_DECOR.reading = { tableLength: 2, readingDist: 4,
  maxDist: 8 }`.
- **Census** (72 floors): 72 of 72 libraries have a reading area (23 before pillars could be cleared: every pillared
  library had no gap for the line and its ring); 1.0 table and 2.0 chairs a floor; 1.26 pillars cleared a floor (libraries
  lose about that much cover); nearest bookcase 4 tiles in 71 libraries, 3 in one.
- **Decor plan:** kinds `table` (low; variant 1 along X, 2 along Z) and `chair` (low; variants 1-4 facing +X / +Z / -X /
  -Z), appended last to DECOR_KINDS after `bookcase`; the variant applies when the pack has all of a kind's variants.
  `DECOR_BOX.table` `{ w: 14, h: 10, below: 2 }` (a box at both footprint ends, hulled), `.chair` `{ w: 11, h: 11, below:
  4 }`, measured on the built outlines.
- **Art** (`scripts/art/kit/zver_to_glb.py`: the FBX files + their TGA base colours -> one glb, scaled x100;
  `scripts/art/kit/zver-dungeon-assets.json`, `unitsPerTile` 220 = 2.2 FBX units a tile, matched on the pack's barrel):
  `kit-table-x` / `-z` (64 x 56, the table with the pack's stack of fabrics as papers and its round candlestick on
  top) and `kit-chair-px` / `-pz` / `-nx` / `-nz` (21 x 29 / 21 x 21: the -X / -Z chairs show their backs). `sunSide`
  -1 for every X piece, so an X reading area is lit as the mirror of a Z one. Grade `{ saturation 0.75, brightness 0.85,
  contrast 1.25 }` with the kits' warm tint. The pack has no books and no flame.
- **Changed:** endless layouts, spawns, replays and scores again; `DAILY.ruleset` stays 6 (bookshelves has not
  shipped). Re-pins: roomPool.lock roster digests (floor 1 a74a7abe / 08a7ee67 / 05962732 / 2d0f27a6, floors 2-6 a5d6f0a0
  / 79e8d2f7 / 27f499ad / 4d99fd04 / 7f0114b5; spawn counts unchanged), stormcaller run 23 (6/0/ae2b2503 -> 6/0/07335c64);
  solidPillars.spec counts a cleared pillar's cell as floor. M1, every fixture and the tutorial unchanged.

Tasks:

- [x] **RA1. Art** (2026-11-04): glb, renders, vendor files, atlases.json, art:build (re-run on the Mac: layout.ts
  unchanged) / art:lock, valeWorld.spec's file list, THIRD_PARTY_NOTICES.md and `CREDITS`.
- [x] **RA2. Forge** (2026-11-04): `table` / `chair`, `readingArea`, pillar clearing, `Dungeon.clearedPillars`.
- [x] **RA3. Decor plan and theme** (2026-11-04): kinds, variants, boxes, cleared pillars draw nothing, vale manifest.
- [x] **RA4. Verify** (2026-11-04, the Mac's aarch64 VM): typecheck, lint, check:assets, build, test:art, and every
  spec file one by one: 331 files, 4572 tests, 0 failures.
- [x] **RA5. [owner] Upload** (2026-11-04 6:04 AM): `kit-table-x` 127976474422668, `kit-table-z` 96818770768214,
  `kit-chair-px` 108393511672563, `kit-chair-pz` 101694939623100, `kit-chair-nx` 133067783649615, `kit-chair-nz`
  122253624249089 in `packs/vale/assetIds.ts`, so the bundled vale pack draws the reading area (the vale pack specs
  pass).
- [ ] **RA6. [owner] Studio check:** the reading area reads as a desk with chairs (the props shrink to 2-3 px spots; the
  chairs stand ~0.3-0.5 tiles off the table ends; the pack's seat is low against its table), the X / Z lighting, the
  lost pillar cover.

| | Decision | Why |
|---|---|---|
| BKD11 | **Table and chairs solid** (owner, 2026-11-04) | As every other solid set piece |
| BKD12 | **Free-standing in front of the shelves** (owner) | A reading area faces the books; one line of 4 with the usual 2-tile ring never pinches a path |
| BKD13 | **Clear pillars for it, in libraries only** (owner) | Pillars left room in only 23 of 72 libraries; clearing adds floor only, so no pinch, and keeps prop indices |
| BKD14 | **Within 8 tiles of a bookcase or none** (owner) | Before the cap, 8 of 23 sat 16-32 tiles away, by the opposite wall |

## Risks

- **Readability at 27 x 48 px**: in the BK0 render the shelves and spines read on the +Z facing; the +X facing's front
  is in shadow and reads as a dark panel until BK5's grade fix.
- **Tight rooms**: libraries eat wall-side floor where enemies spawn and pellets lie. The 2-tile clearance and the
  run cap keep the middle open; BK2's census reports spawn tiles lost per library room.
- **Stuck walkers**: long runs on a stepped wall. `actorSteerMover` already handles tombs; the Studio check watches
  the charger, whose wall stun now also triggers on shelves (intended: they are walls).
