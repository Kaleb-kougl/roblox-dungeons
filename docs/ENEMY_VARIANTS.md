# Enemy variants: plan

Endless floors buy only three room enemies today (swarmer 3 / sniper 2 / bruiser 1, `ENDLESS_ROOM_KINDS`), so floor 20
fights like floor 2 with more hp. This plan adds **three new archetypes** that fill the roster's gaps (a flanker, a
zone-denier, a support) and **elite affixes**: one-rule modifiers (Hulking, Swift, Shielded, Vengeful) that ride on any
room enemy. Both **unlock by depth**, so each stretch of an endless run meets something new. Work it task by task, like
`PLAN.md`; each task ends with a **Verify**.

This is **gameplay**: the archetypes and affixes live in the sim, replay, validate on the server and step in lockstep.
It follows the established patterns: new archetypes take a new registry band (no web index moves), new kinds join the
room pool only from their unlock floor (floors before it spend exactly as today), and affixes are opt-in
`SimConfig.affixes` with their own `state.affixes`, their own rng stream on the dungeon side and their own hash group
appended last. M1 (`KALEB_VALE_MVP_PARAMS`), every golden fixture and the tutorial replay exactly as before.

## Status (2026-10-30)

Planned. Owner answers taken (below, "Decisions"); recommended defaults EVD1-EVD12 are open until the task in
brackets. Nothing built. Respite (docs/DIFFICULTY.md) is planned, not built: whichever lands second hooks into the
other's choke points (see "Respite").

## What the code gives us (read on `main` @ `3900250`)

| Fact | Where | Consequence |
|---|---|---|
| Kinds number by (`ArchetypeDef.band`, then `compareIds`); web 0..6, `dummy` band 1 (7), `boss.demonlord` band 2 (8) | `combat/actors/registry.ts` | New archetypes take **band 3** (`PORT_BAND_ENEMIES`): `imp` 9, `slime` 10, `slime.small` 11, `summoner` 12 (`compareIds`: a prefix sorts first). No recorded index moves |
| `spendEncounterBudget` walks `ENDLESS_ROOM_KINDS` in order, skips unaffordable kinds, one `rng.next()` per weighted pick | `dungeon/endless.ts` | A kind filtered out by `fromFloor` changes neither the totals nor the walk: **floors below every unlock spend draw for draw as today**. Existing weights must not change (that would move floor 1) |
| Only `buildEndlessFloor` calls `endlessRoomSpawns`; M1 uses the web `planRoom` (`enemyRooms.ts`) | `dungeon/endless.ts`, `enemyRooms.ts` | M1 and the fixtures never see the new kinds. EV0 confirms the tutorial's rooms never reach the spender at an unlock floor |
| Elite rooms exist (`ELITE_BUDGET_MULTIPLIER` 1.5) and the view already draws an elite health plate (`enemyHealthElite`) for actors spawned in one; "there is no elite flag in the sim" | `endlessData.ts`, `view/fx/events.ts`, `view/fx/bars.ts` | Affixes have a natural home and a look to extend. The view's elite test becomes "elite room OR affixed" |
| Every runtime spawn goes through `ctx.spawnActor`; `summonAdds` / `summonedAlive` (boss/shared.ts) push adds out with `moveActor`, set home and `engage` them | `combat/actors/actors.ts`, `boss/shared.ts` | The slime split and the summoner reuse the same shape of code. The pool is `MAX_ACTORS` 64; a full pool drops the spawn and counts `actorsDropped` |
| A room's score record fixes its members at room spawn (`attachScoreRoomMembers` -> `memberSlots` / `memberIds`); `scoreRoomDown` = every member dead | `score/score.ts` | **Runtime children are not members**: a room would CLEAR (stamp, room edges go safe) with slimelets or summons still alive. Needs `adoptScoreRoomMember(state, parent, child)` |
| Room enemies walk with `d.speed * SIM_DT` read at 4 sites (swarmer, sniper, bruiser, `stepCalm`); cooldowns are one `ctx.randomInt(min, max)` each | `archetypes/*.ts` | Swift needs one `walkStep(ctx, a)` helper and one `enemyCooldown(ctx, a, min, max)` helper (the SAME single draw, then scaled). Respite plans the same cooldown helper |
| Telegraphs all start through `ctx.telegraph`; render hints are `ActorFxHints` (`aimLine`, `shockwave`) | `combat/ctx.ts`, `enemyShared.ts` | One new hint, `ring` (a floor circle at v-slot coordinates), covers the imp's landing spot and the summoner's circle |
| `BurstSpec` has `speed`, `life`, `radius`, `scale` (render only); every enemy bullet is drawn with ONE look (`BULLET_VIEW.enemyVisualId`) | `combat/patterns.ts`, `BulletRenderController.ts` | Goo puddles are stationary bullets (speed 0, short life, larger radius): no new bullet system and no new bullet look |
| A new burst shape a port-only archetype fires is a row in `combat/arcTablePort.ts` | CLAUDE.md conventions | The imp's 5-bullet fan (and any summoner shape not already in the table) are port rows |
| `CORPSE_TICKS` 30 (0.5 s); `freeActor` releases the emitter; in-flight bullets keep flying | `combatData.ts`, `actors.ts` | Vengeful's 0.6 s corpse telegraph needs the corpse held a little longer (one check in `stepActors`) |
| `ENEMY_ARCHETYPES` already lists `summoner` (web contract: placeholder `#5a8a4a` cylinder, name "Summoner"), no sim archetype uses it | `theme/contract.ts`, placeholder manifest | The support enemy fills the existing slot; only `imp` and `slime` are new contract entries |
| Placeholders get ONE Highlight under `KV_Actors/Enemies` (engine cap 31) | docs/OUTLINE.md | Affix colour cannot be a per-actor Highlight: it is a floor ring (both renderers) plus the sprite rim's tint |
| `KILL_POINTS`, `DROPS.chanceByArchetype`, `ENCOUNTER_COST` are per-id maps with defaults | `scoreData.ts`, `dropsData.ts`, `encounterCost.ts` | Data rows per new id; no code |
| Art on hand: LoP **slime** (16 facings, idle 1 / walk 8 / death 7 frames, 256 px cells) unused; Demons pack **31 unused rigs** (Imps 1-10, Spawns, Beasts, Elites; 8 facings, 20-23 animations each) | `art/vendor/` | Slime through the LoP pipeline (like the swarmer's skeleton); imp and summoner through the per-sheet Demons pipeline (like the bruiser) |

## Player experience

1. **Floors 1-2 are today's game.** Swarmers, snipers, bruisers.
2. **Floor 3: Imps.** A small demon that hangs back, then crouches and a ring lights up on the floor beside you. It
   blinks into the ring and, a beat later, fires a short fan at you. Lesson: you can always see where it lands; move off
   the ring's line.
3. **Floor 4: the first Champions.** Elite rooms now hold enemies with an affix: a coloured ring under them and a name
   on their health bar ("Swift"). Hulking ones are big and tanky, Swift ones walk fast and attack more often.
4. **Floor 6 (after the first boss): Oozes.** A slow slime that leaves a trail of goo (bullets that sit still and fade
   after 3 s) and bursts into two fast slimelets when it dies. Lesson: kite it where you won't need to walk back.
5. **Floor 7-9: Shielded and Vengeful champions; Summoners.** A Summoner keeps its distance and, under a glowing circle,
   calls swarmers to its side; kill it and its summons wither. Vengeful champions pulse when they die and burst into a
   gapped ring.
6. **Floor 11+:** a champion can turn up in any combat room, not only elite rooms.
7. **First sighting** (EVD10): the first time an account meets each new enemy or affix, a one-line toast names it and
   its tell ("Imp: watch the ring").

## Design

### New archetypes (band 3, `PORT_BAND_ENEMIES`)

All three are room enemies (`RoomEnemyData`, `stepCalm` / leash / pack alerts) and use `ctx.telegraph` for every
attack. Numbers are starting values, tuned in EV13.

| | **Imp** (`imp`) - flanker | **Ooze** (`slime`) - zone-denier | **Summoner** (`summoner`) - support |
|---|---|---|---|
| Gap it fills | Nothing today relocates; snipers kite slowly | Nothing denies floor over time | Nothing makes you pick a target |
| Body | 3 hp, r 0.35, 3.2 u/s, no contact damage | 8 hp, r 0.55, 1.6 u/s, contact HIT_NORMAL | 6 hp, r 0.4, 1.8 u/s, no contact damage |
| Engaged | Keeps 4-7 units (the sniper's approach / back off / strafe) | Crawls at the player | Keeps 6-9 units, prefers to break line of sight |
| Attack | Every 2.4-3.2 s: **blink**. Telegraph 0.5 s: a `ring` on the floor at the destination (the player's bearing turned ~90 degrees either way with the Pythagorean rotations the bruiser uses, 5 units from the player). On the tick it lands it snaps there (prev = new position, no streak), then a 0.35 s aim telegraph and a **5-bullet fan** (~40 degrees, slow) at the player | **Goo trail**: every 0.5 s while moving, one stationary bullet (speed 0, life 3 s, radius ~0.4) at its trailing edge; at most 6 alive by construction | **Summon**: every 4.5-5.5 s, telegraph 1.0 s (`ring` at its feet), 2 swarmers burst out (`summonAdds` shape), at most 3 of its summons alive, at most 6 per life. **Panic**: player within 3 units -> 0.5 s telegraph, a gapped ring (the bruiser's ring spec) and it backs off |
| Death | - | **Splits** into 2 `slime.small` (3 hp, r 0.35, 2.6 u/s, contact HIT_NORMAL, no trail, never splits, drawn 0.6x from `enemy.slime`), pushed out sideways, engaged, adopted into the parent's room | Its live summons **wither** (die with it, like a boss's adds) |
| Counterplay | Read the ring, step off its line, punish the landing | Choose where to fight; the sword guard erases goo | Dive it; summons stop when it dies |
| v[] budget (0-2 shared) | 3-4 destination, 5-6 aim dir, 7 strafe sign | 3 trail timer, 4-5 last facing | 3 summons left, 4-6 summon ids, 7 strafe sign |
| Cost / points / drop % | 2 / 120 / 6 | 3 / 150 / 8 (small: - / 40 / 2) | 3 / 200 / 10 |
| Unlock / weight (EVD2) | floor 3 / 2 | floor 6 / 1 | floor 8 / 1, **at most 1 per room** |
| Art | Demons **Imp** rig (owner picks from the EV0 contact sheet; Roll / Crouch / Attack read as the blink) | LoP **slime** (idle, walk, death; hit = flash only) | Demons robed **Spawn** rig other than 8 / 11 (those are the turrets) |

Blink safety: the destination must be a floor cell (`ctx.isBlocked` false, no breakable), inside the imp's own room,
in line of sight of the player and at least `SPAWN_SAFE_RADIUS` from every living player; it tries the two sides and
two distances (no rng beyond the side pick) and, if none is valid, skips the blink and strafes instead (the cooldown is
drawn the same either way, so the draw count never depends on the layout).

### Elite affixes

One affix per enemy in v1. Never on bosses, turrets, the dummy, `slime.small` or any runtime spawn (summons, splits,
boss adds): only planned room spawns get one.

| Affix | Rule (sim) | Tell (view) | Unlock |
|---|---|---|---|
| **Hulking** | hp x175 %, radius x120 % (at stamp time), walk x85 % | drawn 1.2x, ring `affix.hulking` | floor 4 |
| **Swift** | walk x135 %, attack cooldowns x75 %; **telegraphs never shorten** (EVD9) | ring `affix.swift`, a faint afterimage while walking (FEEL's ghosts) | floor 4 |
| **Shielded** | a shield of 40 % of its hp absorbs damage first; refills fully after 5 s without damage | ring `affix.shielded`, a shield segment on the health bar (`enemyShield`), shield hits flash in the shield colour, `sfx.affix.shieldBreak` | floor 7 |
| **Vengeful** | on death the corpse telegraphs 0.6 s, then fires a gapped ring (the bruiser's ring, gap toward the nearest living player turned like the bruiser's) | ring `affix.vengeful`, the corpse pulses in `telegraph`, `sfx.affix.vengeful` | floor 9 |

Where (EVD7): elite rooms from floor 4, 35 % of a room's members (rounded up, at least 1) get an affix; combat rooms
from floor 11, each member 10 %. The pick (who and which affix, among the unlocked ones) is drawn from the affix
stream `new EncounterRng(floorSeed ^ AFFIX.salt)` (as the boss pick does), room by room in id order, member by member in spawn order.

Rewards (EVD8): an affixed kill scores +50 % (through `scoreKill`'s bonus percent), rolls drops with +4 points of
chance, and each affixed member adds `AFFIX_PAR_COST` to its room's par time.

## Architecture

### 1. Sim: archetypes (`combat/actors/archetypes/`)

- `imp.ts`, `slime.ts` (registers `slime` and `slime.small`), `summoner.ts`, each one file, imported by the archetypes
  index; `PORT_BAND_ENEMIES = 3` in `registry.ts`.
- `helpers.ts`: `walkStep(ctx, a)` (today `d.speed * SIM_DT`; Swift / Hulking scale it when `state.affixes` exists) and
  `enemyCooldown(ctx, a, min, max)` (one `ctx.randomInt`, then the Swift percent through `scaleTicks`; Respite's lever
  joins here). The four existing `d.speed * SIM_DT` sites and every room enemy cooldown move to them: a pure refactor
  outside affixed runs.
- `enemyShared.ts`: `ActorFxHints.ring` (`{ state, xSlot, zSlot, radius }`, drawn while `aiState === state`).
- `score/score.ts`: `adoptScoreRoomMember(state, parent, child)`: the child joins the record that holds the parent's
  slot, unless that room is already cleared. Called by the split and by the summoner (never by bosses: their adds stay
  outside room records, as today).
- Data rows: `ENCOUNTER_COST`, `KILL_POINTS`, `DROPS.chanceByArchetype` for every new id.

### 2. Dungeon: room pool and affix assignment (`shared/dungeon`)

- `EndlessRoomKind` gains optional `fromFloor` and `maxPerRoom`. `spendEncounterBudget(rng, budget, cap, floor)` skips
  a kind below its floor or at its room maximum, in BOTH loops. New kinds are appended after bruiser; existing weights
  unchanged.
- `assignAffixes(floorSeed, floor, rooms, roomSpawns)` after the Forge, from its own stream (salt chosen in EV6), output
  `roomAffixes: number[][]` (affix id per planned spawn, 0 none) on `EndlessFloorLayout` / `EndlessFloorWorld`, like
  the breakables. Layouts, digests, props, room spawns, breakables and the boss pick do not move.
- `AFFIXES` tunables in `affixesData.ts` (unlock floors, shares, salt).

### 3. Sim: affixes (`shared/sim/affixes/`, opt-in)

- `SimConfig.affixes` (`AFFIXES_CONFIG` on endless worlds; absent in M1, fixtures and the tutorial).
- `state.affixes`: per actor slot `affix`, `actorId` (stale-slot guard), `shield`, `shieldIdleTicks`, `vengeTicks`;
  slots grow with the actor pool and clear in `freeActor`. Its own hash group **`affixes`, appended last** (after
  `drops`, or after `respite` if that lands first); `hashLayout.ts` names it.
- Hooks, each a no-op without `state.affixes`: stamping in `enterRoom` after `spawnAll` (spawn index -> affix; Hulking
  hp / radius here); `damageActor` (Shielded absorbs after `filterDamage`, before the cap); `killActor` (arm Vengeful;
  score / drop bonus); `stepActors` (a Vengeful corpse is not freed while `vengeTicks > 0`); `stepAffixes` after the
  actor phase (shield refill, Vengeful countdown and fire through `ctx.fireEnemy` from the corpse).

### 4. Worlds, server, lockstep

The server builds the SimConfig itself from `StartRunRequest`; endless worlds gain `affixes` there, and floors carry
`roomAffixes` because they are built by the same pure `buildEndlessFloor` on every machine. No new request field, no
new lockstep message. Leaderboards stay on `_v1` (EVD11).

### 5. Theme contract

- `ENEMY_ARCHETYPES` += `imp`, `slime` (every pack fills `enemy.imp` / `enemy.slime` and `.name`; placeholders: a small
  cone and a low dome).
- Colour roles `AFFIX_ROLES` (`affix.hulking` / `.swift` / `.shielded` / `.vengeful`) and `enemyShield`, validated by an
  `affixReport`: >= 3:1 on every biome floor, >= 40 CIE76 from `ENEMY_BULLET_ROLES`, `telegraph` and `enemyOutline`.
- Strings: `enemy.imp.name`, `enemy.slime.name`, `affix.<id>.name`, the first-sighting lines (`AFFIX_STRING_KEYS`,
  `BESTIARY_STRING_KEYS`).
- Port audio IDs (SILENT in the placeholder): `sfx.enemy.blink`, `sfx.enemy.summon`, `sfx.enemy.split`,
  `sfx.affix.shieldBreak`, `sfx.affix.vengeful`.
- `contract.luau` sits at Luau's 200-locals limit: every new list goes inside an existing array or a function, and EV1
  checks it compiles under Lune.

### 6. View and client

- `ACTOR_SPRITE_INPUTS` builders `impSpriteInput` (blink = crouch segment, landing = roll / attack), `slimeSpriteInput`
  (`slime.small` reads `spriteScale`), `summonerSpriteInput` (summon = a cast segment; panic = attack).
- Markings: the `ring` hint (telegraph colour, filling like the existing telegraph bars).
- Affixes: a floor ring under the actor (one per affixed actor, pooled; never a Highlight), the sprite rim's tint, the
  name chip and shield segment on the health bar, the elite plate when affixed, Vengeful's corpse pulse.
- Every timing the view predicts (telegraph fill, attack animation stretch) reads the same helpers the sim uses, so
  Swift and Respite never draw a bar that fills early.

### Respite

If Respite is built first, `enemyCooldown` already exists and Swift adds its percent with `combinedPercent`; hp levers
multiply after Hulking. If this plan lands first, Respite's RS0 list gains these helpers and the new archetypes. Either
way new archetypes use only the shared choke points (`ctx.telegraph`, `enemyCooldown`, `walkStep`, `ctx.fireEnemy`).

## Tasks

- **EV0. Audit and contact sheets.** Read-only: confirm the tutorial never calls the spender at floor >= 3; list every
  `d.speed` and cooldown read (sim and view); list the arc shapes needed (imp fan, anything the summoner fires that the
  table lacks); confirm `CORPSE_TICKS` and corpse handling in the view. Build contact sheets for Imp 1-10, the robed
  Spawns and the LoP slime (`art/build/contact/`). **Verify:** the findings and the owner's rig picks are written into
  this doc.
- **EV1. Scaffolding.** `PORT_BAND_ENEMIES`; `walkStep` / `enemyCooldown` refactor; `ActorFxHints.ring`;
  `adoptScoreRoomMember`; theme contract entries with placeholder values (vale falls back to placeholders until art);
  data rows. **Verify:** `npm run verify`; every golden fixture, M1 and the tutorial lock specs match bit for bit;
  `archetypeIds()` keeps indices 0-8; `contract.luau` compiles under Lune.
- **EV2. Imp.** Archetype, blink safety, the fan's `arcTablePort` row. **Verify:** specs: the ring is shown >= 0.5 s
  before every blink; a blink never lands in a wall, a breakable, another room or inside `SPAWN_SAFE_RADIUS`; no valid
  spot -> no blink, same draw count; determinism spec (two runs, same hashes).
- **EV3. Ooze.** `slime`, `slime.small`, the goo trail, the split and its adoption. **Verify:** specs: at most 6 goo
  alive per slime; the split spawns 2 (1 or 0 when the pool is full, `actorsDropped` counts the rest); smalls never
  split; the room does not CLEAR until both smalls die; a guard erases goo.
- **EV4. Summoner.** Summon, caps, wither, panic ring, adoption. **Verify:** specs: never more than 3 summons alive or
  6 per life; summons wither on its death; the room clears only when summons are dead; a full pool drops summons
  cleanly.
- **EV5. Room pool.** `fromFloor` / `maxPerRoom` in the spender; the new kinds appended. **Verify:** a lock spec built
  BEFORE the change (spender output for floors 1-2, seeds 1-200, solo and party 2-4) still matches after it; no kind
  before its floor; at most one summoner per room; a census table (floors 1-20 x run seeds 1-60: mean enemies per room
  by kind, budget spent) recorded here.
- **EV6. Affix assignment (dungeon).** `assignAffixes`, `roomAffixes`, `AFFIXES` data. **Verify:** layouts, digests,
  room spawns, breakables and boss picks identical with and without; affixes never on excluded kinds or below their
  unlock floor; the elite / combat shares hold over the census.
- **EV7. Affixes (sim).** `SimConfig.affixes`, `state.affixes`, the hash group, the four rules, score / drop / par
  bonuses, the corpse hold. **Verify:** one spec per affix (Hulking hp and radius; Swift walk and cooldown but equal
  telegraph ticks; Shielded absorb and refill; Vengeful telegraph >= 0.6 s, then exactly one ring); without
  `affixes` the hash layout is unchanged; recording round trip and server validation of an affixed endless run.
- **EV8. Theme and validators.** Final colour roles, `affixReport`, strings, audio IDs, vale values. **Verify:** the
  theme validator passes for placeholder and vale; the report prints every pair it checks.
- **EV9. View.** Sprite inputs, `ring` markings, blink snap and puff, affix rings / chips / shield segment / elite
  plate / corpse pulse, first-sighting toast plumbing. **Verify:** pure view specs (sprite input per state, ring fill
  timing equals the sim's telegraph, affix chip text); no Highlight added.
- **EV10. Art.** Slime set (LoP pipeline, 16 facings), imp and summoner sets (per-sheet Demons pipeline + rims),
  measured budgets in this doc, `npm run art:build`, upload, ids in `assetIds.ts`. **Verify:** `npm run test:art`;
  the contact sheets signed off by the owner; texture counts within the budget table.
- **EV11. Audio.** The five port IDs from the Ninja Adventure pack (`art/audio.json`), `audio:build`, upload.
  **Verify:** `audio:audition` by the owner; silent fallback while ids are missing.
- **EV12. First sighting.** Per-account seen flags in `KV_Onboarding_v1` (codec bump in `shared/onboarding`), one toast
  per archetype / affix. **Verify:** codec specs (old docs read as "nothing seen"); a co-op party member who has seen
  it gets no toast.
- **EV13. Tuning.** TTK table per new archetype and affix vs the sword and the bow (like `bossAct1.ttk.spec.ts`), the
  EV5 census re-run with affixes, actor-pool high-water mark per floor (target < 48 of 64). **Verify:** the tables in
  this doc; no floor in the census drops a spawn.
- **EV14. Studio check and docs.** The checks in docs/CLIENT.md (readability next to bullets, mobile frame time on the
  densest census room), CLAUDE.md decision log entry, `THIRD_PARTY_NOTICES.md` (LoP slime and the new Demons rigs are
  already covered; list them). No PROVENANCE row (no web source). **Verify:** owner sign-off.

## Edge cases

- **Co-op.** Each actor already targets the nearest living player; blink safety checks every living player; the party
  budget can buy more imps and oozes but never a second summoner in a room.
- **Pool pressure.** A floor-20 party room (16 bought) plus splits and summons can approach 64: spawns past the pool
  are dropped and counted, never an error; EV13 measures the high-water mark.
- **Last kill is Vengeful.** The room CLEARs on the kill (room clear celebration, PERFECT judged then); the ring still
  fires 0.6 s later. A hit from it does not revoke PERFECT (score already awarded) - accepted, noted in docs/ROOM_CLEAR.md.
- **Floor change with goo or a pending Vengeful ring.** Bullets and corpses clear with the floor, as today.
- **Leash.** Summons and smalls take their spawn point as home; a summoner leashing home keeps its summons engaged.
- **Withering vs. scoring.** Withered summons score and roll drops like a boss's withered adds (bounded: 6 per
  summoner life).
- **Stage cover / tutorial / M1.** No new kind or affix can appear; the tutorial lock spec is the check.

## Decisions (2026-10-30, Kaleb)

- **Both:** new archetypes and elite affixes.
- **Unlock by depth:** floors 1-2 stay today's roster; new kinds and affixes join at set floors.
- **Three new archetypes** in v1: flanker, zone-denier, support.
- **Art:** the Lords of Pain slime plus the 2D Demons pack.

## Recommended defaults (confirm or change before the task in brackets)

- **EVD1. Roster and ids** [EV1]: `imp`, `slime` (+ `slime.small`), `summoner` (fills the existing `enemy.summoner`
  slot), band 3. The slime is the zone-denier because its trail and split need no attack animation, which it lacks.
- **EVD2. Unlock floors 3 / 6 / 8, weights 2 / 1 / 1 appended** [EV5]. The existing 3 / 2 / 1 never change.
- **EVD3. Summoner limits** [EV4]: 1 per room, 2 per cast, 3 alive, 6 per life, summons wither on its death.
- **EVD4. One split generation, 2 slimelets** [EV3].
- **EVD5. Goo is an ordinary enemy bullet** [EV3]: same look, larger and stationary. Alternative: a flat floor decal
  look (needs a second bullet pool in the renderer).
- **EVD6. Four affixes, one per enemy** [EV6]: Hulking, Swift (floor 4), Shielded (7), Vengeful (9). Two affixes on one
  enemy is a later plan.
- **EVD7. Where** [EV6]: elite rooms from floor 4 (35 %, at least 1), combat rooms from floor 11 (10 % each).
- **EVD8. Rewards** [EV7]: +50 % kill points, +4 points of drop chance, `AFFIX_PAR_COST` = 2 per affixed member.
- **EVD9. Swift never shortens a telegraph** [EV7]. Readability beats difficulty.
- **EVD10. First-sighting toast, once per account** [EV12].
- **EVD11. Leaderboards stay on `LB_Solo_v1` / `LB_Coop_v1`** [EV7], as with the earlier endless changes (breakables,
  the Demon Lord, the combo window).
- **EVD12. Affix colour is a floor ring plus the sprite rim's tint, never a Highlight** [EV9].

## Risks

- **Clutter.** Goo, fans and gapped rings on top of today's patterns. Mitigation: goo uses the one enemy bullet look,
  the trail cap, EV14's readability check; EVD5 has a decal fallback.
- **Summoner frustration.** Hiding plus adds can drag a room. Mitigation: the caps, the wither, the panic ring that
  ends with it backing off into the open; EV13 measures room times against par.
- **Endless replays and scores change** from floor 3 (kinds) and from tick 0 in hash terms (the `affixes` group
  exists on every endless run). Expected; fixtures and M1 do not move.
- **View drift.** A view read of raw archetype timings shows a wrong bar under Swift. EV0's list and EV9's timing spec.
- **`contract.luau` locals limit.** EV1 compiles it under Lune before anything else lands.
- **Mobile frame time** with more bullets and actors. EV14 checks the densest census room on a device.

## Out of scope

- New bosses or boss affixes; affixes in M1 or the tutorial.
- Biome-specific rosters (a later plan could filter `ENDLESS_ROOM_KINDS` by biome band as well as floor).
- Changing the existing three archetypes' behaviour or weights.
- Two affixes on one enemy, affix synergies, a bestiary screen.
