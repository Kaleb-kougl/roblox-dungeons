# Decision records

Six decisions that shaped the codebase, each on one page: context, the options, what was decided, what it cost,
and where the evidence is. They are extracts. The full history, one entry per feature and retune, is the decision
log, [`../DECISIONS.md`](../DECISIONS.md), which has no anchors: each record names the entries to search for.
The system these decisions add up to is in [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md).

| # | Decision | In one line |
|---|---|---|
| 1 | [Lockstep with input merging](0001-lockstep-with-input-merging.md) | Clients step the sim from a server-merged input log; the server replays that log instead of simulating live |
| 2 | [Determinism enforced by the test runner](0002-determinism-enforced-by-the-runner.md) | Sim modules load in an environment where clocks, RNG and Roblox APIs raise; lint mirrors it |
| 3 | [New state is opt-in and hashed last](0003-new-state-is-opt-in-and-hashed-last.md) | A feature's state exists only when its config field is set, and its hash group is appended after all others |
| 4 | [Rollback measured, then not built](0004-rollback-measured-then-not-built.md) | A spike failed both its CPU gate and its misprediction gate; the code was removed |
| 5 | [Local prediction is presentation only](0005-local-prediction-is-presentation-only.md) | Your own body is drawn ahead from inputs already sent; nothing predicted reaches the sim |
| 6 | [A server-owned wallet of transactions](0006-server-owned-wallet-of-transactions.md) | Every balance change is one `UpdateAsync` transaction; grants and receipts are applied once |
