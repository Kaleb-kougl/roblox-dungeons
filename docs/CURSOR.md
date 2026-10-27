# Gauntlet cursor: plan

The player's mouse pointer becomes the **Lords of Pain gauntlet** (`cursor_gauntlet_*.png`), everywhere the mouse is
used: the main menu, the lobby, Options, the HUD and in the run, where it is the aim point. Work it task by task, like
`PLAN.md` and `docs/SPECTATE.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server, a fixture or a replay hash. The aim ray stays exactly what it is today (the camera ray through
`UserInputService:GetMouseLocation()`); the gauntlet is drawn so its fingertip sits on that point.

## Status (2026-10-26)

Planned. No code written. Decisions below are recommendations waiting for Kaleb's sign-off.

## What the code and the engine give us (checked against `main` @ `1bb9e99`)

| Fact | Where | Consequence |
|---|---|---|
| The art: 5 colours (`white`, `red`, `yellow`, `blue`, `green`), each a **128x128** PNG with the gauntlet in the middle: opaque bbox (51, 51)-(75, 77), so the hand is **25x27 px**; the fingertip (the click point) is the top-left corner, about **(52, 52)**. The colour is the glow outline; the hand itself is dark steel | `art/vendor/lords-of-pain/user interface/cursor/` (full pack, gitignored) | Crop to alpha like `ui.ring.player`; needs an explicit pivot at the fingertip (the builder only knows `center` / `bottom`). Small pixel art: draw with `ResamplerMode.Pixelated` at an integer scale |
| Licence: free and commercial use, may modify, **may not redistribute** | `docs/ART.md` packs table | Same as every other Lords of Pain asset: source stays in `art/vendor/`, only the uploaded Roblox image ships |
| The theme already has a required `ui.cursor` id (UI slot, `STILL`, may carry a `pivot`; the validator checks the pivot is inside the image) | `shared/theme/contract.ts` `UI_IDS`, `validate.spec.ts` | `ui.cursor` becomes the gauntlet. No new required id; the hover / target colours are port-only optional ids that fall back to it |
| `ui.cursor` is also borrowed for the **facing pip** (`ACTOR_VIEW.facingPipVisualId`), but the pip reads `pack.placeholder(...)`, never the image | `shared/view/config.ts`, `ActorRenderController.ts:415` | Filling `ui.cursor` in vale does not turn the pip into a gauntlet. Pin that with a spec (C2) |
| Vale ui images switch from placeholder to `image` once their file has an id; pivots come from the generated `VALE_IMAGE_LAYOUTS` | `packs/vale/manifest.ts` header, `layout.ts` | Same path for the cursor: until it is uploaded, `ui.cursor` stays a placeholder and the game keeps the system cursor |
| Nothing sets `MouseIcon`, `MouseIconEnabled` or `MouseBehavior` today; the run camera is `Scriptable` | grep of `src/client` | No existing cursor code to fight. Right mouse button does not lock the pointer |
| Mouse aim = `GetMouseLocation()` -> `ViewportPointToRay` -> floor plane (`pointerAimFromRay`) | `InputController.ts` (~line 364) | The cursor reads the same `GetMouseLocation()`; aim code is untouched |
| **Engine cursor** (`UserInputService.MouseIcon`): the click point is the **image centre**, max 256 px a side, drawn at the image's pixel size, and **ignored while hovering any GuiButton** (Roblox shows its default cursor there) | Roblox `Mouse.Icon` docs; DevForum thread 2535543 | An engine cursor would flip back to the Roblox arrow on every menu button and the pause button. That rules it out as the only mechanism (D1) |
| ScreenGuis: HUD, menu and pause button use `HUD_VIEW` / `MENU_VIEW` / `PAUSE_BUTTON_VIEW` display orders; the spikes HUD has its own | `GameHud.tsx`, `MenuLayer.tsx`, `SpikeHudController.tsx` | The cursor's ScreenGui needs a display order above all of them (CoreGui still draws above it) |
| `InputDeviceTracker.aimDevice` (`mouse` / `stick` / `none`) and the store's `inputDevice` | `shared/play/inputMapping.ts`, `client/store/game.ts` | Hide the gauntlet while the player is on a gamepad, show it again on the first mouse move |
| `GuiService.MenuOpened` / `MenuClosed` are already watched (pause, rebind cancel) | `SimController.ts`, `RebindController.ts` | Hide the gauntlet while the Roblox menu is open: CoreGui draws its own cursor above our layer |
| `settings.reducedMotion` | `client/store/settings.ts` | The click "punch" is skipped under reduced motion |

## Player experience

- With a mouse, the pointer is the gauntlet from the first frame of the main menu until you leave. The fingertip is the
  exact point you click and aim at.
- **Normal**: the white-glow gauntlet.
- **Over a button** (menu, lobby, Options, pause button, draft cards): the **yellow**-glow gauntlet, so the "this is
  clickable" cue the Roblox hand cursor gave is not lost.
- **Over an enemy** in a run (optional, D4): the **red**-glow gauntlet.
- **Click**: a short squeeze (scale to 85% and back over ~90 ms). Not under reduced motion.
- Picking up a gamepad hides it; moving the mouse brings it back. Touch-only devices never show it.
- The Roblox menu (Esc), the dev console and other CoreGui keep Roblox's own cursor.

## Architecture

### 1. Art (`art/atlases.json` `images`, `scripts/art/build-atlases.js`)

```jsonc
"ui.cursor":        { "file": "lords-of-pain/user interface/cursor/cursor_gauntlet_white.png",
                      "name": "ui-cursor", "crop": "alpha", "noiseAlpha": 2, "pad": 2,
                      "pivot": { "x": 52, "y": 52 } },   // fingertip, in SOURCE pixels
"ui.cursor.hover":  { ... "cursor_gauntlet_yellow.png", "name": "ui-cursor-hover", same crop / pivot },
"ui.cursor.target": { ... "cursor_gauntlet_red.png",    "name": "ui-cursor-target", same crop / pivot }
```

The builder gains one pivot form: `{ x, y }` in source pixels, converted to the cropped image (`x - cropX`,
`y - cropY`), with the existing out-of-image check. The three colours must crop to the **same** rect (same shape, only
the glow differs); the builder fails if they do not, so swapping variants never shifts the fingertip. The contact sheet
draws the red pivot cross on it like every other image. Output: `art/build/ui-cursor*.png`, copied to `art/upload`.

### 2. Theme

- vale: `ui.cursor`, `ui.cursor.hover`, `ui.cursor.target` become `image` assets with their `VALE_IMAGE_LAYOUTS`
  pivot once uploaded (`assetIds.ts`), like `ui.ring.player`.
- `ui.cursor.hover` / `ui.cursor.target` are port-only and optional (no placeholder entry needed); a missing one falls
  back to `ui.cursor`.
- placeholder pack: `ui.cursor` stays the placeholder, which means **system cursor** (the controller never hides the
  Roblox pointer for a placeholder).

### 3. Pure view logic: `shared/view/cursor.ts` + `shared/view/cursorConfig.ts` (headless-tested)

`CURSOR_VIEW` tunables: `displayOrder`, `baseScale` (2 at a 1080 px tall viewport), `minScale` 1, `maxScale` 4
(integer scales only, so the pixels stay square), `pressScale` 0.85, `pressSec` 0.09, `hoverPollHz` 20.

- `cursorMode({ hasCustomArt, mouseEnabled, touchOnly, aimDevice, robloxMenuOpen, windowFocused, killSwitch })`
  -> `"custom" | "hidden" | "system"`.
- `cursorVisualId({ overButton, overEnemy })` -> `ui.cursor.hover` beats `ui.cursor.target` beats `ui.cursor`.
- `cursorScale(viewportHeight)` -> integer scale.
- `cursorPlacement(mouse, pivot, scale, pressT)` -> the label's top-left so `pivot * scale` lands on `mouse`
  (the squeeze scales about the fingertip, so the click point never moves).

### 4. Client: `client/controllers/ui/CursorController.ts`

- One ScreenGui `KV_Cursor` (`DisplayOrder = CURSOR_VIEW.displayOrder`, `ScreenInsets.None`, `IgnoreGuiInset`, so
  `GetMouseLocation()` coordinates map 1:1) holding one `ImageLabel` (`Active = false`, `Pixelated`, never a button, so
  it never eats a click).
- `RunService:BindToRenderStep("KV_Cursor", Enum.RenderPriority.Last.Value, ...)`: reads `GetMouseLocation()`, the
  mode and the visual, and positions the label. One write per property per frame, only when it changed.
- `UserInputService.MouseIconEnabled = false` only while the mode is `custom`; re-asserted each frame (cheap, and it
  survives anything that resets it, e.g. the Roblox menu). Restored to `true` by the Janitor.
- Over-button test: `PlayerGui:GetGuiObjectsAtPosition(x, y)` at `hoverPollHz`, true if any hit is a visible, active
  `GuiButton`, ignoring the cursor's own ScreenGui. (Check the GUI-inset convention of that call in C0.)
- Press squeeze: `InputBegan` on MouseButton1 / MouseButton2, skipped under `reducedMotion`.
- Kill switch: Workspace attribute `KV_SystemCursor` (off by default) forces `system`, for debugging and as the
  fallback if a Roblox update breaks the custom cursor.

### 5. What does not change

`InputController`'s aim, bindings and sinking; every sim, dungeon, lockstep and server file; fixtures and hashes; the
facing pip; tutorial, spectate and boosts logic.

## Tasks

- [ ] **C0. Confirm the engine behaviour in Studio** (a 10-minute throwaway LocalScript, not committed): with
  `MouseIconEnabled = false` and an ImageLabel at `GetMouseLocation()` from a `Last` render step, (a) the label tracks
  with no visible lag beyond one frame at 60 FPS, (b) the Roblox menu shows its own cursor and closing it leaves
  `MouseIconEnabled` as we set it (or not: then the re-assert is required), (c) whether `GetGuiObjectsAtPosition`
  wants the raw mouse position or one minus `GuiService:GetGuiInset()`, (d) `IgnoreGuiInset` + `ScreenInsets.None`
  puts (0, 0) at the window corner. → Verify: the four answers written into "As built".
- [ ] **C1. Art.** The three `images` entries; `{ x, y }` source pivot in `build-atlases.js` plus the same-crop check
  across variants; a `scripts/art/*.test.js` case for the explicit pivot (inside, outside, crop offset); `art:build`,
  contact sheet looked at. Upload the three PNGs and paste the ids into `packs/vale/assetIds.ts`. → Verify:
  `npm run test:art`; `VALE_IMAGE_LAYOUTS["ui.cursor"].pivot` is the fingertip (about (3, 3) with `pad` 2); the
  contact sheet's cross sits on the fingertip.
- [ ] **C2. Theme.** vale manifest fills the three ids from the layout once uploaded; the two optional ids are accepted
  by the validator; fallback helper (`cursorArt(pack)` -> image, pivot and size per state, or `undefined` for a
  placeholder). Specs: vale `ui.cursor` is an image with an in-bounds pivot; placeholder `ui.cursor` yields
  `undefined`; the facing pip still reads the placeholder diamond when vale's `ui.cursor` is an image. → Verify:
  `npm test` (theme + vale specs), `check:assets`.
- [ ] **C3. Pure view logic.** `shared/view/cursor.ts`, `cursorConfig.ts`, barrel exports, specs for every mode
  branch, the state priority, integer scaling at 720 / 1080 / 1440 / 2160, and placement (fingertip on the mouse at
  every scale and through the whole squeeze). → Verify: `npm run test:only -- view/cursor`.
- [ ] **C4. CursorController.** ScreenGui, render step, mode / visual / placement wiring, `MouseIconEnabled` handling,
  gamepad / touch / Roblox menu / window focus hiding, kill switch, Janitor cleanup. → Verify: `npm run verify`;
  Studio: the gauntlet in the main menu, lobby and a run; fingertip on the aim point (fire at a wall corner).
- [ ] **C5. Hover and press.** Throttled over-button test -> yellow; press squeeze (off under reduced motion). →
  Verify: Studio: every main-menu, lobby, Options, pause and draft button turns it yellow; the squeeze never moves
  the click point.
- [ ] **C6. (optional, D4) Over-enemy red.** Presentation only: the controller reads the pointer's floor point
  (expose it from `InputController`, it already computes it) and the enemies in the latest view snapshot; red when the
  point is within an enemy's body radius, run only, not while spectating. → Verify: spec for the hit test; Studio.
- [ ] **C7. Docs.** "As built" here; `docs/ART.md` mapping and status rows; `shared/theme/README.md` row for
  `ui.cursor` (now an image with a pivot); CLAUDE.md decision-log line ("Gauntlet cursor: presentation only, software
  cursor, `KV_SystemCursor` kill switch").
- [ ] **C8. Playtest pass** (the Studio smoke test below).

## Studio smoke test

1. Main menu: gauntlet visible, yellow over every button, white elsewhere; no Roblox arrow anywhere except over CoreGui.
2. Start a solo run: aim at a wall corner and shoot; bullets leave toward the fingertip, not the middle of the hand.
3. Press Esc: Roblox cursor in the menu, gauntlet hidden; close it: gauntlet back, run still paused.
4. Pick up a gamepad and move the stick: gauntlet gone; move the mouse: back.
5. Alt-tab out and back: no frozen gauntlet at the window edge.
6. Resize the window from small to full-screen 1440p+: the scale steps 1 -> 2 -> 3, pixels stay crisp.
7. Reduced motion on: no squeeze. `KV_SystemCursor` on: Roblox arrow, nothing else changes.
8. 2-player co-op: each client sees only its own gauntlet; die and spectate, click to switch targets still works.
9. Chat focused: gauntlet still visible and usable on the chat window.

## Edge cases

- **Frame latency.** A software cursor can trail the hardware pointer by one frame. C0 measures it; if it feels bad in
  a run, D1's hybrid (engine `MouseIcon` in a run, software cursor only in menus) is the fallback. The engine image
  would then need the fingertip moved to the image centre (a second build output padded around the pivot).
- **Low frame rate.** The cursor moves at the render rate, so a 20 FPS client gets a 20 FPS cursor. The kill switch,
  or later a player setting, is the escape hatch.
- **CoreGui** (Roblox menu, dev console, chat window chrome, the top bar) draws above our ScreenGui; the gauntlet can
  sit under it. The menu case is hidden explicitly; the others are cosmetic.
- **Hover test cost.** `GetGuiObjectsAtPosition` allocates; 20 Hz keeps it negligible.
- **Placeholder pack / missing upload.** System cursor, exactly today's behaviour.

## Decisions (open, recommended default first)

- **D1. Mechanism:** software cursor everywhere (recommended: the engine cursor reverts to the Roblox arrow over
  every GuiButton and puts the click point at the image centre) / engine `MouseIcon` only / hybrid.
- **D2. Size:** integer scale, 2x at 1080 px tall (the hand is ~54 px tall) / 1x (27 px, close to the Roblox arrow) /
  a player setting in Options.
- **D3. Colours:** white normal, yellow over buttons, red over enemies (recommended) / white only / match the local
  player's ring colour in co-op.
- **D4. Over-enemy red (C6):** do it (a clear aim-on-target cue in a bullet hell) / skip it (keep the cursor quiet
  over the busy floor).
- **D5. Click squeeze:** on, off under reduced motion (recommended) / off.

## Out of scope

Cursor trails or particles; a separate crosshair or aim line; changing the gamepad aim (no virtual cursor); a custom
cursor over CoreGui (not possible).

Sources: [Roblox `Mouse` reference (Icon: size, centre click point, ignored over GuiButtons)](https://create.roblox.com/docs/reference/engine/classes/Mouse.md),
[DevForum: "Mouse Icon changes to default cursor when focused on a gui element"](https://devforum.roblox.com/t/2535543).
