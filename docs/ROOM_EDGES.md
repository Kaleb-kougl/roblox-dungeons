# Room edges: plan

Status (2026-10-26): **RE1-RE6 code-complete, verified headlessly only** (typecheck, lint, asset check, art tests,
build, and the full Lune suite: 143 spec files, 2031 tests, run in chunks). **Nothing has run in Studio**: the Studio
check below, RE7 and RE8 are pending. Planned against `main` @ `1bb9e99` plus the uncommitted working tree
(boosts, Demon / Mayhem art). Draws a dashed line on the floor wherever a corridor meets a room, so a player can see
exactly where a room starts and ends, and tints it by the room's state (safe / waiting / live). Presentation only: no
sim, dungeon layout, hash, replay or fixture change. Every floor: M1, endless and the tutorial (owner, 2026-10-26).
Owner answers to the first draft's open questions (2026-10-26): reveal enemy rooms before entry (RD7), an Options
switch (RD8, task RE6), two lines for one-tile corridors (RD9).

## Why

Rooms and corridors are the same floor slab, and on most floors the only hint that a corridor has become a room is the
walls stepping back. That edge matters more than it looks:

- **Endless and tutorial floors trigger on it.** `roomIdAt(d, x, z)` (shared/dungeon/endless.ts) is the tile under the
  player's centre, so the moment the centre crosses from a corridor cell into a room cell, `enterRoom` spawns the
  room's deferred enemies and scoring engages it (`attachScoreRoomMembers`); the tutorial director's "entered the
  lesson room" uses the same test. Today that line is invisible.
- **Rooms crowd each other.** In the M1 fixtures, rooms sit one corridor tile apart (seed 1337: rooms k / b at x = 33,
  d / g along x = 30 for six rows; 22 corridor cells touch two rooms), and ellipse / octagon rooms meet their corridors
  in a staircase, so where one room ends and the next begins is hard to read at speed.

Measured on the three M1 fixtures (seeds 1337 / 42 / 7): 98 / 84 / 95 corridor-to-room cell edges, merged into
45 / 49 / 61 straight runs (most runs are 1 tile, the steps of ellipse and octagon mouths; the longest is 9, a corridor
flanking a room), about 220 / 185 / 210 dashes at the starting dash size below. No room cell touches another room's
cell there. Endless rooms are twice as large (`roomScale` 2), so expect 2-3x the dashes per floor (RE1 measures it).

As built (RE1 census, `roomEdges.spec.ts`): endless run seeds 1-60 x floors 1-20 (1200 floors, 240 boss floors), worst
floor 428 dashes (run 57 floor 17; budget 1200), at most 103 runs and 191 unit edges; tutorial floor 1 / 2: 132 / 14
dashes. **Room-to-room contacts do happen on endless floors** (98 of 1200 floors, 1886 unit edges; none on M1 or the
tutorial): there each room keeps its own line on its outside (RD9), so the two rooms' dashes lie side by side on the
shared edge, each 1/32 tile inside the other room. Judge it in RE8.

## Player experience

- A thin dashed line lies flat on the floor across every corridor mouth, its inner edge exactly on the room's edge, on
  the corridor side. A corridor that runs along a room's open flank gets a line along the whole open stretch; a
  one-tile corridor between two rooms gets two lines, one for each room (RD9).
- Ellipse and octagon rooms show their real edge: a stepped (staircase) dashed line. It is the exact tile edge the
  game uses, not a straightened approximation (decision RD1).
- The line takes the room's state:

  | Room state | When | Look (placeholder) |
  |---|---|---|
  | **waiting** | the room has enemies that are not engaged yet (endless: not entered yet, enemies still deferred) | `roomEdge.waiting`, warm grey, transparency 0.15 |
  | **live** | the room's fight is on: engaged and not cleared; a boss room once the boss wakes (phase > 0) | `roomEdge.live`, near-white, slow pulse (0 -> 0.3 transparency, 1 s) scaled by the juice `motionScale` |
  | **safe** | no enemies (entrance, treasure, shrine; the stairwell room of a non-boss endless floor) or cleared; a boss room after the kill | `roomEdge.safe`, dim, transparency 0.55 |

- State changes fade over `stateFadeSeconds` (0.35 s), so a clear reads as the door "cooling down", and crossing into an
  endless room flips its line to live on the same tick the enemies appear.
- Drawn under everything that matters in a fight: floor < room edges < tutorial arrow < telegraph / weapon markings <
  bullets. Non-Neon material, so it never glows like a telegraph or a sword arc.
- **Options > Display > Room edges** (On / Off, default On) hides them all (RD8).
- The boss arena seal (TelegraphController's tall translucent fence on the boss room's bounding box) is unchanged; the
  boss room's own edges turn live with it.

## Design

### 1. Geometry (`shared/view/roomEdges.ts`, new; pure)

```ts
/** One straight run of a room's edge, world units, on the cell boundary; (nx, nz) is the unit normal out of the room. */
export interface RoomEdgeRun {
	readonly room: number;
	readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number;
	readonly nx: number; readonly nz: number;
}
export interface RoomEdges {
	readonly runs: ReadonlyArray<RoomEdgeRun>;
	/** Run indices per room id (rooms without a corridor-facing edge: empty). */
	readonly byRoom: ReadonlyArray<ReadonlyArray<number>>;
	readonly unitEdges: number;
}
export function roomEdges(d: Dungeon): RoomEdges;
/** The drawn line: the run moved `insetTiles` along its normal (into the corridor). */
export function roomEdgeLine(run: RoomEdgeRun, insetTiles: number, out: number[]): void; // x0, z0, x1, z1
```

- **Rule.** For every FLOOR cell with `roomId = r >= 0` and each 4-neighbour that is FLOOR with `roomId !== r` (a
  corridor cell, -1, or in principle another room), one unit edge on the shared cell side (cell `(gx, gy)` covers
  `[gx - 0.5, gx + 0.5]`, collision.ts). Non-FLOOR cells (walls, solid pillars, pits, pools) never make edges.
- **Merge.** Unit edges with the same room, axis and line coordinate that touch end to end become one run, so dashes are
  spaced evenly along a long mouth (`dashLayout` centres its dashes per segment). Fixed order: room id, axis, line
  coordinate, start; no per-frame work.
- **Why grid + roomId, not `doorway`.** `doorway` marks corridor cells touching a room, but the edge the game tests is
  between a room FLOOR cell and a non-room FLOOR cell; reading the grid directly is exact and also covers a
  room-to-room contact if a future layout makes one (each room then gets its own line on its outside).
- `shared/view` is not determinism-restricted, but this is plain integer scanning anyway; it takes the `Dungeon` from
  `RunContext` and nothing else.

### 2. Room state (`shared/view/roomEdgeState.ts`, new; pure)

```ts
export const RoomEdgeState = { SAFE: 0, WAITING: 1, LIVE: 2 } as const;
export class RoomEdgeStates {
	/** Fallback records for unscored runs (M1 without KV_Scoring): buildScoreRooms at the run's tick 0. */
	constructor(roomCount: number, fallback?: ReadonlyArray<RoomScore>);
	/** Fills one state per room id (reused array, no per-frame allocation). */
	update(state: Readonly<SimState>, encounter: Readonly<EncounterConfig>): ReadonlyArray<number>;
}
```

The source of truth is scoring's own room records, so the line agrees with when the game thinks a room started and
was cleared:

- **Scored runs** (endless, tutorial: `ENDLESS_SCORING`; M1 under `KV_Scoring`): `state.score.rooms`, one record per
  room with enemies, keyed by `record.room`. No record -> SAFE; `cleared === 1` -> SAFE; `engageTick >= 0` -> LIVE;
  else WAITING. Endless floors rebuild the records on a floor change (`rebuildScoreRooms`); the view rebuilds with them.
- **Unscored runs** (plain M1): the same records, built view-side once with the already exported
  `buildScoreRooms(state, encounter)` at tick 0, judged each frame with score's own predicates, exported for this
  (`scoreRoomEngaged`, `scoreRoomDown`: today's private `roomEngaged` / `roomDown`, unchanged). Engagement latches
  view-side like `engageTick` does. A KV_Scoring run of the same inputs must give the same per-room transitions (RE2).
- **Boss room** (`encounter.bossRoom`, bosses are not record members): a living actor with `data.boss === true` ->
  WAITING while `phase <= 0` (dormant), LIVE after; no living boss once one was seen -> SAFE.
- Known gap, M1 only: score engages a room when the player is inside its **bounding box** (`EncounterRoom.minX..`),
  which on ellipse rooms includes a few corridor cells at the corners, so an M1 room can turn live a step before its
  line. Endless and the tutorial engage on the tile itself (`enterRoom`), exactly at the line.

### 3. Tunables and theme

`ROOM_EDGE_VIEW` (`shared/view/roomEdgesConfig.ts`, like `spectateConfig.ts`), all starting values for RE8:

| Name | Value | Meaning |
|---|---|---|
| `dash` | width 0.25, height 0.025, length 1.0, gap 0.7 (studs) | longer gaps than the telegraph and weapon dashes, so the rhythm differs too |
| `liftStuds` | 0.03 | dash bottom above the floor (0.03-0.055; the tutorial arrow is 0.06-0.10, markings start at 0.16) |
| `material` | `SmoothPlastic` | Neon stays the telegraph / weapon language |
| `transparency` | waiting 0.15, live 0, safe 0.55 | |
| `livePulse` | 0.3 over 1.0 s | x `motionScale` (still under reduced motion) |
| `stateFadeSeconds` | 0.35 | colour and transparency lerp on every state change |
| `maxDashes` | 1200 | per floor budget, asserted by RE1 |

The inset is derived, not tuned: `dash.width / 2 / STUDS_PER_TILE`, so the dash's inner edge is the room edge.

Theme (contract + both packs): three required colour roles `roomEdge.waiting`, `roomEdge.live`, `roomEdge.safe`
(`ROOM_EDGE_ROLES`). Validator `roomEdgeReport`, like `enemyOutlineReport`:

- waiting and live >= `MIN_ROOM_EDGE_CONTRAST` 3.0:1 on every biome **floor** (they lie on floors, never walls); safe
  is meant to recede and has no contrast floor;
- all three >= `MIN_ROOM_EDGE_DIFFERENCE` 40 CIE76 from `ENEMY_BULLET_ROLES` and from `telegraph`, the other dashed
  floor lines that mean danger.

Placeholder values against the placeholder biome floors (RE4's spec makes them binding):

| Role | Colour | Min contrast on floors | Closest CIE76 (of enemy bullets, telegraph) |
|---|---|---|---|
| `roomEdge.waiting` | `#a39e94` | 5.49:1 | 62.8 (`enemyBulletOutline`) |
| `roomEdge.live` | `#f4f1ea` | 12.98:1 | 72.3 (`telegraph`) |
| `roomEdge.safe` | `#6a655c` | 2.53:1 (exempt) | 41.1 (`enemyBulletOutline`) |

(As built, measured by the validator, `roomEdge.spec.ts`; the first draft's hand-checked contrasts were low. The vale
pack inherits the placeholder's colours.)

A value ramp (dim -> grey -> white) instead of hues: red "live" fails outright (`#ff6a6a`: CIE76 35 from `telegraph`,
28 from `enemyOutline`), and cyan / violet / green collide with `decor.fx.zone`, `fx.curse` and `fx.heal`. Packs may
tint it, inside the validator.

### 4. Client (`src/client/controllers/render/RoomEdgeController.ts`, new)

- `sim.onRunStarted` / `sim.onFloorChanged`: Janitor cleanup, then (dungeon floors only; the greybox has no rooms)
  `roomEdges(ctx.dungeon)`, one `DashLayer` per room with runs (folder `KV_RoomEdges`), filled once
  (`begin` / `seg(roomEdgeLine(...))` / `finish`: one BulkMoveTo, then static), and a `RoomEdgeStates` (with fallback
  records when `ctx.config.scoring` is undefined; warn once if the state is not at tick 0 there).
- `DashLayer` gains an optional `liftStuds` in `DashStyle` (absent: today's `MARKING_VIEW.liftTiles` height, so every
  existing layer is unchanged).
- Render step `KV_RoomEdges` at Camera + `RENDER_ORDER.viewsAfterCamera`: `states.update(sim.getState(), encounter)`;
  per room, a fade from its last look to its state's look; `setColor` / `setTransparency` only while a room fades or
  pulses (a quiet floor writes nothing).
- Options switch (RE6): subscribes to the Reflex `selectDisplay`; Off parents the `KV_RoomEdges` folder to nil and
  skips the render step's work, On puts it back (no rebuild).
- No input, remote, DataStore schema or theme image. Co-op and spectating need nothing: the state is shared sim state.

## Tasks

- [x] **RE1. Geometry.** `shared/view/roomEdges.ts` + spec on hand-made dungeons: a rect room and a straight 3-wide
  corridor (one 3-tile run at the exact coordinate, normal into the corridor); an ellipse mouth (stepped runs); a
  corridor along a room's flank (one long run); a one-tile corridor between two rooms (two runs, opposite normals);
  a room-to-room contact (one run per room); a pit and a solid pillar next to a corridor (none). On real floors (the
  three M1 fixtures, endless run seeds 1-60 x floors 1-20, both tutorial floors): **trigger parity** (a point 0.01 inside
  each run's room side has `roomIdAt === run.room`, 0.01 outside does not), **completeness** (every room-FLOOR /
  other-FLOOR neighbour pair is covered by exactly one run unit), and the dash count per floor <= `maxDashes` (print
  the max). -> Verify: `npm run verify`.
  As built: 17 tests (`roomEdges.spec.ts`, `roomEdgesConfig.spec.ts`), all 1200 endless floors, about 90 s.
- [x] **RE2. State.** Export `scoreRoomEngaged` / `scoreRoomDown` from `shared/sim/score` (renamed, unchanged: every
  fixture, golden run and hash spec still matches). `shared/view/roomEdgeState.ts` + spec: endless (endless bot) rooms
  are WAITING before entry, LIVE from the `roomEntered` tick, SAFE from the clear tick; rooms without spawns SAFE
  throughout; boss WAITING dormant / LIVE from phase 1 / SAFE after the kill; tutorial floor 1 lesson rooms go
  WAITING -> LIVE -> SAFE in walk order under the tutorial bot; **fallback parity**: an unscored M1 run and a
  KV_Scoring run of the same recorded inputs give the same transition ticks per room.
  As built: `RoomEdgeStates.update` returns `ReadonlyArray<RoomEdgeState>`; the boss latch resets per endless floor;
  the spec has its own small melee bot (the endless bot never fights). Fallback parity on run-full-1337
  (WEB_SWORD_TIMINGS): identical transitions scored and unscored; tutorial floor 1 lessons go live / safe in walk
  order.
- [x] **RE3. Tunables.** `ROOM_EDGE_VIEW` + a `roomEdgeLook(state, fadeFrom, t, motion)` helper (colour role mix,
  transparency, pulse) with a spec (motion 0 = no pulse, fade clamps, live pulse range).
  As built: `roomEdgeLook` takes an optional reused `out`; `ROOM_EDGE_VIEW.transparency` / `roles` are tuples by state.
- [x] **RE4. Theme.** `ROOM_EDGE_ROLES` in the contract, the three roles in the placeholder and vale manifests,
  `roomEdgeReport` in the validator + spec (the placeholder and vale pass; a red live role fails on `telegraph`).
  As built: also `ROOM_EDGE_CONTRAST_ROLES` / `ROOM_EDGE_DIFFERENCE_ROLES`; vale needed no change;
  `view/hud/hud.spec.ts`'s Options-string count went 26 -> 27.
- [x] **RE5. Client.** `DashLayer` `liftStuds`, `RoomEdgeController`. Docs: a row in docs/CLIENT.md's controller table,
  a CLAUDE.md decision-log line (theme roles; `scoreRoomEngaged` / `scoreRoomDown` exported, no behaviour change),
  this doc's status. No PROVENANCE row (port-only, no web source). -> Verify: `npm run verify`, then the Studio check.
  As built: typecheck, lint and build pass; the Studio check is pending.
- [x] **RE6. Options switch.** `DisplaySettings.roomEdges: boolean` (default true; stored overrides-only like
  `hudScale`, so only Off is saved; `sanitizeDisplayOverrides` keeps a boolean `false`, drops anything else) +
  settings spec cases (default, round trip, junk ignored, an old doc without it reads On). `OPTIONS_STRINGS.roomEdges`
  = `options.display.roomEdges` ("Room edges") in both packs' strings; a `SettingRow` On / Off in the Display tab under
  HUD scale; `RoomEdgeController` follows it. The settings document stays v2 (a new optional display field, no
  migration). -> Verify: `npm run verify`; in Studio, Off hides every line at once, survives a rejoin, On restores.
  As built: `DEFAULT_ROOM_EDGES` in `shared/settings/config.ts`; the row reuses the Juice tab's On / Off strings;
  Studio check pending.
- [ ] **RE7. Part budget in Studio.** `[RoomEdges] built N dashes` print per floor; check the worst endless floor
  from RE1 and the frame time with `KV_Debug` stats.
- [ ] **RE8. Playtest.** Tune dash size, lift and the three looks on all five biomes in both packs (vale floor
  textures), a 16:9 monitor and the phone emulator; judge the staircase look on ellipse / octagon mouths; check live
  near-white never reads as the sword blade (`damageNumber` dashes) when fighting in a doorway; check the lines don't
  fight breakables, boost drops or decor at doorways.

Critical path: RE1 -> RE5 -> RE6. RE2, RE3 and RE4 can go alongside RE1.

## Studio check (RE5)

1. M1 (default world), F5: every corridor mouth shows a dashed line flush with the room edge on the corridor side;
   ellipse rooms show stepped lines; the entrance is dim (safe). Walk into the first combat room: its lines fade to
   live as the fight engages and back to safe on the last kill.
2. Endless floor: unentered enemy rooms are grey (waiting); the step that crosses the line spawns the room and turns
   it live on the same frame. Treasure / shrine rooms are dim throughout. Boss floor: grey until Mother Mayhem (or
   the Demon Lord) wakes, live with the arena seal, dim after the kill. Next floor: the lines rebuild.
3. Tutorial: lesson rooms light in order; the tutorial arrow draws over the lines; telegraphs, aim lines, weapon arcs
   and bullets draw over both.
4. Reduced motion: no live pulse, fades unchanged. Co-op (two clients): both show the same states; a spectating dead
   player sees the same.
5. Options > Display > Room edges Off: every line disappears at once mid-run and stays off after a rejoin; On brings
   them back with their current states.
6. No z-fighting with floor textures at the default camera; no Output warnings.

## Decisions

- **RD1. Exact cell edges, staircases included.** The line is the tile edge `roomIdAt` tests, so in endless and the
  tutorial it is literally where the room starts. A straightened line across each corridor mouth would look tidier on
  ellipse / octagon rooms but would sit up to a few tiles off the real trigger there. Revisit only if RE8 finds the
  stairs ugly (then: straighten in the view, keep the trigger).
- **RD2. State-tinted** (owner, 2026-10-26): safe / waiting / live, from scoring's room records.
- **RD3. Every floor** (owner, 2026-10-26), M1 included; presentation only, so web parity is untouched.
- **RD4. On the corridor side**, inner edge on the boundary: the room's floor stays clean and the line reads as a
  threshold you are about to cross.
- **RD5. Value ramp, non-Neon, three new required roles**, validated against the enemy-bullet roles and `telegraph`.
- **RD6. One state rule for all runs**: score's own records and predicates, view-built for unscored M1, so the line
  never disagrees with room clears, perfect / fast bonuses or the endless spawn.
- **RD7. Enemy rooms show before entry** (owner, 2026-10-26): an unentered endless room with planned spawns is grey
  (waiting), an empty one dim (safe). It tells the player which rooms hold enemies, not which or how many.
- **RD8. Options switch** (owner, 2026-10-26): Options > Display > Room edges, On by default (RE6).
- **RD9. Two lines for a one-tile corridor between rooms** (owner, 2026-10-26): each room keeps its own line on its
  outside, one tile apart, each tinted by its own room; no shared middle line.
