# Portrait play: plan

Status (2026-11-02): **PT1-PT8 code-complete, verified headlessly only** (typecheck, lint, asset / autolocalize / l10n /
art checks, build, and the Lune specs of shared/view, play, tutorial, theme, run, settings, onboarding, l10n and the
small folders; sim and dungeon were not rerun: nothing under them changed). **Nothing has run in Studio**: PT9 is
pending. Makes the game and the tutorial playable on a phone held upright, and lets a phone turn either way mid-run.
Presentation and client input only: no sim, dungeon, lockstep, hash, replay, fixture or score change.

Owner answers (2026-11-02): follow the device (PD1); in portrait the camera keeps the short side (PD2).

## Why

Phones are locked to landscape today (`TouchControlsController`: `ScreenOrientation.LandscapeSensor`). The menus already
fit portrait (`shared/view/menu` `menuNarrow`, docs/UI_ART.md "Phones"), but the run does not:

| Landscape assumption | Where | What happens upright (390 x 844 pt) |
|---|---|---|
| The camera shows `VIEW_TILES_HIGH` (16.875) tiles top to bottom | `CameraController` | 7.8 tiles across: enemies and bullets 4 tiles to the side are off screen |
| The backdrop reaches 24 tiles past the floor (sized for a 16:9 view) | `GAME_WORLD.backdropMarginTiles` | A taller view looks past it at the floor's top and bottom edges |
| The touch cluster stays out of the middle third of the width, in a 0.45-wide corner box | `touchLayout` `clusterInCorner` | No scale fits; the corner rules give way and the cluster spreads over the middle |
| The move zone is the left 40 % from the top panels down | `touchLayout` | A thumb anywhere on the left half of the world starts a walk |
| The pause map sits left of the 420 px pause panel | `PauseMap` | ~20 px wide: the touch map lesson's route (docs/TUTORIAL_MAP.md) shows nothing |
| The Build list sits right of the pause panel | `PauseBuild` | Off screen |
| The draft row is three cards side by side (768 reference px) | `DraftOverlay` | 576 px on a 390 pt screen: the outer cards are cut off |

Everything else was checked: the touch strip already collapses for a narrow top bar; every top-centre transient on
touch (slim boss bar 420, toasts 380, spectate bar 420, the touch tutorial prompt and room clear stamp 360) fits a
360 pt screen at the touch HUD scale (PT7 pins it); the full map overlay fits by share; the tutorial / objective /
outro cards and every menu are `MenuFit`; hurt edges use the short side; auto-target, aim and the tutorial arrow's
on-screen test read the live camera.

## Player experience

- Turn the phone and the game turns with it, in a menu or mid-run (the layouts re-run on the viewport change).
- Upright, the view is as wide as landscape is tall (16.875 tiles) and much taller (up to 2.4x: 40.5 tiles), so
  sprites draw about half the size of landscape. The player sits a little above the middle, centred in the part of the
  screen above the thumbs, so as much world shows above as below the player before the controls.
- The move stick floats in the lower half of the left side; Attack and the other buttons sit in the bottom right
  (mirrored left-handed), in the bottom third of the screen.
- Pause shows the map on top and the pause menu under it. The boon draft deals its cards in a column.
- Landscape (phones, tablets, PC) is unchanged.

## Design

Pure core `shared/view/portrait.ts` (tunables `PORTRAIT`, headless specs):

- `isPortrait(w, h)`: taller than wide.
- `viewTilesHigh(w, h)` = `VIEW_TILES_HIGH * clamp(h / w, 1, PORTRAIT.maxAspect)`: the short side always shows
  `VIEW_TILES_HIGH` tiles (landscape: exactly today's view, whatever the device).
- `cameraFraming(w, h, touchControls)`: tiles high, the camera distance at `GAME_CAMERA.fovDeg` (the FOV never changes:
  spike B's orthographic look), and the lift (tiles along the camera's up axis): `controlBandShare / 2` of the view
  height, only upright while the last input device is touch (a tall desktop window keeps the player centred).
- `backdropReachTiles(tilesHigh, tilesWide, liftTiles)`: how far past the focus (along world x or z) the screen's
  corners reach on the backdrop's plane (`VOID.abyssDepthTiles` down), from the camera basis. A spec holds
  `GAME_WORLD.backdropMarginTiles` above it for the tallest portrait view (with the lift) and a 21:9 landscape.

Touch layout (`touchLayout`): upright (`safeH > safeW`) the corner rules become a band: the action cluster within
`PORTRAIT.actionShare` of the width from its side, the move home within the rest, both within `controlBandShare` of
the safe height from the bottom; no centre-band rule. The move zone starts `PORTRAIT.moveZoneShare` of the safe height
from the bottom (and never above the top keep-out). Landscape keeps every rule and result exactly.

Pause (`PauseOverlay`): upright, the map is a square host at the top of the safe area (`pauseMapShare` of its height,
a `UIAspectRatioConstraint` keeps it square inside the width), and `MenuFit` fits the pause panel into the frame below
it (it measures its parent). The Build list is not shown upright (PD6).

Draft (`DraftOverlay`, `DraftRevealController`): upright, the card row is a column (`UIListLayout` vertical), and the
legendary rays sit at `draftSlotOffset(index, count, column)` (the x offset in a row, the y offset in a column).

Orientation: `PORTRAIT.screenOrientation` = `Sensor` (was `LandscapeSensor`), set where the touch GUI is built.

## Tasks

- [x] **PT1. Orientation.** `PORTRAIT.screenOrientation` "Sensor" in `TouchControlsController`.
- [x] **PT2. Framing core** (`shared/view/portrait.ts`) + spec: landscape is exactly today's distance, portrait keeps
  the short side, the cap, the lift only upright with touch controls.
- [x] **PT3. Camera.** `CameraController` reads `cameraFraming` from `camera.ViewportSize` each frame (a rotation
  reframes at once) and shifts the eye by the lift before the texel snap.
- [x] **PT4. Backdrop reach** + spec; `backdropMarginTiles` raised to cover it.
- [x] **PT5. Touch layout upright** + spec on portrait phones (360 x 640 .. 430 x 932, notch insets): clear, in the
  band, at least `minScale`, both hands; every landscape result unchanged.
- [x] **PT6. Pause upright** (map on top, panel below, no Build list) + the split's spec.
- [x] **PT7. Draft column** (`draftSlotOffset`) + spec; the touch transients fit a 360 pt portrait screen (spec).
- [x] **PT8. Docs** (this file, docs/MOBILE.md, docs/TUTORIAL_MAP.md, CLAUDE.md).
- [ ] **PT9 [owner]. Studio emulator and phone check.** Portrait and rotation mid-run (menu, run, pause, draft, the
  tutorial start to finish upright). At graphics quality 1 on a phone, the portrait camera (~1,225 studs away at
  20:9, ~1,325 at the 2.4 cap) shows no haze, shadow or LOD popping (spike B measured landscape distances only).
  → Verify: a first-time player finishes the tutorial upright and reaches floor 3 without help.

## As built

- `shared/view/portrait.ts` (`PORTRAIT`, `isPortrait`, `viewTilesHigh` / `viewTilesWide`, `cameraFraming`,
  `backdropReachTiles`) + `portrait.spec.ts`. Reach measured: 23.7 tiles (21:9 landscape), 26.8 (upright at the cap
  with the lift); `backdropMarginTiles` 24 -> 28.
- `CameraController`: framing from `camera.ViewportSize` every frame; the lift applies while the last input device is
  touch (not only while the controls show, so pausing or a draft never pans the camera).
- `touchLayout`: `clusterInBand` upright; move zone top `max(topBand, (1 - moveZoneShare) * safeH)`. Spec: six upright
  screens x three insets x HUD 70-100 % x size 80-120 % x both hands x play / spectate; landscape results unchanged.
- `computeHudScale`: upright on touch, capped at `width / HUD_VIEW.touchUprightWidth` (452 = the 420 slim boss and
  spectate bars plus margins). 100 % stays at the touch floor 0.75 on every phone from 360 pt; a 320 pt phone gets 0.71;
  125 % on a 390 pt phone gets 0.86 instead of 0.94 (`portraitHud.spec.ts`; the transients fit from 320 pt).
- Pause: `PauseMap portrait` (square host, `UIAspectRatioConstraint`), the panel's `MenuFit` inside a `PanelArea` frame
  under it (only on a solo floor with a map; otherwise the panel keeps the whole area), `PauseBuild` not mounted upright.
  `pausePanelArea` + fit.spec (pause fits at >= the narrow floor on 375 / 390 / 430 pt, HUD 70-125 %).
- Draft: `usePortrait` (client/ui/hud) drives the column; `DraftRevealController` writes `rayX` / `rayY` from
  `draftSlotOffset(i, count, column)` on the same viewport rule.

## Decisions

- **PD1. Follow the device** (owner, 2026-11-02): `Sensor`, either way, mid-run too. No setting.
- **PD2. Keep the short side** (owner, 2026-11-02): upright, the width shows `VIEW_TILES_HIGH`, the height more. Upright
  players see more above and below than anyone in landscape; presentation only (the sim, aggro and scoring never read
  the view), so boards stay as they are.
- **PD3. Distance, not FOV.** The camera moves back (7 degrees kept: spike B's orthographic look). PT9 checks the
  distance on a phone; if it shows artifacts, `PORTRAIT.maxDistanceStuds` caps it and the FOV widens past it.
- **PD4. Aspect cap 2.4** (21.6 : 9; every current phone is at most 21 : 9). A taller window shows fewer tiles across.
- **PD5. The lift** (`controlBandShare / 2` of the view height, touch upright only): the thumbs cover the bottom band,
  so the player is centred in what is left. 0 restores a centred player.
- **PD6. No Build list upright on pause** (v1): no room beside or under the map and the menu; the run-over panel keeps it.
- **PD7. No new strings.** The touch prompts already name the controls ("drag on the left side of the screen" holds
  for the lower-left zone; the map lesson's "tap the pause button" now shows the map on top).
