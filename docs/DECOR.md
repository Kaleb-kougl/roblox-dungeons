# Room decoration: plan

How to dress the vertical slice's endless floors with props: textured walls, columns, torches, braziers, floor
clutter. Work it task by task, like `PLAN.md` and `docs/ART.md`; each task ends with a **Verify**. Decoration is
**presentation only**: nothing here changes `src/shared/sim/**`, collision, or a replay hash (D2 below, now taken, was
the one exception, and it is done: endless pillars are solid walls). Phase 2 (below) makes the decoration dynamic and
adds the second exception, D4: breakable barrels and crates are sim objects.

## Status (2026-10-26, branch `decor-dynamic`)

R2-R4, R6 and R8-R13 are **code-complete and verified headlessly only** (`npm run verify`: 117 suites, 1611 of 1612
tests; the one failure is the known x86 `forge.spec.ts` seedToState vector). **Nothing has run in Studio**. R5's
pipeline and pack mapping are done (branch `art-r5`, below): `npm run art:build` writes the two new uploads
`decor-atlas.png` and `decor-mote.png` into `art/upload/`, but they are **not uploaded yet**, so with the `vale` pack
only the breakable placeholder blocks and the decor PointLights draw until their IDs are in `assetIds.ts`. Open: the
R5 upload and Studio checks, R7 / R14 docs leftovers (PROVENANCE, docs/SERVER.md replay cost), R15 playtest, and
every Studio check (`docs/CLIENT.md` steps 25-31 and the "Breakables" section).

As built, differing from the text below:

- **R3 is not a port.** The web repo (`35307022`) was not reachable, so `shared/view/decor/decorPlan.ts` was written
  from this doc's rules, keeping the web's names (`planDecor`, `MAX_TALL_PER_ROOM`, `TALL_MIN_SPACING`,
  `MAX_DECOR_SHARE`, `BULLET_Y`, `BULLET_PAD_PX`, `DECOR_BOX`, `WALL_DEPTH_BIAS`); diff it against the web source when
  available (D3 still stands for that comparison; no PROVENANCE row until then). The footprint rule uses the game
  camera's real projection (cached per box shape: ~15 ms per floor) and treats POOL cells as open. A spec re-checks it
  with ray casts: 0 hidden bullets. `DECOR_BOX` sizes are estimates; re-measure in R5. Drawn art is clamped to its box
  (and flames / glows at their maximum growth) at render time, so oversized art can never break the rule.
- **Census per endless floor** (runs 1-20 x floors 1-5): ~25 tall (9 wall segments, 5.6 columns, 6 icicles, ...), ~150
  flat, ~67 wall pieces (64 torches). No solid pillar gets a stump (each has open floor behind it). Braziers mostly
  leave the boss ring (~1.4 survive the cap), so the **boss ring is drawn as flat fire pits** at the Forge's
  boss-room brazier spots (floor glow + PointLight), lit 2 / 4 / 6 by phase. The depth band's flat thinning rarely
  bites (Forge clutter is under 20 % of a room already).
- **R2 contract**: kind segments are lowercase in ids (`decor.delve.b3.shardice`; code uses `decorId()`); added
  `pixelsPerTile`, `rect`, `glowAt`, variants `.1`..`.4`, kinds `gems` (removed again by docs/BOOST_ART.md BA2) /
  `brokenBarrel` / `brokenCrate`; one
  `decor.fx.flame` role (not per biome). `decor.fx.*` roles must differ from the enemy-bullet roles by >= 40 CIE76.
  Breakables: required `breakable.barrel` / `.crate` (asset, role, name), `sfx.breakable.hit` / `.break`.
- **R9 / R10**: director `{ state, events, scene, dt, motion }` (no config: boss floors come from the scene); light
  pool of 6 plus <= 6 fixed lights; the band scales decor lights and particles only, not world Lighting. ~233 planned
  pieces per floor (above this doc's ~150 guess); up to ~1,050 instances per floor once every kind has art.
- **R11 / R12 breakables**: own stream `floorSeed ^ BREAKABLE.salt`. Pieces keep clear of the actual deferred spawns,
  which depend on party size, so solo and co-op floors with the same seed get different pieces. Counts are per
  150-tile room, scaled by area, capped at 16 (census: kept 2.2, worn 4.3, ruined 6.7, abyss 8.9 per room). Toughness
  in bow damage units (barrel 2, crate 4; an enemy bullet half an arrow); pieces take base weapon damage (no
  Sharpened). Bullets check walls, then pieces, without the `blocked` argument (the sim needs the slot). The slam rule
  is nearly dormant (boss rooms get no pieces; 1 of 240 boss floors has one in reach). Replay bench: +0-10 %. The
  `score` hash group of every scored run (tutorial included) gains `points/counts.breakables`; gameplay outside
  endless runs is unchanged.
- **R13**: placeholder blocks (crate 4x2x4, barrel 3.5x2.5x3.5 studs), blink / shake / chips / sparks (sparks at the
  piece centre, not the contact point), the sniper aim line clipped at intact pieces; art capped at 5/8 tile tall.
- **Void set pieces (docs/VOID_DECOR.md VD5 / VD6).** With `DecorPlanInput.voidPlan` (DecorController passes
  `planVoidCached` unless Workspace `KV_VoidOff`), planDecor appends source `"void"` entries standing / lying on the
  void's shoulder and ledge tops (entry `y` = the surface top; columns, stumps, flat clutter, flagstones, optional
  biome `decor.void.*` kinds; no wall props, VDD10), each under the footprint rule at its surface's height (`footprintStencil` now
  caches per top). Without a void plan the plan is byte-identical; the census and budget specs here are unchanged.
- **Gems are not decor (docs/BOOST_ART.md BA2, decision 2).** A gem cluster on the floor always means a boost drop,
  so the contract has no `gems` decor kind any more (`decor.delve.*.gems` is an unknown decor ID) and the vale pack
  maps nothing onto the four `gems-*` world art pieces (`VALE_RETIRED_WORLD_ART`). No floor changed: the decor plan
  never placed a `gems` piece (it is not a Forge prop kind; `FLAT_FORGE_KINDS` never listed it), so the plan, its
  census and the budget specs are unchanged. The `gems-*` entries stay in `art/atlases.json` (with a `$comment`) and in
  the uploaded `decor-atlas.png` only so that atlas does not repack and need a re-upload; drop them at its next rebuild.

## What already exists

**The data is there, nothing draws it.** The Dungeon Forge already decorates every floor (`Dungeon.props`,
`.torches`, `.arches`, generated from the floor seed on the same RNG stream, so every co-op client gets the same
pieces). Census of 100 endless floors (runs 1-20, floors 1-5, `endlessFloorParams`), per floor:

| Kind | Per floor | Where the Forge puts it |
|---|---|---|
| torch | 63 | wall cells facing a floor cell |
| arch | 27 | doorway frames |
| debris / crack / moss | 19 / 17 / 13 | scattered floor; cracks by liquid; moss in verdant |
| icicle / shardIce | 7.5 / 2 | frost walls / frozen lakes |
| pillar | 7 | a 3-4 tile grid **inside** combat and elite rooms >= 10 tiles; on endless floors a solid WALL cell (D2) |
| banner | 6.7 | walls |
| brazier | 6 | a ring around the boss room's centre |
| bones / grave / candle | 5.5 / 5.3 / 2 | rooms past depth 1 / grim graveyard rooms |
| chest, ring, bossCrystal, shrineCrystal | 1-1.5 each | treasure, entrance, boss, shrine centres |

Walls today are greedy-merged 1-tile-tall Parts (~480 wall tiles per floor) in the biome's flat colour
(`WorldController`). Themes are picked from each floor's seed, so all five biomes appear (ancient 21 %, frost 22 %,
grim 20 %, verdant 22 %, molten 15 %).

**The web build has already solved this.** `project-kaleb-vale` at HEAD `35307022` (newer than the port's
`42897e2`) has a full decoration system, and this plan ports it rather than reinventing it:

| Web source | What it does |
|---|---|
| `src/dungeon/decorPlan.ts` (+ `decorPlan.test.ts`) | Pure, deterministic plan from a `Dungeon`: each Forge piece gets a layer and a spot, under readability rules |
| `src/render/decor.ts` (+ `decor.test.ts`) | Pure instance packing, screen-space fade selection, glow colours |
| `src/dungeon/floorTiles.ts` (+ test) | Textured floors and walls: floor variants, wall top and side tiles, lit-face contrast |
| `src/theme/contract.ts` `DECOR` slot | `decor.<group>.<...>` IDs (e.g. `decor.delve.b1.pillar`), free-size art with `layer`, `rect`, `glow`, `emissive`, `pivot` |
| `src/dungeon/DungeonDecor.tsx`, `src/render/DecorBatch.tsx` | The three.js views (instanced quads); the Roblox port replaces these |

Its core rules (keep them):

- **Tall pieces never stand where they could hide gameplay.** Pillar, brazier, grave, sarco, candle, icicle and
  shardIce go on the **top of a wall cell whose room is in front of it** (the far walls, seen from the camera), and
  only where no walkable cell behind the art's screen box could hold a hidden bullet (the "footprint rule"). At most
  3 per room, at least 3 tiles apart, in priority order brazier > sarco > pillar > grave > candle > icicle >
  shardIce; pieces without a legal spot are dropped.
- **Flat pieces** (debris, bones, crack, moss, roots, ring, crystals) lie where the Forge put them, capped at 40 % of a
  room's floor.
- **Wall pieces** (torches, banners) only on the wall faces the camera sees, one per cell, none under a tall piece.
- **Nothing near doorways or interactables.** Chests are never drawn (the treasure room's interactable sits there);
  the shrine crystal is dropped under the shrine.
- **Tall decor fades** when a player or the boss walks behind it.
- **Glows and lights** never push the floor so bright that an enemy bullet drops below 3:1 contrast.

## The key constraint: props do not collide

Collision is the tile grid only (`src/shared/dungeon/collision.ts`; the web build is the same). A pillar drawn where
the Forge places it, in the middle of a combat room, would be a solid-looking column that players, enemies and
bullets pass through, and that hides bullets behind it. That is why the web build moves tall pieces onto far walls.
This plan follows that rule for every prop. **Exception, since D2:** on endless floors the pillar cells themselves
are WALL tiles (`ForgeParams.solidPillars`), so they block players, enemies, bullets and sight like any wall and
`WorldController` already builds them as 1x1 wall Parts. The `pillar` props stay in `Dungeon.props` (same positions),
but the decor plan must treat those cells as walls, not as floor props.

## Art: the full Lords of Pain pack

Bought and copied in on 2026-10-25: `art/vendor/lords-of-pain/` (5,306 files, 123 MB, gitignored; the same licence as
the demo: free and commercial use, may modify, may not redistribute or resell). It is a byte-identical superset of the
demo (all 539 demo PNGs match), so the atlas pipeline can switch to it without changing a pixel. Every prop is a
pre-rendered 256 px sprite in 16 facings, at the same scale as the skeleton. Measured (visible box over all facings,
shadow included):

| Piece | Frames | Box (px) | What it is | Use |
|---|---|---|---|---|
| `column1` | 1 | 245x186 (body ~30x95) | tall square stone column, long shadow | pillar (tall) |
| `column2` | 1 | 111x78 | broken stump | pillar variant (low), rubble |
| `wall1` / `wall2` / `wall3` | 1 | 143x101 / 207x184 / 190x162 | low curb / full / broken wall segment, about 4 tiles long | far-wall dressing (R6) |
| `tiles` | 1 | 174x124 | a patch of flagstones | flat floor patches |
| `torch` | 1 | 111x81 | wall sconce, unlit | torch (wall), with `vfx/flame` |
| `brazier`, `brazier_lit`, `brazier_break` | 1 / 8 / 8 | ~78x54 (break 128x136) | | brazier (tall), lit loop |
| `bricks` | 1 | 98x82 | rubble pile | debris |
| `rocks` | 1 | 201x143 | scattered pebbles | debris (flat) |
| `bones1`-`3` | 1 | 43-69 wide | | bones (flat) |
| `mushrooms` | 1 | 48x36 | | moss, roots (verdant) |
| `barrel`, `crate` (+ `_break`, 8 frames) | 1 | 59x45 / 41x28 | | room clutter (low) |
| `gemstones_*` (4 colours) | 8 | 21x15 | | ~~treasure-room dressing~~: boost drops since docs/BOOST_ART.md (decision 2), not decor |
| `vfx/flame`, `vfx/flames` (+ glow) | 8 | 60x61 / 60x157 | flame loops | on torches and braziers |
| `environment/ground_variation1/2`, `ground_darken` | 1 | 256x256 | floor textures next to `ground_stone1` | floor variants (R1) |

No piece for crack, banner, arch, grave, sarco, candle, icicle or shardIce: those stay undrawn. (Since then: sarco, candle and banner come from 3D kits, below, and grave from original art, "Graves".)

**Facings.** A prop needs one facing (the camera's yaw never changes). Pieces that sit on the grid (walls, columns,
tiles, crates) must use the facing whose edges run along the grid as this camera sees it: the world axes land at
39.3° and 140.7° on screen, and the pack's NE / NW renders put a grid-aligned edge at about 37°. That is ~2° off by
eye, so the pack's camera elevation (~49°) is close to this game's pitch (55°), and the pieces should sit on the grid
convincingly (confirm in R4). Round pieces (rocks, bones, mushrooms, barrels) take any facing, picked by cell hash for
variety. They all go through the existing atlas pipeline (`scripts/art/build-atlases.js`, `art/atlases.json`) into
the `vale` pack.

**Walls stay 3D Parts.** They have to match the collision grid exactly, and they hide what is behind them the way
the sim expects. Dress them in layers:

1. Roblox built-in materials (Slate, Brick, Cobblestone, Basalt, Limestone), one per biome, tinted by the biome's
   wall colour, plus the pack's ground variations on the floor. Free, no uploads, lit by the engine.
2. On the rooms' far walls (the -X / -Z sides, which the camera looks at), `wall2` / `wall3` segments standing on the
   wall tops in the grid-aligned facing, plus `column1` at corners and doorway jambs: the web's "tall on a wall top"
   placement, under its footprint rule. Near walls (between the camera and the room) never get them.

**Biomes.** The Lords of Pain set is dark dungeon stone: it fits ancient and grim, and is passable tinted for the
others. Biome-specific kinds (icicle, moss, grave) have no art and stay undrawn for now.

## 3D kits (trial, 2026-11-02)

Prop art can also come from 3D models rendered to sprites from the game camera, so it sits on the grid with no warp
(2D isometric packs drawn from another angle never quite do). `scripts/art/kit/render_kit.py` (Blender's `bpy` module,
`pip install bpy==5.2.3` on Python 3.13; not part of `npm run`) imports a .glb, renders each piece listed in a kit
file (`scripts/art/kit/<kit>.json`: mesh objects, camera turns `az`, size in pixels, `flatten`, a colour grade toward
Lords of Pain) with an orthographic camera at the game's 55 degree pitch, and writes single-frame PNGs at this pack's
decor scale (29.6 px per tile, matched on the barrel) into `art/vendor/<kit>/`. From there they are ordinary world art
in `art/atlases.json`, each its own PNG (`own`), so the uploaded decor-atlas.png never repacks.

First kit: the **Dungeon Essential Kit** (Rakshaan, Sketchfab, **CC-BY 4.0: credit required where players see it**,
THIRD_PARTY_NOTICES.md), in `art/vendor/dungeon-essential-kit/` (put `dungeon_essential_kit.glb` there to re-render):

| Art | Draws | Where |
|---|---|---|
| `kit-cage-1` / `-2` (the floor cage with its door open, two turns) | `decor.void.b<n>.cage.1` / `.2`, new void kind `cage` (low) | standing on the void's shoulder behind rooms' far walls, half the void's standing spots (`VOID_PIECES.biomeShare`) |
| `kit-chains-1` / `-2` (the kit's draped chain, flattened, two turns) | `decor.void.b<n>.chains.1` / `.2`, new void kind `chains` (flat) | lying on the shoulder among the void's flat pieces |
| `kit-chains-1` | `decor.delve.b<n>.bones.4` (was Lords of Pain `bones1-sw`, now retired art) | in rooms wherever the Forge drops bones |
| `kit-bookcase-x` / `-z` (the bookcase at world scale, 125 kit units a tile, facing +X / +Z; the +X one lit by a mirrored sun, render_kit.py `sunSide`) | `decor.delve.b<n>.bookcase.1` / `.2`, solid decor kind `bookcase` | flush against rooms' far walls in library and hall rooms (docs/BOOKSHELVES.md); uploaded 2026-11-03 |
| `kit-chandelier-1` (the candle chandelier, its chain cut off by `keepHeight`: lying fallen) | `decor.delve.b<n>.chandelier`, new decor kind `chandelier` (flat, scattered) | on open floor in rooms: planDecor's `scatter` step (DECOR_SCATTER: about a third of the rooms with 40+ floor tiles, never the boss room, one per room, at most 4 per floor; census 3.4 per floor), only when the pack has its art |

Third pack: the **Dungeon Assets Pack** by zver.3d (v1.0.0, FBX + 4k TGA, free for games, credit requested; on the
Credits screen), in `art/vendor/zver-dungeon-assets/`: `scripts/art/kit/zver_to_glb.py` turns its FBX files and TGA
base colours into one glb that render_kit.py renders with `scripts/art/kit/zver-dungeon-assets.json`:

| Art | Draws | Where |
|---|---|---|
| `kit-table-x` / `-z` (the table with papers and a candle dish, along X / Z) | `decor.delve.b<n>.table.1` / `.2`, solid decor kind `table` | libraries' reading areas (docs/BOOKSHELVES.md "Reading area") |
| `kit-chair-px` / `-pz` / `-nx` / `-nz` (the chair facing +X / +Z / -X / -Z) | `decor.delve.b<n>.chair.1` .. `.4`, solid decor kind `chair` | a chair at each end of the reading area's table, facing it |

Second kit: the **Dungeon Modular Set V2** (C. Anastasiadis, Sketchfab, **CC-BY 4.0**, on the Credits screen), in
`art/vendor/dungeon-modular-set-v2/` (the .glb is there), `scripts/art/kit/dungeon-modular-set-v2.json`. It fills three
kinds the plan already places but no pack had art for:

| Art | Draws | Where |
|---|---|---|
| `kit-sarcophagus` (the stone sarcophagus) | `decor.delve.b<n>.sarco` | far-wall tops (tall, priority after the brazier), where the Forge puts sarcophagi; inside DECOR_BOX.sarco |
| `kit-candle-stand` (the candle stand with its lit candles) | `decor.delve.b<n>.candle` | far-wall tops, where the Forge puts candles (grim graveyard rooms); inside DECOR_BOX.candle |
| `kit-banner` (the red banner, 4 facings like the torch: SE for wall normal +X, SW for +Z, the hidden two copied) | `decor.delve.b<n>.banner` | on the wall faces the camera sees, where the Forge hangs banners (~7 a floor) |

Third model: **Old Chest** (SebastianSosnowski, Sketchfab, **CC-BY 4.0**, on the Credits screen) in
`art/vendor/old-chest/`, `scripts/art/kit/old-chest.json`: the vault chest (docs/TREASURE.md TR9), `kit-chest` closed
and `kit-chest-open` open, four facings each at world scale. The renderer gained `importScale` (a model in metres) and
`lid` (open a box with no separate lid: cut, fill, turn the top on its hinge, hollow the box); world sprite sets take a
per-facing `pivot: [[x, y], ...]`.

The renderer gained `fit: "box"`, `rotZ` (turn the piece, not the camera: a wall piece per normal), `files` and
`copies` for this. The box fit is checked by valeArt.spec on real floors (drawn whole).

No sim, dungeon, hash or replay change: two void kinds in the theme contract (`VOID_DECOR`), one scattered decor kind
(`chandelier`, appended last to DECOR_KINDS; planDecor's `scatter` step appends its entries after the void, so no
earlier entry moves) and vale mappings; the decor plan already places any void kind a pack has art for. Every biome alike for the trial. The credit the licence asks
for is on the main menu's Credits screen (shared/view/menu `CREDITS`, with every other third-party work). Every
`kit-*.png` of both kits uploaded 2026-11-02 (IDs in `packs/vale/assetIds.ts`); open: Studio
check (cages read at the camera and never cover a bullet; how many cages the void shows; chains read on every biome
floor), then decide which biomes keep them and what else from the kit to render (hanging cage, statue, lectern,
bookcase, wall torch).

## Graves (2026-11-08, original art)

Presentation only (no sim, dungeon, lockstep, hash, replay or fixture change; the decor plan already placed graves,
DECOR_BOX.grave unchanged). The Forge's `grave` props (grim graveyard rooms, about 5 a floor, standing on far-wall tops
under the footprint rule) had no art; they now draw five ORIGINAL gravestones in the style of the Lords of Pain props,
made by `scripts/art/gen-grave-art.js` (run by `art:build` / `art:lock`) into `art/vendor/kaleb-vale/grave/`:

| Variant | Look | Art (px) |
|---|---|---|
| 1 | `grave-rounded`: round-topped headstone on a plinth, a carved cross over three epitaph lines | 28 x 32 |
| 2 | `grave-cross`: stone cross on a stepped base, a ring cut where the arms cross | 28 x 33 |
| 3 | `grave-cracked`: slab sunk in a mound of earth, leaning, its corner broken off, a crack down it | 26 x 30 |
| 4 | `grave-obelisk`: small obelisk with a pointed cap and a carved band, on a plinth | 26 x 34 |
| 5 | `grave-skull`: pointed-arch headstone with a skull in relief, moss on its shoulders and foot | 26 x 29 |

How they match Lords of Pain: each stone is a signed distance model rendered from the game camera (orthographic, 55
degrees down, azimuth -45, 29.6 px a tile: render_kit.py's, gen-fortune-art.js's) the way render_kit.py renders a 3D
kit, not as crisp pixel art: 6 x 6 rays a pixel averaged (soft edges), the kit sun from the camera's upper left with
self-shadows and a dim ambient, a mottled warm-to-grey stone albedo, and the kits' grade (saturation 0.62, contrast
1.15, the warm tint), so the bodies sit at a mean luminance of about 35-45 between the pack's columns (~28) and the
kits graded toward them (43-57). No baked floor shadow (the pipeline clears Lords of Pain's too). Every stone is turned
to face the camera, 28 degrees toward its sunlit side, so one image serves a far wall of either axis (the plan picks
a tall piece's variant by cell hash, not by its wall); drawn 1.3 x their modelled size to stand with the pack's column
stump. Each is its own PNG (worldArt `own`), so `decor-atlas.png` does not repack. Mapped as `decor.delve.b<n>.grave`
variants 1-5 in every biome (vale `VALE_DECOR_PIECES`). Measured against DECOR_BOX.grave (18 x 26 render px, nothing
below the pivot): the widest reaches 8.9 render px left of its pivot (the foot's front corner), the tallest 16.2 up
(`gen-grave-art.test.js` checks it). Not used on the void's shoulder (`decor.void.b<n>.grave` stays empty).
The five `grave-*.png` uploaded 2026-11-08 (IDs in `packs/vale/assetIds.ts`), so the bundled vale pack draws them;
Studio check pending (grim graveyard rooms).

## Breakable outline (2026-11-19, owner: "a yellow outline on the destructible objects")

Presentation only (no sim, dungeon, lockstep, hash, replay or fixture change). Every intact barrel and crate is drawn
with a yellow rim, so a piece you can smash reads apart from the solid decor at a glance; the rim goes the moment the
piece breaks (owner: "once destructed, the outline should go away").

- **Colour.** Role `breakableOutline` `#fff06a`, a soft lemon (shared/theme `breakableOutline.ts`; rule
  `BREAKABLE_OUTLINE_COLOR_RULES` / `breakableOutlineReport` in variantColors.ts): >= 3:1 on every biome floor (10.9:1
  at worst) and >= 40 CIE76 from the enemy-bullet roles, telegraph, the enemy outline and the player outline (nearest:
  telegraph 56). Every yellow sits near the golds; this one is the farthest found from them (Fury 22, new best 25,
  Goldling 26, pellets 31 CIE76): a rim round a barrel is not a gem or a pellet on the floor.
- **Art.** The sprites' rim is baked like the enemies' (docs/OUTLINE.md), but for world art: a worldArt sprite piece's
  `rim: { widthPx }` (art/atlases.json; barrel and crate at 2 px, inside the cell since worldArt's pad is 2) makes the
  atlas's rim sheet `decor-atlas-outline.png`: same size and cells, white, alpha = the cell's body mask (alpha > 32)
  dilated by widthPx minus its own alpha; transparent outside rimmed cells. The decor atlas itself is byte-identical,
  so nothing else re-uploads. Shatter frames are rimmed too (unused: see below). Build it alone with
  `node scripts/art/build-atlases.js --only worldArt` (refuses unless every world atlas matches art/build's).
  Uploaded 2026-11-19 (`packs/vale/assetIds.ts`); until its ID is in, pieces draw exactly as before.
- **Drawing.** BreakableRenderController: sprite bodies are SpriteViews built with the rim colour (the rim label under
  the frame); when the break starts the rim is hidden (`setOutlineShown(false)`) while the shatter plays, then the body
  goes back to its pool and the flat debris has none. A pooled body is shown again when reused (SpriteView `reset`), a
  restored piece likewise. Placeholder boxes (the stand-ins while the art downloads, the placeholder pack) sit in the
  Model `KV_Breakables/Outlined` under ONE Highlight (rim only, Occluded; the engine draws at most 31), parked far
  below once broken. Image art (no pack uses it for breakables) has no rim. The hit flash tints the body, not the rim.
- **Not done.** No setting (the enemy and player outlines have one); the Studio check.

## Solid decor (2026-11-02, owner: "solid, anywhere")

Diablo-style obstacles in rooms: **gameplay, not just presentation.** With the Forge option `solidDecor`
(`shared/dungeon/forge/solidDecor.ts`, `ENDLESS_SOLID_DECOR`, endless floors only), after solid pillars, combat and
elite rooms get **tombs** (a 2 x 1 sarcophagus, along X or Z) flanked by **candle stands** (1 x 1, one floor cell past
each end) whose cells become WALL: they block movement, bullets and sight like the pillars. Dungeon.solidDecor lists
them.

- **Placement** (`SOLID_DECOR`): its own stream `makeRng(seed ^ salt)`, so every room, prop, spawn, torch and the name are
  the option-off floor's. Rooms in id order; 55 % of combat / elite rooms get a cluster, rooms of 320+ floor tiles a
  second one at 50 %. A tomb needs every cell within 2 tiles to be floor of its room and none within 3 of a doorway;
  a candle every cell within 1. Nothing walled touches another wall, so the floor stays one piece (re-flooded; if a
  flood ever disagreed, the pieces would be taken back rather than cost a reroll). Census (72 floors): 3.5 tombs and
  4.8 candle stands per floor.
- **What follows from the grid:** room spawn tiles, breakables and the chandelier scatter all avoid the cells; enemies
  steer round them like pillars (`actorSteerMover`); the minimap shows them as walls.
- **Drawing:** WorldController draws their cells as floor (no wall block); the decor plan's `solid` step (after the
  wall pieces, before the void) stands their art on them at floor level, layer low, with a fade box (a player behind
  one fades it). They are exempt from the footprint rule: an obstacle's art may cover the strip just behind it. New
  decor kinds `tomb` (variant 1 along X, 2 along Z) and `candelabrum`; vale art `kit-tomb-x` / `kit-tomb-z` (the
  Dungeon Modular Set V2 sarcophagus rendered at world scale, `unitsPerTile` 112.5, its pivot the footprint's centre on
  the floor: render_kit.py `pivotOut`, atlases.json `pivot: [x, y]`) and the candle stand (`kit-candle-stand`, shared
  with `candle`).
- **Off:** M1, every fixture and the tutorial (`tutorialForgeParams` sets `solidDecor: false`: its rooms are lessons).
- **Changed:** endless layouts, spawns, replays and scores from floor 1 (all-time boards stay `_v1`, as with earlier
  endless changes); `DAILY.ruleset` 2 -> 3. `roomPool.lock.spec`'s roster digests re-recorded (its no-roster spender
  locks run with `solidDecor: false` and still match).
- Found on the way: the endless test bot sent `-0` move axes (`jsRound` of a negative zero), which the recording codec
  cannot carry, so a segmented replay split from the live hash once a walk round a tomb produced one. The bot now
  quantizes like a real client (`quantizeAxis`, which already turns -0 into 0).
- **Room banners** (presentation only, with the solid decor): when the pack has banner art, the decor plan hangs up to
  `DECOR_BANNERS.perRoom` (2) more banners per room (never the boss room) on its far-wall faces, 3+ tiles from every
  wall piece; census about 20 a floor on top of the Forge's.
- Tombs uploaded 2026-11-02. Open: Studio check (tombs read at the camera, enemies don't snag, cover
  feels fair), tuning (shares, sizes, which biomes).

## Room themes (2026-11-02, owner: "follow this example", the Dungeon Modular Set V2 sample scene)

The kit's own sample scene dresses each room as one idea: a throne room with its carpet and banners, a statue
shrine, a crypt of sarcophagi along the walls, stores in the corners, candle stands lining walls, braziers at the
entrance. Owner's choices: tombs **mostly against walls, some in the middle**; all four combat themes; **big set
pieces solid** (throne dais, statue base), carpet and wall art walk-through. Gameplay, from the same Forge option as
solid decor (`ForgeParams.solidDecor`, endless only, its own stream): `shared/dungeon/forge/solidDecor.ts` now gives
every room a theme (`Dungeon.roomThemes`, by room id) and places its set pieces.

| Room | Theme | Set pieces (solid unless noted) |
|---|---|---|
| boss | `throne` | the throne on its dais (4 x 2, `throne`) against a far wall, the most centred spot at least `centreDoorTiles` (6) from every doorway; a candle stand each side; the red carpet (flat, walkable, `Dungeon.carpets`: 2 wide, up to 16 tiles toward the arena); candle pairs along it outside the arena's middle (`arenaClear` 7); a brazier each side of every doorway, inside |
| entrance | `entrance` | a brazier each side of every doorway, inside |
| shrine | `shrine` | the statue on its round base (3 x 3, `statue`; candles and lectern in the art) against a far wall, 3+ tiles clear of the shrine; a candle each side (fits in 56 of 72 census shrine rooms; small ones stay bare) |
| combat / elite | `crypt` (grim 40 %, else 20 %; graveyard rooms always) | 3-4 tombs (5-6 in big rooms) lying along any wall, a candle stand at one or both ends; big rooms maybe one free-standing tomb, candles past both ends |
| | `hall` (20 / 20 %) | candle stands flush against the walls every 5+ tiles (at most 16); half of them a run of 2-3 bookcases on a far wall (docs/BOOKSHELVES.md); big rooms maybe a statue on a far wall |
| | `store` (15 / 20 %) | nothing solid: the breakables (breakables.ts) get x2 + 3 pieces, clusters of 3-5, seeded in the corners first |
| | `plain` (13 / 20 %) | maybe one tomb along a wall (55 %), big rooms maybe a free-standing one (30 %) |
| | `library` (12 / 20 %; docs/BOOKSHELVES.md) | 2-3 runs of 2-5 bookcases (1 x 1 each) end to end against the far walls only, candle stands at their ends; a reading area (a 2 x 1 table with a chair at each end facing it) on open floor within 8 tiles of the shelves, clearing the solid pillars under it and its 2-tile ring; big rooms maybe a statue; a room where no run fits is dressed as plain |
| treasure, frozen lake | `none` | nothing |

- **Rules** (`SOLID_DECOR`): a wall piece sits flush (every cell behind its back row is non-floor) and keeps every cell
  within `clearTiles` (2) of its open sides floor of its room; past its ends the back line may be wall only as one solid
  run from the piece (a curved or stepped wall), never with floor between. Candles beside a piece are checked before
  the piece is walled, so they touch it and leave no gap elsewhere. Door braziers are the only pieces within
  `doorTiles` of a doorway: flush with the wall in the opening's own row. solidDecor.spec checks it on 72 floors: the
  floor stays one piece and **no piece makes a new one-tile pinch** (the one by-design exception: a free-standing
  tomb's candle one cell past its end).
- **Census** (72 floors, per floor): 1 throne and carpet, 0.9 statues, 9.8 tombs, 29 candle stands, 4.2 braziers.
- **Drawing** (decor plan `solid` step): new kinds `throne` and `statue` (low; variant 1 faces +X, 2 faces +Z; a box at
  each of the footprint's four corners, hulled: `anchorsOf` takes rectangles) and `carpet` (flat; 2 x 2 segments,
  variants 1 / 2 along X / Z, 3 / 4 the end; no Forge flat piece on its cells), solid braziers with the pack's brazier
  (lit). With banner art, a banner hangs two cells past each end of the dais (the boss room's only extra banners).
- **Art** (`scripts/art/kit/dungeon-modular-set-v2.json`, render_kit.py's new `region` / `moves` / `pivotAt`): the
  throne seated on its dais (`unitsPerTile` 98: 4 tiles wide), the statue with its base, candle ring and lectern (135:
  3 x 3), the carpet segment and end (100: 2 x 2 tiles), each turned to +X and +Z. Vale art `kit-throne-x/-z`,
  `kit-statue-x/-z`, `kit-carpet-x/-z`, `kit-carpet-end-x/-z` (own PNGs).
- **Changed with it**: the test bots walk round breakables (`pathField`'s new `blocked` cells: the endless bot used to
  stand stuck on a storeroom crate); roomPool.lock's roster digests re-recorded; fxCues.spec allows a flask cue lost
  to a floor change inside one paced frame. `DAILY.ruleset` stays 3 (solid decor has not shipped).
- Uploaded 2026-11-02 9:00 PM: the eight `kit-throne-*`, `kit-statue-*`, `kit-carpet-*` PNGs (IDs in
  `packs/vale/assetIds.ts`). First Studio look: the carpet segments ran across the carpet (the Top-face SurfaceGui
  canvas turns 90 degrees anticlockwise on screen, FX_SPRITE_VIEW.floorCanvasTurnDeg); `buildFloorArt` (decorParts.ts)
  now turns every flat floor image's Part back (decor flats, decor fx glows, boost halos). Open: Studio check (throne room reads, enemies and the boss round the pieces, storerooms
  read as storerooms); tuning (theme shares, hall spacing, carpet length).

## Decisions

- **D1. The full Lords of Pain pack:** bought (2026-10-25). Every task below is unblocked.
- **D2. Solid pillars: decided, yes (2026-10-25).** The Kaleb-Vale Forge option `solidPillars` (on in
  `endlessFloorParams` only) turns every pillar cell into a WALL tile after all decoration, so the rng stream and every
  other prop, torch, arch and spawn stay put; endless room spawns, hashes and replays changed, M1 and the fixtures did
  not. Walking room enemies (not the boss) round pillars with `SimConfig.actorSteerMover` (`moveCircleAroundCorners`); the player stops
  at them like at any wall. For this plan: a solid pillar is a real 1-tile wall, so dress it as a wall (R1's
  per-biome wall material on its Part); `column1` / `column2` on it only where the footprint rule allows it (a tall
  column on an interior wall cell can hide bullets on the floor behind it, so most interior pillars get the material
  only, or the low `column2` stump). Playtest the sniper and bruiser fights around them.
- **D3. Port source commit.** The decoration code exists only at web `35307022`, not at the port's `42897e2`. Port it
  from `35307022` and record that commit in `PROVENANCE.md` (logged as a deviation in `CLAUDE.md`). It references the
  web's Delve floor (interactables, shop, breakable walls); the port swaps those for the slice's interactables (relic
  pedestals, shrine zone, stairwell, entrance spawn, boss arena centre).
- **D4. Breakable clutter is gameplay: decided, yes (2026-10-25).** Barrels and crates block movement and bullets
  and break under attacks, so they live in the sim (Phase 2, part 4): their own hash group, endless replays and
  scores change, M1, the fixtures and the tutorial do not. The rest of Phase 2 stays presentation only.

## Tasks

- [x] **R1. Walls and floors (materials).** `WorldController` gives wall Parts a per-biome `Material` (and floor
  variants by cell hash if they help), from a new theme field so packs choose it. Recompute the biome `wall` colour
  role from the result so the validator's enemy-bullet vs wall contrast check (>= 3:1) still describes what is drawn.
  → Verify: `npm run verify`; in Studio every biome reads, and enemy bullets stand out against walls.
  As built: optional `BiomeDef.materials { floor?, wall?, pool? }` (allow-list `BIOME_MATERIALS`, no Neon, default
  SmoothPlastic; textured floors and walls must name a rough material: SmoothPlastic's sun glint washed them out,
  docs/ART.md "As built: molten tiles"), set per biome in `vale` and applied to the merged floor /
  wall / pool Parts; the wall colour is not recomputed (`Part.Color` stays the hex, the material only adds texture, see
  the theme README), and floor variants by cell hash are skipped (greedy merging leaves no per-cell Parts).
  - [ ] Studio check: each biome reads at the game camera, and enemy bullets stand out against the textured walls.

- [x] **R2. Decor contract.** Port the web `DECOR` slot: `decor.<group>.<...>` IDs, free-size `image` / `sprites`
  art with `layer` (flat / low / tall / wall), `pivot`, and `glow` / `emissive` flags. Use `decor.delve.b<n>.<kind>`
  (b1..b5 = biome.1..5) and `decor.fx.torch`, as on the web. Placeholder: no art means nothing is drawn.
  → Verify: validator specs; the placeholder and vale packs validate clean.

- [x] **R3. Port `decorPlan.ts`** to `src/shared/view/decor/` (view code: it reads the Dungeon, never the sim), with
  its spec and `decor.ts`'s pure parts (fade selection, glow points). Keep the constants (`MAX_TALL_PER_ROOM` 3,
  `TALL_MIN_SPACING` 3, `MAX_DECOR_SHARE` 40 %, the footprint rule with `BULLET_Y` / `BULLET_PAD_PX`, `DECOR_BOX`),
  re-derive the pixel ones for this camera (`STUDS_PER_TILE`, the true on-screen projection from `sprites.ts`), and
  swap the Delve interactables for the slice's. Solid pillar cells (endless floors, D2) are WALL in the grid: the plan
  reads the grid, so it already treats them as walls; its `pillar` pieces must not also be placed as floor props there.
  Deterministic: the same Dungeon gives the same plan.
  → Verify: ported specs pass, plus slice cases (nothing on a pedestal, shrine, stairwell or doorway tile; no tall
  piece where a walkable cell behind it is hidden; caps hold over the census seeds).

- [x] **R4. Decor renderer (`DecorController`).** Built on `onFloorChanged`, cleaned up with Janitor:
  - **tall and low pieces:** pooled BillboardGuis (reuse `uprightImageBillboard` and the floor-clearance offset);
  - **flat pieces:** Decals on thin floor Parts (same as the player ring);
  - **wall pieces:** billboards pushed toward the camera off the wall face (the web's `WALL_DEPTH_BIAS`);
  - **fade:** tall pieces fade out (`ImageTransparency` over ~0.15 s) when a player or the boss is behind them;
  - **light:** torches and braziers animate their flame loop; `PointLight`s only in the boss and shrine rooms,
    2-4 of them (the web build's own D4 light rule, not this plan's D4).
  Budget: ~150 pieces per floor before caps; measure.
  → Verify: in Studio, a full endless run through every biome: no bullet is ever hidden, fps and texture memory
  written down on PC and the phone emulator.

- [ ] **R5. Art.** Point the pipeline at `art/vendor/lords-of-pain/` (regenerate `art/vendor.lock.json`; existing
  atlases come out byte-identical), add the props to `art/atlases.json` (grid-aligned facing for walls, columns, tiles
  and crates; hash-picked facings for round pieces; 8-frame flame and brazier loops), build, upload, paste the IDs into
  `assetIds.ts`, map them to `decor.*` IDs in the `vale` manifest. Drop `art/vendor/lords-of-pain-demo/` once nothing
  reads it.
  → Verify: contact sheets by eye; `npm run verify`.
  As built (everything but the upload, the IDs and the Studio look):
  - **Pipeline.** `art/atlases.json` `worldArt` + the "World art" section of `scripts/art/build-atlases.js`: 32 pieces
    from the full pack's `prop/` and `vfx/` in **one shared atlas**, `decor-atlas.png` (1024x609: 9 sprite sets in
    bands of whole cell rows, 23 images as `rect` cuts, MaxRects-packed), plus `decor-mote.png` (47x47, the ambient
    particle texture: a ParticleEmitter takes no ImageRect). Alpha-bled like the rest, pad 2, at the skeleton's 29.6
    px per tile (the pack's own scale). The 13 existing outputs and their `layout.ts` entries are byte-identical; the
    existing sets still read `lords-of-pain-demo/` (this checkout's copy of the full pack has only `prop/`, `vfx/`,
    `environment/`: no `enemy/` or `user interface/`), so the demo folder stays. The lock keeps its 267 entries and
    adds 83. `art:build` also fills `art/upload/` (every PNG to upload, flat, nothing else) and lists the files
    `assetIds.ts` lacks. Contact sheets: `art/build/contact/decor.<piece>.png` (outline cyan, glowAt yellow).
  - **Shadows.** Standing pieces (columns, walls, brazier, torch, barrel, crate) drop the baked shadow (pure black,
    max RGB <= 4): held to small boxes, a shadow would only shrink the body. Flat pieces keep it. `vfx/flames` drops
    its grey smoke column (max RGB < 80).
  - **Facings.** Measured on the renders, the pack's diagonals put grid edges at ~34 degrees (not ~37); this camera's
    axes are at 39.3 / 140.7, so segments drift ~0.25 tile off the grid at their ends (check in Studio). Walls and the
    torch are 4-facing sets with `zeroDeg` 45 (the pack's NE, NW, SW, SE renders); DecorController picks the facing
    from the wall normal (normals (1, 0) / (0, 1) land at 320.7 / 219.3: facings 3 / 2, 39 degrees inside their
    bins), so the torch's render points along the normal and a wall segment's render is the one at +90 degrees (the
    pack's walls run along their own facing). Columns, brazier, barrel and crate are single NE images / 1-facing sets.
  - **Outlines (theme contract).** A wall segment's cell rectangle is mostly empty corners, and the DECOR_BOX fit
    held the rectangle: segments would have drawn at 14 % of their size. New optional decor-piece fields
    `ImageAsset.outline` / `SpriteSetAsset.outlines` (per facing): the convex hull of the visible pixels, which
    `fitArtLayout` / `decorPieceLayout` now hold inside the box instead (`pointsFitScale`; DecorController passes the
    outline of the facing it draws). Walls now draw at 96-99 %, columns and the brazier whole. Validator, ThemeCore
    (`DecorArt.outlines`) and specs cover it.
  - **DECOR_BOX** (measured on the art as drawn, render px): `pillar` / `column` 18 x 52 -> **20 x 55** (column1's body
    20.0 x 54.6), `columnBroken` 18 x 26 -> **19 x 22** (column2 18.9 x 21.6). Unchanged: `brazier` 26 x 30 (body 15.1
    x 17.8; the rest is the flame's room: vfx/flames is held inside at 34 % of its size at decorFlameMaxGrow, the glow
    at 64 %), `wall` 8 x 28 and `wallBroken` 8 x 22 (fit at 0.985 / 0.96). The footprint specs pass unchanged.
  - **Breakables.** `breakableArtLayout` caps the height above the pivot, not the whole cell: the barrel's shatter
    planks land below its base and made the cell 2.3x its height (it would have drawn at 38 %).
  - **Mapping** (`packs/vale/manifest.ts`, the same art in b1..b5): pillar / column = column1, columnBroken = column2,
    wall = wall2, wallBroken = wall3, brazier = brazier (+ `lit` = brazier_lit, 8 frames; glowAt on its embers),
    torch = torch (glowAt = its cup, hung centred on the face), debris .1-.4 = bricks / rocks (2 facings each), bones
    .1-.4 = bones1-3 (+ bones1 in a second facing), moss and roots .1-.4 = mushrooms (4 facings), (gems .1-.4 = the
    four gemstones, until docs/BOOST_ART.md BA2 removed them), brokenBarrel / brokenCrate = the last `_break` frame; fx torch = vfx/flame, flame = vfx/flames, glow,
    glint (8 frames), zone (at 1/4); ambient b1-b5 = zone at 1/16, alpha stretched, white (emissive for molten and
    grim); breakable.barrel / .crate = idle + `shatter` (16 fps one-shot). `valeWorld.spec.ts` validates it with fake
    IDs (and without), `valeArt.spec.ts` fits it on real floors.
  - **Still drawn as nothing after the upload:** sarco, grave, candle, icicle, shardIce, crack, ring, bossCrystal,
    shrineCrystal and banner (no art in the pack); `gems` was mapped, but no plan source ever placed gems (the
    treasure glint sits on the pedestal), and BA2 removed the kind; `tiles` and `wall1` are not used (no decor kind for floor patches or curbs).

- [x] **R6. Far-wall dressing.** `wall2` / `wall3` segments on the far-wall runs and `column1` on corners and doorway
  jambs (layer 2 under "Walls"): a segment needs a straight run of wall tops about 4 tiles long; shorter runs get a
  column or nothing. Same footprint rule and caps as the other tall pieces.
  → Verify: in Studio the segments line up with the 3D walls under them in every room shape (rect, ellipse, oct), and
  no bullet is hidden.
  **Segments removed (owner, 2026-11-02): wall props are not decoration** (with docs/VOID_DECOR.md VDD10). planDecor's
  R6 step places only columns (back corners, doorway jambs, the middle of runs shorter than `minRunTiles`); long runs
  get none. Gone with it: `DECOR_DRESSING.segmentTiles`, `DECOR_SALT.wall` and the depth bands' `wallBrokenShare`.
  The `wall` / `wallBroken` decor kinds (contract, `DECOR_BOX`) and the vale wall2 / wall3 mapping stay but nothing
  plans them. Census (100 floors): tall 17.6 per floor (was ~25: the ~9 segments gone), torches 71.8 (cells that
  carried a segment take torches now).

- [ ] **R7. Docs.** `THIRD_PARTY_NOTICES.md` (the full pack replaces the demo entry; same licence), `art/README.md`
  (download and folder), `PROVENANCE.md` rows (web `35307022`), the `CLAUDE.md` decision log (D3; D2 is logged),
  `docs/CLIENT.md` (DecorController), `src/shared/theme/README.md` (decor slot).
  Done with R5: `THIRD_PARTY_NOTICES.md` (full pack and demo, one entry), `art/README.md` (both folders, the
  `art/upload/` step), the theme README's `outline` field. Still open: PROVENANCE, the CLAUDE.md log (D3, and R5's
  decor `outline` / `outlines` contract fields), docs/CLIENT.md.

Order: R1 needs nothing and gives the biggest visual change on its own. R2 → R3 → R4 build the system; R5 and R6
fill it with the pack's pieces.

**Also in the full pack (for `docs/ART.md`, not this plan):** the skeleton's real `idle` and `attack` (replacing
today's stand-ins), a **Slime** enemy, the **Demonlord** boss (idle, walk, two attacks, intro, laugh, death: a
candidate for `boss.act1`), and Knight / Fighter / Warrior player characters.

## Risks

- **Readability first.** Even with the footprint rule, check in Studio that no prop hides bullets or telegraphs,
  especially the snipers' warning lines.
- **Perspective.** The Lords of Pain sprites were rendered from the pack's own camera angle, not pitch 55°. Small
  props won't show it; columns might. Check in R4.
- **Near-side walls** (between the camera and the room) already hide a strip of floor; don't make them taller or busier.
- **Performance.** About 150 billboards per floor on top of the actors. They are static, so cost should be low, but
  measure on the phone emulator.

## Phase 2: dynamic decoration (planned 2026-10-25)

Phase 1 (R1-R7) dresses each floor once, from the Forge's data. Phase 2 makes the dressing change: with depth, over
time, with what happens in the run, and (the one gameplay part) breakable clutter. Owner choices (2026-10-25): extend
this plan rather than start a new one; all four parts below; breakables are **gameplay objects in the sim** (D4).

| Part | Lives in | Changes the sim, collision or a hash? |
|---|---|---|
| 1. Depth variation | `shared/view/decor` (pure) | no |
| 2. Ambient life | client (`DecorController`, `DecorFxController`) | no |
| 3. Reacting to the run | `shared/view/decor` `DecorDirector` (reads state) + client | no |
| 4. Breakable clutter | `shared/dungeon/breakables.ts` (placement) + `shared/sim/breakables/` | **yes**: endless replays and scores change, as with D2. M1, every fixture and the tutorial do not |

Parts 1-3 sit on top of R2-R4 (they pick, swap and animate what the decor plan placed). Part 4 does not need R2-R6:
it ships with placeholder Parts first and picks up the R5 art later.

### 1. Depth variation (presentation, deterministic from the floor)

- `decorProfile(floor, depth, themeKey)` in `shared/view/decor/profile.ts`; the table `DECOR_DEPTH` in `shared/config`.
  Bands by floor: **kept** (1-4), **worn** (5-9), **ruined** (10-14), **abyss** (15+). The boss floors (every 5th)
  sit on the boundaries, so each boss kill opens on a new look.
- Per band:

  | Knob | kept | worn | ruined | abyss |
  |---|---|---|---|---|
  | flat clutter share of a room's floor (R3 cap stays the ceiling, 40 %) | 20 % | 28 % | 34 % | 40 % |
  | `column1` vs broken `column2` on legal spots | 100 / 0 | 70 / 30 | 40 / 60 | 15 / 85 |
  | far-wall `wall2` (whole) vs `wall3` (broken) | 100 / 0 | 60 / 40 | 30 / 70 | 0 / 100 |
  | bones / rocks / bricks weight (x the Forge's) | 1 | 1.3 | 1.7 | 2 |
  | lit torches | 100 % | 85 % | 65 % | 45 % |
  | ambient light and particle rate | 1 | 0.9 | 0.8 | 0.7 |

  Starting values; R15 tunes them.
- Choices inside a band come from a cell hash `decorHash(floorSeed, cell, salt)` (no `math.random`), so every co-op
  client and every replay viewer draws the same floor.
- **Never touches `decorDensity` or any Forge param**: that would move the Forge rng stream and every endless layout.
  The Forge's props are the candidate set; the profile only thins, swaps and re-weights them under the R3 rules.
- Darker bands still pass the contrast rule: the validator checks enemy bullets against the floor at the darkest
  band's light level, not the default.

### 2. Ambient life (client only)

- **Flames.** Every lit torch and brazier plays `vfx/flame` / `vfx/flames` with `vfx/glow.png`, phase offset by cell
  hash so they don't pulse in step.
- **Light pool** instead of a light per torch (63 per floor): `DECOR_LIGHTS.pool` (6) PointLights reassigned to the
  lit torches nearest the camera focus, at most every `DECOR_LIGHTS.reassignSeconds` (0.25), fading in and out. The
  boss and shrine rooms keep their fixed 2-4 lights (R4, the web build's light rule). Flicker is brightness noise from a
  per-light seeded curve, scaled by `motionScale`.
- **Biome atmosphere.** The Forge themes already carry `particles` (kind, colour, count) as reference data; use it:
  one emitter volume that follows the camera focus. Ancient dust motes, molten embers rising, frost snow, grim green
  wisps, verdant spores. Rate x the depth band, x Juice settings; Reduced motion scales it to zero.
- **Treasure glint**: `vfx/glint` on the pedestal until it is taken (as built; no gemstones: they are boost drops).
- **Readability rules**: ambient particles are smaller and more transparent than any bullet (`DECOR_FX.maxSizeStuds`,
  `minTransparency`) and take colours from new `decor.fx.*` roles the validator keeps away from the enemy-bullet
  roles; `DECOR_FX.maxParticles` caps the total.

### 3. Reacting to the run (presentation, a pure director)

`DecorDirector` (`shared/view/decor/director.ts`) is built like `TutorialDirector`: `update({ state, config, events,
dt })` once per rendered frame, reading state and `LiveRun.frameEvents`, never writing the sim, returning a reused
`DecorView` (per piece: `lit`, `flare`, `dim`, `broken`; per room: `entered`, `engaged`, `cleared`). Headless specs
drive it over recorded endless runs. `DecorController` (R4) applies the view; the director is not updated while the
run is paused or a draft is open.

| Trigger (where the director reads it) | Reaction |
|---|---|
| room not yet entered (`state.endless` rooms entered) | its torches are out, braziers dark |
| first entry (`events.roomEntered`) | torches light in a sweep from the door, `DECOR_REACT.igniteStepSeconds` (0.08) apart |
| combat room engaged, then cleared (score room records) | engaged: flames burn taller; cleared: the room's braziers light (`brazier` -> `brazier_lit`) with a short warm flare |
| boss floor (the Forge's brazier ring) | dark until `bossEngaged`; one more third of the ring lights on each `bossPhase`; steady after the kill |
| stairwell opens (`state.endless`) | glow plus a `vfx/zone` ring on the stairwell |
| shrine used / pedestal taken (`state.run`) | the shrine crystal dims; the pedestal stops glinting |
| Ember (`events.emberUsed`) | every flame on screen gutters for `DECOR_REACT.emberGutterSeconds` (0.3) |
| run over (`playerDied`, all players in co-op) | lights fade to a cold palette behind the results panel |

Rules: no reaction lifts the floor above the contrast ceiling, none draws over a telegraph or the sniper's aim line,
all of them scale by `motionScale`. In co-op the director reads the shared state, so every client shows the same room
as lit.

### 4. Breakable clutter (gameplay)

Barrels and crates (the pack's `barrel`, `crate` and their 8-frame `_break` loops) stand in rooms. They block
movement and bullets and break under attacks: short-lived cover, and something to smash. Before R11, read how the web
build's Delve floor handles breakable walls at `35307022` (D3) and reuse what fits.

**Decisions, with the recommended default (confirm or change before R12):**

- **B1. Placement**: pure, in `shared/dungeon`, from its own stream `hash(floorSeed, BREAKABLE_SALT)` run after the
  Forge, so Forge layouts, digests and every other prop stay put.
- **B2. What they block**: players' and enemies' movement, and every bullet. **Not** line of sight: they are low cover,
  so a sniper still sees you and shoots the crate.
- **B3. What breaks them**: player melee, player bullets (a heavy arrow that breaks one keeps piercing; one that
  doesn't, stops), enemy bullets (cover erodes under fire), Mother Mayhem's slam (breaks everything in its radius).
  Not the Ember, not bodies.
- **B4. Toughness** (in hits, tunables in the data module): barrel 1 sword hit / 2 arrows / 4 enemy bullets; crate 2
  sword hits / 4 arrows / 8 enemy bullets.
- **B5. Reward**: score only. A new score source `BREAKABLES`, small points x floor; it does **not** feed the combo
  (no farming) and does not count toward room clear / perfect / fast. Drops (a heart or Ember) are out of v1;
  boosts from breakables are docs/BREAKABLE_DROPS.md.
- **B6. Where**: combat, elite and treasure rooms only (never entrance, shrine, boss, corridors). Per room by band:
  kept 0-2, worn 1-3, ruined 2-4, abyss 3-6 (x room area, capped). Mostly clusters of 2-4 hugging a wall, plus at
  most one lone piece as mid-room cover in combat rooms >= 10 tiles.
- **B7. Off** in the tutorial (its lessons are tuned to the current rooms), M1 and every fixture.
- **B8. Leaderboards**: nothing has shipped, so landing this before launch needs no board reset. If it lands after
  launch, bump `LB_Solo_v1` / `LB_Coop_v1`, since endless scores change.

**Placement rules** (`placeBreakables(dungeon, floorWorld, floor)`, deterministic candidate order):

- Room FLOOR cells only: not `corridor`, not `doorway`, not within `BREAKABLE.doorClearTiles` (3) of a doorway.
- Clear of every deferred spawn (`BREAKABLE.spawnClearTiles`, 1.5), the entrance spawn, the stairwell radius + 1, the
  pedestal, the shrine zone and pools. Cells taken are removed from the floor's `roomSpawnTiles`, so a spawn moved by
  the safe-spawn rule never lands inside a crate.
- No new pinch points: two solids (wall, solid pillar, breakable) either touch or leave at least
  `BREAKABLE.minGapTiles` (2) between them, so the largest enemy radius always fits round them.
- Reachability: a BFS over FLOOR minus the placed cells must reach every cell the floor's BFS reached. A candidate that
  breaks it is skipped.
- Output: `EndlessFloorWorld.breakables: ReadonlyArray<{ x, y, kind }>` (tile coordinates).

**Sim** (`shared/sim/breakables/`, opt-in like `endless`):

- `SimConfig.breakables` (tunables) plus the floor world's list -> `SimState.breakables` (per piece: kind, cell, hp,
  broken tick), rebuilt on every floor change in `stepEndless`. A cell -> slot lookup is derived from it, rebuilt on
  clone, and never hashed.
- **Hash**: a new `breakables` group appended after `tutorial`, only when present (`hashLayout.ts`, the README's group
  list). The score group gains the `BREAKABLES` source.
- **Collision without impure callbacks**: `MoveResolver`, `ActorMover`, `actorSteerMover` and `BulletBlocker` stay
  pure closures over the Dungeon and each gains an optional trailing `blocked` argument (the intact cells) that the sim
  passes from state at its call sites (`movePlayer`, `moveActor` / `walkToward`, the bullet steps). Absent, the code
  path is exactly today's. Line of sight is unchanged (B2). Steering rounds a crate the same way it rounds a pillar.
- **Damage**: `damageBreakable(state, slot, amount, source)`. `sweepArc` runs a breakables pass after actors (not an
  `enemyHit`, no combo). A bullet tests world blocking (walls, then breakables) before actors, so a crate shields the
  enemy behind it. The slam breaks by radius.
- **Events**: `breakableHits`, `breakablesBroken` and this tick's broken slots (for FX), following the existing
  events pattern.
- **Co-op and server**: deterministic, so lockstep and `SegmentedValidator` need nothing new; points go to the team
  score. Each bullet now does one extra cell lookup: re-run `replay.bench.spec.ts` against docs/SERVER.md's budget.

**Client:**

- `BreakableRenderController` (pooled, Janitor): placeholder first, a low box Part per piece (theme IDs
  `breakable.barrel` / `breakable.crate`, a colour role each, required in every pack like `enemy.dummy`, because a
  gameplay object must always be drawn). With art: the intact frame; on hit a blink and a small shake (`motionScale`);
  on break the `_break` loop once, a wood-chip burst (ParticleController), then a flat debris decal (`bricks` /
  `rocks`, cell-hashed) left on the floor.
- Audio: `sfx.breakable.hit`, `sfx.breakable.break` (silent placeholders).
- Readability: drawn no taller than `BREAKABLE_VIEW.maxHeightTiles`, so nothing hides behind one; a bullet stopped by
  a crate ends in a visible spark.

**The chest piece (treasure rooms, docs/TREASURE.md TR1 / TR2 / TR7).** A vault's chest is a third piece kind, but not a
clutter kind: shared/dungeon `BREAKABLE_PIECE_KINDS = ["barrel", "crate", "chest"]` is the sim's kind index table
(`BreakableKind.CHEST` 2), while `BREAKABLE_KINDS` (mirrored by the theme's `BREAKABLE_KINDS`, `theme/decor.spec.ts`)
stays the two clutter kinds, so no `breakable.chest` asset, role, name, look, chip or particle entry exists. The
floor build appends the chest LAST to the floor's breakables (after loot and pellets: `breakableLoot` slots and pellet
cells never include it; `roomSpawnTiles` leaves its cell) from `placeVault`'s own stream (`VAULT.salt`), against a
real wall of its combat / elite room, facing in. In the sim it is unbreakable (`CHEST_HP` 1 by kind; `damageBreakable`
returns before any bookkeeping, the melee pass and the slam skip it): it blocks movement and every bullet like any
piece (low cover), not sight, stuns a Charger and is never laid with goo. On screen BreakableRenderController gives a
chest slot no view; the treasure renderer draws it from its own `treasure.*` slot (`treasure.chest` /
`treasure.chestopen` / `treasure.cage`). The decor plan draws nothing on its cell (planDecor's `breakables` input is
the floor's full piece list), as for a crate.

**The Goldling's piece (docs/GOLDLING_RUMOURS.md GR1).** On a Goldling floor `placeGolden` appends one more barrel or
crate after the chest (the floor's last piece, `FloorGolden.piece`): an ordinary clutter kind, placed by the clutter's
cell and fit rules off pellets and the chest's front, drawn by BreakableRenderController like any crate and glinting
like a loaded one while the Goldling hides in it; only players can break it.

### Tasks

- [x] **R8. Depth profile.** (needs R3) `decorProfile`, `DECOR_DEPTH`, band swaps and thinning inside the R3 plan, the
  darkest-band contrast check, `KV_DecorBand` (force a band in Studio).
  → Verify: specs: the same floor gives the same plan; band boundaries; never over the R3 caps; the validator passes
  for every band. In Studio, `N` through floors 1-16 shows the four looks.
- [x] **R9. Ambient life.** (needs R4, R5 for the flame art) flame loops, the light pool and flicker, the biome
  emitters, treasure glint, `decor.fx.*` roles.
  → Verify: validator spec for the fx roles; in Studio every biome at every band, Reduced motion on and off; fps and
  particle counts on PC and the phone emulator written down.
- [x] **R10. Decor director.** (needs R4) `DecorDirector`, `DecorView`, the trigger table above, wired into
  `DecorController`.
  → Verify: headless specs over a recorded endless run (torches out until entry, braziers on clear, the boss ring by
  phase, stairwell glow, pause and draft freeze it); in Studio a full floor and a boss floor, solo and 2-player.
- [x] **R11. Breakable placement.** (independent; can start now) `shared/dungeon/breakables.ts`, `BREAKABLE`
  tunables, the floor world's `breakables`, the `roomSpawnTiles` filter.
  → Verify: specs: deterministic; every placement rule; reachability over the 100 census floors; counts per band;
  every Forge digest and layout fixture unchanged.
- [x] **R12. Breakables in the sim.** (needs R11) state, hash group, the `blocked` argument, damage from each source,
  events, the score source, floor rebuilds.
  → Verify: every golden fixture and M1 hash unchanged; new specs: players, enemies (steering) and bullets blocked;
  each damage source and hit count from B4; heavy-arrow pierce; slam radius; no combo, no room-clear effect; clone and
  hash; party. Re-record the endless runs (`run/slice.spec.ts`, `run/endless.spec.ts`, `run/party.spec.ts`) and check
  they replay and validate segmented. Replay bench within budget.
- [x] **R13. Breakables on screen.** (needs R12; art after R5) `BreakableRenderController`, contract IDs and
  placeholders, the sfx IDs, chips and sparks; barrel / crate and `_break` added to `art/atlases.json`.
  → Verify: validator and contract specs; in Studio crates block, take hits and break from every source on keyboard
  and gamepad; nothing hides a bullet.
- [ ] **R14. Tutorial, docs.** The tutorial world passes no breakables (its lock spec allows that one field);
  `CLAUDE.md` decision log (D4), `src/shared/sim/README.md` (module row, tick order, hash group), docs/SERVER.md
  (replay cost), docs/CLIENT.md (DecorDirector, BreakableRenderController, `KV_DecorBand`, `KV_DecorDebug`: draws
  breakable cells and decor footprint boxes).
  → Verify: `npm run verify`; the tutorial lock spec passes unchanged except for that field.
- [ ] **R15. Playtest.** Every biome at every band, solo and co-op, PC and phone emulator: readability with bullets,
  crate cheese against snipers, enemies never stuck on crates, the run's feel deeper down. Tune `DECOR_DEPTH`,
  `BREAKABLE` counts and toughness, light pool size.

Order: R11 -> R12 -> R13 can start now, alongside R2-R4 (placeholders need nothing from the decor system). R8 and R10
follow R3 / R4; R9 follows R4 and R5. R14 lands with R12; R15 last.

### Phase 2 risks

- **Replays and scores change** (R12), as with D2. Land it before launch (B8) and before recording any new golden
  endless runs.
- **Cover cheese.** A wall of crates against snipers. B3 (enemy bullets erode them) and B6 (clusters on walls, at most
  one mid-room) are the answer; check it in R15.
- **Pathing.** Enemies could snag on crates. Steering already rounds 1-tile solids (D2); the `minGapTiles` rule keeps
  gaps wide enough. The boss's charge walks plain, which is why boss rooms get none.
- **Busy screens.** Flames, particles, flares and chips all compete with bullets. The fx roles, size and transparency
  caps, and `motionScale` keep them below the bullets; judge it at the abyss band, the busiest.
- **Performance.** The light pool, emitters and per-bullet cell lookups: measure on the phone emulator (R9, R13) and
  with the server replay bench (R12).

## Secret rooms (2026-11-13)

A secret room's crack is a new inert piece kind (`crackedWall`, docs/SECRET_ROOMS.md SR2; drawn by SecretRenderController,
never as a barrel) on an outer far wall kept clear of Forge torches, banners and wall-top props; `planDecor`'s keep-out
(`DecorPlanInput.keepOut`, drop reason `secret`) puts no void piece, wall-top piece or banner on its chamber and ring.
