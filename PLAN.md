# Roblox Port (roblox-ts + Flamework)

## Goal
Rebuild the M1 "First fight" build on Roblox: same deterministic sim, same Dungeon Forge floors, sword/bow,
swarmer/sniper/bruiser rooms and Mother Bramble. Every visual and audio asset is a placeholder behind logical IDs,
so real art and sound drop in later by editing one manifest.

## Decisions
- **Stack:** roblox-ts, Flamework (controllers, services, networking), Rojo, `@rbxts/react` + `@rbxts/charm` for the
  HUD, `@rbxts/jest` run through Lune for tests.
- **Layout:** `src/shared/sim` (plain TS, no Roblox APIs, no decorators: everything `step()` reaches),
  `src/shared/theme`, `src/client` (Flamework controllers), `src/server` (Flamework services).
- **Single-player first:** the sim runs on the client. The server only checks finished runs by replaying them.
- **The web repo is the reference.** Its outputs (RNG sequences, dungeon layouts, replay hashes) are exported as
  JSON golden fixtures, and the Roblox build must match them.

## Assets: placeholder now, replaced later
- Port `src/theme/contract.ts` as it is: logical IDs (`class.*`, `enemy.*`, `boss.*`, `bullet.*`, `tile.*`, `sfx.*`,
  `music.*`), color roles, sprite contracts (16x24 classes, 16x16 enemies, 48x48 bosses, frame counts, pivots,
  facings) and the string table. Art made later then fits without code changes.
- `ThemePack.texture/spriteSheet(id)` returns `undefined` for now, and views fall back to **primitives tinted by
  color role**: a Part per actor (a different shape per archetype), a neon sphere per bullet, colored floor/wall Parts
  per biome. `sound(id)` returns silent.
- Sprites go through BillboardGui ImageLabels (`ResampleMode = Pixelated`, `ImageRectOffset/Size` per frame). The
  view code supports this from day one and is exercised with a single generated test sheet.
- **Swapping assets later:** upload the files (Asphalt or the Studio asset manager), then put the `rbxassetid://` IDs
  into the manifest. Sounds play through SoundGroups per role (`sfx`, `music`).
- Rules kept: a test fails on any `rbxassetid://` outside `src/shared/theme`, and the validator still rejects
  gameplay keys and checks contrast.

## Status (2026-10-11)
- Tasks 2-9 are code-complete and verified headlessly: `npm run verify` passes (65 suites, 793 tests), including
  bit-exact parity with every golden fixture (player, dungeon, bullets, full 60 s run, boss fight) and the server
  accepting the web build's full run. Task 1's code (scaffold + both spikes) is done; its go/no-go measurement and
  task 10 need Roblox Studio: `docs/SPIKES.md`, then the smoke test in `docs/CLIENT.md`.
- Nothing has run inside Studio yet: every controller, React component, remote, DataStore and Sound is untested at
  runtime.
- A static review of the client and server code for Roblox API misuse is done and its findings are fixed. The main
  fixes: run recordings go over the remote as a compact binary `buffer` (about 5 bytes per tick, so long runs are no
  longer rejected as too large), server replays run through a queue on a 4 ms time budget, typing in TextChatService
  chat no longer drives the game, and the races when a player leaves mid-validation are closed. Still to check in Studio
  (docs/SERVER.md lists them): a real buffer crossing the remote, threads resumed after the queue's coroutine.yield,
  DataStore writes with userIds, and AnalyticsService calls for a player who already left.

## Vertical slice (2026-10-24, branch `slice`)
Three feature branches merged and wired together: an endless, scored, server-validated run that posts to the
leaderboards. Phase B (2026-10-25) merged two more on top and wired them together: M2 in-run progression (boons,
relics, curses) and M4 co-op lockstep, with per-player progression in co-op. All of it is **code-complete and
verified headlessly only** (`npm run verify`: 83 suites, 1032 of 1033 tests pass; the one failure is the known
`forge.spec.ts` EncounterRng seedToState NaN sign-bit vector on x86, which passes on the Mac); none of it has run in
Studio yet (controllers, remotes, DataStores, OrderedDataStores, the lockstep remotes, the HUD panels and the draft
overlay).

| Milestone | What | Status |
| --- | --- | --- |
| M0 | (not part of this slice) | open |
| M1 | Endless solo loop: Dungeon Forge floors from the run seed, deferred room spawns, stairwell, Depth, hp / bullet speed scaling, debug floor skip (N) | code-complete headless; not run in Studio |
| M2 | Scoring: kills (floor-scaled), grazes, guard cancels, rooms (clear / perfect / fast, deferred-spawn records on endless floors), floor clears (1000 x floor x the share of the floor's enemy rooms cleared), boss (+ no-hit bonus), combo, Depth and curse multipliers; score HUD, pops, results breakdown. Every endless run is scored; M1 stays unscored (KV_Scoring opt-in, never submitted). In-run progression (endless runs, `src/shared/sim/progression/`): a boon draft after every floor (12 boons, rarity weights with a per-floor legendary ramp), 4 relics from TREASURE-room pedestals, 4 curses from SHRINE rooms; draft overlay, item icons, toasts, world markers. Co-op: per player (own drafts, the world frozen until all confirmed; the acting / owning / hit player's modifiers; team-wide combo window, hit cut and world curses) | code-complete headless; not run in Studio |
| M3 | Segmented validation: server-picked seeds, one segment per floor (+ 5-min fallback), checkpoint hashes, SegmentedValidator, client trims verified frames | code-complete headless; not run in Studio |
| M4 | Co-op lockstep, 2-8 players: N-player sim (`stepParty`, nearest-living targeting, per-player death / revive at the next floor, all-living stairwell, party hp / budget scaling, shared score), party recording codec, server relay (input delay 3, repeat-last, leavers), hash ledger desync detection, the server's own merged log validated by SegmentedValidator, Co-op board post; KV_Party start (lowest UserId invites; every member must accept: server-enforced invite -> accept consent, party runs make their members busy until concluded); M2 progression per player (draft overlay with "waiting for N teammates", local player's items and toasts) | code-complete headless; not run in Studio |
| M5 | Leaderboards: Solo / Co-op OrderedDataStores, PB rules, write queue, read cache, panel (B); only the `endless` world posts | code-complete headless; not run in Studio |
| M6 | (not part of this slice) | open |
| M7 | (not part of this slice) | open |

Docs: `docs/SERVER.md` ("The vertical slice", "Segmented runs", "Leaderboards"), `docs/CLIENT.md` (controls, HUD,
ranked runs, co-op), `src/shared/sim/README.md` (tick order, hash group order `core`, `combatHeader`, `actors`,
`weapons`, `enemyBullets`, `playerBullets`, `endless`, `score`, `run`, `party`; "Co-op"). Integration specs:
`src/shared/run/slice.spec.ts` (solo), `src/shared/run/partyProgression.spec.ts` and
`src/shared/sim/progression/progression.party.spec.ts` (Phase B: progression in co-op).

## First-run tutorial (2026-10-25, branch `tutorial`)
A guided "Practice Descent" on the first join (before the main menu; replayable from it; a player in it is busy for
lobbies), built on the slice: the real sim in a harmless mode
(`SimConfig.tutorial`, its own appended hash group), a fixed two-floor `tutorial` world (lesson rooms, then Mother
Bramble) played locally and refused by the server, a pure `TutorialDirector` (15 funnel steps), a training dummy
archetype, onboarding persistence (`KV_Onboarding_v1`) and a tutorial funnel. T1-T7 are **code-complete and verified
headlessly only** (`npm run verify`: 108 suites, 1458 of 1459 tests pass; the one failure is the known `forge.spec.ts`
NaN sign-bit vector on x86); none of it has run in Studio yet, and the T8 playtest is pending. Plan, as-built notes,
owner decisions and the Studio smoke test: `docs/TUTORIAL.md`.

## Tasks
- [ ] 1. **Scaffold and spikes:** run `npx create-roblox-ts`, then add Flamework, Rojo and jest+Lune. Spike A:
  1,000 pooled bullet Parts moved with `workspace:BulkMoveTo`. Spike B: iso camera (low FOV, far distance, follow
  with snap). → Verify: `rbxtsc` builds and `rojo serve` syncs. Spike A holds 60 fps on PC and the result in the
  Studio phone emulator is written down. Spike B looks acceptable. **Go/no-go gate.**
- [x] 2. **Golden fixtures:** in this repo, add `scripts/export-fixtures.ts`. It writes the mulberry32 sequences for
  three seeds, Dungeon Forge layouts for seeds 1337/42/7, and a scripted 60 s run (recording plus a `hashState` per
  second). → Verify: JSON files are committed in the port repo.
- [x] 3. **Theme layer:** port the contract, manifest types, placeholder pack, string table, validator and the
  no-asset-IDs test. → Verify: the placeholder pack validates with zero problems. A missing ID logs once and returns
  the fallback.
- [x] 4. **Sim core:** `rng` (a split-16-bit `imul` helper and `bit32`), `input`, `loop`, `state`, `step`, `player`,
  and `replay` (FNV-1a over a Luau `buffer`). Fix the JS-isms: `.length` → `.size()`, `null` → `undefined`,
  getters → methods, `Number.is*` helpers. → Verify: the RNG fixture matches bit for bit, and player-only replays
  hash the same.
- [x] 5. **Dungeon Forge plus world builder:** port `generate.ts`/`collision.ts`, then build the floor as Parts tinted
  by biome color role. → Verify: the three layout fixtures match, and seed 1337 is walkable in Studio.
- [x] 6. **Bullets:** rewrite the r3f-projectiles core (pool, step, walls, hits) and the patterns (`gen.arc`,
  `compose`, `definePayload`, `fireBurst`). Add `?stress` as a debug attribute. → Verify: the pattern unit tests
  pass, and the sim takes under 1 ms per tick with 1,000 bullets.
- [x] 7. **Combat, weapons, actors, boss:** port `combat`, `ctx`, `patterns`, the weapon defs, the archetypes and
  `boss/act1.ts` together with their tests. → Verify: the full-run fixture hash matches every second.
  `enemies.determinism` and the boss TTK tests reproduce the M1.md numbers.
- [x] 8. **Client presentation (Flamework controllers):** Input (gamepad parity; rebind Tab and Escape, which Roblox
  reserves), Camera, Sim (fixed step and interpolation on `RenderStepped`), Actor/Bullet renderers (pooled),
  telegraphs, arena seal, HUD and boss bar (react + charm), juice (health bars, damage numbers, hitstop,
  ParticleEmitter bursts, settings saved per player). → Verify: in Studio, a run from the entrance through a boss
  kill and a restart works on keyboard and on a gamepad.
- [x] 9. **Server (Flamework services):** a `RunService` receives seed plus the RLE recording through a typed remote,
  reruns `runReplay` and compares hashes. Add telemetry through AnalyticsService (replaces F9 export) and settings
  through a DataStore. → Verify: an honest run validates, and a run with one edited input frame is rejected.
- [ ] 10. **Verification:** all jest suites pass. Play the M1 checklist on PC, the phone emulator and one real phone,
  and record fps with 1,000 bullets on each. → Verify: every M1 verb works and every fixture still matches.

## Done When
- [ ] The M1 fight is playable on Roblox, end to end, using placeholder assets only.
- [ ] Replays match the web build's hashes.
- [ ] Replacing art and audio means editing the manifest only.

## Notes
- Critical path: 1 → 2 → 4 → 6 → 7 → 8. Tasks 3 and 5 can run alongside 4. Task 9 can start after 4.
- Accepted losses: the true 480x270 pixel grid, true orthographic projection, Electron and Steam.
- Risk: bullet count on mobile. If Spike A fails, cap enemy bullets per device class and keep the sim number the same.
