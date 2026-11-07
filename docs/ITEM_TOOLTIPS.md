# Item tooltips: plan

Status (2026-11-06): **built, Studio check pending** (shared core on `it-core`, client on `it-client`; IT0 / IT11 are the owner's). The owner said proceed (2026-11-06): ITD1..ITD10 are accepted as recommended. IT0 (Studio spike) is deferred to the owner's Studio check. Code facts checked against the repo at `3b0c56df` (branch with
fortune art); anything not yet confirmed is marked **(IT0 verifies)**. Owner answers (2026-11-06): scope = **this run's
items** (not the full catalog: that is `claude/codex-plan.md`); hover in the **pause menu**, on the **live HUD icons**
and on the **run-over screen** (not the boon draft). Decisions ITD1..ITD10 are proposed (recommendation first).

Goal: at any point in a run you can see everything you have (boons with their levels and evolutions, duos, relics,
curses, running boosts) and point at one to read exactly what it does now, what its next level does, and where it came
from. Mouse: hover. Gamepad: focus. Touch: tap.

**Presentation and client input only.** No sim, dungeon, lockstep, hash, replay, fixture, score or server change. New:
pure view models and a hover tracker in `shared/view/hud`, one tooltip widget and controller on the client, theme
strings, one optional Display setting.

## What exists today

| Piece | Today | Where |
|---|---|---|
| Pause Build list | Right of the centred pause menu (solo map on the left). **Boons and duos only**: name in rarity / `boon.evolved` / `boon.duo` colour, level (roman), the current line in `uiTextDim` **truncated at the row's end** (`TextTruncate.AtEnd`). Capped at `listMaxRows` 12 (touch `listCompactRows` 8) with a `+N` line. **Hidden on an upright phone** (`portrait ? undefined : <PauseBuild/>`) | client/ui/hud/BuildList.tsx, PauseOverlay.tsx:301, shared/view/hud/buildHud.ts `buildListRows` / `capBuildList` / `pauseBuildWidth` |
| Run-over Build list | The same `BuildList` component: a column beside the stats (compact layout, 8 rows), beside the breakdown behind Details (wide, 12), or under it (narrow, 8) | client/ui/hud/RunOverPanel.tsx ~655 / ~699 / ~708 |
| Status panel items row | `RunItems`: one row of square cells (boons in rarity colour with level pips, evolved gold frame, duos as joined double chips, relics `uiAccent`, curses `uiHealth` + faded skull), short icon labels (`<id>.icon`, e.g. `STM`). One row at most: the newest cells that fit, a leading `+N` cell. Plain Frames, **no input** | client/ui/hud/RunItems.tsx, StatusPanel.tsx row 6, shared/view/hud `runItemCells` / `capItemCells` |
| Boost row | `BoostRow` cells with seconds left and a bar (the **shown** player's, so a spectated teammate's) | client/ui/hud/BoostRow.tsx, shared/view/boosts `BoostHudEntry` |
| Touch chips | `TouchStrip` reuses `RunItems` with its own look | client/ui/hud/TouchStrip.tsx |
| Data | Snapshot `boons` / `relics` / `curses` / `boonLevels` / `duos` (the **local** player's, order taken) and `boosts` (the shown player's); `BOONS` 17, `DUOS` 13 (`a` / `b` boon indices), `RELICS` 4 (Mirror Cloak, Hourglass, Vampire Fang, Second Wind), `CURSES` 4 (Frailty, Haste, Impatience, Thirst; Greed's curse is one of these via `acceptCurse`) | shared/play/snapshot.ts, sim/progression/progressionData.ts, sim/builds/buildsData.ts |
| Strings | Every boon / relic / curse / duo has `.name` / `.desc` / `.icon`; levelled boons `.desc.2`, `.evo.name`, `.evo.desc`; `boon.rarity.*`; boosts `boost.<kind>.name` / `.desc` (`progressionStringKeys`) | shared/view/hud/progression.ts, theme packs |
| Hover / tooltips | **None.** Only `MenuButton` and `PauseButton` use `MouseEnter` / `MouseLeave` for their own look | client/ui/hud/primitives.tsx, PauseButton.tsx |
| Mouse in a run | The mouse is the aim point (`GetMouseLocation` -> floor plane). A press that **begins over a GUI** (`gameProcessedEvent`) is held out of the sim until released (`InputController.guiMouse`) | client/controllers/game/InputController.ts ~133 |
| Corner fade | Corner panels sit in a CanvasGroup whose `GroupTransparency` fades while the action is under them (`HUD_OCCLUSION`, `cornerFade.ts`); a CanvasGroup clips its children | shared/view/hud/occlusion.ts, client/ui/hud/primitives.tsx ~234 |
| Layers | HUD `hudDisplayOrder` 10, menu shell 15, pause dim 19, pause / menu 20, loading / stage card 30 | shared/view/hud/layout.ts |
| Clear zone | `HUD_CLEAR_ZONE` x 0.25..0.75, y 0.22..0.78 of the safe area: nothing always-on may sit there | shared/view/hud/footprint.ts |
| Cursor | docs/CURSOR.md (gauntlet) is **planned, not built** (no cursor controller in `src/client`) | docs/CURSOR.md |

Three facts shape the design:

1. **The live HUD must never steal a click.** Any hover target or tooltip that is `Active` (or a GuiButton) would make
   a swing that starts over the status panel `gameProcessed` and drop it. So hover is found by **hit-testing rects**
   from a per-frame poll, never by making the cells buttons (ITD2). IT0 confirms a non-Active Frame leaves
   `gameProcessedEvent` false.
2. **The corner CanvasGroup clips.** A tooltip cannot be a child of the panel it describes; it lives in its own
   ScreenGui and is placed from the target's `AbsolutePosition` / `AbsoluteSize`.
3. **The pieces already exist.** Every line a tooltip needs is already a theme string; the work is a model that picks
   them, a widget that shows them, and making the three lists complete (relics, curses, boosts are missing from the
   Build list today).

## Player experience (target)

### The tooltip

```
 +--------------------------------------+
 | VOLATILE                       II/III |   name in its colour, level at right (pips with the UI art)
 | Common boon                           |   kind line, uiTextDim
 | Enemies you kill burst into a ring    |   current line, uiText, wrapped (never truncated)
 | of 8 bolts                            |
 | Next: 12 bolts                        |   next level (`.desc.2` is a short delta), uiTextDim
 +--------------------------------------+
```

Level lines are written as deltas (`boon.volatile.desc.2` = `12 bolts`), so `Next:` reads right; at level II the
evolution line is shown instead (`Evolves into Cataclysm: 16 piercing bolts`).

| Item | Kind line | Body |
|---|---|---|
| Boon, level I / II | `{rarity} boon` | the line at its level; `Next: {line at level + 1}`; at the level before the evolution: `Evolves into {evo name}: {evo line}` |
| Boon without levels (legendary, or a run without builds) | `{rarity} boon` | its line |
| Evolved boon | `Evolution of {boon}` (in `boon.evolved`) | the evolution's line |
| Duo | `Duo` (in `boon.duo`) | its line; `From {a} + {b}` (the two boon names in their colours) |
| Relic | `Relic` | its line |
| Curse | `Curse` (in `uiHealth`) | its line |
| Boost | `Boost` | its line; `{s} s left` (live, 10 Hz) |
| `+N` cell (status panel) | `{n} more` | the hidden items' names, one per line, in their colours (no descriptions) |

Max width `ITEM_TOOLTIP.maxWidth` (260 reference px), text wraps, the HUD scale applies. Panel: the `hud` skin with the
UI art (the run's dark frame), flat `uiPanel` without it. Appears with a 0.08 s fade (none under Reduced motion), hides
at once.

### Pause menu (solo and the co-op party overlay)

- The Build list becomes the **whole run's inventory**, in sections: **Boons** (evolved ones by their evolution's name),
  **Duos**, **Relics**, **Curses**, **Boosts** (running, with seconds left). Empty sections are left out. Each row as
  today (name, level, the short line truncated); the tooltip gives the full text.
- Too many rows: the list **scrolls** (mouse wheel; gamepad selection scrolls it into view) instead of the `+N` line
  (ITD5). Visible rows stay 12 / 8.
- **Mouse**: hover a row, the tooltip shows beside it after `menuDwellSec` (0.12 s): right of the list if there is room,
  else left (over the menu panel is fine: it is a hover).
- **Gamepad**: the rows are selectable; D-pad right from the pause buttons enters the list, left goes back. The focused
  row shows its tooltip at once. B still resumes / goes back as today.
- **Touch**: tap a row to pin its tooltip; tap it again or anywhere else to close.
- **Upright phone**: today there is no Build list. A **Build** item in the pause panel swaps the map area for the list
  (and back with **Map**) (ITD7).
- Co-op: the world keeps running under the party overlay; the list reads the same ~10 Hz snapshot.

### Live HUD (mouse only)

- Hovering a cell of the status panel's items row or the boost row shows its tooltip, placed **below the status panel**
  (flipping right if the screen is short), and always outside `HUD_CLEAR_ZONE` (a spec checks every HUD scale on the
  smallest landscape screen).
- Because the mouse is also the aim, the HUD tooltip is deliberately shy (ITD3):
  - it waits `hudDwellSec` (0.45 s) with the pointer **still** (moved < `hudStillPx` 4 px over the dwell);
  - not while Attack or Alt is held, nor for `hudAfterPressSec` (0.5 s) after a press;
  - not while the status panel is faded by the occlusion rule (the action is under it);
  - not during a draft, under the stage cover, in the pause overlay (the pause list has its own) or after run over;
  - it hides the moment the pointer leaves the cell or a weapon button is pressed.
- Hover never changes input: cells stay non-Active Frames, the tooltip is non-Active, and a swing that starts over the
  panel still swings (fact 1).
- Gamepad and touch: no live tooltips (no pointer; fingers are on the sticks). Their way in is the pause list.
- Spectating: the boost row shows the watched teammate's boosts, so its tooltips describe those; the items row stays
  yours (as the snapshot already does).
- Setting (ITD8): Options > Display > **Item tooltips in combat** (default On, overrides-only, doc stays v2). Off only
  stops the live HUD tooltips; the pause and run-over lists always have them.

### Run-over screen

- The same Build list (sections without Boosts: they ended with the run), same hover / focus / tap rules, scrolling
  where its column is capped (8 / 12 rows). The Again button keeps its focus and its 0.6 s arming (RR); the list is
  reached with D-pad / mouse.

## Design

| Piece | Where | Step |
|---|---|---|
| `ItemRef` (`{ kind: boon / duo / relic / curse / boost, index }`) on every `ItemCellModel` (the `+N` cell carries the hidden refs) and every Build list row; `buildListSections(boons, levels, duos, relics, curses, boosts)` replacing `buildListRows` for both lists (rows unchanged for boons / duos) | shared/view/hud/buildHud.ts | IT1 |
| `itemTooltip(ref, snapshotFacts) -> TooltipModel` (`title`, `titleRole`, `level?` / `max?`, `kindLine`, `lines: { text: HudText, role }[]`), all text as theme keys + params (`HudText`), the rules table above | shared/view/hud/tooltip.ts (new) | IT1 |
| `tooltipPlacement(anchor, size, safeArea, source)` (prefer side per source, flip, clamp; `hud` source never enters the clear zone) and `HoverTracker` (pure: per frame `{ hit?: ref + rect, nowSec, mouseDeltaPx, weaponHeld, pressedAgoSec, panelFaded, gate, focus?, tap? }` -> shown `{ ref, rect, source }` or none; dwell, stillness, press and fade rules, focus wins over hover, a tap pins) | shared/view/hud/tooltip.ts | IT2 |
| `ITEM_TOOLTIP` tunables (`menuDwellSec` 0.12, `hudDwellSec` 0.45, `hudStillPx` 4, `hudAfterPressSec` 0.5, `fadeSec` 0.08, `maxWidth` 260, `offset` 8, `displayOrder` 25: over the pause layer 20, under the loading / stage cover 30) | shared/view/hud/tooltipConfig.ts (new) | IT2 |
| Strings: `hud.tip.kind.boon` (`{rarity} boon`), `.kind.evolved` (`Evolution of {boon}`), `.kind.duo` / `.relic` / `.curse` / `.boost`, `hud.tip.next`, `hud.tip.evolves`, `hud.tip.duoFrom`, `hud.tip.secondsLeft`, `hud.tip.more`; section titles `hud.build.boons` / `.duos` / `.relics` / `.curses` / `.boosts`; pause item `pause.build` / `pause.map`; `options.display.hudTooltips`. Required keys built inside functions (contract.luau / validate.luau Luau-locals limit); `l10n/context.json` entries for each | shared/theme, packs, l10n | IT3 |
| `useTooltipTarget(ref, item, source)` hook: registers the GuiObject in a client registry (unregisters on unmount, React keys stable across snapshot updates) | client/ui/hud/tooltipTargets.ts (new) | IT4 |
| `TooltipController` (RenderStepped: the mouse when `aimDevice` is mouse, hit-test the registered rects (or `GetGuiObjectsAtPosition`, IT0 picks), `GuiService.SelectedObject` for focus, taps; steps `HoverTracker`; writes one store slice `tooltip`) and `ItemTooltip` in its own ScreenGui (`createKvScreenGui`, AutoLocalize off) | client/controllers/ui, client/ui/hud | IT4 |
| Pause Build list: sections, relics / curses / boosts rows, a ScrollingFrame, Selectable rows with D-pad neighbours, tap to pin | client/ui/hud/BuildList.tsx, PauseOverlay.tsx | IT5 |
| Live HUD: targets on `RunItems` cells (incl. the `+N` cell) and `BoostRow` cells in the status panel (not the touch strip); the occlusion fade read as `panelFaded` | client/ui/hud/RunItems.tsx, BoostRow.tsx, cornerFade.ts | IT6 |
| Run-over Build list: same component, scroll, focus order after Again | client/ui/hud/RunOverPanel.tsx | IT7 |
| Upright pause Build / Map toggle | PauseOverlay.tsx, shared/view/menu `pausePanelArea` | IT8 |
| `DisplaySettings.hudTooltips` (default On, only Off stored, doc stays v2), Options row | client/store/settings.ts, OptionsScreen.tsx | IT9 |

### Not changed

- The sim, scoring, drafts, the snapshot's fields and its ~10 Hz rate (boost seconds already update there).
- The status panel's footprint (`HUD_FOOTPRINT.status` 240 x 160) and the items row's one-row cap: the tooltip adds no
  always-on pixels.
- The draft cards (owner: no tooltips in the draft).
- Input mapping: hover never touches `mapDevicesToInput`; the pause list's gamepad focus uses the existing UI
  navigation mode.

### Reuse later

The Codex plan (`claude/codex-plan.md`, CX7) needs a detail panel per entry. `TooltipModel` / `itemTooltip` and the
`ItemTooltip` widget are written so CX7 can feed a catalog entry (no level, a found line) instead of an owned item.

## Tasks

Each step is a commit. Specs next to the code; `npm run verify` before each.

- [ ] **IT0. Spike (Studio, `KV_TooltipSpike`).** (a) A press that starts over a non-Active Frame in the HUD ScreenGui
  reports `gameProcessedEvent` false and swings. (b) Rect polling of ~40 registered targets vs
  `PlayerGui:GetGuiObjectsAtPosition` each frame: cost and correctness with the corner CanvasGroup faded (its
  children's `AbsolutePosition` still right). (c) Why not `MouseEnter`: confirm it misses fast moves / re-renders, or
  adopt it for the menus if it does not. (d) Gamepad: D-pad right from the pause buttons reaches the Build list rows,
  selection scrolls the ScrollingFrame. → Verify: results recorded in docs/SPIKES.md; this plan edited where a fact
  differs.
- [x] **IT1. Models.** `ItemRef` on cells and rows, `buildListSections`, `itemTooltip`. → Verify: specs for every boon
  at every level (incl. levelless legendaries and a run without builds), every evolution, duo, relic, curse and boost;
  the `+N` cell's refs; every key a model can emit exists in the placeholder and vale packs; the existing
  `buildHud.spec` rows unchanged for boons / duos.
  *As built (branch `it-core`):* `itemTooltip` / `moreTooltip` / `buildListSections` in shared/view/hud tooltip.ts.
  The `+N` tooltip's title is `Build` (`hud.build.title`) with `{count} more` as its kind line (the rules table).
  Additions: `TooltipLine.varRoles?` (colours of some vars: a duo's `{a}` / `{b}` in their boons' rarity roles, the
  evolves line's `{evo}` and the evolved kind line's `{boon}`; the client may draw them with RichText, else the line's
  role) and `itemNameLine(ref, facts)`. Boost rows in the Build list: name in the kind's colour, empty level, the row's
  line is `{seconds} s left` (the full description, whose "for 30 s" would read like the time left, is the tooltip's);
  seconds are the snapshot's tenths rounded up to whole seconds, in rows and tooltips alike.
- [x] **IT2. Placement and HoverTracker.** → Verify: pure specs: flip and clamp on every edge; a `hud` tooltip never
  enters `HUD_CLEAR_ZONE` at every `HUD_SCALE_PERCENTS` step on the smallest landscape screen; dwell, stillness, weapon
  held, after-press, faded panel, gates (draft, stage cover, pause, run over); focus beats hover; a tap pins and a
  second tap closes.
  *As built:* `tooltipPlacement` (menu: right / left / below / above, a side taken when it fits along its axis, the
  other axis clamped; none fits: the least move, clamped). `hud`: candidates under the panel, right of it, under the
  clear zone, over it; the first that fits the safe area (clamped) without touching `clearZoneIn(safe)` wins, else the
  clamped one covering the least of the zone. The clear-zone spec runs every HUD scale step on 844 x 390 (top bar on
  and off) and every test screen up to 100 %; ten-foot is left out (live HUD tooltips are mouse-only, and a 4-line
  tooltip fits no strip at 1280 x 720 ten-foot). `HoverTracker`: priority focus > tap pin > hover; a blocked `hud`
  hover (`!hudAllowed`, weapon held / pressed, within `hudAfterPressSec`, panel faded) hides at once and restarts its
  dwell once unblocked; once shown, moving inside the target keeps it; a pinned `hud` target unpins while
  `!hudAllowed`; the same `HoverShown` object while the target and its rect / panel are unchanged (a new rect: new
  object, same `shownAtSec`). The client calls `reset()` when its list closes. Addition: `sameTooltipTarget`.
- [x] **IT3. Strings.** → Verify: contract / placeholder / vale specs; `l10n:check`; `contract.luau` /
  `validate.luau` compile under Lune at or under 200 top-level locals.
  *As built:* the 18 `TOOLTIP_STRINGS` keys written out in contract.ts `REQUIRED_STRING_KEYS` after the builds keys
  (contract.luau stays 186 top-level locals), English in the placeholder pack (vale inherits it),
  `options.display.hudTooltips` ("Item tooltips in combat", `OPTIONS_STRINGS.hudTooltips`, checked like the other
  Options keys), `l10n/context.json` notes and glossary links. `{rarity} boon` takes the rarity name as a varKey, as
  `treasure.kept` does with `{tier}`.
- [x] **IT4. Widget and controller.** → Verify: `npm run build:place`; the tooltip renders in its ScreenGui over the
  pause layer; Reduced motion: no fade; nothing per frame allocates (the slice changes only on a new ref / rect).
  *As built (branch `it-client`; build:place and the render checks wait for Studio):* `client/ui/hud/tooltipTargets.ts`
  (`useTooltipTarget(ref, source, { panel, more, enabled })`: one registry entry per mounted component, its stable ref
  callback registers the GuiObject, a changed ref / hidden refs / clip bumps the entry's `version`; `TooltipClipContext`
  for a scrolling list; `MORE_CELL_REF` is the `+N` cell's identity, index -1, never an owned item).
  `client/controllers/ui/TooltipController.ts` (render step `KV_ItemTooltips`, after the camera): pointer =
  `GetMouseLocation()` minus `GuiService:GetGuiInset()` (GUI space, where every AbsolutePosition lives) only while
  `InputController.getAimDevice()` is the mouse; the registered rects hit-tested (a `menu` target wins, `hud` targets
  skipped while `!hudAllowed`, a list row only inside its ScrollingFrame); focus = `GuiService.SelectedObject` when it
  is a registered `menu` target; a touch tap (InputBegan / InputEnded of a Touch, within the new
  `ITEM_TOOLTIP.tapMaxSec` 0.4 and `tapMaxMovePx` 12) on a `menu` target, else `"elsewhere"`; `weaponHeld` = Attack or
  Alt in the last sampled InputFrame (`InputController.weaponHeld`, so rebinding, the pad and a press that began over a
  GUI all count) and `weaponPressed` its rising edge; `panelFaded` = the hit's corner panel transparency above 0
  (`cornerFadeValue`, written by HudOcclusionController); `hudAllowed` = a run is active, `selectMenuOpen` false (pause,
  party overlay, Options, leaderboards, outro, stage cover, loading), outcome playing, not paused, no open draft, and
  `hudTooltips` on. One mutable HoverFrame, one cached `TooltipTargetHit` per target rebuilt only when its rect, panel
  rect or version changes; the store's `tooltip` slice is written only when the tracker returns another object. The
  tracker is reset when `selectMenuOpen` turns false (the pause resumed, the run-over panel left) and when the shown
  target unmounted. `client/ui/hud/ItemTooltip.tsx`: `KV_ItemTooltip` (GameHud; `ITEM_TOOLTIP.displayOrder`,
  CoreUISafeInsets, UIScale = the HUD scale, AutoLocalize off), a non-Active CanvasGroup holding a `Panel` on the `hud`
  skin (flat `uiPanel` at `panelTransparency` without the art): title in `titleRole` with the level pips (the draft
  card's pip look, `ITEM_TOOLTIP.levelGap` new), the kind line, the body lines wrapped, never truncated. Width: the
  widest line's TextService width (+ the stroke slack), at most `maxWidth`. `varRoles` lines draw as RichText (template
  and vars escaped, each coloured var in a `font color` tag); the rest in the line's role. Placement: every frame its
  measured AbsoluteSize, the target's rect or the safe area (the ScreenGui's own rect) changed, `tooltipPlacement`;
  shown once its size held for a frame, faded in over `fadeSec` (none under Reduced motion), unmounted at once on hide.
- [x] **IT5. Pause list.** → Verify: `fit.spec.ts` still fits on the smallest phone landscape; scroll with 30+ rows;
  mouse, gamepad and touch each show the right tooltip.
  *As built:* `BuildList({ withBoosts })`: "Build", then `buildListSections` (section titles in `uiAccent` small text),
  at most `maxRows` lines (rows and titles, so the panel is never taller than the old list) and the rest in a
  ScrollingFrame (`OPTIONS_VIEW.scrollBar`, wheel / drag; scrolling only when needed); the `+N` line is gone. Rows are
  plain Frames, `Selectable` (the default selection look), registered `menu` targets clipped to the scroll frame.
  `PauseBuild` shows whenever anything is owned (relics, curses or a running boost count now). No explicit
  `NextSelection*`: Roblox's automatic navigation takes D-pad right from the centred buttons into the list and left
  back (IT0 (d) confirms or we set them). Scroll-with-30-rows and the three devices wait for Studio.
- [x] **IT6. Live HUD.** → Verify: the IT0 swing check in a real run; the tooltip never shows while firing or with the
  panel faded; the `+N` cell lists the hidden names.
  *As built:* `RunItems({ tooltips })` / `BoostRow({ tooltips })`: the StatusPanel passes `tooltips` (the TouchStrip
  does not, ITD9); every item cell (a duo chip as one target), the `+N` cell (its hidden cells' refs as `more`) and every
  boost cell (the shown player's) register as `hud` targets with panel `topLeft`. The checks wait for Studio.
- [x] **IT7. Run-over list.** → Verify: Again keeps its focus and RR's 0.6 s arming (recap specs unchanged).
  *As built:* the same `BuildList` with `withBoosts` false in all three run-over layouts; `hasBuild` counts relics and
  curses too (`hasBuildItems`). Nothing sets the selection: Again keeps its initial focus and the recap's arming is
  untouched; rows are reachable by D-pad (auto navigation) and mouse.
- [x] **IT8. Upright pause toggle** (if ITD7 holds). → Verify: `pausePanelArea` spec; fits 360 pt wide.
  *As built:* upright with anything owned, the pause panel gets one more button after its items (`pause.build`; while
  the list is shown `pause.map` where the solo map stands, else `pause.build` again in the party overlay). On, the map
  (solo) is replaced by `PauseBuild top` (compact width and rows, centred in the map's area) and the panel moves under
  it as with the map (`split`), co-op included. Off again at every open. fit.spec.ts: "with the upright Build / Map
  toggle" checks the pause estimate plus one button under the map on every portrait phone at 70 / 100 / 125 %.
- [x] **IT9. Setting** (if ITD8 holds). *Shared part built:* `DisplaySettings.hudTooltips` (`DEFAULT_HUD_TOOLTIPS` true, only Off stored, doc v2), codec specs; the Options row is the client's. → Verify: settings codec spec (overrides only, doc v2).
  *As built:* Options > Display row `hudTooltips` (On / Off) after HUD fade, shown when `UserInputService.MouseEnabled`
  (live tooltips are mouse-only; a touch-only phone's Display tab keeps its rows and fit).
  *Client checks (2026-11-06):* typecheck (tsc over the changed files' import closure) and ESLint (`--max-warnings=0`)
  on every changed file clean, `check:autolocalize` and `check:assets` clean, all in a container mirror of the
  worktree because the device shell was unavailable; `rbxtsc` (build), `build:place` and the Lune specs (fit.spec's new
  case, tooltip.spec) were **not run** and must be run before merging. Shared change: `ITEM_TOOLTIP` gained `levelGap`,
  `tapMaxSec`, `tapMaxMovePx` (tunables only). Unverified until the Studio check: that a non-Active Frame keeps
  `gameProcessedEvent` false (IT0 a), that InputObject.Position of a touch and a ScreenGui's AbsolutePosition under
  CoreUISafeInsets are in the same GUI space as `GetMouseLocation() - GetGuiInset()`, gamepad auto-navigation between
  the pause buttons and the list and the ScrollingFrame scrolling a selected row into view (IT0 d), the measured
  placement holding the tooltip hidden for its first laid-out frame, and the upright Build area fitting 8 rows.
- [ ] **IT10. Docs.** docs/ITEM_TOOLTIPS.md from this plan with as-built notes, docs/CLIENT.md, the CLAUDE.md docs table
  and decision log.
- [ ] **IT11. [owner] Studio check** (below).

## Studio check

1. Solo endless with `KV_Debug` boosts and a dev-mode floor 6 build: pause; every section present; hover each kind;
   levelled boon shows Next; the level before evolution shows Evolves into; a duo shows its recipe in colour.
2. Gamepad only: D-pad into the list and back, B resumes; the tooltip follows focus.
3. Touch landscape and upright: tap pins / closes; upright Build / Map toggle.
4. Live run, mouse: aim at enemies near the top-left corner while swinging and firing: **no tooltip, no lost swing**.
   Park the pointer on a cell: the tooltip after ~0.45 s, below the panel, never over the middle of the screen.
5. With bullets under the status panel (faded): no tooltip.
6. Co-op: party overlay list; spectating: the boost row's tooltip is the teammate's boost.
7. Run over: hover the list; Again still arms at 0.6 s.
8. HUD scale 70 % and the largest step; a long translated name (`en-XA`) wraps, not clips.

## Decisions (proposed)

- **ITD1. One tooltip model and widget for all three places** (pause, live HUD, run over), and later the Codex.
- **ITD2. Hover by polling rects, not buttons or `MouseEnter`** (fact 1). Keeps every HUD target non-Active, so aiming
  over the panel never loses a click; IT0 may allow `MouseEnter` in the modal menus only.
- **ITD3. The live HUD tooltip is shy:** dwell 0.45 s with a still pointer, not while a weapon is held or just
  pressed, not over a faded panel. Alternative: modifier key (hold Alt / Tab to inspect); rejected for v1, it costs a
  binding and Alt is the alt-fire.
- **ITD4. Tooltip placement for the HUD is below the status panel, outside the clear zone**, never at the pointer: it
  must not cover the fight.
- **ITD5. The pause and run-over lists scroll** instead of the `+N` cap (a deep build passes 12 rows). The status
  panel keeps its one-row `+N` cell, which now has a tooltip.
- **ITD6. The Build list shows relics, curses and running boosts too**, in sections; the title stays `Build`.
- **ITD7. Upright phones get a Build / Map toggle** in the pause panel (today they have no list at all).
- **ITD8. One Display setting, "Item tooltips in combat"** (default On), for players who find the live hover noisy;
  menu tooltips always on.
- **ITD9. No tooltips on the touch strip or with a gamepad mid-run**; the pause list is their way in.
- **ITD10. Text is shown, not explained:** the tooltip uses the existing lines (current, next, evolution, recipe); no
  new per-item copy, so translation cost is ~20 strings, not ~120.

## Risks

- **Aim conflict on the live HUD.** Mitigated by ITD3 / ITD4 and the setting; IT0 and Studio check 4 decide.
- **Fit.** The pause list gains rows and a scroll frame; `fit.spec.ts` on the smallest phone is the gate (IT5).
- **Gamepad navigation** between the centred pause buttons and the side list may pick odd neighbours; set
  `NextSelectionRight` / `Left` explicitly if IT0 shows it.
- **Tooltip vs the coming gauntlet cursor** (docs/CURSOR.md): a hover target is not a button, so the cursor keeps its
  normal colour; revisit if the owner wants the hover gauntlet on items.
- **Luau locals** in contract.luau / validate.luau: the new keys go inside the existing key-list functions.

## Later

- A modifier-key inspect mode mid-run; teammates' builds in the co-op overlay (the snapshot carries only yours);
  tooltips on draft cards for owned boons / duo recipes; the Codex detail panel (CX7) on the same widget.
