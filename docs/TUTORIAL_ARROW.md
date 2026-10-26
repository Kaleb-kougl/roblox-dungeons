# Tutorial guidance arrow: plan

Status (2026-10-26, on `main`): **A1-A5 code-complete, verified headlessly only** (typecheck, lint,
build; the A1-A4 specs and the new `tutorialHud.spec` cases under Lune). **Nothing has run in Studio**: the Studio
check below is pending, and so is A6 (playtest). Adds a guidance arrow to the Practice Descent (docs/TUTORIAL.md): a
flat chevron on the floor next to the player that points the way to the current objective. Planned against `main`
@ `4834215` (the tutorial with the linear floor 1 and the fast boss, `bf67800`, is merged). Presentation only: no sim,
dungeon layout, hash, replay or fixture change.

As built, differing from the plan as first written (§1-§3 already show the as-built API):

- **§1.** `PathField` also carries `tx` / `tz` (the target as given; `gx` / `gy` are the snapped seed tile); `pathStep` is exported (the bots' `walkDir` and
  `pathAhead` share it); `clearWalk` takes a blocker, and `walkBlocker(d)` (pits block too) is the guide's, while the
  tutorial bot keeps `bulletBlocker(d)` (pits do not block), so its ticks are unchanged.
- **§2.** `GuideInput` has no `motion` (only the look reads `motionScale`); `GuideView` adds `aimX` / `aimZ` and
  `unreachable`; the constructor takes the tuning and an optional body radius (`PLAYER_RADIUS`). An unreachable target
  is still shown (straight-line distance for the hide rule) instead of hidden; losing the target hides at once (no
  hold); the heading snaps whenever the arrow is fully faded out, which covers the first shown frame and a floor change.
- **§3.** `tutorialArrowLook(t, motion, alpha = 1)`: the transparency folds in the guide's fade. Two more tunables:
  `arrowLiftFraction` 0.5 and `arrowThicknessStuds` 0.04 (§4 height).
- **§4.** The chevron's centre is at `floorStudsY() + MARKING_VIEW.liftTiles * arrowLiftFraction * STUDS_PER_TILE`
  (0.08 studs) and its Parts are 0.04 studs thick (0.06-0.10 studs; marking dashes start at 0.16). The arm geometry
  (`tutorialArrowArm`), the image size (`tutorialArrowImageSize`) and the on-screen test (`tutorialArrowOnScreen`) are
  pure helpers in `shared/view/hud/tutorial.ts`, specced in `tutorialHud.spec.ts`. The `ui.arrow.tutorial` image is
  NOT stretched by 1 / sin(pitch) like the co-op ring: the ring is turned with the camera yaw, the arrow turns with its
  heading, so a stretch along its own axis would change its length on screen as it turns. It is sized by its pixel
  aspect to fit `arrowWidthTiles` x `arrowLengthTiles`, centred (no pivot), untinted, its top edge pointing ahead.
  The `unreachable` warning is printed once per run.

## Why

The tutorial already has one guide: `TutorialMarkerController`'s upright beam on the director's marker target (the
next lesson room's door, the pedestal, the shrine, the stairwell, the live boss). It marks **where**, but only once it
is on screen. The camera shows **16.875 tiles** of view height (about 30 tiles across at 16:9), while floor 1's legs
are **17-25 tiles** centre to centre in double-size rooms (24-36 tiles across), so for much of every walk the beam is
off screen and the only hint is the "Follow the marker to the next room." prompt. The arrow shows **which way** from
wherever the player stands; the beam stays as the destination.

## Player experience

- A flat chevron lies on the floor `arrowOrbitTiles` (1.6) from the player's feet, pointing along the **walkable
  path** to the objective: round walls, solid pillars and the snake's turns, never into a wall the way a crow-flies
  arrow would (floor 1 is a three-row snake: B -> C and F -> treasure turn back on themselves).
- It is there whenever the director has a marker target and it is useful:

  | Situation | Arrow |
  |---|---|
  | Walking to the next lesson room's door, the pedestal, the shrine, the stairwell (floor 1 or 2) | shown |
  | Inside an entered, unfinished lesson room (the director's marker is undefined there) | hidden: no clutter in fights |
  | Wandered out of an unfinished lesson room (marker = its centre) | shown, leads back |
  | Objective card up, draft open (step `draft` has no marker), outro / ended, no tutorial run | hidden |
  | Target on screen **and** in clear sight of the player | hidden: the beam is in view and the way is straight |
  | Target closer than `arrowHideTiles` (3) along the path | hidden |
  | Boss step: Mother Bramble off screen (rare in her arena) / on screen | shown / hidden |

- It turns smoothly (heading damped, `arrowTurnTau` 0.1 s) and fades in and out (`arrowFadeSeconds` 0.2 s) with a
  short hold (`arrowHoldSeconds` 0.3 s) so it never flickers at an on-screen edge or a path corner.
- A gentle forward slide (`arrowSlideTiles` 0.15, period 1.2 s) draws the eye; it scales by the juice `motionScale`
  (still under reduced motion; the fades and turning stay).
- Colour: theme role `uiAccent`, the beam's and the HUD highlight ring's, so "accent = the tutorial is pointing at
  this" stays one idea. With the optional theme image `ui.arrow.tutorial` the pack's art replaces the placeholder.

## Design

### 1. Path field (`shared/dungeon/pathField.ts`, new; pure)

The tutorial bot already has exactly the needed pieces, but in test code (`shared/run/testing/endlessBot.ts`:
`distanceField`, `walkDir`). Lift them into production:

```ts
export interface PathField { readonly d: Dungeon; readonly dist: number[]; readonly gx: number; readonly gy: number; readonly tx: number; readonly tz: number }
/** 4-neighbour BFS over FLOOR tiles from the target's tile (snapped to the nearest FLOOR tile within SNAP_TILES). */
export function pathField(d: Dungeon, tx: number, tz: number, avoid?: readonly [number, number]): PathField;
/** Path distance (tiles) from a world point, math.huge when unreachable. */
export function pathDistance(f: PathField, x: number, z: number): number;
/** Walk the field downhill from (x, z) up to `steps` tiles (8 neighbours, diagonals only past open corners). */
export function pathAhead(f: PathField, x: number, z: number, steps: number, out: number[]): number; // fills x,z pairs
/** One downhill step from grid (gx, gy): the cell index, -1 on the seed / no path (walkDir and pathAhead use it). */
export function pathStep(f: PathField, gx: number, gy: number): number;
/** The bot's three parallel lines of sight `radius` apart; walkBlocker(d) also stops at pits (bulletBlocker does not). */
export function clearWalk(blocked: BulletBlocker, x0: number, z0: number, x1: number, z1: number, radius: number): boolean;
```

- Solid pillars and pits are not FLOOR, so the field already rounds them. Breakables are off in the tutorial (B7), so
  the grid alone is the truth; a later endless reuse would pass `solid` cells the way the movers do.
- `endlessBot` / `tutorialBot` switch to it (same code, same order: every bot spec's tick counts are unchanged, e.g.
  the tutorial tour's 4283 ticks and 21.4 s fight on this tree). One difference: a target off FLOOR now snaps to the
  nearest FLOOR tile (or gives an empty field) where the old bot field seeded the wall tile itself; no recorded bot
  target is off FLOOR, so no run moved.
- `shared/dungeon` is determinism-restricted; this is plain integer BFS, no forbidden globals.

### 2. Guide (`shared/tutorial/guide.ts`, new; pure, headless-tested)

```ts
export interface GuideInput {
	readonly dungeon: Dungeon;            // the current floor's (SimController.getContext())
	readonly target: TutorialMarker | undefined; // TutorialController.getMarker()
	readonly px: number; readonly pz: number;    // the interpolated player (lerp(prev, cur, alpha))
	readonly targetOnScreen: boolean;     // client: Camera:WorldToViewportPoint inside the inset viewport
	readonly dt: number;                  // (no motion: only the look, tutorialArrowLook, reads motionScale)
}
export interface GuideView {
	visible: boolean; alpha: number; heading: number; x: number; z: number; // heading: direction (sin h, cos h)
	aimX: number; aimZ: number; pathTiles: number; unreachable: boolean;
}
export class TutorialGuide { // reused view object, like TutorialView
	constructor(tuning: GuideTuning /* TUTORIAL_VIEW */, bodyRadius?: number /* PLAYER_RADIUS */);
	update(input: GuideInput): Readonly<GuideView>;
}
```

Per frame:
1. No target -> fade out. Target tile changed (or the dungeon object changed: floor change) -> rebuild the field. The
   boss moves, so its field is rebuilt at most every `arrowFieldSeconds` (0.25 s) and only when her tile changed.
2. **Aim point.** If the player has a clear walk to the target (`clearWalk`: the bot's three parallel lines of sight
   a player radius apart, lifted with the field), aim straight at it. Otherwise walk `pathAhead` up to
   `arrowLookaheadTiles` (8) and aim at the **farthest** tile on it with a clear walk from the player (string
   pulling): the chevron points at the next corner of the path, not at the next tile, so it does not wobble.
3. **Show rule**: visible = target && pathTiles > `arrowHideTiles` (straight-line tiles when unreachable) &&
   !(targetOnScreen && clear walk). Changes of the rule are held `arrowHoldSeconds` before they take effect; no target
   hides at once.
4. Heading: shortest-way angle damping toward the aim heading (`arrowTurnTau`); snap on the first shown frame and on
   a floor change. Position: player + `arrowOrbitTiles` along the damped heading.
5. Unreachable (should not happen; the spec proves it for every tutorial target): still shown, with a straight-line
   heading, and `GuideView.unreachable` set for a one-time `warn` from the client controller.

Never touches the sim; deterministic for an input sequence, so it is specced like the director.

### 3. View tunables (`shared/view/hud/tutorial.ts`)

`TUTORIAL_VIEW` gains `arrowRole` (`uiAccent`), `arrowImageId` (`ui.arrow.tutorial`), `arrowOrbitTiles` 1.6,
`arrowLengthTiles` 0.7, `arrowWidthTiles` 0.6, `arrowBarTiles` 0.12, `arrowHideTiles` 3, `arrowLookaheadTiles` 8,
`arrowFieldSeconds` 0.25, `arrowTurnTau` 0.1, `arrowFadeSeconds` 0.2, `arrowHoldSeconds` 0.3, `arrowSlideTiles` 0.15,
`arrowPeriodSeconds` 1.2, `arrowTransparency` 0.1, `arrowScreenInset` 0.08 (fraction of the viewport kept as margin
for "on screen"). `tutorialArrowLook(t, motion, alpha = 1)` -> `{ slideTiles, transparency }` (transparency folds in
the guide's fade alpha), specced like
`tutorialMarkerLook`. Every number above is a starting value for the playtest (T8 / A6).

### 4. Client (`src/client/controllers/render/TutorialArrowController.ts`, new)

- Built like `TutorialMarkerController`: per tutorial run (`sim.onRunStarted`, Janitor), nothing for other runs.
  Render step `KV_TutorialArrow` at Camera + `RENDER_ORDER.viewsAfterCamera`, so it reads the same frame's alpha and
  the camera after its follow; the director already ran at `tutorialAfterFx`.
- Each frame: `tutorial.getMarker()`, the interpolated player (`lerp(prevX, x, alpha)`), the floor's dungeon from
  `sim.getContext()`, `targetOnScreen` from `Workspace.CurrentCamera:WorldToViewportPoint` at the target's floor
  point (inside the viewport inset by `arrowScreenInset`, in front of the camera), `motionScale(fx.settings())`, then
  `guide.update(...)`.
- Look: placeholder = two thin Neon Parts (`renderPart`, `uiAccent`) forming a flat chevron at
  `floorStudsY() + MARKING_VIEW.liftTiles * 0.5 * STUDS_PER_TILE`, i.e. on the floor but **under** the telegraph and
  weapon markings and bullets, so a sniper's aim line is never hidden by it. With the pack image `ui.arrow.tutorial`:
  a Decal on a flat invisible Part (the `ui.ring.player` pattern in ActorRenderController, depth stretched by
  1 / sin(pitch)). One CFrame write per part per frame; Transparency from `alpha` and the look.
- Optional image: `ThemePack.image("ui.arrow.tutorial")` returns undefined in the placeholder pack, like
  `ui.marker.tutorial`, so no contract or pack change is needed. When vale art exists it goes through
  `art/atlases.json` / `assetIds.ts` like every ui image.
- No input, no HUD (Reflex) change, no remote.

## Tasks

- [x] **A1. Path field.** `shared/dungeon/pathField.ts` (+ `clearWalk`) and spec: straight corridor, an L bend, a
  solid pillar in a room, a target on a WALL tile snaps to floor, an unreachable pocket is `math.huge`; both bots use
  it. -> Verify: `npm run verify`; the tutorial bot spec's tick counts and boss timings unchanged.
  As built: `pathField.spec.ts`; the bots' fields and walks are the lifted code, and every bot run prints the same
  ticks as before.
- [x] **A2. Guide.** `shared/tutorial/guide.ts` + spec on small hand-made dungeons: points straight with a clear walk;
  points at the corner (not into the wall) round a bend and a pillar; hides near the target, with the target on screen
  and in sight, and without a target; the hold stops flicker on an alternating on-screen input; damping turns the
  shortest way across +-pi; snaps after a floor change; never allocates per frame (reused view).
  As built: `guide.spec.ts` (see "As built" above for the API changes).
- [x] **A3. Guide on the real floors.** In `tutorial.spec.ts`: every marker target the director can name on floor 1
  (each lesson door, room centre, pedestal, shrine, stairwell) and floor 2 (the stairwell) is reachable from every
  FLOOR tile of every room before it. And a **guide-steered run**: `playTutorial({ steer: "guide" })` walks by the
  guide's heading instead of its own field between lesson rooms and still finishes every step, in at most
  `GUIDE_SLACK` (1.15x) of the bot's own walking time. This is the "the arrow never sends you into a wall" proof.
  As built: the guide-steered run finishes every step in 0.988x the bot's own `walkTo` ticks.
- [x] **A4. View tunables.** `TUTORIAL_VIEW.arrow*`, `tutorialArrowLook` + spec (motion 0 = still, clamps).
  As built: `tutorialArrowLook` also takes the guide's `alpha`.
- [x] **A5. Client.** `TutorialArrowController`, placeholder chevron, optional `ui.arrow.tutorial` Decal, the
  on-screen test. Docs: a row in docs/CLIENT.md's controller table and in docs/TUTORIAL.md §4, a line in its smoke
  test (step 2), this doc's status. -> Verify: `npm run verify`, then the Studio check below.
  As built: `src/client/controllers/render/TutorialArrowController.ts` (render step `KV_TutorialArrow`, folder
  `KV_TutorialArrow`); typecheck, lint and build pass and the new `tutorialHud.spec` cases pass headlessly; the
  Studio check is pending.
- [ ] **A6. Playtest** (with TUTORIAL.md T8). Tune orbit, size, hide distance and the on-screen inset on a 16:9
  monitor and the phone emulator; check it reads on frost floor 1 and the floor-2 biome; check it never sits on top of
  the bow's aim line or the guard fan in a lesson room (it is hidden there by design: confirm).

Critical path: A1 -> A2 -> A3 -> A5. A4 can go alongside A2.

## Studio check (A5)

1. `KV_Tutorial` on, F5: after the objective card, move and flask (no marker, no arrow). Once combat A's door is the
   target, the chevron appears beside the player pointing along the corridor; walking the snake's turns (B -> C,
   F -> treasure) it swings round the corner before the player reaches it.
2. Enter a lesson room: the arrow fades out. Walk back out unfinished: it fades in pointing at the room's centre.
3. With the beam on screen and nothing in the way, no arrow; step behind a solid pillar (combat E) so the beam is in
   view but blocked: the arrow returns.
4. Reduced motion (Options): no slide; turning and fades unchanged. Floor 2: points from the entrance to the arena,
   hides when Mother Bramble is in view, points at the stairwell after the kill.
5. Telegraphs, aim lines and bullets draw over the chevron; no Output warnings (`unreachable`).

## Decisions

1. **Form: an orbiting floor chevron** (owner, 2026-10-26), not a dashed path trail.
2. **The beam stays** (owner, 2026-10-26): the beam marks where, the arrow shows which way; the arrow hides when the
   beam is on screen and the way to it is clear.
3. **Path-following, not crow-flies**: the arrow aims at the farthest clear point of the BFS path (string pulling), so
   it never points into a wall on the snake or round a pillar. The cost is one BFS per target (floor-sized grid, only
   when the target tile changes).
4. **Presentation only**: the guide reads the director's existing `marker` and the dungeon; no new director field,
   no sim / hash / fixture change, no DataStore or remote.
5. **Colour `uiAccent`, no new theme role**: it is the tutorial's existing "look here" colour. (Alternative: a
   `tutorialGuide` role validated against floors and the enemy-bullet roles like `enemyOutline`; only worth it if
   playtests show it confused with a telegraph.)

## Open questions (owner)

- **Options toggle?** None planned: it only exists in the tutorial and hides itself when not needed. Add a
  "Guidance arrow" switch under Options > Display if playtesters ask.
- **Endless runs later?** The guide is generic (target + dungeon); pointing at an open stairwell in endless floors
  would be one more controller mode (and `solid` breakable cells in the field). Out of scope here.
