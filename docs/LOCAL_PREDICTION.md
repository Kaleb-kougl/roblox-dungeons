# Local prediction (co-op)

In co-op your own knight answers your keys **late**: an input goes out for tick `T + lead` and is only drawn once the
server's merged frame for that tick comes back and is stepped. This plan draws **your own knight ahead of the
server**: its movement and facing are predicted from your own inputs on top of the last stepped (merged) state, and
corrected when the server's frames arrive. It is the "Not done" item in docs/SERVER.md "Clients" ("visual prediction
of the local character (it is drawn at the merged state)"). Work it task by task; each task ends with a **Verify**.

**Presentation and client timing only.** No sim, dungeon, hash, replay, fixture, score, lockstep wire or server change:
the sim still steps exactly the server's merged log, and nothing predicted ever reaches it, a hash, a recording or a
remote. Solo runs are untouched (they step locally, with no input delay). Teammates, enemies, bullets, pickups and
every outcome (hits, kills, pickups, room clears) stay at the merged state.

## Status (2026-11-07)

Planned, nothing built. Drafted from an audit of branch `frame-pacing` @ `0a8e8ec4` (docs/FRAME_PACING.md: planned,
nothing built). It builds on frame pacing (LPD2): FP1's lead fix and FP2-FP3's playout clock come first for the
wiring (LP5); the pure parts (LP1-LP4) can be built before them. Owner answers (2026-11-07): a 10-tick horizon
(LPD4), no hitbox pip (LPD7), the i-frame look merged (LPD5), the camera on the drawn knight (LPD8).
Rollback spike (2026-11-09): docs/ROLLBACK_SPIKE.md measures full co-op rollback against this plan as the cheaper
alternative (built headlessly, Studio and device checks pending); its RBD8 decides between them.

## Why your knight feels late (findings)

| Fact | Where | Consequence |
|---|---|---|
| The sim steps ONLY merged frames; after stepping tick T the client samples its input once and sends it for `nextInputTick()` = T + lead | lockstep/client.ts `pump` | A press is drawn `lead` ticks (plus the buffer, below) after it was sampled |
| The lead starts at `INPUT_DELAY_TICKS` 3, +1 per missed deadline, measured ~15 ticks at 20-120 ms one way, ~25 at 0-200 ms; FP1's bug keeps it at the run's highest | lockstep/config.ts, docs/FRAME_PACING.md "The lead bug" | 50 ms at best, typically 250 ms+ between a key and the knight moving |
| Frame pacing adds a buffer of 3-5 ticks (FPD6), which the lead grows to cover | docs/FRAME_PACING.md Design 5 | Smooth, but 50-83 ms more delay; FPD2 names local prediction as the fix |
| The client already keeps every input it sent and has not seen stepped (`sent`, tick -> frame), and the server's finalized frames not yet stepped (`queue`) | client.ts `sent`, `queue`, `checkDeadline` | Everything a prediction needs is in LockstepClient already: no new remote |
| Movement is a small, self-contained part of `stepPlayer`: timers, ROLL / FLASK press edges, the roll (locked direction) or the walk, facing (aim, else roll, else move) | sim/player.ts steps 1-6, 8 | It can be replayed for one player without stepping the world |
| The walk is slowed by the weapon in hand (sword guard 0.5, finisher wind-up 0.35 + a 0.6-tile lunge, bow charge), by the flask (0.5) and sped up by Quickstep (130 %) | `weaponMoveMultiplier`, sword.ts / bow.ts `moveMultiplier`, sword.ts lunge, `boostWalkPercent` | The weapon counters that drive these must be replayed too, or every guard / charge rubber-bands (LP2) |
| Every body move goes through `movePlayer(state, dx, dz, config, p)`: the world's `moveResolver` (the slide, docs/WALL_SLIDE.md) with `solidCells(state)`; it writes only `p` | sim/player.ts, breakables/cells.ts | The predictor can call it with a scratch PlayerState and the merged state, read-only |
| Other things that move the local player: the floor change's spawn (endless.ts 287), the boss room clamp (boss/shared.ts 209), revive / death / leave (party.ts), a draft freezes everyone (step.ts `isDraftOpen`) | sim | Not predicted: they come in as corrections (snaps, Design 4) |
| Mouse aim is the cursor minus the player's position, taken at the merged position | InputController `sample(me.x, me.z, ...)`, SimController `coopFrame` | With a predicted knight the aim origin must be the drawn knight, or the aim line and the shot leave from a point behind it |
| 12 client sites read the watched player's pose (`lerp(p.prevX, p.x, alpha)`, `faceX`) | ActorRenderController, CameraController, WeaponViewController, BoostAuraController, MinimapController, HudOcclusionController, ParryFlashController, ComboController, GoldenRenderController, CollisionDebugController, TutorialArrowController, InputController (touch facing / auto-target) | One accessor (`getDrawnPlayer`) and a per-site choice (Design 6) |

## Design

### 1. What is predicted

Only the local player's **body**: position, facing, the roll (direction, timer, animation), the walk animation's speed,
and the flask / weapon slowdowns and the sword's lunge. Never: attacks and their timing (the swing, arrows, the guard's
erase), hits on you, hearts, i-frames, death, pickups, other players, enemies, bullets.

The rule for every view: **what is drawn on or attached to your knight follows the drawn pose; what shows what the sim
decided stays merged.** A swing is still drawn `lead` ticks after the press (as today), but on the knight where it is.

### 2. The predictor (pure, `shared/lockstep/predict.ts`)

`LocalPredictor` replays the local player's motion from the merged state over the inputs the sim has not stepped yet:

- **Base:** a copy of the merged `playerAt(state, localIndex)` and of its weapons' motion counters (Design 3), into
  scratch objects (never the merged state).
- **Inputs, tick by tick from `state.tick`:** the server's finalized frame while one is queued (`queue`, frame pacing's
  buffer: truth, misses included); then the frame this client sent (`sent`); a tick it never sent (the lead jumped)
  repeats the previous frame, as the relay does.
- **Horizon:** up to the last sent tick, at most `PREDICTION.maxTicks` ticks past `state.tick` (LPD4). The predicted
  head is the pose after the last replayed tick; `prevX/prevZ` the one before, so views keep `lerp(prev, x, alpha)`
  with the client's alpha.
- **One motion tick** (`predictMotionTick`, `shared/lockstep/predictMotion.ts`) mirrors `stepPlayer` steps 1, 3-6 and 8
  line for line: timers, ROLL press edge (Slippery's i-frames are irrelevant to motion and skipped), FLASK press edge
  (needs a charge and missing health, from the base), the roll or the walk (`weaponMoveMultiplier` from the predicted
  counters, `boostWalkPercent` with the Quickstep timer counted down from the base), `movePlayer` with the floor's
  world config (`simWorldConfig`) and the merged state, then facing. No events, no Ember, no debug hit.
- **Stops:** nothing is predicted while the local player is dead or left, while any draft is open (the sim freezes
  everyone), under the stage cover, or while spectating someone else.
- **When:** rebuilt at the end of every `pump` that stepped or sent (with pacing on: once per tick). It mutates nothing
  outside its scratch (LP3's spec hashes the merged state before and after).

Mirror, not refactor (LPD1): the sim keeps its code; `predictMotion.spec` pins the mirror to the real `stepPlayer`
bit for bit, so a sim change that moves the body fails the spec until the mirror follows.

### 3. Weapon motion (`predictMotion.ts`, the weapon part)

Only the counters that slow or push the body: the sword's guard / step / busy / window (guard 0.5, wind-up 0.35 and its
lunge of `lungeDistance / finisherWindupTicks` a tick along the predicted facing) and the bow's charge (charge
multiplier; a roll or a swap cancels it). Swaps change the active set. The mirror reads the same helpers the sim does
(`swordGuardTicks`, attack ticks with Swift Strikes / Frenzy, `SWORD_DATA` / `BOW_DATA` at call time so
`setSwordTimings` applies) from the merged state. Nothing is fired, swung or erased. If a weapon has no mirror, its
merged `moveMultiplier` is held over the horizon (the fallback, measured by LP3's error stats).

### 4. Correction (pure, `shared/view/predict/smoother.ts`)

Each rebuild is a fresh prediction from a newer base, so a wrong guess (a missed deadline, a crate your own swing
broke, a Charger in your path's breakables, the boss room's clamp) shows up as a jump between the old and the new
prediction **for the same tick**. `PredictionSmoother`:

- keeps the previous prediction per tick (a ring of `maxTicks + 2`), and on a rebuild adds `old - new` at the old
  head to a visual **offset**, so the drawn knight does not jump;
- decays the offset on real time, `0.5 ^ (dt / halfLifeSec)` (60 ms);
- **snaps** (offset 0) when the jump is over `snapTiles` (1.0), on a floor change, run start, death, revive, a
  spectate switch and a draft opening or closing; never draws farther than `maxOffsetTiles` from the prediction;
- facing is never smoothed (the sprite has 8 facings; a turn is a turn).

Drawn pose = `lerp(pred.prev, pred, alpha) + offset`, facing and roll from the prediction, everything else (hurt,
look, death) from the merged player.

### 5. Truth stays visible

Bullets are drawn at the merged tick, the knight up to `maxTicks` later. Enemy bullets fly 1.6-4.2 tiles/s, the
knight walks 6 and rolls 11, so at 10 ticks (167 ms) a bullet is drawn up to 0.7 tiles short of where it will be when
your drawn pose is real. Two rules keep that honest:

- **Hits, hearts and death are merged.** You are hurt when the sim says so, never by a predicted overlap.
- **The invulnerability look is merged** (`playerLook(dead, iframeTicks)` of the merged player, LPD5): the roll's tint
  shows when you are really invulnerable against the bullets you see, a few ticks after the predicted roll starts.

No marker is drawn at the merged position (LPD7): the screen stays clean, and the cap keeps the gap small.

### 6. Wiring

- `LockstepClient.predicted(): Readonly<PlayerState> | undefined` (the raw head; undefined when not predicting) and
  `predictionStats()` (Design 7). `LockstepTunables.prediction: PredictionTunables | undefined`
  (`DEFAULT_LOCKSTEP.prediction` = `PREDICTION`; the network specs that assert exact stepping pass `undefined`).
- SimController owns the smoother and exposes `getDrawnPlayer(index): Readonly<PlayerState>`: the smoothed pose for the
  local index while predicting, else `playerAt(state, index)` (solo, teammates, spectating: exactly today's value).
- `coopFrame`: `inputController.sample(drawn.x, drawn.z, ...)` (aim from the drawn knight; the shot that input fires
  leaves from the predicted position, which is where the sim will have you).
- View sites (LP0 confirms the list; default rule of Design 1):

| Site | Follows | Why |
|---|---|---|
| ActorRenderController `drawPlayer` (sprite / capsule, facing, ring / pip, `playerSpriteInput` speed and roll, squash / afterimages, outline) | drawn | It is the knight |
| ActorRenderController look (i-frame tint), hurt blink, death | merged | Truth (Design 5) |
| CameraController | drawn | The knight stays steady on screen |
| WeaponViewController (aim line, swing fan / blade, guard ring, charge) | drawn pose and facing; swing timing merged | Attached to the knight |
| BoostAuraController, ComboController shout feet, ParryFlashController centre, GoldenRenderController label | drawn | Attached to the knight |
| MinimapController self marker | drawn | Same knight on both |
| MinimapController fog sources, room edges, stairwell, pickups | merged | Sim truth |
| HudOcclusionController | drawn | Fades what covers the knight you see |
| InputController touch facing / auto-target origin | drawn | Same origin as the aim |
| CollisionDebugController | both (a second ring for merged) | Debug |
| TutorialArrowController | unchanged | Solo only |

- `KV_PredictOff` (Workspace attribute, read at each co-op start, like `KV_PacingOff`): prediction off, for A/B in a
  playtest. No player setting (LPD6).
- Unchanged: hash reports, the final claim, `end`, floor changes, the stage cover, drafts, spectating, the hitstop rule.

### 7. Diagnostics (KV_Debug)

`predictionStats()`: when tick K is stepped, the merged pose at K is compared with the prediction made for K one
rebuild earlier: mean / max error (tiles) over `statsWindowTicks` (600), corrections (error > 0.01), snaps. The co-op
debug line (docs/FEEL.md J9) gains `pred {h}t · err {mean}/{max} · snaps {n}`; the latency probe gains **press ->
drawn** (frames until the drawn knight first answers a press: 1 with prediction, the lead without).

## Tunables (`PREDICTION`, shared/lockstep/config.ts; smoother ones in shared/view/predict/config.ts)

| Name | Value | Why |
|---|---|---|
| `maxTicks` | 10 | 167 ms (owner, LPD4): past it the knight drifts too far ahead of the bullets (Design 5) |
| `halfLifeSec` | 0.06 | A correction is mostly gone in ~4 frames, without a visible glide |
| `snapTiles` | 1.0 | Larger than any guess error from a missed tick; teleports and clamps snap |
| `maxOffsetTiles` | 1.0 | Never drawn farther than this from the prediction |
| `statsWindowTicks` | 600 | 10 s, like the pacing windows |

All provisional until LP8.

## Decisions (LPD1-LPD3, LPD6 proposed; LPD4, LPD5, LPD7, LPD8 the owner's answers, 2026-11-07)

- **LPD1. Mirror, not refactor.** The motion and weapon-motion replays are copies in shared/lockstep, pinned to the
  sim by parity specs, so `shared/sim` is not touched at all (the brief). Considered: extracting `stepPlayer`'s motion
  into a shared function (zero drift, but a sim edit that every fixture would have to re-prove).
- **LPD2. Built on frame pacing.** Inputs are sampled once per stepped tick, so without the playout clock the predicted
  head advances in bursts and the knight stutters like the world does today. The wiring (LP5) waits for FP1-FP3; the
  pure parts do not. Considered: sampling on a local clock of its own (a change of the lockstep client's send cadence:
  out of scope).
- **LPD3. Body only.** Attacks, hits, pickups and other players are not predicted (no rollback): nothing is drawn that
  the sim may not do, except your own walk and roll a few ticks early.
- **LPD4. Horizon: the effective lead, capped at `maxTicks` 10 (167 ms; owner).** Felt delay of the walk drops to one
  frame up to the cap; above it the rest (`lead - maxTicks`) stays. LP8 may retune it against the bullet gap.
- **LPD5. Vitals and the invulnerability look are merged (owner).** Truth against the bullets you see; the roll's tint
  starts a few ticks after the predicted roll animation.
- **LPD6. On by default, no player setting** (like FPD8). `KV_PredictOff` stays a debug switch.
- **LPD7. No hitbox pip (owner).** Nothing is drawn at the merged position (`KV_CollisionDebug`'s merged ring is debug
  only).
- **LPD8. The camera follows the drawn knight (owner).** The knight stays steady on screen; corrections move the
  camera with it (its follow smoothing absorbs them).

## Tasks

- [ ] **LP0. Census.** Every rule that writes the local player's `x / z / face / roll / flask`, or reads a movement
  modifier (grep `movePlayer`, `p.x =`, `moveMultiplier`, `boostWalkPercent`, run mods; WALL_SLIDE's findings mention
  treasure / drop pushes: confirm or strike), each marked mirrored / held / corrected; every view site that reads the
  watched player's pose, each with its choice (Design 6 table). -> Verify: both tables in this doc, reviewed.
- [ ] **LP1. Motion mirror** (`predictMotionTick`, no weapons). -> Verify: `predictMotion.spec.ts`: on endless floors
  (seeds 1-20, breakables as solid cells, the slide mover) and M1, 10,000 random input ticks each (walks, held and
  tapped ROLL / FLASK, aim on and off, `quantizeAxis`'d sticks, a Quickstep boost running out) equal the real
  `stepPlayer`'s `x, z, prevX, prevZ, faceX, faceZ, rollTicks, rollDirX, rollDirZ, flaskTicks` bit for bit, with a
  sword in hand but no attack pressed; the merged state's hash is unchanged by a replay.
- [ ] **LP2. Weapon motion mirror** (sword guard / wind-up / lunge, bow charge, swaps). -> Verify: the same spec with
  ATTACK / ALT / SWAP in the random inputs, sword and bow, with and without builds (Swift Strikes, Frenzy, Bastion's
  guard), and under `setSwordTimings(WEB_SWORD_TIMINGS)`: positions bit for bit against a real single-player sim in an
  enemy-free room.
- [ ] **LP3. `LocalPredictor` in LockstepClient** (Design 2, 6, 7: inputs from queue / sent / repeat, horizon, rebuild
  in `pump`, `predicted()`, stats). -> Verify: lockstep specs: with prediction on vs off every simulated-network run
  (`NET_RUNS`) ends with identical hashes, logs and validator verdicts; in an enemy-free room at 20-120 ms the
  prediction error is exactly 0 apart from the client's own deadline misses; on real endless floors mean / max error
  and corrections are printed (the record for LP8); a bench prints the rebuild cost at 10 and 30 ticks (target < 0.1 ms
  a frame headless).
- [ ] **LP4. `PredictionSmoother`** (Design 4). -> Verify: `smoother.spec.ts`: a 0.3-tile correction decays below 0.01
  within 0.4 s at 30 / 60 / 144 fps and never moves the drawn pose by more than walk speed x dt + the decayed part in a
  frame; each snap rule; facing passes through; with no correction the drawn pose equals `lerp(prev, x, alpha)` exactly.
- [ ] **LP5. Wiring** (after FP3). `getDrawnPlayer`, the aim origin, the Design 6 sites, `KV_PredictOff`. -> Verify:
  `npm run verify`; Studio two-player test (Test > Clients and Servers, Incoming Replication Lag 100 ms): your knight
  walks, rolls and turns on the press, the teammate's view of you is unchanged, `KV_PredictOff` restores today's view.
- [ ] **LP6. Diagnostics** (Design 7; `KV_CollisionDebug`'s merged ring). -> Verify: Studio, the debug line shows the
  horizon, error and press -> drawn of 1 frame with prediction (the lead without).
- ~~**LP7. Hitbox pip.**~~ Dropped (LPD7, owner 2026-11-07).
- [ ] **LP8 [owner]. Playtest** (with FP6: the same group, 60 Hz and 120 Hz+ screens, a phone). On vs `KV_PredictOff`.
  -> Verify: the owner signs off LPD4, LPD5 and LPD8 in play (dodging with the 10-tick horizon, the merged roll tint,
  the camera); `maxTicks`, `halfLifeSec`, `snapTiles` set from LP6's numbers; corrections per minute recorded here.
- [ ] **LP9. Docs.** docs/SERVER.md "Clients" (the "Not done" line becomes the prediction), docs/FRAME_PACING.md (FPD2's
  pointer), docs/FEEL.md J9 and its non-goal line ("Co-op prediction ... its own plan"), CLAUDE.md's decision-log row,
  this file's status.

Order: LP0 -> LP1 -> LP2 -> LP3 -> LP4 (all pure, any time) -> FP1-FP3 land -> LP5 -> LP6 -> LP8 -> LP9.

## Testing

- **Headless:** the mirrors against the real sim (LP1, LP2), the predictor inside the lockstep network harness (its
  `Channel` gives random latency with ordered delivery) with prediction on and off (LP3), the smoother (LP4).
- **Studio:** Test > Clients and Servers with Incoming Replication Lag gives a fixed delay: enough to see the knight
  lead its merged position and to check corrections (a guard, a roll into a crate, a missed tick).
- **Published place:** real jitter and missed deadlines (LP8, with FP0 / FP6).

## Risks

- **The knight runs ahead of the bullets.** Inherent to predicting one entity. Mitigations: the cap (LPD4), merged
  vitals and look (LPD5). If LP8 finds dodging worse, lower `maxTicks`.
- **Mirror drift.** A later sim change to the player's motion or a weapon's `moveMultiplier` (e.g. docs/BUILDS_V2.md's
  Wrecker rolls that smash breakables) would mispredict until mirrored. LP1 / LP2's parity specs fail on any such
  change; the CLAUDE.md row tells the next plan to update the mirror.
- **Pickups look late.** You walk over a pellet or a boost and it goes a few ticks later (the sim eats it at the merged
  position). Accepted (LPD3); predicting pickups visually is a possible follow-up.
- **Corrections in a crowd.** Your own swing breaking a crate, a Charger smashing one in your path, the boss room's
  clamp, a draft opening: short glides or snaps. LP3's stats and LP8 say whether any is common.
- **Shared scratch in the sim.** The predictor calls `movePlayer` / the resolver between steps; any module scratch they
  use is rewritten before the sim reads it again. LP3's on / off hash equality guards against a hidden cache.
