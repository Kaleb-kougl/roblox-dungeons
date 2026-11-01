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
numbers below); VD1 (theme contract) and VD7 (void art slots) are built; nothing is drawn yet (VD2 / VD3 next).

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

All of these are already cut into `decor-atlas.png` (docs/DECOR.md R5); they draw once that atlas is uploaded.
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

- [ ] **VD2. Void planner.** `voidField`, `planVoid`, `VOID` / `VOID_DEPTH` config.
  -> Verify: specs: deterministic; non-void cells untouched; every wall-adjacent void cell is shoulder; pocket fill;
  ledge only on the shoulder rim; a ray-cast spec (like decorPlan's) finds no walkable cell hidden by shoulder, ledge or
  outcrop over the census seeds; Part budget (<= 500 rectangles per floor) over the census seeds.

- [ ] **VD3. Geometry.** `VoidController`, the deeper biome-tinted backdrop, cliff faces, materials and tints per biome,
  stage-cover deferral.
  -> Verify: `npm run verify`; in Studio every biome: shoulders meet walls with no gaps or z-fighting, cliffs read on
  the near side, part count and build time written down (PC and phone emulator).

- [ ] **VD4. Depth bands.** `VOID_DEPTH` knobs read through `decorProfile`; `KV_DecorBand` forces them too.
  -> Verify: specs per band; in Studio `N` through floors 1-16.

- [ ] **VD5. Piece planner.** Void candidates into `planDecor` (source `"void"`), the footprint rule at the surface's
  height, caps and spacing, kept clear of decor tall pieces and far-wall dressing.
  -> Verify: specs: no piece hides a walkable cell (ray casts), caps hold over the census seeds, decor's own plan is
  unchanged when the void is absent (its census and budget specs pass as they are).

- [ ] **VD6. Pieces on screen.** `DecorController` draws source `"void"`; vale mapping for `tiles` / `wall1` and the
  shoulder variants of existing kinds. Needs the decor atlas upload (docs/DECOR.md R5).
  -> Verify: `valeWorld.spec.ts` / `valeArt.spec.ts` cover the new kinds; in Studio, frames read and nothing covers a
  bullet.

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

- [ ] **VD8. Abyss atmosphere.** The ledge -> abyss colour ramp, sparse abyss motes on the existing ambient emitter
  (drawn under the floor, so never over a bullet), the molten bottom glow. Optional: a faint texture on the backdrop
  that drifts at a fraction of the camera's motion (fake parallax; off under Reduced motion).
  -> Verify: validator for any glow; in Studio every biome, Reduced motion on and off.

- [ ] **VD9. Preload and debug.** Void materials need no upload; new art joins `biomeContentIds`. Debug attributes
  `KV_VoidDebug` (tints each layer) and `KV_VoidOff`, off by default, Janitor-cleaned.
  -> Verify: `contentIds.spec.ts`; the attributes in Studio.

- [ ] **VD10. Docs.** `CLAUDE.md` decision log, `docs/CLIENT.md` (VoidController, debug attributes),
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
