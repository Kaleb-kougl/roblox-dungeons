# Task 1 spikes (go/no-go)

Two throwaway experiments that decide whether the port goes ahead (PLAN.md task 1), plus a later one for asset
preloading (P0, docs/PRELOAD.md). All are client code, **off by default**, and clean up everything they create (one
Janitor each) when turned off.

| Spike | Question | Code |
|---|---|---|
| A: bullets | Can Roblox move the web build's 1,000 enemy bullets as Parts at 60 fps, on PC and on a phone? | `src/client/controllers/spikes/BulletSpikeController.ts` |
| B: iso camera | Does a narrow-FOV perspective camera far away pass for the web build's orthographic iso view? | `src/client/controllers/spikes/CameraSpikeController.ts` |
| P0: preload | Does `PreloadAsync` fetch images and sounds from content id strings, or only through instances? Does a sheet's first draw hitch? (docs/PRELOAD.md D4 / D5) | `src/client/controllers/spikes/PreloadSpikeController.ts` |

Tunables for both: `src/shared/config/spikes.ts`. HUD: `src/client/ui/spikes/SpikeHud.tsx` (top left, with buttons
for touch devices).

## Setup (once)

1. `rokit install`, `npm install`, `npm run build`.
2. `rojo serve` (or `npm run dev`), open a **Baseplate** place in Studio, connect the Rojo plugin (7.7.x).
3. Lighting, for a fair camera test: in `Lighting`, delete or disable `Atmosphere` (its haze washes out a scene
   viewed from ~700 studs) and note `Lighting.Technology` (Future / ShadowMap / Voxel) in the results.

## Turning a spike on

Pick one:

- **Attribute (no code change, persists in the place):** Explorer -> `Workspace` -> Properties -> Attributes -> `+`,
  add a **Boolean** named `KV_SpikeBullets` and/or `KV_SpikeCamera`, tick it, then Play.
- **Command bar, while playing** (server context is fine, attributes replicate):
  `workspace:SetAttribute("KV_SpikeBullets", true)`. Set it to `false` to stop the spike and remove its Parts.
- **Code default:** set `SPIKE_DEFAULTS.bullets` / `.camera` to `true` in `src/shared/config/spikes.ts`.

## Spike A: 1,000 pooled bullet Parts

What it does: a pool of small neon spheres (Anchored; CanCollide, CanQuery, CanTouch and CastShadow off) in rings
or a spiral around the spot where your character stood when the spike started. Every frame one
`workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)` moves all of them.

Controls: keys **1 / 2 / 3 / 4** = 100 / 500 / 1,000 / 2,000 bullets, **P** = rings / spiral (or the HUD buttons).

HUD readout (averaged over 0.5 s):

- `fps`: frames per second.
- `update`: ms per frame spent in the spike's update, split into `compute` (position math + building CFrames) and
  `BulkMoveTo` (the engine call). `worst` is the slowest single frame in the window.
- The update is also labelled `KV BulletSpike` in the MicroProfiler (Ctrl+F6, or View -> MicroProfiler); render
  cost of the Parts shows up in the frame's render section, not in `update`.

Steps:

1. PC: Play (F5). For each count, both patterns, wait ~5 s and record fps, update, compute, BulkMoveTo, worst.
   Note your Studio frame-rate cap (Studio caps at 60 unless changed; File -> Studio Settings) and the GPU / CPU.
2. Optional, closer to players: publish to a private place and repeat in the Roblox Player (Shift+F5 shows stats).
3. Phone emulator: Test tab -> Device (device emulator), pick a phone (e.g. iPhone 14 or a mid Android), Play, use
   the HUD buttons, record the same numbers. The emulator only changes screen size and input, **not** CPU / GPU, so
   this checks layout and touch; real-phone fps is PLAN.md task 10. Write that caveat next to the numbers.
4. Graphics quality: repeat 1,000 bullets at quality level 1 and 10 (Studio: File -> Studio Settings -> Rendering ->
   Editor Quality Level, or the in-game menu in the Player).

Go if: **1,000 bullets hold 60 fps on PC** with `update` well under the frame budget (target < 2 ms). If not, the
plan's fallback is to cap enemy bullets per device class while the sim keeps the same number.

## Spike B: iso camera rig

What it does: `Camera.CameraType = Scriptable`, yaw 45 deg / pitch 55 deg (the web build's `CAMERA_YAW` /
`CAMERA_PITCH`), and a distance chosen so the screen shows 16.875 tiles top to bottom (the web build's 270 px /
16 px per tile) at every FOV. The camera follows a green placeholder block (1 x 1.5 x 1 tiles, 4 studs per tile) with
exponential damping (`followTauSec`), and can snap its position to a screen-aligned grid in render texels (1 texel =
the web build's pixel grid, 0.25 studs). A checker floor and pillars give depth and motion reference.

Controls: **WASD / arrows** walk the placeholder screen-relative (W = up the screen, as in the web build; the keys
are sunk so your Roblox character stays put), **V** cycles FOV 5 / 7 / 10 / 20 / 70, **G** cycles snap
off / 1 / 4 / 16 texels, **T** toggles a circular auto-walk (for the phone emulator). The HUD shows FOV, distance and
snap, with buttons.

Steps and what to record:

1. Walk around at each FOV. Does 5 to 10 read as orthographic (pillar sides barely visible near the screen edges,
   parallel floor lines stay parallel)? Which FOV is the smallest without artifacts?
2. At FOV 5 the camera is ~770 studs away. Look for depth fighting between the floor slabs and pillars, shadows
   fading or popping (shadow cascades depend on camera distance), fog / atmosphere haze, and level-of-detail popping.
   Repeat at graphics quality 1.
3. Snap off vs 1 texel vs 4 texels while walking and with auto-walk: shimmer on the checker edges, judder of the
   placeholder against the floor.
4. Damping: does `followTauSec` 0.12 feel like the web build? Try 0 and 0.25 in `spikes.ts` if needed.
5. Phone emulator: same checks with auto-walk.

Go if: one FOV in the 5 to 10 range looks acceptable (no visible perspective, no artifacts) on PC and in the
emulator.

## Spike P0: asset preloading (docs/PRELOAD.md)

Not a task 1 gate: it settles docs/PRELOAD.md decisions D4 (strings vs instances) and D5 (whether P6's warm draw is
needed). Turn it on **before Play** (Workspace attribute `KV_SpikePreload`), so PreloadController's own queue waits
for it (Output: `[Preload] KV_SpikePreload: the queue waits for the spike's batches`); otherwise its batches are cache
hits of the core tier.

What it does, once per enable, at join (Output lines start with `[PreloadSpike]`):

1. Four timed `ContentProvider:PreloadAsync` batches: (a) the knight's sheets (`class.vanguard`) as content id
   strings, (b) the same as never-parented ImageLabels, (c) up to five sfx content ids as strings, (d) as Sounds.
   Each callback prints `<batch> <content id> <status> +<ms> ms`, each batch `<batch>: <n> entries in <ms> ms`.
   **Cache caveat** (printed too): the second batch of each pair is usually a cache hit of the first. A second
   Boolean attribute, `KV_SpikePreloadInstancesFirst`, runs (b) before (a) and (d) before (c): play once each way.
2. The preload queue starts (`[Preload] spike done: the queue starts`).
3. First-draw probe: 30 frames timed (`baseline 30 frames: mean <ms> ms, worst <ms> ms`), then the first knight
   sheet in a 1x1 ImageLabel (above the loading screen) for 10 frames, each printed as `probe frame <n>: <ms> ms`.
   Keep the MicroProfiler (Ctrl+F6) open and look for an upload spike on probe frame 1 or 2. Tunables:
   `PRELOAD_SPIKE` in `src/shared/config/spikes.ts`.

Setting `KV_SpikePreload` false cancels a run in progress and removes the probe's ScreenGui.

Run it in Studio for the wiring, then on a **fresh device** (a phone that never joined the published place, or after
clearing the Roblox cache): Studio's local cache hides download time.

## Results

Fill these in; they decide the go/no-go gate in PLAN.md task 1.

### Spike A

| Device / context | Quality | Count | Pattern | fps | update ms | compute ms | BulkMoveTo ms | worst ms |
|---|---|---|---|---|---|---|---|---|
| | | 100 | rings | | | | | |
| | | 500 | rings | | | | | |
| | | 1000 | rings | | | | | |
| | | 1000 | spiral | | | | | |
| | | 2000 | rings | | | | | |

Notes (frame cap, hardware, emulator caveat):

### Spike B

| FOV | Distance (studs) | Reads as ortho? | Artifacts (depth, shadows, haze, LOD) | Snap verdict |
|---|---|---|---|---|
| 5 | | | | |
| 7 | | | | |
| 10 | | | | |
| 20 | | | | |

Chosen FOV, studs per tile, follow damping, snap:

### Spike P0

| Device / context | Order | Batch | Entries | Statuses | Wall ms |
|---|---|---|---|---|---|
| | strings first | images/strings | | | |
| | strings first | images/instances | | | |
| | strings first | sounds/strings | | | |
| | strings first | sounds/instances | | | |
| | instances first | images/instances | | | |
| | instances first | images/strings | | | |

First-draw probe (baseline mean / worst ms, probe frames 1-3 ms, MicroProfiler spike?):

D4 (strings or instances) and D5 (warm draw needed?):

### Decision

Go / no-go, and anything the later tasks must change:
