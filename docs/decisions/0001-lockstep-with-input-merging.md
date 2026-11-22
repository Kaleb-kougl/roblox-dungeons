# 1. Lockstep with input merging, not a server-authoritative sim

Status: built (milestone M4). Extract; the full account is [`../SERVER.md`](../SERVER.md) "Co-op lockstep (M4)".

## Context

The simulation was ported from the private TypeScript web build under one requirement: replay it bit for bit.
It already ran on the client, and the server already checked finished runs by replaying their inputs
([`../../PLAN.md`](../../PLAN.md): "Single-player first: the sim runs on the client. The server only checks
finished runs by replaying them."). Co-op for 2 to 8 players had to be added without giving up either property.

The log holds no entry that weighs the alternatives at the time. The options below are reconstructed from that
constraint and from costs measured in this repository.

## Options considered

- **Server-authoritative sim, state replicated to clients.** The server steps every run live and streams state.
  A floor holds up to 64 actors and pools of 2,048 enemy and 512 player bullets
  ([`../ROLLBACK_SPIKE.md`](../ROLLBACK_SPIKE.md) "Headless CPU"), all moving at 60 Hz. Replicating that
  through Roblox properties would pass every value through float32, so a client could no longer reproduce the
  server's hash. The live step would also have to keep 60 Hz for every run; it could not fall behind.
- **One client hosts.** No server cost, but the host would decide the results the leaderboards depend on.
- **Lockstep, server merges inputs.** Every client steps the same sim from one input log. Only inputs travel.

## Decision

Lockstep with a server relay. Each client sends its input for a future tick. On its own clock the server
finalizes one merged frame per tick: each player's input, or a repeat of their last one when it missed the
deadline, so a slow client never stalls the party. Clients step merged frames only. The merged log is the
authority: it is what every client steps and what the server later replays.

The server is not blind. Clients report `hashState` every 60 ticks; the ledger agrees them in order; every
5 minutes of agreed ticks the server replays its own log and must reach the consensus hashes.

## Consequences

- **Bandwidth is inputs.** 10 bytes per input frame up; about 25 bytes per tick down for 8 moving players
  ([`wire.ts`](../../src/shared/lockstep/wire.ts)).
- **The server's sim work is deferrable.** Replay shares one queue on a 4 ms budget per frame and may lag play
  without anyone noticing ([`../SERVER.md`](../SERVER.md) "Replay capacity": about 7 eight-player parties per
  server in typical fights, measured headlessly).
- **Input delay is the price.** A press is stepped a round trip later. This is why frame pacing and local
  prediction exist (records [4](0004-rollback-measured-then-not-built.md) and
  [5](0005-local-prediction-is-presentation-only.md)).
- **Determinism becomes a hard requirement on every device**, not only against the fixtures (records
  [2](0002-determinism-enforced-by-the-runner.md) and [3](0003-new-state-is-opt-in-and-hashed-last.md)).
- **A desync ends the run unranked.** One member can always force that; nobody can make the server post a score
  it did not replay.
- **No drop-in mid-run**, and no pause in a party run.

## Evidence

- Code: [`relay.ts`](../../src/shared/lockstep/relay.ts), [`session.ts`](../../src/shared/lockstep/session.ts),
  [`ledger.ts`](../../src/shared/lockstep/ledger.ts), [`client.ts`](../../src/shared/lockstep/client.ts),
  [`config.ts`](../../src/shared/lockstep/config.ts),
  [`RunSessionService.ts`](../../src/server/services/RunSessionService.ts).
- Specs: [`lockstep.spec.ts`](../../src/shared/lockstep/lockstep.spec.ts) drives a server session and simulated
  clients headlessly.
- Docs: [`../SERVER.md`](../SERVER.md) "Co-op lockstep (M4)", "Replay capacity", "What replay validation does and
  does not prevent"; [`../../PLAN.md`](../../PLAN.md) row M4.
