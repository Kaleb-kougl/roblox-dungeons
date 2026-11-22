# Presentation pass

Make the repository read well to an engineer evaluating it: close the real gaps, state the limits, and make the
strongest work easy to find. No gameplay change: no sim, hash group, wire format, ruleset or fixture is touched,
and every emitted log line is the same text as before.

**Status: built 2026-11-21 on branch `staff-presentation` (from `main` @ `d4936547`), the owner's Studio check of
both controller splits passed the same day. Not merged yet.**

## Findings, as first measured and as corrected

The plan was written from a quick read. Three of its findings were wrong and are corrected here.

| Finding | First read | What the census found |
|---|---|---|
| Server tests | "`src/server` has 0 specs; the wallet is untested" | Wrong. Services are wiring; the rules live in `src/shared` with specs. Of 275 value names the server imports from `shared`, 196 appear in a spec; the rest are constants, types and small helpers. All 48 client remotes are re-read by a spec'd shared function except one inline `typeIs`. About 60 lines of untested pure logic in five places were left in services: moved and spec'd (SE3). docs/SERVER_CENSUS.md |
| Logging | "281 raw `print` / `warn` calls in client and server" | 179, all on the client. The server already logged through `server/log` |
| Spikes | "closed spikes still ship" | One of eight was closed (the iso camera). Seven are open: their results in docs/SPIKES.md are empty and live code reads their flags |
| `SimController.ts` | 2,433 lines | Confirmed. Now 1,782 (SE5) |
| `ActorRenderController.ts` | 1,315 lines | Confirmed. Now a directory, largest file 631 (SE6) |
| Open tasks | 171, 106 of them Studio checks | Confirmed. 166 after five proven done; every one triaged (SE9) |
| Private references | the source project's name and a machine path in `CLAUDE.md`, `PROVENANCE.md` and file headers | Confirmed, 78 files. Removed (SE15) |
| Names | package, Rojo projects and place file say Kaleb-Vale | Confirmed. Renamed (SE14) |

## Decisions

- **SED1. Gaps before polish.**
- **SED2. Server logic is tested by moving it to `shared`, not by mocking the engine.** The pattern was already in
  use; SE3 finishes it for five rules.
- **SED3. A controller is split by responsibility; what is pure moves to `shared/view` with a spec.** Frame order,
  connection order and clock reads never move. A group that cannot be extracted without reordering stays.
- **SED4. The limit is stated**: the README says what no automated test covers.
- **SED5. Every open task ends as done, won't do, or a tracked issue.** docs/OPEN_TASKS_TRIAGE.md proposes the
  state of each; the owner closes them.
- **SED6 (revised). `docs/` stays flat, with an index.** The plan moved feature and art docs into subfolders.
  Not done: source comments cite plan docs as `docs/NAME.md` in thousands of places and the API reference links
  them by that path (docs/DOC_COMMENTS.md DC11), and the `ci` branch edits the same table. `docs/README.md`
  groups the files instead (engineering, generated, owner checklists, features, art).
- **SED7. Decision records are extracts.** `docs/decisions/` 0001-0006; docs/DECISIONS.md stays the log. Where
  the log never weighed the alternatives in writing, the record says its options are reconstructed.
- **SED8. One name: Roblox Dungeons / `roblox-dungeons`.** The old name stays only where something stored or
  recorded depends on it (table below).
- **SED9. A closed spike leaves the tree; an open one stays** until its result is recorded.
- **SED10. History is not rewritten for style.** The conventions are in docs/DEVELOPING.md.
- **SED11. Log text is frozen.** `client/log` passes the string to `print` / `warn` unchanged; Studio checks and
  docs quote these lines.

Owner calls, all answered "as proposed" (2026-11-21): `CLAUDE.md` stays, without the source project's name or
path (an untracked `CLAUDE.local.md` holds the path); `PROVENANCE.md` stays without the name; open tasks go to
GitHub Issues; the toolchain upgrade is its own plan; a production section in the README waits for numbers;
the large UI files are not split.

## As built

| Task | Result |
|---|---|
| SE0 baseline | On a 4-core Linux arm64 VM, not the Mac: build 83 s, typecheck 21 s, lint 109 s, `out:digest` 1,793 modules at `d4936547` |
| SE1 server census | docs/SERVER_CENSUS.md: per service the remotes and their argument checks, the writes, the shared module and spec behind each rule; seven findings |
| SE3 / SE4 server rules | `creditedPartyMembers` to `shared/leaderboard/posting.ts`; `studioRunLimits`, `gateVerdict`, `forRecipient` to `shared/run/serviceRules.ts`; `friendsWithConfirmed` to `shared/lobby/friendCache.ts`; new specs `run/serviceRules`, `leaderboard/credit`, `wallet/trustBoundary`. Bodies unchanged |
| SE2 / SE5 `SimController` | docs/SIM_CONTROLLER.md. Contracts, co-op and solo client builds, HUD feed, listener fan-out and submission bookkeeping to `client/controllers/game/sim/`; the drawn local player to `shared/view/predict/drawnLocal.ts` with a spec. The class keeps its path and Flamework id. The frame loops, run start / end, pause and spectate stay: one state machine |
| SE6 `ActorRenderController` | docs/ACTOR_RENDER.md. `client/controllers/render/actors/`: the class (frame, pool, `drawActor`), `PlayerViews`, `ActorHitReact`, records and part builders; `shared/view/actorDraw.ts` with a spec. The Flamework id moved with the file |
| SE7 the limit | README "How it stays correct at this size" and docs/DEVELOPING.md "Tests" |
| SE8 Studio pass | docs/STUDIO_PASS.md: 108 lines in six sessions, each naming the tasks it closes |
| SE9 triage | docs/OPEN_TASKS_TRIAGE.md: 110 covered by the Studio pass, 51 as 18 issues, 5 done (ticked), 5 proposed won't do; `gh issue create` commands, not run |
| SE10 architecture | `ARCHITECTURE.md` |
| SE11 decision records | `docs/decisions/0001` to `0006` |
| SE12 docs layout | `docs/README.md` (SED6 revised) |
| SE13 spikes | Spike B (iso camera) removed with its flag, store group and HUD panel; seven kept |
| SE14 name | `package.json`, the three Rojo projects, `build/roblox-dungeons.rbxl`, the test plugin (`RobloxDungeonsTestRunner.rbxm`, "Roblox Dungeons Tests"), TypeDoc, doc titles |
| SE15 private references | 78 files, comments and docs only; `out:digest` identical |
| SE16 logging | `src/client/log.ts` (`logInfo`, `logWarn`, `clientLogger`); 179 call sites; ESLint forbids the globals `print` / `warn` in `src/client` and `src/server`. Reversing the rename on the compiled output gives the baseline digest |
| SE17 `KV_*` registry | `scripts/kv-names.json` (173 names), `check:kvnames` in `verify`, generated docs/DEBUG_SWITCHES.md |
| SE18 root files | `.editorconfig`; `engines`; `scripts/art/gen-all.js` behind `art:build` / `art:lock`; `format:check` in `verify` (the tree already passed) |
| SE19 conventions | docs/DEVELOPING.md "Commit and pull request conventions" |

**What keeps the old name**

| Kept | Why |
|---|---|
| `KV_*` DataStores, attributes, GUI names; `kv-strings*.csv` | stored or recorded |
| `KALEB_VALE_MVP_PARAMS` | the fixtures' `call` text cites it |
| `art/vendor/kaleb-vale/` | the path is recorded in `atlases.json` and `vendor.lock.json` |
| pack id `vale` | asset id |
| docs/ROLLBACK_SPIKE.md plugin names, docs/REPO_HYGIENE.md paths | historical record |

## Findings left for the owner

None lets a client gain Silver, a record or a board entry. Each fix changes behaviour, so none was made in this
pass. **Closed 2026-11-21 in docs/SERVER_FINDINGS.md**: 1 to 5 and 8 fixed, 6 accepted, 7 stated in the public
claim, 9 relabelled, 10 moved to the task triage.

1. `walletBuy` / `walletEquip` echo and log a client's item id at any length; a refused request still costs one
   wallet `UpdateAsync` (bounded by 5 per 10 s).
2. `submitSegment` and `finishRun` answer an unknown run before any rate limit; `finishRun` has no limiter.
3. `requestRecords` logs `RATE_LIMITED` and then answers.
4. `lockstepInput` / `lockstepHash` / `lockstepFinal` lack the `player.Parent` guard: a late remote leaves a
   limiter entry for the server's life.
5. `getLeaderboard` parses before it limits.
6. `tutorialStarted` over budget still opens an attempt.
7. The `PurchaseId` ring is 128: an id evicted by 128 later purchases would grant again if redelivered (pinned in
   `wallet/trustBoundary.spec.ts`).
8. `KV_InviteSpike` is read on the server without a Studio gate: set from a server console it creates a spike
   RemoteEvent on a live server.
9. Several switches whose comments say "Studio" are read by the client anywhere (`KV_Tutorial`, `KV_SkipLoading`,
   `KV_SkipMenu`, `KV_DecorBand`, `KV_ResetBindings`, the `*Debug` forcing switches). Local effect only.
10. Sixteen pending notes in docs/DECISIONS.md are half stale: the upload they wait for has ids in `assetIds.ts`.

## Checks

On the integrated branch, on a 4-core Linux arm64 VM (Lune 0.11.0, Node 22), each `verify` step run on its own:

- build (rbxtsc), whole-tree ESLint at zero warnings, `format:check`, `docs:check`, `check:docs`, `check:assets`,
  `check:autolocalize`, `check:kvnames`, `check:locals` (none over 200, none at or above 185), `facts:check`: pass;
- `test:checks` 68 of 68, `test:art` 356 pass and 5 skipped (no art packs), `test:l10n`: pass;
- the headless spec suite: 637 of 637 files, 7,552 of 7,552 tests.

`out:digest`: 1,813 modules against 1,793 at `d4936547`. Each track listed its changed modules; outside the
moved, split and converted ones the differences are barrels, two spec titles, and Flamework metadata that names a
moved file (`client/network`, `server/network`, three controllers' `flamework:implements`).

Not run: Studio, two clients, a device, the art and audio pipelines (the packs were not on the build machine),
`npm run verify` as one command on the Mac.

## Tasks

- [x] SE0-SE7. Baseline, censuses, server rules, the two controller splits, the stated limit.
- [x] SE8. The Studio pass written.
- [x] SE10, SE11, SE13-SE19.
- [x] SE12. An index instead of a move (SED6 revised).
- [x] SE5a. [owner] *(passed 2026-11-21)* Studio check of the `SimController` split: docs/SIM_CONTROLLER.md "Studio check". Two clients:
  the co-op debug line and the 10 s `[Pace]` line read as on `main`.
- [x] SE6a. [owner] *(passed 2026-11-21)* Studio check of the actor renderer split: docs/ACTOR_RENDER.md "Studio check (owner)", 11 steps.
- [ ] SE3a. [owner] One solo endless run and one 2-player lobby run: verdict, records and Silver arrive as before.
- [ ] SE9a. [owner] Run docs/STUDIO_PASS.md; close every task per docs/OPEN_TASKS_TRIAGE.md; file the issues.
- [ ] SE13a. [owner] Record or abandon the seven open spikes, then remove them. Decide whether Spike B's recorded
  result (the live rig's values) stands.
- [ ] SE15a. [owner] After the history rewrite is settled, grep the history for the machine path and the source
  project's name.
- [ ] SE20. [owner] `npm run verify` on the Mac. (The findings above are closed: docs/SERVER_FINDINGS.md.)
