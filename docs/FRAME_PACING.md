# Frame pacing (co-op)

Co-op looks choppy because the client steps the server's merged frames **the moment they arrive**. They arrive in
uneven bursts, so the picture moves, freezes, then jumps. This plan adds a **playout clock**: the client keeps a small
buffer of received frames and steps them at a steady 60 Hz. It also fixes a bug where the input lead **never comes
back down** after a lag spike. Work it task by task; each task ends with a **Verify**.

**Client timing and presentation only.** No sim, dungeon, hash, replay, fixture, score or wire change: the client
still steps exactly the server's merged log, only WHEN it steps changes. The server is unchanged (FP7 is an optional,
measured tunable change). Solo runs are untouched (they keep `FixedStepLoop` and the hitstop pacer).

**The cost: a little more input delay.** A buffer of D ticks delays what you see by D ticks, and your own inputs by
the same amount (the lead has to cover it, Design 5). D is at least 3 ticks (50 ms, FPD6), typically 3-5 (50-83 ms). Drawing your own knight ahead
of the server (local prediction, a separate plan) is what hides input delay; this plan only removes the stutter.

## Status (2026-11-07)

**Built: FP1-FP5 and FP8**, verified headlessly (typecheck, lint, asset / AutoLocalize checks, build, the lockstep,
pacer, arrival log, latency probe and HUD specs). **Pending: FP0 and FP6 (owner: a measured real session, then the
playtest), the Studio two-player check (FP5's Verify); FP7 optional.** The tunables stay provisional until FP0 / FP6.
Drafted from an audit of `main` @ `0a8e8ec4` after the owner's first co-op playtest with friends on Roblox ("the game
was laggy"). Owner answers (2026-11-07): a 3-tick minimum (FPD6), a 10 % fast slew (FPD7), one tuned default with no
setting (FPD8). See "As built" for the real API and the deviations from the design.

**Revision 2 (built 2026-11-09, verified headlessly): the lead from measured trips** (FP9-FP16, decisions FPD9-FPD14;
section at the end): the net lead is set from the 95th percentile of measured input round trips plus a margin, instead
of +1 per miss. Pending: FP14 / FP15 (owner) and the Studio checks.

**Revision 3 (built 2026-11-10, verified headlessly): a steady lead on jittery links** (FP17-FP22, decisions
FPD15-FPD19; section at the end): on a 4G-like link the late bump keeps the lead hovering far above its target; the
census (FP17) measured today's rule against eleven candidates, and the capped cover is built (FP18-FP20, FP22): no late
bump, the p95 target plus a p99 / 15 s cover that never passes the prediction cap. Pending: FP21 (owner: Studio 4G
again, with and without `KV_LeadBump`).

## Why co-op stutters (findings)

| Fact | Where | Consequence |
|---|---|---|
| `pump` steps every queued frame at once (up to `MAX_CATCHUP_TICKS_PER_FRAME` 8), the same render frame it arrives in | lockstep/client.ts `pump` | No buffer: any lateness shows on screen at once |
| The server batches frames: it finalizes `floor((now - start) x 60)` ticks per Heartbeat (at most 5) and flushes once 2 or more wait | lockstep/session.ts `step`, `BROADCAST_EVERY_TICKS` 2 | Batches carry 2-6 ticks and leave on the server's Heartbeat, not on a fixed 33 ms beat |
| Roblox delivers RemoteEvents in network frames, reliable and ordered | shared/network.ts `lockstepFrames` | Arrival times jitter; one lost packet holds every later batch (head-of-line) |
| `getAlpha()` = time since the last step / `SIM_DT`, clamped to [0, 1]; reset to 0 on any frame that stepped | client.ts `getAlpha` | Views lerp `prevX -> x` over **the last tick only** |
| Views draw `lerp(prev, current, alpha)` per tick (35 `getAlpha()` call sites under client/) | ActorRenderController and every fx / render controller | A frame that steps 4 ticks shows a 3-tick jump: ticks 1-3 are never drawn |
| At >60 fps a 2-tick batch every 33 ms glides for one tick (16.7 ms), then holds at alpha 1 for 16.7 ms | `getAlpha` | **On a 120 / 144 Hz screen everything moves half the time and stands still the other half**, even on a perfect network |
| At 60 fps with perfect arrival it is smooth; a batch 10 ms late gives a hold of one frame, then a 2-3 tick jump | same | Every bit of network jitter becomes a visible hitch |
| Solo uses `FixedStepLoop` (accumulator, alpha in [0, 1)) | shared/sim/loop.ts, play/liveRun.ts | The steady-clock pattern already exists; co-op never used it |

### The lead bug (found in the same audit)

`nextInputTick()` is `max(lastSentTick + 1, state.tick + lead)` and every stepped tick sends for it
(client.ts 185, 334-340). When `lead` decays by one (after 10 clean seconds), `state.tick + lead` equals
`lastSentTick`, so the `max` picks `lastSentTick + 1`: **the effective lead stays where it was, forever**. It is the
highest lead the run ever reached. Worse, the internal `lead` keeps decaying, so after a quiet minute a new spike's
misses first raise `lead` back up to the effective value **without changing anything**: every one of those misses is
a dropped input (repeat-last) that buys nothing. The KV_Debug line shows the internal `lead`, so it under-reports the
real delay. No spec covers the decay (the network specs only check that misses stay under a quarter of the ticks).

One lag spike in a co-op run therefore sets the input delay for the rest of that run (up to `MAX_INPUT_LEAD_TICKS`
30 = 500 ms). This likely explains part of what the playtest felt, and FP1 fixes it on its own.

## Design

### 1. The playout clock (pure, `shared/lockstep/pacer.ts`)

A `PlayoutPacer` decides **how many queued frames to step this render frame** and the **alpha**. It knows nothing of
the sim; LockstepClient owns one (when pacing is on) and asks it inside `pump`.

The idea (standard adaptive playout, as in VoIP and lockstep RTS): tick k's frame is stepped at local time
`k x SIM_DT + P`, where P is the **playout offset**. P is "the fastest a frame has ever reached us, plus a safety
buffer". When P is right, every frame is already in the queue when its turn comes, and exactly one tick is stepped
per 16.7 ms, whatever the render frame rate.

- `arrived(now, newestTick)`: called by `receive` with the local clock. Records the batch's **offset**
  `o = now - newestTick x SIM_DT`. The unknown server-client clock difference is the same in every offset, so it
  cancels out. The newest tick of a batch is the right one: its older ticks waited on the server for it, so they are
  never later than it.
- `frame(now, queued)`: returns how many ticks are due (`floor((now - P) / SIM_DT) - steppedTicks`), never more than
  queued, never more than `maxCatchup`. Then `alpha = (now - P) / SIM_DT - steppedTicks`, in [0, 1).

### 2. How deep the buffer is

- `base` = the **smallest** offset over the last `PACING.floorWindowSec` (10 s): the best-case path.
- `jitter` = the `PACING.jitterPercentile` (95th) offset over the last `PACING.jitterWindowSec` (4 s), minus `base`.
- **Target** `P* = base + clamp(jitter + marginTicks x SIM_DT, minDepthTicks, maxDepthTicks) x SIM_DT`.
- The depth (`P - base`, in ticks, rounded up) is what LockstepClient adds to the input lead (Design 5) and what the
  debug line shows.

The 95th percentile, not the max: one 300 ms outlier every minute should cause one hold, not a permanent 300 ms delay.

### 3. Holds, slewing and catch-up

- **Hold (underflow).** A tick is due but not received: nothing is stepped, alpha stays at 1 (the views show the
  newest state, frozen) and P moves forward by the time waited. The hold is counted (`holds`, one per contiguous
  hold). The jitter window then raises P* by itself.
- **Slew.** P moves toward P* gently: the playout clock runs between `1 - slewShare` and `1 + slewShare` (5 %) real
  speed. Slower than 5 % is not noticeable in practice.
- **Fast slew.** When P is more than `fastSlewTicks` (6) past P* (after a long hold), it slews at `fastSlewShare`
  (10 %, FPD7) until within it: a 500 ms hold's extra delay is gone in about 5 s (10 s at 5 %), with no visible
  fast-forward.
- **Catch-up (a client hitch).** After a long render frame (a floor change rebuild, GC, a tab-out) many ticks are due
  at once; `frame` steps up to `maxCatchup` (8) per frame as today until it is back on schedule. P is not touched.
- **Hitched frames are not jitter.** Arrivals handled in a frame whose `dt` is over `PACING.hitchFrameSec` (0.1 s)
  are left out of the windows: their late timestamps are the client's own stall, not the network's.

### 4. Alpha

`LockstepClient.getAlpha()` returns the pacer's alpha when pacing is on, else today's value. Views do not change:
they keep `lerp(prev, current, alpha)` and now see one tick per 16.7 ms, with alpha moving smoothly through [0, 1).

### 5. The input lead with a buffer

A client steps tick s at local time `s x SIM_DT + P`, so its input for `s + lead` reaches the server later the deeper
the buffer is. The lead must cover **round trip + depth**. So the lead becomes two parts:

- `netLead`: today's `lead` (starts at `INPUT_DELAY_TICKS`, +1 per miss, -1 after `leadDecayTicks` clean ticks);
- `depthTicks`: the pacer's depth, rounded up (0 with pacing off).

`nextInputTick()` = `tick + netLead + depthTicks`. With FP1's fix, a step whose target was already sent sends
**nothing** (the delay really falls), and a target that jumps by one leaves one tick to the server's repeat-last (a
held input repeats; not counted as a miss, it was never sent). Raising the depth raises the lead at once, so a deeper
buffer causes no misses.

### 6. Wiring

- `LockstepTunables.pacing: PacingTunables | undefined` (`DEFAULT_LOCKSTEP.pacing` = `PACING`; the network specs and
  `latencyProbe.spec` pass `undefined` where they assert today's exact stepping).
- `receive(firstTick, data, now?)` and `pump(dt, sample, now?)`: `now` is the local clock (SimController passes
  `os.clock()`; the spec harness its simulated clock). Without `now` (or with pacing off) the client behaves exactly
  as today.
- `SimController`: `Events.lockstepFrames` passes `os.clock()`; `coopFrame` passes `os.clock()` to `pump`.
- `KV_PacingOff` (Workspace attribute, read at each co-op start, like `KV_Debug`): pacing off, for A/B in a playtest.
- Unchanged: hash reports, the final claim, `end`, floor changes, the stage cover (still never held), spectating,
  drafts, the hitstop rule (`simPacerFor` still gives co-op no sim pacer: the playout clock is not hitstop).

### 7. Diagnostics (KV_Debug)

The co-op debug line (docs/FEEL.md J9) gains a pacing part: `pace {depth}t {ms}ms · holds {n} · backlog {b} ·
jitter p95 {ms}` and shows the **effective** lead (`nextInputTick() - tick`), not the internal one. The pacer exposes
`stats()` (pure numbers, never reaches the sim).

### 8. Broadcast every tick? (measured, optional)

`BROADCAST_EVERY_TICKS` 2 -> 1 would halve the batch wait (one tick less depth needed) for twice the remote calls
(60 per second per client). Roblox may coalesce remote events into its own network frames anyway; FP0 measures
whether batches of 1 arrive any more evenly. Only changed if FP0 / FP6 show a gain (FPD5).

## Tunables (`PACING`, shared/lockstep/config.ts)

| Name | Value | Why |
|---|---|---|
| `startDepthTicks` | 3 | Before any arrival is measured |
| `minDepthTicks` | 3 | One broadcast batch + a tick of margin (FPD6) |
| `maxDepthTicks` | 12 | 200 ms; past that a hold is better than the delay |
| `marginTicks` | 1.5 | Rounding and Heartbeat granularity: arrivals are handled on a rendered frame, so an offset can read one whole frame (1 tick at 60 fps) later than the last; 0.5 held about once a second on FP4's 20-120 ms network (1.5: none after the warm-up) |
| `jitterWindowSec` / `jitterPercentile` | 4 / 0.95 | Follows a changing network within seconds |
| `floorWindowSec` | 10 | The best-case path; follows a route change |
| `slewShare` / `fastSlewShare` / `fastSlewTicks` | 0.05 / 0.10 / 6 | Section 3 |
| `fastForwardTicks` / `fastForwardMarginTicks` | 12 / 1 | Past its target by more than 12 ticks (a long hold: a server stall) P is reset to the target + 1 tick, never past the newest queued frame, and the due frames step at `maxCatchup` a frame; a 10 % slew would take ten times the hold ("As built", review fixes) |
| `hitchFrameSec` | 0.1 | Section 3; also the clock elapsed since the last frame (a stall inside the render step) |
| `leadHysteresisTicks` | 0.4 | The lead's depth falls only once the depth is 0.4 tick at or below the next whole tick down (just under half a tick, so a depth sitting mid-tick is never on the threshold) |
| `phaseSmoothing` / `phaseLockSpread` / `phaseHysteresisTicks` | 0.1 / 0.12 / 0.25 | The mid-tick phase shift: the frames' phase on the tick grid smoothed by 0.1 a frame; applied while their mean distance from it is under 0.12 tick (60 fps +/- 1 ms: ~0.03; 120 / 144 fps: ~0.25, left unshifted); the shift keeps its whole-tick choice within 0.5 + 0.25 |

All provisional until FP0 / FP6.

## Decisions (FPD1-FPD5 proposed; FPD6-FPD8 the owner's answers, 2026-11-07)

- **FPD1. Client only.** The client still steps exactly the merged log; only the timing changes. No sim, wire or
  server change (FP7 is a tunable, and only if measured).
- **FPD2. Smooth beats instant.** A buffer of 3-5 ticks (50-83 ms) is worth it: stutter is visible to everyone all the
  time, the delay only in your own presses. Local prediction (docs/LOCAL_PREDICTION.md, built) is the fix for the delay.
- **FPD3. Hold, never extrapolate.** On an empty buffer the views freeze on the newest state; nothing is drawn that
  the sim has not stepped (no extrapolated enemies or bullets in a bullet hell).
- **FPD4. The lead fix ships first and on its own (FP1).** It is a bug, it costs nothing, and it is part of the lag.
- **FPD5. Broadcast cadence stays 2** unless FP0 / FP6 show batches of 1 arrive measurably more evenly.
- **FPD6. The buffer is at least 3 ticks (50 ms).** Fewer holds for 17 ms more delay than a 2-tick minimum.
- **FPD7. The fast slew is 10 %.** Less visible than a 25 % fast-forward; the extra delay after a long hold still
  clears within seconds.
- **FPD8. One tuned default, no player setting.** `KV_PacingOff` stays a debug switch for playtests only.

## As built (FP1-FP5)

**API (shared/lockstep).**

- `PlayoutPacer` (`pacer.ts`, pure): `arrived(now, newestTick)`; `frame(now, frameDt, stepped, queued, maxCatchup)`
  returns how many queued frames to step (Design 1's `frame(now, queued)` also takes the frame's dt (the hitch rule),
  the ticks stepped so far and the cap); `alpha()`, `depthTicks()` (the lead's depth: whole ticks with hysteresis,
  capped; below), `targetOffset()` (P*, before the phase shift), `stats(): PacingStats` (`started`, `depthTicks`,
  `depthMs` (the raw P - base), `targetTicks`, `jitterMs`, `holds`, `holding`, `catchingUp`, `fastForwarding`,
  `hitched`, `samples`, `pending`, `committed`, `discarded`, `position`, `phase`, `phaseLocked`, `phaseShiftTicks`,
  `offsetSec`, `targetOffsetSec`, `baseSec`). Arrivals are kept pending until the next `frame`, which commits them to
  the windows or discards them around a hitch (below).
- `LockstepTunables.pacing: PacingTunables | undefined`, `DEFAULT_LOCKSTEP.pacing = PACING`.
- `LockstepClient`: `receive(firstTick, data, now?)`, `pump(dt, sample, now?)`. Pacing turns on at the first pump
  given a finite `now` and stays on for the run (`isPacing()`); arrivals before it keep only the best offset, handed
  to the pacer when pacing turns on; a later pump without `now` runs on the last clock + dt; a batch without `now` is
  stamped by the next paced pump. `getAlpha()` is the pacer's (1 once nothing more will be stepped).
  `nextInputTick()` = tick + `netLead()` + depth; `inputLead()` = max(lead + depth, last sent - tick), the effective
  lead (FP1); `netLead()` the internal lead; `pacingStats()` (undefined while not pacing).
- `ArrivalLog` / `formatArrivalLine` / `nearestRank` (`arrivalLog.ts`, pure) and `ARRIVAL_LOG` (config.ts:
  `windowSec` 10, `sizeBuckets` 8, `maxGaps` 2048, quantiles 0.5 / 0.95).

**Client (SimController).** `Events.lockstepFrames` passes `os.clock()` to `receive`, `coopFrame` passes `os.clock()`
to `pump`. `KV_PacingOff` (`RUN_ATTRIBUTES.pacingOff`, boolean, off by default) is read in `startCoop`: true builds
the client with `{ ...DEFAULT_LOCKSTEP, pacing: undefined }` and prints `[Sim] co-op run <runId>: frame pacing off
(KV_PacingOff)`. Under KV_Debug (the value read at the last solo / tutorial start, docs/FEEL.md J9's caveat) a co-op
run gets the latency probe and an `ArrivalLog`; without KV_Debug neither exists.

**The debug line** (docs/FEEL.md J9; shared/view `latencyProbe.ts`): `co-op lead {lead}t {leadMs}ms (net {net}t) ·
{pace} · press->step {last}ms avg {mean} max {max} n{count} · late {late} miss {misses}`, with `{pace}` one of
`pace {depth}t {depthMs}ms · holds {holds} · backlog {backlog} · jitter p95 {jitter}ms`, `pace waiting · backlog
{backlog}` (pacing not on, or no batch yet) and `pace off (KV_PacingOff)`. `LatencyProbeView` gained `netLeadTicks`
and `pacing: PacingDebugView` (`pacingDebugView(stats, backlog, configured)`: whole ms, so the HUD store only changes
with the line); strings `hud.debug.pace` / `.paceWait` / `.paceOff` (developer strings, English, no l10n context).
The lead shown is `inputLead()` (Design 7 said `nextInputTick() - tick`: the same whenever a send happens, and the
truth right after a depth drop, when the inputs already sent reach further). Example:
`co-op lead 7t 117ms (net 3t) · pace 4t 58ms · holds 2 · backlog 3 · jitter p95 10ms · press->step 133ms avg 128 max
150 n9 · late 0 miss 1`.

**The arrival log** (FP0's instrument; KV_Debug co-op only): every 10 s of local clock one line, e.g.
`[Pace] 10.0s batches 300 ticks 600 · gap p50 33 p95 41 max 87 ms · sizes 2:290 3:10 · pace 4t 58ms target 3.5t
jitter p95 9ms holds 0 discarded 0 · lead 7t net 3t miss 0 backlog 3 · fps 60.0 worst 21ms`: the window's length,
batches and ticks, the batch inter-arrival gaps (nearest rank; a window's first gap runs from the previous window's
last batch), the batch-size histogram (non-empty buckets, `8+` for 8 or more), the pacer's depth / target / jitter /
holds (totals) / discarded arrivals, the effective and net lead, misses and backlog, the render fps and the longest
frame. Holds and misses are run totals: diff two lines for a window's.

**Review fixes (2026-11-07).** An independent review traced six problems in the first build; all fixed in
shared/lockstep only (no wire, relay, session or sim change):

- **A stall inside a render step is a hitch.** SimController runs `stage.frame(dt)` (deferred floor-change work)
  before `coopFrame`, so such a stall is in `now` but not in `frameDt`; it used to read as a hold and move P forward by
  the stall. Now a frame is hitched when `frameDt` or the clock elapsed since the last `frame()` is over
  `hitchFrameSec`. A hitched frame never moves P (no hold, slew or fast-forward), steps only what is due and queued up
  to the cap, and discards the arrivals pending at it AND at the frame right after it (handled after the stall, so
  stamped late by it). Then the ordinary catch-up.
- **A long hold is fast-forwarded, not slewed.** Once P is more than `fastForwardTicks` (12) past P* (a hold of
  ~200 ms past the buffer; after an H s server stall it used to leave about 10 x H s of extra delay at the 10 % slew),
  P is reset to the slew target + `fastForwardMarginTicks` (1), but never past the newest queued frame (it lands
  mid-tick before it), and the due frames step at `maxCatchup` a frame; while frames are missing it holds without
  moving P (counted in the same hold). Arrivals handled while fast-forwarding count for base but not for the jitter
  (the burst behind the hold, not network jitter: a server's catch-up would otherwise pin the target at
  `maxDepthTicks` for the whole jitter window). Measured: a 3 s server stall, the depth is back on target 0.2 tick
  ~1 s after the first batch (pacer spec); over the 20-120 ms spec network within 0.7 tick 1.25 s after the server
  resumed (its own catch-up at 5 ticks a step takes 0.75 s).
- **The lead's depth is capped and has hysteresis.** `depthTicks()` (what `nextInputTick()` adds) rises at once when
  the raw depth `P - base` passes it, falls only to `ceil(raw + leadHysteresisTicks)` (0.4), and never exceeds
  `maxDepthTicks`, so `MAX_INPUT_LEAD_TICKS + maxDepthTicks` (42) stays inside the relay's `MAX_INPUT_AHEAD_TICKS`
  (120): a server stall used to push targets past it (refused inputs, counted as misses, ratcheting the lead). A raw
  depth oscillating +/- 0.2 tick round a whole tick leaves it unchanged. A depth sitting exactly on a whole tick (144
  fps, no phase shift) keeps the lead one tick up rather than flicker.
- **The playout phase is kept mid-tick.** Arrivals stamped on rendered frames left `pos` at the pump on a whole tick,
  so +/- 1 ms of frame jitter flipped frames between 0 and 2 ticks, and a hold left the phase at 1 - 1e-6. The pacer
  smooths the frames' phase on the tick grid (`frac(now / dt)`, `phaseSmoothing`), and while it is steady (mean
  distance under `phaseLockSpread`: render rates at or below about the sim rate) the slew aims at P* +
  (frac(pos at P*) - 0.5) x dt, at the same slew limits (a pure relabelling in steady state: the same frames step the
  same ticks, only away from the boundary), with `phaseHysteresisTicks` so a P* wobbling across a boundary does not
  flip the target by a tick. At 120 / 144 fps the frames walk round the tick and nothing is shifted. A hold now freezes
  where the views already are, at most half a tick behind the newest state (`max(drawn, after - 0.5)`; Design 3 said
  alpha 1), so playout resumes mid-tick; the drawn position `stepped - 1 + alpha` never decreases (alpha capped at
  1 - 1e-6). Measured at 60 fps, +/- 1 ms frame and stamp jitter, stamps 2 ms after the previous frame (the worst
  case): 100 % of frames step one tick after the warm-up, phase 0.50; without the shift 52.5 %.
- **No pacer work after the run.** Once nothing more will be stepped (final claim, `end`, broken) `receive` no longer
  hands arrivals to the pacer (they piled up pending until the session ended).
- **Specs.** The paced NET_RUNS assert misses per player at or below the unpaced run's on the same network (the harness
  `Channel` now draws one latency per DT of simulated clock from its own seed, so both runs see the same network) and
  zero refused inputs; measured 3p paced 13,10,12 / unpaced 13,13,12, 8p paced 13-21 / unpaced 21-23. A 3 s server
  stall: zero refused inputs paced and unpaced (misses stay: the server's catch-up finalizes 5 ticks a step, faster
  than inputs can arrive, paced or not). FP4's 3-player 60 fps run now measures 99.6 % one-tick frames (the new
  network draws; 99.7 % before). The NET_RUNS nets are built once on first use (`finishedNet`), so no
  describe depends on another having run first.

**Deviations from the design.**

- `PACING.marginTicks` is 1.5, not 0.5: FP4 measured that 0.5 held about once a second on the 20-120 ms spec
  network (arrivals are handled on a rendered frame, so an offset can read a whole tick later than any measured);
  1.5 held not once after the warm-up (99.7 % of frames step one tick at 60 fps; unpaced 0 %).
- `PlayoutPacer.frame` takes `(now, frameDt, stepped, queued, maxCatchup)` (above); arrivals commit on the next frame.
- A hold freezes at most half a tick behind the newest state, not at alpha 1 (Design 3), so playout resumes mid-tick;
  a hold longer than `fastForwardTicks` past the target is fast-forwarded (Design 3's fast slew only between
  `fastSlewTicks` and it). The lead's depth (Design 5) has hysteresis and a cap.
- The effective lead is `inputLead()` (above); the arrival log has no per-window holds (totals only).

## Tasks

- [ ] **FP0 [owner]. Measure a real session.** Build FP5's arrival log first (debug only, nothing else changes): in
  a private published place with 2-4 friends, KV_Debug on, record per client: ping, batch inter-arrival times and
  sizes, offset spread (p50 / p95 / max), render fps, effective lead over time. Once with `BROADCAST_EVERY_TICKS` 1 if
  possible. -> Verify: a table in docs/SPIKES.md "Frame pacing"; the tunables above confirmed or edited.
- [x] **FP1. Fix the lead.** A step whose target is at or below `lastSentTick` sends nothing; `inputLead()` reports the
  effective lead. -> Verify: new lockstep spec: a spike raises the lead, the network calms, and **the effective lead
  falls back** to the floor after `leadDecayTicks` per step; a later spike's first miss raises it at once; the existing
  network runs still finish ranked with misses under a quarter; `latencyProbe.spec` updated ("press steps lead + 1
  ticks later" holds for the effective lead).
- [x] **FP2. `PlayoutPacer` (pure).** `shared/lockstep/pacer.ts` + `PACING` + barrel. -> Verify: `pacer.spec.ts` on
  synthetic arrival traces: steady arrivals step exactly one tick per 16.7 ms at 30 / 60 / 144 fps; alpha strictly
  increases within a tick and stays in [0, 1); a late batch makes one hold, then no jump past `maxCatchup`; depth
  follows the 95th percentile, not a single outlier; slew within `slewShare`; a 0.5 s client hitch catches up without
  touching P; hitched-frame arrivals are ignored.
- [x] **FP3. LockstepClient wiring.** `pacing` tunable, `now` on `receive` / `pump`, alpha, `depthTicks` in the lead.
  -> Verify: every existing lockstep spec passes unchanged with pacing off; the simulated-network runs
  (`NET_RUNS`, 20-120 ms and 0-200 ms one way) pass with pacing on: identical final state on every client, the log
  validates, misses under a quarter.
- [x] **FP4. Smoothness metric in the spec harness.** The `Net` harness renders at a chosen fps and records, per
  client and frame, the ticks stepped and the alpha. -> Verify: with pacing on, at 60 fps and 20-120 ms jitter, at
  least 99 % of frames step exactly one tick and holds stay under 1 per 10 s; with pacing off the same run shows
  today's pattern (the spec logs both, so the gain is measured).
- [x] **FP5. SimController and diagnostics.** `os.clock()` into `receive` / `pump`; `KV_PacingOff`; the debug line's
  pacing part and effective lead; the arrival log for FP0 (KV_Debug only, printed every 10 s). -> Verify:
  `npm run verify`; Studio two-player test (Test > Clients and Servers) runs, the debug line shows depth 3 and no
  holds on loopback. (Built and verified headlessly; the Studio two-player check is pending.)
- [ ] **FP6 [owner]. Playtest.** The FP0 group again, pacing on vs `KV_PacingOff`, on a 60 Hz and a 120 Hz+ screen and
  one phone if possible. -> Verify: players notice the difference; holds per minute and depth recorded; tunables
  adjusted.
- [ ] **FP7 (optional). Broadcast cadence.** Only if FP0 / FP6 point to it: `BROADCAST_EVERY_TICKS` 1, the input and
  hash rate limits re-checked. -> Verify: the network specs and the replay bench pass; FP6's numbers improve.
- [x] **FP8. Docs.** docs/SERVER.md "Clients" (pacing, the effective lead), docs/FEEL.md J9 (debug line), CLAUDE.md's
  decision log entry, this file's status.

Order: FP1 (ship alone) -> FP5's arrival log -> FP0 -> FP2 -> FP3 -> FP4 -> FP5 -> FP6 -> FP7? -> FP8. FP2 can start
before FP0's numbers; only the tunables wait for them.

## Testing

- **Headless:** the pacer on synthetic traces (FP2), the lockstep network runs with pacing on and the smoothness
  metric (FP3, FP4), the lead fix (FP1). The harness's `Channel` already gives random latency with ordered delivery.
- **Studio:** Test > Clients and Servers proves the wiring, not the network (loopback). Studio's Network setting
  "Incoming Replication Lag" adds a fixed delay only, no jitter: useful for the lead, not for holds.
- **Published place:** the only real test of jitter, Roblox's batching, phones and high refresh screens (FP0, FP6).

## Risks

- **The client's own hitches look like jitter.** Floor changes rebuild views (deferred one item per frame, but some
  items are heavy) and the sim catch-up itself costs frame time on phones. Mitigation: hitched frames are left out of
  the windows (Design 3); if FP0 shows phones still inflating the depth, cap the depth per device class.
- **Head-of-line blocking.** A lost packet on a reliable remote delays every later batch; the buffer absorbs short
  ones, long ones still hold. Unreliable remotes would need a resend scheme on the wire: out of scope.
- **Feels slower to the press.** 50-83 ms more input delay. FP6 checks players prefer it; there is no setting
  (FPD8), so if they do not, the fix is the tunables (or local prediction sooner).
- **Drafts and the stage cover.** Both keep stepping as today (the draft freezes the world inside the sim); a draft
  confirm reaches the server D ticks later, which only matters to the "waiting for N teammates" line.

## Revision 2: the lead from measured trips (FP9-FP16, planned)

The net lead is still today's miss counter: +1 tick per missed deadline, -1 after 10 clean seconds. Revision 2 sets it
from **measured round trips** instead: the slowest 5 % of the last few seconds' trips plus a margin, raised at once,
brought back down within seconds with a little slack so it does not bounce. It ends the two things the playtest felt:
**a delay that lingers** (up to 500 ms for minutes after one spike) and **dropped inputs** (presses lost to the server's
repeat-last while the lead climbs, or after it decayed below what the network needs).

**Client timing plus one small wire field.** No sim, dungeon, hash, replay, fixture, score or log change: the client
still steps exactly the merged log; what changes is which future tick its inputs are sent for. The server gains a
per-player **input echo** on `lockstepFrames` (how early each player's newest input reached it), which never enters the
log, the validator or a hash (FPD9). Solo runs are untouched.

### Status (2026-11-09)

**Built: FP9-FP13 and FP16** on branch `frame-pacing-lead` (from `main` @ `d007b503`), verified headlessly (typecheck,
lint, asset / AutoLocalize checks, l10n tests, build, the full Lune suite: 430 suites, the only failure the known x86
`forge.spec` NaN-bit vector). **Pending: FP14 / FP15 (owner: a measured real session with FP0, then the playtest with
FP6) and the Studio checks** (per-member fires in a two-player session, FP13's loopback / replication-lag check). See
"As built (FP9-FP13)" for the real API and the deviations; the tunables stay provisional until FP14.

### Why the lead lingers and drops inputs (findings)

| Fact | Where | Consequence |
|---|---|---|
| A miss is seen only when the finalized frame **differs** from the frame sent (`inputsEqual(mine, finalized)`) | client.ts `checkDeadline` | A late input that repeats the previous one counts as **clean**. The client cannot see it is late until the input changes, and that changed input (a press, a turn) is the one dropped |
| The lead decays by one after `INPUT_LEAD_DECAY_TICKS` (600) "clean" ticks, never below `INPUT_DELAY_TICKS` 3 | client.ts `checkDeadline`, config.ts | With invisible lates counted as clean, it can decay below what the network needs: the next press misses, the lead climbs back, and the cycle repeats every 10 s of steady input |
| One tick down per 10 s | same | After a spike to `MAX_INPUT_LEAD_TICKS` 30 (500 ms), getting back to 10 ticks takes 200 s: **the lingering delay** (FP1 made the effective lead actually fall; it still falls this slowly) |
| One tick up per miss | same | A spike that needs 10 more ticks costs at least 10 dropped inputs on the way up; every changed input during a head-of-line hold (one lost packet holds every later batch) is one more miss and one more tick, so the lead overshoots what the spike needed |
| Nothing measures the round trip | client.ts, session.ts | The lead learns the network only by losing inputs to it |
| The server knows exactly how early every input arrived: `relay.submit` sees the target tick and `finalizedTicks()` | relay.ts `submit` (`late` stats per player) | The measurement exists on the server; the client is never told |
| The deadline needs: finalize T -> batch wait -> down -> the client's buffer (depth) -> the client's frame -> up -> before the server finalizes T + lead | session.ts `step`, client.ts `pump`, Design 5 | The lead must cover the whole loop, not only the network ping |
| Inputs are neutral under the stage cover and through its fade | docs/STAGE_LOADER.md | Lates in a run's first second (before any trip is measured) repeat a neutral input: they cost nothing |

`Player:GetNetworkPing()` was considered (FPD10): it is a smoothed network-only estimate, without the server's batch
wait, its Heartbeat, the remote queues, the client's frame or the buffer. The lead would have to model those; the echo
measures the actual path.

### Design 9. A trip

A **trip** is one input's round trip on the real path, in ticks: from the client stepping the frame after which it sent
the input, to the server receiving it. Both ends are counted in ticks, so the server-client clock difference never
enters.

- **Client, at send** (`pump`, per target tick X): `sentAt[X]` = `state.tick` when X was sent, and `depthAt[X]` = the
  pacer's raw depth then (`P - base`, ticks, not the whole-tick `depthTicks()`); `hitched[X]` when the send happened in a
  hitched or catching-up frame (`PacingStats.hitched` / `catchingUp`, or `dt > PACING.hitchFrameSec` without pacing).
  Kept in `sent` beside the frame (already a map tick -> frame), dropped at `checkDeadline` as today.
- **Server, at receipt** (`submitInput(userId, firstTick, data, now)`): for the batch's newest tick X, the receipt
  position `R` = `finalizedTicks() + clamp(pos - finalizedTicks(), 0, 1)`, `pos = (now - startedAt) x SIM_HZ`. A stalled
  server's backlog (pos far past finalized) does not count against the client: the input really is early against the
  ticks still to finalize.
- **Slack** `= X + 1 - R`: how many ticks before its deadline X arrived (X is finalized by the first step with
  `floor(pos) >= X + 1`). Late = the relay counted it late (`SubmitResult.late > 0`); a late input has slack <= 0.
- **Echo:** every broadcast carries, **for its recipient only**, the input received from them since the last
  broadcast with the LOWEST slack (as built; the plan said the newest, which read about a tick short): X (as an offset from the batch's `firstTick`), slack (1/16 tick, signed 16-bit, saturating) and the late
  frames since the last echo (u8, saturating); or a "none" marker. Encoded by `wire.ts` `encodeInputEcho` /
  `decodeInputEcho` (8 bytes a batch: 240 B/s per client at 30 batches a second, whatever the party size). A new
  trailing argument of `lockstepFrames` (`echo: buffer`). The merged `data` stays the same bytes for everyone; the
  service fires `lockstepFrames` once per member (`fire(player, ...)`) with that member's echo instead of once to the
  party (FPD14), so no client ever receives a teammate's slack. A malformed echo is ignored (the frames still apply, the
  client falls back to `inputsEqual` misses), never fatal like a broken merged batch.
- **Client, on the echo:** `netTrip(X) = (X - sentAt[X]) - slack - depthAt[X]`: the lead X was sent with, minus what
  it had to spare, minus the buffer. An input is in time exactly when its lead (without the buffer) is above its net
  trip; the buffer is the pacer's and is added separately as today (Design 5, FPD12). A sample from a hitched send is
  dropped from the window (the client's own stall is not the network's), but its late still counts (below).

### Design 10. The lead from the trips (pure, `shared/lockstep/lead.ts`)

A `LeadController` owns the net lead; LockstepClient asks it instead of `checkDeadline`'s counter. `nextInputTick()`
stays `state.tick + netLead + depthTicks()` (Design 5), and FP1's send rules are unchanged (a target already sent sends
nothing; a target that jumps leaves the gap to the server's repeat-last).

- **Window:** the net trips of the last `LEAD.windowSec` (5 s; ~150 samples at 30 echoes a second).
- **Target** `L* = clamp(ceil(p95(netTrip) + LEAD.marginTicks), minLead, maxLead)`: the slowest 5 % of recent trips
  (`LEAD.percentile` 0.95, nearest rank like `ArrivalLog`) plus `marginTicks` (1.5: the receipt and the client's send are
  both on whole frames). `minLead` = `INPUT_DELAY_TICKS` 3, `maxLead` = `MAX_INPUT_LEAD_TICKS` 30 (lead + depth 42 stays
  inside `MAX_INPUT_AHEAD_TICKS` 120).
- **Up at once.** When `L*` passes the lead, the lead jumps to it the same frame: no input is lost to a lead climbing one
  miss at a time.
- **A late bumps to what it measured.** An echoed late (or, without an echo, an `inputsEqual` mismatch) raises the lead
  to `max(lead + 1, ceil(netTrip(X) + marginTicks))` at once and restarts the fall hold. A late is a trip past the
  window's p95; the bump keeps the next inputs from following it.
- **Down within seconds, with slack.** The lead falls only while the **fall target**
  `ceil(p95(netTrip) + marginTicks + LEAD.fallSlackTicks)` (0.75 more) is below it continuously for `LEAD.fallHoldSec`
  (1 s), then by one tick every `LEAD.fallStepSec` (0.25 s) while that holds. A trip p95 sitting at a tick boundary sits
  inside the 0.75 band and changes nothing; a spike that left the window (5 s) is gone from the lead about 1 + 0.25 x
  ticks later: 30 -> 10 ticks in ~6 s (today 200 s).
- **Warm-up.** Before `LEAD.minSamples` (20) trips are in the window the target is `ceil(max(netTrip so far) +
  marginTicks)` and nothing falls; before the first echo, `INPUT_DELAY_TICKS` (the warm-up's lates are under the stage
  cover: neutral repeats).
- **Old servers / no echo.** No echo for `LEAD.echoTimeoutSec` (2 s) while frames arrive: today's rule
  (`inputsEqual` +1, -1 after `leadDecayTicks`), so a client never runs blind on a server that does not echo.
- **The drop on a fall.** A fall of one tick skips one sample (FP1). A press held for one frame only would vanish with
  it: the skipped sample's buttons are OR-ed into the next frame sent (`pendingButtons`), so a tap becomes a one-tick
  hold one tick later, never nothing. Axes take the newer sample.

`LeadController` API: `sent(target, sentAt, depthRaw, hitched)`, `echoed(target, slack, lates, now)`,
`mismatch(now)` (the `inputsEqual` fallback), `frame(now)` (holds / steps the fall), `lead()`, `stats(): LeadStats`
(`lead`, `target`, `fallTarget`, `tripP50`, `tripP95`, `tripMax`, `samples`, `lates`, `bumps`, `falls`, `echoing`).
Pure numbers; nothing reaches the sim.

### Design 11. Diagnostics (KV_Debug)

- **Debug line** (docs/FEEL.md J9): `co-op lead {lead}t {ms}ms (net {net}t, trip p95 {p95}ms) · ...`; `late {n}` now
  counts echoed lates (the truth), `miss` keeps the `inputsEqual` mismatches. Only the local player's own numbers:
  clients never see a teammate's (FPD14); who lagged is on the server's end line.
- **Arrival log** (FP0's instrument): each `[Pace]` line gains `trip p50 {ms} p95 {ms} max {ms} · lead {lead}t target
  {L*}t fall {Lf}t · lates {n} bumps {n} falls {n}`.
- **Server:** `LockstepSession.inputStats(i)` (slack p50 / p95, lates) for the run's end log line (`LOCKSTEP_DONE`), one
  line per player, so a playtest's lates are on the server log too.

### Design 12. A/B switch

`LockstepTunables.lead: LeadTunables | undefined` (`DEFAULT_LOCKSTEP.lead` = `LEAD`; undefined = today's miss counter,
which every older spec that pins it passes). `KV_LeadOff` (Workspace attribute, read at each co-op start like
`KV_PacingOff`) builds the client with `lead: undefined`, for FP6's playtest. The server always echoes.

### Tunables (`LEAD`, shared/lockstep/config.ts)

| Name | Value | Why |
|---|---|---|
| `windowSec` | 5 | Follows a changing network within seconds; ~150 samples for a stable p95 |
| `percentile` | 0.95 | The owner's "slowest 5 %": one outlier is one late (bumped at once), not a lasting delay |
| `marginTicks` | 1.5 | The receipt and the send are on whole frames (the pacer's `marginTicks` reasoning); FP11 retunes it to the lates target |
| `fallSlackTicks` | 0.75 | Hysteresis: a p95 wobbling round a tick boundary never moves the lead |
| `fallHoldSec` / `fallStepSec` | 1 / 0.25 | Down within seconds: 20 ticks of excess gone in ~6 s, one skipped sample per 0.25 s |
| `minSamples` | 20 | ~0.7 s of echoes before the p95 is trusted |
| `echoTimeoutSec` | 2 | No echo for this long while frames arrive: today's rule |
| `recordTicks` | 120 | As built: the ring of sent targets the echoes are matched against (2 s of sends) |
| `echoCatchUpTailTicks` (LockstepTunables) | 42 | As built: a batch whose first tick is within this of the server's last capped (catch-up) step is flagged `catchingUp` (`maxInputLead` + `maxDepthTicks`) |

All provisional until FP0 / FP6 (and FP11's spec numbers).

### Decisions (FPD9-FPD13 proposed; FPD14 the owner's answer, 2026-11-09)

- **FPD9. The server echoes; a small wire change.** One trailing `lockstepFrames` argument, server -> client only,
  outside the log, the validator and every hash. Revises FPD1 (client only) for the lead: the server is the only place
  that sees how early an input arrived. Considered: client-only estimates (below).
- **FPD10. Trips of the real inputs, not a ping.** `GetNetworkPing` or a separate ping remote measure the network only;
  the deadline also waits on the server's batch, its Heartbeat, the client's frame and the buffer. The echo includes all
  of them and needs no model. A ping can still be printed beside it under KV_Debug.
- **FPD11. p95 + 1.5 ticks, raised at once, lowered after 1 s by a tick per 0.25 s.** The owner's brief. The lates
  target (FP11) is under 0.5 % of ticks after the warm-up on the spec networks.
- **FPD12. The buffer stays a separate part** (Design 5): trips are measured without it, so a deeper buffer still raises
  the lead the same frame and a shallower one lowers it without waiting on the trip window.
- **FPD13. A tap is never lost to a fall** (`pendingButtons`). A sim input change only in what the client sends: the
  log is still the log.
- **FPD14. Each client gets only its own echo** (owner, 2026-11-09). One `fire` per member per batch, each carrying
  that member's echo beside the shared merged bytes. The number of calls each client receives is unchanged (one per
  batch); the server makes n fires a batch instead of one fire to a list. Teammates' latency stays server-side
  (`inputStats(i)` on the run's end line). Considered: everyone's echo in one shared fire (a "who lags" debug view, but
  every client would receive every teammate's slack); a separate echo remote (twice the calls each client receives).

Open owner calls: FPD9 (the wire field) and FPD11's numbers (how fast down; the lates target).

### As built (FP9-FP13)

**API (shared/lockstep).**

- `wire.ts`: `InputEcho { tick: number | undefined; slack; lates; catchingUp? }`, `encodeInputEcho(echo, firstTick)` /
  `decodeInputEcho(data, firstTick)` (undefined = malformed). Fixed `INPUT_ECHO_BYTES` 8: u8 flags (bit 0 has a tick,
  bit 1 the server was catching up; other bits refused), i32 tick offset from the batch's `firstTick`, i16 slack in
  1/`INPUT_ECHO_SLACK_SCALE` (16) tick, saturating, u8 lates, saturating.
- `session.ts`: `submitInput(userId, firstTick, data, now?)` (`RunSessionService` passes `os.clock()`, the clock
  `startedAt` uses; without `now` R = `finalizedTicks()`). Per player the WORST frame since the last echo is kept: a
  batch's first frame (slack `firstTick + 1 - R`, the lowest in the batch), replaced only by a strictly lower one;
  lates accumulate; refused-only, malformed and non-member batches record nothing. `MergedBroadcast.echoes[i]` (one
  buffer per player index; the first broadcast after a record carries it, later ones "none"). Echo windows that
  overlapped the server's own catch-up (`due > maxTicksPerStep`, a receipt with `pos - finalized > maxTicksPerStep`, or
  a batch within `echoCatchUpTailTicks` of the last capped step) set `catchingUp`. `inputStats(i)` (batches, lates,
  slack min / mean) goes to the server log as `LOCKSTEP_INPUT run <id> player <userId>: batches .. lates .. slack min
  ..t mean ..t` once per run (`RunSessionService.forgetLockstep`, every exit path). The service fires `lockstepFrames`
  once per present member with `b.echoes[i]` (FPD14).
- `lead.ts` `LeadController(tunables, minLead, maxLead, legacyDecayTicks)`: `sent(target, sentAt, depthRaw, hitched,
  depthUsed = depthRaw)`, `received(now)`, `echoed(echo, now)`, `deadline(matched, now)`, `frame(now)`, `lead()`,
  `echoing()`, `stats(): LeadStats` (lead, target, fallTarget, tripP50 / P95 / Max, samples, warmingUp, lates,
  mismatches, bumps, raises, falls, excused, echoing). The lead starts at `minLead`.
- `LockstepClient`: `receive(firstTick, data, now?, echo?)`, `pump(dt, sample: InputSampler, now?)` with
  `InputSampler = (sending: boolean) => InputFrame` (a sample that is not sent is latched, never recorded by the
  latency probe as a send), `mismatches` (the old `inputsEqual` count), `misses` (echoed lates while echoing, plus
  mismatches while not echoing, counted once across the switch), `leadStats()`, `isLeadMeasured()`, `latchedButtons()`.
  The controller's clock is the pacer's (`now`, else the last clock + dt); a client never given a clock feeds no echo and
  stays on the legacy rule. `PlayoutPacer.rawDepthTicks()` / `unsteady()`.
- `LockstepTunables.lead` (`DEFAULT_LOCKSTEP.lead` = `LEAD`; undefined = today's miss counter exactly, no tap latch).
  `KV_LeadOff` (`RUN_ATTRIBUTES.leadOff`) is read in `startCoop` next to `KV_PacingOff` (they combine) and prints
  `[Sim] co-op run <runId>: measured lead off (KV_LeadOff)`.
- Diagnostics: the debug line `co-op lead {lead}t {ms}ms ({net part}) · {pace} · press->step ... · late {late} miss
  {miss}` with `{net part}` = `net {n}t, trip p95 {ms}ms` (`hud.debug.lead`), `net {n}t legacy` (`.leadLegacy`, warm-up
  or no echo) or `net {n}t, lead off (KV_LeadOff)` (`.leadOff`); `late` = `misses`, `miss` = `mismatches`. The `[Pace]`
  line ends with `trip p50 {ms} p95 {ms} max {ms} · lead {l}t target {L*}t fall {Lf}t · lates {n} bumps {n} falls {n}`
  (or `lead legacy` / `lead off`), and its `miss` is `mismatches`. A tap latched across a frame keeps its press time in
  the probe.

**Deviations from the design.**

- The echo carries the worst (lowest-slack) frame of its window, not the newest: the newest read about a tick short
  (two frames arrive per broadcast and the older one waited longer); with it the lead sits at or above the every-frame
  oracle instead of a tick under it, at about 1.5 ticks (25 ms) more lead and zero lates on both spec networks.
- 8 bytes, not 5 (an i32 tick offset and a flag byte).
- While echoing, a mismatch only counts; only echoed lates bump (Design 10's text; the first build bumped both, which
  doubled spike peaks).
- The late bump is `max(lead, ceil(trip + margin), sentLead + 1)` (`sentLead` = the lead when that tick was sent): the
  same as the design's for a real late, but no double bump for several lates sent before the first bump.
- A late is EXCUSED (counted in `lates` / `excused`, no bump, no window entry) when it came from an unsteady send
  (paced: a hitched / catching-up / fast-forwarding frame; unpaced: `dt` or the clock since the last pump over
  `hitchFrameSec`, or a pump that started with or left a backlog past `maxCatchup`), from an echo flagged
  `catchingUp`, or from a send whose raw buffer depth exceeded the depth the lead covered (`depthUsed`, the 12-tick cap)
  by at least the late's overshoot. Design 10 bumped hitched lates one tick.
- Any decodable echo, "none" included, keeps the controller echoing; it falls back to the legacy rule only after
  `echoTimeoutSec` without one while frames arrive.
- After a fall the lead rests on the fall target, `L*` or `L* + 1` (Design 10's literal rule): about 0.75 tick above
  `ceil(p95 + margin)` on average.
- Up-at-once also runs in `frame` (samples leaving the window can raise the p95).

**Measured (spec harness, paced, a 1 s stage cover; measured lead vs the legacy rule on the same network).**

| Network | Lead after 2 s, measured | Legacy | Relay missed / late after 2 s, measured | Legacy missed |
|---|---|---|---|---|
| 3 players, 20-120 ms one way | 11-12 (trip p95 9.5 t) | 15.6-17.6 | <= 0.22 % / 0 | <= 0.22 % |
| 8 players, 0-200 ms one way | 15.0-16.6 (trip p95 13-14.5 t) | 21.6-24.6 | <= 0.43 % / 0 | 0.52-0.93 % |

The relay misses left are never-sent ticks (a rise of the lead or the depth leaves the gap to the server's repeat-last:
FP1's rule, kept). The lead is more than one tick below the every-frame oracle (from the harness's own timestamps) in 0 %
of samples. FP1's latency step (calm 3 ticks, a spike): peak 18, back at 3 in 9.55 s (bound 10.25 s); the legacy rule
falls 10 s a tick (~240 s). Tap latch: every skipped sample's buttons reached the log. FP12, up channel, 3 players:

| Trouble | Peak (bound) | Back within 1 tick | Dropped changed inputs (legacy) |
|---|---|---|---|
| +200 ms for 1 s | 21-22 (23-24) | 8.1 s, inside the fall bound 9.0-9.25 s; legacy never | 39 (39) |
| 300 ms head-of-line hold | 27 (28) | 4.4-4.6 s; legacy never | 19 (12): legacy met it 5-7 ticks higher |
| 3 s server stall | paced 12-13 (before 11-12; the trips after the catch-up are really longer), unpaced unchanged | at the end within 1 tick | legacy ends at 30 |
| Unpaced client: one 3 s frame / a 300 ms stall between pumps | 17 / 17 (before 16; was 30 before the excuse rules) | at once | |

FP12's Verify was changed to the design's own bound (`windowSec + fallHoldSec + fallStepSec x excess + 0.5 s`): 8 s
cannot be met with a 5 s window. The hold's "dropped <= legacy" is printed, not asserted (above).

### Tasks

- [x] **FP9. The echo (server + wire).** `submitInput(..., now)` records each player's newest tick and slack;
  `LockstepStepResult.echoes` per broadcast (one buffer per player); `encodeInputEcho` / `decodeInputEcho`;
  `lockstepFrames` gains `echo`; RunSessionService passes `os.clock()` and fires each member their own echo;
  `inputStats(i)` on the run's end line. -> Verify: `wire` spec
  round trips (none, saturation, malformed refused); a session spec: an input sent k ticks early echoes slack k (+/- the
  receipt fraction), a late one slack <= 0 and a late count; a stalled server (`now` jumps 3 s) echoes positive slack for
  inputs ahead of `finalizedTicks()`; every NET_RUN still finishes ranked with identical logs and verdicts.
- [x] **FP10. `LeadController` (pure).** `shared/lockstep/lead.ts` + `LEAD` + barrel. -> Verify: `lead.spec.ts` on
  synthetic trip traces: steady trips of 6 +/- 1 ticks hold the lead at `ceil(p95 + 1.5)` with no change in 60 s; a
  step from 12 to 4 ticks is back on the new target within `windowSec + fallHoldSec + 0.25 x 8` s; a step up is followed
  the same frame; one 30-tick outlier bumps once and is gone ~6 s later; a p95 at x.0 / x.5 / x.9 never bounces; a late
  bumps to its own trip; warm-up and no-echo fallback; hitched samples ignored, their lates counted.
- [x] **FP11. LockstepClient wiring.** `sent` keeps `sentAt` / `depthAt` / `hitched`; `receive(..., echo?)`;
  `nextInputTick` from the controller; `pendingButtons`; `misses` = echoed lates, `mismatches` the old count;
  `leadStats()`. -> Verify: every lockstep spec passes unchanged with `lead: undefined`; with `LEAD`: the NET_RUNS
  (20-120 / 0-200 ms one way) finish with identical state and logs, the lead within one tick of an oracle (`ceil(p95` of
  the true trips from the harness's timestamps `+ 1.5)`) after the warm-up, relay `missed` per player under 0.5 % of
  ticks after the first 2 s; FP1's latency-step spec: falls back within the bound above (today: 10 s a tick); a tap
  sampled on a fall's skipped tick reaches the log; both measured beside the old rule (the spec prints both).
- [x] **FP12. Spike spec.** The harness's `Channel` with a 1 s spike (+200 ms one way) and a 300 ms head-of-line hold
  mid-run. -> Verify: changed inputs dropped during the spike at most the old rule's (printed), the lead's peak at most
  `ceil(spike trip + 1.5)` + 1 (the old rule's printed), back within one tick of the pre-spike lead within the fall's
  own bound `windowSec + fallHoldSec + fallStepSec x excess + 0.5 s` of the spike's end (was 8 s: see As built).
- [x] **FP13. Diagnostics.** The debug line, the arrival log's trip columns, `KV_LeadOff`, the server end line (Design
  11-12). -> Verify: `latencyProbe.spec` / `arrivalLog.spec` updated; `npm run verify`; Studio two-player test (Test >
  Clients and Servers) shows trips on loopback and the lead at `minLead`; with Studio's incoming replication lag at
  100 ms the lead settles near `ceil(trip + 1.5)` and no `late`. (Built and verified headlessly; the Studio check is
  pending.)
- [ ] **FP14 [owner]. Measure (with FP0).** FP0's session with FP13 in: trips p50 / p95 / max per client, lates,
  bumps, falls; once with `KV_LeadOff`. -> Verify: docs/SPIKES.md "Frame pacing" table gains the trip columns; `LEAD`
  confirmed or edited.
- [ ] **FP15 [owner]. Playtest (with FP6).** Lead on vs `KV_LeadOff`. -> Verify: no lingering delay after a spike, no
  lost presses noticed; lates per minute recorded.
- [x] **FP16. Docs.** docs/SERVER.md "Clients" (the echo, the measured lead), docs/FEEL.md J9 (debug line),
  CLAUDE.md's row and decision log entry, this section's status.

Order: FP9 -> FP10 (parallel) -> FP11 -> FP12 -> FP13 -> FP14 / FP15 -> FP16. FP10 needs nothing from FP9.

### Risks

- **The margin trades delay for lates.** 1.5 ticks on top of the p95 may still leave ~1-3 % of trips late on a very
  jittery network; each is bumped at once, but the input that was late is lost (repeat-last). FP11's oracle and lates
  numbers, then FP14, set the margin; raising it to 2 costs 17 ms.
- **A falling lead on a lossy link.** Head-of-line holds come in bursts; a 5 s window can forget the last one just
  before the next. The late bump keeps the cost to one input per burst; if FP14 shows repeated bursts, lengthen the window
  or keep the max of two windows.
- **Per-member fires.** The merged bytes no longer go out in one fire to the party, but in one fire per member (FPD14).
  The bytes each client receives grow by 8 a batch; the server's fire calls grow from 1 to n a batch (n <= 8). FP9's
  Studio check confirms the members still receive their batches in order (each member's calls stay ordered on their own
  reliable remote, which is all the client needs).
- **Local prediction** (docs/LOCAL_PREDICTION.md) predicts up to the effective lead, capped at 20 ticks
  (`PREDICTION.maxTicks`, LPD4; 10 until 2026-11-10): a lower, steadier lead helps it directly; nothing there changes.

## Revision 3: a steady lead on jittery links (FP17-FP22)

On the owner's Studio run with the simulated 4G network the measured lead hovered far above its own target and still
missed inputs. The co-op line read `lead 17t 283ms (net 13t, trip p95 159ms) · pace 4t 60ms · holds 16 · backlog 3 ·
press->step 700ms avg 422 max 700 n6 · late 374 miss 107 · pred 10t`; the `[Pace]` lines: trip p50 ~155 ms, p95
~160 ms, max 290-324 ms, net lead 17-19 ticks against a target of 11-12, 16-46 lates and 6-9 bumps every 10 s. Every
tick of effective lead past the prediction cap (`PREDICTION.maxTicks`, 10 then, 20 now) is delay you feel.

Revision 3 reproduces that in the spec harness and proposes a steadier rule, **the capped cover**: the lead follows the
trips' quantiles only, never a single late, and a second, longer window buys extra lead against the rare slow trips
**only up to what local prediction hides** (the prediction cap minus the buffer). On the owner-like links it keeps the
same lead as today with up to half fewer dropped inputs (none fewer on the harshest variant), a sixth to a quarter of
the lead changes and a third to a half of the felt delay at cap 20.

**Client timing only.** No sim, dungeon, hash, replay, wire, server, fixture or score change: only `LeadController`'s
rule and its tunables. The echo, the pacer, the send rules (FP1) and the tap latch are unchanged.

### Status (2026-11-10)

**Built: FP17-FP20 and FP22**, verified headlessly (typecheck, lint, build, the asset id and AutoLocalize checks, every
spec under `shared/lockstep`, `shared/view` and `shared/play`, and the full census with the `rule3` row). FP17 (the
census, `src/shared/lockstep/lead.census.spec.ts`, opt-in) on branch `lead-spikes` (from `local-prediction` @
`533af85`); FP18-FP20 and FP22 after the owner's answers (2026-11-10: FPD15, FPD16 and FPD17 accepted; FPD18 and FPD19
not answered, built as proposed). **Pending: FP21 (owner: the Studio 4G session again, once with `KV_LeadBump`).** See
"As built (FP18-FP20)" for the real API, the census numbers and the deviations.

### The census (FP17)

The real `LockstepClient`, `LockstepSession`, relay, pacer and echo, 2 players on M1 without enemies, 60 fps, the
harmless bot of `predict.net.spec` (walks, rolls, swings, guards; neutral under a 1 s stage cover), prediction off (it
is read only: it never changes what is sent), every number after a 2 s warm-up. A rule is put in place of each
client's controller after its construction: `SpecLead`, `lead.ts` copied with knobs. Its "today" configuration gives
exactly `LeadController`'s lead on every frame (asserted by the smoke run). The channels are `lockstep.spec`'s, FIFO
and drawn per 1/60 s slot, plus a spike chance per slot: a spiked slot's messages take 80-200 ms more and every later
message waits behind them (a head-of-line hold, as a lost packet's retransmit holds a reliable remote).

```
npm run test:only -- lockstep/lead.census                    # smoke: 12 s, today vs the copy (in every test run)
npm run test:only -- --census lockstep/lead.census           # every network x every rule, ~3.5 min (~5.6 min with
                                                              # FP19's rule3 and kvbump)
# split in two (the VM shell's 3 min cap): owner networks, then the rest
npm run test:only -- --census lockstep/lead.census --flag lead.owner --flag lead.owner2 --flag lead.ownerS
npm run test:only -- --census lockstep/lead.census --flag lead.jitter --flag lead.clean --flag lead.spec \
  --flag lead.spec200 --flag lead.fp12 --flag lead.longhold
# --flag lead.rule.<name> keeps only those rules (today's always runs)
```

Measured per network and rule: the **effective lead** (net + the buffer's depth, `inputLead()`) and the **net lead**
(mean / p95 / max over frames); **lates** (frames the server got after their tick, per 10 s per client); **dropped
changed** (a frame sent that differs from the one the relay finalized: what local prediction shows as a correction);
**relay missed** (repeat-last ticks, lates plus ticks never sent because the lead or the depth jumped past them);
**bumps**; **churn** (the net lead's total change per 10 s); **felt delay** `max(0, effective lead - cap)` per frame at
the caps 20 and 10 (mean / p95, ticks of 16.7 ms).

| Network | One way (each client its own two channels) |
|---|---|
| `owner` | 78-84 ms; 1.2 % of up slots +120-175 ms, 0.2 % of down slots; 62 s |
| `owner2` | the same, harsher: 2 % of up slots +100-200 ms |
| `ownerS` | `owner` on other channel seeds |
| `jitter` | 4G-like jitter: 50-130 ms; 0.4 % of slots +80-200 ms both ways |
| `clean` | 30-40 ms |
| `spec` / `spec200` | FP11's networks: 20-120 / 0-200 ms (gate FP11) |
| `fp12` | FP12's: 20-120 ms, +200 ms up for 1 s at 7 s (gate FP12) |
| `longhold` | 70-82 ms, one 600 ms up hold at 15 s (gate FP12's bound) |

**How close the reproduction is** (today's rule on `owner`; the owner's numbers were taken at cap 10):

| | Owner, Studio 4G | Census `owner`, today's rule |
|---|---|---|
| Trip p50 / p95 / max | ~155 / ~160 / 290-324 ms | 142-158 / 159-182 / 292-342 ms per 10 s window (276 ms p95 in one client's first window; whole run 158 / 175 / 342) |
| Net lead | 17-19 t at the `[Pace]` lines (13 t on the debug line) | 12-22 t at the 10 s marks; mean 16.9, p95 22, max 23 |
| Target L* | 11-12 t | 12-13 t |
| Buffer depth | 4 t (60 ms) | 3.9 t |
| Lates / bumps per 10 s | 16-46 / 6-9 | 25-28 / 9-10 in the first window, then 6-22 / 1-5 (mean 14.1 / 4.0) |
| Holds | 16 | 3-4 a minute per client |

The trips, the target, the depth and the hover far above the target match; the steady-state lates and bumps are about
half the owner's. Bursts on the owner's link more often ran past the lead the last burst left; two harsher variants
(`owner2`, and per-slot spikes of 3 %, not kept: their bursts lift the p95 itself to 300 ms, which the owner's p95 does
not show) did not raise the steady bump rate either. The ranking below is the same on all three owner-like networks.

### Why the lead hovers and still misses (findings)

| Fact | Where (census) | Consequence |
|---|---|---|
| A head-of-line burst reaches the server as one clump: the echo (the window's worst frame, Design 9) reports it as one or two samples | `owner`: per-window p95 159-177 ms while max is 292-342 | A burst barely moves the p95 (the owner's p95 is ~5 ms over the p50), but its lates bump the lead to the burst's own trip |
| The bump comes one round trip after the late input was sent: the burst is already over | every owner-like run | It protects only against the NEXT burst, if that comes before the fall (1 s, then 0.25 s a tick: 20 -> 12 in 3 s). That is the hover: the lead is the last burst's trip, decaying, and a bigger burst still misses |
| A one-off hold gains nothing from the bump | `longhold`: today jumps to 30 t (`maxLead`) and is back 5.3 s after the hold; the steady rules stay at 11 t | Identical lates (12.8) and dropped inputs (10.2) per 10 s: everything sent in the 600 ms is late at any lead under 36 t; today adds felt delay at cap 20 (mean 1.22 t, p95 11 t) |
| Every bump and fall is churn | `owner`: 36 ticks of change per 10 s (steady rules 4-9); never-sent ticks 3.8 % of ticks (steady rules 1.0-1.4 %) | A rise repeats the last input on the server for the ticks skipped; a fall skips a sample (latched). With prediction a rise also moves the predicted head k ticks ahead (the drawn knight lurches by k ticks of held input), a fall pulls it back |
| Under prediction, lead below the cap is not felt in your own movement; above it, it is | `owner`, today: effective 20.8 t mean, p95 27 | At cap 20 with a 4 t buffer, net lead up to 16 is free for the knight; today spends 2.1 t mean (p95 7) above it. At cap 10 everything above net 6 is felt |
| A late only bumps usefully when the trouble lasts longer than a round trip | `fp12` (1 s of +200 ms): today 11.3 lates / 10 s, the no-bump rules 20.3 | About 17 late frames per client per such spike are saved by the bump. At the first late a burst and a long spike look the same; telling them apart takes ~0.25 s of echoes, as long as the 5 s p95 needs to move on its own (5 % of ~150 samples) |
| A quantile alone is cheaper than a bump for the same lates | `owner`: p98 / 10 s with no bump: 17.6 net, 10.3 lates; today 16.9 net, 14.1 lates; p99 / 15 s: 19.9 net, 2.2 lates | A steady lead covers the bursts BEFORE they come; a bump covers them after |

### The candidates

| Rule | What it changes from today |
|---|---|
| `today` | `LeadController` with `LEAD` (Revision 2) |
| `k2` | A late bumps (to its trip) only on the 2nd late echo within 3 s |
| `plus1` | A late bumps one tick over the lead it was sent with, not to its trip |
| `nobump` | Lates never bump (the miss budget: only the p95 / 5 s target) |
| `p99w15` | No bump; the target from p99 / 15 s; falls after 0.5 s, 0.1 s a tick |
| `p98w10` | No bump; the target from p98 / 10 s |
| `cap20` | Today's bump, never past effective lead 20 |
| **`cov20`** | **The capped cover (proposed):** no bump; `max(p95 / 5 s, min(p99 / 15 s, 20 - depth))` + margin |
| `cov20m` | `cov20` with the cover from the window's max over 10 s |
| `cov20f` | `cov20`, falls after 0.5 s at 0.1 s a tick |
| `fast` | Today's bump, falls after 0.3 s at 0.05 s a tick |
| `cov20bf` | `cov20` plus today's bump (uncapped), falls after 0.3 s at 0.05 s a tick |

`cov10` (the cover capped at 10) equals `nobump` on every network here (10 - depth is below the base); `cov` (uncapped)
equals `p99w15` within 0.4 t; a cover with today's bump capped at 20 equals `cov20` within 0.2 lates / 10 s. They are left out.

**The owner-like link** (`owner`; `owner2` and `ownerS` in the appendix rank the same):

| Rule | Effective lead mean / p95 (t) | Net lead mean / p95 (t) | Lates / 10 s | Dropped changed / 10 s | Churn / 10 s | Felt @20 mean / p95 | Felt @10 mean / p95 |
|---|---|---|---|---|---|---|---|
| today | 20.8 / 27 | 16.9 / 22 | 14.1 | 8.2 | 36.3 | 2.10 / 7 | 10.79 / 17 |
| k2 | 19.8 / 26 | 15.9 / 22 | 16.2 | 9.5 | 25.7 | 1.66 / 6 | 9.81 / 16 |
| plus1 | 18.1 / 23 | 14.2 / 19 | 22.8 | 13.0 | 12.1 | 0.56 / 3 | 8.10 / 13 |
| nobump | 17.2 / 23 | 13.2 / 19 | 28.8 | 17.6 | 4.3 | 0.39 / 3 | 7.15 / 13 |
| p99w15 | 23.8 / 28 | 19.9 / 21 | 2.2 | 0.9 | 5.2 | 4.03 / 8 | 13.80 / 18 |
| p98w10 | 21.5 / 27 | 17.6 / 21 | 10.3 | 6.5 | 5.5 | 2.67 / 7 | 11.50 / 17 |
| cap20 | 18.9 / 23 | 15.0 / 19 | 19.6 | 10.8 | 20.7 | 0.57 / 3 | 8.90 / 13 |
| **cov20** | **20.4 / 24** | **16.5 / 19** | **11.3** | **4.4** | **6.2** | **0.61 / 4** | **10.40 / 14** |
| cov20m | 20.6 / 24 | 16.6 / 19 | 10.3 | 4.3 | 5.2 | 0.65 / 4 | 10.58 / 14 |
| cov20f | 20.2 / 23 | 16.2 / 19 | 12.8 | 5.4 | 8.5 | 0.44 / 3 | 10.15 / 13 |
| fast | 18.6 / 25 | 14.6 / 21 | 22.2 | 12.6 | 58.0 | 1.03 / 5 | 8.58 / 15 |
| cov20bf | 20.8 / 25 | 16.8 / 21 | 11.3 | 4.7 | 38.7 | 1.06 / 5 | 10.76 / 15 |

**Across the networks and the gates** (lates / dropped changed per 10 s / felt @20 mean; FP11 = no late after the
warm-up and relay missed under 0.5 % on `spec` and `spec200`; FP12 = peak at most `ceil(trip + 1.5) + 1` and back
within one tick within today's fall bound on `fp12` and `longhold`):

| Rule | owner2 | ownerS | jitter | fp12 | FP11 | FP12 (fp12, longhold) |
|---|---|---|---|---|---|---|
| today | 12.1 / 6.8 / 3.13 | 11.2 / 6.8 / 2.26 | 5.8 / 2.7 / 2.46 | 11.3 / 6.8 / 3.94 | pass | pass, pass |
| k2 | 15.5 / 7.5 / 2.61 | 14.8 / 8.5 / 1.90 | 7.2 / 3.4 / 1.75 | 11.8 / 7.6 / 3.93 | pass | pass, pass |
| plus1 | 22.2 / 11.2 / 1.63 | 22.2 / 12.2 / 0.73 | 6.8 / 2.8 / 1.29 | 20.3 / 13.9 / 3.58 | pass | pass, pass |
| nobump | 32.1 / 17.2 / 1.45 | 29.1 / 17.5 / 0.59 | 7.9 / 3.7 / 0.99 | 20.3 / 13.9 / 3.58 | pass | pass, pass |
| p99w15 | 2.0 / 1.2 / 5.83 | 0.9 / 0.3 / 4.38 | 3.4 / 1.2 / 3.55 | 13.7 / 8.7 / 7.09 | pass | **fail** (never back), pass |
| p98w10 | 5.2 / 3.0 / 4.27 | 8.8 / 4.5 / 3.08 | 5.8 / 2.3 / 1.83 | 16.6 / 10.5 / 5.94 | pass | **fail** (never back), pass |
| cap20 | 20.8 / 11.2 / 1.41 | 16.8 / 8.9 / 0.80 | 7.8 / 3.5 / 1.01 | 20.3 / 13.9 / 3.58 | pass | pass, pass |
| **cov20** | **14.2 / 6.8 / 1.55** | **9.8 / 3.6 / 0.86** | **7.6 / 3.5 / 1.01** | **20.3 / 13.9 / 3.58** | **pass** | **pass, pass** |
| cov20m | 14.2 / 6.8 / 1.55 | 9.2 / 3.5 / 0.86 | 7.6 / 3.5 / 1.02 | 20.3 / 13.9 / 3.58 | pass | pass, **fail** (the hold kept 10 s) |
| cov20f | 16.7 / 8.0 / 1.28 | 10.7 / 4.2 / 0.54 | 7.6 / 3.5 / 0.99 | 20.3 / 13.9 / 3.05 | pass | pass, pass |
| fast | 25.9 / 13.9 / 1.89 | 21.2 / 12.4 / 0.96 | 6.8 / 2.8 / 1.50 | 11.3 / 6.8 / 3.03 | pass | pass, pass |
| cov20bf | 13.6 / 6.6 / 1.93 | 8.3 / 3.6 / 0.97 | 6.8 / 2.8 / 1.50 | 11.3 / 6.8 / 3.03 | pass | pass, pass |

On `clean` no rule has a late; the cover rules sit at 7 t net instead of 6.2 (felt 0 at cap 20, 1 t at cap 10). On
`spec200` the buffer (11.9 t) alone puts every rule's effective lead at ~28 t (felt @20 ~7.8 t): the depth, not the
lead, is that network's cost. FP11 passes for every rule (0 lates, relay missed 0.17 % / 0.11 %, as today).

**Reading it.** `cov20` keeps today's lead on the owner-like links (effective 20.4 / 21.5 / 20.8 t against 20.8 / 22.4
/ 21.3), with 46 % / 0 % / 47 % fewer dropped changed inputs, a sixth to a quarter of the churn and 29-50 % of the felt delay
at cap 20. It pays where the bump helps: on `jitter` (+1.8 lates, +0.8 dropped per 10 s, felt halved) and in FP12's 1 s spike
(20.3 against 11.3 lates per 10 s, about 17 more late frames per client for the spike). `cov20bf` takes the bump back
for long spikes (FP12 at today's lates, faster back) but brings today's churn back on the bursts (38.7 / 10 s).
`p99w15` has the fewest lates on the burst links but about twice today's felt delay and never comes back after FP12's
spike; `nobump` and `plus1` have the least felt delay but 1.6-2.6x today's dropped inputs. At cap 10 the cover vanishes on these links
(10 - 4 is below the base): `cov20` becomes `nobump` (felt @10 7.15 against 10.79, lates 28.8 against 14.1).

### Design 13. The capped cover (pure, `shared/lockstep/lead.ts`)

- **Base** (today's target): `Lb = ceil(p95(trips of the last windowSec 5 s) + marginTicks 1.5)`, the warm-up's max
  rule unchanged.
- **Cover:** `Lc = ceil(p99(trips of the last coverWindowSec 15 s) + marginTicks)`.
- **Ceiling:** `C = PREDICTION.maxTicks - depthTicks()` (the prediction cap minus the buffer the lead adds, at the
  newest send), so `net + depth` never goes past the cap for the cover's sake. Without prediction
  (`LockstepTunables.prediction` undefined, `KV_PredictOff`) there is no cover.
- **Target** `L* = clamp(max(Lb, min(Lc, C)), minLead, maxLead)`; the **fall target** is the same with
  `fallSlackTicks` added to both quantiles. Up at once, down after `fallHoldSec` 1 s at a tick per `fallStepSec`
  0.25 s, exactly as today.
- **A late never bumps** while echoing (`LEAD.lateBump` false). Its trip enters both windows like any other, so a late
  that moves the p95 or the p99 raises the lead the same frame; a late is counted (`lates`, the debug line) and that is
  all. Excused lates (Revision 2's rules) are counted as before. The legacy rule without echoes is unchanged.
- **Stats:** `LeadStats` gains `coverP99`, `coverTarget` (Lc), `ceiling` (C); `bumps` stays (0 unless `lateBump`).

The cover is what turns a miss into a budget: above the prediction cap only the slowest 5 % of the last 5 s raise the
lead, so the rare bursts are let through as lates (each one a frame the relay repeats, a small correction of the drawn
knight); below it the slowest 1 % of the last 15 s are covered, for free as far as your own movement goes.

### Tunables (`LEAD`, additions)

| Name | Value | Why |
|---|---|---|
| `lateBump` | false | FPD15: a late no longer bumps; true restores Revision 2's bump (A/B, `KV_LeadBump`) |
| `coverWindowSec` | 15 | Long enough that the bursts of the last seconds are still in it (a 5 s window forgets them before the next) |
| `coverPercentile` | 0.99 | Under the cap p99 and the max (`cov20m`) measure the same on the owner-like links; the max also keeps a one-off hold's trip for the whole window (`longhold` fails) |
| ceiling | `PREDICTION.maxTicks` | Read from `LockstepTunables.prediction` by LockstepClient, passed to the controller (FPD16) |

`windowSec`, `percentile`, `marginTicks`, `fallSlackTicks`, `fallHoldSec`, `fallStepSec`, `minSamples`,
`echoTimeoutSec` and `recordTicks` are unchanged.

### Decisions (FPD15-FPD17 the owner's answers, 2026-11-10; FPD18-FPD19 proposed, built as proposed)

- **FPD15 (accepted, owner 2026-11-10). A late never bumps; the lead follows the trip quantiles only** (`LEAD.lateBump`
  false; `KV_LeadBump` builds Revision 2's bump for an A/B). The bump arrives a round trip after the late input left,
  after the burst; on the owner-like links it costs churn and felt delay for about the same lates. Considered: today's
  bump (`today`), after 2 lates (`k2`), +1 a late (`plus1`), today's bump with a fast fall (`fast`, `cov20bf`: the only
  way to keep FP12's long-spike lates, at today's churn). If the owner values long spikes over bursts, `cov20bf` is the
  alternative (FPD15b).
- **FPD16 (accepted, owner 2026-11-10). The cover: p99 over 15 s, never past the prediction cap minus the buffer.** Lead
  under the cap is free for your own knight but not for what is not predicted: hits landing, enemies reacting to you, a
  teammate seeing you. `cov20` spends 2-3 t more than `nobump` on the owner-like links for 56-66 % fewer lates.
  Considered: no cover (`nobump`), an uncapped p99 (`p99w15`: fewest lates, about twice the felt delay, fails FP12's
  back-within bound), the window's max (`cov20m`: keeps a one-off hold's trip for the whole window).
- **FPD17 (accepted, owner 2026-11-10: the cap stays 20). The cover follows `PREDICTION.maxTicks`.** At cap 20 (now) it
  buys ~3 t; at cap 10 it vanishes on a 4G-like link (the rule is `nobump` there: felt @10 7.15 against today's 10.79 t,
  lates 28.8 against 14.1 / 10 s). The cap is LPD4's (docs/LOCAL_PREDICTION.md); this rule takes whatever it is.
- **FPD18 (proposed, built as proposed). The gates.** FP11 and FP12 stay as they are (every proposed rule passes). New,
  on the census's owner-like networks against today's rule: felt delay at cap 20 at most half, dropped changed inputs at
  most today's, churn at most a third. Lates may rise where the bump did help (`jitter` +31 %, FP12's spike: printed,
  not gated).
- **FPD19 (proposed, built as proposed). Without prediction there is no cover** (`KV_PredictOff`, a debug A/B): every
  tick of lead is felt there, so only the base's p95 raises it.

### As built (FP18-FP20)

**API (shared/lockstep).**

- `LeadTunables` gains `lateBump` (false, FPD15), `coverWindowSec` (15) and `coverPercentile` (0.99), with doc
  comments in config.ts; every other `LEAD` value is unchanged.
- `LeadController(tunables, minLead, maxLead, legacyDecayTicks, ceiling?)`: `ceiling` in ticks of effective lead
  (undefined or not finite: no cover). Every trip that enters the base window (Revision 2's rules: not from an unsteady
  send, not from a catching-up echo) enters the cover window too, kept oldest first with an ascending copy maintained by
  binary insertion and removal (no sort and no allocation per echo; the base window is unchanged). The cover's p99 is
  read from that copy at every refresh. C = `ceiling - depthUsed` of the newest send (`sent`'s last argument), L* =
  `clamp(max(Lb, min(ceil(p99 + margin), C)))`, Lf the same with `fallSlackTicks` added to both quantiles; the cover is
  left out while the base window warms up (fewer than `minSamples` trips), before any cover trip, and without a
  ceiling. Up at once, the hold and the fall steps are Revision 2's. `lateBump` false: an echoed late that is not
  excused is counted (`lates`) and nothing else (no bump, no restart of the fall hold); excused lates are counted as
  before (`excused`); true: Revision 2's bump exactly. The legacy rule without echoes is unchanged.
- `LeadStats` gains `baseTarget` (Lb), `coverP99`, `coverTarget` (Lc) and `ceiling` (C); `bumps` is 0 unless
  `lateBump`.
- `LockstepClient` passes `tunables.prediction?.maxTicks` (FP19): `KV_PredictOff` (or any client without prediction)
  has no cover (FPD19).
- `KV_LeadBump` (`RUN_ATTRIBUTES.leadBump`, read in `startCoop` beside `KV_LeadOff`; ignored with it) builds the
  client with `{ ...LEAD, lateBump: true }` and prints `[Sim] co-op run <runId>: late bump on (KV_LeadBump)`.
- Diagnostics (FP20): the `[Pace]` line's lead part reads `lead {l}t target {L*}t (base {Lb}t cover {Lc}t cap {C}t)
  fall {Lf}t · lates {n} bumps {n} falls {n}` (`cover -` before any cover trip, `cap off` without a ceiling); the debug
  line's measured brackets read `(net {net}t, trip p95 / p99 {p95} / {p99}ms)` (`hud.debug.lead`, a developer string:
  English everywhere, no context entry; shared/view `LeadStatsInput.coverP99`, `LeadDebugView.tripP99Ms`,
  `leadDebugVars`' `p99`).

**Interpretations and deviations.**

- `LeadStats.baseTarget` is an addition to Design 13's list: the `[Pace]` line prints Lb. `coverTarget` is Lc clamped
  to [minLead, maxLead] like the other targets and before the ceiling, so the line shows both what the cover asks and
  what C allows.
- The cover window is kept (and its p99 printed) without a ceiling too, but never applied: a `KV_PredictOff` A/B still
  shows the trips' tail.
- In the warm-up the cover is left out of the fall target too (the census's copy left it in; only `stats()` reads the
  fall target in the warm-up, so the lead is the same: `rule3` = `cov20` on every frame below).
- `KV_LeadBump` sets only `lateBump`, as FP20 says; with prediction on the cover stays, so it builds the bump on top of
  the cover, not Revision 2's rule (that is `KV_LeadBump` with `KV_PredictOff`, which also turns prediction off). The
  census measures it as `kvbump` (below), for FP21.
- Spec assertions changed (each pinned to the bump or to the window the cover replaces): lockstep.spec FP12's hold
  asserted that the 300 ms hold raises the lead (`peak > before`); without the bump it does not move (its few echoes
  are under the top 5 % of the window), so the hold asserts `peak >= before` (the spike keeps `>`). The FP11 wiring
  test's bump count is 0 (a second test keeps the bump under `lateBump`). FP1's echoing scenario runs
  `DEFAULT_LOCKSTEP`, whose prediction gives the lead its ceiling: unpaced (depth 0) the spike's trips are under it and
  hold the lead until they leave the cover's 15 s window, so its bound uses `coverWindowSec` (back 19.92 s, bound 20.50
  s; was `windowSec`, 10.50 s). predict.net.spec's "prediction on and off: the same log" gives the off run's clients
  the same ceiling (a `LeadController` with `PREDICTION.maxTicks` put in place, as the census does): the predictor is
  still read only, but whether prediction is configured now sets the lead's ceiling (FPD19).
- lockstep.spec's network harness keeps `prediction: undefined` (its `TUNABLES`), so its FP11 / FP12 nets run
  Revision 3 without a ceiling (the `nobump` rule); the shipped rule with its ceiling is measured end to end by the
  census's `rule3` (the FP11 / FP12 gates in its table).

**Measured.** lead.spec (FP18's cases): one 15-tick late among steady 6 +/- 1 trips moves nothing for the cover window
(Revision 2 bumps it to 17 at once); five such lates within half a second move the p99 and raise the lead to 17 the
same echo, without a bump, until they leave the cover window; with 1 trip in 33 at 30 ticks the lead sits at the
ceiling (20 at depth 0, 16 at depth 4, 19 back at depth 1 as soon as a send carries it; the base when C is below
it); a step of the trips from 6 to 12 is followed in 0.17 s in one jump (unflagged or late); a step from 12 to 4 is back
in 7.28 s without a ceiling (bound 8.25 s) and 17.38 s with one (the cover's window; bound 18.25 s). lockstep.spec (no
ceiling): FP11 3 / 8 players mean lead 11.0-12.4 / 15.0-16.6 after 2 s, 0 lates, relay missed <= 0.22 % / 0.43 %;
FP12 spike: peak 21-22 (bound 23-24), back in 8.1-8.2 s (bound 9.0-9.25 s), dropped changed 79 (Revision 2's bump 39,
legacy 39); hold: no rise, dropped 19 (Revision 2 19, legacy 12).

**The census** (`npm run test:only -- --census lockstep/lead.census`, on the FP20 tree; today's rows and every FP17
candidate's are the appendix's exactly; `rule3` = `cov20` on every client frame of every network):

| Network | Rule | Effective lead mean / p95 (t) | Net lead mean (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean (t) |
|---|---|---|---|---|---|---|---|---|---|---|
| owner | today | 20.8 / 27 | 16.9 | 14.1 | 8.2 | 6.39 % | 4.0 | 36.3 | 2.10 / 7 | 10.79 |
| owner | **rule3** | 20.4 / 24 | 16.5 | 11.3 | 4.4 | 3.47 % | 0.0 | 6.2 | 0.61 / 4 | 10.40 |
| owner | kvbump | 21.9 / 27 | 18.0 | 7.5 | 3.2 | 4.42 % | 3.8 | 24.3 | 2.11 / 7 | 11.91 |
| owner2 | today | 22.4 / 27 | 18.5 | 12.1 | 6.8 | 6.09 % | 4.3 | 34.7 | 3.13 / 7 | 12.38 |
| owner2 | **rule3** | 21.5 / 25 | 17.6 | 14.2 | 6.8 | 4.20 % | 0.0 | 8.5 | 1.55 / 5 | 11.48 |
| owner2 | kvbump | 23.2 / 27 | 19.3 | 8.5 | 4.6 | 4.61 % | 4.2 | 26.5 | 3.26 / 7 | 13.19 |
| ownerS | today | 21.3 / 27 | 17.2 | 11.2 | 6.8 | 5.78 % | 4.2 | 36.9 | 2.26 / 7 | 11.33 |
| ownerS | **rule3** | 20.8 / 25 | 16.7 | 9.8 | 3.6 | 2.95 % | 0.0 | 6.5 | 0.86 / 5 | 10.78 |
| ownerS | kvbump | 22.1 / 27 | 18.0 | 5.7 | 2.8 | 3.75 % | 3.8 | 23.2 | 2.21 / 7 | 12.14 |
| jitter | today | 22.4 / 29 | 15.4 | 5.8 | 2.7 | 3.56 % | 2.4 | 16.1 | 2.46 / 9 | 12.44 |
| jitter | **rule3** | 21.0 / 25 | 14.0 | 7.6 | 3.5 | 2.42 % | 0.0 | 0.8 | 1.01 / 5 | 11.01 |
| jitter | kvbump | 22.5 / 29 | 15.4 | 5.7 | 2.7 | 3.56 % | 2.4 | 16.1 | 2.46 / 9 | 12.46 |
| clean | today | 10.2 / 11 | 6.2 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.3 | 0.00 / 0 | 0.17 |
| clean | **rule3** | 11.0 / 11 | 7.0 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 |
| clean | kvbump | 11.0 / 11 | 7.0 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.0 | 0.00 / 0 | 1.00 |
| spec | today | 19.2 / 20 | 11.6 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.5 | 0.00 / 0 | 9.18 |
| spec | **rule3** | 19.7 / 20 | 12.1 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.2 | 0.03 / 0 | 9.74 |
| spec | kvbump | 19.7 / 20 | 12.1 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.2 | 0.03 / 0 | 9.74 |
| spec200 | today | 27.8 / 31 | 15.9 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.79 / 11 | 17.79 |
| spec200 | **rule3** | 27.8 / 31 | 15.9 | 0.0 | 0.0 | 0.11 % | 0.0 | 1.2 | 7.79 / 11 | 17.79 |
| spec200 | kvbump | 27.8 / 31 | 15.9 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.79 / 11 | 17.79 |
| fp12 | today | 23.6 / 31 | 16.2 | 11.3 | 6.8 | 2.98 % | 7.1 | 11.6 | 3.94 / 11 | 13.65 |
| fp12 | **rule3** | 23.6 / 30 | 16.1 | 20.3 | 13.9 | 4.47 % | 0.0 | 9.7 | 3.58 / 10 | 13.56 |
| fp12 | kvbump | 23.9 / 31 | 16.5 | 11.3 | 6.8 | 2.89 % | 7.1 | 10.3 | 3.94 / 11 | 13.93 |
| longhold | today | 16.6 / 31 | 13.6 | 12.8 | 10.2 | 3.32 % | 2.6 | 14.3 | 1.22 / 11 | 6.60 |
| longhold | **rule3** | 14.0 / 14 | 11.0 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 |
| longhold | kvbump | 16.6 / 31 | 13.6 | 12.8 | 10.2 | 3.32 % | 2.6 | 13.9 | 1.22 / 11 | 6.60 |

FPD18's gates (rule3 against today; compared unrounded, printed to two decimals), all met:

- `owner`: felt @20 0.61 <= 1.05, dropped 4.42 <= 8.25, churn 6.17 <= 12.11 per 10 s.
- `owner2`: felt @20 1.55 <= 1.56, dropped 6.75 <= 6.75, churn 8.50 <= 11.56: the near miss the plan named (felt
  against half of today's 3.13; dropped exactly today's).
- `ownerS`: felt @20 0.86 <= 1.13, dropped 3.58 <= 6.83, churn 6.50 <= 12.31.

`kvbump` (what `KV_LeadBump` builds with prediction on, for FP21's A/B) keeps today's felt delay (2.11 / 3.26 / 2.21 t
at cap 20 on the owner-like links, today 2.10 / 3.13 / 2.26) and churn about two thirds of today's, with the fewest
lates and dropped inputs of the three (the cover and the bump together); on `jitter`, `fp12` and `longhold` it is
today's within 0.3 t. So FP21's "felt delay at most half of `KV_LeadBump`'s" compares Revision 3 against about today's
felt delay, and "`miss` at most its" against fewer dropped inputs than today's: by the census `rule3` meets the first
(0.61 / 1.55 / 0.86 against 1.06 / 1.63 / 1.11) and not the second (4.4 / 6.8 / 3.6 dropped against 3.2 / 4.6 / 2.8 per
10 s).

### Tasks

- [x] **FP17. The census.** `src/shared/lockstep/lead.census.spec.ts` (opt-in `--census`; smoke: today against its copy,
  12 s). -> Verify: the smoke passes in the default suite; the two census runs above print the appendix's tables (the
  copy of today's rule matches `LeadController` on every frame).
- [x] **FP18. `LeadController`: the cover and no bump.** `lead.ts`: a second trip window (`coverWindowSec`,
  `coverPercentile`), `ceiling` (constructor argument, undefined = no cover) less the newest send's `depthUsed`,
  `L*` / `Lf` as Design 13, `lateBump` (false: lates counted only); `LeadStats` additions; `LEAD` additions in
  config.ts. -> Verify: `lead.spec.ts`: Revision 2's cases with `lateBump: true` unchanged; with the defaults: a late
  does not move the lead unless its trip moves the p95 / p99; one burst sample in 15 s does not move the p99 (1 % of
  ~450); the cover rises to and stops at `ceiling - depthUsed`, and follows a depth change; no ceiling = the base only;
  a step up of the trips still followed the same frame; the fall unchanged.
- [x] **FP19. LockstepClient wiring.** The client passes `tunables.prediction?.maxTicks` as the ceiling.
  -> Verify: lockstep.spec FP11 networks (lates 0 after the warm-up, relay missed under 0.5 %), FP12 spike and hold
  (peak and back-within bounds; FP12's dropped-inputs line printed beside today's); every other lockstep / predict
  spec unchanged; the census gains a `rule3` row from the real controller that matches `cov20` frame for frame, and
  meets FPD18's gates on `owner`, `owner2` and `ownerS`.
- [x] **FP20. Diagnostics.** The `[Pace]` line's lead part `lead {l}t target {L*}t (base {Lb}t cover {Lc}t cap {C}t)
  fall {Lf}t · lates {n} bumps {n} falls {n}`; the debug line unchanged but `trip p95` -> `trip p95 / p99`; `KV_LeadBump`
  (`RUN_ATTRIBUTES.leadBump`, read at each co-op start like `KV_LeadOff`) builds the client with `lateBump: true`.
  -> Verify: `arrivalLog.spec` updated; `npm run verify`.
- [ ] **FP21 [owner]. Studio 4G again.** The same session as the owner's first, once with Revision 3, once with
  `KV_LeadBump`. -> Verify: docs/SPIKES.md "Frame pacing" gains the rows (trip p50 / p95 / max, lead, target, lates,
  bumps, `pred`); felt delay (effective lead past `pred`) at most half of `KV_LeadBump`'s, `miss` at most its; `LEAD`
  confirmed or edited.
- [x] **FP22. Docs.** CLAUDE.md's decision log entry (Revision 3), this section's status and as built, docs/FEEL.md J9
  if the debug line changed.

Order: FP17 -> owner decisions -> FP18 -> FP19 -> FP20 -> FP21 -> FP22.

### Risks

- **The census underestimates the owner's bursts** (about half the steady-state lates and bumps). With more bursts the
  steady rules change little and the bump rules churn more, so the ranking should hold; FP21 is the check.
- **The cover spends lead that is not free for everything.** Below the cap your knight is drawn ahead, but a sword hit
  confirms, an enemy reacts and a teammate sees you one effective lead later. FPD16 is the owner's call; `coverPercentile`
  0.98 or `coverWindowSec` 10 spend less (`p98w10` without the cap: 17.6 net on `owner`).
- **Long spikes cost more lates** than today (FP12's spike: ~17 frames per client). If FP21 shows long latency shifts
  more than bursts, FPD15b (`cov20bf`) keeps today's lates there.
- **The ceiling moves with the buffer.** A deeper buffer lowers the cover's room tick for tick; on a very jittery down
  link (`spec200`, depth 12) the cover is gone and only the base raises the lead, as today without bumps.

### Appendix: the census tables (2026-11-10, `lead-spikes` @ the FP17 commit)

Per 10 s rates are per client; relay missed is the worst client's share of ticks after the warm-up.

**owner** (owner-like (Studio 4G): 78-84 ms one way, 1.2 % of up slots +120-175 ms (head-of-line), 0.2 % down)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 20.8 / 27 / 32 | 16.9 / 22 / 23 | 14.1 | 8.2 | 6.39 % | 4.0 | 36.3 | 2.10 / 7 | 10.79 / 17 |  |
| k2 | 19.8 / 26 / 32 | 15.9 / 22 / 23 | 16.2 | 9.5 | 5.97 % | 2.8 | 25.7 | 1.66 / 6 | 9.81 / 16 |  |
| plus1 | 18.1 / 23 / 30 | 14.2 / 19 / 20 | 22.8 | 13.0 | 5.70 % | 6.3 | 12.1 | 0.56 / 3 | 8.10 / 13 |  |
| nobump | 17.2 / 23 / 30 | 13.2 / 19 / 19 | 28.8 | 17.6 | 6.09 % | 0.0 | 4.3 | 0.39 / 3 | 7.15 / 13 |  |
| p99w15 | 23.8 / 28 / 32 | 19.9 / 21 / 21 | 2.2 | 0.9 | 1.58 % | 0.0 | 5.2 | 4.03 / 8 | 13.80 / 18 |  |
| p98w10 | 21.5 / 27 / 32 | 17.6 / 21 / 21 | 10.3 | 6.5 | 2.97 % | 0.0 | 5.5 | 2.67 / 7 | 11.50 / 17 |  |
| cap20 | 18.9 / 23 / 30 | 15.0 / 19 / 19 | 19.6 | 10.8 | 6.00 % | 6.2 | 20.7 | 0.57 / 3 | 8.90 / 13 |  |
| cov20 | 20.4 / 24 / 30 | 16.5 / 19 / 19 | 11.3 | 4.4 | 3.47 % | 0.0 | 6.2 | 0.61 / 4 | 10.40 / 14 |  |
| cov20m | 20.6 / 24 / 30 | 16.6 / 19 / 19 | 10.3 | 4.3 | 3.25 % | 0.0 | 5.2 | 0.65 / 4 | 10.58 / 14 |  |
| fast | 18.6 / 25 / 30 | 14.6 / 21 / 23 | 22.2 | 12.6 | 9.64 % | 5.5 | 58.0 | 1.03 / 5 | 8.58 / 15 |  |
| cov20bf | 20.8 / 25 / 30 | 16.8 / 21 / 23 | 11.3 | 4.7 | 6.36 % | 5.4 | 38.7 | 1.06 / 5 | 10.76 / 15 |  |
| cov20f | 20.2 / 23 / 27 | 16.2 / 19 / 19 | 12.8 | 5.4 | 3.89 % | 0.0 | 8.5 | 0.44 / 3 | 10.15 / 13 |  |

**owner2** (owner-like, harsher: 78-84 ms one way, 2 % of up slots +100-200 ms (head-of-line), 0.2 % down)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 22.4 / 27 / 34 | 18.5 / 23 / 24 | 12.1 | 6.8 | 6.09 % | 4.3 | 34.7 | 3.13 / 7 | 12.38 / 17 |  |
| k2 | 21.6 / 27 / 34 | 17.7 / 22 / 24 | 15.5 | 7.5 | 6.22 % | 3.5 | 29.0 | 2.61 / 7 | 11.57 / 17 |  |
| plus1 | 20.3 / 25 / 29 | 16.4 / 21 / 21 | 22.2 | 11.2 | 6.34 % | 7.2 | 16.4 | 1.63 / 5 | 10.30 / 15 |  |
| nobump | 19.4 / 25 / 29 | 15.5 / 21 / 21 | 32.1 | 17.2 | 7.95 % | 0.0 | 11.2 | 1.45 / 5 | 9.43 / 15 |  |
| p99w15 | 25.8 / 29 / 34 | 21.9 / 23 / 23 | 2.0 | 1.2 | 1.39 % | 0.0 | 2.8 | 5.83 / 9 | 15.76 / 19 |  |
| p98w10 | 24.1 / 27 / 33 | 20.2 / 22 / 22 | 5.2 | 3.0 | 2.20 % | 0.0 | 4.6 | 4.27 / 7 | 14.09 / 17 |  |
| cap20 | 20.4 / 25 / 29 | 16.6 / 20 / 21 | 20.8 | 11.2 | 6.95 % | 7.2 | 19.7 | 1.41 / 5 | 10.45 / 15 |  |
| cov20 | 21.5 / 25 / 29 | 17.6 / 21 / 21 | 14.2 | 6.8 | 4.20 % | 0.0 | 8.5 | 1.55 / 5 | 11.48 / 15 |  |
| cov20m | 21.5 / 25 / 29 | 17.6 / 21 / 21 | 14.2 | 6.8 | 4.20 % | 0.0 | 8.5 | 1.55 / 5 | 11.48 / 15 |  |
| fast | 20.2 / 26 / 32 | 16.4 / 22 / 24 | 25.9 | 13.9 | 10.67 % | 7.1 | 68.7 | 1.89 / 6 | 10.24 / 16 |  |
| cov20bf | 21.9 / 26 / 32 | 18.0 / 22 / 24 | 13.6 | 6.6 | 6.45 % | 5.9 | 43.3 | 1.93 / 6 | 11.86 / 16 |  |
| cov20f | 21.2 / 25 / 29 | 17.3 / 21 / 21 | 16.7 | 8.0 | 4.67 % | 0.0 | 11.3 | 1.28 / 5 | 11.20 / 15 |  |

**ownerS** (owner-like, other channel seeds: 78-84 ms one way, 1.2 % of up slots +120-175 ms, 0.2 % down)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 21.3 / 27 / 31 | 17.2 / 21 / 22 | 11.2 | 6.8 | 5.78 % | 4.2 | 36.9 | 2.26 / 7 | 11.33 / 17 |  |
| k2 | 20.5 / 27 / 32 | 16.4 / 21 / 22 | 14.8 | 8.5 | 5.81 % | 3.2 | 29.0 | 1.90 / 7 | 10.54 / 17 |  |
| plus1 | 18.8 / 24 / 28 | 14.6 / 19 / 20 | 22.2 | 12.2 | 5.86 % | 6.9 | 13.3 | 0.73 / 4 | 8.76 / 14 |  |
| nobump | 17.9 / 23 / 28 | 13.8 / 19 / 20 | 29.1 | 17.5 | 6.47 % | 0.0 | 6.4 | 0.59 / 3 | 7.90 / 13 |  |
| p99w15 | 24.3 / 29 / 33 | 20.1 / 21 / 21 | 0.9 | 0.3 | 1.44 % | 0.0 | 3.6 | 4.38 / 9 | 14.26 / 19 |  |
| p98w10 | 22.4 / 28 / 32 | 18.3 / 21 / 21 | 8.8 | 4.5 | 4.08 % | 0.0 | 6.7 | 3.08 / 8 | 12.44 / 18 |  |
| cap20 | 19.5 / 24 / 28 | 15.4 / 19 / 20 | 16.8 | 8.9 | 5.50 % | 6.6 | 20.2 | 0.80 / 4 | 9.52 / 14 |  |
| cov20 | 20.8 / 25 / 28 | 16.7 / 19 / 20 | 9.8 | 3.6 | 2.95 % | 0.0 | 6.5 | 0.86 / 5 | 10.78 / 15 |  |
| cov20m | 20.9 / 25 / 28 | 16.7 / 19 / 20 | 9.2 | 3.5 | 2.92 % | 0.0 | 6.0 | 0.86 / 5 | 10.85 / 15 |  |
| fast | 18.7 / 25 / 30 | 14.6 / 21 / 22 | 21.2 | 12.4 | 9.42 % | 5.6 | 54.6 | 0.96 / 5 | 8.69 / 15 |  |
| cov20bf | 20.8 / 25 / 30 | 16.7 / 21 / 22 | 8.3 | 3.6 | 4.89 % | 4.8 | 31.6 | 0.97 / 5 | 10.84 / 15 |  |
| cov20f | 20.4 / 23 / 28 | 16.3 / 19 / 19 | 10.7 | 4.2 | 3.33 % | 0.0 | 8.0 | 0.54 / 3 | 10.42 / 13 |  |

**jitter** (4G jitter: 50-130 ms one way, 0.4 % of slots +80-200 ms both ways)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 22.4 / 29 / 35 | 15.4 / 22 / 24 | 5.8 | 2.7 | 3.56 % | 2.4 | 16.1 | 2.46 / 9 | 12.44 / 19 |  |
| k2 | 21.6 / 27 / 32 | 14.6 / 20 / 22 | 7.2 | 3.4 | 3.03 % | 1.5 | 9.6 | 1.75 / 7 | 11.59 / 17 |  |
| plus1 | 21.3 / 25 / 28 | 14.3 / 16 / 17 | 6.8 | 2.8 | 2.61 % | 2.8 | 4.1 | 1.29 / 5 | 11.27 / 15 |  |
| nobump | 20.8 / 25 / 27 | 13.8 / 15 / 16 | 7.9 | 3.7 | 2.50 % | 0.0 | 0.8 | 0.99 / 5 | 10.83 / 15 |  |
| p99w15 | 23.5 / 29 / 34 | 16.5 / 21 / 22 | 3.4 | 1.2 | 2.31 % | 0.0 | 3.9 | 3.55 / 9 | 13.55 / 19 |  |
| p98w10 | 21.8 / 26 / 29 | 14.8 / 18 / 19 | 5.8 | 2.3 | 2.36 % | 0.0 | 0.9 | 1.83 / 6 | 11.83 / 16 |  |
| cap20 | 20.9 / 25 / 27 | 13.9 / 15 / 16 | 7.8 | 3.5 | 2.45 % | 3.0 | 0.8 | 1.01 / 5 | 10.95 / 15 |  |
| cov20 | 21.0 / 25 / 27 | 14.0 / 15 / 16 | 7.6 | 3.5 | 2.42 % | 0.0 | 0.8 | 1.01 / 5 | 11.01 / 15 |  |
| cov20m | 21.0 / 25 / 27 | 14.0 / 15 / 16 | 7.6 | 3.5 | 2.42 % | 0.0 | 0.9 | 1.02 / 5 | 11.02 / 15 |  |
| fast | 21.5 / 26 / 33 | 14.5 / 18 / 24 | 6.8 | 2.8 | 4.03 % | 2.8 | 19.2 | 1.50 / 6 | 11.48 / 16 |  |
| cov20bf | 21.5 / 26 / 33 | 14.5 / 18 / 24 | 6.8 | 2.8 | 4.03 % | 2.8 | 19.2 | 1.50 / 6 | 11.50 / 16 |  |
| cov20f | 21.0 / 25 / 27 | 14.0 / 15 / 16 | 7.6 | 3.5 | 2.45 % | 0.0 | 0.8 | 0.99 / 5 | 10.98 / 15 |  |

**clean** (clean: 30-40 ms one way)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.3 | 0.00 / 0 | 0.17 / 1 |  |
| k2 | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.3 | 0.3 | 0.00 / 0 | 0.17 / 1 |  |
| plus1 | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.3 | 0.00 / 0 | 0.17 / 1 |  |
| nobump | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.3 | 0.00 / 0 | 0.17 / 1 |  |
| p99w15 | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |
| p98w10 | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |
| cap20 | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.3 | 0.00 / 0 | 0.17 / 1 |  |
| cov20 | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |
| cov20m | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |
| fast | 10.2 / 11 / 11 | 6.2 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.3 | 0.00 / 0 | 0.15 / 1 |  |
| cov20bf | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.7 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |
| cov20f | 11.0 / 11 / 11 | 7.0 / 7 / 7 | 0.0 | 0.0 | 0.00 % | 0.0 | 0.0 | 0.00 / 0 | 1.00 / 1 |  |

**spec** (FP11 spec: 20-120 ms one way)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 19.2 / 20 / 20 | 11.6 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.5 | 0.00 / 0 | 9.18 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| k2 | 19.2 / 20 / 20 | 11.6 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.2 | 0.5 | 0.00 / 0 | 9.18 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| plus1 | 19.2 / 20 / 20 | 11.6 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.5 | 0.00 / 0 | 9.18 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| nobump | 19.2 / 20 / 20 | 11.6 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.5 | 0.00 / 0 | 9.18 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| p99w15 | 19.8 / 21 / 21 | 12.2 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.2 | 0.06 / 1 | 9.84 / 11 | FP11 pass (lates 0, missed 0.17 %) |
| p98w10 | 19.8 / 21 / 21 | 12.2 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.2 | 0.06 / 1 | 9.76 / 11 | FP11 pass (lates 0, missed 0.17 %) |
| cap20 | 19.2 / 20 / 20 | 11.6 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.5 | 0.00 / 0 | 9.18 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| cov20 | 19.7 / 20 / 21 | 12.1 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.2 | 0.03 / 0 | 9.74 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| cov20m | 19.7 / 20 / 21 | 12.1 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.2 | 0.03 / 0 | 9.74 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| fast | 19.1 / 20 / 20 | 11.5 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.5 | 0.00 / 0 | 9.15 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| cov20bf | 19.7 / 20 / 21 | 12.1 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 1.5 | 0.3 | 0.01 / 0 | 9.68 / 10 | FP11 pass (lates 0, missed 0.17 %) |
| cov20f | 19.7 / 20 / 21 | 12.1 / 13 / 13 | 0.0 | 0.0 | 0.17 % | 0.0 | 0.3 | 0.02 / 0 | 9.68 / 10 | FP11 pass (lates 0, missed 0.17 %) |

**spec200** (FP11 spec: 0-200 ms one way)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| k2 | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.2 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| plus1 | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| nobump | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| p99w15 | 29.3 / 32 / 32 | 17.4 / 20 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 0.8 | 9.31 / 12 | 19.31 / 22 | FP11 pass (lates 0, missed 0.11 %) |
| p98w10 | 28.9 / 32 / 32 | 17.0 / 20 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 0.8 | 8.89 / 12 | 18.89 / 22 | FP11 pass (lates 0, missed 0.11 %) |
| cap20 | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| cov20 | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| cov20m | 27.8 / 31 / 32 | 15.9 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 1.2 | 7.79 / 11 | 17.79 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| fast | 27.7 / 31 / 32 | 15.8 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.72 / 11 | 17.72 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| cov20bf | 27.7 / 31 / 32 | 15.8 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 2.5 | 1.2 | 7.72 / 11 | 17.72 / 21 | FP11 pass (lates 0, missed 0.11 %) |
| cov20f | 27.7 / 31 / 32 | 15.8 / 19 / 20 | 0.0 | 0.0 | 0.11 % | 0.0 | 1.2 | 7.74 / 11 | 17.74 / 21 | FP11 pass (lates 0, missed 0.11 %) |

**fp12** (FP12: 20-120 ms one way, +200 ms up for 1 s at 7 s)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 23.6 / 31 / 31 | 16.2 / 23 / 23 | 11.3 | 6.8 | 2.98 % | 7.1 | 11.6 | 3.94 / 11 | 13.65 / 21 | FP12 pass (12->23 (<= 24) back 8.18 s (<= 9.25 s); 11->21 (<= 23) back 8.20 s (<= 9.00 s)) |
| k2 | 23.6 / 31 / 31 | 16.2 / 23 / 23 | 11.8 | 7.6 | 3.07 % | 6.1 | 11.6 | 3.93 / 11 | 13.64 / 21 | FP12 pass (12->23 (<= 24) back 8.18 s (<= 9.25 s); 11->21 (<= 23) back 8.20 s (<= 9.00 s)) |
| plus1 | 23.3 / 30 / 30 | 15.8 / 22 / 22 | 20.3 | 13.9 | 4.56 % | 10.0 | 11.1 | 3.58 / 10 | 13.28 / 20 | FP12 pass (12->22 (<= 24) back 7.98 s (<= 9.00 s); 11->21 (<= 23) back 8.20 s (<= 9.00 s)) |
| nobump | 23.3 / 30 / 30 | 15.8 / 22 / 22 | 20.3 | 13.9 | 4.56 % | 0.0 | 11.1 | 3.58 / 10 | 13.27 / 20 | FP12 pass (12->22 (<= 24) back 7.98 s (<= 9.00 s); 11->21 (<= 23) back 8.20 s (<= 9.00 s)) |
| p99w15 | 27.1 / 31 / 31 | 19.6 / 23 / 23 | 13.7 | 8.7 | 3.42 % | 0.0 | 5.3 | 7.09 / 11 | 17.08 / 21 | FP12 FAIL (13->23 (<= 24) back never (<= 9.00 s); 12->22 (<= 23) back never (<= 9.00 s)) |
| p98w10 | 25.9 / 30 / 30 | 18.5 / 22 / 22 | 16.6 | 10.5 | 3.86 % | 0.0 | 8.9 | 5.94 / 10 | 15.93 / 20 | FP12 FAIL (13->22 (<= 24) back never (<= 8.75 s); 12->21 (<= 23) back never (<= 8.75 s)) |
| cap20 | 23.3 / 30 / 30 | 15.8 / 22 / 22 | 20.3 | 13.9 | 4.56 % | 10.0 | 11.1 | 3.58 / 10 | 13.28 / 20 | FP12 pass (12->22 (<= 24) back 7.98 s (<= 9.00 s); 11->21 (<= 23) back 8.20 s (<= 9.00 s)) |
| cov20 | 23.6 / 30 / 30 | 16.1 / 22 / 22 | 20.3 | 13.9 | 4.47 % | 0.0 | 9.7 | 3.58 / 10 | 13.56 / 20 | FP12 pass (13->22 (<= 24) back 7.73 s (<= 8.75 s); 12->21 (<= 23) back 7.95 s (<= 8.75 s)) |
| cov20m | 23.5 / 30 / 30 | 16.0 / 22 / 22 | 20.3 | 13.9 | 4.47 % | 0.0 | 10.3 | 3.58 / 10 | 13.48 / 20 | FP12 pass (13->22 (<= 24) back 7.73 s (<= 8.75 s); 12->21 (<= 23) back 7.95 s (<= 8.75 s)) |
| fast | 22.6 / 30 / 30 | 15.1 / 22 / 23 | 11.3 | 6.8 | 2.98 % | 7.1 | 11.6 | 3.03 / 10 | 12.61 / 20 | FP12 pass (12->23 (<= 24) back 5.68 s (<= 9.25 s); 11->21 (<= 23) back 5.90 s (<= 9.00 s)) |
| cov20bf | 23.0 / 30 / 30 | 15.5 / 22 / 23 | 11.3 | 6.8 | 2.89 % | 7.1 | 10.3 | 3.03 / 10 | 13.01 / 20 | FP12 pass (13->23 (<= 24) back 5.63 s (<= 9.00 s); 12->21 (<= 23) back 5.85 s (<= 8.75 s)) |
| cov20f | 23.0 / 30 / 30 | 15.6 / 22 / 22 | 20.3 | 13.9 | 4.47 % | 0.0 | 9.7 | 3.05 / 10 | 13.04 / 20 | FP12 pass (13->22 (<= 24) back 6.18 s (<= 8.75 s); 12->21 (<= 23) back 6.40 s (<= 8.75 s)) |

**longhold** (one-off: 70-82 ms one way, a 600 ms up hold at 15 s)

| Rule | Effective lead mean / p95 / max (t) | Net lead mean / p95 / max (t) | Lates / 10 s | Dropped changed / 10 s | Relay missed | Bumps / 10 s | Churn / 10 s | Felt @20 mean / p95 (t) | Felt @10 mean / p95 (t) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| today | 16.6 / 31 / 33 | 13.6 / 28 / 30 | 12.8 | 10.2 | 3.32 % | 2.6 | 14.3 | 1.22 / 11 | 6.60 / 21 | FP12 pass (11->30 (<= 48) back 5.32 s (<= 11.25 s); 11->30 (<= 48) back 5.32 s (<= 11.25 s)) |
| k2 | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 1.9 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
| plus1 | 14.5 / 15 / 15 | 11.5 / 12 / 12 | 12.8 | 10.2 | 2.19 % | 2.6 | 0.8 | 0.00 / 0 | 4.48 / 5 | FP12 pass (11->12 (<= 48) back 0.00 s (<= 6.75 s); 11->12 (<= 48) back 0.00 s (<= 6.75 s)) |
| nobump | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
| p99w15 | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
| p98w10 | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
| cap20 | 14.8 / 18 / 20 | 11.8 / 15 / 17 | 12.8 | 10.2 | 2.51 % | 2.6 | 4.5 | 0.00 / 0 | 4.76 / 8 | FP12 pass (11->17 (<= 48) back 2.07 s (<= 8.00 s); 11->17 (<= 48) back 2.07 s (<= 8.00 s)) |
| cov20 | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
| cov20m | 16.7 / 20 / 20 | 13.7 / 17 / 17 | 12.8 | 10.2 | 2.51 % | 0.0 | 4.1 | 0.00 / 0 | 6.65 / 10 | FP12 FAIL (11->17 (<= 48) back never (<= 8.00 s); 11->17 (<= 48) back never (<= 8.00 s)) |
| fast | 14.9 / 15 / 33 | 11.9 / 12 / 30 | 12.8 | 10.2 | 3.32 % | 2.6 | 14.3 | 0.29 / 0 | 4.94 / 5 | FP12 pass (11->30 (<= 48) back 1.22 s (<= 11.25 s); 11->30 (<= 48) back 1.22 s (<= 11.25 s)) |
| cov20bf | 15.0 / 15 / 33 | 12.0 / 12 / 30 | 12.8 | 10.2 | 3.32 % | 2.6 | 13.9 | 0.29 / 0 | 4.98 / 5 | FP12 pass (11->30 (<= 48) back 1.22 s (<= 11.25 s); 11->30 (<= 48) back 1.22 s (<= 11.25 s)) |
| cov20f | 14.0 / 14 / 14 | 11.0 / 11 / 11 | 12.8 | 10.2 | 2.13 % | 0.0 | 0.0 | 0.00 / 0 | 4.00 / 4 | FP12 pass (11->11 (<= 48) back 0.00 s (<= 6.50 s); 11->11 (<= 48) back 0.00 s (<= 6.50 s)) |
