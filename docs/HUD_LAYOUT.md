# HUD layout: keep the playfield clear (plan)

Status (2026-10-26): **H1-H8 code-complete, verified headlessly only** (typecheck, lint, asset check, art tests,
build, and the full Lune suite: 152 spec files, every one passing, run file by file). **Nothing has run in Studio**:
the Studio check below and H9 are pending. Built on branch `hud-layout` from `main` @ `08d12cf` (four parallel streams
plus a review pass), merged to main. Shrinks the in-run HUD so it never
covers the part of the screen the player fights in: compact corner panels only, the info line moved to the pause menu,
and panels that fade when the action moves under them. Presentation only: no sim, dungeon, hash, replay or fixture
change. The Options settings document gains optional display fields (stays v2, no migration). Owner answers to the
first draft's questions (2026-10-26): solid but compact panels (HD5), info line in the pause menu only (HD6), occlusion
fade with an Options switch (HD7), keep the row words (HD8).

## Why

Measured on the owner's screenshot (2026-10-26: endless floor 1, 1920x1080, Xbox controller, so UIScale 1.5):

| HUD element | Screen rect (px) | Share of the screen |
|---|---|---|
| StatusPanel (top left) | x 24-1920, y 82-277: **the full width** | 18 % of the height |
| ScorePanel (top right) | x 1596-1895, inside that band (darker where they overlap) | |
| WeaponPanel (bottom left) | x 24-1920, y 933-1055: **the full width** | 11 % of the height |
| InfoPanel (bottom right) | x 996-1882, inside that band, one 16 px line in a 900 px box | |

So about **29 % of the screen sits under a 75 % opaque panel** (`HUD_VIEW.panelTransparency` 0.25). The camera shows
16.9 tiles top to bottom (`VIEW_TILES_HIGH` = 270 / 16; 64 px per tile at 1080p) with the player at the centre, so the
player sees **4.1 clear tiles upward of the 8.4 on screen** and 6.1 of 8.4 downward. Enemies, bullets and doorways in
the top half are hidden at half the view distance, where a bullet hell needs them most.

### Root cause: two panels stretch to the screen width (a bug)

Both bands are corner panels that were meant to hug their content (`Panel` with no `width` = `AutomaticSize.XY`,
client/ui/hud/primitives.tsx). Each holds a `Text` with no `width`, and `Text` then defaults to
`Size = UDim2(1, 0, ...)`, a **scale** width. A scale child inside an automatically sized frame resolves against the
frame's parent, here the whole ScreenGui (1280 reference px), so the panel grows to `margin + 1280` and runs off the
right edge. The pixel widths above match this exactly (1920 - 24 = 1896 px).

- StatusPanel: the endless `Floor n · Depth n` line (order 5, `s.floor > 0`). M1 runs have no floor line, so the band
  only appears in endless runs and the tutorial.
- WeaponPanel: the swap hint (`E swap` / `Y swap`), in **every** run.

Every other HUD `Text` without a width sits in a fixed-width panel (BossBar, ToastPanel, TutorialPanel, SpectateBar,
ObjectiveCard, RunOverPanel, InfoPanel), where filling the parent is correct.

Fixing this alone (H1) removes most of the problem. The rest of the plan makes the HUD small and quiet enough that the
problem cannot come back.

## Player experience (target)

- The four corners hold the HUD; the middle of the screen and the strips between the corners stay clear during play.
  Top centre is used only by the boss bar (boss fights) and short toasts; bottom centre only by the tutorial prompt
  and the spectate bar (a dead co-op player).
- Corner panels keep today's solid dark box (HD5), but only as large as their content.
- Top left: the `HP` / `Flask` / `Ember` rows as today, words kept (HD8), then running boosts. Floor and Depth move
  under the score (top right).
- Bottom left: two compact weapon slots; the swap hint shows for the first seconds of a run, after the input device
  changes and in the tutorial, then hides.
- Bottom right: empty during play. The info line (title, biome, seed, dungeon name) lives in the pause overlay and the
  run-over panel only (HD6). Verdict and fallback-notice lines show for a few seconds when they change, then fade. The
  `KV_Debug` line stays as it is.
- When the watched player, a living enemy, the boss or an enemy bullet passes under a corner panel, that panel fades
  to mostly transparent and comes back when the area is clear (HD7; Options > Display > HUD fade, default On).
- Options > Display > HUD scale keeps working; a 70 % step is added for players who want it smaller still.

## Design

### 1. Footprint budget (`shared/view/hud/footprint.ts`, new; pure)

One headless source of truth for where the HUD may draw, so a later panel change fails a spec instead of a playtest.

```ts
export type HudCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
/** Always-on panels: the largest box each may take (reference px), in its corner. */
export const HUD_FOOTPRINT: Readonly<Record<"status" | "score" | "weapons", { corner: HudCorner; maxW: number; maxH: number }>>;
/** Transient panels (boss bar, toasts, tutorial, spectate, the fading verdict line): their band and when they show. */
export const HUD_TRANSIENT: ...;
/** The clear zone, as fractions of the safe area: always-on panels never enter it. */
export const HUD_CLEAR_ZONE = { x0: 0.25, x1: 0.75, y0: 0.22, y1: 0.78 };
/** Screen rects (px) of every always-on panel's budget box for a viewport + HUD scale (computeHudScale's rule). */
export function footprintRects(viewportW: number, viewportH: number, tenFoot: boolean, userPercent: number): ...;
export function footprintReport(...): { panel: string; intrudes: boolean; coverShare: number }[];
```

Starting budgets (reference px at 1280x720; tuned in H9):

| Panel | Corner | Max box | Today (after H1, estimated) |
|---|---|---|---|
| status | top left | 240 x 130 | ~200 x 130 (4 rows with the floor line, 86 px label column) |
| score (+ floor line) | top right | 200 x 130 | 200 x ~100 |
| weapons | bottom left | 240 x 64 | ~286 x 82 |
| verdict / notice (transient) | bottom right | 480 x 60 | 600 x ~36 today, holding the always-on info line |

Rule checked by the spec: every always-on budget box stays outside `HUD_CLEAR_ZONE` at every aspect in
`HUD_TEST_VIEWPORTS` (1280x720, 1920x1080, 2560x1440, 1920x1200 (16:10), 1024x768 (4:3), 2560x1080 (21:9), a
landscape phone 844x390) x every `HUD_SCALE_PERCENTS` x ten-foot on / off, and the three always-on boxes together cover at most
`maxCoverShare` (12 %) of the safe area. The clear zone leaves the full centre column and centre row open, so the
player always sees the whole 8.4 tiles up and down. With solid boxes (HD5) the cover share matters more than with
see-through ones, so the spec prints it per viewport.

### 2. Text sizing (H1)

`Text` gains `fill?: boolean`. Without `width` or `fill` it sizes to its content (`Size = UDim2(0, 0, 0, h)`,
`AutomaticSize.X`; `wrap` still needs a width, so a wrapped Text without one is a dev warning). The fixed-width panels
pass `fill` where they rely on today's behaviour (BossBar / Toast / Tutorial / Spectate / ObjectiveCard / RunOver /
Info texts with no width). Under `KV_Debug`, a `HudFootprintCheck` in HudController measures each always-on panel's
`AbsoluteSize` once per second and warns once per panel when it exceeds its `HUD_FOOTPRINT` box x the current scale
(the runtime guard for what the spec cannot see: real text widths).

### 3. Look (HD5)

Corner panels keep `HUD_VIEW.panelTransparency` 0.25 and the text stroke: no look change. `Panel` gains a `corner` prop
(which corner, for the occlusion registry in H7 and the footprint check in H1) so callers stop passing positions by
hand.

### 4. Compact panels (H4, H5)

- StatusPanel: the `HP` / `Flask` / `Ember` words stay (HD8), one row each. `LABEL_WIDTH` 86 becomes a tunable
  (`HUD_VIEW.statusLabelWidth`), checked by H9 against the longest label in both packs. The floor line moves to the
  ScorePanel under the combo meter (endless and the tutorial are scored); on an unscored run it stays a short line
  under the status rows (content-sized after H1).
- WeaponPanel: `weaponSlotSize` 132 x 40 -> 108 x 30, text 20 -> 16; the inactive slot more transparent; the swap hint
  visible only for `HUD_HINTS.swapHintSeconds` (8 s) after a run start, after a device change, while the tutorial
  teaches weapons, and in the pause overlay's controls list. A per-run "seen" flag, not persisted.

### 5. Info line to the pause menu; fading verdict lines (H6)

The info line (title · biome · seed · dungeon name, `HUD_STRINGS.info`) leaves the in-run HUD (HD6). A shared
`RunInfoLine` component (same string, same args) renders it in the PauseOverlay (solo pause and the co-op party
overlay) and the RunOverPanel. The InfoPanel keeps only the fallback notice and the verdict line, each visible for
`HUD_HINTS.verdictSeconds` (8 s) after it changes, then fading over `HUD_HINTS.fadeSeconds` (0.5 s); the run-over
panel shows the verdict too. The `KV_Debug` line never fades and stays where it is. The timing is a pure helper
(`hintVisible(sinceSeconds, showSeconds, fadeSeconds) -> transparency`) with a spec.

### 6. Occlusion fade (H7)

- Pure (`shared/view/hud/occlusion.ts`): `occludedPanels(rects, points, padPx) -> boolean[]` and
  `occlusionLook(occluded, fadeFrom, t) -> transparency` (fade in `HUD_OCCLUSION.fadeSeconds` 0.15 s, back out after
  `holdSeconds` 0.4 s clear, so a bullet stream does not flicker it). Spec: inside / outside / padded edge, hold, fade
  clamps, reduced motion (instant switch, no fade animation).
- Client (`HudOcclusionController`, render step after the camera, every `HUD_OCCLUSION.everyFrames` = 3 frames): the
  points are the watched player, living enemies and the boss (interpolated sim positions, one `WorldToViewportPoint`
  each), and enemy bullets capped at `maxBullets` (64 per pass; any one bullet inside a panel is enough to fade it, so no
  sorting). Panel rects come from the mounted corner panels' `AbsolutePosition` / `AbsoluteSize` (registered by ref).
  Writes the result to a Reflex slice (`hud.occluded`, four booleans; dispatch only on change). As built: per-corner
  React bindings instead (`cornerFade.ts`), see "As built" under Tasks.
- Panels apply it by wrapping each corner panel in a `CanvasGroup` and binding `GroupTransparency`
  (`HUD_OCCLUSION.occludedTransparency` 0.75). CanvasGroups render to a texture: four small ones are well inside the
  budget, but text can soften at fractional UIScale; H7 checks this on a 1080p screen and a phone, and falls back to
  passing a transparency binding through `Panel` / `Text` / `Pip` if it does.
- Spectating: the watched player (`getViewPlayerIndex`) counts, not the local one.

### 7. Scale (H8)

`computeHudScale` is unchanged (the layout is drawn for 1280x720 and keeps its share of the screen). `HUD_SCALE_PERCENTS`
gains 70 (sanitize already drops unknown values, so old documents read as before). Whether the default should drop to
90 % is decided in H9 from the footprint report, not guessed now.

### Not changed

- The camera: still centred on the player at the web build's framing (`VIEW_TILES_HIGH`, yaw / pitch). Offsetting the
  focus to "centre in the free area" was considered and rejected: with a corner-only HUD the free area is the screen.
- Menus, the pause overlay, Options, leaderboards, the draft, the run-over panel and the objective card: modal or
  between fights, they may cover the playfield.
- The Roblox top bar and core notifications (the controller toast in the screenshot) are outside the game's control.

## Tasks

- [x] **H1. Fix the full-width panels.** `Text` sizes to content without `width` / `fill`; `fill` on the fixed-width
  panels' texts; `HudFootprintCheck` under `KV_Debug`. -> Verify: `npm run verify`; Studio, endless and M1 at 1080p and
  the phone emulator: the top-left and bottom-left panels hug their content, nothing else moved, no footprint warning.
  Screenshot before / after into this doc.
- [x] **H2. Footprint budget.** `footprint.ts` + spec over `HUD_TEST_VIEWPORTS` x scales x ten-foot (print the cover
  share per viewport). Start with today's sizes to see which budgets fail, then H4 / H5 make them pass.
- [x] **H3. `Panel` corner prop.** `corner` replaces the hand-written position / anchor on the four corner panels
  (same margins, no visual change).
- [x] **H4. Compact StatusPanel.** Words kept; `statusLabelWidth` tunable; floor line to the ScorePanel on scored runs;
  the tutorial highlight rings still land on the right rows (hearts, flask, boosts, score) and the ghost heart still
  sits after the hearts. -> Verify: tutorial floor 1 in Studio.
- [x] **H5. Compact WeaponPanel.** Smaller slots, timed swap hint (`HUD_HINTS`, pure timing helper + spec), hint in the
  pause overlay. The tutorial's weapon lesson ring (`highlight === "weapons"`) forces the hint on.
- [x] **H6. Info line to the pause menu.** `RunInfoLine` in PauseOverlay (solo and party) and RunOverPanel; InfoPanel
  keeps the notice / verdict lines with `hintVisible` (+ spec) and the debug line. `TUTORIAL_VIEW.panelBottom` 132 can drop (it only cleared the bottom panels); retune in H9.
- [x] **H7. Occlusion fade.** `occlusion.ts` + spec, `HudOcclusionController`, the Reflex slice, CanvasGroup wrappers;
  an Options > Display row `HUD fade` (On / Off, default On; overrides-only like `roomEdges`, settings spec cases).
  -> Verify: frame time with `KV_Debug` stats on the busiest endless floor (boss with adds) stays flat. Solid boxes
  (HD5) make this the main defence for the corners, so check the fade reads quickly at 1080p and on a phone.
- [x] **H8. 70 % HUD scale step.** `HUD_SCALE_PERCENTS`, settings spec (round trip, old docs).
- [ ] **H9. Playtest and docs.** 1080p, 1440p, 21:9, the phone emulator and a TV (ten-foot); M1, endless (incl. a boss
  floor with the boss bar and toasts), the tutorial, co-op spectating. Tune the budgets, transparencies and timings;
  decide the default HUD scale. Docs: docs/CLIENT.md's HUD section and table, a CLAUDE.md decision-log line (HUD
  footprint budget; corner panels; info line in the pause menu; occlusion fade and its setting), this doc's status. No PROVENANCE row (the web build's HUD layout
  is not ported pixel for pixel; the pieces ported in layout.ts keep theirs).

As built (differences from the design above):

- H1: `Text` takes `fill` (and `wrap` implies it) and an optional `transparency` (number or binding). Every existing
  caller that relied on filling got `fill`; the InviteBadge (menu toasts, shown during runs) and the menu's Starting
  panel were the same full-width bug and now hug their text. The runtime footprint check lives in
  `HudOcclusionController` (KV_Debug, once a second, 1 px tolerance).
- H2: budgets settled at status 240x160 (3 rows + one boost row + one item row, `statusEstimate`), score 200x160
  (the floor line moved under it), weapons 240x80 (the swap hint above the slots). `HUD_TEST_TOP_INSET` (58 screen px,
  the Roblox top bar) runs every check with and without the inset. Cover share at 100 %, no inset / with inset:
  1280x720 9.7 / 10.6 %, 1920x1080 9.7 / 10.3 %, 844x390 9.8 / 11.5 % (limit 12 %, enforced with ten-foot off).
  Ten-foot (TV) screens go over 12 % at 720p / 1080p and some boxes reach the clear zone above 100 % HUD scale: these
  are printed by the spec, not failed. Today's screenshot case measured 29 %.
- H4 / H6: RunItems keeps one row (`capOneRow`: newest items, a leading `+N` cell, string `hud.items.more`) and
  BoostRow wraps at the status width (`wrapGrid`, `GridRow`; 4 simultaneous boosts take a second row). The info line
  is `RunInfoLine` in the pause overlay (solo and party, with the fallback notice and the swap key) and the run-over
  panel (which now shows the verdict too); InfoPanel's verdict line hides once the run is over.
- H5: `weaponSlotSize` 108x30, `weaponTextSize` 16, `weaponInactiveTransparency` 0.7. The swap hint sits above the
  slots so they never move; its timer (`useTimedHint`, shared with the verdict lines) restarts on a run start
  (`runInfo.run`), the game going active and an input device change, not on a floor change or a Reduce Motion toggle.
- H7: no Reflex slice: `client/ui/hud/cornerFade.ts` holds one React binding per corner, written by the controller
  only on change, so the fade never re-renders the tree. A corner `Panel` is a transparent placed frame (the registry
  ref, the tutorial ring via `overlay`) around a `canvasgroup` with the panel's background, padding and layout.
  Points come from `Camera:WorldToScreenPoint` (GUI space, like `AbsolutePosition`); pad is reference px x the UIScale.
- H8: `HUD_SCALE_PERCENTS` = [70, 80, 90, 100, 110, 125]; the HUD scale row's buttons are `HUD_VIEW.scaleOptionWidth`
  (76) wide so six fit.

Studio risks to check first (H9): CanvasGroup text softness at fractional UIScale (1.5 at 1080p) and on phones (the
fallback is the `Text` / `Pip` transparency binding); AutomaticSize on the canvasgroup; the corner hit test lining up
(walk into each corner; if it is ~58 px off vertically, switch to `WorldToViewportPoint` minus `GetGuiInset()`);
CanvasGroup redraws while a ring pulses or a boost blinks inside the top-left group (frame time).

Critical path: H1 (most of the win, ship it first) -> H2 -> H4 / H5 -> H9. H3 goes before H7 (the occlusion registry
uses the corner prop); H6 and H8 can go alongside.

## Studio check

1. Endless run, 1920x1080: no full-width band at the top or bottom; the screenshot's floor shows its top walls and
   torches under no panel. M1: the same (its WeaponPanel band is gone too).
2. Walk the player into each corner: the panel fades as the player's ring reaches it and returns 0.4 s after leaving.
   An enemy bullet crossing a corner fades it; a stream does not flicker it.
3. No info line during play; it is in the pause overlay (solo and co-op party) and the run-over panel. A verdict line
   appears at the bottom right when it changes and fades after 8 s.
4. The swap hint shows at run start, after switching keyboard <-> pad, in the weapon lesson; then hides.
5. Boss floor: the boss bar and toasts fit the top centre without touching the corner panels at every HUD scale.
6. Tutorial: every highlight ring and the ghost heart land on the right element.
7. Phone emulator and 4:3: no panel enters the clear zone at HUD scale 125 %.

## Decisions

- **HD1. Fix the bug first, separately** (H1): it is a one-line primitive change with the largest effect and needs no
  owner decision.
- **HD2. Corners for always-on HUD, centre bands for transient HUD only**, enforced by a headless footprint spec and a
  `KV_Debug` runtime check.
- **HD3. The camera does not move** to make room; the HUD makes room.
- **HD4. Presentation only.** No sim, hash, replay or fixture change; settings stay document v2.
- **HD5. Solid but compact corner panels** (owner, 2026-10-26): today's dark box (`panelTransparency` 0.25) and text
  stroke, sized to content and held to the footprint budget; the occlusion fade (HD7) clears them when it matters.
- **HD6. Info line in the pause menu only** (owner, 2026-10-26): title, biome, seed and dungeon name are in the pause
  overlay and the run-over panel, never on screen during play. Verdict and notice lines still show briefly in play.
- **HD7. Occlusion fade, with a switch** (owner, 2026-10-26): Options > Display > HUD fade, default On.
- **HD8. Keep the row words** (owner, 2026-10-26): `HP` / `Flask` / `Ember` stay; no icon glyphs.
