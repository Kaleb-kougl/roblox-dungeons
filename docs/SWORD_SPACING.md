# Sword spacing

The Knight walks into the enemies he means to hit: the player holds toward an enemy, attacks, keeps holding, and the
body ends up inside contact range (a heart lost to a swarmer, a slime, a reaper, a bruiser or a boss). This plan adds
two rules to the sim, both on the sword only:

- **Spacing brake** (idea 2): while the Knight is attacking, his walk never takes him inside a contact enemy's keep
  distance (its contact range plus a small margin). Moving along or away is untouched; only the step into the enemy is
  removed.
- **Lunge to the target** (idea 4): the finisher's lunge stops at the same keep distance instead of always carrying the
  full 0.6 tiles.

Work it task by task, like `docs/WALL_SLIDE.md`; each task ends with a **Verify**.

**Gameplay (sim).** The Knight's walk and lunge change near enemies in every world, M1 included (SPD6), so live
replays and scores change. Every golden fixture and the web-tuned specs still match bit for bit: they replay under
`setSwordSpacing(SwordSpacing.WEB)`, next to `setPlayerMover(PlayerMover.WEB)` / `setSwordTimings(WEB_SWORD_TIMINGS)`.
No new state, no new hash group, no wire change: the brake reads only hashed state.

## Status (2026-11-19)

SP0-SP3 and SP8 built 2026-11-19 (the measurement, the brake core, the walk, the lunge, the wiring in every world, the
tutorial pins); SP4-SP7 and SP9 open.

**Owner (2026-11-19): every open question answered** (keyboard and mouse; brake only while attacking, SPD1; M1
included, SPD6; no knockback for now, SPD4). On keyboard and mouse the facing is the mouse's (the "facing follows the
walk" row below is not the cause there), and the walk is the keys': all or nothing, 8 directions, 45 degrees apart.
A key is rarely aimed straight at an enemy (up to 22.5 degrees off), so a plain slide would drift the Knight sideways
around it: the brake stops him outright inside a stop cone (Design 2, SPD8). SP0's greedy fighter and SP7's playtest
lead with keyboard and mouse.

## Why the Knight walks into enemies (findings)

| Fact | Where | Consequence |
|---|---|---|
| The player and enemies never collide. Contact damage is an overlap test: centre distance < `a.radius + PLAYER_RADIUS` (0.35), first live actor with `contactDamage > 0` in slot order. | `combat/actors/actors.ts` `stepContactDamage` | Nothing stops the body before it touches. Holding toward an enemy walks straight into it. |
| A swing hits an enemy whose centre is within `reach + a.radius` (1.955 + r) in a 120-degree fan; the finisher 2.53 + r in 180 degrees. | `sword.ts` `SWORD_DATA`, `melee.ts` `sweepArc` | A swarmer is hit from 2.255 and hurts from 0.65: **1.6 tiles of safe reach** the player does not need to cross. |
| Swings 1 and 2 do not slow the walk: `moveMultiplier` is 0.5 only in the guard, 0.35 only in the finisher's wind-up. | `sword.ts` `moveMultiplier` | Walk 6 tiles/s = 0.1 a tick. A held stick keeps walking through the combo: one swing recovery (14 ticks) is 1.4 tiles. |
| The finisher's wind-up lunges `lungeDistance` 0.6 along the facing (11 ticks of 0.0545), on top of the slowed walk. | `sword.ts` `step` | The third hit always carries the Knight about 0.98 tiles forward, into whatever he faces. |
| With no aim input the facing follows the move input. With a mouse the aim is always the pointer's direction (`play/inputMapping.ts`, `aimDevice` "mouse"). | `player.ts` `stepPlayer` (facing) | On a gamepad without the right stick pointing the sword means walking at the enemy. **Not the owner's case** (keyboard and mouse): there the walk is separate from the aim, and the player walks in by holding a key. |
| Keys are all or nothing: a held key is a full-speed walk (0.1 a tick) in one of 8 screen directions (`screenToWorld`, 45-degree camera); a stick can ease in, a key cannot. | `play/inputMapping.ts` | On keyboard the Knight closes 1.4 tiles in one swing's recovery unless the key is released at the right tick. The brake does that release for him. |
| The finisher lunges along the facing, which on mouse is the pointer's direction, not the enemy's. | `sword.ts` `step`, `inputMapping.ts` | A pointer placed on or past the enemy lunges straight through it. |
| Order in a tick: stepPlayer (the walk) -> stepCombat: stepActors (enemies move) -> stepWeapons (the swing, the lunge) -> ... -> stepContactDamage. | `step.ts`, `combat/combat.ts` | The walk sees enemies at tick start; the lunge runs after they moved. Both must read the same positions for prediction parity (Design 1). |
| Contact enemies and their contact range (+0.15 margin = keep): swarmer 0.65 (0.80), slimelet 0.70 (0.85), reaper 0.75 (0.90), bruiser 0.85 (1.00), slime 0.90 (1.05), both bosses 1.55 (1.70). Every other archetype has `contactDamage` 0. | archetype `data` | Every keep distance is far inside the swing's reach, so a braked Knight still hits. |
| Some contact enemies close the gap themselves: the swarmer chases to `chaseStop` 0.55 (inside its 0.65) and lunges from 2.8; the bruiser walks to contact - 0.05. | `swarmer.ts`, `bruiser.ts` | **The brake cannot stop these** (SPD4: it never pushes the player out). SP0 measures how many contact hits are the player's doing and how many the enemy's. |

## Design

### 1. The spacing list (transient, rebuilt from hashed state)

`buildSpacingList(state, out)` (new `sim/combat/spacing.ts`) fills a flat list of `(x, z, keep)` for every live actor
with `contactDamage > 0`, in slot order: `keep = a.radius + PLAYER_RADIUS + SWORD_SPACING.marginTiles`. It reads only
hashed fields (`kind`, `alive`, `x`, `z`, `radius`), allocates nothing (the list's arrays grow once and are reused),
and is never hashed (the Warbanner aura mask and the Siege pin mask are the precedent).

It is built **once per tick, at the start of the step**, before stepPlayer (solo `step` and `stepParty`), and both the
walk and the lunge read that one list. So both see tick-start positions, and the prediction mirror can build the same
list from the merged state and match the sim bit for bit (Design 5). An actor spawned this tick is not on it until the
next tick; a bomber that blew up this tick is still on it (harmless: bombers have no contact damage).

The sim owns one list (module scratch in `spacing.ts`, reached as `ctx.spacing` in combat and passed to stepPlayer);
the predictor owns its own (in its `MotionScratch`), so a prediction pass never overwrites the sim's.

### 2. The brake: `brakeStep`

`brakeStep(list, px, pz, dx, dz) -> (dx', dz')` (module scratch result, read before the next call), pure, `sqrt` only,
fixed order:

1. For each entry in order, with `e` the entry's centre and `d = |P - e|`:
   - skip it unless the step moves toward it (`S . (P - e) < 0`) and the step's end is inside `keep`;
   - `n = (P - e) / d` (an exact overlap, `d` = 0, uses the step's own reverse as `n`: deterministic);
   - **stop cone** (SPD8): if the step points at the entry within `SWORD_SPACING.stopConeCos` (cos 25 degrees, wider
     than a key's worst 22.5), the tangential part is dropped too, so a key held roughly at the enemy stops the Knight
     instead of sliding him round it; outside the cone the tangential part is kept (walking past an enemy still works);
   - outside keep (`d >= keep`): cut the inward part of the step to `d - keep`, keep the tangential part (none in the
     stop cone);
   - inside keep already (`d < keep`, the enemy walked in): remove the whole inward part (move along or away only).
2. Check pass: if the result ends deeper inside any entry's keep than the start did (two enemies, the second cut pushed
   the step into the first), remove every violator's inward part from the original step once; if that still violates,
   the step is zero.

Contract (pinned by SP1's specs, as the wall slide's are):

- never longer than the step; never against the input (`result . step >= 0`, like WSD7);
- never pushes the player out of an enemy: a body already inside keep stays where the enemy put it;
- far from every entry (or with an empty list) the result is the step itself, bit for bit;
- deterministic: same list, same start, same step, same bits.

The braked step then goes to `movePlayer` as today (the wall slide, sub-steps of 0.1). A wall that deflects the
braked step can still slide the body toward an enemy; SP4's census measures how often.

### 3. When the brake is on (the walk)

A new optional weapon hook `spacing?(slot, buttons): boolean` (like `moveMultiplier`), read through
`weaponSpacingActive(weapons, buttons)`; without the hook, false. The sword's:

- FIRE held (`buttons & Button.FIRE`), or
- a combo in progress: `v[SWORD_V_BUSY] > 0` (a swing's recovery), `v[SWORD_V_WINDOW] > 0` (the 0.5 s combo window),
  or `v[SWORD_V_STEP] === SWORD_STEP_WINDUP`.

Not during the guard alone (a block is for bullets, SPD1), never on a roll (SPD3). In stepPlayer the walk becomes
`brakeStep(spacing, p.x, p.z, mx * walk, mz * walk)` when `spacing` is passed and the hook says on; else exactly
today's `movePlayer(state, mx * walk, mz * walk, ...)`. The facing is unchanged (still the aim or the move input), so a
braked Knight keeps facing the enemy he is holding toward.

The Archer carries no sword and no hook: nothing changes for him. A dev "Both weapons" player is braked only with the
sword in hand.

### 4. Lunge to the target (the finisher)

In sword.ts' wind-up the lunge step `p.faceX * lungeStep, p.faceZ * lungeStep` goes through the same `brakeStep` with
`ctx.spacing` (the tick-start list, Design 1) before `movePlayer`. So the lunge carries the Knight up to the nearest
contact enemy's keep distance in front of him and no further; with nothing in the way it is the full 0.6 as today. The
wind-up's timing, the strike tick and the finisher's reach (2.53 + r, far past every keep) are unchanged, so the
finisher still lands.

### 5. Prediction (co-op)

`predictMotion.ts` mirrors both: the walk mirror calls `brakeStep` with the sword mirror's `spacing` answer, the lunge
mirror calls it too, both against the predictor's own list built from the merged state at the start of a prediction
pass. The predicted Knight brakes against where the enemies were in the merged state (up to 20 ticks old); the
smoother corrects the difference like any other mispredict. One-tick parity is exact (the sim's list is built from the
same tick-start state). In the multi-tick horizon checks a horizon whose brake engaged while an entry moved is excused
(SP5). **CLAUDE.md's rule applies: the mirror changes with the sim, and `predictMotion.spec.ts` keeps passing.**

### 6. Wiring and parity

`SimConfig.spacing?: SpacingConfig` (opt-in, undefined = today exactly: no list built, the walk and lunge unbraked).
It is set by one helper, `swordSpacing()` in shared/run, in the same builders WS4 wired `playerMover` (`buildRunConfig`,
`buildEndlessRunConfig` / `endlessFloorWorld`, the tutorial), read when the config is built. A specs-only switch
`setSwordSpacing(kind)` returns the previous kind:

- `SwordSpacing.ON` (default): `SWORD_SPACING`;
- `SwordSpacing.WEB`: undefined (the web build's sword).

The 11 parity files that set `PlayerMover.WEB` also set `SwordSpacing.WEB` and still match bit for bit. Tunables in
`SWORD_SPACING` (`sim/combat/spacingData.ts`): `marginTiles` 0.15, `stopConeCos` (cos 25 degrees, a literal: no trig
in the sim), and `lunge` true / `walk` true to switch each rule off on its own in a playtest.

Replays and scores change where a braked Knight walked or lunged near a contact enemy (endless, daily, dev, co-op,
tutorial, live M1 per SPD6); M1 runs recorded by older builds no longer replay. All-time boards stay `_v1`;
`DAILY.ruleset` 24 -> 25. Unchanged: the server validator (same builders), the lockstep wire, the hash layout, the
Archer.

## Decisions (SPD1, SPD4 and SPD6 the owner's; the rest proposed, confirmed in SP7)

- **SPD1. Only while attacking (owner, 2026-11-19).** The brake is on while FIRE is held or a combo runs, not whenever
  the sword is in hand. An always-on brake would make every contact enemy a soft wall and change how the player
  threads a pack.
- **SPD2. Only contact enemies.** Turrets, snipers, summoners and every other harmless body can be walked into as
  before, and the lunge still carries through them.
- **SPD3. Never the roll.** Rolling through a swarmer pack on i-frames stays a skill.
- **SPD4. No push, no knockback (owner, 2026-11-19: knockback not yet).** The brake only removes the player's own
  step into an enemy; an enemy that walks or lunges into the Knight still touches him. Knockback (idea 5) and swarmer
  tuning (idea 8) stay out of this plan whatever SP0 finds; SP0's enemy-driven share is recorded for a later plan.
- **SPD5. Margin 0.15 tiles.** Enough that an enemy standing still is not touched by a full walk tick (0.1); small
  enough that every swing still reaches (the widest keep, a boss's 1.70, is 2.03 inside the finisher's reach). Tuned in
  SP7.
- **SPD6. Every world, M1 included (owner, 2026-11-19)**, like WSD1: one Knight everywhere. The web sword survives
  only as `SwordSpacing.WEB` for parity.
- **SPD7. The sword only.** A weapon hook, so the Archer and any future weapon opt in on their own.
- **SPD8. A stop cone for keys** (proposed, from the owner's keyboard answer). Within 25 degrees of the enemy the brake
  stops the Knight; wider, it lets him slide round the keep circle. 25 covers every key direction aimed at an enemy (at
  most 22.5 off); SP7 tunes it (0 = always slide).

## Open questions for the owner

1. ~~Which input do you play on when it happens?~~ **Answered 2026-11-19: keyboard and mouse.** The aim-snap idea (#1
   of the first round) mostly helps sticks, so it stays out of this plan.
2. ~~Only while attacking, or whenever the sword is out?~~ **Answered 2026-11-19: only while attacking** (SPD1).
3. ~~M1 too?~~ **Answered 2026-11-19: yes** (SPD6).
4. ~~Knockback next if SP0 finds most hits are enemy-driven?~~ **Answered 2026-11-19: not yet** (SPD4). This plan goes
   ahead whatever SP0 finds.

## Order of work

1. SP0 (measure), then SP1-SP3 (the brake core, the walk, the lunge and the wiring), SP5 (prediction).
2. SP4 (census), SP6 (debug view), SP7 (playtest).
3. SP8 (tutorial) and SP9 (docs) before merge.

## Tasks

- [x] **SP0. Measure first.** A census spec `run/swordSpacing.census.spec.ts` (`--census`, sharded by seed if long)
  on endless floors 1-10, seeds 1-30, the Knight, with two fighters from `run/testing/characterTune.ts`:
  - **tidy**: today's fighter (stops at `TUNE_SWORD_CLOSE` 1.4, holds FIRE in reach);
  - **greedy**: the same, but it keeps walking at its target while attacking (the human habit in the complaint), as a
    keyboard and mouse player does: the move input is the nearest of the 8 key directions (`screenToWorld` +
    `quantizeAxis`, full magnitude), the aim the exact direction to the target (the pointer on the enemy).
  For every contact hit, attribute it over the 10 ticks before: **player-driven** when the player's own walk or lunge
  closed more of the distance than the enemy did, else **enemy-driven**; per archetype. Also: contact hits per room,
  room clear time, and how often a greedy Knight is inside a keep distance.
  → Verify: the table goes in this doc (the baseline for SP4, and the enemy-driven share for a later knockback plan).
  The work goes on to SP1 whatever the split (SPD4).

  **As built (SP0, 2026-11-19).** `run/testing/spacingCensus.ts` (`spacingRun`, `swordSpacingShard`, `ContactProbe`,
  `greedyKnightFrame`), shard specs `run/swordSpacing.census.<n>.spec.ts` (10 shards of 3 seeds; `--census` only,
  otherwise they run nothing) and a fast `run/swordSpacing.smoke.spec.ts`. `survivalBot.ts` gained an optional
  `SurvivalOptions.fighter` (the fight frame, default `fighterFrame`). The full grid ran: floors 1-10 x seeds 1-30, both
  fighters, the real path (`buildEndlessRunConfig(seed, 1, { characters: ["knight"] })`, survivalBot's descent: every
  room fought, the boss fought, greedy drafts), **immortal** (Driver's heart top-up before every tick: hits land and
  count, no death ends a run, so all 300 floors are sampled per fighter). 1016 s wall on 2 cores, shards two at a time
  (about 3.3 min a shard side by side).
  - **Contact hits, exactly:** `SimCtx.hurtPlayerAt` / `hurtPlayer` wrapped for the run (restored after); a landed call
    whose caller (`debug.info(2, "n")`) is `contactDamageOn` is a contact hit, `enemyBulletHit` a bullet hit, anything
    else (Jackal lunge, Charger, Shieldwall bash) "other". Its actor is `contactDamageOn`'s pick (first overlapping
    contact actor in slot order). No sim change.
  - **Attribution:** over the 10 ticks before, each tick's change of the player-actor distance split symmetrically
    (mean of "player moved first" and "actor moved first"); player-driven when the player's closing is larger. The
    player's part is split again by what moved him: walk ticks, lunge ticks (the finisher winding up), roll ticks.
    "Standing": neither side closed 0.05 tiles (already overlapping when the post-hit window ran out).
  - **Greedy fighter:** the tidy decisions; every in-sight frame a full key move (the 8 `keyboardMoveVector` directions
    through `screenToWorld`, quantized) at the target, straight within `SWORD_DATA.reach + 1` of its edge, along the
    path farther; one tidy frame after a key move stalled on a wall (without it 112 of 2375 rooms timed out with the
    bot pressed into a wall); aim the exact direction (the pointer on the enemy). Rolls snap to the nearest key.

  | fighter | archetype | contact hits | player-driven (lunge-led) | enemy-driven | standing | mean closing player (walk / lunge / roll) / enemy |
  |---|---|---|---|---|---|---|
  | tidy | swarmer | 417 | 116 (99) | 301 | 38 | 0.29 (0.10 / 0.18 / 0.01) / 0.67 |
  | tidy | slime | 706 | 65 (59) | 641 | 140 | 0.07 (0.01 / 0.06 / 0.00) / 0.20 |
  | tidy | slimelet | 531 | 111 (108) | 420 | 313 | 0.05 (0.00 / 0.05 / 0.00) / 0.05 |
  | tidy | reaper | 237 | 78 (56) | 159 | 27 | 0.11 (0.03 / 0.09 / 0.00) / 0.14 |
  | tidy | bruiser | 552 | 354 (320) | 198 | 143 | 0.35 (0.00 / 0.28 / 0.06) / 0.04 |
  | tidy | room enemies | 2443 | 724 (642) | 1719 | 661 | |
  | tidy | Mother Mayhem | 2176 | 1071 (360) | 1105 | 1136 | 0.19 (0.15 / 0.04 / 0.00) / 0.00 |
  | tidy | Demon Lord | 2309 | 847 (451) | 1462 | 1548 | 0.18 (0.13 / 0.05 / 0.01) / -0.01 |
  | greedy | swarmer | 612 | 445 (155) | 167 | 35 | 0.68 (0.46 / 0.21 / 0.01) / 0.37 |
  | greedy | slime | 792 | 578 (64) | 214 | 234 | 0.68 (0.64 / 0.05 / 0.00) / 0.18 |
  | greedy | slimelet | 460 | 164 (35) | 296 | 268 | 0.10 (0.10 / 0.00 / 0.00) / 0.06 |
  | greedy | reaper | 555 | 500 (81) | 55 | 44 | 0.71 (0.59 / 0.11 / 0.01) / -0.05 |
  | greedy | bruiser | 665 | 529 (41) | 136 | 141 | 0.77 (0.62 / 0.06 / 0.09) / 0.04 |
  | greedy | room enemies | 3084 | 2216 (376) | 868 | 722 | |
  | greedy | Mother Mayhem | 1956 | 1195 (134) | 761 | 887 | 0.40 (0.31 / 0.02 / 0.07) / 0.00 |
  | greedy | Demon Lord | 2180 | 929 (162) | 1251 | 1480 | 0.30 (0.28 / 0.01 / 0.01) / 0.00 |

  (Swarmer rows include the Demon Lord's summons; no contact hit came from any other archetype.)

  | fighter | rooms (cleared) | contact hits / room | mean clear | in keep / in contact, room fights | boss fights: contact hits / fight, in keep | bullet / other hits |
  |---|---|---|---|---|---|---|
  | tidy | 2374 (2353) | 1.03 | 457.9 ticks (7.63 s) | 6.3 % / 5.6 % | 74.9, 82.6 % | 928 / 236 |
  | greedy | 2368 (2367) | 1.29 | 451.2 ticks (7.52 s) | 8.7 % / 8.2 % | 69.5, 73.9 % | 1123 / 227 |

  Findings:
  - Against room enemies the greedy Knight takes 26 % more contact hits than the tidy one and 3x the player-driven ones
    (2216 vs 724, 72 % of his), led by his walk (17 % lunge-led); the reaper (90 %), bruiser (80 %), swarmer and slime
    (73 %) are mostly his doing. The walk brake (SP2) targets exactly these.
  - **The tidy fighter walks in too, by its lunge:** 89 % of its player-driven room hits are lunge-led (bruiser 320 of
    354): the finisher carries it from `TUNE_SWORD_CLOSE` 1.4 to about 0.4, inside every contact range. So SP4's "tidy:
    no change" gate is wrong as written; the lunge brake (SP3) should cut its player-driven hits as well.
  - Enemy-driven: 1719 tidy / 868 greedy room hits (swarmers' chase and lunge, slimes, slimelets that split onto the
    player). The brake cannot touch these (SPD4); the knockback plan's baseline.
  - **Bosses are a bot artefact:** `TUNE_SWORD_CLOSE` 1.4 is inside a boss's contact range 1.55, so both fighters stand
    in the boss (81 % / 72 % of boss ticks in contact, about 70 contact hits a fight, half of them "standing"). Boss
    rows measure the bot, not the habit; the brake will hold even the tidy fighter out at 1.70 there (SP4's boss TTK
    rows matter more than these counts).
  - Clear time is the same for both (7.5-7.6 s a room): walking in buys the Knight nothing.
  - SP4 adds its columns as entries of `SPACING_CENSUS_COLUMNS` (`SpacingRunOptions`: `fighter`, `label`, and its new
    `spacing` field, set with `setSwordSpacing` around the run); the doc's totals are summed from the shards'
    `[spacing-raw]` lines.
- [x] **SP1. `buildSpacingList` and `brakeStep`** (Design 1-2) in `sim/combat/spacing.ts`, tunables in
  `spacingData.ts`. Specs (`sim/combat/spacing.spec.ts`):
  - an empty list, or a step far from every entry, returns the step bit for bit;
  - head-on at a swarmer from 2 tiles at full walk: stops within 1e-9 of keep, never inside;
  - every key direction within 22.5 degrees of a swarmer stops the Knight dead at keep (no sideways drift); a key 45
    degrees off slides round it; never inside keep, never against the input;
  - an enemy that starts inside keep: away and along pass, inward is removed, nothing pushes out;
  - two swarmers side by side: no squeeze inside either keep (the check pass);
  - exact overlap (`d` = 0) is deterministic;
  - fuzz 100,000 random lists / starts / steps: the contract holds every time;
  - the list skips dead, free and harmless slots and keeps slot order.
  → Verify: `npm run test:only -- sim/combat/spacing`.

  **As built (SP1).** `sim/combat/spacingData.ts` (`SpacingConfig`, `SWORD_SPACING`), `spacingBrake.ts` (a leaf:
  `SpacingList`, `newSpacingList` / `clearSpacingList` / `pushSpacingEntry`, `brakeStep(list, px, pz, dx, dz,
  stopConeCos)` writing the module scratch `BRAKE_RESULT { x, z, engaged }`), `spacing.ts` (`buildSpacingList(state,
  config, out)`: takes the config, since the margin is a tunable), all three exported from the combat barrel. Not wired
  anywhere yet. Deviations from Design 2:
  - **The cut lands on the keep circle.** Outside keep and outside the cone, the inward part is cut to
    `d - sqrt(keep^2 - |t|^2)` (the end exactly on the circle with the tangential part kept), not to `d - keep`, which
    would leave the end at `sqrt(keep^2 + |t|^2)` and make a slide spiral outward a little every tick. In the cone
    (`t` = 0) both are `d - keep`, written as such so a stopped Knight stays put to the ulp.
  - **An exact overlap passes.** At `d` = 0 there is no inward direction (every step moves away from the centre), so
    `S . (P - e)` = 0 skips the entry and the step is untouched; the plan's "the step's own reverse as n" would make
    the whole step inward and freeze the body until the enemy moves.
  - **The check pass** also re-cuts when the chained per-entry cuts point the result against the step (each cut turns
    it by less than 90 degrees, two can turn it past), and its tolerance is 1e-9 tiles (a cut onto the circle may end
    an ulp inside it). Violators' inward parts are removed from the original step in entry order; the re-cut is
    validated again and is zero if it still breaks the contract.
  - "Inside keep" is the step's END only (the contact test reads end-of-tick positions): a 0.1 step can clip the edge
    of a keep circle between two ticks by at most about 0.002 tiles, never at either end.
  - The stop cone is tested against the step so far, `a >= stopConeCos x |R|` (`a` its inward part). A key held at an
    enemy from far off can reach it at a wider bearing than it started with (the bearing grows as the ray passes the
    centre) and then slides; a player who keeps the nearest key toward the enemy (the SP0 greedy fighter) is always
    within 22.5 degrees and stops (spec: the nearest-key chase from every bearing).
- [x] **SP2. The walk** (Design 3). The `spacing` hook on `WeaponDef` and the sword, `weaponSpacingActive`, stepPlayer's
  trailing `spacing` argument (undefined = today), the list built at the start of `step` and `stepParty`. Specs:
  - holding FIRE and walking at a bruiser stops at keep; the same walk without FIRE and no combo walks into it as
    today;
  - the combo window holds the brake after FIRE is released, and it ends with the window;
  - a roll is never braked; the guard alone is not braked;
  - the Archer walks into a swarmer exactly as before;
  - co-op: each player is braked against the same list, in index order.
  → Verify: `npm run test:only -- sim/player sim/oneWeapon sim/party`.

  **As built (SP2).** `WeaponDef.spacing?(slot, buttons): boolean` (combat/weapons/types.ts, a method, called with `:`)
  read through `weaponSpacingActive(weapons, buttons)` (weapons.ts, beside `weaponMoveMultiplier`; false without the
  hook or with an empty set in hand); the sword's hook is Design 3's four terms exactly (the guard resets the combo, so
  the guard alone reads false). `SimConfig.spacing?: SpacingConfig` is read from the RUN config, like `traits` (step() /
  stepParty, never a floor's world): `combat/spacing.ts` `tickSpacing(state, config.spacing)` rebuilds the sim's own
  list (module scratch) once per tick after the event clears, the forfeit and the frozen-draft return, before the first
  stepPlayer, and returns a `SpacingTick { list, config }` (type in the leaf `spacingBrake.ts`), or undefined without
  the field (no list built). stepPlayer's new trailing `spacing?: SpacingTick` brakes the walk step (after the flask,
  weapon and Quickstep scaling, before movePlayer) when `spacing.config.walk` and the hook says on; the roll path never
  reads it; facing unchanged. Specs: `sim/spacing.wiring.spec.ts` (hand-built open arenas, the enemy put back in place
  after every tick, the players unhurtable): bruiser stop at keep with no drift, no-FIRE walk bit for bit, the combo
  window (14 + 30 braked ticks, then in), roll and guard bit for bit, the Archer bit for bit, co-op both at keep.
- [x] **SP3. The lunge and the wiring** (Design 4, 6). The wind-up's lunge through `brakeStep`; `SimConfig.spacing`,
  `swordSpacing()`, `setSwordSpacing` / `SwordSpacing` in shared/run, set in the builders WS4 used. The 11 parity files
  set `SwordSpacing.WEB`. Specs:
  - a finisher at a swarmer 1.2 tiles away ends at keep and the finisher still kills it;
  - a finisher with nothing in front lunges the full 0.6 as today;
  - under `SwordSpacing.WEB` M1, endless and the tutorial step exactly as before (positions equal on a recorded walk);
  - the default config carries `SWORD_SPACING` in every world SPD6 names.
  → Verify: `npm run verify`; every golden / validate / segments / constants / boss TTK spec bit for bit under the
  switch; re-record the pins that record a Knight's path near contact enemies (list them here with old -> new);
  `DAILY.ruleset` 25.

  **As built (SP3).** The wind-up's lunge step goes through `brakeStep` with `ctx.spacing` (a new transient `SimCtx`
  field, `SpacingTick | undefined`: stepCombat's new trailing `spacing` argument sets it right after `bind()`, which
  empties it, so the endless / Goldling / pacts contexts never brake) when `config.lunge`; the wind-up's timing and
  strike are untouched. shared/run `swordSpacing.ts`: `SwordSpacing = { ON: 0, WEB: 1 }`, `setSwordSpacing(kind)`
  (specs only, returns the previous kind), `swordSpacingKind()`, `swordSpacing(kind?)` (SWORD_SPACING or undefined),
  in the barrel. **Deviation:** since `spacing` is a run-config field, it is set once on the run config in
  `buildRunConfig` (M1 `game` / `dungeonNoEncounter`, scored or not, co-op through `withParty`; not the `greybox`
  world: DEFAULT_SIM_CONFIG, no encounter, nothing to brake against), `buildEndlessRunConfig` (endless, the Daily,
  dev, co-op, the server's registry and validator) and `buildTutorialRunConfig`, read when the config is built; no
  floor's world (`endlessFloorWorld`) carries it, so there is no per-floor capture to thread. The 11 parity files
  (`sim/bossAct1.ttk`, `sim/recordingCodec`, `sim/runBoss`, `sim/runFull`, `sim/runBullets`, `sim/constants`,
  `sim/score/score.replay`, `play/liveRun.forfeit`, `view/roomEdgeState`, `run/segments`, `run/validate`) set
  `SwordSpacing.WEB` next to `PlayerMover.WEB` and restore it; all match bit for bit. `DAILY.ruleset` 24 -> 25. Specs:
  `sim/spacing.wiring.spec.ts`'s lunge rows (a finisher at a swarmer 1.2 ahead ends at keep and kills it; nothing in
  front: the full 0.6, bit for bit; `lunge: false` lunges through), `run/swordSpacing.spec.ts` (every registered world
  plus scored M1, co-op, the Archer, dev and the tutorial carry SWORD_SPACING, none under WEB; the golden run-full
  recording, the recorded endless run and the tutorial bot's run replay under the WEB build exactly as under the
  default build with the field stripped). Re-recorded pins: only `tutorial/tutorial.spec.ts` (SP8); every other spec
  passed unchanged (the sim pins record no Knight attacking into a contact enemy). `lockstep/predictMotion.spec.ts`
  still passes: its walks never braked (no brake row in its coverage yet; SP5 adds one).
- [ ] **SP4. Census** (SP0's spec, now with the brake on and off). Gates:
  - greedy fighter: player-driven contact hits down by at least 80 % (target: zero not caused by a wall slide);
  - tidy fighter: no change in contact hits (it never walked in);
  - room clear time for both within 5 % of today (the brake must not make the Knight slower to kill);
  - the boss TTK rows (`bossAct1.ttk`, `demonlord.ttk`, the builds sword rows) inside their bands.
  → Verify: the before / after table in this doc.
- [ ] **SP5. Prediction** (Design 5). Mirror the walk's and the lunge's brake in `predictMotion.ts`, the predictor's
  own list per pass; extend `predictMotion.spec.ts`: one-tick parity exact on endless floors with enemies (Knight,
  "both"), a coverage kind `brake`, and horizons excused only when the brake engaged while an entry moved (the excused
  share stays under `MAX_EXCUSED_SHARE`). → Verify: `npm run test:only -- lockstep/predictMotion`.
- [ ] **SP6. `KV_CollisionDebug` keep circles** (presentation only, off by default, Janitor). Add each spacing entry's
  keep circle near the watched player, lit while the brake is on and the knight is touching one. → Verify: Studio.
- [ ] **SP7. Studio / playtest.** Keyboard and mouse first (the owner's case: a key held at the enemy while clicking,
  the pointer on and past the enemy for the finisher); then gamepad with and without the right stick and touch
  (auto-target on and off), to check nothing feels worse there. Places: a swarmer pack, a slime that splits, a reaper,
  a bruiser's wind-up, both bosses, co-op on a simulated 4G link (the predicted Knight's stop). Watch for: the Knight
  drifting round an enemy when the player wanted to stop (the stop cone), a stall between two enemies, a finisher that
  feels short. → Verify: the owner signs off SPD1-SPD8, the margin and the cone.
- [x] **SP8. Tutorial.** The scripted bot still finishes every lesson (the guard and sweep locks, combat D's bruiser,
  the practice boss); `tutorial.spec`'s lesson-time pins re-recorded if they move. → Verify:
  `npm run test:only -- tutorial`.

  **As built (SP8).** Every lesson still completes (`tutorial/`, `run/tutorial`, `sim/tutorial` pass). Moved pins, all
  in `tutorial/tutorial.spec.ts`, each passing unchanged under `SwordSpacing.WEB` (checked by building with WEB as the
  default): in order and out of order, `ember` 9.2 -> 9.1 s, `boss` hits 14 -> 5 (15.6 s unchanged: the bot no longer
  walks into Mother Mayhem while swinging), `finish` 0 -> 0.1 s (the stairwell opens where she stood, a keep distance
  from the braked bot); guard late, `guard` hits 37 -> 36 (31.7 s unchanged).
- [ ] **SP9. Docs.** A CLAUDE.md decision-log row (port retune) and a document table row; `PROVENANCE.md` unchanged (no
  ported module). → Verify: `npm run verify`.

## Risks

- **Enemy-driven contact stays.** Swarmers and bruisers walk inside contact by design, and knockback is out for now
  (SPD4); SP0 records how much of the complaint that is, for a later plan.
- **Orbiting.** Outside the stop cone the Knight slides round the keep circle; inside it he stops. SP7 checks the
  edge of the cone reads as a choice the player made, not a shove.
- **Co-op prediction.** The predicted Knight brakes against stale enemy positions; worst case a visible correction of
  one enemy step. The `{pred}` debug line shows it in SP7.
- **Cost.** One list per tick (at most the actor pool) and one pass per player walk and lunge tick: negligible next to
  stepActors.
