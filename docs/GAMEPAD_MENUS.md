# Gamepad menus: every menu usable with a controller

Status: plan (2026-11-06), owner calls answered the same day. Tasks GM0-GM12, decisions GMD1-GMD16.

**Goal.** A player with only a controller can reach and use every menu, panel, prompt and overlay in the game,
starting on a sensible button, with B always going back, never stuck with nothing selected, and every scrolling
list scrollable. The navigation also has to look right: one focus ring, never Roblox's default selection box on top
of ours.

**Scope.** Client input and presentation only. No sim, dungeon, lockstep, hash, replay, fixture or score change. Co-op
already sends neutral input while a menu owns the pad (`InputController.menuOwnsInput`, `CoopMenuInputGate`); this
plan does not change that.

## What already works (census, 2026-11-06)

A lot is already in place. The groundwork:

- `MenuButton` (client/ui/hud `primitives.tsx`) is the single interactive primitive. It is `Selectable`, and it draws
  focus from `SelectionGained` / `SelectionLost` (a uiAccent stroke, or the art's `FocusCorners`). Disabled buttons
  stay selectable on purpose.
- `useGamepadFocus(ref, key)` (client/ui/menu `hooks.ts`) selects a screen's default button whenever the device is a
  gamepad. It skips this while a panel is open or the stage cover is up, and clears what it set on cleanup.
- HudController turns gamepad UI navigation on through `selectMenuOpen`. InputController then passes A / B / D-pad /
  left stick (`UI_NAV_KEYS`) through to the GUI instead of sinking them, and turns off the D-pad-down restart.
- B closes the Options and leaderboard panels (`FIXED_INPUTS.padMenuClose`). It also goes back a screen, closes the
  Leave confirm and closes the party overlay (MenuController, `MENU_BACK_KEYS`).
- A rebind capture turns `GuiNavigationEnabled` off. Options returns focus to the slot that opened a prompt.
  LocaleRoot puts the selection back after a locale remount. A focus move plays `sfx.ui.move`.
- The boon draft (including Greed's deal and bonus deals) uses sim input: the stick picks and RT takes. The shrine
  takes A. Spectating cycles with Attack / Alt.

| # | Surface | Default focus | B | Scroll | Gap |
|---|---|---|---|---|---|
| 1 | Join loading screen (Skip) | Skip (hand-rolled) | - | - | none |
| 2 | Stage cover | cleared (`StageController.begin`) | - | - | none |
| 3 | Main menu (+ Daily card) | Play solo (`useGamepadFocus`) | nothing at root | - | Back from a sub-screen lands on Play, not the button you left from. Daily card buttons are reached only by geometry. Invite toasts can be reached by accident |
| 4 | Lobby browser | first button | back | rows in `ScrollList` | A list refresh that removes the selected row leaves **nothing selected** |
| 5 | Lobby room | first button (keyed on inviting) | back | members, friends list | Same refresh problem (kick, leave, invite list). Ready / Invite take many presses |
| 6 | Credits | Back | back | list `selectable` | The selected list shows no focus ring (to check) |
| 7 | Invite toasts (top right) | not reachable on purpose | - | - | **Cannot be answered on a pad** except by stumbling onto them |
| 8 | Options (all tabs, prompts) | first tab; prompt focus, return focus | closes | bindings list | Tabs only by D-pad (no bumpers). Long Display / Juice tabs to check on a small screen |
| 9 | Leaderboard panel | first scope tab (hand-rolled) | closes | rows `Selectable={false}` | **The top-100 list cannot be scrolled on a pad**. Tabs only by D-pad |
| 10 | Pause overlay (solo) | Resume (hand-rolled) | **nothing** | - | B should resume |
| 11 | Leave run confirm | its first button | No | - | none |
| 12 | Tutorial skip confirm | its first button | **nothing** (`tutorial.skipConfirm` is not in MenuController's back path) | - | B should cancel |
| 13 | Party overlay (co-op) | first item | closes | - | none |
| 14 | Run-over panel + recap | Again, armed at 0.6 s (`RunOverRetryGate`) | nothing | breakdown / Build list behind Details | Details takes D-pad presses. Whether a long Build list fits or scrolls is untested |
| 15 | Tutorial outro | Start my first run (hand-rolled) | nothing | - | none |
| 16 | Boon draft / Greed deal | sim input | nothing (by design) | - | none |
| 17 | Full map overlay | D-pad left toggles | B is skill 2 in play | - | none (not a menu: the run goes on) |
| 18 | Roblox menu, invite prompt | CoreGui | CoreGui | CoreGui | none (engine) |
| 19 | Dev panel (F2) | none | none | - | Keyboard-only, with a TextBox (GMD10) |

Problems that cut across surfaces:

- **No focus scope.** No surface uses `SelectionGroup` or `SelectionBehavior*` (zero hits in `src/`). A D-pad press
  at a screen's edge can jump to any Selectable in any ScreenGui: invite toasts, a screen under a panel, the HUD.
- **No recovery.** When the selected button is destroyed or hidden (a list refresh, a disabled to hidden swap, a
  tab change, a prompt closing badly), `SelectedObject` ends up nil, and a D-pad press does not select anything again.
- **Double focus visual.** `SelectionImageObject` is never set, so Roblox draws its default selection box over
  MenuButton's own ring or corners (to confirm in GM0).
- **Six hand-rolled focus effects** (LoadingScreen, Options, RunOver, Leaderboard, TutorialOutro, PauseOverlay) next
  to `useGamepadFocus`, each with its own rules about panels and the cover.
- **No focus memory.** Closing a panel or going back re-selects the default (for example Resume after Leaderboards).
  Only Options remembers.
- **Text glyphs.** Hints say "A" / "B" (`MENU_BACK_HINT`, bindings `inputLabel`), which is wrong on a PlayStation pad.
- **Mouse after pad.** When the device switches to mouse, the pad's selection can stay lit under the cursor.

## Design

### 1. Focus scopes (one owner at a time)

Each surface that takes the pad is a **focus scope**:

- The surface's root frame gets `SelectionGroup = true` and `SelectionBehaviorUp/Down/Left/Right = Stop`, so the
  selection never leaves it by direction.
- Its default button gets a negative `SelectionOrder` (the scope's default), so `GuiService:Select(root)` lands on it.

Scopes register with `useFocusScope(rootRef, { id, layer, defaultRef?, memoryKey? })`. This replaces `useGamepadFocus`
and the six hand-rolled effects. Several scopes can be mounted at once (a panel over the pause overlay over the run).
**The pad belongs to the topmost layer only.** The order is data, `FOCUS_LAYERS`, in shared/view/menu `focus.ts`:

```
loading (30) > stage cover (no focus) > rebind prompt > confirm (leave / skip / swap / reset)
  > panel (Options, Leaderboards) > invites (only when jumped to, 4.3) > overlay (pause, party, run over, outro)
  > screen (main, lobbies, lobby, credits)
```

The rule is pure and tested: `pickFocusScope(mounted) -> id | undefined`. While the stage cover is up, no scope gets
focus. A rebind capture keeps navigation off, exactly as today.

### 2. FocusController: recovery, memory, device changes

A new client controller, `client/controllers/ui/FocusController.ts`. On every `SelectionChanged`, on scope
mount / unmount, and once a frame while the device is a gamepad, it checks one pure decision,
`focusAction(state) -> keep | select(default) | restore(memory) | clear`:

- **Recovery.** If the device is a gamepad and a scope owns the pad, and the selection is nil, outside that scope,
  not visible (the GuiObject or any ancestor is hidden), or not Selectable, the controller selects the remembered
  button if it still exists. Otherwise it calls `GuiService:Select(scopeRoot)`, which lands on the default. This fixes
  lobby list refreshes, tab changes and remounts in one place.
- **Memory.** On losing the pad (going back, or a panel opening over it), each scope records the selected button's
  path under the scope (by `Name`, like LocaleRoot's `pathFromPlayerGui`). When it owns the pad again, that button
  comes back. Main menu > Lobbies > Back lands on Lobbies. Pause > Leaderboards > close lands on Leaderboards. Memory
  lives for the session and is never stored (GMD9). A screen can opt out (run over: always Again).
- **Device changes.** Moving to mouse or touch clears the selection (`clear`). Picking up the pad again restores the
  owner's memory or default (today's `useGamepadFocus` behaviour, kept).
- **One selection look.** On start, `PlayerGui.SelectionImageObject` is set to an empty, fully transparent frame, so
  only MenuButton's own focus shows. Selectable non-buttons (lists) draw their own ring (section 5).
- Debug: `KV_FocusDebug` (Workspace attribute, off by default) prints owner changes and selection paths.

LocaleRoot's remember / restore stays. With recovery in place it becomes a fast path, not the only safety net.

### 3. Menu buttons (fixed, menus only)

While a menu owns the pad, these mean the same thing on every surface. A pure table, `menuPadAction(surface, key)`,
in shared/view/menu `padActions.ts` holds them:

| Pad | Meaning |
|---|---|
| A | press the selected button (engine) |
| B | back / close / cancel / resume: never destructive on a tap (GMD5). Run over: **hold** B to exit (GMD13) |
| D-pad, left stick | move the selection (engine) |
| LB / RB | previous / next tab on surfaces with tabs (Options top tabs, Leaderboard scope) |
| LT / RT | previous / next sub-tab (Options > Controls device, Leaderboard board) |
| Right stick | scroll the scope's main list (section 5) |
| X / Y | one contextual shortcut each, shown in the hint bar (section 4) |
| Start | pause overlay: resume (today). Elsewhere nothing |

B handling moves into one path, ordered by layer: confirm prompt, panel, invites, overlay, screen. It also covers
the two gaps found above: **solo pause B = Resume** (through the same action as the Resume button) and **tutorial skip
confirm B = cancel**. A tap of B on the run-over panel, the tutorial outro and the draft does nothing.

**Hold B to exit (run over, GMD13).** On the run-over panel, holding B for `GAMEPAD_MENU.holdExitSec` (0.6 s) does
exactly what the Exit button does: Main menu, or Back to lobby in a party run. While B is held, the Exit button fills
(a uiAccent fill under its label, from 0 to the full width, from a pure `holdProgress(heldSec, holdSec)`). Letting go
early empties it with no effect. A B press that began before the panel opened never counts (the same edge rule as
`RunOverRetryGate`). Completing the hold plays `sfx.ui.back` and a haptic tick. Again stays the default and keeps its
0.6 s arm. The hint bar shows `[B] Hold: Exit`.

Input plumbing. LB / RB / LT / RT / X / Y / right stick are game bindings, sunk at High priority while a menu is open
(they are not in `UI_NAV_KEYS`). InputController gains `onMenuPadInput(listener)`, fired for those keys only while
`menuOwnsInput()`, like `onMapAction`. FocusController subscribes to it. They still never reach the sim.

On menu close, every pad button still held is blocked until it is released (`padGate.block`, as on a bindings
change). That way an A held through Resume never fires skill 1 / the shrine, and an LB held through a tab change never
rolls. GM0 checks whether today's code already does this.

### 4. Shortcuts and the hint bar

**4.1 Hint bar.** `PadHintBar`, a row at the bottom of each scope's panel, shown only on a gamepad. Example:
`[A] Select  [B] Back  [LB][RB] Tabs  [Y] Invite`. It comes from a pure `padHints(surface, ctx)` in shared/view/menu
`padHints.ts`, built from the same table as `menuPadAction`, so a hint can never name a button that does nothing.
On a pad it replaces each screen's text back hint (`MENU_BACK_HINT` stays for keyboard).

**4.2 Glyphs.** The bar draws `UserInputService:GetImageForKeyCode(key)` (the platform's own Xbox / PlayStation art).
If that returns empty, it falls back to a text label from `GetStringForKeyCode`, then to our `inputLabel`. Glyphs
inside localized sentences (tutorial prompts, `{key}` templates) stay text, but the gamepad label set becomes
platform-aware (`padLabelSet`: `xbox` / `playstation`, picked from the connected pad; GM0 finds out what the engine
reports).

**4.3 Shortcuts (first set):**

| Surface | X | Y |
|---|---|---|
| Main menu | - | jump to the newest invite toast (shown only while one is pending) |
| Lobby browser | Refresh | Create |
| Lobby room | Ready | Invite (Roblox prompt) |
| Run over | Details / Highlights | - |
| Options | Reset this tab, exactly as this tab's Reset button: Controls asks first, the others reset at once | - |

The invite toasts become their own scope, entered **only** through Y, never by direction. B returns to the screen
with its memory.

### 5. Scrolling

- Text-only lists become Selectable, and when selected they show a uiAccent stroke (a `focused` look in `ScrollList`,
  client/ui/menu `widgets.tsx`). This covers the leaderboard rows (today `Selectable={false}`), Credits (already
  selectable, ring missing) and the run-over breakdown / Build list if GM0 shows they can overflow.
- The right stick scrolls the scope's main list wherever the selection is, by `GAMEPAD_MENU.scrollStepPx` per
  `scrollRepeatSec` past a dead zone. A scope names its list with `scrollRef`.
- Lists of buttons (lobbies, friends, bindings) rely on the engine scrolling to the selected descendant. If GM0 shows
  it does not, `followSelection` sets `CanvasPosition` so the selection stays inside the frame with a margin (pure
  `scrollToShow(canvas, item, view, margin)`).

### 6. Per-surface fixes

| Surface | Change |
|---|---|
| Main menu | Scope + memory. Explicit `NextSelectionRight/Left` between the menu column and the Daily card if GM0 shows geometry picks wrong. Y to invites |
| Lobby browser / room | Scope + recovery (refresh), memory. X / Y shortcuts. Rows already keep stable keys (`r.lobbyId`, `m<userId>`, `c<userId>`), so a refresh only loses the selection when its own row goes |
| Credits | Scope, list ring |
| Invite toasts | Own scope (layer `invites`), entered only by Y |
| Options | Scope (layer panel). LB/RB tabs, LT/RT device sub-tab. X reset. Prompts as confirm layer (the hand-rolled return focus moves into memory) |
| Leaderboard | Scope. LB/RB scope, LT/RT board. Selectable list + right stick |
| Pause / party overlay | Scope + memory. B resumes (solo) |
| Leave / skip / swap / reset confirms | Confirm layer. B = the No / Cancel button |
| Run over | Scope, default Again (no memory). X Details. Hold B: Exit, with the fill on the Exit button. `RunOverRetryGate` unchanged |
| Tutorial outro, loading Skip | Scope only (behaviour unchanged) |
| Draft, shrine, spectate, full map | No change (sim input / gameplay keys) |

## As built (GM2-GM4, 2026-11-06)

- **Registry.** `client/ui/focus` (its own directory: hud and menu both use it): `useFocusScope(rootRef, { id, layer,
  surface, defaultRef?, memoryKey?, active?, padContext?, onPadAction? })` and `<FocusScope name ...>` (a transparent
  full-size frame for a surface without a root of its own: menu screens, run over, invite toasts). Options are read
  again every render. `FocusScopesContext` is provided by HudController and LoadingController with the client's
  `FocusController` (components never import controllers). `useOpeningId(open)` gives a session-unique id per opening,
  put in a memory key by surfaces that should start on their default each time they open (pause, Options).
- **FocusController.** Owner = `pickFocusScope` over the scopes whose root is drawn (Visible chain, ScreenGui Enabled).
  Every drawn root gets SelectionGroup + four Stop behaviours, its default `GAMEPAD_MENU.defaultSelectionOrder` (-1).
  `focusAction` runs on SelectedObject changes, mounts / unmounts / option changes, device / cover / capture changes
  (deferred to the end of the frame) and every frame on a gamepad. Memory is recorded continuously while a scope owns
  the pad and holds a usable selection (equal to "on losing ownership", but also survives the selected button being
  destroyed in the same commit). Nothing is touched while the Roblox menu is open, during a rebind capture, or while
  `KV_PadSpike` runs (it also gets the original SelectionImageObject back). `KV_FocusDebug`
  (`GAMEPAD_MENU_ATTRIBUTES.focusDebug`) prints owner changes, selections and dispatched pad actions.
- **Device.** `InputDeviceTracker.padPressed`: a pad button press or a stick past `STICK_DEADZONE` makes the device
  gamepad even when no run samples input (the menus before the first run never did: the old `useGamepadFocus` could not
  select Play solo on a fresh join).
- **B (GM3).** FocusController's InputBegan sends ButtonB to the owner only (`menuPadAction`): one press, one action.
  MenuController keeps Backspace exactly as before (ButtonB removed from its path); SettingsController and
  LeaderboardController lost their pad-B handlers (folded into the Options / prompt / leaderboard scopes).
- **Menu pad input (GM4).** `InputController.onMenuPadInput`: LB / RB / LT / RT / X / Y (`MENU_PAD_INPUT_KEYS`, sunk by the
  CAS sink whether bound or not, never the map while a menu is open; a driver key still, see the review fixes) and right-stick steps
  (`PadStickRepeat`: on leaving `stickDeadZone`, then every `scrollRepeatSec`, axes in the input), only while a menu owns
  the pad and no capture runs. Closing a real menu blocks every held pad button and trigger until released
  (`blockHeldPadInputs`, `padGate.block`; not the cover or loading screen ending, see the review fixes). Start keeps its
  own pause path (not dispatched).
- **Tabs.** Options LB / RB = top tabs, LT / RT = the Controls device (Controls tab only); Leaderboard LB / RB = scope,
  LT / RT = board. `stepTab` clamps: at either end nothing happens and no sound plays (a held bumper never cycles round).
  A change plays `sfx.ui.click`. Options' default is the current tab's button.

| Surface | Scope id | Layer / surface | Default | Memory | B |
|---|---|---|---|---|---|
| Loading | `loading` | loading / loading | Skip | - | nothing |
| Main menu | `main` | screen / main | Play solo | `main` | nothing |
| Lobby browser | `lobbies` | screen / lobbies | first New / Your lobby | `lobbies` | back |
| Lobby room | `lobby` | screen / lobby | Ready | `lobby<lobbyId>` | back |
| Credits | `credits` | screen / credits | Back | - | back |
| Invite toasts | `invites` | invites / invites, active after main menu Y (GM6) | newest Join | - | back to the screen |
| Options | `options` | panel / options | current tab | `options<opening>` | close |
| Options prompt (swap / reset) | `optionsPrompt` | confirm / confirm | Swap / Reset | - | Cancel's action |
| Leaderboard | `leaderboard` | panel / leaderboard | first scope tab | - | close |
| Pause / party overlay | `pause` | overlay / pause or party | Resume | `pause<opening>` | resume / close |
| Leave / skip confirm | `pauseConfirm` | confirm / confirm | Cancel / Keep playing | - | Cancel's action |
| Run over | `runOver` | overlay / runOver | Again (else Exit) | - | hold: Exit (GM9) |
| Tutorial outro | `outro` | overlay / outro | Start my first run | - | nothing |

## As built (GM5-GM12, 2026-11-06)

Built without a Studio run: the GM0 spike's results are not in yet, so every engine call is behind pcall with a
fallback, and the facts the code assumes are listed under "Studio check" below.

- **Pure core (shared/view/menu).** `padScroll.ts`: `padScrollStep(canvasY, maxY, stickY, stepPx)` (one clamped
  right-stick step, which end it pushed into), `scrollMaxY`, `ScrollEndLatch` (the list end's tick once per arrival,
  rearmed when the list leaves that end). `padFeedback.ts`: `padGlyph` (engine image > engine text when it says more than
  the KeyCode's name > our `inputLabel`), `menuHapticsOn` (gamepad and vibration On), `hapticTimeline` (a cue's
  MENU_HAPTICS pulses as on / off motor events in time order), `padConfirmFeedback` (a MenuButton activation is a
  confirm / disabled press only on the pad within `GAMEPAD_MENU.confirmPressWindowSec` of ButtonA). `fit.ts`:
  `menuSafeShare(tenFoot)` (GAMEPAD_MENU.tvSafe on a ten-foot interface, else none; clamped to `MENU_SAFE_MAX_SHARE`)
  and `menuFitOn(touch, tenFoot)`. `padActions.ts`: a new condition `canCreate` (the lobby browser's Y only while
  Create is on screen, i.e. not in a lobby). Tunables: `GAMEPAD_MENU.confirmPressWindowSec` / `holdFillTransparency`,
  `PAD_HINT_VIEW` (glyph size and gaps). Specs: `padFeedback.spec.ts` (scroll, latch, glyphs, haptics, TV-safe fit),
  `padActions.spec.ts` (canCreate, the lobby browser's hints).
- **GM5 scrolling.** `FocusScopeOptions.scrollRef` names a scope's main list: FocusController moves its
  `CanvasPosition` by `scrollStepPx` per right-stick step (`PadStickRepeat` in InputController), clamped, and plays
  `listEnd` once per arrival; `scroll` then never reaches `onPadAction`. Scopes with a list pass
  `padContext.scrollList`: Credits, lobby browser (rows), lobby room (members; on a phone while inviting the invite
  list), Options (the Controls list, or the compact body `FitScroll` `listRef`), Leaderboard (rows, only when there are
  rows). `followSelection`: on each newly selected button inside a vertical ScrollingFrame under the owner's root, the
  canvas is moved with `scrollToShow` (`followMarginPx`); once per selection, so it never fights the stick, and a
  frame already showing the button is left alone. Canvas units are taken as the unscaled px under every UIScale above
  the list (`uiScaleAbove`). Selectable text lists draw `ListFocusStroke` (client/ui/hud primitives: a uiAccent
  stroke on its parent while selected): `ScrollList selectable` (Credits) and the leaderboard rows (now
  `Selectable`). `ScrollList` forwards its ref. The run-over Build list keeps its `maxRows` cut (no scroll).
- **GM6 shortcuts and the invites scope.** Through each scope's `onPadAction`, reusing the buttons' own actions and
  sounds: main menu Y (only with a toast on screen) hands the pad to the invite toasts; lobby browser X Refresh,
  Y Create (the picked visibility); lobby room X Ready (while `canReady`), Y the Roblox invite prompt
  (`inviteFriendsToLobby`, the "Invite friends (Roblox)" button's action, while `platformInviteButton` is enabled; the
  in-server Invite panel toggle stays a button); run over X Details / Highlights (while there are highlights);
  Options X this tab's Reset exactly as its button: **Controls asks first (askResetBindings); Juice / Audio / Display
  reset at once, as their Reset button always has** (owner call below), never while a prompt is open. Invite toasts:
  MenuLayer reads them once (`useInviteToasts`), holds `invitesFocused` (cleared on B, when the last toast goes, or
  on leaving the main menu) and passes it as the `invites` scope's `active`; its default is the newest (last shown)
  toast's Join; B plays `sfx.ui.back` and returns, the main menu's memory restores its button.
- **GM7 hint bar.** `PadHintBar` (client/ui/hud `PadHintBar.tsx`): `padHints(surface, context)` as `[glyph] label`
  items (UIListLayout `Wraps` for narrow panels), only while the device is the gamepad; inside each panel, so the HUD
  scale and MenuFit apply. Glyphs: `UserInputService:GetImageForKeyCode` in an ImageLabel (engine content at runtime,
  GMD8; `check-asset-ids` stays clean), else `GetStringForKeyCode` text, else `inputLabel`, on a uiPanel plate. Labels
  are `pad.hint.*` in the locale's font. Placed on: main menu (bottom), lobby browser, lobby room, credits, Options and
  its swap / reset prompts, leaderboard, pause / party / leave and skip confirms, run over (last row; compact: the left
  column), tutorial outro, the invite toasts while focused. On a gamepad it replaces the screens' text back / key
  hints (keyboard and touch unchanged). `padLabelSet` (platform-aware text labels in localized sentences) is not built:
  it waits for GM0's answer on what the engine reports per pad.
- **GM9 haptics, vibration, hold B.** `PadHapticsController` plays `hapticTimeline` on the navigation pad (else the
  first connected) with `HapticService:SetMotor`, only on motors `IsVibrationSupported` / `IsMotorSupported` report,
  every call behind pcall; silent unless gamepad + `padVibration` On; a newer cue on a motor drops an older one's later
  events (per-motor generation); motors back to 0 on cleanup. HapticEffect is not used. Cues: `confirm` / `disabled`
  (MenuButton's Activated calls `FocusScopeRegistry.buttonPressed(disabled)`; FocusController checks, deferred one
  step, that ButtonA went down within the window), `listEnd` (GM5), `holdComplete`. Options > Controls > Gamepad has a
  Vibration On / Off row (`padVibration`, `options.controls.vibration`, saved like the other display overrides). Hold
  B: while the owner's B means `holdExit`, FocusController polls `IsGamepadButtonDown(pad, ButtonB)` on every
  connected pad each frame into `PadHoldGate` (opened when the scope takes the pad, with B's state then) and writes the
  fill to `PAD_HOLD_UI.progress` (client/ui/focus `padHold.ts`, a React binding); the Exit button draws it
  (`MenuButton fill`: a uiAccent `HoldFill` under the label; skinned buttons: between art and label, `SKIN_Z` 1 / 2 / 3
  / 4; flat buttons draw their label as a child above the fill). On complete: `holdComplete` haptic, then the scope's
  `holdExit` (RunOverPanel: `sfx.ui.back` + `exitRun`, Main menu or Back to lobby). A B press on run over dispatches
  nothing. `RunOverRetryGate` and Again's default are untouched.
- **GM12 console.** client/ui/hud `isTenFootInterface()` (GuiService, pcall, read once). MenuFit on a ten-foot
  interface: the measured area frame is inset by `menuSafeShare` on each side and the panel is fitted into it as on
  touch (`menuFitOn`; compact / narrow layouts stay touch only); elsewhere the frame is exactly as before (no Position
  set). `ConsoleController` turns `ChatWindowConfiguration` and `ChatInputBarConfiguration` off on a ten-foot interface
  only (waits for them to appear; restores on cleanup). Nothing changes on a PC or a phone.

**Studio check (GM11 / GM0) must confirm:** CanvasPosition's units under a UIScale (the right-stick step should be
`scrollStepPx` reference px; follow should land the row `followMarginPx` inside the frame); whether the engine also
scrolls to a selected descendant (both must agree, no jitter); a selected ScrollingFrame (Credits, leaderboard rows)
shows the ring and the D-pad still leaves it; ButtonA reaches `UserInputService.InputBegan` while a GUI button has the
selection (else no confirm haptic); `IsGamepadButtonDown` reports B while GUI navigation is on (else no hold);
`GetImageForKeyCode` returns art for A / B / X / Y / LB / RB / LT / RT / the right stick on Xbox and PlayStation pads;
the motors' feel at MENU_HAPTICS' strengths; the hold fill reads under the Exit label (flat and skinned); Y on the main
menu with `KV_FakeFriends` selects the newest Join and B returns to the button you left; on the console emulator the
TV-safe inset and no chat window.

**Owner call (answered).** Options X on the Juice / Audio / Display tabs resets at once, because their Reset button
does (only Controls asks first): intended, kept.

## As built (review fixes, 2026-11-06)

- **Resume input leak (solo pause B / A / Start).** Paused frames never step the sim, so its `prevButtons` lacked the
  B (or A) that pressed Resume and the first unpaused tick read a fresh press (skill 2 / skill 1). New
  `InputController.blockHeldPadInputs(alsoHeld?)` blocks every pad button and trigger held right now
  (`padGate.block`). SimController calls it before every unpause of a solo run (`unpause`: `resume()` from the Resume
  button and pad B, the Roblox menu closing, the Options panel closing) and after a frame whose PAUSE edge (P / Start)
  resumed it. FocusController also blocks the key that drove any menu action (B, X, Y, the bumpers, the triggers) as
  it dispatches it. The mouse keeps `suppressMouseUntilRelease` unchanged.
- **Pad restart on a menu key.** The CAS sink's menu-key branch reports the driver keys again (`reportDriverOnly`,
  never the map), so a pad restart rebound to LB / RB / LT / RT / X / Y works where `driverKeyAction`'s RestartWindow
  allows it (run over, paused). **The player's restart binding wins over a shortcut on the same key**:
  `PadContext.restartPad` (FocusController and PadHintBar fill it from `selectBindings(...).pad.restart`);
  `menuPadAction` answers none for an X / Y shortcut on that key and `padHints` leaves it out (`padShortcutYields` /
  `padRowYields`). Only shortcuts yield: tabs, sub-tabs, scrolling, A, B and Start keep their menu meaning.
- **CoreGui prompts.** `CorePromptGuard` (focus.ts): while `GuiService.SelectedCoreObject` is set (pcall; not in
  @rbxts/types, and the Studio check must confirm a game script may read it, else only the invite tracking holds) or
  while our invite prompt is open (LobbyController calls `FocusController.invitePromptOpened` on the request / the
  client-side prompt, `invitePromptClosed` on the local `GameInvitePromptClosed`, a failed client prompt or an
  `invitePrompt` refusal; at most `GAMEPAD_MENU.invitePromptHoldSec`), and for `corePromptGraceSec` after,
  FocusController skips its evaluation (no recovery stealing the selection back), the pad dispatch (the B that closes
  the prompt never goes back a screen) and the hold-B fill.
- **Cover / loading blocks.** `setUiNavigation` no longer blocks held buttons. `selectMenuShown` (client/store
  selectors: `selectMenuOpen` without the stage cover and the loading screen; `selectMenuOpen` is built on it) turning
  off is what blocks them (HudController), so RT held through a stairwell card keeps firing. The cover's neutral input
  (SimController `coverGate`) is unchanged.
- **Lobby memory.** The lobby room's memory key is `lobby<lobbyId>`: a new lobby opens on Ready.
- **Haptics, two pads.** `HapticGenerations` (padFeedback.ts): generations per pad + motor from one counter, so a cue
  on one pad never drops another pad's "off". Every motor set goes back to 0 on every pad on cleanup, on vibration Off
  and when the device leaves the gamepad (pending pulses dropped).
- **Pad spike.** The spike reads a SelectionImageObject named `NO_SELECTION_IMAGE_NAME` (FocusController's empty
  frame, destroyed when the spike starts) as no original, so it never puts a destroyed frame back.
- **Display reset.** The Display tab's Reset (and Options X there) keeps `padVibration` (`displayResetOverrides`,
  `DISPLAY_RESET_KEEPS`, shared/settings): it is shown on Controls > Gamepad.

## Tasks

- [ ] **GM0. Spike `KV_PadSpike`** (docs/SPIKES.md, off by default, Janitor). Record, with an Xbox pad and (if
  available) a PlayStation pad on PC, and on console if the owner targets it:
  - Is the default selection image drawn over a MenuButton? Does an empty `SelectionImageObject` hide it?
  - Does a ScrollingFrame scroll to a selected descendant? Does a selectable ScrollingFrame scroll with the left stick?
  - What does `SelectedObject` become when the selected button is destroyed, or hidden?
  - Does `SelectionBehavior = Stop` hold across ScreenGuis with different DisplayOrder?
  - Does `GuiService:Select(root)` honour `SelectionOrder`? (A 2022 thread reports a bug.)
  - What do `GetImageForKeyCode` / `GetStringForKeyCode` return per pad? Does Start reach the game? What does
    ButtonSelect do (virtual cursor)?
  - Does a held A / LB leak into the sim after a menu closes?
  - Haptics: does `HapticEffect` work in this engine version, and on which pads? Otherwise, does `HapticService`
    (`IsVibrationSupported`, `IsMotorSupported`, `SetMotor`) work? What do the small and large motors feel like on
    Xbox and PlayStation pads?
  - Console signals: `GuiService:IsTenFootInterface()`, `GuiService.ViewportDisplaySize`, and the TV-safe inset
    (`GuiService:GetGuiInset()` / the ScreenGui safe-area modes) on a console, or in the Studio console emulator.

  → Verify: the results table is filled in docs/SPIKES.md, and every "if GM0 shows" branch below is decided.
- [ ] **GM1. Pure core.** shared/view/menu `focus.ts` (`FOCUS_LAYERS`, `pickFocusScope`, `focusAction`,
  `FocusMemory`, `scrollToShow`), `padActions.ts` (`menuPadAction`), `padHints.ts` (`padHints`); tunables
  `GAMEPAD_MENU` in shared/view/menu `config.ts`; specs next to each. One spec walks a `PAD_SURFACES` census (the
  table above) and checks that every surface has a layer, a B meaning and a hint for each action it maps.
  → Verify: `npm run test:only -- view/menu`.
- [x] **GM2. FocusController + `useFocusScope`.** Scopes (SelectionGroup, Stop, SelectionOrder), recovery, memory,
  device-switch clear, empty `SelectionImageObject`, `KV_FocusDebug`. Migrate the four `useGamepadFocus` users and
  the six hand-rolled effects, then delete `useGamepadFocus`. → Verify: `npm run verify`. In Studio, every surface
  still opens on its default button.
- [x] **GM3. One back path.** Order B by layer through FocusController. Add solo pause B = Resume and skip confirm
  B = cancel. Panels' own B handlers fold in (`panelOpenLastFrame` stays the guard against double handling).
  → Verify: specs for the order. In Studio, B on each surface in the table does what the B column says.
- [x] **GM4. Bumpers, triggers and the pad input path.** `InputController.onMenuPadInput`, held-button block on menu
  close (if GM0 says it is missing). LB/RB and LT/RT on Options and Leaderboard. → Verify: tab specs. In Studio,
  holding LB through closing a menu does not roll.
- [x] **GM5. Scrolling.** `ScrollList` focus look, Leaderboard list selectable, right-stick scroll, `followSelection`
  if needed. → Verify: in Studio, the top 100, Credits and a 12-boon Build list scroll on a pad only.
- [x] **GM6. Shortcuts and the invites scope.** The X / Y table. Invite toasts as a scope reached by Y.
  → Verify: specs. In Studio with `KV_FakeFriends`, receive an invite on the main menu, Y, Join.
- [x] **GM7. Hint bar and glyphs.** `PadHintBar`, `padLabelSet`, engine glyph images with a text fallback. Strings
  `PAD_HINT_STRING_KEYS` (`pad.hint.*`) in their own shared/theme module, inside `REQUIRED_STRING_KEYS` (contract.luau
  is near Luau's 200 top-level locals: count on out/), with `l10n/context.json` entries. → Verify: `npm run verify`
  (`l10n:check`, `check:autolocalize`). In Studio, Xbox and PlayStation glyphs show.
- [ ] **GM8. Directional pass.** Walk every surface pad-only at HUD scale 70 % and 125 %, and in a portrait phone
  layout with a pad. Add `NextSelection*` only where geometry picks wrong (main menu and Daily card, lobby member
  rows' Kick / Make host, Options' `-` / `+` rows, run-over exits row). Each override is listed in this doc.
- [x] **GM9. Sounds, haptics and hold-to-exit.** The tab switch plays `sfx.ui.click`. Haptics are on (GMD14),
  through a client `PadHaptics` (`HapticEffect` or `HapticService`, whichever GM0 shows works; silent where the pad
  has no motor). Menus only, from a pure `MENU_HAPTICS` table (motor, strength, seconds) in shared/view/menu
  `config.ts`:
  - a light tick on confirm,
  - a short double buzz on pressing a disabled button,
  - a tick at a list's end when scrolling into it,
  - a tick when hold-B completes.

  No haptic on focus moves (the console guidelines warn against overuse). Add a setting
  `DisplaySettings.padVibration` (default On, only Off stored, settings doc stays v2), shown on Options > Controls >
  Gamepad, with string `options.controls.vibration`. Build hold-B to exit on the run-over panel (section 3, GMD13).
  → Verify: specs for `MENU_HAPTICS`, `holdProgress` and the hold edge rule. In Studio, the hold fills and exits, an
  early release does nothing, and vibration Off is silent.
- [x] **GM12. Console readiness (Xbox, PlayStation; GMD15).** The game ships wherever Roblox runs.
  - Menus inside the TV-safe area on a ten-foot interface: `MenuFit` takes a console inset from `GAMEPAD_MENU.tvSafe`
    (GM0 measures it), the same way it takes the phone safe area.
  - Text at least the console guidelines' readable size at `DisplaySize.Large`: check `computeHudScale` on a TV.
  - Chat window off on console, as the guidelines recommend (`TextChatService` `ChatWindowConfiguration.Enabled`
    false when `IsTenFootInterface`).
  - No TextBox on any player-facing path (already true: only the dev panel has one, GMD10).
  - Go through the console guidelines' checklist line by line, and turn on Console in the experience's device
    settings (an owner step in the Creator Hub).
  - A pass on a real Xbox and PlayStation if one is available, else the Studio console emulator.

  → Verify: in Studio's console emulator at 1080p and 4K, every menu is inside the safe area and readable, with no
  chat window.
- [ ] **GM10. Docs.** CLIENT.md Controls table (a "Menus (gamepad)" block), the CLAUDE.md docs row and a decision
  log entry, this doc's "As built".
- [ ] **GM11. Studio check, pad only.** Mouse unplugged: join, then the tutorial (outro), main menu, every Options
  tab including a rebind and a reset, leaderboards (all tabs, scroll to 100), credits, lobby create / invite / ready /
  kick / start (2 clients), a run (pause, leave confirm, party overlay, draft, death, Details, Again). Also: a locale
  switch while a button is selected, mouse ⇄ pad switching, an invite arriving mid-menu.

## Decisions

- **GMD1.** Roblox's engine selection (GuiService) stays the navigator. Our code only scopes, recovers, remembers
  and adds shortcuts. A custom grid navigator was rejected: the engine already moves by direction, scrolls, works
  with MenuButton's events and matches what console players expect.
- **GMD2.** Every surface that takes the pad is a SelectionGroup that stops on all four sides. Nothing is reached by
  wandering off an edge. Invite toasts are reached only by Y.
- **GMD3.** One owner: the topmost layer in `FOCUS_LAYERS`. Under the stage cover nobody owns the pad.
- **GMD4.** Menu meanings of LB / RB / LT / RT / X / Y / right stick are fixed and apply only while a menu owns the
  pad. In play the same buttons keep their (rebindable) game actions. Nothing is added to `RESERVED_PAD_INPUTS`.
- **GMD5.** A tap of B is never destructive: back, close, cancel or resume. It does nothing on the run-over panel,
  the outro and the draft.
- **GMD6.** The selection is shown only on a gamepad. Switching to mouse or touch clears it, and switching back
  restores it.
- **GMD7.** Roblox's default selection image is hidden. MenuButton's ring and corners are the only focus look, and
  lists draw their own.
- **GMD8.** Engine glyph images in the hint bar. Text labels (platform-aware) in localized sentences. The glyph images
  are platform content from the engine, not theme assets, so the "no rbxassetid outside shared/theme" rule is
  unaffected.
- **GMD9.** Focus memory is per session, in memory only, never stored.
- **GMD10.** The dev panel (F2) stays keyboard-only: it is server-gated, developer-only and needs a TextBox.
- **GMD11.** No sim, lockstep, hash, replay or fixture change. Co-op neutral input under menus is unchanged.
- **GMD12.** The draft, shrine, pacts, chests, spectating and the full map keep their gameplay inputs. They are not
  menus.

## Open owner calls

1. **Console.** Is the game going to Xbox / PlayStation? If so, add a GM12: TV-safe margins on menus, chat window
   off, the console guidelines' checklist, and a real-console pass. If not, GM0 and GM11 use pads on PC only.
2. **Shortcuts.** Is the X / Y table above right? Should B on the run-over panel mean Exit (today: nothing)?
3. **Haptics** (the console guidelines suggest them, for example for a list's end or a disabled press): on, off, or
   later?
4. **Glyph style.** Engine glyph images, or our own pixel-art glyphs in the UI sheet's style (a UI_ART follow-up)?

## Sources

- Roblox console guidelines (navigation by four directions plus select and back, shortcuts, glyph APIs, TV-safe
  areas): https://create.roblox.com/docs/production/publishing/console-guidelines
- Gamepad UI selection APIs (`SelectionGroup`, `SelectionBehavior*`, `GuiService:Select`, `SelectionOrder`,
  `SelectionChanged`): https://devforum.roblox.com/t/new-gamepad-ui-selection-apis/1791278
- `UserInputService:GetImageForKeyCode`:
  https://create.roblox.com/docs/reference/engine/classes/UserInputService/GetImageForKeyCode
