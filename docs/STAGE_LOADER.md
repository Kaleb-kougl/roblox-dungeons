# Stage loader: plan

A loader covers the screen while a **stage** (a dungeon floor) is generated and loaded: at **run start** (Play solo,
a lobby's party run, the tutorial, a restart) and at every **floor change** (the stairwell). Today both happen in one
frozen frame the player can see; with the loader the player sees a short title card instead, and the new floor appears
already built. Work it task by task, like `PLAN.md` and `docs/PRELOAD.md`; each task ends with a **Verify**.

It is **presentation only**: nothing touches `src/shared/sim/**`, `src/shared/dungeon/**`, the lockstep wire, the
server, a fixture or a replay hash. Pre-generating a floor early is safe because floors are pure functions of the run
seed (`worldForFloor`), so building one sooner returns the identical world the sim would build.

## Status (2026-10-27)

**SL0 (instrumentation code), SL1-SL8 built; not run in Studio yet.** Decisions SD1-SD6 signed off as recommended
(Kaleb, 2026-10-27). SL0's Studio / phone measurements are still to do. Headless suite green: 2424 specs (sim 642,
dungeon 188, theme + audio / boosts / menu / hud 498, decor / fx / minimap 294, view root 279, run / play / lobby /
lockstep / tutorial and the rest 523); typecheck, lint, check:assets, test:art, build clean.

## As built (differences from the sketch below)

- **Pure half** `shared/view/stageLoader.ts`: `StageLoad(kind, { waitServer?, forge?, pregen?, floor?, worldLive? })`
  fed `frame(dt)` and events (`coverShown`, `serverAnswered`, `forged`, `built`, `pregenerated`, `assetsDone`);
  `due()` hands out at most ONE work item per frame (`forge` / `notify` / `pregen`), only once the cover was drawn.
  `holdSim()` (solo run start until the reveal), `blocksInput()` (until done: through the fade), `fraction()`
  (weighted, monotonic), `label()`. Helpers `stageMerge` (new / continue / absorb), `floorChangeStaged` (every change
  but the tutorial's ending one), `pregenTarget` / `PregenTracker`, `formatListenerTimes`. Tunables `STAGE_LOADER`
  (plus `coverDrawFrames` 1, `coverAckCapSec` 0.5, `pregenAfterDraftFrames` 1, bar `weights`) and `STAGE_VIEW`.
- **SimController owns the deferral**; `StageController` (loadOrder 2) registers with `sim.setStageDriver(this)`
  (one-way injection) and is stepped first in every SimController frame. Without a driver everything runs inline.
- **Cover in frame N:** `StageController.begin()` writes React bindings (ScreenGui `Enabled`, opacity, a text serial)
  synchronously, so the cover is drawn in the event frame's own render (no wait for Reflex's Heartbeat flush); the text
  rows show from the next frame (no stale text). A begin outside the render step counts from the next frame; if the
  ScreenGui does not read back enabled, StageCard's commit (useEffect) reports it, fallback 0.5 s.
- **Sequences:** solo start (Play solo, R, Again, the tutorial): N cover, run held (`isHeldByLoader`, `FROZEN_PACER`:
  no tick, nothing recorded) / N+1 `makeRun` + `[Sim] run N started` / N+2 listeners / N+3 floor 2 pre-generated /
  assets (cap 3 s), 2 settle frames, reveal, fade. A ranked start shows "Starting run..." through the server wait
  (`maxCoverSec` counts from the answer). Floor change: N ctx switch + card / N+1 listeners / assets, settle, 0.6 s
  minimum, reveal. Co-op start: the LockstepClient and floor 1 are still built in the `partyRunStarted` frame (merged
  frames would be dropped otherwise), so its ~80 ms build is NOT covered; only the listeners move; no hold, no assets
  wait, no pre-gen (co-op builds floor n + 1 mid-tick). A floor change with no draft open (`worldLive`) skips the
  assets wait and the minimum card time.
- **Pre-generation** once the local draft has been up one rendered frame (also allowed under the card's waits, never
  during covered work or the fade); per run `PregenTracker`; the tutorial builds floor 2 at start and nothing past it.
- **Input:** solo `coverGate` (a `CoopMenuInputGate`) sends neutral input while covered and masks held buttons through
  the reveal; co-op folds the cover into `menuOpen`; KV_Debug bits still pass (the floor skip works covered).
  `selectMenuOpen` includes `selectStageCovered`; `pause()` and the co-op party overlay are ignored while covered;
  `useGamepadFocus` and `RunOverPanel` do not select under a cover, and `begin()` clears `GuiService.SelectedObject`.
- **Failures:** a failed forge (any world) warns `[Sim] the run could not start (...); back to the menu` and goes
  through `stopRun("left")`, so the menu / lobby room reopens. `inRunningTutorial()` is also true while a tutorial start
  waits to be built (a stray `partyRunStarted` is still refused).
- **Removed:** the "Starting run..." panel in MenuLayer and its `game.starting` / `setRunStarting` /
  `selectRunStarting` (the stage loader shows it). `MENU_STRINGS.starting` is left unused.
- **Assets:** `PreloadController.whenLoaded(refs, cb)` (shared/view `LoadWaiters`); AudioController's `floorBeds(ctx)`
  gives the stage wait the same refs it requests.
- **Co-op entrance safety (SL7):** floor 1 is never a boss floor, the entrance room has no encounter, room enemies spawn
  on entry at least `SPAWN_SAFE_RADIUS` from every living player, and floor changes freeze the world in the draft; the
  only exposure is a teammate pulling enemies during a run-start cover of a few frames.
- **Logs:** `[Stage] run N: forged in t ms, built in t ms, revealed at t s`, `[Stage] floor N: built in t ms, revealed
  at t s`, `[Stage] floor X pre-generated in T ms (run start | during floor N's draft)`, `[Stage] floor N: built
  mid-tick (not pre-generated)`, `[Stage] floor N: assets ready in T s (k ids)` / `asset wait capped at T s`. KV_Debug
  (SL0): `[Stage] listeners (run 3 start, 112.4 ms): World 38.2 ms, Decor 21.0 ms, ...` and `[Stage] floor step T ms
  (to floor 5)`.
- **Floor modifier banner** (docs/FLOOR_MODIFIERS.md FM5, 2026-11-12): on a modifier floor the card adds two rows after
  `Boss floor` (the kind's name in its colour, its line), stamped in 0.3 s after the card, and holds at least 1.8 s
  (`holdAtLeast`) unless the world is live; a dev run starting past floor 1 shows it on the run-start cover, held like
  the roster line. With a live world the card has no minimum, so the banner may not show (the HUD chip carries it).
- **Known gaps:** the co-op start build hitch (above); a cover's binding path is unverified in Studio (the fallbacks
  bound it to a frame or 0.5 s).

## What the code gives us (checked against `main` @ `7412b2e`)

| Fact | Where | Consequence |
|---|---|---|
| **Generating one endless floor costs ~110 ms (worst ~190 ms)** of synchronous Luau: `endlessRunFloor` timed headless under Lune for run seeds 101-106 x floors 1-12 (mean 112 ms, worst 193 ms, later floors heavier: double-size rooms, solid pillars, breakables). `buildWorldSetup("endless")` (floor 1) 79 ms, `"tutorial"` 53 ms | `shared/run/endless.ts` `endlessRunFloor`; measured 2026-10-27 with a throwaway spec | A 5-12 frame hitch at 60 fps on desktop, likely worse on phones. Real client timings come from the spike (SL0) |
| **The sim generates the next floor mid-tick**: on the stairwell tick `stepEndless` calls `endless.worldForFloor(floor + 1)`, which builds it on first use | `shared/sim/endless.ts` step 3, `shared/run/endless.ts` `floorCache` | The floor-change hitch lands on the exact frame the player touches the stairwell, before any loader could show |
| `floorCache` keeps the last **3** floors (`ENDLESS_FLOOR_CACHE_SIZE`) per run, and the dungeons in a module-wide LRU of 8; the client gets the same function as `RunContext.endlessFloor` | `shared/run/endless.ts`, `limits.ts` | Calling `ctx.endlessFloor(n + 1)` from the client while on floor n fills the cache the sim will read: the stairwell tick then costs nothing. Current + next fit in 3 |
| **Every endless floor change opens a boon draft** (`openDraft`): the world is frozen until every present player confirmed, early confirms ignored for `DRAFT_MIN_OPEN_SECONDS` (0.5 s) | `shared/sim/progression`, `step.ts` | A natural, gameplay-free window on every floor: pre-generate floor n + 1 while the player reads floor n's draft |
| Run start: `startSolo` -> `startRun` request -> "Starting run..." (`game.starting`, MenuLayer) until the server answers -> `SimController.startRun` -> `makeRun` (`buildWorldSetup`: floor 1 generated) -> every `onRunStarted` listener rebuilds its view **in the same frame** | `SimController.ts` (`beginRun`, `pollRunStart`, `startRun`, `makeRun`) | Generation + every view build in one frame, and the sim starts stepping the next frame |
| Co-op: `partyRunStarted` -> `startCoop` -> `buildWorldSetup` + listeners in one frame; the client is stepped **only** by the server's merged frames (no pause; missed inputs are filled) | `SimController.startCoop`, `shared/lockstep` | A co-op client cannot hold the sim. Its loader only covers; the local player stands at the entrance meanwhile |
| Floor change: `changeFloor` (after the sim step) fires `onFloorChanged`; 17 controllers listen to it or to `onRunStarted`: World, Decor, RoomEdge, Minimap, RunMarker, Breakable, BoostDrop, Camera (snap), Audio, Preload (boss push), HudOcclusion, HurtFlash, ScorePop, Menu, Tutorial, Tutorial marker / arrow | `rg onFloorChanged src/client` | The second half of the hitch (Instance creation) is unmeasured. Deferring these one frame lets the cover render first |
| The join loading screen already exists: `LoadingScreen` (opaque `background`, title, bar, Skip), display order 30 (`LOADING_VIEW`), fade `PRELOAD.fadeSec`, and `PreloadController.request(refs, "front")` with `bossContentIds` | `docs/PRELOAD.md`, `client/ui/loading`, `PreloadController.ts` | Same look, one component; the stage loader waits on the floor's front-lane assets with a short cap |
| Biome names are theme strings (`biome.<n>.name`, "Ancient Halls"), the floor number is `RunContext.floor` | placeholder manifest, `SimController.runInfo` | The card can say "Floor 4 · Ancient Halls" with no new art |
| The 3D world keeps rendering behind an opaque ScreenGui | engine | Building the floor and snapping the camera under the cover draws its textures once before the reveal: the warm draw PRELOAD.md P6 wanted, for free |

## Player experience

- **Play solo / a restart / the tutorial:** the menu cuts to the loader at once ("Starting run..." while the server
  answers, then "Forging floor 1..."). It lifts on the built floor, the camera already on the knight. No enemy acts
  while it is up (solo: the run is held).
- **Party run:** the same card after the lobby countdown. It lifts as soon as this client has built the floor (no
  hold: the party starts together; everyone stands in the entrance room meanwhile).
- **Stairwell:** a hard cut to a title card "Floor 4 · Ancient Halls" (a boss floor adds "Boss floor"), held at least
  `STAGE_LOADER.minCardSec` (0.6 s, D3), then a fade to the new floor with the boon draft open. Because the floor was
  pre-generated during the last draft, the cut itself does not stutter.
- **Reduced motion:** no fades, the card cuts in and out.
- Nothing is skippable; the cap (`maxCoverSec`, D5) guarantees the screen never stays covered for long.

## Architecture

### 1. Pure stage plan: `shared/view/stageLoader.ts` + `stageLoaderConfig.ts` (headless-tested)

```ts
export const STAGE_LOADER = {
	minCardSec: 0.6,          // floor-change card, solo and co-op (D3)
	minStartSec: 0,           // run start: lift as soon as ready
	assetCapSec: 3,           // wait at most this long for the floor's front-lane assets (D4)
	maxCoverSec: 8,           // hard cap on any cover (D5)
	settleFrames: 2,          // rendered frames under the cover after the build (textures, camera snap)
	fadeSec: 0.25,
} as const;
```

- `StagePhase` = `"waitingServer" | "forging" | "building" | "assets" | "settling" | "revealing" | "done"`, and a
  pure `StageLoad` step machine: `start(kind)`, `forged()`, `built()`, `assetsDone()`, `frame(dt)`; it answers
  `phase()`, `coverOpacity()`, `holdSim()` (solo run start only, never co-op), `fraction()` (weighted phases) and
  `label()` (a string key + vars). Timers are fed `dt`, never read a clock, so it is fully specced.
- `pregenTarget(floor, bossFloor, cached)`: which floor to build next and whether now is a covered moment.

### 2. Pre-generation (`client/controllers/game/StageController.ts`)

- **Run start (covered):** build floor 1 (as today, but one frame after the cover shows), then floor 2 the next frame,
  both under the cover. Tutorial: every tutorial floor at start (53 ms in all).
- **Each floor change:** while floor n's draft is open (`run.players[local].draftOpen`, after its first rendered frame),
  call `ctx.endlessFloor(n + 1)` once. Frozen world, a menu on screen: a 100-200 ms stall reads as nothing. If a
  floor change has no draft (none offered) or the player confirms within one frame, it builds under the next cover
  instead; failing that, the sim builds it mid-tick, as today (the fallback is today's behaviour, never worse).
- Logs `[Stage] floor 5 pre-generated in 124 ms (during floor 4's draft)`.

### 3. Deferred rebuilds (`SimController`)

`startRun`, `startCoop` and `changeFloor` stop calling their listeners inline: they hand them to the
StageController, which shows the cover **this** frame and runs the listeners **next** frame (the cover has been drawn
by then). Solo run start also splits `makeRun` off: frame 1 cover, frame 2 `makeRun` (floor 1), frame 3 listeners,
frame 4 floor 2 pre-gen. The run is held (`pausedByLoader`, no pause menu) until the reveal starts. In co-op the
lockstep keeps stepping; the views build one frame late under the cover.

### 4. The cover: `client/ui/loading/StageCard.tsx` (or a `variant` of `LoadingScreen`)

Same ScreenGui order (`LOADING_VIEW.displayOrder`, 30; the join screen never overlaps a stage load), opaque
`background`, the label (`stage.*` strings), a slim bar on run start, the floor card on floor changes. Input under the
cover goes nowhere (menu-owns-input, as the join screen does), so a draft cannot be confirmed blind.

### 5. Assets

On a floor change the PreloadController front-lane request (this floor's music / ambience, the boss sheets on a boss
floor) is already sent by AudioController and the boss push; the StageController waits for those ids (a new
`PreloadController.whenLoaded(refs, cb)`) up to `assetCapSec`, then reveals anyway.

### 6. What does not change

The sim, dungeon generation itself, lockstep, the server, replays, scores, fixtures, the theme's asset ids, every
renderer's build code (only *when* it runs moves by one frame).

## Tasks

**SL0 Spike: measure.** Under `KV_Debug`, time every `onRunStarted` / `onFloorChanged` listener (`os.clock` around
each call, printed `[Stage] listeners: World 38 ms, Decor 21 ms, ...`) and `buildWorldSetup` / the mid-tick floor
build (time the frame's sim step on a `floorChanged` tick). Run in Studio and on a phone (published place) for floors
1-10. Verify: numbers recorded here; SD1-SD5 confirmed or tuned.

**SL1 Pure stage machine.** `stageLoader.ts`, `stageLoaderConfig.ts`, strings keys, barrel. Verify: specs for every
phase order (solo start, co-op start, floor change, floor change with a missed pre-gen), `holdSim` only on a solo
start, `minCardSec` / `assetCapSec` / `maxCoverSec` boundaries, reduced-motion opacity, `fraction` monotonic.

**SL2 Strings.** Required `stage.starting` ("Starting run..."), `stage.forging` ("Forging floor {floor}..."),
`stage.building` ("Building..."), `stage.floorCard` ("Floor {floor}"), `stage.bossFloor` ("Boss floor"); the biome
line reuses `biome.<n>.name`. Contract + placeholder pack. Verify: strings / contract specs.

**SL3 StageController + deferred listeners.** SimController hands run-start / floor-change notifications to the
StageController (one frame late, under the cover); solo start split into cover / makeRun / listeners / pre-gen;
`pausedByLoader`. Replaces "Starting run..." in MenuLayer. Verify: `npm run verify`; Studio: Play solo, R restart,
Leave run then Play solo, the tutorial (first join and replay) all start under the loader with the camera already on
the knight; `[Sim] run N started` still printed once per run.

**SL4 Pre-generation.** During the draft (and the run-start cover); log line; fallback path. Verify: Studio, floors
1-8: every `[Stage] floor n pre-generated` precedes its stairwell; the stairwell tick's step time (SL0 probe) drops to
normal; the debug floor skip (spam) still works (falls back, covered).

**SL5 The card.** `StageCard` / variant, fade, reduced motion, input blocked, boss-floor line. Verify: Studio: card
on every floor change, the draft visible and usable right after the reveal, no blind confirm.

**SL6 Assets wait.** `PreloadController.whenLoaded`; boss floor waits for its boss sheets up to `assetCapSec`.
Verify: Studio with a boss floor (`node scripts/find-boss-seed.js`): `[Stage] floor 5: assets ready in t s`.

**SL7 Co-op.** Party start and floor change under the cover with no hold; the cover cap. Verify: Test > Clients and
Servers (3 players): start, descend twice; no desync (hash check passes), every client shows the card, nobody is held.

**SL8 Docs.** CLIENT.md section + smoke test, CLAUDE.md decision log, this doc's status and as-built notes.

## Studio smoke test

1. Play solo: loader ("Starting run...", "Forging floor 1..."), reveal on the knight. Output: `[Stage] run 1: forged
   in t ms, built in t ms, revealed at t s`; `[Stage] floor 2 pre-generated in t ms (run start)`.
2. Walk to the stairwell: card "Floor 2 · Ancient Halls", then the draft. While the draft is up:
   `[Stage] floor 3 pre-generated ...`. No stutter on the stairwell.
3. Spam the debug floor skip (KV_Debug): every change is covered; some log `built mid-tick (not pre-generated)`.
4. Tutorial (first join): loader, then the lessons; its floor change shows the card.
5. Party run (3 clients): card on start and on each descent, no desync.

## Edge cases

- **Death on the stairwell tick / Leave run under the cover:** the cover ends with the run (`onRunExited` cancels the
  stage load; Janitor).
- **Run-over panel or pause during a cover:** the cover wins (display order); pause is ignored while covered (solo is
  held anyway).
- **Restart (R) while covered:** the new run restarts the stage load.
- **Floor skip faster than pre-gen** (debug only): today's mid-tick build, then the cover.
- **Server never answers** (`RUN_START_TIMEOUT_SECONDS`): the loader shows "Starting run..." until the existing
  unranked fallback starts the run, then proceeds; `maxCoverSec` counts from the answer, not the click.
- **Co-op with one slow client:** that client's player idles at the entrance (EMPTY input) a moment longer; room
  enemies spawn on room entry, so the entrance should be safe, but a floor's initial spawns (the boss on boss floors)
  are not deferred: check in SL7, and if anything can reach the entrance, keep co-op covers to the build only.
- **Memory:** the cache keeps 3 floors (current, next, one spare); nothing new is retained.

## Decisions (signed off 2026-10-27: the recommended default, first, in each)

- **SD1 Pre-generate during the draft.** Build floor n + 1 while floor n's draft is open. *Alternative:* build it when
  the stairwell opens or the player nears it (a visible mid-play hitch); or Parallel Luau (an Actor builds the floor and
  sends it back: the world holds closures that cannot cross Actors, so a big refactor).
- **SD2 Hard cut to the card on the stairwell.** *Alternative:* a 0.2 s fade to black before the change (needs a sim
  change or a client guess, since the floor changes the same tick the player touches the stairwell).
- **SD3 Card at least 0.6 s on floor changes, none on run start.** *Alternative:* no minimum (the card can flash for a
  frame or two when everything is ready).
- **SD4 Wait for the floor's front-lane assets up to 3 s.** *Alternative:* never wait (assets may pop in on the reveal).
- **SD5 Hold the sim on a solo run start only.** Co-op never holds; floor changes need no hold (the draft freezes the
  world). *Alternative:* also hold solo floor changes without a draft (the tutorial's), at the cost of a sim pause the
  replay does not see (solo pause already works that way, so it is safe).
- **SD6 One cover component** shared with the join screen (`LoadingScreen` variant). *Alternative:* a separate card.

## Out of scope

Faster generation (the Forge itself), Parallel Luau, streaming a floor in pieces, a descent animation or art, tips on
the card, server-side changes.
