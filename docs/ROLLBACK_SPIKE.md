# Rollback spike (measure before building)

Co-op rollback would draw the whole world ahead of the server: every frame, copy the confirmed state, step it forward
over the inputs not confirmed yet (your own known, teammates' guessed), draw the copy, and redo it when the server's
frames arrive. This spike does **not** build that. It answers, with numbers, whether it is worth building:

- **Q1. CPU.** Can a phone copy the state and step it H ticks every rendered frame, inside a frame's budget?
- **Q2. Mispredictions.** With real co-op inputs, how often and how far would the drawn world visibly correct itself
  (enemies jumping, kills undone, bullets appearing and vanishing, teammates pulled back)?
- **Q3. Client cost (paper).** How much of the client would have to change (the state copy, every per-tick event feed)?

The answer is compared with the cheaper plan, docs/LOCAL_PREDICTION.md (your knight and your attacks' looks predicted,
bullets drawn ahead exactly), which the same harness measures for free.

**Spike only.** No sim, dungeon, hash, replay, fixture, score, lockstep wire or server-validation change. Everything runs
in specs or behind debug switches that are off by default and cleaned up with Janitor (`KV_RollbackSpike` on the
client, `KV_RollbackCapture` on the server). Nothing predicted ever reaches the sim, a hash or a recording; only debug
summaries reach a debug remote. The device work runs **off the main thread** (Parallel Luau) by default, so a test does
not freeze the game; a serial mode exists only as the comparison. All measuring and logging is Roblox-side
(MicroProfiler, Developer Console, server log, a DataStore read from Studio, AnalyticsService); Open Cloud is a
fallback only.

## Status (2026-11-09)

Planned, nothing built. Written against `main` @ `49a74856` (frame pacing FP1-FP8 in; the measured lead,
`frame-pacing-lead` @ `b5bfd4bb`, not merged). Follows the discussion of local prediction vs rollback (2026-11-09).
Revision 2 (same day, owner): the device work off the main thread (Parallel Luau, a worker that mirrors the run), Roblox-
side measuring and logging instead of Open Cloud, and live metrics on the players' devices (Design 5-7, R3a, R4b).

## What is known (findings)

| Fact | Where | Consequence |
|---|---|---|
| One sim tick costs 0.19-0.21 ms (solo, one room), 0.54-0.60 ms (8 players, one room), 0.72-1.17 ms (whole floor entered), headless under Lune without Luau fast paths or native codegen | docs/SERVER.md "Replay capacity", `run/replay.bench.spec.ts`, `sim/bench.spec.ts` | Rollback at 16 ticks a frame: ~3-19 ms headless. A pessimistic host; the device number is unknown (Q1) |
| No state copy exists. `SimState` is a core (tick, rng, player, events, combat with its `BulletSimulation`) plus ~15 optional subsystems (endless, score, run, party, tutorial, breakables, drops, affixes, dev, builds, pellets, treasure, pacts, golden) | sim/state.ts, sim/hashLayout.ts | The spike needs a copy; R0 lists what is mutable, shared and transient |
| `step` / `stepParty` clear every subsystem's events at the start of each tick; views collect them per stepped tick (`RunView` collectors: room clears, combo, near miss, recap tally, build fx, ...) | sim/step.ts, shared/view/fx | Under rollback every feed can show an event, lose it in a re-run, or show it twice (Q3) |
| Ahead of the confirmed tick T: frames through T + D are already in the playout buffer (truth for everyone), your own inputs are known through T + D + L, teammates' are guessed for L ticks | lockstep/client.ts, pacer.ts | The guessed span is the net lead L, not the whole horizon. Measured on the spec networks: L 11-12 (20-120 ms one way), 15-17 (0-200 ms); D 3-5 (docs/FRAME_PACING.md) |
| No human co-op inputs are kept. The server replays and validates a run's segments and discards them | server RunSessionService, run/segments.ts | Human inputs must be captured for Q2 (R4) |
| The bots' aim follows their movement and their presses are scripted (`partyBot`: walks, swings at the nearest enemy, fights the boss; replay.bench's fighter: strafes, rolls, aims, never kills) | run/testing | Bots under-state how often a guess is wrong (a mouse moves the aim almost every tick). Good for building and sanity, not for the answer |
| A bullet in flight is ballistic: velocity += acceleration, position += velocity, life counts down; only a hit, a guard / erase or a wall / piece removes it | combat/bullets.ts `step` | The cheap plan's bullets-ahead are exact until removed; the harness can measure their error beside rollback's |

## Design

### 1. State copy (spike-grade, `shared/lockstep/rollbackSpike/clone.ts`)

`cloneSimState(state)`: a generic deep copy. Recursive over tables with a memo (a reference shared inside the state
stays shared in the copy; cycles are fine), metatables kept by reference (class instances such as `BulletSimulation`
stay instances), buffers copied. Immutable data the state only points at (configs, the floor's grid and world, arc
tables: R0's list `SHARED_BY_REFERENCE`) is shared, not copied. Not in `shared/sim`: the sim is not touched.

It is correct first and slow: a real rollback would copy into preallocated pools. So the spike's **clone time is an
upper bound** and its **step time is the floor** of what rollback costs.

### 2. The prediction model (headless, `rollbackSpike/model.ts`)

Replays a recorded co-op run as one client sees it, for every player index i in turn:

- Step the real (confirmed) state through the log, one tick at a time, as the client does.
- At each tick T (a client frame; the harness models 60 Hz paced play, one tick a frame): clone, then step the copy to
  the drawn tick `T + D + L` (capped at H) with: the log's frames through T + D (truth), player i's own frames from the
  log (known), every teammate's input **guessed** for the ticks after T + D.
- Guess strategies: `repeatLast` (GGPO's default, the baseline), `repeatLastAxesOnly` (held axes and aim kept, buttons
  released), `neutral`. A held button repeats as held, so a guess never invents a new press (`prevButtons` edges).
- The network is a fixed (L, D) per pass, swept: L in {6, 11, 16, 25}, D in {0, 4}. (With rollback the playout buffer
  might go away, which is D = 0: the sweep covers it.)
- Per predicted tick a compact **view digest** is kept, not the state: per actor slot (kind, alive, x, z, hp), per
  bullet slot (alive, x, z, kind; identity from slot + spawn tick, or position continuity if the payload carries no
  spawn tick: R0 confirms), per player (x, z, hearts, dead), and the tick's events (kills, pickups, hits on players,
  erased bullets).

Nothing here is a production predictor: no smoothing, no rendering, no event dedup.

### 3. Metrics (`rollbackSpike/metrics.ts`)

All per minute of play, per player, split by room type (combat / boss / walking) and by (L, D, strategy):

| Metric | Definition | What the player would see |
|---|---|---|
| Correction | The same drawn tick predicted on two consecutive frames: per entity, the position change. Buckets >= 0.1 / 0.25 / 0.5 / 1.0 tiles | Enemies / teammates jumping (small ones a smoother hides) |
| Truth error | The prediction for tick K vs the confirmed state at K | How wrong the drawn world was |
| Undone event | A kill, death, pickup or bullet erase shown in a prediction for K and absent from the truth at K (counted once per entity and event) | An enemy dying and coming back, a pickup reappearing |
| Late event | In the truth, never predicted before it was confirmed | Shown late (today's behaviour), not a glitch |
| Phantom bullet | A bullet shown in a prediction that vanishes in a later prediction for the same tick, or that first appears already far along its path | Bullets blinking in and out |
| Your hearts | A predicted hit on player i that the truth does not have, and the reverse | Counted only: neither plan would draw it |

The same pass computes the **cheap plan's** numbers for comparison: bullets drawn ahead ballistically (stopped at
walls and unbroken pieces) with enemies at the confirmed state, its phantom / late bullets, and the delay each plan
leaves on an enemy's reaction to your hit.

Sanity rules the harness must pass: with perfect guesses (teammates' true inputs) every glitch metric is zero; with
L = 0 (no guessed span) every glitch metric is zero.

### 4. Inputs

- **Bots** (for building and sanity): `recordPartyRun`, and a noisy variant of it (aim drifting every tick, tapped
  attacks, random rolls) as a rough stand-in for a mouse.
- **Human play** (the answer): live metrics on the players' devices (Design 7) and captured runs (Design 6, R4).

### 5. CPU probe on devices (`KV_RollbackSpike`, client)

Workspace attributes: `KV_RollbackSpike` a number = H (0 or absent: off), `KV_RollbackSpikeMode` `"parallel"` (default)
or `"serial"`. Both modes, in a live run (solo or co-op): clone the confirmed state, step the copy H ticks (co-op:
everyone repeats their last input; solo: the local input, then neutral), discard it. Timed with `os.clock()`: clone ms,
step ms, total; p50 / p95 / max over 10 s, the frame time and `gcinfo()` growth per second.

**Parallel (off the main thread, the default).** An `Actor` (created by the probe, cleaned up with Janitor) with its own
LocalScript runs the work in Parallel Luau. It never receives the state: the sim is deterministic, so the worker
**mirrors** the run itself. At co-op start it gets the run setup (world kind, seed, party size, start floor: the same
inputs `startCoop` builds its config from) and builds its own config and state; then, every frame, the merged frames
the main thread just stepped (a few bytes a tick, `Actor:SendMessage`). Its confirmed state is the main one's; every
600 ticks it sends its `hashState` back and the main thread compares (a mismatch stops the probe and prints both). On
that mirror it clones and steps H ticks, desynchronized (`task.desynchronize()`), in slices of `ROLLBACK_SPIKE.sliceTicks`
(4) with a yield between them, so no single parallel task runs long (Roblox's guidance: even in parallel, long
computations can block other scripts). It reports both "work ms" and "frames from start to finish of one prediction"
(how far behind a rollback built this way would draw). Modules are required in the serial phase at the worker's start
(`require` is not allowed while desynchronized). The worker's module scratch is its own VM's, so it cannot touch the
main sim's.

It also measures what a real rollback would have to send back each frame: a buffer the size of a view digest (64 actors,
150 bullets, 8 players: `ROLLBACK_SPIKE.digestBytes`) sent to the main thread, timed at both ends. Whether `SendMessage`
carries a `buffer` is not documented: R3a checks it first and falls back to a `SharedTable` (shared, not copied).

**Serial (the main thread).** The same work in the frame, as a serial rollback would do it: this mode is the one that
costs frames, and it is the comparison. Never on in a playtest with other people.

Under KV_Debug, once a second, the main thread checks its own state's hash is unchanged by the probe.

Cases (with dev mode, docs/DEV_MODE.md, to reach them): floor 15 at Depth 3 one-room fight and whole floor entered (the
replay bench's cases), a boss fight, solo and a 2-4 player party. H 8 / 16 / 24. Devices: a PC, an iPhone, a mid and a
low Android phone; 60 Hz and a 120 Hz screen. Native code generation (`--!native`) runs on the client on **Android
only** (Roblox's docs), so the spike measures the sim with and without it on Android and records iOS as interpreted.

**Reading the numbers (all Roblox-side, no Open Cloud).**
- The probe wraps its phases in `debug.profilebegin("kv.rollback.clone" / ".step" / ".send")` / `debug.profileend()`,
  so they show on the **MicroProfiler** timeline: Ctrl+F6 on a PC; on a phone, Settings > MicroProfiler On, then a
  browser on a laptop on the same network at the IP and port the phone shows (port 1338 in Roblox's example). Whether
  labels show on worker threads is not documented: R3 records it.
- A `[Rollback]` line every 10 s in the **Developer Console** (F9; on a phone, the in-game console) and an overlay line.
- **Logged, not only shown.** Every 10 s window the worker (or the serial mode) sends a `ProbeSummary` to the server
  through a rate-limited debug remote (`rollbackProbe`, only while `KV_RollbackSpike` is on; the server re-reads every
  field, like `readRunRecapReport`): mode, H, case (room / floor / boss / walk, from the state), party size, actors and
  enemy bullets alive, clone / step / send ms p50 / p95 / max, frames per prediction, render fps, frame ms p95,
  `gcinfo()` KB/s, whether `--!native` ran, and a device label. Roblox gives scripts no device model, so the label is
  what the game knows (touch / gamepad / keyboard, viewport size, `GuiService:IsTenFootInterface()`) plus an optional
  tester's tag typed in the dev panel (F2, e.g. "Pixel 6a"). The server writes it to three places:
  - **the server log** (`[Rollback] ...`, Developer Console > Server), live while you are in the session;
  - **`KV_RollbackProbe_v1`**, one row per window (key: session id + window index, a session's rows listed by a
    prefix), the per-session record the Studio plugin pulls with the captures (Design 6) and the harness turns into the
    device table;
  - **AnalyticsService** in published places: one custom event `RollbackCpu`, value = total ms p95 of the window,
    custom fields (three): device class (pc / phone / tablet / console), mode + H (`parallel16`), case; a dashboard
    across sessions and testers, daily (up to 24 h). Together with `RollbackProbe` (Design 7) that is two of the 100
    event names.

### 6. Capturing human runs (`KV_RollbackCapture`, server)

On a server where the switch is on and only for parties of DEV_MODE-allowed players (or a private server the owner
names): at the end of every co-op run the server writes the run's merged log through the existing recording codec to
DataStore `KV_RollbackCapture_v1`, keyed by run id, chunked under the 4 MB value limit, with user ids replaced by player
indices (inputs only). Studio and published places only; never on by default.

**Getting them out without Open Cloud:** the existing Studio plugin (`plugin/RunTestsPlugin.server.lua`, or a small
second one) gains a "Pull rollback captures" action: with Game Settings > Security > "Enable Studio Access to API
Services" on, it lists and reads `KV_RollbackCapture_v1` and `KV_RollbackProbe_v1` from Studio (no API key) and posts
each capture and probe row over HttpService to a receiver on the laptop (`scripts/rollback/receive-captures.js`, localhost only, the way Rojo's plugin talks to
`rojo serve`), which writes gitignored `captures/`; the fixture generator turns them into gitignored modules for the
harness. Open Cloud stays the fallback (`scripts/rollback/fetch-captures.js`, the key from the environment) if the
plugin path fails.

### 7. Live metrics (on the players' devices, no capture needed)

The parallel worker (Design 5) already holds the confirmed state and the real merged frames, so it can run the
prediction model (Design 2) live: each frame it predicts the drawn tick with the guess strategy, and when that tick is
confirmed it compares, computing Design 3's metrics on the real network (the real L and D) and the real inputs. Every
60 s it sends a summary (per metric per minute, L and D seen, room type) to the server by the same debug remote; the
server prints it and, in published places, logs aggregate custom events through AnalyticsService (`RollbackProbe`: one
event name, value = the metric, custom fields: metric, device class, horizon bucket; one more of the 100 names Roblox allows). Custom
events are server-only, published-place only and aggregated daily (charts can take up to 24 h), so they are a
dashboard over many sessions; the server log and `KV_RollbackProbe_v1` are the per-session record.

Live metrics answer Q2 at today's lead with `repeatLast` (the gate), with no capture to move. Captures stay for what
live cannot do: rerun the same play at other (L, D, H, strategy) after the fact. The live model runs only in the
parallel mode and only with `KV_RollbackSpike` on.

## Gates (proposed; the owner sets them in R6)

- **CPU:** clone + 16 steps, p95 at most 4 ms a frame on the mid phone in the one-room fight and 8 ms whole floor (room
  for rendering at 60 fps). If only the PC passes, PC-only rollback is an owner call. The report gives the largest H
  that passes on each device.
- **Mispredictions** (human captures, the measured L): enemy corrections >= 0.5 tile under 6 a minute, undone kills
  under 1 a minute, phantom bullets under 10 a minute, teammate corrections >= 1 tile under 6 a minute. And fewer
  visible problems than the cheap plan for what it gains.

## Decisions (proposed)

- **RBD1. Measure, don't build.** The spike adds no production path; its code stays behind its switches or is removed
  (R7).
- **RBD2. A generic copy, not a pooled one.** Correct first; the clone time is an upper bound (Design 1).
- **RBD3. An offline model over recorded logs** for Q2, not a live rollback client: deterministic, every capture rerun
  at any (L, D, H, strategy). The network is a fixed (L, D) per pass; one pass through the lockstep harness's `Channel`
  with the measured lead is an optional check.
- **RBD4. Human inputs decide.** Live metrics (Design 7) set the gate at today's lead; captures rerun it at other
  settings. Bots only build and sanity-check the harness.
- **RBD5. `repeatLast` is the baseline guess** (the standard choice); the other strategies are measured beside it.
- **RBD6. Parallel by default, through a mirror.** The worker steps its own copy of the run from the merged frames
  (deterministic, hash-checked) instead of receiving the state: a few bytes a tick cross threads, not the state. A real
  rollback would be built the same way, so the probe measures the architecture it would use. Serial mode stays as the
  comparison.
- **RBD7. Roblox-side tools first.** MicroProfiler labels, the Developer Console, the server log, DataStores read from
  Studio by the plugin, AnalyticsService for the cross-session dashboard. Open Cloud only if the plugin path fails.

Open owner calls: the gates' numbers, the test devices, whether PC-only rollback is acceptable.

## Tasks

- [ ] **R0. Census (paper).** (a) The copy surface: every `SimState` subsystem and every object it reaches, marked
  mutable (copied), shared immutable (`SHARED_BY_REFERENCE`) or transient (module scratch rebuilt each step: `SimCtx`
  masks, step.ts's `soloPrev`, ...). (b) The event feeds: every client consumer of per-tick sim events or `RunView`
  collectors, each marked "presentation, needs dedup under rollback" or "must stay on the confirmed state" (telemetry,
  recap tallies, records). (c) Whether bullet payloads carry a spawn tick. -> Verify: the three lists in this doc, and a
  rough count of the client files a real rollback would touch.
- [ ] **R1. State copy.** `cloneSimState` + `SHARED_BY_REFERENCE`. -> Verify: `clone.spec.ts` on endless floors 1, 5
  (boss) and 15 (dense), solo and 4 players: the copy's hash equals the original's; both stepped 600 ticks with the same
  inputs stay equal at every 60-tick check; stepping the copy 600 ticks leaves the original's hash unchanged; a bench
  prints the clone time per case.
- [ ] **R2. Model and metrics (headless).** Design 2-4 over bot runs. -> Verify: the two sanity rules (Design 3) hold
  exactly; the report table prints for `recordPartyRun` and the noisy bot over the (L, D, strategy) sweep. The full
  sweep is opt-in (`npm run test:only -- lockstep/rollbackSpike` with its flag on), so `npm test` runs one small pass.
- [ ] **R3a. Parallel facts (Studio, small).** An Actor with a LocalScript under roblox-ts: required modules in the
  serial phase, the sim built and stepped desynchronized; `SendMessage` with a table, a `buffer` and a `SharedTable`
  (what arrives, copied or not, metatables); MicroProfiler labels from the worker; how a 5 ms and a 20 ms parallel task
  affect the frame time. -> Verify: the answers written here (they are not in Roblox's docs); Design 5 adjusted to them.
- [ ] **R3. CPU probe.** Design 5, both modes, the mirror and its hash check, the digest send. -> Verify:
  `npm run verify`; Studio: at H 16 the probe shows its line in both modes, the mirror's hash matches for a 10-minute
  run, the main hash check passes, attribute off creates nothing (no Actor); every window's summary prints on the
  server and lands in `KV_RollbackProbe_v1`, the plugin pulls the rows, and a malformed summary is refused (spec on the
  reader).
- [ ] **R4. Capture.** Design 6, the plugin action and the receiver. -> Verify: Studio (Test > Clients and Servers, 2
  players): a run's capture is written, pulled by the plugin through the receiver, and replays in the harness to the
  run's final hash (the capture is whole).
- [ ] **R4b. Live metrics.** Design 7 in the worker, the summary remote, the server line, `KV_RollbackProbe_v1`, the
  `RollbackProbe` custom event. -> Verify: in Studio with Incoming Replication Lag 100 ms and two clients, the summaries
  print on the server; with a test hook that makes the guess the truth (teammates' frames read from the log ahead of
  time) every glitch metric is zero; the live numbers for a captured run equal R2's offline numbers for the same run at
  the same (L, D) within the lead's movement.
- [ ] **R5 [owner]. Device and playtest session.** The probe on a PC, an iPhone, a mid and a low Android phone (Design
  5's cases; both modes, MicroProfiler screenshots kept), numbers recorded here; a co-op playtest of 20-30 minutes with
  friends on their own connections, capture and live metrics on (parallel mode only; pairs with FP14 / FP15).
  -> Verify: the device table, the live summaries and at least three captured runs.
- [ ] **R6. Report and decision.** The live summaries (the gate) and the harness over the captures (the sweeps); the
  result tables filled in; a recommendation (build rollback and its scope, build the cheap plan, or the cheap plan
  first). -> Verify: the owner's decision recorded here as RBD8; docs/LOCAL_PREDICTION.md points at it.
- [ ] **R7. Cleanup.** Per RBD8: the spike code removed, or kept behind its switches as the first piece of the build
  (the worker mirror is reusable).

Order: R0 -> R1 -> R3a -> R2, R3, R4 (in parallel) -> R4b -> R5 -> R6 -> R7. R2 needs only R1.

## Results (filled in by R2, R5, R6)

| Device / host | Case | H | Clone ms p50 / p95 | Step ms p50 / p95 | Total p95 | Frame ms | GC KB/s |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

| Input | L | D | Strategy | Enemy corr. >= 0.5 /min | Undone kills /min | Phantom bullets /min | Teammate corr. >= 1 /min | Cheap plan: phantom / late bullets /min |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

## Risks

- **Bots are not people.** Their aim follows their walk, so they under-state wrong guesses. Only human captures (R4,
  R5) decide (RBD4).
- **Headless timing is not a device.** Lune runs without fast paths or native codegen, so the headless numbers are
  pessimistic; R5's device numbers decide Q1.
- **Capture size.** A 30-minute, 4-player log's encoded size is unknown; chunked under the DataStore limit (R4 measures
  it).
- **A hidden shared reference in the copy** would make the probe or the model corrupt the real state. R1's checks and
  R3's hash check catch it.
- **The probe costs frames.** Off by default. The parallel mode keeps the work off the main thread, but Roblox does not
  document how a long parallel task affects the frame (its guidance: long computations can still cause lag), so the
  work runs in slices and R3a measures it; the serial mode is never on with other players.
- **Parallel Luau's undocumented corners** (message types, worker labels in the MicroProfiler, frame effects) are
  checked first, in R3a, before anything is built on them.
- **The worker mirror drifts** (a config built differently from the main one). The 600-tick hash check stops the probe
  and prints both hashes.
- **Native code only on Android.** iPhones run the sim interpreted (Roblox's docs), so an iPhone may fail a gate an
  Android phone passes; the device table keeps them apart.
- **What it does not measure:** how rollback's corrections look after smoothing, sound and effect dedup in practice,
  and memory pooling. Those belong to a build plan if R6 says build.
