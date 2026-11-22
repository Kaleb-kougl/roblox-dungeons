# 4. Rollback measured, then not built

Status: closed 2026-11-09 (decision RBD8). The spike's code is removed; the last commit that has it is `f6f6e6c`.

## Context

Lockstep shows a player their own input a round trip late
([record 1](0001-lockstep-with-input-merging.md)). Rollback netcode is the standard answer: every frame, copy
the confirmed state, step the copy forward over the inputs not yet confirmed (your own known, teammates'
guessed), draw the copy, and redo it when the real frames arrive. It would touch the state, every per-tick
event feed and every view. Before building it, a spike was asked two questions with gates set in advance.

## Options considered

- **Build rollback.** The full answer to input delay, at the largest cost in the client.
- **Build the cheaper plan first**: predict only the local player's body
  ([record 5](0005-local-prediction-is-presentation-only.md)).
- **Measure rollback before choosing.** Add no production path; run the copy and the steps on real devices
  and count mispredictions offline over recorded co-op logs.

## Decision

Measure, then decide against the gates. The results, from [`../ROLLBACK_SPIKE.md`](../ROLLBACK_SPIKE.md):

| Question | Gate | Measured |
|---|---|---|
| CPU: copy the state and step it 16 ticks, per rendered frame | 4 ms p95 on a mid-range phone | 4.06 ms p95 on the owner's Mac (dev floor 15); 11.77 ms p95 on an iPhone 17, which dropped to 50 fps |
| Teammate corrections of a tile or more | under 6 a minute | 27 to 74 a minute at leads of 6 to 16 ticks (bot sweep, `repeatLast`) |

Each result fails on its own. Rollback was not built (RBD8, the owner's call), local prediction was built
instead, and the spike's code was removed in task R7.

## Consequences

- The copy itself was solved and still was not enough. A generic clone took 21 to 41 ms headlessly; a pooled
  copy took 1 to 2 ms, because 7,708 of about 8,100 tables were the bullet pools' per-slot vectors. The 16
  steps were the cost that remained.
- The numbers are thinner than planned and the record says so: the human captures, the live windows and the
  other devices were not run, because none could overturn a flagship phone failing the CPU gate by a factor
  of three. The misprediction figures are from bots.
- One option stays open and unmeasured on a phone: a short horizon of 6 to 8 ticks. In the sweep, enemies,
  kills and bullets pass there; teammate corrections (27 to 31 a minute) still fail.
- What survived the cleanup: the dense-fight setup the replay bench uses, and the runner's `--flag` switch.
- Teammates and enemies are drawn at the confirmed state, a round trip behind your own predicted body.

## Evidence

- Record: [`../ROLLBACK_SPIKE.md`](../ROLLBACK_SPIKE.md): "Gates", decision RBD8, "Results" (the headless CPU
  table, the device table, the bot sweep), task R7.
- Log: [`../DECISIONS.md`](../DECISIONS.md), entry "Rollback spike".
- Code that remains: [`denseFight.ts`](../../src/shared/run/testing/denseFight.ts). The spike itself:
  `git show f6f6e6c:src/shared/lockstep/rollbackSpike/model.ts`.
