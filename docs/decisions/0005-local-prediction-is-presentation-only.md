# 5. Local prediction is presentation only

Status: built and signed off 2026-11-10 (decisions LPD1 to LPD9 in [`../LOCAL_PREDICTION.md`](../LOCAL_PREDICTION.md)).

## Context

In co-op the sim steps only merged frames, so a press is drawn after the input lead plus the playout buffer.
On a simulated 4G link the lead sat at 17 to 23 ticks (283 to 383 ms) between a key and the knight moving.
Rollback had just been measured and rejected ([record 4](0004-rollback-measured-then-not-built.md)). The
client already held everything a narrower prediction needs: every input it sent that has not been stepped yet,
and the server's finalized frames still in its queue.

## Options considered

- **Rollback of the whole world.** Rejected by measurement.
- **Extract the player's motion out of the sim into a function both the sim and the predictor call.** No
  drift is possible, but it edits `shared/sim`, and every golden fixture would have to re-prove the edit (LPD1).
- **Predict more than the body**: attacks, hits, pickups. Anything drawn that the sim then refuses has to be
  undone on screen (LPD3).
- **Mirror the body's motion outside the sim** and draw only that ahead.

## Decision

The local player's body, and nothing else, is drawn ahead of the merged state.

- [`predictMotion.ts`](../../src/shared/lockstep/predictMotion.ts) is a line-for-line copy of what moves the
  body in one tick (walk, roll, facing, the weapon and flask slowdowns, the sword's lunge), run on scratch
  objects. It reads the merged state and never writes it. The sim is not touched.
- [`LocalPredictor`](../../src/shared/lockstep/predict.ts) replays it from the merged tick: the server's queued
  frames first, then the frames this client sent, up to `PREDICTION.maxTicks` (20 ticks, 333 ms).
- A smoother in `shared/view` absorbs corrections and snaps past one tile.
- Hits, hearts, the invulnerability look, pickups, teammates and enemies stay at the merged state (LPD5).
  Enemy bullets are drawn ahead by the same number of ticks in closed form, as a cosmetic (LPD9).

Nothing predicted reaches the sim, a hash, a recording or a remote. The lockstep wire and the server are
unchanged.

## Consequences

- Determinism and validation are untouched by construction: a wrong prediction is a visual correction, never
  a desync.
- The mirror can drift from the sim. A parity spec pins it to the real sim bit for bit, so a sim change to
  the player's motion fails that spec until the mirror follows. This is now a standing rule in `CLAUDE.md`.
- What the mirror does not model (a hit, the boss's seal, a floor change, enemies moving over the horizon)
  arrives as a correction on the next rebuild.
- Your body runs up to 333 ms ahead of teammates and enemies, and corrections grow with the horizon. The cap
  was 10 ticks at sign-off and was raised to 20 the same day because the lead exceeded it (LPD4).
- The sign-off is one Studio session on a simulated link: a press drawn after 253 ms on average against
  422 ms stepped, head error 0 and no snaps over the window, with the cap still at 10. A group playtest and a
  phone were not run.
- Twelve client call sites read the drawn player through one accessor (`getDrawnPlayer`) instead of the state.

## Evidence

- Code: [`predictMotion.ts`](../../src/shared/lockstep/predictMotion.ts),
  [`predict.ts`](../../src/shared/lockstep/predict.ts), [`smoother.ts`](../../src/shared/view/predict/smoother.ts),
  [`SimController.ts`](../../src/client/controllers/game/SimController.ts) `getDrawnPlayer`.
- Specs: [`predictMotion.spec.ts`](../../src/shared/lockstep/predictMotion.spec.ts) (bit-for-bit parity with
  the sim), [`predict.spec.ts`](../../src/shared/lockstep/predict.spec.ts),
  [`predict.net.spec.ts`](../../src/shared/lockstep/predict.net.spec.ts).
- Docs: [`../LOCAL_PREDICTION.md`](../LOCAL_PREDICTION.md) "Decisions", "LP8 sign-off", "Risks";
  [`../FRAME_PACING.md`](../FRAME_PACING.md) (the playout clock it is built on, LPD2).
- Log: [`../DECISIONS.md`](../DECISIONS.md), entry "Local prediction".
