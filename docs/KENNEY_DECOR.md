# Kenney decor: dungeon rooms and libraries (plan)

Status (2026-11-06): **every piece redrawn** (KN1, KN2's renders) and **Kenney's bookcases wired as alternative art
for the existing bookcase** (presentation only, "As built" below), uploaded 2026-11-06 11:46 AM; **wide pairs wired**
(KN3, "Wide cases" below) and **floor patches wired** (KN4, "Floor patches" below: planks and dirt, baked per biome);
their 12 + 25 PNGs uploaded 2026-11-06 1:19 PM; Studio check open. The Forge half (KN5-KN8) places the new pieces
(branch kenney-forge) and **KN9 draws them** ("Decor plan and theme for the Forge pieces" below: one `kenney-decor.png`
sheet, its upload pending). Owner answers (2026-11-06): **gameplay too, at once** (new solid set
pieces with the art, KND1); **kit art vs Kenney art is decided after a spike** (KND2); **props + floor patches**, walls
and biome floors unchanged (KND3); **both** a new `mess` (mess hall) theme and richer storerooms (KND4). Everything else
is proposed.

Goal: rooms that read like the two Kenney sample scenes the owner shared. The **library**: shelves of mixed bookcases
along the walls, long study tables with chairs and books, display cases, a lectern, a carpet runner down the room, a
toppled case. The **dungeon rooms**: dining tables with chairs (some broken), barrel stacks and crates, a lumber pile,
a timber scaffold over the stores, planks and dirt worn into the floor. It builds on docs/DECOR.md ("Solid decor",
"Room themes") and docs/BOOKSHELVES.md: every new solid piece is placed by the Forge's `solidDecor.ts` and drawn by the
decor plan's `solid` step, like the tombs and bookcases.

**Sim impact: dungeon only** (as bookshelves). New pieces' cells become WALL. No sim code, hash group, rng stream,
payload or lockstep change, but **endless layouts, spawns, replays and scores change** from floor 1 (all-time boards
stay `_v1`; `DAILY.ruleset` 8 -> 9 if 8 has shipped by then). M1, every fixture and the tutorial (`solidDecor: false`)
replay exactly as before. Floor patches and the bookcase variants are presentation only.

## The packs (measured 2026-11-06)

| Pack | Where (owner's Mac) | Contents | Licence |
|---|---|---|---|
| **Isometric Dungeon** 2.3, Kenney | `~/Downloads/kenney_isometricDungeon/` | 72 pieces x 4 facings (N / E / S / W) in `Isometric/` and `Angle/`, a `Characters/Male` set, Tiled / Unity samples | **CC0** |
| **Isometric Library**, Kenney | `~/Downloads/kenney_isometricLibrary/` | 36 pieces x 4 facings, same layout | **CC0** |

- **CC0**: no credit required, may modify and redistribute. We still credit "Kenney (kenney.nl)" on the Credits screen
  and in THIRD_PARTY_NOTICES.md as a courtesy. Raw files go into `art/vendor/kenney-dungeon/` and
  `art/vendor/kenney-library/` like every pack. The licence would allow committing them, but they stay gitignored for
  consistency.
- **`Isometric/`** is the one we use. Every cell is 256 x 512, with the tile's diamond (256 x 128) at the bottom. It is
  rendered at **pitch 30 deg, yaw 45 deg** (Information.png). **`Angle/`** is a yaw-0 front view. It cannot sit on a
  yaw-45 grid, so it is unused. So is `Characters/`.
- **Facings**: on wall pieces, **E** has its front on the screen-down-right face and **S** on the down-left face (checked
  on `bookcaseBooks`). These are the two fronts the camera sees on far walls (+X / +Z facings). N and W show backs.
- **Kenney's tile**: 181 px per tile side (256 / sqrt 2). Measured body boxes in Kenney tiles (w x d x h):
  `stoneWall` 1.0 x 0.24 x 0.99, `barrel` 0.23 x 0.23 x 0.32, `bookcaseBooks` 0.55 x 0.31 x 0.86,
  `bookcaseWideBooks` 0.99 x 0.31 x 0.86, `displayCase` 0.79 x 0.31 x 0.46, `candleStand` 0.56 tall, `barrelsStacked`
  0.84 x 0.44 x 0.37, `woodenSupportsBlock` 1.0 x 1.0 x 0.97.

## The key problem: the camera angle

The game camera is at **pitch 55, yaw 45** (`CAMERA_PITCH_DEG`). Kenney renders at **30**. DECOR.md already
records the lesson: "2D isometric packs drawn from another angle never quite do". Lords of Pain got away with it
because it is at about 49 deg. A 25 deg gap shows. On screen, the grid's axes run at 26.6 deg in Kenney and 39.3 deg in
the game. Kenney's tops are half as deep and its fronts 1.5x as tall as this camera would draw them.

The fix is exact for flat art and box-shaped art, because both are orthographic projections. Any plane's image under
one orthographic camera is an affine map of its image under the other. Per unit tile, screen vectors (x right, y up):

| | ground X | ground Z | up |
|---|---|---|---|
| Kenney (30 deg) | (0.707, 0.354) | (-0.707, 0.354) | (0, 0.866) |
| game (55 deg) | (0.707, 0.579) | (-0.707, 0.579) | (0, 0.574) |

- **`flat`** (carpets, planks, dirt, floor patches): scale y by **sin 55 / sin 30 = 1.638**. This is exact. The result
  is a 55 deg screen image, which is what `buildFloorArt` already expects for flats (it stretches depth by
  1 / sin(pitch) on a Top-face canvas).
- **`box`** (bookcases, display cases, crates, scaffolds, walls): the piece's body box (x0..x1, z0..z1, h), measured
  from the silhouette or set by hand. Each visible face (top, +X, +Z) is warped by its own affine, solved from three
  of its corners, and masked to its game polygon. The baked shadow goes through the ground map. This is exact for the
  faces; parts that stick out of the box (a ladder, the books) are approximate.
- **`uniform k`** (round or open shapes: barrels, candle stands, tables with chairs, chairs): one vertical scale.
  About 1.0-1.1 for compact pieces (a unit cube is 1.57 tall in Kenney and 1.73 in the game) and about 1.3 for low,
  wide tables. Tuned by eye in KN0.
- **Wall pieces** are pushed back so their back face lies on the cell's back edge (the `pivotAt` idea in render_kit).
  They also **drop the baked shadow**, which would otherwise fall over the wall top.

Prototype (this session, PIL + numpy, about 80 lines) with a mock of both sides at full Kenney resolution:
`Claude outputs/kenney-reprojection-mock.png`. On the right the carpet segments chain into one runner along the grid.
The bookcases' edges run along the walls and sit flush against them. The display case sits square on its cells. On
the left (raw) nothing lines up.

**Scale** (KND5, proposed): **match on the barrel**, the kits' rule. The game's barrel is 5/8 tile tall, Kenney's
0.32, so **one Kenney tile is about 1.95 game tiles**. Then `bookcaseBooks` is 1.07 x 0.6 x 1.68, close to the kit
bookcase (0.91 x 0.38 x 1.78), so it drops into the existing 1 x 1 cell. `bookcaseWideBooks`, `displayCase`,
`barrelsStacked` and `longTable` become 2 x 1 pieces. At 29.6 px per game tile that is a downscale of about 3 from
Kenney's 181 px (an integer `downscale` of 3 is within 2 %). The other scale, one Kenney tile per game tile (Kenney's
walls match the game's 1-tile walls), would make every prop half the size of today's kit props.

## What goes where

Not used: walls, doors, gates, windows, arches, stairs, bridges (KND3: walls stay Parts). Also not used, each for its
own reason: chests (`chestClosed` / `chestOpen` read as loot, docs/TREASURE.md), `planksHole` (reads as a pit),
`bookcaseWideBooksDesk` (its desk sticks out over walkable floor). **Kit vs Kenney** pieces are marked (KND2): Kenney
replaces kit art only where KN0 says it reads better.

### Library (theme `library`, existing)

| Piece | Kenney art | Footprint | Kind | Rule |
|---|---|---|---|---|
| shelf runs | `bookcaseBooks`, `-BooksLadder`, `-Glass`, `-HalfBooks`, `-Empty`, `-Destroyed`; `bookcaseWideBooks`, `-WideBooksLadder`, `-HalfWideBooks` | unchanged: 1 x 1 cells end to end (BOOKSHELVES.md) | `bookcase` (KND2), more variants | **Presentation only** (KND11): the decor plan draws two neighbouring cells of a run as one wide case by cell hash; at most one ladder per run; a half-height case at a run end 30 %; glass / empty / destroyed 1 in 8 each. No Forge change |
| study table | `longTableDecoratedChairsBooks`, `longTableChairs`, `longTableDecoratedChairs` | **2 x 2** (the table along X or Z, its chairs on both long sides) | new `studyTable` | **Replaces the reading area's line** (table 2 x 1 + a chair at each end, KND12): same 4 cells, same `readingArea` placement (maxDist 8, pillar clearing). Big libraries (320+ tiles) get a second one along the runner |
| carpet runner | `floorCarpet` + `floorCarpetEnd` (`flat`) | 1 wide, 2-tile segments, walkable | `carpet` variants 5-8 (`Dungeon.carpets`, width 1) | From the lectern (or the room's far wall) down the room's long axis, up to 12 tiles, never on a doorway's `doorTiles`, as the throne carpet |
| display case | `displayCase`, `-Books`, `-Open`, `-Sword` (sword 1 in 4) | 2 x 1, free-standing | new `display` | 1 in libraries of 200+ tiles, 2 in 320+; the 2-tile ring; along the runner when there is one |
| lectern | `bookStand` (open book; `bookStandEmpty` 1 in 4) | 1 x 1 | new `lectern` | At the runner's head, facing down it; replaces the library's statue roll (statues stay in halls) |
| toppled case | `bookcaseFallen` | 2 x 1, low | new `fallenShelf` | 40 % of libraries, one within 3 tiles of a run, free-standing |
| run ends | `candleStand`, `candleStandDouble` | 1 x 1 | `candelabrum` (KND2) | As today |

### Mess hall (new theme `mess`, combat / elite)

| Piece | Kenney art | Footprint | Kind | Rule |
|---|---|---|---|---|
| dining table | `tableRoundChairs`, `tableRoundItemsChairs`, `tableShortChairs`; `tableChairsBroken` 1 in 4 | 1 x 1 (chairs overhang about 0.1 tile; low) | new `diningTable` | 3-6 a room (big rooms up to 8), free-standing in a loose grid: Chebyshev >= `tableSpacing` (4) apart, the 2-tile ring, `doorTiles` from doorways. They are cover, like pillars |
| barrel stack | `barrelsStacked` | 2 x 1, flush against any wall | new `barrelStack` | 1-2 a room |
| breakables | (unchanged art) | | | x1.5 in mess rooms (the store's x2 + 3 stays) |

Weights (proposed; BK8-style tuning after the census):

| | crypt | hall | store | plain | library | mess |
|---|---|---|---|---|---|---|
| grim | 0.37 | 0.18 | 0.14 | 0.11 | 0.12 | **0.08** |
| other | 0.17 | 0.17 | 0.17 | 0.17 | 0.20 | **0.12** |

### Storerooms (theme `store`, existing: richer)

Today a storeroom places nothing solid; only its breakables cluster in its corners. It gains **1-3 solid stock pieces
flush in corners first, then along walls**, before the breakables are seeded:

| Piece | Kenney art | Footprint | Kind |
|---|---|---|---|
| barrel stack | `barrelsStacked` | 2 x 1 | `barrelStack` (shared with mess) |
| crate stack | `woodenCrates` | 1 x 1 | new `crateStack` (never breaks: it is not a breakable) |
| lumber | `woodenPile` | 1 x 1, low | new `lumber` |
| barrels | `barrels` (lying) | 1 x 1, low | new `barrelHeap` |
| stockpile | `woodenSupportsBlock` with `barrelsStacked` composed inside it by the prep script | 2 x 2, tall | new `stockpile`: big storerooms (320+) only, 50 %, in a corner |

**No canopy over walkable floor** (KND9). In the screenshot a roof stands over open floor, and in this game a bullet
under that roof would be hidden. The scaffold appears only as `stockpile`, where every cell under it is solid.

### Every room (presentation only)

- **Floor patches** (`flat`; as built: `dirt`, `planks`, `planksBroken` only, baked per biome, see KN4 below): `dirt`,
  `dirtTiles`, `planks`, `planksBroken`, `stoneUneven`, `stoneMissingTiles`, top faces only, 2 x 2 tiles each. They are a new decor kind `patch` (appended last to DECOR_KINDS), laid by planDecor's
  dressing step on 2 x 2 blocks of plain floor with no Forge flat: about 2 a room, 0-1 in the boss arena's middle,
  never on a carpet. Kenney's sandstone is much warmer and brighter than the biome floors, so each patch is graded
  toward its biome floor's mean colour (`art:build` already measures it) with a feathered edge. KN0 decides how far,
  or drops the stone patches and keeps only planks and dirt.

## As built (2026-11-06)

Owner (2026-11-06): "Proceed with redrawing all of them. Bookcases as alternative art to the existing bookcases."

- **Packs**: `Isometric/` and `License.txt` of both packs copied to `art/vendor/kenney-library/` and
  `art/vendor/kenney-dungeon/` (gitignored).
- **`scripts/art/kenney/reproject.py` + `kenney.json`** (Pillow + numpy; `python3 scripts/art/kenney/reproject.py
  [--only a,b] [--contact art/build/contact/kenney.png]`, about 12 s for everything). Modes `flat` / `box` / `uniform`
  as above, plus `wall` (the back on the cell's back edge, pivot half a game tile in front of it), `boxFrom` (variants
  share one box so they line up), `box` (a hand box), `topOnly` (a floor tile's top face), `pivot: "bbox"` (carpets),
  `layers` (more sources over the first, each in its own mode, same pivot: the stockpile's barrels uniform under the
  scaffold as a box), a per-piece `scale` and `grade`. Baked shadows are dropped (black at partial alpha); the reduce's
  fringe under alpha 16 is cut and each PNG trimmed with a 2 px margin; `<png>.pivot.json` as render_kit.py writes.
  Measured anchors: a standing piece's cell centre on the ground is (128, 448) in Kenney's cell (the candle stand,
  column and wall corner agree), a floor tile's top centre (128, 428).
- **87 PNGs** in `art/vendor/kenney/<piece>/`: 14 narrow bookcases (books, ladder, glass, empty, empty + ladder,
  destroyed, half, half empty) and 12 wide (books, ladder, empty, empty + ladder, half, half empty), each +X / +Z;
  3 study tables, 4 display cases, 2 lecterns (4 facings each), the fallen shelf, 2 candle stands, the carpet segment
  and end, 4 dining tables, the barrel stack, crate stack, lumber, barrel heap, stockpile, 8 floor patches. Contact
  sheet `art/build/contact/kenney.png`; a test room at game scale with the kit cases beside them
  `art/build/contact/kenney-scene.png`.
- **Bookcase scale 1.6** (not KND5's 2): the case is then 0.89 x 0.5 x 1.41 tiles, the kit case's width (0.91; 1.78
  tall), and its art (34 x 52 px) sits in `DECOR_BOX.bookcase` within a pixel (the front corner is ~1 px under the
  box's `below`, so fitArtLayout shrinks it ~3 %). Grade brightness 0.72: mean luminance 59-65 against the kit case's
  60. The wide cases at 1.6 are 1.6 tiles long, short of a 2-cell pair: KN3 stretches them along the wall or renders
  them at 1.8 before wiring.
- **Wired: the bookcase's alternative set.** `art/atlases.json` gains 14 own PNGs `kenney-bookcase-<look>-x / -z`
  (books, ladder, glass, half, destroyed, empty, halfempty; the empty + ladder case left out to fit the variant cap),
  locked in `art/vendor.lock.json`; `layout.ts` regenerated (additions only). Vale manifest: bookcase variants 3-16 after
  the kit pair, in facing pairs. `DECOR_MAX_VARIANTS` 4 -> 16 (the decor ID grammar's `.<1..16>`; decor.spec / void.spec
  follow). The decor plan's `solid` step picks a bookcase's variant with **`bookcaseVariant`**: one art set per room
  (`DECOR_BOOKCASES.altRoomShare` 0.5 of rooms by room hash, salt `bookcaseSet`), in it the full case at
  `altCommonShare` 0.45, else one of the six others evenly by cell hash (salt `bookcaseCell`); the facing is the
  variant's parity. With only the kit pair (before the upload) the plan is byte-identical to before. Credits: "Isometric
  Library", Kenney (kenney.nl), CC0; THIRD_PARTY_NOTICES.md.
- **Checked** (the Mac's aarch64 VM): typecheck, lint (all of src), check:assets, test:art (165 / 165), rbxtsc build (in
  a copy under /tmp: this VM may not delete, and rbxtsc replaces out/ files by unlinking them). The Lune specs ran in
  the next session (`worktrees/.kvtools/lune`): decorPlan, decor, void, valeWorld, valeArt pass.
- **The bullets lock mismatch (fixed 2026-11-06).** The ten `player-bullets/*.png` on disk carried a 5758-byte `caBX`
  chunk (C2PA content credentials, added by a re-download) that the locked files lack; with the chunk stripped every
  one is byte-identical to its lock entry (sha256), so the gitignored copies were replaced by the stripped ones. A full
  `art:build` and `art:lock` work again (all 2120 sources match; the full build changed no tracked file).
- **Uploaded** (2026-11-06 11:46 AM, k9kbdev): the 14 `kenney-bookcase-*.png`, IDs in `packs/vale/assetIds.ts`. Open:
  a Studio look at a library of each set (the per-room split, the X / Z lighting, the ~3 % box shrink).

### Wide cases (KN3, 2026-11-06)

Presentation only (no Forge, dungeon, sim, hash, replay or fixture change): the Forge's bookcases stay 1 x 1 cells.

- **Art.** reproject.py gained `stretch` (box mode, wall pieces): the game box drawn that much longer along its wall,
  about the pivot. The six wide looks (`bookcaseWide`, `-WideLadder`, `-WideEmpty`, `-HalfWide`, `-HalfWideEmpty`,
  `-WideEmptyLadder`) render at the narrow cases' scale 1.6 (1.61 tiles long) with `stretch` 1.18: 1.9 tiles, the outer
  span of two narrow cases in neighbouring cells (1 + 0.91), same height (1.41; half 0.8), so a run of narrow and wide
  cases reads as one shelf line (mock `Claude outputs/kenney-wide-bookcases-mock.png`). 12 own PNGs
  `kenney-bookcase-<look>-x / -z` (looks `wide`, `wideladder`, `wideempty`, `halfwide`, `halfwideempty`,
  `wideemptyladder`), pivot the pair's centre on the floor, half a tile in front of the wall.
- **Theme.** A new decor kind `bookcaseWide` (low), appended last to `DECOR_KINDS` (no new Luau top-level local); vale
  variants 1-12 in facing pairs (odd +X, even +Z), 1 / 2 the full case, then the ladder, empty, half, half empty and
  empty-with-ladder cases.
- **Plan.** `bookcasePairs` (decorPlan.ts): only with two `bookcaseWide` variants or more AND an alternative bookcase set,
  and only in rooms that draw the alternative set (the kit case has no wide art). A run is a room's bookcases with one
  facing, consecutive along their wall (so never across a corner, a gap or two rooms); it is walked from its low end and
  a case with a neighbour after it pairs with it when its cell hash (salt `bookcaseWide`) falls under
  `DECOR_BOOKCASES.wideShare` 0.5, then the walk skips the neighbour. The pair's lower piece index plans ONE entry over
  both cells (`cells` 2, `runX` / `runZ` along the wall, anchor the pair's centre); its look is `wideBookcaseVariant`
  (the full case at `altCommonShare` 0.45, else one of the five others evenly; salt `bookcaseWideLook`).
  `DECOR_BOX.bookcaseWide` 13 / 21 / 3 at both pair ends, hulled (the smallest box holding all twelve outlines whole is
  11 / 19 / 2). Without the wide ids (today) nothing pairs and the plan is byte-identical to before.
- **Not done**: the plan's "at most one ladder per run" and "a half-height case at a run end" rules (looks are picked
  per case or pair by hash, as for the narrow set).
- **Checked**: typecheck, lint, check:assets, test:art (165 / 165), build; Lune: decorPlan.spec's new case "draws two
  cells of a run as one wide case only in a room of the alternative set" (every Forge case drawn exactly once, pairs
  within one run, facing parity, never without wide art or an alternative set), valeArt.spec (now also: wide and narrow
  cases are planned on its six real floors and drawn whole inside their boxes), valeWorld, decor, void, decorFx,
  requested-ids and the rest of view/decor and theme/packs/vale (19 files, 0 failures).
- **Uploaded** (2026-11-06 1:19 PM, k9kbdev): the 12 `kenney-bookcase-<wide look>-x / -z.png`, IDs in
  `packs/vale/assetIds.ts`, so libraries of the alternative set now draw wide pairs. Open: a Studio look.

### Floor patches (KN4, 2026-11-06)

Owner (2026-11-06): **planks and dirt only, baked for each biome.** Presentation only (no Forge, dungeon, sim, hash,
replay or fixture change; walkable, flat).

- **Why.** Mock `Claude outputs/kenney-floor-patches-mock.png`: raw, the patches are far brighter than every biome floor
  and would compete with bullets; graded toward the floor they read as worn floor. The stone patches and `dirtTiles`
  carry raised blocks (and `stoneMissingTiles` a hole) that read as obstacles on walkable floor, so they are dropped.
- **Art.** reproject.py's patch piece keeps five looks (dirt, planks two turns, broken planks two turns) and writes each
  once per biome (`biomes` + `biomeGrade`, `biome_grade`): the reduced image's mean colour moved 35 % of the way from the
  biome floor colour, its detail (offset from the mean) x0.55, its edge feathered (alpha eroded 1 px, blurred 1.2 px).
  Floor colours: biome.1 the stone texture's mean `VALE_FLOOR_HEX` #1a1619, the others the placeholder pack's floor hex
  (#2a1a16, #1e2a33, #1c1a20, #1d2a1d; kenney.json). 25 own PNGs `kenney-patch-<look>-b<n>` (looks `dirt`, `planks-a`,
  `planks-b`, `planksbroken-a`, `planksbroken-b`), 2 x 2 tiles at 29.6 px a tile, pivot the block's centre. The baked
  set on its floors: `Claude outputs/kenney-floor-patches-biomes.png`.
- **Theme.** Decor kind `patch` (flat), appended last to `DECOR_KINDS` (after `bookcaseWide`). Vale: `ValeDecorPiece`
  gained an optional `biome` (mapped in that biome only); `VALE_PATCH_LOOKS` give `decor.delve.b<n>.patch.1..5`, each
  biome its own bake.
- **Plan.** A new last step in planDecor (after the scattered pieces, so no earlier entry or fade box moves; only when
  the pack has `patch` art, so the plan is byte-identical without it). Per room in index order: `DECOR_PATCHES` gives
  one patch per 100 floor tiles, at least 1 and at most 3 (rooms of 24+ tiles), the boss arena at most 1 in half the
  boss rooms (by room hash; the plan's "in the arena's middle" is not kept: the boss centre is kept out anyway). A patch
  is a 2 x 2 block whose cells and a 1-tile ring are FLOOR of the room with no other flat piece and no carpet (whether
  drawn or not), the block not kept out (doorways, interactables, breakables); lowest block hash (salt `patchBlock`)
  first, 4 tiles (Chebyshev) between patches; its four cells join the plan's taken flat cells. Entry: source
  `"scatter"`, layer flat, anchor the block's centre, `cellX` / `cellY` its first cell, variant by cell hash.
- **Checked**: typecheck, lint, check:assets, test:art 165 / 165, build; Lune: decorPlan.spec's new case "lays floor
  patches on 2 x 2 blocks of open floor, after every other entry, only with patch art" (every earlier entry unchanged,
  block and ring FLOOR of the room, no other flat or carpet under them, spacing, caps, some in boss rooms), valeWorld
  (five looks per biome, each its own bake), and all of view/decor, shared/theme (50 files), fxCues, run/tutorial:
  0 failures.
- **Uploaded** (2026-11-06 1:19 PM, k9kbdev): the 25 `kenney-patch-<look>-b<n>.png`, IDs in `packs/vale/assetIds.ts`,
  so every room now lays its patches.
- Open (Studio): whether 35 % / x0.55 reads as worn floor under the game's lighting and the depth-band dimming; tune
  `biomeGrade` in kenney.json and rerun `reproject.py --only patch`, `art:lock`, `art:build`.

### Decor plan and theme for the Forge pieces (KN9, 2026-11-08)

Presentation only (the Forge half, KN5-KN8, places the pieces; this draws them). No dungeon, sim, hash or replay change.

- **Art: one sheet** (KND8 kept). The decor world-art path already draws images cut from a shared atlas (`rect`, as
  the Lords of Pain decor atlas), so a new atlas group `kenney` (build-atlases.js "Kenney decor sheet"; `--only
  kenney` / `--lock --only kenney`, needs only `art/vendor/kenney/`) packs the 51 new PNGs into ONE `kenney-decor.png`
  (512 x 512, MaxRects) with a generated `packs/vale/kenneyLayout.ts` (`VALE_KENNEY_LAYOUTS`, world image layouts,
  outlines for the standing pieces), and the manifest's world-art lookup reads it after `layout.ts`. No renderer change,
  one upload, the decor atlas never repacks. Pivots are reproject.py's `.pivot.json`, except the barrel stack's (below).
- **Orientation** (checked on the PNGs against the game camera, `+X` screen-down-right, `+Z` down-left): display case
  and study table: Kenney N (`_a`) runs along X, E (`_b`) along Z; the toppled case the other way round (E along X,
  N along Z: N reads as a box seen end-on, the least certain pick, check in Studio); lectern: the open book faces
  +X / +Z / -X / -Z on Kenney E / S / W / N (the bookcases' convention); runner segment: N along X, E along Z; runner
  end: the open (unbordered) side measured on the pixels, N open to +X, E to +Z, S to -X, W to -Z; barrel stack:
  `stack_x` runs along X. **Fix:** kenney.json gives the barrel stack's `wall` normal on the wrong axis (N runs along X,
  so its back is its -Z edge, not -X), which put its pivot 0.34 tile off along the stack; the atlas entry moves the
  pivot to the stack's box centre (0.88 deep in a 1-deep cell: within 0.06 tile of flush against either wall, and the
  Forge stands it against any of the four). 1 x 1 stock (crates, lumber, lying barrels) and the stockpile: Kenney N /
  E drawn facing +-X / +-Z.
- **Kinds** appended after `patch` (no Luau top-level local): `studyTable`, `display`, `lectern`, `fallenShelf`,
  `diningTable`, `barrelStack`, `crateStack`, `lumber`, `barrelHeap` (low), `stockpile` (tall), and `libraryCandle`
  (low, presentation only: a library room's `candelabrum` draws as it when the pack has it, `DECOR_LIBRARY_THEME`;
  every other candle stand and its fade box are unchanged). Vale variants (`VALE_KENNEY_PIECES`): study table axis
  pairs books / plain / cloth; display case axis pairs case / books / open / sword; lectern open +X / +Z / -X / -Z then
  empty; toppled case, barrel stack, stock and stockpile one per axis; dining table round / items / short (a, b) then
  broken (a, b); library candle single / double a / double b.
- **Plan** (the `solid` step, the bridge gone): every Forge piece one entry over its cells, anchored at the
  footprint's centre (2 x 1 boxes at both run ends, 2 x 2 at the four corners, hulled). Variant: the axis (`w > 1`) or
  the facing axis (a study table's fx / fz is its long axis), a lectern its facing (as the chair), then a look by cell
  hash (`kenneyVariant`, `DECOR_KENNEY`, salt `kenneyLook`): display sword 1 in 4, lectern empty 1 in 4, dining
  broken 1 in 4, the rest evenly. `DECOR_BOX` per kind: the smallest box (w x (h + below)) holding every look's
  outline whole in every facing at full size around those anchors, + 2 / 1 / 1 px (studyTable 4/5/1, display 5/17/7,
  lectern 11/15/4, fallenShelf 10/23/14, diningTable 24/21/9, barrelStack 9/23/6, crateStack 21/17/6, lumber 27/18/9,
  barrelHeap 26/18/8, stockpile 4/20/2, libraryCandle 10/18/3). A stockpile's -X / -Z non-floor neighbours (and the
  corner between) join the `behindShelf` cells: nothing stands or hangs there (its scaffold rises over those walls).
- **Runner** (`DECOR_RUNNER`): a carpet with min(w, h) = 1 draws `carpet` variants 5-10 (5 / 6 a 2 x 1 segment along
  X / Z, 7-10 the end of a runner running toward +X / +Z / -X / -Z): an end piece on each end cell (open toward the
  runner), segments over the cells between (the Forge lays an even length, so they pair up). Deviation: the plan said
  "segments every 2 tiles + the end piece"; with a 1-cell end art that leaves one odd cell, so both ends take an end
  piece (the head's border faces the lectern). Only with all six runner variants; else the runner draws nothing and its
  cells keep the Forge's flat pieces. The throne carpet is unchanged.
- **Unchanged without the art**: every new branch reads the pack's variant counts (no ID: count 0, the piece blocks and
  draws nothing; a runner with the kit carpet's four variants only draws nothing), and floors without the new kinds or
  runners plan exactly as before.
- **Credits**: "Isometric Library, Isometric Dungeon" (Kenney, CC0) in `CREDITS` and THIRD_PARTY_NOTICES.md (data, no
  new string).
- **Checked** (cloud container, 2 cores): typecheck, lint, check:assets, test:art, rbxtsc build; Lune: decorPlan.spec
  (Kenney pieces once each with their variants and boxes, the runner vs the throne carpet, the library candles, the
  stockpile drop, the study table replacing the reading line), valeArt.spec, valeWorld.spec, void.spec and every spec
  under shared/view and shared/theme.
- **Upload (KN12)**: `art/upload/kenney-decor.png` -> its ID under the key `"kenney-decor.png"` in
  `packs/vale/assetIds.ts`. Until then the pieces block and draw nothing. Open: the Studio look (KN13), the toppled
  case's Z art, the 1 x 1 stock's facings (Kenney N / E picked per axis by eye, not measured).

## Pipeline

1. **`scripts/art/kenney/reproject.py`** (PIL + numpy; like render_kit.py, not part of `npm run`) reads
   **`scripts/art/kenney/kenney.json`**. Each piece lists its source (pack, name, facing), mode (`flat` / `box` with an
   optional hand box / `uniform` with k), `wall` (push back, drop the shadow), `compose` (pieces drawn into one, for
   `stockpile`), `grade` (brightness / saturation / contrast toward the kits' warm grade) and `scale` (KND5). It writes
   reprojected PNGs at 29.6 px per tile with their pivots into `art/vendor/kenney/`. It runs on the Mac, where PIL is
   installed.
2. **`art/atlases.json`**: a new **atlas group** `kenney` (as `goo.png` / `bullets.png`: one sheet and a generated
   layout) instead of 40+ `own` PNGs, so there are 1-2 uploads and one preload entry, not 40 (KND8). The decor atlas
   never repacks.
3. **Vale `manifest.ts`**: kinds, variants and layers; `packs/vale/assetIds.ts` after the upload. Without ids the solid
   pieces block but draw nothing (as the throne did).

## Tasks

- [~] **KN0. Spike: the angle, the scale, kit vs Kenney (go / no-go, art only).** Renders done (all pieces, both
  facings; the bookcases at the kit's scale); the Studio look is open. Port the session prototype into
  `reproject.py` and render `bookcaseBooks` E / S, `bookcaseWideBooks`, `displayCaseSword`, `longTableDecoratedChairsBooks`,
  `tableRoundChairs`, `barrelsStacked`, `candleStandDouble`, `floorCarpet`, `planks` and `dirt` at both scales. Upload them
  by hand and stand them in one Studio room next to the kit bookcase, table, chairs, candle stand and carpet, on biomes
  1, 4 and 5. Record in this doc: which pieces read right at 55 deg (box / uniform k per piece), the scale (KND5), and
  **per piece, kit or Kenney** (KND2). Also whether the patches read as worn floor or as pasted squares, and whether
  the detail survives at about 1/3 size.
  **If box reprojection fails** for some piece, keep the kit art for it and use Kenney only where it works. The
  gameplay half (KN5-KN8) does not depend on the art.
- [x] **KN1. Reprojection tool** (2026-11-06; the self-check is not written yet). `reproject.py` + `kenney.json`, with a self-check: reprojecting a synthetic box's
  corners matches the game projection within 0.5 px, and a flat diamond becomes the 55 deg diamond.
- [x] **KN2. Art set** (2026-11-06: every piece rendered; 2026-11-08: the `kenney` atlas group, credits, valeWorld.spec, KN9). Render every piece in the tables above (both facings for wall and 2 x 1 pieces), the `kenney`
  atlas group, `art:build` / `art:lock`, valeWorld.spec's file list, THIRD_PARTY_NOTICES.md and `CREDITS`.
- [~] **KN3. Variants (presentation)** (2026-11-06: narrow bookcase variants wired as a per-room alternative set; wide
  pairs wired and uploaded; the run-end / ladder rules and other kit -> Kenney swaps open). Bookcase variants, wide-pair drawing (KND11) and any kit -> Kenney swaps from
  KN0 in the decor plan and vale manifest. Specs: a pair never spans two runs or a run's corner; variant picks are
  stable per cell.
- [x] **KN4. Floor patches (presentation)** (2026-11-06; uploaded; Studio look pending). Kind `patch`, the dressing
  rule, the biome grade, census in decorPlan.spec.
- [ ] **KN5. Forge pieces.** `SolidDecorKind` gains `studyTable`, `display`, `lectern`, `fallenShelf`, `diningTable`,
  `barrelStack`, `crateStack`, `lumber`, `barrelHeap` and `stockpile`, with footprints and flush or free-standing spots.
  solidDecor.spec: the floor stays one piece and **no new one-tile pinch**; the re-flood never fires.
- [ ] **KN6. Library v2.** The study table (in place of the reading line, KND12), the runner (`Dungeon.carpets`
  width 1), the display cases, the lectern (the statue roll removed) and the toppled case. Census `[library]`.
- [ ] **KN7. Mess hall.** `RoomTheme` gains `mess` and the weights above. Tables, barrel stacks, breakables x1.5.
  Census `[mess]`, including spawn tiles lost per room.
- [ ] **KN8. Storerooms.** Stock pieces before the breakables, `stockpile` in big rooms. Census `[store]`.
- [x] **KN9. Decor plan and theme for the new kinds** (2026-11-08, "Decor plan and theme for the Forge pieces" above;
  upload pending, KN12). Append them to DECOR_KINDS (no new Luau top-level local) and the
  layer table. `DECOR_BOX` per kind is measured on the built outlines, with fade boxes, facing variants, carpet
  variants 5-8 and a `behindShelf`-style drop for wall-top pieces behind a tall stock piece.
- [ ] **KN10. Re-pins and docs.** roomPool.lock roster digests, the stormcaller run, `DAILY.ruleset`, the CLAUDE.md
  table row and decision log, docs/DECOR.md and BOOKSHELVES.md pointers.
- [ ] **KN11. Verify** (the Mac's aarch64 VM). Typecheck, lint, check:assets, build, test:art, and every spec file.
- [ ] **KN12. [owner] Upload** the `kenney` sheet (`art/upload/kenney-decor.png`) and add its id to
  `packs/vale/assetIds.ts` under `"kenney-decor.png"`.
- [ ] **KN13. [owner] Studio check and playtest.** Libraries and mess halls read as rooms; bullets never hide behind
  tables or stock; walkers, bots and the charger (its wall stun now hits tables) get round the new pieces; the count
  of decor instances per floor on a phone (DecorController's report).

## Decisions

| | Decision | Why |
|---|---|---|
| KND1 | **Gameplay and art together** (owner, 2026-11-06) | The owner wants the rooms to play like the samples, not just look like them |
| KND2 | **Kit vs Kenney per piece after KN0** (owner) | The kit pieces are camera-correct; Kenney's are reprojected. Choose by eye in Studio |
| KND3 | **Props + floor patches; walls and biome floors unchanged** (owner) | Walls stay Parts (DECOR.md); a sandstone biome would risk bullet contrast |
| KND4 | **New `mess` theme and richer storerooms** (owner) | Screenshot 1 shows both a dining room and stores |
| KND5 | Scale **matched on the barrel**: about 1.95 game tiles per Kenney tile (proposed) | The kits' rule. Kenney's bookcase then matches the kit bookcase; the 1:1 scale halves every prop |
| KND6 | **Per-face reprojection** (`flat` / `box` / `uniform`) (proposed) | Exact for flats and boxes; raw 30 deg sprites do not sit on a 55 deg grid |
| KND7 | Wall pieces use **E / S** and **drop the baked shadow** (proposed) | The two fronts the camera sees; the shadow would fall over the wall top |
| KND8 | **One atlas group**, not `own` PNGs (proposed) | 40+ pieces; uploads and preload |
| KND9 | **No chests, holes or canopies over open floor** (proposed) | Chests read as loot, holes as pits; a roof hides bullets |
| KND10 | Mess and store pieces are **solid**, patches and runners **walk-through** (proposed) | As tombs and the throne carpet (DECOR.md) |
| KND11 | **Wide bookcases are presentation only** (proposed) | Pairs of 1 x 1 cells drawn as one case: variety with no Forge change |
| KND12 | The **study table replaces the reading line** (proposed) | Same 4 cells; Kenney's sets carry their chairs; it matches the sample |

## Risks

- **Residual angle error** on shapes that are not boxes (chair legs, a ladder, candle arms). `uniform k` is a
  compromise. KN0 keeps kit art wherever it reads better.
- **Detail at 1/3 size**: Kenney's book spines and table items are fine work. At 29.6 px per tile the study table may
  shrink to a brown smudge. KN0 checks it at real size.
- **Lighting**: Kenney's sun comes from the front-right. The kits light +X and +Z differently (`sunSide`). Mixed pieces
  in one room may disagree, which is another reason KND2 is decided per piece.
- **Palette**: Kenney's wood is warm and saturated, its stone beige. Grade toward the kits. Enemy bullets stay the
  danger pink (the validator's 40 Delta E applies to tint roles, not baked art, so check by eye).
- **Cover and difficulty**: mess halls add 3-8 cover pieces and storerooms 1-3. Spawn tiles lost and fight length go
  in the census. Tune `tableSpacing` and the counts if fights get easy.
- **Instances**: every piece is a billboard plus a fade box. Watch DecorController's report on a phone, and cap
  patches per floor if needed.
