# Dynamic difficulty ("Respite"): plan

When a player is **struggling**, the game quietly **eases off**: enemies get a little less hp, their bullets fly a
little slower, they attack less often and telegraph longer, boosts drop more often and the boon draft leans towards
defence. It is **assist only**: a player who is doing well plays exactly today's game, and the current tuning is the
ceiling. The assist is **visible** (a small "Respite" gauge, a toast when it changes) and **costs score** (a multiplier
below x1 while it is on), so the leaderboards stay fair. Work it task by task, like `PLAN.md` and `docs/BOOSTS.md`;
each task ends with a **Verify**.

This is **gameplay**: the meter, the levels and every lever live in the sim, so they replay, validate on the server and
step in lockstep. It follows the drops pattern (docs/BOOSTS.md): opt-in `SimConfig.respite`, its own
`SimState.respite`, its own hash group appended last. It needs **no rng** at all (every rule is a pure function of
hashed state). Without `SimConfig.respite` nothing changes: M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the
tutorial replay exactly as before.

## Status (2026-10-27)

Planned. Owner decisions taken (below, "Decisions"); recommended defaults RP1-RP10 are open until the task in
brackets. Nothing built.

## What the code gives us (read on `main` @ `d627bf4`)

| Fact | Where | Consequence |
|---|---|---|
| Endless scaling is applied where things are made: actor hp in `spawnActor` (`endlessActorHp` x floor x Depth, then `partyHpMultiplier`, then the tutorial boss percent), enemy bullet speed in `SimCtx.fireEnemy` (`scaledEnemyBulletSpeedMultiplier(floor, Haste)`, capped at `BULLET_SPEED_MAX_MULTIPLIER` 1.4) | `combat/actors/actors.ts`, `combat/ctx.ts`, `endlessData.ts` | Two choke points for hp and bullet speed. Respite's speed percent goes **after** the cap (at the cap a pre-cap factor would do nothing). Hp is read once at spawn, so enemies already in a room keep theirs |
| Every telegraph, room enemy and boss alike, starts through `ctx.telegraph(actor, ticks, attack)` | `combat/ctx.ts` (swarmer, sniper, bruiser, act1, demonlord) | One choke point for telegraph length |
| Room enemies draw their attack cooldowns with one `ctx.randomInt(min, max)` each (`volleyCooldownMin/Max`, `lungeCooldownMin/Max`, the bruiser's slam cooldown, turrets) | `combat/actors/archetypes/*.ts` | A `ctx.enemyCooldown(min, max)` helper: the SAME single draw, then scaled. Draw counts never change, so the main stream stays aligned with and without Respite until behaviour diverges |
| Both bosses run on one skeleton; every RECOVER goes through `bossRecover(a, d, ticks)` | `boss/shared.ts` | One choke point for the boss's vulnerable windows. Boss TTK floors come from `damageCapPerSecond`, so a boss hp cut is bounded by the cap anyway |
| `scaleTicks(ticks, percent)` (round half up, `percent === 100` returns the input) and `combinedPercent` already exist for Swift Strikes / Frenzy | `progression/runMods.ts` | Reuse them for cooldowns, telegraphs, boss recovery |
| Every score award goes through `awardPoints`: `floor(base x combo x depth x curse x scale x bonus)` as one exact integer numerator; Bounty already rides in `bonusPercent` | `score/score.ts` | The Respite percent folds into `bonusPercent` with Bounty (one combined integer percent): one more factor, still exact. RS5 re-checks the 2^53 bound at the deepest Depth the census reaches |
| A hit goes through `damagePlayer`: the tutorial's harmless branch, Aegis, armor, then hearts; `events.playerHits`; a death through `killPlayerState` (three callers, already hooked by `boostsOnPlayerDied`) | `player.ts`, `step.ts`, `party.ts` | Strain hooks sit beside the drops hooks: `respiteOnPlayerHit(state, i, halfHearts, armorOnly)` and `respiteOnPlayerDown(state, i)` |
| Hearts are **kept** across floors (only armor, flask and Embers refill) | `endless.ts` step 3, `refillAtCheckpoint` | Low hearts at a floor start is real, lasting danger: a strong signal on its own |
| Score keeps a record per room (engage tick, par, hits at engage, cleared) and exports `scoreRoomEngaged` / `scoreRoomDown`; endless runs are always scored | `score/score.ts`, docs/ROOM_EDGES.md | Room clears, perfect rooms and under-par clears are read from score's records, not recomputed. `createSimState` refuses `respite` without scoring |
| Drafts draw per card one rarity roll + one pick from the main rng | `progression.ts` `drawBoonOffers` | Draft bias swaps the pick's POOL (the defence boons of that rarity), not the number of draws |
| Drops roll from their own stream; `DropsConfig` has `chancePercent`, `chanceByArchetype`, `pityKills` and the boost weights | `drops/drops.ts`, `drops/dropsData.ts` | Mercy drops read the level at roll time; only the drops stream moves |
| The view predicts sim timing in places: telegraph fill from `c.telegraphTicks[a.attack]`, the cleave preview's reach from `enemyBulletSpeedScale(state)`, sprite attack animations stretched over the attack's timers | `shared/view/markings.ts`, sprite views | Every such read must go through the same Respite helpers (RS0 lists them all), or a telegraph bar fills early |
| Sessions are started with a `StartRunRequest` (world, party, class) and the server builds the SimConfig itself | `shared/run/runSessions.ts` | An opt-out flag travels in the request and is stored with the session, so the server replays with the same config |
| Leaderboards post per world to `LB_Solo_v1` / `LB_Coop_v1`, with a details document per entry (`LB_Details_v1`, versioned) | `shared/leaderboard/config.ts` | The details doc gains `respiteMax` (an "unassisted" mark); scores change, so the bump rule applies |

## Player experience

1. **Play well, nothing happens.** The gauge is hidden at level 0; the run is today's run.
2. **Have a rough room** (lose most of your hearts, or a teammate goes down) and, when the room is cleared, a soft
   chime and a toast: *Respite I: the dungeon eases off. Score x0.9.* A small gauge (three pips) appears in the status
   panel, and the score shows its multiplier.
3. **Drop to your last heart mid-fight** and Respite can step up once on the spot (a "rescue"), so the next volleys are
   already gentler. Enemies already in the room keep their hp; new bullets, new cooldowns and new telegraphs ease.
4. **Recover.** Clean rooms (no hits), quick clears and floor clears drain the meter; Respite steps back down one level
   at a time at room or floor clears, with a toast, until the gauge hides again.
5. **The results screen** shows the highest level reached, the time at each level and the points Respite cost
   ("Respite: -1,240").
6. **Co-op:** one level for the whole party (enemies are shared), from the party's average strain; a teammate going
   down weighs heavily. The draft bias follows each player's own strain.
7. **Opt out:** Settings > Gameplay > Respite: *Auto* (default) / *Off* (RP7). Off is today's game, at x1.

### Levels and levers (v1, all integer percents in `respite/respiteData.ts`)

| | Level 0 | Respite I | Respite II | Respite III |
|---|---|---|---|---|
| Enemy hp at spawn (room enemies and bosses) | 100 | 92 | 84 | 75 |
| Enemy bullet speed (after the floor / Haste cap) | 100 | 95 | 90 | 85 |
| Room enemy attack cooldowns | 100 | 110 | 120 | 135 |
| Telegraph length (every enemy and boss) | 100 | 110 | 120 | 130 |
| Boss RECOVER windows | 100 | 110 | 120 | 135 |
| Boost drop chance (per eligible kill) | base | +2 points | +4 points, pity 14 | +6 points, pity 10, Aegis weight x2 |
| Boon draft | normal | normal | first card from the defence boons | first card from the defence boons |
| Score multiplier | 100 | 90 | 80 | 70 |

Not levers (owner decision): enemy count per room and room budgets stay seeded by the run (the floor layout and
`roomSpawns` are a pure function of the run seed, `shared/run` `worldForFloor`). Nothing ever goes above today's
difficulty.

## The model

**Strain** is one integer per player (solo: one), clamped to `[0, STRAIN_MAX]`, every change by fixed integer steps:

| Event | Strain | Hook |
|---|---|---|
| Hit that costs hearts | + `STRAIN_PER_HALF_HEART` (40) x half hearts lost | `damagePlayer` |
| Hit taken by armor or Aegis | + `STRAIN_ARMOR_HIT` (15) | `damagePlayer` |
| Player goes down (co-op) | + `STRAIN_DOWN` (200) | `killPlayerState` callers |
| Room cleared with no hit since engage (perfect) | - `STRAIN_PERFECT_ROOM` (60) | score room record |
| Room cleared otherwise | - `STRAIN_ROOM_CLEAR` (20); under par: a further - `STRAIN_UNDER_PAR` (20) | score room record |
| Floor cleared | - `STRAIN_FLOOR_CLEAR` (40) | `events.floorChanged` |
| Boss killed | - `STRAIN_BOSS_KILL` (100) | `events.bossDefeated` |

A room's clear credits every living player whose strain is tracked (it is the party's room). `STRAIN_MAX` = 400.

**The level** (0..3) is party-wide: from the **party strain** = floor(sum of members' strain / party size), dead and
left players included at their strain (a down already added its weight).

- **Hysteresis:** up thresholds 100 / 180 / 260, down thresholds 60 / 140 / 220 (`RESPITE_UP`, `RESPITE_DOWN`), so a
  player on the edge does not flicker.
- **Low-health floor:** while the solo player (co-op: the party's average hearts) is at or under
  `LOW_HEALTH_HALF_HEARTS` (2 = one heart), the level is at least 1.
- **When it can change** (evaluation points, so it never shifts in the middle of a dodge): a room clear, a floor change,
  and the **rescue**: the tick a living player drops to `LOW_HEALTH_HALF_HEARTS` or below (once per player per room).
  At most one step per evaluation, up or down.
- **Start:** every run starts at strain 0, level 0 (RP3: no persistence across runs in v1).

Every tunable is in `respiteData.ts`; RS7's census and RS12's playtest set the numbers.

## Architecture

### 1. Sim: `shared/sim/respite/` (opt-in, deterministic, no rng)

**`respiteData.ts`** (tunables, a leaf): the level table above (`RESPITE_LEVELS`, index = level, APPEND ONLY), strain
steps, thresholds, `LOW_HEALTH_HALF_HEARTS`, `STRAIN_MAX`.

**`respite.ts`** (config, state, hooks, step, hash):

```ts
export interface RespiteConfig { readonly maxLevel: number } // 3; a world can cap it (0 = meter only, for tests)
export interface RespiteState {
	level: number;               // party-wide, 0..maxLevel
	strain: number[];            // per player, party index order
	rescued: number[];           // per player: 1 once the rescue fired in the current room (reset on room clear / floor)
	ticksAtLevel: number[];      // by level: run time spent there (results screen, telemetry)
	maxLevel: number;            // highest reached (leaderboard details)
	forgone: number;             // points Respite cost (results screen)
	pendingEval: number;         // 1 when a hook asked for an evaluation this tick
	events: RespiteEvents;       // NOT hashed: changed (from, to, cause)
}
```

- **Hooks** (cheap, write only `strain` / `pendingEval`): `respiteOnPlayerHit`, `respiteOnPlayerDown`, the rescue check
  in `respiteOnPlayerHit` after hearts are taken.
- **`stepRespite(state)`** after `stepScore` (both `step` and `stepParty`): read this tick's room clears (score
  records), floor change and boss kill; apply their strain; if any evaluation point fired, step the level by at most
  one; count `ticksAtLevel`. Running after `stepScore` means a room's clear award is scored at the level the room was
  played at.
- **Hash:** `writeRespiteHash` (every field but `events`, with dump names) as the `respite` group after `drops`, the
  LAST group. `cloneSimState` copies it.

**`respiteMods.ts`** (a LEAF like `boostMods.ts`; with `state.respite` undefined or level 0 each read returns its input
unchanged, `===`):

| Read | Where | Change |
|---|---|---|
| `respiteHp(state, hp)` | `spawnActor`, after party / tutorial scaling | x `hpPercent / 100` |
| `respiteBulletSpeed(state, m)` | `fireEnemy` and the view's `enemyBulletSpeedScale` | x `speedPercent / 100` after the cap |
| `respiteTelegraphTicks(state, ticks)` | `ctx.telegraph` and the view's telegraph fill | `scaleTicks(ticks, telegraphPercent)` |
| `ctx.enemyCooldown(min, max)` | room archetypes and turrets (replaces their cooldown `randomInt`) | one `randomInt(min, max)`, then `scaleTicks(..., cooldownPercent)` |
| `respiteBossRecover(state, ticks)` | `bossRecover` | `scaleTicks(ticks, bossRecoverPercent)` |
| `respiteDropChance` / pity / weights | `dropsOnKill` | the level's bonus points, pity, Aegis weight |
| `respiteDraftBias(state, i)` | `openDraft` -> `drawBoonOffers` | first card's pool = unowned **defence** boons of the rolled rarity (else any unowned defence boon, else unchanged); same draws |
| `respiteScorePercent(state)` | `award` (folded into `bonusPercent` with Bounty) | the level's score percent; `forgone` += the difference |

Telegraph lengths only ever grow and bullet speeds only ever drop, so nothing a player has learned gets harder to read.

### 2. Worlds and sessions

| World | `SimConfig.respite` |
|---|---|
| M1, every fixture, the tutorial | absent: unchanged |
| Endless solo and co-op (`buildEndlessRunConfig`) | `RESPITE_CONFIG` unless the session says Off |

`StartRunRequest.respite?: boolean` (absent = on). The server stores it on the session and builds the same config for
`validateRun` / `SegmentedValidator` and the lockstep party. Co-op: the run owner's setting, shown on the lobby card
(RP8).

### 3. Client

| Piece | Change |
|---|---|
| `takeSnapshot` | `respite: { level, maxLevel, scorePercent }` (party-wide, so no vitals index) |
| `ui/hud/RespiteGauge.tsx` (in `StatusPanel`, beside `BoostRow`) | three pips, hidden at level 0, `useHudScale`, inside its `HUD_FOOTPRINT` box (`footprint.spec.ts`) |
| Score panel | the combined multiplier (curse x Respite) when it is not x1 |
| `ToastPanel` | `hud.toast.respite.up` / `.down` (`Respite {level}: ... Score x{mult}`) |
| Results / run-over panel | a Respite row: highest level, time per level, points forgone |
| Settings | `GameplaySettings.respite` (Auto / Off; only Off stored, the settings doc stays at its version, like `roomEdges`) |
| Lobby card | the owner's Respite setting |
| View timing audit | markings' telegraph fill, the cleave preview reach, sprite attack segments: all through `respiteMods.ts` |
| Audio | `sfx.respite.up` / `sfx.respite.down` in the cue mapper |
| First time (RP9) | a one-off explainer toast the first time Respite engages, remembered in `KV_Onboarding_v1` |

### 4. Theme contract

Required in every pack: strings `hud.respite.name`, `hud.respite.level.<1..3>`, `hud.toast.respite.up/down`,
`results.respite.*`, `options.gameplay.respite`; a UI colour role `respite` (>= 3:1 on the HUD panel); `sfx.respite.up`
/ `.down` appended to `PORT_AUDIO_EVENTS` (SILENT in the placeholder). No world-space art: Respite never draws in the
arena, so no bullet-distance rule.

### 5. Server, lockstep, leaderboards, telemetry

- **Replays:** nothing new (same deterministic sim, no rng). Per tick: a few integer reads and one hash group; re-run
  `replay.bench.spec.ts` against docs/SERVER.md's budget.
- **Leaderboards:** endless scores change: before launch no reset; after launch bump `LB_Solo_v1` / `LB_Coop_v1`
  (docs/DECOR.md B8 rule). The details doc gains `respiteMax` (version bump); the panel marks unassisted runs (RP6).
- **Telemetry** (`TelemetryService`): `respite_changed` (from, to, cause, floor, depth, party size) and, at run end,
  ticks at each level and `maxLevel`. The tuning loop for RS12 and after.

## Tasks

- [ ] **RS0. Confirm the assumptions.** Every row of "What the code gives us"; the exact tick order of `stepEndless`,
  `stepRun` (draft open), `stepDrops`, `stepScore`; every `randomInt` in the archetypes that is a cooldown (and the
  ones that are not); every view read of telegraph lengths, bullet speed or attack timers; the `awardPoints` numerator
  bound; the leaderboard details doc. -> Verify: each row confirmed or this plan edited.
- [ ] **RS1. State, data, hash.** `respite/respiteData.ts`, `respite/respite.ts` (create, clone, events,
  `writeRespiteHash` + names), `SimConfig.respite`, `SimState.respite`, the `respite` group in `hashLayout.ts`, barrel;
  `createSimState` refuses `respite` without scoring. -> Verify: `npm run verify` with every golden fixture, the M1
  hash, the tutorial lock spec and existing endless replays unchanged (nothing sets the config yet); clone / hash
  specs.
- [ ] **RS2. Strain and levels.** The hooks, `stepRespite`, hysteresis, the low-health floor, the rescue, the co-op
  party strain. -> Verify: `respite.spec.ts`: each event's strain step; clamp; one step per evaluation; no change
  between evaluation points; rescue once per player per room; hysteresis (no flicker on a threshold); draft freeze
  stops `ticksAtLevel`; co-op mean with a dead member; the tutorial's harmless hits add nothing (no config there).
- [ ] **RS3. Combat levers.** `respiteMods.ts`; hp in `spawnActor`, speed in `fireEnemy`, `ctx.telegraph`,
  `ctx.enemyCooldown` in every room archetype and turret, `bossRecover`. -> Verify: neutral paths return their input
  (`===`) at level 0 and without the config; exact values per level; the main rng draw count per enemy unchanged;
  boss TTK tables (`bossAct1.ttk`, `demonlord.ttk`) at each level stay above the cap's floor; bullets at the 1.4 cap
  still slow down.
- [ ] **RS4. Mercy levers.** Drops (chance, pity, Aegis weight) and the draft bias. -> Verify: draws per kill and per
  card unchanged in count; the bias only offers unowned defence boons and falls back cleanly; co-op uses each player's
  own strain for their draft.
- [ ] **RS5. Score.** The Respite percent in `award` (combined with Bounty), `forgone`. -> Verify: exact awards per
  level with and without Bounty; numerator below 2^53 at the census's deepest Depth x max combo x 4 curses; the score
  hash group is unchanged in layout (Respite's own fields are in `respite`).
- [ ] **RS6. Worlds and sessions.** `RESPITE_CONFIG` in `buildEndlessRunConfig`, `StartRunRequest.respite`, the
  session store, the lockstep party. Re-record the endless specs (`run/slice`, `run/endless`, `run/party`,
  `run/partyProgression`). -> Verify: live runs replay to their hashes and validate segmented with Respite on and off;
  an Off session refuses a submission recorded with it on; replay bench within budget.
- [ ] **RS7. Census.** `run/respiteCensus.spec.ts`: a sword bot that clears rooms well and a "clumsy" bot (walks into
  every Nth volley), seeds 1337 / 4242 / 90210, floors 1-10, with and without Respite. -> Verify: the good bot stays at
  level 0 on every floor; the clumsy bot reaches level 2-3, survives more floors with Respite than without, and its
  score is lower than the good bot's; the spec log writes level per floor, floors survived and points forgone.
- [ ] **RS8. Theme.** Strings, the `respite` role, the two sounds, placeholder pack, validator. -> Verify: contract /
  validator / `audio.spec.ts` / `hud.spec.ts` token checks.
- [ ] **RS9. Client.** Snapshot fields, `RespiteGauge`, score multiplier, toasts, results row, setting, lobby card,
  the view timing audit, audio, the first-time explainer. -> Verify: `snapshot.spec.ts`, `footprint.spec.ts`, a
  markings spec (the telegraph fill reaches full exactly when the sim's telegraph ends, per level); Studio (`KV_Debug`
  key to add strain, RP10): gauge, toasts, results row, Off setting.
- [ ] **RS10. Telemetry and leaderboards.** The two events, `respiteMax` in the details doc, the unassisted mark, the
  board bump decision. -> Verify: telemetry spec (fields, no PII); details codec spec (old v1 docs still read).
- [ ] **RS11. Docs.** `CLAUDE.md` decision log line, `src/shared/sim/README.md` (module row, tick order, hash group
  list), docs/CLIENT.md (HUD, setting, debug key), docs/SERVER.md (session flag, replay cost). -> Verify:
  `npm run verify`.
- [ ] **RS12. Playtest.** Solo and 4-player, new and experienced players, PC and phone: does Respite engage when it
  should, is it noticeable without being patronising, does anyone feel punished by the score cut. Tune `respiteData.ts`
  from the census and the telemetry.

Critical path: RS0 -> RS1 -> RS2 -> RS3 -> RS6 -> RS7. RS4 and RS5 after RS2; RS8 after RS1; RS9 after RS6 and RS8;
RS10 after RS5.

## Edge cases

- **Hit on the tick a room clears:** the hook adds strain first, `stepRespite` then credits the clear and evaluates:
  one evaluation, deterministic order.
- **Rescue and the low-health floor on the same tick:** one evaluation; the floor only ever raises the result to 1.
- **A boss floor:** the boss's hp is fixed at its spawn (floor start), so only a level reached before the floor eases
  its hp; telegraphs, bullet speed and recovery follow the level live.
- **Drafts:** the world is frozen; strain and `ticksAtLevel` freeze with it. The draft bias reads the level as the floor
  ended.
- **Second Wind / Aegis:** a hit they absorb is an armor-class hit (+15), not a heart loss; a Second Wind save counts
  the hearts actually lost.
- **Curses:** a cursed run can still be assisted; the multipliers multiply (Frailty x1.25 with Respite II x0.8 = x1.0).
  Haste and Respite both act on bullet speed: Haste before the cap, Respite after it.
- **Co-op leaver:** a player who left keeps their strain in the mean (so leaving does not make the party's game
  harder); RP4 may revisit this.
- **Spectating:** the gauge is party-wide, so it does not follow the watched player.
- **Debug floor skip (N):** no floor-clear credit (it is not a clear), so skipping cannot drain strain.

## Decisions (2026-10-27, Kaleb)

- **Assist only.** Respite eases the game for struggling players and never makes it harder than today's tuning.
- **Visible, with a score multiplier.** A HUD gauge and toasts; the score multiplier follows the level, so an assisted
  run scores less and the leaderboards stay fair.
- **Levers:** enemy hp and bullet speed, enemy fire cadence (cooldowns, telegraphs, boss recovery), mercy / rewards
  (boost drops, draft bias). **Not** enemy count or room budgets.
- **Scope: endless solo and co-op.** M1, every fixture and the tutorial are untouched; co-op reads the whole party.

## Recommended defaults (confirm or change before the task in brackets)

- **RP1. Name "Respite", three levels** [RS1]. Short, in-world, says "eases off" without "easy mode".
- **RP2. Evaluation only at room clears, floor changes and the last-heart rescue** [RS2]. Never mid-dodge.
- **RP3. Every run starts at level 0; no skill rating across runs in v1** [RS2]. A persisted rating would have to be
  part of the server's session config; revisit after telemetry.
- **RP4. Co-op: one party level from the mean strain; drafts from each player's own strain** [RS2]. Max instead of
  mean would cut the whole party's score for one player's rough room.
- **RP5. The lever and score table above** [RS3 / RS5; tuned in RS7 / RS12]. Score drops faster than difficulty
  (x0.7 at III for -25 % hp), so nobody farms Respite.
- **RP6. Leaderboard: one board, `respiteMax` in the details, an "unassisted" mark** [RS10]. No separate boards.
- **RP7. Opt-out setting, default Auto** [RS6]. Off is today's game at x1.
- **RP8. Co-op uses the run owner's setting, shown on the lobby card** [RS6].
- **RP9. A one-off explainer the first time Respite engages** [RS9]. Stored in `KV_Onboarding_v1`.
- **RP10. A `KV_Debug` key that adds strain** [RS9]: a port input bit like `DEBUG_DROP_BUTTON` (next free bit and key
  chosen in RS0), so Studio testing replays.

## Risks

- **Patronising or invisible:** too small and nobody notices, too big and it feels like the game gave up. The toast
  wording and RS12 are the mitigation; the levers are deliberately small per level.
- **Sandbagging:** taking hits on purpose to lower difficulty. Hits cost hearts that do not refill between floors, and
  the score cut makes it a bad trade for score chasers; the census (RS7) checks a clumsy bot never outscores a clean
  one.
- **View drift:** any view code that still reads raw archetype timings shows a wrong telegraph; RS0's list and the
  RS9 markings spec cover it.
- **Co-op balance:** a strong player carrying a weak one sees easing they did not need (and a lower score). The mean,
  the hysteresis and RP4's revisit are the mitigation.
- **Replay and validation:** every lever is read from hashed state, so a mismatch shows as a hash mismatch at the first
  checkpoint, not a silent drift.

## Out of scope

- Making the game harder than today's tuning (a "Heat" / challenge mode would be its own plan, likely an opt-in
  modifier like curses).
- Changing enemy counts, room budgets, layouts or the boss pick.
- Healing pickups (docs/BOOSTS.md keeps hearts with the flask and Vampire Fang).
- A persisted cross-run skill rating, and Respite in M1 or the tutorial.
