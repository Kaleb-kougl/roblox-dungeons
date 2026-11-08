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

Planned, nothing built. Drafted from an audit of `main` @ `0a8e8ec4` after the owner's first co-op playtest with
friends on Roblox ("the game was laggy"). No numbers from that session: FP0 measures them. Owner answers
(2026-11-07): a 3-tick minimum (FPD6), a 10 % fast slew (FPD7), one tuned default with no setting (FPD8).

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
| `hitchFrameSec` | 0.1 | Section 3 |

All provisional until FP0 / FP6.

## Decisions (FPD1-FPD5 proposed; FPD6-FPD8 the owner's answers, 2026-11-07)

- **FPD1. Client only.** The client still steps exactly the merged log; only the timing changes. No sim, wire or
  server change (FP7 is a tunable, and only if measured).
- **FPD2. Smooth beats instant.** A buffer of 3-5 ticks (50-83 ms) is worth it: stutter is visible to everyone all the
  time, the delay only in your own presses. Local prediction (separate plan) is the fix for the delay.
- **FPD3. Hold, never extrapolate.** On an empty buffer the views freeze on the newest state; nothing is drawn that
  the sim has not stepped (no extrapolated enemies or bullets in a bullet hell).
- **FPD4. The lead fix ships first and on its own (FP1).** It is a bug, it costs nothing, and it is part of the lag.
- **FPD5. Broadcast cadence stays 2** unless FP0 / FP6 show batches of 1 arrive measurably more evenly.
- **FPD6. The buffer is at least 3 ticks (50 ms).** Fewer holds for 17 ms more delay than a 2-tick minimum.
- **FPD7. The fast slew is 10 %.** Less visible than a 25 % fast-forward; the extra delay after a long hold still
  clears within seconds.
- **FPD8. One tuned default, no player setting.** `KV_PacingOff` stays a debug switch for playtests only.

## Tasks

- [ ] **FP0 [owner]. Measure a real session.** Build FP5's arrival log first (debug only, nothing else changes): in
  a private published place with 2-4 friends, KV_Debug on, record per client: ping, batch inter-arrival times and
  sizes, offset spread (p50 / p95 / max), render fps, effective lead over time. Once with `BROADCAST_EVERY_TICKS` 1 if
  possible. -> Verify: a table in docs/SPIKES.md "Frame pacing"; the tunables above confirmed or edited.
- [ ] **FP1. Fix the lead.** A step whose target is at or below `lastSentTick` sends nothing; `inputLead()` reports the
  effective lead. -> Verify: new lockstep spec: a spike raises the lead, the network calms, and **the effective lead
  falls back** to the floor after `leadDecayTicks` per step; a later spike's first miss raises it at once; the existing
  network runs still finish ranked with misses under a quarter; `latencyProbe.spec` updated ("press steps lead + 1
  ticks later" holds for the effective lead).
- [ ] **FP2. `PlayoutPacer` (pure).** `shared/lockstep/pacer.ts` + `PACING` + barrel. -> Verify: `pacer.spec.ts` on
  synthetic arrival traces: steady arrivals step exactly one tick per 16.7 ms at 30 / 60 / 144 fps; alpha strictly
  increases within a tick and stays in [0, 1); a late batch makes one hold, then no jump past `maxCatchup`; depth
  follows the 95th percentile, not a single outlier; slew within `slewShare`; a 0.5 s client hitch catches up without
  touching P; hitched-frame arrivals are ignored.
- [ ] **FP3. LockstepClient wiring.** `pacing` tunable, `now` on `receive` / `pump`, alpha, `depthTicks` in the lead.
  -> Verify: every existing lockstep spec passes unchanged with pacing off; the simulated-network runs
  (`NET_RUNS`, 20-120 ms and 0-200 ms one way) pass with pacing on: identical final state on every client, the log
  validates, misses under a quarter.
- [ ] **FP4. Smoothness metric in the spec harness.** The `Net` harness renders at a chosen fps and records, per
  client and frame, the ticks stepped and the alpha. -> Verify: with pacing on, at 60 fps and 20-120 ms jitter, at
  least 99 % of frames step exactly one tick and holds stay under 1 per 10 s; with pacing off the same run shows
  today's pattern (the spec logs both, so the gain is measured).
- [ ] **FP5. SimController and diagnostics.** `os.clock()` into `receive` / `pump`; `KV_PacingOff`; the debug line's
  pacing part and effective lead; the arrival log for FP0 (KV_Debug only, printed every 10 s). -> Verify:
  `npm run verify`; Studio two-player test (Test > Clients and Servers) runs, the debug line shows depth 3 and no
  holds on loopback.
- [ ] **FP6 [owner]. Playtest.** The FP0 group again, pacing on vs `KV_PacingOff`, on a 60 Hz and a 120 Hz+ screen and
  one phone if possible. -> Verify: players notice the difference; holds per minute and depth recorded; tunables
  adjusted.
- [ ] **FP7 (optional). Broadcast cadence.** Only if FP0 / FP6 point to it: `BROADCAST_EVERY_TICKS` 1, the input and
  hash rate limits re-checked. -> Verify: the network specs and the replay bench pass; FP6's numbers improve.
- [ ] **FP8. Docs.** docs/SERVER.md "Clients" (pacing, the effective lead), docs/FEEL.md J9 (debug line), CLAUDE.md's
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
