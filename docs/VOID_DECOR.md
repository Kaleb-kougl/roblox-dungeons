# Void decoration: plan

How to dress the space around the dungeon: the voids between rooms and the band around the floor's outer edge. Today
every VOID cell shows one flat slab 2 tiles under the floor, in the `background` colour. This plan turns that slab
into a **rock shoulder that hugs every wall and corridor, breaks into ledges and drops into a dark, biome-tinted
abyss**, with set pieces framing rooms from behind their far walls. Work it task by task, like `docs/DECOR.md`; each
task ends with a **Verify**.

**Presentation only.** Nothing here changes `src/shared/sim/**`, `src/shared/dungeon/**`, collision, the minimap, a
replay, a hash or a fixture. VOID cells stay VOID in the grid; bullets and bodies treat them exactly as today.

## Status (2026-11-01)

Planned. Owner calls taken on 2026-11-01: VDD1-VDD3 (below). VD0's census is done (`scripts/lune/void-census.luau`,
numbers below); VD1 (theme contract), VD7 (void art slots), VD2 (the pure void planner,
`src/shared/view/voidDecor/`) and VD4's band knobs are built; VD3 (the geometry: `VoidController`, the abyss backdrop),
VD8 (abyss motes), VD9 (debug attributes) and VD5 / VD6 (the set pieces in the decor plan and on screen) are built
(headless only) and wait for their Studio checks.

## What the camera sees today (VD0 census)

`lune run scripts/lune/void-census.luau` after `npm run build`, over 200 endless floors (run seeds 1-20 x floors 1-6,
9, 10, 14, 15):

| Measure | Per floor |
|---|---|
| Grid | ~117 x 115 = 13,435 cells: **50.3 % void**, 41.4 % floor, 8.0 % wall, 0.3 % pool |
| Void by Chebyshev distance to the nearest wall / floor cell | d1 754, d2 632, d3 567, d4 502, d5 395, d6 360, d7 331, d8 305, d9+ 2,909 |
| Enclosed void pockets (not touching the grid's edge) | 6.6 pockets, 286 cells; only 0.7 of them have a cell 4+ tiles from any wall |
| **Share of the screen that is void** (camera on a floor cell, 30 x 16.9 tile view) | **21.3 %** |
| Where that on-screen void lies | d1 28 %, d2 19 %, d3 14 % (**61 % within 3 tiles**), d4-d5 16 %, d6-d8 10 %, d9+ 4 %, past the grid 10 % |
| Greedy rectangles (one Part each), flat | shoulder d1-d3: 162; mid band d4-d8: 80 |
| Shoulder cells (d1-d3) where the decor footprint rule passes at wall-top height | column (20 x 55 px): 1,104 of 1,953; stump (19 x 22 px): 1,629 |

What this says: the void players actually look at is a band a few tiles wide along walls and corridors. Detail goes
there. The far void is a small share of the screen and can stay cheap. The camera is a near-orthographic narrow-FOV
rig placed far away, so **Roblox Fog / Atmosphere cannot give depth** (every point is about the same distance from the
camera) and a lower plane has **no parallax**: depth has to come from cliff faces and a colour ramp.

## Design

### Layers, by distance from the dungeon

| Layer | Cells | What is drawn | Height |
|---|---|---|---|
| **Shoulder** | every void cell within `VOID.shoulderMinTiles` (1) of a wall, plus a jagged band out to 2-4 tiles (per-cell threshold from `decorHash`, smoothed) | solid rock at just under wall height, the biome's shoulder material; flat clutter on top; tall pieces on the far side (below) | top at `VOID.shoulderTopTiles` (0.85 x wall height) |
| **Ledge** | a 1-tile rim around the shoulder's outer edge, broken by hash (not every cell) | a lower step of the same rock, slightly darker | `VOID.ledgeTopTiles` (0.35) |
| **Outcrops** | sparse clusters in the mid band (d4-d8), `VOID.outcropRate` per 100 cells | rock stacks rising from the abyss, 1-4 cells each | shoulder or ledge height; taller only where the footprint rule passes |
| **Abyss** | everything else, and past the grid | the backdrop slab, deeper and biome-tinted | `VOID.abyssDepthTiles` (5) under the floor |

Every shoulder and ledge Part runs from its top **down to the abyss**, so where a shoulder's outer edge faces the
camera (+X / +Z sides) you see a cliff face dropping into the dark. A 5-tile drop draws about 2.9 tiles tall on screen
(cos 55°), enough to read as depth. On the far side the cliff faces turn away from the camera and the eye lands on the
abyss and the set pieces instead.

**Enclosed pockets** (void wholly surrounded by rooms and corridors) whose deepest cell is within
`VOID.pocketFillTiles` (4) of a wall fill solid with shoulder: the census says that is nearly all of them, so no tiny
pits appear between rooms.

### Readability rules (keep them)

0. **Why the geometry is safe.** The Forge walls every void cell next to a floor cell, so void is always at least one
   tile from walkable floor. A surface `h` tiles high hides ground only `h x cot 55°` (0.7 h) tiles behind it, which
   for `h` <= 1 never reaches past the wall cell in between.
1. **The void must never read as walkable.** The shoulder sits at wall height, so it reads as more wall. Its top
   colour must differ from the biome floor by at least `VOID_CONTRAST.shoulderVsFloor` (CIE76 4 as built, not the
   planned 20: see VD1) and sit nearer the wall's colour than the floor's; the validator checks it (VD1).
2. **Nothing hides gameplay.** A heightfield no higher than the wall top, standing outside a wall, cannot cover more
   floor than the wall already does, so the shoulder and ledge are safe by construction (a spec checks the claim with
   ray casts). Every **piece** in the void (anything that rises above the shoulder top, flat clutter included) passes
   `footprintClear(d, f, box, cam, top)` from `shared/view/decor` with `top` = the surface it stands on. In practice
   that keeps tall pieces to the screen-up side of rooms (VDD2), and it also rejects a tall piece behind one room that
   would cover another room further up the screen.
3. **Bullets stay visible.** An enemy bullet hugging a far wall is drawn over the wall top and the shoulder behind it,
   so enemy-bullet roles keep >= 3:1 against the shoulder and the ledge at every depth band's light, the same rule as
   walls. Any glow in the void (molten) stays >= 40 CIE76 from the enemy-bullet roles and `telegraph`, and never
   flickers.
4. **No motion in the void** except the abyss motes (VD8), which scale with `motionScale` and Reduced motion.

### Set pieces

All through the existing decor pipeline (`planDecor` -> `DecorController`), as a new `DecorSource` `"void"`, so pooling,
art fit, outlines and lights are reused.

| Piece (vale, Lords of Pain) | Where | Layer |
|---|---|---|
| `wall2` / `wall3` ruin runs, `column1` | far side, on the shoulder, along the room | tall |
| `column2` stumps | anywhere the footprint passes | low |
| `rocks`, `bricks` | shoulder tops, ledges | flat |
| `tiles` (flagstone patch: an old floor, now unused by decor) | shoulder tops near rooms | flat |
| `wall1` (low curb: unused by decor) | shoulder edges | low |
| `bones` (grim), `mushrooms` (verdant) | shoulder tops | flat |

All of these but `tiles` and `wall1` are already cut into `decor-atlas.png` (docs/DECOR.md R5, uploaded); those two
need its rebuild and re-upload (VD6's owner steps).
Caps (starting values, VD12 tunes): per room side at most `VOID_PIECES.tallPerRoom` (4), `tallMinSpacing` (3) apart,
never within 2 tiles of a decor tall piece or far-wall dressing on the wall below; flat pieces on at most
`flatShare` (25 %) of the shoulder. Target <= 80 tall / low and <= 200 flat pieces per floor.

**Biome art later (VDD3).** Biomes start from materials and tints only. The contract gains optional per-biome void
kinds, `decor.void.b<n>.<kind>[.<v>]` (frost: `spire`, `drift`; molten: `vent`, `crag`; grim: `grave`, `deadtree`;
verdant: `root`, `bush`; ancient: `statue`), drawn only when a pack fills them, under the same rules.

### Biomes (materials now)

| Biome | Shoulder | Ledge / cliff | Abyss tint |
|---|---|---|---|
| biome.1 ancient | Brick (as its walls), darker | Rock | cold blue-black |
| biome.2 molten | Basalt | Basalt | deep red-black, faint glow at the bottom (validated) |
| biome.3 frost | Glacier, snow on top | Ice | dark teal |
| biome.4 grim | Slate | Rock | green-black |
| biome.5 verdant | Ground | Mud | dark moss |

Materials come from the existing allow-list (`BIOME_MATERIALS`); colours from each biome's new `shoulder` / `abyss`
hex next to its `floor` / `wall` (VD1, as built), so a pack chooses them like the floor and wall colours today.

### Depth bands

The shoulder wears down with depth, using the existing `decorProfile` bands (kept / worn / ruined / abyss):

| Knob | kept | worn | ruined | abyss |
|---|---|---|---|---|
| shoulder width (tiles past the 1-tile minimum) | 2-3 | 2-3 | 1-3 | 1-2 |
| ledge breakup (share of rim cells kept) | 90 % | 75 % | 60 % | 40 % |
| outcrops per 100 mid-band cells | 1.0 | 1.2 | 1.5 | 2.0 |
| ruin runs whole vs broken (`wall2` / `wall3`) | as the decor profile's far-wall split | | | |

## Code layout

- **`src/shared/view/voidDecor/`** (pure, headless specs; not `void/`: `void` is a TypeScript keyword):
  `config.ts` (`VOID`, `VOID_PIECES`, `VOID_DEPTH`), `field.ts` (`voidField`: Chebyshev distance from non-void, enclosed
  pockets), `plan.ts` (`planVoid(input)`: per-cell layer and height, greedy rectangles per (layer, height) via
  `greedyRects`), `pieces.ts` (candidates handed to `planDecor` as source `"void"`), barrel `index.ts`. Every choice
  from `decorHash(floorSeed, cell, VOID.salt*)`: same Dungeon, same void, on every client and replay viewer.
- **`src/client/controllers/render/VoidController.ts`**: builds the Parts on `onFloorChanged`, Janitor, one deferred
  work item behind the stage cover (docs/STAGE_LOADER.md). `WorldController`'s backdrop moves to
  `VOID.abyssDepthTiles` and takes the abyss colour.
- **Theme**: `src/shared/theme/contract.ts` / `validate.ts` / packs; the void colour rules in `voidColors.ts` (VD1).

## Decisions

- **VDD1. Shoulder into abyss (owner, 2026-11-01).** A dressed rock band along walls and corridors, ledges, then a dark
  abyss; not solid bedrock everywhere, not an open pit.
- **VDD2. Tall pieces on the far side only (owner, 2026-11-01).** Enforced by the footprint rule, not by a side test,
  so a tall piece is legal exactly when it covers no walkable cell.
- **VDD3. Materials now, art slots later (owner, 2026-11-01).** Roblox materials and tints plus the stone pieces already
  owned; optional `decor.void.*` kinds for a future biome pack.
- **VDD4. Presentation only.** No sim, dungeon, lockstep, hash, replay, fixture, minimap or collision change. Never
  touches Forge params or the Forge rng.
- **VDD5. Every wall gets shoulder** (`shoulderMinTiles` 1): no wall stands straight over the abyss, so walls always
  read as solid mass. Recommended; confirm in Studio.
- **VDD6. Shoulder top below the wall top** (0.85): walls keep a crisp lip (the room's outline), and the two surfaces
  never z-fight. Recommended; confirm in Studio.
- **VDD7. Every Forge floor** (endless, daily, dev, the tutorial, M1); the greybox world gets none.
- **VDD8. No setting.** One budget, measured on the phone emulator. If phones fall short, add a Reduced tier on touch
  (no outcrops, no flat clutter) rather than a menu option. Open until VD12.
- **VDD9. No PROVENANCE row.** Port-only feature; nothing is ported from the web build.

## Tasks

- [x] **VD0. Census.** `scripts/lune/void-census.luau` (numbers above).
  -> Verify: runs after `npm run build`. Still to do: a baseline screenshot per biome in Studio.

- [x] **VD1. Theme contract.** Required placeholders `tile.biome.<n>.shoulder` and `tile.biome.<n>.abyss` (colour role,
  material) in every pack; `BIOME_MATERIAL_SURFACES` gains `shoulder` and `cliff`; the placeholder pack derives its
  values from the wall colour (shoulder: wall darkened; abyss: `background`). Validator `voidReport`: shoulder vs floor
  (readability rule 1), enemy-bullet roles >= 3:1 on shoulder and ledge at every band's light, abyss darker than the
  ledge, any void glow >= 40 CIE76 from the danger roles. `contract.luau` / `validate.luau` sit near Luau's 200
  top-level locals: add inside existing tables or functions and check it compiles under Lune.
  -> Verify: validator specs; the placeholder and vale packs validate clean at every band.
  **As built (2026-11-01).** Simpler than placeholders: every `BiomeDef` gains two required hex colours next to
  `floor` / `wall`, `shoulder` and `abyss` (the backdrop), carried to `ThemeCore.biome` / `ThemePack.biome` (`shoulder`,
  `abyss`, `ledge` hex; `shoulderColor` / `abyssColor` / `ledgeColor` Color3; magenta for an unknown biome or a malformed
  colour). The ledge is derived, `voidLedgeColor(shoulder, abyss)`: the shoulder mixed `VOID_COLORS.ledgeMix` (0.35)
  toward the abyss with `mixRgb`, so view and validator agree. `BIOME_MATERIAL_SURFACES` gained `shoulder` and `cliff`
  (ledges and outcrops), default SmoothPlastic; vale per the biome table above (Brick / Rock, Basalt / Basalt, Glacier /
  Ice, Slate / Rock, Ground / Mud). Placeholder: shoulder = the wall darkened in linear light (ancient x0.95, molten
  x0.75, frost x0.9, grim x0.8, verdant x0.9), abyss near `background` tinted per biome (`#0c1018` cold blue-black,
  `#170a09` deep red-black, `#081517` dark teal, `#0b130e` green-black, `#11150a` dark moss); vale inherits them.
  Validator `voidReport(manifest, light = 1)` / `voidColorProblems` (in `voidColors.ts`, one import into validate.ts),
  per biome, paths `biomes.<id>.shoulder` / `.abyss`: (a) CIE76(shoulder, floor) >= `VOID_CONTRAST.shoulderVsFloor`
  = **4** and CIE76(shoulder, wall) < CIE76(shoulder, floor). 4, not the planned 20: the placeholder's walls sit only
  4.5 (ancient) to 13.4 (molten) from their floors, so a shoulder on the wall's side can only be about that far from the
  floor without turning lighter than the wall top (losing VDD6's lip) or off-hue; height, cliffs, the "nearer the wall"
  clause and materials carry the rest. Placeholder lows: 4.1 (ancient), vale 4.3. (b) Luminance abyss <= ledge <=
  shoulder. (c) `enemyBullet` (the wall rule's role, `contrastReport`) >= 3:1 on shoulder and ledge at `light`, the
  surface dimmed by `dimHex` (moved from shared/view/decor into shared/theme `color.ts`, re-exported there);
  validateManifest checks full light, `profile.spec.ts` every band (darkest included) for every bundled pack. Lows 3.89:1
  shoulder (frost), 4.55:1 ledge. (d) Abyss >= 40 CIE76 from `enemyBullet` and `telegraph` (lows 92.7). The abyss rule
  leaves out `enemyBulletOutline`: it is a near-black rim (#1a0610) only seen around a bright core, and every dark abyss
  sits within ~10 of it. No void glow exists yet (VD8 adds its check). Specs `void.spec.ts` (both packs pass, each rule
  fails alone on a crafted manifest, runtime lookups). Luau top-level locals counted on out/: `contract.luau` 183 -> 185,
  `validate.luau` 199 -> 196 (the boost ID list inlined, decor layers read from `parseDecorId`'s new `layers` field
  instead of importing DECOR_KIND_LAYERS), `voidColors.luau` 22.

- [x] **VD2. Void planner.** `voidField`, `planVoid`, `VOID` / `VOID_DEPTH` config.
  -> Verify: specs: deterministic; non-void cells untouched; every wall-adjacent void cell is shoulder; pocket fill;
  ledge only on the shoulder rim; a ray-cast spec (like decorPlan's) finds no walkable cell hidden by shoulder, ledge or
  outcrop over the census seeds; Part budget (<= 500 rectangles per floor) over the census seeds.
  As built (`src/shared/view/voidDecor/`: `config.ts`, `field.ts`, `plan.ts`, exported from `shared/view`):
  `voidField(d)` (Chebyshev distance by a two-pass chamfer transform, enclosed 4-connected pockets with their deepest
  cell), `planVoid(input)` -> per-cell `layer` (`VoidLayer` NONE / SHOULDER / LEDGE / OUTCROP / ABYSS) and `top`, `rects`
  (greedy, merged per (layer, top), every raised cell in exactly one), `stats`; `voidInputOfLayout`, `voidBandOf`,
  `planVoidCached` (memo of the last Dungeon object + floor seed + band). Shoulder = dist <= 1 + the band's extra width,
  the extra read from value noise on a lattice `VOID.shoulderNoiseTiles` (8) apart (neighbouring widths differ by <= 1),
  then a cleanup (no detached shoulder cell, no 1-cell hole); pockets with deepest cell <= 4 fill solid. Deviations from
  the sketch, both to hold the budget and the cost: the ledge breaks per `VOID.ledgeChunkTiles` (3) square chunk, not per
  cell; outcrop seeds fall at hashed gaps along the scan (one `decorHash` per seed, mean gap = 100 / rate eligible cells),
  not one roll per cell (`decorHash` costs ~5 us under Lune). Specs `voidDecor/field.spec.ts` (3) and `plan.spec.ts`
  (20): determinism and the cache, every layer rule, exact rect coverage, the band knobs, and an independent ray march
  (exact grid traversal from 25 points x 5 bullet-disc rim points per walkable cell toward the camera) that finds 0
  hidden points over 40 floors and does find them when the void is raised to 3 x the wall height. Census (runs 1-10 x
  floors 1, 3, 5, 7, 10, 12, 15, 18 = 80 floors), per floor: shoulder 2,052 cells, ledge 323, outcrops 14.3 (35 cells);
  **rects 290 on average, max 464** (kept 242 / worn 270 / ruined 334 / abyss 314); a wider ad hoc run (runs 1-30 x 15
  floors up to 25, 450 floors) peaked at 470. `planVoid` ~16 ms per floor under Lune on the loaded 2-core box (the same
  run timed `planDecor` at 13 ms; the field is ~5 ms of it); expect a fraction of that on a client.

- [x] **VD3. Geometry.** `VoidController`, the deeper biome-tinted backdrop, cliff faces, materials and tints per biome,
  stage-cover deferral.
  -> Verify: `npm run verify`; in Studio every biome: shoulders meet walls with no gaps or z-fighting, cliffs read on
  the near side, part count and build time written down (PC and phone emulator).
  **As built (2026-11-01).** `src/client/controllers/render/VoidController.ts` (thin) over the pure
  `src/shared/view/voidDecor/parts.ts` and `viewConfig.ts` (`VOID_VIEW`). On run start, every floor change and a change
  of `KV_DecorBand` / `KV_VoidOff` / `KV_VoidDebug`: `voidRunInput(dungeon, layout, depth, KV_DecorBand)` (an endless
  floor: `voidInputOfLayout(ctx.endlessFloor(ctx.floor).layout, state.endless.depth)`; else the bare dungeon; the forced
  band parsed like DecorController's) -> `planVoidCached`, so **the VoidController and the DecorController read one
  cached plan** as long as the DecorController (VD5) plans its void from the same input (or a `profile` of the same
  band: same Dungeon object, floor seed and band hit the cache; `parts.spec.ts` checks it). Skipped when the Dungeon,
  floor seed, band and both attributes are unchanged (a restart on the same seed). One `renderPart` per rect in Workspace
  `KV_Void` (anchored, CanCollide / CanQuery / CanTouch false, CastShadow like the walls, `VOID_VIEW.castShadow`):
  `voidColumnOf(rect)` = the rect's cells (cell (gx, gy) centred on world (gx, gy), WorldController's studs mapping)
  from its `top` down to the abyss plane plus `VOID_VIEW.columnSinkTiles` (half the 0.25-tile backdrop slab), so cliff
  faces meet the abyss with no seam and no bottom pokes out under the slab. Look (`voidLayerStyle`): shoulder
  `shoulderColor` + `materials.shoulder`, ledge and outcrop `ledgeColor` + `materials.cliff` (SmoothPlastic default).
  Biome matched like WorldController (`themeKey` -> `BIOMES.forgeTheme`); an unmatched theme gets no void (logged;
  none exists: every Forge theme has a biome). The greybox gets none (VDD7); like the world, the void stays when the
  run is left. Built inside the `onRunStarted` / `onFloorChanged` listeners, which StageController already runs one
  frame late under the cover (docs/STAGE_LOADER.md), like the world and decor builds; no per-frame work. Output
  `[Void] built P parts (floor F, band, biome.N: shoulder S / ledge L / outcrop O), plan X ms, T ms`.
  **Backdrop = abyss**: WorldController puts the backdrop's top face `VOID.abyssDepthTiles` (5) under the floor
  (`GAME_WORLD.backdropDepthTiles` removed: one source of truth; nothing else read it) in the matched biome's
  `abyssColor`; greybox / unmatched keep `background`. `backdropMarginTiles` 24 still covers the view (half depth
  ~10.3 tiles on the floor plane + ~3.5 tiles of shift for a plane 5 tiles down). The world still sits 64 studs up, so
  the backdrop (top at 44 studs) still hides a stray character on a template Baseplate. Specs `voidDecor/parts.spec.ts`
  (12): plan input = decor input (bands, forced band, the shared cache), column geometry (edges, top, bottom inside the
  slab, every rect of 9 floors under the wall top), no wall / floor cell on the grid's border over 20 floors (so no
  wall ever stands over the abyss at the grid edge), layer styles and debug tints.
  - [ ] Studio check: every biome (`KV_DecorBand` 0-3, N through floors 1-16): shoulders meet walls with no gaps or
    z-fighting, near-side cliffs read, material textures on the tall cliff Parts (Risks), the snow biome's shoulder not
    read as floor; part count and build time (the `[Void]` line) on PC and the phone emulator.

- [x] **VD4. Depth bands.** `VOID_DEPTH` knobs read through `decorProfile`; `KV_DecorBand` forces them too.
  -> Verify: specs per band; in Studio `N` through floors 1-16.
  As built: `VOID_DEPTH.bands` (one row per `DECOR_DEPTH` band, names checked by a spec): shoulder extra width 2-3 / 2-3
  / 1-3 / 1-2 tiles, ledge keep 0.9 / 0.75 / 0.6 / 0.4, outcrops 1.0 / 1.2 / 1.5 / 2.0 per 100 eligible cells.
  `planVoid` takes `decorProfile(floor, depth, themeKey, forceBand).band` (or `input.profile.band`), so a caller passing
  `KV_DecorBand` as `forceBand` forces the void too (the client wiring is VD3's `VoidController`). Measured over 27
  floors planned at each band: shoulder 2,321 / 2,321 / 2,045 / 1,763 cells, ledge kept 0.90 / 0.74 / 0.59 / 0.39,
  outcrops per 100 eligible cells 0.98 / 1.18 / 1.45 / 2.03. Studio pass through floors 1-16 waits for VD3.

- [x] **VD5. Piece planner.** Void candidates into `planDecor` (source `"void"`), the footprint rule at the surface's
  height, caps and spacing, kept clear of decor tall pieces and far-wall dressing.
  -> Verify: specs: no piece hides a walkable cell (ray casts), caps hold over the census seeds, decor's own plan is
  unchanged when the void is absent (its census and budget specs pass as they are).
  **As built (2026-11-01).** API: `DecorPlanInput` gains optional `voidPlan?: VoidPlan` and `voidVariants?: (kind:
  VoidDecorKind) => number`; `DecorSource` gains `"void"`; `DecorEntry` gains optional `voidKind?: VoidDecorKind` (a
  biome void piece: `id` is voidDecorId, `kind` is the standard kind whose box was checked: `column` tall,
  `columnBroken` low, `debris` flat) and reuses **`y` as the surface top** a void piece stands / lies on (VoidPlan.top:
  `VOID.shoulderTopTiles` 0.85 for every standing piece; shoulder or ledge top for flats), no new height field;
  `DecorPlan` gains `voidCounts` (void entries per layer, inside `counts`, all 0 without a void plan); `StandingKind` /
  `DECOR_BOX` gain `curb` (8 x 14 px, an estimate: wall1 is not built yet). Void entries are appended after every decor
  entry (and their fade boxes after every decor fade box), so no earlier index moves. `footprintStencil`'s cache now
  keys on the surface top too (any top for the game camera; the wall top's stencils are the same values).
  Without a void plan the plan is **byte-identical**: a digest of every field of every entry, fade box polygon, drop
  count and count over 96 floors (runs 1-12 x floors 1, 3, 5, 7, 10, 12, 15, 18) is the same before and after
  (1251236753), and decorPlan.spec / profile.spec / director.spec pass unchanged (census `tall 25.10, low 0.48, flat
  150.06, wall 67.02`, as before).
  Rules (tunables `VOID_PIECES` in `shared/view/voidDecor/config.ts`; decorPlan.ts imports that file and `layer.ts`
  directly, not the voidDecor barrel, because voidDecor/plan.ts imports shared/view/decor: `VoidLayer` moved to its own
  import-free `voidDecor/layer.ts`, re-exported unchanged). A shoulder cell's room: a dist-1 shoulder cell takes the
  room of a neighbouring wall (that wall's floor neighbour's room, a room before a corridor), every farther cell the
  room of its first neighbour one field step nearer (buckets by distance, no BFS queue); corridor-only cells (-1) get
  no standing piece. Standing pieces stand on SHOULDER cells, in order: (1) ruin runs `wall` / `wallBroken`
  (DECOR_DRESSING.segmentTiles 4 cells) centred on straight shoulder rows exactly `ruinDist` 2 from the wall (R6's
  segment layout, longest runs first), (2) `column` / `columnBroken` (or, when the pack has art, a biome void kind,
  `biomeShare` 0.5 of the spots) on cells `columnMinDist`..`columnMaxDist` (2-3) from the wall at hashed gaps along
  the scan (mean `columnGap` 4), (3) low `curb` runs (`curbTiles` 3) on straight stretches of the shoulder's outer edge.
  Each passes `footprintClear` with its box at the surface top, at most `tallPerRoom` 4 per room plus `curbPerRoom` 2
  curbs, `tallMinSpacing` 3 apart, `decorClearTiles` 2 from every decor standing piece and wall piece (torch), at most
  `maxStanding` 80 per floor; whole vs broken by the decor profile's `wallBrokenShare` / `columnBrokenShare`. Flat
  pieces (shoulder and ledge tops) at hashed gaps (mean `flatGap` 6): `debris` everywhere, `bones` in grim, `moss` in
  verdant, `flagstones` on a room's shoulder at most `flagstoneMaxDist` 3 from its wall, a biome void flat kind (drift)
  when the pack has art; `flatMinSpacing` 2.5 apart, capped at `maxFlat` 200 and `flatShare` 25 % of the shoulder.
  **Flat pieces do not use the billboard stencil** (its billboard-plane test does not describe a decal lying flat):
  each is drawn at most `flatRadiusTiles` 1.25 from its pivot (DecorController scales larger art down,
  `decorPieceLayout` -> `flatLayoutWithin`; the vale rocks reach ~4.6 tiles at their own size) and only where every
  cell within that radius is the same surface (layer and top), so by rule 0 it can never lie over floor (or hang over a
  wall, the abyss or a lower step); the spec's ray check confirms it. Biome void kinds are planned only when the pack
  has art for them (unlike standard kinds, which are planned regardless of art and skipped by the renderer, as decor
  does): they are optional extras and would otherwise take every pack's slots. One `decorHash` per placed piece (new
  salts `VOID_PIECES.salt.variant` / `.gap` / `.biome`): its variant / facing (low bits), whole vs broken and a flat's
  kind (fraction) and the scan's next gap (middle bits); decorHash costs ~5 us under Lune.
  Census (`decorPlan.void.spec.ts`, runs 1-8 x floors 1, 3, 5, 7, 10, 12, 15, 18 = 64 floors through
  buildEndlessFloor), per floor: **tall 36.5, low 13.9, flat 96.2** (max 66 standing, 146 flat); wall 14.3, wallBroken
  16.0, column 6.2, columnBroken 5.0, curb 9.0, debris 50.6, flagstones 30.0, bones 7.6 (grim), moss 8.1 (verdant). By
  band (standing / flat): kept 45.8 / 99.9, worn 52.1 / 119.4, ruined 49.4 / 98.8, abyss 54.4 / 66.9 (the abyss band's
  narrower shoulder fits fewer flat patches). **Timing** on the loaded 2-core box under Lune: planDecor 14.4 ms per
  floor without the void, 22.5 ms with it (+8.1 ms; a first cut was +19.8 ms: the room BFS, per-cell hashes and closures
  were the cost), planVoid 15.4 ms (shared with the geometry through planVoidCached); the decor census spec's planDecor
  13.4 ms (14.0 ms before this change on the same box: no regression). Specs `decorPlan.void.spec.ts` (11): nothing else
  changes (entries, fade boxes, drops, lights, counts), determinism (also from a regenerated Dungeon), every piece on
  its surface at its top with a legal id / layer and `footprintClear` at its top, caps and spacing, biome kinds only
  with art (faked `voidVariants`), decorPlan.spec's independent ray check for standing pieces with the block under the
  piece from the floor to its top (0 hidden points over 34 floors), a flat-decal ray check (0 hidden; it does flag the
  same decal laid on a wall next to the floor), the per-top stencil cache, `flatLayoutWithin`, the census line.
  Finding for the Studio check: the footprint rule lets ruin runs stand on a room's **near** side too (about half of
  them face -X / -Z): at dist 2 their 1.75-tile box clears the near wall's floor. VDD2 says the rule decides; if they
  read as clutter between the camera and the room, require a +X / +Z front for tall void pieces.
  - [ ] Studio check: void pieces stand on the shoulder top (no float, no sinking), ruins line up with the shoulder
    rows, nothing covers a bullet, near-side ruins read well (see the finding above).

- [x] **VD6. Pieces on screen.** `DecorController` draws source `"void"`; vale mapping for `tiles` / `wall1` and the
  shoulder variants of existing kinds. Needs the decor atlas upload (docs/DECOR.md R5).
  -> Verify: `valeWorld.spec.ts` / `valeArt.spec.ts` cover the new kinds; in Studio, frames read and nothing covers a
  bullet.
  **As built (2026-11-01).** `DecorController.build` plans `planVoidCached(voidInputOfLayout(layout, depth) +
  forceBand)` (M1 / tutorial: `{ dungeon, forceBand }`), the same band inputs as the decor (KV_DecorBand), and passes it
  with `voidVariants` (pack.voidDecorVariants) into planDecor; Workspace **`KV_VoidOff`** (`VOID_VIEW.offAttribute`, boolean,
  default off) plans without it, and a change rebuilds the floor. Standing void entries need no renderer change (the
  billboard anchor is already at `studsY(e.y)`); a void flat's Part is raised to `studsY(e.y)` instead of the floor and
  drawn with the layout `decorPieceLayout` returns (flatLayoutWithin); a biome void kind looks up
  pack.voidDecorVariants(biome, voidKind); the KV_DecorDebug stencil of a void piece is drawn at its top; the build log
  adds the void tall / low / flat counts. `curb` and `flagstones` joined `DECOR_VIEW.gridKinds` (grid-aligned
  facings). The existing kinds' art (column1 / column2 / wall2 / wall3, rocks / bricks, bones, mushrooms) draws the
  void pieces as it is (decor-atlas.png is uploaded). valeArt.spec fits them on real floors: columns and stumps whole,
  ruin runs >= 0.9 (wall3's renders for the -X / -Z normals fit their hull at 0.93, the far-wall ones >= 0.95), flats
  within their reach; valeWorld.spec covers the mapping.
  **Vale `flagstones` / `curb`: mapping dormant, atlas edit deferred.** `VALE_VOID_DECOR_PIECES` (manifest.ts) maps
  `flagstones` <- `tiles` (flat) and `curb` <- `wall1` (low, outline) in every biome, but only while
  `VALE_WORLD_LAYOUTS` has that art, so both switch on by themselves after the rebuild below. The atlas edit was not
  made: `decor-atlas.png` **is uploaded** (assetIds.ts, 2026-10-26), so adding two pieces repacks it and every decor
  rect moves until it is re-uploaded, and `art/vendor/` is not in this sandbox to build or check the file names. Until
  then the planned curbs and flagstones (9 and 30 per floor) are not drawn. Owner steps:
  1. In `art/atlases.json` `worldArt.pieces`, add (check the file names against `art/vendor/lords-of-pain/prop/`):
     `"tiles": { "file": "lords-of-pain/prop/tiles/NE/tiles_NE_45.0_0.png", "pivot": "center" }` (flat: keeps its
     shadow) and `"wall1": { "facings": { "count": 4, "zeroDeg": 45, "artOffsetDeg": 90 }, "animations": { "idle": {
     "file": "lords-of-pain/prop/wall1/{dir}/wall1_{dir}_{angle}_{f}.png", "frames": [0], "fps": 1, "loop": true } },
     "shadow": false, "pivot": "run", "outline": true }` (as wall2). At the same rebuild drop the retired `gems-*`
     pieces (VALE_RETIRED_WORLD_ART, docs/BOOST_ART.md: they were kept only to avoid this repack).
  2. `npm run art:lock`, then `npm run art:build` (repacks decor-atlas.png; layout.ts gains `tiles` / `wall1`).
  3. Re-upload `art/upload/decor-atlas.png`, paste its new ID over the old one in `packs/vale/assetIds.ts`.
  4. Re-measure wall1 on `art/build/contact/decor.wall1.png` and set `DECOR_BOX.curb` (and `VOID_PIECES.curbTiles` to
     its run length) like wall2 / wall3; flagstones need nothing (flats are held to `flatRadiusTiles`).
  5. `npm run verify` (valeWorld.spec then expects both kinds in every biome; valeArt.spec fits them).
  - [ ] Studio check: void pieces draw at the shoulder's height in every biome and band, `KV_VoidOff` removes them,
    frames read, nothing covers a bullet; after the rebuild, curbs and flagstones.

- [x] **VD7. Biome art slots.** Optional `decor.void.b<n>.<kind>` kinds in the contract and validator; nothing drawn
  without art; this doc lists the wanted art per biome.
  -> Verify: validator specs; vale validates without them.
  **As built (2026-11-01).** Two new standard decor kinds for void dressing the vale pack maps in VD6: `flagstones`
  (flat; the Lords of Pain `tiles` patch) and `curb` (low only; `wall1`), appended to `DECOR_KIND_LAYERS` /
  `DECOR_KINDS`, so `decor.delve.b<n>.flagstones` / `.curb` validate. Optional per-biome void art
  `decor.void.b<n>.<kind>[.<v>]` (`VOID_DECOR`: `prefix`, `kinds`, `layers`; `voidDecorId`; `parseDecorId` returns
  `{ type: "void", biome, kind, variant, layers }`, and a piece's info now carries `layers` too): kinds `spire`, `crag`,
  `grave`, `deadtree`, `statue` tall or low (like far-wall pieces), `vent`, `root`, `bush` low, `drift` flat. Any kind in
  any biome; no pack fills them. Lookups `ThemeCore.voidDecorVariants(biome, kind)` / `ThemePack.voidDecorVariants`
  (base ID then `.1`..`.4`, empty and silent when absent; same checks and cache as `decor`). Wanted art per biome (art
  direction, not rules): frost `spire` / `drift`, molten `vent` / `crag`, grim `grave` / `deadtree`, verdant `root` /
  `bush`, ancient `statue`. Specs in `void.spec.ts` (valid IDs round-trip and validate, unknown kinds / biome numbers /
  variants rejected, layers enforced, lookups).

- [x] **VD8. Abyss atmosphere.** The ledge -> abyss colour ramp, sparse abyss motes on the existing ambient emitter
  (drawn under the floor, so never over a bullet), the molten bottom glow. Optional: a faint texture on the backdrop
  that drifts at a fraction of the camera's motion (fake parallax; off under Reduced motion).
  -> Verify: validator for any glow; in Studio every biome, Reduced motion on and off.
  **As built (2026-11-01), modest.** *Colour ramp*: the three validated steps only (shoulder -> ledge -> abyss, VD1's
  luminance order); outcrops take the ledge colour. A darker outer-band shade was **skipped**: `voidReport` validates
  only the ledge colour, and a further mix toward the abyss is not guaranteed to stay lighter than the abyss (mixing in
  sRGB can dip below both ends in luminance) nor checked for bullet contrast. *Abyss motes* (DecorFxController): a
  second emitter volume (`DecorAbyssMotes`, under `KV_DecorFx`) with the biome's ambient look, under the camera focus,
  centred `DECOR_FX.abyssMoteLiftTiles` (1) above the abyss plane, `abyssMoteVolumeHeightTiles` (1) high;
  `abyssMoteSpec(ambient)` = `abyssMoteShare` (0.3) of the ambient emitter's live count (so the band's light, the juice
  particle level and `motionScale` scale it, and Reduced motion zeroes it), drifting by its own `abyssMoteMotion` (6-10 s,
  0.05-0.15 tiles/s, no acceleration) whatever the biome's motion (molten embers would climb 11 tiles out of the abyss).
  Under the floor plane: floor, wall and void Parts hide every mote that is not over open abyss, so none can draw over
  a bullet; `parts.spec.ts` checks the volume sits above the abyss plane and `ambientMaxRiseTiles` (fastest speed for the
  longest life plus any upward acceleration) keeps the highest mote under the floor. `KV_VoidOff` turns them off too.
  Nothing draws without a `decor.fx.ambient.b<n>` texture (none uploaded yet), like the ambient motes.
  **Skipped**: the molten bottom glow (would be a new emissive surface needing its own validator rule; the abyss
  colour carries the red-black tint) and the fake parallax backdrop texture (needs an uploaded texture; no asset).
  - [ ] Studio check: every biome with ambient art uploaded, Reduced motion on and off: motes only over open abyss,
    sparse, never over the floor; none under Reduced motion.

- [x] **VD9. Preload and debug.** Void materials need no upload; new art joins `biomeContentIds`. Debug attributes
  `KV_VoidDebug` (tints each layer) and `KV_VoidOff`, off by default, Janitor-cleaned.
  -> Verify: `contentIds.spec.ts`; the attributes in Studio.
  **As built (2026-11-01).** `VOID_VIEW.offAttribute` `KV_VoidOff` (no void Parts, no abyss motes; the bare abyss
  backdrop stays) and `VOID_VIEW.debugAttribute` `KV_VoidDebug` (each raised layer in a flat SmoothPlastic tint,
  `VOID_VIEW.debugColors`: shoulder blue, ledge amber, outcrop magenta), both off by default, reacting at once through
  `GetAttributeChangedSignal` connections held by the controllers' Janitors (the decor's live pattern). Preload: the
  void uses built-in materials and theme colours only, no content id, so nothing joins `PRELOAD` or
  `biomeContentIds`; `contentIds.spec.ts` passes unchanged. Future `decor.void.*` art (VD6 / VD7) joins
  `biomeContentIds` then.
  - [ ] Studio check: both attributes toggle live mid-run, and nothing is left behind after a floor change or restart.

- [ ] **VD10. Docs.** `CLAUDE.md` decision log, `docs/CLIENT.md` (VoidController, debug attributes: done with VD3 /
  VD9, section "Void decoration"),
  `src/shared/theme/README.md` (the new placeholders and surfaces), a cross-link from `docs/DECOR.md`.

- [ ] **VD11. Studio check and playtest.** Every biome at every band, solo and co-op, PC and phone emulator: the void
  never reads as floor, bullets stay readable along far walls, the frame helps the room read, fps and part counts.
  Tune `VOID`, `VOID_PIECES`, `VOID_DEPTH`; settle VDD5, VDD6, VDD8.

Order: VD1 -> VD2 -> VD3 is the big visual change on its own and needs no art. VD4 and VD8 follow VD3. VD5 -> VD6 wait
for the decor atlas upload; VD7 any time. VD10 lands with the code; VD11 last.

## Risks

- **Mistaken for floor.** The shoulder is the biggest new surface on screen. Height, darker colour and the validator
  guard it; judge it in Studio in the snow biome, where floor and shoulder are both pale.
- **Performance.** Up to ~500 Parts and ~280 pieces per floor on top of the decor's ~1,050 instances. Parts are static
  and greedy-merged; measure on the phone emulator before VD5.
- **Material textures on tall cliff Parts** may stretch or tile oddly. Fallback: cap cliff faces at `abyssDepthTiles`
  and let the colour ramp do the rest.
- **Floor-change hitch.** The planner runs per floor (field BFS over ~13k cells plus footprint checks); keep it behind
  the stage cover and under ~15 ms, like the decor plan.
