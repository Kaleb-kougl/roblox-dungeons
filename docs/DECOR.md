# Room decoration: plan

How to dress the vertical slice's endless floors with props: textured walls, columns, torches, braziers, floor
clutter. Work it task by task, like `PLAN.md` and `docs/ART.md`; each task ends with a **Verify**. Decoration is
**presentation only**: nothing here changes `src/shared/sim/**`, collision, or a replay hash (D2 below, now taken, was
the one exception, and it is done: endless pillars are solid walls).

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
| `gemstones_*` (4 colours) | 8 | 21x15 | | treasure-room dressing |
| `vfx/flame`, `vfx/flames` (+ glow) | 8 | 60x61 / 60x157 | flame loops | on torches and braziers |
| `environment/ground_variation1/2`, `ground_darken` | 1 | 256x256 | floor textures next to `ground_stone1` | floor variants (R1) |

No piece for crack, banner, arch, grave, sarco, candle, icicle or shardIce: those stay undrawn.

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

## Tasks

- [x] **R1. Walls and floors (materials).** `WorldController` gives wall Parts a per-biome `Material` (and floor
  variants by cell hash if they help), from a new theme field so packs choose it. Recompute the biome `wall` colour
  role from the result so the validator's enemy-bullet vs wall contrast check (>= 3:1) still describes what is drawn.
  → Verify: `npm run verify`; in Studio every biome reads, and enemy bullets stand out against walls.
  As built: optional `BiomeDef.materials { floor?, wall?, pool? }` (allow-list `BIOME_MATERIALS`, no Neon, default
  SmoothPlastic, textured floors must stay SmoothPlastic), set per biome in `vale` and applied to the merged floor /
  wall / pool Parts; the wall colour is not recomputed (`Part.Color` stays the hex, the material only adds texture, see
  the theme README), and floor variants by cell hash are skipped (greedy merging leaves no per-cell Parts).
  - [ ] Studio check: each biome reads at the game camera, and enemy bullets stand out against the textured walls.

- [ ] **R2. Decor contract.** Port the web `DECOR` slot: `decor.<group>.<...>` IDs, free-size `image` / `sprites`
  art with `layer` (flat / low / tall / wall), `pivot`, and `glow` / `emissive` flags. Use `decor.delve.b<n>.<kind>`
  (b1..b5 = biome.1..5) and `decor.fx.torch`, as on the web. Placeholder: no art means nothing is drawn.
  → Verify: validator specs; the placeholder and vale packs validate clean.

- [ ] **R3. Port `decorPlan.ts`** to `src/shared/view/decor/` (view code: it reads the Dungeon, never the sim), with
  its spec and `decor.ts`'s pure parts (fade selection, glow points). Keep the constants (`MAX_TALL_PER_ROOM` 3,
  `TALL_MIN_SPACING` 3, `MAX_DECOR_SHARE` 40 %, the footprint rule with `BULLET_Y` / `BULLET_PAD_PX`, `DECOR_BOX`),
  re-derive the pixel ones for this camera (`STUDS_PER_TILE`, the true on-screen projection from `sprites.ts`), and
  swap the Delve interactables for the slice's. Solid pillar cells (endless floors, D2) are WALL in the grid: the plan
  reads the grid, so it already treats them as walls; its `pillar` pieces must not also be placed as floor props there.
  Deterministic: the same Dungeon gives the same plan.
  → Verify: ported specs pass, plus slice cases (nothing on a pedestal, shrine, stairwell or doorway tile; no tall
  piece where a walkable cell behind it is hidden; caps hold over the census seeds).

- [ ] **R4. Decor renderer (`DecorController`).** Built on `onFloorChanged`, cleaned up with Janitor:
  - **tall and low pieces:** pooled BillboardGuis (reuse `uprightImageBillboard` and the floor-clearance offset);
  - **flat pieces:** Decals on thin floor Parts (same as the player ring);
  - **wall pieces:** billboards pushed toward the camera off the wall face (the web's `WALL_DEPTH_BIAS`);
  - **fade:** tall pieces fade out (`ImageTransparency` over ~0.15 s) when a player or the boss is behind them;
  - **light:** torches and braziers animate their flame loop; `PointLight`s only in the boss and shrine rooms,
    2-4 of them (the web's D4 rule).
  Budget: ~150 pieces per floor before caps; measure.
  → Verify: in Studio, a full endless run through every biome: no bullet is ever hidden, fps and texture memory
  written down on PC and the phone emulator.

- [ ] **R5. Art.** Point the pipeline at `art/vendor/lords-of-pain/` (regenerate `art/vendor.lock.json`; existing
  atlases come out byte-identical), add the props to `art/atlases.json` (grid-aligned facing for walls, columns, tiles
  and crates; hash-picked facings for round pieces; 8-frame flame and brazier loops), build, upload, paste the IDs into
  `assetIds.ts`, map them to `decor.*` IDs in the `vale` manifest. Drop `art/vendor/lords-of-pain-demo/` once nothing
  reads it.
  → Verify: contact sheets by eye; `npm run verify`.

- [ ] **R6. Far-wall dressing.** `wall2` / `wall3` segments on the far-wall runs and `column1` on corners and doorway
  jambs (layer 2 under "Walls"): a segment needs a straight run of wall tops about 4 tiles long; shorter runs get a
  column or nothing. Same footprint rule and caps as the other tall pieces.
  → Verify: in Studio the segments line up with the 3D walls under them in every room shape (rect, ellipse, oct), and
  no bullet is hidden.

- [ ] **R7. Docs.** `THIRD_PARTY_NOTICES.md` (the full pack replaces the demo entry; same licence), `art/README.md`
  (download and folder), `PROVENANCE.md` rows (web `35307022`), the `CLAUDE.md` decision log (D3; D2 is logged),
  `docs/CLIENT.md` (DecorController), `src/shared/theme/README.md` (decor slot).

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
