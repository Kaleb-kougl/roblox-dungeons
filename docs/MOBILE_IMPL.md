# Mobile play: implementation guide

Step-by-step build instructions for `docs/MOBILE.md`, written for an implementer who has not seen the planning
discussion. Do the steps **in order**, one commit each. Every step says what to read, what to write, which specs to add
and how to check it. Where this guide gives code, use it as written unless the compiler or a spec proves it wrong. If it
is wrong, fix it the smallest way and say so in the commit message.

Steps marked **[owner]** need a phone, a tablet or Studio. Do not do them; leave their checkboxes in `docs/MOBILE.md`
open.

## 0. Rules for this work

Read `CLAUDE.md` first (all of it), then `docs/MOBILE.md`. The rules that matter most here:

1. **Never edit `src/shared/sim/**`, `src/shared/dungeon/**`, `fixtures/**` or the source project.** Touch input only
   produces ordinary `InputFrame`s. If a step seems to need a sim or dungeon change, **stop and report**.
2. **Run `npm run verify` before every commit.** It must pass. Rerun only the specs you touched with
   `npm run test:only -- <path filter>` (for example `npm run test:only -- play/touch`).
3. **No magic numbers.** Every tunable goes in the config objects this guide names (`TOUCH`, `TOUCH_LAYOUT`,
   `HUD_VIEW`, settings defaults).
4. **Barrels.** Each new directory gets an `index.ts`; import from the directory (`shared/play`, `shared/view/hud`),
   never from the file.
5. **roblox-ts traps** (from CLAUDE.md, and the ones this work hits):
   - `Map` / `Set` iteration order is NOT insertion order in Luau. Anything that needs an order (fingers, "most recent
     stick") uses an **array** or explicit sequence numbers.
   - No `splice` / `slice`: use `arr.remove(i)` inside a `while` loop when removing while iterating.
   - `for (let i = 0; i < arr.size(); i++)` reads the bound once: use `while` if the body changes the array.
   - Interface members that are functions: type them as properties `f: () => T` and pass arrow functions.
   - `null` → `undefined`; `.length` → `.size()`.
6. **Client code cannot be tested headlessly.** Only `src/shared/**` specs run. For client steps, "verified" means
   typecheck + lint + build pass; the Studio and device checks are [owner] steps.
7. **Janitor** for cleanup; every connection and Instance a controller makes goes into its Janitor.
8. **Stop and report** (plain text: what failed, the file, the command output) when the baseline `npm run verify` fails
   before you start, when a spec you did not write fails and this guide does not say how to fix it, when a layout spec
   still fails after the tuning this guide allows, or when a name this guide uses does not exist and the right one is
   not obvious.

**Before step MB1:** `git status` must be clean. If it shows changes you did not make (another feature in progress),
stop and ask the owner to commit them. Then `git switch -c mobile` from `main`, and run `npm run verify` once to confirm
the baseline passes.

## Decisions this guide implements

From `docs/MOBILE.md`. Owner-approved: MBD1 (two action sticks), MBD2 (shared leaderboards). Provisional defaults,
built as written: MBD3-MBD9. Out of v1: MBD10 (haptics). Short version:

- Left: a floating move stick anywhere in the move zone. Right cluster: an Attack stick, an Alt stick, and Roll, Ember,
  Flask, Swap buttons, plus Accept (curse shrine) only while `snapshot.atShrine`.
- Attack / Alt: touch = hold FIRE / ALT. Inside the centre ring: aim at the auto-target (setting on) or along the
  current facing (setting off). Drag past the ring: manual aim, which stays manual until lift. After a lift the last aim
  holds for `TOUCH.aimLatchSec`.
- While spectating: only Next (FIRE bit) and Prev (ALT bit). While the boon draft is open: the controls hide; tap a card.
- On touch the weapons panel and the corner minimap are hidden. The full map opens from the pause overlay (solo,
  already there) or a new **Map** item in the co-op party overlay, and a tap closes it.
- The tutorial prompt moves to the top centre on touch. The HUD scale floor on touch is `HUD_VIEW.touchMinScale` (0.75).
- Touch settings (size, opacity, auto-target, left-handed) live in `DisplaySettings` and show on the Display tab only
  on touch-capable devices.

---

## MB1. Touch spike (debug overlay, off by default)

**Goal:** a debug overlay the owner turns on in a published place on a phone (step MB0 [owner]) to answer the open
engine questions. Build it first so the device test can run while you do the rest.

**Read:** `src/shared/config/spikes.ts`, `src/client/controllers/spikes/spikeFlags.ts`,
`src/client/controllers/spikes/index.ts`, one existing spike controller (`CameraSpikeController.ts`), `docs/SPIKES.md`
("Turning a spike on", "Spike I0").

**Write:**

1. `src/shared/config/spikes.ts`: add `touch: false` to `SPIKE_DEFAULTS` and `touch: "KV_TouchSpike"` to
   `SPIKE_ATTRIBUTES`. Add `TOUCH_SPIKE = { refreshSec: 0.25, probeSize: 120, maxFingerLines: 5 } as const`.
2. `src/client/controllers/spikes/TouchSpikeController.ts` (export it from the spikes barrel). While the flag is on,
   it builds a ScreenGui `KV_TouchSpike` (ScreenInsets `CoreUISafeInsets`, DisplayOrder 50) with:
   - a TextLabel (top centre, monospace `MONO_FONT` from `client/ui`) refreshed every `refreshSec`, listing:
     `TouchEnabled`, `MouseEnabled`, `KeyboardEnabled`, `GamepadEnabled`, `GuiService.TouchControlsEnabled`,
     `PlayerGui.CurrentScreenOrientation`, fps (frames / seconds over the refresh window),
     `Stats.GetTotalMemoryUsageMb()`,
     `Stats.GetMemoryUsageMbForTag(Enum.DeveloperMemoryTag.GraphicsTexture)`,
     `UserInputService.IsMouseButtonPressed(Enum.UserInputType.MouseButton1)`, `UserInputService.GetMouseLocation()`,
     the ScreenGui's `AbsolutePosition` / `AbsoluteSize` and `GuiService.GetGuiInset()`;
   - one line per active finger (up to `maxFingerLines`): a number assigned per `InputObject` the first time
     `UserInputService.TouchStarted` sees it (a `Map<InputObject, number>`), its `Position`, and the `gameProcessed`
     flag of its `TouchStarted`;
   - a probe: a `probeSize` square TextButton at the bottom left. Its `InputBegan` handler records whether the
     `InputObject` it receives is the same object (`===`) as the one `TouchStarted` gave for that finger, and the touch
     `Position` minus the button's `AbsolutePosition` (tap the probe's top-left corner: this shows the offset between
     touch space and GUI space);
   - a second line: "probe same object: yes / no", "probe offset: x, y".
   Turning the flag off destroys everything (Janitor). Use `watchSpikeFlag("touch", ...)`.
3. `docs/SPIKES.md`: a section "Spike MB0: touch input (docs/MOBILE.md)": how to turn it on in a published place (the
   server console: `workspace:SetAttribute("KV_TouchSpike", true)`), the test script below, and an empty results
   table.
   - Test script: (1) read the flags; (2) put 1, 2, 3 fingers down and move them: do the numbers stay with their
     fingers?; (3) tap the probe's top-left corner: the offset; (4) hold a finger anywhere: does
     `IsMouseButtonPressed` read true and does `GetMouseLocation` follow the finger?; (5) is the stock thumbstick / jump
     button visible before step MB9 lands?; (6) fps and memory on endless floor 1, a Demon Lord floor (find a seed with
     `node scripts/find-boss-seed.js`) and `KV_Stress` 600.
   - Results table columns: Question | Low-end Android | iPhone | Tablet.

**Verify:** `npm run verify`.
**Commit:** `Mobile MB1: KV_TouchSpike debug overlay (docs/MOBILE.md MB0 runs it on devices)`.

---

## MB2. Touch tunables and the layout (pure)

**Goal:** every number the touch controls use, and a pure function that places the controls on any screen, with a spec
that proves they fit.

**Read:** `src/shared/view/hud/layout.ts` (`HUD_VIEW`, `computeHudScale`), `src/shared/view/hud/footprint.ts`
(`HUD_FOOTPRINT`, `cornerRect`, `footprintRects`, `HUD_TEST_TOP_INSET`, `ScreenRect`), `footprint.spec.ts`.

### 2a. `src/shared/config/touch.ts` (export from `src/shared/config/index.ts`)

```ts
/** Touch controls tunables (docs/MOBILE.md). Seconds, fractions and reference px; data only. */
export const TOUCH = {
	/** A press counts for at least this long, so a quick tap still reaches a sim tick (3 ticks at 60 Hz). */
	minPressSec: 0.05,
	/** Longest dt one sample may use (a hitch never burns the whole aim latch at once). */
	maxFrameSec: 0.1,
	/** Drag distance for a full stick, reference px (scaled with the controls). */
	stickRadiusRef: 60,
	move: {
		/** Stick length (0..1) below which the move stick walks nowhere. */
		deadzone: 0.15,
		/** Stick length at which the walk reaches full speed. */
		runFraction: 0.7,
	},
	action: {
		/** Attack / Alt: a stick shorter than this (0..1) is "centre" (auto-target / facing); longer is manual aim. */
		centreFraction: 0.3,
	},
	/** After an Attack / Alt lift the last aim holds this long (the bow looses along it; MBD7). */
	aimLatchSec: 0.25,
	autoTarget: {
		rangeTiles: 9,
		/** cos of the half-angle of the facing cone that gets the bonus (0.5 = 60 degrees). */
		coneCos: 0.5,
		/** Distance multipliers (lower wins): inside the facing cone, and the current target (hysteresis). */
		coneFactor: 0.75,
		stickyFactor: 0.7,
	},
	draft: {
		/** A tapped card's FIRE pulse length, and the wait before another pulse while the draft is still open. */
		pulseSec: 0.05,
		retrySec: 0.5,
	},
	marker: {
		/** The auto-target ring under the target: radius and height (tiles), transparency. */
		radiusTiles: 0.6,
		heightTiles: 0.05,
		transparency: 0.35,
	},
} as const;
```

If the barrel already exports a name `TOUCH`, rename this one `TOUCH_INPUT` everywhere in this guide.

### 2b. `HUD_VIEW.touchMinScale` and `computeHudScale` (`src/shared/view/hud/layout.ts`)

- Add `touchMinScale: 0.75,` to `HUD_VIEW` right after `minScale`, with the doc comment
  `/** On touch (docs/MOBILE.md MB10): never below this, so body text stays >= 15 pt on a phone. */`.
- Change the signature to
  `computeHudScale(viewportW, viewportH, tenFoot, userPercent = PERCENT, touch = false)` and use
  `touch ? HUD_VIEW.touchMinScale : HUD_VIEW.minScale` as the lower clamp. With `touch` false nothing changes (the
  existing specs must still pass untouched).
- Add to `hud.spec.ts`: `computeHudScale(844, 390, false, 100, true)` is 0.75; `computeHudScale(844, 390, false)`
  is still `HUD_VIEW.minScale`; `computeHudScale(1920, 1080, false, 100, true)` equals the non-touch value.

### 2c. `src/shared/view/hud/touchLayout.ts` (export from the `shared/view/hud` barrel)

```ts
/**
 * Where the touch controls sit (docs/MOBILE.md MB2), pure. Positions are reference px measured from the ACTION side's
 * bottom corner of the safe area (the right edge, or the left when left-handed): x inward from that side edge, y up
 * from the bottom. touchLayout() scales them so the cluster never reaches the status / score panels, never below
 * TOUCH_LAYOUT.minScale.
 */
import { TOUCH } from "shared/config";
import { HUD_FOOTPRINT, type ScreenRect } from "./footprint";
import { computeHudScale, HUD_VIEW } from "./layout";

export type TouchButtonId =
	| "attack" | "alt" | "roll" | "ember" | "flask" | "swap" | "shrine" | "spectateNext" | "spectatePrev";

export type TouchLayoutMode = "play" | "spectate";

interface CircleSpec {
	readonly id: TouchButtonId;
	readonly x: number;
	readonly y: number;
	readonly r: number;
	/** "action" side (default right) or the "move" side (spectate's Prev). */
	readonly side: "action" | "move";
}

export const TOUCH_LAYOUT = {
	/** Between KV_GameHud (HUD_VIEW.hudDisplayOrder) and the menus (HUD_VIEW.menuDisplayOrder). */
	displayOrder: 11,
	minScale: 0.55,
	/** Reference px between the corner panels' budget boxes and the controls. */
	clusterGap: 8,
	/** The move zone's widest share of the safe area's width. */
	moveZoneWidthShare: 0.4,
	/** The move stick's idle ring, from the move side's bottom corner. */
	moveHome: { x: 150, y: 150, r: 60 },
	/** Smallest circle diameter (px) the spec accepts. */
	minDiameterPx: 40,
	/** Fill alpha at 100 % opacity, and the pressed fill's multiplier (capped at 1). */
	fillAlpha: 0.55,
	pressedFillBoost: 1.6,
	play: [
		{ id: "attack", x: 140, y: 140, r: 75, side: "action" },
		{ id: "roll", x: 280, y: 70, r: 45, side: "action" },
		{ id: "alt", x: 250, y: 230, r: 50, side: "action" },
		{ id: "ember", x: 60, y: 260, r: 38, side: "action" },
		{ id: "flask", x: 380, y: 250, r: 38, side: "action" },
		{ id: "swap", x: 400, y: 110, r: 38, side: "action" },
		{ id: "shrine", x: 480, y: 170, r: 38, side: "action" },
	] as ReadonlyArray<CircleSpec>,
	spectate: [
		{ id: "spectateNext", x: 140, y: 140, r: 60, side: "action" },
		{ id: "spectatePrev", x: 140, y: 140, r: 60, side: "move" },
	] as ReadonlyArray<CircleSpec>,
} as const;

/** A placed circle, px, origin at the safe area's top left. */
export interface TouchCircle {
	readonly id: TouchButtonId;
	readonly cx: number;
	readonly cy: number;
	readonly r: number;
}

export interface TouchLayoutResult {
	/** The controls' scale (reference px -> px). */
	readonly scale: number;
	/** The HUD scale the corner panels use on touch (computeHudScale with touch = true). */
	readonly hudScale: number;
	/** px from the safe area's top that the corner panels' boxes (and their gap) take. */
	readonly topBand: number;
	/** The move zone (play mode only). */
	readonly moveZone: ScreenRect | undefined;
	readonly moveHome: TouchCircle | undefined;
	readonly buttons: ReadonlyArray<TouchCircle>;
	readonly stickRadiusPx: number;
}
```

The function, with these exact rules:

```ts
export function touchLayout(
	viewportW: number, viewportH: number,   // camera.ViewportSize (what computeHudScale reads)
	safeW: number, safeH: number,           // the touch ScreenGui's AbsoluteSize (CoreUISafeInsets)
	hudPercent: number,                      // DisplaySettings.hudScale
	sizePercent: number,                     // DisplaySettings.touchSize
	leftHanded: boolean,
	mode: TouchLayoutMode,
): TouchLayoutResult
```

1. `hudScale = computeHudScale(viewportW, viewportH, false, hudPercent, true)`.
2. `topBand = (HUD_VIEW.margin + max(HUD_FOOTPRINT.status.maxH, HUD_FOOTPRINT.score.maxH) + TOUCH_LAYOUT.clusterGap) * hudScale`.
3. `clusterTop` = the largest `y + r` over `TOUCH_LAYOUT.play` (compute it, do not hard-code 298).
   `fit = (safeH - topBand) / clusterTop`.
4. `scale = math.max(TOUCH_LAYOUT.minScale, math.min(hudScale * sizePercent / 100, fit))`.
5. A circle on the action side: `cx = actionRight ? safeW - x * scale : x * scale` (`actionRight = !leftHanded`); on the
   move side, the mirror. `cy = safeH - y * scale`, radius `r * scale`.
6. Play mode only: `clusterLeft` = the largest `(x + r) * scale` over the play circles. The move zone is on the move
   side: width `math.min(safeW * moveZoneWidthShare, safeW - clusterLeft - clusterGap * scale)`, from `y = topBand` to
   `safeH`. `moveHome` is placed like a move-side circle. Spectate mode: `moveZone` and `moveHome` are `undefined`.
7. `stickRadiusPx = TOUCH.stickRadiusRef * scale`.

Also export `TOUCH_TEST_VIEWPORTS` (px): `667x375, 844x390, 932x430, 1024x768, 1180x820, 1366x1024`.

### 2d. `src/shared/view/hud/touchLayout.spec.ts`

Loop over every `TOUCH_TEST_VIEWPORTS` entry, top inset in `[0, HUD_TEST_TOP_INSET]` (safe = `vw` x `vh - inset`), HUD
percent in the entries of `HUD_SCALE_PERCENTS` that are `<= 100` (import from `shared/settings`), size percent in
`[80, 100, 120]`, both hands, both modes. Assert:

1. Every circle lies inside the safe rect.
2. No two circles overlap (`distance >= r1 + r2`).
3. Every circle's top (`cy - r`) is `>= topBand - 0.5`.
4. Play mode: the move zone does not intersect any circle (use a circle-vs-rect test), and its width is at least
   `0.3 * safeW`.
5. Every circle's diameter is `>= TOUCH_LAYOUT.minDiameterPx`.
6. Left-handed is the mirror: same ids, `cx` = `safeW - cx` of the right-handed result, same `cy` and `r`.
7. `stickRadiusPx === TOUCH.stickRadiusRef * scale`.

Put the failing combination in the expectation (for example `expect([label, ok]).toEqual([label, true])`, as
`footprint.spec.ts` does), so a failure names the viewport.

**If 2, 3 or 5 fail:** first lower `TOUCH_LAYOUT.minScale` in 0.05 steps (not below 0.45). If they still fail,
**stop and report** the failing combinations. Do not move circles without telling the owner.

**Verify:** `npm run test:only -- view/hud`, then `npm run verify`.
**Commit:** `Mobile MB2: touch tunables, touch HUD scale floor, touch layout + spec`.

---

## MB3. The touch state machine (pure)

**Goal:** fingers in, one `TouchSnapshot` per frame out. No Roblox API.

**Read:** `src/shared/play/inputMapping.ts` (`screenToWorld`, `clampUnit`, `normalizeOrZero`, `Vec2`),
`src/shared/sim/input.ts` (`Button`), `src/shared/sim/progression/progressionData.ts` (`DRAFT_COLUMN_*`).

Create `src/shared/play/touch/` with `controls.ts`, `index.ts` (`export * from "./controls";`, later steps add files),
and add `export * from "./touch";` to `src/shared/play/index.ts`. In `controls.ts`, import `screenToWorld` and
`clampUnit` from `"../inputMapping"` (a file import inside the same package is fine; it avoids a barrel cycle).

```ts
export type TouchControlId =
	| "move" | "attack" | "alt" | "roll" | "ember" | "flask" | "swap" | "shrine" | "spectateNext" | "spectatePrev";

/** Sim button bit per control (move: none). Spectate's Next / Prev are FIRE / ALT: SimController's spectateCommand reads them. */
export const TOUCH_CONTROL_BITS: ReadonlyMap<TouchControlId, number> = new Map<TouchControlId, number>([
	["attack", Button.FIRE],
	["alt", Button.ALT],
	["roll", Button.ROLL],
	["ember", Button.EMBER],
	["flask", Button.FLASK],
	["swap", Button.SWAP],
	["shrine", Button.SKILL1],
	["spectateNext", Button.FIRE],
	["spectatePrev", Button.ALT],
]);

/** One frame of touch input: move screen-relative (right, up), aim in WORLD space (x, z; (0, 0) = none), button bits. */
export interface TouchSnapshot {
	readonly moveX: number;
	readonly moveY: number;
	readonly aimX: number;
	readonly aimZ: number;
	readonly buttons: number;
}

export interface WorldVec {
	readonly x: number;
	readonly z: number;
}

export interface TouchFrameEnv {
	/** Seconds since the previous frame() (already clamped by the caller). */
	readonly dt: number;
	readonly stickRadiusPx: number;
	/** The auto-target setting (DisplaySettings.touchAutoTarget). */
	readonly autoTarget: boolean;
	/** The player's facing (world), used when there is no auto-target. */
	readonly facingX: number;
	readonly facingZ: number;
	/** World vector player -> auto-target, or undefined. Called at most once per frame, only when a centre stick needs it. */
	readonly autoAim: () => WorldVec | undefined;
	readonly draftOpen: boolean;
	readonly draftReady: boolean;
}

/** Where a stick is drawn (raw touch px): the touch-down point and the current finger. */
export interface StickView {
	readonly x0: number;
	readonly y0: number;
	readonly x: number;
	readonly y: number;
}
```

Internals:

```ts
interface Finger {
	readonly id: number;
	readonly control: TouchControlId;
	/** Begin order (TouchControls.seq): the most recent held Attack / Alt aims. */
	readonly order: number;
	readonly x0: number;
	readonly y0: number;
	x: number;
	y: number;
	heldSec: number;
	ended: boolean;
	/** Attack / Alt: left the centre ring once; stays manual until lifted. */
	manual: boolean;
	dirX: number;
	dirY: number;
}
```

Free functions (exported, so the spec can test them):

- `stickVector(x0, y0, x, y, radiusPx): Vec2`. Returns `clampUnit((x - x0) / radiusPx, (y0 - y) / radiusPx)`. Screen y
  grows down, so up is positive. A radius `<= 0` gives `{ x: 0, y: 0 }`.
- `shapeMove(v: Vec2): Vec2`. With `len = |v|`: if `len <= TOUCH.move.deadzone` → zero; else
  `k = math.min(1, (len - dz) / (TOUCH.move.runFraction - dz)) / len` and return `{ x: v.x * k, y: v.y * k }`.
- `draftScreenX(column: number): number` → `column - DRAFT_COLUMN_CENTRE` (left -1, centre 0, right +1).

`export class TouchControls`:

- Fields: `private fingers = new Array<Finger>()`, `private seq = 0`, latch (`latchX`, `latchZ`, `latchSec`), draft
  (`draftColumn: number | undefined`, `draftPulseSec`, `draftCooldownSec`), `private autoAimed = false`.
- `begin(id, control, x, y)`: ignore it if a finger with the same `id` exists, or a NOT ended finger already holds
  `control`. Otherwise push a new `Finger` with `order = ++this.seq` (write it as `this.seq += 1; order: this.seq`),
  `heldSec = 0`, `manual = false`.
- `move(id, x, y)`: the finger with that `id` and `!ended` gets `x, y`.
- `end(id)`: that finger gets `ended = true`. It is removed in `frame()` once `heldSec >= TOUCH.minPressSec`.
- `reset()`: drop every finger, `latchSec = 0`. Keep a queued draft pick.
- `queueDraftPick(column)`: `draftColumn = column`, `draftPulseSec = 0`, `draftCooldownSec = 0`.
- `hasDraftPick()`, `isHeld(control)` (a finger on it, ended or not), `stickView(control)` (the first finger on it, or
  `undefined`), `lastAimWasAuto()` (`autoAimed` of the last frame).
- `frame(env): TouchSnapshot`, in this order:
  1. `autoAimed = false`. For each finger: `heldSec += env.dt`.
     - `move`: `moveX, moveY = shapeMove(stickVector(...))`.
     - other controls: `buttons |= TOUCH_CONTROL_BITS.get(control) ?? 0`. For `attack` / `alt`, the finger with the
       highest `order` computes the aim (below).
  2. **Action aim** for that finger: `v = stickVector(...)`, `len = |v|`. If `len > TOUCH.action.centreFraction`, set
     `manual = true` and `dirX, dirY = v / len`. If `manual`: aim = `screenToWorld(dirX, dirY)`. Else, if
     `env.autoTarget` and `env.autoAim()` returns a non-zero vector: aim = that vector and `autoAimed = true`. Else
     aim = `(env.facingX, env.facingZ)`.
  3. **Latch:** if a stick gave an aim, store it in the latch with `latchSec = TOUCH.aimLatchSec`. Else, if
     `latchSec > 0`: aim = the latch, then `latchSec -= env.dt`. Else aim = `(0, 0)`.
  4. **Draft pick:** if `draftColumn !== undefined`. If `!env.draftOpen`, or `env.draftDeal` differs from the deal the
     pick saw on its first frame (a pick re-dealt the open draft: builds' boss double draft, docs/BUILDS.md BUD4): clear
     it (fixed 2026-11-09: the queued column had confirmed the same column on the second deal). Otherwise:
     `moveX = draftScreenX(draftColumn)`, `moveY = 0`, then
     - if `draftPulseSec > 0`: `buttons |= Button.FIRE`, `draftPulseSec -= dt`;
     - else if `draftCooldownSec > 0`: `draftCooldownSec -= dt`;
     - else if `env.draftReady`: `buttons |= Button.FIRE`, `draftPulseSec = TOUCH.draft.pulseSec - dt`,
       `draftCooldownSec = TOUCH.draft.retrySec`.
  5. Remove ended fingers whose `heldSec >= TOUCH.minPressSec` (a `while` loop with `this.fingers.remove(i)`).
  6. Return `{ moveX, moveY, aimX, aimZ, buttons }`.

### `src/shared/play/touch/controls.spec.ts`

Use a helper `env(overrides)` with defaults `dt = 1/60`, `stickRadiusPx = 100`, `autoTarget = true`,
`facingX = 0`, `facingZ = 1`, `autoAim = () => undefined`, `draftOpen = false`, `draftReady = false`. Cases:

1. `stickVector`: up-drag of 50 px with radius 100 gives `(0, 0.5)`; a 300 px drag clamps to length 1; radius 0 gives
   zero.
2. `shapeMove`: below the deadzone → zero; at `runFraction` → length 1; in between is monotonic.
3. Move: begin `move` at (100, 100), move to (100, 30) → `moveY > 0` and `moveX === 0`; after `end` + frames past
   `minPressSec` → zero.
4. Buttons: a tap on `roll` (begin + end before any frame) still gives `Button.ROLL` on the next frame(s) until
   `minPressSec` passes, then none.
5. One finger per control: a second `begin` on `attack` while one holds it is ignored.
6. Attack in the centre with `autoAim` returning `(3, 4)` → aim `(3, 4)`, FIRE set, `lastAimWasAuto()` true; with
   `autoTarget = false` → aim = the facing.
7. Attack dragged right past the ring → aim = `screenToWorld(1, 0)` (compare with `toBeCloseTo`), and it stays the same
   after dragging back into the centre (manual sticks).
8. Latch: after the attack finger ends and is removed, the next frames keep the last aim for `aimLatchSec`, then
   `(0, 0)`.
9. Attack and Alt both held: the later one aims; both bits set.
10. Draft: `queueDraftPick(DRAFT_COLUMN_LEFT)` with `draftOpen` and not `draftReady` → `moveX === -1` and no FIRE; with
    `draftReady` → FIRE for `pulseSec`, then no FIRE for `retrySec`, then FIRE again; `draftOpen = false` clears the
    pick.
11. `reset()` drops fingers and the latch and keeps the draft pick.

**Verify:** `npm run test:only -- play/touch`, then `npm run verify`.
**Commit:** `Mobile MB3: TouchControls state machine (pure) + spec`.

---

## MB4. Touch as a device in the input mapping

**Goal:** `mapDevicesToInput` merges a `TouchSnapshot`; `InputDeviceKind` and `AimDevice` gain `"touch"`; every place
that looks up a per-device hint still compiles.

**Read:** `src/shared/play/inputMapping.ts` (the whole file), `inputMapping.spec.ts`, `src/shared/play/bindings.ts`
(`DeviceHint` and the `*Hint` functions), `src/shared/tutorial/flow.ts` (`tutorialDeviceFor`).

**Write:**

1. `inputMapping.ts`:
   - `import type { TouchSnapshot } from "./touch";` (type only: no runtime cycle).
   - `AimDevice = "none" | "mouse" | "stick" | "touch"`, `InputDeviceKind = "keyboard" | "gamepad" | "touch"`.
   - `DeviceSnapshot` gains `readonly touch?: TouchSnapshot;` (optional: existing specs build snapshots without it).
   - In `mapDevicesToInput`: add the touch move to the sum
     (`clampUnit(kb.x + ls.x + (tm?.moveX ?? 0), kb.y + ls.y + (tm?.moveY ?? 0))` with `const tm = snap.touch`); a new
     aim branch `else if (snap.aimDevice === "touch" && tm !== undefined) aim = normalizeOrZero(finite(tm.aimX), finite(tm.aimZ));`;
     and `if (tm !== undefined) buttons = bit32.bor(buttons, tm.buttons);` before quantizing.
   - `InputDeviceTracker`: `touched(): void { this.device = "touch"; }` and
     `touchAimed(): void { this.aimDevice = "touch"; }`.
   - Export `keyDevice(device: InputDeviceKind): "keyboard" | "gamepad"` (touch → `"keyboard"`), documented as "the
     key-name table to read on this device; touch hides those lines (MB10) but must not index a missing field".
2. Run `npm run typecheck`. Every `X[device]` lookup on a keyboard / gamepad table now fails to compile (they are in
   `src/client/ui/**`: LobbyRoom, LobbyBrowser, TutorialPanel, SpectateBar, OptionsScreen, FullMapOverlay,
   LeaderboardPanel, DraftOverlay, TutorialOutro, WeaponPanel, ToastPanel, PauseOverlay, and `menu/hooks.ts`). Change
   each one to `X[keyDevice(device)]`. Do not change anything else in those files in this step.
3. `RunOverPanel.tsx` (`device === "gamepad" ? ... : ...`) and `AudioController.ts` (`!== "gamepad"`) still compile;
   leave them.
4. `shared/tutorial/flow.ts`: `tutorialDeviceFor(device: InputDeviceKind): TutorialDevice` returns `device` as-is for
   all three (import the type from `shared/play`; if that creates an import cycle, type the parameter as
   `"keyboard" | "gamepad" | "touch"`). The touch prompt texts still equal the keyboard ones until MB12, so nothing on
   screen changes yet.
5. `inputMapping.spec.ts`: add cases.
   - A snapshot with `touch = { moveX: 0, moveY: 1, aimX: 0, aimZ: 0, buttons: 0 }` gives the same frame, bit for bit
     (`toEqual`), as the same snapshot with a pad whose left stick is `(0, 1)` past the deadzone rescale. Pick pad values
     that give exactly `(0, 1)`: `leftY = 1`.
   - `aimDevice: "touch"` with touch aim `(3, 4)` gives `quantizeInput` of `(0.6, 0.8)` aim.
   - Touch buttons are ORed (`Button.ROLL` from touch plus FIRE from the mouse).
   - A snapshot without `touch` is unchanged (one existing case re-run with `touch: undefined`).
   - The tracker: `touched()` → device `"touch"`; `keyPressed()` → `"keyboard"`; `touchAimed()` → aimDevice `"touch"`,
     and `mouseMoved()` takes it back.

**Verify:** `npm run verify`.
**Commit:** `Mobile MB4: touch in DeviceSnapshot / InputDeviceKind / AimDevice; keyDevice for key-hint tables`.

---

## MB5. Auto-target (pure)

**Read:** `src/shared/sim/combat/actors/types.ts` (`ActorState`, `NO_KIND`), `src/shared/sim/party.ts` (`playerAt`),
`src/shared/dungeon/collision.ts` (`lineOfSight`, `BulletBlocker`), `src/shared/sim/actors.spec.ts` (lines 1-70: how a
spec builds a state with actors, the `enc` helper and the `shared/sim/testing` import).

Create `src/shared/play/touch/autoTarget.ts` (export from the touch barrel):

```ts
export interface AutoTargetQuery {
	readonly state: Readonly<SimState>;
	readonly playerIndex: number;
	/** The floor's bullet blocker (RunContext.config.isBulletBlocked); undefined = open floor. */
	readonly blocked: BulletBlocker | undefined;
	/** ActorState.id of the last target (0 = none): it keeps a bonus (hysteresis). */
	readonly previousId: number;
}

export interface AutoTarget {
	readonly id: number;
	readonly x: number;
	readonly z: number;
}

/** The actor a centre Attack / Alt aims at (docs/MOBILE.md MBD6), or undefined. Read-only on the state. */
export function pickAutoTarget(q: AutoTargetQuery): AutoTarget | undefined
```

Rules:

- The player is `playerAt(q.state, q.playerIndex)` (position `x, z`, facing `faceX, faceZ`).
- Candidates: every `q.state.combat.actors[i]` with `kind !== NO_KIND` and `alive === 1`, at distance
  `d <= TOUCH.autoTarget.rangeTiles * TILE_SIZE` (import `TILE_SIZE` from `shared/dungeon`), with
  `lineOfSight(q.blocked, px, pz, a.x, a.z)` true.
- Cost = `d`, times `coneFactor` when `(faceX * dx + faceZ * dz) / d >= coneCos` (skip the cone test when `d === 0`),
  times `stickyFactor` when `a.id === q.previousId`.
- Lowest cost wins. On an exact tie the lower slot index wins: iterate with a numeric `for` and replace only on a
  strictly lower cost.
- Never write to the state.

`autoTarget.spec.ts` (build states the way `actors.spec.ts` does; place actors by editing `state.combat.actors[i].x / z`
after `createSimState` if that is simpler):

1. Nearest of two in the open wins.
2. Out of range: undefined.
3. A wall between: the blocked one loses to a farther visible one. Blocker example: `(x, _z) => x === 2` blocks the
   tile column x = 2 (lineOfSight tests tile centres at integer world coordinates).
4. Dead actors (`alive = 0`) and free slots are skipped.
5. The cone bonus: an actor slightly farther but straight ahead (along the facing) beats one off to the side.
6. Hysteresis: with `previousId` = the farther one's id and distances within the sticky factor, the previous one wins.
7. Read-only: `hashState(state)` is equal before and after a call (import `hashState` from `shared/sim`).

**Verify:** `npm run test:only -- play/touch`, then `npm run verify`.
**Commit:** `Mobile MB5: pickAutoTarget (nearest visible actor, facing cone, hysteresis) + spec`.

---

## MB6. Draft helpers and the visibility rule (pure)

Create `src/shared/play/touch/draft.ts` and `src/shared/play/touch/mode.ts` (export both from the touch barrel).

`draft.ts`:

```ts
/** The local player's draft (same rule as shared/play snapshot.ts `draftReady`). */
export function draftStatus(state: Readonly<SimState>, playerIndex: number): { open: boolean; ready: boolean }
/** Card index -> the column that selects it (inverse of shared/sim draftCardFor). */
export function draftColumnForCard(index: number, count: number): number
```

- `draftStatus`: `p = state.run?.players[playerIndex]`; `open = p !== undefined && p.draftOpen !== 0`;
  `ready = open && p.draftTicks + 1 >= DRAFT_MIN_OPEN_TICKS`. Copy the expression from `snapshot.ts` (search
  `draftReady:`), so the two never disagree.
- `draftColumnForCard`: `count >= DRAFT_OFFER_COUNT` → `index`; `count === 2` → index 0 = `DRAFT_COLUMN_LEFT`, else
  `DRAFT_COLUMN_RIGHT`; otherwise `DRAFT_COLUMN_CENTRE`.

`mode.ts`:

```ts
export type TouchMode = "hidden" | "play" | "spectate";

export interface TouchModeInput {
	readonly device: InputDeviceKind;
	readonly gameActive: boolean;
	/** client store selectMenuOpen (pause, overlays, panels, run over, stage cover, loading). */
	readonly menuOpen: boolean;
	readonly robloxMenuOpen: boolean;
	/** The full map is open (a tap anywhere closes it). */
	readonly mapOpen: boolean;
	/** The finished tutorial run is frozen. */
	readonly frozen: boolean;
	readonly draftOpen: boolean;
	readonly spectating: boolean;
}

export function touchMode(i: TouchModeInput): TouchMode {
	if (i.device !== "touch" || !i.gameActive) return "hidden";
	if (i.menuOpen || i.robloxMenuOpen || i.mapOpen || i.frozen || i.draftOpen) return "hidden";
	return i.spectating ? "spectate" : "play";
}
```

Specs (`draft.spec.ts`, `mode.spec.ts`):

- `draftCardFor(draftColumnForCard(i, n), n) === i` for n = 1..3 and every i < n.
- **The key one:** for each column, build a touch snapshot with `moveX = draftScreenX(column)`, map it with
  `mapDevicesToInput` (no other device), and check `draftColumn(frame) === column` (import `draftColumn` from
  `shared/sim`).
- `draftStatus` on a fresh endless state (no draft) is `{ open: false, ready: false }`. Build an endless state the
  way an existing progression spec does; if that takes more than a few lines, test the pure expression with a
  hand-built `run.players[0]` object instead and say so in a comment.
- `touchMode`: one case per hidden reason, `play`, `spectate`.

**Verify / Commit:** `npm run verify`; `Mobile MB6: draft tap helpers, touchMode rule + specs`.

---

## MB7. Settings, strings, theme contract

**Goal:** the four touch settings and every new string, with specs.

**Read:** `src/shared/settings/display.ts`, `config.ts`, `settings.spec.ts` (the `playerOutline` cases: copy that
pattern exactly), `src/shared/view/hud/options.ts` (`OPTIONS_STRINGS`), `src/shared/theme/contract.ts`
(`STAGE_STRING_KEYS` and how it joins `REQUIRED_STRING_KEYS`), the placeholder manifest's strings.

**Write:**

1. `shared/settings/config.ts`:
   `TOUCH_SIZE_PERCENTS = [80, 100, 120]`, `DEFAULT_TOUCH_SIZE_PERCENT = 100`,
   `TOUCH_OPACITY_PERCENTS = [40, 70, 100]`, `DEFAULT_TOUCH_OPACITY_PERCENT = 70`,
   `DEFAULT_TOUCH_AUTO_TARGET = true`, `DEFAULT_TOUCH_LEFT_HANDED = false`.
2. `shared/settings/display.ts`: fields `touchSize: number`, `touchOpacity: number`, `touchAutoTarget: boolean`,
   `touchLeftHanded: boolean`, appended to `DISPLAY_SETTING_KEYS` in that order, in `defaultDisplaySettings`, and in
   `sanitizeDisplayOverrides` (numbers: kept only when in their list and not the default, like `hudScale`; booleans:
   kept only when a boolean and not the default). Check `sameDisplayOverrides` and `resolveDisplaySettings` compare
   or copy the new fields; if one lists fields by hand, add them there.
3. `settings.spec.ts`: every existing `toEqual({ hudScale: ..., playerOutline: ... })` object gains the four defaults
   (search `playerOutline:` in the spec). Add a `describe("display: touch controls (docs/MOBILE.md MB7)")` with: the
   defaults; only non-defaults stored (`touchSize: 120` kept, `100` dropped, `77` dropped; `touchLeftHanded: true` kept,
   `false` dropped); a round trip through `encodeSettingsDoc` / `decodeSettingsDoc` with `doc.v === 2`.
4. Strings. Create `src/shared/view/hud/touch.ts` (export from the barrel) with:

```ts
export const TOUCH_STRINGS = {
	attack: "touch.attack",
	alt: "touch.alt",
	roll: "touch.roll",
	ember: "touch.ember",
	flask: "touch.flask",
	swap: "touch.swap",
	shrine: "touch.shrine",
	spectateNext: "touch.spectateNext",
	spectatePrev: "touch.spectatePrev",
	/** Replace the key-name hints on touch (MB10). */
	hintDraft: "touch.hint.draft",
	hintShrine: "touch.hint.shrine",
	hintSpectate: "touch.hint.spectate",
	hintMapClose: "touch.hint.mapClose",
} as const;

/** The label key of a touch button. */
export function touchButtonLabelKey(id: TouchButtonId): string  // `touch.${id}`
```

   - In `contract.ts`, add `TOUCH_STRING_KEYS` (the 13 keys above, `as const`, with a doc comment pointing at
     docs/MOBILE.md) and spread it into `REQUIRED_STRING_KEYS` next to `STAGE_STRING_KEYS`.
   - `OPTIONS_STRINGS` gains `touchSize: "options.display.touchSize"`, `touchOpacity: "options.display.touchOpacity"`,
     `touchAutoTarget: "options.display.touchAutoTarget"`, `touchLeftHanded: "options.display.touchLeftHanded"`.
   - Placeholder manifest strings (next to the `options.display.*` block and a new `// Touch controls (docs/MOBILE.md)`
     block): `"touch.attack": "Attack"`, `"touch.alt": "Alt"`, `"touch.roll": "Roll"`, `"touch.ember": "Ember"`,
     `"touch.flask": "Flask"`, `"touch.swap": "Swap"`, `"touch.shrine": "Accept"`, `"touch.spectateNext": "Next"`,
     `"touch.spectatePrev": "Prev"`, `"touch.hint.draft": "Tap a boon to take it."`,
     `"touch.hint.shrine": "Tap Accept to take the curse."`,
     `"touch.hint.spectate": "Next / Prev switch who you watch."`, `"touch.hint.mapClose": "Tap anywhere to close."`,
     `"options.display.touchSize": "Touch size"`, `"options.display.touchOpacity": "Touch opacity"`,
     `"options.display.touchAutoTarget": "Auto-target"`, `"options.display.touchLeftHanded": "Left-handed"`.
   - A spec (`touchHud.spec.ts` next to `touch.ts`): every `TOUCH_STRINGS` value and every `touchButtonLabelKey(id)`
     exists in the placeholder pack (copy the `hasString` loop from `hud.spec.ts`). If `hud.spec.ts` checks that every
     `OPTIONS_STRINGS` key exists, the new options strings are covered there.
   - Keep labels within `OPTIONS_LABEL_MAX_CHARS` if a spec enforces it.

**Verify / Commit:** `npm run verify`; `Mobile MB7: touch settings (DisplaySettings, doc stays v2), touch strings`.

---

## MB8. Wire touch into InputController and SimController (client)

**Read:** `src/client/controllers/game/InputController.ts` (all), `SimController.ts` around the two
`inputController.sample(` calls (search for them), `RunContext` (top of SimController).

**InputController.ts:**

1. Imports: `TouchControls`, `pickAutoTarget`, `draftStatus`, `type TouchMode`, `type TouchSnapshot` from
   `shared/play`; `TOUCH` from `shared/config`; `playerAt`, `type SimState` from `shared/sim`; `type BulletBlocker`
   from `shared/dungeon`; `selectDisplay` from `client/store`.
2. Export from this file:

```ts
/** What a touch frame needs from the run (SimController passes it to sample). */
export interface TouchAimContext {
	readonly state: SimState;
	readonly playerIndex: number;
	readonly blocked: BulletBlocker | undefined;
}
```

3. Fields: `private readonly touch = new TouchControls()`, `private touchMode: TouchMode = "hidden"`,
   `private touchStickRadiusPx = TOUCH.stickRadiusRef`, `private touchAutoTarget = true`, `private targetId = 0`,
   `private targetX = 0`, `private targetZ = 0`, `private lastSampleClock = os.clock()`.
4. `onStart` additions:
   - If `UserInputService.TouchEnabled && !UserInputService.KeyboardEnabled && !UserInputService.GamepadEnabled`, call
     `this.tracker.touched()` before the first `publishDevice()`.
   - `UserInputService.TouchStarted.Connect(() => { this.tracker.touched(); this.publishDevice(); });`
   - Mouse guards (phones can report touches as mouse input): in the `InputBegan` handler, call
     `this.tracker.mouseClicked()` only when `UserInputService.MouseEnabled`; in `InputChanged`, call
     `this.tracker.mouseMoved()` only when `UserInputService.MouseEnabled`.
   - `this.touchAutoTarget = selectDisplay(clientStore.getState()).touchAutoTarget;` and a `clientStore.subscribe`
     on `selectDisplay` that updates it.
5. `pollKeyboardMouse`: poll mouse buttons only when `UserInputService.MouseEnabled` (the keys are still polled).
6. `sample(playerX, playerZ, out = { ...EMPTY_INPUT }, touchCtx?: TouchAimContext)`:

```ts
const now = os.clock();
const dt = math.clamp(now - this.lastSampleClock, 0, TOUCH.maxFrameSec);
this.lastSampleClock = now;
let touchSnap: TouchSnapshot | undefined;
if (touchCtx !== undefined && (this.touchMode !== "hidden" || this.touch.hasDraftPick())) {
	touchSnap = this.touchFrame(touchCtx, dt);
	if (touchSnap.aimX !== 0 || touchSnap.aimZ !== 0) this.tracker.touchAimed();
}
```

   then pass `touch: touchSnap` in the `mapDevicesToInput` snapshot. Everything else in `sample` stays.
7. `private touchFrame(ctx: TouchAimContext, dt: number): TouchSnapshot`:

```ts
const me = playerAt(ctx.state, ctx.playerIndex);
const draft = draftStatus(ctx.state, ctx.playerIndex);
return this.touch.frame({
	dt,
	stickRadiusPx: this.touchStickRadiusPx,
	autoTarget: this.touchAutoTarget,
	facingX: me.faceX,
	facingZ: me.faceZ,
	autoAim: () => {
		const t = pickAutoTarget({
			state: ctx.state,
			playerIndex: ctx.playerIndex,
			blocked: ctx.blocked,
			previousId: this.targetId,
		});
		this.targetId = t !== undefined ? t.id : 0;
		if (t === undefined) return undefined;
		this.targetX = t.x;
		this.targetZ = t.z;
		return { x: t.x - me.x, z: t.z - me.z };
	},
	draftOpen: draft.open,
	draftReady: draft.ready,
});
```

8. Public methods (with doc comments):
   - `getTouch(): TouchControls`.
   - `setTouchMode(mode: TouchMode): void`: no-op when unchanged; else `this.touch.reset()` and store it.
   - `getTouchMode(): TouchMode`.
   - `setTouchStickRadiusPx(px: number): void`.
   - `queueDraftPick(column: number): void` → `this.touch.queueDraftPick(column)`.
   - `emitMapAction(): void`: calls every map listener (the same loop `reportDriver` uses for the map).
   - `getTouchTarget(): { x: number; z: number } | undefined`: defined only when `touchMode === "play"`,
     `this.touch.lastAimWasAuto()` and `targetId !== 0`.

**SimController.ts:**

1. Add a public `isInputCovered(): boolean { return this.stage?.blocksInput() === true; }` near `isHeldByLoader`.
2. At both `this.inputController.sample(` calls, pass a fourth argument:
   - solo: `{ state: run.state, playerIndex: 0, blocked: ctx.config.isBulletBlocked }`;
   - co-op: `{ state: coop.state, playerIndex: ctx.localIndex, blocked: ctx.config.isBulletBlocked }`.
   Use the variable names those functions already have; if `ctx` is not in scope at one of them, find the
   `RunContext` that function received and use it.

**Verify:** `npm run verify` (typecheck, lint, build; no new specs: client code).
**Commit:** `Mobile MB8: InputController reads touch (sample touch context, auto-target, draft pick, mouse guards)`.

---

## MB9. TouchControlsController: the on-screen controls (client)

**Read:** `MinimapController.ts` (an imperative controller with a Janitor and a render step),
`RunMarkerController.ts` (world Parts: `studsX`, `studsZ`, `floorStudsY`, `UPRIGHT`), `client/ui/theme`
(`role`, `str`, `HUD_FONT`), `client/store` selectors: `selectInputDevice`, `selectGameActive`, `selectMenuOpen`,
`selectRobloxMenuOpen`, `selectMapView`, `selectSnapshot`, `selectDisplay`. In `shared/view/config.ts`, `RENDER_ORDER`.

1. `shared/view/config.ts` `RENDER_ORDER`: add `touchBeforeSim: 0` with the comment
   `/** Touch controls: mode, layout and finger state, before the sim samples input (simAfterInput). */`.
2. `src/client/controllers/game/TouchControlsController.ts` (export from the game controllers barrel):

```ts
@Controller({})
export class TouchControlsController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly fingerIds = new Map<InputObject, number>();
	private nextFinger = 1;
	// gui, moveZone, moveBase, moveKnob, buttons (Map<TouchButtonId, TextButton>), knobs for attack / alt,
	// marker Part, last layout key (string), last mode
	constructor(private readonly input: InputController, private readonly sim: SimController) {}
	onStart(): void {
		if (!UserInputService.TouchEnabled) return;
		...
	}
}
```

   `onStart`, when the device is touch-capable:
   - `GuiService.TouchControlsEnabled = false` (hides Roblox's stock thumbstick and jump button), and
     `playerGui.ScreenOrientation = Enum.ScreenOrientation.LandscapeSensor` (`playerGui` =
     `Players.LocalPlayer.WaitForChild("PlayerGui") as PlayerGui`).
   - Build a ScreenGui `KV_TouchControls` (`ResetOnSpawn` false, `ScreenInsets` `CoreUISafeInsets`, `DisplayOrder`
     `TOUCH_LAYOUT.displayOrder`, `ZIndexBehavior` Sibling, `Enabled` false) under PlayerGui.
   - The move zone: a TextButton (`Text` "", `BackgroundTransparency` 1, `AutoButtonColor` false, `Selectable` false).
   - One TextButton per `TouchButtonId` (circle: `UICorner` with `CornerRadius = new UDim(0.5, 0)`; `Text` from
     `str(touchButtonLabelKey(id))`, `TextScaled` true, `Font` `HUD_FONT`, `TextColor3` `role("uiText")`,
     `BackgroundColor3` `role("uiPanel")`, `AutoButtonColor` false, `Selectable` false).
   - A knob Frame inside Attack and Alt (a circle at 40 % of the button's size, `role("uiAccent")`), and a move base +
     knob pair (two circles: the base ring at `moveHome` size, the knob at 40 %).
   - For every button and the move zone: `InputBegan.Connect((io) => this.begin(io, id))` that runs only for
     `io.UserInputType === Enum.UserInputType.Touch`: assign a finger number (`fingerIds`, `nextFinger`) and call
     `this.input.getTouch().begin(n, id, io.Position.X, io.Position.Y)` (the move zone's id is `"move"`).
   - Global: `UserInputService.TouchMoved` → `getTouch().move(n, ...)` for a known `InputObject`;
     `UserInputService.TouchEnded` → `getTouch().end(n)` and `fingerIds.delete(io)`.
   - The target marker: a Part in a Workspace Folder `KV_TouchTarget` (Cylinder, `Anchored`, `CanCollide` /
     `CanQuery` / `CanTouch` false, `CastShadow` false, `Material` `SmoothPlastic`, `Color` `role("uiAccent")`,
     `Transparency` `TOUCH.marker.transparency`, size from `TOUCH.marker` x `STUDS_PER_TILE`, turned upright like
     `RunMarkerController`).
   - Everything into the Janitor; `RunService.BindToRenderStep("KV_TouchControls", Enum.RenderPriority.Input.Value + RENDER_ORDER.touchBeforeSim, () => this.frame())`
     (the Janitor unbinds it: `janitor.Add(() => RunService.UnbindFromRenderStep("KV_TouchControls"), true)`).

   `frame()`, every rendered frame:
   - `const store = clientStore.getState()`; the mode =
     `touchMode({ device: selectInputDevice(store), gameActive: selectGameActive(store), menuOpen: selectMenuOpen(store), robloxMenuOpen: selectRobloxMenuOpen(store), mapOpen: selectMapView(store).open, frozen: this.sim.isFrozen(), draftOpen: store.game.snapshot.draftOpen, spectating: store.game.snapshot.spectating })`
     (adjust the snapshot path to how the store holds it: see how `MinimapController` reads `store.game.snapshot`).
     `this.input.setTouchMode(mode)`. On a change to hidden, also clear `fingerIds`. `gui.Enabled = mode !== "hidden"`.
   - The layout: `touchLayout(camera.ViewportSize.X, camera.ViewportSize.Y, gui.AbsoluteSize.X, gui.AbsoluteSize.Y, display.hudScale, display.touchSize, display.touchLeftHanded, mode === "spectate" ? "spectate" : "play")`.
     Build a key string from those inputs; only when it changes, place the frames (`Position` = `UDim2.fromOffset(cx - r, cy - r)`,
     `Size` = `UDim2.fromOffset(2 * r, 2 * r)`), show the buttons of the current mode, hide the rest, and call
     `this.input.setTouchStickRadiusPx(layout.stickRadiusPx)`.
   - The Accept (`shrine`) button shows only while `snapshot.atShrine` (play mode).
   - Ember / Flask labels: `"<label> <count>"` from `snapshot.embers` / `snapshot.flask`, written only when they change.
   - Opacity: fill transparency `1 - (touchOpacity / 100) * TOUCH_LAYOUT.fillAlpha`; a held control
     (`getTouch().isHeld(id)`) uses the alpha times `pressedFillBoost` (capped at 1). Text transparency
     `1 - touchOpacity / 100`.
   - Knobs: `getTouch().stickView(id)`; offset = `stickVector(...)` (from `shared/play`) x `stickRadiusPx`, with screen y
     = `-v.y`. Attack / Alt knobs sit at the button centre plus that offset (centred when not held). The move base sits
     at the touch-down point converted to GUI space (`x0 - gui.AbsolutePosition.X`, `y0 - gui.AbsolutePosition.Y`;
     the MB0 spike checks this offset; add a `TOUCH_LAYOUT.guiOffset = { x: 0, y: 0 }` constant and add it, so a
     measured correction is one edit), the knob at base plus offset; when not held, the base sits at `moveHome` at half
     opacity.
   - The marker: `this.input.getTouchTarget()`; when defined, `Parent` the Folder to Workspace and put the Part at
     `studsX(x), floorStudsY() + height / 2, studsZ(z)`; else unparent the Folder (`Parent = undefined`).

**Verify:** `npm run verify`.
**Commit:** `Mobile MB9: TouchControlsController (stock touch GUI off, landscape, sticks, buttons, target marker)`.

---

## MB10. The HUD on touch (client + pure spec)

**Read:** `GameHud.tsx`, `WeaponPanel.tsx`, `MinimapPanel.tsx` (`cornerMapShown`), `MinimapController.ts` (its
`cornerMapShown` call), `TutorialPanel.tsx`, `DraftOverlay.tsx`, `ToastPanel.tsx`, `SpectateBar.tsx`,
`FullMapOverlay.tsx`, `PauseOverlay.tsx`, `RunOverPanel.tsx`, `actions.ts`, `HudController.tsx`,
`shared/view/menu/lobby.ts` (`pauseItems`), `useHudScale.ts`, `footprint.ts`.

1. **HUD scale floor.** `useHudScale`: read `selectInputDevice`; pass `touch = device === "touch"` to
   `computeHudScale` (add it to the effect's dependency list so a device switch rescales).
2. **Weapons panel:** hidden on touch (`if (device === "touch") return undefined;` in the exported component). Check
   `HudOcclusionController` / the `cornerFade` registry copes with a missing corner panel (read `cornerFrame`); if it
   would error, make it skip a missing corner.
3. **Corner minimap:** `cornerMapShown(map, minimapSetting, outcome, touch = false)` is false on touch. Pass the device
   from `MinimapPanel` and from `MinimapController` (it reads the same rule to skip work: get the device with
   `selectInputDevice(clientStore.getState())`).
4. **Full map on touch.**
   - `HudActions` gains `draftTap: (index: number) => void` and `toggleMap: () => void` (and NOOP entries).
     `HudController` implements them: `draftTap` →
     `input.queueDraftPick(draftColumnForCard(index, snapshot.draftOffers.size()))`; `toggleMap` → if the co-op party
     overlay is open, close it with the store action the overlay's Resume uses, then `input.emitMapAction()`.
     (`MinimapController.toggle` reads the store at call time, so the map opens once the overlay is closed. If it does
     not open in the owner's check, wrap the emit in `task.defer`.)
   - `pauseItems(coop, tutorial = false, touchMap = false)`: when `coop && touchMap`, return
     `["resume", "map", "leave", "settings", "leaderboards"]`. Add `"map"` to `PauseItem`. In `PauseOverlay.tsx`'s
     `ITEMS`, `map: { text: HUD_STRINGS.mapTitle, sound: SFX.uiClick, run: (a) => a.toggleMap() }` (`"hud.map.title"`, "Map").
     `PauseOverlay` passes `touchMap = device === "touch"`. Add a `menu.spec.ts` case for the touch co-op list; the
     existing expectations stay.
   - `FullMapOverlay`: on touch, add a full-screen transparent TextButton (behind the map host, `Selectable` false)
     whose `Activated` calls `actions.toggleMap()`, and show `TOUCH_STRINGS.hintMapClose` instead of the key hint.
5. **Draft cards:** on touch, each card gets a transparent TextButton covering it (`ZIndex` above the card,
   `Selectable` false) whose `Activated` calls `actions.draftTap(index)`; the key hint line shows
   `TOUCH_STRINGS.hintDraft` instead.
6. **Other hints on touch:** ToastPanel's shrine hint → `TOUCH_STRINGS.hintShrine`; SpectateBar's switch hint →
   `TOUCH_STRINGS.hintSpectate`. Hide (do not render) these key-name lines on touch: TutorialPanel's pause hint,
   PauseOverlay's swap and pause hints, RunOverPanel's restart hint, LeaderboardPanel's close hint, OptionsScreen's
   hint, the TutorialOutro key line (keep the sentence, drop the key: if the string needs `{key}`, pass the pause
   menu's word as the gamepad branch does), LobbyRoom / LobbyBrowser back hints.
7. **Tutorial prompt at the top on touch.**
   - `TUTORIAL_VIEW.touchPanelWidth: 360` (`shared/view/hud/tutorial.ts`).
   - `footprint.ts`: export `TOUCH_TUTORIAL_BOX: TransientBox` = anchor `"topCentre"`,
     `edge = HUD_TRANSIENT.bossBar.edge + HUD_TRANSIENT.bossBar.height + HUD_VIEW.gap`,
     width `TUTORIAL_VIEW.touchPanelWidth`, height
     `math.ceil(HUD_TRANSIENT.tutorial.height * TUTORIAL_VIEW.panelWidth / TUTORIAL_VIEW.touchPanelWidth)`.
   - `TutorialPanel.tsx`: on touch, position it top centre at `TOUCH_TUTORIAL_BOX.edge` with `touchPanelWidth`.
8. **Touch footprint** (`footprint.ts`): `TOUCH_ALWAYS_ON_PANELS: ReadonlyArray<AlwaysOnPanel> = ["status", "score"]`
   and `touchFootprintRects(vw, vh, userPercent, topInset = 0)` (as `footprintRects` with
   `computeHudScale(vw, vh, false, userPercent, true)` and only those two panels).
   `footprint.spec.ts`, a new `describe("touch footprint (docs/MOBILE.md MB10)")` over `TOUCH_TEST_VIEWPORTS`, insets
   0 / `HUD_TEST_TOP_INSET`, HUD percents `<= 100`:
   - the two boxes never cover the centre column or the centre row of the safe area (copy the existing check);
   - the touch tutorial box (placed with the same transient math, at `computeHudScale(..., true)`) does not intersect
     either box;
   - print (do not fail) any box that enters `HUD_CLEAR_ZONE`, like the existing >100 % printout.
   **If the tutorial-box check fails:** lower `touchPanelWidth` in steps of 20 down to 320; still failing → stop and
   report.

**Verify:** `npm run verify`.
**Commit:** `Mobile MB10: touch HUD (scale floor, no weapons panel / corner map, map item and tap close, draft taps, touch hints, tutorial prompt on top)`.

---

## MB11. Options: the touch rows

**Read:** `OptionsScreen.tsx` `DisplayTab` (the `hudScale` row for percent options, the `playerOutline` row for
On / Off).

Add four `SettingRow`s at orders 6-9, rendered only when `UserInputService.TouchEnabled` (read once at the top of
`DisplayTab`): Touch size (`TOUCH_SIZE_PERCENTS`, labelled like the HUD scale row), Touch opacity
(`TOUCH_OPACITY_PERCENTS`), Auto-target (On / Off), Left-handed (On / Off). Each calls
`props.actions.updateDisplay({ <field>: v })` after `playUi(SFX.uiClick)`.

**Verify / Commit:** `npm run verify`; `Mobile MB11: Options > Display touch rows (touch devices only)`.

---

## MB12. The tutorial on touch

**Read:** `src/shared/theme/packs/placeholder/manifest.ts` (`tutorial.prompt.*`),
`src/shared/tutorial/tutorial.spec.ts` (around "Touch has no controls yet").

1. Replace these placeholder strings. They have **no `{...}` placeholders**: the control names are written out.

| Key | Text |
|---|---|
| `tutorial.prompt.objective.touch` | `Tap Attack to continue.` |
| `tutorial.prompt.move.touch` | `Move: drag on the left side of the screen.` |
| `tutorial.prompt.flask.touch` | `You're wounded. Drink your flask: tap Flask. You get 3 per floor, refilled on every new floor.` |
| `tutorial.prompt.attack.touch` | `Attack: hold the Attack stick. It aims at the nearest enemy; drag it to aim yourself. The third swing is a finisher.` |
| `tutorial.prompt.roll.touch` | `The orange line is its aim. Roll through the shot: tap Roll. You can't be hit mid-roll.` |
| `tutorial.prompt.guard.touch` | `Block with the sword: hold the Alt stick as a shot reaches you. It deletes bullets, and shockwaves too.` |
| `tutorial.prompt.guardHold.touch` | `It won't go down until you block one of its shots: hold Alt with the sword as a shot reaches you.` |
| `tutorial.prompt.bow.touch` | `Swap to the bow: tap Swap. Drag the Alt stick to charge a heavy arrow, then let go.` |
| `tutorial.prompt.ember.touch` | `Too many bullets? Tap Ember: it burns an Ember and clears every enemy bullet. 2 per floor.` |
| `tutorial.prompt.curse.touch` | `Curses make the run harder and your score multiplier bigger. Tap Accept to take it, or walk away.` |
| `tutorial.prompt.draft.touch` | `Pick a boon: tap a card.` |

   The other `.touch` prompts (follow, hits, boost, relic, stairwell, boss, finish) stay as they are. Update the
   comment above the block ("Touch = keyboard text for now" is no longer true).
2. Update the comments that say touch has no controls (`steps.ts` `TutorialDevice`, `flow.ts`, `shared/view/hud/tutorial.ts`
   `tutorialPromptVars`).
3. `tutorial.spec.ts`: replace the "touch equals keyboard" expectation with: no touch prompt contains `"{"`, and for
   `objective, move, flask, attack, roll, guard, guardHold, bow, ember, curse, draft` the touch text differs from the
   keyboard text.

**Verify / Commit:** `npm run verify`; `Mobile MB12: tutorial prompts written for touch`.

---

## MB13. Docs

1. `docs/CLIENT.md`:
   - the Controls table gains a **Touch** column: Move = move stick (left side), Aim = drag Attack / Alt (centre:
     auto-target), Attack = Attack stick, Alt = Alt stick, Swap = Swap, Roll = Roll, Flask = Flask, Ember = Ember,
     Pause = the top-bar pause button;
   - a section `## Touch controls (docs/MOBILE.md)` (5-10 lines: the files, the modes, the settings, `KV_TouchSpike`);
   - under "Studio smoke test", `### Mobile (docs/MOBILE.md MB14; not run on a device yet)` with numbered steps:
     emulator (iPhone landscape): no stock thumbstick, controls show in a run and hide under pause / draft / the full
     map, walk / attack / roll with one finger, tap a boon card, the corner map and weapons panel are gone, the
     tutorial prompt is on top; a device: three fingers at once (move + attack + roll), bow release keeps the aim,
     auto-target ring, spectate Next / Prev, left-handed, sizes 80 / 120.
2. `CLAUDE.md`: in the decision log, after the player-outline entry, add:

   > - **Mobile play (docs/MOBILE.md).** Input and presentation only (no sim, dungeon, lockstep, hash, replay or fixture
   >   change). Touch is a third device in `mapDevicesToInput` (`DeviceSnapshot.touch`, `InputDeviceKind` / `AimDevice`
   >   `touch`); `shared/play/touch` holds the pure state machine (`TouchControls`: floating move stick, Attack / Alt
   >   action sticks with a centre auto-target and a 0.25 s aim latch, buttons, draft taps), `pickAutoTarget`, the draft
   >   helpers and `touchMode`; `shared/view/hud` `touchLayout` places the controls. `TouchControlsController` draws them
   >   (stock touch GUI off, `LandscapeSensor`). On touch: HUD scale floor `HUD_VIEW.touchMinScale`, no weapons panel or
   >   corner minimap (the full map from the pause / party overlay, tap to close), the tutorial prompt at the top.
   >   Settings `DisplaySettings.touchSize` / `touchOpacity` / `touchAutoTarget` / `touchLeftHanded` (overrides-only, doc
   >   stays v2). Required strings `TOUCH_STRING_KEYS`. Spike `KV_TouchSpike`. Device checks pending.

3. `docs/MOBILE.md`: tick MB1-MB13, set the Status line (code-complete headlessly, nothing on a device yet).

**Verify / Commit:** `npm run verify`; `Mobile MB13: docs`.

---

## Owner steps (not for the implementer)

- **MB0** run the `KV_TouchSpike` test script on a low-end Android, an iPhone and a tablet; fill the SPIKES.md table.
  Answers that change code: the probe offset (`TOUCH_LAYOUT.guiOffset`), "same InputObject: no" (switch finger matching
  to nearest position), `IsMouseButtonPressed` true while touching (already guarded by `MouseEnabled`; confirm).
- **MB14** Studio emulator and device check, then tune `TOUCH` / `TOUCH_LAYOUT`.
- **MB15** performance pass on devices (docs/MOBILE.md).
- **MB16** co-op with mixed devices.
