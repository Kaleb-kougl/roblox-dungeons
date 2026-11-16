# New enemies 3 (Mortar, Mender, Jackal)

Endless rooms buy fifteen room enemies today: swarmer, sniper and bruiser; imp, Ooze and summoner
(docs/ENEMY_VARIANTS.md); bomber, charger, stormcaller, warbanner and reaper (docs/NEW_ENEMIES.md); Shieldwall,
Chainhook, Snatcher and Pyre-keeper (docs/NEW_ENEMIES_2.md). Three gaps are left:

- **Nothing punishes hiding.** Solid pillars, tombs and bookcases stop every enemy bullet, and the Sniper teaches you to
  stand behind them. No enemy reaches you there.
- **Nothing undoes your damage.** The Warbanner buffs its allies and the Shieldwall protects them, but every hit you
  land stays landed. Kill order matters only for who shoots you.
- **Nothing uses your facing.** Your facing is hashed sim state (`faceX` / `faceZ`), and the guard and the swing use it,
  but no enemy reads it. You can face one way for a whole fight.

This plan adds three room archetypes, one per gap. Each is drawn by an unused 2D Demons rig already in
`art/vendor/demons-topdown/` (19 of its 34 rigs are unused today):

| Id | Role | Rig (NTD2) | Why this rig |
|---|---|---|---|
| `mortar` | lobs a shell over walls and pillars at where you are heading; shrapnel bursts where it lands | **Demon Spawn 6** (bow, lean build) | `Attack 4` draws the bow straight up, which is exactly the lob; `Attack 1` is the release |
| `mender` | channels a heal beam into the most wounded ally; cut the beam or kill it first | **Imp 10** (bone charms, empty hands) | `Attack 1` / `Attack 3` raise both arms over the head (a channel pose to loop); the pale bone charms read as a shaman next to the red imps |
| `jackal` | comes as a pack of three that circles you and lunges at your back; face one and it shies away | **Demon Beast 2** (lanky, clawed, hunched) | `Run` is a low lope for the circling; `Crouch` is the lunge's wind-up; **`BackFlip 1`** is the spooked hop back |

Alternates kept for a swap after the Studio check: Mortar **Imp 7** (the same bow on an imp body; its `Attack 4` aims
up too); Mender **Imp 4** (small, plain); Jackal **Imp 2** (if three Beast-2 bodies read too heavy for a pack).
Contact sheets of all 19 unused rigs and of these candidates: `Claude outputs/unused-demons/` (gitignored, local only).

Work it task by task, like `PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes live in the sim, replay, validate on the server and step in lockstep. It follows
docs/NEW_ENEMIES_2.md's patterns: a new registry band (no recorded index moves), kinds appended to
`ENDLESS_ROOM_KINDS`, the per-sheet Demons pipeline for the art, SILENT port audio IDs in the placeholder,
first-sighting lines and Codex entries. **No new hash group and no new bullet kind**: a heal is a write to the hashed
`hp`, every new value is actor scratch (`v[]`, hashed), and the Mortar's shell is the Stormcaller's `STRIKE`. M1
(`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before. Endless, daily and dev replays
and scores change. The all-time boards stay `_v1`; `DAILY.ruleset` goes 21 -> 22, or the next free number when this
lands.

## Status (2026-11-16)

**Plan only; decisions taken.** Nothing built. Read on `main` @ `80f57769`. NTD1-NTD14 taken by the owner on
2026-11-16 (see Decisions): every one as recommended except **NTD3** (the Mortar fires only while its target is in the
Mortar's own room), **NTD9** (a guard that stops a Jackal's lunge counts as a parry) and **NTD10** (the last Jackal of a
pack keeps the back-only rule).

## What the code gives us (read on `main` @ `80f57769`)

Paths under `src/shared/` unless they say otherwise.

| Fact | Where | Consequence |
|---|---|---|
| Bands 0-6 are taken; band 6 (`PORT_BAND_ENEMIES_3`) holds `bulwark` .. `snatcher`, indices 19-23 | `sim/combat/actors/registry.ts` | New band 7 `PORT_BAND_ENEMIES_4`. With `compareIds`: `jackal` 24, `mender` 25, `mortar` 26. No older index moves |
| `ActorState` has `hp` and `hpMax` (both hashed, in `ACTOR_HASH_FIELDS`); `ACTOR_SCRATCH_SLOTS` = 8, 0-2 shared | `sim/combat/actors/types.ts` | A heal is `hp = min(hpMax, hp + n)` on the ally: no new field. Each kind gets v3-v7 |
| Player `faceX` / `faceZ` (hashed) follow the aim input, else the roll direction, else the move input; `prevX` / `prevZ` are the tick-start position | `sim/player.ts` (~165, ~245-255) | The Jackal reads its target's facing. The Mortar's lead is `(x - prevX, z - prevZ)` x ticks: one tick of the player's own motion, no new state |
| `BulletKind.STRIKE`: speed 0, radius `STRIKE_BULLET_RADIUS` 1.1, a non-floor point skipped, no grazes, never erased by any sweep or Phantom Step, ignores breakables, held for 6 collision passes; counted in `events.strikes` | `archetypes/stormcaller.ts`, `combat/combat.ts`, `combatData.ts`, `sim/state.ts` | The Mortar's shell is one `STRIKE` at the landing point (NTD4). The view tells a shell from lightning by its payload source (kind + 1); `events.strikes` must not play the Stormcaller's sound for a shell (NT0 checks every reader) |
| `ctx.fireEnemy(actor, dirX, dirZ, spec, x, z)` takes an origin override | `combat/ctx.ts` | The shrapnel ring fires from the landing point, not the Mortar |
| Port arc row **6 @ FULL_RING** exists (Ballista's rings) | `combat/arcTablePort.ts` | The shrapnel needs no new row; NT1 adds the Mortar to that row's `source` comment |
| `ctx.lineOfSight(x0, z0, x1, z1)` tests `isBulletBlocked` | `combat/ctx.ts` | The heal beam's sight test; the Mortar never calls it (it fires over cover) |
| Enemy melee hits (the Shieldwall's bash, the Charger, the swarmer's lunge) call `ctx.hurtPlayerAt` directly. The sword's guard only erases enemy bullets; it never stops a melee hit | `archetypes/bulwark.ts`, `charger.ts`, `swarmer.ts`, `weapons/defs/sword.ts` | A guard that stops a Jackal's lunge is a new rule at the Jackal's own hit site (NTD9). The guard is readable there (`swordGuard`, `SWORD_V_GUARD`) |
| The swarmer has a lunge (`aimLine` hint, `LUNGE_SPEED` x `LUNGE_SECONDS`) | `archetypes/swarmer.ts` | The Jackal copies its lunge and hit-once rule |
| Hints are data on the archetype (`aimLine`, `ring`, `strikeRow`) | `archetypes/*.ts` | The Mortar uses `ring` at v3-v4. The heal beam has no hint today: a view-only tether drawn from v3 (the ally's id), see Architecture 4 |
| `spendEncounterBudget` buys ONE kind per draw, up to `ENDLESS_ROOM_ACTOR_CAP` 16; `populateEndlessRoom` places swarmers in packs of up to `ENDLESS_PACK_SIZE` 4 around an anchor (placement only, no extra draws) | `dungeon/endless.ts`, `dungeon/endlessData.ts` | A Jackal pack needs a new optional `packOf` on `EndlessRoomKind`: one buy pushes three `jackal` entries, and the swarmer's anchor placement is generalised to any pack kind. Without a pack kind in the pool, every draw and tile is as today |
| `ENCOUNTER_COST` is per archetype and read outside the spender (Horde's wave cost, the score record's cost and par) | `dungeon/encounterCost.ts` | The Jackal costs 1 **each**; the spender prices a pack at `packOf` x cost (3). Every per-spawn reader stays right (NT0 lists them) |
| `ENDLESS_ROOM_KINDS` has 15 rows; `ROOM_KIND_MIN_FLOOR` (Chainhook 2) is honoured in every world; the roster shuffles every kind but the swarmer, one more per floor | `dungeon/endlessData.ts`, `dungeon/endless.ts` | Appending three rows reshuffles **every** run's roster (17 seeded kinds, full on floor 17). Any new kind could be floor 1's seeded kind unless it gets a minimum floor (NTD7) |
| Codex: kinds past `CODEX_FIRST_ROOM_KINDS` (11) are the second list, appended after `secret:room` in `ENDLESS_ROOM_KINDS` order | `codex/catalog.ts` (~200, ~443) | The three entries land after the Pyre-keeper's on their own: catalogue 91 -> 94, the order lock extended, never reordered |
| `PORT_AUDIO_EVENTS` ends with New enemies 2's eight (`sfx.enemy.pyrelight` last); its tail is pinned by `codex.spec` and skipped in a list of specs | `theme/contract.ts`, CLAUDE.md | New sounds are appended after `sfx.enemy.pyrelight`; NT1 updates `codex.spec`'s tail and the listed skips |
| `enemyBulletLookOf(payload)` picks the look per archetype; enemy bullet art stays in the danger pink (`bulletArtReport`) | `view/bullets/looks.ts` | Shrapnel draws the small look; the Mender's bolt the caster's medium. No new bullet art in v1 (NTD12) |
| `contract.luau` / `validate.luau` / `sprites.luau` top-level locals 187 / 192 / 195 (counted on out/) | CLAUDE.md (New enemies 2) | Appending to `ENEMY_ARCHETYPES`, strings and `PORT_AUDIO_EVENTS` costs no locals; the heal role's check folds into an existing report module |
| `DAILY.ruleset` is 21 | `daily/config.ts` | 21 -> 22 (NTD14) |

## Player experience

1. **Mortar.** A lean demon at the back of the room draws its bow straight up. A ring lights up on the floor ahead of
   you, where you are walking to, not where you stand. A second later the shell lands in it and bursts into a ring of
   shrapnel. It fires over pillars, tombs and bookcases, so the cover that saves you from the Sniper does nothing here.
   Change direction once the ring appears, and stay out of the burst. Leave its room and it stops firing.
   Lesson: cover is not safety; keep moving.
2. **Mender.** A small imp with bone charms raises its arms, and a beam ties it to the most hurt demon in the room. The
   demon's wounds close while the beam holds. Hit the Mender and the beam snaps. Step into the beam yourself and it
   snaps. A pillar between them snaps it too. With nobody to heal, it plinks you with slow bolts.
   Lesson: kill the healer first, or cut the line.
3. **Jackal.** Three lanky beasts lope in a circle round you, never quite in front. The one behind you crouches. Turn to
   face it and it flinches back with a hop; look away and it lunges into your back. Only one lunges at a time, so the
   fight is a rhythm of turning. A Knight who guards into a lunge knocks it reeling.
   Lesson: watch your back, and turn at the right moment.
4. **First sighting** (EVD10's toast) and a Codex entry for each of the three.

## Design

All three are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts, `walkStep` / `enemyCooldown`, the
Warbanner's aura and the affixes apply) and start every attack through `ctx.telegraph`. Numbers are starting values,
tuned in NT12. Speeds are units per second; angles are cosines (literals, no trig in the sim). The player walks at 6.

### Mortar

| | |
|---|---|
| Body | 4 hp, r 0.35, 2.2, contact 0 |
| Engaged | Keeps 7-11 from its target (the stormcaller's keep-range walk and strafe side), staying inside its own room. It needs **no line of sight** to keep range or to fire, but it fires **only while its target stands in the Mortar's own room** (NTD3: the room its score record belongs to; a corridor cell is outside). Target outside: no lob, it holds its range from inside the room. It leashes only by home distance (`shouldLeash`), never for lost sight |
| Lob | Cooldown 3.2-4.2 s out, target in the Mortar's room, within 13 and at least 3 away: **draw** 0.35 s (`ctx.telegraph`). On release the landing point is fixed: target + `(x - prevX, z - prevZ)` x `leadTicks` (the flight's 60 ticks x `leadShare` 0.6 = 36), the lead clamped to `maxLead` 3.0 (scaled by `maxLead / len` when longer; one sqrt). If the point's cell is not floor (wall, void, solid decor, an intact piece), the target's own position is used instead (always floor). Then **flight** 1.0 s: the `ring` hint (radius `STRIKE_BULLET_RADIUS`) sits on the point and fills |
| Impact | On the flight's last tick: one `STRIKE` bullet at the point (the Stormcaller's rules: no grazes, never erased, hurts `HIT_NORMAL` once), then **shrapnel**: 6 @ FULL_RING from the point (the existing port row), speed 3.5, life 1.2 s, `HIT_NORMAL`. The shrapnel is ordinary enemy bullets: walls and pieces stop it, the guard erases it, it grazes |
| Too close | Within 3 of its target it does not lob; it backs off at its walk speed |
| Draws | First cooldown in `init`; one per lob (the next cooldown). The landing point uses no draw |
| v[] (3-7) | 3-4 landing x / z, 5 flight ticks left, 6 strafe side (+1 / -1), 7 free |
| Cost / points / drop % | 2 / 120 / 8 |
| Unlock / weight / per room | NTD7 / 1 / 2 |

A Mortar killed mid-flight: dead actors are not stepped, so its flight timer stops and the shell would never land.
NTD5: the shell **lands anyway**, so a visible ring never lies: the corpse finishes the flight and lands it
on time, the way a Vengeful corpse holds its pending ring (`affixHoldsCorpse` in `actors.ts`). Not through `def.stepDead`: defining it
marks an archetype as a reviver, which `runOnKill` and `dropsOnKill` treat differently. If NT0 finds the corpse hold
cannot carry it, the fallback is that the shell lands at once at the Mortar's death. No draw either way.

### Mender

| | |
|---|---|
| Body | 5 hp, r 0.35, 2.6, contact 0 |
| Engaged | Keeps 5-8 from its target. With a wounded ally, it walks to stay within `healRange` 6 of that ally instead |
| Pick | Every 15 ticks while not channelling: the **most wounded eligible ally** within `healRange` and in sight (`ctx.lineOfSight`): a living room enemy (`RoomEnemyData`) with `hp < hpMax`, never a Mender, never a boss, the Goldling, the dummy or a pyre (NTD8). Most wounded = lowest `hp / hpMax`, compared by cross-multiplying (no division); ties go to slot order |
| Channel | **Link** 0.4 s (`ctx.telegraph`: the beam forms; it stands still facing the ally), then **channel** up to 3.0 s, standing still: every 30 ticks the ally gains 1 hp (never above `hpMax`). The channel **ends** when: the ally is full or dead; sight is lost; a living player's centre is within `PLAYER_RADIUS` + 0.15 of the segment between them (body block; between the end points only); the Mender takes any damage (a 0.4 s flinch follows); the 3.0 s are up. Then cooldown 1.2-1.6 s |
| Bolt | No wounded ally and its target in sight within 9: one aimed bolt every 2.2-2.8 s, speed 4.5, life 2.5 s, `HIT_NORMAL` |
| Draws | First cooldown in `init`; one per channel end (the next cooldown); one per bolt |
| v[] (3-7) | 3 ally's actor id (0 none), 4 channel ticks, 5 pulse timer, 6 strafe side, 7 hp healed this life (scratch, hashed like every v slot; read by the view and NT12) |
| Cost / points / drop % | 2 / 150 / 10 |
| Unlock / weight / per room | NTD7 / 1 / **1, never the room's first buy** (`needsCompany`) |

The heal is the only write. Score, combo, room records and drops never see it: a healed enemy pays its normal kill
points once. Unhashed `events.heals` (ally slot, amount) feeds the view's `+` sparks.

### Jackal

| | |
|---|---|
| Body | 3 hp, r 0.32, 4.6, contact 0 |
| Pack | Bought as a **pack of three** (one buy; NTD6). The pack is every living Jackal with the same aggro target: no pack id is stored |
| Engaged | **Circles** its target at 3.0-3.6: each tick the walk is the tangent (side +1 / -1 from the actor id's parity, no draw) plus a radial pull back into the band, plus a push away from every other Jackal within 1.4 (slot order), normalised, through `walkStep` with the steer mover |
| Lunge | When the cooldown is out, **no other Jackal on the same target is in its wind-up or lunge** (a slot-order scan), and the Jackal is **outside its target's front cone** (`dot(face, toJackal) < frontCos` 0.34, about 70 degrees either side): **wind-up** 0.35 s (`ctx.telegraph`, crouch, `aimLine` length 2.8 at a heading locked at the start) |
| Spooked | If during the wind-up the target's facing turns onto it (`dot >= spookCos` 0.5), the lunge is **called off**: a hop back 1.2 units over 0.2 s (`moveActor`), cooldown 0.6 s. No draw |
| Strike | Otherwise **lunge** 2.8 units over 0.18 s along the locked heading; the first overlap with its target hurts `HIT_NORMAL` once (the swarmer's hit bit). Then **recover** 0.5 s |
| Guard (NTD9) | A sword guard that is up while the lunging Jackal overlaps the player, with the Jackal inside the guard's sweep, refuses the hit and **staggers** it 1.0 s (still, takes full damage). It **counts as a parry**: the stop pushes the guard's entry on the unhashed `ScoreEvents` feed (`guardX/Z/Player`, the feed the sword's bullet erases use, docs/GRAZE_PARRY.md), so the near-miss director, the parry sparks, the PARRY! floor text and its solo freeze, the recap's and contribution screen's parry counts and the parry haptic all see it with no new path. Scored runs only, like every parry |
| Last of the pack (NTD10) | **Keeps the back-only rule**: a lone Jackal still lunges only from outside its target's front cone. Facing it holds it off; it dies to 3 hp of damage like any Jackal |
| Draws | First cooldown in `init`; one per lunge (cooldown 1.4-2.0 s). A spook draws nothing |
| v[] (3-7) | 3 phase ticks (hop / recover / stagger), 4-5 lunge heading, 6 hit bit, 7 free |
| Cost / points / drop % | 1 each (a pack is 3) / 70 each / 4 |
| Unlock / weight / per room | NTD7 / 1 / **1 pack** |

Shared safety rules (docs/NEW_ENEMIES.md's): no landing point, heal target or circling step is placed by a draw beyond
the documented draws per attack, so the draw count never depends on the layout. Every rule keys off the actor's aggro
target. Affixes apply to all three as planned spawns (a Swift Jackal, a Hulking Mender, a Vengeful Mortar).

## Architecture

### 1. Sim

- `sim/combat/actors/archetypes/{mortar,mender,jackal}.ts`, each a copy of the nearest shape (never an import):
  mortar <- stormcaller (keep range, strafe, `STRIKE`) + bomber (a ring from a point); mender <- summoner (keep range,
  ally scans) + caster (bolt); jackal <- swarmer (lunge, hit bit) + golden (steer mover walk).
- `registry.ts`: `PORT_BAND_ENEMIES_4 = 7`, band comment updated.
- **Shell**: `STRIKE` unchanged. The Mortar's impact fires it with the Mortar's payload source; NT0 confirms
  `events.strikes` and the cue mapper can tell a shell from lightning (else a second count `events.shells`, unhashed).
- **Heal**: `healActor(ctx, a, n)` in `actors.ts` (clamps to `hpMax`, pushes `events.heals`), called only by the
  Mender. Never through `damageActor`, so no cap bucket, flash or build proc moves.
- **Facing test**: a small pure helper `behindPlayer(p, x, z, frontCos)` (no sqrt: compares `dot` against
  `frontCos x len` with both sides squared, sign checked).
- **Guard stop**: the Jackal's hit site reads the target's sword slot (`swordGuard` > 0) and the guard's sweep cone
  (`swordGuardSweepCos` for that player: Bastion's full ring included). A stop pushes one `guardX/Z/Player` entry on
  `ScoreEvents` (NTD9: a parry), exactly as an erased bullet does. It does not count toward Riposte's erased-bullet
  count or Bastion's brace (they count bullets); NT11 confirms that reads right in play.
- **Room test**: the Mortar's "target in my room" reads the target's cell against its score room's rectangle (NT0
  finds the existing helper: the pellets' and the Goldling's room tests do the same).
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype`.

### 2. Dungeon (`shared/dungeon`)

- `EndlessRoomKind.packOf?: number` (absent = 1). `spendEncounterBudget`: a pack kind is open only when
  `cap - out.size() >= packOf`, costs `packOf x encounterCost(kind)`, and pushes `packOf` entries; `bought` counts
  packs, so `maxPerRoom` 1 means one pack. With no pack kind open, every draw is as today.
- `populateEndlessRoom`: the swarmer's anchor-and-nearest placement becomes a map of pack sizes (`swarmer` 4 as today,
  `jackal` 3). A Jackal pack always starts a new anchor (its `spreadTile` draw, as a new swarmer pack does).
- `ENDLESS_ROOM_KINDS` appended (never reordered): `mortar` 1 (cap 2), `mender` 1 (cap 1, `needsCompany`), `jackal` 1
  (`packOf` 3, cap 1). `rosterOrder` shuffles 17 kinds.
- `roomPool.lock.spec` (floor 1 without a roster unchanged), `roster.spec`, `rosterLine.spec`, `daily.spec` and the
  determinism pins that record endless floors re-pinned. `DAILY.ruleset` 21 -> 22.

### 3. Theme contract

- `ENEMY_ARCHETYPES` += the three ids (asset, colour role, `.name`); placeholders from the enemy palette (a thin
  cylinder with an upturned bow, a short robe with a halo ring, a low wedge). Display names Mortar, Mender, Jackal.
- One colour role `enemyHeal` (the beam and the `+` sparks): a sickly green, >= 40 CIE76 from the enemy-bullet roles,
  `telegraph`, `enemyOutline`, `enemyAura`, `enemyGuard`, the player's `fx.heal`, `build.counter` and the boosts, so it
  never reads as the player's own heal. Folded into an existing report (`guardReport`'s module).
- Bullet looks: the Mortar's shrapnel maps to the small look, the Mender's bolt to the medium. The shell draws as the
  `STRIKE` disc in v1 (NTD12); optional hazard art `bullet.enemy.shell` later.
- Port audio IDs, appended after `sfx.enemy.pyrelight`, SILENT in the placeholder with `SFX_FALLBACK`s:
  `sfx.enemy.lob` (-> `sfx.enemy.hook`), `sfx.enemy.shell` (-> `sfx.enemy.blast`), `sfx.enemy.heal` (no fallback: the
  beam carries it), `sfx.enemy.healcut` (-> `sfx.enemy.block`), `sfx.enemy.lunge` (-> `sfx.enemy.charge`),
  `sfx.enemy.spooked` (no fallback).
- Strings: three `enemy.<id>.name`, three `bestiary.<id>`, each with an `l10n/context.json` entry.

### 4. View and client

- Mortar: the bow drawn skyward (`Attack 4` segments: draw, release), a view-only shell arc from its hand to the ring
  over the flight (the Pyre-keeper's torch arc), the ring filling, a dust burst and the shrapnel on impact.
- Mender: `Attack 1` / `Attack 3` looped while channelling (`ActorAttack.loop`); a tether from its hands to the ally in
  `enemyHeal` (one Beam or a pooled run of parts, the Chainhook's chain), a soft pulse every 30 ticks, `+` sparks on
  the ally; a snap when the channel is cut. The tether is drawn from v3 (the ally's id), so it needs no sim hint.
- Jackal: `Run` while circling, `Crouch` held over the wind-up, `Attack 2` or `Run Attack` for the lunge (marks measured
  in NT8), `BackFlip 1` for the spooked hop, `TakeDamage` slowed for a stagger. A faint arc on the floor behind the
  player is **not** drawn (the lesson is to read the crouch).
- Cue mapper rows for the six sounds; `minInterval` on lunge (0.1 s) and healcut.
- First sighting: three ids into `SIGHTING_IDS` / `ARCHETYPE_SIGHTINGS` before the affix ids (NE1's rule).
- Codex: three `enemy:<id>` entries after `enemy:pyrekeeper` (the second list does it; catalogue 91 -> 94).

## Tasks

- **NT0. Audit (read-only).** Confirm every row of "What the code gives us" on the branch point. List every reader of
  `ENCOUNTER_COST` and check a pack of three costs right in each (Horde's wave, the score record's cost and par, the
  treasure SWIFT par); every reader of `events.strikes` (the cue mapper, the hazard view, the power pellet's and the
  guard's skips) and whether a shell needs its own count; how bosses, the Goldling, the dummy and pyres are told apart
  in data (for NTD8); whether a corpse hold like the Vengeful affix's (`affixHoldsCorpse`; never `def.stepDead`, which
  marks a reviver) can finish a dead Mortar's flight (NTD5); whether `prevX` is the tick-start position for a player
  that rolled or was dragged by a Chainhook (the lead must never jump); the Mortar's keep range against
  `VIEW_TILES_HIGH` in landscape and portrait. Re-render the contact sheet of the three
  rigs at full size with `Crouch`, `BackFlip 1`, `Attack 1-4` and `Run` (gitignored `art/build/contact/`). Write the
  plan into `docs/NEW_ENEMIES_3.md` and add its row to CLAUDE.md's Documents table.
  **Verify:** findings written under "NT0 findings".
- **NT1. Registry, data and contract skeleton.** Band 7, three ids with stub steps, data rows, `ENEMY_ARCHETYPES` +
  placeholders + strings, `enemyHeal`, the six SILENT sounds (`codex.spec` tail and the listed skips updated), the arc
  row's comment.
  **Verify:** indices 24-26 and every older index unchanged; `contract.luau` / `validate.luau` compile under Lune within
  200 locals; `npm run verify` green; every fixture, M1 and tutorial lock unchanged.
- **NT2. Mortar.** Keep range without sight, draw, landing point and its fallback, flight, impact, shrapnel, too-close
  back-off, NTD5's death rule.
  **Verify:** specs: no lob while the target stands outside the Mortar's room (a corridor included); the landing point leads a walking target by exactly `leadTicks` of its last tick's motion and
  never more than `maxLead`; a point on a wall, a pillar or a crate falls back to the target; a target behind a pillar
  is still hit; a standing target is hit at its feet; the shrapnel is erased by a guard and the strike is not; exactly
  one draw per lob.
- **NT3. Mender.** Pick, link, channel, every end rule, flinch, bolt.
  **Verify:** specs: it heals the most wounded ally by ratio and never above `hpMax`; never a boss, the Goldling, a pyre
  or another Mender; a player standing on the beam, a pillar between them or one hit on the Mender ends the channel; a
  healed ally pays its normal kill points once; `damageActor`'s cap buckets and build procs never see a heal.
- **NT4. Jackal.** Circling, separation, the one-at-a-time token, the front-cone rule, wind-up, spook, lunge, recover,
  guard stop, the last-of-the-pack rule.
  **Verify:** specs: a player who keeps facing a Jackal through its wind-up is never hit by it; one who faces away is;
  at most one Jackal per target is ever in wind-up or lunge; a guard into a lunge staggers it and the player takes no
  damage and the parry feed gets one guard entry; a spook draws nothing; a lone Jackal still never lunges from inside
  its target's front cone.
- **NT5. Packs in the spender.** `packOf`, the pricing and cap rule, pack placement.
  **Verify:** floor 1 without a roster spends draw for draw and tile for tile as before (`roomPool.lock.spec`); a room
  with a pack holds three Jackals on neighbouring tiles; a room with 2 or fewer free slots never buys one.
- **NT6. Room pool and roster.** Append the kinds, caps, `needsCompany`, NTD7's minimum floors; re-pin locks; ruleset
  bump; census of floors 1-20 x run seeds 1-60 (kinds per room, room cost, shells and heals per room), like NX6.
  **Verify:** census table written.
- **NT7. View (placeholders).** Shell arc and ring, impact burst, heal tether, pulses and sparks, the Jackal's crouch
  and hop, the stagger, cue rows.
  **Verify:** view specs (the tether only while a channel is live and only to a living ally; a shell's strike never
  plays the lightning look or sound; `enemyBulletLookOf` maps shrapnel small and the bolt medium).
- **NT8. Art.** Three sets in `art/atlases.json` (the NE9 / NX8 recipe: grid 128, body over `Shadows/`, pad 3, 2 px
  rim, per-sheet cells), marks measured on the frames, `bodyTiles` against the knight (the Jackal checked at pack size
  three), the extra animations (`crouch`, `hop`) through the optional enemy animation slots.
  **Verify:** `test:art`, two `art:build`s byte-identical, older outputs unchanged, `vale.spec` cases; upload list.
- **NT9. Strings, first sighting, Codex.** `bestiary.<id>`, l10n context, sightings, the three Codex entries.
  **Verify:** `l10n:check`, `check:autolocalize`, `catalog.spec` green (the lock extended, never reordered).
- **NT10. Audio.** Candidates from Ninja Adventure and Kenney (a bowstring and whistle for the lob, a thump for the
  shell, a low hum for the heal, a snap for the cut, a snarl for the lunge, a yelp for the spook); `audio:audition`,
  `audio:lock`, `audio:build`.
  **Verify:** `audio.lock.json` updated; vale sounds switch on only with every file's id.
- **NT11. Builds and systems pass.** Each kind against builds (Siege Bolt pinning a channelling Mender or a lunging
  Jackal; Riposte's wave through a pack; Overkill streaks), Horde waves (a copied pack, a copied Mender), treasure
  locks (a shell is a hit for UNTOUCHED), the Shieldwall (it covers a Mender; a beam through it), the Chainhook (a
  drag into a ring), the Warbanner (its aura on cooldowns), co-op (one Jackal pack on two players), floor modifiers
  (Blood Moon affixes on a pack).
  **Verify:** a spec per interaction that has a rule; a note per one that does not.
- **NT12. Tuning.** Bot and census runs: room time against par, TTK per kind for Knight and Archer, hits per kind, how
  often a shell lands on a moving bot, heal per Mender life, Jackal hits per pack for a bot that faces its nearest
  enemy versus one that never turns.
  **Verify:** "NT12 tuning (as built)" table; owner calls listed.
- **NT13. Upload and Studio check.** Owner uploads (art, audio); checklist per kind (the ring readable on every biome,
  the lead fair at 4G latency, the tether readable through a crowd, the spook window on a simulated 4G link with
  prediction on, touch auto-target against a pack).
- **NT14. Docs.** CLAUDE.md decision log entry, the doc's "as built" notes, docs/NEW_ENEMIES_2.md cross-link.

## Edge cases

- **Mortar and a standing player.** The lead is zero: the ring is on your feet. Fair, because standing still is the
  thing it punishes.
- **Mortar's lead across a wall.** A lead point inside a wall falls back to your position; a point on floor on the far
  side of a thin wall stays (you were walking into it anyway). NT2 checks a corridor mouth.
- **Two Mortars.** Cap 2 per room; their rings can overlap. NT12 measures the peak.
- **Mender heals a Hulking or Shielded ally.** The heal is hp only; a Shielded ally's shield row is untouched.
- **Two Menders.** Cap 1 per room; across rooms they never see each other's allies (heal range and sight).
- **Mender and the Ooze's slimelets.** They are room members: healable. A 1 hp swarmer is never wounded.
- **Jackal and touch auto-target.** Auto-target faces the nearest enemy, often one Jackal; the other two are then behind
  you. Fine by design; NT13 checks it feels fair on a phone.
- **Jackal in co-op.** It reads its target's **merged** facing, which arrives one input lead late (up to 20 ticks on a
  4G link against a 21-tick wind-up). See Risks.
- **A lone Jackal held off.** A player who keeps facing the last Jackal is never lunged at (NTD10); the room still
  clears when they kill it, and a teammate or the other enemies still pressure them. NT12 checks it does not stall
  rooms for a bot that faces its nearest enemy.
- **Mortar target in a doorway.** The doorway cell belongs to the corridor, not the room, so a player standing in it is
  safe from that Mortar (NTD3). NT2 pins which cells count.
- **Jackal pack split across a doorway.** Separation and circling can push one into a corridor; it keeps circling its
  target there. Leash rules as for every room enemy.
- **A pack where only two fit.** The spender never buys a pack into fewer than three free slots; placement stops early
  only when a room runs out of tiles, as for swarmers.
- **M1 and the tutorial.** No new kind is in their pools; nothing changes.

## Decisions (2026-11-16, Kaleb)

- **NTD1. Ids and band:** `mortar`, `mender`, `jackal`; band 7 (indices 24-26).
- **NTD2. Rigs:** Spawn 6 (Mortar), Imp 10 (Mender), Beast 2 (Jackal); the alternates kept for a swap.
- **NTD3. The Mortar fires without line of sight, but only while its target is in the Mortar's own room;** it never
  leashes for lost sight. (Owner's pick over firing from anywhere.)
- **NTD4. The shell is the Stormcaller's `STRIKE`** (unguardable, no grazes) plus a 6-bullet guardable shrapnel ring.
  No new bullet kind.
- **NTD5. A Mortar killed mid-flight still lands its shell,** on time through a corpse hold like the Vengeful
  affix's, else at once.
- **NTD6. Jackals are bought as one pack of three** (`packOf`), costing 1 each.
- **NTD7. Minimum floors:** none for the Mortar and the Jackal; **floor 2 for the Mender**
  (`ROOM_KIND_MIN_FLOOR`), so the first floor never shows a healer before the player has learned kill order.
- **NTD8. The Mender heals room enemies only:** never a boss, the Goldling, the dummy, a pyre or another Mender.
- **NTD9. A sword guard stops a Jackal's lunge,** staggers it 1.0 s and **counts as a parry** (the `ScoreEvents`
  guard feed: sparks, PARRY!, recap, contribution, haptics). (Owner's pick over a stop that is not a parry.)
- **NTD10. The last Jackal of a pack keeps the back-only rule.** (Owner's pick over lunging from any side.)
- **NTD11. Weights 1 / 1 / 1 appended; caps 2 / 1 / 1 pack;** the existing fifteen weights never change.
- **NTD12. No new bullet art in v1:** shrapnel small, bolt medium, the shell as the strike disc (hazard art later).
- **NTD13. First-sighting toast and Codex entry for all three.**
- **NTD14. Boards stay `_v1`; `DAILY.ruleset` 21 -> 22.**

## Risks

- **The Jackal's facing in co-op.** The sim reads merged facing, one input lead late, while your own knight is drawn
  ahead by local prediction. A turn you see on screen can arrive after the spook window closes. Mitigation: NT13 on a
  simulated 4G link; if it fails, a longer wind-up in party runs (`partyWindupTicks`, from the party size, no draw) or
  a spook cone that also counts the aim input sent this tick. Solo is exact.
- **Parry inflation.** A Jackal stop counts as a parry (NTD9), so parry counts on the recap and contribution screens
  rise in Jackal rooms. Expected; the near-miss director already groups parries per guard, so one guard is one parry.
- **The Mortar off screen.** A shell from a Mortar the camera cannot see is unfair. Mitigation: the ring is drawn whatever
  the camera sees, and NT0 checks the 7-11 keep range against `VIEW_TILES_HIGH` (shorten it if the Mortar would stand
  off screen); NT13 checks portrait framing.
- **Healing stalemates.** A Mender behind a Shieldwall could undo a slow player's damage indefinitely. Mitigation: any
  hit cancels the channel, 1 hp per 0.5 s, 3 s channels with a cooldown, a body block, cap 1 per room; NT12 measures
  heal per life.
- **Pack density.** Three bodies for one buy in a 16-actor cap. Mitigation: a pack is priced 3 and capped at one per
  room; NT6's census shows the actor counts.
- **Roster churn.** Every endless seed's roster reshuffles again and a new daily ruleset starts new day boards.
  Expected.
- **Codex order lock** and the `PORT_AUDIO_EVENTS` tail specs: NT1 / NT9 own them.

## Out of scope (later plans; art noted)

- The rest of the brainstorm: **Ricochet** (Spawn 2, bouncing balls: a new bullet kind), **Javelineer** (Spawn 13,
  spears that stick as short-lived cover), **Glutton** (Beast 4, `Eat`: eats corpses to heal and grow), **Lurker**
  (Spawn 12, crouched ambusher), **Wyrm** (Beast 5, sweeping flame).
- Champions or a third boss on the five unused Elites: **Warlord** (Elite 4, `Point`: marks a player for the room),
  **Duelist** (Elite 5, counters your swing), **Twinblade** (Elite 1, after-images).
- Hazard art for the shell (NTD12); a Jackal stop counting toward Riposte or Bastion's brace.
