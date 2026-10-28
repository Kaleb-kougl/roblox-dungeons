# Mobile play: plan

Kaleb-Vale has no touch controls today. On a phone the HUD shrinks toward unreadable, the corner panels sit where the
thumbs go, Roblox's stock thumbstick and jump button probably show over the game, and every phone budget in the other
plans has only been checked in Studio's emulator. This plan makes phones and tablets a supported platform: two-stick
touch controls, a HUD and menus sized for touch, a tutorial written for touch, and performance measured on real
devices.

It is **input and presentation only**. Every touch control turns into an ordinary `InputFrame` (quantized move, aim and
button bits) in the client's input mapping, exactly like a gamepad. Nothing touches `src/shared/sim/**`,
`src/shared/dungeon/**`, the lockstep wire, a hash, a replay or a fixture. A touch run replays, validates and posts like
any other.

## Status (2026-10-28)

Plan ready for implementation. Nothing is built. Owner decisions MBD1 (controls) and MBD2 (leaderboards) were made
2026-10-28. MBD3-MBD9 are provisional defaults that the build follows as written (the owner may still change them);
MBD10 (haptics) is not in v1. The step-by-step build is **`docs/MOBILE_IMPL.md`** (tasks MB1-MB13, written so a smaller
model can do them one commit at a time); MB0 and MB14-MB16 need a device or Studio and stay with the owner.

## What the code gives us (checked against `main` @ `7defae6`)

| Fact | Where | Consequence |
|---|---|---|
| The sim only sees `InputFrame`: world move (analog, clamped to 1), aim direction, button bits | `shared/sim/input.ts`, `player.ts` | Touch only needs to produce frames. No sim change |
| `mapDevicesToInput` merges a `DeviceSnapshot` (`kbm`, `pad`, `aimDevice`, pointer aim); move is summed and clamped, buttons ORed | `shared/play/inputMapping.ts` | Touch becomes a third source in the same snapshot. `AimDevice` gains `"touch"` |
| Facing = aim, else movement. The bow looses and the sword swings along `p.faceX/Z` **on the release tick** | `player.ts` line ~220, `weapons/defs/bow.ts`, `sword.ts` | A lifted thumb sends aim 0, so a moving player would loose the arrow along their walk. The touch mapper must hold the last aim for a short time after lift (aim latch, MBD7) |
| `InputDeviceKind` is `keyboard` / `gamepad`. The tutorial already has a `touch` prompt variant, filled with the keyboard's text ("Aim with the mouse") | `inputMapping.ts`, `shared/tutorial/steps.ts`, placeholder manifest | Add `touch` to the device kind; write real touch prompts. `tutorial.spec.ts` line ~239 pins "touch = keyboard" and changes on purpose |
| The boon draft is chosen in the sim: the move stick's screen column picks the card, a FIRE press confirms after `DRAFT_MIN_OPEN_TICKS` (30). `DraftOverlay` has no tap handler | `progression.ts` `stepDraft` / `draftColumn` | Tapping a card has to make frames: hold the move toward that column, then one FIRE press |
| The curse shrine accepts on a `SKILL1` press within `SHRINE_RADIUS` | `progressionData.ts` | A contextual button that shows only in reach |
| Spectating cycles with Attack / Alt; the full map toggles through `onMapAction` | docs/SPECTATE.md, `InputController` | Tap targets on the spectate bar and the minimap |
| The top-bar pause button already works with touch | `PauseButton.tsx` | Nothing to do |
| CAS sinks the bound keys and both thumbsticks, but nothing turns off the PlayerModule's touch GUI (`GuiService.TouchControlsEnabled`, `StarterPlayer.DevTouchMovementMode`) | `InputController.ts`, `CharacterController.ts` | The stock thumbstick and jump button probably show on phones. Check in MB0 |
| HUD scale is `min(w / 1280, h / 720)` clamped to `minScale` 0.6. On an 844 x 390 phone that gives body text 20 -> 12 pt and weapon text 16 -> 9.6 pt | `shared/view/hud/layout.ts` | Too small to read on a phone. A touch floor is needed (MB7) |
| Always-on panels: weapons bottom-left, minimap bottom-right | `shared/view/hud/footprint.ts` | Exactly where the thumbs go. Touch needs its own footprint (MBD8) |
| The camera shows `VIEW_TILES_HIGH` = 16.875 tiles on every screen, about 23 pt per tile on a 390 pt phone | `shared/config/view.ts` | Readable. Keep it the same everywhere (MBD5) |
| Solo steps at most `MAX_TICKS_PER_FRAME` = 5 per frame (below 12 fps it runs in slow motion). Co-op catches up 8 per frame, and the input lead grows up to 30 ticks on missed deadlines | `sim/loop.ts`, `lockstep/config.ts` | A slow phone hurts its own player first, and the lead covers cellular jitter. Measure it (MB10, MB11) |
| Phone budgets (atlas texture memory, ~56 MB more on a Demon Lord floor, decor emitters, FX counts, the minimap's `EditableImage`) were only ever checked in the emulator | ART.md, BOSS_DEMONLORD.md, DECOR.md, FX_AUDIO.md, MINIMAP.md | Studio's emulator copies screen size, not phone speed. Measure on real devices (MB0, MB10) |
| The Gauntlet cursor plan already hides the cursor on touch-only devices | docs/CURSOR.md | Use the same device signal (MB3) |

## Player experience

Landscape. Reference layout at 844 x 390 pt, 100 % touch size, everything inside the device safe area:

```
 [status]               [tutorial prompt]  [pause]              [score]

                         (playfield)
                                                 (flask)  (alt)    (ember)
   ( move )                              (accept)
  floating stick                             (swap)  (roll)  ( ATTACK )
  anywhere in the left zone
```

Exact positions, sizes and the fit rules: `TOUCH_LAYOUT` and `touchLayout()` in docs/MOBILE_IMPL.md MB2.

- **Move stick (left).** Floating: it appears under the thumb anywhere in the left zone and walks analog. Full speed
  starts at 70 % of the radius, so the thumb does not have to stretch. When idle, a faded ring shows its home spot.
- **Attack stick (right, large).** Touch it and attack (FIRE held). Keep the thumb inside the centre ring and it
  **auto-targets** the nearest enemy you can see; drag out of the ring and it aims where you drag. Lift and the attack
  stops. The aim holds for 0.25 s, so a swing or combo that is still going keeps its direction.
- **Alt stick (smaller, up and left of Attack).** Same gestures with ALT: hold for the sword guard, aimed or
  auto-targeted. With the bow, drag to aim the charge and lift to loose it along the held aim.
- **Buttons:** Roll (press), Ember and Flask (each shows its count), Swap (the weapons panel is hidden on touch).
  **Accept** (the curse shrine, `SKILL1`) appears in the cluster only while you stand in a shrine's zone.
- **Target marker:** a small ring under the enemy auto-target would hit, shown while Attack or Alt is held in the centre.
- **Spectating:** only two buttons, Next (where Attack was) and Prev (mirrored on the left).
- **Taps:** draft cards (tap = pick; the controls hide while the draft is open), every menu, lobby, pause, Options and
  run-over button. The full map opens from the pause overlay (solo, already there) or a **Map** item in the co-op
  party overlay, and a tap anywhere closes it.
- **Device switch:** the last device used wins. A tablet with a keyboard or a pad hides the touch controls, and the next
  touch brings them back.

## Decisions

Owner, 2026-10-28:

- **MBD1. Controls: two action sticks.** A move stick on the left; on the right an Attack stick and an Alt stick
  (centre = auto-target, drag = manual aim) plus buttons for roll, Ember, flask and swap. Rejected: auto-aim buttons
  (no aimed guards or bow shots) and twin-stick auto-fire (one thumb cannot aim and guard at once).
- **MBD2. Leaderboards: shared.** Auto-target is an input choice, a direction a player could also aim by hand. The
  client computes it and quantizes it into the frame, so replays and server validation are unchanged. No device tag, no
  separate boards (a client cannot prove its device anyway).

Recommended defaults (open):

- **MBD3. No sim change, firm.** Every touch behaviour, auto-target and draft taps included, produces ordinary
  `InputFrame`s on the client. Auto-target reads sim state read-only and never runs inside `step()`.
- **MBD4. Landscape only, phones and tablets.** `ScreenOrientation = LandscapeSensor`. Portrait is out of scope.
- **MBD5. Camera unchanged.** The same 16.875 tiles high on every device: everyone sees the same room. No touch zoom.
- **MBD6. Auto-target rule.** Living hostile actors (bosses, turrets and the tutorial dummy included; corpses,
  teammates and breakables not) within `TOUCH.autoTarget.rangeTiles` (start at 9) and in line of sight on the grid
  (walls and solid pillars block, like the minimap's sight). Nearest wins, with a bonus inside a cone around the current
  facing and hysteresis for the current target, so it does not flicker between two. No target: the current facing, so a
  tap still swings forward. Options toggle, default On.
- **MBD7. Aim latch.** After a stick lifts, the frame keeps its last aim for `TOUCH.aimLatchTicks` (15 = 0.25 s), then
  aim goes to 0 (face movement, like a released right stick).
- **MBD8. Touch HUD.** The bottom corners belong to the thumbs. On touch the weapons panel and the corner minimap are
  hidden (a phone has no room for a map in the cluster); the full map opens from the pause overlay (solo) or a Map item
  in the co-op party overlay, and a tap closes it. The tutorial prompt moves to the top centre, under the boss bar. The
  controls scale down (never below `TOUCH_LAYOUT.minScale`) so they never reach the status / score panels.
- **MBD9. Customization: presets only in v1.** Touch size (80 / 100 / 120 %), opacity (40 / 70 / 100 %),
  auto-target on or off, left-handed (mirrored). They live in `DisplaySettings` (the existing overrides-only pattern; the
  settings document stays v2) and show on Options > Display on touch-capable devices only. A fixed move stick and
  drag-to-edit layouts come later, if players ask.
- **MBD10. Haptics only if the engine supports them.** A short buzz on hurt and heavy hits, under a setting, only if
  MB0 shows that Roblox vibrates phones. Otherwise out of scope.

## Architecture

- **Pure core, `shared/play/touch/`** (headless, specced): `TouchControls` (fingers -> one `TouchSnapshot` per frame:
  floating move stick, Attack / Alt action sticks with centre auto-target and the aim latch, buttons, a minimum press
  time so a quick tap still reaches a tick, draft-pick pulses), `pickAutoTarget` (MBD6), `draftStatus` /
  `draftColumnForCard`, and `touchMode` (hidden / play / spectate). `DeviceSnapshot.touch` joins `mapDevicesToInput`.
- **Layout, `shared/view/hud/touchLayout.ts`** (pure, specced over phones and tablets): where every control sits for a
  viewport, a HUD scale, a size and a hand.
- **Client.** `InputController` owns the `TouchControls` and asks it for a frame in `sample()` (SimController passes the
  run state, player index and bullet blocker). `TouchControlsController` builds the controls imperatively (one
  ScreenGui, GuiButtons whose `InputBegan` starts a finger, global `TouchMoved` / `TouchEnded`), sets the mode each
  frame before the sim samples, turns off the stock touch GUI, locks landscape and draws the auto-target ring.
  Stick math only ever uses deltas between two touch positions, so touch space and GUI space never mix (except where the
  floating base is drawn: one offset constant, measured by the spike).
- **Theme.** Required strings `TOUCH_STRING_KEYS` (`touch.*`), four `options.display.touch*` strings, the rewritten
  `tutorial.prompt.*.touch` texts (no key placeholders). No new colour roles or images in v1.

## Tasks

Implementer steps (MB1-MB13) are spelled out in **docs/MOBILE_IMPL.md**; [owner] steps need a device or Studio.

- [ ] **MB0 [owner]. Device spike.** Run `KV_TouchSpike` (built in MB1) on a low-end Android, an iPhone and a tablet;
  fill the docs/SPIKES.md table (stock touch GUI, InputObject identity, touch vs GUI offset, mouse emulation, fps /
  memory on floor 1, a Demon Lord floor and `KV_Stress`). → Verify: table filled; go / no-go on MBD4.
- [ ] **MB1. Touch spike overlay** (`KV_TouchSpike`, off by default).
- [ ] **MB2. Tunables and layout.** `TOUCH`, `HUD_VIEW.touchMinScale`, `touchLayout()` + spec.
- [ ] **MB3. TouchControls state machine** + spec.
- [ ] **MB4. Touch in the input mapping** (`DeviceSnapshot.touch`, device / aim kinds, `keyDevice`) + spec.
- [ ] **MB5. Auto-target** + spec.
- [ ] **MB6. Draft helpers and `touchMode`** + specs.
- [ ] **MB7. Settings and strings** + specs.
- [ ] **MB8. InputController / SimController wiring.**
- [ ] **MB9. TouchControlsController** (the on-screen controls).
- [ ] **MB10. HUD on touch** (scale floor, hidden panels, full map, draft taps, touch hints, tutorial prompt on top,
  touch footprint spec).
- [ ] **MB11. Options touch rows.**
- [ ] **MB12. Tutorial prompts for touch.**
- [ ] **MB13. Docs** (CLIENT.md, CLAUDE.md decision log, this file).
- [ ] **MB14 [owner]. Studio emulator and device check, tuning** (docs/CLIENT.md "Mobile" smoke test; `TOUCH` /
  `TOUCH_LAYOUT`). → Verify: a first-time player finishes the tutorial and reaches floor 3 on a phone without help.
- [ ] **MB15 [owner]. Performance pass.** Repeat the MB0 numbers with the controls on. If a budget fails, add an Effects
  setting (Full / Light: decor emitters, ambient flipbooks and afterimages off; half-resolution atlases as ART.md
  reserves). → Verify: 60 fps on the mid iPhone, >= 30 fps on the low-end Android on a Demon Lord floor.
- [ ] **MB16 [owner]. Co-op with mixed devices.** PC + phone, 2 and 4 players, Wi-Fi and cellular. → Verify: no desync,
  the input lead settles, spectating and invites work on a phone.

## Testing

- **Headless:** the layout, the state machine, the input merge, auto-target, draft helpers, the mode rule, settings,
  strings, the touch footprint and the tutorial texts (MB2-MB7, MB10, MB12).
- **Studio emulator:** layout, safe area, one finger (the mouse stands in for a single touch). It cannot test
  multi-touch or phone speed.
- **Real devices:** a private published place (`npm run build:place`, the same route the I0 invites spike uses). This
  is the only place to test multi-touch, feel, latency and performance.

## Risks

- **Thumbs hide the bottom of the screen.** Bullets coming from below are partly covered. Mitigations: opacity, the
  dead space between the sticks, and checking in MB12 whether the player should sit slightly above centre on touch (a
  view-only offset; it would change what a touch player sees, so it needs an owner call).
- **Small tap targets in menus.** At the touch HUD scale (0.75) the menu rows are 22-27 pt tall, under Apple's 44 pt
  guideline. MB14 decides whether menus need their own larger scale on phones.
- **Auto-target as an edge.** Same boards (MBD2). The hysteresis and LOS rules keep it close to what a careful player
  would aim; watch the ranked numbers by device in telemetry if one is added.
- **Low-end Android performance.** Texture memory (atlases plus Demon Lord art), Highlights and decor emitters.
  MB10's Effects setting and the half-resolution atlases are the fallback.
- **`EditableImage` budget on phones.** If the map image cannot be created, the full map is unavailable on that
  device (the corner minimap is already off on touch).
- **1 px player outline on a phone** (docs/PLAYER_OUTLINE.md risk): measure in MB12; the fallback is `widthPx: 2`.
- **Roblox chrome.** The top bar, the chat window and the iPhone home indicator compete for the corners. Use device
  safe insets; check the chat window against the status panel.
- **Cellular latency.** The input lead grows up to 30 ticks (0.5 s): playable but sluggish. Measure in MB11.

## Out of scope

Portrait, drag-to-edit layouts, gyro aim, separate touch leaderboards, a phone-specific camera zoom. A pad connected to
a phone already works as a gamepad.
