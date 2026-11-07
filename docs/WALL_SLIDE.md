# Wall slide

The player gets stuck on pillars, wall corners, door frames and the stepped walls of round rooms. This plan replaces
the player's mover with one that **slides around corners** instead of stopping on them, adds two small assists, and
measures the result with a census. Work it task by task, like `docs/ART.md`; each task ends with a **Verify**.

**Gameplay (sim).** The player's body moves differently in every world, M1 included (WSD1, owner 2026-11-06), so live
replays and scores change. Every golden fixture and the web-tuned specs still match bit for bit: they replay under
`setPlayerMover(PlayerMover.WEB)`, next to `setSwordTimings(WEB_SWORD_TIMINGS)` / `setSwarmerHp` / `setBossHp`.
Bullets, sight, enemies, the dungeon, the hash layout and the lockstep wire are untouched.

## Status (2026-11-06)

Plan only. Nothing built. The numbers below come from a Python port of `moveCircle`, plus a prototype of the new mover
(not kept in the repo). WS0 re-measures them in Lune before any code changes.

**Owner (2026-11-06): it is mostly pillars.** So pillars come first:

- a full pillar slip (Design 3, WSD3);
- a pillar milestone (WS0-WS2 + WS4, then a pillar playtest) before the stepped-wall smoothing;
- the census's pillar class is the gate.

## Why the player sticks (findings)

| Fact | Where | Consequence |
|---|---|---|
| The player moves with `circleMover` = `moveCircle`: X is swept first, then Z, each axis on its own. "Convex wall corners stop the axis that hits them (no tangential deflection)." | `shared/dungeon/collision.ts`, `run/endless.ts`, `run/config.ts` | A corner contact stops the blocked axis completely, so nothing deflects the player around the corner. |
| Endless enemies already round pillars with `moveCircleAroundCorners` (D2). The player never got it. | `actorSteerMover` | The fix is known in this codebase, but only for enemies. |
| Move input is screen-relative and rotated by `CAMERA_YAW_DEG` 45. | `play/inputMapping.ts` `screenToWorld` | One key (W) is a **world diagonal**. A square pillar shows on screen as a diamond, so pressing W at it hits a corner head-on. W+D is a world axis, which hits a face head-on. |
| Rooms are `rect`, `ellipse` or `oct`. | `forge/types.ts` `RoomShape` | Ellipse and oct walls are tile staircases. On screen an oct room's 45-degree wall looks straight, but the player bumps along its teeth. |
| The walk, the roll (direction locked), the sword lunge and the treasure / drop pushes all go through `movePlayer`, which calls `moveResolver` in sub-steps of at most `MAX_MOVE_STEP` 0.1. | `sim/player.ts` | Changing that one mover fixes all of them. Sub-steps of 0.1 are smaller than `PLAYER_RADIUS` 0.35, so the mover cannot tunnel. |
| Solid pillars are always **1x1**: at placement each has 8 FLOOR neighbours, and pillars stand at least 3 tiles apart. On endless floors the cell becomes WALL (an optional low stump on top), so the art fills the cell. | `forge/generate.ts` step 8, `view/decor/decorPlan.ts` step 3 | A pillar is always an **isolated** 1x1 blocker, so it can be told apart from any wall by geometry alone. Its art matches its collision, so the stuck feeling comes from movement, not a mismatch. |
| Pillars, solid decor (tombs, candle stands, bookcases, thrones, statues, tables, chairs) are `WALL` tiles. Breakables and the vault chest are `SolidCells`. | `forge/solidDecor.ts`, `sim/breakables/cells.ts` | The same mover covers every obstacle the player can bump into. |

### Measured (prototype, 60 Hz walk 0.1 per tick)

| Case | Today (`moveCircle`) | Slide | + assists / smoothing |
|---|---|---|---|
| **A.** World-axis walk (W+D, or a stick) at a 1x1 pillar, lateral offset 0.0-0.9 | Stuck at **every offset below 0.85**. Offsets 0.5-0.85 only graze the corner. | Gets past from 0.6 | Face assist 0.35: from 0.5. **Pillar slip: every offset**, at most 9 ticks (0.15 s) slower than open floor (60). |
| **B.** Screen-up key at the pillar's corner, offset -0.9..0.9 | **Stuck forever** in a ±0.2-tile band (5 of 19 offsets) | Always gets past, 4-11 ticks slower than open floor (87). An exact tie takes 191. | The tie-break turns the exact tie into 101. |
| **C.** 1:1 stepped wall (oct / ellipse), share of walk speed kept, pushing in by 0 / 5 / 15 / 25 degrees | 1.00 / 0.91 / 0.72 / 0.52 | 1.00 / 0.96 / 0.78 / 0.57 | Step smoothing: **1.00 / 1.00 / 0.97 / 0.91**, the same as a flat wall |
| **D.** Flat wall, along it, pushing in 0 / 10 / 45 degrees | 1.00 / 0.98 / 0.71 | identical | identical |
| **E.** Screen-up key sliding along a wall into a 1 / 2 / 3-wide doorway, 16 starts | **Stuck on the far door frame in 10 of 16** (each width) | 16 / 16 | 16 / 16 |
| **F.** Pressing into a square room corner | at rest | at rest | at rest (no jitter) |

So the main complaints have three sources:

- door frames and pillar corners (B, E), where today's mover stops dead;
- face grazes (A), where the player stops even though only the corner is touched;
- stepped walls (C), which drag like heavy friction.

## Design

### 1. `slideCircle`: collide and slide (shared/dungeon)

`slideCircle(d, x, z, dx, dz, radius, solid?, opts)` has the same contract as `moveCircle`: it is pure, it uses `sqrt`
only (no trig), it scans in a fixed order, it allocates nothing but the result (module scratch, read before the next
call), and its result is never farther from the start than the step. One call:

1. Target = start + step.
2. Up to `iterations` (4) passes. Among the blocking cells within reach, scanned in order (gy, then gx), find the
   deepest overlap of the circle with a cell's box. The closest point on a box gives the push-out normal, which is
   radial at a corner, so every corner is effectively rounded by the player's own radius. Push the circle out along
   that normal. This projection is the slide. A ties with B when both overlaps are equal: the first one in scan order
   wins.
3. Fallbacks, each to `moveCircle`'s result from the start, which is always valid:
   - an overlap is left after the passes (a concave jam);
   - the result is farther than the step (`STEP_BOUND`).
4. Starting overlap: a cell the circle already overlaps at the start does not block this move. This is the rule
   `moveCircle` already uses, so a spawn inside a cell or a piece that appears under the player never traps anyone.

Where no corner is touched (open floor, a flat wall, a square room corner), the slide rests where `moveCircle` rests.
WS1's specs pin that to within float tolerance.

### 2. Corner tie-break

When the first contact is a box corner, a frictionless slide's sideways part is the move's own component along the
tangent. Straight at the corner that component is near zero, so the player crawls (case B, 191 ticks).

If that share is below `tieShare` (0.05 of the step), add `tiePush` (0.3 of the step) along the tangent, on the side
the move's ray passes the corner. On an exact tie, use a fixed side (world +tangent), which is deterministic.

### 3. Face assist (corner correction)

When the slide keeps less than `assistStallShare` (0.2) of the step, the contact is a face, and the blocked run ahead
ends within `assistTiles` (0.35, half the player's width) to one side, slip toward that end. The slip is the step's
length, or the distance to clear if that is shorter. It applies only when:

- the cell past that end is open;
- the cell before that end, on the player's side, is open.

This is the same idea as `cornerNudge`'s wall-end case, with a forgiveness margin. A long wall's middle, a concave
corner, or a run that does not end within reach gets no slip. `assistTiles` 0 turns the assist off.

**Pillar slip.** A blocking cell whose 8 neighbours are all open is an isolated blocker. Every solid pillar is one,
and so is a lone crate or candle stand. It gets the assist across its **whole** face (`pillarSlip` true, which is the
same as `assistTiles` 0.85 for that cell). The player slips to the side the move's ray passes the cell's centre on,
the rule `cornerNudge`'s pillar case uses for enemies. A ray straight through the centre goes to a fixed side
(deterministic).

In the prototype every head-on hit gets past, at most 9 ticks (0.15 s) slower than open floor. The test is pure grid
geometry (8 cells around the contact, plus `SolidCells` for a crate), so no Forge data and no state is needed.
Wider pieces (2x1 tombs, bookcase runs, walls) keep the 0.35 margin, because slipping 1.35 tiles sideways would feel
like a shove.

### 4. Stepped-wall smoothing (player body only)

A FLOOR cell is a **1:1 staircase notch** when all of these hold:

- two adjacent orthogonal neighbours block;
- the diagonal cell between them blocks;
- the cells past both teeth are open.

The cells past both teeth tell a notch from a room's square inner corner, where the wall carries on. In a notch, the
player's body also collides with the cell's diagonal between the two tooth tips. A stepped wall then slides like a
straight one (case C).

The notches come from the grid tiles only, never from `SolidCells`. They are computed once per dungeon when the mover
is built (a map from `cellKey` to the notch's facing). The grid is static: pillars and solid decor are baked into it.

What changes: the player's centre stays at least `radius` from the diagonal, so it no longer reaches a notch cell's
inner half. Checks this needs:

- a pellet on a notch cell stays collectible (pickup 0.45 > radius 0.35, a margin of 0.10);
- the player's spawns never fall in a notch;
- drops, the chest's front, altars and the stairwell stay reachable.

The census (WS5) measures 2:1 runs (ellipse walls) as well. If they drag too, the rule extends to tip-to-tip segments
over runs of 2 (WSD4).

### 5. Wiring

`playerSlideMover(d, radius, PLAYER_SLIDE)` becomes `SimConfig.moveResolver` in two places:

- `endlessFloorWorld`, which covers endless, daily, dev, co-op and the tutorial (its floors are endless floors);
- `buildRunConfig`'s M1 path (`game` / `dungeon` worlds, scored or not).

Both get the player's mover from one helper, `playerMover(d)` in shared/run. That helper reads a specs-only switch,
`setPlayerMover(kind)`, which returns the previous kind so a spec can restore it. It is read when the config is built,
like the sword's timers, so a spec sets it before calling `buildRunConfig`:

- `PlayerMover.SLIDE` (the default): `playerSlideMover`;
- `PlayerMover.WEB`: the web build's `circleMover`.

Specs that build `circleMover(d, PLAYER_RADIUS)` themselves (19 of them) are untouched. The tunables go in
`PLAYER_SLIDE` in a data module of shared/dungeon (no magic numbers in logic).

Replays:

- endless, daily, dev, co-op, tutorial and live M1 (`KV_Scoring` included) replays and scores change;
- M1 runs recorded by older builds no longer replay, as after the sword / swarmer / boss retunes;
- the 11 spec files that replay fixtures under `setSwordTimings(WEB_SWORD_TIMINGS)` also set
  `setPlayerMover(PlayerMover.WEB)` (validate, segments, runFull, runBoss, runBullets, score.replay, constants,
  recordingCodec, bossAct1.ttk, liveRun.forfeit, roomEdgeState) and still match bit for bit;
- the all-time boards stay `_v1`, as for every earlier sim retune;
- `DAILY.ruleset` goes up by one (10 -> 11);
- the pins that record player paths are re-recorded (`enemies.determinism`, charger / stormcaller run 4, the
  recorded endless run, the tutorial bot's specs).

Unchanged: the server validator (same config builder), the lockstep wire and the hash layout (no new state).

## Decisions (proposed: the owner to confirm)

- **WSD1. Every world, M1 included (owner, 2026-11-06).** Live play everywhere uses the slide. The web build's mover
  survives only as `PlayerMover.WEB` for the parity specs, the same pattern as the sword, swarmer and boss retunes.
  A CLAUDE.md decision-log row records it as a port retune.
- **WSD2. Frictionless, no speed boost.** Pushing into a flat wall still costs cos(angle), as today (case D). The slide
  only removes the stops.
- **WSD3. Pillars slip on any hit; walls get 0.35 tiles** (revised after the owner's answer, "mostly pillars"). An
  isolated 1x1 blocker never stops the player: a head-on hit slips to the side the move's ray passes the centre on.
  Everything wider slips only within 0.35 of its end; a hit near the middle stops. Both values are tuned in the
  playtest (WS8). `pillarSlip` false and `assistTiles` 0 turn them off.
- **WSD4. Smoothing for 1:1 steps first.** 2:1 only if the census shows it drags.
- **WSD5. The player's body only.** Bullets, line of sight, the minimap, `pathField` and enemy movers stay on square
  cells. Enemy walkers could take the slide later (WS10), after their own measurement.
- **WSD6. No input magnetism.** Steering the stick toward a doorway or corridor was rejected: it overrides the
  player's aim and intent. To revisit only if the playtest still shows door misses.

## Open questions for the owner

1. ~~Where do you get stuck most, and on which input?~~ **Answered 2026-11-06: mostly pillars, on every platform.**
   Both kinds of hit matter:
   - keyboard's single keys aim at a pillar's corner (case B);
   - gamepad and touch sticks hit at any angle, faces included (case A).
   The pillar slip covers both, so no platform-specific rule is needed. The census and the specs sweep stick angles
   finely (WS2, WS5).
2. ~~Should M1 get the slide too?~~ **Answered 2026-11-06: yes** (WSD1).
3. ~~A full assist or a partial one?~~ Proposed in WSD3: full for pillars, partial for everything else. To confirm
   in the pillar playtest.

## Order of work

1. **Pillar milestone:** WS0, WS1, WS2, WS4, then WS8's pillar pass. This alone fixes cases A and B, door frames (E)
   and lone crates.
2. **Then:** WS5 (the census, gated on pillars), WS3 (stepped walls), WS6 / WS7, the rest of WS8.
3. **Optional:** WS9 and WS10.

## Tasks

- [ ] **WS0. Measure in Lune.** `shared/dungeon/collision.snag.spec.ts` turns cases A-F into scenario specs. Today's
  mover is printed for the record. → Verify: the printed numbers match the table above (within the prototype's
  differences); `npm test -- dungeon/collision`.
- [ ] **WS1. `slideCircle` core** (Design 1). Specs:
  - never tunnels (steps up to 0.5, every angle, against 1-tile walls);
  - never farther than the step;
  - rests still in a square corner;
  - a diagonal corner-to-corner touch stays closed from every angle;
  - a start overlap escapes;
  - equals `moveCircle` (to within float tolerance) on open floor and along a flat wall;
  - corner contacts deflect (B passes);
  - deterministic: two runs give identical bits.
  → Verify: `npm run test:only -- dungeon/collision`.
- [ ] **WS2. Tie-break, face assist and pillar slip** (Design 2-3), with `PLAYER_SLIDE` tunables. Specs:
  - every 1x1 pillar is passed head-on at every offset, within 10 ticks of open floor. Directions: the 8 keyboard
    directions, and 64 stick directions quantized like real input (`quantizeAxis`, so gamepad and touch values are
    exact);
  - a lone crate (`SolidCells`) slips the same way;
  - a 2x1 tomb and a wall keep the 0.35 margin;
  - case A at 0.35 / 0 for walls;
  - case B's exact tie within 101 ticks;
  - no slip on a long wall's middle, in a concave corner, or on a staircase face;
  - no back-and-forth over 300 ticks of pressing (the property `moveCircleAroundCorners` pins).
  → Verify: the same suite.
- [ ] **WS3. Stepped-wall smoothing** (Design 4). Notches are computed per dungeon. Specs:
  - case C at 1.00 / 1.00 / 0.97 / 0.91;
  - a room's square corner is not a notch;
  - over seeds 1-40 x floors 1-10: every pellet, spawn, chest front, altar, drop landing and stairwell stays reachable
    under the new body.
  → Verify: `npm run test:only -- dungeon`.
- [ ] **WS4. Wire it** (Design 5). `playerMover(d)` with `setPlayerMover` / `PlayerMover`; used by `endlessFloorWorld`
  and `buildRunConfig`'s M1 path. The 11 fixture specs set `PlayerMover.WEB` next to `WEB_SWORD_TIMINGS`. Then:
  - re-record the pins;
  - `DAILY.ruleset` 11;
  - add a CLAUDE.md decision log row and a document table row.
  → Verify:
  - `npm run verify`;
  - every golden / validate / segments / constants / boss TTK spec matches bit for bit under the switch;
  - a spec that M1's default config uses the slide mover (one scenario B walk ends past the pillar);
  - a spec that `PlayerMover.WEB` gives exactly `circleMover`'s positions.
- [ ] **WS5. Snag census** (`run/snagCensus.spec.ts`). Over seeds 1-40 x floors 1-10, start from every FLOOR cell that
  touches an obstacle and walk 40 ticks in each of the 8 keyboard screen directions and 32 stick directions (quantized
  through `quantizeAxis`). Counts are reported per input kind.
  - A **stall** is moving less than 25 % of the open-floor distance.
  - A stall is excused when the circle ends pressing a face within 20 degrees of the input (a real wall).
  - Unexcused stalls are reported by class: pillar, wall corner / door frame, stepped wall, breakable, each solid-decor
    kind, chest, altar.
  - The doc records the counts before and after.
  → Verify: **zero unexcused pillar stalls** (the gate), and zero elsewhere or an owner-accepted class.
- [ ] **WS6. `KV_CollisionDebug`** (client, off by default, Janitor; presentation only). It draws the blocking cells
  near the watched player, the notch edges, the body circle and its contact normal, and flashes red on a stall (move
  held for 0.3 s or more, less than 25 % moved). → Verify: Studio, a pillar and an oct room.
- [ ] **WS7. Tutorial.** Its lock specs and scripted bot still finish every lesson (the guard and sweep locks, room G's
  ring). → Verify: `npm run test:only -- tutorial`.
- [ ] **WS8. Studio / playtest.**
  - Every platform, each signed off on its own: keyboard (W at diamonds, W+D at faces), gamepad, touch (the floating
    stick, with auto-target on and off).
  - Places: oct and ellipse rooms, pillar fields, doorways at speed, library runs and reading areas, storeroom crates,
    the vault chest, a roll into a pillar, co-op.
  - Watch for: no visible push-through, nothing that feels like being shoved sideways, and the player's feet against
    the wall art at notches.
  → Verify: the owner signs off WSD2-WSD4 (and the assist value).
- [ ] **WS9 (optional, presentation). Footprint audit.** List each solid kind's art footprint against its cell(s)
  (`DECOR_BOX`). Thin art on a full 1x1 cell (candle stand, chair, barrel) reads as an invisible wall. Fix the art
  side (a plinth or footprint shadow), not the collision. → Verify: Studio.
- [ ] **WS10 (optional). Walking enemies on the slide.** Measure them against `moveCircleAroundCorners` first. This
  changes enemy paths; a separate sign-off.
