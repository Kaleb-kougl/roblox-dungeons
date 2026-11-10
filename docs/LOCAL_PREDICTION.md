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

## Status (2026-11-10)

**LP0-LP6 and LP10's code built** (branch `local-prediction`; LP10 built on `lp-bullets`, rebased in): the census, the
motion mirror, the LocalPredictor in LockstepClient, the smoother (LP0-LP4, "As built" below), the wiring and the
diagnostics (LP5 / LP6, "As built: LP5 / LP6"), enemy bullets drawn ahead (LP10, "As built (LP10)"). Open: the
Studio checks of LP5, LP6 and LP10 (owner), LP8 and LP9. The horizon cap is 20 ticks since 2026-11-10 (LPD4, owner,
after a Studio test on a simulated 4G link: lead 17-23 ticks, `press->drawn` 253 ms against `press->step` 422 ms at 10).

Drafted from an audit of branch `frame-pacing` @ `0a8e8ec4` (docs/FRAME_PACING.md: planned,
nothing built). It builds on frame pacing (LPD2): FP1's lead fix and FP2-FP3's playout clock come first for the
wiring (LP5); the pure parts (LP1-LP4) can be built before them. Owner answers (2026-11-07): a 10-tick horizon
(LPD4), no hitbox pip (LPD7), the i-frame look merged (LPD5), the camera on the drawn knight (LPD8).
Rollback spike (2026-11-09): docs/ROLLBACK_SPIKE.md measures full co-op rollback against this plan as the cheaper
alternative. Its RBD8 (owner, 2026-11-09): don't build rollback, build this plan (too slow on an iPhone 17, and
teammate corrections far over the gate). Its cheap plan, enemy bullets drawn ahead, is LP10 here.

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

## Census (LP0, 2026-11-09)

From branch `local-prediction` @ `f6f6e6cc` (main: the Archer, frame pacing revision 2 and the rollback spike merged).
**Mirrored**: `predictMotion.ts` replays it exactly. **Held**: the base's value is kept over the horizon.
**Corrected**: not predicted; the next rebuild from a newer merged state shows the difference (the smoother's offset or
a snap, Design 4).

### What moves the local player's body, or changes how it moves

| Rule | Where (sim) | When in the tick | Choice |
|---|---|---|---|
| `prevX / prevZ = x / z` | player.ts `stepPlayer` 1 | stepPlayer | mirrored |
| `rollTicks`, `flaskTicks` count down | `stepPlayer` 3 | stepPlayer | mirrored (`iframeTicks` / `hurtTicks` held: they never move the body) |
| ROLL press edge: direction (move, else facing), `rollTicks = ROLL_TICKS` | `stepPlayer` 4 | stepPlayer | mirrored (Slippery's and the trait's i-frames skipped: no motion) |
| FLASK press edge: a charge, missing health, not drinking; heals, `flaskTicks` | `stepPlayer` 4 | stepPlayer | mirrored on the scratch (`flask`, `hearts` from the base; a hit or heal inside the horizon is corrected) |
| The roll's step: dash `scalePercent(ROLL_DASH_STEP, traits.rollDashPercent)` (the Archer's 140 %), then the recovery | `stepPlayer` 5 | stepPlayer | mirrored (traits from the run config, `playerTraits`) |
| The walk: `WALK_STEP` x flask 0.5 x `weaponMoveMultiplier` x Quickstep 130 % | `stepPlayer` 5, `boostWalkPercent` | stepPlayer | mirrored (Quickstep's timer counted down from the base, as stepDrops 3 does after the step) |
| `movePlayer`: the world's `moveResolver` (`playerMover`: the slide, or `PlayerMover.WEB`) in sub-steps of `MAX_MOVE_STEP`, with `solidCells(state)` | player.ts | stepPlayer; the sword's lunge | mirrored: the same function, the floor's `simWorldConfig`, the merged state's pieces (read only; it writes only the scratch player) |
| Facing: aim, else the roll's direction, else the move | `stepPlayer` 6 | stepPlayer | mirrored |
| Wrecker's roll smash: the pieces the roll step touches break before it moves | builds/wrecker.ts `buildsRollSmash` | stepPlayer, before the roll's move | **corrected**: the mirror breaks nothing, so a Wrecker roll into a crate is predicted to stop at it (follow-up: a solid view without the pieces the step would smash) |
| The boss's room seal clamps every player inside the arena while the fight is on | boss/shared.ts `sealArena` (209) | stepCombat 2 (actors) | corrected (only matters at a corridor mouth) |
| The sword: guard (`SWORD_V_GUARD` > 0: x 0.5), finisher wind-up (`SWORD_V_STEP` = WINDUP: x 0.35) | sword.ts `step`, `moveMultiplier` | stepCombat 4 (weapons) | mirrored (LP2): swap / roll resets, a guard on an ALT edge off cooldown (`swordGuardTicks`: Bastion), busy / window, swings 1-2, the wind-up's start (`attackTicks`: Swift Strikes, and Frenzy from the predicted Frenzy timer) |
| The finisher's lunge: `lungeDistance / finisherWindupTicks` a tick along the facing, through `movePlayer` | sword.ts 312 | stepCombat 4 | mirrored |
| The bow's charge (`BOW_V_CHARGE` > 0: x 0.5); a roll or a swap cancels it; `bowChargeTicks` (Ballista) | bow.ts `step`, `moveMultiplier` | stepCombat 4 | mirrored (LP2). The stream, the heavy arrow and the cooldowns they set never change the walk: not mirrored |
| SWAP press edge: the next set; onto an empty set nothing (ARD3) | weapons.ts `stepWeapons` 3 | stepCombat 4 | mirrored (the predicted active set) |
| Every set's cooldown counts down | `stepWeapons` 1 | stepCombat 4 | mirrored (the sword's guard cooldown gates the next guard) |
| A weapon with no mirror (the spec-only test weapons) | `weaponMoveMultiplier` | | held: its slot stays the base's, so its `moveMultiplier` is the merged one |
| Frenzy's timer (Swift Strikes' percent x 70 %) | boostMods.ts `boostAttackTicksPercent` | read in stepCombat 4, counted down in stepDrops 3 | mirrored (counted down from the base) |
| A boost picked up (a ground drop, a breakable's loot, a vault's reward straight to the player) | drops.ts, breakLoot.ts 78 | stepDrops / stepTreasure | corrected |
| A hit: hearts / armor (the flask's missing-health test), death (`killPlayerState` ends the roll and the flask) | player.ts `damagePlayer` | stepCombat 6-7 | corrected (death stops the predictor) |
| The floor change: every player to the spawn, the dead revived | endless.ts 287 | stepEndless | corrected (a snap) |
| Revive / leave (`revivePartyMember`, `markPlayerLeft`) | party.ts | stepEndless / stepParty 2 | corrected (the predictor stops while dead or left) |
| A draft freezes the world (its ticks set `prevX = x` and the buttons) | step.ts `isDraftOpen`, progression.ts 368 | instead of the step | not predicted (the predictor stops while any draft is open) |
| A teammate's swing (lower index) or a Charger breaking a piece in the same tick, before the local lunge | sword.ts, charger.ts | stepCombat 2 / 4 | corrected (pieces are read from the merged state) |
| `respawnPlayer` | player.ts | nothing calls it in a run | n/a |
| WALL_SLIDE's "treasure / drop pushes" | | | **struck**: nothing in the sim pushes a player (every write to a player's x / z is listed above) |

### What reads the watched player's pose (view)

The plan's 12 sites plus the ones added since (builds v2, the run recap, team moments, pacts, the decor plan). "Drawn":
`getDrawnPlayer`'s pose for the local player; "merged": `playerAt(state, view)` as today. Planners that take the view
index only to choose whose events to show (NearMiss, Siege, Wrecker, Overcap, CounterWave, HeartBeam, BuildFx, the
pellet / Golden freezes, Audio's per-player split, FreezeFrame / HurtFlash) read no pose: unchanged.

| Site | Reads | Choice | Why |
|---|---|---|---|
| ActorRenderController `drawPlayer` (831), through shared/view sprites.ts 532 `playerSpriteInput` / `archerSpriteInput` | x, z, prev, face, roll, walk speed | drawn (sprite / capsule, ring, squash, afterimages, outline) | It is the knight |
| ActorRenderController look (i-frame tint), hurt blink, death | iframe / hurt / dead | merged | LPD5 |
| CameraController (74) | x, z, prev | drawn | LPD8 |
| WeaponViewController (128) | x, z, prev, face; swing timing | drawn pose and facing; timing merged | Attached |
| BoostAuraController (178, the local player in its loop) | x, z, prev | drawn | Attached |
| ComboController shout feet (417) | x, z, prev | drawn | Attached |
| ParryFlashController centre (175) | x, z, prev | drawn | Attached |
| GoldenRenderController label fallback (274) | x, z, prev | drawn | Attached |
| MinimapController self marker (827) | x, z, prev, face | drawn | Same knight on both |
| MinimapController fog sources (740), mates, room edges, pickups | x, z | merged | Sim truth |
| HudOcclusionController (163) | x, z, prev | drawn | Fades what covers the knight you see |
| InputController touch facing / auto-target origin (662) | face, x, z | drawn | The aim's origin |
| SimController `coopFrame` mouse aim origin (1161, `sample(me.x, me.z)`) | x, z | drawn | The aim's origin |
| CollisionDebugController (140) | x, z | both (a second ring for merged) | Debug |
| TutorialArrowController (110) | x, z | unchanged | Solo only |
| shared/view fxCues.ts 663 (the flask / Ember cue at the player) | x, z, prev | drawn (local player) | Attached |
| shared/view nearMissRules.ts 443 / 501 / 580 (graze sparks, the parry burst and flash) | x, z | drawn (local player) | Attached |
| shared/view buildFxRules.ts 936 (brace rings follow their player); buildFxEvents.ts 651 (brace), 582 (Ballista's back direction) | x, z | rings drawn; the Ballista direction merged | Rings attached; the direction is the sim's |
| ParticleController 330 (the pellet ring at the taker), 487 (the power fly-in's target) | x, z | drawn (local player) | Attached |
| shared/view decor/render.ts 49 (decor fades round player bodies) | x, z | drawn (local player) | Fades what covers the knight you see |
| shared/view hitReact.ts 112 (an enemy's push away from the nearest player) | x, z, prev | merged | Reaction to the sim's hit |
| RoomClearController 146 (near / far), RecapController 683 (stairs path), pacts.ts 263 (cards near), sighting.ts 81, decor director.ts 396, TeamMomentsController 161 (debug fakes) | x, z | merged | Sim truth, prompts, run-over numbers |
| watch.ts, lowHealth.ts, recapTally.ts, teamMomentsView.ts | hearts, dead | merged | LPD5 |

LP5 routes every "drawn" row through `getDrawnPlayer(index)` (the shared/view helpers that read `playerAt` themselves
take a player instead where they draw).

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

- keeps the head it was last fed and its tick; the predictor keeps its **path** (every replayed tick's position, the
  merged one first), so on a rebuild the smoother adds `old - new` at the old head's tick to a visual **offset**, and
  the drawn knight does not jump (as built: the path replaced the planned ring of `maxTicks + 2`, because a pump that
  steps two ticks leaves no newer head for the old head's tick; an old head past the new path's end is compared with
  the new head, one before its start with the merged position);
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

**Bullets drawn ahead (LP10, LPD9).** Closes that gap: the enemy-bullet renderers
(`BulletRenderController.frame` and the sprite pool) draw each enemy bullet `n` ticks past the merged state, `n` = the
knight's prediction offset this frame (0 solo or with `KV_PredictOff`, at most `maxTicks`), so the knight and the
bullets show the same tick. Per bullet, read-only, from its interpolated position: the remaining spawn delay first, then
the sim's own stepping in closed form, `p + v t + a dt^2 n(n+1)/2` (`t = n dt`, `dt` = SIM_DT x the Hourglass scale
active on the merged state); hidden once its life would run out, stopped at the floor's bullet blocker or an intact
piece. Exact while it flies: enemy bullets are ballistic in the sim (the only steered bullets are player Soul Swarm
shards, builds/evolutions.ts; player bullets stay merged). Not exact, at the ends of a bullet's life:
- a new shot appears up to `n` ticks along (at most ~0.7 tiles; fading it in over `n` ticks hides most of it);
- a bullet removed in the next `n` ticks (it hits a teammate or you, a guard or an erase takes it) flies on for up to
  `n` ticks past that point;
- a Hourglass slow that starts inside the window overshoots for a moment.
Nothing in the sim, the hashes or the hits changes; enemies, teammates and vitals stay merged. This is the rollback
spike's "cheap plan" (docs/ROLLBACK_SPIKE.md: in-flight bullets exact, its glitch counts are the shots fired and removed
above; a headless version was `shared/lockstep/rollbackSpike/model.ts`, removed in its R7: `git show f6f6e6c:<path>`).

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

`predictionStats()`: when tick K is stepped, the merged pose at K is compared with the head last predicted for K (the
pose drawn for that tick; as built, not the prediction one rebuild earlier, which is nearly always truth already):
mean / max error (tiles) over `statsWindowTicks` (600), corrections (error > `correctionTiles` 0.01), and run totals
(compared, corrections, max). Snaps are the smoother's (`snapCount()`). The co-op
debug line (docs/FEEL.md J9) gains `pred {h}t · err {mean}/{max} · snaps {n}`; the latency probe gains **press ->
drawn** (frames until the drawn knight first answers a press: 1 with prediction, the lead without).

## Tunables (`PREDICTION`, shared/lockstep/config.ts; the smoother's `PREDICTION_VIEW`, shared/view/predict/config.ts)

| Name | Value | Why |
|---|---|---|
| `maxTicks` | 20 | 333 ms (owner, LPD4; 10 until 2026-11-10): covers a 4G-like lead; enemy bullets are drawn as far ahead (LP10) |
| `halfLifeSec` | 0.06 | A correction is mostly gone in ~4 frames, without a visible glide |
| `snapTiles` | 1.0 | Larger than any guess error from a missed tick; teleports and clamps snap |
| `maxOffsetTiles` | 1.0 | Never drawn farther than this from the prediction |
| `statsWindowTicks` | 600 | 10 s, like the pacing windows |
| `correctionTiles` | 0.01 | A stepped tick farther than this from its head counts as a correction (stats only) |

All provisional until LP8.

## Decisions (LPD1-LPD3, LPD6 proposed; LPD4, LPD5, LPD7, LPD8 the owner's answers, 2026-11-07; LPD9 the owner's, 2026-11-09)

- **LPD1. Mirror, not refactor.** The motion and weapon-motion replays are copies in shared/lockstep, pinned to the
  sim by parity specs, so `shared/sim` is not touched at all (the brief). Considered: extracting `stepPlayer`'s motion
  into a shared function (zero drift, but a sim edit that every fixture would have to re-prove).
- **LPD2. Built on frame pacing.** Inputs are sampled once per stepped tick, so without the playout clock the predicted
  head advances in bursts and the knight stutters like the world does today. The wiring (LP5) waits for FP1-FP3; the
  pure parts do not. Considered: sampling on a local clock of its own (a change of the lockstep client's send cadence:
  out of scope).
- **LPD3. Body only.** Attacks, hits, pickups and other players are not predicted (no rollback): nothing is drawn that
  the sim may not do, except your own walk and roll a few ticks early.
- **LPD4. Horizon: the effective lead, capped at `maxTicks` 20 (333 ms; owner).** Felt delay of the walk drops to one
  frame up to the cap; above it the rest (`lead - maxTicks`) stays. LP8 may retune it against the bullet gap. Raised
  from 10 (167 ms) on 2026-11-10 (owner): on a simulated 4G link the lead sat at 17-23 ticks, so 10 left about 250 ms
  of the delay; enemy bullets are drawn ahead with the knight (LP10, up to `BULLET_AHEAD.maxTicks` 30), and teammates
  and enemies stay merged, so the knight runs up to 333 ms ahead of them and corrections grow with the horizon.
- **LPD5. Vitals and the invulnerability look are merged (owner).** Truth against the bullets you see; the roll's tint
  starts a few ticks after the predicted roll animation.
- **LPD6. On by default, no player setting** (like FPD8). `KV_PredictOff` stays a debug switch.
- **LPD7. No hitbox pip (owner).** Nothing is drawn at the merged position (`KV_CollisionDebug`'s merged ring is debug
  only).
- **LPD8. The camera follows the drawn knight (owner).** The knight stays steady on screen; corrections move the
  camera with it (its follow smoothing absorbs them).
- **LPD9. Enemy bullets drawn ahead with the knight (owner, 2026-11-09, after docs/ROLLBACK_SPIKE.md RBD8).**
  Cosmetic only (Design 5). Built straight after LP5, before the LP8 playtest, so LP8 plays the full plan.

## Tasks

- [x] **LP0. Census.** Every rule that writes the local player's `x / z / face / roll / flask`, or reads a movement
  modifier (grep `movePlayer`, `p.x =`, `moveMultiplier`, `boostWalkPercent`, run mods; WALL_SLIDE's findings mention
  treasure / drop pushes: confirm or strike), each marked mirrored / held / corrected; every view site that reads the
  watched player's pose, each with its choice (Design 6 table). -> Verify: both tables in this doc, reviewed.
- [x] **LP1. Motion mirror** (`predictMotionTick`, no weapons). -> Verify: `predictMotion.spec.ts`: on endless floors
  (seeds 1-20, breakables as solid cells, the slide mover) and M1, 10,000 random input ticks each (walks, held and
  tapped ROLL / FLASK, aim on and off, `quantizeAxis`'d sticks, a Quickstep boost running out) equal the real
  `stepPlayer`'s `x, z, prevX, prevZ, faceX, faceZ, rollTicks, rollDirX, rollDirZ, flaskTicks` bit for bit, with a
  sword in hand but no attack pressed; the merged state's hash is unchanged by a replay.
- [x] **LP2. Weapon motion mirror** (sword guard / wind-up / lunge, bow charge, swaps). -> Verify: the same spec with
  ATTACK / ALT / SWAP in the random inputs, sword and bow, with and without builds (Swift Strikes, Frenzy, Bastion's
  guard), and under `setSwordTimings(WEB_SWORD_TIMINGS)`: positions bit for bit against a real single-player sim in an
  enemy-free room.
- [x] **LP3. `LocalPredictor` in LockstepClient** (Design 2, 6, 7: inputs from queue / sent / repeat, horizon, rebuild
  in `pump`, `predicted()`, stats). -> Verify: lockstep specs: with prediction on vs off every simulated-network run
  (`NET_RUNS`) ends with identical hashes, logs and validator verdicts; in an enemy-free room at 20-120 ms the
  prediction error is exactly 0 apart from the client's own deadline misses; on real endless floors mean / max error
  and corrections are printed (the record for LP8); a bench prints the rebuild cost at 10 and 30 ticks (target < 0.1 ms
  a frame headless).
- [x] **LP4. `PredictionSmoother`** (Design 4). -> Verify: `smoother.spec.ts`: a 0.3-tile correction decays below 0.01
  within 0.4 s at 30 / 60 / 144 fps and never moves the drawn pose by more than walk speed x dt + the decayed part in a
  frame; each snap rule; facing passes through; with no correction the drawn pose equals `lerp(prev, x, alpha)` exactly.
- [x] **LP5. Wiring** (code done 2026-11-10; **the Studio two-player check below is open, owner**). `getDrawnPlayer`, the aim origin, the Design 6 sites, `KV_PredictOff`. -> Verify:
  `npm run verify`; Studio two-player test (Test > Clients and Servers, Incoming Replication Lag 100 ms): your knight
  walks, rolls and turns on the press, the teammate's view of you is unchanged, `KV_PredictOff` restores today's view.
- [x] **LP6. Diagnostics** (code done 2026-11-10; **the Studio check below is open, owner**; Design 7; `KV_CollisionDebug`'s merged ring). -> Verify: Studio, the debug line shows the
  horizon, error and press -> drawn of 1 frame with prediction (the lead without).
- ~~**LP7. Hitbox pip.**~~ Dropped (LPD7, owner 2026-11-07).
- [ ] **LP8 [owner]. Playtest** (with FP6: the same group, 60 Hz and 120 Hz+ screens, a phone). On vs `KV_PredictOff`.
  -> Verify: the owner signs off LPD4, LPD5 and LPD8 in play (dodging with the 10-tick horizon, the merged roll tint,
  the camera); `maxTicks`, `halfLifeSec`, `snapTiles` set from LP6's numbers; corrections per minute recorded here.
- [ ] **LP9. Docs.** docs/SERVER.md "Clients" (the "Not done" line becomes the prediction), docs/FRAME_PACING.md (FPD2's
  pointer), docs/FEEL.md J9 and its non-goal line ("Co-op prediction ... its own plan"), CLAUDE.md's decision-log row,
  this file's status.
- [ ] **LP10. Bullets drawn ahead** (Design 5, LPD9; after LP5, before LP8). A pure `bulletAhead(sim, i, n, scale, blocked)` in
  shared/view/predict plus the renderers' `aheadTicks` argument from `getDrawnPlayer`'s offset. -> Verify: a spec over
  real floors: with no shot fired or removed in the window, every drawn enemy bullet equals the merged state's bullet
  `n` ticks later (a stepped copy) to 1e-9, for n 1..10, with the spawn delay and the Hourglass; walls and pieces stop
  it, an expired one is hidden; n = 0 draws exactly today's positions; a bench at 150 bullets under 0.05 ms a frame.
  Studio, Incoming Replication Lag 100 ms: a tight dodge through a stream is not hit, the off switch restores today's.
  - [x] Code (built on branch `lp-bullets`, now on `local-prediction`, 2026-11-10; "As built (LP10)"). The Studio dodge check stays open (owner). The
    renderers read LP5's `SimController.getPredictionAheadTicks()` (the branch's stub dropped in the rebase).

Order: LP0 -> LP1 -> LP2 -> LP3 -> LP4 (all pure, any time) -> FP1-FP3 land -> LP5 -> LP10 -> LP6 -> LP8 -> LP9.

## As built (LP1-LP4, 2026-11-09)

- **Mirror** (`shared/lockstep/predictMotion.ts`): `MotionScratch` (a PlayerState, a WeaponsState, the Quickstep and
  Frenzy timers), `copyMotionBase(out, state, i)`, `predictMotionTick(s, state, input, world, i, traits)`. Order:
  stepPlayer's motion steps, then stepWeapons' (cooldowns, SWAP, the sword's guard / combo / wind-up and lunge, the
  bow's charge), then the two boost timers count down like stepDrops. `attackTicks` is recomputed with the predicted
  Frenzy timer. Other weapons keep their slot (held).
- **Parity** (`predictMotion.spec.ts`, ~35 s headless): per tick AND over 10-tick horizons from one merged state:
  endless dev floors (20 seeds, start floors 1-4 / 6-9, Knight / Archer / both weapons with swaps, god mode; Swift
  Strikes, Bastion and Ballista granted along the way, boosts set to run out, wounds for the flask), a co-op party of
  two (both players), M1 without enemies with the slide and the web mover, the port's and the web sword's timings.
  10,000 + 4,000 + 10,000 ticks compared, 960 horizons, 0 differences, 0 excused; it prints what the walks covered
  (guards, Bastion guards, wind-ups, charges, swaps, wall contacts, Quickstep, Frenzy, flasks) and requires each.
  Sabotaging the lunge by 0.1 % or dropping Frenzy from `attackTicks` fails it.
- **Predictor** (`shared/lockstep/predict.ts`): `LocalPredictor.rebuild(src)` / `observe(state, i)` / `predicted()` /
  `predictedPath()` / `stats()`, `PredictionSource` (LockstepClient implements it; specs fake it), `PredictedPath`,
  `PredictionStats`. A tick never sent repeats the previous replayed input; the first such tick repeats the last
  stepped frame's own input (`LockstepClient.lastSteppedInput()`), exactly the relay's repeat-last.
- **Client**: `LockstepTunables.prediction` (`DEFAULT_LOCKSTEP.prediction` = `PREDICTION`; lockstep.spec's and
  rollbackAccessors.spec's TUNABLES pass `undefined`), `predicted()`, `predictedPath()`, `predictionStats()`. Observed
  after every stepped tick, rebuilt after every pump that stepped (or while nothing is predicted), stopped once the run
  is over here.
- **predict.spec.ts**: a scripted server and an oracle (M1 without enemies, two walkers, bursts of 0-3 ticks, one step
  a pump): with no misses 1488 of 1488 judged heads exact (the first 12 ticks, never sent, not judged), a miss every 97
  ticks 1373 exact, 115 not (the misses), and every head whose inputs the server takes is exact; a twin client without
  prediction sends, hashes and claims the same, both states hash the same every pump; dead / draft stops; the
  merged state's hash unchanged; bench **0.030 ms a rebuild at 10 ticks, 0.084 ms at 30** (headless, aarch64 VM).
- **predict.net.spec.ts** (the shipped client: paced, measured lead): 3 players 20-120 ms and 2 players 0-200 ms, on
  endless and M1 without enemies: prediction on and off give the same log, final claims, client hashes and server
  verdict. The record for LP8 (scripted bots, about 37 s of play each): 4-18 corrections a player, all in the first
  seconds while the lead settles (0 in the last 10 s), largest 0.06-0.60 tiles; lead 18 (20-120 ms) and 26-27 (0-200 ms)
  ticks, so the horizon sits at its cap. The endless and M1 numbers are equal: the bots stay near the spawn, so only
  the misses correct. A real endless fight (pickups, pieces, the boss's seal) is LP8's to measure.
- **Smoother** (`shared/view/predict`): `PredictionSmoother.feed(head, path)` / `draw(alpha, dt)` / `snap()`,
  `PREDICTION_VIEW` (halfLifeSec 0.06, snapTiles 1, maxOffsetTiles 1). `smoother.spec.ts`: no correction draws exactly
  `lerp(prev, x, alpha)`; a 0.3-tile correction is under 0.01 tiles 0.4 s later at 30 / 60 / 144 fps and the body never
  moves more than the walk's frame plus what the offset gave up; the snap rules, several ticks a pump, the clamp,
  facing.
- **Verify**: typecheck, lint, check:assets, check:autolocalize, test:art 273, test:checks 8, test:l10n 36,
  test:rollback 6, build. Lune on the VM: every spec under shared/lockstep, shared/view, shared/spikes and shared/play
  plus 4 more, 227 files, pass; 3 time out at the VM shell's cap (affixes.census, minimap/tiles, roomEdges: the known
  slow ones, which import none of this). The other 242 spec files (sim, dungeon, run, theme, ...) were not run: none
  imports shared/lockstep or shared/view/predict, and no file they load changed.

## As built: LP5 / LP6 (2026-11-10)

- **SimController** owns the `PredictionSmoother` (`PREDICTION_VIEW`) and, once per co-op frame after the pump and the
  spectate update (`updateDrawn`), feeds it `coop.predicted()` / `coop.predictedPath()`, or undefined while the views
  follow a teammate or the stage cover is up (the client itself predicts nothing while dead or left, a draft is open,
  the run is over, or with KV_PredictOff). Snaps: a run start, a floor change and a spectate switch (`snap()`); death,
  revive and a draft through the undefined feed (the next prediction starts fresh).
- **`getDrawnPlayer(state, index)`**: while predicting, the local player as drawn (shared/view/predict
  `writeDrawnPlayer`: the head's position plus the smoother's offset, its prev plus the same offset, facing, roll timer
  and direction, the flask's slowdown timer; every other field the merged player's: hearts, armor, flask charges,
  Embers, i-frames, the hurt blink, death, buttons); otherwise, and for every other player, exactly
  `playerAt(state, index)` (solo is unchanged). A view's `lerp(prev, x, alpha)` gives the smoothed pose, `x - prevX`
  the head's step (the walk animation). `drawnPlayerOf` is the same as a `DrawnPlayerOf` function value for the
  shared/view helpers (`drawnOrMerged`).
- **`getPredictionAheadTicks()`**: the predictor's horizon this frame (`LockstepClient.predictionHorizonTicks()`, at
  most `PREDICTION.maxTicks`) while `getDrawnPlayer` draws the local player predicted, else 0. LP10's bullets read it.
- **Aim**: `coopFrame` samples the mouse aim from the drawn pose of the previous frame, and the touch facing /
  auto-target from the drawn body (`TouchAimContext.player`, `AutoTargetQuery.player`, both optional: absent is the
  merged player as before).
- **Views on the drawn player** (the census's "drawn" rows): ActorRenderController (position, facing, roll, squash /
  afterimages, outline, sprite input through `playerSpriteInputFor`'s new trailing `p`; the look, the hurt blink and
  death read the merged fields the drawn player keeps), CameraController, WeaponViewController (the windup / guard /
  charge on the drawn knight; the last swing's fan and blade are the sim's swing shifted by drawn - merged this
  frame), BoostAuraController, ComboController, ParryFlashController, GoldenRenderController's label, the minimap's
  self marker, HudOcclusionController, FxCueMapper (`FxCueFrame.drawn`), NearMissDirector and BuildFxDirector
  (`frame(..., drawn)`), ParticleController's pellet ring and power fly-in, DecorController's fades
  (`decorFadeBodies(..., drawn)`). Every "merged" row is untouched.
- **KV_PredictOff** (`RUN_ATTRIBUTES.predictOff`, read at each co-op start, combinable with KV_PacingOff / KV_LeadOff):
  the client is built with `prediction: undefined`; `RunContext.predictOff`.
- **LP6**: the co-op debug line's `{pred}` part (developer strings `hud.debug.pred` / `.predWait` / `.predOff`,
  HUD_STRINGS `predProbe*`, English only like every `hud.debug*` key; no l10n context needed): `pred {h}t · err
  {mean}/{max} · snaps {snaps} · press->drawn {drawn}ms avg {drawnMean}` (errors in tiles, 2 decimals, the head error
  over the stats window; snaps the smoother's). `LatencyProbe.drawn(nextTick, ahead, now)`: a press is answered on
  screen once the drawn knight shows its tick (with prediction: once `state.tick + horizon` passes it; without, it is
  press -> step). KV_CollisionDebug: the body ring follows the drawn knight, a second ring (`uiTextDim`, 0.5
  transparency) marks the merged body while predicted (`collisionRings`); the cells and the stall flash stay merged.
- **Verify**: typecheck, lint, build; Lune: every spec under shared/lockstep, shared/view, shared/play and
  shared/spikes, 205 files, pass (drawn.spec, predictDebug.spec new; latencyProbe.spec's pinned lines gain the part);
  roomEdges.spec and minimap/tiles.spec time out at the VM shell's cap (the known slow ones, as before).
- **Open (owner, Studio)**: LP5's two-player check (Test > Clients and Servers, Incoming Replication Lag 100 ms: the
  knight walks, rolls and turns on the press; the teammate's view of you unchanged; KV_PredictOff restores today's
  view) and LP6's (the debug line's horizon, error and press -> drawn of about one frame with prediction, the lead
  without; the merged ring). Not checked headlessly: anything client-side (it compiles and lints only).

## As built (LP10, 2026-11-10)

- **Core** (`shared/view/predict/bulletAhead.ts`, presentation only): `BulletAhead.prepare(state, world, n)` once a frame
  (n clamped to `BULLET_AHEAD.maxTicks` 30, the predictor's own cap is the real one), then `pose(sim, i, out)` per slot:
  the bullet's (prev, cur) pair n ticks past the merged state, which the renderers lerp by alpha as today. Mirrors
  combat/bullets.ts `step` and combat.ts's enemy collision walk: tick k steps by SIM_DT x HOURGLASS_TIME_SCALE while
  any run player's `hourglassTicks` > k (consumeEnemyBulletTimeScale counts each down once a tick), else SIM_DT; a
  spawn delay is replayed step by step (`replay`; always 0 in the sim); life counted down tick by tick when it might
  run out (gone: hidden); the culling cube at the end (convex; `math.huge` on dungeon floors); the floor's bullet
  blocker or an intact piece's cell stops it: drawn still at its last free position (prev = cur) until the merged
  state removes it. Goo and strikes keep today's pair. n = 0 is today's pair exactly.
- **What the doc's formula missed**: no enemy bullet accelerates (the pool keeps an acceleration, nothing sets one and
  there is no accessor; the term is dropped, and the spec against the real sim would catch one); the Hourglass is not
  one scale for the window but ends after the larger `hourglassTicks` (handled per tick); positions use the closed form
  pos + vel x (dt_0 + ... + dt_(k-1)), measured within 7.1e-14 of the sim's k additions on real floors; walls and pieces
  answer per grid cell, so a bullet that stays in its cell is not tested, one that leaves it tests the box of cells to
  its end, and only then are its tick positions tested to find the stopping tick.
- **No fade-in**: the pool keeps no age to fade a young shot by (Design 5's option dropped); a new shot appears up to n
  ticks along.
- **Renderers**: `BulletPool.frame(..., ahead?)` and `SpriteBulletPool.frame(..., ahead?)` (enemy pools only; with
  `ahead` they draw live slots `pose` keeps, else today's code unchanged); BulletRenderController prepares one
  `BulletAhead` a frame from `SimController.getPredictionAheadTicks()` and `simWorldConfig(state, ctx.config)`.
- **Spec** (`bulletAhead.spec.ts`): 6 endless floors (god mode, the busiest room, 40 windows of 10 ticks, the
  Hourglass at 0 / 4 / 15 ticks): 5200 poses n = 1..10 compared with the stepped state, max difference 7.1e-14; 244
  stopped at a wall or piece exactly where the sim consumed them; 166 hidden exactly when their life ran out; 0
  removed otherwise; a pool of its own covers the delay, the life and the cube; n = 0 exact.
- **Bench** (headless, aarch64 VM, 150 bullets, 10 ticks): 0.32 ms a frame on a real floor's blocker (0.28 ms with no
  blocker) against 0.11 ms for today's pairs through the same accessors. The plan's 0.05 ms target is missed: it is
  under what reading today's pairs costs headless; the real number is the Studio MicroProfiler's
  (`BULLET_VIEW.profileLabel`).

## Testing

- **Headless:** the mirrors against the real sim (LP1, LP2), the predictor inside the lockstep network harness (its
  `Channel` gives random latency with ordered delivery) with prediction on and off (LP3), the smoother (LP4).
- **Studio:** Test > Clients and Servers with Incoming Replication Lag gives a fixed delay: enough to see the knight
  lead its merged position and to check corrections (a guard, a roll into a crate, a missed tick).
- **Published place:** real jitter and missed deadlines (LP8, with FP0 / FP6).

## Risks

- **The knight runs ahead of the bullets.** Inherent to predicting one entity. Mitigations: enemy bullets drawn ahead (LP10) close
  most of it; the cap (LPD4), merged vitals and look (LPD5). If LP8 still finds dodging worse, lower `maxTicks`.
- **Mirror drift.** A later sim change to the player's motion or a weapon's `moveMultiplier` (e.g. docs/BUILDS_V2.md's
  Wrecker rolls that smash breakables) would mispredict until mirrored. LP1 / LP2's parity specs fail on any such
  change; the CLAUDE.md row tells the next plan to update the mirror.
- **Pickups look late.** You walk over a pellet or a boost and it goes a few ticks later (the sim eats it at the merged
  position). Accepted (LPD3); predicting pickups visually is a possible follow-up.
- **Corrections in a crowd.** Your own swing breaking a crate, a Charger smashing one in your path, the boss room's
  clamp, a draft opening: short glides or snaps. LP3's stats and LP8 say whether any is common.
- **Shared scratch in the sim.** The predictor calls `movePlayer` / the resolver between steps; any module scratch they
  use is rewritten before the sim reads it again. LP3's on / off hash equality guards against a hidden cache.
