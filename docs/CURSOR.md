# Gauntlet cursor: plan

The player's mouse pointer becomes the **Lords of Pain gauntlet** (`cursor_gauntlet_*.png`) **in the menus only**: the
main menu, lobbies, Options, the character screen, credits, leaderboards, the join loading screen, and the overlays a
run opens over the floor (pause, the co-op party overlay, the boon draft, the run-over panel, the tutorial's outro).
While you are actually playing, the pointer is Roblox's own, exactly as today. Work it task by task, like `PLAN.md`
and `docs/SPECTATE.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server, a fixture or a replay hash. Aiming is untouched: in gameplay the gauntlet is never drawn, so the aim point is
the system pointer's hotspot as it is today.

## Status (2026-11-11)

**Built (code complete), revision 2: menus only** (owner, 2026-11-11), verified headlessly only. C1-C7 are done on
branch `gauntlet-cursor` ("As built" below); still open: the owner's upload of the two PNGs and their ids (C1), the
five Studio answers (C0) and the smoke test (C8), which also covers the Studio halves of C4-C6's Verify. Until the upload, vale's `ui.cursor` stays a placeholder,
`cursorArt(pack)` is undefined and every pack shows Roblox's pointer exactly as before (the gamepad rule included); the
Cursor size row stays hidden. Revision 1 (2026-10-26) put the gauntlet everywhere, gameplay included, as the aim point.
Every decision is made (D1-D5, owner 2026-11-11): D2 a size setting in Options (section 5), D5 the click squeeze on,
off under reduced motion.

What revision 2 changed: the gauntlet shows only in a **menu context** (section 3); gameplay keeps the system
pointer; the over-enemy red (`ui.cursor.target`, revision 1's task C6, D4) is dropped; the fingertip-on-aim-point checks and the
in-run latency fallback are gone; the controller owns `MouseIconEnabled` in both contexts.

## What the code and the engine give us (checked against `main` @ `35b6193`)

| Fact | Where | Consequence |
|---|---|---|
| The art: 5 colours (`white`, `red`, `yellow`, `blue`, `green`), each a **128x128** PNG with the gauntlet in the middle: opaque bbox (51, 51)-(75, 77), so the hand is **25x27 px**; the fingertip (the click point) is the top-left corner, about **(52, 52)**. The colour is the glow outline; the hand itself is dark steel | `art/vendor/lords-of-pain/user interface/cursor/` (full pack, gitignored) | Crop to alpha like `ui.ring.player`; needs an explicit pivot at the fingertip (the builder only knows `center` / `bottom`). Small pixel art: draw with `ResamplerMode.Pixelated` at an integer scale. Only white and yellow are used |
| Licence: free and commercial use, may modify, **may not redistribute** | `docs/ART.md` packs table | Same as every other Lords of Pain asset: source stays in `art/vendor/`, only the uploaded Roblox image ships |
| The theme already has a required `ui.cursor` id (UI slot, `STILL`, may carry a `pivot`; the validator checks the pivot is inside the image) | `shared/theme/contract.ts` `UI_IDS`, `validate.spec.ts` | `ui.cursor` becomes the gauntlet. No new required id; the hover colour is a port-only optional id that falls back to it |
| `ui.cursor` is also borrowed for the **facing pip** (`ACTOR_VIEW.facingPipVisualId`), but the pip reads `pack.placeholder(...)`, never the image | `shared/view/config.ts`, `ActorRenderController.ts:712` | Filling `ui.cursor` in vale does not turn the pip into a gauntlet. Pin that with a spec (C2) |
| Vale ui images switch from placeholder to `image` once their file has an id; pivots come from the generated `VALE_IMAGE_LAYOUTS` | `packs/vale/manifest.ts` header, `layout.ts` | Until it is uploaded, `ui.cursor` stays a placeholder and the game keeps the system pointer |
| Stage assets: art is drawn only once its content has downloaded (`PreloadController.isArtReady` / `onReadinessChanged`); `ui.` is in `PRELOAD.core`, the menu kit, front lane | docs/STAGE_ASSETS.md, `client/ui` `uiImage` | The gauntlet waits for `isArtReady("ui.cursor")`; until then (or if it failed) the system pointer, never an empty pointer |
| `MouseIconController` sets `UserInputService.MouseIconEnabled` false while the store's `inputDevice` is `gamepad`, true again on a real mouse move (non-zero delta) or a click | `client/controllers/ui/MouseIconController.ts` | A second writer of the same property would fight the cursor. C4 moves this rule into `CursorController` and deletes `MouseIconController` |
| A menu context is already one selector: `selectMenuShown` (a menu screen, a panel, the party overlay, a paused run, run over, the tutorial outro), and `selectMenuOpen` = that + the join loading screen + the stage cover | `client/store/selectors.ts` | The cursor reads `selectMenuOpen`; nothing new to track for those screens |
| The boon draft is not in either selector (the run is not paused); its overlay reads `game.snapshot.draftOpen` (the local player's draft) | `client/ui/hud/DraftOverlay.tsx:73` | Menu context = `selectMenuOpen || snapshot.draftOpen` (section 3) |
| Mouse aim = `GetMouseLocation()` -> `ViewportPointToRay` -> floor plane (`pointerAimFromRay`) | `InputController.ts` | Untouched; in gameplay nothing is drawn over the pointer |
| **Engine cursor** (`UserInputService.MouseIcon`): the click point is the **image centre**, max 256 px a side, drawn at the image's pixel size, and **ignored while hovering any GuiButton** (Roblox shows its default cursor there) | Roblox `Mouse.Icon` docs; DevForum thread 2535543 | Menus are mostly buttons, so the engine cursor would be the Roblox arrow most of the time. Software cursor (D1) |
| ScreenGui display orders today: touch 11, menu backdrop 14, menu 15, pause / settings layer `HUD_VIEW.menuDisplayOrder` 20, dev panel 20, tooltips 25, loading screen / stage card 30, spikes 50-101 | `shared/view/menu/config.ts`, `hud/layout.ts`, `hud/tooltipConfig.ts`, `preloadConfig.ts`, `shared/config/spikes.ts` | `CURSOR_VIEW.displayOrder` above every game layer (e.g. 200). CoreGui still draws above it |
| `GuiService.MenuOpened` / `MenuClosed` are already watched (pause, rebind cancel) | `SimController.ts`, `RebindController.ts` | Hide the gauntlet while the Roblox menu is open: CoreGui draws its own cursor above our layer |
| `settings.reducedMotion` | `client/store/settings.ts` | The click squeeze is skipped under reduced motion |
| Display settings are overrides-only (`shared/settings/display.ts`: a new optional field needs no migration, the doc stays v2; only a non-default value is stored; `sanitizeDisplayOverrides` drops anything else). The Display tab already has a mouse-only row (`hudTooltips`, `UserInputService.MouseEnabled` read when the tab opens) and choice rows (`buildFx`) | `shared/settings/display.ts`, `config.ts`, `client/ui/hud/OptionsScreen.tsx` `DisplayTab`, `shared/view/hud/options.ts` `OPTIONS_STRINGS` | The size setting is one more field and one more choice row, shown only with a mouse (D2) |

## Player experience

- With a mouse, the pointer is the gauntlet on every menu screen and run overlay; the fingertip is the exact point you
  click.
- **Normal**: the white-glow gauntlet. **Over a button**: the **yellow**-glow gauntlet, so the "this is clickable" cue
  the Roblox hand cursor gave is not lost.
- **Click**: a short squeeze (scale to 85% and back over ~90 ms) about the fingertip. Not under reduced motion.
- **Size**: Options > Display > **Cursor size**: Small / Normal / Large (default Normal), one whole step of scale apart,
  each still following the window's height. The change shows at once (you are in a menu, so the gauntlet is on screen).
- **In gameplay** (the run playing, a dead player spectating, the HUD's pause button, item tooltips, the dev panel):
  Roblox's pointer, unchanged.
- Opening the pause overlay or a draft swaps the Roblox pointer for the gauntlet at the same spot; Resume or a pick
  swaps it back. Never both, never neither (one write per frame, section 4).
- Picking up a gamepad hides the pointer in both contexts; moving the mouse brings it back. Touch-only devices never
  show the gauntlet.
- The Roblox menu (Esc), the dev console and other CoreGui keep Roblox's own cursor.

## Architecture

### 1. Art (`art/atlases.json` `images`, `scripts/art/build-atlases.js`)

```jsonc
"ui.cursor":       { "file": "lords-of-pain/user interface/cursor/cursor_gauntlet_white.png",
                     "name": "ui-cursor", "crop": "alpha", "noiseAlpha": 2, "pad": 2,
                     "pivot": { "x": 52, "y": 52 } },   // fingertip, in SOURCE pixels
"ui.cursor.hover": { ... "cursor_gauntlet_yellow.png", "name": "ui-cursor-hover", same crop / pivot }
```

The builder gains one pivot form: `{ x, y }` in source pixels, converted to the cropped image (`x - cropX`,
`y - cropY`), with the existing out-of-image check. The two colours must crop to the **same** rect (same shape, only
the glow differs); the builder fails if they do not, so swapping variants never shifts the fingertip. The contact sheet
draws the red pivot cross on it like every other image. Output: `art/build/ui-cursor*.png`, copied to `art/upload`.

### 2. Theme

- vale: `ui.cursor` and `ui.cursor.hover` become `image` assets with their `VALE_IMAGE_LAYOUTS` pivot once uploaded
  (`assetIds.ts`), like `ui.ring.player`.
- `ui.cursor.hover` is port-only and optional (no placeholder entry needed); a missing one falls back to `ui.cursor`.
- placeholder pack: `ui.cursor` stays the placeholder, which means **system pointer** everywhere.

### 3. Pure view logic: `shared/view/cursor.ts` + `shared/view/cursorConfig.ts` (headless-tested)

`CURSOR_VIEW` tunables: `displayOrder`, `baseScale` (2 at a 1080 px tall viewport), `referenceHeight` 1080,
`minScale` 1, `maxScale` 5 (integer scales only, so the pixels stay square; 5 keeps Large a step above Normal at 2160),
`sizeSteps` (`small` -1, `normal` 0, `large` +1), `pressScale` 0.85, `pressSec` 0.09, `hoverPollHz` 20.

- **Menu context**: `menuContext = selectMenuOpen || snapshot.draftOpen`. A cross-slice selector
  `selectCursorMenuContext` in `client/store/selectors.ts`, next to `selectMenuOpen`. In co-op, a player who has picked
  and waits for teammates is back in gameplay (the draft is closed for them).
- `cursorMode({ hasCustomArt, artReady, menuContext, mouseEnabled, touchOnly, onGamepad, robloxMenuOpen,
  windowFocused, killSwitch })` -> `"custom" | "system" | "hidden"`:
  - `hidden`: on a gamepad (in either context), or the window unfocused while `custom` would apply;
  - `custom`: a menu context with the gauntlet's art ready, a mouse, not touch-only, the Roblox menu closed, no kill
    switch;
  - `system`: everything else, so gameplay is always `system` (or `hidden` on a pad).
- `cursorVisualId({ overButton })` -> `ui.cursor.hover` over a button, else `ui.cursor`.
- `cursorScale(viewportHeight, size)` -> integer scale: `clamp(max(1, round(baseScale x viewportHeight /
  referenceHeight)) + sizeSteps[size], minScale, maxScale)`. Normal at 720 / 1080 / 1440 / 2160 = 1 / 2 / 3 / 4; Small
  1 / 1 / 2 / 3; Large 2 / 3 / 4 / 5 (the hand 27 px tall at 1x).
- `cursorPlacement(mouse, pivot, scale, pressT)` -> the label's top-left so `pivot * scale` lands on `mouse` (the
  squeeze scales about the fingertip, so the click point never moves).

### 4. Client: `client/controllers/ui/CursorController.ts`

- One ScreenGui `KV_Cursor` (`DisplayOrder = CURSOR_VIEW.displayOrder`, `ScreenInsets.None`, `IgnoreGuiInset`, so
  `GetMouseLocation()` coordinates map 1:1) holding one `ImageLabel` (`Active = false`, `Pixelated`, never a button, so
  it never eats a click). Created through `createKvScreenGui` (AutoLocalize off, docs/LOCALIZATION.md).
- `RunService:BindToRenderStep("KV_Cursor", Enum.RenderPriority.Last.Value, ...)`: reads `GetMouseLocation()`, the
  mode and the visual, then writes in one place: `MouseIconEnabled = mode === "system"` and the label's `Visible =
  mode === "custom"`, so a context switch never shows both pointers or neither for a frame. One write per property per
  frame, only when it changed; `MouseIconEnabled` re-asserted while `custom` or `hidden` (it survives the Roblox menu).
  The Janitor restores the value from before start.
- **Owns the pointer on gamepad**: `MouseIconController`'s rule moves here (hidden while `inputDevice` is `gamepad`,
  back on a non-zero `MouseMovement` delta or a mouse click) and that controller is deleted, so only one writer of
  `MouseIconEnabled` exists.
- Over-button test, only in a menu context: `PlayerGui:GetGuiObjectsAtPosition(x, y)` at `hoverPollHz`, true if any hit
  is a visible, active `GuiButton`, ignoring the cursor's own ScreenGui. (Check the GUI-inset convention of that call
  in C0.)
- Press squeeze: `InputBegan` on MouseButton1 / MouseButton2 while `custom`, skipped under `reducedMotion`.
- Kill switch: Workspace attribute `KV_SystemCursor` (off by default, `RUN_ATTRIBUTES`) forces `system`, for debugging
  and as the fallback if a Roblox update breaks the custom cursor.
- Reads `selectDisplay(...).cursorSize` for `cursorScale`; a change applies on the next frame.

### 5. Setting: Cursor size (D2)

- `shared/settings`: `CursorSize = "small" | "normal" | "large"`, `CURSOR_SIZES` (that order) and `DEFAULT_CURSOR_SIZE`
  `"normal"` in `config.ts`; `DisplaySettings.cursorSize` appended to `DISPLAY_SETTING_KEYS` and
  `defaultDisplaySettings()`; `sanitizeDisplayOverrides` keeps only a `CURSOR_SIZES` value other than the default (so the stored doc
  stays v2, overrides-only). The Display tab's Reset drops it (not in `DISPLAY_RESET_KEEPS`).
- Options > Display: a `SettingRow` `cursorSize` after Player outline (the choice-row shape of `buildFx`), shown only
  while `UserInputService.MouseEnabled` (like `hudTooltips`) **and** the pack has gauntlet art (`cursorArt(pack)`), so
  a touch phone, a pad-only console or the placeholder pack never sees a row that does nothing. The row orders after it
  shift by one.
- Strings (required, in the placeholder manifest, `REQUIRED_STRING_KEYS` through `OPTIONS_STRINGS`, context entries in
  `l10n/context.json` for `l10n:check`): `options.display.cursorSize` "Cursor size", `.small` "Small", `.normal`
  "Normal", `.large` "Large".
- Presentation only: no sim, hash, replay, wire or server change.

### 6. What does not change

`InputController`'s aim, bindings and sinking; the pointer in gameplay; every sim, dungeon, lockstep and server file;
fixtures and hashes (the size setting is a display override); the facing pip; tutorial, spectate and boosts logic; gamepad focus (`FocusController`).

## As built (2026-11-11)

Presentation only: no sim, dungeon, lockstep, server, hash, replay, fixture or score change. Differences from the plan
above are marked **(differs)**.

### Art (C1, `d08bb20`)

- `art/atlases.json` `images`: `ui.cursor` (`cursor_gauntlet_white.png`) and `ui.cursor.hover`
  (`cursor_gauntlet_yellow.png`), `crop: "alpha"`, `noiseAlpha` 2, `pad` 2: both cut to the same **29 x 29** rect at
  source (49, 50).
- Pivot **(differs)**: `{ "x": 53, "y": 54 }` in SOURCE pixels, the steel fingertip's first opaque pixel, which lands
  at **(4, 4)** in `VALE_IMAGE_LAYOUTS` (`layout.ts`). The plan's "about (52, 52)" / "about (3, 3)" was measured on
  the glow: (52, 53) is a faint glow pixel, not the hand.
- `scripts/art/build-atlases.js`: an image `pivot` may be `{ x, y }` in source pixels (converted to the cut image,
  minus the crop's top-left, and checked inside it); a new field **`sameCropAs`** (the hover entry names `ui.cursor`)
  fails the build unless the variant crops to the identical source rect, size and pivot, so swapping the states never
  moves the fingertip; images with a pivot get a contact sheet with the red cross; **`--only <images id>`** (and
  `--lock --only`) builds one image's crop family alone (`node scripts/art/build-atlases.js --only ui.cursor`),
  merging its `VALE_IMAGE_LAYOUTS` entries. `art/vendor.lock.json` gained the two PNGs. Pipeline specs in
  `scripts/art/*.test.js` (inside / outside / crop offset, same-crop).

### Theme (C2, `89c859a`)

- `shared/theme` `cursorArt.ts`: `cursorArt(pack): CursorArt | undefined`, undefined while `ui.cursor` is not an image
  (a placeholder: the system pointer). `CursorArt` is per state (`normal` / `hover`) `{ id, assetId, size: { w, h },
  pivot, rect }`: `id` is the logical id drawn (what art readiness is asked about), `rect` the region to draw
  (ImageRectOffset / Size) when the image carries one. The hover state falls back to the normal art when the pack has
  no `ui.cursor.hover`.
- `ui.cursor.hover` is port-only and **optional** (`cursorOptionalIds`, no placeholder entry); `cursorArtProblems`
  (folded into `variantColorProblems`, so validate.ts takes no new local) requires a hover image to have `ui.cursor`
  as an image with the same drawn size and pivot.
- vale manifest: both ids become `image`s with their layout pivot once `ui-cursor.png` / `ui-cursor-hover.png` have
  ids in `packs/vale/assetIds.ts`; until then `ui.cursor` is the placeholder and `ui.cursor.hover` absent. The facing
  pip still reads `placeholder("ui.cursor")` (pinned by a spec).

### Pure view logic and the setting (C3 / C6 shared, `27c0c22`, `cf5ae39`)

- `shared/view` `cursorConfig.ts` `CURSOR_VIEW` (displayOrder 200, `visualId` / `hoverVisualId`, baseScale 2 at
  referenceHeight 1080, min / max scale 1 / 5, `sizeSteps`, pressScale 0.85, pressSec 0.09, hoverPollHz 20) and
  `cursor.ts`: `cursorMode(input)` -> `"custom" | "system" | "hidden"` (inputs `hasCustomArt`, `artReady`,
  `menuContext`, `mouseEnabled`, `touchOnly`, `onGamepad`, `robloxMenuOpen`, `windowFocused`, `killSwitch`);
  `cursorVisualId({ overButton })`; `cursorScale(viewportHeight, size)`; `cursorSqueeze(pressT)` (a triangle to
  pressScale and back); `cursorPlacement(mouse, pivot, imageSize, scale, pressT)` -> `{ x, y, width, height }`
  **(differs: takes the art's `imageSize` too, so it also gives the label's size)**, the pivot exactly on the mouse at
  every scale and through the squeeze. Specs in `cursor.spec.ts`.
- `shared/settings`: `CursorSize` `small | normal | large`, `CURSOR_SIZES`, `DEFAULT_CURSOR_SIZE` `normal`,
  `DisplaySettings.cursorSize` (sanitized: only `small` / `large` stored, overrides-only, the doc stays v2; Reset drops
  it). Strings `options.display.cursorSize` / `.small` / `.normal` / `.large` (`OPTIONS_STRINGS.cursorSize*`), in the
  placeholder pack and `l10n/context.json`.

### Client (C4 / C5 / C6 client, `4e663b1`, `d5d8266`)

- `client/store/selectors.ts` `selectCursorMenuContext` = `selectMenuOpen || (game active && snapshot.draftOpen)`
  (the draft only while a run is active, so a stale snapshot never counts).
- `client/controllers/ui/CursorController.ts`: one ScreenGui `KV_Cursor` (`createKvScreenGui`, DisplayOrder 200,
  IgnoreGuiInset, `ScreenInsets.None`, ResetOnSpawn off) with one ImageLabel `Gauntlet` (Active / Interactable /
  Selectable false, Pixelated, no background). `RunService:BindToRenderStep("KV_Cursor", RenderPriority.Last, ...)`
  reads `GetMouseLocation()`, the mode inputs and the size, then writes `MouseIconEnabled = mode === "system"` and
  `Visible = mode === "custom"` in that step; every property only when it differs (MouseIconEnabled is compared with
  the engine's value every frame, so it is re-asserted if the Roblox menu or anything else changed it). It is the ONE
  writer of `MouseIconEnabled`: `MouseIconController` is deleted and its rule moved in. Janitor: the step unbound, the
  gui destroyed, MouseIconEnabled restored to its value before start.
- Mode inputs, where each comes from:
  - `hasCustomArt`: `cursorArt(ThemeController.getPack())`, read once at start (the pack instance never changes);
  - `artReady`: `PreloadController.isArtReady(id)` for the normal and hover ids, cached and refreshed on
    `onReadinessChanged`; the drawn state is the hover art only once ITS id is ready (else the white one), and
    `artReady` is the drawn state's readiness;
  - `menuContext`: `selectCursorMenuContext(clientStore.getState())`, read every frame (memoized);
  - `mouseEnabled` / `touchOnly`: `UserInputService.MouseEnabled`, and `TouchEnabled && !MouseEnabled`, every frame;
  - `onGamepad`: true when the store's `inputDevice` becomes `gamepad` (subscribe), false when it becomes anything
    else, on an `InputChanged` MouseMovement with a non-zero delta, or on an `InputBegan` MouseButton1 / 2;
  - `robloxMenuOpen`: `GuiService.MenuIsOpen` at start, then `MenuOpened` / `MenuClosed`;
  - `windowFocused`: true at start, then `UserInputService.WindowFocused` / `WindowFocusReleased`;
  - `killSwitch`: Workspace attribute `KV_SystemCursor` (`RUN_ATTRIBUTES.systemCursor`, off by default), read at
    start and on `GetAttributeChangedSignal`.
- Size: `cursorScale(Workspace.CurrentCamera.ViewportSize.Y, selectDisplay(state).cursorSize)` every frame, so a
  pick or a window resize shows on the next frame.
- Hover (C5): while in a menu context with art and a mouse, every 1 / hoverPollHz s,
  `PlayerGui:GetGuiObjectsAtPosition(mouse - GuiService:GetGuiInset())`: true if any hit is a `GuiButton` that is
  Visible, Active and Interactable and not under `KV_Cursor`. Outside a menu context the hover state is cleared. The
  inset subtraction follows Roblox's documented space for that call (InputObject.Position's, without the top bar);
  it is C0 (c)'s open question: if Studio shows the hover offset by the top bar's height, drop the subtraction
  (commented at `buttonAt`).
- Press (C5): `InputBegan` MouseButton1 / 2 while the last step's mode was `custom` starts the squeeze (`os.clock`),
  whether or not the input was game-processed (menu clicks are), never under `selectJuice(...).reducedMotion`.
- Options > Display (C6): a choice row `cursorSize` after Player outline (Small / Normal / Large), shown only while
  `UserInputService.MouseEnabled` (read when the tab opens, like `hudTooltips`) and `cursorArt(themePack())` is
  defined; picking plays `sfx.ui.click` and `updateDisplay({ cursorSize })`. Build effects and the touch rows moved
  down one order.

### Pending (owner)

1. Build and upload: `node scripts/art/build-atlases.js --only ui.cursor` (or `npm run art:build`) writes
   `art/build/ui-cursor.png` / `ui-cursor-hover.png` and copies them to `art/upload/`; upload both and paste the ids
   into `src/shared/theme/packs/vale/assetIds.ts` under the keys `"ui-cursor.png"` and `"ui-cursor-hover.png"`, then
   `npm run verify`.
2. C0's five answers (below), written here: (a) the label's lag at 60 FPS, (b) `MouseIconEnabled` after the Roblox
   menu closes, (c) `GetGuiObjectsAtPosition`'s inset convention, (d) (0, 0) at the window corner with
   `IgnoreGuiInset` + `ScreenInsets.None`, (e) no blank or doubled frame when the two pointers swap.
3. The Studio smoke test (C8).

## Tasks

- [ ] **C0. Confirm the engine behaviour in Studio** (open) (a 10-minute throwaway LocalScript, not committed): with
  `MouseIconEnabled = false` and an ImageLabel at `GetMouseLocation()` from a `Last` render step, (a) the label tracks
  with no visible lag beyond one frame at 60 FPS, (b) the Roblox menu shows its own cursor and closing it leaves
  `MouseIconEnabled` as we set it (or not: then the re-assert is required), (c) whether `GetGuiObjectsAtPosition`
  wants the raw mouse position or one minus `GuiService:GetGuiInset()`, (d) `IgnoreGuiInset` + `ScreenInsets.None`
  puts (0, 0) at the window corner, (e) flipping `MouseIconEnabled` true and hiding the label in the same frame shows
  no blank frame and no doubled pointer. → Verify: the five answers written into "As built".
- [ ] **C1. Art.** (Built and verified headlessly, `d08bb20`; open: the upload and the two ids, "As built" >
  Pending.) The two `images` entries; `{ x, y }` source pivot in `build-atlases.js` plus the same-crop check
  across variants; a `scripts/art/*.test.js` case for the explicit pivot (inside, outside, crop offset); `art:build`,
  contact sheet looked at. Upload the two PNGs and paste the ids into `packs/vale/assetIds.ts`. → Verify:
  `npm run test:art`; `VALE_IMAGE_LAYOUTS["ui.cursor"].pivot` is the fingertip (about (3, 3) with `pad` 2); the
  contact sheet's cross sits on the fingertip.
- [x] **C2. Theme.** vale manifest fills the two ids from the layout once uploaded; the optional id is accepted by the
  validator; fallback helper (`cursorArt(pack)` -> image, pivot and size per state, or `undefined` for a placeholder).
  Specs: vale `ui.cursor` is an image with an in-bounds pivot; placeholder `ui.cursor` yields `undefined`; the facing
  pip still reads the placeholder diamond when vale's `ui.cursor` is an image. → Verify: `npm test` (theme + vale
  specs), `check:assets`.
- [x] **C3. Pure view logic.** `shared/view/cursor.ts`, `cursorConfig.ts`, barrel exports, specs for every mode branch
  (gameplay always `system` / `hidden`; `custom` only in a menu context with ready art; gamepad `hidden` in both
  contexts; kill switch; art not ready), the hover priority, integer scaling at 720 / 1080 / 1440 / 2160 for each size
  (section 3's table), and placement
  (fingertip on the mouse at every scale and through the whole squeeze). → Verify: `npm run test:only -- view/cursor`.
- [x] **C4. CursorController.** `selectCursorMenuContext`; ScreenGui, render step, mode / visual / placement wiring,
  the single `MouseIconEnabled` writer, the gamepad rule moved in and `MouseIconController` deleted, touch / Roblox
  menu / window focus hiding, art readiness, kill switch, Janitor cleanup. → Verify: `npm run verify`; Studio: the
  gauntlet on the main menu, lobby and pause overlay, the Roblox pointer in a run.
- [x] **C5. Hover and press.** Throttled over-button test -> yellow; press squeeze (off under reduced motion). →
  Verify: Studio: every main-menu, lobby, Options, character, pause, draft and run-over button turns it yellow; the
  squeeze never moves the click point.
- [x] **C6. Cursor size setting** (D2; revision 1's C6, the over-enemy red, was dropped with D4). The
  `DisplaySettings.cursorSize` field, defaults and sanitize; the Display tab row (mouse and art only); the four strings
  and their l10n context; the controller reading it. Specs: `sanitizeDisplayOverrides` keeps `small` / `large`, drops `normal`, unknown
  values and non-strings; `displayResetOverrides` drops it; `cursorScale` for each size at 720 / 1080 / 1440 / 2160 (the C3 table); the
  menu `fit.spec` still passes with the extra row. → Verify: `npm run verify` (`l10n:check` included); Studio: the row
  on a laptop, absent in the touch emulator and with the placeholder pack; Small / Large change the gauntlet live;
  the pick survives a rejoin; Reset brings Normal back.
- [x] **C7. Docs.** "As built" here; `docs/ART.md` mapping and status rows; `shared/theme/README.md` row for
  `ui.cursor` (now an image with a pivot); CLAUDE.md decision-log line ("Gauntlet cursor: presentation only, software
  cursor in menus and run overlays only, gameplay keeps the Roblox pointer, `DisplaySettings.cursorSize` (Small /
  Normal / Large, overrides-only, doc stays v2), `KV_SystemCursor` kill switch, `MouseIconController` folded in").
- [ ] **C8. Playtest pass** (open) (the Studio smoke test below).

## Studio smoke test

1. Main menu: gauntlet visible, yellow over every button, white elsewhere; no Roblox arrow anywhere except over CoreGui.
2. Start a solo run: the gauntlet over the stage cover, the Roblox pointer from the reveal on; aiming and shooting as
   before.
3. Pause (the pause key or the HUD's pause button): the gauntlet at the pointer's spot, no flicker; Resume: the Roblox
   pointer back at the same spot.
4. Clear to a boon draft: gauntlet, yellow over the cards; pick: the stairwell card keeps it, the next floor's reveal
   brings the Roblox pointer.
5. Die: the run-over panel shows the gauntlet; Again: the Roblox pointer once the run plays.
6. Press Esc (Roblox menu) on the main menu and in a run: Roblox's cursor there, no gauntlet under it; close it: the
   context's pointer back.
7. Pick up a gamepad and move the stick, in a menu and in a run: no pointer at all; move the mouse: the right pointer
   for the context.
8. Alt-tab out and back on a menu: no frozen gauntlet at the window edge.
9. Resize the window from small to full-screen 1440p+ on a menu: Normal steps 1 -> 2 -> 3, pixels stay crisp.
10. Options > Display > Cursor size: Small and Large change the gauntlet at once, a step either side of Normal, the
    fingertip still on the click point; rejoin: the pick kept; Reset: Normal. The row is absent in the touch emulator.
11. Reduced motion on: no squeeze. `KV_SystemCursor` on: the Roblox pointer everywhere, nothing else changes.
12. 2-player co-op: the party overlay and draft show the gauntlet on each client; a player who picked first and waits
    has the Roblox pointer; die and spectate: Roblox pointer, click to switch targets still works.
13. With `KV_FakeAssetLatency` on a fresh join: the Roblox pointer until `ui.cursor` has loaded, then the gauntlet.

## Edge cases

- **Context flips.** The pointer swaps on every pause, draft and run over. Both writes happen in one render step
  (C0 (e) checks it); if the engine still shows a stray frame of both pointers or neither, C0 picks the write order
  that hides it.
- **Frame latency.** A software cursor can trail the hardware pointer by one frame. In menus that is barely visible;
  the in-run fallback of revision 1 is no longer needed.
- **Low frame rate.** The gauntlet moves at the render rate. The kill switch is the escape hatch; an Off choice for
  players could join the Cursor size row later (not planned).
- **Overlays that are not menus.** Item tooltips, the dev panel (F2) and the HUD's pause button are in gameplay and keep
  the Roblox pointer. If the owner wants the dev panel or tooltips to count, they join the selector.
- **CoreGui** (Roblox menu, dev console, chat window chrome, the top bar) draws above our ScreenGui; the gauntlet can
  sit under it. The menu case is hidden explicitly; the others are cosmetic.
- **Hover test cost.** `GetGuiObjectsAtPosition` allocates; 20 Hz and menu context only keep it negligible.
- **Placeholder pack / missing upload / art not loaded.** System pointer, exactly today's behaviour.

## Decisions

All decided (revision 2, owner 2026-11-11):

- **D1. Mechanism and scope:** a software cursor in a menu context only (menus, panels, the loading screen and stage
  cover, pause, the party overlay, the boon draft, run over, the tutorial outro); gameplay keeps the Roblox pointer.
  Not the engine `MouseIcon`: it reverts to the Roblox arrow over every GuiButton and clicks at the image centre.
- **D3. Colours:** white normal, yellow over buttons (red needed D4).
- **D2. Size:** a player setting in Options (section 5): Cursor size Small / Normal / Large, Normal = 2x at 1080 px
  tall (the hand ~54 px), each a whole scale step apart and following the window height.
- **D4. Over-enemy red:** dropped; the gauntlet is never over the floor.
- **D5. Click squeeze:** on, off under reduced motion.

## Out of scope

A custom pointer or crosshair in gameplay; cursor trails or particles; an aim line; changing the gamepad aim (no virtual
cursor); a custom cursor over CoreGui (not possible).

Sources: [Roblox `Mouse` reference (Icon: size, centre click point, ignored over GuiButtons)](https://create.roblox.com/docs/reference/engine/classes/Mouse.md),
[DevForum: "Mouse Icon changes to default cursor when focused on a gui element"](https://devforum.roblox.com/t/2535543).
