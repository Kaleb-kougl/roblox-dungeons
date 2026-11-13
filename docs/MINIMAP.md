# Minimap with fog of war: plan

Status (2026-10-27): **M1-M10 and M12 code-complete, verified headlessly only** (typecheck, lint, asset check, art
tests, build, full Lune suite: every spec passing except `forge.spec.ts`'s NaN-bit vector, which fails the same way on
`main` under x86_64 Lune). **Nothing has run in Studio**: the M0 spike, the Studio check and M11 are pending. Planned
against `main` @ `d627bf4` (game feel merged). Adds a small
map in the bottom-right corner and a full-floor map on a toggle, both covered by a fog of war that lifts as the party
explores. Presentation only: no sim, dungeon layout, lockstep, hash, replay or fixture change. Every dungeon floor: M1,
endless and the tutorial (not the greybox, which has no rooms). Owner answers (2026-10-27): reveal by sight plus the
whole room on entry (MD2), one shared party map in co-op (MD3), the stairwell stays hidden until someone sees it (MD4),
a full map on a toggle key and in the pause overlay (MD5). Owner answers to the open questions (2026-10-27): start at
about 35 tiles across and tune in M11 (MD12), the minimap shows from the first tutorial floor (MD13), boost drops in
sight show on the map (MD14). 2026-11-01: the tutorial now teaches the full map (step `map`, docs/TUTORIAL_MAP.md),
superseding MD13's "no lesson" half.

## Why

- **Endless floors are big now.** `roomScale` 2 makes every endless room twice as wide and tall (4x the floor area)
  and floors have 12-16 rooms, but the camera shows about 30 x 17 tiles (`RENDER_W` / `RENDER_H` 480 x 270 at 16 px
  per tile). Finding the stairwell, or the one room that is still waiting, means backtracking from memory.
- **Nothing shows where you have been.** Room edges (docs/ROOM_EDGES.md) tint a room safe / waiting / live, but only
  on screen. There is no record of which corridors are explored and which doorways lead somewhere new.
- **Co-op has no "where is my teammate".** Spectating (docs/SPECTATE.md) follows a teammate after you die; while you
  are alive, a teammate off screen is simply gone.
- **The fog is what makes it a map.** A full floor plan from the start would give away the layout and the stairwell.
  The fog turns exploring into progress you can see.

## Player experience (target)

- **Corner minimap.** A square panel in the bottom-right corner (empty during play since HUD_LAYOUT.md HD6), about
  35 tiles across, centred on the watched player and **turned to match the camera** (the camera's 45 degree yaw), so
  pushing up on the stick moves the arrow up on the map (MD6). Plain top-down: no pitch squash.
- **Three fog states per tile.**

  | State | When | Look |
  |---|---|---|
  | **unknown** | nobody in the party has seen it | not drawn (panel background) |
  | **remembered** | seen before, not in sight now | dim floor / wall colours |
  | **in sight** | a living party member can see it now | full floor / wall colours; enemies drawn here only |

- **How the fog lifts (MD2).** Each living player sees in a radius (`sightTiles`, starting at 10) and walls block it,
  solid pillars included. Pools and breakables do not block sight. Looking down a corridor reveals the corridor;
  looking through a doorway reveals the part of the room you can see. **Stepping into a room** (the tile test
  `roomIdAt` uses) reveals the whole room and its wall ring at once, so a 2x endless room never has to be painted in by
  walking it.
- **Shared party map (MD3).** In co-op, anything any living teammate sees is revealed for everyone, and dead players
  (spectating) keep seeing the party's map. Each client computes it from the shared sim state, so all clients show
  practically the same map (MD9 says why it is not bit-exact).
- **Markers** (drawn over the map, upright, never turned):
  - the watched player: an arrow pointing where they face;
  - teammates: a dot in their class colour (`class.*` roles, which the theme already reserves for "minimap dots");
    a dead teammate as a hollow ring where they fell;
  - enemies: small dots, **only on tiles in sight** (so the map is no radar through walls); the boss a larger mark;
  - the stairwell (endless), once its tile has been seen (MD4): closed and open looks (`stairsOpen`);
  - treasure / shrine rooms: a small mark once the room is seen;
  - boost drops (`state.drops`), only on tiles in sight (MD14): a small glint in `minimap.boost`.
- **Room state on the map.** Seen rooms take the room-edge state (`RoomEdgeStates`: waiting / live / safe) as a tint
  on their floor, so the map shows which rooms are still to clear.
- **Unexplored exits stand out.** A seen floor tile next to an unknown floor tile (a "frontier") is drawn brighter, so
  the doorways and corridor ends that lead somewhere new are easy to spot.
- **Full map (MD5).** Press **M** (pad: **D-pad left**) to toggle a large, see-through map of the whole floor in the
  middle of the screen. Play goes on underneath (co-op cannot pause); the corner minimap hides while it is open. It
  closes on the run-over panel, a floor change, or the key again. The solo pause overlay shows the same map beside its
  menu.
- **A new floor** starts with a fresh fog. The fog is never saved.
- **Options > Display > Minimap** (On / Off, default On) hides the corner minimap; the full map key still works.
- The corner panel joins the HUD's occlusion fade (HUD_LAYOUT.md HD7): when the player, an enemy or a bullet passes
  under it, it fades like the other corner panels.

## Design

### 1. Map tiles (`shared/view/minimap/tiles.ts`, new; pure)

```ts
export const MapTile = { NONE: 0, FLOOR: 1, WALL: 2, POOL: 3 } as const;
export interface MinimapTiles {
	readonly W: number; readonly H: number;
	/** MapTile per cell, y * W + x. WALL only where the wall touches FLOOR / POOL (8-neighbour), else NONE. */
	readonly tile: ReadonlyArray<number>;
	/** Cell indices per room id (FLOOR / POOL cells with that roomId, plus their wall ring), fixed order. */
	readonly roomCells: ReadonlyArray<ReadonlyArray<number>>;
	/** Room type per room id (marks for treasure / shrine), the stairwell cell (endless) or -1. */
	readonly roomType: ReadonlyArray<RoomType>;
	readonly stairCell: number;
}
export function minimapTiles(d: Dungeon, stairwell?: WorldXZ): MinimapTiles;
```

Built once per floor from `RunContext`'s `Dungeon` (`grid`, `roomId`, `rooms`) and, on endless floors, the
`EndlessFloorLayout.stairwell`. Solid pillars are already WALL in `grid`, so they draw as walls and block sight with no
special case. Walls deep inside rock are never drawn, so the map reads as outlines, not blocks.

### 2. Sight (`shared/view/minimap/sight.ts`, new; pure)

`shadowcast(tiles, ox, oy, radius, visit)`: symmetric recursive shadowcasting on the grid (8 octants), blocking on
WALL and NONE, calling `visit(cellIndex)` for every lit cell including the walls that stop it. Symmetric, so if A sees
B then B sees A, and no light leaks through diagonal wall corners. About `pi * r^2` cells per call (~314 at r = 10).
Plain integer maths, no trig, no allocation per call (reused stacks).

Why not the sim's `lineOfSight`: a DDA per cell would cost a ray per tile in the radius every step, and the sim's
version is tuned for bullets (it ignores pillar corners the way bullets do). The map only needs a believable "you can
see this", not the sim's exact rule, and it never feeds back into play.

### 3. Fog (`shared/view/minimap/fog.ts`, new; pure)

```ts
export const FogState = { UNKNOWN: 0, REMEMBERED: 1, IN_SIGHT: 2 } as const;
export class FogOfWar {
	constructor(tiles: MinimapTiles);
	/** One update: sources are the living players' world positions. Marks changed cells dirty. */
	update(sources: ReadonlyArray<WorldXZ>): void;
	/** Reveal the whole room (its cells + wall ring) as REMEMBERED (or IN_SIGHT if lit this update). */
	revealRoom(room: number): void;
	/** Late attach (co-op client joining a run in progress, a run started at tick > 0): rooms already entered. */
	seedFromState(state: Readonly<SimState>): void;
	state(cell: number): number;
	/** Cells whose state or frontier flag changed since the last drain (reused array). */
	drainDirty(): ReadonlyArray<number>;
	isFrontier(cell: number): boolean;
}
```

- **When it recomputes.** Per source, only when its tile changes (standing still costs nothing). When a source moved
  more than one tile since its last update (several sim ticks in one frame, a roll), the cells on the tile line from
  the old tile to the new one are lit too, so nothing is skipped. A teleport (floor change, respawn) skips the line.
- **In sight -> remembered.** Each update clears last update's lit set back to REMEMBERED and lights the new one; only
  cells that changed are marked dirty (a step lights a ring of ~60 new cells and dims ~60).
- **Rooms.** A source whose tile has `roomId >= 0` reveals that room once (`revealRoom`); the same test the endless
  spawn and room edges use, so the room appears on the map the instant its enemies do.
- **Frontier.** A FLOOR / POOL cell that is not UNKNOWN with an UNKNOWN FLOOR / POOL 4-neighbour. Recomputed only for
  dirty cells and their neighbours.
- **Late attach.** `seedFromState` reveals every room with `endless.roomsEntered[r] === 1`, every scored room with
  `engageTick >= 0`, and the boss room once the boss has woken. Corridors are not recovered (MD10).

### 4. Map transform (`shared/view/minimap/transform.ts`, new; pure)

`minimapBasis(yawDeg)` and `worldToMap(basis, x, z, centreX, centreZ, pxPerTile) -> (u, v)` in map pixels, the map's
up being the camera's screen up on the ground plane (from `isoBasis` in shared/view/iso.ts, with the pitch dropped).
The map image is drawn in grid space and turned by the yaw as a whole (`Rotation` on the ImageLabel); markers are
placed with `worldToMap` and stay upright. One spec pins the rule a player feels: the world direction the Up input
moves the player maps to straight up on the map, and Right to straight right.

### 5. Paint (`shared/view/minimap/paint.ts`, new; pure)

`paintCells(tiles, fog, roomLook, palette, cells, buf)`: writes RGBA8 pixels (one pixel per tile) for the listed cells
into a Luau `buffer` of `W * H * 4` bytes. Colour per cell: tile kind x fog state, room tint mixed on room floor cells
(`MINIMAP_VIEW.roomTintMix`), the frontier brightened, UNKNOWN fully transparent. `paintAll` fills the whole buffer
(floor start, late attach, palette change). Headless: the spec reads pixels back with `buffer.readu8`.

### 6. Tunables and theme

`MINIMAP_VIEW` (`shared/view/minimap/config.ts`), starting values for M11:

| Name | Value | Meaning |
|---|---|---|
| `sightTiles` | 10 | sight radius of each living player (the screen reaches 8.4 tiles up, 15 across) |
| `panel` | 140 x 140 ref px, bottom right | the corner box (section 7) |
| `pxPerTile` | 4 (ref px) | corner zoom: 35 tiles across |
| `fullMap` | fits 70 % of the safe area's height, transparency 0.25 | the toggle overlay |
| `rememberedDim` | 0.45 | remembered cells' colour scale |
| `roomTintMix` | 0.1 (was 0.35; shared/theme `MINIMAP_ROOM_TINT_MIX`) | how much the room state tints a seen room's floor |
| `markers` | self arrow 9 px, teammate 7, enemy 4, boss 9, stairs 9, boost 5 (ref px) | |
| `writeHz` | 15 | most pixel uploads per second (dirty cells batch between them) |
| `markerPool` | 64 | enemy dots; more enemies in sight than this draw the nearest |
| `frontierMix` | 0.6 | how far a frontier cell's colour moves toward `minimap.frontier` (M5) |
| `teleportTiles` | 8 | longest source jump (tiles, Chebyshev) whose tile line is filled; longer is a teleport (M3) |
| `maxImageSide` | 1024 | largest grid side the map image may have; the M1 census asserts every floor fits |

Theme (contract + both packs): colour roles `minimap.floor`, `minimap.wall`, `minimap.pool`, `minimap.frontier`,
`minimap.self`, `minimap.enemy`, `minimap.boss`, `minimap.stairs`, `minimap.boost` (`MINIMAP_ROLES`, required).
Validator `minimapReport`: self / enemy / boss / stairs / boost >= 3:1 on `minimap.floor` and on `uiPanel` (the unknown background);
`minimap.enemy` >= 40 CIE76 from `minimap.self`, `minimap.boost` and every `class.*` role, so a hostile dot never
reads as a teammate or a pickup.
Room tints reuse `roomEdge.*`; teammates reuse `class.*`. Markers are plain Frames (UICorner circles, a rotated square
for the arrow): **no new images** in v1 (MD8). Strings: `options.display.minimap` ("Minimap"),
`hud.map.title` ("Map"), `hud.map.hint` ("M map" / "D-pad left map", from the binding).

### 7. HUD footprint

`minimap` joins the always-on panels (`ALWAYS_ON_PANELS`, `HUD_FOOTPRINT`, corner `bottomRight`, 140 x 140):

- **Clear zone.** A box is outside `HUD_CLEAR_ZONE` when it is clear of it on either axis. The worst case is ten-foot
  at 16:9 (scale 1.25 per reference px): width + margin must stay within 25 % of the width, so up to 240 ref px wide.
  140 passes on every `HUD_TEST_VIEWPORTS` entry.
- **Cover share.** Today's three boxes cover about 9.7 % of the 1280 x 720 safe area; 140 x 140 adds 2.1 % (11.9 %).
  Under the Roblox top bar the 844 x 390 phone reaches 14.0 %, so the cap rose 0.12 -> 0.145 (MD7, owner).
- **Verdict line.** The transient verdict / notice box (bottom right, 480 x 60) moves up by the minimap's height plus
  `HUD_VIEW.gap`, so it never lands on the map (the spec already checks transient vs always-on boxes).
- **Occlusion fade.** The panel registers with `HudOcclusionController` under its corner like the others.

### 8. Client

- **`MinimapController`** (`src/client/controllers/ui/MinimapController.ts`, new). `sim.onRunStarted` /
  `sim.onFloorChanged`: Janitor cleanup, then (dungeon floors only) `minimapTiles`, a `FogOfWar`, a buffer and one
  `EditableImage` of `W x H` (`AssetService:CreateEditableImage`), shared by the corner map and the full map through
  `Content.fromObject` (one image, two ImageLabels, `ResampleMode.Pixelated`). Render step `KV_Minimap` after the
  camera: fog update from the living players' positions (interpolated like the camera), `drainDirty` -> `paintCells`
  -> `WritePixelsBuffer` (at most `writeHz`), re-centre the map image on the view player
  (`SimController.getViewPlayerIndex()`), place the marker pool. The `EditableImage` is destroyed with the floor.
- **Clipping.** `ClipsDescendants` does not clip rotated children, so the turned map sits in a `CanvasGroup` sized to
  the panel (which does). M0 checks the look and cost; the fallback is section 9.
- **Panel shell** (`client/ui/hud/MinimapPanel.tsx`, new): the React corner `Panel` (corner `bottomRight`) with the
  CanvasGroup; the controller drives its contents imperatively through a ref (nothing per frame goes through Reflex).
  Hidden when Options > Display > Minimap is Off, on the greybox, and while the full map or the run-over panel shows.
- **Full map** (`client/ui/hud/FullMapOverlay.tsx`, new): unturned or turned like the corner map (same rule), fitted to
  `MINIMAP_VIEW.fullMap`, the whole floor, markers on top; toggled by the new `map` action; the PauseOverlay embeds the
  same view.
- **Input.** A new rebindable `GameAction` `"map"` with **no sim button** (like `restart` / `leaderboard`, not in
  `ACTION_BUTTONS`): keyboard `M`, pad `DPadLeft` (free today). `M` is reserved for the debug drop key, so
  `KEYBOARD.debugDrop` moves to a new debug key and the reserved list swaps `M` for it (MD11). Old settings documents
  have no `map` binding and read the default (`sanitizeControlsOverrides` already fills missing actions).
- No remote, DataStore schema, sim or lockstep change.

### 9. Fallback renderer (only if M0 says so)

If `CreateEditableImage` fails (the device's memory budget, or the experience setting that allows the image APIs is
off) or the CanvasGroup looks wrong: a screen-space map. A small `EditableImage` the size of the panel (e.g. 72 x 72),
re-sampled from the fog grid in screen orientation `writeHz` times a second (nearest tile per pixel, ~5k pixels per
write), so no rotation or clipping is needed. If even that cannot be created, the panel hides and warns once; the
game is unaffected.

### Not changed

The 3D view: there is no fog on the playfield, and enemies, rooms and doorways show on screen exactly as today. Room
edges, the tutorial arrow, spectating and scoring are read, never changed. No web parity is touched (port-only, no
PROVENANCE row).

## Tasks

- [ ] **M0. Studio spike.** A throwaway `KV_SpikeMinimap` (Workspace attribute, off by default, Janitor): a 160 x 140
  `EditableImage` of a real endless floor, turned 45 degrees in a CanvasGroup, pixelated, scrolling with the player.
  Record in docs/SPIKES.md: does it create in a published test place and on the phone emulator; the image-API setting
  it needs; the look (crisp diamonds vs. shimmer while scrolling); the frame cost of one full `WritePixelsBuffer`.
  Decide section 8 vs section 9.
- [x] **M1. Tiles + census.** `minimapTiles` + spec on hand-made dungeons (a rect room, a pillar, a pool, a corridor:
  walls only where they touch floor; room cells include the wall ring). On real floors (the three M1 fixtures, endless
  run seeds 1-60 x floors 1-20, both tutorial floors): print the largest `W x H` (must be <= 1024 per side), the most
  cells per room, and check every FLOOR cell with `roomId >= 0` is in exactly one `roomCells` list.
  -> Verify: `npm run verify`.
  As built: `shared/view/minimap/tiles.ts` (barrel `shared/view/minimap`, re-exported from `shared/view`), 8 tests
  (`tiles.spec.ts`; hand-made grids from `minimap/testing`, also two rooms sharing a wall and the stairwell cell).
  `MinimapTiles` gained `room` (per cell, exactly `roomIdAt`: room id on FLOOR cells, `MAP_NO_CELL` = -1 elsewhere, so
  room pools are listed in `roomCells` but are not "in the room" for the source test) and `bossRoom` (`Dungeon.boss`,
  for the late attach); a wall between two rooms is in both lists; lists ascend by cell index. Census: largest endless
  grid 181 wide / 179 high (largest area 166 x 156, run 41 floor 18), M1 at most 77 x 71, tutorial 86 x 71: far under
  1024 (`MINIMAP_VIEW.maxImageSide`). Most cells per room (floor + pool + ring): 1518 endless (run 2 floor 4), 1070
  tutorial floor 2, 434 M1. The stairwell (run 1, floors 1-20, through `endlessRunFloor`) is FLOOR in the boss room on
  every floor. All 1200 endless floors, about 112 s (generation dominates, like the room-edge census); since
  2026-11-12 in four shards `tiles.endless.<n>.spec.ts` (`minimap/testing/census.ts`), about 50 s each.
- [x] **M2. Sight.** `shadowcast` + spec: open field (a disc of the radius), a wall blocks what is behind it, a
  1-wide doorway shows a cone, symmetry (A sees B iff B sees A over random grids), no leak through diagonal wall
  corners, pools and breakables do not block, solid pillars do, radius 0.
  As built: `sight.ts`, `class Shadowcaster { cast(tiles, ox, oy, radius, visit): number }` (Albert Ford's symmetric
  shadowcasting, iterative with a reused row stack, slopes as integer numerator / denominator) plus `shadowcast(...)` on
  a module-wide instance and `blocksSight(tile)`. Each lit cell is visited exactly once (diagonal cells, scanned by two
  quadrants, are de-duplicated with per-call stamps), the origin first. Ford's rules alone let light through diagonal
  wall corners (each quadrant ignores the walls just past its 45 degree line), so one rule was added: a transparent
  cell whose neighbour one row back and neighbour one column in both block is "pinched" (reachable only through a
  corner point): dark, and it blocks like a wall. Symmetry still holds: 24 seeded random 15 x 15 grids (walls, pools,
  void), 347,564 open pairs at r = 8, no asymmetric pair. 10 tests (`sight.spec.ts`): the r = 10 disc is exactly 317
  cells; a real endless floor (run 1337 floor 1: 25 breakables on FLOOR, 70 pillars on WALL).
- [x] **M3. Fog.** `FogOfWar` + spec: standing still makes no dirty cells; a step dims and lights rings; a 5-tile jump
  lights the tiles between; entering a room reveals all its cells the same update; two sources reveal their union;
  dead players are not sources; frontier on a corridor end and cleared when the far side is seen; `seedFromState` on
  an endless state with rooms entered; a floor change resets. Run the endless bot over floor 1 of run 1337 and print
  the share of floor cells seen at the stairwell.
  As built: `fog.ts`. `update(sources: ReadonlyArray<FogSource>)` with `FogSource = WorldXZ | false`: one entry per
  party slot (index = player index), `false` for a dead / absent player (not `undefined`: the Luau array must stay
  dense; entries past the end are absent). Each slot keeps its last tile and lit list; a per-cell lit count merges the
  slots, so a cell two players see stays in sight when one leaves. A jump of 2..`teleportTiles` (8, Chebyshev) casts
  from every open tile on the Bresenham line between (those cells become at least REMEMBERED; rooms on the line are
  revealed); longer jumps and a slot's first tile skip it. Additions: constructor options `{ sightTiles, teleportTiles }`
  (tests; defaults from `MINIMAP_VIEW`), `reset()` (back to all UNKNOWN, every changed cell dirty; the client may just
  build a new FogOfWar per floor), `roomRevealed(room)`, and the `MinimapFogView` interface (`state` / `isFrontier`)
  the painter reads. `seedFromState` reveals the boss room (`MinimapTiles.bossRoom`) when any boss actor has phase > 0.
  `drainDirty` returns a reused array (two lists swapped). The frontier only changes around cells that left UNKNOWN,
  so dirty cells include frontier flips (one step at r = 5 in an open field: 11 dimmed, 11 lit, 20 frontier flips).
  Bot (run 1337 floor 1, 1236 ticks to the stairwell): 3731 of 4913 floor cells seen (75.9 %), 8 of 12 rooms revealed,
  the stairwell seen; 0.06 ms per update on average (most updates have no tile change). 10 tests (`fog.spec.ts`).
- [x] **M4. Transform.** `minimapBasis` / `worldToMap` + spec: the Up / Right input directions (shared/play's move
  mapping under the 45 degree yaw) land straight up / right on the map; the view player maps to the panel centre;
  round trip within 1e-9.
  As built: `transform.ts`. `minimapBasis(yawDeg)` = { rightX, rightZ, upX, upZ, rotationDeg }: right (cos, -sin) and
  up (-sin, -cos) in world (x, z), exactly isoBasis right and forward on the ground; `worldToMap` / `mapToWorld` take an
  optional reused out point (u right, v DOWN, pixels from the centre). For the grid-space image: `gridImageLayout(basis,
  W, H, centreX, centreZ, pxPerTile)` gives its centre (from the map centre), unturned size (W x H x pxPerTile) and
  `rotationDeg` = the yaw (GuiObject.Rotation: clockwise, about the centre; AnchorPoint 0.5, 0.5), and
  `gridCellToMap(layout, gx, gy)` places a cell through it; the spec checks it equals `worldToMap` of the cell centre
  for five yaws. The Up / Right / Down / Left keys go through `mapDevicesToInput` (quantized) and land within 2e-3 of
  straight up / right / down / left. 6 tests (`transform.spec.ts`).
- [x] **M5. Paint.** `paintCells` / `paintAll` + spec: every tile kind x fog state, the room tint, the frontier,
  unknown = alpha 0, only listed cells touched.
  As built: `paint.ts`. Palette and room looks are plain 0..1 RGB (`MinimapRgb { r, g, b }`, Color3's channels):
  `MinimapPalette { floor, wall, pool, frontier }`, `MinimapRoomLook = ReadonlyArray<MinimapRgb | undefined>` per room
  id (only indexed, so holes are fine). Order: kind colour -> room tint (`roomTintMix`, on `MinimapTiles.room` cells,
  i.e. room FLOOR, not room pools) -> frontier (`frontierMix` 0.6 toward `minimap.frontier`) -> remembered x
  `rememberedDim`; alpha 255; NONE and UNKNOWN write 0 (one `writeu32`). Helpers `minimapBufferSize`,
  `createMinimapBuffer`, `channelByte`. A room's look change repaints `paintCells(..., tiles.roomCells[room], buf)`.
  6 tests (`paint.spec.ts`).
- [x] **M6. Theme.** `MINIMAP_ROLES` in the contract, values in the placeholder and vale manifests, `minimapReport`
  + spec (both packs pass; an enemy dot coloured like `class.ranger` fails). New strings in both packs.
  As built: also `MINIMAP_MARKER_ROLES` / `MINIMAP_MARKER_BACKGROUNDS` / `MINIMAP_ENEMY_DIFFERENCE_ROLES`,
  `MIN_MINIMAP_MARKER_CONTRAST` 3.0 and `MIN_MINIMAP_ENEMY_DIFFERENCE` 40 (`theme/minimap.spec.ts`); vale inherits the
  placeholder's colours and strings (no change). Placeholder values, measured: floor `#36342f`, wall `#7a7466`, pool
  `#2c4a63`, frontier `#8f8462`, self `#f4f1ea` (11.02:1 on floor / 15.00:1 on uiPanel), enemy `#ff2e2e` (3.36 / 4.58;
  CIE76 >= 42.6, nearest `class.pyromancer`; the outline's `#ff3b30` would be 39.4), boss `#ff9a5a` (5.93 / 8.08),
  stairs `#7fd6ff` (7.68 / 10.45), boost `#ffc83d` (8.04 / 10.94). Tiles on uiPanel (not validated): floor 1.36:1,
  wall 3.64:1, pool 1.83:1; frontier 3.34:1 on floor. Strings: `options.display.minimap`, `options.action.map`
  ("Map", the rebind row), `hud.map.title`, `hud.map.hint` ("{key} map", key from shared/play `mapHint`);
  `HUD_STRINGS.mapTitle` / `mapHint`, `OPTIONS_STRINGS.minimap`. `view/hud/hud.spec.ts`'s Options-string count went
  28 -> 29.
- [x] **M7. Footprint.** The `minimap` always-on box, the verdict box moved, `footprint.spec.ts` passing on every test
  viewport x HUD scale x ten-foot (print the cover share; shrink the panel if any case exceeds 12 %).
  As built: **140 x 140 does not fit.** The spec checks the cover share with the Roblox top bar too
  (`HUD_TEST_TOP_INSET`): 140 x 140 gives 12.9 % at 1280 x 720 and 14.0 % on the 844 x 390 phone (whose HUD scale
  clamps at 0.6), and the phone with the bar leaves room for a 61.7 px square at most. Per MD7 the panel shrank:
  `MINIMAP_PANEL` = 60 x 60 (`view/hud/minimapHud.ts`; 15 tiles across at `pxPerTile` 4), worst cover 12.0 % (phone +
  bar), 10.1 % at 1280 x 720. To revisit in M11 (a higher cap, a per-viewport size, or a smaller `pxPerTile`);
  `MINIMAP_VIEW.panel` (140 x 140) must follow whichever wins. `VERDICT_BOX.edge` = margin + minimap height + gap; the
  client's `InfoPanel` still sits at the corner until M8 moves it. `ALWAYS_ON_PANELS` count 3 -> 4; no client change
  was needed (`HudOcclusionController` iterates the list; its footprint check skips a corner with no panel).
  Superseded by MD7 (owner, 2026-10-27): back to 140 x 140 with the cap at 0.145 (see M8's as-built note).
- [x] **M8. Client: corner map.** `MinimapController`, `MinimapPanel`, occlusion registration, marker pool. Docs: a
  row in docs/CLIENT.md's controller table. -> Verify: `npm run verify`, then the Studio check.
  As built (**Studio check pending**; nothing client-side runs headlessly): first MD7 (owner): `MINIMAP_PANEL` is
  `MINIMAP_VIEW.panel` (minimapHud.ts imports the minimap config; no cycle), 140 x 140, `maxCoverShare` 0.145;
  footprint.spec.ts prints the worst cover, 14.03 % (844 x 390 under the bar); ten-foot stays informational as before
  (20.1 % at 1280 x 720 TV under the bar; its 1.25 boost already put the older three boxes at 16.5 %).
  `client/controllers/ui/MinimapController.ts` per floor (run start / floor change, floor Janitor; no `ctx.dungeon` =
  greybox: no map): `minimapTiles(d, ctx.endlessFloor(ctx.floor).layout.stairwell)` (endless and tutorial floors), a
  new `FogOfWar` (`seedFromState` when attached at tick > 0), `RoomEdgeStates` built like RoomEdgeController (unscored:
  `buildScoreRooms` fallback), `paintAll`, then `AssetService:CreateEditableImage({ Size })` in a pcall (failure: one
  warning, Reflex `game.map.available` stays false, every map view hides; TODO M0 for the §9 fallback), destroyed by the
  floor Janitor. Hosts are a ref registry (`client/ui/hud/minimapHosts.ts`: `corner`, `full`, `pause`, like
  cornerFade); the controller builds a `MapLayer` (ImageLabel with `Content.fromObject(image)`, `Pixelated`,
  `gridImageLayout` size / rotation / position, plus the marker pool) in every mounted host and rebuilds it if React
  replaced the host. Clipping: the corner `Panel` is already a CanvasGroup (the occlusion fade's), so the map host sits
  in it with padding 0 and the group cuts the turned image; no second CanvasGroup. `Panel` gained `visible` so the
  corner panel hides without unmounting (its layer survives an Options toggle); HudOcclusionController skips an
  invisible corner frame. Render step `KV_Minimap` (Camera + `viewsAfterCamera`): sources per player index
  (interpolated, `false` when `dead` or `party.left`), room looks from `ROOM_EDGE_ROLES[state]` (a room's
  `roomCells` repainted on a state change), dirty cells `paintCells`, `WritePixelsBuffer` at most `writeHz` and only
  when pending (a failed write warns once and drops the map). Markers (Frames: UICorner dots, turned squares, UIStroke
  for hollow ones): the watched player's arrow (a square turned to facing - 45 deg plus a nose square
  `selfNoseOffset` ahead), teammates in `MINIMAP_VIEW.teammateRoles[index % 5]` (the `class.*` roles: the party has
  no per-player class, every player is the vanguard, so the index picks a stable colour), dead teammates hollow where
  they fell, departed ones not drawn; enemies on IN_SIGHT cells, bosses (`data.boss`, also in sight only) first and
  bigger in `minimap.boss`, then nearest to the watched player, capped at `markerPool`; boost drops in sight
  (`state.drops.ground`, `NO_BOOST` skipped); the stairwell once its cell is not UNKNOWN (filled when
  `endless.stairsOpen`, hollow while closed); treasure / shrine marks (room centre) once `fog.roomRevealed`, in
  `roomMarkRoles` (`decor.fx.glint` / `fx.curse`: no minimap role of their own). New `MINIMAP_VIEW` entries:
  `markers.room` / `ringStroke` / `selfNose` / `selfNoseOffset`, `teammateRoles`, `roomMarkRoles`.
  `client/ui/hud/MinimapPanel.tsx`: the corner Panel (bottomRight, `MINIMAP_PANEL`, padding 0) around the host,
  visible per `cornerMapShown` (a map on this floor, `DisplaySettings.minimap`, full map closed, run playing). The
  InfoPanel is no longer a corner panel: placed `VERDICT_BOX.edge` above the safe area's bottom.
- [x] **M9. Full map + input.** The `map` action (bindings, defaults, the rebind panel row, debug key move with its
  spec cases), `FullMapOverlay`, the pause overlay's map, the hint string.
  As built, overlay part (**Studio check pending**): Reflex `game.map { available, open }` (`setMapView`,
  `selectMapView`; reset by `startRun` / `endRun`). `onMapAction` toggles `open` (opening needs an active, playing run
  and no panel open; closing always works); the controller closes it on a floor change (rebuild) and when the run is
  over, the store on run exit. `client/ui/hud/FullMapOverlay.tsx`: `FullMapOverlay` (KV_GameHud) a centred host
  `fullMap.heightShare` of the safe area's width and height, uiPanel backdrop at `fullMap.transparency`, title
  `hud.map.title` above, hint `hud.map.hint` (`mapHint(bindings)[device]`) below; it steps aside while a solo run is
  paused. `PauseMap` in the solo PauseOverlay (KV_GameMenu): the same host left of the menu panel. Both draw a second
  MapLayer on the same EditableImage content, image at `fullMap.transparency`, centred on the floor, px per tile
  fitted so the yaw-turned W x H bounding box (W|cos| + H|sin| by W|sin| + H|cos|) fits the host (AbsoluteSize / the
  ScreenGui's UIScale), markers as on the corner map. The corner map hides while the full map is open.
  Review fixes (2026-10-27):
  - **Contrast on tinted floors.** Every seen room floor is mixed toward its `roomEdge.*` colour, and `roomEdge.live`
    is near white, so at the old 0.35 the enemy dot `#ff2e2e` was 2.58 / 1.89 / 1.23:1 on safe / waiting / live
    floors. The mix now lives in shared/theme (`MINIMAP_ROOM_TINT_MIX` 0.1, `MINIMAP_TINT_ROLES` = the room-edge roles;
    `MINIMAP_VIEW.roomTintMix` reads it) with one helper pair (`mixChannel` / `channelToByte`, `mixRgb`) used by both
    paint.ts and `minimapReport`, which now also holds every marker to 3:1 on `minimap.floor` mixed with each tint role
    (entries `minimap.floor+roomEdge.<state>`). A dark stroke alone could not rescue the mid-luminance red (the waiting
    floor is mid grey, so neither the fill nor a black edge reached 3:1), so `minimap.enemy` was retuned to `#ff5880`
    (a light crimson, 42.5 CIE76 from the nearest class colour, pyromancer). Placeholder / vale, floor / uiPanel /
    safe / waiting / live: self 11.02 / 15.00 / 10.22 / 9.33 / 8.23, enemy 4.12 / 5.61 / 3.82 / 3.49 / 3.08, boss
    5.93 / 8.08 / 5.50 / 5.02 / 4.43, stairs 7.68 / 10.45 / 7.12 / 6.50 / 5.73, boost 8.04 / 10.94 / 7.46 / 6.81 / 6.00.
    Enemy, boss, open-stairwell and boost marks also get a 1 px dark edge (`markers.outline`, `outlineRole` uiPanel);
    the validator does not count it (the fills pass on their own). Not checked: frontier cells (mixed 0.6 toward
    `minimap.frontier`), where an enemy dot is about 1.3:1; they are one tile wide at the edge of the unknown (M11).
  - **Opening under menus.** HudController's `selectMenuOpen` moved to client/store (`selectors.ts`); `toggle()` refuses
    to OPEN under it (pause overlay, party overlay, menu screens, panels, run-over, tutorial outro) or while the sim is
    frozen (`SimController.isFrozen`, the outro); closing always works.
  - **Binding migration** (shared/play `sanitizeControlsOverrides`): actions new in this version (`map`) yield. When a
    stored override of another action holds the new action's default input (an old D-pad left override), the new
    action takes the input that action vacated if free, else the first free of `ButtonL3`, `ButtonR3` (keyboard: `G`,
    `H`, `T`), instead of knocking the override out and cascading (stored `{ skill4: DPadLeft, skill3: DPadRight }`
    used to lose both; now the map goes to L3). A stored `Semicolon` (reserved since MD11) is dropped from its slot (the
    other slot kept); an action left with no slot yields the same way (`{ skill1: [";"], skill2: ["One"] }` used to
    lose skill2 too; now skill1 takes Two). Every pad action keeps exactly one input; with no free input the old rule
    applies. Valid current bindings never trigger it. Specs in `bindings.spec.ts`.
  - **Sub-pixel placement.** The image and every mark are placed by Scale of the host (their map pixels over the
    host's reference size), not Offset: a UDim Offset is an integer, so fractional offsets were truncated one by one.
  - Treasure / shrine marks show once their centre cell is not UNKNOWN (seen through a doorway) or the room revealed.
  As built (input part only; the overlay, pause map and hint display are open): `GameAction` `"map"`, last in
  `KBM_ACTIONS` (after `leaderboard`) and `PAD_ACTIONS` (after `restart`), not in `ACTION_BUTTONS`; defaults `M` /
  `DPadLeft`. `KEYBOARD.debugDrop` (`FIXED_INPUTS.debugDrop`) moved to `Semicolon`, which replaced `M` in
  `RESERVED_KBM_INPUTS`. shared/play `isMapInput(name, bindings)` and `mapHint(bindings)`; the client's
  `InputController.onMapAction(listener)` (returns a disconnect) fires on a bound map press (CAS sink / mouse, so never
  while typing, during a capture or, on a pad, while a menu owns the D-pad). An old stored override that took D-pad
  left (free before) now clashes with the map default and falls back. Specs: `bindings.spec.ts` (five new cases) and
  the existing ones moved off D-pad left / M.
- [x] **M10. Options switch.** `DisplaySettings.minimap` (default true, overrides-only like `roomEdges`: only Off is
  stored; settings doc stays v2) + settings spec cases (default, round trip, junk ignored, old doc reads On); a
  `SettingRow` in the Display tab.
  As built: `DEFAULT_MINIMAP` in `shared/settings/config.ts`; the row (after HUD fade) reuses the Juice tab's On / Off
  strings; nothing reads it yet (M8). Studio check pending.
- [ ] **M11. Playtest.** Tune `sightTiles`, zoom, the dims and tints on all five biomes in both packs, a 16:9 monitor,
  ten-foot and the phone emulator. Judge: does the map ever show something the player should not know (enemies
  through walls, the stairwell early)? Is the frontier useful or noise? Does the corner panel cover fights (the
  occlusion fade should handle it)?
- [x] **M12. Docs.** CLAUDE.md decision-log line and this doc's status and as-built notes.

Critical path: M0 -> M8 -> M9. M1-M6 are pure and headless and can go alongside M0; M7 alongside M8.

## Studio check (M8, M9)

1. M1 world, F5: the corner map shows only the entrance and what is in sight; walking a corridor uncovers it; entering
   a room shows the whole room at once; the arrow moves up on the map when moving up on screen.
2. Endless floor: unentered rooms, seen through a doorway, are tinted waiting; they turn live on entry and safe on the
   clear; the stairwell mark appears only once seen and changes when it opens. Next floor: fresh fog.
3. Enemies and boost drops show only in sight, never through walls; the boss mark on a boss floor. Tutorial floor 1
   has the minimap from its first frame. (The map lesson after combat F is checked in docs/TUTORIAL_MAP.md "Studio
   check".)
4. Co-op (two clients): both maps reveal what either player sees; teammate dots in class colours; a dead player's map
   keeps updating while spectating and centres on the watched teammate.
5. M / D-pad left: the full map opens over play and closes again; the solo pause overlay shows it; run over closes it.
6. Options > Display > Minimap Off hides the corner map at once and after a rejoin; the full map still opens.
7. The corner panel fades when the player walks under it; the verdict line sits above it; no Output warnings.

## Decisions

- **MD1. Presentation only.** The fog is computed on the client from sim state and never feeds back into play: no sim,
  hash, replay, fixture or lockstep change, and M1 / web parity is untouched.
- **MD2. Sight plus whole room** (owner, 2026-10-27): a sight radius blocked by walls and solid pillars; entering a
  room reveals all of it. Three states: unknown, remembered, in sight.
- **MD3. One shared party map** (owner, 2026-10-27): every living player is a sight source on every client.
- **MD4. The stairwell stays hidden until seen** (owner, 2026-10-27); then it stays marked for the floor.
- **MD5. Full map on a toggle and in the pause overlay** (owner, 2026-10-27): M / D-pad left, play continues.
- **MD6. Turned to match the camera** (proposed). The world is seen at a 45 degree yaw, so a north-up map would turn
  every direction by 45 degrees between screen and map. A north-up option can come later if players ask.
- **MD7. Bottom-right corner, 140 x 140** (owner, 2026-10-27: 140 x 140, cover cap raised 0.12 -> 0.145): the one
  free corner since HD6. M7 had shrunk the panel to 60 x 60 to keep 0.12 (the phone under the top bar reached 14.0 %);
  the owner kept 140 x 140 and raised `HUD_FOOTPRINT_LIMITS.maxCoverShare` instead. `MINIMAP_PANEL` follows
  `MINIMAP_VIEW.panel` (one source of truth).
- **MD8. Shapes and colour roles only** (proposed): no marker images in v1; packs can add them later.
- **MD9. Not bit-exact across clients** (proposed). Clients render frames at different times, so a source's tile
  changes can land in different frames; the tile-line fill makes the revealed sets agree in practice. Nothing reads the
  fog, so a one-tile difference between clients costs nothing.
- **MD10. Not saved** (proposed): a fresh fog per floor, and a late attach recovers entered rooms only.
- **MD11. M opens the map** (proposed): the debug drop key moves off `M` to a new debug key (proposed: `Semicolon`,
  rarely bound, so reserving it is unlikely to drop anyone's stored binding).

- **MD12. About 35 tiles across** (owner, 2026-10-27): `pxPerTile` 4 in a 140 px panel as the start; M11 tunes it.
- **MD13. On from the first tutorial floor** (owner, 2026-10-27): the tutorial's floors are endless floors and get
  the same minimap; no tutorial lesson about it in v1. (Superseded 2026-11-01 for the lesson: docs/TUTORIAL_MAP.md
  adds step `map`, 11 of 17, open the full map; the minimap still shows from the first frame.)
- **MD14. Boost drops in sight show on the map** (owner, 2026-10-27), as glints in `minimap.boost`. Breakables do not.

## Secret rooms (2026-11-13)

A secret room never shows on the map before it opens (docs/SECRET_ROOMS.md SRD4: the tiles stay the Forge grid's). At the
open (or the first frame a late view finds it open) MinimapController applies `secretMapChange`, repaints the cells,
reveals the whole chamber on the shared party fog (`FogOfWar.revealCells`) and draws the chest's mark like the vault's
(`secretMarkStyle`, hollow once taken).
