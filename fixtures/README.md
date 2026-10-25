# Golden fixtures (web build -> Roblox port)

Exported from the web game (`project-kaleb-vale`, commit `42897e2`) by `scripts/export-fixtures.ts`. The Luau port
must reproduce every value here bit for bit. Do not edit these files by hand: regenerate them.

```bash
# in project-kaleb-vale
npm run fixtures:export                                   # writes ../kaleb-vale-roblox/fixtures/*.json
KV_FIXTURES_OUT=/some/dir npm run fixtures:export         # somewhere else
```

The npm script runs the TypeScript through Vite's module runner (`vite.runnerImport`, no extra dependency). The
exporter then re-reads every run fixture from disk, deserializes its recording, rebuilds the config from scratch and
replays it (`runReplay` for the final hash, and a per-tick replay against every stored hash); it throws on any
mismatch. Output is deterministic (two runs are byte-identical). Generated with Node 25.2.1 (V8 14.1); the same
recordings also replay to the same hashes under vitest.

`hashed-fields.md` documents every number that goes into `hashState`, in order, plus the bullet library's internals.

## Conventions

- **Numbers**: plain JSON numbers are exact (JS prints the shortest string that parses back to the same double).
  `NaN`, `Infinity`, `-Infinity` and `-0` are the strings `"NaN"`, `"Infinity"`, `"-Infinity"`, `"-0"` (example:
  `combat.boundsLimit` is `"Infinity"` in every dungeon run). Fields named `hex` / `*Hex` are the IEEE-754 float64 bit
  pattern as 16 hex digits, **most significant first** (sign, exponent, mantissa; `1.0` = `3ff0000000000000`). Note:
  `hashNumbers` feeds the same bits to FNV in little-endian byte order.
- **Hashes**: 8 lowercase hex digits from `hashState` / `hashNumbers` (algorithm in `hash.json` and `hashed-fields.md`).
- **Run hashes**: `hashes[t]` = `hashState` after `t` ticks; `hashes[0]` is the fresh `createSimState(seed, spawn.x,
  spawn.z, config)`; `hashes.length = ticks + 1`; `finalHash = hashes[ticks]`.
- **Run events**: `events` is a list of `[t, {field: value}]`: after stepping tick `t` (`state.tick` was `t` before
  the step), the `SimEvents` fields that are not at their default (0, or -1 for `lastHitSource`). Events are not
  hashed; they help you find where a port diverges.
- **Recordings**: `recording` is the exact string from `serializeRecording`: `{"v":1,"seed","spawn":[x,z],"n":frames,
  "f":[count, moveX, moveZ, aimX, aimZ, buttons, count, ...]}` (run-length encoded). Replay = `deserializeRecording`,
  `createSimState(seed, spawn.x, spawn.z, config)`, then `step(state, frames[t], config)` for every frame, with the SAME
  config object for creation and every step.

## Files

| File | Size | What |
| --- | --- | --- |
| `rng.json` | 196 KB | sim mulberry32, Dungeon Forge rng, seed normalization, small integer hashes |
| `hash.json` | 7 KB | `hashNumbers` test vectors |
| `input.json` | 47 KB | axis / button quantization, `isValidInput`, recording (de)serialization |
| `dungeon-1337.json` | 290 KB | full Dungeon Forge output + encounter + collision query vectors |
| `dungeon-42.json`, `dungeon-7.json` | 72 / 78 KB | full Dungeon Forge output + encounter |
| `run-player.json` | 94 KB | player-only run (greybox), 996 ticks |
| `run-player-dungeon-1337.json` | 65 KB | player-only run on the seed-1337 floor (wall collision), 600 ticks |
| `run-bullets.json` | 345 KB | stress emitter + bow + sword bullet deletion (greybox), 499 ticks |
| `run-full-1337.json` (+ `.dumps.json`) | 300 + 204 KB | the real M1 game config, 3600 ticks |
| `run-boss-1337.json` (+ `.dumps.json`) | 185 + 238 KB | the boss fight from the boss door (`?spawn=boss`), 1800 ticks |
| `constants.json` | 32 KB | every sim constant / data table with float64 bits, registry index tables |
| `arc-table.json` | 10 KB | every bullet burst shape: gen.arc angles and V8's sin / cos of each |
| `math-trace.json` | 66 KB | every transcendental `Math.*` call the generator and the runs made, with V8 results |

### `rng.json`

- `sim[]` per seed in `[1337, 42, 7, 0, 4294967295]`: `initialState = seedToState(seed)`; `next` = the first 1000
  `rngNext` results (floats in [0, 1), each exactly `u32 / 2^32`); `u32` = the same as integers;
  `statesAfterFirst20[i]` = `rngState` after the (i+1)-th call; `int[]` = 100 calls of `new Rng(seed).int(min, max)`
  cycling through the listed `(min, max)` pairs (includes reversed and fractional bounds), with `stateAfter`.
- `seedToState[]`: `{ seed, seedHex, state }` for edge inputs (negative, fractional, > 2^32, NaN, Infinity, -0).
  `seedToState(s) = (isFinite(s) ? trunc(s) : 0) >>> 0` (JS ToUint32: modulo 2^32 of the truncated value).
- `forge[]` per seed: `identicalToSim: true` (Dungeon Forge's `mulberry32` is the same arithmetic: its first 1000
  values equal `sim[].next`), and `makeRngCalls`: 60 calls on one `makeRng(seed)` in the listed order: `f(a, b) = a +
  r() * (b - a)`, `i(a, b) = a + floor(r() * (b - a + 1))` (no ceil/floor of the bounds, unlike the sim's `rngInt`),
  `pick(arr)` (stored as the index), `chance(p) = r() < p` (always one draw), `raw()`.
- `resolveAutoTheme`: `THEME_KEYS[(imul(seed ^ 0x9e37, 2654435761) >>> 0) % 5]`.
- `encounterRoomSeed`: the per-room `Rng` seed of `placeEncounter`: `((seed >>> 0) ^ imul(roomId + 1, 0x9e3779b1)) >>> 0`.
- `forgeRerollChain`: `seed = (imul(seed, 9301) + 49297) >>> 0` (only used when an attempt is invalid; never so far).

The r3f-projectiles `createSeededRandom` (also mulberry32) is not used by the sim. Algorithm, for the port
(`src/sim/rng.ts`): `s = (state + 0x6d2b79f5) | 0; state = s >>> 0; t = imul(s ^ (s >>> 15), s | 1);
t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2^32`. In Luau keep every intermediate as a
uint32 in [0, 2^32): `t + imul(...)` is a double add of two 32-bit values (exact, < 2^33): reduce it mod 2^32 before
the XOR. `imul` must split into 16-bit halves (a 32x32 product does not fit a double's 53 bits).

### `hash.json`

`vectors[]`: `{ name, values, hex, hash }` with `hash = hashNumbers(values)`: empty list, 0, -0, NaN (V8 canonical
`7ff8000000000000`), +/-Infinity, max / min / subnormal doubles, 2^53, inexact decimals, random doubles.
`freshState`: `writeHashFields(createSimState(1337, 0, 0))` (empty config: no actors, default loadout) as values / hex
and its hash. The sim never hashes NaN; if a Luau NaN ever reaches the hash its sign bit may differ (x86 makes
`0/0` = `fff8000000000000`).

### `input.json`

- `quantizeAxis[]`: `{ v, vHex, product (v * 1000), productHex, q }`. `quantizeAxis(v) = NaN ? 0 :
  clamp(Math.round(v * 1000), -1000, 1000)`, and `-0` becomes `0`. Includes products that are exact halves
  (`+/-0.5`, `+/-1.5`, ...): **JS `Math.round` rounds halves toward +Infinity** (`-1.5 -> -1`, `-0.5 -> -0 -> 0`),
  Luau `math.round` rounds them away from zero (`-1.5 -> -2`). Use `local r = math.floor(x); if x - r >= 0.5 then
  r += 1 end` (exact JS semantics, `x - floor(x)` is exact).
- `dequantizeAxis.hex[q + 1000]` = `hex(q / 1000)` for every q in -1000..1000.
- `quantizeButtons[]` (`(b & 0x1fff) >>> 0`, JS ToInt32 first: fractions truncate, 2^32 + 5 -> 5),
  `quantizeInput[]`, `isValidInput[]` (integers in range; `-0` passes `Number.isInteger`).
- `serializeRecording[]`: `{ name, seed, spawn, frames ([moveX, moveZ, aimX, aimZ, buttons] per tick), serialized,
  reserialized }`; `deserializeErrors[]`: malformed strings and the exact error message thrown.

### `dungeon-<seed>.json` (seeds 1337, 42, 7)

`generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed })` with `KALEB_VALE_MVP_PARAMS = { roomCount: 12, loopChance:
0.15, decorDensity: 0.4, minCombatRoomSize: 8, corridorWidth: 3, treasureCap: 2, shrineCap: 1 }`, theme `auto`
(resolved in `params.themeKey`). Everything the generator returns except `stats.genMs` (a clock reading):

- `W`, `H`; `grid` = H strings of W digits (`grid[y][x]`, `0 VOID, 1 FLOOR, 2 WALL, 3 POOL`); `corridor`, `doorway`,
  `lakeMask` = same shape, `0` / `1`; `roomId` and `bfs` = flat arrays of `W * H` (index `y * W + x`, `-1` = none).
- `rooms[]` (`id, cx, cy, w, h, arch, shape, sx0, sy0, type, depth, difficulty, degree, lake?, grave?`; `sx0` / `sy0`
  are the raw scatter positions `cos(ang) * rad + offX`, given as hex too: they expose trig differences),
  `edges[]` (`a, b, isLoop, isCritical`), `entrance`, `boss`, `maxDepth`, `maxBfs`, `seed` (attempt seed), `valid`,
  `name`, `spawns`, `props` (with `rotHex`, `scaleHex`), `torches`, `pools`, `lakeCells`, `arches`, `stats`.
- `entranceSpawn` (the player's spawn), `bossDoorSpawn` (`?spawn=boss`).
- `encounter`: `placeEncounter(d, DEFAULT_ENCOUNTER)` = `{ spawns: [{kind, x, z}] (slot order at run start),
  rooms: [{id, type, depth, cx, cz, minX, maxX, minZ, maxZ, floorTiles}], entranceRoom, bossRoom }` plus
  `criticalPathRooms`, `populatedRooms`, `roomBudget`. This is `SimConfig.encounter` for the game runs.
- `collision` (seed 1337 only), inputs drawn once from `Rng(0xc011)`, use the stored inputs:
  `moveCircle[]` (400 calls `moveCircle(d, x, z, dx, dz, radius) -> (x, z)` near walls, radii = the player 0.35 and
  every archetype radius, moves up to the 0.5 contract), `walk` (400 chained player moves from `entranceSpawn`, hex
  after each), `isBulletBlocked[]` (400 points over and around the grid, some exactly on tile edges `k + 0.5`),
  `lineOfSight[]` (300 segments, `lineOfSight(bulletBlocker(d), x0, z0, x1, z1)` from `src/sim/actors/helpers.ts`).
  The sim's `moveResolver` is `circleMover(d, 0.35)` = `moveCircle(d, x, z, dx, dz, 0.35)`, `actorMover(d)` =
  `moveCircle(d, x, z, dx, dz, radius)`, `isBulletBlocked` = `bulletBlocker(d)`. Grid cell `(gx, gy)` covers world
  `[gx - 0.5, gx + 0.5]`; `worldToGrid(v) = floor(v + 0.5)`; outside the grid reads as VOID.

### Run fixtures

Common keys: `seed`, `spawn`, `spawnDoc`, `config` (plain-data description of the `SimConfig`), `ticks`, `inputDoc`,
`archetypeIds` / `weaponIds` (registry index order), `recording`, `hashes`, `finalHash`, `subsystems` +
`subsystemsEvery` (per-group hashes, see `hashed-fields.md`; every tick in all runs), `events`, `totals` (each
`SimEvents` field summed over the run), `hitsBySource` (player hits by archetype id), `firstTick` (first tick of
`playerHits`, `actorsKilled`, `playerDied`, `bossEngaged`, `bossPhaseN`, `bossDefeated`), `final` (player, actors,
boss, bullet totals at the end), and `dumps` (or a sibling `*.dumps.json`): `{ tick, hash, subsystems, count, fields:
[[name, value, hex], ...] }` = every hashed number with its name, in hash order, at the listed ticks.

| File | seed | spawn | config | input | dumps at |
| --- | --- | --- | --- | --- | --- |
| `run-player.json` | 1337 | (0.5, -1.25) | `DEFAULT_SIM_CONFIG` = `{ bounds: +/-7.25 }`: no resolver, no blocker (bullet sims cull at +/-48), no encounter, default loadout, no stress | fixed schedule: 8 directions, over-length and analog sticks, aim, rolls (with move / from facing / held / re-pressed mid-roll), debug hits (also during invulnerability and roll i-frames), flasks (also at full hearts), 3 Embers (third ignored), SWAP edges, the bounds clamp, then debug hits until death at tick 975 and 20 dead ticks. FIRE is never pressed while alive | 0, 1, 60, 600 |
| `run-player-dungeon-1337.json` | 1337 | `entranceSpawn` (67, 35) | dungeon 1337: `moveResolver`, `isBulletBlocked`, `actorMover`, **no encounter**, default loadout | 50 ticks in each of 8 directions with a roll at each start (into walls), then 200 ticks down the BFS path toward the boss room | 0, 1, 60, 600 |
| `run-bullets.json` | 7 | (1.5, 0.5) | `{ bounds: DEFAULT_BOUNDS, stress: { bullets: 200, x: 0, z: 0 }, loadout: ['weapon.bow', 'weapon.sword'] }` | bow stream, a full charge (heavy piercing arrow), a half charge, Ember clear, SWAP to the sword: combo + finisher lunge + guard deleting stress bullets, roll, SWAP back, then 63 idle ticks so bullets age out (life 6 s) | 0, 1, 60, 300 |
| `run-full-1337.json` | 1337 | `entranceSpawn` (67, 35) | the game: App.tsx's `SimConfig` for `?seed=1337` (below) | path-walker bot (below) | 0, 60, 600, 3600 |
| `run-boss-1337.json` | 1337 | `bossDoorSpawn` (21, 35) | the game config (same as above) | boss bot (below) | 0, 60, 600, 1800 |

The game config (App.tsx, minus rendering): `d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed })`;
`{ moveResolver: circleMover(d, 0.35), isBulletBlocked: bulletBlocker(d), actorMover: actorMover(d), encounter:
placeEncounter(d, DEFAULT_ENCOUNTER) }`; `loadout` absent (= `['weapon.sword', 'weapon.bow']`), `stress` absent. The
encounter is `dungeon-1337.json` `encounter` (24 room enemies + `boss.act1` in slot 24).

Bots (they read the live state like a player reads the screen; the RECORDING is what replays, so you never need the
bot logic, only the recording):

- **run-full-1337**: walks the 8-neighbour BFS path to the boss room; with an engaged enemy within 7 units it fights
  (random strafes, FIRE 75 % of decisions, ROLL 12 %, SWAP 3 %, aimed at the nearest live actor), flask at <= 2 half
  hearts, Ember at 1. **No god mode.** Outcome: first kill tick 112, 21 kills, boss engaged at tick 1330, the player
  dies to the boss at tick 1784; the boss (phase 1, 509 / 540 hp) and 3 room enemies keep acting until tick 3600.
- **run-boss-1337**: from the boss door: walks in (engage at tick 36), then 180-tick cycles of 60 % attack (sword at
  2.3 units, bow at 6) and 40 % dodge (strafe, ROLL 1/45 per tick), SWAP every 600 fight ticks, flask / Ember on low
  hearts, and **`DEBUG_BOSS` (J: 10 % of the boss's max hp, never skipping a phase) once every 240 fight ticks** so all
  phases happen: phase 2 at tick 636, phase 3 at 1356, swarmer summons, 67 bullets deleted by the sword. **No god
  mode**; the player survives (5 half hearts) and the boss ends at 100.2 hp in phase 3.

### `constants.json`

`archetypes[]` / `weapons[]` in registry index order with their data (numbers as `{ v, hex }`); `payloadLayout`
(field, max, shift); `modules`: every exported non-function value of `config.ts`, `playerData.ts`, `combatData.ts`,
`patterns.ts`, the enemy / boss / weapon modules; `derived`: `SIM_DT`, walk / roll steps, `STEP_TOLERANCE`, hit radius
squared. Use them to check the port's module-load computations (`secondsToTicks`, `halfRotation`, `TURN_COS / SIN`,
`BOW_WOBBLE_COS / SIN`, ...).

### `arc-table.json`

Every burst shape the sim can fire (`count`, `spread`, where it comes from), the `gen.arc` angle of each bullet and
V8's `Math.sin` / `Math.cos` of it. Every sin / cos call made in every run fixture is in this table (checked by the
exporter). Formula in the file's `doc`.

### `math-trace.json`

Per context (`dungeon:<seed>` = generator + encounter placement + spawns; `run:<file>` = `createSimState` + every
`step`, not the bots): every distinct call of a transcendental `Math` function with argument and result (value + hex)
and a call count, plus every `Math.round` of an exact half. Contents: dungeons: `cos` / `sin` (18 each: 12 room
scatter angles + 6 boss braziers), `hypot` (25-28: Delaunay edge lengths for the MST), `round` halves (2-4, e.g.
`Math.round(-15.5) = -15` for seed 1337); runs: only `sin` / `cos` (gen.arc) and `pow(1, 2.4)` (three.js color
conversion, render only).

## Porting notes (things that will break bit-exactness)

1. **Trig.** On the sim path the only trig is `Math.sin` / `Math.cos` inside r3f-projectiles' `gen.arc`, at the finite
   angle set of `arc-table.json`. **Hard-code that table in Luau** (or generate it offline from V8) instead of calling
   `math.sin` / `math.cos`: V8 (measured on Node 25.2.1; Electron's V8 is expected to agree but was not tested) is not always correctly rounded (6 of the table's 276
   values are 1 ulp off the correctly rounded result, e.g. `sin(4.1887902047863905)`) and Luau calls the platform C library, which can disagree in the
   last bit. A plain fdlibm port also does not match V8 (0.8 % of random arguments differ; V8 14 most likely uses
   its glibc-derived `libm_sin` / `libm_cos`). Then apply the rotation exactly as `patterns.ts finishBurst` does
   (`x' = vx * cos + vz * sin`, `z' = vz * cos - vx * sin`, where cos / sin are the DIRECTION's z / x components, no trig).
2. **Dungeon Forge trig and hypot.** The generator calls `Math.cos` / `Math.sin` on random angles (room scatter,
   braziers) and `Math.hypot` for MST edge weights. `Math.hypot` in V8 is **not** `sqrt(x*x + y*y)`: it differs in 27
   of the 79 traced calls (1 ulp), which can break ties between equal-length edges. V8's algorithm (verified identical
   to `Math.hypot` on 220,000 inputs):
   ```
   max = max |arg| (any Infinity -> Infinity; else any NaN -> NaN; max == 0 -> 0)
   sum = 0; comp = 0
   for each arg (in order): n = |arg| / max; summand = n * n - comp; pre = sum + summand;
                            comp = (pre - sum) - summand; sum = pre
   return sqrt(sum) * max
   ```
   For sin / cos there is no exact Luau equivalent: use `math.sin` / `math.cos` and check `rooms[].sx0Hex / sy0Hex`;
   only the rounded room centers reach gameplay, so a last-bit difference matters only if it flips a rounding (see 3)
   or a separation comparison. For full safety port V8's sin / cos (V8 `third_party/glibc` `s_sin.c`, LGPL).
3. **`Math.round` rounds halves toward +Infinity**; Luau `math.round` rounds away from zero. The generator really
   rounds negative halves (`separate()`: seed 1337 rounds `-15.5` to `-15`). Use the floor-based emulation above.
   `secondsToTicks` only rounds positive values (same result either way).
4. **Sort stability.** `Array.prototype.sort` is stable in V8; Luau `table.sort` is not. `generate.ts` relies on it:
   `leaves.sort` (by depth, descending; the first `treasureCap` become treasure rooms) and `eliteC.sort` (by depth) have
   ties. Use a stable sort, or sort by `(key, original index)`. The encounter sorts (`roomsNearestFirst`,
   `nearestFree`) and the registries have total orders.
5. **Set / Map iteration order** (insertion order in JS): `mstIdx` (`for (const i of mstIdx)` sums MST lengths in
   insertion order: float addition order matters) and `critRooms` (iterated to build `eliteC`, then stably sorted) in
   `generate.ts`. Use arrays in insertion order. The registries are sorted by id; hard-code the index tables
   (archetypes `boss.act1, bruiser, sniper, swarmer, turret.caster, turret.sniper, turret.sprayer`; weapons
   `weapon.bow, weapon.sword, weapon.test, weapon.test.melee`) rather than relying on Luau string comparison.
6. **Bullet pool order** (`hashed-fields.md`): free stack LIFO starting at slot 0, swap-remove dense array, backward
   dense walks for `step`, `forEachActive` and `clear`. Collision callbacks run in that order, so which bullet hits
   first depends on it. The hash itself lists live slots in ascending slot order.
7. **`-0`.** IEEE `-0` behaves the same in Luau, but it never round-trips through a recording: `serializeRecording`
   prints `-0` as `0`. `quantizeAxis` turns `-0` into `0`; keep that in the port's quantization (a `-0` axis would flip
   the sign of a facing component and the replay hash). Other `-0`s in the sim come from IEEE arithmetic and match.
8. **Integer / bit operations.** JS `| 0`, `>>> 0`, `^`, `&`, `>>>`, `Math.imul` work on int32 / uint32. Luau `bit32`
   returns uint32 in [0, 2^32): the bit patterns match, the signed views differ (JS `x | 0` can be negative). Normalize
   inputs to [0, 2^32) before `bit32` calls; emulate `Math.imul` with 16-bit halves.
9. **`%`.** JS `%` is a truncated remainder (sign of the dividend, exact like C `fmod`); Luau `%` is floored
   (`a - floor(a / b) * b`). The sim and generator only use `%` where both agree (non-negative operands, or a `!== 0`
   test), but use `math.fmod` when translating a JS `%` that can see negative or non-integer operands.
10. **No float32, no FMA.** Nothing on the sim path is rounded to float32 (see `hashed-fields.md`). Keep `a * b + c` as
    two operations. `+ - * /` and `math.sqrt` are correctly rounded in both engines.
11. **Hash bytes.** `hashNumbers` reads float64 bytes little-endian; Luau `buffer.writef64` is little-endian too, then
    `buffer.readu8` the 8 bytes.
