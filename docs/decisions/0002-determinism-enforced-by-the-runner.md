# 2. Determinism enforced by the test runner, not by convention

Status: built. The runner has had the guard since the first commit (2026-10-25); the lint was added 2026-11-20.

## Context

Replay validation, co-op and the golden fixtures all assume that the same inputs give the same state hash on
every machine. One `os.clock()`, one `math.random()` or one float32 Roblox datatype in code the sim reaches
breaks all three, and nothing fails until two machines disagree. The codebase is large and most commits are
written with a coding agent, so a rule that lives only in a document will be broken.

## Options considered

The log records the decision, not a written comparison; the options are the alternatives the context leaves.

- **Convention and review.** A rule in `CLAUDE.md`. Costs nothing, catches nothing.
- **Lint only.** Catches what is written in a sim file. Misses a forbidden call reached through a helper, and
  can be silenced with a comment.
- **Golden fixtures only.** They prove parity on the paths the fixtures exercise. A clock read in a new enemy
  that no fixture spawns would pass.
- **A restricted runtime for the sim's modules.** The test harness decides what a module can see.

## Decision

The headless runner loads every module compiled from `src/shared/sim` and `src/shared/dungeon` in a stricter
environment: no Roblox datatypes, no `Instance`, `Enum` or `workspace`; `game` resolves only the one service
roblox-ts's import line needs; `tick`, `time`, `os.clock`, `os.time`, `os.date`, `math.random` and
`math.randomseed` raise `[determinism]`. Spec files are exempt, so a spec can still build a `Vector3`.

ESLint mirrors the rule in the editor with one override for the same two directories: restricted globals,
restricted properties, and imports limited to sim, dungeon, `shared/jsmath` and the generated fixtures. The
runner stays the authority.

## Consequences

- A violation fails `npm test` with the name of the forbidden call, before any playtest.
- The sim cannot use engine math. Vectors are plain numbers, 32-bit integer math goes through `bit32`, and
  ported trig reads precomputed arc tables ([`../DECISIONS.md`](../DECISIONS.md), entry "Trig").
- The guard acts at call time, so it covers what the specs execute. The lint covers what is written. Neither
  alone is complete; the golden fixtures and the client hash reports in co-op are the remaining nets.
- The guard covers two directories. `shared/lockstep` and `shared/run` are pure by convention and by their
  headless specs, not by the realm.
- The runner needed its own module world per spec file ([`realm.luau`](../../scripts/lune/lib/realm.luau)),
  which also keeps module state from leaking between specs.

## Evidence

- Code: [`scripts/lune/lib/realm.luau`](../../scripts/lune/lib/realm.luau) (the header comment and `forbidden`),
  [`scripts/lune/run-tests.luau`](../../scripts/lune/run-tests.luau), [`.eslintrc.json`](../../.eslintrc.json).
- Specs: [`determinism.spec.ts`](../../src/shared/sim/determinism.spec.ts) (live play against replay through
  irregular frames), [`runBoss.spec.ts`](../../src/shared/sim/runBoss.spec.ts) (a golden fixture).
- Docs: [`../CODEBASE_SCALE.md`](../CODEBASE_SCALE.md) Design 6 and task DX2 (the lint, with the scratch
  violations it was tested on); [`../DECISIONS.md`](../DECISIONS.md), entry "Codebase scale";
  [`../../fixtures/hashed-fields.md`](../../fixtures/hashed-fields.md).
