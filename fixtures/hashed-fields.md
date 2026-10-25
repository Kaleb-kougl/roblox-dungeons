# Hashed fields

`hashState(state)` (web `src/sim/replay.ts`) is `hashNumbers(writeHashFields(state, []))`: 32-bit FNV-1a over the
**little-endian float64 bytes** of every number below, in exactly this order. Every number is hashed as a float64,
integers included (`3` hashes as `0x4008000000000000`). One bit of difference anywhere changes the hash: `0` and `-0`
differ, so do two values one ulp apart.

```
h = 0x811c9dc5
for each value v:
  bytes = float64 bits of v, little-endian (DataView.setFloat64(0, v, true); Luau: buffer.writef64)
  for each of the 8 bytes b:  h = (h XOR b);  h = imul(h, 0x01000193)   -- 32-bit wrap-around multiply
return hex(h as uint32), 8 lowercase digits, zero-padded
```

The labelled dumps in the run fixtures (`dumps[].fields`, `[name, value, hex]`) list the same numbers with these names.
The exporter checks them bit for bit against `writeHashFields()` on every dump, so the names and the order below are
the real ones.

## Layout

`N = 2 + 22 + 16 + 42 * A + 31 + (1 + 10 * E) + (1 + 10 * P)` numbers, where `A = combat.actors.length` (pool slots,
free ones included), `E` / `P` = live enemy / player bullets. The six groups below are also hashed separately as the
fixtures' `subsystems` (`core`, `combatHeader`, `actors`, `weapons`, `enemyBullets`, `playerBullets`):
`subsystems.X[t] = hashNumbers(group X's numbers)`. The full hash is NOT a combination of these: it is FNV-1a over the
concatenation. They exist so you can bisect a mismatch.

### 1. core (24): `replay.ts writeHashFields` + `player.ts writePlayerHash`

| # | name | meaning |
| --- | --- | --- |
| 0 | `tick` | ticks stepped so far (incremented at the end of `step`) |
| 1 | `rngState` | mulberry32 state word, uint32 (0..4294967295) |
| 2-3 | `player.x`, `player.z` | world position |
| 4-5 | `player.prevX`, `player.prevZ` | position at the start of the last tick |
| 6-7 | `player.faceX`, `player.faceZ` | facing unit vector (starts `Math.SQRT1_2, Math.SQRT1_2`) |
| 8 | `player.hearts` | half hearts (6 = 3 hearts) |
| 9 | `player.heartsMax` | 6 |
| 10-11 | `player.armor`, `player.armorMax` | 0, 0 in M1 |
| 12-13 | `player.flask`, `player.flaskMax` | charges, 3 |
| 14-15 | `player.embers`, `player.emberMax` | Embers, 2 |
| 16 | `player.rollTicks` | roll ticks left (21 at start, includes the current tick) |
| 17-18 | `player.rollDirX`, `player.rollDirZ` | locked roll direction |
| 19 | `player.iframeTicks` | dodge / Ember i-frames left |
| 20 | `player.hurtTicks` | post-hit invulnerability left |
| 21 | `player.flaskTicks` | drinking time left |
| 22 | `player.prevButtons` | last tick's `InputFrame.buttons` |
| 23 | `player.dead` | 0 / 1 |

### 2. combatHeader (16): `combat.ts writeCombatHash`, first push

| # | name | meaning |
| --- | --- | --- |
| 0 | `combat.enemyCapacity` | enemy bullet pool size: `max(2048, ceil(stress) + 48 + 512)` (2048 unless stress > 1488) |
| 1 | `combat.playerCapacity` | 512 |
| 2 | `combat.boundsLimit` | **`Infinity`** with `isBulletBlocked` (every dungeon config), else 48. Hex `7ff0000000000000`; JSON value `"Infinity"` |
| 3 | `combat.nextActorId` | next actor serial (from 1) |
| 4 | `combat.enemyEmitters` | emitter ids acquired from the enemy sim (actors + stress) |
| 5 | `combat.actorsDropped` | spawns refused by a full pool (`MAX_ACTORS` 64) |
| 6 | `combat.stressTarget` | `floor(stress.bullets)` or 0 |
| 7-8 | `combat.stressX`, `combat.stressZ` | ring origin |
| 9-10 | `combat.stressDirX`, `combat.stressDirZ` | ring heading (starts 0, 1; `turnDir` after every ring) |
| 11 | `combat.stressEmitterId` | 0 without stress |
| 12-13 | `combat.enemySpawned`, `combat.playerSpawned` | bullets spawned so far |
| 14 | `combat.dropped` | bullets a full pool dropped |
| 15 | `combat.actors.length` | pool slots (grows to 64, never shrinks) |

### 3. actors (42 per slot, slot order, free slots included): `actors.ts writeActorHash`

22 scalars in `ACTOR_HASH_FIELDS` order, then `capWindow[0..11]`, then `v[0..7]`:

| # | name | meaning |
| --- | --- | --- |
| 0 | `id` | serial (0 = free slot) |
| 1 | `kind` | archetype index (`-1` = free). Index order: `0 boss.act1, 1 bruiser, 2 sniper, 3 swarmer, 4 turret.caster, 5 turret.sniper, 6 turret.sprayer` (ids sorted by JS string `<`; hard-code it) |
| 2 | `spawnTick` | tick spawned; `-1` for the initial encounter |
| 3-4 | `x`, `z` | position |
| 5-6 | `prevX`, `prevZ` | position at the start of the tick |
| 7-8 | `faceX`, `faceZ` | facing unit vector |
| 9-10 | `hp`, `hpMax` | can be fractional (boss: `DEBUG_BOSS` takes `hpMax * 0.1`, the damage cap clips) |
| 11 | `radius` | body radius |
| 12 | `alive` | 1 / 0 |
| 13 | `deadTicks` | ticks since death |
| 14 | `aiState` | 0 IDLE, 1 TELEGRAPH, 2+ archetype states (room enemies: `STATE_ENGAGED` = 2, more in each archetype file; boss: 2 DORMANT, 3 ACTIVE, 4 RECOVER, 5 TRANSITION, 6 REPOSITION) |
| 15 | `aiTicks` | archetype timer |
| 16 | `attack` | attack id (boss: 0 NONE, 1 FAN, 2 RING, 3 DOUBLE_RING, 4 SPIRAL, 5 SLAM, 6 FAST_FAN, 7 ROAR) |
| 17 | `cooldown` | archetype cooldown |
| 18 | `flashTicks` | hit flash left |
| 19 | `emitterId` | its emitter id in the enemy bullet sim |
| 20 | `phase` | boss phase (0 for others) |
| 21 | `capBucket` | damage-cap bookkeeping: last bucket (`floor(tick / 10)`), `-1` none |
| 22-33 | `capWindow[0..11]` | damage booked per 10-tick bucket (ring buffer, index `bucket % 12`) |
| 34-41 | `v[0..7]` | archetype scratch, see below |

Scratch slots (`v`): room enemies (`enemyShared.ts`) `0 V_AGGRO, 1 V_HOME_X, 2 V_HOME_Z`; swarmer `3 LOST, 4 DIR_X,
5 DIR_Z, 6 LAST_X, 7 LAST_Z`; sniper `3 LOST, 4 AIM_X, 5 AIM_Z, 6 AIM_LEN, 7 STRAFE (-1 / 1)`; bruiser `3 LOST,
4 GAP_X, 5 GAP_Z`; turrets `0 DIR_X, 1 DIR_Z`; boss.act1 `0 DIR_X, 1 DIR_Z, 2 AUX_X, 3 AUX_Z, 4 MARK, 5 LAST,
6 REPEAT, 7 SIGN` (summoned swarmers get `V_HOME_X/Z` from the boss). A freed slot is reset to all zeros except
`kind = -1` and `capBucket = -1`.

### 4. weapons (31): `weapons.ts writeWeaponsHash`

| # | name | meaning |
| --- | --- | --- |
| 0 | `weapons.activeSet` | set in hand (0 / 1) |
| 1 | `weapons.prevButtons` | last tick's buttons (SWAP / FIRE edges) |
| 2 | `weapons.emitterId` | the player's emitter id in the player bullet sim (1) |
| 3 | `weapons.swingTick` | tick of the last recorded melee swing, `-1` none |
| 4-5 | `weapons.swingX`, `weapons.swingZ` | swing origin |
| 6-7 | `weapons.swingDirX`, `weapons.swingDirZ` | swing direction (starts 0, 1) |
| 8 | `weapons.swingRadius` | reach (starts 0) |
| 9 | `weapons.swingHalfCos` | cone half-angle cosine (starts 1) |
| 10 | `weapons.sets.length` | 2 |
| 11.. | per set: `weapon`, `cooldown`, `v[0..7]` | weapon index (`-1` empty): `0 weapon.bow, 1 weapon.sword, 2 weapon.test, 3 weapon.test.melee` |

Weapon scratch: sword `0 STEP, 1 BUSY, 2 WINDOW, 3 GUARD, 4 LAST`; bow `0 CHARGE, 1 SHOT, 2 HEAVY_TICK`.

### 5-6. enemyBullets, playerBullets (1 + 10 per live bullet each)

`activeCount`, then r3f-projectiles `BulletSimulation.writeStateHash(out)` (`node_modules/@k9kbdev/r3f-projectiles/dist/chunk-7SBM6O5V.js`):
for every **slot index** `i` from 0 to `_highWater - 1` **in ascending slot order** that is live (`_slotToDense[i] >= 0`):

| # | name | meaning |
| --- | --- | --- |
| 0 | `slot` | the slot index `i` |
| 1-3 | `px`, `py`, `pz` | position (`py` is always 0.5 = `BULLET_Y`) |
| 4-6 | `vx`, `vy`, `vz` | velocity (`vy` always 0) |
| 7 | `life` | seconds left (`life -= SIM_DT` every step) |
| 8 | `payload` | packed integer (see below) |
| 9 | `emitter` | emitter id |

Nothing is written when `activeCount` is 0. Not hashed: `delay` (always 0 here), `acc` (always 0), `scale`, `color`,
`prev` positions, `_spawnGen`, the dense array order, the free stack.

## r3f-projectiles BulletSimulation internals the port must copy exactly

The hash only shows slot indices, but which bullet lives in which slot, and the ORDER bullets are visited in collision
callbacks (which bullet hits the player first, which actor a player bullet hits), come from the pool's sparse set:

- Arrays per slot: `_pos[i]`, `_vel[i]`, `_acc[i]` (three.js `Vector3`, plain doubles), `Float64Array`s `_delay`,
  `_life`, `_payload`, `_emitter`, `_scale`, `_spawnGen`, `_prev` (3 per slot, interpolation on), and a
  `Float32Array _color` (render only, never hashed or read by the sim).
- Sparse set: `Int32Array _dense` (live slots, dense order), `_slotToDense` (`-1` = free), `_free` (a stack).
  `_reset(capacity)`: `_free[i] = capacity - 1 - i`, `_freeTop = capacity`, so the first acquired slot is **0**, then 1, 2...
- `_acquireSlot()`: `slot = _free[--_freeTop]`; `_dense[_denseCount++] = slot`; `_slotToDense[slot] = d`;
  `if (slot >= _highWater) _highWater = slot + 1`. Full pool (`_freeTop == 0`): the rest of the burst is dropped.
- `_releaseSlot(slot)`: swap-remove: `d = _slotToDense[slot]; last = _dense[--_denseCount]; _dense[d] = last;
  _slotToDense[last] = d; _slotToDense[slot] = -1; _free[_freeTop++] = slot` (freed slots are reused LIFO).
- `step(dt)` (`_advance`) visits `d = _denseCount - 1` down to `0` (dense order, backwards): skip/decrement `delay`
  (never > 0 here); `prev = pos`; `vel += acc * dt`; `pos += vel * dt` (`Vector3.addScaledVector`: `x += v.x * s`, per
  component, two roundings each); `life -= dt`; release when `life <= 0` or, when `boundsLimit !== Infinity`, when
  `|p.x - 0| > limit || |p.y - 0| > limit || |p.z - 0| > limit` (no `boundsCenter` in the sim). Then `_stepCount++`.
  Releasing during the backward walk is safe: the element swapped into `d` was already visited.
- `forEachActive(cb)` and `clear()` walk the same way (`d` from `_denseCount - 1` down to 0); `cb(i, pos, payload,
  emitter)` returning `true` releases slot `i` immediately. `clear(emitterId?)` releases every live bullet (or one
  emitter's) and returns how many.
- `fireAt(origin, pattern, emitterId)`: `if (emitterId >= _nextEmitterId) _nextEmitterId = emitterId + 1`, resolves
  the pattern (an array of spawn data), then for each spawn in array order acquires a slot and sets
  `pos = origin + offset` (`Vector3.copy(o).add(offset)`: component-wise adds), `vel = velocity`, `acc = acceleration`,
  `delay`, `life`, `payload`, `emitter`, `scale`, color.
- `acquireEmitter()` returns `_nextEmitterId++` (ids from 1; never reset). `releaseEmitter(id)` only raises the
  counter if needed. `setPayload(i, p)` writes only when `i` is live.
- `activeCount` = `_denseCount`. The `highWater` GETTER resets `_highWater` to 0 when read while the pool is empty
  (the renderer reads it); `writeStateHash` reads the field directly. This cannot change a hash (only live slots are
  written), so a port may simply iterate `0 .. capacity - 1` or track the max.
- Spawn data comes from a module-level pool (`acquire` / `releaseSpawnData`) that resets every field on reuse; it has
  no effect on values.

Bullet payload (`patterns.ts BulletPayload = definePayload({ damage: 6, kind: 4, source: 8, pierce: 3, lastHit: 7 })`),
lowest bits first: `damage` bits 0-5, `kind` 6-9, `source` 10-17 (enemy bullets: archetype index + 1; player bullets:
weapon index + 1; 0 unknown), `pierce` 18-20, `lastHit` 21-27 (actor slot + 1). `get(p, f) = (p >>> shift) & mask`;
`with(p, f, v) = (p & ~(mask << shift) | (v & mask) << shift) & 0x7fffffff`; `pack` ORs `(v & mask) << shift` in
field order. Stored as a float64; always a non-negative integer < 2^28.

## Float32 and other rounding on the sim path

- **No float32 value is ever hashed or read by the sim.** The only `Float32Array` on the step path is the bullet
  pool's `_color` (render only). There is no `Math.fround` anywhere on the path (the Math trace in `math-trace.json`
  confirms: no `fround` call in any run). three.js `Vector3` stores plain doubles. A Luau port with doubles only needs
  no float32 emulation for the hash.
- `Int32Array`s (`_dense`, `_slotToDense`, `_free`) hold small integers; `Uint8Array` / `Int16Array` (dungeon grid,
  roomId, bfs, masks) hold small integers.
- three.js `Color.set(0xffffff)` inside `_spawn` calls `Math.pow(1, 2.4)` (sRGB -> linear) on every spawned bullet: it
  appears in the Math trace but only feeds `_color`. Skip it in the port.
- Transcendental functions on the step path: **only `Math.sin` / `Math.cos` inside the library's `gen.arc`**, at a
  finite set of angles listed in `arc-table.json` with V8's results. Everything else the sim computes is `+ - * /`,
  `Math.sqrt`, `Math.abs`, `Math.floor`, `Math.ceil`, `Math.min`, `Math.max`, `Math.trunc`, integer bit operations
  and `Math.imul`, all exact in IEEE-754 double arithmetic (no fused multiply-add: compute `a * b + c` as two rounded
  operations, which is what both V8 and the Luau VM do).
