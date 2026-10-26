# Temporary boosts from kills: plan

Killed enemies sometimes **drop a boost**: a pickup on the floor that, walked over, gives the player a **short stat
boost** (more damage, faster walk, faster attacks, or a spare armor pip). It lies there for a few seconds, then fades.
Work it task by task, like `PLAN.md` and `docs/SPECTATE.md`; each task ends with a **Verify**.

Unlike spectating, this is **gameplay**: drops, pickups and boost timers live in the sim, so they replay, validate on
the server and step in lockstep like everything else. It follows the breakables pattern (docs/DECOR.md D4): opt-in
`SimConfig.drops`, its own `SimState.drops`, its own hash group appended last, and its **own rng stream**, so no
existing draw (boon offers, relics, curses, archetype rolls) moves. Without `SimConfig.drops` nothing changes: M1
(`KALEB_VALE_MVP_PARAMS`) and every golden fixture replay exactly as before.

## Status (2026-10-26)

Code-complete except art: B0-B5, B9 and B10 built and headless-tested; B6 / B7 (world view, HUD, audio) written,
typechecked and linted, but their Verify needs Studio (smoke list in docs/CLIENT.md). Open: B8 (vale art and audio:
the Ninja Adventure Items folder is not vendored yet; everything draws as placeholders and the four sounds are silent)
and B11 (playtest). See "As built (B0-B3)", "As built (B4, B9)" and "As built (B5-B7, review)". Owner decisions are
under "Decisions"; P1-P8 were accepted as recommended, P5 narrowed (below).

## What the code gives us (checked against `main` @ `8327a27`; B0 re-checked on `boosts`, notes in the last column)

| Fact | Where | Consequence |
|---|---|---|
| Every kill goes through `killActor(ctx, a)`, which already calls `scoreKill` and `runOnKill` with the killer (`ctx.playerIndex`) and knows whether the archetype revives (`def.stepDead !== undefined`) | `shared/sim/combat/actors/actors.ts` | One more hook, `dropsOnKill(ctx, a, reviving)`, before `onDeath`. Kill order is deterministic, so the roll order is too |
| The sim has ONE rng (`state.rngState`); progression draws from it (`rngInt(state, ...)`) | `state.ts`, `progression/progression.ts` | Drops must NOT draw from it, or every later boon / relic / curse / archetype draw shifts. `DropsState.rngState`: its own mulberry32 stream, seeded `seedToState(seed ^ DROPS.salt)` in `createSimState` |
| Hash groups are appended in a fixed order, each only when present; `breakables` is last | `hashLayout.ts`, sim README | A new `drops` group after `breakables`. Absent state = today's hash exactly |
| Personal modifiers are read through `runMods.ts` helpers that take a player index: `playerHitDamage` (Sharpened, integer percent), `attackTicks` (Swift Strikes, `scaleTicks` round-half-up), and guard the neutral path to return the input unchanged | `progression/runMods.ts` | Fury and Frenzy plug into these two helpers. Boosts change every tick, so they are NOT folded into the cached `RunMods`; a leaf `drops/boostMods.ts` is read beside it |
| Walking is `WALK_STEP` (0.1 / tick) x flask x `weaponMoveMultiplier`, and the move resolver contract is sub-steps of at most `MAX_MOVE_STEP` (0.1): a walk tick is exactly one call, a roll dash tick two | `player.ts`, `playerData.ts` | Quickstep (x 1.3 = 0.13 / tick) must split the walk into two equal sub-steps when it exceeds `MAX_MOVE_STEP`, as the roll already does. The roll itself is untouched. **B0:** `movePlayer` already splits ANY move into `ceil(len / MAX_MOVE_STEP)` equal sub-steps (a walk of up to `STEP_TOLERANCE` stays one call), so Quickstep only scales the walk length; movePlayer is unchanged |
| `damagePlayer` takes armor before hearts; the tutorial's harmless branch runs first; Second Wind runs at 0 hearts | `player.ts` | Aegis is a separate pip in `DropsState` (adding a field to `PlayerState` would change the `player` hash group, i.e. every fixture), consumed before armor, after the harmless branch |
| `step` / `stepParty` return early while a boon draft is open (the world is frozen) | `step.ts` | Boost and ground timers freeze during drafts for free, if `stepDrops` sits inside the normal tick. **B0:** `state.tick` still advances on frozen ticks, so a ground drop's life is a hashed countdown (`ticksLeft`), not `tick - spawnTick` (`spawnTick` stays, for the landing pop) |
| `ctx.roomAt(x, z)` gives the encounter room; boss rooms are tagged; Mother Bramble's slam summons swarmers with `ctx.spawnActor` inside the boss room | `combat/ctx.ts`, `boss/act1.ts` | "No drops from kills in the boss room" excludes summons and the boss in one rule, with no new actor field (which would change the combat hash). **B0:** confirmed: `EncounterRoom.type === "boss"` and `encounter.bossRoom`; `summon` spawns each swarmer on the boss's centre and pushes it `SUMMON_RADIUS` out through `moveActor` (walls stop it), and the fight seals every player in, so summons die inside the room. The rule also checks `data.boss` (a boss outside its room) |
| Turrets revive (`stepDead`); Vampire Fang already refuses to count them | `runOnKill` | The same rule: reviving archetypes never roll |
| The tutorial's floors are endless floors with fixed seeds and a scripted room chain; its world has a lock spec; its funnel steps are numbered 1..15 for telemetry | `shared/run/tutorial.ts`, `shared/tutorial/steps.ts`, docs/TUTORIAL.md | The tutorial gets `SimConfig.drops` with a guaranteed drop in one room (no randomness in a lesson) and a callout, not a new funnel step (P8). **B0:** confirmed: the tutorial config has `endless`, so `state.run` exists; combat B is room id 2 on floor 1 (`TUTORIAL_ROOMS`, three swarmers, deferred). "The last kill in that room" needs membership (swarmers chase into corridors, so position is not enough): `dropsOnRoomSpawned` in `enterRoom` records the spawned actor ids as a hashed guard |
| Debug actions that change the sim are port input bits (`DEBUG_FLOOR_BUTTON`, key N under `KV_Debug`), so they replay | `endlessData.ts`, docs/CLIENT.md controls | A `DEBUG_DROP_BUTTON` bit (KV_Debug only) spawns a chosen boost at the player for Studio testing. **B0:** taken bits: 1..4096 (web), 8192 `DEBUG_FLOOR_BUTTON`, 16384 `PARTY_LEFT_BUTTON` = `FORFEIT_BUTTON`. `DEBUG_DROP_BUTTON` = **32768**, in `PORT_BUTTONS` (`SIM_BUTTONS` 49151, `RECORDED_BUTTONS` 65535; the lockstep wire's raw u16 holds it; the relay strips it and `validate.ts` flags it with the other debug bits). Free key: **M** (not bound or reserved; B6 adds it to `FIXED_INPUTS` / `RESERVED_KBM_INPUTS`) |
| Pickups by position already exist: the relic pedestal, first living player in index order within `PEDESTAL_RADIUS` | `progression.ts` `stepRun` step 4 | Same rule and the same `within` helper for drops. **B0:** `within` is private to progression.ts; drops.ts has its own copy |
| (B0) A player dies through `killPlayerState` in three places: `damagePlayer`, `forfeitSoloRun`, `markPlayerLeft` | `player.ts`, `step.ts`, `party.ts` | Each calls `boostsOnPlayerDied` (boostMods.ts, a leaf) |
| (B0, P9) Leaderboards: `shared/leaderboard/config.ts` names `LB_Solo_v1` / `LB_Coop_v1` | `shared/leaderboard` | Whether they are live is the owner's call at B4 |

## Player experience

1. **A kill drops something.** Sometimes (about 1 kill in 15, P2) the enemy leaves a small glowing gem where it died,
   coloured and iconed by kind, with a pop and a sound. It bobs gently (reduced motion: still).
2. **Walk over it** and it is yours: a burst, a sound, a toast (`Fury: +50% damage for 10 s`), a coloured aura on your
   character, and an icon with a draining bar in the HUD's boost row.
3. **It fades.** A drop left on the floor blinks for its last 2 s and vanishes after 10 s (P3).
4. **It runs out.** The icon's bar drains; at 2 s left it blinks; then it ends with a soft sound and the aura goes.
5. **Picking up one you already have** refreshes its timer to full (one of each kind at a time).
6. **Co-op:** the first living player to touch it gets it; only they are boosted. Teammates see the drop, the pickup
   burst and the picker's aura, so contested drops read clearly.
7. **Dying** ends your boosts. **Floor change:** drops still on the floor are gone; your running boosts keep
   counting (they are short). **Drafts** freeze everything, timers included.

### The boosts (v1)

| Boost | Effect | Lasts | Stacks with | Notes |
|---|---|---|---|---|
| **Fury** | player damage (bullets and melee) x **150 %** when it hits | 10 s | Sharpened (x 125 % then x 150 %) | Also scales Mirror Cloak and Ember Wake bullets (they go through `playerHitDamage`) |
| **Quickstep** | walk speed x **130 %** | 10 s | flask slow, bow-charge slow (multiplied) | Roll distance and i-frames unchanged (rolls are tuned against gaps and bullets) |
| **Frenzy** | sword swing / finisher recovery and the bow's stream cooldown x **70 %** | 10 s | Swift Strikes (one combined integer percent: 80 x 70 / 100 = 56 %) | Wind-ups and the lunge are unchanged, like Swift Strikes |
| **Aegis** | **+1 armor pip** over your maximum, taken before armor and hearts | 15 s or until it absorbs a hit | Warding (it never refills Aegis) | Shown as a distinct pip in the armor row |

All magnitudes and durations are tunables in `drops/dropsData.ts`, never inline.

## Architecture

### 1. Sim: `shared/sim/drops/` (opt-in, deterministic)

**`dropsData.ts`** (tunables; index tables APPEND ONLY, their indices are stored and hashed):

```ts
export const Boost = { FURY: 0, QUICKSTEP: 1, FRENZY: 2, AEGIS: 3 } as const;
export const BOOSTS: ReadonlyArray<BoostDef> = [
	{ id: "boost.fury", weight: 3, seconds: 10 },
	{ id: "boost.quickstep", weight: 3, seconds: 10 },
	{ id: "boost.frenzy", weight: 3, seconds: 10 },
	{ id: "boost.aegis", weight: 2, seconds: 15 },
];
export const FURY_DAMAGE_PERCENT = 150;
export const QUICKSTEP_WALK_PERCENT = 130;
export const FRENZY_ATTACK_TICKS_PERCENT = 70;
export const AEGIS_PIPS = 1;
export const DROPS = {
	salt: 0x4b56_4452,           // "KVDR": the drop stream seed is seed ^ salt
	chancePercent: 6,            // per eligible kill (rngInt(0, 99) < percent), before the archetype override
	chanceByArchetype: ...,      // ReadonlyMap like score's KILL_POINTS: swarmer 3, sniper 8, bruiser 10, default 6
	pityKills: 20,               // eligible kills without a drop -> the next eligible kill always drops
	groundSeconds: 10,           // -> groundTicks
	pickupRadius: 0.6 * TILE_SIZE,
	maxOnGround: 4,              // a roll that would exceed it is skipped (no draw, pity still counts)
};
```

**`drops.ts`** (state, hooks, step, hash):

```ts
export interface DropsConfig { /* DROPS overrides; tutorial: chancePercent 0 + guaranteed rooms */
	readonly chancePercent: number; readonly pityKills: number; ...
	/** Tutorial: the last kill in each of these rooms (floor, room id) always drops `kind`. */
	readonly guaranteed?: ReadonlyArray<{ floor: number; room: number; kind: number }>;
}
export interface GroundDrop { kind: number; x: number; z: number; spawnTick: number } // kind NO_BOOST = free slot
export interface BoostPlayerState { ticks: number[] /* by Boost index, 0 = off */; aegisPips: number }
export interface DropsState {
	rngState: number;            // its own mulberry32 stream
	killsSinceDrop: number;      // pity counter
	ground: GroundDrop[];        // fixed DROPS.maxOnGround slots, slot order
	players: BoostPlayerState[]; // party index order (solo: one)
	events: DropsEvents;         // NOT hashed: dropped slots, collected (player, kind), expired, aegisBroke
}
```

Rules:

- **Eligible kill** (`dropsOnKill`): not a reviving archetype, not the training dummy (outside a guarantee), not in a
  boss room (`ctx.roomAt`), not the boss. Then: pity reached -> drop; else one `rngInt(drops, 0, 99)` against the
  archetype's percent. A drop picks its kind with one weighted `rngInt(drops, 0, totalWeight - 1)`. A full ground
  skips both draws. Draw counts are fixed per case, so the stream stays aligned across clients.
- **`stepDrops(state)`**, after `stepRun` and before `stepScore` (both `step` and `stepParty`): count boost timers
  down (player order, kind order; Aegis pips go at 0), age ground drops and free expired slots, then pickups: per slot
  in order, the first living player (index order) within `pickupRadius` takes it (`ticks[kind] = full`, Aegis sets
  `aegisPips = AEGIS_PIPS`). A drop can be taken on the tick it lands.
- **Death** (`killPlayerState` callers via a `dropsOnPlayerDied` hook) clears that player's timers and pips.
  **Floor change** (`stepEndless`) frees every ground slot; timers keep running.
- **Hash**: `writeDropsHash`: rngState, killsSinceDrop, every ground slot (kind, x, z, spawnTick), every player's
  ticks and aegisPips, with dump names. `cloneSimState` copies it.

**`boostMods.ts`** (a LEAF, like `runMods.ts`; neutral when `state.drops` is undefined, returning the input unchanged):

| Read | Change |
|---|---|
| `playerHitDamage` (runMods) | after Sharpened: `scalePercent(x, FURY_DAMAGE_PERCENT)` while Fury runs. Integer payload damage x 5/4 x 3/2 is exact in float64; a spec checks every weapon's damage |
| `attackTicks` (runMods) | one combined integer percent `boon x boost / 100` through `scaleTicks` (a spec asserts every combination is an integer percent) |
| `movePlayer` walk (player.ts) | `walkPercent(state, i)`: x 130 % while Quickstep runs; a walk tick longer than `MAX_MOVE_STEP` is two equal sub-steps |
| `damagePlayer` (player.ts) | after the harmless branch, before armor: an Aegis pip absorbs the whole hit (post-hit invulnerability, Hourglass and `playerHits` as for armor), `events.aegisBroke` |

### 2. Worlds

| World | `SimConfig.drops` |
|---|---|
| M1 (`KALEB_VALE_MVP_PARAMS`), every fixture | absent: unchanged |
| Endless solo and co-op (`shared/run/endless.ts`) | `DROPS_CONFIG` (the defaults) |
| Tutorial (`shared/run/tutorial.ts`) | `chancePercent: 0`, `pityKills: 0` (off), `guaranteed: [{ floor 1, room combatB, kind FURY }]` |

### 3. Client

| Piece | Change |
|---|---|
| `BoostDropRenderController` (new, `client/controllers/render`, pooled, Janitor) | One view per ground slot under `KV_Drops`: placeholder a small diamond Part tinted by `boost.<kind>` colour role; with art an upright billboard of the pack's `boost.<kind>` image (like the pedestal beam). Bob (`motionScale`), blink for the last `BOOST_VIEW.blinkSeconds`, pop on land, burst on pickup (ParticleController / `fx.boost.collect` when the pack has it), poof on expiry |
| Player aura (`ActorRenderController`) | A tinted ring / glow per active boost on every player (teammates too), drawn under bullets and never taller than `BOOST_VIEW.auraMaxHeightTiles` |
| `takeSnapshot` | `boosts: { kind, secondsLeft (tenths), fraction }[]` and `aegisPips` from the vitals index (`SnapshotExtras.vitalsIndex` if docs/SPECTATE.md S2 has landed, else `playerIndex`). Quantised so the HUD does not re-render every frame |
| `ui/hud/BoostRow.tsx` (new, beside `StatusPanel`) | Icon + draining bar per active boost, blinking under 2 s; Aegis as an extra pip in the armor row, its own colour. Theme strings and roles only, `useHudScale` |
| `ToastPanel` | `hud.toast.boost` (`{name}: {desc}`) for the local player's pickups |
| Audio (`shared/view/audio` cue mapper) | `sfx.boost.drop`, `sfx.boost.collect`, `sfx.boost.expire`, `sfx.boost.aegisBreak`; the local player's collect at full volume, teammates' at the teammate level |
| `KV_Debug` | `DEBUG_DROP_BUTTON` (a free key, chosen in B0): drops the next boost kind at the player's feet |

### 4. Theme contract

- Required in every pack (a gameplay object must always be drawn, like `breakable.*`): `boost.<kind>` asset and colour
  role for the four kinds; strings `boost.<kind>.name` / `.desc` / `.icon`; the four `sfx.boost.*` IDs appended to
  `PORT_AUDIO_EVENTS` (SILENT in the placeholder); `hud.toast.boost`.
- Optional: `fx.boost.collect`, `fx.boost.aura.<kind>` (one-facing sprites under the `fx.*` rules).
- Validator: every `boost.*` role >= 40 CIE76 from the enemy-bullet roles (a pickup never reads as a bullet) and
  >= 3:1 on every biome floor (as `enemyOutline`).
- Vale art / audio: icons from the Ninja Adventure pack's **Items** folder (CC0, same licence; vendor it into
  `art/vendor/ninja-adventure/Items`, add to `art/atlases.json`), the aura / burst from its FX `Magic` / `Particle`
  folders, sounds from Audio/Sounds `Bonus` and `Magic & Skill` (`art/audio.json`).

### 5. Server, lockstep, leaderboards

Nothing new: validation and segmented validation re-run the same deterministic sim, and co-op steps the same merged
frames. Each kill costs at most two extra draws and each tick one pass over 4 ground slots: re-run
`replay.bench.spec.ts` against docs/SERVER.md's budget. Endless replays and scores change, so the B8 rule of
docs/DECOR.md applies: before launch no reset; after launch bump `LB_Solo_v1` / `LB_Coop_v1`.

## Tasks

- [x] **B0. Confirm the assumptions.** Every row of "What the code gives us": the boss room tag and that every summon
  spawns inside it; that the tutorial world has `state.run` and endless-style floors; the free debug key; whether the
  leaderboards have shipped (P9). → Verify: each row confirmed or this plan edited.
- [x] **B1. State, data, hash.** `drops/dropsData.ts`, `drops/drops.ts` (create, clone, events, `writeDropsHash` +
  names), `SimConfig.drops`, `SimState.drops`, the `drops` group in `hashLayout.ts`, barrel. → Verify: `npm run verify`
  with every golden fixture, M1 hash and existing endless replay unchanged (nothing sets the config yet); clone / hash
  specs.
- [x] **B2. Drops and pickups.** `dropsOnKill` in `killActor`, `stepDrops` in `step` / `stepParty`, eligibility,
  pity, the ground cap, expiry, floor clear, death clear, `DEBUG_DROP_BUTTON`. → Verify: `drops.spec.ts`: the stream
  never touches `state.rngState` (boon offers identical with and without drops); fixed draws per case; turrets,
  dummy, boss and boss-room summons never roll; pity at exactly `pityKills`; cap skips without drawing; pickup order
  (slot, then player index), on the landing tick, not by the dead; expiry at `groundTicks`; refresh resets to full;
  draft freeze stops every timer; co-op: picker only.
- [x] **B3. Effects.** `boostMods.ts`; Fury and Frenzy in the runMods helpers, Quickstep in `movePlayer` with the
  sub-step split, Aegis in `damagePlayer`. → Verify: exact damage for every weapon with and without Sharpened;
  integer combined attack percent for every combo; Quickstep walk distance and no wall tunnelling (two sub-steps);
  roll distance unchanged; Aegis before armor, never refilled by Warding, prevents a lethal hit before Second Wind
  is needed; harmless mode untouched; neutral paths return their input (`===`).
- [x] **B4. Worlds.** `DROPS_CONFIG` on endless solo and co-op. Re-record the endless runs (`run/slice.spec.ts`,
  `run/endless.spec.ts`, `run/party.spec.ts`, `run/partyProgression.spec.ts`) and check they replay and validate
  segmented. Replay bench within budget. → Verify: `npm run verify`; a 20-floor bot census writes drops per floor and
  pickup rate into the spec log.
- [x] **B5. Theme.** Contract IDs, roles, strings, `PORT_AUDIO_EVENTS`, validator rules, placeholder pack.
  → Verify: contract / validator / `audio.spec.ts` / `hud.spec.ts` token checks.
- [ ] **B6. World view.** (code-complete; Studio check pending) `BoostDropRenderController`, the aura, pickup / expiry FX. → Verify: Studio, `KV_Debug`,
  the debug key drops each kind: visible on every biome floor, blinks, fades, never hides a bullet; reduced motion
  still; 2-player: the picker's aura shows on the other client.
- [ ] **B7. HUD and audio.** (code-complete; headless specs pass; Studio check pending) Snapshot fields, `BoostRow`, the Aegis pip, the toast, the cue mapper. → Verify:
  `snapshot.spec.ts` (quantised fields, vitals index), audio cue spec; Studio: row drains and blinks, refresh resets
  it, Aegis pip breaks on a K hit.
- [ ] **B8. Vale art and audio.** Vendor Items, atlas and audio entries, upload, paste IDs. → Verify: `art:build`,
  `audio:build`, `test:art`; vale pack validator passes.
- [x] **B9. Tutorial.** The tutorial world's drops config (guaranteed Fury on combat B's last kill), a `boost`
  callout when it lands (`tutorial.callout.boost`: "Enemies sometimes drop a boost. Walk over it before it fades."),
  the marker on the drop while it lies there, a ring on the boost row on pickup. → Verify: the tutorial lock spec
  passes except for the drops field; `flow.spec.ts` / director spec: the callout fires once, the funnel numbers are
  unchanged; the bot's tutorial run picks the drop up and still finishes in budget.
- [x] **B10. Docs.** `CLAUDE.md` decision log line and docs-table row, `src/shared/sim/README.md` (module row, tick
  order, hash group list), docs/CLIENT.md (controller, HUD row, debug key), docs/SERVER.md (replay cost), docs/TUTORIAL.md
  (the callout). → Verify: `npm run verify`.
- [ ] **B11. Playtest.** Solo and 4-player, PC and phone emulator, keyboard and gamepad: drop rate feel per floor,
  contested drops in co-op, readability in bullet storms, Fury + Sharpened TTK on the boss floors, Quickstep near
  pits and corridors. Tune `DROPS` and the boost table.

Critical path: B0 -> B1 -> B2 -> B3 -> B4. B5 can start after B1; B6 / B7 after B2 and B5; B8 any time after B5;
B9 after B4 and B7.

## As built (B0-B3)

`src/shared/sim/drops/`: `dropsData.ts` (tunables, a leaf), `drops.ts` (config, state, kill / room hooks, `stepDrops`,
read helpers, hash), `boostMods.ts` (the effect reads, a leaf), specs `drops.spec.ts` (B1 / B2) and `boosts.spec.ts`
(B3). Differences from the sketch above:

- `GroundDrop` is `{ kind, x, z, spawnTick, ticksLeft }`: the life is a countdown (frozen in drafts). A drop is
  takeable on exactly `groundTicks` ticks, its landing tick included, and fades on the next.
- `DropsState` also hashes `debugNextKind` (the debug key's cycle) and `guards` (the guarantee's living member ids).
- `DropsConfig` has `chanceByArchetype` (the per-archetype table is config, not data, so a world can turn it off).
  `guaranteedDropsConfig(guaranteed)` is the tutorial's: no random drops, no pity, DROPS_CONFIG's ground tunables.
- Draws per kill: guarantee 0, ineligible 0, full ground 0, pity 1, roll hit 2, roll miss 1, a 0 % archetype 0.
- The guarantee's last kill bypasses every eligibility rule; with no free slot it is lost (cannot happen in the
  tutorial: nothing else drops there).
- `DEBUG_DROP_BUTTON` lands the drop `DEBUG_DROP_AHEAD` (1.5 tiles) along the player's facing, not under their feet:
  at the feet it would be collected on the same tick, and B6 needs it to lie there (blink, fade). Walk onto it.
- Events (`DropsEvents`, not hashed): `dropped` (slots), `collected` ({player, kind, slot, x, z}), `expired`
  ({slot, kind, x, z}), `ended` ({player, kind}: a timer ran out; not on death or a broken Aegis), `aegisBroke`
  (players). A floor change frees slots silently.
- Frenzy: `combinedPercent(boon, boost)` in runMods.ts.

## As built (B4, B9)

- **Worlds.** `buildEndlessRunConfig` (solo and party) sets `drops: DROPS_CONFIG`; it is the only endless config
  builder, so the client's live run, the server's `validateRun` / `SegmentedValidator` and the lockstep party all get
  it. The tutorial sets `TUTORIAL_DROPS_CONFIG` (shared/run tutorial.ts: `TUTORIAL_BOOST_LESSON` combatB = room 2,
  `TUTORIAL_BOOST_KIND` Fury). M1 and every fixture: unchanged.
- **What moved.** No endless spec pinned a hash or score value: they compare a live run with its replays. Only the
  hash-layout specs changed (endless.spec: 11 groups, `drops` last; partyProgression.spec: `drops` after `breakables`,
  `drops.players.length` = party size) and the tutorial lock spec (`drops` among the config keys, plus a new drops
  test). The recorded solo run (`recordEndlessRun`) never kills outside the boss room, so it rolls no drop at all and
  its hashes / scores are unchanged apart from the appended group; the party runs (sword swings on floor 1) roll and
  still replay through the codec and validate segmented.
- **Census** (`run/dropsCensus.spec.ts`, ~14 s): a sword bot clears every non-boss room of floors 1-4 for seeds 1337,
  4242, 90210 (hearts topped up), walking over drops after each room: 467 kills, 31 drops = **2.6 per floor, 6.6 % of
  kills** (2.9-9.8 % per floor), **87 % taken** (the rest faded during long fights). Then the same bot plays seed
  4242's floor 1 honestly (no surgery): 3 drops, 3 taken; the run replays to its live hash and validates through
  `SegmentedValidator` in 1200-tick segments.
- **Replay bench** (this machine, three runs each, ms per replayed tick, with drops / with `drops` removed from the
  endless config): solo room 0.28-0.33 / 0.27-0.30, 8 players room 0.59-0.74 / 0.60-0.76, solo floor 0.37-0.41 /
  0.39-0.41, 8 players floor 1.06-1.14 / 1.08-1.20: no measurable cost (the bench kills nobody, so it measures the
  per-tick `stepDrops` pass and the hash group). This host is slower than docs/SERVER.md's for the room cases.
- **Leaderboards (P9).** `shared/leaderboard/config.ts` still names `LB_Solo_v1` / `LB_Coop_v1`; not bumped (owner's
  call: before launch no reset, after launch bump).
- **Tutorial (B9).** Callout `boost` (`tutorial.callout.boost`, trigger `boostDrop`: a drop on the floor or a boost
  already running), marker kind `drop` (the drop nearest the player, not inside an entered unfinished lesson room,
  not under the objective card), highlight `boosts` (`TUTORIAL_BOOST_HIGHLIGHT`, the boost row; rung on the first
  frame a boost runs, for `TUTORIAL.calloutHighlightSeconds`). Funnel: 15 steps, unchanged. The bot walks over drops
  after combat A / B; it takes the Fury 6 ticks after it lands; bot time 4283 -> 4246 ticks (Fury shortens combat C).
  The client marker controller only reads x / z (no kind switch); the HUD agent renders the `boosts` ring.

## As built (B5-B7, review)

- **Theme (B5).** `BOOST_KINDS` (same order as `Boost`), `boost.<kind>` assets / roles / strings, `hud.toast.boost`,
  `tutorial.callout.boost`, optional `fx.boost.collect` / `fx.boost.aura.<kind>`. The Aegis sound is
  `sfx.boost.aegisbreak` (lowercase: the validator rejects uppercase IDs). Placeholder colours: Fury `#ffc83d`,
  Quickstep `#3ff0d8`, Frenzy `#a8f03c`, Aegis `#c3a6ff` (>= 59 Delta E from the bullet roles, >= 5.86:1 on every
  biome floor and wall). Placeholder shape `"Diamond"` (a cube on its corner). Not checked in the darkest decor band
  (`decorBandContrastReport`), unlike `enemyOutline`.
- **Client (B6 / B7).** `BoostDropRenderController` (pooled views keyed by ground slot in a Map: freed slots leave no
  array holes), `BoostAuraController` (Neon discs, one per active boost), `ui/hud/BoostRow.tsx` inside `StatusPanel`
  (with the tutorial's `boosts` highlight ring), the Aegis pip after the armor pips, the `boost` toast, four cue-mapper
  sounds, `fx.boost.collect` or a particle burst. Pure logic in `shared/view/boosts` (headless specs). Per-tick drop
  events are collected after every tick into `RunView.boostEvents` (`LiveRun`, `LockstepClient`). Debug key **M**
  (`DEBUG_DROP_BUTTON` = 32768, KV_Debug only). The HUD's boost row and Aegis pip read `SnapshotExtras.vitalsIndex` (the
  watched teammate while spectating, docs/SPECTATE.md), and the boost sounds use the spectate view index.
- **Review fixes.** The render controller's views were a holey array (`#` unreliable after a pickup freed a middle
  slot: a gem could stop animating and survive the run's end); now a Map. The boss-room exclusion was narrowed to boss
  floors (P5).
- **Known nit.** A debug drop on the same tick as a floor change can give two landing cues on slot 0 (KV_Debug only).
- **Saved bindings.** M is now reserved; a player whose saved layout bound an action to M may see it refused or reset
  (not checked).

## Edge cases

- **A kill on the tick a floor ends** (the last enemy and the stairwell): the drop lands, then the floor change frees
  it. Harmless, and consistent on every client.
- **Two players reach a drop on the same tick**: the lower player index gets it (fixed order, like pedestals).
- **Kill inside a breakable's cell** cannot happen (bodies never enter one); a drop can lie next to a crate and is
  still reachable (the pickup radius is larger than the gap rule leaves).
- **An enemy killed by a bullet after its owner died**: the kill still rolls; anyone alive can take the drop.
- **Fury on Mother Bramble**: her `damageCapPerSecond` still applies after the multiplier, so Fury cannot break the
  boss TTK floor (checked in B3 against the TTK table).
- **Leave run / forfeit while boosted**: the player dies; the death clear applies; nothing else.
- **Spectating**: the boost row follows the watched player's vitals (if spectating has landed).
- **Second Wind with Aegis up**: Aegis absorbs first, so Second Wind is only spent by a hit Aegis did not take.

## Decisions (2026-10-26, Kaleb)

- **Roster v1: Fury, Quickstep, Frenzy, Aegis.**
- **Co-op: the picker only.** The first living player to touch a drop gets it; no party-wide boosts.
- **Stacking: refresh.** One of each kind at a time; a repeat pickup resets the timer to full.
- **Scope: endless runs and the tutorial.** M1 and every fixture are untouched.

## Recommended defaults (confirm or change before the task in brackets)

- **P1. Own rng stream** (`seed ^ DROPS.salt`) [B1]. The alternative (the sim rng) would reshuffle every boon offer
  and relic after the first drop roll.
- **P2. Drop rate**: 6 % per eligible kill (swarmer 3 %, sniper 8 %, bruiser 10 %), pity after 20 dry kills
  [B2; tuned in B11]. Roughly 3-5 drops on a mid floor.
- **P3. Ground life 10 s, blink 2 s; at most 4 on the floor** [B2].
- **P4. Floor change clears ground drops, keeps running boosts; death clears boosts** [B2].
- **P5. No drops in boss rooms on boss floors** (no summon farming, the fight is about patterns) [B2]. As built: the
  rule applies only when the floor's encounter spawns a boss; on other floors the "boss"-type room is just the
  stairwell room, and kills there roll like anywhere else.
- **P6. Pickups score nothing and do not feed the combo** [B2].
- **P7. Quickstep walk only; the roll is unchanged** [B3].
- **P8. Tutorial: a guaranteed Fury in combat B and a callout, not a new funnel step.** A real step would renumber
  funnel steps 5-15 and break telemetry comparisons with existing data [B9].
- **P9. Leaderboards**: if they have shipped by B4, bump `LB_Solo_v1` / `LB_Coop_v1` (endless scores change) [B4].

## Risks

- **Balance in co-op**: picker-only boosts in a 4-player party can make one player carry; watch for "drop hoarding"
  in B11. Fallback: shorter durations in larger parties (a `secondsByPartySize` row), not party-wide boosts.
- **Readability**: four new coloured objects among bullets. The CIE76 / contrast rules and the low, small shape are
  the mitigation; B6 checks every biome.
- **Quickstep and collision**: the walk sub-step split is the one change to movement; its spec must cover corridors,
  pillars and crates.
- **Replay cost**: small, but measured in B4.

## Out of scope

- Permanent stat pickups, coins / currency, healing hearts as drops (hearts stay with the flask and Vampire Fang).
- Drops from breakables (docs/DECOR.md B5 kept them out of v1; `dropsOnBreak` could reuse this later).
- Magnet / auto-pickup, rarity tiers for boosts, boosts that affect the whole party.
