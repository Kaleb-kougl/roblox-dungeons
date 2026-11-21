# CI

Every push to `main` and every pull request runs the same gate as `npm run verify` on GitHub Actions, with no
secrets and no art packs. Tooling only; the one source change is a spec helper (CI1).

**Status (2026-11-21): CI1-CI5 and CI9 built on branch `ci`, not yet run on GitHub. CI0 (timing on the Mac) and
CI6 onward follow the first run.**

## Findings

- **The gate.** `verify` chains 13 steps. The first nine need only Node; `build`, `check:locals`, `facts:check`
  and `test:only` need the compiled `out/`, and the last two need Lune.
- **No art packs needed.** `test:art` passes on a clone without `art/vendor` (351 pass, 5 skip); the atlas
  layouts and asset ids are committed. `art:build` and `audio:build` stay local.
- **The suite's duration is not recorded.** The only number is an estimate of about 45 minutes on a 4-core VM at
  four processes (docs/DOC_COMMENTS.md). 632 spec files.
- **Node's default heap is too small on a small machine.** `rbxtsc` aborted on a 3 GB VM and built in 87 s with
  `--max-old-space-size=6144`; the workflows set it.
- **"The known x86 failure" was the spec, not the sim** (CI1).

## CI1. The NaN vector

`forge.spec.ts` "EncounterRng ... seedToState vectors" failed on x86-64 Lune and passed on arm64. Cause: the
spec's helper turned the fixture's `"NaN"` into `0 / 0` and then asserted that value's bits against the
fixture's `7ff8000000000000`. An arithmetic NaN's sign bit is the CPU's choice. Measured with Lune 0.11.0:

| Expression | x86-64 | arm64 |
|---|---|---|
| `0 / 0`, `math.huge - math.huge`, `math.sqrt(-1)` | `fff8000000000000` | `7ff8000000000000` |
| the double read from the bits `7ff8000000000000` | `7ff8000000000000` | `7ff8000000000000` |

The sim was never wrong: `seedToState` maps every non-finite seed to 0 on both. The helper now builds the NaN
from its bits. Passes on arm64 (run here); x86-64 is confirmed by the table and by the first CI run.

**What it means beyond the spec.** `hashState` covers the raw float64 bytes of every field, so a NaN produced by
arithmetic inside the sim would hash differently on a PC and on a phone and desync a co-op run. Nothing shows
that happens today, but nothing proves it cannot. CI13 adds the guard; the two-architecture matrix (CD4) is the
standing check.

## Decisions

- **CD1. CI runs the npm scripts `verify` runs.** `verify` is `verify:static && verify:build && verify:specs`;
  the workflow calls those stages (and `test:only`, which is all of `verify:specs`, so it can pass `--shard`).
- **CD2. Three jobs.** `static` (Node only); `build` (compile once, `check:locals`, `facts:check`, upload `out/`
  and `include/`); `specs` (a matrix that downloads the artifact and runs one shard each).
- **CD3. Shards by a hash of the spec's source path** (`--shard i/n`, FNV-1a): adding a spec never moves another,
  and `npm run test:only -- --shard 3/12` reproduces a CI shard locally. 12 shards: the first run's 8 took about
  20 minutes a shard (1,203 s for the one reported).
- **CD4. The specs run on x86-64 and arm64**, 12 shards each. The simulation must compute the same run on both.
- **CD5. Only first-party actions** (`actions/*`, by major version). Lune is installed by
  `scripts/ci/install-lune.sh` from the release the version in `rokit.toml` names, so no third-party action and
  one source for the version. Rojo is not installed: `verify` does not use it.
- **CD6. `main` is protected once CI is green**; changes arrive by pull request, no required reviewer (owner).
- **CD7. The API reference deploys to GitHub Pages from `main`** in its own workflow (`docs.yml`), so a docs
  failure never blocks a merge (owner).
- **CD8. No secrets.** Publishing the place from CI is out of scope (owner).
- **CD9. A newer run on the same ref cancels the older one.**
- **CD10. Wall-clock budgets are not asserted in CI.** `sim/bench.spec.ts` asserts its 2 ms a tick budget only
  under `--flag bench.budget`, which `verify:specs` passes and CI does not: the first CI run measured 2.13 ms on a
  shared runner. The bench still runs and prints its numbers in CI, and its non-timing assertions hold. It is the
  only spec that asserts on the clock (checked across the 31 specs that read `os.clock`). This is the one place
  CI and `verify` differ.

## As built

- `package.json`: `verify:static`, `verify:build`, `verify:specs`; `verify` chains them in the old order.
  `engines.node >= 20`; `.nvmrc` 22.
- `scripts/lune/run-tests.luau`: `--shard i/n` and `--list` (prints the spec files that would run). Checked: the
  8 shards' lists together are the 632 files, each once.
- `scripts/ci/install-lune.sh`: Lune for the runner's architecture into `~/.local/bin`.
- `.github/workflows/ci.yml`, `.github/workflows/docs.yml`.
- `forge.spec.ts`: the canonical NaN from its bits (CI1).

## What CI does not cover

Anything that needs the engine (controllers, React UI, remotes, DataStores), the atlas and audio builds, and the
Studio two-player checks. Client and server code is typechecked and linted, not executed.

## Tasks

- [ ] **CI0. Measure on the Mac** (owner): `time npm run verify` and `time npm run test:only`. Sets the shard
  count: target no shard over about 8 minutes.
- [x] **CI1. The NaN vector.**
- [x] **CI2. `verify` in stages.**
- [x] **CI3. `--shard i/n`.**
- [x] **CI4. Pin the toolchain.**
- [x] **CI5. `ci.yml`.**
- [ ] **CI6. First run and make it green.** Push the branch, open a pull request, fix whatever only a clean
  Linux runner shows. Record each job's time here and retune the shard count.
- [ ] **CI7. Protect `main`** (owner, repository settings): the `static`, `build` and `specs` checks required, no
  force-push. Add a pull request template.
- [ ] **CI8. Working agreement in `CLAUDE.md`**: a change lands by pull request with CI green.
- [x] **CI9. `docs.yml`.** Needs Pages enabled with "GitHub Actions" as the source (owner).
- [ ] **CI10. README follow-ups**: the CI badge, the API reference link, one sentence on the two architectures.
- [ ] **CI11. Repository settings** (owner): secret scanning and push protection; Dependabot for GitHub Actions.
- [ ] **CI12. Close**: job times here, the `docs/DECISIONS.md` entry.
- [ ] **CI13. No NaN in hashed state.** A spec that replays the golden runs and a long endless run and fails if
  any value `writeHashFields` emits is a NaN. If one can occur, canonicalize it where it is made.
