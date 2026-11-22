# 3. New state is opt-in and hashed last

Status: a standing rule. Every gameplay feature since the port follows it.

## Context

The state hash is a 32-bit FNV-1a over the float64 bytes of every state field in a fixed order
([`../../fixtures/hashed-fields.md`](../../fixtures/hashed-fields.md)). The 16 golden fixtures were exported
from the private TypeScript web build and cannot be regenerated to fit a change made here. Yet the game kept
growing: endless floors, scoring, co-op, builds, pellets, vaults, a currency. Each adds state the sim must hash,
or replay validation and desync detection would not cover it.

## Options considered

The log records the rule, not a written comparison; the options are the alternatives the context leaves.

- **Insert a feature's fields where they belong** (a player's Silver next to the player). Every hash moves, so
  every fixture fails and the proof of parity is gone.
- **Version the hash layout** and keep one writer per version. The fixtures stay provable only while the old
  writers are kept working beside the new ones.
- **Leave new state unhashed.** Then the server's replay cannot detect a client that edits it.
- **Append only, and only when present.**

## Decision

Three rules, stated in `CLAUDE.md` and applied in every feature entry of the log:

1. **Opt-in.** A feature's `SimConfig` field is optional. Absent means exactly the behaviour before the feature,
   and the feature's state object is not created.
2. **Hashed last.** `writeHashFields` writes the 6 fixture groups, then each port group behind an
   `!== undefined` check, in the order the features were added (16 groups as of 2026-11-21, `endless` first,
   `silver` last). A new group goes after all of them.
3. **Its own RNG stream.** A feature never draws from a stream an earlier feature reads, so turning it on does
   not shift anyone else's rolls.

Two companion rules cover what an appended group cannot. A retune of ported behaviour keeps the web values
behind a setter (`setSwordTimings(WEB_SWORD_TIMINGS)`, `setPlayerMover(PlayerMover.WEB)` and others) that the
parity specs call. Enemy archetypes number by (band, id), and a port archetype takes a new band, so no recorded
index moves.

## Consequences

- The fixture runs still hash to the web build's values, and so do M1 and the tutorial unless an entry says
  otherwise. A feature that breaks this fails the parity specs on the first run.
- Hash order is chronological, not logical. [`hashLayout.ts`](../../src/shared/sim/hashLayout.ts) names every
  field so a mismatch can be bisected by group, then by field.
- Opt-in does not protect a world that turns the feature on. Endless replays and scores change with each
  gameplay feature; that is recorded by bumping `DAILY.ruleset` ([`../FACTS.md`](../FACTS.md)), while the
  all-time boards stay `_v1` and mixed.
- Nothing stored is re-validated: a recording is replayed once, by the server build that received it
  ([`../SERVER.md`](../SERVER.md) "Code version skew"). The rule protects the fixtures and the specs, not old
  recordings on disk, because there are none.
- Each feature costs one optional config field, one state object, one hash writer and one line in two files.

## Evidence

- Code: [`replay.ts`](../../src/shared/sim/replay.ts) `writeHashFields`,
  [`hashLayout.ts`](../../src/shared/sim/hashLayout.ts), [`step.ts`](../../src/shared/sim/step.ts) `SimConfig`.
- Specs: [`runFull.spec.ts`](../../src/shared/sim/runFull.spec.ts) and
  [`runBoss.spec.ts`](../../src/shared/sim/runBoss.spec.ts) (parity under the web setters),
  [`hash.spec.ts`](../../src/shared/sim/hash.spec.ts), [`actors.spec.ts`](../../src/shared/sim/actors.spec.ts)
  (the archetype index table).
- Log: [`../DECISIONS.md`](../DECISIONS.md), entries "Silver" (a group "appended LAST (after `secrets`)"),
  "Builds", "Wall slide" (the `PlayerMover.WEB` setter) and "Slower, longer sword" (the first retune setter).
